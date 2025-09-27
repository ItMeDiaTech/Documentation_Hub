export interface Document {
  id: string;
  name: string;
  path: string;
  size: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  processedAt?: Date;
  errors?: string[];
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
  addDocuments: (sessionId: string, files: File[]) => void;
  removeDocument: (sessionId: string, documentId: string) => void;
  processDocument: (sessionId: string, documentId: string) => Promise<void>;

  // Stats
  updateSessionStats: (sessionId: string, stats: Partial<SessionStats>) => void;
  updateSessionName: (sessionId: string, name: string) => void;

  // Persistence
  saveSession: (session: Session) => void;
  loadSessionFromStorage: (id: string) => Session | null;
}
