/**
 * ListNormalizer mixed-list preservation tests.
 *
 * These tests guard the post-refactor behavior that each Word-list item keeps
 * its own bullet/numbered category. Cross-type "majority" conversion has been
 * removed: a cell containing both bullets and numbers should round-trip with
 * both categories intact.
 */

import { Document, Paragraph } from "docxmlater";
import { ListNormalizer } from "../ListNormalizer";

/**
 * Resolve whether a paragraph's numId points to a bullet abstract numbering
 * (i.e., level 0 has format "bullet").
 */
function isBulletNumId(doc: Document, numId: number | undefined): boolean {
  if (numId === undefined) return false;
  const mgr = doc.getNumberingManager();
  const inst = mgr.getInstance(numId);
  if (!inst) return false;
  const abs = mgr.getAbstractNumbering(inst.getAbstractNumId());
  return abs?.getLevel(0)?.getFormat() === "bullet";
}

describe("ListNormalizer mixed-list preservation", () => {
  it("preserves bullet -> numbered -> bullet pattern in a single cell", () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const bulletNumId = mgr.createBulletList();
    const numberedNumId = mgr.createNumberedList();

    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    const p1 = Paragraph.create("First bullet");
    p1.setNumbering(bulletNumId, 0);
    const p2 = Paragraph.create("Middle numbered");
    p2.setNumbering(numberedNumId, 0);
    const p3 = Paragraph.create("Last bullet");
    p3.setNumbering(bulletNumId, 0);
    cell.addParagraph(p1);
    cell.addParagraph(p2);
    cell.addParagraph(p3);

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const out = cell
      .getParagraphs()
      .filter((p) => p.getNumbering() !== undefined);
    expect(out.length).toBeGreaterThanOrEqual(3);

    // Slice the last three list items in case any default empty paragraphs precede them
    const items = out.slice(-3);
    expect(isBulletNumId(doc, items[0]!.getNumbering()?.numId)).toBe(true);
    expect(isBulletNumId(doc, items[1]!.getNumbering()?.numId)).toBe(false);
    expect(isBulletNumId(doc, items[2]!.getNumbering()?.numId)).toBe(true);
  });

  it("preserves numbered -> bullet -> numbered pattern in a single cell", () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const bulletNumId = mgr.createBulletList();
    const numberedNumId = mgr.createNumberedList();

    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    const p1 = Paragraph.create("First numbered");
    p1.setNumbering(numberedNumId, 0);
    const p2 = Paragraph.create("Middle bullet");
    p2.setNumbering(bulletNumId, 0);
    const p3 = Paragraph.create("Last numbered");
    p3.setNumbering(numberedNumId, 0);
    cell.addParagraph(p1);
    cell.addParagraph(p2);
    cell.addParagraph(p3);

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const out = cell
      .getParagraphs()
      .filter((p) => p.getNumbering() !== undefined);
    expect(out.length).toBeGreaterThanOrEqual(3);

    const items = out.slice(-3);
    expect(isBulletNumId(doc, items[0]!.getNumbering()?.numId)).toBe(false);
    expect(isBulletNumId(doc, items[1]!.getNumbering()?.numId)).toBe(true);
    expect(isBulletNumId(doc, items[2]!.getNumbering()?.numId)).toBe(false);
  });

  it("converts typed '1.' prefix to a numbered Word list (regression guard)", () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    const p1 = Paragraph.create("1. First item");
    const p2 = Paragraph.create("2. Second item");
    cell.addParagraph(p1);
    cell.addParagraph(p2);

    const normalizer = new ListNormalizer(mgr);
    const report = normalizer.normalizeAllTables([table], { indentationLevels: [] });

    expect(report.normalized).toBeGreaterThanOrEqual(2);

    const out = cell
      .getParagraphs()
      .filter((p) => p.getNumbering() !== undefined);
    expect(out.length).toBeGreaterThanOrEqual(2);

    const items = out.slice(-2);
    expect(isBulletNumId(doc, items[0]!.getNumbering()?.numId)).toBe(false);
    expect(isBulletNumId(doc, items[1]!.getNumbering()?.numId)).toBe(false);
  });
});
