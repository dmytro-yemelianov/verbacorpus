# verba — SP14: Short links + QR cards + card-first page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Numeric short links (`/s/126` → `/p/p000126`), a QR of the short link printed on the social card, and a card-first `/p/:id` page.

**Architecture:** All in the existing Worker — no new infrastructure. The proverb number IS the short code (deterministic, no storage). A small bundled pure-JS QR encoder produces an SVG, embedded in the satori card as a `data:` `<img>`. `buildProverbPage` is restructured to lead with the card image and carries the shared top nav.

**Tech Stack:** TypeScript + Cloudflare Workers + workers-og/satori + esbuild + vitest. One new build-time dep: `qrcode-generator` (pure JS, MIT, bundled — not runtime infra).

## Global Constraints

- Short link form: `https://<host>/s/<n>`, `<n>` = proverb number, leading zeros stripped (`p000126`→`126`). `/s/<n>` → **301** → `/p/p000126`; invalid/out-of-range → **404**.
- **No corpus data change → no VERSION bump** (VERSION stays 1.0.2). This is an app/site feature; deploy is just `wrangler deploy` (outward — confirm with user) + bump the SW cache.
- `shortlink.ts`/`qr.ts` are pure + Worker-side only (must NOT bloat the client `app.js` — keep them out of the client import graph; esbuild tree-shakes named imports, so don't import `cardModel`/qr into `main.ts`).
- QR encodes the short link; the printed footer link must match it. Quiet zone + ~130px + EC level M for scannability.
- Reuse the existing `.topbar` markup + `/chrome.js` (built in the nav fix) for the `/p` page nav. i18n: any new catalog key goes into all 10 catalogs (the i18n-complete test enforces parity).
- origin = dmytro-yemelianov. Branch `feat/shortlinks`. Commit identity MurzikVasilyevich; session footer.
- **Task types:** `[IMPL]` TDD · `[CONTROLLER-RUN]` (deploy).

---

### Task 1 [IMPL]: `shortlink.ts` — code ⇄ id helpers

**Files:** Create `app/src/shared/shortlink.ts`, `app/test/shortlink.test.ts`.

**Interfaces — Produces:** `toShort(id: string) -> string`, `fromShort(code: string, count: number) -> string | null`, `shortUrl(id: string, host: string) -> string`.

- [ ] **Step 1: Write the failing test** — `app/test/shortlink.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { toShort, fromShort, shortUrl } from "../src/shared/shortlink";

describe("toShort", () => {
  it("strips the p + leading zeros", () => { expect(toShort("p000126")).toBe("126"); expect(toShort("p000001")).toBe("1"); expect(toShort("p048787")).toBe("48787"); });
});
describe("fromShort", () => {
  const N = 48787;
  it("pads back to the id", () => { expect(fromShort("126", N)).toBe("p000126"); expect(fromShort("1", N)).toBe("p000001"); expect(fromShort("48787", N)).toBe("p048787"); });
  it("rejects junk / out-of-range / leading-zero aliases", () => {
    expect(fromShort("0", N)).toBeNull();
    expect(fromShort("abc", N)).toBeNull();
    expect(fromShort("p1", N)).toBeNull();
    expect(fromShort("01", N)).toBeNull();   // no leading-zero aliases
    expect(fromShort("48788", N)).toBeNull(); // out of range
    expect(fromShort("", N)).toBeNull();
  });
});
describe("shortUrl", () => {
  it("builds the absolute short link", () => expect(shortUrl("p000126", "verbacorpus.org")).toBe("https://verbacorpus.org/s/126"));
});
```

- [ ] **Step 2: Run, verify fail** — from `app/`: `npx vitest run test/shortlink.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `app/src/shared/shortlink.ts`:
```typescript
const ID_RE = /^p(\d+)$/;

export function toShort(id: string): string {
  const m = id.match(ID_RE);
  return m ? String(parseInt(m[1], 10)) : id;
}

export function fromShort(code: string, count: number): string | null {
  if (!/^[1-9]\d*$/.test(code)) return null; // digits, no leading zero, not "0"
  const n = parseInt(code, 10);
  if (n < 1 || n > count) return null;
  return "p" + String(n).padStart(6, "0");
}

export function shortUrl(id: string, host: string): string {
  return `https://${host}/s/${toShort(id)}`;
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run test/shortlink.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/shared/shortlink.ts app/test/shortlink.test.ts
git commit -m "feat(shortlink): numeric short-code <-> id helpers"
```

---

### Task 2 [IMPL]: `qr.ts` — QR encoder → SVG

**Files:** Create `app/src/shared/qr.ts`, `app/test/qr.test.ts`; modify `app/package.json` (add dep).

**Interfaces — Produces:** `qrMatrix(text: string) -> boolean[][]`, `qrSvg(text: string, opts?: { module?: number; margin?: number; dark?: string; light?: string }) -> string`, `qrDataUri(text: string, opts?) -> string`.

- [ ] **Step 1: Add the dep** — from `app/`: `npm install qrcode-generator@^1.4.4` (pure JS, MIT, zero runtime deps; bundles into the Worker). Verify it imports in the Workers/vitest pool.

- [ ] **Step 2: Write the failing test** — `app/test/qr.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { qrMatrix, qrSvg, qrDataUri } from "../src/shared/qr";

describe("qrMatrix", () => {
  const m = qrMatrix("https://verbacorpus.org/s/126");
  it("is a square boolean matrix of QR size", () => {
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    expect(typeof m[0][0]).toBe("boolean");
  });
  it("has the top-left finder pattern (7x7 dark border)", () => {
    for (let i = 0; i < 7; i++) { expect(m[0][i]).toBe(true); expect(m[i][0]).toBe(true); }
    expect(m[1][1]).toBe(false); // finder inner ring
  });
  it("is deterministic", () => expect(qrMatrix("X")).toEqual(qrMatrix("X")));
});
describe("qrSvg / qrDataUri", () => {
  it("emits an svg with rects + size", () => {
    const s = qrSvg("https://verbacorpus.org/s/126", { module: 4, margin: 4 });
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).toContain("<rect");
    expect(s).toContain("viewBox");
  });
  it("data uri is base64 svg", () => expect(qrDataUri("X").startsWith("data:image/svg+xml;base64,")).toBe(true));
});
```

- [ ] **Step 3: Run, verify fail** — `npx vitest run test/qr.test.ts` → FAIL.

- [ ] **Step 4: Implement** — `app/src/shared/qr.ts` (wrap `qrcode-generator`; build the SVG ourselves so it's a single `<rect>`-per-module grid we control):
```typescript
import qrcode from "qrcode-generator";

function make(text: string) {
  const qr = qrcode(0, "M"); // type 0 = auto-fit, error-correction level M
  qr.addData(text);
  qr.make();
  return qr;
}

export function qrMatrix(text: string): boolean[][] {
  const qr = make(text);
  const n = qr.getModuleCount();
  const out: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    out.push(row);
  }
  return out;
}

export function qrSvg(text: string, opts: { module?: number; margin?: number; dark?: string; light?: string } = {}): string {
  const module = opts.module ?? 4, margin = opts.margin ?? 4;
  const dark = opts.dark ?? "#232520", light = opts.light ?? "#ffffff";
  const m = qrMatrix(text);
  const n = m.length;
  const dim = (n + margin * 2) * module;
  let rects = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) {
    const x = (c + margin) * module, y = (r + margin) * module;
    rects += `<rect x="${x}" y="${y}" width="${module}" height="${module}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/><g fill="${dark}">${rects}</g></svg>`;
}

export function qrDataUri(text: string, opts?: Parameters<typeof qrSvg>[1]): string {
  // QR SVG is ASCII-only, so btoa is safe (available in the Workers runtime + vitest pool)
  return "data:image/svg+xml;base64," + btoa(qrSvg(text, opts));
}
```

- [ ] **Step 5: Run, verify pass** — `npx vitest run test/qr.test.ts` → PASS. Then confirm the Worker bundles it: `npx wrangler deploy --dry-run` → builds (no "cannot resolve qrcode-generator").

- [ ] **Step 6: Commit**
```bash
git add app/src/shared/qr.ts app/test/qr.test.ts app/package.json app/package-lock.json
git commit -m "feat(qr): pure-JS QR encoder -> SVG / data-uri (qrcode-generator)"
```

---

### Task 3 [IMPL]: QR + short link on the social card

**Files:** Modify `app/src/shared/meta.ts` (`cardModel`, `CardModel`), `app/src/card.ts` (`renderCard`), `app/src/index.ts` (card callers pass host).

**Interfaces:** Consumes `shortlink.shortUrl`, `qr.qrDataUri`. `CardModel` gains `qr: string` (data URI) + `shortUrl: string`. `cardModel(p, opts: { host: string; maxLen?: number })`.

- [ ] **Step 1: Extend `cardModel` + `CardModel`** — in `meta.ts`, change the type to `export type CardModel = { text: string; modern: string; footer: string; qr: string; shortUrl: string };` and the signature to `cardModel(p, opts: { host: string; maxLen?: number })`. Build the short link + QR; put the short link in the footer (replacing the bare `verbacorpus.org`):
```typescript
import { shortUrl } from "./shortlink";
import { qrDataUri } from "./qr";
// inside cardModel(p, opts):
const su = shortUrl(p.id, opts.host);                       // https://verbacorpus.org/s/126
const footer = [...p.sources.map(srcLabel), `№${num(p.id)}`, su.replace(/^https:\/\//, "")].join(" · ");
const qr = qrDataUri(su, { module: 4, margin: 2 });
return { text, modern, footer, qr, shortUrl: su };
```
(Keep the existing `text`/`modern`/`maxLen` logic. `num`, `srcLabel`, `prettify` already imported.)

- [ ] **Step 2: Render the QR in `renderCard`** — in `card.ts`, change the bottom row to a flex row with the footer on the left and the QR image on the right:
```typescript
  const html = `<div style="display:flex;flex-direction:column;width:1200px;height:630px;background:#f4f1e8;padding:72px;font-family:'PT Serif';">
  <div style="display:flex;width:96px;height:8px;background:#5e7355;"></div>
  <div style="display:flex;flex-direction:column;flex:1;justify-content:center;">
    <div style="font-size:62px;color:#232520;line-height:1.18;display:flex;">${e(m.text)}</div>
    ${modern}
  </div>
  <div style="display:flex;align-items:flex-end;justify-content:space-between;">
    <div style="display:flex;font-size:26px;color:#6f6a5c;max-width:880px;">${e(m.footer)}</div>
    <img src="${m.qr}" width="132" height="132" style="display:flex;" />
  </div>
</div>`;
```
(workers-og/satori renders the `data:image/svg+xml` `<img>`; `width`/`height` are required on the img.)

- [ ] **Step 3: Pass host from the card routes** — in `index.ts`, the `/card/:id.png`, `/card/daily.png`, and any other `cardModel(...)` call sites pass `{ host: url.host }` (e.g. `renderCard(cardModel(p, { host: url.host }))`). The daily-card pick likewise.

- [ ] **Step 4: Update the existing card test** — `app/test/meta.test.ts` `cardModel` test now must pass `{ host: "verbacorpus.org" }`; assert `m.footer` ends with `verbacorpus.org/s/<n>`, `m.shortUrl === "https://verbacorpus.org/s/<n>"`, and `m.qr.startsWith("data:image/svg+xml;base64,")`. Update the footer-string expectation accordingly.

- [ ] **Step 5: Build + verify** — from `app/`: `node build.mjs` clean; `npx vitest run` green; `npx wrangler deploy --dry-run` builds. (The card PNG itself is verified on the preview in Task 6.)

- [ ] **Step 6: Commit**
```bash
git add app/src/shared/meta.ts app/src/card.ts app/src/index.ts app/test/meta.test.ts
git commit -m "feat(cards): QR of the short link + printed short URL on the social card"
```

---

### Task 4 [IMPL]: `/s/:n` short-link route

**Files:** Modify `app/src/index.ts`, `app/wrangler.jsonc`; Test: `app/test/shortlink-worker.test.ts`.

**Interfaces:** Consumes `shortlink.fromShort`. Uses the loaded corpus `meta.count` (or `byId`) to validate.

- [ ] **Step 1: Add the route** — in `index.ts` `fetch`, near the top (after `parseLang` / before the `/p`-`/card` block), handle `/s/<n>`:
```typescript
      const sMatch = rest.match(/^\/s\/(.+)$/);
      if (sMatch) {
        const { meta } = await load(env);                 // meta.count, byId already cached
        const id = fromShort(sMatch[1], meta.count);
        if (!id) return new Response("Not found", { status: 404 });
        return Response.redirect(`https://${url.host}/p/${id}`, 301);
      }
```
(Import `fromShort` from `./shared/shortlink`. `load(env)` is the existing cached loader.)

- [ ] **Step 2: `run_worker_first`** — in `wrangler.jsonc`, add `/s/*` to the array (so `/s/126` reaches the Worker; assets still bypass).

- [ ] **Step 3: Test** — `app/test/shortlink-worker.test.ts` (mirror the existing worker tests' env/mocking): `/s/126` → 301 with `Location` ending `/p/p000126`; `/s/0`, `/s/abc`, `/s/<count+1>` → 404; confirm `/styles.css` and `/api/v1/meta` are unaffected.

- [ ] **Step 4: Run + verify** — `npx vitest run` green; `npx wrangler deploy --dry-run` builds.

- [ ] **Step 5: Commit**
```bash
git add app/src/index.ts app/wrangler.jsonc app/test/shortlink-worker.test.ts
git commit -m "feat(shortlink): /s/<n> route -> 301 /p/p000126 (+ run_worker_first)"
```

---

### Task 5 [IMPL]: card-first `/p/:id` page + top nav + share-uses-short-link

**Files:** Modify `app/src/shared/meta.ts` (`buildProverbPage`), `app/src/client/main.ts` (share), `app/public/i18n/*.json` (one key ×10), `app/public/styles.css` (card-hero styles).

- [ ] **Step 1: Restructure `buildProverbPage` card-first** — read the current function, then change the `<body>` to: (a) the shared `.topbar` nav (copy the markup from `app/public/about.html`'s topbar, with `data-i18n="nav.about"`/`nav.api`, `#langSwitch`, `#themeToggle`); (b) a **card-image hero** `<img class="p-card" src="/card/${e(p.id)}.png" alt="${e(prettify(p.text))}" width="1200" height="630" />`; (c) the existing content below (modern text, the SP13 source citations, explanation, variants); (d) a **share row** with a copy-short-link button + a "download card" link (`/card/${e(p.id)}.png`) + the browse/API links. Add the theme-init inline `<script>` (copy from about.html) in `<head>` and `<script type="module" src="/chrome.js"></script>` before `</body>` so the nav works. Keep the head OG/canonical/hreflang as-is (OG image stays the card). Pass the short link in for display: compute `shortUrl(p.id, host)` and render it (a `<code>`/copy target) in the share row.
```html
<!-- share row (chrome i18n'd; the link itself is data) -->
<div class="p-share">
  <button id="copyLink" type="button" data-link="${e(shortUrl(p.id, host))}" data-i18n="detail.copyLink">Скопіювати посилання</button>
  <a href="/card/${e(p.id)}.png" target="_blank" rel="noopener" data-i18n="detail.card">Картка</a>
</div>
```
  and a tiny inline handler (or in chrome.js) for `#copyLink`: `navigator.clipboard.writeText(btn.dataset.link)`. (Add the copy handler to `chrome.ts` so it works on the static-rendered `/p` page: if `#copyLink` exists, wire `click → navigator.clipboard.writeText(dataset.link)` + a brief "✓" text swap.)

- [ ] **Step 2: Add the `detail.copyLink` key to all 10 catalogs** — `uk` "Скопіювати посилання", `en` "Copy link", `de` "Link kopieren", `fr` "Copier le lien", `es` "Copiar enlace", `pl` "Kopiuj link", `it` "Copia link", `pt` "Copiar link", `ja` "リンクをコピー", `zh` "复制链接". Keep key sets identical (i18n-complete test).

- [ ] **Step 3: Card-hero styles** — in `styles.css`: `.p-card { display:block; width:100%; max-width:640px; height:auto; border:1px solid var(--rule); border-radius:8px; margin:0 0 1.4rem; }` and `.p-share { display:flex; gap:1rem; align-items:center; margin:1.4rem 0; font-family:var(--sans); font-size:.85rem; }` (theme vars).

- [ ] **Step 4: Client share uses the short link** — in `main.ts` `share(p)`, replace `const url = \`${location.origin}/p/${p.id}\`;` with the short link: `const url = \`${location.origin}/s/${p.id.replace(/^p0*/, "")}\`;` (or import `shortUrl` from `../shared/shortlink` and use `shortUrl(p.id, location.host)`). The native-share + clipboard fallback both use it.

- [ ] **Step 5: `chrome.ts` copy handler** — add to `chrome.ts` (so `/p` static pages get it): after `renderLangSwitch`, wire `#copyLink` if present:
```typescript
const copyBtn = document.getElementById("copyLink") as HTMLButtonElement | null;
if (copyBtn) copyBtn.addEventListener("click", () => {
  const link = copyBtn.dataset.link || location.href;
  navigator.clipboard?.writeText(link);
  const prev = copyBtn.textContent; copyBtn.textContent = "✓";
  setTimeout(() => { copyBtn.textContent = prev; }, 1200);
});
```
  (call it from the same auto-run path as `renderLangSwitch`).

- [ ] **Step 6: Build + verify** — `node build.mjs` clean; `npx vitest run` green (incl i18n-complete — keep catalogs in sync); update the `buildProverbPage` test in `meta.test.ts` if it asserts structure (now contains `<img class="p-card" src="/card/`); `npx wrangler deploy --dry-run` builds.

- [ ] **Step 7: Commit**
```bash
git add app/src/shared/meta.ts app/src/client/main.ts app/src/client/chrome.ts app/public/i18n/*.json app/public/styles.css app/test/meta.test.ts
git commit -m "feat(p): card-first proverb page + top nav + share-uses-short-link"
```

---

### Task 6 [CONTROLLER-RUN]: preview, verify (scan the QR), deploy

Controller-run. Deploy is **outward — confirm with user**.

- [ ] **Step 1: Preview** — `node build.mjs`; bump `sw.js` cache; `npx wrangler versions upload`.
- [ ] **Step 2: Verify on the preview** — `/s/126` → 301 → `/p/p000126`; `/s/0` → 404; the `/card/p000126.png` renders **with a QR** (fetch the PNG, confirm it's a valid image; **scan it with a phone** → lands on `/s/126` → the proverb); the `/p/p000126` page is **card-first** (card image hero) + has the top nav + the copy-link button copies `…/s/126`; the daily card QR works; existing pages unaffected.
- [ ] **Step 3: Deploy** (confirm with user) — `npx wrangler deploy`; smoke the same on verbacorpus.org. Merge `feat/shortlinks` → main; push origin; update memory.

---

## Self-Review

**1. Spec coverage:** §2 short-link scheme → T1 (helpers) + T4 (route + run_worker_first). §3 QR on card → T2 (encoder) + T3 (card render). §4 card-first page → T5. §5 share → T5 (client + chrome copy). §6 components → T1–T5. §7 testing (shortlink encode/decode/redirect, qr matrix/svg, card has QR, card-first /p, invalid→404) → T1–T5 tests + T6 manual scan. §8 deploy (no version bump) → T6. §9 risks (QR-in-satori verified T2 dry-run + T6 scan; scannability T6; SEO via canonical kept in T5; i18n parity T5) covered.

**2. Placeholder scan:** complete code for shortlink.ts, qr.ts, the card render block, the /s route, the share + copy handler. T5's buildProverbPage restructure references concrete markup (the about.html topbar + the card-hero img + the share row) — the implementer reads the current function and applies the shown structure; not a stub. No TBD/vague-error steps.

**3. Type/name consistency:** `toShort`/`fromShort(code,count)`/`shortUrl(id,host)` defined T1, used in T3 (card), T4 (route), T5 (share). `qrMatrix`/`qrSvg`/`qrDataUri` defined T2, used in T3. `CardModel` gains `qr`+`shortUrl` in T3; `cardModel(p,{host,maxLen?})` — all call sites updated in T3 Step 3. `renderLangSwitch` (existing chrome.ts) + the new `#copyLink` handler both in chrome.ts (T5 Step 5), loaded by `/p` (T5 Step 1) and the static pages. `detail.copyLink` key added ×10 (T5 Step 2).

**Notes for implementers:** keep `shortlink.ts`/`qr.ts` out of the client import graph (Worker-only) so `app.js` stays lean — verify `chrome.js`/`app.js` sizes don't jump after the build. The QR-in-satori path is the main risk: T2's dry-run confirms bundling; T6's phone-scan confirms it renders + scans — if the `data:` `<img>` misbehaves in satori, fall back to rendering the QR as a grid of `<div>`s (one per dark module) in `renderCard`.
