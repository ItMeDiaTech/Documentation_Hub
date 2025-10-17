/**
 * Backup Service Type Definitions
 *
 * These types are shared between main process (BackupService)
 * and renderer process (via IPC) for type-safe backup operations.
 */

/**
 * Information about a single backup file
 */
export interface BackupInfo {
  /** Absolute path to the backup file */
  path: string;

  /** Filename of the backup (without directory) */
  filename: string;

  /** Size of backup file in bytes */
  size: number;

  /** Date when backup was created */
  created: Date;

  /** Date when backup was last modified */
  modified: Date;

  /** Path to the original document */
  originalPath: string;

  /** SHA-256 checksum of backup file (for integrity verification) */
  checksum?: string;
}

/**
 * Metadata stored alongside each backup
 */
export interface BackupMetadata {
  /** Path to the original document */
  originalPath: string;

  /** Path where backup is stored */
  backupPath: string;

  /** ISO timestamp of backup creation */
  timestamp: string;

  /** Size of backed up document in bytes */
  size: number;

  /** SHA-256 checksum for integrity verification */
  checksum: string;
}

/**
 * Storage statistics for all backups
 */
export interface StorageInfo {
  /** Total size of all backups in bytes */
  totalSize: number;

  /** Total number of backup files */
  fileCount: number;

  /** Average size per backup in bytes */
  averageSize: number;

  /** Path to backup directory */
  path: string;
}

/**
 * Configuration options for BackupService
 */
export interface BackupConfig {
  /** Custom backup directory (default: ~/.dochub/backups) */
  backupDir?: string;

  /** Maximum age of backups in days (default: 7) */
  maxBackupAgeDays?: number;

  /** Maximum number of backups to keep per document (default: 5) */
  maxBackupsPerDocument?: number;
}

/**
 * IPC Response types for backup operations
 */

export interface BackupCreateResponse {
  success: boolean;
  backupPath?: string;
  error?: string;
}

export interface BackupRestoreResponse {
  success: boolean;
  error?: string;
}

export interface BackupListResponse {
  success: boolean;
  backups: BackupInfo[];
  error?: string;
}

export interface BackupDeleteResponse {
  success: boolean;
  error?: string;
}

export interface BackupCleanupResponse {
  success: boolean;
  deletedCount: number;
  error?: string;
}

export interface BackupVerifyResponse {
  success: boolean;
  isValid: boolean;
  error?: string;
}

export interface BackupStorageInfoResponse {
  success: boolean;
  storageInfo?: StorageInfo;
  error?: string;
}

export interface BackupSetConfigResponse {
  success: boolean;
  error?: string;
}
