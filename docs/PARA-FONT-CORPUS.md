# Complete native para.verba corpus

All **2,266 records now contain actual glyphs**. There are **583,824 native
rasters**, including 490,940 glyphs imported from all 1,947 pinned Hoard YAFF
files. No metadata-only placeholders remain. One four-glyph CC0 fixture remains
explicitly marked as a fixture. Native Unicode mappings give 62 records the full
Ukrainian alphabet; missing Ukrainian glyphs are not synthesized.

The source audit decoded every file with monobit 0.52.0 and verified every
exported pixel against its source matrix. It found 88,773 glyphs with no Unicode
mapping and 152 multi-character mappings. These are retained by native glyph ID,
without assigning invented Unicode or dropping symbols/ligatures. See
[native-hoard-intake-audit.json](native-hoard-intake-audit.json).

## Para Font Interchange 2.0.0

The [JSON Schema](../app/font-corpus/schema.json) describes one canonical record.
REST, GraphQL projections, full-font downloads and each NDJSON export line use
this data model. Catalog summaries and paged glyph responses are projections.

Each glyph has a source-ordinal ID such as `g000123`, all original labels,
optional Unicode `codepoint`/`character`, native width/height, per-glyph
`rowBytes`, advance and bearing/shift metrics, plus exact MSB-first hexadecimal
scanlines. Labels distinguish Unicode, source codepoints and tags. Unicode can
be null, or a character label can be a multi-character sequence. Multiple glyphs
may share a Unicode label; Unicode lookup returns the first source entry and
ID lookup exposes every variant. IDs are stable within a pinned source revision.

`rowBytes = ceil(glyph.width/8)`. Each row has exactly `rowBytes * 2` hex digits;
unused right-hand bits are zero. Empty native whitespace glyphs retain their
zero dimensions/empty rows. All current sources are one-bit; there is no
thresholding, resizing, outline rasterization or padding into a universal cell.
The corpus includes proportional fonts, negative bearings/shifts and a 770-pixel
wide logo glyph. Font metrics and per-glyph advances are separate.

`coverage` includes total, Unicode-mapped and unmapped glyph counts. Ukrainian
coverage uses nonempty, explicitly mapped glyphs for all 66 letters. A font with
no Unicode mappings has unknown Ukrainian coverage even though its native
rasters are available. Unicode normalization and text shaping are not performed.

Raster availability is independent of license status. Hoard records retain
`NOASSERTION`, `status: unverified`, `redistributionAllowed: null`, source
copyright and the original collection/directory notices. Importing their pixels
does not relabel them CC0 or claim a verified grant. Existing MIT, BSD, CC0 and
CC-BY-SA records retain their licenses; notices and derivative recipes travel
with the data. Nasinnia, Hoard and Texted source checkouts remain unchanged.

## REST and GraphQL

Current base: **`/para/api/v2`**. On the exact future `para.verbacorpus.org`
hostname, `/api/v2` aliases it. Existing font preview `/para/api/v1` URLs return
307 redirects to corresponding v2 URLs, preserving methods, bodies and queries.
The original content-addressed v1 snapshot remains available unchanged. The
proverb `/api/v1` API remains separate.

| Method and path | Result |
|---|---|
| `GET /`, `/manifest` | Snapshot, sources, counts, limits and export shard descriptors |
| `GET /schema.json`, `/openapi.json` | JSON Schema 2020-12 and OpenAPI 3.1 |
| `GET /fonts` | Search and paginated font summaries |
| `GET /facets` | Available collections, licenses, widths and heights with full-catalog counts |
| `GET /fonts/{id}` | Complete canonical record, streamed from the immutable asset |
| `GET /fonts/{id}/glyphs` | Page of every native glyph, including unmapped entries |
| `GET /fonts/{id}/glyphs/U+0490` | Lookup by known Unicode mapping |
| `GET /fonts/{id}/glyphs/g000000` | Lookup by native ID, including unencoded symbols |
| `GET /export` | Complete NDJSON stream across all export shards |
| `GET /licenses` | License identifiers and attribution inventory |
| `POST /graphql` | Read-only GraphQL, also at `/para/graphql` |

Fonts support `q`, `availability`, `ukrainian=complete|partial|none|unknown`,
`license`, `collection=nasinnia|texted|hoard`, `spacing=monospace|proportional`,
exact native cell `width`/`height` (1–4096), `sort=id|name|width|height|glyphs|ukrainian`,
`limit` (default 50, max 100),
`offset` and `snapshot`. `next` URLs preserve filters and snapshot; a changed
snapshot returns 409. The default sort remains ID; each alternate order breaks ties by ID.
Search matches every whitespace-separated term against the normalized ID, name and family.
GraphQL exposes the same filters and `facets: JSON`. Facet counts describe the full catalog.

Glyph pages support `chars` (known Unicode mappings only), `limit` (default 128,
max 256) and `offset`. Without `chars`, every source glyph is available. The
`missing` list names requested scalars with no mapping. Unknown IDs return 404;
invalid arguments return 400; native read-budget exhaustion returns 413. Errors
are `{error: {code, message}}`. CORS, OPTIONS, HEAD and conditional full-font/export
ETags are supported. `?download=1` makes a full record an attachment.

```sh
BASE=http://localhost:8797
curl "$BASE/para/api/v2/fonts?collection=hoard&limit=50"
curl "$BASE/para/api/v2/fonts/hoard-acorn-bbc-bbc-master/glyphs?limit=32"
curl "$BASE/para/api/v2/fonts/hoard-oberon-letterhead-300dpi/glyphs/g000000"
curl "$BASE/para/api/v2/fonts/texted-bios_8x8/glyphs/U+0490"
curl "$BASE/para/api/v2/export" -o para-native-fonts.ndjson
```

The SDL is `/para/graphql/schema.graphql`. GraphQL.js handles parsing,
validation, fragments, aliases, variables and operation names. Example:

```graphql
query {
  manifest { snapshot counts { records raster glyphs unmappedGlyphs } }
  font(id: "hoard-oberon-letterhead-300dpi") {
    license
    source
    glyphById(id: "g000000") {
      id codepoint character labels width height rowBytes advanceX metrics rows
    }
    glyphs(limit: 32) { total nextOffset nodes { id codepoint width height } }
  }
}
```

Queries are limited to 32 KiB input, 3,000 parser tokens/AST nodes, 500 expanded
selections, 10 nesting levels, eight distinct full-font metadata loads, 200
summaries and 1,024 returned glyphs. Native metadata/page reads share an 8 MiB,
128-page request budget. Page requests run at bounded concurrency and repeated
aliases reuse request-local page promises. No mutations or subscriptions exist.

## Storage and browser

The complete deterministic NDJSON is 274,608,351 bytes. Its SHA-256 snapshot is
`14207bd33f178d91ea4c18dd1f3f4ae5a83427c0c87b3bc332899baf2c214fed`.
It is stored as 34 immutable shards of at most 8 MiB. The endpoint reads them
sequentially with backpressure and cancellation; HEAD reads no shard bodies.
Individual records and export shards remain below the static asset size limit.

The Worker bundles only lightweight catalog summaries. Full-font downloads pass
through ASSETS streams. Glyph lookups load small native metadata/index sidecars
and 128-glyph pages, never the entire multi-megabyte font. Build verification
checks every record, lookup, glyph page, shard, source notice and checksum. No
new database, bucket, secret, cron or domain binding is required.

`/para/` defaults to all fonts and provides search, coverage filters, a paginated
native glyph grid, ID-based JSON inspection and a scrollable zoomable glyph
viewer. Filters update after a 180 ms search debounce, can be reset, and preserve font/filter
selection in shareable URLs. Glyphs support mapped/unmapped views, 32/64/128-entry pages,
ID/Unicode jumps, keyboard navigation, integer fit/zoom and an optional pixel grid.
The browser reads pinned metadata/page assets through a deduplicated four-request queue
and an 8 MiB LRU (UTF-16 JSON text accounting, not a whole-heap guarantee). Decoded
bitmap masks/tints have a separate two-million-source-pixel budget. Zoom, themes and
resizing repaint cached glyphs without network access. Unmapped fonts show their actual
symbols in the grid. Text previews use
known mappings and native bearings; canvas sizes are bounded for large logo and
print fonts. Missing mappings are explicit, with no substitute font.

## Reproduction and checks

Offline authoring requires `monobit==0.52.0`. Ordinary builds/tests use the
checked-in snapshot and require neither monobit nor neighboring repositories.

```sh
cd app
python3 scripts/import_hoard_fonts.py \
  --source /path/to/hoard-of-bitfonts \
  --metadata /path/to/nasinnia/data/hoard-of-bitfonts-metadata.json \
  --output /tmp/para-hoard-native-v2
node sync_fonts.mjs --nasinnia /path/to/nasinnia --texted /path/to/texted \
  --hoard-intake /tmp/para-hoard-native-v2
npm run verify:fonts
npm run build
npm test
npx tsc -p tsconfig.para.json
npx tsc -p tsconfig.corpora.json
npx wrangler dev --local --port 8797 --inspector-port 9241
node scripts/check-font-api.mjs http://localhost:8797
```

Local validation passes 186 Worker/Vitest tests, seven Node corpus tests, both
focused typechecks and the build. The source import round-trips all 490,940
Hoard native glyphs; tests verify all published source raster digests, 88,773
unmapped glyphs, 152 sequence mappings, lookup/page equivalence, wide/empty
rasters, export limits and stream cancellation. Chrome DevTools browser checks now cover
filters, native glyph navigation, real theme changes, exact canvas pixels, empty results
and a 390 px mobile viewport. See [viewer profiling](FONT-VIEWER-PERFORMANCE.md).
