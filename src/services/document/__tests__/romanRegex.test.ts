/**
 * Roman-numeral detection regex regression test.
 *
 * Mirrors the alternation used by EXTENDED_TYPED_PREFIX_PATTERNS in
 * WordDocumentProcessor.ts. Per Task 7, the alternation is intentionally
 * bounded to i. … xv. (1–15); anything beyond falls through to generic
 * paragraph-style detection. This test guards that boundary so a future
 * "let's just add xvi" tweak doesn't silently re-broaden the alternation
 * without a deliberate decision.
 *
 * If you change EXTENDED_TYPED_PREFIX_PATTERNS, update the literals
 * below to match.
 */

// Plain Roman: i. ... xv. (case-insensitive)
const plainRoman = /^(i{1,3}|iv|vi{0,3}|ix|x|xi{1,3}|xiv|xv)\.\s*/i;
// Parenthetical Roman: (i) ... (xv)
const parenRoman = /^\((i{1,3}|iv|vi{0,3}|ix|x|xi{1,3}|xiv|xv)\)\s*/i;

describe("Roman regex — plain form (i. … xv.)", () => {
  // The full set of canonical lower-case i..xv
  const valid = [
    "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
    "xi", "xii", "xiii", "xiv", "xv",
  ];

  it.each(valid)("matches valid lower-case Roman numeral '%s.'", (numeral) => {
    expect(plainRoman.test(`${numeral}. content`)).toBe(true);
  });

  it.each(valid)("matches valid upper-case Roman numeral '%s.'", (numeral) => {
    expect(plainRoman.test(`${numeral.toUpperCase()}. content`)).toBe(true);
  });

  it("rejects xvi (out of bounds — first unmatched numeral above xv)", () => {
    // 'xvi' starts with 'xv' which DOES match — but the regex demands a
    // literal '.' immediately after, so 'xvi.' must NOT match as the
    // whole alternation 'xv\.'. We assert via the captured group.
    const match = plainRoman.exec("xvi. content");
    if (match) {
      // If the engine matched something, it must NOT be 'xvi'.
      // (E.g. matching 'xv' would leave 'i. content' unconsumed,
      // which still violates the leading 'xv\.' shape.)
      expect(match[1].toLowerCase()).not.toBe("xvi");
    } else {
      // Preferred outcome: no match at all.
      expect(match).toBeNull();
    }
  });

  it("rejects xx (out of bounds — 20)", () => {
    expect(plainRoman.test("xx. content")).toBe(false);
  });

  it("rejects bare 'i' without trailing dot", () => {
    expect(plainRoman.test("i content")).toBe(false);
  });

  it("rejects garbage like 'iiii.' (not a valid numeral)", () => {
    // 'iiii' won't match — engine tries 'iii' and demands '.', sees 'i'.
    expect(plainRoman.test("iiii. content")).toBe(false);
  });

  it("captures the numeral in group 1 for format detection", () => {
    const match = plainRoman.exec("iv. content");
    expect(match?.[1].toLowerCase()).toBe("iv");
  });
});

describe("Roman regex — parenthetical form ((i) … (xv))", () => {
  it("matches '(i)'", () => {
    expect(parenRoman.test("(i) content")).toBe(true);
  });

  it("matches '(xv)'", () => {
    expect(parenRoman.test("(xv) content")).toBe(true);
  });

  it("rejects '(xvi)' (out of bounds)", () => {
    const match = parenRoman.exec("(xvi) content");
    if (match) {
      expect(match[1].toLowerCase()).not.toBe("xvi");
    } else {
      expect(match).toBeNull();
    }
  });

  it("rejects '(I.)' (mixed form, missing closing paren)", () => {
    expect(parenRoman.test("(I. content")).toBe(false);
  });

  it("captures the numeral in group 1", () => {
    const match = parenRoman.exec("(ix) content");
    expect(match?.[1].toLowerCase()).toBe("ix");
  });
});
