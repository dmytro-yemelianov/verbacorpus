import directions from '../content/corpora.json';
import { hostDirection, isVerbaHost, isParaToolPath, isFontCatalogPath, publicHref, LOCALE_PREFIX } from './shared/site-addresses';

const languagePrefix = LOCALE_PREFIX;
function siteLanguage(url: URL): string {
  return languagePrefix.exec(url.pathname.replace(/^\/(?:non\/)?upa(?=\/|$)/, ''))?.[1] ?? 'uk';
}
export function siteSection(url: URL, local = false): string {
  if (!local && hostDirection(url.hostname)) return hostDirection(url.hostname)!;
  const path = url.pathname.replace(languagePrefix, '') || '/';
  if (isParaToolPath(path)) return 'para';
  if (/^\/(?:non|upa)(?:\/|$)/.test(path)) return 'non';
  if (/^\/(?:re|blog)(?:\/|$)/.test(path)) return 're';
  for (const section of ['pro', 'contra', 'para']) if (path === `/${section}` || path.startsWith(`/${section}/`)) return section;
  if (path === '/' && url.hostname === 'non.verbacorpus.org') return 'non';
  return path === '/' || /^\/corpora(?:\.html)?\/?$/.test(path) ? '' : 'pro';
}
export function siteNavigation(url: URL, local = false): string {
  const language = siteLanguage(url);
  const uk = language === 'uk';
  const production = !local && isVerbaHost(url.hostname);
  const root = production ? 'https://verbacorpus.org' : '';
  const active = siteSection(url, local);
  return `<a class="verba-skip" href="#verba-content">${uk ? 'До вмісту' : 'Skip to content'}</a><nav class="verba-network" aria-label="${uk ? 'Напрями Verba' : 'Verba directions'}" data-verba-navigation><div class="verba-network-inner"><a class="verba-network-brand" data-no-localize href="${root || '/corpora'}"><img src="/logo-willow.svg" width="42" height="42" alt=""><span>verba<span class="verba-period">.</span></span></a><div class="verba-network-links"><a data-no-localize data-verba-direction="" href="${root || '/corpora'}"${!active ? ' aria-current="page"' : ''}>${uk ? 'Усі напрями' : 'All directions'}</a>${directions.map(direction => {
    const locale = direction.prefix === 'pro' && language && language !== 'uk' ? `/${language}` : '';
    const href = production ? `https://${direction.prefix}.verbacorpus.org${locale}/` : `${locale}/${direction.prefix}/`;
    return `<a data-no-localize data-verba-direction="${direction.prefix}" href="${href}"${active === direction.prefix ? ' aria-current="location"' : ''}>${direction.prefix}.verba</a>`;
  }).join('')}</div><button id="umbrella-theme" data-verba-theme type="button" aria-label="${uk ? 'Змінити тему' : 'Change theme'}" aria-pressed="false">◐</button></div></nav>`;
}

/** The same project and author links on every HTML page, independent of its corpus. */
export function siteFooter(url: URL, local = false): string {
  const uk = siteLanguage(url) === 'uk', production = !local && isVerbaHost(url.hostname);
  const root = production ? 'https://verbacorpus.org' : '/corpora';
  const about = `${production ? 'https://verbacorpus.org' : ''}${uk ? '' : '/en'}/about`;
  const registry = `${production ? 'https://verbacorpus.org' : ''}/data/corpora.json`;
  return `<footer class="verba-network-footer" data-verba-footer><div class="verba-network-footer-inner"><div class="verba-footer-identity"><a class="verba-footer-brand" data-no-localize href="${root}">verba<span class="verba-period">.</span></a><p>${uk ? 'Мова, письмо й візуальна спадщина' : 'Language, writing and visual heritage'}</p></div><nav class="verba-footer-links" aria-label="${uk ? 'Посилання проєкту Verba' : 'Verba project links'}"><a data-no-localize href="${root}">${uk ? 'Усі напрями' : 'All directions'}</a><a data-no-localize href="${about}">${uk ? 'Про проєкт' : 'About the project'}</a><a data-no-localize href="${registry}">${uk ? 'Реєстр напрямів' : 'Direction registry'}</a><a data-no-localize data-verba-author href="https://yemelianov.dev/" target="_blank" rel="author noopener">${uk ? 'Дмитро Ємельянов' : 'Dmytro Yemelianov'} · yemelianov.dev ↗</a></nav></div></footer>`;
}

/** One shell for generated pages, the proverb app, editorial pages and mounted UPA. */
export function withSiteShell(response: Response, request: Request, local = false): Response {
  if (request.method === 'HEAD' || !response.headers.get('content-type')?.includes('text/html')) return response;
  const url = new URL(request.url), path = url.pathname.replace(languagePrefix, '') || '/';
  if (/\/api\//.test(path)) return response;
  const alphabet = isParaToolPath(path) || /^\/(?:para\/)?(?:en\/)?(?:letters-lab|fonts)\/?$/.test(path);
  const upa = path.startsWith('/upa/') || path.startsWith('/non/upa/') || alphabet;
  const landing = path === '/' && siteSection(url, local) !== 'pro' || /^\/(corpora(?:\.html)?|non|para|re|contra|bez-tabu)\/?$/.test(path);
  const english = url.pathname.startsWith('/en/');
  const tool = isFontCatalogPath(path) ? 'fonts' : 'letters-lab';
  const toolTitle = tool === 'fonts' ? (english ? 'Font catalogue' : 'Каталог шрифтів') : (english ? 'Alphabet laboratory' : 'Лабораторія абетки');
  const toolDescription = tool === 'fonts' ? (english ? 'Texted and Verba fonts: native previews, Ukrainian letters, sources and downloads.' : 'Шрифти Texted і Verba: растрові зразки, українські літери, джерела та завантаження.') : (english ? 'Explore Ukrainian bitmap alphabets, styles and the origins of each letter.' : 'Досліджуйте українські растрові абетки, стилі та походження кожної літери.');
  const localeHref = ((english ? '/' : '/en/') + tool + url.search).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const alphabetNavigation = alphabet ? `<nav class="verba-sectionbar" aria-label="para.verba"><div class="wrap topbar-inner"><div class="topbar-nav"><a href="${!local && isVerbaHost(url.hostname) ? 'https://para.verbacorpus.org/' : '/para/'}">← para.verba</a><a data-language href="${localeHref}">${english ? 'UK' : 'EN'}</a></div></div></nav>` : '';
  const headers = new Headers(response.headers);
  for (const name of ['content-length', 'content-encoding', 'etag']) headers.delete(name);
  return new HTMLRewriter()
    .on('html', { element(el) { el.setAttribute('data-verba-shell', ''); } })
    .on('head', { element(el) { el.append(`<link rel="stylesheet" href="/fonts/spectral.css"><link rel="stylesheet" href="/site-shell.css"><script src="/site-shell.js"></script>${!local && isVerbaHost(url.hostname) ? `<link rel="canonical" href="${url.origin}${url.pathname}">` : ''}`, { html: true }); } })
    .on('body', { element(el) { if (upa) el.setAttribute('data-verba-upa', ''); el.prepend(siteNavigation(url, local) + alphabetNavigation, { html: true }); el.append(siteFooter(url, local), { html: true }); } })
    .on('head > title', { element(el) { if (alphabet) el.setInnerContent(`${toolTitle} · para.verba`); } })
    .on('head > meta[name="description"]', { element(el) { if (alphabet) el.setAttribute('content', toolDescription); } })
    .on('nav.topbar', { element(el) { if (landing) el.remove(); else el.setAttribute('class', 'verba-sectionbar'); } })
    .on('a.skip-link, a.skip, [data-theme-toggle]', { element(el) { el.remove(); } })
    .on('a[href]', { element(el) { const href = el.getAttribute('href'); if (href) el.setAttribute('href', publicHref(href, url, local)); } })
    .on('link[rel="canonical"]', { element(el) { if (!local && isVerbaHost(url.hostname)) el.remove(); } })
    .on('.site-header', { element(el) { if (alphabet) el.remove(); } })
    .on('body > footer', { element(el) {
      if (alphabet || landing) { el.remove(); return; }
      // Corpus-specific source notes remain separate from the shared site footer.
      const classes = el.getAttribute('class')?.split(/\s+/).includes('colophon') ? 'colophon verba-context-footer' : 'verba-context-footer';
      el.before(`<div class="${classes}" data-verba-context>`, { html: true });
      el.after('</div>', { html: true }); el.removeAndKeepContent();
    } })
    .on('main', { element(el) { el.before('<span id="verba-content" tabindex="-1"></span>', { html: true }); } })
    .transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
}
