import bootstrap from '../content/diagnostics-bootstrap.json';

export const diagnosticsBootstrap = bootstrap;
const kinds = new Set(['script_error', 'resource_error', 'unhandled_rejection', 'missing_content']);
const errors = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AbortError', 'NetworkError', 'SecurityError', 'QuotaExceededError']);
const safePath = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const path = value.split(/[?#]/, 1)[0];
  return /^\/(?!\/)[a-zA-Z0-9._~/-]{0,200}$/.test(path) ? path : undefined;
};
const number = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : undefined;

export async function receiveDiagnostics(request: Request, limiter?: RateLimit, localPreview = false): Promise<Response> {
  const reply = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store', ...(status === 405 ? { allow: 'POST' } : {}) } });
  if (request.method !== 'POST') return reply(405);
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  // Wrangler supplies a production hostname internally in integrated local previews.
  const localOrigin = localPreview && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin ?? '') && request.headers.get('sec-fetch-site') === 'same-origin';
  if (origin !== url.origin && !localOrigin) return reply(403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return reply(415);
  if (!limiter) return reply(503);
  try {
    if (!(await limiter.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' })).success) return reply(429);
  } catch { return reply(503); }
  if (Number(request.headers.get('content-length')) > 4096) return reply(413);
  const reader = request.body?.getReader();
  if (!reader) return reply(400);
  let body = '', bytes = 0;
  const decoder = new TextDecoder();
  let payload: unknown;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return reply(413); }
      body += decoder.decode(value, { stream: true });
    }
    payload = JSON.parse(body + decoder.decode());
  } catch { return reply(400); }
  const events = payload && typeof payload === 'object' && 'events' in payload ? payload.events : undefined;
  if (!Array.isArray(events) || !events.length || events.length > 6) return reply(400);
  const ua = request.headers.get('user-agent') ?? '';
  const browser = /Firefox\//.test(ua) ? 'firefox' : /(?:Chrome|Chromium|CriOS|Edg)\//.test(ua) ? 'chromium' : /Safari\//.test(ua) ? 'safari' : 'other';
  const version = (browser === 'safari' ? /Version\/(\d+)/ : /(?:Firefox|Chrome|Chromium|CriOS|Edg)\/(\d+)/).exec(ua)?.[1];
  const cleaned = events.flatMap(event => {
    if (!event || typeof event !== 'object' || !kinds.has(event.kind) || !safePath(event.path)) return [];
    return [{
      event: 'verba_client_diagnostic', site: url.hostname, browser, browserMajor: version ? number(Number(version), 2000) : undefined,
      kind: event.kind, path: safePath(event.path), resource: safePath(event.resource),
      error: errors.has(event.error) ? event.error : undefined,
      line: number(event.line, 1_000_000), column: number(event.column, 1_000_000), elapsed: number(event.elapsed, 3_600_000),
      ready: ['loading', 'interactive', 'complete'].includes(event.ready) ? event.ready : undefined,
      online: typeof event.online === 'boolean' ? event.online : undefined,
      worker: typeof event.worker === 'boolean' ? event.worker : undefined,
    }];
  });
  if (!cleaned.length) return reply(400);
  for (const event of cleaned) console.warn(event);
  return reply(204);
}

/** Add permission for this one inline bootstrap without weakening the existing policy. */
export function allowDiagnosticsNonce(policy: string, nonce: string): string {
  const directives = policy.split(';').map(value => value.trim().replace(/^\S+/, name => name.toLowerCase())).filter(Boolean);
  if (!directives.some(value => value.split(/\s/)[0] === 'script-src')) {
    const fallback = directives.find(value => value.startsWith('default-src '));
    if (fallback) directives.push(fallback.replace(/^default-src/, 'script-src'));
  }
  return directives.map(value => /^(?:script-src|script-src-elem)(?:\s|$)/.test(value) ? `${value.replace(/(?:^|\s)'none'(?=\s|$)/g, '')} 'nonce-${nonce}'` : value).join('; ');
}
