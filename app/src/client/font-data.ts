import type { FontSummary, FontRecord, Glyph } from "../para/types";

/** LRU measured in decoded JSON bytes, with shared in-flight reads and four slots. */
export class FontAssetCache {
  private values = new Map<string, { value: unknown; bytes: number }>();
  private pending = new Map<
    string,
    { signal: AbortSignal; promise: Promise<unknown> }
  >();
  private used = 0;
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(
    private maxBytes = 8 * 1024 * 1024,
    private fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  get bytes() {
    return this.used;
  }
  get size() {
    return this.values.size;
  }
  private async slot(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active >= 4)
      await new Promise<void>((resolve, reject) => {
        const cancel = () => {
          this.queue = this.queue.filter((item) => item !== start);
          reject(signal.reason);
        };
        const start = () => {
          signal.removeEventListener("abort", cancel);
          this.active++;
          resolve();
        };
        signal.addEventListener("abort", cancel, { once: true });
        this.queue.push(start);
      });
    else this.active++;
    const release = () => {
      this.active--;
      this.queue.shift()?.();
    };
    try {
      signal.throwIfAborted();
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }
  async get<T>(url: string, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const cached = this.values.get(url);
    if (cached) {
      this.values.delete(url);
      this.values.set(url, cached);
      return cached.value as T;
    }
    const existing = this.pending.get(url);
    if (existing && !existing.signal.aborted)
      return existing.promise as Promise<T>;
    const entry = { signal, promise: Promise.resolve<unknown>(null) };
    entry.promise = (async () => {
      const release = await this.slot(signal);
      try {
        const response = await this.fetcher(url, { signal });
        if (!response.ok)
          throw new Error(`Не вдалося завантажити дані (${response.status}).`);
        const text = await response.text();
        signal.throwIfAborted();
        const value: unknown = JSON.parse(text),
          bytes = text.length * 2;
        if (bytes <= this.maxBytes) {
          while (this.used + bytes > this.maxBytes && this.values.size) {
            const key = this.values.keys().next().value!;
            this.used -= this.values.get(key)!.bytes;
            this.values.delete(key);
          }
          this.values.set(url, { value, bytes });
          this.used += bytes;
        }
        return value;
      } finally {
        release();
      }
    })().finally(() => {
      if (this.pending.get(url) === entry) this.pending.delete(url);
    });
    this.pending.set(url, entry);
    return entry.promise as Promise<T>;
  }
}
interface NativeIndex {
  font: Omit<FontRecord, "glyphs">;
  pages: { file: string; offset: number; count: number }[];
  unicodeIndex: Record<string, number[]>;
}
export type GlyphMode = "all" | "mapped" | "unmapped";
export class NativeFont {
  readonly mapped: Set<number>;
  constructor(
    readonly summary: FontSummary,
    readonly index: NativeIndex,
    private cache: FontAssetCache,
    private signal: AbortSignal,
  ) {
    this.mapped = new Set(Object.values(index.unicodeIndex).flat());
  }
  static async open(
    summary: FontSummary,
    cache: FontAssetCache,
    signal: AbortSignal,
  ) {
    return new NativeFont(
      summary,
      await cache.get<NativeIndex>(summary.metaUrl, signal),
      cache,
      signal,
    );
  }
  indices(mode: GlyphMode) {
    return Array.from(
      { length: this.summary.coverage.glyphCount },
      (_, i) => i,
    ).filter(
      (i) => mode === "all" || this.mapped.has(i) === (mode === "mapped"),
    );
  }
  async glyphs(indices: number[]) {
    const pages = new Map<number, Promise<Glyph[]>>();
    const root = this.summary.metaUrl.slice(
      0,
      this.summary.metaUrl.lastIndexOf("/meta/"),
    );
    for (const i of indices) {
      const page = Math.floor(i / 128);
      if (!pages.has(page))
        pages.set(
          page,
          this.cache.get<Glyph[]>(
            root + "/" + this.index.pages[page].file,
            this.signal,
          ),
        );
    }
    await Promise.all(pages.values());
    return Promise.all(
      indices.map(
        async (i) => (await pages.get(Math.floor(i / 128))!)[i % 128],
      ),
    );
  }
  async text(value: string) {
    const chars = [...new Set([...value])];
    const indices = [
      ...new Set(
        chars.flatMap((c) => this.index.unicodeIndex[c]?.slice(0, 1) ?? []),
      ),
    ];
    const glyphs = await this.glyphs(indices),
      byChar = new Map<string, Glyph>();
    for (const glyph of glyphs)
      for (const label of glyph.labels)
        if (label.kind === "unicode" && !byChar.has(label.value))
          byChar.set(label.value, glyph);
    return {
      byChar,
      missing: chars.filter((c) => c !== "\n" && !byChar.has(c)),
    };
  }
  lookup(value: string): number | undefined {
    value = value.trim();
    if (/^g\d{6}$/.test(value)) {
      const i = Number(value.slice(1));
      return i < this.summary.coverage.glyphCount ? i : undefined;
    }
    if (/^U\+[\da-f]{4,6}$/i.test(value)) {
      const cp = parseInt(value.slice(2), 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return undefined;
      value = String.fromCodePoint(cp);
    }
    return this.index.unicodeIndex[value]?.[0];
  }
}
