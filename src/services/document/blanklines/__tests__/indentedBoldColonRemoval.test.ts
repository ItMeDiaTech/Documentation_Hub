/**
 * Tests for removal rules R1/R2:
 *   - remove-above-indented-bold-colon
 *   - remove-indented-bold-colon-to-list-item
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */
import {
  aboveIndentedBoldColonRule,
  indentedBoldColonToListItemRule,
} from "../rules/removalRules";

jest.mock("docxmlater", () => {
  class MockRun {
    constructor(
      private text: string = "",
      private formatting: any = {},
      private _content: any[] = []
    ) {}
    getText() {
      return this.text;
    }
    getFormatting() {
      return this.formatting;
    }
    getContent() {
      return this._content;
    }
  }
  class MockImageRun extends MockRun {
    getImageElement() {
      return {};
    }
  }
  class MockHyperlink {
    getText() {
      return "";
    }
  }
  class MockShape {}
  class MockTextBox {}
  class MockField {}
  class MockRevision {
    getText() {
      return "";
    }
    getContent() {
      return [];
    }
  }
  class MockParagraph {
    constructor(
      private opts: {
        content?: any[];
        style?: string;
        alignment?: string;
        numbering?: any;
        formatting?: any;
      } = {}
    ) {}
    getContent() {
      return this.opts.content ?? [];
    }
    getText() {
      return (this.opts.content ?? [])
        .filter((c: any) => c.getText)
        .map((c: any) => c.getText())
        .join("");
    }
    getStyle() {
      return this.opts.style ?? "";
    }
    getAlignment() {
      return this.opts.alignment ?? "left";
    }
    getNumbering() {
      return this.opts.numbering ?? null;
    }
    getFormatting() {
      return this.opts.formatting ?? {};
    }
    getBookmarksStart() {
      return [];
    }
    getBookmarksEnd() {
      return [];
    }
    getRuns() {
      return (this.opts.content ?? []).filter(
        (c: any) => c instanceof MockRun && !(c instanceof MockImageRun)
      );
    }
  }
  class MockTable {}
  function isRun(x: any) {
    return x instanceof MockRun && !(x instanceof MockImageRun);
  }
  return {
    Paragraph: MockParagraph,
    Run: MockRun,
    ImageRun: MockImageRun,
    Hyperlink: MockHyperlink,
    Shape: MockShape,
    TextBox: MockTextBox,
    Field: MockField,
    Revision: MockRevision,
    Table: MockTable,
    isRun,
  };
});

import { Paragraph, Run, Table } from "docxmlater";

const blank = () => new Paragraph({ content: [] });
const indentedBoldColon = (text = "Note:") =>
  new Paragraph({
    content: [new Run(text, { bold: true })],
    formatting: { indentation: { left: 720 } },
  });
const listItemBoldColon = () =>
  new Paragraph({
    content: [new Run("Note:", { bold: true })],
    numbering: { numId: 5, level: 0 },
  });
const nonIndentedBoldColon = () =>
  new Paragraph({
    content: [new Run("Note:", { bold: true })],
    formatting: { indentation: { left: 0 } },
  });
const listItem = () =>
  new Paragraph({
    content: [new Run("List body")],
    numbering: { numId: 5, level: 0 },
  });
const indentedProse = () =>
  new Paragraph({
    content: [new Run("Plain indented body")],
    formatting: { indentation: { left: 720 } },
  });

function ctxBody(prev: any, current: any, next: any) {
  return {
    doc: {} as any,
    currentIndex: 1,
    currentElement: current,
    prevElement: prev,
    nextElement: next,
    scope: "body" as const,
  };
}

function ctxCell(prev: any, current: any, next: any, paras: any[]) {
  return {
    doc: {} as any,
    currentIndex: 1,
    currentElement: current,
    prevElement: prev,
    nextElement: next,
    scope: "cell" as const,
    cell: {} as any,
    cellParagraphs: paras,
    cellParaIndex: 1,
    parentTable: {} as any,
  };
}

describe("aboveIndentedBoldColonRule (R1)", () => {
  it("removes a blank above an indented bold-colon paragraph (body)", () => {
    const prev = new Paragraph({ content: [new Run("Some prose")] });
    const ctx = ctxBody(prev, blank(), indentedBoldColon());
    expect(aboveIndentedBoldColonRule.matches(ctx)).toBe(true);
  });

  it("removes a blank above a list-item bold-colon paragraph", () => {
    const prev = new Paragraph({ content: [new Run("Intro text")] });
    const ctx = ctxBody(prev, blank(), listItemBoldColon());
    expect(aboveIndentedBoldColonRule.matches(ctx)).toBe(true);
  });

  it("does NOT match when next is a non-indented bold-colon paragraph", () => {
    const prev = new Paragraph({ content: [new Run("Intro text")] });
    const ctx = ctxBody(prev, blank(), nonIndentedBoldColon());
    expect(aboveIndentedBoldColonRule.matches(ctx)).toBe(false);
  });

  it("does NOT match when current is not blank", () => {
    const prev = new Paragraph({ content: [new Run("Intro text")] });
    const ctx = ctxBody(prev, new Paragraph({ content: [new Run("Not blank")] }), indentedBoldColon());
    expect(aboveIndentedBoldColonRule.matches(ctx)).toBe(false);
  });

  it("fires inside table cells", () => {
    const prev = new Paragraph({ content: [new Run("Cell intro")] });
    const cur = blank();
    const next = indentedBoldColon();
    const paras = [prev, cur, next];
    expect(aboveIndentedBoldColonRule.matches(ctxCell(prev, cur, next, paras))).toBe(true);
  });
});

describe("indentedBoldColonToListItemRule (R2)", () => {
  it("removes blank between indented bold-colon and a following list item", () => {
    const ctx = ctxBody(indentedBoldColon(), blank(), listItem());
    expect(indentedBoldColonToListItemRule.matches(ctx)).toBe(true);
  });

  it("does NOT match when prev is indented but not bold-colon", () => {
    const ctx = ctxBody(indentedProse(), blank(), listItem());
    expect(indentedBoldColonToListItemRule.matches(ctx)).toBe(false);
  });

  it("does NOT match when next is non-list indented prose", () => {
    const ctx = ctxBody(indentedBoldColon(), blank(), indentedProse());
    expect(indentedBoldColonToListItemRule.matches(ctx)).toBe(false);
  });

  it("does NOT match when prev is non-indented bold-colon (existing rule handles that)", () => {
    const ctx = ctxBody(nonIndentedBoldColon(), blank(), listItem());
    expect(indentedBoldColonToListItemRule.matches(ctx)).toBe(false);
  });

  it("fires inside table cells", () => {
    const prev = indentedBoldColon();
    const cur = blank();
    const next = listItem();
    const paras = [prev, cur, next];
    expect(indentedBoldColonToListItemRule.matches(ctxCell(prev, cur, next, paras))).toBe(true);
  });
});

describe("rule registration", () => {
  it("both rules are present in the removalRules export array", async () => {
    const { removalRules } = await import("../rules/removalRules");
    const ids = removalRules.map((r) => r.id);
    expect(ids).toContain("remove-above-indented-bold-colon");
    expect(ids).toContain("remove-indented-bold-colon-to-list-item");
  });
});
