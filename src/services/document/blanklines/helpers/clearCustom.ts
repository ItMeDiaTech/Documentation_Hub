/**
 * Clears Structured Document Tags (SDTs) from a document, unwrapping their content.
 * Ported from Document.ts clearCustom(), clearCustomInTable(),
 * unwrapNestedStructuredDocumentTags(), and sanitizeTableRowExceptions().
 *
 * SDTs are wrappers added by tools like Google Docs that can interfere with
 * document processing. This function removes them while preserving content.
 */

import {
  Document,
  Paragraph,
  Table,
  TableCell,
  StructuredDocumentTag,
} from "docxmlater";

// Use any[] for unwrapped body since getBodyElements() may return
// types beyond Paragraph | Table | StructuredDocumentTag (e.g., TableOfContentsElement)
type BodyElement = any;

/**
 * Removes all SDT wrappers from the document, unwrapping their content
 * into the body elements array. Also sanitizes table row exceptions
 * that would otherwise cause formatting leakage outside the SDT context.
 *
 * Ported from Document.ts clearCustom() (lines 15119-15154)
 */
export function clearCustom(doc: Document): void {
  const bodyElements = doc.getBodyElements();
  const unwrappedBody: BodyElement[] = [];

  for (const element of bodyElements) {
    if (element instanceof StructuredDocumentTag) {
      // Unwrap SDT: add its content directly to the body
      const sdtContent = element.getContent();
      for (const item of sdtContent) {
        if (item instanceof Table) {
          // Sanitize tblPrEx from table rows when coming out of SDT
          sanitizeTableRowExceptions(item);
          unwrappedBody.push(item);
        } else if (item instanceof Paragraph) {
          unwrappedBody.push(item);
        } else if (item instanceof StructuredDocumentTag) {
          // Recursively handle nested SDTs
          unwrapNestedSDTs(item, unwrappedBody);
        }
      }
    } else if (element instanceof Table) {
      // Process table: unwrap SDTs inside cells
      clearCustomInTable(element);
      unwrappedBody.push(element);
    } else {
      unwrappedBody.push(element);
    }
  }

  // Replace body elements with unwrapped content
  doc.setBodyElements(unwrappedBody);
}

/**
 * Sanitizes table property exceptions from all rows in a table.
 * Clears tblPrEx (row-level table property overrides) to prevent formatting
 * from leaking when tables are relocated outside SDT context.
 *
 * Ported from Document.ts sanitizeTableRowExceptions() (lines 15169-15182)
 */
function sanitizeTableRowExceptions(table: Table): void {
  const rows = table.getRows();

  for (const row of rows) {
    const exceptions = row.getTablePropertyExceptions();

    if (exceptions && Object.keys(exceptions).length > 0) {
      row.setTablePropertyExceptions(undefined as any);
    }
  }
}

/**
 * Recursively unwraps nested SDTs, adding their content to the target array.
 *
 * Ported from Document.ts unwrapNestedStructuredDocumentTags() (lines 15188-15202)
 */
function unwrapNestedSDTs(
  sdt: StructuredDocumentTag,
  targetArray: BodyElement[]
): void {
  const content = sdt.getContent();

  for (const item of content) {
    if (item instanceof Paragraph || item instanceof Table) {
      targetArray.push(item);
    } else if (item instanceof StructuredDocumentTag) {
      unwrapNestedSDTs(item, targetArray);
    }
  }
}

/**
 * Processes a table's cells to clear SDTs inside them.
 *
 * Ported from Document.ts clearCustomInTable() (lines 15209-15233)
 * Note: The original implementation's inner loop body was empty.
 */
function clearCustomInTable(table: Table): void {
  const rows = table.getRows();

  for (const row of rows) {
    const cells = row.getCells();

    for (const cell of cells) {
      if (!(cell instanceof TableCell)) {
        continue;
      }
      // Original implementation iterates cell paragraphs but doesn't modify them.
      // Nested tables in cells are handled separately via getAllTables().
    }
  }
}
