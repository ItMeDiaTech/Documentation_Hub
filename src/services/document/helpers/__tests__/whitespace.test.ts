import { vi, describe, it, expect, beforeEach, type Mocked } from "vitest";
import { Run, ImageRun, Image } from "docxmlater";
import { normalizeRunWhitespace } from "../whitespace";

vi.mock("docxmlater");
vi.mock("../../blanklines", () => ({
  isImageSmall: vi.fn(),
}));

import { isImageSmall } from "../../blanklines";
const mockIsImageSmall = isImageSmall as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────

function createTextRun(text: string): Mocked<Run> {
  let currentText = text;
  return {
    getText: vi.fn().mockImplementation(() => currentText),
    setText: vi.fn().mockImplementation((t: string) => { currentText = t; }),
  } as unknown as Mocked<Run>;
}

function createImageRun(small: boolean): Mocked<ImageRun> {
  const mockImage = {} as Image;
  const imgRun = Object.create(ImageRun.prototype);
  imgRun.getText = vi.fn().mockReturnValue(null);
  imgRun.setText = vi.fn();
  imgRun.getImageElement = vi.fn().mockReturnValue(mockImage);

  mockIsImageSmall.mockImplementation((img: Image) =>
    img === mockImage ? small : false
  );

  return imgRun as unknown as Mocked<ImageRun>;
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
  });

  // ── Empty / null runs ──

  describe("empty runs", () => {
    it("should handle empty text run", () => {
      const run = createTextRun("");
      const count = normalizeRunWhitespace([run]);
      expect(count).toBe(0);
    });

    it("should handle null text run", () => {
      const run = { getText: vi.fn().mockReturnValue(null), setText: vi.fn() } as unknown as Mocked<Run>;
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
});
