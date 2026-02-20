/**
 * Shared utilities for creating and inserting blank paragraphs.
 * Encapsulates the repeated insert-or-mark pattern used across all phases.
 */

import { Document, Paragraph } from "docxmlater";
import type { BlankLineOptions } from "../types";
import { isParagraphBlank } from "./paragraphChecks";

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
 * Inserts a blank paragraph after the element at the given index,
 * or marks the existing blank if one is already there.
 *
 * @returns 'added' if a new blank was inserted, 'marked' if existing was marked, 'skipped' if no action taken
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
  } else {
    // Insert new blank paragraph
    const blankPara = createBlankParagraph(options);
    doc.insertBodyElementAt(elementIndex + 1, blankPara);
    return "added";
  }
}

/**
 * Inserts a blank paragraph before the element at the given index,
 * or marks the existing blank if one is already there.
 *
 * @returns 'added' if a new blank was inserted, 'marked' if existing was marked, 'skipped' if no action taken
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
  } else {
    // Insert new blank paragraph before the element
    const blankPara = createBlankParagraph(options);
    doc.insertBodyElementAt(elementIndex, blankPara);
    return "added";
  }
}
