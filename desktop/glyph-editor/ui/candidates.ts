import { pack, type Glyph, type Derivation } from "./model";
export interface Candidate {
  id: string;
  method: "cnn" | "retrieval" | "reference" | "homograph" | "geometry";
  styleReferenceFont?: {
    fontId: string;
    sha256: string;
    name: string;
    licenseId: string;
  };
  operation?: string;
  model: string;
  checkpointSha256: string | null;
  width: number;
  height: number;
  rowBytes: number;
  rows: string[];
  styleDistance: number;
  sourceGlyphId: string;
  sourceChar?: string;
  sourceFontId: string;
  sourceSha256: string;
  sourceLicenseId: string;
  sourceLicense: Record<string, unknown>;
  source: Record<string, unknown>;
  references: string[];
}
const OPERATIONS: Record<string, string> = {
  "mirror-x": "дзеркало ↔",
  "mirror-y": "дзеркало ↕",
  "rotate-180": "поворот 180°",
  "compose-k-mirror": "гілки + дзеркало",
  "compose-stem-oval": "штрих + овал",
  "compose-open-bowl-bar": "дуга + перекладина",
};
export function candidateLabel(candidate: Candidate) {
  return candidate.method === "geometry"
    ? `Із латинки · ${candidate.sourceChar ?? ""} · ${OPERATIONS[candidate.operation ?? ""] ?? "трансформація"}`
    : candidate.method === "homograph"
      ? `Латинський двійник · ${candidate.sourceChar ?? ""}`
      : candidate.method === "reference"
        ? "Із референсу"
        : candidate.method === "cnn"
          ? "CNN · експеримент"
          : "Retrieval";
}
export interface CandidateResult {
  filteredNeural?: number;
  format: string;
  schemaVersion: number;
  fontId: string;
  baseSha256: string;
  snapshot: string;
  glyphId: string;
  character: string;
  revision: number;
  targetSignature: string;
  candidates: Candidate[];
  seconds: number;
  device: string;
}
export function glyphSignature(g: Glyph) {
  return JSON.stringify([
    g.id,
    g.width,
    g.height,
    g.advanceX,
    g.rows,
    g.metrics,
    g.labels,
  ]);
}
export function candidateGlyph(target: Glyph, candidate: Candidate): Glyph {
  if (
    !candidate ||
    candidate.width !== target.width ||
    candidate.height !== target.height ||
    candidate.rowBytes !== Math.ceil(target.width / 8) ||
    !Array.isArray(candidate.rows) ||
    candidate.rows.length !== target.height ||
    !candidate.rows.every(
      (row) =>
        typeof row === "string" &&
        new RegExp(`^[0-9A-Fa-f]{${candidate.rowBytes * 2}}$`).test(row),
    )
  )
    throw new Error("Кандидат має несумісний растр");
  const padding = target.width % 8 ? (1 << (8 - (target.width % 8))) - 1 : 0;
  if (
    candidate.rows.some(
      (row) => padding && parseInt(row.slice(-2), 16) & padding,
    )
  )
    throw new Error("Некоректні padding-біти кандидата");
  if (
    !["cnn", "retrieval", "reference", "homograph", "geometry"].includes(
      candidate.method,
    ) ||
    (candidate.operation !== undefined &&
      !Object.hasOwn(OPERATIONS, candidate.operation)) ||
    !/^g\d{6}$/.test(candidate.sourceGlyphId) ||
    !/^[a-z0-9][a-z0-9._-]{0,159}$/.test(candidate.sourceFontId) ||
    !/^[a-f0-9]{64}$/.test(candidate.sourceSha256) ||
    !Array.isArray(candidate.references) ||
    candidate.references.length > 64 ||
    !candidate.references.every((id) => /^g\d{6}$/.test(id)) ||
    !candidate.sourceLicense ||
    typeof candidate.sourceLicense !== "object" ||
    !candidate.source ||
    typeof candidate.source !== "object" ||
    typeof candidate.model !== "string" ||
    candidate.model.length > 100 ||
    (candidate.method === "cnn" &&
      !/^[a-f0-9]{64}$/.test(candidate.checkpointSha256 ?? ""))
  )
    throw new Error("Неповне походження кандидата");
  return {
    ...structuredClone(target),
    rows: candidate.rows.map((row) => row.toUpperCase()),
  };
}
export function candidateDerivation(
  target: Glyph,
  candidate: Candidate,
  character = target.character ?? "",
): Derivation {
  candidateGlyph(target, candidate);
  return {
    sourceGlyphId: candidate.sourceGlyphId,
    sourceFontId: candidate.sourceFontId,
    sourceSha256: candidate.sourceSha256,
    sourceLicenseId: candidate.sourceLicenseId,
    sourceChar: candidate.sourceChar ?? character,
    targetChar: character,
    transform: candidate.operation ?? "style-candidate",
    kind: "generation",
    recipeVersion: 1,
    generation: {
      method: candidate.method,
      model: candidate.model,
      checkpointSha256: candidate.checkpointSha256,
      styleReferenceGlyphIds: [...candidate.references],
      ...(candidate.styleReferenceFont
        ? { styleReferenceFont: structuredClone(candidate.styleReferenceFont) }
        : {}),
      sourceLicense: structuredClone(candidate.sourceLicense),
      source: structuredClone(candidate.source),
    },
  };
}
export function hiddenTarget(glyph: Glyph) {
  return {
    ...structuredClone(glyph),
    rows: pack(
      new Uint8Array(glyph.width * glyph.height),
      glyph.width,
      glyph.height,
    ),
  };
}
