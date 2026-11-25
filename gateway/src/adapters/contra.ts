import { API_BASE, LICENCES, globalId, type Item } from "../contract.js";
import { fetchJson, pickFilters, type Adapter, type Upstream } from "./types.js";

const FILTERS = ["group", "term"] as const;

interface ContraEntry {
  id: string;
  group: string;
  term: string;
  synonym: string;
  isWord: boolean;
  emoji: string | null;
  sourceRows: number[];
}

function toItem(e: ContraEntry): Item {
  return {
    id: globalId("contra", e.id),
    corpus: "contra",
    title: `${e.synonym} — ${e.term}`,
    licence: LICENCES.contra,
    links: {
      self: `${API_BASE}/v1/contra/items/${encodeURIComponent(e.id)}`,
      html: `https://contra.verbacorpus.org/?q=${encodeURIComponent(e.synonym)}`,
    },
    data: e,
  };
}

export function makeContraAdapter(up: Upstream): Adapter {
  return {
    corpus: "contra",
    async meta() {
      const m = (await fetchJson(up, "/api/v1/contra")) as { total: number };
      return { total: m.total };
    },
    async list(limit, offset, filters) {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      pickFilters(filters, FILTERS, q);
      const r = (await fetchJson(up, `/api/v1/contra/items?${q}`)) as { total: number; items: ContraEntry[] };
      return { total: r.total, items: r.items.map(toItem) };
    },
    async get(localId) {
      const r = (await fetchJson(up, `/api/v1/contra/items/${encodeURIComponent(localId)}`, true)) as ContraEntry | null;
      return r ? toItem(r) : null;
    },
  };
}
