import { describe, it, expect } from "vitest";
import worker from "../src/index.js";
import { fakePro, fakeUpa, fakeNasinniaFixture } from "./fakes.js";

// The Workers runtime calls fetch(request, env, ctx); ctx must not be mistaken for adapters.
describe("worker entry", () => {
  it("builds adapters from bindings even when the runtime passes an ExecutionContext", async () => {
    const env = { PRO: fakePro(), UPA: fakeUpa(), FONTS: fakeNasinniaFixture() } as any;
    const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
    const res = await worker.fetch(new Request("https://api/v1/pro/items?limit=1"), env, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items[0].id).toMatch(/^pro:/);
  });
});
