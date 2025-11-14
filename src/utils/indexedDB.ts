/**
 * IndexedDB wrapper for session persistence
 * Provides a simple interface for storing and retrieving session data
 */

import logger from './logger';
import { safeJsonParse } from './safeJsonParse';
import type { Session, Document as SessionDocument } from '@/types/session';

const DB_NAME = 'DocHubDB';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';

interface DBConfig {
  dbName: string;
  version: number;
}

// Serialized session type for IndexedDB (dates as ISO strings)
type SerializedDocument = Omit<SessionDocument, 'processedAt'> & {
  processedAt?: string;
};

type SerializedSession = Omit<Session, 'createdAt' | 'lastModified' | 'closedAt' | 'documents'> & {
  createdAt: string;
  lastModified: string;
  closedAt?: string;
  documents: SerializedDocument[];
};

/**
 * Connection Pool Manager for IndexedDB
 * Maintains a single connection throughout the app lifecycle
 * Provides automatic reconnection on failure
 */
class IndexedDBConnectionPool {
  private db: IDBDatabase | null = null;
  private isConnecting = false;
  private connectionPromise: Promise<IDBDatabase> | null = null;
  private lastError: Error | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 1000; // 1 second

  /**
   * Get database connection (creates if not exists)
   * Uses singleton pattern to ensure only one connection
   */
  async getConnection(): Promise<IDBDatabase> {
    // If we have a valid connection, return it
    if (this.db && this.db.objectStoreNames.length > 0) {
      // Check if connection is still valid
      try {
        // Simple health check - access object store names
        const _ = this.db.objectStoreNames;
        return this.db;
      } catch (error) {
        logger.warn('[IndexedDB Pool] Connection invalid, reconnecting...');
        this.db = null;
      }
    }

    // If already connecting, wait for that connection
    if (this.isConnecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    // Create new connection
    this.isConnecting = true;
    this.connectionPromise = this.createConnection();

    try {
      this.db = await this.connectionPromise;
      this.reconnectAttempts = 0; // Reset on successful connection
      return this.db;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  /**
   * Create a new database connection
   */
  private createConnection(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        const error = new Error(
          `Failed to open database: ${request.error?.message || 'Unknown error'}`
        );
        this.lastError = error;
        logger.error('[IndexedDB Pool] Connection failed:', error);
        reject(error);
      };

      request.onsuccess = () => {
        const db = request.result;
        logger.info('[IndexedDB Pool] Connection established');

        // Set up connection error handlers
        db.onerror = (event) => {
          logger.error('[IndexedDB Pool] Database error:', event);
          this.handleConnectionError();
        };

        db.onclose = () => {
          logger.info('[IndexedDB Pool] Connection closed');
          this.db = null;
        };

        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create sessions object store if it doesn't exist
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          const sessionsStore = db.createObjectStore(SESSIONS_STORE, {
            keyPath: 'id',
          });
          // Create indexes for faster queries
          sessionsStore.createIndex('status', 'status', { unique: false });
          sessionsStore.createIndex('lastModified', 'lastModified', { unique: false });
          sessionsStore.createIndex('createdAt', 'createdAt', { unique: false });

          logger.info('[IndexedDB Pool] Database upgraded to version', DB_VERSION);
        }
      };

      request.onblocked = () => {
        logger.warn('[IndexedDB Pool] Database upgrade blocked by other tabs');
      };
    });
  }

  /**
   * Handle connection errors with automatic retry
   */
  private async handleConnectionError(): Promise<void> {
    this.db = null;

    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      logger.info(
        `[IndexedDB Pool] Attempting reconnection (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`
      );

      // Wait before reconnecting
      await new Promise((resolve) =>
        setTimeout(resolve, this.RECONNECT_DELAY * this.reconnectAttempts)
      );

      try {
        await this.getConnection();
        logger.info('[IndexedDB Pool] Reconnection successful');
      } catch (error) {
        logger.error('[IndexedDB Pool] Reconnection failed:', error);
      }
    } else {
      logger.error('[IndexedDB Pool] Max reconnection attempts reached');
    }
  }

  /**
   * Close the database connection (for cleanup)
   */
  close(): void {
    if (this.db) {
      logger.info('[IndexedDB Pool] Closing connection');
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    connected: boolean;
    reconnectAttempts: number;
    lastError: Error | null;
  } {
    return {
      connected: this.db !== null,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
    };
  }
}

// Create singleton instance
const connectionPool = new IndexedDBConnectionPool();

/**
 * GlobalStats Connection Pool Manager for IndexedDB
 * Maintains a single connection for GlobalStats database
 * Separate from main connection pool to avoid cross-database issues
 */
class GlobalStatsConnectionPool {
  private db: IDBDatabase | null = null;
  private isConnecting = false;
  private connectionPromise: Promise<IDBDatabase> | null = null;
  private lastError: Error | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 1000; // 1 second

  private readonly DB_NAME = 'DocHub_GlobalStats';
  private readonly DB_VERSION = 1;
  private readonly STATS_STORE = 'stats';

  /**
   * Get database connection (creates if not exists)
   * Uses singleton pattern to ensure only one connection
   */
  async getConnection(): Promise<IDBDatabase> {
    // If we have a valid connection, return it
    if (this.db && this.db.objectStoreNames.length > 0) {
      // Check if connection is still valid
      try {
        // Simple health check - access object store names
        const _ = this.db.objectStoreNames;
        return this.db;
      } catch (error) {
        logger.warn('[GlobalStats Pool] Connection invalid, reconnecting...');
        this.db = null;
      }
    }

    // If already connecting, wait for that connection
    if (this.isConnecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    // Create new connection
    this.isConnecting = true;
    this.connectionPromise = this.createConnection();

    try {
      this.db = await this.connectionPromise;
      this.reconnectAttempts = 0; // Reset on successful connection
      return this.db;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  /**
   * Create a new database connection
   */
  private createConnection(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        const error = new Error(
          `Failed to open GlobalStats database: ${request.error?.message || 'Unknown error'}`
        );
        this.lastError = error;
        logger.error('[GlobalStats Pool] Connection failed:', error);
        reject(error);
      };

      request.onsuccess = () => {
        const db = request.result;
        logger.info('[GlobalStats Pool] Connection established');

        // Set up connection error handlers
        db.onerror = (event) => {
          logger.error('[GlobalStats Pool] Database error:', event);
          this.handleConnectionError();
        };

        db.onclose = () => {
          logger.info('[GlobalStats Pool] Connection closed');
          this.db = null;
        };

        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create stats object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.STATS_STORE)) {
          db.createObjectStore(this.STATS_STORE);
          logger.info('[GlobalStats Pool] Database upgraded to version', this.DB_VERSION);
        }
      };

      request.onblocked = () => {
        logger.warn('[GlobalStats Pool] Database upgrade blocked by other tabs');
      };
    });
  }

  /**
   * Handle connection errors with automatic retry
   */
  private async handleConnectionError(): Promise<void> {
    this.db = null;

    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      logger.info(
        `[GlobalStats Pool] Attempting reconnection (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`
      );

      // Wait before reconnecting
      await new Promise((resolve) =>
        setTimeout(resolve, this.RECONNECT_DELAY * this.reconnectAttempts)
      );

      try {
        await this.getConnection();
        logger.info('[GlobalStats Pool] Reconnection successful');
      } catch (error) {
        logger.error('[GlobalStats Pool] Reconnection failed:', error);
      }
    } else {
      logger.error('[GlobalStats Pool] Max reconnection attempts reached');
    }
  }

  /**
   * Close the database connection (for cleanup)
   */
  close(): void {
    if (this.db) {
      logger.info('[GlobalStats Pool] Closing connection');
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    connected: boolean;
    reconnectAttempts: number;
    lastError: Error | null;
  } {
    return {
      connected: this.db !== null,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
    };
  }
}

// Create singleton instance for GlobalStats
const globalStatsConnectionPool = new GlobalStatsConnectionPool();

// Close connections on window unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    connectionPool.close();
    globalStatsConnectionPool.close();
  });
}

/**
 * Get pooled database connection
 * @deprecated Use connectionPool.getConnection() instead
 */
async function openDB(): Promise<IDBDatabase> {
  return connectionPool.getConnection();
}

/**
 * Save a session to IndexedDB with quota error recovery
 * Uses connection pool for better performance
 * Handles QuotaExceededError by triggering cleanup
 */
export async function saveSession(session: SerializedSession): Promise<void> {
  const db = await connectionPool.getConnection();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SESSIONS_STORE], 'readwrite');
    const store = transaction.objectStore(SESSIONS_STORE);
    const request = store.put(session);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      const error = request.error;
      // Check if this is a quota exceeded error
      if (error?.name === 'QuotaExceededError') {
        logger.error(`[IndexedDB] Quota exceeded for session: ${session.id}`);
        reject(new Error('DATABASE_QUOTA_EXCEEDED'));
      } else {
        reject(new Error(`Failed to save session: ${session.id}`));
      }
    };

    transaction.onerror = () => {
      const error = transaction.error;
      if (error?.name === 'QuotaExceededError') {
        logger.error(`[IndexedDB] Transaction quota exceeded for session: ${session.id}`);
        reject(new Error('DATABASE_QUOTA_EXCEEDED'));
      } else {
        reject(new Error(`Transaction failed for session: ${session.id}`));
      }
    };
  });
}

/**
 * Load all sessions from IndexedDB
 * Uses connection pool for better performance
 */
export async function loadSessions(): Promise<SerializedSession[]> {
  const db = await connectionPool.getConnection();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SESSIONS_STORE], 'readonly');
    const store = transaction.objectStore(SESSIONS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error('Failed to load sessions'));
    };
  });
}

/**
 * Load a single session by ID from IndexedDB
 * Uses connection pool for better performance
 */
export async function loadSessionById(sessionId: string): Promise<any | null> {
  const db = await connectionPool.getConnection();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SESSIONS_STORE], 'readonly');
    const store = transaction.objectStore(SESSIONS_STORE);
    const request = store.get(sessionId);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(new Error(`Failed to load session: ${sessionId}`));
    };
  });
}

/**
 * Delete a session from IndexedDB
 * Uses connection pool for better performance
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const db = await connectionPool.getConnection();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SESSIONS_STORE], 'readwrite');
    const store = transaction.objectStore(SESSIONS_STORE);
    const request = store.delete(sessionId);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to delete session: ${sessionId}`));
    };
  });
}

/**
 * Delete all sessions from IndexedDB
 * Uses connection pool for better performance
 */
export async function clearAllSessions(): Promise<void> {
  const db = await connectionPool.getConnection();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SESSIONS_STORE], 'readwrite');
    const store = transaction.objectStore(SESSIONS_STORE);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to clear sessions'));
    };
  });
}

/**
 * Migrate data from localStorage to IndexedDB
 * This is a one-time migration helper
 */
export async function migrateFromLocalStorage(): Promise<void> {
  try {
    const storedSessions = localStorage.getItem('sessions');

    if (!storedSessions) {
      logger.debug('[IndexedDB] No sessions found in localStorage to migrate');
      return;
    }

    const sessions = safeJsonParse<SerializedSession[]>(
      storedSessions,
      [],
      'localStorage migration'
    );

    if (!Array.isArray(sessions) || sessions.length === 0) {
      logger.debug('[IndexedDB] No valid sessions to migrate');
      return;
    }

    logger.info(`[IndexedDB] Migrating ${sessions.length} session(s) from localStorage...`);

    // Save all sessions to IndexedDB
    for (const session of sessions) {
      await saveSession(session);
    }

    logger.info('[IndexedDB] Migration completed successfully');

    // Optionally remove from localStorage after successful migration
    // Uncomment the following line if you want to remove old data
    // localStorage.removeItem('sessions');
  } catch (error) {
    logger.error('[IndexedDB] Migration failed:', error);
    throw error;
  }
}

/**
 * Get active session IDs from IndexedDB
 * Uses connection pool for better performance
 */
export async function getActiveSessionIds(): Promise<string[]> {
  const db = await connectionPool.getConnection();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SESSIONS_STORE], 'readonly');
    const store = transaction.objectStore(SESSIONS_STORE);
    const index = store.index('status');
    const request = index.getAllKeys('active');

    request.onsuccess = () => {
      resolve(request.result as string[]);
    };

    request.onerror = () => {
      reject(new Error('Failed to get active session IDs'));
    };
  });
}

/**
 * Calculate approximate database size in MB
 * Uses JSON string length as proxy for storage size
 */
export async function calculateDBSize(): Promise<number> {
  try {
    const sessions = await loadSessions();
    const jsonString = JSON.stringify(sessions);
    const sizeInBytes = new Blob([jsonString]).size;
    const sizeInMB = sizeInBytes / (1024 * 1024);

    logger.debug(
      `[IndexedDB] Database size: ${sizeInMB.toFixed(2)}MB (${sessions.length} sessions)`
    );
    return sizeInMB;
  } catch (error) {
    logger.error('[IndexedDB] Failed to calculate database size:', error);
    return 0;
  }
}

/**
 * Get oldest closed sessions sorted by closedAt date
 * Uses connection pool for better performance
 */
export async function getOldestClosedSessions(limit: number): Promise<SerializedSession[]> {
  const db = await connectionPool.getConnection();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SESSIONS_STORE], 'readonly');
    const store = transaction.objectStore(SESSIONS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const sessions = request.result || [];

      // Filter closed sessions and sort by closedAt (oldest first)
      const closedSessions = sessions
        .filter((s: SerializedSession) => s.status === 'closed' && s.closedAt)
        .sort((a: SerializedSession, b: SerializedSession) => {
          // closedAt is guaranteed to exist from the filter above
          const dateA = new Date(a.closedAt!).getTime();
          const dateB = new Date(b.closedAt!).getTime();
          return dateA - dateB; // Oldest first
        })
        .slice(0, limit);

      resolve(closedSessions);
    };

    request.onerror = () => {
      reject(new Error('Failed to get oldest closed sessions'));
    };
  });
}

/**
 * Delete multiple sessions by their IDs
 * Uses connection pool for better performance
 */
export async function deleteSessions(sessionIds: string[]): Promise<number> {
  const db = await connectionPool.getConnection();
  let deletedCount = 0;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SESSIONS_STORE], 'readwrite');
    const store = transaction.objectStore(SESSIONS_STORE);

    for (const sessionId of sessionIds) {
      const request = store.delete(sessionId);
      request.onsuccess = () => {
        deletedCount++;
      };
    }

    transaction.oncomplete = () => {
      logger.info(`[IndexedDB] Deleted ${deletedCount} session(s)`);
      resolve(deletedCount);
    };

    transaction.onerror = () => {
      reject(new Error('Failed to delete sessions'));
    };
  });
}

/**
 * Clean up database when it exceeds size limit
 * Removes oldest closed sessions until under the limit
 */
export async function ensureDBSizeLimit(maxSizeMB: number = 200): Promise<void> {
  try {
    const currentSize = await calculateDBSize();

    if (currentSize <= maxSizeMB) {
      return; // Within limits
    }

    logger.warn(
      `[IndexedDB] Database size (${currentSize.toFixed(2)}MB) exceeds limit (${maxSizeMB}MB)`
    );
    logger.info('[IndexedDB] Starting cleanup of oldest closed sessions...');

    // Delete oldest closed sessions in batches until under limit
    let iterationCount = 0;
    const maxIterations = 10; // Safety limit

    while (iterationCount < maxIterations) {
      const oldestSessions = await getOldestClosedSessions(10); // Delete 10 at a time

      if (oldestSessions.length === 0) {
        logger.debug('[IndexedDB] No more closed sessions to delete');
        break;
      }

      const sessionIds = oldestSessions.map((s: SerializedSession) => s.id);
      await deleteSessions(sessionIds);

      const newSize = await calculateDBSize();
      logger.debug(`[IndexedDB] Size after cleanup: ${newSize.toFixed(2)}MB`);

      if (newSize <= maxSizeMB) {
        logger.info('[IndexedDB] Database size now under limit');
        break;
      }

      iterationCount++;
    }

    if (iterationCount >= maxIterations) {
      logger.warn('[IndexedDB] Max cleanup iterations reached, size may still exceed limit');
    }
  } catch (error) {
    logger.error('[IndexedDB] Failed to ensure database size limit:', error);
  }
}

/**
 * Truncate large change arrays in session documents
 * Prevents excessive storage of tracking data
 */
export function truncateSessionChanges(
  session: SerializedSession,
  maxChanges: number = 100
): SerializedSession {
  if (!session.documents) {
    return session;
  }

  return {
    ...session,
    documents: session.documents.map((doc: SerializedDocument) => {
      if (doc.processingResult?.changes && doc.processingResult.changes.length > maxChanges) {
        return {
          ...doc,
          processingResult: {
            ...doc.processingResult,
            changes: doc.processingResult.changes.slice(0, maxChanges),
          },
        };
      }
      return doc;
    }),
  };
}

/**
 * Export connection pool for advanced use cases
 * Provides direct access to the pooled connection
 */
export const getConnectionPool = () => connectionPool;

/**
 * Get database performance statistics
 */
export async function getDBPerformanceStats(): Promise<{
  connected: boolean;
  reconnectAttempts: number;
  lastError: Error | null;
  sessionCount?: number;
  estimatedSizeMB?: number;
}> {
  const poolStats = connectionPool.getStats();

  try {
    const sessions = await loadSessions();
    const sizeMB = await calculateDBSize();

    return {
      ...poolStats,
      sessionCount: sessions.length,
      estimatedSizeMB: sizeMB,
    };
  } catch (error) {
    return {
      ...poolStats,
      sessionCount: 0,
      estimatedSizeMB: 0,
    };
  }
}

/**
 * Handle quota exceeded errors with automatic cleanup and retry
 * Attempts to free up space and retry the operation
 */
export async function handleQuotaExceededError(
  operation: () => Promise<void>,
  sessionId: string,
  maxRetries: number = 2
): Promise<void> {
  let retries = 0;

  while (retries <= maxRetries) {
    try {
      await operation();
      return; // Success
    } catch (error) {
      if (error instanceof Error && error.message === 'DATABASE_QUOTA_EXCEEDED') {
        if (retries < maxRetries) {
          logger.warn(
            `[IndexedDB] Quota exceeded, attempting cleanup (attempt ${retries + 1}/${maxRetries})`
          );

          // Aggressive cleanup - delete oldest closed sessions
          const oldestSessions = await getOldestClosedSessions(20);
          if (oldestSessions.length > 0) {
            const sessionIds = oldestSessions.map((s: SerializedSession) => s.id);
            await deleteSessions(sessionIds);
            logger.info(`[IndexedDB] Deleted ${oldestSessions.length} session(s) to free up space`);
          } else {
            // No more closed sessions, truncate active sessions' change history
            const sessions = await loadSessions();
            const activeSessions = sessions.filter((s: SerializedSession) => s.status === 'active');

            for (const session of activeSessions.slice(0, 5)) {
              const truncated = truncateSessionChanges(session, 50);
              await saveSession(truncated);
            }
            logger.info('[IndexedDB] Truncated change history in active sessions');
          }

          retries++;
        } else {
          // Max retries exceeded, throw error with guidance
          const sizeMB = await calculateDBSize();
          const error = new Error(
            `DATABASE_QUOTA_EXCEEDED_PERMANENTLY: Database is ${sizeMB.toFixed(2)}MB. ` +
              `Please archive old sessions or export data to free up space.`
          );
          logger.error('[IndexedDB] Permanent quota exceeded:', error);
          throw error;
        }
      } else {
        // Not a quota error, re-throw
        throw error;
      }
    }
  }
}

/**
 * ========================================
 * GlobalStats Database Helper Functions
 * ========================================
 * These functions provide a simple interface for GlobalStats persistence
 * Uses the globalStatsConnectionPool for consistent connection management
 */

// Import GlobalStats types
import type { GlobalStats } from '@/types/globalStats';

const STATS_STORE = 'stats';
const STATS_KEY = 'global';

/**
 * Load global statistics from IndexedDB
 * Uses connection pool for better performance and reliability
 */
export async function loadGlobalStats(): Promise<GlobalStats | null> {
  try {
    const db = await globalStatsConnectionPool.getConnection();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STATS_STORE], 'readonly');
      const store = transaction.objectStore(STATS_STORE);
      const request = store.get(STATS_KEY);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(new Error('Failed to load global stats'));
      };
    });
  } catch (error) {
    logger.error('[GlobalStats] Failed to load stats:', error);
    throw error;
  }
}

/**
 * Save global statistics to IndexedDB
 * Uses connection pool for better performance and reliability
 */
export async function saveGlobalStats(stats: GlobalStats): Promise<void> {
  try {
    const db = await globalStatsConnectionPool.getConnection();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STATS_STORE], 'readwrite');
      const store = transaction.objectStore(STATS_STORE);
      const request = store.put(stats, STATS_KEY);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error('Failed to save global stats'));
      };
    });
  } catch (error) {
    logger.error('[GlobalStats] Failed to save stats:', error);
    throw error;
  }
}

/**
 * Reset global statistics to default values
 * Uses connection pool for better performance and reliability
 */
export async function resetGlobalStats(freshStats: GlobalStats): Promise<void> {
  try {
    await saveGlobalStats(freshStats);
    logger.info('[GlobalStats] Stats reset to default values');
  } catch (error) {
    logger.error('[GlobalStats] Failed to reset stats:', error);
    throw error;
  }
}

/**
 * Export the global stats connection pool for advanced use cases
 */
export const getGlobalStatsConnectionPool = () => globalStatsConnectionPool;
