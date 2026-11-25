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
const unavailable = (message: string) => new ApiError(503, "unavailable", message);

export const UPSTREAM_TIMEOUT_MS = 8000;

// Fetches `path` from the upstream and parses JSON. A 404 yields null when
// `allow404` is set; any other failure (non-2xx, network error, bad JSON)
// is classified: network error / timeout / 5xx -> ApiError(503, "unavailable");
// other 4xx or an unparseable body -> ApiError(502, "upstream_error").
export async function fetchJson(
  up: Upstream,
  path: string,
  allow404 = false,
): Promise<unknown | null> {
  let res: Response;
  try {
    res = await up.fetch(
      new Request("https://upstream" + path, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }),
    );
  } catch (e) {
    throw unavailable(`upstream request failed: ${(e as Error).message}`);
  }
  if (res.status === 404 && allow404) return null;
  if (res.status >= 500) throw unavailable(`upstream responded ${res.status}`);
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
