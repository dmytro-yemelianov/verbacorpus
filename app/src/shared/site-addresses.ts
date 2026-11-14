export const SITE_DIRECTIONS = ['pro', 'contra', 're', 'para', 'non'] as const;
export type SiteDirection = typeof SITE_DIRECTIONS[number];
export const UPA_BASE = '/upa';
export const LOCALE_PREFIX = /^\/(uk|en|de|fr|es|pl|it|pt|ja|zh)(?=\/|$)/;
const directionPrefix = /^\/(?:(uk|en|de|fr|es|pl|it|pt|ja|zh)\/)?(pro|contra|re|para|non)(?=\/|$)/;

export function hostDirection(hostname: string): SiteDirection | undefined {
  return SITE_DIRECTIONS.find(direction => hostname === `${direction}.verbacorpus.org`);
}
export function isVerbaHost(hostname: string): boolean {
  return hostname === 'verbacorpus.org' || hostname === 'www.verbacorpus.org' || Boolean(hostDirection(hostname));
}
export function isAlphabetPath(path: string): boolean {
  return /^\/(?:en\/)?letters-lab(?:\.html)?\/?$/.test(path);
}
export function isFontCatalogPath(path: string): boolean {
  return /^\/(?:en\/)?fonts(?:\.html)?\/?$/.test(path);
}
export const isParaToolPath = (path: string) => isAlphabetPath(path) || isFontCatalogPath(path);
/** Resolve every historical namespace directly to its final public URL. */
export function canonicalAddress(input: URL): URL | null {
  if (!isVerbaHost(input.hostname)) return null;
  const url = new URL(input);
  url.protocol = 'https:'; url.port = '';
  const from = url.searchParams.get('from');
  if (from?.startsWith('/non/upa/') || from === '/non/upa') url.searchParams.set('from', from.replace(/^\/non\/upa/, UPA_BASE));
  for (let pass = 0; pass < 8; pass++) {
    const before = url.href;
    if (url.hostname === 'www.verbacorpus.org') url.hostname = 'verbacorpus.org';
    const nested = url.pathname.match(/^\/(?:non\/)?upa\/(en\/)?(letters-lab|fonts)(?:\.html)?\/?$/);
    if (nested) { url.hostname = 'para.verbacorpus.org'; url.pathname = `/${nested[1] ?? ''}${nested[2]}`; }
    else if (isParaToolPath(url.pathname) || url.pathname === '/font-index.json') { url.hostname = 'para.verbacorpus.org'; url.pathname = url.pathname.replace(/\.html\/?$|\/$/g, ''); }
    else {
      const prefix = directionPrefix.exec(url.pathname);
      if (prefix) {
        const tail = url.pathname.slice(prefix[0].length) || '/';
        url.hostname = `${prefix[2]}.verbacorpus.org`;
        url.pathname = `${prefix[1] && prefix[1] !== 'uk' ? '/' + prefix[1] : ''}${tail}`;
      } else if (url.pathname === '/corpora' || url.pathname === '/corpora.html' || url.pathname === '/corpora/') {
        url.hostname = 'verbacorpus.org'; url.pathname = '/';
      } else if (url.pathname === UPA_BASE || url.pathname.startsWith(UPA_BASE + '/')) {
        url.hostname = 'non.verbacorpus.org'; if (url.pathname === UPA_BASE) url.pathname += '/';
      } else if (/^\/bez-tabu(?:\/|\/index\.html)?$/.test(url.pathname)) {
        url.hostname = 'contra.verbacorpus.org'; url.pathname = '/';
      } else {
        const rest = url.pathname.replace(LOCALE_PREFIX, '') || '/';
        if ((/^\/blog(?:\/|$)/.test(rest) && !/\.[a-z0-9]+$/i.test(rest) || /^\/blog\/.+\.html$/.test(rest))) url.hostname = 're.verbacorpus.org';
        else if (url.hostname === 'verbacorpus.org' && (/^\/(p|card)(?:\/|$)/.test(rest) || rest === '/api.html' || rest === '/' && ['q', 'cat', 'src', 'sem'].some(key => url.searchParams.has(key)))) url.hostname = 'pro.verbacorpus.org';
      }
    }
    if (url.pathname.replace(LOCALE_PREFIX, '') === '/blog/') url.pathname = url.pathname.slice(0, -1);
    if (url.pathname === '/index.html') url.pathname = '/';
    if (url.href === before) break;
  }
  return url.href === input.href ? null : url;
}

/** Render-time URL policy; local previews keep their explicit namespace aliases. */
export function publicHref(value: string, source: URL, local = false): string {
  if (!value.startsWith('/') && !/^https:\/\/[^/]*verbacorpus\.org(?:\/|$)/.test(value) || value.startsWith('//')) return value;
  const url = new URL(value, source);
  if (local || !isVerbaHost(source.hostname)) {
    if (url.pathname.replace(LOCALE_PREFIX, '') === '/blog/') return url.pathname.slice(0, -1) + url.search + url.hash;
    if (isVerbaHost(url.hostname) && !value.startsWith('/')) {
      if (hostDirection(url.hostname) === 'para' && isParaToolPath(url.pathname)) return url.pathname + url.search + url.hash;
      const direction = hostDirection(url.hostname);
      return publicHref((direction ? `/${direction}${url.pathname === '/' ? '/' : url.pathname}` : '/corpora') + url.search + url.hash, source, true);
    }
    return value.replace(/^\/para\/(en\/)?(letters-lab|fonts)(?=\?|#|$)/, '/$1$2').replace(/^\/(?:non\/)?upa\/(en\/)?(letters-lab|fonts)(?=\?|#|$)/, '/$1$2').replace(/^\/non\/upa(?=\/|\?|#|$)/, UPA_BASE);
  }
  if (!isVerbaHost(url.hostname)) return value;
  const target = canonicalAddress(url) ?? url;
  return target.origin === source.origin ? target.pathname + target.search + target.hash : target.href;
}
