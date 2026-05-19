/**
 * Pure functions for checking image-related paragraph characteristics.
 * Ported from docxmlater Document.ts public/private methods.
 */

import { Paragraph, ImageRun, Image, Revision } from "docxmlater";

const EMU_PER_PIXEL = 9525; // At 96 DPI

/**
 * Checks if an image is "small" (both dimensions < 100 pixels).
 * Ported from Document.ts:8423-8428
 */
export function isImageSmall(image: Image): boolean {
  const widthPx = image.getWidth() / EMU_PER_PIXEL;
  const heightPx = image.getHeight() / EMU_PER_PIXEL;
  return widthPx < 100 && heightPx < 100;
}

/**
 * Checks if a paragraph contains a small image (< 100x100 pixels).
 * Ported from Document.ts:8448-8453
 */
export function isSmallImageParagraph(para: Paragraph): boolean {
  const imageRun = getImageRunFromParagraph(para);
  if (!imageRun) return false;
  const image = imageRun.getImageElement();
  return isImageSmall(image);
}

/**
 * Checks if a paragraph is a "small-image text callout": its FIRST content
 * item is a small ImageRun (<100x100), it also has text, it is not a list
 * item, and it has no positive left indentation.
 *
 * These are leading-icon notice/callout paragraphs (e.g. a warning-icon
 * followed by "Do NOT ..." text). They must be visually separated from the
 * content directly above AND below them. Shared by aboveSmallImageTextRule
 * and belowSmallImageTextRule in rules/additionRules.ts.
 */
export function isSmallImageTextCalloutParagraph(para: Paragraph): boolean {
  if (para.getNumbering()) return false;

  const indent = para.getFormatting()?.indentation?.left;
  if (indent && indent > 0) return false;

  const content = para.getContent();
  if (!content || content.length === 0) return false;
  if (!(content[0] instanceof ImageRun)) return false;
  if (!isImageSmall(content[0].getImageElement())) return false;

  const text = para.getText()?.trim();
  return !!text;
}

/**
 * Extracts the first ImageRun from a paragraph, including from Revision elements.
 * Ported from Document.ts:8474-8491
 */
export function getImageRunFromParagraph(para: Paragraph): ImageRun | null {
  const content = para.getContent();
  for (const item of content) {
    if (item instanceof ImageRun) {
      return item;
    }
    // Also check inside Revision objects (tracked changes)
    if (item instanceof Revision) {
      for (const revContent of item.getContent()) {
        if (revContent instanceof ImageRun) {
          return revContent;
        }
      }
    }
  }
  return null;
}
