import { describe, it, expect } from "vitest";
import { parseRss, newsId, parseTgPreview } from "../src/news";

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
