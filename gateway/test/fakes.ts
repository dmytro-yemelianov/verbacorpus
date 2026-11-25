import type { Upstream } from "../src/adapters/types.js";
import proList from "./fixtures/pro/list.json";
import proMeta from "./fixtures/pro/meta.json";
import nonList from "./fixtures/non/list.json";
import nonOne from "./fixtures/non/one.json";
import nonDescribe from "./fixtures/non/describe.json";
import paraList from "./fixtures/para/list.json";

const FIXTURES: Record<string, any> = {
  "pro/list": proList,
  "pro/meta": proMeta,
  "non/list": nonList,
  "non/one": nonOne,
  "non/describe": nonDescribe,
  "para/list": paraList,
};

export function fixture<T = any>(corpus: string, name: string): T {
  return structuredClone(FIXTURES[`${corpus}/${name}`]) as T;
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const notFound = () => new Response(JSON.stringify({ error: "not found" }), { status: 404 });

function fake(handler: (url: URL) => Response): Upstream {
  return { fetch: async (input) => handler(new URL(typeof input === "string" ? input : input.url)) };
}

export function failing(status: number): Upstream {
  return fake(() => new Response("boom", { status }));
}

export function fakePro(): Upstream {
  const list = fixture("pro", "list");
  return fake((u) => {
    if (u.pathname === "/api/v1/meta") return ok(fixture("pro", "meta"));
    if (u.pathname === "/api/v1/query") {
      const limit = Number(u.searchParams.get("limit") ?? 20);
      const offset = Number(u.searchParams.get("offset") ?? 0);
      return ok({ ...list, limit, offset, results: list.results.slice(offset, offset + limit) });
    }
    const m = u.pathname.match(/^\/api\/v1\/proverb\/(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const hit = list.results.find((r: any) => r.id === id);
      return hit ? ok({ ...hit, explanation: null }) : notFound();
    }
    return notFound();
  });
}

export function fakeUpa(): Upstream {
  const list = fixture("non", "list");
  return fake((u) => {
    if (u.pathname === "/api/v1") return ok(fixture("non", "describe"));
    if (u.pathname === "/api/v1/patterns") {
      const limit = Number(u.searchParams.get("limit") ?? 20);
      const offset = Number(u.searchParams.get("offset") ?? 0);
      return ok({ ...list, limit, offset, items: list.items.slice(offset, offset + limit) });
    }
    const m = u.pathname.match(/^\/api\/v1\/patterns\/(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const one = fixture("non", "one");
      if (one.pattern.patternId === id) return ok(one);
      const hit = list.items.find((r: any) => r.patternId === id);
      return hit ? ok({ apiVersion: "v1", pattern: hit }) : notFound();
    }
    return notFound();
  });
}

export function fonts(n: number): any[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    displayName: `Font ${i}`,
    availability: "downloadable",
    license: { id: "CC0-1.0", redistributionAllowed: true },
  }));
}

// Mirrors the Nasinnia Worker: page/perPage listing, 404 for unknown ids.
export function fakeNasinnia(all: any[]): Upstream {
  return fake((u) => {
    if (u.pathname === "/v1/fonts") {
      const page = Number(u.searchParams.get("page") ?? 1);
      const perPage = Number(u.searchParams.get("perPage") ?? 50);
      return ok({
        data: all.slice((page - 1) * perPage, page * perPage),
        pagination: { page, perPage, total: all.length },
      });
    }
    const m = u.pathname.match(/^\/v1\/fonts\/(.+)$/);
    if (m) {
      const hit = all.find((f) => f.id === decodeURIComponent(m[1]));
      return hit ? ok(hit) : new Response(JSON.stringify({ error: { code: "FONT_NOT_FOUND" } }), { status: 404 });
    }
    return notFound();
  });
}

export function fakeNasinniaFixture(): Upstream {
  return fakeNasinnia(fixture("para", "list").data);
}
