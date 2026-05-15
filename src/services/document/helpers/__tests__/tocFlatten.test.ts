/**
 * Tests for src/services/document/helpers/tocFlatten.ts.
 *
 * Verifies the single-level-TOC detection and indent-zeroing logic.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */
import { flattenSingleLevelToc } from "../tocFlatten";

jest.mock("docxmlater", () => {
  class MockParagraph {
    private style: string;
    private indentLeft: number;
    constructor(opts: { style?: string; indentLeft?: number } = {}) {
      this.style = opts.style ?? "";
      this.indentLeft = opts.indentLeft ?? 0;
    }
    getStyle() {
      return this.style;
    }
    setLeftIndent(v: number) {
      this.indentLeft = v;
      return this;
    }
    // Test hook for assertions
    _getIndent() {
      return this.indentLeft;
    }
  }
  return {
    Paragraph: MockParagraph,
    Document: class {},
  };
});

import { Paragraph } from "docxmlater";

function makeDoc(paras: any[]) {
  return { getAllParagraphs: () => paras } as any;
}

describe("flattenSingleLevelToc", () => {
  it("flattens every entry when only TOC2 is present", () => {
    const entries = [
      new Paragraph({ style: "TOC2", indentLeft: 220 }),
      new Paragraph({ style: "TOC2", indentLeft: 220 }),
      new Paragraph({ style: "TOC2", indentLeft: 220 }),
    ];
    const result = flattenSingleLevelToc(makeDoc(entries));
    expect(result.flattened).toBe(true);
    expect(result.paragraphs).toBe(3);
    expect(result.flattenedStyle).toBe("TOC2");
    for (const p of entries) {
      expect((p as any)._getIndent()).toBe(0);
    }
  });

  it("does NOT flatten when multiple TOC levels are present", () => {
    const entries = [
      new Paragraph({ style: "TOC1", indentLeft: 0 }),
      new Paragraph({ style: "TOC2", indentLeft: 220 }),
      new Paragraph({ style: "TOC3", indentLeft: 440 }),
    ];
    const result = flattenSingleLevelToc(makeDoc(entries));
    expect(result.flattened).toBe(false);
    expect(result.flattenedStyle).toBeNull();
    expect((entries[1] as any)._getIndent()).toBe(220); // untouched
  });

  it("does nothing when there is only one TOC paragraph (likely a stray)", () => {
    const entries = [
      new Paragraph({ style: "TOC2", indentLeft: 220 }),
      new Paragraph({ style: "Normal" }),
    ];
    const result = flattenSingleLevelToc(makeDoc(entries));
    expect(result.flattened).toBe(false);
    expect(result.paragraphs).toBe(0);
    expect((entries[0] as any)._getIndent()).toBe(220);
  });

  it("does nothing when no TOC paragraphs are present", () => {
    const entries = [new Paragraph({ style: "Normal" }), new Paragraph({ style: "Heading1" })];
    const result = flattenSingleLevelToc(makeDoc(entries));
    expect(result.flattened).toBe(false);
    expect(result.paragraphs).toBe(0);
  });

  it("works with TOC3-only when that is the single level used", () => {
    const entries = [
      new Paragraph({ style: "TOC3", indentLeft: 440 }),
      new Paragraph({ style: "TOC3", indentLeft: 440 }),
    ];
    const result = flattenSingleLevelToc(makeDoc(entries));
    expect(result.flattened).toBe(true);
    expect(result.flattenedStyle).toBe("TOC3");
    for (const p of entries) {
      expect((p as any)._getIndent()).toBe(0);
    }
  });

  it("ignores case-variant TOC styles via the regex matcher", () => {
    const entries = [
      new Paragraph({ style: "toc2", indentLeft: 220 }),
      new Paragraph({ style: "toc2", indentLeft: 220 }),
    ];
    const result = flattenSingleLevelToc(makeDoc(entries));
    expect(result.flattened).toBe(true);
    expect(result.paragraphs).toBe(2);
  });

  it("does not treat non-TOC styles starting with 'toc' as TOC entries", () => {
    const entries = [
      // "TOCHeading" is the title above the TOC body — not a TOC entry style.
      new Paragraph({ style: "TOCHeading", indentLeft: 0 }),
      new Paragraph({ style: "TOCHeading", indentLeft: 0 }),
    ];
    const result = flattenSingleLevelToc(makeDoc(entries));
    expect(result.flattened).toBe(false);
  });
});
