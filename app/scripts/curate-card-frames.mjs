// One-off curation: pick UPA band patterns suitable as card frames.
// Usage: node scripts/curate-card-frames.mjs [baseUrl]
// Criteria: 3 <= unitCell height <= 12, 2 <= width <= 40, colours subset of {A, D}.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "https://api.verbacorpus.org/v1/non/items";
const out = fileURLToPath(new URL("../content/card-frames.json", import.meta.url));

const items = [];
for (let offset = 0; ; ) {
  const res = await fetch(`${base}?kind=band&include=geometry&limit=100&offset=${offset}`);
  if (!res.ok) throw new Error(`${res.status} at offset ${offset}`);
  const body = await res.json();
  items.push(...body.items);
  if (body.nextOffset == null || body.nextOffset <= offset) break;
  offset = body.nextOffset;
}

const frames = items
  .filter((it) => {
    const d = it.data ?? {};
    const u = d.geometry?.unitCell;
    if (d.kind !== "band" || !Array.isArray(u) || !u.length) return false;
    const h = u.length, w = u[0].length;
    const colors = d.colors ?? [...new Set(u.flat())].filter((c) => c !== "B");
    return h >= 3 && h <= 12 && w >= 2 && w <= 40 && colors.every((c) => c === "A" || c === "D");
  })
  .map((it) => it.id)
  .sort();

writeFileSync(out, JSON.stringify({ version: 1, frames }, null, 2) + "\n");
console.log(`${frames.length} of ${items.length} bands -> ${out}`);
