export type NewsItem = { id: string; title: string; link: string; source: string; ts: number };

// FNV-1a hash of the link → short stable id (KV key suffix).
export function newsId(link: string): string {
  let h = 2166136261;
  for (let i = 0; i < link.length; i++) { h ^= link.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const stripTags = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();

const tag = (block: string, name: string): string => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripTags(m[1]) : "";
};

export function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const title = tag(block, "title");
    const link = tag(block, "link");
    if (!title || !link) continue;
    const pub = tag(block, "pubDate");
    const ts = pub ? Date.parse(pub) || 0 : 0;
    items.push({ id: newsId(link), title, link, source, ts });
  }
  return items.sort((a, b) => b.ts - a.ts);
}

export function parseTgPreview(html: string, channel: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of html.matchAll(/<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?<\/time>/gi)) {
    const block = m[0];
    const post = m[1]; // "channel/123"
    const tm = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const title = tm ? stripTags(tm[1]) : "";
    if (!title) continue;
    const dm = block.match(/datetime="([^"]+)"/i);
    const ts = dm ? Date.parse(dm[1]) || 0 : 0;
    const link = `https://t.me/${post}`;
    items.push({ id: newsId(link), title, link, source: `@${channel}`, ts });
  }
  return items.sort((a, b) => b.ts - a.ts);
}

export const NEWS_BATCH = 3;
export const RSS_FEEDS = [
  { url: "https://www.pravda.com.ua/rss/", source: "Українська правда" },
  { url: "https://suspilne.media/rss/all.rss", source: "Суспільне" },
  { url: "https://www.ukrinform.ua/rss/block-lastnews", source: "Укрінформ" },
];
export const TG_CHANNELS = ["D7_channel", "purrphyrogenit", "yigal_levin", "gruntmedia", "ukrbavovna", "notnets", "marshalvdv", "prozapas77"];

export type KVLike = { get(k: string): Promise<string | null>; put(k: string, v: string, o?: any): Promise<void>; delete(k: string): Promise<void> };
export type Draft = { newsTitle: string; link: string; source: string; proverbIds: string[] };

type FetchImpl = (url: string) => Promise<Response>;

// Fan out all sources; per-source failures are logged and skipped, never thrown.
export async function gatherNews(fetchImpl: FetchImpl): Promise<NewsItem[]> {
  const jobs: Promise<NewsItem[]>[] = [];
  for (const f of RSS_FEEDS) jobs.push(
    fetchImpl(f.url).then((r) => r.text()).then((x) => parseRss(x, f.source)).catch((e) => { console.error("rss", f.url, e); return []; }));
  for (const c of TG_CHANNELS) jobs.push(
    fetchImpl(`https://t.me/s/${c}`).then((r) => r.text()).then((h) => parseTgPreview(h, c)).catch((e) => { console.error("tg", c, e); return []; }));
  const all = (await Promise.all(jobs)).flat();
  return all.sort((a, b) => b.ts - a.ts);
}

export async function markSeen(kv: KVLike, id: string): Promise<void> {
  await kv.put(`seen:${id}`, "1", { expirationTtl: 604800 }); // 7d
}
export async function pickUnseen(items: NewsItem[], kv: KVLike, n: number): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  for (const it of items) {
    if (out.length >= n) break;
    if (await kv.get(`seen:${it.id}`)) continue;
    out.push(it);
  }
  return out;
}
export async function putDraft(kv: KVLike, id: string, d: Draft): Promise<void> {
  await kv.put(`draft:${id}`, JSON.stringify(d), { expirationTtl: 86400 }); // 24h
}
export async function getDraft(kv: KVLike, id: string): Promise<Draft | null> {
  const v = await kv.get(`draft:${id}`);
  return v ? (JSON.parse(v) as Draft) : null;
}
export async function delDraft(kv: KVLike, id: string): Promise<void> {
  await kv.delete(`draft:${id}`);
}
