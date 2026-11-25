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

type Listed = { total: number; items: Item[] };

// Picks up to n distinct items given the already-fetched head (list(1,0)).
async function pickWithHead(
  adapter: Adapter,
  head: Listed,
  n: number,
  next: () => number,
  filters: URLSearchParams,
): Promise<Item[]> {
  const total = head.total;
  if (total <= 0) return [];
  let offsets: number[];
  if (n >= total) {
    offsets = Array.from({ length: total }, (_, i) => i);
    for (let i = total - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
    }
  } else {
    offsets = [];
    const seen = new Set<number>();
    for (let attempts = 0; offsets.length < n && attempts < n * 5; attempts++) {
      const offset = Math.floor(next() * total);
      if (seen.has(offset)) continue;
      seen.add(offset);
      offsets.push(offset);
    }
  }
  const items: Item[] = [];
  for (const offset of offsets) {
    const r = offset === 0 && head.items[0] ? head : await adapter.list(1, offset, filters);
    if (r.items[0]) items.push(r.items[0]);
  }
  return items;
}

export async function pickRandom(
  adapter: Adapter,
  n: number,
  next: () => number,
  filters: URLSearchParams,
): Promise<Item[]> {
  return pickWithHead(adapter, await adapter.list(1, 0, filters), n, next, filters);
}

// Assigns a corpus to each of the n draws first, fetches each involved
// corpus's total once, then picks distinct offsets per corpus.
export async function pickMixed(
  adapters: Partial<Record<Corpus, Adapter>>,
  corpora: Corpus[],
  n: number,
  next: () => number,
): Promise<Item[]> {
  const draws: Corpus[] = [];
  for (let i = 0; i < n; i++) draws.push(corpora[Math.floor(next() * corpora.length)]);
  const none = new URLSearchParams();
  const queues = new Map<Corpus, Item[]>();
  for (const corpus of new Set(draws)) {
    const adapter = adapters[corpus];
    if (!adapter) continue;
    const count = draws.filter((c) => c === corpus).length;
    queues.set(corpus, await pickWithHead(adapter, await adapter.list(1, 0, none), count, next, none));
  }
  const out: Item[] = [];
  for (const c of draws) {
    const item = queues.get(c)?.shift();
    if (item) out.push(item);
  }
  return out;
}
