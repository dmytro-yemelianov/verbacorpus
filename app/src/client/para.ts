import { visitGlyphPixels, boundedBitmapScale } from "./bitmap";
/** Thin browser client of the public corpus API; native pixels never use web fonts. */
import type { FontSummary, Glyph } from "../para/types";
const container = document.querySelector<HTMLElement>("[data-font-corpus]");
if (container) void start();
async function start() {
  const field = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const search = field<HTMLInputElement>("font-search"),
    availability = field<HTMLSelectElement>("font-availability"),
    coverage = field<HTMLSelectElement>("font-coverage");
  const select = field<HTMLSelectElement>("font-select"),
    text = field<HTMLInputElement>("font-text"),
    scale = field<HTMLInputElement>("font-scale");
  const status = field<HTMLElement>("font-status"),
    count = field<HTMLElement>("font-count"),
    details = field<HTMLElement>("font-details"),
    canvas = field<HTMLCanvasElement>("font-canvas");
  const prev = field<HTMLButtonElement>("font-prev"),
    next = field<HTMLButtonElement>("font-next"),
    download = field<HTMLAnchorElement>("font-download");
  let offset = 0,
    nextOffset: number | null = null,
    current: FontSummary | undefined;
  let gridController: AbortController | undefined;
  let gridOffset = 0,
    gridNext: number | null = null,
    gridNodes: Glyph[] = [];
  let listController: AbortController | undefined,
    glyphController: AbortController | undefined;
  async function get<T>(url: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("API " + response.status);
    return response.json() as Promise<T>;
  }
  async function draw() {
    glyphController?.abort();
    glyphController = new AbortController();
    const signal = glyphController.signal;
    if (!current) return;
    const font = current;
    download.href =
      "/para/api/v2/fonts/" + encodeURIComponent(font.id) + "?download=1";
    const ua = font.coverage.ukrainian;
    details.textContent = `${font.name} · ${font.cell.width}×${font.cell.height} · ${font.licenseId} · ${ua.present === null ? "покриття невідоме" : `українська ${ua.present}/66`}`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (font.availability !== "raster") {
      status.textContent = "Растрові дані недоступні.";
      return;
    }
    try {
      const chars = [...text.value].slice(0, 80);
      const page = await get<{ nodes: Glyph[]; missing: string[] }>(
        "/para/api/v2/fonts/" +
          encodeURIComponent(font.id) +
          "/glyphs?chars=" +
          encodeURIComponent(chars.join("")),
        signal,
      );
      if (signal.aborted) return;
      const glyphs = new Map<string, Glyph>();
      for (const glyph of page.nodes)
        for (const label of glyph.labels)
          if (label.kind === "unicode" && !glyphs.has(label.value))
            glyphs.set(label.value, glyph);
      const lineHeight =
        Math.max(
          font.cell.height,
          Number(font.metrics.lineHeight ?? font.cell.height),
        ) + 5;
      const width = Math.max(480, font.cell.width + 8),
        zoom = boundedBitmapScale(width, lineHeight + 4, Number(scale.value));
      const maxHeight = Math.floor(2_000_000 / (width * zoom * zoom));
      let left = 2,
        top = 2;
      const positions: {
        char: string;
        glyph: Glyph | undefined;
        left: number;
        top: number;
      }[] = [];
      for (const char of chars) {
        const glyph = glyphs.get(char),
          advance =
            glyph?.advanceX ?? Math.round(Number(font.metrics.advanceX));
        if (left + Math.max(advance, font.cell.width) > width) {
          left = 2;
          top += lineHeight;
        }
        if (top + lineHeight > maxHeight) break;
        positions.push({ char, glyph, left, top });
        left += advance;
      }
      canvas.width = width * zoom;
      canvas.height = (top + lineHeight) * zoom;
      ctx.imageSmoothingEnabled = false;
      const ink = getComputedStyle(document.body).color;
      for (const { glyph, left, top } of positions) {
        if (!glyph) {
          ctx.strokeStyle = "#b4232a";
          ctx.lineWidth = zoom;
          ctx.strokeRect(
            (left + 1) * zoom,
            (top + 1) * zoom,
            (font.cell.width - 2) * zoom,
            (font.cell.height - 2) * zoom,
          );
          continue;
        }
        ctx.fillStyle = ink;
        const gx = Math.round(left + glyph.metrics.leftBearing);
        const gy = Math.round(
          top +
            Number(font.metrics.baseline) -
            glyph.metrics.shiftUp -
            glyph.height,
        );
        visitGlyphPixels(glyph, (x, y) =>
          ctx.fillRect((gx + x) * zoom, (gy + y) * zoom, zoom, zoom),
        );
      }
      canvas.setAttribute("aria-label", font.name + ": " + chars.join(""));
      status.textContent = page.missing.length
        ? "Відсутні символи: " +
          page.missing.join(" ") +
          " — позначено рамками."
        : "Усі символи є у шрифті. Оригінальні пікселі без згладжування.";
      if (positions.length < chars.length)
        status.textContent += ` Показано перші ${positions.length} символів; повні гліфи доступні нижче.`;
    } catch (error) {
      if (!signal.aborted)
        status.textContent = "Не вдалося завантажити гліфи. Спробуйте ще раз.";
    }
  }
  const grid = field<HTMLElement>("glyph-grid"),
    gridCount = field<HTMLElement>("glyph-count");
  const glyphPrev = field<HTMLButtonElement>("glyph-prev"),
    glyphNext = field<HTMLButtonElement>("glyph-next");
  let selectedGlyph: Glyph | undefined;
  const glyphZoom = field<HTMLInputElement>("glyph-zoom"),
    glyphCanvas = field<HTMLCanvasElement>("glyph-detail-canvas");
  function paintDetail() {
    const glyph = selectedGlyph;
    if (!glyph) {
      glyphCanvas.width = glyphCanvas.height = 1;
      return;
    }
    const zoom = boundedBitmapScale(
      glyph.width,
      glyph.height,
      Number(glyphZoom.value),
    );
    glyphCanvas.width = Math.max(1, glyph.width * zoom);
    glyphCanvas.height = Math.max(1, glyph.height * zoom);
    const context = glyphCanvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.fillStyle = getComputedStyle(document.body).color;
    visitGlyphPixels(glyph, (x, y) =>
      context.fillRect(x * zoom, y * zoom, zoom, zoom),
    );
  }
  glyphZoom.oninput = paintDetail;
  function renderGrid() {
    grid.replaceChildren();
    for (const glyph of gridNodes) {
      const button = document.createElement("button"),
        thumb = document.createElement("canvas"),
        label = document.createElement("span");
      button.type = "button";
      button.className = "native-glyph";
      const zoom = glyph.width <= 32 && glyph.height <= 32 ? 3 : 1;
      thumb.width = Math.max(1, glyph.width * zoom);
      thumb.height = Math.max(1, glyph.height * zoom);
      const context = thumb.getContext("2d");
      if (context) {
        context.imageSmoothingEnabled = false;
        context.fillStyle = getComputedStyle(document.body).color;
        visitGlyphPixels(glyph, (x, y) =>
          context.fillRect(x * zoom, y * zoom, zoom, zoom),
        );
      }
      const name =
        glyph.codepoint ?? String(glyph.sourceCode?.value ?? glyph.id);
      label.textContent = name;
      button.setAttribute("aria-label", glyph.id + " " + name);
      button.append(thumb, label);
      button.onclick = () => {
        selectedGlyph = glyph;
        paintDetail();
        field<HTMLElement>("glyph-details").textContent = JSON.stringify(
          glyph,
          null,
          2,
        );
        const link = field<HTMLAnchorElement>("glyph-download");
        link.href =
          "/para/api/v2/fonts/" +
          encodeURIComponent(current!.id) +
          "/glyphs/" +
          glyph.id;
        link.textContent = "JSON: " + glyph.id;
      };
      grid.append(button);
    }
  }
  async function loadGrid() {
    gridController?.abort();
    gridController = new AbortController();
    const signal = gridController.signal;
    glyphPrev.disabled = glyphNext.disabled = true;
    grid.replaceChildren();
    selectedGlyph = undefined;
    paintDetail();
    field<HTMLElement>("glyph-details").textContent = "";
    field<HTMLAnchorElement>("glyph-download").removeAttribute("href");
    if (!current) return;
    try {
      const page = await get<{
        nodes: Glyph[];
        total: number;
        nextOffset: number | null;
      }>(
        "/para/api/v2/fonts/" +
          encodeURIComponent(current.id) +
          "/glyphs?limit=32&offset=" +
          gridOffset,
        signal,
      );
      if (signal.aborted) return;
      gridNodes = page.nodes;
      gridNext = page.nextOffset;
      gridCount.textContent = `${gridOffset + 1}–${gridOffset + page.nodes.length} із ${page.total} вихідних гліфів`;
      glyphPrev.disabled = gridOffset === 0;
      glyphNext.disabled = gridNext === null;
      renderGrid();
    } catch (error) {
      if (!signal.aborted)
        gridCount.textContent = "Не вдалося завантажити гліфи.";
    }
  }
  glyphPrev.onclick = () => {
    gridOffset = Math.max(0, gridOffset - 32);
    void loadGrid();
  };
  glyphNext.onclick = () => {
    if (gridNext !== null) {
      gridOffset = gridNext;
      void loadGrid();
    }
  };
  async function list() {
    listController?.abort();
    listController = new AbortController();
    const signal = listController.signal;
    glyphController?.abort();
    gridController?.abort();
    select.disabled = true;
    prev.disabled = true;
    next.disabled = true;
    const params = new URLSearchParams({ limit: "50", offset: String(offset) });
    if (search.value.trim()) params.set("q", search.value.trim());
    if (availability.value) params.set("availability", availability.value);
    if (coverage.value) params.set("ukrainian", coverage.value);
    try {
      const page = await get<{
        nodes: FontSummary[];
        total: number;
        nextOffset: number | null;
      }>("/para/api/v2/fonts?" + params, signal);
      if (signal.aborted) return;
      const selected = current?.id;
      select.replaceChildren();
      for (const font of page.nodes) {
        const option = document.createElement("option");
        option.value = font.id;
        option.textContent = `${font.name} (${font.cell.width}×${font.cell.height})`;
        select.append(option);
      }
      current =
        page.nodes.find((f) => f.id === selected) ??
        page.nodes.find((f) => f.id === "cozette-13x15") ??
        page.nodes[0];
      if (current) select.value = current.id;
      select.disabled = !current;
      prev.disabled = offset === 0;
      nextOffset = page.nextOffset;
      next.disabled = nextOffset === null;
      count.textContent = page.total
        ? `${offset + 1}–${offset + page.nodes.length} із ${page.total} записів`
        : "Нічого не знайдено";
      select.onchange = () => {
        current = page.nodes.find((f) => f.id === select.value);
        gridOffset = 0;
        void draw();
        void loadGrid();
      };
      if (current) {
        gridOffset = 0;
        await Promise.all([draw(), loadGrid()]);
      } else {
        details.textContent = "";
        status.textContent = "Спробуйте інші фільтри.";
        canvas.width = 1;
        canvas.height = 1;
        download.removeAttribute("href");
      }
    } catch (error) {
      if (!signal.aborted) {
        count.textContent = "Не вдалося завантажити каталог.";
        status.textContent = "Спробуйте оновити сторінку.";
      }
    }
  }
  field<HTMLFormElement>("font-filter").onsubmit = (event) => {
    event.preventDefault();
    offset = 0;
    void list();
  };
  availability.onchange = coverage.onchange = () => {
    offset = 0;
    void list();
  };
  prev.onclick = () => {
    offset = Math.max(0, offset - 50);
    void list();
  };
  next.onclick = () => {
    if (nextOffset !== null) {
      offset = nextOffset;
      void list();
    }
  };
  text.oninput = scale.oninput = () => {
    void draw();
  };
  document.addEventListener("verba-theme", () => {
    void draw();
    renderGrid();
    paintDetail();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    void draw();
    renderGrid();
    paintDetail();
  });
  await list();
}
