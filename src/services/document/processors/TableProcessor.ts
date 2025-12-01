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
              // Check if cell already has shading
              const currentShading = cell.getFormatting().shading?.fill;

              // Skip cells that are white or have no color
              const hasNoColor = !currentShading || currentShading === "FFFFFF";
              const isWhite =
                currentShading?.toLowerCase() === "ffffff" ||
                currentShading?.toLowerCase() === "auto";

              if (!hasNoColor && !isWhite) {
                // Only recolor cells that already have shading
                // This preserves intentionally unstyled cells
                cell.setShading({ fill: otherShading });
                cellsRecolored++;

                // Format cell text
                for (const para of cell.getParagraphs()) {
                  for (const run of para.getRuns()) {
                    run.setFont("Verdana");
                    run.setSize(12);
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
}

export const tableProcessor = new TableProcessor();
