# Changelog

All notable changes to the verba Ukrainian proverbs corpus are documented here.
This project adheres to semantic versioning for datasets (MAJOR = schema/breaking,
MINOR = new source or significant additions, PATCH = corrections).

## [1.0.1] — 2026-06-24

Text-quality cleanup (no schema or count change; 48,787 entries).

- Fixed ~150 entries that began with OCR junk (stray punctuation, list-numbers, leading dashes) — stripped and recapitalized (e.g. `' По парі…` → `По парі…`).
- Repaired 70 mixed-script (homoglyph) entries where Latin/Greek letters were OCR'd for Cyrillic (e.g. `He варт` → `Не варт`, `Τοто` → `Тото`); archaic word forms preserved.
- Rescued 6 severely garbled entries (conservative, non-fabricating).
- **Canonicalized all text to plain ASCII punctuation** (straight quotes, ASCII apostrophe, hyphen, `...`) for code-friendly exports; the website/cards render Ukrainian typography (« » «—» ’ …) via a display layer.

## [1.0.0] — 2026-06-24

Initial public release.

- **48,787** proverbs and adages from **5 sources**: Франко 1901 (30,906),
  Номис 1864 (9,785), Бобкова (5,613), Ількевич 1841 (2,702), Млодзинський 2009 (2,261).
- Every entry enriched with a modern-spelling rendering (`modern_text`) and 1–3 of 27
  thematic categories; **30,532** carry scholarly explanations.
- Non-destructive variant linking across sources; 10-column schema.
- Distributed as CSV, JSON, JSONL, XML; live at https://verbacorpus.org with a
  multi-format REST API and semantic search.
- **Known limitations:** Nomis 1864 is best-effort OCR (~75–80% character fidelity);
  category tags ~85% acceptable; `modern_text` ~95% acceptable. Enrichment is LLM-generated.
