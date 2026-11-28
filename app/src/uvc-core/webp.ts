// SYNCED FROM upa-archive/src/uvc/ — run `tsx scripts/uvc-sync-verba.ts` in upa-archive to update.
// Pure TypeScript Lossless WebP (VP8L) + Animated WebP (VP8X/ANIM/ANMF) encoder.

class BitWriter {
  private buf: number[] = [];
  private acc = 0;
  private bits = 0;

  writeBits(val: number, n: number): void {
    this.acc |= (val >>> 0) << this.bits;
    this.bits += n;
    while (this.bits >= 8) {
      this.buf.push(this.acc & 0xff);
      this.acc >>>= 8;
      this.bits -= 8;
    }
  }

  finish(): Uint8Array {
    if (this.bits > 0) {
      this.buf.push(this.acc & 0xff);
      this.acc = 0;
      this.bits = 0;
    }
    return new Uint8Array(this.buf);
  }
}

function reverseBits(val: number, len: number): number {
  let r = 0;
  for (let i = 0; i < len; i++) {
    r = (r << 1) | (val & 1);
    val >>>= 1;
  }
  return r;
}

function buildCodeLengths(freqs: Uint32Array, maxBits = 15): Uint8Array {
  const n = freqs.length;
  const active: number[] = [];
  for (let i = 0; i < n; i++) if (freqs[i]! > 0) active.push(i);
  const lens = new Uint8Array(n);
  if (active.length <= 1) return lens;

  let minFreq = 1;
  while (true) {
    interface Node { sym: number; freq: number; left: Node | null; right: Node | null; }
    const nodes: Node[] = active.map((sym) => ({
      sym,
      freq: Math.max(minFreq, freqs[sym]!),
      left: null,
      right: null,
    }));
    while (nodes.length > 1) {
      nodes.sort((a, b) => a.freq - b.freq);
      const a = nodes.shift()!;
      const b = nodes.shift()!;
      nodes.push({ sym: -1, freq: a.freq + b.freq, left: a, right: b });
    }
    let maxLen = 0;
    const walk = (node: Node | null, d: number) => {
      if (!node) return;
      if (node.sym >= 0) {
        lens[node.sym] = d;
        if (d > maxLen) maxLen = d;
      } else {
        walk(node.left, d + 1);
        walk(node.right, d + 1);
      }
    };
    walk(nodes[0]!, 0);
    if (maxLen <= maxBits) break;
    minFreq *= 2;
  }
  return lens;
}

function lengthsToCodes(lens: Uint8Array): Uint32Array {
  let maxLen = 0;
  for (const l of lens) if (l > maxLen) maxLen = l;
  const blCount = new Int32Array(maxLen + 1);
  for (const l of lens) if (l > 0) blCount[l]!++;
  const nextCode = new Int32Array(maxLen + 1);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    code = (code + blCount[bits - 1]!) << 1;
    nextCode[bits] = code;
  }
  const codes = new Uint32Array(lens.length);
  for (let i = 0; i < lens.length; i++) {
    const len = lens[i]!;
    if (len > 0) codes[i] = reverseBits(nextCode[len]!++, len);
  }
  return codes;
}

const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function writeHuffmanTree(bw: BitWriter, lens: Uint8Array, freqs?: Uint32Array): Uint32Array {
  const active: number[] = [];
  for (let i = 0; i < lens.length; i++) {
    if (lens[i]! > 0 || (freqs && freqs[i]! > 0)) active.push(i);
  }
  if (active.length === 0) active.push(0);

  if (active.length === 1) {
    const sym = active[0]!;
    bw.writeBits(1, 1);
    bw.writeBits(0, 1);
    if (sym <= 1) {
      bw.writeBits(0, 1);
      bw.writeBits(sym, 1);
    } else {
      bw.writeBits(1, 1);
      bw.writeBits(sym, 8);
    }
    return new Uint32Array(lens.length);
  }
  if (active.length === 2 && active[0]! < 256 && active[1]! < 256) {
    const s0 = active[0]!;
    const s1 = active[1]!;
    bw.writeBits(1, 1);
    bw.writeBits(1, 1);
    if (s0 <= 1) {
      bw.writeBits(0, 1);
      bw.writeBits(s0, 1);
    } else {
      bw.writeBits(1, 1);
      bw.writeBits(s0, 8);
    }
    bw.writeBits(s1, 8);
    lens[s0] = 1;
    lens[s1] = 1;
    const codes = new Uint32Array(lens.length);
    codes[s0] = 0;
    codes[s1] = 1;
    return codes;
  }

  bw.writeBits(0, 1);
  const trimLen = lens.length;
  const seq: Array<[number, number, number]> = [];
  for (let i = 0; i < trimLen; ) {
    const v = lens[i]!;
    if (v === 0) {
      let run = 1;
      while (i + run < trimLen && lens[i + run] === 0 && run < 138) run++;
      if (run >= 11) {
        seq.push([18, run - 11, 7]);
        i += run;
      } else if (run >= 3) {
        seq.push([17, run - 3, 3]);
        i += run;
      } else {
        while (run-- > 0) {
          seq.push([0, 0, 0]);
          i++;
        }
      }
    } else {
      seq.push([v, 0, 0]);
      i++;
      while (i < trimLen && lens[i] === v) {
        let run = 1;
        while (i + run < trimLen && lens[i + run] === v && run < 6) run++;
        if (run >= 3) {
          seq.push([16, run - 3, 2]);
          i += run;
        } else {
          break;
        }
      }
    }
  }

  const clFreq = new Uint32Array(19);
  for (const [s] of seq) clFreq[s]!++;
  let clActiveCount = 0;
  let firstCl = 0;
  for (let i = 0; i < 19; i++) {
    if (clFreq[i]! > 0) {
      clActiveCount++;
      firstCl = i;
    }
  }
  if (clActiveCount === 1) clFreq[firstCl === 0 ? 1 : 0] = 1;

  const clLens = buildCodeLengths(clFreq, 7);
  const clCodes = lengthsToCodes(clLens);
  let numCl = 19;
  while (numCl > 4 && clLens[CODE_LENGTH_ORDER[numCl - 1]!] === 0) numCl--;
  bw.writeBits(numCl - 4, 4);
  for (let i = 0; i < numCl; i++) bw.writeBits(clLens[CODE_LENGTH_ORDER[i]!]!, 3);
  bw.writeBits(0, 1);

  for (const [s, extra, ebits] of seq) {
    bw.writeBits(clCodes[s]!, clLens[s]!);
    if (ebits > 0) bw.writeBits(extra, ebits);
  }
  return lengthsToCodes(lens);
}

function encodePrefix(val: number): { code: number; extra: number; extraBits: number } {
  if (val <= 4) return { code: val - 1, extra: 0, extraBits: 0 };
  const msb = 31 - Math.clz32(val - 1);
  const extraBits = msb - 1;
  const code = 2 * extraBits + (((val - 1) >>> extraBits) & 1) + 2;
  const extra = (val - 1) & ((1 << extraBits) - 1);
  return { code, extra, extraBits };
}

function encodeVP8LDistance(dist: number, width: number) {
  if (dist === width) return encodePrefix(1);
  if (dist === 1) return encodePrefix(2);
  return encodePrefix(dist + 120);
}

function extractPalette(rgba: Uint8Array, nPx: number) {
  const map = new Map<number, number>();
  const palette: Array<[number, number, number, number]> = [];
  const indices = new Uint8Array(nPx);
  for (let i = 0; i < nPx; i++) {
    const o = i * 4;
    const r = rgba[o]!, g = rgba[o + 1]!, b = rgba[o + 2]!, a = rgba[o + 3]!;
    const key = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
    let idx = map.get(key);
    if (idx === undefined) {
      if (palette.length >= 256) return null;
      idx = palette.length;
      map.set(key, idx);
      palette.push([r, g, b, a]);
    }
    indices[i] = idx;
  }
  return { palette, indices };
}

export function encodeVP8L(W: number, H: number, rgba: Uint8Array): Uint8Array {
  let alphaUsed = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { alphaUsed = 1; break; }
  const pal = extractPalette(rgba, W * H);
  if (pal) return encodeVP8LIndexed(W, H, pal.indices, pal.palette, alphaUsed);
  return encodeVP8LRGBA(W, H, rgba, alphaUsed);
}

function encodeVP8LIndexed(
  W: number,
  H: number,
  indices: Uint8Array,
  palette: Array<[number, number, number, number]>,
  alphaUsed: number,
): Uint8Array {
  const bw = new BitWriter();
  bw.writeBits(0x2f, 8);
  bw.writeBits(W - 1, 14);
  bw.writeBits(H - 1, 14);
  bw.writeBits(alphaUsed, 1);
  bw.writeBits(0, 3);

  bw.writeBits(1, 1);
  bw.writeBits(3, 2);
  bw.writeBits(palette.length - 1, 8);

  bw.writeBits(0, 1);
  const pG: number[] = [], pR: number[] = [], pB: number[] = [], pA: number[] = [];
  const fG = new Uint32Array(280), fR = new Uint32Array(256), fB = new Uint32Array(256), fA = new Uint32Array(256), fD = new Uint32Array(40);
  for (let i = 0; i < palette.length; i++) {
    const prev = i === 0 ? [0, 0, 0, 0] : palette[i - 1]!;
    const [r, g, b, a] = palette[i]!;
    const dr = (r - prev[0]!) & 0xff;
    const dg = (g - prev[1]!) & 0xff;
    const db = (b - prev[2]!) & 0xff;
    const da = (a - prev[3]!) & 0xff;
    pG.push(dg); pR.push(dr); pB.push(db); pA.push(da);
    fG[dg]!++; fR[dr]!++; fB[db]!++; fA[da]!++;
  }
  const pLG = buildCodeLengths(fG), pLR = buildCodeLengths(fR), pLB = buildCodeLengths(fB), pLA = buildCodeLengths(fA), pLD = buildCodeLengths(fD);
  const pCG = writeHuffmanTree(bw, pLG, fG);
  const pCR = writeHuffmanTree(bw, pLR, fR);
  const pCB = writeHuffmanTree(bw, pLB, fB);
  const pCA = writeHuffmanTree(bw, pLA, fA);
  writeHuffmanTree(bw, pLD, fD);
  for (let i = 0; i < palette.length; i++) {
    bw.writeBits(pCG[pG[i]!]!, pLG[pG[i]!]!);
    bw.writeBits(pCR[pR[i]!]!, pLR[pR[i]!]!);
    bw.writeBits(pCB[pB[i]!]!, pLB[pB[i]!]!);
    bw.writeBits(pCA[pA[i]!]!, pLA[pA[i]!]!);
  }
  bw.writeBits(0, 1);

  const bitsPerPx = palette.length <= 2 ? 1 : palette.length <= 4 ? 2 : palette.length <= 16 ? 4 : 8;
  const pxPerByte = 8 / bitsPerPx;
  const packedW = Math.ceil(W / pxPerByte);
  const packed = new Uint8Array(packedW * H);
  for (let y = 0; y < H; y++) {
    const srcOff = y * W;
    const dstOff = y * packedW;
    if (bitsPerPx === 4) {
      for (let x = 0; x < W; x += 2) {
        packed[dstOff + (x >> 1)] = indices[srcOff + x]! | ((x + 1 < W ? indices[srcOff + x + 1]! : 0) << 4);
      }
    } else if (bitsPerPx === 8) {
      for (let x = 0; x < W; x++) packed[dstOff + x] = indices[srcOff + x]!;
    } else if (bitsPerPx === 2) {
      for (let x = 0; x < W; x += 4) {
        let b = 0;
        for (let k = 0; k < 4 && x + k < W; k++) b |= indices[srcOff + x + k]! << (k * 2);
        packed[dstOff + (x >> 2)] = b;
      }
    } else {
      for (let x = 0; x < W; x += 8) {
        let b = 0;
        for (let k = 0; k < 8 && x + k < W; k++) b |= indices[srcOff + x + k]! << k;
        packed[dstOff + (x >> 3)] = b;
      }
    }
  }

  type Tok = [0, number] | [1, number, number, number, number, number, number];
  const tokens: Tok[] = [];
  const total = packedW * H;
  const freqG = new Uint32Array(280);
  const freqD = new Uint32Array(40);
  let pos = 0;
  while (pos < total) {
    if (pos >= packedW && packed[pos] === packed[pos - packedW]) {
      let run = 1;
      while (run < 4096 && pos + run < total && packed[pos + run] === packed[pos + run - packedW]) run++;
      if (run >= 3) {
        const lp = encodePrefix(run);
        const dp = encodeVP8LDistance(packedW, packedW);
        tokens.push([1, 256 + lp.code, lp.extra, lp.extraBits, dp.code, dp.extra, dp.extraBits]);
        freqG[256 + lp.code]!++;
        freqD[dp.code]!++;
        pos += run;
        continue;
      }
    }
    if (pos >= 1 && packed[pos] === packed[pos - 1]) {
      let run = 1;
      while (run < 4096 && pos + run < total && packed[pos + run] === packed[pos - 1]) run++;
      if (run >= 3) {
        const lp = encodePrefix(run);
        const dp = encodeVP8LDistance(1, packedW);
        tokens.push([1, 256 + lp.code, lp.extra, lp.extraBits, dp.code, dp.extra, dp.extraBits]);
        freqG[256 + lp.code]!++;
        freqD[dp.code]!++;
        pos += run;
        continue;
      }
    }
    const lit = packed[pos++]!;
    tokens.push([0, lit]);
    freqG[lit]!++;
  }

  bw.writeBits(0, 1);
  bw.writeBits(0, 1);
  const fZero = new Uint32Array(256);
  fZero[0] = 1;
  const lG = buildCodeLengths(freqG), lZ = buildCodeLengths(fZero), lD = buildCodeLengths(freqD);
  const cG = writeHuffmanTree(bw, lG, freqG);
  const cR = writeHuffmanTree(bw, lZ, fZero);
  const cB = writeHuffmanTree(bw, lZ, fZero);
  const cA = writeHuffmanTree(bw, lZ, fZero);
  const cD = writeHuffmanTree(bw, lD, freqD);

  for (const tok of tokens) {
    if (tok[0] === 0) {
      const lit = tok[1];
      bw.writeBits(cG[lit]!, lG[lit]!);
      bw.writeBits(cR[0]!, lZ[0]!);
      bw.writeBits(cB[0]!, lZ[0]!);
      bw.writeBits(cA[0]!, lZ[0]!);
    } else {
      const [, gc, ge, geb, dc, de, deb] = tok;
      bw.writeBits(cG[gc]!, lG[gc]!);
      if (geb > 0) bw.writeBits(ge, geb);
      bw.writeBits(cD[dc]!, lD[dc]!);
      if (deb > 0) bw.writeBits(de, deb);
    }
  }
  return bw.finish();
}

function encodeVP8LRGBA(W: number, H: number, rgba: Uint8Array, alphaUsed: number): Uint8Array {
  const bw = new BitWriter();
  bw.writeBits(0x2f, 8);
  bw.writeBits(W - 1, 14);
  bw.writeBits(H - 1, 14);
  bw.writeBits(alphaUsed, 1);
  bw.writeBits(0, 3);
  bw.writeBits(0, 1);
  bw.writeBits(0, 1);
  bw.writeBits(0, 1);

  const nPx = W * H;
  const fG = new Uint32Array(280), fR = new Uint32Array(256), fB = new Uint32Array(256), fA = new Uint32Array(256), fD = new Uint32Array(40);
  const eq = (a: number, b: number) =>
    rgba[a * 4] === rgba[b * 4] && rgba[a * 4 + 1] === rgba[b * 4 + 1] && rgba[a * 4 + 2] === rgba[b * 4 + 2] && rgba[a * 4 + 3] === rgba[b * 4 + 3];
  type Tok = [0, number] | [1, number, number, number, number, number, number];
  const tokens: Tok[] = [];
  let pos = 0;
  while (pos < nPx) {
    if (pos >= W && eq(pos, pos - W)) {
      let run = 1;
      while (run < 4096 && pos + run < nPx && eq(pos + run, pos + run - W)) run++;
      if (run >= 3) {
        const lp = encodePrefix(run), dp = encodeVP8LDistance(W, W);
        tokens.push([1, 256 + lp.code, lp.extra, lp.extraBits, dp.code, dp.extra, dp.extraBits]);
        fG[256 + lp.code]!++; fD[dp.code]!++;
        pos += run;
        continue;
      }
    }
    if (pos >= 1 && eq(pos, pos - 1)) {
      let run = 1;
      while (run < 4096 && pos + run < nPx && eq(pos + run, pos - 1)) run++;
      if (run >= 3) {
        const lp = encodePrefix(run), dp = encodeVP8LDistance(1, W);
        tokens.push([1, 256 + lp.code, lp.extra, lp.extraBits, dp.code, dp.extra, dp.extraBits]);
        fG[256 + lp.code]!++; fD[dp.code]!++;
        pos += run;
        continue;
      }
    }
    const o = pos * 4;
    fR[rgba[o]!]!++; fG[rgba[o + 1]!]!++; fB[rgba[o + 2]!]!++; fA[rgba[o + 3]!]!++;
    tokens.push([0, pos]);
    pos++;
  }
  const lG = buildCodeLengths(fG), lR = buildCodeLengths(fR), lB = buildCodeLengths(fB), lA = buildCodeLengths(fA), lD = buildCodeLengths(fD);
  const cG = writeHuffmanTree(bw, lG, fG), cR = writeHuffmanTree(bw, lR, fR), cB = writeHuffmanTree(bw, lB, fB), cA = writeHuffmanTree(bw, lA, fA), cD = writeHuffmanTree(bw, lD, fD);
  for (const tok of tokens) {
    if (tok[0] === 0) {
      const o = tok[1] * 4;
      bw.writeBits(cG[rgba[o + 1]!]!, lG[rgba[o + 1]!]!);
      bw.writeBits(cR[rgba[o]!]!, lR[rgba[o]!]!);
      bw.writeBits(cB[rgba[o + 2]!]!, lB[rgba[o + 2]!]!);
      bw.writeBits(cA[rgba[o + 3]!]!, lA[rgba[o + 3]!]!);
    } else {
      const [, gc, ge, geb, dc, de, deb] = tok;
      bw.writeBits(cG[gc]!, lG[gc]!);
      if (geb > 0) bw.writeBits(ge, geb);
      bw.writeBits(cD[dc]!, lD[dc]!);
      if (deb > 0) bw.writeBits(de, deb);
    }
  }
  return bw.finish();
}

function writeU24LE(arr: Uint8Array, off: number, val: number): void {
  arr[off] = val & 0xff;
  arr[off + 1] = (val >>> 8) & 0xff;
  arr[off + 2] = (val >>> 16) & 0xff;
}

export function encodeWebpLossless(W: number, H: number, rgba: Uint8Array): Uint8Array<ArrayBuffer> {
  const vp8l = encodeVP8L(W, H, rgba);
  const pad = vp8l.length & 1;
  const total = 12 + 8 + vp8l.length + pad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  dv.setUint32(4, total - 8, true);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  out.set([0x56, 0x50, 0x38, 0x4c], 12);
  dv.setUint32(16, vp8l.length, true);
  out.set(vp8l, 20);
  return out;
}

export function encodeAnimatedWebp(
  W: number,
  H: number,
  framesRgba: Uint8Array[],
  delayMs = 100,
  bg: [number, number, number] = [0xf4, 0xf1, 0xe8],
): Uint8Array<ArrayBuffer> {
  if (framesRgba.length <= 1) return encodeWebpLossless(W, H, framesRgba[0] ?? new Uint8Array(W * H * 4));
  const vp8lFrames = framesRgba.map((f) => encodeVP8L(W, H, f));
  let framesSize = 0;
  for (const vf of vp8lFrames) framesSize += 8 + 16 + 8 + vf.length + (vf.length & 1);
  const totalSize = 12 + (8 + 10) + (8 + 6) + framesSize;
  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);
  let p = 0;
  out.set([0x52, 0x49, 0x46, 0x46], p); p += 4;
  dv.setUint32(p, totalSize - 8, true); p += 4;
  out.set([0x57, 0x45, 0x42, 0x50], p); p += 4;

  out.set([0x56, 0x50, 0x38, 0x58], p); p += 4;
  dv.setUint32(p, 10, true); p += 4;
  out[p] = 0x02;
  p += 4;
  writeU24LE(out, p, W - 1); p += 3;
  writeU24LE(out, p, H - 1); p += 3;

  out.set([0x41, 0x4e, 0x49, 0x4d], p); p += 4;
  dv.setUint32(p, 6, true); p += 4;
  out[p++] = bg[2]; out[p++] = bg[1]; out[p++] = bg[0]; out[p++] = 255;
  dv.setUint16(p, 0, true); p += 2;

  for (const vf of vp8lFrames) {
    const pad = vf.length & 1;
    const anmfPayload = 16 + 8 + vf.length + pad;
    out.set([0x41, 0x4e, 0x4d, 0x46], p); p += 4;
    dv.setUint32(p, anmfPayload, true); p += 4;
    writeU24LE(out, p, 0); p += 3;
    writeU24LE(out, p, 0); p += 3;
    writeU24LE(out, p, W - 1); p += 3;
    writeU24LE(out, p, H - 1); p += 3;
    writeU24LE(out, p, delayMs); p += 3;
    out[p++] = 0x02;

    out.set([0x56, 0x50, 0x38, 0x4c], p); p += 4;
    dv.setUint32(p, vf.length, true); p += 4;
    out.set(vf, p); p += vf.length;
    if (pad) out[p++] = 0;
  }
  return out;
}
