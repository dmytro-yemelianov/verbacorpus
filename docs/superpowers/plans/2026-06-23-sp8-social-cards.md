# Ukrainian Proverbs — SP8: Social-Card Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every proverb shareable — `/p/:id` landing pages with Open Graph/Twitter meta, dynamic `/card/:id.png` share images, a daily card (homepage OG), and a PWA share button.

**Architecture:** A pure `meta.ts` builds the per-proverb HTML/OG page, the card layout model, and the daily-index pick. `card.ts` renders the card PNG with `workers-og` (satori→resvg-wasm) using a bundled Cyrillic TTF. The Worker routes `/p/*` and `/card/*` (added to `run_worker_first`). The PWA detail view gets a share button. Card rendering is verified on a preview deploy (satori+wasm only runs in the Workers runtime, not unit tests); all pure logic is unit-tested.

**Tech Stack:** TypeScript + Cloudflare Workers + `workers-og` + esbuild + vitest (existing `app/` stack).

**Spec:** `docs/superpowers/specs/2026-06-23-sp8-social-cards-design.md`

## Global Constraints

- New routes: `/p/:id` (HTML landing), `/card/:id.png` (1200×630 PNG), `/card/daily.png` (date-deterministic). Add `"/p/*"` and `"/card/*"` to `wrangler.jsonc` `run_worker_first`.
- Per-proverb OG/Twitter meta in the **initial HTML**: `og:title`=text, `og:description`=modern + sources + themes, `og:image`=`https://<host>/card/:id.png` (1200×630), `og:url`=canonical, `twitter:card=summary_large_image`, `lang=uk`. All fields HTML-escaped.
- Card design (editorial): linen `#f4f1e8` bg, willow `#5e7355` accent rule, proverb in serif (the bundled Cyrillic TTF), modern reading (only if it differs), footer = `sources · №<num> · verbacorpus.org`. 1200×630. `Content-Type: image/png`.
- Card caching: `/card/:id.png` → `Cache-Control: public, max-age=31536000, immutable`; `/card/daily.png` → `max-age=86400`. Use the Worker Cache API.
- Daily card: pick from the **presentable** pool (starts with uppercase Cyrillic, 18–90 chars, ≥4 words) by a seed derived from the UTC `YYYY-MM-DD`.
- Card rendering needs an embedded **Cyrillic TTF** — bundle **PT Serif** (`PTSerif-Regular.ttf`, OFL, full Ukrainian Cyrillic) via an esbuild `.ttf` binary loader. (Brand uses Spectral on the site; PT Serif on the card is acceptable and guarantees Ukrainian glyphs.)
- `workers-og` runs only in the Workers runtime → card PNG verified on **preview**, not unit tests. Pure `meta.ts` logic IS unit-tested.
- esbuild loader: add `loader: { ".ttf": "binary" }` to `app/build.mjs`. Commit identity `MurzikVasilyevich`; session footer. Branch `feat/social-cards`. Push: origin via `gh auth switch --user MurzikVasilyevich`; dmytro SSH. Deploy is **outward — confirm with user**.
- **Task types:** `[IMPL]` TDD · `[CONTROLLER-RUN]` controller (preview render-spike, deploy).

---

### Task 1 [IMPL]: `meta.ts` — page/OG builder, card model, daily index (pure)

**Files:** Create `app/src/shared/meta.ts`, `app/test/meta.test.ts`.

**Interfaces:**
- Produces:
  - `escapeHtml(s: string) -> string` (`& < > " '`).
  - `type CardModel = { text: string; modern: string; footer: string }`.
  - `cardModel(p: Proverb & { explanation?: string|null }, opts?: {maxLen?: number}) -> CardModel` — `text` = proverb (truncated to ~160 chars + "…" if longer); `modern` = `modern_text` if it differs from text, else ""; `footer` = `sources.join(" · ") + " · №" + id-without-leading-zeros + " · verbacorpus.org"`. (Raw text — escaping happens at render.)
  - `buildProverbPage(p: Proverb, host: string) -> string` — full HTML doc: head with escaped OG/Twitter meta (`og:title`=text, `og:description`=`modern_text` + " — " + sources + " · " + category-labels, `og:image`=`https://${host}/card/${id}.png`, `og:image:width/height`, `og:url`=`https://${host}/p/${id}`, `og:type=article`, `twitter:card=summary_large_image`, `og:site_name`), links `/fonts/spectral.css` + `/styles.css`, and an editorial body (proverb, modern, source/theme tags, catalog №, an `<img src="/card/:id.png">`, links to `/` and `/api.html`). All interpolations escaped.
  - `dailyIndex(dateStr: string, poolLen: number) -> number` — deterministic hash of `dateStr` mod `poolLen` (0 if poolLen 0).

- [ ] **Step 1: Write the failing test** — `app/test/meta.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { escapeHtml, cardModel, buildProverbPage, dailyIndex } from "../src/shared/meta";
import { type Proverb } from "../src/shared/corpus";

const P: Proverb & { explanation?: string } = {
  id: "p000123", text: "Без труда нема плода", modern_text: "Без труда нема плода",
  category: ["work_labor"], sources: ["Franko1901", "Nomis1864"], variant_group: "",
};

describe("escapeHtml", () => {
  it("escapes the five", () => expect(escapeHtml(`a<b>&"'`)).toBe("a&lt;b&gt;&amp;&quot;&#39;"));
});
describe("cardModel", () => {
  it("omits modern when equal; builds footer", () => {
    const m = cardModel(P);
    expect(m.modern).toBe("");
    expect(m.footer).toBe("Franko1901 · Nomis1864 · №123 · verbacorpus.org");
  });
  it("keeps modern when different; truncates long text", () => {
    const m = cardModel({ ...P, modern_text: "Без труда нема плоду", text: "x".repeat(200) });
    expect(m.modern).toBe("Без труда нема плоду");
    expect(m.text.length).toBeLessThanOrEqual(161);
    expect(m.text.endsWith("…")).toBe(true);
  });
});
describe("buildProverbPage", () => {
  it("emits escaped per-proverb OG meta", () => {
    const html = buildProverbPage({ ...P, text: 'a<b' }, "example.com");
    expect(html).toContain('<meta property="og:title" content="a&lt;b"');
    expect(html).toContain('<meta property="og:image" content="https://example.com/card/p000123.png"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain('https://example.com/p/p000123');
  });
});
describe("dailyIndex", () => {
  it("deterministic + in range", () => {
    expect(dailyIndex("2026-06-23", 100)).toBe(dailyIndex("2026-06-23", 100));
    expect(dailyIndex("2026-06-23", 100)).toBeGreaterThanOrEqual(0);
    expect(dailyIndex("2026-06-23", 100)).toBeLessThan(100);
    expect(dailyIndex("2026-06-24", 100)).not.toBe(dailyIndex("2026-06-23", 100)); // different day
    expect(dailyIndex("x", 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify fail** — from `app/`: `npx vitest run test/meta.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `app/src/shared/meta.ts`:
```typescript
import { type Proverb } from "./corpus";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export type CardModel = { text: string; modern: string; footer: string };

const num = (id: string) => id.replace(/^p0*/, "");

export function cardModel(p: Proverb & { explanation?: string | null }, opts: { maxLen?: number } = {}): CardModel {
  const max = opts.maxLen ?? 160;
  const text = p.text.length > max ? p.text.slice(0, max) + "…" : p.text;
  const modern = p.modern_text && p.modern_text.trim() !== p.text.trim() ? p.modern_text : "";
  const footer = [...p.sources, `№${num(p.id)}`, "verbacorpus.org"].join(" · ");
  return { text, modern, footer };
}

export function dailyIndex(dateStr: string, poolLen: number): number {
  if (poolLen <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) { h ^= dateStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % poolLen;
}

export function buildProverbPage(p: Proverb, host: string): string {
  const e = escapeHtml;
  const img = `https://${host}/card/${p.id}.png`;
  const canon = `https://${host}/p/${p.id}`;
  const desc = [p.modern_text, p.sources.join(", "), p.category.join(", ")].filter(Boolean).join(" — ");
  const tags = p.category.map((c) => `<span class="tag">${e(c)}</span>`).join("");
  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(p.text)} — Українські прислів'я</title>
<meta name="description" content="${e(desc)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Українські прислів'я та приказки" />
<meta property="og:title" content="${e(p.text)}" />
<meta property="og:description" content="${e(desc)}" />
<meta property="og:image" content="${img}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="${canon}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${e(p.text)}" />
<meta name="twitter:image" content="${img}" />
<link rel="canonical" href="${canon}" />
<link rel="stylesheet" href="/fonts/spectral.css" />
<link rel="stylesheet" href="/styles.css" />
</head>
<body>
<main class="wrap" style="max-width:760px;padding-block:clamp(2rem,8vw,5rem);">
<p class="eyebrow">Українські прислів'я та приказки</p>
<p class="hero-text" style="margin:0;">${e(p.text)}</p>
${p.modern_text && p.modern_text.trim() !== p.text.trim() ? `<p class="hero-modern">${e(p.modern_text)}</p>` : ""}
<p style="margin-top:1rem;">${tags} <span class="tag-src">${e(p.sources.join(" · "))}</span></p>
<p><img src="/card/${p.id}.png" alt="" style="max-width:100%;height:auto;border:1px solid var(--rule);border-radius:6px;margin-top:1rem;" /></p>
<p style="margin-top:1.5rem;"><a href="/">Переглянути весь корпус</a> · <a href="/api.html">API</a></p>
</main>
</body>
</html>`;
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run test/meta.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add app/src/shared/meta.ts app/test/meta.test.ts
git commit -m "feat(cards): pure page/OG builder + card model + daily index"
```

---

### Task 2 [IMPL]: card renderer (`card.ts`) + bundled Cyrillic font + esbuild loader

**Files:** Create `app/src/card.ts`, `app/src/fonts/PTSerif-Regular.ttf` (fetched); Modify `app/build.mjs`, `app/package.json`.

**Interfaces:**
- Consumes: `CardModel` from `./shared/meta`.
- Produces: `renderCard(m: CardModel) -> Response` — a 1200×630 PNG `ImageResponse` of the editorial card.

- [ ] **Step 1: Add the dependency** — from `app/`: `npm install workers-og`. Confirm it's in `package.json` dependencies.

- [ ] **Step 2: Fetch the Cyrillic TTF** (OFL, full Ukrainian Cyrillic):
```bash
mkdir -p app/src/fonts
curl -sL -o app/src/fonts/PTSerif-Regular.ttf \
  https://raw.githubusercontent.com/google/fonts/main/ofl/ptserif/PTSerif-Regular.ttf
# sanity: should be a real TTF (starts with 0x00010000), > 200KB
ls -l app/src/fonts/PTSerif-Regular.ttf
```

- [ ] **Step 3: Add the esbuild `.ttf` binary loader** — in `app/build.mjs`, add to the `build({...})` options: `loader: { ".ttf": "binary" }` (so `import font from "./fonts/x.ttf"` yields a `Uint8Array`).

- [ ] **Step 4: Implement** — `app/src/card.ts`:
```typescript
import { ImageResponse } from "workers-og";
import ptSerif from "./fonts/PTSerif-Regular.ttf";
import { escapeHtml, type CardModel } from "./shared/meta";

const FONT = (ptSerif as unknown as Uint8Array).buffer as ArrayBuffer;

export function renderCard(m: CardModel): Response {
  const e = escapeHtml;
  const modern = m.modern
    ? `<div style="font-size:34px;font-style:italic;color:#6f6a5c;margin-top:20px;display:flex;">${e(m.modern)}</div>`
    : "";
  // verba willow palette: linen bg #f4f1e8, willow rule #5e7355, ink #232520, muted #6f6a5c
  const html = `<div style="display:flex;flex-direction:column;width:1200px;height:630px;background:#f4f1e8;padding:72px;font-family:'PT Serif';">
  <div style="display:flex;width:96px;height:8px;background:#5e7355;"></div>
  <div style="display:flex;flex-direction:column;flex:1;justify-content:center;">
    <div style="font-size:62px;color:#232520;line-height:1.18;display:flex;">${e(m.text)}</div>
    ${modern}
  </div>
  <div style="display:flex;font-size:26px;color:#6f6a5c;">${e(m.footer)}</div>
</div>`;
  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    fonts: [{ name: "PT Serif", data: FONT, weight: 400, style: "normal" }],
  });
}
```

- [ ] **Step 5: Verify it compiles** — from `app/`: `node build.mjs` → builds `public/app.js` with no esbuild errors (the `.ttf` import resolves via the binary loader; `workers-og` bundles). (Rendering is verified on preview in Task 5 — satori/wasm needs the Workers runtime.)

- [ ] **Step 6: Commit** (the TTF is a committed asset; `app.js` stays gitignored)
```bash
git add app/src/card.ts app/src/fonts/PTSerif-Regular.ttf app/build.mjs app/package.json app/package-lock.json
git commit -m "feat(cards): workers-og PNG renderer + bundled PT Serif (Cyrillic)"
```

---

### Task 3 [IMPL]: Worker routes + run_worker_first + homepage OG

**Files:** Modify `app/src/index.ts`, `app/wrangler.jsonc`, `app/public/index.html`; Create `app/test/cards-api.test.ts`.

**Interfaces:** Consumes `buildProverbPage`, `cardModel`, `dailyIndex` (Task 1), `renderCard` (Task 2). Reuses the module-scope `load(env)` cache + `proverbs`/`byId`.

- [ ] **Step 1: Add routes to `wrangler.jsonc`** — extend `run_worker_first`:
```jsonc
    "run_worker_first": ["/api/*", "/p/*", "/card/*"]
```

- [ ] **Step 2: Write the failing test** — `app/test/cards-api.test.ts`:
```typescript
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

async function call(path: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://example.com" + path), env as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("/p/:id", () => {
  it("serves HTML with per-proverb OG image", async () => {
    const res = await call("/p/p1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('property="og:image"');
    expect(html).toContain("/card/p1.png");
    expect(html).toContain('name="twitter:card"');
  });
  it("404 for unknown id", async () => {
    expect((await call("/p/zzz")).status).toBe(404);
  });
});
```
(Fixture `p1` is in `app/test/fixtures-site/data/proverbs.json`. The `/card/*` PNG routes are NOT unit-tested — satori+resvg-wasm needs the real Workers runtime; they're verified on preview in Task 5.)

- [ ] **Step 3: Run, verify fail** — from `app/`: `npx vitest run test/cards-api.test.ts` → FAIL.

- [ ] **Step 4: Implement** — in `app/src/index.ts`:
  - Add imports: `import { buildProverbPage, cardModel, dailyIndex } from "./shared/meta";` and `import { renderCard } from "./card";`
  - In `fetch`, **before** the existing `if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);` line, handle the new routes (they need the corpus, so load first). Replace the early ASSETS passthrough with:
```typescript
      const raw0 = url.pathname;
      // social-card routes (need the corpus)
      if (raw0.startsWith("/p/") || raw0.startsWith("/card/")) {
        const { proverbs, byId } = await load(env);
        const host = url.host;
        const HTML = (body: string, status = 200) =>
          new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" } });

        const pm = raw0.match(/^\/p\/(.+)$/);
        if (pm) {
          const p = byId.get(decodeURIComponent(pm[1]));
          if (!p) return HTML(`<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><main class="wrap"><p class="empty">Прислів'я не знайдено. <a href="/">На головну</a></p></main></body></html>`, 404);
          return HTML(buildProverbPage(p, host));
        }
        const cm = raw0.match(/^\/card\/(.+)\.png$/);
        if (cm) {
          const key = decodeURIComponent(cm[1]);
          const cacheable = (resp: Response, maxAge: number) => {
            const r = new Response(resp.body, resp);
            r.headers.set("cache-control", `public, max-age=${maxAge}${maxAge > 86400 ? ", immutable" : ""}`);
            r.headers.set("access-control-allow-origin", "*");
            return r;
          };
          if (key === "daily") {
            const pool = proverbs.filter((p) => /^[А-ЯІЇЄҐ]/.test(p.text.trim()) && p.text.trim().length >= 18 && p.text.trim().length <= 90 && p.text.trim().split(/\s+/).length >= 4);
            const pick = pool[dailyIndex(new Date().toISOString().slice(0, 10), pool.length)] ?? proverbs[0];
            return cacheable(renderCard(cardModel(pick)), 86400);
          }
          const p = byId.get(key);
          if (!p) return new Response("not found", { status: 404, headers: { "access-control-allow-origin": "*" } });
          return cacheable(renderCard(cardModel(p)), 31536000);
        }
      }
      if (!raw0.startsWith("/api/")) return env.ASSETS.fetch(request);
```
  (Keep the rest of the `/api/*` handling below, unchanged. Note: the existing code computes `const url = new URL(request.url)` near the top — reuse it; `raw0` = `url.pathname`. Ensure this block sits after `url` is defined and inside the `try`.)

- [ ] **Step 5: Homepage OG** — in `app/public/index.html` `<head>`, add default OG/Twitter meta:
```html
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Українські прислів'я та приказки" />
  <meta property="og:description" content="Корпус 48 787 українських прислів'їв і приказок із пошуком за темою, джерелом і змістом." />
  <meta property="og:image" content="/card/daily.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
```

- [ ] **Step 6: Run, verify pass** — from `app/`: `npx vitest run` → all green (meta + cards-api + the full existing suite). Then `node build.mjs` (compiles with card.ts wired into index.ts).

- [ ] **Step 7: Commit**
```bash
git add app/src/index.ts app/wrangler.jsonc app/public/index.html app/test/cards-api.test.ts
git commit -m "feat(cards): /p/:id pages + /card/:id.png + /card/daily.png + homepage OG"
```

---

### Task 4 [IMPL]: Upgrade the share button to /p/:id + add a card link

**Context:** SP9 already added a `share(p)` helper (`main.ts` ~line 62, using `const url = location.origin;`), a «Поділитися» button in `openDetail` (`<div class="detail-share"><button class="detail-sharebtn">…`), a swipe-card share (`#swShare` → `share(p)`), and `.detail-share`/`.detail-sharebtn` styles. This task UPGRADES them to deep-link to the new `/p/:id` page (which unfurls with the card) and adds a «Картка» link — it does NOT add a share button from scratch or re-declare existing styles.

**Files:** Modify `app/src/client/main.ts`, `app/public/styles.css`.

- [ ] **Step 1: Point share at the proverb page** — in `share(p)`, change `const url = location.origin;` to:
```typescript
  const url = `${location.origin}/p/${p.id}`;
```
  (Both the detail «Поділитися» and the swipe «↗» call `share(p)`, so both now deep-link to `/p/:id` and the clipboard fallback `${p.text} — ${url}` carries the proverb link.)

- [ ] **Step 2: Add a «Картка» link in the detail share row** — find the existing line in `openDetail`:
```typescript
      <div class="detail-share"><button class="detail-sharebtn" type="button">Поділитися</button></div>
```
  and change it to add the card link (the existing `.detail-sharebtn` wiring is unchanged):
```typescript
      <div class="detail-share"><button class="detail-sharebtn" type="button">Поділитися</button><a class="detail-cardbtn" href="/card/${esc(p.id)}.png" target="_blank" rel="noopener">Картка</a></div>
```

- [ ] **Step 3: Styles** — in `app/public/styles.css`, REPLACE the existing `.detail-share { margin-top: 1.2rem; }` rule with a flex row, and append the `.detail-cardbtn` style (mirroring `.detail-sharebtn`):
```css
.detail-share { margin-top: 1.2rem; display: flex; gap: .6rem; flex-wrap: wrap; }
.detail-cardbtn { font-family: var(--sans); font-size: .82rem; cursor: pointer; background: none; border: 1px solid var(--willow); color: var(--willow); border-radius: 999px; padding: .45rem 1.1rem; text-decoration: none; }
.detail-cardbtn:hover { background: var(--willow); color: #fff; }
```

- [ ] **Step 4: Build + verify** — from `app/`: `node build.mjs` → "Built public/app.js" (no errors); `npx vitest run` → green.

- [ ] **Step 5: Commit**
```bash
git add app/src/client/main.ts app/public/styles.css
git commit -m "feat(cards): deep-link share to /p/:id + «Картка» link to the card image"
```

---

### Task 5 [CONTROLLER-RUN]: preview render-spike, deploy, finish

Controller-run. The card-render verification (the font risk) happens here, BEFORE production. Deploy is **outward — confirm with user**.

- [ ] **Step 1: Bump SW cache** — `app/public/sw.js` `CACHE` → next version.
- [ ] **Step 2: Preview** — `cd app && node build.mjs && npx wrangler versions upload`.
- [ ] **Step 3: Render-spike (the gate)** — on the preview URL, fetch `/card/p000123.png` and `/card/daily.png` and **eyeball them**: confirm the Ukrainian text renders (not tofu/boxes), layout is correct, willow rule + footer present. If text is missing/garbled → the font isn't loading: check the esbuild `.ttf` binary import (`ptSerif.buffer`), confirm PT Serif has the glyphs, or swap the font; rebuild + re-upload. Do not proceed to production until a card renders Ukrainian correctly.
- [ ] **Step 4: Validate `/p/:id`** — fetch a `/p/p000123` and confirm the OG tags + `og:image` are in the HTML (paste into an OG validator or grep); check the page renders in a browser; check the homepage `og:image` = `/card/daily.png` resolves.
- [ ] **Step 5: Deploy** (confirm with user) — `npx wrangler deploy`; smoke production (`/card/p000001.png`, `/p/p000001`, `/card/daily.png`, homepage). Test the share button on the live site.
- [ ] **Step 6: Finish** — README (a "Sharing" note: `/p/:id` + `/card/:id.png` + daily card); controller merges `feat/social-cards` → main, pushes both remotes; update memory.

---

## Self-Review

**1. Spec coverage:** §2 routing (`/p/*`,`/card/*` in run_worker_first) → Task 3. §3 `/p/:id` HTML + OG meta → Tasks 1 (`buildProverbPage`), 3. §4 `/card/:id.png` (workers-og, editorial design, immutable cache) → Tasks 1 (`cardModel`), 2 (`renderCard`), 3. §5 `/card/daily.png` (date-deterministic, presentable pool, day cache, homepage OG) → Tasks 1 (`dailyIndex`), 3. §6 share button → Task 4. §7 homepage OG → Task 3 Step 5. §8 components (meta.ts, card.ts, index.ts, wrangler, font, main.ts) → Tasks 1–4. §9 testing (meta units; /p HTML; card render on preview) → Tasks 1, 3, 5. §10 deploy → Task 5. §11 risks (Cyrillic font spike) → Task 5 Step 3 gate; `new Date()` used only for the daily seed (Task 3). ✓

**2. Placeholder scan:** complete code for meta.ts, card.ts, the route block, the share wiring, styles, homepage meta. The TTF is fetched from a concrete URL (Task 2 Step 2). Card-render "verification on preview" is a deliberate, stated strategy (satori+wasm can't run in the unit-test pool), not a hand-wave — the gate is concrete (Task 5 Step 3). No TBD/"handle errors".

**3. Type consistency:** `CardModel`/`cardModel`/`escapeHtml`/`buildProverbPage`/`dailyIndex` identical between Task 1 (def) and Tasks 2/3 (use). `renderCard(CardModel) -> Response` consistent between Task 2 (def) and Task 3 (use). Routes `/p/:id`, `/card/:id.png`, `/card/daily.png` consistent across wrangler, index.ts, meta.ts (`og:image` path), and main.ts (share links). The font import (`ptSerif` Uint8Array → `.buffer`) matches the esbuild binary loader added in Task 2 Step 3.

**Note:** Task 3 modifies the top of `fetch()` (adds the card-route block before the `/api` passthrough); the implementer must place it after `url`/`try` are established and leave the existing `/api/*` chain intact — called out in Task 3 Step 4.
