/** Repeatable CPU comparison on actual corpus rasters; not a browser/CWV score. */
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
const baseline = process.argv[2] ?? "80f70b7";
const load = async (contents) => {
  const built = await build({
    stdin: { contents, loader: "ts", resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(built.outputFiles[0].text).toString("base64")
  );
};
const before = await load(
  execFileSync("git", ["show", `${baseline}:app/src/client/bitmap.ts`], {
    encoding: "utf8",
  }),
);
const after = await load(await readFile("src/client/bitmap.ts", "utf8"));
const catalog = JSON.parse(await readFile("font-corpus/catalog.json", "utf8"));
const results = [];
for (const id of [
  "texted-bios_8x8",
  "hoard-oberon-letterhead-300dpi",
  "hoard-nec-pc-nec-pc9821-kanji-16x16",
]) {
  const summary = catalog.fonts.find((f) => f.id === id),
    font = JSON.parse(await readFile("public" + summary.url, "utf8"));
  const glyphs = font.glyphs.slice(0, 128);
  const measure = (visit) => {
    let checksum = 0;
    const paint = (x, y) => {
      checksum += x + y;
    };
    for (let i = 0; i < 5; i++) for (const glyph of glyphs) visit(glyph, paint);
    const samples = [];
    for (let sample = 0; sample < 9; sample++) {
      const start = performance.now();
      for (let i = 0; i < 30; i++)
        for (const glyph of glyphs) visit(glyph, paint);
      samples.push((performance.now() - start) / 30);
    }
    return { medianMs: samples.sort((a, b) => a - b)[4], checksum };
  };
  const old = measure(before.visitGlyphPixels),
    current = measure(after.visitGlyphPixels);
  if (old.checksum !== current.checksum)
    throw new Error("Raster visitation changed: " + id);
  results.push({
    id,
    glyphs: glyphs.length,
    beforeMs: old.medianMs,
    afterMs: current.medianMs,
    speedup: old.medianMs / current.medianMs,
    identicalPixels: true,
  });
}
console.log(
  JSON.stringify(
    {
      baseline,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      rounds: 9,
      iterations: 30,
      results,
    },
    null,
    2,
  ),
);
