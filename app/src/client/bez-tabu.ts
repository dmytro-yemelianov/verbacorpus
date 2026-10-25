import { filterTabu, MISSING_TERM, type TabuEntry, type TabuFilters } from "../shared/bez-tabu";

const q = document.querySelector<HTMLInputElement>("#tabu-q")!;
// The legacy project-wide config mixes Worker HTMLRewriter and DOM Element types.
// This browser entry is also checked with DOM-only tsconfig.corpora.json.
const group = document.getElementById("tabu-group") as unknown as HTMLSelectElement;
const term = document.getElementById("tabu-term") as unknown as HTMLSelectElement;
const kind = document.getElementById("tabu-kind") as unknown as HTMLSelectElement;
const results = document.querySelector<HTMLElement>("#tabu-results")!;
const status = document.querySelector<HTMLElement>("#tabu-status")!;
const more = document.querySelector<HTMLButtonElement>("#tabu-more")!;
const reset = document.querySelector<HTMLButtonElement>("#tabu-reset")!;
let entries: TabuEntry[] = [], filtered: TabuEntry[] = [], shown = 0;

function filters(): TabuFilters {
  return { q: q.value, group: group.value, term: term.value, kind: kind.value };
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
function append(): void {
  const fragment = document.createDocumentFragment();
  for (const entry of filtered.slice(shown, shown + 60)) {
    const card = document.createElement("article"); card.className = "tabu-entry";
    const heading = document.createElement("h2"); heading.textContent = entry.synonym;
    const description = document.createElement("p"); description.textContent = entry.term || "Термін у джерелі не вказано";
    const meta = document.createElement("p"); meta.className = "corpus-meta";
    meta.textContent = `${entry.group} · ${entry.isWord ? "слово" : "словосполучення"} · рядок ${entry.sourceRow}`;
    card.appendChild(heading); card.appendChild(description); card.appendChild(meta); fragment.appendChild(card);
  }
  shown = Math.min(shown + 60, filtered.length);
  results.appendChild(fragment);
  more.hidden = shown >= filtered.length;
  status.textContent = filtered.length ? `Знайдено ${filtered.length} · показано ${shown}` : "За цими умовами нічого не знайдено.";
}
function render(updateUrl = true): void {
  const state = filters();
  filtered = filterTabu(entries, state); shown = 0; results.replaceChildren(); append();
  if (updateUrl) {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(state)) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    history.replaceState(null, "", url);
  }
}
function restore(): void {
  const params = new URL(location.href).searchParams;
  q.value = params.get("q") || ""; group.value = params.get("group") || "";
  syncTerms(); term.value = params.get("term") || ""; kind.value = params.get("kind") || "";
  render(false);
}

async function init(): Promise<void> {
  document.querySelector("form")!.addEventListener("submit", e => e.preventDefault());
  try {
    const response = await fetch("/bez-tabu/data/entries.json");
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json() as { entries: TabuEntry[]; stats: { rows: number; terms: number; groups: number } };
    entries = data.entries;
    document.querySelector("#tabu-stats")!.textContent = `${data.stats.rows.toLocaleString("uk")} рядків · ${data.stats.terms} термінів · ${data.stats.groups} груп`;
    options(group, [...new Set(entries.map(e => e.group))]);
    restore();
    q.disabled = group.disabled = term.disabled = kind.disabled = reset.disabled = false;
    q.addEventListener("input", () => render());
    group.addEventListener("change", () => { term.value = ""; syncTerms(); render(); });
    term.addEventListener("change", () => render()); kind.addEventListener("change", () => render());
    reset.addEventListener("click", () => { q.value = group.value = term.value = kind.value = ""; syncTerms(); render(); q.focus(); });
    more.addEventListener("click", append); addEventListener("popstate", restore);
  } catch {
    status.textContent = "Не вдалося завантажити словник. Оновіть сторінку або завантажте CSV нижче.";
  }
}
void init();
