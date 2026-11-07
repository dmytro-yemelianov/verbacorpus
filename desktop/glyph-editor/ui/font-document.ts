import {
  Document as GlyphDocument,
  newDraft,
  effectiveIndex,
  type Draft,
  type FontSummary,
  type Glyph,
  blankGlyph,
} from "./model";
import {
  NativeFont,
  type FontAssetCache,
} from "../../../app/src/client/font-data";
import { frameOrdinals, normalizeCell, type FontCell } from "./monospace";
import type { GlyphSlot } from "./regions";

export interface GlyphSelection {
  glyph: Glyph | undefined;
  original: Glyph | undefined;
  rawOriginal: Glyph | undefined;
}
export async function readGlyphSelection(
  resource: FontDocument,
  slot: GlyphSlot,
  cell: FontCell,
  blankFont: FontSummary,
): Promise<GlyphSelection> {
  const { document, summary, face } = resource;
  const id = slot.id ?? document.nextID(summary.coverage.glyphCount);
  const edited = document.state.edits[id];
  const rawOriginal =
    Number(id.slice(1)) < summary.coverage.glyphCount
      ? (await face.glyphs([Number(id.slice(1))]))[0]
      : undefined;
  const original = rawOriginal ? normalizeCell(rawOriginal, cell) : undefined;
  const glyph = edited
    ? normalizeCell(edited, cell)
    : original
      ? structuredClone(original)
      : !slot.id && slot.char
        ? blankGlyph(blankFont, id, slot.char)
        : undefined;
  return { glyph, original, rawOriginal };
}
import { ukrainianCoverage } from "./font-coverage";
import { latinReferences } from "./latin-references";

export interface FontDocument {
  summary: FontSummary;
  face: NativeFont;
  document: GlyphDocument;
  samples: Glyph[];
}
export async function loadFontDocument(
  id: string,
  signal: AbortSignal,
  options: {
    snapshot: string;
    cache: FontAssetCache;
    summary: (id: string) => Promise<FontSummary>;
    state: (id: string) => Promise<Draft | null>;
  },
): Promise<FontDocument> {
  const [summary, state] = await Promise.all([
    options.summary(id),
    options.state(id),
  ]);
  signal.throwIfAborted();
  const face = await NativeFont.open(summary, options.cache, signal);
  const samples = await face.glyphs(
    frameOrdinals(summary.coverage.glyphCount, face.index.unicodeIndex),
  );
  signal.throwIfAborted();
  return {
    summary,
    face,
    samples,
    document: new GlyphDocument(state ?? newDraft(summary, options.snapshot)),
  };
}
export async function prepareDraft(state: Draft, resource: FontDocument) {
  const { face, summary } = resource;
  const source = async (id: string) =>
    Number(id.slice(1)) < summary.coverage.glyphCount
      ? (await face.glyphs([Number(id.slice(1))]))[0]
      : undefined;
  state.ukrainianCoverage = await ukrainianCoverage(
    state,
    face.index.unicodeIndex,
    source,
  );
  const index = effectiveIndex(face.index.unicodeIndex, state);
  const glyphs = await Promise.all(
    [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"]
      .flatMap((c) => index.get(c) ?? [])
      .map((id) => state.edits[id] ?? source(id)),
  );
  state.latinReferences = {
    ...latinReferences(glyphs.filter((g): g is Glyph => !!g)),
    checkedRevision: state.revision,
  };
}
