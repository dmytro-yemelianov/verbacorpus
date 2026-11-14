import { expect, it, vi } from "vitest";

it("a cold request can load the corpus while another request's asset I/O is stalled", async () => {
  vi.resetModules();
  const { default: worker } = await import("../src/index");
  type Env = Parameters<typeof worker.fetch>[1];
  const proverb = { id: "p1", text: "Горе море", modern_text: "Горе море", category: [], sources: [], variant_group: "" };
  const asset = (url: Request | string) => {
    const path = new URL(typeof url === "string" ? url : url.url).pathname;
    return Response.json(path.endsWith("proverbs.json") ? [proverb] : path.endsWith("meta.json") ? { count: 1 } : {});
  };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const stalledFetch = vi.fn(async (url: Request | string) => { await pending; return asset(url); });
  const healthyFetch = vi.fn(async (url: Request | string) => asset(url));
  const request = () => new Request("https://example.test/api/v1/search?limit=1");
  const call = (fetch: Env["ASSETS"]["fetch"]) => {
    const bindings: Partial<Env> = { ASSETS: { fetch } };
    return worker.fetch(request(), bindings as Env);
  };
  const stalled = call(stalledFetch);
  await expect.poll(() => stalledFetch.mock.calls.length).toBe(3);
  const healthy = call(healthyFetch);
  try {
    // Each invocation owns its I/O. A second invocation must not await the first one's promise.
    await expect.poll(() => healthyFetch.mock.calls.length, { timeout: 1_000 }).toBe(3);
    expect(await (await healthy).json()).toMatchObject({ total: 1, results: [{ id: "p1" }] });
  } finally {
    release();
    await Promise.all([stalled, healthy]);
  }
  const warm = await call(healthyFetch);
  expect(warm.status).toBe(200);
  expect(healthyFetch).toHaveBeenCalledTimes(3);
});
