export interface Glyph {
  id: string;
  codepoint: string | null;
  character: string | null;
  labels: { kind: "unicode" | "codepoint" | "tag"; value: string }[];
  width: number;
  height: number;
  rowBytes: number;
  advanceX: number;
  metrics: {
    leftBearing: number;
    rightBearing: number;
    shiftUp: number;
    [key: string]: number;
  };
  rows: string[];
  sourceCode: Record<string, unknown> | null;
  comment?: string;
}
export interface FontSummary {
  id: string;
  name: string;
  family: string;
  kind: string;
  availability: string;
  cell: {
    width: number;
    height: number;
    monospace: boolean;
    pixelAspectRatio: Record<string, unknown>;
  };
  metrics: { baseline: number; advanceX: number; [key: string]: unknown };
  bitmap: { encoding: string; bitOrder: string; bitsPerPixel: number };
  coverage: {
    glyphCount: number;
    unicodeGlyphCount: number;
    unmappedGlyphCount: number;
    ukrainian: {
      required: number;
      present: number | null;
      missing: string[] | null;
      complete: boolean | null;
    };
  };
  collection: string;
  licenseId: string;
  licenseStatus: string;
  sha256: string;
  bytes: number;
  url: string;
  metaUrl: string;
  metaSha256: string;
  metaBytes: number;
}
export interface FontRecord extends Omit<
  FontSummary,
  | "licenseId"
  | "licenseStatus"
  | "collection"
  | "sha256"
  | "bytes"
  | "url"
  | "metaUrl"
  | "metaSha256"
  | "metaBytes"
> {
  format: string;
  schemaVersion: string;
  version: string | number;
  encodings: Record<string, unknown>[];
  license: Record<string, unknown>;
  source: Record<string, unknown>;
  provenance: Record<string, unknown>;
  modifications: Record<string, unknown>[];
  glyphs: Glyph[] | null;
}
export interface Assets {
  fetch: (request: Request | string) => Promise<Response>;
}
export interface FontFilter {
  q?: string;
  availability?: string;
  ukrainian?: string;
  license?: string;
  collection?: string;
  limit?: number;
  offset?: number;
  snapshot?: string;
  spacing?: string;
  width?: number;
  height?: number;
  sort?: string;
}
export interface GlyphFilter {
  chars?: string;
  limit?: number;
  offset?: number;
}
