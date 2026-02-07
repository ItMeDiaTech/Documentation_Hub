/**
 * StructureProcessor - Document structure operations
 *
 * Handles:
 * - Blank paragraph removal
 * - Structure blank line insertion (after lists, tables)
 * - Whitespace normalization
 * - Italic formatting removal
 * - Headers and footers removal
 * - Document warnings
 */

import { Document, Paragraph, Run, Hyperlink, Image, ImageRun } from "docxmlater";
import { logger } from "@/utils/logger";

const log = logger.namespace("StructureProcessor");

/**
 * Structure processing service
 */
export class StructureProcessor {
  private readonly DEBUG = process.env.NODE_ENV !== "production";

  /**
   * Remove extra whitespace from text runs - Collapse multiple spaces to single space,
   * strip leading spaces from paragraphs, and handle cross-run double spaces.
   */
  async removeExtraWhitespace(doc: Document): Promise<number> {
    let cleanedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const runs = para.getRuns();
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
    }

    log.info(`Cleaned whitespace in ${cleanedCount} runs`);
    return cleanedCount;
  }

  /**
   * Remove italic formatting from all text runs
   */
  async removeItalicFormatting(doc: Document): Promise<number> {
    let removedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const runs = para.getRuns();
      for (const run of runs) {
        const formatting = run.getFormatting();
        if (formatting?.italic) {
          run.setItalic(false);
          removedCount++;
        }
      }
    }

    log.info(`Removed italic formatting from ${removedCount} runs`);
    return removedCount;
  }

  /**
   * Remove headers and footers from document
   */
  async removeHeadersFooters(doc: Document): Promise<number> {
    try {
      const removedCount = doc.removeAllHeadersFooters();
      log.info(`Removed ${removedCount} headers/footers`);
      return removedCount;
    } catch (error) {
      log.error(`Error removing headers/footers: ${error}`);
      return 0;
    }
  }

  /**
   * Add document warning at end of document
   */
  async addDocumentWarning(doc: Document): Promise<boolean> {
    try {
      // Check if warning already exists
      const paragraphs = doc.getAllParagraphs();
      const searchStartIndex = Math.max(0, paragraphs.length - 10);

      for (let i = paragraphs.length - 1; i >= searchStartIndex; i--) {
        const text = paragraphs[i].getText() || "";
        if (
          text.includes("electronic data") ||
          text.includes("not to be reproduced")
        ) {
          log.debug("Document warning already exists");
          return false;
        }
      }

      // Create warning paragraphs
      const warningParagraph1 = Paragraph.create("This is electronic data and is not to be reproduced, copied, or distributed.");
      warningParagraph1.setAlignment("center");
      warningParagraph1.setSpaceBefore(240);
      warningParagraph1.setSpaceAfter(0);

      const warningParagraph2 = Paragraph.create("For internal use only.");
      warningParagraph2.setAlignment("center");
      warningParagraph2.setSpaceBefore(0);
      warningParagraph2.setSpaceAfter(0);

      // Apply italic formatting to runs
      for (const run of warningParagraph1.getRuns()) {
        run.setItalic(true);
        run.setFont("Verdana");
        run.setSize(10);
      }

      for (const run of warningParagraph2.getRuns()) {
        run.setItalic(true);
        run.setFont("Verdana");
        run.setSize(10);
      }

      // Append to document
      doc.addParagraph(warningParagraph1);
      doc.addParagraph(warningParagraph2);

      log.info("Added document warning");
      return true;
    } catch (error) {
      log.error(`Error adding document warning: ${error}`);
      return false;
    }
  }

  /**
   * Check if a paragraph is truly empty
   */
  isParagraphTrulyEmpty(para: Paragraph): boolean {
    try {
      // Check for numbering (list item)
      const numbering = para.getNumbering();
      if (numbering) {
        return false;
      }

      // Check for content
      const content = para.getContent();

      if (content.length === 0) {
        return true;
      }

      // Check for hyperlinks or images
      for (const item of content) {
        if (item instanceof Hyperlink || item instanceof Image) {
          return false;
        }
      }

      // Check if all runs are empty
      const allRunsEmpty = content.every((item) => {
        if (item instanceof Run) {
          const text = (item.getText() || "").trim();
          return text === "";
        }
        return false;
      });

      return allRunsEmpty;
    } catch (error) {
      // Default to NOT empty - safer than deleting
      return false;
    }
  }

  /**
   * Find nearest Header2 text for a given paragraph index
   */
  findNearestHeader2(doc: Document, paragraphIndex: number): string | null {
    const paragraphs = doc.getAllParagraphs();

    // Search backwards from the given index
    for (let i = paragraphIndex; i >= 0; i--) {
      const para = paragraphs[i];
      const style = para.getStyle();

      if (style === "Heading2" || style === "Heading 2") {
        return para.getText() || null;
      }
    }

    return null;
  }
}

export const structureProcessor = new StructureProcessor();
