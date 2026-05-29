/**
 * Regression tests for blank-line behavior between list items and bold-colon
 * paragraphs.
 *
 * Contract:
 *   • list item → bold-colon paragraph ("Note:", "Result:", …)
 *       → keep tight, NO blank inserted. A bold-colon paragraph that directly
 *         follows a list item is inline commentary belonging to that list
 *         item (e.g. a "Note:" after a numbered procedure step).
 *   • list item → another list item
 *       → NO blank (handled by a separate guard in afterListItemsRule).
 *   • plain prose → bold-colon paragraph
 *       → INSERT blank. With no list item before it, a zero-indent bold-colon
 *         is separate body content and still needs visual separation.
 *
 * The suppression is scoped narrowly to the list-continuation case: only a
 * bold-colon paragraph whose nearest non-blank predecessor is a list item is
 * kept tight. Bold-colon paragraphs in ordinary body prose are untouched.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */
import {
  aboveBoldColonNoIndentRule,
  afterListItemsRule,
  boldColonNoIndentAfterRule,
} from "../rules/additionRules";

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
  };
});

import { Paragraph, Run } from "docxmlater";

const listItem = (text = "List item body") =>
  new Paragraph({
    content: [new Run(text)],
    numbering: { numId: 5, level: 0 },
  });

const boldColonNoIndent = (text = "Note:") =>
  new Paragraph({
    content: [new Run(text, { bold: true })],
    // Zero indent + non-list = separate body content (e.g. "Note:" at the
    // left margin). Per the post-Image-#6 contract, this gets a blank above.
    formatting: { indentation: { left: 0 } },
  });

const boldColonIndented = (text = "Example:", leftTwips = 720) =>
  new Paragraph({
    content: [new Run(text, { bold: true })],
    // Real callout — explicit indent aligns with the list's text indent
    // (0.5" = 720 twips). Per the post-Image-#6 contract, this stays tight.
    formatting: { indentation: { left: leftTwips } },
  });

const plainProse = (text = "Some plain prose") =>
  new Paragraph({ content: [new Run(text)] });

function makeDoc(elements: any[]) {
  return {
    getBodyElementCount: () => elements.length,
    getBodyElementAt: (i: number) => elements[i],
    getAllTables: () => [],
    getStyle: () => null,
  } as any;
}

function ctxBody(doc: any, currentIndex: number) {
  const current = doc.getBodyElementAt(currentIndex);
  const prev = currentIndex > 0 ? doc.getBodyElementAt(currentIndex - 1) : undefined;
  const next =
    currentIndex < doc.getBodyElementCount() - 1
      ? doc.getBodyElementAt(currentIndex + 1)
      : undefined;
  return {
    doc,
    currentIndex,
    currentElement: current,
    prevElement: prev,
    nextElement: next,
    scope: "body" as const,
  };
}

describe("afterListItemsRule — bold-colon continuation contract", () => {
  it("does NOT add a blank when list item is followed by an INDENTED bold-colon callout", () => {
    const doc = makeDoc([listItem(), boldColonIndented()]);
    expect(afterListItemsRule.matches(ctxBody(doc, 0))).toBe(false);
  });

  it("does NOT add a blank when list item is followed by a zero-indent bold-colon (list-item continuation)", () => {
    const doc = makeDoc([listItem(), boldColonNoIndent()]);
    expect(afterListItemsRule.matches(ctxBody(doc, 0))).toBe(false);
  });

  it("still adds a blank when list item is followed by ordinary prose", () => {
    const doc = makeDoc([listItem(), plainProse()]);
    expect(afterListItemsRule.matches(ctxBody(doc, 0))).toBe(true);
  });

  it("does not fire when the list item is followed by another list item", () => {
    const doc = makeDoc([listItem(), listItem("Next item")]);
    expect(afterListItemsRule.matches(ctxBody(doc, 0))).toBe(false);
  });

  it("ADDS a blank when list item is followed by a zero-indent Example: block", () => {
    // An "Example:" block is a standalone illustration, not inline commentary —
    // it is separated from the preceding list item by a blank line.
    const doc = makeDoc([listItem(), boldColonNoIndent("Example: State law requires ePA.")]);
    expect(afterListItemsRule.matches(ctxBody(doc, 0))).toBe(true);
  });
});

describe("aboveBoldColonNoIndentRule — list-continuation contract", () => {
  it("does NOT add a blank above a zero-indent bold-colon when prev is a list item", () => {
    const doc = makeDoc([listItem(), boldColonNoIndent()]);
    expect(aboveBoldColonNoIndentRule.matches(ctxBody(doc, 0))).toBe(false);
  });

  it("does NOT add a blank above a bold-colon when a list item precedes it across a blank", () => {
    const blank = new Paragraph({ content: [] });
    const doc = makeDoc([listItem(), blank, boldColonNoIndent()]);
    expect(aboveBoldColonNoIndentRule.matches(ctxBody(doc, 1))).toBe(false);
  });

  it("still adds a blank above a zero-indent bold-colon when prev is plain prose", () => {
    const doc = makeDoc([plainProse(), boldColonNoIndent()]);
    expect(aboveBoldColonNoIndentRule.matches(ctxBody(doc, 0))).toBe(true);
  });

  it("does NOT fire for an indented bold-colon (isBoldColonNoIndent gates on zero indent)", () => {
    const doc = makeDoc([listItem(), boldColonIndented()]);
    expect(aboveBoldColonNoIndentRule.matches(ctxBody(doc, 0))).toBe(false);
  });

  it("ADDS a blank above a zero-indent Example: block even when prev is a list item", () => {
    // "Example:" is the exception to the list-continuation suppression — a
    // standalone illustration keeps its blank line above.
    const doc = makeDoc([listItem(), boldColonNoIndent("Example: State law requires ePA.")]);
    expect(aboveBoldColonNoIndentRule.matches(ctxBody(doc, 0))).toBe(true);
  });
});

describe("boldColonNoIndentAfterRule — centered-pair guard", () => {
  const centeredBoldColon = () =>
    new Paragraph({
      content: [new Run("Example:", { bold: true })],
      alignment: "center",
      formatting: { indentation: { left: 0 } },
    });
  const centeredProse = () =>
    new Paragraph({ content: [new Run("Centered next")], alignment: "center" });

  it("does NOT add a blank after a centered bold-colon when next is also centered", () => {
    const doc = makeDoc([centeredBoldColon(), centeredProse()]);
    expect(boldColonNoIndentAfterRule.matches(ctxBody(doc, 0))).toBe(false);
  });

  it("still adds a blank after a centered bold-colon when next is left-aligned prose", () => {
    const doc = makeDoc([centeredBoldColon(), plainProse()]);
    expect(boldColonNoIndentAfterRule.matches(ctxBody(doc, 0))).toBe(true);
  });

  it("still adds a blank after a left-aligned bold-colon when next happens to be centered", () => {
    // Asymmetric pair — only suppress when BOTH are centered (visual group).
    const leftBoldColon = new Paragraph({
      content: [new Run("Note:", { bold: true })],
      formatting: { indentation: { left: 0 } },
    });
    const doc = makeDoc([leftBoldColon, centeredProse()]);
    expect(boldColonNoIndentAfterRule.matches(ctxBody(doc, 0))).toBe(true);
  });
});
