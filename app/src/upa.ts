/** The canonical UPA Worker is mounted in the non.verba collection. */
export const UPA_MOUNT = '/non/upa';
const mount = (path: string) => path.startsWith('/') && !path.startsWith('//') && !/^\/non\/upa(?:[/?#]|$)/.test(path) ? UPA_MOUNT + path : path;
const css = (value: string) => value.replace(/(url\(\s*["']?)(\/(?!\/)[^)"']+)/g, (_match, start: string, path: string) => start + mount(path));

function apiLinks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(apiLinks);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === 'links' && item && typeof item === 'object') return [key, Object.fromEntries(Object.entries(item).map(([name, url]) => [name, typeof url === 'string' ? mount(url) : url]))];
    if (key === 'endpoints' && item && typeof item === 'object') return [key, Object.fromEntries(Object.entries(item).map(([name, url]) => [name, typeof url === 'string' ? url.replace(/^(GET|POST) (\/.*)$/, (_m, method: string, path: string) => `${method} ${mount(path)}`) : url]))];
    // Cell geometry and identity bytes remain the canonical UPA payload.
    return [key, ['matrix', 'stitches', 'cells', 'sourcePixels', 'basis'].includes(key) ? item : apiLinks(item)];
  }));
}

export async function upaRequest(request: Request, service?: Pick<Fetcher, 'fetch'>): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== UPA_MOUNT && !url.pathname.startsWith(UPA_MOUNT + '/')) return null;
  if (url.pathname === UPA_MOUNT) return new Response(null, { status: 308, headers: { location: url.pathname + '/' + url.search } });
  const unavailable = () => {
    const api = url.pathname.startsWith(UPA_MOUNT + '/api/');
    const headers = { 'content-type': api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' };
    const body = api
      ? JSON.stringify({ ...(url.pathname.startsWith(UPA_MOUNT + '/api/v1') ? { apiVersion: 'v1' } : {}), error: { code: 'unavailable', message: 'UPA preview is unavailable' } })
      : '<!doctype html><html lang="uk"><meta charset="utf-8"><title>UPA · локальне прев’ю</title><h1>Прев’ю UPA недоступне</h1><p>Запустіть інтегроване локальне прев’ю Verba та UPA.</p><a href="/non/">До non.verba</a></html>';
    return new Response(request.method === 'HEAD' ? null : body, { status: 503, headers });
  };
  if (!service) return unavailable();
  const upstreamUrl = new URL(url); upstreamUrl.pathname = url.pathname.slice(UPA_MOUNT.length);
  let response: Response;
  try { response = await service.fetch(new Request(upstreamUrl, new Request(request, { redirect: 'manual' }))); }
  catch (error) { console.error('UPA service unavailable', error); return unavailable(); }
  const headers = new Headers(response.headers);
  const redirect = headers.get('location');
  if (redirect) {
    const target = new URL(redirect, upstreamUrl);
    if (target.origin === upstreamUrl.origin) headers.set('location', mount(target.pathname) + target.search + target.hash);
  }
  const type = headers.get('content-type') ?? '';
  if (request.method === 'HEAD') return new Response(null, { status: response.status, headers });
  const edited = () => { for (const name of ['content-length', 'content-encoding', 'etag']) headers.delete(name); };
  if (type.includes('text/html')) {
    edited();
    // Swagger's inline configuration also needs the mounted OpenAPI URL.
    const body = upstreamUrl.pathname === '/api/v1/docs' ? (await response.text()).replace('url: "/api/v1/openapi.json"', `url: "${UPA_MOUNT}/api/v1/openapi.json"`) : response.body;
    return new HTMLRewriter()
      .on('*', { element(element) {
        for (const name of ['href', 'src', 'action', 'poster', 'srcset', 'style', 'data-atlas-url', 'data-cycle-original']) {
          const value = element.getAttribute(name);
          if (value === null) continue;
          if (['href', 'src', 'action', 'poster', 'data-atlas-url', 'data-cycle-original'].includes(name)) element.setAttribute(name, mount(value));
          else if (name === 'srcset') element.setAttribute(name, value.replace(/(^|,\s*)(\/(?!\/)[^\s,]+)/g, (_m, start: string, path: string) => start + mount(path)));
          else if (name === 'style') element.setAttribute(name, css(value));
        }
      } })
      .on('head', { element(element) { element.prepend(`<meta name="upa-base-path" content="${UPA_MOUNT}">`, { html: true }); } })
      .on('body', { element(element) { element.prepend('<div style="padding:.65rem 1rem;border-bottom:1px solid currentColor;font:14px system-ui"><a href="/non/">← non.verba</a> · <a href="/corpora">Усі напрями Verba</a></div>', { html: true }); } })
      .transform(new Response(body, { status: response.status, headers }));
  }
  if (type.includes('text/css')) { edited(); return new Response(css(await response.text()), { status: response.status, headers }); }
  if (type.includes('application/json') && upstreamUrl.pathname.startsWith('/api/v1')) {
    const value = await response.json() as Record<string, unknown>;
    if (upstreamUrl.pathname === '/api/v1/openapi.json') value.servers = [{ url: UPA_MOUNT + '/' }];
    edited(); return Response.json(apiLinks(value), { status: response.status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}
