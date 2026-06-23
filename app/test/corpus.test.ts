import { describe, it, expect } from "vitest";
import { searchProverbs, randomProverb, type Proverb } from "../src/shared/corpus";

const DATA: Proverb[] = [
  { id: "p1", text: "Горе море", modern_text: "Горе море", category: ["fate_luck"], sources: ["Franko1901"], variant_group: "" },
  { id: "p2", text: "Робота кипить", modern_text: "Робота кипить", category: ["work_labor"], sources: ["Bobkova"], variant_group: "" },
  { id: "p3", text: "Робота і горе", modern_text: "Робота і горе", category: ["work_labor", "fate_luck"], sources: ["Bobkova"], variant_group: "" },
];

describe("searchProverbs", () => {
  it("substring over text", () => {
    const r = searchProverbs(DATA, { q: "робота" });
    expect(r.total).toBe(2);
    expect(r.results.map((p) => p.id).sort()).toEqual(["p2", "p3"]);
  });
  it("category + source filters", () => {
    expect(searchProverbs(DATA, { category: "fate_luck" }).total).toBe(2);
    expect(searchProverbs(DATA, { source: "Bobkova" }).total).toBe(2);
    expect(searchProverbs(DATA, { q: "горе", category: "work_labor" }).total).toBe(1);
  });
  it("pagination + limit cap", () => {
    const r = searchProverbs(DATA, { limit: 1, offset: 1 });
    expect(r.total).toBe(3);
    expect(r.results.length).toBe(1);
    expect(searchProverbs(DATA, { limit: 9999 }).results.length).toBe(3); // capped, only 3 exist
  });
});

describe("randomProverb", () => {
  it("honors filter and rnd", () => {
    const p = randomProverb(DATA, { source: "Bobkova" }, () => 0);
    expect(p?.sources).toContain("Bobkova");
    expect(randomProverb([], {})).toBeNull();
  });

  it("samples full filtered pool, not capped to 200", () => {
    // Create an array of 250 proverbs all with source "Bobkova"
    const bigData: Proverb[] = Array.from({ length: 250 }, (_, i) => ({
      id: `p${i}`,
      text: `Proverb ${i}`,
      modern_text: `Modern Proverb ${i}`,
      category: ["test"],
      sources: ["Bobkova"],
      variant_group: "",
    }));

    // With rnd = 0.999, Math.floor(0.999 * 250) = 249, so we should get p249
    const result = randomProverb(bigData, { source: "Bobkova" }, () => 0.999);
    expect(result?.id).toBe("p249");
  });
});
