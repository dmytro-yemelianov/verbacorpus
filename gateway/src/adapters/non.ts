import { API_BASE, LICENCES, globalId, type Item } from "../contract.js";
import { fetchJson, pickFilters, type Adapter, type Upstream } from "./types.js";

const FILTERS = ["kind", "color", "frieze", "q", "include"] as const;

interface Pattern {
  patternId: string;
  name: string;
  catalogPage: number | null;
  [k: string]: unknown;
}

const NON_ORIGIN = "https://non.verbacorpus.org";

// Upstream links.catalog is relative ("/upa/catalog?..." or "/catalog?...");
// make it absolute with the /upa prefix exactly once.
function htmlLink(p: Pattern): string {
  const catalog = (p.links as { catalog?: unknown } | undefined)?.catalog;
  if (p.catalogPage != null && typeof catalog === "string" && catalog.startsWith("/")) {
    const path = catalog === "/upa" || catalog.startsWith("/upa/") || catalog.startsWith("/upa?") || catalog.startsWith("/upa#")
      ? catalog
      : "/upa" + catalog;
    return NON_ORIGIN + path;
  }
  return `${NON_ORIGIN}/upa/catalog#${p.patternId}`;
}

function toItem(p: Pattern): Item {
  return {
    id: globalId("non", p.patternId),
    corpus: "non",
    title: p.name,
    licence: LICENCES.non,
    links: {
      self: `${API_BASE}/v1/non/items/${encodeURIComponent(p.patternId)}`,
      html: htmlLink(p),
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
