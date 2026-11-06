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
    validateFont({
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
records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
if (new Set(records.map((r) => r.id)).size !== records.length)
  throw new Error("Duplicate corpus IDs");
const blobs = records.map((r) => Buffer.from(json(r)));
const snapshot = sha256(Buffer.concat(blobs));
const directory = `public/para/corpus/${snapshot}`;
await mkdir(`${directory}/fonts`, { recursive: true });
const entries = [];
for (let i = 0; i < records.length; i++) {
  const font = records[i],
    blob = blobs[i],
    path = `/para/corpus/${snapshot}/fonts/${font.id}.json`;
  await writeFile(`public${path}`, blob);
  const { glyphs, provenance, modifications, ...summary } = font;
  entries.push({
    ...summary,
    sha256: sha256(blob),
    bytes: blob.length,
    url: path,
  });
}
const exported = Buffer.concat(blobs);
await writeFile(`${directory}/corpus.ndjson`, exported);
const counts = {
  records: records.length,
  raster: records.filter((f) => f.availability === "raster").length,
  metadataOnly: records.filter((f) => f.availability === "metadata-only")
    .length,
  fixtures: records.filter((f) => f.kind === "fixture").length,
  ukrainianComplete: records.filter((f) => f.coverage.ukrainian.complete)
    .length,
};
const index = {
  format: "para-font-corpus",
  schemaVersion: "1.0.0",
  snapshot,
  counts,
  export: {
    url: `/para/corpus/${snapshot}/corpus.ndjson`,
    sha256: sha256(exported),
    bytes: exported.length,
  },
  sources: [
    {
      collection: "nasinnia",
      revision: nasinniaRevision,
      records: fonts.length,
    },
    {
      collection: "texted",
      revision: textedRevision,
      records: manifest.fonts.length,
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
      sha256,
      bytes,
      url,
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
      sha256,
      bytes,
      url,
    }),
  ),
};
await writeFile("font-corpus/catalog.json", json(catalog));
await mkdir("public/para/licenses", { recursive: true });
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
const notices = records
  .map(
    (f) =>
      `## ${f.id}\n\n${f.license.id}: ${f.license.attribution}\n\n${f.license.url}\n`,
  )
  .join("\n");
await writeFile(
  "public/para/licenses/NOTICE.md",
  "# Para font corpus attribution\n\nEach record retains its own license. Metadata-only records contain no raster data.\n\n" +
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
  bytes: exported.length,
  licenses: [...new Set(records.map((f) => f.license.id))],
});
