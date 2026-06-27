import { describe, it, expect } from "vitest";
import { parseRss, newsId, parseTgPreview, pickUnseen, putDraft, getDraft, markSeen, NEWS_BATCH, matchProverbs } from "../src/news";
import { newsCaption } from "../src/telegram";

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

describe("newsCaption (news-led)", () => {
  it("leads with the linked headline, proverb as the comment", () => {
    const c = newsCaption({ newsTitle: "Велика подія", link: "https://x.ua/a", source: "@chan", proverbIds: [] }, "Без труда нема плоду", "");
    expect(c.indexOf("Велика подія")).toBeLessThan(c.indexOf("Без труда нема плоду"));
    expect(c).toContain(`href="https://x.ua/a"`);
    expect(c).toContain("@chan");
  });
});
