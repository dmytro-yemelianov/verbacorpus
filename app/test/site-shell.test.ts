import { describe, it, expect } from 'vitest';
import { siteSection, siteNavigation, siteFooter, withSiteShell } from '../src/site-shell';

describe('shared Verba shell', () => {
  it('provides one canonical author link and shared project links for every host and locale', () => {
    for (const host of ['verbacorpus.org', ...['pro', 'contra', 're', 'para', 'non'].map(prefix => `${prefix}.verbacorpus.org`)]) for (const path of ['/', '/en/', '/upa/en/page-frames']) {
      const footer = siteFooter(new URL('https://' + host + path));
      expect(footer.match(/data-verba-author/g)).toHaveLength(1);
      expect(footer).toContain('href="https://yemelianov.dev/"');
      expect(footer).toContain('href="https://verbacorpus.org"');
      expect(footer).toContain('data-no-localize');
      expect(footer).toContain(path.includes('/en') ? 'Dmytro Yemelianov' : 'Дмитро Ємельянов');
    }
    expect(siteFooter(new URL('http://localhost/upa/'), true)).toContain('href="/corpora"');
  });
  it('keeps corpus source notes but replaces unrelated landing footers and fixes para tool metadata', async () => {
    const html = '<html><head><title>Old · upa</title><meta name="description" content="Ornaments"></head><body><main>Content<svg><title>Glyph sample</title></svg></main><footer class="colophon"><p>Source licence and attribution</p></footer></body></html>';
    for (const path of ['/upa/page-frames', '/pro/', '/fonts', '/en/letters-lab', '/para/']) {
      const response = withSiteShell(new Response(html, { headers: { 'content-type': 'text/html' } }), new Request('http://localhost' + path), true);
      const output = await response.text();
      expect(output.match(/<footer\b/g)).toHaveLength(1);
      expect(output.match(/data-verba-author/g)).toHaveLength(1);
      expect(output).toContain('<title>Glyph sample</title>');
      if (path.startsWith('/upa') || path === '/pro/') {
        expect(output).toContain('Source licence and attribution'); expect(output).toContain('data-verba-context');
      } else expect(output).not.toContain('Source licence and attribution');
      if (path === '/fonts' || path.includes('letters-lab')) {
        expect(output).toContain('· para.verba</title>'); expect(output).not.toContain('content="Ornaments"');
      }
    }
  });
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
    expect(siteNavigation(new URL('https://verbacorpus.org/en/non/upa/'))).toContain('href="https://pro.verbacorpus.org/en/"');
    const mountedEnglish = siteNavigation(new URL('https://non.verbacorpus.org/non/upa/en/page-frames'));
    expect(mountedEnglish).toContain('All directions');
    expect(mountedEnglish).toContain('href="https://pro.verbacorpus.org/en/"');
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
