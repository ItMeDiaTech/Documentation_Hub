// Revision handling mode type
export type RevisionHandlingMode = 'accept_all' | 'preserve' | 'preserve_and_wrap';

// Change category type
export type ChangeCategory =
  | 'content'
  | 'formatting'
  | 'structural'
  | 'table'
  | 'hyperlink'
  | 'image'
  | 'field'
  | 'comment'
  | 'bookmark'
  | 'contentControl';

/**
 * Change entry from Word tracked changes (compatible with docxmlater ChangeEntry)
 */
export interface ChangeEntry {
  id: string;
  revisionType: string;
  category: ChangeCategory;
  description: string;
  author: string;
  date: Date;
  location?: {
    sectionIndex?: number;
    paragraphIndex: number;
    runIndex?: number;
    nearestHeading?: string;
    characterOffset?: number;
  };
  content?: {
    before?: string;
    after?: string;
    affectedText?: string;
    hyperlinkChange?: {
      urlBefore?: string;
      urlAfter?: string;
      textBefore?: string;
      textAfter?: string;
      /** Status of the hyperlink source (for theSource links) */
      status?: 'updated' | 'not_found' | 'expired';
      /** Content ID for theSource documents */
      contentId?: string;
    };
  };
  propertyChange?: {
    property: string;
    oldValue?: string;
    newValue?: string;
  };
}

/**
 * Summary statistics for changelog entries
 */
export interface ChangelogSummary {
  total: number;
  byCategory: Record<ChangeCategory, number>;
  byType: Record<string, number>;
  byAuthor: Record<string, number>;
  dateRange: { earliest: Date; latest: Date } | null;
}

/**
 * Unified change entry for UI display - combines Word revisions and processing changes
 */
export interface UnifiedChange {
  id: string;
  source: 'word' | 'processing';
  category: ChangeCategory; // 'content' | 'formatting' | 'structural' | 'table' | 'hyperlink'
  description: string;
  author?: string;
  date?: Date;
  location?: {
    paragraphIndex?: number;
    nearestHeading?: string;
  };
  before?: string;
  after?: string;
  affectedText?: string; // The text that was affected by this change
  count?: number; // For consolidated changes
  hyperlinkChange?: {
    urlBefore?: string;
    urlAfter?: string;
    textBefore?: string;
    textAfter?: string;
    /** Status of the hyperlink source (for theSource links) */
    status?: 'updated' | 'not_found' | 'expired';
    /** Content ID for theSource documents */
    contentId?: string;
  };
  /** Property change details (for formatting changes) */
  propertyChange?: {
    property: string;
    oldValue?: string;
    newValue?: string;
  };
  /** Multiple property changes grouped together (when same text has multiple formatting changes) */
  groupedProperties?: Array<{
    property: string;
    oldValue?: string;
    newValue?: string;
  }>;
}

/**
 * Previous revision state - tracked changes that existed in the document BEFORE DocHub processing
 * These are captured on document load and displayed separately in the UI
 */
export interface PreviousRevisionState {
  /** Whether document had pre-existing tracked changes */
  hadRevisions: boolean;
  /** Changelog entries from pre-existing Word revisions (before DocHub processing) */
  entries: ChangeEntry[];
  /** Summary statistics for pre-existing revisions */
  summary: ChangelogSummary | null;
}

/**
 * Word revision state for a document - tracked changes from DocHub processing
 */
export interface WordRevisionState {
  /** Whether document has Word tracked changes */
  hasRevisions: boolean;
  /** Changelog entries from DocHub processing (author is typically 'DocHub' or user name) */
  entries: ChangeEntry[];
  /** Summary statistics */
  summary: ChangelogSummary | null;
  /** How revisions were handled during processing */
  handlingMode: RevisionHandlingMode;
  /** Author name used for DocHub processing changes - used to distinguish DocHub vs pre-existing changes */
  processingAuthor?: string;
  /** Result of revision handling */
  handlingResult?: {
    accepted: string[];
    preserved: string[];
    conflicts: number;
  };
}

export interface Document {
  id: string;
  name: string;
  path?: string;
  size: number;
  type?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  processedAt?: Date;
  errors?: string[];
  errorType?: 'file_locked' | 'api_timeout' | 'general';
  fileData?: ArrayBuffer; // Store file data for processing
  /** Pre-existing tracked changes that were in the document BEFORE DocHub processing */
  previousRevisions?: PreviousRevisionState;
  /** Word tracked changes state from DocHub processing */
  wordRevisions?: WordRevisionState;
  // Processing results
  processingResult?: {
    hyperlinksProcessed?: number;
    hyperlinksModified?: number;
    contentIdsAppended?: number;
    backupPath?: string;
    duration?: number;
    changes?: DocumentChange[];
    optionsUsed?: string[]; // IDs of processing options that were enabled during processing
    warnings?: string[]; // Any warnings or issues encountered (e.g., "Header 2 spacing could not be applied")
  };
}

export interface DocumentChange {
  id?: string; // Unique identifier for the change (for reversion)
  type: 'hyperlink' | 'text' | 'style' | 'structure' | 'table' | 'deletion';
  description: string;
  before?: string;
  after?: string;
  count?: number;
  // Location tracking for precise reversion
  elementPath?: string; // XPath-like identifier for element
  paragraphIndex?: number; // Paragraph index in document
  runIndex?: number; // Run index within paragraph
  context?: string; // Surrounding context for better identification

  // NEW: Enhanced location context
  nearestHeader2?: string; // Closest Header 2 above this change
  sectionContext?: string; // Additional section info

  // NEW: Grouping and categorization
  category?: 'blank_lines' | 'hyperlink_update' | 'hyperlink_failed' | 'list_fix' |
             'style_application' | 'structure' | 'other';
  affectedItems?: string[]; // For grouped changes (e.g., list of URLs updated)

  // NEW: Hyperlink-specific metadata
  contentId?: string; // Content ID if applicable
  hyperlinkStatus?: 'updated' | 'expired' | 'not_found' | 'valid';

  // NEW: URL change tracking for hyperlinks
  urlBefore?: string; // Original URL (before change)
  urlAfter?: string; // New URL (after change)
}

export interface SessionStats {
  documentsProcessed: number;
  hyperlinksChecked: number;
  feedbackImported: number;
  timeSaved: number; // in minutes
}

export interface Session {
  id: string;
  name: string;
  createdAt: Date;
  lastModified: Date;
  closedAt?: Date;
  documents: Document[];
  stats: SessionStats;
  status: 'active' | 'closed';
  // Processing configuration
  processingOptions?: {
    appendContentId?: boolean; // DEPRECATED: #content should never be appended
    contentIdToAppend?: string; // DEPRECATED: #content should never be appended
    validateUrls: boolean;
    createBackup: boolean;
    processInternalLinks: boolean;
    processExternalLinks: boolean;
    enabledOperations: string[];
    /** How to handle Word tracked changes during processing */
    revisionHandlingMode?: RevisionHandlingMode;
    /** Author name for preserve_and_wrap mode */
    revisionAuthor?: string;
    /** Auto-accept all revisions after processing for clean output (default: false) */
    autoAcceptRevisions?: boolean;
  };
  // Style configuration
  styles?: SessionStyle[];
  // Document uniformity settings
  listBulletSettings?: ListBulletSettings;
  tableUniformitySettings?: TableUniformitySettings; // Legacy - will be deprecated
  tableShadingSettings?: TableShadingSettings; // NEW: Simplified table shading colors
  tableOfContentsSettings?: TableOfContentsSettings;
  // Replacement rules
  replacements?: ReplacementRule[];
}

export interface SessionStyle {
  id: string; // CRITICAL: needed to identify which style (header1, header2, header3, normal, listParagraph)
  name: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean; // Required: true = apply bold, false = remove bold
  italic: boolean; // Required: true = apply italic, false = remove italic
  underline: boolean; // Required: true = apply underline, false = remove underline
  preserveBold?: boolean; // Optional: true = preserve existing bold (ignore bold property)
  preserveItalic?: boolean; // Optional: true = preserve existing italic (ignore italic property)
  preserveUnderline?: boolean; // Optional: true = preserve existing underline (ignore underline property)
  preserveCenterAlignment?: boolean; // Optional: true = preserve center alignment if paragraph is already centered
  alignment: 'left' | 'center' | 'right' | 'justify';
  color: string;
  spaceBefore: number;
  spaceAfter: number;
  lineSpacing: number;
  noSpaceBetweenSame?: boolean; // Don't add space between paragraphs of the same style (List Paragraph)
  indentation?: {
    left?: number; // Left indent in inches (e.g., 0.25" for bullet position)
    firstLine?: number; // First line indent in inches (e.g., 0.5" for text position)
  };
}

export interface IndentationLevel {
  level: number;
  symbolIndent: number; // Symbol/bullet position from left margin in inches
  textIndent: number; // Text position from left margin in inches
  bulletChar?: string; // bullet character for this level
  numberedFormat?: string; // format for numbered lists (1., a., i., etc.)
}

export interface ListBulletSettings {
  enabled: boolean;
  indentationLevels: IndentationLevel[];
  // Note: List item spacing uses the List Paragraph style's spaceBefore/spaceAfter values
}

export interface TableUniformitySettings {
  enabled: boolean;
  borderStyle: 'none' | 'single' | 'double' | 'dashed';
  borderWidth: number; // in points
  headerRowBold: boolean;
  headerRowShaded: boolean;
  headerRowShadingColor: string; // color hex for header row shading
  alternatingRowColors: boolean;
  cellPadding: number; // in points
  autoFit: 'content' | 'window';
  // Header 2 in 1x1 table cell settings
  header2In1x1CellShading: string; // color hex
  header2In1x1Alignment: 'left' | 'center' | 'right' | 'justify';
  // Large table (>1x1) settings
  largeTableSettings: {
    font: string;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    alignment: 'left' | 'center' | 'right' | 'justify';
    cellPadding: number;
  };
  applyToIfThenPattern: boolean; // Apply to cells with "If...Then" pattern
  applyToTopRow: boolean; // Apply to top row if not 1x1
}

export interface TableOfContentsSettings {
  enabled: boolean;
}

export interface TableShadingSettings {
  header2Shading: string; // Hex color for Header 2 / 1x1 table cells (default: #BFBFBF)
  otherShading: string; // Hex color for other table cells (default: #DFDFDF)
  imageBorderWidth?: number; // Border width in points for images (default: 1.0)
  preserveBold?: boolean; // If true, preserve original bold formatting in table cells (default: use Normal style's preserveBold)
  heading2FontFamily?: string; // Font family for Heading 2 / 1x1 table cells (default: from Heading 2 style config)
  heading2FontSize?: number; // Font size in points for Heading 2 / 1x1 table cells (default: from Heading 2 style config)

  // Table cell padding in inches
  // 1x1 Tables padding
  padding1x1Top?: number; // default: 0
  padding1x1Bottom?: number; // default: 0
  padding1x1Left?: number; // default: 0.08
  padding1x1Right?: number; // default: 0.08

  // Other Tables padding (>1x1)
  paddingOtherTop?: number; // default: 0
  paddingOtherBottom?: number; // default: 0
  paddingOtherLeft?: number; // default: 0.08
  paddingOtherRight?: number; // default: 0.08
}

export interface ReplacementRule {
  id: string;
  enabled: boolean;
  type: 'hyperlink' | 'text';
  pattern: string;
  replacement: string;
  caseSensitive?: boolean;
}

/**
 * Custom session defaults stored in localStorage
 * Used when user clicks "Save as Default" to persist their preferred settings
 */
export interface CustomSessionDefaults {
  styles?: SessionStyle[];
  listBulletSettings?: ListBulletSettings;
  processingOptions?: Session['processingOptions'];
  tableShadingSettings?: TableShadingSettings;
}

export interface SessionContextType {
  sessions: Session[];
  activeSessions: Session[];
  currentSession: Session | null;
  recentSessions: Session[];

  // Actions
  createSession: (name: string) => Session;
  loadSession: (id: string) => void;
  reopenSession: (id: string) => void;
  closeSession: (id: string) => void;
  deleteSession: (id: string) => void;
  switchSession: (id: string) => void;

  // Document actions
  addDocuments: (sessionId: string, files: File[]) => Promise<void>;
  removeDocument: (sessionId: string, documentId: string) => void;
  processDocument: (sessionId: string, documentId: string) => Promise<void>;

  // Revert actions
  revertChange: (sessionId: string, documentId: string, changeId: string) => Promise<void>;
  revertAllChanges: (sessionId: string, documentId: string) => Promise<void>;

  // Stats
  updateSessionStats: (sessionId: string, stats: Partial<SessionStats>) => void;
  updateSessionName: (sessionId: string, name: string) => void;
  updateSessionOptions: (
    sessionId: string,
    processingOptions: Session['processingOptions']
  ) => void;
  updateSessionReplacements: (sessionId: string, replacements: ReplacementRule[]) => void;
  updateSessionStyles: (sessionId: string, styles: SessionStyle[]) => void;
  updateSessionListBulletSettings: (
    sessionId: string,
    listBulletSettings: ListBulletSettings
  ) => void;
  updateSessionTableUniformitySettings: (
    sessionId: string,
    tableUniformitySettings: TableUniformitySettings
  ) => void;
  updateSessionTableShadingSettings: (
    sessionId: string,
    tableShadingSettings: TableShadingSettings
  ) => void;
  updateSessionTableOfContentsSettings: (
    sessionId: string,
    tableOfContentsSettings: TableOfContentsSettings
  ) => void;

  // Persistence
  saveSession: (session: Session) => void;
  loadSessionFromStorage: (id: string) => Session | null;

  // Defaults management
  resetSessionToDefaults: (sessionId: string) => void;
  saveAsCustomDefaults: (sessionId: string) => void;
}

/**
 * Queue item for sequential document processing
 * Used by useDocumentQueue hook to process documents one at a time
 */
export interface QueueItem {
  documentId: string;
  sessionId: string;
  addedAt: Date;
  status: 'queued' | 'processing' | 'completed' | 'error';
}
