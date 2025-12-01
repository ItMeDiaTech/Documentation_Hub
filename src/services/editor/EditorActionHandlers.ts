/**
 * EditorActionHandlers - Service for handling editor quick actions
 *
 * Provides implementations for all quick actions that manipulate documents
 * using docxmlater APIs.
 *
 * Categories:
 * - Text formatting (bold, italic, underline, etc.)
 * - Paragraph styles (headings, normal, list paragraph)
 * - Table operations (rows, columns, merge, split, shading)
 * - Hyperlinks (insert, remove)
 * - Tracked changes (accept all, reject all)
 * - Structure (page break)
 */

import type { Document, Paragraph, Table, Run } from 'docxmlater';
import type { QuickActionId, EditorSelection, CellSelection } from '@/types/editor';

/**
 * Result of an editor action
 */
export interface ActionResult {
  success: boolean;
  error?: string;
  description: string;
}

/**
 * Context for editor actions
 */
export interface ActionContext {
  document: Document;
  selection: EditorSelection | null;
  tableSelection: CellSelection | null;
  selectedTableIndex: number | null;
  tableShadingSettings?: {
    header2Shading: string;
    otherShading: string;
  };
}

/**
 * Handler function type
 */
type ActionHandler = (context: ActionContext) => Promise<ActionResult>;

/**
 * Helper to get paragraph from document by index
 */
function getParagraphAtIndex(doc: Document, index: number): Paragraph | null {
  const elements = doc.getBodyElements();
  const element = elements[index];
  if (element && (element as any).type === 'paragraph') {
    return element as Paragraph;
  }
  return null;
}

/**
 * Helper to get table from document by index
 */
function getTableAtIndex(doc: Document, index: number): Table | null {
  const elements = doc.getBodyElements();
  const element = elements[index];
  if (element && (element as any).type === 'table') {
    return element as Table;
  }
  return null;
}

/**
 * Map of action handlers by action ID
 */
const actionHandlers: Partial<Record<QuickActionId, ActionHandler>> = {
  // Text Formatting
  bold: async (ctx) => {
    if (!ctx.selection) {
      return { success: false, error: 'No text selected', description: 'Toggle bold' };
    }

    try {
      const paragraph = getParagraphAtIndex(ctx.document, ctx.selection.paragraphIndex);
      if (!paragraph) {
        return { success: false, error: 'Paragraph not found', description: 'Toggle bold' };
      }

      const runs = paragraph.getRuns();

      // Toggle bold on selected runs
      for (
        let i = ctx.selection.runStartIndex;
        i <= ctx.selection.runEndIndex && i < runs.length;
        i++
      ) {
        const run = runs[i];
        const formatting = run.getFormatting();
        const currentBold = formatting.bold || false;
        run.setBold(!currentBold);
      }

      return { success: true, description: 'Toggle bold formatting' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle bold',
        description: 'Toggle bold',
      };
    }
  },

  italic: async (ctx) => {
    if (!ctx.selection) {
      return { success: false, error: 'No text selected', description: 'Toggle italic' };
    }

    try {
      const paragraph = getParagraphAtIndex(ctx.document, ctx.selection.paragraphIndex);
      if (!paragraph) {
        return { success: false, error: 'Paragraph not found', description: 'Toggle italic' };
      }

      const runs = paragraph.getRuns();

      for (
        let i = ctx.selection.runStartIndex;
        i <= ctx.selection.runEndIndex && i < runs.length;
        i++
      ) {
        const run = runs[i];
        const formatting = run.getFormatting();
        const currentItalic = formatting.italic || false;
        run.setItalic(!currentItalic);
      }

      return { success: true, description: 'Toggle italic formatting' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle italic',
        description: 'Toggle italic',
      };
    }
  },

  underline: async (ctx) => {
    if (!ctx.selection) {
      return { success: false, error: 'No text selected', description: 'Toggle underline' };
    }

    try {
      const paragraph = getParagraphAtIndex(ctx.document, ctx.selection.paragraphIndex);
      if (!paragraph) {
        return { success: false, error: 'Paragraph not found', description: 'Toggle underline' };
      }

      const runs = paragraph.getRuns();

      for (
        let i = ctx.selection.runStartIndex;
        i <= ctx.selection.runEndIndex && i < runs.length;
        i++
      ) {
        const run = runs[i];
        const formatting = run.getFormatting();
        const currentUnderline = formatting.underline;
        run.setUnderline(currentUnderline ? undefined : 'single');
      }

      return { success: true, description: 'Toggle underline formatting' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle underline',
        description: 'Toggle underline',
      };
    }
  },

  'clear-formatting': async (ctx) => {
    if (!ctx.selection) {
      return {
        success: false,
        error: 'No text selected',
        description: 'Clear formatting',
      };
    }

    try {
      const paragraph = getParagraphAtIndex(ctx.document, ctx.selection.paragraphIndex);
      if (!paragraph) {
        return { success: false, error: 'Paragraph not found', description: 'Clear formatting' };
      }

      const runs = paragraph.getRuns();

      for (
        let i = ctx.selection.runStartIndex;
        i <= ctx.selection.runEndIndex && i < runs.length;
        i++
      ) {
        const run = runs[i];
        run.setBold(false);
        run.setItalic(false);
        run.setUnderline(undefined);
        run.setStrike(false);
        // Color and highlight would need their own clear methods if available
      }

      return { success: true, description: 'Clear all formatting from selection' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear formatting',
        description: 'Clear formatting',
      };
    }
  },

  // Paragraph Styles
  'style-heading1': async (ctx) => {
    if (!ctx.selection) {
      return { success: false, error: 'No paragraph selected', description: 'Apply Heading 1' };
    }

    try {
      const paragraph = getParagraphAtIndex(ctx.document, ctx.selection.paragraphIndex);
      if (!paragraph) {
        return { success: false, error: 'Paragraph not found', description: 'Apply Heading 1' };
      }

      paragraph.setStyle('Heading1');
      return { success: true, description: 'Apply Heading 1 style' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply style',
        description: 'Apply Heading 1',
      };
    }
  },

  'style-heading2': async (ctx) => {
    if (!ctx.selection) {
      return { success: false, error: 'No paragraph selected', description: 'Apply Heading 2' };
    }

    try {
      const paragraph = getParagraphAtIndex(ctx.document, ctx.selection.paragraphIndex);
      if (!paragraph) {
        return { success: false, error: 'Paragraph not found', description: 'Apply Heading 2' };
      }

      paragraph.setStyle('Heading2');
      return { success: true, description: 'Apply Heading 2 style' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply style',
        description: 'Apply Heading 2',
      };
    }
  },

  'style-normal': async (ctx) => {
    if (!ctx.selection) {
      return { success: false, error: 'No paragraph selected', description: 'Apply Normal' };
    }

    try {
      const paragraph = getParagraphAtIndex(ctx.document, ctx.selection.paragraphIndex);
      if (!paragraph) {
        return { success: false, error: 'Paragraph not found', description: 'Apply Normal' };
      }

      paragraph.setStyle('Normal');
      return { success: true, description: 'Apply Normal style' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply style',
        description: 'Apply Normal',
      };
    }
  },

  'style-list-paragraph': async (ctx) => {
    if (!ctx.selection) {
      return {
        success: false,
        error: 'No paragraph selected',
        description: 'Apply List Paragraph',
      };
    }

    try {
      const paragraph = getParagraphAtIndex(ctx.document, ctx.selection.paragraphIndex);
      if (!paragraph) {
        return { success: false, error: 'Paragraph not found', description: 'Apply List Paragraph' };
      }

      paragraph.setStyle('ListParagraph');
      return { success: true, description: 'Apply List Paragraph style' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply style',
        description: 'Apply List Paragraph',
      };
    }
  },

  // Table Shading
  'apply-h2-shading': async (ctx) => {
    if (!ctx.tableSelection || ctx.selectedTableIndex === null) {
      return { success: false, error: 'No table cells selected', description: 'Apply H2 shading' };
    }

    if (!ctx.tableShadingSettings) {
      return { success: false, error: 'No shading settings', description: 'Apply H2 shading' };
    }

    try {
      const table = getTableAtIndex(ctx.document, ctx.selectedTableIndex);
      if (!table) {
        return { success: false, error: 'Table not found', description: 'Apply H2 shading' };
      }

      const rows = table.getRows();
      const { startRow, endRow, startCol, endCol } = ctx.tableSelection;

      const minRow = Math.min(startRow, endRow);
      const maxRow = Math.max(startRow, endRow);
      const minCol = Math.min(startCol, endCol);
      const maxCol = Math.max(startCol, endCol);

      for (let r = minRow; r <= maxRow && r < rows.length; r++) {
        const cells = rows[r].getCells();
        for (let c = minCol; c <= maxCol && c < cells.length; c++) {
          cells[c].setShading({ fill: ctx.tableShadingSettings.header2Shading });
        }
      }

      return { success: true, description: 'Apply Header 2 shading' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply shading',
        description: 'Apply H2 shading',
      };
    }
  },

  'apply-other-shading': async (ctx) => {
    if (!ctx.tableSelection || ctx.selectedTableIndex === null) {
      return {
        success: false,
        error: 'No table cells selected',
        description: 'Apply other shading',
      };
    }

    if (!ctx.tableShadingSettings) {
      return { success: false, error: 'No shading settings', description: 'Apply other shading' };
    }

    try {
      const table = getTableAtIndex(ctx.document, ctx.selectedTableIndex);
      if (!table) {
        return { success: false, error: 'Table not found', description: 'Apply other shading' };
      }

      const rows = table.getRows();
      const { startRow, endRow, startCol, endCol } = ctx.tableSelection;

      const minRow = Math.min(startRow, endRow);
      const maxRow = Math.max(startRow, endRow);
      const minCol = Math.min(startCol, endCol);
      const maxCol = Math.max(startCol, endCol);

      for (let r = minRow; r <= maxRow && r < rows.length; r++) {
        const cells = rows[r].getCells();
        for (let c = minCol; c <= maxCol && c < cells.length; c++) {
          cells[c].setShading({ fill: ctx.tableShadingSettings.otherShading });
        }
      }

      return { success: true, description: 'Apply other shading' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply shading',
        description: 'Apply other shading',
      };
    }
  },

  // Table Row Operations
  'table-add-row-above': async (ctx) => {
    if (!ctx.tableSelection || ctx.selectedTableIndex === null) {
      return { success: false, error: 'No table selected', description: 'Insert row above' };
    }

    try {
      const table = getTableAtIndex(ctx.document, ctx.selectedTableIndex);
      if (!table) {
        return { success: false, error: 'Table not found', description: 'Insert row above' };
      }

      const targetRow = Math.min(ctx.tableSelection.startRow, ctx.tableSelection.endRow);
      table.insertRow(targetRow);

      return { success: true, description: 'Insert row above selection' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to insert row',
        description: 'Insert row above',
      };
    }
  },

  'table-add-row-below': async (ctx) => {
    if (!ctx.tableSelection || ctx.selectedTableIndex === null) {
      return { success: false, error: 'No table selected', description: 'Insert row below' };
    }

    try {
      const table = getTableAtIndex(ctx.document, ctx.selectedTableIndex);
      if (!table) {
        return { success: false, error: 'Table not found', description: 'Insert row below' };
      }

      const targetRow = Math.max(ctx.tableSelection.startRow, ctx.tableSelection.endRow) + 1;
      table.insertRow(targetRow);

      return { success: true, description: 'Insert row below selection' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to insert row',
        description: 'Insert row below',
      };
    }
  },

  'table-delete-row': async (ctx) => {
    if (!ctx.tableSelection || ctx.selectedTableIndex === null) {
      return { success: false, error: 'No table selected', description: 'Delete row' };
    }

    try {
      const table = getTableAtIndex(ctx.document, ctx.selectedTableIndex);
      if (!table) {
        return { success: false, error: 'Table not found', description: 'Delete row' };
      }

      const rows = table.getRows();
      if (rows.length <= 1) {
        return { success: false, error: 'Cannot delete last row', description: 'Delete row' };
      }

      const minRow = Math.min(ctx.tableSelection.startRow, ctx.tableSelection.endRow);
      const maxRow = Math.max(ctx.tableSelection.startRow, ctx.tableSelection.endRow);

      // Delete rows from bottom to top to maintain indices
      for (let r = maxRow; r >= minRow; r--) {
        table.removeRow(r);
      }

      return { success: true, description: 'Delete selected rows' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete row',
        description: 'Delete row',
      };
    }
  },

  // Table Column Operations
  'table-add-col-left': async (ctx) => {
    if (!ctx.tableSelection || ctx.selectedTableIndex === null) {
      return { success: false, error: 'No table selected', description: 'Insert column left' };
    }

    try {
      const table = getTableAtIndex(ctx.document, ctx.selectedTableIndex);
      if (!table) {
        return { success: false, error: 'Table not found', description: 'Insert column left' };
      }

      const targetCol = Math.min(ctx.tableSelection.startCol, ctx.tableSelection.endCol);
      table.addColumn(targetCol);

      return { success: true, description: 'Insert column to the left' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to insert column',
        description: 'Insert column left',
      };
    }
  },

  'table-add-col-right': async (ctx) => {
    if (!ctx.tableSelection || ctx.selectedTableIndex === null) {
      return { success: false, error: 'No table selected', description: 'Insert column right' };
    }

    try {
      const table = getTableAtIndex(ctx.document, ctx.selectedTableIndex);
      if (!table) {
        return { success: false, error: 'Table not found', description: 'Insert column right' };
      }

      const targetCol = Math.max(ctx.tableSelection.startCol, ctx.tableSelection.endCol) + 1;
      table.addColumn(targetCol);

      return { success: true, description: 'Insert column to the right' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to insert column',
        description: 'Insert column right',
      };
    }
  },

  'table-delete-col': async (ctx) => {
    if (!ctx.tableSelection || ctx.selectedTableIndex === null) {
      return { success: false, error: 'No table selected', description: 'Delete column' };
    }

    try {
      const table = getTableAtIndex(ctx.document, ctx.selectedTableIndex);
      if (!table) {
        return { success: false, error: 'Table not found', description: 'Delete column' };
      }

      const rows = table.getRows();
      if (rows.length > 0 && rows[0].getCells().length <= 1) {
        return { success: false, error: 'Cannot delete last column', description: 'Delete column' };
      }

      const minCol = Math.min(ctx.tableSelection.startCol, ctx.tableSelection.endCol);
      const maxCol = Math.max(ctx.tableSelection.startCol, ctx.tableSelection.endCol);

      // Delete columns from right to left to maintain indices
      for (let c = maxCol; c >= minCol; c--) {
        table.removeColumn(c);
      }

      return { success: true, description: 'Delete selected columns' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete column',
        description: 'Delete column',
      };
    }
  },

  // Cell Operations
  'table-merge-cells': async (ctx) => {
    if (!ctx.tableSelection || ctx.selectedTableIndex === null) {
      return { success: false, error: 'No cells selected', description: 'Merge cells' };
    }

    try {
      const table = getTableAtIndex(ctx.document, ctx.selectedTableIndex);
      if (!table) {
        return { success: false, error: 'Table not found', description: 'Merge cells' };
      }

      const { startRow, endRow, startCol, endCol } = ctx.tableSelection;

      table.mergeCells(
        Math.min(startRow, endRow),
        Math.min(startCol, endCol),
        Math.max(startRow, endRow),
        Math.max(startCol, endCol)
      );

      return { success: true, description: 'Merge selected cells' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to merge cells',
        description: 'Merge cells',
      };
    }
  },

  'table-split-cell': async (_ctx) => {
    // Note: docxmlater may not have a direct split cell API
    return {
      success: false,
      error: 'Split cell not yet implemented',
      description: 'Split cell',
    };
  },

  'table-vertical-align': async (ctx) => {
    if (!ctx.tableSelection || ctx.selectedTableIndex === null) {
      return { success: false, error: 'No cells selected', description: 'Set vertical alignment' };
    }

    try {
      const table = getTableAtIndex(ctx.document, ctx.selectedTableIndex);
      if (!table) {
        return { success: false, error: 'Table not found', description: 'Set vertical alignment' };
      }

      const rows = table.getRows();
      const { startRow, endRow, startCol, endCol } = ctx.tableSelection;

      const minRow = Math.min(startRow, endRow);
      const maxRow = Math.max(startRow, endRow);
      const minCol = Math.min(startCol, endCol);
      const maxCol = Math.max(startCol, endCol);

      for (let r = minRow; r <= maxRow && r < rows.length; r++) {
        const cells = rows[r].getCells();
        for (let c = minCol; c <= maxCol && c < cells.length; c++) {
          cells[c].setVerticalAlignment('center');
        }
      }

      return { success: true, description: 'Set vertical alignment to center' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set alignment',
        description: 'Set vertical alignment',
      };
    }
  },

  'table-cell-borders': async (_ctx) => {
    return {
      success: false,
      error: 'Cell borders dialog not yet implemented',
      description: 'Configure cell borders',
    };
  },

  'table-cell-shading': async (_ctx) => {
    return {
      success: false,
      error: 'Cell shading dialog not yet implemented',
      description: 'Configure cell shading',
    };
  },

  // Structure
  'page-break': async (ctx) => {
    if (!ctx.selection) {
      return { success: false, error: 'No position selected', description: 'Insert page break' };
    }

    try {
      const paragraph = getParagraphAtIndex(ctx.document, ctx.selection.paragraphIndex);
      if (!paragraph) {
        return { success: false, error: 'Paragraph not found', description: 'Insert page break' };
      }

      paragraph.setPageBreakBefore(true);

      return { success: true, description: 'Insert page break before paragraph' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to insert page break',
        description: 'Insert page break',
      };
    }
  },

  'find-replace': async (_ctx) => {
    return {
      success: false,
      error: 'Find & Replace dialog not yet implemented',
      description: 'Open Find & Replace',
    };
  },

  // Hyperlinks
  'insert-hyperlink': async (_ctx) => {
    return {
      success: false,
      error: 'Insert hyperlink dialog not yet implemented',
      description: 'Insert hyperlink',
    };
  },

  'remove-hyperlink': async (ctx) => {
    if (!ctx.selection) {
      return { success: false, error: 'No text selected', description: 'Remove hyperlink' };
    }

    try {
      const paragraphs = ctx.document.getAllParagraphs();
      const para = paragraphs[ctx.selection.paragraphIndex];
      if (!para) {
        return { success: false, error: 'Paragraph not found', description: 'Remove hyperlink' };
      }

      // Get paragraph content to find hyperlinks
      const content = para.getContent();
      let removedCount = 0;

      // Find and remove hyperlinks in the paragraph
      for (const item of content) {
        // Check if item is a hyperlink using duck typing
        if (item && typeof (item as any).getUrl === 'function') {
          const hyperlink = item as any;
          const hyperlinkText = hyperlink.getText() || '';

          // Convert hyperlink to plain text run
          // Create a new run with the hyperlink's text
          if (typeof hyperlink.convertToRun === 'function') {
            // Use docxmlater's built-in conversion if available
            hyperlink.convertToRun();
            removedCount++;
          } else if (typeof para.replaceContent === 'function') {
            // Alternative: replace hyperlink with a text run
            const Run = (await import('docxmlater')).Run;
            const newRun = Run.create(hyperlinkText);
            para.replaceContent(hyperlink, [newRun]);
            removedCount++;
          }
        }
      }

      if (removedCount > 0) {
        return { success: true, description: `Removed ${removedCount} hyperlink(s)` };
      }

      return {
        success: false,
        error: 'No hyperlinks found in selection',
        description: 'Remove hyperlink',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove hyperlink',
        description: 'Remove hyperlink',
      };
    }
  },

  // Tracked Changes
  'accept-all-changes': async (ctx) => {
    try {
      const revisionManager = (ctx.document as any).getRevisionManager?.();

      if (revisionManager) {
        revisionManager.acceptAll?.();
        return { success: true, description: 'Accept all tracked changes' };
      }

      return {
        success: false,
        error: 'No revision manager available',
        description: 'Accept all changes',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to accept changes',
        description: 'Accept all changes',
      };
    }
  },

  'reject-all-changes': async (ctx) => {
    try {
      const revisionManager = (ctx.document as any).getRevisionManager?.();

      if (revisionManager) {
        revisionManager.rejectAll?.();
        return { success: true, description: 'Reject all tracked changes' };
      }

      return {
        success: false,
        error: 'No revision manager available',
        description: 'Reject all changes',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reject changes',
        description: 'Reject all changes',
      };
    }
  },
};

/**
 * Execute an editor action
 */
export async function executeAction(
  actionId: QuickActionId,
  context: ActionContext
): Promise<ActionResult> {
  const handler = actionHandlers[actionId];

  if (!handler) {
    return {
      success: false,
      error: `No handler for action: ${actionId}`,
      description: `Execute ${actionId}`,
    };
  }

  return handler(context);
}

/**
 * Check if an action is available given the current context
 */
export function isActionAvailable(
  actionId: QuickActionId,
  context: Omit<ActionContext, 'document'>
): boolean {
  // Text formatting actions require text selection
  const textFormatActions: QuickActionId[] = [
    'bold',
    'italic',
    'underline',
    'clear-formatting',
  ];

  if (textFormatActions.includes(actionId)) {
    return context.selection !== null;
  }

  // Paragraph style actions require paragraph selection
  const paragraphStyleActions: QuickActionId[] = [
    'style-heading1',
    'style-heading2',
    'style-normal',
    'style-list-paragraph',
    'page-break',
  ];

  if (paragraphStyleActions.includes(actionId)) {
    return context.selection !== null;
  }

  // Table actions require table selection
  const tableActions: QuickActionId[] = [
    'apply-h2-shading',
    'apply-other-shading',
    'table-add-row-above',
    'table-add-row-below',
    'table-delete-row',
    'table-add-col-left',
    'table-add-col-right',
    'table-delete-col',
    'table-merge-cells',
    'table-split-cell',
    'table-vertical-align',
    'table-cell-borders',
    'table-cell-shading',
  ];

  if (tableActions.includes(actionId)) {
    return context.tableSelection !== null && context.selectedTableIndex !== null;
  }

  // Shading actions also require shading settings
  if (actionId === 'apply-h2-shading' || actionId === 'apply-other-shading') {
    return (
      context.tableSelection !== null &&
      context.selectedTableIndex !== null &&
      context.tableShadingSettings !== undefined
    );
  }

  // Global actions are always available
  const globalActions: QuickActionId[] = [
    'find-replace',
    'accept-all-changes',
    'reject-all-changes',
  ];

  if (globalActions.includes(actionId)) {
    return true;
  }

  // Default to requiring some selection
  return context.selection !== null || context.tableSelection !== null;
}

export default {
  executeAction,
  isActionAvailable,
};
