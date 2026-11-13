import { UPA_BASE, hostDirection, isAlphabetPath, publicHref } from './shared/site-addresses';

export const UPA_MOUNT = UPA_BASE;
type Mount = (path: string) => string;
const mountedCss = (value: string, mount: Mount) => value.replace(/(url\(\s*["']?)(\/(?!\/)[^)"']+)/g, (_match, start: string, path: string) => start + mount(path));

function browseContext(url: URL): string | null {
  const roots = [UPA_BASE + '/', UPA_BASE + '/en', UPA_BASE + '/en/'];
  const raw = (roots.includes(url.pathname) ? url.pathname + url.search : url.searchParams.get('from'))?.replace(/^\/non\/upa(?=\/|\?|$)/, UPA_BASE);
  if (!raw?.startsWith(UPA_BASE + '/')) return null;
  const source = new URL(raw, url);
  if (source.origin !== url.origin || !roots.includes(source.pathname)) return null;
  const params = new URLSearchParams();
  source.searchParams.forEach((value, key) => { if (['q', 'kind', 'color', 'excludeColor', 'page', 'maxHeight', 'frieze', 'saved'].includes(key)) params.append(key, value); });
  const lang = url.pathname.startsWith(UPA_BASE + '/en/') || url.pathname === UPA_BASE + '/en' ? '/en' : '';
  return UPA_BASE + lang + '/' + (params.size ? '?' + params : '') + '#browse';
}
function apiLinks(value: unknown, mount: Mount): unknown {
  if (Array.isArray(value)) return value.map(item => apiLinks(item, mount));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === 'links' && item && typeof item === 'object') return [key, Object.fromEntries(Object.entries(item).map(([name, url]) => [name, typeof url === 'string' ? mount(url) : url]))];
    if (key === 'endpoints' && item && typeof item === 'object') return [key, Object.fromEntries(Object.entries(item).map(([name, url]) => [name, typeof url === 'string' ? url.replace(/^(GET|POST) (\/.*)$/, (_m, method: string, path: string) => `${method} ${mount(path)}`) : url]))];
    return [key, ['matrix', 'stitches', 'cells', 'sourcePixels', 'basis'].includes(key) ? item : apiLinks(item, mount)];
  }));
}

/** Archive at non/upa; the alphabet tool is served directly by para. */
export async function upaRequest(request: Request, service?: Pick<Fetcher, 'fetch'>, local = false): Promise<Response | null> {
  const url = new URL(request.url);
  const alphabet = (hostDirection(url.hostname) === 'para' || local) && (isAlphabetPath(url.pathname) || url.pathname.startsWith('/assets/'));
  if (!alphabet && url.pathname !== UPA_BASE && !url.pathname.startsWith(UPA_BASE + '/')) return null;
  if (url.pathname === UPA_BASE) return new Response(null, { status: 308, headers: { location: UPA_BASE + '/' + url.search } });
  const base = alphabet ? '' : UPA_BASE;
  const mount: Mount = path => {
    if (!path.startsWith('/') || path.startsWith('//')) return path;
    if (alphabet) {
      if (path.startsWith('/assets/') || isAlphabetPath(path)) return path;
      return publicHref('https://non.verbacorpus.org' + UPA_BASE + path, url, local);
    }
    if (isAlphabetPath(path)) return publicHref('https://para.verbacorpus.org' + path, url, local);
    return path === base || path.startsWith(base + '/') ? path : base + path;
  };
  const upstreamUrl = new URL(url); upstreamUrl.pathname = alphabet ? url.pathname : url.pathname.slice(base.length);
  const unavailable = () => {
    const api = upstreamUrl.pathname.startsWith('/api/');
    return new Response(request.method === 'HEAD' ? null : api
      ? JSON.stringify({ ...(upstreamUrl.pathname.startsWith('/api/v1') ? { apiVersion: 'v1' } : {}), error: { code: 'unavailable', message: 'UPA archive is unavailable' } })
      : '<!doctype html><html lang="uk"><meta charset="utf-8"><title>UPA</title><h1>Архів тимчасово недоступний</h1><a href="https://non.verbacorpus.org/">До non.verba</a></html>',
    { status: 503, headers: { 'content-type': api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  };
  if (!service) return unavailable();
  let response: Response;
  try { response = await service.fetch(new Request(upstreamUrl, new Request(request, { redirect: 'manual' }))); }
  catch (error) { console.error('UPA service unavailable', error); return unavailable(); }
  const headers = new Headers(response.headers), redirect = headers.get('location');
  if (redirect) { const target = new URL(redirect, upstreamUrl); if (target.origin === upstreamUrl.origin) headers.set('location', mount(target.pathname) + target.search + target.hash); }
  const type = headers.get('content-type') ?? '';
  if (request.method === 'HEAD') return new Response(null, { status: response.status, headers });
  const edited = () => { for (const name of ['content-length', 'content-encoding', 'etag']) headers.delete(name); };
  if (type.includes('text/html')) {
    edited(); const from = browseContext(url);
    const body = upstreamUrl.pathname === '/api/v1/docs' ? (await response.text()).replace('url: "/api/v1/openapi.json"', `url: "${base}/api/v1/openapi.json"`) : response.body;
    return new HTMLRewriter().on('*', { element(element) {
      for (const name of ['href', 'src', 'action', 'poster', 'srcset', 'style', 'data-atlas-url', 'data-cycle-original']) {
        const value = element.getAttribute(name); if (value === null) continue;
        if (['href', 'src', 'action', 'poster', 'data-atlas-url', 'data-cycle-original'].includes(name)) element.setAttribute(name, mount(value));
        else if (name === 'srcset') element.setAttribute(name, value.replace(/(^|,\s*)(\/(?!\/)[^\s,]+)/g, (_m, start: string, path: string) => start + mount(path)));
        else if (name === 'style') element.setAttribute(name, mountedCss(value, mount));
      }
      if (element.tagName !== 'a') return;
      const href = element.getAttribute('href');
      if (href && element.hasAttribute('data-language')) {
        const target = new URL(href, url);
        if (target.origin === url.origin) element.setAttribute('href', target.pathname + url.search + url.hash);
      } else if (element.hasAttribute('data-browse-back') && from) element.setAttribute('href', from);
      else if (href && from) {
        const target = new URL(href, url);
        if (target.origin === url.origin && /^\/upa\/(?:en\/)?(?:p\/|(?:generate|strip|frame|page-frames)(?:\/|$))/.test(target.pathname)) {
          target.searchParams.set('from', from); element.setAttribute('href', target.pathname + target.search + target.hash);
        }
      }
    } }).on('head', { element(element) { element.prepend(`<meta name="upa-base-path" content="${base}">`, { html: true }); } })
      .transform(new Response(body, { status: response.status, headers }));
  }
  if (type.includes('text/css')) { edited(); return new Response(mountedCss(await response.text(), mount), { status: response.status, headers }); }
  if (type.includes('application/json') && upstreamUrl.pathname.startsWith('/api/v1')) {
    const value = await response.json() as Record<string, unknown>;
    if (upstreamUrl.pathname === '/api/v1/openapi.json') value.servers = [{ url: base + '/' }];
    edited(); return Response.json(apiLinks(value, mount), { status: response.status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}
