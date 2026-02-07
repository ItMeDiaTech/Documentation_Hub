/**
 * TableProcessor - Table formatting and uniformity operations
 *
 * Handles:
 * - Table uniformity (borders, shading, cell formatting)
 * - Header2 table detection and formatting
 * - 1x1 table special handling
 * - Smart table detection and formatting
 * - Table shading color configuration
 */

import { Document, Table, Paragraph, ImageRun, Image, pointsToTwips, inchesToTwips } from "docxmlater";
import { logger } from "@/utils/logger";

const log = logger.namespace("TableProcessor");

// ═══════════════════════════════════════════════════════════
// HLP (High Level Process) Table Constants
// ═══════════════════════════════════════════════════════════
const HLP_HEADER_COLOR = 'FFC000';  // Orange header shading
const HLP_TIPS_COLOR = 'FFF2CC';    // Light yellow tips column
const HLP_BORDER_SIZE = 18;         // 2.25pt in eighths of a point

/**
 * HLP table layout variant
 */
export type HLPVariant = 'single-column' | 'two-column';

/**
 * Detailed HLP table analysis result
 */
export interface HLPTableAnalysis {
  isHLP: boolean;
  variant: HLPVariant | null;
  columnCount: number;
  rowCount: number;
  hasTipsColumn: boolean;
  headerText: string;
  headerCellSpan: number;
}

/**
 * Result of HLP table processing
 */
export interface HLPTableProcessingResult {
  tablesFound: number;
  headersStyled: number;
  singleColumnTables: number;
  twoColumnTables: number;
}

/**
 * Table shading configuration
 */
export interface TableShadingSettings {
  header2Shading: string; // Hex color for Header 2 / 1x1 table cells
  otherShading: string; // Hex color for other table cells
  preserveBold?: boolean; // If true, preserve original bold formatting in table cells
  heading2FontFamily?: string; // Font family for Heading 2 / 1x1 table cells
  heading2FontSize?: number; // Font size in points for Heading 2 / 1x1 table cells
  // Normal style properties for shaded cells and first row cells
  normalFontFamily?: string; // Font family (default "Verdana")
  normalFontSize?: number; // Font size in points (default 12)
  normalAlignment?: "left" | "center" | "right" | "justify"; // Alignment (default "center")
  preserveCenterAlignment?: boolean; // If true, preserve existing center alignment
  normalSpaceBefore?: number; // Space before in points (default 3)
  normalSpaceAfter?: number; // Space after in points (default 3)
  normalLineSpacing?: number; // Line spacing multiplier (default 1.0)
  // Table cell padding in inches
  padding1x1Top?: number; // default: 0
  padding1x1Bottom?: number; // default: 0
  padding1x1Left?: number; // default: 0.08
  padding1x1Right?: number; // default: 0.08
  paddingOtherTop?: number; // default: 0
  paddingOtherBottom?: number; // default: 0
  paddingOtherLeft?: number; // default: 0.08
  paddingOtherRight?: number; // default: 0.08
  // List indentation levels for HLP table content (from session ListBulletSettings)
  listIndentationLevels?: Array<{
    level: number;
    symbolIndent: number; // inches
    textIndent: number;   // inches
  }>;
}

/**
 * Result of table formatting operation
 */
export interface TableFormattingResult {
  tablesProcessed: number;
  cellsRecolored: number;
  bordersApplied: number;
}

/**
 * Result of Header2 table validation
 */
export interface Header2TableValidationResult {
  count: number;
  tablesFixed: string[];
}

/**
 * Table processing service
 */
export class TableProcessor {
  private readonly DEBUG = process.env.NODE_ENV !== "production";

  /** Colors used by HLP tables — preserved during table uniformity operations. */
  private static readonly HLP_PRESERVED_COLORS = [HLP_HEADER_COLOR, HLP_TIPS_COLOR];

  /**
   * Apply Normal-style spacing settings to a paragraph.
   * Shared by table uniformity (header rows, shaded cells) and HLP content formatting.
   */
  private applyNormalSpacing(
    para: Paragraph,
    settings?: { normalSpaceBefore?: number; normalSpaceAfter?: number; normalLineSpacing?: number }
  ): void {
    if (settings?.normalSpaceBefore !== undefined) {
      para.setSpaceBefore(pointsToTwips(settings.normalSpaceBefore));
    }
    if (settings?.normalSpaceAfter !== undefined) {
      para.setSpaceAfter(pointsToTwips(settings.normalSpaceAfter));
    }
    if (settings?.normalLineSpacing !== undefined) {
      para.setLineSpacing(pointsToTwips(settings.normalLineSpacing * 12));
    }
  }

  /**
   * Recursively search XMLElement tree for w:shd element and extract val attribute
   * This is needed because docxmlater doesn't expose pattern shading for table cells
   *
   * IMPORTANT: Stops recursion at nested tables (w:tbl) to avoid detecting shading
   * from nested table cells as the parent cell's shading.
   *
   * @param element - XMLElement object from cell.toXML()
   * @returns The shading pattern value (e.g., "pct12", "solid") or undefined
   */
  private findShadingPatternInXML(element: unknown): string | undefined {
    if (!element || typeof element !== "object") return undefined;

    const el = element as {
      name?: string;
      attributes?: Record<string, string | number | boolean | undefined>;
      children?: unknown[];
    };

    // STOP recursion at nested tables - don't look inside them
    // This prevents detecting shading from nested table cells as the parent cell's shading
    if (el.name === "w:tbl") {
      return undefined;
    }

    // Check if this element is w:shd
    if (el.name === "w:shd" && el.attributes?.val) {
      return String(el.attributes.val);
    }

    // Search children recursively (but won't enter nested tables now)
    if (Array.isArray(el.children)) {
      for (const child of el.children) {
        if (typeof child === "object") {
          const found = this.findShadingPatternInXML(child);
          if (found) return found;
        }
      }
    }

    return undefined;
  }

  /**
   * Detect if a cell has visual shading from any source
   *
   * Checks multiple sources to determine if a cell appears shaded:
   * 1. Direct cell shading fill color
   * 2. Pattern shading (w:shd val attribute like "pct50", "solid") via raw XML
   * 3. Table style inheritance (cell shading from table style)
   *
   * @returns Object with hasShading boolean and optional fill color
   */
  private getResolvedCellShading(
    cell: ReturnType<ReturnType<Table["getRows"]>[number]["getCells"]>[number],
    table: Table,
    doc: Document,
    debugContext?: { tableIndex?: number; rowIndex?: number; cellIndex?: number }
  ): { hasShading: boolean; fill?: string } {
    const formatting = cell.getFormatting();

    // 1. Check direct cell shading fill
    const directFill = formatting.shading?.fill?.toUpperCase();

    // DEBUG: Log shading detection details
    if (debugContext) {
      log.debug(
        `[Table ${debugContext.tableIndex}] Cell (${debugContext.rowIndex},${debugContext.cellIndex}): ` +
        `shading.fill="${formatting.shading?.fill || 'undefined'}", ` +
        `shading.pattern="${formatting.shading?.pattern || 'undefined'}", ` +
        `directFill="${directFill || 'undefined'}"`
      );
    }

    if (directFill && directFill !== "AUTO" && directFill !== "FFFFFF") {
      if (debugContext) {
        log.debug(`  → hasShading=TRUE (fill: ${directFill})`);
      }
      return { hasShading: true, fill: directFill };
    }

    // 2. Pattern shading detection REMOVED
    // The previous pattern shading check was detecting table style conditional patterns
    // (pct12 for banded rows, etc.) as visual shading, causing uniformity to be applied
    // to cells that had no direct user-applied shading.
    // Now only explicit fill colors trigger uniformity processing.

    // 3. Table style inheritance check REMOVED
    // Previously this checked table style for inherited cell shading, but now that
    // docxmlater properly parses table styles (w:tblStyle), ALL cells with any
    // table style conditional shading (banded rows, firstCol, etc.) were being detected.
    // This caused applyTableUniformity() to center and bold ALL cells incorrectly.
    // Now we only detect cells with DIRECT shading, preserving original table styling.

    // 4. No shading detected
    if (debugContext) {
      log.debug(`  → hasShading=FALSE`);
    }
    return { hasShading: false };
  }

  /**
   * Check if a cell contains ANY image (not just large ones).
   * Images can appear as Image or ImageRun instances in paragraph content.
   *
   * @param cell - The table cell to check
   * @returns True if the cell contains any image
   */
  private cellContainsAnyImage(
    cell: ReturnType<ReturnType<Table["getRows"]>[number]["getCells"]>[number]
  ): boolean {
    for (const para of cell.getParagraphs()) {
      const content = para.getContent();
      for (const item of content) {
        if (item instanceof Image || item instanceof ImageRun) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Count the number of text lines in a cell.
   * Each paragraph counts as 1 line, plus any soft line breaks (\n) within paragraphs.
   *
   * @param cell - The table cell to check
   * @returns Number of text lines in the cell
   */
  private countCellTextLines(
    cell: ReturnType<ReturnType<Table["getRows"]>[number]["getCells"]>[number]
  ): number {
    let lineCount = 0;
    for (const para of cell.getParagraphs()) {
      lineCount += 1;
      const text = para.getText() || "";
      lineCount += (text.match(/\n/g) || []).length;
    }
    return lineCount;
  }

  /**
   * Check if text starts with a typed list prefix (bullet character or number).
   * Used as fallback detection when Word list formatting is not detected.
   *
   * @param text - The text to check
   * @returns True if the text starts with a list prefix
   */
  private hasTypedListPrefix(text: string): boolean {
    if (!text) return false;
    // Bullet characters (including dash variants)
    if (/^[•●○◦▪▫‣⁃\-–—]\s/.test(text)) return true;
    // Numbered: "1.", "1)", "(1)", "a.", "a)", "(a)", "i.", etc.
    if (/^(\d+[\.\):]|\(\d+\)|[a-zA-Z][\.\):]|\([a-zA-Z]\)|[ivxIVX]+[\.\):])/.test(text)) return true;
    return false;
  }

  /**
   * Check if a table cell contains any list items (bullets or numbered lists).
   * Uses multiple detection methods for robustness:
   * 1. Word list formatting via getNumbering() / hasNumbering()
   * 2. Typed list prefixes (bullet characters or numbers in text)
   *
   * @param cell - The table cell to check
   * @returns True if the cell contains any list formatting
   */
  private cellContainsAnyList(
    cell: ReturnType<ReturnType<Table["getRows"]>[number]["getCells"]>[number]
  ): boolean {
    const paragraphs = cell.getParagraphs();
    log.debug(`cellContainsAnyList: checking ${paragraphs.length} paragraphs`);

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const numbering = para.getNumbering();
      const text = para.getText()?.trim() || '';

      // Method 1: Check Word list formatting via getNumbering()
      if (numbering && numbering.numId) {
        log.debug(`  Para ${i}: FOUND LIST via getNumbering() numId=${numbering.numId}, text="${text.substring(0, 40)}..."`);
        return true;
      }

      // Method 2: Check Word list formatting via hasNumbering() (handles edge cases)
      if (typeof para.hasNumbering === 'function' && para.hasNumbering()) {
        log.debug(`  Para ${i}: FOUND LIST via hasNumbering(), text="${text.substring(0, 40)}..."`);
        return true;
      }

      // Method 3: Check for typed list prefixes (fallback)
      if (this.hasTypedListPrefix(text)) {
        log.debug(`  Para ${i}: FOUND LIST via typed prefix, text="${text.substring(0, 40)}..."`);
        return true;
      }
    }

    log.debug(`  -> NO LISTS FOUND in ${paragraphs.length} paragraphs`);
    return false;
  }

  /**
   * Check if a 1x1 table should be excluded from Heading 2 styling and shading.
   * Excluded if the cell has more than 2 lines of text.
   *
   * @param cell - The single cell of a 1x1 table
   * @returns True if the table should be excluded from styling/shading
   */
  private should1x1TableBeExcluded(
    cell: ReturnType<ReturnType<Table["getRows"]>[number]["getCells"]>[number]
  ): boolean {
    const lineCount = this.countCellTextLines(cell);
    if (lineCount > 2) {
      log.debug(`should1x1TableBeExcluded: ${lineCount} lines (>2) -> EXCLUDED`);
      return true;
    }
    log.debug(`should1x1TableBeExcluded: ${lineCount} lines (<=2) -> NOT EXCLUDED`);
    return false;
  }

  /**
   * Apply uniform formatting to all tables in the document
   */
  async applyTableUniformity(
    doc: Document,
    shadingSettings?: TableShadingSettings
  ): Promise<TableFormattingResult> {
    const tables = doc.getTables();
    let tablesProcessed = 0;
    let cellsRecolored = 0;

    const header2Shading = shadingSettings?.header2Shading || "BFBFBF";
    const otherShading = shadingSettings?.otherShading || "DFDFDF";
    const preserveBold = shadingSettings?.preserveBold ?? true; // Default to preserve

    // Normal style properties for shaded cells and first row cells
    // Note: Bold and center alignment are ALWAYS applied to shaded/first row cells (hardcoded)
    // Only font family, font size, and spacing are configurable from Normal style
    const normalFontFamily = shadingSettings?.normalFontFamily ?? "Verdana";
    const normalFontSize = shadingSettings?.normalFontSize ?? 12;

    log.info(`Processing ${tables.length} tables for uniformity`);
    log.debug(`Shading colors: Header2=${header2Shading}, Other=${otherShading}`);
    log.debug(`preserveBold=${preserveBold} (from shadingSettings?.preserveBold=${shadingSettings?.preserveBold})`);

    let tableIndex = 0;
    for (const table of tables) {
      try {
        // Skip floating tables and tables containing nested tables
        if (this.shouldSkipTable(table)) {
          log.debug(`[Table ${tableIndex}] Skipping floating/nested table`);
          tableIndex++;
          continue;
        }

        const rows = table.getRows();
        const rowCount = rows.length;

        if (rowCount === 0) {
          tableIndex++;
          continue;
        }

        // Detect if this is a 1x1 table
        const is1x1Table = rowCount === 1 && rows[0].getCells().length === 1;

        log.debug(`[Table ${tableIndex}] Type: ${is1x1Table ? "1x1" : `${rowCount}x${rows[0].getCells().length}`}`);

        if (is1x1Table) {
          // Apply shading and font formatting to 1x1 tables
          // EXCEPTION: Skip if cell has >2 lines of text
          const singleCell = rows[0].getCells()[0];
          if (singleCell) {
            // Check if this 1x1 table should be excluded from styling
            if (this.should1x1TableBeExcluded(singleCell)) {
              const lineCount = this.countCellTextLines(singleCell);
              log.debug(`[Table ${tableIndex}] 1x1 table: Skipping styling (${lineCount} lines)`);

              tablesProcessed++;
              tableIndex++;
              continue;
            }

            const { hasShading } = this.getResolvedCellShading(singleCell, table, doc, { tableIndex, rowIndex: 0, cellIndex: 0 });

            // Also check if any paragraph has Heading 2 style
            const hasHeading2Style = singleCell.getParagraphs().some(para => {
              const style = para.getStyle();
              return style === "Heading2" || style === "Heading 2";
            });

            // Apply shading if EITHER has existing shading OR has Heading 2 style
            if (hasShading || hasHeading2Style) {
              singleCell.setShading({ fill: header2Shading });
              cellsRecolored++;
            }

            // Format text in 1x1 tables using Heading 2 style configuration
            // Using TableCell convenience methods for cleaner code
            const h2FontFamily = shadingSettings?.heading2FontFamily ?? "Verdana";
            const h2FontSize = shadingSettings?.heading2FontSize ?? 14; // 14pt default for Heading 2
            singleCell.setAllRunsFont(h2FontFamily);
            singleCell.setAllRunsSize(h2FontSize);
          }
        } else {
          // Handle multi-cell tables
          // - First row (header): ALWAYS shade with "Other Table Shading" + bold + center
          // - Data rows WITH existing shading: Apply "Other Table Shading" + bold + center
          // - Data rows WITHOUT shading: Preserve original formatting (don't change bold)
          let rowIndex = 0;
          for (const row of rows) {
            const isFirstRow = rowIndex === 0;
            let cellIndex = 0;

            for (const cell of row.getCells()) {
              // Check if cell has visual shading using resolved detection (direct fill only)
              const { hasShading, fill: existingFill } = this.getResolvedCellShading(cell, table, doc, { tableIndex, rowIndex, cellIndex });

              if (isFirstRow) {
                // Check if header row has special shading that should be preserved (HLP orange/yellow)
                const shouldPreserveShading = hasShading && existingFill && TableProcessor.HLP_PRESERVED_COLORS.includes(existingFill.toUpperCase());

                if (shouldPreserveShading) {
                  log.debug(`[Table ${tableIndex}] HEADER cell (${rowIndex},${cellIndex}): Preserving original shading #${existingFill}`);
                } else {
                  // HEADER ROW: Apply "Other Table Shading" + bold + center
                  log.debug(`[Table ${tableIndex}] HEADER cell (${rowIndex},${cellIndex}): Applying shading #${otherShading}, bold=true, center=true`);
                  cell.setShading({ fill: otherShading });
                  cellsRecolored++;
                }

                for (const para of cell.getParagraphs()) {
                  const isListItem = !!para.getNumbering();
                  for (const run of para.getRuns()) {
                    run.setFont(normalFontFamily);
                    run.setSize(normalFontSize);
                    // Don't force bold on list items - respect preserveBold setting
                    if (!isListItem) {
                      run.setBold(true);
                    }
                  }
                  // Apply alignment (skip list items) - ALWAYS center for header row cells
                  if (!isListItem) {
                    para.setAlignment("center");
                  }
                  this.applyNormalSpacing(para, shadingSettings);
                }
              } else if (hasShading) {
                // DATA ROW WITH SHADING: Apply "Other Table Shading" + bold + center
                // EXCEPTION: Preserve HLP table shading colors (orange/yellow)
                const shouldPreserveShading = existingFill && TableProcessor.HLP_PRESERVED_COLORS.includes(existingFill.toUpperCase());

                if (shouldPreserveShading) {
                  log.debug(`[Table ${tableIndex}] DATA cell (${rowIndex},${cellIndex}): Preserving original shading #${existingFill}`);
                } else {
                  log.debug(`[Table ${tableIndex}] DATA cell WITH shading (${rowIndex},${cellIndex}): Applying shading #${otherShading}, bold=true`);
                  cell.setShading({ fill: otherShading });
                  cellsRecolored++;
                }

                // Apply formatting regardless of shading preservation
                for (const para of cell.getParagraphs()) {
                  const isListItem = !!para.getNumbering();
                  for (const run of para.getRuns()) {
                    run.setFont(normalFontFamily);
                    run.setSize(normalFontSize);
                    // Don't force bold on list items - respect preserveBold setting
                    if (!isListItem) {
                      run.setBold(true);
                    }
                  }
                  // Apply alignment (skip list items) - ALWAYS center for shaded cells
                  if (!isListItem) {
                    para.setAlignment("center");
                  }
                  this.applyNormalSpacing(para, shadingSettings);
                }
              } else {
                // DATA ROW WITHOUT SHADING: Preserve original formatting
                // Don't change bold - preserve original bold state
                log.debug(`[Table ${tableIndex}] DATA cell WITHOUT shading (${rowIndex},${cellIndex}): Preserving formatting (no shading, no bold change)`);
                for (const para of cell.getParagraphs()) {
                  // Skip list items
                  if (!para.getNumbering()) {
                    // Check for images - ImageRun extends Run and contains the actual image
                    const content = para.getContent();
                    const hasImage = content.some(
                      (item) => item instanceof ImageRun || item instanceof Image
                    );
                    if (!hasImage) {
                      for (const run of para.getRuns()) {
                        run.setFont(normalFontFamily);
                        run.setSize(normalFontSize);
                        // Note: NOT setting bold here - preserves original
                      }
                    }
                  }
                }
              }
              cellIndex++;
            }
            rowIndex++;
          }
        }

        tablesProcessed++;
      } catch (error) {
        log.warn(`Failed to process table: ${error}`);
      }
      tableIndex++;
    }

    log.info(
      `Table uniformity complete: ${tablesProcessed} tables, ${cellsRecolored} cells recolored`
    );

    return {
      tablesProcessed,
      cellsRecolored,
      bordersApplied: 0,
    };
  }

  /**
   * Apply smart table formatting based on content detection
   */
  async applySmartTableFormatting(doc: Document): Promise<number> {
    const tables = doc.getTables();
    let formattedCount = 0;

    for (const table of tables) {
      try {
        // Skip floating tables and tables containing nested tables
        if (this.shouldSkipTable(table)) {
          log.debug(`Skipping floating/nested table in smart formatting`);
          continue;
        }

        const rows = table.getRows();
        if (rows.length === 0) continue;

        // Check for header row
        const firstRow = rows[0];
        const firstRowCells = firstRow.getCells();

        // Detect if first row is a header (often has bold text or different shading)
        let isHeaderRow = false;
        for (const cell of firstRowCells) {
          const paras = cell.getParagraphs();
          for (const para of paras) {
            const runs = para.getRuns();
            for (const run of runs) {
              const formatting = run.getFormatting();
              if (formatting?.bold) {
                isHeaderRow = true;
                break;
              }
            }
          }
        }

        // Apply formatting based on detection
        if (isHeaderRow) {
          // Apply header row shading
          for (const cell of firstRowCells) {
            cell.setShading({ fill: "BFBFBF" });
          }
        }

        formattedCount++;
      } catch (error) {
        log.warn(`Failed to apply smart formatting to table: ${error}`);
      }
    }

    return formattedCount;
  }

  /**
   * Validate and fix Header2 styling in tables
   */
  async validateHeader2Tables(
    doc: Document,
    header2Style: {
      fontFamily: string;
      fontSize: number;
      bold: boolean;
      italic: boolean;
      alignment: string;
      spaceBefore: number;
      spaceAfter: number;
      preserveBold?: boolean;
      preserveItalic?: boolean;
      preserveUnderline?: boolean;
    }
  ): Promise<Header2TableValidationResult> {
    const tables = doc.getTables();
    let cellsFixed = 0;
    const affectedCells: string[] = [];

    for (const table of tables) {
      // Skip floating tables and tables containing nested tables
      if (this.shouldSkipTable(table)) {
        log.debug(`Skipping floating/nested table in Header2 validation`);
        continue;
      }

      const rows = table.getRows();

      for (const row of rows) {
        for (const cell of row.getCells()) {
          const paragraphs = cell.getParagraphs();

          for (const para of paragraphs) {
            const currentStyle = para.getStyle();

            if (currentStyle === "Heading2" || currentStyle === "Heading 2") {
              // Validate and fix Header2 formatting in table cell
              const runs = para.getRuns();

              for (const run of runs) {
                const runFormatting = run.getFormatting();
                let needsUpdate = false;

                if (runFormatting.font !== header2Style.fontFamily) {
                  run.setFont(header2Style.fontFamily);
                  needsUpdate = true;
                }

                if (runFormatting.size !== header2Style.fontSize) {
                  run.setSize(header2Style.fontSize);
                  needsUpdate = true;
                }

                if (!header2Style.preserveBold && runFormatting.bold !== header2Style.bold) {
                  run.setBold(header2Style.bold);
                  needsUpdate = true;
                }

                if (!header2Style.preserveItalic && runFormatting.italic !== header2Style.italic) {
                  run.setItalic(header2Style.italic);
                  needsUpdate = true;
                }

                if (needsUpdate) {
                  cellsFixed++;
                  const cellText = para.getText();
                  if (cellText && !affectedCells.includes(cellText)) {
                    affectedCells.push(cellText);
                  }
                }
              }
            }
          }
        }
      }
    }

    if (cellsFixed > 0) {
      log.info(`Fixed Header2 styling in ${cellsFixed} table cells`);
    }

    return {
      count: cellsFixed,
      tablesFixed: affectedCells,
    };
  }

  /**
   * Detect 1x1 tables in the document
   */
  detect1x1Tables(doc: Document): Table[] {
    const tables = doc.getTables();
    return tables.filter((table) => {
      // Skip floating tables and tables containing nested tables
      if (this.shouldSkipTable(table)) return false;
      const rows = table.getRows();
      return rows.length === 1 && rows[0].getCells().length === 1;
    });
  }

  /**
   * Check if a table contains Header2 styled content
   */
  tableHasHeader2Content(table: Table): boolean {
    const rows = table.getRows();

    for (const row of rows) {
      for (const cell of row.getCells()) {
        const paragraphs = cell.getParagraphs();

        for (const para of paragraphs) {
          const style = para.getStyle();
          if (style === "Heading2" || style === "Heading 2") {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Center-align cells containing only numeric content (step numbers like "1", "2", "3")
   * This improves readability in procedural documents with numbered steps
   */
  async centerNumericCells(doc: Document): Promise<number> {
    const tables = doc.getTables();
    let centeredCount = 0;

    for (const table of tables) {
      try {
        // Skip floating tables and tables containing nested tables
        if (this.shouldSkipTable(table)) {
          log.debug(`Skipping floating/nested table in numeric centering`);
          continue;
        }

        const rows = table.getRows();

        // Skip 1x1 tables (usually headers)
        if (rows.length === 1 && rows[0].getCells().length === 1) {
          continue;
        }

        for (const row of rows) {
          for (const cell of row.getCells()) {
            const paragraphs = cell.getParagraphs();

            // Check if cell has only one paragraph with numeric-only content
            if (paragraphs.length === 1) {
              const para = paragraphs[0];
              const text = para.getText()?.trim() || "";

              // Check if text is purely numeric (digits, periods, commas for decimals)
              // Also match common step formats like "1.", "1)", "Step 1", etc.
              if (this.isNumericContent(text)) {
                para.setAlignment("center");
                centeredCount++;
                log.debug(`Centered numeric cell: "${text}"`);
              }
            }
          }
        }
      } catch (error) {
        log.warn(`Failed to process table for numeric centering: ${error}`);
      }
    }

    if (centeredCount > 0) {
      log.info(`Centered ${centeredCount} numeric table cells`);
    }

    return centeredCount;
  }

  /**
   * Check if text content is numeric-only (suitable for centering)
   * Matches: "1", "2", "10", "1.", "1)", "(1)", "Step 1", etc.
   */
  private isNumericContent(text: string): boolean {
    if (!text || text.length === 0) {
      return false;
    }

    // Skip if too long (likely not a step number)
    if (text.length > 10) {
      return false;
    }

    // Pure number: "1", "2", "10", "100"
    if (/^\d+$/.test(text)) {
      return true;
    }

    // Number with period: "1.", "2.", "10."
    if (/^\d+\.$/.test(text)) {
      return true;
    }

    // Number with parenthesis: "1)", "(1)", "(1"
    if (/^\d+\)$/.test(text) || /^\(\d+\)$/.test(text) || /^\(\d+$/.test(text)) {
      return true;
    }

    // Letter step indicators: "a.", "b.", "A.", "B."
    if (/^[a-zA-Z]\.$/.test(text) || /^[a-zA-Z]\)$/.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Remove specified row heights from all tables, allowing rows to auto-size based on content.
   * This fixes inconsistent row appearance when some rows have specified heights.
   *
   * @param doc - The document to process
   * @returns Number of rows with heights removed
   */
  async removeSpecifiedRowHeights(doc: Document): Promise<number> {
    const tables = doc.getTables();
    let rowsFixed = 0;

    for (const table of tables) {
      try {
        // Skip floating tables and tables containing nested tables
        if (this.shouldSkipTable(table)) continue;

        for (const row of table.getRows()) {
          const formatting = row.getFormatting();
          // Remove specified height - let row auto-size
          if (formatting.height !== undefined) {
            row.clearHeight();
            rowsFixed++;
          }
        }
      } catch (error) {
        log.warn(`Failed to remove row height: ${error}`);
      }
    }

    if (rowsFixed > 0) {
      log.info(`Removed specified heights from ${rowsFixed} table rows`);
    }

    return rowsFixed;
  }

  /**
   * Standardize cell margins and enable text wrapping on all table cells.
   * Sets 0" top/bottom margins, 0.08" left/right margins, and enables text wrapping.
   *
   * @param doc - The document to process
   * @returns Number of cells with margins standardized
   */
  async standardizeCellMargins(doc: Document): Promise<number> {
    const MARGIN_LEFT_RIGHT = 115; // 0.08 inches in twips (1440 * 0.08)
    const MARGIN_TOP_BOTTOM = 0; // 0 inches

    const tables = doc.getTables();
    let cellsFixed = 0;

    for (const table of tables) {
      try {
        // Skip floating tables and tables containing nested tables
        if (this.shouldSkipTable(table)) continue;

        for (const row of table.getRows()) {
          for (const cell of row.getCells()) {
            // Set standard margins: 0" top/bottom, 0.08" left/right
            cell.setMargins({
              top: MARGIN_TOP_BOTTOM,
              bottom: MARGIN_TOP_BOTTOM,
              left: MARGIN_LEFT_RIGHT,
              right: MARGIN_LEFT_RIGHT,
            });
            // Enable text wrapping (noWrap=false)
            cell.setNoWrap(false);
            cellsFixed++;
          }
        }
      } catch (error) {
        log.warn(`Failed to standardize cell margins: ${error}`);
      }
    }

    if (cellsFixed > 0) {
      log.info(`Standardized margins for ${cellsFixed} table cells`);
    }

    return cellsFixed;
  }

  /**
   * Apply custom cell padding to all tables based on table type (1x1 vs other).
   * Uses padding values from TableShadingSettings.
   *
   * @param doc - The document to process
   * @param paddingSettings - Padding settings from session configuration
   * @returns Number of cells with padding applied
   */
  async applyTablePadding(
    doc: Document,
    paddingSettings?: TableShadingSettings
  ): Promise<number> {
    // Default padding values in inches
    const padding1x1Top = paddingSettings?.padding1x1Top ?? 0;
    const padding1x1Bottom = paddingSettings?.padding1x1Bottom ?? 0;
    const padding1x1Left = paddingSettings?.padding1x1Left ?? 0.08;
    const padding1x1Right = paddingSettings?.padding1x1Right ?? 0.08;
    const paddingOtherTop = paddingSettings?.paddingOtherTop ?? 0;
    const paddingOtherBottom = paddingSettings?.paddingOtherBottom ?? 0;
    const paddingOtherLeft = paddingSettings?.paddingOtherLeft ?? 0.08;
    const paddingOtherRight = paddingSettings?.paddingOtherRight ?? 0.08;

    const tables = doc.getTables();
    let cellsProcessed = 0;
    let emptyTablesSkipped = 0;

    log.info(`Applying custom table padding to ${tables.length} tables`);
    log.debug(`1x1 Tables: top=${padding1x1Top}", bottom=${padding1x1Bottom}", left=${padding1x1Left}", right=${padding1x1Right}"`);
    log.debug(`Other Tables: top=${paddingOtherTop}", bottom=${paddingOtherBottom}", left=${paddingOtherLeft}", right=${paddingOtherRight}"`);

    for (const table of tables) {
      try {
        // Skip floating tables and tables containing nested tables
        if (this.shouldSkipTable(table)) continue;

        const rows = table.getRows();
        if (rows.length === 0) {
          emptyTablesSkipped++;
          continue;
        }

        // Detect if this is a 1x1 table
        const is1x1Table = rows.length === 1 && rows[0].getCells().length === 1;

        // Select padding values based on table type
        const top = is1x1Table ? padding1x1Top : paddingOtherTop;
        const bottom = is1x1Table ? padding1x1Bottom : paddingOtherBottom;
        const left = is1x1Table ? padding1x1Left : paddingOtherLeft;
        const right = is1x1Table ? padding1x1Right : paddingOtherRight;

        // Convert inches to twips
        const topTwips = inchesToTwips(top);
        const bottomTwips = inchesToTwips(bottom);
        const leftTwips = inchesToTwips(left);
        const rightTwips = inchesToTwips(right);

        for (const row of rows) {
          for (const cell of row.getCells()) {
            cell.setMargins({
              top: topTwips,
              bottom: bottomTwips,
              left: leftTwips,
              right: rightTwips,
            });
            // Enable text wrapping (noWrap=false)
            cell.setNoWrap(false);
            cellsProcessed++;
          }
        }
      } catch (error) {
        log.warn(`Failed to apply padding to table: ${error}`);
      }
    }

    if (cellsProcessed > 0) {
      log.info(`Applied custom padding to ${cellsProcessed} table cells`);
    }
    if (emptyTablesSkipped > 0) {
      log.debug(`Skipped ${emptyTablesSkipped} empty tables during padding application`);
    }

    return cellsProcessed;
  }

  /**
   * Detect tables with "Step" column and set column width to 1 inch.
   *
   * A "Step" column is detected when:
   * - First column header text equals "Step" (case-insensitive, trimmed)
   * - Cells below contain numeric content (step numbers)
   *
   * @param doc - The document to process
   * @returns Number of tables with Step columns adjusted
   */
  async applyStepColumnWidth(doc: Document): Promise<number> {
    const STEP_COLUMN_WIDTH = 1440; // 1 inch in twips
    const tables = doc.getTables();
    let adjustedCount = 0;

    for (const table of tables) {
      try {
        // Skip floating tables and tables containing nested tables
        if (this.shouldSkipTable(table)) continue;

        const rows = table.getRows();
        if (rows.length < 2) continue; // Need header + at least one data row

        // Get first cell of first row (header)
        const headerCell = table.getCell(0, 0);
        if (!headerCell) continue;

        const headerText = headerCell.getText().trim().toLowerCase();

        // Check if header is "Step"
        if (headerText !== "step") continue;

        // Check if header cell is shaded
        const { hasShading } = this.getResolvedCellShading(headerCell, table, doc);
        if (!hasShading) continue;

        // Verify cells below contain numbers
        let hasNumericContent = false;
        for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
          const cell = table.getCell(rowIndex, 0);
          if (!cell) continue;

          const cellText = cell.getText().trim();
          // Check if cell contains a number (possibly with period, e.g., "1." or "1")
          if (/^\d+\.?$/.test(cellText)) {
            hasNumericContent = true;
            break;
          }
        }

        if (!hasNumericContent) continue;

        // Set first column width to 1 inch (grid-level)
        table.setColumnWidth(0, STEP_COLUMN_WIDTH);

        // Also update individual cell widths (tcW) for column 0 in all rows.
        // Word uses tcW to determine the actual rendered column width,
        // overriding tblGrid/gridCol when present. Without this, cells retain
        // their original wider tcW values from the source document.
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const cell = table.getCell(rowIndex, 0);
          if (cell && cell.getColumnSpan() <= 1) {
            cell.setWidthType(STEP_COLUMN_WIDTH, "dxa");
          }
        }

        adjustedCount++;

        log.debug(`Set Step column width to 1 inch for table (grid + cell widths)`);
      } catch (error) {
        log.warn(`Failed to apply Step column width: ${error}`);
      }
    }

    if (adjustedCount > 0) {
      log.info(`Adjusted ${adjustedCount} Step column widths to 1 inch`);
    }

    return adjustedCount;
  }

  /**
   * Ensure all paragraphs in 1x1 tables have Heading 2 style.
   * This should be called after style application to enforce 1x1 table content as headers.
   *
   * @param doc - The document to process
   * @returns Number of paragraphs updated to Heading 2 style
   */
  async ensureHeading2StyleIn1x1Tables(doc: Document): Promise<number> {
    const tables = doc.getTables();
    let paragraphsUpdated = 0;

    for (const table of tables) {
      try {
        // Skip floating tables and tables containing nested tables
        if (this.shouldSkipTable(table)) continue;

        const rows = table.getRows();

        // Only process 1x1 tables
        if (rows.length !== 1 || rows[0].getCells().length !== 1) {
          continue;
        }

        const cell = rows[0].getCells()[0];

        // Skip excluded 1x1 tables (>2 lines of text)
        if (this.should1x1TableBeExcluded(cell)) {
          log.debug(`Skipping Heading 2 style for 1x1 table (>2 lines)`);
          continue;
        }

        const paragraphs = cell.getParagraphs();

        for (const para of paragraphs) {
          const currentStyle = para.getStyle();

          // Set to Heading 2 if not already
          if (currentStyle !== "Heading2" && currentStyle !== "Heading 2") {
            para.setStyle("Heading2");
            paragraphsUpdated++;
            log.debug(`Set 1x1 table paragraph to Heading 2 style`);
          }
        }
      } catch (error) {
        log.warn(`Failed to set Heading 2 style in 1x1 table: ${error}`);
      }
    }

    if (paragraphsUpdated > 0) {
      log.info(`Set ${paragraphsUpdated} paragraphs in 1x1 tables to Heading 2 style`);
    }

    return paragraphsUpdated;
  }

  // ═══════════════════════════════════════════════════════════
  // HLP (High Level Process) Table Detection and Formatting
  // ═══════════════════════════════════════════════════════════

  /**
   * Analyze a table to determine if it is an HLP (High Level Process) table
   * and classify its variant (single-column or two-column with tips).
   *
   * Detection signals:
   * - Gate check: First row, first cell must have FFC000 (orange) shading
   * - Minimum 2 rows (header + at least 1 data row)
   * - Variant determined by column count in data rows
   * - Tips column detected by FFF2CC shading in last cell of data rows
   *
   * @param table - Table to analyze
   * @returns Full analysis including variant, column count, tips detection
   */
  analyzeHLPTable(table: Table): HLPTableAnalysis {
    const defaultResult: HLPTableAnalysis = {
      isHLP: false, variant: null, columnCount: 0, rowCount: 0,
      hasTipsColumn: false, headerText: '', headerCellSpan: 1,
    };

    const rows = table.getRows();
    if (rows.length < 2) return defaultResult; // Need header + at least 1 data row

    const firstRow = rows[0];
    const firstRowCells = firstRow.getCells();
    if (firstRowCells.length === 0) return defaultResult;

    const firstCell = firstRowCells[0];
    const formatting = firstCell.getFormatting();
    const fill = formatting.shading?.fill?.toUpperCase();

    // Gate check: Must have FFC000 header shading
    if (fill !== HLP_HEADER_COLOR) return defaultResult;

    const headerText = firstCell.getText().trim();
    const headerCellSpan = firstCell.getColumnSpan() || 1;

    // Determine column count from data rows (more reliable than header row)
    const dataRow = rows[1];
    const dataRowCells = dataRow.getCells();
    const columnCount = dataRowCells.length;

    // Detect tips column: check if any data row has FFF2CC in the last cell
    let hasTipsColumn = false;
    if (columnCount >= 2) {
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].getCells();
        const lastCell = cells[cells.length - 1];
        if (lastCell) {
          const cellFill = lastCell.getFormatting().shading?.fill?.toUpperCase();
          if (cellFill === HLP_TIPS_COLOR) {
            hasTipsColumn = true;
            break;
          }
        }
      }
    }

    const variant: HLPVariant = columnCount <= 1 ? 'single-column' : 'two-column';

    return {
      isHLP: true,
      variant,
      columnCount,
      rowCount: rows.length,
      hasTipsColumn,
      headerText,
      headerCellSpan,
    };
  }

  /**
   * Detect if a table is an HLP (High Level Process) table.
   * Delegates to analyzeHLPTable() for backward compatibility.
   *
   * @param table - Table to check
   * @returns true if table is an HLP table
   */
  isHLPTable(table: Table): boolean {
    return this.analyzeHLPTable(table).isHLP;
  }

  /**
   * Apply HLP-specific table-level borders, variant-aware.
   *
   * Single-column: Table-level borders on all 4 sides, no inside borders.
   * Two-column: Clear table-level borders (cell-level borders handle it).
   */
  private applyHLPTableBorders(table: Table, analysis: HLPTableAnalysis): void {
    if (analysis.variant === 'single-column') {
      // Option_2 pattern: table-level borders on all 4 sides
      table.setBorders({
        top: { style: 'single', size: HLP_BORDER_SIZE, color: HLP_HEADER_COLOR },
        bottom: { style: 'single', size: HLP_BORDER_SIZE, color: HLP_HEADER_COLOR },
        left: { style: 'single', size: HLP_BORDER_SIZE, color: HLP_HEADER_COLOR },
        right: { style: 'single', size: HLP_BORDER_SIZE, color: HLP_HEADER_COLOR },
        insideH: { style: 'none', size: 0, color: 'auto' },
        insideV: { style: 'none', size: 0, color: 'auto' },
      });
    } else {
      // Option_1 pattern: no table-level borders; cell-level borders handle everything
      table.setBorders({
        top: { style: 'none', size: 0, color: 'auto' },
        bottom: { style: 'none', size: 0, color: 'auto' },
        left: { style: 'none', size: 0, color: 'auto' },
        right: { style: 'none', size: 0, color: 'auto' },
        insideH: { style: 'none', size: 0, color: 'auto' },
        insideV: { style: 'none', size: 0, color: 'auto' },
      });
    }
  }

  /**
   * Apply Heading 2 style to all paragraphs in the HLP header row.
   *
   * @param table - HLP table to format
   * @returns Number of paragraphs styled
   */
  private applyHLPHeaderStyle(table: Table): number {
    const rows = table.getRows();
    if (rows.length === 0) return 0;

    let paragraphsStyled = 0;
    const headerRow = rows[0];

    for (const cell of headerRow.getCells()) {
      for (const para of cell.getParagraphs()) {
        para.setStyle('Heading2');
        paragraphsStyled++;
      }
    }

    return paragraphsStyled;
  }

  /**
   * Apply formatting to the HLP header row cells (shading, margins, cell borders).
   */
  private applyHLPHeaderCellFormatting(table: Table, analysis: HLPTableAnalysis): void {
    const rows = table.getRows();
    if (rows.length === 0) return;

    const headerRow = rows[0];
    for (const cell of headerRow.getCells()) {
      // Ensure FFC000 shading
      cell.setShading({ fill: HLP_HEADER_COLOR });

      // Set cell margins: top=0, bottom=0
      cell.setMargins({ top: 0, bottom: 0, left: 115, right: 115 });

      // For two-column variant, apply cell-level borders on header
      if (analysis.variant === 'two-column') {
        cell.setBorders({
          top: { style: 'single', size: HLP_BORDER_SIZE, color: HLP_HEADER_COLOR },
          left: { style: 'single', size: HLP_BORDER_SIZE, color: HLP_HEADER_COLOR },
          right: { style: 'single', size: HLP_BORDER_SIZE, color: HLP_HEADER_COLOR },
          bottom: { style: 'none', size: 0, color: 'auto' },
        });
      }
    }
  }

  /**
   * Apply HLP-specific cell-level borders for data rows, variant-aware.
   *
   * Single-column: Clear cell-level borders (table borders handle it).
   * Two-column: Left column gets left border, right gets right, last row gets bottom.
   */
  private applyHLPCellBorders(table: Table, analysis: HLPTableAnalysis): void {
    const rows = table.getRows();
    const noBorder = { style: 'none' as const, size: 0, color: 'auto' };

    if (analysis.variant === 'single-column') {
      // Clear any cell-level borders on data rows
      for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
        for (const cell of rows[rowIndex].getCells()) {
          cell.setBorders({ top: noBorder, bottom: noBorder, left: noBorder, right: noBorder });
        }
      }
      return;
    }

    // Two-column variant: cell-level borders for seamless appearance
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const cells = row.getCells();
      const isLastRow = rowIndex === rows.length - 1;
      const orangeBorder = { style: 'single' as const, size: HLP_BORDER_SIZE, color: HLP_HEADER_COLOR };

      for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const cell = cells[cellIndex];
        const isLeftColumn = cellIndex === 0;
        const isRightColumn = cellIndex === cells.length - 1;

        cell.setBorders({
          top: noBorder,
          left: isLeftColumn ? orangeBorder : noBorder,
          right: isRightColumn ? orangeBorder : noBorder,
          bottom: isLastRow ? orangeBorder : noBorder,
        });
      }
    }
  }

  /**
   * Ensure tips column cells have FFF2CC shading in two-column variant.
   */
  private applyHLPTipsColumnShading(table: Table, analysis: HLPTableAnalysis): void {
    if (!analysis.hasTipsColumn || analysis.variant !== 'two-column') return;

    const rows = table.getRows();
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const cells = rows[rowIndex].getCells();
      const lastCell = cells[cells.length - 1];
      if (lastCell) {
        lastCell.setShading({ fill: HLP_TIPS_COLOR });
      }
    }
  }

  /**
   * Apply text formatting to HLP table content: font/size from session settings,
   * bold on list items, blue (#0000FF) + underline on hyperlinks.
   *
   * Content column (left / only column):
   * - P[0] (main action item): heading2 font/size, bold, explicit numbering + level-0 indent
   * - P[1+] (numbered sub-items): normal font/size, level-based indent
   * - Hyperlinks: blue color + single underline
   *
   * Tips column (right, FFF2CC):
   * - P[0] (label): normal font/size, bold
   * - P[1+] (body): normal font/size
   * - Hyperlinks: blue color + single underline
   */
  private applyHLPContentFormatting(
    table: Table,
    analysis: HLPTableAnalysis,
    settings?: TableShadingSettings,
  ): void {
    const normalFont = settings?.normalFontFamily ?? 'Verdana';
    const normalSize = settings?.normalFontSize ?? 12;
    const h2Font = settings?.heading2FontFamily ?? 'Verdana';
    const h2Size = settings?.heading2FontSize ?? 14;

    const rows = table.getRows();

    // Discover the numId used by numbered sub-items in this table.
    // P[0] main items inherit numbering from ListParagraph style (getNumbering() returns null),
    // but sub-items have explicit numbering we can reference.
    let discoveredNumId: number | null = null;
    for (let ri = 1; ri < rows.length && discoveredNumId === null; ri++) {
      const cells = rows[ri].getCells();
      const contentCell = cells[0];
      if (!contentCell) continue;
      for (const p of contentCell.getParagraphs()) {
        const num = p.getNumbering();
        if (num && num.numId) {
          discoveredNumId = num.numId;
          break;
        }
      }
    }

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const cells = rows[rowIndex].getCells();

      for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const cell = cells[cellIndex];
        const isTipsCell = analysis.hasTipsColumn && cellIndex === cells.length - 1 && analysis.variant === 'two-column';
        const paras = cell.getParagraphs();

        for (let pIdx = 0; pIdx < paras.length; pIdx++) {
          const para = paras[pIdx];

          // Determine font/size for this paragraph
          const isMainActionItem = pIdx === 0 && !isTipsCell;
          const font = isMainActionItem ? h2Font : normalFont;
          const size = isMainActionItem ? h2Size : normalSize;

          const numberingBefore = para.getNumbering();
          const paraStyle = para.getStyle();

          // Save indentation before any modifications — docxmlater setters
          // can drop <w:ind> when regenerating <w:pPr>.
          const savedLeftIndent = para.getLeftIndent();

          // Fix ListParagraph paragraphs without numbering: docxmlater's
          // validateNumberingReferences() strips numId=0 on save, causing
          // the ListParagraph style's default numbering (numId=33) to show.
          // Switch these paragraphs to Normal style and preserve indentation.
          if (paraStyle === 'ListParagraph' && !numberingBefore) {
            para.setStyle('Normal');
            if (savedLeftIndent) {
              para.setLeftIndent(savedLeftIndent);
            }
          }

          // For P[0] main action items that were ListParagraph: set explicit numbering
          // so they retain decimal numbering (1. 2. 3.) despite being converted to Normal.
          if (isMainActionItem && paraStyle === 'ListParagraph' && !numberingBefore && discoveredNumId !== null) {
            para.setNumbering(discoveredNumId, 0);
          }

          // Apply font/size to all runs
          for (const run of para.getRuns()) {
            const runFmt = run.getFormatting();

            // Clear Hyperlink character style: HLP main action items (P[0]) have
            // charStyle=Hyperlink with color=auto + underline=none overrides.
            // These are placeholders for future hyperlinks but should render as
            // normal black text. Clearing the charStyle removes the blue/underline
            // inheritance so setFont/setSize/setBold don't cause color bleed.
            if (runFmt.characterStyle === 'Hyperlink') {
              run.setCharacterStyle(undefined as unknown as string);
            }

            run.setFont(font);
            run.setSize(size);

            // Bold: only main action items (P[0] in content cells).
            // Tips column: only P[0] (label) gets bold.
            if (isMainActionItem) {
              run.setBold(true);
            } else if (isTipsCell && pIdx === 0) {
              run.setBold(true);
            }
          }

          this.applyNormalSpacing(para, settings);

          // Apply list indentation from session settings
          const indentLevels = settings?.listIndentationLevels;
          if (indentLevels) {
            const numbering = para.getNumbering();
            if (numbering) {
              const level = numbering.level || 0;
              const indentSetting = indentLevels.find(l => l.level === level);
              if (indentSetting && indentSetting.symbolIndent < indentSetting.textIndent) {
                para.setLeftIndent(inchesToTwips(indentSetting.textIndent));
                para.setFirstLineIndent(-inchesToTwips(indentSetting.textIndent - indentSetting.symbolIndent));
              }
            }
          }

          // Restore indentation for non-numbered paragraphs if it was dropped by setters
          if (!para.getNumbering() && savedLeftIndent && !para.getLeftIndent()) {
            para.setLeftIndent(savedLeftIndent);
          }
        }
      }
    }
  }

  /**
   * Fix paragraphs immediately after an HLP table that would inherit
   * the table's numbering sequence via ListParagraph's default numPr.
   *
   * Without this, a ListParagraph paragraph after a 6-item HLP table
   * shows "7." because it shares the same numId as the table's items.
   */
  private fixPostHLPTableNumbering(doc: Document, table: Table): void {
    const bodyElements = doc.getBodyElements();
    const tableIdx = bodyElements.indexOf(table);
    if (tableIdx < 0 || tableIdx >= bodyElements.length - 1) return;

    // Check the next few body elements after the table
    for (let i = tableIdx + 1; i < bodyElements.length && i <= tableIdx + 3; i++) {
      const element = bodyElements[i];
      // Stop at next table (duck-type check: tables have getRows)
      if (typeof (element as any).getRows === 'function') break;
      // Check if this is a paragraph (duck-type: has getStyle and getRuns)
      if (typeof (element as any).getStyle === 'function' && typeof (element as any).getRuns === 'function') {
        const para = element as Paragraph;
        const style = para.getStyle();
        const numbering = para.getNumbering();
        // ListParagraph with no explicit numbering inherits default numPr
        if (style === 'ListParagraph' && !numbering) {
          para.setStyle('Normal');
          log.debug(`Fixed post-HLP ListParagraph → Normal at body index ${i}`);
        }
        // If we hit a paragraph with actual content, stop looking
        const text = para.getRuns().map((r: any) => r.getText()).join('').trim();
        if (text.length > 0) break;
      }
    }
  }

  /**
   * Process all HLP (High Level Process) tables in the document.
   *
   * HLP tables are detected by FFC000 shading in the first row.
   * Special formatting applied:
   * - Variant-aware borders (table-level for single-column, cell-level for two-column)
   * - Header row: Heading 2 style with FFC000 shading
   * - Content formatting: bold list items, blue hyperlinks, session fonts/sizes
   * - Tips column: FFF2CC shading preserved
   *
   * Note: FFC000 and FFF2CC colors are already preserved by existing
   * preservedColors logic in applyTableUniformity().
   *
   * @param doc - Document to process
   * @param settings - Optional table shading settings for font/size configuration
   * @returns Processing results
   */
  async processHLPTables(doc: Document, settings?: TableShadingSettings): Promise<HLPTableProcessingResult> {
    const tables = doc.getTables();
    let tablesFound = 0;
    let headersStyled = 0;
    let singleColumnTables = 0;
    let twoColumnTables = 0;

    for (const table of tables) {
      // Skip floating tables and tables containing nested tables
      if (this.shouldSkipTable(table)) continue;

      const analysis = this.analyzeHLPTable(table);
      if (!analysis.isHLP) continue;

      tablesFound++;
      log.debug(`Processing HLP table #${tablesFound} (variant: ${analysis.variant}, ` +
        `${analysis.columnCount} cols, ${analysis.rowCount} rows, tips: ${analysis.hasTipsColumn})`);

      if (analysis.variant === 'single-column') singleColumnTables++;
      else twoColumnTables++;

      // 1. Apply table-level borders (variant-aware)
      this.applyHLPTableBorders(table, analysis);

      // 2. Apply Heading 2 style to header row paragraphs
      headersStyled += this.applyHLPHeaderStyle(table);

      // 3. Apply header cell formatting (shading, margins, cell borders)
      this.applyHLPHeaderCellFormatting(table, analysis);

      // 4. Apply cell-level borders for data rows (variant-aware)
      this.applyHLPCellBorders(table, analysis);

      // 5. Ensure tips column shading is correct
      this.applyHLPTipsColumnShading(table, analysis);

      // 6. Apply text formatting (fonts, bold, hyperlink colors)
      this.applyHLPContentFormatting(table, analysis, settings);

      // 7. Fix post-table paragraphs: ListParagraph paragraphs immediately
      // after the HLP table inherit the style's default numId and continue
      // the table's numbering sequence (producing a phantom "7." etc.).
      // Convert them to Normal to break the numbering chain.
      this.fixPostHLPTableNumbering(doc, table);
    }

    if (tablesFound > 0) {
      log.info(`HLP table processing complete: ${tablesFound} tables ` +
        `(${singleColumnTables} single-column, ${twoColumnTables} two-column), ` +
        `${headersStyled} headers styled`);
    }

    return { tablesFound, headersStyled, singleColumnTables, twoColumnTables };
  }

  // ═══════════════════════════════════════════════════════════
  // Floating / Nested Table Guard
  // ═══════════════════════════════════════════════════════════

  /**
   * Returns true if the table should be skipped by the processing pipeline.
   * Floating tables (w:tblpPr) and tables containing nested tables are
   * passed through unmodified to avoid corrupting complex structures.
   *
   * @param table - Table to check
   * @returns true if the table is floating or contains nested tables
   */
  shouldSkipTable(table: Table): boolean {
    // 1. Floating table check — has positioning properties (w:tblpPr)
    if (table.isFloating()) return true;

    // 2. Nested table check — any cell contains a child table
    for (const row of table.getRows()) {
      for (const cell of row.getCells()) {
        if (cell.hasNestedTables()) return true;
      }
    }

    return false;
  }
}

export const tableProcessor = new TableProcessor();
