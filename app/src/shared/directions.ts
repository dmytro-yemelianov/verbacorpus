const PREFIXES = ["pro", "contra", "re", "para", "non"] as const;
export type DirectionRoute = { asset: string; translateProverbs?: boolean } | { redirect: string };

/** Local paths and exact future custom domains share one routing policy. */
export function directionRoute(url: URL, lang: string, rest: string, method = "GET"): DirectionRoute | null {
  if (method !== "GET" && method !== "HEAD") return null;
  let path = rest;
  const domainPrefix = PREFIXES.find(p => url.hostname === `${p}.verbacorpus.org`);
  if (path === "/" && domainPrefix) path = `/${domainPrefix}/`;
  if (path === "/") {
    if (["q", "cat", "src", "sem"].some(key => url.searchParams.has(key))) {
      return { redirect: `${lang === "uk" ? "" : `/${lang}`}/pro/${url.search}` };
    }
    return { asset: "/corpora" };
  }
  const prefix = PREFIXES.find(p => path === `/${p}` || path === `/${p}/`);
  if (!prefix) return null;
  if (prefix === "pro") return { asset: "/", translateProverbs: true };
  return { asset: `/${prefix}/` };
}
