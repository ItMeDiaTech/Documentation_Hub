/**
 * DocumentEditorModal - Fullscreen modal overlay for document editing
 *
 * Features:
 * - Full editing capability for document content
 * - Quick action buttons for formatting and table operations
 * - Session-configured shading application
 * - Save/Close with unsaved changes warning
 * - Undo/Redo support
 * - Integration with docxmlater for document manipulation
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import type {
  QuickActionId,
  EditorState,
  CellSelection,
  EditorSelection,
  EditorAction,
} from '@/types/editor';
import { EditorToolbar } from './EditorToolbar';
import { EditorQuickActions } from './EditorQuickActions';
import { DocumentEditor, DocumentEditorRef } from './DocumentEditor';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Document, Paragraph, Table } from 'docxmlater';

// Use 'any' for internal document element types to avoid type conflicts
// DocumentEditor has its own type definitions that we pass through

/**
 * Sync editor bodyElements changes back to docxmlater Document
 * Maps the editor's internal format back to docxmlater API calls
 */
async function syncBodyElementsToDocument(
  doc: Document,
  bodyElements: any[]
): Promise<void> {
  const docElements = doc.getBodyElements();

  // Track which paragraphs/tables have been modified
  let paragraphIndex = 0;
  let tableIndex = 0;

  for (const element of bodyElements) {
    if (element.type === 'paragraph') {
      // Find corresponding paragraph in document
      let docParagraphIndex = 0;
      for (const docElement of docElements) {
        if (docElement instanceof Paragraph) {
          if (docParagraphIndex === paragraphIndex) {
            // Sync text changes - update runs
            const editorPara = element.paragraph;
            const docPara = docElement;

            // Clear existing runs and rebuild from editor state
            if (editorPara.runs && editorPara.runs.length > 0) {
              const docRuns = docPara.getRuns();

              // Update each run's text and formatting
              for (let i = 0; i < Math.min(docRuns.length, editorPara.runs.length); i++) {
                const editorRun = editorPara.runs[i];
                const docRun = docRuns[i];

                if (editorRun.text !== docRun.getText()) {
                  docRun.setText(editorRun.text);
                }

                // Sync formatting if changed
                if (editorRun.bold !== undefined) docRun.setBold(editorRun.bold);
                if (editorRun.italic !== undefined) docRun.setItalic(editorRun.italic);
                if (editorRun.underline !== undefined) {
                  docRun.setUnderline(editorRun.underline ? 'single' : false);
                }
                if (editorRun.color) docRun.setColor(editorRun.color.replace('#', ''));
                if (editorRun.font) docRun.setFont(editorRun.font);
                if (editorRun.size) docRun.setSize(editorRun.size);
              }
            }

            // Sync paragraph formatting
            if (editorPara.alignment) {
              docPara.setAlignment(editorPara.alignment);
            }

            break;
          }
          docParagraphIndex++;
        }
      }
      paragraphIndex++;
    } else if (element.type === 'table') {
      // Find corresponding table in document
      let docTableIndex = 0;
      for (const docElement of docElements) {
        if (docElement instanceof Table) {
          if (docTableIndex === tableIndex) {
            const editorTable = element.table;
            const docTable = docElement;
            const docRows = docTable.getRows();

            // Sync each row/cell
            for (let rowIdx = 0; rowIdx < Math.min(docRows.length, editorTable.rows.length); rowIdx++) {
              const editorRow = editorTable.rows[rowIdx];
              const docRow = docRows[rowIdx];
              const docCells = docRow.getCells();

              for (let cellIdx = 0; cellIdx < Math.min(docCells.length, editorRow.cells.length); cellIdx++) {
                const editorCell = editorRow.cells[cellIdx];
                const docCell = docCells[cellIdx];
                const docCellParas = docCell.getParagraphs();

                // Sync cell shading
                if (editorCell.shading) {
                  docCell.setShading(editorCell.shading.replace('#', ''));
                }

                // Sync cell paragraphs
                for (let paraIdx = 0; paraIdx < Math.min(docCellParas.length, editorCell.paragraphs.length); paraIdx++) {
                  const editorCellPara = editorCell.paragraphs[paraIdx];
                  const docCellPara = docCellParas[paraIdx];
                  const docCellRuns = docCellPara.getRuns();

                  // Sync runs
                  for (let runIdx = 0; runIdx < Math.min(docCellRuns.length, (editorCellPara.runs || []).length); runIdx++) {
                    const editorRun = editorCellPara.runs[runIdx];
                    const docRun = docCellRuns[runIdx];

                    if (editorRun.text !== docRun.getText()) {
                      docRun.setText(editorRun.text);
                    }
                    if (editorRun.bold !== undefined) docRun.setBold(editorRun.bold);
                    if (editorRun.italic !== undefined) docRun.setItalic(editorRun.italic);
                  }

                  // Sync paragraph alignment
                  if (editorCellPara.alignment) {
                    docCellPara.setAlignment(editorCellPara.alignment);
                  }
                }
              }
            }

            break;
          }
          docTableIndex++;
        }
      }
      tableIndex++;
    }
  }
}

/**
 * Convert docxmlater Document body to editor-compatible format
 * Returns any[] to allow passing to DocumentEditor which has its own types
 */
function documentToBodyElements(doc: Document): any[] {
  const elements: any[] = [];
  const docElements = doc.getBodyElements();

  for (const element of docElements) {
    if (element instanceof Paragraph) {
      const para = element;
      const runs: any[] = [];

      for (const run of para.getRuns() || []) {
        const runFormatting = run.getFormatting();
        runs.push({
          text: run.getText() || '',
          bold: runFormatting.bold,
          italic: runFormatting.italic,
          underline: runFormatting.underline,
          strike: runFormatting.strike,
          color: runFormatting.color,
          font: runFormatting.font,
          size: runFormatting.size,
          highlight: runFormatting.highlight,
        });
      }

      const styleId = para.getStyle();
      const paraFormatting = para.getFormatting();
      elements.push({
        type: 'paragraph',
        paragraph: {
          text: para.getText() || '',
          runs,
          alignment: paraFormatting.alignment,
          style: styleId,
          isHeading: styleId?.includes('Heading'),
          headingLevel: styleId?.match(/Heading(\d)/)?.[1]
            ? parseInt(styleId.match(/Heading(\d)/)![1])
            : undefined,
        },
      });
    } else if (element instanceof Table) {
      const table = element;
      const rows: any[] = [];

      for (const row of table.getRows() || []) {
        const cells: any[] = [];

        for (const cell of row.getCells() || []) {
          const paragraphs: any[] = [];

          for (const cellPara of cell.getParagraphs() || []) {
            const cellRuns: any[] = [];

            for (const run of cellPara.getRuns() || []) {
              const runFormatting = run.getFormatting();
              cellRuns.push({
                text: run.getText() || '',
                bold: runFormatting.bold,
                italic: runFormatting.italic,
                underline: runFormatting.underline,
                color: runFormatting.color,
              });
            }

            const cellParaFormatting = cellPara.getFormatting();
            paragraphs.push({
              text: cellPara.getText() || '',
              runs: cellRuns,
              alignment: cellParaFormatting.alignment,
            });
          }

          const cellFormatting = cell.getFormatting();
          cells.push({
            paragraphs:
              paragraphs.length > 0 ? paragraphs : [{ text: '', runs: [] }],
            shading: cellFormatting.shading?.fill,
            verticalMerge: cellFormatting.vMerge,
            columnSpan: cellFormatting.columnSpan,
          });
        }

        rows.push({ cells });
      }

      elements.push({
        type: 'table',
        table: { rows },
      });
    }
  }

  return elements;
}

interface DocumentEditorModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** Save handler - receives the modified document */
  onSave: (documentBuffer: ArrayBuffer) => Promise<void>;
  /** Session ID */
  sessionId: string;
  /** Document ID */
  documentId: string;
  /** Document name for display */
  documentName: string;
  /** Original document buffer */
  documentBuffer: ArrayBuffer | null;
  /** Table shading settings from session */
  tableShadingSettings?: {
    header2Shading: string;
    otherShading: string;
  };
}

/**
 * Main DocumentEditorModal component
 */
export function DocumentEditorModal({
  isOpen,
  onClose,
  onSave,
  sessionId,
  documentId,
  documentName,
  documentBuffer,
  tableShadingSettings,
}: DocumentEditorModalProps) {
  // Editor state
  const [editorState, setEditorState] = useState<EditorState>({
    isDirty: false,
    selection: null,
    tableSelection: null,
    selectedElementType: null,
    selectedParagraphIndex: null,
    selectedTableIndex: null,
    undoStack: [],
    redoStack: [],
    activeQuickAction: null,
    isLoading: false,
    error: null,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [bodyElements, setBodyElements] = useState<any[]>([]);
  const [docInstance, setDocInstance] = useState<Document | null>(null);

  // Refs
  const documentEditorRef = useRef<DocumentEditorRef>(null);

  // Load document from buffer when opened
  useEffect(() => {
    if (!isOpen || !documentBuffer) {
      setBodyElements([]);
      setDocInstance(null);
      return;
    }

    const loadDocument = async () => {
      setEditorState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        // Convert ArrayBuffer to Buffer for docxmlater
        const buffer = Buffer.from(documentBuffer);
        const doc = await Document.loadFromBuffer(buffer);
        setDocInstance(doc);

        const elements = documentToBodyElements(doc);
        setBodyElements(elements);

        setEditorState((prev) => ({ ...prev, isLoading: false }));
      } catch (error) {
        console.error('Failed to load document:', error);
        setEditorState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load document',
        }));
      }
    };

    loadDocument();

    // Cleanup on unmount
    return () => {
      if (docInstance) {
        docInstance.dispose?.();
      }
    };
  }, [isOpen, documentBuffer]);

  // Handle selection change
  const handleSelectionChange = useCallback((selection: EditorSelection | null) => {
    setEditorState((prev) => ({
      ...prev,
      selection,
      selectedElementType: selection ? 'paragraph' : prev.selectedElementType,
      selectedParagraphIndex: selection?.paragraphIndex ?? prev.selectedParagraphIndex,
    }));
  }, []);

  // Handle table selection change
  const handleTableSelectionChange = useCallback(
    (selection: CellSelection | null, tableIndex: number | null) => {
      setEditorState((prev) => ({
        ...prev,
        tableSelection: selection,
        selectedElementType: selection ? 'table' : prev.selectedElementType,
        selectedTableIndex: tableIndex,
      }));
    },
    []
  );

  // Handle body elements change from editor
  const handleBodyElementsChange = useCallback(
    (newElements: any[], action: EditorAction) => {
      setBodyElements(newElements);

      // Add to undo stack
      setEditorState((prev) => ({
        ...prev,
        isDirty: true,
        undoStack: [...prev.undoStack, action],
        redoStack: [], // Clear redo stack on new change
      }));
    },
    []
  );

  // Handle save - sync changes to document and save
  const handleSave = useCallback(async () => {
    if (!docInstance) return;

    setIsSaving(true);
    try {
      // Sync editor bodyElements changes back to docxmlater document
      await syncBodyElementsToDocument(docInstance, bodyElements);

      // Save the document with synced changes
      const buffer = await docInstance.toBuffer();
      // Convert Buffer to ArrayBuffer for onSave callback
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer;
      await onSave(arrayBuffer);
      setEditorState((prev) => ({ ...prev, isDirty: false }));
    } catch (error) {
      console.error('Failed to save document:', error);
      setEditorState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to save document',
      }));
    } finally {
      setIsSaving(false);
    }
  }, [docInstance, bodyElements, onSave]);

  // Handle undo
  const handleUndo = useCallback(() => {
    const { undoStack, redoStack } = editorState;
    if (undoStack.length === 0) return;

    const action = undoStack[undoStack.length - 1];
    action.undo();

    setEditorState((prev) => ({
      ...prev,
      undoStack: prev.undoStack.slice(0, -1),
      redoStack: [...prev.redoStack, action],
      isDirty: true,
    }));
  }, [editorState]);

  // Handle redo
  const handleRedo = useCallback(() => {
    const { redoStack } = editorState;
    if (redoStack.length === 0) return;

    const action = redoStack[redoStack.length - 1];
    action.redo();

    setEditorState((prev) => ({
      ...prev,
      redoStack: prev.redoStack.slice(0, -1),
      undoStack: [...prev.undoStack, action],
      isDirty: true,
    }));
  }, [editorState]);

  // Handle quick action
  const handleQuickAction = useCallback((actionId: QuickActionId) => {
    console.log('Quick action triggered:', actionId);

    // Mark as dirty for any action
    setEditorState((prev) => ({
      ...prev,
      activeQuickAction: actionId,
      isDirty: true,
    }));

    // The actual action implementation would go here
    // For now, just clear the active action after a brief delay
    setTimeout(() => {
      setEditorState((prev) => ({
        ...prev,
        activeQuickAction: null,
      }));
    }, 100);
  }, []);

  // Handle close with unsaved changes check
  const handleClose = useCallback(() => {
    if (editorState.isDirty) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to close without saving?'
      );
      if (!confirmed) return;
    }
    onClose();
  }, [editorState.isDirty, onClose]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        handleClose();
        return;
      }

      // Ctrl/Cmd+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      // Ctrl/Cmd+Z to undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z to redo
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.key === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Ctrl/Cmd+B for bold
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        handleQuickAction('bold');
        return;
      }

      // Ctrl/Cmd+I for italic
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        handleQuickAction('italic');
        return;
      }

      // Ctrl/Cmd+U for underline
      if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
        e.preventDefault();
        handleQuickAction('underline');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose, handleSave, handleUndo, handleRedo, handleQuickAction]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Don't render if not open
  if (!isOpen) return null;

  const modalContent = (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex flex-col bg-background"
      >
        {/* Backdrop blur effect */}
        <div className="absolute inset-0 bg-background/95 backdrop-blur-sm" />

        {/* Modal content */}
        <div className="relative flex flex-col h-full">
          {/* Toolbar */}
          <EditorToolbar
            documentName={documentName}
            isDirty={editorState.isDirty}
            isSaving={isSaving}
            canUndo={editorState.undoStack.length > 0}
            canRedo={editorState.redoStack.length > 0}
            onClose={handleClose}
            onSave={handleSave}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onQuickAction={handleQuickAction}
          />

          {/* Main content area */}
          <div className="flex flex-1 overflow-hidden">
            {/* Document editor */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {editorState.isLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <span className="ml-2">Loading document...</span>
                </div>
              ) : editorState.error ? (
                <div className="flex-1 flex flex-col items-center justify-center text-destructive gap-2">
                  <AlertTriangle className="w-12 h-12" />
                  <p className="text-lg font-medium">Failed to load document</p>
                  <p className="text-sm">{editorState.error}</p>
                </div>
              ) : (
                <DocumentEditor
                  ref={documentEditorRef}
                  bodyElements={bodyElements}
                  onChange={handleBodyElementsChange}
                  onSelectionChange={handleSelectionChange}
                  onTableSelectionChange={handleTableSelectionChange}
                  selection={editorState.selection}
                  tableSelection={editorState.tableSelection}
                  selectedTableIndex={editorState.selectedTableIndex}
                  activeQuickAction={editorState.activeQuickAction}
                  tableShadingSettings={tableShadingSettings}
                  readOnly={isSaving}
                />
              )}
            </div>

            {/* Quick actions sidebar */}
            <div className="w-64 flex-shrink-0">
              <EditorQuickActions
                onAction={handleQuickAction}
                hasTableSelection={editorState.tableSelection !== null}
                hasTextSelection={editorState.selection !== null}
                cellSelection={editorState.tableSelection}
                tableShadingSettings={tableShadingSettings}
                disabled={isSaving}
              />
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );

  // Render in portal to avoid z-index issues
  return createPortal(modalContent, document.body);
}

export default DocumentEditorModal;
