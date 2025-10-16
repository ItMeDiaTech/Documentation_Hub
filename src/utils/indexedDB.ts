/**
 * IndexedDB wrapper for session persistence
 * Provides a simple interface for storing and retrieving session data
 */

const DB_NAME = 'DocHubDB';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';

interface DBConfig {
  dbName: string;
  version: number;
}

/**
 * Opens or creates the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open database'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create sessions object store if it doesn't exist
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessionsStore = db.createObjectStore(SESSIONS_STORE, {
          keyPath: 'id',
        });
        // Create index for faster queries
        sessionsStore.createIndex('status', 'status', { unique: false });
        sessionsStore.createIndex('lastModified', 'lastModified', { unique: false });
      }
    };
  });
}

/**
 * Save a session to IndexedDB
 */
export async function saveSession(session: any): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SESSIONS_STORE], 'readwrite');
    const store = transaction.objectStore(SESSIONS_STORE);
    const request = store.put(session);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to save session: ${session.id}`));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Load all sessions from IndexedDB
 */
export async function loadSessions(): Promise<any[]> {
  const db = await openDB();

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

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Load a single session by ID from IndexedDB
 */
export async function loadSessionById(sessionId: string): Promise<any | null> {
  const db = await openDB();

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

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Delete a session from IndexedDB
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const db = await openDB();

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

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Delete all sessions from IndexedDB
 */
export async function clearAllSessions(): Promise<void> {
  const db = await openDB();

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

    transaction.oncomplete = () => {
      db.close();
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
      console.log('[IndexedDB] No sessions found in localStorage to migrate');
      return;
    }

    const sessions = JSON.parse(storedSessions);

    if (!Array.isArray(sessions) || sessions.length === 0) {
      console.log('[IndexedDB] No valid sessions to migrate');
      return;
    }

    console.log(`[IndexedDB] Migrating ${sessions.length} session(s) from localStorage...`);

    // Save all sessions to IndexedDB
    for (const session of sessions) {
      await saveSession(session);
    }

    console.log('[IndexedDB] Migration completed successfully');

    // Optionally remove from localStorage after successful migration
    // Uncomment the following line if you want to remove old data
    // localStorage.removeItem('sessions');

  } catch (error) {
    console.error('[IndexedDB] Migration failed:', error);
    throw error;
  }
}

/**
 * Get active session IDs from IndexedDB
 */
export async function getActiveSessionIds(): Promise<string[]> {
  const db = await openDB();

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

    transaction.oncomplete = () => {
      db.close();
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

    console.log(`[IndexedDB] Database size: ${sizeInMB.toFixed(2)}MB (${sessions.length} sessions)`);
    return sizeInMB;
  } catch (error) {
    console.error('[IndexedDB] Failed to calculate database size:', error);
    return 0;
  }
}

/**
 * Get oldest closed sessions sorted by closedAt date
 */
export async function getOldestClosedSessions(limit: number): Promise<any[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SESSIONS_STORE], 'readonly');
    const store = transaction.objectStore(SESSIONS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const sessions = request.result || [];

      // Filter closed sessions and sort by closedAt (oldest first)
      const closedSessions = sessions
        .filter((s: any) => s.status === 'closed' && s.closedAt)
        .sort((a: any, b: any) => {
          const dateA = new Date(a.closedAt).getTime();
          const dateB = new Date(b.closedAt).getTime();
          return dateA - dateB; // Oldest first
        })
        .slice(0, limit);

      resolve(closedSessions);
    };

    request.onerror = () => {
      reject(new Error('Failed to get oldest closed sessions'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Delete multiple sessions by their IDs
 */
export async function deleteSessions(sessionIds: string[]): Promise<number> {
  const db = await openDB();
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
      db.close();
      console.log(`[IndexedDB] Deleted ${deletedCount} session(s)`);
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

    console.log(`[IndexedDB] Database size (${currentSize.toFixed(2)}MB) exceeds limit (${maxSizeMB}MB)`);
    console.log('[IndexedDB] Starting cleanup of oldest closed sessions...');

    // Delete oldest closed sessions in batches until under limit
    let iterationCount = 0;
    const maxIterations = 10; // Safety limit

    while (iterationCount < maxIterations) {
      const oldestSessions = await getOldestClosedSessions(10); // Delete 10 at a time

      if (oldestSessions.length === 0) {
        console.log('[IndexedDB] No more closed sessions to delete');
        break;
      }

      const sessionIds = oldestSessions.map((s: any) => s.id);
      await deleteSessions(sessionIds);

      const newSize = await calculateDBSize();
      console.log(`[IndexedDB] Size after cleanup: ${newSize.toFixed(2)}MB`);

      if (newSize <= maxSizeMB) {
        console.log('[IndexedDB] Database size now under limit');
        break;
      }

      iterationCount++;
    }

    if (iterationCount >= maxIterations) {
      console.warn('[IndexedDB] Max cleanup iterations reached, size may still exceed limit');
    }

  } catch (error) {
    console.error('[IndexedDB] Failed to ensure database size limit:', error);
  }
}

/**
 * Truncate large change arrays in session documents
 * Prevents excessive storage of tracking data
 */
export function truncateSessionChanges(session: any, maxChanges: number = 100): any {
  if (!session.documents) {
    return session;
  }

  return {
    ...session,
    documents: session.documents.map((doc: any) => {
      if (doc.processingResult?.changes && doc.processingResult.changes.length > maxChanges) {
        return {
          ...doc,
          processingResult: {
            ...doc.processingResult,
            changes: doc.processingResult.changes.slice(0, maxChanges)
          }
        };
      }
      return doc;
    })
  };
}
