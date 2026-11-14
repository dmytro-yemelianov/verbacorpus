import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowDiagnosticsNonce, receiveDiagnostics } from '../src/diagnostics';

const limiter = { limit: async () => ({ success: true }) };
const event = { kind: 'script_error', path: '/upa/page-frames?text=private#title=private', resource: '/upa/assets/client.js?token=private', error: 'TypeError', line: 12, ready: 'loading' };
const request = (body: unknown = { events: [event] }, headers: Record<string, string> = {}) => new Request('https://non.verbacorpus.org/_diagnostics', { method: 'POST', headers: { origin: 'https://non.verbacorpus.org', 'content-type': 'application/json', 'user-agent': 'Version/26.0 Safari/605.1', ...headers }, body: JSON.stringify(body) });
afterEach(() => vi.restoreAllMocks());

describe('client diagnostics intake', () => {
  it('logs only bounded technical fields, stripping queries, fragments and unknown user content', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await receiveDiagnostics(request({ events: [{ ...event, message: 'private text', stack: 'private stack', cookie: 'private cookie' }] }), limiter);
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatchObject({ event: 'verba_client_diagnostic', site: 'non.verbacorpus.org', browser: 'safari', browserMajor: 26, kind: 'script_error', path: '/upa/page-frames', resource: '/upa/assets/client.js', error: 'TypeError', line: 12 });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|token|cookie|stack/);
  });
  it('requires a same-origin JSON POST and a configured, successful rate limiter', async () => {
    expect((await receiveDiagnostics(new Request('https://non.verbacorpus.org/_diagnostics'), limiter)).status).toBe(405);
    expect((await receiveDiagnostics(request(undefined, { origin: 'https://example.org' }), limiter)).status).toBe(403);
    expect((await receiveDiagnostics(request(undefined, { origin: '' }), limiter)).status).toBe(403);
    expect((await receiveDiagnostics(request(undefined, { 'content-type': 'text/plain' }), limiter)).status).toBe(415);
    expect((await receiveDiagnostics(request())).status).toBe(503);
    expect((await receiveDiagnostics(request(), { limit: async () => ({ success: false }) })).status).toBe(429);
    expect((await receiveDiagnostics(request(), { limit: async () => { throw new Error('binding unavailable'); } })).status).toBe(503);
  });
  it('allows a loopback origin only in an explicitly local same-origin preview', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const local = () => request(undefined, { origin: 'http://127.0.0.1:8794', 'sec-fetch-site': 'same-origin' });
    expect((await receiveDiagnostics(local(), limiter)).status).toBe(403);
    expect((await receiveDiagnostics(local(), limiter, true)).status).toBe(204);
    expect((await receiveDiagnostics(request(undefined, { origin: 'https://example.org', 'sec-fetch-site': 'same-origin' }), limiter, true)).status).toBe(403);
  });
  it('bounds streamed input even without Content-Length and rejects malformed reports', async () => {
    const oversized = request({ events: [event], extra: 'x'.repeat(5_000) });
    expect(oversized.headers.has('content-length')).toBe(false);
    expect((await receiveDiagnostics(oversized, limiter)).status).toBe(413);
    for (const body of [{}, { events: [] }, { events: Array(7).fill(event) }, { events: [{ ...event, kind: 'arbitrary' }] }, { events: [{ ...event, path: '//external.example/private' }] }]) {
      expect((await receiveDiagnostics(request(body), limiter)).status).toBe(400);
    }
  });
  it('drops invalid optional fields and never records arbitrary error strings or external URLs', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await receiveDiagnostics(request({ events: [{ ...event, error: 'private message', resource: 'https://external.example/private', line: Infinity, elapsed: -10 }] }), limiter)).status).toBe(204);
    const value = log.mock.calls[0][0];
    expect(value.resource).toBeUndefined(); expect(value.error).toBeUndefined(); expect(value.line).toBeUndefined(); expect(value.elapsed).toBe(0);
  });
});

describe('bootstrap CSP permission', () => {
  it.each([
    ["default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'", "script-src 'self' 'wasm-unsafe-eval' 'nonce-test'"],
    ["default-src 'none'; img-src 'self'", "script-src 'nonce-test'"],
    ["script-src 'self'; script-src-elem 'none'", "script-src-elem 'nonce-test'"],
  ])('preserves restrictions while allowing only the bootstrap nonce: %s', (policy, script) => {
    const output = allowDiagnosticsNonce(policy, 'test');
    expect(output).toContain(script); expect(output).not.toContain("'unsafe-inline'");
    for (const part of policy.split(';').map(part => part.trim()).filter(part => !part.startsWith('script-src'))) expect(output).toContain(part);
  });
});
