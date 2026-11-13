import { describe, expect, it } from 'vitest';
import { upaRequest } from '../src/upa';

const request = (path: string, init?: RequestInit) => new Request('https://verbacorpus.org' + path, init);
describe('UPA mounted in non.verba', () => {
  it('serves the full font catalogue and its index directly on para', async () => {
    const response = await upaRequest(new Request('https://para.verbacorpus.org/fonts?font=creep-7x12'), { async fetch() {
      return new Response('<html><head></head><body><a href="/font-index.json">Index</a><a href="/letters-lab">Lab</a><script src="/assets/fonts.js"></script></body></html>', { headers: { 'content-type': 'text/html' } });
    } });
    const html = await response!.text();
    expect(html).toContain('href="/font-index.json"'); expect(html).toContain('href="/letters-lab"');
    const index = await upaRequest(new Request('https://para.verbacorpus.org/font-index.json'), { async fetch(req: Request) { return Response.json({ path: new URL(req.url).pathname }); } });
    expect(await index!.json()).toEqual({ path: '/font-index.json' });
  });
  it('serves alphabet pages and their assets directly on para without an archive prefix', async () => {
    const service = { async fetch() { return new Response('<html><head></head><body><a data-language href="/en/letters-lab">EN</a><a href="/page-frames#font-catalog">Editor</a><script src="/assets/letters.js"></script></body></html>', { headers: { 'content-type': 'text/html' } }); } };
    const response = await upaRequest(new Request('https://para.verbacorpus.org/letters-lab?style=cut'), service);
    const html = await response!.text();
    expect(html).toContain('content=""'); expect(html).toContain('href="/en/letters-lab?style=cut"');
    expect(html).toContain('href="https://non.verbacorpus.org/upa/page-frames#font-catalog"');
    expect(html).toContain('src="/assets/letters.js"'); expect(html).not.toContain('/non/upa');
    const asset = await upaRequest(new Request('https://para.verbacorpus.org/assets/letters.js'), { async fetch(req: Request) { return new Response(new URL(req.url).pathname, { headers: { 'content-type': 'application/javascript' } }); } });
    expect(await asset!.text()).toBe('/assets/letters.js');
  });
  it('keeps proverb routes and similarly named paths outside the UPA service', async () => {
    expect(await upaRequest(request('/api/v1/search'))).toBeNull();
    expect(await upaRequest(request('/upa-extra'))).toBeNull();
    expect((await upaRequest(request('/upa/')))?.status).toBe(503);
  });
  it('returns an API outage as JSON and leaves HEAD responses empty', async () => {
    const response = await upaRequest(request('/upa/api/v1/patterns'));
    expect(response!.status).toBe(503);
    expect(response!.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response!.json()).toEqual({ apiVersion: 'v1', error: { code: 'unavailable', message: 'UPA archive is unavailable' } });
    const head = await upaRequest(request('/upa/', { method: 'HEAD' }));
    expect(head!.status).toBe(503);
    expect(await head!.text()).toBe('');
  });
  it('forwards generator bodies and query strings to the canonical Worker', async () => {
    const response = await upaRequest(request('/upa/api/local/variations?mode=preview', { method: 'POST', body: '{"seed":"example"}', headers: { 'content-type': 'application/json' } }), {
      async fetch(input, init) {
        const received = new Request(input, init);
        expect(new URL(received.url).pathname + new URL(received.url).search).toBe('/api/local/variations?mode=preview');
        expect(received.method).toBe('POST');
        expect(await received.json()).toEqual({ seed: 'example' });
        return Response.json({ source: { svg: '<svg/>' } });
      },
    });
    expect(await response?.json()).toEqual({ source: { svg: '<svg/>' } });
  });
  it('mounts HTML navigation, charts, responsive images and atlas metadata', async () => {
    const response = await upaRequest(request('/upa/p/p07_L_b00'), {
      async fetch() { return new Response('<html><head></head><body data-atlas-url="/assets/atlas.webp" style="--image:url(\'/assets/atlas.webp\')"><a href="/en/p/p07_L_b00?scope=unit">EN</a><img src="/patterns/p07_L_b00/full.svg" srcset="/patterns/p07_L_b00/a.webp 100w, /patterns/p07_L_b00/b.webp 200w"><a href="/upa/p/p1">Mounted</a><a href="https://example.org">Source</a></body></html>', { headers: { 'content-type': 'text/html', etag: 'original' } }); },
    });
    const html = await response!.text();
    expect(html).toContain('name="upa-base-path" content="/upa"');
    expect(html).toContain('href="/upa/en/p/p07_L_b00?scope=unit"');
    expect(html).toContain('src="/upa/patterns/p07_L_b00/full.svg"');
    expect(html).toContain('/upa/patterns/p07_L_b00/b.webp 200w');
    expect(html).toContain('data-atlas-url="/upa/assets/atlas.webp"');
    expect(html).toContain("url('/upa/assets/atlas.webp')");
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain('href="/upa/p/p1"');
    expect(html).not.toContain('/upa/upa/');
    expect(response!.headers.has('etag')).toBe(false);
  });
  it('mounts API links without modifying cell geometry or identity strings', async () => {
    const response = await upaRequest(request('/upa/api/v1/patterns'), {
      async fetch() { return Response.json({ items: [{ matrix: [['/']], stitches: [['/']], links: { self: '/api/v1/patterns/p1', catalog: '/catalog?page=7#p1' } }], endpoints: { search: 'GET /api/v1/patterns' } }); },
    });
    expect(await response!.json()).toEqual({ items: [{ matrix: [['/']], stitches: [['/']], links: { self: '/upa/api/v1/patterns/p1', catalog: '/upa/catalog?page=7#p1' } }], endpoints: { search: 'GET /upa/api/v1/patterns' } });
  });
  it('retains safe catalog context in initial HTML before client modules load', async () => {
    const service = { async fetch() { return new Response('<html><head></head><body><a data-language href="/p/p1">UK</a><a data-browse-back href="/en/#browse">Back</a><a href="/en/generate?source=p1">Generate</a></body></html>', { headers: { 'content-type': 'text/html' } }); } };
    const from = encodeURIComponent('/upa/?q=151&ignored=drop#browse');
    const html = await (await upaRequest(request('/upa/en/p/p1?from=' + from), service))!.text();
    expect(html).toContain('href="/upa/p/p1?from=' + from + '"');
    expect(html).toContain('href="/upa/en/?q=151#browse"');
    expect(html).toContain('from=%2Fupa%2Fen%2F%3Fq%3D151%23browse');
    const unsafe = await (await upaRequest(request('/upa/en/p/p1?from=https://example.org/'), service))!.text();
    expect(unsafe).toContain('data-browse-back href="/upa/en/#browse"');
  });
  it('mounts OpenAPI servers and Swagger configuration', async () => {
    const service = { async fetch(input: RequestInfo | URL) {
      return new URL(input instanceof Request ? input.url : String(input)).pathname.endsWith('openapi.json')
        ? Response.json({ servers: [{ url: '/' }], paths: { '/api/v1/patterns': {} } })
        : new Response('<html><head></head><body><script>SwaggerUIBundle({ url: "/api/v1/openapi.json" })</script></body></html>', { headers: { 'content-type': 'text/html' } });
    } };
    expect(await (await upaRequest(request('/upa/api/v1/openapi.json'), service))!.json()).toEqual({ servers: [{ url: '/upa/' }], paths: { '/api/v1/patterns': {} } });
    expect(await (await upaRequest(request('/upa/api/v1/docs'), service))!.text()).toContain('url: "/upa/api/v1/openapi.json"');
  });
  it('preserves downloads and mounts redirects and stylesheets', async () => {
    const binary = new Uint8Array([0, 17, 255]);
    const response = await upaRequest(request('/upa/patterns/p1/full.webp'), { async fetch() { return new Response(binary, { headers: { 'content-type': 'image/webp', 'content-disposition': 'attachment; filename="p1.webp"' } }); } });
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(binary);
    expect(response!.headers.get('content-disposition')).toContain('p1.webp');
    const redirected = await upaRequest(request('/upa/source-pages/page_07.png'), { async fetch() { return new Response(null, { status: 301, headers: { location: '/source-pages/page_07.webp' } }); } });
    expect(redirected!.headers.get('location')).toBe('/upa/source-pages/page_07.webp');
    const stylesheet = await upaRequest(request('/upa/assets/site.css'), { async fetch() { return new Response('body{background:url("/assets/paper.svg")}', { headers: { 'content-type': 'text/css' } }); } });
    expect(await stylesheet!.text()).toContain('url("/upa/assets/paper.svg")');
  });
});
