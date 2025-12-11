/**
 * PowerAutomateApiService - Main Process API Client
 *
 * This service handles PowerAutomate API calls directly from the main process
 * using Electron's net.request (Chromium networking stack).
 *
 * This is used by WordDocumentProcessor when running in the main process,
 * where window.electronAPI is not available.
 *
 * Key features:
 * - Uses Chromium's networking stack (respects system proxy and certificates)
 * - Retry logic with exponential backoff
 * - Comprehensive logging for debugging
 * - Timeout handling
 */

import { net, session } from 'electron';
import { logger } from '../../src/utils/logger';

const log = logger.namespace('PowerAutomateApi');

export interface PowerAutomateRequest {
  Lookup_ID: string[];
  Hyperlinks_Checked: number;
  Total_Hyperlinks: number;
  First_Name: string;
  Last_Name: string;
  Email: string;
}

export interface PowerAutomateResult {
  Document_ID?: string;
  Content_ID?: string;
  Title?: string;
  Status?: string;
}

export interface PowerAutomateResponse {
  success: boolean;
  statusCode?: number;
  data?: { Results?: PowerAutomateResult[] };
  error?: string;
  rawResponse?: string;
  duration?: number;
}

/**
 * Call the PowerAutomate API from the main process
 */
export async function callPowerAutomateApi(
  apiUrl: string,
  payload: PowerAutomateRequest,
  timeoutMs: number = 30000
): Promise<PowerAutomateResponse> {
  const jsonPayload = JSON.stringify(payload);
  const startTime = Date.now();

  log.info('═══════════════════════════════════════════════════════════════════');
  log.info('[MainProcess] Starting Power Automate HTTP Request');
  log.info('═══════════════════════════════════════════════════════════════════');
  log.info(`[MainProcess] Timestamp: ${new Date().toISOString()}`);
  log.info(`[MainProcess] URL: ${apiUrl}`);
  log.info(`[MainProcess] Lookup IDs: ${payload.Lookup_ID.length}`);
  log.info(`[MainProcess] IDs: ${payload.Lookup_ID.join(', ')}`);
  log.info(`[MainProcess] Timeout: ${timeoutMs}ms`);
  log.info('───────────────────────────────────────────────────────────────────');

  return new Promise((resolve) => {
    log.info('[MainProcess] Sending request via Electron net.request...');

    const timeoutHandle = setTimeout(() => {
      const duration = Date.now() - startTime;
      log.error('═══════════════════════════════════════════════════════════════════');
      log.error('[MainProcess] REQUEST TIMEOUT');
      log.error(`[MainProcess] Timeout after ${timeoutMs}ms`);
      log.error('═══════════════════════════════════════════════════════════════════');
      resolve({
        success: false,
        error: `Request timeout after ${timeoutMs}ms`,
        duration,
      });
    }, timeoutMs);

    try {
      const netRequest = net.request({
        method: 'POST',
        url: apiUrl,
        session: session.defaultSession,
      });

      // Set headers
      netRequest.setHeader('Content-Type', 'application/json; charset=utf-8');
      netRequest.setHeader('User-Agent', 'DocHub/1.0');
      netRequest.setHeader('Accept', 'application/json');

      let responseData = '';

      netRequest.on('response', (response) => {
        log.info(`[MainProcess] Response received: ${response.statusCode} ${response.statusMessage}`);

        response.on('data', (chunk) => {
          responseData += chunk.toString();
        });

        response.on('end', () => {
          clearTimeout(timeoutHandle);
          const duration = Date.now() - startTime;

          log.info(`[MainProcess] Response complete in ${duration}ms`);

          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            try {
              const data = JSON.parse(responseData);
              log.info('═══════════════════════════════════════════════════════════════════');
              log.info('[MainProcess] API Call SUCCESS');
              log.info(`[MainProcess] Results: ${data?.Results?.length || 0} items`);
              log.info('═══════════════════════════════════════════════════════════════════');

              resolve({
                success: true,
                statusCode: response.statusCode,
                data,
                duration,
              });
            } catch (parseError) {
              log.error('[MainProcess] Failed to parse response JSON:', parseError);
              resolve({
                success: false,
                statusCode: response.statusCode,
                error: 'Failed to parse API response',
                rawResponse: responseData,
                duration,
              });
            }
          } else {
            log.error('═══════════════════════════════════════════════════════════════════');
            log.error('[MainProcess] API Call FAILED');
            log.error(`[MainProcess] Status: ${response.statusCode}`);
            log.error(`[MainProcess] Response: ${responseData.substring(0, 500)}`);
            log.error('═══════════════════════════════════════════════════════════════════');

            resolve({
              success: false,
              statusCode: response.statusCode,
              error: `API returned status ${response.statusCode}`,
              rawResponse: responseData,
              duration,
            });
          }
        });

        response.on('error', (error) => {
          clearTimeout(timeoutHandle);
          const duration = Date.now() - startTime;
          log.error('[MainProcess] Response error:', error);
          resolve({
            success: false,
            error: error.message,
            duration,
          });
        });
      });

      netRequest.on('error', (error) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;
        log.error('[MainProcess] Request error:', error);
        resolve({
          success: false,
          error: error.message,
          duration,
        });
      });

      // Send the request body
      netRequest.write(jsonPayload);
      netRequest.end();
    } catch (error) {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;
      log.error('[MainProcess] Exception creating request:', error);
      resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      });
    }
  });
}

/**
 * Call PowerAutomate API with retry logic
 */
export async function callPowerAutomateApiWithRetry(
  apiUrl: string,
  payload: PowerAutomateRequest,
  options: {
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
  } = {}
): Promise<PowerAutomateResponse> {
  const { timeout = 30000, maxRetries = 3, retryDelay = 1000 } = options;

  let lastError: PowerAutomateResponse | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt) * retryDelay;
      log.info(`[MainProcess] Retry attempt ${attempt + 1} of ${maxRetries} (waiting ${delay}ms)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const response = await callPowerAutomateApi(apiUrl, payload, timeout);

    if (response.success) {
      return response;
    }

    lastError = response;

    // Don't retry on timeout
    if (response.error?.includes('timeout')) {
      log.error('[MainProcess] Timeout detected, not retrying');
      break;
    }
  }

  log.error(`[MainProcess] All ${maxRetries} attempts failed`);
  return lastError || { success: false, error: 'API request failed after retries' };
}
