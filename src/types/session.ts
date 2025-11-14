export interface Document {
  id: string;
  name: string;
  path?: string;
  size: number;
  type?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  processedAt?: Date;
  errors?: string[];
  fileData?: ArrayBuffer; // Store file data for processing
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
    appendContentId: boolean;
    contentIdToAppend: string;
    validateUrls: boolean;
    createBackup: boolean;
    processInternalLinks: boolean;
    processExternalLinks: boolean;
    enabledOperations: string[];
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
  includeHeadingLevels: number[]; // e.g., [1, 2, 3]
  showPageNumbers: boolean;
  rightAlignPageNumbers: boolean;
  useHyperlinks: boolean;
  tabLeaderStyle: 'none' | 'dots' | 'dashes' | 'underline';
  tocTitle: string;
  showTocTitle: boolean; // Option to turn off TOC title display
  spacingBetweenHyperlinks: number; // in points
}

export interface TableShadingSettings {
  header2Shading: string; // Hex color for Header 2 / 1x1 table cells (default: #BFBFBF)
  otherShading: string; // Hex color for other table cells (default: #E9E9E9)
}

export interface ReplacementRule {
  id: string;
  enabled: boolean;
  type: 'hyperlink' | 'text';
  pattern: string;
  replacement: string;
  caseSensitive?: boolean;
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
}
