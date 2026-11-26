import { describe, it, expect } from "vitest";
import fixture from "./fixtures/upa-band.json";
import { fetchBand, paintBand, pickFrame, CARD_FRAMES, CardFrameError } from "../src/card/ornament";

const fx = fixture as Record<string, unknown>;
const fakeUpa = (status = 200, body: unknown = undefined, throws = false) => {
  const calls: string[] = [];
  const f = { fetch: async (u: string) => { calls.push(String(u)); if (throws) throw new Error("net"); return new Response(JSON.stringify(body), { status }); } } as unknown as Fetcher;
  return { f, calls };
};
const PAPER: [number, number, number] = [0xf4, 0xf1, 0xe8];
const px = (b: Uint8Array, W: number, x: number, y: number) => [...b.slice((y * W + x) * 4, (y * W + x) * 4 + 4)];
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof CardFrameError ? e.code : "other"));

describe("fetchBand", () => {
  it("reads unitCell with only A-G symbols", async () => {
    const { f, calls } = fakeUpa(200, fx["p08_L_b03"]);
    const b = await fetchBand(f, "p08_L_b03");
    expect(calls[0]).toBe("https://upstream/api/v1/patterns/p08_L_b03?similar=0");
    expect(b.id).toBe("p08_L_b03");
    expect(b.unit.length).toBe(3);
    expect(b.unit.flat().every((c) => /^[A-G]$/.test(c))).toBe(true);
  });
  it("accepts a global id and strips non:", async () => {
    const { f, calls } = fakeUpa(200, fx["p07_L_b00"]);
    expect((await fetchBand(f, "non:p07_L_b00")).id).toBe("p07_L_b00");
    expect(calls[0]).toContain("/patterns/p07_L_b00");
  });
  it("non-band -> frame_not_band", async () => {
    expect(await code(fetchBand(fakeUpa(200, fx["p42_-_b00"]).f, "p42_-_b00"))).toBe("frame_not_band");
  });
  it("404 -> frame_not_found; 5xx/network/garbage -> frame_unavailable", async () => {
    expect(await code(fetchBand(fakeUpa(404, {}).f, "x"))).toBe("frame_not_found");
    expect(await code(fetchBand(fakeUpa(503, {}).f, "x"))).toBe("frame_unavailable");
    expect(await code(fetchBand(fakeUpa(200, {}, true).f, "x"))).toBe("frame_unavailable");
    expect(await code(fetchBand(fakeUpa(200, { pattern: { kind: "band", geometry: {} } }).f, "x"))).toBe("frame_unavailable");
  });
});

describe("paintBand", () => {
  const W = 20, H = 30;
  const blank = () => new Uint8Array(W * H * 4);

  it("1x1 unit fills the whole band solid", () => {
    const b = blank();
    paintBand(b, W, H, 4, 8, [["D"]], PAPER, 0);
    for (let y = 4; y < 12; y++) for (let x = 0; x < W; x++) expect(px(b, W, x, y)).toEqual([10, 10, 10, 255]);
    expect(px(b, W, 0, 3)).toEqual([0, 0, 0, 0]);
    expect(px(b, W, 0, 12)).toEqual([0, 0, 0, 0]);
  });

  it("tall unit (12 rows) in band 8 stays within [y0, y0+band)", () => {
    const unit = Array.from({ length: 12 }, () => ["A", "D", "B", "A"]);
    const b = blank();
    paintBand(b, W, H, 10, 8, unit, PAPER, 0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const painted = b[(y * W + x) * 4 + 3] === 255;
      if (y < 10 || y >= 18) expect(painted).toBe(false);
    }
    expect(px(b, W, 0, 10)[3]).toBe(255);
  });

  it("B cells use the paper colour; stitch scales by integer", () => {
    const b = blank();
    paintBand(b, W, H, 0, 4, [["A", "B"], ["B", "A"]], PAPER, 0); // stitch 2
    expect(px(b, W, 0, 0)).toEqual([0xdc, 0x14, 0x3c, 255]);
    expect(px(b, W, 1, 1)).toEqual([0xdc, 0x14, 0x3c, 255]);
    expect(px(b, W, 2, 0)).toEqual([...PAPER, 255]);
    expect(px(b, W, 0, 2)).toEqual([...PAPER, 255]);
    expect(px(b, W, 4, 0)).toEqual([0xdc, 0x14, 0x3c, 255]); // tiled
  });

  it("phase shifts the repeat; phase 1 equals phase 0", () => {
    const unit = [["A", "B", "B", "B"]];
    const a = blank(), c = blank(), d = blank();
    paintBand(a, W, H, 0, 1, unit, PAPER, 0);
    paintBand(c, W, H, 0, 1, unit, PAPER, 0.25);
    paintBand(d, W, H, 0, 1, unit, PAPER, 1);
    expect(px(a, W, 0, 0)).toEqual([0xdc, 0x14, 0x3c, 255]);
    expect(px(c, W, 0, 0)).toEqual([...PAPER, 255]);
    expect(px(c, W, 3, 0)).toEqual([0xdc, 0x14, 0x3c, 255]);
    expect(d).toEqual(a);
  });

  it("paints a real fixture band", async () => {
    const b8 = await fetchBand(fakeUpa(200, fx["p11_-_b00"]).f, "p11_-_b00");
    expect(b8.unit.length).toBe(28);
    const b = blank();
    paintBand(b, W, H, 0, 8, b8.unit, PAPER, 0);
    expect(px(b, W, 0, 8)[3]).toBe(0);
  });
});

describe("pickFrame", () => {
  it("is deterministic and returns a listed global id", () => {
    expect(CARD_FRAMES.length).toBeGreaterThanOrEqual(20);
    const a = pickFrame("proverb-1");
    expect(pickFrame("proverb-1")).toBe(a);
    expect(CARD_FRAMES).toContain(a);
    expect(a.startsWith("non:")).toBe(true);
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(pickFrame)).size).toBeGreaterThan(1);
  });
});
