import { autoUpdater, UpdateInfo } from 'electron-updater';
import { app, shell, net, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as https from 'https';
import AdmZip from 'adm-zip';
import { proxyConfig } from './proxyConfig';
import { zscalerConfig } from './zscalerConfig';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
  private maxConcurrentConnections = 2; // Limit concurrent connections
  private activeRequests = new Set<Electron.ClientRequest>();

  constructor(mainWindow: Electron.BrowserWindow | null) {
    this.mainWindow = mainWindow;
    this.isDev = !app.isPackaged;
    this.setupAutoUpdater();
  }

  private setupAutoUpdater(): void {
    // Configure standard auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // Configure to be more flexible with TLS issues
    // Note: This still validates checksums, so security is maintained
    autoUpdater.requestHeaders = {
      'User-Agent': `DocumentationHub/${app.getVersion()} (${process.platform})`
    };

    // Log TLS configuration for debugging
    console.log('[CustomUpdater] Initialized with TLS configuration:', {
      NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      platform: process.platform,
      version: app.getVersion(),
      nodeVersion: process.version
    });

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
        console.log(`[CustomUpdater] Detected TLS/network error code: ${errorCode}`);
        return true;
      }
    }

    const isBlocked = blockingIndicators.some(indicator => errorMessage.includes(indicator));
    if (isBlocked) {
      console.log(`[CustomUpdater] Detected network/TLS blocking indicator in error: ${errorMessage.substring(0, 200)}`);
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
   * Clean up active requests
   */
  private cleanupActiveRequests(): void {
    console.log(`[CustomUpdater] Cleaning up ${this.activeRequests.size} active requests...`);
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

    console.log('[CustomUpdater] Attempting download with PowerShell (Mutual TLS/Enterprise network compatible)...');

    const psCommand = `
      # Configure for enterprise networks with mutual TLS
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      [Net.ServicePointManager]::Expect100Continue = $false
      [Net.ServicePointManager]::DefaultConnectionLimit = 10

      # Use system proxy and credentials (important for MSDTC/EAP-TLS)
      [System.Net.WebRequest]::DefaultWebProxy = [System.Net.WebRequest]::GetSystemWebProxy()
      [System.Net.WebRequest]::DefaultWebProxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials

      # Allow certificate validation to use system store
      [Net.ServicePointManager]::ServerCertificateValidationCallback = $null

      $ProgressPreference = 'SilentlyContinue'
      $ErrorActionPreference = 'Stop'

      try {
        $webclient = New-Object System.Net.WebClient

        # Use default credentials for mutual authentication
        $webclient.UseDefaultCredentials = $true

        # Set proxy with system credentials
        $webclient.Proxy = [System.Net.WebRequest]::GetSystemWebProxy()
        $webclient.Proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials

        # Headers for better compatibility
        $webclient.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 DocumentationHub/${app.getVersion()}")
        $webclient.Headers.Add("Accept", "application/octet-stream, application/zip, */*")

        Write-Host "INFO: Starting download from $('${url}'.Substring(0, [Math]::Min(50, '${url}'.Length)))..."
        Write-Host "INFO: Using system proxy: $($webclient.Proxy.GetProxy('${url}'))"

        $webclient.DownloadFile('${url}', '${destPath.replace(/\\/g, '\\\\')}')
        Write-Host "SUCCESS"
      } catch {
        Write-Host "ERROR: $($_.Exception.Message)"
        Write-Host "DETAIL: $($_.Exception.InnerException)"
        Write-Host "TYPE: $($_.Exception.GetType().FullName)"
        exit 1
      }
    `.replace(/\n/g, ' ');

    try {
      const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -NonInteractive -Command "${psCommand}"`,
        { timeout: 60000 }
      );

      if (stdout.includes('SUCCESS')) {
        console.log('[CustomUpdater] PowerShell download successful');
        // Verify file exists
        if (!fs.existsSync(destPath)) {
          throw new Error('Download appeared successful but file not found');
        }
      } else {
        throw new Error(`PowerShell download failed: ${stdout} ${stderr}`);
      }
    } catch (error) {
      console.error('[CustomUpdater] PowerShell download failed:', error);
      throw error;
    }
  }

  /**
   * Curl download fallback (better certificate handling than Node.js)
   */
  private async downloadWithCurl(url: string, destPath: string): Promise<void> {
    console.log('[CustomUpdater] Attempting download with curl...');

    // Check if curl is available
    try {
      await execAsync('curl --version');
    } catch {
      throw new Error('curl is not available');
    }

    const curlCommand = `curl -L -k --retry 3 --retry-delay 2 -o "${destPath}" "${url}"`;

    try {
      const { stdout, stderr } = await execAsync(curlCommand, { timeout: 60000 });
      console.log('[CustomUpdater] Curl download completed');

      // Verify file exists
      if (!fs.existsSync(destPath)) {
        throw new Error('Curl download appeared successful but file not found');
      }
    } catch (error) {
      console.error('[CustomUpdater] Curl download failed:', error);
      throw error;
    }
  }

  /**
   * Download a file using Electron's net module with exponential backoff
   */
  private async downloadFile(url: string, destPath: string, attempt: number = 1): Promise<void> {
    const maxAttempts = 5;
    const retryDelays = [1000, 2000, 4000, 8000, 16000]; // Exponential backoff

    // On Windows, try PowerShell FIRST for better certificate handling
    // This works better with mutual TLS, EAP-TLS, and MSDTC requirements
    if (process.platform === 'win32' && attempt === 1) {
      console.log('[CustomUpdater] Windows detected - trying PowerShell download with system certificates...');
      try {
        await this.downloadWithPowerShell(url, destPath);
        console.log('[CustomUpdater] PowerShell download successful!');
        return; // Success!
      } catch (error) {
        console.log('[CustomUpdater] PowerShell download failed:', error);
        console.log('[CustomUpdater] Falling back to net.request method...');
      }
    }

    // If Zscaler is detected and we've failed once, try PowerShell again
    if (zscalerConfig.isDetected() && attempt > 1 && process.platform === 'win32') {
      console.log('[CustomUpdater] Zscaler detected on retry, trying PowerShell download again...');
      try {
        await this.downloadWithPowerShell(url, destPath);
        return; // Success!
      } catch (error) {
        console.log('[CustomUpdater] PowerShell download failed on retry, continuing with net.request');
      }
    }

    for (let currentAttempt = attempt; currentAttempt <= maxAttempts; currentAttempt++) {
      try {
        // Reset proxy configuration on retry
        if (currentAttempt > 1) {
          console.log(`[CustomUpdater] Resetting proxy configuration for attempt ${currentAttempt}...`);
          await proxyConfig.resetProxyWithRetry();

          // Clean up any lingering connections
          this.cleanupActiveRequests();

          // Wait a bit for proxy to reconfigure
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Wait if we have too many concurrent connections
        while (this.activeRequests.size >= this.maxConcurrentConnections) {
          console.log('[CustomUpdater] Waiting for connection slot...');
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        await this.downloadFileWithNet(url, destPath, currentAttempt);
        return; // Success!
      } catch (error: any) {
        const errorCode = error.code || '';
        const errorMessage = error.message || '';

        console.log(`[CustomUpdater] Download attempt ${currentAttempt} failed:`, {
          code: errorCode,
          message: errorMessage.substring(0, 200)
        });

        // Check if error is specifically ERR_CONNECTION_RESET from net module
        if (errorMessage.includes('net::ERR_CONNECTION_RESET') ||
            errorMessage.includes('ERR_CONNECTION_RESET')) {
          console.log('[CustomUpdater] Detected ERR_CONNECTION_RESET from net module');
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
          console.log(`[CustomUpdater] Retrying in ${delay}ms...`);

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
                console.log('[CustomUpdater] Final attempt with PowerShell for Zscaler...');
                try {
                  await this.downloadWithPowerShell(url, destPath);
                  return; // Success!
                } catch (psError) {
                  throw new Error(
                    `Zscaler is blocking the download. ` +
                    `To fix this:\n` +
                    `1. Ask your IT department to bypass SSL inspection for github.com\n` +
                    `2. Export Zscaler certificate and set ZSCALER_CERT_PATH to its location\n` +
                    `3. Or download the update manually from GitHub releases`
                  );
                }
              }
            }
          }

          if (errorCode === 'ECONNRESET' || errorMessage.includes('ERR_CONNECTION_RESET')) {
            const zscalerHint = zscalerConfig.isDetected()
              ? '\nZscaler detected: This is likely due to SSL inspection. '
              : '';
            throw new Error(
              `Connection repeatedly reset by network after ${currentAttempt} attempts. ` +
              `This is typically caused by a corporate proxy or firewall. ${zscalerHint}` +
              `Please check proxy settings: HTTPS_PROXY, HTTP_PROXY environment variables.`
            );
          } else if (this.isCertificateError(error)) {
            const zscalerHint = zscalerConfig.isDetected()
              ? '\nZscaler SSL inspection detected. Export Zscaler certificate or request bypass. '
              : '';
            throw new Error(
              `Certificate verification failed after ${currentAttempt} attempts: ${errorMessage}. ` +
              `Your corporate network may be using custom certificates. ${zscalerHint}` +
              `Set NODE_EXTRA_CA_CERTS environment variable to your corporate CA certificate.`
            );
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
      console.log(`[CustomUpdater] Downloading with net.request (attempt ${attempt}): ${url}`);

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
        console.log('[CustomUpdater] Adding Zscaler bypass headers');
        const bypassHeaders = zscalerConfig.getBypassHeaders();
        for (const [key, value] of Object.entries(bypassHeaders)) {
          request.setHeader(key, value);
        }
      }

      // Handle timeout (30 seconds per request)
      const timeout = setTimeout(() => {
        if (!requestCompleted) {
          console.log('[CustomUpdater] Request timeout, aborting...');
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
            console.log(`[CustomUpdater] Following redirect to: ${redirectUrl}`);
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
            console.log(`[CustomUpdater] Download complete: ${downloadedBytes} bytes`);
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
        console.error(`[CustomUpdater] net.request error:`, {
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
      console.log(`[CustomUpdater] Certificate error detected: ${code}`);
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
      console.log(`[CustomUpdater] Certificate error message detected: ${message.substring(0, 100)}`);
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
      console.log('[CustomUpdater] Opening GitHub releases page in browser');
      await shell.openExternal(githubReleasesUrl);
      return;
    }

    const version = this.updateInfo.version;
    const downloadUrl = `https://github.com/ItMeDiaTech/Documentation_Hub/releases/download/v${version}/Documentation-Hub-Setup-${version}.exe`;

    console.log('[CustomUpdater] Opening direct download link in browser:', downloadUrl);
    this.sendToWindow('update-manual-download', {
      message: 'Opening download in your browser. Please download and install manually.',
      downloadUrl: downloadUrl
    });

    await shell.openExternal(downloadUrl);
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