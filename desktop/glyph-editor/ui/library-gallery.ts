import { groupSections, type GroupSelection } from "./group-selection";
import { glyphCaption } from "./regions";
import { unpack, type Glyph } from "./model";
export interface PreviewFont {
  id: string;
  name: string;
  cell: { width: number; height: number };
}
export interface LibraryPreview {
  cell?: { width: number; height: number; advanceX: number };
  sections: { title: string; glyphs: Glyph[]; missing: number }[];
  unmapped: boolean;
}
export function createLibraryGallery(options: {
  load: (
    id: string,
    sections: { title: string; chars: string[] }[],
    signal: AbortSignal,
  ) => Promise<LibraryPreview>;
  open: (id: string) => void;
  error: (reason: unknown) => void;
}) {
  const host = document.getElementById("library-cards")!,
    inner = document.createElement("div");
  host.append(inner);
  inner.className = "library-cards-inner";
  let fonts: PreviewFont[] = [],
    selection: GroupSelection = { groups: [], upper: true, lower: true },
    active = false,
    epoch = 0,
    frame: ReturnType<typeof setTimeout> | undefined;
  let controller = new AbortController();
  const previews = new Map<string, LibraryPreview>(),
    pending = new Map<
      string,
      { promise: Promise<LibraryPreview>; controller: AbortController }
    >();
  function plan() {
    const sections = groupSections(selection).map((s) => ({
      ...s,
      chars: s.chars.slice(0, 18),
    }));
    const columns = Math.max(1, Math.floor(host.clientWidth / 360)),
      height = Math.max(156, 84 + sections.length * 60);
    return { sections, columns, height, width: host.clientWidth / columns };
  }
  async function preview(
    id: string,
    sections: { title: string; chars: string[] }[],
  ) {
    const cached = previews.get(id);
    if (cached) {
      previews.delete(id);
      previews.set(id, cached);
      return cached;
    }
    const existing = pending.get(id);
    if (existing) return existing.promise;
    const child = new AbortController(),
      parent = controller.signal,
      token = epoch;
    const cancel = () => child.abort();
    parent.addEventListener("abort", cancel, { once: true });
    const promise = options
      .load(id, sections, child.signal)
      .then((value) => {
        if (epoch === token && !child.signal.aborted) {
          previews.set(id, value);
          while (previews.size > 32)
            previews.delete(previews.keys().next().value!);
        }
        return value;
      })
      .finally(() => {
        parent.removeEventListener("abort", cancel);
        if (pending.get(id)?.promise === promise) pending.delete(id);
      });
    pending.set(id, { promise, controller: child });
    return promise;
  }
  function raster(glyphs: Glyph[]) {
    const canvas = document.createElement("canvas"),
      baseline = Math.max(
        1,
        ...glyphs.map((g) => g.height + g.metrics.shiftUp),
      ),
      descent = Math.max(0, ...glyphs.map((g) => -g.metrics.shiftUp)),
      height = baseline + descent,
      z = Math.max(1, Math.min(4, Math.floor(28 / height)));
    canvas.width = Math.max(
      1,
      Math.min(
        4096,
        Math.ceil(glyphs.reduce((x, g) => x + Math.max(1, g.advanceX) + 1, 0)) *
          z,
      ),
    );
    canvas.height = Math.max(1, Math.ceil(height) * z);
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#eee9d7";
    let pen = 0;
    for (const g of glyphs) {
      const top = baseline - g.height - g.metrics.shiftUp;
      unpack(g).forEach((v, i) => {
        if (v)
          c.fillRect(
            Math.round(pen + g.metrics.leftBearing + (i % g.width)) * z,
            Math.round(top + Math.floor(i / g.width)) * z,
            z,
            z,
          );
      });
      pen += Math.max(1, g.advanceX) + 1;
    }
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      glyphs.map((g) => glyphCaption(undefined, g)).join(", "),
    );
    return canvas;
  }
  async function render() {
    if (!active) return;
    const token = epoch,
      { sections, columns, height, width } = plan(),
      start = Math.max(0, Math.floor(host.scrollTop / height) - 1) * columns,
      end = Math.min(
        fonts.length,
        (Math.ceil((host.scrollTop + host.clientHeight) / height) + 1) *
          columns,
      );
    inner.style.height = Math.ceil(fonts.length / columns) * height + "px";
    const keep = new Set(fonts.slice(start, end).map((f) => f.id));
    for (const [id, entry] of pending)
      if (!keep.has(id)) {
        entry.controller.abort();
        pending.delete(id);
      }
    for (let i = start; i < end; i++) {
      const font = fonts[i];
      keep.add(font.id);
      let card = inner.querySelector<HTMLElement>(`[data-font="${font.id}"]`);
      if (card) continue;
      card = document.createElement("article");
      card.dataset.font = font.id;
      card.className = "library-glyph-card";
      card.style.cssText = `position:absolute;top:${Math.floor(i / columns) * height}px;left:${(i % columns) * width}px;width:${width - 10}px;height:${height - 10}px`;
      const open = document.createElement("button");
      open.textContent = font.name;
      open.onclick = () => options.open(font.id);
      card.append(open);
      const meta = document.createElement("small");
      meta.textContent = `${font.cell.width}×${font.cell.height} · завантаження гліфів…`;
      card.append(meta);
      inner.append(card);
      const target = card;
      void preview(font.id, sections)
        .then((value) => {
          if (token !== epoch || !target.isConnected) return;
          meta.textContent = value.unmapped
            ? "Вибрані групи без відповідників · вихідні гліфи"
            : `Комірка ${value.cell?.width ?? font.cell.width}×${value.cell?.height ?? font.cell.height} · моноширинний крок ${value.cell?.advanceX ?? font.cell.width}`;
          for (const section of value.sections) {
            const line = document.createElement("div"),
              title = document.createElement("small");
            title.textContent =
              section.title +
              (section.missing ? ` · у зразку немає ${section.missing}` : "");
            line.append(title);
            if (section.glyphs.length) line.append(raster(section.glyphs));
            else {
              const text = document.createElement("span");
              text.textContent = "Немає гліфів цієї групи";
              line.append(text);
            }
            target.append(line);
          }
        })
        .catch((reason) => {
          if (token === epoch && !controller.signal.aborted) {
            meta.textContent =
              reason instanceof Error ? reason.message : String(reason);
          }
        });
    }
    for (const node of inner.querySelectorAll<HTMLElement>("[data-font]"))
      if (!keep.has(node.dataset.font!)) node.remove();
    document.getElementById("library-gallery-count")!.textContent =
      `${fonts.length.toLocaleString("uk")} шрифтів · вибрані групи · клік на назві відкриває всі гліфи`;
  }
  const schedule = () => {
    if (frame !== undefined) return;
    frame = setTimeout(() => {
      frame = undefined;
      void render().catch(options.error);
    }, 16);
  };
  host.addEventListener("scroll", schedule);
  new ResizeObserver(() => {
    inner.replaceChildren();
    schedule();
  }).observe(host);
  return {
    set: (
      values: PreviewFont[],
      groups: GroupSelection,
      visible: boolean,
      invalidate = false,
    ) => {
      const changed =
        JSON.stringify(selection) !== JSON.stringify(groups) ||
        fonts.length !== values.length ||
        fonts.some((f, i) => f.id !== values[i]?.id);
      active = visible;
      fonts = values;
      selection = structuredClone(groups);
      if (changed || invalidate) {
        epoch++;
        controller.abort();
        controller = new AbortController();
        previews.clear();
        pending.clear();
        inner.replaceChildren();
        if (changed) host.scrollTop = 0;
      }
      if (!visible) {
        epoch++;
        controller.abort();
        controller = new AbortController();
        pending.clear();
        inner.replaceChildren();
      }
      schedule();
    },
  };
}
