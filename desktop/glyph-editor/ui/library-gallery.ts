import { groupSections, type GroupSelection } from "./group-selection";
import { glyphCaption } from "./regions";
import type { Glyph } from "./model";
export interface PreviewFont {
  id: string;
  name: string;
  cell: { width: number; height: number };
}
export interface LibrarySection {
  title: string;
  glyphs: Glyph[];
  missing: number;
  characters?: string[];
}
export interface LibraryPreview {
  cell?: { width: number; height: number; advanceX: number };
  sections: LibrarySection[];
  unmapped: boolean;
}
export function libraryColumns(width: number) {
  return Math.max(1, Math.min(2, Math.floor(width / 550)));
}
export function glyphThumbnailSize(width: number, height: number) {
  const fit = Math.min(2, 56 / Math.max(1, width), 32 / Math.max(1, height));
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
export function libraryRows(heights: number[], columns: number) {
  const rows: { top: number; height: number; start: number; end: number }[] =
    [];
  let top = 0;
  for (let start = 0; start < heights.length; start += columns) {
    const end = Math.min(heights.length, start + columns),
      height = Math.max(...heights.slice(start, end)) + 12;
    rows.push({ top, height, start, end });
    top += height;
  }
  return { rows, height: top };
}
/** Cards own their natural content height. Only visible rows are mounted, and
 * row positions follow measured heights as glyphs arrive or the window changes. */
export function createLibraryGallery(options: {
  load: (
    id: string,
    sections: { title: string; chars: string[] }[],
    signal: AbortSignal,
  ) => Promise<LibraryPreview>;
  open: (id: string) => void;
}) {
  const host = document.getElementById("library-cards")!,
    inner = document.createElement("div");
  inner.className = "library-cards-inner";
  host.append(inner);
  let fonts: PreviewFont[] = [],
    selection: GroupSelection = { groups: [], upper: true, lower: true },
    active = false,
    epoch = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    controller = new AbortController(),
    lastPlan: ReturnType<typeof libraryRows> | undefined;
  const previews = new Map<string, LibraryPreview>(),
    heights = new Map<string, { width: number; height: number }>(),
    pending = new Map<
      string,
      { promise: Promise<LibraryPreview>; controller: AbortController }
    >();
  const schedule = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      render();
    }, 16);
  };
  const resize = new ResizeObserver((entries) => {
    let changed = false;
    for (const e of entries) {
      const card = e.target as HTMLElement;
      if (!card.isConnected) continue;
      const id = card.dataset.font!;
      const width = Math.round(e.contentRect.width),
        height = Math.ceil(card.getBoundingClientRect().height);
      const old = heights.get(id);
      if (!old || old.width !== width || old.height !== height) {
        heights.set(id, { width, height });
        changed = true;
      }
    }
    if (changed) schedule();
  });
  function remove(card: HTMLElement) {
    resize.unobserve(card);
    card.remove();
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
      token = epoch,
      cancel = () => child.abort();
    parent.addEventListener("abort", cancel, { once: true });
    const promise = options
      .load(id, sections, child.signal)
      .then((value) => {
        if (token === epoch && !child.signal.aborted) {
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
  function raster(g: Glyph) {
    const size = glyphThumbnailSize(g.width, g.height),
      canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const c = canvas.getContext("2d")!,
      image = c.createImageData(size.width, size.height);
    for (let y = 0; y < size.height; y++)
      for (let x = 0; x < size.width; x++) {
        const sx = Math.min(
            g.width - 1,
            Math.floor(((x + 0.5) * g.width) / size.width),
          ),
          sy = Math.min(
            g.height - 1,
            Math.floor(((y + 0.5) * g.height) / size.height),
          );
        if (
          g.rows[sy] &&
          parseInt(
            g.rows[sy].slice(
              Math.floor(sx / 8) * 2,
              Math.floor(sx / 8) * 2 + 2,
            ),
            16,
          ) &
            (128 >> sx % 8)
        )
          image.data.set([238, 233, 215, 255], (y * size.width + x) * 4);
      }
    c.putImageData(image, 0, 0);
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", glyphCaption(undefined, g));
    return canvas;
  }
  function sectionElement(section: LibrarySection, cell: PreviewFont["cell"]) {
    const wrap = document.createElement("section"),
      title = document.createElement("h4");
    wrap.className = "library-glyph-section";
    title.textContent =
      section.title + (section.missing ? ` · відсутні ${section.missing}` : "");
    wrap.append(title);
    if (!section.glyphs.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Немає гліфів цієї групи";
      wrap.append(empty);
      return wrap;
    }
    const grid = document.createElement("div");
    grid.className = "library-glyph-grid";
    const size = glyphThumbnailSize(cell.width, cell.height);
    grid.style.setProperty(
      "--glyph-tile-width",
      Math.max(24, size.width + 8) + "px",
    );
    const items =
      section.characters?.map((char) => ({
        char,
        glyph: section.glyphs.find(
          (g) =>
            g.character === char ||
            g.labels.some((l) => l.kind === "unicode" && l.value === char),
        ),
      })) ??
      section.glyphs.map((g) => ({
        char: g.character ?? String(g.sourceCode?.value ?? g.id),
        glyph: g,
      }));
    for (const { char, glyph } of items) {
      const tile = document.createElement("div"),
        label = document.createElement("span");
      tile.className = "library-glyph-tile" + (!glyph ? " missing" : "");
      tile.title = glyph
        ? glyphCaption(undefined, glyph)
        : `${char} · відсутній`;
      if (glyph) tile.append(raster(glyph));
      else {
        const absent = document.createElement("span");
        absent.className = "missing-mark";
        absent.textContent = "—";
        tile.append(absent);
      }
      label.textContent = char === " " ? "␠" : char;
      tile.append(label);
      grid.append(tile);
    }
    wrap.append(grid);
    return wrap;
  }
  function render() {
    if (!active || !host.clientWidth) return;
    const token = epoch,
      sections = groupSections(selection),
      columns = libraryColumns(host.clientWidth),
      width = host.clientWidth / columns,
      cardWidth = width - 12;
    const anchor = lastPlan?.rows.find(
        (r) => r.top <= host.scrollTop && r.top + r.height > host.scrollTop,
      ),
      anchorID = anchor ? fonts[anchor.start]?.id : undefined,
      offset = anchor ? host.scrollTop - anchor.top : 0;
    const plan = libraryRows(
      fonts.map((f) => {
        const measured = heights.get(f.id);
        return measured && Math.abs(measured.width - (cardWidth - 22)) < 2
          ? measured.height
          : 100 +
              sections.reduce(
                (n, s) =>
                  n +
                  28 +
                  Math.ceil(
                    s.chars.length /
                      Math.max(1, Math.floor((cardWidth - 22) / 68)),
                  ) *
                    48,
                0,
              );
      }),
      columns,
    );
    // Grow the scroll extent before restoring an anchor near the end; otherwise
    // the browser clamps scrollTop against the previous, shorter extent.
    inner.style.height = plan.height + "px";
    if (lastPlan && anchorID) {
      const idx = fonts.findIndex((f) => f.id === anchorID),
        row = plan.rows.find((r) => r.start <= idx && r.end > idx);
      if (row) host.scrollTop = Math.max(0, row.top + offset);
    }
    lastPlan = plan;
    const shown = plan.rows.filter(
        (r) =>
          r.top + r.height >= host.scrollTop - 450 &&
          r.top <= host.scrollTop + host.clientHeight + 450,
      ),
      indices = shown.flatMap((r) =>
        Array.from({ length: r.end - r.start }, (_, i) => r.start + i),
      ),
      keep = new Set(indices.map((i) => fonts[i].id));
    for (const [id, entry] of pending)
      if (!keep.has(id)) {
        entry.controller.abort();
        pending.delete(id);
      }
    for (const card of inner.querySelectorAll<HTMLElement>("[data-font]"))
      if (!keep.has(card.dataset.font!)) remove(card);
    for (const i of indices) {
      const font = fonts[i],
        row = shown.find((r) => i >= r.start && i < r.end)!;
      let card = inner.querySelector<HTMLElement>(`[data-font="${font.id}"]`);
      if (card) {
        card.style.top = row.top + "px";
        card.style.left = (i % columns) * width + "px";
        card.style.width = cardWidth + "px";
        continue;
      }
      card = document.createElement("article");
      card.className = "library-glyph-card";
      card.dataset.font = font.id;
      card.style.cssText = `position:absolute;top:${row.top}px;left:${(i % columns) * width}px;width:${cardWidth}px`;
      const button = document.createElement("button"),
        meta = document.createElement("small");
      button.textContent = font.name;
      button.onclick = () => options.open(font.id);
      meta.textContent = "Завантаження гліфів…";
      card.append(button, meta);
      inner.append(card);
      const target = card;
      void preview(font.id, sections)
        .then((value) => {
          if (token !== epoch || !target.isConnected) return;
          const cell = value.cell ?? font.cell;
          meta.textContent =
            `Комірка ${cell.width}×${cell.height}` +
            (value.unmapped
              ? " · Unicode-мапу не задано"
              : " · усі символи вибраних груп");
          for (const section of value.sections)
            target.append(sectionElement(section, cell));
          resize.observe(target);
        })
        .catch((reason) => {
          if (token === epoch && target.isConnected) {
            meta.textContent =
              reason instanceof Error ? reason.message : String(reason);
            resize.observe(target);
          }
        });
    }
    document.getElementById("library-gallery-count")!.textContent =
      `${fonts.length.toLocaleString("uk")} шрифтів · усі гліфи вибраних груп · клік на назві відкриває шрифт`;
  }
  host.addEventListener("scroll", schedule);
  new ResizeObserver(() => {
    heights.clear();
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
      if (changed || invalidate || !visible) {
        epoch++;
        controller.abort();
        controller = new AbortController();
        pending.clear();
        for (const card of inner.querySelectorAll<HTMLElement>("[data-font]"))
          remove(card);
        lastPlan = undefined;
        if (changed || invalidate) {
          previews.clear();
          heights.clear();
        }
        if (changed) host.scrollTop = 0;
      }
      schedule();
    },
  };
}
