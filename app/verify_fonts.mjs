import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateFont, sha256, json } from "./font-corpus/format.mjs";
export async function verifyCorpus() {
  const indexBytes = await readFile("font-corpus/index.json"),
    index = JSON.parse(indexBytes),
    catalogBytes = await readFile("font-corpus/catalog.json");
  const provenance = JSON.parse(
    await readFile("font-corpus/provenance.json", "utf8"),
  );
  if (
    sha256(indexBytes) !== provenance.indexSha256 ||
    sha256(catalogBytes) !== provenance.catalogSha256 ||
    index.snapshot !== provenance.snapshot ||
    sha256(await readFile("font-corpus/schema.json")) !==
      provenance.schemaSha256
  )
    throw new Error("Changed corpus index or schema");
  const ids = new Set(),
    whole = createHash("sha256");
  let bytesTotal = 0,
    glyphTotal = 0;
  for (const entry of index.fonts) {
    if (
      ids.has(entry.id) ||
      entry.url !== `/para/corpus/${index.snapshot}/fonts/${entry.id}.json`
    )
      throw new Error("Invalid corpus index");
    ids.add(entry.id);
    const bytes = await readFile("public" + entry.url);
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
      throw new Error(`Changed font ${entry.id}`);
    whole.update(bytes);
    bytesTotal += bytes.length;
    const record = validateFont(JSON.parse(bytes));
    if (record.id !== entry.id || record.glyphs === null)
      throw new Error("Incomplete native corpus");
    glyphTotal += record.glyphs.length;
    const metaBytes = await readFile("public" + entry.metaUrl);
    if (
      sha256(metaBytes) !== entry.metaSha256 ||
      metaBytes.length !== entry.metaBytes
    )
      throw new Error("Changed native glyph index");
    const meta = JSON.parse(metaBytes),
      { glyphs, ...metadata } = record;
    if (json(metadata) !== json(meta.font))
      throw new Error("Native font metadata differs");
    const unicodeIndex = Object.create(null);
    for (let i = 0; i < glyphs.length; i++)
      for (const label of glyphs[i].labels)
        if (label.kind === "unicode") {
          unicodeIndex[label.value] ??= [];
          if (!unicodeIndex[label.value].includes(i))
            unicodeIndex[label.value].push(i);
        }
    if (json(unicodeIndex) !== json(meta.unicodeIndex))
      throw new Error("Changed Unicode lookup");
    if (meta.pages.length !== Math.ceil(glyphs.length / 128))
      throw new Error("Missing native glyph pages");
    for (const page of meta.pages) {
      if (
        page.file !== `glyphs/${entry.id}-${page.offset}.json` ||
        page.offset % 128 !== 0 ||
        page.count !== Math.min(128, glyphs.length - page.offset)
      )
        throw new Error("Invalid native glyph page");
      const pageBytes = await readFile(
        `public/para/corpus/${index.snapshot}/${page.file}`,
      );
      if (
        sha256(pageBytes) !== page.sha256 ||
        pageBytes.length !== page.bytes ||
        pageBytes.toString() !==
          json(glyphs.slice(page.offset, page.offset + 128))
      )
        throw new Error("Changed native glyph pixels");
    }
    const { provenance: origin, modifications, ...summary } = metadata;
    const expected = {
      ...summary,
      collection: record.source.collection,
      sha256: entry.sha256,
      bytes: entry.bytes,
      metaSha256: entry.metaSha256,
      metaBytes: entry.metaBytes,
      url: entry.url,
      metaUrl: entry.metaUrl,
    };
    if (json(expected) !== json(entry))
      throw new Error("Changed summary " + entry.id);
  }
  const snapshot = whole.digest("hex"),
    exported = createHash("sha256");
  let exportBytes = 0,
    records = 0;
  for (const shard of index.export.shards) {
    const bytes = await readFile("public" + shard.url);
    if (
      bytes.length > 25 * 1024 * 1024 ||
      sha256(bytes) !== shard.sha256 ||
      bytes.length !== shard.bytes
    )
      throw new Error("Changed export shard");
    exported.update(bytes);
    exportBytes += bytes.length;
    let lines = 0;
    for (const byte of bytes) if (byte === 10) lines++;
    if (lines !== shard.records) throw new Error("Changed export record count");
    records += lines;
  }
  if (
    snapshot !== index.snapshot ||
    exported.digest("hex") !== snapshot ||
    exportBytes !== bytesTotal ||
    exportBytes !== index.export.bytes ||
    records !== index.counts.records ||
    glyphTotal !== index.counts.glyphs
  )
    throw new Error("Incomplete corpus export");
  for (const [name, hash] of Object.entries(provenance.licenses))
    if (sha256(await readFile("public/para/licenses/" + name)) !== hash)
      throw new Error("Changed source notice");
  const counts = {
    records: ids.size,
    raster: index.fonts.filter((f) => f.availability === "raster").length,
    metadataOnly: 0,
    fixtures: index.fonts.filter((f) => f.kind === "fixture").length,
    ukrainianComplete: index.fonts.filter((f) => f.coverage.ukrainian.complete)
      .length,
    glyphs: glyphTotal,
    unmappedGlyphs: index.fonts.reduce(
      (n, f) => n + f.coverage.unmappedGlyphCount,
      0,
    ),
  };
  if (json(counts) !== json(index.counts))
    throw new Error("Changed corpus counts");
  return index;
}
if (process.argv[1]?.endsWith("verify_fonts.mjs"))
  console.log((await verifyCorpus()).counts);
