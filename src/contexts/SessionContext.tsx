import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Session, Document, SessionStats, SessionContextType } from '@/types/session';

const SessionContext = createContext<SessionContextType | undefined>(undefined);

type SerializedDocument = Omit<Document, 'processedAt'> & {
  processedAt?: string;
};

type SerializedSession = Omit<Session, 'createdAt' | 'lastModified' | 'documents'> & {
  createdAt: string;
  lastModified: string;
  documents: SerializedDocument[];
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);

  const loadSessionsFromStorage = () => {
    try {
      const storedSessions = localStorage.getItem('sessions');
      const storedActiveSessions = localStorage.getItem('activeSessions');
      if (storedSessions) {
        const parsed: SerializedSession[] = JSON.parse(storedSessions);
        const restored: Session[] = parsed.map((s) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          lastModified: new Date(s.lastModified),
          documents: s.documents.map((d) => ({
            ...d,
            processedAt: d.processedAt ? new Date(d.processedAt) : undefined,
          })),
        }));
        setSessions(restored);
        if (storedActiveSessions) {
          const activeIds: string[] = JSON.parse(storedActiveSessions);
          const active = restored.filter((s) => activeIds.includes(s.id));
          setActiveSessions(active);
          if (active.length > 0) {
            setCurrentSession(active[0]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load sessions from storage', err);
    }
  };

  // Load all sessions & active sessions from localStorage on mount
  useEffect(() => {
    loadSessionsFromStorage();
  }, []);

  // Persist sessions and active sessions whenever they change
  useEffect(() => {
    const serializedSessions: SerializedSession[] = sessions.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      lastModified: s.lastModified.toISOString(),
      documents: s.documents.map((d) => ({
        ...d,
        processedAt: d.processedAt ? d.processedAt.toISOString() : undefined,
      })),
    }));
    localStorage.setItem('sessions', JSON.stringify(serializedSessions));
    localStorage.setItem('activeSessions', JSON.stringify(activeSessions.map((s) => s.id)));
  }, [sessions, activeSessions]);

  const createSession = (name: string): Session => {
    const newSession: Session = {
      id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      createdAt: new Date(),
      lastModified: new Date(),
      documents: [],
      stats: {
        documentsProcessed: 0,
        hyperlinksChecked: 0,
        feedbackImported: 0,
        timeSaved: 0,
      },
      status: 'active',
    };

    setSessions((prev) => [...prev, newSession]);
    setActiveSessions((prev) => [...prev, newSession]);
    setCurrentSession(newSession);

    return newSession;
  };

  const loadSession = (id: string) => {
    const session = sessions.find((s) => s.id === id);
    if (session) {
      if (!activeSessions.find((s) => s.id === id)) {
        setActiveSessions((prev) => [...prev, session]);
      }
      setCurrentSession(session);
    }
  };

  const closeSession = (id: string) => {
    setActiveSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSession?.id === id) {
      const remaining = activeSessions.filter((s) => s.id !== id);
      setCurrentSession(remaining.length > 0 ? remaining[0] : null);
    }

    // Update session status
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: 'closed' as const, lastModified: new Date() } : s
      )
    );
  };

  const deleteSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSession?.id === id) {
      setCurrentSession(null);
    }
  };

  const switchSession = (id: string) => {
    const session = activeSessions.find((s) => s.id === id);
    if (session) {
      setCurrentSession(session);
    }
  };

  const addDocuments = (sessionId: string, files: File[]) => {
    const newDocuments: Document[] = files.map((file) => ({
      id: `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      // Use non-standard path if available (e.g., Electron), else webkitRelativePath (may be ''), else fallback to name
      path: (file as File & { path?: string }).path ?? (file.webkitRelativePath || file.name),
      size: file.size,
      status: 'pending' as const,
    }));

    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              documents: [...session.documents, ...newDocuments],
              lastModified: new Date(),
            }
          : session
      )
    );

    // Update active sessions
    setActiveSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              documents: [...session.documents, ...newDocuments],
              lastModified: new Date(),
            }
          : session
      )
    );
  };

  const removeDocument = (sessionId: string, documentId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              documents: session.documents.filter((d) => d.id !== documentId),
              lastModified: new Date(),
            }
          : session
      )
    );
  };

  const processDocument = async (sessionId: string, documentId: string): Promise<void> => {
    // Update document status to processing
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              documents: session.documents.map((d) =>
                d.id === documentId ? { ...d, status: 'processing' as const } : d
              ),
              lastModified: new Date(),
            }
          : session
      )
    );

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Update document status to completed and update stats
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              documents: session.documents.map((d) =>
                d.id === documentId
                  ? { ...d, status: 'completed' as const, processedAt: new Date() }
                  : d
              ),
              stats: {
                ...session.stats,
                documentsProcessed: session.stats.documentsProcessed + 1,
                hyperlinksChecked:
                  session.stats.hyperlinksChecked + Math.floor(Math.random() * 50) + 10,
                feedbackImported: session.stats.feedbackImported + Math.floor(Math.random() * 5),
                timeSaved: session.stats.timeSaved + Math.floor(Math.random() * 30) + 5,
              },
              lastModified: new Date(),
            }
          : session
      )
    );
  };

  const updateSessionStats = (sessionId: string, stats: Partial<SessionStats>) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              stats: { ...session.stats, ...stats },
              lastModified: new Date(),
            }
          : session
      )
    );
  };

  const updateSessionName = (sessionId: string, name: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              name,
              lastModified: new Date(),
            }
          : session
      )
    );

    // Update active sessions
    setActiveSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              name,
              lastModified: new Date(),
            }
          : session
      )
    );

    // Update current session if it's the one being renamed
    if (currentSession?.id === sessionId) {
      setCurrentSession((prev) => (prev ? { ...prev, name, lastModified: new Date() } : null));
    }
  };

  const saveSession = (session: Session) => {
    localStorage.setItem(`session_${session.id}`, JSON.stringify(session));
  };

  const loadSessionFromStorage = (id: string): Session | null => {
    const stored = localStorage.getItem(`session_${id}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        lastModified: new Date(parsed.lastModified),
      };
    }
    return null;
  };

  const recentSessions = sessions
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
    .slice(0, 5);

  return (
    <SessionContext.Provider
      value={{
        sessions,
        activeSessions,
        currentSession,
        recentSessions,
        createSession,
        loadSession,
        closeSession,
        deleteSession,
        switchSession,
        addDocuments,
        removeDocument,
        processDocument,
        updateSessionStats,
        updateSessionName,
        saveSession,
        loadSessionFromStorage,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
