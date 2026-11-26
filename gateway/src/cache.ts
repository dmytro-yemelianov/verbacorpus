// Cache API layer in front of the router. Only successful, public, non-degraded GET
// responses are stored; the key is the full request URL.

interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function defaultCache(): CacheLike | null {
  const c = (globalThis as { caches?: { default?: CacheLike } }).caches;
  return c?.default ?? null;
}

export function cacheable(response: Response): boolean {
  return (
    response.status === 200 &&
    (response.headers.get("cache-control") ?? "").trim().toLowerCase().startsWith("public") &&
    !response.headers.has("x-verba-degraded")
  );
}

export async function withCache(
  request: Request,
  ctx: ExecutionContext | undefined,
  fn: () => Promise<Response>,
): Promise<Response> {
  const cache = request.method === "GET" ? defaultCache() : null;
  if (!cache) return fn();
  const key = new Request(request.url, { method: "GET" });
  try {
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch {
    // A cache failure must never break the response.
  }
  const response = await fn();
  if (cacheable(response)) {
    const put = Promise.resolve(cache.put(key, response.clone())).catch(() => {});
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(put);
  }
  return response;
}
