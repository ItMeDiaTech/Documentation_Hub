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

import { Document, Table, Paragraph, ImageRun, Image, Run, Hyperlink, PreservedElement, NumberingLevel, WORD_NATIVE_BULLETS, pointsToTwips, inchesToTwips } from "docxmlater";
import { logger } from "@/utils/logger";

const log = logger.namespace("TableProcessor");

// ═══════════════════════════════════════════════════════════
// HLP (High Level Process) Table Constants
// ═══════════════════════════════════════════════════════════
const HLP_HEADER_COLOR = 'FFC000';  // Orange header shading
const HLP_HEADER_TEXT = 'high level process';  // Case-insensitive match target
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

  /** Cached HLP table analysis results, populated before applyStyles() overwrites FFC000 shading. */
  private _hlpTableCache: Map<Table, HLPTableAnalysis> | null = null;

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
   * Detect if a cell has visual shading from any source
   *
   * Checks direct cell-level shading (from w:tcPr) to determine if a cell appears shaded:
   * 1. Direct cell shading fill color (non-white, non-auto)
   * 2. Direct cell pattern shading (non-clear, non-nil patterns like pct50, solid, diagStripe)
   *
   * Does NOT check table style inheritance — that was intentionally removed to prevent
   * applyTableUniformity() from incorrectly formatting cells with conditional style shading.
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

    // 2. Check direct cell pattern shading (e.g., pct50, solid, diagStripe)
    // Uses docxmlater's proper API — only detects direct cell shading from w:tcPr,
    // NOT inherited table style conditionals (banded rows, firstCol, etc.)
    const pattern = formatting.shading?.pattern;
    if (pattern && pattern !== "clear" && pattern !== "nil") {
      if (debugContext) {
        log.debug(`  → hasShading=TRUE (pattern: ${pattern})`);
      }
      return { hasShading: true, fill: directFill };
    }

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

        // Skip HLP tables — they have their own formatting in processHLPTables()
        if (this.isHLPTable(table)) {
          log.debug(`[Table ${tableIndex}] Skipping HLP table (handled by processHLPTables)`);
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
              singleCell.setShading({ fill: header2Shading, pattern: "clear", color: "auto" });
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
                // HEADER ROW: ALWAYS apply "Other Table Shading" + bold + center
                // (HLP tables are already skipped above, so no preservation check needed)
                log.debug(`[Table ${tableIndex}] HEADER cell (${rowIndex},${cellIndex}): Applying shading #${otherShading}, bold=true, center=true`);
                cell.setShading({ fill: otherShading, pattern: "clear", color: "auto" });
                cellsRecolored++;

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
                  cell.setShading({ fill: otherShading, pattern: "clear", color: "auto" });
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
            cell.setShading({ fill: "BFBFBF", pattern: "clear", color: "auto" });
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

        // Skip HLP tables — handled by processHLPTables()
        if (this.isHLPTable(table)) continue;

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

        // Skip HLP tables — handled by processHLPTables()
        if (this.isHLPTable(table)) continue;

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
  /**
   * Cache-aware HLP table analysis.
   * If the cache is populated (pre-applyStyles), returns cached results.
   * Otherwise falls back to live analysis (for tests or pre-cache calls).
   */
  analyzeHLPTable(table: Table): HLPTableAnalysis {
    if (this._hlpTableCache) {
      const cached = this._hlpTableCache.get(table);
      if (cached) return cached;
      // Table not in cache = was analyzed and didn't match
      return {
        isHLP: false, variant: null, columnCount: 0, rowCount: 0,
        hasTipsColumn: false, headerText: '', headerCellSpan: 1,
      };
    }
    return this._analyzeHLPTableLive(table);
  }

  /**
   * Populate HLP table cache before applyStyles() overwrites FFC000 shading.
   * Must be called while original document shading is still intact.
   */
  cacheHLPTables(tables: Table[]): void {
    this._hlpTableCache = new Map();
    for (const table of tables) {
      // Don't apply shouldSkipTable() here — HLP tables may have nested content
      // (e.g., SDTs or structured elements) that triggers the nested table check,
      // or may be floating. HLP detection uses dual-check (FFC000 shading + "High
      // Level Process" header text), which is safe to run on any table.
      const analysis = this._analyzeHLPTableLive(table);
      if (analysis.isHLP) {
        this._hlpTableCache.set(table, analysis);
      }
    }
    log.debug(`Cached ${this._hlpTableCache.size} HLP tables for detection`);
  }

  /**
   * Clear the HLP table cache after processing completes.
   */
  clearHLPTableCache(): void {
    this._hlpTableCache = null;
  }

  /**
   * Live HLP table analysis — reads shading directly from the document XML.
   * Used by cacheHLPTables() and as fallback when no cache is populated.
   */
  private _analyzeHLPTableLive(table: Table): HLPTableAnalysis {
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

    const headerText = (firstCell.getText() ?? '').trim();

    // Gate check: Header text must contain "High Level Process" (case-insensitive)
    if (!headerText.toLowerCase().includes(HLP_HEADER_TEXT)) return defaultResult;
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
   * Apply explicit run formatting to HLP header row paragraphs.
   * Sets h2Font/h2Size/bold/center on all runs so the header looks correct
   * regardless of Heading2 style definition.
   */
  private applyHLPHeaderRunFormatting(
    table: Table,
    settings?: TableShadingSettings,
  ): void {
    const h2Font = settings?.heading2FontFamily ?? 'Verdana';
    const h2Size = settings?.heading2FontSize ?? 14;
    const rows = table.getRows();
    if (rows.length === 0) return;

    const headerRow = rows[0];
    for (const cell of headerRow.getCells()) {
      for (const para of cell.getParagraphs()) {
        para.setAlignment('left');
        for (const run of para.getRuns()) {
          run.setFont(h2Font);
          run.setSize(h2Size);
          run.setBold(true);
        }
        this.applyNormalSpacing(para, settings);
      }
    }
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
      cell.setShading({ fill: HLP_HEADER_COLOR, pattern: "clear", color: "auto" });

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
      // Skip single-cell rows (full-width merged) — they aren't tips column rows
      if (cells.length < 2) continue;
      const lastCell = cells[cells.length - 1];
      // Also skip if the last cell spans multiple columns (another merge pattern)
      if (lastCell && lastCell.getColumnSpan() <= 1) {
        lastCell.setShading({ fill: HLP_TIPS_COLOR, pattern: "clear", color: "auto" });
      }
    }
  }

  /**
   * Discover the main numbered-list numId used by HLP content cells.
   * This is the numId shared by all level-0 action items (1., 2., 3., etc.).
   * Sub-items (a., b., c.) use their own separate abstractNums with different numIds.
   *
   * Only returns a numId if the paragraph is at level 0 AND the abstractNum's
   * level 0 has decimal format. This prevents returning a sub-item numId
   * (e.g., lowerLetter at level 0) which would corrupt main item formatting.
   *
   * @returns The numId of the first decimal level-0 paragraph found, or null
   */
  private discoverHLPMainNumId(table: Table, _analysis: HLPTableAnalysis, doc?: Document): number | null {
    const manager = doc?.getNumberingManager();
    const rows = table.getRows();

    // Pass 1: Find a level-0 paragraph whose abstractNum level 0 is decimal (1., 2., 3.)
    for (let ri = 1; ri < rows.length; ri++) {
      const cells = rows[ri].getCells();
      const contentCell = cells[0];
      if (!contentCell) continue;
      for (const p of contentCell.getParagraphs()) {
        const num = p.getNumbering();
        if (!num || !num.numId) continue;

        if (manager) {
          const level = num.level ?? 0;
          if (level !== 0) {
            continue;
          }
          const instance = manager.getInstance(num.numId);
          if (instance) {
            const absId = instance.getAbstractNumId();
            const abstractNum = manager.getAbstractNumbering(absId);
            const level0 = abstractNum?.getLevel(0);
            const format = level0?.getFormat();
            if (format === 'decimal') {
              return num.numId;
            }
            continue;
          }
        }

        // Fallback if no manager available: return first numId found (legacy behavior)
        return num.numId;
      }
    }

    // Pass 2: No level-0 decimal found. This happens when ALL content paragraphs
    // are sub-items (e.g. ilvl=1, lowerLetter a./b./c.) and no main item exists.
    // Find the most common numId among all numbered content paragraphs so we don't
    // trigger the unnecessary fallback list creation path.
    if (manager) {
      const numIdCounts = new Map<number, number>();
      for (let ri = 1; ri < rows.length; ri++) {
        const contentCell = rows[ri].getCells()[0];
        if (!contentCell) continue;
        for (const p of contentCell.getParagraphs()) {
          const num = p.getNumbering();
          if (!num || !num.numId) continue;
          numIdCounts.set(num.numId, (numIdCounts.get(num.numId) ?? 0) + 1);
        }
      }
      if (numIdCounts.size > 0) {
        // Return the most common numId
        let bestNumId = 0;
        let bestCount = 0;
        for (const [numId, count] of numIdCounts) {
          if (count > bestCount) {
            bestNumId = numId;
            bestCount = count;
          }
        }
        log.debug(`discoverHLPMainNumId: no level-0 decimal found, using most common numId=${bestNumId} (${bestCount} occurrences)`);
        return bestNumId;
      }
    }

    return null;
  }

  /**
   * Apply text formatting to HLP table content: font/size from session settings,
   * bold on list items, blue (#0000FF) + underline on hyperlinks.
   *
   * Content column (left / only column):
   * - Level-0 items (all decimal numbered): heading2 font/size, bold, explicit numbering
   * - Sub-items (level 1+): normal font/size, level-based indent
   * - Hyperlinks within level-0: also bold
   *
   * Tips column (right, FFF2CC):
   * - P[0] (label): normal font/size, bold
   * - P[1+] (body): normal font/size
   * - Alignment forced to left
   */
  private applyHLPContentFormatting(
    table: Table,
    analysis: HLPTableAnalysis,
    settings?: TableShadingSettings,
    discoveredNumId?: number | null,
    tipsBulletNumId?: number | null,
    savedNumbering?: Map<Paragraph, { numId: number; level: number; leftIndent?: number }>,
    hasExplicitNumbering?: boolean,
  ): void {
    const normalFont = settings?.normalFontFamily ?? 'Verdana';
    const normalSize = settings?.normalFontSize ?? 12;

    const rows = table.getRows();

    // Use pre-discovered numId if provided, otherwise fall back to internal discovery.
    // Note: this fallback path doesn't have `doc` so it uses legacy behavior (first numId found).
    // The primary call path from processHLPTables() always passes the pre-discovered numId.
    if (discoveredNumId === undefined) {
      discoveredNumId = this.discoverHLPMainNumId(table, analysis);
    }

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const cells = rows[rowIndex].getCells();

      for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const cell = cells[cellIndex];
        const isTipsCell = analysis.hasTipsColumn && cells.length >= 2 && cellIndex === cells.length - 1 && analysis.variant === 'two-column';
        const paras = cell.getParagraphs();

        for (let pIdx = 0; pIdx < paras.length; pIdx++) {
          const para = paras[pIdx];

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
            // Check if this paragraph was originally unnumbered (numId=0).
            // These paragraphs (e.g. "Note:" lines) never had a visible
            // prefix and shouldn't get one.
            const savedEntry = savedNumbering?.get(para);
            // If savedEntry is undefined (possible identity mismatch), fall back to
            // text-based detection for Note-like lines that shouldn't be numbered.
            const isNoteLine = !savedEntry && /^Note:/i.test(para.getText().trim());
            const wasUnnumbered = (savedEntry !== undefined && savedEntry.numId === 0) || isNoteLine;

            // Only assign numbering if the paragraph originally had a visible prefix.
            // Skip blank/empty paragraphs to avoid spurious numbered items.
            const hasText = para.getText().trim().length > 0;
            if (!wasUnnumbered) {
              if (!isTipsCell && discoveredNumId !== null && hasText) {
                para.setNumbering(discoveredNumId, 0);
              } else if (isTipsCell && tipsBulletNumId && hasText) {
                para.setNumbering(tipsBulletNumId, 0);
              }
            }
          }

          // After numbering fixup, determine if this is a level-0 action item.
          // Must also match discoveredNumId to distinguish main items from sub-items,
          // which also use ilvl=0 but in their own separate abstractNums.
          const numberingAfter = para.getNumbering();
          const isMainActionItem = !isTipsCell && !!numberingAfter &&
            numberingAfter.numId === discoveredNumId &&
            (numberingAfter.level === 0 || numberingAfter.level === undefined);

          // All runs use normal font/size. Level-0 items only get bold (not larger size).
          // The 14pt numbered prefix (1., 2.) comes from the abstractNum definition, not from run text.
          // Tips column uses 10pt (matching original document formatting).
          const font = normalFont;
          const size = isTipsCell ? 10 : normalSize;

          // Build set of runs that are direct paragraph children (not inside containers).
          // Runs returned by para.getRuns() that are NOT direct children must be inside
          // a container element (Hyperlink, Revision, etc.).
          const directRuns = new Set<Run>();
          let hasHyperlinkContainer = false;
          for (const item of para.getContent()) {
            if (item instanceof Run) {
              directRuns.add(item);
            } else if (
              item instanceof Hyperlink ||
              (item instanceof PreservedElement && (item as any).getElementType?.() === 'w:hyperlink')
            ) {
              hasHyperlinkContainer = true;
            }
          }

          // Apply font/size to all runs (para.getRuns() includes hyperlink children)
          for (const run of para.getRuns()) {
            const runFmt = run.getFormatting();

            // Track whether this run is a real hyperlink that needs blue+underline restored.
            // Detection uses three methods in priority order:
            // 1. characterStyle === 'Hyperlink' (direct style check)
            // 2. Direct blue color (0000FF or 0563C1) from prior pipeline steps
            // 3. Structural: run is inside a hyperlink container, not a direct paragraph child
            let restoreHyperlink = false;
            if (runFmt.characterStyle === 'Hyperlink') {
              // Clear the style to avoid font/size conflicts, then restore blue+underline after setters.
              run.setCharacterStyle(undefined as unknown as string);
              restoreHyperlink = true;
            } else {
              // Detect runs already processed by standardizeHyperlinkFormatting() (direct blue color)
              const color = runFmt.color?.toUpperCase();
              if (color === '0000FF' || color === '0563C1') {
                restoreHyperlink = true;
              }
              // Structural detection: run is inside a hyperlink container element,
              // not a direct child of the paragraph. This catches hyperlinks whose
              // characterStyle was cleared and color was dropped by earlier pipeline steps.
              else if (hasHyperlinkContainer && !directRuns.has(run)) {
                restoreHyperlink = true;
              }
            }

            run.setFont(font);
            run.setSize(size);

            // Bold: all level-0 action items in content cells (including hyperlinks).
            // Tips column: only P[0] (label) gets bold.
            if (isMainActionItem) {
              run.setBold(true);
            } else if (isTipsCell && pIdx === 0) {
              run.setBold(true);
            }

            // Restore blue color and underline for real hyperlinks after setFont/setSize
            // which can drop existing run properties.
            if (restoreHyperlink) {
              run.setColor('0000FF');
              run.setUnderline('single');
            }
          }

          this.applyNormalSpacing(para, settings);

          // Tips column: ensure left alignment
          if (isTipsCell) {
            para.setAlignment('left');
          }

          // Apply list indentation from session settings for ALL numbered content items.
          // Both main items (level 0) and sub-items (level 1+) need explicit paragraph
          // indentation since applyNormalSpacing can drop <w:ind> from paragraph properties.
          const indentLevels = settings?.listIndentationLevels;
          if (indentLevels) {
            const numbering = para.getNumbering();
            if (numbering && !isTipsCell) {
              const level = numbering.level || 0;
              const indentSetting = indentLevels.find(l => l.level === level);
              if (indentSetting && indentSetting.symbolIndent < indentSetting.textIndent) {
                para.setLeftIndent(inchesToTwips(indentSetting.textIndent));
                para.setFirstLineIndent(-inchesToTwips(indentSetting.textIndent - indentSetting.symbolIndent));
              }
            } else if (isTipsCell && numbering) {
              // Tips cell numbered paragraphs: applyNormalSpacing drops <w:ind>,
              // and their numbering level may have unusual indentation (e.g. left=-360).
              // Apply indent settings so bullet markers remain visible in the cell.
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
   * Convert bullet sub-items in HLP content to lettered sub-items.
   * Scans ALL content cell paragraphs for unique numIds with bullet format at
   * level 0, and converts levels 0–2 to ordered formats:
   *   Level 0: bullet → lowerLetter (a., b., c.)
   *   Level 1: bullet → lowerRoman (i., ii., iii.)
   *   Level 2: bullet → upperLetter (A., B., C.)
   *
   * Also sets indentation on each converted level using session listIndentationLevels
   * with a +1 level offset (sub-item numbering level 0 → UI visual level 1, etc.).
   *
   * @returns Number of abstractNum definitions converted
   */
  private convertHLPBulletsToLettered(
    table: Table,
    doc: Document,
    analysis: HLPTableAnalysis,
    settings?: TableShadingSettings,
    discoveredNumId?: number | null,
  ): number {
    const manager = doc.getNumberingManager();
    if (!manager) return 0;

    // Build set of abstractNums used by the main numbered list — don't convert these.
    // Only protect abstractNums whose level 0 is decimal (the real main list).
    // Pass-2 fallback numIds (most common, possibly bullet) should still be convertible.
    const mainAbsIds = new Set<number>();
    if (discoveredNumId) {
      const mainInstance = manager.getInstance(discoveredNumId);
      if (mainInstance) {
        const mainAbsId = mainInstance.getAbstractNumId();
        const mainAbstractNum = manager.getAbstractNumbering(mainAbsId);
        const mainLevel0Format = mainAbstractNum?.getLevel(0)?.getFormat();
        if (mainLevel0Format === 'decimal') {
          mainAbsIds.add(mainAbsId);
        }
      }
    }

    const indentLevels = settings?.listIndentationLevels;
    const convertedAbsIds = new Set<number>();
    const rows = table.getRows();

    for (let ri = 1; ri < rows.length; ri++) {
      const cells = rows[ri].getCells();
      for (let ci = 0; ci < cells.length; ci++) {
        // Skip tips column
        const isTips = analysis.hasTipsColumn && cells.length >= 2 && ci === cells.length - 1 && analysis.variant === 'two-column';
        if (isTips) continue;

        for (const para of cells[ci].getParagraphs()) {
          const num = para.getNumbering();
          if (!num || !num.numId) continue;

          const paraLevel = num.level ?? 0;
          const instance = manager.getInstance(num.numId);
          if (!instance) continue;
          const absId = instance.getAbstractNumId();
          if (convertedAbsIds.has(absId)) continue;

          // Don't convert the main list's abstractNum
          if (mainAbsIds.has(absId)) continue;

          // Only convert if paragraph is actually at level 0 of this numId.
          // Paragraphs at ilvl >= 1 are sub-items of a parent numbered list —
          // their abstractNum should be left alone.
          if (paraLevel > 0) continue;

          const abstractNum = manager.getAbstractNumbering(absId);
          if (!abstractNum) continue;

          const level0 = abstractNum.getLevel(0);
          const level0Format = level0?.getFormat();
          if (level0 && level0Format === 'bullet') {
            // Level 0: bullet → lowerLetter (a., b., c.)
            level0.setFormat('lowerLetter');
            level0.setText('%1.');
            level0.setFont('Verdana');
            level0.setFontSize(24); // 12pt = 24 half-points
            level0.setColor('000000');
            level0.setBold(false); // Sub-item prefixes must not be bold
            this.patchLevelBoldOff(level0);
            // Sub-item level 0 → UI visual level 1
            if (indentLevels) {
              const indent = indentLevels.find(l => l.level === 1);
              if (indent) {
                level0.setLeftIndent(inchesToTwips(indent.textIndent));
                level0.setHangingIndent(inchesToTwips(indent.textIndent - indent.symbolIndent));
              }
            }

            // Level 1: bullet → lowerRoman (i., ii., iii.)
            const level1 = abstractNum.getLevel(1);
            if (level1 && level1.getFormat() === 'bullet') {
              level1.setFormat('lowerRoman');
              level1.setText('%2.');
              level1.setFont('Verdana');
              level1.setFontSize(24);
              level1.setColor('000000');
              level1.setBold(false); // Sub-item prefixes must not be bold
              this.patchLevelBoldOff(level1);
              // Sub-item level 1 → UI visual level 2
              if (indentLevels) {
                const indent = indentLevels.find(l => l.level === 2);
                if (indent) {
                  level1.setLeftIndent(inchesToTwips(indent.textIndent));
                  level1.setHangingIndent(inchesToTwips(indent.textIndent - indent.symbolIndent));
                }
              }
            }

            // Level 2: bullet → upperLetter (A., B., C.)
            const level2 = abstractNum.getLevel(2);
            if (level2 && level2.getFormat() === 'bullet') {
              level2.setFormat('upperLetter');
              level2.setText('%3.');
              level2.setFont('Verdana');
              level2.setFontSize(24);
              level2.setColor('000000');
              level2.setBold(false); // Sub-item prefixes must not be bold
              this.patchLevelBoldOff(level2);
              // Sub-item level 2 → UI visual level 3
              if (indentLevels) {
                const indent = indentLevels.find(l => l.level === 3);
                if (indent) {
                  level2.setLeftIndent(inchesToTwips(indent.textIndent));
                  level2.setHangingIndent(inchesToTwips(indent.textIndent - indent.symbolIndent));
                }
              }
            }

            convertedAbsIds.add(absId);
            log.debug(`Converted HLP abstractNum ${absId} levels 0-2: bullet -> lowerLetter/lowerRoman/upperLetter`);
          }
        }
      }
    }

    return convertedAbsIds.size;
  }

  /**
   * Monkey-patch a NumberingLevel's toXML() to inject <w:b w:val="0"/>
   * into the level's <w:rPr>. This works around a docxmlater limitation
   * where setBold(false) produces no XML output instead of the explicit
   * <w:b w:val="0"/> needed to prevent bold inheritance from context.
   */
  private patchLevelBoldOff(level: unknown): void {
    const lvl = level as { toXML: () => any };
    const origToXML = lvl.toXML.bind(lvl);
    lvl.toXML = function () {
      const xml = origToXML();
      if (xml && Array.isArray(xml.children)) {
        for (const child of xml.children) {
          if (typeof child === 'object' && child.name === 'w:rPr') {
            if (!Array.isArray(child.children)) child.children = [];
            child.children.push({ name: 'w:b', attributes: { 'w:val': '0' } });
            child.children.push({ name: 'w:bCs', attributes: { 'w:val': '0' } });
            break;
          }
        }
      }
      return xml;
    };
  }

  /**
   * Create a fallback lowerLetter numbered list for HLP tables where all paragraphs
   * have ListParagraph style with inherited (not explicit) numbering. This ensures
   * items retain visible markers (a., b., c.) after ListParagraph→Normal conversion.
   */
  private createHLPFallbackList(doc: Document, settings?: TableShadingSettings): number {
    const manager = doc.getNumberingManager();
    if (!manager) return 0;
    const indentLevels = settings?.listIndentationLevels;

    // Match convertHLPBulletsToLettered format: level 0 = lowerLetter (a., b., c.)
    const indent1 = indentLevels?.find(l => l.level === 1);
    const leftIndent = indent1 ? inchesToTwips(indent1.textIndent) : 720;
    const hangingIndent = indent1 ? inchesToTwips(indent1.textIndent - indent1.symbolIndent) : 360;

    const level0 = new NumberingLevel({
      level: 0,
      format: 'lowerLetter',
      text: '%1.',
      leftIndent,
      hangingIndent,
    });

    const numId = manager.createCustomList([level0], "HLP Fallback");
    if (numId) {
      // Set font/color/bold on the created level
      const instance = manager.getInstance(numId);
      if (instance) {
        const absId = instance.getAbstractNumId();
        const abstractNum = manager.getAbstractNumbering(absId);
        if (abstractNum) {
          const lvl = abstractNum.getLevel(0);
          if (lvl) {
            lvl.setFont('Verdana');
            lvl.setFontSize(24); // 12pt
            lvl.setColor('000000');
            lvl.setBold(false);
            this.patchLevelBoldOff(lvl);
          }
        }
      }
    }
    return numId ?? 0;
  }

  /**
   * Create a bullet list for HLP tips column paragraphs that have inherited
   * ListParagraph numbering (no explicit numPr). Tips cells are skipped by
   * convertHLPBulletsToLettered and excluded from discoveredNumId assignment,
   * so they need their own bullet list to preserve visible bullet markers.
   */
  private createHLPTipsBulletList(doc: Document): number {
    const manager = doc.getNumberingManager();
    if (!manager) return 0;

    const bullet = WORD_NATIVE_BULLETS.FILLED_BULLET;
    const level0 = new NumberingLevel({
      level: 0,
      format: 'bullet',
      text: bullet.char,
      font: bullet.font,
      leftIndent: 360,
      hangingIndent: 360,
    });

    const numId = manager.createCustomList([level0], "HLP Tips Bullet");
    return numId ?? 0;
  }

  /**
   * Insert empty paragraphs before each level-0 numbered item (except the first)
   * in HLP content cells.  This creates a visual blank line separator between
   * top-level items (1., 2., 3., etc.).  Only applies to the content column.
   *
   * @returns Number of blank paragraphs inserted
   */
  private insertHLPBlankLines(table: Table, analysis: HLPTableAnalysis, discoveredNumId: number | null): number {
    let inserted = 0;
    const rows = table.getRows();

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const cells = rows[rowIndex].getCells();

      for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const isTipsCell = analysis.hasTipsColumn && cells.length >= 2 && cellIndex === cells.length - 1 && analysis.variant === 'two-column';
        if (isTipsCell) continue; // Only content column

        const cell = cells[cellIndex];
        let paras = cell.getParagraphs();
        let isFirstLevel0 = true;

        for (let pIdx = 0; pIdx < paras.length; pIdx++) {
          const para = paras[pIdx];
          const numbering = para.getNumbering();

          // Insert blank lines before:
          // 1. Main items (discoveredNumId at level 0) — the 1., 2., 3. items
          // 2. First paragraph of a new numId group at level 0 (content cell only)
          //    — handles cells where sub-item groups also need visual separation
          const isLevel0 = numbering && (numbering.level === 0 || numbering.level === undefined);
          const isMainItem = isLevel0 && numbering.numId === discoveredNumId;
          const isNewGroup = isLevel0 && numbering.numId !== discoveredNumId;

          if (isMainItem || isNewGroup) {
            if (isFirstLevel0 && isMainItem) {
              // Don't insert before the very first main item
              isFirstLevel0 = false;
            } else {
              // Check if the previous paragraph is already blank (no text, no numbering).
              // The original document may already have blank paragraphs between items
              // (converted from ListParagraph to Normal in step 6), so inserting another
              // would create a double blank line.
              const prevPara = paras[pIdx - 1];
              const prevText = prevPara?.getText()?.trim() || '';
              const prevNumbering = prevPara?.getNumbering();
              const prevIsBlank = prevText.length === 0 && !prevNumbering;

              if (pIdx > 0 && !prevIsBlank) {
                // Insert blank paragraph before this level-0 item
                const blankPara = Paragraph.create();
                blankPara.setStyle('Normal');
                cell.addParagraphAt(pIdx, blankPara);
                inserted++;
                pIdx++; // Skip past inserted blank
                paras = cell.getParagraphs(); // Refresh after insertion
              }

              if (isMainItem && isFirstLevel0) {
                isFirstLevel0 = false;
              }
            }
          }
        }
      }
    }

    return inserted;
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
   * HLP tables are detected by FFC000 shading AND "High Level Process" header text.
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
  async processHLPTables(
    doc: Document,
    settings?: TableShadingSettings,
    savedNumbering?: Map<Paragraph, { numId: number; level: number; leftIndent?: number }>,
  ): Promise<HLPTableProcessingResult> {
    const tables = doc.getTables();
    let tablesFound = 0;
    let headersStyled = 0;
    let singleColumnTables = 0;
    let twoColumnTables = 0;

    for (const table of tables) {
      // Don't skip — HLP tables may have nested content or floating positioning
      // but still need processing. The analyzeHLPTable check is sufficient.
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

      // 2.5 Apply explicit run formatting to header row (h2Font/h2Size/bold/center)
      this.applyHLPHeaderRunFormatting(table, settings);

      // 3. Apply header cell formatting (shading, margins, cell borders)
      this.applyHLPHeaderCellFormatting(table, analysis);

      // 4. Apply cell-level borders for data rows (variant-aware)
      this.applyHLPCellBorders(table, analysis);

      // 5. Ensure tips column shading is correct
      this.applyHLPTipsColumnShading(table, analysis);

      // 5.1 Restore original numbering for HLP paragraphs that were corrupted
      // by applyStyles(), list normalization, or other pipeline steps.
      if (savedNumbering) {
        const rows = table.getRows();
        let restored = 0;
        for (let ri = 1; ri < rows.length; ri++) {
          for (const cell of rows[ri].getCells()) {
            for (const para of cell.getParagraphs()) {
              const saved = savedNumbering.get(para);
              if (!saved) continue;

              if (saved.numId === -1) {
                // Sentinel for ListParagraph with no detectable numbering
                // (inherits numbering from style). Leave as-is — step 6
                // (applyHLPContentFormatting) will convert to Normal and
                // assign discoveredNumId.
                continue;
              }

              if (saved.numId === 0) {
                // numId=0 = explicit numbering suppression (e.g. "Note:" paragraphs).
                // Remove any numbering, switch to Normal (prevents ListParagraph default
                // numPr from showing), and restore the pre-processing indentation.
                if (para.getNumbering()) {
                  para.removeNumbering();
                }
                if (para.getStyle() === 'ListParagraph') {
                  para.setStyle('Normal');
                }
                if (saved.leftIndent) {
                  para.setLeftIndent(saved.leftIndent);
                }
                restored++;
                continue;
              }

              // Existing restoration logic for numId > 0
              const current = para.getNumbering();
              const curNumId = current?.numId ?? 0;
              const curLevel = current?.level ?? 0;
              if (curNumId !== saved.numId || curLevel !== saved.level) {
                para.setNumbering(saved.numId, saved.level);
                restored++;
              }
            }
          }
        }
        if (restored > 0) {
          log.debug(`Restored numbering for ${restored} HLP paragraphs in table #${tablesFound}`);
        } else if (savedNumbering.size > 0) {
          log.warn(`savedNumbering had ${savedNumbering.size} entries but 0 paragraphs were restored in table #${tablesFound} — possible identity mismatch`);
        }
      }

      // 5.7 Discover main numId before bullet conversion and content formatting
      let discoveredNumId = this.discoverHLPMainNumId(table, analysis, doc);

      // 5.5 Convert bullet sub-items to lettered (a., b., c.) in content column
      // Runs AFTER discovering main numId so we can skip abstractNums belonging to the main numbered list
      const bulletsConverted = this.convertHLPBulletsToLettered(table, doc, analysis, settings, discoveredNumId);
      if (bulletsConverted > 0) {
        log.debug(`Converted ${bulletsConverted} bullet abstractNums to lowerLetter in HLP table #${tablesFound}`);
      }
      const hasExplicitNumbering = discoveredNumId !== null;

      // 5.8 Fallback: if no explicit numbering found but ListParagraph paragraphs
      // exist (inherited numbering from style default), create a lowerLetter list
      // so items retain visible markers after ListParagraph→Normal conversion.
      if (discoveredNumId === null) {
        const rows = table.getRows();
        let needsFallback = false;
        for (let ri = 1; ri < rows.length && !needsFallback; ri++) {
          const contentCell = rows[ri].getCells()[0];
          if (!contentCell) continue;
          for (const p of contentCell.getParagraphs()) {
            if (p.getStyle() === 'ListParagraph' && p.getText().trim().length > 0) {
              needsFallback = true;
              break;
            }
          }
        }
        if (needsFallback) {
          const fallbackNumId = this.createHLPFallbackList(doc, settings);
          if (fallbackNumId > 0) {
            discoveredNumId = fallbackNumId;
            log.debug(`Created HLP fallback lowerLetter list numId=${discoveredNumId}`);
          }
        }
      }

      // 5.9 Create bullet list for tips column paragraphs that have inherited
      // ListParagraph numbering. Tips cells are skipped by convertHLPBulletsToLettered
      // and excluded from discoveredNumId assignment, so they need their own bullet list.
      let tipsBulletNumId: number | null = null;
      if (analysis.variant === 'two-column' && analysis.hasTipsColumn) {
        tipsBulletNumId = this.createHLPTipsBulletList(doc);
        if (tipsBulletNumId > 0) {
          log.debug(`Created HLP tips bullet list numId=${tipsBulletNumId}`);
        }
      }

      // 6. Apply text formatting (fonts, bold, hyperlink colors, tips alignment)
      this.applyHLPContentFormatting(table, analysis, settings, discoveredNumId, tipsBulletNumId, savedNumbering, hasExplicitNumbering);

      // 6.5 Insert blank paragraphs before level-0 items (2., 3., etc.)
      const blankLinesInserted = this.insertHLPBlankLines(table, analysis, discoveredNumId);
      if (blankLinesInserted > 0) {
        log.debug(`Inserted ${blankLinesInserted} blank lines in HLP table #${tablesFound}`);
      }

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
