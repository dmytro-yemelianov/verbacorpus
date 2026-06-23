# Ukrainian Proverbs Corpus — Productization (4a exports + 4b Worker app)

**Date:** 2026-06-23
**Status:** Approved (design)
**Sub-project:** 4 of 4, **phases a+b** (4a exports · 4b Worker API+PWA · 4c bot deferred)
**Repo:** `ukr-proverbs-corpus` (existing); app under a new `app/` dir
**Depends on:** SP1 corpus, SP2 enrichment, SP3a/3b Bobkova — done (corpus = 40,444).
**Pattern:** mirrors the proven `ua-bez-tabu` Cloudflare Worker stack (PWA + REST API + multi-format exports).

---

## 1. Scope

Make the 40,444-proverb corpus publicly usable: deterministic multi-format **exports** + a **Cloudflare
Worker** serving a **searchable, offline-capable PWA** and a **REST API**. Telegram bot (4c) is deferred.

**Out of scope:** Telegram bot; D1/database backend; auth; write/contribution endpoints.

## 2. Exports (4a — deterministic, no LLM)

A Python build (`app/build_data.py`, reusing `corpus.csv`) produces, into `app/public/data/`:
- **`proverbs.json`** — compact browse/search list: array of `{id, text, modern_text, category (array), sources (array), variant_group}`. **Excludes** the long Franko explanations to keep first load small (target ~5–7 MB vs the 17 MB full `corpus.json`).
- **`explanations.json`** — `{id: explanation}` for the ~30,605 entries that have one; fetched lazily on the detail view (kept out of the initial payload).
- **`meta.json`** — counts, the 27-theme taxonomy (`key → ukrainian_label` from `enrich/taxonomy.csv`), the source registry (from `sources.csv`), and build stats.
- **`corpus.xml`** — full XML export (parity with ua-bez-tabu's multi-format offering), written to the repo root alongside the existing `corpus.json`.

All export files are deterministic (sorted by `id`); committed.

## 3. Search/data architecture

**Client-side search** (offline-first, mirrors ua-bez-tabu; no database):
- The PWA fetches `proverbs.json`, builds a **MiniSearch** index in the browser over `text` + `modern_text` (+ `keyword` not included; categories/sources are filters, not full-text). 40K docs index in ~1–2 s.
- The **service worker precaches** the app shell + `proverbs.json` so search works fully offline; `explanations.json` is cached on first detail view.
- The **Worker API** loads `proverbs.json` (from the `ASSETS` binding) into module scope on cold start and serves the same data with in-memory filtering/search — 40K objects fit comfortably in Worker memory (128 MB).

Rationale: 40K is well within client + Worker-memory limits; D1/FTS adds infra and weakens offline for no benefit at this scale. (D1 is the documented alternative if the corpus later grows past a few hundred K.)

## 4. REST API (`app/src/index.ts`, TypeScript)

Worker handles `/api/*` (everything else → static assets / SPA). JSON, permissive CORS.
- `GET /api/search?q=&category=&source=&limit=&offset=` → `{total, results: [proverb…]}` (q = MiniSearch/substring over text+modern_text; category/source = exact filters; default limit 50, max 200).
- `GET /api/proverb/:id` → full proverb incl. explanation (Worker reads `explanations.json`).
- `GET /api/random?category=&source=` → one random proverb.
- `GET /api/categories` → taxonomy with per-theme counts.
- `GET /api/meta` → meta.json.
- Unknown `/api/*` → 404 JSON. Errors → JSON `{error}` with correct status.

## 5. PWA (`app/public/`)

Ukrainian-language UI:
- **Search** box (debounced, client-side MiniSearch) + **filter chips**: 27 theme keys (Ukrainian labels) and 4 sources.
- **Result list**: each item shows `text`, `modern_text` (if different), category badges, source tag.
- **Detail view**: full text, modern_text, explanation (lazy), variant-group siblings, source refs.
- **Random proverb** button. **Result count.** Empty/no-results state.
- **Installable**: `manifest.webmanifest` + icon; **offline**: `sw.js` precaches shell + `proverbs.json`, runtime-caches `explanations.json`.
- Accessible, responsive, no framework required (vanilla TS compiled by esbuild) — matches ua-bez-tabu.

## 6. Components / files

```
app/
  build_data.py          # corpus.csv -> public/data/{proverbs,explanations,meta}.json + corpus.xml  [TDD]
  wrangler.jsonc         # Worker config (ASSETS, SPA, run_worker_first:/api/*)
  package.json, tsconfig*, build.mjs   # esbuild client build
  src/
    index.ts             # Worker: /api/* routing + handlers
    shared/corpus.ts     # load proverbs.json, search/filter/random helpers (shared Worker+client)
    client/main.ts       # PWA UI logic (MiniSearch, render, filters, detail)
  public/
    index.html  styles.css  manifest.webmanifest  icons/icon.svg
    sw.js                # service worker (precache shell + data)
    data/proverbs.json  data/explanations.json  data/meta.json   (generated, committed)
  test/api.test.ts       # vitest: API endpoints over a fixture corpus
corpus.xml               # generated full export (repo root)
```

The search/filter/random logic lives in `src/shared/corpus.ts` so the Worker API and the client use the
**same** tested functions. `build_data.py` is the only Python; the app is TypeScript.

## 7. Testing

- **`build_data.py`** (pytest, TDD): a fixture `corpus.csv` → correct `proverbs.json` (compact fields, arrays split), `explanations.json` (only non-empty), `meta.json` (counts/taxonomy), valid `corpus.xml`.
- **`src/shared/corpus.ts`** (vitest): search matches text+modern_text; category/source filters; random respects filters; pagination (limit/offset).
- **API** (`test/api.test.ts`, vitest + Worker test harness): each endpoint returns correct shape/status over a small fixture dataset; 404 + CORS behavior.
- Manual: `wrangler dev` smoke test (search, filter, detail, offline) before deploy.

## 8. Tech stack

Python 3 (build_data, reuse `enrich`/`core` where useful) for exports; TypeScript + esbuild + Cloudflare
Workers (wrangler) + MiniSearch + vitest for the app. Same toolchain as `ua-bez-tabu`.

## 9. Deploy (outward — confirm before running)

`wrangler deploy` to `ukr-proverbs-corpus.<account-subdomain>.workers.dev` using the existing
`CLOUDFLARE_API_TOKEN`. The deploy step is the only outward action and will be **confirmed with the user**
at execution time (consistent with the GitHub-remote handling in SP1).

## 10. Open items / risks

- **First-load size**: `proverbs.json` target ~5–7 MB; if larger, drop `variant_group`/trim further or gzip
  (Workers serve compressed). Measured during build; reported.
- **MiniSearch index build time** on low-end devices: acceptable (~1–2 s) and cached; revisit if slow.
- **Wrangler account/subdomain**: deploy needs the Cloudflare account reachable via `CLOUDFLARE_API_TOKEN`;
  confirm `wrangler whoami` at deploy time.
- Exports are deterministic data artifacts; the app reads them at build/deploy time.
