import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import preview from "../src/preview";

describe("open preview", () => {
  for (const path of ["/", "/data/proverbs.json", "/non/upa/assets/catalog.js", "/non/upa/api/v1/patterns"]) {
    it(`serves ${path} without credentials or a password secret`, async () => {
      const fetch = vi.fn().mockImplementation(async () => Response.json({ items: [] }));
      const env = { ASSETS: { fetch }, UPA: { fetch } } as unknown as Parameters<typeof preview.fetch>[1];
      const res = await preview.fetch(new Request(`https://preview.test${path}`), env, createExecutionContext());
      expect(res.status).toBe(200);
      expect(res.headers.has("www-authenticate")).toBe(false);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(fetch).toHaveBeenCalled();
    });
  }

  it("ignores stale Basic credentials cached by the browser", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("asset"));
    const env = { ASSETS: { fetch } } as unknown as Parameters<typeof preview.fetch>[1];
    const res = await preview.fetch(new Request("https://preview.test/data/proverbs.json", {
      headers: { authorization: "Basic obsolete" },
    }), env, createExecutionContext());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset");
    expect(fetch.mock.calls[0][0].headers.has("authorization")).toBe(false);
  });

  it("disables the offline service worker without requiring login", async () => {
    const res = await preview.fetch(new Request("https://preview.test/sw.js"), {} as Parameters<typeof preview.fetch>[1], createExecutionContext());
    expect(res.status).toBe(200);
    expect(res.headers.has("www-authenticate")).toBe(false);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("unregister");
  });
});
