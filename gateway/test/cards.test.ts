import { describe, expect, it } from "vitest";
import { LICENCES, type Corpus, type Item } from "../src/contract.js";
import type { Adapter } from "../src/adapters/types.js";
import { handle } from "../src/router.js";
import type { Upstream } from "../src/adapters/types.js";
import { fakeNasinnia, fakePro, fakeUpa, fakeVerbaContra, fonts } from "./fakes.js";

const req = (path: string) => new Request("https://api.test" + path);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function renderer(opts: { headers?: Record<string, string>; status?: number } = {}): Upstream & { urls: string[] } {
  const base = fakePro();
  const contra = fakeVerbaContra();
  const spy = {
    urls: [] as string[],
    async fetch(input: Request | string) {
      const r = typeof input === "string" ? new Request(input) : input;
      const u = new URL(r.url);
      if (u.pathname.startsWith("/card/render.")) {
        spy.urls.push(r.url);
        const ext = u.pathname.split(".").pop()!;
        const type = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "application/json";
        return new Response(ext === "json" ? JSON.stringify({ recipe: { text: u.searchParams.get("text") } }) : PNG, {
          status: opts.status ?? 200,
          headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable", ...opts.headers },
        });
      }
      return u.pathname.startsWith("/api/v1/contra") ? contra.fetch(input) : base.fetch(input);
    },
  };
  return spy;
}

function listAdapter(corpus: Corpus, total = 10): Adapter {
  const item = (i: number): Item => ({ id: `${corpus}:i${i}`, corpus, title: "t", licence: LICENCES.pro, links: { self: "x", html: null }, data: null });
  return {
    corpus,
    meta: async () => ({ total }),
    list: async (limit, offset) => ({ total, items: Array.from({ length: Math.min(limit, total - offset) }, (_, i) => item(offset + i)) }),
    get: async () => null,
  };
}
const randomAdapters = () => ({ pro: listAdapter("pro"), contra: listAdapter("contra") });

const fontList = [
  { id: "ok", displayName: "Ok", availability: "downloadable", license: { id: "CC0-1.0", redistributionAllowed: true } },
  { id: "meta", displayName: "Meta", availability: "metadata-only", license: { id: "X", redistributionAllowed: false } },
];
const mkEnv = (pro: Upstream = renderer()) => ({ PRO: pro as any, UPA: fakeUpa() as any, FONTS: fakeNasinnia(fontList.concat(fonts(0))) as any });

describe("cards", () => {
  it("proxies png with CORS and the canonical pro.verbacorpus.org host (no 308 hop)", async () => {
    const pro = renderer();
    const r = await handle(req("/v1/cards/pro:p1.png?size=square"), mkEnv(pro));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("access-control-expose-headers")).toContain("x-verba-degraded");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
    expect(pro.urls[0]).toBe("https://pro.verbacorpus.org/card/render.png?text=pro%3Ap1&size=square");
  });

  it("accepts %3A and contra ids, json and gif", async () => {
    const pro = renderer();
    expect((await handle(req("/v1/cards/contra:x.json"), mkEnv(pro))).status).toBe(200);
    expect((await handle(req("/v1/cards/pro%3Ap1.gif"), mkEnv(pro))).headers.get("content-type")).toBe("image/gif");
    expect(pro.urls[1]).toContain("text=pro%3Ap1");
  });

  it("random never yields contra by default, and sets x-verba-seed", async () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const pro = renderer();
      const r = await handle(req(`/v1/cards/random.png?seed=${seed}`), mkEnv(pro), randomAdapters());
      expect(r.status).toBe(200);
      expect(r.headers.get("x-verba-seed")).toBe(seed);
      expect(pro.urls[0]).toContain("text=pro%3Ai");
    }
  });

  it("random with corpus=contra picks contra explicitly", async () => {
    const pro = renderer();
    await handle(req("/v1/cards/random.json?seed=s&corpus=contra"), mkEnv(pro), randomAdapters());
    expect(pro.urls[0]).toContain("text=contra%3A");
  });

  it("rejects bad recipes with 400", async () => {
    for (const q of ["frame=pro:1", "size=huge", "font=arial", "lang=de"]) {
      expect((await handle(req(`/v1/cards/pro:p1.png?${q}`), mkEnv())).status).toBe(400);
    }
    expect((await handle(req("/v1/cards/para:f.png"), mkEnv())).status).toBe(400);
    expect((await handle(req("/v1/cards/random.png?corpus=non"), mkEnv())).status).toBe(400);
  });

  it("422 for metadata-only fonts, ok for granted and pt-serif", async () => {
    const r = await handle(req("/v1/cards/pro:p1.png?font=para:meta"), mkEnv());
    expect(r.status).toBe(422);
    expect(((await r.json()) as any).error.code).toBe("font_restricted");
    expect((await handle(req("/v1/cards/pro:p1.png?font=para:ok"), mkEnv())).status).toBe(200);
    expect((await handle(req("/v1/cards/pro:p1.png?font=pt-serif"), mkEnv())).status).toBe(200);
  });

  it("503 when the renderer hangs or fails", async () => {
    const hang = { fetch: (input: Request | string) => new Promise<Response>((_, rej) => (input as Request).signal.addEventListener("abort", () => rej(new Error("aborted")))) };
    const orig = AbortSignal.timeout;
    AbortSignal.timeout = (() => orig.call(AbortSignal, 20)) as any;
    try {
      expect((await handle(req("/v1/cards/pro:p1.png"), mkEnv(hang))).status).toBe(503);
    } finally {
      AbortSignal.timeout = orig;
    }
    const boom = { fetch: async () => new Response("x", { status: 500 }) };
    expect((await handle(req("/v1/cards/pro:p1.png"), mkEnv(boom))).status).toBe(503);
  });

  it("passes x-verba-degraded and no-store through", async () => {
    const pro = renderer({ headers: { "x-verba-degraded": "font", "cache-control": "no-store" } });
    const r = await handle(req("/v1/cards/pro:p1.png"), mkEnv(pro));
    expect(r.headers.get("x-verba-degraded")).toBe("font");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("forwards style, align, and hook, and picks style/align deterministically for random", async () => {
    const pro = renderer();
    const r = await handle(req("/v1/cards/pro:p1.png?style=invert&align=stairR&hook=auto"), mkEnv(pro));
    expect(r.status).toBe(200);
    expect(pro.urls[0]).toContain("style=invert");
    expect(pro.urls[0]).toContain("align=stairR");
    expect(pro.urls[0]).toContain("hook=auto");
    expect((await handle(req("/v1/cards/pro:p1.png?style=bad"), mkEnv())).status).toBe(400);
    expect((await handle(req("/v1/cards/pro:p1.png?align=bad"), mkEnv())).status).toBe(400);

    const p1 = renderer();
    const p2 = renderer();
    await handle(req("/v1/cards/random.png?seed=daily-1"), mkEnv(p1), randomAdapters());
    await handle(req("/v1/cards/random.png?seed=daily-1"), mkEnv(p2), randomAdapters());
    expect(p1.urls[0]).toBe(p2.urls[0]);
    expect(p1.urls[0]).toMatch(/style=(color|big|shadowS|shadowD|stitch|invert|marker)/);
    expect(p1.urls[0]).toMatch(/align=(left|center|right|stairR|stairL)/);
  });
});
