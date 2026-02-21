/**
 * ListProcessor - List formatting and bullet/numbering operations
 *
 * Handles:
 * - List bullet settings and uniformity
 * - Numbered list formatting
 * - List prefix standardization (font, size, color)
 * - Indentation configuration
 * - Spacing between list items
 */

import { Document, inchesToTwips } from "docxmlater";
import { logger } from "@/utils/logger";

const log = logger.namespace("ListProcessor");

/**
 * Configuration for list indentation levels
 */
export interface ListIndentationLevel {
  level: number;
  symbolIndent: number; // Symbol/bullet position in inches
  textIndent: number; // Text position in inches
  bulletChar?: string;
  numberedFormat?: string;
}

/**
 * List bullet settings
 */
export interface ListBulletSettings {
  enabled: boolean;
  indentationLevels: ListIndentationLevel[];
  spacingBetweenItems: number;
}

/**
 * Result of list processing
 */
export interface ListProcessingResult {
  listsUpdated: number;
  levelsProcessed: number;
}

/**
 * List processing service
 */
export class ListProcessor {
  private readonly DEBUG = process.env.NODE_ENV !== "production";

  /**
   * Apply list indentation settings to all lists in the document
   */
  async applyListIndentation(
    doc: Document,
    settings: ListBulletSettings
  ): Promise<ListProcessingResult> {
    if (!settings.enabled || !settings.indentationLevels.length) {
      return { listsUpdated: 0, levelsProcessed: 0 };
    }

    let listsUpdated = 0;
    let levelsProcessed = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const numbering = para.getNumbering();
      if (!numbering) continue;

      const level = numbering.level || 0;
      const indentSetting = settings.indentationLevels.find((l) => l.level === level);

      if (indentSetting) {
        // Validate indentation - symbolIndent must be less than textIndent
        if (indentSetting.symbolIndent >= indentSetting.textIndent) {
          log.warn(
            `Invalid indentation for level ${level}: symbolIndent (${indentSetting.symbolIndent}) ` +
            `must be less than textIndent (${indentSetting.textIndent}). Skipping.`
          );
          continue;
        }

        try {
          // Apply indentation using individual methods
          para.setLeftIndent(inchesToTwips(indentSetting.textIndent));
          // Hanging indent is implemented as a negative first-line indent
          const hangingTwips = inchesToTwips(indentSetting.textIndent - indentSetting.symbolIndent);
          para.setFirstLineIndent(-hangingTwips);

          // Apply spacing if configured
          if (settings.spacingBetweenItems > 0) {
            para.setSpaceAfter(settings.spacingBetweenItems * 20); // Convert to twips
          }

          listsUpdated++;
          levelsProcessed++;
        } catch (error) {
          log.warn(`Failed to apply indentation to list item: ${error}`);
        }
      }
    }

    log.info(`Applied indentation to ${listsUpdated} list items`);
    return { listsUpdated, levelsProcessed };
  }

  /**
   * Standardize list prefix formatting (bullet/number font, size, color)
   * Uses NumberingLevel API setters instead of raw XML manipulation.
   */
  async standardizeListPrefixFormatting(doc: Document): Promise<number> {
    let standardizedCount = 0;

    try {
      const numberingManager = doc.getNumberingManager();
      if (!numberingManager) {
        log.warn("No numbering manager available for list prefix standardization");
        return 0;
      }

      const abstractNums = numberingManager.getAllAbstractNumberings();
      log.debug(`Found ${abstractNums.length} abstract numberings to process`);

      // Special bullet fonts that should be preserved (used for special characters like open/closed circles)
      const specialBulletFonts = ["Webdings", "Wingdings", "Symbol", "Wingdings 2", "Wingdings 3", "Courier New"];

      for (const abstractNum of abstractNums) {
        for (let levelIndex = 0; levelIndex <= 8; levelIndex++) {
          const level = abstractNum.getLevel(levelIndex);
          if (!level) continue;

          // Check if this level uses a special bullet font that should be preserved
          const currentFont = level.getProperties().font;
          const preserveFont = currentFont && specialBulletFonts.includes(currentFont);

          // Preserve special bullet fonts, otherwise use Verdana
          const fontToUse = preserveFont ? currentFont : "Verdana";
          level.setFont(fontToUse);
          level.setColor("000000");
          level.setFontSize(24); // 24 half-points = 12pt
          level.setBold(false);

          standardizedCount++;

          if (preserveFont) {
            log.debug(`Standardized list level ${levelIndex}: preserved ${currentFont} font, 12pt black`);
          } else {
            log.debug(`Standardized list level ${levelIndex}: Verdana 12pt black`);
          }
        }
      }

      if (standardizedCount > 0) {
        log.info(`Standardized ${standardizedCount} list prefix levels`);
      }
    } catch (error) {
      log.error(`Error standardizing list prefix formatting: ${error}`);
      throw error;
    }

    return standardizedCount;
  }

  /**
   * Apply bullet uniformity - standardize bullet characters
   * Uses NumberingLevel API setters instead of raw XML manipulation.
   */
  async applyBulletUniformity(
    doc: Document,
    settings: ListBulletSettings
  ): Promise<ListProcessingResult> {
    let listsUpdated = 0;

    try {
      const numberingManager = doc.getNumberingManager();
      if (!numberingManager) {
        return { listsUpdated: 0, levelsProcessed: 0 };
      }

      const abstractNums = numberingManager.getAllAbstractNumberings();

      // Update bullet characters based on settings
      for (const levelConfig of settings.indentationLevels) {
        if (!levelConfig.bulletChar) continue;

        for (const abstractNum of abstractNums) {
          const level = abstractNum.getLevel(levelConfig.level);
          if (!level) continue;

          // Only update bullet lists, not numbered lists
          if (level.getFormat() !== "bullet") continue;

          level.setText(levelConfig.bulletChar);
          listsUpdated++;
        }
      }

      if (listsUpdated > 0) {
        log.info(`Updated bullet characters in ${listsUpdated} list levels`);
      }
    } catch (error) {
      log.error(`Error applying bullet uniformity: ${error}`);
    }

    return { listsUpdated, levelsProcessed: listsUpdated };
  }

  /**
   * Check if a paragraph is a bullet list item
   */
  isBulletList(doc: Document, numId: number): boolean {
    try {
      const numberingManager = doc.getNumberingManager();
      const instance = numberingManager?.getNumberingInstance(numId);
      if (!instance) return false;

      const abstractNumId = instance.getAbstractNumId();
      const abstractNum = numberingManager?.getAbstractNumbering(abstractNumId);
      if (!abstractNum) return false;

      const level0 = abstractNum.getLevel(0);
      return level0?.getFormat() === "bullet";
    } catch {
      return false;
    }
  }

  /**
   * Check if a paragraph is a numbered list item
   */
  isNumberedList(doc: Document, numId: number): boolean {
    try {
      const numberingManager = doc.getNumberingManager();
      const instance = numberingManager?.getNumberingInstance(numId);
      if (!instance) return false;

      const abstractNumId = instance.getAbstractNumId();
      const abstractNum = numberingManager?.getAbstractNumbering(abstractNumId);
      if (!abstractNum) return false;

      const level0 = abstractNum.getLevel(0);
      const format = level0?.getFormat();
      return (
        format === "decimal" ||
        format === "lowerLetter" ||
        format === "upperLetter" ||
        format === "lowerRoman" ||
        format === "upperRoman"
      );
    } catch {
      return false;
    }
  }

}

export const listProcessor = new ListProcessor();
