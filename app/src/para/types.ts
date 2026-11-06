export interface Glyph {
  codepoint: string;
  character: string;
  advanceX: number;
  rows: string[];
  sourceCode: Record<string, unknown> | null;
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
  bitmap: { encoding: string; bitOrder: string; rowBytes: number };
  coverage: {
    glyphCount: number;
    ukrainian: {
      required: number;
      present: number | null;
      missing: string[] | null;
      complete: boolean | null;
    };
  };
  licenseId: string;
  sha256: string;
  bytes: number;
  url: string;
}
export interface FontRecord extends Omit<
  FontSummary,
  "licenseId" | "sha256" | "bytes" | "url"
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
}
export interface GlyphFilter {
  chars?: string;
  limit?: number;
  offset?: number;
}
