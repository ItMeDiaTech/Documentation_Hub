import { parseTypedMarkerValue } from "../list-detection";

describe("parseTypedMarkerValue", () => {
  it("parses decimal markers", () => {
    expect(parseTypedMarkerValue("1. ")).toBe(1);
    expect(parseTypedMarkerValue("2) ")).toBe(2);
    expect(parseTypedMarkerValue("10. ")).toBe(10);
    expect(parseTypedMarkerValue("42. Something")).toBe(42);
  });

  it("parses single-letter markers as letter ordinals", () => {
    expect(parseTypedMarkerValue("a. ")).toBe(1);
    expect(parseTypedMarkerValue("c) ")).toBe(3);
    expect(parseTypedMarkerValue("A. ")).toBe(1);
  });

  it("parses multi-character Roman-numeral markers", () => {
    // Multi-char romans are unambiguous (cannot be a single letter).
    expect(parseTypedMarkerValue("iv. ")).toBe(4);
    expect(parseTypedMarkerValue("ix) ")).toBe(9);
    expect(parseTypedMarkerValue("xiv. ")).toBe(14);
  });

  it("treats a single i/v/x as a letter ordinal (context-free ambiguity)", () => {
    // Without surrounding context a lone "i"/"v"/"x" is read as the 9th/22nd/24th
    // letter, not Roman 1/5/10. Disambiguation by neighbors is the detector's job
    // (detectTypedPrefix), not this context-free parser.
    expect(parseTypedMarkerValue("i. ")).toBe(9);
    expect(parseTypedMarkerValue("v. ")).toBe(22);
    expect(parseTypedMarkerValue("x. ")).toBe(24);
  });

  it("returns null for non-ordinal / bullet prefixes and empty input", () => {
    expect(parseTypedMarkerValue("• ")).toBeNull();
    expect(parseTypedMarkerValue("- ")).toBeNull();
    expect(parseTypedMarkerValue(null)).toBeNull();
    expect(parseTypedMarkerValue("")).toBeNull();
  });

  it("supports the continue-vs-restart decision (value === previous + 1)", () => {
    // A "3." after a "2." is a continuation; a "1." is a new list.
    const prev = parseTypedMarkerValue("2. ");
    expect(parseTypedMarkerValue("3. ")).toBe((prev as number) + 1);
    expect(parseTypedMarkerValue("1. ")).not.toBe((prev as number) + 1);
  });
});
