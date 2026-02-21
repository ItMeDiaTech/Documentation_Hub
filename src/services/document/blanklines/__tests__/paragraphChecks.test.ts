/**
 * Unit tests for paragraph check helper functions
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */
import {
  isParagraphBlank,
  startsWithBoldColon,
  isCenteredBoldText,
  isTextOnlyParagraph,
  isTocParagraph,
} from "../helpers/paragraphChecks";

// Mock docxmlater classes
jest.mock("docxmlater", () => {
  class MockRun {
    private text: string;
    private formatting: any;
    constructor(text: string = "", formatting: any = {}) {
      this.text = text;
      this.formatting = formatting;
    }
    getText() { return this.text; }
    getFormatting() { return this.formatting; }
  }

  class MockHyperlink {
    getText() { return "link text"; }
  }

  class MockImageRun extends MockRun {
    getImageElement() { return {}; }
  }

  class MockShape {}
  class MockTextBox {}
  class MockField {}

  class MockRevision {
    private text: string;
    private content: any[];
    constructor(text: string = "", content: any[] = []) {
      this.text = text;
      this.content = content;
    }
    getText() { return this.text; }
    getContent() { return this.content; }
  }

  class MockParagraph {
    private content: any[];
    private style: string;
    private alignment: string;
    private bookmarksStart: any[];
    private bookmarksEnd: any[];

    constructor(opts: {
      content?: any[];
      style?: string;
      alignment?: string;
      bookmarksStart?: any[];
      bookmarksEnd?: any[];
    } = {}) {
      this.content = opts.content ?? [];
      this.style = opts.style ?? "";
      this.alignment = opts.alignment ?? "left";
      this.bookmarksStart = opts.bookmarksStart ?? [];
      this.bookmarksEnd = opts.bookmarksEnd ?? [];
    }

    getContent() { return this.content; }
    getText() {
      return this.content
        .filter((c: any) => c.getText)
        .map((c: any) => c.getText())
        .join("");
    }
    getStyle() { return this.style; }
    getAlignment() { return this.alignment; }
    getBookmarksStart() { return this.bookmarksStart; }
    getBookmarksEnd() { return this.bookmarksEnd; }
    getRuns() { return this.content.filter((c: any) => c instanceof MockRun && !(c instanceof MockImageRun)); }
  }

  return {
    Paragraph: MockParagraph,
    Run: MockRun,
    Hyperlink: MockHyperlink,
    ImageRun: MockImageRun,
    Shape: MockShape,
    TextBox: MockTextBox,
    Field: MockField,
    Revision: MockRevision,
  };
});

// Import mocked module — jest.mock is hoisted above imports by Jest
import {
  Paragraph, Run, Hyperlink, ImageRun, Shape, TextBox, Field, Revision,
} from "docxmlater";

describe("isParagraphBlank", () => {
  it("should return true for empty paragraph", () => {
    const para = new Paragraph({ content: [] });
    expect(isParagraphBlank(para)).toBe(true);
  });

  it("should return true for paragraph with whitespace-only run", () => {
    const para = new Paragraph({ content: [new Run("   ")] });
    expect(isParagraphBlank(para)).toBe(true);
  });

  it("should return false for paragraph with text", () => {
    const para = new Paragraph({ content: [new Run("Hello")] });
    expect(isParagraphBlank(para)).toBe(false);
  });

  it("should return false for paragraph with hyperlink", () => {
    const para = new Paragraph({ content: [new Hyperlink()] });
    expect(isParagraphBlank(para)).toBe(false);
  });

  it("should return false for paragraph with ImageRun", () => {
    const para = new Paragraph({ content: [new ImageRun()] });
    expect(isParagraphBlank(para)).toBe(false);
  });

  it("should return false for paragraph with Shape", () => {
    const para = new Paragraph({ content: [new Shape()] });
    expect(isParagraphBlank(para)).toBe(false);
  });

  it("should return false for paragraph with TextBox", () => {
    const para = new Paragraph({ content: [new TextBox()] });
    expect(isParagraphBlank(para)).toBe(false);
  });

  it("should return false for paragraph with Field", () => {
    const para = new Paragraph({ content: [new Field()] });
    expect(isParagraphBlank(para)).toBe(false);
  });

  it("should return false for paragraph with non-empty Revision", () => {
    const para = new Paragraph({ content: [new Revision("tracked text")] });
    expect(isParagraphBlank(para)).toBe(false);
  });

  it("should return true for paragraph with bookmarks but no content (early return)", () => {
    // Note: The function returns true for empty content before checking bookmarks.
    // Bookmarks are only checked when content items exist but are all blank.
    const para = new Paragraph({
      content: [],
      bookmarksStart: [{ id: 1 }],
    });
    expect(isParagraphBlank(para)).toBe(true);
  });

  it("should return false for paragraph with bookmarks and whitespace run", () => {
    const para = new Paragraph({
      content: [new Run("  ")],
      bookmarksStart: [{ id: 1 }],
    });
    expect(isParagraphBlank(para)).toBe(false);
  });

  it("should return true for Revision with only whitespace", () => {
    const para = new Paragraph({ content: [new Revision("  ")] });
    expect(isParagraphBlank(para)).toBe(true);
  });
});

describe("startsWithBoldColon", () => {
  it("should return true for bold text with colon", () => {
    const para = new Paragraph({
      content: [new Run("Note:", { bold: true })],
    });
    expect(startsWithBoldColon(para)).toBe(true);
  });

  it("should return false for non-bold text with colon", () => {
    const para = new Paragraph({
      content: [new Run("Note:", { bold: false })],
    });
    expect(startsWithBoldColon(para)).toBe(false);
  });

  it("should return false for bold text without colon", () => {
    const para = new Paragraph({
      content: [new Run("Note", { bold: true })],
    });
    expect(startsWithBoldColon(para)).toBe(false);
  });

  it("should return false for empty paragraph", () => {
    const para = new Paragraph({ content: [] });
    expect(startsWithBoldColon(para)).toBe(false);
  });
});

describe("isCenteredBoldText", () => {
  it("should return true for centered bold paragraph", () => {
    const para = new Paragraph({
      content: [new Run("TITLE", { bold: true })],
      alignment: "center",
    });
    expect(isCenteredBoldText(para)).toBe(true);
  });

  it("should return false for left-aligned bold paragraph", () => {
    const para = new Paragraph({
      content: [new Run("TITLE", { bold: true })],
      alignment: "left",
    });
    expect(isCenteredBoldText(para)).toBe(false);
  });

  it("should return false for centered non-bold paragraph", () => {
    const para = new Paragraph({
      content: [new Run("TITLE", { bold: false })],
      alignment: "center",
    });
    expect(isCenteredBoldText(para)).toBe(false);
  });

  it("should return false for empty paragraph", () => {
    const para = new Paragraph({ content: [], alignment: "center" });
    expect(isCenteredBoldText(para)).toBe(false);
  });
});

describe("isTocParagraph", () => {
  it('should return true for "TOC1" style', () => {
    const para = new Paragraph({ style: "TOC1" });
    expect(isTocParagraph(para)).toBe(true);
  });

  it('should return true for "toc2" style', () => {
    const para = new Paragraph({ style: "toc2" });
    expect(isTocParagraph(para)).toBe(true);
  });

  it('should return true for "toc 3" style', () => {
    const para = new Paragraph({ style: "toc 3" });
    expect(isTocParagraph(para)).toBe(true);
  });

  it("should return false for Normal style", () => {
    const para = new Paragraph({ style: "Normal" });
    expect(isTocParagraph(para)).toBe(false);
  });

  it("should return false for empty style", () => {
    const para = new Paragraph({ style: "" });
    expect(isTocParagraph(para)).toBe(false);
  });
});

describe("isTextOnlyParagraph", () => {
  it("should return true for paragraph with only text runs", () => {
    const para = new Paragraph({
      content: [new Run("Hello world")],
    });
    expect(isTextOnlyParagraph(para)).toBe(true);
  });

  it("should return false for blank paragraph", () => {
    const para = new Paragraph({ content: [] });
    expect(isTextOnlyParagraph(para)).toBe(false);
  });

  it("should return false for paragraph with image", () => {
    const para = new Paragraph({ content: [new ImageRun()] });
    expect(isTextOnlyParagraph(para)).toBe(false);
  });

  it("should return false for paragraph with shape", () => {
    const para = new Paragraph({ content: [new Shape()] });
    expect(isTextOnlyParagraph(para)).toBe(false);
  });
});
