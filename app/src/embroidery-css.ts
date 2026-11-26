import { UPA_PALETTE } from "./shared/upa-palette";
import { CARD_FRAMES, fetchBand } from "./card/ornament";

const PAPER = { light: "#f4f1e8", dark: "#191c16" }; // UPA colour B = paper
const LIGHT = { red: "#b4232a", ink: "#1a1a1a" };    // UI icon threads
const DARK = { red: "#d8aa54", ink: "#e9e5d8" };
const CELL = 8; // px per stitch in the intrinsic SVG (background-size scales it)

export type Border = { readonly id: string; readonly rows: number; readonly cols: number; readonly cells: readonly string[][] };

const hex = (c: readonly number[]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

// One tileable band as an SVG data-URI: paper rect plus one <rect> per stitch in the UPA
// palette (A,C-G; B = background).
export function bandSVG(b: Border, light: boolean): string {
  const W = b.cols * CELL, H = b.rows * CELL;
  let rects = "";
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const ch = b.cells[r][c];
      if (ch === "B" || !(ch in UPA_PALETTE)) continue;
      rects += `<rect x='${c * CELL}' y='${r * CELL}' width='${CELL}' height='${CELL}' fill='${hex(UPA_PALETTE[ch as keyof typeof UPA_PALETTE])}'/>`;
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' shape-rendering='crispEdges'><rect width='${W}' height='${H}' fill='${light ? PAPER.light : PAPER.dark}'/>${rects}</svg>`;
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

const TOKEN_FRAMES = CARD_FRAMES.slice(0, 3);
const TOKEN_KEYS = ["a", "b", "c"] as const;

// Transpose a horizontal repeat-unit into a vertical one (grid spines / side-bands).
export function transpose(b: Border): Border {
  const cells: string[][] = [];
  for (let c = 0; c < b.cols; c++) cells.push(b.cells.map((row) => row[c]));
  return { id: b.id + "-v", rows: b.cols, cols: b.rows, cells };
}

// Global stitch (cell) size in px — one source of truth for bands and icons.
const STITCH_PX = 3;

// Stylesheet: UI icon vars + classes always; band vars only when `bands` (a/b/c) are given.
export function embroideryCss(bands?: Record<"a" | "b" | "c", Border> | null): string {
  const iconKeys = Object.keys(ICONS);
  const vars = (light: boolean) =>
    [
      ...(bands ? [
        ...TOKEN_KEYS.map((k) => `  --emb-${k}: url("${bandSVG(bands[k], light)}");`),
        `  --emb-bv: url("${bandSVG(transpose(bands.b), light)}");`,
      ] : []),
      ...iconKeys.map((k) => `  --ico-${k}: url("${iconSVG(ICONS[k], light)}");`),
    ].join("\n");
  const meta = [`  --emb-stitch: ${STITCH_PX}px;`, ...(bands ? TOKEN_KEYS.map((k) => `  --emb-${k}-rows: ${bands[k].rows};`) : [])].join("\n");
  const iconClasses =
    `.emb-ico { display: inline-block; background: no-repeat center / contain; vertical-align: -0.18em; }\n` +
    iconKeys
      .map((k) => `.emb-ico-${k} { width: calc(${ICONS[k].cols} * var(--emb-stitch)); height: calc(${ICONS[k].rows} * var(--emb-stitch)); background-image: var(--ico-${k}); }`)
      .join("\n");
  const dark = vars(false);
  return `/* GENERATED by the Worker (src/embroidery-css.ts) from UPA bands — do not edit. */
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

// GET /embroidery.css — bands from UPA; if UPA is missing or fails, a 200 with icons only.
export async function embroideryCssResponse(upa?: Fetcher): Promise<Response> {
  let bands: Record<"a" | "b" | "c", Border> | null = null;
  if (upa) {
    try {
      const got = await Promise.all(TOKEN_FRAMES.map((f) => fetchBand(upa, f)));
      bands = Object.fromEntries(TOKEN_KEYS.map((k, i) => [k, { id: got[i].id, rows: got[i].unit.length, cols: got[i].unit[0].length, cells: got[i].unit }])) as unknown as Record<"a" | "b" | "c", Border>;
    } catch { bands = null; }
  }
  return new Response(embroideryCss(bands), {
    headers: {
      "content-type": "text/css; charset=utf-8",
      "cache-control": bands ? "public, max-age=86400" : "no-store",
    },
  });
}
