export interface TabuEntry {
  sourceRow: number;
  group: string;
  term: string;
  synonym: string;
  isWord: boolean;
  term_emoji: string;
}
export interface TabuFilters { q: string; group: string; term: string; kind: string }
export const MISSING_TERM = "__missing__";

export function normalizeTabu(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("uk").replace(/[’ʼ`]/g, "'").replace(/\s+/g, " ").trim();
}

export function filterTabu(entries: TabuEntry[], filters: TabuFilters): TabuEntry[] {
  const words = normalizeTabu(filters.q).split(" ").filter(Boolean);
  return entries.filter(e =>
    (!filters.group || e.group === filters.group) &&
    (!filters.term || (e.term || MISSING_TERM) === filters.term) &&
    (!filters.kind || e.isWord === (filters.kind === "word")) &&
    words.every(word => normalizeTabu(`${e.synonym} ${e.term} ${e.group}`).includes(word))
  );
}
