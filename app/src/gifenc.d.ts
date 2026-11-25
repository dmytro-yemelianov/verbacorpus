// gifenc does not ship declarations. These are the encoder APIs used by cards.
declare module "gifenc" {
  type Palette = number[][];
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, options?: {
      palette?: Palette;
      delay?: number;
    }): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  };
  export function applyPalette(rgba: Uint8Array, palette: Palette, format: "rgb565"): Uint8Array<ArrayBuffer>;
}
