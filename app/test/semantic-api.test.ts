import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
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
});

describe("/api/similar/:id", () => {
  it("excludes the query id", async () => {
    const vectorize = {
      getByIds: async () => [{ id: "p1", values: [0.1, 0.2] }],
      query: async () => ({ matches: [{ id: "p1", score: 1.0 }, { id: "p2", score: 0.8 }] }),
    };
    const body = await (await call("/api/similar/p1", vectorize)).json() as any;
    expect(body.results.map((r: any) => r.id)).toEqual(["p2"]);
  });
  it("404 when id not indexed", async () => {
    const vectorize = { getByIds: async () => [] };
    expect((await call("/api/similar/zz", vectorize)).status).toBe(404);
  });
});
