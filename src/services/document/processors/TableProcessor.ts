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

import { Document, Table, Paragraph, ImageRun, Image, pointsToTwips } from "docxmlater";
import { logger } from "@/utils/logger";

const log = logger.namespace("TableProcessor");

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
    log.info(`[DEBUG] preserveBold=${preserveBold} (from shadingSettings?.preserveBold=${shadingSettings?.preserveBold})`);

    let tableIndex = 0;
    for (const table of tables) {
      try {
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
          // Apply shading to 1x1 tables if they have existing shading OR Heading 2 style
          const singleCell = rows[0].getCells()[0];
          if (singleCell) {
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
              const { hasShading } = this.getResolvedCellShading(cell, table, doc, { tableIndex, rowIndex, cellIndex });

              if (isFirstRow) {
                // HEADER ROW: Always shade with "Other Table Shading" + bold + center
                log.debug(`[Table ${tableIndex}] HEADER cell (${rowIndex},${cellIndex}): Applying shading #${otherShading}, bold=true, center=true`);
                cell.setShading({ fill: otherShading });
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
                  // Apply Normal style spacing from user settings
                  if (shadingSettings?.normalSpaceBefore !== undefined) {
                    para.setSpaceBefore(pointsToTwips(shadingSettings.normalSpaceBefore));
                  }
                  if (shadingSettings?.normalSpaceAfter !== undefined) {
                    para.setSpaceAfter(pointsToTwips(shadingSettings.normalSpaceAfter));
                  }
                  if (shadingSettings?.normalLineSpacing !== undefined) {
                    para.setLineSpacing(pointsToTwips(shadingSettings.normalLineSpacing * 12));
                  }
                }
              } else if (hasShading) {
                // DATA ROW WITH SHADING: Apply "Other Table Shading" + bold + center
                log.debug(`[Table ${tableIndex}] DATA cell WITH shading (${rowIndex},${cellIndex}): Applying shading #${otherShading}, bold=true`);
                cell.setShading({ fill: otherShading });
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
                  // Apply alignment (skip list items) - ALWAYS center for shaded cells
                  if (!isListItem) {
                    para.setAlignment("center");
                  }
                  // Apply Normal style spacing from user settings
                  if (shadingSettings?.normalSpaceBefore !== undefined) {
                    para.setSpaceBefore(pointsToTwips(shadingSettings.normalSpaceBefore));
                  }
                  if (shadingSettings?.normalSpaceAfter !== undefined) {
                    para.setSpaceAfter(pointsToTwips(shadingSettings.normalSpaceAfter));
                  }
                  if (shadingSettings?.normalLineSpacing !== undefined) {
                    para.setLineSpacing(pointsToTwips(shadingSettings.normalLineSpacing * 12));
                  }
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
        const rows = table.getRows();
        if (rows.length < 2) continue; // Need header + at least one data row

        // Get first cell of first row (header)
        const headerCell = table.getCell(0, 0);
        if (!headerCell) continue;

        const headerText = headerCell.getText().trim().toLowerCase();

        // Check if header is "Step"
        if (headerText !== "step") continue;

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

        // Set first column width to 1 inch
        table.setColumnWidth(0, STEP_COLUMN_WIDTH);
        adjustedCount++;

        log.debug(`Set Step column width to 1 inch for table`);
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
        const rows = table.getRows();

        // Only process 1x1 tables
        if (rows.length !== 1 || rows[0].getCells().length !== 1) {
          continue;
        }

        const cell = rows[0].getCells()[0];
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
}

export const tableProcessor = new TableProcessor();
