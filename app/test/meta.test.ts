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
  it("omits modern when equal; builds footer with short link; returns qr + shortUrl", () => {
    const m = cardModel(P, { host: "verbacorpus.org" });
    expect(m.modern).toBe("");
    expect(m.footer.endsWith("verbacorpus.org/s/123")).toBe(true);
    expect(m.shortUrl).toBe("https://verbacorpus.org/s/123");
    expect(m.qr.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });
  it("keeps modern when different; truncates long text", () => {
    const m = cardModel({ ...P, modern_text: "Без труда нема плоду", text: "x".repeat(200) }, { host: "verbacorpus.org" });
    expect(m.modern).toBe("Без труда нема плоду");
    expect(m.text.length).toBeLessThanOrEqual(161);
    expect(m.text.endsWith("…")).toBe(true);
  });
});
describe("buildProverbPage", () => {
  it("emits escaped per-proverb OG meta and card-first hero", () => {
    const html = buildProverbPage({ ...P, text: 'a<b' }, "example.com");
    expect(html).toContain('<meta property="og:title" content="a&lt;b"');
    expect(html).toContain('<meta property="og:image" content="https://example.com/card/p000123.png"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).toContain('https://example.com/p/p000123');
    expect(html).toContain("a&lt;b");
    expect(html).toContain('<img class="p-card" src="/card/p000123.png"');
    expect(html).toContain('class="topbar"');
    expect(html).toContain('id="copyLink"');
    expect(html).toContain('data-link="https://example.com/s/123"');
    expect(html).toContain('<script type="module" src="/chrome.js">');
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
