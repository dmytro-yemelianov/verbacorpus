import { describe, expect, it } from "vitest";
import { handle } from "../src/router.js";
import { openapi } from "../src/openapi.js";

const req = (path: string, init?: RequestInit) => new Request("https://api.test" + path, init);

describe("openapi", () => {
  it("describes every routed path", () => {
    expect(openapi.openapi).toBe("3.1.0");
    for (const p of [
      "/v1/corpora",
      "/v1/{corpus}/meta",
      "/v1/{corpus}/items",
      "/v1/{corpus}/items/{localId}",
      "/v1/items/{globalId}",
      "/v1/{corpus}/random",
      "/v1/random",
      "/v1/cards/{textId}.{ext}",
      "/v1/cards/random.{ext}",
    ]) {
      expect(Object.keys(openapi.paths)).toContain(p);
    }
  });

  it("documents seed stability", () => {
    expect(JSON.stringify(openapi)).toContain("стабільний, доки не змінюється total корпусу");
  });

  it("serves the description at /v1/openapi.json and /v1", async () => {
    for (const path of ["/v1/openapi.json", "/v1"]) {
      const r = await handle(req(path), {});
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("application/json");
      expect(((await r.json()) as any).openapi).toBe("3.1.0");
    }
  });

  it("serves Swagger UI at /v1/docs", async () => {
    const r = await handle(req("/v1/docs"), {});
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("cdn.jsdelivr.net/npm/swagger-ui-dist@5");
    expect(html).toContain("/v1/openapi.json");
  });
});
