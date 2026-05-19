/**
 * Strip page numbers and dotted tab leaders from Table-of-Contents entries.
 *
 * A Word field-based TOC stores each entry as a paragraph whose hyperlink run
 * carries three pieces: the heading text, a `<w:tab/>`, and a `PAGEREF` field
 * that resolves to the page number — and the paragraph itself carries a
 * right-aligned `<w:tabs>` stop with `w:leader="dot"` so the gap renders as a
 * dotted leader. Word displays this as `Heading Text...........7`.
 *
 * DocHub's intended TOC is a clean list of clickable internal hyperlinks with
 * NO page numbers and NO leader dots. `Document.rebuildTOCs()` produces that
 * shape — but only for SDT-wrapped TOCs (`<w:sdt>` with
 * `docPartGallery="Table of Contents"`). A plain field-based TOC with no SDT
 * wrapper is left completely untouched, so its leader/page-number content
 * survives processing.
 *
 * This helper closes that gap: for every TOC{n}-styled paragraph it
 *   1. clears the paragraph's leader tab-stops, and
 *   2. truncates each entry run's content at the first non-text item
 *      (tab, page-number, or field char), dropping the trailing
 *      `<w:tab/>` + `PAGEREF` + cached page number.
 *
 * Heading text runs are left with their formatting intact (`setText` replaces
 * only the run content, not its `<w:rPr>`).
 */
import { Document, Run, isRun, isHyperlink } from "docxmlater";

export interface TocCleanResult {
  /** Number of TOC entry paragraphs whose tab-stops were cleared. */
  paragraphs: number;
  /** Number of runs that had a trailing tab / page-number stripped. */
  runsCleaned: number;
}

const TOC_STYLE_RE = /^toc\s?\d+$/i;

/** Content item types that mark the start of the trailing leader / page-number. */
const TRAILING_TYPES = new Set([
  "tab",
  "pageNumber",
  "fieldChar",
  "instructionText",
  "separator",
]);

/**
 * Reduce a single entry run to its leading heading text, dropping any trailing
 * tab / page-number / field content. Returns true if the run was modified.
 */
function cleanEntryRun(run: Run): boolean {
  const content = run.getContent();
  if (content.length === 0) return false;

  let cutIndex = content.length;
  for (let i = 0; i < content.length; i++) {
    if (TRAILING_TYPES.has(content[i].type)) {
      cutIndex = i;
      break;
    }
  }
  if (cutIndex === content.length) return false;

  const text = content
    .slice(0, cutIndex)
    .filter((item) => item.type === "text")
    .map((item) => item.value ?? "")
    .join("");

  // setText replaces only the run's content elements; <w:rPr> is preserved.
  run.setText(text);
  return true;
}

export function cleanTocEntries(doc: Document): TocCleanResult {
  let paragraphs = 0;
  let runsCleaned = 0;

  for (const para of doc.getAllParagraphs()) {
    const style = para.getStyle();
    if (!style || !TOC_STYLE_RE.test(style)) continue;

    // Drop the right-aligned dotted-leader tab stop on the entry paragraph.
    para.setTabs([]);
    paragraphs++;

    for (const item of para.getContent()) {
      if (isHyperlink(item)) {
        const run = item.getRun();
        if (run && cleanEntryRun(run)) runsCleaned++;
      } else if (isRun(item)) {
        // Page-number content can also sit in a bare run alongside the
        // hyperlink (e.g. when the leader/PAGEREF was authored outside the
        // <w:hyperlink>). Skip TOC field-instruction runs — those have no
        // leading heading text and must not be touched.
        const run = item;
        const content = run.getContent();
        const hasFieldInstruction = content.some(
          (c) => c.type === "fieldChar" || c.type === "instructionText"
        );
        if (!hasFieldInstruction && cleanEntryRun(run)) runsCleaned++;
      }
    }
  }

  return { paragraphs, runsCleaned };
}

/** Exported for direct unit testing of the run-level logic. */
export const __test = { cleanEntryRun, TOC_STYLE_RE };
