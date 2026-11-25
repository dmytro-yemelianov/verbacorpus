import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { canonicalAddress, publicHref, hostDirection } from '../src/shared/site-addresses';

describe('canonical Verba addresses', () => {
  it.each(['pro', 'contra', 're', 'para', 'non'])('uses one namespace for %s', prefix => {
    expect(canonicalAddress(new URL(`https://verbacorpus.org/${prefix}/?q=word`))?.href).toBe(`https://${prefix}.verbacorpus.org/?q=word`);
    expect(canonicalAddress(new URL(`https://${prefix}.verbacorpus.org/${prefix}/`))?.href).toBe(`https://${prefix}.verbacorpus.org/`);
    expect(canonicalAddress(new URL(`https://${prefix}.verbacorpus.org/`))).toBeNull();
    expect(hostDirection(`${prefix}.verbacorpus.org.example.com`)).toBeUndefined();
  });
  it.each([
    ['https://non.verbacorpus.org/non/upa/letters-lab?style=cut&height=16#sample', 'https://para.verbacorpus.org/letters-lab?style=cut&height=16#sample'],
    ['https://verbacorpus.org/non/upa/en/letters-lab?height=12', 'https://para.verbacorpus.org/en/letters-lab?height=12'],
    ['https://non.verbacorpus.org/upa/letters-lab', 'https://para.verbacorpus.org/letters-lab'],
    ['https://para.verbacorpus.org/para/letters-lab', 'https://para.verbacorpus.org/letters-lab'],
    ['https://non.verbacorpus.org/upa/fonts?font=creep-7x12', 'https://para.verbacorpus.org/fonts?font=creep-7x12'],
    ['https://verbacorpus.org/para/en/fonts', 'https://para.verbacorpus.org/en/fonts'],
    ['https://non.verbacorpus.org/non/upa?color=red&color=blue', 'https://non.verbacorpus.org/upa/?color=red&color=blue'],
    ['https://verbacorpus.org/en/pro/?q=word&src=Nomis1864', 'https://pro.verbacorpus.org/en/?q=word&src=Nomis1864'],
    ['https://verbacorpus.org/?q=word&src=Nomis1864', 'https://pro.verbacorpus.org/?q=word&src=Nomis1864'],
    ['https://non.verbacorpus.org/corpora', 'https://verbacorpus.org/'],
    ['https://verbacorpus.org/blog/dzherela', 'https://re.verbacorpus.org/blog/dzherela'],
    ['https://re.verbacorpus.org/blog/?q=source', 'https://re.verbacorpus.org/blog?q=source'],
    ['https://verbacorpus.org/en/blog/', 'https://re.verbacorpus.org/en/blog'],
  ])('resolves %s in one step', (from, to) => {
    expect(canonicalAddress(new URL(from))?.href).toBe(to);
    expect(canonicalAddress(new URL(to))).toBeNull();
  });
  it('retains archive context and document fragments while replacing old links', () => {
    const from = new URL('https://non.verbacorpus.org/non/upa/page-frames?paper=a5&from=%2Fnon%2Fupa%2F%3Fq%3D151#title=%D0%87%D0%B6%D0%B0%D0%BA');
    const target = canonicalAddress(from)!;
    expect(target.hostname).toBe('non.verbacorpus.org'); expect(target.pathname).toBe('/upa/page-frames');
    expect(target.searchParams.get('paper')).toBe('a5');
    expect(target.searchParams.get('from')).toBe('/upa/?q=151'); expect(target.hash).toBe(from.hash);
  });
  it('does not redirect assets, API aliases, external sites or already canonical URLs', () => {
    expect(canonicalAddress(new URL('http://pro.verbacorpus.org/'))?.href).toBe('https://pro.verbacorpus.org/');
    for (const url of ['https://pro.verbacorpus.org/?q=word', 'https://para.verbacorpus.org/font.json', 'https://para.verbacorpus.org/assets/site.js', 'https://verbacorpus.org/api/v1/meta', 'https://verbacorpus.org.example.com/pro/']) expect(canonicalAddress(new URL(url))).toBeNull();
    expect(publicHref('https://example.org/pro/', new URL('https://verbacorpus.org/'))).toBe('https://example.org/pro/');
  });
  it('rewrites cards and cross-site links while local previews stay local', () => {
    const root = new URL('https://verbacorpus.org/'), non = new URL('https://non.verbacorpus.org/');
    expect(publicHref('/para/', root)).toBe('https://para.verbacorpus.org/');
    expect(publicHref('/non/icons/sun.svg', non)).toBe('/icons/sun.svg');
    expect(publicHref('https://para.verbacorpus.org/letters-lab', root, true)).toBe('/letters-lab');
    expect(publicHref('/non/upa/page-frames#title=test', root, true)).toBe('/upa/page-frames#title=test');
    expect(publicHref('/en/blog/?q=source', root, true)).toBe('/en/blog?q=source');
    expect(publicHref('/non/upa/letters-lab', root, true)).toBe('/letters-lab');
    expect(publicHref('https://para.verbacorpus.org/fonts?font=cozette', root, true)).toBe('/fonts?font=cozette');
  });
  it('redirects human legacy URLs before touching either backend', async () => {
    const response = await worker.fetch(new Request('https://non.verbacorpus.org/non/upa/letters-lab?style=cut'), {} as never);
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://para.verbacorpus.org/letters-lab?style=cut');
  });
  it('keeps legacy POST bodies intact while serving them through the canonical UPA address', async () => {
    const seen: string[] = [];
    const response = await worker.fetch(new Request('https://non.verbacorpus.org/non/upa/api/local/variations?mode=preview', { method: 'POST', body: '{"seed":"example"}', headers: { 'content-type': 'application/json' } }), {
      UPA: { async fetch(request: Request) { seen.push(request.url, await request.text()); return Response.json({ ok: true }); } },
    } as never);
    expect(response.status).toBe(200); expect(seen).toEqual(['https://non.verbacorpus.org/api/local/variations?mode=preview', '{"seed":"example"}']);
  });
});
