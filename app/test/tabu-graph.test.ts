import { describe, expect, it } from "vitest";
import { buildTabuGraph, graphNeighbors, graphSlice, ROOT, groupId, termId, synonymId } from "../src/shared/tabu-graph";
import type { TabuEntry } from "../src/shared/bez-tabu";
const entry = (sourceRow: number, group: string, term: string, synonym: string): TabuEntry => ({ sourceRow, group, term, synonym, isWord: true, term_emoji: "" });
describe("dictionary relationships", () => {
  const rows = [entry(2, "Тіло", "А", "біда"), entry(3, "Тіло", "Б", "біда"), entry(4, "Тіло", "Б", "біда"), entry(5, "Вислови", "", "інше")];
  it("connects shared spellings to distinct meanings and preserves repeated source rows", () => {
    const graph = buildTabuGraph(rows), id = synonymId("біда");
    expect(graphNeighbors(graph, id).map(n => n.id)).toEqual([termId("Тіло", "А"), termId("Тіло", "Б")]);
    expect(graph.nodes.get(id)?.rows).toEqual([2, 3, 4]);
    expect(graph.edges.find(e => e.source === termId("Тіло", "Б") && e.target === id)?.rows).toEqual([3, 4]);
    expect(graph.nodes.get(termId("Вислови", ""))?.label).toBe("Термін не вказано");
    expect(graphNeighbors(graph, ROOT)).toHaveLength(2);
  });
  it("pages all neighboring spellings while retaining the parent and focus", () => {
    const graph = buildTabuGraph(Array.from({ length: 40 }, (_, i) => entry(i + 2, "Група", "Термін", `слово ${i}`)));
    const pages = [0, 1, 2, 3].map(p => graphSlice(graph, termId("Група", "Термін"), p));
    expect(pages.map(p => p.nodes.filter(n => n.kind === "synonym").length)).toEqual([12, 12, 12, 4]);
    expect(new Set(pages.flatMap(p => p.nodes.filter(n => n.kind === "synonym").map(n => n.id))).size).toBe(40);
    expect(pages.every(p => p.nodes.some(n => n.id === groupId("Група")))).toBe(true);
    expect(graphSlice(graph, "unknown").focus?.id).toBe(ROOT);
    expect(graphSlice(buildTabuGraph([]), ROOT).nodes).toEqual([]);
  });
});
