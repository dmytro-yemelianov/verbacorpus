# Expansion Report — Phase 3a: Bobkova ingest

Generated 2026-06-22. Source-addition pattern: adapter + enrichment re-attach by `normalized_text`.

## Source

**Bobkova** — *Українські народні прислів'я та приказки* (compiled by В.І. Бобкова та ін.), a
**modern**-Ukrainian collection. Ingested from the 64 already-OCR'd pages in the WIP repo
(`MurzikVasilyevich/Ukraininan-proverbs-and-adages-WIP`, `data/bobkova_1/pages_OCR/`). The book's
remaining ~436 pages are deferred to Phase 3b.

## Pipeline

1. **Fetch + consolidate:** 64 page CSVs → 776 raw rows (`expand/consolidate.py`).
2. **OCR cleanup** (8 haiku agents): fixed merged words / stray characters and dropped non-proverb
   lines (section headers, titles). → **760 cleaned proverbs** (16 non-proverbs dropped),
   committed as `data/sources/bobkova.csv`.
3. **Build + integrate:** `build.py` (with the `bobkova` adapter) rebuilt the base corpus; SP2
   enrichment re-attached by `normalized_text` (existing enrichment preserved without re-running).
4. **Net-new enrichment** (7 haiku agents): the 700 net-new proverbs categorized against the fixed
   27-theme taxonomy; `modern_text` = cleaned `text` (Bobkova is already modern); `explanation` empty.
5. **Variant tuning + export:** recomputed variant groups (threshold 85, dissolve > 8).

## Counts

| metric | value |
|---|---|
| Corpus before | 35,165 |
| **Corpus after** | **35,865** (+700 net-new) |
| Bobkova cleaned proverbs | 760 |
| — exact-merged into existing entries | 60 (now multi-source, e.g. `Franko1901;Bobkova`) |
| — net-new entries | 700 |
| Net-new categorized (valid, 0 fallback, 0 missing) | 700 |
| Variant groups | 3,413 → **3,497** |
| Variant groups now spanning Bobkova + Franko | 116 |
| Per source | Franko1901 30,906 · Ilkevich1841 2,702 · Mlodzynskyi2009 2,261 · Bobkova 760 |

## Quality notes

- **Enrichment preservation verified:** all 35,105 existing non-Bobkova entries retain their SP2
  `category` + `modern_text`; the 60 merged entries keep their enrichment and gain `Bobkova` in
  `sources`. No re-enrichment of existing content was needed.
- **Cross-source linking:** 116 variant groups now link modern Bobkova proverbs to Franko's 1901
  dialectal forms (e.g. «І голодно і холодно і до дому далеко.») — a direct benefit of adding a
  modern source alongside the historical ones.
- **Residual OCR:** the cleanup pass fixed most errors but a small number survive (e.g. «піж»→«ніж»
  in one entry). Bobkova entries are LLM-cleaned data artifacts; a future proofreading pass could
  catch the long tail.

## Known limitations / next

- Only the 64 already-OCR'd pages are ingested; the rest of Bobkova is **Phase 3b** (full-book OCR
  from the Dropbox PDF). **Phase 3c** adds archive.org sources.
- Net-new categories are single-pass (as SP2): primary tag reliable, secondary tags occasionally
  debatable.
