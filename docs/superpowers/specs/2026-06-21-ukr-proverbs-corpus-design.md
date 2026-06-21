# Ukrainian Proverbs Corpus — Canonical Corpus + Ingestion Pipeline

**Date:** 2026-06-21
**Status:** Approved (design)
**Sub-project:** 1 of 4 (see Roadmap)
**Repo:** `ukr-proverbs-corpus` (new, account `MurzikVasilyevich`)

---

## Roadmap (big picture)

The overall goal — "create a corpus of Ukrainian proverbs and adages" — decomposes into
four sequential sub-projects. Each gets its own spec → plan → implementation cycle.

1. **Canonical corpus + ingestion pipeline** ← *this spec* (foundation)
2. **Enrichment** — categories/themes, modern-spelling normalization, explanation cleanup
   (depends on #1)
3. **Expansion** — finish WIP digitization (bobkova, praktychnyi slovnyk), add archive.org
   sources (reuses #1's adapter pipeline)
4. **Productization** — JSON/XML exports, REST API, PWA, Telegram bot, reusing the proven
   `ua-bez-tabu` pattern (depends on #1/#2)

Only sub-project 1 is specified here.

---

## 1. Scope

Build a new repo `ukr-proverbs-corpus` that ingests the two **clean** upstream sources into
one canonical, deduplicated, source-attributed dataset, via an extensible Python pipeline.

**In scope**
- Ingest `ukr-proverbs` (Mlodzynskyi 2009 + Ilkevich 1841) and `ukr-proverbs-franko` (Franko 1901).
- Unify into one canonical schema.
- Exact-merge duplicates + link probable dialectal variants (lossless).
- Emit `corpus.csv` (source-of-truth) + `corpus.json` (richer export).
- A merged source registry (`sources.csv`) with BibTeX metadata.
- Tests (TDD) and a build report (counts / stats).

**Out of scope (handled by later sub-projects)**
- Raw OCR / WIP sources (`Ukraininan-proverbs-and-adages-WIP`).
- Deep thematic categorization (the `category` field is created but left blank).
- Modern-spelling rewriting of proverb text.
- XML export, REST API, PWA, Telegram bot.

---

## 2. Inputs

The pipeline ingests **only the two already-clean sources**. Raw/WIP material is deferred to
the Expansion sub-project.

| Source | Repo / file | Approx. rows | Field mapping |
|---|---|---|---|
| Franko 1901 (*Галицько-руські народні приповідки*) | `MurzikVasilyevich/ukr-proverbs-franko` → `franko.csv` | ~31,323 | `text ← prov_clean`, `keyword ← term`, `explanation ← description`, `source_ref ← letter`, `source = Franko1901` |
| Mlodzynskyi 2009 + Ilkevich 1841 | `MurzikVasilyevich/ukr-proverbs` → `proverbs.csv` + `proverbs_sources.csv` + `sources.csv` | ~4,963 | `text ← text`, `source ← Citationkey` (via `proverbs_sources`), `source_ref ← proverb id` |

**Acquisition:** a `fetch.py` script pulls raw snapshots of these files into `data/sources/`.
Snapshots are committed to git so builds are reproducible and offline (franko.csv ≈ 6 MB is
acceptable in git). `fetch.py` can refresh them on demand.

---

## 3. Canonical schema

### 3.1 `corpus.csv` (flat source-of-truth)

Columns, in order:

| Column | Description |
|---|---|
| `id` | Stable, zero-padded identifier (`p000001`). Assigned deterministically by sorting on `normalized_text`, so re-runs produce identical ids. |
| `text` | Verbatim proverb, **never mutated** (dialectal spelling preserved). |
| `normalized_text` | Match/search key (see §4). |
| `keyword` | Lemma/term the proverb is filed under (from Franko `term`); blank if none. |
| `explanation` | Scholarly note/explanation (from Franko `description`); blank if none. |
| `category` | Thematic category — **created but blank** (populated in Enrichment sub-project). |
| `sources` | Semicolon-joined list of source citation keys, e.g. `Franko1901;Mlodzynskyi2009`. |
| `source_refs` | Semicolon-joined per-source references, parallel to `sources`. |
| `variant_group` | Identifier shared by probable dialectal variants (see §5). Blank if the entry has no linked variants. |

### 3.2 `corpus.json` (richer export)

Generated from the same data, but preserves multi-source structure that the flat CSV would
flatten:

```json
{
  "id": "p000123",
  "text": "Аби болото, а жаби будуть",
  "normalized_text": "аби болото а жаби будуть",
  "keyword": "болото",
  "category": null,
  "variant_group": "v0042",
  "annotations": [
    { "source": "Franko1901", "ref": "Б", "explanation": "..." },
    { "source": "Mlodzynskyi2009", "ref": "12", "explanation": null }
  ]
}
```

So when a proverb appears in multiple sources with multiple explanations, none are lost.

### 3.3 `sources.csv` (source registry)

Merged from both upstream repos' `sources.csv` / BibTeX:
`Citationkey, Title, Year, Author, BibTeX` (BibTeX preserved verbatim for citation tooling).

---

## 4. Normalization (matching only — never mutates `text`)

`normalized_text` is derived purely for duplicate detection and search. The pipeline computes
it; it never alters the original `text`.

Pipeline (in order):
1. Unicode NFC.
2. Lowercase.
3. Unify apostrophes/quotes: `’ ʼ ` ´` → `'`; strip surrounding quotes.
4. Replace punctuation and dashes (`— – - … . , ; : ! ?` and quotes) with a space.
5. Collapse runs of whitespace to a single space; trim.

**Dialectal letters (і / ї / є / ґ) are left intact.** Matching is deliberately conservative —
we preserve everything original and accept that some true dialectal duplicates remain separate
(they get linked, not merged — see §5).

---

## 5. Deduplication + variant linking

### Pass 1 — exact merge (safe, reversible)
- Group all incoming records by `normalized_text`.
- Collapse each group to one canonical row.
- Union `sources` and `source_refs`.
- `keyword`: first non-empty wins.
- `explanation`: prefer Franko's; others retained in `corpus.json` `annotations`.

### Pass 2 — variant linking (no merge)
- Goal: link probable dialectal variants (e.g. «Як є – мине сі» vs «Як є – мине ся») without
  destroying either.
- **Blocking** to avoid O(n²) over ~36K rows: bucket candidates by a sorted-token signature
  and/or a shared rare token, then only compare within buckets.
- Within a block, compute `rapidfuzz` token-set ratio; pairs scoring **≥ 0.85** join the same
  `variant_group`.
- Variant groups get ids like `v0001`. Entries with no linked variant have a blank
  `variant_group`.

Both thresholds (0.85) and the blocking key are configurable constants in `core/dedup.py`.

---

## 6. Architecture (modular source-adapters)

```
ukr-proverbs-corpus/
  fetch.py                 # snapshot upstream CSVs → data/sources/
  data/sources/            # committed raw snapshots (franko.csv, proverbs.csv, ...)
  adapters/
    franko.py              # franko.csv      → list[CanonicalRecord]
    mlodzynskyi.py         # ukr-proverbs    → list[CanonicalRecord]
  core/
    schema.py              # CanonicalRecord dataclass + validation
    normalize.py           # §4 rules
    dedup.py               # §5 exact merge + variant linking
    export.py              # → corpus.csv / corpus.json
  build.py                 # adapters → normalize → dedup → link → export → report
  sources.csv              # merged source registry (+ BibTeX)
  corpus.csv               # canonical source-of-truth (committed)
  corpus.json              # generated export (committed)
  tests/                   # pytest
  requirements.txt         # pandas, rapidfuzz, pytest
  README.md                # schema, counts, build instructions
```

**Module responsibilities & interfaces**
- *Adapter* (`adapters/*.py`): one function `load(path) -> list[CanonicalRecord]` per source.
  Knows only that source's raw format. Adding a future source = drop in one new adapter.
- *`core/schema.py`*: defines `CanonicalRecord` (the unified record) and validates it. Single
  point of truth for fields.
- *`core/normalize.py`*: `normalize(text: str) -> str`. Pure, no I/O.
- *`core/dedup.py`*: `merge_exact(records)` and `link_variants(records)`. Pure transforms over
  record lists.
- *`core/export.py`*: writes `corpus.csv` and `corpus.json` deterministically (sorted, stable).
- *`build.py`*: orchestration only — calls adapters, then core, then export; prints the report.

**Determinism:** outputs are sorted by `normalized_text`; ids derived from that order, so the
same inputs always yield byte-identical `corpus.csv`.

---

## 7. Testing (TDD)

Written test-first, per the test-driven-development discipline.

- **`core/normalize`** — table-driven cases (apostrophe variants, dashes, whitespace, casing,
  dialectal letters preserved).
- **adapters** — each adapter maps representative fixture rows to the expected `CanonicalRecord`s,
  including blank-field handling.
- **`core/dedup` exact merge** — duplicate normalized rows collapse; sources union correctly;
  explanation precedence (Franko preferred).
- **`core/dedup` variant linking** — known dialectal-variant pairs land in one `variant_group`;
  known-distinct proverbs do **not**; blocking doesn't drop true pairs.
- **`core/export`** — emitted CSV/JSON match the schema; JSON `annotations` preserves multiple
  sources/explanations.
- **golden end-to-end** — tiny fixture inputs → byte-exact expected `corpus.csv` (locks determinism).

---

## 8. Tech stack

Python 3 · `pandas` · `rapidfuzz` (fuzzy matching) · `pytest`. Consistent with the existing
`MurzikVasilyevich` Python repos (`ua-bez-tabu`, the WIP `page_viewer.ipynb`).

---

## 9. Expected output

Roughly **~33–35K canonical entries** — Franko dominates (~31K) with a modest exact-overlap
against Mlodzynskyi's ~5K. ~31K entries carry Franko explanations; all entries are
source-attributed; dialectal variants are variant-linked. Exact counts confirmed by the build
report once implemented.

---

## 10. Open items / deferred decisions

- **GitHub remote creation** for `ukr-proverbs-corpus` is deferred to implementation (an
  outward action to confirm at that point). The repo is local-only during design.
- **Variant threshold (0.85)** is a starting value; may be tuned against real output during
  implementation.
- Whether to also normalize і/ї for *matching* (not text) is intentionally **not** done now;
  revisit only if exact-merge recall proves too low.
