import { describe, it, expect } from "vitest";
import { qrMatrix, qrSvg, qrDataUri } from "../src/shared/qr";

describe("qrMatrix", () => {
  const m = qrMatrix("https://verbacorpus.org/s/126");
  it("is a square boolean matrix of QR size", () => {
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    expect(typeof m[0][0]).toBe("boolean");
  });
  it("has the top-left finder pattern (7x7 dark border)", () => {
    for (let i = 0; i < 7; i++) { expect(m[0][i]).toBe(true); expect(m[i][0]).toBe(true); }
    expect(m[1][1]).toBe(false); // finder inner ring
  });
  it("is deterministic", () => expect(qrMatrix("X")).toEqual(qrMatrix("X")));
});
describe("qrSvg / qrDataUri", () => {
  it("emits an svg with rects + size", () => {
    const s = qrSvg("https://verbacorpus.org/s/126", { module: 4, margin: 4 });
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).toContain("<rect");
    expect(s).toContain("viewBox");
  });
  it("data uri is base64 svg", () => expect(qrDataUri("X").startsWith("data:image/svg+xml;base64,")).toBe(true));
});
