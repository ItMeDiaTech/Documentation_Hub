/**
 * DictionaryService - Main Process
 * Handles local SQLite database for document dictionary lookups
 *
 * This service runs in the Electron main process and provides O(1)
 * lookup performance for 100-200k+ document entries.
 *
 * @architecture Main Process Service
 * @security Context isolation compliant - no renderer access
 * @performance SQLite with WAL mode for fast reads
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { logger } from '../../src/utils/logger';
import type {
  DictionaryEntry,
  DictionaryLookupResult,
  DictionarySyncStatus,
} from '../../src/types/dictionary';

const log = logger.namespace('DictionaryService');

/**
 * Service for managing local document dictionary database
 */
export class DictionaryService {
  private db: Database.Database | null = null;
  private dbPath: string;
  private initialized: boolean = false;
  private syncStatus: DictionarySyncStatus = {
    enabled: false,
    lastSyncTime: null,
    lastSyncSuccess: false,
    totalEntries: 0,
    syncInProgress: false,
    syncProgress: 0,
    syncError: null,
    nextScheduledSync: null,
    fileHash: null,
  };

  constructor() {
    // Store database in app data directory
    this.dbPath = path.join(app.getPath('userData'), 'dictionary.db');
  }

  /**
   * Initialize the database and create tables if needed
   */
  async initialize(): Promise<{ success: boolean; totalEntries: number; error?: string }> {
    try {
      if (this.initialized && this.db) {
        const count = this.getEntryCount();
        return { success: true, totalEntries: count };
      }

      // Ensure directory exists
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

      // Open database with WAL mode for better performance
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = -64000'); // 64MB cache

      // Create tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS dictionary (
          Document_ID TEXT PRIMARY KEY,
          Content_ID TEXT,
          Title TEXT,
          Summary TEXT,
          Type TEXT,
          Release_Date TEXT,
          Expiration_Date TEXT,
          Status TEXT,
          Owner TEXT,
          BPO TEXT,
          LOB TEXT,
          Last_Published_By TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_content_id ON dictionary(Content_ID);
        CREATE INDEX IF NOT EXISTS idx_status ON dictionary(Status);

        CREATE TABLE IF NOT EXISTS sync_metadata (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      this.initialized = true;
      const count = this.getEntryCount();
      this.syncStatus.totalEntries = count;

      // Load sync metadata
      await this.loadSyncMetadata();

      log.info('Dictionary database initialized', { path: this.dbPath, entries: count });
      return { success: true, totalEntries: count };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to initialize dictionary database', { error: message });
      return { success: false, totalEntries: 0, error: message };
    }
  }

  /**
   * Lookup a single entry by Document_ID or Content_ID
   */
  lookup(lookupId: string): DictionaryLookupResult {
    if (!this.db || !this.initialized) {
      return { found: false, lookupId, lookupType: 'Document_ID' };
    }

    try {
      // First try Document_ID (primary key - fastest)
      let stmt = this.db.prepare('SELECT * FROM dictionary WHERE Document_ID = ?');
      let row = stmt.get(lookupId) as DictionaryEntry | undefined;

      if (row) {
        return {
          found: true,
          entry: row,
          lookupId,
          lookupType: 'Document_ID',
        };
      }

      // Try Content_ID (indexed)
      stmt = this.db.prepare('SELECT * FROM dictionary WHERE Content_ID = ?');
      row = stmt.get(lookupId) as DictionaryEntry | undefined;

      if (row) {
        return {
          found: true,
          entry: row,
          lookupId,
          lookupType: 'Content_ID',
        };
      }

      return { found: false, lookupId, lookupType: 'Document_ID' };
    } catch (error) {
      log.error('Lookup failed', { lookupId, error });
      return { found: false, lookupId, lookupType: 'Document_ID' };
    }
  }

  /**
   * Batch lookup multiple IDs for performance
   */
  batchLookup(lookupIds: string[]): Map<string, DictionaryLookupResult> {
    const results = new Map<string, DictionaryLookupResult>();

    if (!this.db || !this.initialized || lookupIds.length === 0) {
      lookupIds.forEach((id) => {
        results.set(id, { found: false, lookupId: id, lookupType: 'Document_ID' });
      });
      return results;
    }

    try {
      // Prepare statements once for reuse
      const docIdStmt = this.db.prepare('SELECT * FROM dictionary WHERE Document_ID = ?');
      const contentIdStmt = this.db.prepare('SELECT * FROM dictionary WHERE Content_ID = ?');

      for (const lookupId of lookupIds) {
        // Try Document_ID first
        let row = docIdStmt.get(lookupId) as DictionaryEntry | undefined;

        if (row) {
          results.set(lookupId, {
            found: true,
            entry: row,
            lookupId,
            lookupType: 'Document_ID',
          });
          continue;
        }

        // Try Content_ID
        row = contentIdStmt.get(lookupId) as DictionaryEntry | undefined;

        if (row) {
          results.set(lookupId, {
            found: true,
            entry: row,
            lookupId,
            lookupType: 'Content_ID',
          });
          continue;
        }

        // Not found
        results.set(lookupId, { found: false, lookupId, lookupType: 'Document_ID' });
      }

      return results;
    } catch (error) {
      log.error('Batch lookup failed', { count: lookupIds.length, error });
      lookupIds.forEach((id) => {
        if (!results.has(id)) {
          results.set(id, { found: false, lookupId: id, lookupType: 'Document_ID' });
        }
      });
      return results;
    }
  }

  /**
   * Import entries from parsed Excel data
   * Uses transaction for performance with large datasets
   */
  importEntries(
    entries: DictionaryEntry[],
    onProgress?: (processed: number, total: number) => void
  ): { success: boolean; imported: number; error?: string } {
    if (!this.db || !this.initialized) {
      return { success: false, imported: 0, error: 'Database not initialized' };
    }

    try {
      const insertStmt = this.db.prepare(`
        INSERT OR REPLACE INTO dictionary (
          Document_ID, Content_ID, Title, Summary, Type,
          Release_Date, Expiration_Date, Status, Owner, BPO, LOB, Last_Published_By
        ) VALUES (
          @Document_ID, @Content_ID, @Title, @Summary, @Type,
          @Release_Date, @Expiration_Date, @Status, @Owner, @BPO, @LOB, @Last_Published_By
        )
      `);

      // Use transaction for performance
      const importMany = this.db.transaction((items: DictionaryEntry[]) => {
        let count = 0;
        for (const entry of items) {
          insertStmt.run(entry);
          count++;
          if (onProgress && count % 1000 === 0) {
            onProgress(count, items.length);
          }
        }
        return count;
      });

      const imported = importMany(entries);

      // Update sync status
      this.syncStatus.totalEntries = this.getEntryCount();
      this.syncStatus.lastSyncTime = new Date().toISOString();
      this.syncStatus.lastSyncSuccess = true;
      this.syncStatus.syncError = null;

      // Save sync metadata
      this.saveSyncMetadata();

      log.info('Imported dictionary entries', { imported, total: this.syncStatus.totalEntries });
      return { success: true, imported };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Import failed', { error: message, entriesCount: entries.length });
      this.syncStatus.syncError = message;
      this.syncStatus.lastSyncSuccess = false;
      return { success: false, imported: 0, error: message };
    }
  }

  /**
   * Clear all entries from the dictionary
   */
  clearEntries(): { success: boolean; error?: string } {
    if (!this.db || !this.initialized) {
      return { success: false, error: 'Database not initialized' };
    }

    try {
      this.db.exec('DELETE FROM dictionary');
      this.syncStatus.totalEntries = 0;
      log.info('Cleared all dictionary entries');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Clear failed', { error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Get current sync status
   */
  getSyncStatus(): DictionarySyncStatus {
    return { ...this.syncStatus };
  }

  /**
   * Update sync status
   */
  updateSyncStatus(updates: Partial<DictionarySyncStatus>): void {
    this.syncStatus = { ...this.syncStatus, ...updates };
  }

  /**
   * Get entry count
   */
  getEntryCount(): number {
    if (!this.db || !this.initialized) {
      return 0;
    }

    try {
      const result = this.db.prepare('SELECT COUNT(*) as count FROM dictionary').get() as {
        count: number;
      };
      return result.count;
    } catch {
      return 0;
    }
  }

  /**
   * Set metadata value
   */
  setMetadata(key: string, value: string): void {
    if (!this.db || !this.initialized) return;

    try {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)'
      );
      stmt.run(key, value);
    } catch (error) {
      log.error('Failed to set metadata', { key, error });
    }
  }

  /**
   * Get metadata value
   */
  getMetadata(key: string): string | null {
    if (!this.db || !this.initialized) return null;

    try {
      const stmt = this.db.prepare('SELECT value FROM sync_metadata WHERE key = ?');
      const row = stmt.get(key) as { value: string } | undefined;
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      log.info('Dictionary database closed');
    }
  }

  /**
   * Load sync metadata from database
   */
  private async loadSyncMetadata(): Promise<void> {
    const lastSyncTime = this.getMetadata('lastSyncTime');
    const lastSyncSuccess = this.getMetadata('lastSyncSuccess');
    const fileHash = this.getMetadata('fileHash');

    if (lastSyncTime) this.syncStatus.lastSyncTime = lastSyncTime;
    if (lastSyncSuccess) this.syncStatus.lastSyncSuccess = lastSyncSuccess === 'true';
    if (fileHash) this.syncStatus.fileHash = fileHash;
  }

  /**
   * Save sync metadata to database
   */
  private saveSyncMetadata(): void {
    if (this.syncStatus.lastSyncTime) {
      this.setMetadata('lastSyncTime', this.syncStatus.lastSyncTime);
    }
    this.setMetadata('lastSyncSuccess', String(this.syncStatus.lastSyncSuccess));
    if (this.syncStatus.fileHash) {
      this.setMetadata('fileHash', this.syncStatus.fileHash);
    }
  }
}

// Singleton instance
let dictionaryServiceInstance: DictionaryService | null = null;

export function getDictionaryService(): DictionaryService {
  if (!dictionaryServiceInstance) {
    dictionaryServiceInstance = new DictionaryService();
  }
  return dictionaryServiceInstance;
}
