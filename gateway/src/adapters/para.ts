import { API_BASE, globalId, type Item, type Licence } from "../contract.js";
import { fetchJson, pickFilters, type Adapter, type Upstream } from "./types.js";

const FILTERS = ["q", "width", "height", "license"] as const;

interface Font {
  id: string;
  requestedId?: string;
  aliases?: string[];
  displayName?: string;
  availability?: string;
  license?: {
    id?: string;
    url?: string;
    attribution?: string;
    redistributionAllowed?: boolean;
  };
  [k: string]: unknown;
}

function licenceOf(font: Font): Licence {
  const granted = font.availability === "downloadable" && font.license?.redistributionAllowed === true;
  return {
    id: font.license?.id ?? null,
    status: granted ? "granted" : "metadata-only",
    attribution: font.license?.attribution ?? "",
    url: font.license?.url ?? null,
  };
}

function toItem(font: Font): Item {
  return {
    id: globalId("para", font.id),
    corpus: "para",
    title: font.displayName || font.id,
    licence: licenceOf(font),
    links: { self: `${API_BASE}/v1/para/items/${encodeURIComponent(font.id)}`, html: null },
    data: font,
  };
}

interface FontPage {
  data: Font[];
  pagination: { total: number };
}

export function makeParaAdapter(up: Upstream): Adapter {
  return {
    corpus: "para",
    async meta() {
      const r = (await fetchJson(up, "/v1/fonts?page=1&perPage=1")) as FontPage;
      return { total: r.pagination.total };
    },
    async list(limit, offset, filters) {
      const skip = offset % limit;
      const firstPage = Math.floor(offset / limit) + 1;
      const pages = skip === 0 ? [firstPage] : [firstPage, firstPage + 1];
      let total = 0;
      const fonts: Font[] = [];
      for (const page of pages) {
        const q = new URLSearchParams({ page: String(page), perPage: String(limit) });
        pickFilters(filters, FILTERS, q);
        const r = (await fetchJson(up, `/v1/fonts?${q}`)) as FontPage;
        total = r.pagination.total;
        fonts.push(...r.data);
      }
      return { total, items: fonts.slice(skip, skip + limit).map(toItem) };
    },
    async get(localId) {
      const f = (await fetchJson(up, `/v1/fonts/${encodeURIComponent(localId)}`, true)) as Font | null;
      return f && (f.id === localId || f.requestedId === localId || f.aliases?.includes(localId)) ? toItem(f) : null;
    },
  };
}
