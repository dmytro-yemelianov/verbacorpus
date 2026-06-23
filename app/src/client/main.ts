import MiniSearch from "minisearch";
import { type Proverb } from "../shared/corpus";
import { isPresentable, deckFor, toggleSaved, nextShown } from "../shared/browse";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let all: Proverb[] = [];
let byId = new Map<string, Proverb>();
let meta: { count: number; taxonomy: Record<string, string>; sources: Array<{ key: string; title: string; year: string; author: string }> };
let mini: MiniSearch<Proverb>;
let presentable: Proverb[] = [];
let landingSample: Proverb[] = [];
let explCache: Record<string, string> | null = null;
let activeCat = "";
let activeSource = "";
let semanticMode = false;
let renderSeq = 0;

const SOURCE_LABELS: Record<string, string> = {
  Franko1901: "Франко 1901",
  Nomis1864: "Номис 1864",
  Bobkova: "Бобкова",
  Mlodzynskyi2009: "Млодзинський 2009",
  Ilkevich1841: "Ількевич 1841",
};
const SOURCE_ORDER = ["Franko1901", "Nomis1864", "Bobkova", "Mlodzynskyi2009", "Ilkevich1841"];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function fmt(n: number): string {
  return n.toLocaleString("uk-UA").replace(/[ ,\s]/g, " ");
}
// Ukrainian plural: forms = [one, few (2–4), many (0,5–20)]
function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
function catLabel(k: string): string { return meta.taxonomy[k] ?? k; }
function srcLabel(k: string): string { return SOURCE_LABELS[k] ?? k; }

function differs(p: Proverb): boolean {
  return !!p.modern_text && p.modern_text.trim() !== p.text.trim();
}
function sample<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
function debounce(fn: () => void, ms: number) {
  let t: number;
  return () => { clearTimeout(t); t = setTimeout(fn, ms) as unknown as number; };
}

async function boot() {
  const [proverbs, metaData] = await Promise.all([
    fetch("/data/proverbs.json").then((r) => r.json()),
    fetch("/data/meta.json").then((r) => r.json()),
  ]);
  all = proverbs;
  byId = new Map(all.map((p) => [p.id, p]));
  meta = metaData;
  presentable = all.filter((p) => isPresentable(p.text));
  landingSample = sample(presentable.length ? presentable : all, 40);
  mini = new MiniSearch<Proverb>({ fields: ["text", "modern_text"], storeFields: ["id"], idField: "id" });
  mini.addAll(all);

  $("mastCount").textContent = fmt(meta.count);
  renderColophon();
  renderFilters();
  renderHero();
  renderResults();

  $<HTMLInputElement>("q").addEventListener("input", debounce(renderResults, 180));

  const semBtn = $("semToggle") as HTMLButtonElement;
  const syncOnline = () => { if (!navigator.onLine) { semanticMode = false; semBtn.setAttribute("aria-checked", "false"); } semBtn.disabled = !navigator.onLine; };
  syncOnline();
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  semBtn.addEventListener("click", () => {
    if (semBtn.disabled) return;
    semanticMode = !semanticMode;
    semBtn.setAttribute("aria-checked", String(semanticMode));
    renderResults();
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
}

function renderHero() {
  const p = sample(presentable.length ? presentable : all, 1)[0];
  const meta_ = `${p.category.slice(0, 2).map((c) => `<span class="tag">${esc(catLabel(c))}</span>`).join("")}` +
    `<span class="tag-src">${esc(p.sources.map(srcLabel).join(" · "))}</span>`;
  $("hero").innerHTML =
    `<article class="hero-card">
      <div>
        <div class="hero-cat">№&nbsp;${esc(p.id.replace(/^p0*/, ""))} / ${fmt(meta.count)}</div>
        <p class="hero-text">${esc(p.text)}</p>
        ${differs(p) ? `<p class="hero-modern">${esc(p.modern_text)}</p>` : ""}
        <div class="hero-meta">${meta_}</div>
      </div>
      <button class="hero-shuffle" id="shuffle" type="button">Інше&nbsp;прислів'я</button>
    </article>`;
  $("shuffle").addEventListener("click", renderHero);
  $("hero").querySelector<HTMLElement>(".hero-card")!.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".hero-shuffle")) openDetail(p);
  });
}

function renderFilters() {
  $("sources").innerHTML = SOURCE_ORDER
    .map((s) => `<button class="chip" type="button" data-src="${s}">${esc(srcLabel(s))}</button>`).join("");
  $("themes").innerHTML = Object.keys(meta.taxonomy)
    .map((k) => `<button class="chip" type="button" data-cat="${k}">${esc(catLabel(k))}</button>`).join("");
  for (const chip of Array.from(document.querySelectorAll<HTMLElement>(".chip"))) {
    chip.addEventListener("click", () => {
      const cat = chip.dataset.cat, src = chip.dataset.src;
      if (cat !== undefined) activeCat = activeCat === cat ? "" : cat;
      if (src !== undefined) activeSource = activeSource === src ? "" : src;
      for (const c of Array.from(document.querySelectorAll<HTMLElement>(".chip"))) {
        c.classList.toggle("active", (c.dataset.cat !== undefined && c.dataset.cat === activeCat) || (c.dataset.src !== undefined && c.dataset.src === activeSource));
      }
      $("themeActive").textContent = activeCat ? "· " + catLabel(activeCat) : "";
      renderResults();
    });
  }
}

async function renderResults() {
  const seq = ++renderSeq;
  const q = ($("q") as HTMLInputElement).value.trim();

  if (semanticMode && q) {
    $("count").textContent = "Пошук за змістом…";
    try {
      const url = `/api/semantic?q=${encodeURIComponent(q)}` +
        (activeCat ? `&category=${activeCat}` : "") + (activeSource ? `&source=${activeSource}` : "") + "&limit=100";
      const data = await fetch(url).then((r) => r.json());
      if (seq !== renderSeq) return;
      $("count").textContent = `За змістом: ${fmt(data.total)}`;
      showResults(data.results, "За змістом", true);
    } catch {
      $("count").textContent = "";
      $("results").innerHTML = `<p class="empty">Семантичний пошук недоступний. Спробуйте звичайний пошук.</p>`;
    }
    return;
  }

  const filtering = !!(q || activeCat || activeSource);
  if (!filtering) {
    $("count").textContent = `${fmt(meta.count)} всього`;
    showResults(landingSample, "Навмання з корпусу", false);
    return;
  }
  let pool = all;
  if (q) {
    const ids = new Set(mini.search(q, { prefix: true, fuzzy: 0.2 }).map((r) => r.id as string));
    pool = all.filter((p) => ids.has(p.id));
  }
  let resultsAll = pool;
  if (activeCat) resultsAll = resultsAll.filter((p) => p.category.includes(activeCat));
  if (activeSource) resultsAll = resultsAll.filter((p) => p.sources.includes(activeSource));
  $("count").textContent = `Знайдено ${fmt(resultsAll.length)}`;
  showResults(resultsAll, "Результати", false);
}

let pageResults: Array<Proverb & { score?: number }> = [];
let pageHead = "";
let pageShowScore = false;
let shown = 80;
const STEP = 80;

function showResults(results: Array<Proverb & { score?: number }>, head: string, showScore: boolean) {
  pageResults = results; pageHead = head; pageShowScore = showScore; shown = Math.min(STEP, results.length || STEP);
  renderPage();
}

function renderPage() {
  if (!pageResults.length) {
    $("results").innerHTML = `<p class="empty">Нічого не знайдено. Спробуйте інше слово або зніміть фільтри.</p>`;
    return;
  }
  const page = pageResults.slice(0, shown);
  const more = shown < pageResults.length;
  $("results").innerHTML =
    `<p class="results-head">${esc(pageHead)} · показано ${fmt(page.length)} з ${fmt(pageResults.length)}</p>` +
    page.map((p) =>
      `<article class="entry" data-id="${esc(p.id)}">
        <div class="entry-cat">№&nbsp;${esc(p.id.replace(/^p0*/, ""))}${pageShowScore && p.score !== undefined ? `<br><span class="entry-score">${p.score.toFixed(2)}</span>` : ""}</div>
        <div>
          <div class="entry-text">${esc(p.text)}</div>
          ${differs(p) ? `<div class="entry-modern">${esc(p.modern_text)}</div>` : ""}
          <div class="entry-tags">
            ${p.category.map((c) => `<span class="tag">${esc(catLabel(c))}</span>`).join("")}
            <span class="tag-src">${esc(p.sources.map(srcLabel).join(" · "))}</span>
          </div>
        </div>
      </article>`).join("") +
    (more ? `<button id="moreBtn" class="more-btn" type="button">Показати ще</button>` : "");
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".entry"))) {
    el.addEventListener("click", () => { const p = byId.get(el.dataset.id!); if (p) openDetail(p); });
  }
  const moreBtn = $("moreBtn") as HTMLButtonElement | null;
  if (moreBtn) moreBtn.addEventListener("click", () => { shown = nextShown(shown, STEP, pageResults.length); renderPage(); });
}

async function openDetail(p: Proverb) {
  if (!explCache) {
    explCache = await fetch("/data/explanations.json").then((r) => r.json()).catch(() => ({}));
  }
  const expl = explCache![p.id];
  const variants = p.variant_group
    ? all.filter((x) => x.variant_group === p.variant_group && x.id !== p.id).slice(0, 12)
    : [];
  const cite = p.sources.map((k) => {
    const s = meta.sources.find((m) => m.key === k);
    return s ? `${s.author ? esc(s.author) + ", " : ""}<i>${esc(s.title)}</i>${s.year ? " (" + esc(s.year) + ")" : ""}` : esc(srcLabel(k));
  }).join("; ");

  const dlg = $<HTMLDialogElement>("detail");
  dlg.innerHTML =
    `<form method="dialog" class="detail-inner">
      <div class="detail-cat">№&nbsp;${esc(p.id.replace(/^p0*/, ""))}</div>
      <p class="detail-text">${esc(p.text)}</p>
      ${differs(p) ? `<p class="detail-modern">${esc(p.modern_text)}</p>` : ""}
      ${expl ? `<div class="detail-expl">${esc(expl)}</div>` : ""}
      ${variants.length ? `<div class="detail-variants"><h4>Варіанти</h4><ul>${variants.map((v) => `<li>${esc(v.text)}</li>`).join("")}</ul></div>` : ""}
      <div class="detail-meta">${p.category.map((c) => `<span class="tag">${esc(catLabel(c))}</span>`).join("")}<span>${cite}</span></div>
      <button class="detail-close" type="submit" value="close">Закрити</button>
    </form>`;

  if (navigator.onLine) {
    fetch(`/api/similar/${encodeURIComponent(p.id)}?limit=6`).then((r) => r.json()).then((data) => {
      if (!data.results || !data.results.length) return;
      const form = dlg.querySelector(".detail-inner");
      if (!form) return;
      const sec = document.createElement("div");
      sec.className = "detail-similar";
      sec.innerHTML = `<h4>Схожі прислів'я</h4><ul>${data.results.map((s: Proverb) => `<li data-id="${esc(s.id)}">${esc(s.text)}</li>`).join("")}</ul>`;
      form.insertBefore(sec, form.querySelector(".detail-close"));
      for (const li of Array.from(sec.querySelectorAll<HTMLElement>("li"))) {
        li.addEventListener("click", () => { const sp = byId.get(li.dataset.id!); if (sp) { dlg.close(); openDetail(sp); } });
      }
    }).catch(() => {});
  }

  dlg.showModal();
}

function renderColophon() {
  $("colStat").textContent =
    `${fmt(meta.count)} ${plural(meta.count, ["запис", "записи", "записів"])} · ` +
    `${meta.sources.length} ${plural(meta.sources.length, ["джерело", "джерела", "джерел"])} · ` +
    `${Object.keys(meta.taxonomy).length} ${plural(Object.keys(meta.taxonomy).length, ["тема", "теми", "тем"])}`;
  $("colSources").innerHTML = meta.sources.map((s) =>
    `<li><b>${esc(s.author || s.key)}</b> — <i>${esc(s.title)}</i>${s.year ? ", " + esc(s.year) : ""}</li>`).join("");
}

boot();
