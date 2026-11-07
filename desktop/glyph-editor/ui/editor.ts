import {
  REGIONS,
  canonicalSlots,
  regionFor,
  characterLabel,
  mappedCharacter,
  glyphCaption,
  type GlyphSlot as Slot,
} from "./regions";
import {
  createRasterMutation,
  mutatedRaster,
  type Anchor,
} from "./raster-mutation";
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
  UKRAINIAN,
  codepoint,
  newDraft,
  blankGlyph,
  resized,
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
>;
type Progress = { edits: number; reviewed: number; done: boolean };
type Boot = {
  snapshot: string;
  fonts: Light[];
  counts: { glyphs: number };
  progress: Record<string, Progress>;
  projectPath: string;
  warnings: string[];
};
const cache = new FontAssetCache(8 * 1024 * 1024, async (input, init) => {
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
});
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
let current: Glyph | undefined, original: Glyph | undefined;
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
    "undo",
    "redo",
  ])
    $<HTMLButtonElement>(id).disabled = value;
}
function progressUpdate() {
  if (!doc || !font) return;
  boot.progress[font.id] = {
    edits: Object.keys(doc.state.edits).length,
    reviewed: doc.state.reviewed.length,
    done: doc.state.done,
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
    revision = state.revision;
  dirty = false;
  const task = saving
    .catch(() => {})
    .then(async () => {
      await native("saveState", { id, state });
      if (doc?.state.fontId === id && doc.state.revision === revision) {
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
      }).catch(error),
    350,
  );
}
async function flush() {
  finishStroke();
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
        (filter === "ua" && !f.coverage.ukrainian.complete) ||
        (filter === "changed" && (p?.edits ?? 0) > 0) ||
        (filter === "done" && p?.done))
    );
  });
  $("library-count").textContent =
    `У черзі: ${visibleFonts.length.toLocaleString("uk")}`;
  $("font-list-inner").style.height = visibleFonts.length * 52 + "px";
  renderFonts();
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
    meta.textContent = `${f.cell.width}×${f.cell.height} · UA ${f.coverage.ukrainian.present ?? "?"}/66${p?.done ? " · ✓" : ""}${p?.edits ? " · правок: " + p.edits : ""}`;
    if (p?.edits) meta.className = "edited";
    button.append(name, meta);
    button.onclick = () => void openFont(f.id).catch(error);
    inner.append(button);
  }
}
async function openFont(id: string, resume?: string) {
  if (font?.id === id && face) return;
  await flush();
  clearError();
  $("autofill-status").textContent = "";
  const revision = ++fontRevision;
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
    dirty = false;
    $("font-name").textContent = font.name;
    $("font-source").textContent = `${font.collection} · ${font.licenseId}`;
    $("font-meta").textContent =
      `${font.cell.width}×${font.cell.height} · ${font.coverage.glyphCount.toLocaleString("uk")} вихідних гліфів · українська ${font.coverage.ukrainian.present ?? "?"}/66`;
    $<HTMLTextAreaElement>("notes").value = doc.state.notes ?? "";
    selected = 0;
    slots = [];
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
function rebuildSlots(preferred = slots[selected]?.key) {
  if (!face || !doc || !font) {
    slots = [];
    return;
  }
  index = effectiveIndex(face.index.unicodeIndex, doc.state);
  const mode = $<HTMLSelectElement>("mode").value;
  const ids = [
    ...Array.from(
      { length: font.coverage.glyphCount },
      (_, i) => "g" + String(i).padStart(6, "0"),
    ),
    ...doc.state.created,
  ];
  const mapped = new Set([...index.values()].flat());
  slots =
    canonicalSlots(mode, index) ??
    (mode === "changed"
      ? Object.keys(doc.state.edits)
      : mode === "unmapped"
        ? ids.filter((id) => !mapped.has(id))
        : ids
    ).map((id) => ({ key: id, id }));
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-region]",
  ))
    button.setAttribute("aria-pressed", String(button.dataset.region === mode));
  if ($<HTMLInputElement>("unreviewed").checked)
    slots = slots.filter((s) => !doc!.state.reviewed.includes(s.key));
  const found = slots.findIndex((s) => s.key === preferred);
  selected =
    found >= 0 ? found : Math.max(0, Math.min(selected, slots.length - 1));
}
async function glyph(id: string): Promise<Glyph | undefined> {
  if (!doc || !face || !font) return;
  const edited = doc.state.edits[id];
  if (edited) return edited;
  const n = Number(id.slice(1));
  return n < font.coverage.glyphCount ? (await face.glyphs([n]))[0] : undefined;
}
async function select(position: number, fit = false) {
  finishStroke();
  const token = ++selectionRevision;
  if (!font || !face || !doc) return;
  selected = Math.max(0, Math.min(position, slots.length - 1));
  const slot = slots[selected];
  busy(true);
  current = undefined;
  original = undefined;
  draw();
  if (!slot) {
    $("glyph-title").textContent =
      "Чергу завершено або немає відповідних гліфів";
    await renderQueue();
    return;
  }
  const id = slot.id ?? doc.nextID(font.coverage.glyphCount);
  const loaded = slot.id ? await glyph(id) : blankGlyph(font, id, slot.char!);
  const source =
    Number(id.slice(1)) < font.coverage.glyphCount
      ? (await face.glyphs([Number(id.slice(1))]))[0]
      : undefined;
  if (token !== selectionRevision) return;
  current = loaded;
  original = source;
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
  const changed = Object.values(doc.state.edits),
    summary = {
      ...target,
      cell: {
        ...target.cell,
        width: Math.max(target.cell.width, ...changed.map((g) => g.width)),
        height: Math.max(target.cell.height, ...changed.map((g) => g.height)),
      },
    };
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
  let present = 0;
  const glyphs = await Promise.all(
    UKRAINIAN.map(async (char) => {
      const id = effective.get(char)?.[0];
      return id ? glyph(id) : undefined;
    }),
  );
  for (const value of glyphs)
    if (value?.rows.some((row) => /[1-9A-Fa-f]/.test(row))) present++;
  if (token !== coverageRevision || font?.id !== id) return;
  const mapped = [...effective.values()].some((ids) => ids.length);
  $("font-meta").textContent =
    `${font.cell.width}×${font.cell.height} · ${font.coverage.glyphCount.toLocaleString("uk")} вихідних гліфів · українська: джерело ${font.coverage.ukrainian.present ?? "?"}/66 → правка ${mapped ? present : "?"}/66`;
  scheduleProof();
}
function inspect() {
  if (!current || !doc) return;
  const slot = slots[selected];
  $("character").textContent = glyphCaption(slot?.char, current);
  $("glyph-meta").textContent =
    `${current.id} · ${original ? "джерельний" : "новий"} · ${current.width}×${current.height}${current.sourceCode?.value ? " · код " + String(current.sourceCode.value) : ""}`;
  $("glyph-title").textContent =
    `${glyphCaption(slot?.char, current)} · ${current.id} · ${current.width}×${current.height} · ${doc.state.reviewed.includes(slot?.key) ? "переглянуто" : "не переглянуто"}`;
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
  $<HTMLButtonElement>("undo").disabled = !doc?.canUndo;
  $<HTMLButtonElement>("redo").disabled = !doc?.canRedo;
  $<HTMLButtonElement>("previous").disabled = !slots.length || selected === 0;
  $<HTMLButtonElement>("next").disabled =
    !slots.length || selected >= slots.length - 1;
}
const canvasUI = createCanvas({
  get: () => ({
    glyph: current,
    original,
    editable: !editingBusy && !exporting,
  }),
  commit: (after) => commit(after),
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
function commit(after: Glyph | undefined) {
  if (!current || !doc) return;
  const id = current.id;
  if (!doc.commit(id, after, original)) return;
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
  void renderQueue().catch(error);
}
function queuePageSize() {
  return REGIONS.some(
    (region) => region.id === $<HTMLSelectElement>("mode").value,
  )
    ? 128
    : 64;
}
async function renderQueue() {
  if (!doc) return;
  const size = queuePageSize();
  const token = ++queueRevision,
    start = Math.floor(selected / size) * size,
    shown = slots.slice(start, start + size),
    container = $("glyphs");
  container.replaceChildren();
  const values = await Promise.all(
    shown.map((s) => (s.id ? glyph(s.id) : Promise.resolve(undefined))),
  );
  if (token !== queueRevision) return;
  const fragment = document.createDocumentFragment();
  for (const [i, s] of shown.entries()) {
    const value = values[i],
      button = document.createElement("button");
    if (s.section && (i === 0 || s.section !== shown[i - 1].section)) {
      const heading = document.createElement("h3");
      heading.className = "glyph-section";
      heading.textContent = s.section;
      fragment.append(heading);
    }
    button.className =
      "glyph" +
      (!value ? " missing" : "") +
      (s.id && doc.state.edits[s.id] ? " changed" : "") +
      (doc.state.reviewed.includes(s.key) ? " reviewed" : "");
    button.setAttribute("aria-pressed", String(start + i === selected));
    const char = s.char ?? mappedCharacter(value);
    const caption = glyphCaption(s.char, value);
    button.setAttribute("aria-label", (!value ? "Відсутній · " : "") + caption);
    button.title =
      caption +
      " · " +
      (char ? codepoint(char) + " · " : "") +
      (value?.id ?? "відсутній");
    if (value) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, value.width);
      c.height = Math.max(1, value.height);
      painter.paint(c.getContext("2d")!, value, 0, 0, 1, INK);
      button.append(c);
    } else {
      const text = document.createElement("strong");
      text.textContent =
        s.char === " " || s.char === "\u00a0" ? "␠" : (s.char ?? "+");
      button.append(text);
    }
    const label = document.createElement("span");
    label.textContent = caption;
    button.append(label);
    button.onclick = () => void select(start + i).catch(error);
    fragment.append(button);
  }
  container.append(fragment);
  const active = container.querySelector<HTMLButtonElement>(
    '[aria-pressed="true"]',
  );
  if (active) {
    const a = active.getBoundingClientRect(),
      box = container.getBoundingClientRect();
    if (a.top < box.top) container.scrollTop += a.top - box.top;
    else if (a.bottom > box.bottom)
      container.scrollTop += a.bottom - box.bottom;
  }
  $("queue-count").textContent = slots.length
    ? `${start + 1}–${start + shown.length} із ${slots.length.toLocaleString("uk")} · пунктир = відсутній · зелена риска = правка`
    : "Немає гліфів у цій черзі";
  $<HTMLButtonElement>("page-prev").disabled = start === 0;
  $<HTMLButtonElement>("page-next").disabled = start + size >= slots.length;
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
  if (!doc) return;
  finishStroke();
  doc.state.done = true;
  doc.touch();
  scheduleSave();
  await flush();
  await nextFont(1);
  filterFonts();
}
async function history(redo = false) {
  finishStroke();
  if (!doc) return;
  const id = redo ? doc.redo() : doc.undo();
  if (!id) return;
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
      async (id) =>
        targetDoc.state.edits[id] ??
        (Number(id.slice(1)) < count
          ? (await targetFace.glyphs([Number(id.slice(1))]))[0]
          : undefined),
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
    const edits = materialize(accepted, targetDoc.state, count);
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
  const assigned = index.get(char)?.[0];
  if (assigned && assigned !== current.id)
    throw new Error(`Цей символ уже має гліф ${assigned}. Перейдіть до нього.`);
  if (create) {
    if (assigned) {
      await jump(char);
      return;
    }
    const added = blankGlyph(font, doc.nextID(font.coverage.glyphCount), char);
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
  if (!state || !Object.keys(state.edits).length)
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
  if (choosingGeometry() && value !== "save") return;
  switch (value) {
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
      fitZoom();
      draw();
      break;
  }
}
window.glyphEditorAction = async (value) => {
  try {
    const active = document.activeElement;
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
on("copy", copy);
on("autofill", () => autofill("homograph"));
on("geometry", () => autofill("geometry"));
on("map", () => mapping());
on("new", () => mapping(true));
on("restore", () => {
  commit(original ? structuredClone(original) : undefined);
  rebuildSlots();
  void select(selected).catch(error);
});
on("resize", () => {
  if (current)
    commit(
      resized(
        current,
        Number($<HTMLInputElement>("width").value),
        Number($<HTMLInputElement>("height").value),
      ),
    );
});
on("advance-apply", () => {
  if (!current) return;
  const advance = Number($<HTMLInputElement>("advance").value);
  if (!Number.isFinite(advance) || advance < 0 || advance > 4096)
    throw new Error("Крок: 0–4096");
  commit({
    ...structuredClone(current),
    advanceX: advance,
    metrics: {
      ...current.metrics,
      rightBearing: advance - current.metrics.leftBearing - current.width,
    },
  });
});
on("placement-apply", () => {
  if (!current) return;
  const leftBearing = Number($<HTMLInputElement>("bearing").value);
  const shiftUp = Number($<HTMLInputElement>("shift-up").value);
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
      if (current) commit(transformed(current, button.dataset.transform!));
    } catch (reason) {
      error(reason);
    }
  };
for (const t of ["pencil", "eraser", "move", "scale"])
  on(t, () => {
    canvasUI.setTool(t);
    for (const id of ["pencil", "eraser", "move", "scale"])
      $(id).classList.toggle("selected", id === t);
  });
on("raster-apply", () => {
  finishStroke();
  if (!current) return;
  const b = createRasterMutation(current).bounds;
  if (!b) throw new Error("Порожній растр — немає що трансформувати");
  const sx = Number($<HTMLInputElement>("raster-sx").value),
    sy = Number($<HTMLInputElement>("raster-sy").value);
  if (![sx, sy].every((n) => Number.isFinite(n) && n >= 12.5 && n <= 800))
    throw new Error("Масштаб растра: 12,5–800 %");
  commit(
    mutatedRaster(current, {
      dx: Number($<HTMLInputElement>("raster-dx").value),
      dy: Number($<HTMLInputElement>("raster-dy").value),
      width: Math.max(1, Math.round((b.width * sx) / 100)),
      height: Math.max(1, Math.round((b.height * sy) / 100)),
      anchor: $<HTMLSelectElement>("raster-anchor").value as Anchor,
    }),
  );
});
for (const id of ["raster-sx", "raster-sy"])
  $<HTMLInputElement>(id).oninput = () => {
    if ($<HTMLInputElement>("raster-lock").checked)
      $<HTMLInputElement>(
        id === "raster-sx" ? "raster-sy" : "raster-sx",
      ).value = $<HTMLInputElement>(id).value;
  };
$<HTMLInputElement>("raster-lock").onchange = () => {
  if ($<HTMLInputElement>("raster-lock").checked)
    $<HTMLInputElement>("raster-sy").value =
      $<HTMLInputElement>("raster-sx").value;
};
zoom.oninput = () => {
  finishStroke();
  scheduleDraw();
};
$<HTMLInputElement>("grid").onchange = () => scheduleDraw();
$<HTMLSelectElement>("view").onchange = () => {
  finishStroke();
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
on("page-prev", () => {
  const size = queuePageSize();
  return select(Math.max(0, Math.floor(selected / size) * size - size));
});
on("page-next", () => {
  const size = queuePageSize();
  return select(
    Math.min(slots.length - 1, Math.floor(selected / size) * size + size),
  );
});
document.addEventListener("keydown", (event) => {
  if (choosingGeometry()) return;
  const editing =
    event.target instanceof HTMLElement &&
    event.target.matches("input,textarea,select");
  const cmd = event.metaKey || event.ctrlKey;
  let run: (() => Promise<void> | void) | undefined;
  if (cmd && event.key.toLowerCase() === "s") run = () => action("save");
  else if (editing) return;
  else if (cmd && event.key.toLowerCase() === "z")
    run = () => history(event.shiftKey);
  else if (cmd && event.key === "Enter") run = completeFont;
  else if (event.key === "]" || event.key === "ArrowRight") run = () => move(1);
  else if (event.key === "[" || event.key === "ArrowLeft") run = () => move(-1);
  else if (event.key === "PageDown") run = () => nextFont(1);
  else if (event.key === "PageUp") run = () => nextFont(-1);
  else if (event.key === "Enter") run = review;
  else if (event.key.toLowerCase() === "b")
    run = () => {
      $("pencil").click();
    };
  else if (event.key.toLowerCase() === "e")
    run = () => {
      $("eraser").click();
    };
  else if (!cmd && !event.altKey && event.key.toLowerCase() === "m")
    run = () => {
      $("move").click();
    };
  else if (!cmd && !event.altKey && event.key.toLowerCase() === "s")
    run = () => {
      $("scale").click();
    };
  else if (event.key === "Escape")
    run = () => {
      canvasUI.cancel();
      clearError();
    };
  if (run) {
    event.preventDefault();
    if (
      !exporting &&
      (!editingBusy || (cmd && event.key.toLowerCase() === "s"))
    )
      Promise.resolve().then(run).catch(error);
  }
});
function buildRegionNavigation() {
  const nav = $("glyph-regions");
  for (const region of [{ id: "canonical", title: "Усі групи" }, ...REGIONS]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.region = region.id;
    button.textContent = region.title;
    button.setAttribute("aria-pressed", "false");
    button.onclick = () => {
      if (exporting || choosingGeometry()) return;
      finishStroke();
      $<HTMLSelectElement>("mode").value = region.id;
      selected = 0;
      rebuildSlots("");
      void select(0).catch(error);
      session();
    };
    nav.append(button);
  }
}
buildRegionNavigation();
async function start() {
  busy(true);
  boot = await native<Boot>("bootstrap");
  fonts = boot.fonts.sort((a, b) =>
    a.name.localeCompare(b.name, "uk", { numeric: true }),
  );
  $("font-total").textContent = fonts.length.toLocaleString("uk");
  if (boot.warnings.length) error(boot.warnings.join("\n"));
  const saved = await native<Record<string, string>>("readSession");
  for (const [id, key] of [
    ["search", "q"],
    ["collection", "collection"],
    ["font-filter", "filter"],
    ["mode", "mode"],
  ]) {
    if (saved[key]) $<HTMLInputElement>(id).value = saved[key];
  }
  filterFonts();
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
