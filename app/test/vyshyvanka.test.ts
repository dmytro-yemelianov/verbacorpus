import { describe, it, expect } from "vitest";
import { compositeOver } from "../src/shader/vyshyvanka";

describe("compositeOver", () => {
  it("opaque text overwrites, transparent leaves base", () => {
    const base = new Uint8Array([10, 10, 10, 255, 20, 20, 20, 255]);
    const text = new Uint8Array([200, 0, 0, 255, 0, 0, 0, 0]);
    compositeOver(base, text);
    expect([base[0], base[1], base[2]]).toEqual([200, 0, 0]);
    expect([base[4], base[5], base[6]]).toEqual([20, 20, 20]);
  });
  it("half-transparent text blends", () => {
    const base = new Uint8Array([100, 100, 100, 255]);
    compositeOver(base, new Uint8Array([200, 200, 200, 128]));
    expect(base[0]).toBeGreaterThan(100);
    expect(base[0]).toBeLessThan(200);
  });
});
