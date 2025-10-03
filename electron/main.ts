import { app, BrowserWindow, ipcMain, shell, Menu, dialog, session } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { WordDocumentProcessor } from '../src/services/document/WordDocumentProcessor';
import type {
  BatchProcessingOptions,
  BatchProcessingResult,
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult
} from '../src/types/hyperlink';

let mainWindow: BrowserWindow | null = null;
const isDev = process.env.NODE_ENV !== 'production';

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
    icon: join(__dirname, '../public/icon.png'),
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
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
