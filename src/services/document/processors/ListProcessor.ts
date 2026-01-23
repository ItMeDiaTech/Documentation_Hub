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

import { Document, Paragraph, inchesToTwips } from "docxmlater";
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
   */
  async standardizeListPrefixFormatting(doc: Document): Promise<number> {
    let standardizedCount = 0;

    try {
      const numberingPart = await doc.getPart("word/numbering.xml");
      if (!numberingPart || typeof numberingPart.content !== "string") {
        log.warn("Unable to access numbering.xml for list prefix standardization");
        return 0;
      }

      let xmlContent = numberingPart.content;
      let modified = false;

      // Find all <w:lvl> elements
      const lvlRegex = /<w:lvl w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g;
      const matches = Array.from(xmlContent.matchAll(lvlRegex));

      log.debug(`Found ${matches.length} list levels to process`);

      // Special bullet fonts that should be preserved (used for special characters like open/closed circles)
      const specialBulletFonts = ["Webdings", "Wingdings", "Symbol", "Wingdings 2", "Wingdings 3", "Courier New"];

      // Process matches in reverse order
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const levelIndex = match[1];
        const levelContent = match[2];
        const fullMatch = match[0];

        const rPrMatches = Array.from(levelContent.matchAll(/<w:rPr>([\s\S]*?)<\/w:rPr>/g));

        if (rPrMatches.length > 0) {
          let updatedContent = levelContent;

          // Check if this level uses a special bullet font that should be preserved
          const currentFontMatch = levelContent.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/);
          const currentFont = currentFontMatch ? currentFontMatch[1] : null;
          const preserveFont = currentFont && specialBulletFonts.includes(currentFont);

          // Build font XML - preserve special bullet fonts, otherwise use Verdana
          // Bold is explicitly removed from bullet point symbols
          const fontToUse = preserveFont ? currentFont : "Verdana";
          const rPrXml = `<w:rPr>
              <w:rFonts w:hint="default" w:ascii="${fontToUse}" w:hAnsi="${fontToUse}" w:cs="${fontToUse}"/>
              <w:color w:val="000000"/>
              <w:sz w:val="24"/>
              <w:szCs w:val="24"/>
            </w:rPr>`;

          updatedContent = updatedContent.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, rPrXml);

          const updatedLevel = fullMatch.replace(levelContent, updatedContent);
          xmlContent = xmlContent.replace(fullMatch, updatedLevel);
          modified = true;
          standardizedCount++;

          if (preserveFont) {
            log.debug(`Standardized list level ${levelIndex}: preserved ${currentFont} font, 12pt black`);
          } else {
            log.debug(`Standardized list level ${levelIndex}: Verdana 12pt black`);
          }
        } else {
          // No rPr found - insert one with standard Verdana (no bullet font to preserve)
          const standardRPr = `<w:rPr>
              <w:rFonts w:hint="default" w:ascii="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/>
              <w:color w:val="000000"/>
              <w:sz w:val="24"/>
              <w:szCs w:val="24"/>
            </w:rPr>`;
          const updatedLevel = fullMatch.replace("</w:lvl>", `${standardRPr}\n          </w:lvl>`);
          xmlContent = xmlContent.replace(fullMatch, updatedLevel);
          modified = true;
          standardizedCount++;

          log.debug(`Added standardized formatting to list level ${levelIndex}`);
        }
      }

      if (modified) {
        await doc.setPart("word/numbering.xml", xmlContent);
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
   */
  async applyBulletUniformity(
    doc: Document,
    settings: ListBulletSettings
  ): Promise<ListProcessingResult> {
    let listsUpdated = 0;

    try {
      const numberingPart = await doc.getPart("word/numbering.xml");
      if (!numberingPart || typeof numberingPart.content !== "string") {
        return { listsUpdated: 0, levelsProcessed: 0 };
      }

      let xmlContent = numberingPart.content;
      let modified = false;

      // Update bullet characters based on settings
      for (const levelConfig of settings.indentationLevels) {
        if (levelConfig.bulletChar) {
          // Find and update bullet character for this level
          const lvlPattern = new RegExp(
            `(<w:lvl w:ilvl="${levelConfig.level}"[^>]*>[\\s\\S]*?<w:lvlText w:val=")([^"]*)("/>)`,
            "g"
          );

          const newContent = xmlContent.replace(lvlPattern, `$1${levelConfig.bulletChar}$3`);

          if (newContent !== xmlContent) {
            xmlContent = newContent;
            modified = true;
            listsUpdated++;
          }
        }
      }

      if (modified) {
        await doc.setPart("word/numbering.xml", xmlContent);
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
