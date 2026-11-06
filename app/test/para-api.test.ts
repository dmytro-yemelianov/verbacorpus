import { describe, it, expect } from "vitest";
import { paraRoute } from "../src/para/router";
import {
  catalog,
  summary,
  type FontRecord,
  type Assets,
} from "../src/para/corpus";

const base = "https://verbacorpus.org";
const entry = summary("texted-bios_8x8");
const fixture: FontRecord = {
  format: "para-font",
  schemaVersion: "1.0.0",
  id: entry.id,
  name: entry.name,
  family: entry.family,
  version: 1,
  kind: "derived",
  availability: "raster",
  cell: entry.cell,
  metrics: entry.metrics,
  bitmap: entry.bitmap,
  coverage: entry.coverage,
  encodings: [],
  license: { id: "CC-BY-SA-4.0", redistributionAllowed: true },
  source: {},
  provenance: {},
  modifications: [],
  glyphs: [
    {
      codepoint: "U+0041",
      character: "A",
      advanceX: 8,
      rows: ["18", "3C", "66", "66", "7E", "66", "66", "00"],
      sourceCode: null,
    },
    {
      codepoint: "U+0490",
      character: "Ґ",
      advanceX: 8,
      rows: ["02", "3E", "60", "60", "60", "60", "60", "00"],
      sourceCode: null,
    },
  ],
};
let reads = 0;
const assets: Assets = {
  fetch: async (request) => {
    reads++;
    const url = new URL(typeof request === "string" ? request : request.url);
    if (url.pathname === entry.url)
      return new Response(JSON.stringify(fixture));
    if (url.pathname === catalog.export.url)
      return new Response("streamed corpus\n");
    const metadata = catalog.fonts.find(
      (f) => f.availability === "metadata-only" && f.url === url.pathname,
    );
    if (metadata)
      return new Response(
        JSON.stringify({
          ...fixture,
          id: metadata.id,
          availability: "metadata-only",
          kind: "metadata-only",
          glyphs: null,
        }),
      );
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

describe("para font corpus APIs", () => {
  it("provides a complete, versioned catalog with explicit unknown and incomplete coverage", async () => {
    const response = (await request("/para/api/v1/manifest"))!;
    const data = await response.json<{
      counts: { records: number; raster: number; metadataOnly: number };
      snapshot: string;
    }>();
    expect(data.counts).toEqual(catalog.counts);
    expect(data.counts.records).toBe(
      data.counts.raster + data.counts.metadataOnly,
    );
    const page = await (await request(
      "/para/api/v1/fonts?ukrainian=complete",
    ))!.json<{ total: number; nodes: { id: string }[] }>();
    expect(page.total).toBe(6);
    expect(page.nodes.some((f) => f.id === "cozette-13x15")).toBe(true);
    const metadata = await (await request(
      "/para/api/v1/fonts?ukrainian=unknown&limit=2",
    ))!.json<{ total: number; nodes: FontRecord[] }>();
    expect(metadata.total).toBe(1947);
    expect(
      metadata.nodes.every((f) => f.coverage.ukrainian.complete === null),
    ).toBe(true);
  });
  it("paginates stable IDs, retains filters and rejects stale or invalid pagination", async () => {
    const page = await (await request(
      "/para/api/v1/fonts?availability=raster&limit=2",
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
      expect((await request("/para/api/v1/fonts?" + query))!.status).toBe(400);
    expect((await request("/para/api/v1/fonts?snapshot=old"))!.status).toBe(
      409,
    );
    const last = await (await request(
      "/para/api/v1/fonts?offset=99999",
    ))!.json<{ next: string | null }>();
    expect(last.next).toBeNull();
  });
  it("returns exact native rows and missing scalars without fallback", async () => {
    const page = await (await request(
      "/para/api/v1/fonts/" +
        entry.id +
        "/glyphs?chars=" +
        encodeURIComponent("Ґ🦔"),
    ))!.json<{ nodes: { rows: string[] }[]; missing: string[] }>();
    expect(page.nodes[0].rows).toEqual(fixture.glyphs![1].rows);
    expect(page.missing).toEqual(["🦔"]);
    const glyph = await (await request(
      "/para/api/v1/fonts/" + entry.id + "/glyphs/U+0490",
    ))!.json();
    expect(glyph).toEqual(fixture.glyphs![1]);
    expect(
      (await request("/para/api/v1/fonts/" + entry.id + "/glyphs/U+D800"))!
        .status,
    ).toBe(400);
    expect(
      (await request("/para/api/v1/fonts/" + entry.id + "/glyphs/U+0407"))!
        .status,
    ).toBe(404);
    const metadata = catalog.fonts.find(
      (f) => f.availability === "metadata-only",
    )!;
    expect(
      (await request("/para/api/v1/fonts/" + metadata.id + "/glyphs"))!.status,
    ).toBe(409);
    const metadataGraph = await (await graph(
      "query($id:ID!){font(id:$id){id glyphs{total} coverage{ukrainian{complete}}}}",
      { id: metadata.id },
    ))!.json<{
      errors?: unknown;
      data: {
        font: {
          id: string;
          glyphs: null;
          coverage: { ukrainian: { complete: null } };
        };
      };
    }>();
    expect(metadataGraph.errors).toBeUndefined();
    expect(metadataGraph.data.font.id).toBe(metadata.id);
    expect(metadataGraph.data.font.glyphs).toBeNull();
  });
  it("shares records and filters with real GraphQL aliases, variables and fragments", async () => {
    const response = (await graph(
      'query Face($id:ID!){ a:font(id:$id){...Face glyph(codepoint:"U+0490"){codepoint rows}} fonts(ukrainian:"complete",limit:2){total nodes{id cell{width}}}} fragment Face on Font{id schemaVersion bitmap{rowBytes bitOrder}}',
      { id: entry.id },
    ))!;
    const result = await response.json<{
      errors?: unknown;
      data: {
        a: { id: string; glyph: { rows: string[] } };
        fonts: { total: number };
      };
    }>();
    expect(result.errors).toBeUndefined();
    expect(result.data.a.id).toBe(entry.id);
    expect(result.data.a.glyph.rows).toEqual(fixture.glyphs![1].rows);
    expect(result.data.fonts.total).toBe(6);
  });
  it("bounds GraphQL input, fragment expansion, aliases and glyph work", async () => {
    expect((await graph('{ font(id:"x"){ unknownField }}'))!.status).toBe(400);
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
  it("supports CORS, HEAD, conditional reads, streaming exports and exact host aliases", async () => {
    const response = (await request("/para/api/v1/fonts/" + entry.id))!;
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    reads = 0;
    expect(
      (await request("/para/api/v1/fonts/" + entry.id, {
        headers: { "if-none-match": response.headers.get("etag")! },
      }))!.status,
    ).toBe(304);
    expect(reads).toBe(0);
    expect(
      await (await request("/para/api/v1/manifest", {
        method: "HEAD",
      }))!.text(),
    ).toBe("");
    expect(
      await (await request("/para/api/v1/fonts/does-not-exist", {
        method: "HEAD",
      }))!.text(),
    ).toBe("");
    expect(
      (await request("/para/graphql", { method: "OPTIONS" }))!.status,
    ).toBe(204);
    expect(
      (await request("/para/api/v1/openapi.json", { method: "POST" }))!.status,
    ).toBe(405);
    expect(await (await request("/para/api/v1/export"))!.text()).toBe(
      "streamed corpus\n",
    );
    expect(
      (await paraRoute(
        new Request("https://para.verbacorpus.org/api/v1/fonts"),
        assets,
      ))!.status,
    ).toBe(200);
    expect(await request("/api/v1/fonts")).toBeNull();
    expect(
      await request("/api/telegram-webhook", { method: "POST" }),
    ).toBeNull();
    expect(
      await paraRoute(
        new Request("https://para.verbacorpus.org.example.com/api/v1/fonts"),
        assets,
      ),
    ).toBeNull();
  });
});
