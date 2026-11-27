import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { fakeFonts, fakeUpa } from "./card-fakes";

// Cards need the Nasinnia (FONTS) and UPA bindings; without them they degrade (see card-render.test.ts).
async function call(path: string, extra: Record<string, unknown> = { FONTS: fakeFonts(), UPA: fakeUpa() }) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://example.com" + path), { ...env, ...extra } as any, ctx);
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
  it("is card-first with the top nav", async () => {
    const html = await (await call("/p/p1")).text();
    expect(html).toContain('class="p-card" src="/card/p1.png?v=4"');
    expect(html).toContain('data-verba-navigation');
    expect(html).toContain('id="copyLink"');
  });
});

describe("/s/:n short links", () => {
  it("301s to the canonical proverb page", async () => {
    const res = await call("/s/1");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toMatch(/\/p\/p000001$/);
  });
  it("404s on junk / out-of-range", async () => {
    expect((await call("/s/0")).status).toBe(404);
    expect((await call("/s/abc")).status).toBe(404);
  });
});

describe("/card/:id.png / .gif endpoints", () => {
  it("serves png social card with cache control", async () => {
    const res = await call("/card/p1.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(res.headers.get("cache-control")).toContain("public, max-age=");
  });
  it("serves animated gif card with cache control", async () => {
    const res = await call("/card/p1.gif?format=square&lang=en");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/gif");
    expect(res.headers.get("cache-control")).toContain("public, max-age=");
  });
  it("serves animated webp card with cache control across square, story, and telegram", async () => {
    for (const fmt of ["square", "story", "telegram"]) {
      const res = await call(`/card/p1.webp?format=${fmt}&lang=uk`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toContain("public, max-age=");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
      expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WEBP");
    }
  });
  it("animated gif is palette-restricted (small global color table)", async () => {
    const res = await call("/card/p1.gif?format=square&lang=uk");
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    // Logical Screen Descriptor packed byte (offset 10): bit7 = global color
    // table flag, bits0-2 encode size as 2^(n+1). A fixed ~12-color palette pads
    // to a 16-slot table; the old 256-color quantize would have filled all 256.
    const packed = buf[10];
    const hasGCT = (packed & 0x80) !== 0;
    const gctSize = hasGCT ? 1 << ((packed & 0x07) + 1) : 0;
    expect(hasGCT).toBe(true);
    expect(gctSize).toBeLessThanOrEqual(16);
  });

  it("serves square and daily cards as PNG", async () => {
    for (const path of ["/card/p1.png?format=square", "/card/daily.png", "/card/daily.png?format=story&lang=en&minimal=1&nochrome=1"]) {
      const res = await call(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    }
  });
  it("still serves 200 PNG/GIF when Nasinnia and UPA are missing (degraded, not cached)", async () => {
    for (const [path, type] of [["/card/p1.png", "image/png"], ["/card/p1.gif?format=sticker", "image/gif"]]) {
      const res = await call(path, {});
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(type);
      expect(res.headers.get("x-verba-degraded")).toBe("font,frame");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("404 for unknown id on cards", async () => {
    expect((await call("/card/zzz.png")).status).toBe(404);
  });
});
