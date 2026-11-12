import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import preview from "../src/preview";

const password = "local-test-password";
const auth = { authorization: `Basic ${btoa(`preview:${password}`)}` };

describe("private preview", () => {
  for (const path of ["/", "/data/proverbs.json", "/non/upa/assets/catalog.js", "/sw.js"]) {
    it(`protects ${path} before reading assets or services`, async () => {
      const fetch = vi.fn();
      const env = { PREVIEW_PASSWORD: password, ASSETS: { fetch }, UPA: { fetch } } as unknown as Parameters<typeof preview.fetch>[1];
      for (const authorization of ["", "Bearer invalid", `Basic ${btoa("preview:wrong")}`]) {
        const res = await preview.fetch(new Request(`https://preview.test${path}`, { headers: { authorization } }), env, createExecutionContext());
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toContain("Basic");
        expect(res.headers.get("cache-control")).toContain("no-store");
      }
      expect(fetch).not.toHaveBeenCalled();
    });
  }

  it("fails closed without a configured secret", async () => {
    const res = await preview.fetch(new Request("https://preview.test/", { headers: auth }), {} as Parameters<typeof preview.fetch>[1], createExecutionContext());
    expect(res.status).toBe(401);
  });

  it("forwards authenticated assets without credentials and prevents caching", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("asset", { headers: { "cache-control": "public, max-age=3600" } }));
    const env = { PREVIEW_PASSWORD: password, ASSETS: { fetch } } as unknown as Parameters<typeof preview.fetch>[1];
    const res = await preview.fetch(new Request("https://preview.test/data/proverbs.json", { headers: auth }), env, createExecutionContext());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset");
    expect(fetch.mock.calls[0][0].headers.has("authorization")).toBe(false);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toContain("Authorization");
  });

  it("disables the offline service worker for authenticated previews", async () => {
    const res = await preview.fetch(new Request("https://preview.test/sw.js", { headers: auth }), { PREVIEW_PASSWORD: password } as Parameters<typeof preview.fetch>[1], createExecutionContext());
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("unregister");
  });
});
