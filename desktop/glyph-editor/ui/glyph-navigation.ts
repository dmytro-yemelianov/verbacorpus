import { effectiveIndex, type Draft } from "./model";
import { canonicalSlots, type GlyphSlot } from "./regions";
import { selectedGroupSlots, type GroupSelection } from "./group-selection";

export function slotReviewed(slot: GlyphSlot, reviewed: ReadonlySet<string>) {
  return reviewed.has(slot.key) || !!(slot.id && reviewed.has(slot.id));
}
export function retainedSlotPosition(
  slots: GlyphSlot[],
  glyphId: string,
  char?: string,
) {
  const id = slots.findIndex((s) => s.id === glyphId);
  return id >= 0
    ? id
    : slots.findIndex((s) => !s.id && !!char && s.char === char);
}
export function slotPosition(
  slots: GlyphSlot[],
  preferred: string | undefined,
  fallback = 0,
) {
  const exact =
    preferred === undefined ? -1 : slots.findIndex((s) => s.key === preferred);
  const found =
    exact >= 0
      ? exact
      : preferred === undefined
        ? -1
        : slots.findIndex((s) => s.id === preferred);
  return found >= 0
    ? found
    : Math.max(
        0,
        Math.min(
          slots.length - 1,
          Number.isFinite(fallback) ? Math.floor(fallback) : 0,
        ),
      );
}
/** Pure queue policy shared by navigation, review and restored selections. */
export function buildGlyphQueue(options: {
  state: Draft;
  unicodeIndex: Record<string, number[]>;
  glyphCount: number;
  mode: string;
  groups: GroupSelection;
  unreviewed: boolean;
  preferred?: string;
  fallback: number;
}) {
  const { state, mode } = options;
  const index = effectiveIndex(options.unicodeIndex, state);
  const ids = [
    ...new Set([
      ...Array.from(
        { length: options.glyphCount },
        (_, i) => "g" + String(i).padStart(6, "0"),
      ),
      ...state.created,
    ]),
  ];
  const mapped = new Set([...index.values()].flat());
  let slots: GlyphSlot[] =
    (mode === "groups"
      ? selectedGroupSlots(options.groups, index)
      : canonicalSlots(mode, index)) ??
    (mode === "changed"
      ? Object.keys(state.edits)
      : mode === "unmapped"
        ? ids.filter((id) => !mapped.has(id))
        : ids
    ).map((id) => ({ key: id, id }));
  if (options.unreviewed) {
    const reviewed = new Set(state.reviewed);
    slots = slots.filter((s) => !slotReviewed(s, reviewed));
  }
  return {
    index,
    slots,
    selected: slotPosition(slots, options.preferred, options.fallback),
  };
}
export function adjacentFont<T extends { id: string }>(
  fonts: T[],
  current: string | undefined,
  delta: number,
): T | undefined {
  const i = fonts.findIndex((f) => f.id === current);
  return fonts[i < 0 ? 0 : i + delta];
}
export function afterGlyphReview(
  before: GlyphSlot[],
  oldPosition: number,
  after: GlyphSlot[],
  unreviewed: boolean,
) {
  if (!after.length || (!unreviewed && oldPosition >= before.length - 1))
    return { nextFont: true, position: 0 };
  const remaining = new Map(after.map((s, i) => [s.key, i]));
  for (let i = oldPosition + 1; i < before.length; i++) {
    const position = remaining.get(before[i].key);
    if (position !== undefined) return { nextFont: false, position };
  }
  return { nextFont: false, position: 0 };
}

interface SelectionRead<T> {
  load: () => Promise<T>;
  valid: () => boolean;
}
/** Resolves a requested slot by stable key after pending canvas operations.
 * The view publishes only a completed read of the current document revision. */
export class GlyphSelectionController<T> {
  private epoch = 0;
  private requested?: string;
  constructor(
    private options: {
      slots: () => GlyphSlot[];
      before: () => Promise<void>;
      capture: (slot: GlyphSlot) => SelectionRead<T> | undefined;
      loading: () => void;
    },
  ) {}
  get generation() {
    return this.epoch;
  }
  get pending() {
    return this.requested !== undefined;
  }
  invalidate() {
    this.epoch++;
    this.requested = undefined;
  }
  targetPosition(current: number) {
    return slotPosition(this.options.slots(), this.requested, current);
  }
  isCurrent(result: { generation: number }) {
    return result.generation === this.epoch;
  }
  async select(position: number) {
    const generation = ++this.epoch;
    const slots = this.options.slots(),
      slot = slots[slotPosition(slots, undefined, position)];
    const key = slot?.key;
    this.requested = key;
    try {
      await this.options.before();
      if (generation !== this.epoch) return;
      if (!key && !this.options.slots().length)
        return { generation, position: 0, slot: undefined, value: undefined };
      this.options.loading();
      while (generation === this.epoch) {
        const values = this.options.slots(),
          index = values.findIndex((s) => s.key === key),
          target = values[index];
        if (!target) return;
        const read = this.options.capture(target);
        if (!read) return;
        const value = await read.load();
        if (generation !== this.epoch) return;
        // A pending paste can create a glyph, and a concurrent mutation can
        // replace its mapping or bitmap. Resolve the same key again if needed.
        const now = this.options.slots(),
          current = now.findIndex((s) => s.key === key);
        if (read.valid() && current >= 0 && now[current].id === target.id)
          return { generation, position: current, slot: now[current], value };
      }
    } catch (reason) {
      if (generation === this.epoch) throw reason;
    } finally {
      if (generation === this.epoch) this.requested = undefined;
    }
  }
}
