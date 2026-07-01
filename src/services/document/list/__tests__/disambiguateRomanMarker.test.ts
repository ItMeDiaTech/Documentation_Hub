import { disambiguateRomanMarker } from "../list-detection";

describe("disambiguateRomanMarker", () => {
  it("treats a lone/leading i/v/x as Roman (no prior letter run)", () => {
    expect(disambiguateRomanMarker("lowerLetter", "i. ", null)).toBe("lowerRoman");
    expect(disambiguateRomanMarker("lowerLetter", "v) ", null)).toBe("lowerRoman");
    expect(disambiguateRomanMarker("lowerLetter", "x. ", null)).toBe("lowerRoman");
  });

  it("keeps i/v/x as a letter when it continues a letter run", () => {
    // …h, i, j…  → "i" (9) follows "h" (8)
    expect(disambiguateRomanMarker("lowerLetter", "i. ", 8)).toBe("lowerLetter");
    // …u, v…     → "v" (22) follows "u" (21)
    expect(disambiguateRomanMarker("lowerLetter", "v. ", 21)).toBe("lowerLetter");
    // …w, x…     → "x" (24) follows "w" (23)
    expect(disambiguateRomanMarker("lowerLetter", "x. ", 23)).toBe("lowerLetter");
  });

  it("re-classifies i/v/x as Roman when the prior letter does not lead into it", () => {
    // "i" after "a" (1) is not a continuation (a→…→i skips), so treat as Roman
    expect(disambiguateRomanMarker("lowerLetter", "i. ", 1)).toBe("lowerRoman");
  });

  it("leaves non-roman-glyph letters untouched", () => {
    expect(disambiguateRomanMarker("lowerLetter", "a. ", null)).toBe("lowerLetter");
    expect(disambiguateRomanMarker("lowerLetter", "b. ", 1)).toBe("lowerLetter");
  });

  it("ignores non-lowerLetter formats and missing prefixes", () => {
    expect(disambiguateRomanMarker("decimal", "1. ", null)).toBe("decimal");
    expect(disambiguateRomanMarker("lowerRoman", "ii. ", null)).toBe("lowerRoman");
    expect(disambiguateRomanMarker("lowerLetter", null, null)).toBe("lowerLetter");
  });
});
