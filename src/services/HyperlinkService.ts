import {
  DetailedHyperlinkInfo,
  HyperlinkApiResponse,
  HyperlinkApiResult,
  HyperlinkApiSettings,
  HyperlinkFixingOptions,
  HyperlinkFixingResult,
  HyperlinkProcessingOptions,
  HyperlinkStatistics,
  HyperlinkType,
  HyperlinkValidationIssue,
  PowerAutomateResponse,
  URL_PATTERNS
} from '@/types/hyperlink';
import { Document } from '@/types/session';
import { UserSettings } from '@/types/settings';
import { logger } from '@/utils/logger';
import { sanitizeUrl, validatePowerAutomateUrl } from '@/utils/urlHelpers';
import { extractContentId, extractDocumentId } from '@/utils/urlPatterns';

/**
 * Extended API response with results cache for O(1) lookups
 */
interface HyperlinkApiResponseWithCache extends HyperlinkApiResponse {
  resultsCache?: Map<string, HyperlinkApiResult>;
}

/**
 * HyperlinkService - Singleton service for managing hyperlink operations
 *
 * Provides comprehensive hyperlink processing capabilities including:
 * - PowerAutomate API integration for Content ID and Document ID lookups
 * - URL pattern matching and validation
 * - Hyperlink extraction and statistics
 * - Retry logic with exponential backoff
 * - Result caching for O(1) lookups
 *
 * @class HyperlinkService
 * @singleton Use `HyperlinkService.getInstance()` to get the instance
 *
 * @example
 * ```typescript
 * // Get service instance
 * const service = HyperlinkService.getInstance();
 *
 * // Initialize with user settings
 * service.initialize(userSettings);
 *
 * // Process hyperlinks with API
 * const response = await service.processHyperlinksWithApi(hyperlinks, apiSettings);
 *
 * // Validate hyperlinks
 * const issues = await service.validateHyperlinks(document);
 * ```
 *
 * @see {@link HyperlinkApiSettings} for API configuration options
 * @see {@link DetailedHyperlinkInfo} for hyperlink data structure
 */
export class HyperlinkService {
  private static instance: HyperlinkService;
  private apiSettings: HyperlinkApiSettings | null = null;
  private userSettings: UserSettings | null = null;
  private log = logger.namespace('HyperlinkService');

  private constructor() {}

  /**
   * Get the singleton instance of HyperlinkService.
   *
   * @returns {HyperlinkService} The singleton instance
   * @static
   *
   * @example
   * ```typescript
   * const service = HyperlinkService.getInstance();
   * ```
   */
  public static getInstance(): HyperlinkService {
    if (!HyperlinkService.instance) {
      HyperlinkService.instance = new HyperlinkService();
    }
    return HyperlinkService.instance;
  }

  /**
   * Initialize the service with user settings.
   *
   * Configures the PowerAutomate API endpoint and validates the URL format.
   * Should be called during application startup with the user's saved settings.
   *
   * @param {UserSettings} settings - User settings containing API configuration
   * @throws {void} Does not throw - logs errors and continues with potentially invalid config
   *
   * @example
   * ```typescript
   * const service = HyperlinkService.getInstance();
   * service.initialize({
   *   apiConnections: {
   *     powerAutomateUrl: 'https://prod-XX.westus.logic.azure.com/...'
   *   }
   * });
   * ```
   */
  public initialize(settings: UserSettings): void {
    // Store full settings for local dictionary access
    this.userSettings = settings;

    if (settings.apiConnections.powerAutomateUrl) {
      // Sanitize the API URL to fix encoding issues
      const sanitizedUrl = sanitizeUrl(settings.apiConnections.powerAutomateUrl);

      // Validate URL format
      const validation = validatePowerAutomateUrl(sanitizedUrl);
      if (!validation.valid) {
        this.log.error('Invalid PowerAutomate URL configuration:', validation.issues);
        // Still set it but log the errors - let API call handle the failure
      } else if (validation.warnings.length > 0) {
        this.log.warn('PowerAutomate URL warnings:', validation.warnings);
      }

      this.apiSettings = {
        apiUrl: sanitizedUrl,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
      };

      this.log.debug('Initialized API settings with sanitized URL:', sanitizedUrl);
    }

    // Log local dictionary status
    if (settings.localDictionary?.enabled) {
      this.log.info('Local dictionary mode enabled - using SQLite database for lookups');
    }
  }

  /**
   * Check if local dictionary mode is enabled
   */
  public isLocalDictionaryEnabled(): boolean {
    return this.userSettings?.localDictionary?.enabled ?? false;
  }

  /**
   * Process hyperlinks using local dictionary (SQLite database)
   * This is used when local dictionary mode is enabled instead of Power Automate API
   */
  private async processHyperlinksWithLocalDictionary(
    hyperlinks: DetailedHyperlinkInfo[]
  ): Promise<HyperlinkApiResponse & { processedHyperlinks?: DetailedHyperlinkInfo[] }> {
    try {
      // Extract all IDs into a single lookup array
      const lookupIds: string[] = [];
      const uniqueIds = new Set<string>();

      for (const hyperlink of hyperlinks) {
        const contentId = extractContentId(hyperlink.url);
        if (contentId && !uniqueIds.has(contentId)) {
          lookupIds.push(contentId);
          uniqueIds.add(contentId);
        }

        const documentId = extractDocumentId(hyperlink.url);
        if (documentId && !uniqueIds.has(documentId)) {
          lookupIds.push(documentId);
          uniqueIds.add(documentId);
        }
      }

      if (lookupIds.length === 0) {
        // No IDs found is not a failure - it just means no hyperlinks need API processing
        // Return success with empty results so other formatting operations can continue
        this.log.warn('No Content_ID or Document_ID patterns found in hyperlinks - skipping API call');
        return {
          success: true,
          timestamp: new Date(),
          body: {
            results: [],
            errors: [],
          },
        };
      }

      // Check if electronAPI is available (handles SSR, tests, and browser contexts)
      if (typeof window === 'undefined' || !window.electronAPI) {
        return {
          success: false,
          timestamp: new Date(),
          error: 'Electron API not available - local dictionary requires Electron environment',
        };
      }

      this.log.info(`Processing ${lookupIds.length} IDs via local dictionary`);

      // Call local dictionary batch lookup
      const response = await window.electronAPI.dictionary.batchLookup(lookupIds);

      if (!response.success || !response.results) {
        return {
          success: false,
          timestamp: new Date(),
          error: response.error || 'Local dictionary lookup failed',
        };
      }

      this.log.info(`Local dictionary returned ${response.results.length} results`);

      // Build results cache for O(1) lookups
      const resultsMap = new Map<string, HyperlinkApiResult>();

      const results: HyperlinkApiResult[] = response.results.map((result) => {
        // Map local dictionary result to HyperlinkApiResult format
        const normalizedStatus: HyperlinkApiResult['status'] =
          result.Status?.toLowerCase() === 'deprecated'
            ? 'deprecated'
            : result.Status?.toLowerCase() === 'expired'
              ? 'expired'
              : result.Status?.toLowerCase() === 'not_found'
                ? 'not_found'
                : 'active';

        const processed: HyperlinkApiResult = {
          url: '',
          documentId: result.Document_ID || '',
          contentId: result.Content_ID || '',
          title: result.Title || '',
          status: normalizedStatus,
          metadata: {},
        };

        // Cache by both IDs for quick lookup
        if (processed.documentId) resultsMap.set(processed.documentId, processed);
        if (processed.contentId) resultsMap.set(processed.contentId, processed);

        return processed;
      });

      const apiResponse: HyperlinkApiResponse = {
        success: true,
        timestamp: new Date(),
        body: {
          results,
          errors: [],
        },
      };

      // Attach cache for O(1) lookups
      (apiResponse as HyperlinkApiResponseWithCache).resultsCache = resultsMap;

      return {
        ...apiResponse,
        processedHyperlinks: hyperlinks,
      };
    } catch (error) {
      this.log.error('Local dictionary lookup error:', error);
      return {
        success: false,
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Extract hyperlink IDs from documents
   * This mimics the C# ExtractHyperlinkDataAsync functionality
   */
  public async extractHyperlinkData(document: Document): Promise<DetailedHyperlinkInfo[]> {
    const hyperlinks: DetailedHyperlinkInfo[] = [];

    // In a real implementation, this would parse the document
    // For now, we'll simulate extraction
    this.log.debug(`Extracting hyperlinks from document: ${document.name}`);

    // Simulate finding hyperlinks
    const mockHyperlinks: DetailedHyperlinkInfo[] = [
      {
        id: 'rId1',
        relationshipId: 'rId1',
        element: {} as any,
        containingPart: 'document.xml',
        url: 'https://thesource.cvshealth.com/docid=TSRC-ABC-123456',
        displayText: 'Click here',
        type: 'external' as HyperlinkType,
        isInternal: false,
        isValid: true,
        context: 'See the document here: Click here for more information.',
      },
      {
        id: 'rId2',
        relationshipId: 'rId2',
        element: {} as any,
        containingPart: 'document.xml',
        url: 'https://thesource.cvshealth.com/docid=CMS-XYZ-789012',
        displayText: 'Reference',
        type: 'external' as HyperlinkType,
        isInternal: false,
        isValid: true,
        context: 'For additional details, see the Reference link.',
      },
    ];

    return mockHyperlinks;
  }

  /**
   * Process hyperlinks with PowerAutomate API.
   *
   * Sends collected Content IDs and Document IDs to the configured PowerAutomate endpoint
   * for lookup. Returns updated hyperlink information including new URLs and display texts.
   *
   * **Processing Flow:**
   * 1. Extract unique Content_ID and Document_ID from hyperlinks
   * 2. Send batch request to PowerAutomate API
   * 3. Build O(1) lookup cache from results
   * 4. Match results back to original hyperlinks
   *
   * @param {DetailedHyperlinkInfo[]} hyperlinks - Array of hyperlinks to process
   * @param {HyperlinkApiSettings} [settings] - Optional API settings (uses initialized settings if not provided)
   * @param {Object} [userProfile] - Optional user profile for tracking
   * @param {string} userProfile.firstName - User's first name
   * @param {string} userProfile.lastName - User's last name
   * @param {string} userProfile.email - User's email
   * @returns {Promise<HyperlinkApiResponse & { processedHyperlinks?: DetailedHyperlinkInfo[] }>} API response with processed hyperlinks
   *
   * @example
   * ```typescript
   * const response = await service.processHyperlinksWithApi(hyperlinks, {
   *   apiUrl: 'https://prod-XX.westus.logic.azure.com/...',
   *   timeout: 30000,
   *   retryAttempts: 3
   * });
   *
   * if (response.success) {
   *   console.log(`Processed ${response.results?.length} IDs`);
   * }
   * ```
   */
  public async processHyperlinksWithApi(
    hyperlinks: DetailedHyperlinkInfo[],
    settings?: HyperlinkApiSettings,
    userProfile?: { firstName: string; lastName: string; email: string }
  ): Promise<HyperlinkApiResponse & { processedHyperlinks?: DetailedHyperlinkInfo[] }> {
    // Check if local dictionary mode is enabled
    // When enabled, use local SQLite database instead of Power Automate API
    if (this.isLocalDictionaryEnabled()) {
      this.log.info('Using local dictionary for hyperlink processing (API call bypassed)');
      return this.processHyperlinksWithLocalDictionary(hyperlinks);
    }

    const apiConfig = settings || this.apiSettings;

    if (!apiConfig) {
      return {
        success: false,
        timestamp: new Date(),
        error: 'No API settings configured. Please configure PowerAutomate URL in settings.',
      };
    }

    try {
      // Extract all IDs (Content_ID and Document_ID) into a single Lookup_ID array
      const lookupIds: string[] = [];
      // Use Set to avoid duplicates
      const uniqueIds = new Set<string>();

      for (const hyperlink of hyperlinks) {
        // Extract Content_ID if present
        const contentId = extractContentId(hyperlink.url);
        if (contentId && !uniqueIds.has(contentId)) {
          lookupIds.push(contentId);
          uniqueIds.add(contentId);
        }

        // Extract Document_ID if present
        const documentId = extractDocumentId(hyperlink.url);
        if (documentId && !uniqueIds.has(documentId)) {
          lookupIds.push(documentId);
          uniqueIds.add(documentId);
        }
      }

      // If no IDs found, return early
      if (lookupIds.length === 0) {
        // No IDs found is not a failure - it just means no hyperlinks need API processing
        // Return success with empty results so other formatting operations can continue
        this.log.warn('No Content_ID or Document_ID patterns found in hyperlinks - skipping API call');
        return {
          success: true,
          timestamp: new Date(),
          body: {
            results: [],
            errors: [],
          },
        };
      }

      // Calculate hyperlink statistics
      const totalHyperlinks = hyperlinks.length;
      const hyperlinksChecked = hyperlinks.filter((h) =>
        URL_PATTERNS.THE_SOURCE.pattern.test(h.url)
      ).length;

      // Create request payload matching the specification with profile data and statistics
      const request = {
        Lookup_ID: lookupIds,
        Hyperlinks_Checked: hyperlinksChecked,
        Total_Hyperlinks: totalHyperlinks,
        First_Name: userProfile?.firstName || '',
        Last_Name: userProfile?.lastName || '',
        Email: userProfile?.email || '',
      };

      // Make API call
      const response = await this.callPowerAutomateApi(apiConfig, request);

      // Return response with processed hyperlinks for tracking
      return {
        ...response,
        processedHyperlinks: hyperlinks,
      };
    } catch (error) {
      return {
        success: false,
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Fix source hyperlinks by appending Content IDs.
   *
   * Main hyperlink processing method that extracts, validates, and modifies
   * hyperlinks in a document. Matches the functionality of the C# implementation.
   *
   * **Processing Phases:**
   * 1. Extract hyperlinks from document
   * 2. Call PowerAutomate API (if configured)
   * 3. Append Content IDs to matching URLs
   * 4. Update display texts as needed
   *
   * @param {Document} document - The document to process
   * @param {HyperlinkFixingOptions} [options={}] - Processing options
   * @param {string} [options.powerAutomateUrl] - PowerAutomate API endpoint URL
   * @param {boolean} [options.appendContentId] - Whether to append content IDs
   * @param {string} [options.contentIdToAppend] - Content ID to append (default: '#content')
   * @param {boolean} [options.updateTitles] - Whether to update hyperlink titles
   * @returns {Promise<HyperlinkFixingResult>} Processing results with statistics
   *
   * @example
   * ```typescript
   * const result = await service.fixSourceHyperlinks(document, {
   *   appendContentId: true,
   *   contentIdToAppend: '#content',
   *   updateTitles: true
   * });
   *
   * console.log(`Modified ${result.modifiedHyperlinks} hyperlinks`);
   * ```
   */
  public async fixSourceHyperlinks(
    document: Document,
    options: HyperlinkFixingOptions = {}
  ): Promise<HyperlinkFixingResult> {
    const startTime = Date.now();
    const result: HyperlinkFixingResult = {
      success: false,
      totalHyperlinks: 0,
      processedHyperlinks: 0,
      modifiedHyperlinks: 0,
      skippedHyperlinks: 0,
      updatedUrls: 0,
      updatedDisplayTexts: 0,
      appendedContentIds: 0,
      errorCount: 0,
      errorMessages: [],
      processedLinks: [],
      validationIssues: [],
      duration: 0,
    };

    try {
      // Phase 1: Extract hyperlinks
      const hyperlinks = await this.extractHyperlinkData(document);
      result.totalHyperlinks = hyperlinks.length;

      // Filter processable hyperlinks
      const processableHyperlinks = hyperlinks.filter((h) =>
        this.shouldProcessHyperlink(h, options)
      );
      result.processedHyperlinks = processableHyperlinks.length;
      result.skippedHyperlinks = hyperlinks.length - processableHyperlinks.length;

      if (processableHyperlinks.length === 0) {
        result.success = true;
        result.errorMessages.push('No processable hyperlinks found in the document');
        return result;
      }

      // Phase 2: API Communication (if configured)
      if (options.powerAutomateUrl || this.apiSettings) {
        const apiResponse = await this.processHyperlinksWithApi(processableHyperlinks);
        if (apiResponse.success && apiResponse.body?.results) {
          // Apply API-based fixes
          const apiFixResult = this.applyApiBasedFixes(processableHyperlinks, apiResponse);
          result.updatedUrls += apiFixResult.updatedUrls;
          result.updatedDisplayTexts += apiFixResult.updatedDisplayTexts;
        }
      }

      // Phase 3: Apply content ID appending if configured
      if (options.appendContentId) {
        const contentId = options.contentIdToAppend || '#content';
        const appendResult = this.appendContentIdToHyperlinks(processableHyperlinks, contentId);
        result.appendedContentIds = appendResult.appendedCount;
        result.updatedUrls += appendResult.appendedCount;
      }

      // Phase 4: Update titles if requested
      if (options.updateTitles) {
        const titleResult = this.updateHyperlinkTitles(processableHyperlinks);
        result.updatedDisplayTexts += titleResult.updatedCount;
      }

      // Create summaries for processed links
      result.processedLinks = processableHyperlinks.map((h) => ({
        id: h.id,
        url: h.url,
        displayText: h.displayText,
        type: h.type,
        location: h.containingPart,
        status: 'processed' as const,
        modifications: [],
      }));

      result.modifiedHyperlinks = result.updatedUrls + result.updatedDisplayTexts;
      result.success = true;
    } catch (error) {
      result.errorMessages.push(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  /**
   * Validate hyperlinks in a document.
   *
   * Checks all hyperlinks for common issues including:
   * - Invalid URL format
   * - Missing Content ID in theSource URLs
   * - Broken internal links
   * - Empty display text
   *
   * @param {Document} document - The document to validate
   * @returns {Promise<HyperlinkValidationIssue[]>} Array of validation issues found
   *
   * @example
   * ```typescript
   * const issues = await service.validateHyperlinks(document);
   * if (issues.length > 0) {
   *   console.log(`Found ${issues.length} issues:`);
   *   issues.forEach(issue => console.log(`  - ${issue.message}`));
   * }
   * ```
   */
  public async validateHyperlinks(document: Document): Promise<HyperlinkValidationIssue[]> {
    const issues: HyperlinkValidationIssue[] = [];
    const hyperlinks = await this.extractHyperlinkData(document);

    for (const hyperlink of hyperlinks) {
      // Check for invalid URL format
      if (!this.isValidUrl(hyperlink.url)) {
        issues.push({
          hyperlinkId: hyperlink.id,
          url: hyperlink.url,
          issueType: 'invalid_url',
          severity: 'error',
          message: 'Invalid URL format',
          suggestion: 'Fix the URL format or remove the hyperlink',
          autoFixable: false,
        });
      }

      // Check if theSource URLs need content ID
      if (this.isTheSourceUrl(hyperlink.url) && this.needsContentId(hyperlink.url)) {
        issues.push({
          hyperlinkId: hyperlink.id,
          url: hyperlink.url,
          issueType: 'invalid_url',
          severity: 'warning',
          message: 'TheSource URL missing content ID',
          suggestion: 'Append #content to the URL',
          autoFixable: true,
        });
      }
    }

    return issues;
  }

  /**
   * Get statistics about hyperlinks in a document.
   *
   * Analyzes all hyperlinks and returns detailed statistics including
   * counts by type, validity, and domain distribution.
   *
   * @param {Document} document - The document to analyze
   * @returns {Promise<HyperlinkStatistics>} Comprehensive hyperlink statistics
   *
   * @example
   * ```typescript
   * const stats = await service.getHyperlinkStatistics(document);
   * console.log(`Total hyperlinks: ${stats.total}`);
   * console.log(`External: ${stats.byType.external}`);
   * console.log(`Internal: ${stats.byType.internal}`);
   * console.log(`Valid: ${stats.validCount}, Invalid: ${stats.invalidCount}`);
   * ```
   */
  public async getHyperlinkStatistics(document: Document): Promise<HyperlinkStatistics> {
    const hyperlinks = await this.extractHyperlinkData(document);

    const stats: HyperlinkStatistics = {
      total: hyperlinks.length,
      byType: {
        external: 0,
        internal: 0,
        bookmark: 0,
        email: 0,
        file: 0,
      },
      byLocation: {
        document: 0,
        headers: 0,
        footers: 0,
      },
      valid: 0,
      invalid: 0,
      withContentId: 0,
      withoutContentId: 0,
      duplicates: 0,
      orphaned: 0,
    };

    const urlSet = new Set<string>();

    for (const hyperlink of hyperlinks) {
      // Count by type
      stats.byType[hyperlink.type]++;

      // Count by location
      if (hyperlink.containingPart.includes('header')) {
        stats.byLocation.headers++;
      } else if (hyperlink.containingPart.includes('footer')) {
        stats.byLocation.footers++;
      } else {
        stats.byLocation.document++;
      }

      // Count valid/invalid
      if (hyperlink.isValid) {
        stats.valid++;
      } else {
        stats.invalid++;
      }

      // Count content IDs
      if (hyperlink.url.includes('#content')) {
        stats.withContentId++;
      } else {
        stats.withoutContentId++;
      }

      // Check for duplicates
      if (urlSet.has(hyperlink.url)) {
        stats.duplicates++;
      } else {
        urlSet.add(hyperlink.url);
      }
    }

    return stats;
  }

  // Private helper methods

  private shouldProcessHyperlink(
    hyperlink: DetailedHyperlinkInfo,
    options: HyperlinkProcessingOptions
  ): boolean {
    if (hyperlink.isInternal && !options.processInternalLinks) return false;
    if (!hyperlink.isInternal && !options.processExternalLinks) return false;

    if (options.urlPattern) {
      const pattern =
        typeof options.urlPattern === 'string'
          ? new RegExp(options.urlPattern, 'i')
          : options.urlPattern;
      if (!pattern.test(hyperlink.url)) return false;
    }

    if (options.displayTextPattern) {
      const pattern =
        typeof options.displayTextPattern === 'string'
          ? new RegExp(options.displayTextPattern, 'i')
          : options.displayTextPattern;
      if (!pattern.test(hyperlink.displayText)) return false;
    }

    return true;
  }

  private applyApiBasedFixes(
    hyperlinks: DetailedHyperlinkInfo[],
    apiResponse: HyperlinkApiResponse
  ): { updatedUrls: number; updatedDisplayTexts: number } {
    let updatedUrls = 0;
    let updatedDisplayTexts = 0;

    if (!apiResponse.body?.results) return { updatedUrls, updatedDisplayTexts };

    // Use cache for O(1) lookups if available
    const apiResponseWithCache = apiResponse as HyperlinkApiResponseWithCache;
    const resultsCache = apiResponseWithCache.resultsCache || new Map<string, HyperlinkApiResult>();

    for (const hyperlink of hyperlinks) {
      // CRITICAL PRE-FILTER: Extract IDs to determine if this hyperlink is processable
      // Only hyperlinks with Content_ID or Document_ID patterns should be processed
      const urlContentId = extractContentId(hyperlink.url);
      const urlDocumentId = extractDocumentId(hyperlink.url);

      // SKIP: This hyperlink doesn't contain Content_ID or Document_ID patterns
      // Examples: external URLs, mailto links, internal bookmarks
      if (!urlContentId && !urlDocumentId) {
        this.log.debug(
          `Skipping hyperlink (no Lookup_ID pattern): ${hyperlink.url.substring(0, 80)}`
        );
        continue; // Skip to next hyperlink - no API processing needed
      }

      // Try cache first for performance
      let apiResult = null;
      if (urlContentId && resultsCache.has(urlContentId)) {
        apiResult = resultsCache.get(urlContentId);
      } else if (urlDocumentId && resultsCache.has(urlDocumentId)) {
        apiResult = resultsCache.get(urlDocumentId);
      } else {
        // Fallback to array search
        apiResult = apiResponse.body.results.find((r) => {
          if (urlContentId && r.contentId === urlContentId) return true;
          if (urlDocumentId && r.documentId === urlDocumentId) return true;
          return false;
        });
      }

      if (apiResult) {
        // Phase 3: URL Reconstruction
        // Always use Document_ID in URL (never Content_ID)
        const newUrl = `https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=${apiResult.documentId}`;
        if (newUrl !== hyperlink.url && apiResult.documentId) {
          hyperlink.url = newUrl;
          updatedUrls++;
        }

        // Phase 4: Display Text Rules
        let newDisplayText = hyperlink.displayText;

        // Remove existing Content_ID pattern (4-6 digits in parentheses)
        newDisplayText = newDisplayText.replace(/\s*\(\d{4,6}\)\s*$/, '');

        // Update title if mismatch detected
        if (apiResult.title && newDisplayText.trim() !== apiResult.title.trim()) {
          newDisplayText = apiResult.title;
        }

        // Append Content_ID (last 6 digits) if present
        if (apiResult.contentId) {
          // Extract last digits and pad with zeros if needed
          const contentIdMatch = apiResult.contentId.match(/(\d+)$/);
          if (contentIdMatch) {
            const digits = contentIdMatch[1].padStart(6, '0').slice(-6);
            newDisplayText = `${newDisplayText.trim()} (${digits})`;
          }
        }

        // Add status indicators for deprecated or expired documents
        if (apiResult.status === 'deprecated' || apiResult.status === 'expired') {
          newDisplayText += ' - Expired';
        }

        if (newDisplayText !== hyperlink.displayText) {
          hyperlink.displayText = newDisplayText;
          updatedDisplayTexts++;
        }
      } else {
        // API result not found - BUT only mark as "Not Found" if we extracted valid IDs
        // This prevents marking external/internal links that were never meant to be processed
        // (Note: We only reach here if urlContentId or urlDocumentId exists, due to the pre-filter above)
        this.log.warn(`No API result for hyperlink with Lookup_ID: ${hyperlink.url}`);
        if (!hyperlink.displayText.includes(' - Not Found')) {
          hyperlink.displayText += ' - Not Found';
          updatedDisplayTexts++;
        }
      }
    }

    return { updatedUrls, updatedDisplayTexts };
  }

  private appendContentIdToHyperlinks(
    hyperlinks: DetailedHyperlinkInfo[],
    contentId: string
  ): { appendedCount: number } {
    let appendedCount = 0;

    for (const hyperlink of hyperlinks) {
      if (
        this.isTheSourceUrl(hyperlink.url) &&
        this.needsContentId(hyperlink.url) &&
        !hyperlink.url.includes(contentId)
      ) {
        hyperlink.url += contentId;
        appendedCount++;
      }
    }

    return { appendedCount };
  }

  private updateHyperlinkTitles(hyperlinks: DetailedHyperlinkInfo[]): { updatedCount: number } {
    let updatedCount = 0;

    for (const hyperlink of hyperlinks) {
      const newTitle = this.extractTitleFromUrl(hyperlink.url);
      if (newTitle && newTitle !== hyperlink.displayText) {
        hyperlink.displayText = newTitle;
        updatedCount++;
      }
    }

    return { updatedCount };
  }

  private async callPowerAutomateApi(
    settings: HyperlinkApiSettings,
    request: {
      Lookup_ID: string[];
      Hyperlinks_Checked: number;
      Total_Hyperlinks: number;
      First_Name: string;
      Last_Name: string;
      Email: string;
    }
  ): Promise<HyperlinkApiResponse> {
    const timeoutMs = settings.timeout || 30000;
    const maxRetries = settings.retryAttempts || 3;

    // =========================================================================
    // COMPREHENSIVE LOGGING - API CALL START
    // =========================================================================
    this.log.info('═══════════════════════════════════════════════════════════════');
    this.log.info('[HyperlinkService] Starting Power Automate API Call');
    this.log.info('═══════════════════════════════════════════════════════════════');
    this.log.info(`[HyperlinkService] Timestamp: ${new Date().toISOString()}`);
    this.log.info(`[HyperlinkService] Lookup IDs: ${request.Lookup_ID.length} IDs`);
    this.log.info(`[HyperlinkService] IDs: ${request.Lookup_ID.join(', ')}`);
    this.log.info(`[HyperlinkService] Hyperlinks Checked: ${request.Hyperlinks_Checked}`);
    this.log.info(`[HyperlinkService] Total Hyperlinks: ${request.Total_Hyperlinks}`);
    this.log.info(`[HyperlinkService] User: ${request.First_Name} ${request.Last_Name}`);
    this.log.info(`[HyperlinkService] Timeout: ${timeoutMs}ms`);
    this.log.info(`[HyperlinkService] Max Retries: ${maxRetries}`);

    // Sanitize the API URL to fix any encoding issues
    const sanitizedUrl = sanitizeUrl(settings.apiUrl);

    if (sanitizedUrl !== settings.apiUrl) {
      this.log.info('[HyperlinkService] URL sanitized - Fixed encoding issues');
    }

    this.log.info(`[HyperlinkService] API URL: ${sanitizedUrl}`);

    // Validate the URL before using it
    const validation = validatePowerAutomateUrl(sanitizedUrl);
    if (!validation.valid) {
      const errorMsg = `Invalid PowerAutomate URL: ${validation.issues.join(', ')}`;
      this.log.error('[HyperlinkService] URL Validation FAILED:', errorMsg);
      throw new Error(errorMsg);
    }
    this.log.info('[HyperlinkService] URL Validation: PASSED');

    // Use main process net.request via IPC (matches C# HttpClient behavior on corporate networks)
    // This uses Chromium's networking stack which respects system proxy and certificates
    if (typeof window !== 'undefined' && window.electronAPI?.callPowerAutomateApi) {
      this.log.info('[HyperlinkService] Using IPC -> Main Process -> net.request');
      this.log.info('───────────────────────────────────────────────────────────────');

      let lastError: Error | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            const delay = Math.pow(2, attempt) * 1000;
            this.log.info(`[HyperlinkService] Retry attempt ${attempt + 1} of ${maxRetries} (waiting ${delay}ms)`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }

          this.log.info(`[HyperlinkService] Sending IPC request (attempt ${attempt + 1})...`);
          const startTime = Date.now();

          const response = await window.electronAPI.callPowerAutomateApi(
            sanitizedUrl,
            request,
            timeoutMs
          );

          const duration = Date.now() - startTime;

          if (!response.success) {
            this.log.error('[HyperlinkService] API call FAILED');
            this.log.error(`[HyperlinkService] Error: ${response.error}`);
            this.log.error(`[HyperlinkService] Duration: ${duration}ms`);
            throw new Error(response.error || `API returned status ${response.statusCode}`);
          }

          const data = response.data as { Results?: Array<{ Document_ID?: string; Content_ID?: string; Title?: string; Status?: string }> };

          this.log.info('═══════════════════════════════════════════════════════════════');
          this.log.info('[HyperlinkService] API Call SUCCESS');
          this.log.info('═══════════════════════════════════════════════════════════════');
          this.log.info(`[HyperlinkService] Status Code: ${response.statusCode}`);
          this.log.info(`[HyperlinkService] Duration: ${duration}ms`);
          this.log.info(`[HyperlinkService] Results: ${data?.Results?.length || 0} items`);

          const apiResponse: HyperlinkApiResponse = {
            success: Array.isArray(data?.Results),
            timestamp: new Date(),
            statusCode: response.statusCode,
          };

          if (data?.Results) {
            apiResponse.body = this.parseApiResults(data.Results);
            this.log.info(`[HyperlinkService] Parsed ${data.Results.length} results into cache`);
          }

          this.log.info('═══════════════════════════════════════════════════════════════');

          return apiResponse;
        } catch (error) {
          lastError = error as Error;
          this.log.error(`[HyperlinkService] Attempt ${attempt + 1} failed: ${lastError.message}`);
          // Check if it's a timeout error
          if (error instanceof Error && error.message.includes('timeout')) {
            this.log.error('[HyperlinkService] Timeout detected, not retrying');
            break;
          }
        }
      }

      if (lastError && lastError.message.includes('timeout')) {
        this.log.error(`[HyperlinkService] Final error: API request timeout after ${timeoutMs}ms`);
        throw new Error(`API request timeout after ${timeoutMs}ms`);
      }

      this.log.error(`[HyperlinkService] All ${maxRetries} attempts failed`);
      throw lastError || new Error('API request failed after retries');
    }

    // No Electron API available - provide detailed diagnostics
    const windowExists = typeof window !== 'undefined';
    const apiExists = windowExists && typeof window.electronAPI !== 'undefined';
    const methodExists = apiExists && typeof window.electronAPI?.callPowerAutomateApi === 'function';

    this.log.error('[HyperlinkService] ERROR: Electron API not available!');
    this.log.error(`[HyperlinkService] Diagnostics: window=${windowExists}, electronAPI=${apiExists}, callPowerAutomateApi=${methodExists}`);

    if (!windowExists) {
      this.log.error('[HyperlinkService] Running in non-browser context (SSR/Node.js)');
    } else if (!apiExists) {
      this.log.error('[HyperlinkService] Preload script may not have loaded - check BrowserWindow preload configuration');
    } else if (!methodExists) {
      this.log.error('[HyperlinkService] electronAPI exists but callPowerAutomateApi method is missing');
    }

    throw new Error('Electron API not available - cannot make API call. Ensure the app is running in Electron.');
  }

  /**
   * Parse API results into standardized format with caching
   * Accepts results from both IPC (optional fields) and direct API (required fields)
   */
  private parseApiResults(results: Array<{
    Document_ID?: string;
    Content_ID?: string;
    Title?: string;
    Status?: string;
  }>): HyperlinkApiResponse['body'] {
    const resultsMap = new Map<string, HyperlinkApiResult>();

    const parsedResults = results?.map((result) => {
      // Trim whitespace from all fields as specified
      const rawStatus = result.Status?.trim() || 'Active';
      // Normalize status to match HyperlinkApiResult type
      const normalizedStatus: HyperlinkApiResult['status'] =
        rawStatus.toLowerCase() === 'deprecated'
          ? 'deprecated'
          : rawStatus.toLowerCase() === 'expired'
            ? 'expired'
            : rawStatus.toLowerCase() === 'moved'
              ? 'moved'
              : rawStatus.toLowerCase() === 'not_found'
                ? 'not_found'
                : 'active';

      const processed: HyperlinkApiResult = {
        url: '', // Will be constructed from Document_ID
        documentId: result.Document_ID?.trim() || '',
        contentId: result.Content_ID?.trim() || '',
        title: result.Title?.trim() || '',
        status: normalizedStatus,
        metadata: {},
      };

      // Cache by both IDs for quick lookup
      if (processed.documentId) resultsMap.set(processed.documentId, processed);
      if (processed.contentId) resultsMap.set(processed.contentId, processed);

      return processed;
    }) || [];

    return {
      results: parsedResults,
      errors: [],
      // Note: resultsCache is added by caller if needed
    };
  }

  // Utility methods matching the C# implementation

  private isValidUrl(url: string): boolean {
    if (!url) return false;
    if (url.startsWith('#')) return true; // Internal links

    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private isTheSourceUrl(url: string): boolean {
    return URL_PATTERNS.THE_SOURCE.pattern.test(url);
  }

  private needsContentId(url: string): boolean {
    return (
      this.isTheSourceUrl(url) &&
      (URL_PATTERNS.CONTENT_ID.pattern.test(url) || URL_PATTERNS.DOCUMENT_ID.pattern.test(url))
    );
  }

  // Extraction methods moved to centralized utility: src/utils/urlPatterns.ts
  // Use: extractContentId(url), extractDocumentId(url), isTheSourceUrl(url)

  private extractTitleFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const segments = urlObj.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        const lastSegment = segments[segments.length - 1];
        if (lastSegment && lastSegment.length > 3) {
          return decodeURIComponent(lastSegment).replace(/[-_]/g, ' ');
        }
      }
    } catch {
      // Return null if extraction fails
    }
    return null;
  }
}

// Export singleton instance
export const hyperlinkService = HyperlinkService.getInstance();
