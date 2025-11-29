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

import { Document, Paragraph } from "docxmlater";
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
        try {
          // Apply indentation
          para.setIndentation({
            left: this.inchesToTwips(indentSetting.textIndent),
            hanging: this.inchesToTwips(indentSetting.textIndent - indentSetting.symbolIndent),
          });

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

      // Standard formatting: Verdana 12pt black
      const standardRPr = `<w:rPr>
              <w:rFonts w:hint="default" w:ascii="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/>
              <w:color w:val="000000"/>
              <w:sz w:val="24"/>
              <w:szCs w:val="24"/>
            </w:rPr>`;

      // Process matches in reverse order
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const levelIndex = match[1];
        const levelContent = match[2];
        const fullMatch = match[0];

        const rPrMatches = Array.from(levelContent.matchAll(/<w:rPr>([\s\S]*?)<\/w:rPr>/g));

        if (rPrMatches.length > 0) {
          let updatedContent = levelContent;

          // Check for existing bold
          const hasBold = levelContent.includes("<w:b/>") || levelContent.includes("<w:b ");
          const hasBoldCs = levelContent.includes("<w:bCs/>") || levelContent.includes("<w:bCs ");

          // Build standardized rPr
          let rPrXml = `<w:rPr>
              <w:rFonts w:hint="default" w:ascii="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/>`;

          if (hasBold) rPrXml += `\n              <w:b/>`;
          if (hasBoldCs) rPrXml += `\n              <w:bCs/>`;

          rPrXml += `\n              <w:color w:val="000000"/>
              <w:sz w:val="24"/>
              <w:szCs w:val="24"/>
            </w:rPr>`;

          updatedContent = updatedContent.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, rPrXml);

          const updatedLevel = fullMatch.replace(levelContent, updatedContent);
          xmlContent = xmlContent.replace(fullMatch, updatedLevel);
          modified = true;
          standardizedCount++;

          log.debug(`Standardized list level ${levelIndex}: Verdana 12pt black`);
        } else {
          // No rPr found - insert one
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
      const numberingDef = doc.getNumberingDefinition?.(numId);
      if (!numberingDef) return false;

      const abstractNum = numberingDef.getAbstractNumbering?.();
      if (!abstractNum) return false;

      const level0 = abstractNum.getLevel?.(0);
      return level0?.getFormat?.() === "bullet";
    } catch {
      return false;
    }
  }

  /**
   * Check if a paragraph is a numbered list item
   */
  isNumberedList(doc: Document, numId: number): boolean {
    try {
      const numberingDef = doc.getNumberingDefinition?.(numId);
      if (!numberingDef) return false;

      const abstractNum = numberingDef.getAbstractNumbering?.();
      if (!abstractNum) return false;

      const level0 = abstractNum.getLevel?.(0);
      const format = level0?.getFormat?.();
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

  /**
   * Convert inches to twips (1 inch = 1440 twips)
   */
  private inchesToTwips(inches: number): number {
    return Math.round(inches * 1440);
  }
}

export const listProcessor = new ListProcessor();
