import { type Proverb } from "./corpus";

export type Format = "json" | "jsonl" | "xml" | "csv" | "tsv";
export type Rec = Proverb & { explanation?: string | null; score?: number };

const FORMATS: readonly string[] = ["json", "jsonl", "xml", "csv", "tsv"];

export function negotiate(formatParam: string | null, accept: string | null): Format | null {
  if (formatParam) return (FORMATS.includes(formatParam) ? formatParam : null) as Format | null;
  const a = (accept ?? "").toLowerCase();
  if (a.includes("application/x-ndjson")) return "jsonl";
  if (a.includes("text/tab-separated-values")) return "tsv";
  if (a.includes("text/csv")) return "csv";
  if (a.includes("application/xml") || a.includes("text/xml")) return "xml";
  return "json";
}

const CT: Record<Format, string> = {
  json: "application/json; charset=utf-8",
  jsonl: "application/x-ndjson; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
};

const cell = (r: Rec, c: string): string => {
  if (c === "category") return (r.category ?? []).join(";");
  if (c === "sources") return (r.sources ?? []).join(";");
  if (c === "explanation") return r.explanation ?? "";
  return String((r as Record<string, unknown>)[c] ?? "");
};
const csvField = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const tsvField = (s: string): string => s.replace(/[\t\n\r]+/g, " ");
const xmlEsc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function serialize(
  records: Rec[],
  format: Format,
  opts: { single?: boolean; total?: number; limit?: number; offset?: number; withExplanation?: boolean; name?: string } = {},
): { body: string; contentType: string; filename?: string } {
  const cols = ["id", "text", "modern_text", "category", "sources", "variant_group", "hook", "hook_source", ...(opts.withExplanation ? ["explanation"] : [])];
  const fn = (ext: string) => `proverbs-${opts.name ?? "export"}.${ext}`;

  if (format === "json") {
    const body = opts.single
      ? JSON.stringify(records[0] ?? null)
      : JSON.stringify({ total: opts.total ?? records.length, limit: opts.limit, offset: opts.offset, results: records });
    return { body, contentType: CT.json };
  }
  if (format === "jsonl") {
    return { body: records.map((r) => JSON.stringify(r)).join("\n"), contentType: CT.jsonl, filename: fn("jsonl") };
  }
  if (format === "xml") {
    const items = records.map((r) =>
      `  <proverb id="${xmlEsc(r.id)}">` +
      `<text>${xmlEsc(r.text)}</text><modern_text>${xmlEsc(r.modern_text)}</modern_text>` +
      `<category>${xmlEsc((r.category ?? []).join(";"))}</category><sources>${xmlEsc((r.sources ?? []).join(";"))}</sources>` +
      `<hook>${xmlEsc(r.hook ?? "")}</hook><hook_source>${xmlEsc(r.hook_source ?? "")}</hook_source>` +
      (opts.withExplanation ? `<explanation>${xmlEsc(r.explanation ?? "")}</explanation>` : "") +
      `</proverb>`).join("\n");
    return { body: `<?xml version="1.0" encoding="UTF-8"?>\n<proverbs>\n${items}\n</proverbs>\n`, contentType: CT.xml, filename: fn("xml") };
  }
  // csv / tsv
  const field = format === "csv" ? csvField : tsvField;
  const sep = format === "csv" ? "," : "\t";
  const header = cols.join(sep);
  const rows = records.map((r) => cols.map((c) => field(cell(r, c))).join(sep));
  return { body: [header, ...rows].join("\n") + "\n", contentType: CT[format], filename: fn(format) };
}
