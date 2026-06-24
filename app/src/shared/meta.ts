import { type Proverb } from "./corpus";
import { prettify } from "./text";
import { t, hreflangLinks, DEFAULT_LANG } from "./i18n";
import { srcLabel } from "./sources";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export type CardModel = { text: string; modern: string; footer: string };

const num = (id: string) => id.replace(/^p0*/, "");

export function cardModel(p: Proverb & { explanation?: string | null }, opts: { maxLen?: number } = {}): CardModel {
  const max = opts.maxLen ?? 160;
  const raw = prettify(p.text);
  const text = raw.length > max ? raw.slice(0, max) + "…" : raw;
  const modern = p.modern_text && p.modern_text.trim() !== p.text.trim() ? prettify(p.modern_text) : "";
  const footer = [...p.sources.map(srcLabel), `№${num(p.id)}`, "verbacorpus.org"].join(" · ");
  return { text, modern, footer };
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
  const img = `https://${e(host)}/card/${e(p.id)}.png`;
  const canon = `https://${e(host)}${lang === DEFAULT_LANG ? "" : "/" + e(lang)}/p/${e(p.id)}`;
  const desc = [prettify(p.modern_text), p.sources.map(srcLabel).join(", "), p.category.join(", ")].filter(Boolean).join(" — ");
  const tags = p.category.map((c) => `<span class="tag">${e(c)}</span>`).join("");
  const siteName = t(cat, "meta.home.ogTitle", "Українські прислів'я та приказки");
  const browseLabel = t(cat, "nav.browse", t(cat, "about.back", "← На головну"));
  const browseHref = lang === DEFAULT_LANG ? "/" : `/${e(lang)}/`;
  const apiLabel = t(cat, "nav.api", "API");
  const hreflang = hreflangLinks(`/p/${p.id}`, host);
  return `<!DOCTYPE html>
<html lang="${e(lang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
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
</head>
<body>
<main class="wrap" style="max-width:760px;padding-block:clamp(2rem,8vw,5rem);">
<p class="eyebrow">${e(siteName)}</p>
<p class="hero-text" style="margin:0;">${e(pt)}</p>
${pm ? `<p class="hero-modern">${e(pm)}</p>` : ""}
<p style="margin-top:1rem;">${tags} <span class="tag-src">${e(p.sources.map(srcLabel).join(" · "))}</span></p>
${sourceCitations.length ? `<p style="margin-top:.8rem;font-size:.85rem;color:var(--muted);line-height:1.5;">${sourceCitations.map((c) => e(c)).join("<br>")}</p>` : ""}
<p><img src="/card/${e(p.id)}.png" alt="" style="max-width:100%;height:auto;border:1px solid var(--rule);border-radius:6px;margin-top:1rem;" /></p>
<p style="margin-top:1.5rem;"><a href="${browseHref}">${e(browseLabel)}</a> · <a href="${lang === DEFAULT_LANG ? "" : "/" + e(lang)}/api.html">${e(apiLabel)}</a></p>
</main>
</body>
</html>`;
}
