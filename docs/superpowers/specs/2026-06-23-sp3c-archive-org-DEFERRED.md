# Expansion Phase 3c — archive.org — DEFERRED (feasibility + pilot notes)

**Status:** DEFERRED 2026-06-23 (chose to do SP4 productize first; corpus already 40,444).
Captured here so the assessment isn't lost when revisited.

## Available public-domain sources (archive.org search, Ukrainian proverbs)

- **`nomis1864`** — Матвій Номис, *Українські приказки, прислів'я і таке інше* (1864). The
  foundational 19th-c. collection (~14k entries). PDF (330 pp) + `_djvu.txt`. Public domain by age.
- `chubynsky1.2` (1877), `hrinchenko8`/`etnoHrinch` (1895) — ethnographic works, proverbs embedded.
- `etnohr_*` volumes = **Franko's** приповідки — already in corpus (skip, duplicate).
- `prykazky1955` / `prykazky1984` — clean modern lists but likely still in copyright (skip).

## Why it's hard (the catch)

Nomis is a **dense two-column critical edition**: each proverb sits among dialectal variant readings,
source sigla («Бер.», «Гад.», «Проск.»), entry numbers, and editorial prose, in 1864 etymological
orthography. `pdftotext` yields garbage (broken text layer); tesseract OCR works but **interleaves the
two columns** (no PSM cleanly separates them — would need per-column image cropping). So extraction is
**not token-free** — it needs LLM judgment to pull proverbs out of the apparatus, plus modernization.

## Pilot result (3 pages, sonnet extraction)

- Extracted **88 plausible modernized proverbs** from ~3 pages → extrapolates to ~9k for the book.
- Discarded ~55–60% of OCR (apparatus/garbage/column-interleave damage).
- Reliability **~75–80%**: good on clean sections; fails on interleaved columns, line-spanning
  proverbs, and ambiguous short fragments.

## If revisited — sketch of the approach

1. OCR 330 pp with tesseract (consider cropping each page into two column images for cleaner OCR).
2. LLM-extract modernized proverbs (~110 sonnet agents over the pages) — store the modernized text as
   both `text` and `modern_text` (no clean verbatim original available); `source=Nomis1864`.
3. Dedup + variant-link against the corpus (expect heavy Franko overlap → many links, fewer net-new).
4. Categorize net-new; flag the whole source as best-effort (~75–80% quality).

**Cost/value verdict:** heaviest, lowest-efficiency, most duplicate-overlapping, lowest-quality phase.
Worth doing for scholarly breadth, but lower priority than productization.
