// Shared page chrome: the language switcher. Bundled into app.js (via main.ts)
// for the SPA, and built standalone as chrome.js for the static pages
// (about.html, api.html) so the top nav works everywhere, not just the landing page.
import { LANGS, LANG_NAMES, LANG_FLAGS, parseLang, DEFAULT_LANG } from "../shared/i18n";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

const SLUG_MAP: Record<string, Record<string, string>> = {
  "shcho-take-verba": { en: "what-is-verba", uk: "shcho-take-verba" },
  "what-is-verba": { en: "what-is-verba", uk: "shcho-take-verba" },
  "dzherela": { en: "sources", uk: "dzherela" },
  "sources": { en: "sources", uk: "dzherela" },
  "vidkryti-dani": { en: "open-data", uk: "vidkryti-dani" },
  "open-data": { en: "open-data", uk: "vidkryti-dani" },
  "verba-na-hugging-face": { en: "verba-on-hugging-face", uk: "verba-na-hugging-face" },
  "verba-on-hugging-face": { en: "verba-on-hugging-face", uk: "verba-na-hugging-face" },
};

export function langHref(l: string): string {
  const { rest } = parseLang(location.pathname);
  let targetRest = rest || "/";

  // Translate slugs if switching between uk and en for blog articles
  const parts = targetRest.split("/");
  if (parts.length > 2 && parts[1] === "blog") {
    const slug = parts[2].replace(".html", "");
    const map = SLUG_MAP[slug];
    if (map) {
      const targetLangKey = l === "uk" ? "uk" : "en";
      const targetSlug = targetLangKey === "uk" ? map.uk : map.en;
      if (targetSlug) {
        parts[2] = parts[2].endsWith(".html") ? `${targetSlug}.html` : targetSlug;
        targetRest = parts.join("/");
      }
    }
  }

  if (l === DEFAULT_LANG) return targetRest;
  // keep the trailing slash on the root so the URL matches the Worker's /<lang>/* routes
  return targetRest === "/" ? `/${l}/` : `/${l}${targetRest}`;
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

function wireCopyLink(): void {
  const copyBtn = document.getElementById("copyLink") as HTMLButtonElement | null;
  if (!copyBtn) return;
  const orig = copyBtn.textContent;
  let t: number | undefined;
  copyBtn.addEventListener("click", () => {
    navigator.clipboard?.writeText(copyBtn.dataset.link || location.href);
    copyBtn.textContent = "✓";
    clearTimeout(t);
    t = setTimeout(() => { copyBtn.textContent = orig; }, 1200) as unknown as number;
  });
}

function localizeNav(): void {
  const LANG: string = (window as any).__LANG__ || document.documentElement.lang || "uk";
  if (LANG === DEFAULT_LANG) return; // uk is unprefixed; links already correct
  document.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const isAlreadyLocalized = LANGS.some((l) => href.startsWith("/" + l + "/") || href === "/" + l);
    // Only internal paths starting with / (excluding assets like fonts, css, files, or api)
    if (href.startsWith("/") && 
        !isAlreadyLocalized && 
        !href.startsWith("/api/") && 
        !href.endsWith(".css") && 
        !href.endsWith(".js") &&
        !href.endsWith(".png") &&
        !href.endsWith(".bib") &&
        !href.endsWith(".json")) {
      if (href === "/") {
        a.setAttribute("href", "/" + LANG + "/");
      } else {
        a.setAttribute("href", "/" + LANG + href);
      }
    }
  });
}

declare const __COMMIT_HASH__: string;

function appendWebsiteVersion(): void {
  const hash = typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : "";
  if (!hash) return;

  const aboutMeta = document.getElementById("aboutMeta");
  if (aboutMeta && !document.getElementById("aboutCodeVersion")) {
    const span = document.createElement("span");
    span.id = "aboutCodeVersion";
    const LANG = (window as any).__LANG__ || document.documentElement.lang || "uk";
    const label = LANG === "uk" ? "сайт" : "site";
    span.innerHTML = ` · ${esc(label)}: <a href="https://github.com/dmytro-yemelianov/verbacorpus/commit/${esc(hash)}" rel="noopener">${esc(hash)}</a>`;
    aboutMeta.appendChild(span);
    return;
  }

  const wrap = document.querySelector(".colophon .wrap");
  if (!wrap) return;

  if (document.getElementById("colVersion")) return;
  if (document.getElementById("codeVersion")) return;

  const div = document.createElement("div");
  div.id = "codeVersion";
  div.className = "col-version";
  div.style.marginTop = "0.4rem";
  div.style.fontSize = "0.74rem";
  div.style.fontFamily = "var(--mono)";
  div.style.color = "var(--faint)";

  const LANG = (window as any).__LANG__ || document.documentElement.lang || "uk";
  const label = LANG === "uk" ? "Версія сайту" : "Website version";

  div.innerHTML = `${esc(label)}: <a href="https://github.com/dmytro-yemelianov/verbacorpus/commit/${esc(hash)}" rel="noopener">${esc(hash)}</a>`;
  wrap.appendChild(div);
}

function initChrome(): void {
  renderLangSwitch();
  wireCopyLink();
  localizeNav();
  appendWebsiteVersion();
}

// Auto-render when present in the DOM (covers both the SPA and the static pages).
if (document.readyState !== "loading") initChrome();
else document.addEventListener("DOMContentLoaded", initChrome);
