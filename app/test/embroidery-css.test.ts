import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { bandSVG, transpose } from "../src/embroidery-css";
import { fakeUpa, broken } from "./card-fakes";

async function css(extra: Record<string, unknown>) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://example.com/embroidery.css"), { ...env, ...extra } as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const ICONS = ["heart", "link", "image", "moon", "sun", "search", "check", "leaf"];

describe("GET /embroidery.css", () => {
  it("serves UPA bands (a, b, c, vertical) and the 8 UI icons", async () => {
    const calls: string[] = [];
    const res = await css({ UPA: fakeUpa(calls) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    const t = await res.text();
    for (const v of ["--emb-a:", "--emb-b:", "--emb-c:", "--emb-bv:", "--emb-a-rows", "prefers-color-scheme: dark"]) expect(t).toContain(v);
    for (const i of ICONS) expect(t).toContain(`.emb-ico-${i}`);
    expect(calls.length).toBe(3);
  });
  it("without UPA: 200 css, icons only, no band variables, no-store", async () => {
    const res = await css({ UPA: undefined });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const t = await res.text();
    expect(t).not.toContain("--emb-a");
    for (const i of ICONS) expect(t).toContain(`.emb-ico-${i}`);
  });
  it("UPA failure degrades the same way", async () => {
    const res = await css({ UPA: broken });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toContain("--emb-a");
  });
});

describe("bandSVG / transpose", () => {
  const b = { id: "x", rows: 2, cols: 3, cells: [["A", "B", "C"], ["B", "F", "B"]] };
  it("draws UPA palette colours on paper, skipping B", () => {
    const svg = decodeURIComponent(bandSVG(b, true).slice("data:image/svg+xml,".length));
    expect(svg).toContain("fill='#f4f1e8'");
    expect(svg).toContain("fill='#dc143c'");
    expect(svg).toContain("fill='#0047ab'");
    expect(svg).toContain("fill='#e3c20b'");
    expect(svg.match(/<rect/g)!.length).toBe(1 + 3);
    expect(decodeURIComponent(bandSVG(b, false).slice(19))).toContain("fill='#191c16'");
  });
  it("transpose swaps dimensions", () => {
    const t = transpose(b);
    expect([t.rows, t.cols]).toEqual([3, 2]);
    expect(t.cells[1]).toEqual(["B", "F"]);
  });
});
