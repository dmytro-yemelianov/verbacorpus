import { describe, it, expect } from "vitest";
import { LANGS } from "../src/shared/i18n";
import ukCat from "../public/i18n/uk.json";

// Every language catalog must have exactly uk's key set, with no empty values.
const CATS: Record<string, Record<string, string>> = {
  uk: ukCat as Record<string, string>,
  en: (await import("../public/i18n/en.json")).default as Record<string, string>,
  de: (await import("../public/i18n/de.json")).default as Record<string, string>,
  fr: (await import("../public/i18n/fr.json")).default as Record<string, string>,
  es: (await import("../public/i18n/es.json")).default as Record<string, string>,
  pl: (await import("../public/i18n/pl.json")).default as Record<string, string>,
  it: (await import("../public/i18n/it.json")).default as Record<string, string>,
  pt: (await import("../public/i18n/pt.json")).default as Record<string, string>,
  ja: (await import("../public/i18n/ja.json")).default as Record<string, string>,
  zh: (await import("../public/i18n/zh.json")).default as Record<string, string>,
};

const ukKeys = Object.keys(ukCat).sort();

describe("catalog completeness", () => {
  it("has a catalog for every LANG", () => {
    for (const l of LANGS) expect(CATS[l], `missing catalog: ${l}`).toBeTruthy();
  });
  for (const lang of LANGS) {
    it(`${lang}: identical key set to uk, no empty values`, () => {
      const cat = CATS[lang];
      expect(Object.keys(cat).sort()).toEqual(ukKeys);
      for (const k of ukKeys) expect(cat[k]?.trim().length, `${lang}.${k} empty`).toBeGreaterThan(0);
    });
  }
});
