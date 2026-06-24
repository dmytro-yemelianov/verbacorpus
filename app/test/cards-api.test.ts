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
    expect(html).toContain('class="p-card" src="/card/p1.png"');
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
