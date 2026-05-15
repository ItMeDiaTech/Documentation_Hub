/**
 * Regression tests for the "blank inserted between list-item and indented
 * bold-colon continuation" bug.
 *
 * Reproduces the Image #1 → Image #2 scenario from the user's report:
 *   • When processing Prior Authorizations requests offline: ...   (list item)
 *     Example: if the MDO is requesting Adderall XR 30 mg, ...     (indented bold-colon continuation)
 *
 * The processor was inserting a blank line between the bullet's wrapped
 * text and the "Example:" continuation. The fix:
 *   - afterListItemsRule must NOT add a blank when next starts with bold-colon
 *     (treat as continuation/callout under the list item)
 *   - aboveBoldColonNoIndentRule must NOT add a blank when prev is a list item
 *     (same intent, from the other direction)
 *
 * Both guards fire regardless of whether the bold-colon paragraph has an
 * explicit indent at addition time — the indentation decision tree may set
 * the indent later, but by then the blank would already be inserted.
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

const boldColonNoIndent = (text = "Example:") =>
  new Paragraph({
    content: [new Run(text, { bold: true })],
    // No indent and no numbering — looks like a standalone bold-colon line
    // at addition time, even though the indentation decision tree may
    // promote it to indented later.
    formatting: { indentation: { left: 0 } },
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

describe("afterListItemsRule — bold-colon continuation guard", () => {
  it("does NOT add a blank when the list item is followed by a bold-colon paragraph", () => {
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
});

describe("aboveBoldColonNoIndentRule — list-item prev guard", () => {
  it("does NOT add a blank above a bold-colon paragraph when prev is a list item", () => {
    const doc = makeDoc([listItem(), boldColonNoIndent()]);
    expect(aboveBoldColonNoIndentRule.matches(ctxBody(doc, 0))).toBe(false);
  });

  it("still adds a blank above a bold-colon paragraph when prev is plain prose", () => {
    const doc = makeDoc([plainProse(), boldColonNoIndent()]);
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
