# verba — SP14: Shareable short links + QR cards + card-first proverb page

**Date:** 2026-06-24
**Status:** Approved (design)
**Sub-project:** 14 — short URLs for proverbs, a QR of the short URL on the social card, and a card-first `/p/:id` page
**Repo:** `dmytro-yemelianov/verbacorpus`; `app/` (Worker + PWA)
**Depends on:** the existing `/p/:id` page (`buildProverbPage`), the social cards (`renderCard`/`cardModel`, satori/workers-og), the share button.

---

## 1. Scope & motivation

Make every proverb trivially shareable and scannable: a short link, a QR of that link printed on the social card, and a `/p/:id` page that leads with the card. This supports the upcoming marketing (shareable cards with a scannable link drive traffic from print/social/slides). **No new infrastructure** — proverb IDs are sequential (`p000001`–`p048787`), so the short code is just the number; nothing is stored.

**In scope:** the short-link route, the QR-on-card, the card-first page restructure, the share-uses-short-link change. **Out of scope:** a generic (arbitrary-URL) shortener; any corpus data change (so **no version bump** — this is an app/site feature, VERSION stays 1.0.2).

## 2. Short-link scheme (no database)

- **Form:** `https://verbacorpus.org/s/<n>` where `<n>` is the proverb number with leading zeros stripped (`p000126` → `126`).
- **Resolve:** the Worker handles `/s/<n>` → validate `n` is an integer in `1..count` and the padded id exists → **301** to the canonical `/p/p000126`. Invalid/out-of-range → 404.
- **Helpers** (`app/src/shared/shortlink.ts`, pure): `toShort(id: string) -> string` (`"p000126"`→`"126"`), `fromShort(code: string) -> string | null` (`"126"`→`"p000126"`; rejects non-numeric, leading-zero variants, and `<1`). `shortUrl(id, host) -> string` (`https://<host>/s/<n>`).
- **Routing:** add `/s/*` to `wrangler.jsonc` `run_worker_first`. A bare-root `/<n>` was rejected: matching arbitrary root numbers needs a global `/*` catch-all that would put the Worker in front of every asset request, regressing the load-time work; `/s/` keeps assets on their fast path.

## 3. QR on the card

- The social card `/card/:id.png` (and `/card/daily.png`) gains a **QR of the short link** in the bottom-right corner (~130px, white quiet-zone), with the short URL printed beside/under it (replacing or alongside the existing `verbacorpus.org` footer).
- **QR generation** (`app/src/shared/qr.ts`, pure): a small **vendored MIT QR encoder** (e.g. the single-file `qrcode-generator` algorithm) exposing `qrMatrix(text) -> boolean[][]` and `qrSvg(text, opts) -> string` (an SVG of black modules on white). The short link (~29 chars, byte mode, error-correction M) yields a ~v2–3 (25–29 module) code.
- **Render path:** `qrSvg(...)` → a `data:image/svg+xml;base64,…` URI → a satori `<img>` in the card layout. (satori renders `<img>` data-URIs; this avoids hundreds of module `<div>`s.) The card module already escapes/structures content; the QR is a self-contained image node.

## 4. Card-first `/p/:id` page

Restructure `buildProverbPage` so the page **leads with the card**:
1. **Hero:** `<img src="/card/<id>.png" …>` — the rendered card (which now includes the QR), responsive (max ~640px, `width:100%`, lazy off since it's the hero), with the proverb text as `alt`.
2. **Below:** the modern spelling (if it differs), the **full source citation(s)** (SP13), the explanation (if any), variant links, then a **share row**: a "copy link" control showing/copying the short link, a "download card" link (`/card/:id.png`), and the browse/API links.
3. **Head:** OG/Twitter image stays the card; `og:url`/canonical stay `/p/p000126`; add the short link as nothing special (canonical wins). `<html lang>` + hreflang unchanged.
- The chrome (labels) remains i18n'd (data-i18n / catalog); the proverb + citations stay as-is (data). Reuse the existing escaping (`e()`), `srcLabel`, `prettify`, the SP13 `sourceCitations`.

## 5. Share (client)

`app/src/client/main.ts` `share(p)` and the detail/`/p` "copy link" use `shortUrl(p.id, location.host)` (the `/s/<n>` link) instead of `/p/<id>`. The native share + clipboard fallback both use the short link. A `flash("copied")` on copy (existing helper).

## 6. Components / files

- `app/src/shared/shortlink.ts` (NEW, pure) — `toShort`, `fromShort`, `shortUrl`. [vitest]
- `app/src/shared/qr.ts` (NEW, pure) — vendored QR encoder + `qrMatrix`, `qrSvg`. [vitest]
- `app/src/shared/card.ts` / wherever `renderCard`+`cardModel` live (MODIFY) — add the QR + short URL to the card layout; `cardModel`/`renderCard` take the short link (or the host to build it).
- `app/src/shared/meta.ts` `buildProverbPage` (MODIFY) — card-first restructure.
- `app/src/index.ts` (MODIFY) — `/s/<n>` route (301); pass the short link/host into the card + page; `/card` + `/p` unchanged otherwise.
- `app/src/client/main.ts` (MODIFY) — share/copy uses the short link.
- `app/wrangler.jsonc` (MODIFY) — `run_worker_first` += `/s/*`.
- i18n: add `detail.copyLink` ("Скопіювати посилання" / "Copy link") + `detail.shortLink` label if needed, across all 10 catalogs (the i18n-complete test enforces parity).

## 7. Testing

- **shortlink** (vitest): `toShort("p000126")==="126"`; `fromShort("126")==="p000126"`; `fromShort("0")===null`, `fromShort("p1")===null`, `fromShort("999999")===null` (out of range), `fromShort("01")===null` (no leading-zero aliases); round-trip for boundary ids (1, count).
- **qr** (vitest): `qrMatrix("https://verbacorpus.org/s/126")` returns a square boolean matrix (size ≥ 21, finder-pattern corners set); `qrSvg(...)` returns valid `<svg>` with `width/height` and `<rect>`s; deterministic for a fixed input.
- **worker** (vitest, mocked corpus): `/s/126` → 301 `Location: …/p/p000126`; `/s/0`/`/s/abc`/`/s/<too-big>` → 404; `/card/p000126.png` renders 200 image and the SVG/markup contains the QR; `/p/p000126` is card-first (contains `<img src="/card/p000126.png"` before the text).
- **build/deploy guard:** `node build.mjs` clean; `npx wrangler deploy --dry-run` builds (the QR encoder must bundle); existing tests stay green.
- **Manual (preview):** scan the QR on a real card with a phone → lands on `/s/n` → `/p/page`; the `/p` page shows the card hero + copy-link; the daily card QR works.

## 8. Deploy

App/site feature, no data change → **no corpus version bump**; just `wrangler deploy` (confirmed with the user) + bump the SW cache. Merge to main, push origin.

## 9. Risks / open items

- **QR in satori (main risk):** verify early that the vendored encoder bundles in the Worker and satori renders the data-URI SVG `<img>` at card size; fallback = render the QR as a grid of `<div>`s if the data-URI path misbehaves.
- **QR scannability:** keep ≥ the quiet zone + sufficient contrast + size (~130px at 1200×630); error-correction M tolerates the print/scale. Verify by scanning a real render.
- **Short-link collisions / SEO:** `/s/n` 301s to the canonical `/p/p000126` (no duplicate content). The short link is for sharing; the canonical is the page.
- **i18n parity:** any new catalog key must be added to all 10 (enforced by the completeness test).
