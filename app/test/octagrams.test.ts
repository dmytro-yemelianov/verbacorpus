import { describe, it, expect } from "vitest";
import { octagramField, octagramAc } from "../src/shader/octagrams";

describe("octagrams CPU shader", () => {
  it("octagramAc returns a finite, non-negative accumulation", () => {
    const v = octagramAc(15, 8, 30, 16, 3.5, 48);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it("octagramField has the requested dimensions", () => {
    const gw = 30, gh = 16;
    const f = octagramField(gw, gh, { steps: 32 });
    expect(f.length).toBe(gw * gh);
  });

  it("field is normalized to [0,1] with max ~1", () => {
    const f = octagramField(30, 16, { steps: 48 });
    let min = Infinity, max = -Infinity;
    for (const v of f) { if (v < min) min = v; if (v > max) max = v; }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1.0000001);
    expect(max).toBeGreaterThan(0.99); // normalized by its own max
  });

  it("is deterministic for the same inputs", () => {
    const a = octagramField(20, 12, { time: 3.5, steps: 32 });
    const b = octagramField(20, 12, { time: 3.5, steps: 32 });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("has structure (not a flat field)", () => {
    const f = octagramField(30, 16, { steps: 48 });
    const mean = f.reduce((s, v) => s + v, 0) / f.length;
    let variance = 0;
    for (const v of f) variance += (v - mean) * (v - mean);
    variance /= f.length;
    expect(variance).toBeGreaterThan(0.001); // there is contrast in the pattern
  });
});
