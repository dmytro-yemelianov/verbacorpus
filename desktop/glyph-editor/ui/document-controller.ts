import type { Document as GlyphDocument, Draft } from "./model";

interface DocumentResource {
  document: GlyphDocument;
}
interface Entry<T> {
  value: T;
  controller: AbortController;
  changes: number;
  saved: number;
  pending?: { version: number; promise: Promise<void> };
}
export type SaveStatus = "dirty" | "saved" | "error";

/** Owns document identity, navigation cancellation and the serialized save barrier.
 * Resources are published only after loading succeeds and the previous document
 * is saved. Each queued write keeps its own immutable draft and source resources. */
export class DocumentController<T extends DocumentResource> {
  private active?: Entry<T>;
  private loading?: { id: string; controller: AbortController };
  private timer?: ReturnType<typeof setTimeout>;
  private tail = Promise.resolve();
  private epoch = 0;
  constructor(
    private options: {
      load: (id: string, signal: AbortSignal) => Promise<T>;
      beforeSwitch?: () => Promise<void>;
      prepare: (state: Draft, resource: T) => Promise<void>;
      write: (state: Draft) => Promise<unknown>;
      status: (status: SaveStatus) => void;
      error: (reason: unknown) => void;
      delay?: number;
    },
  ) {}
  get generation() {
    return this.epoch;
  }
  get current() {
    return this.active?.value;
  }
  get opening() {
    return !!this.loading;
  }
  get requestedId() {
    return this.loading?.id ?? this.active?.value.document.state.fontId;
  }
  get dirty() {
    return !!this.active && this.active.saved < this.active.changes;
  }
  async open(id: string): Promise<T | undefined> {
    const token = ++this.epoch;
    this.loading?.controller.abort();
    const controller = new AbortController();
    const request = { id, controller };
    this.loading = request;
    try {
      await this.options.beforeSwitch?.();
      if (token !== this.epoch) return;
      await this.flush();
      if (token !== this.epoch) return;
      if (this.active?.value.document.state.fontId === id)
        return this.active.value;
      const value = await this.options.load(id, controller.signal);
      if (token !== this.epoch) return;
      // An edit can arrive while loading, even when the view normally disables
      // drawing. Never replace a document with a newer unsaved mutation.
      await this.flush();
      if (token !== this.epoch) return;
      const previous = this.active;
      this.active = { value, controller, changes: 0, saved: 0 };
      previous?.controller.abort();
      return value;
    } catch (reason) {
      if (token === this.epoch) throw reason;
    } finally {
      if (this.loading === request) this.loading = undefined;
      if (this.active?.controller !== controller) controller.abort();
    }
  }
  changed() {
    const entry = this.active;
    if (!entry) return;
    entry.changes++;
    this.options.status("dirty");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.persist(entry).catch(this.options.error);
    }, this.options.delay ?? 300);
  }
  private persist(entry: Entry<T>): Promise<void> {
    const version = entry.changes;
    if (entry.saved >= version) return Promise.resolve();
    if (entry.pending?.version === version) return entry.pending.promise;
    const state = structuredClone(entry.value.document.state);
    const promise = this.tail.then(async () => {
      try {
        await this.options.prepare(state, entry.value);
        await this.options.write(state);
        entry.saved = Math.max(entry.saved, version);
        if (
          entry === this.active &&
          version === entry.changes &&
          state.revision === entry.value.document.state.revision
        ) {
          entry.value.document.state.ukrainianCoverage =
            state.ukrainianCoverage;
          entry.value.document.state.latinReferences = state.latinReferences;
          if (!this.opening) this.options.status("saved");
        }
      } catch (reason) {
        if (entry === this.active && version === entry.changes && !this.opening)
          this.options.status("error");
        throw reason;
      } finally {
        if (entry.pending?.promise === promise) entry.pending = undefined;
      }
    });
    entry.pending = { version, promise };
    // Keep the queue usable after failure; the caller still receives rejection
    // and the document stays dirty until an actual successful write.
    this.tail = promise.then(
      () => {},
      () => {},
    );
    return promise;
  }
  async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const entry = this.active;
    try {
      while (entry && entry.saved < entry.changes) await this.persist(entry);
      await this.tail;
    } finally {
      if (entry === this.active) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    }
  }
}

/** Session writes use the same ordering for debounce and explicit close/flush. */
export function createSessionPersistence<T>(options: {
  snapshot: () => T;
  write: (value: T) => Promise<unknown>;
  error: (reason: unknown) => void;
  delay?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined,
    tail = Promise.resolve();
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const value = structuredClone(options.snapshot());
    const task = tail.then(async () => {
      await options.write(value);
    });
    tail = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(
        () => void flush().catch(options.error),
        options.delay ?? 350,
      );
    },
    flush,
  };
}
