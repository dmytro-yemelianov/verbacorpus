import { API_BASE, LICENCES, globalId, type Item } from "../contract.js";
import { fetchJson, pickFilters, type Adapter, type Upstream } from "./types.js";

const FILTERS = ["kind", "color", "frieze", "q", "include"] as const;

interface Pattern {
  patternId: string;
  name: string;
  catalogPage: number;
  [k: string]: unknown;
}

function toItem(p: Pattern): Item {
  return {
    id: globalId("non", p.patternId),
    corpus: "non",
    title: p.name,
    licence: LICENCES.non,
    links: {
      self: `${API_BASE}/v1/non/items/${encodeURIComponent(p.patternId)}`,
      html: `https://non.verbacorpus.org/upa/catalog?page=${p.catalogPage}#${p.patternId}`,
    },
    data: p,
  };
}

export function makeNonAdapter(up: Upstream): Adapter {
  return {
    corpus: "non",
    async meta() {
      const m = (await fetchJson(up, "/api/v1")) as { corpus: { patterns: number } };
      return { total: m.corpus.patterns };
    },
    async list(limit, offset, filters) {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      pickFilters(filters, FILTERS, q);
      const r = (await fetchJson(up, `/api/v1/patterns?${q}`)) as { total: number; items: Pattern[] };
      return { total: r.total, items: r.items.map(toItem) };
    },
    async get(localId) {
      const r = (await fetchJson(up, `/api/v1/patterns/${encodeURIComponent(localId)}`, true)) as
        | { pattern: Pattern }
        | null;
      return r ? toItem(r.pattern) : null;
    },
  };
}
