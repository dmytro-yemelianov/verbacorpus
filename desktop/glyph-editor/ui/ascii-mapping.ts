import { codepoint, unpack, type Glyph, type GlyphEdit } from "./model";

/** Numeric source codes are not Unicode. This proposal is applied only after
 * the user checks the preview and explicitly chooses an ASCII interpretation. */
export function asciiMapping(
  glyphs: Glyph[],
  index: Map<string, string[]>,
): GlyphEdit[] {
  const candidates = new Map<number, Glyph[]>();
  for (const g of glyphs) {
    if (g.labels.some((l) => l.kind === "unicode")) continue;
    const codes = [
      ...new Set(
        g.labels
          .filter(
            (l) =>
              l.kind === "codepoint" && /^(0x[0-9a-f]+|[0-9]+)$/i.test(l.value),
          )
          .map((l) => Number(l.value)),
      ),
    ];
    if (codes.length !== 1 || codes[0] < 32 || codes[0] > 126) continue;
    candidates.set(codes[0], [...(candidates.get(codes[0]) ?? []), g]);
  }
  return [...candidates]
    .sort(([a], [b]) => a - b)
    .flatMap(([code, gs]) => {
      const char = String.fromCharCode(code);
      if (gs.length !== 1 || index.get(char)?.length) return [];
      const source = gs[0];
      return [
        {
          id: source.id,
          source,
          glyph: {
            ...structuredClone(source),
            character: char,
            codepoint: codepoint(char),
            labels: [...source.labels, { kind: "unicode", value: char }],
          },
        },
      ];
    });
}
export function chooseAsciiMapping(edits: GlyphEdit[]): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "ascii-map-dialog";
    const title = document.createElement("h2"),
      help = document.createElement("p"),
      preview = document.createElement("div"),
      cancel = document.createElement("button"),
      apply = document.createElement("button");
    title.textContent = "Інтерпретувати коди 0x20–0x7E як ASCII?";
    help.textContent = `Перевірте відповідність знаків підписам. Буде додано ${edits.length} Unicode-відповідників. Пікселі, метрики та вихідні коди збережуться. Неоднозначні коди пропущено. Дію можна скасувати через Undo.`;
    preview.className = "ascii-map-preview";
    for (const edit of edits) {
      const g = edit.glyph!;
      if (!/[A-Za-z0-9!?]/.test(g.character!)) continue;
      const tile = document.createElement("div"),
        label = document.createElement("small"),
        canvas = document.createElement("canvas");
      const z = Math.max(
        1,
        Math.min(4, Math.floor(64 / Math.max(g.width, g.height))),
      );
      canvas.width = g.width * z;
      canvas.height = g.height * z;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "#eee9d7";
      unpack(g).forEach((v, i) => {
        if (v) c.fillRect((i % g.width) * z, Math.floor(i / g.width) * z, z, z);
      });
      label.textContent = `${g.character} · ${g.sourceCode?.value ?? ""}`;
      tile.append(canvas, label);
      preview.append(tile);
    }
    cancel.textContent = "Скасувати";
    apply.textContent = `Додати мапу · ${edits.length}`;
    apply.disabled = !edits.length;
    apply.className = "primary";
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.onclick = () => finish(false);
    apply.onclick = () => finish(true);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    dialog.onclose = () => finish(false);
    dialog.append(title, help, preview, cancel, apply);
    document.body.append(dialog);
    dialog.showModal();
  });
}
