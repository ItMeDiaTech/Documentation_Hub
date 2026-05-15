/**
 * Unit tests for src/services/document/blanklines/helpers/blankLineInsertion.ts.
 *
 * Covers the para-mark-deletion guard on the body and cell insertion wrappers,
 * plus the same guard added to the existing insertOrMark* helpers.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */

jest.mock("docxmlater", () => {
  class MockParagraph {
    private markDeleted: boolean;
    private text: string;
    private preserved = false;
    private style: string | undefined;
    public _tag: string;
    constructor(opts: { text?: string; markDeleted?: boolean; tag?: string } = {}) {
      this.text = opts.text ?? "";
      this.markDeleted = !!opts.markDeleted;
      this._tag = opts.tag ?? "p";
    }
    static create() {
      return new MockParagraph();
    }
    getText() {
      return this.text;
    }
    getContent() {
      // Return empty array for blank paragraphs, array with a mock run for non-blank
      if (this.text === "" || this.text.trim() === "") {
        return [];
      }
      return [{ getText: () => this.text }];
    }
    isParagraphMarkDeleted() {
      return this.markDeleted;
    }
    isPreserved() {
      return this.preserved;
    }
    setPreserved(v: boolean) {
      this.preserved = v;
      return this;
    }
    setStyle(v: string) {
      this.style = v;
      return this;
    }
    setSpaceBefore(_v: number) {
      return this;
    }
    setSpaceAfter(_v: number) {
      return this;
    }
    setLineSpacing(_v: number) {
      return this;
    }
  }
  // Stub classes that isParagraphBlank checks with instanceof
  class MockRun {}
  class MockHyperlink {}
  class MockImageRun extends MockRun {}
  class MockShape {}
  class MockTextBox {}
  class MockField {}
  class MockRevision {}

  return {
    Paragraph: MockParagraph,
    Document: class {},
    Run: MockRun,
    Hyperlink: MockHyperlink,
    ImageRun: MockImageRun,
    Shape: MockShape,
    TextBox: MockTextBox,
    Field: MockField,
    Revision: MockRevision,
  };
});

import { Paragraph } from "docxmlater";
import {
  insertBlankAtBodyIfSafe,
  addBlankToCellIfSafe,
  insertOrMarkBlankAfter,
  insertOrMarkBlankBefore,
} from "../helpers/blankLineInsertion";
import type { BlankLineOptions } from "../types";

const opts: BlankLineOptions = {
  spacingAfter: 120,
  style: "Normal",
  markAsPreserved: true,
};

function makeDoc(body: any[]) {
  return {
    _body: body,
    getBodyElementAt(i: number) {
      return this._body[i];
    },
    getBodyElementCount() {
      return this._body.length;
    },
    insertBodyElementAt(i: number, el: any) {
      this._body.splice(i, 0, el);
    },
  } as any;
}

function makeCell(paras: any[]) {
  return {
    _paras: paras,
    getParagraphs() {
      return this._paras;
    },
    addParagraphAt(i: number, el: any) {
      this._paras.splice(i, 0, el);
    },
  } as any;
}

describe("insertBlankAtBodyIfSafe", () => {
  it("inserts a blank when the preceding element has no paragraph-mark deletion", () => {
    const a = new (Paragraph as any)({ text: "first", tag: "a" });
    const b = new (Paragraph as any)({ text: "second", tag: "b" });
    const doc = makeDoc([a, b]);

    const result = insertBlankAtBodyIfSafe(doc, 1, opts);
    expect(result).toBe("added");
    expect(doc._body.length).toBe(3);
    expect(doc._body[0]).toBe(a);
    expect(doc._body[2]).toBe(b);
  });

  it('returns "skipped" and does not insert when the preceding paragraph is paragraph-mark-deleted', () => {
    const a = new (Paragraph as any)({ text: "first", markDeleted: true, tag: "a" });
    const b = new (Paragraph as any)({ text: "second", tag: "b" });
    const doc = makeDoc([a, b]);

    const result = insertBlankAtBodyIfSafe(doc, 1, opts);
    expect(result).toBe("skipped");
    expect(doc._body.length).toBe(2);
    expect(doc._body[0]).toBe(a);
    expect(doc._body[1]).toBe(b);
  });

  it("inserts at index 0 when there is no preceding element", () => {
    const a = new (Paragraph as any)({ text: "first" });
    const doc = makeDoc([a]);

    const result = insertBlankAtBodyIfSafe(doc, 0, opts);
    expect(result).toBe("added");
    expect(doc._body.length).toBe(2);
    expect(doc._body[1]).toBe(a);
  });
});

describe("addBlankToCellIfSafe", () => {
  it("inserts a blank when the preceding paragraph has no paragraph-mark deletion", () => {
    const a = new (Paragraph as any)({ text: "first" });
    const b = new (Paragraph as any)({ text: "second" });
    const cell = makeCell([a, b]);

    const result = addBlankToCellIfSafe(cell, 1, opts);
    expect(result).toBe("added");
    expect(cell._paras.length).toBe(3);
  });

  it('returns "skipped" when the preceding paragraph in the cell is paragraph-mark-deleted', () => {
    const a = new (Paragraph as any)({ text: "first", markDeleted: true });
    const b = new (Paragraph as any)({ text: "second" });
    const cell = makeCell([a, b]);

    const result = addBlankToCellIfSafe(cell, 1, opts);
    expect(result).toBe("skipped");
    expect(cell._paras.length).toBe(2);
  });
});

describe("insertOrMarkBlankAfter — guard on the added branch", () => {
  it('returns "skipped" when the preceding paragraph is paragraph-mark-deleted and no existing blank is present', () => {
    const a = new (Paragraph as any)({ text: "first", markDeleted: true });
    const b = new (Paragraph as any)({ text: "second" });
    const doc = makeDoc([a, b]);

    // Insertion target would be index 1 (after element 0).
    const result = insertOrMarkBlankAfter(doc, 0, opts);
    expect(result).toBe("skipped");
    expect(doc._body.length).toBe(2);
  });

  it('still returns "marked" for an existing blank even if the preceding paragraph is mark-deleted (guard only fires on the added branch)', () => {
    const a = new (Paragraph as any)({ text: "first", markDeleted: true });
    const existingBlank = new (Paragraph as any)({ text: "" });
    const doc = makeDoc([a, existingBlank]);

    const result = insertOrMarkBlankAfter(doc, 0, opts);
    expect(result).toBe("marked");
    expect(doc._body.length).toBe(2);
    expect((existingBlank as any).isPreserved()).toBe(true);
  });
});

describe("insertOrMarkBlankBefore — guard on the added branch", () => {
  it('returns "skipped" when the element immediately before the insertion point is paragraph-mark-deleted', () => {
    // Inserting before element at index 2 means the new blank lands at index 2,
    // immediately after the element at index 1.
    const a = new (Paragraph as any)({ text: "head" });
    const b = new (Paragraph as any)({ text: "deleted-mark", markDeleted: true });
    const c = new (Paragraph as any)({ text: "target" });
    const doc = makeDoc([a, b, c]);

    const result = insertOrMarkBlankBefore(doc, 2, opts);
    expect(result).toBe("skipped");
    expect(doc._body.length).toBe(3);
  });
});
