/**
 * Integration test for the paragraph-mark-deletion blank-line insertion guard.
 *
 * Loads paramark-del-around-deleted-image.docx, which has three bullet items
 * at the same numbering level:
 *   1. "Pending fax queues are located..." — paragraph mark is tracked-deleted.
 *   2. A bulleted paragraph containing a tracked-deleted large drawing.
 *   3. "24/7 Clients:" — plain bulleted item, no paragraph-mark deletion.
 *
 * After processing, the guard must have stopped the "above" blank from
 * landing between item 1 and item 2 (which would corrupt the merge target
 * for item 1's paragraph-mark deletion). The "below" blank between item 2
 * and item 3 is unaffected and may still be inserted.
 */
/* globals describe, it, expect */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Document, Paragraph } from "docxmlater";
import { BlankLineManager } from "../BlankLineManager";
import { captureBlankLineSnapshot } from "../helpers/blankLineSnapshot";

const FIXTURE = resolve(
  __dirname,
  "..",
  "..",
  "__tests__",
  "fixtures",
  "paramark-del-around-deleted-image.docx"
);

function findBodyIndex(doc: Document, predicate: (p: Paragraph) => boolean): number {
  const count = doc.getBodyElementCount();
  for (let i = 0; i < count; i++) {
    const el = doc.getBodyElementAt(i);
    if (el instanceof Paragraph && predicate(el)) return i;
  }
  return -1;
}

describe("paragraph-mark-deletion guard — integration", () => {
  it("does not insert a blank between a paragraph-mark-deleted bullet and a bulleted tracked-deleted-image paragraph", async () => {
    const buf = readFileSync(FIXTURE);
    const doc = await Document.loadFromBuffer(buf, { revisionHandling: "preserve" });

    // Sanity: the fixture has the para-mark-deletion pattern we expect.
    const item1Idx = findBodyIndex(doc, (p) =>
      p.getText().includes("Pending fax queues are located")
    );
    expect(item1Idx).toBeGreaterThan(-1);
    const item1 = doc.getBodyElementAt(item1Idx);
    expect(item1).toBeInstanceOf(Paragraph);
    expect((item1 as Paragraph).isParagraphMarkDeleted()).toBe(true);
    expect((item1 as Paragraph).getNumbering()).not.toBeNull();

    // Run the real pipeline.
    const snapshot = captureBlankLineSnapshot(doc);
    const manager = new BlankLineManager();
    manager.processBlankLines(doc, snapshot, {});

    // The post-processing element immediately after item 1 must still be the
    // bulleted (tracked-deleted-image) paragraph, NOT a Normal blank.
    const newItem1Idx = findBodyIndex(doc, (p) =>
      p.getText().includes("Pending fax queues are located")
    );
    expect(newItem1Idx).toBeGreaterThan(-1);
    const successor = doc.getBodyElementAt(newItem1Idx + 1);
    expect(successor).toBeInstanceOf(Paragraph);
    const successorPara = successor as Paragraph;
    // The successor must still be a list item (has a numId), proving no
    // Normal blank was inserted between them.
    expect(successorPara.getNumbering()).not.toBeNull();
    // The 24/7 Clients item must still come later in the body — the image
    // paragraph remains between item 1 and the "24/7 Clients" item.
    const cliIdx = findBodyIndex(doc, (p) => p.getText().includes("24/7 Clients"));
    expect(cliIdx).toBeGreaterThan(newItem1Idx);

    doc.dispose();
  });

  it("preserves the leading paragraph's paragraph-mark deletion and numbering", async () => {
    const buf = readFileSync(FIXTURE);
    const doc = await Document.loadFromBuffer(buf, { revisionHandling: "preserve" });

    const snapshot = captureBlankLineSnapshot(doc);
    new BlankLineManager().processBlankLines(doc, snapshot, {});

    const idx = findBodyIndex(doc, (p) =>
      p.getText().includes("Pending fax queues are located")
    );
    const item1 = doc.getBodyElementAt(idx) as Paragraph;
    expect(item1.isParagraphMarkDeleted()).toBe(true);
    expect(item1.getNumbering()).not.toBeNull();

    doc.dispose();
  });
});
