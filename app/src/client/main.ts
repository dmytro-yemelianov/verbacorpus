import MiniSearch from "minisearch";
import { searchProverbs, randomProverb, type Proverb } from "../shared/corpus";

const $ = (id: string) => document.getElementById(id)!;
let all: Proverb[] = [];
let mini: MiniSearch<Proverb>;
let meta: any;
let activeCat = "";
let activeSource = "";
let explanationsCache: Record<string, string> | null = null;

async function boot() {
  [all, meta] = await Promise.all([
    fetch("/data/proverbs.json").then((r) => r.json()),
    fetch("/data/meta.json").then((r) => r.json()),
  ]);
  mini = new MiniSearch<Proverb>({ fields: ["text", "modern_text"], storeFields: ["id"], idField: "id" });
  mini.addAll(all);
  renderFilters();
  render();
  ($("q") as HTMLInputElement).addEventListener("input", debounce(render, 200));
  $("random").addEventListener("click", () => {
    const p = randomProverb(all, { category: activeCat || undefined, source: activeSource || undefined });
    if (p) openDetail(p);
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
}

function renderFilters() {
  const cats = Object.entries(meta.taxonomy as Record<string, string>)
    .map(([k, label]) => `<span class="chip" data-cat="${k}">${escapeHtml(label)}</span>`).join("");
  const srcs = (["Franko1901", "Mlodzynskyi2009", "Ilkevich1841", "Bobkova"])
    .map((s) => `<span class="chip" data-src="${s}">${escapeHtml(s)}</span>`).join("");
  $("filters").innerHTML = cats + srcs;
  $("filters").querySelectorAll<HTMLElement>(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (chip.dataset.cat !== undefined) activeCat = activeCat === chip.dataset.cat ? "" : chip.dataset.cat!;
      if (chip.dataset.src !== undefined) activeSource = activeSource === chip.dataset.src ? "" : chip.dataset.src!;
      $("filters").querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      if (activeCat) $("filters").querySelector(`[data-cat="${activeCat}"]`)?.classList.add("active");
      if (activeSource) $("filters").querySelector(`[data-src="${activeSource}"]`)?.classList.add("active");
      render();
    });
  });
}

function render() {
  const q = ($("q") as HTMLInputElement).value.trim();
  let pool = all;
  if (q) {
    const ids = new Set(mini.search(q, { prefix: true, fuzzy: 0.2 }).map((r) => r.id as string));
    pool = all.filter((p) => ids.has(p.id));
  }
  const { total, results } = searchProverbs(pool, { category: activeCat || undefined, source: activeSource || undefined, limit: 200 });
  $("count").textContent = `Знайдено: ${total}`;
  if (results.length === 0) {
    $("results").innerHTML = `<p>Нічого не знайдено.</p>`;
  } else {
    $("results").innerHTML = results.map((p, i) =>
      `<div class="card" data-i="${i}">${escapeHtml(p.text)}${p.modern_text && p.modern_text !== p.text ? `<div class="modern">${escapeHtml(p.modern_text)}</div>` : ""}<div>${p.category.map((c) => `<span class="badge">${escapeHtml(meta.taxonomy[c] ?? c)}</span>`).join("")}</div></div>`).join("");
    $("results").querySelectorAll<HTMLElement>(".card").forEach((card) =>
      card.addEventListener("click", () => openDetail(results[Number(card.dataset.i)])));
  }
}

async function openDetail(p: Proverb) {
  if (!explanationsCache) {
    explanationsCache = await fetch(`/data/explanations.json`).then((r) => r.json()).catch(() => ({}));
  }
  const expl = explanationsCache ? explanationsCache[p.id] ?? null : null;
  const variants = p.variant_group
    ? all.filter((x) => x.id !== p.id && x.variant_group === p.variant_group)
    : [];
  const dlg = $("detail") as HTMLDialogElement;
  dlg.innerHTML = `<form method="dialog"><h3>${escapeHtml(p.text)}</h3>` +
    (p.modern_text && p.modern_text !== p.text ? `<p><i>${escapeHtml(p.modern_text)}</i></p>` : "") +
    (expl ? `<p>${escapeHtml(expl)}</p>` : "") +
    `<p>${p.category.map((c) => `<span class="badge">${escapeHtml(meta.taxonomy[c] ?? c)}</span>`).join("")} · ${p.sources.map(escapeHtml).join(", ")}</p>` +
    (variants.length > 0 ? `<p><b>Варіанти:</b> ${variants.map((v) => escapeHtml(v.text)).join("; ")}</p>` : "") +
    `<button>Закрити</button></form>`;
  dlg.showModal();
}

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
function debounce(fn: () => void, ms: number) { let t: number; return () => { clearTimeout(t); t = setTimeout(fn, ms) as unknown as number; }; }

boot();
