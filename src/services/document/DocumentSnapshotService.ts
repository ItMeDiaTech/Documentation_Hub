/**
 * DocumentSnapshotService - Manages pre-processing document snapshots in IndexedDB
 *
 * Captures document state before processing to enable:
 * - Side-by-side pre vs post processing comparison
 * - Restore/revert functionality
 * - Change visualization
 */

import logger from '@/utils/logger';
import type {
  DocumentSnapshot,
  SerializedDocumentSnapshot,
  HyperlinkSnapshot,
} from '@/types/editor';

const DB_NAME = 'DocHub_Snapshots';
const DB_VERSION = 1;
const SNAPSHOTS_STORE = 'documentSnapshots';

// Maximum age for snapshots (7 days in milliseconds)
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Maximum total storage for snapshots (100MB)
const MAX_STORAGE_BYTES = 100 * 1024 * 1024;

/**
 * Connection pool for snapshot database
 * Maintains singleton connection
 */
class SnapshotConnectionPool {
  private db: IDBDatabase | null = null;
  private isConnecting = false;
  private connectionPromise: Promise<IDBDatabase> | null = null;

  async getConnection(): Promise<IDBDatabase> {
    if (this.db) {
      try {
        // Health check
        const _ = this.db.objectStoreNames;
        return this.db;
      } catch {
        this.db = null;
      }
    }

    if (this.isConnecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    this.isConnecting = true;
    this.connectionPromise = this.createConnection();

    try {
      this.db = await this.connectionPromise;
      return this.db;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  private createConnection(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        logger.error('[SnapshotDB] Connection failed:', request.error);
        reject(new Error(`Failed to open snapshot database: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        const db = request.result;
        logger.info('[SnapshotDB] Connection established');

        db.onerror = (event) => {
          logger.error('[SnapshotDB] Database error:', event);
        };

        db.onclose = () => {
          logger.info('[SnapshotDB] Connection closed');
          this.db = null;
        };

        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create snapshots store if not exists
        if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
          const store = db.createObjectStore(SNAPSHOTS_STORE, {
            keyPath: ['sessionId', 'documentId'],
          });

          // Create indexes for queries
          store.createIndex('sessionId', 'sessionId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });

          logger.info('[SnapshotDB] Created document snapshots store');
        }
      };
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton connection pool
const connectionPool = new SnapshotConnectionPool();

// Close on window unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    connectionPool.close();
  });
}

/**
 * DocumentSnapshotService
 * Manages document snapshots for comparison functionality
 */
export class DocumentSnapshotService {
  /**
   * Capture a snapshot of a document before processing
   *
   * @param buffer - The original document ArrayBuffer
   * @param sessionId - Session identifier
   * @param documentId - Document identifier
   * @param textContent - Extracted paragraph text for diffing
   * @param hyperlinks - Hyperlink state for comparison
   */
  static async captureSnapshot(
    buffer: ArrayBuffer,
    sessionId: string,
    documentId: string,
    textContent: string[],
    hyperlinks: HyperlinkSnapshot[] = []
  ): Promise<void> {
    try {
      const db = await connectionPool.getConnection();

      const snapshot: SerializedDocumentSnapshot = {
        documentId,
        sessionId,
        timestamp: new Date().toISOString(),
        buffer,
        textContent,
        hyperlinkSnapshot: hyperlinks,
      };

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SNAPSHOTS_STORE], 'readwrite');
        const store = transaction.objectStore(SNAPSHOTS_STORE);

        // Use put to overwrite existing snapshot for same session/document
        const request = store.put(snapshot);

        request.onsuccess = () => {
          logger.info(
            `[SnapshotDB] Captured snapshot for document ${documentId} ` +
              `(${textContent.length} paragraphs, ${(buffer.byteLength / 1024).toFixed(1)}KB)`
          );
          resolve();
        };

        request.onerror = () => {
          logger.error('[SnapshotDB] Failed to capture snapshot:', request.error);
          reject(new Error(`Failed to capture snapshot: ${request.error?.message}`));
        };
      });
    } catch (error) {
      logger.error('[SnapshotDB] Error capturing snapshot:', error);
      throw error;
    }
  }

  /**
   * Get a snapshot for a specific document
   *
   * @param sessionId - Session identifier
   * @param documentId - Document identifier
   * @returns The snapshot or null if not found
   */
  static async getSnapshot(
    sessionId: string,
    documentId: string
  ): Promise<DocumentSnapshot | null> {
    try {
      const db = await connectionPool.getConnection();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SNAPSHOTS_STORE], 'readonly');
        const store = transaction.objectStore(SNAPSHOTS_STORE);
        const request = store.get([sessionId, documentId]);

        request.onsuccess = () => {
          const result = request.result as SerializedDocumentSnapshot | undefined;

          if (result) {
            // Deserialize timestamp
            const snapshot: DocumentSnapshot = {
              ...result,
              timestamp: new Date(result.timestamp),
            };
            resolve(snapshot);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => {
          logger.error('[SnapshotDB] Failed to get snapshot:', request.error);
          reject(new Error(`Failed to get snapshot: ${request.error?.message}`));
        };
      });
    } catch (error) {
      logger.error('[SnapshotDB] Error getting snapshot:', error);
      return null;
    }
  }

  /**
   * Delete a snapshot for a specific document
   *
   * @param sessionId - Session identifier
   * @param documentId - Document identifier
   */
  static async deleteSnapshot(sessionId: string, documentId: string): Promise<void> {
    try {
      const db = await connectionPool.getConnection();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SNAPSHOTS_STORE], 'readwrite');
        const store = transaction.objectStore(SNAPSHOTS_STORE);
        const request = store.delete([sessionId, documentId]);

        request.onsuccess = () => {
          logger.info(`[SnapshotDB] Deleted snapshot for document ${documentId}`);
          resolve();
        };

        request.onerror = () => {
          logger.error('[SnapshotDB] Failed to delete snapshot:', request.error);
          reject(new Error(`Failed to delete snapshot: ${request.error?.message}`));
        };
      });
    } catch (error) {
      logger.error('[SnapshotDB] Error deleting snapshot:', error);
      throw error;
    }
  }

  /**
   * Delete all snapshots for a session
   *
   * @param sessionId - Session identifier
   * @returns Number of snapshots deleted
   */
  static async cleanupSessionSnapshots(sessionId: string): Promise<number> {
    try {
      const db = await connectionPool.getConnection();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SNAPSHOTS_STORE], 'readwrite');
        const store = transaction.objectStore(SNAPSHOTS_STORE);
        const index = store.index('sessionId');
        const request = index.getAllKeys(sessionId);

        request.onsuccess = () => {
          const keys = request.result;
          let deletedCount = 0;

          if (keys.length === 0) {
            resolve(0);
            return;
          }

          for (const key of keys) {
            const deleteRequest = store.delete(key);
            deleteRequest.onsuccess = () => {
              deletedCount++;
              if (deletedCount === keys.length) {
                logger.info(`[SnapshotDB] Cleaned up ${deletedCount} snapshots for session ${sessionId}`);
                resolve(deletedCount);
              }
            };
          }
        };

        request.onerror = () => {
          reject(new Error(`Failed to cleanup session snapshots: ${request.error?.message}`));
        };
      });
    } catch (error) {
      logger.error('[SnapshotDB] Error cleaning up session snapshots:', error);
      return 0;
    }
  }

  /**
   * Clean up old snapshots (older than MAX_SNAPSHOT_AGE_MS)
   *
   * @returns Number of snapshots deleted
   */
  static async cleanupOldSnapshots(): Promise<number> {
    try {
      const db = await connectionPool.getConnection();
      const cutoffDate = new Date(Date.now() - MAX_SNAPSHOT_AGE_MS).toISOString();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SNAPSHOTS_STORE], 'readwrite');
        const store = transaction.objectStore(SNAPSHOTS_STORE);
        const index = store.index('timestamp');

        // Get all keys with timestamp before cutoff
        const range = IDBKeyRange.upperBound(cutoffDate);
        const request = index.getAllKeys(range);

        request.onsuccess = () => {
          const keys = request.result;
          let deletedCount = 0;

          if (keys.length === 0) {
            resolve(0);
            return;
          }

          for (const key of keys) {
            const deleteRequest = store.delete(key);
            deleteRequest.onsuccess = () => {
              deletedCount++;
              if (deletedCount === keys.length) {
                logger.info(`[SnapshotDB] Cleaned up ${deletedCount} old snapshots`);
                resolve(deletedCount);
              }
            };
          }
        };

        request.onerror = () => {
          reject(new Error(`Failed to cleanup old snapshots: ${request.error?.message}`));
        };
      });
    } catch (error) {
      logger.error('[SnapshotDB] Error cleaning up old snapshots:', error);
      return 0;
    }
  }

  /**
   * Get all snapshots for a session
   *
   * @param sessionId - Session identifier
   * @returns Array of snapshots
   */
  static async getSessionSnapshots(sessionId: string): Promise<DocumentSnapshot[]> {
    try {
      const db = await connectionPool.getConnection();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SNAPSHOTS_STORE], 'readonly');
        const store = transaction.objectStore(SNAPSHOTS_STORE);
        const index = store.index('sessionId');
        const request = index.getAll(sessionId);

        request.onsuccess = () => {
          const results = request.result as SerializedDocumentSnapshot[];
          const snapshots: DocumentSnapshot[] = results.map((r) => ({
            ...r,
            timestamp: new Date(r.timestamp),
          }));
          resolve(snapshots);
        };

        request.onerror = () => {
          reject(new Error(`Failed to get session snapshots: ${request.error?.message}`));
        };
      });
    } catch (error) {
      logger.error('[SnapshotDB] Error getting session snapshots:', error);
      return [];
    }
  }

  /**
   * Check if a snapshot exists for a document
   *
   * @param sessionId - Session identifier
   * @param documentId - Document identifier
   * @returns True if snapshot exists
   */
  static async hasSnapshot(sessionId: string, documentId: string): Promise<boolean> {
    const snapshot = await this.getSnapshot(sessionId, documentId);
    return snapshot !== null;
  }

  /**
   * Calculate total storage used by snapshots
   *
   * @returns Storage size in bytes
   */
  static async calculateStorageSize(): Promise<number> {
    try {
      const db = await connectionPool.getConnection();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SNAPSHOTS_STORE], 'readonly');
        const store = transaction.objectStore(SNAPSHOTS_STORE);
        const request = store.getAll();

        request.onsuccess = () => {
          const snapshots = request.result as SerializedDocumentSnapshot[];
          let totalSize = 0;

          for (const snapshot of snapshots) {
            // ArrayBuffer size
            totalSize += snapshot.buffer.byteLength;
            // Approximate JSON overhead
            totalSize += JSON.stringify({
              ...snapshot,
              buffer: null,
            }).length * 2; // UTF-16
          }

          resolve(totalSize);
        };

        request.onerror = () => {
          reject(new Error(`Failed to calculate storage size: ${request.error?.message}`));
        };
      });
    } catch (error) {
      logger.error('[SnapshotDB] Error calculating storage size:', error);
      return 0;
    }
  }

  /**
   * Get oldest snapshots sorted by timestamp
   * Used for cleanup when storage exceeds limits
   */
  static async getOldestSnapshots(limit: number): Promise<SerializedDocumentSnapshot[]> {
    try {
      const db = await connectionPool.getConnection();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SNAPSHOTS_STORE], 'readonly');
        const store = transaction.objectStore(SNAPSHOTS_STORE);
        const index = store.index('timestamp');
        const request = index.getAll();

        request.onsuccess = () => {
          const snapshots = request.result as SerializedDocumentSnapshot[];
          // Sort by timestamp (oldest first) and take limit
          const sorted = snapshots
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .slice(0, limit);
          resolve(sorted);
        };

        request.onerror = () => {
          reject(new Error(`Failed to get oldest snapshots: ${request.error?.message}`));
        };
      });
    } catch (error) {
      logger.error('[SnapshotDB] Error getting oldest snapshots:', error);
      return [];
    }
  }

  /**
   * Delete snapshots by session and document ID pairs
   */
  static async deleteSnapshots(
    snapshots: Array<{ sessionId: string; documentId: string }>
  ): Promise<number> {
    if (snapshots.length === 0) return 0;

    try {
      const db = await connectionPool.getConnection();
      let deletedCount = 0;

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([SNAPSHOTS_STORE], 'readwrite');
        const store = transaction.objectStore(SNAPSHOTS_STORE);

        for (const { sessionId, documentId } of snapshots) {
          const request = store.delete([sessionId, documentId]);
          request.onsuccess = () => {
            deletedCount++;
          };
        }

        transaction.oncomplete = () => {
          logger.info(`[SnapshotDB] Deleted ${deletedCount} snapshots`);
          resolve(deletedCount);
        };

        transaction.onerror = () => {
          reject(new Error(`Failed to delete snapshots: ${transaction.error?.message}`));
        };
      });
    } catch (error) {
      logger.error('[SnapshotDB] Error deleting snapshots:', error);
      return 0;
    }
  }

  /**
   * Ensure storage is within limits, cleaning up if necessary
   * Implements oldest-first deletion strategy
   */
  static async ensureStorageLimit(): Promise<void> {
    const currentSize = await this.calculateStorageSize();

    if (currentSize > MAX_STORAGE_BYTES) {
      logger.warn(
        `[SnapshotDB] Storage ${(currentSize / 1024 / 1024).toFixed(2)}MB ` +
          `exceeds limit ${(MAX_STORAGE_BYTES / 1024 / 1024).toFixed(0)}MB`
      );

      // First, clean up old snapshots (older than MAX_SNAPSHOT_AGE_MS)
      await this.cleanupOldSnapshots();

      // Check again and delete more if needed using oldest-first strategy
      let newSize = await this.calculateStorageSize();
      let iterationCount = 0;
      const maxIterations = 10; // Safety limit

      while (newSize > MAX_STORAGE_BYTES && iterationCount < maxIterations) {
        logger.warn('[SnapshotDB] Still over limit, deleting oldest snapshots');

        // Get oldest snapshots (batch of 5)
        const oldestSnapshots = await this.getOldestSnapshots(5);

        if (oldestSnapshots.length === 0) {
          logger.warn('[SnapshotDB] No more snapshots to delete');
          break;
        }

        // Delete oldest snapshots
        const toDelete = oldestSnapshots.map((s) => ({
          sessionId: s.sessionId,
          documentId: s.documentId,
        }));

        const deletedCount = await this.deleteSnapshots(toDelete);
        logger.info(`[SnapshotDB] Deleted ${deletedCount} oldest snapshots to free space`);

        // Recalculate size
        newSize = await this.calculateStorageSize();
        logger.debug(
          `[SnapshotDB] Size after cleanup: ${(newSize / 1024 / 1024).toFixed(2)}MB`
        );

        iterationCount++;
      }

      if (iterationCount >= maxIterations) {
        logger.warn('[SnapshotDB] Max cleanup iterations reached');
      } else if (newSize <= MAX_STORAGE_BYTES) {
        logger.info('[SnapshotDB] Storage now within limits');
      }
    }
  }
}

export default DocumentSnapshotService;
