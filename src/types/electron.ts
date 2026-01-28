/**
 * Electron API Type Definitions
 *
 * This file contains type definitions for the Electron API exposed via contextBridge.
 * These types are shared between the preload script and the renderer process.
 *
 * NOTE: The actual ElectronAPI type is derived from the preload.ts implementation.
 * This file re-exports and augments those types for use in the renderer.
 */

import type {
  HyperlinkProcessingOptions,
  BatchProcessingOptions,
  BatchProgress,
} from './hyperlink';

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
} from './backup';

import type {
  SharePointConfig,
  DictionarySyncStatus,
  DictionarySyncResponse,
  DictionaryInitResponse,
  DictionaryCredentialsResponse,
  SyncProgressUpdate,
} from './dictionary';

/**
 * Update event info types
 */
export interface UpdateAvailableInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string;
}

export interface UpdateNotAvailableInfo {
  version: string;
}

export interface UpdateErrorInfo {
  message: string;
}

export interface UpdateDownloadProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdateDownloadedInfo {
  version: string;
  releaseNotes: string;
  fallbackUsed?: boolean;
}

export interface UpdateStatusInfo {
  message: string;
}

/**
 * SharePoint update source configuration
 */
export interface UpdateProviderConfig {
  type: 'github' | 'sharepoint';
  sharePointUrl?: string;
}

export interface SharePointConnectionTestResult {
  success: boolean;
  message: string;
  authenticated?: boolean;
}

export interface SharePointLoginResult {
  success: boolean;
  error?: string;
}

export interface UpdateManualDownloadInfo {
  message: string;
  downloadUrl: string;
}

export interface CertificateCheckInfo {
  success: boolean;
  error?: string;
  timestamp: string;
}

export interface CertificateConfiguredInfo {
  message: string;
  certPath?: string;
}

/**
 * Display/Monitor information for multi-monitor support
 */
export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  isPrimary: boolean;
}

/**
 * Display API interface for monitor selection and comparison
 */
export interface DisplayAPI {
  getAllDisplays: () => Promise<DisplayInfo[]>;
  identifyMonitors: () => Promise<{ success: boolean }>;
  openComparison: (
    backupPath: string,
    processedPath: string,
    monitorIndex: number
  ) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Backup API interface
 */
export interface BackupAPI {
  create: (documentPath: string) => Promise<BackupCreateResponse>;
  restore: (backupPath: string, targetPath: string) => Promise<BackupRestoreResponse>;
  list: (documentPath: string) => Promise<BackupListResponse>;
  delete: (backupPath: string) => Promise<BackupDeleteResponse>;
  cleanup: (documentPath: string) => Promise<BackupCleanupResponse>;
  cleanupAll: () => Promise<BackupCleanupResponse>;
  verify: (backupPath: string) => Promise<BackupVerifyResponse>;
  getStorageInfo: () => Promise<BackupStorageInfoResponse>;
  setConfig: (config: Partial<BackupConfig>) => Promise<BackupSetConfigResponse>;
}

/**
 * Hyperlink lookup result type (from local dictionary)
 */
export interface HyperlinkLookupResult {
  Document_ID: string;
  Content_ID: string;
  Title: string;
  Status: string;
}

/**
 * Dictionary API interface
 */
export interface DictionaryAPI {
  initialize: () => Promise<DictionaryInitResponse>;
  configureSync: (config: SharePointConfig) => Promise<{ success: boolean; error?: string }>;
  setCredentials: (clientSecret: string) => Promise<DictionaryCredentialsResponse>;
  sync: () => Promise<DictionarySyncResponse>;
  startScheduler: (intervalHours: number) => Promise<{ success: boolean; error?: string }>;
  stopScheduler: () => Promise<{ success: boolean; error?: string }>;
  lookup: (lookupId: string) => Promise<{ success: boolean; result?: HyperlinkLookupResult; error?: string }>;
  batchLookup: (lookupIds: string[]) => Promise<{ success: boolean; results?: HyperlinkLookupResult[]; error?: string }>;
  getStatus: () => Promise<{ success: boolean; status?: DictionarySyncStatus; error?: string }>;
  // Interactive SharePoint retrieval (using browser login)
  retrieveFromSharePoint: (fileUrl: string) => Promise<{ success: boolean; entriesImported?: number; error?: string }>;
  sharePointLogin: () => Promise<{ success: boolean; error?: string }>;
  isSharePointAuthenticated: () => Promise<{ authenticated: boolean }>;
  onSyncProgress: (callback: (progress: SyncProgressUpdate) => void) => () => void;
  onSyncComplete: (callback: (result: DictionarySyncResponse) => void) => () => void;
}

/**
 * Main Electron API interface
 * This type defines all methods exposed to the renderer via contextBridge.
 */
export interface ElectronAPI {
  // Window controls
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;
  openDevTools: () => Promise<void>;

  // Always on top (pin window)
  setAlwaysOnTop: (flag: boolean) => Promise<boolean>;
  isAlwaysOnTop: () => Promise<boolean>;
  onAlwaysOnTopChanged: (callback: (isOnTop: boolean) => void) => () => void;

  // File handling
  selectDocuments: () => Promise<string[] | null>;
  processDocument: (path: string) => Promise<unknown>;
  showInFolder: (path: string) => Promise<void>;
  openDocument: (path: string) => Promise<void>;
  getFileStats: (filePath: string) => Promise<unknown>;
  restoreFromBackup: (
    backupPath: string,
    targetPath: string
  ) => Promise<{ success: boolean; error?: string }>;
  getPathsForFiles: (files: File[]) => string[];

  // Export and Reporting
  selectFolder: () => Promise<string | null>;
  copyFilesToFolder: (
    filePaths: string[],
    destinationFolder: string
  ) => Promise<{ copied: number; skipped: number }>;
  getDownloadsPath: () => Promise<string>;
  createFolder: (folderPath: string) => Promise<boolean>;
  copyFileToFolder: (sourcePath: string, destFolder: string) => Promise<boolean>;
  createReportZip: (folderPath: string, zipName: string) => Promise<string>;
  openOutlookEmail: (subject: string, attachmentPath: string) => Promise<boolean>;

  // Document text extraction (for comparison views)
  extractDocumentText: (filePath: string) => Promise<{
    success: boolean;
    textContent?: string[];
    error?: string;
  }>;

  // Read file as buffer (for snapshot capture)
  readFileAsBuffer: (filePath: string) => Promise<ArrayBuffer>;

  // Hyperlink processing
  selectFiles: () => Promise<string[] | null>;
  processHyperlinkDocument: (
    filePath: string,
    options: HyperlinkProcessingOptions
  ) => Promise<unknown>;
  batchProcessDocuments: (
    filePaths: string[],
    options: BatchProcessingOptions
  ) => Promise<unknown>;
  validateApi: (apiUrl: string) => Promise<unknown>;
  callPowerAutomateApi: (
    apiUrl: string,
    payload: {
      Lookup_ID: string[];
      Hyperlinks_Checked: number;
      Total_Hyperlinks: number;
      First_Name: string;
      Last_Name: string;
      Email: string;
    },
    timeout?: number
  ) => Promise<{
    success: boolean;
    statusCode?: number;
    data?: unknown;
    error?: string;
    rawResponse?: string;
  }>;
  cancelOperation: (operationId: string) => Promise<void>;
  onBatchProgress: (callback: (progress: BatchProgress) => void) => () => void;

  // Window events
  onWindowMaximized: (callback: () => void) => () => void;
  onWindowUnmaximized: (callback: () => void) => () => void;
  onWindowFullscreen: (callback: () => void) => () => void;
  onWindowUnfullscreen: (callback: () => void) => () => void;

  // Export/Import
  exportSettings: () => Promise<string | null>;
  importSettings: () => Promise<unknown>;
  saveExportData: (filePath: string, data: unknown) => Promise<boolean>;

  // Backup operations
  backup: BackupAPI;

  // Dictionary operations (Local SharePoint Dictionary)
  dictionary: DictionaryAPI;

  // Display/Monitor operations
  display: DisplayAPI;

  // Auto-updater
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  getCurrentVersion: () => Promise<string>;

  // SharePoint update source
  setUpdateProvider: (config: UpdateProviderConfig) => Promise<{ success: boolean; error?: string }>;
  testSharePointConnection: (url: string) => Promise<SharePointConnectionTestResult>;
  sharePointLogin: () => Promise<SharePointLoginResult>;
  sharePointLogout: () => Promise<void>;

  // Update event listeners
  onUpdateChecking: (callback: () => void) => () => void;
  onUpdateAvailable: (callback: (info: UpdateAvailableInfo) => void) => () => void;
  onUpdateNotAvailable: (callback: (info: UpdateNotAvailableInfo) => void) => () => void;
  onUpdateError: (callback: (error: UpdateErrorInfo) => void) => () => void;
  onUpdateDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => () => void;
  onUpdateDownloaded: (callback: (info: UpdateDownloadedInfo) => void) => () => void;
  onUpdateFallbackMode: (callback: (data: UpdateStatusInfo) => void) => () => void;
  onUpdateExtracting: (callback: (data: UpdateStatusInfo) => void) => () => void;
  onUpdateStatus: (callback: (data: UpdateStatusInfo) => void) => () => void;

  // Manual download
  openUpdateInBrowser: () => Promise<void>;

  // Certificate Management
  checkZscalerStatus: () => Promise<unknown>;
  getCertificatePath: () => Promise<string | null>;
  getInstalledCertificates: () => Promise<string[]>;
  importCertificate: () => Promise<unknown>;
  autoDetectCertificates: () => Promise<unknown>;
  removeCertificate: (certPath: string) => Promise<boolean>;
  testGitHubConnection: () => Promise<unknown>;
  openExternal: (url: string) => Promise<void>;

  // Event system helpers
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;

  // Debug events
  onDebugNetworkRequest: (callback: (data: unknown) => void) => () => void;
  onDebugCertError: (callback: (data: unknown) => void) => () => void;
  onDebugNetworkError: (callback: (data: unknown) => void) => () => void;
  onDebugTLSError: (callback: (data: unknown) => void) => () => void;
  onUpdateManualDownload: (callback: (data: UpdateManualDownloadInfo) => void) => () => void;

  // Certificate check events (background)
  onCertificateCheckComplete: (callback: (data: CertificateCheckInfo) => void) => () => void;
  onCertificateConfigured: (callback: (data: CertificateConfiguredInfo) => void) => () => void;
}

// NOTE: Window.electronAPI declaration is in src/global.d.ts
// Do not duplicate it here to avoid TypeScript errors
