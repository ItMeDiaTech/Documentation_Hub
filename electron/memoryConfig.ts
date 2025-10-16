/**
 * Memory Configuration for Electron Main Process
 *
 * Configures Node.js heap size and memory limits for document processing operations.
 */

import { app } from 'electron';
import * as os from 'os';

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

    console.log(`[MemoryConfig] System RAM: ${totalMemoryMB.toFixed(0)}MB total, ${freeMemoryMB.toFixed(0)}MB free`);

    // Use 25% of total RAM, but cap between MIN and MAX
    let heapSize = Math.floor(totalMemoryMB * 0.25);

    // Ensure within bounds
    heapSize = Math.max(this.MIN_HEAP_SIZE_MB, heapSize);
    heapSize = Math.min(this.MAX_HEAP_SIZE_MB, heapSize);

    // Round to nearest 256MB for cleaner numbers
    heapSize = Math.round(heapSize / 256) * 256;

    console.log(`[MemoryConfig] Calculated heap size: ${heapSize}MB`);
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

    console.log('========================================');
    console.log('[MemoryConfig] Configuration Summary:');
    console.log(`  System Total RAM: ${config.systemTotalMB.toFixed(0)}MB`);
    console.log(`  System Free RAM: ${config.systemFreeMB.toFixed(0)}MB`);
    console.log(`  Heap Size: ${config.heapSizeMB}MB`);
    console.log(`  Max Document Size: ${config.maxDocumentSizeMB}MB`);
    console.log(`  Recommended Concurrency: ${config.recommendedConcurrency}`);
    console.log('========================================');

    // Set heap size via V8 flags
    // Note: These must be set before app initialization
    try {
      app.commandLine.appendSwitch('--js-flags', `--max-old-space-size=${config.heapSizeMB}`);
      console.log(`✓ [MemoryConfig] Set --max-old-space-size=${config.heapSizeMB}`);
    } catch (error) {
      console.error('✗ [MemoryConfig] Failed to set heap size:', error);
    }

    // Enable GC exposure for manual garbage collection if needed
    // Useful for cleaning up after large document operations
    try {
      app.commandLine.appendSwitch('--js-flags', '--expose-gc');
      console.log('✓ [MemoryConfig] Enabled garbage collection exposure');
    } catch (error) {
      console.warn('⚠️ [MemoryConfig] Could not enable GC exposure:', error);
    }

    // Optimize garbage collection for document processing
    // More aggressive GC to prevent memory buildup
    try {
      app.commandLine.appendSwitch('--js-flags', '--gc-interval=100');
      console.log('✓ [MemoryConfig] Configured aggressive garbage collection');
    } catch (error) {
      console.warn('⚠️ [MemoryConfig] Could not configure GC interval:', error);
    }
  }

  /**
   * Log current memory usage
   */
  static logMemoryUsage(label: string = 'Current'): void {
    const usage = process.memoryUsage();
    const config = this.getConfiguration();

    console.log(`[MemoryConfig] ${label} Memory Usage:`);
    console.log(`  Heap Used: ${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Heap Total: ${(usage.heapTotal / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Heap Limit: ~${config.heapSizeMB}MB`);
    console.log(`  External: ${(usage.external / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  RSS: ${(usage.rss / 1024 / 1024).toFixed(2)}MB`);

    const percentUsed = (usage.heapUsed / (config.heapSizeMB * 1024 * 1024)) * 100;
    if (percentUsed > 85) {
      console.error(`🚨 [MemoryConfig] CRITICAL: ${percentUsed.toFixed(1)}% of heap used!`);
    } else if (percentUsed > 70) {
      console.warn(`⚠️ [MemoryConfig] WARNING: ${percentUsed.toFixed(1)}% of heap used`);
    } else {
      console.log(`✓ [MemoryConfig] ${percentUsed.toFixed(1)}% of heap used`);
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
      console.error(`🚨 [MemoryConfig] Insufficient memory to process ${documentSizeMB.toFixed(2)}MB document`);
      console.error(`   Required: ${requiredMB.toFixed(2)}MB, Available: ${availableMB.toFixed(2)}MB`);
      return false;
    }

    console.log(`✓ [MemoryConfig] Sufficient memory for ${documentSizeMB.toFixed(2)}MB document (${availableMB.toFixed(2)}MB available)`);
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
