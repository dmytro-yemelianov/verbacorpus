# Embroidery Site — Phase 1 (Foundation + Core Chrome) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render authentic UPA рушник embroidery as themeable CSS bands in the site chrome — a header band under the nav, section dividers, and a footer band — generated from the same pattern corpus the cards use.

**Architecture:** A pure TS generator turns curated UPA pattern units into tileable SVG data-URIs in two palettes (light red/black, dark gold) and emits a generated `public/embroidery.css` exposing them as CSS custom properties (`--emb-a/b/c`), with `[data-theme="dark"]` + `prefers-color-scheme` overrides. Hand-written `styles.css` places the bands via pseudo-elements on existing chrome elements. Zero runtime JS.

**Tech Stack:** TypeScript, esbuild (build), vitest (`@cloudflare/vitest-pool-workers`), plain CSS.

## Global Constraints

- Decorative chrome only — bands carry no text, add no `aria`, never alter content contrast. Cards (`card.ts`/`card-gif.ts`) are NOT touched.
- Reuse the existing `BORDERS` units in `app/src/shader/embroidery.ts`; do not redraw patterns.
- Light palette: linen `#f4f1e8`, red `#b4232a`, black `#1a1a1a`. Dark palette: paper `#191c16`, catkin gold `#d8aa54`, light thread `#e9e5d8` (these exact hex values match the existing dark-theme tokens in `styles.css`).
- Motif tokens (by role): **A** = `upa_2c1afca8547010f7` (chevron, header/footer), **B** = `upa_a83394df6ae60276` (crosses/rings, dividers), **C** = `upa_6cdef2752bd9b5fb` (roses, hero — generated now, used in Phase 2).
- All paths relative to `app/`. Generated `public/embroidery.css` is committed (as `public/app.js` is).

---

### Task 1: SVG band generator

**Files:**
- Create: `app/src/embroidery-css.ts`
- Test: `app/test/embroidery-css.test.ts`

**Interfaces:**
- Consumes: `BORDERS`, `Border` from `./shader/embroidery`.
- Produces: `bandSVG(b: Border, light: boolean): string` (a `data:image/svg+xml,...` URI), `embroideryCss(): string` (full stylesheet text).

- [ ] **Step 1: Write the failing test**

```ts
// app/test/embroidery-css.test.ts
import { describe, it, expect } from "vitest";
import { BORDERS } from "../src/shader/embroidery";
import { bandSVG, embroideryCss } from "../src/embroidery-css";

const A = BORDERS.find((b) => b.id === "upa_2c1afca8547010f7")!;

describe("embroidery-css generator", () => {
  it("bandSVG emits a data-URI SVG sized to the unit, with the light palette", () => {
    const uri = bandSVG(A, true);
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    const svg = decodeURIComponent(uri.slice("data:image/svg+xml,".length));
    expect(svg).toContain(`width='${A.cols * 8}'`);
    expect(svg).toContain(`height='${A.rows * 8}'`);
    expect(svg).toContain("fill='#f4f1e8'"); // linen background rect
    expect(svg).toContain("fill='#b4232a'"); // at least one red stitch
    expect(svg).not.toContain("#d8aa54");    // no dark-palette colour
  });

  it("bandSVG dark palette swaps red->gold, linen->dark paper", () => {
    const svg = decodeURIComponent(bandSVG(A, false).slice("data:image/svg+xml,".length));
    expect(svg).toContain("fill='#191c16'"); // dark paper background
    expect(svg).toContain("fill='#d8aa54'"); // gold
    expect(svg).not.toContain("#b4232a");    // no light red
  });

  it("embroideryCss defines --emb-a/b/c and a dark override + media query", () => {
    const css = embroideryCss();
    for (const v of ["--emb-a", "--emb-b", "--emb-c"]) expect(css).toContain(v);
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("prefers-color-scheme: dark");
    // dark block carries gold, light :root carries red
    expect(css).toContain("%23d8aa54"); // gold, URL-encoded inside the data-URI
    expect(css).toContain("%23b4232a"); // red, URL-encoded
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run test/embroidery-css.test.ts`
Expected: FAIL — cannot find module `../src/embroidery-css`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/embroidery-css.ts
import { BORDERS, type Border } from "./shader/embroidery";

const LIGHT = { bg: "#f4f1e8", red: "#b4232a", ink: "#1a1a1a" };
const DARK = { bg: "#191c16", red: "#d8aa54", ink: "#e9e5d8" };
const CELL = 8; // px per stitch in the intrinsic SVG (background-size scales it)

// One tileable band as an SVG data-URI: a background rect (linen/paper) plus one
// <rect> per non-empty stitch. encodeURIComponent keeps it valid inside CSS url().
export function bandSVG(b: Border, light: boolean): string {
  const p = light ? LIGHT : DARK;
  const W = b.cols * CELL, H = b.rows * CELL;
  let rects = "";
  for (let r = 0; r < b.rows; r++) {
    const row = b.cells[r];
    for (let c = 0; c < b.cols; c++) {
      const ch = row[c];
      if (ch === ".") continue; // linen = background
      const fill = ch === "R" ? p.red : p.ink;
      rects += `<rect x='${c * CELL}' y='${r * CELL}' width='${CELL}' height='${CELL}' fill='${fill}'/>`;
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' shape-rendering='crispEdges'><rect width='${W}' height='${H}' fill='${p.bg}'/>${rects}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const TOKENS: Record<"a" | "b" | "c", string> = {
  a: "upa_2c1afca8547010f7",
  b: "upa_a83394df6ae60276",
  c: "upa_6cdef2752bd9b5fb",
};

function byId(id: string): Border {
  const b = BORDERS.find((x) => x.id === id);
  if (!b) throw new Error(`embroidery token not found: ${id}`);
  return b;
}

// Full generated stylesheet: --emb-a/b/c on :root (light), overridden for dark
// (manual [data-theme="dark"] and auto prefers-color-scheme, mirroring styles.css).
export function embroideryCss(): string {
  const block = (light: boolean) =>
    (Object.keys(TOKENS) as Array<keyof typeof TOKENS>)
      .map((k) => `  --emb-${k}: url("${bandSVG(byId(TOKENS[k]), light)}");`)
      .join("\n");
  const dark = block(false);
  return `/* GENERATED by build_embroidery (see src/embroidery-css.ts) — do not edit. */
:root {
${block(true)}
}
:root[data-theme="dark"] {
${dark}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${dark}
  }
}
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run test/embroidery-css.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd app && git add src/embroidery-css.ts test/embroidery-css.test.ts
git commit -m "feat(embroidery): SVG band generator (themeable data-URIs from UPA motifs)"
```

---

### Task 2: Generate `embroidery.css` in the build and import it

**Files:**
- Modify: `app/build.mjs` (after the two `build(...)` calls, before the final `console.log`)
- Create (generated, committed): `app/public/embroidery.css`
- Modify: `app/public/styles.css:1` (add `@import` directly after the top comment block, before `:root`)

**Interfaces:**
- Consumes: `embroideryCss()` from Task 1.
- Produces: `public/embroidery.css` defining `--emb-a/b/c`; `styles.css` importing it.

- [ ] **Step 1: Add the generator step to `build.mjs`**

Add this import at the top of `app/build.mjs` (with the other imports):

```js
import { writeFile } from "node:fs/promises";
```

Insert before the final `console.log(...)` in `app/build.mjs`:

```js
// Generate embroidery.css (themeable рушник bands) from the UPA motif corpus.
// Bundle the TS generator in-memory, import it as a data: URL, write its output.
const embRes = await build({
  entryPoints: ["src/embroidery-css.ts"],
  bundle: true, format: "esm", write: false, sourcemap: false,
});
const embMod = await import(
  "data:text/javascript;base64," + Buffer.from(embRes.outputFiles[0].text).toString("base64")
);
await writeFile("public/embroidery.css", embMod.embroideryCss());
console.log("Built public/embroidery.css");
```

- [ ] **Step 2: Run the build and confirm the file is generated**

Run: `cd app && node build.mjs`
Expected output includes: `Built public/embroidery.css`

Run: `cd app && grep -c -- "--emb-a" public/embroidery.css`
Expected: `2` (light `:root` + the dark `[data-theme]` block; the media-query block reuses the same text, so grep counts ≥ 2 — accept `>= 2`).

- [ ] **Step 3: Import the generated CSS from `styles.css`**

In `app/public/styles.css`, immediately AFTER the opening comment block (the `/* verba … */` comment that ends on the line before `:root {`) and BEFORE `:root {`, add:

```css
@import url("/embroidery.css");
```

(`@import` must precede all style rules; the leading comment is allowed before it.)

- [ ] **Step 4: Verify the import resolves**

Run: `cd app && head -8 public/styles.css | grep -n "@import"`
Expected: prints the `@import url("/embroidery.css");` line.

- [ ] **Step 5: Commit**

```bash
cd app && git add build.mjs public/embroidery.css public/styles.css
git commit -m "build(embroidery): generate public/embroidery.css and @import it"
```

---

### Task 3: Place рушник bands on the site chrome (header, divider, footer)

**Files:**
- Modify: `app/public/styles.css` — the `.topbar` rule (around line 323, remove its `border-bottom`), the `.masthead` rule (line 40, remove its `border-bottom`), the `.colophon` rule (line 257, remove its `border-top`); append a new "Embroidery chrome" block at the end of the file.

**Interfaces:**
- Consumes: `--emb-a` (header/footer), `--emb-b` (divider) from `embroidery.css` (Task 2).
- Produces: visible bands; no exported symbols.

- [ ] **Step 1: Drop the plain rule borders these bands replace**

In `app/public/styles.css`:
- `.topbar { … border-bottom: 1px solid var(--rule); … }` → change that declaration to `border-bottom: 0;`
- `.masthead { border-bottom: 1px solid var(--rule); … }` → `border-bottom: 0;`
- `.colophon { border-top: 1px solid var(--rule); … }` → `border-top: 0;`

- [ ] **Step 2: Append the embroidery-chrome block at the END of `styles.css`**

```css
/* ---- Embroidery chrome (рушник bands; pixels in embroidery.css) ---- */
/* All decorative: empty pseudo-elements are ignored by assistive tech. */
.topbar::after {
  content: ""; display: block; height: 22px;
  background: var(--emb-a) repeat-x left center / auto 100%;
}
.masthead::after {
  content: ""; display: block; height: 14px;
  margin-top: clamp(1rem, 3vw, 1.6rem);
  background: var(--emb-b) repeat-x left center / auto 100%;
}
.colophon::before {
  content: ""; display: block; height: 14px;
  margin-bottom: clamp(1.2rem, 3vw, 2rem);
  background: var(--emb-b) repeat-x left center / auto 100%;
}
.colophon::after {
  content: ""; display: block; height: 22px;
  margin-top: clamp(1.2rem, 3vw, 2rem);
  background: var(--emb-a) repeat-x left center / auto 100%;
}
@media (max-width: 640px) {
  .topbar::after, .colophon::after { height: 16px; }
  .masthead::after, .colophon::before { height: 11px; }
}
```

- [ ] **Step 3: Build and serve locally**

Run: `cd app && node build.mjs && npx wrangler dev --port 8799 --local`
Wait for `Ready on http://localhost:8799`.

- [ ] **Step 4: Visually verify light + dark**

Using the chrome-devtools MCP (or claude-in-chrome): `navigate_page` to `http://localhost:8799/`, `take_screenshot`. Confirm:
- a red/black chevron band sits directly under the top nav,
- a crosses/rings divider band under the masthead,
- a divider band + chevron footer band at the colophon.
Then set dark mode — in the page console run `document.documentElement.setAttribute('data-theme','dark')` — screenshot again and confirm every band switches to **gold on dark paper**.

Fallback if browser screenshot is unavailable in this env: rasterize the generated band to confirm the motif by extracting one `--emb-a` data-URI from `public/embroidery.css`, URL-decoding it, and converting the SVG to PNG (e.g. `rsvg-convert`/`cairosvg` if present) to eyeball; otherwise hand off the localhost URL to the user for a visual check before committing.

- [ ] **Step 5: Run the full test suite (no regressions) and commit**

Run: `cd app && npx vitest run`
Expected: all tests PASS.

```bash
cd app && git add public/styles.css
git commit -m "feat(embroidery): рушник header band, section divider, and footer band"
```

---

## Self-Review

- **Spec coverage (Phase 1 scope):** generator (Task 1) ✓; build-time generation + themeable output + wiring (Task 2) ✓; header band, section dividers, footer band, dark mode (Task 3) ✓. Hero/grid/swipe = Phase 2; page-edge/404/about-blog = Phase 3 (separate plans). ✓
- **Placeholders:** none — all code and commands are concrete. The Task 3 fallback names real tools, not "handle later". ✓
- **Type consistency:** `bandSVG(b: Border, light: boolean)` and `embroideryCss()` are used identically in the test, the generator, and `build.mjs` (`embMod.embroideryCss()`). Token ids match the spec table. ✓
- **Dark values:** `#191c16` / `#d8aa54` / `#e9e5d8` match the existing `styles.css` dark tokens — verified against lines 303/310. ✓
