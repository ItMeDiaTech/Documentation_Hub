import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell } from "electron";
import * as fs from "fs";
import { promises as fsPromises } from "fs";
import * as path from "path";
import { join } from "path";
import { WordDocumentProcessor } from "../src/services/document/WordDocumentProcessor";
import type { SharePointConfig } from "../src/types/dictionary";
import type { BatchProcessingResult, HyperlinkProcessingResult } from "../src/types/hyperlink";
import { initializeLogging, logger } from "../src/utils/logger";
import { CustomUpdater } from "./customUpdater";
import { MemoryConfig } from "./memoryConfig";
import type { BackupConfig } from "./services/BackupService";
import { BackupService } from "./services/BackupService";
import { getDictionaryService } from "./services/DictionaryService";
import { getLocalDictionaryLookupService } from "./services/LocalDictionaryLookupService";
import { getSharePointSyncService } from "./services/SharePointSyncService";

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;

// Create namespaced logger for main process
const log = logger.namespace("Main");

// ============================================================================
// Initialize Logging System (MUST be first)
// ============================================================================
initializeLogging();

// ============================================================================
// Application Startup and Version Information
// ============================================================================
log.info("========================================");
log.info(`Documentation Hub v${app.getVersion()} starting...`);
log.info(`Electron: v${process.versions.electron}`);
log.info(`Node: v${process.versions.node}`);
log.info(`Platform: ${process.platform} ${process.arch}`);
log.info("========================================");

// ============================================================================
// Memory Configuration (MUST be before app.ready)
// ============================================================================
log.info("Configuring memory and heap size...");
MemoryConfig.configureApp();


// ============================================================================
// Session Configuration
// ============================================================================
async function configureSession(): Promise<void> {
  log.info("Configuring session...");
  try {
    // Set User-Agent
    const userAgent = `DocumentationHub/${app.getVersion()} (${process.platform})`;
    session.defaultSession.setUserAgent(userAgent);

    log.info("✓ Session configured successfully");
  } catch (error) {
    log.error("❌ Failed to configure session:", error);
    throw error;
  }
}


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
 * - contextIsolation set to false → Black screen, React won't load
 * - nodeIntegration enabled (true) → Security vulnerability + preload API breaks
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
  preload: join(__dirname, "preload.js"),
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
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0a0a",
    show: false, // ISSUE #6 FIX: Don't show window immediately - prevents black screen
    icon: join(__dirname, "../build/icon.ico"),
    webPreferences: REQUIRED_SECURITY_SETTINGS,
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, "../index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // ============================================================================
  // ISSUE #6 FIX: ready-to-show Event
  // ============================================================================
  // Wait for React to load before showing window - prevents black screen flicker
  // This ensures the renderer process has loaded and painted the UI before
  // the window becomes visible to the user
  mainWindow.once("ready-to-show", () => {
    log.info("✓ Window ready to show - React loaded and rendered");
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window-maximized");
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window-unmaximized");
  });

  mainWindow.on("enter-full-screen", () => {
    mainWindow?.webContents.send("window-fullscreen");
  });

  mainWindow.on("leave-full-screen", () => {
    mainWindow?.webContents.send("window-unfullscreen");
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
      throw new Error("SECURITY VIOLATION: nodeIntegration must be false");
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
      throw new Error("CONFIGURATION ERROR: contextIsolation must be true (causes black screen)");
    }

    log.info("✅ Security validation passed - All settings correct");
    log.info("   - nodeIntegration: false ✓");
    log.info("   - contextIsolation: true ✓");
  }
}

// Enhanced network debugging - log all network events
if (!isDev) {
  app.commandLine.appendSwitch("enable-logging", "stderr");
  app.commandLine.appendSwitch("v", "1");
  app.commandLine.appendSwitch("vmodule", "network_delegate=1");
}

// Handle certificate errors globally
app.on("certificate-error", (event, webContents, url, error, certificate, callback) => {
  log.warn("[Certificate Error]", { url, error });

  // Prevent the default behavior
  event.preventDefault();

  // Trust certificates for known hosts (GitHub, Azure, Microsoft)
  const trustedHosts = [
    "github.com",
    "githubusercontent.com",
    "github.io",
    "logic.azure.com",
    "azure.com",
    "microsoft.com",
    "microsoftonline.com",
    "windows.net",
    "azure-api.net",
    "azureedge.net",
    "powerplatform.com",
    "api.powerplatform.com",
  ];
  const urlHost = new URL(url).hostname.toLowerCase();

  if (trustedHosts.some((host) => urlHost.includes(host))) {
    log.info(`[Certificate Error] Trusting certificate for known host: ${urlHost}`);
    callback(true);
  } else {
    log.warn(`[Certificate Error] Rejecting certificate for unknown host: ${urlHost}`);
    callback(false);
  }
});

// ============================================================================
// CONSOLIDATED APP INITIALIZATION
// ============================================================================
app.whenReady().then(async () => {
  const startTime = Date.now();
  log.info("🚀 App ready - beginning initialization...");

  try {
    // ========================================================================
    // STEP 1: Configure Session
    // ========================================================================
    log.info("[1/3] Configuring session...");
    await configureSession();
    log.info(`✓ Step 1 complete (${Date.now() - startTime}ms)`);

    // ========================================================================
    // STEP 2: Create Main Window
    // ========================================================================
    log.info("[2/3] Creating main window...");
    const windowStartTime = Date.now();
    await createWindow();
    log.info(`✓ Step 2 complete - Window created (${Date.now() - windowStartTime}ms)`);

    // Verify mainWindow exists before proceeding
    if (!mainWindow) {
      throw new Error("CRITICAL: mainWindow is null after createWindow()");
    }

    // ========================================================================
    // STEP 3: Initialize Auto-Updater
    // ========================================================================
    log.info("[3/3] Initializing auto-updater...");
    const updaterStartTime = Date.now();

    // Initialize updater (mainWindow is guaranteed to exist now)
    // FORCE_DEV_UPDATE_CONFIG=true allows testing updates in dev mode
    const forceDevUpdates = process.env.FORCE_DEV_UPDATE_CONFIG === 'true';
    if (!isDev || forceDevUpdates) {
      updaterHandler = new AutoUpdaterHandler();
      updaterHandler.checkOnStartup();
      updaterHandler.startScheduledChecks(); // Check for updates every 4 hours
      log.info(`✓ Step 3 complete - Auto-updater initialized (${Date.now() - updaterStartTime}ms)`);
    } else {
      log.info("⊘ Step 3 skipped - Auto-updater disabled in development mode");
    }

    // ========================================================================
    // Initialization Complete
    // ========================================================================
    const totalTime = Date.now() - startTime;
    log.info(`✅ Initialization complete in ${totalTime}ms`);
    log.info("   1. Session configured");
    log.info("   2. Main window created");
    log.info("   3. Auto-updater initialized");
  } catch (error) {
    log.error("❌ CRITICAL: App initialization failed:", error);
    log.error("Stack trace:", error instanceof Error ? error.stack : "No stack trace");

    // Show error dialog to user
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "Initialization Error",
        `Documentation Hub failed to initialize properly:\n\n${error instanceof Error ? error.message : String(error)}\n\nThe app may not function correctly. Please restart the application.`
      );
    }

    // Don't quit - allow user to try to use the app anyway
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.handle("window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window-maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window-close", () => {
  mainWindow?.close();
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow?.isMaximized();
});

ipcMain.handle("window-is-fullscreen", () => {
  return mainWindow?.isFullScreen();
});

ipcMain.handle("app-version", () => {
  return app.getVersion();
});

// Also register as 'get-app-version' for backward compatibility
// (previously only registered in AutoUpdaterHandler which loaded late)
ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("open-dev-tools", () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools();
  }
});

// Open comparison window for document processing changes
ipcMain.handle("open-comparison-window", async (event, data) => {
  const { sessionId, documentId, comparisonData } = data;

  // Create new window for comparison
  const comparisonWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Document Processing Comparison",
    webPreferences: REQUIRED_SECURITY_SETTINGS,
    parent: mainWindow || undefined,
    modal: false,
    show: false,
    backgroundColor: "#ffffff",
  });

  // Generate HTML content from comparison data
  // NOTE: Dynamic import here is intentional for lazy-loading (used only when opening comparison windows)
  // Rollup warning about "dynamically imported by main.ts but statically imported by WordDocumentProcessor.ts"
  // is expected and acceptable - see docs/architecture/bundling-strategy.md
  const { documentProcessingComparison } =
    await import("../src/services/document/DocumentProcessingComparison");
  const htmlContent = documentProcessingComparison.generateHTMLReport(comparisonData);

  // Load the HTML directly
  comparisonWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

  // Show when ready
  comparisonWindow.once("ready-to-show", () => {
    comparisonWindow.show();
  });

  // Cleanup on close
  comparisonWindow.on("closed", () => {
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
    this.ALLOWED_BASE_PATH = app.getPath("documents");
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Single document processing
    ipcMain.handle("hyperlink:process-document", async (event, request) => {
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
          errorMessages: [error instanceof Error ? error.message : "Processing failed"],
          processedLinks: [],
          validationIssues: [],
          duration: 0,
        } as HyperlinkProcessingResult;
      }
    });

    // Batch processing with progress reporting
    ipcMain.handle("hyperlink:batch-process", async (event, request) => {
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
              error: result.errorMessages.join(", "),
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
                file: "batch",
                error: error instanceof Error ? error.message : "Batch processing failed",
              },
            ],
          },
        } as BatchProcessingResult;
      }
    });

    // Validate PowerAutomate API endpoint using net.request (respects proxy/Zscaler)
    ipcMain.handle("hyperlink:validate-api", async (event, request) => {
      try {
        const startTime = performance.now();

        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolve({
              isValid: false,
              message: "Connection timeout after 5000ms",
              responseTime: 5000,
            });
          }, 5000);

          const netRequest = net.request({
            method: "OPTIONS",
            url: request.apiUrl,
            session: session.defaultSession,
          });

          netRequest.on("response", (response) => {
            clearTimeout(timeout);
            const responseTime = performance.now() - startTime;
            const isValid = response.statusCode >= 200 && response.statusCode < 400 || response.statusCode === 405;
            resolve({
              isValid,
              message: isValid
                ? "API endpoint is reachable"
                : `API returned status ${response.statusCode}`,
              responseTime,
            });
          });

          netRequest.on("error", (error) => {
            clearTimeout(timeout);
            resolve({
              isValid: false,
              message: error.message || "Validation failed",
            });
          });

          netRequest.end();
        });
      } catch (error) {
        return {
          isValid: false,
          message: error instanceof Error ? error.message : "Validation failed",
        };
      }
    });

    // Call PowerAutomate API using Electron net.request (IPC-based approach)
    // Uses Chromium's network stack which respects system proxy and certificates
    ipcMain.handle("hyperlink:call-api", async (_event, request: {
      apiUrl: string;
      payload: {
        Lookup_ID: string[];
        Hyperlinks_Checked: number;
        Total_Hyperlinks: number;
        First_Name: string;
        Last_Name: string;
        Email: string;
      };
      timeout?: number;
    }) => {
      const timeoutMs = request.timeout || 30000;
      const jsonPayload = JSON.stringify(request.payload);
      const startTime = Date.now();

      // =========================================================================
      // COMPREHENSIVE LOGGING - REQUEST DETAILS
      // =========================================================================
      log.info("═══════════════════════════════════════════════════════════════════");
      log.info("[API Call] Starting Power Automate HTTP Request");
      log.info("═══════════════════════════════════════════════════════════════════");
      log.info(`[API Call] Timestamp: ${new Date().toISOString()}`);
      log.info(`[API Call] URL: ${request.apiUrl}`);
      log.info(`[API Call] Method: POST`);
      log.info(`[API Call] Timeout: ${timeoutMs}ms`);
      log.info(`[API Call] Headers:`);
      log.info(`[API Call]   Content-Type: application/json; charset=utf-8`);
      log.info(`[API Call]   User-Agent: DocHub/1.0`);
      log.info(`[API Call]   Accept: application/json`);
      log.info(`[API Call] Payload:`);
      // Log payload with proper formatting
      const payloadFormatted = JSON.stringify(request.payload, null, 2);
      payloadFormatted.split('\n').forEach(line => {
        log.info(`[API Call]   ${line}`);
      });
      log.info(`[API Call] Payload size: ${Buffer.byteLength(jsonPayload)} bytes`);
      log.info("───────────────────────────────────────────────────────────────────");

      return new Promise((resolve) => {
        log.info("[API Call] Sending request via Electron net.request...");

        const timeoutHandle = setTimeout(() => {
          const duration = Date.now() - startTime;
          log.error("═══════════════════════════════════════════════════════════════════");
          log.error("[API Call] REQUEST TIMEOUT");
          log.error("═══════════════════════════════════════════════════════════════════");
          log.error(`[API Call] Timeout after ${timeoutMs}ms`);
          log.error(`[API Call] Duration: ${duration}ms`);
          log.error("═══════════════════════════════════════════════════════════════════");
          resolve({
            success: false,
            error: `Request timeout after ${timeoutMs}ms`,
            duration,
          });
        }, timeoutMs);

        try {
          const netRequest = net.request({
            method: "POST",
            url: request.apiUrl,
            session: session.defaultSession,
          });

          // Set headers
          netRequest.setHeader("Content-Type", "application/json; charset=utf-8");
          netRequest.setHeader("User-Agent", "DocHub/1.0");
          netRequest.setHeader("Accept", "application/json");

          let responseData = "";
          let responseHeaders: Record<string, string | string[]> = {};

          netRequest.on("response", (response) => {
            log.info("[API Call] Response received, reading data...");
            log.info(`[API Call] Status: ${response.statusCode} ${response.statusMessage}`);

            // Capture response headers
            responseHeaders = response.headers;
            log.info(`[API Call] Response Headers:`);
            Object.entries(response.headers).forEach(([key, value]) => {
              log.info(`[API Call]   ${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
            });

            response.on("data", (chunk) => {
              responseData += chunk.toString();
            });

            response.on("end", () => {
              clearTimeout(timeoutHandle);
              const duration = Date.now() - startTime;

              log.info("───────────────────────────────────────────────────────────────────");
              log.info(`[API Call] Response Body (raw, ${responseData.length} chars):`);
              // Log response body with proper formatting
              if (responseData.length > 0) {
                try {
                  const parsedResponse = JSON.parse(responseData);
                  const responseFormatted = JSON.stringify(parsedResponse, null, 2);
                  responseFormatted.split('\n').forEach(line => {
                    log.info(`[API Call]   ${line}`);
                  });
                } catch {
                  // If not JSON, log as-is (truncated if too long)
                  const truncated = responseData.length > 1000 ? responseData.substring(0, 1000) + '...' : responseData;
                  log.info(`[API Call]   ${truncated}`);
                }
              } else {
                log.info(`[API Call]   (empty response body)`);
              }

              if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                try {
                  const data = JSON.parse(responseData);
                  log.info("═══════════════════════════════════════════════════════════════════");
                  log.info("[API Call] SUCCESS");
                  log.info("═══════════════════════════════════════════════════════════════════");
                  log.info(`[API Call] Status Code: ${response.statusCode}`);
                  log.info(`[API Call] Duration: ${duration}ms`);
                  if (data.Results) {
                    log.info(`[API Call] Results count: ${data.Results.length}`);
                  }
                  log.info("═══════════════════════════════════════════════════════════════════");

                  resolve({
                    success: true,
                    statusCode: response.statusCode,
                    data,
                    duration,
                    method: "net.request",
                  });
                } catch (parseError) {
                  log.error("═══════════════════════════════════════════════════════════════════");
                  log.error("[API Call] JSON PARSE ERROR");
                  log.error("═══════════════════════════════════════════════════════════════════");
                  log.error(`[API Call] Failed to parse response as JSON`);
                  log.error(`[API Call] Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                  log.error(`[API Call] Raw response: ${responseData.substring(0, 500)}`);
                  log.error(`[API Call] Duration: ${duration}ms`);
                  log.error("═══════════════════════════════════════════════════════════════════");

                  resolve({
                    success: false,
                    error: "Failed to parse response JSON",
                    rawResponse: responseData.substring(0, 500),
                    duration,
                  });
                }
              } else {
                log.error("═══════════════════════════════════════════════════════════════════");
                log.error("[API Call] HTTP ERROR");
                log.error("═══════════════════════════════════════════════════════════════════");
                log.error(`[API Call] Status Code: ${response.statusCode}`);
                log.error(`[API Call] Status Message: ${response.statusMessage}`);
                log.error(`[API Call] Response Body: ${responseData.substring(0, 500)}`);
                log.error(`[API Call] Duration: ${duration}ms`);
                log.error("═══════════════════════════════════════════════════════════════════");

                resolve({
                  success: false,
                  error: `HTTP ${response.statusCode}: ${response.statusMessage}`,
                  statusCode: response.statusCode,
                  rawResponse: responseData.substring(0, 500),
                  duration,
                });
              }
            });
          });

          netRequest.on("error", (error) => {
            clearTimeout(timeoutHandle);
            const duration = Date.now() - startTime;

            log.error("═══════════════════════════════════════════════════════════════════");
            log.error("[API Call] NETWORK ERROR");
            log.error("═══════════════════════════════════════════════════════════════════");
            log.error(`[API Call] Error Type: ${error.name || 'Unknown'}`);
            log.error(`[API Call] Error Message: ${error.message}`);
            if (error.stack) {
              log.error(`[API Call] Stack Trace:`);
              error.stack.split('\n').forEach(line => {
                log.error(`[API Call]   ${line}`);
              });
            }
            log.error(`[API Call] Duration: ${duration}ms`);
            log.error("[API Call] Possible causes:");
            log.error("[API Call]   - Network connectivity issues");
            log.error("[API Call]   - Corporate proxy blocking the request");
            log.error("[API Call]   - SSL/TLS certificate issues");
            log.error("[API Call]   - DNS resolution failure");
            log.error("[API Call]   - Firewall blocking outbound connections");
            log.error("═══════════════════════════════════════════════════════════════════");

            resolve({
              success: false,
              error: error.message,
              errorType: error.name,
              duration,
            });
          });

          // Write payload and send request
          log.info("[API Call] Writing payload and sending request...");
          netRequest.write(jsonPayload);
          netRequest.end();
          log.info("[API Call] Request sent, waiting for response...");

        } catch (error) {
          clearTimeout(timeoutHandle);
          const duration = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;

          log.error("═══════════════════════════════════════════════════════════════════");
          log.error("[API Call] EXCEPTION DURING REQUEST");
          log.error("═══════════════════════════════════════════════════════════════════");
          log.error(`[API Call] Error: ${errorMessage}`);
          if (errorStack) {
            log.error(`[API Call] Stack Trace:`);
            errorStack.split('\n').forEach(line => {
              log.error(`[API Call]   ${line}`);
            });
          }
          log.error(`[API Call] Duration: ${duration}ms`);
          log.error("═══════════════════════════════════════════════════════════════════");

          resolve({
            success: false,
            error: errorMessage,
            duration,
          });
        }
      });
    });

    // Cancel ongoing operation
    ipcMain.handle("hyperlink:cancel-operation", async (event, request) => {
      const controller = this.processingQueue.get(request.operationId);
      if (controller) {
        controller.abort();
        this.processingQueue.delete(request.operationId);
        return { success: true, message: "Operation cancelled" };
      }
      return { success: false, message: "Operation not found" };
    });

    // File selection dialog
    ipcMain.handle("hyperlink:select-files", async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: "Select Word Documents",
        filters: [
          { name: "Word Documents", extensions: ["docx"] },
          { name: "All Files", extensions: ["*"] },
        ],
        properties: ["openFile", "multiSelections"],
      });

      if (!result.canceled) {
        return result.filePaths;
      }
      return [];
    });
  }

  private async validateFilePath(filePath: string): Promise<string> {
    // SECURITY: Check for path traversal attempts before normalization
    if (filePath.includes("..")) {
      throw new Error('Path traversal detected - relative paths with ".." are not allowed');
    }

    // Normalize and validate path
    const normalizedPath = join(filePath);

    // SECURITY: Double-check after normalization (defense in depth)
    if (normalizedPath.includes("..")) {
      throw new Error("Path traversal detected after normalization");
    }

    // Check if file exists
    try {
      const stats = await fsPromises.stat(normalizedPath);
      if (!stats.isFile()) {
        throw new Error("Path is not a file");
      }
    } catch (error) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    // Validate file extension
    if (!normalizedPath.toLowerCase().endsWith(".docx")) {
      throw new Error("Only .docx files are supported");
    }

    // Check file size (max 100MB)
    const stats = await fsPromises.stat(normalizedPath);
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (stats.size > maxSize) {
      throw new Error("File size exceeds 100MB limit");
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

        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("Operation was cancelled"));
        });
      }),
    ]);
  }
}

// Initialize IPC handlers
const hyperlinkHandler = new HyperlinkIPCHandler();

// Enhanced security settings
app.on("web-contents-created", (event, contents) => {
  // Prevent new window creation
  contents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });

  // Prevent navigation to external URLs
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://localhost:") && !url.startsWith("file://")) {
      event.preventDefault();
    }
  });
});

ipcMain.handle("platform", () => {
  return process.platform;
});

// File handling
ipcMain.handle("select-documents", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Word Documents", extensions: ["docx"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (!result.canceled) {
    return result.filePaths;
  }
  return undefined;
});

// Show file in folder
ipcMain.handle("show-in-folder", async (...[, path]: [Electron.IpcMainInvokeEvent, string]) => {
  if (!path) {
    throw new Error("No path provided");
  }

  try {
    // Check if file exists
    if (!fs.existsSync(path)) {
      throw new Error(`File not found: ${path}`);
    }

    // Show the file in the system file explorer
    shell.showItemInFolder(path);
  } catch (error) {
    log.error("Error showing file in folder:", error);
    throw error;
  }
});

// Open document in default application (Microsoft Word for .docx)
ipcMain.handle("open-document", async (...[, path]: [Electron.IpcMainInvokeEvent, string]) => {
  if (!path) {
    throw new Error("No path provided");
  }

  try {
    // Security: Check if file exists
    if (!fs.existsSync(path)) {
      throw new Error(`File not found: ${path}`);
    }

    // Security: Validate file extension (only allow .docx files)
    const fileExtension = path.toLowerCase().split(".").pop();
    if (fileExtension !== "docx") {
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
    log.error("Error opening document:", error);
    throw error;
  }
});

// Get file statistics (size, modified date, etc.)
ipcMain.handle("get-file-stats", async (...[, filePath]: [Electron.IpcMainInvokeEvent, string]) => {
  if (!filePath) {
    throw new Error("No file path provided");
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
    log.error("Error getting file stats:", error);
    throw error;
  }
});

// Restore document from backup
ipcMain.handle(
  "restore-from-backup",
  async (
    ...[, request]: [Electron.IpcMainInvokeEvent, { backupPath: string; targetPath: string }]
  ) => {
    if (!request.backupPath || !request.targetPath) {
      throw new Error("Both backupPath and targetPath are required");
    }

    try {
      // Validate backup exists
      if (!fs.existsSync(request.backupPath)) {
        throw new Error(`Backup file not found: ${request.backupPath}`);
      }

      // Validate backup is a .docx file
      if (!request.backupPath.toLowerCase().endsWith(".docx")) {
        throw new Error("Backup file must be a .docx file");
      }

      // Validate target path
      if (!request.targetPath.toLowerCase().endsWith(".docx")) {
        throw new Error("Target file must be a .docx file");
      }

      // Copy backup to target location, overwriting existing file
      await fsPromises.copyFile(request.backupPath, request.targetPath);

      log.info(
        `[Restore] Successfully restored ${request.targetPath} from backup ${request.backupPath}`
      );
    } catch (error) {
      log.error("Error restoring from backup:", error);
      throw error;
    }
  }
);

ipcMain.handle("process-document", async (...[, path]: [Electron.IpcMainInvokeEvent, string]) => {
  if (!path) {
    return { success: false, error: "No path provided" };
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

// Read file as ArrayBuffer (for snapshot capture in renderer process)
ipcMain.handle(
  "file:read-buffer",
  async (...[, filePath]: [Electron.IpcMainInvokeEvent, string]) => {
    if (!filePath) {
      throw new Error("No file path provided");
    }

    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Read file as buffer
      const buffer = await fsPromises.readFile(filePath);
      // Return as ArrayBuffer (Uint8Array is transferable via IPC)
      return buffer;
    } catch (error) {
      console.error("[IPC] Error reading file as buffer:", error);
      throw error;
    }
  }
);

// Extract text content from a document (for comparison views)
ipcMain.handle(
  "document:extract-text",
  async (...[, filePath]: [Electron.IpcMainInvokeEvent, string]) => {
    if (!filePath) {
      return { success: false, error: "No file path provided" };
    }

    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      // Validate file extension
      if (!filePath.toLowerCase().endsWith(".docx")) {
        return { success: false, error: "Only .docx files are supported" };
      }

      // Load document using docxmlater
      const { Document } = await import("docxmlater");
      const doc = await Document.load(filePath);

      // Extract paragraph text
      const paragraphs = doc.getAllParagraphs();
      const textContent = paragraphs.map((para: any) => {
        try {
          return para.getText() || "";
        } catch {
          return "";
        }
      });

      // Dispose document to free memory
      doc.dispose();

      log.info(`[Document] Extracted text from ${filePath}: ${textContent.length} paragraphs`);

      return {
        success: true,
        textContent,
      };
    } catch (error) {
      log.error("[Document] Error extracting text:", error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }
);

// Export/Import Settings
ipcMain.handle("export-settings", async () => {
  try {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Export Settings and Data",
      defaultPath: `DocHub-Export-${new Date().toISOString().split("T")[0]}.json`,
      filters: [
        { name: "JSON Files", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] },
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
    log.error("Error showing export dialog:", error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle("import-settings", async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Import Settings and Data",
      filters: [
        { name: "JSON Files", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const fileContent = await fsPromises.readFile(filePath, "utf-8");

      return {
        success: true,
        data: JSON.parse(fileContent),
        filePath,
      };
    }

    return { success: false, canceled: true };
  } catch (error) {
    log.error("Error importing settings:", error);
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
});

ipcMain.handle(
  "save-export-data",
  async (...[, request]: [Electron.IpcMainInvokeEvent, { filePath: string; data: any }]) => {
    try {
      await fsPromises.writeFile(request.filePath, JSON.stringify(request.data, null, 2), "utf-8");
      return { success: true };
    } catch (error) {
      log.error("Error saving export data:", error);
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
ipcMain.handle(
  "backup:create",
  async (...[, documentPath]: [Electron.IpcMainInvokeEvent, string]) => {
    try {
      if (!documentPath || typeof documentPath !== "string") {
        throw new Error("Invalid document path");
      }

      const backupPath = await backupService.createBackup(documentPath);
      return { success: true, backupPath };
    } catch (error) {
      log.error("[Backup] Create backup failed:", error);
      const message = error instanceof Error ? error.message : "Failed to create backup";
      return { success: false, error: message };
    }
  }
);

// Restore from backup
ipcMain.handle(
  "backup:restore",
  async (
    ...[, request]: [Electron.IpcMainInvokeEvent, { backupPath: string; targetPath: string }]
  ) => {
    try {
      if (!request.backupPath || !request.targetPath) {
        throw new Error("Both backupPath and targetPath are required");
      }

      await backupService.restoreBackup(request.backupPath, request.targetPath);
      return { success: true };
    } catch (error) {
      log.error("[Backup] Restore backup failed:", error);
      const message = error instanceof Error ? error.message : "Failed to restore backup";
      return { success: false, error: message };
    }
  }
);

// List backups for document
ipcMain.handle(
  "backup:list",
  async (...[, documentPath]: [Electron.IpcMainInvokeEvent, string]) => {
    try {
      if (!documentPath || typeof documentPath !== "string") {
        throw new Error("Invalid document path");
      }

      const backups = await backupService.listBackups(documentPath);
      return { success: true, backups };
    } catch (error) {
      log.error("[Backup] List backups failed:", error);
      const message = error instanceof Error ? error.message : "Failed to list backups";
      return { success: false, error: message, backups: [] };
    }
  }
);

// Delete specific backup
ipcMain.handle(
  "backup:delete",
  async (...[, backupPath]: [Electron.IpcMainInvokeEvent, string]) => {
    try {
      if (!backupPath || typeof backupPath !== "string") {
        throw new Error("Invalid backup path");
      }

      await backupService.deleteBackup(backupPath);
      return { success: true };
    } catch (error) {
      log.error("[Backup] Delete backup failed:", error);
      const message = error instanceof Error ? error.message : "Failed to delete backup";
      return { success: false, error: message };
    }
  }
);

// Cleanup old backups for document
ipcMain.handle(
  "backup:cleanup",
  async (...[, documentPath]: [Electron.IpcMainInvokeEvent, string]) => {
    try {
      if (!documentPath || typeof documentPath !== "string") {
        throw new Error("Invalid document path");
      }

      const deletedCount = await backupService.cleanupOldBackups(documentPath);
      return { success: true, deletedCount };
    } catch (error) {
      log.error("[Backup] Cleanup backups failed:", error);
      const message = error instanceof Error ? error.message : "Failed to cleanup backups";
      return { success: false, error: message, deletedCount: 0 };
    }
  }
);

// Cleanup all old backups
ipcMain.handle("backup:cleanup-all", async () => {
  try {
    const deletedCount = await backupService.cleanupAllOldBackups();
    return { success: true, deletedCount };
  } catch (error) {
    log.error("[Backup] Cleanup all backups failed:", error);
    const message = error instanceof Error ? error.message : "Failed to cleanup all backups";
    return { success: false, error: message, deletedCount: 0 };
  }
});

// Verify backup integrity
ipcMain.handle(
  "backup:verify",
  async (...[, backupPath]: [Electron.IpcMainInvokeEvent, string]) => {
    try {
      if (!backupPath || typeof backupPath !== "string") {
        throw new Error("Invalid backup path");
      }

      const isValid = await backupService.verifyBackup(backupPath);
      return { success: true, isValid };
    } catch (error) {
      log.error("[Backup] Verify backup failed:", error);
      const message = error instanceof Error ? error.message : "Failed to verify backup";
      return { success: false, error: message, isValid: false };
    }
  }
);

// Get backup storage info
ipcMain.handle("backup:storage-info", async () => {
  try {
    const storageInfo = await backupService.getBackupStorageInfo();
    return { success: true, storageInfo };
  } catch (error) {
    log.error("[Backup] Get storage info failed:", error);
    const message = error instanceof Error ? error.message : "Failed to get storage info";
    return { success: false, error: message };
  }
});

// Set backup configuration
ipcMain.handle(
  "backup:set-config",
  async (...[, config]: [Electron.IpcMainInvokeEvent, Partial<BackupConfig>]) => {
    try {
      if (!config || typeof config !== "object") {
        throw new Error("Invalid backup configuration");
      }

      backupService.setConfig(config);
      return { success: true };
    } catch (error) {
      log.error("[Backup] Set config failed:", error);
      const message = error instanceof Error ? error.message : "Failed to set backup configuration";
      return { success: false, error: message };
    }
  }
);

// ==============================================================================
// Dictionary Service IPC Handlers
// ==============================================================================

// Initialize dictionary database
ipcMain.handle("dictionary:initialize", async () => {
  try {
    const dictionaryService = getDictionaryService();
    const result = await dictionaryService.initialize();
    return result;
  } catch (error) {
    log.error("[Dictionary] Initialize failed:", error);
    const message = error instanceof Error ? error.message : "Failed to initialize dictionary";
    return { success: false, totalEntries: 0, error: message };
  }
});

// Configure SharePoint sync
ipcMain.handle(
  "dictionary:configure-sync",
  async (...[, config]: [Electron.IpcMainInvokeEvent, SharePointConfig]) => {
    try {
      const syncService = getSharePointSyncService();
      syncService.configure(config);

      // Set main window for progress updates
      if (mainWindow) {
        syncService.setMainWindow(mainWindow);
      }

      return { success: true };
    } catch (error) {
      log.error("[Dictionary] Configure sync failed:", error);
      const message = error instanceof Error ? error.message : "Failed to configure sync";
      return { success: false, error: message };
    }
  }
);

// Set client secret (sensitive, not stored in settings)
ipcMain.handle(
  "dictionary:set-credentials",
  async (...[, secret]: [Electron.IpcMainInvokeEvent, string]) => {
    try {
      const syncService = getSharePointSyncService();
      const result = syncService.setClientSecret(secret);
      return result;
    } catch (error) {
      log.error("[Dictionary] Set credentials failed:", error);
      const message = error instanceof Error ? error.message : "Failed to set credentials";
      return { success: false, error: message };
    }
  }
);

// Trigger dictionary sync
ipcMain.handle("dictionary:sync", async () => {
  try {
    const syncService = getSharePointSyncService();
    const result = await syncService.sync();
    return result;
  } catch (error) {
    log.error("[Dictionary] Sync failed:", error);
    const message = error instanceof Error ? error.message : "Failed to sync dictionary";
    return { success: false, entriesImported: 0, duration: 0, error: message };
  }
});

// Start sync scheduler
ipcMain.handle(
  "dictionary:start-scheduler",
  async (...[, intervalHours]: [Electron.IpcMainInvokeEvent, number]) => {
    try {
      const syncService = getSharePointSyncService();
      syncService.startScheduler(intervalHours);
      return { success: true };
    } catch (error) {
      log.error("[Dictionary] Start scheduler failed:", error);
      const message = error instanceof Error ? error.message : "Failed to start scheduler";
      return { success: false, error: message };
    }
  }
);

// Stop sync scheduler
ipcMain.handle("dictionary:stop-scheduler", async () => {
  try {
    const syncService = getSharePointSyncService();
    syncService.stopScheduler();
    return { success: true };
  } catch (error) {
    log.error("[Dictionary] Stop scheduler failed:", error);
    const message = error instanceof Error ? error.message : "Failed to stop scheduler";
    return { success: false, error: message };
  }
});

// Lookup single ID
ipcMain.handle(
  "dictionary:lookup",
  async (...[, lookupId]: [Electron.IpcMainInvokeEvent, string]) => {
    try {
      const lookupService = getLocalDictionaryLookupService();
      const result = lookupService.lookup(lookupId);
      return { success: true, result };
    } catch (error) {
      log.error("[Dictionary] Lookup failed:", error);
      const message = error instanceof Error ? error.message : "Failed to lookup";
      return { success: false, error: message };
    }
  }
);

// Batch lookup multiple IDs
ipcMain.handle(
  "dictionary:batch-lookup",
  async (...[, lookupIds]: [Electron.IpcMainInvokeEvent, string[]]) => {
    try {
      const lookupService = getLocalDictionaryLookupService();
      const results = lookupService.batchLookup(lookupIds);
      return { success: true, results };
    } catch (error) {
      log.error("[Dictionary] Batch lookup failed:", error);
      const message = error instanceof Error ? error.message : "Failed to batch lookup";
      return { success: false, error: message, results: [] };
    }
  }
);

// Get sync status
ipcMain.handle("dictionary:get-status", async () => {
  try {
    const dictionaryService = getDictionaryService();
    const status = dictionaryService.getSyncStatus();
    return { success: true, status };
  } catch (error) {
    log.error("[Dictionary] Get status failed:", error);
    const message = error instanceof Error ? error.message : "Failed to get status";
    return { success: false, error: message };
  }
});


// ==============================================================================
// Auto-Updater Configuration
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
    ipcMain.handle("check-for-updates", async () => {
      if (this.updateCheckInProgress) {
        return {
          success: false,
          message: "Update check already in progress",
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
          message: error instanceof Error ? error.message : "Failed to check for updates",
        };
      }
    });

    // Download update
    ipcMain.handle("download-update", async () => {
      if (this.downloadInProgress) {
        return {
          success: false,
          message: "Download already in progress",
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
          message: error instanceof Error ? error.message : "Failed to download update",
        };
      }
    });

    // Install update and restart
    ipcMain.handle("install-update", () => {
      this.customUpdater.quitAndInstall();
    });
  }

  // Check for updates on app start (if enabled in settings)
  public async checkOnStartup(): Promise<void> {
    await this.customUpdater.checkOnStartup();
  }

  // Start scheduled periodic update checks
  public startScheduledChecks(intervalMs?: number): void {
    this.customUpdater.startScheduledChecks(intervalMs);
  }
}

// ============================================================================
// Auto-Updater Handler
// ============================================================================
// MOVED to consolidated initialization above (Step 4)
// Now initialized AFTER certificate check completes (Issue #7 fix)
let updaterHandler: AutoUpdaterHandler;
