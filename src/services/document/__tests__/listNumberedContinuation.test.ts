/**
 * @jest-environment node
 *
 * Body-scope numbered-list continuation (audit findings H2/H3).
 *
 * Uses the REAL docxmlater library and drives the actual private
 * WordDocumentProcessor.convertTypedPrefixesWithContext over a freshly built
 * document, then asserts list identity via numId:
 *   - A typed decimal marker that sequentially follows the previous level-0
 *     numbered list CONTINUES it (same numId) even across a prose paragraph
 *     or intervening sub-items.
 *   - A resumed marker of 1 starts a NEW list (distinct numId).
 */

import { Document } from "docxmlater";
import { WordDocumentProcessor } from "../WordDocumentProcessor";

function convert(doc: Document): void {
  const processor = new WordDocumentProcessor();
  // Private method — exercised directly with a real document.
  (processor as unknown as { convertTypedPrefixesWithContext(d: Document): number }).convertTypedPrefixesWithContext(
    doc
  );
}

function numIdAt(doc: Document, index: number): number | undefined {
  const num = doc.getAllParagraphs()[index]?.getNumbering();
  return num && num.numId !== 0 ? num.numId : undefined;
}

describe("body numbered-list continuation (H2/H3)", () => {
  it("continues across an intervening prose paragraph (H2)", () => {
    const doc = Document.create();
    doc.createParagraph("1. First");
    doc.createParagraph("2. Second");
    doc.createParagraph("This sentence interrupts the list.");
    doc.createParagraph("3. Third");
    doc.createParagraph("4. Fourth");

    convert(doc);

    const listId = numIdAt(doc, 0);
    expect(listId).toBeDefined();
    // Prose paragraph is not a list item.
    expect(numIdAt(doc, 2)).toBeUndefined();
    // All four numbered items share one numId -> Word renders 1,2,3,4.
    expect(numIdAt(doc, 1)).toBe(listId);
    expect(numIdAt(doc, 3)).toBe(listId);
    expect(numIdAt(doc, 4)).toBe(listId);

    doc.dispose();
  });

  it("starts a NEW list when the resumed marker is 1 (not a continuation)", () => {
    const doc = Document.create();
    doc.createParagraph("1. First");
    doc.createParagraph("2. Second");
    doc.createParagraph("Unrelated paragraph.");
    doc.createParagraph("1. Fresh");
    doc.createParagraph("2. Fresh two");

    convert(doc);

    const firstList = numIdAt(doc, 0);
    const secondList = numIdAt(doc, 3);
    expect(firstList).toBeDefined();
    expect(secondList).toBeDefined();
    expect(secondList).not.toBe(firstList);
    expect(numIdAt(doc, 1)).toBe(firstList);
    expect(numIdAt(doc, 4)).toBe(secondList);

    doc.dispose();
  });

  it("keeps level-0 items continuous across indented letter sub-items (H3)", () => {
    const doc = Document.create();
    doc.createParagraph("1. First");
    doc.createParagraph("a. sub of first").setLeftIndent(720);
    doc.createParagraph("2. Second");
    doc.createParagraph("b. sub of second").setLeftIndent(720);
    doc.createParagraph("3. Third");

    convert(doc);

    const listId = numIdAt(doc, 0); // "1."
    expect(listId).toBeDefined();
    // The level-0 decimal items continue the same list across the sub-items.
    expect(numIdAt(doc, 2)).toBe(listId); // "2."
    expect(numIdAt(doc, 4)).toBe(listId); // "3."

    doc.dispose();
  });

  it("does not merge two separate plain numbered lists that both start at 1", () => {
    const doc = Document.create();
    doc.createParagraph("1. Alpha");
    doc.createParagraph("2. Beta");
    doc.createParagraph("1. Gamma");
    doc.createParagraph("2. Delta");

    convert(doc);

    // "1. Gamma" restarts: distinct numId from the first list.
    expect(numIdAt(doc, 2)).not.toBe(numIdAt(doc, 0));
    expect(numIdAt(doc, 1)).toBe(numIdAt(doc, 0));
    expect(numIdAt(doc, 3)).toBe(numIdAt(doc, 2));

    doc.dispose();
  });
});

function level0FormatOf(doc: Document, index: number): string | undefined {
  const num = doc.getAllParagraphs()[index]?.getNumbering();
  if (!num || num.numId === 0) return undefined;
  const mgr = doc.getNumberingManager();
  const inst = mgr.getInstance(num.numId);
  if (!inst) return undefined;
  return mgr.getAbstractNumbering(inst.getAbstractNumId())?.getLevel(0)?.getFormat();
}

describe("flush-left letter sub-items under a numbered parent (M2)", () => {
  it("makes a/b a level-1 letter sub-list while 1/2 stay the decimal list", () => {
    const doc = Document.create();
    doc.createParagraph("1. First");
    doc.createParagraph("a. detail");
    doc.createParagraph("b. detail two");
    doc.createParagraph("2. Second");

    convert(doc);
    const paras = doc.getAllParagraphs();
    const num = (i: number) => paras[i]?.getNumbering();

    // "1." and "2." remain one decimal list at level 0.
    expect(num(0)?.level).toBe(0);
    expect(num(3)?.level).toBe(0);
    expect(num(3)?.numId).toBe(num(0)?.numId);

    // "a." and "b." form a SEPARATE level-1 letter list (not flattened into the
    // parent's decimal list).
    expect(num(1)?.level).toBe(1);
    expect(num(2)?.level).toBe(1);
    expect(num(1)?.numId).toBe(num(2)?.numId);
    expect(num(1)?.numId).not.toBe(num(0)?.numId);

    doc.dispose();
  });
});

describe("body Roman-vs-letter marker disambiguation (H5)", () => {
  it("classifies a lone/leading i/ii/iii list as Roman, not letters", () => {
    const doc = Document.create();
    doc.createParagraph("i. First");
    doc.createParagraph("ii. Second");
    doc.createParagraph("iii. Third");

    convert(doc);

    expect(level0FormatOf(doc, 0)).toBe("lowerRoman");
    doc.dispose();
  });

  it("keeps a genuine letter run (…h, i, j) as letters", () => {
    const doc = Document.create();
    doc.createParagraph("h. Eight");
    doc.createParagraph("i. Nine");
    doc.createParagraph("j. Ten");

    convert(doc);

    // The "i." continues the letter run rather than flipping to Roman.
    expect(level0FormatOf(doc, 0)).toBe("lowerLetter");
    doc.dispose();
  });
});
