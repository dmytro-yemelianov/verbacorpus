# Ukrainian Proverbs Corpus — SP7: Proper Multi-Format REST API

**Date:** 2026-06-23
**Status:** Approved (design)
**Sub-project:** 7 — a versioned, content-negotiated public REST API (JSON / JSONL / XML / CSV / TSV)
**Repo:** `ukr-proverbs-corpus`; additions to `app/`
**Depends on:** SP1–SP6 (corpus 48,787, live Worker app + semantic index).
**Context:** First of the "popularization" efforts (social cards, SEO, HuggingFace/PR, Telegram bot are separate, deferred).

---

## 1. Scope

Turn the app's ad-hoc JSON endpoints into a **proper, documented, versioned REST API** that serves the corpus
in **JSON, JSONL, XML, CSV, and TSV**, with consistent pagination, headers, content negotiation, and an OpenAPI
spec — so developers, researchers, and data tools can consume the 48,787-proverb corpus in their format of choice.

**Out of scope:** social-card engine, per-proverb pages, SEO, HuggingFace publish, Telegram bot (separate
sub-projects); auth / API keys / rate-limiting (public, permissive — revisit only if abused); write endpoints.

## 2. Format negotiation

- **`?format=`** query param: `json` (default) · `jsonl` · `xml` · `csv` · `tsv`. Unknown value → **400** JSON `{error}`.
- **`Accept` header** fallback when `?format=` absent: `application/json`→json, `application/x-ndjson`→jsonl,
  `application/xml`/`text/xml`→xml, `text/csv`→csv, `text/tab-separated-values`→tsv, `*/*`/unknown→json. **`?format=` wins.**
- Each response sets the correct `Content-Type`; file formats (csv/tsv/xml/jsonl) also set
  `Content-Disposition: attachment; filename="proverbs-<endpoint>.<ext>"`. CORS `Access-Control-Allow-Origin: *` on all.

## 3. Endpoints (canonical under `/api/v1/`)

All collection endpoints share params `limit` (default 50, max 200), `offset` (default 0), `format`.
- `GET /api/v1/search?q=&category=&source=&limit=&offset=&format=` — lexical (substring over text+modern_text).
- `GET /api/v1/semantic?q=&category=&source=&minScore=&limit=&format=` — meaning-based (Vectorize).
- `GET /api/v1/random?n=&category=&source=&format=` — `n` random (1–50, default 1).
- `GET /api/v1/query?category=&source=&has_explanation=&variant_group=&limit=&offset=&format=` — flexible filter.
- `GET /api/v1/proverb/:id?format=` — single proverb **incl. `explanation`**; 404 if unknown.
- `GET /api/v1/export?category=&source=&format=` — bulk dump (whole corpus or filtered), **incl. `explanation`**;
  streamed/built in-memory; `limit` ignored (returns all matching, up to the full 48,787).
- `GET /api/v1/categories` — the 27 themes with counts. `GET /api/v1/meta` — corpus metadata.
- `GET /api/v1/openapi.json` — the OpenAPI 3 spec. `GET /api` — a human HTML docs page (linked in the footer).

**Aliases / back-compat:** the existing unversioned paths (`/api/search`, `/api/proverb/:id`, `/api/random`,
`/api/semantic`, `/api/similar/:id`, `/api/categories`, `/api/meta`) keep working unchanged (default JSON) — the PWA
and any existing links must not break. Routing strips an optional `/v1` segment and dispatches to shared handlers;
format negotiation is available on both, so `/api/search?format=csv` also works.

## 4. Record shape & response conventions

- **Record** (the proverb object): `{id, text, modern_text, category[], sources[], variant_group}`. `proverb/:id`
  and `export` additionally include `explanation` (merged from explanations.json; "" if none).
- **JSON** (default): collections → `{total, limit, offset, results:[record…]}`; single → the record object.
- **JSONL**: one record JSON per line, no envelope (single → one line).
- **XML**: `<proverbs><proverb id="…"><text/><modern_text/><category/><sources/>[<explanation/>]</proverb>…</proverbs>`,
  UTF-8, XML-escaped (reuse the `corpus.xml` element shape from `build_data.py`); single → one `<proverb>` under `<proverbs>`.
- **CSV / TSV**: header row + one record per row; columns `id,text,modern_text,category,sources,variant_group[,explanation]`
  (category/sources `;`-joined); RFC-4180 quoting for CSV (quote fields containing `, " \n`; `"`→`""`), tab-separated for TSV
  (strip tabs/newlines from fields).
- **Headers**: collections set `X-Total-Count`. Errors → JSON `{error}` with the right status (400 bad format/param, 404 unknown id/route, 502/503 for semantic backend, 500 catch-all).

## 5. Components / files

- **`app/src/shared/serialize.ts`** — pure `serialize(records: Proverb[]|Proverb, format, opts) -> {body, contentType, filename?}`
  for the 5 formats + the collection-vs-single distinction. The single source of format logic. [TDD vitest]
- **`app/src/index.ts`** — add `/v1` prefix stripping + `Accept`/`?format=` negotiation; the new `query` and `export`
  handlers; wire all collection/single responses through `serialize`. Existing handlers/logic (search/semantic/random/
  proverb/categories/meta from `shared/corpus.ts` + Vectorize) reused unchanged. [TDD vitest]
- **`app/public/openapi.json`** (or Worker-served) — OpenAPI 3 description of the endpoints/params/formats.
- **`app/public/api.html`** — a small static docs page (endpoint list + curl examples for each format), linked from the
  PWA footer. Plain HTML in the editorial style; no external JS.
- **`app/src/shared/corpus.ts`** — may gain a `queryProverbs(all, {category,source,has_explanation,variant_group,...})`
  helper for the flexible filter (or extend `searchProverbs`). [TDD]

## 6. Testing

- **vitest `serialize.ts`**: each format's output for a fixture set — JSON envelope vs single; JSONL line count;
  XML well-formed + escaped; CSV RFC-4180 quoting (commas/quotes/newlines in proverb text); TSV tab-safety; correct
  `contentType`/`filename`.
- **vitest API** (`test/api-v1.test.ts`, over the mocked-binding harness): `?format=` selection + `Accept` negotiation
  + `?format=` precedence; unknown format → 400; `X-Total-Count` + `Content-Disposition` headers; `/api/v1/query`
  filters; `/api/v1/random?n=`; `/api/v1/export` returns all rows incl. explanation; **aliases** (`/api/search` still
  returns the old JSON shape); CORS.
- **Manual:** preview deploy → curl each endpoint×format; validate the CSV opens in a spreadsheet, JSONL parses
  line-by-line, XML validates, `openapi.json` loads in an OpenAPI viewer.

## 7. Deploy

Redeploy the Worker (`wrangler deploy`) — outward; **confirmed with the user**. No new bindings or infra; reuses the
existing ASSETS + AI + VECTORIZE. Bump `sw.js` cache (adds `api.html`).

## 8. Risks / open items

- **Export payload size**: full corpus as CSV/JSONL ≈ 7–10 MB built in Worker memory (128 MB) — fine at 48,787; if the
  corpus grows much larger, switch `export` to a streamed `ReadableStream`. Documented; not implemented now.
- **Back-compat**: the alias routing must keep the exact current JSON shape for the PWA's calls — covered by an alias test.
- **Semantic in non-JSON formats**: `/api/v1/semantic?format=csv` includes the `score`? Decision: semantic results carry
  `score` in JSON/JSONL only; CSV/TSV/XML omit `score` (keep columns uniform with the other endpoints). Stated so it's not ambiguous.
