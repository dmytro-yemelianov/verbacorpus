import { describe, it, expect } from "vitest";
import { LANGS, parseLang, t, hreflangLinks } from "../src/shared/i18n";

describe("parseLang", () => {
  it("strips a known lang prefix", () => expect(parseLang("/de/p/p1")).toEqual({ lang: "de", rest: "/p/p1" }));
  it("exact /de", () => expect(parseLang("/de")).toEqual({ lang: "de", rest: "/" }));
  it("no prefix → uk", () => expect(parseLang("/about")).toEqual({ lang: "uk", rest: "/about" }));
  it("root → uk", () => expect(parseLang("/")).toEqual({ lang: "uk", rest: "/" }));
  it("non-lang segment is not a prefix", () => expect(parseLang("/api/v1/meta")).toEqual({ lang: "uk", rest: "/api/v1/meta" }));
});
describe("t", () => {
  const cat = { "a.b": "Привіт" };
  it("hits", () => expect(t(cat, "a.b")).toBe("Привіт"));
  it("falls back to fallback then key", () => { expect(t(cat, "x", "FB")).toBe("FB"); expect(t(cat, "x")).toBe("x"); });
});
describe("hreflangLinks", () => {
  const h = hreflangLinks("/p/p1", "verbacorpus.org");
  it("has all langs + x-default", () => {
    for (const l of LANGS) expect(h).toContain(`hreflang="${l}"`);
    expect(h).toContain('hreflang="x-default"');
    expect(h).toContain('href="https://verbacorpus.org/de/p/p1"');
    expect(h).toContain('href="https://verbacorpus.org/p/p1"'); // uk = unprefixed (x-default + uk)
  });
  it("root case: uk has trailing slash, non-uk has trailing slash", () => {
    const r = hreflangLinks("/", "verbacorpus.org");
    expect(r).toContain('href="https://verbacorpus.org/"');   // uk root
    expect(r).toContain('href="https://verbacorpus.org/en/"'); // en root
    expect(r).toContain('href="https://verbacorpus.org/de/"'); // de root
  });
});
