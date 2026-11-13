import { describe, it, expect } from 'vitest';
import { siteSection, siteNavigation, withSiteShell } from '../src/site-shell';

describe('shared Verba shell', () => {
  it('uses canonical umbrella and non hosts, with the correct section on nested pages', () => {
    for (const [path, section] of [['/', ''], ['/pro/', 'pro'], ['/en/p/p1', 'pro'], ['/contra/', 'contra'], ['/blog/story', 're'], ['/para/', 'para'], ['/non/upa/en/page-frames', 'non']]) {
      const url = new URL(path, 'https://verbacorpus.org');
      expect(siteSection(url)).toBe(section);
      const html = siteNavigation(url);
      expect(html).toContain('href="https://verbacorpus.org"');
      expect(html).toContain('href="https://non.verbacorpus.org/"');
      expect(html.match(/aria-current=/g)).toHaveLength(1);
      expect(html).toContain(`data-verba-direction="${section}"`);
    }
    expect(siteSection(new URL('https://non.verbacorpus.org/'))).toBe('non');
    expect(siteNavigation(new URL('http://localhost:8794/para/'))).toContain('href="/non/"');
    expect(siteNavigation(new URL('https://verbacorpus.org/en/non/upa/'))).toContain('href="https://verbacorpus.org/en/pro/"');
    expect(siteNavigation(new URL('https://verbacorpus.org/para/'), true)).not.toContain('href="https://');
  });
  it('gives landing pages and mounted tools one shell without remounting its assets', async () => {
    for (const path of ['/para/', '/non/upa/page-frames']) {
      const html = '<html><head></head><body><nav class="topbar">Old</nav><main id="main">Content</main></body></html>';
      const response = withSiteShell(new Response(html, { headers: { 'content-type': 'text/html', etag: 'old', 'content-security-policy': "script-src 'self'" } }), new Request('https://non.verbacorpus.org' + path));
      const output = await response.text();
      expect(output.match(/data-verba-navigation/g)).toHaveLength(1);
      expect(output).toContain('src="/site-shell.js"');
      expect(output).toContain('href="/site-shell.css"');
      expect(output).toContain('id="verba-content"');
      expect(output).not.toContain('class="topbar"');
      expect(response.headers.has('etag')).toBe(false);
      expect(response.headers.get('content-security-policy')).toBe("script-src 'self'");
    }
  });
  it('preserves local language navigation and leaves API and downloaded bytes intact', async () => {
    const response = withSiteShell(new Response('<html><head></head><body><nav class="topbar"><div id="langSwitch"></div></nav><main>Proverbs</main></body></html>', { headers: { 'content-type': 'text/html' } }), new Request('https://verbacorpus.org/pro/'));
    expect(await response.text()).toContain('class="verba-sectionbar"><div id="langSwitch">');
    const api = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    expect(withSiteShell(api, new Request('https://verbacorpus.org/api/v1/meta'))).toBe(api);
    const docs = new Response('<html>Swagger</html>', { headers: { 'content-type': 'text/html' } });
    expect(withSiteShell(docs, new Request('https://non.verbacorpus.org/non/upa/api/v1/docs'))).toBe(docs);
  });
});
