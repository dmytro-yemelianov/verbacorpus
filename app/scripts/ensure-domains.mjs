import { readFile } from 'node:fs/promises';
const account = process.env.CLOUDFLARE_ACCOUNT_ID || '8ed62a6f8081b1e5db4ffd78d3c6b65f';
const token = process.env.CLOUDFLARE_API_TOKEN;
const zone = process.env.CLOUDFLARE_ZONE_ID || 'e883deaaf0450d7c7669647641ad2d59';
if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required');
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/domains`;
async function call(method, body) {
  const response = await fetch(endpoint, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`Worker domain setup failed (${response.status}): ${JSON.stringify(data.errors)}`);
  return data.result;
}
const existing = await call('GET');
for (const name of ['wrangler.jsonc', 'wrangler.non.jsonc']) {
  const config = JSON.parse(await readFile(new URL('../' + name, import.meta.url), 'utf8'));
  for (const route of config.routes.filter(route => route.custom_domain)) {
    if (!/^(?:(?:www|pro|contra|re|para|non)\.)?verbacorpus\.org$/.test(route.pattern)) throw new Error('Unexpected Verba domain');
    const prior = existing.find(domain => domain.hostname === route.pattern);
    if (prior && prior.service !== config.name) throw new Error(`${route.pattern} belongs to another Worker; retaining it`);
    if (prior) { console.log(`Verified ${route.pattern} → ${config.name}`); continue; }
    await call('PUT', { hostname: route.pattern, service: config.name, zone_id: zone, enabled: true, previews_enabled: false });
    console.log(`Attached ${route.pattern} → ${config.name}`);
  }
}
