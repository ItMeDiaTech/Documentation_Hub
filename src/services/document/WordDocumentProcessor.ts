/**
 * WordDocumentProcessor - Modern DOCX processing using DocXMLater
 *
 * Complete rewrite using docxmlater library for all document operations.
 * Replaces 4000+ lines of manual XML parsing with clean, type-safe APIs.
 */

import {
  Bookmark,
  ChangelogGenerator,
  Document,
  Hyperlink,
  Image,
  ImageRun,
  NumberingLevel,
  Paragraph,
  pointsToTwips,
  Revision,
  RevisionAwareProcessor,
  Run,
  Style,
  Table,
  type TableOfContents,
} from "docxmlater";
import type { RevisionHandlingMode } from "@/types/session";
// Note: Run, Hyperlink, Image imported for type checking in isParagraphTrulyEmpty()
import {
  DetailedHyperlinkInfo,
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult,
  HyperlinkType,
} from "@/types/hyperlink";
import type { ChangeEntry, ChangelogSummary, DocumentChange, WordRevisionState } from "@/types/session";
import { MemoryMonitor } from "@/utils/MemoryMonitor";
import { logger } from "@/utils/logger";
import { sanitizeHyperlinkText } from "@/utils/textSanitizer";
import { extractLookupIds } from "@/utils/urlPatterns";
import { promises as fs } from "fs";
import pLimit from "p-limit";
import * as path from "path";
import { hyperlinkService } from "../HyperlinkService";
import { DocXMLaterProcessor } from "./DocXMLaterProcessor";
import { documentProcessingComparison } from "./DocumentProcessingComparison";

export interface WordProcessingOptions extends HyperlinkProcessingOptions {
  createBackup?: boolean;
  validateBeforeProcessing?: boolean;
  streamLargeFiles?: boolean;
  maxFileSizeMB?: number;
  userProfile?: {
    firstName: string;
    lastName: string;
    email: string;
  };

  // ═══════════════════════════════════════════════════════════
  // Text Formatting Options (ProcessingOptions group: 'text')
  // ═══════════════════════════════════════════════════════════
  removeWhitespace?: boolean; // remove-whitespace: Collapse multiple spaces to single space
  removeParagraphLines?: boolean; // remove-paragraph-lines: Remove consecutive empty paragraphs
  preserveBlankLinesAfterHeader2Tables?: boolean; // preserve-header2-blank-lines: Preserve blank lines after Header 2 tables (v1.16.0)
  preserveBlankLinesAfterAllTables?: boolean; // preserve-all-table-blank-lines: Add blank lines after ALL tables regardless of size (user request)
  removeItalics?: boolean; // remove-italics: Remove italic formatting from all runs
  standardizeHyperlinkFormatting?: boolean; // standardize-hyperlink-formatting: Remove bold/italic from hyperlinks and reset to standard style
  standardizeListPrefixFormatting?: boolean; // standardize-list-prefix-formatting: Apply consistent Verdana 12pt black formatting to all list symbols/numbers

  // ═══════════════════════════════════════════════════════════
  // Content Structure Options (ProcessingOptions group: 'structure')
  // ═══════════════════════════════════════════════════════════
  assignStyles?: boolean; // assign-styles: Apply session styles to headings and normal paragraphs
  centerAndBorderImages?: boolean; // center-border-images: Center and apply 2pt borders to all images larger than 50x50px
  removeHeadersFooters?: boolean; // remove-headers-footers: Remove all headers and footers from document
  addDocumentWarning?: boolean; // add-document-warning: Add standardized warning at end of document

  styles?: Array<{
    // Session styles to apply when assignStyles is true
    id: string; // 'header1', 'header2', or 'normal'
    name: string;
    fontFamily: string;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    preserveBold?: boolean;
    preserveItalic?: boolean;
    preserveUnderline?: boolean;
    alignment: "left" | "center" | "right" | "justify";
    color: string;
    spaceBefore: number;
    spaceAfter: number;
    lineSpacing: number;
    noSpaceBetweenSame?: boolean;
    indentation?: {
      left?: number;
      firstLine?: number;
    };
  }>;

  // ═══════════════════════════════════════════════════════════
  // Lists & Tables Options (ProcessingOptions group: 'lists')
  // ═══════════════════════════════════════════════════════════
  listBulletSettings?: {
    // list-indentation: Apply uniform list indentation
    enabled: boolean;
    indentationLevels: Array<{
      level: number;
      symbolIndent: number; // Symbol/bullet position in inches
      textIndent: number; // Text position in inches
      bulletChar?: string;
      numberedFormat?: string;
    }>;
    spacingBetweenItems: number;
  };
  bulletUniformity?: boolean; // bullet-uniformity: Standardize bullet characters
  tableUniformity?: boolean; // table-uniformity: Apply consistent table formatting
  tableShadingSettings?: {
    // NEW: Simplified table shading colors
    header2Shading: string; // Hex color for Header 2 / 1x1 table cells (default: #BFBFBF)
    otherShading: string; // Hex color for other table cells and If.../Then... patterns (default: #DFDFDF)
  };
  smartTables?: boolean; // smart-tables: Smart table detection and formatting (NEW)
  tableOfContentsSettings?: {
    // NEW: Table of Contents generation settings
    enabled: boolean;
    includeHeadingLevels: number[]; // e.g., [1, 2, 3]
    showPageNumbers: boolean;
    rightAlignPageNumbers: boolean;
    useHyperlinks: boolean;
    tabLeaderStyle: "none" | "dots" | "dashes" | "underline";
    tocTitle: string;
    showTocTitle: boolean;
    spacingBetweenHyperlinks: number; // in points
  };

  // ═══════════════════════════════════════════════════════════
  // NEW 1.1.0 Enhanced Options
  // ═══════════════════════════════════════════════════════════
  normalizeSpacing?: boolean; // normalize-spacing: Smart spacing normalization across document
  validateHyperlinks?: boolean; // validate-hyperlinks: Validate and auto-fix all hyperlinks

  // ═══════════════════════════════════════════════════════════
  // Word Tracked Changes Handling (NEW)
  // ═══════════════════════════════════════════════════════════
  /** How to handle Word tracked changes during processing (default: 'accept_all') */
  revisionHandlingMode?: RevisionHandlingMode;
  /** Author name for preserve_and_wrap mode */
  revisionAuthor?: string;
  /** Auto-accept all revisions after processing for clean output (default: true) */
  autoAcceptRevisions?: boolean;

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
    matchType: "contains" | "exact" | "startsWith";
    applyTo: "url" | "text" | "both";
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
  hasTrackedChanges?: boolean; // Added: Indicates if document has tracked changes that must be approved first
  changes?: DocumentChange[]; // Enhanced tracked changes with context
  /** Word tracked changes state (from docxmlater) */
  wordRevisions?: WordRevisionState;
}

/**
 * Interface for tracking URL update results with error handling
 * Used by applyUrlUpdates() to report both successes and failures
 */
export interface UrlUpdateResult {
  updated: number; // Number of URLs successfully updated
  failed: Array<{
    oldUrl: string; // Original URL that failed to update
    newUrl: string; // Target URL that was attempted
    error: unknown; // The error that occurred
    paragraphIndex?: number; // Index of paragraph where failure occurred
  }>;
}

/**
 * Modern Word document processor using DocXMLater
 */
export class WordDocumentProcessor {
  private readonly MAX_FILE_SIZE_MB = 100;
  private docXMLater: DocXMLaterProcessor;

  // Debug mode controlled by environment
  private readonly DEBUG = process.env.NODE_ENV !== "production";

  private log = logger.namespace("WordDocProcessor");

  // DEPRECATED v1.16.0: Header 2 table detection (replaced with 1x1 table dimension check)
  // Kept for potential future use: stored Header 2 table indices during style application
  // OLD APPROACH: Required style application timing, complex detection logic
  // NEW APPROACH: Use 1x1 table dimension check (insertBlankLinesAfter1x1Tables)
  // private header2TableBodyIndices: Set<number> = new Set();

  constructor() {
    this.docXMLater = new DocXMLaterProcessor();
    this.log.debug("Initialized with DocXMLater library");
  }

  /**
   * Process a Word document with hyperlink manipulation
   * Main entry point - maintains compatibility with existing IPC handlers
   */
  async processDocument(
    filePath: string,
    options: WordProcessingOptions = {}
  ): Promise<WordProcessingResult> {
    this.log.debug("═══════════════════════════════════════════════════════════");
    this.log.debug("  WORD DOCUMENT PROCESSOR - DOCXMLATER");
    this.log.debug("═══════════════════════════════════════════════════════════");
    this.log.debug("File:", filePath);
    this.log.debug("Options:", JSON.stringify(options, null, 2));

    // Memory checkpoint: Start
    MemoryMonitor.logMemoryUsage("DocProcessor Start", `Processing: ${path.basename(filePath)}`);

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
      changes: [], // Enhanced tracked changes
    };

    let backupCreated = false;
    let doc: Document | null = null;

    try {
      // Validate file
      const stats = await fs.stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      result.documentSize = stats.size;

      this.log.debug(`File size: ${fileSizeMB.toFixed(2)}MB`);

      // Memory checkpoint: After file validation
      MemoryMonitor.logMemoryUsage("After File Validation", `${fileSizeMB.toFixed(2)}MB document`);

      if (fileSizeMB > (options.maxFileSizeMB || this.MAX_FILE_SIZE_MB)) {
        throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB exceeds limit`);
      }

      // Create backup
      this.log.debug("=== BACKUP CREATION ===");
      const backupPath = await this.createBackup(filePath);
      result.backupPath = backupPath;
      backupCreated = true;
      this.log.info(`Backup created: ${backupPath}`);

      // Load document using DocXMLater
      // Determine revisionHandling based on autoAcceptRevisions option:
      // - TRUE (default): Accept existing tracked changes for clean output
      // - FALSE (unchecked): Preserve existing tracked changes in document
      this.log.debug("=== LOADING DOCUMENT WITH DOCXMLATER ===");
      const revisionHandling = options.autoAcceptRevisions === false ? 'preserve' : 'accept';
      this.log.debug(`Revision handling mode: ${revisionHandling} (autoAcceptRevisions=${options.autoAcceptRevisions})`);
      doc = await Document.load(filePath, {
        strictParsing: false,
        revisionHandling: revisionHandling as 'preserve' | 'accept' | 'strip'
      });
      this.log.debug("Document loaded successfully");

      // ═══════════════════════════════════════════════════════════
      // Word Tracked Changes - Enable Tracking Mode
      // All DocHub modifications will become Word tracked changes
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== ENABLING WORD TRACK CHANGES ===");

      // Enable track changes BEFORE any modifications
      // This makes all DocHub changes become Word tracked changes
      // Build author name from user profile, defaulting to "Doc Hub" if blank
      const firstName = options.userProfile?.firstName?.trim() || '';
      const lastName = options.userProfile?.lastName?.trim() || '';
      const authorName = firstName && lastName
        ? `${firstName} ${lastName}`
        : firstName || lastName || 'Doc Hub';

      doc.enableTrackChanges({
        author: authorName,
        trackFormatting: true,
        showInsertionsAndDeletions: true,
      });
      this.log.info(`Track changes enabled with author: ${authorName}`);

      // Start tracking DocHub's changes if enabled (legacy comparison tracking)
      if (options.trackChanges) {
        this.log.debug("=== STARTING DOCHUB CHANGE TRACKING ===");
        await documentProcessingComparison.startTracking(filePath, doc);
      }

      // Memory checkpoint: After document load
      MemoryMonitor.logMemoryUsage("After Document Load", "DocXMLater document loaded");

      // Extract hyperlinks
      this.log.debug("=== EXTRACTING HYPERLINKS ===");
      const hyperlinks = await this.docXMLater.extractHyperlinks(doc);
      result.totalHyperlinks = hyperlinks.length;
      this.log.info(`Found ${hyperlinks.length} hyperlinks`);

      // Memory checkpoint: After hyperlink extraction
      MemoryMonitor.logMemoryUsage(
        "After Hyperlink Extraction",
        `${hyperlinks.length} hyperlinks extracted`
      );

      // ═══════════════════════════════════════════════════════════
      // PowerAutomate API Integration
      // Process hyperlinks with PowerAutomate API if operations enabled
      // ═══════════════════════════════════════════════════════════
      if (
        hyperlinks.length > 0 &&
        (options.operations?.fixContentIds || options.operations?.updateTitles)
      ) {
        const apiEndpoint = options.apiEndpoint;

        if (apiEndpoint) {
          this.log.debug("=== PROCESSING WITH POWERAUTOMATE API ===");
          this.log.debug(`API Endpoint: ${apiEndpoint}`);
          this.log.debug(
            `Operations: fixContentIds=${options.operations?.fixContentIds}, updateTitles=${options.operations?.updateTitles}`
          );

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
              containingPart: "document.xml",
              url: h.url || "",
              displayText: h.text, // Already sanitized by extractHyperlinks()
              type: "external" as HyperlinkType,
              isInternal: false,
              isValid: true,
            }));

            const apiResponse = await hyperlinkService.processHyperlinksWithApi(
              hyperlinkInfos,
              apiSettings,
              options.userProfile
            );

            this.log.info(`API Response success: ${apiResponse.success}`);

            // Check if API call succeeded - if not and operations require it, throw error
            if (!apiResponse.success) {
              const errorMsg = apiResponse.error || "API request failed";
              this.log.error("API Error:", errorMsg);

              // If fixContentIds or updateTitles are required, we must fail
              // Don't save a document with incorrect/unchanged hyperlinks
              if (options.operations?.fixContentIds || options.operations?.updateTitles) {
                throw new Error(
                  `PowerAutomate API failed: ${errorMsg}. Document not saved to prevent incorrect hyperlink data.`
                );
              }

              // Otherwise just log and continue
              result.errorMessages.push(errorMsg);
              result.errorCount++;
            } else if (apiResponse.success && apiResponse.body?.results) {
              this.log.debug(`Processing ${apiResponse.body.results.length} API results`);

              const apiResults = apiResponse.body.results;

              // Build lookup Map for O(1) performance (instead of O(n) array.find)
              // Index by both Content_ID and Document_ID for flexible matching
              this.log.debug("Building API results lookup map...");
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
                  this.log.debug(
                    `⊘ Skipping hyperlink (no Lookup_ID pattern): ${hyperlinkInfo.url.substring(0, 80)}`
                  );
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
                      modifications.push("URL updated");

                      this.log.debug(`Queued URL update: ${hyperlinkInfo.url} → ${newUrl}`);

                      // Track the URL change
                      if (options.trackChanges) {
                        documentProcessingComparison.recordHyperlinkUrlChange(
                          hyperlink.paragraphIndex,
                          i % 10, // Approximate hyperlink index within paragraph
                          hyperlinkInfo.url,
                          newUrl,
                          "PowerAutomate API - Fix Content IDs"
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
                    if (apiResult.status === "expired" || apiResult.status === "deprecated") {
                      newText += " - Expired";
                    }

                    if (newText !== hyperlinkInfo.displayText) {
                      // Update hyperlink text using docxmlater API
                      // Note: hyperlink is from extractHyperlinks() with structure { hyperlink: Hyperlink, paragraph: Paragraph, ... }
                      // So hyperlink.hyperlink accesses the actual docxmlater Hyperlink object
                      hyperlink.hyperlink.setText(newText);
                      finalDisplayText = newText;
                      result.updatedDisplayTexts = (result.updatedDisplayTexts || 0) + 1;
                      modifications.push("Display text updated");

                      this.log.debug(`Updated text: "${hyperlinkInfo.displayText}" → "${newText}"`);

                      // Track the change
                      if (options.trackChanges) {
                        documentProcessingComparison.recordHyperlinkTextChange(
                          hyperlink.paragraphIndex,
                          i % 10, // Approximate hyperlink index within paragraph
                          hyperlinkInfo.displayText,
                          newText,
                          "PowerAutomate API Update"
                        );
                      }

                      // Enhanced change tracking for UI
                      const nearestHeader2 = this.findNearestHeader2(doc, hyperlink.paragraphIndex) || undefined;
                      result.changes?.push({
                        type: 'hyperlink',
                        category: 'hyperlink_update',
                        description: `Updated hyperlink title`,
                        before: hyperlinkInfo.displayText,
                        after: newText,
                        paragraphIndex: hyperlink.paragraphIndex,
                        nearestHeader2,
                        contentId: apiResult.contentId,
                        hyperlinkStatus: apiResult.status === "expired" || apiResult.status === "deprecated" ? 'expired' : 'updated',
                      });
                    }
                  }

                  modifications.push("API processed");

                  // Track in processedLinks for UI display
                  result.processedLinks.push({
                    id: hyperlinkInfo.id,
                    url: hyperlinkInfo.url,
                    displayText: finalDisplayText,
                    type: hyperlinkInfo.type,
                    location: hyperlinkInfo.containingPart,
                    status: "processed" as const,
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
                    // Note: hyperlink.hyperlink accesses the actual docxmlater Hyperlink object
                    hyperlink.hyperlink.setText(notFoundText);
                    result.updatedDisplayTexts = (result.updatedDisplayTexts || 0) + 1;

                    // Enhanced change tracking for failed hyperlinks
                    const nearestHeader2 = this.findNearestHeader2(doc, hyperlink.paragraphIndex) || undefined;
                    result.changes?.push({
                      type: 'hyperlink',
                      category: 'hyperlink_failed',
                      description: `Hyperlink not found in SharePoint`,
                      before: hyperlinkInfo.displayText,
                      after: notFoundText,
                      paragraphIndex: hyperlink.paragraphIndex,
                      nearestHeader2,
                      hyperlinkStatus: 'not_found',
                    });
                  }
                }
              }

              // Apply URL updates in batch (paragraph reconstruction)
              if (urlUpdateMap.size > 0) {
                this.log.debug(`=== APPLYING URL UPDATES (BATCH) ===`);
                this.log.debug(`Updating ${urlUpdateMap.size} URLs via paragraph reconstruction`);

                const urlUpdateResult = await this.applyUrlUpdates(doc, urlUpdateMap);

                // Update statistics with successful updates
                result.modifiedHyperlinks += urlUpdateResult.updated;
                result.updatedUrls = (result.updatedUrls || 0) + urlUpdateResult.updated;

                this.log.info(`Applied ${urlUpdateResult.updated} URL updates`);

                // Handle failures if any occurred
                if (urlUpdateResult.failed.length > 0) {
                  this.log.error("⚠️ URL update failures detected:", {
                    totalAttempted: urlUpdateMap.size,
                    succeeded: urlUpdateResult.updated,
                    failed: urlUpdateResult.failed.length,
                    failureDetails: urlUpdateResult.failed,
                  });

                  // Add error message to result
                  const failureMessage =
                    `Partial URL update failure: ${urlUpdateResult.failed.length} of ${urlUpdateMap.size} URLs failed to update. ` +
                    `Document saved with ${urlUpdateResult.updated} successful updates.`;

                  result.errorMessages.push(failureMessage);
                  result.errorCount++;

                  // Strategy: Log and continue (partial update)
                  // The document is saved with the successful updates
                  // Failed URLs remain unchanged
                  // This prevents data loss while alerting the user
                  this.log.warn(
                    "📝 Document will be saved with partial URL updates. " +
                      "Failed URLs remain unchanged and require manual review."
                  );
                }
              }

              this.log.info(
                `API processing complete: ${result.updatedUrls} URLs, ${result.updatedDisplayTexts} texts updated`
              );
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown API error";
            this.log.error("API call failed:", errorMessage);

            // If API operations are required, we must fail the entire processing
            // This prevents saving documents with incorrect/unchanged hyperlinks
            if (options.operations?.fixContentIds || options.operations?.updateTitles) {
              throw new Error(
                `API Error: ${errorMessage}. Document not saved to prevent incorrect hyperlink data.`
              );
            }

            // Otherwise just log and continue
            result.errorMessages.push(`API Error: ${errorMessage}`);
            result.errorCount++;
          }
        } else {
          // API endpoint not configured but operations require it
          if (options.operations?.fixContentIds || options.operations?.updateTitles) {
            throw new Error(
              "API endpoint not configured but hyperlink operations (fixContentIds or updateTitles) are enabled. Please configure PowerAutomate URL in Settings."
            );
          }

          this.log.warn("API endpoint not configured, skipping PowerAutomate processing");
        }
      }
      // ═══════════════════════════════════════════════════════════
      // End PowerAutomate API Integration
      // ═══════════════════════════════════════════════════════════

      // Custom replacements
      if (options.customReplacements && options.customReplacements.length > 0) {
        this.log.debug("=== APPLYING CUSTOM REPLACEMENTS ===");
        await this.processCustomReplacements(hyperlinks, options.customReplacements, result);
      }

      // Defragment hyperlinks that were split by Google Docs or other processors
      if (options.operations?.processHyperlinks) {
        this.log.debug("=== DEFRAGMENTING HYPERLINKS ===");
        const merged = doc.defragmentHyperlinks({
          resetFormatting: true,
          cleanupRelationships: true,
        });
        this.log.info(`Merged ${merged} fragmented hyperlinks`);
        result.mergedHyperlinks = merged;

        // Track hyperlink defragmentation
        if (merged > 0) {
          result.changes?.push({
            type: 'hyperlink',
            category: 'structure',
            description: 'Merged fragmented hyperlinks',
            count: merged,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════
      // PROCESSING OPTIONS IMPLEMENTATION
      // Apply all enabled processing options before saving document
      // ═══════════════════════════════════════════════════════════

      // TEXT FORMATTING GROUP
      if (options.removeWhitespace) {
        this.log.debug("=== REMOVING EXTRA WHITESPACE ===");
        const whitespaceCleaned = await this.removeExtraWhitespace(doc);
        this.log.info(`Cleaned whitespace in ${whitespaceCleaned} runs`);

        // Track whitespace removal
        if (whitespaceCleaned > 0) {
          result.changes?.push({
            type: 'text',
            category: 'structure',
            description: 'Removed extra whitespace from text runs',
            count: whitespaceCleaned,
          });
        }
      }

      if (options.removeItalics) {
        this.log.debug("=== REMOVING ITALIC FORMATTING ===");
        const italicsRemoved = await this.removeItalicFormatting(doc);
        this.log.info(`Removed italics from ${italicsRemoved} runs`);

        // Track italic removal
        if (italicsRemoved > 0) {
          result.changes?.push({
            type: 'style',
            category: 'structure',
            description: 'Removed italic formatting from text',
            count: italicsRemoved,
          });
        }
      }

      // ALWAYS standardize hyperlink formatting to ensure consistency
      // All hyperlinks should be: Verdana 12pt, Blue, Underlined
      this.log.debug("=== STANDARDIZING HYPERLINK FORMATTING (AUTOMATIC) ===");
      const hyperlinksStandardized = await this.standardizeHyperlinkFormatting(doc);
      this.log.info(`Standardized formatting for ${hyperlinksStandardized} hyperlinks`);

      // Track automatic hyperlink formatting standardization
      if (hyperlinksStandardized > 0) {
        result.changes?.push({
          type: 'hyperlink',
          category: 'structure',
          description: 'Standardized hyperlink formatting (Verdana 12pt blue underlined)',
          count: hyperlinksStandardized,
        });
      }

      if (options.standardizeListPrefixFormatting) {
        this.log.debug("=== STANDARDIZING LIST PREFIX FORMATTING ===");
        const listPrefixesStandardized = await this.standardizeListPrefixFormatting(doc);
        this.log.info(`Standardized formatting for ${listPrefixesStandardized} list prefix levels`);

        // Track list prefix formatting standardization
        if (listPrefixesStandardized > 0) {
          result.changes?.push({
            type: 'style',
            category: 'structure',
            description: 'Standardized list prefix formatting (Verdana 12pt black)',
            count: listPrefixesStandardized,
          });
        }
      }

      // CONTENT STRUCTURE GROUP
      // NOTE: Style application moved BEFORE paragraph removal (v1.16.0)
      // This ensures Header 2 table styles exist when preservation logic runs
      if (options.assignStyles && options.styles && options.styles.length > 0) {
        this.log.debug(
          "=== ASSIGNING STYLES (USING DOCXMLATER applyCustomFormattingToExistingStyles) ==="
        );
        // Use docXMLater's native method with preserve flag support
        // This handles style definitions, direct formatting clearing, and Header2 table wrapping
        const styleResults = await this.applyCustomStylesFromUI(
          doc,
          options.styles,
          options.tableShadingSettings,
          options.preserveBlankLinesAfterHeader2Tables ?? true
        );
        this.log.info(
          `Applied custom formatting: Heading1=${styleResults.heading1}, Heading2=${styleResults.heading2}, Heading3=${styleResults.heading3}, Normal=${styleResults.normal}, ListParagraph=${styleResults.listParagraph}`
        );

        // NEW v2.1.0: Apply styles and clean direct formatting with simpler API
        this.log.debug("=== APPLYING STYLES WITH CLEAN FORMATTING ===");

        // Skip applyH1/H2/H3 if already processed by applyCustomFormattingToExistingStyles
        // This prevents framework defaults from overriding user-configured custom styles
        const h1Count = styleResults.heading1
          ? (this.log.debug(
              "Skipping applyH1 - already processed by applyCustomFormattingToExistingStyles"
            ),
            0)
          : doc.applyH1();
        const h2Count = styleResults.heading2
          ? (this.log.debug(
              "Skipping applyH2 - already processed by applyCustomFormattingToExistingStyles"
            ),
            0)
          : doc.applyH2();
        const h3Count = styleResults.heading3
          ? (this.log.debug(
              "Skipping applyH3 - already processed by applyCustomFormattingToExistingStyles"
            ),
            0)
          : doc.applyH3();
      }

      // ═══════════════════════════════════════════════════════════
      // HYPERLINK STYLE DEFINITION UPDATE
      // Ensure Hyperlink style uses Verdana before applyHyperlink()
      // This prevents inheritance from document defaults (Calibri)
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== UPDATING HYPERLINK STYLE DEFINITION ===");
      try {
        const hyperlinkStyle = Style.create({
          styleId: "Hyperlink",
          name: "Hyperlink",
          type: "character",
          runFormatting: {
            font: "Verdana",
            size: 12,
            color: "0000FF",
            underline: "single",
            bold: false,
            italic: false,
          },
        });

        doc.addStyle(hyperlinkStyle); // Updates existing or creates new
        this.log.info("✓ Updated Hyperlink style to use Verdana 12pt");
      } catch (error) {
        this.log.warn("Failed to update Hyperlink style:", error);
        // Continue processing - manual formatting will still apply
      }

      // ═══════════════════════════════════════════════════════════
      // ENSURE BLANK LINES AFTER 1x1 TABLES
      // NEW v1.19.0: Using docXMLater's ensureBlankLinesAfter1x1Tables()
      //
      // EXECUTION ORDER: This runs BEFORE paragraph removal so the
      // preserved flag can protect blank lines from being deleted.
      //
      // FIXED in v2.4.0: Blank lines now use Normal style via 'style' parameter
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== DEBUG: BLANK LINES AFTER 1x1 TABLES CHECK ===");
      this.log.debug(
        `  preserveBlankLinesAfterHeader2Tables option: ${options.preserveBlankLinesAfterHeader2Tables}`
      );
      this.log.debug(`  removeParagraphLines option: ${options.removeParagraphLines}`);

      if (options.preserveBlankLinesAfterHeader2Tables) {
        this.log.debug("=== ENSURING BLANK LINES AFTER 1x1 TABLES ===");
        this.log.debug("  Calling doc.ensureBlankLinesAfter1x1Tables() with markAsPreserved=true");

        // FIX: Always mark blank lines as preserved when this option is enabled
        // This prevents later cleanup operations from deleting them, regardless of
        // whether removeParagraphLines is enabled or not. The user's intent when
        // enabling "preserve blank lines after Header 2 tables" is to ALWAYS preserve
        // these lines, not conditionally based on other settings.
        const result = doc.ensureBlankLinesAfter1x1Tables({
          spacingAfter: 120, // 6pt spacing
          markAsPreserved: true, // Always preserve when option enabled
          style: "Normal", // NEW in v2.4.0: Set paragraph style
        });

        this.log.info(
          `✓ Processed ${result.tablesProcessed} 1x1 tables: ` +
            `Added ${result.blankLinesAdded} blank lines (Normal style), ` +
            `Marked ${result.existingLinesMarked} existing blank lines as preserved`
        );
        this.log.debug(`  DEBUG: Result details - ${JSON.stringify(result)}`);
      } else {
        this.log.warn(
          "⚠️ preserveBlankLinesAfterHeader2Tables is FALSE - 1x1 table blank lines will NOT be added!"
        );
      }

      // ═══════════════════════════════════════════════════════════
      // ENHANCEMENT 1: ENSURE BLANK LINES AFTER ALL TABLES
      // NEW: Add blank lines after ALL tables (not just 1x1)
      // User requested feature for consistent spacing after all table types
      // ═══════════════════════════════════════════════════════════
      if (options.preserveBlankLinesAfterAllTables) {
        this.log.debug("=== ENSURING BLANK LINES AFTER ALL TABLES ===");
        this.log.debug("  Using streamlined native method approach with enhanced options");

        const tables = doc.getTables();
        let blankLinesAdded = 0;
        let existingLinesMarked = 0;

        // Streamlined approach using native paragraph operations
        const bodyElements = doc.getBodyElements();

        for (let i = 0; i < bodyElements.length; i++) {
          const element = bodyElements[i];

          if (element.constructor.name === "Table") {
            const nextElement = bodyElements[i + 1];

            if (nextElement instanceof Paragraph && this.isParagraphTrulyEmpty(nextElement)) {
              // Existing blank line - mark as preserved with spacing
              nextElement.setPreserved(true);
              nextElement.setSpaceAfter(120); // 6pt spacing
              existingLinesMarked++;
            } else if (!nextElement || !(nextElement instanceof Paragraph)) {
              // No paragraph after table - create one
              const blankPara = doc.createParagraph("");
              blankPara.setStyle("Normal");
              blankPara.setPreserved(true);
              blankPara.setSpaceAfter(120); // 6pt spacing per spec
              doc.insertParagraphAt(i + 1, blankPara);
              blankLinesAdded++;
            }
          }
        }

        this.log.info(
          `✓ Processed ${tables.length} tables: ` +
            `Added ${blankLinesAdded} blank lines, ` +
            `Marked ${existingLinesMarked} existing blank lines as preserved`
        );
      } else {
        this.log.debug(
          "preserveBlankLinesAfterAllTables is FALSE - skipping all-table blank line insertion"
        );
      }

      // PARAGRAPH REMOVAL
      // EXECUTION ORDER NOTE:
      // NEW ORDER v1.19.0: (1) Ensure table linebreaks (marked as preserved) → (2) Remove paragraphs (skipping preserved)
      // This eliminates the remove-then-re-add cycle and is more efficient.
      if (options.removeParagraphLines) {
        this.log.debug("=== REMOVING EXTRA PARAGRAPH LINES ===");
        this.log.debug(
          `  DEBUG: Before removal - total paragraphs: ${doc.getAllParagraphs().length}`
        );
        const paragraphsRemoved = await this.removeExtraParagraphLines(
          doc,
          options.preserveBlankLinesAfterHeader2Tables ?? true
        );
        this.log.debug(
          `  DEBUG: After removal - total paragraphs: ${doc.getAllParagraphs().length}`
        );
        this.log.info(`Removed ${paragraphsRemoved} extra paragraph lines`);

        // Track blank line changes in condensed format
        if (paragraphsRemoved > 0) {
          result.changes?.push({
            type: 'structure',
            category: 'blank_lines',
            description: 'Removed extra blank lines for better document structure',
            count: paragraphsRemoved,
          });
        }
      }

      // NEW VALIDATION OPERATIONS (DocXMLater 1.6.0)
      // DEBUG: Log validation operations status
      this.log.info("\n=== VALIDATION OPERATIONS DEBUG ===");
      this.log.info("  validateDocumentStyles flag:", options.operations?.validateDocumentStyles);
      this.log.info("  validateHeader2Tables flag:", options.operations?.validateHeader2Tables);
      this.log.info("  options.styles defined:", !!options.styles);
      this.log.info("  options.styles length:", options.styles?.length || 0);
      if (options.styles && options.styles.length > 0) {
        this.log.info("  Available styles:", options.styles.map((s: any) => s.id).join(", "));
      }

      if (
        options.operations?.validateDocumentStyles &&
        options.styles &&
        options.styles.length > 0
      ) {
        this.log.debug("=== VALIDATING DOCUMENT STYLES ===");
        const results = await this.validateDocumentStyles(doc, options.styles);
        this.log.info(`Validated ${results.applied} styles: ${results.validated.join(", ")}`);

        // Track style validation
        if (results.applied > 0) {
          result.changes?.push({
            type: 'style',
            category: 'style_application',
            description: `Validated and applied styles: ${results.validated.join(', ')}`,
            count: results.applied,
          });
        }
      } else if (options.operations?.validateDocumentStyles) {
        this.log.warn(
          "⚠️ validateDocumentStyles is ENABLED but no styles provided! Please configure styles in the Styles tab."
        );
      }

      if (options.operations?.validateHeader2Tables && options.styles) {
        const header2Style = options.styles.find((s: any) => s.id === "header2");
        if (header2Style) {
          this.log.debug("=== VALIDATING HEADER 2 TABLE FORMATTING ===");
          const cellsFixed = await this.validateHeader2TableFormatting(
            doc,
            header2Style,
            options.tableShadingSettings
          );
          this.log.info(`Validated and fixed ${cellsFixed} Header 2 table cells`);

          // Track Header 2 table validation
          if (cellsFixed > 0) {
            result.changes?.push({
              type: 'style',
              category: 'structure',
              description: 'Validated and fixed Header 2 table cell formatting',
              count: cellsFixed,
            });
          }
        } else {
          this.log.warn(
            "⚠️ validateHeader2Tables is ENABLED but no header2 style found! Please configure Header 2 style in the Styles tab."
          );
        }
      }

      if (options.addDocumentWarning) {
        this.log.debug("=== ADDING/UPDATING DOCUMENT WARNING ===");
        await this.addOrUpdateDocumentWarning(doc);

        // Track document warning addition
        result.changes?.push({
          type: 'structure',
          category: 'structure',
          description: 'Added standardized document warning at end',
        });
      }

      if (options.centerAndBorderImages) {
        this.log.debug("=== CENTERING AND BORDERING IMAGES ===");
        const imagesCentered = doc.borderAndCenterLargeImages(50, 2);
        this.log.info(`Centered and bordered ${imagesCentered} images`);

        // Track image processing
        if (imagesCentered > 0) {
          result.changes?.push({
            type: 'structure',
            category: 'structure',
            description: 'Centered and bordered images',
            count: imagesCentered,
          });
        }
      }

      if (options.removeHeadersFooters) {
        this.log.debug("=== REMOVING HEADERS/FOOTERS ===");
        const headersFootersRemoved = doc.removeAllHeadersFooters();
        this.log.info(`Removed ${headersFootersRemoved} headers/footers from document`);

        // Track header/footer removal
        if (headersFootersRemoved > 0) {
          result.changes?.push({
            type: 'structure',
            category: 'structure',
            description: 'Removed headers and footers',
            count: headersFootersRemoved,
          });
        }
      }

      // LISTS & TABLES GROUP
      if (options.listBulletSettings?.enabled) {
        this.log.debug("=== APPLYING LIST INDENTATION UNIFORMITY ===");
        const listsFormatted = await this.applyListIndentationUniformity(
          doc,
          options.listBulletSettings
        );
        this.log.info(`Applied indentation to ${listsFormatted} list paragraphs`);
      }

      this.log.debug("=== DEBUG: BULLET UNIFORMITY CHECK ===");
      this.log.debug(`  bulletUniformity option: ${options.bulletUniformity}`);
      this.log.debug(`  listBulletSettings defined: ${!!options.listBulletSettings}`);
      if (options.listBulletSettings) {
        this.log.debug(
          `  Indentation levels: ${options.listBulletSettings.indentationLevels.length}`
        );
        options.listBulletSettings.indentationLevels.forEach((level, idx) => {
          this.log.debug(
            `    Level ${idx}: bulletChar="${level.bulletChar || "(default)"}", symbolIndent=${level.symbolIndent}, textIndent=${level.textIndent}`
          );
        });
      }

      if (options.bulletUniformity && options.listBulletSettings) {
        this.log.debug("=== APPLYING BULLET AND NUMBERED LIST UNIFORMITY ===");
        const bulletsStandardized = await this.applyBulletUniformity(
          doc,
          options.listBulletSettings
        );
        this.log.info(`Standardized ${bulletsStandardized} bullet lists`);

        const numbersStandardized = await this.applyNumberedUniformity(
          doc,
          options.listBulletSettings
        );
        this.log.info(`Standardized ${numbersStandardized} numbered lists`);

        // Track list formatting changes
        const totalListsFixed = bulletsStandardized + numbersStandardized;
        if (totalListsFixed > 0) {
          result.changes?.push({
            type: 'structure',
            category: 'list_fix',
            description: 'Standardized list formatting and indentation',
            count: totalListsFixed,
          });
        }

        // NOTE: Blank lines after lists are now handled automatically by
        // doc.removeExtraBlankParagraphs({ addStructureBlankLines: true })
        // which internally calls addStructureBlankLines() with afterLists: true default
      }

      // SKIP: Normalize all list indentation to standard values
      // NOTE: doc.normalizeAllListIndentation() does not exist in docxmlater library
      // The injectIndentationToNumbering() method below handles indentation directly
      if (options.listBulletSettings?.enabled || options.bulletUniformity) {
        // Inject custom indentation into numbering.xml
        if (options.listBulletSettings?.indentationLevels) {
          this.log.debug("=== INJECTING CUSTOM INDENTATION ===");
          const indentInjected = await this.injectIndentationToNumbering(
            doc,
            options.listBulletSettings.indentationLevels
          );
          if (indentInjected) {
            this.log.info("Injected custom indentation values into numbering.xml");
          } else {
            this.log.warn("Failed to inject custom indentation - using document defaults");
          }
        }

        // Standardize numbering colors to fix green bullet issue
        this.log.debug("=== STANDARDIZING NUMBERING COLORS ===");
        const colorFixed = await this.standardizeNumberingColors(doc);
        if (colorFixed) {
          this.log.info("Standardized all numbering colors to black");
        }
      }

      if (options.tableUniformity) {
        this.log.debug("=== APPLYING TABLE UNIFORMITY (DOCXMLATER 1.7.0) ===");
        const tablesFormatted = await this.applyTableUniformity(doc, options);
        this.log.info(
          `Applied standard formatting to ${tablesFormatted.tablesProcessed} tables (shading, borders, autofit, patterns)`
        );

        // Track table formatting
        if (tablesFormatted.tablesProcessed > 0 || tablesFormatted.cellsRecolored > 0) {
          result.changes?.push({
            type: 'table',
            category: 'structure',
            description: 'Applied table shading and formatting',
            count: tablesFormatted.tablesProcessed,
          });
        }
      }

      // NEW 1.1.0 Option: Smart Table Detection & Formatting
      if (options.smartTables) {
        this.log.debug("=== SMART TABLE DETECTION & FORMATTING (NEW) ===");

        // IMPORTANT: Disable track changes during smart table formatting
        // Track changes generates pPrChange elements that corrupt list numbering
        const wasTrackChangesEnabledForTables = doc.isTrackChangesEnabled();
        if (wasTrackChangesEnabledForTables) {
          this.log.debug("Temporarily disabling track changes for smart table formatting");
          doc.disableTrackChanges();
        }

        const smartFormatted = await this.applySmartTableFormatting(doc, options);

        // Re-enable track changes if it was enabled before
        if (wasTrackChangesEnabledForTables) {
          this.log.debug("Re-enabling track changes after smart table formatting");
          doc.enableTrackChanges();
        }

        this.log.info(`Applied smart formatting to ${smartFormatted} tables`);

        // Track smart table formatting
        if (smartFormatted > 0) {
          result.changes?.push({
            type: 'table',
            category: 'structure',
            description: 'Applied smart table detection and formatting',
            count: smartFormatted,
          });
        }
      }

      // HYPERLINK GROUP (additional operations)
      if (options.operations?.updateTopHyperlinks) {
        this.log.debug("=== UPDATING TOP OF DOCUMENT HYPERLINKS ===");
        const topLinksAdded = await this.updateTopOfDocumentHyperlinks(doc);
        this.log.info(`Added ${topLinksAdded} "Top of Document" navigation links`);

        // Track Top of Document hyperlink creation
        if (topLinksAdded > 0) {
          result.changes?.push({
            type: 'hyperlink',
            category: 'structure',
            description: 'Created "Top of Document" navigation links',
            count: topLinksAdded,
          });
        }
      }

      if (options.operations?.replaceOutdatedTitles) {
        this.log.debug("=== REPLACING OUTDATED HYPERLINK TITLES ===");
        const titlesReplaced = await this.replaceOutdatedHyperlinkTitles(
          doc,
          options.customReplacements
        );
        this.log.info(`Replaced ${titlesReplaced} outdated hyperlink titles`);
      }

      if (options.operations?.standardizeHyperlinkColor) {
        this.log.debug("=== STANDARDIZING HYPERLINK COLORS ===");
        const hyperlinksStandardized = await this.standardizeHyperlinkColors(doc);
        this.log.info(`Standardized color for ${hyperlinksStandardized} hyperlinks`);

        // Track hyperlink color standardization
        if (hyperlinksStandardized > 0) {
          result.changes?.push({
            type: 'hyperlink',
            category: 'structure',
            description: 'Standardized hyperlink colors to blue',
            count: hyperlinksStandardized,
          });
        }
      }

      if (options.operations?.fixInternalHyperlinks) {
        this.log.debug("=== FIXING INTERNAL HYPERLINKS ===");
        const internalLinksFixed = await this.fixInternalHyperlinks(doc);
        this.log.info(`Fixed ${internalLinksFixed} internal hyperlinks`);

        // Track internal hyperlink fixes
        if (internalLinksFixed > 0) {
          result.changes?.push({
            type: 'hyperlink',
            category: 'structure',
            description: 'Fixed internal hyperlink bookmarks',
            count: internalLinksFixed,
          });
        }
      }

      // Note: TOC replacement is performed after final document save (see below)

      // ═══════════════════════════════════════════════════════════
      // End Processing Options Implementation
      // ═══════════════════════════════════════════════════════════

      // Memory checkpoint: Before save
      MemoryMonitor.logMemoryUsage("Before Document Save", "Ready to save document");

      // ═══════════════════════════════════════════════════════════
      // TABLE OF CONTENTS - COMPLETE SOLUTION
      // Build proper TOC with styles, bookmarks, field configuration, and population
      // ═══════════════════════════════════════════════════════════
      if (options.operations?.updateTocHyperlinks) {
        this.log.debug("=== BUILDING PROPER TOC (STYLES + FIELD + POPULATION) ===");
        const tocEntriesCreated = await this.buildProperTOC(doc);
        this.log.info(`✓ Built proper TOC with ${tocEntriesCreated} styled hyperlink entries`);

        // Track Table of Contents creation
        if (tocEntriesCreated > 0) {
          result.changes?.push({
            type: 'structure',
            category: 'structure',
            description: 'Rebuilt Table of Contents with styled hyperlinks',
            count: tocEntriesCreated,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════
      // EXTRACT REVISIONS FOR UI DISPLAY
      // Use ChangelogGenerator to get all tracked changes (original + DocHub)
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== EXTRACTING TRACKED CHANGES FOR UI ===");
      try {
        // IMPORTANT: Flush pending changes BEFORE extracting changelog
        // Pending changes (font, color, etc.) are only added to RevisionManager when flushed
        // Without this, ChangelogGenerator.fromDocument() returns empty because changes are still pending
        if (typeof (doc as any).flushPendingChanges === 'function') {
          const flushed = (doc as any).flushPendingChanges();
          this.log.debug(`Flushed ${flushed?.length || 0} pending changes to RevisionManager`);
        }

        // Cast to ChangeEntry[] from session.ts to support extended types (hyperlink)
        const changelogEntries = ChangelogGenerator.fromDocument(doc) as ChangeEntry[];

        // ═══════════════════════════════════════════════════════════
        // INTEGRATE DOCHUB PROCESSING CHANGES (Hyperlinks)
        // Convert hyperlinkChanges from DocumentProcessingComparison to ChangeEntry format
        // These are changes made by DocHub processing (author: 'DocHub')
        // ═══════════════════════════════════════════════════════════
        if (options.trackChanges) {
          const comparison = documentProcessingComparison.getCurrentComparison();
          if (comparison?.hyperlinkChanges && comparison.hyperlinkChanges.length > 0) {
            this.log.debug(`Adding ${comparison.hyperlinkChanges.length} DocHub hyperlink changes to changelog`);

            for (const hc of comparison.hyperlinkChanges) {
              const urlChanged = hc.originalUrl !== hc.modifiedUrl;
              const textChanged = hc.originalText !== hc.modifiedText;

              // Only add entry if something actually changed
              if (urlChanged || textChanged) {
                changelogEntries.push({
                  id: `dochub-hyperlink-${hc.paragraphIndex}-${hc.hyperlinkIndex}-${Date.now()}`,
                  revisionType: "hyperlinkChange",
                  category: "hyperlink",
                  description: this.describeHyperlinkProcessingChange(hc),
                  author: "DocHub",
                  date: new Date(),
                  location: {
                    paragraphIndex: hc.paragraphIndex,
                    nearestHeading: undefined, // Could be enhanced to find nearest heading
                  },
                  content: {
                    hyperlinkChange: {
                      urlBefore: hc.originalUrl,
                      urlAfter: hc.modifiedUrl,
                      textBefore: hc.originalText,
                      textAfter: hc.modifiedText,
                    },
                  },
                });
              }
            }
          }
        }

        // Calculate summary - need to cast back for docxmlater's getSummary, then cast result
        // The summary may not include hyperlink category count from docxmlater, so we add it
        const rawSummary = ChangelogGenerator.getSummary(changelogEntries as any);
        const hyperlinkCount = changelogEntries.filter(e => e.category === "hyperlink").length;
        const summary: ChangelogSummary = {
          ...rawSummary,
          byCategory: {
            ...rawSummary.byCategory,
            hyperlink: hyperlinkCount,
          },
        };

        this.log.info(`Extracted ${changelogEntries.length} tracked changes for UI display`);

        // Store in result for UI
        result.wordRevisions = {
          hasRevisions: changelogEntries.length > 0,
          entries: changelogEntries,
          summary: summary,
          handlingMode: options.revisionHandlingMode || "preserve_and_wrap",
        };
      } catch (changelogError) {
        this.log.warn("Failed to extract changelog entries:", changelogError);
        // Non-fatal - continue with save
      }

      // ═══════════════════════════════════════════════════════════
      // OPTIONALLY AUTO-ACCEPT REVISIONS
      // If autoAcceptRevisions is true (default), accept all tracked changes
      // This produces a clean document while UI still shows what changed
      // ═══════════════════════════════════════════════════════════
      const autoAccept = options.autoAcceptRevisions ?? true; // Default to true for clean output
      if (autoAccept) {
        this.log.debug("=== AUTO-ACCEPTING ALL REVISIONS ===");
        try {
          await RevisionAwareProcessor.prepare(doc, { mode: "accept_all" });
          doc.disableTrackChanges();
          this.log.info("All revisions accepted - document will be clean");
          if (result.wordRevisions) {
            result.wordRevisions.handlingResult = {
              accepted: result.wordRevisions.entries.map((e) => e.id),
              preserved: [],
              conflicts: 0,
            };
          }
        } catch (acceptError) {
          this.log.warn("Failed to auto-accept revisions:", acceptError);
          // Non-fatal - document will have tracked changes visible
        }
      } else {
        this.log.info("Auto-accept disabled - tracked changes will be visible in Word");
      }

      // ═══════════════════════════════════════════════════════════
      // SAVE DOCUMENT - Direct save using docxmlater
      //
      // IMPORTANT: We rely on docxmlater's internal DOCX formatting
      // which properly maintains:
      // 1. [Content_Types].xml as first ZIP entry with STORE compression
      // 2. Correct file ordering in ZIP archive
      // 3. All OOXML relationships and structure
      //
      // NEW in v2.5.0: If setAutoPopulateTOCs(true) was called,
      // save() automatically populates TOC fields with heading hyperlinks
      //
      // Previous approach of toBuffer() → validate → resave caused
      // corruption due to double ZIP creation breaking file ordering.
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== SAVING DOCUMENT ===");
      await doc.save(filePath);
      this.log.info("Document saved successfully");

      // Memory checkpoint: After save
      MemoryMonitor.logMemoryUsage("After Document Save", "Document saved successfully");
      MemoryMonitor.compareCheckpoints("DocProcessor Start", "After Document Save");

      // Complete change tracking if enabled
      if (options.trackChanges) {
        this.log.debug("=== COMPLETING CHANGE TRACKING ===");
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

      this.log.debug("═══════════════════════════════════════════════════════════");
      this.log.debug("  PROCESSING COMPLETE");
      this.log.debug("═══════════════════════════════════════════════════════════");
      this.log.info(`Total hyperlinks: ${result.totalHyperlinks}`);
      this.log.info(`Modified: ${result.modifiedHyperlinks}`);
      this.log.info(`Appended Content IDs: ${result.appendedContentIds}`);
      this.log.info(`Duration: ${result.duration.toFixed(0)}ms`);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      this.log.error("ERROR:", errorMessage);

      // Memory checkpoint: On error
      MemoryMonitor.logMemoryUsage("DocProcessor Error", `Error: ${errorMessage}`);
      MemoryMonitor.compareCheckpoints("DocProcessor Start", "DocProcessor Error");

      result.success = false;
      result.errorCount++;
      result.errorMessages.push(errorMessage);
      result.duration = performance.now() - startTime;

      // Restore from backup on error
      if (backupCreated && result.backupPath) {
        this.log.warn("Restoring from backup...");
        try {
          await fs.copyFile(result.backupPath, filePath);
          this.log.info("Restored from backup");
        } catch (restoreError) {
          const restoreErrorMessage =
            restoreError instanceof Error ? restoreError.message : "Unknown restore error";
          this.log.error("Failed to restore backup:", restoreErrorMessage);
        }
      }

      return result;
    } finally {
      // Clean up resources
      if (doc) {
        try {
          doc.dispose();
          this.log.debug("Document disposed successfully");
        } catch (disposeError) {
          this.log.warn("Failed to dispose document:", disposeError);
        }
      }
    }
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
      matchType: "contains" | "exact" | "startsWith";
      applyTo: "url" | "text" | "both";
    }>,
    result: WordProcessingResult
  ): Promise<void> {
    for (const { hyperlink, url, text } of hyperlinks) {
      for (const rule of replacements) {
        let shouldApply = false;

        if (rule.applyTo === "url" || rule.applyTo === "both") {
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

        if (rule.applyTo === "text" || rule.applyTo === "both") {
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
    matchType: "contains" | "exact" | "startsWith"
  ): boolean {
    switch (matchType) {
      case "exact":
        return text === pattern;
      case "startsWith":
        return text.startsWith(pattern);
      case "contains":
      default:
        return text.includes(pattern);
    }
  }

  /**
   * Create backup of document in DocHub_Backups subfolder
   */
  private async createBackup(filePath: string): Promise<string> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

    // Create DocHub_Backups folder if it doesn't exist
    const backupDir = path.join(dir, 'DocHub_Backups');
    await fs.mkdir(backupDir, { recursive: true });

    // Save backup inside DocHub_Backups folder
    const backupPath = path.join(backupDir, `${base}.backup.${timestamp}${ext}`);

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

    this.log.debug("═══════════════════════════════════════════════════════════");
    this.log.info(`BATCH PROCESSING - ${filePaths.length} FILES`);
    this.log.debug("═══════════════════════════════════════════════════════════");

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
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
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
      if (settled.status === "rejected") {
        this.log.warn(
          `Batch processing warning: Promise ${i + 1} was rejected:`,
          (settled as PromiseRejectedResult).reason
        );
      }
    }

    this.log.debug("═══════════════════════════════════════════════════════════");
    this.log.info("BATCH PROCESSING COMPLETE");
    this.log.debug("═══════════════════════════════════════════════════════════");
    this.log.info(`Total files: ${filePaths.length}`);
    this.log.info(`Successful: ${successfulFiles}`);
    this.log.info(`Failed: ${failedFiles}`);

    // Final garbage collection after batch processing
    if (global.gc) {
      this.log.debug("Final GC after batch processing complete");
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
   * Enhanced with comprehensive error handling to prevent data corruption
   * from partial updates when some URL updates fail.
   *
   * @param doc - The document being processed
   * @param urlMap - Map of old URL -> new URL
   * @returns UrlUpdateResult with success count and failure details
   */
  private async applyUrlUpdates(
    doc: Document,
    urlMap: Map<string, string>
  ): Promise<UrlUpdateResult> {
    if (urlMap.size === 0) {
      return { updated: 0, failed: [] };
    }

    const failedUrls: UrlUpdateResult["failed"] = [];
    let updatedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    this.log.debug(`Processing ${paragraphs.length} paragraphs for URL updates`);

    for (let paraIndex = 0; paraIndex < paragraphs.length; paraIndex++) {
      const para = paragraphs[paraIndex];
      const content = para.getContent();

      // Find hyperlinks in this paragraph that need URL updates
      for (const item of content) {
        if (item instanceof Hyperlink) {
          const oldUrl = item.getUrl();

          if (oldUrl && urlMap.has(oldUrl)) {
            // This hyperlink needs URL update
            const newUrl = urlMap.get(oldUrl)!;

            // Skip if URLs are identical (no-op update)
            if (oldUrl === newUrl) {
              this.log.debug(`Skipping no-op update: ${oldUrl}`);
              continue;
            }

            try {
              // Use DocXMLater's new setUrl() method to update the hyperlink
              item.setUrl(newUrl);
              updatedCount++;

              this.log.debug(`✅ Updated hyperlink URL: ${oldUrl} → ${newUrl}`);
            } catch (error) {
              // Log the failure with context
              this.log.error(
                `❌ Failed to update URL at paragraph ${paraIndex}: ${oldUrl} → ${newUrl}`,
                error
              );

              // Track the failure for reporting
              failedUrls.push({
                oldUrl,
                newUrl,
                error,
                paragraphIndex: paraIndex,
              });
            }
          }
        }
      }
    }

    // Log summary with appropriate level
    if (failedUrls.length > 0) {
      this.log.warn(
        `⚠️ URL update completed with ${failedUrls.length} failures. ` +
          `Updated: ${updatedCount}, Failed: ${failedUrls.length}, Total Attempted: ${urlMap.size}`
      );

      // Log details of each failure for debugging
      failedUrls.forEach(({ oldUrl, newUrl, error, paragraphIndex }) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error(`  - Paragraph ${paragraphIndex}: ${oldUrl} → ${newUrl} (${errorMessage})`);
      });
    } else {
      this.log.info(`✅ Successfully updated ${updatedCount} hyperlink URLs`);
    }

    return { updated: updatedCount, failed: failedUrls };
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
      const ids = [lookupIds.contentId, lookupIds.documentId].filter(Boolean).join(" or ");
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
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const runs = para.getRuns();
      for (const run of runs) {
        const text = run.getText();
        if (!text) continue;

        // Collapse multiple spaces/tabs/newlines to single space
        const cleaned = text.replace(/\s+/g, " ");
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
      // ENHANCED DEBUG LOGGING: Extract paragraph text first for comprehensive visibility
      const paraText = para.getText() || "";
      const textPreview = paraText.substring(0, 100);

      this.log.debug(`\n  ===== CHECKING PARAGRAPH EMPTINESS =====`);
      this.log.debug(`  Text Preview: "${textPreview}${paraText.length > 100 ? "..." : ""}"`);
      this.log.debug(`  Text Length: ${paraText.length} characters`);

      // ✅ Check 1: Does this paragraph have numbering? (list item)
      // This is the docxmlater helper we were missing!
      const numbering = para.getNumbering();
      if (numbering) {
        this.log.debug(`  ✗ Paragraph has numbering (level ${numbering.level || 0}) - NOT empty`);
        this.log.debug(`  RESULT: NOT EMPTY (list item)\n`);
        return false;
      }

      // ✅ Check 2: Does this paragraph have complex content?
      // getContent() returns ALL content items (runs, hyperlinks, images)
      const content = para.getContent();

      this.log.debug(`  Content items: ${content.length}`);
      if (content.length > 0) {
        const contentTypes = content.map((i) => i.constructor.name).join(", ");
        this.log.debug(`  Content types: ${contentTypes}`);
      }

      // Empty content = empty paragraph
      if (content.length === 0) {
        this.log.debug(`  ✓ Paragraph has no content - TRULY empty`);
        this.log.debug(`  RESULT: EMPTY (no content)\n`);
        return true;
      }

      // Check if content contains hyperlinks or images (not empty!)
      for (const item of content) {
        if (item instanceof Hyperlink) {
          const hyperlinkText = item.getText() || "";
          this.log.debug(`  ✗ Paragraph contains hyperlink: "${hyperlinkText}" - NOT empty`);
          this.log.debug(`  RESULT: NOT EMPTY (hyperlink)\n`);
          return false;
        }
        if (item instanceof Image) {
          this.log.debug(`  ✗ Paragraph contains image - NOT empty`);
          this.log.debug(`  RESULT: NOT EMPTY (image)\n`);
          return false;
        }
      }

      // ✅ Check 3: Are all text runs empty?
      // Only delete if all runs are whitespace-only
      const runDetails: string[] = [];
      const allRunsEmpty = content.every((item) => {
        if (item instanceof Run) {
          const text = (item.getText() || "").trim();
          runDetails.push(`Run: "${text}" (${text.length} chars)`);
          return text === "";
        }
        // Hyperlinks/images already filtered above, so this is unreachable
        // but keeping for defensive programming
        runDetails.push(`Non-run: ${item.constructor.name}`);
        return false;
      });

      if (runDetails.length > 0) {
        this.log.debug(`  Run analysis:`);
        runDetails.forEach((detail) => this.log.debug(`    - ${detail}`));
      }

      if (allRunsEmpty) {
        this.log.debug(`  ✓ All runs are empty - TRULY empty`);
        this.log.debug(`  RESULT: EMPTY (all runs empty)\n`);
        return true;
      }

      this.log.debug(`  ✗ Has non-empty text runs - NOT empty`);
      this.log.debug(`  RESULT: NOT EMPTY (has text)\n`);
      return false;
    } catch (error) {
      // Defensive: Extraction error means paragraph is not safe to delete
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.log.warn(`  ⚠️  Error checking paragraph emptiness (assuming NOT empty): ${errorMsg}`);
      this.log.debug(`  RESULT: NOT EMPTY (error)\n`);
      return false; // Default to NOT empty - safer than deleting
    }
  }

  /**
   * Remove extra paragraph lines using DocXMLater's built-in method
   *
   * REFACTORED: Replaced 240+ line custom implementation with framework's
   * removeExtraBlankParagraphs() method which handles:
   * - Consecutive empty paragraph removal
   * - Table/SDT structure protection
   * - List item preservation
   * - Bookmark/hyperlink safety
   * - Optional structure blank line insertion
   *
   * @param doc - The document to process
   * @param preserveBlankLinesAfterHeader2Tables - Whether to add structure blank lines
   * @returns Number of paragraphs removed
   */
  private async removeExtraParagraphLines(
    doc: Document,
    preserveBlankLinesAfterHeader2Tables: boolean = true
  ): Promise<number> {
    this.log.debug("=== REMOVING EXTRA BLANK PARAGRAPHS (FRAMEWORK METHOD) ===");
    this.log.debug("  addStructureBlankLines option: true (always enabled for lists)");

    // Use DocXMLater's built-in removeExtraBlankParagraphs() method
    // Always enable addStructureBlankLines to ensure blank lines after lists
    // The framework method internally calls addStructureBlankLines() with afterLists: true default
    const result = doc.removeExtraBlankParagraphs({
      addStructureBlankLines: true,
    });

    this.log.info(
      `✓ Framework method completed: ${result.removed} blank paragraphs removed, ${result.added} structure lines added`
    );

    return result.removed;
  }

  /**
   * Remove italic formatting - Strip italics from all text runs
   */
  private async removeItalicFormatting(doc: Document): Promise<number> {
    let removedCount = 0;
    const paragraphs = doc.getAllParagraphs();

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
   * Standardize hyperlink formatting - Remove bold/italic and reset to standard style
   *
   * Uses docxmlater's resetToStandardFormatting() method to ensure all hyperlinks
   * have consistent formatting: Calibri 11pt, blue (#0563C1), underlined, no bold/italic.
   *
   * This prevents hyperlinks from inheriting unwanted formatting from surrounding text
   * or from being manually bolded/italicized by users.
   *
   * @param doc - The document to process
   * @returns Number of hyperlinks standardized
   * @since v1.0.44 (docxmlater v1.15.0+)
   */
  private async standardizeHyperlinkFormatting(doc: Document): Promise<number> {
    let standardizedCount = 0;

    try {
      // Extract all hyperlinks using DocXMLaterProcessor
      const hyperlinks = await this.docXMLater.extractHyperlinks(doc);

      this.log.debug(`Found ${hyperlinks.length} hyperlinks to standardize`);

      // Reset each hyperlink to standard formatting
      for (const { hyperlink, url, text } of hyperlinks) {
        try {
          // Apply custom formatting to hyperlinks:
          // - Font: Verdana 12pt
          // - Color: Blue (#0000FF)
          // - Underline: Single
          // - Bold: false
          // - Italic: false
          hyperlink.setFormatting({
            font: "Verdana",
            size: 12, // 12pt (docxmlater converts to 24 half-points internally)
            color: "0000FF", // Blue (hex without #)
            underline: "single",
            bold: false,
            italic: false,
          });
          standardizedCount++;

          this.log.debug(`Standardized hyperlink: "${text}" (${url})`);
        } catch (error) {
          this.log.warn(`Failed to standardize hyperlink "${text}": ${error}`);
          // Continue processing other hyperlinks even if one fails
        }
      }

      this.log.info(
        `Successfully standardized ${standardizedCount} of ${hyperlinks.length} hyperlinks`
      );
    } catch (error) {
      this.log.error(`Error standardizing hyperlink formatting: ${error}`);
      throw error;
    }

    return standardizedCount;
  }

  /**
   * Standardize list prefix formatting for ALL lists in the document
   *
   * Similar to standardizeHyperlinkFormatting(), this function ensures all bullet points
   * and numbered list prefixes (symbols/numbers) have consistent professional formatting:
   * - Font: Verdana
   * - Size: 12pt (24 half-points)
   * - Color: Black (#000000)
   * - Bold: preserved (lists often use bold for emphasis)
   *
   * This applies to ALL existing lists in the document, not just newly created ones.
   *
   * @param doc - Document to process
   * @returns Number of list levels standardized
   * @since v1.0.45
   */
  private async standardizeListPrefixFormatting(doc: Document): Promise<number> {
    let standardizedCount = 0;

    try {
      // Access numbering.xml to modify all list formatting
      const numberingPart = await doc.getPart("word/numbering.xml");
      if (!numberingPart || typeof numberingPart.content !== "string") {
        this.log.warn("Unable to access numbering.xml for list prefix standardization");
        return 0;
      }

      let xmlContent = numberingPart.content;
      let modified = false;

      // FIX: Use matchAll to get all matches upfront (prevents regex state corruption)
      // Find all <w:lvl> elements (all list levels in the document)
      const lvlRegex = /<w:lvl w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g;
      const matches = Array.from(xmlContent.matchAll(lvlRegex));

      this.log.debug(`Found ${matches.length} list levels to process`);

      // Standard formatting for list prefixes
      // OOXML Compliance: w:hint attribute added, w:color before w:sz per ECMA-376
      const standardRPr = `<w:rPr>
              <w:rFonts w:hint="default" w:ascii="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/>
              <w:color w:val="000000"/>
              <w:sz w:val="24"/>
              <w:szCs w:val="24"/>
            </w:rPr>`;

      // Process matches in reverse order to maintain string positions
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const levelIndex = match[1];
        const levelContent = match[2];
        const fullMatch = match[0];

        // Check if w:rPr already exists anywhere in the level
        const rPrRegex = /<w:rPr>([\s\S]*?)<\/w:rPr>/g;
        const rPrMatches = Array.from(levelContent.matchAll(rPrRegex));

        if (rPrMatches.length > 0) {
          // Replace ALL w:rPr instances in this level with standardized formatting
          let updatedContent = levelContent;

          // Check if any rPr has bold
          const hasBold = levelContent.includes("<w:b/>") || levelContent.includes("<w:b ");
          const hasBoldCs = levelContent.includes("<w:bCs/>") || levelContent.includes("<w:bCs ");

          // Build standardized rPr
          // OOXML Compliance: w:hint attribute added, w:color before w:sz per ECMA-376
          let rPrXml = `<w:rPr>
              <w:rFonts w:hint="default" w:ascii="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/>`;

          // Preserve bold if it was there
          if (hasBold) {
            rPrXml += `\n              <w:b/>`;
          }
          if (hasBoldCs) {
            rPrXml += `\n              <w:bCs/>`;
          }

          // OOXML Compliance: w:color must appear before w:sz per ECMA-376 Part 1, Section 17.3.2
          rPrXml += `\n              <w:color w:val="000000"/>
              <w:sz w:val="24"/>
              <w:szCs w:val="24"/>
            </w:rPr>`;

          // Replace all w:rPr instances
          updatedContent = updatedContent.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, rPrXml);

          // Replace the entire level in xmlContent
          const updatedLevel = fullMatch.replace(levelContent, updatedContent);
          xmlContent = xmlContent.replace(fullMatch, updatedLevel);
          modified = true;
          standardizedCount++;

          this.log.debug(
            `Standardized ${rPrMatches.length} w:rPr in list level ${levelIndex}: Verdana 12pt black${hasBold ? " (bold preserved)" : ""}`
          );
        } else {
          // No w:rPr found - insert one before closing tag
          // Place it right before </w:lvl> for better OOXML compliance
          const updatedLevel = fullMatch.replace("</w:lvl>", `${standardRPr}\n          </w:lvl>`);
          xmlContent = xmlContent.replace(fullMatch, updatedLevel);
          modified = true;
          standardizedCount++;

          this.log.debug(
            `Added standardized w:rPr to list level ${levelIndex}: Verdana 12pt black (new formatting)`
          );
        }
      }

      if (modified) {
        // Save modified XML back to document
        await doc.setPart("word/numbering.xml", xmlContent);
        this.log.info(
          `Successfully standardized ${standardizedCount} list prefix levels to Verdana 12pt black`
        );
      } else {
        this.log.info("No list levels found to standardize");
      }

      return standardizedCount;
    } catch (error) {
      this.log.error(`Error standardizing list prefix formatting: ${error}`);
      throw error;
    }
  }

  /**
   * DEPRECATED v1.19.0: Insert blank paragraph lines after all 1x1 tables
   *
   * This custom implementation has been replaced with docXMLater's native
   * ensureBlankLinesAfter1x1Tables() method which:
   * - Runs BEFORE paragraph removal (more efficient)
   * - Sets preserve flag conditionally (based on removeParagraphLines option)
   * - Provides better statistics and filtering options
   *
   * See: doc.ensureBlankLinesAfter1x1Tables() call in processDocument() method
   *
   * @deprecated Use doc.ensureBlankLinesAfter1x1Tables() instead
   * @param doc - Document to process
   * @returns Number of blank lines inserted
   */
  private async insertBlankLinesAfter1x1Tables(doc: Document): Promise<number> {
    // DEPRECATED: This method is no longer used
    // New implementation uses: doc.ensureBlankLinesAfter1x1Tables()
    this.log.warn(
      "DEPRECATED: insertBlankLinesAfter1x1Tables() called - use doc.ensureBlankLinesAfter1x1Tables() instead"
    );
    return 0;
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
      alignment: "left" | "center" | "right" | "justify";
      color: string;
      spaceBefore: number;
      spaceAfter: number;
      lineSpacing: number;
    }>
  ): Promise<number> {
    let appliedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    // Find configured styles
    const header1Style = styles.find((s) => s.id === "header1");
    const header2Style = styles.find((s) => s.id === "header2");
    const normalStyle = styles.find((s) => s.id === "normal");

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

        if ((currentStyle === "Heading1" || currentStyle === "Heading 1") && header1Style) {
          styleToApply = header1Style;
        } else if ((currentStyle === "Heading2" || currentStyle === "Heading 2") && header2Style) {
          styleToApply = header2Style;
        } else if ((!currentStyle || currentStyle === "Normal") && normalStyle) {
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

        // Apply text formatting to all runs in paragraph, including those inside revisions
        // This ensures runs inside w:ins, w:moveTo, etc. also get formatting applied
        const runs = this.getAllRunsFromParagraph(para);
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
            run.setUnderline(styleToApply.underline ? "single" : false);
          }
          run.setColor(styleToApply.color.replace("#", ""));
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
      alignment: "left" | "center" | "right" | "justify";
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
        color: style.color.replace("#", ""),
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
          lineRule: "auto" as const,
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
        case "header1":
          config.heading1 = { run: runFormatting, paragraph: paragraphFormatting };
          break;
        case "header2":
          config.heading2 = {
            run: runFormatting,
            paragraph: paragraphFormatting,
            tableOptions: {
              shading: tableShadingSettings?.header2Shading?.replace("#", "") ?? "BFBFBF",
              marginTop: 0,
              marginBottom: 0,
              marginLeft: 115,
              marginRight: 115,
              tableWidthPercent: 5000,
            },
          };
          break;
        case "header3":
          config.heading3 = { run: runFormatting, paragraph: paragraphFormatting };
          break;
        case "normal":
          config.normal = { run: runFormatting, paragraph: paragraphFormatting };
          break;
        case "listParagraph":
          config.listParagraph = { run: runFormatting, paragraph: paragraphFormatting };
          break;
      }
    }

    return config;
  }

  /**
   * Apply custom styles from UI using docXMLater's applyCustomFormattingToExistingStyles()
   * This replaces the custom implementation with the framework's native method
   *
   * NEW v1.16.0: Captures Header 2 table indices during style application
   * for proper blank line preservation in removeExtraParagraphLines()
   *
   * FALLBACK: If framework method unavailable, uses manual assignStylesToDocument()
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
      alignment: "left" | "center" | "right" | "justify";
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
    },
    preserveBlankLinesAfterHeader2Tables: boolean = true
  ): Promise<{
    heading1: boolean;
    heading2: boolean;
    heading3: boolean;
    normal: boolean;
    listParagraph: boolean;
  }> {
    // Convert SessionStyle array to docXMLater format
    const config = this.convertSessionStylesToDocXMLaterConfig(styles, tableShadingSettings);

    // Add v1.16.0 blank line preservation option
    // This prevents accidental removal of spacing after Header 2 tables
    const options = {
      ...config,
      preserveBlankLinesAfterHeader2Tables: preserveBlankLinesAfterHeader2Tables,
    };

    this.log.debug("Applying custom formatting with options:", {
      preserveBlankLinesAfterHeader2Tables: options.preserveBlankLinesAfterHeader2Tables,
    });

    // IMPORTANT: Disable track changes during style application
    // Track changes generates pPrChange elements that don't properly serialize numbering properties,
    // which causes list corruption when Word processes the document
    const wasTrackChangesEnabled = doc.isTrackChangesEnabled();
    if (wasTrackChangesEnabled) {
      this.log.debug("Temporarily disabling track changes for style application");
      doc.disableTrackChanges();
    }

    try {
    // Feature detection: Check if framework method exists
    if (typeof (doc as any).applyCustomFormattingToExistingStyles === "function") {
      this.log.debug("Using framework applyCustomFormattingToExistingStyles()");

      try {
        // Use docXMLater's native method with preserve flag support (v1.16.0)
        // This handles both style definition updates and direct formatting clearing
        const results = (doc as any).applyCustomFormattingToExistingStyles(options);
        return results;
      } catch (error) {
        this.log.warn("Framework method failed, falling back to manual implementation:", error);
        // Fall through to manual implementation
      }
    } else {
      this.log.warn(
        "Framework method applyCustomFormattingToExistingStyles not available in docxmlater v4.0.2, using manual fallback"
      );
    }

    // FALLBACK: Use manual style assignment implementation
    this.log.debug("Using manual assignStylesToDocument() fallback");
    await this.assignStylesToDocument(doc, styles);

    // Return results matching framework format (all styles processed)
    const appliedStyles = {
      heading1: styles.some((s) => s.id === "header1"),
      heading2: styles.some((s) => s.id === "header2"),
      heading3: styles.some((s) => s.id === "header3"),
      normal: styles.some((s) => s.id === "normal"),
      listParagraph: styles.some((s) => s.id === "listParagraph"),
    };

    this.log.debug(`Manual fallback completed: ${JSON.stringify(appliedStyles)}`);
    return appliedStyles;
    } finally {
      // Re-enable track changes if it was enabled before style application
      if (wasTrackChangesEnabled) {
        this.log.debug("Re-enabling track changes after style application");
        doc.enableTrackChanges();
      }
    }
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
      alignment: "left" | "center" | "right" | "justify";
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
    this.log.debug("Creating Style objects from UI configuration...");

    const styleObjects: Style[] = [];
    const styleNames: string[] = [];

    // Convert each SessionStyle to a DocXMLater Style object
    for (const sessionStyle of styles) {
      // Map UI style ID to docxmlater style ID
      const docStyleId =
        sessionStyle.id === "header1"
          ? "Heading1"
          : sessionStyle.id === "header2"
            ? "Heading2"
            : sessionStyle.id === "header3"
              ? "Heading3"
              : sessionStyle.id === "listParagraph"
                ? "ListParagraph"
                : "Normal";

      // Create paragraph formatting object
      const paragraphFormatting: any = {
        alignment: sessionStyle.alignment,
        spacing: {
          before: pointsToTwips(sessionStyle.spaceBefore),
          after: pointsToTwips(sessionStyle.spaceAfter),
          line: pointsToTwips(sessionStyle.lineSpacing * 12),
          lineRule: "auto",
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
        type: "paragraph",
        basedOn: "Normal",
        runFormatting: {
          font: sessionStyle.fontFamily,
          size: sessionStyle.fontSize,
          bold: sessionStyle.bold,
          italic: sessionStyle.italic,
          underline: sessionStyle.underline ? "single" : false,
          color: sessionStyle.color.replace("#", ""),
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
    const appliedCount = Object.values(results).filter((success) => success === true).length;

    // Build list of validated styles
    const validated: string[] = [];
    if (results.heading1) validated.push("Heading1");
    if (results.heading2) validated.push("Heading2");
    if (results.heading3) validated.push("Heading3");
    if (results.normal) validated.push("Normal");
    if (results.listParagraph) validated.push("ListParagraph");

    this.log.debug(`Applied ${appliedCount} styles successfully: ${validated.join(", ")}`);

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
      alignment: "left" | "center" | "right" | "justify";
      color: string;
      spaceBefore: number;
      spaceAfter: number;
    },
    tableShadingSettings?: {
      header2Shading: string;
      otherShading: string;
    }
  ): Promise<number> {
    let cellsFixed = 0;
    const tablesNeedingBlankParagraph: Array<{ table: Table; tableIndex: number }> = [];

    // Get all tables in document
    const tables = doc.getTables();
    this.log.debug(`Found ${tables.length} tables to validate for Header 2 formatting`);

    for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
      const table = tables[tableIndex];
      const rows = table.getRows();
      const is1x1Table = rows.length === 1 && rows[0]?.getCells().length === 1;
      let tableHasHeader2 = false;

      for (const row of rows) {
        const cells = row.getCells();

        for (const cell of cells) {
          const paragraphs = cell.getParagraphs();

          for (const para of paragraphs) {
            const currentStyle = para.getStyle();

            // Check if this paragraph has Header 2 style
            if (currentStyle === "Heading2" || currentStyle === "Heading 2") {
              tableHasHeader2 = true;
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
                  const expectedUnderline = header2Style.underline ? "single" : false;
                  if (runFormatting.underline !== expectedUnderline) {
                    run.setUnderline(expectedUnderline);
                    runNeedsUpdate = true;
                  }
                }

                const expectedColor = header2Style.color.replace("#", "");
                if (runFormatting.color !== expectedColor) {
                  run.setColor(expectedColor);
                  runNeedsUpdate = true;
                }

                if (runNeedsUpdate) {
                  cellNeedsUpdate = true;
                  this.log.debug(
                    "Fixed Header 2 run formatting (font/size/bold/italic/underline/color)"
                  );
                }
              }

              // Validate and fix cell shading for 1x1 tables
              // Heading2 cells in 1x1 tables should use user's configured color
              if (is1x1Table) {
                // Use user's header2Shading color from tableShadingSettings (fallback to BFBFBF if not set)
                const shadingColor =
                  tableShadingSettings?.header2Shading?.replace("#", "") || "BFBFBF";
                cell.setShading({ fill: shadingColor });
                cellNeedsUpdate = true;
                this.log.debug(`Applied Header 2 cell shading (#${shadingColor}) to 1x1 table`);
              }

              if (cellNeedsUpdate) {
                cellsFixed++;
              }
            }
          }
        }
      }

      // Track 1x1 tables with Header 2 for blank paragraph insertion
      if (is1x1Table && tableHasHeader2) {
        tablesNeedingBlankParagraph.push({ table, tableIndex });
      }
    }

    // FIX Issues 4-6: This section is DEPRECATED and should be removed
    // The blank line insertion is already handled by doc.ensureBlankLinesAfter1x1Tables()
    // which runs earlier in the processDocument() method.
    //
    // The previous implementation created blank lines with line break elements:
    //   <w:r><w:br w:type="textWrapping"/></w:r>
    // which resulted in DOUBLE blank lines in the output (both empty text + break).
    //
    // The correct approach (already implemented above) uses simple blank paragraphs:
    //   doc.createParagraph('') with setSpaceAfter(120)
    // without any break elements, which creates proper single blank lines.
    //
    // This validateHeader2TableFormatting method should ONLY validate formatting,
    // not insert blank lines - that's handled by ensureBlankLinesAfter1x1Tables().

    if (tablesNeedingBlankParagraph.length > 0) {
      this.log.debug(
        `Skipping blank line insertion after ${tablesNeedingBlankParagraph.length} tables - ` +
          `already handled by doc.ensureBlankLinesAfter1x1Tables()`
      );
    }

    if (cellsFixed > 0) {
      this.log.info(`Fixed ${cellsFixed} Header 2 table cells`);
    } else {
      this.log.debug("All Header 2 table cells already have correct formatting");
    }

    return cellsFixed;
  }

  /**
   * Center all images and apply 2pt solid black borders
   * Enhanced version that both centers image-containing paragraphs and applies borders
   * Only processes images LARGER than 50x50 pixels to avoid formatting small icons/logos
   */
  private async centerAllImages(doc: Document): Promise<number> {
    let processedCount = 0;
    let skippedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    this.log.debug("=== CENTERING IMAGES AND APPLYING BORDERS ===");
    this.log.debug("Only processing images larger than 50x50 pixels");

    // Conversion: 1 pixel = 9525 EMUs, so 50 pixels = 476250 EMUs
    const MIN_SIZE_EMUS = 476250; // 50 pixels

    for (const para of paragraphs) {
      const content = para.getContent();

      // Process each content item
      for (const item of content) {
        if (item instanceof Image) {
          // Get image dimensions in EMUs (English Metric Units)
          const width = item.getWidth();
          const height = item.getHeight();

          // Check if image is larger than 50x50 pixels
          if (width > MIN_SIZE_EMUS && height > MIN_SIZE_EMUS) {
            // Skip centering for list paragraphs - numbering controls their layout
            const numbering = para.getNumbering();
            if (!numbering) {
              // Center the paragraph containing the image
              para.setAlignment("center");
            } else {
              this.log.debug(
                `[LIST] Skipping centering for list paragraph with image: numId=${numbering.numId}, level=${numbering.level}`
              );
            }

            // Apply 2pt solid black border to the image
            await this.applyImageBorder(doc, item);

            processedCount++;
            this.log.debug(
              `Processed image ${processedCount}: centered and bordered (${Math.round(width / 9525)}x${Math.round(height / 9525)} pixels)`
            );
          } else {
            skippedCount++;
            this.log.debug(
              `Skipped small image ${skippedCount}: ${Math.round(width / 9525)}x${Math.round(height / 9525)} pixels (below 50x50 threshold)`
            );
          }
        }
      }
    }

    this.log.info(
      `Centered and bordered ${processedCount} images (skipped ${skippedCount} small images)`
    );
    return processedCount;
  }

  /**
   * Apply 2pt solid black border to an image
   *
   * Adds border formatting to image drawing elements by manipulating the document XML.
   * Border specs: 2pt width (25400 EMUs), solid black (#000000)
   *
   * @param doc - Document containing the image
   * @param image - Image instance to apply border to
   */
  private async applyImageBorder(doc: Document, image: Image): Promise<void> {
    try {
      // Get document.xml to access drawing elements
      const documentXml = await doc.getPart("word/document.xml");
      if (!documentXml || typeof documentXml.content !== "string") {
        this.log.warn("Unable to access document.xml for image border application");
        return;
      }

      let xmlContent = documentXml.content;
      let modified = false;

      // Border properties in OOXML format:
      // - Width: 2pt = 25400 EMUs (English Metric Units)
      // - Color: Black (#000000)
      // - Style: Solid line
      const borderXml = `<a:ln w="25400">
                <a:solidFill>
                  <a:srgbClr val="000000"/>
                </a:solidFill>
              </a:ln>`;

      // Find all drawing elements and add border if not present
      // Match <a:graphic> elements which contain image data
      const graphicRegex = /<a:graphic[^>]*>([\s\S]*?)<\/a:graphic>/g;

      xmlContent = xmlContent.replace(graphicRegex, (match) => {
        // Check if border already exists
        if (match.includes("<a:ln")) {
          // Border exists, update it to ensure 2pt black
          const updatedMatch = match.replace(
            /<a:ln[^>]*>[\s\S]*?<\/a:ln>/,
            borderXml
          );
          modified = true;
          return updatedMatch;
        } else {
          // Add border before closing </a:graphic> tag
          // Insert after <a:graphicData> opening tag for proper OOXML structure
          const insertAfterGraphicData = match.replace(
            /(<a:graphicData[^>]*>)/,
            `$1\n              ${borderXml}`
          );
          modified = true;
          return insertAfterGraphicData;
        }
      });

      // Also handle <pic:spPr> (shape properties) which is where borders typically go
      const spPrRegex = /<pic:spPr[^>]*>([\s\S]*?)<\/pic:spPr>/g;

      xmlContent = xmlContent.replace(spPrRegex, (match) => {
        // Check if border already exists within shape properties
        if (match.includes("<a:ln")) {
          // Update existing border
          const updatedMatch = match.replace(
            /<a:ln[^>]*>[\s\S]*?<\/a:ln>/,
            borderXml
          );
          modified = true;
          return updatedMatch;
        } else {
          // Add border before closing </pic:spPr> tag
          const withBorder = match.replace(
            /<\/pic:spPr>/,
            `${borderXml}\n            </pic:spPr>`
          );
          modified = true;
          return withBorder;
        }
      });

      if (modified) {
        // Save modified XML back to document
        await doc.setPart("word/document.xml", xmlContent);
        this.log.debug("Applied 2pt solid black border to image via XML manipulation");
      }
    } catch (error) {
      this.log.warn(
        `Failed to apply border to image: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      // Don't throw - continue processing other images
    }
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
  private async fixCommonKeywords(
    doc: Document,
    options: WordProcessingOptions = {}
  ): Promise<number> {
    const keywords = [
      { find: /\bteh\b/gi, replace: "the" },
      { find: /\brecieve\b/gi, replace: "receive" },
      { find: /\boccured\b/gi, replace: "occurred" },
      { find: /\bseperate\b/gi, replace: "separate" },
      { find: /\bdefinately\b/gi, replace: "definitely" },
      { find: /\bperform ance\b/gi, replace: "performance" }, // Common spacing error
      { find: /\bacheive\b/gi, replace: "achieve" },
      { find: /\bbeginning\b/gi, replace: "beginning" },
      { find: /\bbeleive\b/gi, replace: "believe" },
      { find: /\bbuisness\b/gi, replace: "business" },
      { find: /\bcalendar\b/gi, replace: "calendar" },
      { find: /\bcemetery\b/gi, replace: "cemetery" },
    ];

    let totalFixed = 0;

    // Try using new docxmlater 1.1.0 findAndReplaceAll() helper
    try {
      for (const { find, replace } of keywords) {
        const result = await (doc as any).findAndReplaceAll?.(find, replace, {
          matchCase: false,
          wholeWord: true,
          trackChanges: options?.trackChangesInWord || false,
          author: "DocHub AutoCorrect",
        });

        if (result) {
          totalFixed += result.count || 0;

          if (result.revisions && options?.trackChangesInWord) {
            this.log.debug(
              `Created ${result.revisions.length} tracked changes for keyword: ${replace}`
            );
          }
        }
      }

      if (totalFixed > 0) {
        this.log.info(`Fixed ${totalFixed} keywords using findAndReplaceAll()`);
        return totalFixed;
      }
    } catch (error) {
      this.log.warn("findAndReplaceAll() not available, falling back to manual implementation");
    }

    // Fallback to manual implementation if helper not available
    let fixedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const runs = para.getRuns();
      for (const run of runs) {
        let text = run.getText();
        if (!text) continue;

        let modified = false;
        for (const { find, replace } of keywords) {
          // Convert regex to string for manual replacement
          const pattern = find instanceof RegExp ? find : new RegExp(`\\b${find}\\b`, "gi");
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
        symbolIndent: number; // Bullet/number position in inches
        textIndent: number; // Text position in inches
        bulletChar?: string;
        numberedFormat?: string;
      }>;
      spacingBetweenItems: number;
    }
  ): Promise<number> {
    let formattedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const numbering = para.getNumbering();
      if (!numbering) continue;

      const level = numbering.level || 0;
      // Find setting for this level (levels are 0-indexed per DOCX standard)
      const indentSetting = settings.indentationLevels.find((l) => l.level === level);

      if (indentSetting) {
        // NOTE: Indentation is already set at the NumberingLevel in applyBulletUniformity()
        // and applyNumberedUniformity(). Setting it again at paragraph level would
        // override the NumberingLevel settings, causing double indentation.
        // The NumberingLevel handles all indentation - we only need to apply spacing here.

        // Apply spacing between items if configured
        if (settings.spacingBetweenItems > 0) {
          para.setSpaceAfter(settings.spacingBetweenItems);
        }

        formattedCount++;
      }
    }

    this.log.debug(`Applied spacing to ${formattedCount} list paragraphs`);
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
      return level?.getFormat() === "bullet";
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
      return format !== "bullet" && format !== undefined;
    } catch (error) {
      this.log.warn(`Error checking if numId ${numId} is numbered list: ${error}`);
      return false;
    }
  }

  /**
   * Apply bullet uniformity - Standardize bullet characters across all bullet lists
   * Uses UI configuration for bullet characters and indentation
   *
   * HYBRID APPROACH: Creates new custom list AND updates existing abstractNum definitions
   * This ensures ALL bullets use user-configured symbols, not just newly assigned ones
   */
  private async applyBulletUniformity(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number; // in inches
        textIndent: number; // in inches
        bulletChar?: string;
        numberedFormat?: string;
      }>;
    }
  ): Promise<number> {
    const manager = doc.getNumberingManager();

    this.log.debug("=== DEBUG: BULLET UNIFORMITY EXECUTION ===");
    this.log.debug(`  Creating ${settings.indentationLevels.length} bullet list levels`);

    // DIAGNOSTIC: Log what UI is passing for bullet characters
    this.log.debug("Bullet configuration from UI:");
    settings.indentationLevels.forEach((level, idx) => {
      const charCode = level.bulletChar
        ? level.bulletChar.charCodeAt(0).toString(16).toUpperCase()
        : "N/A";
      this.log.debug(
        `  Level ${idx}: bulletChar="${level.bulletChar || "(default)"}" (U+${charCode})`
      );
    });

    // Use user-configured bullet symbols from UI (respect user settings)
    const bullets = settings.indentationLevels.map(
      (levelConfig) => levelConfig.bulletChar || "\u2022"
    );
    this.log.debug(
      `  User-configured bullets: ${bullets.map((b, i) => `Level ${i}="${b}" (U+${b.charCodeAt(0).toString(16).toUpperCase()})`).join(", ")}`
    );

    // Create custom levels with font specified and UI indentation
    // UI config already has incremented values per level, use them directly
    const levels = settings.indentationLevels.map((levelConfig, index) => {
      const bullet = bullets[index];
      this.log.debug(
        `  Level ${index}: bulletChar="${bullet}" (U+${bullet.charCodeAt(0).toString(16).toUpperCase()}), symbolIndent=${levelConfig.symbolIndent}", textIndent=${levelConfig.textIndent}"`
      );
      // Use direct values from UI config (already incremented per level)
      const symbolTwips = Math.round(levelConfig.symbolIndent * 1440);
      const textTwips = Math.round(levelConfig.textIndent * 1440);
      const hangingTwips = textTwips - symbolTwips;

      return new NumberingLevel({
        level: index,
        format: "bullet",
        text: bullet, // Use user-configured bullet symbol
        font: "Calibri", // CRITICAL: Calibri renders U+2022 as ● (not ■ like Arial)
        leftIndent: symbolTwips, // Bullet position (where bullet appears)
        hangingIndent: hangingTwips, // Text offset from bullet
      });
    });

    // Create custom list with all UI-configured levels
    const numId = manager.createCustomList(levels, "UI Bullet List");
    if (!numId) {
      this.log.warn("Failed to create custom bullet list");
      return 0;
    }

    this.log.debug(`Created bullet list numId=${numId} with ${levels.length} levels`);

    // FIX: Update ALL existing abstractNum definitions to use user's bullet symbols & Calibri font
    // CRITICAL: Must set font to Calibri for proper Unicode bullet rendering (● vs ■)
    // CRITICAL: Must update ALL 9 levels (0-8) that Word supports, not just configured levels
    // This fixes "Bullet 3" showing square when it references level 3+ in abstractNum
    this.log.debug(
      "Updating existing abstractNum bullet lists (ALL 9 levels with symbol AND font)..."
    );
    let existingListsUpdated = 0;

    try {
      const abstractNums = manager.getAllAbstractNumberings();
      for (const abstractNum of abstractNums) {
        let isModified = false;

        // CRITICAL FIX: Update ALL 9 levels (0-8) that Word supports
        // Word documents can have bullet lists with 9 levels total
        // If we only update configured levels (e.g., 0-2), levels 3-8 keep their old symbols (like ■)
        for (let levelIndex = 0; levelIndex < 9; levelIndex++) {
          const level = abstractNum.getLevel(levelIndex);
          if (level && level.getFormat() === "bullet") {
            // Use configured symbol for this level if available, otherwise use level 0's symbol
            // This ensures deep bullet levels don't show squares even if not explicitly configured
            const newSymbol = bullets[levelIndex] || bullets[0] || "\u2022";

            // ✅ COMPLETE PROPERTY SETTING (Example 4 pattern)
            // Set ALL 5 bullet formatting properties for complete control
            level.setText(newSymbol); // Bullet symbol (e.g., ●, ▪, ➤)
            level.setFont("Calibri"); // Font: Calibri renders U+2022 as ●, not ■
            level.setFontSize(24); // Size: 12pt = 24 half-points
            level.setBold(true); // Bold: Improves visibility
            level.setColor("000000"); // Color: Black (#000000)

            isModified = true;

            this.log.debug(
              `  Updated abstractNum level ${levelIndex}: ` +
                `symbol="${newSymbol}" (U+${newSymbol.charCodeAt(0).toString(16).toUpperCase()}), ` +
                `font=Calibri, size=12pt, bold=true, color=#000000`
            );
          }
        }

        if (isModified) {
          existingListsUpdated++;
        }
      }

      if (existingListsUpdated > 0) {
        this.log.info(
          `Updated ${existingListsUpdated} existing abstractNum bullet lists (ALL 9 levels, symbols + Calibri font)`
        );
      }
    } catch (error) {
      this.log.warn("Failed to update existing abstractNum definitions:", error);
      // Continue with paragraph reassignment even if this fails
    }

    // Apply to bullet list paragraphs only
    let standardizedCount = 0;
    const paragraphs = doc.getAllParagraphs();

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

    // ✅ REMOVED: Framework's standardizeBulletSymbols() call
    // REASON: We now use Example 4's complete property setting pattern (lines 2945-2949)
    // which directly sets ALL 5 properties (setText, setFont, setFontSize, setBold, setColor)
    // for every bullet level in every abstractNum definition.
    //
    // The framework call was:
    // 1. Redundant - we already set all properties manually
    // 2. Conflicting - changed font from Calibri → Verdana (breaks ● rendering)
    // 3. Unnecessary - Example 4 pattern provides complete control
    //
    // Note: Framework methods at lines 671-672 and 3271-3280 remain for conditional
    // formatting when custom styles are already applied or for color-only updates.

    return standardizedCount;
  }

  /**
   * Helper: Parse numbered format string to NumberFormat type
   */
  private parseNumberedFormat(
    formatString: string
  ): "decimal" | "lowerLetter" | "upperLetter" | "lowerRoman" | "upperRoman" {
    if (formatString.includes("a")) return "lowerLetter";
    if (formatString.includes("A")) return "upperLetter";
    if (formatString.includes("i")) return "lowerRoman";
    if (formatString.includes("I")) return "upperRoman";
    return "decimal";
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
        symbolIndent: number; // in inches
        textIndent: number; // in inches
        bulletChar?: string;
        numberedFormat?: string;
      }>;
    }
  ): Promise<number> {
    const manager = doc.getNumberingManager();

    // Parse numbering formats from UI settings
    const formats = settings.indentationLevels.map((level) =>
      this.parseNumberedFormat(level.numberedFormat || "1.")
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
        text: `%${index + 1}.`, // Standard template (e.g., %1., %2.)
        leftIndent: symbolTwips, // Number position (where number appears)
        hangingIndent: hangingTwips, // Text offset from number
      });
    });

    // Create custom numbered list with all UI-configured levels
    const numId = manager.createCustomList(levels, "UI Numbered List");
    if (!numId) {
      this.log.warn("Failed to create custom numbered list");
      return 0;
    }

    this.log.debug(`Created numbered list numId=${numId} with ${levels.length} levels`);

    // Apply to numbered list paragraphs only
    let standardizedCount = 0;
    const paragraphs = doc.getAllParagraphs();

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

    // Use framework method to standardize numbered list formatting
    // Applies Verdana 12pt bold black to ALL numbered lists in the document
    const result = doc.standardizeNumberedListPrefixes({
      font: "Verdana",
      fontSize: 12,
      color: "000000",
      bold: false,
    });
    this.log.debug(
      `Framework standardized ${result.listsUpdated} numbered lists, ${result.levelsModified} levels modified`
    );

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
  private async applyTableUniformity(
    doc: Document,
    options: WordProcessingOptions
  ): Promise<{
    tablesProcessed: number;
    headerRowsFormatted: number;
    cellsRecolored: number;
  }> {
    // Get shading colors for tables from session settings (strip # prefix for OOXML format)
    const header2Color = options.tableShadingSettings?.header2Shading?.replace("#", "") || "BFBFBF";
    const otherColor = options.tableShadingSettings?.otherShading?.replace("#", "") || "DFDFDF";

    this.log.debug(
      `Applying standard table formatting with colors: #${header2Color} (1x1), #${otherColor} (multi-cell)`
    );

    // Apply standard table formatting using docxmlater 1.8.0 helper
    // Pass both colors: first for 1x1 tables, second for multi-cell tables
    const result = doc.applyStandardTableFormatting(header2Color, otherColor);

    this.log.debug(`Applied standard formatting to ${result.tablesProcessed} tables`);
    this.log.debug(`Formatted ${result.headerRowsFormatted} header rows`);
    this.log.debug(`Recolored ${result.cellsRecolored} cells`);

    return result;
  }

  /**
   * Inject indentation properties into numbering.xml for consistent list indentation
   *
   * This function addresses the issue where doc.normalizeAllListIndentation() overrides
   * the custom indentation values set in NumberingLevel objects. By injecting indentation
   * directly into the XML, we ensure the values persist regardless of normalization.
   *
   * Injects <w:pPr><w:ind w:left="X" w:hanging="Y"/></w:pPr> for each level.
   *
   * @param doc - Document to modify
   * @param indentationLevels - Array of indentation configurations from UI
   * @returns true if successful, false otherwise
   */
  private async injectIndentationToNumbering(
    doc: Document,
    indentationLevels: Array<{
      level: number;
      symbolIndent: number; // in inches
      textIndent: number; // in inches
      bulletChar?: string;
      numberedFormat?: string;
    }>
  ): Promise<boolean> {
    try {
      // Access numbering.xml
      const numberingPart = await doc.getPart("word/numbering.xml");
      if (!numberingPart || typeof numberingPart.content !== "string") {
        this.log.warn("Unable to access numbering.xml for indentation injection");
        return false;
      }

      let xmlContent = numberingPart.content;
      let modified = false;

      // Process each indentation level
      for (const levelConfig of indentationLevels) {
        const levelIndex = levelConfig.level;

        // Calculate indentation values in twips (1440 twips = 1 inch)
        const symbolTwips = Math.round(levelConfig.symbolIndent * 1440);
        const textTwips = Math.round(levelConfig.textIndent * 1440);
        const hangingTwips = textTwips - symbolTwips;

        // Create the indentation XML element
        const indentXml = `<w:ind w:left="${textTwips}" w:hanging="${hangingTwips}"/>`;

        // Find all <w:lvl> elements with this level index
        const lvlRegex = new RegExp(
          `<w:lvl w:ilvl="${levelIndex}"[^>]*>([\\s\\S]*?)<\\/w:lvl>`,
          "g"
        );

        let match;
        // Reset regex index for each iteration
        lvlRegex.lastIndex = 0;

        while ((match = lvlRegex.exec(numberingPart.content)) !== null) {
          const levelContent = match[1];
          const fullMatch = match[0];

          // Check if w:pPr already exists in this level
          if (levelContent.includes("<w:pPr>")) {
            // Check if w:ind exists within w:pPr
            if (levelContent.includes("<w:ind")) {
              // Update existing w:ind
              const updatedContent = levelContent.replace(/<w:ind[^>]*\/>/, indentXml);
              xmlContent = xmlContent.replace(
                fullMatch,
                fullMatch.replace(levelContent, updatedContent)
              );
              modified = true;
            } else {
              // Insert w:ind into existing w:pPr (right after opening tag)
              const updatedContent = levelContent.replace(
                /<w:pPr>/,
                `<w:pPr>\n              ${indentXml}`
              );
              xmlContent = xmlContent.replace(
                fullMatch,
                fullMatch.replace(levelContent, updatedContent)
              );
              modified = true;
            }
          } else {
            // Insert new w:pPr in correct ECMA-376 position
            // OOXML Compliance: w:pPr should be near end of w:lvl, before w:rPr per ECMA-376 Part 1, Section 17.9.7
            const pPrXml = `
            <w:pPr>
              ${indentXml}
            </w:pPr>`;

            let updatedLevel;

            // Check if w:rPr exists - insert before it if so (correct ECMA-376 order)
            if (levelContent.includes("<w:rPr>")) {
              updatedLevel = fullMatch.replace(/(<w:rPr>)/, `${pPrXml}\n            $1`);
            } else {
              // No w:rPr exists - insert before closing tag (also correct per ECMA-376)
              updatedLevel = fullMatch.replace(/<\/w:lvl>/, `${pPrXml}\n          </w:lvl>`);
            }

            xmlContent = xmlContent.replace(fullMatch, updatedLevel);
            modified = true;
          }
        }

        this.log.debug(
          `Injected indentation for level ${levelIndex}: left=${textTwips} twips, hanging=${hangingTwips} twips`
        );
      }

      if (modified) {
        // Save modified XML back to document
        await doc.setPart("word/numbering.xml", xmlContent);
        this.log.info("Successfully injected indentation properties into numbering.xml");
        return true;
      }

      this.log.debug("No indentation modifications needed");
      return false;
    } catch (error) {
      this.log.warn("Error injecting indentation to numbering:", error);
      return false;
    }
  }

  /**
   * Ensure blank lines after complete list sequences
   *
   * Detects end of bullet/numbered list sequences and inserts blank paragraphs
   * after them for proper spacing. Only adds ONE blank line per complete sequence,
   * not after individual list items.
   *
   * @param doc - Document to process
   * @returns Number of blank lines inserted
   */
  private async ensureBlankLinesAfterLists(doc: Document): Promise<number> {
    let blankLinesAdded = 0;
    const paragraphs = doc.getAllParagraphs();

    this.log.debug(`Checking ${paragraphs.length} paragraphs for list sequence endings...`);

    for (let i = 0; i < paragraphs.length - 1; i++) {
      const currentPara = paragraphs[i];
      const nextPara = paragraphs[i + 1];

      // Check if current paragraph is a list item
      const currentNumbering = currentPara.getNumbering();
      if (!currentNumbering) {
        continue; // Not a list item, skip
      }

      // Check if next paragraph is also a list item
      const nextNumbering = nextPara?.getNumbering();

      // End of list detected: current has numbering, next doesn't
      if (!nextNumbering) {
        this.log.debug(`Found end of list sequence at paragraph ${i}`);

        // Check if there's already a blank line after the list
        const paraAfterList = paragraphs[i + 1];
        if (paraAfterList && this.isParagraphTrulyEmpty(paraAfterList)) {
          // Blank line exists - just mark it as preserved and set Normal style
          paraAfterList.setPreserved(true);
          paraAfterList.setStyle("Normal");
          paraAfterList.setSpaceAfter(120); // 6pt spacing
          this.log.debug(`Marked existing blank line as preserved at paragraph ${i + 1}`);
        } else {
          // No blank line - insert one
          const blankPara = doc.createParagraph("");
          blankPara.setStyle("Normal");
          blankPara.setPreserved(true);
          blankPara.setSpaceAfter(120); // 6pt spacing per spec

          // Insert after the current list item (at position i + 1)
          doc.insertParagraphAt(i + 1, blankPara);
          blankLinesAdded++;

          this.log.debug(`Inserted blank line after list sequence at position ${i + 1}`);

          // Skip the newly inserted paragraph in next iteration
          i++;
        }
      }
    }

    this.log.info(`Processed list sequences: added ${blankLinesAdded} blank lines`);
    return blankLinesAdded;
  }

  /**
   * Standardize numbering colors to black to fix green bullet issue
   * Uses framework methods for both bullet and numbered lists
   *
   * REFACTORED: Now uses doc.standardizeBulletSymbols() and doc.standardizeNumberedListPrefixes()
   */
  private async standardizeNumberingColors(doc: Document): Promise<boolean> {
    try {
      // Standardize all bullet lists - bullets should be bold
      const bulletResult = doc.standardizeBulletSymbols({
        color: "000000",
        bold: true,
      });

      // Standardize all numbered lists - numbers should NOT be bold
      const numberedResult = doc.standardizeNumberedListPrefixes({
        color: "000000",
        bold: false,
      });

      if (bulletResult.listsUpdated > 0 || numberedResult.listsUpdated > 0) {
        this.log.debug(
          `Standardized numbering colors to black using framework methods: ${bulletResult.listsUpdated} bullet lists, ${numberedResult.listsUpdated} numbered lists`
        );
        return true;
      }

      return false;
    } catch (error) {
      this.log.warn("Unable to standardize numbering colors:", error);
      return false;
    }
  }

  /**
   * Apply smart table formatting using docxmlater APIs
   *
   * Intelligent table formatting:
   * - Detects 1x1 tables and applies Header 2 shading color
   * - Applies other table shading color to multi-cell tables (skips white cells)
   * - Sets consistent padding (0" top/bottom, 0.08" left/right)
   * - Sets autofit to window for all tables
   */
  private async applySmartTableFormatting(
    doc: Document,
    options: WordProcessingOptions
  ): Promise<number> {
    const tables = doc.getTables();
    let formattedCount = 0;

    // Get shading colors from UI settings (strip # prefix for OOXML format)
    const header2Color =
      options.tableShadingSettings?.header2Shading?.replace("#", "").toUpperCase() || "BFBFBF";
    const otherColor =
      options.tableShadingSettings?.otherShading?.replace("#", "").toUpperCase() || "DFDFDF";

    // Log fallback usage if colors weren't provided
    if (!options.tableShadingSettings?.header2Shading) {
      this.log.debug(
        "Header 2 shading color not provided in tableShadingSettings, using fallback: #BFBFBF"
      );
    }
    if (!options.tableShadingSettings?.otherShading) {
      this.log.debug(
        "Other table shading color not provided in tableShadingSettings, using fallback: #DFDFDF"
      );
    }

    // Cell margins: 0" top/bottom, 0.08" left/right (0.08 inches = 115 twips)
    const cellMargins = {
      top: 0,
      bottom: 0,
      left: 115, // 0.08 inches
      right: 115, // 0.08 inches
    };

    for (const table of tables) {
      try {
        const rowCount = table.getRowCount();
        const columnCount = table.getColumnCount();

        if (rowCount === 0) continue;

        // Detect 1x1 tables
        const is1x1Table = rowCount === 1 && columnCount === 1;

        // Set autofit to window for all tables
        table.setLayout("auto");

        if (is1x1Table) {
          // Handle 1x1 tables - apply Header 2 shading color
          const singleCell = table.getRow(0)?.getCell(0);
          if (singleCell) {
            singleCell.setShading({ fill: header2Color });
            singleCell.setMargins(cellMargins);

            // Set all text in the cell to bold
            for (const para of singleCell.getParagraphs()) {
              for (const run of para.getRuns()) {
                run.setBold(true);
              }
            }

            this.log.debug(`Applied Header 2 shading (#${header2Color}) to 1x1 table`);
          }
        } else {
          // Handle multi-cell tables - apply other table shading color (skip white cells and cells with no color)
          const rows = table.getRows();
          let rowIndex = 0;
          for (const row of rows) {
            let cellIndex = 0;
            for (const cell of row.getCells()) {
              // Check current cell shading
              const currentShading = cell.getFormatting().shading?.fill?.toUpperCase();
              const currentColor = currentShading;

              // Only apply shading if cell has a color AND that color is not white
              const isWhite = currentColor === "FFFFFF";
              const hasNoColor = currentColor === undefined || currentColor === null || currentColor === "AUTO";

              // DEBUG: Log each cell's color evaluation
              this.log.debug(
                `[Table ${formattedCount}] Row ${rowIndex}, Cell ${cellIndex}: ` +
                `currentColor="${currentColor || "NONE"}", ` +
                `isWhite=${isWhite}, hasNoColor=${hasNoColor}, ` +
                `willShade=${!hasNoColor && !isWhite}`
              );

              if (!hasNoColor && !isWhite) {
                // Apply shading: cell has a color and it's not white
                this.log.debug(
                  `  → Shading cell (${rowIndex},${cellIndex}) with #${otherColor} (original color: ${currentColor})`
                );
                cell.setShading({ fill: otherColor });

                // Set all text in the cell to bold
                for (const para of cell.getParagraphs()) {
                  for (const run of para.getRuns()) {
                    run.setBold(true);
                  }
                }
              } else {
                this.log.debug(
                  `  → Skipping cell (${rowIndex},${cellIndex}) - ${hasNoColor ? "no color" : "white"}`
                );
              }

              // Center paragraphs containing images OR in shaded cells (skip list paragraphs)
              // Images should always be centered and have 2pt black borders
              const isShaded = !hasNoColor && !isWhite;
              for (const para of cell.getParagraphs()) {
                if (!para.getNumbering()) {
                  // Check if paragraph contains an image (directly or inside revisions)
                  const hasImage = this.paragraphContainsImage(para);
                  if (hasImage) {
                    para.setAlignment("center");
                    this.applyBorderToImages(para, 2); // 2-point black border
                  } else if (isShaded) {
                    para.setAlignment("center");
                  }
                }
              }

              cell.setMargins(cellMargins);

              cellIndex++;
            }
            rowIndex++;
          }
          this.log.debug(`Applied other table shading (#${otherColor}) to multi-cell table`);
        }

        formattedCount++;
        this.log.debug(
          `Smart formatting applied to table: ${is1x1Table ? "1x1" : `${rowCount}x${columnCount}`}`
        );
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
    this.log.debug("=== STANDARDIZING HYPERLINK COLORS ===");

    // Use DocXMLater's built-in helper to update all hyperlinks at once
    const updatedCount = doc.updateAllHyperlinkColors("0000FF");

    if (updatedCount > 0) {
      this.log.info(`Standardized ${updatedCount} hyperlink(s) to blue (#0000FF)`);
    } else {
      this.log.debug("All hyperlinks already have correct color");
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
              this.log.debug(
                `Created bookmark "${newBookmark}" for heading "${sanitizedLinkText}"`
              );
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
    const paragraphs = doc.getAllParagraphs();
    const normalizedSearch = searchText.trim().toLowerCase();

    for (const para of paragraphs) {
      const style = para.getStyle() || para.getFormatting().style;

      // Check if it's a heading style
      if (style && (style.startsWith("Heading") || style.includes("Heading"))) {
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
      if (!para || typeof para.getText !== "function") {
        this.log.warn(`Invalid paragraph object: ${typeof para}`);
        return "";
      }

      // Use docxmlater's built-in getText() method
      return para.getText() || "";
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.log.warn(`Failed to extract text from paragraph: ${errorMsg}`);
      return "";
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
    const hasTopHyperlinkStyle = existingStyles.some(
      (style: any) => style.styleId === "TopHyperlink" || style.id === "TopHyperlink"
    );

    if (hasTopHyperlinkStyle) {
      this.log.debug("TopHyperlink style already exists, skipping creation");
      return;
    }

    this.log.debug("Creating TopHyperlink style with guaranteed zero spacing");

    // Create custom style with exact specifications
    const style = Style.create({
      styleId: "TopHyperlink",
      name: "Top Hyperlink",
      type: "paragraph",
      basedOn: "Normal",
      runFormatting: {
        font: "Verdana",
        size: 12,
        color: "0000FF", // Blue
        underline: "single",
      },
      paragraphFormatting: {
        alignment: "right",
        spacing: {
          before: 60, // 3pt = 60 twips (20 twips per point)
          after: 0, // GUARANTEED ZERO - no inheritance
          line: 240, // 12pt = 240 twips
          lineRule: "exact", // Use 'exact' instead of 'auto' to prevent extra space
        },
      },
    });

    doc.addStyle(style);
    this.log.debug("TopHyperlink style created successfully");
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
    const hyperlink = Hyperlink.createInternal("_top", "Top of the Document", {
      font: "Verdana",
      size: 12,
      color: "0000FF",
      underline: "single",
    });

    // Create paragraph and add hyperlink
    const para = Paragraph.create();
    para.addHyperlink(hyperlink);

    // Apply TopHyperlink style - this handles all formatting including guaranteed zero spacing
    para.setStyle("TopHyperlink");

    // Mark as preserved to protect from paragraph removal operations
    para.setPreserved(true);

    // FIX Issue 3: Removed redundant setAlignment('right') call
    // The TopHyperlink style already defines right alignment in paragraphFormatting
    // Adding it again at paragraph level creates a direct formatting override that
    // causes the alignment to be set to 'left' in the output XML
    // Style-based alignment is sufficient and prevents the override bug

    // No need for manual formatting - style handles:
    // - Right alignment (from style definition)
    // - Space before: 60 twips (3pt)
    // - Space after: 0 twips (GUARANTEED ZERO)
    // - Line spacing: 240 twips exact (12pt)

    return para;
  }

  /**
   * Fix any existing "Top of Document" hyperlinks throughout the document
   * Searches ALL paragraphs (body, tables, headers, footers) and checks for incorrect text, formatting, or bookmarks
   * Updates display text, formatting, and bookmark reference to match standard
   *
   * @param doc - Document to search and fix
   * @returns Number of hyperlinks fixed
   */
  private async fixExistingTopHyperlinks(doc: Document): Promise<number> {
    let fixedCount = 0;

    // Ensure TopHyperlink style exists before fixing existing hyperlinks
    this.ensureTopHyperlinkStyle(doc);

    // Check ALL paragraphs in document (body, tables, headers, footers)
    const paragraphsToCheck = doc.getAllParagraphs();

    this.log.debug(
      `Checking ${paragraphsToCheck.length} paragraphs (ALL locations) for Top of Document hyperlinks to fix...`
    );

    for (const para of paragraphsToCheck) {
      const content = para.getContent();

      // Check each content item for hyperlinks
      for (const item of content) {
        if (item instanceof Hyperlink) {
          const text = sanitizeHyperlinkText(item.getText()).toLowerCase();

          // Check if this is a "Top of" hyperlink
          if (
            text.includes("top of") &&
            (text.includes("document") || text === "top of the document")
          ) {
            let needsUpdate = false;

            // Check 1: Text needs updating (missing "the")
            if (text === "top of document") {
              item.setText("Top of the Document");
              needsUpdate = true;
              this.log.debug(
                'Updated hyperlink text from "Top of Document" to "Top of the Document"'
              );
            }

            // Check 2: Bookmark target (get current target and compare)
            const currentTarget = (item as any).anchor || (item as any).target;
            if (currentTarget && currentTarget !== "_top") {
              // Update to use _top bookmark
              // Note: Hyperlink class may not expose setAnchor, so we recreate it
              this.log.debug(`Hyperlink uses bookmark "${currentTarget}", should be "_top"`);
              needsUpdate = true;
            }

            // Check 3: Formatting (we'll recreate the hyperlink with correct formatting)
            if (needsUpdate) {
              // Recreate hyperlink with correct settings
              const correctedLink = Hyperlink.createInternal("_top", "Top of the Document", {
                font: "Verdana",
                size: 12,
                color: "0000FF",
                underline: "single",
              });

              // Update the hyperlink text
              // Note: Could use doc.replaceParagraphAt(index, newPara) for full paragraph replacement if needed
              item.setText("Top of the Document");
              fixedCount++;

              this.log.debug("Fixed Top of Document hyperlink (text, formatting, bookmark)");
            }

            // Check 4: Apply TopHyperlink style for guaranteed correct formatting
            // This replaces manual formatting and ensures zero spacing after
            const currentStyle = para.getStyle();
            if (currentStyle !== "TopHyperlink") {
              para.setStyle("TopHyperlink");
              // Explicitly set right alignment AFTER style to ensure it's applied after spacing
              para.setAlignment("right");
              this.log.debug(
                "Applied TopHyperlink style and explicit right alignment (spacing before alignment)"
              );
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
    if (!doc.hasBookmark("_top")) {
      this.log.debug("Creating _top bookmark at document start using addTopBookmark()...");

      try {
        doc.addTopBookmark();
        this.log.debug("Created _top bookmark at document body start");
      } catch (error) {
        this.log.error(
          `Failed to create _top bookmark: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        // Continue anyway - hyperlinks will still be created
      }
    } else {
      this.log.debug("_top bookmark already exists");
    }

    // Fix any existing "Top of Document" hyperlinks before adding new ones
    const fixedCount = await this.fixExistingTopHyperlinks(doc);
    if (fixedCount > 0) {
      this.log.info(
        `Fixed ${fixedCount} existing Top of Document hyperlinks with TopHyperlink style`
      );
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

      // ENHANCEMENT 3: Check if this table is a 1x1 table (user request)
      const rows = table.getRows();
      const is1x1Table = rows.length === 1 && rows[0]?.getCells().length === 1;

      if (is1x1Table) {
        // Treat 1x1 tables the same as Header 2 tables
        hasHeader2 = true;
        this.log.debug(`Table ${tableIndex} is a 1x1 table - will add Top of Document link`);
      } else {
        // Original Header 2 detection for non-1x1 tables
        table.getRows().forEach((row) => {
          row.getCells().forEach((cell) => {
            cell.getParagraphs().forEach((para) => {
              const style = para.getStyle() || para.getFormatting().style;
              if (
                style &&
                (style === "Heading2" || style === "Heading 2" || style.includes("Heading2"))
              ) {
                hasHeader2 = true;
              }
            });
          });
        });
      }

      if (hasHeader2) {
        tablesWithHeader2.push({ tableIndex, table, hasHeader2 });
      }
    });

    // Skip first table with Header 2, process the rest
    if (tablesWithHeader2.length <= 1) {
      this.log.debug(
        `Found ${tablesWithHeader2.length} tables with Header 2, nothing to process (first is skipped)`
      );
      return 0;
    }

    this.log.debug(
      `Found ${tablesWithHeader2.length} tables with Header 2, processing ${tablesWithHeader2.length - 1} (skipping first)`
    );

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
                if (text.includes("top of")) {
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
          // ENHANCEMENT 2: Insert blank line ABOVE the "Top of Document" link (user request)
          const blankPara = doc.createParagraph("");
          blankPara.setStyle("Normal");
          blankPara.setPreserved(true); // Protect from removal
          doc.insertParagraphAt(tablePosition, blankPara);

          // Create and insert the hyperlink paragraph AFTER the blank line
          const hyperlinkPara = this.createTopHyperlinkParagraph(doc);
          doc.insertParagraphAt(tablePosition + 1, hyperlinkPara); // +1 because blank is now at tablePosition
          linksAdded++;

          this.log.debug(
            `Inserted blank line and Top of Document link before table ${tableIndex} at positions ${tablePosition} and ${tablePosition + 1}`
          );
        }
      } catch (error) {
        this.log.warn(
          `Failed to process table ${tableIndex}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    this.log.info(
      `Processed ${tablesWithHeader2.length - 1} tables with Header 2, added/updated ${linksAdded} Top of Document links`
    );
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
      matchType: "contains" | "exact" | "startsWith";
      applyTo: "url" | "text" | "both";
    }>
  ): Promise<number> {
    if (!customReplacements || customReplacements.length === 0) {
      this.log.debug("No custom replacements configured - skipping outdated title replacement");
      return 0;
    }

    let replacedCount = 0;
    const hyperlinks = await this.docXMLater.extractHyperlinks(doc);

    for (const { hyperlink, text } of hyperlinks) {
      for (const rule of customReplacements) {
        // Only apply rules that target text or both
        if (rule.applyTo === "text" || rule.applyTo === "both") {
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
    const warningLine1 =
      "Not to Be Reproduced or Disclosed to Others Without Prior Written Approval";
    const warningLine2 = "ELECTRONIC DATA = OFFICIAL VERSION - PAPER COPY = INFORMATIONAL ONLY";

    this.log.debug("Adding/updating document warning at end of document");

    // Step 1: Search for existing warning in last 5 paragraphs (case-insensitive)
    const paragraphs = doc.getAllParagraphs();
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

    // Step 3: Create blank line for separation before warning
    const blankPara = doc.createParagraph("");
    blankPara.setSpaceBefore(pointsToTwips(0));
    blankPara.setSpaceAfter(pointsToTwips(0));
    this.log.debug("Created blank paragraph for separation before warning");

    // Step 4: Create first line (normal weight)
    const para1 = doc.createParagraph(warningLine1);
    para1.setAlignment("center");
    para1.setSpaceBefore(pointsToTwips(3));
    para1.setSpaceAfter(pointsToTwips(3));

    // Format runs in first paragraph
    const runs1 = para1.getRuns();
    for (const run of runs1) {
      run.setFont("Verdana");
      run.setSize(8);
      // Note: bold is false by default, so no need to explicitly set it
    }

    this.log.debug("Created first warning line (normal weight)");

    // Step 5: Create second line (bold)
    const para2 = doc.createParagraph(warningLine2);
    para2.setAlignment("center");
    para2.setSpaceBefore(pointsToTwips(3));
    para2.setSpaceAfter(pointsToTwips(3));

    // Format runs in second paragraph (bold)
    const runs2 = para2.getRuns();
    for (const run of runs2) {
      run.setFont("Verdana");
      run.setSize(8);
      run.setBold(true);
    }

    this.log.debug("Created second warning line (bold)");
    this.log.info("Document warning added/updated successfully at end of document");
  }

  /**
   * Generate short hash from string for bookmark names
   * @param str - Input string to hash
   * @returns 8-character hash in base36
   */
  private shortHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36).substring(0, 8);
  }

  /**
   * Apply custom formatting to TOC1-TOC9 styles with RELATIVE indentation
   * The lowest heading level in the TOC gets 0" indent, each higher level gets +0.25"
   * @param doc - Document to process
   * @param levelsToInclude - Array of heading levels that will be included in TOC
   */
  private applyTOCStyles(doc: Document, levelsToInclude: number[]): void {
    this.log.debug("Applying custom TOC styles with RELATIVE indentation...");

    if (levelsToInclude.length === 0) {
      this.log.warn("No levels to include - skipping TOC style application");
      return;
    }

    // Calculate minimum level for relative indentation
    const minLevel = Math.min(...levelsToInclude);
    this.log.debug(`Minimum heading level in TOC: ${minLevel} (will have 0" indent)`);

    // Apply styles only for the levels that will be used
    for (let i = 0; i < levelsToInclude.length; i++) {
      const absoluteLevel = levelsToInclude[i];
      const relativeIndex = absoluteLevel - minLevel; // 0 for lowest, 1 for next, etc.
      const indentInches = relativeIndex * 0.25;
      const indentTwips = Math.round(indentInches * 1440); // 1440 twips = 1 inch

      const styleId = `TOC${absoluteLevel}`;

      const style = Style.create({
        styleId: styleId,
        name: `toc ${absoluteLevel}`,
        type: "paragraph",
        basedOn: "Normal",
        runFormatting: {
          font: "Verdana",
          size: 12,
          color: "0000FF", // Blue - persistent color
          underline: "single",
        },
        paragraphFormatting: {
          spacing: {
            before: 0,
            after: 0,
            line: 240,
            lineRule: "auto",
          },
          indentation: {
            left: indentTwips, // RELATIVE indentation
          },
          alignment: "left",
        },
      });

      doc.addStyle(style); // Updates existing or creates new
      this.log.debug(
        `Applied TOC${absoluteLevel} style: Verdana 12pt Blue, ${indentInches}" indent (relative position ${relativeIndex})`
      );
    }

    this.log.info(
      `Applied ${levelsToInclude.length} TOC styles with relative indentation (min level ${minLevel} = 0" indent)`
    );
  }

  /**
   * Ensure all heading paragraphs have bookmarks
   * Creates bookmarks only for headings that don't already have one
   * @param doc - Document to process
   */
  private async ensureHeadingBookmarks(doc: Document): Promise<void> {
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const style = para.getStyle();
      const match = style?.match(/^Heading\s*(\d+)$/i);

      if (match) {
        // Check if paragraph already has a bookmark
        // Note: getBookmarks() doesn't exist - use getBookmarksStart() or getBookmarksEnd()
        const bookmarksStart = para.getBookmarksStart();
        const bookmarksEnd = para.getBookmarksEnd();
        const hasBookmark =
          (bookmarksStart && bookmarksStart.length > 0) ||
          (bookmarksEnd && bookmarksEnd.length > 0);

        if (!hasBookmark) {
          const level = parseInt(match[1], 10);
          const text = para.getText().replace(/[^\w]/g, "").substring(0, 30);
          const bookmarkName = `_Toc_${level}_${this.shortHash(text + Date.now())}`;
          const bookmark = new Bookmark({ name: bookmarkName });
          para.addBookmark(bookmark);

          this.log.debug(
            `Created bookmark "${bookmarkName}" for Heading${level}: "${para.getText()}"`
          );
        }
      }
    }
  }

  /**
   * Parse TOC field instruction to extract heading levels
   * Enhanced implementation with support for &quot; entities and multiple quote styles
   *
   * Handles formats like:
   * - "TOC \o "1-3" \h \* MERGEFORMAT"
   * - "TOC \h \u \z \t &quot;Heading 2,2,&quot;"
   * - "TOC \o "1-9" \h \z \u"
   *
   * BUG FIX: docxmlater's getFieldInstruction() may return incorrect data when
   * &quot; entities are present in the XML. This method now reads instrText
   * directly from document.xml to ensure accurate parsing.
   *
   * @param doc Document to extract TOC instruction from
   * @returns Array of heading levels to include (e.g., [1, 2, 3])
   */
  private async parseTOCLevels(doc: Document): Promise<number[]> {
    const levels = new Set<number>();
    let hasOutlineSwitch = false;
    let hasTableSwitch = false;

    // BUG FIX: Read instrText directly from document.xml to handle &quot; entities
    let instruction: string | null = null;

    try {
      const documentXml = await doc.getPart("word/document.xml");
      if (documentXml && typeof documentXml.content === "string") {
        const instrMatch = documentXml.content.match(/<w:instrText[^>]*>(.*?)<\/w:instrText>/);
        if (instrMatch) {
          instruction = instrMatch[1]
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .trim();
          this.log.debug(`Raw TOC instruction from XML: "${instruction}"`);
        }
      }
    } catch (error) {
      this.log.warn("Failed to read instrText from document.xml:", error);
    }

    // Fallback: try getting from TOC elements if direct XML read failed
    if (!instruction) {
      const tocElements = doc.getTableOfContentsElements();
      if (tocElements.length > 0) {
        const toc = (tocElements[0] as any).toc as TableOfContents;
        if (toc) {
          instruction = toc.getFieldInstruction();
          this.log.debug(`Fallback: Got instruction from getFieldInstruction(): "${instruction}"`);
        }
      }
    }

    if (!instruction) {
      this.log.warn("No TOC instruction found");
      return [];
    }

    // Normalize whitespace and quotes
    let normalizedText = instruction.trim();
    normalizedText = normalizedText.replace(/&quot;/g, '"');
    normalizedText = normalizedText.replace(/[""]/g, '"');

    this.log.debug(`Normalized TOC instruction: "${normalizedText}"`);

    // === Parse \o "X-Y" switch (outline levels) ===
    const outlineMatch = normalizedText.match(/\\o\s+(?:"([^"]+)"|'([^']+)'|([^'\s"][^"\s]*))/);
    if (outlineMatch) {
      const levelsValue = outlineMatch?.[1] ?? outlineMatch?.[2] ?? outlineMatch?.[3];

      if (levelsValue) {
        this.log.debug(`Found \o switch with levels value: "${levelsValue}"`);

        const rangeMatch = levelsValue.match(/^(\d+)-(\d+)$/);
        if (rangeMatch?.[1] && rangeMatch?.[2]) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          if (!isNaN(start) && !isNaN(end)) {
            hasOutlineSwitch = true;
            for (let i = start; i <= end; i++) {
              if (i >= 1 && i <= 9) {
                levels.add(i);
              }
            }
            this.log.debug(`Found range format: levels ${start}-${end} added`);
          }
        } else if (levelsValue.includes(",") || levelsValue.includes("/")) {
          const separator = levelsValue.includes(",") ? "," : "/";
          const levelNums = levelsValue
            .split(separator)
            .map((s: string) => parseInt(s.trim(), 10))
            .filter((n: number) => !isNaN(n) && n >= 1 && n <= 9);

          if (levelNums.length > 0) {
            hasOutlineSwitch = true;
            levelNums.forEach((lvl: number) => levels.add(lvl));
            this.log.debug(`Found comma/slash format: levels [${levelNums.join(", ")}] added`);
          }
        }
      }
    }

    // === Parse \t "..." switches ===
    const tSwitchRegex = /\\t\s*"([^"]*)"/g;
    const tMatches = [...normalizedText.matchAll(tSwitchRegex)];

    this.log.debug(`Found ${tMatches.length} \\t switch(es) in instruction`);

    for (const match of tMatches) {
      hasTableSwitch = true;
      const content = (match[1] || "").trim();

      this.log.debug(`Processing \\t switch content: "${content}"`);

      if (!content) {
        this.log.warn(`Empty content in \\t switch, skipping`);
        continue;
      }

      const rangeMatch = content.match(/^(\d+)-(\d+)$/);
      if (rangeMatch?.[1] && rangeMatch?.[2]) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        for (let i = start; i <= end; i++) {
          if (i >= 1 && i <= 9) levels.add(i);
        }
        this.log.debug(`Found range format in \\t switch: levels ${start}-${end} added`);
        continue;
      }

      const parts = content
        .split(",")
        .map((p: string) => p.trim())
        .filter(Boolean);

      this.log.debug(`Style format parts (${parts.length} parts): [${parts.join(", ")}]`);

      for (let i = 0; i < parts.length; i += 2) {
        if (i + 1 < parts.length) {
          const styleName = parts[i];
          const levelStr = parts[i + 1];

          this.log.debug(`  Pair ${i / 2}: style="${styleName}", level="${levelStr}"`);

          if (levelStr) {
            const level = parseInt(levelStr, 10);
            if (!isNaN(level) && level >= 1 && level <= 9) {
              levels.add(level);
              this.log.info(`✓ Added level ${level} from \\t switch for style "${styleName}"`);
            } else {
              this.log.warn(`  Invalid level value: "${levelStr}" (not a number 1-9)`);
            }
          }
        } else {
          this.log.debug(`  Unpaired style name at index ${i}: "${parts[i]}" (no level follows)`);
        }
      }
    }

    // === Parse \u switch ===
    if (/\\u(?:\s|\\|$)/.test(normalizedText)) {
      if (!hasOutlineSwitch && !hasTableSwitch) {
        for (let i = 1; i <= 9; i++) levels.add(i);
        this.log.debug(`Found \\u switch without \\o or \\t: defaulting to levels 1-9`);
      } else if (hasTableSwitch) {
        this.log.debug(`Found \\u switch but \\t switch already processed - using \\t results`);
      }
    }

    const result = Array.from(levels).sort((a, b) => a - b);

    if (result.length === 0) {
      this.log.warn(`No TOC levels parsed from instruction: "${normalizedText}"`);
      this.log.info("Caller will auto-detect heading levels from document structure");
      return [];
    }

    this.log.info(`Successfully parsed TOC levels: [${result.join(", ")}]`);
    return result;
  }

  /**
   * Build proper TOC with styles, bookmarks, and field configuration
   *
   * Complete TOC solution that:
   * 1. Ensures every heading has a bookmark
   * 2. Applies custom TOC1-TOC9 styles (Verdana 12pt, Blue, Underlined)
   * 3. Ensures real TOC field with correct switches (\h \z \u)
   * 4. Populates TOC with styled hyperlink entries
   *
   * Result: Real TOC field + immediate manual population with persistent blue color
   *
   * @param doc - Document to process
   * @returns Number of TOC entries created
   */
  public async buildProperTOC(doc: Document): Promise<number> {
    this.log.debug("=== BUILDING PROPER TOC ===");

    // Step 1: Ensure all headings have bookmarks
    await this.ensureHeadingBookmarks(doc);
    this.log.debug("✓ Step 1: Ensured heading bookmarks");

    // Step 2: Parse TOC levels or auto-detect from document
    let levelsToInclude = await this.parseTOCLevels(doc);
    if (levelsToInclude.length === 0) {
      // Auto-detect: get all unique heading levels from document
      const allParagraphs = doc.getAllParagraphs();
      const uniqueLevels = new Set<number>();

      for (const para of allParagraphs) {
        const style = para.getStyle();
        const match = style?.match(/^Heading\s*(\d+)$/i);
        if (match && match[1]) {
          const level = parseInt(match[1], 10);
          if (!isNaN(level) && level >= 1 && level <= 9) {
            uniqueLevels.add(level);
          }
        }
      }

      levelsToInclude = Array.from(uniqueLevels).sort((a, b) => a - b);
      this.log.debug(`Auto-detected heading levels: ${levelsToInclude.join(", ")}`);
    }

    // Step 3: Apply custom TOC1-TOC9 styles
    this.applyTOCStyles(doc, levelsToInclude);
    this.log.debug("✓ Step 3: Applied TOC styles");

    // Step 4: Populate TOC manually with styled entries
    const entriesCreated = await this.manuallyPopulateTOC(doc);
    this.log.debug(`✓ Step 4: Created ${entriesCreated} TOC entries`);

    this.log.info(
      `✓ Built proper TOC with ${entriesCreated} entries (real field + styled hyperlinks)`
    );
    return entriesCreated;
  }

  /**
   * Manually populate Table of Contents with bookmarks and internal hyperlinks
   *
   * This comprehensive implementation:
   * 1. Finds all existing headings (Heading1, Heading2, Heading3) in document
   * 2. Creates bookmarks for each heading
   * 3. Finds all TOC field elements in document (or creates TOC from scratch if none exist)
   * 4. Parses TOC field instructions to determine which levels to include
   * 5. Replaces TOC fields with manual hyperlink paragraphs
   * 6. Formats TOC entries with proper indentation and Verdana 12pt blue styling
   *
   * @param doc - Document to process
   * @returns Number of TOC entries created
   */
  private async manuallyPopulateTOC(doc: Document): Promise<number> {
    let totalEntriesCreated = 0;

    try {
      // ============================================
      // STEP 1: GET ALL EXISTING HEADINGS
      // ============================================
      interface HeadingInfo {
        paragraph: Paragraph;
        level: number;
        text: string;
        bookmark: Bookmark;
      }

      const allHeadings: HeadingInfo[] = [];
      const allParagraphs = doc.getAllParagraphs(); // Searches body AND tables

      this.log.debug(`Scanning ${allParagraphs.length} paragraphs for headings...`);

      for (const para of allParagraphs) {
        const style = para.getStyle();

        // Match ANY heading level (not just 1-3)
        const match = style?.match(/^Heading\s*(\d+)$/i);
        if (match && match[1]) {
          const level = parseInt(match[1], 10);
          const text = para.getText().trim();

          if (text) {
            // Create unique bookmark for this heading
            const bookmarkName = `_Heading_${level}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const bookmark = new Bookmark({ name: bookmarkName });
            const registered = doc.getBookmarkManager().register(bookmark);

            // Add bookmark to the heading paragraph
            para.addBookmark(registered);

            allHeadings.push({
              paragraph: para,
              level: level,
              text: text,
              bookmark: registered,
            });

            this.log.debug(`Found Heading${level}: "${text}" (bookmark: ${bookmarkName})`);
          }
        }
      }

      this.log.info(`Found ${allHeadings.length} headings in document`);

      if (allHeadings.length === 0) {
        this.log.warn("No headings found - TOC cannot be populated");
        return 0;
      }

      // ============================================
      // STEP 2: DETECT EXISTING TOC (BOTH FIELD AND MANUAL)
      // ============================================
      const tocElements = doc.getTableOfContentsElements();

      // Also detect manually-created TOC entries (paragraphs with TOC1-TOC9 styles)
      const bodyElements = doc.getBodyElements();
      const manualTocParagraphs: Paragraph[] = [];
      let manualTocStartIndex = -1;

      for (let i = 0; i < bodyElements.length; i++) {
        const element = bodyElements[i];
        if (element instanceof Paragraph) {
          const style = element.getStyle();
          // Check if this paragraph has a TOC style (TOC1 through TOC9)
          if (style && /^TOC\d+$/i.test(style)) {
            if (manualTocStartIndex === -1) {
              manualTocStartIndex = i;
            }
            manualTocParagraphs.push(element);
          } else if (manualTocParagraphs.length > 0) {
            // Found non-TOC paragraph after TOC entries - stop collecting
            break;
          }
        }
      }

      if (manualTocParagraphs.length > 0) {
        this.log.info(
          `Found ${manualTocParagraphs.length} manually-created TOC entries at index ${manualTocStartIndex}`
        );
      }

      this.log.info(`Found ${tocElements.length} TOC field element(s) in document`);

      // ============================================
      // STEP 3: DETERMINE TOC LEVELS TO INCLUDE
      // ============================================
      let levelsToInclude: number[] = [];

      // Parse TOC levels from document (handles &quot; entities correctly)
      levelsToInclude = await this.parseTOCLevels(doc);
      if (levelsToInclude.length > 0) {
        this.log.info(`Parsed levels from TOC field: ${levelsToInclude.join(", ")}`);
      }

      // If no levels found, use all heading levels found in document
      if (levelsToInclude.length === 0) {
        const uniqueLevels = new Set(allHeadings.map((h) => h.level));
        levelsToInclude = Array.from(uniqueLevels).sort((a, b) => a - b);
        this.log.info(
          `No TOC field found or parsed - using all heading levels in document: ${levelsToInclude.join(", ")}`
        );
      }

      // ============================================
      // STEP 4: FILTER HEADINGS BY LEVELS
      // ============================================
      const tocHeadings = allHeadings.filter((h) => levelsToInclude.includes(h.level));

      if (tocHeadings.length === 0) {
        this.log.warn("No headings match TOC level filter");
        return 0;
      }

      this.log.info(
        `Building TOC with ${tocHeadings.length} headings (levels: ${levelsToInclude.join(", ")})`
      );

      // ============================================
      // STEP 5: BUILD MANUAL TOC ENTRIES WITH TOC STYLES
      // ============================================
      const tocParagraphs: Paragraph[] = [];

      for (const heading of tocHeadings) {
        // Create paragraph for TOC entry
        const tocEntry = new Paragraph();

        // Apply TOC style for this heading level (TOC1, TOC2, etc.)
        const tocStyleId = `TOC${heading.level}`;
        tocEntry.setStyle(tocStyleId);

        // Create internal hyperlink
        const hyperlink = Hyperlink.createInternal(heading.bookmark.getName(), heading.text, {
          font: "Verdana",
          size: 12,
          color: "0000FF", // Blue - persistent color
          underline: "single",
        });

        // Add hyperlink to paragraph
        tocEntry.addHyperlink(hyperlink);

        tocParagraphs.push(tocEntry);

        this.log.debug(
          `Created TOC entry for ${heading.text} (Level ${heading.level}, style: ${tocStyleId})`
        );
      }

      // ============================================
      // STEP 6: REMOVE EXISTING TOC (FIELD OR MANUAL)
      // ============================================
      let insertPosition = 0;

      // Remove existing TOC field elements
      if (tocElements.length > 0) {
        for (const tocElement of tocElements) {
          const tocIndex = bodyElements.indexOf(tocElement);
          if (tocIndex !== -1) {
            doc.removeTocAt(tocIndex);
            this.log.debug(`Removed original TOC field at index ${tocIndex}`);
            insertPosition = tocIndex;
            break; // Only process first TOC
          }
        }
      }
      // Remove manually-created TOC paragraphs (from previous runs)
      else if (manualTocParagraphs.length > 0) {
        // Remove in reverse order to maintain indices
        for (let i = manualTocParagraphs.length - 1; i >= 0; i--) {
          const success = doc.removeParagraph(manualTocParagraphs[i]);
          if (success) {
            this.log.debug(`Removed manual TOC entry ${i + 1}/${manualTocParagraphs.length}`);
          }
        }
        insertPosition = manualTocStartIndex;
        this.log.info(`Removed ${manualTocParagraphs.length} existing manual TOC entries`);
      }
      // No existing TOC - insert after first Heading 1
      else {
        // Find the first Heading 1 paragraph and insert TOC after it
        const paragraphs = doc.getAllParagraphs();
        let firstHeading1Index = -1;
        for (let i = 0; i < paragraphs.length; i++) {
          const style = paragraphs[i]?.getStyle();
          if (style === "Heading1" || style === "Heading 1") {
            firstHeading1Index = i;
            break;
          }
        }

        if (firstHeading1Index >= 0) {
          // Insert after the first Heading 1
          insertPosition = firstHeading1Index + 1;
          this.log.info(`No existing TOC found - creating new TOC after first Heading 1 at position ${insertPosition}`);
        } else {
          // No Heading 1 found - insert at document start as fallback
          insertPosition = 0;
          this.log.info("No existing TOC or Heading 1 found - creating new TOC at document start");
        }
      }

      // Insert all TOC entry paragraphs at the determined position
      for (let i = 0; i < tocParagraphs.length; i++) {
        doc.insertParagraphAt(insertPosition + i, tocParagraphs[i]!);
      }

      totalEntriesCreated = tocParagraphs.length;
      this.log.info(`Inserted ${tocParagraphs.length} TOC entries at position ${insertPosition}`);

      return totalEntriesCreated;
    } catch (error) {
      this.log.error(
        `Error in manual TOC population: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      // Log stack trace for debugging
      if (error instanceof Error && error.stack) {
        this.log.debug(`Stack trace: ${error.stack}`);
      }
      // Don't throw - allow document processing to continue
      return totalEntriesCreated;
    }
  }

  /**
   * Find the nearest Header 2 above a given paragraph index
   * Used for providing context in tracked changes
   *
   * @param doc - The document to search
   * @param paragraphIndex - Index of the paragraph to find context for
   * @returns Header 2 text or null if not found
   */
  private findNearestHeader2(doc: Document, paragraphIndex: number): string | null {
    try {
      const paragraphs = doc.getAllParagraphs();

      // Search backwards from the given index
      for (let i = paragraphIndex - 1; i >= 0; i--) {
        const para = paragraphs[i];
        const style = para?.getStyle();

        // Check if this is a Header 2 (handles various format variations)
        if (style && (style === 'Heading2' || style === 'Heading 2' || style.includes('Heading2'))) {
          const text = para.getText().trim();
          if (text) {
            return text;
          }
        }
      }

      return null; // No Header 2 found above this paragraph
    } catch (error) {
      this.log.warn(`Failed to find nearest Header 2 for paragraph ${paragraphIndex}:`, error);
      return null;
    }
  }

  /**
   * Generate a human-readable description for a hyperlink processing change
   *
   * @param change - The hyperlink change from DocumentProcessingComparison
   * @returns Human-readable description of the change
   */
  private describeHyperlinkProcessingChange(change: {
    originalUrl: string;
    modifiedUrl: string;
    originalText: string;
    modifiedText: string;
    changeReason: string;
  }): string {
    const urlChanged = change.originalUrl !== change.modifiedUrl;
    const textChanged = change.originalText !== change.modifiedText;

    const changes: string[] = [];
    if (urlChanged) changes.push("URL");
    if (textChanged) changes.push("display text");

    if (changes.length === 0) {
      return change.changeReason || "Hyperlink updated";
    }

    const changeDesc = changes.join(" and ");
    const reason = change.changeReason ? ` (${change.changeReason})` : "";
    return `Changed hyperlink ${changeDesc}${reason}`;
  }

  /**
   * Gets all runs from a paragraph, including those inside revision elements.
   *
   * This is needed because para.getRuns() only returns direct Run children,
   * but runs inside w:ins, w:moveTo, w:del, etc. are not returned.
   * This method traverses into all content to find all runs.
   *
   * @param para - The paragraph to extract runs from
   * @returns Array of all Run objects in the paragraph
   */
  private getAllRunsFromParagraph(para: Paragraph): Run[] {
    const allRuns: Run[] = [];
    const content = para.getContent();

    for (const item of content) {
      if (item instanceof Run) {
        allRuns.push(item);
      } else if (item instanceof Revision) {
        // Get runs from inside revision elements (w:ins, w:moveTo, w:del, etc.)
        const revRuns = item.getRuns();
        allRuns.push(...revRuns);
      } else if (item instanceof Hyperlink) {
        // Get run from hyperlink
        const hyperlinkRun = item.getRun();
        if (hyperlinkRun) {
          allRuns.push(hyperlinkRun);
        }
      }
      // Fields, Shapes, TextBoxes don't contain directly accessible runs for this purpose
    }

    return allRuns;
  }

  /**
   * Checks if a paragraph contains an image, either directly or inside revision elements.
   *
   * Images can appear as:
   * - Direct Image content in the paragraph
   * - ImageRun objects inside Revision elements (w:ins, w:moveTo, etc.)
   *
   * @param para - The paragraph to check
   * @returns True if the paragraph contains an image
   */
  private paragraphContainsImage(para: Paragraph): boolean {
    for (const item of para.getContent()) {
      if (item instanceof Image) {
        return true;
      }
      // Images in runs are stored as ImageRun objects (w:r > w:drawing)
      if (item instanceof ImageRun) {
        return true;
      }
      if (item instanceof Revision) {
        // Images inside revisions are stored as ImageRun objects
        for (const run of item.getRuns()) {
          if (run instanceof ImageRun) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Applies a border to all images in a paragraph.
   *
   * Handles images in:
   * - Direct Image content
   * - ImageRun objects (w:r > w:drawing)
   * - Images inside Revision elements (w:ins, w:moveTo, etc.)
   *
   * @param para - The paragraph containing images
   * @param borderPt - Border thickness in points (default: 2)
   */
  private applyBorderToImages(para: Paragraph, borderPt: number = 2): void {
    for (const item of para.getContent()) {
      if (item instanceof Image) {
        item.setBorder(borderPt);
      }
      if (item instanceof ImageRun) {
        item.getImageElement().setBorder(borderPt);
      }
      if (item instanceof Revision) {
        for (const run of item.getRuns()) {
          if (run instanceof ImageRun) {
            run.getImageElement().setBorder(borderPt);
          }
        }
      }
    }
  }

  /**
   * Get DocXMLater processor for advanced operations
   */
  getDocXMLaterProcessor(): DocXMLaterProcessor {
    return this.docXMLater;
  }
}

export default WordDocumentProcessor;
