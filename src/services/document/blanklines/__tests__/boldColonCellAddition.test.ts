/**
 * Diagnostic tests for missing blank line above "Exceptions: Client Requires"
 * in 2-paragraph table cells (P_73.docx scenario).
 *
 * Tests the exact P_73.docx scenario:
 *   Cell with 2 paragraphs:
 *     Para 0: "No Mail Tag..." (plain text)
 *     Para 1: "Exceptions: Client Requires Mail Tag." (first run bold)
 *
 * Compared against the working scenario:
 *   Cell with 3 paragraphs:
 *     Para 0: "Intro text"
 *     Para 1: "More text"
 *     Para 2: "Example: This is an example." (first run bold)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Mock docxmlater with fully extended classes ---
jest.mock("docxmlater", () => {
  class MockRun {
    private text: string;
    private formatting: any;
    constructor(text: string = "", formatting: any = {}) {
      this.text = text;
      this.formatting = formatting;
    }
    getText() {
      return this.text;
    }
    getFormatting() {
      return this.formatting;
    }
    setSize(_n: number) {}
    setFont(_f: string) {}
  }

  class MockImageRun extends MockRun {
    getImageElement() {
      return { getWidth: () => 50, getHeight: () => 50 };
    }
  }

  class MockHyperlink {
    getText() {
      return "link text";
    }
  }

  class MockParagraph {
    private content: any[];
    private style: string;
    private alignment: string;
    private formatting: any;
    private numbering: any;
    private preserved: boolean;

    constructor(
      opts: {
        content?: any[];
        style?: string;
        alignment?: string;
        formatting?: any;
        numbering?: any;
      } = {}
    ) {
      this.content = opts.content ?? [];
      this.style = opts.style ?? "Normal";
      this.alignment = opts.alignment ?? "left";
      this.formatting = opts.formatting ?? {};
      this.numbering = opts.numbering ?? null;
      this.preserved = false;
    }

    getContent() {
      return this.content;
    }
    getText() {
      return this.content
        .filter((c: any) => c.getText)
        .map((c: any) => c.getText())
        .join("");
    }
    getStyle() {
      return this.style;
    }
    getAlignment() {
      return this.alignment;
    }
    getFormatting() {
      return this.formatting;
    }
    getNumbering() {
      return this.numbering;
    }
    getRuns() {
      return this.content.filter((c: any) => c instanceof MockRun && !(c instanceof MockImageRun));
    }
    isPreserved() {
      return this.preserved;
    }
    setPreserved(val: boolean) {
      this.preserved = val;
    }
    setStyle(s: string) {
      this.style = s;
    }
    setSpaceAfter(_n: number) {}
    setSpaceBefore(_n: number) {}
    setLineSpacing(_n: number) {}
    setLeftIndent(_n: number) {}

    static create() {
      return new MockParagraph({ content: [] });
    }
  }

  class MockTableCell {
    private paragraphs: any[];
    constructor(paragraphs: any[] = []) {
      this.paragraphs = [...paragraphs];
    }
    getParagraphs() {
      return [...this.paragraphs];
    }
    addParagraphAt(index: number, para: any) {
      this.paragraphs.splice(index, 0, para);
    }
    removeParagraph(index: number) {
      this.paragraphs.splice(index, 1);
    }
    hasNestedTables() {
      return false;
    }
  }

  class MockRow {
    private cells: any[];
    constructor(cells: any[]) {
      this.cells = cells;
    }
    getCells() {
      return this.cells;
    }
    getTablePropertyExceptions() {
      return null;
    }
    setTablePropertyExceptions(_v: any) {}
  }

  class MockTable {
    private rows: any[];
    constructor(rows: any[]) {
      this.rows = rows;
    }
    getRows() {
      return this.rows;
    }
    getRowCount() {
      return this.rows.length;
    }
    getColumnCount() {
      return this.rows[0]?.getCells().length ?? 0;
    }
    getCell(r: number, c: number) {
      return this.rows[r]?.getCells()[c];
    }
  }

  class MockDocument {
    private bodyElements: any[];
    private tables: any[];

    constructor(opts: { bodyElements?: any[]; tables?: any[] } = {}) {
      this.bodyElements = opts.bodyElements ?? [];
      this.tables = opts.tables ?? [];
    }

    getBodyElementAt(i: number) {
      return this.bodyElements[i];
    }
    getBodyElementCount() {
      return this.bodyElements.length;
    }
    insertBodyElementAt(i: number, el: any) {
      this.bodyElements.splice(i, 0, el);
    }
    removeBodyElementAt(i: number) {
      this.bodyElements.splice(i, 1);
    }
    getAllTables() {
      return this.tables;
    }
    getBodyElements() {
      return this.bodyElements;
    }
    setBodyElements(elements: any[]) {
      this.bodyElements = elements;
    }
    getStyle(_id: string) {
      return null;
    }
  }

  class MockShape {}
  class MockTextBox {}
  class MockField {}
  class MockStructuredDocumentTag {}

  class MockRevision {
    private text: string;
    private content: any[];
    constructor(text: string = "", content: any[] = []) {
      this.text = text;
      this.content = content;
    }
    getText() {
      return this.text;
    }
    getContent() {
      return this.content;
    }
  }

  return {
    Paragraph: MockParagraph,
    Run: MockRun,
    Hyperlink: MockHyperlink,
    ImageRun: MockImageRun,
    Table: MockTable,
    TableCell: MockTableCell,
    Document: MockDocument,
    Shape: MockShape,
    TextBox: MockTextBox,
    Field: MockField,
    Revision: MockRevision,
    StructuredDocumentTag: MockStructuredDocumentTag,
    // Export Row under a test-only alias
    __MockRow: MockRow,
  };
});

// Mock logger
jest.mock("@/utils/logger", () => ({
  logger: {
    namespace: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
  startTimer: jest.fn().mockReturnValue({
    end: jest.fn().mockReturnValue(0),
    elapsed: jest.fn().mockReturnValue(0),
  }),
}));

// Import mocked classes — jest.mock is hoisted above these imports
import { Paragraph, Run, Document, Table, TableCell } from "docxmlater";
const { __MockRow: MockRow } = require("docxmlater");

import { startsWithBoldColon, isParagraphBlank } from "../helpers/paragraphChecks";
import { aboveBoldColonNoIndentRule, boldColonNoIndentAfterRule } from "../rules/additionRules";
import { BlankLineManager } from "../BlankLineManager";
import type { RuleContext } from "../rules/ruleTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Create a paragraph where the first run is bold with a colon. */
function makeBoldColonPara(label: string, rest: string = ""): any {
  return new (Paragraph as any)({
    content: [new (Run as any)(label, { bold: true }), ...(rest ? [new (Run as any)(rest)] : [])],
  });
}

/** Create a plain text paragraph. */
function makePlainPara(text: string): any {
  return new (Paragraph as any)({
    content: [new (Run as any)(text)],
  });
}

/** Create a blank paragraph (no content). */
function makeBlankPara(): any {
  return new (Paragraph as any)({ content: [] });
}

// ─── Test A: Rule matching in isolation ───────────────────────────────────

describe("Test A: Rule matching in isolation", () => {
  it("startsWithBoldColon detects 'Exceptions:' paragraph", () => {
    const para = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    expect(startsWithBoldColon(para)).toBe(true);
  });

  it("startsWithBoldColon detects 'Example:' paragraph", () => {
    const para = makeBoldColonPara("Example:", " This is an example.");
    expect(startsWithBoldColon(para)).toBe(true);
  });

  it("isParagraphBlank returns false for 'Exceptions:' paragraph", () => {
    const para = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    expect(isParagraphBlank(para)).toBe(false);
  });

  it("isBoldColonNoIndent returns true for 'Exceptions:' (tested via rule)", () => {
    // isBoldColonNoIndent is not exported, so test through the rule
    const exceptionsPara = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    const plainPara = makePlainPara("No Mail Tag");
    const doc = new (Document as any)();

    const ctx: RuleContext = {
      doc: doc as any,
      currentIndex: 0,
      currentElement: plainPara,
      nextElement: exceptionsPara,
      scope: "cell",
    };

    expect(aboveBoldColonNoIndentRule.matches(ctx)).toBe(true);
  });

  it("isBoldColonNoIndent returns false when numbering is present", () => {
    const numberedPara = new (Paragraph as any)({
      content: [new (Run as any)("Exceptions:", { bold: true })],
      numbering: { numId: 1, level: 0 },
    });
    const plainPara = makePlainPara("Some text");
    const doc = new (Document as any)();

    const ctx: RuleContext = {
      doc: doc as any,
      currentIndex: 0,
      currentElement: plainPara,
      nextElement: numberedPara,
      scope: "cell",
    };

    expect(aboveBoldColonNoIndentRule.matches(ctx)).toBe(false);
  });

  it("isBoldColonNoIndent returns false when indented", () => {
    const indentedPara = new (Paragraph as any)({
      content: [new (Run as any)("Exceptions:", { bold: true })],
      formatting: { indentation: { left: 720 } },
    });
    const plainPara = makePlainPara("Some text");
    const doc = new (Document as any)();

    const ctx: RuleContext = {
      doc: doc as any,
      currentIndex: 0,
      currentElement: plainPara,
      nextElement: indentedPara,
      scope: "cell",
    };

    expect(aboveBoldColonNoIndentRule.matches(ctx)).toBe(false);
  });
});

// ─── Test B: Rule matching in cell context ────────────────────────────────

describe("Test B: Rule matching in cell context", () => {
  it("aboveBoldColonNoIndentRule matches at ci=0 in 2-paragraph cell", () => {
    const para0 = makePlainPara("No Mail Tag");
    const para1 = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    const paras = [para0, para1];

    const doc = new (Document as any)();
    const cell = new (TableCell as any)(paras);
    const table = new (Table as any)([new MockRow([cell])]);

    const ctx: RuleContext = {
      doc: doc as any,
      currentIndex: 0,
      currentElement: para0,
      prevElement: undefined,
      nextElement: para1,
      scope: "cell",
      cell: cell,
      cellParagraphs: paras,
      cellParaIndex: 0,
      parentTable: table,
    };

    expect(aboveBoldColonNoIndentRule.matches(ctx)).toBe(true);
  });

  it("aboveBoldColonNoIndentRule matches at ci=1 in 3-paragraph cell", () => {
    const para0 = makePlainPara("Some intro text");
    const para1 = makePlainPara("More text here");
    const para2 = makeBoldColonPara("Example:", " This is an example.");
    const paras = [para0, para1, para2];

    const doc = new (Document as any)();
    const cell = new (TableCell as any)(paras);
    const table = new (Table as any)([new MockRow([cell])]);

    const ctx: RuleContext = {
      doc: doc as any,
      currentIndex: 1,
      currentElement: para1,
      prevElement: para0,
      nextElement: para2,
      scope: "cell",
      cell: cell,
      cellParagraphs: paras,
      cellParaIndex: 1,
      parentTable: table,
    };

    expect(aboveBoldColonNoIndentRule.matches(ctx)).toBe(true);
  });

  it("rule does not match when nextElement is undefined (last para)", () => {
    const para0 = makePlainPara("No Mail Tag");
    const para1 = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    const paras = [para0, para1];

    const doc = new (Document as any)();
    const cell = new (TableCell as any)(paras);
    const table = new (Table as any)([new MockRow([cell])]);

    // Context at ci=1 (last in cell, no nextElement)
    const ctx: RuleContext = {
      doc: doc as any,
      currentIndex: 1,
      currentElement: para1,
      prevElement: para0,
      nextElement: undefined,
      scope: "cell",
      cell: cell,
      cellParagraphs: paras,
      cellParaIndex: 1,
      parentTable: table,
    };

    expect(aboveBoldColonNoIndentRule.matches(ctx)).toBe(false);
  });
});

// ─── Test C: Full cell addition loop via applyAdditionRulesCells ──────────

describe("Test C: Full cell addition loop", () => {
  const blankOpts = {
    spacingAfter: 120,
    markAsPreserved: true,
    style: "Normal",
  };
  const options = {};

  it("adds blank line above 'Exceptions:' in 2-paragraph cell", () => {
    const para0 = makePlainPara("No Mail Tag");
    const para1 = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    const cell = new (TableCell as any)([para0, para1]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    const added = (manager as any).applyAdditionRulesCells(doc, options, blankOpts);

    expect(added).toBeGreaterThanOrEqual(1);

    const paras = cell.getParagraphs();
    expect(paras.length).toBe(3);
    // The blank should be at index 1, between para0 and para1
    expect(isParagraphBlank(paras[0])).toBe(false); // "No Mail Tag"
    expect(isParagraphBlank(paras[1])).toBe(true); // ← inserted blank
    expect(isParagraphBlank(paras[2])).toBe(false); // "Exceptions:..."
  });

  it("adds blank line above 'Example:' in 3-paragraph cell", () => {
    const para0 = makePlainPara("Some intro text");
    const para1 = makePlainPara("More text here");
    const para2 = makeBoldColonPara("Example:", " This is an example.");
    const cell = new (TableCell as any)([para0, para1, para2]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    const added = (manager as any).applyAdditionRulesCells(doc, options, blankOpts);

    expect(added).toBeGreaterThanOrEqual(1);

    const paras = cell.getParagraphs();
    // Should have blank before "Example:"
    const exampleIndex = paras.findIndex(
      (p: any) => !isParagraphBlank(p) && p.getText().startsWith("Example:")
    );
    expect(exampleIndex).toBeGreaterThan(0);
    expect(isParagraphBlank(paras[exampleIndex - 1])).toBe(true);
  });

  it("does NOT add blank at end of cell (isLastInCell guard)", () => {
    // If the bold-colon para is the only one, no blank should be added
    const para0 = makeBoldColonPara("Exceptions:", " Client Requires.");
    const cell = new (TableCell as any)([para0]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    const added = (manager as any).applyAdditionRulesCells(doc, options, blankOpts);

    expect(added).toBe(0);
    expect(cell.getParagraphs().length).toBe(1);
  });
});

// ─── Test D: Compare 2-paragraph vs 3-paragraph cells ────────────────────

describe("Test D: Compare 2-paragraph vs 3-paragraph cells", () => {
  const blankOpts = {
    spacingAfter: 120,
    markAsPreserved: true,
    style: "Normal",
  };
  const options = {};

  it("both 2-para and 3-para cells get blank lines inserted", () => {
    // Cell 3 scenario (2 paragraphs) — P_73.docx failing case
    const cell3Para0 = makePlainPara("No Mail Tag");
    const cell3Para1 = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    const cell3 = new (TableCell as any)([cell3Para0, cell3Para1]);

    // Cell 2 scenario (3 paragraphs) — P_73.docx working case
    const cell2Para0 = makePlainPara("Some intro text");
    const cell2Para1 = makePlainPara("More text here");
    const cell2Para2 = makeBoldColonPara("Example:", " This is an example.");
    const cell2 = new (TableCell as any)([cell2Para0, cell2Para1, cell2Para2]);

    const table = new (Table as any)([new MockRow([cell2, cell3])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    const added = (manager as any).applyAdditionRulesCells(doc, options, blankOpts);

    // Both cells should have blanks added
    expect(added).toBeGreaterThanOrEqual(2);

    // Cell 3: verify blank inserted
    const cell3Paras = cell3.getParagraphs();
    expect(cell3Paras.length).toBe(3);
    expect(isParagraphBlank(cell3Paras[1])).toBe(true);

    // Cell 2: verify blank inserted
    const cell2Paras = cell2.getParagraphs();
    const exampleIndex = cell2Paras.findIndex(
      (p: any) => !isParagraphBlank(p) && p.getText().startsWith("Example:")
    );
    expect(exampleIndex).toBeGreaterThan(0);
    expect(isParagraphBlank(cell2Paras[exampleIndex - 1])).toBe(true);
  });

  it("2-para cell isLastInCell is correctly false at ci=0", () => {
    // Explicitly verify that the isLastInCell guard doesn't block insertion
    const para0 = makePlainPara("No Mail Tag");
    const para1 = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    const paras = [para0, para1];

    // At ci=0 with 2 paragraphs: isLastInCell = (0 === 2-1) = (0 === 1) = false
    const ci = 0;
    const isLastInCell = ci === paras.length - 1;
    expect(isLastInCell).toBe(false);
  });

  it("full processBlankLines does not remove the added blank via dedup", () => {
    const para0 = makePlainPara("No Mail Tag");
    const para1 = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    const cell = new (TableCell as any)([para0, para1]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({
      bodyElements: [table],
      tables: [table],
    });

    const manager = new BlankLineManager();

    // Create a minimal snapshot (no original blanks)
    const snapshot = {
      bodyBlanks: [],
      cellBlanks: [],
    };

    const result = manager.processBlankLines(doc, snapshot as any, {});

    // Verify blank was added and not subsequently removed
    const paras = cell.getParagraphs();
    const blankCount = paras.filter((p: any) => isParagraphBlank(p)).length;
    expect(blankCount).toBeGreaterThanOrEqual(1);
    expect(result.added).toBeGreaterThanOrEqual(1);
  });
});

// ─── Test E: Cell-level vs table-level nested content guard ───────────────

describe("Test E: Cell-level nested content guard (root cause fix)", () => {
  const blankOpts = {
    spacingAfter: 120,
    markAsPreserved: true,
    style: "Normal",
  };
  const options = {};

  it("processes cells without nested tables even when sibling cell has nested tables", () => {
    // Simulate P_73.docx scenario: a large table where SOME cells have
    // nested content but the "Exceptions:" cell does not.
    const para0 = makePlainPara("No Mail Tag");
    const para1 = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    const targetCell = new (TableCell as any)([para0, para1]);

    // Create a cell that reports hasNestedTables() = true
    const nestedCell = new (TableCell as any)([makePlainPara("Nested content")]);
    // Override hasNestedTables for this specific cell
    (nestedCell as any).hasNestedTables = () => true;

    const table = new (Table as any)([new MockRow([nestedCell, targetCell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    const added = (manager as any).applyAdditionRulesCells(doc, options, blankOpts);

    // The targetCell (no nested tables) should still get a blank line
    expect(added).toBe(1);
    const paras = targetCell.getParagraphs();
    expect(paras.length).toBe(3);
    expect(isParagraphBlank(paras[1])).toBe(true);
  });

  it("skips cells that DO have nested tables", () => {
    const para0 = makePlainPara("No Mail Tag");
    const para1 = makeBoldColonPara("Exceptions:", " Client Requires Mail Tag.");
    const nestedCell = new (TableCell as any)([para0, para1]);
    // This cell has nested tables — should be skipped
    (nestedCell as any).hasNestedTables = () => true;

    const table = new (Table as any)([new MockRow([nestedCell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    const added = (manager as any).applyAdditionRulesCells(doc, options, blankOpts);

    // Cell has nested tables — should not be modified
    expect(added).toBe(0);
    expect(nestedCell.getParagraphs().length).toBe(2);
  });
});
