/**
 * MemoryMonitor - Real-time memory usage tracking and debugging
 *
 * Provides detailed heap usage statistics and warnings for memory-intensive operations
 * like document processing.
 */

import logger from './logger';

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  heapLimit: number;
  external: number;
  arrayBuffers: number;
  percentUsed: number;
  percentOfLimit: number;
  timestamp: number;
}

export interface MemoryWarning {
  level: 'info' | 'warning' | 'critical';
  message: string;
  stats: MemoryStats;
}

export class MemoryMonitor {
  private static readonly WARNING_THRESHOLD = 0.7; // 70%
  private static readonly CRITICAL_THRESHOLD = 0.85; // 85%
  private static checkpoints: Map<string, MemoryStats> = new Map();

  /**
   * Get current memory usage statistics
   */
  static getMemoryStats(): MemoryStats {
    const usage = process.memoryUsage();

    // Estimate heap limit (V8 default or set via --max-old-space-size)
    // Default is around 1.4GB on 64-bit systems, but we'll calculate from actual usage
    const heapLimit = usage.heapTotal * 3; // Conservative estimate

    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      heapLimit: heapLimit,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers || 0,
      percentUsed: (usage.heapUsed / usage.heapTotal) * 100,
      percentOfLimit: (usage.heapUsed / heapLimit) * 100,
      timestamp: Date.now(),
    };
  }

  /**
   * Format memory size in human-readable format
   */
  static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * Log memory usage with a labeled checkpoint
   */
  static logMemoryUsage(label: string, details?: string): MemoryStats {
    const stats = this.getMemoryStats();
    const warning = this.checkThreshold(stats);

    // Store checkpoint for comparison
    this.checkpoints.set(label, stats);

    // Build log message
    const logParts = [
      `[Memory] ${label}:`,
      `Used: ${this.formatBytes(stats.heapUsed)}`,
      `Total: ${this.formatBytes(stats.heapTotal)}`,
      `(${stats.percentUsed.toFixed(1)}% of heap)`,
    ];

    if (details) {
      logParts.push(`- ${details}`);
    }

    // Log with appropriate level
    if (warning) {
      if (warning.level === 'critical') {
        logger.error('🚨', logParts.join(' '), '- CRITICAL MEMORY USAGE!');
      } else if (warning.level === 'warning') {
        logger.warn('⚠️', logParts.join(' '), '- High memory usage');
      } else {
        logger.info('ℹ️', logParts.join(' '));
      }
    } else {
      logger.debug('✓', logParts.join(' '));
    }

    return stats;
  }

  /**
   * Check if memory usage exceeds thresholds
   */
  static checkThreshold(stats: MemoryStats): MemoryWarning | null {
    const percentUsed = stats.percentUsed / 100;

    if (percentUsed >= this.CRITICAL_THRESHOLD) {
      return {
        level: 'critical',
        message: `Memory usage critical (${stats.percentUsed.toFixed(1)}% of ${this.formatBytes(stats.heapTotal)}). Consider:
- Reducing document size
- Optimizing/compressing images
- Splitting into multiple documents
- Increasing Node.js heap size (--max-old-space-size)`,
        stats,
      };
    } else if (percentUsed >= this.WARNING_THRESHOLD) {
      return {
        level: 'warning',
        message: `Memory usage high (${stats.percentUsed.toFixed(1)}% of ${this.formatBytes(stats.heapTotal)})`,
        stats,
      };
    }

    return null;
  }

  /**
   * Compare memory usage between two checkpoints
   */
  static compareCheckpoints(startLabel: string, endLabel: string): void {
    const start = this.checkpoints.get(startLabel);
    const end = this.checkpoints.get(endLabel);

    if (!start || !end) {
      logger.warn(
        `[Memory] Cannot compare: checkpoint ${!start ? startLabel : endLabel} not found`
      );
      return;
    }

    const delta = end.heapUsed - start.heapUsed;
    const deltaFormatted = this.formatBytes(Math.abs(delta));
    const sign = delta >= 0 ? '+' : '-';
    const duration = end.timestamp - start.timestamp;

    logger.debug(
      `[Memory] Delta (${startLabel} → ${endLabel}): ${sign}${deltaFormatted} in ${duration}ms`
    );
  }

  /**
   * Force garbage collection if available (requires --expose-gc flag)
   */
  static forceGC(): boolean {
    if (global.gc) {
      logger.debug('[Memory] Forcing garbage collection...');
      const before = this.getMemoryStats();
      global.gc();
      const after = this.getMemoryStats();
      const freed = before.heapUsed - after.heapUsed;
      logger.info(`[Memory] GC freed ${this.formatBytes(freed)}`);
      return true;
    } else {
      logger.warn('[Memory] Garbage collection not available (run with --expose-gc)');
      return false;
    }
  }

  /**
   * Get memory usage summary for reporting
   */
  static getSummary(): string {
    const stats = this.getMemoryStats();
    return [
      'Memory Usage Summary:',
      `  Heap Used: ${this.formatBytes(stats.heapUsed)} (${stats.percentUsed.toFixed(1)}%)`,
      `  Heap Total: ${this.formatBytes(stats.heapTotal)}`,
      `  External: ${this.formatBytes(stats.external)}`,
      `  Array Buffers: ${this.formatBytes(stats.arrayBuffers)}`,
    ].join('\n');
  }

  /**
   * Check if memory is safe to proceed with operation
   */
  static isSafeToProcess(requiredBytes?: number): boolean {
    const stats = this.getMemoryStats();
    const warning = this.checkThreshold(stats);

    // Critical level - don't proceed
    if (warning && warning.level === 'critical') {
      logger.error(
        '🚨 [Memory] Cannot process document safely. Memory usage critical:',
        warning.message
      );
      return false;
    }

    // If required bytes specified, check if we have enough headroom
    if (requiredBytes) {
      const available = stats.heapTotal - stats.heapUsed;
      const needsHeadroom = requiredBytes * 1.5; // 50% safety margin

      if (available < needsHeadroom) {
        logger.warn(
          `⚠️ [Memory] Insufficient memory. Need ${this.formatBytes(needsHeadroom)}, have ${this.formatBytes(available)}`
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Monitor operation with automatic memory logging
   */
  static async monitorOperation<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    const startLabel = `${operationName}-start`;
    const endLabel = `${operationName}-end`;

    this.logMemoryUsage(startLabel, 'Starting operation');

    try {
      const result = await operation();
      this.logMemoryUsage(endLabel, 'Operation completed');
      this.compareCheckpoints(startLabel, endLabel);
      return result;
    } catch (error) {
      this.logMemoryUsage(`${operationName}-error`, 'Operation failed');
      throw error;
    }
  }

  /**
   * Clear all stored checkpoints
   */
  static clearCheckpoints(): void {
    this.checkpoints.clear();
  }
}

export default MemoryMonitor;
