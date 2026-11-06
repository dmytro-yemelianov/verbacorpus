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
  glyphBytes: 8 * 1024 * 1024,
  glyphPageLoads: 128,
};
// Immutable lookup/sort data is prepared once, never rebuilt per search request.
const searchable = new Map(
  fonts.map((f) => [
    f.id,
    `${f.id} ${f.name} ${f.family}`.normalize("NFKC").toLocaleLowerCase("uk"),
  ]),
);
const orders = new Map<string, readonly FontSummary[]>([["id", fonts]]);
const collator = new Intl.Collator("uk", { numeric: true });
for (const key of ["name", "width", "height", "glyphs", "ukrainian"]) {
  orders.set(
    key,
    [...fonts].sort((a, b) => {
      const delta =
        key === "name"
          ? collator.compare(a.name, b.name)
          : key === "glyphs"
            ? b.coverage.glyphCount - a.coverage.glyphCount
            : key === "ukrainian"
              ? (b.coverage.ukrainian.present ?? -1) -
                (a.coverage.ukrainian.present ?? -1)
              : a.cell[key as "width" | "height"] -
                b.cell[key as "width" | "height"];
      return delta || a.id.localeCompare(b.id);
    }),
  );
}
function facet(values: (string | number)[]) {
  const counts = new Map<string | number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) =>
      typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b)),
    )
    .map(([value, count]) => ({ value, count }));
}
export const filterFacets = {
  snapshot: catalog.snapshot,
  collections: facet(fonts.map((f) => f.collection)),
  licenses: facet(fonts.map((f) => f.licenseId)),
  widths: facet(fonts.map((f) => f.cell.width)),
  heights: facet(fonts.map((f) => f.cell.height)),
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
  if (
    filter.collection &&
    !["nasinnia", "texted", "hoard"].includes(filter.collection)
  )
    throw new CorpusError("INVALID_ARGUMENT", "Unknown source collection");
  if (filter.spacing && !["monospace", "proportional"].includes(filter.spacing))
    throw new CorpusError("INVALID_ARGUMENT", "Unknown spacing");
  const ordered = orders.get(filter.sort || "id");
  if (!ordered) throw new CorpusError("INVALID_ARGUMENT", "Unknown sort order");
  const width = filter.width == null ? null : integer(filter.width, 0, 4096, 1);
  const height =
    filter.height == null ? null : integer(filter.height, 0, 4096, 1);
  const terms = (filter.q ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("uk")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const matches = ordered.filter((font) => {
    const ua = font.coverage.ukrainian;
    return (
      terms.every((term) => searchable.get(font.id)!.includes(term)) &&
      (width === null || font.cell.width === width) &&
      (height === null || font.cell.height === height) &&
      (!filter.spacing ||
        font.cell.monospace === (filter.spacing === "monospace")) &&
      (!filter.availability || font.availability === filter.availability) &&
      (!filter.license || font.licenseId === filter.license) &&
      (!filter.collection || font.collection === filter.collection) &&
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
export interface ReadBudget {
  bytes: number;
  pages: number;
}
export const readBudget = (): ReadBudget => ({
  bytes: limits.glyphBytes,
  pages: limits.glyphPageLoads,
});
export interface FontHandle {
  record: Omit<FontRecord, "glyphs">;
  pages: {
    file: string;
    bytes: number;
    sha256: string;
    offset: number;
    count: number;
  }[];
  unicodeIndex: Record<string, number[]>;
  assets: Assets;
  budget: ReadBudget;
  cache: Map<number, Promise<Glyph[]>>;
}
function reserve(budget: ReadBudget, bytes: number) {
  budget.bytes -= bytes;
  if (budget.bytes < 0)
    throw new CorpusError(
      "QUERY_LIMIT",
      "Native glyph data exceeds the request budget",
      413,
    );
}
export async function readFont(
  id: string,
  assets: Assets,
  budget = readBudget(),
): Promise<FontHandle> {
  const entry = summary(id);
  reserve(budget, entry.metaBytes);
  const response = await assets.fetch("https://assets.local" + entry.metaUrl);
  if (!response.ok)
    throw new CorpusError(
      "CORPUS_UNAVAILABLE",
      "The native font index is unavailable",
      503,
    );
  const data = await response.json<{
    font: Omit<FontRecord, "glyphs">;
    pages: FontHandle["pages"];
    unicodeIndex: Record<string, number[]>;
  }>();
  return {
    record: data.font,
    pages: data.pages,
    unicodeIndex: data.unicodeIndex,
    assets,
    budget,
    cache: new Map(),
  };
}
async function nativePage(font: FontHandle, index: number): Promise<Glyph[]> {
  let pending = font.cache.get(index);
  if (pending) return pending;
  const page = font.pages[index];
  if (!page)
    throw new CorpusError(
      "CORPUS_UNAVAILABLE",
      "Missing native glyph page",
      503,
    );
  if (--font.budget.pages < 0)
    throw new CorpusError(
      "QUERY_LIMIT",
      "Too many native glyph pages requested",
      413,
    );
  reserve(font.budget, page.bytes);
  pending = (async () => {
    const response = await font.assets.fetch(
      `https://assets.local/para/corpus/${catalog.snapshot}/${page.file}`,
    );
    if (!response.ok)
      throw new CorpusError(
        "CORPUS_UNAVAILABLE",
        "The native glyph page is unavailable",
        503,
      );
    return response.json<Glyph[]>();
  })();
  font.cache.set(index, pending);
  return pending;
}
async function glyphsAt(font: FontHandle, indices: number[]): Promise<Glyph[]> {
  const pages = [...new Set(indices.map((i) => Math.floor(i / 128)))];
  // Bounded concurrent reads; aliases in one GraphQL request reuse page promises.
  for (let start = 0; start < pages.length; start += 8)
    await Promise.all(
      pages.slice(start, start + 8).map((i) => nativePage(font, i)),
    );
  const results: Glyph[] = [];
  for (const i of indices)
    results.push((await nativePage(font, Math.floor(i / 128)))[i % 128]);
  return results;
}
export async function glyphPage(font: FontHandle, filter: GlyphFilter = {}) {
  const requested =
    filter.chars === undefined ? null : [...new Set([...filter.chars])];
  if (requested && requested.length > limits.glyphs)
    throw new CorpusError("INVALID_ARGUMENT", "Too many requested characters");
  const indices = requested
    ? [...new Set(requested.flatMap((c) => font.unicodeIndex[c] ?? []))].sort(
        (a, b) => a - b,
      )
    : null;
  const total = indices?.length ?? font.record.coverage.glyphCount;
  const limit = integer(filter.limit, 128, limits.glyphs, 1),
    offset = integer(filter.offset, 0, 65536);
  const selected = indices
    ? indices.slice(offset, offset + limit)
    : Array.from(
        { length: Math.max(0, Math.min(limit, total - offset)) },
        (_, i) => offset + i,
      );
  return {
    fontId: font.record.id,
    snapshot: catalog.snapshot,
    total,
    limit,
    offset,
    nextOffset: offset + limit < total ? offset + limit : null,
    missing: requested?.filter((c) => !font.unicodeIndex[c]) ?? [],
    nodes: await glyphsAt(font, selected),
  };
}
export async function oneGlyph(
  font: FontHandle,
  codepoint: string,
): Promise<Glyph> {
  if (!/^U\+[0-9A-Fa-f]{4,6}$/.test(codepoint))
    throw new CorpusError(
      "INVALID_ARGUMENT",
      "Use a Unicode scalar such as U+0490",
    );
  const cp = parseInt(codepoint.slice(2), 16);
  if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
    throw new CorpusError("INVALID_ARGUMENT", "Invalid Unicode scalar");
  const index = font.unicodeIndex[String.fromCodePoint(cp)]?.[0];
  if (index === undefined)
    throw new CorpusError(
      "GLYPH_NOT_FOUND",
      "No native glyph has this Unicode mapping",
      404,
    );
  return (await glyphsAt(font, [index]))[0];
}
export async function glyphById(font: FontHandle, id: string): Promise<Glyph> {
  if (!/^g[0-9]{6}$/.test(id))
    throw new CorpusError(
      "INVALID_ARGUMENT",
      "Use a stable native glyph ID such as g000000",
    );
  const index = Number(id.slice(1));
  if (index >= font.record.coverage.glyphCount)
    throw new CorpusError("GLYPH_NOT_FOUND", "Unknown native glyph ID", 404);
  return (await glyphsAt(font, [index]))[0];
}
