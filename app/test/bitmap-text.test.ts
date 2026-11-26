import { describe, it, expect } from "vitest";
import fixture from "./fixtures/glyphs-cozette.json";
import { fetchGlyphs, layoutText, paintText, CardFontError } from "../src/card/bitmap-text";
import type { GlyphSet } from "../src/card/bitmap-text";

// Real Nasinnia cozette-13x15 response (trimmed), parsed through fetchGlyphs itself.
const fakeFonts = (status = 200, body: unknown = fixture) => {
  const calls: string[] = [];
  const f = { fetch: async (u: string) => { calls.push(String(u)); return new Response(JSON.stringify(body), { status }); } } as unknown as Fetcher;
  return { f, calls };
};
const load = async (text = "Горе море") => fetchGlyphs(fakeFonts().f, "cozette-13x15", text);

const PROVERB = "Горе море, а без табу ’…? Не все те золото, що блищить, і не кожен той друг, хто усміхається. Гарна пісня не має кінця, а добре слово варте більше за гроші."; // ~160 chars
const OPTS = { maxScale: 6, minScale: 2 as const, lineGap: 1 };

describe("fetchGlyphs", () => {
  it("makes one request with each unique char once", async () => {
    const { f, calls } = fakeFonts();
    const g = await fetchGlyphs(f, "cozette-13x15", "Горе море");
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]);
    expect(u.origin + u.pathname).toBe("https://upstream/v1/fonts/cozette-13x15/glyphs");
    expect(u.searchParams.get("representation")).toBe("bit-matrix");
    expect(u.searchParams.get("includeMissing")).toBe("true");
    const chars = [...u.searchParams.get("chars")!];
    expect(chars.sort().join("")).toBe([...new Set("Горе море")].sort().join(""));
    expect(g.cell).toEqual({ width: 13, height: 15 });
    expect(g.glyphs.get("Г")!.rows).toHaveLength(15);
  });
  it("403 LICENSE_RESTRICTED -> font_restricted", async () => {
    const { f } = fakeFonts(403, { error: { code: "LICENSE_RESTRICTED" } });
    await expect(fetchGlyphs(f, "x", "a")).rejects.toMatchObject({ code: "font_restricted" });
    await expect(fetchGlyphs(f, "x", "a")).rejects.toBeInstanceOf(CardFontError);
  });
  it("5xx and network errors -> font_unavailable", async () => {
    await expect(fetchGlyphs(fakeFonts(503, {}).f, "x", "a")).rejects.toMatchObject({ code: "font_unavailable" });
    const boom = { fetch: async () => { throw new Error("net"); } } as unknown as Fetcher;
    await expect(fetchGlyphs(boom, "x", "a")).rejects.toMatchObject({ code: "font_unavailable" });
  });
  it("takes the fallback from the missing glyph", async () => {
    const g = await load();
    expect(g.glyphs.has("🍆")).toBe(false);
    expect(g.fallback.rows).toHaveLength(15);
    expect(g.fallback.rows.some(r => r.includes("1"))).toBe(true);
  });
});

describe("layoutText", () => {
  const widthOK = (g: GlyphSet, lines: string[], scale: number, w: number) =>
    lines.every(l => Array.from(l).reduce((a, ch) => a + (g.glyphs.get(ch) ?? g.fallback).advanceX * scale, 0) <= w);
  // Glyph set where every char is the fallback (advance 6), enough for width math.
  const gs = async () => load();

  it("large box gives scale >= 3 and every line fits", async () => {
    const g = await gs();
    expect(PROVERB.length).toBeGreaterThanOrEqual(150);
    const l = layoutText(PROVERB, g, { width: 920, height: 600 }, OPTS);
    expect(l.scale).toBeGreaterThanOrEqual(3);
    expect(l.truncated).toBe(false);
    expect(widthOK(g, l.lines, l.scale, 920)).toBe(true);
  });
  it("small box falls to scale 2; overflow is truncated with an ellipsis", async () => {
    const g = await gs();
    const small = layoutText(PROVERB, g, { width: 440, height: 300 }, OPTS);
    expect(small.scale).toBe(2);
    const long = layoutText(PROVERB.repeat(3), g, { width: 440, height: 300 }, OPTS);
    expect(long.scale).toBe(2);
    expect(long.truncated).toBe(true);
    expect(long.lines.at(-1)!.endsWith("…")).toBe(true);
    expect(widthOK(g, long.lines, 2, 440)).toBe(true);
  });
  it("empty text gives no lines", async () => {
    expect(layoutText("", await gs(), { width: 920, height: 600 }, OPTS).lines).toHaveLength(0);
  });
});

describe("paintText", () => {
  it("draws fallback pixels for missing chars and does not throw", async () => {
    const g = await load("Горе 🍆");
    const W = 64, H = 40;
    const rgba = new Uint8Array(W * H * 4);
    const layout = layoutText("🍆", g, { width: W, height: H }, { maxScale: 2, minScale: 2, lineGap: 0 });
    expect(() => paintText(rgba, W, H, layout, g, { x: 0, y: 0 }, "left", [10, 20, 30])).not.toThrow();
    const lit = new Set<number>();
    for (let i = 0; i < W * H; i++) if (rgba[i * 4 + 3] === 255) lit.add(i);
    const expected = g.fallback.rows.flatMap(r => [...r]).filter(c => c === "1").length * 4;
    expect(lit.size).toBe(expected);
    expect([...rgba.slice(0, 0)]).toEqual([]);
    const first = [...lit][0] * 4;
    expect([rgba[first], rgba[first + 1], rgba[first + 2]]).toEqual([10, 20, 30]);
  });
  it("centers and clips safely at the buffer edge", async () => {
    const g = await load("Горе");
    const rgba = new Uint8Array(30 * 20 * 4);
    const layout = layoutText("Горе", g, { width: 30, height: 20 }, { maxScale: 2, minScale: 2, lineGap: 0 });
    expect(() => paintText(rgba, 30, 20, layout, g, { x: 28, y: -5 }, "center", [255, 255, 255])).not.toThrow();
  });
});
