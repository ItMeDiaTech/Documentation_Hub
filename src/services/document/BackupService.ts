/**
 * BackupService - Handles document backup and restoration
 * Implements safe backup strategies with automatic cleanup
 */

import { createHash } from 'crypto';
import { logger } from '@/utils/logger';

/**
 * Service for managing document backups
 */
export class BackupService {
  private backupDir: string;
  private maxBackupAge: number = 7 * 24 * 60 * 60 * 1000; // 7 days
  private maxBackupsPerDocument: number = 5;
  private log = logger.namespace('BackupService');

  constructor() {
    // Use app data directory for backups
    const path = window.require('path');
    const os = window.require('os');
    this.backupDir = path.join(os.homedir(), '.dochub', 'backups');
    this.ensureBackupDirectory();
  }

  /**
   * Create a backup of the document
   */
  async createBackup(documentPath: string): Promise<string> {
    const fs = window.require('fs').promises;
    const path = window.require('path');

    try {
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
        checksum: this.generateHash(documentData)
      });

      // Clean up old backups
      await this.cleanupOldBackups(documentPath);

      return backupPath;
    } catch (error) {
      throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Restore document from backup
   */
  async restoreBackup(backupPath: string, targetPath: string): Promise<void> {
    const fs = window.require('fs').promises;

    try {
      // Verify backup exists
      await fs.access(backupPath);

      // Read backup data
      const backupData = await fs.readFile(backupPath);

      // Verify integrity
      const metadata = await this.getBackupMetadata(backupPath);
      if (metadata) {
        const currentChecksum = this.generateHash(backupData);
        if (currentChecksum !== metadata.checksum) {
          throw new Error('Backup integrity check failed');
        }
      }

      // Restore to target path
      await fs.writeFile(targetPath, backupData);

    } catch (error) {
      throw new Error(`Failed to restore backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all backups for a document
   */
  async listBackups(documentPath: string): Promise<BackupInfo[]> {
    const fs = window.require('fs').promises;
    const path = window.require('path');

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
            checksum: metadata?.checksum
          });
        }
      }

      // Sort by creation date (newest first)
      return backups.sort((a, b) => b.created.getTime() - a.created.getTime());
    } catch (error) {
      this.log.error('Failed to list backups:', error);
      return [];
    }
  }

  /**
   * Delete a specific backup
   */
  async deleteBackup(backupPath: string): Promise<void> {
    const fs = window.require('fs').promises;

    try {
      await fs.unlink(backupPath);

      // Delete metadata file
      const metadataPath = `${backupPath}.meta`;
      try {
        await fs.unlink(metadataPath);
      } catch {
        // Metadata file might not exist
      }
    } catch (error) {
      throw new Error(`Failed to delete backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clean up old backups for a document
   */
  async cleanupOldBackups(documentPath: string): Promise<number> {
    const backups = await this.listBackups(documentPath);
    let deletedCount = 0;
    const now = Date.now();

    // Sort by creation date (newest first)
    const sortedBackups = [...backups].sort((a, b) =>
      b.created.getTime() - a.created.getTime()
    );

    for (let i = 0; i < sortedBackups.length; i++) {
      const backup = sortedBackups[i];
      const age = now - backup.created.getTime();

      // Delete if too old or exceeds max count
      if (age > this.maxBackupAge || i >= this.maxBackupsPerDocument) {
        await this.deleteBackup(backup.path);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Clean up all old backups
   */
  async cleanupAllOldBackups(): Promise<number> {
    const fs = window.require('fs').promises;
    const path = window.require('path');

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

      return deletedCount;
    } catch (error) {
      this.log.error('Failed to cleanup old backups:', error);
      return 0;
    }
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupPath: string): Promise<boolean> {
    const fs = window.require('fs').promises;

    try {
      const data = await fs.readFile(backupPath);
      const metadata = await this.getBackupMetadata(backupPath);

      if (!metadata) {
        // No metadata, but file exists
        return true;
      }

      const currentChecksum = this.generateHash(data);
      return currentChecksum === metadata.checksum;
    } catch {
      return false;
    }
  }

  /**
   * Get backup size information
   */
  async getBackupStorageInfo(): Promise<StorageInfo> {
    const fs = window.require('fs').promises;
    const path = window.require('path');

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
        path: this.backupDir
      };
    } catch {
      return {
        totalSize: 0,
        fileCount: 0,
        averageSize: 0,
        path: this.backupDir
      };
    }
  }

  /**
   * Create backup with automatic cleanup
   */
  async createBackupWithCleanup(documentPath: string): Promise<string> {
    const backupPath = await this.createBackup(documentPath);
    await this.cleanupOldBackups(documentPath);
    return backupPath;
  }

  // Private helper methods

  /**
   * Ensure backup directory exists
   */
  private async ensureBackupDirectory(): Promise<void> {
    const fs = window.require('fs').promises;

    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      this.log.error('Failed to create backup directory:', error);
    }
  }

  /**
   * Generate hash for data
   */
  private generateHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Save backup metadata
   */
  private async saveBackupMetadata(
    _originalPath: string,
    backupPath: string,
    metadata: BackupMetadata
  ): Promise<void> {
    const fs = window.require('fs').promises;
    const metadataPath = `${backupPath}.meta`;

    try {
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      this.log.error('Failed to save backup metadata:', error);
    }
  }

  /**
   * Get backup metadata
   */
  private async getBackupMetadata(backupPath: string): Promise<BackupMetadata | null> {
    const fs = window.require('fs').promises;
    const metadataPath = `${backupPath}.meta`;

    try {
      const data = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Set backup directory
   */
  setBackupDirectory(dir: string): void {
    this.backupDir = dir;
    this.ensureBackupDirectory();
  }

  /**
   * Set maximum backup age
   */
  setMaxBackupAge(days: number): void {
    this.maxBackupAge = days * 24 * 60 * 60 * 1000;
  }

  /**
   * Set maximum backups per document
   */
  setMaxBackupsPerDocument(count: number): void {
    this.maxBackupsPerDocument = count;
  }
}

// Type definitions

interface BackupInfo {
  path: string;
  filename: string;
  size: number;
  created: Date;
  modified: Date;
  originalPath: string;
  checksum?: string;
}

interface BackupMetadata {
  originalPath: string;
  backupPath: string;
  timestamp: string;
  size: number;
  checksum: string;
}

interface StorageInfo {
  totalSize: number;
  fileCount: number;
  averageSize: number;
  path: string;
}