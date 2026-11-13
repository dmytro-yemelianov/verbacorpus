import { graphNeighbors, graphSlice, ROOT, type TabuGraph, type TabuNode, type NodeKind } from "../shared/tabu-graph";

const NS = "http://www.w3.org/2000/svg";
const labels: Record<NodeKind, string> = { root: "Словник", group: "Тематична група", term: "Термін", synonym: "Відповідник" };
function countText(n: number, kind: "rows" | "nodes"): string {
  const forms = kind === "rows" ? ["рядок", "рядки", "рядків"] : ["вузол", "вузли", "вузлів"];
  const last = n % 10, teen = n % 100;
  return `${n} ${forms[last === 1 && teen !== 11 ? 0 : last >= 2 && last <= 4 && (teen < 12 || teen > 14) ? 1 : 2]}`;
}
interface Point { x: number; y: number; w: number; h: number }
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}
function lines(text: string, length: number): string[] {
  const result: string[] = []; let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > length) { result.push(line); line = word; }
    else line += (line ? " " : "") + word;
  }
  if (line) result.push(line);
  return result.slice(0, 3).map((line, i) => i === 2 && result.length > 3 ? line.slice(0, length - 1) + "…" : line);
}

export class DictionaryGraph {
  private graph: TabuGraph = { nodes: new Map(), edges: [] };
  private focus = ROOT;
  private history: string[] = [];
  private page = 0;
  private canvas = document.querySelector<SVGSVGElement>("#tabu-graph")!;
  private viewport = document.querySelector<HTMLElement>("#graph-viewport")!;
  private positions = new Map<string, Point>();
  private nodeElements = new Map<string, SVGGElement>();
  private edgeElements: { line: SVGPathElement; source: string; target: string }[] = [];
  private world = { w: 900, h: 640 };
  private camera = { x: 0, y: 0, zoom: 1 };
  private gesture?: { id?: string; startX: number; startY: number; x: number; y: number; moved: boolean; pointer: number };
  private lastWidth = 0;

  constructor(private onFocus: (id: string) => void, private onCards: (node: TabuNode) => void) {
    document.querySelector("#graph-home")!.addEventListener("click", () => this.navigate(ROOT));
    document.querySelector("#graph-back")!.addEventListener("click", () => {
      const id = this.history.pop(); if (id) this.navigate(id, false);
    });
    document.querySelector("#graph-prev")!.addEventListener("click", () => { this.page--; this.draw(); });
    document.querySelector("#graph-next")!.addEventListener("click", () => { this.page++; this.draw(); });
    document.querySelector("#graph-zoom-in")!.addEventListener("click", () => this.zoom(1.25));
    document.querySelector("#graph-zoom-out")!.addEventListener("click", () => this.zoom(.8));
    document.querySelector("#graph-fit")!.addEventListener("click", () => { this.camera = { x: 0, y: 0, zoom: 1 }; this.viewBox(); });
    document.querySelector("#graph-cards")!.addEventListener("click", () => {
      const node = this.graph.nodes.get(this.focus); if (node) this.onCards(node);
    });
    this.canvas.addEventListener("pointerdown", e => this.pointerDown(e));
    this.canvas.addEventListener("pointermove", e => this.pointerMove(e));
    const end = (e: PointerEvent): void => {
      const gesture = this.gesture;
      if (!gesture || gesture.pointer !== e.pointerId) return;
      this.gesture = undefined;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      if (e.type === "pointerup" && gesture.id && !gesture.moved) this.navigate(gesture.id);
    };
    this.canvas.addEventListener("pointerup", end); this.canvas.addEventListener("pointercancel", end);
    this.canvas.addEventListener("wheel", e => {
      // Ordinary scrolling still scrolls the page; Ctrl/⌘ + wheel zooms the graph.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    new ResizeObserver(() => {
      const width = this.viewport.clientWidth;
      if (width && Math.abs(width - this.lastWidth) > 8) { this.lastWidth = width; this.draw(); }
    }).observe(this.viewport);
  }

  setData(graph: TabuGraph, focus: string): void {
    this.graph = graph; this.focus = graph.nodes.has(focus) ? focus : ROOT;
    this.history = []; this.page = 0; this.draw();
  }
  show(): void { this.draw(); }
  private navigate(id: string, remember = true): void {
    if (!this.graph.nodes.has(id) || id === this.focus) return;
    if (remember) this.history.push(this.focus);
    this.focus = id; this.page = 0; this.onFocus(id); this.draw();
    document.querySelector<HTMLElement>("#graph-heading")!.focus({ preventScroll: true });
  }
  private zoom(factor: number): void {
    const previous = this.camera.zoom, next = Math.min(2.5, Math.max(.6, previous * factor));
    this.camera.x += this.world.w / previous / 2 - this.world.w / next / 2;
    this.camera.y += this.world.h / previous / 2 - this.world.h / next / 2;
    this.camera.zoom = next; this.viewBox();
  }
  private viewBox(): void {
    this.canvas.setAttribute("viewBox", `${this.camera.x} ${this.camera.y} ${this.world.w / this.camera.zoom} ${this.world.h / this.camera.zoom}`);
  }
  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const node = (e.target as Element).closest<SVGGElement>("[data-node]");
    const id = node?.dataset.node, p = id ? this.positions.get(id) : undefined;
    this.gesture = { id, startX: e.clientX, startY: e.clientY, x: p?.x ?? this.camera.x, y: p?.y ?? this.camera.y, moved: false, pointer: e.pointerId };
    this.canvas.setPointerCapture(e.pointerId);
  }
  private pointerMove(e: PointerEvent): void {
    const g = this.gesture; if (!g || e.pointerId !== g.pointer) return;
    const box = this.canvas.getBoundingClientRect();
    const dx = (e.clientX - g.startX) * this.world.w / box.width / this.camera.zoom;
    const dy = (e.clientY - g.startY) * this.world.h / box.height / this.camera.zoom;
    if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 5) g.moved = true;
    if (!g.moved) return;
    if (g.id) {
      const p = this.positions.get(g.id)!; p.x = g.x + dx; p.y = g.y + dy;
      this.nodeElements.get(g.id)!.setAttribute("transform", `translate(${p.x},${p.y})`); this.edges();
    } else { this.camera.x = g.x - dx; this.camera.y = g.y - dy; this.viewBox(); }
  }
  private edges(): void {
    for (const e of this.edgeElements) {
      const a = this.positions.get(e.source)!, b = this.positions.get(e.target)!;
      const bend = (b.y - a.y) * .16;
      e.line.setAttribute("d", `M${a.x},${a.y} Q${(a.x + b.x) / 2 + bend},${(a.y + b.y) / 2} ${b.x},${b.y}`);
    }
  }
  private layout(nodes: TabuNode[], mobile: boolean): void {
    const { w, h } = this.world;
    this.positions.clear();
    nodes.forEach((n, i) => {
      const angle = (i - 1) / Math.max(1, nodes.length - 1) * Math.PI * 2 - Math.PI / 2;
      this.positions.set(n.id, mobile
        ? { x: i ? (i % 2 ? w * .25 : w * .75) : w / 2, y: i ? 210 + Math.floor((i - 1) / 2) * 125 : 72, w: i ? w * .44 : w * .6, h: 90 }
        : { x: i ? w / 2 + Math.cos(angle) * 330 : w / 2, y: i ? h / 2 + Math.sin(angle) * 240 : h / 2, w: i ? 168 : 196, h: 88 });
    });
    if (mobile) return;
    // Dense neighborhoods use spaced perimeter slots so labels never overlap.
    if (nodes.length > 11) {
      const slots = [[130,60],[345,60],[560,60],[775,60],[800,190],[800,320],[800,450],[775,580],[560,580],[345,580],[130,580],[100,450],[100,320],[100,190]];
      nodes.slice(1).forEach((node, i) => {
        const [x, y] = slots[Math.floor(i * slots.length / (nodes.length - 1))];
        Object.assign(this.positions.get(node.id)!, { x, y });
      });
    }
  }
  private draw(): void {
    const mobile = !!this.viewport.clientWidth && this.viewport.clientWidth < 560;
    this.world = { w: mobile ? Math.max(300, this.viewport.clientWidth) : 900, h: mobile ? 650 : 640 };
    const slice = graphSlice(this.graph, this.focus, this.page, mobile ? 6 : 12);
    this.page = slice.page;
    this.canvas.replaceChildren(); this.nodeElements.clear(); this.edgeElements = [];
    this.camera = { x: 0, y: 0, zoom: 1 }; this.viewBox();
    this.viewport.classList.toggle("is-mobile", mobile);
    this.canvas.setAttribute("aria-label", slice.focus ? `Зв’язки: ${slice.focus.label}` : "Немає зв’язків за цими фільтрами");
    this.layout(slice.nodes, mobile);
    for (const edge of slice.edges) {
      const path = svg("path", { class: "graph-edge", "stroke-width": String(Math.min(3, 1 + Math.log2(edge.rows.length + 1) * .25)) });
      this.canvas.appendChild(path); this.edgeElements.push({ line: path, ...edge });
    }
    this.edges();
    for (const node of slice.nodes) {
      const p = this.positions.get(node.id)!;
      const element = svg("g", { class: `graph-node node-${node.kind}${node.id === this.focus ? " is-focus" : ""}`, transform: `translate(${p.x},${p.y})`, role: "button", tabindex: "0", "aria-label": `${labels[node.kind]}: ${node.label}, ${countText(node.rows.length, "rows")}` });
      element.dataset.node = node.id;
      const title = svg("title"); title.textContent = node.label; element.appendChild(title);
      element.appendChild(svg("rect", { x: String(-p.w / 2), y: String(-p.h / 2), width: String(p.w), height: String(p.h), rx: "12" }));
      const text = svg("text", { "text-anchor": "middle", class: "graph-node-label" });
      const wrapped = lines(node.label, mobile ? 18 : 23);
      wrapped.forEach((line, i) => { const span = svg("tspan", { x: "0", y: String(-15 + i * 16) }); span.textContent = line; text.appendChild(span); });
      element.appendChild(text);
      const count = svg("text", { "text-anchor": "middle", y: "33", class: "graph-node-count" }); count.textContent = countText(node.rows.length, "rows"); element.appendChild(count);
      element.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.navigate(node.id); } });
      this.canvas.appendChild(element); this.nodeElements.set(node.id, element);
    }
    document.querySelector("#graph-heading")!.textContent = slice.focus?.label || "Немає результатів";
    document.querySelector("#graph-kind")!.textContent = slice.focus ? labels[slice.focus.kind] : "Граф зв’язків";
    document.querySelector("#graph-summary")!.textContent = slice.focus ? `${countText(slice.focus.rows.length, "rows")} джерела · ${countText(graphNeighbors(this.graph, this.focus).length, "nodes")}` : "Змініть пошук або скиньте фільтри.";
    (document.querySelector("#graph-back") as HTMLButtonElement).disabled = !this.history.length;
    (document.querySelector("#graph-cards") as HTMLButtonElement).disabled = !slice.focus;
    (document.querySelector("#graph-prev") as HTMLButtonElement).disabled = !slice.page;
    (document.querySelector("#graph-next") as HTMLButtonElement).disabled = slice.page + 1 >= slice.pages;
    document.querySelector("#graph-page")!.textContent = slice.total ? `${slice.page + 1} / ${slice.pages} · ${countText(slice.total, "nodes")}` : "0 вузлів";
    const related = document.querySelector("#graph-neighbors")!; related.replaceChildren();
    for (const node of slice.nodes.slice(1)) {
      const button = document.createElement("button"); button.type = "button"; button.className = `graph-related node-${node.kind}`;
      button.textContent = node.label; button.addEventListener("click", () => this.navigate(node.id)); related.appendChild(button);
    }
  }
}
