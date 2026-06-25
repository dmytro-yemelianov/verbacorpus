import { describe, it, expect } from "vitest";
import { BORDERS } from "../src/shader/embroidery";
import { bandSVG, embroideryCss } from "../src/embroidery-css";

const A = BORDERS.find((b) => b.id === "upa_2c1afca8547010f7")!;

describe("embroidery-css generator", () => {
  it("bandSVG emits a data-URI SVG sized to the unit, with the light palette", () => {
    const uri = bandSVG(A, true);
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    const svg = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
    expect(svg).toContain(`width='${A.cols * 8}'`);
    expect(svg).toContain(`height='${A.rows * 8}'`);
    expect(svg).toContain("fill='#f4f1e8'");
    expect(svg).toContain("fill='#b4232a'");
    expect(svg).not.toContain("#d8aa54");
  });
  it("bandSVG dark palette swaps red->gold, linen->dark paper", () => {
    const svg = decodeURIComponent(bandSVG(A, false).slice("data:image/svg+xml,".length));
    expect(svg).toContain("fill='#191c16'");
    expect(svg).toContain("fill='#d8aa54'");
    expect(svg).not.toContain("#b4232a");
  });
  it("embroideryCss defines --emb-a/b/c and a dark override + media query", () => {
    const css = embroideryCss();
    for (const v of ["--emb-a", "--emb-b", "--emb-c"]) expect(css).toContain(v);
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("%23d8aa54");
    expect(css).toContain("%23b4232a");
    expect(css).toContain("--emb-stitch: 3px"); // single shared stitch size
    expect(css).toContain("--emb-a-rows:");      // derived band heights
  });
});
