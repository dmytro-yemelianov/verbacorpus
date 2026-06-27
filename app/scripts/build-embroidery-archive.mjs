// One-off: build the client-side embroidery motif archive for the card hover reveal.
// Reads the external UPA corpus (the source the 38 BORDERS were curated from) and
// writes a compact, self-contained archive to public/data/embroidery-archive.json.
// Re-run if the corpus changes: `node scripts/build-embroidery-archive.mjs`.
//
// Output shape: { palette: { "<char>": "#rrggbb", … }, units: [ { r, c, m: ["row", …] }, … ] }
// '.' / '*' (empty/fragment) carry no colour and are skipped at render time.

import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/home/dmytro/github/dyco/assets/ukrainian-embroidery-corpus/unique_patterns.jsonl";
const OUT = new URL("../public/data/embroidery-archive.json", import.meta.url);

const hex = ([r, g, b]) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");

const recs = readFileSync(SRC, "utf8").trim().split("\n").map((l) => JSON.parse(l));

// One shared palette → char→hex for ink colours only (skip empty/fragment).
const rawPal = recs[0].palette;
const palette = {};
for (const [ch, info] of Object.entries(rawPal)) {
  if (ch === "." || ch === "*" || !info.rgb) continue;      // empty / fragment
  palette[ch] = hex(info.rgb);
}
// lowercase variants map to their uppercase ink colour; 'o' (hollow) → black.
for (const ch of ["b", "r", "d"]) if (palette[ch.toUpperCase()]) palette[ch] = palette[ch.toUpperCase()];
if (rawPal.o) palette["o"] = "#000000";

// Keep real 2-D motifs (drop degenerate single rows/cols); keep the full archive
// for variety — large motifs simply show a fragment under the cursor pool.
const units = recs
  .filter((r) => r.rows >= 2 && r.cols >= 2)
  .map((r) => ({ r: r.rows, c: r.cols, m: r.matrix }));

writeFileSync(OUT, JSON.stringify({ palette, units }));
const bytes = readFileSync(OUT).length;
console.log(`wrote ${units.length} motifs (of ${recs.length}) → public/data/embroidery-archive.json (${(bytes / 1024).toFixed(1)} KB)`);
console.log("palette chars:", Object.keys(palette).join(" "));
