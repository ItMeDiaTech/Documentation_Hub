/**
 * Removes trailing blank paragraphs from all table cells in the document.
 * Ported from Document.ts removeTrailingBlanksInTableCells() (lines 5485-5502)
 */

import { Document } from "docxmlater";

/**
 * Removes trailing blank paragraphs from all table cells.
 * A trailing blank is a blank paragraph at the END of a cell, after all content.
 * Respects the ECMA-376 requirement that each cell must have at least one paragraph.
 *
 * @param doc - The document to process
 * @param options.ignorePreserveFlag - If true, removes trailing blanks even if marked preserved (default: true)
 * @returns Total number of paragraphs removed across all cells
 */
export function removeTrailingBlanksInTableCells(
  doc: Document,
  options?: { ignorePreserveFlag?: boolean }
): number {
  let totalRemoved = 0;
  const ignorePreserve = options?.ignorePreserveFlag ?? true;

  for (const table of doc.getAllTables()) {
    for (const row of table.getRows()) {
      for (const cell of row.getCells()) {
        totalRemoved += cell.removeTrailingBlankParagraphs({
          ignorePreserveFlag: ignorePreserve,
        });
      }
    }
  }

  return totalRemoved;
}
