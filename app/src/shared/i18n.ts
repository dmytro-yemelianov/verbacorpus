export const LANGS = ["uk", "en", "de", "fr", "es", "pl", "it", "pt", "ja", "zh"];
export const DEFAULT_LANG = "uk";
export const LANG_NAMES: Record<string, string> = {
  uk: "Українська", en: "English", de: "Deutsch", fr: "Français", es: "Español",
  pl: "Polski", it: "Italiano", pt: "Português", ja: "日本語", zh: "中文",
};

// Representative flag per UI language (for the language switcher).
export const LANG_FLAGS: Record<string, string> = {
  uk: "🇺🇦", en: "🇬🇧", de: "🇩🇪", fr: "🇫🇷", es: "🇪🇸",
  pl: "🇵🇱", it: "🇮🇹", pt: "🇵🇹", ja: "🇯🇵", zh: "🇨🇳",
};

export function parseLang(pathname: string): { lang: string; rest: string } {
  const m = pathname.match(/^\/([a-z]{2})(\/.*|$)/);
  if (m && LANGS.includes(m[1]) && m[1] !== DEFAULT_LANG) {
    return { lang: m[1], rest: m[2] === "" ? "/" : m[2] };
  }
  // /uk or /uk/... → treat as uk with the rest (caller redirects to canonical)
  if (m && m[1] === DEFAULT_LANG) return { lang: "uk", rest: m[2] === "" ? "/" : m[2] };
  return { lang: DEFAULT_LANG, rest: pathname };
}

export function t(catalog: Record<string, string>, key: string, fallback?: string): string {
  return catalog[key] ?? fallback ?? key;
}

export function hreflangLinks(restPath: string, host: string): string {
  const p = restPath === "/" ? "" : restPath;
  const href = (lang: string) => `https://${host}${lang === DEFAULT_LANG ? "" : "/" + lang}${p || "/"}`;
  const links = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${href(l)}" />`);
  links.push(`<link rel="alternate" hreflang="x-default" href="${href(DEFAULT_LANG)}" />`);
  return links.join("\n");
}
