// Authentic Ukrainian embroidery border units, imported from the UPA pattern
// corpus (dyco/assets/ukrainian-embroidery-corpus — deduplicated repeat units
// OCR'd from an embroidery-patterns book). Each is a horizontal repeat unit; we
// tile it across the card width to frame the proverb as a рушник border.
// Symbols: '.' = linen (cream), 'R' = red, 'B' = black. This is every clean-tiling
// red/black-only unit in the corpus usable as a band (the brand palette). To add
// colour borders, lift the green/yellow/blue units and widen the GIF palette.

export type RGB = readonly [number, number, number];
export type Border = { readonly id: string; readonly rows: number; readonly cols: number; readonly cells: readonly string[] };

const CREAM: RGB = [244, 241, 232];
const RED: RGB = [180, 35, 42];
const BLACK: RGB = [26, 26, 26];

function cellRGB(sym: string): RGB {
  if (sym === "R") return RED;
  if (sym === ".") return CREAM;
  return BLACK;
}

export const BORDERS: readonly Border[] = [
  { id: "upa_0e8e170b8b46662b", rows: 3, cols: 6, cells: [
    "..B...",
    ".B.B..",
    "BBBBBB",
  ] },
  { id: "upa_8355132b2179318b", rows: 3, cols: 7, cells: [
    "R.R.RR.",
    ".B..BB.",
    "R.R.RR.",
  ] },
  { id: "upa_3b6e8517deeeaa96", rows: 4, cols: 8, cells: [
    ".B...B..",
    "B.B.BBB.",
    "...RRRRR",
    "RRRRRRRR",
  ] },
  { id: "upa_4e19e17097431fa7", rows: 4, cols: 8, cells: [
    "..B...B.",
    ".BBB.BRB",
    "BB.BBR.R",
    "B...R..R",
  ] },
  { id: "upa_79a36267418191fe", rows: 4, cols: 8, cells: [
    "...RRB..",
    "..R...BB",
    "BB...R..",
    "..BRR...",
  ] },
  { id: "upa_6f660e96a1c0acef", rows: 4, cols: 9, cells: [
    ".RR.BB.BB",
    "RRRR..BB.",
    "RRRR.BB..",
    ".RR.BB.BB",
  ] },
  { id: "upa_db9ae21fe79d26b1", rows: 4, cols: 9, cells: [
    "BBB..B..B",
    "B..BB..BB",
    "...BB.BBB",
    "BBB..BBB.",
  ] },
  { id: "upa_5a2853fb70c24f41", rows: 5, cols: 6, cells: [
    "RRRRRR",
    "RR.BB.",
    "..R..R",
    "BB.RR.",
    "RRRRRR",
  ] },
  { id: "upa_6d8dd821a18df536", rows: 5, cols: 6, cells: [
    "BBBBBB",
    "..RRR.",
    ".RRR..",
    "RRR...",
    "BBBBBB",
  ] },
  { id: "upa_efbe3e1c32136834", rows: 5, cols: 6, cells: [
    "B.B.B.",
    ".B.RRR",
    "B.BRRR",
    "RRRRRR",
    "RRRRRR",
  ] },
  { id: "upa_02558745041da8a2", rows: 5, cols: 8, cells: [
    ".B...R..",
    "BBB..R..",
    ".B..RRR.",
    "RBRRRBRR",
    "BBBBBBBB",
  ] },
  { id: "upa_4835802105f9150b", rows: 5, cols: 12, cells: [
    "RRR...BBB...",
    ".R.R.BB.BB.R",
    "BBB.R.BBB.R.",
    "B.BB.R.R.R.B",
    "BBB...RRR...",
  ] },
  { id: "upa_a83394df6ae60276", rows: 5, cols: 13, cells: [
    ".RR.RR...BBB.",
    "..R..R..BBBRB",
    "RR.RR.RRBBRBB",
    "..R..R..BRBBB",
    ".RR.RR...BBB.",
  ] },
  { id: "upa_e3d1f193ed2fee5a", rows: 6, cols: 12, cells: [
    ".R...R......",
    "..R.R.......",
    "...B.....R..",
    "..BRB...R.R.",
    ".BRRRB.R...R",
    "BRR.RRB..R..",
  ] },
  { id: "upa_9b9203ae673ddf08", rows: 7, cols: 6, cells: [
    "..RRR.",
    ".RRRRR",
    "BRR.RR",
    "BB...B",
    "BRR.RR",
    ".RRRRR",
    "..RRR.",
  ] },
  { id: "upa_b5064579226116cd", rows: 7, cols: 6, cells: [
    "RRRRRR",
    "RRRRRR",
    "RB.BRR",
    "B.B.B.",
    "RB.BRR",
    "RRRRRR",
    "RRRRRR",
  ] },
  { id: "upa_2171d326a6b094b9", rows: 7, cols: 8, cells: [
    "..B...B.",
    ".BBB.BRB",
    "BB.BBR.R",
    "B...R..R",
    "..B...B.",
    ".BBB.BBB",
    "BBBBBBBB",
  ] },
  { id: "upa_03fc9c4cd8e9d212", rows: 8, cols: 9, cells: [
    "..BBB....",
    ".BBBBB...",
    "B.....B..",
    ".BBBB..B.",
    "..BBBB..B",
    "B.....B..",
    ".BBBBB...",
    "..BBB....",
  ] },
  { id: "upa_5e951c26cffb51c4", rows: 8, cols: 9, cells: [
    "BBBBBBBBB",
    ".........",
    "BBB..B..B",
    "B..BB..BB",
    "...BB.BBB",
    "BBB..BBB.",
    ".........",
    "BBBBBBBBB",
  ] },
  { id: "upa_54136c4cd0ba1785", rows: 8, cols: 12, cells: [
    "..R..R..R...",
    "..R.RBR.R...",
    ".R.RBRBR.R.R",
    "R.B.RBR.B.RB",
    "R.B.RBR.B.RB",
    "BR.R.R.R.RBR",
    "R.R.....R.RB",
    "..R.....R..R",
  ] },
  { id: "upa_f9b5ec7a4da394f3", rows: 8, cols: 18, cells: [
    "..RRR......BBB....",
    ".RRRRR....BBBBB...",
    "R.....R..B.....B..",
    ".RRRR..R..BBBB..B.",
    "..RRRR..R..BBBB..B",
    "B.....B..R.....R..",
    ".BBBBB....RRRRR...",
    "..BBB......RRR....",
  ] },
  { id: "upa_2c1afca8547010f7", rows: 8, cols: 22, cells: [
    "RRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRB.RR.RR.RR.RR.BRR",
    "RRRRB.RR.RR.B.RR.RR.BR",
    "RRRR.RR.RR.BRB.RR.RR.R",
    "BRB.RR.RR.RRRRR.RR.RR.",
    ".B.RR.RR.BRRRRRB.RR.RR",
    "R.RR.RR.BRRRRRRRB.RR.R",
    "RRRRRRRRRRRRRRRRRRRRRR",
  ] },
  { id: "upa_84b9055be3221da6", rows: 8, cols: 33, cells: [
    "RRR....B.B.B....BRRR.....RRR....B",
    "BRRR...BRBRB.....BRRR...BRRRR....",
    ".BBRR.BRRRRRR.RRR.BBRR.BRBR.R.RRR",
    "R....BRRBRRRRR.RRR....BRBRRRRR.RR",
    ".BBR.BRRBRRBRR....BBR.BRBRRRR....",
    "BRR..BBRRBBRRB...BRR..BRRBRRR....",
    "RR....BBRRRRB...BRR...BBRRRRB....",
    "R......BBBBB...BRR.....BBBBB.....",
  ] },
  { id: "upa_b3168852e7b66eb0", rows: 9, cols: 6, cells: [
    ".B....",
    "B.B...",
    "BBBBBB",
    "..RRR.",
    ".RRR..",
    "RRR...",
    "BBBBBB",
    "B.B...",
    ".B....",
  ] },
  { id: "upa_b6f162d2d8ac2031", rows: 9, cols: 14, cells: [
    ".....BBB..BB..",
    "..RR..BBB..BB.",
    ".RRRR..BBB..BB",
    "R....R..BBB...",
    "..BBB.R..BBB.R",
    ".BBB...R....R.",
    "BBB..BB.RRRR..",
    "BB..BB...RR..B",
    "B..BB.......BB",
  ] },
  { id: "upa_019704193fd6fff3", rows: 9, cols: 16, cells: [
    "......B..BB..B..",
    ".BB..BBB.BB.BBB.",
    "BBBB..BBB..BBB..",
    "BRRBB....BB....B",
    "BRRBBBBBBBBBBBBB",
    "BRRBB....BB....B",
    "BBBB..BBB..BBB..",
    ".BB..BBB.BB.BBB.",
    "......B..BB..B..",
  ] },
  { id: "upa_8a1e623643e836df", rows: 9, cols: 16, cells: [
    "B.B.R.R.R.R.B.B.",
    "BB...RRRRR...BBB",
    "B...R.RRR...B.BB",
    ".B.RRR...R.BBB..",
    ".B.RR....R.BB...",
    ".B.RR....R.BB...",
    "BBBBBBBBBBBBBBBB",
    "RRRRRRRRRRRRRRRR",
    "BBBBBBBBBBBBBBBB",
  ] },
  { id: "upa_bd61b7e8ed17079a", rows: 9, cols: 20, cells: [
    ".R.R..R.BB.B.B..B.RR",
    "R.R..RR.B.B.B..BB.R.",
    ".R..RRR.BB.B..BBB.RR",
    "R..RRRR.B.B..BBBB.R.",
    "..RRRRR.BB..BBBBB.RR",
    ".RRRRRR.B..BBBBBB.R.",
    "RRRRRRRRRRRRRRRRRRRR",
    "BBBBBBBBBBBBBBBBBBBB",
    "RRRRRRRRRRRRRRRRRRRR",
  ] },
  { id: "upa_30178f8a5ab9d030", rows: 9, cols: 30, cells: [
    "........BBBB....BB........BBBB",
    "B...BB...BBBB..BRBB...BB...BBB",
    "B..BRBB...BBB..BBBB..BRBB...BB",
    ".BBBBBB.....BB..BBB..BBBB..B..",
    "B...BB.BB.BB..BB...BB.BB.BB..B",
    ".BBB..BBBB..B...BBBBBB.....BB.",
    "BBBB..BRBB...BBB..BRBB...BBB..",
    "BRBB...BB...BBBB...BB...BBBB..",
    ".BB........BBBB........BBBB...",
  ] },
  { id: "upa_6cdef2752bd9b5fb", rows: 10, cols: 24, cells: [
    "BBBB......BBB...BBB...BB",
    "....BB...B...B...BBB.B..",
    "BRB..BB.B..RR.RR....B...",
    "R.RB..BB..RRBRBRR..B...B",
    "...BR..B..RB.R.BR..B..RB",
    ".R.BR..BB.RBRRRBR.BB..RB",
    "BRBRR...B..BRRRB..BB..RR",
    "R.RR.....B..BRB..BB.B..R",
    ".B....BBB.B.....BB...B..",
    "B....BBB...BBBBBB.....BB",
  ] },
  { id: "upa_df38bef4ecc0a5cc", rows: 11, cols: 14, cells: [
    "..B...R.....R.",
    ".BBB..RR...RR.",
    "R.B.RRBBB.BBBR",
    "..B..RB..R..BR",
    ".BBB..B.RRR.B.",
    "BBRBB..RRBRR..",
    ".BBB..B.RRR.B.",
    "..B..RB..R..BR",
    "R.B.RRBBB.BBBR",
    ".BBB..RR...RR.",
    "..B...R.....R.",
  ] },
  { id: "upa_7af1088bb5e2fad2", rows: 11, cols: 16, cells: [
    "B.B.B.B.B.B.B.B.",
    "BBBBBBBBBBBBBBBB",
    "B...BBB.BBB...B.",
    "BB..BB...BB..BB.",
    "BBB.B..B..B.BBB.",
    "BBBB..BBB..BBBB.",
    "BBB.B..B..B.BBB.",
    "BB..BB...BB..BB.",
    "B...BBB.BBB...B.",
    "BBBBBBBBBBBBBBBB",
    "B.B.B.B.B.B.B.B.",
  ] },
  { id: "upa_eb6cc6cd5987af38", rows: 11, cols: 24, cells: [
    "RRRRRRRRRRRRRRRRRRRRRRRR",
    "...RRRRR...RRRRR...R...R",
    "B.B.BBB.B.B.BBB.B.B.B.B.",
    ".B...B...B...B...B...B..",
    "........................",
    "RRRRRRRRRRRRRRRRRRRRRRRR",
    "RB.BRRRB.BRRRB.BRRRB.BRR",
    "B.B.B.B.B.B.B.B.B.B.B.B.",
    "RB.BRRRB.BRRRB.BRRRB.BRR",
    "RRRRRRRRRRRRRRRRRRRRRRRR",
    "RRRRRRRRRRRRRRRRRRRRRRRR",
  ] },
  { id: "upa_506d3773c2b3cf2f", rows: 13, cols: 16, cells: [
    "..R....R.R....R.",
    "...R...R.R...R..",
    "....R.RRRRR.R...",
    ".....RRRRRRR....",
    ".RRR.RRR.RRR.RRR",
    "..RRRRR.B.RRRRR.",
    "R..RRR.BBB.RRR..",
    "R..RRRR.B.RRRR..",
    "R..RRRRR.RRRRR..",
    "RR..RRRRRRRRR..R",
    ".RR....RRR....RR",
    "..RR..RRRRR..RR.",
    "RRRRRRRR.RRRRRRR",
  ] },
  { id: "upa_5fef1b0c18bc6ecb", rows: 14, cols: 8, cells: [
    ".B......",
    ".BB.....",
    ".BBB..B.",
    "..BB.BB.",
    "...B.B..",
    "....B...",
    ".B...B..",
    "BBB.BBB.",
    "B.BBB.BB",
    "...B...B",
    "..B.....",
    "BB.B....",
    "B..BB..B",
    "....B.BB",
  ] },
  { id: "upa_05e7f148792f275b", rows: 14, cols: 13, cells: [
    "BBBBBBBBBBBBB",
    "B.....RR.....",
    "B.RR.RBBR.RR.",
    "B.RBBRBBRBBR.",
    "B..BBRBBRBB..",
    ".BRRRB..BRRRB",
    ".RBBB.RR.BBBR",
    ".RBBB.RR.BBBR",
    ".BRRRB..BRRRB",
    "B..BBRBBRBB..",
    "B.RBBRBBRBBR.",
    "B.RR.RBBR.RR.",
    "B.....RR.....",
    "BBBBBBBBBBBBB",
  ] },
  { id: "upa_19a7317494fb2e1c", rows: 15, cols: 11, cells: [
    "BB...R.R...",
    "..BB..R..BB",
    "..BB..R..BB",
    "BB...RRR...",
    "...RRBBBRR.",
    "...RRB.BRR.",
    "..RBBB.BBBR",
    "RRRB..B..BR",
    "..RBBB.BBBR",
    "...RRB.BRR.",
    "...RRBBBRR.",
    "BB...RRR...",
    "..BB..R..BB",
    "..BB..R..BB",
    "BB...R.R...",
  ] },
  { id: "upa_992e5f4386c36c81", rows: 15, cols: 22, cells: [
    ".....RR........RR.....",
    "....RRRR.....BRRRR....",
    ".RR.RRRR.RR..BRRRR..B.",
    "RRRRBRRBRRRR..BRR..BB.",
    "RRRRBBBBRRRR...BB.BBB.",
    "RRRRBBBBRRRR..B...BB..",
    ".RRBB..BBRR..B....B...",
    "..BBB..BBB..B.BBBB....",
    ".RRBB..BBRR..B....B...",
    "RRRRBBBBRRRR..B...BB..",
    "RRRRBBBBRRRR...BB.BBB.",
    "RRRRBRRBRRRR..BRR..BB.",
    ".RR.RRRR.RR..BRRRR..B.",
    "....RRRR.....BRRRR....",
    ".....RR........RR.....",
  ] },
]; 

// Deterministic per-proverb pick (FNV-1a over the seed key).
export function pickBorder(seedKey: string): Border {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedKey.length; i++) h = Math.imul(h ^ seedKey.charCodeAt(i), 16777619) >>> 0;
  return BORDERS[h % BORDERS.length];
}

// Paint top + bottom border strips into an existing W×H RGBA buffer. The unit is
// scaled to an integer stitch size so its rows fill `band` px, tiled across the
// full width and hugging the top/bottom edges. `phase` in [0,1) drifts the unit
// horizontally by one full repeat over the loop — mirrored (top drifts one way,
// bottom the other) so the рушник "flows" symmetrically; seamless at phase 0≡1.
export function paintBorders(rgba: Uint8Array, W: number, H: number, band: number, p: Border, phase: number): void {
  const stitch = Math.max(1, Math.floor(band / p.rows));
  const stripH = stitch * p.rows;
  const unitW = p.cols * stitch;
  const offset = Math.round(phase * unitW);
  for (const top of [true, false] as const) {
    const yBase = top ? 0 : H - stripH;
    const off = top ? offset : -offset; // mirror the drift between the two bands
    for (let sy = 0; sy < stripH; sy++) {
      const prow = p.cells[(sy / stitch) | 0]!;
      const o0 = (yBase + sy) * W * 4;
      for (let x = 0; x < W; x++) {
        const srcX = (((x + off) % unitW) + unitW) % unitW;
        const [r, g, b] = cellRGB(prow[(srcX / stitch) | 0] ?? ".");
        const o = o0 + x * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
      }
    }
  }
}
