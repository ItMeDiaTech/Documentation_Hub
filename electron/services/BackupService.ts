/**
 * BackupService - Main Process
 * Handles document backup and restoration with automatic cleanup
 *
 * This service runs in the Electron main process and provides secure
 * file system operations via IPC. It implements the backup strategy
 * for document processing operations.
 *
 * @architecture Main Process Service
 * @security Context isolation compliant - no renderer access
 * @performance IPC overhead: ~1-5ms per operation
 */

import { createHash } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { app } from 'electron';

/**
 * Service for managing document backups in the main process
 */
export class BackupService {
  private backupDir: string;
  private maxBackupAge: number = 7 * 24 * 60 * 60 * 1000; // 7 days
  private maxBackupsPerDocument: number = 5;

  constructor() {
    // Use app data directory for backups
    // In main process, we can access os and path directly
    this.backupDir = path.join(os.homedir(), '.dochub', 'backups');
    this.ensureBackupDirectory();
  }

  /**
   * Create a backup of the document
   *
   * @param documentPath Absolute path to document to backup
   * @returns Promise resolving to backup file path
   * @throws Error if backup creation fails
   */
  async createBackup(documentPath: string): Promise<string> {
    try {
      // Validate input path
      if (!documentPath || typeof documentPath !== 'string') {
        throw new Error('Invalid document path');
      }

      // Read original document
      const documentData = await fs.readFile(documentPath);

      // Generate backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const originalName = path.basename(documentPath, path.extname(documentPath));
      const extension = path.extname(documentPath);
      const hash = this.generateHash(documentData).substring(0, 8);
      const backupName = `${originalName}_${timestamp}_${hash}${extension}`;
      const backupPath = path.join(this.backupDir, backupName);

      // Create backup
      await fs.writeFile(backupPath, documentData);

      // Store backup metadata
      await this.saveBackupMetadata(documentPath, backupPath, {
        originalPath: documentPath,
        backupPath,
        timestamp: new Date().toISOString(),
        size: documentData.length,
        checksum: this.generateHash(documentData),
      });

      // Clean up old backups
      await this.cleanupOldBackups(documentPath);

      console.log(`[BackupService] Created backup: ${backupPath}`);
      return backupPath;
    } catch (error) {
      const message = `Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[BackupService] ${message}`);
      throw new Error(message);
    }
  }

  /**
   * Restore document from backup
   *
   * @param backupPath Path to backup file
   * @param targetPath Path where document should be restored
   * @throws Error if restoration fails or integrity check fails
   */
  async restoreBackup(backupPath: string, targetPath: string): Promise<void> {
    try {
      // Validate inputs
      if (!backupPath || !targetPath) {
        throw new Error('Invalid backup or target path');
      }

      // Verify backup exists
      await fs.access(backupPath);

      // Read backup data
      const backupData = await fs.readFile(backupPath);

      // Verify integrity
      const metadata = await this.getBackupMetadata(backupPath);
      if (metadata) {
        const currentChecksum = this.generateHash(backupData);
        if (currentChecksum !== metadata.checksum) {
          throw new Error('Backup integrity check failed - file may be corrupted');
        }
      }

      // Restore to target path
      await fs.writeFile(targetPath, backupData);

      console.log(`[BackupService] Restored backup from ${backupPath} to ${targetPath}`);
    } catch (error) {
      const message = `Failed to restore backup: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[BackupService] ${message}`);
      throw new Error(message);
    }
  }

  /**
   * List all backups for a document
   *
   * @param documentPath Path to document
   * @returns Promise resolving to array of backup info, sorted by creation date (newest first)
   */
  async listBackups(documentPath: string): Promise<BackupInfo[]> {
    try {
      const files = await fs.readdir(this.backupDir);
      const documentName = path.basename(documentPath, path.extname(documentPath));
      const backups: BackupInfo[] = [];

      for (const file of files) {
        if (file.startsWith(documentName) && !file.endsWith('.meta')) {
          const filePath = path.join(this.backupDir, file);
          const stats = await fs.stat(filePath);
          const metadata = await this.getBackupMetadata(filePath);

          backups.push({
            path: filePath,
            filename: file,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            originalPath: metadata?.originalPath || documentPath,
            checksum: metadata?.checksum,
          });
        }
      }

      // Sort by creation date (newest first)
      return backups.sort((a, b) => b.created.getTime() - a.created.getTime());
    } catch (error) {
      console.error('[BackupService] Failed to list backups:', error);
      return [];
    }
  }

  /**
   * Delete a specific backup
   *
   * @param backupPath Path to backup file to delete
   * @throws Error if deletion fails
   */
  async deleteBackup(backupPath: string): Promise<void> {
    try {
      await fs.unlink(backupPath);

      // Delete metadata file
      const metadataPath = `${backupPath}.meta`;
      try {
        await fs.unlink(metadataPath);
      } catch {
        // Metadata file might not exist - ignore
      }

      console.log(`[BackupService] Deleted backup: ${backupPath}`);
    } catch (error) {
      const message = `Failed to delete backup: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[BackupService] ${message}`);
      throw new Error(message);
    }
  }

  /**
   * Clean up old backups for a document
   *
   * Removes backups that are:
   * - Older than maxBackupAge (default 7 days)
   * - Exceed maxBackupsPerDocument count (default 5)
   *
   * @param documentPath Path to document
   * @returns Promise resolving to number of backups deleted
   */
  async cleanupOldBackups(documentPath: string): Promise<number> {
    const backups = await this.listBackups(documentPath);
    let deletedCount = 0;
    const now = Date.now();

    // Sort by creation date (newest first)
    const sortedBackups = [...backups].sort((a, b) => b.created.getTime() - a.created.getTime());

    for (let i = 0; i < sortedBackups.length; i++) {
      const backup = sortedBackups[i];
      const age = now - backup.created.getTime();

      // Delete if too old or exceeds max count
      if (age > this.maxBackupAge || i >= this.maxBackupsPerDocument) {
        await this.deleteBackup(backup.path);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[BackupService] Cleaned up ${deletedCount} old backups for ${documentPath}`);
    }

    return deletedCount;
  }

  /**
   * Clean up all old backups across all documents
   *
   * @returns Promise resolving to number of backups deleted
   */
  async cleanupAllOldBackups(): Promise<number> {
    try {
      const files = await fs.readdir(this.backupDir);
      let deletedCount = 0;
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.meta')) {
          const filePath = path.join(this.backupDir, file);
          const stats = await fs.stat(filePath);
          const age = now - stats.birthtime.getTime();

          if (age > this.maxBackupAge) {
            await this.deleteBackup(filePath);
            deletedCount++;
          }
        }
      }

      console.log(`[BackupService] Cleaned up ${deletedCount} old backups total`);
      return deletedCount;
    } catch (error) {
      console.error('[BackupService] Failed to cleanup old backups:', error);
      return 0;
    }
  }

  /**
   * Verify backup integrity
   *
   * @param backupPath Path to backup file
   * @returns Promise resolving to true if backup is valid, false otherwise
   */
  async verifyBackup(backupPath: string): Promise<boolean> {
    try {
      const data = await fs.readFile(backupPath);
      const metadata = await this.getBackupMetadata(backupPath);

      if (!metadata) {
        // No metadata, but file exists - consider valid
        return true;
      }

      const currentChecksum = this.generateHash(data);
      return currentChecksum === metadata.checksum;
    } catch {
      return false;
    }
  }

  /**
   * Get backup storage information
   *
   * @returns Promise resolving to storage statistics
   */
  async getBackupStorageInfo(): Promise<StorageInfo> {
    try {
      const files = await fs.readdir(this.backupDir);
      let totalSize = 0;
      let fileCount = 0;

      for (const file of files) {
        if (!file.endsWith('.meta')) {
          const filePath = path.join(this.backupDir, file);
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
          fileCount++;
        }
      }

      return {
        totalSize,
        fileCount,
        averageSize: fileCount > 0 ? totalSize / fileCount : 0,
        path: this.backupDir,
      };
    } catch {
      return {
        totalSize: 0,
        fileCount: 0,
        averageSize: 0,
        path: this.backupDir,
      };
    }
  }

  /**
   * Create backup with automatic cleanup (convenience method)
   *
   * @param documentPath Path to document
   * @returns Promise resolving to backup file path
   */
  async createBackupWithCleanup(documentPath: string): Promise<string> {
    const backupPath = await this.createBackup(documentPath);
    await this.cleanupOldBackups(documentPath);
    return backupPath;
  }

  /**
   * Update backup service configuration
   *
   * @param config Configuration options
   */
  setConfig(config: Partial<BackupConfig>): void {
    if (config.backupDir) {
      this.backupDir = config.backupDir;
      this.ensureBackupDirectory();
    }
    if (config.maxBackupAgeDays !== undefined) {
      this.maxBackupAge = config.maxBackupAgeDays * 24 * 60 * 60 * 1000;
    }
    if (config.maxBackupsPerDocument !== undefined) {
      this.maxBackupsPerDocument = config.maxBackupsPerDocument;
    }
    console.log('[BackupService] Configuration updated:', config);
  }

  // Private helper methods

  /**
   * Ensure backup directory exists
   */
  private async ensureBackupDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      console.error('[BackupService] Failed to create backup directory:', error);
    }
  }

  /**
   * Generate SHA-256 hash for data
   *
   * @param data Buffer to hash
   * @returns Hex string of hash
   */
  private generateHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Save backup metadata to .meta file
   *
   * @param _originalPath Original document path (unused, kept for signature compatibility)
   * @param backupPath Backup file path
   * @param metadata Metadata object to save
   */
  private async saveBackupMetadata(
    _originalPath: string,
    backupPath: string,
    metadata: BackupMetadata
  ): Promise<void> {
    const metadataPath = `${backupPath}.meta`;

    try {
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.error('[BackupService] Failed to save backup metadata:', error);
    }
  }

  /**
   * Get backup metadata from .meta file
   *
   * @param backupPath Backup file path
   * @returns Promise resolving to metadata object or null if not found
   */
  private async getBackupMetadata(backupPath: string): Promise<BackupMetadata | null> {
    const metadataPath = `${backupPath}.meta`;

    try {
      const data = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
}

// Type definitions

export interface BackupInfo {
  path: string;
  filename: string;
  size: number;
  created: Date;
  modified: Date;
  originalPath: string;
  checksum?: string;
}

export interface BackupMetadata {
  originalPath: string;
  backupPath: string;
  timestamp: string;
  size: number;
  checksum: string;
}

export interface StorageInfo {
  totalSize: number;
  fileCount: number;
  averageSize: number;
  path: string;
}

export interface BackupConfig {
  backupDir?: string;
  maxBackupAgeDays?: number;
  maxBackupsPerDocument?: number;
}
