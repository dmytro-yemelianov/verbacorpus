# ukr-proverbs-corpus

Canonical, deduplicated, source-attributed corpus of Ukrainian proverbs and adages,
unified from digitized historical sources.

It is **enriched**: every entry carries a modern-spelling rendering and 1–3 thematic categories.

## Web app & API

A Cloudflare Worker serves a searchable, offline-capable PWA and a JSON REST API over the corpus
(in `app/`, mirroring the ua-bez-tabu stack). Live: **https://ukr-proverbs-corpus.miwaniza.workers.dev**

### REST API (`/api/v1`, multi-format)

Versioned, content-negotiated API — every data endpoint serves **JSON · JSONL · XML · CSV · TSV** via
`?format=` (default `json`) or the `Accept` header. Docs + curl examples at **[/api.html](https://ukr-proverbs-corpus.miwaniza.workers.dev/api.html)**; OpenAPI 3 at `/api/v1/openapi.json`.

- `GET /api/v1/search?q=&category=&source=&limit=&offset=&format=` — lexical
- `GET /api/v1/semantic?q=&category=&source=&minScore=&limit=&format=` — meaning-based (see below)
- `GET /api/v1/random?n=&category=&source=&format=` — N random
- `GET /api/v1/query?category=&source=&variant_group=&has_explanation=&limit=&offset=&format=` — flexible filter
- `GET /api/v1/proverb/:id?format=` — single proverb + explanation
- `GET /api/v1/export?category=&source=&format=` — whole corpus (or filtered), incl. explanations
- `GET /api/v1/categories` · `GET /api/v1/meta` · `GET /api/v1/similar/:id`

Collections return `{total, limit, offset, results}` (+ `X-Total-Count`); file formats download with a filename.
The unversioned `/api/*` paths remain as back-compatible aliases. Example:
```bash
curl 'https://ukr-proverbs-corpus.miwaniza.workers.dev/api/v1/search?q=гроші&format=csv'
curl -H 'Accept: application/x-ndjson' 'https://ukr-proverbs-corpus.miwaniza.workers.dev/api/v1/export'
```

### Semantic search (embeddings + Vectorize)

The PWA's **«за змістом»** toggle and the **«Схожі прислів'я»** detail section are powered by
Workers AI `@cf/baai/bge-m3` embeddings stored in a Cloudflare **Vectorize** index (`proverbs-bge-m3-v2`).
Lexical search stays the offline default; semantic search is opt-in and network-only.

Build/refresh the index (incremental — embeds only new/changed entries; **requires the Workers Paid plan**
plus an API token with `Vectorize:Edit` + `Workers AI:Read`):
```bash
CLOUDFLARE_ACCOUNT_ID=<acct> python -m embed.run   # uses embed/manifest.json as incremental state
```

Run locally:
```bash
cd app
npm install
.venv/bin/python build_data.py ../corpus.csv ../enrich/taxonomy.csv ../sources.csv public/data ../corpus.xml
node build.mjs
npx wrangler dev        # http://127.0.0.1:8787
npx vitest run          # API + search tests
```

## Contents
- `corpus.csv` — canonical source-of-truth (48787 entries).
- `corpus.json` — richer export (categories as arrays, per-source annotations).
- `sources.csv` — source registry.
- `enrich/taxonomy.csv` — the fixed 27-theme category vocabulary.
- `enrich/REPORT.md` — enrichment coverage, distribution, and quality audit.
- `enrich/pass_a.json`, `enrich/pass_b.json` — enrichment provenance (raw LLM pass outputs).
- `data/sources/` — committed snapshots of upstream inputs.

## Schema (`corpus.csv`)
| column | meaning |
|---|---|
| id | stable id (`pNNNNNN`) |
| text | verbatim proverb (1901 orthography preserved, never modified) |
| normalized_text | lowercased, punctuation-stripped match key |
| modern_text | modern standard Ukrainian spelling (LLM-generated) |
| keyword | lemma/term (Franko), if any |
| explanation | scholarly note (Franko preferred), cleaned |
| category | 1–3 theme keys from `enrich/taxonomy.csv`, `;`-joined, primary first |
| sources | `;`-joined source citation keys |
| source_refs | `;`-joined per-source references |
| variant_group | id linking probable dialectal variants |

## Categories (taxonomy)
27 fixed themes (see `enrich/taxonomy.csv`): work_labor, poverty_wealth, food_hunger,
drink_alcohol, family_kinship, marriage_gender, speech_lying, wisdom_folly, fate_luck,
time_seasons, death_illness, religion_god, social_relations, class_power, justice_truth,
animals, body_health, home_household, conflict_enmity, friendship_love, travel_distance,
trade_money, ethnic_local, emotion_mood, nature_weather, appearance_reputation, idiom_expressive.

## Enrichment
`category`, `modern_text`, cleaned `explanation`, and the tuned `variant_group` are **LLM-generated
data artifacts** (produced by batched Claude Code agents — not a deterministic build).
Regenerating them requires Claude Code. See `enrich/REPORT.md` for the coverage and quality audit.

## Sources
- **Franko 1901** — Іван Франко, *Галицько-руські народні приповідки* (~30906 entries, with explanations).
- **Mlodzynskyi 2009** — *Практичний російсько-український словник приказок*.
- **Ilkevich 1841** — Григорій Ількевич, *Галицкіи приповѣдки и загадки*.
- **Bobkova** — В.І. Бобкова та ін. (упоряд.), *Українські народні прислів'я та приказки* (modern Ukrainian; full book, 5,613 proverbs, tesseract-OCR'd from the source PDF). Modern collection, so `modern_text` = `text`. See `expand/REPORT.md`.
- **Nomis 1864** — Матвій Номис, *Українські приказки, прислів'я і таке інше* (1864; public-domain; 9,785 proverbs). The foundational 19th-c. collection, OCR'd (per-column crop + tesseract) from the scan and LLM-extracted from its critical apparatus. `text` preserves the original 1864 orthography; `modern_text` is the modernized form. **Best-effort (~75–80%):** OCR character errors persist in `text` and a small fraction may be LLM-normalized toward familiar forms (measured ~95%+ faithful-to-OCR; see `expand/REPORT.md`). The source PDF is not vendored (29 MB; re-fetchable — provenance in `expand/REPORT.md`).

## Rebuild
```bash
pip install -r requirements.txt
python fetch.py      # refresh data/sources snapshots
python build.py      # regenerate corpus.csv + corpus.json
python -m pytest     # run the test suite
```

## Known limitations
- `sources.csv` carries `Citationkey, Title, Year, Author` only — the upstream source files provide no BibTeX/Year/Author metadata, so BibTeX output (mentioned in the spec) is omitted for lack of source data; Year and Author were added by hand where known.
- Variant groups are link-only (non-destructive): records are grouped by fuzzy similarity (rapidfuzz `token_set_ratio` ≥ 85), never merged; groups larger than 8 are dissolved to curb over-linking. Final: 3413 groups.
- Categorization is best-effort, single-pass: a quality audit (n=40) found modern_text ~95% acceptable and category tags ~85% acceptable (~15% debatable/wrong, usually secondary tags or themes outside the 27-key vocabulary). The primary category tag is the most reliable.

## Stats (last build)
- Total entries: 48787 (100% categorized; Nomis 1864 ingested)
- With explanation: 30532
- With modern_text: 48787
- Variant groups: 5064 (2638 contain Nomis variants linked to other sources)
- Per source: Franko1901 30906, Nomis1864 9785, Bobkova 5613, Ilkevich1841 2702, Mlodzynskyi2009 2261
- Top categories: emotion_mood, idiom_expressive, wisdom_folly, work_labor, animals
