/**
 * Tests for the cell-first-list-item spacing rule.
 *
 * When the FIRST paragraph inside a table cell is a list item, that paragraph
 * gets 6pt (120 twips) of space-above so the list does not sit flush against
 * the cell's top edge.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock("docxmlater", () => {
  class MockRun {
    constructor(
      private text: string = "",
      private formatting: any = {}
    ) {}
    getText() {
      return this.text;
    }
    getFormatting() {
      return this.formatting;
    }
    getContent() {
      return [];
    }
    setSize(_n: number) {}
    setFont(_f: string) {}
  }

  class MockImageRun extends MockRun {
    getImageElement() {
      return { getWidth: () => 50 * 9525, getHeight: () => 50 * 9525 };
    }
  }

  class MockHyperlink {
    getText() {
      return "";
    }
  }

  class MockParagraph {
    private content: any[];
    private style: string;
    private numbering: any;
    private preserved: boolean;
    public spaceBefore: number | undefined;

    constructor(
      opts: { content?: any[]; style?: string; numbering?: any } = {}
    ) {
      this.content = opts.content ?? [];
      this.style = opts.style ?? "Normal";
      this.numbering = opts.numbering ?? null;
      this.preserved = false;
      this.spaceBefore = undefined;
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
      return "left";
    }
    getFormatting() {
      return {};
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
    setPreserved(v: boolean) {
      this.preserved = v;
    }
    setStyle(s: string) {
      this.style = s;
    }
    setSpaceAfter(_n: number) {}
    setSpaceBefore(n: number) {
      this.spaceBefore = n;
    }
    setLineSpacing(_n: number) {}
    setLeftIndent(_n: number) {}
    isParagraphMarkDeleted() {
      return false;
    }
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
    constructor(private cells: any[]) {}
    getCells() {
      return this.cells;
    }
  }

  class MockTable {
    constructor(private rows: any[]) {}
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
    getText() {
      return "";
    }
    getContent() {
      return [];
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
    WORD_NATIVE_BULLETS: {
      FILLED_BULLET: { char: "", font: "Symbol" },
      OPEN_CIRCLE: { char: "o", font: "Courier New" },
      FILLED_SQUARE: { char: "", font: "Wingdings" },
    },
    isRun: (x: any) => x instanceof MockRun,
    inchesToTwips: (inches: number) => Math.round(inches * 1440),
    __MockRow: MockRow,
  };
});

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

import { Paragraph, Run, Document, Table, TableCell } from "docxmlater";
const { __MockRow: MockRow } = require("docxmlater");

import { BlankLineManager } from "../BlankLineManager";

function makeListItem(text: string, numId = 1): any {
  return new (Paragraph as any)({
    content: [new (Run as any)(text)],
    numbering: { numId, level: 0 },
  });
}

function makePlainPara(text: string): any {
  return new (Paragraph as any)({ content: [new (Run as any)(text)] });
}

function buildDoc(cellParas: any[]): { doc: any; cell: any } {
  const cell = new (TableCell as any)(cellParas);
  const table = new (Table as any)([new MockRow([cell])]);
  const doc = new (Document as any)({ bodyElements: [table], tables: [table] });
  return { doc, cell };
}

const snapshot = { bodyBlanks: [], cellBlanks: [] } as any;

describe("first cell list-item gets 6pt space-above", () => {
  it("sets 120 twips space-before on a first-paragraph list item", () => {
    const { doc, cell } = buildDoc([makeListItem("First step"), makeListItem("Second step")]);
    new BlankLineManager().processBlankLines(doc, snapshot, {});

    const first = cell.getParagraphs()[0];
    expect(first.spaceBefore).toBe(120);
  });

  it("does NOT set space-above when the first cell paragraph is plain text", () => {
    const { doc, cell } = buildDoc([makePlainPara("Intro text"), makeListItem("A step")]);
    new BlankLineManager().processBlankLines(doc, snapshot, {});

    const first = cell.getParagraphs()[0];
    expect(first.spaceBefore).toBeUndefined();
  });

  it("does NOT set space-above on a list item that is not the first cell paragraph", () => {
    const { doc, cell } = buildDoc([makePlainPara("Intro"), makeListItem("A step")]);
    new BlankLineManager().processBlankLines(doc, snapshot, {});

    const paras = cell.getParagraphs();
    const listItem = paras.find((p: any) => p.getNumbering());
    expect(listItem).toBeDefined();
    expect(listItem.spaceBefore).toBeUndefined();
  });
});
