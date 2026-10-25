export interface TabuEntry {
  sourceRow: number;
  group: string;
  term: string;
  synonym: string;
  isWord: boolean;
  term_emoji: string;
}
export interface TabuFilters { q: string; group: string; term: string; kind: string; spelling?: string }
export const MISSING_TERM = "__missing__";

export function spreadTabu(entries: TabuEntry[]): TabuEntry[] {
  const buckets = new Map<string, TabuEntry[]>();
  for (const e of entries) {
    const key = JSON.stringify([e.group, e.term]);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
  }
  const result: TabuEntry[] = [];
  for (let i = 0; result.length < entries.length; i++) {
    for (const bucket of buckets.values()) if (bucket[i]) result.push(bucket[i]);
  }
  return result;
}

export function normalizeTabu(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("uk").replace(/[’ʼ`]/g, "'").replace(/\s+/g, " ").trim();
}

export function filterTabu(entries: TabuEntry[], filters: TabuFilters): TabuEntry[] {
  const words = normalizeTabu(filters.q).split(" ").filter(Boolean);
  return entries.filter(e =>
    (!filters.spelling || e.synonym === filters.spelling) &&
    (!filters.group || e.group === filters.group) &&
    (!filters.term || (e.term || MISSING_TERM) === filters.term) &&
    (!filters.kind || e.isWord === (filters.kind === "word")) &&
    words.every(word => normalizeTabu(`${e.synonym} ${e.term} ${e.group}`).includes(word))
  );
}
