import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

async function call(path: string, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://verbacorpus.org" + path, { headers }), env as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("lang routing", () => {
  it("/uk/about → 301 redirect to /about", async () => {
    const res = await call("/uk/about");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toContain("/about");
  });

  it("/uk → 301 redirect to /", async () => {
    const res = await call("/uk");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toContain("verbacorpus.org/");
  });
});

describe("HTMLRewriter translation", () => {
  it("/en/ → SPA HTML with lang=en, __LANG__, and hreflang", async () => {
    const res = await call("/en/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('lang="en"');
    expect(html).toContain('window.__LANG__="en"');
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('hreflang="x-default"');
    // en title translation applied
    expect(html).toContain("verba — Ukrainian proverbs and sayings");
  });

  it("/en/about → translated about page", async () => {
    const res = await call("/en/about");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('lang="en"');
    // en translation of about.h1
    expect(html).toContain("About the project");
  });

  it("uk / (no lang prefix) → fast path, no HTMLRewriter", async () => {
    const res = await call("/");
    expect(res.status).toBe(200);
    // uk fast path: no __LANG__ injection
    const html = await res.text();
    expect(html).not.toContain("window.__LANG__");
  });
});

describe("per-lang /p/:id", () => {
  it("/en/p/p1 → English chrome + Ukrainian proverb + og:image", async () => {
    const res = await call("/en/p/p1");
    expect(res.status).toBe(200);
    const html = await res.text();
    // English site name in OG meta
    expect(html).toContain("Ukrainian proverbs and sayings");
    // Ukrainian proverb text preserved
    expect(html).toContain("Горе море");
    // OG image card
    expect(html).toContain('og:image');
    expect(html).toContain("/card/p1.png");
    // html lang attribute
    expect(html).toContain('lang="en"');
  });

  it("/p/p1 → Ukrainian page (default lang)", async () => {
    const res = await call("/p/p1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('lang="uk"');
    expect(html).toContain("Горе море");
    expect(html).toContain("/card/p1.png");
  });
});

describe("static assets bypass translation", () => {
  it("/styles.css → passes through (not rewritten)", async () => {
    // The ASSETS mock will 404 for missing files but importantly
    // the worker should pass it through to ASSETS without translating
    const res = await call("/styles.css");
    // It should not error in the worker; ASSETS 404 or 200 both fine
    // Key: response should not contain __LANG__ injection
    const text = await res.text();
    expect(text).not.toContain("window.__LANG__");
  });
});

describe("API endpoints bypass translation", () => {
  it("/api/v1/meta → JSON, no HTMLRewriter applied", async () => {
    const res = await call("/api/v1/meta");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json() as any;
    // meta.json has a total field
    expect(body).toBeDefined();
  });
});
