/**
 * Whitespace normalization for paragraph runs.
 *
 * Extracted from WordDocumentProcessor for testability.
 * Handles: double-space collapse, leading-space stripping,
 * cross-run double-space removal, and space insertion after small images.
 */

import { Run, ImageRun } from "docxmlater";
import { isImageSmall } from "../blanklines";

/**
 * Check if a run contains VML drawing content (legacy image format).
 * VML images appear as plain Run objects (not ImageRun) whose content
 * includes a "vml" type element. These are typically small inline icons.
 */
function hasVmlContent(run: Run): boolean {
  try {
    return run.getContent().some((c: { type: string }) => c.type === "vml");
  } catch {
    return false;
  }
}

/**
 * Check whether any index in the half-open range [from+1 … to-1] falls inside
 * a gap, OR if `from` itself is a gap boundary. A "gap" at index i means
 * invisible content (e.g. a Revision-wrapped hyperlink) sits between
 * runs[i] and runs[i+1].
 */
function hasGapInRange(gapAfter: Set<number> | undefined, from: number, to: number): boolean {
  if (!gapAfter) return false;
  for (let k = from; k < to; k++) {
    if (gapAfter.has(k)) return true;
  }
  return false;
}

/**
 * Normalize whitespace within a single paragraph's runs.
 *
 * - Collapses multiple consecutive spaces to one
 * - Strips leading spaces from the paragraph start
 * - Removes cross-run double spaces
 * - Inserts exactly one space after small inline images (<100x100px)
 *   when the following text has none
 *
 * @param gapAfter - Optional set of run indices where invisible content
 *   (e.g. Revision-wrapped hyperlinks) exists between runs[i] and runs[i+1].
 *   Cross-run whitespace normalization is skipped across these gaps.
 * @returns Number of runs modified
 */
export function normalizeRunWhitespace(runs: Run[], gapAfter?: Set<number>): number {
  let cleanedCount = 0;

  // Pre-pass: Merge space-only runs into adjacent text runs.
  // Space-only runs (e.g., <w:t xml:space="preserve"> </w:t>) are fragile —
  // framework defragmentation can drop them when merging adjacent runs with
  // matching formatting. Embedding the space into a content run prevents loss.
  let seenContentBefore = false;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const text = run.getText();

    // Track whether we've seen content (text, image, or VML drawing) before this position
    if (run instanceof ImageRun || (text && text.trim().length > 0)) {
      seenContentBefore = true;
      continue;
    }
    // VML image runs (legacy format) are visual content too
    if (!text && hasVmlContent(run)) {
      seenContentBefore = true;
      continue;
    }

    if (!text || text.trim().length > 0) continue; // Skip non-space-only runs
    if (run instanceof ImageRun) continue;

    // Don't merge leading space runs — let Step 1.5 handle paragraph-start stripping
    if (!seenContentBefore) continue;

    // This run is only whitespace — merge into a neighbor.
    // Never merge into ImageRun or VML runs — their getText()="" is not a text
    // container, and contaminating them defeats image-space-insertion logic.
    // Never merge across a content gap (Revision-wrapped hyperlink between runs).
    if (i > 0 && !gapAfter?.has(i - 1)) {
      const prevRun = runs[i - 1];
      if (!(prevRun instanceof ImageRun) && !hasVmlContent(prevRun)) {
        const prevText = prevRun.getText();
        if (prevText !== null && prevText !== undefined) {
          prevRun.setText(prevText + text);
          run.setText("");
          cleanedCount++;
          continue;
        }
      }
    }
    if (i < runs.length - 1 && !gapAfter?.has(i)) {
      const nextRun = runs[i + 1];
      if (!(nextRun instanceof ImageRun) && !hasVmlContent(nextRun)) {
        const nextText = nextRun.getText();
        if (nextText !== null && nextText !== undefined) {
          nextRun.setText(text + nextText);
          run.setText("");
          cleanedCount++;
          continue;
        }
      }
    }
  }

  let seenTextInParagraph = false;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const text = run.getText();
    if (!text) {
      // ImageRuns and VML image runs have no text but ARE visible content —
      // text after them is not at paragraph start and its leading
      // space must be preserved (e.g., image + " CC: your supervisor...")
      const isImage = run instanceof ImageRun;
      const isVml = !isImage && hasVmlContent(run);

      if (isImage || isVml) {
        seenTextInParagraph = true;

        // Ensure exactly one regular space after small inline images.
        // For ImageRun: check <100x100px. For VML: assume small (inline icons).
        const shouldInsertSpace = isImage
          ? isImageSmall(run.getImageElement()) && i < runs.length - 1
          : i < runs.length - 1;

        if (shouldInsertSpace) {
          // Matches regular space + all Unicode space variants (NOT tabs or newlines)
          const LEADING_SPACES = /^[ \u00A0\u2002-\u200A\u202F\u205F\u3000]+/;

          for (let j = i + 1; j < runs.length; j++) {
            const nextRun = runs[j];
            const nextText = nextRun.getText();
            if (!nextText) continue; // Skip non-text runs (e.g., another ImageRun)

            // Preserve tabs (intentional formatting)
            if (nextText.startsWith("\t")) break;

            // Strip all leading space characters (regular + variant)
            const stripped = nextText.replace(LEADING_SPACES, "");

            if (stripped.length === 0) {
              // Run was only spaces — clear it and check next run
              if (nextText.length > 0) {
                nextRun.setText("");
                cleanedCount++;
              }
              continue;
            }

            // Found actual text — ensure exactly one regular space before it
            const desired = " " + stripped;
            if (nextText !== desired) {
              nextRun.setText(desired);
              cleanedCount++;
            }
            break;
          }
        }
      }
      continue;
    }

    // Step 1: Collapse multiple consecutive SPACES only
    // Preserve tabs (\t) and newlines (\n) as they represent intentional formatting (<w:tab/> and <w:br/>)
    let cleaned = text.replace(/[ \u00A0]{2,}/g, " ");

    // Step 1.5: Strip leading spaces from paragraph start
    // Word uses setLeftIndent() for proper indentation, not literal spaces
    // Only strip space characters (U+0020), NOT tabs or other whitespace
    if (!seenTextInParagraph) {
      cleaned = cleaned.replace(/^[ \u00A0]+/, "");
      if (cleaned.length > 0) {
        seenTextInParagraph = true;
      }
    }

    // Step 2: Trim trailing space if next content run starts with space (cross-run double space)
    // Skip if invisible content (Revision-wrapped hyperlink) sits between the runs.
    if (i < runs.length - 1) {
      let nextText = "";
      let nextJ = i + 1;
      for (let j = i + 1; j < runs.length; j++) {
        const candidate = runs[j]?.getText();
        if (candidate) {
          nextText = candidate;
          nextJ = j;
          break;
        }
      }
      if (
        /[ \u00A0]$/.test(cleaned) &&
        /^[ \u00A0]/.test(nextText) &&
        !hasGapInRange(gapAfter, i, nextJ)
      ) {
        cleaned = cleaned.trimEnd();
      }
    }

    // Step 3: Trim leading space if previous content run ends with space (cross-run double space)
    // Skip if invisible content (Revision-wrapped hyperlink) sits between the runs.
    if (i > 0) {
      let prevText = "";
      let prevJ = i - 1;
      for (let j = i - 1; j >= 0; j--) {
        const candidate = runs[j]?.getText();
        if (candidate) {
          prevText = candidate;
          prevJ = j;
          break;
        }
      }
      if (
        /^[ \u00A0]/.test(cleaned) &&
        /[ \u00A0]$/.test(prevText) &&
        !hasGapInRange(gapAfter, prevJ, i)
      ) {
        cleaned = cleaned.trimStart();
      }
    }

    if (cleaned !== text) {
      run.setText(cleaned);
      cleanedCount++;
    }
  }

  return cleanedCount;
}
