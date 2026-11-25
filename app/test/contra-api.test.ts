import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

async function call(path: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://x" + path), env as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("/api/v1/contra", () => {
  it("describes the corpus", async () => {
    const res = await call("/api/v1/contra");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({ apiVersion: "v1", total: 4, groups: ["Частини тіла людини"] });
  });

  it("lists unique entries and merges duplicates", async () => {
    const res = await call("/api/v1/contra/items?limit=10");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const b = (await res.json()) as any;
    expect(b).toMatchObject({ apiVersion: "v1", total: 4, limit: 10, offset: 0 });
    expect(b.items).toHaveLength(4);
    expect(b.items.map((i: any) => i.synonym)).toEqual(["агрегат", "антена", "апарат", "аргумент"]);
    expect(b.items[0]).toEqual({
      id: "cd325d32fe",
      group: "Частини тіла людини",
      term: "Чоловічий статевий орган",
      synonym: "агрегат",
      isWord: true,
      emoji: "🍆",
      sourceRows: [2, 5],
    });
    expect(b.items[2].emoji).toBeNull();
    expect(new Set(b.items.map((i: any) => i.id)).size).toBe(4);
  });

  it("paginates and filters", async () => {
    const page = (await (await call("/api/v1/contra/items?limit=2&offset=3")).json()) as any;
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(1);
    const none = (await (await call("/api/v1/contra/items?group=nope")).json()) as any;
    expect(none).toMatchObject({ total: 0, items: [], limit: 50 });
    const t = (await (await call("/api/v1/contra/items?term=" + encodeURIComponent("статевий"))).json()) as any;
    expect(t.total).toBe(4);
  });

  it("gets one entry by id and 404s on unknown", async () => {
    const res = await call("/api/v1/contra/items/cd325d32fe");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).sourceRows).toEqual([2, 5]);
    const miss = await call("/api/v1/contra/items/nope");
    expect(miss.status).toBe(404);
    expect(miss.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await miss.json()) as any).error.code).toBe("not_found");
  });

  it("rejects bad limit/offset", async () => {
    for (const q of ["limit=0", "limit=201", "limit=x", "offset=-1"]) {
      const res = await call("/api/v1/contra/items?" + q);
      expect(res.status, q).toBe(400);
      expect(((await res.json()) as any).error.code).toBe("invalid_request");
    }
  });

  it("leaves other routes alone", async () => {
    expect((await call("/api/v1/random")).status).toBe(200);
    // At base 2a7f8b0 the fixture site has no bez-tabu page: /bez-tabu/ fell through to ASSETS and was an
    // empty 404 (no content-type); the new fixture data file must not change that.
    const page = await call("/bez-tabu/");
    expect(page.status).toBe(404);
    expect(page.headers.get("content-type")).toBeNull();
    expect(await page.text()).toBe("");
    expect((await call("/api/v1/nothing-here")).status).toBe(404);
    expect((await call("/api/contra/items")).status).toBe(200);
  });
});
