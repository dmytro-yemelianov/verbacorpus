// Shared page chrome: the language switcher. Bundled into app.js (via main.ts)
// for the SPA, and built standalone as chrome.js for the static pages
// (about.html, api.html) so the top nav works everywhere, not just the landing page.
import { LANGS, LANG_NAMES, LANG_FLAGS, parseLang, DEFAULT_LANG } from "../shared/i18n";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

export function langHref(l: string): string {
  const { rest } = parseLang(location.pathname);
  if (l === DEFAULT_LANG) return rest || "/"; // uk is unprefixed
  // keep the trailing slash on the root so the URL matches the Worker's /<lang>/* routes
  return rest === "/" ? `/${l}/` : `/${l}${rest}`;
}

export function renderLangSwitch(): void {
  const LANG: string = (window as any).__LANG__ || document.documentElement.lang || "uk";
  const sw = document.getElementById("langSwitch");
  if (!sw) return;
  sw.innerHTML =
    `<details class="lang-menu"><summary aria-label="${esc(LANG_NAMES[LANG] ?? LANG)}"><span class="lang-flag">${LANG_FLAGS[LANG] || "🌐"}</span><span class="lang-code">${esc(LANG.toUpperCase())}</span></summary><ul>` +
    LANGS.map((l) => `<li><a href="${langHref(l)}" hreflang="${l}"${l === LANG ? ' aria-current="true"' : ""}><span class="lang-flag">${LANG_FLAGS[l] || "🌐"}</span><span class="lang-code">${esc(l.toUpperCase())}</span><span class="lang-name">${esc(LANG_NAMES[l])}</span></a></li>`).join("") +
    `</ul></details>`;
  sw.querySelectorAll<HTMLAnchorElement>("a[hreflang]").forEach((a) => {
    a.addEventListener("click", () => {
      try { localStorage.setItem("verba:lang", a.getAttribute("hreflang") || "uk"); } catch {}
    });
  });
}

// Auto-render when present in the DOM (covers both the SPA and the static pages).
if (document.readyState !== "loading") renderLangSwitch();
else document.addEventListener("DOMContentLoaded", renderLangSwitch);
