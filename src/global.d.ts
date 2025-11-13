/**
 * Global TypeScript Type Declarations
 *
 * This file provides type definitions for globally accessible APIs,
 * particularly the Electron IPC bridge exposed via contextBridge in preload.ts
 */

import type {
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult,
  BatchProcessingOptions,
  BatchProcessingResult,
  BatchProgress,
} from './types/hyperlink';
import type {
  BackupCreateResponse,
  BackupRestoreResponse,
  BackupListResponse,
  BackupDeleteResponse,
  BackupCleanupResponse,
  BackupVerifyResponse,
  BackupStorageInfoResponse,
  BackupSetConfigResponse,
  BackupConfig,
} from './types/backup';

/**
 * ElectronAPI Type Definition
 *
 * Mirrors the electronAPI object exposed via contextBridge in electron/preload.ts
 * This provides full type safety for IPC communication between renderer and main processes
 */
export type ElectronAPI = {
  // Window controls
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  openDevTools: () => Promise<void>;

  // File handling
  selectDocuments: () => Promise<string[]>;
  processDocument: (path: string) => Promise<any>;
  showInFolder: (path: string) => Promise<void>;
  openDocument: (path: string) => Promise<void>;
  getFileStats: (filePath: string) => Promise<any>;
  restoreFromBackup: (backupPath: string, targetPath: string) => Promise<any>;
  getPathsForFiles: (files: File[]) => string[];

  // Hyperlink processing
  selectFiles: () => Promise<string[]>;
  processHyperlinkDocument: (filePath: string, options: HyperlinkProcessingOptions) => Promise<HyperlinkProcessingResult>;
  batchProcessDocuments: (filePaths: string[], options: BatchProcessingOptions) => Promise<BatchProcessingResult>;
  validateApi: (apiUrl: string) => Promise<{ valid: boolean; error?: string }>;
  cancelOperation: (operationId: string) => Promise<void>;
  onBatchProgress: (callback: (progress: BatchProgress) => void) => () => void;

  // Window events
  onWindowMaximized: (callback: () => void) => () => void;
  onWindowUnmaximized: (callback: () => void) => () => void;
  onWindowFullscreen: (callback: () => void) => () => void;
  onWindowUnfullscreen: (callback: () => void) => () => void;

  // Export/Import
  exportSettings: () => Promise<{ success?: boolean; canceled?: boolean; filePath?: string }>;
  importSettings: () => Promise<{ success?: boolean; canceled?: boolean; data?: any }>;
  saveExportData: (filePath: string, data: any) => Promise<{ success?: boolean; error?: string }>;

  // Backup operations
  backup: {
    create: (documentPath: string) => Promise<BackupCreateResponse>;
    restore: (backupPath: string, targetPath: string) => Promise<BackupRestoreResponse>;
    list: (documentPath: string) => Promise<BackupListResponse>;
    delete: (backupPath: string) => Promise<BackupDeleteResponse>;
    cleanup: (documentPath: string) => Promise<BackupCleanupResponse>;
    cleanupAll: () => Promise<BackupCleanupResponse>;
    verify: (backupPath: string) => Promise<BackupVerifyResponse>;
    getStorageInfo: () => Promise<BackupStorageInfoResponse>;
    setConfig: (config: Partial<BackupConfig>) => Promise<BackupSetConfigResponse>;
  };

  // Auto-updater
  checkForUpdates: () => Promise<any>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  getCurrentVersion: () => Promise<string>;

  // Update event listeners
  onUpdateChecking: (callback: () => void) => () => void;
  onUpdateAvailable: (callback: (info: { version: string; releaseDate: string; releaseNotes: string }) => void) => () => void;
  onUpdateNotAvailable: (callback: (info: { version: string }) => void) => () => void;
  onUpdateError: (callback: (error: { message: string }) => void) => () => void;
  onUpdateDownloadProgress: (callback: (progress: { bytesPerSecond: number; percent: number; transferred: number; total: number }) => void) => () => void;
  onUpdateDownloaded: (callback: (info: { version: string; releaseNotes: string; fallbackUsed?: boolean }) => void) => () => void;
  onUpdateFallbackMode: (callback: (data: { message: string }) => void) => () => void;
  onUpdateExtracting: (callback: (data: { message: string }) => void) => () => void;
  onUpdateStatus: (callback: (data: { message: string }) => void) => () => void;

  // Manual download
  openUpdateInBrowser: () => Promise<void>;

  // Certificate Management
  checkZscalerStatus: () => Promise<any>;
  getCertificatePath: () => Promise<string>;
  getInstalledCertificates: () => Promise<string[]>;
  importCertificate: () => Promise<{ success?: boolean; name?: string; error?: string }>;
  autoDetectCertificates: () => Promise<{ success: boolean; count?: number }>;
  removeCertificate: (certPath: string) => Promise<{ success?: boolean }>;
  testGitHubConnection: () => Promise<any>;
  openExternal: (url: string) => Promise<void>;

  // Event system helpers
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
  removeListener: (channel: string, callback: (...args: any[]) => void) => void;

  // Debug events
  onDebugNetworkRequest: (callback: (data: any) => void) => () => void;
  onDebugCertError: (callback: (data: any) => void) => () => void;
  onDebugNetworkError: (callback: (data: any) => void) => () => void;
  onDebugTLSError: (callback: (data: any) => void) => () => void;
  onUpdateManualDownload: (callback: (data: { message: string; downloadUrl: string }) => void) => () => void;

  // Certificate check events
  onCertificateCheckComplete: (callback: (data: { success: boolean; error?: string; timestamp: string }) => void) => () => void;
  onCertificateConfigured: (callback: (data: { message: string; certPath?: string }) => void) => () => void;
};

/**
 * Extend the Window interface to include electronAPI
 * This makes window.electronAPI available throughout the application with full type safety
 */
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
