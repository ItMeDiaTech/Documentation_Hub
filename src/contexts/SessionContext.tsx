import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Session, Document, SessionStats, SessionContextType } from '@/types/session';
import type { HyperlinkProcessingOptions, BatchProcessingOptions } from '@/types/hyperlink';

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
      // Re-open a closed session by adding it back to active sessions
      if (!activeSessions.find((s) => s.id === id)) {
        // Update status back to 'active' when loading
        const updatedSession = { ...session, status: 'active' as const, lastModified: new Date() };
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? updatedSession : s))
        );
        setActiveSessions((prev) => [...prev, updatedSession]);
        setCurrentSession(updatedSession);
      } else {
        setCurrentSession(session);
      }
    }
  };

  const closeSession = (id: string) => {
    // Remove from active sessions (sidebar) but keep in sessions list
    setActiveSessions((prev) => prev.filter((s) => s.id !== id));

    // Switch to another active session if closing current one
    if (currentSession?.id === id) {
      const remaining = activeSessions.filter((s) => s.id !== id);
      setCurrentSession(remaining.length > 0 ? remaining[0] : null);
    }

    // Update session status to 'closed' but keep in sessions list for history
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: 'closed' as const, lastModified: new Date() } : s
      )
    );
  };

  const deleteSession = (id: string) => {
    // Permanently delete session from storage
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSession?.id === id) {
      setCurrentSession(null);
    }

    // Also remove individual session from localStorage if it exists
    localStorage.removeItem(`session_${id}`);
  };

  const switchSession = (id: string) => {
    const session = activeSessions.find((s) => s.id === id);
    if (session) {
      setCurrentSession(session);
    }
  };

  const addDocuments = async (sessionId: string, files: File[]) => {
    // Convert files to documents
    const newDocuments: Document[] = await Promise.all(
      files.map(async (file) => {
        const fileWithPath = file as File & { path?: string };

        // Check if this is an Electron file with just a path (no arrayBuffer method)
        if (fileWithPath.path && typeof file.arrayBuffer !== 'function') {
          // For Electron native dialog files, just use the path
          return {
            id: `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            path: fileWithPath.path,
            size: file.size || 0,
            type: file.type,
            status: 'pending' as const,
            // No fileData - will be read by backend using the path
          };
        }

        // For real File objects (e.g., from drag & drop), read ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        return {
          id: `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          path: fileWithPath.path ?? (file.webkitRelativePath || file.name),
          size: file.size,
          type: file.type,
          status: 'pending' as const,
          // Store the ArrayBuffer data for web-based processing
          fileData: arrayBuffer,
        };
      })
    );

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
    const session = sessions.find((s) => s.id === sessionId);
    const document = session?.documents.find((d) => d.id === documentId);

    if (!session || !document || !document.path) {
      console.error('Session, document, or document path not found');
      return;
    }

    // Update document status to processing
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              documents: s.documents.map((d) =>
                d.id === documentId ? { ...d, status: 'processing' as const } : d
              ),
              lastModified: new Date(),
            }
          : s
      )
    );

    try {
      // Get user settings from localStorage
      const userSettings = localStorage.getItem('userSettings');
      const settings = userSettings ? JSON.parse(userSettings) : { apiConnections: { powerAutomateUrl: '' } };

      console.log('Processing document with PowerAutomate URL:', settings.apiConnections.powerAutomateUrl);

      // Convert session processing options to hyperlink processing options
      const processingOptions: HyperlinkProcessingOptions = {
        apiEndpoint: settings.apiConnections.powerAutomateUrl || '',
        operations: {
          fixContentIds: session.processingOptions?.enabledOperations?.includes('fix-content-ids'),
          updateTitles: session.processingOptions?.enabledOperations?.includes('replace-outdated-titles'),
          fixInternalHyperlinks: session.processingOptions?.enabledOperations?.includes('fix-internal-hyperlinks'),
          updateTopHyperlinks: session.processingOptions?.enabledOperations?.includes('update-top-hyperlinks'),
          updateTocHyperlinks: session.processingOptions?.enabledOperations?.includes('update-toc-hyperlinks'),
        },
        textReplacements: session.replacements?.filter(r => r.enabled) || [],
        styles: session.styles || {},
      };

      // Process the document using Electron IPC
      const result = await window.electronAPI.processHyperlinkDocument(
        document.path,
        processingOptions
      );

      // Update document status and stats
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                documents: s.documents.map((d) =>
                  d.id === documentId
                    ? {
                        ...d,
                        status: result.success ? ('completed' as const) : ('error' as const),
                        processedAt: new Date(),
                        errors: result.errorMessages,
                        processingResult: {
                          hyperlinksProcessed: result.processedHyperlinks,
                          hyperlinksModified: result.modifiedHyperlinks,
                          contentIdsAppended: result.appendedContentIds || result.processedHyperlinks,
                          duration: result.duration,
                          changes: result.processedLinks?.map((change) => ({
                            type: 'hyperlink',
                            description: `Updated ${change.displayText || 'hyperlink'}`,
                            before: change.before,
                            after: change.after
                          }))
                        },
                      }
                    : d
                ),
                stats: {
                  ...s.stats,
                  documentsProcessed: s.stats.documentsProcessed + (result.success ? 1 : 0),
                  hyperlinksChecked: s.stats.hyperlinksChecked + result.totalHyperlinks,
                  feedbackImported: s.stats.feedbackImported,
                  timeSaved: s.stats.timeSaved + Math.round((result.totalHyperlinks * 101) / 60),
                },
                lastModified: new Date(),
              }
            : s
        )
      );
    } catch (error) {
      console.error('Error processing document:', error);

      // Update document status to error
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                documents: s.documents.map((d) =>
                  d.id === documentId
                    ? {
                        ...d,
                        status: 'error' as const,
                        errors: [error instanceof Error ? error.message : 'Processing failed'],
                      }
                    : d
                ),
                lastModified: new Date(),
              }
            : s
        )
      );
    }
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

  const updateSessionOptions = (sessionId: string, processingOptions: Session['processingOptions']) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              processingOptions,
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
              processingOptions,
              lastModified: new Date(),
            }
          : session
      )
    );

    // Update current session if it's being modified
    if (currentSession?.id === sessionId) {
      setCurrentSession((prev) => (prev ? { ...prev, processingOptions, lastModified: new Date() } : null));
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
        updateSessionOptions,
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
