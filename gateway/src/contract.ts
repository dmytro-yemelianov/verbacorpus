// Shared API contract for the verba-api gateway: corpus ids, licences,
// item shapes, and the JSON / error response envelope every route uses.

export type Corpus = "pro" | "contra" | "para" | "non";

export const CORPORA: readonly Corpus[] = ["pro", "contra", "para", "non"];

export type LicenceStatus = "granted" | "terms-pending" | "metadata-only";

export interface Licence {
  id: string | null;
  status: LicenceStatus;
  attribution: string;
  url: string | null;
}

export interface Item {
  id: string;
  corpus: Corpus;
  title: string;
  licence: Licence;
  links: { self: string; html: string | null };
  data: unknown;
}

export interface ItemList {
  apiVersion: "v1";
  corpus: Corpus | "mixed";
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  items: Item[];
}

export const API_BASE = "https://api.verbacorpus.org";

function isCorpus(value: string): value is Corpus {
  return (CORPORA as readonly string[]).includes(value);
}

// Global ids are "<corpus>:<localId>". Only the first colon separates the
// corpus from the local id, so local ids may themselves contain colons or "/".
export function parseGlobalId(id: string): { corpus: Corpus; localId: string } | null {
  const sep = id.indexOf(":");
  if (sep < 0) return null;
  const corpus = id.slice(0, sep);
  const localId = id.slice(sep + 1);
  if (!isCorpus(corpus) || localId === "") return null;
  return { corpus, localId };
}

export function globalId(corpus: Corpus, localId: string): string {
  return `${corpus}:${localId}`;
}

export const LICENCES: { pro: Licence; non: Licence; contra: Licence } = {
  pro: {
    id: "CC-BY-4.0",
    status: "granted",
    attribution: "Yemelianov, Dmytro (2026). verba — Ukrainian Proverbs Corpus",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
  non: {
    id: null,
    status: "terms-pending",
    attribution: "Hough, 2025 / Габданк-Рогозинський",
    url: null,
  },
  contra: {
    id: null,
    status: "terms-pending",
    attribution: "Л. Ставицька, „Українська мова без табу“",
    url: null,
  },
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function json(body: unknown, init: { status?: number; cache?: string } = {}): Response {
  const headers: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "x-verba-seed",
    "content-type": "application/json; charset=utf-8",
  };
  if (init.cache) headers["cache-control"] = init.cache;
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

export function errorResponse(e: ApiError): Response {
  return json({ error: { code: e.code, message: e.message } }, { status: e.status });
}
