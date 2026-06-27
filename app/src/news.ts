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
