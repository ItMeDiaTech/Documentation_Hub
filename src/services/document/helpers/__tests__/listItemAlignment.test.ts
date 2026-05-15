/**
 * Tests for src/services/document/helpers/listItemAlignment.ts.
 *
 * Verifies that every paragraph DocXMLater recognises as a real list item
 * (getNumbering() with numId > 0) ends up left-aligned, while non-list
 * paragraphs and the numId=0 "remove list" sentinel are untouched.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */
import { leftAlignListItems } from "../listItemAlignment";

jest.mock("docxmlater", () => {
  class MockParagraph {
    private numbering: any;
    private alignment: string;
    constructor(opts: { numbering?: any; alignment?: string } = {}) {
      this.numbering = opts.numbering ?? null;
      this.alignment = opts.alignment ?? "left";
    }
    getNumbering() {
      return this.numbering;
    }
    getAlignment() {
      return this.alignment;
    }
    setAlignment(value: string) {
      this.alignment = value;
      return this;
    }
  }
  return {
    Paragraph: MockParagraph,
    // Document used only as a type by the helper.
    Document: class {},
  };
});

import { Paragraph } from "docxmlater";

function makeDoc(paras: any[]) {
  return { getAllParagraphs: () => paras } as any;
}

describe("leftAlignListItems", () => {
  it("flips a center-aligned list item to left", () => {
    const para = new Paragraph({ numbering: { numId: 5, level: 0 }, alignment: "center" });
    const fixed = leftAlignListItems(makeDoc([para]));
    expect(fixed).toBe(1);
    expect((para as any).getAlignment()).toBe("left");
  });

  it("flips right-aligned and justified list items to left", () => {
    const a = new Paragraph({ numbering: { numId: 5, level: 0 }, alignment: "right" });
    const b = new Paragraph({ numbering: { numId: 5, level: 0 }, alignment: "justify" });
    const fixed = leftAlignListItems(makeDoc([a, b]));
    expect(fixed).toBe(2);
    expect((a as any).getAlignment()).toBe("left");
    expect((b as any).getAlignment()).toBe("left");
  });

  it("does NOT touch list items that are already left-aligned", () => {
    const para = new Paragraph({ numbering: { numId: 5, level: 0 }, alignment: "left" });
    const fixed = leftAlignListItems(makeDoc([para]));
    expect(fixed).toBe(0);
  });

  it("does NOT touch paragraphs without numbering", () => {
    const para = new Paragraph({ alignment: "center" });
    const fixed = leftAlignListItems(makeDoc([para]));
    expect(fixed).toBe(0);
    expect((para as any).getAlignment()).toBe("center");
  });

  it("does NOT treat numId=0 as a list item (remove-list sentinel)", () => {
    const para = new Paragraph({ numbering: { numId: 0, level: 0 }, alignment: "center" });
    const fixed = leftAlignListItems(makeDoc([para]));
    expect(fixed).toBe(0);
    expect((para as any).getAlignment()).toBe("center");
  });

  it("handles a mix of list items and non-list items in one pass", () => {
    const listCenter = new Paragraph({ numbering: { numId: 5, level: 0 }, alignment: "center" });
    const proseCenter = new Paragraph({ alignment: "center" });
    const listLeft = new Paragraph({ numbering: { numId: 5, level: 0 }, alignment: "left" });
    const fixed = leftAlignListItems(makeDoc([listCenter, proseCenter, listLeft]));
    expect(fixed).toBe(1);
    expect((listCenter as any).getAlignment()).toBe("left");
    expect((proseCenter as any).getAlignment()).toBe("center");
    expect((listLeft as any).getAlignment()).toBe("left");
  });
});
