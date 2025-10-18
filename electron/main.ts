import { app, BrowserWindow, ipcMain, shell, Menu, dialog, session, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import { join } from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { WordDocumentProcessor } from '../src/services/document/WordDocumentProcessor';
import { CustomUpdater } from './customUpdater';
import { proxyConfig } from './proxyConfig';
import { zscalerConfig } from './zscalerConfig';
import { MemoryConfig } from './memoryConfig';
import { logger, initializeLogging } from '../src/utils/logger';
import type {
  BatchProcessingOptions,
  BatchProcessingResult,
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult,
} from '../src/types/hyperlink';
import { BackupService } from './services/BackupService';
import type { BackupInfo, StorageInfo, BackupConfig } from './services/BackupService';

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;

// Create namespaced logger for main process
const log = logger.namespace('Main');

// ============================================================================
// Initialize Logging System (MUST be first)
// ============================================================================
initializeLogging();

// ============================================================================
// Application Startup and Version Information
// ============================================================================
log.info('========================================');
log.info(`Documentation Hub v${app.getVersion()} starting...`);
log.info(`Electron: v${process.versions.electron}`);
log.info(`Node: v${process.versions.node}`);
log.info(`Platform: ${process.platform} ${process.arch}`);
log.info('========================================');

// ============================================================================
// Memory Configuration (MUST be before app.ready)
// ============================================================================
log.info('Configuring memory and heap size...');
MemoryConfig.configureApp();

// ============================================================================
// Proxy, Zscaler, and TLS/Certificate Configuration
// ============================================================================

// Configure Zscaler detection and setup before anything else
log.info('Initializing Zscaler detection...');
zscalerConfig.logConfiguration();
zscalerConfig.configureApp();

// Log Zscaler status prominently
if (zscalerConfig.isDetected()) {
  log.warn('⚠️  ZSCALER DETECTED - Using enhanced certificate handling and fallback methods');
} else {
  log.info('✓ No Zscaler detected - Using standard network configuration');
}

// Configure proxy settings
log.info('Initializing proxy and TLS configuration...');
proxyConfig.logConfiguration();
proxyConfig.configureApp();

// ============================================================================
// Pre-flight Certificate Check for GitHub Connectivity
// Now optimized for background execution
// ============================================================================
async function performPreflightCertificateCheck(): Promise<void> {
  log.info('Performing pre-flight certificate check for GitHub...');

  // Early return if offline
  if (!app.isReady()) {
    log.warn('App not ready for certificate check');
    return;
  }

  try {
    // Test connection to GitHub API with reduced timeout
    const testUrl = 'https://api.github.com/';
    const request = net.request({
      method: 'GET',
      url: testUrl,
      session: session.defaultSession,
    });

    // Set shorter timeout for background check
    const timeout = setTimeout(() => {
      request.abort();
    }, 5000); // 5 second timeout (reduced from 10)

    // Promise to handle the response
    const testResult = await new Promise<boolean>((resolve) => {
      let responseReceived = false;

      request.on('response', (response: Electron.IncomingMessage) => {
        clearTimeout(timeout);
        responseReceived = true;
        const statusCode = response.statusCode;

        if (statusCode >= 200 && statusCode < 400) {
          log.info('✅ GitHub connection test PASSED');
          resolve(true);
        } else {
          log.warn(`⚠️ GitHub returned status ${statusCode}`);
          resolve(false);
        }
      });

      request.on('error', async (error: Error) => {
        clearTimeout(timeout);
        if (!responseReceived) {
          log.error('GitHub connection test FAILED:', error);

          // Check if it's a certificate error
          const errorMessage = error.message?.toLowerCase() || '';
          if (
            errorMessage.includes('certificate') ||
            errorMessage.includes('ssl') ||
            errorMessage.includes('tls') ||
            errorMessage.includes('unable to verify') ||
            errorMessage.includes('self signed')
          ) {
            log.info('Certificate error detected, attempting automatic fix...');

            // If Zscaler is detected, try to find and configure its certificate
            if (zscalerConfig.isDetected() && process.platform === 'win32') {
              try {
                const { windowsCertStore } = await import('./windowsCertStore');
                const certPath = await windowsCertStore.findZscalerCertificate();

                if (certPath) {
                  log.info('Found Zscaler certificate, configuring...');
                  process.env.NODE_EXTRA_CA_CERTS = certPath;
                  log.info('Set NODE_EXTRA_CA_CERTS to:', certPath);

                  // Show user dialog about certificate configuration
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('certificate-configured', {
                      message:
                        'Zscaler certificate automatically configured. Updates should work now.',
                      certPath: certPath,
                    });
                  }
                } else {
                  // Show dialog to user about manual certificate configuration
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    const choice = await dialog.showMessageBox(mainWindow, {
                      type: 'warning',
                      buttons: ['Open Certificate Guide', 'Continue Anyway'],
                      defaultId: 0,
                      title: 'Certificate Configuration Required',
                      message: 'Zscaler is blocking secure connections to GitHub.',
                      detail:
                        'To enable automatic updates:\n\n' +
                        '1. Export Zscaler certificate from your browser\n' +
                        '2. Save it as C:\\Zscaler\\ZscalerRootCertificate.pem\n' +
                        '3. Restart the application\n\n' +
                        'Or contact your IT department to bypass GitHub.com from SSL inspection.',
                    });

                    if (choice.response === 0) {
                      // Open guide in browser
                      shell.openExternal(
                        'https://github.com/ItMeDiaTech/Documentation_Hub/wiki/Zscaler-Certificate-Setup'
                      );
                    }
                  }
                }
              } catch (certError) {
                log.error('Failed to configure certificate:', certError);
              }
            }
          }
          resolve(false);
        }
      });

      request.end();
    });

    return;
  } catch (error) {
    log.error('Pre-flight check error:', error);
  }
}

// Configure session proxy and network debugging after app is ready
app.whenReady().then(async () => {
  log.info('Configuring session-level proxy and network monitoring...');
  try {
    await proxyConfig.configureSessionProxy();

    // Set clean User-Agent to avoid proxy rejection
    const cleanUA = proxyConfig.getCleanUserAgent();
    session.defaultSession.setUserAgent(cleanUA);

    // Set up comprehensive network request monitoring
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const requestInfo = {
        timestamp: new Date().toISOString(),
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
        referrer: details.referrer,
      };

      // Log network requests (skip data URLs and devtools)
      if (!details.url.startsWith('data:') && !details.url.includes('devtools://')) {
        log.debug('[Network Request]', requestInfo);

        // Send to renderer for debug console
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('debug-network-request', requestInfo);
        }
      }

      callback({});
    });

    // Monitor response headers for debugging
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.url.includes('github.com') || details.url.includes('githubusercontent.com')) {
        log.debug('[Network Response]', {
          url: details.url,
          statusCode: details.statusCode,
          statusLine: details.statusLine,
          headers: details.responseHeaders,
        });
      }
      callback({});
    });

    // Monitor network errors
    session.defaultSession.webRequest.onErrorOccurred((details) => {
      const errorInfo = {
        timestamp: new Date().toISOString(),
        url: details.url,
        error: details.error,
        method: details.method,
        resourceType: details.resourceType,
      };

      log.error('[Network Error]', errorInfo);

      // Send to renderer for debug console
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('debug-network-error', errorInfo);
      }
    });

    log.info('Session proxy and network monitoring configured successfully');
  } catch (error) {
    log.error('Failed to configure session:', error);
  }
});

// Enhanced login handler for proxy authentication
app.on('login', async (event, webContents, details, authInfo, callback) => {
  log.info('Login event received:', {
    isProxy: authInfo.isProxy,
    scheme: authInfo.scheme,
    host: authInfo.host,
    port: authInfo.port,
    realm: authInfo.realm,
  });

  if (authInfo.isProxy) {
    event.preventDefault();

    const proxyAuth = proxyConfig.getProxyAuth();
    if (proxyAuth) {
      log.info('Providing proxy authentication from configuration');
      callback(proxyAuth.username, proxyAuth.password);
    } else {
      // Try to get credentials from environment or prompt user
      const username = process.env.PROXY_USER || process.env.proxy_user;
      const password = process.env.PROXY_PASS || process.env.proxy_pass;

      if (username && password) {
        log.info('Providing proxy authentication from environment');
        callback(username, password);
      } else {
        log.warn('No proxy credentials available, cancelling authentication');
        callback('', ''); // Cancel authentication
      }
    }
  }
});

// Configure TLS settings for corporate proxies and firewalls
// This helps with certificate issues like "unable to get local issuer certificate"
if (!isDev) {
  log.info('Configuring global TLS settings for corporate environments...');

  // Note: We're being more selective with certificate errors now
  // Only ignore for known GitHub domains to maintain security

  // Log the configuration
  log.info('TLS Configuration:', {
    platform: process.platform,
    nodeVersion: process.version,
    electronVersion: process.versions.electron,
    isDev: isDev,
    proxyUrl: proxyConfig.getProxyUrl(),
  });
}

// Set environment variable for Node.js HTTPS module
// This affects all HTTPS requests made by the app
process.env['NODE_NO_WARNINGS'] = '1'; // Suppress TLS warnings in production

// ============================================================================
// CRITICAL SECURITY CONFIGURATION - DO NOT MODIFY
// ============================================================================
/**
 * These Electron security settings are MANDATORY and must never be changed.
 *
 * WHY THESE SETTINGS MATTER:
 *
 * 1. nodeIntegration: false (REQUIRED)
 *    - Prevents renderer process from accessing Node.js APIs
 *    - Critical security protection against XSS attacks
 *    - If enabled: malicious websites/content can access your filesystem, spawn processes, etc.
 *
 * 2. contextIsolation: true (REQUIRED)
 *    - Isolates preload script context from web page context
 *    - Required for React to work properly (lazy loading, Context API, Router)
 *    - Enables secure IPC communication via contextBridge
 *    - If disabled: Causes BLACK SCREEN in production builds
 *
 * WHAT BREAKS WHEN CHANGED:
 * - contextIsolation: false → Black screen, React won't load
 * - nodeIntegration: true → Security vulnerability + preload API breaks
 *
 * HISTORICAL INCIDENTS:
 * - 2025-10-17: Commit 159f47b - Restored after accidental change caused black screen
 * - 2025-10-16: Commit 290ee59 - Fixed TypeScript errors causing black screen
 * - 2024-12-xx: Commit 7575ba6 - Fixed production build black screen
 *
 * This configuration is protected by:
 * - TypeScript const assertion (compile-time)
 * - Runtime validation in development mode
 * - Git pre-commit hooks
 * - CI/CD validation checks
 *
 * If you need to expose new APIs to the renderer:
 * → Add them to electron/preload.ts via contextBridge.exposeInMainWorld()
 * → NEVER enable nodeIntegration or disable contextIsolation
 *
 * @see https://www.electronjs.org/docs/latest/tutorial/security
 * @see https://www.electronjs.org/docs/latest/tutorial/context-isolation
 */
const REQUIRED_SECURITY_SETTINGS = {
  preload: join(__dirname, 'preload.js'),
  nodeIntegration: false, // MUST be false for security
  contextIsolation: true, // MUST be true for React to work
} as const;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    webPreferences: REQUIRED_SECURITY_SETTINGS,
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

  // ============================================================================
  // Runtime Security Validation (Development Only)
  // ============================================================================
  if (isDev) {
    // Validate security settings at runtime to catch accidental changes
    // Use getPreloadScripts() - getPreloads() is deprecated as of Electron 38.x
    const preloadScripts = mainWindow.webContents.session.getPreloadScripts();

    // Getting webPreferences - this method doesn't exist on webContents
    // We need to check the actual settings we passed during BrowserWindow creation
    // The validation approach needs to be different

    // Since we can't get webPreferences directly in newer Electron,
    // we validate by checking if the settings we defined are still intact
    const expectedSettings = REQUIRED_SECURITY_SETTINGS;

    // We can verify our settings are applied by testing actual behavior
    // For example, trying to access Node APIs from renderer would fail with proper settings

    // For now, we'll validate our constant hasn't been modified
    // This is a compile-time check that TypeScript enforces
    if (expectedSettings.nodeIntegration !== false) {
      const errorMsg = `
╔════════════════════════════════════════════════════════════════════════════╗
║                     🚨 SECURITY VIOLATION DETECTED 🚨                      ║
╠════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  nodeIntegration is enabled! This is a CRITICAL security vulnerability.   ║
║                                                                            ║
║  Current value: ${expectedSettings.nodeIntegration}                                              ║
║  Required value: false                                                     ║
║                                                                            ║
║  This setting MUST be 'false' to:                                         ║
║  - Prevent XSS attacks from accessing Node.js APIs                        ║
║  - Protect filesystem and system resources                                ║
║  - Maintain secure IPC communication                                      ║
║                                                                            ║
║  Fix: Set nodeIntegration: false in REQUIRED_SECURITY_SETTINGS            ║
║  Location: electron/main.ts line 352-356                                  ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
      `;
      log.error(errorMsg);
      throw new Error('SECURITY VIOLATION: nodeIntegration must be false');
    }

    // Validate contextIsolation
    if (expectedSettings.contextIsolation !== true) {
      const errorMsg = `
╔════════════════════════════════════════════════════════════════════════════╗
║                     🚨 CONFIGURATION ERROR DETECTED 🚨                     ║
╠════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  contextIsolation is disabled! This will cause a BLACK SCREEN.            ║
║                                                                            ║
║  Current value: ${expectedSettings.contextIsolation}                                             ║
║  Required value: true                                                      ║
║                                                                            ║
║  This setting MUST be 'true' for:                                         ║
║  - React to render properly (lazy loading, Context API)                   ║
║  - Router navigation to work                                              ║
║  - Secure preload script execution                                        ║
║  - Dynamic imports to load                                                ║
║                                                                            ║
║  Fix: Set contextIsolation: true in REQUIRED_SECURITY_SETTINGS            ║
║  Location: electron/main.ts line 352-356                                  ║
║                                                                            ║
║  Historical incidents: 159f47b, 290ee59, 7575ba6                          ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
      `;
      log.error(errorMsg);
      throw new Error('CONFIGURATION ERROR: contextIsolation must be true (causes black screen)');
    }

    log.info('✅ Security validation passed - All settings correct');
    log.info('   - nodeIntegration: false ✓');
    log.info('   - contextIsolation: true ✓');
  }
}

// Enhanced network debugging - log all network events
if (!isDev) {
  app.commandLine.appendSwitch('enable-logging', 'stderr');
  app.commandLine.appendSwitch('v', '1');
  app.commandLine.appendSwitch('vmodule', 'network_delegate=1');
}

// Handle certificate errors globally with comprehensive logging
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // Enhanced certificate error logging for debugging
  const certError = {
    timestamp: new Date().toISOString(),
    url,
    error,
    certificate: {
      issuerName: certificate.issuerName,
      subjectName: certificate.subjectName,
      serialNumber: certificate.serialNumber,
      validStart: certificate.validStart,
      validExpiry: certificate.validExpiry,
      fingerprint: certificate.fingerprint,
    },
    network: {
      proxy: proxyConfig.getProxyUrl(),
      zscaler: zscalerConfig.isDetected(),
      mutualTLS: 'LIKELY', // Based on user's environment
    },
  };

  log.warn('[Certificate Error - DETAILED]', JSON.stringify(certError, null, 2));

  // Send to renderer for debug console if available
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('debug-cert-error', certError);
  }

  // Prevent the default behavior (which is to reject the certificate)
  event.preventDefault();

  // Check if this is a Zscaler-related error
  if (zscalerConfig.isDetected()) {
    log.info(
      '[Certificate Error] Zscaler detected - checking if this is a Zscaler certificate issue'
    );

    // Check if the certificate issuer contains Zscaler
    if (
      certificate.issuerName?.includes('Zscaler') ||
      certificate.subjectName?.includes('Zscaler') ||
      zscalerConfig.isZscalerError({ message: error })
    ) {
      log.info('[Certificate Error] Detected Zscaler certificate - trusting it');
      callback(true); // Trust Zscaler certificates
      return;
    }
  }

  // Check if this is for GitHub or our update server
  const trustedHosts = [
    'github.com',
    'githubusercontent.com',
    'github.io',
    'github-releases.githubusercontent.com',
    'objects.githubusercontent.com',
  ];
  const urlHost = new URL(url).hostname.toLowerCase();

  if (trustedHosts.some((host) => urlHost.includes(host))) {
    log.info(`[Certificate Error] Trusting certificate for known host: ${urlHost}`);
    if (zscalerConfig.isDetected()) {
      log.info('[Certificate Error] Note: Zscaler is performing SSL inspection on this connection');
    }
    callback(true); // Trust the certificate
  } else {
    log.warn(`[Certificate Error] Rejecting certificate for unknown host: ${urlHost}`);
    callback(false); // Don't trust unknown certificates
  }
});

app.whenReady().then(async () => {
  // Create window immediately for better perceived performance
  await createWindow();

  // Perform pre-flight certificate check in background (non-blocking)
  // This allows the app to start immediately while checking network in parallel
  setImmediate(async () => {
    log.info('Starting background certificate check...');

    // Small delay to ensure window is fully rendered
    await new Promise(resolve => setTimeout(resolve, 500));

    // Run check without blocking
    performPreflightCertificateCheck().then(() => {
      log.info('Background certificate check completed');

      // Send status to renderer if window is available
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('certificate-check-complete', {
          success: true,
          timestamp: new Date().toISOString()
        });
      }
    }).catch((error) => {
      log.error('Background certificate check failed:', error);

      // Send error status to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('certificate-check-complete', {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });
  });
});

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

// Open comparison window for document processing changes
ipcMain.handle('open-comparison-window', async (event, data) => {
  const { sessionId, documentId, comparisonData } = data;

  // Create new window for comparison
  const comparisonWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Document Processing Comparison',
    webPreferences: REQUIRED_SECURITY_SETTINGS,
    parent: mainWindow || undefined,
    modal: false,
    show: false,
    backgroundColor: '#ffffff',
  });

  // Generate HTML content from comparison data
  // NOTE: Dynamic import here is intentional for lazy-loading (used only when opening comparison windows)
  // Rollup warning about "dynamically imported by main.ts but statically imported by WordDocumentProcessor.ts"
  // is expected and acceptable - see docs/architecture/bundling-strategy.md
  const { documentProcessingComparison } = await import('../src/services/document/DocumentProcessingComparison');
  const htmlContent = documentProcessingComparison.generateHTMLReport(comparisonData);

  // Load the HTML directly
  comparisonWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

  // Show when ready
  comparisonWindow.once('ready-to-show', () => {
    comparisonWindow.show();
  });

  // Cleanup on close
  comparisonWindow.on('closed', () => {
    // Window cleanup handled automatically
  });

  return { success: true };
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
          duration: 0,
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
        const processedResults = await this.processor.batchProcess(validPaths, request.options);

        // Aggregate results
        for (const { file: filePath, result } of processedResults.results) {
          results.set(filePath, result);
          if (result.success) {
            totalHyperlinksProcessed += result.processedHyperlinks;
            totalHyperlinksModified += result.modifiedHyperlinks;
          } else {
            errors.push({
              file: filePath,
              error: result.errorMessages.join(', '),
            });
          }
        }

        const summary = {
          totalFiles: request.filePaths.length,
          successfulFiles: Array.from(results.values()).filter((r) => r.success).length,
          failedFiles: errors.length,
          totalHyperlinksProcessed,
          totalHyperlinksModified,
          processingTimeMs: performance.now() - startTime,
          errors,
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
            errors: [
              {
                file: 'batch',
                error: error instanceof Error ? error.message : 'Batch processing failed',
              },
            ],
          },
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
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const responseTime = performance.now() - startTime;

        return {
          isValid: response.ok || response.status === 405, // 405 if OPTIONS not supported
          message: response.ok
            ? 'API endpoint is reachable'
            : `API returned status ${response.status}`,
          responseTime,
        };
      } catch (error) {
        return {
          isValid: false,
          message: error instanceof Error ? error.message : 'Validation failed',
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
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile', 'multiSelections'],
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
      }),
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
    log.error('Error showing file in folder:', error);
    throw error;
  }
});

// Open document in default application (Microsoft Word for .docx)
ipcMain.handle('open-document', async (...[, path]: [Electron.IpcMainInvokeEvent, string]) => {
  if (!path) {
    throw new Error('No path provided');
  }

  try {
    // Security: Check if file exists
    if (!fs.existsSync(path)) {
      throw new Error(`File not found: ${path}`);
    }

    // Security: Validate file extension (only allow .docx files)
    const fileExtension = path.toLowerCase().split('.').pop();
    if (fileExtension !== 'docx') {
      throw new Error(`Unsupported file type: .${fileExtension}. Only .docx files can be opened.`);
    }

    // Open the document in its default application
    const errorMessage = await shell.openPath(path);

    // shell.openPath returns an empty string on success, or an error message on failure
    if (errorMessage) {
      throw new Error(`Failed to open document: ${errorMessage}`);
    }

    log.info(`✅ Successfully opened document in default application: ${path}`);
  } catch (error) {
    log.error('Error opening document:', error);
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
    log.error('Error getting file stats:', error);
    throw error;
  }
});

// Restore document from backup
ipcMain.handle(
  'restore-from-backup',
  async (
    ...[, request]: [Electron.IpcMainInvokeEvent, { backupPath: string; targetPath: string }]
  ) => {
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

      log.info(
        `[Restore] Successfully restored ${request.targetPath} from backup ${request.backupPath}`
      );
    } catch (error) {
      log.error('Error restoring from backup:', error);
      throw error;
    }
  }
);

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
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (!result.canceled && result.filePath) {
      return {
        success: true,
        filePath: result.filePath,
      };
    }

    return { success: false, canceled: true };
  } catch (error) {
    log.error('Error showing export dialog:', error);
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
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const fileContent = await fsPromises.readFile(filePath, 'utf-8');

      return {
        success: true,
        data: JSON.parse(fileContent),
        filePath,
      };
    }

    return { success: false, canceled: true };
  } catch (error) {
    log.error('Error importing settings:', error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle(
  'save-export-data',
  async (...[, request]: [Electron.IpcMainInvokeEvent, { filePath: string; data: any }]) => {
    try {
      await fsPromises.writeFile(request.filePath, JSON.stringify(request.data, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      log.error('Error saving export data:', error);
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
);

// ==============================================================================
// Backup Service IPC Handlers
// ==============================================================================

// Initialize backup service (singleton instance)
const backupService = new BackupService();

// Create backup
ipcMain.handle('backup:create', async (...[, documentPath]: [Electron.IpcMainInvokeEvent, string]) => {
  try {
    if (!documentPath || typeof documentPath !== 'string') {
      throw new Error('Invalid document path');
    }

    const backupPath = await backupService.createBackup(documentPath);
    return { success: true, backupPath };
  } catch (error) {
    log.error('[Backup] Create backup failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to create backup';
    return { success: false, error: message };
  }
});

// Restore from backup
ipcMain.handle(
  'backup:restore',
  async (
    ...[, request]: [Electron.IpcMainInvokeEvent, { backupPath: string; targetPath: string }]
  ) => {
    try {
      if (!request.backupPath || !request.targetPath) {
        throw new Error('Both backupPath and targetPath are required');
      }

      await backupService.restoreBackup(request.backupPath, request.targetPath);
      return { success: true };
    } catch (error) {
      log.error('[Backup] Restore backup failed:', error);
      const message = error instanceof Error ? error.message : 'Failed to restore backup';
      return { success: false, error: message };
    }
  }
);

// List backups for document
ipcMain.handle('backup:list', async (...[, documentPath]: [Electron.IpcMainInvokeEvent, string]) => {
  try {
    if (!documentPath || typeof documentPath !== 'string') {
      throw new Error('Invalid document path');
    }

    const backups = await backupService.listBackups(documentPath);
    return { success: true, backups };
  } catch (error) {
    log.error('[Backup] List backups failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to list backups';
    return { success: false, error: message, backups: [] };
  }
});

// Delete specific backup
ipcMain.handle('backup:delete', async (...[, backupPath]: [Electron.IpcMainInvokeEvent, string]) => {
  try {
    if (!backupPath || typeof backupPath !== 'string') {
      throw new Error('Invalid backup path');
    }

    await backupService.deleteBackup(backupPath);
    return { success: true };
  } catch (error) {
    log.error('[Backup] Delete backup failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete backup';
    return { success: false, error: message };
  }
});

// Cleanup old backups for document
ipcMain.handle('backup:cleanup', async (...[, documentPath]: [Electron.IpcMainInvokeEvent, string]) => {
  try {
    if (!documentPath || typeof documentPath !== 'string') {
      throw new Error('Invalid document path');
    }

    const deletedCount = await backupService.cleanupOldBackups(documentPath);
    return { success: true, deletedCount };
  } catch (error) {
    log.error('[Backup] Cleanup backups failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to cleanup backups';
    return { success: false, error: message, deletedCount: 0 };
  }
});

// Cleanup all old backups
ipcMain.handle('backup:cleanup-all', async () => {
  try {
    const deletedCount = await backupService.cleanupAllOldBackups();
    return { success: true, deletedCount };
  } catch (error) {
    log.error('[Backup] Cleanup all backups failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to cleanup all backups';
    return { success: false, error: message, deletedCount: 0 };
  }
});

// Verify backup integrity
ipcMain.handle('backup:verify', async (...[, backupPath]: [Electron.IpcMainInvokeEvent, string]) => {
  try {
    if (!backupPath || typeof backupPath !== 'string') {
      throw new Error('Invalid backup path');
    }

    const isValid = await backupService.verifyBackup(backupPath);
    return { success: true, isValid };
  } catch (error) {
    log.error('[Backup] Verify backup failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to verify backup';
    return { success: false, error: message, isValid: false };
  }
});

// Get backup storage info
ipcMain.handle('backup:storage-info', async () => {
  try {
    const storageInfo = await backupService.getBackupStorageInfo();
    return { success: true, storageInfo };
  } catch (error) {
    log.error('[Backup] Get storage info failed:', error);
    const message = error instanceof Error ? error.message : 'Failed to get storage info';
    return { success: false, error: message };
  }
});

// Set backup configuration
ipcMain.handle(
  'backup:set-config',
  async (...[, config]: [Electron.IpcMainInvokeEvent, Partial<BackupConfig>]) => {
    try {
      if (!config || typeof config !== 'object') {
        throw new Error('Invalid backup configuration');
      }

      backupService.setConfig(config);
      return { success: true };
    } catch (error) {
      log.error('[Backup] Set config failed:', error);
      const message = error instanceof Error ? error.message : 'Failed to set backup configuration';
      return { success: false, error: message };
    }
  }
);

// ==============================================================================
// Certificate Management IPC Handlers
// ==============================================================================

ipcMain.handle('check-zscaler-status', async () => {
  return {
    detected: zscalerConfig.isDetected(),
    certificatePath: zscalerConfig.getCertPath(),
  };
});

ipcMain.handle('get-certificate-path', async () => {
  return process.env.NODE_EXTRA_CA_CERTS || null;
});

ipcMain.handle('get-installed-certificates', async () => {
  const certificates = [];

  // Check for Zscaler certificate
  if (zscalerConfig.getCertPath()) {
    certificates.push({
      path: zscalerConfig.getCertPath(),
      name: 'Zscaler Root Certificate',
      isActive: process.env.NODE_EXTRA_CA_CERTS === zscalerConfig.getCertPath(),
      isZscaler: true,
    });
  }

  // Check for other configured certificates
  if (
    process.env.NODE_EXTRA_CA_CERTS &&
    process.env.NODE_EXTRA_CA_CERTS !== zscalerConfig.getCertPath()
  ) {
    certificates.push({
      path: process.env.NODE_EXTRA_CA_CERTS,
      name: path.basename(process.env.NODE_EXTRA_CA_CERTS),
      isActive: true,
    });
  }

  return certificates;
});

ipcMain.handle('import-certificate', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import Certificate',
      filters: [
        { name: 'Certificate Files', extensions: ['pem', 'crt', 'cer', 'ca'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const certPath = result.filePaths[0];

      // Validate it's a certificate file
      const content = await fsPromises.readFile(certPath, 'utf-8');
      if (content.includes('BEGIN CERTIFICATE')) {
        // Set as the NODE_EXTRA_CA_CERTS
        process.env.NODE_EXTRA_CA_CERTS = certPath;

        return {
          success: true,
          name: path.basename(certPath),
          path: certPath,
        };
      } else {
        return {
          success: false,
          error: 'Invalid certificate file format',
        };
      }
    }

    return { success: false, error: 'No file selected' };
  } catch (error) {
    log.error('Error importing certificate:', error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle('auto-detect-certificates', async () => {
  if (process.platform !== 'win32') {
    return { success: false, error: 'Auto-detect only available on Windows' };
  }

  try {
    const { windowsCertStore } = await import('./windowsCertStore');
    const certPath = await windowsCertStore.findZscalerCertificate();

    if (certPath) {
      process.env.NODE_EXTRA_CA_CERTS = certPath;
      return { success: true, count: 1, path: certPath };
    } else {
      // Try to create a bundle of all corporate certificates
      const bundlePath = await windowsCertStore.createCombinedBundle();
      if (bundlePath) {
        process.env.NODE_EXTRA_CA_CERTS = bundlePath;
        return { success: true, count: 'multiple', path: bundlePath };
      }
    }

    return { success: false, error: 'No certificates found' };
  } catch (error) {
    log.error('Error auto-detecting certificates:', error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle(
  'remove-certificate',
  async (...[, certPath]: [Electron.IpcMainInvokeEvent, string]) => {
    try {
      if (process.env.NODE_EXTRA_CA_CERTS === certPath) {
        delete process.env.NODE_EXTRA_CA_CERTS;
      }
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
);

ipcMain.handle('test-github-connection', async () => {
  try {
    const testUrl = 'https://api.github.com/';
    const request = net.request({
      method: 'GET',
      url: testUrl,
      session: session.defaultSession,
    });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        request.abort();
        resolve({ success: false, error: 'Connection timeout' });
      }, 10000);

      request.on('response', (response: Electron.IncomingMessage) => {
        clearTimeout(timeout);
        if (response.statusCode >= 200 && response.statusCode < 400) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `HTTP ${response.statusCode}` });
        }
      });

      request.on('error', (error) => {
        clearTimeout(timeout);
        resolve({ success: false, error: error.message });
      });

      request.end();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

// ==============================================================================
// Auto-Updater Configuration with ZIP Fallback Support
// ==============================================================================

class AutoUpdaterHandler {
  private customUpdater: CustomUpdater;
  private updateCheckInProgress = false;
  private downloadInProgress = false;

  constructor() {
    this.customUpdater = new CustomUpdater(mainWindow);
    this.setupIPCHandlers();
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

      try {
        this.updateCheckInProgress = true;
        const result = await this.customUpdater.checkForUpdates();
        this.updateCheckInProgress = false;
        return result;
      } catch (error) {
        this.updateCheckInProgress = false;
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to check for updates',
        };
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

      try {
        this.downloadInProgress = true;
        const result = await this.customUpdater.downloadUpdate();
        this.downloadInProgress = false;
        return result;
      } catch (error) {
        this.downloadInProgress = false;
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to download update',
        };
      }
    });

    // Install update and restart
    ipcMain.handle('install-update', () => {
      this.customUpdater.quitAndInstall();
    });

    // Get current version
    ipcMain.handle('get-app-version', () => {
      return app.getVersion();
    });

    // Reset fallback mode (for testing)
    ipcMain.handle('reset-update-fallback', () => {
      this.customUpdater.resetFallbackMode();
      return { success: true };
    });

    // Open download in browser (manual fallback)
    ipcMain.handle('open-update-in-browser', async () => {
      try {
        await this.customUpdater.openDownloadInBrowser();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to open download page',
        };
      }
    });
  }

  // Check for updates on app start (if enabled in settings)
  public async checkOnStartup(): Promise<void> {
    await this.customUpdater.checkOnStartup();
  }
}

// Initialize auto-updater handler (will be created after window is ready)
let updaterHandler: AutoUpdaterHandler;

// Check for updates on startup (will be controlled by user settings in production)
app.whenReady().then(() => {
  // Initialize updater after window is created
  setTimeout(() => {
    updaterHandler = new AutoUpdaterHandler();
    // Check for updates 3 seconds after app is ready
    // This can be controlled by user settings later
    if (!isDev) {
      updaterHandler.checkOnStartup();
    }
  }, 1000);
});
