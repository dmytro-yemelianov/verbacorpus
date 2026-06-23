# Ukrainian Proverbs Corpus — SP6: Nomis 1864 Ingestion

**Date:** 2026-06-23
**Status:** Approved (design)
**Sub-project:** 6 — ingest Nomis 1864 as the 5th source
**Repo:** `ukr-proverbs-corpus` (existing)
**Depends on:** SP1–SP5 done (corpus = 40,444; live app + semantic index).
**Supersedes:** the deferred `2026-06-23-sp3c-archive-org-DEFERRED.md` pilot notes (this is the full execution).

---

## 1. Scope

Add **Матвій Номис, «Українські приказки, прислів'я і таке інше» (1864)** — the foundational 19th-c.
Ukrainian proverb collection — as the corpus's **5th source** (`Nomis1864`), via OCR + LLM extraction
from the public-domain scan. Best-effort quality (~75–80%); modest net-new after dedup against Franko.

**Out of scope:** a clean verbatim 1864-orthography original (not recoverable from the OCR — see §4);
perfect parsing of Nomis's critical apparatus (variant readings, source sigla); the Franko/Zharkikh XML
in `Prypovid.rar` (it is Franko, already in the corpus — set aside); switching to stable proverb ids
(deferred — this sub-project keeps the existing renumber-on-rebuild pattern + a full re-embed).

## 2. Source

- **Nomis 1864**, public domain by age. ~330-page PDF scan (dense two-column critical edition,
  1864 etymological orthography). Resolve the exact archive.org identifier at implementation (the SP3c
  pilot already OCR'd pages from it); **vendor** the PDF to `data/sources/nomis.pdf`.
- Registry row (`sources.csv`): `Nomis1864, Українські приказки, прислів'я і таке інше, 1864, Матвій Номис`.

## 3. Extraction pipeline (`expand/`)

Reuses the SP3b toolchain (pdftoppm + tesseract 5.5.2 + tessdata_best) plus the SP3c two-column fix:
1. **Render** — `pdftoppm` → 300-dpi PNG per page.
2. **Column-crop** — split each page image into **left / right half** images (Nomis is two-column;
   whole-page OCR interleaves the columns — cropping is the fix the pilot identified).
3. **OCR** — `tesseract --psm 6 -l ukr` (tessdata_best) per column image → text; concatenate per page in
   reading order (left column, then right). Yields noisy 1864-orthography text with proverbs embedded in
   apparatus (entry numbers, variant readings, source sigla like «Бер.»/«Гад.», editorial prose).

The render/crop/OCR step is deterministic (token-free).

## 4. LLM extraction (token-bearing — a data artifact)

Nomis (unlike the clean Bobkova lists) **requires LLM judgment** to pull proverbs out of the apparatus:
- Batch the per-page OCR text; **sonnet** agents (via Workflow / `enrich/batch.py`-style file I/O) read each
  page and emit a JSON list of genuine proverbs, **modernized to standard Ukrainian spelling**, discarding
  variant-readings / sigla / editorial prose / OCR garbage / non-proverbs.
- Output per proverb: `{ modern_text, source_ref }` where `source_ref` = the Nomis entry number if
  recoverable (else empty). Robust JSON parsing (line-salvage for unescaped Ukrainian quotes, per SP2).
- Aggregate → **`data/sources/nomis.csv`** (`text, modern_text, source_ref`), with **`text = modern_text`**
  (the modernized reading; no clean verbatim 1864 original is recoverable from the OCR).
- **Quality:** best-effort. Expect ~55–60% of OCR discarded (apparatus/garbage/interleave damage),
  ~75–80% reliability on what's kept. No second verification pass (cost/value).
- **Run mechanics (SP2 lesson):** run the extraction in **batches, one pass at a time** to avoid the
  session usage limit; id-level repair rounds for gaps.

## 5. Merge (`adapters/` + `core` + `build.py`)

- **`adapters/nomis.py`** — read `data/sources/nomis.csv` → `CanonicalRecord`s (`source=Nomis1864`,
  `modern_text=text`, no `explanation`/`keyword`).
- **`build.py`** — `build_records` includes Nomis **iff `data/sources/nomis.csv` exists** (mirrors the
  Bobkova inclusion pattern).
- **Dedup** — exact-merge on `normalized_text`: a Nomis proverb matching an existing entry **adds
  `Nomis1864` to that entry's `sources`** (no new row, no overwrite of existing text/modern_text/explanation).
  Net-new proverbs become new rows.
- **Variant-link** — rapidfuzz `token_set_ratio ≥ 85`, dissolve groups > 8 (existing `tune_variants`).
- **Enrichment preservation** — adding a source renumbers canonical p-ids, so SP2 enrichment is re-attached
  on `normalized_text` (existing `expand/reattach.py`), not on id.

## 6. Enrich net-new (`enrich/`)

- **Categorize** net-new Nomis proverbs (haiku, the fixed 27-theme taxonomy) via the existing batch
  enrichment pipeline. `modern_text` is already set (`=text`); no `explanation` (Nomis apparatus is not
  reliably extractable). Existing entries that merely gained `Nomis1864` in `sources` are untouched.

## 7. Re-embed + ship (`embed/` + Vectorize + app)

The rebuild renumbers ids, so the id-keyed embedding manifest is stale → do a **full re-embed**:
- Delete `embed/manifest.json`; recreate/clear the `proverbs-bge-m3` Vectorize index; run the embed
  pipeline over the full (now ~larger) corpus (~$0.05, ~10 min — proven in SP5). Embed batch ≤ 100 texts
  (bge-m3's 60k-token request cap).
- Regenerate the app exports (`build_data.py` → `proverbs.json`/`explanations.json`/`meta.json`/`corpus.xml`),
  rebuild the client, **deploy** (confirmed with the user — outward action), bump `sw.js` cache.

## 8. Components / files

```
data/sources/nomis.pdf          # vendored PD scan (~330pp)
data/sources/nomis.csv          # generated: text, modern_text, source_ref  (committed)
expand/nomis_ocr.py             # render + column-crop + tesseract -> per-page text   [TDD: crop geometry]
expand/nomis_extract/           # LLM extraction prompts + batch driver (data artifact, not unit-tested)
adapters/nomis.py               # nomis.csv -> CanonicalRecord                         [TDD]
build.py                        # +Nomis inclusion (if nomis.csv exists)               [TDD]
sources.csv                     # +Nomis1864 row
embed/manifest.json             # regenerated by the full re-embed
README.md / expand/REPORT.md    # document the source + best-effort flag
```

## 9. Testing

- **pytest (deterministic units):** `adapters/nomis.py` (csv→records); `build.py` Nomis inclusion +
  dedup-merge (a Nomis duplicate adds `Nomis1864` to an existing entry's sources; net-new appended) +
  enrichment re-attach preservation; `expand/nomis_ocr.py` column-crop geometry (image split is
  deterministic). Reuse the existing `expand/` + `core` test patterns.
- **Not unit-tested (data artifacts):** the OCR output and the LLM extraction (non-deterministic) —
  validated by a **spot-audit (n≈40)** of extracted proverbs for the ~75–80% quality target.
- **Regression:** existing pytest + vitest suites stay green; the full re-embed leaves the semantic
  endpoints working (preview smoke before production deploy).

## 10. Deploy (outward — confirm before running)

Full re-embed of the Vectorize index + `wrangler deploy` of the app, confirmed with the user at execution
time (consistent with prior sub-projects). Verify via a preview deploy first.

## 11. Risks / open items

- **Column-interleave damage:** mitigated by per-column cropping; line-spanning proverbs and ambiguous
  short fragments are still lost — accepted (best-effort).
- **Heavy Franko overlap:** both are Galician 19th-c. → many Nomis proverbs dedup into existing entries
  (gaining `Nomis1864` as a second attestation); net-new count is modest. This cross-source attestation is
  itself valuable for variant/type work — not wasted.
- **Extraction cost:** sonnet over ~330 pages × 2 columns ≈ hundreds of agents; bounded; batched, one pass
  at a time (SP2 session-limit lesson).
- **Index refresh:** the production semantic index is fully rebuilt; do it against a preview deploy, then
  promote, so production search isn't degraded mid-rebuild.
- **archive.org id resolution:** the exact identifier is resolved at implementation (the source is
  confirmed obtainable from the SP3c pilot).
