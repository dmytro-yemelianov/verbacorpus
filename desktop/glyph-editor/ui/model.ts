import type {
  FontSummary,
  FontRecord,
  Glyph,
} from "../../../app/src/para/types";
export type { Glyph, FontSummary, FontRecord };
export const UKRAINIAN = [
  ..."АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя",
];
export const codepoint = (char: string) =>
  `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
export interface Derivation {
  sourceGlyphId: string;
  sourceChar: string;
  targetChar: string;
  transform: string;
  kind: "homograph" | "geometry";
  recipeVersion?: number;
  components?: {
    sourceGlyphId: string;
    sourceChar: string;
    transform: string;
  }[];
}
export interface Draft {
  format: "para-glyph-edits";
  schemaVersion: 1;
  fontId: string;
  snapshot: string;
  baseSha256: string;
  revision: number;
  updatedAt: string;
  edits: Record<string, Glyph>;
  derivations?: Record<string, Derivation>;
  created: string[];
  reviewed: string[];
  done: boolean;
  notes: string;
}
export function newDraft(font: FontSummary, snapshot: string): Draft {
  return {
    format: "para-glyph-edits",
    schemaVersion: 1,
    fontId: font.id,
    snapshot,
    baseSha256: font.sha256,
    revision: 0,
    updatedAt: new Date().toISOString(),
    edits: {},
    created: [],
    reviewed: [],
    done: false,
    notes: "",
  };
}
export function unpack(glyph: Glyph) {
  const pixels = new Uint8Array(glyph.width * glyph.height);
  for (let y = 0; y < glyph.height; y++)
    for (let b = 0; b < glyph.rowBytes; b++) {
      const byte = parseInt(glyph.rows[y].slice(b * 2, b * 2 + 2), 16);
      if (!byte) continue;
      for (let bit = 0; bit < 8 && b * 8 + bit < glyph.width; bit++)
        if (byte & (128 >> bit)) pixels[y * glyph.width + b * 8 + bit] = 1;
    }
  return pixels;
}
export function pack(pixels: Uint8Array, width: number, height: number) {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let b = 0; b < Math.ceil(width / 8); b++) {
      let byte = 0;
      for (let bit = 0; bit < 8 && b * 8 + bit < width; bit++)
        if (pixels[y * width + b * 8 + bit]) byte |= 128 >> bit;
      row += byte.toString(16).toUpperCase().padStart(2, "0");
    }
    rows.push(row);
  }
  return rows;
}
export function line(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  paint: (x: number, y: number) => void,
) {
  const dx = Math.abs(x1 - x0),
    sx = x0 < x1 ? 1 : -1,
    dy = -Math.abs(y1 - y0),
    sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    paint(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x0 += sx;
    }
    if (twice <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}
export function blankGlyph(font: FontSummary, id: string, char: string): Glyph {
  const width = font.cell.width,
    height = font.cell.height,
    advance = Number(font.metrics.advanceX);
  return {
    id,
    character: char,
    codepoint: codepoint(char),
    labels: [{ kind: "unicode", value: char }],
    width,
    height,
    rowBytes: Math.ceil(width / 8),
    advanceX: advance,
    metrics: {
      leftBearing: 0,
      rightBearing: advance - width,
      shiftUp: Number(font.metrics.baseline) - height,
    },
    rows: pack(new Uint8Array(width * height), width, height),
    sourceCode: null,
  };
}
export interface GlyphEdit {
  id: string;
  glyph?: Glyph;
  source?: Glyph;
  derivation?: Derivation;
}
interface Change {
  id: string;
  before?: Glyph;
  after?: Glyph;
  derivationBefore?: Derivation;
  derivationAfter?: Derivation;
}
interface Transaction {
  changes: Change[];
  createdBefore: string[];
  createdAfter: string[];
  bytes: number;
}
export class Document {
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private historyBytes = 0;
  constructor(readonly state: Draft) {}
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  touch() {
    this.state.revision++;
    this.state.updatedAt = new Date().toISOString();
  }
  commit(id: string, glyph: Glyph | undefined, source: Glyph | undefined) {
    return this.commitBatch([{ id, glyph, source }]);
  }
  commitBatch(edits: GlyphEdit[]) {
    const ids = new Set<string>(),
      changes: Change[] = [];
    const createdBefore = [...this.state.created],
      created = new Set(createdBefore);
    for (const edit of edits) {
      const { id, glyph, source } = edit;
      if (ids.has(id)) throw new Error(`Повторний гліф у пакеті: ${id}`);
      ids.add(id);
      if (glyph && glyph.id !== id) throw new Error("Невідповідний ID гліфа");
      const before = this.state.edits[id];
      const after =
        glyph && JSON.stringify(glyph) !== JSON.stringify(source)
          ? structuredClone(glyph)
          : undefined;
      const derivationBefore = this.state.derivations?.[id];
      const derivationAfter = after
        ? (edit.derivation ?? derivationBefore)
        : undefined;
      if (
        JSON.stringify(before) === JSON.stringify(after) &&
        JSON.stringify(derivationBefore) === JSON.stringify(derivationAfter)
      )
        continue;
      changes.push(
        structuredClone({
          id,
          before,
          after,
          derivationBefore,
          derivationAfter,
        }),
      );
      if (!source) {
        if (after) created.add(id);
        else created.delete(id);
      }
    }
    if (!changes.length) return false;
    const change: Transaction = {
      changes,
      createdBefore,
      createdAfter: [...created],
      bytes: 0,
    };
    change.bytes = JSON.stringify(change).length * 2;
    // Never apply an un-undoable large batch.
    if (change.bytes > 8 * 1024 * 1024)
      throw new Error("Пакет перевищує 8 MiB історії undo");
    this.undoStack.push(change);
    this.historyBytes += change.bytes;
    this.redoStack = [];
    while (this.undoStack.length > 128 || this.historyBytes > 8 * 1024 * 1024)
      this.historyBytes -= this.undoStack.shift()!.bytes;
    this.apply(change, true);
    return true;
  }
  private apply(transaction: Transaction, forward: boolean) {
    const invalid = new Set<string>();
    for (const change of transaction.changes) {
      const value = forward ? change.after : change.before;
      if (value) this.state.edits[change.id] = structuredClone(value);
      else delete this.state.edits[change.id];
      const derivation = forward
        ? change.derivationAfter
        : change.derivationBefore;
      if (derivation)
        (this.state.derivations ??= {})[change.id] =
          structuredClone(derivation);
      else if (this.state.derivations) delete this.state.derivations[change.id];
      invalid.add(change.id);
      for (const glyph of [change.before, change.after])
        for (const label of glyph?.labels ?? [])
          if (label.kind === "unicode" && [...label.value].length === 1)
            invalid.add(codepoint(label.value));
    }
    this.state.created = [
      ...(forward ? transaction.createdAfter : transaction.createdBefore),
    ];
    this.state.reviewed = this.state.reviewed.filter(
      (key) => !invalid.has(key),
    );
    this.state.done = false;
    this.touch();
  }
  undo() {
    const c = this.undoStack.pop();
    if (!c) return;
    this.historyBytes -= c.bytes;
    this.redoStack.push(c);
    this.apply(c, false);
    return c.changes[0].id;
  }
  redo() {
    const c = this.redoStack.pop();
    if (!c) return;
    this.undoStack.push(c);
    this.historyBytes += c.bytes;
    this.apply(c, true);
    return c.changes[0].id;
  }
  review(key: string, value = true) {
    const set = new Set(this.state.reviewed);
    if (value) set.add(key);
    else set.delete(key);
    this.state.reviewed = [...set];
    this.touch();
  }
  nextID(sourceCount: number) {
    return (
      "g" +
      String(
        Math.max(
          sourceCount - 1,
          ...this.state.created.map((id) => Number(id.slice(1))),
        ) + 1,
      ).padStart(6, "0")
    );
  }
}
export function resized(glyph: Glyph, width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 0 ||
    height < 0 ||
    width > 1024 ||
    height > 1024 ||
    width * height > 262144
  )
    throw new Error("Розмір: 0–1024, не більше 262 144 пікселів");
  const pixels = unpack(glyph),
    next = new Uint8Array(width * height);
  for (let y = 0; y < Math.min(height, glyph.height); y++)
    for (let x = 0; x < Math.min(width, glyph.width); x++)
      next[y * width + x] = pixels[y * glyph.width + x];
  return {
    ...structuredClone(glyph),
    width,
    height,
    rowBytes: Math.ceil(width / 8),
    rows: pack(next, width, height),
    metrics: {
      ...glyph.metrics,
      shiftUp: glyph.metrics.shiftUp + glyph.height - height,
      rightBearing: glyph.advanceX - glyph.metrics.leftBearing - width,
    },
  };
}
export function transformed(glyph: Glyph, operation: string) {
  if (["rotate90", "rotate180", "rotate270"].includes(operation)) {
    const quarter = operation !== "rotate180";
    const width = quarter ? glyph.height : glyph.width;
    const height = quarter ? glyph.width : glyph.height;
    const source = unpack(glyph),
      pixels = new Uint8Array(source.length);
    for (let y = 0; y < glyph.height; y++)
      for (let x = 0; x < glyph.width; x++) {
        const nx =
          operation === "rotate90"
            ? glyph.height - 1 - y
            : operation === "rotate270"
              ? y
              : glyph.width - 1 - x;
        const ny =
          operation === "rotate90"
            ? x
            : operation === "rotate270"
              ? glyph.width - 1 - x
              : glyph.height - 1 - y;
        pixels[ny * width + nx] = source[y * glyph.width + x];
      }
    // Keep the raster centered in its advance cell; inverse turns restore metrics.
    const dx = quarter ? (glyph.width - width) / 2 : 0;
    const dy = quarter ? (glyph.height - height) / 2 : 0;
    const leftBearing = glyph.metrics.leftBearing + dx;
    return {
      ...structuredClone(glyph),
      width,
      height,
      rowBytes: Math.ceil(width / 8),
      rows: pack(pixels, width, height),
      metrics: {
        ...glyph.metrics,
        leftBearing,
        rightBearing: glyph.metrics.rightBearing + glyph.width - width - dx,
        shiftUp: glyph.metrics.shiftUp + dy,
      },
    };
  }
  const { width: w, height: h } = glyph,
    source = unpack(glyph),
    out = new Uint8Array(source.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sx = x,
        sy = y;
      if (operation === "flip-x") sx = w - 1 - x;
      if (operation === "flip-y") sy = h - 1 - y;
      if (operation === "left") sx++;
      if (operation === "right") sx--;
      if (operation === "up") sy++;
      if (operation === "down") sy--;
      const value =
        sx >= 0 && sx < w && sy >= 0 && sy < h ? source[sy * w + sx] : 0;
      out[y * w + x] =
        operation === "clear" ? 0 : operation === "invert" ? 1 - value : value;
    }
  return { ...structuredClone(glyph), rows: pack(out, w, h) };
}
export function effectiveIndex(base: Record<string, number[]>, state: Draft) {
  const index = new Map<string, string[]>();
  for (const [char, values] of Object.entries(base))
    index.set(
      char,
      values
        .map((i) => "g" + String(i).padStart(6, "0"))
        .filter((id) => !state.edits[id]),
    );
  for (const glyph of Object.values(state.edits))
    for (const label of glyph.labels)
      if (label.kind === "unicode")
        index.set(label.value, [...(index.get(label.value) ?? []), glyph.id]);
  for (const [char, ids] of index) index.set(char, [...new Set(ids)].sort());
  return index;
}
export function coverage(glyphs: Glyph[]) {
  const mapped = glyphs.filter((g) =>
    g.labels.some((l) => l.kind === "unicode"),
  );
  const present = new Set(
    mapped
      .filter((g) => g.rows.some((row) => /[1-9A-Fa-f]/.test(row)))
      .flatMap((g) =>
        g.labels.filter((l) => l.kind === "unicode").map((l) => l.value),
      ),
  );
  const missing = UKRAINIAN.filter((c) => !present.has(c));
  return {
    glyphCount: glyphs.length,
    unicodeGlyphCount: mapped.length,
    unmappedGlyphCount: glyphs.length - mapped.length,
    ukrainian: {
      required: 66,
      present: mapped.length ? 66 - missing.length : null,
      missing: mapped.length ? missing : null,
      complete: mapped.length ? !missing.length : null,
    },
  };
}
export function exportRecord(base: FontRecord, state: Draft): FontRecord {
  const glyphs = (base.glyphs ?? []).map((g) =>
    structuredClone(state.edits[g.id] ?? g),
  );
  const exportedIDs = new Map(glyphs.map((g) => [g.id, g.id]));
  for (const id of state.created) {
    exportedIDs.set(id, "g" + String(glyphs.length).padStart(6, "0"));
    const glyph = state.edits[id];
    if (glyph)
      glyphs.push({
        ...structuredClone(glyph),
        id: "g" + String(glyphs.length).padStart(6, "0"),
      });
  }
  return {
    ...structuredClone(base),
    id: base.id.slice(0, 139) + "-edit-" + state.baseSha256.slice(0, 8),
    name: base.name + " · manual",
    version: `${base.version}-manual-${state.revision}`,
    kind: "derived",
    cell: {
      ...base.cell,
      width: Math.max(base.cell.width, ...glyphs.map((g) => g.width)),
      height: Math.max(base.cell.height, ...glyphs.map((g) => g.height)),
    },
    glyphs,
    coverage: coverage(glyphs),
    modifications: [
      ...base.modifications,
      {
        type: "manual-glyph-edit",
        tool: "Verba Glyph Editor 0.3",
        baseFontId: base.id,
        baseSha256: state.baseSha256,
        sourceSnapshot: state.snapshot,
        updatedAt: state.updatedAt,
        modifiedGlyphIds: Object.keys(state.edits),
        addedDraftGlyphIds: state.created,
        notes: state.notes,
        derivations: Object.entries(state.derivations ?? {}).map(
          ([id, recipe]) => ({
            ...recipe,
            glyphId: exportedIDs.get(id) ?? id,
            sourceGlyphId:
              exportedIDs.get(recipe.sourceGlyphId) ?? recipe.sourceGlyphId,
            ...(recipe.components
              ? {
                  components: recipe.components.map((part) => ({
                    ...part,
                    sourceGlyphId:
                      exportedIDs.get(part.sourceGlyphId) ?? part.sourceGlyphId,
                  })),
                }
              : {}),
          }),
        ),
      },
    ],
  };
}
