import { transformed, unpack, type Glyph } from "./model";
import { transformName, type Proposal } from "./autofill";

const dialog = document.getElementById("geometry-dialog") as HTMLDialogElement;
export const choosingGeometry = () => dialog.open;

/** Geometric lookalikes require an explicit choice; the corpus supplies the pixels. */
export function chooseGeometry(proposals: Proposal[]): Promise<Proposal[]> {
  const list = document.getElementById("geometry-list")!;
  const apply = document.getElementById("geometry-apply") as HTMLButtonElement;
  const chosen = new Map<string, Proposal>();
  list.replaceChildren();
  apply.disabled = true;
  const groups = new Map<string, Proposal[]>();
  for (const p of proposals) groups.set(p.to, [...(groups.get(p.to) ?? []), p]);
  for (const [to, alternatives] of groups) {
    const group = document.createElement("fieldset"),
      legend = document.createElement("legend");
    legend.textContent = `Символ ${to}`;
    group.append(legend);
    function option(label: string, value?: Proposal) {
      const row = document.createElement("label"),
        input = document.createElement("input");
      row.className = "geometry-option";
      input.type = "radio";
      input.name = "geometry-" + to.codePointAt(0);
      input.value = value?.key ?? "skip";
      input.checked = !value;
      input.onchange = () => {
        if (value) chosen.set(to, value);
        else chosen.delete(to);
        apply.disabled = !chosen.size;
        apply.textContent = `Застосувати (${chosen.size})`;
      };
      const title = document.createElement("span");
      title.textContent = label;
      row.append(input, title);
      group.append(row);
      return row;
    }
    option("Пропустити");
    for (const p of alternatives) {
      const row = option(
        `${p.from} → ${p.to} · ${transformName[p.transform]}`,
        p,
      );
      const after = transformed(p.source, p.transform);
      const previews = document.createElement("div");
      previews.className = "geometry-previews";
      const z = Math.max(
        1,
        Math.min(
          12,
          Math.floor(
            120 /
              Math.max(
                p.source.width,
                p.source.height,
                after.width,
                after.height,
                1,
              ),
          ),
        ),
      );
      for (const [g, caption] of [
        [p.source, `Основа ${p.from}`],
        [after, `Результат ${p.to}`],
      ] as const) {
        const figure = document.createElement("figure"),
          text = document.createElement("figcaption");
        text.textContent = `${caption} · ${g.width}×${g.height} · shiftUp ${g.metrics.shiftUp}`;
        figure.append(preview(g, z), text);
        previews.append(figure);
      }
      row.append(previews);
    }
    list.append(group);
  }
  apply.textContent = "Застосувати (0)";
  dialog.returnValue = "cancel";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        resolve(dialog.returnValue === "apply" ? [...chosen.values()] : []);
        list.replaceChildren();
      },
      { once: true },
    );
  });
}
function preview(g: Glyph, z: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, g.width * z);
  canvas.height = Math.max(1, g.height * z);
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#eee9d7";
  const pixels = unpack(g);
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++)
      if (pixels[y * g.width + x]) c.fillRect(x * z, y * z, z, z);
  const baseline = (g.height + g.metrics.shiftUp) * z;
  if (baseline >= 0 && baseline <= canvas.height) {
    c.fillStyle = "#d4b76e88";
    c.fillRect(0, Math.max(0, baseline - 1), canvas.width, 1);
  }
  return canvas;
}
