/** Read-only corpus model shared by REST and GraphQL. No request state is global. */
import rawCatalog from "../../font-corpus/catalog.json";

import type {
  Glyph,
  FontSummary,
  FontRecord,
  Assets,
  FontFilter,
  GlyphFilter,
} from "./types";
export type {
  Glyph,
  FontSummary,
  FontRecord,
  Assets,
  FontFilter,
  GlyphFilter,
} from "./types";
export class CorpusError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const catalog = rawCatalog;
export const fonts: readonly FontSummary[] = rawCatalog.fonts;
const byId = new Map(fonts.map((font) => [font.id, font]));
export const limits = {
  fonts: 100,
  glyphs: 256,
  queryBytes: 32768,
  graphqlFields: 500,
  graphqlDepth: 10,
  graphqlFontLoads: 8,
  graphqlGlyphs: 1024,
};
export function summary(id: string): FontSummary {
  const font = byId.get(id);
  if (!font) throw new CorpusError("FONT_NOT_FOUND", "Unknown font ID", 404);
  return font;
}
export function integer(
  value: unknown,
  fallback: number,
  max: number,
  minimum = 0,
): number {
  if (value === undefined || value === null) return fallback;
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "string" && !/^\d+$/.test(value))
  )
    throw new CorpusError("INVALID_ARGUMENT", "Expected an integer");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > max)
    throw new CorpusError(
      "INVALID_ARGUMENT",
      `Integer must be between ${minimum} and ${max}`,
    );
  return number;
}
export function listFonts(filter: FontFilter = {}) {
  if (filter.snapshot && filter.snapshot !== catalog.snapshot)
    throw new CorpusError(
      "SNAPSHOT_CHANGED",
      "Restart pagination using the current snapshot",
      409,
    );
  if (filter.q && filter.q.length > 200)
    throw new CorpusError(
      "INVALID_ARGUMENT",
      "Search text exceeds 200 characters",
    );
  if (
    filter.availability &&
    !["raster", "metadata-only"].includes(filter.availability)
  )
    throw new CorpusError("INVALID_ARGUMENT", "Unknown availability");
  if (
    filter.ukrainian &&
    !["complete", "partial", "none", "unknown"].includes(filter.ukrainian)
  )
    throw new CorpusError(
      "INVALID_ARGUMENT",
      "Unknown Ukrainian coverage filter",
    );
  if (filter.collection && !["nasinnia", "texted"].includes(filter.collection))
    throw new CorpusError("INVALID_ARGUMENT", "Unknown source collection");
  const q = filter.q?.toLocaleLowerCase("uk") ?? "";
  const matches = fonts.filter((font) => {
    const ua = font.coverage.ukrainian;
    return (
      (!q ||
        `${font.id} ${font.name} ${font.family}`
          .toLocaleLowerCase("uk")
          .includes(q)) &&
      (!filter.availability || font.availability === filter.availability) &&
      (!filter.license || font.licenseId === filter.license) &&
      (!filter.collection ||
        (font.id.startsWith("texted-") ? "texted" : "nasinnia") ===
          filter.collection) &&
      (!filter.ukrainian ||
        (ua.present === null
          ? "unknown"
          : ua.complete
            ? "complete"
            : ua.present > 0
              ? "partial"
              : "none") === filter.ukrainian)
    );
  });
  const limit = integer(filter.limit, 50, limits.fonts, 1),
    offset = integer(filter.offset, 0, 100000);
  return {
    snapshot: catalog.snapshot,
    total: matches.length,
    limit,
    offset,
    nextOffset: offset + limit < matches.length ? offset + limit : null,
    nodes: matches.slice(offset, offset + limit),
  };
}
export async function readFont(
  id: string,
  assets: Assets,
): Promise<FontRecord> {
  const entry = summary(id);
  const response = await assets.fetch(`https://assets.local${entry.url}`);
  if (!response.ok)
    throw new CorpusError(
      "CORPUS_UNAVAILABLE",
      "The pinned font asset is unavailable",
      503,
    );
  return response.json<FontRecord>();
}
export function glyphPage(font: FontRecord, filter: GlyphFilter = {}) {
  if (font.glyphs === null)
    throw new CorpusError(
      "RASTER_UNAVAILABLE",
      "This record contains metadata only",
      409,
    );
  const requested =
    filter.chars === undefined ? null : [...new Set([...filter.chars])];
  if (requested && requested.length > limits.glyphs)
    throw new CorpusError("INVALID_ARGUMENT", "Too many requested characters");
  const selection = requested ? new Set(requested) : null;
  const matches = selection
    ? font.glyphs.filter((g) => selection.has(g.character))
    : font.glyphs;
  const present = new Set(matches.map((g) => g.character));
  const limit = integer(filter.limit, 128, limits.glyphs, 1),
    offset = integer(filter.offset, 0, 65536);
  return {
    fontId: font.id,
    snapshot: catalog.snapshot,
    total: matches.length,
    limit,
    offset,
    nextOffset: offset + limit < matches.length ? offset + limit : null,
    missing: requested?.filter((c) => !present.has(c)) ?? [],
    nodes: matches.slice(offset, offset + limit),
  };
}
export function oneGlyph(font: FontRecord, codepoint: string): Glyph {
  if (!/^U\+[0-9A-Fa-f]{4,6}$/.test(codepoint))
    throw new CorpusError(
      "INVALID_ARGUMENT",
      "Use a Unicode scalar such as U+0490",
    );
  const cp = parseInt(codepoint.slice(2), 16);
  if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
    throw new CorpusError("INVALID_ARGUMENT", "Invalid Unicode scalar");
  if (font.glyphs === null)
    throw new CorpusError(
      "RASTER_UNAVAILABLE",
      "This record contains metadata only",
      409,
    );
  const found = font.glyphs.find(
    (g) => g.character === String.fromCodePoint(cp),
  );
  if (!found)
    throw new CorpusError(
      "GLYPH_NOT_FOUND",
      "This font does not contain the requested scalar",
      404,
    );
  return found;
}
