import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import UPNG from "upng-js";
import worker from "../src/index";
import { UPA_PALETTE, CARD_FRAMES } from "../src/card/ornament";
import { qrLabelScale } from "../src/card/render";
import { fakeFonts, fakeUpa, broken } from "./card-fakes";

async function call(path: string, extra: Record<string, unknown> = { FONTS: fakeFonts(), UPA: fakeUpa() }) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://example.com" + path), { ...env, ...extra } as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const decode = async (res: Response) => {
  const img = UPNG.decode(await res.arrayBuffer());
  return { W: img.width, H: img.height, rgba: new Uint8Array(UPNG.toRGBA8(img)[0]) };
};
const pixel = (rgba: Uint8Array, W: number, x: number, y: number) => [rgba[(y * W + x) * 4], rgba[(y * W + x) * 4 + 1], rgba[(y * W + x) * 4 + 2]];
const rowColours = (rgba: Uint8Array, W: number, y: number) => new Set(Array.from({ length: W }, (_, x) => pixel(rgba, W, x, y).join(",")));
const PAPER = "244,241,232";
const INK = "35,37,32";
const UPA_COLOURS = new Set(Object.values(UPA_PALETTE).map((c) => c.join(",")));

// --- tests -------------------------------------------------------------------

describe("/card/render.png — recipe pipeline", () => {
  it.each([
    ["fb", 1200, 630],
    ["square", 1080, 1080],
    ["story", 1080, 1920],
    ["yt", 1280, 720],
    ["sticker", 512, 512],
    ["telegram", 1200, 630],
  ])("size=%s renders %ix%i PNG", async (size, w, h) => {
    const res = await call(`/card/render.png?text=pro:p1&size=${size}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-verba-degraded")).toBeNull();
    const { W, H } = await decode(res);
    expect([W, H]).toEqual([w, h]);
  });

  it("defaults to fb; top band uses only UPA palette + paper, with UPA colour present", async () => {
    const { W, H, rgba } = await decode(await call("/card/render.png?text=pro:p1"));
    expect([W, H]).toEqual([1200, 630]);
    const top = rowColours(rgba, W, 2);
    for (const c of top) expect(UPA_COLOURS.has(c) || c === PAPER).toBe(true);
    expect([...top].some((c) => UPA_COLOURS.has(c))).toBe(true);
    const bottom = rowColours(rgba, W, H - 2);
    expect([...bottom].some((c) => UPA_COLOURS.has(c))).toBe(true);
  });

  it("draws bitmap text in ink in the content area (no anti-aliasing)", async () => {
    const { W, H, rgba } = await decode(await call("/card/render.png?text=pro:p1&size=square"));
    const colours = new Set<string>();
    for (let y = Math.round(H * 0.15); y < Math.round(H * 0.85); y += 1) for (let x = 0; x < W; x += 1) colours.add(pixel(rgba, W, x, y).join(","));
    expect(colours.has(INK)).toBe(true);
    // Bitmap text and a flat palette: a handful of exact colours, no AA ramp.
    expect(colours.size).toBeLessThanOrEqual(12);
  });

  it("same recipe twice gives byte-identical PNG and GIF (RF5)", async () => {
    const q = "/card/render.png?text=pro:p1&frame=non:p08_L_b03&font=para:cozette-13x15&size=square";
    const a = new Uint8Array(await (await call(q)).arrayBuffer());
    const b = new Uint8Array(await (await call(q)).arrayBuffer());
    expect(a.length).toBeGreaterThan(1000);
    expect(b).toEqual(a);
    const g1 = new Uint8Array(await (await call(q.replace(".png", ".gif").replace("square", "sticker"))).arrayBuffer());
    const g2 = new Uint8Array(await (await call(q.replace(".png", ".gif").replace("square", "sticker"))).arrayBuffer());
    expect(g2).toEqual(g1);
  });

  it("FONTS throwing degrades to PT Serif: 200 + x-verba-degraded: font, not cached", async () => {
    const res = await call("/card/render.png?text=pro:p1", { FONTS: broken, UPA: fakeUpa() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-verba-degraded")).toBe("font");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { W, H } = await decode(res);
    expect([W, H]).toEqual([1200, 630]);
  });

  it("UPA throwing degrades to a solid A band: 200 + x-verba-degraded: frame", async () => {
    const res = await call("/card/render.png?text=pro:p1", { FONTS: fakeFonts(), UPA: broken });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-verba-degraded")).toBe("frame");
    const { W, rgba } = await decode(res);
    expect([...rowColours(rgba, W, 2)]).toEqual([UPA_PALETTE.A.join(",")]);
  });

  it("no FONTS/UPA bindings at all still renders, degraded on both", async () => {
    const res = await call("/card/render.png?text=pro:p1&size=sticker", {});
    expect(res.status).toBe(200);
    expect(res.headers.get("x-verba-degraded")).toBe("font,frame");
  });

  it("explicit font=pt-serif is not degraded", async () => {
    const res = await call("/card/render.json?text=pro:p1&font=pt-serif");
    const body = await res.json() as any;
    expect(res.headers.get("x-verba-degraded")).toBeNull();
    expect(body.degraded).toEqual([]);
    expect(body.attribution[2]).toContain("PT Serif");
  });
});

describe("/card/render.json", () => {
  it("returns recipe, three attribution lines and no degradation", async () => {
    const res = await call("/card/render.json?text=pro:p1&size=story");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json() as any;
    expect(body.recipe).toEqual({ text: "pro:p1", frame: expect.stringMatching(/^non:/), font: "para:cozette-13x15", size: "story", lang: "uk" });
    expect(CARD_FRAMES).toContain(body.recipe.frame);
    expect(body.attribution).toHaveLength(3);
    expect(body.attribution).toContain("Hough, 2025 / Габданк-Рогозинський");
    expect(body.attribution[0]).toContain("Франко 1901");
    expect(body.attribution[2]).toContain("Moonwitch");
    expect(body.degraded).toEqual([]);
  });

  it("default frame is deterministic for the text", async () => {
    const a = await (await call("/card/render.json?text=pro:p1")).json() as any;
    const b = await (await call("/card/render.json?text=pro:p1&size=sticker")).json() as any;
    expect(a.recipe.frame).toBe(b.recipe.frame);
  });

  it("degraded font is reported in the body and header", async () => {
    const res = await call("/card/render.json?text=pro:p1", { FONTS: broken, UPA: fakeUpa() });
    const body = await res.json() as any;
    expect(res.headers.get("x-verba-degraded")).toBe("font");
    expect(body.degraded).toEqual(["font"]);
    expect(body.attribution[2]).toContain("PT Serif");
  });

  it("contra text is allowed when asked explicitly and credits the dictionary", async () => {
    const res = await call("/card/render.json?text=contra:cd325d32fe");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.attribution[0]).toContain("Ставицька");
    const png = await call("/card/render.png?text=contra:cd325d32fe&size=sticker");
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
  });
});

describe("/card/render.* — errors", () => {
  const err = async (path: string) => {
    const res = await call(path);
    return { status: res.status, code: ((await res.json()) as any)?.error?.code };
  };
  it("metadata-only font -> 422 font_restricted", async () => {
    expect(await err("/card/render.png?text=pro:p1&font=para:hoard-acorn-bbc-bbc-micro")).toEqual({ status: 422, code: "font_restricted" });
    expect(await err("/card/render.json?text=pro:p1&font=para:hoard-acorn-bbc-bbc-micro")).toEqual({ status: 422, code: "font_restricted" });
  });
  it("invalid recipe -> 400 invalid_request", async () => {
    for (const q of ["", "?text=p1", "?text=pro:p1&frame=pro:1", "?text=pro:p1&font=comic", "?text=pro:p1&size=huge", "?text=pro:p1&lang=de", "?text=non:p08_L_b03"]) {
      expect(await err("/card/render.png" + q)).toEqual({ status: 400, code: "invalid_request" });
    }
  });
  it("unknown text -> 404; unknown or non-band explicit frame -> 404/422; unknown font -> 404", async () => {
    expect(await err("/card/render.png?text=pro:zzz")).toEqual({ status: 404, code: "not_found" });
    expect(await err("/card/render.png?text=contra:nope")).toEqual({ status: 404, code: "not_found" });
    expect(await err("/card/render.png?text=pro:p1&frame=non:zzz")).toEqual({ status: 404, code: "frame_not_found" });
    expect(await err("/card/render.png?text=pro:p1&frame=non:p42_-_b00")).toEqual({ status: 422, code: "frame_not_band" });
    expect(await err("/card/render.png?text=pro:p1&font=para:no-such-font")).toEqual({ status: 404, code: "font_not_found" });
  });
});

describe("legacy /card/<id> routes on the new pipeline", () => {
  it("/card/p1.png?format=square -> 200 image/png 1080², cacheable", async () => {
    const res = await call("/card/p1.png?format=square");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const { W, H } = await decode(res);
    expect([W, H]).toEqual([1080, 1080]);
  });
  it("/card/daily.png -> 200 image/png", async () => {
    const res = await call("/card/daily.png?lang=en&minimal=1&nochrome=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
  it("legacy PNG equals the render route for the same recipe", async () => {
    const legacy = new Uint8Array(await (await call("/card/p1.png?format=telegram")).arrayBuffer());
    const render = new Uint8Array(await (await call("/card/render.png?text=pro:p1&size=telegram")).arrayBuffer());
    expect(legacy).toEqual(render);
  });
  it("degraded legacy card is not cached for a year", async () => {
    const res = await call("/card/p1.png", {});
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("QR short-URL label scale", () => {
  it("is 2 on story and any card >= 1080 px tall, 1 on short cards", () => {
    expect(qrLabelScale(1920)).toBe(2); // story
    expect(qrLabelScale(1080)).toBe(2); // square
    expect(qrLabelScale(720)).toBe(1);
    expect(qrLabelScale(630)).toBe(1);
  });
});

describe("render.json does not fetch glyphs", () => {
  it("only reads font metadata (counting fake FONTS)", async () => {
    const calls: string[] = [];
    const res = await call("/card/render.json?text=pro:p1", { FONTS: fakeFonts(calls), UPA: fakeUpa() });
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.degraded).toEqual([]);
    expect(body.attribution[2]).toContain("Moonwitch");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.includes("/glyphs"))).toBe(false);
    const png: string[] = [];
    await call("/card/render.png?text=pro:p1", { FONTS: fakeFonts(png), UPA: fakeUpa() });
    expect(png.some((c) => c.includes("/glyphs"))).toBe(true);
  });
});

describe("upstream fetches carry an abort signal", () => {
  it("fonts and UPA calls get a signal", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const wrap = (f: Fetcher) => ({ fetch: (u: any, init?: RequestInit) => { seen.push(init?.signal ?? undefined); return f.fetch(u, init); } }) as unknown as Fetcher;
    await call("/card/render.png?text=pro:p1", { FONTS: wrap(fakeFonts()), UPA: wrap(fakeUpa()) });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every(Boolean)).toBe(true);
  });
});
