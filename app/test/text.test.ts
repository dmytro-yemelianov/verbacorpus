import { describe, it, expect } from "vitest";
import { prettify } from "../src/shared/text";

describe("prettify", () => {
  it("straight quotes → « »", () => expect(prettify('"А?" - "Б!"')).toBe("«А?» — «Б!»"));
  it("apostrophe → typographic", () => expect(prettify("нап'є")).toBe("нап’є"));
  it("ellipsis → …", () => expect(prettify("ой...")).toBe("ой…"));
  it("word hyphen untouched", () => expect(prettify("будь-що")).toBe("будь-що"));
  it("idempotent on already-pretty", () => expect(prettify("«А» — «Б»")).toBe("«А» — «Б»"));
});
