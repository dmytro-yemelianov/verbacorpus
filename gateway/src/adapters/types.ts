import { ApiError, type Corpus, type Item } from "../contract.js";

export interface Upstream {
  fetch(input: Request | string): Promise<Response>;
}

export interface Adapter {
  corpus: Corpus;
  meta(): Promise<{ total: number }>;
  list(
    limit: number,
    offset: number,
    filters: URLSearchParams,
  ): Promise<{ total: number; items: Item[] }>;
  get(localId: string): Promise<Item | null>;
}

const upstreamError = (message: string) => new ApiError(502, "upstream_error", message);

// Fetches `path` from the upstream and parses JSON. A 404 yields null when
// `allow404` is set; any other failure (non-2xx, network error, bad JSON)
// becomes ApiError(502, "upstream_error").
export async function fetchJson(
  up: Upstream,
  path: string,
  allow404 = false,
): Promise<unknown | null> {
  let res: Response;
  try {
    res = await up.fetch(new Request("https://upstream" + path));
  } catch (e) {
    throw upstreamError(`upstream request failed: ${(e as Error).message}`);
  }
  if (res.status === 404 && allow404) return null;
  if (!res.ok) throw upstreamError(`upstream responded ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw upstreamError("upstream returned invalid JSON");
  }
}

// Builds a query string from the whitelisted filter keys only.
export function pickFilters(
  filters: URLSearchParams,
  allowed: readonly string[],
  into: URLSearchParams,
): void {
  for (const key of allowed) {
    for (const v of filters.getAll(key)) into.append(key, v);
  }
}
