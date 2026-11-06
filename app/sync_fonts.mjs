/** Explicit, offline intake. Ordinary builds only verify the vendored snapshot. */
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  coverage,
  upgrade,
  fromNasinnia,
  validateFont,
  sha256,
  json,
} from "./font-corpus/format.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const nasinnia = resolve(option("--nasinnia", "../../nasinnia"));
const texted = resolve(option("--texted", "../../texted"));
const revision = (root) =>
  execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
const nasinniaRevision = revision(nasinnia),
  textedRevision = revision(texted);
const { fonts } = await import(
  pathToFileURL(join(nasinnia, "src/catalog.js")).href
);
const sourceById = new Map(fonts.map((f) => [f.id, f]));
const records = fonts.map((font) =>
  fromNasinnia(font, {
    collection: "nasinnia",
    revision: nasinniaRevision,
    sha256: sha256(json(font)),
  }),
);
const specs = JSON.parse(
  await readFile(join(texted, "assets/fonts/sources.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(join(texted, "assets/fonts/manifest.json"), "utf8"),
);
const patches = JSON.parse(
  await readFile(join(texted, "assets/fonts/ukrainian-additions.json"), "utf8"),
);
for (const entry of manifest.fonts) {
  const spec = specs.fonts.find((s) => s.id === entry.id);
  const bytes = await readFile(join(texted, "assets/fonts", entry.file));
  if (sha256(bytes) !== entry.sha256)
    throw new Error(`Changed Texted font ${entry.id}`);
  const glyphs = [];
  for (let i = 0; i < bytes.length; i += 4 + entry.height) {
    const cp = bytes.readUInt32LE(i);
    glyphs.push({
      codepoint: "U+" + cp.toString(16).toUpperCase().padStart(4, "0"),
      character: String.fromCodePoint(cp),
      advanceX: entry.width,
      rows: [...bytes.subarray(i + 4, i + 4 + entry.height)].map((n) =>
        n.toString(16).toUpperCase().padStart(2, "0"),
      ),
      sourceCode: null,
    });
  }
  const spleen = entry.id.startsWith("spleen");
  records.push(
    upgrade({
      format: "para-font",
      schemaVersion: "1.0.0",
      id: `texted-${entry.id}`,
      name: `${spleen ? "Spleen" : "IBM " + entry.id.split("_")[0].toUpperCase()} ${entry.width}×${entry.height} Ukrainian`,
      family: spleen ? "Spleen" : "IBM",
      version: 1,
      kind: "derived",
      availability: "raster",
      cell: {
        width: entry.width,
        height: entry.height,
        monospace: true,
        pixelAspectRatio: { x: 1, y: 1 },
      },
      metrics: {
        ascent: entry.baseline,
        descent: entry.height - entry.baseline,
        lineGap: 0,
        baseline: entry.baseline,
        advanceX: entry.width,
      },
      bitmap: { encoding: "hex-rows", bitOrder: "msb-first", rowBytes: 1 },
      encodings: [{ name: "unicode", primary: true }],
      license: {
        id: entry.license,
        name: entry.license,
        url: spleen
          ? "https://spdx.org/licenses/BSD-2-Clause.html"
          : "https://creativecommons.org/licenses/by-sa/4.0/",
        attributionRequired: true,
        shareAlikeRequired: !spleen,
        redistributionAllowed: true,
        attribution: spleen
          ? "Copyright (c) 2018–2026 Frederic Cambus; Ukrainian additions by Texted"
          : "The Ultimate Oldschool PC Font Pack v2.2 by VileR; original IBM designs; Ukrainian additions by Texted",
      },
      source: {
        collection: "texted",
        recordId: entry.id,
        revision: textedRevision,
        sha256: entry.sha256,
        upstream: {
          name: spleen
            ? "Spleen via Nasinnia"
            : "Oldschool PC Font Pack v2.2 Unicode Plus",
          url: spleen
            ? "https://github.com/fcambus/spleen"
            : "https://int10h.org/oldschool-pc-fonts/",
          file: spec.file,
          fileSha256: spec.sha256,
        },
      },
      provenance: {
        repository: "https://github.com/dmytro-yemelianov/texted",
        originalGlyphRowsSha256: entry.source_rows_sha256,
        note: "Original glyphs unchanged; exact additions listed below.",
      },
      modifications: patches[entry.id],
      coverage: coverage(glyphs),
      glyphs,
    }),
  );
}
// Older root-level aliases have the same IDs/pixels as registered Oldschool records.
// Pin those equivalent inputs explicitly rather than publishing duplicate font IDs.
for (const name of (await readdir(join(nasinnia, "data"))).sort()) {
  if (!name.endsWith(".json")) continue;
  const raw = await readFile(join(nasinnia, "data", name)),
    candidate = JSON.parse(raw);
  if (Array.isArray(candidate) || !candidate.glyphData?.length) continue;
  const source = sourceById.get(candidate.id),
    record = records.find((f) => f.id === candidate.id);
  if (!source || !record)
    throw new Error(`Unregistered raster source ${candidate.id}`);
  const pixels = (f) =>
    f.glyphData.map((g) => [g.codepoint, g.advanceX, g.rows]);
  if (JSON.stringify(pixels(source)) !== JSON.stringify(pixels(candidate)))
    throw new Error(`Conflicting source pixels ${candidate.id}`);
  if (JSON.stringify(source) !== JSON.stringify(candidate)) {
    record.source.equivalentInputs ??= [];
    record.source.equivalentInputs.push({
      path: `data/${name}`,
      sha256: sha256(raw),
    });
  }
}
const mit = await readFile("content/snapshots/Cozette-LICENSE.txt", "utf8");
const mitTerms = mit.slice(mit.indexOf("Permission is hereby granted"));
if (!mitTerms.startsWith("Permission")) throw new Error("Missing MIT notice");
const bsd = await readFile(
  join(texted, "assets/fonts/licenses/Spleen-BSD-2-Clause.txt"),
  "utf8",
);
for (const record of records) {
  if (record.license.id === "MIT")
    record.license.text = record.license.attribution + "\n\n" + mitTerms;
  if (record.license.id === "BSD-2-Clause") record.license.text = bsd;
  validateFont(record);
}
// Materialize native sources separately so the authoring process never retains
// half a million glyph objects at once. Ordinary builds use only vendored assets.
const intake = resolve(
  option("--hoard-intake", "/private/tmp/para-hoard-native-v2"),
);
const hoardManifest = JSON.parse(
  await readFile(join(intake, "manifest.json"), "utf8"),
);
if (hoardManifest.sourceFiles !== 1947 || hoardManifest.glyphs !== 490940)
  throw new Error("Incomplete native Hoard intake");
const inputs = records
  .filter((r) => r.glyphs !== null)
  .map((record) => ({ id: record.id, record }));
for (const entry of hoardManifest.fonts)
  inputs.push({ ...entry, path: join(intake, entry.file) });
inputs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
if (new Set(inputs.map((r) => r.id)).size !== inputs.length)
  throw new Error("Duplicate corpus IDs");
const { mkdtemp, rename, stat, rm } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { createHash } = await import("node:crypto");
const stage = await mkdtemp(join(tmpdir(), "para-native-corpus-"));
for (const folder of ["fonts", "meta", "glyphs", "export"])
  await mkdir(join(stage, folder));
const hasher = createHash("sha256"),
  entries = [],
  shards = [];
let exportBytes = 0,
  shardParts = [],
  shardBytes = 0,
  shardRecords = 0;
async function flushShard() {
  if (!shardParts.length) return;
  const bytes = Buffer.concat(shardParts),
    name = `part-${String(shards.length).padStart(4, "0")}.ndjson`;
  await writeFile(join(stage, "export", name), bytes);
  shards.push({
    file: `export/${name}`,
    sha256: sha256(bytes),
    bytes: bytes.length,
    records: shardRecords,
  });
  shardParts = [];
  shardBytes = 0;
  shardRecords = 0;
}
for (const input of inputs) {
  const font = input.record ?? JSON.parse(await readFile(input.path, "utf8"));
  validateFont(font);
  const bytes = Buffer.from(json(font));
  if (bytes.length > 25 * 1024 * 1024)
    throw new Error(`Font exceeds static asset limit: ${font.id}`);
  hasher.update(bytes);
  exportBytes += bytes.length;
  if (shardBytes + bytes.length > 8 * 1024 * 1024) await flushShard();
  shardParts.push(bytes);
  shardBytes += bytes.length;
  shardRecords++;
  await writeFile(join(stage, "fonts", font.id + ".json"), bytes);
  const pages = [],
    unicodeIndex = Object.create(null);
  for (let offset = 0; offset < font.glyphs.length; offset += 128) {
    const pageBytes = Buffer.from(
        json(font.glyphs.slice(offset, offset + 128)),
      ),
      file = `glyphs/${font.id}-${offset}.json`;
    await writeFile(join(stage, file), pageBytes);
    pages.push({
      file,
      sha256: sha256(pageBytes),
      bytes: pageBytes.length,
      offset,
      count: Math.min(128, font.glyphs.length - offset),
    });
  }
  for (let i = 0; i < font.glyphs.length; i++)
    for (const label of font.glyphs[i].labels) {
      if (label.kind === "unicode") {
        unicodeIndex[label.value] ??= [];
        if (!unicodeIndex[label.value].includes(i))
          unicodeIndex[label.value].push(i);
      }
    }
  const { glyphs, ...metadata } = font;
  const metaBytes = Buffer.from(json({ font: metadata, pages, unicodeIndex }));
  await writeFile(join(stage, "meta", font.id + ".json"), metaBytes);
  const { provenance, modifications, ...summary } = metadata;
  entries.push({
    ...summary,
    collection: font.source.collection,
    sha256: sha256(bytes),
    bytes: bytes.length,
    file: `fonts/${font.id}.json`,
    metaFile: `meta/${font.id}.json`,
    metaSha256: sha256(metaBytes),
    metaBytes: metaBytes.length,
  });
}
await flushShard();
const snapshot = hasher.digest("hex"),
  directory = `public/para/corpus/${snapshot}`;
let exists = false;
try {
  await stat(directory);
  exists = true;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (exists) {
  for (const entry of entries) {
    for (const [file, hash] of [
      [entry.file, entry.sha256],
      [entry.metaFile, entry.metaSha256],
    ])
      if (sha256(await readFile(join(directory, file))) !== hash)
        throw new Error("Existing immutable snapshot differs");
    const metadata = JSON.parse(
      await readFile(join(stage, entry.metaFile), "utf8"),
    );
    for (const page of metadata.pages)
      if (sha256(await readFile(join(directory, page.file))) !== page.sha256)
        throw new Error("Changed glyph page");
  }
  for (const shard of shards)
    if (sha256(await readFile(join(directory, shard.file))) !== shard.sha256)
      throw new Error("Changed export shard");
  await rm(stage, { recursive: true });
} else await rename(stage, resolve(directory));
for (const entry of entries) {
  entry.url = `/para/corpus/${snapshot}/${entry.file}`;
  entry.metaUrl = `/para/corpus/${snapshot}/${entry.metaFile}`;
  delete entry.file;
  delete entry.metaFile;
}
for (const shard of shards) {
  shard.url = `/para/corpus/${snapshot}/${shard.file}`;
  delete shard.file;
}
const counts = {
  records: entries.length,
  raster: entries.filter((f) => f.availability === "raster").length,
  metadataOnly: 0,
  fixtures: entries.filter((f) => f.kind === "fixture").length,
  ukrainianComplete: entries.filter((f) => f.coverage.ukrainian.complete)
    .length,
  glyphs: entries.reduce((n, f) => n + f.coverage.glyphCount, 0),
  unmappedGlyphs: entries.reduce(
    (n, f) => n + f.coverage.unmappedGlyphCount,
    0,
  ),
};
const index = {
  format: "para-font-corpus",
  schemaVersion: "2.0.0",
  snapshot,
  counts,
  export: {
    url: "/para/api/v2/export",
    sha256: snapshot,
    bytes: exportBytes,
    shards,
  },
  sources: [
    {
      collection: "nasinnia",
      revision: nasinniaRevision,
      records: inputs.length - hoardManifest.faces - manifest.fonts.length,
    },
    {
      collection: "texted",
      revision: textedRevision,
      records: manifest.fonts.length,
    },
    {
      collection: "hoard",
      revision: hoardManifest.revision,
      records: hoardManifest.faces,
      glyphs: hoardManifest.glyphs,
      sourceFiles: hoardManifest.sourceFiles,
    },
  ],
  fonts: entries,
};
await writeFile("font-corpus/index.json", json(index));
const catalog = {
  ...index,
  fonts: entries.map(
    ({
      id,
      name,
      family,
      kind,
      availability,
      cell,
      metrics,
      bitmap,
      coverage,
      license,
      collection,
      sha256,
      bytes,
      url,
      metaUrl,
      metaSha256,
      metaBytes,
    }) => ({
      id,
      name,
      family,
      kind,
      availability,
      cell,
      metrics,
      bitmap,
      coverage,
      licenseId: license.id,
      licenseStatus: license.status,
      collection,
      sha256,
      bytes,
      url,
      metaUrl,
      metaSha256,
      metaBytes,
    }),
  ),
};
await writeFile("font-corpus/catalog.json", json(catalog));
await mkdir("public/para/licenses", { recursive: true });
await copyFile(
  join(intake, "Hoard-LICENSE.md"),
  "public/para/licenses/Hoard-LICENSE.md",
);
for (const name of (
  await readdir(join(texted, "assets/fonts/licenses"))
).sort())
  await copyFile(
    join(texted, "assets/fonts/licenses", name),
    join("public/para/licenses", name),
  );
await copyFile(
  "content/snapshots/Cozette-LICENSE.txt",
  "public/para/licenses/Cozette-MIT.txt",
);
const notices = entries
  .map(
    (f) =>
      `## ${f.id}\n\n${f.license.id}: ${f.license.attribution}\n\n${f.license.url}\n`,
  )
  .join("\n");
await writeFile(
  "public/para/licenses/NOTICE.md",
  "# Para font corpus attribution\n\nEach record retains its own license. Raster availability is independent of source license status. Original notices are retained in each record.\n\n" +
    notices,
);
await writeFile(
  "font-corpus/provenance.json",
  json({
    snapshot,
    indexSha256: sha256(json(index)),
    catalogSha256: sha256(json(catalog)),
    schemaSha256: sha256(await readFile("font-corpus/schema.json")),
    licenses: Object.fromEntries(
      await Promise.all(
        (await readdir("public/para/licenses"))
          .sort()
          .map(async (n) => [
            n,
            sha256(await readFile(join("public/para/licenses", n))),
          ]),
      ),
    ),
  }),
);
console.log({
  snapshot,
  ...counts,
  bytes: exportBytes,
  licenses: [...new Set(entries.map((f) => f.license.id))],
});
