# Ukrainian Proverbs Corpus — SP8: Social-Card Engine

**Date:** 2026-06-23
**Status:** Approved (design)
**Sub-project:** 8 — shareable per-proverb pages + dynamic social-share card images
**Repo:** `ukr-proverbs-corpus`; additions to `app/`
**Depends on:** SP1–SP7 (corpus 48,787, live Worker app + REST API + Vectorize).
**Context:** Second popularization piece (after the REST API + llms.txt). SEO / HuggingFace / Telegram bot remain separate.

---

## 1. Scope

Make every proverb **shareable**: a per-proverb landing page (`/p/:id`) whose link unfurls beautifully on social
platforms (Open Graph / Twitter cards served in the initial HTML), backed by a **dynamically rendered share-card
image** (`/card/:id.png`), plus a **daily card** used as the homepage's OG image, and a **share button** in the PWA.

**Out of scope:** SEO sitemap/per-category pages, HuggingFace publish, Telegram bot, custom domain (all separate).
No auth; cards are public + cached.

## 2. Routing

Add `"/p/*"` and `"/card/*"` to `wrangler.jsonc` `run_worker_first` (so the Worker handles them; all other non-`/api`
paths still served by ASSETS). The Worker dispatches: `/p/:id` → landing page; `/card/:id.png` → share image;
`/card/daily.png` → daily image; unknown → 404 (HTML for `/p/*`, 404 for `/card/*`).

## 3. `/p/:id` — shareable proverb landing page

The Worker serves a **server-rendered HTML page** (not the SPA) for each proverb, with per-proverb meta **in the
initial response** so social scrapers unfurl it:
- `<title>`, `og:title` = the proverb `text`; `og:description` = `modern_text` + source(s) + theme(s);
  `og:image` = `https://<host>/card/:id.png` (+ `og:image:width/height` 1200/630); `og:url` = canonical `/p/:id`;
  `og:type=article`; `twitter:card=summary_large_image`; `og:site_name`, `lang=uk`.
- **Body** (editorial style — links `/fonts/spectral.css` + `/styles.css`): the proverb large in Spectral, the modern
  reading, source + theme tags + catalog №, the share card image, and links to **the full app** (`/`) and the
  proverb's themes. Clean standalone destination (good for SEO + first impressions).
- Unknown id → a 404 HTML page (editorial style) with a link home.

A pure `buildProverbPage(proverb, host)` → HTML string holds the meta+body assembly (testable; all fields escaped).

## 4. `/card/:id.png` — dynamic share image (1200×630)

Rendered in the Worker via **Cloudflare `workers-og`** (satori → resvg-wasm → PNG; no external service):
- Editorial design: bone background `#f7f5f0`, a wine `#7a2e3a` accent rule, the proverb in **Spectral** (large, wrapped),
  the modern reading (smaller, italic, only if it differs), and a footer line: source(s) · catalog № · «ukr-proverbs-corpus».
- 1200×630 (the OG standard). `Content-Type: image/png`; `Cache-Control: public, max-age=31536000, immutable`
  (deterministic per id) + cached in the Worker Cache API.
- Unknown id → 404.

A pure `cardModel(proverb)` → the layout's text/values is unit-testable; the satori/PNG step is smoke-tested on preview.

## 5. `/card/daily.png` — daily card (homepage OG)

Deterministic by **UTC date**: seed an index from `YYYY-MM-DD` into the **presentable** proverb pool (server-side
filter mirroring the app's `isPresentable`: starts with an uppercase Cyrillic letter, 18–90 chars, ≥4 words — avoids
OCR fragments as the public face). Renders the same card layout. `Cache-Control: public, max-age=86400` (a day).
Used as the **homepage `og:image`**, so sharing the site root unfurls a fresh proverb daily. A `/p/daily` or the
homepage may link it; the picked proverb is also reachable at its own `/p/:id`.

## 6. Share button (PWA detail view)

In `app/src/client/main.ts` `openDetail`, add a **«Поділитися»** control:
- If `navigator.share` exists → `navigator.share({ title, text, url: /p/:id })` (native share sheet).
- Else → copy the `/p/:id` URL to the clipboard (`navigator.clipboard.writeText`) with a brief "скопійовано" confirmation.
- A second link **«Картка»** opens `/card/:id.png` (view/save the image).
Styled to match the detail dialog; offline-safe (the buttons just no-op/hide useful actions when offline).

## 7. Sitewide / homepage OG

`app/public/index.html` `<head>` gains default OG/Twitter meta (site title, description, `twitter:card=summary_large_image`)
with `og:image` = `/card/daily.png`. (The app remains an SPA; only the homepage's static meta + the Worker-rendered
`/p/:id` pages carry per-resource meta.)

## 8. Components / files

- `app/src/shared/meta.ts` — pure `buildProverbPage(proverb, host)` (HTML+OG) and `cardModel(proverb)` (card text/lines); escaping helpers. [TDD vitest]
- `app/src/card.ts` — `renderCard(model, font) -> Promise<ArrayBuffer>` using `workers-og`/satori; the PNG renderer.
- `app/src/index.ts` — routes `/p/:id`, `/card/:id.png`, `/card/daily.png`; daily-index selection (pure helper `dailyIndex(dateStr, poolLen)` [TDD]); Cache API integration.
- `app/wrangler.jsonc` — `run_worker_first` += `/p/*`, `/card/*`.
- `app/public/index.html` — homepage OG meta.
- `app/src/client/main.ts` — share button in `openDetail`; `app/public/styles.css` — share-button styles.
- A bundled **Cyrillic TTF** (e.g. PT Serif or Spectral TTF, OFL) for satori — committed under `app/src/fonts/` and imported as an `ArrayBuffer`/bytes (esbuild can bundle binary via a loader, or fetch from ASSETS at runtime).
- `package.json` — add `workers-og` (or `@cf-wasm/og`).

## 9. Testing

- **vitest** `meta.ts`: `buildProverbPage` emits correct, escaped OG/Twitter tags (og:title=text, og:image=`/card/:id.png`, twitter:card) + a body containing the proverb; `cardModel` produces the expected lines (truncation of very long proverbs; modern shown only if differs); `dailyIndex` deterministic for a fixed date + within `[0,poolLen)`.
- **vitest** API (mocked bindings): `/p/:id` returns HTML 200 with `og:image` pointing to the card + 404 for unknown id; `/card/:id.png` returns `image/png` with the immutable cache header (the satori render may be stubbed/skipped under the test pool — assert headers + status, not pixels); `/card/daily.png` returns `image/png` + day cache header; existing `/api/*` + assets unaffected.
- **Manual (preview):** open a `/p/:id` link in a social-card validator (or inspect tags), eyeball `/card/:id.png` + `/card/daily.png` render Ukrainian text correctly (the Cyrillic-font check), test the share button on mobile, confirm the homepage unfurls.

## 10. Deploy

`wrangler deploy` — outward; **confirmed with the user**. Adds `workers-og` + WASM + the font to the bundle
(well under the 10 MB paid limit). Bump `sw.js` cache. No new bindings.

## 11. Risks / open items

- **Cyrillic font in satori (the main risk):** satori needs an embedded TTF/OTF with Cyrillic glyphs (our self-hosted
  woff2 is insufficient). Mitigation: bundle a known-good Cyrillic TTF (PT Serif/Spectral, OFL) and verify the
  rendered card shows Ukrainian text on the first preview before building further. The build plan's first card task is a render spike.
- **Worker CPU / bundle:** satori+resvg-wasm render is CPU-bound (~tens–hundreds of ms) and adds ~1–2 MB to the bundle;
  fine on the paid plan. Cards are cached (immutable per id; daily for the daily card) so re-renders are rare.
- **`new Date()` in the Worker** is allowed (Workers, not Workflow scripts) — used only for the daily-card date seed.
- **SPA vs server pages:** `/p/:id` is server-rendered HTML distinct from the SPA; it links into the app rather than hydrating it (keeps it simple + crawlable).
