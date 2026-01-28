/**
 * Processing Time Estimator
 *
 * Estimates remaining time for document processing based on:
 * - Number of documents remaining
 * - Historical processing times
 * - Power Automate API response time (baseline: 12 seconds)
 */

interface ProcessingTiming {
  documentId: string;
  startTime: number;
  endTime?: number;
  apiCallCount: number;
}

const POWER_AUTOMATE_BASELINE_MS = 12000; // 12 seconds baseline for API response
const MIN_PROCESSING_TIME_MS = 3000; // Minimum time per document (local processing)
const MAX_HISTORY_SIZE = 20; // Keep last 20 timings for averaging

class ProcessingTimeEstimator {
  private timings: ProcessingTiming[] = [];
  private currentTiming: ProcessingTiming | null = null;
  private averageApiTime: number = POWER_AUTOMATE_BASELINE_MS;

  /**
   * Start timing a document
   */
  startDocument(documentId: string, apiCallCount: number = 1): void {
    this.currentTiming = {
      documentId,
      startTime: Date.now(),
      apiCallCount,
    };
  }

  /**
   * End timing for current document
   */
  endDocument(): void {
    if (!this.currentTiming) return;

    this.currentTiming.endTime = Date.now();
    this.timings.push(this.currentTiming);

    // Keep only recent timings
    if (this.timings.length > MAX_HISTORY_SIZE) {
      this.timings = this.timings.slice(-MAX_HISTORY_SIZE);
    }

    // Update average API time based on actual performance
    this.updateAverageApiTime();
    this.currentTiming = null;
  }

  /**
   * Record an API call timing
   */
  recordApiCallTime(durationMs: number): void {
    // Exponential moving average with 0.3 weight for new values
    // This allows the estimate to catch up or slow down based on actual performance
    const alpha = 0.3;
    this.averageApiTime = alpha * durationMs + (1 - alpha) * this.averageApiTime;
  }

  /**
   * Update the average API time based on completed documents
   */
  private updateAverageApiTime(): void {
    const completedTimings = this.timings.filter(t => t.endTime);
    if (completedTimings.length === 0) return;

    // Calculate average time per API call
    const recentTimings = completedTimings.slice(-5); // Use last 5 for responsiveness
    const totalTime = recentTimings.reduce((sum, t) => sum + (t.endTime! - t.startTime), 0);
    const totalApiCalls = recentTimings.reduce((sum, t) => sum + t.apiCallCount, 0);

    if (totalApiCalls > 0) {
      const measuredAverage = totalTime / totalApiCalls;
      // Blend with baseline to avoid wild swings
      const alpha = 0.4;
      this.averageApiTime = alpha * measuredAverage + (1 - alpha) * this.averageApiTime;
    }
  }

  /**
   * Estimate remaining time for pending documents
   *
   * @param documentsRemaining Number of documents left to process
   * @param estimatedApiCallsPerDoc Average API calls per document (default 1)
   * @returns Estimated time remaining in milliseconds
   */
  estimateRemainingTime(documentsRemaining: number, estimatedApiCallsPerDoc: number = 1): number {
    if (documentsRemaining <= 0) return 0;

    // Time for current document if in progress
    let currentDocRemaining = 0;
    if (this.currentTiming) {
      const elapsed = Date.now() - this.currentTiming.startTime;
      const estimatedTotal = this.currentTiming.apiCallCount * this.averageApiTime + MIN_PROCESSING_TIME_MS;
      currentDocRemaining = Math.max(0, estimatedTotal - elapsed);
    }

    // Time for remaining documents (not including current)
    const remainingDocsTime = (documentsRemaining - (this.currentTiming ? 1 : 0)) *
      (estimatedApiCallsPerDoc * this.averageApiTime + MIN_PROCESSING_TIME_MS);

    return currentDocRemaining + remainingDocsTime;
  }

  /**
   * Get the current average API response time
   */
  getAverageApiTime(): number {
    return this.averageApiTime;
  }

  /**
   * Format milliseconds to human-readable string
   */
  static formatTime(ms: number): string {
    if (ms <= 0) return '0s';

    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  /**
   * Reset all timings
   */
  reset(): void {
    this.timings = [];
    this.currentTiming = null;
    this.averageApiTime = POWER_AUTOMATE_BASELINE_MS;
  }
}

// Singleton instance
export const processingTimeEstimator = new ProcessingTimeEstimator();

// Export class for testing
export { ProcessingTimeEstimator };
