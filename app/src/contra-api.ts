// Read API for the "Українська без табу" dictionary (corpus "contra").
import ids from "../content/bez-tabu-ids.json";

export interface ContraEntry {
  id: string;
  group: string;
  term: string;
  synonym: string;
  isWord: boolean;
  emoji: string | null;
  sourceRows: number[];
}

interface SourceEntry {
  sourceRow: number;
  group: string;
  term: string;
  synonym: string;
  isWord: boolean;
  term_emoji?: string;
}

interface ContraEnv {
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
}

const HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ID_TABLE = ids.ids as Record<string, string>;

// Same key as app/sync_bez_tabu.py entry_key().
function entryKey(e: SourceEntry): string {
  const part = (v: string) => v.trim().normalize("NFC");
  return [e.group, e.term, e.synonym].map(part).join("\x1f") + "\x1f" + (e.isWord ? "1" : "0");
}

const warned = new Set<string>();

async function idFor(key: string): Promise<string> {
  const known = ID_TABLE[key];
  if (known) return known;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn("contra: entry missing from bez-tabu-ids.json, using fallback id; run sync_bez_tabu.py --ids-only", key.replaceAll("\x1f", "|"));
  }
  // Not in the vendored table yet: the id sync_bez_tabu.py would assign absent a collision.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
}

let cache: Promise<{ list: ContraEntry[]; byId: Map<string, ContraEntry> }> | null = null;

async function load(env: ContraEnv) {
  const res = await env.ASSETS.fetch("https://assets/bez-tabu/data/entries.json");
  if (!res.ok) throw new Error(`bez-tabu entries unavailable: ${res.status}`);
  const data = (await res.json()) as { entries: SourceEntry[] };
  const byKey = new Map<string, ContraEntry>();
  for (const e of [...data.entries].sort((a, b) => a.sourceRow - b.sourceRow)) {
    const key = entryKey(e);
    const seen = byKey.get(key);
    if (seen) {
      seen.sourceRows.push(e.sourceRow);
      continue;
    }
    byKey.set(key, {
      id: await idFor(key),
      group: e.group,
      term: e.term,
      synonym: e.synonym,
      isWord: e.isWord,
      emoji: e.term_emoji ?? null,
      sourceRows: [e.sourceRow],
    });
  }
  const list = [...byKey.values()];
  return { list, byId: new Map(list.map((e) => [e.id, e])) };
}

function data(env: ContraEnv) {
  const p = (cache ??= load(env));
  p.catch(() => {
    if (cache === p) cache = null;
  });
  return p;
}

// One entry by stable id (for cards); null when unknown. Throws when the data is unavailable.
export async function contraEntry(id: string, env: ContraEnv): Promise<ContraEntry | null> {
  return (await data(env)).byId.get(id) ?? null;
}

function intParam(qp: URLSearchParams, name: string, fallback: number, min: number, max: number): number | null {
  const raw = qp.get(name);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

export async function contraRoute(path: string, qp: URLSearchParams, env: ContraEnv): Promise<Response | null> {
  if (path !== "/api/contra" && !path.startsWith("/api/contra/")) return null;
  const rest = path.slice("/api/contra".length);
  if (rest !== "" && rest !== "/items" && !rest.startsWith("/items/")) return fail(404, "not_found", "unknown contra endpoint");

  let all: Awaited<ReturnType<typeof data>>;
  try {
    all = await data(env);
  } catch {
    return fail(503, "unavailable", "contra data is temporarily unavailable");
  }

  if (rest === "") {
    return json({ apiVersion: "v1", total: all.list.length, groups: [...new Set(all.list.map((e) => e.group))] });
  }

  if (rest === "/items") {
    const limit = intParam(qp, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
    if (limit === null) return fail(400, "invalid_request", `limit must be an integer between 1 and ${MAX_LIMIT}`);
    const offset = intParam(qp, "offset", 0, 0, Number.MAX_SAFE_INTEGER);
    if (offset === null) return fail(400, "invalid_request", "offset must be a non-negative integer");
    const group = qp.get("group");
    const term = qp.get("term")?.trim().toLocaleLowerCase("uk");
    const hits = all.list.filter(
      (e) => (!group || e.group === group) && (!term || e.term.toLocaleLowerCase("uk").includes(term)),
    );
    return json({ apiVersion: "v1", total: hits.length, limit, offset, items: hits.slice(offset, offset + limit) });
  }

  let id: string;
  try {
    id = decodeURIComponent(rest.slice("/items/".length));
  } catch {
    return fail(400, "invalid_request", "malformed id");
  }
  const hit = all.byId.get(id);
  return hit ? json(hit) : fail(404, "not_found", `no contra entry with id ${id}`);
}
