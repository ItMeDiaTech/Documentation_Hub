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
  };
}

export interface DocumentChange {
  type: 'hyperlink' | 'text' | 'style' | 'structure';
  description: string;
  before?: string;
  after?: string;
  count?: number;
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
  // Replacement rules
  replacements?: ReplacementRule[];
}

export interface SessionStyle {
  name: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  alignment: 'left' | 'center' | 'right' | 'justify';
  color: string;
  spacingBefore: number;
  spacingAfter: number;
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
  closeSession: (id: string) => void;
  deleteSession: (id: string) => void;
  switchSession: (id: string) => void;

  // Document actions
  addDocuments: (sessionId: string, files: File[]) => Promise<void>;
  removeDocument: (sessionId: string, documentId: string) => void;
  processDocument: (sessionId: string, documentId: string) => Promise<void>;

  // Stats
  updateSessionStats: (sessionId: string, stats: Partial<SessionStats>) => void;
  updateSessionName: (sessionId: string, name: string) => void;
  updateSessionOptions: (sessionId: string, processingOptions: Session['processingOptions']) => void;

  // Persistence
  saveSession: (session: Session) => void;
  loadSessionFromStorage: (id: string) => Session | null;
}
