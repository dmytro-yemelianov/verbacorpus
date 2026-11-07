# Latin-to-Ukrainian native recipes (0.15.0)

The supplied `texted/docs/specs/{codex,claude,gemini}` implementations were
reviewed together. `recipe_engine/ORIGINS.json` records the reviewed source
hashes. The application offers these as **editable candidates**: running the
generator never writes font drafts, marks letters reviewed, or replaces the
existing Ukrainian corpus. Application and undo use the existing draft transaction.

| Prototype | Adopted contribution | Excluded / corrected |
|---|---|---|
| Codex `ukrglyph` | Checked immutable bitmaps, fixed-cell contracts, measured vertical/horizontal strokes and discrete corner contours, explicit donor dependencies, strict/compact diacritics, counter and mark separation tests, unresolved reports | Original width 8 / heights 8,12,14,16 restriction replaced with bounded native widths 3–64 / heights 5–64. Python 3.9 compatibility. Bitwise bounding boxes replace per-pixel coordinate allocation. Library core and MIT notice retained; duplicate parsers/CLI/rendering are not imported. |
| Claude `cyrgen` | Real stem/bar fragments, Latin accent references, repeat-only scanline compression for lowercase/oval alternatives, explicit alternate forms | No `eval`, mutable global stroke settings, code-page guessing, swallowed arbitrary exceptions, OR-downsampling, or progressively thinned strokes. Operations are typed Python functions; unsuccessful fits remain unavailable. |
| Gemini Rust | Actual H/E/e crossbar measurements, source terminal preservation via fragments, three-stem positions/widths from W/m | No fixed u8 masks, hardcoded pixel positions, missing-donor defaults or recursively nested generic closure. Probe of the supplied Rust file fails compilation with E0275. |

Original probes: Codex's 44 tests pass under Python 3.12; Claude generates all
66 from its supplied VGA16 font with Cyrillic input removed and original Latin
bytes unchanged. This establishes operability, not equal visual quality. Gemini's
compile failure is independently reproducible. The editor's integrated tests
exercise the adapted engine, not only those original examples.

## User flow

Open **«Доповнити українську з латинки…»** or **«Інший референс / літери…»**.
The method selector offers **«Рецепти + retrieval»**, **«Лише рецепти»** and
the optional hybrid CNN. The per-glyph candidate dialog also proposes native
recipes. Both dialogs show the actual donors and recipe explanation.

Strict is the default: missing room for a mark or counter produces a reason,
not silently squeezed ink. Compact permits the specific body adaptations
recorded by each recipe. Source-fragment lowercase alternatives may remove
identical interior scanlines; they never erase unique rows or thin strokes.
A candidate records native dimensions, policy, measurements, donors, warnings,
adaptations, source identity/license and the exact reference payload identity.
This metadata survives applying, saving and exporting the draft.

Native-only mode needs Python, NumPy and Pillow, with no prepared retrieval
dataset, PyTorch, checkpoint or network access. Every Ukrainian request still
requires an actual nonblank, explicitly mapped ASCII Latin reference of the
matching case. Greek lookalikes and guessed encodings are not references.
Only explicitly provided Latin/digit/accent donors enter the recipe engine;
hidden target and existing Cyrillic bitmaps do not train the recipes.

Equal reference/target cell sizes and integer placement without lost ink are
required for native recipes. Custom pixel-aligned integer guides are honored when `recipeUseGuides` is true
(the UI sets it for manual font-guide overrides); otherwise cap/x/baseline anchors
are measured from source ink. Imported/source metrics can put the baseline
inside Latin ink, so automatic metadata alone must not shorten generated bodies. Larger or
incompatible grids keep the existing retrieval path and a visible native-recipe
reason. Editor/import limits are unchanged. Exact homographs remain first and
cannot be downgraded by OCR; copied homographs cannot hide clipped/resampled ink.
When multiple options fit, a retrieval comparison retains a slot. Optional OCR
can rerank non-exact alternatives after its existing per-font calibration.

## Validation and profiling

```sh
python3 -m unittest discover -s desktop/glyph-editor/experiments -p 'test_*.py'
node --test desktop/glyph-editor/test.mjs
python3 desktop/glyph-editor/experiments/benchmark_recipes.py \
  --corpus app --output desktop/glyph-editor/.build/native-recipes-proof
```

The benchmark supplies up to 64 **actual mapped Latin references**, hides target
bitmaps, requests all 66 letters, verifies source/request immutability, writes
per-letter refusal reasons, and renders a nearest-pixel contact sheet. No drafts
are loaded or changed. A bounded four-entry cache builds once per reference
payload/frame/policy; changing a donor or guide invalidates that entry.

2026-11-07 local warm-process sample, strict policy, without OCR/transport:

| Font | Candidates for letters | Full 66-letter batch | Warm median / letter |
|---|---:|---:|---:|
| Acer VGA 8×8 | 58/66 | 87 ms | 0.52 ms |
| ACM VGA 8×14 | 58/66 | 92 ms | 0.56 ms |
| Acer VGA 8×16 | 58/66 | 86 ms | 0.57 ms |
| Cozette 13×15 | 66/66 | 98 ms | 0.70 ms |

The first letter includes construction of the complete font's candidates
(9–14 ms in this sample). A successful recipe is not a visual quality certificate:
inspect alternatives before applying. In tiny bold grids some letters remain
unresolved because two counters, three separated stems, or detached diacritics
do not fit at the measured stroke width. Native-only mode deliberately does not
substitute a different font for those letters. Retrieval stays available.

The original recipes do not classify slant or handwriting. Rebuilt curves and
diagonals may need optical correction; source fragments are preferred where
safe. There is no claim of an OCR recognition improvement or universal 66/66
coverage across the library. The wider native-grid domain is guarded by bounds,
with targeted multi-byte/padding tests and corpus examples, not universal
proof of stylistic adequacy.

## Source-part refinement (0.15.1)

Recipe v2 preserves additional F/A/b/U/X/O source fragments and handles uncial N
without blindly mirroring an arch into И. It coexists with v1 provenance.
[The seven-family quality audit](../UKRAINIAN_QUALITY.md) distinguishes existing
retrieval drafts from newly proposed native candidates and documents remaining
small-grid failures.
