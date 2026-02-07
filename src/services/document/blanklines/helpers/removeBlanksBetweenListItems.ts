/**
 * Removes blank paragraphs between consecutive list items.
 * Ported from Document.ts removeBlanksBetweenListItems() (lines 7159-7216)
 */

import { Document, Paragraph, Table } from "docxmlater";
import { isParagraphBlank } from "./paragraphChecks";
import { tableHasNestedContent } from "./tableGuards";

/**
 * Removes blank paragraphs between consecutive list items in both
 * body elements and table cells.
 *
 * This should be called AFTER list normalization (e.g., after converting
 * typed list prefixes like "1.", "a." to proper Word numbering) to clean up
 * blanks that were missed because items didn't have Word numbering yet.
 *
 * @param doc - The document to process
 * @returns Number of blank paragraphs removed
 */
export function removeBlanksBetweenListItems(doc: Document): number {
  let removed = 0;

  // Process table cells
  // Skip tables with nested content to avoid violating ECMA-376 cell structure
  for (const table of doc.getAllTables()) {
    if (tableHasNestedContent(table)) continue;
    for (const row of table.getRows()) {
      for (const cell of row.getCells()) {
        let cellParas = cell.getParagraphs();
        for (let ci = 1; ci < cellParas.length - 1; ci++) {
          const prev = cellParas[ci - 1];
          const current = cellParas[ci];
          const next = cellParas[ci + 1];

          if (!current || !isParagraphBlank(current)) continue;

          const prevNumbering = prev?.getNumbering();
          const nextNumbering = next?.getNumbering();

          if (prevNumbering && nextNumbering) {
            cell.removeParagraph(ci);
            ci--;
            removed++;
            cellParas = cell.getParagraphs();
          } else if (prevNumbering && !nextNumbering) {
            // Also remove blank between list item and indented continuation
            const nextIndent = next?.getFormatting()?.indentation?.left || 0;
            if (nextIndent > 0) {
              cell.removeParagraph(ci);
              ci--;
              removed++;
              cellParas = cell.getParagraphs();
            }
          }
        }
      }
    }
  }

  // Process body-level list items
  for (let bi = 1; bi < doc.getBodyElementCount() - 1; bi++) {
    const prev = doc.getBodyElementAt(bi - 1);
    const current = doc.getBodyElementAt(bi);
    const next = doc.getBodyElementAt(bi + 1);

    if (!(current instanceof Paragraph) || !isParagraphBlank(current)) continue;
    if (prev instanceof Table || next instanceof Table) continue;

    if (prev instanceof Paragraph && next instanceof Paragraph) {
      const prevNumbering = prev.getNumbering();
      const nextNumbering = next.getNumbering();

      if (prevNumbering && nextNumbering) {
        doc.removeBodyElementAt(bi);
        bi--;
        removed++;
      } else if (prevNumbering && !nextNumbering) {
        // Also remove blank between list item and indented continuation
        const nextIndent = next.getFormatting()?.indentation?.left || 0;
        if (nextIndent > 0) {
          doc.removeBodyElementAt(bi);
          bi--;
          removed++;
        }
      }
    }
  }

  return removed;
}
