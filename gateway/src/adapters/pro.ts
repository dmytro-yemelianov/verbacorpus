import { API_BASE, LICENCES, globalId, type Item } from "../contract.js";
import { fetchJson, pickFilters, type Adapter, type Upstream } from "./types.js";

const FILTERS = ["category", "source"] as const;

interface Proverb {
  id: string;
  text: string;
  [k: string]: unknown;
}

function toItem(p: Proverb): Item {
  return {
    id: globalId("pro", p.id),
    corpus: "pro",
    title: p.text,
    licence: LICENCES.pro,
    links: {
      self: `${API_BASE}/v1/pro/items/${encodeURIComponent(p.id)}`,
      html: `https://pro.verbacorpus.org/p/${p.id}`,
    },
    data: p,
  };
}

export function makeProAdapter(up: Upstream): Adapter {
  return {
    corpus: "pro",
    async meta() {
      const m = (await fetchJson(up, "/api/v1/meta")) as { count: number };
      return { total: m.count };
    },
    async list(limit, offset, filters) {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      pickFilters(filters, FILTERS, q);
      const r = (await fetchJson(up, `/api/v1/query?${q}`)) as { total: number; results: Proverb[] };
      return { total: r.total, items: r.results.map(toItem) };
    },
    async get(localId) {
      const p = (await fetchJson(up, `/api/v1/proverb/${encodeURIComponent(localId)}`, true)) as Proverb | null;
      return p ? toItem(p) : null;
    },
  };
}
