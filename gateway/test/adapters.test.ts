import { describe, expect, it } from "vitest";
import { makeNonAdapter } from "../src/adapters/non.js";
import { makeParaAdapter } from "../src/adapters/para.js";
import { makeProAdapter } from "../src/adapters/pro.js";
import { runContractSuite } from "./contract-suite.js";
import { failing, fakeNasinnia, fakeNasinniaFixture, fakePro, fakeUpa, fonts } from "./fakes.js";

runContractSuite("pro", () => makeProAdapter(fakePro()), "p000001");
runContractSuite("non", () => makeNonAdapter(fakeUpa()), "p07_L_b00");
runContractSuite("para", () => makeParaAdapter(fakeNasinniaFixture()), "public-domain-8x8-demo");

describe("adapter specifics", () => {
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
  it("whitelists filters and encodes ids", async () => {
    const seen: string[] = [];
    const up = { fetch: async (r: Request | string) => { seen.push(typeof r === "string" ? r : r.url); return new Response("{}", { status: 404 }); } };
    await makeProAdapter(up).get("a/b c");
    expect(seen[0]).toBe("https://upstream/api/v1/proverb/a%2Fb%20c");
    const up2 = { fetch: async (r: Request | string) => { seen.push(typeof r === "string" ? r : r.url); return new Response(JSON.stringify({ total: 0, results: [] })); } };
    await makeProAdapter(up2).list(5, 0, new URLSearchParams("category=x&evil=1&source=y"));
    expect(seen[1]).toBe("https://upstream/api/v1/query?limit=5&offset=0&category=x&source=y");
  });
  it("upstream 500 becomes 502 upstream_error", async () => {
    await expect(makeProAdapter(failing(500)).list(1, 0, new URLSearchParams())).rejects.toMatchObject({
      status: 502,
      code: "upstream_error",
    });
    await expect(makeNonAdapter(failing(500)).get("x")).rejects.toMatchObject({ status: 502 });
  });
});
