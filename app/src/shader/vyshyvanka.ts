// Pixel helpers shared by the card encoders.

// Alpha-composite an RGBA `text` layer over `base` (both W×H×4), in place on base.
export function compositeOver(base: Uint8Array, text: Uint8Array): void {
  for (let o = 0; o < base.length; o += 4) {
    const a = text[o + 3];
    if (a === 0) continue;
    if (a === 255) {
      base[o] = text[o]; base[o + 1] = text[o + 1]; base[o + 2] = text[o + 2];
      continue;
    }
    const af = a / 255, ia = 1 - af;
    base[o] = (text[o] * af + base[o] * ia) | 0;
    base[o + 1] = (text[o + 1] * af + base[o + 1] * ia) | 0;
    base[o + 2] = (text[o + 2] * af + base[o + 2] * ia) | 0;
  }
}
