import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { Session, Document, SessionStats, SessionContextType, ReplacementRule, SessionStyle, ListBulletSettings, TableUniformitySettings } from '@/types/session';
import type { HyperlinkProcessingOptions } from '@/types/hyperlink';
import {
  loadSessions,
  saveSession as saveSessionToDB,
  deleteSession as deleteSessionFromDB,
  migrateFromLocalStorage,
  ensureDBSizeLimit,
  truncateSessionChanges,
  handleQuotaExceededError
} from '@/utils/indexedDB';
import { useGlobalStats } from './GlobalStatsContext';
import { logger } from '@/utils/logger';
import { safeJsonParse, safeJsonStringify } from '@/utils/safeJsonParse';
import { isPathSafe } from '@/utils/pathSecurity';

const SessionContext = createContext<SessionContextType | undefined>(undefined);

type SerializedDocument = Omit<Document, 'processedAt'> & {
  processedAt?: string;
};

type SerializedSession = Omit<Session, 'createdAt' | 'lastModified' | 'closedAt' | 'documents'> & {
  createdAt: string;
  lastModified: string;
  closedAt?: string;
  documents: SerializedDocument[];
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const log = logger.namespace('SessionContext');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const { updateStats: updateGlobalStats } = useGlobalStats();

  // Ref to store debounce timer
  const persistTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Ref to store latest sessions for persistence
  const sessionsRef = useRef(sessions);
  const activeSessionsRef = useRef(activeSessions);
  // RACE CONDITION FIX: Flag to prevent double-loading sessions
  // Prevents re-running loadSessionsFromStorage if component re-mounts
  const hasLoadedRef = useRef(false);

  const loadSessionsFromStorage = useCallback(async () => {
    // RACE CONDITION FIX: Prevent double-loading if already loaded
    if (hasLoadedRef.current) {
      log.warn('[Session] loadSessionsFromStorage called but already loaded - skipping to prevent race condition');
      return;
    }

    hasLoadedRef.current = true;

    try {
      // CRITICAL RECOVERY: Check for emergency backup from beforeunload
      // This recovers data that may not have been saved to IndexedDB before app close
      const emergencyBackup = localStorage.getItem('sessions_emergency_backup');
      if (emergencyBackup) {
        log.warn('[Session] Found emergency backup - attempting recovery...');
        try {
          const backup = safeJsonParse<{
            sessions: SerializedSession[];
            activeSessions: SerializedSession[];
            timestamp: number;
            reason: string;
          } | null>(emergencyBackup, null, 'SessionContext.emergencyRecover');

          if (backup && backup.sessions && backup.timestamp) {
            const backupAge = Date.now() - backup.timestamp;
            const backupAgeMinutes = Math.floor(backupAge / 60000);

            log.info(`[Session] Emergency backup is ${backupAgeMinutes} minutes old`);

            // Only restore if backup is recent (< 5 minutes old)
            // Older backups are likely stale and shouldn't override IndexedDB
            if (backupAge < 5 * 60 * 1000) {
              log.info(`[Session] Restoring ${backup.sessions.length} sessions from emergency backup`);

              // Save backup sessions to IndexedDB immediately
              // backup.sessions is already in SerializedSession format (strings for dates)
              for (const session of backup.sessions) {
                await saveSessionToDB(session).catch(err =>
                  log.error(`Failed to restore session ${session.id}:`, err)
                );
              }

              log.info('[Session] Emergency backup successfully restored to IndexedDB');
            } else {
              log.info('[Session] Emergency backup too old - using IndexedDB instead');
            }
          }

          // Clear emergency backup after processing (successful or not)
          localStorage.removeItem('sessions_emergency_backup');
        } catch (err) {
          log.error('[Session] Failed to restore emergency backup:', err);
          // Clear corrupted backup
          localStorage.removeItem('sessions_emergency_backup');
        }
      }

      // Check if localStorage has sessions that need migration
      const hasLocalStorageSessions = localStorage.getItem('sessions');
      if (hasLocalStorageSessions) {
        log.info('[Session] Found sessions in localStorage, migrating to IndexedDB...');
        await migrateFromLocalStorage();
        // Clear localStorage after migration
        localStorage.removeItem('sessions');
        localStorage.removeItem('activeSessions');
      }

      // Load sessions from IndexedDB
      const storedSessions = await loadSessions();
      const storedActiveSessions = localStorage.getItem('activeSessions');

      if (storedSessions && storedSessions.length > 0) {
        const parsed: SerializedSession[] = storedSessions;
        const restored: Session[] = parsed.map((s) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          lastModified: new Date(s.lastModified),
          closedAt: s.closedAt ? new Date(s.closedAt) : undefined,
          documents: s.documents.map((d) => ({
            ...d,
            processedAt: d.processedAt ? new Date(d.processedAt) : undefined,
          })),
        }));

        // Clean up sessions older than 30 days (only if closed)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const cleanedSessions = restored.filter((s) => {
          // Keep all active sessions
          if (s.status === 'active') return true;

          // For closed sessions, check if they're older than 30 days
          if (s.status === 'closed' && s.closedAt) {
            const shouldKeep = s.closedAt > thirtyDaysAgo;
            if (!shouldKeep) {
              // Remove from IndexedDB as well
              deleteSessionFromDB(s.id).catch(err =>
                log.error(`Failed to delete old session ${s.id}:`, err)
              );
            }
            return shouldKeep;
          }

          // Keep sessions without closedAt (shouldn't happen, but be safe)
          return true;
        });

        // Log cleanup if any sessions were removed
        const removedCount = restored.length - cleanedSessions.length;
        if (removedCount > 0) {
          log.info(`[Session] Cleaned up ${removedCount} old session(s) (>30 days)`);
        }

        setSessions(cleanedSessions);
        if (storedActiveSessions) {
          const activeIds = safeJsonParse<string[]>(
            storedActiveSessions,
            [],
            'SessionContext.activeSessions'
          );
          const active = cleanedSessions.filter((s) => activeIds.includes(s.id));
          setActiveSessions(active);
          if (active.length > 0) {
            setCurrentSession(active[0]);
          }
        }
      }
    } catch (err) {
      log.error('Failed to load sessions from storage', err);
    }
  }, [log]); // Memoize with log dependency

  // Load all sessions & active sessions from localStorage on mount
  // CRITICAL: Only run ONCE on mount - do NOT reload when dependencies change
  // Re-loading after mount causes race conditions where new data gets overwritten
  useEffect(() => {
    loadSessionsFromStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - ONLY run on mount

  // Update refs when sessions change
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeSessionsRef.current = activeSessions;
  }, [activeSessions]);

  // Debounced persist function to reduce database writes
  // PERFORMANCE: Debounces by 1 second to batch rapid state updates
  // Using refs to access latest state without causing dependency issues
  const debouncedPersistSessions = useCallback(async () => {
    try {
      // Critical: Ensure database size limit to prevent quota exceeded errors
      await ensureDBSizeLimit(200); // 200MB limit

      // Use refs to get latest state values
      const currentSessions = sessionsRef.current;
      const currentActiveSessions = activeSessionsRef.current;

      const serializedSessions: SerializedSession[] = currentSessions.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        lastModified: s.lastModified.toISOString(),
        closedAt: s.closedAt ? s.closedAt.toISOString() : undefined,
        documents: s.documents.map((d) => ({
          ...d,
          processedAt: d.processedAt ? d.processedAt.toISOString() : undefined,
        })),
      }));

      // Save each session to IndexedDB with quota error recovery
      for (const session of serializedSessions) {
        // Truncate large change arrays to prevent excessive storage
        const truncatedSession = truncateSessionChanges(session, 100);

        // Use quota error handler for automatic recovery if needed
        await handleQuotaExceededError(
          async () => saveSessionToDB(truncatedSession),
          session.id
        );
      }

      // Keep active sessions in localStorage for quick access
      const activeSessionIds = safeJsonStringify(
        currentActiveSessions.map((s) => s.id),
        undefined,
        'SessionContext.saveActiveSessions'
      );
      if (activeSessionIds) {
        localStorage.setItem('activeSessions', activeSessionIds);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('DATABASE_QUOTA_EXCEEDED')) {
        // User should be notified about quota issues - this should trigger a UI notification
        log.error('Database quota exceeded - archive old sessions or export data to free up space', err);
      } else {
        log.error('Failed to persist sessions:', err);
      }
    }
  }, []); // No dependencies - uses refs instead

  // Persist sessions and active sessions whenever they change (debounced)
  useEffect(() => {
    if (sessions.length > 0) {
      // Clear existing timer
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }

      // PERFORMANCE FIX: Increased debounce from 1s to 3s for better UI responsiveness
      // This reduces database writes during active editing (drag-drop, processing, etc.)
      // and makes the UI feel much snappier
      persistTimerRef.current = setTimeout(() => {
        debouncedPersistSessions();
      }, 3000); // 3 second debounce
    }

    // Cleanup on unmount
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null; // Clear the ref
      }
    };
  }, [sessions, activeSessions]); // FIX: Removed debouncedPersistSessions - it's stable so doesn't need to be a dependency

  // CRITICAL FIX: Flush pending saves before window closes
  // Without this, sessions created/modified within the debounce window are lost
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Cancel the debounce timer
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }

      // Immediately save all sessions (synchronous)
      // Note: This must be synchronous - async operations may not complete before unload
      const currentSessions = sessionsRef.current;
      const currentActiveSessions = activeSessionsRef.current;

      if (currentSessions.length > 0) {
        log.info('[beforeunload] Flushing pending session saves...');

        // Save active session IDs to localStorage (synchronous)
        const activeSessionIds = safeJsonStringify(
          currentActiveSessions.map((s) => s.id),
          undefined,
          'SessionContext.beforeunload'
        );
        if (activeSessionIds) {
          localStorage.setItem('activeSessions', activeSessionIds);
        }

        // CRITICAL DATA LOSS FIX: Add emergency backup to localStorage
        // This ensures data is preserved even if the async IndexedDB save doesn't complete
        // before window closes (within the 3-second debounce window)
        try {
          // Helper function to serialize Session to SerializedSession
          const serializeSession = (session: Session): SerializedSession => ({
            ...session,
            createdAt: session.createdAt.toISOString(),
            lastModified: session.lastModified.toISOString(),
            closedAt: session.closedAt?.toISOString(),
            documents: session.documents.map(doc => ({
              ...doc,
              processedAt: doc.processedAt?.toISOString()
            }))
          });

          const emergencyBackup = safeJsonStringify(
            {
              sessions: currentSessions.map(serializeSession),
              activeSessions: currentActiveSessions.map(serializeSession),
              timestamp: Date.now(),
              reason: 'beforeunload_emergency_backup'
            },
            undefined,
            'SessionContext.emergencyBackup'
          );

          if (emergencyBackup) {
            localStorage.setItem('sessions_emergency_backup', emergencyBackup);
            log.info('[beforeunload] Emergency backup saved to localStorage');
          }
        } catch (error) {
          // Silent fail - localStorage might be full or disabled
          log.error('[beforeunload] Failed to create emergency backup:', error);
        }

        // Trigger the async save (may not complete, but we try)
        debouncedPersistSessions().catch((error) => {
          log.error('[beforeunload] Failed to flush sessions:', error);
        });
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [debouncedPersistSessions, log]);

  const createSession = (name: string): Session => {
    const newSession: Session = {
      id: `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
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

    // CRITICAL FIX: Immediately persist new session to prevent loss
    // Don't wait for 3-second debounce - save right away
    const serializedSession: SerializedSession = {
      ...newSession,
      createdAt: newSession.createdAt.toISOString(),
      lastModified: newSession.lastModified.toISOString(),
      closedAt: undefined, // New sessions are always active
      documents: [],
    };

    // Fire-and-forget immediate save
    saveSessionToDB(serializedSession).catch((error) => {
      log.error(`[createSession] Failed to immediately save session "${name}":`, error);
    });

    log.info(`[createSession] Created and immediately saved session: ${name} (${newSession.id})`);

    return newSession;
  };

  const loadSession = (id: string) => {
    const session = sessions.find((s) => s.id === id);
    if (session) {
      // Only load if session is already active or explicitly reopening
      if (activeSessions.find((s) => s.id === id)) {
        // Session is already active, just switch to it
        setCurrentSession(session);
      } else if (session.status === 'closed') {
        // CRITICAL FIX: Don't auto-reopen closed sessions
        // User must explicitly reopen via reopenSession() or the Sessions page
        log.warn(`[loadSession] Attempted to load closed session: ${id}. Use reopenSession() instead.`);
        return; // EXIT without reopening
      } else {
        // Session exists but not in active list (shouldn't happen, but handle gracefully)
        setActiveSessions((prev) => [...prev, session]);
        setCurrentSession(session);
      }
    }
  };

  const reopenSession = (id: string) => {
    const session = sessions.find((s) => s.id === id);
    if (session && session.status === 'closed') {
      // Explicitly reopen a closed session
      const updatedSession = { ...session, status: 'active' as const, lastModified: new Date() };
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? updatedSession : s))
      );
      setActiveSessions((prev) => [...prev, updatedSession]);
      setCurrentSession(updatedSession);

      log.info(`[reopenSession] Reopened session: ${session.name}`);
    }
  };

  const closeSession = (id: string) => {
    // Get session info for logging
    const session = sessions.find((s) => s.id === id);
    const closedAt = new Date();

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
        s.id === id ? { ...s, status: 'closed' as const, lastModified: new Date(), closedAt } : s
      )
    );

    // Log session closure
    if (session) {
      log.info('[Session] Closed:', {
        id: session.id,
        name: session.name,
        closedAt: closedAt.toISOString(),
        documentsProcessed: session.documents.length,
      });
    }
  };

  const deleteSession = (id: string) => {
    // Get session info for logging before deletion
    const session = sessions.find((s) => s.id === id);

    // Permanently delete session from storage
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveSessions((prev) => prev.filter((s) => s.id !== id));
    if (currentSession?.id === id) {
      setCurrentSession(null);
    }

    // Also remove individual session from localStorage if it exists
    localStorage.removeItem(`session_${id}`);

    // Log session deletion
    if (session) {
      log.info('[Session] Deleted:', {
        id: session.id,
        name: session.name,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
      });
    }
  };

  const switchSession = (id: string) => {
    const session = activeSessions.find((s) => s.id === id);
    if (session) {
      setCurrentSession(session);
    }
  };

  const addDocuments = async (sessionId: string, files: File[]) => {
    // Convert files to documents with strict validation
    const newDocuments: Document[] = [];
    const invalidFiles: Array<{ name: string; reason: string }> = [];

    log.info(`[addDocuments] Processing ${files.length} file(s) for session ${sessionId}`);

    for (const file of files) {
      const fileWithPath = file as File & { path?: string };

      // Log detailed file information for debugging
      log.debug(`[addDocuments] File: "${file.name}"`, {
        path: fileWithPath.path,
        size: file.size,
        type: file.type,
        hasPathProperty: 'path' in file,
        pathValue: fileWithPath.path,
      });

      // STRICT VALIDATION: Only accept files with valid filesystem paths
      // This is critical for Electron processing which requires absolute paths
      if (!fileWithPath.path || fileWithPath.path.trim() === '') {
        const reason = 'No file path provided';
        log.error(`[addDocuments] File "${file.name}" rejected: ${reason}`);
        invalidFiles.push({ name: file.name, reason });
        continue;
      }

      // Enhanced security validation with path traversal protection
      // Check for .docx/.doc extensions and security threats
      if (!isPathSafe(fileWithPath.path, ['.docx', '.doc'])) {
        const reason = `Failed security validation for path: "${fileWithPath.path}"`;
        log.error(`[addDocuments] File "${file.name}" rejected: ${reason}`);
        invalidFiles.push({ name: file.name, reason });
        continue;
      }

      // Create document with validated path
      newDocuments.push({
        id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        name: file.name,
        path: fileWithPath.path,
        size: file.size || 0,
        type: file.type,
        status: 'pending' as const,
        // No fileData - will be read by backend using the path
      });
    }

    // Log detailed results
    if (invalidFiles.length > 0) {
      log.warn(`[addDocuments] Rejected ${invalidFiles.length} file(s):`);
      invalidFiles.forEach(({ name, reason }) => {
        log.warn(`  - ${name}: ${reason}`);
      });
    }
    if (newDocuments.length > 0) {
      log.info(`[addDocuments] ✅ Successfully added ${newDocuments.length} valid document(s)`);
      newDocuments.forEach(doc => {
        log.debug(`  ✓ ${doc.name} (${doc.size} bytes)`);
      });
    }

    // Only update state if we have valid documents
    if (newDocuments.length === 0) {
      log.error('[addDocuments] ❌ No valid documents to add - all files were rejected');
      return;
    }

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

  // PERFORMANCE FIX: Wrap in useCallback to prevent child component re-renders
  // This is critical for StylesEditor and other components that depend on this function
  const processDocument = useCallback(async (sessionId: string, documentId: string): Promise<void> => {
    const session = sessions.find((s) => s.id === sessionId);
    const document = session?.documents.find((d) => d.id === documentId);

    if (!session || !document || !document.path) {
      log.error('Session, document, or document path not found');
      return;
    }

    // PERFORMANCE: Update document status to processing (first setState)
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
      const settings = safeJsonParse<any>(
        userSettings,
        { apiConnections: { powerAutomateUrl: '' } },
        'SessionContext.processDocument.userSettings'
      );

      log.debug('Processing document with PowerAutomate URL:', settings.apiConnections.powerAutomateUrl);

      // Convert session processing options to hyperlink processing options
      // Extract style spacing from session styles
      log.debug('\n=== SESSION CONTEXT: Extracting Style Spacing ===');
      log.debug('session.styles:', session.styles);

      // Default style spacing (applied when session.styles is undefined/empty)
      const defaultStyleSpacing = {
        header1: {
          spaceBefore: 0,
          spaceAfter: 12,
          lineSpacing: 1.0
        },
        header2: {
          spaceBefore: 6,
          spaceAfter: 6,
          lineSpacing: 1.0
        },
        normal: {
          spaceBefore: 3,
          spaceAfter: 3,
          lineSpacing: 1.15
        }
      };

      // Check if session has configured styles
      const hasSessionStyles = session.styles && session.styles.length > 0;

      if (!hasSessionStyles) {
        log.debug('⚠️  No styles configured in session - using default spacing values');
        log.debug('   Default Header 1: 0pt before, 12pt after, 1.0 line spacing');
        log.debug('   Default Header 2: 6pt before, 6pt after, 1.0 line spacing');
        log.debug('   Default Normal: 3pt before, 3pt after, 1.15 line spacing');
      }

      const header1Style = session.styles?.find((s: SessionStyle) => s.id === 'header1');
      const header2Style = session.styles?.find((s: SessionStyle) => s.id === 'header2');
      const normalStyle = session.styles?.find((s: SessionStyle) => s.id === 'normal');

      log.debug('Found header1Style:', header1Style);
      log.debug('Found header2Style:', header2Style);
      log.debug('Found normalStyle:', normalStyle);

      // Define custom style spacing with proper type structure
      interface CustomStyleSpacing {
        header1?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
        header2?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
        normal?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number; noSpaceBetweenSame?: boolean };
      }
      const customStyleSpacing: CustomStyleSpacing = {};

      // Header 1 spacing (use session style or default)
      if (header1Style && (header1Style.spaceBefore !== undefined || header1Style.spaceAfter !== undefined || header1Style.lineSpacing !== undefined)) {
        customStyleSpacing.header1 = {
          spaceBefore: header1Style.spaceBefore ?? 0,
          spaceAfter: header1Style.spaceAfter ?? 0,
          lineSpacing: header1Style.lineSpacing ?? 1.0
        };
        log.debug('✓ Added header1 spacing from session:', customStyleSpacing.header1);
      } else if (!hasSessionStyles) {
        customStyleSpacing.header1 = defaultStyleSpacing.header1;
        log.debug('✓ Added header1 spacing from defaults:', customStyleSpacing.header1);
      }

      // Header 2 spacing (use session style or default)
      if (header2Style && (header2Style.spaceBefore !== undefined || header2Style.spaceAfter !== undefined || header2Style.lineSpacing !== undefined)) {
        customStyleSpacing.header2 = {
          spaceBefore: header2Style.spaceBefore ?? 0,
          spaceAfter: header2Style.spaceAfter ?? 0,
          lineSpacing: header2Style.lineSpacing ?? 1.0
        };
        log.debug('✓ Added header2 spacing from session:', customStyleSpacing.header2);
      } else if (!hasSessionStyles) {
        customStyleSpacing.header2 = defaultStyleSpacing.header2;
        log.debug('✓ Added header2 spacing from defaults:', customStyleSpacing.header2);
      }

      // Normal spacing (use session style or default)
      if (normalStyle && (normalStyle.spaceBefore !== undefined || normalStyle.spaceAfter !== undefined || normalStyle.lineSpacing !== undefined)) {
        customStyleSpacing.normal = {
          spaceBefore: normalStyle.spaceBefore ?? 0,
          spaceAfter: normalStyle.spaceAfter ?? 0,
          lineSpacing: normalStyle.lineSpacing ?? 1.15
        };
        log.debug('✓ Added normal spacing from session:', customStyleSpacing.normal);
      } else if (!hasSessionStyles) {
        customStyleSpacing.normal = defaultStyleSpacing.normal;
        log.debug('✓ Added normal spacing from defaults:', customStyleSpacing.normal);
      }

      log.debug('Final customStyleSpacing object:', customStyleSpacing);
      log.debug('Will pass to processor:', Object.keys(customStyleSpacing).length > 0 ? customStyleSpacing : undefined);

      const processingOptions: HyperlinkProcessingOptions & {
        // Text Formatting Options
        removeWhitespace?: boolean;
        removeParagraphLines?: boolean;
        removeItalics?: boolean;

        // Content Structure Options
        assignStyles?: boolean;
        centerImages?: boolean;

        // Lists & Tables Options
        listBulletSettings?: ListBulletSettings;
        bulletUniformity?: boolean;
        tableUniformity?: boolean;

        // Legacy
        tableUniformitySettings?: TableUniformitySettings;
      } = {
        apiEndpoint: settings.apiConnections.powerAutomateUrl || '',

        // Hyperlink Operations (operations object)
        operations: {
          fixContentIds: session.processingOptions?.enabledOperations?.includes('fix-content-ids'),
          updateTitles: session.processingOptions?.enabledOperations?.includes('replace-outdated-titles'),
          replaceOutdatedTitles: session.processingOptions?.enabledOperations?.includes('replace-outdated-titles'), // Same flag, standalone fallback
          fixInternalHyperlinks: session.processingOptions?.enabledOperations?.includes('fix-internal-hyperlinks'),
          updateTopHyperlinks: session.processingOptions?.enabledOperations?.includes('update-top-hyperlinks'),
          updateTocHyperlinks: session.processingOptions?.enabledOperations?.includes('update-toc-hyperlinks'),
          fixKeywords: session.processingOptions?.enabledOperations?.includes('fix-keywords'),
          standardizeHyperlinkColor: session.processingOptions?.enabledOperations?.includes('standardize-hyperlink-color'),
        },

        // Text replacements and styles
        textReplacements: session.replacements?.filter(r => r.enabled) || [],
        styles: session.styles || {},
        customStyleSpacing: Object.keys(customStyleSpacing).length > 0 ? customStyleSpacing : undefined,

        // Text Formatting Options (mapped from ProcessingOptions UI)
        removeWhitespace: session.processingOptions?.enabledOperations?.includes('remove-whitespace'),
        removeParagraphLines: session.processingOptions?.enabledOperations?.includes('remove-paragraph-lines'),
        removeItalics: session.processingOptions?.enabledOperations?.includes('remove-italics'),

        // Content Structure Options (mapped from ProcessingOptions UI)
        assignStyles: session.processingOptions?.enabledOperations?.includes('assign-styles'),
        centerImages: session.processingOptions?.enabledOperations?.includes('center-images'),

        // Lists & Tables Options (mapped from ProcessingOptions UI)
        listBulletSettings: session.processingOptions?.enabledOperations?.includes('list-indentation')
          ? session.listBulletSettings
          : undefined,
        bulletUniformity: session.processingOptions?.enabledOperations?.includes('bullet-uniformity'),
        tableUniformity: session.processingOptions?.enabledOperations?.includes('table-uniformity'),

        // Legacy (deprecated, kept for backwards compatibility)
        tableUniformitySettings: session.tableUniformitySettings,
      };

      // Process the document using Electron IPC
      const result = await window.electronAPI.processHyperlinkDocument(
        document.path,
        processingOptions
      );

      // PERFORMANCE: Update document status AND stats in single setState (batched)
      // This reduces re-renders from 2 to 1 per document
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
                          // Map processedLinks to DocumentChange format with enhanced descriptions
                          changes: (result.processedLinks || []).map((link: { id?: string; url?: string; displayText?: string; modifications?: string[]; before?: string; after?: string }, idx: number) => {
                            // Determine change type and enhance description
                            let changeType: 'hyperlink' | 'text' | 'style' | 'structure' | 'table' | 'deletion' = 'hyperlink';
                            let enhancedDescription = link.modifications?.join(', ') || 'Change applied';

                            // Enhance description based on the modification type
                            if (link.modifications?.includes('Content ID appended')) {
                              enhancedDescription = 'Content ID appended to hyperlink';
                              changeType = 'hyperlink';
                            } else if (link.modifications?.includes('URL updated')) {
                              enhancedDescription = 'Hyperlink URL updated';
                              changeType = 'hyperlink';
                            } else if (link.modifications?.includes('Display text updated')) {
                              enhancedDescription = 'Hyperlink display text updated';
                              changeType = 'text';
                            }

                            // Special case for invisible hyperlinks
                            if (!link.displayText || link.displayText.trim() === '') {
                              if (link.modifications?.includes('deletion')) {
                                enhancedDescription = 'Invisible hyperlink deleted';
                                changeType = 'deletion';
                              }
                            }

                            return {
                              id: link.id || `change-${idx}`,
                              type: changeType,
                              description: enhancedDescription,
                              before: link.before || link.url || '',
                              after: link.after || link.url || '',
                              count: 1,
                            };
                          }),
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

      // Update global stats if processing was successful
      if (result.success) {
        await updateGlobalStats({
          documentsProcessed: 1,
          hyperlinksChecked: result.totalHyperlinks,
          timeSaved: Math.round((result.totalHyperlinks * 101) / 60),
        });

        // Enhanced success logging for user visibility
        log.info('═══════════════════════════════════════════════════════════');
        log.info('✅ DOCUMENT PROCESSING COMPLETE');
        log.info('═══════════════════════════════════════════════════════════');
        log.info(`📄 Document: ${document.name}`);
        log.info(`📁 Location: ${document.path}`);
        log.info(`🔗 Hyperlinks Processed: ${result.totalHyperlinks}`);
        log.info(`✏️  Hyperlinks Modified: ${result.modifiedHyperlinks}`);
        log.info(`⏱️  Time Saved: ${Math.round((result.totalHyperlinks * 101) / 60)} seconds`);
        log.info('');
        log.info('💡 Next Steps:');
        log.info('   • Click the green "Open Document" button to view in Word');
        log.info('   • Or click "Open Location" to view in File Explorer');
        log.info('═══════════════════════════════════════════════════════════');
      }
    } catch (error) {
      log.error('Error processing document:', error);

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
  }, [sessions, log, updateGlobalStats]); // Dependencies: sessions for finding docs, log for logging, updateGlobalStats for stats


  const revertChange = async (sessionId: string, documentId: string, changeId: string): Promise<void> => {
    const session = sessions.find((s) => s.id === sessionId);
    const document = session?.documents.find((d) => d.id === documentId);

    if (!session || !document) {
      log.error('Session or document not found');
      return;
    }

    // Remove the change from the tracked changes list
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              documents: s.documents.map((d) =>
                d.id === documentId && d.processingResult
                  ? {
                      ...d,
                      processingResult: {
                        ...d.processingResult,
                        changes: d.processingResult.changes?.filter(c => c.id !== changeId) || []
                      }
                    }
                  : d
              ),
              lastModified: new Date(),
            }
          : s
      )
    );

    log.info(`[Session] Reverted change ${changeId} from document ${documentId}`);
  };

  const revertAllChanges = async (sessionId: string, documentId: string): Promise<void> => {
    const session = sessions.find((s) => s.id === sessionId);
    const document = session?.documents.find((d) => d.id === documentId);

    if (!session || !document || !document.path) {
      log.error('Session, document, or document path not found');
      return;
    }

    const backupPath = document.processingResult?.backupPath;
    if (!backupPath) {
      log.error('No backup path found for document');
      throw new Error('No backup available for this document');
    }

    try {
      // Call Electron IPC to restore from backup
      await window.electronAPI.restoreFromBackup(backupPath, document.path);

      // Clear all tracked changes and reset processing status
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                documents: s.documents.map((d) =>
                  d.id === documentId
                    ? {
                        ...d,
                        status: 'pending' as const,
                        processedAt: undefined,
                        errors: undefined,
                        processingResult: undefined
                      }
                    : d
                ),
                lastModified: new Date(),
              }
            : s
        )
      );

      log.info(`[Session] Reverted all changes for document ${documentId} from backup ${backupPath}`);
    } catch (error) {
      log.error('Error reverting all changes:', error);
      throw error;
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

  const updateSessionReplacements = (sessionId: string, replacements: ReplacementRule[]) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              replacements,
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
              replacements,
              lastModified: new Date(),
            }
          : session
      )
    );

    // Update current session if it's being modified
    if (currentSession?.id === sessionId) {
      setCurrentSession((prev) => (prev ? { ...prev, replacements, lastModified: new Date() } : null));
    }
  };

  const updateSessionStyles = (sessionId: string, styles: SessionStyle[]) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              styles,
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
              styles,
              lastModified: new Date(),
            }
          : session
      )
    );

    // Update current session if it's being modified
    if (currentSession?.id === sessionId) {
      setCurrentSession((prev) => (prev ? { ...prev, styles, lastModified: new Date() } : null));
    }
  };

  const updateSessionListBulletSettings = (sessionId: string, listBulletSettings: ListBulletSettings) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              listBulletSettings,
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
              listBulletSettings,
              lastModified: new Date(),
            }
          : session
      )
    );

    // Update current session if it's being modified
    if (currentSession?.id === sessionId) {
      setCurrentSession((prev) => (prev ? { ...prev, listBulletSettings, lastModified: new Date() } : null));
    }
  };

  const updateSessionTableUniformitySettings = (sessionId: string, tableUniformitySettings: TableUniformitySettings) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              tableUniformitySettings,
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
              tableUniformitySettings,
              lastModified: new Date(),
            }
          : session
      )
    );

    // Update current session if it's being modified
    if (currentSession?.id === sessionId) {
      setCurrentSession((prev) => (prev ? { ...prev, tableUniformitySettings, lastModified: new Date() } : null));
    }
  };

  const saveSession = (session: Session) => {
    const jsonString = safeJsonStringify(session, undefined, 'SessionContext.saveSession');
    if (jsonString) {
      localStorage.setItem(`session_${session.id}`, jsonString);
    }
  };

  const loadSessionFromStorage = (id: string): Session | null => {
    const stored = localStorage.getItem(`session_${id}`);
    if (stored) {
      const parsed = safeJsonParse<any>(stored, null, 'SessionContext.loadSessionFromStorage');
      if (parsed) {
        return {
          ...parsed,
          createdAt: new Date(parsed.createdAt),
          lastModified: new Date(parsed.lastModified),
        };
      }
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
        reopenSession,
        closeSession,
        deleteSession,
        switchSession,
        addDocuments,
        removeDocument,
        processDocument,
        revertChange,
        revertAllChanges,
        updateSessionStats,
        updateSessionName,
        updateSessionOptions,
        updateSessionReplacements,
        updateSessionStyles,
        updateSessionListBulletSettings,
        updateSessionTableUniformitySettings,
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
