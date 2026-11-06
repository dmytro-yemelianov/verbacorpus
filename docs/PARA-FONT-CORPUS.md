# para.verba font corpus and APIs

The corpus now exposes the complete registered Nasinnia catalog and Texted's
five Ukrainian bitmap adaptations through one interchange format. The approved
scope is **catalog and actual coverage first**. This intake does not generate
missing Ukrainian letters or turn unverified metadata into downloadable rasters.

The first snapshot contains **2,266 unique records**: 313 native Nasinnia raster
records, one explicitly marked CC0 test fixture, five Texted derivatives, and
1,947 metadata-only Hoard records. Eight older Nasinnia files repeat registered
font IDs with identical glyph pixels. They are recorded as equivalent source
inputs, rather than counted as extra fonts. Six records have all 66 Ukrainian
letters: Cozette and the five Texted derivatives.

The source repositories remain unchanged. Nasinnia continues to own source
intake; para.verba publishes a reproducible, versioned interchange snapshot.
Model checkpoints and synthetic training atlases are not part of the corpus.

## Interchange contract

**Para Font Interchange 1.0.0** is a JSON object described by
[`app/font-corpus/schema.json`](../app/font-corpus/schema.json). The same object
is available as an individual REST resource and a line in the NDJSON export.
GraphQL selects fields from those records; it does not introduce another bitmap
encoding. Catalog list responses are lightweight projections, without glyph rows.

Each record includes:

- Stable source ID, name, family, source version, native/derived/fixture kind and
  raster/metadata-only availability.
- Native cell width/height, pixel aspect ratio, baseline, ascent/descent, line
  gap, default advance and each glyph's own advance.
- Explicit `hex-rows`, `msb-first` storage and `rowBytes = ceil(width/8)`.
  Every scanline has exactly `rowBytes * 2` uppercase hexadecimal digits;
  unused right-hand bits are zero. Wide fonts are never squeezed into eight bits.
- Sorted Unicode scalar records with exact native rows, character and source
  encoding labels. Unsupported characters are never substituted.
- Source collection, record ID, git revision, source hash, upstream metadata,
  provenance and exact modification recipes for derivatives.
- Original per-record license and attribution. MIT/BSD notices travel inside
  applicable records; full notices and the attribution inventory accompany the
  corpus. Licenses do not become Verba's proverb-data license.
- Ukrainian coverage calculated from nonempty glyphs, including all 33 letters
  in both cases. Metadata-only records use `null` for present/missing/complete,
  because missing raster data does not prove absent glyphs.

The repertoire is scalar-based. No Unicode normalization, shaping, synthetic
fallback, outline rasterization or resampling occurs during intake. Cozette's
13×15 catalog cell and 6-pixel letter advances are both retained.

## REST

Base path: **`/para/api/v1`** on the main site or a version preview.
On the future exact `para.verbacorpus.org` hostname, `/api/v1` aliases that base.
The implementation does not configure DNS or move production traffic.

| Method and path | Response |
|---|---|
| `GET /`, `/manifest` | Snapshot, counts, sources, export hash and documented limits |
| `GET /schema.json` | JSON Schema 2020-12 for the interchange record |
| `GET /openapi.json` | OpenAPI 3.1 REST contract |
| `GET /fonts` | Filtered, paginated font summaries |
| `GET /fonts/{id}` | Complete canonical record; add `?download=1` for attachment |
| `GET /fonts/{id}/glyphs` | Native glyph page, optionally restricted by `chars` |
| `GET /fonts/{id}/glyphs/U+0490` | One exact Unicode glyph |
| `GET /export` | Streamed NDJSON, one complete interchange record per line |
| `GET /licenses` | License IDs and attribution inventory link |

Font filters: `q`, `availability=raster|metadata-only`,
`ukrainian=complete|partial|none|unknown`, `license`, `collection=nasinnia|texted`,
`limit` (default 50, maximum 100) and `offset`. Responses return `total`,
`nextOffset`, a ready-to-follow `next` URL and the corpus `snapshot`. Following
that URL preserves filters and pins pagination; a changed snapshot returns 409.
IDs are sorted deterministically.

Glyph pages accept `chars`, `limit` (default 128, maximum 256) and `offset`.
The `missing` list names requested scalars with no glyph. A metadata-only raster
request returns 409 `RASTER_UNAVAILABLE`; an unknown font or glyph returns 404.
An invalid argument returns 400. Errors use `{error: {code, message}}`.

Read endpoints support HEAD and cross-origin requests. OPTIONS provides CORS
preflight. Full-font and export responses support conditional ETag reads.
Individual static records live under content-addressed snapshot URLs with
immutable cache headers; mutable API URLs have short cache lifetimes.

```sh
BASE=http://localhost:8797
curl "$BASE/para/api/v1/fonts?ukrainian=complete&limit=10"
curl "$BASE/para/api/v1/fonts/cozette-13x15/glyphs?chars=%D2%90%D0%84%D0%86%D0%87"
curl "$BASE/para/api/v1/fonts/texted-bios_8x8/glyphs/U+0490"
curl "$BASE/para/api/v1/export" -o para-fonts.ndjson
```

## GraphQL

**`POST /para/api/v1/graphql`** (also `/para/graphql`), with
`Content-Type: application/json`. Read-only GET queries are also supported.
The SDL is available at `/para/graphql/schema.graphql`; standard parsing,
validation, fragments, aliases, variables and operation names use GraphQL.js.

```graphql
query Face($id: ID!) {
  manifest { snapshot counts { records raster metadataOnly ukrainianComplete } }
  fonts(ukrainian: "complete", limit: 10) {
    total
    nodes { id name cell { width height } coverage { ukrainian { present complete } } }
  }
  font(id: $id) {
    schemaVersion
    license
    source
    bitmap { encoding bitOrder rowBytes }
    glyphs(chars: "ҐґЄєІіЇї", limit: 16) {
      nodes { codepoint character advanceX rows }
      missing
    }
  }
}
```

Use variables `{"id":"texted-bios_8x8"}`. `font` returns the full record and
paged glyph resolvers; `fonts` returns summaries to avoid implicit N+1 loading.
Per request: 32 KiB body, 3,000 parser tokens/AST nodes, 500 expanded selections,
10 levels of nesting, eight distinct full-font loads, 200 returned summaries and
1,024 returned glyphs. Query expansion is checked before validation/execution;
resolver budgets also bound variable-dependent work. No mutations or subscriptions
are exposed. POST results use `no-store` and conventional GraphQL field errors.

## Intake, integrity and runtime

Run explicit intake from the Verba `app/` directory:

```sh
npm ci
node sync_fonts.mjs --nasinnia /path/to/nasinnia --texted /path/to/texted
npm run verify:fonts
npm run build
npm test
npx tsc -p tsconfig.para.json
npx tsc -p tsconfig.corpora.json
npx wrangler dev --local --port 8797 --inspector-port 9241
node scripts/check-font-api.mjs http://localhost:8797
```

Ordinary builds work offline from the checked-in corpus. They validate source
lineage, each canonical record and bitmap dimensions, all record/index/export
hashes, aliases, coverage, notices and summary consistency. Snapshot identity is
SHA-256 of the complete deterministic NDJSON bytes. Repeating intake with the
same sources yields the same snapshot.

Only the lightweight catalog is bundled into the Worker. Full font records are
fetched on demand through the static ASSETS binding. The 22,367,859-byte export
passes through as a response stream. It is never parsed into Worker memory.
No new D1/R2/KV resources, secrets, production domains or cron changes are needed.
The build rejects an export beyond 25 MiB; a larger future intake must split
exports or use object storage before publication.

The browser at `/para/` uses these public APIs for search, paginated selection,
coverage filters, missing-glyph reporting and native pixel previews. The former
`/para/font.json` Cozette specimen remains available for compatibility.

Validation: 179 Worker/Vitest tests and seven Node corpus/catalog tests passed;
focused server and browser-client typechecks, offline corpus verification,
repeated deterministic intake, build and Wrangler dry run passed. HTTP acceptance
verified actual REST/GraphQL parity, every exported byte/hash, immutable CORS
assets, metadata-only behavior and existing proverb routes. Visual browser
acceptance remains unverified: the session's browser inventory was empty and
native computer control reported `Sky Computer Use native pipe startup failed`.

Cloudflare's [ASSETS binding](https://developers.cloudflare.com/workers/static-assets/binding/)
provides the on-demand resource path. A
[Worker version URL](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
can review a candidate without promoting it to production; version URLs still
use the Worker's existing configured bindings.
