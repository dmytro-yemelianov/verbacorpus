import { describe, it, expect } from "vitest";
import { stitchRGB, buildBaseFrame, compositeOver, VYSHYVANKA, STITCH_THRESHOLD } from "../src/shader/vyshyvanka";

describe("vyshyvanka mapping", () => {
  it("below threshold there is no stitch (cream)", () => {
    expect(stitchRGB(0, 0)).toEqual(VYSHYVANKA.cream);
    expect(stitchRGB(STITCH_THRESHOLD - 0.001, 0.5)).toEqual(VYSHYVANKA.cream);
  });

  it("above threshold yields a thread colour, never cream", () => {
    for (let ph = 0; ph < 1; ph += 0.1) {
      const c = stitchRGB(0.9, ph);
      expect(c).not.toEqual(VYSHYVANKA.cream);
    }
  });

  it("seamless loop: phase 0 equals phase 1", () => {
    for (let i = 0; i <= 10; i++) {
      const inten = i / 10;
      expect(stitchRGB(inten, 0)).toEqual(stitchRGB(inten, 1));
    }
  });

  it("color actually cycles across phase (animation is non-trivial)", () => {
    const phases = [0, 0.25, 0.5, 0.75];
    const seen = new Set(phases.map((p) => stitchRGB(0.8, p).join(",")));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("is two-tone above threshold: only cream, red, or black (no deep-red mid)", () => {
    const allowed = new Set([
      VYSHYVANKA.cream.join(","),
      VYSHYVANKA.red.join(","),
      VYSHYVANKA.black.join(","),
    ]);
    for (let inten = 0; inten <= 1.0001; inten += 0.02) {
      for (let ph = 0; ph <= 1.0001; ph += 0.05) {
        const c = stitchRGB(inten, ph);
        expect(allowed.has(c.join(","))).toBe(true);
        expect(c).not.toEqual(VYSHYVANKA.deepRed); // no muddy mid-tone
      }
    }
  });

  it("buildBaseFrame: correct size, cream center, patterned bands", () => {
    const W = 40, H = 40, gw = 20, gh = 20, bandPx = 8;
    const field = new Float32Array(gw * gh).fill(0.9); // all stitches present
    const frame = buildBaseFrame(W, H, field, gw, gh, 0.3, bandPx);
    expect(frame.length).toBe(W * H * 4);
    // center pixel is cream
    const cIdx = ((H / 2) * W + W / 2) * 4;
    expect([frame[cIdx], frame[cIdx + 1], frame[cIdx + 2]]).toEqual([...VYSHYVANKA.cream]);
    // a top-band pixel is NOT cream (field is all-on)
    const tIdx = (2 * W + 5) * 4;
    expect([frame[tIdx], frame[tIdx + 1], frame[tIdx + 2]]).not.toEqual([...VYSHYVANKA.cream]);
    // a bottom-band pixel is also patterned
    const bIdx = ((H - 3) * W + 5) * 4;
    expect([frame[bIdx], frame[bIdx + 1], frame[bIdx + 2]]).not.toEqual([...VYSHYVANKA.cream]);
  });

  it("compositeOver: opaque text overwrites, transparent leaves base", () => {
    const base = new Uint8Array([10, 10, 10, 255, 20, 20, 20, 255]);
    const text = new Uint8Array([200, 0, 0, 255, 0, 0, 0, 0]);
    compositeOver(base, text);
    expect([base[0], base[1], base[2]]).toEqual([200, 0, 0]); // overwritten
    expect([base[4], base[5], base[6]]).toEqual([20, 20, 20]); // untouched
  });
});
