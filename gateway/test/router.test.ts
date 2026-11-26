import { describe, expect, it, vi } from "vitest";
import { handle } from "../src/router.js";
import type { Adapter } from "../src/adapters/types.js";
import { countingVerba, failing, fakeNasinnia, fakePro, fakeUpa, fakeVerba, fonts, recordingUpa } from "./fakes.js";

const req = (path: string, init?: RequestInit) => new Request("https://api.test" + path, init);
const all = () => ({ PRO: fakePro() as any, UPA: fakeUpa() as any, FONTS: fakeNasinnia(fonts(3)) as any });

describe("router", () => {
  it("corpora survives a dead upstream", async () => {
    const r = await handle(req("/v1/corpora"), { PRO: fakeVerba() as any, FONTS: fakeNasinnia(fonts(3)) as any });
    const b = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(b.apiVersion).toBe("v1");
    expect(b.corpora.map((c: any) => c.corpus).sort()).toEqual(["contra", "non", "para", "pro"]);
    expect(b.corpora.find((c: any) => c.corpus === "non")).toMatchObject({ total: null, available: false });
    expect(b.corpora.find((c: any) => c.corpus === "para")).toMatchObject({ total: 3, available: true, licence: null });
    expect(b.corpora.find((c: any) => c.corpus === "pro").licence.id).toBe("CC-BY-4.0");
  });

  it("corpora tolerates an adapter that throws", async () => {
    const bad: Adapter = { corpus: "pro", meta: async () => { throw new TypeError("x"); }, list: async () => ({ total: 0, items: [] }), get: async () => null };
    const r = await handle(req("/v1/corpora"), {}, { pro: bad });
    expect(r.status).toBe(200);
  });

  it("meta", async () => {
    const r = await handle(req("/v1/pro/meta"), all());
    const b = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(b).toMatchObject({ apiVersion: "v1", corpus: "pro" });
    expect(typeof b.total).toBe("number");
  });

  it("items list with paging and cache", async () => {
    const r = await handle(req("/v1/pro/items?limit=2&offset=0"), all());
    const b = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(b.items.length).toBe(2);
    expect(b.limit).toBe(2);
    expect(b.nextOffset).toBe(b.total > 2 ? 2 : null);
  });

  it("default limit is 50", async () => {
    const b = (await (await handle(req("/v1/para/items"), all())).json()) as any;
    expect(b.limit).toBe(50);
    expect(b.nextOffset).toBeNull();
  });

  it.each(["limit=0", "limit=101", "limit=abc", "limit=1.5", "offset=-1", "offset=x"])("rejects %s without calling upstream", async (q) => {
    const spy = countingVerba();
    const r = await handle(req("/v1/pro/items?" + q), { PRO: spy as any });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe("invalid_request");
    expect(spy.calls).toBe(0);
  });

  it("missing binding is 503", async () => {
    const r = await handle(req("/v1/non/items"), {});
    expect(r.status).toBe(503);
    expect(((await r.json()) as any).error.code).toBe("unavailable");
  });

  it("unknown corpus and path are 404", async () => {
    for (const p of ["/v1/xyz/items", "/v1/pro/nope", "/nope", "/v1/pro/items/a/b"]) {
      const r = await handle(req(p), all());
      expect(r.status).toBe(404);
      expect(((await r.json()) as any).error.code).toBe("not_found");
    }
  });

  it("single item by local id and 404", async () => {
    const list = (await (await handle(req("/v1/pro/items?limit=1"), all())).json()) as any;
    const local = list.items[0].id.slice("pro:".length);
    const ok = await handle(req("/v1/pro/items/" + encodeURIComponent(local)), all());
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).id).toBe(list.items[0].id);
    expect((await handle(req("/v1/pro/items/does-not-exist"), all())).status).toBe(404);
  });

  it("global id resolution", async () => {
    const list = (await (await handle(req("/v1/pro/items?limit=1"), all())).json()) as any;
    const r = await handle(req("/v1/items/" + encodeURIComponent(list.items[0].id)), all());
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).id).toBe(list.items[0].id);
    expect((await handle(req("/v1/items/nocolon"), all())).status).toBe(404);
    expect((await handle(req("/v1/items/zzz:1"), all())).status).toBe(404);
  });

  it("decodes ids with slash and cyrillic", async () => {
    const up = recordingUpa();
    await handle(req("/v1/items/" + encodeURIComponent("non:p15_-_b02")), { UPA: up as any });
    expect(up.lastPath).toBe("/api/v1/patterns/p15_-_b02");
    expect((await handle(req("/v1/items/%E0%A4%A"), { UPA: up as any })).status).toBe(400);
    await handle(req("/v1/non/items/" + encodeURIComponent("а/б")), { UPA: up as any });
    expect(up.lastPath).toContain("/api/v1/patterns/");
  });

  it("upstream 500 is 503 unavailable", async () => {
    const r = await handle(req("/v1/pro/items"), { PRO: failing(500) as any });
    expect(r.status).toBe(503);
    expect(((await r.json()) as any).error.code).toBe("unavailable");
  });

  it("upstream bad JSON is 502", async () => {
    const bad = { fetch: async () => new Response("<html>", { status: 200 }) };
    const r = await handle(req("/v1/pro/items"), { PRO: bad as any });
    expect(r.status).toBe(502);
    expect(((await r.json()) as any).error.code).toBe("upstream_error");
  });

  it("corpora does not hang on a never-resolving upstream", async () => {
    vi.useFakeTimers();
    try {
      const hang = { fetch: () => new Promise<Response>(() => {}) };
      const p = handle(req("/v1/corpora"), { PRO: hang as any, UPA: fakeUpa() as any });
      await vi.advanceTimersByTimeAsync(2600);
      const b = (await (await p).json()) as any;
      expect(b.corpora.find((c: any) => c.corpus === "pro")).toMatchObject({ total: null, available: false });
      expect(b.corpora.find((c: any) => c.corpus === "non").available).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("global id with slash and cyrillic reaches upstream exactly encoded", async () => {
    const up = recordingUpa();
    await handle(req("/v1/items/" + encodeURIComponent("non:а/б")), { UPA: up as any });
    expect(up.lastPath).toBe("/api/v1/patterns/" + encodeURIComponent("а/б"));
  });

  it("local id with percent reaches upstream exactly encoded", async () => {
    const up = recordingUpa();
    await handle(req("/v1/non/items/p%25x"), { UPA: up as any });
    expect(up.lastPath).toBe("/api/v1/patterns/p%25x");
  });

  it("non-ApiError becomes 502 upstream_error", async () => {
    const bad: Adapter = { corpus: "pro", meta: async () => { throw new TypeError("x"); }, list: async () => { throw new TypeError("x"); }, get: async () => null };
    const r = await handle(req("/v1/pro/items"), {}, { pro: bad });
    expect(r.status).toBe(502);
    expect(((await r.json()) as any).error.code).toBe("upstream_error");
  });

  it("405 for other methods", async () => {
    const r = await handle(req("/v1/corpora", { method: "POST" }), {});
    expect(r.status).toBe(405);
  });

  it("CORS preflight", async () => {
    const r = await handle(new Request("https://api/v1/corpora", { method: "OPTIONS" }), {});
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it.each(["/v1/items/para:.", "/v1/items/para:..", "/v1/items/para:%2E%2E", "/v1/non/items/..", "/v1/non/items/%2e%2e"]) (
    "dot local id %s is 404 without upstream calls",
    async (path) => {
      const spy = countingVerba();
      const r = await handle(req(path), { PRO: spy as any, UPA: spy as any, FONTS: spy as any });
      expect(r.status).toBe(404);
      expect(((await r.json()) as any).error.code).toBe("not_found");
      expect(spy.calls).toBe(0);
    },
  );

  it("random responses expose x-verba-seed to CORS", async () => {
    const r = await handle(req("/v1/pro/random?seed=a"), all());
    expect(r.headers.get("access-control-expose-headers")).toBe("x-verba-seed, x-verba-degraded");
    expect((await handle(req("/v1/corpora", { method: "OPTIONS" }), all())).headers.get("access-control-expose-headers")).toBe("x-verba-seed, x-verba-degraded");
    expect((await handle(req("/v1/docs"), all())).headers.get("access-control-expose-headers")).toBe("x-verba-seed, x-verba-degraded");
  });

  it("corpora is no-store when a corpus is unavailable, cached when all are available", async () => {
    const down = await handle(req("/v1/corpora"), { PRO: fakeVerba() as any });
    expect(down.headers.get("cache-control")).toBe("no-store");
    const mk = (corpus: any): Adapter => ({ corpus, meta: async () => ({ total: 1 }), list: async () => ({ total: 0, items: [] }), get: async () => null });
    const up = await handle(req("/v1/corpora"), {}, { pro: mk("pro"), contra: mk("contra"), non: mk("non"), para: mk("para") });
    expect(up.headers.get("cache-control")).toBe("public, max-age=300");
  });
});
