import { describe, it, expect } from "vitest";
import { FontAssetCache, NativeFont } from "../src/client/font-data";
import { paintSpecimen, GlyphPainter } from "../src/client/font-painter";
import { catalog } from "../src/para/corpus";
import type { Glyph } from "../src/para/types";

describe("font viewer bounded native data", () => {
  it("deduplicates concurrent reads, reuses data and evicts least recently used JSON", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async (input) => {
      calls++;
      return new Response(JSON.stringify({ value: String(input) }));
    };
    const cache = new FontAssetCache(100, fetcher),
      signal = new AbortController().signal;
    const [a, b] = await Promise.all([
      cache.get("/a", signal),
      cache.get("/a", signal),
    ]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    await cache.get("/b", signal);
    await cache.get("/c", signal);
    await cache.get("/a", signal);
    await cache.get("/d", signal);
    expect(cache.bytes).toBeLessThanOrEqual(100);
    expect(calls).toBe(4);
    await cache.get("/b", signal);
    expect(calls).toBe(5);
  });
  it("keeps at most four fetches active and removes aborted queued work", async () => {
    let active = 0,
      peak = 0,
      calls = 0;
    const pending: (() => void)[] = [];
    const fetcher: typeof fetch = async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active--;
      return new Response("{}");
    };
    const cache = new FontAssetCache(1000, fetcher),
      controller = new AbortController();
    const reads = Array.from({ length: 8 }, (_, i) =>
      cache.get("/" + i, controller.signal),
    );
    const settled = Promise.allSettled(reads);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(4);
    controller.abort();
    for (const resolve of pending) resolve();
    expect(
      (await settled).every((result) => result.status === "rejected"),
    ).toBe(true);
    expect(peak).toBe(4);
    expect(calls).toBe(4);
    const retry = cache.get("/0", new AbortController().signal);
    await Promise.resolve();
    await Promise.resolve();
    pending.at(-1)!();
    await retry;
    expect(calls).toBe(5);
  });
  it("caps specimen allocation for every catalog font at desktop and mobile widths", () => {
    // Empty text needs no DOM/canvas drawing, but still allocates its line box.
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({}),
      setAttribute: () => {},
    } as HTMLCanvasElement;
    for (const font of catalog.fonts)
      for (const width of [320, 944, 2560])
        for (const zoom of [1, 4, 8]) {
          const result = paintSpecimen(
            canvas,
            font,
            new Map(),
            "",
            zoom,
            width,
            "#000",
            new GlyphPainter(),
          );
          expect(canvas.width * canvas.height).toBeLessThanOrEqual(2_000_000);
          expect(Number.isInteger(result.zoom)).toBe(true);
        }
  });
  it("keeps native ID and Unicode lookup distinct, and reads one page for grid plus text", async () => {
    const summary = catalog.fonts.find((f) => f.id === "texted-bios_8x8")!;
    const glyphs = [
      { id: "g000000", labels: [{ kind: "codepoint", value: "0x00" }] },
      { id: "g000001", labels: [{ kind: "unicode", value: "Ґ" }] },
    ] as Glyph[];
    let reads = 0;
    const fetcher: typeof fetch = async (input) => {
      reads++;
      return new Response(
        JSON.stringify(
          String(input).includes("/meta/")
            ? {
                font: { id: summary.id },
                unicodeIndex: { Ґ: [1] },
                pages: [{ file: "glyphs/test-0.json", offset: 0, count: 2 }],
              }
            : glyphs,
        ),
      );
    };
    const cache = new FontAssetCache(1_000_000, fetcher),
      font = await NativeFont.open(
        { ...summary, coverage: { ...summary.coverage, glyphCount: 2 } },
        cache,
        new AbortController().signal,
      );
    const [grid, text] = await Promise.all([
      font.glyphs([0, 1]),
      font.text("ҐҐ🦔"),
    ]);
    expect(reads).toBe(2);
    expect(grid).toEqual(glyphs);
    expect(text.byChar.get("Ґ")).toBe(grid[1]);
    expect(text.missing).toEqual(["🦔"]);
    expect(font.indices("unmapped")).toEqual([0]);
    expect(font.indices("mapped")).toEqual([1]);
    expect(font.lookup("g000000")).toBe(0);
    expect(font.lookup("g999999")).toBeUndefined();
    expect(font.lookup("U+0490")).toBe(1);
    expect(font.lookup("Ґ")).toBe(1);
    expect(font.lookup("U+D800")).toBeUndefined();
    expect(font.lookup("U+110000")).toBeUndefined();
  });
});
