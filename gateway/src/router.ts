import corporaFile from "../../app/content/corpora.json";
import {
  ApiError,
  CORPORA,
  LICENCES,
  errorResponse,
  json,
  parseGlobalId,
  type Corpus,
  type ItemList,
  type Licence,
} from "./contract.js";
import type { Adapter, Upstream } from "./adapters/types.js";
import { makeNonAdapter } from "./adapters/non.js";
import { makeParaAdapter } from "./adapters/para.js";
import { makeProAdapter } from "./adapters/pro.js";

export interface Env {
  PRO?: Fetcher;
  UPA?: Fetcher;
  FONTS?: Fetcher;
}

export function adaptersFor(env: Env): Partial<Record<Corpus, Adapter>> {
  const out: Partial<Record<Corpus, Adapter>> = {};
  if (env.PRO) out.pro = makeProAdapter(env.PRO as unknown as Upstream);
  if (env.UPA) out.non = makeNonAdapter(env.UPA as unknown as Upstream);
  if (env.FONTS) out.para = makeParaAdapter(env.FONTS as unknown as Upstream);
  return out;
}

const API_VERSION = "v1" as const;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const isCorpus = (s: string): s is Corpus => (CORPORA as readonly string[]).includes(s);

function licenceOf(corpus: Corpus): Licence | null {
  return corpus === "para" ? null : LICENCES[corpus];
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ApiError(400, "invalid_request", "malformed percent-encoding in path");
  }
}

function intParam(params: URLSearchParams, name: string, def: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null) return def;
  if (!/^\d+$/.test(raw)) throw new ApiError(400, "invalid_request", `${name} must be an integer`);
  const n = Number(raw);
  if (n < min || n > max) throw new ApiError(400, "invalid_request", `${name} must be between ${min} and ${max}`);
  return n;
}

function adapterOf(adapters: Partial<Record<Corpus, Adapter>>, corpus: Corpus): Adapter {
  const a = adapters[corpus];
  if (!a) throw new ApiError(503, "unavailable", `corpus "${corpus}" is not available`);
  return a;
}

async function corpora(adapters: Partial<Record<Corpus, Adapter>>): Promise<Response> {
  const entries = (corporaFile as any[]).filter((e) => isCorpus(e.prefix));
  const metas = await Promise.allSettled(
    entries.map((e) => {
      const a = adapters[e.prefix as Corpus];
      return a ? a.meta() : Promise.reject(new Error("no adapter"));
    }),
  );
  const list = entries.map((e, i) => {
    const m = metas[i];
    const ok = m.status === "fulfilled";
    return {
      corpus: e.prefix as Corpus,
      id: e.id,
      title: e.title,
      description: e.description,
      domain: e.domain,
      total: ok ? m.value.total : null,
      available: ok,
      licence: licenceOf(e.prefix),
    };
  });
  return json({ apiVersion: API_VERSION, corpora: list }, { cache: "public, max-age=300" });
}

async function route(request: Request, adapters: Partial<Record<Corpus, Adapter>>): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter((p, i) => i === 0 || p !== "").slice(1);
  if (parts[0] !== "v1") throw new ApiError(404, "not_found", "no such route");
  const rest = parts.slice(1);

  if (rest.length === 1 && rest[0] === "corpora") return corpora(adapters);

  if (rest[0] === "items" && rest.length >= 2) {
    const id = decode(rest.slice(1).join("/"));
    const g = parseGlobalId(id);
    if (!g) throw new ApiError(404, "not_found", "unknown item id");
    const item = await adapterOf(adapters, g.corpus).get(g.localId);
    if (!item) throw new ApiError(404, "not_found", "item not found");
    return json(item, { cache: "public, max-age=3600" });
  }

  if (rest.length >= 2 && isCorpus(rest[0])) {
    const corpus = rest[0];
    const what = rest[1];
    if (what === "meta" && rest.length === 2) {
      const { total } = await adapterOf(adapters, corpus).meta();
      return json({ apiVersion: API_VERSION, corpus, total, licence: licenceOf(corpus) }, { cache: "public, max-age=300" });
    }
    if (what === "items" && rest.length === 2) {
      const limit = intParam(url.searchParams, "limit", 50, 1, 100);
      const offset = intParam(url.searchParams, "offset", 0, 0, Number.MAX_SAFE_INTEGER);
      const { total, items } = await adapterOf(adapters, corpus).list(limit, offset, url.searchParams);
      const body: ItemList = {
        apiVersion: API_VERSION,
        corpus,
        total,
        limit,
        offset,
        nextOffset: offset + limit < total ? offset + limit : null,
        items,
      };
      return json(body, { cache: "public, max-age=3600" });
    }
    if (what === "items" && rest.length === 3) {
      const item = await adapterOf(adapters, corpus).get(decode(rest[2]));
      if (!item) throw new ApiError(404, "not_found", "item not found");
      return json(item, { cache: "public, max-age=3600" });
    }
  }
  throw new ApiError(404, "not_found", "no such route");
}

export async function handle(
  request: Request,
  env: Env,
  adapters: Partial<Record<Corpus, Adapter>> = adaptersFor(env),
): Promise<Response> {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "GET" && request.method !== "HEAD") {
      const r = errorResponse(new ApiError(405, "method_not_allowed", "only GET, HEAD and OPTIONS are supported"));
      r.headers.set("allow", "GET, HEAD, OPTIONS");
      return r;
    }
    return await route(request, adapters);
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e);
    return errorResponse(new ApiError(502, "upstream_error", "unexpected upstream failure"));
  }
}
