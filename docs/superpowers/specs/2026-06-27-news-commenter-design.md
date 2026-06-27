# News-commenter for the verba Telegram channel — Design

**Date:** 2026-06-27
**Status:** Approved (brainstorm), pending implementation plan

## Goal

A bot feature that periodically pulls fresh Ukraine-related news, finds proverbs from
the corpus that "comment" on each item, and — **after human approval** — posts the
chosen proverb (as an animated card) to the `@VerbaCorpus` channel, leading with the
news headline and linking the source. The proverb is the witty/edifying *comment*; the
news is the subject.

## Hard constraint: tone & safety

Ukraine news is dominated by war, strikes, and casualties. Auto-pairing a folk proverb
with a tragedy would be offensive and is posted under verba's name. Therefore:

- **No content is ever auto-posted to the channel.** Every post passes through a
  human-approval gate (the owner, `198155742` / @dyemelianov).
- The bot only *drafts* a pairing and DMs it to the admin with explicit
  **post / skip** controls. The channel post happens solely on the admin's tap.

This gate is the primary safety mechanism; no automated sentiment/tragedy classifier is
relied upon.

## Sources

Two kinds, both fetched server-side in the Worker (no extra infra, no MTProto):

1. **RSS feeds** (parse the XML): Ukrainska Pravda, Suspilne, Ukrinform.
2. **Public Telegram channels** via their web preview `https://t.me/s/<name>` (parse the
   post HTML — a bot cannot read channels it does not administer). Channels:
   `D7_channel, purrphyrogenit, yigal_levin, gruntmedia, ukrbavovna, notnets,
   marshalvdv, prozapas77`. Any channel whose preview is unavailable/empty is skipped.

All items normalize to `NewsItem { id, title, link, source, ts }` where `id = hash(link)`.

## Proverb selection

Reuse the existing semantic pipeline (no new model):
`AI.run("@cf/baai/bge-m3", {text:[newsTitle]})` → `VECTORIZE.query({topK})` →
`mapMatches(..., byId)` → take the **top 5** above `SEMANTIC_MIN_SCORE`. The admin picks
which of the 5 best comments on the news (or skips). Human judgment resolves the
subjective "does this proverb fit" question — no sentiment model needed.

## Components

- **`app/src/news.ts`** (new):
  - `fetchRss(url): Promise<NewsItem[]>` — fetch + parse RSS XML.
  - `fetchTgChannel(name): Promise<NewsItem[]>` — fetch `t.me/s/<name>`, parse posts.
  - `gatherNews(env): Promise<NewsItem[]>` — fan out all sources, normalize, sort newest-first, swallow per-source errors.
  - `pickUnseen(items, kv, n)` — up to `n` newest items whose `id` is not in `NEWS_KV` (batch; `NEWS_BATCH = 3`).
- **Matcher** — a small helper (in `news.ts` or reused from the semantic handler) returning the top-5 proverb ids for a news title.
- **Draft + approval** (in `telegram.ts`):
  - On draft (for each item in the batch): mark the news `id` seen (TTL 7d) **at draft time** so later ticks don't re-DM it, store `Draft { newsTitle, link, source, proverbIds[5] }` in `NEWS_KV` under a short `draftId` (TTL 24h), and DM the admin one message per item.
  - Inline buttons carry callback data `news:<draftId>:<n>` (n = 1..5) and `news:<draftId>:skip`.
  - Callback handler (admin-gated): on `n`, render proverb-n's animated card, post to the channel, delete the draft, edit the DM to "✅ Опубліковано"; on `skip`, delete the draft and edit to "⏭ Пропущено". (`seen` is already set from draft time.)
- **Triggers** (in `index.ts`):
  - **Cron:** add news slots; `scheduled()` branches on `event.cron` (existing `0 9 * * *` daily-proverb vs the news slots).
  - **`/news` command:** admin-only; runs one draft cycle on demand.

## Storage — `NEWS_KV` (new KV namespace binding)

| Key | Value | TTL |
|---|---|---|
| `seen:<newsId>` | `"1"` (set at draft time) | 7 days |
| `draft:<draftId>` | JSON `Draft` | 24 hours |

KV chosen over D1/DO: only need small TTL'd key lookups (dedup) and a transient draft
payload. No-storage would re-draft the same news every tick. `seen` is set when an item
is drafted (not when approved) so a batch of pending DMs is never re-sent on the next tick.

## Data flow

```
cron (every 3h, 08–22 Kyiv)  OR  /news (admin)
  → gatherNews()  [RSS + t.me/s previews]
  → pickUnseen(n = NEWS_BATCH=3)  [skip seen:<id>, newest first]
  → none? → (cron: silent; /news: "немає свіжих новин") and stop
  → for each of the (≤3) items:
       embed title → Vectorize → top-5 proverbs
       set seen:<id>; store draft:<id>; DM admin: 📰 headline + link + numbered proverbs + [1..5][⏭]
  → admin taps n    → sendAnimation(channel, card) with caption (news-led); delete draft; edit DM ✅
  → admin taps skip → delete draft; edit DM ⏭
```

## Channel post format (news-led)

`sendAnimation` of `…/card/<proverbId>.gif?format=telegram`, caption (HTML):

```
📰 <a href="{link}">{headline}</a>
<i>{source}</i>

💬 <b>{proverb text}</b>
{<i>(modern)</i> if it differs}
```

The news leads; the proverb is the comment under it. (Channel posts omit the
`@VerbaCorpus` line — they are already in the channel.)

## Approval DM format (to admin)

```
📰 <b>{headline}</b>
{source} · <a href="{link}">читати</a>

Прислів'я-коментар — оберіть:
1. {proverb 1}
2. {proverb 2}
3. {proverb 3}
4. {proverb 4}
5. {proverb 5}
```
Inline keyboard: `[1][2][3]` / `[4][5]` / `[⏭ Пропустити]`.

## Triggers / cron

- New cron set for ~08,11,14,17,20 Kyiv. Kyiv is UTC+3 (EEST) now → UTC `0 5,8,11,14,17 * * *`.
- `wrangler.jsonc` `triggers.crons` becomes `["0 9 * * *", "0 5,8,11,14,17 * * *"]`.
- `scheduled(event)` dispatches by `event.cron`: `"0 9 * * *"` → existing daily proverb; otherwise → news draft cycle.
- **DST caveat:** cron is fixed UTC and cannot follow Kyiv DST; in winter (EET, UTC+2) the slots land one hour earlier in local time. Acceptable; documented.

## Admin gating

`ADMIN_USER_ID = 198155742`. The `/news` command and every `news:*` callback verify
`ctx.from.id === ADMIN_USER_ID`; others get a polite refusal / no-op. `TELEGRAM_CHANNEL_ID`
is the post target (already a secret).

## Error handling

- Per-source fetch/parse failure → log and skip that source; never throw the whole cycle.
- No unseen news → cron: silent; `/news`: "немає свіжих новин".
- `AI`/`VECTORIZE` unavailable → skip the cycle with a logged warning (no DM).
- Expired/missing draft on callback → answerCallbackQuery "draft застарів".
- Channel send failure → edit DM to an error note but **keep the draft** (don't delete) so the admin can re-tap to retry.
- `/news` returns the count drafted (e.g. "надіслано 3 чернетки"); each draft is its own DM.

## Testing

- `fetchRss` parser: fixture XML → expected `NewsItem[]`.
- `fetchTgChannel` parser: fixture `t.me/s` HTML → posts (and an empty/blocked preview → `[]`).
- dedup: seen id is skipped; unseen is picked.
- draft round-trip: draft stored → callback `news:<id>:2` posts proverb 2 and marks seen.
- admin gating: non-admin callback/`/news` is refused.
- matcher mocked (AI/Vectorize stubs), mirroring existing semantic tests.

## Out of scope (future)

- A real sentiment/tone classifier or LLM curator (current: semantic top-5 + human pick).
- Auto-posting without approval.
- Multiple target channels / per-language posts.
- Editing/curating the source list from chat (sources are code constants for now).
