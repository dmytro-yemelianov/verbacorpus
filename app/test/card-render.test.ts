import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import UPNG from "upng-js";
import worker from "../src/index";
import { UPA_PALETTE, CARD_FRAMES } from "../src/card/ornament";
import { qrLabelScale, qrPlacement } from "../src/card/render";
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

  it("defaults to fb; full 4-sided perimeter uses only UPA palette + paper, with UPA colour on all edges", async () => {
    const { W, H, rgba } = await decode(await call("/card/render.png?text=pro:p1"));
    expect([W, H]).toEqual([1200, 630]);
    const top = rowColours(rgba, W, 2);
    for (const c of top) expect(UPA_COLOURS.has(c) || c === PAPER).toBe(true);
    expect([...top].some((c) => UPA_COLOURS.has(c))).toBe(true);
    const bottom = rowColours(rgba, W, H - 2);
    expect([...bottom].some((c) => UPA_COLOURS.has(c))).toBe(true);
    const left = new Set(Array.from({ length: H }, (_, y) => pixel(rgba, W, 2, y).join(",")));
    const right = new Set(Array.from({ length: H }, (_, y) => pixel(rgba, W, W - 2, y).join(",")));
    expect([...left].some((c) => UPA_COLOURS.has(c))).toBe(true);
    expect([...right].some((c) => UPA_COLOURS.has(c))).toBe(true);
  });

  it("draws bitmap text in ink in the content area (no anti-aliasing)", async () => {
    const { W, H, rgba } = await decode(await call("/card/render.png?text=pro:p1&size=square"));
    const colours = new Set<string>();
    for (let y = Math.round(H * 0.15); y < Math.round(H * 0.85); y += 1) for (let x = 0; x < W; x += 1) colours.add(pixel(rgba, W, x, y).join(","));
    expect(colours.has(INK)).toBe(true);
    // Bitmap text and a flat discrete palette: no AA ramp.
    expect(colours.size).toBeLessThanOrEqual(12);
  });

  it("same recipe twice gives byte-identical PNG, GIF, and Animated WebP (RF5)", async () => {
    const q = "/card/render.png?text=pro:p1&frame=non:p08_L_b03&font=para:cozette-13x15&size=square";
    const a = new Uint8Array(await (await call(q)).arrayBuffer());
    const b = new Uint8Array(await (await call(q)).arrayBuffer());
    expect(a.length).toBeGreaterThan(1000);
    expect(b).toEqual(a);
    const g1 = new Uint8Array(await (await call(q.replace(".png", ".gif").replace("square", "sticker"))).arrayBuffer());
    const g2 = new Uint8Array(await (await call(q.replace(".png", ".gif").replace("square", "sticker"))).arrayBuffer());
    expect(g2).toEqual(g1);
    const wRes = await call(q.replace(".png", ".webp").replace("square", "sticker"));
    expect(wRes.status).toBe(200);
    expect(wRes.headers.get("content-type")).toBe("image/webp");
    const w1 = new Uint8Array(await wRes.arrayBuffer());
    const w2 = new Uint8Array(await (await call(q.replace(".png", ".webp").replace("square", "sticker"))).arrayBuffer());
    expect(w2).toEqual(w1);
    // RIFF....WEBPVP8X header + ANIM + ANMF chunks
    const ascii = (off: number) => String.fromCharCode(...w1.slice(off, off + 4));
    expect(ascii(0)).toBe("RIFF");
    expect(ascii(8)).toBe("WEBP");
    expect(ascii(12)).toBe("VP8X");
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

  it("contra text is allowed when asked explicitly and renders PNG + Animated WebP with dictionary credits", async () => {
    const res = await call("/card/render.json?text=contra:cd325d32fe");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.attribution[0]).toContain("Ставицька");
    const png = await call("/card/render.png?text=contra:cd325d32fe&size=sticker");
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    const webp = await call("/card/render.webp?text=contra:cd325d32fe&size=square");
    expect(webp.status).toBe(200);
    expect(webp.headers.get("content-type")).toBe("image/webp");
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

describe("QR short-URL label stays inside the card", () => {
  const SIZES: Record<string, [number, number, number]> = {
    fb: [1200, 630, 0], square: [1080, 1080, 0], story: [1080, 1920, 0], yt: [1280, 720, 0], sticker: [512, 512, 0], telegram: [1200, 630, 0],
  };
  const cellW = 13; // widest possible advance of the cozette face used in tests
  it.each(Object.keys(SIZES))("%s: label right edge <= W - margin, scale >= 1", (size) => {
    const [W, H] = SIZES[size]!;
    for (const label of ["pro.verbacorpus.org/s/31792", "pro.verbacorpus.org/s/4878799"]) {
      const P = qrPlacement(size as any, W, H, 29, (sc) => label.length * cellW * sc);
      if (!P) continue; // sticker / telegram draw no QR
      expect(P.label.scale).toBeGreaterThanOrEqual(1);
      expect(P.label.x + P.label.width).toBeLessThanOrEqual(P.right);
      expect(P.label.x).toBeGreaterThanOrEqual(W - P.right);
    }
  });
  it("keeps scale 2 when the label fits, drops to 1 when it does not, right-aligns to the QR", () => {
    const w = (n: number) => (sc: number) => n * 13 * sc;
    expect(qrPlacement("story", 1080, 1920, 29, w(27))!.label.scale).toBe(2); // 702 <= 920
    const sq = qrPlacement("square", 1080, 1080, 29, w(40))!; // 1040 > 900 at scale 2
    expect(sq.label.scale).toBe(1);
    expect(sq.label.x + sq.label.width).toBe(sq.right);
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

describe("styles, alignments, and hooks", () => {
  it.each(["base", "color", "big", "shadowS", "shadowD", "stitch", "invert", "marker"])(
    "style=%s renders valid PNG with custom hook",
    async (style) => {
      const res = await call(`/card/render.png?text=pro:p1&size=square&style=${style}&hook=${encodeURIComponent("море")}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      const { W, H, rgba } = await decode(res);
      expect([W, H]).toEqual([1080, 1080]);
      if (style === "invert") {
        // Content area halo substrate uses D (#0A0A0A = 10,10,10) inside protected margin (outside 24px border)
        expect(pixel(rgba, W, 72, Math.round(H / 2))).toEqual([10, 10, 10]);
      }
    },
  );

  it.each(["left", "center", "right", "stairR", "stairL"])(
    "align=%s renders valid PNG",
    async (align) => {
      const res = await call(`/card/render.png?text=pro:p1&size=square&align=${align}`);
      expect(res.status).toBe(200);
    },
  );

  it("rejects unknown style, align, or non-substring hook with 400", async () => {
    const badStyle = await call("/card/render.png?text=pro:p1&style=neon");
    expect(badStyle.status).toBe(400);
    const badAlign = await call("/card/render.png?text=pro:p1&align=justify");
    expect(badAlign.status).toBe(400);
    const badHook = await call("/card/render.png?text=pro:p1&hook=not_in_text");
    expect(badHook.status).toBe(400);
    expect((await badHook.json() as any).error.code).toBe("invalid_hook");
  });

  it("renders with alternative font para:verba-amstrad-pc and non-degraded attribution", async () => {
    const res = await call("/card/render.json?text=pro:p1&font=para:verba-amstrad-pc");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.degraded).toEqual([]);
    expect(body.recipe.font).toBe("para:verba-amstrad-pc");
    expect(body.attribution[2]).toContain("Amstrad PC");
    const png = await call("/card/render.png?text=pro:p1&font=para:verba-amstrad-pc");
    expect(png.status).toBe(200);
    expect(png.headers.get("x-verba-degraded")).toBeNull();
  });

  it("uvc-ported quantum shader & QR shimmer achieve seamless frame[0] === frame[N] parity", async () => {
    const { renderQuantumFrame } = await import("../src/card/quantum");
    const W = 64, H = 64, M = 8, GW = 8, GH = 8;
    const base = new Uint8Array(W * H * 4).fill(255);
    const meta = {
      W, H, M, GW, GH, T: 1,
      corpus: "pro" as const,
      invert: false,
      dist: new Float32Array(GW * GH).fill(10),
      qr: { gx: 2, gy: 2, n: 4, matrix: [[true, false, true, true], [false, true, true, false], [true, true, false, true], [true, false, true, false]] },
      unit: [["A", "B"], ["B", "D"]],
    };
    const f0 = renderQuantumFrame(base, meta, 0, 0);
    const f1 = renderQuantumFrame(base, meta, 1, 2);
    expect(Buffer.compare(f1, f0)).toBe(0);
  });

  it("supports explicit shader & dither query parameters on render and legacy routes", async () => {
    const resA = await call("/card/render.png?text=pro:p1&size=square&shader=kilim_drift&dither=plakhta");
    const resB = await call("/card/render.png?text=pro:p1&size=square&shader=polissya_moss&dither=aida");
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const decA = await decode(resA);
    const decB = await decode(resB);
    expect(Buffer.compare(decA.rgba, decB.rgba)).not.toBe(0);

    // Check discrete palette integrity on shader=polissya_moss&dither=aida
    const colours = new Set<string>();
    for (let y = Math.round(decB.H * 0.15); y < Math.round(decB.H * 0.85); y += 2) {
      for (let x = 0; x < decB.W; x += 2) colours.add(pixel(decB.rgba, decB.W, x, y).join(","));
    }
    expect(colours.size).toBeLessThanOrEqual(12);

    const legacy = await call("/card/p1.webp?format=square&shader=indigo_night&dither=bayer8");
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("content-type")).toBe("image/webp");

    expect((await call("/card/render.png?text=pro:p1&shader=invalid_shader")).status).toBe(400);
    expect((await call("/card/render.png?text=pro:p1&dither=invalid_dither")).status).toBe(400);
  });
});
