import type { Corpus, Item } from "./contract.js";
import type { Adapter } from "./adapters/types.js";

// FNV-1a 32-bit hash of the string, fed into mulberry32. Returns [0,1).
export function rng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function pickRandom(
  adapter: Adapter,
  n: number,
  next: () => number,
  filters: URLSearchParams,
): Promise<Item[]> {
  const { total } = await adapter.list(1, 0, filters);
  if (total <= 0) return [];
  const want = Math.min(n, total);
  const offsets: number[] = [];
  const seen = new Set<number>();
  for (let attempts = 0; offsets.length < want && attempts < n * 5; attempts++) {
    const offset = Math.floor(next() * total);
    if (seen.has(offset)) continue;
    seen.add(offset);
    offsets.push(offset);
  }
  const items: Item[] = [];
  for (const offset of offsets) {
    const r = await adapter.list(1, offset, filters);
    if (r.items[0]) items.push(r.items[0]);
  }
  return items;
}

export async function pickMixed(
  adapters: Partial<Record<Corpus, Adapter>>,
  corpora: Corpus[],
  n: number,
  next: () => number,
): Promise<Item[]> {
  const out: Item[] = [];
  const none = new URLSearchParams();
  for (let i = 0; i < n; i++) {
    const corpus = corpora[Math.floor(next() * corpora.length)];
    const adapter = adapters[corpus];
    if (!adapter) continue;
    out.push(...(await pickRandom(adapter, 1, next, none)));
  }
  return out;
}
