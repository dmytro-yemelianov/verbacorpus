import { NativeFont, type GlyphMode } from "./font-data";
import { GlyphPainter } from "./font-painter";
import { boundedBitmapScale } from "./bitmap";
import type { Glyph } from "../para/types";
const field = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export class GlyphViewer {
  private font?: NativeFont;
  private indices: number[] = [];
  private nodes: Glyph[] = [];
  private offset = 0;
  private selected = 0;
  private revision = 0;
  private grid = field<HTMLElement>("glyph-grid");
  private count = field<HTMLElement>("glyph-count");
  private mode = field<HTMLSelectElement>("glyph-mode");
  private size = field<HTMLSelectElement>("glyph-page-size");
  private previous = field<HTMLButtonElement>("glyph-prev");
  private next = field<HTMLButtonElement>("glyph-next");
  private first = field<HTMLButtonElement>("glyph-first");
  private last = field<HTMLButtonElement>("glyph-last");
  private before = field<HTMLButtonElement>("glyph-before");
  private after = field<HTMLButtonElement>("glyph-after");
  private canvas = field<HTMLCanvasElement>("glyph-detail-canvas");
  private zoom = field<HTMLInputElement>("glyph-zoom");
  private pixelGrid = field<HTMLInputElement>("glyph-pixel-grid");
  private json = field<HTMLDetailsElement>("glyph-json");
  constructor(
    private painter: GlyphPainter,
    private ink: () => string,
  ) {
    this.mode.onchange = () => {
      this.indices = this.font?.indices(this.mode.value as GlyphMode) ?? [];
      void this.load(0);
    };
    this.size.onchange = () =>
      void this.load(
        Math.floor(this.selected / this.pageSize) * this.pageSize,
        this.selected,
      );
    this.previous.onclick = () =>
      void this.load(Math.max(0, this.offset - this.pageSize));
    this.next.onclick = () => void this.load(this.offset + this.pageSize);
    this.first.onclick = () => void this.load(0);
    this.last.onclick = () =>
      void this.load(
        Math.max(
          0,
          Math.floor((this.indices.length - 1) / this.pageSize) * this.pageSize,
        ),
      );
    this.before.onclick = () => void this.select(this.selected - 1);
    this.after.onclick = () => void this.select(this.selected + 1);
    this.zoom.oninput = () => this.paintDetail();
    this.pixelGrid.onchange = () => this.paintDetail();
    this.json.ontoggle = () => this.describe();
    field<HTMLButtonElement>("glyph-fit").onclick = () => {
      const glyph = this.nodes[this.selected - this.offset];
      if (glyph)
        this.zoom.value = String(
          Math.max(
            1,
            Math.min(
              16,
              Math.floor(
                (this.canvas.parentElement!.clientWidth - 32) /
                  Math.max(1, glyph.width),
              ),
            ),
          ),
        );
      this.paintDetail();
    };
    field<HTMLFormElement>("glyph-jump").onsubmit = (event) => {
      event.preventDefault();
      const input = field<HTMLInputElement>("glyph-lookup"),
        index = this.font?.lookup(input.value);
      if (index === undefined) {
        input.setCustomValidity(
          "Немає такого гліфа. Введіть g000123, U+0490 або символ.",
        );
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      this.mode.value = "all";
      this.indices = this.font!.indices("all");
      void this.load(Math.floor(index / this.pageSize) * this.pageSize, index);
    };
    field<HTMLInputElement>("glyph-lookup").oninput = (event) =>
      (event.target as HTMLInputElement).setCustomValidity("");
    this.grid.onkeydown = (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>("[data-glyph-position]");
      if (
        !button ||
        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      )
        return;
      event.preventDefault();
      const position = Number(button.dataset.glyphPosition);
      const index =
        event.key === "Home"
          ? this.offset
          : event.key === "End"
            ? Math.min(this.indices.length - 1, this.offset + this.pageSize - 1)
            : position + (event.key === "ArrowLeft" ? -1 : 1);
      void this.select(index).then(() =>
        this.grid
          .querySelector<HTMLButtonElement>(
            `[data-glyph-position="${this.selected}"]`,
          )
          ?.focus(),
      );
    };
  }
  private get pageSize() {
    return Number(this.size.value);
  }
  async setFont(font?: NativeFont) {
    field<HTMLInputElement>("glyph-lookup").setCustomValidity("");
    this.font = font;
    this.indices = font?.indices(this.mode.value as GlyphMode) ?? [];
    await this.load(0);
  }
  private controls(loading = false) {
    this.previous.disabled = this.first.disabled = loading || this.offset === 0;
    this.next.disabled = this.last.disabled =
      loading || this.offset + this.pageSize >= this.indices.length;
    this.before.disabled = loading || !this.nodes.length || this.selected === 0;
    this.after.disabled =
      loading || !this.nodes.length || this.selected >= this.indices.length - 1;
    this.mode.disabled = this.size.disabled = !this.font;
    this.grid.setAttribute("aria-busy", String(loading));
  }
  private async load(offset: number, selected?: number) {
    const revision = ++this.revision,
      font = this.font;
    this.offset = offset;
    this.selected = selected ?? offset;
    this.nodes = [];
    this.grid.replaceChildren();
    this.paintDetail();
    this.describe();
    this.controls(true);
    this.count.textContent = font ? "Завантаження гліфів…" : "Виберіть шрифт.";
    if (!font) {
      this.controls();
      return;
    }
    try {
      const nodes = await font.glyphs(
        this.indices.slice(offset, offset + this.pageSize),
      );
      if (revision !== this.revision) return;
      this.nodes = nodes;
      if (selected === undefined) {
        const firstInk = nodes.findIndex((glyph) =>
          glyph.rows.some((row) => /[1-9A-Fa-f]/.test(row)),
        );
        this.selected = offset + Math.max(0, firstInk);
      }
      this.count.textContent = nodes.length
        ? `${offset + 1}–${offset + nodes.length} із ${this.indices.length.toLocaleString("uk")} гліфів`
        : "Гліфів із таким типом відповідника немає.";
      const fragment = document.createDocumentFragment();
      for (const [i, glyph] of nodes.entries()) {
        const button = document.createElement("button"),
          canvas = document.createElement("canvas"),
          label = document.createElement("span");
        button.type = "button";
        button.className = "native-glyph";
        button.dataset.glyphPosition = String(offset + i);
        button.setAttribute(
          "aria-label",
          `${glyph.id} · ${glyph.codepoint ?? "без Unicode"} · ${glyph.width}×${glyph.height}`,
        );
        button.title = `${glyph.id} · ${glyph.width}×${glyph.height}`;
        label.textContent =
          glyph.codepoint ?? String(glyph.sourceCode?.value ?? glyph.id);
        button.append(canvas, label);
        button.onclick = () => void this.select(offset + i);
        fragment.append(button);
      }
      this.grid.append(fragment);
      this.redraw();
      this.describe();
      this.controls();
    } catch (error) {
      if (revision !== this.revision) return;
      this.count.textContent =
        "Не вдалося завантажити гліфи. Змініть сторінку або повторіть вибір.";
      this.controls();
    }
  }
  private async select(position: number) {
    if (!this.font || position < 0 || position >= this.indices.length) return;
    if (position < this.offset || position >= this.offset + this.nodes.length) {
      await this.load(
        Math.floor(position / this.pageSize) * this.pageSize,
        position,
      );
      return;
    }
    this.selected = position;
    this.markSelection();
    this.paintDetail();
    this.describe();
    this.controls();
  }
  private markSelection() {
    for (const button of this.grid.querySelectorAll<HTMLButtonElement>(
      "[data-glyph-position]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.glyphPosition) === this.selected),
      );
  }
  redraw() {
    const ink = this.ink();
    for (const [i, canvas] of [
      ...this.grid.querySelectorAll("canvas"),
    ].entries()) {
      const glyph = this.nodes[i],
        zoom = glyph.width <= 32 && glyph.height <= 32 ? 3 : 1;
      canvas.width = Math.max(1, glyph.width * zoom);
      canvas.height = Math.max(1, glyph.height * zoom);
      this.painter.paint(canvas.getContext("2d")!, glyph, 0, 0, zoom, ink);
    }
    this.markSelection();
    this.paintDetail();
  }
  private paintDetail() {
    const glyph = this.nodes[this.selected - this.offset];
    if (!glyph) {
      this.canvas.width = this.canvas.height = 1;
      field<HTMLElement>("glyph-selection").textContent = "Гліф не вибрано";
      return;
    }
    const zoom = boundedBitmapScale(
      glyph.width,
      glyph.height,
      Number(this.zoom.value),
    );
    this.canvas.width = Math.max(1, glyph.width * zoom);
    this.canvas.height = Math.max(1, glyph.height * zoom);
    const context = this.canvas.getContext("2d")!;
    this.painter.paint(context, glyph, 0, 0, zoom, this.ink());
    if (this.pixelGrid.checked && zoom >= 4) {
      context.strokeStyle = this.ink();
      context.globalAlpha = 0.18;
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= glyph.width; x++) {
        context.moveTo(x * zoom + 0.5, 0);
        context.lineTo(x * zoom + 0.5, this.canvas.height);
      }
      for (let y = 0; y <= glyph.height; y++) {
        context.moveTo(0, y * zoom + 0.5);
        context.lineTo(this.canvas.width, y * zoom + 0.5);
      }
      context.stroke();
      context.globalAlpha = 1;
    }
    this.canvas.setAttribute(
      "aria-label",
      `${this.font?.summary.name}: ${glyph.id}, ${glyph.width}×${glyph.height}`,
    );
    field<HTMLElement>("glyph-selection").textContent =
      `${glyph.id} · ${glyph.codepoint ?? "без Unicode"} · ${glyph.width}×${glyph.height} px · крок ${glyph.advanceX} · ${zoom}×`;
  }
  private describe() {
    const glyph = this.nodes[this.selected - this.offset],
      link = field<HTMLAnchorElement>("glyph-download");
    field<HTMLElement>("glyph-details").textContent =
      this.json.open && glyph ? JSON.stringify(glyph, null, 2) : "";
    if (!glyph || !this.font) {
      link.removeAttribute("href");
      return;
    }
    link.href = `/para/api/v2/fonts/${encodeURIComponent(this.font.summary.id)}/glyphs/${glyph.id}`;
    link.textContent = `JSON: ${glyph.id}`;
  }
}
