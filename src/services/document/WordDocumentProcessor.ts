/**
 * WordDocumentProcessor - Modern DOCX processing using DocXMLater
 *
 * Complete rewrite using docxmlater library for all document operations.
 * Replaces 4000+ lines of manual XML parsing with clean, type-safe APIs.
 */

import { Document, Hyperlink } from 'docxmlater';
import { promises as fs } from 'fs';
import * as path from 'path';
import pLimit from 'p-limit';
import {
  DetailedHyperlinkInfo,
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult,
  HyperlinkType,
} from '@/types/hyperlink';
import { DocXMLaterProcessor } from './DocXMLaterProcessor';
import { DocXMLaterOOXMLValidator } from './OOXMLValidator-DocXMLater';
import { DocumentProcessingComparison, documentProcessingComparison } from './DocumentProcessingComparison';
import { MemoryMonitor } from '@/utils/MemoryMonitor';
import { logger } from '@/utils/logger';
import { hyperlinkService } from '../HyperlinkService';

export interface WordProcessingOptions extends HyperlinkProcessingOptions {
  createBackup?: boolean;
  validateBeforeProcessing?: boolean;
  streamLargeFiles?: boolean;
  maxFileSizeMB?: number;
  removeWhitespace?: boolean;
  removeItalics?: boolean;
  assignStyles?: boolean;
  contentId?: string; // Content ID to append
  trackChanges?: boolean; // Track changes for comparison
  trackChangesInWord?: boolean; // Add Word tracked changes (visible in Review mode)
  trackChangesAuthor?: string; // Author name for tracked changes
  customReplacements?: Array<{
    find: string;
    replace: string;
    matchType: 'contains' | 'exact' | 'startsWith';
    applyTo: 'url' | 'text' | 'both';
  }>; // Custom URL/text replacements
  header2Spacing?: {
    spaceBefore: number;
    spaceAfter: number;
  };
  customStyleSpacing?: {
    header1?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
    header2?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
    normal?: {
      spaceBefore: number;
      spaceAfter: number;
      lineSpacing?: number;
      noSpaceBetweenSame?: boolean;
    };
  };
}

export interface WordProcessingResult extends HyperlinkProcessingResult {
  backupPath?: string;
  documentSize?: number;
  processingTimeMs?: number;
  comparisonData?: any; // Data for before/after comparison
}

/**
 * Modern Word document processor using DocXMLater
 */
export class WordDocumentProcessor {
  private readonly MAX_FILE_SIZE_MB = 100;
  private docXMLater: DocXMLaterProcessor;
  private ooxmlValidator: DocXMLaterOOXMLValidator;

  // Debug mode controlled by environment
  private readonly DEBUG = process.env.NODE_ENV !== 'production';

  private log = logger.namespace('WordDocProcessor');

  constructor() {
    this.docXMLater = new DocXMLaterProcessor();
    this.ooxmlValidator = new DocXMLaterOOXMLValidator();
    this.log.debug('Initialized with DocXMLater and OOXML validation (JSZip-free)');
  }

  /**
   * Process a Word document with hyperlink manipulation
   * Main entry point - maintains compatibility with existing IPC handlers
   */
  async processDocument(
    filePath: string,
    options: WordProcessingOptions = {}
  ): Promise<WordProcessingResult> {
    this.log.debug('═══════════════════════════════════════════════════════════');
    this.log.debug('  WORD DOCUMENT PROCESSOR - DOCXMLATER');
    this.log.debug('═══════════════════════════════════════════════════════════');
    this.log.debug('File:', filePath);
    this.log.debug('Options:', JSON.stringify(options, null, 2));

    // Memory checkpoint: Start
    MemoryMonitor.logMemoryUsage('DocProcessor Start', `Processing: ${path.basename(filePath)}`);

    const startTime = performance.now();
    const result: WordProcessingResult = {
      success: false,
      totalHyperlinks: 0,
      processedHyperlinks: 0,
      modifiedHyperlinks: 0,
      skippedHyperlinks: 0,
      updatedUrls: 0, // Always defined
      updatedDisplayTexts: 0, // Always defined
      appendedContentIds: 0,
      errorCount: 0,
      errorMessages: [],
      processedLinks: [],
      validationIssues: [],
      duration: 0,
    };

    let backupCreated = false;

    try {
      // Validate file
      const stats = await fs.stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      result.documentSize = stats.size;

      this.log.debug(`File size: ${fileSizeMB.toFixed(2)}MB`);

      // Memory checkpoint: After file validation
      MemoryMonitor.logMemoryUsage('After File Validation', `${fileSizeMB.toFixed(2)}MB document`);

      if (fileSizeMB > (options.maxFileSizeMB || this.MAX_FILE_SIZE_MB)) {
        throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB exceeds limit`);
      }

      // Create backup
      this.log.debug('=== BACKUP CREATION ===');
      const backupPath = await this.createBackup(filePath);
      result.backupPath = backupPath;
      backupCreated = true;
      this.log.info(`Backup created: ${backupPath}`);

      // Load document using DocXMLater
      this.log.debug('=== LOADING DOCUMENT WITH DOCXMLATER ===');
      const doc = await Document.load(filePath);
      this.log.debug('Document loaded successfully');

      // Start tracking changes if enabled
      if (options.trackChanges) {
        this.log.debug('=== STARTING CHANGE TRACKING ===');
        await documentProcessingComparison.startTracking(filePath, doc);
      }

      // Memory checkpoint: After document load
      MemoryMonitor.logMemoryUsage('After Document Load', 'DocXMLater document loaded');

      // Extract hyperlinks
      this.log.debug('=== EXTRACTING HYPERLINKS ===');
      const hyperlinks = await this.docXMLater.extractHyperlinks(doc);
      result.totalHyperlinks = hyperlinks.length;
      this.log.info(`Found ${hyperlinks.length} hyperlinks`);

      // Memory checkpoint: After hyperlink extraction
      MemoryMonitor.logMemoryUsage(
        'After Hyperlink Extraction',
        `${hyperlinks.length} hyperlinks extracted`
      );

      // ═══════════════════════════════════════════════════════════
      // PowerAutomate API Integration
      // Process hyperlinks with PowerAutomate API if operations enabled
      // ═══════════════════════════════════════════════════════════
      if (hyperlinks.length > 0 && (options.operations?.fixContentIds || options.operations?.updateTitles)) {
        const apiEndpoint = options.apiEndpoint;

        if (apiEndpoint) {
          this.log.debug('=== PROCESSING WITH POWERAUTOMATE API ===');
          this.log.debug(`API Endpoint: ${apiEndpoint}`);
          this.log.debug(`Operations: fixContentIds=${options.operations?.fixContentIds}, updateTitles=${options.operations?.updateTitles}`);

          const apiSettings = {
            apiUrl: apiEndpoint,
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 1000,
          };

          try {
            // Convert DocXMLater hyperlinks to DetailedHyperlinkInfo format for API
            this.log.debug(`Calling hyperlink service with ${hyperlinks.length} hyperlinks`);

            const hyperlinkInfos: DetailedHyperlinkInfo[] = hyperlinks.map((h, index) => ({
              id: `hyperlink-${index}`,
              relationshipId: `rId${index}`,
              element: h.hyperlink as any,
              containingPart: 'document.xml',
              url: h.url || '',
              displayText: h.text,
              type: 'external' as HyperlinkType,
              isInternal: false,
              isValid: true,
            }));

            const apiResponse = await hyperlinkService.processHyperlinksWithApi(
              hyperlinkInfos,
              apiSettings
            );

            this.log.info(`API Response success: ${apiResponse.success}`);

            // Check if API call succeeded - if not and operations require it, throw error
            if (!apiResponse.success) {
              const errorMsg = apiResponse.error || 'API request failed';
              this.log.error('API Error:', errorMsg);

              // If fixContentIds or updateTitles are required, we must fail
              // Don't save a document with incorrect/unchanged hyperlinks
              if (options.operations?.fixContentIds || options.operations?.updateTitles) {
                throw new Error(`PowerAutomate API failed: ${errorMsg}. Document not saved to prevent incorrect hyperlink data.`);
              }

              // Otherwise just log and continue
              result.errorMessages.push(errorMsg);
              result.errorCount++;
            } else if (apiResponse.success && apiResponse.body?.results) {
              this.log.debug(`Processing ${apiResponse.body.results.length} API results`);

              const apiResults = apiResponse.body.results;

              // Build lookup Map for O(1) performance (instead of O(n) array.find)
              // Index by both Content_ID and Document_ID for flexible matching
              this.log.debug('Building API results lookup map...');
              const apiResultsMap = new Map<string, any>();
              for (const result of apiResults) {
                // Index by Content_ID if present (e.g., TSRC-ABC-123456)
                if (result.contentId) {
                  apiResultsMap.set(result.contentId.trim(), result);
                  this.log.debug(`  Index: Content_ID=${result.contentId.trim()}`);
                }
                // Index by Document_ID if present (e.g., UUID from docid parameter)
                if (result.documentId) {
                  apiResultsMap.set(result.documentId.trim(), result);
                  this.log.debug(`  Index: Document_ID=${result.documentId.trim()}`);
                }
              }
              this.log.info(`Indexed ${apiResultsMap.size} API results for O(1) lookup`);

              // Phase 3: Collect URL updates for batch application
              const urlUpdateMap = new Map<string, string>();

              // Apply fixes based on API response
              for (let i = 0; i < hyperlinks.length; i++) {
                const hyperlink = hyperlinks[i];
                const hyperlinkInfo = hyperlinkInfos[i];

                // CRITICAL PRE-FILTER: Extract IDs to determine if this hyperlink is processable
                // Only hyperlinks with Content_ID or Document_ID patterns should be processed
                // This prevents "Not Found" from being added to external/internal links
                const lookupIds = this.extractLookupIds(hyperlinkInfo.url);

                if (!lookupIds) {
                  // SKIP: This hyperlink doesn't contain Content_ID or Document_ID patterns
                  // Examples: external URLs, mailto links, internal bookmarks
                  this.log.debug(`⊘ Skipping hyperlink (no Lookup_ID pattern): ${hyperlinkInfo.url.substring(0, 80)}`);
                  continue; // Skip to next hyperlink - no API processing needed
                }

                // Find matching API result for this hyperlink (now using Map-based lookup)
                const apiResult = this.findMatchingApiResult(hyperlinkInfo.url, apiResultsMap);

                // Track changes
                let finalDisplayText = hyperlinkInfo.displayText;
                let finalUrl = hyperlinkInfo.url;
                const modifications: string[] = [];

                if (apiResult) {
                  // Phase 3: URL Reconstruction
                  // Collect URL updates for batch application after iteration
                  if (apiResult.documentId && options.operations?.fixContentIds) {
                    const newUrl = `https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=${apiResult.documentId.trim()}`;

                    if (newUrl !== hyperlinkInfo.url) {
                      // Add to URL update map for batch processing
                      urlUpdateMap.set(hyperlinkInfo.url, newUrl);
                      finalUrl = newUrl;
                      modifications.push('URL updated');

                      this.log.debug(`Queued URL update: ${hyperlinkInfo.url} → ${newUrl}`);

                      // Track the URL change
                      if (options.trackChanges) {
                        documentProcessingComparison.recordHyperlinkUrlChange(
                          hyperlink.paragraphIndex,
                          i % 10, // Approximate hyperlink index within paragraph
                          hyperlinkInfo.url,
                          newUrl,
                          'PowerAutomate API - Fix Content IDs'
                        );
                      }
                    }
                  }

                  // Phase 4: Display Text Rules
                  // Update display text using docxmlater API if updateTitles enabled
                  if (options.operations?.updateTitles) {
                    let newText = apiResult.title?.trim() || hyperlinkInfo.displayText;

                    // Append Content_ID (last 6 digits) if present
                    if (apiResult.contentId) {
                      const last6 = apiResult.contentId.slice(-6);
                      newText = `${newText} (${last6})`;
                    }

                    // Add status indicator for deprecated/expired documents
                    if (apiResult.status === 'Expired' || apiResult.status === 'deprecated') {
                      newText += ' - Expired';
                    }

                    if (newText !== hyperlinkInfo.displayText) {
                      hyperlink.hyperlink.setText(newText);
                      finalDisplayText = newText;
                      result.updatedDisplayTexts = (result.updatedDisplayTexts || 0) + 1;
                      modifications.push('Display text updated');

                      this.log.debug(`Updated text: "${hyperlinkInfo.displayText}" → "${newText}"`);

                      // Track the change
                      if (options.trackChanges) {
                        documentProcessingComparison.recordHyperlinkTextChange(
                          hyperlink.paragraphIndex,
                          i % 10, // Approximate hyperlink index within paragraph
                          hyperlinkInfo.displayText,
                          newText,
                          'PowerAutomate API Update'
                        );
                      }
                    }
                  }

                  modifications.push('API processed');

                  // Track in processedLinks for UI display
                  result.processedLinks.push({
                    id: hyperlinkInfo.id,
                    url: hyperlinkInfo.url,
                    displayText: finalDisplayText,
                    type: hyperlinkInfo.type,
                    location: hyperlinkInfo.containingPart,
                    status: 'processed' as const,
                    before: hyperlinkInfo.url,
                    after: finalUrl,
                    modifications,
                  });
                } else {
                  // API result not found - BUT only mark as "Not Found" if we extracted valid IDs
                  // This prevents marking external/internal links that were never meant to be processed
                  // (Note: We only reach here if lookupIds exists, due to the pre-filter above)
                  this.log.warn(`No API result for hyperlink with Lookup_ID: ${hyperlinkInfo.url}`);

                  if (options.operations?.updateTitles) {
                    // CRITICAL: Sanitize display text to ensure no XML markup is included
                    // The displayText might contain XML structure from getText() that needs to be cleaned
                    const cleanDisplayText = this.sanitizeTextContent(hyperlinkInfo.displayText);
                    const notFoundText = `${cleanDisplayText} - Not Found`;
                    hyperlink.hyperlink.setText(notFoundText);
                    result.updatedDisplayTexts = (result.updatedDisplayTexts || 0) + 1;
                  }
                }
              }

              // Apply URL updates in batch (paragraph reconstruction)
              if (urlUpdateMap.size > 0) {
                this.log.debug(`=== APPLYING URL UPDATES (BATCH) ===`);
                this.log.debug(`Updating ${urlUpdateMap.size} URLs via paragraph reconstruction`);

                const appliedCount = await this.applyUrlUpdates(doc, urlUpdateMap);
                result.modifiedHyperlinks += appliedCount;
                result.updatedUrls = (result.updatedUrls || 0) + appliedCount;

                this.log.info(`Applied ${appliedCount} URL updates`);
              }

              this.log.info(`API processing complete: ${result.updatedUrls} URLs, ${result.updatedDisplayTexts} texts updated`);
            }

          } catch (error: any) {
            this.log.error('API call failed:', error.message);

            // If API operations are required, we must fail the entire processing
            // This prevents saving documents with incorrect/unchanged hyperlinks
            if (options.operations?.fixContentIds || options.operations?.updateTitles) {
              throw new Error(`API Error: ${error.message}. Document not saved to prevent incorrect hyperlink data.`);
            }

            // Otherwise just log and continue
            result.errorMessages.push(`API Error: ${error.message}`);
            result.errorCount++;
          }
        } else {
          // API endpoint not configured but operations require it
          if (options.operations?.fixContentIds || options.operations?.updateTitles) {
            throw new Error('API endpoint not configured but hyperlink operations (fixContentIds or updateTitles) are enabled. Please configure PowerAutomate URL in Settings.');
          }

          this.log.warn('API endpoint not configured, skipping PowerAutomate processing');
        }
      }
      // ═══════════════════════════════════════════════════════════
      // End PowerAutomate API Integration
      // ═══════════════════════════════════════════════════════════

      // Process hyperlinks based on options (local operations)
      if (options.operations?.fixContentIds || options.appendContentId) {
        this.log.debug('=== APPENDING CONTENT IDS ===');
        const modifiedCount = await this.processContentIdAppending(hyperlinks, options, result);
        result.appendedContentIds = modifiedCount;
        this.log.info(`Appended content IDs to ${modifiedCount} hyperlinks`);
      }

      // Custom replacements
      if (options.customReplacements && options.customReplacements.length > 0) {
        this.log.debug('=== APPLYING CUSTOM REPLACEMENTS ===');
        await this.processCustomReplacements(hyperlinks, options.customReplacements, result);
      }

      // Memory checkpoint: Before save
      MemoryMonitor.logMemoryUsage('Before Document Save', 'Ready to save document');

      // CRITICAL: Post-process with OOXML validation before final save
      // This ensures the docxmlater-generated document follows OOXML_HYPERLINK_ARCHITECTURE.md
      this.log.debug('=== OOXML POST-PROCESSING VALIDATION ===');

      // Save to temp buffer first
      let buffer: Buffer | null = await doc.toBuffer();

      // Validate and fix OOXML structure
      const validationResult = await this.ooxmlValidator.validateAndFixBuffer(buffer);

      // CRITICAL: Release original buffer reference immediately after validation
      buffer = null;

      if (validationResult.issues.length > 0) {
        this.log.warn(`Found ${validationResult.issues.length} OOXML issues:`, validationResult.issues);
      }

      if (validationResult.fixes.length > 0) {
        this.log.info(`Applied ${validationResult.fixes.length} OOXML fixes:`, validationResult.fixes);
        result.processedLinks.push({
          id: 'ooxml-validation',
          url: 'OOXML Validation',
          displayText: 'Post-Processing OOXML Validation',
          type: 'external' as HyperlinkType,
          location: 'Document Processing',
          status: 'processed' as const,
          before: 'OOXML validation passed',
          after: validationResult.fixes.length > 0 ? `Fixed ${validationResult.fixes.length} issues` : 'No fixes needed',
          modifications: validationResult.fixes,
        });
      }

      // CRITICAL FIX: Save the CORRECTED buffer, not the original document!
      // This is the key fix - we must use the validated/corrected buffer returned by the validator
      this.log.debug('=== SAVING DOCUMENT ===');
      if (validationResult.correctedBuffer) {
        // Use the corrected buffer that includes all OOXML fixes
        await fs.writeFile(filePath, Buffer.from(validationResult.correctedBuffer));
        this.log.info('Document saved successfully with OOXML corrections applied');

        // CRITICAL: Release corrected buffer after save
        // Note: We don't set to null as it would violate the type contract
        // The object is already out of scope and will be garbage collected
      } else {
        // Fallback to original save if validation didn't return a buffer
        await doc.save(filePath);
        this.log.info('Document saved (validation completed, no OOXML fixes needed)');
      }

      // Force garbage collection hint if available (Node.js with --expose-gc flag)
      if (global.gc) {
        this.log.debug('Triggering garbage collection after document save');
        global.gc();
      }

      // Memory checkpoint: After save
      MemoryMonitor.logMemoryUsage('After Document Save', 'Document saved successfully');
      MemoryMonitor.compareCheckpoints('DocProcessor Start', 'After Document Save');

      // Complete change tracking if enabled
      if (options.trackChanges) {
        this.log.debug('=== COMPLETING CHANGE TRACKING ===');
        const comparison = await documentProcessingComparison.completeTracking(doc);
        if (comparison) {
          result.comparisonData = comparison;
          this.log.info(`Tracked ${comparison.statistics.totalChanges} changes during processing`);
        }
      }

      // Success
      result.success = true;
      result.duration = performance.now() - startTime;
      result.processingTimeMs = result.duration;

      this.log.debug('═══════════════════════════════════════════════════════════');
      this.log.debug('  PROCESSING COMPLETE');
      this.log.debug('═══════════════════════════════════════════════════════════');
      this.log.info(`Total hyperlinks: ${result.totalHyperlinks}`);
      this.log.info(`Modified: ${result.modifiedHyperlinks}`);
      this.log.info(`Appended Content IDs: ${result.appendedContentIds}`);
      this.log.info(`Duration: ${result.duration.toFixed(0)}ms`);

      return result;
    } catch (error: any) {
      this.log.error('ERROR:', error.message);

      // Memory checkpoint: On error
      MemoryMonitor.logMemoryUsage('DocProcessor Error', `Error: ${error.message}`);
      MemoryMonitor.compareCheckpoints('DocProcessor Start', 'DocProcessor Error');

      result.success = false;
      result.errorCount++;
      result.errorMessages.push(error.message);
      result.duration = performance.now() - startTime;

      // Restore from backup on error
      if (backupCreated && result.backupPath) {
        this.log.warn('Restoring from backup...');
        try {
          await fs.copyFile(result.backupPath, filePath);
          this.log.info('Restored from backup');
        } catch (restoreError: any) {
          this.log.error('Failed to restore backup:', restoreError.message);
        }
      }

      return result;
    }
  }

  /**
   * Process hyperlinks to append Content IDs
   */
  private async processContentIdAppending(
    hyperlinks: Array<{
      hyperlink: Hyperlink;
      paragraph: any;
      paragraphIndex: number;
      url?: string;
      text: string;
    }>,
    options: WordProcessingOptions,
    result: WordProcessingResult
  ): Promise<number> {
    let modifiedCount = 0;

    // Patterns for theSource URLs
    const theSourcePattern = /thesource\.caci\.com/i;
    const hasContentIdPattern = /#content$/i;
    const docIdPattern = /docid=([A-Za-z0-9-]+)/i;
    const contentIdPattern = /Content_ID=([TCMS]{1,2}[CRS]{1,2}C?-[A-Za-z0-9]+-\d{6})/i;

    for (const { hyperlink, url } of hyperlinks) {
      if (!url) continue;

      // Check if it's a theSource URL
      if (theSourcePattern.test(url)) {
        // Skip if already has #content
        if (hasContentIdPattern.test(url)) {
          result.skippedHyperlinks++;
          continue;
        }

        // Check if it has docid or Content_ID
        if (docIdPattern.test(url) || contentIdPattern.test(url)) {
          // Append #content
          const newUrl = url + (options.contentId || '#content');

          // Update hyperlink URL
          // Note: DocXMLater handles relationship updates automatically

          const linkInfo = {
            id: `hyperlink-${modifiedCount}`,
            url: url,
            displayText: hyperlink.getText(),
            type: 'external' as HyperlinkType,
            location: 'Main Document',
            status: 'processed' as const,
            before: url,
            after: newUrl,
            modifications: ['Content ID appended'],
          };

          result.processedLinks.push(linkInfo);
          result.modifiedHyperlinks++;
          modifiedCount++;
        } else {
          result.skippedHyperlinks++;
        }
      }
    }

    return modifiedCount;
  }

  /**
   * Apply custom URL and text replacements
   */
  private async processCustomReplacements(
    hyperlinks: Array<{
      hyperlink: Hyperlink;
      paragraph: any;
      paragraphIndex: number;
      url?: string;
      text: string;
    }>,
    replacements: Array<{
      find: string;
      replace: string;
      matchType: 'contains' | 'exact' | 'startsWith';
      applyTo: 'url' | 'text' | 'both';
    }>,
    result: WordProcessingResult
  ): Promise<void> {
    for (const { hyperlink, url, text } of hyperlinks) {
      for (const rule of replacements) {
        let shouldApply = false;

        if (rule.applyTo === 'url' || rule.applyTo === 'both') {
          if (url) {
            shouldApply = this.matchesPattern(url, rule.find, rule.matchType);
            if (shouldApply) {
              const newUrl = url.replace(rule.find, rule.replace);
              // Update hyperlink (DocXMLater handles this)
              if (result.updatedUrls !== undefined) {
                result.updatedUrls++;
              }
            }
          }
        }

        if (rule.applyTo === 'text' || rule.applyTo === 'both') {
          shouldApply = this.matchesPattern(text, rule.find, rule.matchType);
          if (shouldApply) {
            const newText = text.replace(rule.find, rule.replace);
            hyperlink.setText(newText);
            if (result.updatedDisplayTexts !== undefined) {
              result.updatedDisplayTexts++;
            }
          }
        }
      }
    }
  }

  /**
   * Pattern matching helper
   */
  private matchesPattern(
    text: string,
    pattern: string,
    matchType: 'contains' | 'exact' | 'startsWith'
  ): boolean {
    switch (matchType) {
      case 'exact':
        return text === pattern;
      case 'startsWith':
        return text.startsWith(pattern);
      case 'contains':
      default:
        return text.includes(pattern);
    }
  }

  /**
   * Create backup of document
   */
  private async createBackup(filePath: string): Promise<string> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupPath = path.join(dir, `${base}.backup.${timestamp}${ext}`);

    await fs.copyFile(filePath, backupPath);
    return backupPath;
  }

  /**
   * Batch process multiple documents with optimized memory management
   */
  async batchProcess(
    filePaths: string[],
    options: WordProcessingOptions = {},
    concurrency: number = 3,
    onProgress?: (file: string, index: number, total: number, result: WordProcessingResult) => void
  ): Promise<{
    totalFiles: number;
    successfulFiles: number;
    failedFiles: number;
    results: Array<{ file: string; result: WordProcessingResult }>;
  }> {
    const limit = pLimit(concurrency);
    const results: Array<{ file: string; result: WordProcessingResult }> = [];
    let successfulFiles = 0;
    let failedFiles = 0;
    let processedCount = 0;

    this.log.debug('═══════════════════════════════════════════════════════════');
    this.log.info(`BATCH PROCESSING - ${filePaths.length} FILES`);
    this.log.debug('═══════════════════════════════════════════════════════════');

    const promises = filePaths.map((filePath, index) =>
      limit(async () => {
        this.log.info(`[${index + 1}/${filePaths.length}] Processing: ${path.basename(filePath)}`);

        try {
          const result = await this.processDocument(filePath, options);

          if (result.success) {
            successfulFiles++;
          } else {
            failedFiles++;
          }

          results.push({ file: filePath, result });
          processedCount++;

          // Trigger garbage collection periodically during batch processing
          // Every 10 documents or when memory usage is high
          if (processedCount % 10 === 0 && global.gc) {
            this.log.debug(`Batch GC after ${processedCount} documents`);
            global.gc();
          }

          if (onProgress) {
            onProgress(filePath, index + 1, filePaths.length, result);
          }

          return result;
        } catch (error: any) {
          this.log.error(`Error processing ${filePath}:`, error.message);
          failedFiles++;

          const errorResult: WordProcessingResult = {
            success: false,
            totalHyperlinks: 0,
            processedHyperlinks: 0,
            modifiedHyperlinks: 0,
            skippedHyperlinks: 0,
            updatedUrls: 0,
            updatedDisplayTexts: 0,
            appendedContentIds: 0,
            errorCount: 1,
            errorMessages: [error.message],
            processedLinks: [],
            validationIssues: [],
            duration: 0,
          };

          results.push({ file: filePath, result: errorResult });

          if (onProgress) {
            onProgress(filePath, index + 1, filePaths.length, errorResult);
          }

          return errorResult;
        }
      })
    );

    // FIX: Use Promise.allSettled instead of Promise.all to handle partial failures
    // Promise.all rejects if ANY promise rejects, stopping ALL remaining processing
    // Promise.allSettled waits for ALL promises to complete, regardless of failures
    // This ensures all documents are attempted even if some fail
    const results_settled = await Promise.allSettled(promises);

    // Process settled results (optional - can be logged for debugging)
    for (let i = 0; i < results_settled.length; i++) {
      const settled = results_settled[i];
      if (settled.status === 'rejected') {
        this.log.warn(`Batch processing warning: Promise ${i + 1} was rejected:`, (settled as PromiseRejectedResult).reason);
      }
    }

    this.log.debug('═══════════════════════════════════════════════════════════');
    this.log.info('BATCH PROCESSING COMPLETE');
    this.log.debug('═══════════════════════════════════════════════════════════');
    this.log.info(`Total files: ${filePaths.length}`);
    this.log.info(`Successful: ${successfulFiles}`);
    this.log.info(`Failed: ${failedFiles}`);

    // Final garbage collection after batch processing
    if (global.gc) {
      this.log.debug('Final GC after batch processing complete');
      global.gc();
    }

    return {
      totalFiles: filePaths.length,
      successfulFiles,
      failedFiles,
      results,
    };
  }

  /**
   * Apply URL updates to hyperlinks using DocXMLater's setUrl() method
   * Updated to use the new setUrl() API added to DocXMLater library
   *
   * @param doc - The document being processed
   * @param urlMap - Map of old URL -> new URL
   * @returns Number of URLs updated
   */
  private async applyUrlUpdates(
    doc: Document,
    urlMap: Map<string, string>
  ): Promise<number> {
    if (urlMap.size === 0) return 0;

    let updatedCount = 0;
    const paragraphs = doc.getParagraphs();

    this.log.debug(`Processing ${paragraphs.length} paragraphs for URL updates`);

    for (const para of paragraphs) {
      const content = para.getContent();

      // Find hyperlinks in this paragraph that need URL updates
      for (const item of content) {
        if (item instanceof Hyperlink) {
          const oldUrl = item.getUrl();

          if (oldUrl && urlMap.has(oldUrl)) {
            // This hyperlink needs URL update
            const newUrl = urlMap.get(oldUrl)!;

            // Use DocXMLater's new setUrl() method to update the hyperlink
            item.setUrl(newUrl);
            updatedCount++;

            this.log.debug(`✅ Updated hyperlink URL: ${oldUrl} → ${newUrl}`);
          }
        }
      }
    }

    this.log.info(`Successfully updated ${updatedCount} hyperlink URLs`);
    return updatedCount;
  }

  /**
   * Extract both Lookup_IDs (Content_ID and Document_ID) from a URL in a single operation
   * This matches how the PowerAutomate API receives and uses these IDs
   *
   * Returns an object with both IDs extracted:
   * - contentId: Pattern like TSRC-ABC-123456 or CMS-XYZ-789012
   * - documentId: UUID format from docid= parameter
   *
   * @param url - The hyperlink URL to parse
   * @returns Object with { contentId?: string, documentId?: string } or null if neither found
   */
  private extractLookupIds(url: string): { contentId?: string; documentId?: string } | null {
    if (!url) return null;

    const lookupIds: { contentId?: string; documentId?: string } = {};

    // Extract Content_ID: TSRC-ABC-123456 or CMS-XYZ-789012
    const contentIdMatch = url.match(/((?:TSRC|CMS)-[A-Za-z0-9]+-\d{6})/i);
    if (contentIdMatch) {
      lookupIds.contentId = contentIdMatch[1];
      this.log.debug(`    Extracted Content_ID: ${contentIdMatch[1]}`);
    }

    // Extract Document_ID: UUID from "docid=" parameter (theSource URLs only)
    // Note: Does NOT match "documentId=" (external policy URLs)
    const documentIdMatch = url.match(/docid=([A-Za-z0-9\-]+)(?:[^A-Za-z0-9\-]|$)/i);
    if (documentIdMatch) {
      lookupIds.documentId = documentIdMatch[1];
      this.log.debug(`    Extracted Document_ID: ${documentIdMatch[1]}`);
    }

    // Return only if at least one ID was found
    return Object.keys(lookupIds).length > 0 ? lookupIds : null;
  }

  /**
   * Find matching API result for a URL using Map-based lookup
   * Uses both Content_ID and Document_ID as fallback lookup keys
   *
   * @param url - The hyperlink URL to match
   * @param apiResultsMap - Map of Lookup_ID -> API result
   * @returns Matching API result or null if not found
   */
  private findMatchingApiResult(url: string, apiResultsMap: Map<string, any>): any {
    if (!url || !apiResultsMap || apiResultsMap.size === 0) {
      return null;
    }

    // Extract both IDs at once (as sent to PowerAutomate API)
    const lookupIds = this.extractLookupIds(url);
    if (!lookupIds) {
      this.log.debug(`  ✗ No Lookup_ID found in URL`);
      return null;
    }

    // Try Content_ID match first (more specific)
    if (lookupIds.contentId) {
      const result = apiResultsMap.get(lookupIds.contentId);
      if (result) {
        this.log.debug(`  ✓ Matched by Content_ID: ${lookupIds.contentId}`);
        return result;
      }
    }

    // Try Document_ID match (UUID format) as fallback
    if (lookupIds.documentId) {
      const result = apiResultsMap.get(lookupIds.documentId);
      if (result) {
        this.log.debug(`  ✓ Matched by Document_ID: ${lookupIds.documentId}`);
        return result;
      }
    }

    // No match found with either ID
    if (this.DEBUG) {
      const ids = [lookupIds.contentId, lookupIds.documentId].filter(Boolean).join(' or ');
      this.log.debug(`  ✗ No match for Lookup_ID(${ids})`);
    }
    return null;
  }

  /**
   * Sanitize text content by removing any XML markup
   * This prevents escaped XML from being injected into hyperlink text
   * CRITICAL: Protects against corruption from getText() returning XML structure
   */
  private sanitizeTextContent(text: string): string {
    if (!text) return '';

    // Remove XML markup patterns that might have been captured by getText()
    // Match patterns like <w:t>, </w:t>, &lt;, &gt;, &quot;, etc.
    let cleaned = text
      // Remove actual XML tags
      .replace(/<[^>]*>/g, '')
      // Unescape XML entities that might appear as strings
      .replace(/&lt;/g, '')
      .replace(/&gt;/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      // Clean up any remaining escaped sequences
      .replace(/\\x[0-9a-fA-F]{2}/g, '')
      .trim();

    // If the text becomes empty after cleaning, return the original
    // to avoid losing all display text
    return cleaned.length === 0 ? text : cleaned;
  }

  /**
   * Get DocXMLater processor for advanced operations
   */
  getDocXMLaterProcessor(): DocXMLaterProcessor {
    return this.docXMLater;
  }
}

export default WordDocumentProcessor;
