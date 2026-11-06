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
    const pixels =
      stroke?.pixels ?? (current ? unpack(current) : new Uint8Array());
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
        view === "original" ? undefined : (stroke?.pixels ?? pixels),
      );
    if (view === "diff" && original) {
      const before = unpack(original),
        image = source
          .getContext("2d")!
          .getImageData(0, 0, source.width, source.height),
        live = stroke?.pixels ?? pixels;
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
    for (const [id, g, data] of [
      ["original-preview", original, undefined],
      ["edited-preview", current, stroke?.pixels ?? pixels],
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
    event.preventDefault();
    stage.focus();
    const p = pointer(event);
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
    if (stroke) {
      line(stroke.x, stroke.y, p.x, p.y, dot);
      stroke.x = p.x;
      stroke.y = p.y;
      scheduleDraw();
    }
  };
  function finishStroke() {
    const current = model.get().glyph;
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
  canvas.onpointerup = () => finishStroke();
  canvas.onpointercancel = () => finishStroke();

  return {
    draw,
    fitZoom,
    scheduleDraw,
    finishStroke,
    setTool: (value: string) => {
      tool = value;
    },
    cancel: () => {
      stroke = undefined;
      draw();
    },
  };
}
