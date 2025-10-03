import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
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

  // File handling
  selectDocuments: () => ipcRenderer.invoke('select-documents'),
  processDocument: (path: string) => ipcRenderer.invoke('process-document', path),

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
});

export type ElectronAPI = {
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<NodeJS.Platform>;
  selectDocuments: () => Promise<string[] | undefined>;
  processDocument: (path: string) => Promise<unknown>;
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
};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
