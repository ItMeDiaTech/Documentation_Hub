/**
 * ListNormalizer numbered-continuation tests.
 *
 * These guard the rule that numbered lists MIRROR the original document's
 * numbering continuation:
 *   - Originally-distinct numbered lists in one cell stay distinct (the second
 *     starts a fresh numId so Word renders it 1., 2., 3. again).
 *   - An originally-continuous numbered list interrupted by prose stays
 *     continuous (one shared numId across the gap).
 *   - Bullet behavior is unchanged.
 *
 * Identity is asserted via numId / abstractNumId: a shared numId is one Word
 * counter, distinct numIds are independent counters (each restarted to 1).
 */

import { Document, Paragraph } from "docxmlater";
import { ListNormalizer } from "../ListNormalizer";

/** Resolve the abstractNumId for a paragraph's numId. */
function abstractNumIdOf(doc: Document, para: Paragraph): number | undefined {
  const numbering = para.getNumbering();
  if (!numbering) return undefined;
  return doc.getNumberingManager().getInstance(numbering.numId)?.getAbstractNumId();
}

describe("ListNormalizer numbered continuation", () => {
  it("(a) two originally-distinct typed numbered lists in one cell stay distinct", () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    // First list 1., 2., then a SECOND list that restarts at 1., 2.
    for (const t of ["1. First A", "2. First B", "1. Second A", "2. Second B"]) {
      cell.addParagraph(Paragraph.create(t));
    }

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const items = cell.getParagraphs().filter((p) => p.getNumbering() !== undefined);
    expect(items.length).toBe(4);

    const firstNumId = items[0]!.getNumbering()!.numId;
    const secondNumId = items[2]!.getNumbering()!.numId;

    // Items within each list share their numId.
    expect(items[1]!.getNumbering()!.numId).toBe(firstNumId);
    expect(items[3]!.getNumbering()!.numId).toBe(secondNumId);

    // The two lists are independent counters → distinct numIds and abstracts,
    // so the second renders 1., 2. again instead of continuing 3., 4.
    expect(secondNumId).not.toBe(firstNumId);
    expect(abstractNumIdOf(doc, items[2]!)).not.toBe(abstractNumIdOf(doc, items[0]!));
  });

  it("(b) an originally-continuous typed numbered list interrupted by prose stays continuous", () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    // 1., 2., <prose>, 3. — the sequential markers indicate one list.
    cell.addParagraph(Paragraph.create("1. Step one"));
    cell.addParagraph(Paragraph.create("2. Step two"));
    cell.addParagraph(Paragraph.create("Note: an interrupting non-list paragraph"));
    cell.addParagraph(Paragraph.create("3. Step three"));

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const items = cell.getParagraphs().filter((p) => p.getNumbering() !== undefined);
    expect(items.length).toBe(3);

    const numId = items[0]!.getNumbering()!.numId;
    // All three numbers continue in one list across the prose gap.
    expect(items[1]!.getNumbering()!.numId).toBe(numId);
    expect(items[2]!.getNumbering()!.numId).toBe(numId);
  });

  it("(a') two distinct Word numbered lists in a normalized cell stay distinct", () => {
    // Force the main normalization path (not the Word-only early-return path)
    // by including a typed item, then assert distinct source numIds remain
    // distinct numbered lists rather than collapsing into one continuous run.
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const listOne = mgr.createNumberedList();
    const listTwo = mgr.createNumberedList();
    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    const a1 = Paragraph.create("Word list one item A");
    a1.setNumbering(listOne, 0);
    const a2 = Paragraph.create("Word list one item B");
    a2.setNumbering(listOne, 0);
    const b1 = Paragraph.create("Word list two item A");
    b1.setNumbering(listTwo, 0);
    const b2 = Paragraph.create("Word list two item B");
    b2.setNumbering(listTwo, 0);
    // Typed item forces recommendedAction = "normalize" (main loop).
    const typed = Paragraph.create("1. Typed item that triggers normalization");
    cell.addParagraph(a1);
    cell.addParagraph(a2);
    cell.addParagraph(b1);
    cell.addParagraph(b2);
    cell.addParagraph(typed);

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const find = (needle: string) =>
      cell.getParagraphs().find((p) => p.getText().includes(needle))!;

    const oneA = find("Word list one item A");
    const oneB = find("Word list one item B");
    const twoA = find("Word list two item A");
    const twoB = find("Word list two item B");

    // Same source numId → same assigned numId (continues).
    expect(oneB.getNumbering()!.numId).toBe(oneA.getNumbering()!.numId);
    expect(twoB.getNumbering()!.numId).toBe(twoA.getNumbering()!.numId);
    // Different source numId → different assigned numId (stays separate).
    expect(twoA.getNumbering()!.numId).not.toBe(oneA.getNumbering()!.numId);
  });

  it("(c) bullet lists are unchanged — interleaved prose keeps one bullet list", () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const bulletNumId = mgr.createBulletList();
    const numberedNumId = mgr.createNumberedList();
    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    // Mixed cell to enter the main loop; bullets must keep the bullet path.
    const b1 = Paragraph.create("Bullet one");
    b1.setNumbering(bulletNumId, 0);
    const n1 = Paragraph.create("Numbered one");
    n1.setNumbering(numberedNumId, 0);
    const b2 = Paragraph.create("Bullet two");
    b2.setNumbering(bulletNumId, 0);
    cell.addParagraph(b1);
    cell.addParagraph(n1);
    cell.addParagraph(b2);

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const find = (needle: string) =>
      cell.getParagraphs().find((p) => p.getText().includes(needle))!;

    // Both bullets resolve to the same (bullet-lead mixed) abstract — bullet
    // grouping is untouched by the numbered-continuation change.
    expect(abstractNumIdOf(doc, find("Bullet two"))).toBe(
      abstractNumIdOf(doc, find("Bullet one"))
    );
    expect(find("Bullet one").getNumbering()!.level).toBe(0);
    expect(find("Bullet two").getNumbering()!.level).toBe(0);
  });

  it("(d) same-numId Word list split by a non-list paragraph remains ONE list", () => {
    // Regression guard kept local to this suite: a same-numId list interrupted
    // by a non-list paragraph must NOT be split into two lists, and the
    // sub-item after the gap must keep its level (not flatten to 0).
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const bulletNumId = mgr.createBulletList();
    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    const parent = Paragraph.create("Parent item");
    parent.setNumbering(bulletNumId, 0);
    const subA = Paragraph.create("Sub item A");
    subA.setNumbering(bulletNumId, 1);
    const note = Paragraph.create("Note: an interrupting non-list paragraph");
    const subB = Paragraph.create("Sub item B");
    subB.setNumbering(bulletNumId, 1);
    cell.addParagraph(parent);
    cell.addParagraph(subA);
    cell.addParagraph(note);
    cell.addParagraph(subB);

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const byText = (t: string) => cell.getParagraphs().find((p) => p.getText().startsWith(t))!;
    expect(byText("Parent item").getNumbering()!.level).toBe(0);
    expect(byText("Sub item A").getNumbering()!.level).toBe(1);
    expect(byText("Sub item B").getNumbering()!.level).toBe(1);
  });
});
