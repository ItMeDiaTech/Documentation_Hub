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
