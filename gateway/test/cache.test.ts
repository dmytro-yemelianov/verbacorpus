import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withCache } from "../src/cache.js";

let store: Map<string, Response>;
beforeEach(() => {
  store = new Map();
  (globalThis as any).caches = {
    default: {
      match: async (r: Request) => store.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => void store.set(r.url, res),
    },
  };
});
afterEach(() => delete (globalThis as any).caches);

const ctx = () => {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), pending } as any;
};
const make = (headers: Record<string, string>, status = 200) => {
  let calls = 0;
  return { fn: async () => (calls++, new Response("body", { status, headers })), get calls() { return calls; } };
};
const get = (url = "https://api/x") => new Request(url);

describe("withCache", () => {
  it("serves the second identical GET from cache", async () => {
    const c = ctx();
    const h = make({ "cache-control": "public, max-age=60" });
    await withCache(get(), c, h.fn);
    await Promise.all(c.pending);
    const r = await withCache(get(), c, h.fn);
    expect(await r.text()).toBe("body");
    expect(h.calls).toBe(1);
  });

  it.each([
    ["degraded", { "cache-control": "public, max-age=60", "x-verba-degraded": "pro" }, 200],
    ["no-store", { "cache-control": "no-store" }, 200],
    ["non-200", { "cache-control": "public, max-age=60" }, 404],
  ])("does not cache %s", async (_n, headers, status) => {
    const c = ctx();
    const h = make(headers as any, status as number);
    await withCache(get(), c, h.fn);
    await Promise.all(c.pending);
    await withCache(get(), c, h.fn);
    expect(h.calls).toBe(2);
  });

  it("does not cache POST", async () => {
    const c = ctx();
    const h = make({ "cache-control": "public, max-age=60" });
    const post = () => new Request("https://api/x", { method: "POST" });
    await withCache(post(), c, h.fn);
    await withCache(post(), c, h.fn);
    expect(h.calls).toBe(2);
    expect(store.size).toBe(0);
  });
});
