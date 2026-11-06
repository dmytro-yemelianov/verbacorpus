import { describe, it, expect } from "vitest";
import { paraRoute } from "../src/para/router";
import {
  catalog,
  summary,
  readFont,
  glyphPage,
  type Assets,
  type FontRecord,
  type Glyph,
} from "../src/para/corpus";
import { visitGlyphPixels, boundedBitmapScale } from "../src/client/bitmap";
const base = "https://verbacorpus.org",
  entry = summary("texted-bios_8x8");
const metrics = { leftBearing: 0, rightBearing: 0, shiftUp: -1 };
const glyphs: Glyph[] = [
  {
    id: "g000000",
    codepoint: "U+0041",
    character: "A",
    labels: [{ kind: "unicode", value: "A" }],
    width: 8,
    height: 8,
    rowBytes: 1,
    advanceX: 8,
    metrics,
    rows: ["18", "3C", "66", "66", "7E", "66", "66", "00"],
    sourceCode: null,
  },
  {
    id: "g000001",
    codepoint: "U+0490",
    character: "Ґ",
    labels: [{ kind: "unicode", value: "Ґ" }],
    width: 8,
    height: 8,
    rowBytes: 1,
    advanceX: 8,
    metrics,
    rows: ["02", "3E", "60", "60", "60", "60", "60", "00"],
    sourceCode: null,
  },
  {
    id: "g000002",
    codepoint: null,
    character: null,
    labels: [{ kind: "codepoint", value: "0x50" }],
    width: 9,
    height: 1,
    rowBytes: 2,
    advanceX: 9,
    metrics,
    rows: ["8080"],
    sourceCode: { encoding: "unmapped", value: "0x50" },
  },
];
let reads = 0;
const assets: Assets = {
  fetch: async (request) => {
    reads++;
    const url = new URL(typeof request === "string" ? request : request.url),
      record = catalog.fonts.find(
        (f) => f.metaUrl === url.pathname || f.url === url.pathname,
      );
    const font = {
      format: "para-font",
      schemaVersion: "2.0.0",
      id: record?.id ?? entry.id,
      name: record?.name ?? entry.name,
      family: entry.family,
      version: 1,
      kind: "native",
      availability: "raster",
      cell: entry.cell,
      metrics: entry.metrics,
      bitmap: entry.bitmap,
      coverage: {
        ...entry.coverage,
        glyphCount: 3,
        unicodeGlyphCount: 2,
        unmappedGlyphCount: 1,
      },
      encodings: [],
      license: {
        id: "NOASSERTION",
        status: "unverified",
        redistributionAllowed: null,
      },
      source: {},
      provenance: {},
      modifications: [],
    };
    if (record && url.pathname === record.metaUrl)
      return new Response(
        JSON.stringify({
          font,
          unicodeIndex: { A: [0], Ґ: [1] },
          pages: [
            {
              file: "glyphs/" + record.id + "-0.json",
              bytes: 500,
              sha256: "x",
              offset: 0,
              count: 3,
            },
          ],
        }),
      );
    if (record) return new Response(JSON.stringify({ ...font, glyphs }));
    if (url.pathname.includes("/glyphs/") && url.pathname.endsWith("-0.json"))
      return new Response(JSON.stringify(glyphs));
    const shard = catalog.export.shards.findIndex(
      (s) => s.url === url.pathname,
    );
    if (shard >= 0) return new Response(shard === 0 ? "streamed corpus\n" : "");
    return new Response("missing", { status: 404 });
  },
};
const request = (path: string, init?: RequestInit) =>
  paraRoute(new Request(base + path, init), assets);
const graph = (query: string, variables?: Record<string, unknown>) =>
  request("/para/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
describe("complete native font APIs", () => {
  it("exposes every record with raster data and independent license status", async () => {
    const data = await (await request("/para/api/v2/manifest"))!.json<{
      counts: typeof catalog.counts;
    }>();
    expect(data.counts).toEqual(catalog.counts);
    expect(data.counts.raster).toBe(2266);
    expect(data.counts.metadataOnly).toBe(0);
    expect(data.counts.glyphs).toBe(583824);
    const page = await (await request(
      "/para/api/v2/fonts?ukrainian=complete",
    ))!.json<{ total: number }>();
    expect(page.total).toBe(62);
    const all = await (await request(
      "/para/api/v2/fonts?collection=hoard&limit=2",
    ))!.json<{
      total: number;
      nodes: { licenseStatus: string; availability: string }[];
    }>();
    expect(all.total).toBe(1947);
    expect(
      all.nodes.every(
        (f) => f.licenseStatus === "unverified" && f.availability === "raster",
      ),
    ).toBe(true);
  });
  it("paginates stable IDs and rejects stale or invalid filters", async () => {
    const page = await (await request(
      "/para/api/v2/fonts?availability=raster&limit=2",
    ))!.json<{ next: string; nodes: { id: string }[] }>();
    expect(page.next).toContain("snapshot=" + catalog.snapshot);
    expect(page.next).toContain("availability=raster");
    const next = await (await request(page.next))!.json<{
      nodes: { id: string }[];
    }>();
    expect(next.nodes[0].id).not.toBe(page.nodes[0].id);
    for (const query of [
      "limit=101",
      "offset=-1",
      "limit=NaN",
      "availability=anything",
      "ukrainian=yes",
    ])
      expect((await request("/para/api/v2/fonts?" + query))!.status).toBe(400);
    expect((await request("/para/api/v2/fonts?snapshot=old"))!.status).toBe(
      409,
    );
    const last = await (await request(
      "/para/api/v2/fonts?offset=99999",
    ))!.json<{ next: null }>();
    expect(last.next).toBeNull();
  });
  it("returns mapped and unmapped native glyphs with no fabricated Unicode", async () => {
    const path = "/para/api/v2/fonts/" + entry.id;
    const page = await (await request(
      path + "/glyphs?chars=" + encodeURIComponent("Ґ🦔"),
    ))!.json<{ nodes: Glyph[]; missing: string[] }>();
    expect(page.nodes[0].rows).toEqual(glyphs[1].rows);
    expect(page.missing).toEqual(["🦔"]);
    expect(await (await request(path + "/glyphs/U+0490"))!.json()).toEqual(
      glyphs[1],
    );
    expect(await (await request(path + "/glyphs/g000002"))!.json()).toEqual(
      glyphs[2],
    );
    expect((await request(path + "/glyphs/U+D800"))!.status).toBe(400);
    expect((await request(path + "/glyphs/U+0407"))!.status).toBe(404);
    expect((await request(path + "/glyphs/g999999"))!.status).toBe(404);
  });
  it("uses real GraphQL variables, fragments and IDs for unencoded glyphs", async () => {
    const result = await (await graph(
      'query Face($id:ID!){a:font(id:$id){...Face glyph(codepoint:"U+0490"){rows} raw:glyphById(id:"g000002"){id codepoint labels rows width}} fonts(ukrainian:"complete",limit:2){total nodes{id}}} fragment Face on Font{id schemaVersion bitmap{bitsPerPixel}}',
      { id: entry.id },
    ))!.json<{
      errors?: unknown;
      data: {
        a: { id: string; glyph: Glyph; raw: Glyph };
        fonts: { total: number };
      };
    }>();
    expect(result.errors).toBeUndefined();
    expect(result.data.a.glyph.rows).toEqual(glyphs[1].rows);
    expect(result.data.a.raw.codepoint).toBeNull();
    expect(result.data.a.raw.id).toBe("g000002");
    expect(result.data.fonts.total).toBe(62);
  });
  it("bounds GraphQL input, fragment expansion, aliases and native bytes", async () => {
    expect((await graph('{font(id:"x"){unknownField}}'))!.status).toBe(400);
    expect((await graph("query{...A} fragment A on Query{...A}"))!.status).toBe(
      400,
    );
    expect(
      (await graph(
        "{" +
          Array.from(
            { length: 501 },
            (_, i) => `f${i}:manifest{snapshot}`,
          ).join(" ") +
          "}",
      ))!.status,
    ).toBe(400);
    expect(
      (await request("/para/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: " ".repeat(32769),
      }))!.status,
    ).toBe(413);
    const limited = await (await graph(
      "{" +
        Array.from(
          { length: 6 },
          (_, i) => `f${i}:fonts(limit:100){nodes{id}}`,
        ).join(" ") +
        "}",
    ))!.json<{ errors: { extensions: { code: string } }[] }>();
    expect(
      limited.errors.some((e) => e.extensions.code === "QUERY_LIMIT"),
    ).toBe(true);
    expect(
      (await request("/para/graphql", { method: "POST", body: "{}" }))!.status,
    ).toBe(415);
    expect((await graph("mutation{manifest{snapshot}}"))!.status).toBe(400);
  });
  it("bounds native metadata and page reads before fetching oversized data", async () => {
    await expect(
      readFont(entry.id, assets, { bytes: 0, pages: 128 }),
    ).rejects.toMatchObject({ code: "QUERY_LIMIT" });
    const font = await readFont(entry.id, assets, {
      bytes: 5_000_000,
      pages: 0,
    });
    await expect(glyphPage(font, { limit: 1 })).rejects.toMatchObject({
      code: "QUERY_LIMIT",
    });
  });
  it("supports conditional reads, sharded streams, cancellation and version redirects", async () => {
    const path = "/para/api/v2/fonts/" + entry.id,
      response = (await request(path))!;
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    reads = 0;
    expect(
      (await request(path, {
        headers: { "if-none-match": response.headers.get("etag")! },
      }))!.status,
    ).toBe(304);
    expect(reads).toBe(0);
    reads = 0;
    expect(
      await (await request("/para/api/v2/export", { method: "HEAD" }))!.text(),
    ).toBe("");
    expect(reads).toBe(0);
    expect(await (await request("/para/api/v2/export"))!.text()).toBe(
      "streamed corpus\n",
    );
    const stream = (await request("/para/api/v2/export"))!.body!.getReader();
    await stream.read();
    await stream.cancel();
    expect(
      (await request("/para/graphql", { method: "OPTIONS" }))!.status,
    ).toBe(204);
    expect(
      (await request("/para/api/v2/openapi.json", { method: "POST" }))!.status,
    ).toBe(405);
    const legacy = (await request("/para/api/v1/fonts?limit=2"))!;
    expect(legacy.status).toBe(307);
    expect(legacy.headers.get("location")).toContain(
      "/para/api/v2/fonts?limit=2",
    );
    expect(
      (await paraRoute(
        new Request("https://para.verbacorpus.org/api/v2/fonts"),
        assets,
      ))!.status,
    ).toBe(200);
    expect(await request("/api/v1/meta")).toBeNull();
    expect(
      await request("/api/telegram-webhook", { method: "POST" }),
    ).toBeNull();
  });
  it("draws native wide pixels without 32-bit truncation or empty-glyph fallback", () => {
    expect(boundedBitmapScale(770, 144, 8)).toBe(4);
    expect(boundedBitmapScale(8, 8, 8)).toBe(8);
    const positions: number[][] = [];
    visitGlyphPixels(glyphs[2], (x, y) => positions.push([x, y]));
    expect(positions).toEqual([
      [0, 0],
      [8, 0],
    ]);
    const wide = {
      ...glyphs[2],
      width: 770,
      rowBytes: 97,
      rows: ["80" + "00".repeat(95) + "40"],
    };
    const native: number[] = [];
    visitGlyphPixels(wide, (x) => native.push(x));
    expect(native).toEqual([0, 769]);
    visitGlyphPixels(
      { ...glyphs[2], width: 0, height: 0, rowBytes: 0, rows: [] },
      () => {
        throw new Error("Invented pixel");
      },
    );
  });
});
