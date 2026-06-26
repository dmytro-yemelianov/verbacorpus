import qrcode from "qrcode-generator";

function make(text: string) {
  const qr = qrcode(0, "M"); // type 0 = auto-fit, error-correction level M
  qr.addData(text);
  qr.make();
  return qr;
}

export function qrMatrix(text: string): boolean[][] {
  const qr = make(text);
  const n = qr.getModuleCount();
  const out: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    out.push(row);
  }
  return out;
}

export function qrSvg(text: string, opts: { module?: number; margin?: number; dark?: string; light?: string; width?: number; height?: number; rx?: number; ry?: number; style?: string } = {}): string {
  const module = opts.module ?? 4, margin = opts.margin ?? 4;
  const dark = opts.dark ?? "#5e7355";
  const light = opts.light ?? "transparent";
  const m = qrMatrix(text);
  const n = m.length;
  const dim = (n + margin * 2) * module;
  const w = opts.width ?? dim;
  const h = opts.height ?? dim;
  const rx = opts.rx ?? module / 3.5;
  const ry = opts.ry ?? rx;
  const styleAttr = opts.style ? ` style="${opts.style}"` : ` style="width:${w}px;height:${h}px;display:flex;"`;
  let rects = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) {
    const x = (c + margin) * module, y = (r + margin) * module;
    rects += `<rect x="${x}" y="${y}" width="${module}" height="${module}" rx="${rx}" ry="${ry}"/>`;
  }
  const bg = light !== "transparent" ? `<rect width="${dim}" height="${dim}" fill="${light}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"${styleAttr} viewBox="0 0 ${dim} ${dim}">` +
    `${bg}<g fill="${dark}">${rects}</g></svg>`;
}

export function qrDataUri(text: string, opts?: Parameters<typeof qrSvg>[1]): string {
  // QR SVG is ASCII-only, so btoa is safe (available in the Workers runtime + vitest pool)
  return "data:image/svg+xml;base64," + btoa(qrSvg(text, opts));
}
