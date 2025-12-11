import { autoUpdater, UpdateInfo } from 'electron-updater';
import { app, shell, net, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import AdmZip from 'adm-zip';
import { proxyConfig } from './proxyConfig';
import { zscalerConfig } from './zscalerConfig';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../src/utils/logger';

const execAsync = promisify(exec);
const log = logger.namespace('CustomUpdater');

/**
 * Custom updater that implements fallback to ZIP downloads
 * when .exe downloads are blocked by network restrictions
 * Enhanced with session-based proxy support and connection management
 */
export class CustomUpdater {
  private mainWindow: Electron.BrowserWindow | null = null;
  private useZipFallback = false;
  private updateInfo: UpdateInfo | null = null;
  private isDev: boolean;
  private forceUpdatesInDev: boolean; // Allow testing updates in dev mode
  private maxConcurrentConnections = 2; // Limit concurrent connections
  private activeRequests = new Set<Electron.ClientRequest>();

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
    // Configure standard auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;       // Auto-restart after silent install
    autoUpdater.disableDifferentialDownload = false; // Ensure delta/blockmap updates enabled

    // Configure to be more flexible with TLS issues
    // Note: This still validates checksums, so security is maintained
    autoUpdater.requestHeaders = {
      'User-Agent': `DocumentationHub/${app.getVersion()} (${process.platform})`
    };

    // Log TLS configuration for debugging
    log.info('Initialized with TLS configuration:', {
      NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      platform: process.platform,
      version: app.getVersion(),
      nodeVersion: process.version
    });

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
      // Check if it's a network-related error that might indicate blocking
      const isNetworkError = this.isNetworkBlockingError(error);

      if (isNetworkError && !this.useZipFallback && this.updateInfo) {
        log.info('Network error detected, attempting ZIP fallback...');
        this.useZipFallback = true;
        // Trigger fallback download
        this.downloadZipUpdate();
      } else {
        this.sendToWindow('update-error', {
          message: error.message,
        });
        log.error('Update error:', error);
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
      log.info(`Update downloaded: ${info.version}`);
    });
  }

  /**
   * Check if an error is likely due to network blocking or TLS issues
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
      'cannot download',
      // TLS/SSL specific errors
      'tls',
      'ssl',
      'certificate',
      'cert_',
      'unable to verify',
      'self signed',
      'self-signed',
      'unable to get local issuer',
      'certificate verify failed',
      'wrong version number',
      'ssl23_get_server_hello',
      'tlsv1 alert',
      '10013', // Windows TLS error state
      'schannel', // Windows SSL/TLS provider
      'secur32', // Windows security DLL
      'could not establish trust relationship',
      'underlying connection was closed'
    ];

    // Also check for specific error codes
    if ('code' in error) {
      const errorCode = (error as any).code;
      const tlsErrorCodes = [
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'CERT_HAS_EXPIRED',
        'CERT_NOT_YET_VALID',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'ERR_TLS_CERT_ALTNAME_INVALID',
        'ECONNRESET',
        'ETIMEDOUT',
        'ESOCKETTIMEDOUT'
      ];

      if (tlsErrorCodes.includes(errorCode)) {
        log.debug(`Detected TLS/network error code: ${errorCode}`);
        return true;
      }
    }

    const isBlocked = blockingIndicators.some(indicator => errorMessage.includes(indicator));
    if (isBlocked) {
      log.debug(`Detected network/TLS blocking indicator in error: ${errorMessage.substring(0, 200)}`);
    }
    return isBlocked;
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
    if (this.shouldSkipUpdates()) {
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
      log.error('Failed to check for updates:', error);
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
        log.info('Standard download failed, trying ZIP fallback...');
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

      log.info(`Downloading ZIP from: ${releaseUrl}`);

      // Download ZIP file
      const tempDir = app.getPath('temp');
      const zipPath = path.join(tempDir, zipFileName);
      const exePath = path.join(tempDir, `Documentation-Hub-Setup-${version}.exe`);

      await this.downloadFile(releaseUrl, zipPath);

      log.info(`ZIP downloaded to: ${zipPath}`);

      // Extract ZIP
      this.sendToWindow('update-extracting', {
        message: 'Extracting update...'
      });

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true);

      log.info(`Extracted to: ${tempDir}`);

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
      log.error('ZIP fallback failed:', error);
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
   * Clean up active requests
   */
  private cleanupActiveRequests(): void {
    log.debug(`Cleaning up ${this.activeRequests.size} active requests...`);
    for (const request of this.activeRequests) {
      try {
        request.abort();
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    this.activeRequests.clear();
  }

  /**
   * PowerShell download fallback for Windows (works with mutual TLS/EAP-TLS)
   */
  private async downloadWithPowerShell(url: string, destPath: string): Promise<void> {
    if (process.platform !== 'win32') {
      throw new Error('PowerShell download only available on Windows');
    }

    log.info('Attempting download with PowerShell (Mutual TLS/Enterprise network compatible)...');

    // Enhanced PowerShell command with better Zscaler handling
    const psCommand = `
      # Configure for enterprise networks with mutual TLS
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
      [Net.ServicePointManager]::Expect100Continue = $false
      [Net.ServicePointManager]::DefaultConnectionLimit = 10
      [Net.ServicePointManager]::UseNagleAlgorithm = $false

      # Use system proxy and credentials (important for MSDTC/EAP-TLS)
      [System.Net.WebRequest]::DefaultWebProxy = [System.Net.WebRequest]::GetSystemWebProxy()
      [System.Net.WebRequest]::DefaultWebProxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials

      # ENHANCED: Custom certificate validation for Zscaler
      [Net.ServicePointManager]::ServerCertificateValidationCallback = {
        param($sender, $certificate, $chain, $sslPolicyErrors)

        # Allow if no errors
        if ($sslPolicyErrors -eq 'None') { return $true }

        # Check if this is GitHub
        $url = $sender.RequestUri.Host
        if ($url -like '*github*' -or $url -like '*githubusercontent*') {
          # Check if Zscaler is in the chain
          foreach ($element in $chain.ChainElements) {
            if ($element.Certificate.Issuer -like '*Zscaler*') {
              Write-Host "INFO: Detected Zscaler certificate in chain, accepting for GitHub"
              return $true
            }
          }
        }

        # Log the error for debugging
        Write-Host "CERT_ERROR: $sslPolicyErrors for $url"

        # For GitHub domains, be more lenient
        if ($url -like '*github*') {
          Write-Host "INFO: Accepting certificate for GitHub domain despite errors"
          return $true
        }

        return $false
      }

      $ProgressPreference = 'SilentlyContinue'
      $ErrorActionPreference = 'Stop'

      try {
        $webclient = New-Object System.Net.WebClient

        # Use default credentials for mutual authentication
        $webclient.UseDefaultCredentials = $true

        # Set proxy with system credentials
        $webclient.Proxy = [System.Net.WebRequest]::GetSystemWebProxy()
        $webclient.Proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials

        # Enhanced headers for Zscaler bypass
        $webclient.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 DocumentationHub/${app.getVersion()}")
        $webclient.Headers.Add("Accept", "application/octet-stream, application/zip, */*")
        $webclient.Headers.Add("X-Zscaler-Bypass", "true")
        $webclient.Headers.Add("X-MS-CertAuth", "true")
        $webclient.Headers.Add("X-Corporate-Bypass", "software-update")

        Write-Host "INFO: Starting download from GitHub..."
        Write-Host "INFO: Using system proxy: $($webclient.Proxy.GetProxy('${url}'))"
        Write-Host "INFO: System credentials enabled for mutual TLS"

        $webclient.DownloadFile('${url}', '${destPath.replace(/\\/g, '\\\\')}')
        Write-Host "SUCCESS: Download completed"
      } catch {
        Write-Host "ERROR: $($_.Exception.Message)"
        Write-Host "DETAIL: $($_.Exception.InnerException)"
        Write-Host "TYPE: $($_.Exception.GetType().FullName)"

        # Additional debugging for certificate errors
        if ($_.Exception.Message -like '*certificate*' -or $_.Exception.Message -like '*SSL*' -or $_.Exception.Message -like '*TLS*') {
          Write-Host "CERT_DEBUG: This appears to be a certificate issue"
          Write-Host "CERT_DEBUG: Try setting ZSCALER_CERT_PATH environment variable"
          Write-Host "CERT_DEBUG: Or export Zscaler certificate from your browser"
        }

        exit 1
      }
    `.replace(/\n/g, ' ');

    try {
      const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -NonInteractive -Command "${psCommand}"`,
        { timeout: 60000 }
      );

      if (stdout.includes('SUCCESS')) {
        log.info('PowerShell download successful');
        // Verify file exists
        if (!fs.existsSync(destPath)) {
          throw new Error('Download appeared successful but file not found');
        }
      } else {
        throw new Error(`PowerShell download failed: ${stdout} ${stderr}`);
      }
    } catch (error) {
      log.error('PowerShell download failed:', error);
      throw error;
    }
  }

  /**
   * Curl download fallback (better certificate handling than Node.js)
   */
  private async downloadWithCurl(url: string, destPath: string): Promise<void> {
    log.info('Attempting download with curl...');

    // Check if curl is available
    try {
      await execAsync('curl --version');
    } catch {
      throw new Error('curl is not available');
    }

    const curlCommand = `curl -L -k --retry 3 --retry-delay 2 -o "${destPath}" "${url}"`;

    try {
      const { stdout, stderr } = await execAsync(curlCommand, { timeout: 60000 });
      log.info('Curl download completed');

      // Verify file exists
      if (!fs.existsSync(destPath)) {
        throw new Error('Curl download appeared successful but file not found');
      }
    } catch (error) {
      log.error('Curl download failed:', error);
      throw error;
    }
  }

  /**
   * Download a file using Electron's net module with exponential backoff
   * PERFORMANCE: Added absolute timeout to prevent infinite retry loops
   */
  private async downloadFile(url: string, destPath: string, attempt: number = 1): Promise<void> {
    const maxAttempts = 5;
    const retryDelays = [1000, 2000, 4000, 8000, 16000]; // Exponential backoff
    const ABSOLUTE_TIMEOUT = 120000; // 2 minutes maximum total time
    const startTime = Date.now();

    // PRIORITIZE PowerShell when Zscaler is detected - it handles corporate certificates better
    if (zscalerConfig.isDetected() && process.platform === 'win32') {
      log.warn('⚠️ ZSCALER DETECTED - Prioritizing PowerShell download for better certificate handling');
      log.info('PowerShell uses Windows Certificate Store which includes corporate certificates');

      // Try PowerShell multiple times before falling back
      for (let psAttempt = 1; psAttempt <= 3; psAttempt++) {
        try {
          log.info(`PowerShell download attempt ${psAttempt}/3...`);
          await this.downloadWithPowerShell(url, destPath);
          log.info('✅ PowerShell download successful with Zscaler!');
          return; // Success!
        } catch (error) {
          log.warn(`PowerShell attempt ${psAttempt} failed:`, error);
          if (psAttempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 2000 * psAttempt));
          }
        }
      }
      log.info('All PowerShell attempts failed, falling back to net.request...');
    }

    // On Windows without Zscaler, still try PowerShell first for better compatibility
    if (process.platform === 'win32' && attempt === 1 && !zscalerConfig.isDetected()) {
      log.info('Windows detected - trying PowerShell download with system certificates...');
      try {
        await this.downloadWithPowerShell(url, destPath);
        log.info('PowerShell download successful!');
        return; // Success!
      } catch (error) {
        log.warn('PowerShell download failed:', error);
        log.info('Falling back to net.request method...');
      }
    }

    for (let currentAttempt = attempt; currentAttempt <= maxAttempts; currentAttempt++) {
      // PERFORMANCE: Check absolute timeout before each attempt
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime > ABSOLUTE_TIMEOUT) {
        const errorMsg = `Download timeout: Exceeded maximum time limit (${ABSOLUTE_TIMEOUT / 1000}s)`;
        log.error(errorMsg);
        this.sendToWindow('update-error', {
          message: errorMsg + '. Please try manual download or check your network connection.'
        });
        throw new Error(errorMsg);
      }

      try {
        // Reset proxy configuration on retry
        if (currentAttempt > 1) {
          log.debug(`Resetting proxy configuration for attempt ${currentAttempt}...`);
          await proxyConfig.resetProxyWithRetry();

          // Clean up any lingering connections
          this.cleanupActiveRequests();

          // Wait a bit for proxy to reconfigure
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Wait if we have too many concurrent connections
        while (this.activeRequests.size >= this.maxConcurrentConnections) {
          log.debug('Waiting for connection slot...');
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        await this.downloadFileWithNet(url, destPath, currentAttempt);
        return; // Success!
      } catch (error: any) {
        const errorCode = error.code || '';
        const errorMessage = error.message || '';

        log.warn(`Download attempt ${currentAttempt} failed:`, {
          code: errorCode,
          message: errorMessage.substring(0, 200)
        });

        // Check if error is specifically ERR_CONNECTION_RESET from net module
        if (errorMessage.includes('net::ERR_CONNECTION_RESET') ||
            errorMessage.includes('ERR_CONNECTION_RESET')) {
          log.debug('Detected ERR_CONNECTION_RESET from net module');
        }

        // Check if we should retry
        const shouldRetry = currentAttempt < maxAttempts &&
                          (errorCode === 'ECONNRESET' ||
                           errorCode === 'ETIMEDOUT' ||
                           errorCode === 'ESOCKETTIMEDOUT' ||
                           errorCode === 'ERR_CONNECTION_RESET' ||
                           errorMessage.includes('ERR_CONNECTION_RESET') ||
                           errorMessage.includes('net::ERR_CONNECTION_RESET') ||
                           this.isTlsError(error) ||
                           this.isCertificateError(error));

        if (shouldRetry) {
          const delay = retryDelays[currentAttempt - 1] || 16000;

          // Check if delay would exceed absolute timeout
          const timeRemaining = ABSOLUTE_TIMEOUT - (Date.now() - startTime);
          if (delay > timeRemaining) {
            throw new Error(`Download timeout: Not enough time remaining for retry (${timeRemaining}ms left)`);
          }

          log.info(`Retrying in ${delay}ms (${timeRemaining}ms remaining)...`);

          // Send status update
          let statusMessage = 'Connection interrupted, retrying...';
          if (errorCode === 'ECONNRESET' || errorMessage.includes('ERR_CONNECTION_RESET')) {
            statusMessage = `Connection reset (attempt ${currentAttempt}/${maxAttempts}), resetting proxy and retrying...`;
          } else if (this.isCertificateError(error)) {
            statusMessage = `Certificate issue detected (attempt ${currentAttempt}/${maxAttempts}), retrying...`;
          }

          this.sendToWindow('update-status', {
            message: statusMessage
          });

          // Wait with exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Final error - provide helpful message

          // Check if this is a Zscaler-specific issue
          if (zscalerConfig.isDetected()) {
            if (zscalerConfig.isZscalerError(error) || this.isCertificateError(error)) {
              // Try PowerShell as last resort on Windows
              if (process.platform === 'win32' && currentAttempt === maxAttempts) {
                log.info('Final attempt with PowerShell for Zscaler...');
                try {
                  await this.downloadWithPowerShell(url, destPath);
                  return; // Success!
                } catch (psError) {
                  // Enhanced error message with specific instructions
                  const errorDetails = this.getZscalerErrorGuidance();
                  throw new Error(errorDetails);
                }
              }
            }
          }

          if (errorCode === 'ECONNRESET' || errorMessage.includes('ERR_CONNECTION_RESET')) {
            const errorDetails = this.getConnectionResetErrorGuidance(currentAttempt);
            throw new Error(errorDetails);
          } else if (this.isCertificateError(error)) {
            const errorDetails = this.getCertificateErrorGuidance(currentAttempt, errorMessage);
            throw new Error(errorDetails);
          } else {
            throw error;
          }
        }
      }
    }

    throw new Error(`Download failed after ${maxAttempts} attempts`);
  }

  /**
   * Download file using Electron's net.request (better proxy support)
   */
  private downloadFileWithNet(url: string, destPath: string, attempt: number): Promise<void> {
    return new Promise((resolve, reject) => {
      log.info(`Downloading with net.request (attempt ${attempt}): ${url}`);

      // Create file stream
      const file = fs.createWriteStream(destPath);
      let downloadedBytes = 0;
      let totalBytes = 0;
      let requestCompleted = false;

      // Use Electron's net module which has better proxy support
      const request = net.request({
        method: 'GET',
        url: url,
        session: session.defaultSession, // Use the configured session
        // net.request automatically uses system proxy settings
      });

      // Track this request
      this.activeRequests.add(request);

      // Set custom headers with clean User-Agent
      const cleanUA = proxyConfig.getCleanUserAgent();
      request.setHeader('User-Agent', cleanUA);
      request.setHeader('Accept', 'application/octet-stream, application/zip, */*');
      request.setHeader('Cache-Control', 'no-cache');
      request.setHeader('Connection', 'keep-alive'); // Better for proxy

      // Add Zscaler bypass headers if detected
      if (zscalerConfig.isDetected()) {
        log.debug('Adding Zscaler bypass headers');
        const bypassHeaders = zscalerConfig.getBypassHeaders();
        for (const [key, value] of Object.entries(bypassHeaders)) {
          request.setHeader(key, value);
        }
      }

      // Handle timeout (30 seconds per request)
      const timeout = setTimeout(() => {
        if (!requestCompleted) {
          log.warn('Request timeout, aborting...');
          request.abort();
          this.activeRequests.delete(request);
          reject(new Error('Download timeout - network may be too slow or blocked'));
        }
      }, 30000);

      // Handle response
      request.on('response', (response) => {
        const statusCode = response.statusCode;

        // Handle redirects
        if (statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308) {
          const redirectUrl = response.headers.location;
          if (redirectUrl && typeof redirectUrl === 'string') {
            file.close();
            log.debug(`Following redirect to: ${redirectUrl}`);
            this.downloadFileWithNet(redirectUrl, destPath, attempt).then(resolve).catch(reject);
            return;
          }
        }

        // Check for successful response
        if (statusCode !== 200) {
          file.close();
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
          reject(new Error(`Failed to download: HTTP ${statusCode}`));
          return;
        }

        // Get content length
        const contentLength = response.headers['content-length'];
        if (contentLength) {
          totalBytes = parseInt(Array.isArray(contentLength) ? contentLength[0] : contentLength, 10);
        }

        // Handle data
        response.on('data', (chunk) => {
          file.write(chunk);
          downloadedBytes += chunk.length;

          if (totalBytes > 0) {
            const percent = (downloadedBytes / totalBytes) * 100;
            this.sendToWindow('update-download-progress', {
              percent: percent,
              transferred: downloadedBytes,
              total: totalBytes,
              bytesPerSecond: 0,
            });
          }
        });

        response.on('end', () => {
          requestCompleted = true;
          clearTimeout(timeout);
          this.activeRequests.delete(request);
          file.end(() => {
            log.info(`Download complete: ${downloadedBytes} bytes`);
            resolve();
          });
        });

        response.on('error', (error) => {
          requestCompleted = true;
          clearTimeout(timeout);
          this.activeRequests.delete(request);
          file.close();
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
          reject(error);
        });
      });

      // Handle request errors
      request.on('error', (error) => {
        if (!requestCompleted) {
          this.activeRequests.delete(request);
          clearTimeout(timeout);
        }
        file.close();
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }

        // Log detailed error information
        log.error('net.request error:', {
          code: (error as any).code,
          message: error.message,
          syscall: (error as any).syscall,
          errno: (error as any).errno,
          attempt: attempt
        });

        reject(error);
      });

      // Handle abort
      request.on('abort', () => {
        if (!requestCompleted) {
          this.activeRequests.delete(request);
          clearTimeout(timeout);
        }
        file.close();
        if (fs.existsSync(destPath)) {
          fs.unlinkSync(destPath);
        }
        reject(new Error('Request was aborted'));
      });

      // Send the request
      request.end();
    });
  }

  /**
   * Check if an error is TLS/certificate related
   */
  private isTlsError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    const code = error.code || '';

    return message.includes('certificate') ||
           message.includes('tls') ||
           message.includes('ssl') ||
           message.includes('self signed') ||
           message.includes('unable to verify') ||
           code.includes('CERT') ||
           code.includes('TLS') ||
           code.includes('SSL');
  }

  /**
   * Check specifically for certificate errors
   */
  private isCertificateError(error: any): boolean {
    const code = error.code || '';
    const message = error.message?.toLowerCase() || '';

    // Specific certificate error codes
    const certErrorCodes = [
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'CERT_HAS_EXPIRED',
      'CERT_NOT_YET_VALID',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'CERT_CHAIN_TOO_LONG',
      'CERT_REVOKED',
      'INVALID_CA',
      'UNABLE_TO_GET_ISSUER_CERT'
    ];

    // Check for specific error codes
    if (certErrorCodes.includes(code)) {
      log.debug(`Certificate error detected: ${code}`);
      return true;
    }

    // Check for certificate-related messages
    const certMessages = [
      'unable to get local issuer certificate',
      'unable to verify the first certificate',
      'certificate verify failed',
      'certificate has expired',
      'self signed certificate',
      'unable to get issuer cert locally'
    ];

    const hasCertMessage = certMessages.some(msg => message.includes(msg));
    if (hasCertMessage) {
      log.debug(`Certificate error message detected: ${message.substring(0, 100)}`);
      return true;
    }

    return false;
  }

  /**
   * Open download page in browser as last resort
   */
  public async openDownloadInBrowser(): Promise<void> {
    if (!this.updateInfo) {
      const githubReleasesUrl = 'https://github.com/ItMeDiaTech/Documentation_Hub/releases/latest';
      log.info('Opening GitHub releases page in browser');
      await shell.openExternal(githubReleasesUrl);
      return;
    }

    const version = this.updateInfo.version;
    const downloadUrl = `https://github.com/ItMeDiaTech/Documentation_Hub/releases/download/v${version}/Documentation-Hub-Setup-${version}.exe`;

    log.info('Opening direct download link in browser:', downloadUrl);
    this.sendToWindow('update-manual-download', {
      message: 'Opening download in your browser. Please download and install manually.',
      downloadUrl: downloadUrl
    });

    await shell.openExternal(downloadUrl);
  }

  /**
   * Install update and restart
   * Uses silent install with auto-restart for seamless user experience
   */
  public quitAndInstall(): void {
    log.info('Installing update and restarting...');

    // Check if we have a fallback installer
    const fallbackPath = (global as any).fallbackInstallerPath;

    if (fallbackPath && fs.existsSync(fallbackPath)) {
      log.info(`Installing from fallback: ${fallbackPath}`);

      // Launch the installer
      shell.openPath(fallbackPath).then(() => {
        // Quit the app after launching installer
        app.quit();
      }).catch((error) => {
        log.error('Failed to launch installer:', error);
        this.sendToWindow('update-error', {
          message: 'Failed to launch installer',
        });
      });
    } else {
      // Remove listeners that might prevent quit
      app.removeAllListeners('window-all-closed');

      // Use standard auto-updater with silent install
      // quitAndInstall(isSilent, isForceRunAfter)
      // isSilent=true: No installer UI shown
      // isForceRunAfter=true: App restarts after silent install
      autoUpdater.quitAndInstall(true, true);
    }
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
   * Reset fallback mode (useful for testing)
   */
  public resetFallbackMode(): void {
    this.useZipFallback = false;
    (global as any).fallbackInstallerPath = undefined;
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

  /**
   * Get detailed Zscaler error guidance
   */
  private getZscalerErrorGuidance(): string {
    return `🔒 ZSCALER SSL INSPECTION BLOCKING DOWNLOADS

Documentation Hub has detected that Zscaler is intercepting secure connections to GitHub.

IMMEDIATE SOLUTIONS:
━━━━━━━━━━━━━━━━━
1. AUTOMATIC FIX (Recommended):
   • Restart Documentation Hub
   • The app will attempt to auto-configure Zscaler certificates

2. MANUAL CERTIFICATE EXPORT:
   • Open Chrome/Edge browser
   • Go to: https://github.com
   • Click the padlock icon → Connection is secure → Certificate details
   • Go to "Details" tab → Copy to File → Export as Base64 .CER
   • Save as: C:\\Zscaler\\ZscalerRootCertificate.pem
   • Set environment variable: ZSCALER_CERT_PATH=C:\\Zscaler\\ZscalerRootCertificate.pem
   • Restart Documentation Hub

3. IT DEPARTMENT REQUEST:
   • Request bypass for: *.github.com, *.githubusercontent.com
   • Reference: "Software update downloads from GitHub Releases"

4. MANUAL DOWNLOAD (Last Resort):
   • Visit: https://github.com/ItMeDiaTech/Documentation_Hub/releases
   • Download the latest .exe manually
   • Install outside of the application

TECHNICAL DETAILS:
• Zscaler performs "SSL inspection" by replacing GitHub's certificate
• This breaks secure connections unless Zscaler's certificate is trusted
• PowerShell download method attempted but failed
• Your organization's policy may require special authentication

Need help? Contact your IT department with error code: ZSCALER_CERT_REQUIRED`;
  }

  /**
   * Get detailed connection reset error guidance
   */
  private getConnectionResetErrorGuidance(attempts: number): string {
    const isZscaler = zscalerConfig.isDetected();

    return `⚠️ CONNECTION RESET BY NETWORK (${attempts} attempts failed)

${isZscaler ? 'Zscaler/Corporate proxy' : 'Your network'} is terminating the connection to GitHub.

SOLUTIONS TO TRY:
━━━━━━━━━━━━━━━
1. CHECK PROXY SETTINGS:
   ${process.platform === 'win32' ?
   `• Open Windows Settings → Network & Internet → Proxy
   • Note any proxy server address
   • Set environment variables:
     - HTTPS_PROXY=http://your-proxy:port
     - HTTP_PROXY=http://your-proxy:port` :
   `• Check your system proxy settings
   • Set HTTPS_PROXY and HTTP_PROXY environment variables`}

2. FIREWALL/VPN ISSUES:
   • Temporarily disable VPN if connected
   • Check if Windows Firewall is blocking Documentation Hub
   • Try from a different network (home/mobile hotspot)

3. CORPORATE NETWORK:
   ${isZscaler ?
   `• Zscaler is detected - certificate issues likely
   • Try the Zscaler solutions (restart app for auto-fix)` :
   `• Your corporate firewall may block GitHub
   • Contact IT to whitelist github.com`}

4. RESET NETWORK:
   • Run as Administrator:
     - netsh winsock reset
     - netsh int ip reset
     - ipconfig /flushdns
   • Restart your computer

DIAGNOSTIC INFO:
• Error: ECONNRESET
• Target: github.com
• Proxy: ${proxyConfig.getProxyUrl() || 'Not configured'}
• Platform: ${process.platform}`;
  }

  /**
   * Get detailed certificate error guidance
   */
  private getCertificateErrorGuidance(attempts: number, errorMessage: string): string {
    const isZscaler = zscalerConfig.isDetected();
    const certPath = process.env.NODE_EXTRA_CA_CERTS;

    return `🔐 CERTIFICATE VERIFICATION FAILED (${attempts} attempts)

${isZscaler ? 'Zscaler SSL inspection' : 'Your network'} is using custom certificates that aren't trusted.

SOLUTIONS:
━━━━━━━━━
1. ${isZscaler ? 'ZSCALER CERTIFICATE' : 'CORPORATE CERTIFICATE'} CONFIGURATION:
   ${certPath ?
   `• Certificate configured at: ${certPath}
   • But still failing - certificate may be expired or wrong` :
   `• No certificate configured yet
   • Export certificate from your browser when visiting github.com`}

   Steps to export certificate:
   a. Open https://github.com in Chrome/Edge
   b. Click padlock → Certificate → Details tab
   c. Select root certificate (usually "${isZscaler ? 'Zscaler Root CA' : 'Your Company CA'}")
   d. Export → Base64 encoded → Save as .pem file
   e. Set: NODE_EXTRA_CA_CERTS=path/to/certificate.pem
   f. Restart Documentation Hub

2. WINDOWS CERTIFICATE STORE:
   ${process.platform === 'win32' ?
   `• The app will try to find certificates automatically
   • Run: certmgr.msc
   • Look in Trusted Root Certification Authorities
   • Export any Zscaler or corporate certificates` :
   `• Not available on ${process.platform}`}

3. BYPASS CERTIFICATE CHECK (NOT RECOMMENDED):
   ⚠️ Security Risk - Only for testing:
   • Set: NODE_TLS_REJECT_UNAUTHORIZED=0
   • This disables ALL certificate verification

4. ALTERNATIVE DOWNLOAD:
   • Use ZIP fallback (automatic)
   • Or download manually from GitHub releases

ERROR DETAILS:
${errorMessage.substring(0, 200)}
Certificate Path: ${certPath || 'Not set'}
Zscaler: ${isZscaler ? 'Detected' : 'Not detected'}`;
  }
}