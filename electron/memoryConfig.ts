/**
 * Memory Configuration for Electron Main Process
 *
 * Configures Node.js heap size and memory limits for document processing operations.
 */

import { app } from 'electron';
import * as os from 'os';
import { logger } from '../src/utils/logger';

const log = logger.namespace('MemoryConfig');

export interface MemoryConfiguration {
  heapSizeMB: number;
  maxDocumentSizeMB: number;
  recommendedConcurrency: number;
  systemTotalMB: number;
  systemFreeMB: number;
}

export class MemoryConfig {
  private static readonly MIN_HEAP_SIZE_MB = 512; // Minimum 512MB
  private static readonly DEFAULT_HEAP_SIZE_MB = 1024; // Default 1GB
  private static readonly MAX_HEAP_SIZE_MB = 4096; // Maximum 4GB

  /**
   * Calculate optimal heap size based on system RAM
   */
  static calculateHeapSize(): number {
    const totalMemoryMB = os.totalmem() / (1024 * 1024);
    const freeMemoryMB = os.freemem() / (1024 * 1024);

    log.info(`System RAM: ${totalMemoryMB.toFixed(0)}MB total, ${freeMemoryMB.toFixed(0)}MB free`);

    // Use 25% of total RAM, but cap between MIN and MAX
    let heapSize = Math.floor(totalMemoryMB * 0.25);

    // Ensure within bounds
    heapSize = Math.max(this.MIN_HEAP_SIZE_MB, heapSize);
    heapSize = Math.min(this.MAX_HEAP_SIZE_MB, heapSize);

    // Round to nearest 256MB for cleaner numbers
    heapSize = Math.round(heapSize / 256) * 256;

    log.info(`Calculated heap size: ${heapSize}MB`);
    return heapSize;
  }

  /**
   * Get memory configuration
   */
  static getConfiguration(): MemoryConfiguration {
    const totalMemoryMB = os.totalmem() / (1024 * 1024);
    const freeMemoryMB = os.freemem() / (1024 * 1024);
    const heapSizeMB = this.calculateHeapSize();

    // Max document size should be roughly 1/4 of heap size to allow for processing overhead
    const maxDocumentSizeMB = Math.floor(heapSizeMB / 4);

    // Recommended concurrency based on available heap
    // Each concurrent operation needs ~256MB minimum
    const recommendedConcurrency = Math.max(1, Math.floor(heapSizeMB / 256));

    return {
      heapSizeMB,
      maxDocumentSizeMB,
      recommendedConcurrency,
      systemTotalMB: totalMemoryMB,
      systemFreeMB: freeMemoryMB,
    };
  }

  /**
   * Configure Electron app with memory settings
   * IMPORTANT: Must be called before app.ready
   */
  static configureApp(): void {
    const config = this.getConfiguration();

    log.info('========================================');
    log.info('Configuration Summary:');
    log.info(`  System Total RAM: ${config.systemTotalMB.toFixed(0)}MB`);
    log.info(`  System Free RAM: ${config.systemFreeMB.toFixed(0)}MB`);
    log.info(`  Heap Size: ${config.heapSizeMB}MB`);
    log.info(`  Max Document Size: ${config.maxDocumentSizeMB}MB`);
    log.info(`  Recommended Concurrency: ${config.recommendedConcurrency}`);
    log.info('========================================');

    // Set heap size via V8 flags
    // Note: These must be set before app initialization
    try {
      app.commandLine.appendSwitch('--js-flags', `--max-old-space-size=${config.heapSizeMB}`);
      log.info(`✓ Set --max-old-space-size=${config.heapSizeMB}`);
    } catch (error) {
      log.error('✗ Failed to set heap size:', error);
    }

    // Enable GC exposure for manual garbage collection if needed
    // Useful for cleaning up after large document operations
    try {
      app.commandLine.appendSwitch('--js-flags', '--expose-gc');
      log.info('✓ Enabled garbage collection exposure');
    } catch (error) {
      log.warn('⚠️ Could not enable GC exposure:', error);
    }

    // Optimize garbage collection for document processing
    // More aggressive GC to prevent memory buildup
    try {
      app.commandLine.appendSwitch('--js-flags', '--gc-interval=100');
      log.info('✓ Configured aggressive garbage collection');
    } catch (error) {
      log.warn('⚠️ Could not configure GC interval:', error);
    }
  }

  /**
   * Log current memory usage
   */
  static logMemoryUsage(label: string = 'Current'): void {
    const usage = process.memoryUsage();
    const config = this.getConfiguration();

    log.info(`${label} Memory Usage:`);
    log.info(`  Heap Used: ${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    log.info(`  Heap Total: ${(usage.heapTotal / 1024 / 1024).toFixed(2)}MB`);
    log.info(`  Heap Limit: ~${config.heapSizeMB}MB`);
    log.info(`  External: ${(usage.external / 1024 / 1024).toFixed(2)}MB`);
    log.info(`  RSS: ${(usage.rss / 1024 / 1024).toFixed(2)}MB`);

    const percentUsed = (usage.heapUsed / (config.heapSizeMB * 1024 * 1024)) * 100;
    if (percentUsed > 85) {
      log.error(`🚨 CRITICAL: ${percentUsed.toFixed(1)}% of heap used!`);
    } else if (percentUsed > 70) {
      log.warn(`⚠️ WARNING: ${percentUsed.toFixed(1)}% of heap used`);
    } else {
      log.info(`✓ ${percentUsed.toFixed(1)}% of heap used`);
    }
  }

  /**
   * Check if system has sufficient memory for operation
   */
  static canProcessDocument(documentSizeMB: number): boolean {
    const config = this.getConfiguration();
    const usage = process.memoryUsage();
    const usedMB = usage.heapUsed / (1024 * 1024);
    const availableMB = config.heapSizeMB - usedMB;

    // Need at least 4x document size for processing overhead
    const requiredMB = documentSizeMB * 4;

    if (availableMB < requiredMB) {
      log.error(`🚨 Insufficient memory to process ${documentSizeMB.toFixed(2)}MB document`);
      log.error(`   Required: ${requiredMB.toFixed(2)}MB, Available: ${availableMB.toFixed(2)}MB`);
      return false;
    }

    log.info(`✓ Sufficient memory for ${documentSizeMB.toFixed(2)}MB document (${availableMB.toFixed(2)}MB available)`);
    return true;
  }

  /**
   * Get memory statistics for reporting
   */
  static getStats(): {
    heapUsedMB: number;
    heapTotalMB: number;
    heapLimitMB: number;
    percentUsed: number;
    systemFreeMB: number;
  } {
    const usage = process.memoryUsage();
    const config = this.getConfiguration();
    const heapUsedMB = usage.heapUsed / (1024 * 1024);

    return {
      heapUsedMB,
      heapTotalMB: usage.heapTotal / (1024 * 1024),
      heapLimitMB: config.heapSizeMB,
      percentUsed: (heapUsedMB / config.heapSizeMB) * 100,
      systemFreeMB: config.systemFreeMB,
    };
  }
}

export default MemoryConfig;
