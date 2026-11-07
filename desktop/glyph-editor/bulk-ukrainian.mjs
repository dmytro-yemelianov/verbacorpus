import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { validateFont } from "../../app/font-corpus/format.mjs";
const home = dirname(fileURLToPath(import.meta.url)),
  root = resolve(home, "../.."),
  require = createRequire(join(root, "app/package.json"));
const args = process.argv.slice(2),
  mode = args[0];
if (!["prepare", "apply"].includes(mode))
  throw Error("Expected prepare or apply");
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : undefined;
};
for (const flag of ["--corpus", "--project", "--stage"])
  if (!arg(flag)) throw Error("Missing " + flag);
const corpus = resolve(arg("--corpus")),
  project = resolve(arg("--project")),
  stage = resolve(arg("--stage"));
if (mode === "apply" && !process.env.VERBA_BULK_LOCK_FD) {
  const result = spawnSync(
    "python3",
    [
      join(home, "bulk-lock.py"),
      process.execPath,
      fileURLToPath(import.meta.url),
      ...args,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const { build } = require("esbuild");
await mkdir(stage, { recursive: true });
const core = join(stage, "core.mjs");
await build({
  stdin: {
    contents:
      'export * from "./ui/model"; export * from "./ui/monospace"; export * from "./ui/style-plan"; export * from "./ui/candidates"; export * from "./ui/latin-references";',
    resolveDir: home,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: core,
});
const m = await import(pathToFileURL(core).href + "?" + Date.now());
const cat = JSON.parse(
    await readFile(join(corpus, "font-corpus/catalog.json"), "utf8"),
  ),
  sha = (b) => createHash("sha256").update(b).digest("hex");
const readJSON = async (p) => {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};
const atomic = async (p, data) => {
  await mkdir(dirname(p), { recursive: true });
  const temp = p + ".tmp-" + process.pid;
  await writeFile(temp, JSON.stringify(data));
  await rename(temp, p);
};
const demoPath = args.includes("--demo") ? resolve(arg("--demo")) : null;
const ua = m.UKRAINIAN,
  latin = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"];

const hasInk = (g) => g?.rows.some((r) => /[1-9a-f]/i.test(r));
function mapping(record, state) {
  const native = {};
  for (const g of record.glyphs ?? [])
    for (const l of g.labels)
      if (l.kind === "unicode" && [...l.value].length === 1)
        (native[l.value] ??= []).push(Number(g.id.slice(1)));
  return m.effectiveIndex(native, state);
}
async function prepare(font) {
  const bytes = await readFile(join(corpus, "public", font.url));
  if (sha(bytes) !== font.sha256)
    throw Error("Source SHA mismatch: " + font.id);
  const record = JSON.parse(bytes),
    state =
      (await readJSON(join(project, "fonts", font.id + ".json"))) ??
      m.newDraft(font, cat.snapshot);
  if (
    state.snapshot !== cat.snapshot ||
    state.baseSha256 !== font.sha256 ||
    state.fontId !== font.id
  )
    throw Error("Stale project draft " + font.id);
  const index = mapping(record, state),
    cell = m.fixedCell(font, record.glyphs ?? [], state.fontCell),
    normalized = (id) => {
      const g = state.edits[id] ?? record.glyphs?.[Number(id.slice(1))];
      return g ? m.normalizeCell(g, cell) : undefined;
    };
  const refs = [];
  const add = (char) => {
    if (refs.some((g) => g.character === char)) return;
    const ids = index.get(char) ?? [],
      g = ids.length === 1 ? normalized(ids[0]) : undefined;
    if (!hasInk(g)) return;
    refs.push({
      ...g,
      character: char,
      labels: [{ kind: "unicode", value: char }],
    });
  };
  for (const c of latin) add(c);
  const latinCounts = m.latinReferences(refs);
  for (const c of ua) if (refs.length < 64) add(c);
  const fontMeta = {
    ...font,
    ...m.cellFont(font, cell),
    license: record.license,
    source: record.source,
    draftRevision: state.revision,
  };
  const allPlanned = await m.planStyleTargets({
    font: fontMeta,
    state,
    index,
    characters: ua,
    onlyMissing: true,
    load: async (id) => normalized(id),
    source: async (id) => record.glyphs?.[Number(id.slice(1))],
    blank: (id, c) => m.blankGlyph(fontMeta, id, c),
  });
  const allowed = new Set(m.latinSupportedTargets(latinCounts));
  const blocked = allPlanned.targets
    .filter((t) => !allowed.has(t.character))
    .map((t) => t.character);
  const planned = {
    ...allPlanned,
    targets: allPlanned.targets.filter((t) => allowed.has(t.character)),
  };
  const direct = {};
  const demo = demoPath
    ? await readJSON(join(demoPath, "fonts", font.id + ".json"))
    : null;
  const demoValid =
    demo?.snapshot === cat.snapshot && demo?.baseSha256 === font.sha256;
  const demoIndex = demoValid ? mapping(record, demo) : new Map();
  for (const target of planned.targets) {
    const sourceNative = (record.glyphs ?? []).find(
      (g) =>
        g.labels.some(
          (l) => l.kind === "unicode" && l.value === target.character,
        ) && hasInk(g),
    );
    const demoID = demoIndex.get(target.character)?.[0],
      demoGlyph = demoID
        ? (demo.edits[demoID] ?? record.glyphs?.[Number(demoID.slice(1))])
        : undefined;
    const g = sourceNative ?? (hasInk(demoGlyph) ? demoGlyph : null);
    if (!g) continue;
    const bitmap = m.normalizeCell(g, cell),
      localHash = demoGlyph ? sha(JSON.stringify(demo)) : font.sha256,
      foreign = !sourceNative;
    const donorId = foreign
      ? font.id.slice(0, 130) + "-demo-" + localHash.slice(0, 8)
      : font.id;
    direct[target.character] = {
      id: sha(JSON.stringify(bitmap.rows)).slice(0, 16),
      method: "reference",
      model: foreign ? "same-font-local-draft-v1" : "native-source-restore-v1",
      checkpointSha256: null,
      width: cell.width,
      height: cell.height,
      rowBytes: bitmap.rowBytes,
      rows: bitmap.rows,
      styleDistance: 0,
      sourceGlyphId: g.id,
      sourceChar: target.character,
      sourceFontId: donorId,
      sourceSha256: foreign ? localHash : font.sha256,
      sourceLicenseId: font.licenseId,
      sourceLicense: record.license,
      source: {
        ...record.source,
        ...(foreign
          ? {
              parentFontId: font.id,
              parentSha256: font.sha256,
              localDraftSha256: localHash,
              originalDerivation: demo.derivations?.[g.id],
            }
          : {}),
      },
      references: [g.id],
      styleReferenceFont: {
        fontId: donorId,
        sha256: foreign ? localHash : font.sha256,
        name: font.name + " · local draft",
        licenseId: font.licenseId,
      },
    };
  }
  const request = {
    directCandidates: direct,
    snapshot: cat.snapshot,
    font: fontMeta,
    referenceFont: fontMeta,
    references: refs,
    mode: "retrieval",
    preferLatin: true,
    count: 3,
    revision: state.revision,
    ocrFeedback: true,
    targets: planned.targets.map(m.styleTargetRequest),
  };
  return {
    font,
    record,
    state,
    cell,
    index,
    planned,
    blocked,
    latinCounts,
    request,
    referenceSignature: sha(JSON.stringify([cell, refs])),
  };
}
async function specimen(p) {
  const idx = mapping(p.record, p.state),
    glyphs = {};
  for (const c of [...latin, ...ua]) {
    const id = (idx.get(c) ?? []).find((id) =>
      hasInk(p.state.edits[id] ?? p.record.glyphs?.[Number(id.slice(1))]),
    );
    if (id)
      glyphs[c] = m.normalizeCell(
        p.state.edits[id] ?? p.record.glyphs?.[Number(id.slice(1))],
        p.cell,
      );
  }
  await atomic(join(stage, "specimens", p.font.id + ".json"), {
    id: p.font.id,
    name: p.font.name,
    cell: p.cell,
    glyphs,
    generated: Object.keys(p.state.derivations ?? {}).flatMap((id) =>
      p.state.edits[id]?.character ? [p.state.edits[id].character] : [],
    ),
  });
}
const selected = arg("--ids")?.endsWith(".json")
  ? new Set(JSON.parse(await readFile(arg("--ids"), "utf8")))
  : null;
const chosen = cat.fonts.filter((f) => !selected || selected.has(f.id));
if (mode === "prepare") {
  const manifest = { snapshot: cat.snapshot, fonts: [], errors: [] };
  await mkdir(join(stage, "requests"), { recursive: true });
  for (const font of chosen) {
    try {
      const p = await prepare(font);
      const item = {
        id: font.id,
        name: font.name,
        missing: p.planned.targets.length,
        existing: 66 - p.planned.targets.length - p.blocked.length,
        blocked: p.blocked,
        latinReferences: p.latinCounts,
        cell: p.cell,
        referenceCount: p.request.references.length,
        referenceSignature: p.referenceSignature,
      };
      if (p.planned.targets.length)
        await atomic(join(stage, "requests", font.id + ".json"), p.request);
      manifest.fonts.push(item);
    } catch (e) {
      manifest.errors.push({ id: font.id, error: String(e.message) });
    }
  }
  await atomic(join(stage, "manifest.json"), manifest);
  console.log(
    JSON.stringify({
      fonts: manifest.fonts.length,
      errors: manifest.errors.length,
      missing: manifest.fonts.reduce((n, f) => n + f.missing, 0),
    }),
  );
  if (manifest.errors.length) process.exitCode = 1;
} else if (mode === "apply") {
  const manifest = await readJSON(join(stage, "manifest.json")),
    report = { fonts: [], retry: [], errors: [] };
  if (manifest.snapshot !== cat.snapshot) throw Error("Stale stage snapshot");
  for (const item of manifest.fonts) {
    try {
      const p = await prepare(cat.fonts.find((f) => f.id === item.id));
      if (!p.planned.targets.length) {
        await specimen(p);
        report.fonts.push({
          ...item,
          status: p.blocked.length
            ? "blocked-missing-latin"
            : "complete-existing",
          added: 0,
          present: 66 - p.blocked.length,
          blocked: p.blocked,
        });
        continue;
      }
      if (p.referenceSignature !== item.referenceSignature) {
        report.retry.push(item.id);
        continue;
      }
      const batch = await readJSON(join(stage, "results", item.id + ".json"));
      if (!batch) throw Error("No generation response");
      const requestBytes = await readFile(
        join(stage, "requests", item.id + ".json"),
      );
      const request = JSON.parse(requestBytes);
      if (
        batch.requestSha256 !== sha(requestBytes) ||
        batch.fontId !== item.id ||
        batch.revision !== request.revision
      )
        throw Error("Generation response does not match the staged request");
      const doc = new m.Document(p.state),
        edits = [],
        methods = {},
        unresolved = [];
      for (const target of p.planned.targets) {
        const result = batch.results?.find(
          (r) => r.character === target.character,
        );
        const candidate = result?.candidates?.[0];
        if (!candidate) {
          unresolved.push({
            character: target.character,
            error: result?.error ?? "No candidate",
          });
          continue;
        }
        const after = m.candidateGlyph(target.target, candidate),
          derivation = m.candidateDerivation(
            target.target,
            candidate,
            target.character,
          );
        derivation.generation.bulkRun =
          manifest.runId ?? stage.split("/").pop();
        derivation.generation.confidence =
          candidate.method === "homograph"
            ? "native-copy"
            : "generated-needs-review";
        edits.push({
          id: target.target.id,
          glyph: after,
          source: target.source,
          derivation,
        });
        methods[candidate.method] = (methods[candidate.method] ?? 0) + 1;
      }
      if (edits.length) {
        p.state.fontCell ??= p.cell;
        doc.commitBatch(edits);
        p.state.bulkGeneration = {
          runId: manifest.runId ?? stage.split("/").pop(),
          added: edits.length,
          needsVisualReview: true,
        };
        const finalMap = mapping(p.record, p.state),
          missing = ua.filter(
            (c) =>
              !(finalMap.get(c) ?? []).some((id) =>
                hasInk(
                  p.state.edits[id] ?? p.record.glyphs?.[Number(id.slice(1))],
                ),
              ),
          );
        p.state.ukrainianCoverage = {
          present: 66 - missing.length,
          missing,
          checkedRevision: p.state.revision,
        };
        const exported = m.exportRecord(p.record, p.state);
        validateFont(exported);
        await atomic(join(project, "fonts", item.id + ".json"), p.state);
      }
      const finalIndex = mapping(p.record, p.state);
      const present = ua.filter((c) =>
        (finalIndex.get(c) ?? []).some((id) =>
          hasInk(p.state.edits[id] ?? p.record.glyphs?.[Number(id.slice(1))]),
        ),
      ).length;
      await specimen(p);
      report.fonts.push({
        ...item,
        status: present === 66 ? "complete-generated" : "partial",
        added: edits.length,
        present,
        methods,
        unresolved,
      });
    } catch (e) {
      report.errors.push({ id: item.id, error: String(e.message) });
    }
  }
  await atomic(join(stage, "applied.json"), report);
  console.log(
    JSON.stringify({
      fonts: report.fonts.length,
      added: report.fonts.reduce((n, f) => n + f.added, 0),
      retry: report.retry.length,
      errors: report.errors.length,
    }),
  );
  if (report.errors.length || report.retry.length) process.exitCode = 1;
} else throw Error("Expected prepare or apply");
