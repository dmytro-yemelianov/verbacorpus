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
  it("is card-first with the top nav", async () => {
    const html = await (await call("/p/p1")).text();
    expect(html).toContain('class="p-card" src="/card/p1.png?v=3"');
    expect(html).toContain('class="topbar"');
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

  it("404 for unknown id on cards", async () => {
    expect((await call("/card/zzz.png")).status).toBe(404);
  });
});
