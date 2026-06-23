import { searchProverbs, randomProverb, type Proverb } from "./shared/corpus";
import { mapMatches, type Match } from "./shared/semantic";

interface Env {
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
  AI: { run: (model: string, inputs: { text: string[] }) => Promise<{ data: number[][] }> };
  VECTORIZE: {
    query: (vector: number[], opts: { topK: number }) => Promise<{ matches: Match[] }>;
    getByIds: (ids: string[]) => Promise<Array<{ id: string; values: number[] }>>;
  };
}

const SEMANTIC_MIN_SCORE = 0.4;

let cache: Promise<{ proverbs: Proverb[]; explanations: Record<string, string>; meta: any }> | null = null;

function load(env: Env) {
  if (!cache) {
    cache = (async () => {
      const get = async (p: string) => {
        const res = await env.ASSETS.fetch("https://assets" + p);
        if (!res.ok) throw new Error(`Failed to fetch ${p}: ${res.status}`);
        return res.json();
      };
      const [proverbs, explanations, meta] = await Promise.all([
        get("/data/proverbs.json") as Promise<Proverb[]>,
        get("/data/explanations.json") as Promise<Record<string, string>>,
        get("/data/meta.json") as Promise<any>,
      ]);
      return { proverbs, explanations, meta };
    })().catch((err) => { cache = null; throw err; });
  }
  return cache;
}

const J = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });

/** Returns the number if finite, otherwise undefined (guards against NaN / Infinity). */
function finiteOrUndef(n: number): number | undefined {
  return Number.isFinite(n) ? n : undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
      const { proverbs, explanations, meta } = await load(env);
      const qp = url.searchParams;

      if (path === "/api/search") {
        return J(searchProverbs(proverbs, {
          q: qp.get("q") ?? undefined, category: qp.get("category") ?? undefined,
          source: qp.get("source") ?? undefined,
          limit: finiteOrUndef(Number(qp.get("limit"))),
          offset: finiteOrUndef(Number(qp.get("offset"))),
        }));
      }
      if (path === "/api/random") {
        const p = randomProverb(proverbs, { category: qp.get("category") ?? undefined, source: qp.get("source") ?? undefined });
        return p ? J(p) : J({ error: "no match" }, 404);
      }
      if (path === "/api/categories") {
        const counts = meta.per_category ?? {};
        return J(Object.entries(meta.taxonomy as Record<string, string>).map(([key, label]) => ({ key, label, count: counts[key] ?? 0 })));
      }
      if (path === "/api/meta") return J(meta);
      const m = path.match(/^\/api\/proverb\/(.+)$/);
      if (m) {
        const p = proverbs.find((x) => x.id === decodeURIComponent(m[1]));
        return p ? J({ ...p, explanation: explanations[p.id] ?? null }) : J({ error: "not found" }, 404);
      }
      if (path === "/api/semantic") {
        const q = (qp.get("q") ?? "").trim();
        if (!q) return J({ error: "missing q" }, 400);
        if (!env.AI || !env.VECTORIZE) return J({ error: "semantic search unavailable" }, 503);
        try {
          const { data } = await env.AI.run("@cf/baai/bge-m3", { text: [q] });
          const { matches } = await env.VECTORIZE.query(data[0], { topK: 100 });
          const byId = new Map(proverbs.map((p) => [p.id, p]));
          const minScore = qp.get("minScore") ? Number(qp.get("minScore")) : SEMANTIC_MIN_SCORE;
          return J(mapMatches(matches, byId, {
            category: qp.get("category") ?? undefined,
            source: qp.get("source") ?? undefined,
            minScore: Number.isFinite(minScore) ? minScore : SEMANTIC_MIN_SCORE,
            limit: qp.get("limit") ? Number(qp.get("limit")) : undefined,
          }));
        } catch {
          return J({ error: "semantic search failed" }, 502);
        }
      }
      const sim = path.match(/^\/api\/similar\/(.+)$/);
      if (sim) {
        if (!env.VECTORIZE) return J({ error: "semantic search unavailable" }, 503);
        const id = decodeURIComponent(sim[1]);
        try {
          const recs = await env.VECTORIZE.getByIds([id]);
          if (!recs.length) return J({ error: "not indexed" }, 404);
          const lim = qp.get("limit") ? Number(qp.get("limit")) : 6;
          const { matches } = await env.VECTORIZE.query(recs[0].values, { topK: Math.min((Number.isFinite(lim) ? lim : 6) + 1, 100) });
          const byId = new Map(proverbs.map((p) => [p.id, p]));
          return J(mapMatches(matches, byId, { excludeId: id, limit: Number.isFinite(lim) ? lim : 6 }));
        } catch {
          return J({ error: "similar lookup failed" }, 502);
        }
      }
      return J({ error: "unknown endpoint" }, 404);
    } catch {
      return J({ error: "internal error" }, 500);
    }
  },
};
