/**
 * Centralized logging utility for Documentation Hub
 *
 * Features:
 * - Environment-aware logging (debug logs disabled in production)
 * - Consistent log formatting with timestamps
 * - Log levels: DEBUG, INFO, WARN, ERROR
 * - Performance optimization (no-ops in production for debug logs)
 *
 * Usage:
 * ```typescript
 * import { logger } from '@/utils/logger';
 *
 * logger.debug('Processing document', { documentId: 'abc123' });
 * logger.info('Document processed successfully');
 * logger.warn('Unexpected state encountered');
 * logger.error('Failed to process document', error);
 * ```
 */

const isDevelopment = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Format timestamp for log messages
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
 * Format log message with level and timestamp
 */
function formatMessage(level: string, message: string): string {
  return `[${getTimestamp()}] [${level}] ${message}`;
}

/**
 * Centralized logger with tiered log levels
 */
export const logger = {
  /**
   * Debug level logging - only enabled in development
   * Use for detailed diagnostic information during development
   */
  debug(message: string, ...args: any[]): void {
    if (isDevelopment && !isTest) {
      console.log(formatMessage('DEBUG', message), ...args);
    }
  },

  /**
   * Info level logging - enabled in all environments
   * Use for general informational messages about application flow
   */
  info(message: string, ...args: any[]): void {
    if (!isTest) {
      console.info(formatMessage('INFO', message), ...args);
    }
  },

  /**
   * Warning level logging - enabled in all environments
   * Use for potentially harmful situations that don't prevent operation
   */
  warn(message: string, ...args: any[]): void {
    if (!isTest) {
      console.warn(formatMessage('WARN', message), ...args);
    }
  },

  /**
   * Error level logging - always enabled
   * Use for error events that might still allow the app to continue
   */
  error(message: string, ...args: any[]): void {
    console.error(formatMessage('ERROR', message), ...args);
  },

  /**
   * Create a namespaced logger for specific modules
   * Useful for identifying log sources in complex applications
   *
   * @example
   * const log = logger.namespace('DocumentProcessor');
   * log.debug('Starting document processing');
   */
  namespace(name: string) {
    return {
      debug: (message: string, ...args: any[]) =>
        logger.debug(`[${name}] ${message}`, ...args),
      info: (message: string, ...args: any[]) =>
        logger.info(`[${name}] ${message}`, ...args),
      warn: (message: string, ...args: any[]) =>
        logger.warn(`[${name}] ${message}`, ...args),
      error: (message: string, ...args: any[]) =>
        logger.error(`[${name}] ${message}`, ...args),
    };
  },
};

/**
 * Performance measurement utility
 * Use to measure execution time of operations
 *
 * @example
 * const timer = logger.startTimer('Document Processing');
 * await processDocument();
 * timer.end(); // Logs: "Document Processing took 1234ms"
 */
export function startTimer(operationName: string) {
  const start = performance.now();

  return {
    end: () => {
      const duration = Math.round(performance.now() - start);
      logger.debug(`${operationName} took ${duration}ms`);
      return duration;
    },
  };
}

// Export for backward compatibility and convenience
export default logger;
