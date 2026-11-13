import directions from '../content/corpora.json';
import { hostDirection, isVerbaHost, isAlphabetPath, publicHref, LOCALE_PREFIX } from './shared/site-addresses';

const languagePrefix = LOCALE_PREFIX;
export function siteSection(url: URL, local = false): string {
  if (!local && hostDirection(url.hostname)) return hostDirection(url.hostname)!;
  const path = url.pathname.replace(languagePrefix, '') || '/';
  if (isAlphabetPath(path)) return 'para';
  if (/^\/(?:non|upa)(?:\/|$)/.test(path)) return 'non';
  if (/^\/(?:re|blog)(?:\/|$)/.test(path)) return 're';
  for (const section of ['pro', 'contra', 'para']) if (path === `/${section}` || path.startsWith(`/${section}/`)) return section;
  if (path === '/' && url.hostname === 'non.verbacorpus.org') return 'non';
  return path === '/' || /^\/corpora(?:\.html)?\/?$/.test(path) ? '' : 'pro';
}
export function siteNavigation(url: URL, local = false): string {
  const localePath = url.pathname.replace(/^\/(?:non\/)?upa(?=\/|$)/, '');
  const language = languagePrefix.exec(localePath)?.[1] ?? 'uk';
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

/** One shell for generated pages, the proverb app, editorial pages and mounted UPA. */
export function withSiteShell(response: Response, request: Request, local = false): Response {
  if (request.method === 'HEAD' || !response.headers.get('content-type')?.includes('text/html')) return response;
  const url = new URL(request.url), path = url.pathname.replace(languagePrefix, '') || '/';
  if (/\/api\//.test(path)) return response;
  const alphabet = isAlphabetPath(path) || /^\/(?:para\/)?(?:en\/)?letters-lab\/?$/.test(path);
  const upa = path.startsWith('/upa/') || path.startsWith('/non/upa/') || alphabet;
  const landing = path === '/' && siteSection(url, local) !== 'pro' || /^\/(corpora(?:\.html)?|non|para|re|contra|bez-tabu)\/?$/.test(path);
  const english = url.pathname.startsWith('/en/');
  const localeHref = ((english ? '/letters-lab' : '/en/letters-lab') + url.search).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const alphabetNavigation = alphabet ? `<nav class="verba-sectionbar" aria-label="para.verba"><div class="wrap topbar-inner"><div class="topbar-nav"><a href="${!local && isVerbaHost(url.hostname) ? 'https://para.verbacorpus.org/' : '/para/'}">← para.verba</a><a data-language href="${localeHref}">${english ? 'UK' : 'EN'}</a></div></div></nav>` : '';
  const headers = new Headers(response.headers);
  for (const name of ['content-length', 'content-encoding', 'etag']) headers.delete(name);
  return new HTMLRewriter()
    .on('html', { element(el) { el.setAttribute('data-verba-shell', ''); } })
    .on('head', { element(el) { el.append(`<link rel="stylesheet" href="/fonts/spectral.css"><link rel="stylesheet" href="/site-shell.css"><script src="/site-shell.js"></script>${!local && isVerbaHost(url.hostname) ? `<link rel="canonical" href="${url.origin}${url.pathname}">` : ''}`, { html: true }); } })
    .on('body', { element(el) { if (upa) el.setAttribute('data-verba-upa', ''); el.prepend(siteNavigation(url, local) + alphabetNavigation, { html: true }); } })
    .on('nav.topbar', { element(el) { if (landing) el.remove(); else el.setAttribute('class', 'verba-sectionbar'); } })
    .on('a.skip-link, a.skip, [data-theme-toggle]', { element(el) { el.remove(); } })
    .on('a[href]', { element(el) { const href = el.getAttribute('href'); if (href) el.setAttribute('href', publicHref(href, url, local)); } })
    .on('link[rel="canonical"]', { element(el) { if (!local && isVerbaHost(url.hostname)) el.remove(); } })
    .on('.site-header, body > footer', { element(el) { if (alphabet) el.remove(); } })
    .on('main', { element(el) { el.before('<span id="verba-content" tabindex="-1"></span>', { html: true }); } })
    .transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
}
