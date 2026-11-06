# Font filters and viewer: measured improvements

Measured 6 November 2026 against baseline commit `80f70b7` on this Mac
(arm64, Node 25.9.0). Browser checks use the Chrome DevTools MCP browser against
`http://127.0.0.1:8797/para/`, with no CPU/network throttling unless stated.
These are local lab observations, not field metrics or an INP measurement.

## Findings and changes

Initial loading was already fast: baseline LCP 266 ms and CLS 0.00. Render-blocking
CSS had **0 ms estimated savings** in the trace, so it was retained. The work
focuses on interactions, source fidelity and avoiding repeated data/bitmap work.

| Interaction or operation | Before | After |
|---|---:|---:|
| Eight specimen zoom input events | 8 glyph requests | 0 requests |
| Five theme repaint events | 5 glyph requests | 0 requests |
| Four actual light/dark toggles | not separately measured | 0 requests |
| Next/previous 32-glyph page within cached 128-glyph source page | requests for each page | 0 requests |
| Seven rapid search edits ending in `ibm cga` | submit-only search; phrase had no matches | 1 debounced catalog request, 5 results |
| Eight warm specimen zoom steps | pixel-by-pixel redraw | 0 pixel fill calls, 280 cached image draws |

The client now separates selection, immutable data loading, specimen painting and
glyph inspection. A four-slot queue deduplicates reads shared by the specimen and
grid. An 8 MiB LRU uses UTF-16 JSON text size for accounting; parsed-object and DOM
memory are additional. Changing fonts aborts obsolete queued/in-flight reads.
Native masks are decoded once; repeated letters and zoom use `drawImage`, and
themes recolor masks. The mask/tint cache resets at two million source pixels.
Canvas allocation is also capped at two million pixels. Scaling remains integral
with smoothing disabled ([Canvas API reference](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled)).

The row decoder now parses each byte once instead of parsing it for every bit,
and skips zero bytes. Results below are median milliseconds per complete sample,
nine rounds of 30 iterations, after five warmups. Pixel visit checksums match.

| Native sample | Glyphs | Before | After | Speedup |
|---|---:|---:|---:|---:|
| Texted BIOS 8×8 | 128 | 0.1711 ms | 0.0273 ms | 6.26× |
| Oberon LetterHead 300 dpi | 19 | 8.5470 ms | 1.7509 ms | 4.88× |
| NEC PC-9821 Kanji 16×16 | 128 | 0.6063 ms | 0.0901 ms | 6.73× |

These CPU numbers concern bitmap visitation, not whole-frame or page speed.
[Raw results](font-renderer-profile.json) and reproduction:

```sh
cd app
node scripts/profile-font-renderer.mjs 80f70b7
```

## Filters and inspection

- Live multi-word search; collection, Ukrainian coverage, license, spacing and
  exact cell dimensions. Options/counts are rendered from the catalog at build
  time, avoiding an extra browser discovery request.
- Six deterministic sort orders, reset, 25/50/100-font pages, first/last controls,
  and shareable filter/font URLs. REST and GraphQL support the same filters;
  `/para/api/v2/facets` exposes catalog-wide facet values/counts.
- Unicode-mapped/unmapped/all glyph views, 32/64/128-glyph pages, native ID or
  Unicode jumps, arrow/Home/End navigation, automatic visible-glyph selection,
  previous/next glyph controls, integer fit/zoom, pixel grid and optional JSON.
- Responsive specimen wrapping at the available width, text presets, explicit
  missing mappings and a clear native-grid-only state for unencoded fonts.

## Verification

186 Vitest and seven Node corpus tests pass; focused backend/client TypeScript
checks, build and Wrangler dry-run pass. Browser checks verified:

- multi-word search debounce, reset, URL restoration, pagination, keyboard focus;
- empty mapped/unmapped results without stale canvas content;
- raw `g000010` in LetterHead and `U+0490` in Cozette;
- sampled Ukrainian glyph canvas: 12 ink pixels, zero mismatched native pixels,
  zero partially transparent antialiased pixels at 4×;
- large native glyph: 369×127 at capped 6× = 2214×762 (1,687,068 pixels), identical
  CSS/intrinsic dimensions with scrolling confined to the inspector;
- allocation cap across every catalog font at 320/944/2560 px widths and 1×/4×/8×;
- 390 px mobile viewport: document width 390 px, specimen intrinsic/CSS widths
  both 324 px; no horizontal document overflow;
- actual dark/light toggles without fetches; no console errors/warnings;
- updated local Cozette cold-load trace: LCP 213 ms, CLS reported 0.00. Different
  content/layout makes this a sanity check, not a controlled startup speedup.

The canonical 583,824 glyphs and snapshot remain unchanged. No full-corpus
transfer or regeneration is needed for these UI/API changes.
