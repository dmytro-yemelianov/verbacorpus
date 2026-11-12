import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import worker from "../src/index";

const fakeAI = { run: async () => ({ shape: [1, 2], data: [[0.1, 0.2]] }) };
function envWith(vectorize: any) {
  return { ...env, AI: fakeAI, VECTORIZE: vectorize } as any;
}
async function call(path: string, vectorize: any) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://x" + path), envWith(vectorize), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("/api/semantic", () => {
  it("uses the default 50-result page when limit is absent", async () => {
    const vectorize = { query: async () => ({ matches: [{ id: "p1", score: 0.9 }, { id: "p2", score: 0.8 }] }) };
    const body = await (await call("/api/v1/semantic?q=горе", vectorize)).json() as any;
    expect(body.limit).toBe(50);
    expect(body.results).toHaveLength(2);
  });
  it("returns scored proverbs above cutoff", async () => {
    const vectorize = { query: async () => ({ matches: [{ id: "p1", score: 0.9 }, { id: "p2", score: 0.1 }] }) };
    const body = await (await call("/api/semantic?q=горе&minScore=0.5", vectorize)).json() as any;
    expect(body.total).toBe(1);
    expect(body.results[0].id).toBe("p1");
    expect(body.results[0].score).toBe(0.9);
  });
  it("400 on missing q", async () => {
    expect((await call("/api/semantic", { query: async () => ({ matches: [] }) })).status).toBe(400);
  });
  it("503 when AI or VECTORIZE binding absent", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://x/api/semantic?q=горе"), { ...env, ASSETS: env.ASSETS } as any, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
  });
});

describe("/api/similar/:id", () => {
  it("requests six neighbours plus the query id when limit is absent", async () => {
    const query = vi.fn(async (_vector: number[], options: { topK: number }) => ({
      matches: [{ id: "p1", score: 1.0 }, { id: "p2", score: 0.8 }].slice(0, options.topK),
    }));
    const vectorize = {
      getByIds: async () => [{ id: "p1", values: [0.1, 0.2] }],
      query,
    };
    const body = await (await call("/api/similar/p1", vectorize)).json() as any;
    expect(query).toHaveBeenCalledWith([0.1, 0.2], { topK: 7 });
    expect(body.limit).toBe(6);
    expect(body.results.map((r: any) => r.id)).toEqual(["p2"]);
  });
  it("bounds a negative neighbour limit before querying Vectorize", async () => {
    const query = vi.fn(async () => ({ matches: [{ id: "p1", score: 1.0 }, { id: "p2", score: 0.8 }] }));
    const body = await (await call("/api/v1/similar/p1?limit=-1", {
      getByIds: async () => [{ id: "p1", values: [0.1, 0.2] }], query,
    })).json() as any;
    expect(query).toHaveBeenCalledWith([0.1, 0.2], { topK: 2 });
    expect(body.limit).toBe(1);
    expect(body.results.map((r: any) => r.id)).toEqual(["p2"]);
  });
  it("404 when id not indexed", async () => {
    const vectorize = { getByIds: async () => [] };
    expect((await call("/api/similar/zz", vectorize)).status).toBe(404);
  });
});
