import schema from "../../font-corpus/schema.json";
import {
  catalog,
  fonts,
  summary,
  readFont,
  listFonts,
  glyphPage,
  oneGlyph,
  integer,
  limits,
  CorpusError,
  type Assets,
  type FontFilter,
} from "./corpus";
import { cors, json, matchesEtag } from "./http";

export const root = "/para/api/v1";
export function manifest() {
  return {
    format: catalog.format,
    schemaVersion: catalog.schemaVersion,
    snapshot: catalog.snapshot,
    counts: catalog.counts,
    sources: catalog.sources,
    export: catalog.export,
    schema: `${root}/schema.json`,
    rest: root,
    graphql: "/para/graphql",
    openapi: `${root}/openapi.json`,
    limits,
  };
}
function filter(url: URL): FontFilter {
  const p = url.searchParams;
  return {
    q: p.get("q") ?? undefined,
    availability: p.get("availability") ?? undefined,
    ukrainian: p.get("ukrainian") ?? undefined,
    license: p.get("license") ?? undefined,
    collection: p.get("collection") ?? undefined,
    snapshot: p.get("snapshot") ?? undefined,
    limit: integer(p.get("limit"), 50, limits.fonts, 1),
    offset: integer(p.get("offset"), 0, 100000),
  };
}
export async function rest(
  request: Request,
  path: string,
  assets: Assets,
): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method))
    return json(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or HEAD" } },
      405,
      { allow: "GET, HEAD, OPTIONS" },
    );
  const url = new URL(request.url),
    etag = `"${catalog.snapshot}"`;
  const headers = { etag, "x-corpus-snapshot": catalog.snapshot };
  if (path === "" || path === "/manifest")
    return json(manifest(), 200, headers);
  if (path === "/schema.json") return json(schema, 200, headers);
  if (path === "/licenses")
    return json(
      {
        snapshot: catalog.snapshot,
        licenses: [...new Set(fonts.map((f) => f.licenseId))].sort(),
        notices: "/para/licenses/NOTICE.md",
      },
      200,
      headers,
    );
  if (path === "/fonts") {
    const page = listFonts(filter(url));
    const next = page.nextOffset === null ? null : new URL(request.url);
    if (next) {
      next.searchParams.set("offset", String(page.nextOffset));
      next.searchParams.set("snapshot", catalog.snapshot);
    }
    return json(
      { ...page, next: next ? next.pathname + next.search : null },
      200,
      {
        ...headers,
        ...(next
          ? { link: `<${next.pathname}${next.search}>; rel="next"` }
          : {}),
      },
    );
  }
  if (path === "/export") {
    if (matchesEtag(request, etag))
      return new Response(null, {
        status: 304,
        headers: { ...cors, ...headers },
      });
    const response = await assets.fetch(
      `https://assets.local${catalog.export.url}`,
    );
    if (!response.ok)
      throw new CorpusError(
        "CORPUS_UNAVAILABLE",
        "The pinned export is unavailable",
        503,
      );
    return new Response(request.method === "HEAD" ? null : response.body, {
      headers: {
        ...cors,
        ...headers,
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="para-fonts-${catalog.snapshot.slice(0, 12)}.ndjson"`,
        "cache-control": "public, max-age=300",
      },
    });
  }
  const match = path.match(
    /^\/fonts\/([a-z0-9][a-z0-9._-]{0,159})(?:\/(glyphs)(?:\/(U\+[0-9A-Fa-f]{4,6}))?)?$/,
  );
  if (!match) throw new CorpusError("NOT_FOUND", "Unknown font API route", 404);
  const entry = summary(match[1]),
    fontEtag = `"${entry.sha256}"`;
  if (!match[2]) {
    if (matchesEtag(request, fontEtag))
      return new Response(null, {
        status: 304,
        headers: { ...cors, ...headers, etag: fontEtag },
      });
    const response = await assets.fetch(`https://assets.local${entry.url}`);
    if (!response.ok)
      throw new CorpusError(
        "CORPUS_UNAVAILABLE",
        "The pinned font asset is unavailable",
        503,
      );
    return new Response(request.method === "HEAD" ? null : response.body, {
      headers: {
        ...cors,
        ...headers,
        etag: fontEtag,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
        ...(url.searchParams.get("download") === "1"
          ? { "content-disposition": `attachment; filename="${entry.id}.json"` }
          : {}),
      },
    });
  }
  const font = await readFont(entry.id, assets);
  if (match[3])
    return json(oneGlyph(font, match[3]), 200, { ...headers, etag: fontEtag });
  return json(
    glyphPage(font, {
      chars: url.searchParams.has("chars")
        ? url.searchParams.get("chars")!
        : undefined,
      limit: integer(url.searchParams.get("limit"), 128, limits.glyphs, 1),
      offset: integer(url.searchParams.get("offset"), 0, 65536),
    }),
    200,
    headers,
  );
}
