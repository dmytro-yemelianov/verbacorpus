import schema from "../../font-corpus/schema.json";
import {
  catalog,
  fonts,
  summary,
  readFont,
  listFonts,
  glyphPage,
  oneGlyph,
  glyphById,
  integer,
  limits,
  CorpusError,
  type Assets,
  type FontFilter,
} from "./corpus";
import { cors, json, matchesEtag } from "./http";

export const root = "/para/api/v2";
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
    if (request.method === "HEAD")
      return new Response(null, {
        headers: {
          ...cors,
          ...headers,
          "content-type": "application/x-ndjson; charset=utf-8",
        },
      });
    let cancelled = false;
    let cancelReason: unknown;
    let shardIndex = 0,
      reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (true) {
            if (!reader) {
              const shard = catalog.export.shards[shardIndex];
              if (!shard) {
                controller.close();
                return;
              }
              const response = await assets.fetch(
                "https://assets.local" + shard.url,
              );
              if (!response.ok || !response.body)
                throw new Error("Export shard is unavailable");
              if (cancelled) {
                await response.body.cancel(cancelReason);
                return;
              }
              reader = response.body.getReader();
            }
            const active = reader;
            const chunk = await active.read();
            if (cancelled) return;
            if (chunk.done) {
              active.releaseLock();
              reader = null;
              shardIndex++;
              continue;
            }
            controller.enqueue(chunk.value);
            return;
          }
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel(reason) {
        cancelled = true;
        cancelReason = reason;
        const active = reader;
        reader = null;
        if (active) {
          await active.cancel(reason);
          try {
            active.releaseLock();
          } catch {}
        }
      },
    });
    return new Response(request.method === "HEAD" ? null : stream, {
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
    /^\/fonts\/([a-z0-9][a-z0-9._-]{0,159})(?:\/(glyphs)(?:\/(U\+[0-9A-Fa-f]{4,6}|g[0-9]{6}))?)?$/,
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
    return json(
      await (match[3].startsWith("g")
        ? glyphById(font, match[3])
        : oneGlyph(font, match[3])),
      200,
      { ...headers, etag: fontEtag },
    );
  return json(
    await glyphPage(font, {
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
