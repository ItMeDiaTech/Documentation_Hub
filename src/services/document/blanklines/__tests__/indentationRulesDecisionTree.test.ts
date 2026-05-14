/**
 * Tests for the three-case indentation decision tree in
 * src/services/document/blanklines/rules/indentationRules.ts.
 *
 * Each test constructs a fake body or a single-cell table, runs
 * applyIndentationRules, and asserts the resulting leftIndent values.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */

jest.mock("docxmlater", () => {
  class MockParagraph {
    private numbering: any;
    private indentLeft: number;
    private text: string;
    constructor(opts: { numbering?: any; indentLeft?: number; text?: string } = {}) {
      this.numbering = opts.numbering ?? null;
      this.indentLeft = opts.indentLeft ?? 0;
      this.text = opts.text ?? "";
    }
    getNumbering() {
      return this.numbering;
    }
    getFormatting() {
      return { indentation: { left: this.indentLeft } };
    }
    getText() {
      return this.text;
    }
    setLeftIndent(v: number) {
      this.indentLeft = v;
      return this;
    }
    // isParagraphBlank reads getContent; we model blank-ness via text === "".
    getContent() {
      return this.text ? [{ getText: () => this.text }] : [];
    }
    getStyle() {
      return "";
    }
    getAlignment() {
      return "left";
    }
    getBookmarksStart() {
      return [];
    }
    getBookmarksEnd() {
      return [];
    }
    getRuns() {
      return [];
    }
  }
  class MockTable {
    constructor(private rows: any[] = []) {}
    getRows() {
      return this.rows;
    }
  }
  return {
    Paragraph: MockParagraph,
    Table: MockTable,
    TableCell: class {},
    Run: class {},
    Hyperlink: class {},
    ImageRun: class {},
    Shape: class {},
    TextBox: class {},
    Field: class {},
    Revision: class {},
  };
});

// detectTypedPrefix is only used by isListElement / removeSmallIndents,
// neither of which the decision-tree tests exercise.
jest.mock("@/services/document/list", () => ({
  detectTypedPrefix: () => ({ prefix: null }),
}));

import { Paragraph, Table } from "docxmlater";
import { applyIndentationRules } from "../rules/indentationRules";

function makeDoc(bodyEls: any[], tables: any[] = []) {
  return {
    getBodyElementCount: () => bodyEls.length,
    getBodyElementAt: (i: number) => bodyEls[i],
    getAllTables: () => tables,
  } as any;
}

function makeCell(paras: any[]) {
  return { getParagraphs: () => paras };
}

const TWIPS_PER_INCH = 1440;

const listSettings = {
  listBulletSettings: {
    indentationLevels: [
      { level: 0, textIndent: 0.5 },
      { level: 1, textIndent: 0.75 },
      { level: 2, textIndent: 1.0 },
    ],
  },
};

describe("applyIndentationRules — Case A (prev is list item)", () => {
  it("snaps indented paragraph after level-0 list item to level-0 text indent", () => {
    const listPara = new Paragraph({ numbering: { numId: 5, level: 0 }, text: "Item one" });
    const indented = new Paragraph({ indentLeft: 9999, text: "Continuation" });
    const doc = makeDoc([listPara, indented]);
    applyIndentationRules(doc, listSettings as any);
    expect(indented.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });

  it("snaps indented paragraph after level-2 list item to level-2 text indent", () => {
    const listPara = new Paragraph({ numbering: { numId: 5, level: 2 }, text: "L2" });
    const indented = new Paragraph({ indentLeft: 9999, text: "Continuation" });
    const doc = makeDoc([listPara, indented]);
    applyIndentationRules(doc, listSettings as any);
    expect(indented.getFormatting().indentation.left).toBe(Math.round(1.0 * TWIPS_PER_INCH));
  });

  it("falls through to Case C when listBulletSettings are not configured", () => {
    const listPara = new Paragraph({ numbering: { numId: 5, level: 0 }, text: "Item" });
    const indented = new Paragraph({ indentLeft: 9999, text: "Continuation" });
    const doc = makeDoc([listPara, indented]);
    applyIndentationRules(doc, {} as any);
    // getTextIndentForLevel returns null → falls through to Case C → 0.5" fallback.
    expect(indented.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });
});

describe("applyIndentationRules — Case B (prev is indented non-list)", () => {
  it("matches prev's left indent (cascade)", () => {
    const first = new Paragraph({ indentLeft: 9999, text: "First" });
    const second = new Paragraph({ indentLeft: 1234, text: "Second" });
    const doc = makeDoc([new Paragraph({ text: "Non-indented intro" }), first, second]);
    applyIndentationRules(doc, listSettings as any);
    // First was Case C → 0.5"; Second matches first via Case B.
    const level0 = Math.round(0.5 * TWIPS_PER_INCH);
    expect(first.getFormatting().indentation.left).toBe(level0);
    expect(second.getFormatting().indentation.left).toBe(level0);
  });

  it("cascades three consecutive indented non-list paragraphs to the same value", () => {
    const a = new Paragraph({ indentLeft: 1111, text: "A" });
    const b = new Paragraph({ indentLeft: 2222, text: "B" });
    const c = new Paragraph({ indentLeft: 3333, text: "C" });
    const doc = makeDoc([new Paragraph({ text: "intro" }), a, b, c]);
    applyIndentationRules(doc, listSettings as any);
    const level0 = Math.round(0.5 * TWIPS_PER_INCH);
    expect(a.getFormatting().indentation.left).toBe(level0);
    expect(b.getFormatting().indentation.left).toBe(level0);
    expect(c.getFormatting().indentation.left).toBe(level0);
  });
});

describe("applyIndentationRules — Case C (no list, no indented prev)", () => {
  it("snaps a lone indented paragraph (first body element) to level-0", () => {
    const lone = new Paragraph({ indentLeft: 9999, text: "Lone" });
    const doc = makeDoc([lone]);
    applyIndentationRules(doc, listSettings as any);
    expect(lone.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });

  it("snaps indented paragraph after a blank to level-0 (blanks do not bridge)", () => {
    const blank = new Paragraph({ text: "" }); // blank
    const indented = new Paragraph({ indentLeft: 9999, text: "Body" });
    const doc = makeDoc([new Paragraph({ text: "intro" }), blank, indented]);
    applyIndentationRules(doc, listSettings as any);
    expect(indented.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });

  it("snaps indented paragraph after a Table to level-0", () => {
    const tbl = new Table([]);
    const indented = new Paragraph({ indentLeft: 9999, text: "After table" });
    const doc = makeDoc([tbl, indented], [tbl]);
    applyIndentationRules(doc, listSettings as any);
    expect(indented.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });

  it("falls back to hard-coded 0.5\" when no listBulletSettings provided", () => {
    const lone = new Paragraph({ indentLeft: 9999, text: "Lone" });
    const doc = makeDoc([lone]);
    applyIndentationRules(doc, {} as any);
    expect(lone.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });
});

describe("applyIndentationRules — skip list items themselves", () => {
  it("does not modify list-item paragraphs", () => {
    const listPara = new Paragraph({
      numbering: { numId: 5, level: 0 },
      indentLeft: 5000,
      text: "Item",
    });
    const doc = makeDoc([listPara]);
    applyIndentationRules(doc, listSettings as any);
    expect(listPara.getFormatting().indentation.left).toBe(5000);
  });
});

describe("applyIndentationRules — cells", () => {
  it("applies the decision tree inside a table cell", () => {
    const intro = new Paragraph({ text: "Cell intro" });
    const indented = new Paragraph({ indentLeft: 9999, text: "Indented inside cell" });
    const cell = makeCell([intro, indented]);
    const table = new Table([{ getCells: () => [cell] }]);
    const doc = makeDoc([table], [table]);
    applyIndentationRules(doc, listSettings as any);
    expect(indented.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });
});
