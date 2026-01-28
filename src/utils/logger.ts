/**
 * Professional Logging Utility powered by electron-log
 *
 * Features:
 * - File logging with automatic rotation (5MB per file, 5 files max = 25MB total)
 * - Separate logs for main and renderer processes
 * - Environment-aware (debug logs disabled in production)
 * - Colored console output in development
 * - Timestamps and namespaces for better debugging
 * - IPC-safe (renderer logs appear in main console)
 * - Structured logging support
 * - Performance timing utilities
 *
 * Log Locations:
 * - Windows: ~/Documents/Documentation Hub/logs/
 * - macOS: ~/Library/Logs/Documentation Hub/
 * - Linux: ~/.config/Documentation Hub/logs/
 *
 * Usage:
 * ```typescript
 * import { logger } from '@/utils/logger';
 *
 * const log = logger.namespace('MyModule');
 * log.debug('Detailed info');  // Only in development
 * log.info('Important event'); // Always shows
 * log.warn('Warning message');
 * log.error('Error occurred', error);
 *
 * // Performance timing
 * const timer = logger.startTimer('Operation');
 * // ... do work ...
 * timer.end(); // Logs duration
 *
 * // Structured logging
 * log.info('Document processed', { docId: '123', duration: 1234 });
 * ```
 */

import electronLog from 'electron-log';

// Detect environment
const isDevelopment = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

// Detect if we're in renderer process
// NOTE: With contextIsolation: true, window.process is not available
// So we check for window and document (browser-like environment)
// Main process has 'electron' in process.versions, renderer has window/document
const isRenderer = typeof window !== 'undefined' && typeof document !== 'undefined';

// In renderer process, electron-log only has console transport and uses IPC for file logging
// In main process, it has both file and console transports
// We should only configure transports in the main process
const isMainProcess = !isRenderer;

// Only configure electron-log if we're in the main process
if (isMainProcess) {
  if (electronLog.transports?.file) {
    electronLog.transports.file.level = 'info';
    electronLog.transports.file.maxSize = 5 * 1024 * 1024; // 5MB per file
    electronLog.transports.file.archiveLogFn = (file: any) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      return file.toString().replace(/\.log$/, `-${timestamp}.log`);
    };
    electronLog.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
  }

  if (electronLog.transports?.console) {
    electronLog.transports.console.level = isDevelopment ? 'debug' : 'warn';

    // Console configuration (development only)
    if (isDevelopment) {
      electronLog.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';
      electronLog.transports.console.useStyles = true;
    } else {
      // Production: minimal console output
      electronLog.transports.console.format = '[{level}] {text}';
    }
  }

  // Disable logging in tests
  if (isTest && electronLog.transports?.file && electronLog.transports?.console) {
    electronLog.transports.file.level = false;
    electronLog.transports.console.level = false;
  }
} else {
  // Renderer process: Use console transport only, electron-log handles IPC automatically
  // This prevents the "logger isn't initialized in main process" error
  if (electronLog.transports?.console) {
    electronLog.transports.console.level = isDevelopment ? 'debug' : 'warn';
    electronLog.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';
  }

  // Disable file transport attempts in renderer (it uses IPC automatically when available)
  if (electronLog.transports?.file) {
    electronLog.transports.file.level = false;
  }
}

/**
 * SECURITY: Sanitize log data to prevent sensitive information exposure
 *
 * Redacts:
 * - File paths (Windows: C:\..., Unix: /home/...)
 * - API endpoints and URLs
 * - Document content (truncates long strings)
 * - Sensitive field names (apiEndpoint, filePath, documentPath, token, password, etc.)
 *
 * @param data - Any data to be logged
 * @returns Sanitized version safe for logging
 */
function sanitizeLogData(data: any): any {
  // Handle null/undefined
  if (data == null) {
    return data;
  }

  // Handle primitive types
  if (typeof data === 'string') {
    let sanitized = data;

    // Redact Windows file paths (C:\Users\..., D:\Documents\..., etc.)
    sanitized = sanitized.replace(/[A-Z]:\\[\w\s\-.()]+/gi, '[REDACTED_PATH]');

    // Redact Unix file paths (/home/..., /Users/..., /var/..., etc.)
    sanitized = sanitized.replace(/\/(home|Users|var|tmp|opt)\/[\w\s\-./]+/gi, '[REDACTED_PATH]');

    // Redact full URLs (but keep domain for debugging)
    sanitized = sanitized.replace(/(https?:\/\/[^/\s]+)(\/[^\s]*)/gi, '$1/[REDACTED_URL]');

    // Truncate very long strings (likely document content)
    if (sanitized.length > 500) {
      sanitized = sanitized.substring(0, 500) + '... [TRUNCATED]';
    }

    return sanitized;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }

  // Handle objects
  if (typeof data === 'object') {
    const sanitized: any = {};
    const sensitiveKeys = [
      'apiEndpoint',
      'apiUrl',
      'filePath',
      'documentPath',
      'path',
      'fullPath',
      'token',
      'apiKey',
      'password',
      'secret',
      'authorization',
      'cookie',
      'sessionId',
      'userId',
      'email',
      'username',
    ];

    for (const [key, value] of Object.entries(data)) {
      // Redact sensitive fields entirely
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else {
        // Recursively sanitize nested objects
        sanitized[key] = sanitizeLogData(value);
      }
    }

    return sanitized;
  }

  // Return other types (numbers, booleans) as-is
  return data;
}

/**
 * Get formatted timestamp for manual logging
 */
function getTimestamp(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Create a scoped logger for a specific module
 */
function createScopedLogger(scope: string) {
  // In renderer, only use console logging to avoid "not initialized" errors
  // electron-log will automatically send logs to main process via IPC when properly set up
  const useElectronLog = isMainProcess;
  const scopedLog = useElectronLog ? electronLog.scope(scope) : null;

  return {
    /**
     * Debug level - only enabled in development
     * Use for detailed diagnostic information
     */
    debug(message: string, ...args: any[]): void {
      if (isDevelopment && !isTest) {
        // SECURITY: Sanitize all arguments before logging
        const sanitizedArgs = args.map(sanitizeLogData);
        const sanitizedMessage = sanitizeLogData(message);

        if (scopedLog) {
          scopedLog.debug(sanitizedMessage, ...sanitizedArgs);
        } else {
          // Renderer fallback: use console directly
          console.debug(`[${scope}] [DEBUG] ${sanitizedMessage}`, ...sanitizedArgs);
        }
      }
    },

    /**
     * Info level - general informational messages
     * Enabled in all environments
     */
    info(message: string, ...args: any[]): void {
      if (!isTest) {
        // SECURITY: Sanitize all arguments before logging
        const sanitizedArgs = args.map(sanitizeLogData);
        const sanitizedMessage = sanitizeLogData(message);

        if (scopedLog) {
          scopedLog.info(sanitizedMessage, ...sanitizedArgs);
        } else {
          console.info(`[${scope}] [INFO] ${sanitizedMessage}`, ...sanitizedArgs);
        }
      }
    },

    /**
     * Warning level - potentially harmful situations
     * Enabled in all environments
     */
    warn(message: string, ...args: any[]): void {
      if (!isTest) {
        // SECURITY: Sanitize all arguments before logging
        const sanitizedArgs = args.map(sanitizeLogData);
        const sanitizedMessage = sanitizeLogData(message);

        if (scopedLog) {
          scopedLog.warn(sanitizedMessage, ...sanitizedArgs);
        } else {
          console.warn(`[${scope}] [WARN] ${sanitizedMessage}`, ...sanitizedArgs);
        }
      }
    },

    /**
     * Error level - error events
     * Always enabled
     */
    error(message: string, ...args: any[]): void {
      // SECURITY: Sanitize all arguments before logging
      const sanitizedArgs = args.map(sanitizeLogData);
      const sanitizedMessage = sanitizeLogData(message);

      if (scopedLog) {
        scopedLog.error(sanitizedMessage, ...sanitizedArgs);
      } else {
        console.error(`[${scope}] [ERROR] ${sanitizedMessage}`, ...sanitizedArgs);
      }
    },

    /**
     * Verbose level - very detailed logs
     * Only in development with explicit enable
     */
    verbose(message: string, ...args: any[]): void {
      if (isDevelopment && !isTest) {
        if (scopedLog) {
          scopedLog.verbose(message, ...args);
        } else {
          console.log(`[${scope}] [VERBOSE] ${message}`, ...args);
        }
      }
    },

    /**
     * Silly level - extremely detailed logs
     * Only in development with explicit enable
     */
    silly(message: string, ...args: any[]): void {
      if (isDevelopment && !isTest) {
        if (scopedLog) {
          scopedLog.silly(message, ...args);
        } else {
          console.log(`[${scope}] [SILLY] ${message}`, ...args);
        }
      }
    },
  };
}

/**
 * Main logger export with utility methods
 */
export const logger = {
  /**
   * Debug level logging - only enabled in development
   */
  debug(message: string, ...args: any[]): void {
    if (isDevelopment && !isTest) {
      if (isMainProcess) {
        electronLog.debug(message, ...args);
      } else {
        console.debug(`[DEBUG] ${message}`, ...args);
      }
    }
  },

  /**
   * Info level logging - enabled in all environments
   */
  info(message: string, ...args: any[]): void {
    if (!isTest) {
      if (isMainProcess) {
        electronLog.info(message, ...args);
      } else {
        console.info(`[INFO] ${message}`, ...args);
      }
    }
  },

  /**
   * Warning level logging - enabled in all environments
   */
  warn(message: string, ...args: any[]): void {
    if (!isTest) {
      if (isMainProcess) {
        electronLog.warn(message, ...args);
      } else {
        console.warn(`[WARN] ${message}`, ...args);
      }
    }
  },

  /**
   * Error level logging - always enabled
   */
  error(message: string, ...args: any[]): void {
    if (isMainProcess) {
      electronLog.error(message, ...args);
    } else {
      console.error(`[ERROR] ${message}`, ...args);
    }
  },

  /**
   * Verbose level logging
   */
  verbose(message: string, ...args: any[]): void {
    if (isDevelopment && !isTest) {
      if (isMainProcess) {
        electronLog.verbose(message, ...args);
      } else {
        console.log(`[VERBOSE] ${message}`, ...args);
      }
    }
  },

  /**
   * Create a namespaced logger for specific modules
   *
   * @example
   * const log = logger.namespace('DocumentProcessor');
   * log.info('Processing started');
   */
  namespace(name: string) {
    return createScopedLogger(name);
  },

  /**
   * Create a scoped logger (alias for namespace)
   */
  scope(name: string) {
    return createScopedLogger(name);
  },

  /**
   * Get the path to the log file
   */
  getLogPath(): string {
    if (electronLog.transports?.file) {
      return electronLog.transports.file.getFile().path;
    }
    return 'Logs not available in renderer';
  },

  /**
   * Set log level dynamically at runtime
   *
   * @param level - Log level (error, warn, info, debug, verbose, silly, false)
   */
  setLevel(level: 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'silly' | false): void {
    if (electronLog.transports?.file) {
      electronLog.transports.file.level = level;
    }
    if (electronLog.transports?.console) {
      electronLog.transports.console.level = level;
    }
  },

  /**
   * Enable or disable file logging
   */
  setFileLogging(enabled: boolean): void {
    if (electronLog.transports?.file) {
      electronLog.transports.file.level = enabled ? 'info' : false;
    }
  },

  /**
   * Clear all log files
   * Note: This function uses dynamic imports to avoid bundling Node.js modules in renderer
   */
  async clearLogs(): Promise<void> {
    try {
      if (!electronLog.transports?.file?.getFile) {
        throw new Error('File logging not available');
      }

      // Dynamic imports to avoid Vite bundling Node.js built-ins
      const fs = await import('fs/promises');
      const path = await import('path');

      const logPath = electronLog.transports.file.getFile().path;
      const logDir = path.dirname(logPath);

      const files = await fs.readdir(logDir);
      for (const file of files) {
        if (file.endsWith('.log')) {
          await fs.unlink(path.join(logDir, file));
        }
      }

      electronLog.info('Log files cleared');
    } catch (error) {
      electronLog.error('Failed to clear logs:', error);
    }
  },
};

/**
 * Performance measurement utility
 * Use to measure execution time of operations
 *
 * @example
 * const timer = startTimer('Document Processing');
 * await processDocument();
 * timer.end(); // Logs: "[DocumentProcessing] took 1234ms"
 */
export function startTimer(operationName: string) {
  const start = performance.now();
  const log = logger.namespace('Timer');

  return {
    /**
     * End the timer and log the duration
     */
    end(): number {
      const duration = Math.round(performance.now() - start);
      log.debug(`${operationName} took ${duration}ms`);
      return duration;
    },

    /**
     * Get current elapsed time without logging
     */
    elapsed(): number {
      return Math.round(performance.now() - start);
    },
  };
}

/**
 * Direct access to electron-log for advanced usage
 * Only use if you need features not exposed by the wrapper
 */
export const electronLogger = electronLog;

// Export for backward compatibility
export default logger;

// ============================================================================
// DEBUG MODE UTILITIES
// Toggleable verbose logging for specific subsystems
// ============================================================================

/**
 * Debug mode flags for enabling verbose logging in specific areas.
 * These can be toggled at runtime via localStorage for troubleshooting.
 *
 * @example
 * ```typescript
 * import { debugModes, setDebugMode, isDebugEnabled } from '@/utils/logger';
 *
 * // Enable document processing debug logs
 * setDebugMode(debugModes.DOCUMENT_PROCESSING, true);
 *
 * // Check if debug is enabled before verbose logging
 * if (isDebugEnabled(debugModes.SESSION_STATE)) {
 *   log.debug('Detailed session state:', state);
 * }
 * ```
 */
export const debugModes = {
  /** Verbose logging for document processing operations */
  DOCUMENT_PROCESSING: 'debug:documentProcessing',
  /** Verbose logging for session state transitions */
  SESSION_STATE: 'debug:sessionState',
  /** Verbose logging for IPC calls between main/renderer */
  IPC_CALLS: 'debug:ipcCalls',
  /** Verbose logging for IndexedDB operations */
  DATABASE: 'debug:database',
  /** Verbose logging for hyperlink operations */
  HYPERLINKS: 'debug:hyperlinks',
  /** Verbose logging for backup operations */
  BACKUPS: 'debug:backups',
  /** Verbose logging for list/bullet processing operations */
  LIST_PROCESSING: 'debug:listProcessing',
} as const;

export type DebugMode = (typeof debugModes)[keyof typeof debugModes];

/**
 * Check if a specific debug mode is enabled.
 *
 * @param mode - The debug mode to check (use debugModes constants)
 * @returns true if the debug mode is enabled
 *
 * @example
 * ```typescript
 * if (isDebugEnabled(debugModes.DOCUMENT_PROCESSING)) {
 *   log.debug('Processing details:', { step: 1, data: processingData });
 * }
 * ```
 */
export function isDebugEnabled(mode: DebugMode): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return false;
  }
  return localStorage.getItem(mode) === 'true';
}

/**
 * Enable or disable a specific debug mode.
 *
 * @param mode - The debug mode to set (use debugModes constants)
 * @param enabled - Whether to enable (true) or disable (false) the mode
 *
 * @example
 * ```typescript
 * // Enable debug mode for troubleshooting
 * setDebugMode(debugModes.SESSION_STATE, true);
 *
 * // Disable when done
 * setDebugMode(debugModes.SESSION_STATE, false);
 * ```
 */
export function setDebugMode(mode: DebugMode, enabled: boolean): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  if (enabled) {
    localStorage.setItem(mode, 'true');
  } else {
    localStorage.removeItem(mode);
  }
  const log = logger.namespace('Debug');
  log.info(`Debug mode ${mode} ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Get all currently enabled debug modes.
 *
 * @returns Array of enabled debug mode keys
 *
 * @example
 * ```typescript
 * const enabled = getEnabledDebugModes();
 * console.log('Active debug modes:', enabled);
 * // Output: ['debug:documentProcessing', 'debug:hyperlinks']
 * ```
 */
export function getEnabledDebugModes(): DebugMode[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return [];
  }
  return Object.values(debugModes).filter(
    (mode) => localStorage.getItem(mode) === 'true'
  ) as DebugMode[];
}

/**
 * Disable all debug modes.
 * Useful for resetting debug state after troubleshooting.
 */
export function disableAllDebugModes(): void {
  const log = logger.namespace('Debug');
  Object.values(debugModes).forEach((mode) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(mode);
    }
  });
  log.info('All debug modes disabled');
}

/**
 * Create a conditional logger that only logs when a debug mode is enabled.
 * Useful for adding verbose debug logging without impacting performance.
 *
 * @param mode - The debug mode that controls this logger
 * @param namespace - The namespace for log messages
 * @returns A logger that only logs when the mode is enabled
 *
 * @example
 * ```typescript
 * const debugLog = createDebugLogger(debugModes.DOCUMENT_PROCESSING, 'DocProcessor');
 *
 * // These only log when debug:documentProcessing is enabled
 * debugLog.debug('Step 1: Loading document');
 * debugLog.info('Processing complete', { stats });
 * ```
 */
export function createDebugLogger(mode: DebugMode, namespace: string) {
  const log = logger.namespace(namespace);

  return {
    debug: (...args: unknown[]) => {
      if (isDebugEnabled(mode)) (log.debug as (...args: unknown[]) => void)(...args);
    },
    info: (...args: unknown[]) => {
      if (isDebugEnabled(mode)) (log.info as (...args: unknown[]) => void)(...args);
    },
    warn: (...args: unknown[]) => {
      // Warnings always log
      (log.warn as (...args: unknown[]) => void)(...args);
    },
    error: (...args: unknown[]) => {
      // Errors always log
      (log.error as (...args: unknown[]) => void)(...args);
    },
  };
}

/**
 * Initialize logging on startup (call from main process)
 */
export function initializeLogging(): void {
  const log = logger.namespace('Logger');

  log.info('═══════════════════════════════════════════════════════════');
  log.info('  Documentation Hub - Logging Initialized');
  log.info('═══════════════════════════════════════════════════════════');
  log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  log.info(`Process: ${isRenderer ? 'Renderer' : 'Main'}`);

  if (electronLog.transports?.file) {
    log.info(`Log file: ${electronLog.transports.file.getFile().path}`);
    log.info(
      `Log level: File=${electronLog.transports.file.level}, Console=${electronLog.transports.console?.level || 'N/A'}`
    );
  }

  log.info('═══════════════════════════════════════════════════════════');
}
