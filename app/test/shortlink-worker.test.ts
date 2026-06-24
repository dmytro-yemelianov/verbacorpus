import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

async function call(path: string, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://verbacorpus.org" + path, { headers }), env as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("/s/<n> short-link route", () => {
  it("/s/126 → 301 with Location ending /p/p000126", async () => {
    const res = await call("/s/126");
    expect(res.status).toBe(301);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/\/p\/p000126$/);
  });

  it("/s/0 → 404 (0 is invalid, no leading-zero rule)", async () => {
    const res = await call("/s/0");
    expect(res.status).toBe(404);
  });

  it("/s/abc → 404 (non-numeric)", async () => {
    const res = await call("/s/abc");
    expect(res.status).toBe(404);
  });

  it("/s/<count+1> → 404 (out of range)", async () => {
    // fixture meta.count = 200; 201 > 200
    const res = await call("/s/201");
    expect(res.status).toBe(404);
  });
});

describe("existing routes unaffected by shortlink handler", () => {
  it("/styles.css → passes through ASSETS (no __LANG__ injection)", async () => {
    const res = await call("/styles.css");
    const text = await res.text();
    expect(text).not.toContain("window.__LANG__");
  });

  it("/api/v1/meta → JSON response", async () => {
    const res = await call("/api/v1/meta");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json() as any;
    expect(body).toBeDefined();
  });
});
