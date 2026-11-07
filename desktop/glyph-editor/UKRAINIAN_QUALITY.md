# Ukrainian style mismatch audit (0.15.1)

## Findings

The reported families were checked against the pinned source catalog and current
local drafts: ApricotPortable, Arial 8, AT&T PC6300, Athens Regular 18,
Barbedor10.Scn.Fnt, and all Berkeley/Bison variants across the three GEOS
collections. This is 39 catalog entries, including duplicated designs across
collections, not 39 independent style samples.

None of these source entries contains original mapped Ukrainian glyphs. In the
33 populated drafts the 20 exact Latin homographs agree with the corresponding
normalized Latin pixels: **660 matching pairs, zero mismatches**. The remaining
1,518 letters have older generation provenance:

| Provider | Letters across 33 populated variants |
|---|---:|
| Retrieval from another font | 1,065 |
| Old native geometric transforms/compositions | 453 |

Six Bison 7×18/7×6 variants lack mapped Latin references and correctly remain
without Ukrainian drafts. They must not be included in a blind completion pass.

The project-wide provenance census found 55,770 retrieval glyphs in 1,808 draft
fonts and 24,603 older geometry glyphs. These are provider counts, not a claim
that every such glyph is visually wrong. Generation provenance can survive later
manual editing, so provenance alone is insufficient authorization for replacing
all those working bitmaps.

The previously installed 0.15.0 added recipe candidates but did **not** migrate
already populated drafts. Its “only missing” preset therefore left these old
retrieval/geometry results visible. A style-generator update and a working-font
update are different operations.

## Reproduced defects and corrections

- Old retrieval frequently changes stroke weight, cap/x-height, serif shape and
  diagonal phase. Some small lowercase results collapse to a few rows or strokes.
  A close normalized font distance is not a per-glyph style guarantee.
- Source labels alone are insufficient for transforms: Athens's Latin N is an
  uncial arch. Mirroring it yields an arch, not И. The native engine now probes
  for a moving interior diagonal, ignores outer stems/serifs, and constructs И
  with measured strokes when the N donor lacks that diagonal.
- Reconstructed primitives discard native terminals. Recipe v2 adds actual F
  stem/top-bar/serif fragments for Г/г, A outer strokes for Д/д, b's x-height bowl
  for ь, and U/u cup fragments for Ч/ч. It preserves source V reflections as an
  El alternative instead of opening a flat-topped A into a misleading П.
- The shared global stroke estimate is too restrictive for some wide symbols.
  Ж/ж and Ф/ф can now use X/x or O/o with independently measured I/b/p stem width.
  Explicit centre-column insertion reserves arm gaps or counters without
  downsampling source pixels or thinning a stroke. The Ef alternatives require
  exactly two counters and Zhe requires three separated top/bottom branches.
- Tiny bowls and crowded diacritics still have real grid constraints. Strict
  mode reports these cases. It does not silently select a foreign-font glyph in
  the replacement comparison.

| Representative font | Strict native candidate availability after changes |
|---|---:|
| ApricotPortable | 62/66 |
| Arial 8 | 63/66 |
| AT&T PC6300 | 62/66 |
| Athens Regular 18 | 65/66 |
| Barbedor10.Scn.Fnt | 64/66 |
| Berkeley 12, Breadbox | 66/66 |
| Bison 12, Breadbox | 66/66 |

Availability measures successful construction, not visual acceptance. The local
contact sheets were inspected; alternatives for each letter remain selectable.
Some tiny в/ж/з and crowded Ї/Й/Ґ remain unavailable in strict mode; a compact
mode or manual correction can be inspected separately.

## Existing-draft review

**«Порівняти українські варіанти…»** runs native recipes over existing letters,
shows current → proposed thumbnails throughout the alphabet, and displays the
current raster and actual Latin content donors beside the candidate list.
It starts with no replacements selected. The first-variant action skips identical
bitmaps, preserving correct homographs rather than selecting a different foreign
alternative. Applying selected changes uses the existing undo/save transaction;
generation and comparison themselves write no working glyphs.

Existing working fonts are not silently rewritten. The local audit/report data
is stored under ignored `.build` paths, not published with the code.

## Reproduce

```sh
node desktop/glyph-editor/audit-ukrainian.mjs \
  --corpus app --project '/path/to/working/project' \
  --out desktop/glyph-editor/.build/quality-audit
python3 desktop/glyph-editor/experiments/compare_ukrainian.py \
  --audit desktop/glyph-editor/.build/quality-audit
```

The audit is read-only, checks pinned source SHA and draft snapshot/base identity,
uses the editor's actual shared-cell normalization, and rejects output paths that
overlap the source corpus or working project. `--fonts id,id` narrows the audit.
It records the input revision, method counts, matching homographs and native
request payloads. The comparison command emits per-font current/native contact
sheets and unresolved reasons in the audit's `comparison` directory. No OCR,
retrieval dataset, training or network is required for this comparison.
