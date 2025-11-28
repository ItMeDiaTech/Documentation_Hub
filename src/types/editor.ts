/**
 * Editor Types - Types for document comparison, tracked changes display,
 * and the document editor functionality
 */

/**
 * Document snapshot captured before processing for comparison
 * Stores both the raw buffer and extracted text for diffing
 */
export interface DocumentSnapshot {
  /** Unique document identifier */
  documentId: string;
  /** Session the document belongs to */
  sessionId: string;
  /** When the snapshot was captured */
  timestamp: Date;
  /** Original document buffer for full restoration */
  buffer: ArrayBuffer;
  /** Extracted paragraph text for efficient diffing */
  textContent: string[];
  /** Hyperlink state for comparison */
  hyperlinkSnapshot: HyperlinkSnapshot[];
}

/**
 * Hyperlink state at time of snapshot
 */
export interface HyperlinkSnapshot {
  paragraphIndex: number;
  hyperlinkIndex: number;
  url: string;
  text: string;
}

/**
 * Serialized snapshot for IndexedDB storage
 * Dates converted to ISO strings
 */
export interface SerializedDocumentSnapshot {
  documentId: string;
  sessionId: string;
  timestamp: string;
  buffer: ArrayBuffer;
  textContent: string[];
  hyperlinkSnapshot: HyperlinkSnapshot[];
}

/**
 * Text selection state in the editor
 */
export interface EditorSelection {
  /** Paragraph containing the selection start */
  paragraphIndex: number;
  /** First selected run index */
  runStartIndex: number;
  /** Last selected run index */
  runEndIndex: number;
  /** Character offset within first run */
  characterStart: number;
  /** Character offset within last run */
  characterEnd: number;
}

/**
 * Table cell selection state
 */
export interface CellSelection {
  /** Starting row (0-based) */
  startRow: number;
  /** Starting column (0-based) */
  startCol: number;
  /** Ending row (0-based, inclusive) */
  endRow: number;
  /** Ending column (0-based, inclusive) */
  endCol: number;
}

/**
 * Undo/redo action for editor history
 */
export interface EditorAction {
  /** Type of action */
  type: 'text' | 'formatting' | 'structure' | 'table';
  /** When action was performed */
  timestamp: Date;
  /** Function to undo this action */
  undo: () => void;
  /** Function to redo this action */
  redo: () => void;
  /** Human-readable description */
  description: string;
}

/**
 * Quick action identifiers for editor toolbar
 */
export type QuickActionId =
  // Shading
  | 'apply-h2-shading'
  | 'apply-other-shading'
  // Text formatting
  | 'bold'
  | 'italic'
  | 'underline'
  | 'clear-formatting'
  // Hyperlinks
  | 'insert-hyperlink'
  | 'remove-hyperlink'
  // Styles
  | 'style-heading1'
  | 'style-heading2'
  | 'style-normal'
  | 'style-list-paragraph'
  // Structure
  | 'page-break'
  | 'find-replace'
  // Tracked changes
  | 'accept-all-changes'
  | 'reject-all-changes'
  // Table operations
  | 'table-add-row-above'
  | 'table-add-row-below'
  | 'table-add-col-left'
  | 'table-add-col-right'
  | 'table-delete-row'
  | 'table-delete-col'
  | 'table-merge-cells'
  | 'table-split-cell'
  | 'table-cell-shading'
  | 'table-cell-borders'
  | 'table-vertical-align';

/**
 * Quick action configuration
 */
export interface QuickAction {
  id: QuickActionId;
  label: string;
  icon: string;
  shortcut?: string;
  category: 'formatting' | 'style' | 'structure' | 'table' | 'revision';
  requiresSelection?: boolean;
  requiresTableSelection?: boolean;
}

/**
 * Diff segment for word-level comparison
 */
export interface DiffSegment {
  /** Text content of this segment */
  text: string;
  /** Type of change */
  type: 'unchanged' | 'added' | 'removed' | 'modified';
}

/**
 * Paragraph diff result
 */
export interface ParagraphDiff {
  /** Paragraph index */
  index: number;
  /** Original text (before processing) */
  original: string;
  /** Modified text (after processing) */
  modified: string;
  /** Word-level diff segments for original */
  originalSegments: DiffSegment[];
  /** Word-level diff segments for modified */
  modifiedSegments: DiffSegment[];
  /** Whether this paragraph changed */
  hasChanges: boolean;
}

/**
 * Complete document diff result
 */
export interface DocumentDiff {
  /** Original document text (paragraph array) */
  original: string[];
  /** Modified document text (paragraph array) */
  modified: string[];
  /** Per-paragraph diff results */
  paragraphDiffs: ParagraphDiff[];
  /** Summary statistics */
  stats: {
    totalParagraphs: number;
    changedParagraphs: number;
    addedParagraphs: number;
    removedParagraphs: number;
    wordsAdded: number;
    wordsRemoved: number;
    wordsModified: number;
  };
}

/**
 * Editor state for the document editor modal
 */
export interface EditorState {
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Current text selection */
  selection: EditorSelection | null;
  /** Current table cell selection */
  tableSelection: CellSelection | null;
  /** Currently selected element type */
  selectedElementType: 'paragraph' | 'table' | 'image' | null;
  /** Selected paragraph index */
  selectedParagraphIndex: number | null;
  /** Selected table index */
  selectedTableIndex: number | null;
  /** Undo stack */
  undoStack: EditorAction[];
  /** Redo stack */
  redoStack: EditorAction[];
  /** Active quick action being applied */
  activeQuickAction: QuickActionId | null;
  /** Whether editor is in loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
}

/**
 * View mode for tracked changes panel
 */
export type TrackedChangesViewMode = 'inline' | 'list' | 'comparison';

/**
 * Props for tracked changes panel
 */
export interface TrackedChangesPanelProps {
  sessionId: string;
  documentId: string;
  onOpenEditor: () => void;
}

/**
 * Inline change display configuration
 */
export interface InlineChangeStyle {
  insertion: {
    background: string;
    textColor: string;
  };
  deletion: {
    background: string;
    textColor: string;
    textDecoration: string;
  };
  formatting: {
    borderStyle: string;
    borderColor: string;
  };
  hyperlink: {
    iconColor: string;
  };
}

/**
 * Default inline change styles
 */
export const DEFAULT_INLINE_CHANGE_STYLES: InlineChangeStyle = {
  insertion: {
    background: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-300',
  },
  deletion: {
    background: 'bg-red-100 dark:bg-red-900/30',
    textColor: 'text-red-700 dark:text-red-300',
    textDecoration: 'line-through',
  },
  formatting: {
    borderStyle: 'border-b-2 border-dashed',
    borderColor: 'border-blue-500',
  },
  hyperlink: {
    iconColor: 'text-cyan-500',
  },
};
