import { describe, it, expect } from "vitest";
import { toShort, fromShort, shortUrl } from "../src/shared/shortlink";

describe("toShort", () => {
  it("strips the p + leading zeros", () => { expect(toShort("p000126")).toBe("126"); expect(toShort("p000001")).toBe("1"); expect(toShort("p048787")).toBe("48787"); });
});
describe("fromShort", () => {
  const N = 48787;
  it("pads back to the id", () => { expect(fromShort("126", N)).toBe("p000126"); expect(fromShort("1", N)).toBe("p000001"); expect(fromShort("48787", N)).toBe("p048787"); });
  it("rejects junk / out-of-range / leading-zero aliases", () => {
    expect(fromShort("0", N)).toBeNull();
    expect(fromShort("abc", N)).toBeNull();
    expect(fromShort("p1", N)).toBeNull();
    expect(fromShort("01", N)).toBeNull();   // no leading-zero aliases
    expect(fromShort("48788", N)).toBeNull(); // out of range
    expect(fromShort("", N)).toBeNull();
  });
});
describe("shortUrl", () => {
  it("builds the absolute short link", () => expect(shortUrl("p000126", "verbacorpus.org")).toBe("https://verbacorpus.org/s/126"));
});
