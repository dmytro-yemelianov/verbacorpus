import {
  createRasterMutation,
  type RasterMutation,
  type RasterPreview,
  type Anchor,
} from "./raster-mutation";
import type { Glyph } from "./model";
import { unpack, pack, line } from "./model";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
/** Owns only raster presentation and pointer gestures; mutations are transactions. */
export function createCanvas(model: {
  get: () => { glyph?: Glyph; original?: Glyph; editable: boolean };
  commit: (glyph: Glyph) => void;
}) {
  const canvas = $<HTMLCanvasElement>("canvas"),
    stage = $<HTMLElement>("canvas-stage"),
    zoom = $<HTMLInputElement>("zoom");
  let frame = 0,
    tool = "pencil",
    stroke:
      | {
          before: Glyph;
          pixels: Uint8Array;
          value: number;
          x: number;
          y: number;
        }
      | undefined;
  let gesture:
    | {
        before: Glyph;
        raster: ReturnType<typeof createRasterMutation>;
        start: { x: number; y: number };
        options: RasterMutation;
        preview?: RasterPreview;
      }
    | undefined;
  function mutationPreview() {
    if (gesture && !gesture.preview)
      gesture.preview = gesture.raster.render(gesture.options);
    return gesture?.preview;
  }
  function scheduleDraw() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
  }
  function fitZoom() {
    const current = model.get().glyph;
    if (!current) return;
    zoom.value = String(
      Math.max(
        1,
        Math.min(
          64,
          Math.floor((stage.clientWidth - 48) / Math.max(1, current.width)),
          Math.floor((stage.clientHeight - 48) / Math.max(1, current.height)),
        ),
      ),
    );
  }
  function sourceCanvas(g: Glyph | undefined, data?: Uint8Array) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, g?.width ?? 1);
    c.height = Math.max(1, g?.height ?? 1);
    if (!g) return c;
    const p = data ?? unpack(g),
      image = c.getContext("2d")!.createImageData(c.width, c.height);
    for (let i = 0; i < p.length; i++)
      if (p[i]) {
        image.data.set([238, 233, 215, 255], i * 4);
      }
    c.getContext("2d")!.putImageData(image, 0, 0);
    return c;
  }
  function draw() {
    const { glyph: current, original } = model.get();
    const mutation = mutationPreview();
    if (gesture) {
      const o = gesture.options;
      $("coordinates").textContent =
        `Зсув ${o.dx}, ${o.dy} · растр ${o.width}×${o.height}${mutation?.clipped ? " · обрізання на краю" : ""}`;
    }
    const pixels =
      mutation?.pixels ??
      stroke?.pixels ??
      (current ? unpack(current) : new Uint8Array());
    if (!current) {
      canvas.width = canvas.height = 1;
      $("empty").hidden = false;
      return;
    }
    $("empty").hidden = true;
    const area = Math.max(1, current.width * current.height),
      z = Math.max(
        1,
        Math.min(Number(zoom.value), Math.floor(Math.sqrt(2_000_000 / area))),
      );
    $("zoom-value").textContent = z + "×";
    canvas.width = Math.max(1, current.width * z);
    canvas.height = Math.max(1, current.height * z);
    const context = canvas.getContext("2d")!;
    context.imageSmoothingEnabled = false;
    const view = $<HTMLSelectElement>("view").value,
      source = sourceCanvas(
        view === "original" ? original : current,
        view === "original" ? undefined : pixels,
      );
    if (view === "diff" && original) {
      const before = unpack(original),
        image = source
          .getContext("2d")!
          .getImageData(0, 0, source.width, source.height),
        live = pixels;
      for (let y = 0; y < current.height; y++)
        for (let x = 0; x < current.width; x++) {
          const i = y * current.width + x,
            a =
              x < original.width && y < original.height
                ? before[y * original.width + x]
                : 0,
            b = live[i];
          image.data.set(
            b
              ? a
                ? [138, 153, 132, 255]
                : [119, 220, 150, 255]
              : a
                ? [255, 115, 110, 255]
                : [0, 0, 0, 0],
            i * 4,
          );
        }
      source.getContext("2d")!.putImageData(image, 0, 0);
    }
    context.drawImage(source, 0, 0, source.width * z, source.height * z);
    if ($<HTMLInputElement>("grid").checked && z >= 5) {
      context.strokeStyle = "#a5af9b55";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= current.width; x++) {
        context.moveTo(x * z + 0.5, 0);
        context.lineTo(x * z + 0.5, canvas.height);
      }
      for (let y = 0; y <= current.height; y++) {
        context.moveTo(0, y * z + 0.5);
        context.lineTo(canvas.width, y * z + 0.5);
      }
      context.stroke();
    }
    if ((tool === "move" || tool === "scale") && view === "edit") {
      const b = mutation?.bounds ?? createRasterMutation(current).bounds;
      if (b) {
        context.strokeStyle = mutation?.clipped ? "#ffa294" : "#d4b76e";
        context.lineWidth = 1;
        context.setLineDash([4, 3]);
        context.strokeRect(
          b.x * z + 0.5,
          b.y * z + 0.5,
          b.width * z - 1,
          b.height * z - 1,
        );
        context.setLineDash([]);
        if (tool === "scale") {
          context.fillStyle = context.strokeStyle;
          context.fillRect(
            (b.x + b.width) * z - 6,
            (b.y + b.height) * z - 6,
            6,
            6,
          );
        }
      }
    }
    for (const [id, g, data] of [
      ["original-preview", original, undefined],
      ["edited-preview", current, pixels],
    ] as const) {
      const target = $<HTMLCanvasElement>(id),
        small = sourceCanvas(g, data);
      target.width = small.width;
      target.height = small.height;
      target.getContext("2d")!.drawImage(small, 0, 0);
    }
  }
  function pointer(event: PointerEvent) {
    const current = model.get().glyph;
    const r = canvas.getBoundingClientRect(),
      z = canvas.width / Math.max(1, current?.width ?? 1);
    return {
      x: Math.floor((event.clientX - r.left) / z),
      y: Math.floor((event.clientY - r.top) / z),
    };
  }
  function dot(x: number, y: number) {
    const current = model.get().glyph;
    if (
      stroke &&
      current &&
      x >= 0 &&
      y >= 0 &&
      x < current.width &&
      y < current.height
    )
      stroke.pixels[y * current.width + x] = stroke.value;
  }
  canvas.oncontextmenu = (event) => event.preventDefault();
  canvas.onpointerdown = (event) => {
    const current = model.get().glyph;
    if (
      !model.get().editable ||
      !current ||
      $<HTMLSelectElement>("view").value !== "edit" ||
      !current.width ||
      !current.height
    )
      return;
    if (stroke || gesture || event.button > 2) return;
    event.preventDefault();
    stage.focus();
    const p = pointer(event);
    if (tool === "move" || tool === "scale") {
      if (event.button !== 0) return;
      const raster = createRasterMutation(current),
        b = raster.bounds;
      if (!b) {
        $("coordinates").textContent =
          "Порожній растр — немає що трансформувати";
        return;
      }
      gesture = {
        before: structuredClone(current),
        raster,
        start: p,
        options: {
          dx: 0,
          dy: 0,
          width: b.width,
          height: b.height,
          anchor: $<HTMLSelectElement>("raster-anchor").value as Anchor,
        },
      };
      canvas.dataset.gesture = "true";
      canvas.setPointerCapture(event.pointerId);
      scheduleDraw();
      return;
    }
    stroke = {
      before: structuredClone(current),
      pixels: unpack(current),
      value: event.button === 2 || tool === "eraser" ? 0 : 1,
      ...p,
    };
    dot(p.x, p.y);
    canvas.setPointerCapture(event.pointerId);
    scheduleDraw();
  };
  canvas.onpointermove = (event) => {
    const p = pointer(event);
    $("coordinates").textContent = `x ${p.x} · y ${p.y}`;
    if (gesture) {
      const b = gesture.raster.bounds!,
        dx = p.x - gesture.start.x,
        dy = p.y - gesture.start.y;
      if (tool === "move") {
        gesture.options.dx = Math.max(-16384, Math.min(16384, dx));
        gesture.options.dy = Math.max(-16384, Math.min(16384, dy));
      } else {
        const multiplier = gesture.options.anchor === "top-left" ? 1 : 2;
        const ratio = Math.max(
          0.125,
          Math.min(
            8,
            1 +
              multiplier *
                (Math.abs(dx / b.width) >= Math.abs(dy / b.height)
                  ? dx / b.width
                  : dy / b.height),
          ),
        );
        const locked =
          $<HTMLInputElement>("raster-lock").checked && !event.shiftKey;
        const width = locked ? b.width * ratio : b.width + dx * multiplier;
        const height = locked ? b.height * ratio : b.height + dy * multiplier;
        gesture.options.width = Math.round(
          Math.max(1, b.width / 8, Math.min(b.width * 8, width)),
        );
        gesture.options.height = Math.round(
          Math.max(1, b.height / 8, Math.min(b.height * 8, height)),
        );
      }
      gesture.preview = undefined;
      const o = gesture.options;
      $("coordinates").textContent =
        `Зсув ${o.dx}, ${o.dy} · растр ${o.width}×${o.height}`;
      scheduleDraw();
    } else if (stroke) {
      line(stroke.x, stroke.y, p.x, p.y, dot);
      stroke.x = p.x;
      stroke.y = p.y;
      scheduleDraw();
    }
  };
  function finishStroke() {
    const current = model.get().glyph;
    if (gesture) {
      const active = gesture,
        preview = mutationPreview()!;
      gesture = undefined;
      delete canvas.dataset.gesture;
      const rows = pack(
        preview.pixels,
        active.before.width,
        active.before.height,
      );
      if (
        current?.id === active.before.id &&
        rows.some((row, i) => row !== active.before.rows[i])
      )
        model.commit({ ...active.before, rows });
      else draw();
      return;
    }
    if (!stroke) return;
    if (!current || current.id !== stroke.before.id) {
      stroke = undefined;
      return;
    }
    const after = {
      ...stroke.before,
      rows: pack(stroke.pixels, current.width, current.height),
    };
    stroke = undefined;
    model.commit(after);
  }
  canvas.onpointerup = (event) => {
    if (gesture) canvas.onpointermove?.call(canvas, event);
    finishStroke();
  };
  canvas.onpointercancel = () => cancel();
  canvas.onlostpointercapture = () => finishStroke();
  function cancel() {
    stroke = undefined;
    gesture = undefined;
    delete canvas.dataset.gesture;
    $("coordinates").textContent = "Дію скасовано";
    draw();
  }

  return {
    draw,
    fitZoom,
    scheduleDraw,
    finishStroke,
    setTool: (value: string) => {
      finishStroke();
      tool = value;
      canvas.dataset.tool = value;
      $("coordinates").textContent =
        value === "move"
          ? "Тягніть гліф · прив’язка до пікселів · Esc — скасувати"
          : value === "scale"
            ? "Тягніть ↘ для збільшення, ↖ для зменшення · Shift — вільні пропорції"
            : "ЛКМ — малювати · ПКМ — стирати";
      draw();
    },
    cancel,
  };
}
