/** Self-contained so the Worker can install this before external page resources. */
export function installDiagnostics(): void {
  const seen = new Set<string>();
  const queue: Record<string, unknown>[] = [];
  let sent = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const path = (value: string) => {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin && /^\/[a-zA-Z0-9._~/-]{0,200}$/.test(url.pathname) ? url.pathname : undefined;
    } catch { return undefined; }
  };
  const errorName = (value: unknown) => {
    let name = '';
    try { name = value && typeof value === 'object' && 'name' in value ? String(value.name) : ''; } catch { /* Untrusted rejection reasons can have getters. */ }
    return /^(?:Error|TypeError|RangeError|ReferenceError|SyntaxError|AbortError|NetworkError|SecurityError|QuotaExceededError)$/.test(name) ? name : 'Error';
  };
  function flush() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!queue.length) return;
    const body = JSON.stringify({ events: queue.splice(0) });
    void fetch('/_diagnostics', { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'omit', keepalive: true }).catch(() => {});
  }
  function report(kind: string, details: Record<string, unknown> = {}) {
    const page = path(location.href);
    const key = JSON.stringify([kind, details]);
    if (!page || sent >= 6 || seen.has(key)) return;
    seen.add(key); sent++;
    let worker = false;
    try { worker = Boolean(navigator.serviceWorker?.controller); } catch { /* Some private contexts disable service workers. */ }
    queue.push({ kind, path: page, ready: document.readyState, elapsed: Math.round(performance.now()), online: navigator.onLine, worker, ...details });
    timer ??= setTimeout(flush, 1_000);
  }
  window.addEventListener('error', (event: Event) => {
    if (event instanceof ErrorEvent) {
      report('script_error', { error: errorName(event.error), resource: path(event.filename), line: event.lineno, column: event.colno });
      return;
    }
    const target = event.target;
    if (target instanceof HTMLScriptElement || target instanceof HTMLImageElement || target instanceof HTMLLinkElement && target.rel === 'stylesheet') {
      const resource = path(target instanceof HTMLLinkElement ? target.href : target.src);
      if (resource) report('resource_error', { resource });
    }
  }, true);
  window.addEventListener('unhandledrejection', event => report('unhandled_rejection', { error: errorName(event.reason) }));
  window.addEventListener('pagehide', flush);
  setTimeout(() => {
    if (document.visibilityState === 'hidden' || matchMedia('print').matches || /\/print(?:-unit)?\/?$/.test(location.pathname)) return;
    const main = document.querySelector('main');
    const nav = document.querySelector('[data-verba-navigation]');
    if (!main?.getClientRects().length || !nav?.getClientRects().length) report('missing_content');
  }, 15_000);
}
