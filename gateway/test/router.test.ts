import { describe, expect, it } from "vitest";
import { handle } from "../src/router.js";
import type { Adapter } from "../src/adapters/types.js";
import { countingVerba, fakeNasinnia, fakePro, fakeUpa, fakeVerba, fonts, recordingUpa } from "./fakes.js";

const req = (path: string, init?: RequestInit) => new Request("https://api.test" + path, init);
const all = () => ({ PRO: fakePro() as any, UPA: fakeUpa() as any, FONTS: fakeNasinnia(fonts(3)) as any });

describe("router", () => {
  it("corpora survives a dead upstream", async () => {
    const r = await handle(req("/v1/corpora"), { PRO: fakeVerba() as any, FONTS: fakeNasinnia(fonts(3)) as any });
    const b = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
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
});
