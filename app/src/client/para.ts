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
      "/para/api/v1/fonts/" + encodeURIComponent(font.id) + "?download=1";
    const ua = font.coverage.ukrainian;
    details.textContent = `${font.name} · ${font.cell.width}×${font.cell.height} · ${font.licenseId} · ${ua.present === null ? "покриття невідоме" : `українська ${ua.present}/66`}`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (font.availability !== "raster") {
      status.textContent =
        "Метадані: растрові дані недоступні. Дозвіл на поширення не підтверджено.";
      return;
    }
    try {
      const chars = [...text.value].slice(0, 80);
      const page = await get<{ nodes: Glyph[]; missing: string[] }>(
        "/para/api/v1/fonts/" +
          encodeURIComponent(font.id) +
          "/glyphs?chars=" +
          encodeURIComponent(chars.join("")),
        signal,
      );
      if (signal.aborted) return;
      const glyphs = new Map(page.nodes.map((g) => [g.character, g]));
      const zoom = Number(scale.value),
        lineHeight = font.cell.height + 5,
        width = 480;
      let left = 2,
        top = 2;
      const positions = chars.map((char) => {
        const glyph = glyphs.get(char),
          advance = glyph?.advanceX ?? Number(font.metrics.advanceX);
        if (left + Math.max(advance, font.cell.width) > width) {
          left = 2;
          top += lineHeight;
        }
        const position = { char, glyph, left, top };
        left += advance + 1;
        return position;
      });
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
        glyph.rows.forEach((row, y) => {
          for (let x = 0; x < font.cell.width; x++) {
            const byte = parseInt(
              row.slice(Math.floor(x / 8) * 2, Math.floor(x / 8) * 2 + 2),
              16,
            );
            if (byte & (128 >> (x % 8)))
              ctx.fillRect((left + x) * zoom, (top + y) * zoom, zoom, zoom);
          }
        });
      }
      canvas.setAttribute("aria-label", font.name + ": " + chars.join(""));
      status.textContent = page.missing.length
        ? "Відсутні символи: " +
          page.missing.join(" ") +
          " — позначено рамками."
        : "Усі символи є у шрифті. Оригінальні пікселі без згладжування.";
    } catch (error) {
      if (!signal.aborted)
        status.textContent = "Не вдалося завантажити гліфи. Спробуйте ще раз.";
    }
  }
  async function list() {
    listController?.abort();
    listController = new AbortController();
    const signal = listController.signal;
    glyphController?.abort();
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
      }>("/para/api/v1/fonts?" + params, signal);
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
        void draw();
      };
      if (current) await draw();
      else {
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
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    void draw();
  });
  await list();
}
