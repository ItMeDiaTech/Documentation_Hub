/**
 * Align paragraphs that follow a deletion-marked paragraph mark.
 *
 * When a paragraph's terminating pilcrow (paragraph mark) is wrapped in a
 * tracked-change deletion (`<w:pPr><w:rPr><w:del>`), Word renders the
 * paragraph as if it has been merged into the *following* paragraph: their
 * content is concatenated, and the resulting visible paragraph adopts the
 * trailing paragraph's alignment.
 *
 * That render behavior produces a surprise: a user who never centered the
 * "leading" content sees it appear centered because the trailing paragraph
 * happens to be centered (often by table uniformity, or by an authoring
 * boilerplate). The fix is to copy the leading paragraph's alignment onto
 * the trailing paragraph so the merge target carries the original intent.
 *
 * The pass walks paragraphs IN ORDER within a single scope — body or one
 * cell — because a paragraph-mark deletion only merges with the immediate
 * next paragraph at the same nesting level. We do not cross body↔cell or
 * cell↔cell boundaries.
 *
 * Run this pass BEFORE table uniformity. Table uniformity force-centers
 * paragraphs in shaded data/header cells; running first lets us normalize
 * the merge target while still letting uniformity re-center shaded cells
 * afterward (so shaded callouts remain centered as expected).
 */
import { Document, Paragraph } from "docxmlater";
import { isParagraphAlignment } from "docxmlater";

export function stripCenterAfterDeletedParaMark(doc: Document): number {
  let fixed = 0;

  fixed += processSequence(doc.getBodyElements());

  for (const table of doc.getAllTables()) {
    for (const row of table.getRows()) {
      for (const cell of row.getCells()) {
        fixed += processSequence(cell.getParagraphs());
      }
    }
  }

  return fixed;
}

function processSequence(elements: ReadonlyArray<unknown>): number {
  let fixed = 0;
  let prevPara: Paragraph | undefined;

  for (const el of elements) {
    if (!(el instanceof Paragraph)) {
      prevPara = undefined;
      continue;
    }
    if (
      prevPara &&
      prevPara.isParagraphMarkDeleted() &&
      el.getAlignment() === "center" &&
      prevPara.getAlignment() !== "center"
    ) {
      // undefined alignment renders as left in Word — collapse to "left"
      // so we always emit a concrete value the trail can carry. Validate
      // against the enum because getAlignment() returns a loose `string`.
      const raw = prevPara.getAlignment();
      const target = raw && isParagraphAlignment(raw) ? raw : "left";
      el.setAlignment(target);
      fixed++;
    }
    prevPara = el;
  }

  return fixed;
}
