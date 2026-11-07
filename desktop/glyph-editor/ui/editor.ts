import {
  latinReferences,
  latinSupportedTargets,
  requireLatinReferences,
  type LatinReferences,
} from "./latin-references";
import { ukrainianCoverage } from "./font-coverage";
import {
  fixedCell,
  normalizeCell,
  cellNeedsFit,
  frameOrdinals,
  type FontCell,
} from "./monospace";
import { createGlyphGallery } from "./glyph-gallery";
import { createLibraryGallery, type LibraryPreview } from "./library-gallery";
import { createGroupSelection, selectedGroupSlots } from "./group-selection";
import { asciiMapping, chooseAsciiMapping } from "./ascii-mapping";
import { editingProfile, initialQueue } from "./font-profile";
import { shortcutKey } from "./shortcuts";
import { createStyleWorkbench } from "./style-workbench";
import {
  planStyleTargets,
  styleTargetRequest,
  type StyleTarget,
} from "./style-plan";
import { createCandidateChooser } from "./candidate-dialog";
import {
  candidateDerivation,
  candidateGlyph,
  glyphSignature,
  hiddenTarget,
} from "./candidates";
import { createComparison } from "./comparison";
import { createFontGuidesEditor } from "./font-guides-editor";
import { fontWithGuides } from "./font-guides";
import { referenceHeight, type ReferenceHeights } from "./guides";
import type { RegionOrigin } from "./pixel-regions";
import {
  canonicalSlots,
  regionFor,
  characterLabel,
  mappedCharacter,
  glyphCaption,
  type GlyphSlot as Slot,
} from "./regions";
import { type Anchor, type ScaleAxis } from "./raster-mutation";
import { propose, materialize } from "./autofill";
import { chooseGeometry, choosingGeometry } from "./autofill-dialog";
import { native } from "./bridge";
import { createCanvas } from "./canvas";
import { FontAssetCache, NativeFont } from "../../../app/src/client/font-data";
import {
  GlyphPainter,
  paintSpecimen,
} from "../../../app/src/client/font-painter";
import {
  Document as GlyphDocument,
  codepoint,
  newDraft,
  blankGlyph,
  transformed,
  effectiveIndex,
  exportRecord,
  type Draft,
  type Glyph,
  type FontSummary,
  type FontRecord,
} from "./model";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
type Light = Pick<
  FontSummary,
  "id" | "name" | "family" | "cell" | "coverage" | "collection" | "licenseId"
> & { latinReferences?: LatinReferences };
type Progress = {
  edits: number;
  reviewed: number;
  done: boolean;
  ukrainianPresent?: number;
  latinReferences?: LatinReferences;
};
type Boot = {
  snapshot: string;
  fonts: Light[];
  counts: { glyphs: number };
  progress: Record<string, Progress>;
  projectPath: string;
  warnings: string[];
};
const readFontAsset: typeof fetch = async (input, init) => {
  init?.signal?.throwIfAborted();
  const path =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;
  return new Response(await native<string>("readAsset", { path }), {
    headers: { "content-type": "application/json" },
  });
};
const cache = new FontAssetCache(8 * 1024 * 1024, readFontAsset);
const libraryCache = new FontAssetCache(4 * 1024 * 1024, readFontAsset);
const painter = new GlyphPainter();
const stage = $<HTMLElement>("canvas-stage"),
  zoom = $<HTMLInputElement>("zoom");
let boot: Boot,
  fonts: Light[] = [],
  visibleFonts: Light[] = [],
  font: FontSummary | undefined,
  face: NativeFont | undefined,
  doc: GlyphDocument | undefined;
let controller: AbortController | undefined,
  fontRevision = 0,
  selectionRevision = 0,
  selected = 0,
  slots: Slot[] = [],
  index = new Map<string, string[]>();
let current: Glyph | undefined,
  original: Glyph | undefined,
  rawOriginal: Glyph | undefined;
let referenceHeights: ReferenceHeights = {};
let latinReferenceCounts: LatinReferences = { upper: 0, lower: 0 };
let profileSamples: Glyph[] = [];
let cachedProfile:
  | { document: GlyphDocument; revision: number; font: FontSummary }
  | undefined;
let editingBusy = true;
let autofilling = false;
let queueRevision = 0,
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  sessionTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve(),
  dirty = false,
  exporting = false;
const INK = "#eee9d7";
function error(value: unknown) {
  if (value instanceof DOMException && value.name === "AbortError") return;
  const text = value instanceof Error ? value.message : String(value);
  $("error").textContent = text;
  $("error").hidden = false;
  console.error(text);
}
function clearError() {
  $("error").hidden = true;
}
function busy(value: boolean) {
  editingBusy = value;
  (document.querySelector(".inspector") as HTMLElement).inert = value;
  for (const id of [
    "autofill",
    "geometry",
    "placement-apply",
    "raster-apply",
    "move",
    "scale",
    "mirror-h",
    "mirror-v",
    "rect",
    "lasso",
    "previous",
    "next",
    "review",
    "copy",
    "map",
    "new",
    "resize",
    "advance-apply",
    "restore",
    "pencil",
    "eraser",
    "flip",
    "undo",
    "redo",
    "font-guides-open",
    "comparison-current",
    "candidate-generate",
    "style-open",
    "style-latin-open",
  ])
    $<HTMLButtonElement>(id).disabled = value;
}
function progressUpdate() {
  if (!doc || !font) return;
  boot.progress[font.id] = {
    edits:
      Object.keys(doc.state.edits).length +
      (Object.keys(doc.state.fontGuides ?? {}).length ? 1 : 0) +
      (doc.state.fontCell ? 1 : 0),
    reviewed: doc.state.reviewed.length,
    done: doc.state.done,
    latinReferences:
      doc.state.latinReferences?.checkedRevision === doc.state.revision
        ? doc.state.latinReferences
        : fonts.find((f) => f.id === font!.id)?.latinReferences,
    ukrainianPresent:
      doc.state.ukrainianCoverage?.checkedRevision === doc.state.revision
        ? doc.state.ukrainianCoverage.present
        : boot.progress[font.id]?.ukrainianPresent,
  };
  const done = Object.values(boot.progress).filter((p) => p.done).length,
    changed = Object.values(boot.progress).filter((p) => p.edits > 0).length;
  $("overall").textContent = `${done} переглянуто · ${changed} з правками`;
  renderFonts();
}
function scheduleSave() {
  if (!doc) return;
  dirty = true;
  $("save-status").textContent = "Є незбережені правки";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist().catch(error), 300);
  progressUpdate();
}
async function persist() {
  clearTimeout(saveTimer);
  if (!doc || !font || !dirty) return saving;
  const state = structuredClone(doc.state),
    id = font.id,
    revision = state.revision,
    targetFace = face!,
    targetCount = font.coverage.glyphCount;
  dirty = false;
  const task = saving
    .catch(() => {})
    .then(async () => {
      state.ukrainianCoverage = await ukrainianCoverage(
        state,
        targetFace.index.unicodeIndex,
        async (gid) =>
          Number(gid.slice(1)) < targetCount
            ? (await targetFace.glyphs([Number(gid.slice(1))]))[0]
            : undefined,
      );
      const refIndex = effectiveIndex(targetFace.index.unicodeIndex, state);
      const refGlyphs = await Promise.all(
        [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"]
          .flatMap((c) => refIndex.get(c) ?? [])
          .map(
            async (gid) =>
              state.edits[gid] ??
              (Number(gid.slice(1)) < targetCount
                ? (await targetFace.glyphs([Number(gid.slice(1))]))[0]
                : undefined),
          ),
      );
      state.latinReferences = {
        ...latinReferences(refGlyphs.filter((g): g is Glyph => !!g)),
        checkedRevision: revision,
      };
      await native("saveState", { id, state });
      if (doc?.state.fontId === id && doc.state.revision === revision) {
        doc.state.ukrainianCoverage = state.ukrainianCoverage;
        doc.state.latinReferences = state.latinReferences;
        progressUpdate();
        $("save-status").textContent = "Збережено локально";
      }
    });
  saving = task.catch((reason) => {
    if (doc?.state.fontId === id) dirty = true;
    $("save-status").textContent = "Помилка збереження";
    throw reason;
  });
  return saving;
}
function session() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(
    () =>
      void native("saveSession", {
        fontId: font?.id,
        mode: $<HTMLSelectElement>("mode").value,
        slot: slots[selected]?.key,
        q: $<HTMLInputElement>("search").value,
        collection: $<HTMLSelectElement>("collection").value,
        filter: $<HTMLSelectElement>("font-filter").value,
        ...groups.save(),
        workspaceView,
        workspaceLayout: "gallery-1",
      }).catch(error),
    350,
  );
}
async function flush() {
  await canvasUI.flushRegions();
  clearTimeout(saveTimer);
  await persist();
  await saving;
  clearTimeout(sessionTimer);
  await native("saveSession", {
    fontId: font?.id,
    mode: $<HTMLSelectElement>("mode").value,
    slot: slots[selected]?.key,
    q: $<HTMLInputElement>("search").value,
    collection: $<HTMLSelectElement>("collection").value,
    filter: $<HTMLSelectElement>("font-filter").value,
    ...groups.save(),
    workspaceView,
    workspaceLayout: "gallery-1",
  });
}
window.glyphEditorFlush = flush;
function filterFonts() {
  const terms = $<HTMLInputElement>("search")
      .value.toLocaleLowerCase("uk")
      .trim()
      .split(/\s+/)
      .filter(Boolean),
    collection = $<HTMLSelectElement>("collection").value,
    filter = $<HTMLSelectElement>("font-filter").value;
  visibleFonts = fonts.filter((f) => {
    const p = boot.progress[f.id];
    return (
      terms.every((t) =>
        `${f.id} ${f.name} ${f.family}`.toLocaleLowerCase("uk").includes(t),
      ) &&
      (!collection || f.collection === collection) &&
      (filter === "all" ||
        (filter === "pending" && !p?.done) ||
        (filter === "ua" &&
          (p?.ukrainianPresent ?? f.coverage.ukrainian.present ?? 0) < 66) ||
        (filter === "changed" && (p?.edits ?? 0) > 0) ||
        (filter === "latin-missing" &&
          (!(p?.latinReferences ?? f.latinReferences)?.upper ||
            !(p?.latinReferences ?? f.latinReferences)?.lower)) ||
        (filter === "done" && p?.done))
    );
  });
  $("library-count").textContent =
    `У черзі: ${visibleFonts.length.toLocaleString("uk")}`;
  $("font-list-inner").style.height = visibleFonts.length * 52 + "px";
  renderFonts();
  updateLibrary();
  session();
}
function renderFonts() {
  const list = $("font-list"),
    inner = $("font-list-inner");
  if (!boot) return;
  const start = Math.max(0, Math.floor(list.scrollTop / 52) - 2),
    end = Math.min(
      visibleFonts.length,
      start + Math.ceil(list.clientHeight / 52) + 5,
    );
  inner.replaceChildren();
  for (let i = start; i < end; i++) {
    const f = visibleFonts[i],
      p = boot.progress[f.id],
      button = document.createElement("button");
    button.className = "font-row";
    button.style.top = i * 52 + "px";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(font?.id === f.id));
    button.title = f.name + " · " + f.id;
    const name = document.createElement("strong"),
      meta = document.createElement("small");
    name.textContent = f.name;
    const dimensions = font?.id === f.id ? currentCell() : f.cell;
    meta.textContent = `${dimensions.width}×${dimensions.height} · UA ${p?.ukrainianPresent ?? f.coverage.ukrainian.present ?? "?"}/66${p?.done ? " · ✓" : ""}${p?.edits ? " · правок: " + p.edits : ""}`;
    if (p?.edits) meta.className = "edited";
    button.append(name, meta);
    button.onclick = () =>
      void openFont(f.id)
        .then(() => switchWorkspace("font"))
        .catch(error);
    inner.append(button);
  }
}
async function openFont(id: string, resume?: string) {
  if (font?.id === id && face) return;
  await flush();
  clearError();
  $("autofill-status").textContent = "";
  const revision = ++fontRevision;
  comparison.reset();
  candidateChooser.reset();
  styleWorkbench.reset();
  guideEditor.close();
  referenceHeights = {};
  latinReferenceCounts = { upper: 0, lower: 0 };
  cachedProfile = undefined;
  selectionRevision++;
  queueRevision++;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  busy(true);
  $("save-status").textContent = "Відкриття шрифту…";
  try {
    const [summary, state] = await Promise.all([
      native<FontSummary>("summary", { id }),
      native<Draft | null>("readState", { id }),
    ]);
    if (revision !== fontRevision) return;
    const loaded = await NativeFont.open(summary, cache, signal);
    if (revision !== fontRevision) return;
    font = summary;
    face = loaded;
    doc = new GlyphDocument(state ?? newDraft(summary, boot.snapshot));
    const samples = await loaded.glyphs(
      frameOrdinals(summary.coverage.glyphCount, loaded.index.unicodeIndex),
    );
    if (revision !== fontRevision) return;
    profileSamples = samples;
    dirty = false;
    $("font-name").textContent = font.name;
    $("font-source").textContent = `${font.collection} · ${font.licenseId}`;
    $("font-meta").textContent =
      `${font.cell.width}×${font.cell.height} · ${font.coverage.glyphCount.toLocaleString("uk")} вихідних гліфів · українська ${font.coverage.ukrainian.present ?? "?"}/66`;
    $<HTMLTextAreaElement>("notes").value = doc.state.notes ?? "";
    selected = 0;
    slots = [];
    const queue = $<HTMLSelectElement>("mode");
    queue.value = initialQueue(
      queue.value,
      effectiveIndex(loaded.index.unicodeIndex, doc.state),
    );
    if (
      queue.value === "groups" &&
      !selectedGroupSlots(
        groups.get(),
        effectiveIndex(loaded.index.unicodeIndex, doc.state),
      ).some((slot) => slot.id)
    )
      queue.value = "all";
    const profile = editingProfile(font, profileSamples);
    if (
      profile.cell.width !== font.cell.width ||
      profile.cell.height !== font.cell.height
    )
      $("font-meta").textContent +=
        ` · типова комірка ${profile.cell.width}×${profile.cell.height}`;
    $("mapping-notice").hidden =
      Object.keys(loaded.index.unicodeIndex).length > 0;
    rebuildSlots(resume);
    if (!resume && $<HTMLSelectElement>("mode").value === "all") {
      const sample = await Promise.all(
        slots
          .slice(0, 64)
          .map((slot) => (slot.id ? glyph(slot.id) : undefined)),
      );
      if (revision !== fontRevision) return;
      const firstInk = sample.findIndex((glyph) =>
        glyph?.rows.some((row) => /[1-9A-Fa-f]/.test(row)),
      );
      if (firstInk >= 0) selected = firstInk;
    }
    progressUpdate();
    const listPosition = visibleFonts.findIndex((item) => item.id === id);
    if (listPosition >= 0) {
      const list = $("font-list");
      list.scrollTop = Math.max(0, listPosition * 52 - list.clientHeight / 2);
      renderFonts();
    }
    await select(selected, true);
    void loadReferenceHeights(summary, loaded, revision).catch(error);
    void draftCoverage().catch(error);
    $("save-status").textContent = "Збереження правок — автоматично";
    session();
  } catch (reason) {
    if (revision === fontRevision) {
      face = undefined;
      current = undefined;
      draw();
      throw reason;
    }
  }
}
async function loadReferenceHeights(
  summary: FontSummary,
  loaded: NativeFont,
  revision: number,
) {
  const reference = async (chars: string[]) => {
    for (const char of chars) {
      const ordinal = loaded.index.unicodeIndex[char]?.[0];
      if (ordinal === undefined) continue;
      const value = (await loaded.glyphs([ordinal]))[0];
      if (value) {
        const height = referenceHeight(value);
        if (height !== undefined) return height;
      }
    }
  };
  const [cap, x] = await Promise.all([
    reference(["H", "Н"]),
    reference(["x", "х"]),
  ]);
  if (revision !== fontRevision || font?.id !== summary.id) return;
  referenceHeights = { cap, x };
  scheduleDraw();
}
function rebuildSlots(preferred = slots[selected]?.key) {
  if (!face || !doc || !font) {
    slots = [];
    return;
  }
  index = effectiveIndex(face.index.unicodeIndex, doc.state);
  $("mapping-notice").hidden = [...index.values()].some(
    (ids) => ids.length > 0,
  );
  const mode = $<HTMLSelectElement>("mode").value;
  $("view-all-glyphs").setAttribute("aria-pressed", String(mode === "all"));
  $("view-groups").setAttribute("aria-pressed", String(mode === "groups"));
  const ids = [
    ...Array.from(
      { length: font.coverage.glyphCount },
      (_, i) => "g" + String(i).padStart(6, "0"),
    ),
    ...doc.state.created,
  ];
  const mapped = new Set([...index.values()].flat());
  slots =
    (mode === "groups"
      ? selectedGroupSlots(groups.get(), index)
      : canonicalSlots(mode, index)) ??
    (mode === "changed"
      ? Object.keys(doc.state.edits)
      : mode === "unmapped"
        ? ids.filter((id) => !mapped.has(id))
        : ids
    ).map((id) => ({ key: id, id }));
  if ($<HTMLInputElement>("unreviewed").checked)
    slots = slots.filter((s) => !doc!.state.reviewed.includes(s.key));
  const found = slots.findIndex((s) => s.key === preferred);
  selected =
    found >= 0 ? found : Math.max(0, Math.min(selected, slots.length - 1));
}
async function glyph(id: string): Promise<Glyph | undefined> {
  if (!doc || !face || !font) return;
  const edited = doc.state.edits[id];
  if (edited) return normalizeCell(edited, currentCell());
  const n = Number(id.slice(1));
  return n < font.coverage.glyphCount
    ? normalizeCell((await face.glyphs([n]))[0], currentCell())
    : undefined;
}
async function select(position: number, fit = false) {
  const token = ++selectionRevision;
  await canvasUI.flushRegions();
  if (token !== selectionRevision) return;
  if (!font || !face || !doc) return;
  selected = Math.max(0, Math.min(position, slots.length - 1));
  const slot = slots[selected];
  busy(true);
  current = undefined;
  original = undefined;
  rawOriginal = undefined;
  draw();
  if (!slot) {
    $("glyph-title").textContent =
      "Чергу завершено або немає відповідних гліфів";
    await renderQueue();
    return;
  }
  const id = slot.id ?? doc.nextID(font.coverage.glyphCount);
  const loaded = slot.id ? await glyph(id) : newGlyph(id, slot.char!);
  const rawSource =
    Number(id.slice(1)) < font.coverage.glyphCount
      ? (await face.glyphs([Number(id.slice(1))]))[0]
      : undefined;
  const source = rawSource
    ? normalizeCell(rawSource, currentCell())
    : undefined;
  if (token !== selectionRevision) return;
  current = loaded;
  original = source;
  rawOriginal = rawSource;
  if (!current) return;
  if (fit) fitZoom();
  inspect();
  draw();
  busy(false);
  updateButtons();
  await renderQueue();
  session();
}
let proofRevision = 0,
  proofTimer: ReturnType<typeof setTimeout> | undefined;
async function proofPaint() {
  if (!face || !font || !doc || !$<HTMLDetailsElement>("proof-panel").open)
    return;
  const token = ++proofRevision,
    target = font,
    value = $<HTMLInputElement>("proof-text").value,
    byChar = new Map<string, Glyph>(),
    effective = effectiveIndex(face.index.unicodeIndex, doc.state);
  await Promise.all(
    [...new Set([...value])].map(async (char) => {
      const id = effective.get(char)?.[0],
        g = id ? await glyph(id) : undefined;
      if (g) byChar.set(char, g);
    }),
  );
  if (token !== proofRevision || font?.id !== target.id) return;
  const summary = effectiveFont()!;
  paintSpecimen(
    $<HTMLCanvasElement>("proof-canvas"),
    summary,
    byChar,
    value,
    2,
    Math.max(200, $("proof-stage").clientWidth),
    INK,
    painter,
  );
  const missing = [...new Set([...value])].filter(
    (c) => c !== "\n" && !byChar.has(c),
  );
  $("proof-status").textContent = missing.length
    ? "Немає: " + missing.join(" ")
    : "Усі символи є";
}
function scheduleProof() {
  clearTimeout(proofTimer);
  proofTimer = setTimeout(() => void proofPaint().catch(error), 50);
}
$<HTMLInputElement>("proof-text").oninput = scheduleProof;
$<HTMLDetailsElement>("proof-panel").ontoggle = scheduleProof;
let coverageRevision = 0;
async function draftCoverage() {
  if (!font || !doc || !face) return;
  const token = ++coverageRevision,
    id = font.id;
  const effective = effectiveIndex(face.index.unicodeIndex, doc.state);
  const latinGlyphs = await Promise.all(
    [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"]
      .flatMap((c) => effective.get(c) ?? [])
      .map(glyph),
  );
  if (token !== coverageRevision || font?.id !== id) return;
  latinReferenceCounts = latinReferences(
    latinGlyphs.filter((g): g is Glyph => !!g),
  );
  const listing = fonts.find((f) => f.id === id);
  if (listing) listing.latinReferences = latinReferenceCounts;
  if (boot.progress[id])
    boot.progress[id].latinReferences = latinReferenceCounts;
  $("latin-reference-notice").hidden =
    !!latinReferenceCounts.upper && !!latinReferenceCounts.lower;
  $("latin-reference-notice").textContent =
    !latinReferenceCounts.upper && !latinReferenceCounts.lower
      ? "Немає латинських референсів. Українська генерація заблокована: спочатку перевірте Unicode-мапу або додайте латинку."
      : `Латинські референси: ${latinReferenceCounts.upper} великих, ${latinReferenceCounts.lower} малих. Група без референсів не генерується.`;
  updateButtons();
  const coverage = await ukrainianCoverage(
    doc.state,
    face.index.unicodeIndex,
    async (gid) => glyph(gid),
  );
  const present = coverage.present;
  if (token !== coverageRevision || font?.id !== id) return;
  const mapped = [...effective.values()].some((ids) => ids.length);
  if (boot.progress[id]) boot.progress[id].ukrainianPresent = present;
  const frame = currentCell();
  $("generation-notice").hidden = !doc.state.bulkGeneration?.needsVisualReview;
  $("generation-notice").textContent =
    "Українські гліфи доповнено автоматично. Нові літери очікують візуального перегляду.";
  $("font-meta").textContent =
    `Комірка ${frame.width}×${frame.height} · моноширинний крок ${frame.advanceX} · ${font.coverage.glyphCount.toLocaleString("uk")} вихідних гліфів · українська: джерело ${font.coverage.ukrainian.present ?? "?"}/66 → правка ${mapped ? present : "?"}/66`;
  if (
    ["latin-missing", "ua"].includes($<HTMLSelectElement>("font-filter").value)
  )
    filterFonts();
  else renderFonts();
  scheduleProof();
}
function inspect() {
  if (!current || !doc) return;
  const slot = slots[selected];
  $("character").textContent = glyphCaption(slot?.char, current);
  $("editor-dock-title").textContent = glyphCaption(slot?.char, current);
  $("glyph-meta").textContent =
    `${current.id} · ${original ? "джерельний" : "новий"} · ${current.width}×${current.height}${current.sourceCode?.value ? " · код " + String(current.sourceCode.value) : ""}`;
  $("glyph-title").textContent =
    `${glyphCaption(slot?.char, current)} · ${current.id} · ${current.width}×${current.height} · ${doc.state.reviewed.includes(slot?.key) ? "переглянуто" : "не переглянуто"}`;
  const raw =
    doc.state.edits[current.id] ??
    rawOriginal ??
    profileSamples.find((g) => g.id === current!.id);
  if (raw && cellNeedsFit(raw, currentCell()))
    $("glyph-meta").textContent +=
      ` · вихідний растр ${raw.width}×${raw.height} вміщено піксельним масштабуванням`;
  $<HTMLInputElement>("width").value = String(current.width);
  $<HTMLInputElement>("height").value = String(current.height);
  for (const id of ["raster-dx", "raster-dy"])
    $<HTMLInputElement>(id).value = "0";
  for (const id of ["raster-sx", "raster-sy"])
    $<HTMLInputElement>(id).value = "100";
  $<HTMLInputElement>("advance").value = String(current.advanceX);
  $<HTMLInputElement>("bearing").value = String(current.metrics.leftBearing);
  $<HTMLInputElement>("shift-up").value = String(current.metrics.shiftUp);
  $<HTMLInputElement>("mapping").value = slot?.char ?? current.character ?? "";
  $("labels").textContent =
    current.labels
      .filter((l) => l.kind === "unicode")
      .map(
        (l) =>
          `${characterLabel(l.value)} (${[...l.value].map(codepoint).join(" ")})`,
      )
      .join(", ") || "Немає Unicode-мапи";
  $("progress").textContent =
    `${selected + 1}/${slots.length} · правок: ${Object.keys(doc.state.edits).length} · позначок перегляду: ${doc.state.reviewed.length}`;
}
function updateButtons() {
  $<HTMLButtonElement>("style-latin-open").disabled =
    editingBusy || (!latinReferenceCounts.upper && !latinReferenceCounts.lower);
  $<HTMLButtonElement>("undo").disabled = !doc?.canUndo;
  $<HTMLButtonElement>("redo").disabled = !doc?.canRedo;
  $<HTMLButtonElement>("previous").disabled = !slots.length || selected === 0;
  $<HTMLButtonElement>("next").disabled =
    !slots.length || selected >= slots.length - 1;
}
function automaticFont() {
  if (!font || !doc) return font;
  if (
    cachedProfile?.document !== doc ||
    cachedProfile.revision !== doc.state.revision
  ) {
    const samples = profileSamples.map((g) => doc!.state.edits[g.id] ?? g);
    samples.push(
      ...doc.state.created.flatMap((id) =>
        doc!.state.edits[id] ? [doc!.state.edits[id]] : [],
      ),
    );
    cachedProfile = {
      document: doc,
      revision: doc.state.revision,
      font: editingProfile(
        font,
        samples.map((g) => normalizeCell(g, currentCell())),
        currentCell(),
      ),
    };
  }
  return cachedProfile.font;
}
function effectiveFont() {
  const automatic = automaticFont();
  return automatic
    ? fontWithGuides(automatic, doc?.state.fontGuides)
    : undefined;
}
let cachedCell:
  | {
      font: FontSummary;
      samples: Glyph[];
      override: FontCell | undefined;
      value: FontCell;
    }
  | undefined;
function currentCell(): FontCell {
  if (
    !cachedCell ||
    cachedCell.font !== font ||
    cachedCell.samples !== profileSamples ||
    cachedCell.override !== doc?.state.fontCell
  )
    cachedCell = {
      font: font!,
      samples: profileSamples,
      override: doc?.state.fontCell,
      value: fixedCell(font!, profileSamples, doc?.state.fontCell),
    };
  return cachedCell.value;
}
function newGlyph(id: string, char: string) {
  return blankGlyph(automaticFont()!, id, char);
}
async function changeCell(value: FontCell) {
  const target = doc;
  await canvasUI.flushRegions();
  if (!doc || doc !== target || !doc.commitFontCell(value)) return;
  comparison.reset();
  candidateChooser.reset();
  styleWorkbench.reset();
  scheduleSave();
  rebuildSlots();
  await select(selected, true);
  await draftCoverage();
  renderFonts();
  updateLibrary(true);
}
$("ascii-map-open").onclick = () =>
  void (async () => {
    await canvasUI.flushRegions();
    if (!face || !font || !doc || editingBusy) return;
    const targetDoc = doc,
      targetFace = face,
      targetFont = font,
      revision = doc.state.revision;
    if (targetFont.coverage.glyphCount > 8192)
      throw new Error("Ця мапа підтримує до 8192 вихідних гліфів.");
    const values: Glyph[] = [];
    for (let start = 0; start < targetFont.coverage.glyphCount; start += 128) {
      const batch = await targetFace.glyphs(
        Array.from(
          { length: Math.min(128, targetFont.coverage.glyphCount - start) },
          (_, i) => start + i,
        ),
      );
      values.push(...batch.map((g) => targetDoc.state.edits[g.id] ?? g));
    }
    if (targetDoc !== doc || doc.state.revision !== revision) return;
    const edits = asciiMapping(values, index);
    if (!(await chooseAsciiMapping(edits))) return;
    if (targetDoc !== doc || doc.state.revision !== revision)
      throw new Error("Шрифт змінився; відкрийте мапу повторно.");
    doc.commitBatch(edits);
    profileSamples = values;
    cachedProfile = undefined;
    scheduleSave();
    $<HTMLSelectElement>("mode").value = "latin";
    rebuildSlots();
    await select(0, true);
    await draftCoverage();
    $("autofill-status").textContent =
      `Додано ASCII-мапу: ${edits.length} знаків. Тепер можна доповнювати українську з латинки.`;
  })().catch(error);
const comparison = createComparison({
  get: () => ({ fontId: font?.id, current, busy: editingBusy || exporting }),
  resolve: async (query) => {
    if (!doc || !face || !font) return;
    const value = query.trim();
    const id = /^g\d{6}$/.test(value)
      ? value
      : index.get(parseChar(value))?.[0];
    return id ? glyph(id) : undefined;
  },
  changed: () => scheduleDraw(),
  error,
});
const guideEditor = createFontGuidesEditor({
  get: () => ({
    font: automaticFont(),
    overrides: doc?.state.fontGuides,
    reference: referenceHeights,
    busy: editingBusy || exporting,
  }),
  apply: async (value) => {
    const target = doc;
    await canvasUI.flushRegions();
    if (!font || !doc || doc !== target || editingBusy || exporting) return;
    fontWithGuides(font, value);
    if (!doc.commitFontGuides(value)) return;
    scheduleSave();
    updateButtons();
    draw();
    scheduleProof();
  },
  error,
});
const candidateChooser = createCandidateChooser({
  request: async () => {
    await canvasUI.flushRegions();
    if (!font || !doc || !current || editingBusy || exporting) return;
    const target = current,
      revision = doc.state.revision,
      targetFont = font;
    clearError();
    const character = slots[selected]?.char ?? mappedCharacter(current);
    if (!character || [...character].length !== 1)
      throw new Error("Спочатку задайте Unicode-мапу гліфа.");
    const ids = [
      ...new Set([..."HНxхoоnпkкрp"].flatMap((c) => index.get(c) ?? [])),
    ]
      .filter((id) => id !== target.id)
      .slice(0, 12);
    const references = (await Promise.all(ids.map((id) => glyph(id)))).filter(
      (g): g is Glyph => !!g,
    );
    if (
      font !== targetFont ||
      !doc ||
      doc.state.revision !== revision ||
      current !== target
    )
      return;
    return {
      snapshot: boot.snapshot,
      font: effectiveFont(),
      target: hiddenTarget(target),
      references,
      character,
      count: 8,
      revision,
      targetSignature: glyphSignature(target),
    };
  },
  valid: (result) =>
    !!font &&
    !!doc &&
    !!current &&
    result.fontId === font.id &&
    result.baseSha256 === font.sha256 &&
    result.snapshot === boot.snapshot &&
    result.glyphId === current.id &&
    result.revision === doc.state.revision &&
    result.targetSignature === glyphSignature(current),
  target: () => current,
  apply: async (candidate, result) => {
    await canvasUI.flushRegions();
    if (
      !doc ||
      !current ||
      !font ||
      result.fontId !== font.id ||
      result.revision !== doc.state.revision ||
      result.targetSignature !== glyphSignature(current)
    )
      throw new Error("Гліф змінився. Повторіть генерацію.");
    const after = candidateGlyph(current, candidate);
    if (
      !doc.commitBatch([
        {
          id: current.id,
          glyph: after,
          source: original,
          derivation: candidateDerivation(current, candidate, result.character),
        },
      ])
    )
      return;
    current = after;
    $<HTMLSelectElement>("view").value = "edit";
    rebuildSlots();
    scheduleSave();
    inspect();
    draw();
    updateButtons();
    void renderQueue().catch(error);
    void draftCoverage().catch(error);
  },
  backdrop: (glyph) => {
    comparison.pin(glyph);
    $<HTMLDetailsElement>("comparison-panel").open = true;
    draw();
  },
  error,
});
let styleSession:
  | {
      document: GlyphDocument;
      revision: number;
      fontId: string;
      targets: StyleTarget[];
    }
  | undefined;
const styleWorkbench = createStyleWorkbench({
  latinTargets: () => latinSupportedTargets(latinReferenceCounts),
  fonts: () => fonts,
  before: async () => {
    candidateChooser.reset();
    await canvasUI.flushRegions();
  },
  load: async (id, characters) => {
    if (!font || !doc || !face) throw new Error("Виберіть шрифт призначення.");
    const targetDoc = doc,
      targetFont = font,
      sourceId = id || font.id;
    const summary =
      sourceId === font.id
        ? font
        : await native<FontSummary>("summary", { id: sourceId });
    const sourceFace =
      sourceId === font.id
        ? face
        : await NativeFont.open(summary, cache, new AbortController().signal);
    const state =
      sourceId === font.id
        ? doc.state
        : await native<Draft | null>("readState", { id: sourceId });
    const mapping = state
      ? effectiveIndex(sourceFace.index.unicodeIndex, state)
      : new Map(
          Object.entries(sourceFace.index.unicodeIndex).map(
            ([char, values]) => [
              char,
              values.map((n) => "g" + String(n).padStart(6, "0")),
            ],
          ),
        );
    const glyphs: Glyph[] = [],
      missing: string[] = [];
    for (const char of characters) {
      const ids = mapping.get(char) ?? [];
      if (ids.length > 1)
        throw new Error(
          `Референс ${char} має кілька гліфів; задайте однозначну мапу.`,
        );
      const gid = ids[0],
        ordinal = gid ? Number(gid.slice(1)) : Infinity;
      const value = gid
        ? (state?.edits[gid] ??
          (ordinal < summary.coverage.glyphCount
            ? (await sourceFace.glyphs([ordinal]))[0]
            : undefined))
        : undefined;
      if (value && value.rows.some((row) => /[1-9a-f]/i.test(row)))
        glyphs.push({
          ...structuredClone(value),
          character: char,
          labels: [{ kind: "unicode", value: char }],
        });
      else missing.push(char);
    }
    if (doc !== targetDoc || font !== targetFont)
      throw new Error("Шрифт змінився; повторіть читання референсу.");
    const samples = await sourceFace.glyphs(
      frameOrdinals(summary.coverage.glyphCount, sourceFace.index.unicodeIndex),
    );
    const frame = fixedCell(summary, samples, state?.fontCell);
    const effective = fontWithGuides(
      editingProfile(summary, samples, frame),
      state?.fontGuides,
    );
    return {
      font: {
        id: summary.id,
        name: summary.name,
        sha256: summary.sha256,
        cell: effective.cell,
        metrics: effective.metrics,
        licenseId: summary.licenseId,
        license: sourceFace.index.font.license,
        source: sourceFace.index.font.source,
        draftRevision: state?.revision,
      },
      glyphs: glyphs.map((g) => normalizeCell(g, frame)),
      missing,
    };
  },
  prepare: async (characters, onlyMissing, reference, mode, preferLatin) => {
    requireLatinReferences(reference.glyphs, characters);
    await canvasUI.flushRegions();
    if (!doc || !font || !face || exporting || editingBusy) return;
    const document = doc,
      targetFont = font,
      targetFace = face,
      revision = doc.state.revision;
    const result = await planStyleTargets({
      font: effectiveFont()!,
      blank: newGlyph,
      state: doc.state,
      index: effectiveIndex(face.index.unicodeIndex, doc.state),
      characters,
      onlyMissing,
      load: glyph,
      source: async (id) =>
        Number(id.slice(1)) < targetFont.coverage.glyphCount
          ? normalizeCell(
              (await targetFace.glyphs([Number(id.slice(1))]))[0],
              currentCell(),
            )
          : undefined,
    });
    if (
      doc !== document ||
      font !== targetFont ||
      doc.state.revision !== revision
    )
      throw new Error("Шрифт змінився. Повторіть пошук.");
    styleSession = {
      document,
      revision,
      fontId: font.id,
      targets: result.targets,
    };
    return {
      ...result,
      request: {
        snapshot: boot.snapshot,
        font: effectiveFont(),
        referenceFont: reference.font,
        references: reference.glyphs,
        mode,
        preferLatin,
        count: 8,
        revision,
        targets: result.targets.map(styleTargetRequest),
      },
    };
  },
  valid: () =>
    !!doc &&
    !!font &&
    !!styleSession &&
    doc === styleSession.document &&
    font.id === styleSession.fontId &&
    doc.state.revision === styleSession.revision,
  apply: async (choices) => {
    await canvasUI.flushRegions();
    const session = styleSession;
    if (
      !doc ||
      !font ||
      !session ||
      doc !== session.document ||
      font.id !== session.fontId ||
      doc.state.revision !== session.revision
    )
      throw new Error("Шрифт змінився. Повторіть пошук.");
    const edits = choices.map((choice) => {
      const planned = session.targets.find(
        (t) => t.character === choice.character,
      );
      if (!planned) throw new Error("Літера поза планом.");
      return {
        id: planned.target.id,
        glyph: candidateGlyph(planned.target, choice.candidate),
        source: planned.source,
        derivation: candidateDerivation(
          planned.target,
          choice.candidate,
          choice.character,
        ),
      };
    });
    if (!doc.commitBatch(edits)) return;
    scheduleSave();
    rebuildSlots();
    await select(selected);
    void draftCoverage().catch(error);
  },
  error,
});
$("style-latin-open").onclick = () => void styleWorkbench.openLatin();
const canvasUI = createCanvas({
  get: () => ({
    glyph: current,
    original,
    editable: !editingBusy && !exporting,
    key: `${font?.id ?? ""}:${current?.id ?? ""}`,
    font: effectiveFont(),
    comparison: comparison.get(),
    references: referenceHeights,
    origin:
      font && current
        ? {
            fontId: font.id,
            glyphId: current.id,
            sha256: font.sha256,
            licenseId: font.licenseId,
            char: mappedCharacter(current),
            baseline: current.height + current.metrics.shiftUp,
            advanceX: current.advanceX,
            draftRevision: doc?.state.revision,
          }
        : undefined,
  }),
  commit: (after, origin) => commit(after, origin),
});
function draw() {
  canvasUI.draw();
}
function scheduleDraw() {
  canvasUI.scheduleDraw();
}
function fitZoom() {
  canvasUI.fitZoom();
}
function finishStroke() {
  canvasUI.finishStroke();
}
function commit(after: Glyph | undefined, origin?: RegionOrigin) {
  if (!current || !doc) return;
  const id = current.id;
  if (after) after = normalizeCell(after, currentCell());
  const changed = origin
    ? doc.commitBatch([
        {
          id,
          glyph: after,
          source: original,
          derivation: {
            sourceGlyphId: origin.glyphId,
            sourceFontId: origin.fontId,
            sourceSha256: origin.sha256,
            sourceLicenseId: origin.licenseId,
            sourceChar: origin.char ?? "",
            targetChar: current.character ?? "",
            transform: "region-paste",
            kind: "geometry",
            recipeVersion: 1,
          },
        },
      ])
    : doc.commit(id, after, original);
  if (!changed) return;
  if (after) {
    current = structuredClone(after);
  } else {
    current = original ? structuredClone(original) : undefined;
  }
  rebuildSlots();
  scheduleSave();
  inspect();
  draw();
  updateButtons();
  void draftCoverage().catch(error);
  updateLibrary(true);
  void renderQueue().catch(error);
}
async function renderQueue() {
  if (!doc || !font) return;
  await gallery.set(
    slots,
    selected,
    doc.state,
    font.id,
    $<HTMLSelectElement>("mode").value === "groups",
  );
}
async function nextFont(delta: number) {
  const i = visibleFonts.findIndex((f) => f.id === font?.id),
    target =
      visibleFonts[
        i < 0 ? 0 : Math.max(0, Math.min(visibleFonts.length - 1, i + delta))
      ];
  if (target) await openFont(target.id);
  else $("save-status").textContent = "Немає шрифтів у цій черзі";
}
async function move(delta: number) {
  if (!slots.length) return;
  if (selected + delta >= slots.length) {
    await nextFont(1);
    return;
  }
  await select(Math.max(0, selected + delta));
}
async function review() {
  if (!doc || !slots[selected]) return;
  finishStroke();
  const old = selected,
    key = slots[selected].key;
  doc.review(key);
  if (slots[selected].id && slots[selected].id !== key)
    doc.review(slots[selected].id!);
  scheduleSave();
  rebuildSlots();
  if (!slots.length) {
    await nextFont(1);
    return;
  }
  await select(
    $<HTMLInputElement>("unreviewed").checked
      ? Math.min(old, slots.length - 1)
      : Math.min(old + 1, slots.length - 1),
  );
  if (!$<HTMLInputElement>("unreviewed").checked && old === slots.length - 1)
    await nextFont(1);
}
async function completeFont() {
  await canvasUI.flushRegions();
  if (!doc) return;
  doc.state.done = true;
  doc.touch();
  scheduleSave();
  await flush();
  await nextFont(1);
  filterFonts();
}
async function history(redo = false) {
  await canvasUI.flushRegions();
  if (!doc) return;
  const id = redo ? doc.redo() : doc.undo();
  if (!id) return;
  if (id === "$font") {
    comparison.reset();
    updateLibrary(true);
  }
  const oldKey = slots[selected]?.key;
  rebuildSlots(oldKey);
  const kept = slots.findIndex((s) => s.key === oldKey && s.id === id);
  const i = kept >= 0 ? kept : slots.findIndex((s) => s.id === id);
  scheduleSave();
  await select(i >= 0 ? i : selected);
  void draftCoverage().catch(error);
}
function parseChar(value: string) {
  value = value.trim();
  if (/^U\+[0-9a-f]{4,6}$/i.test(value)) {
    const cp = parseInt(value.slice(2), 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
      throw new Error("Некоректний Unicode");
    value = String.fromCodePoint(cp);
  }
  if ([...value].length !== 1)
    throw new Error("Введіть один символ або U+0490");
  return value;
}
async function jump(value: string) {
  if (!doc || !face) return;
  let id: string | undefined, char: string | undefined;
  if (/^g\d{6}$/.test(value.trim())) id = value.trim();
  else {
    char = parseChar(value);
    id = index.get(char)?.[0];
  }
  if (char && regionFor(char)) {
    let position = slots.findIndex((s) => s.char === char);
    if (position < 0) {
      $<HTMLSelectElement>("mode").value = regionFor(char)!.id;
      $<HTMLInputElement>("unreviewed").checked = false;
      rebuildSlots(codepoint(char));
      position = slots.findIndex((s) => s.char === char);
    }
    await select(position);
    return;
  }
  if (!id) throw new Error("Немає такого гліфа");
  let i = slots.findIndex((s) => s.id === id);
  if (i < 0) {
    $<HTMLSelectElement>("mode").value = "all";
    $<HTMLInputElement>("unreviewed").checked = false;
    rebuildSlots();
    i = slots.findIndex((s) => s.id === id);
  }
  if (i < 0) throw new Error("Невідомий ID");
  await select(i);
}
async function autofill(kind: "homograph" | "geometry") {
  if (!doc || !face || !font || editingBusy || exporting || autofilling) return;
  autofilling = true;
  try {
    finishStroke();
    const targetDoc = doc,
      targetFace = face,
      count = font.coverage.glyphCount;
    const revision = targetDoc.state.revision;
    $("autofill-status").textContent = "Пошук відповідників…";
    const proposals = await propose(
      kind,
      effectiveIndex(targetFace.index.unicodeIndex, targetDoc.state),
      targetDoc.state,
      glyph,
    );
    if (doc !== targetDoc || targetDoc.state.revision !== revision) return;
    if (!proposals.length) {
      $("autofill-status").textContent =
        "Немає відповідників для заповнення. Потрібні непорожні основи з Unicode; наявні гліфи захищені.";
      return;
    }
    const accepted =
      kind === "geometry" ? await chooseGeometry(proposals) : proposals;
    if (!accepted.length) {
      $("autofill-status").textContent = "Правки не застосовано";
      return;
    }
    // Native menu actions / async font changes must never apply a stale plan.
    if (doc !== targetDoc || targetDoc.state.revision !== revision)
      throw new Error("Шрифт змінився. Повторіть пошук відповідників.");
    const edits = materialize(accepted, targetDoc.state, count).map((edit) => ({
      ...edit,
      glyph: edit.glyph ? normalizeCell(edit.glyph, currentCell()) : undefined,
    }));
    if (!targetDoc.commitBatch(edits)) return;
    scheduleSave();
    rebuildSlots();
    await select(selected);
    await draftCoverage();
    $("autofill-status").textContent =
      `Додано: ${accepted.map((p) => p.from + "→" + p.to).join(", ")}. ⌘Z скасує весь пакет.`;
  } finally {
    autofilling = false;
  }
}
async function copy() {
  finishStroke();
  if (!current || !face) return;
  const revision = selectionRevision,
    document = doc;
  const value = $<HTMLInputElement>("copy-from").value.trim();
  const id = /^g\d{6}$/.test(value) ? value : index.get(parseChar(value))?.[0];
  const base = id ? await glyph(id) : undefined;
  if (revision !== selectionRevision || document !== doc) return;
  if (!base) throw new Error("Гліф-основу не знайдено");
  const after = {
    ...structuredClone(base),
    id: current.id,
    labels: current.labels,
    codepoint: current.codepoint,
    character: current.character,
    sourceCode: current.sourceCode,
  };
  commit(after);
}
async function mapping(create = false) {
  if (!doc || !font || !current) return;
  const char = parseChar($<HTMLInputElement>("mapping").value);
  finishStroke();
  const assigned = index.get(char)?.[0];
  if (assigned && assigned !== current.id)
    throw new Error(`Цей символ уже має гліф ${assigned}. Перейдіть до нього.`);
  if (create) {
    if (assigned) {
      await jump(char);
      return;
    }
    const added = newGlyph(doc.nextID(font.coverage.glyphCount), char);
    doc.commit(added.id, added, undefined);
    scheduleSave();
    $<HTMLSelectElement>("mode").value = "all";
    rebuildSlots(added.id);
    await select(selected);
    return;
  }
  const after = structuredClone(current);
  if (!after.labels.some((l) => l.kind === "unicode" && l.value === char))
    after.labels.push({ kind: "unicode", value: char });
  if (!after.character) {
    after.character = char;
    after.codepoint = codepoint(char);
  }
  commit(after);
}
async function exportOne(id = font?.id) {
  if (!id) return;
  await flush();
  const summary = await native<FontSummary>("summary", { id }),
    state = await native<Draft | null>("readState", { id });
  if (
    !state ||
    (!Object.keys(state.edits).length &&
      !Object.keys(state.fontGuides ?? {}).length &&
      !state.fontCell)
  )
    throw new Error("У цьому шрифті немає правок для експорту");
  const base = JSON.parse(
    await native<string>("readAsset", { path: summary.url }),
  ) as FontRecord;
  return native<{ path: string }>("exportFont", {
    id,
    document: exportRecord(base, state),
  });
}
async function exportAll() {
  await flush();
  const ids = Object.keys(boot.progress).filter(
    (id) => boot.progress[id].edits > 0,
  );
  if (!ids.length) throw new Error("Ще немає змінених шрифтів");
  exporting = true;
  (document.querySelector(".workspace") as HTMLElement).inert = true;
  try {
    for (const [i, id] of ids.entries()) {
      $("save-status").textContent = `Експорт ${i + 1}/${ids.length}`;
      await exportOne(id);
    }
    $("save-status").textContent =
      `Експортовано шрифтів: ${ids.length}. Папка exports`;
  } finally {
    exporting = false;
    (document.querySelector(".workspace") as HTMLElement).inert = false;
  }
}
async function action(value: string) {
  clearError();
  if (
    (choosingGeometry() ||
      $<HTMLDialogElement>("font-guides-dialog").open ||
      candidateChooser.open() ||
      styleWorkbench.open()) &&
    value !== "save"
  )
    return;
  switch (value) {
    case "copy":
    case "cut":
    case "paste":
    case "selectAll":
    case "deselect":
    case "delete-selection":
    case "apply-selection":
      await canvasUI.regionAction(value);
      break;
    case "save":
      await flush();
      $("save-status").textContent = "Збережено локально";
      break;
    case "export": {
      const result = await exportOne();
      $("save-status").textContent = "Експортовано у папку exports";
      if (result) $("save-status").title = result.path;
      break;
    }
    case "autofill":
      await autofill("homograph");
      break;
    case "geometry":
      await autofill("geometry");
      break;
    case "undo":
      await history();
      break;
    case "redo":
      await history(true);
      break;
    case "next":
      await move(1);
      break;
    case "previous":
      await move(-1);
      break;
    case "fit":
      canvasUI.finishViewGesture();
      fitZoom();
      draw();
      break;
  }
}
window.glyphEditorAction = async (value) => {
  try {
    const active = document.activeElement;
    if (value === "deselect" && active?.matches("input,textarea,select"))
      return;
    if (
      (value === "undo" || value === "redo") &&
      active?.matches("input,textarea")
    ) {
      document.execCommand(value);
      return;
    }
    await action(value);
  } catch (reason) {
    error(reason);
  }
};
window.glyphEditorClipboardAction = async (value) => {
  if (
    document.activeElement?.matches(
      "input,textarea,select,[contenteditable=true]",
    )
  )
    return false;
  try {
    if (!exporting && !choosingGeometry()) await action(value);
  } catch (reason) {
    error(reason);
  }
  return true;
};
function on(id: string, handler: () => void | Promise<void>) {
  $(id).onclick = () => {
    if (exporting || (choosingGeometry() && id !== "save")) return;
    clearError();
    Promise.resolve().then(handler).catch(error);
  };
}
on("save", () => action("save"));
on("export", () => action("export"));
on("export-all", exportAll);
on("project", async () => {
  try {
    await native("revealProject");
  } catch {
    $("save-status").textContent = boot.projectPath;
    $("save-status").title = boot.projectPath;
  }
});
on("previous", () => move(-1));
on("next", () => move(1));
on("review", review);
on("font-prev", () => nextFont(-1));
on("font-next", () => nextFont(1));
on("font-done", completeFont);
on("undo", () => history());
on("redo", () => history(true));
on("fit", () => action("fit"));
on("mirror-h", () => canvasUI.mirror("h"));
on("mirror-v", () => canvasUI.mirror("v"));
on("copy", copy);
for (const [id, value] of [
  ["region-copy", "copy"],
  ["region-cut", "cut"],
  ["region-paste", "paste"],
  ["region-all", "selectAll"],
  ["region-none", "deselect"],
  ["region-apply", "apply-selection"],
])
  on(id, () => action(value));
on("autofill", () => autofill("homograph"));
on("geometry", () => autofill("geometry"));
on("map", () => mapping());
on("new", () => mapping(true));
on("restore", () => {
  canvasUI.cancel();
  commit(original ? structuredClone(original) : undefined);
  rebuildSlots();
  void select(selected).catch(error);
});
on("resize", () => {
  const width = Number($<HTMLInputElement>("width").value),
    height = Number($<HTMLInputElement>("height").value);
  const frame = currentCell();
  return changeCell({
    ...frame,
    width,
    height,
    advanceX: width,
    baseline: Math.min(height, frame.baseline),
  });
});
on("advance-apply", () =>
  changeCell({
    ...currentCell(),
    advanceX: Number($<HTMLInputElement>("advance").value),
  }),
);
on("placement-apply", () => {
  const leftBearing = Number($<HTMLInputElement>("bearing").value);
  const shiftUp = Number($<HTMLInputElement>("shift-up").value);
  finishStroke();
  if (!current) return;
  if (
    ![leftBearing, shiftUp].every(
      (n) => Number.isFinite(n) && Math.abs(n) <= 4096,
    )
  )
    throw new Error("Відступ і зсув: від −4096 до 4096");
  commit({
    ...structuredClone(current),
    metrics: {
      ...current.metrics,
      leftBearing,
      shiftUp,
      rightBearing: current.advanceX - leftBearing - current.width,
    },
  });
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-transform]",
))
  button.onclick = () => {
    try {
      const op = button.dataset.transform!;
      const directions: Record<string, [number, number]> = {
        left: [-1, 0],
        right: [1, 0],
        up: [0, -1],
        down: [0, 1],
      };
      if (directions[op]) {
        canvasUI.nudge(...directions[op]);
        canvasUI.finishNudge();
      } else if (op === "flip-x" || op === "flip-y")
        void canvasUI.mirror(op === "flip-x" ? "h" : "v").catch(error);
      else if (op === "clear" && canvasUI.hasSelection())
        void action("delete-selection").catch(error);
      else {
        finishStroke();
        if (current) commit(transformed(current, op));
      }
    } catch (reason) {
      error(reason);
    }
  };
for (const t of ["pencil", "eraser", "flip", "move", "scale", "rect", "lasso"])
  on(t, () => {
    canvasUI.setTool(t);
    for (const id of [
      "pencil",
      "eraser",
      "flip",
      "move",
      "scale",
      "rect",
      "lasso",
    ])
      $(id).classList.toggle("selected", id === t);
  });
on("raster-apply", () => {
  const sx = Number($<HTMLInputElement>("raster-sx").value),
    sy = Number($<HTMLInputElement>("raster-sy").value);
  const dx = Number($<HTMLInputElement>("raster-dx").value),
    dy = Number($<HTMLInputElement>("raster-dy").value);
  const anchor = $<HTMLSelectElement>("raster-anchor").value as Anchor;
  if (![sx, sy].every((n) => Number.isFinite(n) && n >= 12.5 && n <= 800))
    throw new Error("Масштаб растра: 12,5–800 %");
  canvasUI.applyMutation({
    dx,
    dy,
    sx,
    sy,
    anchor,
    axis: $<HTMLSelectElement>("scale-axis").value as ScaleAxis,
  });
});
for (const id of ["raster-sx", "raster-sy"])
  $<HTMLInputElement>(id).oninput = () => {
    if (
      $<HTMLInputElement>("raster-lock").checked &&
      $<HTMLSelectElement>("scale-axis").value === "both"
    )
      $<HTMLInputElement>(
        id === "raster-sx" ? "raster-sy" : "raster-sx",
      ).value = $<HTMLInputElement>(id).value;
  };
$<HTMLInputElement>("raster-lock").onchange = () => {
  if (
    $<HTMLInputElement>("raster-lock").checked &&
    $<HTMLSelectElement>("scale-axis").value === "both"
  )
    $<HTMLInputElement>("raster-sy").value =
      $<HTMLInputElement>("raster-sx").value;
};
$<HTMLSelectElement>("scale-axis").onchange = () => {
  canvasUI.finishViewGesture();
  const axis = $<HTMLSelectElement>("scale-axis").value;
  for (const id of ["raster-sx", "raster-sy"]) {
    const input = $<HTMLInputElement>(id);
    input.value = "100";
    input.disabled =
      axis === "h"
        ? id === "raster-sy"
        : axis === "v"
          ? id === "raster-sx"
          : false;
  }
};
zoom.oninput = () => {
  canvasUI.finishViewGesture();
  scheduleDraw();
};
$<HTMLInputElement>("grid").onchange = () => scheduleDraw();
$<HTMLInputElement>("guides").onchange = () => scheduleDraw();
$<HTMLInputElement>("region-transparent").onchange = () =>
  canvasUI.invalidateSelection();
$<HTMLSelectElement>("view").onchange = () => {
  canvasUI.finishViewGesture();
  scheduleDraw();
};
$<HTMLFormElement>("jump").onsubmit = (event) => {
  event.preventDefault();
  clearError();
  void jump($<HTMLInputElement>("lookup").value).catch(error);
};
for (const id of ["mode", "unreviewed"])
  $(id).onchange = () => {
    finishStroke();
    if (id === "mode") selected = 0;
    rebuildSlots();
    void select(selected).catch(error);
    session();
  };
let searchTimer: ReturnType<typeof setTimeout> | undefined;
$("search").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(filterFonts, 100);
};
for (const id of ["collection", "font-filter"])
  $(id).onchange = () => filterFonts();
$("font-list").onscroll = renderFonts;
new ResizeObserver(renderFonts).observe($("font-list"));
new ResizeObserver(() => {
  scheduleDraw();
  scheduleProof();
}).observe(stage);
$<HTMLTextAreaElement>("notes").oninput = () => {
  if (doc) {
    doc.state.notes = $<HTMLTextAreaElement>("notes").value;
    doc.touch();
    scheduleSave();
  }
};
document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]")) return;
  if (
    choosingGeometry() ||
    $<HTMLDialogElement>("font-guides-dialog").open ||
    candidateChooser.open()
  )
    return;
  const editing =
    event.target instanceof HTMLElement &&
    event.target.matches("input,textarea,select");
  const key = shortcutKey(event);
  const cmd = event.metaKey || event.ctrlKey;
  let run: (() => Promise<void> | void) | undefined;
  if (cmd && key.toLowerCase() === "s") run = () => action("save");
  else if (editing) return;
  else if (cmd && ["c", "x", "v", "a", "d"].includes(key.toLowerCase())) {
    const operations: Record<string, string> = {
      c: "copy",
      x: "cut",
      v: "paste",
      a: "selectAll",
      d: "deselect",
    };
    run = () => action(operations[key.toLowerCase()]);
  } else if (
    !cmd &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)
  ) {
    const direction: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const [dx, dy] = direction[key],
      step = event.shiftKey ? 10 : 1;
    run = document.body.classList.contains("editor-open")
      ? () => canvasUI.nudge(dx * step, dy * step)
      : () => select(gallery.navigate(key));
  } else if (!cmd && (key === "Delete" || key === "Backspace"))
    run = () => action("delete-selection");
  else if (key === "Enter" && canvasUI.pendingSelection())
    run = () => action("apply-selection");
  else if (cmd && key.toLowerCase() === "z")
    run = () => history(event.shiftKey);
  else if (cmd && key === "Enter") run = completeFont;
  else if (key === "]") run = () => move(1);
  else if (key === "[") run = () => move(-1);
  else if (key === "PageDown") run = () => nextFont(1);
  else if (key === "PageUp") run = () => nextFont(-1);
  else if (key === "Enter") run = review;
  else if (key.toLowerCase() === "b")
    run = () => {
      openEditor();
      $("pencil").click();
    };
  else if (key.toLowerCase() === "e")
    run = () => {
      openEditor();
      $("eraser").click();
    };
  else if (!cmd && !event.altKey && key.toLowerCase() === "f")
    run = () => {
      openEditor();
      $("flip").click();
    };
  else if (!cmd && !event.altKey && key.toLowerCase() === "r")
    run = () => {
      openEditor();
      $("rect").click();
    };
  else if (!cmd && !event.altKey && key.toLowerCase() === "l")
    run = () => {
      openEditor();
      $("lasso").click();
    };
  else if (!cmd && !event.altKey && key.toLowerCase() === "m")
    run = () => {
      openEditor();
      $("move").click();
    };
  else if (!cmd && !event.altKey && key.toLowerCase() === "s")
    run = () => {
      openEditor();
      $("scale").click();
    };
  else if (key === "Escape")
    run = () => {
      canvasUI.cancel();
      clearError();
    };
  if (run) {
    event.preventDefault();
    if (!exporting && (!editingBusy || (cmd && key.toLowerCase() === "s")))
      Promise.resolve().then(run).catch(error);
  }
});
document.addEventListener("keyup", (event) => {
  const key = shortcutKey(event);
  if (key.startsWith("Arrow")) canvasUI.finishNudge();
});
window.addEventListener("blur", () => canvasUI.finishNudge());
let workspaceView = "font";
function updateLibrary(invalidate = false) {
  libraryGallery.set(
    visibleFonts,
    groups.get(),
    workspaceView === "library",
    invalidate,
  );
}
function switchWorkspace(view: string) {
  workspaceView = view === "library" ? "library" : "font";
  document.body.classList.toggle("library-mode", workspaceView === "library");
  $("library-browser").hidden = workspaceView !== "library";
  $("view-font").setAttribute("aria-pressed", String(workspaceView === "font"));
  $("view-library").setAttribute(
    "aria-pressed",
    String(workspaceView === "library"),
  );
  $("editor-open").hidden = workspaceView === "library";
  updateLibrary();
  gallery.refresh();
  session();
}
function openEditor() {
  switchWorkspace("font");
  document.body.classList.add("editor-open");
  requestAnimationFrame(() => {
    fitZoom();
    draw();
  });
}
$("editor-open").onclick = openEditor;
$("inspector-toggle").onclick = () => {
  const visible = document.body.classList.toggle("inspector-open");
  $("inspector-toggle").setAttribute("aria-pressed", String(visible));
  requestAnimationFrame(() => {
    fitZoom();
    draw();
  });
};
$("editor-close").onclick = async () => {
  await canvasUI.flushRegions();
  document.body.classList.remove("editor-open");
  gallery.refresh();
};
$("view-font").onclick = () => switchWorkspace("font");
$("view-library").onclick = () => switchWorkspace("library");
function showSelectedGroups() {
  finishStroke();
  $<HTMLSelectElement>("mode").value = "groups";
  selected = 0;
  rebuildSlots("");
  void select(0).catch(error);
  updateLibrary();
  session();
}
const groups = createGroupSelection(showSelectedGroups);
$("view-groups").onclick = showSelectedGroups;
$("view-all-glyphs").onclick = () => {
  finishStroke();
  $<HTMLSelectElement>("mode").value = "all";
  selected = 0;
  rebuildSlots("");
  void select(0).catch(error);
  switchWorkspace("font");
};
const gallery = createGlyphGallery({
  load: glyph,
  select: (position, edit) => {
    void select(position)
      .then(() => {
        if (edit) openEditor();
      })
      .catch(error);
  },
  pin: (value) => {
    comparison.pin(value);
    document.body.classList.add("inspector-open");
    $("inspector-toggle").setAttribute("aria-pressed", "true");
    $<HTMLDetailsElement>("comparison-panel").open = true;
    openEditor();
  },
  error,
});
const libraryGallery = createLibraryGallery({
  load: async (id, sections, signal): Promise<LibraryPreview> => {
    const summary = await native<FontSummary>("summary", { id });
    signal.throwIfAborted();
    const loaded = await NativeFont.open(summary, libraryCache, signal);
    const state =
      id === font?.id
        ? doc?.state
        : await native<Draft | null>("readState", { id });
    const mapping = state
      ? effectiveIndex(loaded.index.unicodeIndex, state)
      : new Map(
          Object.entries(loaded.index.unicodeIndex).map(([char, ids]) => [
            char,
            ids.map((n) => "g" + String(n).padStart(6, "0")),
          ]),
        );
    const samples = await loaded.glyphs(
      frameOrdinals(summary.coverage.glyphCount, loaded.index.unicodeIndex),
    );
    const frame = fixedCell(summary, samples, state?.fontCell);
    const resolve = async (gid: string) =>
      state?.edits[gid] ??
      (Number(gid.slice(1)) < summary.coverage.glyphCount
        ? (await loaded.glyphs([Number(gid.slice(1))]))[0]
        : undefined);
    const result = await Promise.all(
      sections.map(async (section) => {
        const values = await Promise.all(
          section.chars.map(async (c): Promise<Glyph | undefined> => {
            const gid = mapping.get(c)?.[0];
            const value = gid ? await resolve(gid) : undefined;
            return value
              ? {
                  ...normalizeCell(value, frame),
                  character: c,
                  labels: [{ kind: "unicode", value: c }],
                }
              : undefined;
          }),
        );
        return {
          title: section.title,
          characters: section.chars,
          glyphs: values.filter((g): g is Glyph => !!g),
          missing: values.filter((g) => !g).length,
        };
      }),
    );
    signal.throwIfAborted();
    if (
      result.length &&
      ![...mapping.values()].some((ids) => ids.length) &&
      result.every((s) => !s.glyphs.length)
    ) {
      const raw = await loaded.glyphs(
        Array.from(
          { length: Math.min(12, summary.coverage.glyphCount) },
          (_, i) => i,
        ),
      );
      return {
        unmapped: true,
        cell: frame,
        sections: [
          ...result,
          {
            title: "Перші 12 вихідних гліфів · числові коди",
            glyphs: raw.map((g) =>
              normalizeCell(state?.edits[g.id] ?? g, frame),
            ),
            missing: 0,
          },
        ],
      };
    }
    return { sections: result, unmapped: false, cell: frame };
  },
  open: (id) => {
    void openFont(id)
      .then(() => switchWorkspace("font"))
      .catch(error);
  },
});
async function start() {
  busy(true);
  boot = await native<Boot>("bootstrap");
  fonts = boot.fonts.sort((a, b) =>
    a.name.localeCompare(b.name, "uk", { numeric: true }),
  );
  $("font-total").textContent = fonts.length.toLocaleString("uk");
  if (boot.warnings.length) error(boot.warnings.join("\n"));
  const saved = await native<Record<string, string>>("readSession");
  groups.restore(saved);
  for (const [id, key] of [
    ["search", "q"],
    ["collection", "collection"],
    ["font-filter", "filter"],
    ["mode", "mode"],
  ]) {
    if (saved[key]) $<HTMLInputElement>(id).value = saved[key];
  }
  if (saved.workspaceLayout !== "gallery-1")
    $<HTMLSelectElement>("mode").value = "groups";
  filterFonts();
  switchWorkspace(saved.workspaceView ?? "font");
  const id = fonts.some((f) => f.id === saved.fontId)
    ? saved.fontId
    : visibleFonts[0]?.id;
  if (id) await openFont(id, saved.slot);
  progressUpdate();
  document.body.dataset.ready = "true";
  await native("uiReady", {
    fontId: font?.id,
    glyphId: current?.id,
    fonts: fonts.length,
    slots: slots.length,
  });
}
void start().catch(error);
