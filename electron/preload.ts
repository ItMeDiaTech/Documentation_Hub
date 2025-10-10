import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron';
import type {
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult,
  BatchProcessingOptions,
  BatchProcessingResult,
  BatchProgress
} from '../src/types/hyperlink';

contextBridge.exposeInMainWorld('electronAPI', {
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
  getFileStats: (filePath: string) => ipcRenderer.invoke('get-file-stats', filePath),
  restoreFromBackup: (backupPath: string, targetPath: string) =>
    ipcRenderer.invoke('restore-from-backup', { backupPath, targetPath }),

  // Drag-and-drop file path extraction (Electron v32+ compatible)
  // webUtils.getPathForFile() must be called in preload context
  getPathsForFiles: (files: File[]) => {
    return files.map(file => webUtils.getPathForFile(file));
  },

  // Hyperlink processing
  selectFiles: () => ipcRenderer.invoke('hyperlink:select-files'),
  processHyperlinkDocument: (filePath: string, options: HyperlinkProcessingOptions) =>
    ipcRenderer.invoke('hyperlink:process-document', { filePath, options }),
  batchProcessDocuments: (filePaths: string[], options: BatchProcessingOptions) =>
    ipcRenderer.invoke('hyperlink:batch-process', { filePaths, options }),
  validateApi: (apiUrl: string) =>
    ipcRenderer.invoke('hyperlink:validate-api', { apiUrl }),
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
  saveExportData: (filePath: string, data: any) => ipcRenderer.invoke('save-export-data', { filePath, data }),

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
  onUpdateAvailable: (callback: (info: { version: string; releaseDate: string; releaseNotes: string }) => void) => {
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
  onUpdateDownloadProgress: (callback: (progress: { bytesPerSecond: number; percent: number; transferred: number; total: number }) => void) => {
    const subscription = (_event: IpcRendererEvent, progress: any) => callback(progress);
    ipcRenderer.on('update-download-progress', subscription);
    return () => ipcRenderer.removeListener('update-download-progress', subscription);
  },
  onUpdateDownloaded: (callback: (info: { version: string; releaseNotes: string; fallbackUsed?: boolean }) => void) => {
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
});

export type ElectronAPI = {
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;
  openDevTools: () => Promise<void>;
  selectDocuments: () => Promise<string[] | undefined>;
  processDocument: (path: string) => Promise<unknown>;
  showInFolder: (path: string) => Promise<void>;
  getFileStats: (filePath: string) => Promise<{ size: number; created: Date; modified: Date; isFile: boolean; isDirectory: boolean }>;
  restoreFromBackup: (backupPath: string, targetPath: string) => Promise<void>;
  getPathsForFiles: (files: File[]) => string[];
  selectFiles: () => Promise<string[]>;
  processHyperlinkDocument: (filePath: string, options: HyperlinkProcessingOptions) => Promise<HyperlinkProcessingResult>;
  batchProcessDocuments: (filePaths: string[], options: BatchProcessingOptions) => Promise<BatchProcessingResult>;
  validateApi: (apiUrl: string) => Promise<{ isValid: boolean; message: string; responseTime?: number }>;
  cancelOperation: (operationId: string) => Promise<{ success: boolean; message?: string }>;
  onBatchProgress: (callback: (progress: BatchProgress) => void) => () => void;
  onWindowMaximized: (callback: () => void) => () => void;
  onWindowUnmaximized: (callback: () => void) => () => void;
  onWindowFullscreen: (callback: () => void) => () => void;
  onWindowUnfullscreen: (callback: () => void) => () => void;
  exportSettings: () => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  importSettings: () => Promise<{ success: boolean; data?: any; filePath?: string; canceled?: boolean; error?: string }>;
  saveExportData: (filePath: string, data: any) => Promise<{ success: boolean; error?: string }>;
  checkForUpdates: () => Promise<{ success: boolean; message?: string; updateInfo?: any }>;
  downloadUpdate: () => Promise<{ success: boolean; message?: string }>;
  installUpdate: () => void;
  getCurrentVersion: () => Promise<string>;
  onUpdateChecking: (callback: () => void) => () => void;
  onUpdateAvailable: (callback: (info: { version: string; releaseDate: string; releaseNotes: string }) => void) => () => void;
  onUpdateNotAvailable: (callback: (info: { version: string }) => void) => () => void;
  onUpdateError: (callback: (error: { message: string }) => void) => () => void;
  onUpdateDownloadProgress: (callback: (progress: { bytesPerSecond: number; percent: number; transferred: number; total: number }) => void) => () => void;
  onUpdateDownloaded: (callback: (info: { version: string; releaseNotes: string; fallbackUsed?: boolean }) => void) => () => void;
  onUpdateFallbackMode?: (callback: (data: { message: string }) => void) => () => void;
  onUpdateExtracting?: (callback: (data: { message: string }) => void) => () => void;
  onUpdateStatus?: (callback: (data: { message: string }) => void) => () => void;
  openUpdateInBrowser: () => Promise<{ success: boolean; message?: string }>;
  onDebugNetworkRequest?: (callback: (data: any) => void) => () => void;
  onDebugCertError?: (callback: (data: any) => void) => () => void;
  onDebugNetworkError?: (callback: (data: any) => void) => () => void;
  onDebugTLSError?: (callback: (data: any) => void) => () => void;
  onUpdateManualDownload?: (callback: (data: { message: string; downloadUrl: string }) => void) => () => void;
};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
