// UPA colour palette (A,C-G; B is the background/paper). Browser-safe: no Worker imports.
export type UpaColor = "A" | "C" | "D" | "E" | "F" | "G";

export const UPA_PALETTE: Record<UpaColor, [number, number, number]> = {
  A: [0xdc, 0x14, 0x3c],
  C: [0x00, 0x47, 0xab],
  D: [0x0a, 0x0a, 0x0a],
  E: [0x1e, 0x7a, 0x2e],
  F: [0xe3, 0xc2, 0x0b],
  G: [0xd2, 0x69, 0x1e],
};
