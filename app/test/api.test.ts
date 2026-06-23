import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

async function call(path: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://x" + path), env as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("API", () => {
  it("search by q", async () => {
    const res = await call("/api/search?q=робота");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json() as any;
    expect(body.total).toBe(1);
    expect(body.results[0].id).toBe("p2");
  });
  it("proverb by id includes explanation", async () => {
    const body = await (await call("/api/proverb/p1")).json() as any;
    expect(body.explanation).toBe("Про горе.");
  });
  it("404 on unknown id and unknown api route", async () => {
    expect((await call("/api/proverb/zzz")).status).toBe(404);
    expect((await call("/api/nope")).status).toBe(404);
  });
  it("categories with counts", async () => {
    const body = await (await call("/api/categories")).json() as any;
    expect(body.find((c: any) => c.key === "work_labor").count).toBe(1);
  });
});
