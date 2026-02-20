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
 * Normalize whitespace within a single paragraph's runs.
 *
 * - Collapses multiple consecutive spaces to one
 * - Strips leading spaces from the paragraph start
 * - Removes cross-run double spaces
 * - Inserts exactly one space after small inline images (<100x100px)
 *   when the following text has none
 *
 * @returns Number of runs modified
 */
export function normalizeRunWhitespace(runs: Run[]): number {
  let cleanedCount = 0;
  let seenTextInParagraph = false;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const text = run.getText();
    if (!text) {
      // ImageRuns have no text but ARE visible content —
      // text after them is not at paragraph start and its leading
      // space must be preserved (e.g., image + " CC: your supervisor...")
      if (run instanceof ImageRun) {
        seenTextInParagraph = true;

        // Ensure exactly one regular space after small inline images (<100x100px).
        // Strip special/variant space characters (en space, em space, NBSP, etc.)
        // from between the image and text before ensuring the single space.
        const image = run.getImageElement();
        if (isImageSmall(image) && i < runs.length - 1) {
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
    let cleaned = text.replace(/ {2,}/g, " ");

    // Step 1.5: Strip leading spaces from paragraph start
    // Word uses setLeftIndent() for proper indentation, not literal spaces
    // Only strip space characters (U+0020), NOT tabs or other whitespace
    if (!seenTextInParagraph) {
      cleaned = cleaned.replace(/^ +/, "");
      if (cleaned.length > 0) {
        seenTextInParagraph = true;
      }
    }

    // Step 2: Trim trailing space if next run starts with space (cross-run double space)
    if (i < runs.length - 1) {
      const nextRun = runs[i + 1];
      const nextText = nextRun?.getText() || "";
      if (cleaned.endsWith(" ") && nextText.startsWith(" ")) {
        cleaned = cleaned.trimEnd();
      }
    }

    // Step 3: Trim leading space if previous run ends with space (cross-run double space)
    if (i > 0) {
      const prevRun = runs[i - 1];
      const prevText = prevRun?.getText() || "";
      if (cleaned.startsWith(" ") && prevText.endsWith(" ")) {
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
