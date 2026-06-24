// Human-readable display labels for the corpus source keys (used by the cards,
// the /p pages, and the PWA UI). The keys are the canonical source identifiers.
export const SOURCE_LABELS: Record<string, string> = {
  Franko1901: "Франко 1901",
  Nomis1864: "Номис 1864",
  Bobkova: "Бобкова",
  Mlodzynskyi2009: "Млодзинський 2009",
  Ilkevich1841: "Ількевич 1841",
};

export function srcLabel(key: string): string {
  return SOURCE_LABELS[key] ?? key;
}
