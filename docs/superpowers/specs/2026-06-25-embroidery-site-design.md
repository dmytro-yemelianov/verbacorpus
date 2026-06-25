# Embroidery Patterns Across the Site — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorming) — pending spec review

## Goal

Elaborate the authentic Ukrainian embroidery (рушник) patterns — currently used only
on the share cards (`/card/:id.gif` + `.png`) — into the **live site's visual design**
(verbacorpus.org), as a recurring, maximal-but-content-first decorative system that
ties the pages visually to the cards.

## Approved decisions (from brainstorming)

- **Direction:** *Rich framing, maximal, with red.* Embroidery frames major surfaces;
  red becomes a real site accent color (today the site is sage-on-cream only; red lives
  only on the cards).
- **Dark theme:** red/black (light) → **`--catkin` gold `#d8aa54` + light threads** on
  dark paper. The motif's signature color shifts red↔gold between themes.
- **Motif system (refinement, approved):** pick **3 recurring motifs** with fixed roles
  and reuse them consistently — NOT a different pattern per element. All drawn from the
  same UPA corpus the cards use (`dyco/assets/ukrainian-embroidery-corpus`, already
  curated into `app/src/shader/embroidery.ts`).
- Source of truth for patterns stays the UPA corpus; the site reuses it, it is not
  redrawn by hand.

## Motif system

Three units from the existing 38 in `embroidery.ts`, by role:

| Token | Unit (id) | Role |
|---|---|---|
| **A — bold** | chevron-wave `upa_2c1afca8547010f7` | header band, footer band |
| **B — medium** | crosses/rings `upa_a83394df6ae60276` | section dividers, hero side-bands, grid spines |
| **C — rich** | roses `upa_6cdef2752bd9b5fb` | hero рушник frame (top + bottom) |

(Exact unit choices may be swapped during implementation if one tiles better at a given
size, but the *system* — one bold, one medium, one rich, reused by role — is fixed.)

## Rendering architecture

Pure CSS at runtime, **zero JS** for the decorative chrome, themeable, driven by the corpus.

1. **Build-time SVG generator** — a new module `app/build_embroidery.mjs` (invoked from
   `build.mjs`) imports the curated units and, for each motif token, emits a **tileable
   SVG** (one `<rect>` per stitch cell; unit-sized; `shape-rendering: crispEdges`) in
   **two palettes**:
   - light: `.`→`#f4f1e8` cream, `R`→`#b4232a` red, else→`#1a1a1a` black
   - dark: `.`→`#191c16` paper, `R`→`#d8aa54` catkin, else→`#e9e5d8` light thread
2. **Output:** a generated stylesheet `app/public/embroidery.css` containing:
   - utility classes (`.emb-band-a`, `.emb-band-b`, `.emb-band-c`, vertical `.emb-spine-b`)
     with `background-image` = the light data-URI SVG, `background-repeat: repeat-x`
     (or `repeat-y` for spines), fixed `background-size` (band height), `aria-hidden`
     decorative elements.
   - a `:root[data-theme="dark"] { ... }` block overriding each `background-image` with
     the dark (gold) data-URI variant. (Dark-mode is class-on-`<html>`, already wired.)
3. **Wiring:** every HTML surface links `<link rel="stylesheet" href="/embroidery.css">`
   after `styles.css`. Band/frame **markup** (empty `aria-hidden` divs) and class
   application live in the hand-written templates/CSS (see Surfaces). The generated file
   only carries the pattern pixels; layout/placement stays in `styles.css`.

Rationale vs alternatives: build-time SVG keeps runtime free and reuses the authentic
source; static hand-exported SVGs aren't corpus-driven; a client canvas/web-component
adds needless JS to decorative chrome and breaks no-JS rendering.

## Surfaces, by phase

**Phase 1 — Foundation + core chrome** (the system + biggest signal)
- `build_embroidery.mjs` + generated `embroidery.css` (the engine).
- **Header band** (token A) — full-bleed strip directly under `.topbar`.
- **Section dividers** (token B) — replace the plain `--rule` lines at `.masthead`
  bottom, section headings, and `.colophon` top.
- **Footer band** (token A) — full-bleed strip in `.colophon`.
- Dark-theme variants working across all three.

**Phase 2 — Card surfaces**
- **Hero frame** (token C top/bottom + token B side-bands) — wrap the featured/daily
  proverb like рушник cloth; ties the hero to the share cards. *Tunable density:* default
  to a moderate band height so it does not overpower the proverb; top/bottom-only is the
  fallback if side-bands crowd at narrow widths.
- **Grid entries** (`.entry`, token B vertical spine) — a thin red spine per row.
- **Swipe-deck cards** (`.sw-card`, token C top/bottom bands) — mirror the share cards.

**Phase 3 — Flourishes**
- **Page-edge framing** — subtle vertical embroidery margins on wide (≥ ~1100px) screens
  framing the content column; hidden on mobile.
- **404 / empty-search states** — a band + centered motif.
- **About / blog** pages — header band + dividers consistent with Phase 1.

## Behavior & constraints

- **Decorative only:** all band/frame elements are `aria-hidden="true"`, contain no text,
  and are never the sole carrier of meaning. Content contrast (ink-on-cream / light-on-dark)
  is unchanged.
- **Static on the site:** no animation in site chrome (the drift animation stays on the
  cards). Nothing depends on `prefers-reduced-motion`, but we honor it by being static.
- **Responsive:** band heights scale down on mobile (smaller `background-size`); page-edge
  framing (Phase 3) is desktop-only. Bands are `overflow: hidden` so partial tiles clip
  cleanly at any width.
- **Performance:** data-URI SVGs are tiny (a few hundred bytes each), cached with the CSS,
  no extra requests, no layout shift (fixed band heights reserved).
- **Cards untouched:** this is site chrome only. `card.ts` / `card-gif.ts` are not changed.

## Files

- **New:** `app/build_embroidery.mjs` (generator), `app/public/embroidery.css` (generated and
  **committed as a build artifact**, the same way `public/app.js` / `public/chrome.js` are
  tracked in this repo).
- **Changed:** `app/build.mjs` (invoke generator), `app/public/styles.css` (band/frame
  layout + placement classes + dark overrides for layout), `app/public/index.html`,
  `app/src/shared/meta.ts` (`/p` pages), `app/public/about.html`, blog templates,
  `app/src/client/main.ts` (bands on JS-rendered hero / entries / swipe deck).
- **Reused:** `app/src/shader/embroidery.ts` (`BORDERS` unit data) — imported by the generator.

## Testing

- Unit-test the generator (`app/build_embroidery.mjs`): for each token it emits valid SVG,
  both palettes, correct dimensions, and only the expected colors (light: cream/red/black;
  dark: paper/gold/thread).
- Snapshot/assert `embroidery.css` contains the four classes + a `[data-theme="dark"]`
  override block.
- Manual visual verification per phase (render the page locally; the existing
  PNG-extraction workflow for screenshots).

## Out of scope (YAGNI)

- No per-page or per-category unique motifs (one consistent system).
- No animated site chrome.
- No user-configurable embroidery.
- No changes to the share cards.

## Phasing / sequencing

Build Phase 1 first (engine + header/divider/footer + dark mode) — establishes the system
and the strongest visual signal — verify, then Phase 2 (hero/grid/swipe), then Phase 3
(flourishes). Each phase ships independently.
