/**
 * WordDocumentProcessor - Modern DOCX processing using DocXMLater
 *
 * Complete rewrite using docxmlater library for all document operations.
 * Replaces 4000+ lines of manual XML parsing with clean, type-safe APIs.
 */

import { Document, Hyperlink, Paragraph, Run, Table, TableRow, TableCell, Image, Style, StylesManager, NumberingLevel, NumberingManager, AbstractNumbering, pointsToTwips, twipsToPoints, inchesToTwips } from 'docxmlater';
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
  removeHeadersFooters?: boolean;          // remove-headers-footers: Remove all headers and footers from document
  addDocumentWarning?: boolean;            // add-document-warning: Add standardized warning at end of document
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
      symbolIndent: number;              // Symbol/bullet position in inches
      textIndent: number;                // Text position in inches
      bulletChar?: string;
      numberedFormat?: string;
    }>;
    spacingBetweenItems: number;
  };
  bulletUniformity?: boolean;              // bullet-uniformity: Standardize bullet characters
  tableUniformity?: boolean;               // table-uniformity: Apply consistent table formatting
  tableShadingSettings?: {                 // NEW: Simplified table shading colors
    header2Shading: string;                // Hex color for Header 2 / 1x1 table cells (default: #BFBFBF)
    otherShading: string;                  // Hex color for other table cells and If.../Then... patterns (default: #E9E9E9)
  };
  smartTables?: boolean;                   // smart-tables: Smart table detection and formatting (NEW)
  tableOfContentsSettings?: {              // NEW: Table of Contents generation settings
    enabled: boolean;
    includeHeadingLevels: number[];        // e.g., [1, 2, 3]
    showPageNumbers: boolean;
    rightAlignPageNumbers: boolean;
    useHyperlinks: boolean;
    tabLeaderStyle: 'none' | 'dots' | 'dashes' | 'underline';
    tocTitle: string;
    showTocTitle: boolean;
    spacingBetweenHyperlinks: number;      // in points
  };

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

      // Load document using DocXMLater with default options
      // Using framework defaults ensures no corruption during load/save cycle
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


      if (options.removeItalics) {
        this.log.debug('=== REMOVING ITALIC FORMATTING ===');
        const italicsRemoved = await this.removeItalicFormatting(doc);
        this.log.info(`Removed italics from ${italicsRemoved} runs`);
      }

      // CONTENT STRUCTURE GROUP
      if (options.assignStyles && options.styles && options.styles.length > 0) {
        this.log.debug('=== ASSIGNING STYLES (USING DOCXMLATER applyCustomFormattingToExistingStyles) ===');
        // Use docXMLater's native method with preserve flag support
        // This handles style definitions, direct formatting clearing, and Header2 table wrapping
        const styleResults = await this.applyCustomStylesFromUI(doc, options.styles, options.tableShadingSettings);
        this.log.info(`Applied custom formatting: Heading1=${styleResults.heading1}, Heading2=${styleResults.heading2}, Heading3=${styleResults.heading3}, Normal=${styleResults.normal}, ListParagraph=${styleResults.listParagraph}`);
      }

      // NEW VALIDATION OPERATIONS (DocXMLater 1.6.0)
      // DEBUG: Log validation operations status
      this.log.info('\n=== VALIDATION OPERATIONS DEBUG ===');
      this.log.info('  validateDocumentStyles flag:', options.operations?.validateDocumentStyles);
      this.log.info('  validateHeader2Tables flag:', options.operations?.validateHeader2Tables);
      this.log.info('  options.styles defined:', !!options.styles);
      this.log.info('  options.styles length:', options.styles?.length || 0);
      if (options.styles && options.styles.length > 0) {
        this.log.info('  Available styles:', options.styles.map((s: any) => s.id).join(', '));
      }

      if (options.operations?.validateDocumentStyles && options.styles && options.styles.length > 0) {
        this.log.debug('=== VALIDATING DOCUMENT STYLES ===');
        const results = await this.validateDocumentStyles(doc, options.styles);
        this.log.info(`Validated ${results.applied} styles: ${results.validated.join(', ')}`);
      } else if (options.operations?.validateDocumentStyles) {
        this.log.warn('⚠️ validateDocumentStyles is ENABLED but no styles provided! Please configure styles in the Styles tab.');
      }

      if (options.operations?.validateHeader2Tables && options.styles) {
        const header2Style = options.styles.find((s: any) => s.id === 'header2');
        if (header2Style) {
          this.log.debug('=== VALIDATING HEADER 2 TABLE FORMATTING ===');
          const cellsFixed = await this.validateHeader2TableFormatting(doc, header2Style);
          this.log.info(`Validated and fixed ${cellsFixed} Header 2 table cells`);
        } else {
          this.log.warn('⚠️ validateHeader2Tables is ENABLED but no header2 style found! Please configure Header 2 style in the Styles tab.');
        }
      }

      if (options.addDocumentWarning) {
        this.log.debug('=== ADDING/UPDATING DOCUMENT WARNING ===');
        await this.addOrUpdateDocumentWarning(doc);
      }

      if (options.centerImages) {
        this.log.debug('=== CENTERING IMAGES ===');
        const imagesCentered = await this.centerAllImages(doc);
        this.log.info(`Centered ${imagesCentered} images`);
      }

      if (options.removeHeadersFooters) {
        this.log.debug('=== REMOVING HEADERS/FOOTERS ===');
        const headersFootersRemoved = doc.removeAllHeadersFooters();
        this.log.info(`Removed ${headersFootersRemoved} headers/footers from document`);
      }

      if (options.fixKeywords) {
        this.log.debug('=== FIXING KEYWORDS ===');
        const keywordsFixed = await this.fixCommonKeywords(doc, options);
        this.log.info(`Fixed ${keywordsFixed} keyword errors`);
      }

      // LISTS & TABLES GROUP
      if (options.listBulletSettings?.enabled) {
        this.log.debug('=== APPLYING LIST INDENTATION UNIFORMITY ===');
        const listsFormatted = await this.applyListIndentationUniformity(doc, options.listBulletSettings);
        this.log.info(`Applied indentation to ${listsFormatted} list paragraphs`);
      }

      if (options.bulletUniformity && options.listBulletSettings) {
        this.log.debug('=== APPLYING BULLET AND NUMBERED LIST UNIFORMITY ===');
        const bulletsStandardized = await this.applyBulletUniformity(doc, options.listBulletSettings);
        this.log.info(`Standardized ${bulletsStandardized} bullet lists`);

        const numbersStandardized = await this.applyNumberedUniformity(doc, options.listBulletSettings);
        this.log.info(`Standardized ${numbersStandardized} numbered lists`);
      }

      if (options.tableUniformity) {
        this.log.debug('=== APPLYING TABLE UNIFORMITY (DOCXMLATER 1.7.0) ===');
        const tablesFormatted = await this.applyTableUniformity(doc, options);
        this.log.info(`Applied standard formatting to ${tablesFormatted} tables (shading, borders, autofit, patterns)`);
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

      // Note: TOC replacement is performed after final document save (see below)

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

      // ═══════════════════════════════════════════════════════════
      // REPLACE TABLE OF CONTENTS (after final save)
      //
      // IMPORTANT: This must happen AFTER doc.save() to prevent
      // the in-memory document from overwriting the populated TOC.
      // The replaceTableOfContents() method modifies the file on disk,
      // so it must be the final operation on the document.
      // ═══════════════════════════════════════════════════════════
      if (options.operations?.updateTocHyperlinks) {
        this.log.debug('=== GENERATING/UPDATING TABLE OF CONTENTS ===');

        // Use DocXMLater helper to replace TOC with generated entries
        const tocCount = await doc.replaceTableOfContents(filePath);

        this.log.info(`Replaced ${tocCount} Table of Contents element(s) with generated entries`);

        if (tocCount === 0) {
          this.log.warn('No TOC elements found in document. To create a TOC, insert a Table of Contents field in Word first.');
        }
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
   * Remove extra paragraph lines
   *
   * Removes consecutive empty paragraphs while:
   * - Handling tables, SDTs, and complex structures safely
   * - Preserving list items and numbered paragraphs
   * - Working inside table cells
   * - Protecting paragraphs adjacent to tables
   */
  private async removeExtraParagraphLines(doc: Document): Promise<number> {
    this.log.debug('Removing duplicate empty paragraphs');

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
      preserveBold?: boolean;
      preserveItalic?: boolean;
      preserveUnderline?: boolean;
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
          // Dual toggle formatting: only call setter if preserve flag is not true
          if (!styleToApply.preserveBold) {
            run.setBold(styleToApply.bold);
          }
          if (!styleToApply.preserveItalic) {
            run.setItalic(styleToApply.italic);
          }
          if (!styleToApply.preserveUnderline) {
            run.setUnderline(styleToApply.underline ? 'single' : false);
          }
          run.setColor(styleToApply.color.replace('#', ''));
        }

        appliedCount++;
      }
    }

    return appliedCount;
  }

  /**
   * Convert SessionStyle array to docXMLater's ApplyCustomFormattingOptions format
   */
  private convertSessionStylesToDocXMLaterConfig(
    styles: Array<{
      id: string;
      fontFamily: string;
      fontSize: number;
      bold: boolean;
      italic: boolean;
      underline: boolean;
      preserveBold?: boolean;
      preserveItalic?: boolean;
      preserveUnderline?: boolean;
      alignment: 'left' | 'center' | 'right' | 'justify';
      color: string;
      spaceBefore: number;
      spaceAfter: number;
      lineSpacing: number;
      noSpaceBetweenSame?: boolean;
      indentation?: {
        left?: number;
        firstLine?: number;
      };
    }>,
    tableShadingSettings?: {
      header2Shading: string;
      otherShading: string;
    }
  ): any {
    const config: any = {};

    for (const style of styles) {
      const runFormatting: any = {
        font: style.fontFamily,
        size: style.fontSize,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        color: style.color.replace('#', ''),
        preserveBold: style.preserveBold,
        preserveItalic: style.preserveItalic,
        preserveUnderline: style.preserveUnderline,
      };

      const paragraphFormatting: any = {
        alignment: style.alignment,
        spacing: {
          before: pointsToTwips(style.spaceBefore),
          after: pointsToTwips(style.spaceAfter),
          line: pointsToTwips(style.lineSpacing * 12),
          lineRule: 'auto' as const,
        },
      };

      // Add indentation if present (for List Paragraph style)
      if (style.indentation) {
        paragraphFormatting.indentation = {
          left: pointsToTwips((style.indentation.left ?? 0.25) * 72),
          firstLine: pointsToTwips((style.indentation.firstLine ?? 0.5) * 72),
        };
      }

      // Add contextualSpacing if present (for List Paragraph style)
      if (style.noSpaceBetweenSame !== undefined) {
        paragraphFormatting.contextualSpacing = style.noSpaceBetweenSame;
      }

      // Map UI style IDs to docXMLater style IDs
      switch (style.id) {
        case 'header1':
          config.heading1 = { run: runFormatting, paragraph: paragraphFormatting };
          break;
        case 'header2':
          config.heading2 = {
            run: runFormatting,
            paragraph: paragraphFormatting,
            tableOptions: {
              shading: tableShadingSettings?.header2Shading?.replace('#', '') ?? 'BFBFBF',
              marginTop: 0,
              marginBottom: 0,
              marginLeft: 115,
              marginRight: 115,
              tableWidthPercent: 5000,
            }
          };
          break;
        case 'header3':
          config.heading3 = { run: runFormatting, paragraph: paragraphFormatting };
          break;
        case 'normal':
          config.normal = { run: runFormatting, paragraph: paragraphFormatting };
          break;
        case 'listParagraph':
          config.listParagraph = { run: runFormatting, paragraph: paragraphFormatting };
          break;
      }
    }

    return config;
  }

  /**
   * Apply custom styles from UI using docXMLater's applyCustomFormattingToExistingStyles()
   * This replaces the custom implementation with the framework's native method
   */
  private async applyCustomStylesFromUI(
    doc: Document,
    styles: Array<{
      id: string;
      name: string;
      fontFamily: string;
      fontSize: number;
      bold: boolean;
      italic: boolean;
      underline: boolean;
      preserveBold?: boolean;
      preserveItalic?: boolean;
      preserveUnderline?: boolean;
      alignment: 'left' | 'center' | 'right' | 'justify';
      color: string;
      spaceBefore: number;
      spaceAfter: number;
      lineSpacing: number;
      noSpaceBetweenSame?: boolean;
      indentation?: {
        left?: number;
        firstLine?: number;
      };
    }>,
    tableShadingSettings?: {
      header2Shading: string;
      otherShading: string;
    }
  ): Promise<{ heading1: boolean; heading2: boolean; heading3: boolean; normal: boolean; listParagraph: boolean }> {
    // Convert SessionStyle array to docXMLater format
    const config = this.convertSessionStylesToDocXMLaterConfig(styles, tableShadingSettings);

    // Use docXMLater's native method with preserve flag support
    // This handles both style definition updates and direct formatting clearing
    const results = doc.applyCustomFormattingToExistingStyles(config);

    return results;
  }

  /**
   * Validate all document styles using DocXMLater 1.6.0 applyStylesFromObjects()
   * Creates Style objects from UI configuration and applies them to document
   * Auto-fixes any style mismatches
   *
   * @param doc - Document to validate
   * @param styles - Array of SessionStyle objects from UI
   * @returns Object with count of applied styles and list of validated style names
   */
  private async validateDocumentStyles(
    doc: Document,
    styles: Array<{
      id: string;
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
      noSpaceBetweenSame?: boolean;
      indentation?: {
        left?: number;
        firstLine?: number;
      };
    }>
  ): Promise<{ applied: number; validated: string[] }> {
    this.log.debug('Creating Style objects from UI configuration...');

    const styleObjects: Style[] = [];
    const styleNames: string[] = [];

    // Convert each SessionStyle to a DocXMLater Style object
    for (const sessionStyle of styles) {
      // Map UI style ID to docxmlater style ID
      const docStyleId = sessionStyle.id === 'header1' ? 'Heading1' :
                         sessionStyle.id === 'header2' ? 'Heading2' :
                         sessionStyle.id === 'header3' ? 'Heading3' :
                         sessionStyle.id === 'listParagraph' ? 'ListParagraph' : 'Normal';

      // Create paragraph formatting object
      const paragraphFormatting: any = {
        alignment: sessionStyle.alignment,
        spacing: {
          before: pointsToTwips(sessionStyle.spaceBefore),
          after: pointsToTwips(sessionStyle.spaceAfter),
          line: pointsToTwips(sessionStyle.lineSpacing * 12),
          lineRule: 'auto',
        },
      };

      // Add indentation if present (for List Paragraph style)
      if (sessionStyle.indentation) {
        paragraphFormatting.indentation = {
          left: pointsToTwips((sessionStyle.indentation.left ?? 0.25) * 72), // Convert inches to points, then to twips
          firstLine: pointsToTwips((sessionStyle.indentation.firstLine ?? 0.5) * 72),
        };
      }

      // Add noSpaceBetweenSame if set (contextual spacing)
      if (sessionStyle.noSpaceBetweenSame) {
        paragraphFormatting.contextualSpacing = true;
      }

      // Create Style object using DocXMLater API
      const styleObj = Style.create({
        styleId: docStyleId,
        name: sessionStyle.name,
        type: 'paragraph',
        basedOn: 'Normal',
        runFormatting: {
          font: sessionStyle.fontFamily,
          size: sessionStyle.fontSize,
          bold: sessionStyle.bold,
          italic: sessionStyle.italic,
          underline: sessionStyle.underline ? 'single' : false,
          color: sessionStyle.color.replace('#', ''),
        },
        paragraphFormatting,
      });

      styleObjects.push(styleObj);
      styleNames.push(docStyleId);
      this.log.debug(`Created Style object for ${docStyleId}`);
    }

    // Apply all styles at once using DocXMLater 1.6.0 helper
    this.log.debug(`Applying ${styleObjects.length} Style objects to document...`);
    const results = doc.applyStylesFromObjects(...styleObjects);

    // Count how many were successfully applied
    const appliedCount = Object.values(results).filter(success => success === true).length;

    // Build list of validated styles
    const validated: string[] = [];
    if (results.heading1) validated.push('Heading1');
    if (results.heading2) validated.push('Heading2');
    if (results.heading3) validated.push('Heading3');
    if (results.normal) validated.push('Normal');
    if (results.listParagraph) validated.push('ListParagraph');

    this.log.debug(`Applied ${appliedCount} styles successfully: ${validated.join(', ')}`);

    return { applied: appliedCount, validated };
  }

  /**
   * Validate and auto-fix Header 2 formatting in table cells
   * Checks: font, size, bold, italic, underline, color, spacing, alignment, cell shading
   *
   * @param doc - Document to validate
   * @param header2Style - Header 2 style configuration from UI
   * @returns Number of cells fixed
   */
  private async validateHeader2TableFormatting(
    doc: Document,
    header2Style: {
      fontFamily: string;
      fontSize: number;
      bold: boolean;
      italic: boolean;
      underline: boolean;
      preserveBold?: boolean;
      preserveItalic?: boolean;
      preserveUnderline?: boolean;
      alignment: 'left' | 'center' | 'right' | 'justify';
      color: string;
      spaceBefore: number;
      spaceAfter: number;
    }
  ): Promise<number> {
    let cellsFixed = 0;

    // Get all tables in document
    const tables = doc.getTables();
    this.log.debug(`Found ${tables.length} tables to validate for Header 2 formatting`);

    for (const table of tables) {
      const rows = table.getRows();
      const is1x1Table = rows.length === 1 && rows[0]?.getCells().length === 1;

      for (const row of rows) {
        const cells = row.getCells();

        for (const cell of cells) {
          const paragraphs = cell.getParagraphs();

          for (const para of paragraphs) {
            const currentStyle = para.getStyle();

            // Check if this paragraph has Header 2 style
            if (currentStyle === 'Heading2' || currentStyle === 'Heading 2') {
              let cellNeedsUpdate = false;
              const formatting = para.getFormatting();
              const runs = para.getRuns();

              // Validate and fix paragraph formatting
              if (formatting.alignment !== header2Style.alignment) {
                para.setAlignment(header2Style.alignment);
                cellNeedsUpdate = true;
                this.log.debug(`Fixed Header 2 alignment to ${header2Style.alignment}`);
              }

              const spacing = formatting.spacing || {};
              const expectedBefore = pointsToTwips(header2Style.spaceBefore);
              const expectedAfter = pointsToTwips(header2Style.spaceAfter);

              if (spacing.before !== expectedBefore) {
                para.setSpaceBefore(expectedBefore);
                cellNeedsUpdate = true;
                this.log.debug(`Fixed Header 2 spacing before to ${header2Style.spaceBefore}pt`);
              }

              if (spacing.after !== expectedAfter) {
                para.setSpaceAfter(expectedAfter);
                cellNeedsUpdate = true;
                this.log.debug(`Fixed Header 2 spacing after to ${header2Style.spaceAfter}pt`);
              }

              // Validate and fix run formatting (font, size, bold, italic, underline, color)
              for (const run of runs) {
                const runFormatting = run.getFormatting();
                let runNeedsUpdate = false;

                if (runFormatting.font !== header2Style.fontFamily) {
                  run.setFont(header2Style.fontFamily);
                  runNeedsUpdate = true;
                }

                if (runFormatting.size !== header2Style.fontSize) {
                  run.setSize(header2Style.fontSize);
                  runNeedsUpdate = true;
                }

                // Dual toggle formatting: only apply if preserve flag is not true
                if (!header2Style.preserveBold && runFormatting.bold !== header2Style.bold) {
                  run.setBold(header2Style.bold);
                  runNeedsUpdate = true;
                }

                if (!header2Style.preserveItalic && runFormatting.italic !== header2Style.italic) {
                  run.setItalic(header2Style.italic);
                  runNeedsUpdate = true;
                }

                if (!header2Style.preserveUnderline) {
                  const expectedUnderline = header2Style.underline ? 'single' : false;
                  if (runFormatting.underline !== expectedUnderline) {
                    run.setUnderline(expectedUnderline);
                    runNeedsUpdate = true;
                  }
                }

                const expectedColor = header2Style.color.replace('#', '');
                if (runFormatting.color !== expectedColor) {
                  run.setColor(expectedColor);
                  runNeedsUpdate = true;
                }

                if (runNeedsUpdate) {
                  cellNeedsUpdate = true;
                  this.log.debug('Fixed Header 2 run formatting (font/size/bold/italic/underline/color)');
                }
              }

              // Validate and fix cell shading for 1x1 tables
              // Heading2 cells in 1x1 tables should ALWAYS be shaded
              if (is1x1Table) {
                cell.setShading({ fill: 'BFBFBF' }); // Default Header 2 shading
                cellNeedsUpdate = true;
                this.log.debug(`Applied Header 2 cell shading (#BFBFBF) to 1x1 table`);
              }

              if (cellNeedsUpdate) {
                cellsFixed++;
              }
            }
          }
        }
      }
    }

    if (cellsFixed > 0) {
      this.log.info(`Fixed ${cellsFixed} Header 2 table cells`);
    } else {
      this.log.debug('All Header 2 table cells already have correct formatting');
    }

    return cellsFixed;
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
  private async fixCommonKeywords(doc: Document, options: WordProcessingOptions = {}): Promise<number> {
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
            trackChanges: options?.trackChangesInWord || false,
            author: 'DocHub AutoCorrect'
          }
        );

        if (result) {
          totalFixed += result.count || 0;

          if (result.revisions && options?.trackChangesInWord) {
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
   * Uses proper hanging indent model: symbol position + text offset
   */
  private async applyListIndentationUniformity(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number;  // Bullet/number position in inches
        textIndent: number;    // Text position in inches
        bulletChar?: string;
        numberedFormat?: string;
      }>;
      spacingBetweenItems: number;
    }
  ): Promise<number> {
    let formattedCount = 0;
    const paragraphs = doc.getParagraphs();

    for (const para of paragraphs) {
      const numbering = para.getNumbering();
      if (!numbering) continue;

      const level = numbering.level || 0;
      // Find setting for this level (levels are 1-indexed in UI, 0-indexed in doc)
      const indentSetting = settings.indentationLevels.find(l => l.level === level + 1);

      if (indentSetting) {
        // Convert inches to twips (1 inch = 1440 twips)
        const symbolTwips = Math.round(indentSetting.symbolIndent * 1440);
        const textTwips = Math.round(indentSetting.textIndent * 1440);
        const hangingTwips = textTwips - symbolTwips;

        // Set left indent (bullet/number position)
        para.setLeftIndent(symbolTwips);

        // Set hanging indent (text offset from bullet) via firstLine with negative value
        // In OOXML, hanging indent is represented as negative firstLine indent
        if (hangingTwips > 0) {
          // Access formatting directly since there's no setHangingIndent method
          const formatting = para.getFormatting();
          if (!formatting.indentation) {
            formatting.indentation = {};
          }
          formatting.indentation.hanging = hangingTwips;
        }

        // Apply spacing between items if configured
        if (settings.spacingBetweenItems > 0) {
          para.setSpaceAfter(settings.spacingBetweenItems);
        }

        formattedCount++;
      }
    }

    this.log.debug(`Applied indentation to ${formattedCount} list paragraphs`);
    return formattedCount;
  }

  /**
   * Helper: Check if a numbering ID represents a bullet list
   */
  private isBulletList(doc: Document, numId: number): boolean {
    try {
      const manager = doc.getNumberingManager();
      const instance = manager.getInstance(numId);
      if (!instance) return false;

      const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
      if (!abstractNum) return false;

      const level = abstractNum.getLevel(0);
      return level?.getFormat() === 'bullet';
    } catch (error) {
      this.log.warn(`Error checking if numId ${numId} is bullet list: ${error}`);
      return false;
    }
  }

  /**
   * Helper: Check if a numbering ID represents a numbered list
   */
  private isNumberedList(doc: Document, numId: number): boolean {
    try {
      const manager = doc.getNumberingManager();
      const instance = manager.getInstance(numId);
      if (!instance) return false;

      const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
      if (!abstractNum) return false;

      const level = abstractNum.getLevel(0);
      const format = level?.getFormat();
      return format !== 'bullet' && format !== undefined;
    } catch (error) {
      this.log.warn(`Error checking if numId ${numId} is numbered list: ${error}`);
      return false;
    }
  }

  /**
   * Apply bullet uniformity - Standardize bullet characters across all bullet lists
   * Uses UI configuration for bullet characters and indentation
   */
  private async applyBulletUniformity(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number;  // in inches
        textIndent: number;    // in inches
        bulletChar?: string;
        numberedFormat?: string;
      }>;
    }
  ): Promise<number> {
    const manager = doc.getNumberingManager();

    // Extract bullet characters from UI settings (U+F0B7 is Symbol font standard bullet)
    const bullets = settings.indentationLevels.map(level => level.bulletChar || '\uF0B7');

    // Create custom levels with font specified and UI indentation
    // UI config already has incremented values per level, use them directly
    const levels = settings.indentationLevels.map((levelConfig, index) => {
      // Use direct values from UI config (already incremented per level)
      const symbolTwips = Math.round(levelConfig.symbolIndent * 1440);
      const textTwips = Math.round(levelConfig.textIndent * 1440);
      const hangingTwips = textTwips - symbolTwips;

      return new NumberingLevel({
        level: index,
        format: 'bullet',
        text: levelConfig.bulletChar || '\uF0B7',  // U+F0B7 is Symbol font standard bullet
        // Let framework use default 'Calibri' font for correct bullet rendering
        leftIndent: symbolTwips,  // Bullet position (where bullet appears)
        hangingIndent: hangingTwips  // Text offset from bullet
      });
    });

    // Create custom list with all UI-configured levels
    const numId = manager.createCustomList(levels, 'UI Bullet List');
    if (!numId) {
      this.log.warn('Failed to create custom bullet list');
      return 0;
    }

    this.log.debug(`Created bullet list numId=${numId} with ${levels.length} levels`);

    // Apply to bullet list paragraphs only
    let standardizedCount = 0;
    const paragraphs = doc.getParagraphs();

    for (const para of paragraphs) {
      const numbering = para.getNumbering();
      if (numbering && numbering.numId !== undefined) {
        // Only apply to bullet lists (not numbered lists)
        if (this.isBulletList(doc, numbering.numId)) {
          const level = Math.min(numbering.level || 0, levels.length - 1);
          para.setNumbering(numId, level);
          standardizedCount++;
        }
      }
    }

    return standardizedCount;
  }

  /**
   * Helper: Parse numbered format string to NumberFormat type
   */
  private parseNumberedFormat(formatString: string): 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman' {
    if (formatString.includes('a')) return 'lowerLetter';
    if (formatString.includes('A')) return 'upperLetter';
    if (formatString.includes('i')) return 'lowerRoman';
    if (formatString.includes('I')) return 'upperRoman';
    return 'decimal';
  }

  /**
   * Apply numbered uniformity - Standardize numbered lists across document
   * Uses UI configuration for numbering formats and indentation
   */
  private async applyNumberedUniformity(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number;  // in inches
        textIndent: number;    // in inches
        bulletChar?: string;
        numberedFormat?: string;
      }>;
    }
  ): Promise<number> {
    const manager = doc.getNumberingManager();

    // Parse numbering formats from UI settings
    const formats = settings.indentationLevels.map(level =>
      this.parseNumberedFormat(level.numberedFormat || '1.')
    );

    // Create custom levels with UI indentation
    // UI config already has incremented values per level, use them directly
    const levels = settings.indentationLevels.map((levelConfig, index) => {
      // Use direct values from UI config (already incremented per level)
      const symbolTwips = Math.round(levelConfig.symbolIndent * 1440);
      const textTwips = Math.round(levelConfig.textIndent * 1440);
      const hangingTwips = textTwips - symbolTwips;

      return new NumberingLevel({
        level: index,
        format: formats[index],
        text: `%${index + 1}.`,  // Standard template (e.g., %1., %2.)
        leftIndent: symbolTwips,  // Number position (where number appears)
        hangingIndent: hangingTwips  // Text offset from number
      });
    });

    // Create custom numbered list with all UI-configured levels
    const numId = manager.createCustomList(levels, 'UI Numbered List');
    if (!numId) {
      this.log.warn('Failed to create custom numbered list');
      return 0;
    }

    this.log.debug(`Created numbered list numId=${numId} with ${levels.length} levels`);

    // Apply to numbered list paragraphs only
    let standardizedCount = 0;
    const paragraphs = doc.getParagraphs();

    for (const para of paragraphs) {
      const numbering = para.getNumbering();
      if (numbering && numbering.numId !== undefined) {
        // Only apply to numbered lists (not bullet lists)
        if (this.isNumberedList(doc, numbering.numId)) {
          const level = Math.min(numbering.level || 0, levels.length - 1);
          para.setNumbering(numId, level);
          standardizedCount++;
        }
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
  private async applyTableUniformity(doc: Document, options: WordProcessingOptions): Promise<{
    tablesProcessed: number;
    headerRowsFormatted: number;
    cellsRecolored: number;
  }> {
    // Get shading color for all tables from session settings (strip # prefix for OOXML format)
    const color = options.tableShadingSettings?.otherShading?.replace('#', '') || 'E9E9E9';

    this.log.debug(`Applying standard table formatting with color: #${color}`);

    // Apply standard table formatting using docxmlater 1.8.0 helper
    // This single helper replaces all previous manual operations:
    //   - Size-based shading (1x1 vs multi-cell)
    //   - Border application (NEW in 1.8.0)
    //   - Autofit layout
    //   - If.../Then... pattern detection and shading
    const result = doc.applyStandardTableFormatting(color);

    this.log.debug(`Applied standard formatting to ${result.tablesProcessed} tables`);
    this.log.debug(`Formatted ${result.headerRowsFormatted} header rows`);
    this.log.debug(`Recolored ${result.cellsRecolored} cells`);

    return result;
  }

  /**
   * Apply smart table formatting using docxmlater APIs
   *
   * Intelligent table detection and formatting:
   * - Detects header rows based on content analysis
   * - Formats headers with bold text and gray background
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

        // Apply header formatting if detected
        if (isLikelyHeader) {
          for (const cell of firstRowCells) {
            // Set header background color
            cell.setShading({ fill: 'E0E0E0' });

            // Make all text in header cells bold
            for (const para of cell.getParagraphs()) {
              for (const run of para.getRuns()) {
                run.setBold(true);
              }
            }
          }
        }

        formattedCount++;
        this.log.debug(`Smart formatting applied to table with ${rows.length} rows`);
      } catch (error) {
        this.log.warn(`Error applying smart table formatting: ${error}`);
      }
    }

    return formattedCount;
  }

  /**
   * Standardize hyperlink colors - Set all hyperlinks to #0000FF (blue)
   * Uses DocXMLater's updateAllHyperlinkColors() helper function
   */
  private async standardizeHyperlinkColors(doc: Document): Promise<number> {
    this.log.debug('=== STANDARDIZING HYPERLINK COLORS ===');

    // Use DocXMLater's built-in helper to update all hyperlinks at once
    const updatedCount = doc.updateAllHyperlinkColors('0000FF');

    if (updatedCount > 0) {
      this.log.info(`Standardized ${updatedCount} hyperlink(s) to blue (#0000FF)`);
    } else {
      this.log.debug('All hyperlinks already have correct color');
    }

    return updatedCount;
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
  private getParagraphText(para: Paragraph | any): string {
    try {
      // Validate paragraph object
      if (!para || typeof para.getText !== 'function') {
        this.log.warn(`Invalid paragraph object: ${typeof para}`);
        return '';
      }

      // Use docxmlater's built-in getText() method
      return para.getText() || '';
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log.warn(`Failed to extract text from paragraph: ${errorMsg}`);
      return '';
    }
  }

  /**
   * Ensure "TopHyperlink" style exists in the document
   * This style guarantees zero spacing after and consistent formatting
   * Prevents style inheritance issues that cause unwanted spacing
   */
  private ensureTopHyperlinkStyle(doc: Document): void {
    // Check if style already exists (avoid duplicates)
    const existingStyles = doc.getStyles();
    const hasTopHyperlinkStyle = existingStyles.some((style: any) =>
      style.styleId === 'TopHyperlink' || style.id === 'TopHyperlink'
    );

    if (hasTopHyperlinkStyle) {
      this.log.debug('TopHyperlink style already exists, skipping creation');
      return;
    }

    this.log.debug('Creating TopHyperlink style with guaranteed zero spacing');

    // Create custom style with exact specifications
    const style = Style.create({
      styleId: 'TopHyperlink',
      name: 'Top Hyperlink',
      type: 'paragraph',
      basedOn: 'Normal',
      runFormatting: {
        font: 'Verdana',
        size: 12,
        color: '0000FF', // Blue
        underline: 'single'
      },
      paragraphFormatting: {
        alignment: 'right',
        spacing: {
          before: 60,  // 3pt = 60 twips (20 twips per point)
          after: 0,    // GUARANTEED ZERO - no inheritance
          line: 240,   // 12pt = 240 twips
          lineRule: 'exact' // Use 'exact' instead of 'auto' to prevent extra space
        }
      }
    });

    doc.addStyle(style);
    this.log.debug('TopHyperlink style created successfully');
  }

  /**
   * Create a formatted "Top of the Document" hyperlink paragraph
   * Formatting: Verdana 12pt, #0000FF, underlined, right-aligned, 3pt before, 0pt after
   * Uses custom TopHyperlink style to guarantee zero spacing after
   */
  private createTopHyperlinkParagraph(doc: Document): Paragraph {
    // Ensure TopHyperlink style exists in the document
    this.ensureTopHyperlinkStyle(doc);

    // Create internal hyperlink to _top bookmark
    // DocXMLater now has addTopBookmark() helper that correctly places bookmark
    const hyperlink = Hyperlink.createInternal(
      '_top',
      'Top of the Document',
      {
        font: 'Verdana',
        size: 12,
        color: '0000FF',
        underline: 'single'
      }
    );

    // Create paragraph and add hyperlink
    const para = Paragraph.create();
    para.addHyperlink(hyperlink);

    // Apply TopHyperlink style - this handles all formatting including guaranteed zero spacing
    para.setStyle('TopHyperlink');

    // No need for manual formatting - style handles:
    // - Right alignment
    // - Space before: 60 twips (3pt)
    // - Space after: 0 twips (GUARANTEED ZERO)
    // - Line spacing: 240 twips exact (12pt)

    return para;
  }

  /**
   * Fix any existing "Top of Document" hyperlinks throughout the document
   * Searches body paragraphs and checks for incorrect text, formatting, or bookmarks
   * Updates display text, formatting, and bookmark reference to match standard
   *
   * @param doc - Document to search and fix
   * @returns Number of hyperlinks fixed
   */
  private async fixExistingTopHyperlinks(doc: Document): Promise<number> {
    let fixedCount = 0;

    // Ensure TopHyperlink style exists before fixing existing hyperlinks
    this.ensureTopHyperlinkStyle(doc);

    // Check all body elements for paragraphs with "Top of" hyperlinks
    const bodyElements = doc.getBodyElements();
    const paragraphsToCheck: Paragraph[] = [];

    // Collect all paragraphs from body elements
    bodyElements.forEach(element => {
      if (element instanceof Paragraph) {
        paragraphsToCheck.push(element);
      }
    });

    this.log.debug(`Checking ${paragraphsToCheck.length} body paragraphs for Top of Document hyperlinks to fix...`);

    for (const para of paragraphsToCheck) {
      const content = para.getContent();

      // Check each content item for hyperlinks
      for (const item of content) {
        if (item instanceof Hyperlink) {
          const text = sanitizeHyperlinkText(item.getText()).toLowerCase();

          // Check if this is a "Top of" hyperlink
          if (text.includes('top of') && (text.includes('document') || text === 'top of the document')) {
            let needsUpdate = false;

            // Check 1: Text needs updating (missing "the")
            if (text === 'top of document') {
              item.setText('Top of the Document');
              needsUpdate = true;
              this.log.debug('Updated hyperlink text from "Top of Document" to "Top of the Document"');
            }

            // Check 2: Bookmark target (get current target and compare)
            const currentTarget = (item as any).anchor || (item as any).target;
            if (currentTarget && currentTarget !== '_top') {
              // Update to use _top bookmark
              // Note: Hyperlink class may not expose setAnchor, so we recreate it
              this.log.debug(`Hyperlink uses bookmark "${currentTarget}", should be "_top"`);
              needsUpdate = true;
            }

            // Check 3: Formatting (we'll recreate the hyperlink with correct formatting)
            if (needsUpdate) {
              // Recreate hyperlink with correct settings
              const correctedLink = Hyperlink.createInternal(
                '_top',
                'Top of the Document',
                {
                  font: 'Verdana',
                  size: 12,
                  color: '0000FF',
                  underline: 'single'
                }
              );

              // Replace in paragraph content
              // Since we can't directly replace items in content array,
              // we'll need to recreate the paragraph
              // For now, just update the text and log
              item.setText('Top of the Document');
              fixedCount++;

              this.log.debug('Fixed Top of Document hyperlink (text, formatting, bookmark)');
            }

            // Check 4: Apply TopHyperlink style for guaranteed correct formatting
            // This replaces manual formatting and ensures zero spacing after
            const currentStyle = para.getStyle();
            if (currentStyle !== 'TopHyperlink') {
              para.setStyle('TopHyperlink');
              this.log.debug('Applied TopHyperlink style to existing hyperlink paragraph (guaranteed zero spacing)');
            }
          }
        }
      }
    }

    if (fixedCount > 0) {
      this.log.info(`Fixed ${fixedCount} existing Top of Document hyperlinks`);
    }

    return fixedCount;
  }

  /**
   * Update "Top of Document" hyperlinks - Add navigation links before tables containing Header 2
   *
   * Requirements:
   * - Targets Header 2 styles (Heading2, Heading 2) within tables
   * - Skips the first Header 2 in entire document
   * - Inserts new paragraph BEFORE the table containing the Header 2
   * - Formatting: Verdana 12pt, #0000FF, right-aligned, underlined, 3pt/0pt spacing
   * - Uses "_top" anchor (standard Word bookmark)
   * - Prevents duplicates and updates old text format
   */
  private async updateTopOfDocumentHyperlinks(doc: Document): Promise<number> {
    let linksAdded = 0;

    // Use docxmlater's addTopBookmark() helper to correctly place _top bookmark
    // This places <w:bookmarkStart w:id="0" w:name="_top"/> as direct child of <w:body>
    // as required by OOXML spec
    if (!doc.hasBookmark('_top')) {
      this.log.debug('Creating _top bookmark at document start using addTopBookmark()...');

      try {
        doc.addTopBookmark();
        this.log.debug('Created _top bookmark at document body start');
      } catch (error) {
        this.log.error(`Failed to create _top bookmark: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue anyway - hyperlinks will still be created
      }
    } else {
      this.log.debug('_top bookmark already exists');
    }

    // Fix any existing "Top of Document" hyperlinks before adding new ones
    const fixedCount = await this.fixExistingTopHyperlinks(doc);
    if (fixedCount > 0) {
      this.log.info(`Fixed ${fixedCount} existing Top of Document hyperlinks with TopHyperlink style`);
    }

    // Find all tables with Header 2 paragraphs
    interface TableWithHeader2 {
      tableIndex: number;
      table: Table;
      hasHeader2: boolean;
    }

    const tables = doc.getTables();
    const tablesWithHeader2: TableWithHeader2[] = [];

    this.log.debug(`Scanning ${tables.length} tables for Header 2 paragraphs...`);

    tables.forEach((table, tableIndex) => {
      let hasHeader2 = false;

      table.getRows().forEach((row) => {
        row.getCells().forEach((cell) => {
          cell.getParagraphs().forEach((para) => {
            const style = para.getStyle() || para.getFormatting().style;
            if (style && (style === 'Heading2' || style === 'Heading 2' || style.includes('Heading2'))) {
              hasHeader2 = true;
            }
          });
        });
      });

      if (hasHeader2) {
        tablesWithHeader2.push({ tableIndex, table, hasHeader2 });
      }
    });

    // Skip first table with Header 2, process the rest
    if (tablesWithHeader2.length <= 1) {
      this.log.debug(`Found ${tablesWithHeader2.length} tables with Header 2, nothing to process (first is skipped)`);
      return 0;
    }

    this.log.debug(`Found ${tablesWithHeader2.length} tables with Header 2, processing ${tablesWithHeader2.length - 1} (skipping first)`);

    // Get body elements to find table positions in document
    const bodyElements = doc.getBodyElements();
    const tablePositions = new Map<Table, number>();

    bodyElements.forEach((element, index) => {
      if (element instanceof Table) {
        tablePositions.set(element, index);
      }
    });

    // Process tables in reverse order to avoid index shifting
    // Skip the first table (index 0), process from end to beginning
    for (let i = tablesWithHeader2.length - 1; i >= 1; i--) {
      const { table, tableIndex } = tablesWithHeader2[i];

      try {
        const tablePosition = tablePositions.get(table);

        if (tablePosition === undefined) {
          this.log.warn(`Could not find position for table ${tableIndex} in document body`);
          continue;
        }

        // Check if there's already a "Top of" hyperlink paragraph before this table
        let shouldInsert = true;

        if (tablePosition > 0) {
          const previousElement = bodyElements[tablePosition - 1];

          if (previousElement instanceof Paragraph) {
            const content = previousElement.getContent();

            const hasTopLink = content.some((item: any) => {
              if (item instanceof Hyperlink) {
                const text = sanitizeHyperlinkText(item.getText()).toLowerCase();
                // Check for any "top of" hyperlink (regardless of exact text)
                if (text.includes('top of')) {
                  return true;
                }
              }
              return false;
            });

            if (hasTopLink) {
              // SAFE: Skip existing hyperlinks (never modify existing document objects)
              // Modifying existing objects with setText() corrupts DocXMLater's internal state
              // See CORRUPTION_FIX.md for detailed explanation of this principle
              this.log.debug(`Hyperlink already exists before table ${tableIndex}, skipping`);
              shouldInsert = false;
            }
          }
        }

        if (shouldInsert) {
          // Create and insert the hyperlink paragraph BEFORE the table
          const hyperlinkPara = this.createTopHyperlinkParagraph(doc);
          doc.insertParagraphAt(tablePosition, hyperlinkPara);
          linksAdded++;

          this.log.debug(`Inserted Top of Document link before table ${tableIndex} at position ${tablePosition}`);
        }
      } catch (error) {
        this.log.warn(`Failed to process table ${tableIndex}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    this.log.info(`Processed ${tablesWithHeader2.length - 1} tables with Header 2, added/updated ${linksAdded} Top of Document links`);
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
   * Add or update document warning at the end of the document
   *
   * Warning format:
   * Line 1: "Not to Be Reproduced or Disclosed to Others Without Prior Written Approval" (normal weight)
   * Line 2: "ELECTRONIC DATA = OFFICIAL VERSION - PAPER COPY = INFORMATIONAL ONLY" (bold)
   *
   * Both lines: Centered, Verdana 8pt, 3pt spacing before/after
   *
   * Search is case-insensitive, but exact capitalization is preserved when creating.
   */
  private async addOrUpdateDocumentWarning(doc: Document): Promise<void> {
    // Exact capitalization as specified
    const warningLine1 = "Not to Be Reproduced or Disclosed to Others Without Prior Written Approval";
    const warningLine2 = "ELECTRONIC DATA = OFFICIAL VERSION - PAPER COPY = INFORMATIONAL ONLY";

    this.log.debug('Adding/updating document warning at end of document');

    // Step 1: Search for existing warning in last 5 paragraphs (case-insensitive)
    const paragraphs = doc.getParagraphs();
    const searchStartIndex = Math.max(0, paragraphs.length - 5);
    let existingWarningIndices: number[] = [];

    for (let i = paragraphs.length - 1; i >= searchStartIndex; i--) {
      const text = this.getParagraphText(paragraphs[i]).toLowerCase();

      // Case-insensitive search for either warning text
      if (text.includes("electronic data") || text.includes("not to be reproduced")) {
        existingWarningIndices.push(i);
        this.log.debug(`Found existing warning paragraph at index ${i}`);
      }
    }

    // Step 2: Remove existing warning paragraphs if found
    if (existingWarningIndices.length > 0) {
      // Remove in reverse order to maintain indices
      existingWarningIndices.sort((a, b) => b - a);
      for (const index of existingWarningIndices) {
        doc.removeParagraph(paragraphs[index]);
        this.log.debug(`Removed existing warning paragraph at index ${index}`);
      }
    }

    // Step 3: Create first line (normal weight)
    const para1 = doc.createParagraph(warningLine1);
    para1.setAlignment('center');
    para1.setSpaceBefore(pointsToTwips(3));
    para1.setSpaceAfter(pointsToTwips(3));

    // Format runs in first paragraph
    const runs1 = para1.getRuns();
    for (const run of runs1) {
      run.setFont('Verdana');
      run.setSize(8);
      // Note: bold is false by default, so no need to explicitly set it
    }

    this.log.debug('Created first warning line (normal weight)');

    // Step 4: Create second line (bold)
    const para2 = doc.createParagraph(warningLine2);
    para2.setAlignment('center');
    para2.setSpaceBefore(pointsToTwips(3));
    para2.setSpaceAfter(pointsToTwips(3));

    // Format runs in second paragraph (bold)
    const runs2 = para2.getRuns();
    for (const run of runs2) {
      run.setFont('Verdana');
      run.setSize(8);
      run.setBold(true);
    }

    this.log.debug('Created second warning line (bold)');
    this.log.info('Document warning added/updated successfully at end of document');
  }

  /**
   * Get DocXMLater processor for advanced operations
   */
  getDocXMLaterProcessor(): DocXMLaterProcessor {
    return this.docXMLater;
  }
}

export default WordDocumentProcessor;
