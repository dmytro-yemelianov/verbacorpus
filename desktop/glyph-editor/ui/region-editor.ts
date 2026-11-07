import { dragScaledSize, type ScaleAxis, type Anchor } from "./raster-mutation";
import { native } from "./bridge";
import { type Glyph } from "./model";
import {
  rectangleMask,
  lassoMask,
  maskBounds,
  extractRegion,
  placeRegion,
  eraseRegion,
  scaledRegion,
  mirroredRegion,
  serializeRegion,
  parseRegion,
  type Point,
  type PixelRegion,
  type RegionOrigin,
} from "./pixel-regions";

export function createRegionEditor(host: {
  get: () => {
    glyph?: Glyph;
    key: string;
    editable: boolean;
    origin?: RegionOrigin;
  };
  commit: (glyph: Glyph, origin?: RegionOrigin) => void;
  changed: () => void;
}) {
  let key = "",
    last: Glyph | undefined,
    mask: Uint8Array = new Uint8Array(),
    own = false;
  let drawing:
    | {
        tool: string;
        start: Point;
        end: Point;
        points: Point[];
        previous: Uint8Array;
      }
    | undefined;
  let floating:
    | {
        before: Glyph;
        region: PixelRegion;
        x: number;
        y: number;
        clear?: Uint8Array;
        kind: "paste" | "move";
        origin?: RegionOrigin;
      }
    | undefined;
  let drag:
    | {
        start: Point;
        x: number;
        y: number;
        region: PixelRegion;
        tool: string;
        axis: ScaleAxis;
      }
    | undefined;
  let cache: ReturnType<typeof placeRegion> | undefined;
  const $ = (id: string) => document.getElementById(id)!;
  const transparent = () =>
    ($("region-transparent") as HTMLInputElement).checked;
  function sync() {
    const state = host.get();
    if (state.key !== key || (!own && state.glyph !== last)) {
      mask = new Uint8Array(
        state.glyph ? state.glyph.width * state.glyph.height : 0,
      );
      drawing = undefined;
      floating = undefined;
      drag = undefined;
      cache = undefined;
    }
    key = state.key;
    last = state.glyph;
    return state;
  }
  function update() {
    cache = undefined;
    host.changed();
  }
  function preview() {
    const { glyph } = sync();
    if (!glyph) return;
    if (drawing)
      mask =
        drawing.tool === "rect"
          ? rectangleMask(glyph.width, glyph.height, drawing.start, drawing.end)
          : lassoMask(glyph.width, glyph.height, drawing.points);
    if (floating && !cache)
      cache = placeRegion(
        floating.before,
        floating.region,
        floating.x,
        floating.y,
        transparent(),
        floating.clear,
      );
    if (cache) mask = cache.mask;
    return cache;
  }
  function publish(glyph: Glyph, origin?: RegionOrigin) {
    own = true;
    try {
      host.commit(glyph, origin);
    } finally {
      own = false;
    }
    last = host.get().glyph;
  }
  function finish() {
    preview();
    drawing = undefined;
    drag = undefined;
    if (floating) {
      const result = cache!,
        origin = floating.origin,
        before = floating.before,
        pasted = floating.kind === "paste";
      floating = undefined;
      cache = undefined;
      mask = result.mask;
      if (pasted || result.glyph.rows.some((row, i) => row !== before.rows[i]))
        publish(result.glyph, origin);
    }
    host.changed();
  }
  function cancel() {
    if (drawing) mask = drawing.previous;
    else if (floating)
      mask = new Uint8Array(
        host.get().glyph
          ? host.get().glyph!.width * host.get().glyph!.height
          : 0,
      );
    else mask.fill(0);
    drawing = undefined;
    floating = undefined;
    drag = undefined;
    update();
  }
  function selected() {
    preview();
    return !!maskBounds(mask, host.get().glyph?.width ?? 0);
  }
  function lift() {
    const state = sync();
    if (!state.glyph) return false;
    preview();
    if (floating) return true;
    const extracted = extractRegion(state.glyph, mask, state.origin);
    if (!extracted) return false;
    floating = {
      before: structuredClone(state.glyph),
      ...extracted,
      clear: mask.slice(),
      kind: "move",
    };
    return true;
  }
  function clamped(x: number, y: number, region: PixelRegion) {
    const g = host.get().glyph!;
    return {
      x: Math.max(
        0,
        Math.min(Math.max(0, g.width - region.width), Math.round(x)),
      ),
      y: Math.max(
        0,
        Math.min(Math.max(0, g.height - region.height), Math.round(y)),
      ),
    };
  }
  function pointerDown(tool: string, p: Point) {
    const state = sync();
    if (!state.editable || !state.glyph) return false;
    preview();
    const inside =
      p.x >= 0 &&
      p.y >= 0 &&
      p.x < state.glyph.width &&
      p.y < state.glyph.height &&
      !!mask[p.y * state.glyph.width + p.x];
    if (
      (tool === "move" ||
        tool === "scale" ||
        ((tool === "rect" || tool === "lasso") && inside)) &&
      selected()
    ) {
      if (!lift()) return false;
      drag = {
        start: p,
        x: floating!.x,
        y: floating!.y,
        region: floating!.region,
        tool,
        axis: ($("scale-axis") as HTMLSelectElement).value as ScaleAxis,
      };
      return true;
    }
    if (tool !== "rect" && tool !== "lasso") return false;
    finish();
    drawing = { tool, start: p, end: p, points: [p], previous: mask.slice() };
    update();
    return true;
  }
  function pointerMove(p: Point, free: boolean) {
    const g = host.get().glyph;
    if (!g) return;
    if (drawing) {
      drawing.end = p;
      const last = drawing.points.at(-1)!;
      if ((last.x !== p.x || last.y !== p.y) && drawing.points.length < 8192)
        drawing.points.push(p);
      update();
    } else if (drag && floating) {
      const dx = p.x - drag.start.x,
        dy = p.y - drag.start.y;
      if (drag.tool === "scale") {
        const b = drag.region;
        const anchor = ($("raster-anchor") as HTMLSelectElement)
          .value as Anchor;
        const { width, height } = dragScaledSize(
          b,
          { x: dx, y: dy },
          {
            axis: drag.axis,
            anchor,
            locked: ($("raster-lock") as HTMLInputElement).checked && !free,
            maxWidth: g.width,
            maxHeight: g.height,
            maxArea: 262144,
          },
        );
        floating.region = scaledRegion(b, width, height);
        const x =
          anchor === "top-left" ? drag.x : drag.x + (b.width - width) / 2;
        const baseline = g.height + g.metrics.shiftUp;
        const y =
          anchor === "top-left"
            ? drag.y
            : anchor === "baseline"
              ? baseline - ((baseline - drag.y) * height) / b.height
              : drag.y + (b.height - height) / 2;
        Object.assign(floating, clamped(x, y, floating.region));
      } else
        Object.assign(
          floating,
          clamped(drag.x + dx, drag.y + dy, floating.region),
        );
      update();
    }
  }
  function mirror(axis: "h" | "v") {
    const state = sync();
    if (!state.editable || !selected() || !lift()) return false;
    floating!.region = mirroredRegion(floating!.region, axis);
    update();
    if (floating!.kind !== "paste") finish();
    return true;
  }
  function applyMutation(options: {
    dx: number;
    dy: number;
    sx: number;
    sy: number;
    anchor: Anchor;
    axis: ScaleAxis;
  }) {
    const state = sync();
    if (!state.editable || !state.glyph || !selected() || !lift()) return false;
    if (
      ![options.dx, options.dy].every(
        (n) => Number.isInteger(n) && Math.abs(n) <= 16384,
      )
    )
      throw new Error("Зсув має бути цілим, до 16384 px");
    const f = floating!,
      b = f.region,
      multiplier = options.anchor === "top-left" ? 1 : 2;
    const { width, height } = dragScaledSize(
      b,
      {
        x: (b.width * (options.sx / 100 - 1)) / multiplier,
        y: (b.height * (options.sy / 100 - 1)) / multiplier,
      },
      {
        axis: options.axis,
        anchor: options.anchor,
        locked: ($("raster-lock") as HTMLInputElement).checked,
        maxWidth: state.glyph.width,
        maxHeight: state.glyph.height,
        maxArea: 262144,
      },
    );
    f.region = scaledRegion(b, width, height);
    const baseline = state.glyph.height + state.glyph.metrics.shiftUp;
    const x =
      f.x +
      (options.anchor === "top-left" ? 0 : (b.width - width) / 2) +
      options.dx;
    const y =
      (options.anchor === "top-left"
        ? f.y
        : options.anchor === "baseline"
          ? baseline - ((baseline - f.y) * height) / b.height
          : f.y + (b.height - height) / 2) + options.dy;
    Object.assign(f, clamped(x, y, f.region));
    update();
    finish();
    return true;
  }
  function pointerUp() {
    if (drawing) {
      preview();
      drawing = undefined;
      host.changed();
    } else if (drag) finish();
  }
  function nudge(dx: number, dy: number) {
    const state = sync();
    if (!state.editable || !selected() || !lift()) return false;
    Object.assign(
      floating!,
      clamped(floating!.x + dx, floating!.y + dy, floating!.region),
    );
    update();
    return true;
  }
  function finishNudge() {
    if (floating?.kind === "move" && !drag) finish();
  }
  async function action(value: string) {
    let state = sync();
    if (!state.editable || !state.glyph) return;
    if (value === "deselect") {
      finish();
      mask.fill(0);
      update();
      return;
    }
    if (value === "apply-selection") {
      finish();
      return;
    }
    if (value === "selectAll") {
      finish();
      mask = new Uint8Array(state.glyph.width * state.glyph.height).fill(1);
      update();
      return;
    }
    if (value === "delete-selection") {
      if (floating?.kind === "paste") {
        cancel();
        return;
      }
      finish();
      state = sync();
      if (selected()) {
        publish(eraseRegion(state.glyph!, mask));
        update();
      }
      return;
    }
    if (value === "paste") {
      const before = state.glyph,
        keyBefore = state.key;
      const text = await native<string | null>("readClipboard");
      if (
        host.get().key !== keyBefore ||
        host.get().glyph !== before ||
        !host.get().editable
      )
        return;
      if (!text) throw new Error("Буфер обміну порожній");
      const region = parseRegion(text);
      finish();
      state = sync();
      if (!state.glyph?.width || !state.glyph.height)
        throw new Error("Задайте розмір комірки перед вставленням");
      const b = maskBounds(mask, state.glyph.width);
      const y = region.origin?.rectangle?.y ?? 0;
      const baseline = region.origin?.baseline;
      const position = clamped(
        b?.x ?? region.origin?.rectangle?.x ?? 0,
        b?.y ??
          y +
            (baseline === undefined
              ? 0
              : state.glyph.height + state.glyph.metrics.shiftUp - baseline),
        region,
      );
      floating = {
        before: structuredClone(state.glyph),
        region,
        ...position,
        kind: "paste",
        origin: region.origin,
      };
      update();
      return;
    }
    if (value === "copy" || value === "cut") {
      const image = preview()?.glyph ?? state.glyph;
      if (!selected())
        mask = new Uint8Array(image.width * image.height).fill(1);
      const extracted = extractRegion(image, mask, state.origin);
      if (!extracted) return;
      const before = state.glyph,
        keyBefore = state.key;
      await native("writeClipboard", {
        text: serializeRegion(extracted.region),
      });
      if (
        host.get().key !== keyBefore ||
        host.get().glyph !== before ||
        !host.get().editable
      )
        return;
      if (value === "cut") {
        if (floating?.kind === "paste") {
          cancel();
          return;
        }
        finish();
        publish(eraseRegion(host.get().glyph!, mask));
      }
      host.changed();
    }
  }
  function paint(context: CanvasRenderingContext2D, z: number) {
    const state = sync();
    if (!state.glyph) return;
    preview();
    const b = maskBounds(mask, state.glyph.width);
    $("region-status").textContent = b
      ? `${b.width}×${b.height} · x ${b.x}, y ${b.y}${floating ? " · Enter — закріпити, Esc — скасувати" : ""}`
      : "Немає виділення";
    ($("region-apply") as HTMLButtonElement).disabled = !floating;
    if (!b) return;
    const overlay = document.createElement("canvas");
    overlay.width = state.glyph.width;
    overlay.height = state.glyph.height;
    const ctx = overlay.getContext("2d")!,
      data = ctx.createImageData(overlay.width, overlay.height);
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) data.data.set([90, 170, 240, 55], i * 4);
    ctx.putImageData(data, 0, 0);
    context.drawImage(overlay, 0, 0, overlay.width * z, overlay.height * z);
    context.save();
    context.strokeStyle = "#8ac7ff";
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    const w = state.glyph.width,
      h = state.glyph.height;
    for (let y = b.y; y < b.y + b.height; y++)
      for (let x = b.x; x < b.x + b.width; x++)
        if (mask[y * w + x]) {
          if (y === 0 || !mask[(y - 1) * w + x]) {
            context.moveTo(x * z, y * z + 0.5);
            context.lineTo((x + 1) * z, y * z + 0.5);
          }
          if (y === h - 1 || !mask[(y + 1) * w + x]) {
            context.moveTo(x * z, (y + 1) * z - 0.5);
            context.lineTo((x + 1) * z, (y + 1) * z - 0.5);
          }
          if (x === 0 || !mask[y * w + x - 1]) {
            context.moveTo(x * z + 0.5, y * z);
            context.lineTo(x * z + 0.5, (y + 1) * z);
          }
          if (x === w - 1 || !mask[y * w + x + 1]) {
            context.moveTo((x + 1) * z - 0.5, y * z);
            context.lineTo((x + 1) * z - 0.5, (y + 1) * z);
          }
        }
    context.stroke();
    context.restore();
  }
  return {
    sync,
    preview,
    paint,
    selected,
    pointerDown,
    pointerMove,
    pointerUp,
    nudge,
    finishNudge,
    mirror,
    applyMutation,
    finish,
    cancel,
    action,
    active: () => !!drawing || !!drag,
    pending: () => !!floating,
    invalidate: update,
    deselect: () => {
      finish();
      mask.fill(0);
      update();
    },
  };
}
