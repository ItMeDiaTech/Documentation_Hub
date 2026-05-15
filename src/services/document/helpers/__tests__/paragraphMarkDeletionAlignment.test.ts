/**
 * Tests for src/services/document/helpers/paragraphMarkDeletionAlignment.ts.
 *
 * Verifies that a paragraph whose preceding paragraph has a deletion-marked
 * paragraph mark gets its alignment normalized to the preceding paragraph's
 * alignment — so Word's render-time merge does not surprise the user with
 * unexpected centering.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */
import { stripCenterAfterDeletedParaMark } from "../paragraphMarkDeletionAlignment";

jest.mock("docxmlater", () => {
  class MockParagraph {
    private alignment: string;
    private markDeleted: boolean;
    constructor(opts: { alignment?: string; markDeleted?: boolean } = {}) {
      this.alignment = opts.alignment ?? "left";
      this.markDeleted = !!opts.markDeleted;
    }
    getAlignment() {
      return this.alignment;
    }
    setAlignment(value: string) {
      this.alignment = value;
      return this;
    }
    isParagraphMarkDeleted() {
      return this.markDeleted;
    }
  }
  class MockTable {
    constructor(private rows: any[] = []) {}
    getRows() {
      return this.rows;
    }
  }
  class MockTableRow {
    constructor(private cells: any[] = []) {}
    getCells() {
      return this.cells;
    }
  }
  class MockTableCell {
    constructor(private paras: any[] = []) {}
    getParagraphs() {
      return this.paras;
    }
  }
  return {
    Paragraph: MockParagraph,
    Table: MockTable,
    TableRow: MockTableRow,
    TableCell: MockTableCell,
    Document: class {},
    isParagraphAlignment: (v: string) =>
      ["left", "center", "right", "justify", "both", "start", "end"].includes(v),
  };
});

import { Paragraph, Table, TableRow, TableCell } from "docxmlater";

function makeDoc(opts: { body?: any[]; tables?: any[] } = {}) {
  return {
    getBodyElements: () => opts.body ?? [],
    getAllTables: () => opts.tables ?? [],
  } as any;
}

describe("stripCenterAfterDeletedParaMark — body scope", () => {
  it("copies leading alignment onto a centered paragraph after a deletion-marked mark", () => {
    const lead = new Paragraph({ alignment: "left", markDeleted: true });
    const trail = new Paragraph({ alignment: "center" });
    const doc = makeDoc({ body: [lead, trail] });

    expect(stripCenterAfterDeletedParaMark(doc)).toBe(1);
    expect((trail as any).getAlignment()).toBe("left");
  });

  it("does NOT touch a centered paragraph when the predecessor has no deletion mark", () => {
    const lead = new Paragraph({ alignment: "left" });
    const trail = new Paragraph({ alignment: "center" });
    const doc = makeDoc({ body: [lead, trail] });

    expect(stripCenterAfterDeletedParaMark(doc)).toBe(0);
    expect((trail as any).getAlignment()).toBe("center");
  });

  it("does NOT touch a non-centered paragraph even when the predecessor has a deletion mark", () => {
    const lead = new Paragraph({ alignment: "left", markDeleted: true });
    const trail = new Paragraph({ alignment: "right" });
    const doc = makeDoc({ body: [lead, trail] });

    expect(stripCenterAfterDeletedParaMark(doc)).toBe(0);
    expect((trail as any).getAlignment()).toBe("right");
  });

  it("leaves both centered when leading is also centered (intentional center pair)", () => {
    const lead = new Paragraph({ alignment: "center", markDeleted: true });
    const trail = new Paragraph({ alignment: "center" });
    const doc = makeDoc({ body: [lead, trail] });

    expect(stripCenterAfterDeletedParaMark(doc)).toBe(0);
    expect((trail as any).getAlignment()).toBe("center");
  });

  it("propagates through a chain of deletion-marked paragraphs", () => {
    // P1(left, deleted) → P2(center, deleted) → P3(center)
    // P2 inherits left from P1. P3 then inherits the (now-updated) left from P2.
    const p1 = new Paragraph({ alignment: "left", markDeleted: true });
    const p2 = new Paragraph({ alignment: "center", markDeleted: true });
    const p3 = new Paragraph({ alignment: "center" });
    const doc = makeDoc({ body: [p1, p2, p3] });

    expect(stripCenterAfterDeletedParaMark(doc)).toBe(2);
    expect((p2 as any).getAlignment()).toBe("left");
    expect((p3 as any).getAlignment()).toBe("left");
  });

  it("resets the predecessor across a non-Paragraph body element (e.g., a table)", () => {
    // Pseudo-table object: not a Paragraph, so it breaks the merge chain.
    const lead = new Paragraph({ alignment: "left", markDeleted: true });
    const tableSentinel = { kind: "table" };
    const trail = new Paragraph({ alignment: "center" });
    const doc = makeDoc({ body: [lead, tableSentinel, trail] });

    expect(stripCenterAfterDeletedParaMark(doc)).toBe(0);
    expect((trail as any).getAlignment()).toBe("center");
  });
});

describe("stripCenterAfterDeletedParaMark — cell scope", () => {
  it("normalizes within a single cell", () => {
    const lead = new Paragraph({ alignment: "left", markDeleted: true });
    const trail = new Paragraph({ alignment: "center" });
    const cell = new TableCell([lead, trail]);
    const row = new TableRow([cell]);
    const table = new Table([row]);
    const doc = makeDoc({ tables: [table] });

    expect(stripCenterAfterDeletedParaMark(doc)).toBe(1);
    expect((trail as any).getAlignment()).toBe("left");
  });

  it("does NOT carry deletion context across cell boundaries", () => {
    const cellALead = new Paragraph({ alignment: "left", markDeleted: true });
    const cellBTrail = new Paragraph({ alignment: "center" });
    const cellA = new TableCell([cellALead]);
    const cellB = new TableCell([cellBTrail]);
    const row = new TableRow([cellA, cellB]);
    const table = new Table([row]);
    const doc = makeDoc({ tables: [table] });

    expect(stripCenterAfterDeletedParaMark(doc)).toBe(0);
    expect((cellBTrail as any).getAlignment()).toBe("center");
  });

  it("processes body and cells independently in the same pass", () => {
    const bodyLead = new Paragraph({ alignment: "left", markDeleted: true });
    const bodyTrail = new Paragraph({ alignment: "center" });
    const cellLead = new Paragraph({ alignment: "left", markDeleted: true });
    const cellTrail = new Paragraph({ alignment: "center" });
    const cell = new TableCell([cellLead, cellTrail]);
    const row = new TableRow([cell]);
    const table = new Table([row]);
    const doc = makeDoc({ body: [bodyLead, bodyTrail], tables: [table] });

    expect(stripCenterAfterDeletedParaMark(doc)).toBe(2);
    expect((bodyTrail as any).getAlignment()).toBe("left");
    expect((cellTrail as any).getAlignment()).toBe("left");
  });
});
