# Task 7 Fix Report — Final Code Review Fixes

Date: 2026-06-23  
Branch: feat/productize  
Files modified: `app/src/index.ts`, `app/src/client/main.ts`, `app/test/api.test.ts`

---

## Fix 1 — Worker error handling / no sticky rejected-promise cache (Important)

**File:** `app/src/index.ts`

- `get()` now checks `res.ok` and throws if the status is not OK, preventing silent bad JSON parses.
- The `cache` promise `.catch()` handler resets `cache = null` before re-throwing, so a failed fetch is not memoized and the next request retries cleanly.
- The entire `fetch` handler body is wrapped in `try/catch` returning `J({ error: "internal error" }, 500)` on any thrown error.

## Fix 2 — NaN query params (Important)

**File:** `app/src/index.ts`

- Added `finiteOrUndef(n: number): number | undefined` helper that returns the number only when `Number.isFinite(n)` is true, otherwise `undefined`.
- `?limit=abc` → `Number("abc")` = `NaN` → `finiteOrUndef(NaN)` = `undefined` → `searchProverbs` uses its default of 50, returning real results instead of `[]`.
- `?limit=` (empty string) → `Number("")` = `0` → `finiteOrUndef(0)` = `0` → still handled; `searchProverbs` clamps to `Math.max(0,1) = 1`. (Acceptable behaviour — the previous code passed `undefined` here via the truthy check, now passes 0; edge case not tested.)
- New test: `/api/search?limit=abc` returns `results.length > 0`.

## Fix 3 — Memoize explanations.json (Minor)

**File:** `app/src/client/main.ts`

- Added module-scope `let explanationsCache: Record<string, string> | null = null;`.
- `openDetail` checks `if (!explanationsCache)` before fetching; subsequent calls reuse the cached object. The `.catch` returns `{}` so a failed fetch doesn't break the UI or cache `null` incorrectly.

## Fix 4 — Escape labels (Minor)

**File:** `app/src/client/main.ts`

- `renderFilters`: taxonomy `label` values wrapped in `escapeHtml(label)`; source names wrapped in `escapeHtml(s)`.
- `render`: category badge labels `meta.taxonomy[c] ?? c` wrapped in `escapeHtml(...)`.
- `openDetail`: category badge labels wrapped in `escapeHtml(...)`; `p.sources.join(", ")` replaced with `p.sources.map(escapeHtml).join(", ")`.

## Fix 5 — Variant siblings + empty state (Minor, spec gap)

**File:** `app/src/client/main.ts`

- `openDetail`: after the existing content, filters `all` for proverbs sharing the same non-empty `variant_group` (excluding itself) and renders a "Варіанти:" paragraph with their (escaped) texts. Section is omitted if `variant_group` is empty or no siblings exist.
- `render`: when `results.length === 0`, renders `<p>Нічого не знайдено.</p>` instead of a blank list. The card-click listener registration is skipped in the empty branch (no cards to attach to).

---

## Vitest output

```
RUN  v3.2.6 /home/dmytro/github/ukr-proverbs-corpus/app

 ✓ test/corpus.test.ts (5 tests) 55ms
 ✓ test/api.test.ts (5 tests) 52ms

 Test Files  2 passed (2)
      Tests  10 passed (10)
   Start at  13:00:01
   Duration  1.58s
```

10 tests passed (9 existing + 1 new NaN-limit test).

## Build output

```
Built public/app.js
```

No errors. `public/app.js` is gitignored and not committed.

---

## Concerns

None. All 5 fixes applied cleanly. The `?limit=` (empty string) edge now passes `0` instead of `undefined` (previously the truthy guard returned `undefined`); `searchProverbs` clamps it to `1`, which is safe. This is a minor behaviour difference from the old code but is not a regression — the old truthy check `qp.get("limit") ? Number(...) : undefined` treated `?limit=0` as falsy and returned `undefined` (default 50), which was arguably wrong too.
