# verba — SP9: Browsing (load-more + swipe discovery + saved)

**Date:** 2026-06-23
**Status:** Approved (design)
**Sub-project:** 9 — browse the corpus past the 80-result cap, plus an immersive swipe/discovery mode with a saved collection
**Repo:** `verbacorpus` (MurzikVasilyevich/verbacorpus); changes to `app/`
**Depends on:** the live PWA (SP4–SP7) + the verba brand/dark theme. SP8 social cards remain separate (share upgrades to `/p/:id` when SP8 lands).

---

## 1. Scope & motivation

Today the result list is hard-capped at **80** (`limit: 80` in `renderResults`) with no way past it — you can never explore beyond the top 80 of any query/filter across 48,787 entries. This sub-project adds two complementary browsing modes:

- **Reference mode (the list):** a **«Показати ще»** load-more button so you can page through *all* matches.
- **Discovery mode (swipe):** a full-screen, one-proverb-at-a-time **Tinder-style** browse — swipe right/♥ to **save**, left/✕ to **skip** — with a **saved collection** persisted in `localStorage` and surfaced as a **«♥ Збережені»** view in the main UI.
- A basic **«Поділитися»** (Web Share) on cards + the detail dialog.

**Out of scope:** server-side pagination UI (the API already supports `limit`/`offset`; the client pages over its in-memory corpus), `/p/:id` share targets (SP8), syncing saved items across devices.

## 2. Reference mode — load more

- `renderResults` keeps a module-level `shown` count (default 80, reset to 80 on every new query/filter change).
- **Lexical + filter** search runs over the full client corpus (MiniSearch / `filterProverbs`), producing the full ordered match array; the list renders `results.slice(0, shown)`. A **«Показати ще»** button below the list increments `shown` by 80 and re-renders. The results head shows **«показано N з M»**.
- **Semantic** search is server-side and capped at the API maximum (Vectorize topK ≤ 100): request `limit: 100`; render in `shown`-sized pages of that ≤100 set. Hide «Показати ще» once `shown ≥ results.length`.
- Button hidden when `shown ≥ M`. Keyboard-focusable, theme-aware.

## 3. Discovery mode — swipe (Tinder-style)

- Entry: a **«Гортати»** button in the controls (near search). Opens a full-screen overlay (`<div class="swipe">`, `role="dialog"`, focus-trapped, `Esc` closes).
- **Deck:** built from the current active filters (category/source/query) if any, else the **presentable** pool (`isPresentable`: starts uppercase Cyrillic, 18–90 chars, ≥4 words — no OCR fragments). Shuffled. The deck is effectively endless: when fewer than ~5 cards remain, reshuffle the pool and continue.
- **Card:** one proverb, large in Spectral on the willow ground (theme-aware light/dark), with modern reading (if it differs), source · theme · catalog №. Below: three controls — **✕ (skip)**, **♥ (save)**, **Поділитися (share)** — plus a hint that you can swipe / use ← → keys. Tapping the card body opens the existing **detail dialog** (explanation/variants/similar).
- **Mechanics:**
  - **Save:** swipe right · `→`/`s` key · ♥ button → add id to the saved set; card animates off-right; advance.
  - **Skip:** swipe left · `←` key · ✕ button → card animates off-left; advance. Skips are **not remembered** (no "seen" tracking — YAGNI; the corpus is large enough).
  - Touch via Pointer Events (`pointerdown`/`move`/`up`, horizontal drag with a distance threshold ~25% of card width); the card follows the finger and flies off on commit, snaps back otherwise. `prefers-reduced-motion` → no fly-off, instant advance.
  - The ♥ button reflects saved state (filled when already saved; toggles).

## 4. Saved collection + «♥ Збережені» view

- Persisted in `localStorage` under key **`verba:saved`** = JSON array of ids (newest first). A pure `toggleSaved(set, id)` manages membership; main.ts wraps it with load/persist.
- A **«♥ Збережені (N)»** control sits with the filters. Activating it sets a `savedView` mode: the result list renders the saved proverbs (resolved from ids via `byId`, preserving saved order), each with a way to **remove** (♥-filled toggle). Empty state: an inviting message pointing to «Гортати». Deactivating returns to normal search/filter.
- The count `(N)` updates live as items are saved/removed (in swipe mode and the view).

## 5. Share

- A `share(p)` helper: if `navigator.share` exists → `navigator.share({ title: "Українське прислів'я", text: p.text, url: location.origin })`; else copy `p.text + " — " + location.origin` to the clipboard with a brief "скопійовано ✓" confirmation; final fallback opens the homepage.
- Used by the swipe card's «Поділитися» and added to the **detail dialog**. (When SP8 ships, `url` becomes `/p/:id` and a card image is offered.)

## 6. Components / files

- **`app/src/shared/browse.ts`** (NEW, pure — Workers-pool testable):
  - `isPresentable(text: string): boolean` (moved from main.ts; the client imports it).
  - `deckFor(proverbs: Proverb[], opts: { category?: string; source?: string; presentableOnly?: boolean }): Proverb[]` — filters (does **not** shuffle; shuffle is the caller's impure concern).
  - `toggleSaved(set: Set<string>, id: string): Set<string>` — returns a new set with `id` added/removed.
  - `nextShown(shown: number, step: number, total: number): number` — `Math.min(shown + step, total)`.
- **`app/src/client/main.ts`** — load-more state + button wiring; the swipe overlay (open/close, render card, Pointer-Event drag, keyboard, buttons, reshuffle); the saved store (localStorage read/write via `toggleSaved`); the «♥ Збережені» view mode; the `share` helper. Replaces the local `isPresentable`/duplicate with the import.
- **`app/public/index.html`** — the «Гортати» + «♥ Збережені (N)» controls in the controls area; the swipe overlay markup; the «Показати ще» button container.
- **`app/public/styles.css`** — swipe overlay + card + action buttons + drag transitions; load-more button; saved-view tweaks. All via theme vars (light/dark), visible focus, reduced-motion respected.
- **`app/public/sw.js`** — cache bump.

## 7. Testing

- **vitest** (`app/test/browse.test.ts`, Workers pool — pure logic only):
  - `isPresentable`: accepts a clean proverb; rejects too-short / lowercase-initial / <4-word / OCR-fragment strings.
  - `deckFor`: filters by category and by source; `presentableOnly` drops non-presentable; returns all when no opts; never mutates input.
  - `toggleSaved`: adds when absent, removes when present, returns a new Set, leaves the input unchanged.
  - `nextShown`: increments by step, clamps at total, never exceeds total.
- **Manual (preview):** swipe gestures on touch + mouse-drag; ← → / ♥ / ✕ keys + buttons; save persists across reload (localStorage); «♥ Збережені» view lists + removes; «Показати ще» pages lexical to the end and is hidden for exhausted semantic; share sheet/clipboard; light **and** dark; mobile + desktop; `Esc` closes the overlay; reduced-motion.

## 8. Accessibility & theming

- Swipe overlay: `role="dialog"`, `aria-modal`, focus moves in on open and is trapped, `Esc` closes, focus restored on close. All actions reachable by keyboard (not swipe-only). Buttons have `aria-label`s; the ♥ button exposes `aria-pressed`.
- Everything derives from the theme CSS vars (works in light + dark). Drag/fly-off animations gated behind `prefers-reduced-motion: no-preference`.

## 9. Deploy

`wrangler deploy` — outward; **confirmed with the user**. Client-only change (no Worker bindings, no API change). Bump `sw.js` cache. Verify on a preview first (gestures + saved persistence + both themes).

## 10. Risks / open items

- **Touch-swipe vs scroll:** the overlay card must not fight vertical page scroll. Mitigation: the overlay locks body scroll while open; the drag handler only acts on dominant-horizontal movement (`|dx| > |dy|`).
- **localStorage availability:** private-mode / disabled storage → wrap reads/writes in try/catch; saving silently degrades (in-memory only for the session) rather than throwing.
- **Semantic load-more ceiling:** capped at the Vectorize topK (≤100); the button hides at the cap. Documented in the results head copy; acceptable (semantic is for relevance, not exhaustive paging).
- **`main.ts` size:** it already holds the app; adding swipe/saved grows it. The pure logic is extracted to `shared/browse.ts`; if the overlay glue gets large, a follow-up may split a `swipe.ts` client module (not required now).
