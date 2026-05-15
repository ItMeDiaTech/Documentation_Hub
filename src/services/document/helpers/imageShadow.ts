/**
 * Image shadow / shape-effect removal.
 *
 * Word stores image shape-level effects (shadow, reflection, glow, soft-edge,
 * 3D, etc.) as an <a:effectLst> child of <pic:spPr>. DocXMLater captures the
 * whole blob in the image's raw-passthrough slot "spPr-effects" — there is no
 * typed setter that lets us turn individual effects off, so the cleanest way
 * to strip them is to remove the slot entirely before save. When the slot is
 * absent, DocXMLater simply does not emit <a:effectLst>, which is the same as
 * "Format Picture → Effects → No Effects" in the Word UI.
 *
 * The <a:blip> can also carry effects (color adjustments like grayscale).
 * Those live in a separate slot ("blip-effects") and are NOT touched here —
 * removing color adjustments is unrelated to the user-facing "shadow" toggle.
 */
import { Document, Image, ImageRun, Paragraph, Revision } from "docxmlater";

const SPP_EFFECTS_SLOT = "spPr-effects";

interface RawPassthroughCarrier {
  _rawPassthrough?: Map<string, string>;
}

/**
 * Removes any shape-level effect blob (shadow, reflection, glow, etc.) from
 * a single image's `<pic:spPr>`. Returns `true` if the image actually had an
 * effect blob to remove.
 */
export function clearImageShadow(image: Image): boolean {
  const passthrough = (image as unknown as RawPassthroughCarrier)._rawPassthrough;
  if (!passthrough || !passthrough.has(SPP_EFFECTS_SLOT)) return false;
  passthrough.delete(SPP_EFFECTS_SLOT);
  return true;
}

/**
 * Walks every image reachable through paragraph content (body + table cells +
 * revisions) and strips shape-level effects. Returns the count of images that
 * actually had an effect blob removed.
 *
 * Mirrors the iteration pattern used by collectParagraphImages — only images
 * that DocXMLater exposes as ImageRun/Image are reached. VML-embedded images
 * are handled upstream by `vmlImageNormalizer` before this runs.
 */
export function clearAllImageShadows(doc: Document): number {
  let cleared = 0;
  for (const para of doc.getAllParagraphs()) {
    for (const img of collectImagesFromParagraph(para)) {
      if (clearImageShadow(img)) cleared++;
    }
  }
  return cleared;
}

function collectImagesFromParagraph(para: Paragraph): Image[] {
  const images: Image[] = [];
  for (const item of para.getContent()) {
    if (item instanceof Image) {
      images.push(item);
    } else if (item instanceof ImageRun) {
      images.push(item.getImageElement());
    } else if (item instanceof Revision) {
      for (const revItem of item.getContent()) {
        if (revItem instanceof ImageRun) {
          images.push(revItem.getImageElement());
        }
      }
    }
  }
  return images;
}
