/**
 * Shared utilities for creating and inserting blank paragraphs.
 * Encapsulates the repeated insert-or-mark pattern used across all phases.
 */

import { Document, Paragraph } from "docxmlater";
import type { BlankLineOptions } from "../types";
import { isParagraphBlank } from "./paragraphChecks";

/**
 * Returns true if the element at the given body index is a Paragraph whose
 * paragraph mark is tracked-deleted. Inserting a new paragraph immediately
 * after such an element would land in the merge slot of the deletion and
 * silently strip the deleted paragraph's bullet/style/indent when Word renders
 * accepted revisions. Callers use this to skip the insertion.
 *
 * Index out of range returns false (no preceding element → nothing to merge into).
 */
function isParagraphMarkDeletedAtBody(doc: Document, index: number): boolean {
  if (index < 0 || index >= doc.getBodyElementCount()) return false;
  const el = doc.getBodyElementAt(index);
  return el instanceof Paragraph && el.isParagraphMarkDeleted();
}

/**
 * Cell-scope counterpart of isParagraphMarkDeletedAtBody.
 */
function isParagraphMarkDeletedAtCell(
  paras: ReadonlyArray<unknown>,
  index: number
): boolean {
  if (index < 0 || index >= paras.length) return false;
  const el = paras[index];
  return el instanceof Paragraph && el.isParagraphMarkDeleted();
}

/**
 * Creates a blank paragraph with the specified options.
 */
export function createBlankParagraph(options: BlankLineOptions): Paragraph {
  const blankPara = Paragraph.create();
  blankPara.setStyle(options.style);
  if (options.spacingBefore !== undefined) {
    blankPara.setSpaceBefore(options.spacingBefore);
  }
  blankPara.setSpaceAfter(options.spacingAfter);
  if (options.lineSpacing !== undefined) {
    blankPara.setLineSpacing(options.lineSpacing);
  }
  if (options.markAsPreserved) {
    blankPara.setPreserved(true);
  }
  return blankPara;
}

/**
 * Inserts a blank paragraph at the given body index, unless the element
 * immediately preceding the insertion point has a tracked paragraph-mark
 * deletion (in which case the new blank would steal the merge slot).
 *
 * @returns 'added' if inserted, 'skipped' if guarded against.
 */
export function insertBlankAtBodyIfSafe(
  doc: Document,
  index: number,
  options: BlankLineOptions
): "added" | "skipped" {
  if (isParagraphMarkDeletedAtBody(doc, index - 1)) {
    return "skipped";
  }
  doc.insertBodyElementAt(index, createBlankParagraph(options));
  return "added";
}

/**
 * Inserts a blank paragraph into a cell at the given index, unless the
 * paragraph immediately preceding the insertion point has a tracked
 * paragraph-mark deletion. Callers pass the cell's current paragraph list
 * (via `cell.getParagraphs()`) so the guard does not have to re-fetch.
 *
 * @returns 'added' if inserted, 'skipped' if guarded against.
 */
export function addBlankToCellIfSafe(
  cell: { addParagraphAt(i: number, p: Paragraph): unknown; getParagraphs(): ReadonlyArray<unknown> },
  index: number,
  options: BlankLineOptions
): "added" | "skipped" {
  if (isParagraphMarkDeletedAtCell(cell.getParagraphs(), index - 1)) {
    return "skipped";
  }
  cell.addParagraphAt(index, createBlankParagraph(options));
  return "added";
}

/**
 * Inserts a blank paragraph after the element at the given index,
 * or marks the existing blank if one is already there.
 *
 * @returns 'added' if a new blank was inserted, 'marked' if existing was marked,
 * 'skipped' if no action taken (existing blank not eligible to mark, or
 * inserting would land in the merge slot of a tracked paragraph-mark deletion).
 */
export function insertOrMarkBlankAfter(
  doc: Document,
  elementIndex: number,
  options: BlankLineOptions
): "added" | "marked" | "skipped" {
  const nextElement = doc.getBodyElementAt(elementIndex + 1);

  if (nextElement instanceof Paragraph && isParagraphBlank(nextElement)) {
    // Mark existing blank as preserved
    nextElement.setStyle(options.style);
    if (options.markAsPreserved && !nextElement.isPreserved()) {
      nextElement.setPreserved(true);
      return "marked";
    }
    return "skipped";
  }
  // Guard on the added branch: do not insert into a paragraph-mark deletion's merge slot.
  if (isParagraphMarkDeletedAtBody(doc, elementIndex)) {
    return "skipped";
  }
  const blankPara = createBlankParagraph(options);
  doc.insertBodyElementAt(elementIndex + 1, blankPara);
  return "added";
}

/**
 * Inserts a blank paragraph before the element at the given index,
 * or marks the existing blank if one is already there.
 *
 * @returns 'added' if a new blank was inserted, 'marked' if existing was marked,
 * 'skipped' if no action taken (existing blank not eligible to mark, no room
 * before index 0, or inserting would land in the merge slot of a tracked
 * paragraph-mark deletion).
 */
export function insertOrMarkBlankBefore(
  doc: Document,
  elementIndex: number,
  options: BlankLineOptions
): "added" | "marked" | "skipped" {
  if (elementIndex <= 0) return "skipped";

  const prevElement = doc.getBodyElementAt(elementIndex - 1);

  if (prevElement instanceof Paragraph && isParagraphBlank(prevElement)) {
    // Mark existing blank as preserved
    prevElement.setStyle(options.style);
    if (options.markAsPreserved && !prevElement.isPreserved()) {
      prevElement.setPreserved(true);
      return "marked";
    }
    return "skipped";
  }
  // Guard on the added branch: do not insert into a paragraph-mark deletion's merge slot.
  if (isParagraphMarkDeletedAtBody(doc, elementIndex - 1)) {
    return "skipped";
  }
  const blankPara = createBlankParagraph(options);
  doc.insertBodyElementAt(elementIndex, blankPara);
  return "added";
}
