import { BORDERS, type Border } from "./shader/embroidery";

const LIGHT = { bg: "#f4f1e8", red: "#b4232a", ink: "#1a1a1a" };
const DARK = { bg: "#191c16", red: "#d8aa54", ink: "#e9e5d8" };
const CELL = 8; // px per stitch in the intrinsic SVG (background-size scales it)

// One tileable band as an SVG data-URI: a background rect (linen/paper) plus one
// <rect> per non-empty stitch. encodeURIComponent keeps it valid inside CSS url().
export function bandSVG(b: Border, light: boolean): string {
  const p = light ? LIGHT : DARK;
  const W = b.cols * CELL, H = b.rows * CELL;
  let rects = "";
  for (let r = 0; r < b.rows; r++) {
    const row = b.cells[r];
    for (let c = 0; c < b.cols; c++) {
      const ch = row[c];
      if (ch === ".") continue; // linen = background
      const fill = ch === "R" ? p.red : p.ink;
      rects += `<rect x='${c * CELL}' y='${r * CELL}' width='${CELL}' height='${CELL}' fill='${fill}'/>`;
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' shape-rendering='crispEdges'><rect width='${W}' height='${H}' fill='${p.bg}'/>${rects}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ---- Cross-stitch UI icons (same --emb-stitch as the bands) ----
// '.' = transparent (icons sit on varied surfaces — no background rect),
// 'R' = red→gold, 'B' = ink→thread. Each is a small stitch matrix.
export type Icon = { rows: number; cols: number; cells: readonly string[] };

const ICONS: Record<string, Icon> = {
  heart: { rows: 6, cols: 7, cells: [".RR.RR.", "RRRRRRR", "RRRRRRR", ".RRRRR.", "..RRR..", "...R..."] },
  link: { rows: 6, cols: 7, cells: ["..BBBBB", "....BBB", "...B.BB", "..B..B.", ".B.....", "B......"] },
  image: { rows: 9, cols: 9, cells: ["BBBBBBBBB", "B.......B", "B.RR....B", "B.RR....B", "B.......B", "B....B..B", "B...BBB.B", "B..BBBBBB", "BBBBBBBBB"] },
  moon: { rows: 7, cols: 7, cells: ["..BBB..", ".BB....", "BB.....", "BB.....", "BB.....", ".BB....", "..BBB.."] },
  sun: { rows: 7, cols: 7, cells: ["...R...", ".R.R.R.", "..RRR..", "RRRRRRR", "..RRR..", ".R.R.R.", "...R..."] },
  search: { rows: 8, cols: 8, cells: [".BBBB...", "BB..BB..", "B....B..", "B....B..", "BB..BB..", ".BBBBB..", "....BBB.", ".....BBB"] },
  check: { rows: 6, cols: 7, cells: ["......R", ".....RR", "R...RR.", "RR.RR..", ".RRR...", "..R...."] },
  leaf: { rows: 7, cols: 7, cells: ["...B...", "..BRB..", ".BRRRB.", ".BRRRB.", ".BRRRB.", "..BRB..", "...B..."] },
};

// An icon as a transparent-background SVG data-URI (only the stitch cells drawn).
export function iconSVG(ic: Icon, light: boolean): string {
  const p = light ? LIGHT : DARK;
  const W = ic.cols * CELL, H = ic.rows * CELL;
  let rects = "";
  for (let r = 0; r < ic.rows; r++) {
    const row = ic.cells[r];
    for (let c = 0; c < ic.cols; c++) {
      const ch = row[c];
      if (ch === ".") continue;
      const fill = ch === "R" ? p.red : p.ink;
      rects += `<rect x='${c * CELL}' y='${r * CELL}' width='${CELL}' height='${CELL}' fill='${fill}'/>`;
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' shape-rendering='crispEdges'>${rects}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const TOKENS: Record<"a" | "b" | "c", string> = {
  a: "upa_2c1afca8547010f7",
  b: "upa_a83394df6ae60276",
  c: "upa_6cdef2752bd9b5fb",
};

function byId(id: string): Border {
  const b = BORDERS.find((x) => x.id === id);
  if (!b) throw new Error(`embroidery token not found: ${id}`);
  return b;
}

// Transpose a horizontal repeat-unit into a vertical one (for grid spines /
// side-bands that tile down the page). new[c][r] = old[r][c]; dims swap.
function transpose(b: Border): Border {
  const cells: string[] = [];
  for (let c = 0; c < b.cols; c++) {
    let row = "";
    for (let r = 0; r < b.rows; r++) row += b.cells[r][c];
    cells.push(row);
  }
  return { id: b.id + "-v", rows: b.cols, cols: b.rows, cells };
}

// Global stitch (cell) size in px — the SINGLE source of truth so every band and
// icon across the site renders stitches at the same physical size.
const STITCH_PX = 3;

// Full generated stylesheet: band + icon custom properties on :root (light),
// overridden for dark (manual [data-theme="dark"] and auto prefers-color-scheme,
// mirroring styles.css), plus --emb-stitch, per-token rows, and .emb-ico-* classes.
export function embroideryCss(): string {
  const bandKeys = Object.keys(TOKENS) as Array<keyof typeof TOKENS>;
  const iconKeys = Object.keys(ICONS);

  // theme-dependent custom properties (bands + icons)
  const vars = (light: boolean) =>
    [
      ...bandKeys.map((k) => `  --emb-${k}: url("${bandSVG(byId(TOKENS[k]), light)}");`),
      `  --emb-bv: url("${bandSVG(transpose(byId(TOKENS.b)), light)}");`, // vertical spine
      ...iconKeys.map((k) => `  --ico-${k}: url("${iconSVG(ICONS[k], light)}");`),
    ].join("\n");

  // theme-independent metadata
  const meta = `  --emb-stitch: ${STITCH_PX}px;\n` +
    bandKeys.map((k) => `  --emb-${k}-rows: ${byId(TOKENS[k]).rows};`).join("\n");

  // icon utility classes: shared base + per-icon size (cols×stitch, rows×stitch)
  const iconClasses =
    `.emb-ico { display: inline-block; background: no-repeat center / contain; vertical-align: -0.18em; }\n` +
    iconKeys
      .map((k) => `.emb-ico-${k} { width: calc(${ICONS[k].cols} * var(--emb-stitch)); height: calc(${ICONS[k].rows} * var(--emb-stitch)); background-image: var(--ico-${k}); }`)
      .join("\n");

  const dark = vars(false);
  return `/* GENERATED by build_embroidery (see src/embroidery-css.ts) — do not edit. */
:root {
${meta}
${vars(true)}
}
:root[data-theme="dark"] {
${dark}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${dark}
  }
}
${iconClasses}
`;
}
