import { describe, expect, it } from "vitest";
import { handle } from "../src/router.js";
import { pickRandom, rng } from "../src/random.js";
import type { Adapter } from "../src/adapters/types.js";
import { LICENCES, type Corpus, type Item } from "../src/contract.js";
import { countingVerba, fakeNasinnia, fakePro, fakeUpa, fakeVerbaContra, fonts } from "./fakes.js";

const req = (path: string) => new Request("https://api.test" + path);
const env = () => ({ PRO: fakePro() as any, UPA: fakeUpa() as any, FONTS: fakeNasinnia(fonts(5)) as any });

function fakeAdapter(corpus: Corpus, total: number): Adapter & { calls: number } {
  const item = (i: number): Item => ({
    id: `${corpus}:${i}`, corpus, title: `t${i}`, licence: LICENCES.pro,
    links: { self: "x", html: null }, data: null,
  });
  const a = {
    calls: 0, corpus,
    meta: async () => ({ total }),
    list: async (limit: number, offset: number) => {
      a.calls++;
      return { total, items: Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, i) => item(offset + i)) };
    },
    get: async () => null,
  };
  return a;
}
const contra = () => fakeAdapter("contra", 10);
const withContra = () => ({ pro: fakeAdapter("pro", 10), non: fakeAdapter("non", 10), para: fakeAdapter("para", 10), contra: contra() });

describe("rng", () => {
  it("is deterministic and in [0,1)", () => {
    const a = rng("s"), b = rng("s");
    for (let i = 0; i < 100; i++) { const v = a(); expect(v).toBe(b()); expect(v >= 0 && v < 1).toBe(true); }
    expect(rng("s")()).not.toBe(rng("t")());
  });
});

describe("pickRandom", () => {
  it("empty corpus yields []", async () => {
    expect(await pickRandom(fakeAdapter("pro", 0), 5, rng("x"), new URLSearchParams())).toEqual([]);
  });
  it("n above total returns distinct, at most total", async () => {
    const items = await pickRandom(fakeAdapter("pro", 3), 10, rng("x"), new URLSearchParams());
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.length).toBeLessThanOrEqual(3);
  });
});

describe("random routes", () => {
  it("same seed, same picks", async () => {
    const a = await (await handle(req("/v1/random?seed=2026-11-26&n=5"), env())).json() as any;
    const b = await (await handle(req("/v1/random?seed=2026-11-26&n=5"), env())).json() as any;
    expect(a.items.map((i: any) => i.id)).toEqual(b.items.map((i: any) => i.id));
    expect(a).toMatchObject({ corpus: "mixed", offset: 0, nextOffset: null });
  });
  it("default mix never includes contra", async () => {
    for (const s of ["a", "b", "c", "d", "e"]) {
      const b = await (await handle(req(`/v1/random?seed=${s}&n=20`), {}, withContra())).json() as any;
      expect(b.items.length).toBeGreaterThan(0);
      expect(b.items.every((i: any) => i.corpus !== "contra")).toBe(true);
    }
  });
  it("default mix excludes contra even when PRO is bound and the contra adapter exists", async () => {
    const pro = fakePro(), contraUp = fakeVerbaContra();
    const both = {
      fetch: (i: Request | string) => {
        const path = new URL(typeof i === "string" ? i : i.url).pathname;
        return (path.startsWith("/api/v1/contra") ? contraUp : pro).fetch(i);
      },
    };
    const e = { PRO: both as any, UPA: fakeUpa() as any, FONTS: fakeNasinnia(fonts(5)) as any };
    for (const s of ["a", "b", "c", "d", "e", "f", "g"]) {
      const b = await (await handle(req(`/v1/random?seed=${s}&n=20`), e)).json() as any;
      expect(b.items.length).toBeGreaterThan(0);
      expect(b.items.every((i: any) => i.corpus !== "contra")).toBe(true);
    }
  });
  it("explicit contra is allowed", async () => {
    const b = await (await handle(req("/v1/random?corpus=contra&seed=x"), {}, withContra())).json() as any;
    expect(b.items[0].corpus).toBe("contra");
  });
  it("unseeded random is not cached and reports its seed", async () => {
    const r = await handle(req("/v1/pro/random"), env());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-verba-seed")).toBeTruthy();
  });
  it("seeded random is cacheable and echoes seed", async () => {
    const r = await handle(req("/v1/pro/random?seed=abc&n=3"), {}, withContra());
    expect(r.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(r.headers.get("x-verba-seed")).toBe("abc");
    const b = await r.json() as any;
    expect(b.corpus).toBe("pro");
    expect(b.items.length).toBe(3);
  });
  it.each(["n=21", "n=0", "n=x", "n=1.5"])("rejects %s without upstream calls", async (q) => {
    const spy = countingVerba();
    const r = await handle(req(`/v1/pro/random?${q}`), { PRO: spy as any });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe("invalid_request");
    expect(spy.calls).toBe(0);
  });
  it("mixed rejects bad n and unknown corpus", async () => {
    expect((await handle(req("/v1/random?n=21"), env())).status).toBe(400);
    expect((await handle(req("/v1/random?corpus=pro,zzz"), env())).status).toBe(400);
  });
  it("requested corpus without adapter is 503", async () => {
    // contra is served through the PRO binding, so only an empty env lacks it
    expect((await handle(req("/v1/random?corpus=contra"), {})).status).toBe(503);
    expect((await handle(req("/v1/non/random"), { PRO: fakePro() as any })).status).toBe(503);
  });
  it("accepts non-Latin-1 seeds", async () => {
    const q = "/v1/pro/random?n=3&seed=" + encodeURIComponent("картка-дня");
    const r1 = await handle(req(q), {}, withContra());
    expect(r1.status).toBe(200);
    expect(r1.headers.get("x-verba-seed")).toBe(encodeURIComponent("картка-дня"));
    const a = await r1.json() as any;
    const b = await (await handle(req(q), {}, withContra())).json() as any;
    expect(a.seed).toBe("картка-дня");
    expect(a.items.map((i: any) => i.id)).toEqual(b.items.map((i: any) => i.id));
  });
  it("rejects a 129-char seed", async () => {
    expect((await handle(req("/v1/pro/random?seed=" + "a".repeat(129)), {}, withContra())).status).toBe(400);
    expect((await handle(req("/v1/pro/random?seed=" + "a".repeat(128)), {}, withContra())).status).toBe(200);
  });
  it("mixed fetches each total once", async () => {
    const ad = withContra();
    const r = await handle(req("/v1/random?n=20&seed=s"), {}, ad);
    const b = await r.json() as any;
    expect(b.items.length).toBe(20);
    const per = { pro: 0, non: 0, para: 0 } as Record<string, number>;
    for (const k of ["pro", "non", "para"] as const) {
      const orig = ad[k].list;
      let heads = 0;
      ad[k].list = async (l: number, o: number, f: URLSearchParams) => { if (o === 0) heads++; return orig(l, o, f); };
      per[k] = 0;
      (ad as any)["_h" + k] = () => heads;
    }
    await handle(req("/v1/random?n=20&seed=s"), {}, ad);
    for (const k of ["pro", "non", "para"]) expect((ad as any)["_h" + k]()).toBeLessThanOrEqual(1);
    const ids = b.items.map((i: any) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("default mix uses available adapters; 503 when none", async () => {
    const r = await handle(req("/v1/random?seed=s&n=5"), {}, { pro: fakeAdapter("pro", 10) });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).items.every((i: any) => i.corpus === "pro")).toBe(true);
    expect((await handle(req("/v1/random"), {}, { contra: contra() })).status).toBe(503);
    expect((await handle(req("/v1/random?corpus=pro,non"), {}, { pro: fakeAdapter("pro", 10) })).status).toBe(503);
  });
  it("n >= total returns all items, shuffled deterministically", async () => {
    const q = "/v1/pro/random?n=5&seed=z";
    const a = await (await handle(req(q), {}, { pro: fakeAdapter("pro", 5) })).json() as any;
    const b = await (await handle(req(q), {}, { pro: fakeAdapter("pro", 5) })).json() as any;
    expect(new Set(a.items.map((i: any) => i.id)).size).toBe(5);
    expect(a.items.map((i: any) => i.id)).toEqual(b.items.map((i: any) => i.id));
  });
  it("picks offsets concurrently", async () => {
    const ad = fakeAdapter("pro", 100);
    let inflight = 0, peak = 0;
    const orig = ad.list;
    ad.list = async (l: number, o: number, f: URLSearchParams) => {
      inflight++; peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      try { return await orig(l, o, f); } finally { inflight--; }
    };
    const items = await pickRandom(ad, 10, rng("c"), new URLSearchParams());
    expect(items.length).toBe(10);
    expect(peak).toBeGreaterThan(1);
    const again = await pickRandom(fakeAdapter("pro", 100), 10, rng("c"), new URLSearchParams());
    expect(items.map((i) => i.id)).toEqual(again.map((i) => i.id));
  });
  it("default mix skips a failing corpus; explicit list fails strictly; all failing errors", async () => {
    const { ApiError } = await import("../src/contract.js");
    const bad = (c: Corpus) => ({ ...fakeAdapter(c, 10), list: async () => { throw new ApiError(503, "unavailable", "down"); } });
    const ad = { pro: fakeAdapter("pro", 10), non: bad("non"), para: fakeAdapter("para", 10) };
    for (const s of ["a", "b", "c", "d"]) {
      const r = await handle(req(`/v1/random?seed=${s}&n=8`), {}, ad);
      const b = await r.json() as any;
      expect(r.status).toBe(200);
      expect(b.items.length).toBe(8);
      expect(b.items.every((i: any) => i.corpus !== "non")).toBe(true);
    }
    expect((await handle(req("/v1/random?corpus=pro,non&seed=a&n=8"), {}, ad)).status).toBe(503);
    const allBad = { pro: bad("pro"), non: bad("non"), para: bad("para") };
    expect((await handle(req("/v1/random?seed=a"), {}, allBad)).status).toBe(503);
  });
});

describe("degraded mixed random", () => {
  it("marks no-store and x-verba-degraded when a corpus is skipped, tolerating any error", async () => {
    const broken: Adapter = { ...fakeAdapter("non", 10), list: async () => { throw new TypeError("kaboom"); } };
    const adapters = { pro: fakeAdapter("pro", 10), non: broken, para: fakeAdapter("para", 10) };
    let hit = false;
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const r = await handle(req(`/v1/random?seed=${seed}&n=10`), {}, adapters);
      expect(r.status).toBe(200);
      if (r.headers.get("x-verba-degraded")) {
        hit = true;
        expect(r.headers.get("x-verba-degraded")).toBe("non");
        expect(r.headers.get("cache-control")).toBe("no-store");
      }
    }
    expect(hit).toBe(true);
  });
});

import { pickCardFriendly } from "../src/random";

describe("pickCardFriendly", () => {
  const mk = (titles: string[]) => ({
    list: async (_l: number, offset: number) => ({ total: titles.length, items: [{ id: `pro:${offset}`, title: titles[offset] }] }),
  }) as any;
  const long = "д".repeat(300), short = "коротко", good = "Добре слово на кожен день, друже";
  const titles = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? long : i % 5 === 1 ? short : good + i));
  it("prefers titles of 18-120 characters", async () => {
    for (let i = 0; i < 30; i++) {
      const it = await pickCardFriendly(mk(titles), rng("s" + i), new URLSearchParams());
      expect(it!.title.length).toBeGreaterThanOrEqual(18);
      expect(it!.title.length).toBeLessThanOrEqual(120);
    }
  });
  it("is deterministic for a seed", async () => {
    const a = await pickCardFriendly(mk(titles), rng("abc"), new URLSearchParams());
    const b = await pickCardFriendly(mk(titles), rng("abc"), new URLSearchParams());
    expect(a!.id).toBe(b!.id);
  });
  it("falls back to the shortest drawn when none qualifies", async () => {
    const it = await pickCardFriendly(mk([long, long + "x", "ab"]), rng("z"), new URLSearchParams());
    expect(it!.title.length).toBeLessThan(18);
  });
});
