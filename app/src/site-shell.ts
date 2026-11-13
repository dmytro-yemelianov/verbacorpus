import directions from '../content/corpora.json';

const languagePrefix = /^\/(uk|en|de|fr|es|pl|it|pt|ja|zh)(?=\/|$)/;
export function siteSection(url: URL): string {
  const path = url.pathname.replace(languagePrefix, '') || '/';
  if (/^\/non(?:\/|$)/.test(path)) return 'non';
  if (/^\/(?:re|blog)(?:\/|$)/.test(path)) return 're';
  for (const section of ['pro', 'contra', 'para']) if (path === `/${section}` || path.startsWith(`/${section}/`)) return section;
  if (path === '/' && url.hostname === 'non.verbacorpus.org') return 'non';
  return path === '/' || /^\/corpora(?:\.html)?\/?$/.test(path) ? '' : 'pro';
}
export function siteNavigation(url: URL, local = false): string {
  const uk = !languagePrefix.test(url.pathname) || url.pathname.startsWith('/uk/');
  const production = !local && (url.hostname === 'verbacorpus.org' || url.hostname.endsWith('.verbacorpus.org'));
  const root = production ? 'https://verbacorpus.org' : '';
  const language = languagePrefix.exec(url.pathname)?.[1];
  const active = siteSection(url);
  return `<a class="verba-skip" href="#verba-content">${uk ? 'До вмісту' : 'Skip to content'}</a><nav class="verba-network" aria-label="${uk ? 'Напрями Verba' : 'Verba directions'}" data-verba-navigation><div class="verba-network-inner"><a class="verba-network-brand" data-no-localize href="${root || '/corpora'}"><img src="/logo-willow.svg" width="42" height="42" alt=""><span>verba<span class="verba-period">.</span></span></a><div class="verba-network-links"><a data-no-localize data-verba-direction="" href="${root || '/corpora'}"${!active ? ' aria-current="page"' : ''}>${uk ? 'Усі напрями' : 'All directions'}</a>${directions.map(direction => {
    const locale = direction.prefix === 'pro' && language && language !== 'uk' ? `/${language}` : '';
    const href = production && direction.prefix === 'non' ? 'https://non.verbacorpus.org/' : `${root}${locale}/${direction.prefix}/`;
    return `<a data-no-localize data-verba-direction="${direction.prefix}" href="${href}"${active === direction.prefix ? ' aria-current="location"' : ''}>${direction.prefix}.verba</a>`;
  }).join('')}</div><button id="umbrella-theme" data-verba-theme type="button" aria-label="${uk ? 'Змінити тему' : 'Change theme'}" aria-pressed="false">◐</button></div></nav>`;
}

/** One shell for generated pages, the proverb app, editorial pages and mounted UPA. */
export function withSiteShell(response: Response, request: Request, local = false): Response {
  if (request.method === 'HEAD' || !response.headers.get('content-type')?.includes('text/html')) return response;
  const url = new URL(request.url), path = url.pathname.replace(languagePrefix, '') || '/';
  if (/\/api\//.test(path)) return response;
  const upa = path.startsWith('/non/upa/');
  const landing = path === '/' || /^\/(corpora(?:\.html)?|non|para|re|contra|bez-tabu)\/?$/.test(path);
  const headers = new Headers(response.headers);
  for (const name of ['content-length', 'content-encoding', 'etag']) headers.delete(name);
  return new HTMLRewriter()
    .on('html', { element(el) { el.setAttribute('data-verba-shell', ''); } })
    .on('head', { element(el) { el.append('<link rel="stylesheet" href="/fonts/spectral.css"><link rel="stylesheet" href="/site-shell.css"><script src="/site-shell.js"></script>', { html: true }); } })
    .on('body', { element(el) { if (upa) el.setAttribute('data-verba-upa', ''); el.prepend(siteNavigation(url, local), { html: true }); } })
    .on('nav.topbar', { element(el) { if (landing) el.remove(); else el.setAttribute('class', 'verba-sectionbar'); } })
    .on('a.skip-link, a.skip, [data-theme-toggle]', { element(el) { el.remove(); } })
    .on('main', { element(el) { el.before('<span id="verba-content" tabindex="-1"></span>', { html: true }); } })
    .transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
}
