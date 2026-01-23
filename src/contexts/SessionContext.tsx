import type { HyperlinkProcessingOptions } from '@/types/hyperlink';
import {
  CustomSessionDefaults,
  Document,
  ListBulletSettings,
  ReplacementRule,
  RevisionHandlingMode,
  Session,
  SessionContextType,
  SessionStats,
  SessionStyle,
  TableOfContentsSettings,
  TableShadingSettings,
  TableUniformitySettings,
} from '@/types/session';
import { DocumentSnapshotService } from '@/services/document/DocumentSnapshotService';
import { requireElectronAPI } from '@/utils/electronGuard';
import {
  deleteSession as deleteSessionFromDB,
  ensureDBSizeLimit,
  handleQuotaExceededError,
  loadSessions,
  migrateFromLocalStorage,
  saveSession as saveSessionToDB,
  truncateSessionChanges,
} from '@/utils/indexedDB';
import { logger, debugModes, isDebugEnabled, createDebugLogger } from '@/utils/logger';
import { isPathSafe } from '@/utils/pathSecurity';
import { safeJsonParse, safeJsonStringify } from '@/utils/safeJsonParse';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useGlobalStats } from './GlobalStatsContext';

const SessionContext = createContext<SessionContextType | undefined>(undefined);

/**
 * Wraps a promise with a timeout to prevent hanging operations.
 * @param promise The promise to wrap
 * @param ms Timeout in milliseconds
 * @param operation Name of the operation for error messages
 */
const withTimeout = <T,>(promise: Promise<T>, ms: number, operation: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
    ),
  ]);

// Constants for IPC operations
const IPC_TIMEOUT_MS = 300000; // 5 minutes for document processing (large docs can take time)
const TIME_SAVED_SECONDS_PER_HYPERLINK = 101;
const SECONDS_PER_MINUTE = 60;

type SerializedDocument = Omit<Document, 'processedAt'> & {
  processedAt?: string;
};

type SerializedSession = Omit<Session, 'createdAt' | 'lastModified' | 'closedAt' | 'documents'> & {
  createdAt: string;
  lastModified: string;
  closedAt?: string;
  documents: SerializedDocument[];
};

/**
 * Default list bullet settings factory
 * Creates standard 5-level indentation configuration matching StylesEditor defaults
 * Used for new sessions and backfilling existing sessions without list settings
 *
 * Symbol indent: 0.5" base with 0.5" increments per level
 * Text indent: symbol indent + 0.25" hanging indent
 */
const createDefaultListBulletSettings = (): ListBulletSettings => ({
  enabled: true,
  indentationLevels: [
    {
      level: 0,
      symbolIndent: 0.5,
      textIndent: 0.75,
      bulletChar: '•',  // closed (filled)
      numberedFormat: '1.',
    },
    { level: 1, symbolIndent: 1.0, textIndent: 1.25, bulletChar: '○', numberedFormat: 'a.' },  // open
    {
      level: 2,
      symbolIndent: 1.5,
      textIndent: 1.75,
      bulletChar: '•',  // closed (filled)
      numberedFormat: 'i.',
    },
    { level: 3, symbolIndent: 2.0, textIndent: 2.25, bulletChar: '○', numberedFormat: '1)' },  // open
    {
      level: 4,
      symbolIndent: 2.5,
      textIndent: 2.75,
      bulletChar: '•',  // closed (filled)
      numberedFormat: 'a)',
    },
  ],
});

/**
 * Default session styles - Shared between createSession and resetSessionToDefaults
 * Matches StylesEditor defaults for consistency
 */
const DEFAULT_SESSION_STYLES: SessionStyle[] = [
  {
    id: 'header1',
    name: 'Heading 1',
    fontSize: 18,
    fontFamily: 'Verdana',
    bold: true,
    italic: false,
    underline: false,
    alignment: 'left',
    spaceBefore: 0,
    spaceAfter: 12,
    lineSpacing: 1.0,
    color: '#000000',
  },
  {
    id: 'header2',
    name: 'Heading 2',
    fontSize: 14,
    fontFamily: 'Verdana',
    bold: true,
    italic: false,
    underline: false,
    alignment: 'left',
    spaceBefore: 6,
    spaceAfter: 6,
    lineSpacing: 1.0,
    color: '#000000',
  },
  {
    id: 'header3',
    name: 'Heading 3',
    fontSize: 12,
    fontFamily: 'Verdana',
    bold: true,
    italic: false,
    underline: false,
    alignment: 'left',
    spaceBefore: 3,
    spaceAfter: 3,
    lineSpacing: 1.0,
    color: '#000000',
  },
  {
    id: 'normal',
    name: 'Normal',
    fontSize: 12,
    fontFamily: 'Verdana',
    bold: false,
    italic: false,
    underline: false,
    preserveBold: true,
    preserveItalic: false,
    preserveUnderline: false,
    preserveCenterAlignment: true,
    alignment: 'left',
    spaceBefore: 3,
    spaceAfter: 3,
    lineSpacing: 1.0,
    color: '#000000',
    noSpaceBetweenSame: false,
  },
  {
    id: 'listParagraph',
    name: 'List Paragraph',
    fontSize: 12,
    fontFamily: 'Verdana',
    bold: false,
    italic: false,
    underline: false,
    preserveBold: true,
    preserveItalic: false,
    preserveUnderline: false,
    alignment: 'left',
    spaceBefore: 0,
    spaceAfter: 6,
    lineSpacing: 1.0,
    color: '#000000',
    noSpaceBetweenSame: true,
    indentation: { left: 0.25, firstLine: 0.5 },
  },
];

/**
 * Default processing options - Shared between createSession and resetSessionToDefaults
 */
const DEFAULT_PROCESSING_OPTIONS = {
  validateUrls: true,
  createBackup: true,
  processInternalLinks: true,
  processExternalLinks: true,
  autoAcceptRevisions: false,
  enabledOperations: [
    'remove-italics',
    'normalize-dashes',
    'replace-outdated-titles',
    'validate-document-styles',
    'update-top-hyperlinks',
    'update-toc-hyperlinks',
    'force-remove-heading1-toc',
    'fix-internal-hyperlinks',
    'fix-content-ids',
    'center-border-images',
    'remove-whitespace',
    'remove-paragraph-lines',
    'remove-headers-footers',
    'add-document-warning',
    'validate-header2-tables',
    'list-indentation',
    'bullet-uniformity',
    'normalize-table-lists',
    'smart-tables',
  ],
};

/**
 * Default table shading settings
 */
const DEFAULT_TABLE_SHADING_SETTINGS: TableShadingSettings = {
  header2Shading: '#BFBFBF',
  otherShading: '#DFDFDF',
  imageBorderWidth: 1.0,
};

/**
 * localStorage key for custom session defaults
 * Stores user's preferred defaults set via "Save as Default" button
 */
const CUSTOM_DEFAULTS_KEY = 'dochub_custom_defaults';

/**
 * Load custom defaults from localStorage if available
 * Returns null if no custom defaults exist or if parsing fails
 */
const loadCustomDefaults = (): CustomSessionDefaults | null => {
  try {
    const stored = localStorage.getItem(CUSTOM_DEFAULTS_KEY);
    if (!stored) {
      return null;
    }
    const parsed = safeJsonParse<CustomSessionDefaults | null>(stored, null, 'loadCustomDefaults');
    if (!parsed) {
      return null;
    }
    // Validate that we have at least some valid data
    if (!parsed.styles && !parsed.listBulletSettings && !parsed.processingOptions && !parsed.tableShadingSettings) {
      return null;
    }
    return parsed;
  } catch (error) {
    logger.warn('[SessionContext] Failed to load custom defaults:', error);
    return null;
  }
};

/**
 * Ensures session has valid listBulletSettings with non-empty indentation levels
 * Backfills with defaults if missing or invalid
 */
const ensureListBulletSettings = (session: Session): Session => {
  const needsBackfill =
    !session.listBulletSettings ||
    !session.listBulletSettings.indentationLevels ||
    session.listBulletSettings.indentationLevels.length === 0;

  if (needsBackfill) {
    return {
      ...session,
      listBulletSettings: createDefaultListBulletSettings(),
    };
  }

  return session;
};

/**
 * Ensures session has valid styles array with all required styles
 * Backfills with defaults if missing or invalid
 *
 * This is critical for:
 * 1. Historical sessions created before styles were added
 * 2. Sessions loaded from storage that may have corrupted/missing styles
 * 3. Ensuring font color is properly applied (requires styles to be defined)
 */
const ensureSessionStyles = (session: Session): Session => {
  const needsBackfill =
    !session.styles ||
    !Array.isArray(session.styles) ||
    session.styles.length === 0;

  if (needsBackfill) {
    return {
      ...session,
      styles: [...DEFAULT_SESSION_STYLES],
    };
  }

  return session;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const log = logger.namespace('SessionContext');
  // Conditional verbose logger - only logs when SESSION_STATE debug mode is enabled
  const debugLog = createDebugLogger(debugModes.SESSION_STATE, 'SessionState');

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
      log.warn(
        '[Session] loadSessionsFromStorage called but already loaded - skipping to prevent race condition'
      );
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
              log.info(
                `[Session] Restoring ${backup.sessions.length} sessions from emergency backup`
              );

              // Save backup sessions to IndexedDB immediately
              // backup.sessions is already in SerializedSession format (strings for dates)
              for (const session of backup.sessions) {
                await saveSessionToDB(session).catch((err) =>
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
              deleteSessionFromDB(s.id).catch((err) =>
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

        // BACKFILL FIX: Ensure all loaded sessions have valid listBulletSettings
        // This repairs historical sessions that were created before list settings were added
        const listBackfilledSessions = cleanedSessions.map(ensureListBulletSettings);

        // Log how many sessions were backfilled for list settings
        const listBackfillCount = listBackfilledSessions.filter(
          (s, idx) => s.listBulletSettings !== cleanedSessions[idx].listBulletSettings
        ).length;
        if (listBackfillCount > 0) {
          log.info(
            `[Session] Backfilled ${listBackfillCount} session(s) with default list bullet settings`
          );
        }

        // BACKFILL FIX: Ensure all loaded sessions have valid styles
        // This is critical for font color to be applied - without styles, applyStyles() is skipped
        const backfilledSessions = listBackfilledSessions.map(ensureSessionStyles);

        // Log how many sessions were backfilled for styles
        const stylesBackfillCount = backfilledSessions.filter(
          (s, idx) => s.styles !== listBackfilledSessions[idx].styles
        ).length;
        if (stylesBackfillCount > 0) {
          log.info(
            `[Session] Backfilled ${stylesBackfillCount} session(s) with default styles`
          );
        }

        setSessions(backfilledSessions);
        if (storedActiveSessions) {
          const activeIds = safeJsonParse<string[]>(
            storedActiveSessions,
            [],
            'SessionContext.activeSessions'
          );
          const active = backfilledSessions.filter((s) => activeIds.includes(s.id));
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
        await handleQuotaExceededError(async () => saveSessionToDB(truncatedSession), session.id);
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
        log.error(
          'Database quota exceeded - archive old sessions or export data to free up space',
          err
        );
      } else {
        log.error('Failed to persist sessions:', err);
      }
    }
  }, [log]); // No dependencies - uses refs instead

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
  }, [sessions, activeSessions, debouncedPersistSessions]); // FIX: Removed debouncedPersistSessions - it's stable so doesn't need to be a dependency

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
            documents: session.documents.map((doc) => ({
              ...doc,
              processedAt: doc.processedAt?.toISOString(),
            })),
          });

          const emergencyBackup = safeJsonStringify(
            {
              sessions: currentSessions.map(serializeSession),
              activeSessions: currentActiveSessions.map(serializeSession),
              timestamp: Date.now(),
              reason: 'beforeunload_emergency_backup',
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
    // Load custom defaults if user has saved them via "Save as Default"
    const customDefaults = loadCustomDefaults();
    const hasCustomDefaults = customDefaults !== null;

    if (hasCustomDefaults) {
      log.info('[createSession] Using custom defaults for new session');
    }

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
      // Use custom defaults if available, otherwise fall back to factory defaults
      styles: customDefaults?.styles
        ? [...customDefaults.styles]
        : [...DEFAULT_SESSION_STYLES],
      listBulletSettings: customDefaults?.listBulletSettings
        ? { ...customDefaults.listBulletSettings, indentationLevels: [...customDefaults.listBulletSettings.indentationLevels] }
        : createDefaultListBulletSettings(),
      tableShadingSettings: customDefaults?.tableShadingSettings
        ? { ...customDefaults.tableShadingSettings }
        : { ...DEFAULT_TABLE_SHADING_SETTINGS },
      processingOptions: customDefaults?.processingOptions
        ? {
            ...customDefaults.processingOptions,
            enabledOperations: [...(customDefaults.processingOptions.enabledOperations || [])],
          }
        : {
            ...DEFAULT_PROCESSING_OPTIONS,
            enabledOperations: [...DEFAULT_PROCESSING_OPTIONS.enabledOperations],
          },
    };

    // DEBUG: Log state transition
    debugLog.debug('Creating session - state before update', {
      sessionCount: sessions.length,
      activeCount: activeSessions.length,
      currentSessionId: currentSession?.id,
    });

    setSessions((prev) => [...prev, newSession]);
    setActiveSessions((prev) => [...prev, newSession]);
    setCurrentSession(newSession);

    // DEBUG: Log new state
    debugLog.debug('Session created - state after update', {
      newSessionId: newSession.id,
      sessionCount: sessions.length + 1,
      activeCount: activeSessions.length + 1,
    });

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
        log.warn(
          `[loadSession] Attempted to load closed session: ${id}. Use reopenSession() instead.`
        );
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
      setSessions((prev) => prev.map((s) => (s.id === id ? updatedSession : s)));
      setActiveSessions((prev) => [...prev, updatedSession]);
      setCurrentSession(updatedSession);

      log.info(`[reopenSession] Reopened session: ${session.name}`);
    }
  };

  const closeSession = (id: string) => {
    // Get session info for logging
    const session = sessions.find((s) => s.id === id);
    const closedAt = new Date();

    // DEBUG: Log state before close
    debugLog.debug('Closing session - state before', {
      closingSessionId: id,
      closingSessionName: session?.name,
      activeCount: activeSessions.length,
      isCurrentSession: currentSession?.id === id,
    });

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
      newDocuments.forEach((doc) => {
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
  const processDocument = useCallback(
    async (sessionId: string, documentId: string): Promise<void> => {
      const session = sessions.find((s) => s.id === sessionId);
      const document = session?.documents.find((d) => d.id === documentId);
      const processingStartTime = Date.now();

      // =========================================================================
      // COMPREHENSIVE LOGGING - DOCUMENT PROCESSING START
      // =========================================================================
      log.info('═══════════════════════════════════════════════════════════════════════');
      log.info('[SessionContext] DOCUMENT PROCESSING STARTED');
      log.info('═══════════════════════════════════════════════════════════════════════');
      log.info(`[SessionContext] Timestamp: ${new Date().toISOString()}`);
      log.info(`[SessionContext] Session ID: ${sessionId}`);
      log.info(`[SessionContext] Document ID: ${documentId}`);
      log.info(`[SessionContext] Document Name: ${document?.name || 'Unknown'}`);
      log.info(`[SessionContext] Document Path: ${document?.path || 'No path'}`);

      // DEBUG: Log document processing start
      debugLog.debug('Processing document - starting', {
        sessionId,
        documentId,
        documentName: document?.name,
        documentPath: document?.path ? '[path exists]' : '[no path]',
      });

      if (!session || !document || !document.path) {
        log.error('[SessionContext] ERROR: Session, document, or document path not found');
        log.error(`[SessionContext] Session exists: ${!!session}`);
        log.error(`[SessionContext] Document exists: ${!!document}`);
        log.error(`[SessionContext] Document path exists: ${!!document?.path}`);
        return;
      }

      // ENSURE SESSION HAS REQUIRED DATA: Backfill styles and list settings if missing
      // This ensures font color and other style-dependent features work correctly
      // even if the session was created before these features were added
      const ensuredSession = ensureSessionStyles(ensureListBulletSettings(session));
      if (ensuredSession !== session) {
        log.info('[Session] Backfilled session with missing styles or list settings during processing');
        // Update the session in state with the backfilled data
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? ensuredSession : s))
        );
      }

      // Use the ensured session for processing
      const sessionToProcess = ensuredSession;

      // PERFORMANCE: Update document status to processing (first setState)
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                documents: s.documents.map((d) =>
                  d.id === documentId ? { ...d, status: 'processing' as const, errors: undefined, errorType: undefined } : d
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
          { apiConnections: { powerAutomateUrl: '' }, profile: {} },
          'SessionContext.processDocument.userSettings'
        );

        log.debug(
          'Processing document with PowerAutomate URL:',
          settings.apiConnections.powerAutomateUrl
        );

        // Extract profile data from settings for API request
        const userProfile = settings.profile
          ? {
              firstName: settings.profile.firstName || '',
              lastName: settings.profile.lastName || '',
              email: settings.profile.email || '',
            }
          : undefined;

        log.debug('Processing document with user profile:', userProfile);

        // Convert session processing options to hyperlink processing options
        // Extract style spacing from session styles
        log.debug('\n=== SESSION CONTEXT: Extracting Style Spacing ===');
        log.debug('sessionToProcess.styles:', sessionToProcess.styles);

        // Default style spacing (applied when sessionToProcess.styles is undefined/empty)
        const defaultStyleSpacing = {
          header1: {
            spaceBefore: 0,
            spaceAfter: 12,
            lineSpacing: 1.0,
          },
          header2: {
            spaceBefore: 6,
            spaceAfter: 6,
            lineSpacing: 1.0,
          },
          normal: {
            spaceBefore: 3,
            spaceAfter: 3,
            lineSpacing: 1.0,
          },
        };

        // Check if session has configured styles (should always be true after ensureSessionStyles)
        const hasSessionStyles = sessionToProcess.styles && sessionToProcess.styles.length > 0;

        if (!hasSessionStyles) {
          log.debug('   No styles configured in session - using default spacing values');
          log.debug('   Default Header 1: 0pt before, 12pt after, 1.0 line spacing');
          log.debug('   Default Header 2: 6pt before, 6pt after, 1.0 line spacing');
          log.debug('   Default Normal: 3pt before, 3pt after, 1.0 line spacing');
        }

        const header1Style = sessionToProcess.styles?.find((s: SessionStyle) => s.id === 'header1');
        const header2Style = sessionToProcess.styles?.find((s: SessionStyle) => s.id === 'header2');
        const normalStyle = sessionToProcess.styles?.find((s: SessionStyle) => s.id === 'normal');

        log.debug('Found header1Style:', header1Style);
        log.debug('Found header2Style:', header2Style);
        log.debug('Found normalStyle:', normalStyle);

        // Define custom style spacing with proper type structure
        interface CustomStyleSpacing {
          header1?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
          header2?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
          normal?: {
            spaceBefore: number;
            spaceAfter: number;
            lineSpacing?: number;
            noSpaceBetweenSame?: boolean;
          };
        }
        const customStyleSpacing: CustomStyleSpacing = {};

        // Header 1 spacing (use session style or default)
        if (
          header1Style &&
          (header1Style.spaceBefore !== undefined ||
            header1Style.spaceAfter !== undefined ||
            header1Style.lineSpacing !== undefined)
        ) {
          customStyleSpacing.header1 = {
            spaceBefore: header1Style.spaceBefore ?? 0,
            spaceAfter: header1Style.spaceAfter ?? 0,
            lineSpacing: header1Style.lineSpacing ?? 1.0,
          };
          log.debug('✓ Added header1 spacing from session:', customStyleSpacing.header1);
        } else if (!hasSessionStyles) {
          customStyleSpacing.header1 = defaultStyleSpacing.header1;
          log.debug('✓ Added header1 spacing from defaults:', customStyleSpacing.header1);
        }

        // Header 2 spacing (use session style or default)
        if (
          header2Style &&
          (header2Style.spaceBefore !== undefined ||
            header2Style.spaceAfter !== undefined ||
            header2Style.lineSpacing !== undefined)
        ) {
          customStyleSpacing.header2 = {
            spaceBefore: header2Style.spaceBefore ?? 0,
            spaceAfter: header2Style.spaceAfter ?? 0,
            lineSpacing: header2Style.lineSpacing ?? 1.0,
          };
          log.debug('✓ Added header2 spacing from session:', customStyleSpacing.header2);
        } else if (!hasSessionStyles) {
          customStyleSpacing.header2 = defaultStyleSpacing.header2;
          log.debug('✓ Added header2 spacing from defaults:', customStyleSpacing.header2);
        }

        // Normal spacing (use session style or default)
        if (
          normalStyle &&
          (normalStyle.spaceBefore !== undefined ||
            normalStyle.spaceAfter !== undefined ||
            normalStyle.lineSpacing !== undefined)
        ) {
          customStyleSpacing.normal = {
            spaceBefore: normalStyle.spaceBefore ?? 0,
            spaceAfter: normalStyle.spaceAfter ?? 0,
            lineSpacing: normalStyle.lineSpacing ?? 1.0,
          };
          log.debug('✓ Added normal spacing from session:', customStyleSpacing.normal);
        } else if (!hasSessionStyles) {
          customStyleSpacing.normal = defaultStyleSpacing.normal;
          log.debug('✓ Added normal spacing from defaults:', customStyleSpacing.normal);
        }

        log.debug('Final customStyleSpacing object:', customStyleSpacing);
        log.debug(
          'Will pass to processor:',
          Object.keys(customStyleSpacing).length > 0 ? customStyleSpacing : undefined
        );

        // DEBUG: Log enabled operations before processing
        log.info('\n=== PROCESSING DOCUMENT - OPTIONS DEBUG ===');
        log.info('Session enabled operations:', sessionToProcess.processingOptions?.enabledOperations || []);

        const processingOptions: HyperlinkProcessingOptions & {
          // User Profile for API
          userProfile?: {
            firstName: string;
            lastName: string;
            email: string;
          };

          // Text Formatting Options
          removeWhitespace?: boolean;
          removeParagraphLines?: boolean;
          preserveBlankLinesAfterHeader2Tables?: boolean;
          preserveUserBlankStructures?: boolean;
          removeItalics?: boolean;
          standardizeHyperlinkFormatting?: boolean;
          standardizeListPrefixFormatting?: boolean;

          // Content Structure Options
          assignStyles?: boolean;
          centerAndBorderImages?: boolean;
          removeHeadersFooters?: boolean;
          addDocumentWarning?: boolean;

          // Lists & Tables Options
          listBulletSettings?: ListBulletSettings;
          bulletUniformity?: boolean;
          normalizeTableLists?: boolean;
          tableUniformity?: boolean;
          smartTables?: boolean;
          tableShadingSettings?: {
            header2Shading: string;
            otherShading: string;
          };
          tableOfContentsSettings?: TableOfContentsSettings;

          // Legacy
          tableUniformitySettings?: TableUniformitySettings;

          // Word Tracked Changes Handling
          revisionHandlingMode?: RevisionHandlingMode;
          revisionAuthor?: string;
          autoAcceptRevisions?: boolean;

          // Local Dictionary Settings
          localDictionary?: {
            enabled: boolean;
            totalEntries: number;
          };
        } = {
          apiEndpoint: settings.apiConnections.powerAutomateUrl || '',
          userProfile, // Pass profile data to backend for API request

          // Hyperlink Operations (operations object)
          operations: {
            fixContentIds:
              sessionToProcess.processingOptions?.enabledOperations?.includes('fix-content-ids'),
            updateTitles:
              sessionToProcess.processingOptions?.enabledOperations?.includes('replace-outdated-titles'),
            replaceOutdatedTitles:
              sessionToProcess.processingOptions?.enabledOperations?.includes('replace-outdated-titles'), // Same flag, standalone fallback
            fixInternalHyperlinks:
              sessionToProcess.processingOptions?.enabledOperations?.includes('fix-internal-hyperlinks'),
            updateTopHyperlinks:
              sessionToProcess.processingOptions?.enabledOperations?.includes('update-top-hyperlinks'),
            updateTocHyperlinks: true, // Always enabled - no UI control
            standardizeHyperlinkColor: true, // Always enabled - removed from UI
            validateHeader2Tables:
              sessionToProcess.processingOptions?.enabledOperations?.includes('validate-header2-tables'),
            validateDocumentStyles: sessionToProcess.processingOptions?.enabledOperations?.includes(
              'validate-document-styles'
            ),
          },

          // Text replacements and styles
          textReplacements: sessionToProcess.replacements?.filter((r) => r.enabled) || [],
          // Transform session styles array to include all formatting properties
          // This matches the format expected by WordDocumentProcessor for custom style application
          styles:
            sessionToProcess.styles && Array.isArray(sessionToProcess.styles) && sessionToProcess.styles.length > 0
              ? sessionToProcess.styles.map((style: any) => {
                  // DUAL TOGGLE FORMATTING SYSTEM
                  // For formatting properties (bold, italic, underline):
                  //   - If preserveBold/preserveItalic/preserveUnderline === true: Don't call setter (preserve existing)
                  //   - If preserve flag === false/undefined: Apply bold/italic/underline value (true = apply, false = remove)
                  // WordDocumentProcessor checks preserve flags before calling setters!

                  return {
                    id: style.id,
                    name: style.name,
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    // Pass through formatting values
                    bold: style.bold ?? false,
                    italic: style.italic ?? false,
                    underline: style.underline ?? false,
                    // Pass through preserve flags
                    preserveBold: style.preserveBold,
                    preserveItalic: style.preserveItalic,
                    preserveUnderline: style.preserveUnderline,
                    preserveCenterAlignment: style.preserveCenterAlignment,
                    alignment: style.alignment,
                    color: style.color,
                    spaceBefore: style.spaceBefore ?? 0,
                    spaceAfter: style.spaceAfter ?? 0,
                    lineSpacing: style.lineSpacing ?? 1.0,
                    noSpaceBetweenSame: style.noSpaceBetweenSame,
                    indentation: style.indentation
                      ? {
                          left: style.indentation.left,
                          firstLine: style.indentation.firstLine,
                        }
                      : undefined,
                  };
                })
              : [],
          customStyleSpacing:
            Object.keys(customStyleSpacing).length > 0 ? customStyleSpacing : undefined,

          // Text Formatting Options (mapped from ProcessingOptions UI)
          removeWhitespace:
            sessionToProcess.processingOptions?.enabledOperations?.includes('remove-whitespace'),
          removeParagraphLines:
            sessionToProcess.processingOptions?.enabledOperations?.includes('remove-paragraph-lines'),
          // Preserve blank lines after Header 2 tables ONLY when removing paragraph lines
          // This ensures we don't accidentally remove spacing after Header 2 tables (docxmlater v1.16.0)
          preserveBlankLinesAfterHeader2Tables:
            sessionToProcess.processingOptions?.enabledOperations?.includes('remove-paragraph-lines'),
          preserveUserBlankStructures:
            sessionToProcess.processingOptions?.enabledOperations?.includes('preserve-user-blank-structures'),
          removeItalics: sessionToProcess.processingOptions?.enabledOperations?.includes('remove-italics'),

          // ALWAYS ENABLED: Standardize hyperlink formatting (remove bold/italic from all hyperlinks)
          // This is intentional and required for the work environment to maintain professional document standards.
          // Hyperlinks should never be bolded or italicized - they must always use standard blue underlined style.
          standardizeHyperlinkFormatting: true,

          // ALWAYS ENABLED: Standardize list prefix formatting (Verdana 12pt black for all lists)
          // This ensures all bullet points and numbered list symbols have consistent professional formatting.
          standardizeListPrefixFormatting: true,

          // Content Structure Options (ALWAYS ENABLED - automatic processing)
          // These operations are now always applied when processing documents
          // UI checkboxes have been removed as these are essential formatting operations
          assignStyles: true, // Always apply custom styles from Styles tab
          centerAndBorderImages: true, // Always center and border large images (>1" either dimension)
          removeHeadersFooters:
            sessionToProcess.processingOptions?.enabledOperations?.includes('remove-headers-footers'),
          addDocumentWarning:
            sessionToProcess.processingOptions?.enabledOperations?.includes('add-document-warning'),

          // Lists & Tables Options (mapped from ProcessingOptions UI)
          // Map list-indentation checkbox to listBulletSettings.enabled
          // This controls Phase 3 (indentation), while bullet-uniformity controls Phases 1+2 (symbols)
          listBulletSettings: sessionToProcess.processingOptions?.enabledOperations?.includes(
            'list-indentation'
          )
            ? {
                enabled: true,
                indentationLevels: sessionToProcess.listBulletSettings?.indentationLevels || [],
              }
            : undefined,
          bulletUniformity:
            sessionToProcess.processingOptions?.enabledOperations?.includes('bullet-uniformity'),
          normalizeTableLists:
            sessionToProcess.processingOptions?.enabledOperations?.includes('normalize-table-lists'),
          tableUniformity: sessionToProcess.processingOptions?.enabledOperations?.includes('smart-tables'),
          smartTables: sessionToProcess.processingOptions?.enabledOperations?.includes('smart-tables'),
          // Table shading settings with values derived from paragraph styles
          // This ensures table cell formatting inherits from the existing UI controls
          tableShadingSettings: (() => {
            // Find relevant paragraph styles to derive table-specific settings
            const normalStyle = sessionToProcess.styles?.find((s: any) => s.id === 'normal');
            const heading2Style = sessionToProcess.styles?.find((s: any) => s.id === 'header2');

            return sessionToProcess.tableShadingSettings
              ? {
                  // Settings from TableShadingSettings UI
                  header2Shading: sessionToProcess.tableShadingSettings.header2Shading,
                  otherShading: sessionToProcess.tableShadingSettings.otherShading,
                  imageBorderWidth: sessionToProcess.tableShadingSettings.imageBorderWidth ?? 1.0,
                  // Derived from Heading 2 paragraph style
                  heading2FontFamily: heading2Style?.fontFamily || 'Verdana',
                  heading2FontSize: heading2Style?.fontSize || 14,
                  // Derived from Normal paragraph style
                  normalAlignment: normalStyle?.alignment || 'left',
                  normalFontFamily: normalStyle?.fontFamily || 'Verdana',
                  normalFontSize: normalStyle?.fontSize || 12,
                  normalSpaceBefore: normalStyle?.spaceBefore ?? 3,
                  normalSpaceAfter: normalStyle?.spaceAfter ?? 3,
                  normalLineSpacing: normalStyle?.lineSpacing ?? 1.0,
                  preserveBold: normalStyle?.preserveBold ?? true,
                  preserveCenterAlignment: normalStyle?.preserveCenterAlignment ?? true,
                }
              : undefined;
          })(),

          // Table of Contents Settings - Simplified to enabled flag only
          tableOfContentsSettings: sessionToProcess.tableOfContentsSettings,

          // Word Tracked Changes Handling
          revisionHandlingMode: sessionToProcess.processingOptions?.revisionHandlingMode || 'accept_all',
          revisionAuthor: sessionToProcess.processingOptions?.revisionAuthor,
          autoAcceptRevisions: sessionToProcess.processingOptions?.autoAcceptRevisions ?? false, // Default: false

          // DocHub Change Tracking (for Document Changes UI)
          trackChanges: true, // Enable hyperlink change tracking for DocumentProcessingComparison

          // Legacy (deprecated, kept for backwards compatibility)
          tableUniformitySettings: sessionToProcess.tableUniformitySettings,

          // Local Dictionary Settings (for offline hyperlink lookup)
          localDictionary: settings.localDictionary?.enabled
            ? {
                enabled: true,
                totalEntries: settings.localDictionary.totalEntries || 0,
              }
            : undefined,
        };

        // DEBUG: Log final operations object being passed to processor
        log.info('Operations object being passed to WordDocumentProcessor:');
        log.info('  - updateTocHyperlinks:', processingOptions.operations?.updateTocHyperlinks);
        log.info(
          '  - validateDocumentStyles:',
          processingOptions.operations?.validateDocumentStyles
        );
        log.info('  - validateHeader2Tables:', processingOptions.operations?.validateHeader2Tables);
        log.info('  - styles length:', processingOptions.styles?.length || 0);
        if (processingOptions.styles && processingOptions.styles.length > 0) {
          log.info(
            '  - Available style IDs:',
            processingOptions.styles.map((s: any) => s.id).join(', ')
          );
        }
        log.info(
          '  - tableOfContentsSettings.enabled:',
          processingOptions.tableOfContentsSettings?.enabled ?? false
        );
        // CRITICAL DEBUG: Log listBulletSettings details
        log.info('  - listBulletSettings enabled:', processingOptions.listBulletSettings?.enabled);
        log.info(
          '  - listBulletSettings indentationLevels length:',
          processingOptions.listBulletSettings?.indentationLevels?.length || 0
        );
        if (processingOptions.listBulletSettings?.indentationLevels) {
          processingOptions.listBulletSettings.indentationLevels.forEach(
            (level: any, idx: number) => {
              log.info(
                `    - Level ${level.level}: symbol=${level.symbolIndent}", text=${level.textIndent}", char="${level.bulletChar}"`
              );
            }
          );
        }
        // Also log session state right before IPC call
        log.info('Session state right before IPC:');
        log.info('  - Session has listBulletSettings?', !!sessionToProcess.listBulletSettings);
        log.info('  - Session listBulletSettings enabled?', sessionToProcess.listBulletSettings?.enabled);
        log.info(
          '  - Session indentationLevels length:',
          sessionToProcess.listBulletSettings?.indentationLevels?.length || 0
        );
        if (sessionToProcess.listBulletSettings?.indentationLevels) {
          sessionToProcess.listBulletSettings.indentationLevels.forEach((level, idx) => {
            log.info(
              `    - Session Level ${level.level}: symbol=${level.symbolIndent}", text=${level.textIndent}", char="${level.bulletChar}"`
            );
          });
        }
        // Check enabled operations
        log.info('  - Enabled operations:', sessionToProcess.processingOptions?.enabledOperations || []);
        // DEBUG: Show formatting preservation for Normal/ListParagraph styles
        const normalStyleInOptions = processingOptions.styles?.find((s: any) => s.id === 'normal');
        const listParaStyleInOptions = processingOptions.styles?.find(
          (s: any) => s.id === 'listParagraph'
        );
        if (normalStyleInOptions || listParaStyleInOptions) {
          log.info('  - Formatting Preservation (bold & alignment only):');
          if (normalStyleInOptions) {
            log.info(
              `    - Normal: bold=${normalStyleInOptions.bold}, alignment=${normalStyleInOptions.alignment} (undefined = preserve), italic=${normalStyleInOptions.italic}, underline=${normalStyleInOptions.underline}`
            );
          }
          if (listParaStyleInOptions) {
            log.info(
              `    - ListParagraph: bold=${listParaStyleInOptions.bold}, alignment=${listParaStyleInOptions.alignment} (undefined = preserve), italic=${listParaStyleInOptions.italic}, underline=${listParaStyleInOptions.underline}`
            );
          }
        }

        // Capture snapshot BEFORE processing for comparison feature
        // This must happen in the renderer process (IndexedDB not available in main process)
        try {
          log.info(`[SessionContext] Capturing pre-processing snapshot for ${document.name}`);

          // Ensure Electron API is available for file operations
          const electronAPI = requireElectronAPI('snapshot capture');

          // Read original file into buffer
          const fileBuffer = await electronAPI.readFileAsBuffer(document.path);

          // Extract original text content before processing
          const textResult = await electronAPI.extractDocumentText(document.path);
          const originalText = textResult.success && textResult.textContent ? textResult.textContent : [];

          // Store snapshot in IndexedDB (renderer process)
          await DocumentSnapshotService.captureSnapshot(
            fileBuffer,
            sessionId,
            documentId,
            originalText,
            [] // hyperlinks optional
          );
          log.info(`[SessionContext] Snapshot captured: ${originalText.length} paragraphs, ${(fileBuffer.byteLength / 1024).toFixed(1)}KB`);
        } catch (snapshotError) {
          log.warn('[SessionContext] Failed to capture snapshot (comparison will be unavailable):', snapshotError);
          // Continue with processing even if snapshot fails
        }

        // =========================================================================
        // LOGGING - IPC CALL TO MAIN PROCESS
        // =========================================================================
        log.info('───────────────────────────────────────────────────────────────────────');
        log.info('[SessionContext] Sending document to main process for processing');
        log.info(`[SessionContext] API Endpoint: ${processingOptions.apiEndpoint ? 'Configured' : 'NOT CONFIGURED'}`);
        log.info(`[SessionContext] Operations enabled: ${sessionToProcess.processingOptions?.enabledOperations?.join(', ') || 'None'}`);
        log.info(`[SessionContext] IPC Timeout: ${IPC_TIMEOUT_MS}ms`);
        log.info('───────────────────────────────────────────────────────────────────────');

        // Process the document using Electron IPC with timeout protection
        const processingAPI = requireElectronAPI('document processing');
        const rawResult = await withTimeout(
          processingAPI.processHyperlinkDocument(document.path, processingOptions),
          IPC_TIMEOUT_MS,
          'Document processing'
        );

        // Validate the response structure before using it
        if (!rawResult || typeof rawResult !== 'object') {
          throw new Error('Invalid response from document processor: expected an object');
        }

        // Type guard to ensure required fields exist
        const hasRequiredFields =
          'success' in rawResult &&
          'totalHyperlinks' in rawResult &&
          typeof rawResult.success === 'boolean' &&
          typeof rawResult.totalHyperlinks === 'number';

        if (!hasRequiredFields) {
          throw new Error(
            'Invalid response from document processor: missing required fields (success, totalHyperlinks)'
          );
        }

        const result = rawResult as {
          success: boolean;
          totalHyperlinks: number;
          processedHyperlinks: number;
          modifiedHyperlinks: number;
          appendedContentIds?: number;
          backupPath?: string;
          duration: number;
          errorMessages?: string[];
          changes?: import('@/types/session').DocumentChange[];
          previousRevisions?: import('@/types/session').PreviousRevisionState;
          wordRevisions?: import('@/types/session').WordRevisionState;
        };

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
                          errorType: !result.success && result.errorMessages?.some(
                            (msg) => msg.toLowerCase().includes('close the file')
                          ) ? 'file_locked' : (!result.success ? 'general' : undefined),
                          // Store pre-existing revisions (from before DocHub processing)
                          previousRevisions: result.previousRevisions,
                          // Store Word revisions state from DocHub processing
                          wordRevisions: result.wordRevisions,
                          processingResult: {
                            hyperlinksProcessed: result.processedHyperlinks,
                            hyperlinksModified: result.modifiedHyperlinks,
                            contentIdsAppended:
                              result.appendedContentIds || result.processedHyperlinks,
                            backupPath: result.backupPath,
                            duration: result.duration,
                            // Use the enhanced changes array from processor with full context
                            changes: result.changes || [],
                          },
                        }
                      : d
                  ),
                  stats: {
                    ...s.stats,
                    documentsProcessed: s.stats.documentsProcessed + (result.success ? 1 : 0),
                    hyperlinksChecked: s.stats.hyperlinksChecked + result.totalHyperlinks,
                    feedbackImported: s.stats.feedbackImported,
                    timeSaved:
                      s.stats.timeSaved +
                      Math.round(
                        (result.totalHyperlinks * TIME_SAVED_SECONDS_PER_HYPERLINK) /
                          SECONDS_PER_MINUTE
                      ),
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
            timeSaved: Math.round(
              (result.totalHyperlinks * TIME_SAVED_SECONDS_PER_HYPERLINK) / SECONDS_PER_MINUTE
            ),
          });

          const totalDuration = Date.now() - processingStartTime;

          // Enhanced success logging for user visibility
          log.info('═══════════════════════════════════════════════════════════════════════');
          log.info('[SessionContext] DOCUMENT PROCESSING COMPLETE - SUCCESS');
          log.info('═══════════════════════════════════════════════════════════════════════');
          log.info(`[SessionContext] Document: ${document.name}`);
          log.info(`[SessionContext] Location: ${document.path}`);
          log.info(`[SessionContext] Hyperlinks Processed: ${result.totalHyperlinks}`);
          log.info(`[SessionContext] Hyperlinks Modified: ${result.modifiedHyperlinks}`);
          log.info(`[SessionContext] Content IDs Appended: ${result.appendedContentIds || 0}`);
          log.info(`[SessionContext] Processor Duration: ${result.duration}ms`);
          log.info(`[SessionContext] Total Duration: ${totalDuration}ms`);
          log.info(
            `[SessionContext] Time Saved: ${Math.round((result.totalHyperlinks * TIME_SAVED_SECONDS_PER_HYPERLINK) / SECONDS_PER_MINUTE)} seconds`
          );
          log.info('═══════════════════════════════════════════════════════════════════════');
        } else {
          const totalDuration = Date.now() - processingStartTime;
          log.error('═══════════════════════════════════════════════════════════════════════');
          log.error('[SessionContext] DOCUMENT PROCESSING COMPLETE - FAILED');
          log.error('═══════════════════════════════════════════════════════════════════════');
          log.error(`[SessionContext] Document: ${document.name}`);
          log.error(`[SessionContext] Errors: ${result.errorMessages?.join(', ') || 'Unknown error'}`);
          log.error(`[SessionContext] Duration: ${totalDuration}ms`);
          log.error('═══════════════════════════════════════════════════════════════════════');
        }
      } catch (error) {
        const totalDuration = Date.now() - processingStartTime;
        log.error('═══════════════════════════════════════════════════════════════════════');
        log.error('[SessionContext] DOCUMENT PROCESSING EXCEPTION');
        log.error('═══════════════════════════════════════════════════════════════════════');
        log.error(`[SessionContext] Document: ${document.name}`);
        log.error(`[SessionContext] Error: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          log.error(`[SessionContext] Stack Trace:`);
          error.stack.split('\n').forEach(line => {
            log.error(`[SessionContext]   ${line}`);
          });
        }
        log.error(`[SessionContext] Duration: ${totalDuration}ms`);
        log.error('═══════════════════════════════════════════════════════════════════════');
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
                          errorType: (error instanceof Error && error.message.toLowerCase().includes('close the file'))
                            ? 'file_locked'
                            : 'general',
                        }
                      : d
                  ),
                  lastModified: new Date(),
                }
              : s
          )
        );
      }
    },
    [sessions, log, updateGlobalStats]
  ); // Dependencies: sessions for finding docs, log for logging, updateGlobalStats for stats

  const revertChange = async (
    sessionId: string,
    documentId: string,
    changeId: string
  ): Promise<void> => {
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
                        changes: d.processingResult.changes?.filter((c) => c.id !== changeId) || [],
                      },
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
      const restoreAPI = requireElectronAPI('backup restore');
      await restoreAPI.restoreFromBackup(backupPath, document.path);

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
                        processingResult: undefined,
                      }
                    : d
                ),
                lastModified: new Date(),
              }
            : s
        )
      );

      log.info(
        `[Session] Reverted all changes for document ${documentId} from backup ${backupPath}`
      );
    } catch (error) {
      log.error('Error reverting all changes:', error);
      throw error;
    }
  };

  // UNIFIED STATE UPDATE HELPER
  // Prevents state synchronization issues by updating all three state variables atomically
  // This replaces the previous pattern of updating sessions, activeSessions, and currentSession separately
  const updateSessionById = useCallback(
    (sessionId: string, updater: (session: Session) => Session) => {
      const updateFn = (sessions: Session[]) =>
        sessions.map((s) => (s.id === sessionId ? updater(s) : s));

      setSessions(updateFn);
      setActiveSessions(updateFn);
      setCurrentSession((prev) => (prev?.id === sessionId ? updater(prev) : prev));
    },
    []
  );

  const updateSessionStats = useCallback(
    (sessionId: string, stats: Partial<SessionStats>) => {
      updateSessionById(sessionId, (session) => ({
        ...session,
        stats: { ...session.stats, ...stats },
        lastModified: new Date(),
      }));
    },
    [updateSessionById]
  );

  const updateSessionName = useCallback(
    (sessionId: string, name: string) => {
      updateSessionById(sessionId, (session) => ({
        ...session,
        name,
        lastModified: new Date(),
      }));
    },
    [updateSessionById]
  );

  const updateSessionOptions = useCallback(
    (sessionId: string, processingOptions: Session['processingOptions']) => {
      // DEBUG: Log session options update
      log.info('[SessionContext] Updating session options for session:', sessionId);
      log.info('  - Enabled operations:', processingOptions?.enabledOperations || []);
      log.info('  - Options object:', processingOptions);

      updateSessionById(sessionId, (session) => ({
        ...session,
        processingOptions,
        lastModified: new Date(),
      }));
    },
    [updateSessionById, log]
  );

  const updateSessionReplacements = useCallback(
    (sessionId: string, replacements: ReplacementRule[]) => {
      updateSessionById(sessionId, (session) => ({
        ...session,
        replacements,
        lastModified: new Date(),
      }));
    },
    [updateSessionById]
  );

  const updateSessionStyles = useCallback(
    (sessionId: string, styles: SessionStyle[]) => {
      updateSessionById(sessionId, (session) => ({
        ...session,
        styles,
        lastModified: new Date(),
      }));
    },
    [updateSessionById]
  );

  const updateSessionListBulletSettings = useCallback(
    (sessionId: string, listBulletSettings: ListBulletSettings) => {
      updateSessionById(sessionId, (session) => ({
        ...session,
        listBulletSettings,
        lastModified: new Date(),
      }));
    },
    [updateSessionById]
  );

  const updateSessionTableUniformitySettings = useCallback(
    (sessionId: string, tableUniformitySettings: TableUniformitySettings) => {
      updateSessionById(sessionId, (session) => ({
        ...session,
        tableUniformitySettings,
        lastModified: new Date(),
      }));
    },
    [updateSessionById]
  );

  const updateSessionTableShadingSettings = useCallback(
    (sessionId: string, tableShadingSettings: TableShadingSettings) => {
      updateSessionById(sessionId, (session) => ({
        ...session,
        tableShadingSettings,
        lastModified: new Date(),
      }));
    },
    [updateSessionById]
  );

  const updateSessionTableOfContentsSettings = useCallback(
    (sessionId: string, tableOfContentsSettings: TableOfContentsSettings) => {
      log.info('[SessionContext] Updating Table of Contents settings for session:', sessionId);

      updateSessionById(sessionId, (session) => ({
        ...session,
        tableOfContentsSettings,
        lastModified: new Date(),
      }));
    },
    [updateSessionById, log]
  );

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

  // Reset session to factory defaults
  const resetSessionToDefaults = (sessionId: string) => {
    log.info('[SessionContext] Resetting session to defaults:', sessionId);

    updateSessionById(sessionId, (session) => ({
      ...session,
      styles: [...DEFAULT_SESSION_STYLES],
      listBulletSettings: createDefaultListBulletSettings(),
      processingOptions: {
        ...DEFAULT_PROCESSING_OPTIONS,
        enabledOperations: [...DEFAULT_PROCESSING_OPTIONS.enabledOperations],
      },
      tableShadingSettings: { ...DEFAULT_TABLE_SHADING_SETTINGS },
      lastModified: new Date(),
    }));

    log.info('[SessionContext] Session reset to defaults');
  };

  // Save current session settings as custom defaults for new sessions
  const saveAsCustomDefaults = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      log.error('[SessionContext] Session not found for saving defaults:', sessionId);
      return;
    }

    log.info('[SessionContext] Saving session settings as custom defaults:', sessionId);

    const customDefaults = {
      styles: session.styles,
      listBulletSettings: session.listBulletSettings,
      processingOptions: session.processingOptions,
      tableShadingSettings: session.tableShadingSettings,
    };

    const jsonString = safeJsonStringify(
      customDefaults,
      undefined,
      'SessionContext.saveAsCustomDefaults'
    );
    if (jsonString) {
      localStorage.setItem(CUSTOM_DEFAULTS_KEY, jsonString);
      log.info('[SessionContext] Custom defaults saved successfully');
    }
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
        updateSessionTableShadingSettings,
        updateSessionTableOfContentsSettings,
        saveSession,
        loadSessionFromStorage,
        resetSessionToDefaults,
        saveAsCustomDefaults,
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
