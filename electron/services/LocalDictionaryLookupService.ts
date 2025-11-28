/**
 * LocalDictionaryLookupService - Main Process
 * Bridge service that maps dictionary lookups to hyperlink API format
 *
 * This service provides the same result format as the Power Automate API
 * so that the renderer's HyperlinkService can use local dictionary
 * lookups without changing its processing logic.
 *
 * @architecture Main Process Service
 * @security Context isolation compliant
 */

import { logger } from '../../src/utils/logger';
import { getDictionaryService } from './DictionaryService';
import type { DictionaryEntry, DictionaryLookupResult } from '../../src/types/dictionary';

const log = logger.namespace('LocalDictionaryLookupService');

/**
 * Result format matching the Power Automate API response
 */
export interface HyperlinkLookupResult {
  Document_ID: string;
  Content_ID: string;
  Title: string;
  Status: 'Active' | 'Deprecated' | 'Expired' | 'Moved' | 'Not_Found';
}

/**
 * Service for performing hyperlink lookups against local dictionary
 */
export class LocalDictionaryLookupService {
  /**
   * Lookup a single ID and return result in API-compatible format
   */
  lookup(lookupId: string): HyperlinkLookupResult {
    const dictionaryService = getDictionaryService();
    const result = dictionaryService.lookup(lookupId);

    return this.mapToHyperlinkResult(result);
  }

  /**
   * Batch lookup multiple IDs for performance
   * Returns results in the same format as the Power Automate API
   */
  batchLookup(lookupIds: string[]): HyperlinkLookupResult[] {
    if (lookupIds.length === 0) {
      return [];
    }

    const dictionaryService = getDictionaryService();
    const results = dictionaryService.batchLookup(lookupIds);
    const mappedResults: HyperlinkLookupResult[] = [];

    for (const [, result] of results) {
      mappedResults.push(this.mapToHyperlinkResult(result));
    }

    log.debug('Batch lookup completed', {
      requested: lookupIds.length,
      found: mappedResults.filter((r) => r.Status !== 'Not_Found').length,
    });

    return mappedResults;
  }

  /**
   * Map dictionary lookup result to API-compatible format
   */
  private mapToHyperlinkResult(result: DictionaryLookupResult): HyperlinkLookupResult {
    if (!result.found || !result.entry) {
      return {
        Document_ID: result.lookupId,
        Content_ID: '',
        Title: '',
        Status: 'Not_Found',
      };
    }

    const entry = result.entry;

    // Map the status from dictionary to API format
    const status = this.mapStatus(entry.Status);

    return {
      Document_ID: entry.Document_ID,
      Content_ID: entry.Content_ID,
      Title: entry.Title,
      Status: status,
    };
  }

  /**
   * Map dictionary status to API status format
   */
  private mapStatus(
    dictionaryStatus: string
  ): 'Active' | 'Deprecated' | 'Expired' | 'Moved' | 'Not_Found' {
    const status = dictionaryStatus.toLowerCase().trim();

    switch (status) {
      case 'active':
      case 'published':
      case 'current':
        return 'Active';

      case 'deprecated':
      case 'obsolete':
        return 'Deprecated';

      case 'expired':
      case 'retired':
      case 'archived':
        return 'Expired';

      case 'moved':
      case 'relocated':
      case 'redirected':
        return 'Moved';

      default:
        // If status is empty or unknown, assume active
        return status === '' ? 'Active' : 'Active';
    }
  }

  /**
   * Get detailed entry information (includes all fields)
   */
  getDetailedEntry(lookupId: string): DictionaryEntry | null {
    const dictionaryService = getDictionaryService();
    const result = dictionaryService.lookup(lookupId);

    return result.found && result.entry ? result.entry : null;
  }
}

// Singleton instance
let localDictionaryLookupServiceInstance: LocalDictionaryLookupService | null = null;

export function getLocalDictionaryLookupService(): LocalDictionaryLookupService {
  if (!localDictionaryLookupServiceInstance) {
    localDictionaryLookupServiceInstance = new LocalDictionaryLookupService();
  }
  return localDictionaryLookupServiceInstance;
}
