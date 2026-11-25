import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
test('proverb service worker leaves UPA pages, assets and POSTs to the network', () => {
  const listeners = {};
  runInNewContext(source, { self: { addEventListener: (name, handler) => { listeners[name] = handler; } }, URL });
  for (const [path, method] of [['/non/upa', 'GET'], ['/non/upa/p/p1', 'GET'], ['/non/upa/assets/site.js', 'GET'], ['/non/upa/api/local/variations', 'POST']]) {
    let intercepted = false;
    listeners.fetch({ request: { url: 'https://verbacorpus.org' + path, method }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, `${method} ${path}`);
  }
});
test('proverb service worker retains the existing proverb page cache policy', async () => {
  const listeners = {};
  const response = new Response('proverbs');
  runInNewContext(source, {
    self: { addEventListener: (name, handler) => { listeners[name] = handler; } }, URL,
    fetch: async () => response,
    caches: { open: async () => ({ put: async () => {} }) },
  });
  let result;
  listeners.fetch({ request: { url: 'https://verbacorpus.org/pro/' }, respondWith: promise => { result = promise; } });
  assert.equal(await (await result).text(), 'proverbs');
});
