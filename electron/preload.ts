import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils, shell } from 'electron';
import type {
  HyperlinkProcessingOptions,
  BatchProcessingOptions,
  BatchProgress,
} from '../src/types/hyperlink';
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
} from '../src/types/backup';
import type {
  SharePointConfig,
  DictionarySyncStatus,
  DictionarySyncResponse,
  DictionaryInitResponse,
  DictionaryCredentialsResponse,
  SyncProgressUpdate,
} from '../src/types/dictionary';
import type { HyperlinkLookupResult } from './services/LocalDictionaryLookupService';

const electronAPI = {
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  isFullscreen: () => ipcRenderer.invoke('window-is-fullscreen'),
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  getPlatform: () => ipcRenderer.invoke('platform'),
  openDevTools: () => ipcRenderer.invoke('open-dev-tools'),

  // File handling
  selectDocuments: () => ipcRenderer.invoke('select-documents'),
  processDocument: (path: string) => ipcRenderer.invoke('process-document', path),
  showInFolder: (path: string) => ipcRenderer.invoke('show-in-folder', path),
  openDocument: (path: string) => ipcRenderer.invoke('open-document', path),
  getFileStats: (filePath: string) => ipcRenderer.invoke('get-file-stats', filePath),
  restoreFromBackup: (backupPath: string, targetPath: string) =>
    ipcRenderer.invoke('restore-from-backup', { backupPath, targetPath }),

  getPathsForFiles: (files: File[]) => {
    return files.map((file) => webUtils.getPathForFile(file));
  },

  // Document text extraction (for comparison views)
  extractDocumentText: (filePath: string) =>
    ipcRenderer.invoke('document:extract-text', filePath),

  // Read file as buffer (for snapshot capture)
  readFileAsBuffer: (filePath: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('file:read-buffer', filePath),

  // Hyperlink processing
  selectFiles: () => ipcRenderer.invoke('hyperlink:select-files'),
  processHyperlinkDocument: (filePath: string, options: HyperlinkProcessingOptions) =>
    ipcRenderer.invoke('hyperlink:process-document', { filePath, options }),
  batchProcessDocuments: (filePaths: string[], options: BatchProcessingOptions) =>
    ipcRenderer.invoke('hyperlink:batch-process', { filePaths, options }),
  validateApi: (apiUrl: string) => ipcRenderer.invoke('hyperlink:validate-api', { apiUrl }),
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
  ) => ipcRenderer.invoke('hyperlink:call-api', { apiUrl, payload, timeout }),
  cancelOperation: (operationId: string) =>
    ipcRenderer.invoke('hyperlink:cancel-operation', { operationId }),
  onBatchProgress: (callback: (progress: BatchProgress) => void) => {
    const subscription = (_event: IpcRendererEvent, progress: BatchProgress) => callback(progress);
    ipcRenderer.on('hyperlink:batch-progress', subscription);
    return () => ipcRenderer.removeListener('hyperlink:batch-progress', subscription);
  },

  onWindowMaximized: (callback: () => void) => {
    const subscription = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on('window-maximized', subscription);
    return () => ipcRenderer.removeListener('window-maximized', subscription);
  },

  onWindowUnmaximized: (callback: () => void) => {
    const subscription = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on('window-unmaximized', subscription);
    return () => ipcRenderer.removeListener('window-unmaximized', subscription);
  },

  onWindowFullscreen: (callback: () => void) => {
    const subscription = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on('window-fullscreen', subscription);
    return () => ipcRenderer.removeListener('window-fullscreen', subscription);
  },

  onWindowUnfullscreen: (callback: () => void) => {
    const subscription = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on('window-unfullscreen', subscription);
    return () => ipcRenderer.removeListener('window-unfullscreen', subscription);
  },

  // Export/Import
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettings: () => ipcRenderer.invoke('import-settings'),
  saveExportData: (filePath: string, data: any) =>
    ipcRenderer.invoke('save-export-data', { filePath, data }),

  // Backup operations
  backup: {
    create: (documentPath: string): Promise<BackupCreateResponse> =>
      ipcRenderer.invoke('backup:create', documentPath),
    restore: (backupPath: string, targetPath: string): Promise<BackupRestoreResponse> =>
      ipcRenderer.invoke('backup:restore', { backupPath, targetPath }),
    list: (documentPath: string): Promise<BackupListResponse> =>
      ipcRenderer.invoke('backup:list', documentPath),
    delete: (backupPath: string): Promise<BackupDeleteResponse> =>
      ipcRenderer.invoke('backup:delete', backupPath),
    cleanup: (documentPath: string): Promise<BackupCleanupResponse> =>
      ipcRenderer.invoke('backup:cleanup', documentPath),
    cleanupAll: (): Promise<BackupCleanupResponse> =>
      ipcRenderer.invoke('backup:cleanup-all'),
    verify: (backupPath: string): Promise<BackupVerifyResponse> =>
      ipcRenderer.invoke('backup:verify', backupPath),
    getStorageInfo: (): Promise<BackupStorageInfoResponse> =>
      ipcRenderer.invoke('backup:storage-info'),
    setConfig: (config: Partial<BackupConfig>): Promise<BackupSetConfigResponse> =>
      ipcRenderer.invoke('backup:set-config', config),
  },

  // Dictionary operations (Local SharePoint Dictionary)
  dictionary: {
    initialize: (): Promise<DictionaryInitResponse> =>
      ipcRenderer.invoke('dictionary:initialize'),
    configureSync: (config: SharePointConfig): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('dictionary:configure-sync', config),
    setCredentials: (clientSecret: string): Promise<DictionaryCredentialsResponse> =>
      ipcRenderer.invoke('dictionary:set-credentials', clientSecret),
    sync: (): Promise<DictionarySyncResponse> =>
      ipcRenderer.invoke('dictionary:sync'),
    startScheduler: (intervalHours: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('dictionary:start-scheduler', intervalHours),
    stopScheduler: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('dictionary:stop-scheduler'),
    lookup: (lookupId: string): Promise<{ success: boolean; result?: HyperlinkLookupResult; error?: string }> =>
      ipcRenderer.invoke('dictionary:lookup', lookupId),
    batchLookup: (lookupIds: string[]): Promise<{ success: boolean; results?: HyperlinkLookupResult[]; error?: string }> =>
      ipcRenderer.invoke('dictionary:batch-lookup', lookupIds),
    getStatus: (): Promise<{ success: boolean; status?: DictionarySyncStatus; error?: string }> =>
      ipcRenderer.invoke('dictionary:get-status'),
    onSyncProgress: (callback: (progress: SyncProgressUpdate) => void) => {
      const subscription = (_event: IpcRendererEvent, progress: SyncProgressUpdate) => callback(progress);
      ipcRenderer.on('dictionary:sync-progress', subscription);
      return () => ipcRenderer.removeListener('dictionary:sync-progress', subscription);
    },
    onSyncComplete: (callback: (result: DictionarySyncResponse) => void) => {
      const subscription = (_event: IpcRendererEvent, result: DictionarySyncResponse) => callback(result);
      ipcRenderer.on('dictionary:sync-complete', subscription);
      return () => ipcRenderer.removeListener('dictionary:sync-complete', subscription);
    },
  },

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getCurrentVersion: () => ipcRenderer.invoke('get-app-version'),

  // Update event listeners
  onUpdateChecking: (callback: () => void) => {
    const subscription = (_event: IpcRendererEvent) => callback();
    ipcRenderer.on('update-checking', subscription);
    return () => ipcRenderer.removeListener('update-checking', subscription);
  },
  onUpdateAvailable: (
    callback: (info: { version: string; releaseDate: string; releaseNotes: string }) => void
  ) => {
    const subscription = (_event: IpcRendererEvent, info: any) => callback(info);
    ipcRenderer.on('update-available', subscription);
    return () => ipcRenderer.removeListener('update-available', subscription);
  },
  onUpdateNotAvailable: (callback: (info: { version: string }) => void) => {
    const subscription = (_event: IpcRendererEvent, info: any) => callback(info);
    ipcRenderer.on('update-not-available', subscription);
    return () => ipcRenderer.removeListener('update-not-available', subscription);
  },
  onUpdateError: (callback: (error: { message: string }) => void) => {
    const subscription = (_event: IpcRendererEvent, error: any) => callback(error);
    ipcRenderer.on('update-error', subscription);
    return () => ipcRenderer.removeListener('update-error', subscription);
  },
  onUpdateDownloadProgress: (
    callback: (progress: {
      bytesPerSecond: number;
      percent: number;
      transferred: number;
      total: number;
    }) => void
  ) => {
    const subscription = (_event: IpcRendererEvent, progress: any) => callback(progress);
    ipcRenderer.on('update-download-progress', subscription);
    return () => ipcRenderer.removeListener('update-download-progress', subscription);
  },
  onUpdateDownloaded: (
    callback: (info: { version: string; releaseNotes: string; fallbackUsed?: boolean }) => void
  ) => {
    const subscription = (_event: IpcRendererEvent, info: any) => callback(info);
    ipcRenderer.on('update-downloaded', subscription);
    return () => ipcRenderer.removeListener('update-downloaded', subscription);
  },
  onUpdateFallbackMode: (callback: (data: { message: string }) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('update-fallback-mode', subscription);
    return () => ipcRenderer.removeListener('update-fallback-mode', subscription);
  },
  onUpdateExtracting: (callback: (data: { message: string }) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('update-extracting', subscription);
    return () => ipcRenderer.removeListener('update-extracting', subscription);
  },
  onUpdateStatus: (callback: (data: { message: string }) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('update-status', subscription);
    return () => ipcRenderer.removeListener('update-status', subscription);
  },

  // Manual download
  openUpdateInBrowser: () => ipcRenderer.invoke('open-update-in-browser'),

  // Certificate Management
  checkZscalerStatus: () => ipcRenderer.invoke('check-zscaler-status'),
  getCertificatePath: () => ipcRenderer.invoke('get-certificate-path'),
  getInstalledCertificates: () => ipcRenderer.invoke('get-installed-certificates'),
  importCertificate: () => ipcRenderer.invoke('import-certificate'),
  autoDetectCertificates: () => ipcRenderer.invoke('auto-detect-certificates'),
  removeCertificate: (certPath: string) => ipcRenderer.invoke('remove-certificate', certPath),
  testGitHubConnection: () => ipcRenderer.invoke('test-github-connection'),
  openExternal: (url: string) => shell.openExternal(url),

  // Event system helpers
  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: IpcRendererEvent, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
  removeListener: (
    channel: string,
    callback: (event: IpcRendererEvent, ...args: any[]) => void
  ) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // Debug events
  onDebugNetworkRequest: (callback: (data: any) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('debug-network-request', subscription);
    return () => ipcRenderer.removeListener('debug-network-request', subscription);
  },
  onDebugCertError: (callback: (data: any) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('debug-cert-error', subscription);
    return () => ipcRenderer.removeListener('debug-cert-error', subscription);
  },
  onDebugNetworkError: (callback: (data: any) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('debug-network-error', subscription);
    return () => ipcRenderer.removeListener('debug-network-error', subscription);
  },
  onDebugTLSError: (callback: (data: any) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('debug-tls-error', subscription);
    return () => ipcRenderer.removeListener('debug-tls-error', subscription);
  },
  onUpdateManualDownload: (callback: (data: { message: string; downloadUrl: string }) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('update-manual-download', subscription);
    return () => ipcRenderer.removeListener('update-manual-download', subscription);
  },

  // Certificate check events (background)
  onCertificateCheckComplete: (callback: (data: { success: boolean; error?: string; timestamp: string }) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('certificate-check-complete', subscription);
    return () => ipcRenderer.removeListener('certificate-check-complete', subscription);
  },

  onCertificateConfigured: (callback: (data: { message: string; certPath?: string }) => void) => {
    const subscription = (_event: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('certificate-configured', subscription);
    return () => ipcRenderer.removeListener('certificate-configured', subscription);
  },
};

// Expose to window using contextBridge (required for contextIsolation: true)
// This is the correct, secure way to expose APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// TYPE EXPORT: The ElectronAPI type is now defined in src/types/electron.ts
// This provides a single source of truth for the API interface, shared between
// the preload script and the renderer process.
// Import from '@/types/electron' in renderer code for full type safety.

