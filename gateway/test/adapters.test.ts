import { describe, expect, it } from "vitest";
import { makeContraAdapter } from "../src/adapters/contra.js";
import { makeNonAdapter } from "../src/adapters/non.js";
import { makeParaAdapter } from "../src/adapters/para.js";
import { makeProAdapter } from "../src/adapters/pro.js";
import { runContractSuite } from "./contract-suite.js";
import { failing, fakeNasinnia, fakeNasinniaFixture, fakePro, fakeUpa, fakeVerbaContra, fonts } from "./fakes.js";

runContractSuite("pro", () => makeProAdapter(fakePro()), "p000001");
runContractSuite("non", () => makeNonAdapter(fakeUpa()), "p07_L_b00");
runContractSuite("contra", () => makeContraAdapter(fakeVerbaContra()), "c1a0b1c2d3");
runContractSuite("para", () => makeParaAdapter(fakeNasinniaFixture()), "public-domain-8x8-demo");

describe("adapter specifics", () => {
  it("contra: title, html link and filter passthrough", async () => {
    const a = makeContraAdapter(fakeVerbaContra());
    const r = await a.list(10, 0, new URLSearchParams({ group: "Група Б", junk: "x" }));
    expect(r.total).toBe(2);
    expect(r.items[0].title).toBe("синонім 3 — Термін 3");
    expect(r.items[0].links.html).toBe("https://contra.verbacorpus.org/?q=" + encodeURIComponent("синонім 3"));
    expect(r.items[0].licence.status).toBe("terms-pending");
  });
  it("contra: upstream failure maps to 503", async () => {
    await expect(makeContraAdapter(failing(500)).meta()).rejects.toMatchObject({ status: 503 });
  });

  it("para translates offset into pages", async () => {
    const up = fakeNasinnia(fonts(7));
    const r = await makeParaAdapter(up).list(3, 4, new URLSearchParams());
    expect(r.items.map((i) => i.id)).toEqual(["para:f4", "para:f5", "para:f6"]);
    expect((await makeParaAdapter(up).list(3, 9, new URLSearchParams())).items).toEqual([]);
  });
  it("para marks non-redistributable fonts metadata-only", async () => {
    const up = fakeNasinnia([
      { id: "h1", availability: "metadata-only", license: { id: "x", redistributionAllowed: false } },
    ]);
    const item = (await makeParaAdapter(up).get("h1"))!;
    expect(item.licence.status).toBe("metadata-only");
    expect(item.links.html).toBeNull();
  });
  it("para grants downloadable redistributable fonts", async () => {
    const item = (await makeParaAdapter(fakeNasinniaFixture()).get("public-domain-8x8-demo"))!;
    expect(item.licence).toMatchObject({ id: "CC0-1.0", status: "granted" });
  });
  it("non applies spec licence and keeps native data", async () => {
    const item = (await makeNonAdapter(fakeUpa()).get("p07_L_b00"))!;
    expect(item.licence.status).toBe("terms-pending");
    expect((item.data as any).symmetry.frieze).toBe("p2mm");
    expect(item.links.html).toBe("https://non.verbacorpus.org/upa/catalog?page=7#p07_L_b00");
  });
  it("non builds absolute html link from links.catalog with /upa exactly once", async () => {
    const mk = (pattern: any) => makeNonAdapter({ fetch: async () => new Response(JSON.stringify({ pattern })) });
    const base = { patternId: "p07_L_b00", name: "n", catalogPage: 7 };
    expect((await mk({ ...base, links: { catalog: "/catalog?page=7#p07_L_b00" } }).get("p07_L_b00"))!.links.html).toBe("https://non.verbacorpus.org/upa/catalog?page=7#p07_L_b00");
    expect((await mk({ ...base, links: { catalog: "/upa/catalog?page=7#p07_L_b00" } }).get("p07_L_b00"))!.links.html).toBe("https://non.verbacorpus.org/upa/catalog?page=7#p07_L_b00");
  });
  it("non falls back to catalog#id when links.catalog is absent or catalogPage is null", async () => {
    const mk = (pattern: any) => makeNonAdapter({ fetch: async () => new Response(JSON.stringify({ pattern })) });
    expect((await mk({ patternId: "x1", name: "n", catalogPage: 7 }).get("x1"))!.links.html).toBe("https://non.verbacorpus.org/upa/catalog#x1");
    expect((await mk({ patternId: "x1", name: "n", catalogPage: null, links: { catalog: "/upa/catalog?page=null#x1" } }).get("x1"))!.links.html).toBe("https://non.verbacorpus.org/upa/catalog#x1");
  });
  it("para get returns null unless the returned font id matches", async () => {
    const up = { fetch: async () => new Response(JSON.stringify({ id: "other", displayName: "O" })) };
    expect(await makeParaAdapter(up).get("f1")).toBeNull();
  });
  it("whitelists filters and encodes ids", async () => {
    const seen: string[] = [];
    const up = { fetch: async (r: Request | string) => { seen.push(typeof r === "string" ? r : r.url); return new Response("{}", { status: 404 }); } };
    await makeProAdapter(up).get("a/b c");
    expect(seen[0]).toBe("https://upstream/api/v1/proverb/a%2Fb%20c");
    const up2 = { fetch: async (r: Request | string) => { seen.push(typeof r === "string" ? r : r.url); return new Response(JSON.stringify({ total: 0, results: [] })); } };
    await makeProAdapter(up2).list(5, 0, new URLSearchParams("category=x&evil=1&source=y"));
    expect(seen[1]).toBe("https://upstream/api/v1/query?limit=5&offset=0&category=x&source=y");
  });
  it("upstream 500 becomes 503 unavailable", async () => {
    await expect(makeProAdapter(failing(500)).list(1, 0, new URLSearchParams())).rejects.toMatchObject({
      status: 503,
      code: "unavailable",
    });
    await expect(makeNonAdapter(failing(500)).get("x")).rejects.toMatchObject({ status: 503 });
  });
});

describe("router wiring", () => {
  it("adaptersFor exposes contra through the PRO binding", async () => {
    const { adaptersFor } = await import("../src/router.js");
    expect(adaptersFor({ PRO: fakeVerbaContra() as any }).contra?.corpus).toBe("contra");
    expect(adaptersFor({}).contra).toBeUndefined();
  });
});
