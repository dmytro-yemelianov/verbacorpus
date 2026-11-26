// Proverb corpus loaded from the static assets, cached per isolate. Shared by the routes
// in index.ts and the card renderer.
import type { Proverb } from "./shared/corpus";

export type CorpusData = { proverbs: Proverb[]; explanations: Record<string, string>; meta: any; byId: Map<string, Proverb> };
export interface CorpusEnv { ASSETS: { fetch: (req: Request | string) => Promise<Response> } }

let cache: CorpusData | null = null;

export async function loadCorpus(env: CorpusEnv): Promise<CorpusData> {
  if (cache) return cache;
  // Pending asset I/O belongs to this invocation. Cache only fully decoded data,
  // so a cancelled or stalled cold request cannot block another invocation.
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
  cache ??= { proverbs, explanations, meta, byId: new Map(proverbs.map((p) => [p.id, p])) };
  return cache;
}
