/**
 * Regression test for a missing blank line ABOVE a large image inside a table
 * cell.
 *
 * Examples.docx scenario (table 106, r2c1):
 *   Para 0: "Locate the Order Number."  (plain text)
 *   Para 1: <large screenshot image>    (862x167 px)
 *
 * Large images (>=100x100 px) must get a blank line both ABOVE and BELOW.
 * The body-scope addition loop handles "above" explicitly, but the cell-scope
 * loop only ever inserted a blank AFTER a matched element, so a large image
 * that was the first visual content after text in a cell never got its
 * "above" blank.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const EMU_PER_PIXEL = 9525;

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
    getContent() {
      return [];
    }
    setSize(_n: number) {}
    setFont(_f: string) {}
  }

  class MockImage {
    constructor(
      private w: number,
      private h: number
    ) {}
    getWidth() {
      return this.w;
    }
    getHeight() {
      return this.h;
    }
  }

  class MockImageRun extends MockRun {
    private image: MockImage;
    constructor(widthPx: number, heightPx: number) {
      super("");
      this.image = new MockImage(widthPx * 9525, heightPx * 9525);
    }
    getImageElement() {
      return this.image;
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
    private cells: any[];
    constructor(cells: any[]) {
      this.cells = cells;
    }
    getCells() {
      return this.cells;
    }
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
    Image: MockImage,
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

import { Paragraph, Run, ImageRun, Document, Table, TableCell } from "docxmlater";
const { __MockRow: MockRow } = require("docxmlater");

import { isParagraphBlank } from "../helpers/paragraphChecks";
import { BlankLineManager } from "../BlankLineManager";

void EMU_PER_PIXEL;

function makePlainPara(text: string): any {
  return new (Paragraph as any)({ content: [new (Run as any)(text)] });
}

function makeImagePara(widthPx: number, heightPx: number, centered = false): any {
  return new (Paragraph as any)({
    content: [new (ImageRun as any)(widthPx, heightPx)],
    alignment: centered ? "center" : "left",
  });
}

const blankOpts = { spacingAfter: 120, markAsPreserved: true, style: "Normal" };

describe("applyAdditionRulesCells — blank above large image", () => {
  it("inserts a blank ABOVE a large image that directly follows text in a cell", () => {
    const textPara = makePlainPara("Locate the Order Number.");
    const imagePara = makeImagePara(862, 167); // large
    const cell = new (TableCell as any)([textPara, imagePara]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    (manager as any).applyAdditionRulesCells(doc, {}, blankOpts);

    const paras = cell.getParagraphs();
    // Expect: text, blank (above image), image, blank (below image)
    expect(isParagraphBlank(paras[0])).toBe(false); // text
    expect(isParagraphBlank(paras[1])).toBe(true); // ← blank above the image
    expect(isParagraphBlank(paras[2])).toBe(false); // image
  });

  it("does NOT insert a blank above a SMALL image", () => {
    const textPara = makePlainPara("Some text.");
    const imagePara = makeImagePara(30, 25); // small
    const cell = new (TableCell as any)([textPara, imagePara]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    (manager as any).applyAdditionRulesCells(doc, {}, blankOpts);

    const paras = cell.getParagraphs();
    // No blank inserted between text and the small image.
    expect(isParagraphBlank(paras[0])).toBe(false);
    expect(isParagraphBlank(paras[1])).toBe(false);
  });

  it("does NOT insert a blank above a large image when preceded by centered caption text", () => {
    const captionPara = makePlainPara("Figure 1");
    (captionPara as any).getAlignment = () => "center";
    const imagePara = makeImagePara(800, 200);
    const cell = new (TableCell as any)([captionPara, imagePara]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    (manager as any).applyAdditionRulesCells(doc, {}, blankOpts);

    const paras = cell.getParagraphs();
    expect(isParagraphBlank(paras[0])).toBe(false); // centered caption
    expect(isParagraphBlank(paras[1])).toBe(false); // image — stays tight
  });

  it("does not duplicate the blank above an image when one already exists", () => {
    const textPara = makePlainPara("Locate the Order Number.");
    const blank = new (Paragraph as any)({ content: [] });
    const imagePara = makeImagePara(862, 167);
    const cell = new (TableCell as any)([textPara, blank, imagePara]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    (manager as any).applyAdditionRulesCells(doc, {}, blankOpts);

    const paras = cell.getParagraphs();
    expect(isParagraphBlank(paras[0])).toBe(false);
    expect(isParagraphBlank(paras[1])).toBe(true);
    expect(isParagraphBlank(paras[2])).toBe(false); // image — still only one blank above
  });
});
