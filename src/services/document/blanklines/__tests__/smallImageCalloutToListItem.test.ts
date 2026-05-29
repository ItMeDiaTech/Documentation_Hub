/**
 * Regression test for a MISSING blank line between a small-image text callout
 * paragraph and a list item directly below it.
 *
 * bullets.docx scenario (table 4, r1c1):
 *   Para 0: "Review reject message..."           (plain text)
 *   Para 1: <BLANK>
 *   Para 2: [small icon][bold "...MUST be reviewed in AS400."]   (callout)
 *   Para 3: list item "Refer to the Reject Message section..."
 *
 * A leading-icon callout paragraph (e.g. a warning icon followed by
 * "Do NOT ..." text) is a standalone notice. It must be visually separated
 * from the list that follows it. Before the fix no addition rule covered
 * this boundary: afterListItemsRule only fires when the CURRENT element is a
 * list item, and boldColonNoIndentAfterRule suppresses its blank when the
 * next element is a list item — so the callout sat flush against the list.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

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
import { isSmallImageTextCalloutParagraph } from "../helpers/imageChecks";
import { belowSmallImageTextRule } from "../rules/additionRules";
import { BlankLineManager } from "../BlankLineManager";
import type { RuleContext } from "../rules/ruleTypes";

const blankOpts = { spacingAfter: 120, markAsPreserved: true, style: "Normal" };

/** Callout paragraph: small image FIRST, then bold text. */
function makeCalloutPara(text: string, indent?: number): any {
  return new (Paragraph as any)({
    content: [new (ImageRun as any)(25, 22), new (Run as any)(text, { bold: true })],
    formatting: indent ? { indentation: { left: indent } } : {},
  });
}

function makePlainPara(text: string): any {
  return new (Paragraph as any)({ content: [new (Run as any)(text)] });
}

function makeListItem(text: string, numId = 24): any {
  return new (Paragraph as any)({
    content: [new (Run as any)(text)],
    numbering: { numId, level: 0 },
  });
}

describe("isSmallImageTextCalloutParagraph", () => {
  it("identifies a leading-icon callout paragraph", () => {
    expect(isSmallImageTextCalloutParagraph(makeCalloutPara(" Must be reviewed in AS400."))).toBe(
      true
    );
  });

  it("rejects an indented small-image paragraph (list sub-item)", () => {
    expect(isSmallImageTextCalloutParagraph(makeCalloutPara(" Indented note", 720))).toBe(false);
  });

  it("rejects a plain text paragraph (no leading image)", () => {
    expect(isSmallImageTextCalloutParagraph(makePlainPara("Plain text"))).toBe(false);
  });

  it("rejects an image-only paragraph (no text)", () => {
    const imgOnly = new (Paragraph as any)({ content: [new (ImageRun as any)(25, 22)] });
    expect(isSmallImageTextCalloutParagraph(imgOnly)).toBe(false);
  });

  it("rejects a numbered small-image paragraph", () => {
    const para = new (Paragraph as any)({
      content: [new (ImageRun as any)(25, 22), new (Run as any)("text")],
      numbering: { numId: 1, level: 0 },
    });
    expect(isSmallImageTextCalloutParagraph(para)).toBe(false);
  });
});

describe("belowSmallImageTextRule", () => {
  it("matches when a callout paragraph is directly above a list item", () => {
    const callout = makeCalloutPara(" Do NOT work the Compound criteria form.");
    const listItem = makeListItem("Refer to the Reject Message section.");
    const ctx: RuleContext = {
      doc: new (Document as any)(),
      currentIndex: 0,
      currentElement: callout,
      nextElement: listItem,
      scope: "cell",
    };
    expect(belowSmallImageTextRule.matches(ctx)).toBe(true);
  });

  it("does NOT match when the next element is not a list item", () => {
    const callout = makeCalloutPara(" Do NOT work the Compound criteria form.");
    const ctx: RuleContext = {
      doc: new (Document as any)(),
      currentIndex: 0,
      currentElement: callout,
      nextElement: makePlainPara("Plain following text"),
      scope: "cell",
    };
    expect(belowSmallImageTextRule.matches(ctx)).toBe(false);
  });

  it("does NOT match when the current element is not a callout paragraph", () => {
    const ctx: RuleContext = {
      doc: new (Document as any)(),
      currentIndex: 0,
      currentElement: makePlainPara("Just text"),
      nextElement: makeListItem("A list item"),
      scope: "cell",
    };
    expect(belowSmallImageTextRule.matches(ctx)).toBe(false);
  });

  it("does NOT match when the callout ends in a bold colon (it introduces the list)", () => {
    // "⚠ Important information:" is a list intro — the list sits tight against
    // it; only a standalone callout ("⚠ Do NOT …") gets a blank below it.
    const ctx: RuleContext = {
      doc: new (Document as any)(),
      currentIndex: 0,
      currentElement: makeCalloutPara(" Important information:"),
      nextElement: makeListItem("RFI - With Clinical Info close option."),
      scope: "cell",
    };
    expect(belowSmallImageTextRule.matches(ctx)).toBe(false);
  });
});

describe("cell addition: blank below callout, above list item", () => {
  it("inserts a blank between a small-image callout and the list item below it", () => {
    const callout = makeCalloutPara(" Rejection MUST be reviewed in AS400.");
    const listItem = makeListItem("Refer to the Reject Message section.");
    const cell = new (TableCell as any)([callout, listItem]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    const added = (manager as any).applyAdditionRulesCells(doc, {}, blankOpts);

    expect(added).toBeGreaterThanOrEqual(1);
    const paras = cell.getParagraphs();
    expect(isParagraphBlank(paras[0])).toBe(false); // callout
    expect(isParagraphBlank(paras[1])).toBe(true); // ← inserted blank
    expect(isParagraphBlank(paras[2])).toBe(false); // list item
    expect(paras[2].getNumbering()).toBeTruthy();
  });

  it("does NOT insert a blank AFTER the callout when it is the last paragraph of the cell", () => {
    const text = makePlainPara("Some intro");
    const callout = makeCalloutPara(" Do NOT work the Compound criteria form.");
    const cell = new (TableCell as any)([text, callout]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ tables: [table] });

    const manager = new BlankLineManager();
    (manager as any).applyAdditionRulesCells(doc, {}, blankOpts);

    const paras = cell.getParagraphs();
    // The callout stays the last paragraph — no trailing blank after it.
    expect(isParagraphBlank(paras[paras.length - 1])).toBe(false);
    expect(paras[paras.length - 1].getText()).toContain("Do NOT");
  });

  it("does NOT insert a blank between a bold-colon callout and the list it introduces", () => {
    const callout = makeCalloutPara(" Important information:");
    const li1 = makeListItem("RFI - With Clinical Info close option.");
    const li2 = makeListItem("When sending RFI - With Clinical Info.");
    const cell = new (TableCell as any)([callout, li1, li2]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ bodyElements: [table], tables: [table] });

    const manager = new BlankLineManager();
    manager.processBlankLines(doc, { bodyBlanks: [], cellBlanks: [] } as any, {});

    const paras = cell.getParagraphs();
    const calloutIdx = paras.findIndex(
      (p: any) => !isParagraphBlank(p) && p.getText().includes("Important information")
    );
    expect(calloutIdx).toBeGreaterThanOrEqual(0);
    // The list item sits directly below the colon callout — no blank between.
    expect(paras[calloutIdx + 1].getNumbering()).toBeTruthy();
  });

  it("full processBlankLines keeps the blank between callout and list item", () => {
    const text = makePlainPara("Review reject message to verify a compound.");
    const callout = makeCalloutPara(" Rejection MUST be reviewed in AS400.");
    const li1 = makeListItem("Refer to the Reject Message section.");
    const li2 = makeListItem("If there are multiple reject messages.");
    const cell = new (TableCell as any)([text, callout, li1, li2]);
    const table = new (Table as any)([new MockRow([cell])]);
    const doc = new (Document as any)({ bodyElements: [table], tables: [table] });

    const manager = new BlankLineManager();
    manager.processBlankLines(doc, { bodyBlanks: [], cellBlanks: [] } as any, {});

    const paras = cell.getParagraphs();
    const calloutIdx = paras.findIndex(
      (p: any) => !isParagraphBlank(p) && p.getText().includes("Rejection MUST")
    );
    expect(calloutIdx).toBeGreaterThanOrEqual(0);
    // The paragraph directly after the callout must be a blank.
    expect(isParagraphBlank(paras[calloutIdx + 1])).toBe(true);
    // ...and the one after that the first list item.
    expect(paras[calloutIdx + 2].getNumbering()).toBeTruthy();
  });
});
