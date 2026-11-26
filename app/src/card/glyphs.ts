import { upstreamSignal } from "../upstream";
// Bitmap glyphs from the Nasinnia font API (reached through the FONTS service binding).

export interface Glyph {
  advanceX: number;
  rows: string[]; // bit-matrix: cell.height strings of "0"/"1", cell.width long
}

export interface GlyphSet {
  fontId: string;
  cell: { width: number; height: number };
  glyphs: Map<string, Glyph>;
  fallback: Glyph;
}

export type CardFontErrorCode = "font_restricted" | "font_unavailable";

export class CardFontError extends Error {
  constructor(public code: CardFontErrorCode, message?: string, public status = code === "font_restricted" ? 403 : 502) {
    super(message ?? code);
    this.name = "CardFontError";
  }
}

interface ApiGlyph {
  codepoint: string;
  character?: string;
  advanceX: number;
  missing?: boolean;
  bitmap: string[];
}

export async function fetchGlyphs(fonts: Fetcher, fontId: string, text: string): Promise<GlyphSet> {
  const chars = [...new Set(Array.from(text))].join("");
  const url =
    `https://upstream/v1/fonts/${encodeURIComponent(fontId)}/glyphs?chars=${encodeURIComponent(chars)}` +
    `&representation=bit-matrix&includeMissing=true`;
  let res: Response;
  try {
    res = await fonts.fetch(url, { signal: upstreamSignal() });
  } catch (e) {
    throw new CardFontError("font_unavailable", String(e));
  }
  if (res.status === 403) {
    let code: string | undefined;
    try { code = ((await res.json()) as any)?.error?.code; } catch { /* not JSON */ }
    if (code === "LICENSE_RESTRICTED") throw new CardFontError("font_restricted");
    throw new CardFontError("font_unavailable", `font API 403 (${code ?? "unknown"})`);
  }
  if (!res.ok) throw new CardFontError("font_unavailable", `font API ${res.status}`);
  let body: { fontId?: string; cell: { width: number; height: number }; glyphs: ApiGlyph[] };
  try {
    body = (await res.json()) as typeof body;
  } catch (e) {
    throw new CardFontError("font_unavailable", "invalid font API response");
  }
  const glyphs = new Map<string, Glyph>();
  let fallback: Glyph | null = null;
  for (const g of body.glyphs) {
    const glyph = { advanceX: g.advanceX, rows: g.bitmap };
    if (g.missing) { fallback ??= glyph; continue; }
    const ch = g.character ?? String.fromCodePoint(parseInt(g.codepoint.slice(2), 16));
    glyphs.set(ch, glyph);
  }
  // No missing glyph in this text: borrow "?" (the API's usual fallback), else an empty cell.
  fallback ??= glyphs.get("?") ?? { advanceX: Math.ceil(body.cell.width / 2), rows: Array(body.cell.height).fill("0".repeat(body.cell.width)) };
  return { fontId: body.fontId ?? fontId, cell: body.cell, glyphs, fallback };
}
