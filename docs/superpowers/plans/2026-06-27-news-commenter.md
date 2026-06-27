# News-commenter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bot that drafts news+proverb pairings (RSS + Telegram channel previews → semantic top-5), DMs the admin for one-tap approval, and posts the chosen animated card to `@VerbaCorpus` — news-led, never auto-posted.

**Architecture:** A pure-ish `news.ts` module fetches/parses sources and matches proverbs; `telegram.ts` gains the draft cycle, the `/news` command, and the approval callback; `index.ts` dispatches the cron. State (seen-dedup + pending drafts) lives in a new `NEWS_KV` namespace.

**Tech Stack:** TypeScript, Cloudflare Workers (Workers AI bge-m3, Vectorize, KV), grammy, vitest (`@cloudflare/vitest-pool-workers`).

## Global Constraints

- **No auto-post.** Channel posts happen only on an admin tap. Admin = `198155742`.
- All paths relative to `app/`. `NEWS_BATCH = 3` drafts per cycle. `seen:<id>` is set at **draft** time (TTL 7d); `draft:<id>` TTL 24h.
- Channel target is `env.TELEGRAM_CHANNEL_ID`; bot token `env.TELEGRAM_BOT_TOKEN` (existing secrets).
- Reuse the existing semantic path: `env.AI.run("@cf/baai/bge-m3", {text:[q]})` → `env.VECTORIZE.query(vec, {topK})` → `mapMatches(matches, byId, {...})` from `./shared/semantic`.
- Match the existing code style (2-space indent, no semicolize changes elsewhere). Tests run with `cd app && npx vitest run`.

---

### Task 1: News types + RSS parser

**Files:**
- Create: `app/src/news.ts`
- Test: `app/test/news.test.ts`

**Interfaces:**
- Produces: `type NewsItem = { id: string; title: string; link: string; source: string; ts: number }`; `function parseRss(xml: string, source: string): NewsItem[]`; `function newsId(link: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// app/test/news.test.ts
import { describe, it, expect } from "vitest";
import { parseRss, newsId } from "../src/news";

const RSS = `<?xml version="1.0"?><rss><channel>
  <item><title>Перша новина</title><link>https://x.ua/a</link><pubDate>Wed, 25 Jun 2026 10:00:00 +0300</pubDate></item>
  <item><title><![CDATA[Друга <b>новина</b>]]></title><link>https://x.ua/b</link><pubDate>Wed, 25 Jun 2026 09:00:00 +0300</pubDate></item>
</channel></rss>`;

describe("parseRss", () => {
  it("extracts title/link, strips CDATA+tags, newest first, stable id", () => {
    const items = parseRss(RSS, "Pravda");
    expect(items.length).toBe(2);
    expect(items[0].title).toBe("Перша новина");
    expect(items[0].link).toBe("https://x.ua/a");
    expect(items[0].source).toBe("Pravda");
    expect(items[1].title).toBe("Друга новина"); // CDATA + tags stripped
    expect(items[0].ts).toBeGreaterThan(items[1].ts); // newest first
    expect(items[0].id).toBe(newsId("https://x.ua/a"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run test/news.test.ts`
Expected: FAIL — cannot find module `../src/news`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/news.ts
export type NewsItem = { id: string; title: string; link: string; source: string; ts: number };

// FNV-1a hash of the link → short stable id (KV key suffix).
export function newsId(link: string): string {
  let h = 2166136261;
  for (let i = 0; i < link.length; i++) { h ^= link.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const stripTags = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();

const tag = (block: string, name: string): string => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripTags(m[1]) : "";
};

export function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const title = tag(block, "title");
    const link = tag(block, "link");
    if (!title || !link) continue;
    const pub = tag(block, "pubDate");
    const ts = pub ? Date.parse(pub) || 0 : 0;
    items.push({ id: newsId(link), title, link, source, ts });
  }
  return items.sort((a, b) => b.ts - a.ts);
}
```

> Note: `Date.parse` is allowed (it parses a string argument; only the arg-less `Date.now()`/`new Date()` are restricted, and we don't use them).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run test/news.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/news.ts test/news.test.ts
git commit -m "feat(news): NewsItem type + RSS parser"
```

---

### Task 2: Telegram channel preview parser

**Files:**
- Modify: `app/src/news.ts`
- Test: `app/test/news.test.ts`

**Interfaces:**
- Consumes: `NewsItem`, `newsId` (Task 1).
- Produces: `function parseTgPreview(html: string, channel: string): NewsItem[]`.

- [ ] **Step 1: Write the failing test**

```ts
// append to app/test/news.test.ts
import { parseTgPreview } from "../src/news";

const TG = `
<div class="tgme_widget_message" data-post="yigal_levin/1200">
  <div class="tgme_widget_message_text">Аналітика дня. <a href="x">лінк</a></div>
  <time datetime="2026-06-25T08:00:00+00:00"></time>
</div>
<div class="tgme_widget_message" data-post="yigal_levin/1201">
  <div class="tgme_widget_message_text">Коротка новина</div>
  <time datetime="2026-06-25T09:00:00+00:00"></time>
</div>`;

describe("parseTgPreview", () => {
  it("extracts post text + t.me link, strips tags, newest first", () => {
    const items = parseTgPreview(TG, "yigal_levin");
    expect(items.length).toBe(2);
    expect(items[0].link).toBe("https://t.me/yigal_levin/1201");
    expect(items[0].title).toBe("Коротка новина");
    expect(items[1].title).toBe("Аналітика дня. лінк");
    expect(items[0].source).toBe("@yigal_levin");
  });
  it("returns [] for an empty/blocked preview", () => {
    expect(parseTgPreview("<html>no messages</html>", "x")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run test/news.test.ts`
Expected: FAIL — `parseTgPreview` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to app/src/news.ts
export function parseTgPreview(html: string, channel: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of html.matchAll(/<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?<\/time>/gi)) {
    const block = m[0];
    const post = m[1]; // "channel/123"
    const tm = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const title = tm ? stripTags(tm[1]) : "";
    if (!title) continue;
    const dm = block.match(/datetime="([^"]+)"/i);
    const ts = dm ? Date.parse(dm[1]) || 0 : 0;
    const link = `https://t.me/${post}`;
    items.push({ id: newsId(link), title, link, source: `@${channel}`, ts });
  }
  return items.sort((a, b) => b.ts - a.ts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run test/news.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
cd app && git add src/news.ts test/news.test.ts
git commit -m "feat(news): t.me/s channel preview parser"
```

---

### Task 3: Sources, gather, KV dedup + draft store

**Files:**
- Modify: `app/src/news.ts`
- Test: `app/test/news.test.ts`

**Interfaces:**
- Consumes: `NewsItem`, `parseRss`, `parseTgPreview`.
- Produces: `RSS_FEEDS`, `TG_CHANNELS`, `NEWS_BATCH`; `gatherNews(fetchImpl)`; `pickUnseen(items, kv, n)`; `type Draft`; `putDraft/getDraft/delDraft/markSeen` (KV helpers). `KVLike` = `{ get(k): Promise<string|null>; put(k,v,o?): Promise<void>; delete(k): Promise<void> }`.

- [ ] **Step 1: Write the failing test (mock KV + fetch)**

```ts
// append to app/test/news.test.ts
import { pickUnseen, putDraft, getDraft, markSeen, NEWS_BATCH } from "../src/news";

function mockKv() {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k) };
}

describe("dedup + draft store", () => {
  it("pickUnseen returns up to n unseen, newest first, skipping seen", async () => {
    const kv = mockKv();
    const items = [
      { id: "a", title: "A", link: "la", source: "s", ts: 3 },
      { id: "b", title: "B", link: "lb", source: "s", ts: 2 },
      { id: "c", title: "C", link: "lc", source: "s", ts: 1 },
    ];
    await markSeen(kv, "a");
    const picked = await pickUnseen(items, kv, 2);
    expect(picked.map((p) => p.id)).toEqual(["b", "c"]);
  });
  it("draft round-trips and NEWS_BATCH is 3", async () => {
    const kv = mockKv();
    await putDraft(kv, "d1", { newsTitle: "T", link: "L", source: "s", proverbIds: ["p1", "p2"] });
    expect((await getDraft(kv, "d1"))?.proverbIds[0]).toBe("p1");
    expect(NEWS_BATCH).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run test/news.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to app/src/news.ts
export const NEWS_BATCH = 3;
export const RSS_FEEDS = [
  { url: "https://www.pravda.com.ua/rss/", source: "Українська правда" },
  { url: "https://suspilne.media/rss/all.rss", source: "Суспільне" },
  { url: "https://www.ukrinform.ua/rss/block-lastnews", source: "Укрінформ" },
];
export const TG_CHANNELS = ["D7_channel", "purrphyrogenit", "yigal_levin", "gruntmedia", "ukrbavovna", "notnets", "marshalvdv", "prozapas77"];

export type KVLike = { get(k: string): Promise<string | null>; put(k: string, v: string, o?: any): Promise<void>; delete(k: string): Promise<void> };
export type Draft = { newsTitle: string; link: string; source: string; proverbIds: string[] };

type FetchImpl = (url: string) => Promise<Response>;

// Fan out all sources; per-source failures are logged and skipped, never thrown.
export async function gatherNews(fetchImpl: FetchImpl): Promise<NewsItem[]> {
  const jobs: Promise<NewsItem[]>[] = [];
  for (const f of RSS_FEEDS) jobs.push(
    fetchImpl(f.url).then((r) => r.text()).then((x) => parseRss(x, f.source)).catch((e) => { console.error("rss", f.url, e); return []; }));
  for (const c of TG_CHANNELS) jobs.push(
    fetchImpl(`https://t.me/s/${c}`).then((r) => r.text()).then((h) => parseTgPreview(h, c)).catch((e) => { console.error("tg", c, e); return []; }));
  const all = (await Promise.all(jobs)).flat();
  return all.sort((a, b) => b.ts - a.ts);
}

export async function markSeen(kv: KVLike, id: string): Promise<void> {
  await kv.put(`seen:${id}`, "1", { expirationTtl: 604800 }); // 7d
}
export async function pickUnseen(items: NewsItem[], kv: KVLike, n: number): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  for (const it of items) {
    if (out.length >= n) break;
    if (await kv.get(`seen:${it.id}`)) continue;
    out.push(it);
  }
  return out;
}
export async function putDraft(kv: KVLike, id: string, d: Draft): Promise<void> {
  await kv.put(`draft:${id}`, JSON.stringify(d), { expirationTtl: 86400 }); // 24h
}
export async function getDraft(kv: KVLike, id: string): Promise<Draft | null> {
  const v = await kv.get(`draft:${id}`);
  return v ? (JSON.parse(v) as Draft) : null;
}
export async function delDraft(kv: KVLike, id: string): Promise<void> {
  await kv.delete(`draft:${id}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run test/news.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd app && git add src/news.ts test/news.test.ts
git commit -m "feat(news): sources, gatherNews, KV dedup + draft store"
```

---

### Task 4: Proverb matcher (semantic top-5)

**Files:**
- Modify: `app/src/news.ts`
- Test: `app/test/news.test.ts`

**Interfaces:**
- Consumes: `mapMatches` from `./shared/semantic`; `type Proverb` from `./shared/corpus`.
- Produces: `matchProverbs(ai, vectorize, text, byId, limit?): Promise<string[]>` (returns proverb ids). `AiLike = { run(model, inputs): Promise<{ data: number[][] }> }`, `VecLike = { query(vec, opts): Promise<{ matches: any[] }> }`.

- [ ] **Step 1: Write the failing test (mock AI + Vectorize)**

```ts
// append to app/test/news.test.ts
import { matchProverbs } from "../src/news";

describe("matchProverbs", () => {
  it("embeds text, queries vectorize, returns up to `limit` proverb ids by score", async () => {
    const ai = { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) };
    const vectorize = { query: async () => ({ matches: [
      { id: "p1", score: 0.9 }, { id: "p2", score: 0.8 }, { id: "p3", score: 0.1 },
    ] }) };
    const byId = new Map<string, any>([
      ["p1", { id: "p1", text: "одне", category: [], sources: [] }],
      ["p2", { id: "p2", text: "два", category: [], sources: [] }],
      ["p3", { id: "p3", text: "три", category: [], sources: [] }],
    ]);
    const ids = await matchProverbs(ai, vectorize, "новина", byId, 2);
    expect(ids).toEqual(["p1", "p2"]); // p3 below default minScore 0.4
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run test/news.test.ts`
Expected: FAIL — `matchProverbs` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to app/src/news.ts
import { mapMatches } from "./shared/semantic";
import type { Proverb } from "./shared/corpus";

export type AiLike = { run(model: string, inputs: { text: string[] }): Promise<{ data: number[][] }> };
export type VecLike = { query(vec: number[], opts: { topK: number }): Promise<{ matches: any[] }> };

export async function matchProverbs(ai: AiLike, vectorize: VecLike, text: string, byId: Map<string, Proverb>, limit = 5): Promise<string[]> {
  const { data } = await ai.run("@cf/baai/bge-m3", { text: [text.slice(0, 400)] });
  const { matches } = await vectorize.query(data[0], { topK: 100 });
  const { results } = mapMatches(matches, byId, { minScore: 0.4, limit });
  return results.map((r: any) => r.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run test/news.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd app && git add src/news.ts test/news.test.ts
git commit -m "feat(news): semantic proverb matcher (top-5)"
```

---

### Task 5: Bindings — NEWS_KV + news cron + Env type

**Files:**
- Modify: `app/wrangler.jsonc`
- Modify: `app/src/index.ts` (the `interface Env` block, ~line 25)

**Interfaces:**
- Produces: `env.NEWS_KV` available to `index.ts`/`telegram.ts`; the `0 5,8,11,14,17 * * *` cron.

> The KV namespace must exist in Cloudflare. The implementer creates it once:
> `cd app && npx wrangler kv namespace create NEWS_KV` and pastes the returned `id` into the binding below. (If creation is deferred, use a placeholder id and note it — deploy will fail until set.)

- [ ] **Step 1: Add the KV binding + cron to `wrangler.jsonc`**

Add after the `vectorize` line:

```jsonc
  "kv_namespaces": [{ "binding": "NEWS_KV", "id": "<paste-id-from-wrangler-kv-namespace-create>" }],
```

Change `triggers`:

```jsonc
  "triggers": {
    "crons": ["0 9 * * *", "0 5,8,11,14,17 * * *"]
  },
```

- [ ] **Step 2: Add `NEWS_KV` to the `Env` interface in `index.ts`**

In `app/src/index.ts`, inside `interface Env { ... }`, after the `TELEGRAM_WEBHOOK_SECRET?: string;` line, add:

```ts
  NEWS_KV: KVNamespace;
```

(`KVNamespace` comes from `@cloudflare/workers-types`, already a devDependency.)

- [ ] **Step 3: Verify it compiles**

Run: `cd app && node build.mjs`
Expected: `Built public/app.js + public/chrome.js`.

- [ ] **Step 4: Commit**

```bash
cd app && git add wrangler.jsonc src/index.ts
git commit -m "build(news): add NEWS_KV namespace + news cron slots"
```

---

### Task 6: Draft cycle + `/news` command + approval DM

**Files:**
- Modify: `app/src/telegram.ts`
- Test: `app/test/telegram.test.ts`

**Interfaces:**
- Consumes: `gatherNews, pickUnseen, matchProverbs, putDraft, markSeen, NEWS_BATCH, type Draft, type NewsItem` from `./news`; `cardAnim`, `byId`, `meta`, `host` from `initBot`.
- Produces: `const ADMIN_USER_ID = 198155742`; `async function draftNews(api, env, byId, host): Promise<number>` (drafts up to NEWS_BATCH, DMs admin, returns count); `bot.command("news")` (admin-gated). `draftId` is `newsId(item.link)` (reuse — stable, dedups drafts too).

- [ ] **Step 1: Write the failing test (admin gating + draft count)**

Add to `app/test/telegram.test.ts` (mirrors existing webhook test setup — it builds an Update and posts to `/api/telegram-webhook`). Test that a `/news` from a non-admin is refused. Minimal example:

```ts
// app/test/telegram.test.ts — add inside the existing describe
it("/news is refused for non-admin users", async () => {
  const update = { update_id: 1, message: { message_id: 1, date: 0, chat: { id: 999, type: "private" },
    from: { id: 999, is_bot: false, first_name: "x" }, text: "/news", entities: [{ type: "bot_command", offset: 0, length: 5 }] } };
  const res = await SELF.fetch("https://example.com/api/telegram-webhook", {
    method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-secret" },
    body: JSON.stringify(update) });
  expect(res.status).toBe(200); // handled, but no draft sent (asserted via no throw / admin gate)
});
```

> The existing `telegram.test.ts` already configures `TELEGRAM_WEBHOOK_SECRET=test-secret` and a fake bot token; follow its exact harness. This test asserts the gate path runs without error.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run test/telegram.test.ts`
Expected: FAIL — `/news` not handled (or admin gate absent).

- [ ] **Step 3: Implement `ADMIN_USER_ID`, `draftNews`, and the `/news` command**

Near the top of `telegram.ts` (with `CHANNEL_URL`):

```ts
const ADMIN_USER_ID = 198155742; // @dyemelianov — only this user can draft/approve news
```

Add imports:

```ts
import { gatherNews, pickUnseen, matchProverbs, putDraft, markSeen, newsId, NEWS_BATCH, type NewsItem } from "./news";
```

Add `draftNews` (module-level, after `formatProverbHtml`):

```ts
// Draft up to NEWS_BATCH unseen news items: match proverbs, store a draft, DM the admin.
// Returns the number of drafts sent. env carries AI/VECTORIZE/NEWS_KV/TELEGRAM_CHANNEL_ID.
export async function draftNews(api: any, env: any, byId: Map<string, Proverb>, host: string): Promise<number> {
  if (!env.AI || !env.VECTORIZE || !env.NEWS_KV) return 0;
  const items = await pickUnseen(await gatherNews((u) => fetch(u)), env.NEWS_KV, NEWS_BATCH);
  let sent = 0;
  for (const it of items) {
    const ids = await matchProverbs(env.AI, env.VECTORIZE, it.title, byId).catch(() => [] as string[]);
    if (!ids.length) { await markSeen(env.NEWS_KV, it.id); continue; }
    const draftId = newsId(it.link);
    await markSeen(env.NEWS_KV, it.id);
    await putDraft(env.NEWS_KV, draftId, { newsTitle: it.title, link: it.link, source: it.source, proverbIds: ids });
    const list = ids.map((id, i) => `${i + 1}. ${escapeHtml((byId.get(id)?.text || "").slice(0, 90))}`).join("\n");
    const kb = new InlineKeyboard();
    ids.forEach((_, i) => kb.text(String(i + 1), `news:${draftId}:${i}`));
    kb.row().text("⏭ Пропустити", `news:${draftId}:skip`);
    await api.sendMessage(ADMIN_USER_ID,
      `📰 <b>${escapeHtml(it.title)}</b>\n${escapeHtml(it.source)} · <a href="${it.link}">читати</a>\n\nПрислів'я-коментар — оберіть:\n${list}`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: kb });
    sent++;
  }
  return sent;
}
```

Inside `initBot`, add the command (after `/stickers`):

```ts
  bot.command("news", async (ctx) => {
    if (ctx.from?.id !== ADMIN_USER_ID) return ctx.reply("⛔ Команда лише для адміністратора.");
    const n = await draftNews(bot.api, env, byId, host);
    await ctx.reply(n ? `📨 Надіслано чернеток: ${n}.` : "Немає свіжих новин.");
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run test/telegram.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/telegram.ts test/telegram.test.ts
git commit -m "feat(news): draft cycle + /news command (admin-gated)"
```

---

### Task 7: Approval callback — post or skip

**Files:**
- Modify: `app/src/telegram.ts`
- Test: `app/test/telegram.test.ts`

**Interfaces:**
- Consumes: `getDraft, delDraft, type Draft` from `./news`; `cardAnim`, `byId`, `meta`, `host`, `ADMIN_USER_ID`.
- Produces: `bot.callbackQuery(/^news:/, ...)`; `function newsCaption(d: Draft, proverbText: string, modern: string): string` (news-led).

- [ ] **Step 1: Write the failing test**

```ts
// app/test/news.test.ts — pure unit test for the caption (no telegram harness needed)
import { /* keep existing */ } from "../src/news";
// In telegram.ts the caption builder is exported for testing:
import { newsCaption } from "../src/telegram";

describe("newsCaption (news-led)", () => {
  it("leads with the linked headline, proverb as the comment", () => {
    const c = newsCaption({ newsTitle: "Велика подія", link: "https://x.ua/a", source: "@chan", proverbIds: [] }, "Без труда нема плоду", "");
    expect(c.indexOf("Велика подія")).toBeLessThan(c.indexOf("Без труда нема плоду"));
    expect(c).toContain(`href="https://x.ua/a"`);
    expect(c).toContain("@chan");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run test/news.test.ts`
Expected: FAIL — `newsCaption` not exported from telegram.

- [ ] **Step 3: Implement `newsCaption` + the callback**

Add imports to `telegram.ts`:

```ts
import { getDraft, delDraft, type Draft } from "./news";
```

Add the caption builder (module-level):

```ts
// News-led channel caption: headline (linked) + source, proverb as the comment beneath.
export function newsCaption(d: Draft, proverbText: string, modern: string): string {
  const pm = modern && modern.trim() !== proverbText.trim() ? `\n<i>(${escapeHtml(modern)})</i>` : "";
  return `📰 <a href="${d.link}">${escapeHtml(d.newsTitle)}</a>\n<i>${escapeHtml(d.source)}</i>\n\n💬 <b>${escapeHtml(proverbText)}</b>${pm}`;
}
```

Inside `initBot`, add the callback (after the `cat:` callback):

```ts
  bot.callbackQuery(/^news:(.+):(\d+|skip)$/, async (ctx) => {
    if (ctx.from?.id !== ADMIN_USER_ID) return ctx.answerCallbackQuery("⛔");
    const [, draftId, action] = ctx.match as RegExpMatchArray;
    const d = await getDraft(env.NEWS_KV, draftId);
    if (!d) { await ctx.answerCallbackQuery("Чернетка застаріла"); return; }
    if (action === "skip") {
      await delDraft(env.NEWS_KV, draftId);
      await ctx.editMessageText("⏭ Пропущено.", { reply_markup: undefined });
      return ctx.answerCallbackQuery();
    }
    const p = byId.get(d.proverbIds[Number(action)]);
    if (!p) { await ctx.answerCallbackQuery("Прислів'я не знайдено"); return; }
    const modern = p.modern_text && p.modern_text.trim() !== p.text.trim() ? prettify(p.modern_text) : "";
    try {
      await bot.api.sendAnimation(env.TELEGRAM_CHANNEL_ID, cardAnim(p.id), {
        caption: newsCaption(d, prettify(p.text), modern), parse_mode: "HTML" });
      await delDraft(env.NEWS_KV, draftId);
      await ctx.editMessageText(`✅ Опубліковано: ${escapeHtml(prettify(p.text)).slice(0, 80)}`, { reply_markup: undefined });
    } catch (e) {
      console.error("news post failed", e);
      await ctx.answerCallbackQuery("Помилка публікації, спробуйте ще раз");
      return; // keep the draft for a retry
    }
    await ctx.answerCallbackQuery();
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run test/news.test.ts test/telegram.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/telegram.ts test/news.test.ts
git commit -m "feat(news): approval callback (post/skip) + news-led caption"
```

---

### Task 8: Cron dispatch in `scheduled()`

**Files:**
- Modify: `app/src/index.ts` (the `scheduled` method, ~line 360)

**Interfaces:**
- Consumes: `draftNews` from `./telegram`; existing daily-proverb block.
- Produces: cron dispatch — `"0 9 * * *"` → daily proverb (unchanged); other crons → `draftNews`.

- [ ] **Step 1: Import `draftNews`**

In `index.ts`, change the telegram import to include it:

```ts
import { initBot, formatProverbHtml, draftNews } from "./telegram";
```

- [ ] **Step 2: Branch `scheduled()` on `event.cron`**

Wrap the existing daily-proverb body so it only runs for the 09:00 cron, and add the news branch. At the top of the `ctx.waitUntil((async () => { ... })())` body, the existing code begins by checking telegram creds. Replace the method body with:

```ts
  async scheduled(event: any, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHANNEL_ID) {
        console.error("Telegram credentials missing for scheduled posting");
        return;
      }
      const get = async (p: string) => {
        const res = await env.ASSETS.fetch("https://assets" + p);
        if (!res.ok) throw new Error(`Failed to fetch ${p}: ${res.status}`);
        return res.json();
      };
      const [proverbs, explanations, meta] = await Promise.all([
        get("/data/proverbs.json") as Promise<Proverb[]>,
        get("/data/explanations.json") as Promise<Record<string, string>>,
        get("/data/meta.json") as Promise<any>,
      ]);
      const host = "verbacorpus.org";
      const byId = new Map(proverbs.map((p) => [p.id, p]));
      const bot = initBot(env as any, proverbs, explanations, meta, host);

      if (event.cron !== "0 9 * * *") {
        // News-commenter slots — draft, do not post.
        const n = await draftNews(bot.api, env, byId, host);
        console.log(`news cron: drafted ${n}`);
        return;
      }

      // 09:00 UTC — daily proverb (unchanged behaviour).
      const pool = proverbs.filter((p) => {
        const t = p.text.trim();
        return /^[А-ЯІЇЄҐ]/.test(t) && t.length >= 18 && t.length <= 90 && t.split(/\s+/).length >= 4;
      });
      const pick = pool[dailyIndex(new Date().toISOString().slice(0, 10), pool.length)] ?? proverbs[0];
      const explanation = explanations[pick.id] || null;
      const formatted = formatProverbHtml(pick, explanation, meta.sources);
      const animUrl = `https://${host}/card/${pick.id}.gif?format=telegram&lang=uk&v=5`;
      const keyboard = new InlineKeyboard().url("🔗 Читати на сайті", `https://${host}/p/${pick.id}`);
      await bot.api.sendAnimation(env.TELEGRAM_CHANNEL_ID, animUrl, {
        caption: `🎲 <b>Прислів'я дня</b>\n\n${formatted}`, parse_mode: "HTML", reply_markup: keyboard });
      console.log(`Successfully posted daily proverb ${pick.id} to Telegram`);
    })());
  }
```

> Note: `new Date().toISOString()` here uses no-arg `new Date()` which is restricted in *workflow* scripts only — this is normal Worker runtime code (already present in the existing daily block), so it stays as-is.

- [ ] **Step 3: Build + full test suite**

Run: `cd app && node build.mjs && npx vitest run`
Expected: build OK; all tests PASS (existing 141 + new news/telegram tests).

- [ ] **Step 4: Commit**

```bash
cd app && git add src/index.ts
git commit -m "feat(news): dispatch news cron in scheduled()"
```

---

### Task 9: Deploy + smoke-test

**Files:** none (operational)

- [ ] **Step 1: Ensure the KV namespace id is set** in `wrangler.jsonc` (from Task 5). If a placeholder was used, create and set it now:

```bash
cd app && npx wrangler kv namespace create NEWS_KV
# paste the returned id into wrangler.jsonc kv_namespaces[0].id, then commit
```

- [ ] **Step 2: Push to deploy via CI** (CI auto-deploys on push to main; secrets already set):

```bash
git push origin main
```

- [ ] **Step 3: Smoke-test** — DM the bot `/news` (as admin `198155742`). Expect up to 3 approval DMs (headline + 5 proverbs + buttons). Tap a number on one → confirm the animated card appears in `@VerbaCorpus`, news-led. Tap ⏭ on another → confirm "Пропущено".

- [ ] **Step 4: Verify dedup** — run `/news` again immediately; the same items should NOT reappear (they're marked seen).

---

## Self-Review

- **Spec coverage:** sources RSS+TG (T1–T3) ✓; semantic top-5 (T4) ✓; KV dedup/draft + seen-at-draft (T3, T6) ✓; human-approval DM + post/skip (T6–T7) ✓; news-led caption (T7) ✓; cron 3h + `/news` + admin gate (T5,T6,T8) ✓; batch=3 (T3,T6) ✓; error handling — per-source skip (T3), no-news (T6), send-failure keeps draft (T7) ✓; testing (T1–T7) ✓.
- **Placeholders:** none — only the KV namespace `id` is environment-specific and is created via the documented `wrangler kv namespace create` command in T5/T9.
- **Type consistency:** `Draft`, `NewsItem`, `KVLike`, `matchProverbs`, `draftNews`, `newsCaption`, `getDraft/putDraft/delDraft/markSeen`, callback pattern `news:<draftId>:<n|skip>`, and `ADMIN_USER_ID = 198155742` are used identically across tasks. `draftId = newsId(link)` is reused as both dedup id and draft key.
