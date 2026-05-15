/**
 * Force every list-item paragraph (one with a real `<w:numPr>` numId > 0) to
 * be left-aligned. Center/right/justified list items are visually broken in
 * almost every context — the bullet/number sits to the left of the text, so
 * any non-left alignment puts the marker in an unexpected place relative to
 * the content.
 *
 * This pass intentionally only touches paragraphs that DocXMLater recognises
 * as list items (`getNumbering()` truthy with `numId > 0`). Typed-prefix
 * paragraphs ("1.", "a)") that haven't been converted into real Word lists
 * yet are NOT touched — those go through the list-normalization pipeline
 * first and become real list items, at which point a subsequent pass would
 * catch them. Inside table cells the same predicate applies.
 */
import { Document, Paragraph } from "docxmlater";

export function leftAlignListItems(doc: Document): number {
  let fixed = 0;

  for (const para of doc.getAllParagraphs()) {
    if (!isRealListItem(para)) continue;
    if (para.getAlignment() === "left") continue;
    para.setAlignment("left");
    fixed++;
  }

  return fixed;
}

function isRealListItem(para: Paragraph): boolean {
  const numbering = para.getNumbering();
  return !!(numbering && numbering.numId !== undefined && numbering.numId !== 0);
}
