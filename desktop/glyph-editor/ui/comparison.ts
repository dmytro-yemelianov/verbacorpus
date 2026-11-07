import type { Glyph } from "./model";
import { glyphCaption } from "./regions";
export function comparisonOffset(
  target: Glyph,
  reference: Glyph,
  alignment: string,
  dx = 0,
  dy = 0,
) {
  return alignment === "raster"
    ? { x: dx, y: dy }
    : {
        x: reference.metrics.leftBearing - target.metrics.leftBearing + dx,
        y:
          target.height +
          target.metrics.shiftUp -
          reference.height -
          reference.metrics.shiftUp +
          dy,
      };
}
/** Comparison is a read-only snapshot, never a document mutation. */
export function createComparison(options: {
  get: () => { fontId?: string; current?: Glyph; busy: boolean };
  resolve: (query: string) => Promise<Glyph | undefined>;
  changed: () => void;
  error: (reason: unknown) => void;
}) {
  const $ = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  let pinned: Glyph | undefined;
  let revision = 0;
  function render() {
    $("comparison-status").textContent = pinned
      ? `Знімок: ${glyphCaption(undefined, pinned)} · ${pinned.id} · ${pinned.width}×${pinned.height}`
      : "Додайте гліф цього шрифту як підкладку.";
    $("comparison-controls").hidden = !pinned;
    $("comparison-remove").hidden = !pinned;
    options.changed();
  }
  function pin(value: Glyph) {
    pinned = structuredClone(value);
    $<HTMLInputElement>("comparison-visible").checked = true;
    render();
  }
  $("comparison-current").onclick = () => {
    if (options.get().busy) return;
    const current = options.get().current;
    ++revision;
    if (current) pin(current);
  };
  $<HTMLFormElement>("comparison-form").onsubmit = (event) => {
    event.preventDefault();
    if (options.get().busy) return;
    const token = ++revision,
      fontId = options.get().fontId;
    void options
      .resolve($<HTMLInputElement>("comparison-query").value)
      .then((value) => {
        if (token !== revision || options.get().fontId !== fontId) return;
        if (!value) throw new Error("Немає такого гліфа в поточному шрифті.");
        pin(value);
      })
      .catch(options.error);
  };
  $("comparison-remove").onclick = () => {
    ++revision;
    pinned = undefined;
    render();
  };
  for (const id of [
    "comparison-visible",
    "comparison-opacity",
    "comparison-alignment",
    "comparison-dx",
    "comparison-dy",
  ])
    $(id).oninput = () => {
      $("comparison-opacity-value").textContent =
        $<HTMLInputElement>("comparison-opacity").value + "%";
      options.changed();
    };
  return {
    pin(value: Glyph) {
      if (!options.get().busy) {
        ++revision;
        pin(value);
      }
    },
    reset() {
      ++revision;
      pinned = undefined;
      $<HTMLInputElement>("comparison-query").value = "";
      for (const id of ["comparison-dx", "comparison-dy"])
        $<HTMLInputElement>(id).value = "0";
      render();
    },
    get() {
      const dx = Number($<HTMLInputElement>("comparison-dx").value),
        dy = Number($<HTMLInputElement>("comparison-dy").value);
      return pinned && $<HTMLInputElement>("comparison-visible").checked
        ? {
            glyph: pinned,
            opacity: Math.max(
              0,
              Math.min(
                1,
                Number($<HTMLInputElement>("comparison-opacity").value) / 100,
              ),
            ),
            alignment: $<HTMLSelectElement>("comparison-alignment").value,
            dx: Number.isFinite(dx)
              ? Math.max(-16384, Math.min(16384, Math.round(dx)))
              : 0,
            dy: Number.isFinite(dy)
              ? Math.max(-16384, Math.min(16384, Math.round(dy)))
              : 0,
          }
        : undefined;
    },
  };
}
