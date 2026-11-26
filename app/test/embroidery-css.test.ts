import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import worker from "../src/index";
import { bandSVG, transpose } from "../src/embroidery-css";
import { fakeUpa, broken } from "./card-fakes";

async function css(extra: Record<string, unknown>) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://example.com/embroidery.css"), { ...env, ...extra } as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const ICONS = ["heart", "link", "image", "moon", "sun", "search", "check", "leaf"];

describe("GET /embroidery.css", () => {
  it("serves UPA bands (a, b, c, vertical) and the 8 UI icons", async () => {
    const calls: string[] = [];
    const res = await css({ UPA: fakeUpa(calls) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    const t = await res.text();
    for (const v of ["--emb-a:", "--emb-b:", "--emb-c:", "--emb-bv:", "--emb-a-rows", "prefers-color-scheme: dark"]) expect(t).toContain(v);
    for (const i of ICONS) expect(t).toContain(`.emb-ico-${i}`);
    expect(calls.length).toBe(3);
  });
  it("without UPA: 200 css, icons only, no band variables, no-store", async () => {
    const res = await css({ UPA: undefined });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const t = await res.text();
    expect(t).not.toContain("--emb-a");
    for (const i of ICONS) expect(t).toContain(`.emb-ico-${i}`);
  });
  it("UPA failure degrades the same way", async () => {
    const res = await css({ UPA: broken });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toContain("--emb-a");
  });
});

describe("bandSVG / transpose", () => {
  const b = { id: "x", rows: 2, cols: 3, cells: [["A", "B", "C"], ["B", "F", "B"]] };
  it("draws UPA palette colours on paper, skipping B", () => {
    const svg = decodeURIComponent(bandSVG(b, true).slice("data:image/svg+xml,".length));
    expect(svg).toContain("fill='#f4f1e8'");
    expect(svg).toContain("fill='#dc143c'");
    expect(svg).toContain("fill='#0047ab'");
    expect(svg).toContain("fill='#e3c20b'");
    expect(svg.match(/<rect/g)!.length).toBe(1 + 3);
    expect(decodeURIComponent(bandSVG(b, false).slice(19))).toContain("fill='#191c16'");
  });
  it("transpose swaps dimensions", () => {
    const t = transpose(b);
    expect([t.rows, t.cols]).toEqual([3, 2]);
    expect(t.cells[1]).toEqual(["B", "F"]);
  });
});

describe("bandSVG dark theme ink", () => {
  const b = { id: "x", rows: 1, cols: 3, cells: [["A", "D", "B"]] };
  it("dark variant draws D in the light ink, never near-black", () => {
    const dark = decodeURIComponent(bandSVG(b, false).slice("data:image/svg+xml,".length));
    expect(dark.toLowerCase()).not.toContain("#0a0a0a");
    expect(dark).toContain("fill='#e9e5d8'");
    const light = decodeURIComponent(bandSVG(b, true).slice("data:image/svg+xml,".length));
    expect(light.toLowerCase()).toContain("#0a0a0a");
  });
  it("the dark blocks of the generated CSS contain no #0A0A0A fill", async () => {
    const t = await (await css({ UPA: fakeUpa() })).text();
    const dark = decodeURIComponent(t.slice(t.indexOf(':root[data-theme="dark"]')).split("@media")[0]);
    expect(dark.toLowerCase()).not.toContain("#0a0a0a");
  });
});

describe("/embroidery.css upstream timeout and edge cache", () => {
  const hang = (calls: { signals: Array<AbortSignal | undefined> }) => ({
    fetch: (_u: any, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      calls.signals.push(init?.signal ?? undefined);
      init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
    }),
  }) as unknown as Fetcher;

  it("a never-resolving UPA still yields 200 minimal CSS once the 3 s timeout fires", async () => {
    const calls = { signals: [] as Array<AbortSignal | undefined> };
    const t0 = Date.now();
    const res = await css({ UPA: hang(calls) });
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(calls.signals.length).toBe(3);
    expect(calls.signals.every(Boolean)).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toContain("--emb-a");
  }, 10000);

  it("the second request is served from the edge cache (query ignored; degraded never stored)", async () => {
    const store = new Map<string, Response>();
    const fakeCache = {
      match: async (r: Request) => store.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => { store.set(r.url, res); },
    };
    vi.stubGlobal("caches", { default: fakeCache });
    try {
      const calls: string[] = [];
      const first = await css({ UPA: fakeUpa(calls) });
      expect(first.headers.get("cache-control")).toBe("public, max-age=86400");
      expect(calls.length).toBe(3);
      expect([...store.keys()]).toEqual(["https://example.com/embroidery.css"]);
      const ctx = createExecutionContext();
      const second = await worker.fetch(new Request("https://example.com/embroidery.css?x=1"), { ...env, UPA: fakeUpa(calls) } as any, ctx);
      await waitOnExecutionContext(ctx);
      expect(second.status).toBe(200);
      expect(calls.length).toBe(3); // no new upstream calls
      store.clear();
      await css({ UPA: undefined });
      expect(store.size).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });
});
