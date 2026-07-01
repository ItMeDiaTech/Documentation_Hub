/**
 * @jest-environment node
 *
 * normalizeLevelGaps must evaluate gaps per CONTIGUOUS body list run, not by
 * pooling every paragraph of a numId across the whole document (audit M5).
 * Two separate body lists that share one numId, one nested {0,1} and one with a
 * skipped level {0,2}, previously pooled to {0,1,2} (gap-free) and left the
 * deeper item stranded at level 2.
 */

import { Document } from "docxmlater";
import { WordDocumentProcessor } from "../WordDocumentProcessor";

function normalizeLevelGaps(doc: Document): number {
  const p = new WordDocumentProcessor();
  return (p as unknown as { normalizeLevelGaps(d: Document): number }).normalizeLevelGaps(doc);
}

function levelAt(doc: Document, index: number): number | undefined {
  return doc.getAllParagraphs()[index]?.getNumbering()?.level;
}

describe("normalizeLevelGaps body contiguous runs (M5)", () => {
  it("collapses the gap in only one of two separate lists sharing a numId", () => {
    const doc = Document.create();
    const numId = doc.getNumberingManager().createNumberedList();
    doc.createParagraph("A item").setNumbering(numId, 0);
    doc.createParagraph("A sub").setNumbering(numId, 1);
    doc.createParagraph("Separator prose.");
    doc.createParagraph("B item").setNumbering(numId, 0);
    doc.createParagraph("B deep").setNumbering(numId, 2);

    const changed = normalizeLevelGaps(doc);

    expect(levelAt(doc, 0)).toBe(0);
    expect(levelAt(doc, 1)).toBe(1);
    expect(levelAt(doc, 3)).toBe(0); // B item
    expect(levelAt(doc, 4)).toBe(1); // B deep: 2 -> 1 (gap collapsed within its own run)
    expect(changed).toBeGreaterThanOrEqual(1);
    doc.dispose();
  });

  it("still collapses a gap within a single contiguous list", () => {
    const doc = Document.create();
    const numId = doc.getNumberingManager().createNumberedList();
    doc.createParagraph("x").setNumbering(numId, 0);
    doc.createParagraph("y").setNumbering(numId, 1);
    doc.createParagraph("z").setNumbering(numId, 3); // gap at level 2

    normalizeLevelGaps(doc);

    expect(levelAt(doc, 2)).toBe(2); // 3 -> 2
    doc.dispose();
  });

  it("does not pool gaps across two adjacent lists with different numIds", () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const numX = mgr.createNumberedList();
    const numY = mgr.createNumberedList();
    doc.createParagraph("X0").setNumbering(numX, 0);
    doc.createParagraph("X2").setNumbering(numX, 2);
    doc.createParagraph("Y0").setNumbering(numY, 0);
    doc.createParagraph("Y2").setNumbering(numY, 2);

    normalizeLevelGaps(doc);

    expect(levelAt(doc, 1)).toBe(1); // X2 -> 1
    expect(levelAt(doc, 3)).toBe(1); // Y2 -> 1
    doc.dispose();
  });
});
