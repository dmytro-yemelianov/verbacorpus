import { describe, expect, it } from "vitest";
import { filterTabu, spreadTabu, MISSING_TERM, type TabuEntry } from "../src/shared/bez-tabu";
const rows: TabuEntry[] = [
  { sourceRow: 2, group: "Мова", term: "Термін", synonym: "п’ять слів", isWord: false, term_emoji: "" },
  { sourceRow: 3, group: "Інше", term: "", synonym: "Слово", isWord: true, term_emoji: "" },
  { sourceRow: 4, group: "Інше", term: "", synonym: "Слово", isWord: true, term_emoji: "" },
];
const empty = { q: "", group: "", term: "", kind: "" };
describe("taboo corpus search", () => {
  it("interleaves meanings without dropping repeated source records", () => {
    const input = [rows[1], rows[2], rows[0]];
    expect(spreadTabu(input).map(e => e.sourceRow)).toEqual([3, 2, 4]);
    expect(input.map(e => e.sourceRow)).toEqual([3, 4, 2]);
    expect(spreadTabu([])).toEqual([]);
  });
  it("matches Ukrainian case, apostrophe variants and all query words", () => {
    expect(filterTabu(rows, { ...empty, q: " П'ЯТЬ   МОВА " }).map(e => e.sourceRow)).toEqual([2]);
    expect(filterTabu(rows, { ...empty, q: "п'ять інше" })).toHaveLength(0);
  });
  it("combines filters and keeps unlabelled terms and duplicate source rows", () => {
    expect(filterTabu(rows, { ...empty, term: MISSING_TERM, kind: "word", group: "Інше" }).map(e => e.sourceRow)).toEqual([3, 4]);
    expect(filterTabu(rows, { ...empty, term: MISSING_TERM, kind: "phrase" })).toHaveLength(0);
  });
  it("opens the exact graph spelling without adding substring matches", () => {
    expect(filterTabu([...rows, { ...rows[1], sourceRow: 9, synonym: "Слово інше" }], { ...empty, spelling: "Слово" }).map(e => e.sourceRow)).toEqual([3, 4]);
  });
});
