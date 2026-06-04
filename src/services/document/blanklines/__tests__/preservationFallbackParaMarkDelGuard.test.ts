/**
 * Body-scope preservation-fallback guard for tracked paragraph-mark deletions.
 *
 * Regression for the "centered image renders left after processing" bug
 * (June 2026): the Participant screenshot in Error_Original sat in a paragraph
 * whose mark was tracked-deleted. Word merges such a paragraph into the FOLLOWING
 * paragraph at render time and the merge adopts the trailing paragraph's
 * alignment. The blank-line preservation fallback inserted a (left-aligned)
 * blank into that merge slot — driven by a false-positive `wasOriginallyBlankAtBody`
 * match, because image/empty paragraphs all hash to an empty text prefix — so the
 * image merged into the left blank instead of the next (centered) image, and
 * rendered left.
 *
 * Every other blank-insertion path already routes through the deleted-mark guard
 * in blankLineInsertion.ts; the two preservation-fallback inserts did not. This
 * test pins the body-scope fix.
 *
 * The collision is reproduced with text paragraphs: a real blank between an
 * "ALPHA"-prefixed and a "BETA"-prefixed paragraph makes the snapshot record a
 * blank whose before/after hashes also match the A→B slot, where A's mark is
 * tracked-deleted.
 */
/* globals describe, it, expect */
import { Document, Paragraph } from "docxmlater";
import { BlankLineManager } from "../BlankLineManager";
import { captureBlankLineSnapshot, wasOriginallyBlankAtBody } from "../helpers/blankLineSnapshot";

function buildCollisionDoc(deleteLeadMark: boolean): Document {
  const doc = Document.create();
  const a = doc.createParagraph("ALPHA"); // merge source
  if (deleteLeadMark) {
    a.markParagraphMarkAsDeleted(11, "Tester", new Date(2026, 0, 1));
  }
  doc.createParagraph("BETA"); // merge target — must stay A's immediate successor
  // Elsewhere: a genuine blank between ALPHA- and BETA-hashed paragraphs, so the
  // snapshot stores a blank whose neighbor hashes also match the A→B slot.
  doc.createParagraph("ALPHA");
  doc.createParagraph("");
  doc.createParagraph("BETA");
  return doc;
}

function successorOfDeletedMarkIsBlank(doc: Document): { found: boolean; blank: boolean } {
  for (let i = 0; i < doc.getBodyElementCount(); i++) {
    const el = doc.getBodyElementAt(i);
    if (el instanceof Paragraph && el.isParagraphMarkDeleted()) {
      const next = doc.getBodyElementAt(i + 1);
      const blank = next instanceof Paragraph && (next.getText() || "").trim() === "";
      return { found: true, blank };
    }
  }
  return { found: false, blank: false };
}

describe("body preservation-fallback guard for tracked paragraph-mark deletion", () => {
  it("does not preserve a blank into the merge slot of a deletion-marked paragraph", () => {
    const doc = buildCollisionDoc(true);

    const snapshot = captureBlankLineSnapshot(doc);
    // Precondition: the false-positive collision must actually fire, otherwise
    // the test would pass trivially without exercising the guard.
    expect(wasOriginallyBlankAtBody(snapshot, doc, 1)).toBe(true);

    new BlankLineManager().processBlankLines(doc, snapshot, {});

    const { found, blank } = successorOfDeletedMarkIsBlank(doc);
    expect(found).toBe(true);
    // The successor of the deletion-marked paragraph must still be real content
    // (the "BETA" merge target), NOT a preserved blank.
    expect(blank).toBe(false);

    doc.dispose();
  });

  it("still preserves the blank when the leading paragraph has no mark deletion (guard is specific)", () => {
    const doc = buildCollisionDoc(false);

    const snapshot = captureBlankLineSnapshot(doc);
    expect(wasOriginallyBlankAtBody(snapshot, doc, 1)).toBe(true);

    new BlankLineManager().processBlankLines(doc, snapshot, {});

    // With no deletion mark, the preservation fallback may legitimately restore
    // the blank at the A→B slot — proving the guard targets only merge slots.
    const a = doc.getBodyElementAt(0) as Paragraph;
    const next = doc.getBodyElementAt(1);
    expect(a.getText()).toBe("ALPHA");
    expect(next instanceof Paragraph && (next.getText() || "").trim() === "").toBe(true);

    doc.dispose();
  });
});
