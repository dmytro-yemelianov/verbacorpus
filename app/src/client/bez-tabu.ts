import { filterTabu, spreadTabu, MISSING_TERM, type TabuEntry, type TabuFilters } from "../shared/bez-tabu";
import { buildTabuGraph, ROOT, termId, type TabuNode } from "../shared/tabu-graph";
import { DictionaryGraph } from "./tabu-graph";

const q = document.querySelector<HTMLInputElement>("#tabu-q")!;
// DOM-only tsconfig.corpora.json avoids the legacy Worker HTMLRewriter type collision.
const group = document.getElementById("tabu-group") as unknown as HTMLSelectElement;
const term = document.getElementById("tabu-term") as unknown as HTMLSelectElement;
const kind = document.getElementById("tabu-kind") as unknown as HTMLSelectElement;
const results = document.querySelector<HTMLElement>("#tabu-results")!;
const status = document.querySelector<HTMLElement>("#tabu-status")!;
const more = document.querySelector<HTMLButtonElement>("#tabu-more")!;
const reset = document.querySelector<HTMLButtonElement>("#tabu-reset")!;
let entries: TabuEntry[] = [], filtered: TabuEntry[] = [], shown = 0;
let view: "cards" | "graph" = "cards", graphFocus = ROOT;
let exactSpelling = "";
const graph = new DictionaryGraph(id => { graphFocus = id; writeUrl(); }, showNodeCards);

function filters(): TabuFilters { return { q: q.value, group: group.value, term: term.value, kind: kind.value, spelling: exactSpelling }; }
function writeUrl(): void {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries({ ...filters(), view: view === "graph" ? view : "", node: graphFocus === ROOT ? "" : graphFocus })) {
    value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);
}
function switchView(next: "cards" | "graph", updateUrl = true): void {
  view = next;
  document.querySelector<HTMLElement>("#cards-panel")!.hidden = view !== "cards";
  document.querySelector<HTMLElement>("#graph-panel")!.hidden = view !== "graph";
  document.querySelector("#view-cards")!.setAttribute("aria-pressed", String(view === "cards"));
  document.querySelector("#view-graph")!.setAttribute("aria-pressed", String(view === "graph"));
  if (view === "graph") graph.show();
  updateStatus(); if (updateUrl) writeUrl();
}
function options(select: HTMLSelectElement, values: string[], missing = false): void {
  const current = select.value;
  select.replaceChildren(new Option(select === group ? "Усі групи" : "Усі терміни", ""));
  values.sort((a, b) => a.localeCompare(b, "uk")).forEach(v => select.add(new Option(v, v)));
  if (missing) select.add(new Option("Термін не вказано", MISSING_TERM));
  if (Array.from(select.options).some(o => o.value === current)) select.value = current;
}
function syncTerms(): void {
  const available = entries.filter(e => !group.value || e.group === group.value);
  options(term, [...new Set(available.map(e => e.term).filter(Boolean))], available.some(e => !e.term));
}
function showNodeCards(node: TabuNode): void {
  if (node.kind === "group" || node.kind === "term") {
    group.value = node.group || ""; syncTerms();
    term.value = node.kind === "term" ? (node.term || MISSING_TERM) : "";
  } else if (node.kind === "synonym") {
    group.value = term.value = q.value = ""; syncTerms(); exactSpelling = node.label;
  }
  render(); switchView("cards");
  document.querySelector("#cards-panel")!.scrollIntoView({ block: "start" });
}
function updateStatus(): void {
  status.textContent = filtered.length
    ? view === "cards" ? `Знайдено ${filtered.length} · показано ${shown}` : `${filtered.length} рядків у графі`
    : "За цими умовами нічого не знайдено.";
}
function append(): void {
  const fragment = document.createDocumentFragment();
  for (const entry of filtered.slice(shown, shown + 60)) {
    const card = document.createElement("article"); card.className = "tabu-entry";
    const top = document.createElement("div"); top.className = "tabu-card-top";
    const category = document.createElement("span"); category.className = "tabu-category"; category.title = entry.group;
    category.appendChild(document.createElement("i"));
    const label = document.createElement("span"); label.textContent = entry.group; category.appendChild(label);
    const tag = document.createElement("span"); tag.className = "tabu-form-tag"; tag.textContent = entry.isWord ? "слово" : "вислів";
    top.appendChild(category); top.appendChild(tag);
    const heading = document.createElement("h2"); heading.textContent = entry.synonym;
    const meaning = document.createElement("p"); meaning.className = "tabu-meaning"; meaning.textContent = entry.term || "Термін у джерелі не вказано";
    const bottom = document.createElement("div"); bottom.className = "tabu-card-bottom";
    const row = document.createElement("span"); row.className = "tabu-row"; row.textContent = `№ ${String(entry.sourceRow).padStart(4, "0")}`; row.title = "Номер запису у вихідному CSV";
    const button = document.createElement("button"); button.type = "button"; button.textContent = "Зв’язки ↗";
    button.setAttribute("aria-label", `Зв’язки терміна: ${entry.term || "Термін не вказано"}`);
    button.addEventListener("click", () => {
      graphFocus = termId(entry.group, entry.term); graph.setData(buildTabuGraph(filtered), graphFocus);
      switchView("graph"); document.querySelector("#graph-panel")!.scrollIntoView({ block: "start" });
    });
    bottom.appendChild(row); bottom.appendChild(button);
    card.appendChild(top); card.appendChild(heading); card.appendChild(meaning); card.appendChild(bottom); fragment.appendChild(card);
  }
  shown = Math.min(shown + 60, filtered.length); results.appendChild(fragment);
  if (!filtered.length) { const empty = document.createElement("p"); empty.className = "tabu-empty"; empty.textContent = "Спробуйте інше слово або скиньте фільтри."; results.appendChild(empty); }
  more.hidden = shown >= filtered.length; updateStatus();
}
function render(updateUrl = true): void {
  const exact = document.querySelector<HTMLButtonElement>("#tabu-exact")!;
  exact.hidden = !exactSpelling; exact.textContent = `Точне написання: ${exactSpelling} ×`;
  const active = [group.value, term.value, kind.value].filter(Boolean).length;
  document.querySelector("#tabu-filter-label")!.textContent = active ? `Фільтри (${active})` : "Фільтри";
  filtered = spreadTabu(filterTabu(entries, filters())); shown = 0; results.replaceChildren(); append();
  const data = buildTabuGraph(filtered); if (!data.nodes.has(graphFocus)) graphFocus = ROOT;
  graph.setData(data, graphFocus);
  if (updateUrl) writeUrl();
}
function restore(): void {
  const params = new URL(location.href).searchParams;
  q.value = params.get("q") || ""; group.value = params.get("group") || "";
  syncTerms(); term.value = params.get("term") || ""; kind.value = params.get("kind") || "";
  graphFocus = params.get("node") || ROOT;
  exactSpelling = params.get("spelling") || "";
  view = params.get("view") === "graph" ? "graph" : "cards";
  render(false); switchView(view, false);
}
async function init(): Promise<void> {
  document.querySelector("form")!.addEventListener("submit", e => e.preventDefault());
  const compact = matchMedia("(max-width:620px)");
  const syncDisclosure = (): void => { (document.getElementById("tabu-filter-details") as HTMLDetailsElement).open = !compact.matches; };
  syncDisclosure(); compact.addEventListener("change", syncDisclosure);
  try {
    const response = await fetch("/bez-tabu/data/entries.json");
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json() as { entries: TabuEntry[]; stats: { rows: number; terms: number; groups: number } };
    entries = data.entries;
    document.querySelector("#tabu-stats")!.textContent = `${data.stats.terms} термінів · ${data.stats.groups} груп`;
    options(group, [...new Set(entries.map(e => e.group))]); restore();
    q.disabled = group.disabled = term.disabled = kind.disabled = reset.disabled = false;
    q.addEventListener("input", () => { exactSpelling = ""; render(); });
    group.addEventListener("change", () => { term.value = ""; syncTerms(); graphFocus = ROOT; render(); });
    term.addEventListener("change", () => render()); kind.addEventListener("change", () => render());
    reset.addEventListener("click", () => { q.value = group.value = term.value = kind.value = exactSpelling = ""; graphFocus = ROOT; syncTerms(); render(); q.focus(); });
    document.querySelector("#tabu-exact")!.addEventListener("click", () => { exactSpelling = ""; render(); });
    more.addEventListener("click", append); addEventListener("popstate", restore);
    document.querySelector("#view-cards")!.addEventListener("click", () => switchView("cards"));
    document.querySelector("#view-graph")!.addEventListener("click", () => switchView("graph"));
    document.addEventListener("keydown", e => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !el.closest("input,select,textarea,[contenteditable=true]")) { e.preventDefault(); q.focus(); }
    });
  } catch {
    status.textContent = "Не вдалося завантажити словник. Оновіть сторінку або завантажте CSV нижче.";
  }
}
void init();
