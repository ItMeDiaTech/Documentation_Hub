/**
 * Functions for checking paragraph context (list context, etc.).
 * These need access to body elements via the Document public API.
 * Ported from docxmlater Document.ts private methods.
 */

import { Document, Paragraph, Table, TableCell } from "docxmlater";

/**
 * Checks if a non-list paragraph is "within" a list context.
 * A paragraph is within a list context if it has no numbering,
 * and the previous and next list items share the same numId.
 * Ported from Document.ts:8302-8348
 */
export function isWithinListContext(doc: Document, index: number): boolean {
  const current = doc.getBodyElementAt(index);
  if (!(current instanceof Paragraph)) {
    return false;
  }

  // If current is a list item, it's not "within" - it IS the list
  const currentNum = current.getNumbering();
  if (currentNum) {
    return false;
  }

  // Find previous list item (scanning backwards)
  let prevNumId: number | undefined;
  for (let i = index - 1; i >= 0; i--) {
    const el = doc.getBodyElementAt(i);
    if (el instanceof Paragraph) {
      const num = el.getNumbering();
      if (num) {
        prevNumId = num.numId;
        break;
      }
    } else if (el instanceof Table) {
      // Stop at table boundaries
      break;
    }
  }

  // Find next list item (scanning forwards)
  let nextNumId: number | undefined;
  const count = doc.getBodyElementCount();
  for (let i = index + 1; i < count; i++) {
    const el = doc.getBodyElementAt(i);
    if (el instanceof Paragraph) {
      const num = el.getNumbering();
      if (num) {
        nextNumId = num.numId;
        break;
      }
    } else if (el instanceof Table) {
      // Stop at table boundaries
      break;
    }
  }

  // Within list context only if both prev and next are same list
  return (
    prevNumId !== undefined &&
    nextNumId !== undefined &&
    prevNumId === nextNumId
  );
}

/**
 * Checks if a paragraph is within a list context inside a table cell.
 * Ported from Document.ts:8359-8389
 */
export function isWithinListContextInCell(
  cell: TableCell,
  paraIndex: number
): boolean {
  const cellParas = cell.getParagraphs();
  const current = cellParas[paraIndex];
  if (!current) return false;

  // If current is a list item, it's not "within" - it IS the list
  const currentNum = current.getNumbering();
  if (currentNum) {
    return false;
  }

  // Find previous list item in cell
  let prevNumId: number | undefined;
  for (let i = paraIndex - 1; i >= 0; i--) {
    const para = cellParas[i];
    if (para) {
      const num = para.getNumbering();
      if (num) {
        prevNumId = num.numId;
        break;
      }
    }
  }

  // Find next list item in cell
  let nextNumId: number | undefined;
  for (let i = paraIndex + 1; i < cellParas.length; i++) {
    const para = cellParas[i];
    if (para) {
      const num = para.getNumbering();
      if (num) {
        nextNumId = num.numId;
        break;
      }
    }
  }

  return (
    prevNumId !== undefined &&
    nextNumId !== undefined &&
    prevNumId === nextNumId
  );
}
