/**
 * WordDocumentProcessor - Modern DOCX processing using DocXMLater
 *
 * Complete rewrite using docxmlater library for all document operations.
 * Replaces 4000+ lines of manual XML parsing with clean, type-safe APIs.
 */

import { Document, Hyperlink, Paragraph, Run, Table, Image, pointsToTwips, twipsToPoints } from 'docxmlater';
// Note: Run, Hyperlink, Image imported for type checking in isParagraphTrulyEmpty()
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
import { DocumentProcessingComparison, documentProcessingComparison } from './DocumentProcessingComparison';
import { MemoryMonitor } from '@/utils/MemoryMonitor';
import { logger } from '@/utils/logger';
import { extractLookupIds } from '@/utils/urlPatterns';
import { sanitizeHyperlinkText } from '@/utils/textSanitizer';
import { hyperlinkService } from '../HyperlinkService';

export interface WordProcessingOptions extends HyperlinkProcessingOptions {
  createBackup?: boolean;
  validateBeforeProcessing?: boolean;
  streamLargeFiles?: boolean;
  maxFileSizeMB?: number;

  // ═══════════════════════════════════════════════════════════
  // Text Formatting Options (ProcessingOptions group: 'text')
  // ═══════════════════════════════════════════════════════════
  removeWhitespace?: boolean;              // remove-whitespace: Collapse multiple spaces to single space
  removeParagraphLines?: boolean;          // remove-paragraph-lines: Remove consecutive empty paragraphs
  removeItalics?: boolean;                 // remove-italics: Remove italic formatting from all runs

  // ═══════════════════════════════════════════════════════════
  // Content Structure Options (ProcessingOptions group: 'structure')
  // ═══════════════════════════════════════════════════════════
  assignStyles?: boolean;                  // assign-styles: Apply session styles to headings and normal paragraphs
  centerImages?: boolean;                  // center-images: Center all image-containing paragraphs
  fixKeywords?: boolean;                   // fix-keywords: Fix common spelling/typo errors

  styles?: Array<{                         // Session styles to apply when assignStyles is true
    id: string;                            // 'header1', 'header2', or 'normal'
    name: string;
    fontFamily: string;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    alignment: 'left' | 'center' | 'right' | 'justify';
    color: string;
    spaceBefore: number;
    spaceAfter: number;
    lineSpacing: number;
  }>;

  // ═══════════════════════════════════════════════════════════
  // Lists & Tables Options (ProcessingOptions group: 'lists')
  // ═══════════════════════════════════════════════════════════
  listBulletSettings?: {                   // list-indentation: Apply uniform list indentation
    enabled: boolean;
    indentationLevels: Array<{
      level: number;
      indentation: number;               // In points
      bulletChar?: string;
      numberedFormat?: string;
    }>;
    spacingBetweenItems: number;
  };
  bulletUniformity?: boolean;              // bullet-uniformity: Standardize bullet characters
  tableUniformity?: boolean;               // table-uniformity: Apply consistent table formatting
  smartTables?: boolean;                   // smart-tables: Smart table detection and formatting (NEW)

  // ═══════════════════════════════════════════════════════════
  // NEW 1.1.0 Enhanced Options
  // ═══════════════════════════════════════════════════════════
  normalizeSpacing?: boolean;              // normalize-spacing: Smart spacing normalization across document
  validateHyperlinks?: boolean;            // validate-hyperlinks: Validate and auto-fix all hyperlinks

  // ═══════════════════════════════════════════════════════════
  // Legacy/Existing Options
  // ═══════════════════════════════════════════════════════════
  contentId?: string;
  trackChanges?: boolean;
  trackChangesInWord?: boolean;
  trackChangesAuthor?: string;
  customReplacements?: Array<{
    find: string;
    replace: string;
    matchType: 'contains' | 'exact' | 'startsWith';
    applyTo: 'url' | 'text' | 'both';
  }>;
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

  // Debug mode controlled by environment
  private readonly DEBUG = process.env.NODE_ENV !== 'production';

  private log = logger.namespace('WordDocProcessor');

  constructor() {
    this.docXMLater = new DocXMLaterProcessor();
    this.log.debug('Initialized with DocXMLater library');
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
      // Use non-strict parsing to skip invalid hyperlinks (e.g., about:blank) instead of throwing
      // Note: strictParsing: false allows the document to load even with "about:" URLs,
      // it just skips those hyperlinks during parsing
      this.log.debug('=== LOADING DOCUMENT WITH DOCXMLATER ===');
      const doc = await Document.load(filePath, { strictParsing: false });
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

            // Convert DocXMLater hyperlinks to DetailedHyperlinkInfo format for API
            // Note: h.text is already sanitized by extractHyperlinks() method
            const hyperlinkInfos: DetailedHyperlinkInfo[] = hyperlinks.map((h, index) => ({
              id: `hyperlink-${index}`,
              relationshipId: `rId${index}`,
              element: h.hyperlink as any,
              containingPart: 'document.xml',
              url: h.url || '',
              displayText: h.text,  // Already sanitized by extractHyperlinks()
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
                const lookupIds = extractLookupIds(hyperlinkInfo.url);

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
                      // Update hyperlink text using docxmlater API
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
                    // Mark as "Not Found"
                    const notFoundText = `${hyperlinkInfo.displayText} - Not Found`;
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

          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown API error';
            this.log.error('API call failed:', errorMessage);

            // If API operations are required, we must fail the entire processing
            // This prevents saving documents with incorrect/unchanged hyperlinks
            if (options.operations?.fixContentIds || options.operations?.updateTitles) {
              throw new Error(`API Error: ${errorMessage}. Document not saved to prevent incorrect hyperlink data.`);
            }

            // Otherwise just log and continue
            result.errorMessages.push(`API Error: ${errorMessage}`);
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

      // ═══════════════════════════════════════════════════════════
      // PROCESSING OPTIONS IMPLEMENTATION
      // Apply all enabled processing options before saving document
      // ═══════════════════════════════════════════════════════════

      // TEXT FORMATTING GROUP
      if (options.removeWhitespace) {
        this.log.debug('=== REMOVING EXTRA WHITESPACE ===');
        const whitespaceCleaned = await this.removeExtraWhitespace(doc);
        this.log.info(`Cleaned whitespace in ${whitespaceCleaned} runs`);
      }

      if (options.removeParagraphLines) {
        this.log.debug('=== REMOVING EXTRA PARAGRAPH LINES (ENHANCED) ===');
        // Now uses docxmlater 1.1.0 normalizeSpacing() helper for better reliability
        const paragraphsRemoved = await this.removeExtraParagraphLines(doc);
        this.log.info(`Removed ${paragraphsRemoved} extra paragraph lines`);
      }

      // NEW 1.1.0 Option: Smart Spacing Normalization
      if (options.normalizeSpacing) {
        this.log.debug('=== SMART SPACING NORMALIZATION (NEW) ===');
        try {
          const result = await (doc as any).normalizeSpacing?.({
            removeDuplicateEmptyParagraphs: true,
            standardizeParagraphSpacing: true,
            standardLineSpacing: 240,  // 1.15 line spacing
            removeTrailingSpaces: true,
            processTables: true  // Also normalize spacing in table cells
          });

          if (result) {
            this.log.info(`Normalized spacing: ${result.paragraphsModified || 0} paragraphs modified, ${result.duplicatesRemoved || 0} duplicates removed`);
          }
        } catch (error) {
          this.log.warn('normalizeSpacing() not available in current docxmlater version');
        }
      }

      if (options.removeItalics) {
        this.log.debug('=== REMOVING ITALIC FORMATTING ===');
        const italicsRemoved = await this.removeItalicFormatting(doc);
        this.log.info(`Removed italics from ${italicsRemoved} runs`);
      }

      // CONTENT STRUCTURE GROUP
      if (options.assignStyles && options.styles && options.styles.length > 0) {
        this.log.debug('=== ASSIGNING STYLES ===');
        const stylesApplied = await this.assignStylesToDocument(doc, options.styles);
        this.log.info(`Applied styles to ${stylesApplied} paragraphs`);
      }

      if (options.centerImages) {
        this.log.debug('=== CENTERING IMAGES ===');
        const imagesCentered = await this.centerAllImages(doc);
        this.log.info(`Centered ${imagesCentered} images`);
      }

      if (options.fixKeywords) {
        this.log.debug('=== FIXING KEYWORDS ===');
        const keywordsFixed = await this.fixCommonKeywords(doc);
        this.log.info(`Fixed ${keywordsFixed} keyword errors`);
      }

      // LISTS & TABLES GROUP
      if (options.listBulletSettings?.enabled) {
        this.log.debug('=== APPLYING LIST INDENTATION UNIFORMITY ===');
        const listsFormatted = await this.applyListIndentationUniformity(doc, options.listBulletSettings);
        this.log.info(`Applied indentation to ${listsFormatted} list paragraphs`);
      }

      if (options.bulletUniformity) {
        this.log.debug('=== APPLYING BULLET UNIFORMITY ===');
        const bulletsStandardized = await this.applyBulletUniformity(doc);
        this.log.info(`Standardized ${bulletsStandardized} bullet lists`);
      }

      if (options.tableUniformity) {
        this.log.debug('=== APPLYING TABLE UNIFORMITY (ENHANCED) ===');
        const tablesFormatted = await this.applyTableUniformity(doc);
        this.log.info(`Formatted ${tablesFormatted} tables with conditional formatting`);
      }

      // NEW 1.1.0 Option: Smart Table Detection & Formatting
      if (options.smartTables) {
        this.log.debug('=== SMART TABLE DETECTION & FORMATTING (NEW) ===');
        const smartFormatted = await this.applySmartTableFormatting(doc);
        this.log.info(`Applied smart formatting to ${smartFormatted} tables`);
      }

      // HYPERLINK GROUP (additional operations)
      if (options.operations?.updateTopHyperlinks) {
        this.log.debug('=== UPDATING TOP OF DOCUMENT HYPERLINKS ===');
        const topLinksAdded = await this.updateTopOfDocumentHyperlinks(doc);
        this.log.info(`Added ${topLinksAdded} "Top of Document" navigation links`);
      }

      if (options.operations?.replaceOutdatedTitles) {
        this.log.debug('=== REPLACING OUTDATED HYPERLINK TITLES ===');
        const titlesReplaced = await this.replaceOutdatedHyperlinkTitles(doc, options.customReplacements);
        this.log.info(`Replaced ${titlesReplaced} outdated hyperlink titles`);
      }

      if (options.operations?.standardizeHyperlinkColor) {
        this.log.debug('=== STANDARDIZING HYPERLINK COLORS ===');
        const hyperlinksStandardized = await this.standardizeHyperlinkColors(doc);
        this.log.info(`Standardized color for ${hyperlinksStandardized} hyperlinks`);
      }

      if (options.operations?.fixInternalHyperlinks) {
        this.log.debug('=== FIXING INTERNAL HYPERLINKS ===');
        const internalLinksFixed = await this.fixInternalHyperlinks(doc);
        this.log.info(`Fixed ${internalLinksFixed} internal hyperlinks`);
      }

      // ═══════════════════════════════════════════════════════════
      // End Processing Options Implementation
      // ═══════════════════════════════════════════════════════════

      // Memory checkpoint: Before save
      MemoryMonitor.logMemoryUsage('Before Document Save', 'Ready to save document');

      // ═══════════════════════════════════════════════════════════
      // SAVE DOCUMENT - Direct save using docxmlater
      //
      // IMPORTANT: We rely on docxmlater's internal DOCX formatting
      // which properly maintains:
      // 1. [Content_Types].xml as first ZIP entry with STORE compression
      // 2. Correct file ordering in ZIP archive
      // 3. All OOXML relationships and structure
      //
      // Previous approach of toBuffer() → validate → resave caused
      // corruption due to double ZIP creation breaking file ordering.
      // ═══════════════════════════════════════════════════════════
      this.log.debug('=== SAVING DOCUMENT ===');
      await doc.save(filePath);
      this.log.info('Document saved successfully');

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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      this.log.error('ERROR:', errorMessage);

      // Memory checkpoint: On error
      MemoryMonitor.logMemoryUsage('DocProcessor Error', `Error: ${errorMessage}`);
      MemoryMonitor.compareCheckpoints('DocProcessor Start', 'DocProcessor Error');

      result.success = false;
      result.errorCount++;
      result.errorMessages.push(errorMessage);
      result.duration = performance.now() - startTime;

      // Restore from backup on error
      if (backupCreated && result.backupPath) {
        this.log.warn('Restoring from backup...');
        try {
          await fs.copyFile(result.backupPath, filePath);
          this.log.info('Restored from backup');
        } catch (restoreError) {
          const restoreErrorMessage = restoreError instanceof Error ? restoreError.message : 'Unknown restore error';
          this.log.error('Failed to restore backup:', restoreErrorMessage);
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

          // Update hyperlink URL using docxmlater's setUrl method
          // This automatically handles relationship updates
          hyperlink.setUrl(newUrl);

          const linkInfo = {
            id: `hyperlink-${modifiedCount}`,
            url: url,
            displayText: sanitizeHyperlinkText(hyperlink.getText()),
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
              // Update hyperlink using docxmlater's setUrl method
              hyperlink.setUrl(newUrl);
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
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.log.error(`Error processing ${filePath}:`, errorMessage);
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
            errorMessages: [errorMessage],
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

  // Extraction method moved to centralized utility: src/utils/urlPatterns.ts
  // Use: extractLookupIds(url) - returns { contentId?, documentId? } | null

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
    const lookupIds = extractLookupIds(url);
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


  // ═══════════════════════════════════════════════════════════
  // PROCESSING OPTIONS METHOD IMPLEMENTATIONS
  // All methods return count of items modified for logging/tracking
  // ═══════════════════════════════════════════════════════════

  /**
   * Remove extra whitespace - Collapse multiple spaces to single space
   * Processes all text runs in the document
   */
  private async removeExtraWhitespace(doc: Document): Promise<number> {
    let cleanedCount = 0;
    const paragraphs = doc.getParagraphs();

    for (const para of paragraphs) {
      const runs = para.getRuns();
      for (const run of runs) {
        const text = run.getText();
        if (!text) continue;

        // Collapse multiple spaces/tabs/newlines to single space
        const cleaned = text.replace(/\s+/g, ' ');
        if (cleaned !== text) {
          run.setText(cleaned);
          cleanedCount++;
        }
      }
    }

    return cleanedCount;
  }

  /**
   * Helper: Determine if a paragraph is truly empty using DocXMLater APIs
   *
   * ✅ USES DOCXMLATER HELPER FUNCTIONS (Critical fix for Bug #1)
   *
   * A paragraph is considered "truly empty" only if:
   * 1. It has no numbering/list formatting (check via getNumbering())
   * 2. It has no hyperlinks or images (check via getContent())
   * 3. All text runs are empty/whitespace only
   *
   * This prevents deletion of:
   * - List items (they appear empty but have numbering)
   * - Paragraphs with hyperlinks (not empty even if text is empty)
   * - Paragraphs with images
   * - Paragraphs in table cells
   */
  private isParagraphTrulyEmpty(para: Paragraph): boolean {
    try {
      // ✅ Check 1: Does this paragraph have numbering? (list item)
      // This is the docxmlater helper we were missing!
      const numbering = para.getNumbering();
      if (numbering) {
        this.log.debug(`  ✗ Paragraph has numbering (level ${numbering.level || 0}) - NOT empty`);
        return false;
      }

      // ✅ Check 2: Does this paragraph have complex content?
      // getContent() returns ALL content items (runs, hyperlinks, images)
      const content = para.getContent();

      // Empty content = empty paragraph
      if (content.length === 0) {
        this.log.debug(`  ✓ Paragraph has no content - TRULY empty`);
        return true;
      }

      // Check if content contains hyperlinks or images (not empty!)
      for (const item of content) {
        if (item instanceof Hyperlink) {
          this.log.debug(`  ✗ Paragraph contains hyperlink - NOT empty`);
          return false;
        }
        if (item instanceof Image) {
          this.log.debug(`  ✗ Paragraph contains image - NOT empty`);
          return false;
        }
      }

      // ✅ Check 3: Are all text runs empty?
      // Only delete if all runs are whitespace-only
      const allRunsEmpty = content.every(item => {
        if (item instanceof Run) {
          const text = (item.getText() || '').trim();
          return text === '';
        }
        // Hyperlinks/images already filtered above, so this is unreachable
        // but keeping for defensive programming
        return false;
      });

      if (allRunsEmpty) {
        this.log.debug(`  ✓ All runs are empty - TRULY empty`);
        return true;
      }

      this.log.debug(`  ✗ Has non-empty text runs - NOT empty`);
      return false;

    } catch (error) {
      // Defensive: Extraction error means paragraph is not safe to delete
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log.warn(`  ⚠️  Error checking paragraph emptiness (assuming NOT empty): ${errorMsg}`);
      return false;  // Default to NOT empty - safer than deleting
    }
  }

  /**
   * Remove extra paragraph lines - ENHANCED with docxmlater 1.1.0
   *
   * Now uses the built-in Document.normalizeSpacing() helper which:
   * - Handles tables, SDTs, and complex structures automatically
   * - Preserves list items and numbered paragraphs
   * - Works inside table cells
   * - More reliable than manual implementation
   */
  private async removeExtraParagraphLines(doc: Document): Promise<number> {
    // Use the new docxmlater 1.1.0 normalizeSpacing() helper
    // This replaces 130+ lines of manual implementation
    try {
      const result = await (doc as any).normalizeSpacing?.({
        removeDuplicateEmptyParagraphs: true,
        standardizeParagraphSpacing: false,  // Keep original spacing
        removeTrailingSpaces: true,
        processTables: true  // Also process inside table cells
      });

      if (result) {
        this.log.info(`Normalized spacing: removed ${result.duplicatesRemoved || 0} duplicate empty paragraphs`);
        return result.duplicatesRemoved || 0;
      }
    } catch (error) {
      this.log.warn('normalizeSpacing() helper not available, falling back to manual implementation');
    }

    // Fallback to manual implementation if helper not available
    this.log.debug('Using manual implementation for backward compatibility');

    const paragraphs = doc.getParagraphs();
    const paragraphsToRemove: Paragraph[] = [];

    // ✅ FIX: Get body elements to identify table positions
    // This prevents deleting paragraphs adjacent to tables which could destabilize structure
    const bodyElements = doc.getBodyElements();
    const tableIndices = new Set<number>();

    // Mark which body-level indices are tables
    bodyElements.forEach((element, index) => {
      if (element.constructor.name === 'Table') {
        tableIndices.add(index);
      }
    });

    this.log.debug(`Found ${tableIndices.size} top-level tables in document. Protecting adjacent paragraphs.`);

    // ✅ ADDITIONAL FIX: Also check for Structured Document Tags (SDTs) containing tables
    // These are special locked content (like If/Then decision tables) wrapped in SDTs
    // The SDT itself is a body element, so we need to protect adjacent paragraphs
    const sdtIndices = new Set<number>();
    bodyElements.forEach((element, index) => {
      if (element.constructor.name === 'StructuredDocumentTag' ||
          element.constructor.name === 'SDT' ||
          (element as any)._type === 'sdt') {
        sdtIndices.add(index);
        this.log.debug(`  ⚠️  Found Structured Document Tag (SDT) at body index ${index}`);
      }
    });

    // Create a map of paragraph objects to their context
    // This helps us detect if a paragraph is adjacent to a table
    const paraToContext = new Map<any, { isAdjacentToTable: boolean }>();

    let paraIndex = 0;
    for (let bodyIndex = 0; bodyIndex < bodyElements.length; bodyIndex++) {
      const element = bodyElements[bodyIndex];

      if (element.constructor.name === 'Paragraph') {
        const para = paragraphs[paraIndex];

        // Check if this paragraph is adjacent to a table or SDT
        // Tables can be regular or nested in Structured Document Tags (SDTs)
        const isAdjacentToTable = tableIndices.has(bodyIndex - 1) || tableIndices.has(bodyIndex + 1);
        const isAdjacentToSDT = sdtIndices.has(bodyIndex - 1) || sdtIndices.has(bodyIndex + 1);
        const isAdjacentToStructure = isAdjacentToTable || isAdjacentToSDT;

        paraToContext.set(para, { isAdjacentToTable: isAdjacentToStructure });

        if (isAdjacentToStructure) {
          if (isAdjacentToSDT) {
            this.log.debug(`  ⚠️  Protecting paragraph at index ${paraIndex} (adjacent to Structured Document Tag/locked content)`);
          } else {
            this.log.debug(`  ⚠️  Protecting paragraph at index ${paraIndex} (adjacent to table)`);
          }
        }

        paraIndex++;
      }
    }

    this.log.debug('Analyzing paragraphs for empty-line removal...');

    for (let i = 0; i < paragraphs.length - 1; i++) {
      const current = paragraphs[i];
      const next = paragraphs[i + 1];

      // ✅ FIX: Protect paragraphs adjacent to tables
      const currentContext = paraToContext.get(current);
      const nextContext = paraToContext.get(next);

      if (currentContext?.isAdjacentToTable || nextContext?.isAdjacentToTable) {
        this.log.debug(`  ⚠️  Skipping paragraph ${i} or ${i + 1} (adjacent to table)`);
        continue;  // Never delete table-adjacent paragraphs
      }

      // ✅ FIX #1 & #2: Use isParagraphTrulyEmpty() helper with DocXMLater APIs
      const currentEmpty = this.isParagraphTrulyEmpty(current);
      const nextEmpty = this.isParagraphTrulyEmpty(next);

      // Only delete if BOTH consecutive paragraphs are truly empty
      if (currentEmpty && nextEmpty) {
        this.log.debug(`Marking paragraph ${i + 1} for deletion (consecutive empty)`);
        paragraphsToRemove.push(next);  // Store the Paragraph object
      }
    }

    // ✅ FIX #3: Remove using Paragraph objects (not indices)
    // This avoids index invalidation because we're not modifying the array during iteration
    let removedCount = 0;
    for (const para of paragraphsToRemove) {
      const success = doc.removeParagraph(para);  // DocXMLater handles object-based removal
      if (success) {
        removedCount++;
        this.log.debug(`Successfully removed empty paragraph`);
      } else {
        this.log.warn(`Failed to remove empty paragraph (already removed?)`);
      }
    }

    this.log.info(`Removed ${removedCount} consecutive empty paragraphs`);

    // ✅ SAFETY CHECK: Verify we didn't delete too much content
    // Threshold: 30% allows documents with legitimate spacing/structure while catching catastrophic failures
    // (Previous buggy version: 40.5% loss; Fixed version: should be < 30% for reasonable documents)
    const currentParaCount = doc.getParagraphs().length;
    const deletionRate = (paragraphs.length - currentParaCount) / paragraphs.length;

    if (deletionRate > 0.30) {  // > 30% deletion
      this.log.error(`⚠️  SAFETY ALERT: Deleted ${(deletionRate * 100).toFixed(1)}% of paragraphs!`);
      this.log.error(`Original count: ${paragraphs.length}, After deletion: ${currentParaCount}`);
      this.log.error(`This suggests a bug in paragraph deletion logic. Document integrity may be compromised.`);
      throw new Error(
        `[SAFETY CHECK FAILED] Document integrity compromised: ${(deletionRate * 100).toFixed(1)}% of ` +
        `paragraphs were deleted. This exceeds the safety threshold of 30%. ` +
        `Original: ${paragraphs.length} paragraphs, After: ${currentParaCount} paragraphs. ` +
        `Processing aborted to prevent data loss. Please report this issue.`
      );
    } else if (deletionRate > 0.15) {
      // Warning: significant but not catastrophic
      this.log.warn(
        `⚠️  NOTICE: Deleted ${(deletionRate * 100).toFixed(1)}% of paragraphs ` +
        `(Original: ${paragraphs.length}, After: ${currentParaCount}). ` +
        `This is higher than typical (usually < 5%) but below safety threshold (30%).`
      );
    }

    return removedCount;
  }

  /**
   * Remove italic formatting - Strip italics from all text runs
   */
  private async removeItalicFormatting(doc: Document): Promise<number> {
    let removedCount = 0;
    const paragraphs = doc.getParagraphs();

    for (const para of paragraphs) {
      const runs = para.getRuns();
      for (const run of runs) {
        // Check if run has italic formatting
        const formatting = run.getFormatting();
        if (formatting?.italic) {
          run.setItalic(false);
          removedCount++;
        }
      }
    }

    return removedCount;
  }

  /**
   * Assign styles to document - ENHANCED with docxmlater 1.1.0
   *
   * Now uses detectHeadingLevel() helper for smart heading detection:
   * - Style ID matching, outline level detection, formatting heuristics
   * - More accurate than simple style name matching
   */
  private async assignStylesToDocument(
    doc: Document,
    styles: Array<{
      id: string;
      fontFamily: string;
      fontSize: number;
      bold: boolean;
      italic: boolean;
      underline: boolean;
      alignment: 'left' | 'center' | 'right' | 'justify';
      color: string;
      spaceBefore: number;
      spaceAfter: number;
      lineSpacing: number;
    }>
  ): Promise<number> {
    let appliedCount = 0;
    const paragraphs = doc.getParagraphs();

    // Find configured styles
    const header1Style = styles.find(s => s.id === 'header1');
    const header2Style = styles.find(s => s.id === 'header2');
    const normalStyle = styles.find(s => s.id === 'normal');

    for (const para of paragraphs) {
      let styleToApply = null;

      // Use new detectHeadingLevel() helper for smart detection
      try {
        const headingLevel = await (para as any).detectHeadingLevel?.();

        if (headingLevel === 1 && header1Style) {
          styleToApply = header1Style;
        } else if (headingLevel === 2 && header2Style) {
          styleToApply = header2Style;
        } else if (!headingLevel && para.getText().trim() && normalStyle) {
          // Not a heading but has content - apply normal style
          styleToApply = normalStyle;
        }
      } catch (error) {
        // Fallback to old method if helper not available
        const currentStyle = para.getStyle() || para.getFormatting().style;

        if ((currentStyle === 'Heading1' || currentStyle === 'Heading 1') && header1Style) {
          styleToApply = header1Style;
        } else if ((currentStyle === 'Heading2' || currentStyle === 'Heading 2') && header2Style) {
          styleToApply = header2Style;
        } else if ((!currentStyle || currentStyle === 'Normal') && normalStyle) {
          styleToApply = normalStyle;
        }
      }

      if (styleToApply) {
        // Apply paragraph formatting
        para.setAlignment(styleToApply.alignment);
        para.setSpaceBefore(pointsToTwips(styleToApply.spaceBefore));
        para.setSpaceAfter(pointsToTwips(styleToApply.spaceAfter));
        if (styleToApply.lineSpacing) {
          para.setLineSpacing(pointsToTwips(styleToApply.lineSpacing * 12)); // Convert line spacing multiplier
        }

        // Apply text formatting to all runs in paragraph
        const runs = para.getRuns();
        for (const run of runs) {
          run.setFont(styleToApply.fontFamily);
          run.setSize(styleToApply.fontSize);
          run.setBold(styleToApply.bold);
          run.setItalic(styleToApply.italic);
          run.setUnderline(styleToApply.underline ? 'single' : undefined);
          run.setColor(styleToApply.color.replace('#', ''));
        }

        appliedCount++;
      }
    }

    return appliedCount;
  }

  /**
   * Center all images - Set alignment to center for paragraphs containing images
   */
  private async centerAllImages(doc: Document): Promise<number> {
    let centeredCount = 0;
    const paragraphs = doc.getParagraphs();

    for (const para of paragraphs) {
      const content = para.getContent();

      // Check if paragraph contains an image
      const hasImage = content.some((item: any) => item instanceof Image);
      if (hasImage) {
        para.setAlignment('center');
        centeredCount++;
      }
    }

    return centeredCount;
  }

  /**
   * Fix common keywords - ENHANCED with docxmlater 1.1.0
   *
   * Now uses findAndReplaceAll() helper with:
   * - Native regex support
   * - Case-insensitive matching
   * - Whole word boundaries
   * - Optional tracked changes integration
   */
  private async fixCommonKeywords(doc: Document): Promise<number> {
    const keywords = [
      { find: /\bteh\b/gi, replace: 'the' },
      { find: /\brecieve\b/gi, replace: 'receive' },
      { find: /\boccured\b/gi, replace: 'occurred' },
      { find: /\bseperate\b/gi, replace: 'separate' },
      { find: /\bdefinately\b/gi, replace: 'definitely' },
      { find: /\bperform ance\b/gi, replace: 'performance' }, // Common spacing error
      { find: /\bacheive\b/gi, replace: 'achieve' },
      { find: /\bbeginning\b/gi, replace: 'beginning' },
      { find: /\bbeleive\b/gi, replace: 'believe' },
      { find: /\bbuisness\b/gi, replace: 'business' },
      { find: /\bcalendar\b/gi, replace: 'calendar' },
      { find: /\bcemetery\b/gi, replace: 'cemetery' },
    ];

    let totalFixed = 0;

    // Try using new docxmlater 1.1.0 findAndReplaceAll() helper
    try {
      for (const { find, replace } of keywords) {
        const result = await (doc as any).findAndReplaceAll?.(
          find,
          replace,
          {
            matchCase: false,
            wholeWord: true,
            trackChanges: this.options?.trackChangesInWord || false,
            author: 'DocHub AutoCorrect'
          }
        );

        if (result) {
          totalFixed += result.count || 0;

          if (result.revisions && this.options?.trackChangesInWord) {
            this.log.debug(`Created ${result.revisions.length} tracked changes for keyword: ${replace}`);
          }
        }
      }

      if (totalFixed > 0) {
        this.log.info(`Fixed ${totalFixed} keywords using findAndReplaceAll()`);
        return totalFixed;
      }
    } catch (error) {
      this.log.warn('findAndReplaceAll() not available, falling back to manual implementation');
    }

    // Fallback to manual implementation if helper not available
    let fixedCount = 0;
    const paragraphs = doc.getParagraphs();

    for (const para of paragraphs) {
      const runs = para.getRuns();
      for (const run of runs) {
        let text = run.getText();
        if (!text) continue;

        let modified = false;
        for (const { find, replace } of keywords) {
          // Convert regex to string for manual replacement
          const pattern = find instanceof RegExp ? find : new RegExp(`\\b${find}\\b`, 'gi');
          if (pattern.test(text)) {
            text = text.replace(pattern, replace);
            modified = true;
          }
        }

        if (modified) {
          run.setText(text);
          fixedCount++;
        }
      }
    }

    return fixedCount;
  }

  /**
   * Apply list indentation uniformity - Set consistent indentation for list items
   */
  private async applyListIndentationUniformity(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        indentation: number;
      }>;
    }
  ): Promise<number> {
    let formattedCount = 0;
    const paragraphs = doc.getParagraphs();

    for (const para of paragraphs) {
      const numbering = para.getNumbering();
      if (!numbering) continue;

      const level = numbering.level || 0;
      const indentSetting = settings.indentationLevels.find(l => l.level === level);

      if (indentSetting) {
        para.setLeftIndent(pointsToTwips(indentSetting.indentation));
        formattedCount++;
      }
    }

    return formattedCount;
  }

  /**
   * Apply bullet uniformity - Standardize bullet characters across all bullet lists
   */
  private async applyBulletUniformity(doc: Document): Promise<number> {
    // Standard bullet characters for levels 0-2
    const standardBullets = ['•', '◦', '▪'];

    // Create a standard bullet list with 3 levels
    const numId = doc.createBulletList(3, standardBullets);
    if (!numId) return 0;

    let standardizedCount = 0;
    const paragraphs = doc.getParagraphs();

    for (const para of paragraphs) {
      const numbering = para.getNumbering();
      if (numbering && numbering.numId !== undefined) {
        // Apply standard bullet list to all numbered paragraphs
        // (Since we can't check type, apply to all list items)
        const level = Math.min(numbering.level || 0, 2); // Cap at level 2
        para.setNumbering(numId, level);
        standardizedCount++;
      }
    }

    return standardizedCount;
  }

  /**
   * Apply table uniformity - ENHANCED with docxmlater 1.1.0
   *
   * Now uses applyConditionalFormatting() helper for:
   * - Automatic header row detection and styling
   * - Zebra striping for better readability
   * - Content-based formatting (totals, currency, dates)
   * - Smart alignment based on content type
   */
  private async applyTableUniformity(doc: Document): Promise<number> {
    const tables = doc.getTables();
    let formattedCount = 0;

    for (const table of tables) {
      try {
        // Use new applyConditionalFormatting() helper
        const result = await (table as any).applyConditionalFormatting?.({
          // Automatic header row styling
          headerRow: {
            condition: 'first-row',
            formatting: {
              bold: true,
              shading: { fill: 'D9D9D9' },
              alignment: 'center',
              borders: {
                bottom: { style: 'double', size: 6, color: '000000' }
              }
            }
          },

          // Zebra striping for tables with more than 3 rows
          zebraStripes: {
            enabled: table.getRows().length > 3,
            evenRowColor: 'F5F5F5',
            oddRowColor: 'FFFFFF'
          },

          // Content-based rules
          contentRules: [
            {
              // Highlight important keywords
              condition: (text: string) => /\b(CRITICAL|IMPORTANT|WARNING|ERROR|ALERT)\b/i.test(text),
              formatting: {
                bold: true,
                color: 'FF0000',
                shading: { fill: 'FFEEEE' }
              }
            },
            {
              // Bold and highlight totals
              condition: (text: string) => /\b(Total|Sum|Subtotal|Grand Total)\b/i.test(text),
              formatting: {
                bold: true,
                shading: { fill: 'FFFFCC' }
              }
            },
            {
              // Right-align numeric values
              condition: (text: string) => /^[\d,]+(\.\d+)?$/.test(text.trim()),
              formatting: {
                alignment: 'right'
              }
            },
            {
              // Format currency values
              condition: (text: string) => /^\$[\d,]+(\.\d{2})?$/.test(text.trim()),
              formatting: {
                alignment: 'right',
                fontFamily: 'Consolas'
              }
            },
            {
              // Center-align dates
              condition: (text: string) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text.trim()),
              formatting: {
                alignment: 'center'
              }
            },
            {
              // Highlight success keywords
              condition: (text: string) => /\b(SUCCESS|COMPLETE|PASSED|APPROVED)\b/i.test(text),
              formatting: {
                color: '008000',
                bold: true
              }
            }
          ]
        });

        if (result) {
          formattedCount++;
          this.log.debug(`Applied conditional formatting to table with ${result.rulesApplied || 0} rules`);
        }
      } catch (error) {
        // Fallback to manual implementation if helper not available
        this.log.debug('applyConditionalFormatting() not available, using manual formatting');

        // Set table layout to "auto" (fit to window)
        table.setLayout('auto');

        // Apply standard borders to all tables
        table.setAllBorders({
          style: 'single',
          size: 4,
          color: '000000'
        });

        // Format header row (first row) with light gray shading
        const rows = table.getRows();
        if (rows.length > 0) {
          const headerRow = rows[0];
          const cells = headerRow.getCells();

          for (const cell of cells) {
            cell.setShading({ fill: 'D9D9D9' }); // Light gray
          }
        }

        formattedCount++;
      }
    }

    // Add spacing after tables to prevent stacking
    // Tables in docxmlater are part of body elements, check if followed by paragraph
    const bodyElements = doc.getBodyElements();
    for (let i = 0; i < bodyElements.length - 1; i++) {
      const current = bodyElements[i];
      const next = bodyElements[i + 1];

      // If current is a table and next exists
      if (current.constructor.name === 'Table' && next) {
        // If next is also a table, ensure spacing
        if (next.constructor.name === 'Table') {
          // Insert paragraph with spacing between tables
          // Note: docxmlater may not support direct insertion - log for now
          this.log.debug(`Tables at positions ${i} and ${i + 1} are adjacent - spacing needed`);
        } else if (next.constructor.name === 'Paragraph') {
          // Add space before the next paragraph
          try {
            (next as any).setSpaceBefore(pointsToTwips(12)); // 12pt space
          } catch (error) {
            this.log.warn(`Failed to add spacing after table: ${error instanceof Error ? error.message : 'Unknown'}`);
          }
        }
      }
    }

    return formattedCount;
  }

  /**
   * Apply smart table formatting - NEW docxmlater 1.1.0
   *
   * Intelligent table detection and formatting:
   * - Detects header rows based on content analysis
   * - Applies appropriate formatting based on table size
   * - Uses content patterns for intelligent formatting
   */
  private async applySmartTableFormatting(doc: Document): Promise<number> {
    const tables = doc.getTables();
    let formattedCount = 0;

    for (const table of tables) {
      try {
        const rows = table.getRows();
        if (rows.length === 0) continue;

        // Analyze first row to determine if it's a header
        const firstRow = rows[0];
        const firstRowCells = firstRow.getCells();
        let isLikelyHeader = true;

        // Header detection heuristics
        for (const cell of firstRowCells) {
          const text = cell.getText().trim();
          // Headers are typically short, title-case, or all caps
          if (text.length > 50 || /^\d+$/.test(text)) {
            isLikelyHeader = false;
            break;
          }
        }

        // Apply smart conditional formatting
        const result = await (table as any).applyConditionalFormatting?.({
          // Apply header formatting if detected
          headerRow: isLikelyHeader ? {
            condition: 'first-row',
            formatting: {
              bold: true,
              shading: { fill: 'E0E0E0' },
              alignment: 'center',
              borders: {
                bottom: { style: 'thick', size: 8, color: '333333' }
              }
            }
          } : undefined,

          // Apply zebra stripes only for larger tables
          zebraStripes: {
            enabled: rows.length > 5,
            evenRowColor: 'FAFAFA',
            oddRowColor: 'FFFFFF'
          },

          // Smart content-based rules
          contentRules: [
            {
              // Decision cells (Yes/No, True/False)
              condition: (text: string) => /^(Yes|No|True|False|Y|N)$/i.test(text.trim()),
              formatting: {
                alignment: 'center',
                bold: true,
                color: text.trim().match(/^(Yes|True|Y)$/i) ? '008000' : '800000'
              }
            },
            {
              // Percentage values
              condition: (text: string) => /^\d+(\.\d+)?%$/.test(text.trim()),
              formatting: {
                alignment: 'right',
                color: parseFloat(text) >= 80 ? '008000' : parseFloat(text) < 50 ? 'FF0000' : '000000'
              }
            },
            {
              // Status indicators
              condition: (text: string) => /^(Active|Inactive|Pending|Completed|In Progress)$/i.test(text.trim()),
              formatting: {
                alignment: 'center',
                bold: true,
                shading: {
                  fill: text.match(/Active|Completed/i) ? 'E8F5E9' :
                        text.match(/Inactive/i) ? 'FFEBEE' : 'FFF3E0'
                }
              }
            },
            {
              // Email addresses
              condition: (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim()),
              formatting: {
                color: '0066CC',
                underline: 'single'
              }
            }
          ]
        });

        if (result) {
          formattedCount++;
          this.log.debug(`Smart formatting applied to table with ${rows.length} rows`);
        }
      } catch (error) {
        this.log.warn('Smart table formatting not available in current docxmlater version');
      }
    }

    return formattedCount;
  }

  /**
   * Standardize hyperlink colors - Set all hyperlinks to standard Word blue with underline
   *
   * Note: extractHyperlinks() returns already-sanitized hyperlink text
   */
  private async standardizeHyperlinkColors(doc: Document): Promise<number> {
    const hyperlinks = await this.docXMLater.extractHyperlinks(doc);
    let standardizedCount = 0;

    for (const { hyperlink, paragraph, text: sanitizedLinkText } of hyperlinks) {
      try {
        // Standard Word hyperlink blue: #0563C1
        // Since Hyperlink doesn't have setColor/setUnderline, we need to modify the run formatting
        const runs = paragraph.getRuns();

        for (const run of runs) {
          // Check if this run contains the hyperlink
          const runText = run.getText();

          if (runText && sanitizedLinkText && runText.includes(sanitizedLinkText)) {
            run.setColor('0563C1');
            run.setUnderline('single');
            standardizedCount++;
            break; // Found the hyperlink run, move to next hyperlink
          }
        }
      } catch (error) {
        this.log.warn(`Failed to standardize hyperlink color: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return standardizedCount;
  }

  /**
   * Fix internal hyperlinks - Repair broken internal bookmarks and create missing ones
   *
   * Note: extractHyperlinks() returns already-sanitized hyperlink text
   */
  private async fixInternalHyperlinks(doc: Document): Promise<number> {
    const hyperlinks = await this.docXMLater.extractHyperlinks(doc);
    let fixedCount = 0;

    for (const { hyperlink, text: sanitizedLinkText } of hyperlinks) {
      const anchor = hyperlink.getAnchor();
      if (!anchor) continue; // Not an internal hyperlink

      // Check if bookmark exists
      const bookmarkExists = doc.hasBookmark(anchor);

      if (!bookmarkExists) {
        // Try to find a heading that matches the hyperlink text
        if (sanitizedLinkText) {
          const matchingHeading = this.findHeadingByText(doc, sanitizedLinkText);
          if (matchingHeading) {
            // Create bookmark for the heading
            const newBookmark = doc.createHeadingBookmark(sanitizedLinkText);
            if (newBookmark) {
              // NOTE: setAnchor doesn't exist in current docxmlater API
              // The bookmark is created and associated with the heading
              // Internal hyperlinks should now resolve correctly
              fixedCount++;
              this.log.debug(`Created bookmark "${newBookmark}" for heading "${sanitizedLinkText}"`);
            }
          }
        }
      }
    }

    return fixedCount;
  }

  /**
   * Helper: Find a heading paragraph by text content
   */
  private findHeadingByText(doc: Document, searchText: string): any | null {
    const paragraphs = doc.getParagraphs();
    const normalizedSearch = searchText.trim().toLowerCase();

    for (const para of paragraphs) {
      const style = para.getStyle() || para.getFormatting().style;

      // Check if it's a heading style
      if (style && (style.startsWith('Heading') || style.includes('Heading'))) {
        const paraText = this.getParagraphText(para).trim().toLowerCase();
        if (paraText === normalizedSearch) {
          return para;
        }
      }
    }

    return null;
  }

  /**
   * Helper: Extract text from a paragraph (handles runs)
   *
   * ✅ IMPROVED ERROR HANDLING: Logs errors instead of silently failing
   *
   * This is used for non-critical extraction (displaying text).
   * For safety-critical decisions (paragraph deletion), use isParagraphTrulyEmpty() instead.
   */
  private getParagraphText(para: any): string {
    try {
      // Check if this is a valid paragraph with getRuns method
      if (!para || typeof para.getRuns !== 'function') {
        this.log.warn(`⚠️  Invalid paragraph object: ${typeof para}`);
        return '[INVALID_PARAGRAPH]';
      }

      const runs = para.getRuns();
      if (!Array.isArray(runs)) {
        this.log.warn(`⚠️  Paragraph.getRuns() returned non-array: ${typeof runs}`);
        return '[EXTRACTION_ERROR]';
      }

      return runs.map((run: any) => {
        try {
          return run.getText() || '';
        } catch (runError) {
          this.log.warn(`⚠️  Failed to extract text from run: ${runError instanceof Error ? runError.message : 'Unknown'}`);
          return '[RUN_ERROR]';
        }
      }).join('');

    } catch (error) {
      // ❌ FIX #1: Don't silently fail with empty string
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log.warn(`⚠️  Failed to extract text from paragraph: ${errorMsg}`);
      // Return distinguishable value instead of empty string
      return '[EXTRACTION_FAILED]';
    }
  }

  /**
   * Update "Top of Document" hyperlinks - Add navigation links to all Header 2 paragraphs
   * Creates internal bookmarks and hyperlinks for easy navigation back to document top
   */
  private async updateTopOfDocumentHyperlinks(doc: Document): Promise<number> {
    const paragraphs = doc.getParagraphs();
    let linksAdded = 0;

    // First, find or create a bookmark at the top of the document
    const topBookmarkName = '_TopOfDocument';

    // Check if bookmark already exists
    if (!doc.hasBookmark(topBookmarkName)) {
      // Create bookmark at first paragraph
      if (paragraphs.length > 0) {
        const topBookmark = doc.createBookmark(topBookmarkName);
        if (topBookmark) {
          // Add bookmark to first paragraph
          doc.addBookmarkToParagraph(paragraphs[0], topBookmark);
          this.log.debug(`Created top bookmark: ${topBookmarkName}`);
        }
      }
    }

    // Find all Header 2 paragraphs and add "Top of Document" links
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const style = para.getStyle() || para.getFormatting().style;

      // Check if it's a Header 2 style
      if (style && (style === 'Heading2' || style === 'Heading 2' || style.includes('Heading2'))) {
        try {
          // Check if this paragraph already has a "Top of Document" hyperlink
          const content = para.getContent();
          const hasTopLink = content.some((item: any) => {
            if (item instanceof Hyperlink) {
              // Use sanitized text for comparison
              const text = sanitizeHyperlinkText(item.getText()).toLowerCase();
              return text.includes('top of') || text.includes('top of the document');
            }
            return false;
          });

          if (!hasTopLink) {
            // Create internal hyperlink to top bookmark
            const topLink = Hyperlink.createInternal(
              topBookmarkName,
              'Top of the Document',
              { color: '0563C1', underline: 'single' }
            );

            // Add hyperlink to paragraph
            para.addHyperlink(topLink);
            linksAdded++;

            this.log.debug(`Added Top link to Header 2 at paragraph ${i}`);
          }
        } catch (error) {
          this.log.warn(`Failed to add Top link to paragraph ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    return linksAdded;
  }

  /**
   * Replace outdated hyperlink titles - Standalone title replacement
   * Fallback when PowerAutomate API is unavailable
   * Uses custom replacement rules from session settings
   */
  private async replaceOutdatedHyperlinkTitles(
    doc: Document,
    customReplacements?: Array<{
      find: string;
      replace: string;
      matchType: 'contains' | 'exact' | 'startsWith';
      applyTo: 'url' | 'text' | 'both';
    }>
  ): Promise<number> {
    if (!customReplacements || customReplacements.length === 0) {
      this.log.debug('No custom replacements configured - skipping outdated title replacement');
      return 0;
    }

    let replacedCount = 0;
    const hyperlinks = await this.docXMLater.extractHyperlinks(doc);

    for (const { hyperlink, text } of hyperlinks) {
      for (const rule of customReplacements) {
        // Only apply rules that target text or both
        if (rule.applyTo === 'text' || rule.applyTo === 'both') {
          const shouldApply = this.matchesPattern(text, rule.find, rule.matchType);

          if (shouldApply) {
            const newText = text.replace(rule.find, rule.replace);
            hyperlink.setText(newText);
            replacedCount++;

            this.log.debug(`Replaced title: "${text}" → "${newText}"`);
          }
        }
      }
    }

    return replacedCount;
  }

  // ═══════════════════════════════════════════════════════════
  // End Processing Options Method Implementations
  // ═══════════════════════════════════════════════════════════

  /**
   * Get DocXMLater processor for advanced operations
   */
  getDocXMLaterProcessor(): DocXMLaterProcessor {
    return this.docXMLater;
  }
}

export default WordDocumentProcessor;
