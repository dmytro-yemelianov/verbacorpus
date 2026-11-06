/** HTTP-only acceptance test against a running local/preview Worker. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const base = process.argv[2] ?? "http://localhost:8797";
const get = async (path, init) => {
  const response = await fetch(new URL(path, base), init);
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response;
};
const manifest = await (await get("/para/api/v2/manifest")).json();
const page = await (await get("/para/api/v2/fonts?ukrainian=complete")).json();
assert.equal(page.total, manifest.counts.ukrainianComplete);
const id = "texted-bios_8x8",
  path = `/para/api/v2/fonts/${id}`;
const detail = await get(path);
assert.equal(detail.headers.get("access-control-allow-origin"), "*");
const record = await detail.json();
const conditional = await fetch(new URL(path, base), {
  headers: { "if-none-match": detail.headers.get("etag") },
});
assert.equal(conditional.status, 304);
const glyph = await (await get(path + "/glyphs/U+0490")).json();
assert.deepEqual(
  glyph.rows,
  record.glyphs.find((g) => g.character === "Ґ").rows,
);
const query =
  'query Face($id:ID!){font(id:$id){id schemaVersion cell{width height} glyph(codepoint:"U+0490"){codepoint rows}} fonts(ukrainian:"complete"){total}}';
const graph = await (
  await get("/para/api/v2/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { id } }),
  })
).json();
assert.equal(graph.errors, undefined);
assert.deepEqual(graph.data.font.glyph.rows, glyph.rows);
assert.equal(graph.data.fonts.total, page.total);
const rawId = "hoard-oberon-letterhead-300dpi";
const raw = await (
  await get("/para/api/v2/fonts/" + rawId + "/glyphs/g000000")
).json();
assert.equal(raw.codepoint, null);
assert.equal(raw.character, null);
assert.ok(raw.labels.length > 0);
assert.ok(raw.rows.length > 0);
const rawGraph = await (
  await get("/para/api/v2/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query:
        '{font(id:"' +
        rawId +
        '"){glyphById(id:"g000000"){id codepoint width rows}}}',
    }),
  })
).json();
assert.equal(rawGraph.errors, undefined);
assert.deepEqual(rawGraph.data.font.glyphById.rows, raw.rows);
const native = await get(page.nodes[0].url);
assert.equal(native.headers.get("access-control-allow-origin"), "*");
assert.ok(native.headers.get("cache-control").includes("immutable"));
const exported = await get("/para/api/v2/export");
const hash = createHash("sha256");
let bytes = 0,
  lines = 0;
for await (const chunk of exported.body) {
  hash.update(chunk);
  bytes += chunk.length;
  for (const byte of chunk) if (byte === 10) lines++;
}
assert.equal(hash.digest("hex"), manifest.export.sha256);
assert.equal(bytes, manifest.export.bytes);
assert.equal(lines, manifest.counts.records);
assert.equal(
  (await fetch(new URL("/para/api/v2/fonts?limit=99999", base))).status,
  400,
);
for (const path of [
  "/para/api/v2/schema.json",
  "/para/api/v2/openapi.json",
  "/para/graphql/schema.graphql",
  "/para/",
  "/pro/",
  "/api/v1/meta",
])
  await get(path);
console.log(
  JSON.stringify(
    {
      base,
      snapshot: manifest.snapshot,
      counts: manifest.counts,
      exportBytes: bytes,
      restGraphqlParity: true,
      legacyRoutes: true,
    },
    null,
    2,
  ),
);
