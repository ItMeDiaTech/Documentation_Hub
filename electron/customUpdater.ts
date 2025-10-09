import { autoUpdater, UpdateInfo } from 'electron-updater';
import { app, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as https from 'https';
import AdmZip from 'adm-zip';

/**
 * Custom updater that implements fallback to ZIP downloads
 * when .exe downloads are blocked by network restrictions
 */
export class CustomUpdater {
  private mainWindow: Electron.BrowserWindow | null = null;
  private useZipFallback = false;
  private updateInfo: UpdateInfo | null = null;
  private isDev: boolean;

  constructor(mainWindow: Electron.BrowserWindow | null) {
    this.mainWindow = mainWindow;
    this.isDev = !app.isPackaged;
    this.setupAutoUpdater();
  }

  private setupAutoUpdater(): void {
    // Configure standard auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // Set up event handlers
    autoUpdater.on('checking-for-update', () => {
      this.sendToWindow('update-checking');
      console.log('[CustomUpdater] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      this.updateInfo = info;
      this.sendToWindow('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
      console.log(`[CustomUpdater] Update available: ${info.version}`);
    });

    autoUpdater.on('update-not-available', (info) => {
      this.sendToWindow('update-not-available', {
        version: info.version,
      });
      console.log('[CustomUpdater] No updates available');
    });

    autoUpdater.on('error', (error) => {
      // Check if it's a network-related error that might indicate blocking
      const isNetworkError = this.isNetworkBlockingError(error);

      if (isNetworkError && !this.useZipFallback && this.updateInfo) {
        console.log('[CustomUpdater] Network error detected, attempting ZIP fallback...');
        this.useZipFallback = true;
        // Trigger fallback download
        this.downloadZipUpdate();
      } else {
        this.sendToWindow('update-error', {
          message: error.message,
        });
        console.error('[CustomUpdater] Update error:', error);
      }
    });

    autoUpdater.on('download-progress', (progressObj) => {
      this.sendToWindow('update-download-progress', {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.sendToWindow('update-downloaded', {
        version: info.version,
        releaseNotes: info.releaseNotes,
      });
      console.log(`[CustomUpdater] Update downloaded: ${info.version}`);
    });
  }

  /**
   * Check if an error is likely due to network blocking
   */
  private isNetworkBlockingError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    const blockingIndicators = [
      '403',
      '404', // Sometimes networks return 404 for blocked content
      'forbidden',
      'access denied',
      'blocked',
      'timeout',
      'econnreset',
      'unable to download',
      'cannot download'
    ];

    return blockingIndicators.some(indicator => errorMessage.includes(indicator));
  }

  /**
   * Send status to renderer process
   */
  private sendToWindow(channel: string, data?: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Check for updates with automatic fallback
   */
  public async checkForUpdates(): Promise<any> {
    if (this.isDev) {
      return {
        success: false,
        message: 'Updates are not available in development mode',
      };
    }

    try {
      // First try standard update check
      const result = await autoUpdater.checkForUpdates();
      return {
        success: true,
        updateInfo: result?.updateInfo,
      };
    } catch (error) {
      console.error('[CustomUpdater] Failed to check for updates:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to check for updates',
      };
    }
  }

  /**
   * Download update with fallback support
   */
  public async downloadUpdate(): Promise<any> {
    try {
      if (this.useZipFallback) {
        // Use ZIP fallback
        return await this.downloadZipUpdate();
      } else {
        // Try standard download first
        await autoUpdater.downloadUpdate();
        return {
          success: true,
          message: 'Download started',
        };
      }
    } catch (error) {
      // If standard download fails, try ZIP fallback
      if (!this.useZipFallback && this.updateInfo) {
        console.log('[CustomUpdater] Standard download failed, trying ZIP fallback...');
        this.useZipFallback = true;
        return await this.downloadZipUpdate();
      }

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to download update',
      };
    }
  }

  /**
   * Download and extract ZIP update
   */
  private async downloadZipUpdate(): Promise<any> {
    if (!this.updateInfo) {
      return {
        success: false,
        message: 'No update information available',
      };
    }

    try {
      this.sendToWindow('update-fallback-mode', {
        message: 'Using compressed download due to network restrictions'
      });

      // Construct ZIP download URL
      const version = this.updateInfo.version;
      const zipFileName = `Documentation-Hub-Setup-${version}-Compressed.zip`;
      const releaseUrl = `https://github.com/ItMeDiaTech/Documentation_Hub/releases/download/v${version}/${zipFileName}`;

      console.log(`[CustomUpdater] Downloading ZIP from: ${releaseUrl}`);

      // Download ZIP file
      const tempDir = app.getPath('temp');
      const zipPath = path.join(tempDir, zipFileName);
      const exePath = path.join(tempDir, `Documentation-Hub-Setup-${version}.exe`);

      await this.downloadFile(releaseUrl, zipPath);

      console.log(`[CustomUpdater] ZIP downloaded to: ${zipPath}`);

      // Extract ZIP
      this.sendToWindow('update-extracting', {
        message: 'Extracting update...'
      });

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true);

      console.log(`[CustomUpdater] Extracted to: ${tempDir}`);

      // Verify the extracted .exe exists
      if (!fs.existsSync(exePath)) {
        throw new Error('Extracted installer not found');
      }

      // Clean up ZIP file
      await fsPromises.unlink(zipPath);

      // Notify that update is ready
      this.sendToWindow('update-downloaded', {
        version: version,
        releaseNotes: this.updateInfo.releaseNotes,
        fallbackUsed: true,
      });

      // Store the installer path for installation
      (global as any).fallbackInstallerPath = exePath;

      return {
        success: true,
        message: 'Update downloaded via fallback',
        fallbackUsed: true,
      };
    } catch (error) {
      console.error('[CustomUpdater] ZIP fallback failed:', error);
      this.sendToWindow('update-error', {
        message: `Fallback download failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Fallback download failed',
      };
    }
  }

  /**
   * Download a file from URL to destination
   */
  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      let downloadedBytes = 0;
      let totalBytes = 0;

      https.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            return this.downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        totalBytes = parseInt(response.headers['content-length'] || '0', 10);

        response.pipe(file);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = (downloadedBytes / totalBytes) * 100;
            this.sendToWindow('update-download-progress', {
              percent: percent,
              transferred: downloadedBytes,
              total: totalBytes,
              bytesPerSecond: 0, // Could calculate this with timestamps
            });
          }
        });

        file.on('finish', () => {
          file.close();
          resolve();
        });

      }).on('error', (err) => {
        fs.unlinkSync(destPath);
        reject(err);
      });

      file.on('error', (err) => {
        fs.unlinkSync(destPath);
        reject(err);
      });
    });
  }

  /**
   * Install update and restart
   */
  public quitAndInstall(): void {
    // Check if we have a fallback installer
    const fallbackPath = (global as any).fallbackInstallerPath;

    if (fallbackPath && fs.existsSync(fallbackPath)) {
      console.log(`[CustomUpdater] Installing from fallback: ${fallbackPath}`);

      // Launch the installer
      shell.openPath(fallbackPath).then(() => {
        // Quit the app after launching installer
        app.quit();
      }).catch((error) => {
        console.error('[CustomUpdater] Failed to launch installer:', error);
        this.sendToWindow('update-error', {
          message: 'Failed to launch installer',
        });
      });
    } else {
      // Use standard auto-updater
      autoUpdater.quitAndInstall(false, true);
    }
  }

  /**
   * Check for updates on startup
   */
  public async checkOnStartup(): Promise<void> {
    if (this.isDev) {
      console.log('[CustomUpdater] Skipping update check in development mode');
      return;
    }

    // Wait a bit for the window to load
    setTimeout(async () => {
      try {
        console.log('[CustomUpdater] Checking for updates on startup...');
        await this.checkForUpdates();
      } catch (error) {
        console.error('[CustomUpdater] Startup update check failed:', error);
      }
    }, 3000);
  }

  /**
   * Reset fallback mode (useful for testing)
   */
  public resetFallbackMode(): void {
    this.useZipFallback = false;
    (global as any).fallbackInstallerPath = undefined;
  }
}