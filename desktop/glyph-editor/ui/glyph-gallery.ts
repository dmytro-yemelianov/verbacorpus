import { codepoint, type Draft, type Glyph } from "./model";
import { glyphCaption, mappedCharacter, type GlyphSlot } from "./regions";
import { GlyphPainter } from "../../../app/src/client/font-painter";
export interface GalleryRow {
  top: number;
  height: number;
  section?: string;
  left?: number;
  columns?: number;
  indices: number[];
}
export function galleryRows(
  slots: GlyphSlot[],
  columns: number,
  parallel = false,
) {
  const groups = [...new Set(slots.map((s) => s.group))].filter(
    (g): g is string => !!g,
  );
  if (parallel && groups.length > 1 && columns >= 6) {
    const laneCount = Math.min(groups.length, 3, Math.floor(columns / 3)),
      rows: GalleryRow[] = [];
    let top = 0;
    for (let start = 0; start < groups.length; start += laneCount) {
      let height = 0;
      const band = groups.slice(start, start + laneCount);
      band.forEach((group, lane) => {
        const left = Math.floor((lane * columns) / band.length),
          right = Math.floor(((lane + 1) * columns) / band.length),
          indices = slots.flatMap((s, i) => (s.group === group ? [i] : []));
        const plan = galleryRows(
          indices.map((i) => slots[i]),
          right - left,
        );
        rows.push(
          ...plan.rows.map((r) => ({
            ...r,
            top: r.top + top,
            left,
            columns: right - left,
            indices: r.indices.map((i) => indices[i]),
          })),
        );
        height = Math.max(height, plan.height);
      });
      top += height + 16;
    }
    return { rows, height: top };
  }
  const rows: GalleryRow[] = [];
  let top = 0,
    section: string | undefined;
  for (let i = 0; i < slots.length; ) {
    if (slots[i].section && slots[i].section !== section) {
      section = slots[i].section;
      rows.push({ top, height: 30, section, indices: [] });
      top += 30;
    }
    const indices: number[] = [];
    do {
      indices.push(i++);
    } while (
      i < slots.length &&
      indices.length < Math.max(1, columns) &&
      slots[i].section === slots[i - 1].section
    );
    rows.push({ top, height: 88, indices });
    top += 88;
  }
  return { rows, height: top };
}
/** Render only visible rows; source/draft glyphs load lazily through the shared cache. */
export function createGlyphGallery(options: {
  load: (id: string) => Promise<Glyph | undefined>;
  select: (index: number, edit: boolean) => void;
  pin: (glyph: Glyph) => void;
  error: (value: unknown) => void;
}) {
  const host = document.getElementById("glyphs")!,
    inner = document.createElement("div"),
    painter = new GlyphPainter();
  inner.className = "gallery-inner";
  host.replaceChildren(inner);
  let parallel = false;
  let slots: GlyphSlot[] = [],
    selected = 0,
    draft: Draft | undefined,
    revision = 0,
    key = "",
    frame: ReturnType<typeof setTimeout> | undefined;
  let cached:
    | {
        slots: GlyphSlot[];
        columns: number;
        parallel: boolean;
        plan: ReturnType<typeof galleryRows>;
      }
    | undefined;
  function layout() {
    const columns = Math.max(
      1,
      Math.floor(
        host.clientWidth /
          (document.body.classList.contains("editor-open") ? 44 : 82),
      ),
    );
    if (
      !cached ||
      cached.slots !== slots ||
      cached.columns !== columns ||
      cached.parallel !== parallel
    )
      cached = {
        slots,
        columns,
        parallel,
        plan: galleryRows(slots, columns, parallel),
      };
    return cached.plan;
  }
  async function render() {
    const token = ++revision,
      columns = Math.max(
        1,
        Math.floor(
          host.clientWidth /
            (document.body.classList.contains("editor-open") ? 44 : 82),
        ),
      ),
      width = host.clientWidth / columns;
    const plan = layout();
    inner.style.height = plan.height + "px";
    const shown = plan.rows.filter(
      (r) =>
        r.top + r.height >= host.scrollTop - 176 &&
        r.top <= host.scrollTop + host.clientHeight + 176,
    );
    const values = new Map<number, Glyph | undefined>();
    await Promise.all(
      shown
        .flatMap((r) => r.indices)
        .map(async (i) => {
          values.set(
            i,
            slots[i].id ? await options.load(slots[i].id!) : undefined,
          );
        }),
    );
    if (token !== revision) return;
    const fragment = document.createDocumentFragment();
    for (const row of shown) {
      if (row.section) {
        const title = document.createElement("h3");
        title.className = "glyph-section";
        title.textContent = row.section;
        title.style.cssText = `position:absolute;top:${row.top}px;left:${(row.left ?? 0) * width}px;width:${(row.columns ?? columns) * width - 5}px`;
        fragment.append(title);
      }
      row.indices.forEach((i, column) => {
        const s = slots[i],
          value = values.get(i),
          button = document.createElement("button"),
          char = s.char ?? mappedCharacter(value),
          caption = glyphCaption(char, value);
        button.className =
          "glyph" +
          (!value ? " missing" : "") +
          (s.id && draft?.edits[s.id] ? " changed" : "") +
          (draft?.reviewed.includes(s.key) ? " reviewed" : "");
        button.style.cssText = `position:absolute;top:${row.top}px;left:${((row.left ?? 0) + column) * width}px;width:${width - 5}px;height:82px`;
        button.setAttribute("aria-pressed", String(i === selected));
        button.setAttribute(
          "aria-label",
          (!value ? "Відсутній · " : "") + caption,
        );
        button.title =
          caption +
          (char ? " · " + codepoint(char) : "") +
          " · " +
          (value?.id ?? "відсутній") +
          " · подвійний клік — редагувати; Shift+клік — підкладка";
        if (value) {
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, value.width);
          canvas.height = Math.max(1, value.height);
          painter.paint(canvas.getContext("2d")!, value, 0, 0, 1, "#eee9d7");
          button.append(canvas);
        } else {
          const letter = document.createElement("strong");
          letter.textContent = char === " " ? "␠" : (char ?? "+");
          button.append(letter);
        }
        const label = document.createElement("span");
        label.textContent = caption;
        button.append(label);
        button.onclick = (event) => {
          if (event.shiftKey && value) options.pin(value);
          else options.select(i, false);
        };
        button.ondblclick = () => options.select(i, true);
        fragment.append(button);
      });
    }
    inner.replaceChildren(fragment);
    document.getElementById("queue-count")!.textContent =
      `${slots.length.toLocaleString("uk")} гліфів · пунктир = відсутній · подвійний клік — редагувати`;
  }
  const schedule = () => {
    if (frame !== undefined) return;
    frame = setTimeout(() => {
      frame = undefined;
      void render().catch(options.error);
    }, 16);
  };
  host.addEventListener("scroll", schedule);
  new ResizeObserver(schedule).observe(host);
  return {
    set: async (
      values: GlyphSlot[],
      active: number,
      state: Draft,
      fontId: string,
      lanes = false,
    ) => {
      parallel = lanes;
      const changed =
        key !== fontId ||
        values.length !== slots.length ||
        values.some((s, i) => s.key !== slots[i]?.key);
      key = fontId;
      slots = values;
      draft = state;
      const moved = selected !== active;
      selected = active;
      if (changed) host.scrollTop = 0;
      if (changed || moved) {
        const row = layout().rows.find((r) => r.indices.includes(active));
        if (
          row &&
          (row.top < host.scrollTop ||
            row.top + row.height > host.scrollTop + host.clientHeight)
        )
          host.scrollTop = row.top;
      }
      await render();
    },
    refresh: schedule,
    navigate: (key: string) => {
      if (key === "ArrowLeft" || key === "ArrowRight")
        return Math.max(
          0,
          Math.min(slots.length - 1, selected + (key === "ArrowLeft" ? -1 : 1)),
        );
      const rows = layout().rows.filter((r) => r.indices.length),
        row = rows.find((r) => r.indices.includes(selected));
      if (!row) return selected;
      const candidates = rows
        .filter(
          (r) =>
            (r.left ?? 0) === (row.left ?? 0) &&
            (key === "ArrowUp" ? r.top < row.top : r.top > row.top),
        )
        .sort((a, b) => Math.abs(a.top - row.top) - Math.abs(b.top - row.top));
      const next = candidates[0];
      return next
        ? next.indices[
            Math.min(next.indices.length - 1, row.indices.indexOf(selected))
          ]
        : selected;
    },
  };
}
