import { describe, it, expect } from "vitest";
import { negotiate, serialize, type Rec } from "../src/shared/serialize";

const R = (id: string, over: Partial<Rec> = {}): Rec =>
  ({ id, text: `t,${id}`, modern_text: `m"${id}`, category: ["a", "b"], sources: ["S"], variant_group: "", ...over });
const recs: Rec[] = [R("p1"), R("p2")];

describe("negotiate", () => {
  it("?format wins, valid", () => expect(negotiate("csv", "application/json")).toBe("csv"));
  it("unknown ?format -> null", () => expect(negotiate("yaml", null)).toBeNull());
  it("Accept fallback", () => {
    expect(negotiate(null, "text/csv")).toBe("csv");
    expect(negotiate(null, "application/x-ndjson")).toBe("jsonl");
    expect(negotiate(null, "*/*")).toBe("json");
    expect(negotiate(null, null)).toBe("json");
  });
  it("tsv via Accept header", () => {
    expect(negotiate(null, "text/tab-separated-values")).toBe("tsv");
  });
});

describe("serialize", () => {
  it("json collection envelope", () => {
    const r = serialize(recs, "json", { total: 9, limit: 50, offset: 0 });
    expect(r.contentType).toContain("application/json");
    expect(JSON.parse(r.body)).toEqual({ total: 9, limit: 50, offset: 0, results: recs });
    expect(r.filename).toBeUndefined();
  });
  it("json single", () => {
    expect(JSON.parse(serialize([recs[0]], "json", { single: true }).body)).toEqual(recs[0]);
  });
  it("jsonl one object per line", () => {
    const r = serialize(recs, "jsonl", { name: "search" });
    expect(r.body.split("\n").length).toBe(2);
    expect(JSON.parse(r.body.split("\n")[0]).id).toBe("p1");
    expect(r.filename).toBe("proverbs-search.jsonl");
    expect(r.contentType).toContain("x-ndjson");
  });
  it("csv RFC-4180 quoting + header", () => {
    const r = serialize([R("p1")], "csv", { name: "x" });
    const lines = r.body.trim().split("\n");
    expect(lines[0]).toBe("id,text,modern_text,category,sources,variant_group,hook,hook_source");
    expect(lines[1]).toBe('p1,"t,p1","m""p1",a;b,S,,,');   // comma & quote escaped, hook/hook_source empty
    expect(r.filename).toBe("proverbs-x.csv");
  });
  it("csv adds explanation column when withExplanation", () => {
    const r = serialize([R("p1", { explanation: "ex" })], "csv", { withExplanation: true });
    expect(r.body.split("\n")[0]).toBe("id,text,modern_text,category,sources,variant_group,hook,hook_source,explanation");
  });
  it("tsv strips tabs/newlines", () => {
    const r = serialize([R("p1", { text: "a\tb\nc" })], "tsv");
    expect(r.contentType).toContain("tab-separated");
    expect(r.body.split("\n")[1].split("\t")[1]).toBe("a b c");
  });
  it("xml escaped + well-formed-ish", () => {
    const r = serialize([R("p1", { text: "a<b&c" })], "xml");
    expect(r.body).toContain("<proverbs>");
    expect(r.body).toContain("<text>a&lt;b&amp;c</text>");
    expect(r.contentType).toContain("application/xml");
  });
});
