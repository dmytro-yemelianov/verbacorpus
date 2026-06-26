import { type Proverb } from "./corpus";
import { prettify } from "./text";
import { t, hreflangLinks, DEFAULT_LANG } from "./i18n";
import { srcLabel } from "./sources";
import { shortUrl } from "./shortlink";
import { qrDataUri } from "./qr";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export type CardModel = { text: string; modern: string; footer: string; qr: string; shortUrl: string };

const num = (id: string) => id.replace(/^p0*/, "");

export function cardModel(p: Proverb & { explanation?: string | null }, opts: { host: string; maxLen?: number; lang?: string }): CardModel {
  const max = opts.maxLen ?? 160;
  const raw = prettify(p.text);
  const text = raw.length > max ? raw.slice(0, max) + "…" : raw;
  const modern = p.modern_text && p.modern_text.trim() !== p.text.trim() ? prettify(p.modern_text) : "";
  const su = shortUrl(p.id, opts.host);
  const lang = opts.lang || "uk";
  const numPrefix = lang === "uk" ? "№" : "No. ";
  const footer = [...p.sources.map(srcLabel), `${numPrefix}${num(p.id)}`, su.replace(/^https:\/\//, "")].join(" · ");
  const qr = qrDataUri(su, { module: 4, margin: 2, light: "#f4f1e8" });
  return { text, modern, footer, qr, shortUrl: su };
}

export function dailyIndex(dateStr: string, poolLen: number): number {
  if (poolLen <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) { h ^= dateStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % poolLen;
}

export function buildProverbPage(p: Proverb, host: string, cat: Record<string, string> = {}, lang = DEFAULT_LANG, sourceCitations: string[] = []): string {
  const e = escapeHtml;
  const pt = prettify(p.text);
  const pm = p.modern_text && p.modern_text.trim() !== p.text.trim() ? prettify(p.modern_text) : "";
  const img = `https://${e(host)}/card/${e(p.id)}.png?v=3`;
  const canon = `https://${e(host)}${lang === DEFAULT_LANG ? "" : "/" + e(lang)}/p/${e(p.id)}`;
  const desc = [prettify(p.modern_text), p.sources.map(srcLabel).join(", "), p.category.join(", ")].filter(Boolean).join(" — ");
  const tags = p.category.map((c) => `<span class="tag">${e(c)}</span>`).join("");
  const siteName = t(cat, "meta.home.ogTitle", "Українські прислів'я та приказки");
  const copyLinkLabel = t(cat, "detail.copyLink", "Скопіювати посилання");
  const cardLabel = t(cat, "detail.card", "Картка");
  const hreflang = hreflangLinks(`/p/${p.id}`, host);
  const su = shortUrl(p.id, host);
  return `<!DOCTYPE html>
<html lang="${e(lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#5E7355" />
<title>${e(pt)} — ${e(siteName)}</title>
<meta name="description" content="${e(desc)}" />
<meta property="og:locale" content="${e(lang)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="${e(siteName)}" />
<meta property="og:title" content="${e(pt)}" />
<meta property="og:description" content="${e(desc)}" />
<meta property="og:image" content="${img}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="${canon}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${e(pt)}" />
<meta name="twitter:image" content="${img}" />
<link rel="canonical" href="${canon}" />
${hreflang}
<link rel="stylesheet" href="/fonts/spectral.css" />
<link rel="stylesheet" href="/styles.css" />
<script>
(function () {
  var d = document.documentElement;
  try { var t = localStorage.getItem("theme"); if (t === "dark" || t === "light") d.setAttribute("data-theme", t); } catch (e) {}
  function cur() { return d.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); }
  function meta() { var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = cur() === "dark" ? "#191c16" : "#5E7355"; }
  addEventListener("DOMContentLoaded", function () {
    meta();
    var b = document.getElementById("themeToggle"); if (!b) return;
    function sync() { b.textContent = cur() === "dark" ? "☀" : "☾"; }
    sync();
    b.addEventListener("click", function () {
      var next = cur() === "dark" ? "light" : "dark";
      d.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      sync(); meta();
    });
  });
})();
</script>
</head>
<body>
<nav class="topbar">
  <div class="wrap topbar-inner">
    <a class="topbar-brand" href="/" aria-label="verba">
      <svg class="leaf" viewBox="0 0 40 64" aria-hidden="true"><path d="M20 4 C 31 22 30 46 21 60 C 12 46 11 22 20 4 Z" fill="#5e7355"/><path d="M20 11 C 23 28 22 47 21 54" stroke="#f4f1e8" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg><span>verba</span>
    </a>
    <div class="topbar-nav">
      <a class="topbar-link" href="/about" data-i18n="nav.about">${e(t(cat, "nav.about", "Про проєкт"))}</a>
      <a class="topbar-link" href="/blog" data-i18n="nav.blog">${e(t(cat, "nav.blog", "Блог"))}</a>
      <a class="topbar-link" href="/api.html" data-i18n="nav.api">${e(t(cat, "nav.api", "API"))}</a>
      <a class="topbar-link topbar-link-ext" href="https://github.com/dmytro-yemelianov/verbacorpus" rel="noopener">GitHub</a>
      <div id="langSwitch" class="lang-switch"></div>
      <button id="themeToggle" class="theme-toggle-btn" type="button" aria-label="Перемкнути тему" data-i18n-attr="aria-label:ui.themeToggle">☾</button>
    </div>
  </div>
</nav>
<main class="wrap p-detail" style="max-width:760px;padding-block:clamp(2rem,8vw,5rem);">
<img class="p-card" src="/card/${e(p.id)}.png?v=3" alt="${e(pt)}" width="1200" height="630" />
<p class="hero-text" style="margin:0;">${e(pt)}</p>
${pm ? `<p class="hero-modern">${e(pm)}</p>` : ""}
<p style="margin-top:1rem;">${tags} <span class="tag-src">${e(p.sources.map(srcLabel).join(" · "))}</span></p>
${sourceCitations.length ? `<p style="margin-top:.8rem;font-size:.85rem;color:var(--muted);line-height:1.5;">${sourceCitations.map((c) => e(c)).join("<br>")}</p>` : ""}
<div class="p-share">
  <button id="copyLink" type="button" data-link="${e(su)}" data-i18n="detail.copyLink">${e(copyLinkLabel)}</button>
  <a href="/card/${e(p.id)}.png?v=3" target="_blank" rel="noopener" data-i18n="detail.card">${e(cardLabel)}</a>
</div>
</main>
<script type="module" src="/chrome.js"></script>
</body>
</html>`;
}
