import { type Proverb } from "./corpus";
import { prettify } from "./text";

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
  const footer = [...p.sources, `№${num(p.id)}`, "verbacorpus.org"].join(" · ");
  return { text, modern, footer };
}

export function dailyIndex(dateStr: string, poolLen: number): number {
  if (poolLen <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) { h ^= dateStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % poolLen;
}

export function buildProverbPage(p: Proverb, host: string): string {
  const e = escapeHtml;
  const pt = prettify(p.text);
  const pm = p.modern_text && p.modern_text.trim() !== p.text.trim() ? prettify(p.modern_text) : "";
  const img = `https://${e(host)}/card/${e(p.id)}.png`;
  const canon = `https://${e(host)}/p/${e(p.id)}`;
  const desc = [pm || p.modern_text, p.sources.join(", "), p.category.join(", ")].filter(Boolean).join(" — ");
  const tags = p.category.map((c) => `<span class="tag">${e(c)}</span>`).join("");
  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(pt)} — Українські прислів'я</title>
<meta name="description" content="${e(desc)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Українські прислів'я та приказки" />
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
<link rel="stylesheet" href="/fonts/spectral.css" />
<link rel="stylesheet" href="/styles.css" />
</head>
<body>
<main class="wrap" style="max-width:760px;padding-block:clamp(2rem,8vw,5rem);">
<p class="eyebrow">Українські прислів'я та приказки</p>
<p class="hero-text" style="margin:0;">${e(pt)}</p>
${pm ? `<p class="hero-modern">${e(pm)}</p>` : ""}
<p style="margin-top:1rem;">${tags} <span class="tag-src">${e(p.sources.join(" · "))}</span></p>
<p><img src="/card/${e(p.id)}.png" alt="" style="max-width:100%;height:auto;border:1px solid var(--rule);border-radius:6px;margin-top:1rem;" /></p>
<p style="margin-top:1.5rem;"><a href="/">Переглянути весь корпус</a> · <a href="/api.html">API</a></p>
</main>
</body>
</html>`;
}
