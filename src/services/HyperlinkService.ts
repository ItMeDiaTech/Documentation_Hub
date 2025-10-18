import {
  HyperlinkData,
  DetailedHyperlinkInfo,
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult,
  HyperlinkFixingOptions,
  HyperlinkFixingResult,
  HyperlinkApiRequest,
  HyperlinkApiResponse,
  HyperlinkApiResult,
  HyperlinkApiSettings,
  HyperlinkValidationIssue,
  HyperlinkModificationResult,
  HyperlinkStatistics,
  URL_PATTERNS,
  HyperlinkType,
  HyperlinkSummary,
} from '@/types/hyperlink';
import { Document } from '@/types/session';
import { UserSettings } from '@/types/settings';
import { logger } from '@/utils/logger';
import { sanitizeUrl, validatePowerAutomateUrl } from '@/utils/urlHelpers';

export class HyperlinkService {
  private static instance: HyperlinkService;
  private apiSettings: HyperlinkApiSettings | null = null;
  private log = logger.namespace('HyperlinkService');

  private constructor() {}

  public static getInstance(): HyperlinkService {
    if (!HyperlinkService.instance) {
      HyperlinkService.instance = new HyperlinkService();
    }
    return HyperlinkService.instance;
  }

  /**
   * Initialize the service with user settings
   */
  public initialize(settings: UserSettings): void {
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
   * Process hyperlinks with PowerAutomate API
   * This sends collected IDs to the configured endpoint
   * Returns both the API response and maintains hyperlink relationships
   */
  public async processHyperlinksWithApi(
    hyperlinks: DetailedHyperlinkInfo[],
    settings?: HyperlinkApiSettings
  ): Promise<HyperlinkApiResponse & { processedHyperlinks?: DetailedHyperlinkInfo[] }> {
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
        const contentId = this.extractContentId(hyperlink.url);
        if (contentId && !uniqueIds.has(contentId)) {
          lookupIds.push(contentId);
          uniqueIds.add(contentId);
        }

        // Extract Document_ID if present
        const documentId = this.extractDocumentId(hyperlink.url);
        if (documentId && !uniqueIds.has(documentId)) {
          lookupIds.push(documentId);
          uniqueIds.add(documentId);
        }
      }

      // If no IDs found, return early
      if (lookupIds.length === 0) {
        return {
          success: false,
          timestamp: new Date(),
          error: 'No Content_ID or Document_ID found in hyperlinks',
        };
      }

      // Create request payload matching the specification
      const request = {
        Lookup_ID: lookupIds,
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
   * Fix source hyperlinks by appending Content IDs
   * Main functionality matching the C# implementation
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
   * Validate hyperlinks in a document
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
   * Get statistics about hyperlinks in a document
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
    const resultsCache = (apiResponse as any).resultsCache || new Map();

    for (const hyperlink of hyperlinks) {
      // CRITICAL PRE-FILTER: Extract IDs to determine if this hyperlink is processable
      // Only hyperlinks with Content_ID or Document_ID patterns should be processed
      const urlContentId = this.extractContentId(hyperlink.url);
      const urlDocumentId = this.extractDocumentId(hyperlink.url);

      // SKIP: This hyperlink doesn't contain Content_ID or Document_ID patterns
      // Examples: external URLs, mailto links, internal bookmarks
      if (!urlContentId && !urlDocumentId) {
        this.log.debug(`Skipping hyperlink (no Lookup_ID pattern): ${hyperlink.url.substring(0, 80)}`);
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

        // Add status indicators
        if (apiResult.status === 'Expired' || apiResult.status === 'deprecated') {
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
    request: { Lookup_ID: string[] }
  ): Promise<HyperlinkApiResponse> {
    const controller = new AbortController();
    const timeoutMs = settings.timeout || 30000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Sanitize the API URL to fix any encoding issues
      // This is critical for Azure Logic Apps URLs which often have encoded query parameters
      const sanitizedUrl = sanitizeUrl(settings.apiUrl);

      this.log.debug('Original API URL:', settings.apiUrl);
      if (sanitizedUrl !== settings.apiUrl) {
        this.log.info('URL sanitized - Fixed encoding issues:', {
          original: settings.apiUrl.substring(0, 100) + '...',
          sanitized: sanitizedUrl.substring(0, 100) + '...',
        });
      }

      // Validate the URL before using it
      const validation = validatePowerAutomateUrl(sanitizedUrl);
      if (!validation.valid) {
        const errorMsg = `Invalid PowerAutomate URL: ${validation.issues.join(', ')}`;
        this.log.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Add retry logic from Feature implementation
      let lastError: Error | null = null;
      const maxRetries = settings.retryAttempts || 3;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            // Exponential backoff
            await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            this.log.info(`Retry attempt ${attempt} of ${maxRetries}`);
          }

          this.log.debug('Sending API request to:', sanitizedUrl);
          this.log.debug('Request body:', JSON.stringify(request));

          const response = await fetch(sanitizedUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Note: User-Agent may be blocked in browser environment
              ...settings.headers,
            },
            body: JSON.stringify(request),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'No error details');
            this.log.error('API Error Response:', errorText);
            throw new Error(
              `API returned status ${response.status} ${response.statusText}. Details: ${errorText}`
            );
          }

          const data = await response.json();
          this.log.info('API Response:', data);

          // Parse response - support multiple formats:
          // Format 1 (wrapped): { StatusCode, Headers, Body: { Results, Version, Changes } }
          // Format 2 (direct): { Results, Version, Changes }
          // The actual API uses Format 2, so we check for Results array presence
          const apiResponse: HyperlinkApiResponse = {
            // Success if HTTP 200 AND we have Results array (in either format)
            success:
              response.ok && (Array.isArray(data.Results) || Array.isArray(data.Body?.Results)),
            timestamp: new Date(),
            statusCode: parseInt(data.StatusCode) || response.status,
          };

          // Handle both wrapped (data.Body) and direct (data) response formats
          const responseBody = data.Body || data;

          if (responseBody.Results) {
            // Cache results for efficient lookup
            const resultsMap = new Map<string, any>();

            apiResponse.body = {
              results:
                responseBody.Results?.map((result: any) => {
                  // Trim whitespace from all fields as specified
                  const processed = {
                    url: '', // Will be constructed from Document_ID
                    documentId: result.Document_ID?.trim() || '',
                    contentId: result.Content_ID?.trim() || '',
                    title: result.Title?.trim() || '',
                    status: result.Status?.trim() || 'Active',
                    metadata: {},
                  };

                  // Cache by both IDs for quick lookup
                  if (processed.documentId) resultsMap.set(processed.documentId, processed);
                  if (processed.contentId) resultsMap.set(processed.contentId, processed);

                  return processed;
                }) || [],
              errors: [],
            };

            // Store cache for quick lookups
            (apiResponse as any).resultsCache = resultsMap;
          }

          clearTimeout(timeout);
          return apiResponse;
        } catch (error) {
          lastError = error as Error;
          if (error instanceof Error && error.name === 'AbortError') {
            break; // Don't retry on timeout
          }
        }
      }

      clearTimeout(timeout);

      if (lastError && lastError.name === 'AbortError') {
        throw new Error(`API request timeout after ${timeoutMs}ms`);
      }

      throw lastError || new Error('API request failed after retries');
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
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

  private extractContentId(url: string): string | null {
    // Improved pattern matching from Feature implementation
    // Pattern: [TSRC|CMS]-[alphanumeric]-[6 digits]
    const match = url.match(/([TC][SM][RS]C?-[A-Za-z0-9]+-\d{6})/i);
    return match ? match[1] : null;
  }

  private extractDocumentId(url: string): string | null {
    // Extract everything after "docid=" until a non-alphanumeric/dash character
    // Improved pattern to handle edge cases
    const match = url.match(/docid=([A-Za-z0-9\-]+)(?:[^A-Za-z0-9\-]|$)/i);
    return match ? match[1] : null;
  }

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
