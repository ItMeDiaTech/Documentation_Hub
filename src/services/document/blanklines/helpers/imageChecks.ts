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
