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
