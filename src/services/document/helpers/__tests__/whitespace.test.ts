import { Run, ImageRun, Image } from "docxmlater";
import { normalizeRunWhitespace } from "../whitespace";

jest.mock("docxmlater");
jest.mock("../../blanklines", () => ({
  isImageSmall: jest.fn(),
}));

import { isImageSmall } from "../../blanklines";
const mockIsImageSmall = isImageSmall as ReturnType<typeof jest.fn>;

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────

function createTextRun(text: string): jest.Mocked<Run> {
  let currentText = text;
  return {
    getText: jest.fn().mockImplementation(() => currentText),
    setText: jest.fn().mockImplementation((t: string) => {
      currentText = t;
    }),
  } as unknown as jest.Mocked<Run>;
}

function createImageRun(small: boolean): jest.Mocked<ImageRun> {
  const mockImage = {} as Image;
  const imgRun = Object.create(ImageRun.prototype);
  imgRun.getText = jest.fn().mockReturnValue(null);
  imgRun.setText = jest.fn();
  imgRun.getImageElement = jest.fn().mockReturnValue(mockImage);

  mockIsImageSmall.mockImplementation((img: Image) => (img === mockImage ? small : false));

  return imgRun as unknown as jest.Mocked<ImageRun>;
}

/** Create a mock Run whose getContent() returns a VML element (legacy image format) */
function createVmlImageRun(): jest.Mocked<Run> {
  return {
    getText: jest.fn().mockReturnValue(""),
    setText: jest.fn(),
    getContent: jest.fn().mockReturnValue([{ type: "vml" }]),
  } as unknown as jest.Mocked<Run>;
}

// ── Tests ────────────────────────────────────────────────

describe("normalizeRunWhitespace", () => {
  // ── Basic whitespace collapse ──

  describe("double-space collapse", () => {
    it("should collapse multiple spaces to single", () => {
      const run = createTextRun("Hello  world");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(1);
      expect(run.setText).toHaveBeenCalledWith("Hello world");
    });

    it("should collapse many spaces", () => {
      const run = createTextRun("Text   with   spaces");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(1);
      expect(run.setText).toHaveBeenCalledWith("Text with spaces");
    });

    it("should not modify text without extra spaces", () => {
      const run = createTextRun("Normal text");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(0);
      expect(run.setText).not.toHaveBeenCalled();
    });
  });

  // ── Leading space stripping ──

  describe("leading space stripping", () => {
    it("should strip leading spaces at paragraph start", () => {
      const run = createTextRun("  Hello");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(1);
      expect(run.setText).toHaveBeenCalledWith("Hello");
    });

    it("should strip leading spaces and collapse inner spaces", () => {
      const run = createTextRun("   Hello   world");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(1);
      expect(run.setText).toHaveBeenCalledWith("Hello world");
    });

    it("should strip across whitespace-only first run", () => {
      const run0 = createTextRun("   ");
      const run1 = createTextRun(" Content");
      const count = normalizeRunWhitespace([run0, run1]);
      expect(count).toBe(2);
      expect(run0.setText).toHaveBeenCalledWith("");
      expect(run1.setText).toHaveBeenCalledWith("Content");
    });

    it("should NOT strip leading spaces from mid-paragraph runs", () => {
      const run0 = createTextRun("Hello");
      const run1 = createTextRun("   world");
      const count = normalizeRunWhitespace([run0, run1]);
      expect(count).toBe(1);
      expect(run0.setText).not.toHaveBeenCalled();
      expect(run1.setText).toHaveBeenCalledWith(" world");
    });
  });

  // ── Space-only run merging (pre-pass) ──

  describe("space-only run merging", () => {
    it("should merge mid-paragraph space-only run into previous text run", () => {
      const run0 = createTextRun("Refund");
      const run1 = createTextRun(" ");
      const run2 = createTextRun("reminders");
      const count = normalizeRunWhitespace([run0, run1, run2]);
      // Pre-pass merges " " into "Refund" → "Refund ", then clears run1
      expect(run0.setText).toHaveBeenCalledWith("Refund ");
      expect(run1.setText).toHaveBeenCalledWith("");
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it("should NOT merge paragraph-start space-only run (let Step 1.5 strip it)", () => {
      const run0 = createTextRun(" ");
      const run1 = createImageRun(true);
      const run2 = createTextRun(" Requests are only honored...");
      const runs = [run0, run1 as unknown as Run, run2];
      normalizeRunWhitespace(runs);
      // The pre-pass should NOT merge run0 into run1 (image) or run2
      // Instead, Step 1.5 should strip the leading space
      // run0 starts as " ", Step 1.5 strips it to ""
      expect(run0.setText).toHaveBeenCalledWith("");
    });

    it("should merge space-only run into next run when no previous text run", () => {
      const img = createImageRun(false);
      const run1 = createTextRun(" ");
      const run2 = createTextRun("text");
      const runs = [img as unknown as Run, run1, run2];
      normalizeRunWhitespace(runs);
      // After image, run1 is space-only → merge into run2
      expect(run1.setText).toHaveBeenCalledWith("");
      expect(run2.setText).toHaveBeenCalledWith(" text");
    });

    it("should handle multiple space-only runs between content", () => {
      const run0 = createTextRun("Examples:");
      const run1 = createTextRun(" ");
      const run2 = createTextRun("high");
      const count = normalizeRunWhitespace([run0, run1, run2]);
      expect(run0.setText).toHaveBeenCalledWith("Examples: ");
      expect(run1.setText).toHaveBeenCalledWith("");
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Non-breaking space (U+00A0) collapse ──

  describe("non-breaking space (U+00A0) collapse", () => {
    it("should collapse multiple NBSPs to single regular space", () => {
      const run = createTextRun("Hello\u00A0\u00A0world");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(1);
      expect(run.setText).toHaveBeenCalledWith("Hello world");
    });

    it("should collapse mixed regular space and NBSP", () => {
      const run = createTextRun("Hello \u00A0world");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(1);
      expect(run.setText).toHaveBeenCalledWith("Hello world");
    });

    it("should collapse NBSP + regular space", () => {
      const run = createTextRun("Hello\u00A0 world");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(1);
      expect(run.setText).toHaveBeenCalledWith("Hello world");
    });

    it("should NOT collapse a single NBSP", () => {
      const run = createTextRun("Hello\u00A0world");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(0);
      expect(run.setText).not.toHaveBeenCalled();
    });

    it("should strip leading NBSP at paragraph start", () => {
      const run = createTextRun("\u00A0Hello");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(1);
      expect(run.setText).toHaveBeenCalledWith("Hello");
    });

    it("should strip mixed leading spaces and NBSPs at paragraph start", () => {
      const run = createTextRun(" \u00A0 Hello");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(1);
      expect(run.setText).toHaveBeenCalledWith("Hello");
    });
  });

  // ── Cross-run NBSP double space ──

  describe("cross-run NBSP double space", () => {
    it("should trim trailing NBSP when next run starts with space", () => {
      const run0 = createTextRun("hello\u00A0");
      const run1 = createTextRun(" world");
      const count = normalizeRunWhitespace([run0, run1]);
      expect(count).toBe(1);
      expect(run0.setText).toHaveBeenCalledWith("hello");
      expect(run1.setText).not.toHaveBeenCalled();
    });

    it("should trim trailing space when next run starts with NBSP", () => {
      const run0 = createTextRun("hello ");
      const run1 = createTextRun("\u00A0world");
      const count = normalizeRunWhitespace([run0, run1]);
      expect(count).toBe(1);
      expect(run0.setText).toHaveBeenCalledWith("hello");
      expect(run1.setText).not.toHaveBeenCalled();
    });
  });

  // ── Tab preservation ──

  describe("tab preservation", () => {
    it("should not strip leading tabs from paragraph start", () => {
      const run = createTextRun("\tHello world");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(0);
      expect(run.setText).not.toHaveBeenCalled();
    });
  });

  // ── Cross-run double space ──

  describe("cross-run double space", () => {
    it("should trim trailing space when next run starts with space", () => {
      const run0 = createTextRun("hello ");
      const run1 = createTextRun(" world");
      const count = normalizeRunWhitespace([run0, run1]);
      expect(count).toBe(1);
      expect(run0.setText).toHaveBeenCalledWith("hello");
      expect(run1.setText).not.toHaveBeenCalled();
    });

    it("should detect cross-run double space across empty runs (step 2)", () => {
      const run0 = createTextRun("word ");
      const emptyRun = createTextRun("");
      const run2 = createTextRun(" word");
      const count = normalizeRunWhitespace([run0, emptyRun, run2]);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(run0.setText).toHaveBeenCalledWith("word");
    });

    it("should detect cross-run double space across empty runs (step 3)", () => {
      const run0 = createTextRun("word ");
      const emptyRun = createTextRun("");
      const run2 = createTextRun(" word");
      const count = normalizeRunWhitespace([run0, emptyRun, run2]);
      expect(count).toBeGreaterThanOrEqual(1);
      // run0 trailing space trimmed in step 2, so run2 leading space is preserved
      expect(run2.setText).not.toHaveBeenCalled();
    });

    it("should detect cross-run double space across null-text runs", () => {
      const run0 = createTextRun("word ");
      const nullRun = {
        getText: jest.fn().mockReturnValue(null),
        setText: jest.fn(),
      } as unknown as jest.Mocked<Run>;
      const run2 = createTextRun(" word");
      const count = normalizeRunWhitespace([run0, nullRun as unknown as Run, run2]);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(run0.setText).toHaveBeenCalledWith("word");
    });
  });

  // ── Empty / null runs ──

  describe("empty runs", () => {
    it("should handle empty text run", () => {
      const run = createTextRun("");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(0);
    });

    it("should handle null text run", () => {
      const run = {
        getText: jest.fn().mockReturnValue(null),
        setText: jest.fn(),
      } as unknown as jest.Mocked<Run>;
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(0);
    });
  });

  // ── ImageRun interactions ──

  describe("image run - space insertion", () => {
    it("should insert space after small image when text has none", () => {
      const imgRun = createImageRun(true);
      const textRun = createTextRun("CC: supervisor");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      expect(count).toBe(1);
      expect(textRun.setText).toHaveBeenCalledWith(" CC: supervisor");
    });

    it("should NOT insert space after small image when text already has one", () => {
      const imgRun = createImageRun(true);
      const textRun = createTextRun(" CC: supervisor");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      expect(count).toBe(0);
      expect(textRun.setText).not.toHaveBeenCalled();
    });

    it("should collapse multiple spaces after small image via regex on next iteration", () => {
      const imgRun = createImageRun(true);
      // Text starts with multiple spaces — no insertion needed, regex collapses
      const textRun = createTextRun("   CC: supervisor");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      // The space starts with " " so no insertion; regex collapse handles it
      expect(count).toBe(1);
      expect(textRun.setText).toHaveBeenCalledWith(" CC: supervisor");
    });

    it("should NOT insert space after large image", () => {
      const imgRun = createImageRun(false);
      const textRun = createTextRun("Caption");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      expect(count).toBe(0);
      expect(textRun.setText).not.toHaveBeenCalled();
    });

    it("should NOT insert space when image is at end of paragraph", () => {
      const imgRun = createImageRun(true);
      const count = normalizeRunWhitespace([imgRun] as Run[]);
      expect(count).toBe(0);
    });

    it("should handle consecutive images then text", () => {
      const img1 = createImageRun(true);
      const img2 = createImageRun(true);
      const textRun = createTextRun("text");

      // img1's next is img2 (getText returns null) — no insertion
      // img2's next is textRun ("text" no leading space) — insertion
      const count = normalizeRunWhitespace([img1, img2, textRun] as Run[]);
      expect(count).toBe(1);
      expect(textRun.setText).toHaveBeenCalledWith(" text");
    });

    it("should NOT insert space after small image when text starts with tab", () => {
      const imgRun = createImageRun(true);
      const textRun = createTextRun("\tsome text");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      expect(count).toBe(0);
      expect(textRun.setText).not.toHaveBeenCalled();
    });

    it("should preserve seenTextInParagraph after image (no leading strip)", () => {
      const imgRun = createImageRun(false);
      const textRun = createTextRun(" text after image");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      // The leading space should be preserved because image set seenTextInParagraph
      expect(count).toBe(0);
      expect(textRun.setText).not.toHaveBeenCalled();
    });
  });

  // ── Variant space stripping after small images ──

  describe("image run - variant space stripping", () => {
    it("should strip en space and ensure one regular space", () => {
      const imgRun = createImageRun(true);
      const textRun = createTextRun("\u2002CC: supervisor");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      expect(count).toBe(1);
      expect(textRun.setText).toHaveBeenCalledWith(" CC: supervisor");
    });

    it("should strip em space and ensure one regular space", () => {
      const imgRun = createImageRun(true);
      const textRun = createTextRun("\u2003CC: supervisor");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      expect(count).toBe(1);
      expect(textRun.setText).toHaveBeenCalledWith(" CC: supervisor");
    });

    it("should strip non-breaking space and ensure one regular space", () => {
      const imgRun = createImageRun(true);
      const textRun = createTextRun("\u00A0CC: supervisor");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      expect(count).toBe(1);
      expect(textRun.setText).toHaveBeenCalledWith(" CC: supervisor");
    });

    it("should strip mixed variant and regular spaces to one regular space", () => {
      const imgRun = createImageRun(true);
      const textRun = createTextRun(" \u2003 \u2002CC: supervisor");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      expect(count).toBe(1);
      expect(textRun.setText).toHaveBeenCalledWith(" CC: supervisor");
    });

    it("should clear intermediate variant-space-only run and add space to text run", () => {
      const imgRun = createImageRun(true);
      const spaceRun = createTextRun("\u2003");
      const textRun = createTextRun("CC: supervisor");
      const count = normalizeRunWhitespace([imgRun, spaceRun, textRun] as Run[]);
      expect(count).toBe(2);
      expect(spaceRun.setText).toHaveBeenCalledWith("");
      expect(textRun.setText).toHaveBeenCalledWith(" CC: supervisor");
    });

    it("should not strip variant spaces from mid-text positions", () => {
      const imgRun = createImageRun(true);
      const textRun = createTextRun("Hello\u2003world");
      const count = normalizeRunWhitespace([imgRun, textRun] as Run[]);
      expect(count).toBe(1);
      // Only leading space added; the mid-text em space is preserved
      expect(textRun.setText).toHaveBeenCalledWith(" Hello\u2003world");
    });
  });

  // ── VML image run handling ──

  describe("VML image run - space insertion", () => {
    it("should insert space after VML image when text has none", () => {
      const vmlRun = createVmlImageRun();
      const textRun = createTextRun("For FEP mail tag");
      const count = normalizeRunWhitespace([vmlRun, textRun]);
      expect(count).toBe(1);
      expect(textRun.setText).toHaveBeenCalledWith(" For FEP mail tag");
    });

    it("should NOT strip leading space after VML image (seenTextInParagraph)", () => {
      const vmlRun = createVmlImageRun();
      const textRun = createTextRun(" The following are not eligible");
      const count = normalizeRunWhitespace([vmlRun, textRun]);
      // Space already exists — no change needed
      expect(count).toBe(0);
      expect(textRun.setText).not.toHaveBeenCalled();
    });

    it("should preserve space in separate run after VML image", () => {
      const vmlRun = createVmlImageRun();
      const spaceRun = createTextRun(" ");
      const textRun = createTextRun("For FEP mail tag");
      const count = normalizeRunWhitespace([vmlRun, spaceRun, textRun]);
      // Pre-pass merges spaceRun into textRun (can't merge into VML),
      // then image space logic sees " For FEP..." already correct → 1 total mod
      expect(count).toBe(1);
      expect(spaceRun.setText).toHaveBeenCalledWith("");
      expect(textRun.setText).toHaveBeenCalledWith(" For FEP mail tag");
    });

    it("should collapse multiple spaces after VML image to one", () => {
      const vmlRun = createVmlImageRun();
      const textRun = createTextRun("   For FEP");
      const count = normalizeRunWhitespace([vmlRun, textRun]);
      expect(count).toBe(1);
      expect(textRun.setText).toHaveBeenCalledWith(" For FEP");
    });

    it("should NOT insert space when VML image is at end of paragraph", () => {
      const vmlRun = createVmlImageRun();
      const count = normalizeRunWhitespace([vmlRun]);
      expect(count).toBe(0);
    });

    it("should NOT insert space after VML when text starts with tab", () => {
      const vmlRun = createVmlImageRun();
      const textRun = createTextRun("\tsome text");
      const count = normalizeRunWhitespace([vmlRun, textRun]);
      expect(count).toBe(0);
      expect(textRun.setText).not.toHaveBeenCalled();
    });
  });

  // ── Content gap awareness ──

  describe("content gap awareness", () => {
    it("should preserve both spaces when gap exists between runs (Step 2 + Step 3 protected)", () => {
      // Simulates: "Contact " [Revision-wrapped hyperlink] " to confirm"
      // runs[0]="Contact " and runs[1]=" to confirm" with gap at index 0
      const run0 = createTextRun("Contact ");
      const run1 = createTextRun(" to confirm");
      const gapAfter = new Set([0]);
      const count = normalizeRunWhitespace([run0, run1], gapAfter);
      // Neither space should be trimmed — invisible hyperlink content exists between them
      expect(count).toBe(0);
      expect(run0.setText).not.toHaveBeenCalled();
      expect(run1.setText).not.toHaveBeenCalled();
    });

    it("should still trim cross-run double space when no gap exists", () => {
      const run0 = createTextRun("hello ");
      const run1 = createTextRun(" world");
      // No gap — existing behavior: trailing space trimmed from run0
      const count = normalizeRunWhitespace([run0, run1], undefined);
      expect(count).toBe(1);
      expect(run0.setText).toHaveBeenCalledWith("hello");
    });

    it("should block pre-pass merge into previous across gap boundary", () => {
      const run0 = createTextRun("Contact");
      const run1 = createTextRun(" "); // space-only run after gap
      const run2 = createTextRun("to confirm");
      // Gap between run0 and run1 — space-only run1 must NOT merge into run0
      const gapAfter = new Set([0]);
      normalizeRunWhitespace([run0, run1, run2], gapAfter);
      // run1 should NOT be merged into run0 (across gap)
      // Instead it should merge forward into run2 (no gap between 1 and 2)
      expect(run1.setText).toHaveBeenCalledWith("");
      expect(run2.setText).toHaveBeenCalledWith(" to confirm");
    });

    it("should block pre-pass merge into next across gap boundary", () => {
      const run0 = createTextRun("Contact");
      const run1 = createTextRun(" "); // space-only run before gap
      const run2 = createTextRun("Compass");
      // Gap between run1 and run2 — space-only run1 must NOT merge into run2
      const gapAfter = new Set([1]);
      normalizeRunWhitespace([run0, run1, run2], gapAfter);
      // run1 should merge backward into run0 (no gap between 0 and 1)
      expect(run0.setText).toHaveBeenCalledWith("Contact ");
      expect(run1.setText).toHaveBeenCalledWith("");
    });

    it("should handle multiple gaps correctly", () => {
      // "Text " [gap] " middle " [gap] " end"
      const run0 = createTextRun("Text ");
      const run1 = createTextRun(" middle ");
      const run2 = createTextRun(" end");
      const gapAfter = new Set([0, 1]);
      const count = normalizeRunWhitespace([run0, run1, run2], gapAfter);
      // All cross-run boundaries have gaps — no trimming should occur
      expect(count).toBe(0);
      expect(run0.setText).not.toHaveBeenCalled();
      expect(run1.setText).not.toHaveBeenCalled();
      expect(run2.setText).not.toHaveBeenCalled();
    });

    it("should only protect gap boundary, other pairs still processed", () => {
      // run0="hello " run1=" middle " run2=" world"
      // Gap only between run1 and run2
      const run0 = createTextRun("hello ");
      const run1 = createTextRun(" middle ");
      const run2 = createTextRun(" world");
      const gapAfter = new Set([1]);
      normalizeRunWhitespace([run0, run1, run2], gapAfter);
      // run0→run1 has no gap: cross-run double space trimmed (run0 trailing stripped)
      expect(run0.setText).toHaveBeenCalledWith("hello");
      // run1→run2 has gap: trailing space on run1 and leading space on run2 preserved
      expect(run2.setText).not.toHaveBeenCalled();
    });

    it("should protect gap across empty runs in lookahead (Step 2 range check)", () => {
      // run0="word " emptyRun="" run2=" next" with gap spanning the range
      const run0 = createTextRun("word ");
      const emptyRun = createTextRun("");
      const run2 = createTextRun(" next");
      // Gap at index 1 (between emptyRun and run2)
      const gapAfter = new Set([1]);
      normalizeRunWhitespace([run0, emptyRun, run2], gapAfter);
      // Step 2 lookahead from run0 finds run2 at j=2 — hasGapInRange(0,2) checks indices 0,1
      // Gap at 1 is in range → trailing space preserved
      expect(run0.setText).not.toHaveBeenCalled();
    });
  });
});
