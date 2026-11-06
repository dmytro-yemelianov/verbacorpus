import { readFile } from "node:fs/promises";
import { validateFont, sha256, json } from "./font-corpus/format.mjs";

export async function verifyCorpus() {
  const indexBytes = await readFile("font-corpus/index.json");
  const index = JSON.parse(indexBytes);
  const catalog = await readFile("font-corpus/catalog.json");
  const provenance = JSON.parse(
    await readFile("font-corpus/provenance.json", "utf8"),
  );
  if (sha256(catalog) !== provenance.catalogSha256)
    throw new Error("Changed runtime catalog");
  if (
    sha256(indexBytes) !== provenance.indexSha256 ||
    index.snapshot !== provenance.snapshot ||
    sha256(await readFile("font-corpus/schema.json")) !==
      provenance.schemaSha256
  )
    throw new Error("Changed corpus index or schema");
  const ids = new Set(),
    blobs = [];
  for (const entry of index.fonts) {
    if (
      ids.has(entry.id) ||
      entry.url !== `/para/corpus/${index.snapshot}/fonts/${entry.id}.json`
    )
      throw new Error("Invalid corpus index");
    ids.add(entry.id);
    const bytes = await readFile(`public${entry.url}`);
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
      throw new Error(`Changed font ${entry.id}`);
    const record = validateFont(JSON.parse(bytes));
    if (record.id !== entry.id) throw new Error("Mismatched font identity");
    const { glyphs, provenance: origin, modifications, ...summary } = record;
    const { sha256: hash, bytes: size, url, ...expected } = entry;
    if (json(summary) !== json(expected))
      throw new Error(`Changed summary ${entry.id}`);
    blobs.push(bytes);
  }
  const exported = await readFile(`public${index.export.url}`);
  if (
    !exported.equals(Buffer.concat(blobs)) ||
    sha256(exported) !== index.snapshot ||
    sha256(exported) !== index.export.sha256
  )
    throw new Error("Changed corpus export");
  if (exported.length > 25 * 1024 * 1024)
    throw new Error("Split corpus export before it exceeds static asset size");
  for (const [name, hash] of Object.entries(provenance.licenses))
    if (sha256(await readFile(`public/para/licenses/${name}`)) !== hash)
      throw new Error(`Changed font notice ${name}`);
  const counts = {
    records: ids.size,
    raster: index.fonts.filter((f) => f.availability === "raster").length,
    metadataOnly: index.fonts.filter((f) => f.availability === "metadata-only")
      .length,
    fixtures: index.fonts.filter((f) => f.kind === "fixture").length,
    ukrainianComplete: index.fonts.filter((f) => f.coverage.ukrainian.complete)
      .length,
  };
  if (json(counts) !== json(index.counts))
    throw new Error("Changed corpus counts");
  return index;
}
if (process.argv[1]?.endsWith("verify_fonts.mjs"))
  console.log((await verifyCorpus()).counts);
