/** Read-only source/draft comparison and reproducible native-generation requests. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const home = dirname(fileURLToPath(import.meta.url)),
  root = resolve(home, "../..");
const args = process.argv.slice(2),
  option = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
if (!option("--project") || !option("--out"))
  throw Error(
    "Usage: audit-ukrainian.mjs --project PATH --out PATH [--corpus app] [--fonts ID,ID]",
  );
const corpus = resolve(option("--corpus") ?? join(root, "app")),
  project = resolve(option("--project")),
  out = resolve(option("--out"));
const overlaps = (a, b) =>
  a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
if (overlaps(out, project) || overlaps(out, corpus))
  throw Error("Audit output must be separate from project and corpus");
const require = createRequire(join(root, "app/package.json"));
await mkdir(out, { recursive: true });
const { build } = require("esbuild");
await build({
  stdin: {
    contents:
      'export * from "./ui/model";export * from "./ui/monospace";export * from "./ui/candidates";export * from "./ui/font-profile";',
    resolveDir: join(root, "desktop/glyph-editor"),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(out, "core.mjs"),
});
const m = await import(pathToFileURL(join(out, "core.mjs"))),
  cat = JSON.parse(
    await readFile(join(corpus, "font-corpus/catalog.json"), "utf8"),
  );
const selected = option("--fonts")?.split(",");
const matched = cat.fonts.filter((f) =>
  selected
    ? selected.includes(f.id)
    : [
        "ApricotPortable",
        "Arial 8",
        "AT&T PC6300",
        "Athens Regular 18",
        "Barbedor10.Scn.Fnt",
      ].includes(f.name) || /^(Berkeley|Bison)\b/.test(f.name),
);
const summaries = [];
for (const font of matched) {
  const bytes = await readFile(join(corpus, "public", font.url));
  if (createHash("sha256").update(bytes).digest("hex") !== font.sha256)
    throw Error("Source SHA mismatch: " + font.id);
  const record = JSON.parse(bytes);
  let state;
  try {
    state = JSON.parse(
      await readFile(join(project, "fonts", font.id + ".json"), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  state ??= m.newDraft(font, cat.snapshot);
  const cell = m.fixedCell(font, record.glyphs, state.fontCell),
    nativeIndex = {};
  for (const g of record.glyphs)
    for (const l of g.labels)
      if (l.kind === "unicode" && [...l.value].length === 1)
        (nativeIndex[l.value] ??= []).push(Number(g.id.slice(1)));
  const index = m.effectiveIndex(nativeIndex, state),
    glyph = (id) => state.edits[id] ?? record.glyphs[Number(id.slice(1))];
  const current = {},
    references = [],
    targets = [],
    methods = {},
    badPairs = [];
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz36ÏïĂăĞğÖöÄä") {
    const ids = index.get(c) ?? [];
    if (ids.length !== 1) continue;
    const g = m.normalizeCell(glyph(ids[0]), cell);
    if (!g.rows.some((r) => /[1-9a-f]/i.test(r))) continue;
    references.push({
      ...g,
      character: c,
      labels: [{ kind: "unicode", value: c }],
    });
    current[c] = g;
  }
  let originals = 0,
    edited = 0,
    reviewed = 0;
  for (const c of m.UKRAINIAN) {
    const id = index.get(c)?.[0],
      original = id ? glyph(id) : undefined;
    const g = original
      ? m.normalizeCell(original, cell)
      : m.blankGlyph(m.cellFont(font, cell), "g999999", c);
    current[c] = g;
    const d = id ? state.derivations[id] : undefined;
    if (id && state.edits[id]) edited++;
    if (
      record.glyphs.some(
        (g) =>
          g.labels.some((l) => l.kind === "unicode" && l.value === c) &&
          g.rows.some((r) => /[1-9a-f]/i.test(r)),
      )
    )
      originals++;
    if (state.reviewed.includes(id) || state.reviewed.includes(m.codepoint(c)))
      reviewed++;
    const method = g.rows.some((r) => /[1-9a-f]/i.test(r))
      ? (d?.generation?.method ?? d?.kind ?? "source")
      : "missing";
    methods[method] = (methods[method] ?? 0) + 1;
    targets.push({
      character: c,
      target: m.hiddenTarget(g),
      targetSignature: "audit",
    });
  }
  for (const [latin, cy] of [
    ..."AА BВ CС EЕ HН IІ KК MМ OО PР TТ XХ aа cс eе iі oо pр xх yу".split(" "),
  ]) {
    if (
      current[latin] &&
      JSON.stringify(current[latin].rows) !== JSON.stringify(current[cy].rows)
    )
      badPairs.push(latin + cy);
  }
  const profile = m.cellFont(font, cell),
    summary = {
      id: font.id,
      name: font.name,
      cell,
      originals,
      edited,
      reviewed,
      methods,
      badPairs,
      revision: state.revision,
    };
  summaries.push(summary);
  if (state.snapshot !== cat.snapshot || state.baseSha256 !== font.sha256)
    throw Error("Stale draft identity: " + font.id);
  await writeFile(
    join(out, font.id + ".json"),
    JSON.stringify({
      summary,
      font: profile,
      current,
      derivations: state.derivations,
      request: {
        snapshot: cat.snapshot,
        font: { ...profile, license: record.license, source: record.source },
        referenceFont: {
          ...profile,
          license: record.license,
          source: record.source,
        },
        references,
        mode: "native",
        preferLatin: true,
        recipeMode: "strict",
        count: 8,
        revision: state.revision,
        targets,
      },
    }),
  );
}
await writeFile(join(out, "summary.json"), JSON.stringify(summaries, null, 2));
console.log(JSON.stringify(summaries, null, 2));
