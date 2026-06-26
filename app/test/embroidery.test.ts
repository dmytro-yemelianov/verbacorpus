import { describe, it, expect } from "vitest";
import { BORDERS, pickBorder, paintBorders } from "../src/shader/embroidery";

const CREAM = "244,241,232", RED = "180,35,42", BLACK = "26,26,26";

describe("UPA embroidery borders", () => {
  it("every border is well-formed: rectangular grid, only . R B symbols", () => {
    expect(BORDERS.length).toBeGreaterThan(0);
    for (const b of BORDERS) {
      expect(b.cells.length).toBe(b.rows);
      for (const row of b.cells) {
        expect(row.length).toBe(b.cols);
        expect(/^[.RB]+$/.test(row)).toBe(true);
      }
    }
  });

  it("pickBorder is deterministic and in-range", () => {
    expect(pickBorder("p1")).toBe(pickBorder("p1"));
    expect(BORDERS).toContain(pickBorder("p000042"));
  });

  it("paints only cream/red/black into the bands and leaves the center cream", () => {
    const W = 80, H = 80, band = 16;
    const rgba = new Uint8Array(W * H * 4);
    for (let o = 0; o < rgba.length; o += 4) { rgba[o] = 244; rgba[o + 1] = 241; rgba[o + 2] = 232; rgba[o + 3] = 255; }
    paintBorders(rgba, W, H, band, BORDERS[0], 0);
    const at = (x: number, y: number) => `${rgba[(y * W + x) * 4]},${rgba[(y * W + x) * 4 + 1]},${rgba[(y * W + x) * 4 + 2]}`;
    const allowed = new Set([CREAM, RED, BLACK]);
    for (let x = 0; x < W; x++) {
      expect(allowed.has(at(x, 0))).toBe(true);        // top band
      expect(allowed.has(at(x, H - 1))).toBe(true);    // bottom band
    }
    expect(at(W / 2, H / 2)).toBe(CREAM);              // clean cream center
  });

  it("is seamless: phase 0 and phase 1 produce identical bands", () => {
    const W = 120, H = 60, band = 24;
    const a = new Uint8Array(W * H * 4), b = new Uint8Array(W * H * 4);
    for (const buf of [a, b]) for (let o = 0; o < buf.length; o += 4) { buf[o] = 244; buf[o + 1] = 241; buf[o + 2] = 232; buf[o + 3] = 255; }
    paintBorders(a, W, H, band, BORDERS[1], 0);
    paintBorders(b, W, H, band, BORDERS[1], 1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
