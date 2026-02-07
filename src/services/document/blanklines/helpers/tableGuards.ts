/**
 * Guard functions for skipping tables with nested content during blank line processing.
 * Cells containing nested tables have rawNestedContent that must be preserved —
 * removing paragraphs from these cells can violate ECMA-376 (every w:tc must end with w:p).
 */

import { Table } from "docxmlater";

/**
 * Returns true if the table contains any cells with nested tables.
 * Tables with nested content should be skipped during blank line
 * removal to avoid corrupting the cell structure.
 */
export function tableHasNestedContent(table: Table): boolean {
  for (const row of table.getRows()) {
    for (const cell of row.getCells()) {
      if (cell.hasNestedTables()) return true;
    }
  }
  return false;
}
