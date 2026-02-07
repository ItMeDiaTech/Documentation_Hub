/**
 * Blank Line Snapshot - Captures original blank line positions before processing.
 *
 * This module enables the "preserve original if no rule matches" approach.
 * It records blank paragraph positions using content hashes of neighboring
 * elements so positions can be re-located after processing shifts indices.
 */

import { Document, Paragraph, Table, TableCell, Revision } from "docxmlater";
import { isParagraphBlank } from "./paragraphChecks";

/**
 * Hash of an element's key characteristics for matching after processing.
 */
interface ElementHash {
  type: "paragraph" | "table" | "none";
  textPrefix: string;
  style: string;
  hasNumbering: boolean;
}

interface BodyBlankPosition {
  beforeHash: ElementHash;
  afterHash: ElementHash;
}

interface CellBlankPosition {
  /** Identification of the cell by its table's first-cell text + row/col */
  cellId: string;
  paraIndexInCell: number;
  beforeHash: ElementHash;
  afterHash: ElementHash;
}

export interface BlankLineSnapshot {
  bodyBlanks: BodyBlankPosition[];
  cellBlanks: CellBlankPosition[];
}

/**
 * Gets text from a paragraph, falling back to Revision content when
 * getText() returns empty (which happens for revision-wrapped paragraphs
 * in preserve mode).
 */
function getParaText(para: Paragraph): string {
  const text = para.getText() || "";
  if (text) return text;

  // Fallback: extract text from Revision elements (tracked insertions)
  for (const item of para.getContent()) {
    if (item instanceof Revision) {
      const revText = item.getText() || "";
      if (revText) return revText;
    }
  }
  return "";
}

/**
 * Computes a hash of an element for neighbor-matching.
 */
function hashElement(element: any): ElementHash {
  if (!element) {
    return { type: "none", textPrefix: "", style: "", hasNumbering: false };
  }

  if (element instanceof Paragraph) {
    const text = getParaText(element);
    return {
      type: "paragraph",
      textPrefix: text.substring(0, 50),
      style: element.getStyle() || "",
      hasNumbering: !!element.getNumbering(),
    };
  }

  if (element instanceof Table) {
    // Use first cell text as identifier
    let firstCellText = "";
    try {
      const cell = element.getCell(0, 0);
      if (cell) {
        firstCellText = cell
          .getParagraphs()
          .map((p) => p.getText())
          .join(" ")
          .substring(0, 50);
      }
    } catch {
      // Table may not have cells
    }
    return {
      type: "table",
      textPrefix: firstCellText,
      style: "",
      hasNumbering: false,
    };
  }

  return { type: "none", textPrefix: "", style: "", hasNumbering: false };
}

/**
 * Computes a hash for a paragraph within a cell.
 */
function hashParagraph(para: Paragraph | undefined): ElementHash {
  if (!para) {
    return { type: "none", textPrefix: "", style: "", hasNumbering: false };
  }
  const text = getParaText(para);
  return {
    type: "paragraph",
    textPrefix: text.substring(0, 50),
    style: para.getStyle() || "",
    hasNumbering: !!para.getNumbering(),
  };
}

/**
 * Creates a cell identifier string for matching.
 */
function makeCellId(
  tableIndex: number,
  rowIndex: number,
  colIndex: number,
  tableFirstCellText: string
): string {
  return `t${tableIndex}_r${rowIndex}_c${colIndex}_${tableFirstCellText.substring(0, 20)}`;
}

/**
 * Checks if two element hashes match (allowing minor differences).
 */
function hashesMatch(a: ElementHash, b: ElementHash): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "none" && b.type === "none") return true;
  // Match on text prefix and numbering state
  return a.textPrefix === b.textPrefix && a.hasNumbering === b.hasNumbering;
}

/**
 * Captures positions of all blank paragraphs in the document.
 * Must be called BEFORE any processing modifies the document.
 */
export function captureBlankLineSnapshot(doc: Document): BlankLineSnapshot {
  const bodyBlanks: BodyBlankPosition[] = [];
  const cellBlanks: CellBlankPosition[] = [];

  // Capture body-level blanks
  const bodyCount = doc.getBodyElementCount();
  for (let i = 0; i < bodyCount; i++) {
    const element = doc.getBodyElementAt(i);
    if (!(element instanceof Paragraph)) continue;
    if (!isParagraphBlank(element)) continue;

    const prev = i > 0 ? doc.getBodyElementAt(i - 1) : undefined;
    const next =
      i < bodyCount - 1 ? doc.getBodyElementAt(i + 1) : undefined;

    bodyBlanks.push({
      beforeHash: hashElement(prev),
      afterHash: hashElement(next),
    });
  }

  // Capture cell-level blanks
  const tables = doc.getAllTables();
  for (let ti = 0; ti < tables.length; ti++) {
    const table = tables[ti];
    let tableFirstCellText = "";
    try {
      const firstCell = table.getCell(0, 0);
      if (firstCell) {
        tableFirstCellText = firstCell
          .getParagraphs()
          .map((p) => p.getText())
          .join(" ")
          .substring(0, 20);
      }
    } catch {
      // Skip
    }

    const rows = table.getRows();
    for (let ri = 0; ri < rows.length; ri++) {
      const cells = rows[ri].getCells();
      for (let ci = 0; ci < cells.length; ci++) {
        const cell = cells[ci];
        const paras = cell.getParagraphs();
        const cellId = makeCellId(ti, ri, ci, tableFirstCellText);

        for (let pi = 0; pi < paras.length; pi++) {
          if (!isParagraphBlank(paras[pi])) continue;

          cellBlanks.push({
            cellId,
            paraIndexInCell: pi,
            beforeHash: hashParagraph(paras[pi - 1]),
            afterHash: hashParagraph(paras[pi + 1]),
          });
        }
      }
    }
  }

  return { bodyBlanks, cellBlanks };
}

/**
 * Checks if a blank line existed at the given body position in the original document.
 * Uses neighbor hashes to match positions after indices have shifted.
 */
export function wasOriginallyBlankAtBody(
  snapshot: BlankLineSnapshot,
  doc: Document,
  index: number
): boolean {
  const prev = index > 0 ? doc.getBodyElementAt(index - 1) : undefined;
  const next =
    index < doc.getBodyElementCount() - 1
      ? doc.getBodyElementAt(index + 1)
      : undefined;

  const prevHash = hashElement(prev);
  const nextHash = hashElement(next);

  return snapshot.bodyBlanks.some(
    (b) => hashesMatch(b.beforeHash, prevHash) && hashesMatch(b.afterHash, nextHash)
  );
}

/**
 * Checks if a blank line existed at the given cell position in the original document.
 */
export function wasOriginallyBlankInCell(
  snapshot: BlankLineSnapshot,
  cell: TableCell,
  paraIndex: number,
  cellId: string
): boolean {
  const paras = cell.getParagraphs();
  const prevHash = hashParagraph(paras[paraIndex - 1]);
  const nextHash = hashParagraph(paras[paraIndex + 1]);

  return snapshot.cellBlanks.some(
    (b) =>
      b.cellId === cellId &&
      hashesMatch(b.beforeHash, prevHash) &&
      hashesMatch(b.afterHash, nextHash)
  );
}
