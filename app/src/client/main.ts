import MiniSearch from "minisearch";
import { type Proverb } from "../shared/corpus";
import { srcLabel } from "../shared/sources";
import { isPresentable, deckFor, toggleSaved, nextShown } from "../shared/browse";
import { prettify } from "../shared/text";
import { LANGS, LANG_NAMES, LANG_FLAGS, parseLang, DEFAULT_LANG } from "../shared/i18n";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let all: Proverb[] = [];
let byId = new Map<string, Proverb>();
let meta: { version?: string; count: number; taxonomy: Record<string, string>; sources: Array<{ key: string; title: string; year: string; author: string; citation?: string }> };
let mini: MiniSearch<Proverb>;
let presentable: Proverb[] = [];
let landingSample: Proverb[] = [];
let explCache: Record<string, string> | null = null;
let activeCat = "";
let activeSource = "";
let semanticMode = false;
let renderSeq = 0;
let saved: string[] = loadSaved();
let savedView = false;

const SOURCE_ORDER = ["Franko1901", "Nomis1864", "Bobkova", "Mlodzynskyi2009", "Ilkevich1841"];

// i18n runtime — populated in boot() before first render
let i18n: Record<string, string> = {};
function tr(key: string, fallback?: string): string { return i18n[key] ?? fallback ?? key; }

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function fmt(n: number): string {
  return n.toLocaleString("uk-UA").replace(/[ ,\s]/g, " ");
}
function catLabel(k: string): string { return tr("cat." + k, meta.taxonomy[k]); }

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

async function share(p: Proverb) {
  const url = `${location.origin}/p/${p.id}`;
  if (navigator.share) { try { await navigator.share({ title: tr("detail.dialogLabel", "Українське прислів'я"), text: p.text, url }); } catch {} return; }
  try { await navigator.clipboard.writeText(`${p.text} — ${url}`); flash(tr("flash.copied", "Скопійовано ✓")); }
  catch { window.open(url, "_blank"); }
}
let flashT: number;
function flash(msg: string) {
  let el = $("flash"); if (!el) { el = document.createElement("div"); el.id = "flash"; el.className = "flash"; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("show"); clearTimeout(flashT);
  flashT = setTimeout(() => el!.classList.remove("show"), 1400) as unknown as number;
}

let deck: Proverb[] = [];
let deckI = 0;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function buildDeck(): Proverb[] {
  const q = ($("q") as HTMLInputElement).value.trim();
  const filtering = !!(q || activeCat || activeSource) && !savedView;
  const base = savedView ? (saved.map((id) => byId.get(id)).filter(Boolean) as Proverb[])
    : filtering ? pageResults : presentable;
  const pool = base.length ? base : presentable;
  return sample(pool, pool.length); // shuffle all
}

function setBackgroundInert(on: boolean) {
  for (const el of Array.from(document.body.children)) {
    if (el.id === "swipe" || el.id === "detail" || el.tagName === "SCRIPT") continue;
    if (on) el.setAttribute("inert", ""); else el.removeAttribute("inert");
  }
}

function openSwipe() {
  deck = buildDeck(); deckI = 0;
  if (!deck.length) return;
  document.body.classList.add("swipe-open");
  const ov = $("swipe"); ov.hidden = false;
  setBackgroundInert(true);
  renderSwipeCard();
  $("swipeClose").focus();
}
function closeSwipe() {
  $("swipe").hidden = true; document.body.classList.remove("swipe-open");
  setBackgroundInert(false);
  $("swipeBtn").focus();
}
function advance(dir: 1 | -1) {
  const card = $("swipeCard");
  const done = () => { deckI++; if (deck.length - deckI < 5) { deck = deck.concat(buildDeck()); } renderSwipeCard(); };
  if (reduceMotion) { done(); return; }
  card.style.transition = "transform .28s ease, opacity .28s ease";
  card.style.transform = `translateX(${dir * 120}%) rotate(${dir * 12}deg)`;
  card.style.opacity = "0";
  setTimeout(() => { card.style.transition = "none"; card.style.transform = ""; card.style.opacity = "1"; done(); }, 280);
}
function saveCurrent() { const p = deck[deckI]; if (p && !isSavedId(p.id)) setSaved(p.id); }

function renderSwipeCard() {
  const p = deck[deckI]; if (!p) { closeSwipe(); return; }
  const inner = $("swipeCard");
  inner.innerHTML =
    `<div class="sw-cat">№&nbsp;${esc(p.id.replace(/^p0*/, ""))}</div>
     <p class="sw-text">${esc(prettify(p.text))}</p>
     ${differs(p) ? `<p class="sw-modern">${esc(prettify(p.modern_text))}</p>` : ""}
     <div class="sw-tags">${p.category.map((c) => `<span class="tag">${esc(catLabel(c))}</span>`).join("")}<span class="tag-src">${esc(p.sources.map(srcLabel).join(" · "))}</span></div>`;
  inner.onclick = () => openDetail(p);
  inner.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(p); } };
  $("swSave").setAttribute("aria-pressed", String(isSavedId(p.id)));
  $("swSave").classList.toggle("on", isSavedId(p.id));
}

function loadSaved(): string[] {
  try { const v = JSON.parse(localStorage.getItem("verba:saved") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function persistSaved() { try { localStorage.setItem("verba:saved", JSON.stringify(saved)); } catch {} }
function isSavedId(id: string): boolean { return saved.includes(id); }
function setSaved(id: string) {
  saved = toggleSaved(saved, id); persistSaved(); updateSavedCount();
  if (savedView) renderSavedView();
}
function updateSavedCount() {
  const b = $("savedBtn"); if (b) b.textContent = tr("saved.label", "♥ Збережені ({n})").replace("{n}", String(saved.length));
}
function renderSavedView() {
  const items = saved.map((id) => byId.get(id)).filter(Boolean) as Proverb[];
  $("count").textContent = tr("saved.count", "Збережено {n}").replace("{n}", String(items.length));
  showResults(items, tr("results.head", "Результати"), false);
}

function langHref(l: string): string {
  // reuse the shared parser to strip any current /<lang>/ prefix
  const { rest } = parseLang(location.pathname);
  if (l === DEFAULT_LANG) return rest || "/"; // uk is unprefixed
  // MUST keep the trailing slash on the root so the URL matches the Worker's
  // run_worker_first `/<lang>/*` routes — bare `/de` falls through to the SPA
  // fallback and serves the untranslated Ukrainian shell.
  return rest === "/" ? `/${l}/` : `/${l}${rest}`;
}

async function boot() {
  const LANG: string = (window as any).__LANG__ || document.documentElement.lang || "uk";

  // Fast first paint: load only the tiny landing sample + meta + i18n. The full
  // 48k-proverb corpus (and its MiniSearch index) loads in the background below.
  // credentials:"omit" so these match the anonymous <link rel=preload> (no double fetch)
  const [i18nData, metaData, landing] = await Promise.all([
    fetch(`/i18n/${LANG}.json`).then((r) => r.json()).catch(() => ({})),
    fetch("/data/meta.json", { credentials: "omit" }).then((r) => r.json()),
    fetch("/data/landing.json", { credentials: "omit" }).then((r) => r.json()),
  ]);
  i18n = i18nData;
  meta = metaData;
  all = landing as Proverb[];
  byId = new Map(all.map((p) => [p.id, p]));
  presentable = all.filter((p) => isPresentable(p.text));
  if (!presentable.length) presentable = all;
  landingSample = sample(presentable, 40);

  // Masthead eyebrow with i18n
  const eyebrowEl = document.querySelector<HTMLElement>(".eyebrow");
  if (eyebrowEl) {
    eyebrowEl.textContent = tr("masthead.eyebrow", "Корпус народної мудрості · {count} записів").replace("{count}", fmt(meta.count));
  }

  // Language switcher in #langSwitch
  const sw = $("langSwitch");
  if (sw) {
    sw.innerHTML = `<details class="lang-menu"><summary aria-label="${esc(LANG_NAMES[LANG] ?? LANG)}"><span class="lang-flag">${LANG_FLAGS[LANG] || "🌐"}</span><span class="lang-code">${esc(LANG.toUpperCase())}</span></summary><ul>` +
      LANGS.map((l) => `<li><a href="${langHref(l)}" hreflang="${l}"${l === LANG ? ' aria-current="true"' : ""}><span class="lang-flag">${LANG_FLAGS[l] || "🌐"}</span><span class="lang-code">${esc(l.toUpperCase())}</span><span class="lang-name">${esc(LANG_NAMES[l])}</span></a></li>`).join("") +
      `</ul></details>`;
    sw.querySelectorAll<HTMLAnchorElement>("a[hreflang]").forEach((a) => {
      a.addEventListener("click", () => {
        try { localStorage.setItem("verba:lang", a.getAttribute("hreflang") || "uk"); } catch {}
      });
    });
  }

  renderColophon();
  renderFilters();
  renderHero();
  renderResults();

  $<HTMLInputElement>("q").addEventListener("input", debounce(() => { savedView = false; $("savedBtn").classList.remove("active"); renderResults(); }, 180));

  const semBtn = $("semToggle") as HTMLButtonElement;
  const syncOnline = () => { if (!navigator.onLine) { semanticMode = false; semBtn.setAttribute("aria-checked", "false"); } semBtn.disabled = !navigator.onLine; };
  syncOnline();
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  semBtn.addEventListener("click", () => {
    if (semBtn.disabled) return;
    semanticMode = !semanticMode;
    semBtn.setAttribute("aria-checked", String(semanticMode));
    savedView = false; $("savedBtn").classList.remove("active");
    renderResults();
  });

  updateSavedCount();
  $("savedBtn").addEventListener("click", () => {
    savedView = !savedView;
    $("savedBtn").classList.toggle("active", savedView);
    if (savedView) renderSavedView(); else renderResults();
  });

  $("swipeBtn").addEventListener("click", openSwipe);
  $("swipeClose").addEventListener("click", closeSwipe);
  $("swSkip").addEventListener("click", () => advance(-1));
  $("swSave").addEventListener("click", () => { saveCurrent(); renderSwipeCard(); advance(1); });
  $("swShare").addEventListener("click", () => { const p = deck[deckI]; if (p) share(p); });
  document.addEventListener("keydown", (e) => {
    if ($("swipe").hidden || $<HTMLDialogElement>("detail").open) return;
    if (e.key === "Escape") closeSwipe();
    else if (e.key === "ArrowRight") { saveCurrent(); renderSwipeCard(); advance(1); }
    else if (e.key === "ArrowLeft") advance(-1);
  });
  // touch / pointer drag
  const card = $("swipeCard");
  let sx = 0, dx = 0, dragging = false;
  card.addEventListener("pointerdown", (e) => { dragging = true; sx = e.clientX; dx = 0; card.style.transition = "none"; card.setPointerCapture(e.pointerId); });
  card.addEventListener("pointermove", (e) => { if (!dragging) return; dx = e.clientX - sx; card.style.transform = `translateX(${dx}px) rotate(${dx / 28}deg)`; });
  card.addEventListener("pointercancel", () => { dragging = false; card.style.transform = ""; });
  card.addEventListener("pointerup", () => {
    if (!dragging) return; dragging = false;
    const threshold = card.offsetWidth * 0.25;
    if (dx > threshold) { saveCurrent(); advance(1); }
    else if (dx < -threshold) advance(-1);
    else { if (!reduceMotion) card.style.transition = "transform .2s ease"; card.style.transform = ""; }
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");

  // Load the full corpus + build the search index off the first-paint path.
  loadFullCorpus();
}

let ready = false; // full corpus + MiniSearch index available

async function loadFullCorpus() {
  let full: Proverb[];
  try {
    full = await fetch("/data/proverbs.json").then((r) => r.json());
  } catch {
    return; // landing sample stays usable; search will report unavailable
  }
  // yield a frame so first paint isn't blocked by the (heavy) indexing below
  await new Promise((r) => setTimeout(r, 0));
  all = full;
  byId = new Map(all.map((p) => [p.id, p]));
  presentable = all.filter((p) => isPresentable(p.text));
  mini = new MiniSearch<Proverb>({ fields: ["text", "modern_text"], storeFields: ["id"], idField: "id" });
  mini.addAll(all);
  ready = true;
  // if the user already searched/filtered while we were loading, re-render with full data
  const q = ($("q") as HTMLInputElement).value.trim();
  if (q || activeCat || activeSource) renderResults();
}

function renderHero() {
  const p = sample(presentable.length ? presentable : all, 1)[0];
  const meta_ = `${p.category.slice(0, 2).map((c) => `<span class="tag">${esc(catLabel(c))}</span>`).join("")}` +
    `<span class="tag-src">${esc(p.sources.map(srcLabel).join(" · "))}</span>`;
  $("hero").innerHTML =
    `<article class="hero-card">
      <div>
        <div class="hero-cat">№&nbsp;${esc(p.id.replace(/^p0*/, ""))} / ${fmt(meta.count)}</div>
        <p class="hero-text">${esc(prettify(p.text))}</p>
        ${differs(p) ? `<p class="hero-modern">${esc(prettify(p.modern_text))}</p>` : ""}
        <div class="hero-meta">${meta_}</div>
      </div>
      <button class="hero-shuffle" id="shuffle" type="button">${esc(tr("hero.shuffle", "Інше прислів'я"))}</button>
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
      savedView = false; $("savedBtn").classList.remove("active");
      renderResults();
    });
  }
}

async function renderResults() {
  const seq = ++renderSeq;
  const q = ($("q") as HTMLInputElement).value.trim();

  if (semanticMode && q) {
    $("count").textContent = tr("results.semanticSearching", "Пошук за змістом…");
    try {
      const url = `/api/semantic?q=${encodeURIComponent(q)}` +
        (activeCat ? `&category=${activeCat}` : "") + (activeSource ? `&source=${activeSource}` : "") + "&limit=100";
      const data = await fetch(url).then((r) => r.json());
      if (seq !== renderSeq) return;
      $("count").textContent = tr("results.semantic", "За змістом: {n}").replace("{n}", fmt(data.total));
      showResults(data.results, tr("results.semanticHead", "За змістом"), true);
    } catch {
      $("count").textContent = "";
      $("results").innerHTML = `<p class="empty">${esc(tr("results.semanticError", "Семантичний пошук недоступний. Спробуйте звичайний пошук."))}</p>`;
    }
    return;
  }

  const filtering = !!(q || activeCat || activeSource);
  if (!filtering) {
    $("count").textContent = tr("count.total", "{n} всього").replace("{n}", fmt(meta.count));
    showResults(landingSample, tr("results.random", "Навмання з корпусу"), false);
    return;
  }
  if (!ready) {
    $("count").textContent = "";
    $("results").innerHTML = `<p class="empty">${esc(tr("results.loading", "Завантаження повного корпусу…"))}</p>`;
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
  $("count").textContent = tr("results.found", "Знайдено {n}").replace("{n}", fmt(resultsAll.length));
  showResults(resultsAll, tr("results.head", "Результати"), false);
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
    $("results").innerHTML = `<p class="empty">${esc(tr("empty.search", "Нічого не знайдено. Спробуйте інше слово або зніміть фільтри."))}</p>`;
    return;
  }
  const page = pageResults.slice(0, shown);
  const more = shown < pageResults.length;
  const randomHead = tr("results.random", "Навмання з корпусу");
  const suffix = pageHead === randomHead ? "" : ` · ${tr("results.shownOf", "{n} з {m}").replace("{n}", fmt(page.length)).replace("{m}", fmt(pageResults.length))}`;
  $("results").innerHTML =
    `<p class="results-head">${esc(pageHead)}${suffix}</p>` +
    page.map((p) =>
      `<article class="entry" data-id="${esc(p.id)}">
        <div class="entry-cat">№&nbsp;${esc(p.id.replace(/^p0*/, ""))}${pageShowScore && p.score !== undefined ? `<br><span class="entry-score">${p.score.toFixed(2)}</span>` : ""}</div>
        <div>
          <div class="entry-text">${esc(prettify(p.text))}</div>
          ${differs(p) ? `<div class="entry-modern">${esc(prettify(p.modern_text))}</div>` : ""}
          <div class="entry-tags">
            ${p.category.map((c) => `<span class="tag">${esc(catLabel(c))}</span>`).join("")}
            <span class="tag-src">${esc(p.sources.map(srcLabel).join(" · "))}</span>
            <button class="entry-save${isSavedId(p.id) ? " on" : ""}" type="button" data-save="${esc(p.id)}" aria-label="${esc(tr("swipe.save", "Зберегти"))}" aria-pressed="${isSavedId(p.id)}">♥</button>
          </div>
        </div>
      </article>`).join("") +
    (more ? `<button id="moreBtn" class="more-btn" type="button">${esc(tr("more.btn", "Показати ще"))}</button>` : "");
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".entry"))) {
    el.addEventListener("click", () => { const p = byId.get(el.dataset.id!); if (p) openDetail(p); });
  }
  for (const b of Array.from(document.querySelectorAll<HTMLElement>(".entry-save"))) {
    b.addEventListener("click", (e) => { e.stopPropagation(); setSaved(b.dataset.save!); if (!savedView) { b.classList.toggle("on"); b.setAttribute("aria-pressed", String(isSavedId(b.dataset.save!))); } });
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
    return s ? esc(s.citation || (s.author ? s.author + ", " : "") + s.title + (s.year ? " (" + s.year + ")" : "")) : esc(srcLabel(k));
  }).join("; ");

  const dlg = $<HTMLDialogElement>("detail");
  dlg.innerHTML =
    `<form method="dialog" class="detail-inner">
      <div class="detail-cat">№&nbsp;${esc(p.id.replace(/^p0*/, ""))}</div>
      <p class="detail-text">${esc(prettify(p.text))}</p>
      ${differs(p) ? `<p class="detail-modern">${esc(prettify(p.modern_text))}</p>` : ""}
      ${expl ? `<div class="detail-expl">${esc(expl)}</div>` : ""}
      ${variants.length ? `<div class="detail-variants"><h4>${esc(tr("detail.variants", "Варіанти"))}</h4><ul>${variants.map((v) => `<li>${esc(prettify(v.text))}</li>`).join("")}</ul></div>` : ""}
      <div class="detail-meta">${p.category.map((c) => `<span class="tag">${esc(catLabel(c))}</span>`).join("")}<span>${cite}</span></div>
      <div class="detail-share"><button class="detail-sharebtn" type="button">${esc(tr("detail.share", "Поділитися"))}</button><a class="detail-cardbtn" href="/card/${esc(p.id)}.png" target="_blank" rel="noopener">${esc(tr("detail.card", "Картка"))}</a></div>
      <button class="detail-close" type="submit" value="close">${esc(tr("detail.close", "Закрити"))}</button>
    </form>`;

  if (navigator.onLine) {
    fetch(`/api/similar/${encodeURIComponent(p.id)}?limit=6`).then((r) => r.json()).then((data) => {
      if (!data.results || !data.results.length) return;
      const form = dlg.querySelector(".detail-inner");
      if (!form) return;
      const sec = document.createElement("div");
      sec.className = "detail-similar";
      sec.innerHTML = `<h4>${esc(tr("detail.similar", "Схожі прислів'я"))}</h4><ul>${data.results.map((s: Proverb) => `<li data-id="${esc(s.id)}">${esc(prettify(s.text))}</li>`).join("")}</ul>`;
      form.insertBefore(sec, form.querySelector(".detail-close"));
      for (const li of Array.from(sec.querySelectorAll<HTMLElement>("li"))) {
        li.addEventListener("click", () => { const sp = byId.get(li.dataset.id!); if (sp) { dlg.close(); openDetail(sp); } });
      }
    }).catch(() => {});
  }

  const sb = dlg.querySelector<HTMLButtonElement>(".detail-sharebtn");
  if (sb) sb.addEventListener("click", () => share(p));
  dlg.showModal();
}

function renderColophon() {
  $("colStat").textContent = tr("colophon.stats", "{count} записів · {sources} джерел · {themes} тем")
    .replace("{count}", fmt(meta.count))
    .replace("{sources}", String(meta.sources.length))
    .replace("{themes}", String(Object.keys(meta.taxonomy).length));
  if (meta.version) {
    $("colVersion").innerHTML =
      `${esc(tr("colophon.version", "Версія даних"))} <a href="https://github.com/dmytro-yemelianov/verbacorpus/releases/tag/v${esc(meta.version)}" rel="noopener">v${esc(meta.version)}</a>`;
  }
  $("colSources").innerHTML = meta.sources.map((s) =>
    `<li><b>${esc(s.author || s.key)}</b> — <i>${esc(s.title)}</i>${s.year ? ", " + esc(s.year) : ""}</li>`).join("");
}

boot();
