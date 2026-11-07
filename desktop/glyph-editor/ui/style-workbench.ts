import { candidateLabel } from "./candidates";
import { native } from "./bridge";
import { unpack, type Glyph } from "./model";
import {
  candidateGlyph,
  type Candidate,
  type CandidateResult,
} from "./candidates";
import { styleCharacters, type StyleTarget } from "./style-plan";
import { UKRAINIAN } from "./model";
export interface ReferenceFont {
  id: string;
  name: string;
  sha256: string;
  cell: { width: number; height: number };
  metrics: { baseline: number; advanceX: number; [key: string]: unknown };
  licenseId: string;
  license?: Record<string, unknown>;
  source?: Record<string, unknown>;
}
export interface StyleReference {
  font: ReferenceFont;
  glyphs: Glyph[];
  missing?: string[];
}
export interface StyleBatch {
  fontId: string;
  revision: number;
  results: (CandidateResult | { character: string; error: string })[];
}
export function createStyleWorkbench(options: {
  fonts: () => {
    id: string;
    name: string;
    cell: { width: number; height: number };
  }[];
  load: (id: string, characters: string[]) => Promise<StyleReference>;
  prepare: (
    characters: string[],
    onlyMissing: boolean,
    reference: StyleReference,
    mode: string,
    preferLatin: boolean,
  ) => Promise<
    | {
        request: Record<string, unknown>;
        targets: StyleTarget[];
        skipped: string[];
      }
    | undefined
  >;
  valid: () => boolean;
  apply: (
    choices: { candidate: Candidate; character: string }[],
  ) => Promise<void>;
  before: () => Promise<void>;
  error: (reason: unknown) => void;
}) {
  const $ = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const dialog = $<HTMLDialogElement>("style-dialog");
  let epoch = 0,
    job: string | undefined,
    reference: StyleReference | undefined,
    plan: StyleTarget[] = [],
    batch: StyleBatch | undefined,
    active = "",
    busy = false;
  const checked = new Set<number>(),
    chosen = new Map<string, Candidate>();
  function invalidate() {
    batch = undefined;
    plan = [];
    chosen.clear();
    $("style-results").hidden = true;
    updateApply();
  }
  function fillFonts() {
    if (select.options.length > 1) return;
    for (const font of options.fonts()) {
      const option = new Option(
        `${font.name} · ${font.cell.width}×${font.cell.height}`,
        font.id,
      );
      option.disabled = font.cell.width > 256 || font.cell.height > 256;
      select.append(option);
    }
  }
  const localError = (reason: unknown) => {
    $("style-error").textContent =
      reason instanceof Error ? reason.message : String(reason);
    $("style-error").hidden = false;
  };
  function setBusy(value: boolean) {
    busy = value;
    $<HTMLFieldSetElement>("style-settings").disabled = value;
    $<HTMLButtonElement>("style-run").disabled = value;
    $<HTMLButtonElement>("style-load").disabled = value;
    $("style-stop").hidden = !value;
    updateApply();
  }
  function updateApply() {
    const button = $<HTMLButtonElement>("style-apply");
    button.textContent = `Застосувати вибрані (${chosen.size})`;
    button.disabled = busy || !chosen.size;
  }
  function reset() {
    ++epoch;
    const old = job;
    job = undefined;
    if (old) void native("candidateCancel", { id: old }).catch(() => {});
    dialog.close();
    setBusy(false);
    batch = undefined;
    plan = [];
    chosen.clear();
    $("style-results").hidden = true;
  }
  async function runJob<T>(
    action: string,
    args: Record<string, unknown>,
    token: number,
  ): Promise<T | undefined> {
    const started = await native<{ id: string }>(action, args);
    if (token !== epoch) {
      await native("candidateCancel", { id: started.id });
      return;
    }
    job = started.id;
    const deadline = Date.now() + 120000;
    try {
      while (token === epoch) {
        if (Date.now() > deadline)
          throw new Error("Завдання перевищило 120 s.");
        const result = await native<{ status: string; result: T }>(
          "candidateStatus",
          { id: started.id },
        );
        if (token !== epoch) return;
        if (result.status === "complete") {
          job = undefined;
          return result.result;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      if (job === started.id) {
        job = undefined;
        await native("candidateCancel", { id: started.id }).catch(() => {});
      }
    }
  }
  function thumbnail(g: Glyph, max = 96) {
    const canvas = document.createElement("canvas");
    const z = Math.max(
      1,
      Math.min(6, Math.floor(max / Math.max(g.width, g.height))),
    );
    canvas.width = g.width * z;
    canvas.height = g.height * z;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#eee9d7";
    unpack(g).forEach((v, i) => {
      if (v) c.fillRect((i % g.width) * z, Math.floor(i / g.width) * z, z, z);
    });
    return canvas;
  }
  function renderReferences() {
    const box = $("style-reference-glyphs");
    box.replaceChildren();
    checked.clear();
    reference?.glyphs.forEach((g, i) => {
      checked.add(i);
      const label = document.createElement("label"),
        check = document.createElement("input"),
        name = document.createElement("span");
      label.className = "style-reference-glyph";
      check.type = "checkbox";
      check.checked = true;
      name.textContent =
        g.character ??
        g.labels.find((l) => l.kind === "unicode")?.value ??
        g.id;
      check.onchange = () => {
        if (check.checked) checked.add(i);
        else checked.delete(i);
        invalidate();
      };
      label.append(check, thumbnail(g, 48), name);
      box.append(label);
    });
    $("style-reference-info").textContent = reference
      ? `${reference.font.name} · ${reference.font.cell.width}×${reference.font.cell.height} · ${reference.glyphs.length} гліфів${reference.missing?.length ? " · немає: " + reference.missing.join(" ") : ""}`
      : "";
  }
  async function loadReference() {
    const token = ++epoch;
    setBusy(true);
    reference = undefined;
    invalidate();
    $("style-error").hidden = true;
    $("style-status").textContent = "Читання референсу…";
    try {
      const chars = styleCharacters(
        $<HTMLInputElement>("style-reference-chars").value,
        true,
      );
      let loaded: StyleReference | undefined;
      if ($<HTMLSelectElement>("style-source").value === "file") {
        const file = $<HTMLInputElement>("style-file").files?.[0];
        if (!file) throw new Error("Виберіть файл референсного шрифту/гліфів.");
        if (file.size > 8 * 1024 * 1024)
          throw new Error("Файл має бути до 8 MiB.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        loaded = await runJob<StyleReference>(
          "referenceImport",
          {
            name: file.name,
            data: btoa(binary),
            characters: chars.join(""),
            size: Number($<HTMLInputElement>("style-raster-size").value),
          },
          token,
        );
      } else
        loaded = await options.load(
          $<HTMLSelectElement>("style-font").value,
          chars,
        );
      if (token !== epoch || !loaded) return;
      if (!loaded.glyphs.length || loaded.glyphs.length > 64)
        throw new Error("Потрібні 1–64 маповані гліфи референсу.");
      reference = loaded;
      renderReferences();
      $("style-status").textContent =
        "Референс готовий. Можна зняти зайві гліфи.";
      return true;
    } catch (reason) {
      if (token === epoch) localError(reason);
    } finally {
      if (token === epoch) setBusy(false);
    }
  }
  async function generate() {
    const token = ++epoch;
    setBusy(true);
    $("style-error").hidden = true;
    chosen.clear();
    batch = undefined;
    $("style-results").hidden = true;
    try {
      if (!reference) throw new Error("Спочатку завантажте референс.");
      const glyphs = reference.glyphs.filter((_, i) => checked.has(i));
      if (!glyphs.length)
        throw new Error("Виберіть хоча б один референсний гліф.");
      const prepared = await options.prepare(
        styleCharacters($<HTMLTextAreaElement>("style-characters").value),
        $<HTMLInputElement>("style-missing").checked,
        { ...reference, glyphs },
        $<HTMLSelectElement>("style-method").value,
        $<HTMLInputElement>("style-latin-first").checked,
      );
      if (token !== epoch || !prepared) return;
      if (!prepared.targets.length) {
        $("style-status").textContent =
          `Немає відсутніх гліфів. Пропущено: ${prepared.skipped.join(" ")}. Щоб створити інші варіанти, зніміть «Лише відсутні».`;
        return;
      }
      plan = prepared.targets;
      $("style-status").textContent =
        `Пошук для ${plan.length} літер…${prepared.skipped.length ? " Пропущено наявні: " + prepared.skipped.join(" ") : ""}`;
      const value = await runJob<StyleBatch>(
        "candidateStart",
        { request: prepared.request },
        token,
      );
      if (token !== epoch || !value) return;
      if (!options.valid()) throw new Error("Шрифт змінився. Повторіть пошук.");
      if (value.results.length !== plan.length)
        throw new Error("Неповна відповідь пакета.");
      value.results.forEach((r, i) => {
        if (r.character !== plan[i].character)
          throw new Error("Невірний порядок літер у відповіді.");
        if ("candidates" in r) {
          if (
            r.glyphId !== plan[i].target.id ||
            !Array.isArray(r.candidates) ||
            r.candidates.length > 8
          )
            throw new Error("Несумісний результат.");
          r.candidates.forEach((c) => candidateGlyph(plan[i].target, c));
        }
      });
      batch = value;
      active = plan[0].character;
      $("style-results").hidden = false;
      $("style-status").textContent =
        `Готово: ${plan.length} літер. Виберіть варіанти для застосування.`;
      renderResults();
    } catch (reason) {
      if (token === epoch) localError(reason);
    } finally {
      if (token === epoch) setBusy(false);
    }
  }
  function renderResults() {
    const nav = $("style-targets");
    nav.replaceChildren();
    batch?.results.forEach((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = r.character + (chosen.has(r.character) ? " ✓" : "");
      b.setAttribute("aria-pressed", String(active === r.character));
      b.onclick = () => {
        active = r.character;
        renderResults();
      };
      nav.append(b);
    });
    const box = $("style-candidates");
    box.replaceChildren();
    const r = batch?.results.find((r) => r.character === active),
      target = plan.find((t) => t.character === active);
    if (!r || !target) return;
    const title = document.createElement("h3");
    title.textContent = `${active} · ${target.source ? "замінить наявний гліф" : "додасть гліф"}`;
    box.append(title);
    if ("error" in r) {
      const p = document.createElement("p");
      p.textContent = r.error;
      box.append(p);
      return;
    }
    const clear = document.createElement("button");
    clear.textContent = "Пропустити цю літеру";
    clear.onclick = () => {
      chosen.delete(active);
      renderResults();
      updateApply();
    };
    box.append(clear);
    const grid = document.createElement("div");
    grid.className = "style-candidate-grid";
    r.candidates.forEach((candidate) => {
      const button = document.createElement("button");
      button.className = "style-candidate";
      button.setAttribute(
        "aria-pressed",
        String(chosen.get(active)?.id === candidate.id),
      );
      const label = document.createElement("strong"),
        source = document.createElement("small");
      label.textContent = candidateLabel(candidate);
      source.textContent =
        candidate.sourceFontId + " · " + candidate.sourceLicenseId;
      button.append(
        thumbnail(candidateGlyph(target.target, candidate), 110),
        label,
        source,
      );
      button.onclick = () => {
        chosen.set(active, candidate);
        renderResults();
        updateApply();
      };
      grid.append(button);
    });
    box.append(grid);
    updateApply();
  }
  $("style-open").onclick = () => {
    void options
      .before()
      .then(() => {
        fillFonts();
        $("style-title").textContent = "Референс → потрібні літери";
        $<HTMLDetailsElement>("style-setup").open = true;
        if (!dialog.open) dialog.showModal();
        $("style-error").hidden = true;
      })
      .catch(options.error);
  };
  const select = $<HTMLSelectElement>("style-font");
  select.append(new Option("Поточний шрифт", ""));
  for (const font of options.fonts()) {
    const option = new Option(
      `${font.name} · ${font.cell.width}×${font.cell.height}`,
      font.id,
    );
    option.disabled = font.cell.width > 256 || font.cell.height > 256;
    select.append(option);
  }
  $("style-load").onclick = () => void loadReference();
  $("style-run").onclick = () => void generate();
  $("style-close").onclick = reset;
  dialog.oncancel = () => reset();
  $("style-stop").onclick = () => {
    reset();
    dialog.showModal();
    $("style-status").textContent = "Завдання скасовано.";
  };
  for (const id of [
    "style-source",
    "style-font",
    "style-reference-chars",
    "style-file",
    "style-raster-size",
  ])
    $(id).onchange = () => {
      reference = undefined;
      invalidate();
      $("style-reference-glyphs").replaceChildren();
      $("style-reference-info").textContent = "Завантажте оновлений референс.";
    };
  $("style-source").onchange = () => {
    reference = undefined;
    invalidate();
    $("style-file-controls").hidden =
      $<HTMLSelectElement>("style-source").value !== "file";
    $("style-font-controls").hidden =
      $<HTMLSelectElement>("style-source").value === "file";
    $("style-reference-glyphs").replaceChildren();
  };
  for (const id of [
    "style-characters",
    "style-missing",
    "style-method",
    "style-latin-first",
  ])
    $(id).oninput = invalidate;
  $("style-first").onclick = () => {
    batch?.results.forEach((r) => {
      if ("candidates" in r && r.candidates[0])
        chosen.set(r.character, r.candidates[0]);
    });
    renderResults();
    updateApply();
  };
  $("style-clear").onclick = () => {
    chosen.clear();
    renderResults();
    updateApply();
  };
  $("style-apply").onclick = () => {
    if (!options.valid()) {
      localError(new Error("Шрифт змінився. Повторіть пошук."));
      return;
    }
    setBusy(true);
    void options
      .apply(
        [...chosen].map(([character, candidate]) => ({ character, candidate })),
      )
      .then(reset)
      .catch(localError)
      .finally(() => setBusy(false));
  };
  async function openLatin() {
    try {
      await options.before();
      fillFonts();
      invalidate();
      $("style-title").textContent = "Українська з наявної латинки";
      $<HTMLSelectElement>("style-source").value = "catalog";
      $<HTMLSelectElement>("style-font").value = "";
      $("style-file-controls").hidden = true;
      $("style-font-controls").hidden = false;
      $<HTMLInputElement>("style-reference-chars").value =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
      $<HTMLTextAreaElement>("style-characters").value = UKRAINIAN.join("");
      $<HTMLInputElement>("style-missing").checked = true;
      $<HTMLInputElement>("style-latin-first").checked = true;
      $<HTMLSelectElement>("style-method").value = "retrieval";
      $("style-error").hidden = true;
      if (!dialog.open) dialog.showModal();
      if ((await loadReference()) && dialog.open) {
        $<HTMLDetailsElement>("style-setup").open = false;
        await generate();
        if (batch) {
          $("style-first").click();
          $("style-results").scrollIntoView({ block: "start" });
        } else if (
          document.body.dataset.demo === "true" &&
          $("style-error").hidden
        ) {
          dialog.close();
        }
      }
    } catch (reason) {
      localError(reason);
    }
  }
  return { reset, openLatin, open: () => dialog.open };
}
