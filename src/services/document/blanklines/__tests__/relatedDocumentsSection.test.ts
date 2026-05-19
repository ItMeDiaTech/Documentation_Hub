/**
 * Tests for blank-line behavior inside the "Related Documents" section.
 *
 * Contract:
 *   • After a Heading-2 "Related Documents" paragraph (or a 1x1 "Related
 *     Document" table), the section items — reference-link lines and a
 *     bold-colon "Parent Document:" line — are kept TIGHT: no blank lines are
 *     inserted between them.
 *   • A blank line is STILL inserted above the end-of-document disclaimer and
 *     above a "Top of the Document" navigation hyperlink.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */

import {
  aboveBoldColonNoIndentRule,
  boldColonNoIndentAfterRule,
  betweenBodyParagraphsRule,
} from "../rules/additionRules";

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
  }
  class MockImageRun extends MockRun {
    getImageElement() {
      return {};
    }
  }
  class MockHyperlink {
    constructor(private text: string = "") {}
    getText() {
      return this.text;
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

import { Paragraph, Run, Hyperlink } from "docxmlater";

const heading2 = (text = "Related Documents") =>
  new (Paragraph as any)({ content: [new (Run as any)(text)], style: "Heading2" });

const referenceLink = (text = "Customer Care Abbreviations, Definitions (017428)") =>
  new (Paragraph as any)({ content: [new (Hyperlink as any)(text)] });

const boldColonItem = (text = "Parent Document: CALL-0049 Customer Care") =>
  new (Paragraph as any)({ content: [new (Run as any)(text, { bold: true })] });

const topOfDocLink = () =>
  new (Paragraph as any)({ content: [new (Hyperlink as any)("Top of the Document")] });

const disclaimer = () =>
  new (Paragraph as any)({
    content: [new (Run as any)("Not to Be Reproduced or Disclosed to Others")],
  });

const plainProse = (text = "Some unrelated body prose") =>
  new (Paragraph as any)({ content: [new (Run as any)(text)] });

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

describe("Related Documents section — inter-item blank suppression", () => {
  // Section layout: [Heading2 "Related Documents", referenceLink, boldColonItem, topLink, disclaimer]
  const section = () => [
    heading2(),
    referenceLink(),
    boldColonItem(),
    topOfDocLink(),
    disclaimer(),
  ];

  it("does NOT add a blank above the bold-colon item when the reference link precedes it", () => {
    const doc = makeDoc(section());
    // currentIndex 1 = referenceLink, next = boldColonItem
    expect(aboveBoldColonNoIndentRule.matches(ctxBody(doc, 1))).toBe(false);
  });

  it("STILL adds a blank after the bold-colon item when the next element is the Top hyperlink", () => {
    const doc = makeDoc(section());
    // currentIndex 2 = boldColonItem, next = topOfDocLink — the Top hyperlink
    // is not a section "item", so the blank above it is preserved.
    expect(boldColonNoIndentAfterRule.matches(ctxBody(doc, 2))).toBe(true);
  });

  it("does NOT add a blank after a bold-colon item when the next element is another section item", () => {
    // Heading2 → boldColonItem → referenceLink: keep the two items tight.
    const doc = makeDoc([heading2(), boldColonItem(), referenceLink("Link B (000002)")]);
    expect(boldColonNoIndentAfterRule.matches(ctxBody(doc, 1))).toBe(false);
  });

  it("does NOT add a blank between two consecutive reference-link items", () => {
    const doc = makeDoc([heading2(), referenceLink("Link A (000001)"), referenceLink("Link B (000002)")]);
    expect(betweenBodyParagraphsRule.matches(ctxBody(doc, 1))).toBe(false);
  });

  it("still adds a blank above a bold-colon paragraph OUTSIDE any Related Documents section", () => {
    const doc = makeDoc([plainProse(), boldColonItem()]);
    expect(aboveBoldColonNoIndentRule.matches(ctxBody(doc, 0))).toBe(true);
  });
});
