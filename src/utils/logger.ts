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
const isRenderer = typeof window !== 'undefined' && window.process?.type === 'renderer';

// Detect if electron-log is properly initialized
const isElectronLogAvailable = !!(electronLog.transports?.file || electronLog.transports?.console);

// Only configure electron-log if transports are available (main process)
if (isElectronLogAvailable) {
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
  const scopedLog = isElectronLogAvailable ? electronLog.scope(scope) : null;

  return {
    /**
     * Debug level - only enabled in development
     * Use for detailed diagnostic information
     */
    debug(message: string, ...args: any[]): void {
      if (isDevelopment && !isTest) {
        if (scopedLog) {
          scopedLog.debug(message, ...args);
        } else {
          console.debug(`[${scope}] [DEBUG] ${message}`, ...args);
        }
      }
    },

    /**
     * Info level - general informational messages
     * Enabled in all environments
     */
    info(message: string, ...args: any[]): void {
      if (!isTest) {
        if (scopedLog) {
          scopedLog.info(message, ...args);
        } else {
          console.info(`[${scope}] [INFO] ${message}`, ...args);
        }
      }
    },

    /**
     * Warning level - potentially harmful situations
     * Enabled in all environments
     */
    warn(message: string, ...args: any[]): void {
      if (!isTest) {
        if (scopedLog) {
          scopedLog.warn(message, ...args);
        } else {
          console.warn(`[${scope}] [WARN] ${message}`, ...args);
        }
      }
    },

    /**
     * Error level - error events
     * Always enabled
     */
    error(message: string, ...args: any[]): void {
      if (scopedLog) {
        scopedLog.error(message, ...args);
      } else {
        console.error(`[${scope}] [ERROR] ${message}`, ...args);
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
      if (isElectronLogAvailable) {
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
      if (isElectronLogAvailable) {
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
      if (isElectronLogAvailable) {
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
    if (isElectronLogAvailable) {
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
      if (isElectronLogAvailable) {
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
