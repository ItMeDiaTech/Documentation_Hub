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

import { Document, Table, Paragraph } from "docxmlater";
import { logger } from "@/utils/logger";

const log = logger.namespace("TableProcessor");

/**
 * Table shading configuration
 */
export interface TableShadingSettings {
  header2Shading: string; // Hex color for Header 2 / 1x1 table cells
  otherShading: string; // Hex color for other table cells
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

    // Check if this element is w:shd
    if (el.name === "w:shd" && el.attributes?.val) {
      return String(el.attributes.val);
    }

    // Search children recursively
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
    doc: Document
  ): { hasShading: boolean; fill?: string } {
    const formatting = cell.getFormatting();

    // 1. Check direct cell shading fill
    const directFill = formatting.shading?.fill?.toUpperCase();
    if (directFill && directFill !== "AUTO" && directFill !== "FFFFFF") {
      return { hasShading: true, fill: directFill };
    }

    // 2. Check pattern shading via raw XML (docxmlater doesn't expose pattern for cells)
    // Pattern shading indicates visual shading even if fill is white/undefined
    try {
      const xmlElement = cell.toXML();
      const pattern = this.findShadingPatternInXML(xmlElement);
      if (pattern && pattern !== "clear") {
        return { hasShading: true, fill: directFill };
      }
    } catch (error) {
      log.debug(`Failed to access cell XML for pattern shading: ${error}`);
    }

    // 3. Check table style for inherited cell shading
    const tableStyleId = table.getFormatting().style;
    if (tableStyleId) {
      try {
        const stylesManager = doc.getStylesManager();
        const chain = stylesManager.getInheritanceChain(tableStyleId);

        for (const style of chain) {
          const styleProps = style.getProperties();
          // Check for table style cell formatting
          const tableStyleProps = (styleProps as { tableStyle?: { cell?: { shading?: { fill?: string } } } }).tableStyle;
          const inheritedFill = tableStyleProps?.cell?.shading?.fill;
          if (inheritedFill && inheritedFill.toUpperCase() !== "AUTO" && inheritedFill.toUpperCase() !== "FFFFFF") {
            return { hasShading: true, fill: inheritedFill.toUpperCase() };
          }
        }
      } catch (error) {
        log.debug(`Could not resolve table style inheritance: ${error}`);
      }
    }

    // 4. No shading detected
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

    log.info(`Processing ${tables.length} tables for uniformity`);
    log.debug(`Shading colors: Header2=${header2Shading}, Other=${otherShading}`);

    for (const table of tables) {
      try {
        const rows = table.getRows();
        const rowCount = rows.length;

        if (rowCount === 0) continue;

        // Detect if this is a 1x1 table
        const is1x1Table = rowCount === 1 && rows[0].getCells().length === 1;

        if (is1x1Table) {
          // Apply Header2 shading to 1x1 tables
          const singleCell = rows[0].getCells()[0];
          if (singleCell) {
            singleCell.setShading({ fill: header2Shading });
            cellsRecolored++;

            // Also format text in the cell
            for (const para of singleCell.getParagraphs()) {
              for (const run of para.getRuns()) {
                run.setFont("Verdana");
                run.setSize(12);
              }
            }
          }
        } else {
          // Apply other shading to regular table cells
          for (const row of rows) {
            for (const cell of row.getCells()) {
              // Check if cell has visual shading using resolved detection
              // This checks direct fill, pattern shading, and table style inheritance
              const { hasShading } = this.getResolvedCellShading(cell, table, doc);

              if (hasShading) {
                // Only recolor cells that already have visual shading
                // This preserves intentionally unstyled cells
                cell.setShading({ fill: otherShading });
                cellsRecolored++;

                // Format cell text - center and bold all shaded cells
                for (const para of cell.getParagraphs()) {
                  // Center and bold all shaded cells
                  para.setAlignment('center');

                  for (const run of para.getRuns()) {
                    run.setFont("Verdana");
                    run.setSize(12);
                    run.setBold(true);
                  }
                }
              } else {
                // Cells without shading - just format text
                for (const para of cell.getParagraphs()) {
                  // Skip list items
                  if (!para.getNumbering()) {
                    // Check for images
                    const content = para.getContent();
                    const hasImage = content.some(
                      (item) => item.constructor.name === "Image"
                    );
                    if (!hasImage) {
                      for (const run of para.getRuns()) {
                        run.setFont("Verdana");
                        run.setSize(12);
                      }
                    }
                  }
                }
              }
            }
          }
        }

        tablesProcessed++;
      } catch (error) {
        log.warn(`Failed to process table: ${error}`);
      }
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
}

export const tableProcessor = new TableProcessor();
