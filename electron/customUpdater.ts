import { autoUpdater, UpdateInfo } from 'electron-updater';
import { app, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { PublicClientApplication, Configuration, InteractiveRequest, AccountInfo } from '@azure/msal-node';
import { logger } from '../src/utils/logger';
import * as yaml from 'js-yaml';

const log = logger.namespace('CustomUpdater');

/**
 * SharePoint update provider configuration
 */
interface UpdateProviderConfig {
  type: 'github' | 'sharepoint';
  sharePointUrl?: string;
}

/**
 * Custom updater with delta update support, silent install, and SharePoint source
 */
export class CustomUpdater {
  private mainWindow: Electron.BrowserWindow | null = null;
  private updateInfo: UpdateInfo | null = null;
  private isDev: boolean;
  private forceUpdatesInDev: boolean;

  // SharePoint update source state
  private msalApp: PublicClientApplication | null = null;
  private sharePointUrl: string | null = null;
  private accessToken: string | null = null;
  private currentProvider: 'github' | 'sharepoint' = 'github';
  private accountInfo: AccountInfo | null = null;

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
   * Check for updates (supports GitHub and SharePoint sources)
   */
  public async checkForUpdates(): Promise<any> {
    if (this.shouldSkipUpdates()) {
      return {
        success: false,
        message: 'Updates are not available in development mode',
      };
    }

    // SharePoint: Only use if enabled AND URL provided AND authenticated
    if (this.currentProvider === 'sharepoint' && this.sharePointUrl && this.accessToken) {
      try {
        const result = await this.checkSharePointUpdates();
        if (result.success) return result;
        // Fall through to GitHub on failure
        log.warn('SharePoint update check failed, falling back to GitHub');
        this.sendToWindow('update-status', { message: 'SharePoint unavailable, checking GitHub...' });
      } catch (error) {
        log.error('SharePoint update check error', { error });
        this.sendToWindow('update-status', { message: 'SharePoint error, falling back to GitHub...' });
      }
    }

    // Default: GitHub
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

  // ============================================================================
  // SharePoint Update Source Methods
  // ============================================================================

  /**
   * Set the update provider (GitHub or SharePoint)
   */
  public async setProvider(config: UpdateProviderConfig): Promise<{ success: boolean; error?: string }> {
    try {
      this.currentProvider = config.type;

      if (config.type === 'sharepoint' && config.sharePointUrl) {
        this.sharePointUrl = config.sharePointUrl;
        log.info('Update provider set to SharePoint', { url: config.sharePointUrl });
      } else {
        this.sharePointUrl = null;
        this.accessToken = null;
        this.currentProvider = 'github';
        log.info('Update provider set to GitHub (default)');
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to set provider';
      log.error('Failed to set update provider', { error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Interactive Microsoft login for SharePoint access
   */
  public async sharePointLogin(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.msalApp) {
        this.initializeMsal();
      }

      if (!this.msalApp) {
        return { success: false, error: 'Failed to initialize authentication' };
      }

      // Try to acquire token silently first if we have cached account
      if (this.accountInfo) {
        try {
          const silentResult = await this.msalApp.acquireTokenSilent({
            account: this.accountInfo,
            scopes: ['https://graph.microsoft.com/Files.Read.All'],
          });
          this.accessToken = silentResult.accessToken;
          log.info('SharePoint token acquired silently');
          return { success: true };
        } catch {
          // Silent acquisition failed, proceed with interactive
          log.info('Silent token acquisition failed, proceeding with interactive login');
        }
      }

      // Interactive login - open browser for user to sign in
      const interactiveRequest: InteractiveRequest = {
        scopes: ['https://graph.microsoft.com/Files.Read.All'],
        openBrowser: async (url: string) => {
          await shell.openExternal(url);
        },
        successTemplate: '<h1>Authentication Successful</h1><p>You can close this window and return to Documentation Hub.</p>',
        errorTemplate: '<h1>Authentication Failed</h1><p>{{error}}</p>',
      };

      const authResult = await this.msalApp.acquireTokenInteractive(interactiveRequest);
      this.accessToken = authResult.accessToken;
      this.accountInfo = authResult.account;

      log.info('SharePoint login successful');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      log.error('SharePoint login failed', { error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Logout from SharePoint
   */
  public async sharePointLogout(): Promise<void> {
    this.accessToken = null;
    this.accountInfo = null;

    if (this.msalApp) {
      try {
        const tokenCache = this.msalApp.getTokenCache();
        const accounts = await tokenCache.getAllAccounts();
        for (const account of accounts) {
          await tokenCache.removeAccount(account);
        }
      } catch (error) {
        log.warn('Error clearing token cache:', error);
      }
    }

    log.info('SharePoint logout complete');
  }

  /**
   * Test SharePoint connection
   */
  public async testSharePointConnection(url: string): Promise<{ success: boolean; message: string; authenticated?: boolean }> {
    // Validate URL format
    if (!this.isValidSharePointUrl(url)) {
      return { success: false, message: 'Invalid SharePoint URL. Must be https://*.sharepoint.com/sites/...' };
    }

    // Check if authenticated
    if (!this.accessToken) {
      return { success: false, message: 'Not authenticated. Please sign in to Microsoft first.', authenticated: false };
    }

    try {
      // Try to access latest.yml
      const latestYmlUrl = this.buildGraphApiUrl(url, 'latest.yml');
      log.info('Testing SharePoint connection', { url: latestYmlUrl });

      const response = await this.fetchWithAuth(latestYmlUrl);

      if (response.ok) {
        return { success: true, message: 'Connected! Update manifest (latest.yml) found.', authenticated: true };
      } else if (response.status === 404) {
        return { success: true, message: 'Connected to SharePoint, but latest.yml not found. Please upload the update files.', authenticated: true };
      } else if (response.status === 401 || response.status === 403) {
        return { success: false, message: `Access denied (${response.status}). Please check folder permissions.`, authenticated: true };
      } else {
        return { success: false, message: `SharePoint returned status ${response.status}: ${response.statusText}`, authenticated: true };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      log.error('SharePoint connection test failed', { error: message });
      return { success: false, message: `Connection failed: ${message}`, authenticated: true };
    }
  }

  /**
   * Check for updates from SharePoint
   */
  private async checkSharePointUpdates(): Promise<any> {
    if (!this.sharePointUrl || !this.accessToken) {
      throw new Error('SharePoint not configured or not authenticated');
    }

    // Fetch latest.yml from SharePoint
    const latestYmlUrl = this.buildGraphApiUrl(this.sharePointUrl, 'latest.yml');
    log.info('Checking for updates from SharePoint', { url: latestYmlUrl });

    const response = await this.fetchWithAuth(latestYmlUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch latest.yml: ${response.status} ${response.statusText}`);
    }

    const yamlContent = await response.text();
    const updateManifest = yaml.load(yamlContent) as any;

    if (!updateManifest || !updateManifest.version) {
      throw new Error('Invalid latest.yml format - missing version');
    }

    const currentVersion = app.getVersion();
    const availableVersion = updateManifest.version;

    log.info('SharePoint update check', { currentVersion, availableVersion });

    // Compare versions
    if (this.isNewerVersion(availableVersion, currentVersion)) {
      // Update available
      this.updateInfo = {
        version: availableVersion,
        releaseDate: updateManifest.releaseDate || new Date().toISOString(),
        releaseNotes: updateManifest.releaseNotes || '',
        files: updateManifest.files || [],
        path: updateManifest.path || '',
        sha512: updateManifest.sha512 || '',
      } as UpdateInfo;

      this.sendToWindow('update-available', {
        version: availableVersion,
        releaseDate: updateManifest.releaseDate || '',
        releaseNotes: updateManifest.releaseNotes || '',
      });

      log.info(`SharePoint update available: ${availableVersion}`);
      return { success: true, updateInfo: this.updateInfo };
    } else {
      // No update available
      this.sendToWindow('update-not-available', {
        version: currentVersion,
      });
      log.info('No SharePoint updates available');
      return { success: true, updateInfo: null };
    }
  }

  /**
   * Validate SharePoint URL format
   */
  private isValidSharePointUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      // Must be HTTPS and a sharepoint.com domain
      if (parsed.protocol !== 'https:') return false;
      if (!parsed.hostname.endsWith('.sharepoint.com')) return false;
      // Should contain /sites/ in the path
      if (!parsed.pathname.includes('/sites/')) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize MSAL for interactive login
   * Uses the public Microsoft Office client ID which allows delegated user permissions
   */
  private initializeMsal(): void {
    const config: Configuration = {
      auth: {
        // Microsoft Office public client ID - works for delegated user auth
        clientId: 'd3590ed6-52b3-4102-aeff-aad2292ab01c',
        authority: 'https://login.microsoftonline.com/common',
      },
      cache: {
        // Use in-memory cache (not persisted between sessions)
      },
    };

    this.msalApp = new PublicClientApplication(config);
    log.info('MSAL client initialized for SharePoint updates');
  }

  /**
   * Build Microsoft Graph API URL for SharePoint file access
   *
   * Converts a SharePoint URL like:
   * https://company.sharepoint.com/sites/IT/Shared Documents/Updates
   *
   * To a Graph API URL like:
   * https://graph.microsoft.com/v1.0/sites/company.sharepoint.com:/sites/IT:/drive/root:/Shared Documents/Updates/filename:/content
   */
  private buildGraphApiUrl(folderUrl: string, fileName: string): string {
    const url = new URL(folderUrl);
    const hostname = url.hostname;
    const pathParts = url.pathname.split('/').filter(p => p);

    // Find the site path (e.g., /sites/IT)
    const siteIndex = pathParts.indexOf('sites');
    if (siteIndex === -1) {
      throw new Error('Invalid SharePoint URL - must contain /sites/');
    }

    const siteName = pathParts[siteIndex + 1];
    if (!siteName) {
      throw new Error('Invalid SharePoint URL - missing site name');
    }

    // Everything after the site name is the folder path
    const folderPath = pathParts.slice(siteIndex + 2).join('/');

    // Build the Graph API URL
    // Format: /sites/{hostname}:/sites/{siteName}:/drive/root:/{folderPath}/{fileName}:/content
    const graphUrl = `https://graph.microsoft.com/v1.0/sites/${hostname}:/sites/${siteName}:/drive/root:/${encodeURIComponent(folderPath)}/${encodeURIComponent(fileName)}:/content`;

    return graphUrl;
  }

  /**
   * Fetch with Bearer token authentication
   */
  private async fetchWithAuth(url: string): Promise<Response> {
    if (!this.accessToken) {
      throw new Error('No access token available');
    }

    return fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'User-Agent': `DocumentationHub/${app.getVersion()} (${process.platform})`,
      },
    });
  }

  /**
   * Compare versions to determine if target is newer than current
   */
  private isNewerVersion(target: string, current: string): boolean {
    const targetParts = target.split('.').map(Number);
    const currentParts = current.split('.').map(Number);

    for (let i = 0; i < Math.max(targetParts.length, currentParts.length); i++) {
      const t = targetParts[i] || 0;
      const c = currentParts[i] || 0;
      if (t > c) return true;
      if (t < c) return false;
    }
    return false;
  }

  /**
   * Download a specific file from SharePoint using interactive authentication
   *
   * This method is used for downloading dictionary files. It requires the user
   * to be authenticated via sharePointLogin() first.
   *
   * @param fileUrl - Direct SharePoint URL to the file (e.g., https://company.sharepoint.com/sites/IT/Shared Documents/Dictionary.xlsx)
   * @returns Buffer containing the file content, or error
   */
  public async downloadSharePointFile(fileUrl: string): Promise<{ success: boolean; data?: Buffer; error?: string }> {
    try {
      // Validate URL format
      if (!this.isValidSharePointUrl(fileUrl)) {
        return { success: false, error: 'Invalid SharePoint URL. Must be https://*.sharepoint.com/sites/...' };
      }

      // Check authentication
      if (!this.accessToken) {
        // Try to acquire token silently first
        const loginResult = await this.sharePointLogin();
        if (!loginResult.success) {
          return { success: false, error: loginResult.error || 'Authentication required. Please sign in first.' };
        }
      }

      // Build Graph API URL for the specific file
      const graphApiUrl = this.buildGraphApiUrlForFile(fileUrl);
      log.info('Downloading SharePoint file via Graph API:', graphApiUrl);

      // Download the file
      const response = await this.fetchWithAuth(graphApiUrl);

      if (!response.ok) {
        const errorText = await response.text();
        log.error('SharePoint file download failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        return {
          success: false,
          error: `Download failed: ${response.status} ${response.statusText}`,
        };
      }

      // Convert response to Buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      log.info('SharePoint file downloaded successfully', { size: buffer.length });
      return { success: true, data: buffer };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      log.error('SharePoint file download error:', { error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Build Microsoft Graph API URL for a specific SharePoint file
   *
   * Converts a SharePoint file URL like:
   * https://company.sharepoint.com/sites/IT/Shared Documents/Folder/Dictionary.xlsx
   *
   * To a Graph API URL like:
   * https://graph.microsoft.com/v1.0/sites/company.sharepoint.com:/sites/IT:/drive/root:/Shared Documents/Folder/Dictionary.xlsx:/content
   */
  private buildGraphApiUrlForFile(fileUrl: string): string {
    const url = new URL(fileUrl);
    const hostname = url.hostname;
    const pathParts = url.pathname.split('/').filter(p => p);

    // Find the site path (e.g., /sites/IT)
    const siteIndex = pathParts.indexOf('sites');
    if (siteIndex === -1) {
      throw new Error('Invalid SharePoint URL - must contain /sites/');
    }

    const siteName = pathParts[siteIndex + 1];
    if (!siteName) {
      throw new Error('Invalid SharePoint URL - missing site name');
    }

    // Everything after the site name is the file path (including filename)
    const filePath = pathParts.slice(siteIndex + 2).join('/');

    // Build the Graph API URL for the specific file
    // Format: /sites/{hostname}:/sites/{siteName}:/drive/root:/{filePath}:/content
    const graphUrl = `https://graph.microsoft.com/v1.0/sites/${hostname}:/sites/${siteName}:/drive/root:/${filePath}:/content`;

    return graphUrl;
  }

  /**
   * Check if authenticated for SharePoint access
   */
  public isSharePointAuthenticated(): boolean {
    return this.accessToken !== null;
  }
}
