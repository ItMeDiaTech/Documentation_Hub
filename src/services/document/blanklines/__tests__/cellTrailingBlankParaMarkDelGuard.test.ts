/**
 * Cell-level paragraph-mark-deletion guard for blank-line REMOVAL.
 *
 * Fix.docx regression (May 2026): table cells whose last meaningful paragraph
 * has a tracked paragraph-mark deletion (`<w:del/>` inside `<w:pPr>/<w:rPr>`)
 * rely on the trailing empty paragraph that follows them as the merge target.
 * When Word's "Accept All" processes the deletion, the marked paragraph merges
 * with the next one. If `BlankLineManager` strips that trailing blank, the
 * merge crosses the cell boundary into the next row and Word collapses the
 * cell to its first character ("S" for "Suggest", "R" for "Refer").
 *
 * `BlankLineManager.processBlankLines` has two cell removal paths that must
 * honor this guard:
 *   - `applyRemovalRulesCells` (rule-based)
 *   - `dedup`'s trailing-blank loop (unconditional)
 */
/* globals describe, it, expect */
import { Document, Paragraph, Table } from "docxmlater";
import { BlankLineManager } from "../BlankLineManager";
import { captureBlankLineSnapshot } from "../helpers/blankLineSnapshot";

function makeTableWithCell(doc: Document) {
  const table = new Table(1, 1);
  doc.addTable(table);
  const cell = table.getCell(0, 0)!;
  while (cell.getParagraphs().length > 0) {
    cell.removeParagraph(0);
  }
  return cell;
}

describe("cell trailing-blank guard for tracked paragraph-mark deletion", () => {
  it("preserves the trailing blank that serves as the merge target for a paragraph-mark deletion", async () => {
    const doc = Document.create();
    const cell = makeTableWithCell(doc);

    // Paragraph A: real content, with a tracked paragraph-mark deletion.
    const content = cell.createParagraph(
      "Suggest that the member visit a CVS MinuteClinic."
    );
    content.markParagraphMarkAsDeleted(99, "Test Author", new Date());

    // Paragraph B: trailing blank merge target.
    cell.createParagraph("");

    expect(cell.getParagraphs().length).toBe(2);

    const snapshot = captureBlankLineSnapshot(doc);
    new BlankLineManager().processBlankLines(doc, snapshot, {});

    const paras = cell.getParagraphs();
    expect(paras.length).toBeGreaterThanOrEqual(2);
    expect(paras[0]?.isParagraphMarkDeleted()).toBe(true);
    // Word needs at least one paragraph AFTER the mark-deleted one as the
    // accept-time merge target — otherwise the merge crosses the cell border.
    const lastPara = paras[paras.length - 1];
    expect(lastPara && lastPara.getText().trim()).toBe("");

    doc.dispose();
  });

  it("still strips trailing blanks when the preceding paragraph has no mark deletion", async () => {
    // Sanity: the guard must not over-trigger on ordinary cells.
    const doc = Document.create();
    const cell = makeTableWithCell(doc);

    cell.createParagraph("Normal content paragraph.");
    cell.createParagraph("");
    cell.createParagraph("");

    const snapshot = captureBlankLineSnapshot(doc);
    new BlankLineManager().processBlankLines(doc, snapshot, {});

    expect(cell.getParagraphs().length).toBe(1);
    expect(cell.getParagraphs()[0]?.getText().trim()).toBe(
      "Normal content paragraph."
    );

    doc.dispose();
  });
});
