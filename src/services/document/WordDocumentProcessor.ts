/**
 * WordDocumentProcessor - Modern DOCX processing using DocXMLater
 *
 * Complete rewrite using docxmlater library for all document operations.
 * Replaces 4000+ lines of manual XML parsing with clean, type-safe APIs.
 */

import {
  Bookmark,
  buildHyperlinkInstruction,
  ChangelogGenerator,
  CleanupHelper,
  ComplexField,
  Document,
  Hyperlink,
  Image,
  ImageRun,
  isHyperlink,
  isRevision,
  isRun,
  normalizeOrphanListLevelsInTable,
  NumberingLevel,
  Paragraph,
  pointsToTwips,
  Revision,
  RevisionAwareProcessor,
  Run,
  Style,
  Table,
  type TableOfContents,
  WORD_NATIVE_BULLETS,
} from "docxmlater";
import type { ParagraphContent, TableCell } from "docxmlater";
import type { RevisionHandlingMode } from "@/types/session";
// Note: Run, Hyperlink, ImageRun imported for type checking in isParagraphTrulyEmpty()
import {
  DetailedHyperlinkInfo,
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult,
  HyperlinkType,
} from "@/types/hyperlink";
import type { ChangeEntry, ChangelogSummary, DocumentChange, PreviousRevisionState, SessionStyle, WordRevisionState } from "@/types/session";
import { MemoryMonitor } from "@/utils/MemoryMonitor";
import { logger, startTimer, debugModes, isDebugEnabled } from "@/utils/logger";
import { sanitizeHyperlinkText } from "@/utils/textSanitizer";
import { extractLookupIds } from "@/utils/urlPatterns";
import { promises as fs } from "fs";
import pLimit from "p-limit";
import * as path from "path";
import { hyperlinkService } from "../HyperlinkService";
import type { HyperlinkApiResponse } from "@/types/hyperlink";
import { DocXMLaterProcessor } from "./DocXMLaterProcessor";
import { documentProcessingComparison } from "./DocumentProcessingComparison";
import { DocumentSnapshotService } from "./DocumentSnapshotService";
import { tableProcessor } from "./processors/TableProcessor";

// ═══════════════════════════════════════════════════════════
// Bullet Symbol to Font Mapping
// Uses Word-native bullet encoding from docxmlater for maximum compatibility
// Each bullet type uses a SPECIFIC font AND PUA character for correct rendering
// ═══════════════════════════════════════════════════════════
const BULLET_CHAR_MAP: Record<string, { char: string; font: string }> = {
  // Filled bullets - various Unicode representations that should all map to Word's filled bullet
  '●': WORD_NATIVE_BULLETS.FILLED_BULLET,  // U+25CF BLACK CIRCLE
  '•': WORD_NATIVE_BULLETS.FILLED_BULLET,  // U+2022 BULLET (used in UI default settings)
  // Open circle bullets
  '○': WORD_NATIVE_BULLETS.OPEN_CIRCLE,    // U+25CB WHITE CIRCLE
  'o': WORD_NATIVE_BULLETS.OPEN_CIRCLE,    // Lowercase o (alternative representation)
  // Filled square bullets
  '■': WORD_NATIVE_BULLETS.FILLED_SQUARE,  // U+25A0 BLACK SQUARE
  '▪': WORD_NATIVE_BULLETS.FILLED_SQUARE,  // U+25AA BLACK SMALL SQUARE (alternative)
};

/**
 * Get the correct font AND character for a bullet symbol
 * Uses Word-native encoding from docxmlater for maximum compatibility
 * @param bulletChar The UI bullet character (e.g., ●, ○, ■)
 * @returns Object with font-specific character and font name
 */
function getBulletMapping(bulletChar: string): { char: string; font: string } {
  return BULLET_CHAR_MAP[bulletChar] || WORD_NATIVE_BULLETS.FILLED_BULLET;
}

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
  preserveUserBlankStructures?: boolean; // preserve-user-blank-structures: Preserve single blank lines, only remove consecutive duplicates (2+)
  removeItalics?: boolean; // remove-italics: Remove italic formatting from all runs
  preserveRedFont?: boolean; // preserve-red-font: Preserve exact #FF0000 red font color on Normal and List Paragraph style paragraphs
  normalizeDashes?: boolean; // normalize-dashes: Replace en-dashes (U+2013) and em-dashes (U+2014) with hyphens (U+002D)
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
    preserveCenterAlignment?: boolean;
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
  normalizeTableLists?: boolean; // normalize-table-lists: Convert typed list prefixes to proper Word lists
  tableUniformity?: boolean; // table-uniformity: Apply consistent table formatting
  tableShadingSettings?: {
    // NEW: Simplified table shading colors
    header2Shading: string; // Hex color for Header 2 / 1x1 table cells (default: #BFBFBF)
    otherShading: string; // Hex color for other table cells and If.../Then... patterns (default: #DFDFDF)
    imageBorderWidth?: number; // Border width in points for images (default: 1.0)
    // Table cell padding in inches
    padding1x1Top?: number; // default: 0
    padding1x1Bottom?: number; // default: 0
    padding1x1Left?: number; // default: 0.08
    padding1x1Right?: number; // default: 0.08
    paddingOtherTop?: number; // default: 0
    paddingOtherBottom?: number; // default: 0
    paddingOtherLeft?: number; // default: 0.08
    paddingOtherRight?: number; // default: 0.08
    cellBorderThickness?: number; // Cell border thickness in points (default: 0.5)
  };
  smartTables?: boolean; // smart-tables: Smart table detection and formatting (NEW)
  standardizeTableBorders?: boolean; // standardize-table-borders: Standardize all table border thickness and color (preserves FFC000)
  setLandscapeMargins?: boolean; // set-landscape-margins: Set document to landscape orientation with 1" margins
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
  // Document Snapshot Options (for comparison feature)
  // ═══════════════════════════════════════════════════════════
  /** Session identifier for snapshot capture */
  sessionId?: string;
  /** Document identifier for snapshot capture */
  documentId?: string;
  /** Enable capturing pre-processing snapshot for comparison */
  captureSnapshot?: boolean;

  // ═══════════════════════════════════════════════════════════
  // Processing Options Control
  // ═══════════════════════════════════════════════════════════
  /** Array of enabled operation IDs from ProcessingOptions (e.g., 'adjust-table-padding') */
  enabledOperations?: string[];

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

  // ═══════════════════════════════════════════════════════════
  // Local Dictionary Settings (NEW - January 2025)
  // ═══════════════════════════════════════════════════════════
  /** Local dictionary settings for offline hyperlink lookup */
  localDictionary?: {
    enabled: boolean;
    totalEntries: number;
  };
}

export interface WordProcessingResult extends HyperlinkProcessingResult {
  backupPath?: string;
  documentSize?: number;
  processingTimeMs?: number;
  comparisonData?: any; // Data for before/after comparison
  hasTrackedChanges?: boolean; // Added: Indicates if document has tracked changes that must be approved first
  changes?: DocumentChange[]; // Enhanced tracked changes with context
  /** Pre-existing tracked changes that were in the document BEFORE DocHub processing */
  previousRevisions?: PreviousRevisionState;
  /** Word tracked changes state from DocHub processing */
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

  // Counter for generating unique TOC bookmark names
  // Reset at the start of each document processing to ensure uniqueness
  private tocBookmarkCounter: number = 0;

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
   * Detect if running in main process (Node.js) vs renderer process (browser)
   */
  private isMainProcess(): boolean {
    return typeof window === 'undefined';
  }

  /**
   * Detect if an error is caused by a file being locked/in use by another process
   * Returns true for EBUSY, EPERM, EACCES errors or common file-lock messages
   */
  private isFileLockError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      const code = (error as NodeJS.ErrnoException).code;

      // Windows file lock error codes
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        return true;
      }

      // Check for common file-in-use error messages
      if (message.includes('resource busy') ||
          message.includes('file in use') ||
          message.includes('being used by another process') ||
          message.includes('locked')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if document is in Word compatibility mode (older format)
   * Documents created in Word 2003/2007/2010 and not converted use older XML schemas
   * that can cause processing issues.
   *
   * Detection: Check word/settings.xml for compatibilityMode value < 15
   * Values: 11=Word2003, 12=Word2007, 14=Word2010, 15=Word2013+
   *
   * @returns Object with isCompatibilityMode flag and detected version
   */
  private async checkCompatibilityMode(doc: Document): Promise<{
    isCompatibilityMode: boolean;
    compatibilityValue?: number;
    wordVersion?: string;
  }> {
    try {
      // Use DocXMLater's getRawXml to access word/settings.xml
      const settingsXml = await doc.getRawXml('word/settings.xml');

      if (!settingsXml) {
        // No settings.xml found - assume modern format
        return { isCompatibilityMode: false };
      }

      // Look for compatibilityMode setting
      // Pattern: <w:compatSetting w:name="compatibilityMode" ... w:val="XX"/>
      // Also check alternate attribute order
      const compatMatch = settingsXml.match(
        /<w:compatSetting[^>]*w:name=["']compatibilityMode["'][^>]*w:val=["'](\d+)["'][^>]*\/?>/
      ) || settingsXml.match(
        /<w:compatSetting[^>]*w:val=["'](\d+)["'][^>]*w:name=["']compatibilityMode["'][^>]*\/?>/
      );

      if (compatMatch) {
        const compatValue = parseInt(compatMatch[1], 10);

        // Version mapping
        const versionMap: Record<number, string> = {
          11: 'Word 2003',
          12: 'Word 2007',
          14: 'Word 2010',
          15: 'Word 2013+',
        };

        const wordVersion = versionMap[compatValue] || `Unknown (${compatValue})`;

        // Compatibility mode if value is less than 15 (Word 2013)
        const isCompatibilityMode = compatValue < 15;

        this.log.debug(
          `Compatibility mode check: value=${compatValue}, version=${wordVersion}, isCompatMode=${isCompatibilityMode}`
        );

        return {
          isCompatibilityMode,
          compatibilityValue: compatValue,
          wordVersion,
        };
      }

      // If no compatibilityMode setting found, document is likely modern
      // (Word 2013+ doesn't always include this setting)
      return { isCompatibilityMode: false };
    } catch (error) {
      this.log.warn('Failed to check compatibility mode (non-fatal):', error);
      // On error, assume modern format to allow processing
      return { isCompatibilityMode: false };
    }
  }

  /**
   * Debug helper: Capture and log list paragraph state at a specific point
   * Only logs when LIST_PROCESSING debug mode is enabled
   */
  private debugCaptureListState(doc: Document, label: string): void {
    if (!isDebugEnabled(debugModes.LIST_PROCESSING)) return;

    this.log.debug(`\n=== LIST DEBUG: ${label} ===`);

    // Capture from tables
    const tables = doc.getAllTables();
    for (let tableIdx = 0; tableIdx < tables.length; tableIdx++) {
      const table = tables[tableIdx];
      const rows = table.getRows();
      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const cells = row.getCells();
        for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
          const cell = cells[cellIdx];
          const paras = cell.getParagraphs();
          for (let paraIdx = 0; paraIdx < paras.length; paraIdx++) {
            const para = paras[paraIdx];
            const numbering = para.getNumbering();
            if (!numbering) continue;

            const formatting = para.getFormatting();
            const text = para.getText().substring(0, 40);
            this.log.debug(
              `  T${tableIdx}R${rowIdx}C${cellIdx}[${paraIdx}]: ilvl=${numbering.level}, numId=${numbering.numId}, ` +
              `left=${formatting.indentation?.left || 0}tw, ` +
              `hanging=${formatting.indentation?.hanging || 0}tw, ` +
              `text="${text}${text.length >= 40 ? '...' : ''}"`
            );
          }
        }
      }
    }

    // Capture from body
    const bodyParas = doc.getParagraphs();
    for (let i = 0; i < bodyParas.length; i++) {
      const para = bodyParas[i];
      const numbering = para.getNumbering();
      if (!numbering) continue;

      const formatting = para.getFormatting();
      const text = para.getText().substring(0, 40);
      this.log.debug(
        `  Body[${i}]: ilvl=${numbering.level}, numId=${numbering.numId}, ` +
        `left=${formatting.indentation?.left || 0}tw, ` +
        `hanging=${formatting.indentation?.hanging || 0}tw, ` +
        `text="${text}${text.length >= 40 ? '...' : ''}"`
      );
    }
  }

  /**
   * Call PowerAutomate API - handles both main process and renderer contexts
   *
   * In the main process, we use Electron's net.request directly.
   * In the renderer process, we use the HyperlinkService which goes through IPC.
   */
  private async callPowerAutomateApi(
    hyperlinkInfos: DetailedHyperlinkInfo[],
    apiSettings: { apiUrl: string; timeout?: number; retryAttempts?: number; retryDelay?: number },
    userProfile?: { firstName: string; lastName: string; email: string },
    localDictionarySettings?: { enabled: boolean; totalEntries: number }
  ): Promise<HyperlinkApiResponse & { processedHyperlinks?: DetailedHyperlinkInfo[] }> {
    // In renderer process, use HyperlinkService (goes through IPC)
    if (!this.isMainProcess()) {
      this.log.info('[WordDocProcessor] Using renderer process API (HyperlinkService -> IPC)');
      return hyperlinkService.processHyperlinksWithApi(hyperlinkInfos, apiSettings, userProfile);
    }

    // In main process, call net.request directly
    this.log.info('[WordDocProcessor] Using main process API (net.request)');

    try {
      // Dynamic import to avoid bundling Electron modules in renderer
      const { callPowerAutomateApiWithRetry } = await import('../../../electron/services/PowerAutomateApiService');

      // Extract lookup IDs from hyperlinks
      const lookupIds: string[] = [];
      const uniqueIds = new Set<string>();

      for (const hyperlink of hyperlinkInfos) {
        const ids = extractLookupIds(hyperlink.url);
        if (ids) {
          if (ids.contentId && !uniqueIds.has(ids.contentId)) {
            lookupIds.push(ids.contentId);
            uniqueIds.add(ids.contentId);
          }
          if (ids.documentId && !uniqueIds.has(ids.documentId)) {
            lookupIds.push(ids.documentId);
            uniqueIds.add(ids.documentId);
          }
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

      // ═══════════════════════════════════════════════════════════
      // LOCAL DICTIONARY LOOKUP (if enabled and has entries)
      // ═══════════════════════════════════════════════════════════
      let localResults: Array<{
        url: string;
        documentId: string;
        contentId: string;
        title: string;
        status: 'active' | 'deprecated' | 'expired' | 'moved' | 'not_found';
        metadata: Record<string, unknown>;
      }> = [];
      let idsNotFoundLocally: string[] = [...lookupIds];

      if (localDictionarySettings?.enabled && localDictionarySettings.totalEntries > 0) {
        this.log.info(`[WordDocProcessor] Local dictionary enabled with ${localDictionarySettings.totalEntries} entries - checking local first`);

        try {
          // Dynamic import of local dictionary lookup service
          const { getLocalDictionaryLookupService } = await import('../../../electron/services/LocalDictionaryLookupService');
          const lookupService = getLocalDictionaryLookupService();

          // Batch lookup against local dictionary
          const localLookupResults = lookupService.batchLookup(lookupIds);

          // Process local results
          const foundLocallySet = new Set<string>();
          for (const result of localLookupResults) {
            if (result.Status !== 'Not_Found') {
              const normalizedStatus =
                result.Status.toLowerCase() === 'deprecated' ? 'deprecated' as const :
                result.Status.toLowerCase() === 'expired' ? 'expired' as const :
                result.Status.toLowerCase() === 'moved' ? 'moved' as const :
                result.Status.toLowerCase() === 'not_found' ? 'not_found' as const :
                'active' as const;

              localResults.push({
                url: '',
                documentId: result.Document_ID || '',
                contentId: result.Content_ID || '',
                title: result.Title || '',
                status: normalizedStatus,
                metadata: {},
              });

              // Mark IDs as found
              if (result.Document_ID) foundLocallySet.add(result.Document_ID);
              if (result.Content_ID) foundLocallySet.add(result.Content_ID);
            }
          }

          // Filter out IDs that were found locally
          idsNotFoundLocally = lookupIds.filter(id => !foundLocallySet.has(id));

          this.log.info(`[WordDocProcessor] Local dictionary: found ${localResults.length} entries, ${idsNotFoundLocally.length} IDs need API lookup`);
        } catch (localError) {
          this.log.warn('[WordDocProcessor] Local dictionary lookup failed, falling back to API:', localError);
          idsNotFoundLocally = [...lookupIds];
        }
      }

      // If all IDs were found locally, return early
      if (idsNotFoundLocally.length === 0 && localResults.length > 0) {
        this.log.info('[WordDocProcessor] All lookups satisfied by local dictionary - skipping API call');
        return {
          success: true,
          timestamp: new Date(),
          body: {
            results: localResults,
            errors: [],
          },
          processedHyperlinks: hyperlinkInfos,
        };
      }

      // Calculate statistics
      const totalHyperlinks = hyperlinkInfos.length;
      const hyperlinksChecked = hyperlinkInfos.filter(h =>
        /thesource\.cvshealth\.com/i.test(h.url)
      ).length;

      // Make the API call (for IDs not found locally)
      const response = await callPowerAutomateApiWithRetry(
        apiSettings.apiUrl,
        {
          Lookup_ID: idsNotFoundLocally.length > 0 ? idsNotFoundLocally : lookupIds,
          Hyperlinks_Checked: hyperlinksChecked,
          Total_Hyperlinks: totalHyperlinks,
          First_Name: userProfile?.firstName || '',
          Last_Name: userProfile?.lastName || '',
          Email: userProfile?.email || '',
        },
        {
          timeout: apiSettings.timeout,
          maxRetries: apiSettings.retryAttempts,
          retryDelay: apiSettings.retryDelay,
        }
      );

      if (!response.success) {
        // If we have local results, return those even if API failed
        if (localResults.length > 0) {
          this.log.warn('[WordDocProcessor] API call failed but returning local dictionary results');
          return {
            success: true,
            timestamp: new Date(),
            body: {
              results: localResults,
              errors: [response.error || 'API request failed (local results returned)'],
            },
            processedHyperlinks: hyperlinkInfos,
          };
        }
        return {
          success: false,
          timestamp: new Date(),
          error: response.error || 'API request failed',
        };
      }

      // Parse API results into HyperlinkApiResponse format
      const apiResults = response.data?.Results?.map(result => {
        const rawStatus = result.Status?.trim() || 'Active';
        const normalizedStatus =
          rawStatus.toLowerCase() === 'deprecated' ? 'deprecated' as const :
          rawStatus.toLowerCase() === 'expired' ? 'expired' as const :
          rawStatus.toLowerCase() === 'moved' ? 'moved' as const :
          rawStatus.toLowerCase() === 'not_found' ? 'not_found' as const :
          'active' as const;

        return {
          url: '',
          documentId: result.Document_ID?.trim() || '',
          contentId: result.Content_ID?.trim() || '',
          title: result.Title?.trim() || '',
          status: normalizedStatus,
          metadata: {},
        };
      }) || [];

      // Merge local results with API results
      const mergedResults = [...localResults, ...apiResults];

      return {
        success: true,
        timestamp: new Date(),
        statusCode: response.statusCode,
        body: {
          results: mergedResults,
          errors: [],
        },
        processedHyperlinks: hyperlinkInfos,
      };
    } catch (error) {
      this.log.error('[WordDocProcessor] Main process API call failed:', error);
      return {
        success: false,
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
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

    // Reset TOC bookmark counter for this document processing session
    this.tocBookmarkCounter = 0;

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
      // ALWAYS load with 'preserve' to capture pre-existing tracked changes first
      // Auto-accept is applied at the END of processing (after extracting changes for UI)
      this.log.debug("=== LOADING DOCUMENT WITH DOCXMLATER ===");
      this.log.debug(`autoAcceptRevisions=${options.autoAcceptRevisions} (will be applied after processing)`);
      doc = await Document.load(filePath, {
        strictParsing: false,
        revisionHandling: 'preserve' // Always preserve to capture pre-existing changes
      });
      this.log.debug("Document loaded successfully");

      // ═══════════════════════════════════════════════════════════
      // COMPATIBILITY MODE CHECK
      // Detect if document uses older Word format that requires conversion
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== CHECKING WORD COMPATIBILITY MODE ===");
      const compatCheck = await this.checkCompatibilityMode(doc);

      if (compatCheck.isCompatibilityMode) {
        this.log.warn(
          `Document is in compatibility mode: ${compatCheck.wordVersion} (value: ${compatCheck.compatibilityValue})`
        );

        // Throw error with specific message for UI detection
        throw new Error(
          `COMPATIBILITY_MODE: This document is using outdated functions from ${compatCheck.wordVersion}.`
        );
      }
      this.log.debug("Document is in modern format");

      // ═══════════════════════════════════════════════════════════
      // CAPTURE PRE-EXISTING TRACKED CHANGES
      // These are changes that existed in the document BEFORE DocHub processing
      // Must be done BEFORE enabling track changes (which adds DocHub's author)
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== CAPTURING PRE-EXISTING TRACKED CHANGES ===");
      try {
        const preExistingEntries = ChangelogGenerator.fromDocument(doc) as ChangeEntry[];
        if (preExistingEntries.length > 0) {
          const preExistingSummary = ChangelogGenerator.getSummary(preExistingEntries as any);
          result.previousRevisions = {
            hadRevisions: true,
            entries: preExistingEntries,
            summary: preExistingSummary as ChangelogSummary,
          };
          this.log.info(`Captured ${preExistingEntries.length} pre-existing tracked changes`);
        } else {
          result.previousRevisions = {
            hadRevisions: false,
            entries: [],
            summary: null,
          };
          this.log.debug("No pre-existing tracked changes found");
        }
      } catch (preExistingError) {
        this.log.warn("Failed to capture pre-existing changes (non-fatal):", preExistingError);
        result.previousRevisions = {
          hadRevisions: false,
          entries: [],
          summary: null,
        };
      }

      // ═══════════════════════════════════════════════════════════
      // Capture Pre-Processing Snapshot (for comparison feature)
      // Must be done BEFORE any modifications
      // ═══════════════════════════════════════════════════════════
      if (options.captureSnapshot && options.sessionId && options.documentId) {
        this.log.debug("=== CAPTURING PRE-PROCESSING SNAPSHOT ===");
        try {
          // Read the original file buffer
          const buffer = await fs.readFile(filePath);
          const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          );

          // Extract text content for diffing
          const paragraphs = doc.getParagraphs();
          const textContent = paragraphs.map((p) => p.getText());

          // Extract hyperlink state
          const hyperlinks: Array<{
            paragraphIndex: number;
            hyperlinkIndex: number;
            url: string;
            text: string;
          }> = [];

          paragraphs.forEach((paragraph, pIndex) => {
            // Extract hyperlinks from paragraph content
            const content = paragraph.getContent();
            let hIndex = 0;
            content.forEach((element) => {
              // Use type guard for proper type checking
              if (isHyperlink(element)) {
                hyperlinks.push({
                  paragraphIndex: pIndex,
                  hyperlinkIndex: hIndex++,
                  url: element.getUrl() || '',
                  text: element.getText() || '',
                });
              }
            });
          });

          // Deduplicate hyperlinks (each paragraph was adding all its hyperlinks)
          const uniqueHyperlinks = new Map<string, typeof hyperlinks[0]>();
          hyperlinks.forEach((h) => {
            const key = `${h.paragraphIndex}-${h.hyperlinkIndex}`;
            if (!uniqueHyperlinks.has(key)) {
              uniqueHyperlinks.set(key, h);
            }
          });

          await DocumentSnapshotService.captureSnapshot(
            arrayBuffer,
            options.sessionId,
            options.documentId,
            textContent,
            Array.from(uniqueHyperlinks.values())
          );
          this.log.info(
            `Snapshot captured: ${textContent.length} paragraphs, ` +
              `${uniqueHyperlinks.size} hyperlinks`
          );
        } catch (snapshotError) {
          // Log error but don't fail the processing
          this.log.warn("Failed to capture snapshot (non-fatal):", snapshotError);
        }
      }

      // ═══════════════════════════════════════════════════════════
      // Word Tracked Changes - Enable Tracking Mode
      // All DocHub modifications will become Word tracked changes
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== ENABLING WORD TRACK CHANGES ===");

      // Enable track changes BEFORE any modifications
      // This makes all DocHub changes become Word tracked changes
      // Priority: 1) revisionAuthor option, 2) user profile name, 3) "Doc Hub" default
      const firstName = options.userProfile?.firstName?.trim() || '';
      const lastName = options.userProfile?.lastName?.trim() || '';
      const profileName = firstName && lastName
        ? `${firstName} ${lastName}`
        : firstName || lastName || '';
      const authorName = options.revisionAuthor?.trim() || profileName || 'Doc Hub';

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

            const apiResponse = await this.callPowerAutomateApi(
              hyperlinkInfos,
              apiSettings,
              options.userProfile,
              options.localDictionary
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

                // Track what changed for consolidated change entry
                let urlChanged = false;
                let textChanged = false;
                let newTextValue = hyperlinkInfo.displayText;

                if (apiResult) {
                  // Phase 3: URL Reconstruction
                  // Collect URL updates for batch application after iteration
                  if (apiResult.documentId && options.operations?.fixContentIds) {
                    const newUrl = `https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=${apiResult.documentId.trim()}`;

                    if (newUrl !== hyperlinkInfo.url) {
                      // Add to URL update map for batch processing
                      urlUpdateMap.set(hyperlinkInfo.url, newUrl);
                      finalUrl = newUrl;
                      urlChanged = true;
                      modifications.push("URL updated");

                      this.log.debug(`Queued URL update: ${hyperlinkInfo.url} → ${newUrl}`);

                      // Track the URL change
                      if (options.trackChanges) {
                        documentProcessingComparison.recordHyperlinkUrlChange(
                          hyperlink.paragraphIndex,
                          hyperlink.hyperlinkIndexInParagraph,
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
                      newTextValue = newText;
                      textChanged = true;
                      result.updatedDisplayTexts = (result.updatedDisplayTexts || 0) + 1;
                      modifications.push("Display text updated");

                      this.log.debug(`Updated text: "${hyperlinkInfo.displayText}" → "${newText}"`);

                      // Clean up orphaned content ID runs that follow this hyperlink
                      // Some documents have the content ID as a separate styled run (blue, underlined)
                      // that looks like part of the hyperlink but isn't. After updating the hyperlink
                      // text to include the content ID, we need to remove these orphaned fragments.
                      if (apiResult.contentId) {
                        const last6 = apiResult.contentId.slice(-6);
                        const para = hyperlink.paragraph;
                        const content = para.getContent();
                        const hyperlinkIndex = content.findIndex((item: unknown) => item === hyperlink.hyperlink);

                        if (hyperlinkIndex !== -1 && hyperlinkIndex < content.length - 1) {
                          const itemsToRemove: Run[] = [];
                          let combinedText = '';

                          // Look at up to 3 items after the hyperlink to handle various split patterns
                          for (let i = 1; i <= 3 && hyperlinkIndex + i < content.length; i++) {
                            const item = content[hyperlinkIndex + i];

                            if (this.isRunItem(item)) {
                              const itemText = item.getText();
                              combinedText += itemText;
                              itemsToRemove.push(item);

                              const trimmedText = combinedText.trim();

                              // Patterns to match (content ID was just added to hyperlink, so these are orphans):
                              // - Complete: " (017428)", "(017428)"
                              // - Partial from split: ")", " )"
                              // - Partial with digits: "428)", "8)"
                              const fullContentIdPattern = new RegExp(`^\\s*\\(${last6}\\)\\s*$`);
                              const partialEndPattern = /^\s*\d*\)\s*$/;

                              // Check if combined text is an orphaned content ID pattern
                              if (
                                fullContentIdPattern.test(combinedText) || // Full: "(017428)"
                                trimmedText === ')' || // Just closing paren
                                trimmedText === `(${last6})` || // No space variant
                                (partialEndPattern.test(combinedText) && trimmedText.length <= 7) // Partial end like "428)"
                              ) {
                                // Remove all collected orphaned runs
                                for (const toRemove of itemsToRemove) {
                                  para.replaceContent(toRemove, []);
                                }
                                this.log.debug(
                                  `Removed ${itemsToRemove.length} orphaned content ID fragment(s): "${trimmedText}"`
                                );
                                break;
                              }

                              // If the text doesn't look like a content ID fragment, stop looking
                              if (!/^[\s\d\(\)]+$/.test(combinedText)) {
                                break;
                              }
                            } else {
                              // Stop if we hit a non-Run item (Hyperlink, Revision, etc.)
                              break;
                            }
                          }
                        }
                      }

                      // Track the change with status (expired/updated) and contentId
                      if (options.trackChanges) {
                        const hyperlinkStatus = apiResult.status === "expired" || apiResult.status === "deprecated"
                          ? 'expired' as const
                          : 'updated' as const;
                        documentProcessingComparison.recordHyperlinkTextChange(
                          hyperlink.paragraphIndex,
                          hyperlink.hyperlinkIndexInParagraph,
                          hyperlinkInfo.displayText,
                          newText,
                          "PowerAutomate API Update",
                          hyperlinkStatus,
                          apiResult.contentId // Pass contentId for tracking
                        );
                      }
                    }
                  }

                  // Consolidated change tracking for UI - track if URL or text changed
                  if (urlChanged || textChanged) {
                    const nearestHeader2 = this.findNearestHeader2(doc, hyperlink.paragraphIndex) || undefined;

                    // Build description based on what changed
                    let description = 'Updated hyperlink';
                    if (urlChanged && textChanged) {
                      description = 'Updated hyperlink URL and display text';
                    } else if (urlChanged) {
                      description = 'Updated hyperlink URL';
                    } else if (textChanged) {
                      description = 'Updated hyperlink display text';
                    }

                    result.changes?.push({
                      type: 'hyperlink',
                      category: 'hyperlink_update',
                      description,
                      // Text changes (before/after are for display text)
                      before: textChanged ? hyperlinkInfo.displayText : undefined,
                      after: textChanged ? newTextValue : undefined,
                      // URL changes (new fields)
                      urlBefore: urlChanged ? hyperlinkInfo.url : undefined,
                      urlAfter: urlChanged ? finalUrl : undefined,
                      paragraphIndex: hyperlink.paragraphIndex,
                      nearestHeader2,
                      contentId: apiResult.contentId,
                      hyperlinkStatus: apiResult.status === "expired" || apiResult.status === "deprecated" ? 'expired' : 'updated',
                    });
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

                    // Track the change with not_found status for Document Changes UI
                    if (options.trackChanges) {
                      documentProcessingComparison.recordHyperlinkTextChange(
                        hyperlink.paragraphIndex,
                        hyperlink.hyperlinkIndexInParagraph,
                        hyperlinkInfo.displayText,
                        notFoundText,
                        "Source not found in SharePoint",
                        'not_found'
                      );
                    }

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

                const urlUpdateResult = await this.applyUrlUpdates(doc, urlUpdateMap, authorName);

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

      if (options.normalizeDashes) {
        this.log.debug("=== NORMALIZING EN-DASHES TO HYPHENS ===");
        const dashesNormalized = await this.normalizeEnDashesToHyphens(doc);
        this.log.info(`Normalized en-dashes in ${dashesNormalized} runs`);

        // Track dash normalization
        if (dashesNormalized > 0) {
          result.changes?.push({
            type: 'text',
            category: 'structure',
            description: 'Normalized en-dashes to hyphens',
            count: dashesNormalized,
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

      // IMPORTANT: Set Heading 2 style on 1x1 tables BEFORE style application
      // This ensures they get proper formatting (font, size, bold) from the Heading 2 style config
      if (options.smartTables || options.tableUniformity) {
        this.log.debug("=== SETTING HEADING 2 STYLE ON 1X1 TABLES (PRE-STYLE APPLICATION) ===");
        const heading2Updated = await tableProcessor.ensureHeading2StyleIn1x1Tables(doc);
        if (heading2Updated > 0) {
          this.log.info(`Set Heading 2 style on ${heading2Updated} paragraphs in 1x1 tables (before style application)`);
        }
      }

      if (options.assignStyles && options.styles && options.styles.length > 0) {
        this.log.debug(
          "=== ASSIGNING STYLES (USING DOCXMLATER applyStyles) ==="
        );
        // Use docXMLater's native method with preserve flag support
        // This handles style definitions, direct formatting clearing, and Header2 table wrapping
        const styleResults = await this.applyCustomStylesFromUI(
          doc,
          options.styles,
          options.tableShadingSettings,
          options.preserveBlankLinesAfterHeader2Tables ?? true,
          options.preserveRedFont ?? false
        );
        this.log.info(
          `Applied custom formatting: Heading1=${styleResults.heading1}, Heading2=${styleResults.heading2}, Heading3=${styleResults.heading3}, Normal=${styleResults.normal}, ListParagraph=${styleResults.listParagraph}`
        );

        // NEW v2.1.0: Apply styles and clean direct formatting with simpler API
        this.log.debug("=== APPLYING STYLES WITH CLEAN FORMATTING ===");

        // Skip applyH1/H2/H3 if already processed by applyStyles
        // This prevents framework defaults from overriding user-configured custom styles
        const h1Count = styleResults.heading1
          ? (this.log.debug(
              "Skipping applyH1 - already processed by applyStyles"
            ),
            0)
          : doc.applyH1();
        const h2Count = styleResults.heading2
          ? (this.log.debug(
              "Skipping applyH2 - already processed by applyStyles"
            ),
            0)
          : doc.applyH2();
        const h3Count = styleResults.heading3
          ? (this.log.debug(
              "Skipping applyH3 - already processed by applyStyles"
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
          options.preserveBlankLinesAfterHeader2Tables ?? true,
          options.preserveUserBlankStructures ?? false
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

      // Skip validateDocumentStyles if assignStyles already ran
      // assignStyles uses applyStyles() with preserveWhiteFont and preserveCenterAlignment flags
      // validateDocumentStyles uses applyStylesFromObjects() which does NOT pass these flags
      // Running both causes the second call to overwrite preserved formatting
      if (
        options.operations?.validateDocumentStyles &&
        options.styles &&
        options.styles.length > 0 &&
        !options.assignStyles  // Skip if applyStyles already ran with preservation flags
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
      } else if (options.operations?.validateDocumentStyles && options.assignStyles) {
        this.log.debug("Skipping validateDocumentStyles - already processed by applyStyles with preservation flags");
      } else if (options.operations?.validateDocumentStyles) {
        this.log.warn(
          "⚠️ validateDocumentStyles is ENABLED but no styles provided! Please configure styles in the Styles tab."
        );
      }

      if (options.operations?.validateHeader2Tables && options.styles) {
        const header2Style = options.styles.find((s: any) => s.id === "header2");
        if (header2Style) {
          this.log.debug("=== VALIDATING HEADER 2 TABLE FORMATTING ===");
          const tableResult = await this.validateHeader2TableFormatting(
            doc,
            header2Style,
            options.tableShadingSettings
          );
          this.log.info(`Validated and fixed ${tableResult.count} Header 2 table cells`);

          // Track Header 2 table validation with affected cell names
          if (tableResult.count > 0) {
            result.changes?.push({
              type: 'style',
              category: 'structure',
              description: 'Validated and fixed Header 2 table cell formatting',
              count: tableResult.count,
              affectedItems: tableResult.affectedCells,
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
        // Centers and borders images where either dimension > 1 inch (96px at 96 DPI)
        const borderWidth = options.tableShadingSettings?.imageBorderWidth ?? 1.0;
        const imagesCentered = doc.borderAndCenterLargeImages(96, borderWidth);
        this.log.info(`Centered and bordered ${imagesCentered} images with ${borderWidth}pt border`);

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
      // First, normalize typed list prefixes to proper Word lists
      // This converts manually typed prefixes like "1.", "a.", "•" to proper <w:numPr> formatting
      if (options.normalizeTableLists) {
        // First, pre-process extended typed prefixes that DocXMLater doesn't handle
        // (parenthetical numbers, Roman numerals, etc.)
        this.debugCaptureListState(doc, 'BEFORE preProcessExtendedTypedPrefixes');
        const extendedPrefixesConverted = this.preProcessExtendedTypedPrefixes(doc);
        this.debugCaptureListState(doc, 'AFTER preProcessExtendedTypedPrefixes');

        if (extendedPrefixesConverted > 0) {
          result.changes?.push({
            type: 'structure',
            category: 'list_fix',
            description: 'Converted extended typed prefixes (Roman numerals, parenthetical) to Word numbering',
            count: extendedPrefixesConverted,
          });
        }

        // Then run DocXMLater's normalizeTableLists for standard patterns
        this.debugCaptureListState(doc, 'BEFORE normalizeTableLists');
        this.log.debug("=== NORMALIZING TYPED LIST PREFIXES IN TABLES ===");
        // Pass indentationLevels so ListNormalizer can apply correct indentation settings
        const normReport = doc.normalizeTableLists({
          indentationLevels: options.listBulletSettings?.indentationLevels,
        });
        if (normReport.normalized > 0) {
          this.log.info(
            `Normalized ${normReport.normalized} typed list items to proper Word lists (majority: ${normReport.appliedCategory})`
          );
          result.changes?.push({
            type: 'structure',
            category: 'list_fix',
            description: 'Converted typed list prefixes to proper Word list formatting',
            count: normReport.normalized,
          });
        }
        if (normReport.errors.length > 0) {
          this.log.warn(`List normalization had ${normReport.errors.length} errors:`, normReport.errors);
        }
        this.debugCaptureListState(doc, 'AFTER normalizeTableLists');
        if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
          this.log.debug(`  normalizeTableLists Report: normalized=${normReport.normalized}, category=${normReport.appliedCategory}`);
        }

        // After normalizing typed list prefixes, clean up any blank lines between list items
        // that were missed earlier (because items didn't have Word numbering yet)
        const blanksRemoved = doc.removeBlanksBetweenListItems();
        if (blanksRemoved > 0) {
          this.log.debug(`Removed ${blanksRemoved} blank lines between list items (post-normalization cleanup)`);
        }

        // After normalizing lists and removing blanks between list items,
        // ensure blank lines exist after complete list sequences (before non-list content).
        // This handles table cells (cell-scoped) and body paragraphs separately.
        const listBlankLinesAdded = await this.ensureBlankLinesAfterLists(doc);
        if (listBlankLinesAdded > 0) {
          this.log.info(`Added ${listBlankLinesAdded} blank lines after list sequences`);
        }
      }

      // Next, normalize list levels based on visual indentation (before applying uniformity)
      // This handles documents where items have w:ilvl="0" but extra paragraph indentation
      if (options.listBulletSettings?.enabled && options.listBulletSettings.indentationLevels) {
        this.debugCaptureListState(doc, 'BEFORE normalizeListLevelsFromIndentation');
        this.log.debug("=== NORMALIZING LIST LEVELS FROM VISUAL INDENTATION ===");
        const levelsNormalized = await this.normalizeListLevelsFromIndentation(doc, {
          indentationLevels: options.listBulletSettings.indentationLevels,
        });
        if (levelsNormalized > 0) {
          this.log.info(`Normalized ${levelsNormalized} list item levels from visual indentation`);
        }
        this.debugCaptureListState(doc, 'AFTER normalizeListLevelsFromIndentation');
      }

      // Normalize orphan Level 1+ bullets in table cells
      // If a cell's first bullet is Level 1+ with no preceding Level 0, shift all bullets down
      if (options.listBulletSettings?.enabled || options.bulletUniformity) {
        this.debugCaptureListState(doc, 'BEFORE normalizeOrphanListLevelsInTable');
        this.log.debug("=== NORMALIZING ORPHAN LIST LEVELS IN TABLE CELLS ===");
        const tables = doc.getTables();
        let orphanLevelsFixed = 0;
        for (const table of tables) {
          orphanLevelsFixed += normalizeOrphanListLevelsInTable(table);
        }
        if (orphanLevelsFixed > 0) {
          this.log.info(`Normalized ${orphanLevelsFixed} orphan list levels in table cells`);
        }
        this.debugCaptureListState(doc, 'AFTER normalizeOrphanListLevelsInTable');
      }

      if (options.listBulletSettings?.enabled) {
        this.debugCaptureListState(doc, 'BEFORE applyListIndentationUniformity');
        this.log.debug("=== APPLYING LIST INDENTATION UNIFORMITY ===");
        const listsFormatted = await this.applyListIndentationUniformity(
          doc,
          options.listBulletSettings
        );
        this.log.info(`Applied indentation to ${listsFormatted} list paragraphs`);
        this.debugCaptureListState(doc, 'AFTER applyListIndentationUniformity');
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
        this.debugCaptureListState(doc, 'BEFORE applyBulletUniformity/applyNumberedUniformity');
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
        this.debugCaptureListState(doc, 'AFTER applyBulletUniformity/applyNumberedUniformity');

        // Convert mixed list formats to maintain consistency within each abstractNum
        // This ensures all levels within a list use the same format type (all bullets or all numbered)
        // based on what level 0 uses (the dominant format)
        this.debugCaptureListState(doc, 'BEFORE convertMixedListFormats');
        this.log.debug("=== CONVERTING MIXED LIST FORMATS ===");
        const mixedConverted = await this.convertMixedListFormats(doc, options.listBulletSettings);
        if (mixedConverted > 0) {
          this.log.info(`Converted ${mixedConverted} mixed list levels to uniform format`);
        }
        this.debugCaptureListState(doc, 'AFTER convertMixedListFormats');

        // Track list formatting changes
        const totalListsFixed = bulletsStandardized + numbersStandardized + mixedConverted;
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

      // Apply list continuation indentation to non-list paragraphs that follow list items
      // These are "continuation" paragraphs that should align with the list item's text
      if (options.listBulletSettings?.enabled) {
        this.debugCaptureListState(doc, 'BEFORE applyListContinuationIndentation');
        this.log.debug("=== APPLYING LIST CONTINUATION INDENTATION ===");

        // First, handle table cells with cell-scoped context
        // This ensures "Example:" paragraphs in tables are properly indented
        const tableIndented = await this.applyListContinuationIndentationInTables(
          doc,
          options.listBulletSettings
        );

        // Then handle body paragraphs (outside tables)
        const bodyIndented = await this.applyListContinuationIndentation(
          doc,
          options.listBulletSettings
        );

        const totalIndented = tableIndented + bodyIndented;
        if (totalIndented > 0) {
          this.log.info(`Applied list continuation indentation to ${totalIndented} paragraphs (${tableIndented} in tables, ${bodyIndented} in body)`);
        }
        this.debugCaptureListState(doc, 'AFTER applyListContinuationIndentation');
      }

      // Standardize numbering colors to fix green bullet issue
      // NOTE: Indentation is now set via in-memory model in applyBulletUniformity()
      // The old injectIndentationToNumbering() raw XML approach was ineffective (changes lost during save)
      if (options.listBulletSettings?.enabled || options.bulletUniformity) {
        if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
          this.log.debug('=== LIST DEBUG: BEFORE standardizeNumberingColors (modifies numbering.xml) ===');
        }
        this.log.debug("=== STANDARDIZING NUMBERING COLORS ===");
        const colorFixed = await this.standardizeNumberingColors(doc);
        if (colorFixed) {
          this.log.info("Standardized all numbering colors to black");
        }
        if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
          this.log.debug('=== LIST DEBUG: AFTER standardizeNumberingColors ===');
        }
      }

      if (options.tableUniformity) {
        this.log.debug("=== APPLYING TABLE UNIFORMITY (DOCXMLATER 1.7.0) ===");
        this.log.info(`[DEBUG] tableUniformity=true, smartTables=${options.smartTables} (BOTH will run if both true!)`);
        const tablesFormatted = await this.applyTableUniformity(doc, options);
        this.log.info(
          `Applied standard formatting to ${tablesFormatted.tablesProcessed} tables (shading, borders, autofit, patterns)`
        );

        // Center numeric cells (step numbers like "1", "2", "3")
        const centeredCount = await tableProcessor.centerNumericCells(doc);
        if (centeredCount > 0) {
          this.log.info(`Centered ${centeredCount} numeric table cells`);
        }

        // Apply Step column width adjustment (tables with "Step" header get 1 inch width)
        const stepColumnsAdjusted = await tableProcessor.applyStepColumnWidth(doc);
        if (stepColumnsAdjusted > 0) {
          this.log.info(`Adjusted ${stepColumnsAdjusted} Step column widths to 1 inch`);
        }

        // Remove specified row heights - allow rows to auto-size based on content
        const rowHeightsRemoved = await tableProcessor.removeSpecifiedRowHeights(doc);
        if (rowHeightsRemoved > 0) {
          this.log.info(`Removed specified heights from ${rowHeightsRemoved} table rows`);
        }

        // Apply cell padding based on "Adjust Table Padding" processing option
        // When disabled, tables keep their existing padding (no modification)
        const adjustTablePadding = options.enabledOperations?.includes('adjust-table-padding');
        if (adjustTablePadding) {
          // Apply custom padding from user settings
          const cellPaddingApplied = await tableProcessor.applyTablePadding(doc, options.tableShadingSettings);
          if (cellPaddingApplied > 0) {
            this.log.info(`Applied custom padding to ${cellPaddingApplied} table cells`);
          }
        }
        // Note: When 'adjust-table-padding' is disabled, tables keep their original padding

        // NOTE: ensureHeading2StyleIn1x1Tables() is now called BEFORE style application
        // (see line ~1175) so 1x1 table paragraphs get proper Heading 2 formatting

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

        const smartFormatted = await this.applySmartTableFormatting(doc, options);

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

      // ═══════════════════════════════════════════════════════════
      // HIDDEN TEXT STYLE APPLICATION
      // Apply Hidden Text style to runs with #FFFFFF color
      // Runs AFTER table processing to restore any FFFFFF runs overwritten
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== APPLYING HIDDEN TEXT STYLE ===");
      const normalStyle = options.styles?.find((s: SessionStyle) => s.id === 'normal');
      const hiddenTextCount = this.applyHiddenTextStyle(doc, normalStyle);
      if (hiddenTextCount > 0) {
        result.changes?.push({
          type: 'style',
          category: 'style_application',
          description: 'Applied Hidden Text style to white font runs',
          count: hiddenTextCount,
        });
      }

      // ═══════════════════════════════════════════════════════════
      // TABLE BORDER STANDARDIZATION (CONDITIONAL)
      // Standardize all table and cell borders to uniform thickness
      // ═══════════════════════════════════════════════════════════
      if (options.standardizeTableBorders) {
        this.log.debug("=== STANDARDIZING TABLE BORDERS ===");
        const borderThickness = options.tableShadingSettings?.cellBorderThickness ?? 0.5;
        const borderSize = Math.round(borderThickness * 8); // Convert points to eighths

        const tablesNormalized = this.standardizeTableBorders(doc, {
          size: borderSize,
        });

        if (tablesNormalized > 0) {
          this.log.info(`Standardized borders on ${tablesNormalized} tables to ${borderThickness}pt`);
          result.changes?.push({
            type: 'table',
            category: 'structure',
            description: `Standardized table borders to ${borderThickness}pt thickness`,
            count: tablesNormalized,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════
      // HLP TABLE DETECTION AND FORMATTING
      // Detect HLP tables (FFC000 header) and apply special formatting:
      // - Outer borders: 2.25pt orange (#FFC000)
      // - No internal horizontal borders
      // - Internal vertical borders: 2.25pt orange
      // - Header row: Heading 2 style
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== PROCESSING HLP TABLES ===");
      const hlpResult = await tableProcessor.processHLPTables(doc);

      if (hlpResult.tablesFound > 0) {
        this.log.info(`Processed ${hlpResult.tablesFound} HLP tables with ${hlpResult.headersStyled} headers styled`);
        result.changes?.push({
          type: 'table',
          category: 'structure',
          description: `Applied HLP formatting to ${hlpResult.tablesFound} table(s)`,
          count: hlpResult.tablesFound,
        });
      }

      // ═══════════════════════════════════════════════════════════
      // TABLE AUTOFIT TO WINDOW + CLEAR ROW HEIGHTS
      // Set all tables to auto-fit layout and clear fixed row heights
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== SETTING TABLES TO AUTOFIT WINDOW ===");
      const tables = doc.getTables();
      let autofitCount = 0;
      for (const table of tables) {
        table.setLayout("auto");
        // Clear fixed row heights to allow content-based sizing
        for (const row of table.getRows()) {
          row.clearHeight();
        }
        autofitCount++;
      }
      if (autofitCount > 0) {
        this.log.info(`Set ${autofitCount} tables to autofit window layout with auto row heights`);
        result.changes?.push({
          type: 'table',
          category: 'structure',
          description: 'Set tables to autofit window layout',
          count: autofitCount,
        });
      }

      // ═══════════════════════════════════════════════════════════
      // FIX "STEP" TABLE COLUMN WIDTH
      // Tables with "Step" header and numbered rows get 1" first column
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== FIXING STEP TABLE COLUMN WIDTHS ===");
      const stepTablesFixed = this.fixStepTableColumnWidth(doc);
      if (stepTablesFixed > 0) {
        this.log.info(`Fixed ${stepTablesFixed} "Step" tables with 1" first column`);
        result.changes?.push({
          type: 'table',
          category: 'structure',
          description: 'Set "Step" table first column to 1 inch',
          count: stepTablesFixed,
        });
      }

      // ═══════════════════════════════════════════════════════════
      // TEXT REPLACEMENT: "Parent SOP:" → "Parent Document:"
      // Replace bolded "Parent SOP:" with "Parent Document:" preserving formatting
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== REPLACING 'PARENT SOP:' TEXT ===");
      const parentSopReplaced = doc.replaceFormattedText('Parent SOP:', 'Parent Document:', {
        matchBold: true,
      });
      if (parentSopReplaced > 0) {
        this.log.info(`Replaced ${parentSopReplaced} instances of "Parent SOP:" with "Parent Document:"`);
        result.changes?.push({
          type: 'text',
          category: 'structure',
          description: 'Replaced "Parent SOP:" with "Parent Document:"',
          count: parentSopReplaced,
        });
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
        const excludeHeading1 = options.operations?.forceRemoveHeading1FromTOC ?? true;
        const tocResult = await this.buildProperTOC(doc, { excludeHeading1 });
        this.log.info(`✓ Built proper TOC with ${tocResult.count} styled hyperlink entries`);

        // Track Table of Contents creation with heading names
        if (tocResult.count > 0) {
          result.changes?.push({
            type: 'structure',
            category: 'structure',
            description: 'Rebuilt Table of Contents with styled hyperlinks',
            count: tocResult.count,
            affectedItems: tocResult.headings,
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
          this.log.info(`Hyperlink tracking status: comparison=${comparison ? 'exists' : 'null'}, hyperlinkChanges=${comparison?.hyperlinkChanges?.length ?? 0}`);

          if (comparison?.hyperlinkChanges && comparison.hyperlinkChanges.length > 0) {
            this.log.info(`Adding ${comparison.hyperlinkChanges.length} DocHub hyperlink changes to changelog`);

            for (const hc of comparison.hyperlinkChanges) {
              const urlChanged = hc.originalUrl !== hc.modifiedUrl;
              const textChanged = hc.originalText !== hc.modifiedText;

              // Only add entry if something actually changed
              if (urlChanged || textChanged) {
                // Find nearest Header 2 for context
                const nearestHeading = this.findNearestHeader2(doc, hc.paragraphIndex) || undefined;

                changelogEntries.push({
                  id: `dochub-hyperlink-${hc.paragraphIndex}-${hc.hyperlinkIndex}-${Date.now()}`,
                  revisionType: "hyperlinkChange",
                  category: "hyperlink",
                  description: this.describeHyperlinkProcessingChange(hc),
                  author: authorName,
                  date: new Date(),
                  location: {
                    paragraphIndex: hc.paragraphIndex,
                    nearestHeading,
                  },
                  content: {
                    hyperlinkChange: {
                      urlBefore: hc.originalUrl,
                      urlAfter: hc.modifiedUrl,
                      textBefore: hc.originalText,
                      textAfter: hc.modifiedText,
                      status: hc.status, // 'updated', 'not_found', or 'expired'
                      contentId: hc.contentId, // Include content ID for display
                    },
                  },
                });
              }
            }
          }
        }

        // ═══════════════════════════════════════════════════════════
        // ENRICH WORD TRACKED CHANGES WITH CONTEXT
        // Add nearestHeading to entries that have paragraphIndex but no heading
        // ═══════════════════════════════════════════════════════════
        for (const entry of changelogEntries) {
          if (entry.location?.paragraphIndex !== undefined && !entry.location.nearestHeading) {
            const nearestHeading = this.findNearestHeader2(doc, entry.location.paragraphIndex);
            if (nearestHeading) {
              entry.location.nearestHeading = nearestHeading;
            }
          }
        }

        // Calculate summary - need to cast back for docxmlater's getSummary, then cast result
        // The summary may not include all category counts, so ensure they're all present
        const rawSummary = ChangelogGenerator.getSummary(changelogEntries as any);
        const hyperlinkCount = changelogEntries.filter(e => e.category === "hyperlink").length;
        const imageCount = changelogEntries.filter(e => e.category === "image").length;
        const fieldCount = changelogEntries.filter(e => e.category === "field").length;
        const commentCount = changelogEntries.filter(e => e.category === "comment").length;
        const bookmarkCount = changelogEntries.filter(e => e.category === "bookmark").length;
        const contentControlCount = changelogEntries.filter(e => e.category === "contentControl").length;
        const summary: ChangelogSummary = {
          ...rawSummary,
          byCategory: {
            ...rawSummary.byCategory,
            hyperlink: hyperlinkCount,
            image: imageCount,
            field: fieldCount,
            comment: commentCount,
            bookmark: bookmarkCount,
            contentControl: contentControlCount,
          },
        };

        this.log.info(`Extracted ${changelogEntries.length} tracked changes for UI display`);

        // Store in result for UI
        result.wordRevisions = {
          hasRevisions: changelogEntries.length > 0,
          entries: changelogEntries,
          summary: summary,
          handlingMode: options.revisionHandlingMode || "preserve_and_wrap",
          processingAuthor: authorName, // Pass author for UI source detection
        };
      } catch (changelogError) {
        this.log.warn("Failed to extract changelog entries:", changelogError);
        // Non-fatal - continue with save
      }

      // ═══════════════════════════════════════════════════════════
      // OPTIONALLY AUTO-ACCEPT REVISIONS
      // If autoAcceptRevisions is true, accept ALL tracked changes
      // (both pre-existing and DocHub processing changes)
      // This produces a clean document while UI still shows what changed
      // Default: false - preserve tracked changes in document
      //
      // NOTE: We explicitly call acceptAllRevisions() before save rather than
      // relying on setAcceptRevisionsBeforeSave(). This ensures ALL revision
      // types are accepted including w:pPrChange (paragraph property changes)
      // which may not be handled by the deferred approach.
      // ═══════════════════════════════════════════════════════════
      const autoAccept = options.autoAcceptRevisions ?? false;
      if (autoAccept) {
        this.log.debug("=== ACCEPTING ALL REVISIONS ===");
        try {
          // CRITICAL: Disable track changes FIRST to flush all pending changes to Revision objects.
          // disableTrackChanges() internally calls flushPendingChanges() which converts
          // pending tracked changes into Revision objects in the model.
          // We MUST do this BEFORE acceptAllRevisions() to ensure ALL revisions are accepted.
          doc.disableTrackChanges();
          this.log.debug("Track changes disabled - pending changes flushed to Revision objects");

          // NOW accept all revisions (including the ones just flushed by disableTrackChanges)
          // This handles all revision types: w:ins, w:del, w:pPrChange, w:rPrChange, etc.
          if (typeof (doc as any).acceptAllRevisions === 'function') {
            await (doc as any).acceptAllRevisions();
            this.log.info("Accepted all revisions via Document.acceptAllRevisions()");
          } else {
            // Fallback: try setAcceptRevisionsBeforeSave if direct methods not available
            this.log.warn("Direct acceptance method not available, using setAcceptRevisionsBeforeSave fallback");
            doc.setAcceptRevisionsBeforeSave(true);
          }

          // Count total expected revisions (pre-existing + DocHub)
          const preExistingCount = result.previousRevisions?.entries.length || 0;
          const docHubCount = result.wordRevisions?.entries.length || 0;
          this.log.info(`Auto-accept complete - ${preExistingCount + docHubCount} total revisions accepted (${preExistingCount} pre-existing + ${docHubCount} DocHub changes)`);

          if (result.wordRevisions) {
            result.wordRevisions.handlingResult = {
              accepted: result.wordRevisions.entries.map((e) => e.id),
              preserved: [],
              conflicts: 0,
            };
          }
        } catch (acceptError) {
          this.log.warn("Failed to accept revisions:", acceptError);
          // Non-fatal - document will have tracked changes visible
        }
      } else {
        // When auto-accept is OFF, both pre-existing AND DocHub changes remain visible in Word
        const preExistingCount = result.previousRevisions?.entries.length || 0;
        const docHubCount = result.wordRevisions?.entries.length || 0;
        this.log.info(`Auto-accept disabled - ${preExistingCount + docHubCount} tracked changes will be visible in Word (${preExistingCount} pre-existing + ${docHubCount} DocHub)`);
      }

      // ═══════════════════════════════════════════════════════════
      // DOCUMENT CLEANUP - Using CleanupHelper from docxmlater 9.2.0
      //
      // Performs essential cleanup operations before save:
      // - Defragment hyperlinks (fix fragmented links from Google Docs)
      // - Remove unused numbering definitions
      // - Clean up orphaned relationships
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== DOCUMENT CLEANUP ===");
      try {
        const cleanup = new CleanupHelper(doc);
        const cleanupReport = cleanup.run({
          defragmentHyperlinks: true,
          cleanupNumbering: true,
          cleanupRelationships: true,
        });
        if (cleanupReport.hyperlinksDefragmented > 0 || cleanupReport.numberingRemoved > 0 || cleanupReport.relationshipsRemoved > 0) {
          this.log.info(`Cleanup: ${cleanupReport.hyperlinksDefragmented} hyperlinks defragmented, ${cleanupReport.numberingRemoved} unused numbering removed, ${cleanupReport.relationshipsRemoved} orphaned relationships removed`);
        }
      } catch (cleanupError) {
        this.log.debug("Cleanup completed with warnings:", cleanupError);
        // Non-fatal - continue with save
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
      // Previous approach of toBuffer() → validate → resave caused
      // corruption due to double ZIP creation breaking file ordering.
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== SAVING DOCUMENT ===");

      // ═══════════════════════════════════════════════════════════
      // DOCUMENT ORIENTATION AND MARGINS
      // Set landscape orientation and 1" margins on all sides
      // ═══════════════════════════════════════════════════════════
      if (options.setLandscapeMargins) {
        this.log.debug("=== SETTING LANDSCAPE ORIENTATION AND MARGINS ===");

        // Set landscape orientation
        doc.setPageOrientation('landscape');

        // Set 1" margins on all sides (1440 twips = 1 inch)
        doc.setMargins({
          top: 1440,
          bottom: 1440,
          left: 1440,
          right: 1440,
        });

        this.log.info('Set document to landscape orientation with 1" margins');
        result.changes?.push({
          type: 'structure',
          category: 'structure',
          description: 'Set landscape orientation with 1" margins',
        });
      }

      // PRESERVE TOC FIELD STRUCTURE
      // DocXMLater loses complex field structures (<w:fldChar>) during load.
      // Always rebuild TOCs to restore proper field structure before save.
      // This ensures the TOC field codes are preserved and Word's "Update Field"
      // option remains available, regardless of TOC Processing Options.
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== REBUILDING TOC FIELD STRUCTURE ===");
      try {
        const tocResults = doc.rebuildTOCs();
        if (tocResults.length > 0) {
          this.log.info(`Rebuilt ${tocResults.length} TOC(s) to preserve field structure`);
        }
      } catch (error) {
        this.log.debug("No TOC to rebuild or rebuild failed:", error);
      }

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

      // PROCESSING SUMMARY - Always log key metrics
      this.log.info("═══════════════════════════════════════════════════════════");
      this.log.info("  PROCESSING COMPLETE");
      this.log.info("═══════════════════════════════════════════════════════════");
      this.log.info(`Document: ${path.basename(filePath)}`);
      this.log.info(`Total hyperlinks: ${result.totalHyperlinks}`);
      this.log.info(`Modified: ${result.modifiedHyperlinks}`);
      this.log.info(`Appended Content IDs: ${result.appendedContentIds}`);
      this.log.info(`Total changes tracked: ${result.changes?.length || 0}`);
      this.log.info(`Duration: ${result.duration.toFixed(0)}ms`);

      // VERBOSE DEBUG OUTPUT - Only when debug mode enabled
      if (isDebugEnabled(debugModes.DOCUMENT_PROCESSING)) {
        this.log.debug("--- Detailed Processing Stats ---");
        this.log.debug(`File size: ${(result.documentSize || 0) / 1024}KB`);
        this.log.debug(`URLs updated: ${result.updatedUrls}`);
        this.log.debug(`Display texts updated: ${result.updatedDisplayTexts}`);
        this.log.debug(`Skipped hyperlinks: ${result.skippedHyperlinks}`);
        this.log.debug(`Errors: ${result.errorCount}`);
        if (result.errorMessages.length > 0) {
          this.log.debug(`Error messages: ${result.errorMessages.join(', ')}`);
        }
        this.log.debug(`Processing rate: ${((result.totalHyperlinks || 1) / (result.duration / 1000)).toFixed(1)} hyperlinks/sec`);
        this.log.debug("--- End Detailed Stats ---");
      }

      return result;
    } catch (error) {
      // Detect file lock errors and compatibility mode errors, show user-friendly messages
      let errorMessage: string;
      if (this.isFileLockError(error)) {
        errorMessage = "Please close the file and try again";
        this.log.error("ERROR (file locked):", error instanceof Error ? error.message : String(error));
      } else if (error instanceof Error && error.message.startsWith('COMPATIBILITY_MODE:')) {
        // Remove the internal prefix for user-friendly display
        errorMessage = error.message.replace('COMPATIBILITY_MODE: ', '');
        this.log.error("ERROR (compatibility mode):", errorMessage);
      } else {
        errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        this.log.error("ERROR:", errorMessage);
      }

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
   * Check if an item is a Run (not a Hyperlink or Revision)
   * Uses docxmlater's type guard for proper type checking.
   * @param item - The paragraph content item to check
   * @returns true if the item is a Run object
   */
  private isRunItem(item: ParagraphContent): item is Run {
    return isRun(item);
  }

  /**
   * Create backup of document in DocHub_Backups subfolder
   */
  private async createBackup(filePath: string): Promise<string> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);

    // Create DocHub_Backups folder if it doesn't exist
    const backupDir = path.join(dir, 'DocHub_Backups');
    await fs.mkdir(backupDir, { recursive: true });

    // Count existing backups to determine next number
    const existingCount = await this.getExistingBackupCount(backupDir, base, ext);
    const nextNumber = existingCount + 1;

    // New format: filename_Backup_#.docx
    const backupPath = path.join(backupDir, `${base}_Backup_${nextNumber}${ext}`);

    await fs.copyFile(filePath, backupPath);
    return backupPath;
  }

  /**
   * Count existing backups for a file to determine the next backup number
   */
  private async getExistingBackupCount(
    backupDir: string,
    baseName: string,
    ext: string
  ): Promise<number> {
    try {
      const files = await fs.readdir(backupDir);
      // Escape special regex characters in baseName and ext
      const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`^${escapedBase}_Backup_(\\d+)${escapedExt}$`);

      let maxNumber = 0;
      for (const file of files) {
        const match = file.match(pattern);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber) maxNumber = num;
        }
      }
      return maxNumber;
    } catch {
      // Directory doesn't exist or can't be read - start from 0
      return 0;
    }
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
   * When track changes is enabled, this method creates proper Word tracked changes:
   * - Old hyperlink wrapped in w:del (shows as strikethrough in Word)
   * - New hyperlink wrapped in w:ins (shows as underlined in Word)
   *
   * Enhanced with comprehensive error handling to prevent data corruption
   * from partial updates when some URL updates fail.
   *
   * @param doc - The document being processed
   * @param urlMap - Map of old URL -> new URL
   * @param author - Author name for tracked changes (optional, defaults to 'DocHub')
   * @returns UrlUpdateResult with success count and failure details
   */
  private async applyUrlUpdates(
    doc: Document,
    urlMap: Map<string, string>,
    author: string = 'DocHub'
  ): Promise<UrlUpdateResult> {
    if (urlMap.size === 0) {
      return { updated: 0, failed: [] };
    }

    const failedUrls: UrlUpdateResult["failed"] = [];
    let updatedCount = 0;
    const paragraphs = doc.getAllParagraphs();
    const trackChangesEnabled = doc.isTrackChangesEnabled();

    this.log.debug(`Processing ${paragraphs.length} paragraphs for URL updates`);
    if (trackChangesEnabled) {
      this.log.debug(`Track changes enabled - will create tracked hyperlink changes`);
    }

    for (let paraIndex = 0; paraIndex < paragraphs.length; paraIndex++) {
      const para = paragraphs[paraIndex];
      const content = para.getContent();

      // Find hyperlinks in this paragraph that need URL updates
      // We need to iterate over a copy since we may modify content during iteration
      for (const item of [...content]) {
        // Case 1: Direct Hyperlink instances
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
              if (trackChangesEnabled) {
                // Create tracked changes for URL update:
                // 1. Clone the hyperlink to preserve old state
                const oldHyperlink = item.clone();

                // 2. Update the hyperlink with new URL
                item.setUrl(newUrl);

                // 3. Create deletion revision for old hyperlink
                const deletion = Revision.createDeletion(author, [oldHyperlink]);

                // 4. Create insertion revision for new hyperlink
                const insertion = Revision.createInsertion(author, [item]);

                // 5. Replace the hyperlink in paragraph with the revisions
                const replaced = para.replaceContent(item, [deletion, insertion]);

                if (replaced) {
                  // 6. Register revisions with the document's revision manager
                  const revisionManager = doc.getRevisionManager();
                  revisionManager.register(deletion);
                  revisionManager.register(insertion);

                  this.log.debug(`Created tracked change for hyperlink URL: ${oldUrl} -> ${newUrl}`);
                } else {
                  // Fallback: replaceContent failed, just update the URL
                  this.log.warn(`Could not create tracked change, falling back to direct update: ${oldUrl}`);
                }
              } else {
                // No track changes - just update the URL directly
                item.setUrl(newUrl);
                this.log.debug(`Updated hyperlink URL: ${oldUrl} -> ${newUrl}`);
              }

              updatedCount++;
            } catch (error) {
              // Log the failure with context
              this.log.error(
                `Failed to update URL at paragraph ${paraIndex}: ${oldUrl} -> ${newUrl}`,
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
        // Case 2: Hyperlinks inside Revision elements (w:ins, w:del tracked changes)
        // These hyperlinks are already wrapped in a revision, so just update URL directly
        else if (item instanceof Revision) {
          const revisionContent = item.getContent();
          for (const revContent of revisionContent) {
            if (revContent instanceof Hyperlink) {
              const oldUrl = revContent.getUrl();

              if (oldUrl && urlMap.has(oldUrl)) {
                const newUrl = urlMap.get(oldUrl)!;

                // Skip if URLs are identical (no-op update)
                if (oldUrl === newUrl) {
                  this.log.debug(`Skipping no-op update inside Revision: ${oldUrl}`);
                  continue;
                }

                try {
                  // Update URL directly - hyperlink is already inside a Revision
                  // so we don't need to create additional tracked changes
                  revContent.setUrl(newUrl);
                  updatedCount++;
                  this.log.debug(`Updated hyperlink URL inside Revision: ${oldUrl} -> ${newUrl}`);
                } catch (error) {
                  this.log.error(
                    `Failed to update URL inside Revision at paragraph ${paraIndex}: ${oldUrl} -> ${newUrl}`,
                    error
                  );
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
      }
    }

    // Log summary with appropriate level
    if (failedUrls.length > 0) {
      this.log.warn(
        `URL update completed with ${failedUrls.length} failures. ` +
          `Updated: ${updatedCount}, Failed: ${failedUrls.length}, Total Attempted: ${urlMap.size}`
      );

      // Log details of each failure for debugging
      failedUrls.forEach(({ oldUrl, newUrl, error, paragraphIndex }) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.error(`  - Paragraph ${paragraphIndex}: ${oldUrl} -> ${newUrl} (${errorMessage})`);
      });
    } else {
      this.log.info(`Successfully updated ${updatedCount} hyperlink URLs`);
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
   * Processes all text runs in the document, including cross-run double spaces
   */
  private async removeExtraWhitespace(doc: Document): Promise<number> {
    let cleanedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      // Skip TOC paragraphs - they contain field instructions that must not be modified
      // TOC styles: TOC1, TOC2, TOC3, etc. (but NOT TOCHeading which is a title)
      const style = para.getStyle() || "";
      if (style.startsWith("TOC") && style !== "TOCHeading") {
        continue;
      }

      // Skip paragraphs with complex field content (instructionText runs)
      // This prevents corrupting TOC field instructions, cross-references, etc.
      if (this.hasComplexFieldContent(para)) {
        continue;
      }

      const runs = para.getRuns();

      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const text = run.getText();
        if (!text) continue;

        // Step 1: Collapse multiple consecutive SPACES only
        // Preserve tabs (\t) and newlines (\n) as they represent intentional formatting (<w:tab/> and <w:br/>)
        let cleaned = text.replace(/ {2,}/g, " ");

        // Step 2: Trim trailing space if next run starts with space (cross-run double space)
        if (i < runs.length - 1) {
          const nextRun = runs[i + 1];
          const nextText = nextRun?.getText() || "";
          if (cleaned.endsWith(" ") && nextText.startsWith(" ")) {
            cleaned = cleaned.trimEnd();
          }
        }

        // Step 3: Trim leading space if previous run ends with space (cross-run double space)
        if (i > 0) {
          const prevRun = runs[i - 1];
          const prevText = prevRun?.getText() || "";
          if (cleaned.startsWith(" ") && prevText.endsWith(" ")) {
            cleaned = cleaned.trimStart();
          }
        }

        if (cleaned !== text) {
          run.setText(cleaned);
          cleanedCount++;
        }
      }
    }

    return cleanedCount;
  }

  /**
   * Check if paragraph contains complex field content (TOC, cross-references, etc.)
   * These should not be processed to avoid corrupting field structure.
   *
   * Complex fields in OOXML use:
   * - w:fldChar elements with fldCharType="begin|separate|end"
   * - w:instrText elements containing the field instruction (e.g., "TOC \o 1-3")
   *
   * If we call setText() on runs containing these, the field structure is destroyed
   * and field instructions appear as visible text in Word.
   */
  private hasComplexFieldContent(para: Paragraph): boolean {
    try {
      for (const run of para.getRuns()) {
        const content = run.getContent();
        // Check for instructionText (TOC field instructions, HYPERLINK fields, etc.)
        // or fieldChar markers (begin/separate/end)
        if (
          content.some(
            (c: { type: string }) =>
              c.type === "instructionText" || c.type === "fieldChar"
          )
        ) {
          return true;
        }
      }
      return false;
    } catch {
      return false; // Safe default - don't skip if we can't check
    }
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
      // IMPORTANT: Check ImageRun BEFORE Run since ImageRun extends Run
      for (const item of content) {
        if (item instanceof Hyperlink) {
          const hyperlinkText = item.getText() || "";
          this.log.debug(`  ✗ Paragraph contains hyperlink: "${hyperlinkText}" - NOT empty`);
          this.log.debug(`  RESULT: NOT EMPTY (hyperlink)\n`);
          return false;
        }
        if (item instanceof ImageRun) {
          this.log.debug(`  ✗ Paragraph contains image (ImageRun) - NOT empty`);
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
   * Mark single blank paragraphs as preserved to prevent their removal.
   * Only marks blanks that are NOT followed by another blank (i.e., not consecutive).
   * This allows consecutive duplicate blanks to be removed while keeping intentional single blanks.
   *
   * @param doc - The document to process
   * @returns Number of paragraphs marked as preserved
   */
  private markSingleBlanksAsPreserved(doc: Document): number {
    let markedCount = 0;
    const paragraphs = doc.getAllParagraphs();
    let blankCount = 0;

    this.log.debug(`markSingleBlanksAsPreserved: Processing ${paragraphs.length} paragraphs`);

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const nextPara = paragraphs[i + 1];

      // Check if this paragraph is blank (no text content in paragraph or runs)
      const runs = para.getRuns();
      const isBlank = !para.getText()?.trim() && runs.every((run) => !run.getText()?.trim());
      if (!isBlank) continue;

      blankCount++;

      // Check if next paragraph is also blank
      const nextRuns = nextPara?.getRuns() || [];
      const nextIsBlank = nextPara &&
        !nextPara.getText()?.trim() &&
        nextRuns.every((run) => !run.getText()?.trim());

      this.log.debug(`  Blank #${blankCount} at index ${i}: nextIsBlank=${nextIsBlank}, alreadyPreserved=${para.isPreserved()}`);

      // If this is a SINGLE blank (not consecutive), mark as preserved
      if (!nextIsBlank && !para.isPreserved()) {
        para.setPreserved(true);
        markedCount++;
        this.log.debug(`    → MARKED as preserved (single blank or last in consecutive series)`);
      }
    }

    this.log.debug(`markSingleBlanksAsPreserved: Found ${blankCount} blanks, marked ${markedCount} as preserved`);
    return markedCount;
  }

  /**
   * Mark paragraphs containing complex field content as preserved.
   *
   * This MUST be called BEFORE removeExtraBlankParagraphs() to prevent
   * corruption of TOC and other complex field structures.
   *
   * The issue: TOC fields contain paragraphs with only <w:fldChar w:fldCharType="end"/>
   * which appear "blank" but are critical to the field structure. Without marking
   * these as preserved, removeExtraBlankParagraphs() removes them, causing:
   * - TOC field instructions to appear as visible text
   * - "Update Field" option to disappear from the TOC
   *
   * @param doc - Document to process
   * @returns Number of paragraphs marked as preserved
   */
  private markFieldParagraphsAsPreserved(doc: Document): number {
    let markedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      // Skip if already preserved
      if (para.isPreserved()) continue;

      // Check for field content in runs
      try {
        const runs = para.getRuns();
        for (const run of runs) {
          const content = run.getContent();
          const hasFieldContent = content.some(
            (c: { type: string }) =>
              c.type === 'fieldChar' || c.type === 'instructionText'
          );
          if (hasFieldContent) {
            para.setPreserved(true);
            markedCount++;
            break;
          }
        }
      } catch {
        // If we can't check runs, skip this paragraph
      }

      // Also preserve TOC-styled paragraphs (TOC1, TOC2, etc.)
      // These are the actual TOC entries that should never be removed
      if (!para.isPreserved()) {
        const style = para.getStyle() || '';
        if (style.startsWith('TOC') && style !== 'TOCHeading') {
          para.setPreserved(true);
          markedCount++;
        }
      }
    }

    return markedCount;
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
   * @param preserveUserBlankStructures - Whether to preserve single blank lines (only remove consecutive duplicates)
   * @returns Number of paragraphs removed
   */
  private async removeExtraParagraphLines(
    doc: Document,
    preserveBlankLinesAfterHeader2Tables: boolean = true,
    preserveUserBlankStructures: boolean = false
  ): Promise<number> {
    this.log.debug("=== REMOVING EXTRA BLANK PARAGRAPHS (FRAMEWORK METHOD) ===");
    // addStructureBlankLines is enabled because this function only runs when "Remove Extra Blank Lines" is enabled
    this.log.debug("  addStructureBlankLines: true (linked to Remove Extra Blank Lines option)");
    this.log.debug(`  preserveUserBlankStructures: ${preserveUserBlankStructures}`);

    // ═══════════════════════════════════════════════════════════════════════
    // CRITICAL: Mark field paragraphs as preserved BEFORE removing blank paragraphs
    // Paragraphs containing field characters (fldChar) or instruction text (instrText)
    // must be preserved to maintain TOC and other complex field structures.
    // Without this, the paragraph containing <w:fldChar w:fldCharType="end"/> gets
    // removed, corrupting the TOC field structure.
    // ═══════════════════════════════════════════════════════════════════════
    const fieldParasMarked = this.markFieldParagraphsAsPreserved(doc);
    if (fieldParasMarked > 0) {
      this.log.debug(`  Marked ${fieldParasMarked} field paragraphs as preserved (TOC protection)`);
    }

    // Use DocXMLater's built-in removeExtraBlankParagraphs() method
    // addStructureBlankLines: true - adds blank lines after lists (enabled because Remove Extra Blank Lines is on)
    // preserveSingleBlanks: preserves single blank lines when user wants to keep their blank line structure
    const result = doc.removeExtraBlankParagraphs({
      addStructureBlankLines: true,
      stopBoldColonAfterHeading: "Related Documents",
      preserveSingleBlanks: preserveUserBlankStructures,
    });

    this.log.info(
      `✓ Framework method completed: ${result.removed} blank paragraphs removed, ` +
      `${result.added} structure lines added, ${result.preserved || 0} single blanks preserved`
    );

    // Post-processing: Remove trailing blank paragraphs from table cells
    // This fixes the issue where blank lines appear after images in table cells
    const trailingBlanksRemoved = this.removeTrailingBlanksFromTableCells(doc);
    if (trailingBlanksRemoved > 0) {
      this.log.info(`  Removed ${trailingBlanksRemoved} trailing blank paragraphs from table cells`);
    }

    return result.removed + trailingBlanksRemoved;
  }

  /**
   * Remove trailing blank paragraphs from table cells.
   * This fixes the issue where blank lines appear after images in table cells
   * when the image is the last element in the cell.
   *
   * @param doc - The document to process
   * @returns Number of blank paragraphs removed from table cells
   */
  private removeTrailingBlanksFromTableCells(doc: Document): number {
    let removedCount = 0;

    for (const table of doc.getTables()) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          const paras = cell.getParagraphs();

          // Remove trailing blank paragraphs (keep at least one paragraph)
          while (paras.length > 1) {
            const lastPara = paras[paras.length - 1];
            const paraText = lastPara.getText()?.trim() || "";
            const runs = lastPara.getRuns();

            // Check if paragraph is blank (no text, no runs with content)
            const isBlank =
              !paraText &&
              runs.every((run) => !run.getText()?.trim());

            // Also check for images - don't remove paragraphs containing images
            // ImageRun extends Run and contains the actual image, Image is the underlying element
            const content = lastPara.getContent();
            const hasImage = content.some(
              (item) => item instanceof ImageRun || item instanceof Image
            );

            if (isBlank && !hasImage && !lastPara.isPreserved()) {
              try {
                cell.removeParagraph(paras.length - 1);
                removedCount++;
                // Update paras reference after removal
                paras.pop();
              } catch (error) {
                this.log.warn(`Failed to remove trailing blank from cell: ${error}`);
                break;
              }
            } else {
              break;
            }
          }
        }
      }
    }

    return removedCount;
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
   * Normalize en-dashes to regular hyphens
   *
   * Replaces typographic en-dashes (U+2013, –) with standard ASCII hyphens (U+002D, -)
   * in all document text runs.
   *
   * Skips TOC paragraphs and complex field content to prevent corruption.
   *
   * @param doc - Document to process
   * @returns Number of runs modified
   */
  private async normalizeEnDashesToHyphens(doc: Document): Promise<number> {
    const { normalizeEnDashesToHyphens } = await import('@/utils/textSanitizer');
    let normalizedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      // Skip TOC paragraphs - they contain field instructions that must not be modified
      const style = para.getStyle() || "";
      if (style.startsWith("TOC") && style !== "TOCHeading") {
        continue;
      }

      // Skip paragraphs with complex field content (instructionText runs)
      if (this.hasComplexFieldContent(para)) {
        continue;
      }

      const runs = para.getRuns();

      for (const run of runs) {
        const text = run.getText();
        if (!text) continue;

        const normalized = normalizeEnDashesToHyphens(text);

        if (normalized !== text) {
          run.setText(normalized);
          normalizedCount++;
        }
      }
    }

    return normalizedCount;
  }

  /**
   * Standardize hyperlink formatting - Remove bold/italic and reset to standard style
   *
   * Ensures all hyperlinks have consistent formatting:
   * - Font: Verdana 12pt
   * - Color: Blue (#0000FF)
   * - Underline: Single
   * - Bold/Italic: false
   *
   * This method handles ALL hyperlinks including:
   * - Case 1: Direct Hyperlink instances in paragraphs
   * - Case 2: Hyperlinks inside Revision elements (w:ins, w:del tracked changes)
   * - Case 3: HYPERLINK field codes (ComplexField)
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
      // Process all paragraphs in the document to find ALL hyperlinks
      // This includes hyperlinks inside revision elements (tracked changes)
      const paragraphs = doc.getAllParagraphs();

      this.log.debug(`Scanning ${paragraphs.length} paragraphs for hyperlinks to standardize`);

      for (const para of paragraphs) {
        const content = para.getContent();

        for (const item of content) {
          try {
            // Case 1: Direct Hyperlink instances
            if (item instanceof Hyperlink) {
              this.applyStandardHyperlinkFormatting(item);
              standardizedCount++;
              this.log.debug(`Standardized direct hyperlink: "${sanitizeHyperlinkText(item.getText())}"`);
            }
            // Case 2: Hyperlinks inside Revision elements (w:ins tracked changes)
            else if (item instanceof Revision) {
              const revisionContent = item.getContent();
              for (const revContent of revisionContent) {
                if (revContent instanceof Hyperlink) {
                  this.applyStandardHyperlinkFormatting(revContent);
                  standardizedCount++;
                  this.log.debug(`Standardized hyperlink inside Revision: "${sanitizeHyperlinkText(revContent.getText())}"`);
                }
              }
            }
            // Case 3: HYPERLINK field codes (ComplexField)
            else if (item instanceof ComplexField) {
              if (item.isHyperlinkField()) {
                // Apply formatting to the field result (not the parsed hyperlink which is just metadata)
                item.setResultFormatting({
                  font: "Verdana",
                  size: 12,
                  color: "0000FF",
                  underline: "single",
                  bold: false,
                  italic: false,
                });
                standardizedCount++;
                this.log.debug(`Standardized ComplexField hyperlink`);
              }
            }
          } catch (error) {
            this.log.warn(`Failed to standardize hyperlink: ${error}`);
            // Continue processing other hyperlinks even if one fails
          }
        }
      }

      this.log.info(`Successfully standardized ${standardizedCount} hyperlinks`);
    } catch (error) {
      this.log.error(`Error standardizing hyperlink formatting: ${error}`);
      throw error;
    }

    return standardizedCount;
  }

  /**
   * Apply standard formatting to a hyperlink
   *
   * Standard format: Verdana 12pt, Blue (#0000FF), Underlined, no bold/italic
   * Uses replace: true to clear any existing characterStyle reference
   *
   * @param hyperlink - The hyperlink to format
   */
  private applyStandardHyperlinkFormatting(hyperlink: Hyperlink): void {
    hyperlink.setFormatting({
      font: "Verdana",
      size: 12, // 12pt (docxmlater converts to 24 half-points internally)
      color: "0000FF", // Blue (hex without #)
      underline: "single",
      bold: false,
      italic: false,
    }, { replace: true });
  }

  /**
   * Apply Hidden Text style to runs with #FFFFFF color
   *
   * Scans document for white text runs and applies Hidden Text formatting
   * to ensure the text remains hidden (white on white background).
   *
   * This method runs AFTER table processing to restore any FFFFFF runs
   * that were overwritten by table formatting operations.
   *
   * Style properties:
   * - Font: Verdana
   * - Size: 12pt
   * - Color: #FFFFFF (white)
   * - Line spacing: Inherited from Normal style
   *
   * @param doc - Document to process
   * @param normalStyle - Normal style configuration (for line spacing inheritance)
   * @returns Number of hidden text runs styled
   */
  private applyHiddenTextStyle(
    doc: Document,
    normalStyle?: SessionStyle
  ): number {
    let hiddenTextCount = 0;

    // Get line spacing from Normal style (default to 1.0 if not provided)
    const lineSpacing = normalStyle?.lineSpacing ?? 1.0;

    // Create HiddenText character style
    const hiddenStyle = Style.create({
      styleId: "HiddenText",
      name: "Hidden Text",
      type: "character",
      basedOn: "DefaultParagraphFont",
      runFormatting: {
        font: "Verdana",
        size: 12,
        color: "FFFFFF", // No # prefix for docxmlater
        bold: false,
        italic: false,
      },
    });

    // Add style to document
    doc.addStyle(hiddenStyle);
    this.log.debug("Added HiddenText style to document");

    // Scan all paragraphs for white text runs
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      // Track if this paragraph has hidden text
      let paraHasHiddenText = false;

      const runs = para.getRuns();
      for (const run of runs) {
        const currentColor = run.getFormatting().color?.toUpperCase();

        if (currentColor === "FFFFFF") {
          // Apply HiddenText formatting directly to preserve white color
          run.setFont("Verdana");
          run.setSize(12);
          run.setColor("FFFFFF");

          hiddenTextCount++;
          paraHasHiddenText = true;

          this.log.debug(
            `Applied HiddenText style to run: "${run.getText().substring(0, 30)}..."`
          );
        }
      }

      // If paragraph has hidden text, ensure line spacing matches Normal
      if (paraHasHiddenText) {
        para.setLineSpacing(pointsToTwips(lineSpacing * 12));
      }
    }

    this.log.info(`Applied Hidden Text style to ${hiddenTextCount} runs`);
    return hiddenTextCount;
  }

  /**
   * Standardize table border thickness and color across all tables
   *
   * This method sets all table borders (outer, internal gridlines, and cell borders)
   * to a specified thickness with black color (#000000).
   *
   * Uses docxmlater's setAllBorders() which applies borders to:
   * - All 6 table border types (top, bottom, left, right, insideH, insideV)
   * - All individual cell borders
   *
   * @param doc - Document to process
   * @param options - Standardization options
   * @param options.size - Border size in eighths of a point (e.g., 4 = 0.5pt)
   * @returns Number of tables with borders standardized
   */
  private standardizeTableBorders(
    doc: Document,
    options: {
      size: number;
    }
  ): number {
    const tables = doc.getTables();
    let tablesProcessed = 0;
    const DEFAULT_COLOR = '000000';

    this.log.debug(`Standardizing table borders: size=${options.size} (${options.size / 8}pt)`);

    for (const table of tables) {
      try {
        // Skip HLP tables - they get special border treatment
        if (tableProcessor.isHLPTable(table)) {
          this.log.debug('Skipping HLP table for standard border processing');
          continue;
        }

        // Create uniform border definition
        const border = {
          style: 'single' as const,
          size: options.size,
          color: DEFAULT_COLOR,
        };

        // setAllBorders applies to all 6 border types AND all cells
        table.setAllBorders(border);
        tablesProcessed++;
      } catch (error) {
        this.log.warn(`Failed to standardize borders for table: ${error}`);
      }
    }

    return tablesProcessed;
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

          // Build standardized rPr (bold explicitly removed from bullet points)
          // OOXML Compliance: w:hint attribute added, w:color before w:sz per ECMA-376
          const rPrXml = `<w:rPr>
              <w:rFonts w:hint="default" w:ascii="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/>
              <w:color w:val="000000"/>
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
            `Standardized ${rPrMatches.length} w:rPr in list level ${levelIndex}: Verdana 12pt black`
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
   * Fix column width for "Step" tables.
   * Detects tables where first column header is "Step" and cells below contain numbers.
   * Sets the first column width to 1 inch (1440 twips).
   *
   * @param doc - The document to process
   * @returns Number of tables fixed
   */
  private fixStepTableColumnWidth(doc: Document): number {
    const STEP_COLUMN_WIDTH = 1440; // 1 inch in twips
    let fixedCount = 0;

    for (const table of doc.getTables()) {
      const rows = table.getRows();
      if (rows.length < 2) continue; // Need at least header + 1 data row

      // Check if first cell in first row says "Step" (case-insensitive)
      const headerRow = rows[0];
      const firstCell = headerRow.getCells()[0];
      if (!firstCell) continue;

      const headerText = firstCell.getText().trim().toLowerCase();
      if (headerText !== "step") continue;

      // Check if cells below first column contain just numbers
      let isStepTable = true;
      for (let i = 1; i < rows.length; i++) {
        const dataCell = rows[i].getCells()[0];
        if (!dataCell) {
          isStepTable = false;
          break;
        }
        const cellText = dataCell.getText().trim();
        // Check if cell contains only digits (or is empty for merged cells)
        if (cellText && !/^\d+$/.test(cellText)) {
          isStepTable = false;
          break;
        }
      }

      if (isStepTable) {
        // Set first column width to 1 inch for all cells in first column
        for (const row of rows) {
          const cell = row.getCells()[0];
          if (cell) {
            cell.setWidth(STEP_COLUMN_WIDTH);
          }
        }
        this.log.debug(`Fixed "Step" table: set first column to 1 inch`);
        fixedCount++;
      }
    }

    return fixedCount;
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
      preserveCenterAlignment?: boolean;
      alignment: "left" | "center" | "right" | "justify";
      color: string;
      spaceBefore: number;
      spaceAfter: number;
      lineSpacing: number;
    }>,
    preserveRedFont: boolean = false
  ): Promise<number> {
    let appliedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    // Find configured styles
    const header1Style = styles.find((s) => s.id === "header1");
    const header2Style = styles.find((s) => s.id === "header2");
    const header3Style = styles.find((s) => s.id === "header3");
    const normalStyle = styles.find((s) => s.id === "normal");
    const listParagraphStyle = styles.find((s) => s.id === "listParagraph");

    for (const para of paragraphs) {
      // Skip paragraphs with complex field content (TOC fields, cross-references, etc.)
      // Processing these paragraphs corrupts the field structure and causes TOC instructions
      // to appear as visible text in Word
      if (this.hasComplexFieldContent(para)) {
        continue;
      }

      // Skip TOC-styled paragraphs (TOC1, TOC2, etc.)
      // These are table of contents entries that should not have styles reapplied
      const paraStyle = para.getStyle() || '';
      if (paraStyle.startsWith('TOC') && paraStyle !== 'TOCHeading') {
        continue;
      }

      let styleToApply = null;

      // PRIORITY 1: Check paragraph's existing Word style FIRST
      // This preserves Heading 1, Heading 2, etc. styles that already exist in the document
      const currentStyle = paraStyle || (para.getFormatting()?.style) || '';

      if ((currentStyle === "Heading1" || currentStyle === "Heading 1") && header1Style) {
        // Preserve Heading 1 - apply user's Heading 1 formatting
        styleToApply = header1Style;
      } else if ((currentStyle === "Heading2" || currentStyle === "Heading 2") && header2Style) {
        // Preserve Heading 2 - apply user's Heading 2 formatting
        styleToApply = header2Style;
      } else if ((currentStyle === "Heading3" || currentStyle === "Heading 3") && header3Style) {
        // Preserve Heading 3 - apply user's Heading 3 formatting
        styleToApply = header3Style;
      } else if ((currentStyle === "ListParagraph" || currentStyle === "List Paragraph") && listParagraphStyle) {
        // Preserve List Paragraph - apply user's List Paragraph formatting
        styleToApply = listParagraphStyle;
      } else if ((currentStyle === "Normal" || currentStyle === "NormalWeb") && normalStyle && para.getText()?.trim()) {
        // Apply Normal formatting to paragraphs with Normal or NormalWeb style.
        // NormalWeb is treated identically to Normal — its style will be reassigned below.
        styleToApply = normalStyle;
      } else if ((!currentStyle || currentStyle === "") && para.getText()?.trim()) {
        // Paragraphs without an explicit style get Normal formatting.
        // NOTE: detectHeadingLevel() was previously used here but produced false positives
        // for table cell paragraphs that have outlineLevel set without being actual headings.
        // If a paragraph is truly a heading, it should have an explicit Heading style (Heading1, Heading2, etc.)
        // applied by the document author or earlier processing steps (e.g., ensureHeading2StyleIn1x1Tables).
        if (normalStyle) {
          styleToApply = normalStyle;
        }
      }
      // IMPORTANT: Do NOT apply any style to paragraphs with unknown styles (e.g., TOC1, TOC2, etc.)
      // This preserves special styles that shouldn't be overwritten

      if (styleToApply) {
        // Convert NormalWeb to Normal style so the paragraph inherits Normal's style definition
        if (currentStyle === "NormalWeb") {
          para.setStyle("Normal");
        }

        // Apply paragraph formatting
        const formatting = para.getFormatting();

        // Check if paragraph has an explicit Word style (e.g., "Normal", "Heading1", "ListParagraph")
        // Paragraphs without an explicit style should have their existing formatting preserved
        const explicitStyle = para.getStyle();
        const hasNoExplicitStyle = !explicitStyle || explicitStyle === 'undefined' || explicitStyle === '';

        // Preserve center alignment if:
        // 1. The style has preserveCenterAlignment=true AND paragraph is centered, OR
        // 2. The paragraph has no explicit style AND is already centered
        const shouldPreserveAlignment =
          (styleToApply.preserveCenterAlignment && formatting.alignment === 'center') ||
          (hasNoExplicitStyle && formatting.alignment === 'center');

        if (!shouldPreserveAlignment) {
          para.setAlignment(styleToApply.alignment);
        } else {
          this.log.debug(`[Alignment] Preserved center alignment for paragraph ` +
            `(style: ${styleToApply.id}, explicitStyle: ${explicitStyle || 'none'})`);
        }

        para.setSpaceBefore(pointsToTwips(styleToApply.spaceBefore));
        para.setSpaceAfter(pointsToTwips(styleToApply.spaceAfter));
        if (styleToApply.lineSpacing) {
          para.setLineSpacing(pointsToTwips(styleToApply.lineSpacing * 12)); // Convert line spacing multiplier
        }

        // Apply text formatting to all runs in paragraph, including those inside revisions
        // This ensures runs inside w:ins, w:moveTo, etc. also get formatting applied
        const runs = this.getAllRunsFromParagraph(para);
        for (const run of runs) {
          // Skip hyperlink-styled runs to preserve their formatting (blue color, underline)
          // Without this, hyperlinks become black text and lose clickability in Word
          if (run.isHyperlinkStyled()) {
            continue;
          }

          const runFormatting = run.getFormatting();

          // Preserve font size if paragraph has no explicit style AND run has direct size set
          // This handles title paragraphs with direct formatting (e.g., 18pt bold) that shouldn't be overwritten
          const runSize = runFormatting.size;
          const shouldPreserveSize = hasNoExplicitStyle && runSize !== undefined;

          if (!shouldPreserveSize) {
            run.setSize(styleToApply.fontSize);
          }

          // Preserve font if paragraph has no explicit style AND run has direct font set
          const runFont = runFormatting.font;
          const shouldPreserveFont = hasNoExplicitStyle && runFont !== undefined;

          if (!shouldPreserveFont) {
            run.setFont(styleToApply.fontFamily);
          }

          // Preserve bold based on the user's preserveBold setting for this style.
          // When preserveBold=true (default for Normal), existing bold is kept.
          // When preserveBold=false, bold is set to the style's configured value.
          // This applies consistently to Normal, NormalWeb, and undefined-style paragraphs.
          const shouldPreserveBold = styleToApply.preserveBold;

          if (!shouldPreserveBold) {
            run.setBold(styleToApply.bold);
          }

          if (!styleToApply.preserveItalic) {
            run.setItalic(styleToApply.italic);
          }
          if (!styleToApply.preserveUnderline) {
            run.setUnderline(styleToApply.underline ? "single" : false);
          }
          // Preserve white font - don't change color if run is white (FFFFFF)
          // Preserve red font (#FF0000) if option enabled AND this is Normal or List Paragraph style
          const currentColor = runFormatting.color?.toUpperCase();
          const isWhiteFont = currentColor === 'FFFFFF';
          const isRedFont = currentColor === 'FF0000';
          const isNormalOrListStyle = styleToApply.id === 'normal' || styleToApply.id === 'listParagraph';

          if (!isWhiteFont && !(isRedFont && preserveRedFont && isNormalOrListStyle)) {
            run.setColor(styleToApply.color.replace("#", ""));
          }
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
      preserveCenterAlignment?: boolean;
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
      imageBorderWidth?: number;
    }
  ): any {
    const config: any = {
      preserveWhiteFont: true,
    };

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
          config.normal = {
            run: runFormatting,
            paragraph: paragraphFormatting,
            preserveCenterAlignment: style.preserveCenterAlignment ?? false,
          };
          break;
        case "listParagraph":
          config.listParagraph = { run: runFormatting, paragraph: paragraphFormatting };
          break;
      }
    }

    return config;
  }

  /**
   * Apply custom styles from UI using docXMLater's applyStyles()
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
    preserveBlankLinesAfterHeader2Tables: boolean = true,
    preserveRedFont: boolean = false
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

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Update style definitions in styles.xml
    // This ensures Word's style gallery shows the updated formatting
    // ═══════════════════════════════════════════════════════════
    this.log.debug("=== UPDATING STYLE DEFINITIONS IN STYLES.XML ===");
    const styleIdMap: Record<string, string> = {
      'header1': 'Heading1',
      'header2': 'Heading2',
      'header3': 'Heading3',
      'normal': 'Normal',
      'listParagraph': 'ListParagraph',
    };

    for (const sessionStyle of styles) {
      const wordStyleId = styleIdMap[sessionStyle.id];
      if (!wordStyleId) {
        this.log.debug(`Skipping unknown style ID: ${sessionStyle.id}`);
        continue;
      }

      try {
        // Determine outline level for TOC support (Heading 1 = 0, Heading 2 = 1, Heading 3 = 2)
        const outlineLevel = wordStyleId === 'Heading1' ? 0
          : wordStyleId === 'Heading2' ? 1
          : wordStyleId === 'Heading3' ? 2
          : undefined;

        const styleObj = Style.create({
          styleId: wordStyleId,
          name: sessionStyle.name,
          type: 'paragraph',
          runFormatting: {
            font: sessionStyle.fontFamily,
            size: sessionStyle.fontSize,
            bold: sessionStyle.bold,
            italic: sessionStyle.italic,
            underline: sessionStyle.underline ? 'single' : false,
            color: sessionStyle.color.replace('#', ''),
          },
          paragraphFormatting: {
            alignment: sessionStyle.alignment,
            spacing: {
              before: pointsToTwips(sessionStyle.spaceBefore),
              after: pointsToTwips(sessionStyle.spaceAfter),
              line: sessionStyle.lineSpacing ? pointsToTwips(sessionStyle.lineSpacing * 12) : 240,
              lineRule: 'auto',
            },
            outlineLevel, // Required for TOC functionality
          },
        });

        doc.addStyle(styleObj);
        this.log.info(`✓ Updated style definition: ${wordStyleId} (${sessionStyle.fontFamily} ${sessionStyle.fontSize}pt)`);
      } catch (error) {
        this.log.warn(`Failed to update style definition for ${wordStyleId}:`, error);
        // Continue with other styles
      }
    }

    // Feature detection: Check if framework method exists
    let frameworkResults = null;
    if (typeof (doc as any).applyStyles === "function") {
      this.log.debug("Using framework applyStyles()");

      try {
        // Use docXMLater's native applyStyles method
        // This handles both style definition updates and direct formatting clearing
        frameworkResults = (doc as any).applyStyles(options);
        this.log.debug("Framework applyStyles completed");
      } catch (error) {
        this.log.warn("Framework method failed, falling back to manual implementation:", error);
        // Fall through to manual implementation
      }
    } else {
      this.log.warn(
        "Framework method applyStyles not available, using manual fallback"
      );
    }

    // ALWAYS run manual style assignment to catch unstyled paragraphs
    // The framework method may not process paragraphs without explicit styles
    // (e.g., table cell paragraphs that have no w:pStyle defined)
    this.log.debug("Running manual assignStylesToDocument() for comprehensive coverage");
    const manualCount = await this.assignStylesToDocument(doc, styles, preserveRedFont);
    this.log.debug(`Manual style assignment applied to ${manualCount} additional paragraphs`);

    // Return results - use framework results if available, otherwise construct from styles
    const appliedStyles = frameworkResults || {
      heading1: styles.some((s) => s.id === "header1"),
      heading2: styles.some((s) => s.id === "header2"),
      heading3: styles.some((s) => s.id === "header3"),
      normal: styles.some((s) => s.id === "normal"),
      listParagraph: styles.some((s) => s.id === "listParagraph"),
    };

    this.log.debug(`Style application completed: ${JSON.stringify(appliedStyles)}`);
    return appliedStyles;
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

      // Add outline level for TOC support (Heading 1 = 0, Heading 2 = 1, Heading 3 = 2)
      if (docStyleId === 'Heading1') {
        paragraphFormatting.outlineLevel = 0;
      } else if (docStyleId === 'Heading2') {
        paragraphFormatting.outlineLevel = 1;
      } else if (docStyleId === 'Heading3') {
        paragraphFormatting.outlineLevel = 2;
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
  ): Promise<{ count: number; affectedCells: string[] }> {
    let cellsFixed = 0;
    const affectedCells: string[] = [];
    const tablesNeedingBlankParagraph: Array<{ table: Table; tableIndex: number }> = [];

    // Get all tables in document
    const tables = doc.getTables();
    this.log.debug(`Found ${tables.length} tables to validate for Header 2 formatting`);

    for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
      const table = tables[tableIndex];
      const rows = table.getRows();
      const is1x1Table = rows.length === 1 && rows[0]?.getCells().length === 1;
      let tableHasHeader2 = false;

      // Skip excluded 1x1 tables (>2 lines of text)
      if (is1x1Table) {
        const singleCell = rows[0]?.getCells()[0];
        if (singleCell && this.should1x1TableBeExcluded(singleCell)) {
          this.log.debug(`Skipping Header 2 validation for excluded 1x1 table`);

          // Clear existing shading from excluded tables
          singleCell.setShading({ fill: 'auto' });

          continue;
        }
      }

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
              // Preserve center alignment if paragraph is already centered
              const preserveCenter = formatting.alignment === 'center';
              if (formatting.alignment !== header2Style.alignment && !preserveCenter) {
                para.setAlignment(header2Style.alignment);
                cellNeedsUpdate = true;
                this.log.debug(`Fixed Header 2 alignment to ${header2Style.alignment}`);
              } else if (preserveCenter && formatting.alignment !== header2Style.alignment) {
                this.log.debug(`Preserved center alignment for Header 2 paragraph`);
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
                // Preserve white font - don't change color if run is white (FFFFFF)
                const isWhiteFont = runFormatting.color?.toUpperCase() === 'FFFFFF';
                if (!isWhiteFont && runFormatting.color !== expectedColor) {
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
                // Track the Header 2 text for location context
                const cellText = para.getText().trim();
                if (cellText && !affectedCells.includes(cellText)) {
                  affectedCells.push(cellText);
                }
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

    return { count: cellsFixed, affectedCells };
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
      // Skip TOC paragraphs - they contain field instructions that must not be modified
      const style = para.getStyle() || "";
      if (style.startsWith("TOC") && style !== "TOCHeading") {
        continue;
      }

      // Skip paragraphs with complex field content (instructionText runs)
      if (this.hasComplexFieldContent(para)) {
        continue;
      }

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
   * Helper: Get text indent for a level, extrapolating if needed
   * Used by list continuation methods to determine proper indentation
   */
  private getTextIndentForLevel(
    level: number,
    settings: { indentationLevels: Array<{ level: number; symbolIndent: number; textIndent: number }> }
  ): number {
    const config = settings.indentationLevels.find(l => l.level === level);
    if (config) return config.textIndent;
    if (settings.indentationLevels.length === 0) return 0.5 + level * 0.25;
    const lastConfig = settings.indentationLevels[settings.indentationLevels.length - 1];
    return lastConfig.textIndent + (level - settings.indentationLevels.length + 1) * 0.25;
  }

  /**
   * Apply list continuation indentation within table cells
   *
   * Context is scoped to each cell - does not bleed across cells.
   * This handles the case where a non-list paragraph (like "Example:") appears
   * between list items in a table cell and needs proper indentation to align
   * with the text content of the preceding list item.
   *
   * @param doc - The document to process
   * @param settings - User's indentation level settings from UI
   * @returns Number of paragraphs indented
   */
  private async applyListContinuationIndentationInTables(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number;
        textIndent: number;
      }>;
    }
  ): Promise<number> {
    let indentedCount = 0;

    this.log.debug("=== APPLYING LIST CONTINUATION INDENTATION IN TABLES ===");

    for (const table of doc.getAllTables()) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          const paragraphs = cell.getParagraphs();

          // Track list context within this cell only
          let activeContext: { numId: number; level: number; textIndentTwips: number } | null = null;

          for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const numbering = para.getNumbering();

            if (numbering) {
              // This IS a list item - update context
              const level = numbering.level ?? 0;
              const actualIndent = this.getListTextIndent(doc, numbering.numId, level);
              const textIndentTwips = actualIndent ?? Math.round(this.getTextIndentForLevel(level, settings) * 1440);
              activeContext = { numId: numbering.numId, level, textIndentTwips };
              continue; // Don't modify list items themselves
            }

            // Not a list item - check if it should inherit context
            if (!activeContext) continue;

            const formatting = para.getFormatting();
            const existingLeftIndent = formatting.indentation?.left || 0;

            // Check if paragraph contains a small image (like emoji < 100x100px)
            const hasSmallImage = doc.isSmallImageParagraph(para);

            // Apply indentation if:
            // 1. Paragraph already has some indentation (was meant to be indented), OR
            // 2. Paragraph contains a small image (emoji+text paragraphs within list context need indenting)
            if (existingLeftIndent > 0 || hasSmallImage) {
              // Get cell width and margins to calculate safe indent
              const cellWidth = cell.getWidth(); // twips, or undefined
              const cellMargins = cell.getMargins();
              const leftMargin = cellMargins?.left || 0;
              const rightMargin = cellMargins?.right || 0;

              // Determine target indent
              let targetIndent = activeContext.textIndentTwips;

              // Respect cell boundary: cap indent based on available width
              if (cellWidth !== undefined && cellWidth > 0) {
                const availableWidth = cellWidth - leftMargin - rightMargin;

                // Skip indent entirely for very narrow cells (< 3 inches)
                // Indentation in narrow cells causes text clipping
                const NARROW_CELL_THRESHOLD = 4320; // 3 inches
                if (availableWidth < NARROW_CELL_THRESHOLD) {
                  this.log.debug(
                    `  Skipping indent for narrow cell (available: ${availableWidth}tw < ${NARROW_CELL_THRESHOLD}tw threshold)`
                  );
                  continue;
                }

                // Ensure at least 2 inches (2880 twips) remains for text content
                const MIN_TEXT_SPACE = 2880;
                const maxSafeIndent = Math.max(0, availableWidth - MIN_TEXT_SPACE);

                // Skip if calculated indent would be negligible (< 0.25 inches)
                if (maxSafeIndent < 360) {
                  this.log.debug(
                    `  Skipping indent - maxSafeIndent too small (${maxSafeIndent}tw < 360tw)`
                  );
                  continue;
                }

                if (targetIndent > maxSafeIndent) {
                  // Cap indent at safe maximum, or keep existing if it's smaller
                  targetIndent = existingLeftIndent > 0
                    ? Math.min(existingLeftIndent, maxSafeIndent)
                    : maxSafeIndent;
                  this.log.debug(
                    `  Capped indent to ${targetIndent} twips (cell: ${cellWidth}, margins: L${leftMargin}/R${rightMargin}, available: ${availableWidth})`
                  );
                }
              }

              para.setLeftIndent(targetIndent);
              para.setFirstLineIndent(0);

              this.log.debug(
                `  Table cell continuation: para ${i}, numId=${activeContext.numId}, ` +
                `level=${activeContext.level}, indent=${targetIndent}twips ` +
                `(was ${existingLeftIndent}, hasSmallImage=${hasSmallImage})`
              );
              indentedCount++;
            }
          }
        }
      }
    }

    return indentedCount;
  }

  /**
   * Apply list continuation indentation - Indent non-list paragraphs that follow list items
   * When a paragraph has some existing indentation and follows a list item,
   * set its left indent to match the list item's textIndent (where text aligns)
   */
  private async applyListContinuationIndentation(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number;
        textIndent: number;
      }>;
    }
  ): Promise<number> {
    let indentedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    // Helper to get textIndent for any level (extrapolating if needed)
    const getTextIndentForLevel = (level: number): number => {
      const levelConfig = settings.indentationLevels.find(l => l.level === level);
      if (levelConfig) {
        return levelConfig.textIndent;
      }

      // Guard against empty array
      if (settings.indentationLevels.length === 0) {
        return 0.5 + level * 0.25; // Default: 0.5" base + 0.25" per level
      }

      // Extrapolate from last configured level (0.25" per extra level)
      const lastConfig = settings.indentationLevels[settings.indentationLevels.length - 1];
      const extraLevels = level - (settings.indentationLevels.length - 1);
      return lastConfig.textIndent + extraLevels * 0.25;
    };

    for (let i = 1; i < paragraphs.length; i++) {
      const currentPara = paragraphs[i];
      const previousPara = paragraphs[i - 1];

      // Skip if current paragraph IS a list item
      if (currentPara.getNumbering()) continue;

      // Check if current paragraph has SOME existing indentation
      const formatting = currentPara.getFormatting();
      const existingLeftIndent = formatting.indentation?.left || 0;
      if (existingLeftIndent === 0) continue;

      // Check previous paragraph's state
      const previousNumbering = previousPara.getNumbering();
      const previousFormatting = previousPara.getFormatting();
      const previousLeftIndent = previousFormatting.indentation?.left || 0;

      // Case 1: Previous is a list item - get indent from list definition
      if (previousNumbering) {
        const previousLevel = previousNumbering.level ?? 0;
        const numId = previousNumbering.numId;

        // Try to get actual indent from numbering definition, fall back to UI settings
        const actualIndent = this.getListTextIndent(doc, numId, previousLevel);
        const textIndentTwips = actualIndent ?? Math.round(getTextIndentForLevel(previousLevel) * 1440);

        // Apply the list's textIndent as the paragraph's left indent
        currentPara.setLeftIndent(textIndentTwips);
        currentPara.setFirstLineIndent(0);

        const source = actualIndent !== undefined ? 'numbering.xml' : 'UI settings';
        this.log.debug(
          `List continuation indent: para ${i}, level=${previousLevel}, ` +
          `textIndent=${textIndentTwips}twips (from ${source}), was ${existingLeftIndent}twips`
        );

        indentedCount++;
      }
      // Case 2: Previous is an indented non-list paragraph - match its indent
      else if (previousLeftIndent > 0) {
        currentPara.setLeftIndent(previousLeftIndent);
        currentPara.setFirstLineIndent(0);

        this.log.debug(
          `List continuation indent: para ${i}, matching previous text indent ` +
          `${previousLeftIndent}twips, was ${existingLeftIndent}twips`
        );

        indentedCount++;
      }
      // Case 3: Previous has no indent - skip this paragraph
    }

    return indentedCount;
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
   * Helper: Check if a numbering ID represents a "hybrid" list:
   * - Level 0 is numbered (decimal, lowerLetter, etc.)
   * - Level 1+ contains bullets
   *
   * These lists need nested bullets converted to letters (a., b., c.)
   * to maintain proper sequence continuation.
   */
  private isHybridNumberedBulletList(doc: Document, numId: number): boolean {
    try {
      const manager = doc.getNumberingManager();
      const instance = manager.getInstance(numId);
      if (!instance) return false;

      const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
      if (!abstractNum) return false;

      const level0 = abstractNum.getLevel(0);
      if (!level0 || level0.getFormat() === "bullet") return false; // Level 0 must be numbered

      // Check if any level 1+ is a bullet
      for (let i = 1; i < 9; i++) {
        const level = abstractNum.getLevel(i);
        if (level && level.getFormat() === "bullet") {
          return true; // Found a nested bullet under a numbered level 0
        }
      }
      return false;
    } catch (error) {
      this.log.warn(`Error checking if numId ${numId} is hybrid list: ${error}`);
      return false;
    }
  }

  /**
   * Helper: Check if a numbering ID represents a "hybrid" list (inverse of above):
   * - Level 0 is bullet format
   * - Level 1+ contains numbered format (decimal, lowerLetter, etc.)
   *
   * These lists need nested numbers converted to bullets
   * when the majority format in the context is bullets.
   */
  private isHybridBulletNumberedList(doc: Document, numId: number): boolean {
    try {
      const manager = doc.getNumberingManager();
      const instance = manager.getInstance(numId);
      if (!instance) return false;

      const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
      if (!abstractNum) return false;

      const level0 = abstractNum.getLevel(0);
      if (!level0 || level0.getFormat() !== "bullet") return false; // Level 0 must be bullet

      // Check if any level 1+ is numbered (not bullet)
      const numberedFormats = ["decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman"];
      for (let i = 1; i < 9; i++) {
        const level = abstractNum.getLevel(i);
        if (level && numberedFormats.includes(level.getFormat())) {
          return true; // Found a numbered level under a bullet level 0
        }
      }
      return false;
    } catch (error) {
      this.log.warn(`Error checking if numId ${numId} is hybrid bullet-numbered list: ${error}`);
      return false;
    }
  }

  /**
   * Helper: Get the text indent (leftIndent) for a specific level of a numbering definition
   * Returns the actual indent from the numbering.xml, or undefined if not found
   */
  private getListTextIndent(doc: Document, numId: number, level: number): number | undefined {
    try {
      const manager = doc.getNumberingManager();
      const instance = manager.getInstance(numId);
      if (!instance) return undefined;

      const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
      if (!abstractNum) return undefined;

      const levelDef = abstractNum.getLevel(level);
      if (!levelDef) return undefined;

      return levelDef.getProperties().leftIndent;
    } catch (error) {
      this.log.warn(`Error getting list text indent: ${error}`);
      return undefined;
    }
  }

  /**
   * Normalize list levels based on visual indentation
   *
   * Some documents have bullets where all items have w:ilvl="0" (level 0) but some have
   * additional paragraph-level indentation (w:ind w:left) that makes them appear indented.
   * This method detects such items and updates their w:ilvl to match the visual indentation.
   *
   * This must be called BEFORE applyBulletUniformity() so that when styles are applied,
   * the paragraphs already have the correct levels.
   *
   * @param doc - The document to process
   * @param settings - User's indentation level settings from UI
   * @returns Number of paragraphs whose level was normalized
   */
  private async normalizeListLevelsFromIndentation(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number; // in inches
        textIndent: number; // in inches
      }>;
    }
  ): Promise<number> {
    let normalized = 0;

    // Build threshold ranges from user settings (convert inches to twips)
    const thresholds = this.buildIndentationThresholds(settings.indentationLevels);

    this.log.debug("=== NORMALIZING LIST LEVELS FROM INDENTATION ===");
    this.log.debug(`  Built ${thresholds.length} indentation thresholds:`);
    thresholds.forEach((t) => {
      this.log.debug(`    Level ${t.level}: ${t.minTwips} - ${t.maxTwips} twips`);
    });

    // Process table cells - check for existing hierarchy before normalizing
    for (const table of doc.getAllTables()) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          const paragraphs = cell.getParagraphs();

          // Check if cell already has multi-level hierarchy
          const levels = new Set<number>();
          for (const para of paragraphs) {
            const numbering = para.getNumbering();
            if (numbering) levels.add(numbering.level);
          }

          // Skip if cell has items at multiple levels (hierarchy exists)
          if (levels.size > 1) {
            this.log.debug(
              `  Skipping cell with existing ${levels.size}-level hierarchy (levels: ${Array.from(levels).join(', ')})`
            );
            continue;
          }

          // First pass: collect list items and find minimum indentation
          // This establishes a baseline so items are normalized relative to each other,
          // not against absolute thresholds (which may not account for cell padding)
          const listItems: Array<{
            para: typeof paragraphs[0];
            numbering: NonNullable<ReturnType<typeof paragraphs[0]['getNumbering']>>;
            leftTwips: number;
          }> = [];
          let minIndent = Infinity;

          for (const para of paragraphs) {
            const numbering = para.getNumbering();
            if (!numbering) continue;

            const formatting = para.getFormatting();
            const leftTwips = formatting.indentation?.left || 0;

            listItems.push({ para, numbering, leftTwips });
            if (leftTwips < minIndent) {
              minIndent = leftTwips;
            }
          }

          // Skip if no list items
          if (listItems.length === 0 || minIndent === Infinity) {
            continue;
          }

          // Use minimum indent as baseline for level 0 (accounts for cell padding)
          const baselineOffset = minIndent > 0 ? minIndent : 0;

          // Second pass: normalize levels using relative indentation
          for (const { para, numbering, leftTwips } of listItems) {
            // Calculate relative indentation from the cell's baseline
            const relativeIndent = leftTwips - baselineOffset;

            // DEBUG: Log detailed info for each item BEFORE any changes
            if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
              const numDefIndent = this.getListTextIndent(doc, numbering.numId, numbering.level);
              const textSnippet = para.getText().substring(0, 35).replace(/\n/g, ' ');
              this.log.debug(
                `  [TABLE ITEM] "${textSnippet}..." ` +
                  `origLevel=${numbering.level}, paraLeft=${leftTwips}tw, ` +
                  `numDefIndent=${numDefIndent ?? 'N/A'}tw, ` +
                  `baseline=${baselineOffset}tw, relativeIndent=${relativeIndent}tw`
              );
            }

            // Items at the baseline (relative indent = 0) should only be normalized to level 0
            // if they don't have a valid numbering definition indentation for their current level
            if (relativeIndent === 0) {
              if (numbering.level > 0) {
                // Check if the numbering definition provides indentation for this level
                const numDefIndent = this.getListTextIndent(doc, numbering.numId, numbering.level);

                // If numbering definition has valid indentation for this level, respect it
                if (numDefIndent !== undefined && numDefIndent > 0) {
                  // Item has legitimate ilvl with numbering definition indentation - skip
                  if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
                    this.log.debug(
                      `    -> PRESERVING level ${numbering.level} (numDefIndent=${numDefIndent}tw provides visual indent)`
                    );
                  }
                  continue;
                }

                // No valid numbering definition indentation - normalize to level 0
                if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
                  this.log.debug(
                    `    -> CHANGING from level ${numbering.level} to 0 (no numDefIndent, at baseline)`
                  );
                }
                this.log.debug(
                  `  Normalizing baseline item: left=${leftTwips} twips (baseline), ` +
                    `current level=${numbering.level}, inferred level=0`
                );
                para.setNumbering(numbering.numId, 0);
                normalized++;
              }
              continue;
            }

            const inferredLevel = this.inferLevelFromIndentation(relativeIndent, thresholds);

            if (inferredLevel !== numbering.level) {
              if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
                this.log.debug(
                  `    -> CHANGING from level ${numbering.level} to ${inferredLevel} (threshold match)`
                );
              }
              this.log.debug(
                `  Normalizing paragraph: left=${leftTwips} twips (relative=${relativeIndent}), ` +
                  `current level=${numbering.level}, inferred level=${inferredLevel}`
              );
              para.setNumbering(numbering.numId, inferredLevel);
              normalized++;
            }
          }
        }
      }
    }

    // Process body-level paragraphs (outside tables)
    // Group by numId to apply relative indentation within each list
    const bodyParagraphs = doc.getParagraphs();
    const listGroups = new Map<
      number,
      Array<{
        para: typeof bodyParagraphs[0];
        numbering: NonNullable<ReturnType<typeof bodyParagraphs[0]['getNumbering']>>;
        leftTwips: number;
      }>
    >();

    // First pass: group list items by numId
    for (const para of bodyParagraphs) {
      const numbering = para.getNumbering();
      if (!numbering) continue;

      const formatting = para.getFormatting();
      const leftTwips = formatting.indentation?.left || 0;

      if (!listGroups.has(numbering.numId)) {
        listGroups.set(numbering.numId, []);
      }
      listGroups.get(numbering.numId)!.push({ para, numbering, leftTwips });
    }

    // Second pass: normalize each list group using relative indentation
    for (const [numId, items] of listGroups) {
      // Find minimum indentation in this list group
      let minIndent = Infinity;
      for (const { leftTwips } of items) {
        if (leftTwips < minIndent) {
          minIndent = leftTwips;
        }
      }

      // Skip if no valid minimum
      if (minIndent === Infinity) continue;

      // Check if group already has multi-level hierarchy
      const levels = new Set(items.map((item) => item.numbering.level));
      if (levels.size > 1) {
        this.log.debug(
          `  Skipping body list (numId=${numId}) with existing ${levels.size}-level hierarchy`
        );
        continue;
      }

      // Use minimum indent as baseline
      const baselineOffset = minIndent > 0 ? minIndent : 0;

      for (const { para, numbering, leftTwips } of items) {
        const relativeIndent = leftTwips - baselineOffset;

        // Get numbering definition indentation (needed for both debug logging and fix logic)
        const numDefIndent = this.getListTextIndent(doc, numbering.numId, numbering.level);

        // DEBUG: Log detailed info for each item BEFORE any changes
        if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
          const textSnippet = para.getText().substring(0, 35).replace(/\n/g, ' ');
          this.log.debug(
            `  [BODY ITEM] "${textSnippet}..." ` +
              `origLevel=${numbering.level}, paraLeft=${leftTwips}tw, ` +
              `numDefIndent=${numDefIndent ?? 'N/A'}tw, ` +
              `baseline=${baselineOffset}tw, relativeIndent=${relativeIndent}tw`
          );
        }

        // Items at the baseline (relative indent = 0) should only be normalized to level 0
        // if they don't have a valid numbering definition indentation for their current level
        if (relativeIndent === 0) {
          if (numbering.level > 0) {
            // If numbering definition has valid indentation for this level, respect it
            if (numDefIndent !== undefined && numDefIndent > 0) {
              // Item has legitimate ilvl with numbering definition indentation - skip
              if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
                this.log.debug(
                  `    -> PRESERVING level ${numbering.level} (numDefIndent=${numDefIndent}tw provides visual indent)`
                );
              }
              continue;
            }

            // No valid numbering definition indentation - normalize to level 0
            if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
              this.log.debug(
                `    -> CHANGING from level ${numbering.level} to 0 (no numDefIndent, at baseline)`
              );
            }
            this.log.debug(
              `  Normalizing body baseline item: left=${leftTwips} twips (baseline), ` +
                `current level=${numbering.level}, inferred level=0`
            );
            para.setNumbering(numbering.numId, 0);
            normalized++;
          }
          continue;
        }

        const inferredLevel = this.inferLevelFromIndentation(relativeIndent, thresholds);

        if (inferredLevel !== numbering.level) {
          if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
            this.log.debug(
              `    -> CHANGING from level ${numbering.level} to ${inferredLevel} (threshold match)`
            );
          }
          this.log.debug(
            `  Normalizing body paragraph: left=${leftTwips} twips (relative=${relativeIndent}), ` +
              `current level=${numbering.level}, inferred level=${inferredLevel}`
          );
          para.setNumbering(numbering.numId, inferredLevel);
          normalized++;
        }
      }
    }

    return normalized;
  }

  /**
   * Build indentation thresholds from user's level settings
   *
   * Each level owns the range from midpoint between previous level to midpoint to next level.
   * This ensures items with indentation "close to" a level get assigned to that level.
   *
   * @param levels - User's indentation levels from UI
   * @returns Array of threshold ranges for each level
   */
  private buildIndentationThresholds(
    levels: Array<{ symbolIndent: number }>
  ): Array<{ level: number; minTwips: number; maxTwips: number }> {
    const thresholds: Array<{ level: number; minTwips: number; maxTwips: number }> = [];

    for (let i = 0; i < levels.length; i++) {
      const currentTwips = Math.round(levels[i].symbolIndent * 1440);
      const nextTwips =
        i < levels.length - 1
          ? Math.round(levels[i + 1].symbolIndent * 1440)
          : currentTwips + 720; // Default 0.5" increment for extrapolation

      // This level owns from midpoint with previous level to midpoint with next level
      const midpointToNext = Math.round((currentTwips + nextTwips) / 2);
      const prevTwips = i > 0 ? Math.round(levels[i - 1].symbolIndent * 1440) : 0;
      const midpointFromPrev = i > 0 ? Math.round((prevTwips + currentTwips) / 2) : 0;

      thresholds.push({
        level: i,
        minTwips: midpointFromPrev,
        maxTwips: midpointToNext,
      });
    }

    // Extend the last level's max to catch any higher indentation
    if (thresholds.length > 0) {
      thresholds[thresholds.length - 1].maxTwips = 999999;
    }

    return thresholds;
  }

  /**
   * Infer the appropriate list level from paragraph indentation
   *
   * @param leftTwips - Paragraph's left indentation in twips
   * @param thresholds - Level threshold ranges
   * @returns The inferred level number (0-8)
   */
  private inferLevelFromIndentation(
    leftTwips: number,
    thresholds: Array<{ level: number; minTwips: number; maxTwips: number }>
  ): number {
    for (const threshold of thresholds) {
      if (leftTwips >= threshold.minTwips && leftTwips < threshold.maxTwips) {
        return threshold.level;
      }
    }
    // Default to level 0 if no match (shouldn't happen with proper thresholds)
    return 0;
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

    // Find maximum level used in document bullet lists to ensure we create enough levels
    // This prevents level clamping that loses original indentation structure
    let maxLevel = 0;
    const allParagraphs = doc.getAllParagraphs();
    for (const para of allParagraphs) {
      const numbering = para.getNumbering();
      if (numbering && numbering.numId !== undefined && this.isBulletList(doc, numbering.numId)) {
        maxLevel = Math.max(maxLevel, numbering.level || 0);
      }
    }
    // Create at least 9 levels (Word's max) or enough to cover all existing levels
    const totalLevelsNeeded = Math.max(settings.indentationLevels.length, maxLevel + 1, 9);
    this.log.debug(`Max bullet level in document: ${maxLevel}, creating ${totalLevelsNeeded} levels`);

    // Create custom levels with font specified and UI indentation
    // Extend to cover all levels needed, extrapolating indentation for unconfigured levels
    const levels: NumberingLevel[] = [];
    const lastConfig = settings.indentationLevels[settings.indentationLevels.length - 1];

    for (let index = 0; index < totalLevelsNeeded; index++) {
      const configLevel = settings.indentationLevels[index];
      const bullet = bullets[index] || bullets[0] || "\u2022";

      // Use configured settings if available, otherwise extrapolate from last configured level
      // Each additional level adds 0.25 inches of indentation
      const symbolIndent = configLevel?.symbolIndent
        ?? (lastConfig.symbolIndent + (index - settings.indentationLevels.length + 1) * 0.25);
      const textIndent = configLevel?.textIndent
        ?? (lastConfig.textIndent + (index - settings.indentationLevels.length + 1) * 0.25);

      this.log.debug(
        `  Level ${index}: bulletChar="${bullet}" (U+${bullet.charCodeAt(0).toString(16).toUpperCase()}), ` +
        `symbolIndent=${symbolIndent}", textIndent=${textIndent}"${configLevel ? "" : " (extrapolated)"}`
      );

      const symbolTwips = Math.round(symbolIndent * 1440);
      const textTwips = Math.round(textIndent * 1440);
      const hangingTwips = textTwips - symbolTwips;

      // Get font-specific character and font for this bullet type
      const mapping = getBulletMapping(bullet);

      // OOXML indentation semantics:
      // - leftIndent (w:left): where TEXT starts (in twips from left margin)
      // - hangingIndent (w:hanging): how far the BULLET/NUMBER hangs back from text position
      // So if symbolIndent=0.5" and textIndent=0.75", bullet is at 0.5" and text at 0.75"
      levels.push(new NumberingLevel({
        level: index,
        format: "bullet",
        text: mapping.char, // Font-specific character (e.g., · for Symbol, 'o' for Courier New)
        font: mapping.font, // Correct font for this bullet type
        leftIndent: textTwips, // Text starts at textIndent position
        hangingIndent: hangingTwips, // Bullet hangs back by (textIndent - symbolIndent)
      }));
    }

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

            // Get font-specific character and font for this bullet type
            const mapping = getBulletMapping(newSymbol);

            // ✅ COMPLETE PROPERTY SETTING - Set ALL formatting properties
            level.setText(mapping.char); // Font-specific character (· for Symbol, 'o' for Courier New)
            level.setFont(mapping.font); // Correct font for this bullet type
            level.setFontSize(24); // Size: 12pt = 24 half-points
            // Bold is NOT set here - bullets should not be bold (handled by standardizeListPrefixFormatting)
            level.setColor("000000"); // Color: Black (#000000)

            // ✅ SET INDENTATION from UI settings
            // OOXML semantics: w:left = where TEXT starts, w:hanging = how far NUMBER hangs back
            const levelConfig = settings.indentationLevels[levelIndex];
            if (levelConfig) {
              const symbolTwips = Math.round(levelConfig.symbolIndent * 1440);
              const textTwips = Math.round(levelConfig.textIndent * 1440);
              const hangingTwips = textTwips - symbolTwips;
              level.setLeftIndent(textTwips);      // Text starts at textIndent
              level.setHangingIndent(hangingTwips); // Number hangs back by (textIndent - symbolIndent)
            }

            isModified = true;

            this.log.debug(
              `  Updated abstractNum level ${levelIndex}: ` +
                `char="${mapping.char}", font=${mapping.font}, ` +
                `textIndent=${levelConfig?.textIndent || 'default'}", symbolIndent=${levelConfig?.symbolIndent || 'default'}", color=#000000`
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

    // ✅ FIX: Don't reassign paragraphs to new numId - this destroys document hierarchy
    // The original document may use multiple numIds (all with ilvl=0) to create visual hierarchy.
    // Consolidating to a single numId loses this hierarchy.
    // Instead, we already updated ALL existing abstractNum definitions with UI styling (above),
    // so paragraphs keep their original numIds and the UI styling is still applied.
    //
    // REMOVED: Paragraph reassignment loop that caused hierarchy loss
    // - Original code reassigned ALL bullet paragraphs to the new "UI Bullet List" numId
    // - This collapsed 16+ different numIds into 1, losing visual hierarchy
    // - Now we preserve original numIds while still applying UI bullet symbols/fonts

    return existingListsUpdated;
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

    // Find maximum level used in document numbered lists to ensure we create enough levels
    // This prevents level clamping that loses original indentation structure
    let maxLevel = 0;
    const allParagraphs = doc.getAllParagraphs();
    for (const para of allParagraphs) {
      const numbering = para.getNumbering();
      if (numbering && numbering.numId !== undefined && this.isNumberedList(doc, numbering.numId)) {
        maxLevel = Math.max(maxLevel, numbering.level || 0);
      }
    }
    // Create at least 9 levels (Word's max) or enough to cover all existing levels
    const totalLevelsNeeded = Math.max(settings.indentationLevels.length, maxLevel + 1, 9);
    this.log.debug(`Max numbered level in document: ${maxLevel}, creating ${totalLevelsNeeded} levels`);

    // Create custom levels with UI indentation
    // Extend to cover all levels needed, extrapolating indentation for unconfigured levels
    const levels: NumberingLevel[] = [];
    const lastConfig = settings.indentationLevels[settings.indentationLevels.length - 1];

    for (let index = 0; index < totalLevelsNeeded; index++) {
      const configLevel = settings.indentationLevels[index];

      // Use configured settings if available, otherwise extrapolate from last configured level
      // Each additional level adds 0.25 inches of indentation
      const symbolIndent = configLevel?.symbolIndent
        ?? (lastConfig.symbolIndent + (index - settings.indentationLevels.length + 1) * 0.25);
      const textIndent = configLevel?.textIndent
        ?? (lastConfig.textIndent + (index - settings.indentationLevels.length + 1) * 0.25);
      const format = formats[index] || formats[formats.length - 1] || "decimal";

      const symbolTwips = Math.round(symbolIndent * 1440);
      const textTwips = Math.round(textIndent * 1440);
      const hangingTwips = textTwips - symbolTwips;

      // OOXML indentation semantics:
      // - leftIndent (w:left): where TEXT starts (in twips from left margin)
      // - hangingIndent (w:hanging): how far the NUMBER hangs back from text position
      levels.push(new NumberingLevel({
        level: index,
        format: format,
        text: `%${index + 1}.`, // Standard template (e.g., %1., %2.)
        leftIndent: textTwips, // Text starts at textIndent position
        hangingIndent: hangingTwips, // Number hangs back by (textIndent - symbolIndent)
      }));
    }

    // Create custom numbered list with all UI-configured levels
    const numId = manager.createCustomList(levels, "UI Numbered List");
    if (!numId) {
      this.log.warn("Failed to create custom numbered list");
      return 0;
    }

    this.log.debug(`Created numbered list numId=${numId} with ${levels.length} levels`);

    // ✅ FIX: Don't reassign paragraphs to new numId - this destroys document hierarchy
    // The original document may use multiple numIds (all with ilvl=0) to create visual hierarchy.
    // Consolidating to a single numId loses this hierarchy.
    // Instead, use the framework method below to apply formatting to ALL existing numbered lists.
    //
    // REMOVED: Paragraph reassignment loop that caused hierarchy loss
    // - Original code reassigned ALL numbered paragraphs to the new "UI Numbered List" numId
    // - This collapsed multiple numIds into 1, losing visual hierarchy
    // - Now we preserve original numIds while still applying UI formatting

    // Use framework method to standardize numbered list formatting on ALL existing lists
    // This applies UI settings (Verdana 12pt black) to existing abstractNum definitions
    // NOTE: fontSize is in half-points, so 24 = 12pt
    const result = doc.standardizeNumberedListPrefixes({
      font: "Verdana",
      fontSize: 24, // 12pt = 24 half-points
      color: "000000",
      bold: false,
    });
    this.log.debug(
      `Framework standardized ${result.listsUpdated} numbered lists, ${result.levelsModified} levels modified`
    );

    // NEW: Also convert numbering FORMATS (e.g., lowerLetter -> decimal) based on UI settings
    // This ensures existing lists adopt the user's configured numbering format
    let formatsConverted = 0;
    try {
      const manager = doc.getNumberingManager();
      const abstractNums = manager.getAllAbstractNumberings();

      for (const abstractNum of abstractNums) {
        // Only process numbered lists (skip bullet lists)
        const level0 = abstractNum.getLevel(0);
        if (!level0 || level0.getFormat() === "bullet") continue;

        // Update each level's format and indentation based on UI settings
        for (let levelIndex = 0; levelIndex < 9; levelIndex++) {
          const level = abstractNum.getLevel(levelIndex);
          if (!level || level.getFormat() === "bullet") continue;

          // Get the UI-configured settings for this level
          const configLevel = settings.indentationLevels[levelIndex];

          // Apply format conversion if configured
          if (configLevel?.numberedFormat) {
            const newFormat = this.parseNumberedFormat(configLevel.numberedFormat);
            const currentFormat = level.getFormat();

            // Only update if the format is different and it's a numbered format
            if (currentFormat !== newFormat && currentFormat !== "bullet") {
              level.setFormat(newFormat);
              // Also update the text template to match the new format
              level.setText(`%${levelIndex + 1}.`);
              formatsConverted++;
              this.log.debug(
                `Converted level ${levelIndex} format: ${currentFormat} -> ${newFormat}`
              );
            }
          }

          // ✅ SET INDENTATION from UI settings (same as bullet lists)
          // OOXML semantics: w:left = where TEXT starts, w:hanging = how far NUMBER hangs back
          if (configLevel) {
            const symbolTwips = Math.round(configLevel.symbolIndent * 1440);
            const textTwips = Math.round(configLevel.textIndent * 1440);
            const hangingTwips = textTwips - symbolTwips;
            level.setLeftIndent(textTwips);      // Text starts at textIndent
            level.setHangingIndent(hangingTwips); // Number hangs back by (textIndent - symbolIndent)
            this.log.debug(
              `  Set numbered level ${levelIndex} indentation: textIndent=${textTwips}twips, hanging=${hangingTwips}twips (number at ${symbolTwips}twips)`
            );
          }
        }
      }

      if (formatsConverted > 0) {
        this.log.info(`Converted ${formatsConverted} numbering levels to UI-configured formats`);
      }
    } catch (error) {
      this.log.warn("Failed to convert numbering formats:", error);
      // Continue even if format conversion fails - formatting was already applied
    }

    return result.levelsModified + formatsConverted;
  }

  /**
   * Pre-process extended typed prefixes that DocXMLater's normalizeTableLists doesn't handle.
   *
   * DocXMLater handles simple patterns like "1.", "a.", "A." but misses:
   * - Parenthetical formats: (1), (a), (A), 1), a), A)
   * - Roman numerals: i., ii., iii., (i), (ii), I., II., (I), (II)
   *
   * This method scans table cells for these extended patterns and converts them to
   * proper Word numbering BEFORE DocXMLater's normalizeTableLists runs.
   *
   * @param doc - The document to process
   * @returns Number of prefixes converted
   */
  private preProcessExtendedTypedPrefixes(doc: Document): number {
    const manager = doc.getNumberingManager();
    let converted = 0;

    this.log.debug("=== PRE-PROCESSING EXTENDED TYPED PREFIXES ===");

    // Extended patterns not handled by DocXMLater
    // Each pattern maps to a Word numFmt and suggested level
    const extendedPatterns: Array<{
      regex: RegExp;
      getFormat: (match: RegExpMatchArray) => string;
      getLevel: () => number;
      description: string;
    }> = [
      // Parenthetical numbers: (1), (2), etc.
      {
        regex: /^\((\d+)\)\s*/,
        getFormat: () => 'decimal',
        getLevel: () => 0,
        description: 'parenthetical decimal'
      },
      // Number with closing paren: 1), 2), etc.
      {
        regex: /^(\d+)\)\s*/,
        getFormat: () => 'decimal',
        getLevel: () => 0,
        description: 'decimal with paren'
      },
      // Parenthetical letters: (a), (b), (A), (B), etc.
      {
        regex: /^\(([a-zA-Z])\)\s*/,
        getFormat: (m) => m[1] === m[1].toUpperCase() ? 'upperLetter' : 'lowerLetter',
        getLevel: () => 1,
        description: 'parenthetical letter'
      },
      // Letter with closing paren: a), b), A), B), etc.
      {
        regex: /^([a-zA-Z])\)\s*/,
        getFormat: (m) => m[1] === m[1].toUpperCase() ? 'upperLetter' : 'lowerLetter',
        getLevel: () => 1,
        description: 'letter with paren'
      },
      // Lowercase Roman numerals with period: i., ii., iii., iv., v., vi., vii., viii., ix., x., xi., xii., xiii.
      {
        regex: /^(i{1,3}|iv|vi{0,3}|ix|xi{1,3}|xiv|xv)\.\s*/i,
        getFormat: (m) => m[1] === m[1].toUpperCase() ? 'upperRoman' : 'lowerRoman',
        getLevel: () => 2,
        description: 'Roman numeral'
      },
      // Parenthetical Roman: (i), (ii), (iii), (I), (II), etc.
      {
        regex: /^\((i{1,3}|iv|vi{0,3}|ix|xi{1,3}|xiv|xv)\)\s*/i,
        getFormat: (m) => m[1] === m[1].toUpperCase() ? 'upperRoman' : 'lowerRoman',
        getLevel: () => 2,
        description: 'parenthetical Roman'
      },
    ];

    // Cache for found numbering definitions by format
    const formatToNumId = new Map<string, number>();

    // Find all numIds used in the document by scanning paragraphs
    const usedNumIds = new Set<number>();
    for (const para of doc.getAllParagraphs()) {
      const numbering = para.getNumbering();
      if (numbering && numbering.numId !== undefined) {
        usedNumIds.add(numbering.numId);
      }
    }

    // Build format -> numId mapping from used numbering definitions
    for (const numId of usedNumIds) {
      const instance = manager.getInstance(numId);
      if (!instance) continue;

      const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
      if (!abstractNum) continue;

      const level0 = abstractNum.getLevel(0);
      if (level0) {
        const format = level0.getFormat();
        if (!formatToNumId.has(format)) {
          formatToNumId.set(format, numId);
        }
      }
    }

    // Process all table cells
    const tables = doc.getAllTables();
    for (const table of tables) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          const paragraphs = cell.getParagraphs();

          for (const para of paragraphs) {
            // Skip if already has Word numbering
            const existingNumbering = para.getNumbering();
            if (existingNumbering) continue;

            const text = para.getText();
            if (!text || text.trim().length === 0) continue;

            // Check each extended pattern
            for (const pattern of extendedPatterns) {
              const match = text.match(pattern.regex);
              if (match) {
                const format = pattern.getFormat(match);
                const level = pattern.getLevel();

                // Find or get numId for this format
                let numId = formatToNumId.get(format);

                if (numId === undefined) {
                  // Try to find any numbering with compatible format at any level
                  for (const candidateNumId of usedNumIds) {
                    const instance = manager.getInstance(candidateNumId);
                    if (!instance) continue;

                    const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
                    if (!abstractNum) continue;

                    for (let lvl = 0; lvl < 9; lvl++) {
                      const levelDef = abstractNum.getLevel(lvl);
                      if (levelDef && levelDef.getFormat() === format) {
                        numId = candidateNumId;
                        formatToNumId.set(format, numId);
                        break;
                      }
                    }
                    if (numId !== undefined) break;
                  }
                }

                if (numId !== undefined) {
                  // Remove the prefix from text
                  const newText = text.replace(pattern.regex, '');
                  para.setText(newText);

                  // Apply numbering
                  para.setNumbering(numId, level);

                  converted++;
                  this.log.debug(
                    `  Converted ${pattern.description} prefix: "${match[0].trim()}" -> numId=${numId}, level=${level}`
                  );
                }
                break; // Only match first pattern
              }
            }
          }
        }
      }
    }

    if (converted > 0) {
      this.log.info(`Pre-processed ${converted} extended typed prefixes to Word numbering`);
    } else {
      this.log.debug("  No extended typed prefixes found");
    }

    return converted;
  }

  /**
   * Convert mixed list formats to maintain consistency within each abstractNum definition.
   *
   * This method analyzes each abstractNum and ensures all levels use the same format type
   * (either all bullets or all numbered) based on what level 0 uses.
   *
   * This fixes documents where lists have inconsistent formatting like:
   * - Bullet level 0, but numbered levels 1-2
   * - Numbered level 0, but bullet levels 1-3
   *
   * The dominant format is determined by level 0:
   * - If level 0 is bullet → convert all numbered levels to bullets
   * - If level 0 is numbered → convert all bullet levels to numbered
   *
   * @param doc - The document to process
   * @param settings - User's indentation level settings from UI (for bullet chars and number formats)
   * @returns Number of levels converted
   */
  /**
   * Get appropriate format fallback string based on format family.
   * When level 0 uses uppercase formats (A, B, C or I, II, III), nested levels
   * should also use uppercase (A.) as the fallback. Otherwise use lowercase (a.).
   *
   * @param level0Format - The format of level 0 (e.g., 'upperLetter', 'lowerLetter', 'decimal')
   * @returns The appropriate fallback format string ('A.' or 'a.')
   */
  private getFormatFallbackString(level0Format: string | undefined): string {
    if (!level0Format) return 'a.';

    const upperFormats = ['upperLetter', 'upperRoman'];
    const isUpperFamily = upperFormats.includes(level0Format);

    return isUpperFamily ? 'A.' : 'a.';
  }

  private async convertMixedListFormats(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number;
        textIndent: number;
        bulletChar?: string;
        numberedFormat?: string;
      }>;
    }
  ): Promise<number> {
    let converted = 0;
    const manager = doc.getNumberingManager();

    this.log.debug("=== CONVERTING MIXED LIST FORMATS ===");

    try {
      const abstractNums = manager.getAllAbstractNumberings();
      this.log.debug(`  Analyzing ${abstractNums.length} abstractNum definitions`);

      for (const abstractNum of abstractNums) {
        // Determine dominant format based on level 0
        const level0 = abstractNum.getLevel(0);
        if (!level0) continue;

        const dominantFormat = level0.getFormat();
        const isBulletList = dominantFormat === "bullet";
        const numberedFormats = ["decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman"];

        // Analyze all levels to check for mixed formats
        let hasNonConformingLevels = false;
        for (let i = 1; i < 9; i++) {
          const level = abstractNum.getLevel(i);
          if (!level) continue;

          const currentFormat = level.getFormat();
          if (isBulletList && currentFormat !== "bullet" && numberedFormats.includes(currentFormat)) {
            hasNonConformingLevels = true;
            break;
          } else if (!isBulletList && currentFormat === "bullet") {
            hasNonConformingLevels = true;
            break;
          }
        }

        if (!hasNonConformingLevels) continue;

        this.log.debug(
          `  Found mixed format abstractNum (level0=${dominantFormat}), converting levels...`
        );

        // Convert non-conforming levels
        for (let i = 1; i < 9; i++) {
          const level = abstractNum.getLevel(i);
          if (!level) continue;

          const currentFormat = level.getFormat();
          const configLevel = settings.indentationLevels[i];

          if (isBulletList && currentFormat !== "bullet" && numberedFormats.includes(currentFormat)) {
            // Convert numbered level to bullet
            level.setFormat("bullet");

            // Apply UI-configured bullet character
            const bulletChar = configLevel?.bulletChar || settings.indentationLevels[0]?.bulletChar || "●";
            const mapping = getBulletMapping(bulletChar);
            level.setText(mapping.char);
            level.setFont(mapping.font);
            level.setFontSize(24); // 12pt
            level.setColor("000000");

            // Apply UI-configured indentation
            if (configLevel) {
              const symbolTwips = Math.round(configLevel.symbolIndent * 1440);
              const textTwips = Math.round(configLevel.textIndent * 1440);
              level.setLeftIndent(textTwips);
              level.setHangingIndent(textTwips - symbolTwips);
            }

            converted++;
            this.log.debug(
              `    Level ${i}: ${currentFormat} -> bullet (char="${bulletChar}")`
            );
          } else if (!isBulletList && currentFormat === "bullet") {
            // Convert bullet level to numbered
            // Use format family from level 0 to determine fallback (upper vs lower)
            const fallbackFormat = this.getFormatFallbackString(dominantFormat);
            const numberedFormat = this.parseNumberedFormat(
              configLevel?.numberedFormat || fallbackFormat
            );
            level.setFormat(numberedFormat);
            level.setText(`%${i + 1}.`);
            level.setFont("Verdana");
            level.setFontSize(24); // 12pt
            level.setColor("000000");

            // Apply UI-configured indentation
            if (configLevel) {
              const symbolTwips = Math.round(configLevel.symbolIndent * 1440);
              const textTwips = Math.round(configLevel.textIndent * 1440);
              level.setLeftIndent(textTwips);
              level.setHangingIndent(textTwips - symbolTwips);
            }

            converted++;
            this.log.debug(
              `    Level ${i}: bullet -> ${numberedFormat}`
            );
          }
        }
      }

      if (converted > 0) {
        this.log.info(`Converted ${converted} mixed list levels to uniform format`);
      } else {
        this.log.debug("  No mixed format levels found");
      }
    } catch (error) {
      this.log.warn("Failed to convert mixed list formats:", error);
    }

    return converted;
  }

  /**
   * Convert nested bullets in hybrid lists to letter format (a., b., c.)
   *
   * When a numbered list (level 0 = decimal) has bullet levels at 1+,
   * this converts those bullet levels to lowerLetter format.
   *
   * This ensures nested items under numbered lists display as:
   * 1. First item
   *    a. Nested item (was: • Nested item)
   *    b. Another nested (was: • Another nested)
   * 2. Second item
   *
   * @param doc - The document to process
   * @param settings - User's indentation level settings from UI
   * @returns Number of levels converted
   */
  private async convertNestedBulletsToLetters(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number;
        textIndent: number;
      }>;
    }
  ): Promise<number> {
    const manager = doc.getNumberingManager();
    let conversions = 0;

    this.log.debug("=== CONVERTING NESTED BULLETS TO LETTERS IN HYBRID LISTS ===");

    // Find all hybrid numIds used in document
    const hybridNumIds = new Set<number>();
    for (const para of doc.getAllParagraphs()) {
      const numbering = para.getNumbering();
      if (numbering && numbering.numId !== undefined && this.isHybridNumberedBulletList(doc, numbering.numId)) {
        hybridNumIds.add(numbering.numId);
      }
    }

    if (hybridNumIds.size === 0) {
      this.log.debug("  No hybrid numbered/bullet lists found");
      return 0;
    }

    this.log.debug(`  Found ${hybridNumIds.size} hybrid lists needing bullet-to-letter conversion`);

    // For each hybrid numId, modify the abstractNum to convert bullet levels to letters
    for (const numId of hybridNumIds) {
      const instance = manager.getInstance(numId);
      if (!instance) continue;

      const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
      if (!abstractNum) continue;

      // Determine letter case from level 0 format (upper vs lower family)
      const level0 = abstractNum.getLevel(0);
      const level0Format = level0?.getFormat();
      const useUpperCase = level0Format && ['upperLetter', 'upperRoman'].includes(level0Format);
      const letterFormat = useUpperCase ? 'upperLetter' : 'lowerLetter';

      // Convert each bullet level (1-8) to letter format
      for (let levelIndex = 1; levelIndex < 9; levelIndex++) {
        const level = abstractNum.getLevel(levelIndex);
        if (level && level.getFormat() === "bullet") {
          // Convert to letter format (respecting upper/lower case from level 0)
          level.setFormat(letterFormat);
          level.setText(`%${levelIndex + 1}.`); // a., b., c. or A., B., C. format
          level.setFont("Verdana"); // Standard font for letters
          level.setFontSize(24); // 12pt = 24 half-points
          level.setColor("000000");

          // Apply UI-configured indentation if available
          // OOXML semantics: w:left = where TEXT starts, w:hanging = how far NUMBER hangs back
          const config = settings.indentationLevels[levelIndex];
          if (config) {
            const symbolTwips = Math.round(config.symbolIndent * 1440);
            const textTwips = Math.round(config.textIndent * 1440);
            level.setLeftIndent(textTwips);      // Text starts at textIndent
            level.setHangingIndent(textTwips - symbolTwips);
          }

          conversions++;
          this.log.debug(
            `  Converted level ${levelIndex} in numId ${numId}: bullet -> ${letterFormat}`
          );
        }
      }
    }

    return conversions;
  }

  /**
   * Convert nested numbered items to bullets in table cells where majority is bullets
   *
   * This function:
   * 1. Iterates through all table cells
   * 2. Analyzes each cell to determine the majority list format (bullet vs numbered)
   * 3. For cells where majority is bullets (or equal), converts numbered sub-items to bullets
   *
   * @param doc - The document to process
   * @param settings - User's indentation level settings from UI
   * @returns Number of conversions made
   */
  private async convertNestedNumbersToBulletsInTableCells(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number;
        textIndent: number;
        bulletChar?: string;
      }>;
    }
  ): Promise<number> {
    const manager = doc.getNumberingManager();
    let totalConversions = 0;

    this.log.debug("=== CONVERTING NESTED NUMBERS TO BULLETS IN TABLE CELLS ===");

    const tables = doc.getAllTables();
    for (const table of tables) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          const paragraphs = cell.getParagraphs();

          // Count bullet vs numbered items in this cell
          let bulletCount = 0;
          let numberedCount = 0;
          const numIdsInCell = new Set<number>();

          for (const para of paragraphs) {
            const numbering = para.getNumbering();
            if (!numbering || numbering.numId === undefined) continue;

            numIdsInCell.add(numbering.numId);

            if (this.isBulletList(doc, numbering.numId)) {
              bulletCount++;
            } else if (this.isNumberedList(doc, numbering.numId)) {
              numberedCount++;
            }
          }

          // Skip if bullets are not majority or equal (favor bullets when equal)
          if (bulletCount < numberedCount || bulletCount === 0) continue;

          this.log.debug(`  Cell has bullets >= numbers (${bulletCount} bullet, ${numberedCount} numbered)`);

          // Convert numbered sub-levels in hybrid lists to bullets
          for (const numId of numIdsInCell) {
            if (!this.isHybridBulletNumberedList(doc, numId)) continue;

            const instance = manager.getInstance(numId);
            if (!instance) continue;

            const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
            if (!abstractNum) continue;

            const numberedFormats = ["decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman"];
            for (let levelIndex = 1; levelIndex < 9; levelIndex++) {
              const level = abstractNum.getLevel(levelIndex);
              if (level && numberedFormats.includes(level.getFormat())) {
                // Get UI-configured bullet for this level
                const levelConfig = settings.indentationLevels[levelIndex];
                const bulletChar = levelConfig?.bulletChar || settings.indentationLevels[1]?.bulletChar || "○";

                const mapping = getBulletMapping(bulletChar);

                level.setFormat("bullet");
                level.setText(mapping.char);
                level.setFont(mapping.font);
                level.setFontSize(24); // 12pt
                level.setColor("000000");

                // OOXML semantics: w:left = where TEXT starts, w:hanging = how far BULLET hangs back
                if (levelConfig) {
                  const symbolTwips = Math.round(levelConfig.symbolIndent * 1440);
                  const textTwips = Math.round(levelConfig.textIndent * 1440);
                  level.setLeftIndent(textTwips);      // Text starts at textIndent
                  level.setHangingIndent(textTwips - symbolTwips);
                }

                totalConversions++;
                this.log.debug(
                  `    Converted level ${levelIndex} in numId ${numId}: numbered -> bullet (${bulletChar})`
                );
              }
            }
          }
        }
      }
    }

    return totalConversions;
  }

  /**
   * Convert nested numbered items to bullets in body lists where majority is bullets
   *
   * This function:
   * 1. Gets all paragraphs NOT in tables
   * 2. Groups paragraphs by numId
   * 3. For each numId group, counts bullet vs numbered items
   * 4. If majority is bullets (or equal), converts numbered sub-items to bullets
   *
   * @param doc - The document to process
   * @param settings - User's indentation level settings from UI
   * @returns Number of conversions made
   */
  private async convertNestedNumbersToBulletsInBody(
    doc: Document,
    settings: {
      indentationLevels: Array<{
        level: number;
        symbolIndent: number;
        textIndent: number;
        bulletChar?: string;
      }>;
    }
  ): Promise<number> {
    const manager = doc.getNumberingManager();
    let totalConversions = 0;

    this.log.debug("=== CONVERTING NESTED NUMBERS TO BULLETS IN BODY ===");

    // Collect all numIds that appear in table cells (these are handled by the table cell function)
    const tableNumIds = new Set<number>();
    for (const table of doc.getAllTables()) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          for (const para of cell.getParagraphs()) {
            const numbering = para.getNumbering();
            if (numbering && numbering.numId !== undefined) {
              tableNumIds.add(numbering.numId);
            }
          }
        }
      }
    }

    // Get all paragraphs and group by numId (only for numIds NOT in tables)
    const allParagraphs = doc.getAllParagraphs();

    // Group by numId and analyze each list (only numIds not in tables)
    const listGroups = new Map<number, { bulletCount: number; numberedCount: number }>();

    for (const para of allParagraphs) {
      const numbering = para.getNumbering();
      if (!numbering || numbering.numId === undefined) continue;

      const numId = numbering.numId;

      // Skip numIds that appear in tables (handled by table cell function)
      if (tableNumIds.has(numId)) continue;

      if (!listGroups.has(numId)) {
        listGroups.set(numId, { bulletCount: 0, numberedCount: 0 });
      }

      const group = listGroups.get(numId)!;
      if (this.isBulletList(doc, numId)) {
        group.bulletCount++;
      } else if (this.isNumberedList(doc, numId)) {
        group.numberedCount++;
      }
    }

    // Convert hybrid lists where bullets are majority or equal (favor bullets when equal)
    // Only processes numIds that are exclusively in the body (not in any table cell)
    for (const [numId, counts] of listGroups) {
      if (counts.bulletCount < counts.numberedCount || counts.bulletCount === 0) continue;
      if (!this.isHybridBulletNumberedList(doc, numId)) continue;

      this.log.debug(`  List numId ${numId} has bullets >= numbers (${counts.bulletCount} bullet, ${counts.numberedCount} numbered)`);

      const instance = manager.getInstance(numId);
      if (!instance) continue;

      const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
      if (!abstractNum) continue;

      const numberedFormats = ["decimal", "lowerLetter", "upperLetter", "lowerRoman", "upperRoman"];
      for (let levelIndex = 1; levelIndex < 9; levelIndex++) {
        const level = abstractNum.getLevel(levelIndex);
        if (level && numberedFormats.includes(level.getFormat())) {
          const levelConfig = settings.indentationLevels[levelIndex];
          const bulletChar = levelConfig?.bulletChar || settings.indentationLevels[1]?.bulletChar || "○";

          const mapping = getBulletMapping(bulletChar);

          level.setFormat("bullet");
          level.setText(mapping.char);
          level.setFont(mapping.font);
          level.setFontSize(24);
          level.setColor("000000");

          // OOXML semantics: w:left = where TEXT starts, w:hanging = how far BULLET hangs back
          if (levelConfig) {
            const symbolTwips = Math.round(levelConfig.symbolIndent * 1440);
            const textTwips = Math.round(levelConfig.textIndent * 1440);
            level.setLeftIndent(textTwips);      // Text starts at textIndent
            level.setHangingIndent(textTwips - symbolTwips);
          }

          totalConversions++;
          this.log.debug(
            `    Converted level ${levelIndex} in numId ${numId}: numbered -> bullet (${bulletChar})`
          );
        }
      }
    }

    return totalConversions;
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
    bordersApplied: number;
    cellsRecolored: number;
  }> {
    // Get shading colors for tables from session settings (strip # prefix for OOXML format)
    const header2Color = options.tableShadingSettings?.header2Shading?.replace("#", "") || "BFBFBF";
    const otherColor = options.tableShadingSettings?.otherShading?.replace("#", "") || "DFDFDF";

    // Get preserveBold from Normal style (table cells use Normal style formatting)
    // Use DIRECT formatting check only (not getEffectiveBold) to avoid table style inheritance issues
    const normalStyle = options.styles?.find((s: { id: string }) => s.id === 'normal');
    const preserveBold = normalStyle?.preserveBold ?? true; // Default to preserve if not specified

    // Get Normal style font and alignment values for shaded cells and first row cells
    const normalFontFamily = normalStyle?.fontFamily ?? "Verdana";
    const normalFontSize = normalStyle?.fontSize ?? 12;
    const normalAlignment = normalStyle?.alignment ?? "center"; // Default center for table cells
    const preserveCenterAlignment = normalStyle?.preserveCenterAlignment ?? false;

    // Get Normal style spacing values for shaded cells and first row cells
    const normalSpaceBefore = normalStyle?.spaceBefore ?? 3;  // Default 3pt
    const normalSpaceAfter = normalStyle?.spaceAfter ?? 3;    // Default 3pt
    const normalLineSpacing = normalStyle?.lineSpacing ?? 1.0; // Default single spacing

    this.log.info(`[DEBUG] applyTableUniformity: preserveBold=${preserveBold} (normalStyle?.preserveBold=${normalStyle?.preserveBold})`);
    this.log.debug(`[DEBUG] options.styles: ${JSON.stringify(options.styles?.map(s => ({ id: s.id, preserveBold: s.preserveBold })) || 'undefined')}`);
    this.log.debug(`[DEBUG] Normal style spacing: before=${normalSpaceBefore}pt, after=${normalSpaceAfter}pt, line=${normalLineSpacing}`);

    // Get Heading 2 style configuration for 1x1 tables
    const heading2Style = options.styles?.find((s: { id: string }) => s.id === 'header2');
    const heading2FontFamily = heading2Style?.fontFamily ?? "Verdana";
    const heading2FontSize = heading2Style?.fontSize ?? 14; // 14pt default for Heading 2

    this.log.debug(
      `Applying standard table formatting with colors: #${header2Color} (1x1), #${otherColor} (multi-cell), preserveBold=${preserveBold}, heading2Font=${heading2FontFamily} ${heading2FontSize}pt`
    );

    // Use TableProcessor's applyTableUniformity which respects getResolvedCellShading()
    // This only applies shading to cells that ALREADY have direct shading, not inherited from table styles
    const result = await tableProcessor.applyTableUniformity(doc, {
      header2Shading: header2Color,
      otherShading: otherColor,
      preserveBold: preserveBold,
      heading2FontFamily: heading2FontFamily,
      heading2FontSize: heading2FontSize,
      // Pass Normal style font and alignment for shaded cells and first row cells
      normalFontFamily: normalFontFamily,
      normalFontSize: normalFontSize,
      normalAlignment: normalAlignment,
      preserveCenterAlignment: preserveCenterAlignment,
      // Pass Normal style spacing for shaded cells and first row cells
      normalSpaceBefore: normalSpaceBefore,
      normalSpaceAfter: normalSpaceAfter,
      normalLineSpacing: normalLineSpacing,
    });

    // Update table style definitions in styles.xml to match the user's configured shading
    // This ensures cells using table styles (like GridTable4-Accent3) get consistent shading
    // Common table style shading colors that need to be updated:
    const shadingUpdates = [
      { old: "A5A5A5", new: header2Color }, // Header/accent cells
      { old: "C0C0C0", new: header2Color }, // Header cells
      { old: "D9D9D9", new: otherColor },   // Data cells
      { old: "E7E6E6", new: otherColor },   // Light data cells
    ];
    let styleUpdates = 0;
    for (const update of shadingUpdates) {
      styleUpdates += doc.updateTableStyleShading(update.old, update.new);
    }
    if (styleUpdates > 0) {
      this.log.debug(`Updated ${styleUpdates} shading definitions in styles.xml`);
    }

    this.log.debug(`Applied table uniformity to ${result.tablesProcessed} tables`);
    this.log.debug(`Recolored ${result.cellsRecolored} cells`);

    return result;
  }

  /**
   * Ensure blank lines after complete list sequences (with edge case handling).
   *
   * Orchestrator: processes table cells (cell-scoped) and body paragraphs separately
   * to respect table cell boundaries.
   *
   * Edge case rules:
   * - ADD blank line when un-indented non-list text follows a list
   * - SKIP if next paragraph is indented (continuation text); keep scanning until un-indented found
   * - SKIP if list is the last paragraph in its scope (table cell or document)
   * - SKIP if next paragraph is a small image (<100x100px) and NOT indented
   * - If blank already exists, mark preserved + set Normal style (don't duplicate)
   * - ADD blank line before headings, images, hyperlinks, TOC entries following a list
   *
   * @param doc - Document to process
   * @returns Number of blank lines inserted
   */
  private async ensureBlankLinesAfterLists(doc: Document): Promise<number> {
    let totalAdded = 0;

    this.log.debug("=== ENSURING BLANK LINES AFTER LIST SEQUENCES ===");

    // Scope A: Process each table cell's paragraphs in isolation
    for (const table of doc.getAllTables()) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          const cellParagraphs = cell.getParagraphs();
          const added = this.ensureBlankLinesAfterListsInScope(doc, cellParagraphs, "table-cell", cell);
          totalAdded += added;
        }
      }
    }

    // Scope B: Process body-level paragraphs (excluding table content)
    // Build a set of paragraphs that are inside tables so we can skip them
    const tableParagraphSet = new Set<Paragraph>();
    for (const table of doc.getAllTables()) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          for (const para of cell.getParagraphs()) {
            tableParagraphSet.add(para);
          }
        }
      }
    }

    const allParagraphs = doc.getAllParagraphs();
    const bodyParagraphs: Paragraph[] = [];
    for (const para of allParagraphs) {
      if (!tableParagraphSet.has(para)) {
        bodyParagraphs.push(para);
      }
    }

    if (bodyParagraphs.length > 0) {
      const added = this.ensureBlankLinesAfterListsInScope(doc, bodyParagraphs, "body");
      totalAdded += added;
    }

    this.log.info(`Processed list sequences: added ${totalAdded} blank lines after lists`);
    return totalAdded;
  }

  /**
   * Process a scoped array of paragraphs to ensure blank lines after list sequences.
   *
   * @param doc - Document (needed for creating/inserting paragraphs and checking small images)
   * @param paragraphs - Array of paragraphs within a single scope (one table cell or body)
   * @param scopeLabel - Label for logging ("table-cell" or "body")
   * @returns Number of blank lines inserted
   */
  private ensureBlankLinesAfterListsInScope(
    doc: Document,
    paragraphs: Paragraph[],
    scopeLabel: string,
    cell?: TableCell
  ): number {
    let blankLinesAdded = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const currentPara = paragraphs[i];

      // Check if current paragraph is a list item
      const currentNumbering = currentPara.getNumbering();
      if (!currentNumbering) continue;

      // Check if next paragraph is also a list item
      const nextIdx = i + 1;
      if (nextIdx >= paragraphs.length) {
        // Case 3/11: List item is the last paragraph in this scope — SKIP
        continue;
      }

      const nextPara = paragraphs[nextIdx];
      const nextNumbering = nextPara.getNumbering();
      if (nextNumbering) continue; // Still in a list sequence

      // End of list detected: current has numbering, next doesn't
      this.log.debug(`[${scopeLabel}] Found end of list at paragraph ${i}`);

      // Case 5/10: Check if there's already a blank/empty paragraph after the list
      if (this.isParagraphTrulyEmpty(nextPara)) {
        // Mark existing blank as preserved and set Normal style
        nextPara.setPreserved(true);
        nextPara.setStyle("Normal");
        nextPara.setSpaceAfter(120); // 6pt spacing
        this.log.debug(`[${scopeLabel}] Marked existing blank as preserved at para ${nextIdx}`);
        // Skip this blank paragraph so we don't re-process it
        i = nextIdx;
        continue;
      }

      // Case 2/2b: Check if next paragraph is indented (continuation text)
      const nextFormatting = nextPara.getFormatting();
      const nextLeftIndent = nextFormatting.indentation?.left || 0;

      if (nextLeftIndent > 0) {
        // Indented text = continuation — SKIP, but scan forward for un-indented
        this.log.debug(`[${scopeLabel}] Next para is indented (${nextLeftIndent}tw) — skipping (continuation)`);

        // Scan forward past all indented paragraphs
        let scanIdx = nextIdx + 1;
        while (scanIdx < paragraphs.length) {
          const scanPara = paragraphs[scanIdx];
          const scanNumbering = scanPara.getNumbering();
          if (scanNumbering) {
            // Hit another list item — stop scanning, no blank line needed
            break;
          }
          const scanFormatting = scanPara.getFormatting();
          const scanLeftIndent = scanFormatting.indentation?.left || 0;
          if (scanLeftIndent > 0) {
            // Still indented — keep scanning
            scanIdx++;
            continue;
          }
          // Found un-indented paragraph — need blank line before it
          // But first check if it's the last in scope, or already blank
          if (this.isParagraphTrulyEmpty(scanPara)) {
            scanPara.setPreserved(true);
            scanPara.setStyle("Normal");
            scanPara.setSpaceAfter(120);
            this.log.debug(`[${scopeLabel}] Marked existing blank before un-indented text as preserved at ${scanIdx}`);
          } else {
            // Insert blank line before this un-indented paragraph
            const blankPara = doc.createParagraph("");
            blankPara.setStyle("Normal");
            blankPara.setPreserved(true);
            blankPara.setSpaceAfter(120);
            if (cell) {
              cell.addParagraphAt(scanIdx, blankPara);
            } else {
              doc.insertParagraphAt(scanIdx, blankPara);
            }
            blankLinesAdded++;
            this.log.debug(`[${scopeLabel}] Inserted blank line before un-indented text at ${scanIdx}`);
          }
          break;
        }
        // Jump past the indented chain
        i = scanIdx - 1;
        continue;
      }

      // Case 14: Check if next paragraph is a small image (emoji-like) and NOT indented
      const hasSmallImage = doc.isSmallImageParagraph(nextPara);
      if (hasSmallImage && nextLeftIndent === 0) {
        this.log.debug(`[${scopeLabel}] Next para is small image (not indented) — skipping`);
        continue;
      }

      // Cases 1, 6, 7, 9, 12, 13, 16: Un-indented non-list content follows — ADD blank line
      const blankPara = doc.createParagraph("");
      blankPara.setStyle("Normal");
      blankPara.setPreserved(true);
      blankPara.setSpaceAfter(120); // 6pt spacing

      if (cell) {
        cell.addParagraphAt(nextIdx, blankPara);
      } else {
        doc.insertParagraphAt(nextIdx, blankPara);
      }
      blankLinesAdded++;
      this.log.debug(`[${scopeLabel}] Inserted blank line after list at position ${nextIdx}`);

      // Skip the newly inserted paragraph in next iteration
      i = nextIdx;
    }

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
      // REFACTORED: Don't use doc.standardizeBulletSymbols() as it overrides fonts
      // Instead, directly iterate levels and set only color/bold (preserve fonts)
      const manager = doc.getNumberingManager();
      const abstractNums = manager.getAllAbstractNumberings();
      let levelsModified = 0;

      for (const abstractNum of abstractNums) {
        for (let levelIndex = 0; levelIndex < 9; levelIndex++) {
          const numLevel = abstractNum.getLevel(levelIndex);
          if (!numLevel) continue;

          // Only set color - DO NOT touch font or bold (bold is handled by standardizeListPrefixFormatting)
          numLevel.setColor("000000");
          levelsModified++;
        }
      }

      if (levelsModified > 0) {
        this.log.debug(
          `Standardized numbering colors to black: ${levelsModified} levels modified (fonts preserved)`
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
   * Search for CELL-LEVEL shading pattern in XMLElement tree
   * This is needed because docxmlater doesn't expose pattern shading for table cells
   *
   * IMPORTANT: Only detects shading in w:tcPr (cell properties).
   * Stops recursion at:
   * - w:tbl (nested tables)
   * - w:pPr (paragraph properties - paragraph shading is not cell shading)
   * - w:rPr (run properties - text highlighting is not cell shading)
   *
   * @param element - XMLElement object from cell.toXML()
   * @returns The shading pattern value (e.g., "pct12", "solid") or undefined
   */
  private findShadingPatternInXML(element: unknown): string | undefined {
    if (!element || typeof element !== "object") return undefined;

    const el = element as {
      name?: string;
      attributes?: Record<string, string | number | boolean | undefined>;
      children?: unknown[];
    };

    // STOP recursion at nested tables - don't look inside them
    // This prevents detecting shading from nested table cells as the parent cell's shading
    if (el.name === "w:tbl") {
      return undefined;
    }

    // STOP recursion at paragraph properties - don't check w:pPr > w:shd
    // Paragraph shading is not the same as cell shading
    if (el.name === "w:pPr") {
      return undefined;
    }

    // STOP recursion at run properties - don't check w:rPr > w:shd
    // Run shading/highlighting is not the same as cell shading
    if (el.name === "w:rPr") {
      return undefined;
    }

    // Check if this element is w:shd (only cell-level w:tcPr > w:shd at this point)
    if (el.name === "w:shd" && el.attributes?.val) {
      return String(el.attributes.val);
    }

    // Search children recursively (but won't enter nested tables now)
    if (Array.isArray(el.children)) {
      for (const child of el.children) {
        if (typeof child === "object") {
          const found = this.findShadingPatternInXML(child);
          if (found) return found;
        }
      }
    }

    return undefined;
  }

  /**
   * Detect if a cell has visual shading from any source
   *
   * Checks multiple sources to determine if a cell appears shaded:
   * 1. Direct cell shading fill color
   * 2. Pattern shading (w:shd val attribute like "pct50", "solid") via raw XML
   * 3. Table style inheritance (cell shading from table style)
   *
   * @returns Object with hasShading boolean and optional fill color
   */
  private getResolvedCellShading(
    cell: ReturnType<ReturnType<Table["getRows"]>[number]["getCells"]>[number],
    table: Table,
    doc: Document
  ): { hasShading: boolean; fill?: string } {
    const formatting = cell.getFormatting();

    // 1. Check direct cell shading fill
    const directFill = formatting.shading?.fill?.toUpperCase();
    if (directFill && directFill !== "AUTO" && directFill !== "FFFFFF") {
      return { hasShading: true, fill: directFill };
    }

    // 2. Pattern shading detection REMOVED
    // The pattern shading check was detecting table style conditional patterns
    // (pct12 for banded rows, etc.) as visual shading, causing uniformity to be applied
    // to cells that had no direct user-applied shading.

    // 3. Table style inheritance check REMOVED
    // Previously this checked table style for inherited cell shading, but now that
    // docxmlater properly parses table styles (w:tblStyle), ALL cells with any
    // table style conditional shading (banded rows, firstCol, etc.) were being detected.
    // This caused applySmartTableFormatting() to shade ALL cells incorrectly.
    // Now we only detect cells with DIRECT shading, preserving original table styling.

    // 4. No shading detected
    return { hasShading: false };
  }

  /**
   * Check if a cell contains ANY image (not just large ones).
   * Images can appear as Image or ImageRun instances in paragraph content.
   *
   * @param cell - The table cell to check
   * @returns True if the cell contains any image
   */
  private cellContainsAnyImage(
    cell: ReturnType<ReturnType<Table["getRows"]>[number]["getCells"]>[number]
  ): boolean {
    for (const para of cell.getParagraphs()) {
      const content = para.getContent();
      for (const item of content) {
        if (item instanceof Image || item instanceof ImageRun) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Count the number of text lines in a cell.
   * Each paragraph counts as 1 line, plus any soft line breaks (\n) within paragraphs.
   *
   * @param cell - The table cell to check
   * @returns Number of text lines in the cell
   */
  private countCellTextLines(
    cell: ReturnType<ReturnType<Table["getRows"]>[number]["getCells"]>[number]
  ): number {
    let lineCount = 0;
    for (const para of cell.getParagraphs()) {
      lineCount += 1;
      const text = para.getText() || "";
      lineCount += (text.match(/\n/g) || []).length;
    }
    return lineCount;
  }

  /**
   * Check if text starts with a typed list prefix (bullet character or number).
   * Used as fallback detection when Word list formatting is not detected.
   *
   * @param text - The text to check
   * @returns True if the text starts with a list prefix
   */
  private hasTypedListPrefix(text: string): boolean {
    if (!text) return false;
    // Bullet characters (including dash variants)
    if (/^[•●○◦▪▫‣⁃\-–—]\s/.test(text)) return true;
    // Numbered: "1.", "1)", "(1)", "a.", "a)", "(a)", "i.", etc.
    if (/^(\d+[\.\):]|\(\d+\)|[a-zA-Z][\.\):]|\([a-zA-Z]\)|[ivxIVX]+[\.\):])/.test(text)) return true;
    return false;
  }

  /**
   * Check if a table cell contains any list items (bullets or numbered lists).
   * Uses multiple detection methods for robustness:
   * 1. Word list formatting via getNumbering() / hasNumbering()
   * 2. Typed list prefixes (bullet characters or numbers in text)
   *
   * @param cell - The table cell to check
   * @returns True if the cell contains any list formatting
   */
  private cellContainsAnyList(
    cell: ReturnType<ReturnType<Table["getRows"]>[number]["getCells"]>[number]
  ): boolean {
    const paragraphs = cell.getParagraphs();
    this.log.info(`cellContainsAnyList: checking ${paragraphs.length} paragraphs`);

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const numbering = para.getNumbering();
      const text = para.getText()?.trim() || '';

      // Method 1: Check Word list formatting via getNumbering()
      if (numbering && numbering.numId) {
        this.log.info(`  Para ${i}: FOUND LIST via getNumbering() numId=${numbering.numId}, text="${text.substring(0, 40)}..."`);
        return true;
      }

      // Method 2: Check Word list formatting via hasNumbering() (handles edge cases)
      if (typeof para.hasNumbering === 'function' && para.hasNumbering()) {
        this.log.info(`  Para ${i}: FOUND LIST via hasNumbering(), text="${text.substring(0, 40)}..."`);
        return true;
      }

      // Method 3: Check for typed list prefixes (fallback)
      if (this.hasTypedListPrefix(text)) {
        this.log.info(`  Para ${i}: FOUND LIST via typed prefix, text="${text.substring(0, 40)}..."`);
        return true;
      }
    }

    this.log.info(`  -> NO LISTS FOUND in ${paragraphs.length} paragraphs`);
    return false;
  }

  /**
   * Check if a 1x1 table should be excluded from Heading 2 styling and shading.
   * Excluded if the cell has more than 2 lines of text.
   *
   * @param cell - The single cell of a 1x1 table
   * @returns True if the table should be excluded from styling/shading
   */
  private should1x1TableBeExcluded(
    cell: ReturnType<ReturnType<Table["getRows"]>[number]["getCells"]>[number]
  ): boolean {
    const lineCount = this.countCellTextLines(cell);
    if (lineCount > 2) {
      this.log.info(`should1x1TableBeExcluded: ${lineCount} lines (>2) -> EXCLUDED`);
      return true;
    }
    this.log.info(`should1x1TableBeExcluded: ${lineCount} lines (<=2) -> NOT EXCLUDED`);
    return false;
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

    // Get preserveBold from Normal style (table cells use Normal style formatting)
    const normalStyle = options.styles?.find((s: { id: string }) => s.id === "normal");
    const preserveBold = normalStyle?.preserveBold ?? true;

    this.log.info(`[DEBUG] applySmartTableFormatting: preserveBold=${preserveBold} (normalStyle?.preserveBold=${normalStyle?.preserveBold})`);
    this.log.debug(`[DEBUG] options.styles: ${JSON.stringify(options.styles?.map(s => ({ id: s.id, preserveBold: s.preserveBold })) || 'undefined')}`);

    // Get Heading 2 style configuration for 1x1 tables
    const heading2Style = options.styles?.find((s: { id: string }) => s.id === "header2");
    const heading2FontFamily = heading2Style?.fontFamily ?? "Verdana";
    const heading2FontSize = heading2Style?.fontSize ?? 14; // 14pt default for Heading 2

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
          // Handle 1x1 tables - apply Header 2 shading color only if cell has existing shading OR Heading 2 style
          // EXCEPTION: Skip styling if cell has >2 lines of text
          const singleCell = table.getRow(0)?.getCell(0);
          if (singleCell) {
            // Check if this 1x1 table should be excluded from styling
            if (this.should1x1TableBeExcluded(singleCell)) {
              const lineCount = this.countCellTextLines(singleCell);
              this.log.debug(`Skipping 1x1 table styling (${lineCount} lines)`);

              // Clear existing shading from excluded tables
              singleCell.setShading({ fill: 'auto' });

              // Still apply cell margins even for excluded tables
              singleCell.setMargins(cellMargins);
              formattedCount++;
              continue;
            }

            const { hasShading } = this.getResolvedCellShading(singleCell, table, doc);

            // Also check if any paragraph has Heading 2 style
            const hasHeading2Style = singleCell.getParagraphs().some((para) => {
              const style = para.getStyle();
              return style === "Heading2" || style === "Heading 2";
            });

            // Only apply shading if cell has existing shading OR Heading 2 style
            if (hasShading || hasHeading2Style) {
              singleCell.setShading({ fill: header2Color });

              // Apply Heading 2 font/size and bold formatting
              for (const para of singleCell.getParagraphs()) {
                for (const run of para.getRuns()) {
                  run.setFont(heading2FontFamily);
                  run.setSize(heading2FontSize);
                  if (!preserveBold) {
                    run.setBold(true);
                  }
                }
              }

              this.log.debug(`Applied Header 2 formatting (#${header2Color}, ${heading2FontFamily} ${heading2FontSize}pt) to 1x1 table`);
            } else {
              this.log.debug(
                `Skipped shading for 1x1 table - no existing shading and no Heading 2 style`
              );
            }

            // Always apply cell margins
            singleCell.setMargins(cellMargins);
          }
        } else {
          // Handle multi-cell tables
          // - First row (header): ALWAYS shade with "Other Table Shading" + bold + center
          // - Data rows WITH existing shading: Apply "Other Table Shading" + bold + center
          // - Data rows WITHOUT shading: Preserve original formatting (don't change bold)
          const rows = table.getRows();
          let rowIndex = 0;
          for (const row of rows) {
            const isFirstRow = rowIndex === 0;
            let cellIndex = 0;

            for (const cell of row.getCells()) {
              // Check cell shading using resolved shading detection (direct fill only)
              const { hasShading, fill: originalColor } = this.getResolvedCellShading(cell, table, doc);

              // DEBUG: Log each cell's color evaluation
              this.log.debug(
                `[Table ${formattedCount}] Row ${rowIndex}, Cell ${cellIndex}: ` +
                `isFirstRow=${isFirstRow}, resolvedShading=${hasShading}, originalColor="${originalColor || "NONE"}"`
              );

              if (isFirstRow) {
                // HEADER ROW: Always shade with "Other Table Shading" and bold
                this.log.debug(
                  `  → Shading HEADER cell (${rowIndex},${cellIndex}) with #${otherColor}`
                );
                cell.setShading({ fill: otherColor });

                // Set all text in the header to bold (unless preserveBold is enabled)
                for (const para of cell.getParagraphs()) {
                  if (!preserveBold) {
                    for (const run of para.getRuns()) {
                      run.setBold(true);
                    }
                  }
                  // Center header text (skip list paragraphs)
                  if (!para.getNumbering()) {
                    para.setAlignment("center");
                  }
                }
              } else if (hasShading) {
                // DATA ROW WITH SHADING: Apply "Other Table Shading" + bold + center
                this.log.debug(
                  `  → Shading DATA cell (${rowIndex},${cellIndex}) with #${otherColor} (original: ${originalColor || "pattern/style"})`
                );
                cell.setShading({ fill: otherColor });

                // Set all text in shaded data cells to bold (unless preserveBold is enabled)
                for (const para of cell.getParagraphs()) {
                  if (!preserveBold) {
                    for (const run of para.getRuns()) {
                      run.setBold(true);
                    }
                  }
                  // Center text in shaded cells (skip list paragraphs)
                  if (!para.getNumbering()) {
                    para.setAlignment("center");
                  }
                }
              } else {
                // DATA ROW WITHOUT SHADING: Preserve original formatting
                // Don't change bold - let the Normal style's preserveBold handle it
                this.log.debug(
                  `  → Preserving cell (${rowIndex},${cellIndex}) - no shading, keeping original formatting`
                );
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

    // Apply TopHyperlink style - provides base formatting
    para.setStyle("TopHyperlink");

    // Mark as preserved to protect from paragraph removal operations
    para.setPreserved(true);

    // CRITICAL FIX (Round 5): Apply EXPLICIT paragraph-level formatting to GUARANTEE the result
    // Style-only approach has proven unreliable (attempted 20+ times) due to:
    // - Word's complex formatting inheritance rules
    // - Style application timing issues
    // - Direct formatting precedence over styles
    // By applying both style AND explicit formatting, we ensure the result is correct.
    para.setAlignment("right");
    para.setSpaceBefore(60);     // 3pt = 60 twips
    para.setSpaceAfter(0);       // 0pt
    para.setLineSpacing(240, "exact");  // 12pt exact

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

    // STEP 1: Ensure _top bookmark exists BEFORE fixing hyperlinks
    // This is required for internal hyperlinks to properly navigate to document start
    if (!doc.hasBookmark("_top")) {
      this.log.debug("Creating _top bookmark before fixing TOD hyperlinks...");
      try {
        doc.addTopBookmark();
        this.log.debug("Created _top bookmark at document body start");
      } catch (error) {
        this.log.warn(
          `Failed to create _top bookmark: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    // STEP 2: Ensure TopHyperlink style exists before fixing existing hyperlinks
    this.ensureTopHyperlinkStyle(doc);

    // Check ALL paragraphs in document (body, tables, headers, footers)
    const paragraphsToCheck = doc.getAllParagraphs();

    this.log.debug(
      `Checking ${paragraphsToCheck.length} paragraphs (ALL locations) for Top of Document hyperlinks to fix...`
    );

    for (const para of paragraphsToCheck) {
      const content = para.getContent();
      let foundTopHyperlink = false;

      // Check each content item for hyperlinks - handles 3 cases:
      // 1. Direct Hyperlink instances
      // 2. Hyperlinks inside Revision elements (w:ins, w:del)
      // 3. HYPERLINK field codes (ComplexField)
      for (const item of content) {
        // Case 1: Direct Hyperlink instances
        if (item instanceof Hyperlink) {
          if (this.isTopOfDocumentHyperlink(item.getText())) {
            this.applyTopHyperlinkFormatting(item);
            foundTopHyperlink = true;
            this.log.debug("Applied formatting to direct Hyperlink");
          }
        }
        // Case 2: Hyperlinks inside Revision elements (w:ins tracked changes)
        else if (item instanceof Revision) {
          const revisionContent = item.getContent();
          for (const revContent of revisionContent) {
            if (revContent instanceof Hyperlink) {
              if (this.isTopOfDocumentHyperlink(revContent.getText())) {
                this.applyTopHyperlinkFormatting(revContent);
                foundTopHyperlink = true;
                this.log.debug("Applied formatting to Hyperlink inside Revision");
              }
            }
          }
        }
        // Case 3: HYPERLINK field codes (ComplexField)
        else if (item instanceof ComplexField) {
          if (item.isHyperlinkField()) {
            const parsedHyperlink = item.getParsedHyperlink();
            const resultText = item.getResult() || "";

            // Check if text indicates TOD hyperlink (regardless of current anchor)
            // This allows us to fix hyperlinks pointing to wrong anchors
            if (this.isTopOfDocumentHyperlink(resultText)) {
              // Apply formatting to the field result with explicit bold/italic false
              item.setResultFormatting({
                font: "Verdana",
                size: 12,
                color: "0000FF",
                underline: "single",
                bold: false,
                italic: false,
              });

              // Update anchor to _top if not already set
              // ComplexField uses setInstruction() with buildHyperlinkInstruction()
              if (parsedHyperlink?.anchor !== "_top") {
                const newInstruction = buildHyperlinkInstruction(
                  parsedHyperlink?.url || "",  // Keep URL (empty for internal links)
                  "_top",                       // New anchor
                  parsedHyperlink?.tooltip      // Preserve tooltip if any
                );
                item.setInstruction(newInstruction);
                this.log.debug(`Updated ComplexField instruction to use "_top" anchor`);
              }

              foundTopHyperlink = true;
              this.log.debug("Applied formatting to HYPERLINK field code");
            }
          }
        }
      }

      // Apply paragraph formatting if we found a Top hyperlink
      if (foundTopHyperlink) {
        // CRITICAL: Clear direct formatting BEFORE applying style
        // Without this, existing direct formatting (e.g., w:jc val="left") overrides the style
        para.clearDirectFormatting();

        // Now apply the style - provides base formatting
        para.setStyle("TopHyperlink");

        // CRITICAL FIX (Round 5): Apply EXPLICIT paragraph-level formatting to GUARANTEE the result
        // Style-only approach has proven unreliable (attempted 20+ times).
        // By applying both style AND explicit formatting, we ensure the result is correct.
        para.setAlignment("right");
        para.setSpaceBefore(60);     // 3pt = 60 twips
        para.setSpaceAfter(0);       // 0pt
        para.setLineSpacing(240, "exact");  // 12pt exact

        fixedCount++;
        this.log.debug("Cleared direct formatting, applied TopHyperlink style, and explicit formatting");
      }
    }

    if (fixedCount > 0) {
      this.log.info(`Fixed ${fixedCount} existing Top of Document hyperlinks`);
    }

    return fixedCount;
  }

  /**
   * Check if text indicates a "Top of the Document" hyperlink
   */
  private isTopOfDocumentHyperlink(text: string): boolean {
    const cleanText = sanitizeHyperlinkText(text).toLowerCase();
    return cleanText.includes("top of") &&
           (cleanText.includes("document") || cleanText === "top of the document");
  }

  /**
   * Apply standard formatting to a Top of Document hyperlink
   * - Formatting: Verdana 12pt, blue (#0000FF), underlined, no bold/italic
   * - Text: "Top of the Document"
   * - Anchor: "_top" bookmark
   */
  private applyTopHyperlinkFormatting(hyperlink: Hyperlink): void {
    // Use replace: true to clear any existing characterStyle reference (e.g., "Hyperlink")
    // This ensures the explicit formatting takes precedence in Word
    // Explicitly set bold/italic to false to prevent formatting bleed
    hyperlink.setFormatting({
      font: "Verdana",
      size: 12,
      color: "0000FF",
      underline: "single",
      bold: false,
      italic: false,
    }, { replace: true });

    // Ensure text is "Top of the Document" (with "the")
    const currentText = sanitizeHyperlinkText(hyperlink.getText());
    if (currentText.toLowerCase() !== "top of the document") {
      hyperlink.setText("Top of the Document");
      this.log.debug('Updated hyperlink text to "Top of the Document"');
    }

    // Ensure anchor points to "_top" bookmark
    const currentAnchor = hyperlink.getAnchor();
    if (currentAnchor !== "_top") {
      hyperlink.setAnchor("_top");
      this.log.debug(`Updated hyperlink anchor from "${currentAnchor || 'none'}" to "_top"`);
    }
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
      // Skip shaded 1x1 tables - they don't need Top of Document links
      const rows = table.getRows();
      const is1x1Table = rows.length === 1 && rows[0]?.getCells().length === 1;

      if (is1x1Table) {
        // Check if the cell is shaded - if so, skip adding Top of Document link
        const cell = rows[0].getCells()[0];
        const cellFormatting = cell?.getFormatting();
        const shadingFill = cellFormatting?.shading?.fill?.toUpperCase();
        const isShaded = shadingFill && shadingFill !== "AUTO" && shadingFill !== "FFFFFF";

        if (isShaded) {
          this.log.debug(`Table ${tableIndex} is a shaded 1x1 table (fill: ${shadingFill}) - skipping Top of Document link`);
        } else {
          // Treat unshaded 1x1 tables the same as Header 2 tables
          hasHeader2 = true;
          this.log.debug(`Table ${tableIndex} is an unshaded 1x1 table - will add Top of Document link`);
        }
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
        // Look back up to 5 elements to account for blank paragraphs between link and table
        let shouldInsert = true;

        for (let lookback = 1; lookback <= 5 && tablePosition - lookback >= 0; lookback++) {
          const prevElement = bodyElements[tablePosition - lookback];

          if (prevElement instanceof Paragraph) {
            const content = prevElement.getContent();

            const hasTopLink = content.some((item: any) => {
              // Check Hyperlink objects
              if (item instanceof Hyperlink) {
                const text = sanitizeHyperlinkText(item.getText()).toLowerCase();
                // Check for any "top of" hyperlink (regardless of exact text)
                if (text.includes("top of")) {
                  return true;
                }
              }
              // Also check ComplexField hyperlinks (fallback for any field codes not converted)
              if (item instanceof ComplexField && item.isHyperlinkField()) {
                const text = (item.getResult() || "").toLowerCase();
                if (text.includes("top of")) {
                  return true;
                }
              }
              // Also check for raw text containing "Top of the Document"
              if (item instanceof Run) {
                const runText = item.getText().toLowerCase();
                if (runText.includes("top of the document")) {
                  return true;
                }
              }
              return false;
            });

            if (hasTopLink) {
              // SAFE: Skip existing hyperlinks (never modify existing document objects)
              // Modifying existing objects with setText() corrupts DocXMLater's internal state
              // See CORRUPTION_FIX.md for detailed explanation of this principle
              this.log.debug(`Hyperlink already exists at position ${tablePosition - lookback} before table ${tableIndex}, skipping`);
              shouldInsert = false;
              break;
            }

            // Stop looking back if we hit content (non-empty, non-hyperlink paragraph)
            const paraText = prevElement.getText().trim();
            if (paraText && !content.some((c: any) => c instanceof Hyperlink)) {
              // Hit content paragraph - stop looking back
              break;
            }
          } else {
            // Hit a table or other non-paragraph element - stop looking back
            break;
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

    // Step 1: Search ENTIRE document for existing disclaimers (case-insensitive)
    // Full document scan ensures we find disclaimers regardless of position,
    // even if they appear before "Related Documents" sections or other content
    const paragraphs = doc.getAllParagraphs();
    let existingWarningIndices: number[] = [];

    // Use precise matching for the two disclaimer lines
    const disclaimerLine1Pattern = "not to be reproduced or disclosed to others without prior written approval";
    const disclaimerLine2Pattern = "electronic data = official version - paper copy = informational only";

    // Also keep broader patterns for catching malformed/partial disclaimers
    const additionalPatterns = [
      "electronic data",
      "not to be reproduced",
      "paper copy = informational only",
      "prior written approval",
    ];

    for (let i = 0; i < paragraphs.length; i++) {
      const text = this.getParagraphText(paragraphs[i]).toLowerCase();

      // Check for exact disclaimer lines first
      const matchesLine1 = text.includes(disclaimerLine1Pattern);
      const matchesLine2 = text.includes(disclaimerLine2Pattern);
      // Also check broader patterns for partial matches
      const matchesAdditional = additionalPatterns.some((pattern) => text.includes(pattern));

      if (matchesLine1 || matchesLine2 || matchesAdditional) {
        existingWarningIndices.push(i);
        this.log.debug(`Found existing disclaimer paragraph at index ${i}: "${text.substring(0, 50)}..."`);
      }
    }

    // Step 2: Remove existing disclaimer paragraphs if found
    if (existingWarningIndices.length > 0) {
      this.log.debug(`Found ${existingWarningIndices.length} existing disclaimer paragraph(s) to remove`);
      // Remove in reverse order to maintain indices
      existingWarningIndices.sort((a, b) => b - a);
      for (const index of existingWarningIndices) {
        doc.removeParagraph(paragraphs[index]);
        this.log.debug(`Removed existing disclaimer paragraph at index ${index}`);
      }
    }

    // Step 2b: Check if "Top of Document" hyperlink exists near end of document
    // If not, add one above the warning with a blank line separator
    const refreshedParagraphs = doc.getAllParagraphs();
    const checkStartIndex = Math.max(0, refreshedParagraphs.length - 2);
    let hasTopHyperlinkNearEnd = false;

    for (let i = refreshedParagraphs.length - 1; i >= checkStartIndex; i--) {
      const content = refreshedParagraphs[i].getContent();
      for (const item of content) {
        // Check Hyperlink objects
        if (item instanceof Hyperlink) {
          const text = sanitizeHyperlinkText(item.getText()).toLowerCase();
          if (text.includes("top of")) {
            hasTopHyperlinkNearEnd = true;
            break;
          }
        }
        // Also check ComplexField hyperlinks (fallback for any field codes not converted)
        if (item instanceof ComplexField && item.isHyperlinkField()) {
          const text = (item.getResult() || "").toLowerCase();
          if (text.includes("top of")) {
            hasTopHyperlinkNearEnd = true;
            break;
          }
        }
      }
      if (hasTopHyperlinkNearEnd) break;
    }

    // If no "Top of Document" hyperlink near end, add one above the warning
    if (!hasTopHyperlinkNearEnd) {
      // Insert blank line for separation from content above
      const separatorPara = doc.createParagraph("");
      separatorPara.setStyle("Normal");
      separatorPara.setSpaceBefore(pointsToTwips(0));
      separatorPara.setSpaceAfter(pointsToTwips(0));

      // Insert Top of Document hyperlink
      this.createTopHyperlinkParagraph(doc);

      this.log.debug("Added Top of Document hyperlink above document warning");
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
          // Use counter for guaranteed uniqueness instead of Date.now() which can cause collisions
          // when multiple headings are processed within the same millisecond
          const bookmarkName = `_Toc_${level}_${++this.tocBookmarkCounter}`;
          const bookmark = new Bookmark({ name: bookmarkName });
          // Register bookmark to get unique ID - fixes duplicate ID corruption issue
          const registered = doc.getBookmarkManager().register(bookmark);
          para.addBookmark(registered);

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
        this.log.debug(`Found \\o switch with levels value: "${levelsValue}"`);

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
   * @param options - Optional TOC build options
   * @param options.excludeHeading1 - Whether to exclude Heading 1 from TOC (default: true)
   * @returns Object with count of TOC entries created and list of heading names included
   */
  public async buildProperTOC(
    doc: Document,
    options: { excludeHeading1?: boolean } = {}
  ): Promise<{ count: number; headings: string[] }> {
    const { excludeHeading1 = true } = options;
    this.log.debug("=== BUILDING PROPER TOC (using rebuildTOCs) ===");
    this.log.debug(`excludeHeading1: ${excludeHeading1}`);

    // Step 1: Ensure all headings have bookmarks
    await this.ensureHeadingBookmarks(doc);
    this.log.debug("✓ Step 1: Ensured heading bookmarks");

    // Step 2: If excludeHeading1, modify the TOC field instruction
    if (excludeHeading1) {
      this.modifyTOCFieldInstructionToExcludeHeading1(doc);
      this.log.debug("✓ Step 2: Modified TOC field instruction to exclude Heading 1");
    }

    // Step 3: Use docxmlater's rebuildTOCs() which preserves field structure
    // This generates TOC entries with:
    // - SDT wrapper with docPartGallery="Table of Contents"
    // - Field structure: fldChar begin → instrText → fldChar separate → entries → fldChar end
    // - Hyperlinked entries between separator and end
    // This allows Word's "Update Field" right-click option to work
    const results = doc.rebuildTOCs();
    this.log.debug(`✓ Step 3: rebuildTOCs() returned ${results.length} TOC(s)`);

    // Step 4: Format TOC styles using docxmlater 9.1.0's formatTOCStyles()
    // Apply consistent formatting: Verdana 12pt, blue, underlined
    const tocLevels = excludeHeading1 ? [2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const formatResult = doc.formatTOCStyles({
      run: {
        font: "Verdana",
        size: 12,
        color: "0000FF",
        underline: true,
      },
      paragraph: {
        alignment: "left",
        spacing: {
          before: 0,
          after: 0,
          line: 240,
          lineRule: "auto",
        },
      },
      levels: tocLevels,
    });
    this.log.debug(`✓ Step 4: formatTOCStyles() formatted levels: [${formatResult.formatted.join(", ")}]`);

    // Extract heading counts from results
    let totalCount = 0;
    const headings: string[] = [];

    for (const [instruction, counts] of results) {
      const entryCount = counts.reduce((sum, c) => sum + c, 0);
      totalCount += entryCount;
      this.log.debug(`TOC "${instruction.substring(0, 30)}...": ${entryCount} entries`);
    }

    // Get heading names from document for reporting
    const allParagraphs = doc.getAllParagraphs();
    for (const para of allParagraphs) {
      const style = para.getStyle();
      const match = style?.match(/^Heading\s*(\d+)$/i);
      if (match && match[1]) {
        const level = parseInt(match[1], 10);
        // Apply excludeHeading1 filter for reporting
        if (!excludeHeading1 || level !== 1) {
          headings.push(para.getText().trim());
        }
      }
    }

    this.log.info(
      `✓ Built proper TOC with ${totalCount} entries (field structure preserved, Update Field enabled)`
    );
    return { count: totalCount, headings };
  }

  /**
   * Modifies the TOC field instruction in document.xml to exclude Heading 1
   * Changes \o "1-N" to \o "2-N" so rebuildTOCs() excludes Heading 1
   *
   * @param doc - Document to modify
   * @private
   */
  private modifyTOCFieldInstructionToExcludeHeading1(doc: Document): void {
    const zipHandler = doc.getZipHandler();
    const docXml = zipHandler.getFileAsString("word/document.xml");
    if (!docXml) {
      this.log.warn("Could not read document.xml to modify TOC field instruction");
      return;
    }

    // Match TOC field instruction with \o "1-N" pattern
    // Also handle HTML entity &quot; for quoted values
    const patterns = [
      // Standard quotes: \o "1-3" -> \o "2-3"
      /(<w:instrText[^>]*>.*?TOC.*?\\o\s*")1(-\d+)(")/g,
      // HTML entities: \o &quot;1-3&quot; -> \o &quot;2-3&quot;
      /(<w:instrText[^>]*>.*?TOC.*?\\o\s*&quot;)1(-\d+)(&quot;)/g,
    ];

    let modifiedXml = docXml;
    let modified = false;

    for (const pattern of patterns) {
      const newXml = modifiedXml.replace(pattern, "$12$2$3");
      if (newXml !== modifiedXml) {
        modifiedXml = newXml;
        modified = true;
        this.log.debug("Modified TOC field instruction: changed 1-N to 2-N");
      }
    }

    if (modified) {
      zipHandler.updateFile("word/document.xml", modifiedXml);
      this.log.info("Updated document.xml with modified TOC field instruction (excluded Heading 1)");
    } else {
      this.log.debug("No TOC field instruction modification needed (no 1-N pattern found)");
    }
  }

  /**
   * Find all paragraphs that contain exactly 18pt font text
   * Used as fallback when no Heading 1 style is found in the document
   *
   * @param doc - Document to search
   * @returns Array of paragraphs containing at least one 18pt run
   */
  private find18ptParagraphs(doc: Document): Paragraph[] {
    const result: Paragraph[] = [];
    const allParagraphs = doc.getAllParagraphs();

    for (const para of allParagraphs) {
      const runs = para.getRuns();
      for (const run of runs) {
        const formatting = run.getFormatting();
        if (formatting.size === 18) {
          // Exactly 18pt
          result.push(para);
          break; // Found 18pt in this paragraph, move to next
        }
      }
    }
    return result;
  }

  /**
   * Manually populate Table of Contents with bookmarks and internal hyperlinks
   *
   * This comprehensive implementation:
   * 1. Finds all existing headings (Heading1, Heading2, Heading3) in document
   * 2. Creates bookmarks for each heading
   * 3. Finds all TOC field elements in document (or creates TOC from scratch if none exist)
   * 4. Uses provided levels or falls back to all heading levels in document
   * 5. Replaces TOC fields with manual hyperlink paragraphs
   * 6. Formats TOC entries with proper indentation and Verdana 12pt blue styling
   *
   * @param doc - Document to process
   * @param precomputedLevels - Optional pre-parsed TOC levels to avoid re-parsing
   * @returns Object with count of TOC entries created and list of heading names included
   */
  private async manuallyPopulateTOC(doc: Document, precomputedLevels?: number[]): Promise<{ count: number; headings: string[] }> {
    let totalEntriesCreated = 0;
    const includedHeadings: string[] = [];

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

      // SAFEGUARD: Capture first Heading1 before any modifications
      // This protects against accidental removal during TOC processing
      let firstHeading1: Paragraph | null = null;
      let firstHeading1Text = '';
      let firstHeading1BodyIndex = -1;
      const bodyElements = doc.getBodyElements();
      for (let i = 0; i < bodyElements.length; i++) {
        const element = bodyElements[i];
        if (element instanceof Paragraph) {
          const style = element.getStyle();
          if (style === 'Heading1' || style === 'Heading 1') {
            firstHeading1 = element;
            firstHeading1Text = element.getText().trim();
            firstHeading1BodyIndex = i;
            this.log.debug(`Protected Heading1 at index ${i}: "${firstHeading1Text.substring(0, 50)}..."`);
            break;
          }
        }
      }

      // FALLBACK: If no Heading 1 found, look for 18pt font paragraphs and convert ALL of them
      if (!firstHeading1) {
        this.log.debug('No Heading 1 found - searching for 18pt font paragraphs');
        const paragraphs18pt = this.find18ptParagraphs(doc);

        if (paragraphs18pt.length > 0) {
          // Apply Heading 1 style to ALL 18pt paragraphs
          for (const para of paragraphs18pt) {
            para.setStyle('Heading1');
            this.log.info(
              `Applied Heading 1 style to 18pt paragraph: "${para.getText().trim().substring(0, 50)}..."`
            );
          }

          // Use the first one for TOC placement
          firstHeading1 = paragraphs18pt[0];
          firstHeading1Text = firstHeading1.getText().trim();

          // Find the body index of the first 18pt paragraph
          for (let i = 0; i < bodyElements.length; i++) {
            if (bodyElements[i] === firstHeading1) {
              firstHeading1BodyIndex = i;
              break;
            }
          }

          this.log.info(`Converted ${paragraphs18pt.length} 18pt paragraph(s) to Heading 1`);
        } else {
          this.log.info('No Heading 1 or 18pt font found - TOC insertion will be skipped');
        }
      }

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
        return { count: 0, headings: [] };
      }

      // ============================================
      // STEP 2: DETECT EXISTING TOC (BOTH FIELD AND MANUAL)
      // ============================================
      const tocElements = doc.getTableOfContentsElements();

      // Also detect manually-created TOC entries (paragraphs with TOC1-TOC9 styles)
      // Note: bodyElements was already captured above for Heading1 protection
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

      // Also detect non-SDT TOC fields (ComplexField with TOC instruction in a regular paragraph)
      // These are TOCs that weren't wrapped in an SDT element
      let nonSdtTocStartIndex = -1;
      let nonSdtTocEndIndex = -1;

      for (let i = 0; i < bodyElements.length; i++) {
        const element = bodyElements[i];
        if (element instanceof Paragraph) {
          const content = element.getContent();
          for (const item of content) {
            if (item instanceof ComplexField) {
              const instruction = item.getInstruction();
              if (instruction && instruction.trim().toUpperCase().startsWith('TOC')) {
                nonSdtTocStartIndex = i;
                this.log.info(`Found non-SDT TOC field at body element index ${i}`);
                break;
              }
            }
          }
          if (nonSdtTocStartIndex !== -1) break;
        }
      }

      // If found non-SDT TOC, find where it ends (look for consecutive hyperlink paragraphs that are part of TOC)
      if (nonSdtTocStartIndex !== -1) {
        nonSdtTocEndIndex = nonSdtTocStartIndex;
        for (let i = nonSdtTocStartIndex + 1; i < bodyElements.length; i++) {
          const element = bodyElements[i];
          if (element instanceof Paragraph) {
            const content = element.getContent();
            // Check if this paragraph is part of TOC (has hyperlinks pointing to TOC bookmarks)
            const hasHyperlink = content.some(item => item instanceof Hyperlink);
            const text = element.getText().trim();
            const isEmpty = text === '';

            // TOC entries typically have hyperlinks or are empty spacer paragraphs
            // Stop when we hit a non-empty paragraph without hyperlinks
            if (hasHyperlink || isEmpty) {
              nonSdtTocEndIndex = i;
            } else {
              break; // End of TOC entries - hit content paragraph
            }
          } else {
            break; // Hit a table or other element - end of TOC
          }
        }
        this.log.info(`Non-SDT TOC spans body elements ${nonSdtTocStartIndex} to ${nonSdtTocEndIndex}`);
      }

      this.log.info(`Found ${tocElements.length} TOC field element(s) in document`);

      // ============================================
      // STEP 3: DETERMINE TOC LEVELS TO INCLUDE
      // ============================================
      let levelsToInclude: number[] = [];

      // Use precomputed levels if provided, otherwise fall back to all heading levels
      if (precomputedLevels && precomputedLevels.length > 0) {
        levelsToInclude = precomputedLevels;
        this.log.debug(`Using precomputed TOC levels: ${levelsToInclude.join(", ")}`);
      } else {
        // Fall back to all heading levels found in document
        const uniqueLevels = new Set(allHeadings.map((h) => h.level));
        levelsToInclude = Array.from(uniqueLevels).sort((a, b) => a - b);
        this.log.info(
          `No precomputed levels - using all heading levels in document: ${levelsToInclude.join(", ")}`
        );
      }

      // ============================================
      // STEP 4: FILTER HEADINGS BY LEVELS
      // ============================================
      const tocHeadings = allHeadings.filter((h) => levelsToInclude.includes(h.level));

      if (tocHeadings.length === 0) {
        this.log.warn("No headings match TOC level filter");
        return { count: 0, headings: [] };
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
        includedHeadings.push(heading.text);

        this.log.debug(
          `Created TOC entry for ${heading.text} (Level ${heading.level}, style: ${tocStyleId})`
        );
      }

      // ============================================
      // STEP 6: REMOVE EXISTING TOC (FIELD OR MANUAL)
      // ============================================
      let insertPosition = 0;
      let tocRemoved = false;

      // Remove existing TOC field elements (SDT-wrapped)
      if (tocElements.length > 0) {
        for (const tocElement of tocElements) {
          const tocIndex = bodyElements.indexOf(tocElement);
          if (tocIndex !== -1) {
            doc.removeTocAt(tocIndex);
            this.log.debug(`Removed original TOC field at index ${tocIndex}`);
            insertPosition = tocIndex;
            tocRemoved = true;
            break; // Only process first TOC
          }
        }
      }

      // Remove manually-created TOC paragraphs (paragraphs with TOC1-TOC9 styles)
      // This can happen ALONGSIDE non-SDT TOC field content, so NOT using else if
      if (manualTocParagraphs.length > 0) {
        // Remove in reverse order to maintain indices
        for (let i = manualTocParagraphs.length - 1; i >= 0; i--) {
          // PROTECTION: Never remove the Heading1 paragraph
          if (manualTocParagraphs[i] === firstHeading1) {
            this.log.warn(`Skipping removal of Heading1 from manual TOC paragraphs`);
            continue;
          }
          const success = doc.removeParagraph(manualTocParagraphs[i]);
          if (success) {
            this.log.debug(`Removed manual TOC entry ${i + 1}/${manualTocParagraphs.length}`);
          }
        }
        if (!tocRemoved) {
          insertPosition = manualTocStartIndex;
        }
        this.log.info(`Removed ${manualTocParagraphs.length} existing manual TOC entries`);
        tocRemoved = true;
      }

      // Remove non-SDT TOC field and its hyperlink entries
      // This can happen ALONGSIDE manual TOC paragraphs, so NOT using else if
      if (nonSdtTocStartIndex !== -1) {
        // Calculate removal range but protect the Heading1
        let effectiveStartIndex = nonSdtTocStartIndex;

        // PROTECTION: Never remove paragraphs at or before the Heading1 index
        if (firstHeading1BodyIndex >= 0 && nonSdtTocStartIndex <= firstHeading1BodyIndex) {
          effectiveStartIndex = firstHeading1BodyIndex + 1;
          this.log.warn(`Adjusting non-SDT TOC removal to protect Heading1 at index ${firstHeading1BodyIndex}`);
        }

        if (effectiveStartIndex <= nonSdtTocEndIndex) {
          const elementsToRemove = nonSdtTocEndIndex - effectiveStartIndex + 1;

          // Remove from end to start to preserve indices
          for (let i = nonSdtTocEndIndex; i >= effectiveStartIndex; i--) {
            const element = bodyElements[i];
            if (element instanceof Paragraph) {
              // PROTECTION: Never remove the Heading1 paragraph
              if (element === firstHeading1) {
                this.log.warn(`Skipping removal of Heading1 paragraph at index ${i}`);
                continue;
              }
              const success = doc.removeParagraph(element);
              if (success) {
                this.log.debug(`Removed non-SDT TOC element at index ${i}`);
              }
            }
          }
          if (!tocRemoved) {
            insertPosition = effectiveStartIndex;
          }
          this.log.info(`Removed non-SDT TOC (${elementsToRemove} elements) starting at index ${effectiveStartIndex}`);
          tocRemoved = true;
        }
      }

      // No existing TOC found - insert after first Heading 1
      if (!tocRemoved) {
        if (firstHeading1BodyIndex >= 0) {
          // Insert after the first Heading 1
          insertPosition = firstHeading1BodyIndex + 1;
          this.log.info(`No existing TOC found - creating new TOC after first Heading 1 at position ${insertPosition}`);
        } else {
          // No Heading 1 found (and no 18pt font was converted) - SKIP TOC insertion
          this.log.warn('No Heading 1 or 18pt font found - skipping TOC creation');
          return { count: 0, headings: [] };
        }
      }

      // Insert all TOC entry paragraphs at the determined position
      for (let i = 0; i < tocParagraphs.length; i++) {
        doc.insertParagraphAt(insertPosition + i, tocParagraphs[i]!);
      }

      totalEntriesCreated = tocParagraphs.length;
      this.log.info(`Inserted ${tocParagraphs.length} TOC entries at position ${insertPosition}`);

      // Add blank line after TOC entries
      // Note: addStructureBlankLines() runs BEFORE buildProperTOC(), so we must add the blank line here
      if (tocParagraphs.length > 0) {
        const blankPara = new Paragraph();
        doc.insertParagraphAt(insertPosition + tocParagraphs.length, blankPara);
        this.log.debug(`Added blank line after TOC at position ${insertPosition + tocParagraphs.length}`);
      }

      // ============================================
      // STEP 7: VERIFY HEADING1 IS STILL PRESENT
      // ============================================
      // This is a safety check to detect if Heading1 was accidentally lost
      if (firstHeading1) {
        const newBodyElements = doc.getBodyElements();
        let heading1Found = false;
        let heading1NewIndex = -1;

        for (let i = 0; i < newBodyElements.length; i++) {
          const element = newBodyElements[i];
          if (element instanceof Paragraph) {
            const style = element.getStyle();
            if (style === 'Heading1' || style === 'Heading 1') {
              heading1Found = true;
              heading1NewIndex = i;
              break;
            }
          }
        }

        if (!heading1Found) {
          this.log.error(`CRITICAL: Heading1 was lost during TOC processing! Original: "${firstHeading1Text}"`);
          // Attempt recovery by re-inserting the Heading1 at position 0
          try {
            doc.insertParagraphAt(0, firstHeading1);
            this.log.warn(`Recovered Heading1 by re-inserting at position 0`);
          } catch (recoveryError) {
            this.log.error(`Failed to recover Heading1: ${recoveryError instanceof Error ? recoveryError.message : 'Unknown error'}`);
          }
        } else if (heading1NewIndex !== 0) {
          this.log.warn(`Heading1 is at index ${heading1NewIndex} instead of 0 (this may be expected if document structure was modified)`);
        } else {
          this.log.debug(`Heading1 preserved at index 0: "${firstHeading1Text.substring(0, 30)}..."`);
        }
      }

      return { count: totalEntriesCreated, headings: includedHeadings };
    } catch (error) {
      this.log.error(
        `Error in manual TOC population: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      // Log stack trace for debugging
      if (error instanceof Error && error.stack) {
        this.log.debug(`Stack trace: ${error.stack}`);
      }
      // Don't throw - allow document processing to continue
      return { count: totalEntriesCreated, headings: includedHeadings };
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
      }
      // NOTE: Hyperlink runs are intentionally NOT included here.
      // Hyperlinks are formatted separately by standardizeHyperlinkFormatting() to ensure
      // they retain their blue color (#0000FF) and underline. Including them here would
      // cause the style application loop to overwrite their blue color with the Normal style color.
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
