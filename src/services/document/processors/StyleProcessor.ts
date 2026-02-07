/**
 * StyleProcessor - Style assignment and text formatting operations
 *
 * Handles:
 * - Heading style application (H1, H2, H3)
 * - Normal paragraph styling
 * - Font, size, color standardization
 * - Paragraph spacing and alignment
 * - Style definition management
 */

import { Document, Hyperlink, Paragraph, Run, Style, pointsToTwips, isRevision } from "docxmlater";
import { logger } from "@/utils/logger";

const log = logger.namespace("StyleProcessor");

/**
 * Style configuration from session
 */
export interface SessionStyle {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  preserveBold?: boolean;
  preserveItalic?: boolean;
  preserveUnderline?: boolean;
  alignment: "left" | "center" | "right" | "justify";
  color: string;
  spaceBefore: number;
  spaceAfter: number;
  lineSpacing: number;
  noSpaceBetweenSame?: boolean;
  indentation?: {
    left?: number;
    firstLine?: number;
  };
}

/**
 * Result of style application
 */
export interface StyleApplicationResult {
  heading1: number;
  heading2: number;
  heading3: number;
  normal: number;
  listParagraph: number;
}

/**
 * Table shading configuration
 */
export interface TableShadingSettings {
  header2Shading: string;
  otherShading: string;
}

/**
 * Style processing service
 */
export class StyleProcessor {
  private readonly DEBUG = process.env.NODE_ENV !== "production";

  /**
   * Apply custom styles to document based on session configuration
   */
  async applyCustomStyles(
    doc: Document,
    styles: SessionStyle[],
    tableShadingSettings?: TableShadingSettings,
    preserveBlankLinesAfterHeader2Tables?: boolean
  ): Promise<StyleApplicationResult> {
    const result: StyleApplicationResult = {
      heading1: 0,
      heading2: 0,
      heading3: 0,
      normal: 0,
      listParagraph: 0,
    };

    // Find configured styles
    const header1Style = styles.find((s) => s.id === "header1");
    const header2Style = styles.find((s) => s.id === "header2");
    const header3Style = styles.find((s) => s.id === "header3");
    const normalStyle = styles.find((s) => s.id === "normal");
    const listParagraphStyle = styles.find((s) => s.id === "listParagraph");

    // Use docxmlater's applyStyles if available
    if (typeof (doc as any).applyStyles === "function") {
      const config = this.convertStylesToDocXMLaterConfig(
        styles,
        tableShadingSettings
      );

      try {
        const docResult = (doc as any).applyStyles(config);
        result.heading1 = docResult?.heading1 || 0;
        result.heading2 = docResult?.heading2 || 0;
        result.heading3 = docResult?.heading3 || 0;
        result.normal = docResult?.normal || 0;
        result.listParagraph = docResult?.listParagraph || 0;

        log.info(
          `Applied styles via docxmlater: H1=${result.heading1}, H2=${result.heading2}, ` +
            `H3=${result.heading3}, Normal=${result.normal}, ListParagraph=${result.listParagraph}`
        );

        return result;
      } catch (error) {
        log.warn(`docxmlater applyStyles failed, falling back to manual: ${error}`);
      }
    }

    // Manual style application fallback
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      let styleToApply: SessionStyle | null = null;
      let styleType: keyof StyleApplicationResult | null = null;

      const currentStyle = para.getStyle();

      // Determine which style to apply
      if (currentStyle === "Heading1" || currentStyle === "Heading 1") {
        if (header1Style) {
          styleToApply = header1Style;
          styleType = "heading1";
        }
      } else if (currentStyle === "Heading2" || currentStyle === "Heading 2") {
        if (header2Style) {
          styleToApply = header2Style;
          styleType = "heading2";
        }
      } else if (currentStyle === "Heading3" || currentStyle === "Heading 3") {
        if (header3Style) {
          styleToApply = header3Style;
          styleType = "heading3";
        }
      } else if (currentStyle === "ListParagraph" || currentStyle === "List Paragraph") {
        if (listParagraphStyle) {
          styleToApply = listParagraphStyle;
          styleType = "listParagraph";
        } else if (normalStyle) {
          // Fallback to Normal if List Paragraph style not defined
          styleToApply = normalStyle;
          styleType = "listParagraph";
        }
      } else if (!currentStyle || currentStyle === "Normal") {
        // Apply Normal style to ALL paragraphs (including empty/blank lines)
        if (normalStyle) {
          styleToApply = normalStyle;
          styleType = "normal";
        }
      }

      if (styleToApply && styleType) {
        this.applyStyleToParagraph(para, styleToApply);
        result[styleType]++;
      }
    }

    log.info(
      `Applied styles manually: H1=${result.heading1}, H2=${result.heading2}, ` +
        `H3=${result.heading3}, Normal=${result.normal}, ListParagraph=${result.listParagraph}`
    );

    return result;
  }

  /**
   * Apply a single style to a paragraph
   */
  private applyStyleToParagraph(para: Paragraph, style: SessionStyle): void {
    // Apply paragraph formatting
    // PRESERVE center alignment if it already exists in the document
    // This prevents overriding intentional center formatting (like image captions)
    const existingAlignment = para.getFormatting().alignment;
    if (existingAlignment === 'center') {
      log.debug(`Preserving center alignment for: "${para.getText().substring(0, 30)}..."`);
      // Don't change alignment - keep center
    } else {
      para.setAlignment(style.alignment);
    }
    para.setSpaceBefore(pointsToTwips(style.spaceBefore));
    para.setSpaceAfter(pointsToTwips(style.spaceAfter));

    if (style.lineSpacing) {
      para.setLineSpacing(pointsToTwips(style.lineSpacing * 12));
    }

    if (style.indentation) {
      if (style.indentation.left !== undefined) {
        para.setLeftIndent(pointsToTwips(style.indentation.left));
      }
      if (style.indentation.firstLine !== undefined) {
        para.setFirstLineIndent(pointsToTwips(style.indentation.firstLine));
      }
    }

    // Build a set of runs that belong to real Hyperlink elements.
    // para.getRuns() includes runs from Hyperlink children, so we must distinguish
    // real hyperlink runs from false-hyperlink runs (runs with Hyperlink character
    // style that are NOT inside a w:hyperlink element).
    const realHyperlinkRuns = new Set<Run>();
    for (const item of para.getContent()) {
      if (item instanceof Hyperlink) {
        const hRun = item.getRun();
        if (hRun) realHyperlinkRuns.add(hRun);
      }
    }

    // Apply text formatting to all runs
    const runs = para.getRuns();
    for (const run of runs) {
      // Skip runs from real Hyperlink elements — preserve their formatting
      if (realHyperlinkRuns.has(run)) {
        continue;
      }
      // If the run has Hyperlink character style but is NOT a real hyperlink,
      // strip the false character style so it gets proper paragraph formatting
      if (typeof run.isHyperlinkStyled === 'function' && run.isHyperlinkStyled()) {
        run.setCharacterStyle(undefined as unknown as string);
        log.debug(
          `[FalseHyperlink] Stripped Hyperlink character style from run: ` +
          `"${run.getText()?.substring(0, 40) || ''}"`
        );
      }

      run.setFont(style.fontFamily);
      run.setSize(style.fontSize);

      if (!style.preserveBold) {
        run.setBold(style.bold);
      }
      if (!style.preserveItalic) {
        run.setItalic(style.italic);
      }
      if (!style.preserveUnderline) {
        run.setUnderline(style.underline ? "single" : false);
      }

      // Preserve white font - don't change color if run is white (FFFFFF)
      const currentColor = run.getFormatting().color?.toUpperCase();
      if (currentColor !== 'FFFFFF') {
        run.setColor(style.color.replace("#", ""));
      }
    }
  }

  /**
   * Update hyperlink style definition to use Verdana
   */
  async updateHyperlinkStyleDefinition(doc: Document): Promise<boolean> {
    try {
      const hyperlinkStyle = Style.create({
        styleId: "Hyperlink",
        name: "Hyperlink",
        type: "character",
        runFormatting: {
          font: "Verdana",
          size: 12,
          color: "0000FF",
          underline: "single",
          bold: false,
          italic: false,
        },
      });

      doc.addStyle(hyperlinkStyle);
      log.info("Updated Hyperlink style to use Verdana 12pt");
      return true;
    } catch (error) {
      log.warn("Failed to update Hyperlink style:", error);
      return false;
    }
  }

  /**
   * Convert session styles to docxmlater format
   */
  private convertStylesToDocXMLaterConfig(
    styles: SessionStyle[],
    tableShadingSettings?: TableShadingSettings
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {
      preserveWhiteFont: true, // Always preserve white font (FFFFFF) during style application
    };

    for (const style of styles) {
      // Use 'run' property name as expected by docxmlater applyStyles
      const run = {
        font: style.fontFamily,
        size: style.fontSize,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        color: style.color.replace("#", ""),
        preserveBold: style.preserveBold,
        preserveItalic: style.preserveItalic,
        preserveUnderline: style.preserveUnderline,
      };

      // Use 'paragraph' property name with nested 'spacing' as expected by docxmlater
      const paragraph: Record<string, unknown> = {
        alignment: style.alignment,
        spacing: {
          before: pointsToTwips(style.spaceBefore),
          after: pointsToTwips(style.spaceAfter),
          line: style.lineSpacing ? pointsToTwips(style.lineSpacing * 12) : undefined,
        },
      };

      // Add indentation if provided
      if (style.indentation) {
        paragraph.indentation = style.indentation;
      }

      const styleConfig: Record<string, unknown> = {
        run,
        paragraph,
      };

      if (style.noSpaceBetweenSame !== undefined) {
        (styleConfig as any).noSpaceBetweenSame = style.noSpaceBetweenSame;
      }

      // Map style IDs to docxmlater style names
      switch (style.id) {
        case "header1":
          config.heading1 = styleConfig;
          break;
        case "header2":
          config.heading2 = {
            ...styleConfig,
            tableOptions: tableShadingSettings?.header2Shading
              ? { shading: tableShadingSettings.header2Shading }
              : undefined,
          };
          break;
        case "header3":
          config.heading3 = styleConfig;
          break;
        case "normal":
          config.normal = {
            ...styleConfig,
            preserveCenterAlignment: true, // Preserve center alignment for captions, etc.
          };
          break;
        case "listParagraph":
          config.listParagraph = styleConfig;
          break;
      }
    }

    return config;
  }

  /**
   * Get all runs from a paragraph including those in revisions
   */
  getAllRunsFromParagraph(para: Paragraph): Run[] {
    const runs: Run[] = [];

    try {
      // Get direct runs
      const directRuns = para.getRuns();
      runs.push(...directRuns);

      // Try to get runs from revisions if available
      const content = para.getContent();
      for (const item of content) {
        if (isRevision(item)) {
          const revisionRuns = item.getRuns();
          runs.push(...revisionRuns);
        }
      }
    } catch (error) {
      log.debug(`Error getting runs from paragraph: ${error}`);
    }

    return runs;
  }
}

export const styleProcessor = new StyleProcessor();
