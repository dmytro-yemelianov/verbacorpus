import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const AI = { run: async () => ({ data: [[0.1, 0.2]] }) };
const VEC = { query: async () => ({ matches: [{ id: "p1", score: 0.9 }] }), getByIds: async () => [{ id: "p1", values: [0.1, 0.2] }] };
async function call(path: string, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://x" + path, { headers }), { ...env, AI, VEC: VEC, VECTORIZE: VEC } as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("/api/v1 formats", () => {
  it("search json default has envelope + X-Total-Count + CORS", async () => {
    const res = await call("/api/v1/search?q=", {});
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-total-count")).toBeTruthy();
    const b = await res.json() as any;
    expect(b).toHaveProperty("results"); expect(b).toHaveProperty("limit");
  });
  it("?format=csv yields text/csv + attachment", async () => {
    const res = await call("/api/v1/search?q=&format=csv");
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect((await res.text()).split("\n")[0]).toBe("id,text,modern_text,category,sources,variant_group,hook,hook_source");
  });
  it("Accept negotiation -> jsonl", async () => {
    const res = await call("/api/v1/search?q=", { accept: "application/x-ndjson" });
    expect(res.headers.get("content-type")).toContain("x-ndjson");
  });
  it("unknown format -> 400", async () => {
    expect((await call("/api/v1/search?format=yaml")).status).toBe(400);
  });
  it("query filters; export includes explanation column", async () => {
    expect((await call("/api/v1/query?source=Franko1901")).status).toBe(200);
    const csv = await (await call("/api/v1/export?format=csv")).text();
    expect(csv.split("\n")[0]).toContain("explanation");
  });
  it("alias /api/search still returns the old JSON shape", async () => {
    const b = await (await call("/api/search?q=")).json() as any;
    expect(b).toHaveProperty("total"); expect(b).toHaveProperty("results");
  });
  it("openapi served", async () => {
    const b = await (await call("/api/v1/openapi.json")).json() as any;
    expect(b.openapi).toBe("3.0.3");
  });
});
