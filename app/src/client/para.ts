/** Public corpus browser: selection, data loading and painting have separate lifetimes. */
import type { FontSummary, Glyph } from "../para/types";
import { FontAssetCache, NativeFont } from "./font-data";
import { GlyphPainter, paintSpecimen } from "./font-painter";
import { GlyphViewer } from "./glyph-viewer";
const field = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
if (document.querySelector("[data-font-corpus]")) void start();
async function start() {
  const form = field<HTMLFormElement>("font-filter"),
    select = field<HTMLSelectElement>("font-select");
  const controls = {
    q: field<HTMLInputElement>("font-search"),
    collection: field<HTMLSelectElement>("font-collection"),
    ukrainian: field<HTMLSelectElement>("font-coverage"),
    license: field<HTMLSelectElement>("font-license"),
    spacing: field<HTMLSelectElement>("font-spacing"),
    width: field<HTMLSelectElement>("font-width"),
    height: field<HTMLSelectElement>("font-height"),
    sort: field<HTMLSelectElement>("font-sort"),
  };
  const pageSize = field<HTMLSelectElement>("font-page-size"),
    count = field<HTMLElement>("font-count");
  const previous = field<HTMLButtonElement>("font-prev"),
    next = field<HTMLButtonElement>("font-next"),
    first = field<HTMLButtonElement>("font-first"),
    last = field<HTMLButtonElement>("font-last");
  const text = field<HTMLTextAreaElement>("font-text"),
    scale = field<HTMLInputElement>("font-scale"),
    canvas = field<HTMLCanvasElement>("font-canvas"),
    stage = field<HTMLElement>("font-preview-stage"),
    status = field<HTMLElement>("font-status");
  const cache = new FontAssetCache(),
    painter = new GlyphPainter();
  const ink = () => getComputedStyle(document.body).color;
  const viewer = new GlyphViewer(painter, ink);
  let offset = 0,
    total = 0,
    page: FontSummary[] = [],
    current: FontSummary | undefined,
    native: NativeFont | undefined;
  let listController: AbortController | undefined,
    fontController: AbortController | undefined;
  let byChar = new Map<string, Glyph>(),
    missing: string[] = [],
    textVersion = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined,
    textTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0,
    repaintGrid = false;
  const presets: Record<string, string> = {
    ukrainian: "Ґава, їжак і єнот. Україна — 123 ₴.",
    latin: "The quick brown fox jumps over the lazy dog. ABC abc 123.",
    numbers: "0123456789 +−×÷ =<> % @#$ ₴ € &!? ()[]{}",
  };
  function readURL() {
    const params = new URL(location.href).searchParams;
    for (const [key, control] of Object.entries(controls)) {
      const fallback = key === "sort" ? "ukrainian" : "",
        value = params.get(key) ?? fallback;
      control.value =
        control instanceof HTMLSelectElement &&
        ![...control.options].some((option) => option.value === value)
          ? fallback
          : value.slice(0, 200);
    }
    pageSize.value = ["25", "50", "100"].includes(params.get("limit") ?? "")
      ? params.get("limit")!
      : "50";
    const value = Number(params.get("offset") ?? 0);
    offset =
      Number.isSafeInteger(value) && value >= 0 && value <= 100000 ? value : 0;
    return params.get("font") ?? undefined;
  }
  function updateURL() {
    const url = new URL(location.href);
    for (const [key, control] of Object.entries(controls)) {
      if (control.value && !(key === "sort" && control.value === "ukrainian"))
        url.searchParams.set(key, control.value);
      else url.searchParams.delete(key);
    }
    for (const [key, value] of [
      ["offset", offset ? String(offset) : ""],
      ["limit", pageSize.value !== "50" ? pageSize.value : ""],
      ["font", current?.id ?? ""],
    ] as const)
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    history.replaceState(null, "", url);
    field<HTMLAnchorElement>("font-share").href = url.href;
    const active = Object.entries(controls).filter(
      ([key, control]) => key !== "sort" && control.value,
    ).length;
    field<HTMLElement>("font-active-filters").textContent = active
      ? `Активних фільтрів: ${active}`
      : "Увесь каталог";
  }
  function paint() {
    frame = 0;
    const font = current;
    if (font && native && font.coverage.unicodeGlyphCount) {
      const result = paintSpecimen(
        canvas,
        font,
        byChar,
        text.value,
        Number(scale.value),
        Math.max(100, stage.clientWidth),
        ink(),
        painter,
      );
      field<HTMLOutputElement>("font-scale-value").value = `${result.zoom}×`;
      status.textContent = missing.length
        ? `Немає відповідників: ${missing.join(" ")}. Позначено рамками.`
        : "Точні вихідні пікселі. Без згладжування.";
      if (result.shown < result.total)
        status.textContent += ` Показано ${result.shown} із ${result.total} символів; зменште масштаб.`;
    }
    if (repaintGrid) {
      viewer.redraw();
      repaintGrid = false;
    }
  }
  function schedulePaint(grid = false) {
    repaintGrid ||= grid;
    if (!frame) frame = requestAnimationFrame(paint);
  }
  async function updateText() {
    const font = native,
      version = ++textVersion;
    if (!font) return;
    if (!font.summary.coverage.unicodeGlyphCount) {
      stage.hidden = true;
      status.textContent =
        "Цей шрифт не має Unicode-мапи. Усі його вихідні знаки доступні в сітці нижче.";
      return;
    }
    stage.hidden = false;
    try {
      const result = await font.text(text.value.slice(0, 160));
      if (native !== font || version !== textVersion) return;
      byChar = result.byChar;
      missing = result.missing;
      schedulePaint();
    } catch (error) {
      if (native === font && !fontController?.signal.aborted)
        status.textContent =
          "Не вдалося завантажити зразок. Повторіть вибір шрифту.";
    }
  }
  async function choose(font?: FontSummary) {
    if (font?.id === current?.id && native) {
      updateURL();
      return;
    }
    fontController?.abort();
    fontController = new AbortController();
    const signal = fontController.signal;
    current = font;
    native = undefined;
    textVersion++;
    byChar = new Map();
    missing = [];
    canvas.width = canvas.height = 1;
    void viewer.setFont();
    field<HTMLElement>("font-name").textContent =
      font?.name ?? "Виберіть шрифт";
    field<HTMLElement>("font-details").textContent = "";
    field<HTMLElement>("font-missing").textContent = "";
    const download = field<HTMLAnchorElement>("font-download");
    if (!font) {
      download.removeAttribute("href");
      status.textContent = "Спробуйте інші фільтри.";
      updateURL();
      return;
    }
    select.value = font.id;
    updateURL();
    download.href = `/para/api/v2/fonts/${encodeURIComponent(font.id)}?download=1`;
    const ua = font.coverage.ukrainian;
    field<HTMLElement>("font-details").textContent =
      `${font.cell.width}×${font.cell.height} px · ${font.cell.monospace ? "моноширинний" : "пропорційний"} · ${font.coverage.glyphCount.toLocaleString("uk")} гліфів · ${font.collection} · ${font.licenseId} (${font.licenseStatus === "verified" ? "умови підтверджено" : "умови не підтверджено"})`;
    field<HTMLElement>("font-missing").textContent =
      ua.present === null
        ? "Українське покриття невідоме: немає Unicode-мапи."
        : ua.complete
          ? "Українська абетка: усі 66 літер."
          : `Українська абетка: ${ua.present}/66. Відсутні: ${(ua.missing ?? []).join(" ")}`;
    status.textContent = "Завантаження зразка…";
    try {
      const loaded = await NativeFont.open(font, cache, signal);
      if (signal.aborted) return;
      native = loaded;
      await Promise.all([updateText(), viewer.setFont(loaded)]);
    } catch (error) {
      if (!signal.aborted)
        status.textContent = "Не вдалося завантажити шрифт. Повторіть вибір.";
    }
  }
  async function getPage(params: URLSearchParams, signal: AbortSignal) {
    const response = await fetch("/para/api/v2/fonts?" + params, { signal });
    if (!response.ok) throw new Error("Каталог недоступний");
    return response.json() as Promise<{ nodes: FontSummary[]; total: number }>;
  }
  async function list(requested?: string) {
    clearTimeout(searchTimer);
    listController?.abort();
    listController = new AbortController();
    const signal = listController.signal;
    select.disabled =
      previous.disabled =
      next.disabled =
      first.disabled =
      last.disabled =
        true;
    count.textContent = "Пошук…";
    form.setAttribute("aria-busy", "true");
    const params = new URLSearchParams({
      limit: pageSize.value,
      offset: String(offset),
    });
    for (const [key, control] of Object.entries(controls))
      if (control.value.trim()) params.set(key, control.value.trim());
    try {
      let result = await getPage(params, signal);
      if (signal.aborted) return;
      if (result.total && offset >= result.total) {
        offset =
          Math.floor((result.total - 1) / Number(pageSize.value)) *
          Number(pageSize.value);
        params.set("offset", String(offset));
        result = await getPage(params, signal);
      }
      if (signal.aborted) return;
      page = result.nodes;
      total = result.total;
      if (!total) offset = 0;
      let chosen =
        page.find((f) => f.id === (requested ?? current?.id)) ?? page[0];
      let pinned: FontSummary | undefined;
      if (
        requested &&
        !page.some((f) => f.id === requested) &&
        /^[a-z0-9][a-z0-9._-]{0,159}$/.test(requested)
      ) {
        const lookup = await getPage(
          new URLSearchParams({ q: requested, limit: "100" }),
          signal,
        );
        if (signal.aborted) return;
        pinned = lookup.nodes.find((f) => f.id === requested);
        if (pinned) chosen = pinned;
      }
      select.replaceChildren();
      if (pinned) {
        const group = document.createElement("optgroup");
        group.label = "Шрифт із посилання";
        group.append(new Option(pinned.name, pinned.id));
        select.append(group);
        page = [pinned, ...page];
      }
      for (const font of result.nodes)
        select.append(
          new Option(
            `${font.name} · ${font.cell.width}×${font.cell.height} · UA ${font.coverage.ukrainian.present ?? "?"}/66`,
            font.id,
          ),
        );
      select.disabled = !chosen;
      previous.disabled = first.disabled = offset === 0;
      next.disabled = last.disabled = offset + Number(pageSize.value) >= total;
      count.textContent = total
        ? `${offset + 1}–${offset + result.nodes.length} із ${total.toLocaleString("uk")} шрифтів`
        : "Нічого не знайдено. Скиньте один або кілька фільтрів.";
      await choose(chosen);
    } catch (error) {
      if (!signal.aborted) {
        count.textContent = "Не вдалося завантажити каталог. Повторіть пошук.";
        select.disabled = !page.length;
      }
    } finally {
      if (!signal.aborted) form.removeAttribute("aria-busy");
    }
  }
  const apply = () => {
    offset = 0;
    void list();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    apply();
  };
  for (const [key, control] of Object.entries(controls))
    if (key !== "q") control.onchange = apply;
  controls.q.oninput = (event) => {
    if ((event as InputEvent).isComposing) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(apply, 180);
  };
  field<HTMLButtonElement>("font-reset").onclick = () => {
    form.reset();
    apply();
  };
  pageSize.onchange = apply;
  select.onchange = () => void choose(page.find((f) => f.id === select.value));
  previous.onclick = () => {
    offset = Math.max(0, offset - Number(pageSize.value));
    void list();
  };
  next.onclick = () => {
    offset += Number(pageSize.value);
    void list();
  };
  first.onclick = () => {
    offset = 0;
    void list();
  };
  last.onclick = () => {
    offset = Math.max(
      0,
      Math.floor((total - 1) / Number(pageSize.value)) * Number(pageSize.value),
    );
    void list();
  };
  text.oninput = () => {
    clearTimeout(textTimer);
    textTimer = setTimeout(() => void updateText(), 100);
  };
  scale.oninput = () => schedulePaint();
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-specimen]",
  ))
    button.onclick = () => {
      text.value = presets[button.dataset.specimen!];
      clearTimeout(textTimer);
      void updateText();
    };
  document.addEventListener("verba-theme", () => schedulePaint(true));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
    schedulePaint(true),
  );
  let lastWidth = 0;
  new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    if (width !== lastWidth) {
      lastWidth = width;
      schedulePaint();
    }
  }).observe(stage);
  addEventListener("popstate", () => void list(readURL()));
  await list(readURL());
}
