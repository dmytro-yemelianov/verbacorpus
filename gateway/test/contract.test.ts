import { describe, it, expect } from "vitest";
import {
  ApiError,
  LICENCES,
  errorResponse,
  globalId,
  parseGlobalId,
} from "../src/contract";

describe("contract", () => {
  it("parses and builds global ids", () => {
    expect(parseGlobalId("pro:p037464")).toEqual({ corpus: "pro", localId: "p037464" });
    expect(parseGlobalId("non:p15_-_b02")).toEqual({ corpus: "non", localId: "p15_-_b02" });
    expect(parseGlobalId("para:cozette-6x13/U+0456")).toEqual({
      corpus: "para",
      localId: "cozette-6x13/U+0456",
    });
    expect(parseGlobalId("re:x")).toBeNull();
    expect(parseGlobalId("pro:")).toBeNull();
    expect(globalId("contra", "3f2a9c01de")).toBe("contra:3f2a9c01de");
  });

  it("licences follow spec §5.3", () => {
    expect(LICENCES.pro).toMatchObject({ id: "CC-BY-4.0", status: "granted" });
    expect(LICENCES.non).toMatchObject({
      id: null,
      status: "terms-pending",
      attribution: "Hough, 2025 / Габданк-Рогозинський",
    });
    expect(LICENCES.contra).toMatchObject({ id: null, status: "terms-pending" });
    expect(LICENCES.contra.attribution).toContain("Ставицька");
  });

  it("errors use the shared envelope", async () => {
    const r = errorResponse(new ApiError(404, "not_found", "nope"));
    expect(r.status).toBe(404);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(await r.json()).toEqual({ error: { code: "not_found", message: "nope" } });
  });
});
