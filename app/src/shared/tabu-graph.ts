import type { TabuEntry } from "./bez-tabu";

export type NodeKind = "root" | "group" | "term" | "synonym";
export interface TabuNode { id: string; kind: NodeKind; label: string; rows: number[]; group?: string; term?: string }
export interface TabuEdge { source: string; target: string; rows: number[] }
export interface TabuGraph { nodes: Map<string, TabuNode>; edges: TabuEdge[] }
export const ROOT = "root";
export const groupId = (group: string): string => JSON.stringify(["group", group]);
export const termId = (group: string, term: string): string => JSON.stringify(["term", group, term]);
// Exact spelling is shared across meanings; no inferred synonym-to-synonym links.
export const synonymId = (text: string): string => JSON.stringify(["synonym", text]);

export function buildTabuGraph(entries: TabuEntry[]): TabuGraph {
  const nodes = new Map<string, TabuNode>();
  const edges = new Map<string, TabuEdge>();
  const add = (node: Omit<TabuNode, "rows">, row: number): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, { ...node, rows: [] });
    nodes.get(node.id)!.rows.push(row);
  };
  const link = (source: string, target: string, row: number): void => {
    const id = JSON.stringify([source, target]);
    if (!edges.has(id)) edges.set(id, { source, target, rows: [] });
    edges.get(id)!.rows.push(row);
  };
  for (const e of entries) {
    const g = groupId(e.group), t = termId(e.group, e.term), s = synonymId(e.synonym);
    add({ id: ROOT, kind: "root", label: "Без табу" }, e.sourceRow);
    add({ id: g, kind: "group", label: e.group, group: e.group }, e.sourceRow);
    add({ id: t, kind: "term", label: e.term || "Термін не вказано", group: e.group, term: e.term }, e.sourceRow);
    add({ id: s, kind: "synonym", label: e.synonym }, e.sourceRow);
    link(ROOT, g, e.sourceRow); link(g, t, e.sourceRow); link(t, s, e.sourceRow);
  }
  return { nodes, edges: [...edges.values()] };
}

export function graphNeighbors(graph: TabuGraph, id: string): TabuNode[] {
  const ids = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === id) ids.add(edge.target);
    if (edge.target === id) ids.add(edge.source);
  }
  return [...ids].map(key => graph.nodes.get(key)!).sort((a, b) => {
    const order: Record<NodeKind, number> = { root: 0, group: 1, term: 2, synonym: 3 };
    return order[a.kind] - order[b.kind] || a.label.localeCompare(b.label, "uk");
  });
}

export function graphSlice(graph: TabuGraph, focusId: string, page = 0, size = 12) {
  const focus = graph.nodes.get(focusId) || graph.nodes.get(ROOT);
  if (!focus) return { focus: undefined, nodes: [], edges: [], total: 0, page: 0, pages: 0 };
  const neighbors = graphNeighbors(graph, focus.id);
  const parents = neighbors.filter(n => n.kind === "root" || (focus.kind === "term" && n.kind === "group"));
  const children = neighbors.filter(n => !parents.includes(n));
  const pages = Math.max(1, Math.ceil(children.length / size));
  page = Math.max(0, Math.min(page, pages - 1));
  const nodes = [focus, ...parents, ...children.slice(page * size, (page + 1) * size)];
  const ids = new Set(nodes.map(n => n.id));
  return { focus, nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)), total: children.length, page, pages };
}
