import { app, BrowserWindow, ipcMain, shell, Menu, dialog, session } from 'electron';
import { VelopackApp, UpdateManager } from 'velopack';
import { join } from 'path';
import * as fs from 'fs';
import { promises as fsPromises} from 'fs';

// Initialize Velopack as early as possible (handles Squirrel events)
VelopackApp.build().run();
import { WordDocumentProcessor } from '../src/services/document/WordDocumentProcessor';
import type {
  BatchProcessingOptions,
  BatchProcessingResult,
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult
} from '../src/types/hyperlink';

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    // Icon will be set by electron-builder during packaging
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-maximized');
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-unmaximized');
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window-fullscreen');
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window-unfullscreen');
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window-close', () => {
  mainWindow?.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow?.isMaximized();
});

ipcMain.handle('window-is-fullscreen', () => {
  return mainWindow?.isFullScreen();
});

ipcMain.handle('app-version', () => {
  return app.getVersion();
});

ipcMain.handle('open-dev-tools', () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools();
  }
});

// Hyperlink processing IPC handlers with security validation
class HyperlinkIPCHandler {
  private processor: WordDocumentProcessor;
  private processingQueue: Map<string, AbortController> = new Map();
  private readonly ALLOWED_BASE_PATH: string;

  constructor() {
    this.processor = new WordDocumentProcessor();
    this.ALLOWED_BASE_PATH = app.getPath('documents');
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Single document processing
    ipcMain.handle('hyperlink:process-document', async (event, request) => {
      try {
        // Validate file path
        const safePath = await this.validateFilePath(request.filePath);

        // Process document with timeout
        const controller = new AbortController();
        this.processingQueue.set(safePath, controller);

        const result = await this.processWithTimeout(
          this.processor.processDocument(safePath, request.options),
          controller.signal,
          60000 // 60 second timeout
        );

        this.processingQueue.delete(safePath);
        return result;

      } catch (error) {
        return {
          success: false,
          totalHyperlinks: 0,
          processedHyperlinks: 0,
          modifiedHyperlinks: 0,
          skippedHyperlinks: 0,
          updatedUrls: 0,
          updatedDisplayTexts: 0,
          appendedContentIds: 0,
          errorCount: 1,
          errorMessages: [error instanceof Error ? error.message : 'Processing failed'],
          processedLinks: [],
          validationIssues: [],
          duration: 0
        } as HyperlinkProcessingResult;
      }
    });

    // Batch processing with progress reporting
    ipcMain.handle('hyperlink:batch-process', async (event, request) => {
      const startTime = performance.now();
      const results = new Map<string, HyperlinkProcessingResult>();
      let totalHyperlinksProcessed = 0;
      let totalHyperlinksModified = 0;
      const errors: Array<{ file: string; error: string }> = [];

      try {
        // Validate all paths first
        const validPaths = await Promise.all(
          request.filePaths.map((fp: string) => this.validateFilePath(fp))
        );

        // Process files with controlled concurrency
        const processedResults = await this.processor.batchProcess(
          validPaths,
          request.options
        );

        // Aggregate results
        for (const [filePath, result] of processedResults) {
          results.set(filePath, result);
          if (result.success) {
            totalHyperlinksProcessed += result.processedHyperlinks;
            totalHyperlinksModified += result.modifiedHyperlinks;
          } else {
            errors.push({
              file: filePath,
              error: result.errorMessages.join(', ')
            });
          }
        }

        const summary = {
          totalFiles: request.filePaths.length,
          successfulFiles: Array.from(results.values()).filter(r => r.success).length,
          failedFiles: errors.length,
          totalHyperlinksProcessed,
          totalHyperlinksModified,
          processingTimeMs: performance.now() - startTime,
          errors
        };

        return { results, summary } as BatchProcessingResult;

      } catch (error) {
        return {
          results,
          summary: {
            totalFiles: request.filePaths.length,
            successfulFiles: 0,
            failedFiles: request.filePaths.length,
            totalHyperlinksProcessed: 0,
            totalHyperlinksModified: 0,
            processingTimeMs: performance.now() - startTime,
            errors: [{
              file: 'batch',
              error: error instanceof Error ? error.message : 'Batch processing failed'
            }]
          }
        } as BatchProcessingResult;
      }
    });

    // Validate PowerAutomate API endpoint
    ipcMain.handle('hyperlink:validate-api', async (event, request) => {
      try {
        const startTime = performance.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(request.apiUrl, {
          method: 'OPTIONS',
          signal: controller.signal
        });

        clearTimeout(timeout);
        const responseTime = performance.now() - startTime;

        return {
          isValid: response.ok || response.status === 405, // 405 if OPTIONS not supported
          message: response.ok ? 'API endpoint is reachable' : `API returned status ${response.status}`,
          responseTime
        };
      } catch (error) {
        return {
          isValid: false,
          message: error instanceof Error ? error.message : 'Validation failed'
        };
      }
    });

    // Cancel ongoing operation
    ipcMain.handle('hyperlink:cancel-operation', async (event, request) => {
      const controller = this.processingQueue.get(request.operationId);
      if (controller) {
        controller.abort();
        this.processingQueue.delete(request.operationId);
        return { success: true, message: 'Operation cancelled' };
      }
      return { success: false, message: 'Operation not found' };
    });

    // File selection dialog
    ipcMain.handle('hyperlink:select-files', async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Select Word Documents',
        filters: [
          { name: 'Word Documents', extensions: ['docx'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile', 'multiSelections']
      });

      if (!result.canceled) {
        return result.filePaths;
      }
      return [];
    });
  }

  private async validateFilePath(filePath: string): Promise<string> {
    // Normalize and validate path
    const normalizedPath = join(filePath);

    // Check if file exists
    try {
      const stats = await fsPromises.stat(normalizedPath);
      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }
    } catch (error) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    // Validate file extension
    if (!normalizedPath.toLowerCase().endsWith('.docx')) {
      throw new Error('Only .docx files are supported');
    }

    // Check file size (max 100MB)
    const stats = await fsPromises.stat(normalizedPath);
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (stats.size > maxSize) {
      throw new Error('File size exceeds 100MB limit');
    }

    return normalizedPath;
  }

  private async processWithTimeout<T>(
    promise: Promise<T>,
    signal: AbortSignal,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Operation was cancelled'));
        });
      })
    ]);
  }
}

// Initialize IPC handlers
const hyperlinkHandler = new HyperlinkIPCHandler();

// Enhanced security settings
app.on('web-contents-created', (event, contents) => {
  // Prevent new window creation
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Prevent navigation to external URLs
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost:') && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });
});

ipcMain.handle('platform', () => {
  return process.platform;
});

// File handling
ipcMain.handle('select-documents', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Word Documents', extensions: ['docx'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (!result.canceled) {
    return result.filePaths;
  }
  return undefined;
});

// Show file in folder
ipcMain.handle('show-in-folder', async (...[, path]: [Electron.IpcMainInvokeEvent, string]) => {
  if (!path) {
    throw new Error('No path provided');
  }

  try {
    // Check if file exists
    if (!fs.existsSync(path)) {
      throw new Error(`File not found: ${path}`);
    }

    // Show the file in the system file explorer
    shell.showItemInFolder(path);
  } catch (error) {
    console.error('Error showing file in folder:', error);
    throw error;
  }
});

// Get file statistics (size, modified date, etc.)
ipcMain.handle('get-file-stats', async (...[, filePath]: [Electron.IpcMainInvokeEvent, string]) => {
  if (!filePath) {
    throw new Error('No file path provided');
  }

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Get file stats
    const stats = await fsPromises.stat(filePath);

    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
    };
  } catch (error) {
    console.error('Error getting file stats:', error);
    throw error;
  }
});

// Restore document from backup
ipcMain.handle('restore-from-backup', async (...[, request]: [Electron.IpcMainInvokeEvent, { backupPath: string; targetPath: string }]) => {
  if (!request.backupPath || !request.targetPath) {
    throw new Error('Both backupPath and targetPath are required');
  }

  try {
    // Validate backup exists
    if (!fs.existsSync(request.backupPath)) {
      throw new Error(`Backup file not found: ${request.backupPath}`);
    }

    // Validate backup is a .docx file
    if (!request.backupPath.toLowerCase().endsWith('.docx')) {
      throw new Error('Backup file must be a .docx file');
    }

    // Validate target path
    if (!request.targetPath.toLowerCase().endsWith('.docx')) {
      throw new Error('Target file must be a .docx file');
    }

    // Copy backup to target location, overwriting existing file
    await fsPromises.copyFile(request.backupPath, request.targetPath);

    console.log(`[Restore] Successfully restored ${request.targetPath} from backup ${request.backupPath}`);
  } catch (error) {
    console.error('Error restoring from backup:', error);
    throw error;
  }
});

ipcMain.handle('process-document', async (...[, path]: [Electron.IpcMainInvokeEvent, string]) => {
  if (!path) {
    return { success: false, error: 'No path provided' };
  }
  try {
    const stats = fs.statSync(path);
    return {
      success: true,
      size: stats.size,
      processed: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
    };
  }
});

// Export/Import Settings
ipcMain.handle('export-settings', async () => {
  try {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Settings and Data',
      defaultPath: `DocHub-Export-${new Date().toISOString().split('T')[0]}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePath) {
      return {
        success: true,
        filePath: result.filePath
      };
    }

    return { success: false, canceled: true };
  } catch (error) {
    console.error('Error showing export dialog:', error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('import-settings', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import Settings and Data',
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const fileContent = await fsPromises.readFile(filePath, 'utf-8');

      return {
        success: true,
        data: JSON.parse(fileContent),
        filePath
      };
    }

    return { success: false, canceled: true };
  } catch (error) {
    console.error('Error importing settings:', error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('save-export-data', async (...[, request]: [Electron.IpcMainInvokeEvent, { filePath: string; data: any }]) => {
  try {
    await fsPromises.writeFile(request.filePath, JSON.stringify(request.data, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error saving export data:', error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

// ==============================================================================
// Velopack Auto-Updater Configuration
// ==============================================================================

class VelopackHandler {
  private updateCheckInProgress = false;
  private downloadInProgress = false;
  private updateManager: UpdateManager | null = null;
  private pendingUpdate: any = null;

  // Update URL - GitHub releases
  private readonly updateUrl = 'https://github.com/ItMeDiaTech/Documentation_Hub/releases/latest/download';

  constructor() {
    this.setupIPCHandlers();
  }

  private getUpdateManager(): UpdateManager {
    if (!this.updateManager) {
      this.updateManager = new UpdateManager();
    }
    return this.updateManager;
  }

  private setupIPCHandlers(): void {
    // Check for updates
    ipcMain.handle('check-for-updates', async () => {
      if (this.updateCheckInProgress) {
        return {
          success: false,
          message: 'Update check already in progress',
        };
      }

      if (isDev) {
        return {
          success: false,
          message: 'Updates are not available in development mode',
        };
      }

      try {
        this.updateCheckInProgress = true;
        this.sendStatusToWindow('Checking for updates...');
        mainWindow?.webContents.send('update-checking');

        const updateInfo = await this.getUpdateManager().checkForUpdatesAsync();

        if (updateInfo) {
          this.pendingUpdate = updateInfo;
          this.sendStatusToWindow(`Update available: ${updateInfo.targetFullRelease?.version || 'Unknown'}`);
          mainWindow?.webContents.send('update-available', {
            version: updateInfo.targetFullRelease?.version || 'Unknown',
            releaseDate: new Date().toISOString(),
            releaseNotes: '',
          });

          return {
            success: true,
            updateInfo: {
              version: updateInfo.targetFullRelease?.version,
            },
          };
        } else {
          this.sendStatusToWindow('Already up to date');
          mainWindow?.webContents.send('update-not-available', {
            version: app.getVersion(),
          });

          return {
            success: true,
            message: 'No updates available',
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to check for updates';
        this.sendStatusToWindow(`Update error: ${errorMessage}`);
        mainWindow?.webContents.send('update-error', {
          message: errorMessage,
        });

        return {
          success: false,
          message: errorMessage,
        };
      } finally {
        this.updateCheckInProgress = false;
      }
    });

    // Download update
    ipcMain.handle('download-update', async () => {
      if (this.downloadInProgress) {
        return {
          success: false,
          message: 'Download already in progress',
        };
      }

      if (!this.pendingUpdate) {
        return {
          success: false,
          message: 'No update available to download',
        };
      }

      try {
        this.downloadInProgress = true;

        // Download with progress callback
        await this.getUpdateManager().downloadUpdatesAsync(this.pendingUpdate, (progress) => {
          mainWindow?.webContents.send('update-download-progress', {
            bytesPerSecond: 0,
            percent: progress,
            transferred: 0,
            total: 100,
          });
        });

        this.sendStatusToWindow(`Update downloaded: ${this.pendingUpdate.targetFullRelease?.version}`);
        mainWindow?.webContents.send('update-downloaded', {
          version: this.pendingUpdate.targetFullRelease?.version || 'Unknown',
          releaseNotes: '',
        });

        return {
          success: true,
          message: 'Download completed',
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to download update';
        mainWindow?.webContents.send('update-error', {
          message: errorMessage,
        });

        return {
          success: false,
          message: errorMessage,
        };
      } finally {
        this.downloadInProgress = false;
      }
    });

    // Install update and restart
    ipcMain.handle('install-update', () => {
      if (this.pendingUpdate) {
        // Apply updates and restart (~2 seconds with Velopack!)
        this.getUpdateManager().applyUpdatesAndRestart(this.pendingUpdate);
      }
    });

    // Get current version
    ipcMain.handle('get-app-version', () => {
      return app.getVersion();
    });
  }

  private sendStatusToWindow(text: string): void {
    console.log('[Velopack]', text);
  }

  // Check for updates on app start (if enabled in settings)
  public async checkOnStartup(): Promise<void> {
    if (isDev) {
      console.log('[Velopack] Skipping update check in development mode');
      return;
    }

    // Wait a bit for the window to load
    setTimeout(async () => {
      try {
        console.log('[Velopack] Checking for updates on startup...');
        const updateInfo = await this.getUpdateManager().checkForUpdatesAsync();

        if (updateInfo) {
          this.pendingUpdate = updateInfo;
          mainWindow?.webContents.send('update-available', {
            version: updateInfo.targetFullRelease?.version || 'Unknown',
            releaseDate: new Date().toISOString(),
            releaseNotes: '',
          });
        }
      } catch (error) {
        console.error('[Velopack] Startup update check failed:', error);
      }
    }, 3000);
  }
}

// Initialize Velopack updater handler
const updaterHandler = new VelopackHandler();

// Check for updates on startup (will be controlled by user settings in production)
app.whenReady().then(() => {
  // Check for updates 3 seconds after app is ready
  // This can be controlled by user settings later
  if (!isDev) {
    updaterHandler.checkOnStartup();
  }
});
