import { native } from "./bridge";
import { unpack, type Glyph } from "./model";
import {
  candidateGlyph,
  type Candidate,
  type CandidateResult,
} from "./candidates";
export function createCandidateChooser(options: {
  request: () => Promise<Record<string, unknown> | undefined>;
  valid: (result: CandidateResult) => boolean;
  target: () => Glyph | undefined;
  apply: (candidate: Candidate, result: CandidateResult) => Promise<void>;
  backdrop: (glyph: Glyph) => void;
  error: (reason: unknown) => void;
}) {
  const $ = (id: string) => document.getElementById(id)!;
  const dialog = $("candidate-dialog") as HTMLDialogElement;
  const button = $("candidate-generate") as HTMLButtonElement;
  let epoch = 0,
    job: string | undefined,
    result: CandidateResult | undefined;
  const current = () => (result && options.valid(result) ? result : undefined);
  function status(text: string) {
    $("candidate-status").textContent = text;
  }
  function reset() {
    ++epoch;
    const old = job;
    job = undefined;
    result = undefined;
    if (old) void native("candidateCancel", { id: old }).catch(options.error);
    dialog.close();
    button.textContent = "Варіанти гліфа…";
    $("candidate-cancel").hidden = true;
    status("");
  }
  function render() {
    const selected = current(),
      target = options.target();
    if (!selected || !target)
      throw new Error("Гліф змінився. Повторіть генерацію.");
    const list = $("candidate-list");
    list.replaceChildren();
    $("candidate-title").textContent =
      `Варіанти ${selected.character} · ${selected.candidates.length}`;
    $("candidate-info").textContent =
      `${selected.device} · ${selected.seconds.toFixed(2)} s inference · CNN-заготовок відсіяно: ${selected.filteredNeural ?? 0}. Експеримент. Метрики й Unicode зберігаються.`;
    for (const candidate of selected.candidates) {
      const glyph = candidateGlyph(target, candidate),
        card = document.createElement("section");
      card.className = "candidate-card";
      const canvas = document.createElement("canvas"),
        z = Math.max(
          2,
          Math.min(10, Math.floor(160 / Math.max(glyph.width, glyph.height))),
        );
      canvas.width = glyph.width * z;
      canvas.height = glyph.height * z;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "#eee9d7";
      unpack(glyph).forEach((value, i) => {
        if (value)
          c.fillRect(
            (i % glyph.width) * z,
            Math.floor(i / glyph.width) * z,
            z,
            z,
          );
      });
      const title = document.createElement("strong");
      title.textContent =
        candidate.method === "cnn"
          ? "CNN · експеримент"
          : "Пошук схожого шрифту";
      const source = document.createElement("small");
      source.textContent = `${candidate.sourceFontId} · ${candidate.sourceLicenseId}`;
      const actions = document.createElement("div"),
        backdrop = document.createElement("button"),
        apply = document.createElement("button");
      backdrop.textContent = "Підкласти";
      apply.textContent = "Вибрати й редагувати";
      apply.className = "primary";
      backdrop.onclick = () => {
        if (!current()) {
          options.error(new Error("Гліф змінився"));
          return;
        }
        options.backdrop(glyph);
        dialog.close();
      };
      apply.onclick = () => {
        if (!current()) {
          options.error(new Error("Гліф змінився"));
          return;
        }
        void options
          .apply(candidate, selected)
          .then(() => {
            reset();
          })
          .catch(options.error);
      };
      actions.append(backdrop, apply);
      card.append(title, canvas, source, actions);
      list.append(card);
    }
    dialog.showModal();
  }
  async function generate() {
    if (job) return;
    if (current()) {
      render();
      return;
    }
    const token = ++epoch;
    status("Підготовка референсів…");
    try {
      const request = await options.request();
      if (!request || token !== epoch) return;
      const started = await native<{ id: string }>("candidateStart", {
        request,
      });
      if (token !== epoch) {
        await native("candidateCancel", { id: started.id });
        return;
      }
      job = started.id;
      button.textContent = "Генерація…";
      $("candidate-cancel").hidden = false;
      status(
        "Локальна CNN + пошук. Можна малювати; зміни скасують актуальність результату.",
      );
      const deadline = Date.now() + 60000;
      while (token === epoch) {
        if (Date.now() > deadline) throw new Error("Генерація перевищила 60 s");
        const response = await native<{
          status: string;
          result?: CandidateResult;
        }>("candidateStatus", { id: job });
        if (token !== epoch) return;
        if (response.status === "complete") {
          const value = response.result!,
            target = options.target();
          if (!target || !options.valid(value))
            throw new Error(
              "Гліф змінився під час генерації. Повторіть запит.",
            );
          if (
            value.format !== "para-glyph-candidates" ||
            value.schemaVersion !== 1 ||
            !Array.isArray(value.candidates) ||
            value.candidates.length > 8 ||
            !value.candidates.length
          )
            throw new Error("Немає сумісних кандидатів");
          value.candidates.forEach((c) => candidateGlyph(target, c));
          result = value;
          button.textContent = "Переглянути варіанти…";
          status(`Готово: ${value.candidates.length} · ${value.device}`);
          render();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch (reason) {
      if (token === epoch) throw reason;
    } finally {
      if (token === epoch) {
        const old = job;
        job = undefined;
        $("candidate-cancel").hidden = true;
        if (!result) {
          button.textContent = "Варіанти гліфа…";
          if (old) await native("candidateCancel", { id: old });
        }
      }
    }
  }
  button.onclick = () => {
    button.disabled = true;
    void generate()
      .catch((reason) => {
        status("Не вдалося згенерувати");
        options.error(reason);
      })
      .finally(() => {
        button.disabled = false;
      });
  };
  $("candidate-cancel").onclick = reset;
  $("candidate-close").onclick = () => dialog.close();
  $("candidate-again").onclick = () => {
    reset();
    button.click();
  };
  return { reset, open: () => dialog.open };
}
