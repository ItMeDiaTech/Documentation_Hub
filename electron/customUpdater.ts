import { autoUpdater, UpdateInfo } from 'electron-updater';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../src/utils/logger';

const log = logger.namespace('CustomUpdater');

/**
 * Custom updater with delta update support and silent install
 */
export class CustomUpdater {
  private mainWindow: Electron.BrowserWindow | null = null;
  private updateInfo: UpdateInfo | null = null;
  private isDev: boolean;
  private forceUpdatesInDev: boolean;

  constructor(mainWindow: Electron.BrowserWindow | null) {
    this.mainWindow = mainWindow;
    this.isDev = !app.isPackaged;
    this.forceUpdatesInDev = process.env.FORCE_DEV_UPDATE_CONFIG === 'true';
    this.configureDevUpdateServer();
    this.setupAutoUpdater();
  }

  /** Returns true if updates should be skipped (dev mode without force flag) */
  private shouldSkipUpdates(): boolean {
    return this.isDev && !this.forceUpdatesInDev;
  }

  /**
   * Configure dev update server for local testing
   * Set FORCE_DEV_UPDATE_CONFIG=true env var to test against local server
   */
  private configureDevUpdateServer(): void {
    const forceDevConfig = process.env.FORCE_DEV_UPDATE_CONFIG === 'true';

    if (forceDevConfig || (this.isDev && process.env.TEST_UPDATES === 'true')) {
      // When running from dist/electron/, go up two levels to project root
      const devConfigPath = path.join(__dirname, '..', '..', 'dev-app-update.yml');

      if (fs.existsSync(devConfigPath)) {
        log.info('Using dev update config for local testing:', devConfigPath);
        autoUpdater.forceDevUpdateConfig = true;
        autoUpdater.updateConfigPath = devConfigPath;
      } else {
        log.warn('Dev update config not found at:', devConfigPath);
      }
    }
  }

  private setupAutoUpdater(): void {
    // Configure auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;       // Auto-restart after silent install
    autoUpdater.disableDifferentialDownload = false; // Enable delta/blockmap updates

    // Set up event handlers
    autoUpdater.on('checking-for-update', () => {
      this.sendToWindow('update-checking');
      log.info('Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      this.updateInfo = info;
      this.sendToWindow('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
      log.info(`Update available: ${info.version}`);
    });

    autoUpdater.on('update-not-available', (info) => {
      this.sendToWindow('update-not-available', {
        version: info.version,
      });
      log.info('No updates available');
    });

    autoUpdater.on('error', (error) => {
      this.sendToWindow('update-error', {
        message: error.message,
      });
      log.error('Update error:', error);
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
      log.info(`Update downloaded: ${info.version}`);
    });
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
   * Check for updates
   */
  public async checkForUpdates(): Promise<any> {
    if (this.shouldSkipUpdates()) {
      return {
        success: false,
        message: 'Updates are not available in development mode',
      };
    }

    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        success: true,
        updateInfo: result?.updateInfo,
      };
    } catch (error) {
      log.error('Failed to check for updates:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to check for updates',
      };
    }
  }

  /**
   * Download update
   */
  public async downloadUpdate(): Promise<any> {
    try {
      await autoUpdater.downloadUpdate();
      return {
        success: true,
        message: 'Download started',
      };
    } catch (error) {
      log.error('Failed to download update:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to download update',
      };
    }
  }

  /**
   * Install update and restart
   * Uses silent install with auto-restart for seamless user experience
   */
  public quitAndInstall(): void {
    log.info('Installing update and restarting...');

    // Remove listeners that might prevent quit
    app.removeAllListeners('window-all-closed');

    // Use standard auto-updater with silent install
    // quitAndInstall(isSilent, isForceRunAfter)
    // isSilent=true: No installer UI shown
    // isForceRunAfter=true: App restarts after silent install
    autoUpdater.quitAndInstall(true, true);
  }

  /**
   * Check for updates on startup
   */
  public async checkOnStartup(): Promise<void> {
    if (this.shouldSkipUpdates()) {
      log.info('Skipping update check in development mode');
      return;
    }

    // Wait a bit for the window to load
    setTimeout(async () => {
      try {
        log.info('Checking for updates on startup...');
        await this.checkForUpdates();
      } catch (error) {
        log.error('Startup update check failed:', error);
      }
    }, 3000);
  }

  /**
   * Start scheduled periodic update checks
   * @param intervalMs Interval between checks in milliseconds (default: 4 hours)
   */
  public startScheduledChecks(intervalMs: number = 4 * 60 * 60 * 1000): void {
    if (this.shouldSkipUpdates()) {
      log.info('Skipping scheduled update checks in development mode');
      return;
    }

    log.info(`Starting scheduled update checks every ${intervalMs / (60 * 60 * 1000)} hours`);

    setInterval(async () => {
      try {
        log.info('Running scheduled update check...');
        await this.checkForUpdates();
      } catch (error) {
        log.error('Scheduled update check failed:', error);
      }
    }, intervalMs);
  }
}
