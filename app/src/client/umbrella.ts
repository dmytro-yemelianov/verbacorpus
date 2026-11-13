interface Glyph { character: string; advanceX: number; rows: string[] }
interface Font { cell: { width: number; height: number }; glyphData: Glyph[] }

async function specimen(): Promise<void> {
  if (!document.querySelector("[data-font-specimen]")) return;
  const input = document.querySelector<HTMLInputElement>("#font-text")!;
  const scaleInput = document.querySelector<HTMLInputElement>("#font-scale")!;
  const canvas = document.querySelector<HTMLCanvasElement>("#font-canvas")!;
  const status = document.getElementById("font-status")!;
  try {
    const response = await fetch(location.hostname === 'para.verbacorpus.org' ? '/font.json' : '/para/font.json');
    if (!response.ok) throw new Error("Font unavailable");
    const font: Font = await response.json();
    const glyphs = new Map(font.glyphData.map(g => [g.character, g]));
    const draw = () => {
      const scale = Number(scaleInput.value);
      const chars = Array.from(input.value).slice(0, 80);
      canvas.width = Math.max(font.cell.width, chars.reduce((n, c) => n + (glyphs.get(c)?.advanceX ?? font.cell.width) + 1, 0)) * scale;
      canvas.height = (font.cell.height + 4) * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.imageSmoothingEnabled = false;
      const ink = getComputedStyle(document.body).color;
      const missing = new Set<string>();
      let left = 0;
      for (const char of chars) {
        const glyph = glyphs.get(char);
        if (glyph) {
          ctx.fillStyle = ink;
          const bits = Math.ceil(font.cell.width / 8) * 8;
          glyph.rows.forEach((row, y) => {
            const value = parseInt(row, 16);
            for (let x = 0; x < font.cell.width; x++) if (value & (1 << (bits - 1 - x))) ctx.fillRect((left + x) * scale, (y + 2) * scale, scale, scale);
          });
        } else {
          missing.add(char);
          ctx.strokeStyle = "#b4232a";
          ctx.lineWidth = scale;
          ctx.strokeRect((left + 1) * scale, 3 * scale, (font.cell.width - 3) * scale, (font.cell.height - 2) * scale);
        }
        left += (glyph?.advanceX ?? font.cell.width) + 1;
      }
      canvas.setAttribute("aria-label", `Растровий зразок: ${input.value}`);
      status.textContent = missing.size ? `У цьому зразку відсутні: ${[...missing].join(" ")}. Позначено червоними рамками.` : "Усі символи є в зразку. Кожна клітинка відтворена без згладжування.";
    };
    input.addEventListener("input", draw);
    scaleInput.addEventListener("input", draw);
    document.addEventListener("verba-theme", draw);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
    draw();
  } catch {
    status.textContent = "Не вдалося завантажити зразок. Спробуйте оновити сторінку або завантажте JSON нижче.";
  }
}
void specimen();
