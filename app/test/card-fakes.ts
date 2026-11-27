// Fake Nasinnia (FONTS) and UPA service bindings built from the recorded fixtures.
import glyphsFull from "./fixtures/glyphs-cozette-full.json";
import fontCozette from "./fixtures/font-cozette.json";
import fontMetadataOnly from "./fixtures/font-metadata-only.json";
import bandFixtures from "./fixtures/upa-band.json";
import { CARD_FRAMES } from "../src/card/ornament";

type ApiGlyph = { codepoint: string; character?: string; advanceX: number; missing?: boolean; bitmap: string[] };
const FULL = glyphsFull as { fontId: string; cell: { width: number; height: number }; glyphs: ApiGlyph[] };
const MISSING = FULL.glyphs.find((g) => g.missing)!;
const BY_CHAR = new Map(FULL.glyphs.filter((g) => !g.missing).map((g) => [g.character!, g]));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const urlOf = (input: RequestInfo | URL) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

// Nasinnia: cozette-13x15 serves glyphs (unknown chars come back as the missing glyph),
// hoard-acorn-bbc-bbc-micro is metadata-only (403 LICENSE_RESTRICTED), anything else 404.
export function fakeFonts(calls: string[] = []): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL) => {
      const u = urlOf(input);
      calls.push(u.pathname + u.search);
      const m = u.pathname.match(/^\/v1\/fonts\/([^/]+)(\/glyphs)?$/);
      const id = m ? decodeURIComponent(m[1]) : "";
      if (id === "cozette-13x15") {
        if (!m![2]) return json(fontCozette);
        const chars = [...new Set(Array.from(u.searchParams.get("chars") ?? ""))];
        const glyphs = chars.map((ch) => BY_CHAR.get(ch) ?? {
          ...MISSING, codepoint: "U+" + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"), character: undefined, missing: true,
        });
        return json({ fontId: FULL.fontId, representation: "bit-matrix", bitOrder: "msb-left", cell: FULL.cell, glyphs });
      }
      if (id === "verba-amstrad-pc") {
        if (!m![2]) return json({ id: "verba-amstrad-pc", displayName: "Amstrad PC · Verba", availability: "downloadable", cell: { width: 8, height: 8 }, license: { id: "CC-BY-SA-4.0", attribution: "VileR / Verba", redistributionAllowed: true } });
        const chars = [...new Set(Array.from(u.searchParams.get("chars") ?? ""))];
        const glyphs = chars.map((ch) => ({ codepoint: "U+" + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"), character: ch, advanceX: 8, bitmap: Array(8).fill("10101010") }));
        return json({ fontId: "verba-amstrad-pc", representation: "bit-matrix", cell: { width: 8, height: 8 }, glyphs });
      }
      if (id === "hoard-acorn-bbc-bbc-micro") {
        return m![2] ? json({ error: { code: "LICENSE_RESTRICTED", message: "metadata-only" } }, 403) : json(fontMetadataOnly);
      }
      return json({ error: { code: "FONT_NOT_FOUND", message: "Font not found." } }, 404);
    },
  } as unknown as Fetcher;
}

// UPA: fixture patterns by id; any curated frame id answers with the p08_L_b03 band.
const BANDS = bandFixtures as Record<string, any>;
export function fakeUpa(calls: string[] = []): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL) => {
      const u = urlOf(input);
      calls.push(u.pathname);
      const id = decodeURIComponent(u.pathname.replace(/^\/api\/v1\/patterns\//, ""));
      if (BANDS[id]) return json(BANDS[id]);
      if (CARD_FRAMES.includes(`non:${id}`)) return json({ ...BANDS["p08_L_b03"], pattern: { ...BANDS["p08_L_b03"].pattern, patternId: id } });
      return json({ error: { code: "not_found" } }, 404);
    },
  } as unknown as Fetcher;
}
export const broken = { fetch: async () => { throw new Error("binding down"); } } as unknown as Fetcher;

