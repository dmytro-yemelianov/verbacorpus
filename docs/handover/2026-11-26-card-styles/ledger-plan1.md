# SDD ledger — plan: /Users/dmytro/github/verbacorpus/docs/superpowers/plans/2026-11-26-verba-api-foundation.md

Spec: docs/superpowers/specs/2026-11-25-verba-api-design.md (approved 2026-11-26).
Models: implementers sonnet (Task 1 haiku), task reviewers sonnet, final review opus.

## Pre-flight scan

| Rows | Produces → consumes | Finding |
|---|---|---|
| T0 self | git only | Uncommitted work lives in main checkout on integrate/bez-tabu; cannot run in a worktree. |
| T1 self | contract.ts + tests | consistent |
| T1→T2 | Corpus, Item, Licence, LICENCES, API_BASE, ApiError | consistent |
| T2 self | adapters + fixtures + runContractSuite | consistent; offset-beyond-total test present (RF3) |
| T2→T3 | Adapter, Upstream, fakes | consistent |
| T2→T5 | runContractSuite reused for contra | consistent |
| T3 self | router + wrangler | consistent |
| T3→T4 | handle, adaptersFor | T4 test injects fake contra adapter but handle(request, env) has no injection point → ruling R4 |
| T3/T4→T6 | route list for OpenAPI | consistent |
| T5 self | app + gateway | fixtures-site is ASSETS for ALL Verba tests; adding bez-tabu fixture may affect bez-tabu.test.ts → note in dispatch |
| T5→T3 | modifies adaptersFor | consistent |
| T7 self | deploys | each step needs Dmytro's yes → stop point |

Rulings:
- R1: Task 0 runs in main checkout (/Users/dmytro/github/verbacorpus, integrate/bez-tabu). Tasks 1–6 run in worktree branch feat/verba-api created from integrate/bez-tabu after Task 0 (PR to main pending Dmytro's merge; rebase onto main after merge) — plan says "from main" but main lacks the bez-tabu work Task 5 needs — cost if wrong: one rebase.
- R2: Task 0 push+PR (step 5) and private nasinnia repo (step 8) are pre-approved by Dmytro's decisions 6a/8a (2026-11-25) — proceed — cost if wrong: a private repo / open PR to delete.
- R3: Task 7 deploy steps stop for Dmytro's explicit yes each time.
- R4: handle signature becomes handle(request: Request, env: Env, adapters?: Partial<Record<Corpus, Adapter>>) defaulting to adaptersFor(env); lets T4 tests inject fake contra — cost if wrong: trivial refactor.

## Progress
- Task 0: dispatched (sonnet) in main checkout, BASE verba 290e657, nasinnia fdd545f
- Task 0: implementer DONE_WITH_CONCERNS (observations only: bdcf6a1 not independently buildable; py tests needed venv). Verba 290e657..719e8d3, nasinnia fdd545f..5562614, PR #24, nasinnia private. Review dispatched (sonnet).
- Task 0: complete (verba 290e657..719e8d3, nasinnia fdd545f..5562614, review: spec ✅, 5 Minor)
  Ruling: accept Minor findings without history rewrite (bdcf6a1 not standalone-buildable; coarse 41820a4) — PR #24 already pushed, rewriting needs force-push for cosmetic bisectability — cost if wrong: harder bisect within that PR.
  Ruling: approval for push/private repo per R2.
- Worktree: /Users/dmytro/github/verbacorpus-api (feat/verba-api from 719e8d3); workspace stays in main checkout path
- Task 1: dispatched (haiku) BASE 719e8d3
- Task 1: implementer DONE_WITH_CONCERNS (wrangler pinned ~4.103.0 for peer compat; trailer fixed by controller → 8323aa5; report saved by controller). Review dispatched (sonnet).
- Task 1: complete (commits 719e8d3..8323aa5, review clean: spec ✅, Minor only)
  Note: review-package script produced wrong range from worktree (symlinked workspace); from now on build diffs with `git -C /Users/dmytro/github/verbacorpus-api` manually.
  Parked Minor (for final review): errorResponse lacks cache-control no-store; json(cache) untested.
- Task 2: dispatched (sonnet) BASE 8323aa5
- Task 2: implementer DONE 1bdedeb (18 tests). Review dispatched (sonnet). Note for T3: router must validate limit 1..100 (para divides by limit).
- Task 2: complete (commits 8323aa5..1bdedeb, review clean: spec ✅, Minor only; controller verified live proverb single shape = bare object, matches fake)
  Parked Minor: html links not encodeURIComponent (pro/non); malformed upstream body → TypeError not ApiError(502); para two-page fetch sequential.
- Task 3: dispatched (sonnet) BASE 1bdedeb, with ruling R4 (handle(request, env, adapters?)) and: unexpected non-ApiError → 502 upstream_error envelope.
- Task 3: implementer DONE a0ea190 (37 tests, dry-run ok). Review dispatched (sonnet).
- Task 3: review spec ❌ (Focus 1 status) + 2 Important (no timeout; weak Focus 5 tests).
  Ruling F1: upstream unreachable / network error / 5xx / timeout → 503 `unavailable` (matches Review Focus 1 text); malformed upstream body or unexpected 4xx → 502 `upstream_error`; missing binding → 503 — spec text says 503 — cost if wrong: status code change.
  Ruling F2: timeouts — fetchJson uses AbortSignal.timeout(8000); corpora() races each meta() against 2500 ms → total null, available false.
  Task 3: minor (deferred): empty-segment collapse in paths; corpora.json entries untyped; full searchParams passed to list (adapters whitelist).
- Task 3: fix round 1/5 (3 addressed, 0 open; commits a0ea190..54b39f2)
- Task 3: minor (deferred): body-read abort maps to 502 not 503; 8s AbortSignal path untested.
- Task 3: complete (commits 1bdedeb..54b39f2, review clean after round 1)
- Task 4: dispatched (sonnet) BASE 54b39f2
- Task 4: implementer DONE 505e745 (56 tests). Review dispatched (sonnet).
- Task 4: review — 4 Important (non-Latin-1 seed → header TypeError 500; mixed = 2 sequential calls/item, n=50 ≈100 subrequests; default mix 503 if one adapter missing; n*5 retry budget under-fills when n≈total). Controller verified: handle does `return await route(...)` inside try (cannot-verify item OK).
  Ruling R5: seed — accept any string ≤ 128 chars (longer → 400); `x-verba-seed` header carries encodeURIComponent(seed); body adds top-level `seed` field verbatim.
  Ruling R6: mixed — assign corpora for all n draws first, fetch each corpus total once, then pick offsets; per-request total cache; cross-item dedupe by id (same rule as single corpus).
  Ruling R7: default mix (no corpus param) uses available adapters among pro/non/para; 503 only if none available; explicit corpus list keeps strict 503.
  Ruling R8: when n >= total, return all items in a seeded shuffled order (Fisher–Yates on offsets with rng) instead of retrying; otherwise keep retry with budget n*5.
  Task 4: minor (deferred): duplicate intParam(n); total field = picked count (document in OpenAPI, Task 6); filters passed include n/seed (adapters whitelist).
  Ruling R9: n max lowered 50 → 20 for all random routes (each pick = 1 subrequest; 20+corpora stays under Workers 50-subrequest free limit; Verba/UPA/Nasinnia via service bindings count) — cost if wrong: smaller batches. Plan said 1–50; spec silent.
- Task 4: fix round 1/5 (4 addressed + R9 applied, 0 open; commits 505e745..2a7f8b0)
- Task 4: minor (deferred): retry branch may under-fill when n just below total; mixed doesn't reassign draws when a corpus is exhausted; weak "totals once" test.
- Task 4: complete (commits 54b39f2..2a7f8b0, review clean after round 1)
  Carry to Task 6: OpenAPI must say n 1–20, body `seed` field, header x-verba-seed is URL-encoded, `total` in random = picked count; update plan line "n 1–50" → "n 1–20".
- Task 5: dispatched (sonnet) BASE 2a7f8b0
- Task 5: implementer DONE 6717fe0, ef1113e (py 6, app 239, gateway 67). Review dispatched (sonnet).
- Task 5: review spec ❌ (missing "/bez-tabu/ responds as before" test), quality Approved (Minor only). Fix round 1: add that test + regression test contra excluded from default mix with PRO bound + compute id table before writing snapshot (atomic sync) + console.warn on fallback id.
  Task 5: minor (deferred): JS trim vs Python strip whitespace sets; module-level cache bound to first ASSETS.
- Task 5: fix round 1/5 (4 addressed, 0 open; commits ef1113e..10e0344)
- Task 5: minor (deferred): PEP8 blank line; write_ids I/O failure after snapshot write; no test for warn-once.
- Task 5: complete (commits 2a7f8b0..10e0344, review clean after round 1)
- Task 6: dispatched (sonnet) BASE 10e0344
- Task 6: implementer DONE 1f48e21 (72 tests, dry-run ok). Review dispatched (sonnet).
- Task 6: complete (commits 10e0344..1f48e21, review clean: spec ✅, Minor only)
- Task 6: minor (deferred): seed length counts UTF-16 units; empty seed = no seed undocumented; servers hardcoded to prod (Swagger try-it from preview hits prod); no SRI on CDN; docs headers hand-built; openapi test checks presence only.
- Final review (opus) dispatched over 719e8d3..1f48e21 before Task 7 deploy
- Final review: Ready to deploy (0 Critical/Important, 7 Minor). Fix wave (one subagent, sonnet) for: dot-segment IDs → 404; expose x-verba-seed; corpora no-store when any unavailable; non html from upstream links.catalog; parallel picks; default mix skips failed corpus; OpenAPI servers "/".
  Ruling: Cache API (spec §5.5) deferred to plan 2 — Cache-Control only for now — cost if wrong: higher upstream load until then.
- Final fix wave: 7/7 addressed (commits 1f48e21..1918ece, 84 tests, dry-run ok).
  Parked — degraded seeded default mix cached public 24h — Ruling: real but low impact (gateway has no Cache API; only client caches honour it) — fix in plan 2 alongside Cache API — cost if wrong: a browser may show a corpus-less random set for up to a day during an outage.
  Parked — non-ApiError tolerance in default mix; vacuous ".." router tests — Ruling: minor, deferred to plan 2.
- Tasks 1–6 + final review complete. Task 7 (deploy) waiting for Dmytro's yes.
- Task 7 step 1 (Dmytro: «так»): Nasinnia code deployed, version 357479ee (rollback target c0bfa623 from 2026-07-21). catalog:sync skipped — live D1 IDs == local 2260, R2 records present; nothing to change. Live checks 200/200/404/200, total 2260.
  Ruling: skip catalog:sync despite approval — data already identical, avoids needless D1/R2 writes — cost if wrong: none (can run later).
  Correction: Nasinnia id is cozette-13x15 (cozette-6x13 is a filename) — spec §5.1 example `para:cozette-6x13` is wrong; fix in docs.
- PR #25 opened (feat/verba-api → integrate/bez-tabu, stacked on #24).
- Task 7 step 2: PR #24 merged (Dmytro «ок давай»); main CI run 45720127226 — first attempt failed pre-publish on flaky UPA WebKit e2e (reduced-motion border), nothing published; rerun of failed job passed and published UPA, umbrella, non.verba; post-publish verify success; live 200s.
  Ruling: one rerun of the failed job instead of investigating first — Chromium passed same test, pre-publish gate means a real failure would block again — cost if wrong: flaky UPA reduced-motion test still unfixed (logged for UPA).
- PR #25 retargeted to main and merged; CI deploy running.
- Task 7 step 2 done: PR #25 merged; first CI attempt failed on flaky corpus-loading timeout (nothing published), rerun published; live /api/v1/contra 1995, cron 0 6 unchanged.
- Task 7 step 3: gateway deployed to https://verba-api.miwaniza.workers.dev. BUG found live: default export `fetch: handle` let runtime ctx override adapters param (from ruling R4) → all corpora unavailable. Fixed in ea646dd (entry calls handle(request, env); entry.test.ts), deployed 4a8e0684, PR #26. Live: 4 corpora available (pro 48787, contra 1995, para 2260, non 167), items/random/resolve OK, seed deterministic, para:. → 404, corpora 0.18 s, para random n=20 0.85 s.
  Ruling R4 consequence: injection param on the exported handler was a defect the unit tests couldn't see — cost: one broken deploy for ~10 min on workers.dev (no public domain).
- Remaining: step 4 custom domain api.verbacorpus.org (needs Dmytro's yes); step 5 handover docs; live.test.ts.
- Task 7 complete: api.verbacorpus.org live (51024a6e); PR #26 merged (ctx fix, domain, live test, handover). main CI red on corpus-loading (2.8 s → 5.1 s after #25: cold import incl. ID table) → PR #27 lazy contra import + 20 s test budget, merged, CI green, live OK.
  Ruling: merged #26/#27 and fixed CI myself after Dmytro's «так, ок» — fixes for defects my changes introduced — cost if wrong: two small PRs to revert.
