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
  inchesToTwips,
  isHyperlink,
  isRevision,
  isRun,
  NumberingLevel,
  Paragraph,
  pointsToTwips,
  PreservedElement,
  Revision,
  RevisionAwareProcessor,
  Run,
  Style,
  Table,
  type TableOfContents,
  WORD_NATIVE_BULLETS,
} from "docxmlater";
import {
  ListNormalizer,
  normalizeOrphanListLevelsInTable,
  stripTypedPrefix,
  detectTypedPrefix,
  parseTypedMarkerValue,
  disambiguateRomanMarker,
  getLevelFromFormat,
  detectListType,
  getParagraphIndentation,
  createMixedListNumId,
  restampMixedListBulletFonts,
  computeOrphanBodyListShifts,
  type OrphanLevelEvent,
} from "@/services/document/list";
import type { ParagraphContent, RunFormatting, TableCell } from "docxmlater";
import type { RevisionHandlingMode } from "@/types/session";
// Note: Run, Hyperlink, ImageRun imported for type checking in isParagraphTrulyEmpty()
import {
  DetailedHyperlinkInfo,
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult,
  HyperlinkType,
} from "@/types/hyperlink";
import type {
  ChangeEntry,
  ChangelogSummary,
  DocumentChange,
  PreviousRevisionState,
  SessionStyle,
  WordRevisionState,
} from "@/types/session";
import { MemoryMonitor } from "@/utils/MemoryMonitor";
import { logger, startTimer, debugModes, isDebugEnabled } from "@/utils/logger";
import {
  sanitizeHyperlinkText,
  removeEmEnVariants as normalizeEmEnVariants,
} from "@/utils/textSanitizer";
import { extractLookupIds } from "@/utils/urlPatterns";
import { promises as fs } from "fs";
import pLimit from "p-limit";
import * as path from "path";
import { hyperlinkService } from "../HyperlinkService";
import type { HyperlinkApiResponse } from "@/types/hyperlink";
import {
  DocXMLaterProcessor,
  DOC_LOAD_SIZE_LIMITS,
  type ExtractedHyperlink,
} from "./DocXMLaterProcessor";
import { blankLineManager, removeSmallIndents } from "./blanklines";
import { normalizeRunWhitespace } from "./helpers/whitespace";
import { cropEmbeddedImageBorders, collectParagraphImages } from "./helpers/ImageBorderCropper";
import { normalizeVmlImagesInBuffer } from "./helpers/vmlImageNormalizer";
import { clearAllImageShadows } from "./helpers/imageShadow";
import { leftAlignListItems } from "./helpers/listItemAlignment";
import { flattenSingleLevelToc } from "./helpers/tocFlatten";
import { cleanTocEntries } from "./helpers/tocCleanEntries";
import { collectTocHeadings, populateTocInModel } from "./helpers/tocPopulate";
import { stripCenterAfterDeletedParaMark } from "./helpers/paragraphMarkDeletionAlignment";
import { captureBlankLineSnapshot } from "./blanklines/helpers/blankLineSnapshot";
import { documentProcessingComparison } from "./DocumentProcessingComparison";
import { DocumentSnapshotService } from "./DocumentSnapshotService";
import { tableProcessor } from "./processors/TableProcessor";
import { getBodyRuns } from "./helpers/paragraphRuns";

// ═══════════════════════════════════════════════════════════
// Bullet Symbol to Font Mapping
// Uses Word-native bullet encoding from docxmlater for maximum compatibility
// Each bullet type uses a SPECIFIC font AND PUA character for correct rendering
// ═══════════════════════════════════════════════════════════
const BULLET_CHAR_MAP: Record<string, { char: string; font: string }> = {
  // Filled bullets - various Unicode representations that should all map to Word's filled bullet
  "●": WORD_NATIVE_BULLETS.FILLED_BULLET, // U+25CF BLACK CIRCLE
  "•": WORD_NATIVE_BULLETS.FILLED_BULLET, // U+2022 BULLET (used in UI default settings)
  // Open circle bullets
  "○": WORD_NATIVE_BULLETS.OPEN_CIRCLE, // U+25CB WHITE CIRCLE
  o: WORD_NATIVE_BULLETS.OPEN_CIRCLE, // Lowercase o (alternative representation)
  // Filled square bullets
  "■": WORD_NATIVE_BULLETS.FILLED_SQUARE, // U+25A0 BLACK SQUARE
  "▪": WORD_NATIVE_BULLETS.FILLED_SQUARE, // U+25AA BLACK SMALL SQUARE (alternative)
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

// Extra hanging indent (in twips) added when a document has numbered lists with 10+ items.
// Widens the gap between number/bullet and text from 0.25" to 0.30" so double-digit
// numbers (10., 11., etc.) don't push text past the hanging indent position.
const WIDE_HANGING_EXTRA_TWIPS = 72; // 0.05 inches * 1440 twips/inch

// ═══════════════════════════════════════════════════════════
// Extended Typed-Prefix Detection Patterns
// Patterns NOT handled by DocXMLater's normalizeTableLists:
//   - Parenthetical formats: (1), (a), (A), 1), a), A)
//   - Roman numerals: i..xv, (i)..(xv) and uppercase variants
// Hoisted to module scope so each RegExp compiles exactly once.
// ═══════════════════════════════════════════════════════════
interface ExtendedTypedPrefixPattern {
  regex: RegExp;
  getFormat: (match: RegExpMatchArray) => string;
  getLevel: () => number;
  description: string;
}

const EXTENDED_TYPED_PREFIX_PATTERNS: readonly ExtendedTypedPrefixPattern[] = [
  // Parenthetical numbers: (1), (2), etc.
  {
    regex: /^\((\d+)\)\s*/,
    getFormat: () => "decimal",
    getLevel: () => 0,
    description: "parenthetical decimal",
  },
  // Number with closing paren: 1), 2), etc.
  {
    regex: /^(\d+)\)\s*/,
    getFormat: () => "decimal",
    getLevel: () => 0,
    description: "decimal with paren",
  },
  // Parenthetical letters: (a), (b), (A), (B), etc.
  {
    regex: /^\(([a-zA-Z])\)\s*/,
    getFormat: (m) => (m[1] === m[1].toUpperCase() ? "upperLetter" : "lowerLetter"),
    getLevel: () => 1,
    description: "parenthetical letter",
  },
  // Letter with closing paren: a), b), A), B), etc.
  {
    regex: /^([a-zA-Z])\)\s*/,
    getFormat: (m) => (m[1] === m[1].toUpperCase() ? "upperLetter" : "lowerLetter"),
    getLevel: () => 1,
    description: "letter with paren",
  },
  // Bounded to i. ... xv. (15 items). 16+ Roman lists fall through to generic
  // paragraph detection — extending alternation is cheaper than a proper parser
  // only if you actually need higher numerals.
  {
    regex: /^(i{1,3}|iv|vi{0,3}|ix|x|xi{1,3}|xiv|xv)\.\s*/i,
    getFormat: (m) => (m[1] === m[1].toUpperCase() ? "upperRoman" : "lowerRoman"),
    getLevel: () => 2,
    description: "Roman numeral",
  },
  // Bounded to i. ... xv. (15 items). 16+ Roman lists fall through to generic
  // paragraph detection — extending alternation is cheaper than a proper parser
  // only if you actually need higher numerals.
  {
    regex: /^\((i{1,3}|iv|vi{0,3}|ix|x|xi{1,3}|xiv|xv)\)\s*/i,
    getFormat: (m) => (m[1] === m[1].toUpperCase() ? "upperRoman" : "lowerRoman"),
    getLevel: () => 2,
    description: "parenthetical Roman",
  },
];

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
  removeItalics?: boolean; // remove-italics: Remove italic formatting from all runs
  preserveRedFont?: boolean; // preserve-red-font: Preserve exact #FF0000 red font color on Normal and List Paragraph style paragraphs
  removeEmEnVariants?: boolean; // remove-em-en-variants: Replace em/en dashes with hyphens and em/en spaces with regular spaces
  standardizeHyperlinkFormatting?: boolean; // standardize-hyperlink-formatting: Remove bold/italic from hyperlinks and reset to standard style
  standardizeListPrefixFormatting?: boolean; // standardize-list-prefix-formatting: Apply consistent Verdana 12pt black formatting to all list symbols/numbers
  correctMisappliedStyles?: boolean; // correct-misapplied-styles: Fix paragraphs with incorrectly applied TOC or Hyperlink paragraph styles

  // ═══════════════════════════════════════════════════════════
  // Content Structure Options (ProcessingOptions group: 'structure')
  // ═══════════════════════════════════════════════════════════
  assignStyles?: boolean; // assign-styles: Apply session styles to headings and normal paragraphs
  centerAndBorderImages?: boolean; // center-border-images: Center and apply 2pt borders to all images larger than 50x50px
  removeHeadersFooters?: boolean; // remove-headers-footers: Remove all headers and footers from document
  addDocumentWarning?: boolean; // add-document-warning: Add standardized warning at end of document
  applyHeader1ToFirstLine?: boolean; // apply-header1-to-first-line: Apply the Heading 1 style to the first line of text

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

  // Whether any numbered list at level 0 has 10+ items, requiring wider hanging indent
  private needsWiderHangingIndent: boolean = false;

  // AbstractNumIds for row-number columns — protected from format/text overrides
  private _rowNumberAbstractNumIds = new Set<number>();

  // AbstractNumIds used in HLP tables — protected from format/indentation overrides
  private _hlpAbstractNumIds = new Set<number>();

  // AbstractNumIds for mixed-list definitions (NUMBERED_LEAD_PATTERN /
  // BULLET_LEAD_PATTERN). Protected from applyBulletUniformity and
  // applyNumberedUniformity overwriting the level-by-level format/text/font;
  // their per-level rendering is dictated by the mixed-list pattern, not the
  // user's flat bullet/numbered UI config.
  private _mixedListAbstractNumIds = new Set<number>();

  // Per-paragraph numbering snapshot taken BEFORE applyStyles() — restored in processHLPTables()
  // to undo any ilvl/numId corruption caused by list processing or style application.
  private _hlpSavedNumbering = new Map<
    Paragraph,
    { numId: number; level: number; leftIndent?: number }
  >();

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
    return typeof window === "undefined";
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
      if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
        return true;
      }

      // Check for common file-in-use error messages
      if (
        message.includes("resource busy") ||
        message.includes("file in use") ||
        message.includes("being used by another process") ||
        message.includes("locked")
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if document is in Word compatibility mode and auto-upgrade if needed.
   * Documents created in Word 2003/2007/2010 use older XML schemas. This method
   * detects them and upgrades to Word 2013+ mode using docxmlater's built-in API.
   *
   * Values: 11=Word2003, 12=Word2007, 14=Word2010, 15=Word2013+
   *
   * @returns Object with upgrade status and details
   */
  private upgradeIfCompatibilityMode(doc: Document): {
    wasUpgraded: boolean;
    previousMode?: number;
    wordVersion?: string;
    removedFlags?: string[];
  } {
    try {
      if (!doc.isCompatibilityMode()) {
        return { wasUpgraded: false };
      }

      const mode = doc.getCompatibilityMode();
      const versionMap: Record<number, string> = {
        11: "Word 2003",
        12: "Word 2007",
        14: "Word 2010",
      };
      const wordVersion = versionMap[mode] || `Unknown (${mode})`;

      this.log.info(
        `Document in compatibility mode: ${wordVersion} (mode ${mode}). Auto-upgrading to modern format...`
      );

      const report = doc.upgradeToModernFormat();

      this.log.info(
        `Upgraded from mode ${report.previousMode} to ${report.newMode}. ` +
          `Removed ${report.removedFlags.length} legacy flags, added ${report.addedSettings.length} modern settings.`
      );

      return {
        wasUpgraded: true,
        previousMode: mode,
        wordVersion,
        removedFlags: report.removedFlags,
      };
    } catch (error) {
      this.log.warn("Failed to check/upgrade compatibility mode (non-fatal):", error);
      return { wasUpgraded: false };
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
                `text="${text}${text.length >= 40 ? "..." : ""}"`
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
          `text="${text}${text.length >= 40 ? "..." : ""}"`
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
      this.log.info("[WordDocProcessor] Using renderer process API (HyperlinkService -> IPC)");
      return hyperlinkService.processHyperlinksWithApi(hyperlinkInfos, apiSettings, userProfile);
    }

    // In main process, call net.request directly
    this.log.info("[WordDocProcessor] Using main process API (net.request)");

    try {
      // Dynamic import to avoid bundling Electron modules in renderer
      const { callPowerAutomateApiWithRetry } =
        await import("../../../electron/services/PowerAutomateApiService");

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
        this.log.warn(
          "No Content_ID or Document_ID patterns found in hyperlinks - skipping API call"
        );
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
        status: "active" | "deprecated" | "expired" | "moved" | "not_found";
        metadata: Record<string, unknown>;
      }> = [];
      let idsNotFoundLocally: string[] = [...lookupIds];

      if (localDictionarySettings?.enabled && localDictionarySettings.totalEntries > 0) {
        this.log.info(
          `[WordDocProcessor] Local dictionary enabled with ${localDictionarySettings.totalEntries} entries - checking local first`
        );

        try {
          // Dynamic import of local dictionary lookup service
          const { getLocalDictionaryLookupService } =
            await import("../../../electron/services/LocalDictionaryLookupService");
          const lookupService = getLocalDictionaryLookupService();

          // Batch lookup against local dictionary
          const localLookupResults = lookupService.batchLookup(lookupIds);

          // Process local results
          const foundLocallySet = new Set<string>();
          for (const result of localLookupResults) {
            if (result.Status !== "Not_Found") {
              const normalizedStatus =
                result.Status.toLowerCase() === "deprecated"
                  ? ("deprecated" as const)
                  : result.Status.toLowerCase() === "expired"
                    ? ("expired" as const)
                    : result.Status.toLowerCase() === "moved"
                      ? ("moved" as const)
                      : result.Status.toLowerCase() === "not_found"
                        ? ("not_found" as const)
                        : ("active" as const);

              localResults.push({
                url: "",
                documentId: result.Document_ID || "",
                contentId: result.Content_ID || "",
                title: result.Title || "",
                status: normalizedStatus,
                metadata: {},
              });

              // Mark IDs as found
              if (result.Document_ID) foundLocallySet.add(result.Document_ID);
              if (result.Content_ID) foundLocallySet.add(result.Content_ID);
            }
          }

          // Filter out IDs that were found locally
          idsNotFoundLocally = lookupIds.filter((id) => !foundLocallySet.has(id));

          this.log.info(
            `[WordDocProcessor] Local dictionary: found ${localResults.length} entries, ${idsNotFoundLocally.length} IDs need API lookup`
          );
        } catch (localError) {
          this.log.warn(
            "[WordDocProcessor] Local dictionary lookup failed, falling back to API:",
            localError
          );
          idsNotFoundLocally = [...lookupIds];
        }
      }

      // If all IDs were found locally, return early
      if (idsNotFoundLocally.length === 0 && localResults.length > 0) {
        this.log.info(
          "[WordDocProcessor] All lookups satisfied by local dictionary - skipping API call"
        );
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
      const hyperlinksChecked = hyperlinkInfos.filter((h) =>
        /thesource\.cvshealth\.com/i.test(h.url)
      ).length;

      // Make the API call (for IDs not found locally)
      const response = await callPowerAutomateApiWithRetry(
        apiSettings.apiUrl,
        {
          Lookup_ID: idsNotFoundLocally.length > 0 ? idsNotFoundLocally : lookupIds,
          Hyperlinks_Checked: hyperlinksChecked,
          Total_Hyperlinks: totalHyperlinks,
          First_Name: userProfile?.firstName || "",
          Last_Name: userProfile?.lastName || "",
          Email: userProfile?.email || "",
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
          this.log.warn(
            "[WordDocProcessor] API call failed but returning local dictionary results"
          );
          return {
            success: true,
            timestamp: new Date(),
            body: {
              results: localResults,
              errors: [response.error || "API request failed (local results returned)"],
            },
            processedHyperlinks: hyperlinkInfos,
          };
        }
        return {
          success: false,
          timestamp: new Date(),
          error: response.error || "API request failed",
        };
      }

      // Parse API results into HyperlinkApiResponse format
      const apiResults =
        response.data?.Results?.map((result) => {
          const rawStatus = result.Status?.trim() || "Active";
          const normalizedStatus =
            rawStatus.toLowerCase() === "deprecated"
              ? ("deprecated" as const)
              : rawStatus.toLowerCase() === "expired"
                ? ("expired" as const)
                : rawStatus.toLowerCase() === "moved"
                  ? ("moved" as const)
                  : rawStatus.toLowerCase() === "not_found"
                    ? ("not_found" as const)
                    : ("active" as const);

          return {
            url: "",
            documentId: result.Document_ID?.trim() || "",
            contentId: result.Content_ID?.trim() || "",
            title: result.Title?.trim() || "",
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
      this.log.error("[WordDocProcessor] Main process API call failed:", error);
      return {
        success: false,
        timestamp: new Date(),
        error: error instanceof Error ? error.message : "Unknown error",
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
    this._rowNumberAbstractNumIds.clear();

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

      // Create backup (skip when explicitly disabled, e.g., batch processing)
      this.log.debug("=== BACKUP CREATION ===");
      if (options.createBackup !== false) {
        const backupPath = await this.createBackup(filePath);
        result.backupPath = backupPath;
        backupCreated = true;
        this.log.info(`Backup created: ${backupPath}`);
      } else {
        this.log.debug("Backup creation skipped (createBackup: false)");
      }

      // Load document using DocXMLater
      // ALWAYS load with 'preserve' to capture pre-existing tracked changes first
      // Auto-accept is applied at the END of processing (after extracting changes for UI)
      this.log.debug("=== LOADING DOCUMENT WITH DOCXMLATER ===");
      this.log.debug(
        `autoAcceptRevisions=${options.autoAcceptRevisions} (will be applied after processing)`
      );
      // Normalize legacy VML pictures (<w:pict><v:imagedata>) to modern
      // DrawingML so the border/center/crop pipeline can see them.
      // DocXMLater's Paragraph.getContent() only exposes <w:drawing>-based
      // pictures; VML images would otherwise be invisible to it.
      const rawBuffer = await fs.readFile(filePath);
      const vmlNormalized = normalizeVmlImagesInBuffer(rawBuffer);
      if (vmlNormalized.converted > 0) {
        this.log.info(
          `Converted ${vmlNormalized.converted} legacy VML image(s) to DrawingML in [${vmlNormalized.modifiedParts.join(", ")}]`
        );
      }
      doc = await Document.loadFromBuffer(vmlNormalized.buffer, {
        strictParsing: false,
        revisionHandling: "preserve", // Always preserve to capture pre-existing changes
        sizeLimits: DOC_LOAD_SIZE_LIMITS,
      });
      this.log.debug("Document loaded successfully");

      // ═══════════════════════════════════════════════════════════
      // COMPATIBILITY MODE CHECK & AUTO-UPGRADE
      // Detect if document uses older Word format and upgrade automatically
      // ═══════════════════════════════════════════════════════════
      const compatUpgrade = this.upgradeIfCompatibilityMode(doc);
      if (compatUpgrade.wasUpgraded) {
        this.log.info(`Auto-upgraded from ${compatUpgrade.wordVersion} to modern format`);
      }

      // ═══════════════════════════════════════════════════════════
      // SANITIZE WEB SETTINGS
      // Remove bloated w:divs from web paste operations that can cause
      // Word to freeze during layout. Resets to minimal template.
      // ═══════════════════════════════════════════════════════════
      const sanitizedDivs = doc.sanitizeWebSettings();
      if (sanitizedDivs > 0) {
        this.log.info(`Sanitized webSettings.xml: removed ${sanitizedDivs} web div(s)`);
      }

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
                  url: element.getFullUrl() || "",
                  text: element.getText() || "",
                });
              }
            });
          });

          // Deduplicate hyperlinks (each paragraph was adding all its hyperlinks)
          const uniqueHyperlinks = new Map<string, (typeof hyperlinks)[0]>();
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
      // PRE-TRACKING NORMALIZATION
      // These operations run BEFORE tracking is enabled so they
      // don't appear as tracked changes in the output document.
      // ═══════════════════════════════════════════════════════════
      if (options.removeEmEnVariants) {
        this.log.debug("=== REMOVING EM/EN VARIANTS (PRE-TRACKING) ===");
        const variantsRemoved = await this.removeEmEnVariants(doc);
        this.log.info(`Removed em/en variants in ${variantsRemoved} runs`);

        if (variantsRemoved > 0) {
          result.changes?.push({
            type: "text",
            category: "structure",
            description: "Removed em/en dashes and spaces (pre-tracking)",
            count: variantsRemoved,
          });
        }
      }

      // Defragment hyperlinks that were split by Google Docs or other processors.
      // Must run BEFORE tracking is enabled — defragmentHyperlinks() is silently
      // skipped when track changes is active (returns 0).
      if (options.operations?.processHyperlinks) {
        this.log.debug("=== DEFRAGMENTING HYPERLINKS (PRE-TRACKING) ===");
        const merged = doc.defragmentHyperlinks({
          resetFormatting: true,
          cleanupRelationships: true,
        });
        this.log.info(`Merged ${merged} fragmented hyperlinks`);
        result.mergedHyperlinks = merged;

        // Track hyperlink defragmentation
        if (merged > 0) {
          result.changes?.push({
            type: "hyperlink",
            category: "structure",
            description: "Merged fragmented hyperlinks",
            count: merged,
          });
        }
      }

      // Bake table-style conditional bold (e.g. a GridTable `firstCol`) into
      // direct run formatting so the preserve-bold setting keeps it. Preserve-
      // bold only leaves DIRECT run bold untouched; the later tblLook reset
      // drops the conditional, so the bold must be captured first. Runs here,
      // PRE-TRACKING, so making already-rendered bold explicit is not surfaced
      // as a tracked formatting change. Gated on the Normal style's
      // preserveBold — when that setting is off, conditional bold is not
      // preserved, consistent with direct bold.
      const normalPreserveBold =
        options.styles?.find((s: { id: string }) => s.id === "normal")?.preserveBold ?? true;
      if (normalPreserveBold) {
        const boldBaked = this.bakeConditionalTableBold(doc);
        if (boldBaked > 0) {
          this.log.info(
            `Baked table-style conditional bold into ${boldBaked} runs (preserve-bold)`
          );
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
      const firstName = options.userProfile?.firstName?.trim() || "";
      const lastName = options.userProfile?.lastName?.trim() || "";
      const profileName =
        firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || "";
      const authorName = options.revisionAuthor?.trim() || profileName || "Doc Hub";

      doc.enableTrackChanges({
        author: authorName,
        trackFormatting: true,
        showInsertionsAndDeletions: true,
        clearExistingPropertyChanges: false,
      });
      this.log.info(`Track changes enabled with author: ${authorName}`);

      // Capture blank line snapshot BEFORE any processing modifies the document.
      // This records original blank line positions using neighbor content hashes
      // so they can be re-located after list normalization shifts indices.
      const blankLineSnapshot = captureBlankLineSnapshot(doc);
      this.log.debug(
        `Captured blank line snapshot: ${blankLineSnapshot.bodyBlanks.length} body blanks, ${blankLineSnapshot.cellBlanks.length} cell blanks`
      );

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
                    `⊘ Skipping hyperlink (no Lookup_ID pattern): type=${hyperlink.isComplexField ? "ComplexField" : "Hyperlink"} url="${hyperlinkInfo.url?.substring(0, 80)}" text="${hyperlinkInfo.displayText?.substring(0, 50)}"`
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
                    // Normalize em/en dashes + special spaces in the API title
                    // when that cleanup is enabled, so the live update path
                    // matches the rest of the document (the document-wide pass
                    // runs before hyperlink processing and never sees freshly
                    // applied API titles).
                    let apiTitle = apiResult.title?.trim();
                    if (apiTitle && options.removeEmEnVariants) {
                      apiTitle = normalizeEmEnVariants(apiTitle);
                    }
                    let newText = apiTitle || hyperlinkInfo.displayText;

                    // Extract content ID digits: prefer apiResult.contentId, fall back to title text
                    let last6: string | null = null;
                    if (apiResult.contentId) {
                      const m = apiResult.contentId.match(/(\d+)$/);
                      // Pad short IDs to 6 digits, but never truncate a longer
                      // tail — slice(-6) silently corrupted out-of-spec 7+ digit IDs.
                      if (m) last6 = m[1].length <= 6 ? m[1].padStart(6, "0") : m[1];
                    }
                    if (!last6) {
                      // Fallback: extract digits from the title text itself (handles empty contentId)
                      const m = newText.match(/\((?:[A-Za-z0-9]+-)*(\d{4,6})\)\s*$/);
                      // Pad short IDs to 6 digits, but never truncate a longer
                      // tail — slice(-6) silently corrupted out-of-spec 7+ digit IDs.
                      if (m) last6 = m[1].length <= 6 ? m[1].padStart(6, "0") : m[1];
                    }

                    // Only strip+re-append when we have a content ID to work with
                    if (last6) {
                      newText = newText
                        .replace(/\s*\((?:[A-Za-z0-9]+-)*\d{4,6}\)\s*$/, "")
                        .trimEnd();
                      newText = `${newText} (${last6})`;
                    }

                    // Add status indicator for deprecated/expired documents
                    if (apiResult.status === "expired" || apiResult.status === "deprecated") {
                      newText += " - Expired";
                    }

                    // Capture trailing punctuation before comparing/updating text
                    const trailingPunct = /[.,]$/.test(hyperlinkInfo.displayText)
                      ? hyperlinkInfo.displayText.slice(-1)
                      : null;

                    if (newText !== hyperlinkInfo.displayText) {
                      // Update hyperlink text using the appropriate API
                      if (hyperlink.isComplexField) {
                        // ComplexField: use setResult() for display text
                        this.setComplexFieldTextTracked(
                          doc,
                          hyperlink.hyperlink as ComplexField,
                          newText,
                          authorName
                        );
                      } else {
                        // Hyperlink: use setText() with tracked changes
                        this.setHyperlinkTextTracked(
                          doc,
                          hyperlink.hyperlink as Hyperlink,
                          hyperlink.paragraph,
                          newText,
                          authorName
                        );
                      }
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
                      if (last6) {
                        const para = hyperlink.paragraph;
                        const content = para.getContent();
                        let hyperlinkIndex = content.findIndex(
                          (item: unknown) => item === hyperlink.hyperlink
                        );

                        // Fallback: when tracking is ON, hyperlink may be wrapped in an insertion Revision
                        if (hyperlinkIndex === -1) {
                          for (let idx = 0; idx < content.length; idx++) {
                            const item = content[idx];
                            if (isRevision(item) && (item as Revision).getType() === "insert") {
                              if (
                                (item as Revision)
                                  .getContent()
                                  .some((c: unknown) => c === hyperlink.hyperlink)
                              ) {
                                hyperlinkIndex = idx;
                                break;
                              }
                            }
                          }
                        }

                        if (hyperlinkIndex !== -1 && hyperlinkIndex < content.length - 1) {
                          const itemsToRemove: Run[] = [];
                          let combinedText = "";

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
                                trimmedText === ")" || // Just closing paren
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

                              // Check for prefixed content ID like "(CMS-PRD1-017428)"
                              const prefixedContentIdPattern1 =
                                /^\s*\((?:[A-Za-z0-9]+-)*\d{4,6}\)\s*$/;
                              if (prefixedContentIdPattern1.test(combinedText)) {
                                for (const toRemove of itemsToRemove) {
                                  para.replaceContent(toRemove, []);
                                }
                                this.log.debug(
                                  `Removed ${itemsToRemove.length} orphaned prefixed content ID fragment(s): "${trimmedText}"`
                                );
                                break;
                              }

                              // If the text doesn't look like a content ID fragment, stop looking
                              if (
                                !/^[\s\d()]+$/.test(combinedText) &&
                                !/^\s*\([\w-]*$/.test(combinedText)
                              ) {
                                break;
                              }
                            } else {
                              // Stop if we hit a non-Run item (Hyperlink, Revision, etc.)
                              break;
                            }
                          }
                        }
                      }

                      // Insert trailing punctuation as a normal-styled Run after the hyperlink
                      if (trailingPunct) {
                        const para = hyperlink.paragraph;
                        const freshContent = para.getContent();
                        let insertAfterIdx = -1;

                        for (let i = 0; i < freshContent.length; i++) {
                          const item = freshContent[i];
                          if (item === hyperlink.hyperlink) {
                            insertAfterIdx = i;
                            break;
                          }
                          // When tracked changes are ON, hyperlink is wrapped in an insertion Revision
                          if (isRevision(item) && (item as Revision).getType() === "insert") {
                            if (
                              (item as Revision)
                                .getContent()
                                .some((c: unknown) => c === hyperlink.hyperlink)
                            ) {
                              insertAfterIdx = i;
                              break;
                            }
                          }
                        }

                        if (insertAfterIdx !== -1) {
                          para.insertRunAt(insertAfterIdx + 1, new Run(trailingPunct));
                          this.log.debug(
                            `Inserted trailing "${trailingPunct}" after hyperlink as normal text`
                          );
                        }
                      }

                      // Track the change with status (expired/updated) and contentId
                      if (options.trackChanges) {
                        const hyperlinkStatus =
                          apiResult.status === "expired" || apiResult.status === "deprecated"
                            ? ("expired" as const)
                            : ("updated" as const);
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
                  } else if (options.operations?.fixContentIds && apiResult.contentId) {
                    // Content ID References enabled WITHOUT Update Titles:
                    // Keep original display text but append Content ID (last 6 digits)
                    const contentIdMatchFix = apiResult.contentId.match(/(\d+)$/);
                    if (!contentIdMatchFix) continue;
                    // Pad short IDs to 6 digits, but never truncate a longer tail.
                    const last6 =
                      contentIdMatchFix[1].length <= 6
                        ? contentIdMatchFix[1].padStart(6, "0")
                        : contentIdMatchFix[1];

                    // Check for trailing punctuation before appending
                    const trailingPunct = /[.,]$/.test(hyperlinkInfo.displayText)
                      ? hyperlinkInfo.displayText.slice(-1)
                      : null;

                    // Build new text: original (minus trailing punct) + content ID
                    let baseText = trailingPunct
                      ? hyperlinkInfo.displayText.slice(0, -1)
                      : hyperlinkInfo.displayText;

                    // Strip existing content ID (4-6 digits in parentheses) to prevent
                    // double-appending and allow replacing incorrect IDs
                    baseText = baseText
                      .replace(/\s*\((?:[A-Za-z0-9]+-)*\d{4,6}\)\s*$/, "")
                      .trimEnd();

                    const newText = `${baseText} (${last6})`;

                    if (newText !== hyperlinkInfo.displayText) {
                      if (hyperlink.isComplexField) {
                        this.setComplexFieldTextTracked(
                          doc,
                          hyperlink.hyperlink as ComplexField,
                          newText,
                          authorName
                        );
                      } else {
                        this.setHyperlinkTextTracked(
                          doc,
                          hyperlink.hyperlink as Hyperlink,
                          hyperlink.paragraph,
                          newText,
                          authorName
                        );
                      }
                      finalDisplayText = newText;
                      newTextValue = newText;
                      textChanged = true;
                      result.updatedDisplayTexts = (result.updatedDisplayTexts || 0) + 1;
                      // An append is also a display-text change (counted above);
                      // additionally give it its own tally so the "Content IDs
                      // Appended" stat (SessionContext) reflects reality instead
                      // of always reading 0.
                      result.appendedContentIds = (result.appendedContentIds || 0) + 1;
                      modifications.push("Content ID appended");

                      this.log.debug(
                        `Appended Content ID: "${hyperlinkInfo.displayText}" → "${newText}"`
                      );

                      // Clean up orphaned content ID runs (same logic as updateTitles path)
                      const para = hyperlink.paragraph;
                      const content = para.getContent();
                      let hyperlinkIndex = content.findIndex(
                        (item: unknown) => item === hyperlink.hyperlink
                      );

                      // Fallback: when tracking is ON, hyperlink may be wrapped in an insertion Revision
                      if (hyperlinkIndex === -1) {
                        for (let idx = 0; idx < content.length; idx++) {
                          const item = content[idx];
                          if (isRevision(item) && (item as Revision).getType() === "insert") {
                            if (
                              (item as Revision)
                                .getContent()
                                .some((c: unknown) => c === hyperlink.hyperlink)
                            ) {
                              hyperlinkIndex = idx;
                              break;
                            }
                          }
                        }
                      }

                      if (hyperlinkIndex !== -1 && hyperlinkIndex < content.length - 1) {
                        const itemsToRemove: Run[] = [];
                        let combinedText = "";

                        for (let ci = 1; ci <= 3 && hyperlinkIndex + ci < content.length; ci++) {
                          const item = content[hyperlinkIndex + ci];

                          if (this.isRunItem(item)) {
                            const itemText = item.getText();
                            combinedText += itemText;
                            itemsToRemove.push(item);

                            const trimmedText = combinedText.trim();
                            const fullContentIdPattern = new RegExp(`^\\s*\\(${last6}\\)\\s*$`);
                            const partialEndPattern = /^\s*\d*\)\s*$/;

                            if (
                              fullContentIdPattern.test(combinedText) ||
                              trimmedText === ")" ||
                              trimmedText === `(${last6})` ||
                              (partialEndPattern.test(combinedText) && trimmedText.length <= 7)
                            ) {
                              for (const toRemove of itemsToRemove) {
                                para.replaceContent(toRemove, []);
                              }
                              this.log.debug(
                                `Removed ${itemsToRemove.length} orphaned content ID fragment(s): "${trimmedText}"`
                              );
                              break;
                            }

                            // Check for prefixed content ID like "(CMS-PRD1-017428)"
                            const prefixedContentIdPattern2 =
                              /^\s*\((?:[A-Za-z0-9]+-)*\d{4,6}\)\s*$/;
                            if (prefixedContentIdPattern2.test(combinedText)) {
                              for (const toRemove of itemsToRemove) {
                                para.replaceContent(toRemove, []);
                              }
                              this.log.debug(
                                `Removed ${itemsToRemove.length} orphaned prefixed content ID fragment(s): "${trimmedText}"`
                              );
                              break;
                            }

                            if (
                              !/^[\s\d()]+$/.test(combinedText) &&
                              !/^\s*\([\w-]*$/.test(combinedText)
                            ) {
                              break;
                            }
                          } else {
                            break;
                          }
                        }
                      }

                      // Insert trailing punctuation as normal-styled Run after hyperlink
                      if (trailingPunct) {
                        const freshContent = para.getContent();
                        let insertAfterIdx = -1;

                        for (let pi = 0; pi < freshContent.length; pi++) {
                          const item = freshContent[pi];
                          if (item === hyperlink.hyperlink) {
                            insertAfterIdx = pi;
                            break;
                          }
                          if (isRevision(item) && (item as Revision).getType() === "insert") {
                            if (
                              (item as Revision)
                                .getContent()
                                .some((c: unknown) => c === hyperlink.hyperlink)
                            ) {
                              insertAfterIdx = pi;
                              break;
                            }
                          }
                        }

                        if (insertAfterIdx !== -1) {
                          para.insertRunAt(insertAfterIdx + 1, new Run(trailingPunct));
                          this.log.debug(
                            `Inserted trailing "${trailingPunct}" after hyperlink as normal text`
                          );
                        }
                      }

                      // Track the change
                      if (options.trackChanges) {
                        documentProcessingComparison.recordHyperlinkTextChange(
                          hyperlink.paragraphIndex,
                          hyperlink.hyperlinkIndexInParagraph,
                          hyperlinkInfo.displayText,
                          newText,
                          "PowerAutomate API - Content ID Reference",
                          "updated",
                          apiResult.contentId
                        );
                      }
                    }
                  }

                  // Consolidated change tracking for UI - track if URL or text changed
                  if (urlChanged || textChanged) {
                    const nearestHeader2 =
                      this.findNearestHeader2(doc, hyperlink.paragraphIndex) || undefined;

                    // Build description based on what changed
                    let description = "Updated hyperlink";
                    if (urlChanged && textChanged) {
                      description = "Updated hyperlink URL and display text";
                    } else if (urlChanged) {
                      description = "Updated hyperlink URL";
                    } else if (textChanged) {
                      description = "Updated hyperlink display text";
                    }

                    result.changes?.push({
                      type: "hyperlink",
                      category: "hyperlink_update",
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
                      hyperlinkStatus:
                        apiResult.status === "expired" || apiResult.status === "deprecated"
                          ? "expired"
                          : "updated",
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
                    if (hyperlink.isComplexField) {
                      this.setComplexFieldTextTracked(
                        doc,
                        hyperlink.hyperlink as ComplexField,
                        notFoundText,
                        authorName
                      );
                    } else {
                      this.setHyperlinkTextTracked(
                        doc,
                        hyperlink.hyperlink as Hyperlink,
                        hyperlink.paragraph,
                        notFoundText,
                        authorName
                      );
                    }
                    result.updatedDisplayTexts = (result.updatedDisplayTexts || 0) + 1;

                    // Track the change with not_found status for Document Changes UI
                    if (options.trackChanges) {
                      documentProcessingComparison.recordHyperlinkTextChange(
                        hyperlink.paragraphIndex,
                        hyperlink.hyperlinkIndexInParagraph,
                        hyperlinkInfo.displayText,
                        notFoundText,
                        "Source not found in SharePoint",
                        "not_found"
                      );
                    }

                    // Enhanced change tracking for failed hyperlinks
                    const nearestHeader2 =
                      this.findNearestHeader2(doc, hyperlink.paragraphIndex) || undefined;
                    result.changes?.push({
                      type: "hyperlink",
                      category: "hyperlink_failed",
                      description: `Hyperlink not found in SharePoint`,
                      before: hyperlinkInfo.displayText,
                      after: notFoundText,
                      paragraphIndex: hyperlink.paragraphIndex,
                      nearestHeader2,
                      hyperlinkStatus: "not_found",
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
                `API Error: ${errorMessage}. Document not saved to prevent incorrect hyperlink data.`,
                { cause: error }
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

      // Custom replacements (hyperlink URL/text replacements)
      if (options.customReplacements && options.customReplacements.length > 0) {
        this.log.debug("=== APPLYING CUSTOM REPLACEMENTS ===");
        await this.processCustomReplacements(
          hyperlinks,
          options.customReplacements,
          result,
          doc,
          authorName
        );

        // Text replacements across all paragraphs (body + table cells)
        const textRules = options.customReplacements.filter(r => r.applyTo === "text");
        if (textRules.length > 0) {
          this.log.debug("=== APPLYING TEXT REPLACEMENTS (ALL PARAGRAPHS) ===");
          const modifiedRunCount = this.processTextReplacementsAllParagraphs(doc, textRules);
          this.log.info(`Text replacements: modified ${modifiedRunCount} runs across all paragraphs`);
          if (modifiedRunCount > 0) {
            result.changes?.push({
              type: "text",
              category: "other",
              description: `Applied text replacements (${textRules.map(r => `"${r.find}" → "${r.replace}"`).join(", ")}) — modified ${modifiedRunCount} text runs`,
            });
          }
        }
      }

      // ═══════════════════════════════════════════════════════════
      // PROCESSING OPTIONS IMPLEMENTATION
      // Apply all enabled processing options before saving document
      // ═══════════════════════════════════════════════════════════

      // TEXT FORMATTING GROUP
      if (options.removeWhitespace) {
        this.log.debug("=== REMOVING EXTRA WHITESPACE ===");
        // Disable track changes for whitespace removal - these are cosmetic changes
        // that should not appear as Word tracked changes
        doc.disableTrackChanges();
        const whitespaceCleaned = await this.removeExtraWhitespace(doc);
        doc.enableTrackChanges({
          author: authorName,
          trackFormatting: true,
          showInsertionsAndDeletions: true,
          clearExistingPropertyChanges: false,
        });
        this.log.info(`Cleaned whitespace in ${whitespaceCleaned} runs`);

        // Track whitespace removal
        if (whitespaceCleaned > 0) {
          result.changes?.push({
            type: "text",
            category: "structure",
            description: "Removed extra whitespace from text runs",
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
            type: "style",
            category: "structure",
            description: "Removed italic formatting from text",
            count: italicsRemoved,
          });
        }
      }

      // Em/en variant removal now runs BEFORE tracking is enabled (see above)

      // ALWAYS standardize hyperlink formatting to ensure consistency
      // All hyperlinks should be: Verdana 12pt, Blue, Underlined
      // Disable tracking — formatting standardization is cosmetic and should
      // not generate tracked changes (setFormatting silently overwrites anyway,
      // but disabling ensures no rPrChange noise if library behavior changes).
      doc.disableTrackChanges();
      this.log.debug("=== STANDARDIZING HYPERLINK FORMATTING (AUTOMATIC) ===");
      const hyperlinksStandardized = await this.standardizeHyperlinkFormatting(doc);
      this.log.info(`Standardized formatting for ${hyperlinksStandardized} hyperlinks`);
      doc.enableTrackChanges({
        author: authorName,
        trackFormatting: true,
        showInsertionsAndDeletions: true,
        clearExistingPropertyChanges: false,
      });

      // Track automatic hyperlink formatting standardization
      if (hyperlinksStandardized > 0) {
        result.changes?.push({
          type: "hyperlink",
          category: "structure",
          description: "Standardized hyperlink formatting (Verdana 12pt blue underlined)",
          count: hyperlinksStandardized,
        });
      }

      // Collect abstractNumIds used in HLP tables BEFORE list processing.
      // These are protected from format/indentation overrides in bullet/numbered uniformity
      // and from standardizeListPrefixFormatting() to preserve original Symbol font + sizes.
      // Also cache HLP table detection before applyStyles() overwrites FFC000 shading.
      this._hlpAbstractNumIds.clear();
      this._hlpSavedNumbering.clear();
      this._mixedListAbstractNumIds.clear();
      tableProcessor.cacheHLPTables(doc.getTables());
      {
        const manager = doc.getNumberingManager();
        for (const table of doc.getTables()) {
          if (!tableProcessor.isHLPTable(table)) continue;
          for (const row of table.getRows()) {
            for (const cell of row.getCells()) {
              for (const para of cell.getParagraphs()) {
                const numbering = para.getNumbering();
                if (numbering && numbering.numId !== undefined) {
                  if (numbering.numId > 0) {
                    const instance = manager.getNumberingInstance(numbering.numId);
                    if (instance) {
                      this._hlpAbstractNumIds.add(instance.getAbstractNumId());
                    }
                  }
                  // Snapshot per-paragraph numbering (numId + ilvl) BEFORE any processing.
                  // This is restored in processHLPTables() to undo corruption from
                  // applyStyles(), list normalization, or other pipeline steps.
                  // numId=0 paragraphs are saved too — they represent explicitly
                  // suppressed numbering (e.g. "Note:" paragraphs in HLP tables).
                  this._hlpSavedNumbering.set(para, {
                    numId: numbering.numId,
                    level: numbering.level ?? 0,
                    leftIndent: para.getLeftIndent(),
                  });
                } else if (para.isNumberingSuppressed()) {
                  // numId=0 in original XML — explicitly suppressed numbering.
                  this._hlpSavedNumbering.set(para, {
                    numId: 0,
                    level: 0,
                    leftIndent: para.getLeftIndent(),
                  });
                } else if (
                  para.getStyle() === "ListParagraph" ||
                  para.getStyle() === "List Paragraph"
                ) {
                  // ListParagraph with truly no numbering — inherits from style
                  this._hlpSavedNumbering.set(para, {
                    numId: -1,
                    level: 0,
                    leftIndent: para.getLeftIndent(),
                  });
                }
              }
            }
          }
        }
        if (this._hlpAbstractNumIds.size > 0) {
          this.log.debug(
            `Collected ${this._hlpAbstractNumIds.size} HLP abstractNumIds for protection: [${[...this._hlpAbstractNumIds].join(", ")}]`
          );
        }
        if (this._hlpSavedNumbering.size > 0) {
          this.log.debug(`Saved numbering for ${this._hlpSavedNumbering.size} HLP paragraphs`);
        }
      }

      // NOTE: standardizeListPrefixFormatting() runs AFTER all list processing
      // (after standardizeNumberingColors) so it catches ALL abstractNum definitions
      // including those created by ListNormalizer and convertTypedPrefixesWithContext.

      if (options.correctMisappliedStyles) {
        this.log.debug("=== CORRECTING MISAPPLIED PARAGRAPH STYLES ===");
        const misappliedCorrected = this.correctMisappliedParagraphStyles(doc);
        this.log.info(`Corrected ${misappliedCorrected} misapplied paragraph styles`);

        if (misappliedCorrected > 0) {
          result.changes?.push({
            type: "style",
            category: "style_application",
            description:
              "Corrected misapplied TOC/Hyperlink paragraph styles to Normal or ListParagraph",
            count: misappliedCorrected,
          });
        }
      }

      // Convert NormalWeb → Normal EARLY, before any style application.
      // This ensures all downstream processing (assignStylesToDocument, finalizeParagraphSpacing,
      // table uniformity, list normalization, etc.) sees "Normal" consistently.
      {
        let normalWebConverted = 0;
        for (const para of doc.getAllParagraphs()) {
          if (para.getStyle() === "NormalWeb") {
            para.setStyle("Normal");
            normalWebConverted++;
          }
        }
        if (normalWebConverted > 0) {
          this.log.info(
            `Converted ${normalWebConverted} NormalWeb paragraphs to Normal (pre-style-application)`
          );
        }
      }

      // Convert Table Grid → Normal (or Heading 2 for 1x1 tables) EARLY.
      // "Table Grid" is a table style sometimes misapplied as a paragraph style;
      // normalizing it here ensures downstream processing sees proper styles.
      {
        // Collect paragraphs inside 1x1 tables (these become Heading 2)
        const paragraphsIn1x1 = new Set<Paragraph>();
        for (const table of doc.getTables()) {
          const rows = table.getRows();
          if (rows.length === 1 && rows[0].getCells().length === 1) {
            for (const para of rows[0].getCells()[0].getParagraphs()) {
              paragraphsIn1x1.add(para);
            }
          }
        }

        let tableGridToNormal = 0;
        let tableGridToHeading2 = 0;
        for (const para of doc.getAllParagraphs()) {
          const style = para.getStyle();
          if (style === "TableGrid" || style === "Table Grid") {
            if (paragraphsIn1x1.has(para)) {
              para.setStyle("Heading2");
              tableGridToHeading2++;
            } else {
              para.setStyle("Normal");
              tableGridToNormal++;
            }
          }
        }
        if (tableGridToNormal + tableGridToHeading2 > 0) {
          this.log.info(
            `Converted Table Grid paragraphs: ${tableGridToNormal} → Normal, ${tableGridToHeading2} → Heading 2 (pre-style-application)`
          );
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
          this.log.info(
            `Set Heading 2 style on ${heading2Updated} paragraphs in 1x1 tables (before style application)`
          );
        }
      }

      // Apply Heading 1 to the first line of text (user-togglable). Runs BEFORE
      // style application so the heading inherits the configured Heading 1
      // formatting, and before TOC building so the title is excluded from the TOC.
      if (options.applyHeader1ToFirstLine) {
        this.log.debug("=== APPLYING HEADING 1 TO FIRST LINE ===");
        const appliedText = this.applyHeading1ToFirstLine(doc);
        if (appliedText) {
          result.changes?.push({
            type: "structure",
            category: "structure",
            description: `Applied Heading 1 style to first line: "${appliedText}"`,
          });
        }
      }

      if (options.assignStyles && options.styles && options.styles.length > 0) {
        // Save table cell numbering before applyStyles() to prevent framework
        // from silently reassigning numId/ilvl via style defaults
        const savedTableCellNumbering = new Map<Paragraph, { numId: number; level: number }>();
        for (const table of doc.getTables()) {
          for (const row of table.getRows()) {
            for (const cell of row.getCells()) {
              for (const para of cell.getParagraphs()) {
                const numbering = para.getNumbering();
                if (numbering && numbering.numId > 0) {
                  savedTableCellNumbering.set(para, {
                    numId: numbering.numId,
                    level: numbering.level ?? 0,
                  });
                }
              }
            }
          }
        }
        if (savedTableCellNumbering.size > 0) {
          this.log.debug(
            `Saved numbering for ${savedTableCellNumbering.size} table cell paragraphs before applyStyles()`
          );
        }

        // Disable tracking during style application — clearing of redundant direct
        // formatting and style overrides should not appear as tracked changes
        doc.disableTrackChanges();

        this.log.debug("=== ASSIGNING STYLES (USING DOCXMLATER applyStyles) ===");
        // Use docXMLater's native method with preserve flag support
        // This handles style definitions, direct formatting clearing, and Header2 table wrapping
        const styleResults = await this.applyCustomStylesFromUI(
          doc,
          options.styles,
          options.tableShadingSettings,
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
          ? (this.log.debug("Skipping applyH1 - already processed by applyStyles"), 0)
          : doc.applyH1();
        const h2Count = styleResults.heading2
          ? (this.log.debug("Skipping applyH2 - already processed by applyStyles"), 0)
          : doc.applyH2();
        const h3Count = styleResults.heading3
          ? (this.log.debug("Skipping applyH3 - already processed by applyStyles"), 0)
          : doc.applyH3();

        // Re-enable tracking after style application
        doc.enableTrackChanges({
          author: authorName,
          trackFormatting: true,
          showInsertionsAndDeletions: true,
          clearExistingPropertyChanges: false,
        });

        // Restore table cell numbering that applyStyles() may have corrupted
        let restoredCount = 0;
        for (const [para, saved] of savedTableCellNumbering) {
          const current = para.getNumbering();
          if (!current || current.numId !== saved.numId || (current.level ?? 0) !== saved.level) {
            para.setNumbering(saved.numId, saved.level);
            restoredCount++;
          }
        }
        if (restoredCount > 0) {
          this.log.debug(
            `Restored numbering for ${restoredCount} table cell paragraphs after applyStyles()`
          );
        }
        savedTableCellNumbering.clear();
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

      // Re-apply hyperlink formatting after style application.
      // doc.applyStyles() can clear direct run formatting from hyperlink runs that
      // lack rStyle="Hyperlink" character style, causing them to fall back to
      // Normal paragraph formatting (black, no underline).
      // Disable tracking — this is cosmetic formatting repair, not a user-visible change.
      doc.disableTrackChanges();
      try {
        const allHyperlinks = await this.docXMLater.extractHyperlinks(doc);
        let reappliedCount = 0;
        for (const { hyperlink, isComplexField } of allHyperlinks) {
          try {
            const formatting = {
              font: "Verdana",
              size: 12,
              color: "0000FF",
              underline: "single" as const,
              bold: false,
              italic: false,
            };
            if (isComplexField) {
              (hyperlink as ComplexField).setResultFormatting(formatting);
            } else {
              (hyperlink as Hyperlink).setFormatting(formatting);
              (hyperlink as Hyperlink).getRun().setCharacterStyle("Hyperlink");
            }
            reappliedCount++;
          } catch (err) {
            this.log.warn(`Failed to re-apply hyperlink formatting: ${err}`);
          }
        }
        if (reappliedCount > 0) {
          this.log.debug(
            `Re-applied formatting to ${reappliedCount} hyperlinks after style application`
          );
        }
      } catch (error) {
        this.log.warn(`Failed hyperlink formatting safety net: ${error}`);
      }
      doc.enableTrackChanges({
        author: authorName,
        trackFormatting: true,
        showInsertionsAndDeletions: true,
        clearExistingPropertyChanges: false,
      });

      // NOTE: Old blank line blocks (ensureBlankLinesAfter1x1Tables,
      // ensureBlankLinesAfterAllTables, removeExtraParagraphLines) have been
      // replaced by the rule-based BlankLineManager which runs AFTER all
      // list processing is complete. See the blank line processing block below.

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
        !options.assignStyles // Skip if applyStyles already ran with preservation flags
      ) {
        this.log.debug("=== VALIDATING DOCUMENT STYLES ===");
        const results = await this.validateDocumentStyles(doc, options.styles);
        this.log.info(`Validated ${results.applied} styles: ${results.validated.join(", ")}`);

        // Track style validation
        if (results.applied > 0) {
          result.changes?.push({
            type: "style",
            category: "style_application",
            description: `Validated and applied styles: ${results.validated.join(", ")}`,
            count: results.applied,
          });
        }
      } else if (options.operations?.validateDocumentStyles && options.assignStyles) {
        this.log.debug(
          "Skipping validateDocumentStyles - already processed by applyStyles with preservation flags"
        );
      } else if (options.operations?.validateDocumentStyles) {
        this.log.warn(
          "⚠️ validateDocumentStyles is ENABLED but no styles provided! Please configure styles in the Styles tab."
        );
      }

      if (options.operations?.validateHeader2Tables && options.styles) {
        const header2Style = options.styles.find((s: any) => s.id === "header2");
        if (header2Style) {
          // Disable tracking — cell shading changes on 1x1 tables should not
          // generate tcPrChange (causes scrunched tables in Word's "Original" view)
          doc.disableTrackChanges();

          this.log.debug("=== VALIDATING HEADER 2 TABLE FORMATTING ===");
          const tableResult = await this.validateHeader2TableFormatting(
            doc,
            header2Style,
            options.tableShadingSettings
          );
          this.log.info(`Validated and fixed ${tableResult.count} Header 2 table cells`);

          doc.enableTrackChanges({
            author: authorName,
            trackFormatting: true,
            showInsertionsAndDeletions: true,
            clearExistingPropertyChanges: false,
          });

          // Track Header 2 table validation with affected cell names
          if (tableResult.count > 0) {
            result.changes?.push({
              type: "style",
              category: "structure",
              description: "Validated and fixed Header 2 table cell formatting",
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

      // Standardize "Return to" hyperlinks: remove indentation and right-align.
      // This runs AFTER all style processing (applyCustomStylesFromUI, validateDocumentStyles,
      // validateHeader2TableFormatting) so that the right-alignment is not overwritten by
      // Normal style application which resets alignment to "left".
      const returnToLinksFixed = this.standardizeReturnToHyperlinks(doc);
      if (returnToLinksFixed > 0) {
        result.changes?.push({
          type: "hyperlink",
          category: "structure",
          description: 'Standardized "Return to" hyperlinks (indent removed, right-aligned)',
          count: returnToLinksFixed,
        });
      }

      // Clear indentation from center-aligned paragraphs.
      // Per ECMA-376, center alignment renders content centered within text extents;
      // non-zero left indentation shifts the centering reference point, causing misalignment.
      this.log.debug("=== CLEARING CENTER-ALIGNED INDENTATION ===");
      const centerIndentsCleared = this.clearCenterAlignedIndentation(doc);
      if (centerIndentsCleared > 0) {
        this.log.info(`Cleared indentation from ${centerIndentsCleared} center-aligned paragraphs`);
        result.changes?.push({
          type: "style",
          category: "structure",
          description: "Removed indentation from center-aligned paragraphs",
          count: centerIndentsCleared,
        });
      }

      if (options.addDocumentWarning) {
        this.log.debug("=== ADDING/UPDATING DOCUMENT WARNING ===");
        doc.disableTrackChanges();
        await this.addOrUpdateDocumentWarning(doc);
        doc.enableTrackChanges({
          author: authorName,
          trackFormatting: true,
          showInsertionsAndDeletions: true,
          clearExistingPropertyChanges: false,
        });

        // Track document warning addition
        result.changes?.push({
          type: "structure",
          category: "structure",
          description: "Added standardized document warning at end",
        });
      }

      if (options.centerAndBorderImages) {
        // Strip shape-level effects (shadow / reflection / glow) from every
        // image before applying borders or centering. Equivalent to Word's
        // "Format Picture → Effects → No Effects".
        const shadowsCleared = clearAllImageShadows(doc);
        if (shadowsCleared > 0) {
          this.log.info(`Cleared shape effects (shadow/reflection/glow) from ${shadowsCleared} images`);
          result.changes?.push({
            type: "structure",
            category: "structure",
            description: "Removed shadow / shape effects from images",
            count: shadowsCleared,
          });
        }

        // Detect and crop embedded borders from screen captures before applying new borders
        this.log.debug("=== CROPPING EMBEDDED IMAGE BORDERS ===");
        const cropResult = await cropEmbeddedImageBorders(doc, this.log);
        if (cropResult.croppedCount > 0) {
          this.log.info(`Cropped embedded borders from ${cropResult.croppedCount} images`);
          result.changes?.push({
            type: "structure",
            category: "structure",
            description: "Cropped embedded borders from screen-captured images",
            count: cropResult.croppedCount,
          });
        }

        this.log.debug("=== CENTERING AND BORDERING IMAGES ===");
        const borderWidth = options.tableShadingSettings?.imageBorderWidth ?? 1.0;
        const minEmus = Math.round(96 * 9525); // 96px threshold = 1 inch at 96 DPI

        let centeredCount = 0;
        let borderedCount = 0;
        let skippedBorderCount = 0;

        for (const paragraph of doc.getAllParagraphs()) {
          const allImages = collectParagraphImages(paragraph);
          const largeImages = allImages.filter(
            (image) => image.getWidth() >= minEmus || image.getHeight() >= minEmus
          );
          // Cropped/word-cropped images may not meet the size threshold — include them too
          const extraImages = allImages.filter(
            (image) => (cropResult.croppedImages.has(image) || cropResult.wordCroppedImages.has(image)) && !largeImages.includes(image)
          );
          const imagesToProcess = [...largeImages, ...extraImages];

          if (imagesToProcess.length === 0) continue;

          // Center the paragraph (always, regardless of border decision)
          // Override style-inherited indentation from ListParagraph by explicitly
          // setting left indent and first line to 0. Also switch style to Normal.
          const imgParaStyle = paragraph.getStyle() || "";
          if (imgParaStyle === "ListParagraph" || imgParaStyle === "List Paragraph") {
            paragraph.setStyle("Normal");
          }
          paragraph.formatting.indentation = undefined;
          paragraph.setLeftIndent(0);
          paragraph.setFirstLineIndent(0);
          paragraph.setAlignment("center");
          centeredCount++;

          // Selectively border each image (uses cached results from crop step)
          for (const image of imagesToProcess) {
            if (cropResult.wordCroppedImages.has(image)) {
              // Word-cropped: preserve crop, ensure border at UI thickness
              const existing = image.getBorder();
              if (existing && existing.width === borderWidth) {
                skippedBorderCount++;
              } else {
                image.setBorder(borderWidth);
                borderedCount++;
              }
            } else if (cropResult.allSideBakedBorderImages.has(image)) {
              skippedBorderCount++;
              this.log.debug("Skipped Word border for image with baked-in border on all 4 sides");
            } else {
              image.setBorder(borderWidth);
              borderedCount++;
            }
          }
        }

        if (centeredCount > 0 || borderedCount > 0) {
          this.log.info(
            `Images: ${centeredCount} centered, ${borderedCount} bordered, ${skippedBorderCount} border-skipped (baked-in)`
          );
        }

        if (centeredCount > 0) {
          result.changes?.push({
            type: "structure",
            category: "structure",
            description:
              skippedBorderCount > 0
                ? `Centered ${centeredCount} images (${borderedCount} bordered, ${skippedBorderCount} had baked-in borders)`
                : `Centered and bordered ${centeredCount} images`,
            count: centeredCount,
          });
        }
      }

      // === IMAGE COMPRESSION (always-on) ===
      // Must run after the bordering stage above — allSideBakedBorderImages cache
      // relies on Image object identity from cropEmbeddedImageBorders().
      this.log.debug("=== OPTIMIZING IMAGES ===");
      const imageOptResult = await doc.optimizeImages();
      if (imageOptResult.optimizedCount > 0) {
        const savedKB = (imageOptResult.totalSavedBytes / 1024).toFixed(1);
        this.log.info(`Optimized ${imageOptResult.optimizedCount} images, saved ${savedKB} KB`);
        result.changes?.push({
          type: "structure",
          category: "structure",
          description: "Compressed images",
          count: imageOptResult.optimizedCount,
        });
      } else {
        this.log.info("No images needed optimization");
      }

      if (options.removeHeadersFooters) {
        this.log.debug("=== CLEARING HEADERS/FOOTERS ===");
        const headersFootersCleared = doc.clearAllHeaderFooterContent();
        this.log.info(`Cleared content from ${headersFootersCleared} headers/footers`);

        // Also clear footnotes and endnotes
        const footnoteCount = doc.getFootnoteManager().getCount();
        const endnoteCount = doc.getEndnoteManager().getCount();
        if (footnoteCount > 0) {
          doc.clearFootnotes();
          this.log.info(`Cleared ${footnoteCount} footnotes`);
        }
        if (endnoteCount > 0) {
          doc.clearEndnotes();
          this.log.info(`Cleared ${endnoteCount} endnotes`);
        }

        // Track changes
        const totalCleared = headersFootersCleared + footnoteCount + endnoteCount;
        if (totalCleared > 0) {
          result.changes?.push({
            type: "structure",
            category: "structure",
            description: "Cleared headers, footers, footnotes, and endnotes",
            count: totalCleared,
          });
        }
      }

      // Detect whether any numbered list needs wider hanging indent (10+ items at level 0)
      // Must run before all list processing so the flag is available in every indent code path
      this.needsWiderHangingIndent = this.detectNeedsWiderHangingIndent(doc);

      // LISTS & TABLES GROUP
      // First, normalize typed list prefixes to proper Word lists
      // This converts manually typed prefixes like "1.", "a.", "•" to proper <w:numPr> formatting
      //
      // Tracking is disabled for the entire list/bullet config pass below.
      // List normalization re-levels and re-numbers paragraphs en masse (minority
      // subordination, orphan level shifts, bullet/numbered uniformity, indentation
      // uniformity, numbering colors, prefix formatting). Surfacing each of those
      // as a tracked revision pollutes Word's change log with noise the user
      // didn't author. Re-enabled at the end of the section.
      doc.disableTrackChanges();
      // List normalization runs when normalizeTableLists is on OR any list
      // processing option (bullet uniformity / list bullet settings) is
      // enabled. Without this broader gate, the body-path mixed-list pattern
      // detection never fires for users who haven't explicitly toggled
      // "Normalize Table Lists" — leaving mixed bullet/numbered lists at the
      // mercy of consolidateNumbering, which merges input abstracts and
      // strips the dynamic cascade pattern. See List.docx regression.
      if (
        options.normalizeTableLists ||
        options.listBulletSettings?.enabled ||
        options.bulletUniformity
      ) {
        // First, pre-process extended typed prefixes that DocXMLater doesn't handle
        // (parenthetical numbers, Roman numerals, etc.)
        this.debugCaptureListState(doc, "BEFORE preProcessExtendedTypedPrefixes");
        const extendedPrefixesConverted = this.preProcessExtendedTypedPrefixes(doc);
        this.debugCaptureListState(doc, "AFTER preProcessExtendedTypedPrefixes");

        if (extendedPrefixesConverted > 0) {
          result.changes?.push({
            type: "structure",
            category: "list_fix",
            description:
              "Converted extended typed prefixes (Roman numerals, parenthetical) to Word numbering",
            count: extendedPrefixesConverted,
          });
        }

        // Then run local ListNormalizer for standard patterns (moved from docxmlater)
        this.debugCaptureListState(doc, "BEFORE normalizeTableLists");
        this.log.debug("=== NORMALIZING TYPED LIST PREFIXES IN TABLES ===");
        // Use local ListNormalizer with bug fix for standalone typed list level assignment
        const listNormalizer = new ListNormalizer(doc.getNumberingManager());
        const normReport = listNormalizer.normalizeAllTables(
          doc.getAllTables().filter((t) => !tableProcessor.isHLPTable(t)),
          {
            indentationLevels: options.listBulletSettings?.indentationLevels,
            extraHangingIndentTwips: this.getExtraHangingTwips(),
            trackMixedListAbstractNumIds: this._mixedListAbstractNumIds,
          }
        );
        if (normReport.normalized > 0) {
          this.log.info(
            `Normalized ${normReport.normalized} typed list items to proper Word lists (majority: ${normReport.appliedCategory})`
          );
          result.changes?.push({
            type: "structure",
            category: "list_fix",
            description: "Converted typed list prefixes to proper Word list formatting",
            count: normReport.normalized,
          });
        }
        if (normReport.errors.length > 0) {
          this.log.warn(
            `List normalization had ${normReport.errors.length} errors:`,
            normReport.errors
          );
        }
        this.debugCaptureListState(doc, "AFTER normalizeTableLists");
        if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
          this.log.debug(
            `  normalizeTableLists Report: normalized=${normReport.normalized}, category=${normReport.appliedCategory}`
          );
        }

        // Step B.5: Context-aware typed prefix conversion (body + table cells)
        // This catches typed prefixes that Steps A/B missed (body paragraphs) and applies
        // context-aware conversion: typed prefixes after list items become sub-items
        this.debugCaptureListState(doc, "BEFORE convertTypedPrefixesWithContext");
        const contextPrefixesConverted = this.convertTypedPrefixesWithContext(doc, {
          indentationLevels: options.listBulletSettings?.indentationLevels,
        });
        this.debugCaptureListState(doc, "AFTER convertTypedPrefixesWithContext");

        if (contextPrefixesConverted > 0) {
          this.log.info(
            `Context-aware typed prefix conversion: ${contextPrefixesConverted} items converted`
          );
          result.changes?.push({
            type: "structure",
            category: "list_fix",
            description: "Context-aware conversion of typed list prefixes to Word numbering",
            count: contextPrefixesConverted,
          });
        }

        // NOTE: Blank line operations (removeBlanksBetweenListItems, ensureBlankLinesAfterLists)
        // have been moved to the rule-based BlankLineManager which runs AFTER all list processing.
      }

      // Normalize orphan Level 1+ bullets in table cells
      // If a cell's first bullet is Level 1+ with no preceding Level 0, shift all bullets down
      if (options.listBulletSettings?.enabled || options.bulletUniformity) {
        this.debugCaptureListState(doc, "BEFORE normalizeOrphanListLevelsInTable");
        this.log.debug("=== NORMALIZING ORPHAN LIST LEVELS IN TABLE CELLS ===");
        const tables = doc.getTables();
        let orphanLevelsFixed = 0;
        for (const table of tables) {
          // Skip floating tables, tables containing nested tables, and HLP tables
          if (tableProcessor.shouldSkipTable(table)) continue;
          if (tableProcessor.isHLPTable(table)) continue;
          orphanLevelsFixed += normalizeOrphanListLevelsInTable(table);
        }
        if (orphanLevelsFixed > 0) {
          this.log.info(`Normalized ${orphanLevelsFixed} orphan list levels in table cells`);
        }
        this.debugCaptureListState(doc, "AFTER normalizeOrphanListLevelsInTable");
      }

      // Normalize orphan Level 1+ bullets in body paragraphs
      if (options.listBulletSettings?.enabled || options.bulletUniformity) {
        this.debugCaptureListState(doc, "BEFORE normalizeOrphanBodyListLevels");
        this.log.debug("=== NORMALIZING ORPHAN LIST LEVELS IN BODY ===");
        const bodyOrphansFixed = this.normalizeOrphanBodyListLevels(doc);
        if (bodyOrphansFixed > 0) {
          this.log.info(`Normalized ${bodyOrphansFixed} orphan list levels in body paragraphs`);
        }
        this.debugCaptureListState(doc, "AFTER normalizeOrphanBodyListLevels");
      }

      // Collapse non-contiguous level gaps (e.g., 0→1→3→4 becomes 0→1→2→3)
      if (options.listBulletSettings?.enabled || options.bulletUniformity) {
        this.debugCaptureListState(doc, "BEFORE normalizeLevelGaps");
        this.log.debug("=== NORMALIZING LIST LEVEL GAPS ===");
        const gapsFixed = this.normalizeLevelGaps(doc);
        if (gapsFixed > 0) {
          this.log.info(`Collapsed ${gapsFixed} level gaps in list sequences`);
        }
        this.debugCaptureListState(doc, "AFTER normalizeLevelGaps");
      }

      // Normalize list levels based on visual indentation (format clustering).
      // Runs AFTER orphan normalization and gap collapsing so those passes operate
      // on raw ilvl values and format clustering has the final say on sub-bullet levels.
      if (options.listBulletSettings?.enabled && options.listBulletSettings.indentationLevels) {
        this.debugCaptureListState(doc, "BEFORE normalizeListLevelsFromIndentation");
        this.log.debug("=== NORMALIZING LIST LEVELS FROM VISUAL INDENTATION ===");
        const levelsNormalized = await this.normalizeListLevelsFromIndentation(doc, {
          indentationLevels: options.listBulletSettings.indentationLevels,
        });
        if (levelsNormalized > 0) {
          this.log.info(`Normalized ${levelsNormalized} list item levels from visual indentation`);
        }
        this.debugCaptureListState(doc, "AFTER normalizeListLevelsFromIndentation");
      }

      if (options.listBulletSettings?.enabled) {
        this.debugCaptureListState(doc, "BEFORE applyListIndentationUniformity");
        this.log.debug("=== APPLYING LIST INDENTATION UNIFORMITY ===");
        const listsFormatted = await this.applyListIndentationUniformity(
          doc,
          options.listBulletSettings
        );
        this.log.info(`Applied indentation to ${listsFormatted} list paragraphs`);
        this.debugCaptureListState(doc, "AFTER applyListIndentationUniformity");
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

      // Format step-number and typed-number columns BEFORE bullet/numbered uniformity
      // so the tracking Set is populated when those methods check it
      {
        const normalStyle = options.styles?.find((s: SessionStyle) => s.id === "normal");
        const normalStyleInfo = {
          fontFamily: normalStyle?.fontFamily ?? "Verdana",
          fontSize: normalStyle?.fontSize ?? 12,
          spaceBefore: normalStyle?.spaceBefore ?? 3,
          spaceAfter: normalStyle?.spaceAfter ?? 3,
        };

        const stepColsFormatted = this.formatStepNumberColumns(doc, normalStyleInfo);
        if (stepColsFormatted > 0) {
          this.log.info(`Formatted ${stepColsFormatted} Step number columns in tables`);
        }

        const typedColsFixed = this.standardizeRowNumberColumns(doc, normalStyleInfo);
        if (typedColsFixed > 0) {
          this.log.info(`Standardized ${typedColsFixed} typed-number columns in tables`);
        }
      }

      if (options.bulletUniformity && options.listBulletSettings) {
        this.debugCaptureListState(doc, "BEFORE applyBulletUniformity/applyNumberedUniformity");
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
        this.debugCaptureListState(doc, "AFTER applyBulletUniformity/applyNumberedUniformity");


        // Remove w:tab val="num" tab stops from list level definitions in numbering.xml.
        // These tab stops create additional visual indentation that the indentation calculations
        // (which only use w:ind) don't account for.
        // ORDERING: Must run AFTER all NumberingManager API calls (applyBulletUniformity,
        // applyNumberedUniformity) because it uses raw XML
        // getPart/setPart which would be overwritten by later API-based saves.
        const tabStopsRemoved = await this.removeNumberingTabStops(doc);
        if (tabStopsRemoved > 0) {
          this.log.info(`Removed ${tabStopsRemoved} numbering tab stops from list levels`);
        }

        // Track list formatting changes
        const totalListsFixed = bulletsStandardized + numbersStandardized;
        if (totalListsFixed > 0) {
          result.changes?.push({
            type: "structure",
            category: "list_fix",
            description: "Standardized list formatting and indentation",
            count: totalListsFixed,
          });
        }

        // NOTE: Blank lines after lists are handled by the rule-based
        // BlankLineManager (afterListItemsRule in additionRules.ts)
      }

      // Remove small indentation (< 0.25") from non-list paragraphs BEFORE
      // list continuation indentation runs. This prevents trivially-indented text
      // (e.g. 132 twips / 0.09") from being misinterpreted as intentional indent
      // and incorrectly promoted to a full list-continuation indent.
      const smallIndentsRemoved = removeSmallIndents(doc);
      if (smallIndentsRemoved > 0) {
        this.log.info(
          `Removed small indentation (< 0.25") from ${smallIndentsRemoved} non-list paragraphs`
        );
      }

      // Force every real list-item paragraph to left alignment. Center / right /
      // justify on a list item leaves the bullet in an unexpected spot relative
      // to its text and is almost never intentional.
      const listItemsAligned = leftAlignListItems(doc);
      if (listItemsAligned > 0) {
        this.log.info(`Left-aligned ${listItemsAligned} list-item paragraph(s)`);
        result.changes?.push({
          type: "structure",
          category: "structure",
          description: "Left-aligned list-item paragraphs",
          count: listItemsAligned,
        });
      }

      // Normalize alignment on paragraphs whose preceding paragraph has a
      // deletion-marked paragraph mark — Word merges those at render time
      // and adopts the trailing paragraph's alignment, surprising the user
      // when the leading content was never authored as centered. Run this
      // BEFORE table uniformity so shaded data/header cells can re-center
      // afterward and stay centered as expected.
      const deletedMarkFixed = stripCenterAfterDeletedParaMark(doc);
      if (deletedMarkFixed > 0) {
        this.log.info(
          `Normalized alignment on ${deletedMarkFixed} paragraph(s) after deleted paragraph marks`
        );
        result.changes?.push({
          type: "structure",
          category: "structure",
          description: "Normalized alignment after tracked paragraph-mark deletions",
          count: deletedMarkFixed,
        });
      }

      // Flatten a single-level TOC's inherited left-indent. When every TOC
      // entry uses the same TOC style (e.g. only Heading 2 was included),
      // the built-in style indent makes the whole TOC look shifted right.
      const tocFlatten = flattenSingleLevelToc(doc);
      if (tocFlatten.flattened) {
        this.log.info(
          `Flattened single-level TOC: zeroed left-indent on ${tocFlatten.paragraphs} ${tocFlatten.flattenedStyle} paragraphs`
        );
        result.changes?.push({
          type: "structure",
          category: "structure",
          description: "Removed inherited indent from single-level TOC entries",
          count: tocFlatten.paragraphs,
        });
      }

      // Apply list continuation indentation to non-list paragraphs that follow list items
      // These are "continuation" paragraphs that should align with the list item's text
      if (options.listBulletSettings?.enabled) {
        this.debugCaptureListState(doc, "BEFORE applyListContinuationIndentation");
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
          this.log.info(
            `Applied list continuation indentation to ${totalIndented} paragraphs (${tableIndented} in tables, ${bodyIndented} in body)`
          );
        }
        this.debugCaptureListState(doc, "AFTER applyListContinuationIndentation");
      }

      // Standardize numbering colors to fix green bullet issue
      // NOTE: Indentation is now set via in-memory model in applyBulletUniformity()
      // The old injectIndentationToNumbering() raw XML approach was ineffective (changes lost during save)
      if (options.listBulletSettings?.enabled || options.bulletUniformity) {
        if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
          this.log.debug(
            "=== LIST DEBUG: BEFORE standardizeNumberingColors (modifies numbering.xml) ==="
          );
        }
        this.log.debug("=== STANDARDIZING NUMBERING COLORS ===");
        const colorFixed = await this.standardizeNumberingColors(doc);
        if (colorFixed) {
          this.log.info("Standardized all numbering colors to black");
        }
        if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
          this.log.debug("=== LIST DEBUG: AFTER standardizeNumberingColors ===");
        }
      }

      // Standardize list prefix formatting AFTER all list processing is complete.
      // This ensures ALL abstractNum definitions (including those created by
      // ListNormalizer, convertTypedPrefixesWithContext, and applyBulletUniformity)
      // have bold cleared and numbered levels standardized to Verdana 12pt black.
      if (options.standardizeListPrefixFormatting) {
        this.log.debug("=== STANDARDIZING LIST PREFIX FORMATTING ===");
        const listPrefixesStandardized = await this.standardizeListPrefixFormatting(doc);
        this.log.info(`Standardized formatting for ${listPrefixesStandardized} list prefix levels`);

        if (listPrefixesStandardized > 0) {
          result.changes?.push({
            type: "style",
            category: "structure",
            description: "Standardized list prefix formatting (Verdana 12pt black, no bold)",
            count: listPrefixesStandardized,
          });
        }
      }

      // Re-enable tracking now that the list/bullet config pass is complete.
      // Subsequent operations (bold colons, blank lines, etc.) are user-visible
      // edits that should be tracked normally.
      doc.enableTrackChanges({
        author: authorName,
        trackFormatting: true,
        showInsertionsAndDeletions: true,
        clearExistingPropertyChanges: false,
      });

      // Bold colon formatting (before blank lines so startsWithBoldColon detects correctly)
      const boldColonsFixed = this.standardizeBoldColonFormatting(doc);
      if (boldColonsFixed > 0) {
        this.log.info(`Bolded ${boldColonsFixed} colons in bold+colon label paragraphs`);
      }

      // Second whitespace pass: clean up leading spaces introduced or exposed
      // by list normalization, typed prefix stripping, or bold colon formatting.
      if (options.removeWhitespace) {
        doc.disableTrackChanges();
        const secondPassCleaned = await this.removeExtraWhitespace(doc);
        doc.enableTrackChanges({
          author: authorName,
          trackFormatting: true,
          showInsertionsAndDeletions: true,
          clearExistingPropertyChanges: false,
        });
        if (secondPassCleaned > 0) {
          this.log.info(`Second whitespace pass cleaned ${secondPassCleaned} additional runs`);
          result.changes?.push({
            type: "text",
            category: "structure",
            description: "Second-pass whitespace cleanup after list/style processing",
            count: secondPassCleaned,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════
      // RULE-BASED BLANK LINE PROCESSING
      // Runs AFTER all list normalization, indentation, and bullet uniformity
      // so that list items are fully identified before blank line rules evaluate.
      // Disable tracked changes so blank line operations are auto-accepted.
      // ═══════════════════════════════════════════════════════════
      if (options.removeParagraphLines) {
        this.log.debug("=== RULE-BASED BLANK LINE PROCESSING ===");

        // Mark field paragraphs as preserved BEFORE blank line processing
        // to protect TOC and other complex field structures
        const fieldParasMarked = this.markFieldParagraphsAsPreserved(doc);
        if (fieldParasMarked > 0) {
          this.log.debug(
            `Marked ${fieldParasMarked} field paragraphs as preserved (TOC protection)`
          );
        }

        // Disable track changes - blank line operations should not appear as tracked changes
        doc.disableTrackChanges();

        const normalStyle = options.styles?.find((s: any) => s.id === "normal");
        const blankLineResult = blankLineManager.processBlankLines(doc, blankLineSnapshot, {
          stopBoldColonAfterHeading: "Related Documents",
          listBulletSettings: options.listBulletSettings,
          normalStyleFormatting: normalStyle
            ? {
                spaceBefore: pointsToTwips(normalStyle.spaceBefore),
                spaceAfter: pointsToTwips(normalStyle.spaceAfter),
                lineSpacing: pointsToTwips(normalStyle.lineSpacing * 12),
                fontSize: normalStyle.fontSize,
                fontFamily: normalStyle.fontFamily,
              }
            : undefined,
        });

        // Re-enable track changes
        doc.enableTrackChanges({
          author: authorName,
          trackFormatting: true,
          showInsertionsAndDeletions: true,
          clearExistingPropertyChanges: false,
        });

        this.log.info(
          `✓ Blank line processing: removed ${blankLineResult.removed}, ` +
            `added ${blankLineResult.added}, preserved ${blankLineResult.preserved}, ` +
            `indentation fixed ${blankLineResult.indentationFixed}`
        );

        // Track blank line changes in condensed format
        const totalBlankLineChanges = blankLineResult.removed + blankLineResult.added;
        if (totalBlankLineChanges > 0) {
          result.changes?.push({
            type: "structure",
            category: "blank_lines",
            description: "Standardized blank lines using rule-based engine",
            count: totalBlankLineChanges,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════
      // DOCUMENT ORIENTATION AND MARGINS (moved before table processing)
      // Set landscape orientation and 1" margins BEFORE tables are sized,
      // then rescale existing table grids to fit the landscape page width.
      // ═══════════════════════════════════════════════════════════

      // Disable track changes - landscape orientation and table rescaling are
      // structural/layout changes that should not appear as tracked changes.
      // Without this, tcPrChange records old portrait widths, causing tables
      // to appear scrunched in Word's "Original" view.
      doc.disableTrackChanges();

      if (options.setLandscapeMargins) {
        this.log.debug("=== SETTING LANDSCAPE ORIENTATION AND MARGINS ===");

        // Set landscape orientation
        doc.setPageOrientation("landscape");

        // Set 1" margins on all sides (1440 twips = 1 inch)
        doc.setMargins({
          top: 1440,
          bottom: 1440,
          left: 1440,
          right: 1440,
          header: 720,
          footer: 720,
          gutter: 0,
        });

        // Force Print Layout view so Word doesn't open in Web Layout
        doc.setDocumentView("print");

        // Rescale table grids from portrait to landscape available width
        const section = doc.getSection();
        const pageSize = section.getPageSize();
        const margins = section.getMargins();
        if (pageSize && margins) {
          const availableWidth = pageSize.width - (margins.left ?? 1440) - (margins.right ?? 1440);
          for (const table of doc.getTables()) {
            if (tableProcessor.shouldSkipTable(table)) continue;
            const grid = table.getTableGrid();
            if (grid && grid.length > 0) {
              const gridSum = grid.reduce((s: number, w: number) => s + w, 0);
              if (gridSum > 0 && gridSum < availableWidth) {
                const scale = availableWidth / gridSum;
                table.setTableGrid(grid.map((w: number) => Math.round(w * scale)));
              }
            }
            // Use percentage (5000 = 100%) rather than absolute DXA value.
            // Setting DXA values with the original 'pct' widthType causes Word
            // to interpret the value as fiftieths-of-a-percent (e.g., 12960/50 = 259.2%).
            table.setWidthType("pct");
            table.setWidth(5000);
          }
        }

        this.log.info('Set document to landscape orientation with 1" margins');
        result.changes?.push({
          type: "structure",
          category: "structure",
          description: 'Set landscape orientation with 1" margins',
        });
      }

      if (options.tableUniformity) {
        this.log.debug("=== APPLYING TABLE UNIFORMITY (DOCXMLATER 1.7.0) ===");
        this.log.info(
          `[DEBUG] tableUniformity=true, smartTables=${options.smartTables} (BOTH will run if both true!)`
        );
        const tablesFormatted = await this.applyTableUniformity(doc, options);
        this.log.info(
          `Applied standard formatting to ${tablesFormatted.tablesProcessed} tables (shading, borders, autofit, patterns)`
        );

        // Center numeric cells (step numbers like "1", "2", "3")
        const centeredCount = await tableProcessor.centerNumericCells(doc);
        if (centeredCount > 0) {
          this.log.info(`Centered ${centeredCount} numeric table cells`);
        }

        // Apply cell padding based on "Adjust Table Padding" processing option
        // When disabled, tables keep their existing padding (no modification)
        const adjustTablePadding = options.enabledOperations?.includes("adjust-table-padding");
        if (adjustTablePadding) {
          // Apply custom padding from user settings
          const cellPaddingApplied = await tableProcessor.applyTablePadding(
            doc,
            options.tableShadingSettings
          );
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
            type: "table",
            category: "structure",
            description: "Applied table shading and formatting",
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
            type: "table",
            category: "structure",
            description: "Applied smart table detection and formatting",
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
      const normalStyle = options.styles?.find((s: SessionStyle) => s.id === "normal");
      const hiddenTextCount = this.applyHiddenTextStyle(doc, normalStyle);
      if (hiddenTextCount > 0) {
        result.changes?.push({
          type: "style",
          category: "style_application",
          description: "Applied Hidden Text style to white font runs",
          count: hiddenTextCount,
        });
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
      // Build settings from session styles for HLP content formatting
      const hlpNormalStyle = options.styles?.find((s: { id: string }) => s.id === "normal");
      const hlpHeading2Style = options.styles?.find((s: { id: string }) => s.id === "header2");
      const hlpSettings = {
        header2Shading: options.tableShadingSettings?.header2Shading?.replace("#", "") || "BFBFBF",
        otherShading: options.tableShadingSettings?.otherShading?.replace("#", "") || "DFDFDF",
        heading2FontFamily: hlpHeading2Style?.fontFamily ?? "Verdana",
        heading2FontSize: hlpHeading2Style?.fontSize ?? 14,
        normalFontFamily: hlpNormalStyle?.fontFamily ?? "Verdana",
        normalFontSize: hlpNormalStyle?.fontSize ?? 12,
        normalSpaceBefore: hlpNormalStyle?.spaceBefore ?? 3,
        normalSpaceAfter: hlpNormalStyle?.spaceAfter ?? 3,
        normalLineSpacing: hlpNormalStyle?.lineSpacing ?? 1.0,
        listIndentationLevels: options.listBulletSettings?.indentationLevels,
      };
      const hlpResult = await tableProcessor.processHLPTables(
        doc,
        hlpSettings,
        this._hlpSavedNumbering.size > 0 ? this._hlpSavedNumbering : undefined
      );
      this._hlpSavedNumbering.clear();
      tableProcessor.clearHLPTableCache();

      if (hlpResult.tablesFound > 0) {
        this.log.info(
          `Processed ${hlpResult.tablesFound} HLP tables (${hlpResult.singleColumnTables} single-col, ${hlpResult.twoColumnTables} two-col), ${hlpResult.headersStyled} headers styled`
        );
        result.changes?.push({
          type: "table",
          category: "structure",
          description: `Applied HLP formatting to ${hlpResult.tablesFound} table(s)`,
          count: hlpResult.tablesFound,
        });
      }

      // ═══════════════════════════════════════════════════════════
      // STEP TABLE DETECTION
      // Identifies tables with a "Step" header and numeric data cells.
      // Does NOT modify grid or tcW here — changes are applied after
      // autofit/normalize so original widths (especially in pct tables)
      // are preserved.
      // ═══════════════════════════════════════════════════════════
      const tables = doc.getTables();
      // Cache shouldSkipTable + isHLPTable per table once so downstream passes
      // (step detection, autofit, normalize, min-width/step-column merged pass)
      // do not re-execute the predicates.
      const tableClassification = tableProcessor.classifyTables(doc);
      const stepTableSet = new Set<(typeof tables)[0]>();
      let stepTablesFixed = 0;

      for (const table of tables) {
        if (tableClassification.get(table)?.skip) continue;

        const rows = table.getRows();
        if (rows.length < 2) continue;

        const headerRow = rows[0];
        const firstCell = headerRow.getCells()[0];
        if (!firstCell) continue;

        const headerText = firstCell.getText().trim().toLowerCase();
        if (headerText !== "step") continue;

        // Validate data cells: must be numeric (e.g. "1", "2.", "3") or empty
        let isStepTable = true;
        for (let i = 1; i < rows.length; i++) {
          const dataCell = rows[i].getCells()[0];
          if (!dataCell) {
            isStepTable = false;
            break;
          }
          const cellText = dataCell.getText().trim();
          if (cellText && !/^\d+\.?$/.test(cellText)) {
            isStepTable = false;
            break;
          }
        }

        if (isStepTable) {
          stepTableSet.add(table);
          this.log.debug(
            `Detected "Step" table (${rows.length} rows) — will fix column width after autofit`
          );
          stepTablesFixed++;
        }
      }

      if (stepTablesFixed > 0) {
        this.log.info(`Fixed ${stepTablesFixed} "Step" tables with 1" first column`);
        result.changes?.push({
          type: "table",
          category: "structure",
          description: 'Set "Step" table first column to 1 inch',
          count: stepTablesFixed,
        });
      }

      // ═══════════════════════════════════════════════════════════
      // TABLE AUTOFIT TO WINDOW WITH WIDTH PRESERVATION
      // 1. Save cell widths (tcW) and clear all tcW + trHeight
      // 2. Set auto-fit layout
      // 3. Restore saved tcW
      // Row heights (trHeight) are permanently cleared.
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== SETTING TABLES TO AUTOFIT WINDOW (WITH WIDTH PRESERVATION) ===");
      let autofitCount = 0;

      for (const table of tables) {
        if (tableClassification.get(table)?.skip) continue;

        const rows = table.getRows();

        // 1. Save cell widths per row and clear tcW + trHeight
        const savedWidths: Array<
          Array<{ width: number | undefined; widthType: string | undefined }>
        > = [];
        for (const row of rows) {
          const rowWidths: Array<{ width: number | undefined; widthType: string | undefined }> = [];
          for (const cell of row.getCells()) {
            rowWidths.push({
              width: cell.getWidth(),
              widthType: cell.getWidthType(),
            });
            // Clear cell width
            cell.setWidthType(0, "auto");
          }
          savedWidths.push(rowWidths);
          // Permanently clear row height
          row.clearHeight();
        }

        // 2. Set auto-fit layout
        table.setLayout("auto");
        autofitCount++;

        // 3. Restore saved cell widths
        for (let r = 0; r < rows.length; r++) {
          const cells = rows[r].getCells();
          const rowWidths = savedWidths[r];
          if (!rowWidths) continue;

          for (let c = 0; c < cells.length; c++) {
            const saved = rowWidths[c];
            if (saved && saved.width !== undefined && saved.widthType) {
              cells[c].setWidthType(saved.width, saved.widthType as "auto" | "dxa" | "pct");
            }
          }
        }
      }

      if (autofitCount > 0) {
        this.log.info(
          `Set ${autofitCount} tables to autofit window layout (widths preserved, heights cleared)`
        );
        result.changes?.push({
          type: "table",
          category: "structure",
          description: "Set tables to autofit window layout",
          count: autofitCount,
        });
      }
      // ═══════════════════════════════════════════════════════════
      // NORMALIZE CELL WIDTHS (tcW) TO MATCH TABLE GRID (tblGrid)
      // After all table processing, ensure each cell's tcW matches
      // the sum of its spanned tblGrid columns to prevent Word's
      // autofit from collapsing columns to near-zero width.
      // ═══════════════════════════════════════════════════════════
      for (const table of doc.getTables()) {
        if (tableClassification.get(table)?.skip) continue;
        const grid = table.getTableGrid();
        if (!grid || grid.length === 0) continue;

        for (const row of table.getRows()) {
          let gridIdx = 0;
          for (const cell of row.getCells()) {
            if (gridIdx >= grid.length) break;
            const span = cell.getColumnSpan() || 1;
            let expectedWidth = 0;
            for (let s = 0; s < span && gridIdx + s < grid.length; s++) {
              expectedWidth += grid[gridIdx + s];
            }
            const currentWidth = cell.getWidth();
            const currentType = cell.getWidthType();
            if (
              currentWidth !== undefined &&
              (currentWidth !== expectedWidth || currentType !== "dxa")
            ) {
              cell.setWidthType(expectedWidth, "dxa");
            }
            gridIdx += span;
          }
        }
      }

      // ═══════════════════════════════════════════════════════════
      // ENFORCE MIN COLUMN WIDTH + STEP COLUMN FIX (MERGED PASS)
      // Single consolidated pass in TableProcessor: widens narrow columns
      // to 1" by redistributing surplus, then rescales step tables to
      // available page width. Each cell's tcW is written at most once.
      // ═══════════════════════════════════════════════════════════
      const { minWidthTablesAdjusted } = tableProcessor.enforceMinimumColumnWidth(
        doc,
        tableClassification,
        stepTableSet
      );

      if (minWidthTablesAdjusted > 0) {
        this.log.info(
          `Enforced minimum 1" column width on ${minWidthTablesAdjusted} tables`
        );
        result.changes?.push({
          type: "table",
          category: "structure",
          description: "Enforced minimum 1\" column width",
          count: minWidthTablesAdjusted,
        });
      }

      // ═══════════════════════════════════════════════════════════
      // TABLE BORDER STANDARDIZATION (CONDITIONAL)
      // Standardize all table and cell borders to uniform thickness.
      // Runs LAST in the table pipeline so borders survive all
      // width operations (autofit, normalize, step column fix).
      // ═══════════════════════════════════════════════════════════
      if (options.standardizeTableBorders) {
        this.log.debug("=== STANDARDIZING TABLE BORDERS ===");
        const borderThickness = options.tableShadingSettings?.cellBorderThickness ?? 0.5;
        const borderSize = Math.round(borderThickness * 8); // Convert points to eighths

        const tablesNormalized = this.standardizeTableBorders(doc, {
          size: borderSize,
        });

        if (tablesNormalized > 0) {
          this.log.info(
            `Standardized borders on ${tablesNormalized} tables to ${borderThickness}pt`
          );
          result.changes?.push({
            type: "table",
            category: "structure",
            description: `Standardized table borders to ${borderThickness}pt thickness`,
            count: tablesNormalized,
          });
        }
      }

      // Re-enable track changes after all structural table processing is complete.
      // Everything above (landscape margins, table uniformity, HLP tables, autofit,
      // cell width normalization, step columns, borders) modifies table layout/structure
      // and should not generate tcPrChange/tblPrChange — those cause tables to appear
      // scrunched in Word's "Original" view.
      doc.enableTrackChanges({
        author: authorName,
        trackFormatting: true,
        showInsertionsAndDeletions: true,
        clearExistingPropertyChanges: false,
      });

      // ═══════════════════════════════════════════════════════════
      // TEXT REPLACEMENT: "Parent SOP:" → "Parent Document:"
      // Replace bolded "Parent SOP:" with "Parent Document:" preserving formatting
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== REPLACING 'PARENT SOP:' TEXT ===");
      const parentSopReplaced = doc.replaceFormattedText("Parent SOP:", "Parent Document:", {
        matchBold: true,
      });
      if (parentSopReplaced > 0) {
        this.log.info(
          `Replaced ${parentSopReplaced} instances of "Parent SOP:" with "Parent Document:"`
        );
        result.changes?.push({
          type: "text",
          category: "structure",
          description: 'Replaced "Parent SOP:" with "Parent Document:"',
          count: parentSopReplaced,
        });
      }

      // HYPERLINK GROUP (additional operations)
      if (options.operations?.updateTopHyperlinks) {
        this.log.debug("=== UPDATING TOP OF DOCUMENT HYPERLINKS ===");
        // Disable track changes — Top of Document links are cosmetic navigation aids,
        // not content changes that should appear in Word's Review pane
        doc.disableTrackChanges();
        const topLinksAdded = await this.updateTopOfDocumentHyperlinks(doc);
        doc.enableTrackChanges({
          author: authorName,
          trackFormatting: true,
          showInsertionsAndDeletions: true,
          clearExistingPropertyChanges: false,
        });
        this.log.info(`Added ${topLinksAdded} "Top of Document" navigation links`);

        // Track Top of Document hyperlink creation
        if (topLinksAdded > 0) {
          result.changes?.push({
            type: "hyperlink",
            category: "structure",
            description: 'Created "Top of Document" navigation links',
            count: topLinksAdded,
          });
        }
      }

      if (options.operations?.replaceOutdatedTitles) {
        this.log.debug("=== REPLACING OUTDATED HYPERLINK TITLES ===");
        const titlesReplaced = await this.replaceOutdatedHyperlinkTitles(
          doc,
          options.customReplacements,
          authorName
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
            type: "hyperlink",
            category: "structure",
            description: "Standardized hyperlink colors to blue",
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
            type: "hyperlink",
            category: "structure",
            description: "Fixed internal hyperlink bookmarks",
            count: internalLinksFixed,
          });
        }
      }

      // Final whitespace pass: catch double spaces introduced by
      // late-pipeline text modifications (hyperlink title replacement, etc.)
      if (options.removeWhitespace) {
        doc.disableTrackChanges();
        const finalPassCleaned = await this.removeExtraWhitespace(doc);
        doc.enableTrackChanges({
          author: authorName,
          trackFormatting: true,
          showInsertionsAndDeletions: true,
          clearExistingPropertyChanges: false,
        });
        if (finalPassCleaned > 0) {
          this.log.info(`Final whitespace pass cleaned ${finalPassCleaned} additional runs`);
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
            type: "structure",
            category: "structure",
            description: "Rebuilt Table of Contents with styled hyperlinks",
            count: tocResult.count,
            affectedItems: tocResult.headings,
          });
        }

        // buildProperTOC() recreates TOC entries as fresh TOC{n}-styled
        // paragraphs with no direct indent — so a single-level TOC re-inherits
        // the TOC style's baked-in left indent. Re-flatten after the rebuild
        // (the earlier flattenSingleLevelToc pass acted on paragraphs this
        // rebuild has since deleted).
        const rebuiltTocFlatten = flattenSingleLevelToc(doc);
        if (rebuiltTocFlatten.flattened) {
          this.log.info(
            `Flattened rebuilt single-level TOC: zeroed left-indent on ` +
              `${rebuiltTocFlatten.paragraphs} ${rebuiltTocFlatten.flattenedStyle} paragraphs`
          );
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
        // Cast needed: TS 5.9 control flow loses Document narrowing inside nested try blocks
        const flushed = (doc as any).flushPendingChanges();
        this.log.debug(`Flushed ${flushed?.length || 0} pending changes to RevisionManager`);

        // Cast to ChangeEntry[] from session.ts to support extended types (hyperlink)
        const changelogEntries = ChangelogGenerator.fromDocument(doc) as ChangeEntry[];

        // ═══════════════════════════════════════════════════════════
        // INTEGRATE DOCHUB PROCESSING CHANGES (Hyperlinks)
        // Convert hyperlinkChanges from DocumentProcessingComparison to ChangeEntry format
        // These are changes made by DocHub processing (author: 'DocHub')
        // ═══════════════════════════════════════════════════════════
        if (options.trackChanges) {
          const comparison = documentProcessingComparison.getCurrentComparison();
          this.log.info(
            `Hyperlink tracking status: comparison=${comparison ? "exists" : "null"}, hyperlinkChanges=${comparison?.hyperlinkChanges?.length ?? 0}`
          );

          if (comparison?.hyperlinkChanges && comparison.hyperlinkChanges.length > 0) {
            this.log.info(
              `Adding ${comparison.hyperlinkChanges.length} DocHub hyperlink changes to changelog`
            );

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
        const hyperlinkCount = changelogEntries.filter((e) => e.category === "hyperlink").length;
        const imageCount = changelogEntries.filter((e) => e.category === "image").length;
        const fieldCount = changelogEntries.filter((e) => e.category === "field").length;
        const commentCount = changelogEntries.filter((e) => e.category === "comment").length;
        const bookmarkCount = changelogEntries.filter((e) => e.category === "bookmark").length;
        const contentControlCount = changelogEntries.filter(
          (e) => e.category === "contentControl"
        ).length;
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
      // DISABLE TRACKING FOR POST-EXTRACTION OPERATIONS
      // All tracked changes have been captured by ChangelogGenerator above.
      // Remaining operations (auto-accept, cleanup, orientation, margins, TOC rebuild)
      // are structural/layout changes that should NOT appear as tracked changes.
      // Without this, Word's Review panel shows changes the app UI doesn't display.
      // ═══════════════════════════════════════════════════════════
      doc.disableTrackChanges();
      this.log.debug(
        "Track changes disabled after changelog extraction - post-extraction operations will not be tracked"
      );

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
          // Cast needed: TS 5.9 control flow loses Document narrowing inside nested try blocks
          await (doc as any).acceptAllRevisions();
          this.log.info("Accepted all revisions via Document.acceptAllRevisions()");

          // Count total expected revisions (pre-existing + DocHub)
          const preExistingCount = result.previousRevisions?.entries.length || 0;
          const docHubCount = result.wordRevisions?.entries.length || 0;
          this.log.info(
            `Auto-accept complete - ${preExistingCount + docHubCount} total revisions accepted (${preExistingCount} pre-existing + ${docHubCount} DocHub changes)`
          );

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
        this.log.info(
          `Auto-accept disabled - ${preExistingCount + docHubCount} tracked changes will be visible in Word (${preExistingCount} pre-existing + ${docHubCount} DocHub)`
        );
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
        // defragmentHyperlinks is not requested here — it silently no-ops once
        // track changes is enabled (see pre-tracking defrag earlier in this method).
        const cleanupReport = cleanup.run({
          cleanupNumbering: false,
          cleanupRelationships: true,
        });
        if (cleanupReport.numberingRemoved > 0 || cleanupReport.relationshipsRemoved > 0) {
          this.log.info(
            `Cleanup: ${cleanupReport.numberingRemoved} unused numbering removed, ${cleanupReport.relationshipsRemoved} orphaned relationships removed`
          );
        }
      } catch (cleanupError) {
        this.log.debug("Cleanup completed with warnings:", cleanupError);
        // Non-fatal - continue with save
      }

      // ═══════════════════════════════════════════════════════════
      // DEDUPLICATE COMPLEX FIELD HYPERLINKS
      //
      // Cross-paragraph ComplexField chains (fldChar begin in one paragraph,
      // fldChar end at start of the next) can produce duplicate field
      // sequences after docxmlater parses and re-serializes them.
      // Remove identical adjacent ComplexField hyperlinks to prevent
      // doubled text in the output (e.g. "Mail Order ErrorMail Order Error").
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== DEDUPLICATING COMPLEX FIELD HYPERLINKS ===");
      try {
        const dedupCount = this.deduplicateComplexFieldHyperlinks(doc);
        if (dedupCount > 0) {
          this.log.info(
            `Removed ${dedupCount} duplicate hyperlink(s) from cross-paragraph field chains`
          );
          result.changes?.push({
            type: "hyperlink",
            category: "structure",
            description: "Removed duplicate hyperlinks from cross-paragraph field chains",
            count: dedupCount,
          });
        }
      } catch (dedupError) {
        this.log.debug("ComplexField deduplication completed with warnings:", dedupError);
        // Non-fatal - continue with save
      }

      // ═══════════════════════════════════════════════════════════
      // DOCUMENT SANITIZATION - Prevent Word freezes/crashes
      //
      // Fixes two common bloat sources in loaded documents:
      // 1. Nested INCLUDEPICTURE fields (Outlook copy-paste bug) —
      //    each forward/reply wraps images in a new field layer;
      //    Word recursively resolves these, freezing at high depth
      // 2. Orphan RSIDs — editing sessions accumulate thousands of
      //    revision session IDs in settings.xml that are never
      //    referenced in document.xml
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== DOCUMENT SANITIZATION ===");
      try {
        doc.flattenFieldCodes();
        doc.stripOrphanRSIDs();

        // Clear direct spacing from styled paragraphs at the raw XML level.
        // Runs as a post-processing pass (_postProcessDocumentXml) AFTER
        // document.xml has been regenerated from the model. NOTE: contrary to a
        // prior assumption, flattenFieldCodes() does NOT set
        // skipDocumentXmlRegeneration in docxmlater 11.0.8 — it only defers an
        // INCLUDEPICTURE strip to post-processing. The model is regenerated
        // normally, so model-based clearing (finalizeParagraphSpacing) is also
        // effective; this raw pass is a belt-and-suspenders catch-all.
        doc.clearDirectSpacingForStyles([
          "Normal",
          "Heading1",
          "Heading 1",
          "Heading2",
          "Heading 2",
          "Heading3",
          "Heading 3",
          "ListParagraph",
          "List Paragraph",
        ]);

        this.log.info(
          "Document sanitization enabled (INCLUDEPICTURE flatten + orphan RSID strip + direct spacing clear)"
        );
      } catch (sanitizeError) {
        this.log.debug("Sanitization setup completed with warnings:", sanitizeError);
        // Non-fatal - continue with save
      }

      // ═══════════════════════════════════════════════════════════
      // FINAL PARAGRAPH SPACING NORMALIZATION
      // Ensure every paragraph's spacing matches the UI-configured style.
      // Runs AFTER all processing (table uniformity, list normalization,
      // blank lines, HLP formatting) so spacing can't be overwritten.
      // ═══════════════════════════════════════════════════════════
      if (options.assignStyles && options.styles?.length) {
        this.log.debug("=== FINALIZING PARAGRAPH SPACING ===");
        const spacingCount = this.finalizeParagraphSpacing(doc, options.styles);
        this.log.info(`Finalized paragraph spacing on ${spacingCount} paragraphs`);
      }

      // ═══════════════════════════════════════════════════════════
      // LATE-STAGE HYPERLINK SPACE RELOCATION
      // Move leading spaces from hyperlinks to preceding Runs.
      // Must run LAST — earlier relocation gets undone by style application,
      // whitespace normalization, and defragmentation.
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== RELOCATING HYPERLINK LEADING SPACES ===");
      const spacesRelocated = this.relocateAllHyperlinkSpaces(doc);
      if (spacesRelocated > 0) {
        this.log.info(`Relocated leading spaces from ${spacesRelocated} hyperlinks`);
      }

      // Safety net: ensure no hyperlink is missing a preceding space
      const spacesAdded = this.ensureSpaceBeforeHyperlinks(doc);
      if (spacesAdded > 0) {
        this.log.info(`Added missing spaces before ${spacesAdded} hyperlinks`);
      }

      // Safety net: ensure no hyperlink is missing a following space
      const spacesAddedAfter = this.ensureSpaceAfterHyperlinks(doc);
      if (spacesAddedAfter > 0) {
        this.log.info(`Added missing spaces after ${spacesAddedAfter} hyperlinks`);
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

      // PRESERVE TOC FIELD STRUCTURE
      // DocXMLater loses complex field structures (<w:fldChar>) during load.
      // Rebuild TOCs to restore proper field structure before save.
      // This ensures the TOC field codes are preserved and Word's "Update Field"
      // option remains available, regardless of TOC Processing Options.
      //
      // SKIP if buildProperTOC() already ran — it calls rebuildTOCs() internally
      // and then applies formatTOCStyles() for blue/underlined entries. A second
      // rebuildTOCs() here would regenerate entries and lose that formatting.
      // ═══════════════════════════════════════════════════════════
      if (!options.operations?.updateTocHyperlinks) {
        this.log.debug("=== REBUILDING TOC FIELD STRUCTURE ===");
        try {
          const tocResults = doc.rebuildTOCs();
          if (tocResults.length > 0) {
            this.log.info(`Rebuilt ${tocResults.length} TOC(s) to preserve field structure`);
          }
        } catch (error) {
          this.log.debug("No TOC to rebuild or rebuild failed:", error);
        }
      }

      // ═══════════════════════════════════════════════════════════
      // NUMBERING CLEANUP
      // Remove orphaned numbering definitions and deduplicate identical ones.
      // Must run AFTER all list modifications (bullet/numbered uniformity,
      // tab stop removal, color standardization, prefix formatting) but BEFORE save.
      // ═══════════════════════════════════════════════════════════
      this.log.debug("=== CLEANING UP NUMBERING DEFINITIONS ===");
      try {
        // Phase 1: Remove numbering definitions not referenced by any paragraph
        doc.cleanupUnusedNumbering();
        const mgr = doc.getNumberingManager();
        this.log.debug(
          `After cleanup: ${mgr.getAbstractNumberingCount()} abstractNums, ${mgr.getInstanceCount()} instances`
        );

        // Phase 2: Consolidate duplicate abstractNums with identical fingerprints
        // Protect HLP, row-number, AND mixed-list abstractNums from consolidation.
        // Without the mixed-list guard, consolidateNumbering's fingerprint-dedup
        // can collapse a freshly-created NUMBERED_LEAD / BULLET_LEAD abstract
        // onto a pre-existing input abstract whose level definitions were never
        // stamped with the FILLED/OPEN alternation, silently regressing the
        // mixed-list pattern back to Word's default level-1 open circle "o".
        const protectedIds = new Set([
          ...this._hlpAbstractNumIds,
          ...this._rowNumberAbstractNumIds,
          ...this._mixedListAbstractNumIds,
        ]);
        const consolidateResult = doc.consolidateNumbering({
          protectedAbstractNumIds: protectedIds,
        });
        if (consolidateResult.abstractNumsRemoved > 0) {
          this.log.info(
            `Consolidated numbering: removed ${consolidateResult.abstractNumsRemoved} duplicate abstractNums, ` +
              `remapped ${consolidateResult.instancesRemapped} instances across ${consolidateResult.groupsConsolidated} group(s)`
          );
        }

        // Safety net: fix any paragraph numId references pointing to now-deleted definitions
        const orphanedRefs = doc.validateNumberingReferences();
        if (orphanedRefs > 0) {
          this.log.info(`Fixed ${orphanedRefs} orphaned numId reference(s)`);
        }
      } catch (cleanupError) {
        // Non-fatal — log and continue to save
        this.log.warn("Numbering cleanup failed (non-fatal):", cleanupError);
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
          this.log.debug(`Error messages: ${result.errorMessages.join(", ")}`);
        }
        this.log.debug(
          `Processing rate: ${((result.totalHyperlinks || 1) / (result.duration / 1000)).toFixed(1)} hyperlinks/sec`
        );
        this.log.debug("--- End Detailed Stats ---");
      }

      return result;
    } catch (error) {
      // Detect file lock errors and compatibility mode errors, show user-friendly messages
      let errorMessage: string;
      if (this.isFileLockError(error)) {
        errorMessage = "Please close the file and try again";
        this.log.error(
          "ERROR (file locked):",
          error instanceof Error ? error.message : String(error)
        );
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
      // Reset all per-document state to prevent cross-document leakage
      // (processor instance is reused across documents)
      this.needsWiderHangingIndent = false;
      this._rowNumberAbstractNumIds.clear();
      this._hlpAbstractNumIds.clear();
      this._hlpSavedNumbering.clear();
      this._mixedListAbstractNumIds.clear();
      tableProcessor.clearHLPTableCache();

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
    hyperlinks: ExtractedHyperlink[],
    replacements: Array<{
      find: string;
      replace: string;
      matchType: "contains" | "exact" | "startsWith";
      applyTo: "url" | "text" | "both";
    }>,
    result: WordProcessingResult,
    doc: Document,
    author: string
  ): Promise<void> {
    for (const entry of hyperlinks) {
      const { hyperlink, isComplexField, paragraph, url, text } = entry;
      for (const rule of replacements) {
        let shouldApply: boolean;

        if (rule.applyTo === "url" || rule.applyTo === "both") {
          if (url) {
            shouldApply = this.matchesPattern(url, rule.find, rule.matchType);
            if (shouldApply) {
              const newUrl = url.replace(rule.find, rule.replace);
              if (isComplexField) {
                const field = hyperlink as ComplexField;
                const parsed = field.getParsedHyperlink();
                field.setInstruction(
                  buildHyperlinkInstruction(newUrl, parsed?.anchor, parsed?.tooltip)
                );
              } else {
                this.setHyperlinkUrlTracked(doc, hyperlink as Hyperlink, paragraph, newUrl, author);
              }
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
            if (isComplexField) {
              this.setComplexFieldTextTracked(doc, hyperlink as ComplexField, newText, author);
            } else {
              this.setHyperlinkTextTracked(doc, hyperlink as Hyperlink, paragraph, newText, author);
            }
            if (result.updatedDisplayTexts !== undefined) {
              result.updatedDisplayTexts++;
            }
          }
        }
      }
    }
  }

  /**
   * Apply text replacements across all paragraphs (body + table cells).
   * Uses getBodyRuns() to exclude hyperlink-child runs
   * (already handled by processCustomReplacements).
   * Skips TOC and complex-field paragraphs to avoid corrupting field instructions.
   */
  private processTextReplacementsAllParagraphs(
    doc: Document,
    replacements: Array<{
      find: string;
      replace: string;
      matchType: "contains" | "exact" | "startsWith";
      applyTo: "url" | "text" | "both";
    }>,
  ): number {
    let modifiedRunCount = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      // Skip TOC paragraphs — field instructions must not be modified
      const style = para.getStyle() || "";
      if (style.startsWith("TOC") && style !== "TOCHeading") {
        continue;
      }

      // Skip paragraphs with complex field content
      if (this.hasComplexFieldContent(para)) {
        continue;
      }

      // getBodyRuns excludes hyperlink-child runs,
      // preventing double-replacement with processCustomReplacements
      const runs = getBodyRuns(para);
      for (const run of runs) {
        let text = run.getText();
        if (!text) continue;

        let modified = false;
        for (const rule of replacements) {
          if (!rule.find) continue;
          if (this.matchesPattern(text, rule.find, rule.matchType)) {
            text = text.replaceAll(rule.find, rule.replace);
            modified = true;
          }
        }

        if (modified) {
          run.setText(text);
          modifiedRunCount++;
        }
      }
    }

    return modifiedRunCount;
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
   * Create backup of document in a DocHub_Backups subfolder of the user's Downloads folder
   */
  private async createBackup(filePath: string): Promise<string> {
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);

    // Create the DocHub_Backups folder (inside Downloads) if it doesn't exist
    const backupRoot = await this.resolveBackupRoot(filePath);
    const backupDir = path.join(backupRoot, "DocHub_Backups");
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
   * Resolve the directory that should contain the DocHub_Backups folder.
   * Prefers the user's Downloads folder (resolved by the main process via
   * app.getPath("downloads")); falls back to the document's own directory when
   * Downloads can't be resolved (e.g. tests or browser-only mode).
   */
  private async resolveBackupRoot(filePath: string): Promise<string> {
    try {
      if (typeof window !== "undefined" && window.electronAPI?.getDownloadsPath) {
        const downloads = await window.electronAPI.getDownloadsPath();
        if (downloads) {
          return downloads;
        }
      }
    } catch (error) {
      this.log.warn("Could not resolve Downloads folder for backup; using document directory", {
        error,
      });
    }
    return path.dirname(filePath);
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
      const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
   * Update hyperlink text with tracked change support.
   *
   * docxmlater 12: `Hyperlink.setText()` is revision-aware. When track changes
   * is enabled and the hyperlink is bound to its paragraph, setText() itself
   * clones the original, creates and registers the w:del/w:ins revision pair,
   * and detaches the old hyperlink into the deletion; when tracking is off it
   * overwrites in place. The former manual
   * clone + Revision.createDeletion/createInsertion + paragraph.replaceContent
   * dance now double-tracks and fails — after setText() moves the hyperlink into
   * a Revision, replaceContent() can no longer find it and returns false. So we
   * delegate to setText(). The `paragraph`/`author` params are retained for
   * call-site compatibility; the library uses the document's tracking context.
   */
  private setHyperlinkTextTracked(
    doc: Document,
    hyperlink: Hyperlink,
    paragraph: Paragraph,
    newText: string,
    author: string
  ): boolean {
    void doc;
    void paragraph;
    void author;
    hyperlink.setText(newText);
    return true;
  }

  /**
   * Update hyperlink URL with tracked change support.
   *
   * docxmlater 12: `Hyperlink.setUrl()` is revision-aware (see
   * {@link setHyperlinkTextTracked}) — with tracking enabled it creates and
   * registers the w:del/w:ins pair internally, so the prior manual revision
   * dance is delegated to setUrl().
   */
  private setHyperlinkUrlTracked(
    doc: Document,
    hyperlink: Hyperlink,
    paragraph: Paragraph,
    newUrl: string,
    author: string
  ): boolean {
    void doc;
    void paragraph;
    void author;
    hyperlink.setUrl(newUrl);
    return true;
  }

  /**
   * Update ComplexField hyperlink display text (result) with optional tracked changes.
   * ComplexField uses setResult() instead of setText().
   */
  private setComplexFieldTextTracked(
    doc: Document,
    field: ComplexField,
    newText: string,
    author: string
  ): void {
    if (doc.isTrackChangesEnabled()) {
      field.setTrackedResult(newText, author, { preserveFormatting: true });
    } else {
      field.setResult(newText);
    }
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
    author: string = "DocHub"
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
      // We need to iterate over a copy since we may modify content during iteration
      for (const item of [...content]) {
        // Case 1: Direct Hyperlink instances
        if (item instanceof Hyperlink) {
          // Use getFullUrl() to include w:anchor fragment for matching
          const oldUrl = item.getFullUrl();

          if (oldUrl && urlMap.has(oldUrl)) {
            // This hyperlink needs URL update
            const newUrl = urlMap.get(oldUrl)!;

            // Skip if URLs are identical (no-op update)
            if (oldUrl === newUrl) {
              this.log.debug(`Skipping no-op update: ${oldUrl}`);
              continue;
            }

            try {
              // URL-only updates are applied directly without tracked changes.
              // Creating del/ins revision pairs for URL changes produces no-op
              // tracked changes in Word (identical display text in both).
              item.setUrl(newUrl);
              this.log.debug(`Updated hyperlink URL: ${oldUrl} -> ${newUrl}`);

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
        // Only update URLs inside insertion Revisions — skip deletion Revisions
        // to preserve the original "before" state for genuine text-change pairs.
        else if (item instanceof Revision && item.getType() === "insert") {
          const revisionContent = item.getContent();
          for (const revContent of revisionContent) {
            if (revContent instanceof Hyperlink) {
              const oldUrl = revContent.getFullUrl();

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
        // Case 3: HYPERLINK field codes (ComplexField)
        else if (item instanceof ComplexField && item.isHyperlinkField()) {
          const oldUrl = item.getHyperlinkUrl();

          if (oldUrl && urlMap.has(oldUrl)) {
            const newUrl = urlMap.get(oldUrl)!;

            if (oldUrl === newUrl) {
              this.log.debug(`Skipping no-op ComplexField URL update: ${oldUrl}`);
              continue;
            }

            try {
              const parsed = item.getParsedHyperlink();
              item.setInstruction(
                buildHyperlinkInstruction(newUrl, parsed?.anchor, parsed?.tooltip)
              );
              updatedCount++;
              this.log.debug(`Updated ComplexField URL: ${oldUrl} -> ${newUrl}`);
            } catch (error) {
              this.log.error(
                `Failed to update ComplexField URL at paragraph ${paraIndex}: ${oldUrl} -> ${newUrl}`,
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
   * Remove extra whitespace - Collapse multiple spaces to single space,
   * strip leading spaces from paragraphs, and handle cross-run double spaces.
   * Processes all text runs in the document.
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

      let runs = getBodyRuns(para);

      // Filter out field-marker runs instead of skipping the entire paragraph.
      // Always keep ImageRun and VML image runs — they have no field content
      // and dropping them prevents space-after-image insertion.
      if (this.hasComplexFieldContent(para)) {
        runs = runs.filter((run) => {
          if (run instanceof ImageRun) return true;
          try {
            const content = run.getContent();
            // Keep VML image runs (legacy format inline images)
            if (content.some((c: { type: string }) => c.type === "vml")) return true;
            return !content.some(
              (c: { type: string }) => c.type === "instructionText" || c.type === "fieldChar"
            );
          } catch {
            return false;
          }
        });
      }

      const gapAfter = this.detectContentGaps(runs, para);
      cleanedCount += normalizeRunWhitespace(runs, gapAfter);
    }

    return cleanedCount;
  }

  /**
   * Detect "content gaps" — positions where invisible content (e.g. a
   * Revision-wrapped hyperlink) sits between two adjacent visible runs.
   *
   * When the API updates hyperlink text with tracked changes, the hyperlink
   * gets wrapped in Revision elements (tracked delete + tracked insert).
   * `para.getRuns()` skips these (Revision.getRuns() filters by isRunContent
   * which excludes Hyperlinks), so the whitespace normalizer sees
   * `["Contact ", " to confirm"]` as adjacent and incorrectly strips the
   * trailing space from "Contact ".
   *
   * Returns a Set of run indices where a gap exists (meaning invisible content
   * sits between runs[i] and runs[i+1]), or undefined if no gaps found.
   */
  private detectContentGaps(runs: Run[], para: Paragraph): Set<number> | undefined {
    const content = para.getContent();

    // A "visible boundary" is non-run content that getRuns() hides but that still
    // renders between the surrounding runs — a hyperlink (complex field or element) or a
    // tracked insertion/move. Whitespace dedup must NOT trim a run's trailing space
    // across such a boundary, or "the <hyperlink>" collapses to "the<hyperlink>".
    // Excludes w:del/w:moveFrom: deleted content is invisible (getBodyRuns strips its
    // runs), so a deletion boundary is a genuine run adjacency.
    const isVisibleBoundary = (item: ParagraphContent): boolean => {
      if (isHyperlink(item)) return true;
      if (item instanceof ComplexField && item.isHyperlinkField()) return true;
      if (item instanceof PreservedElement) {
        const et = item.getElementType();
        return et === "w:hyperlink" || et === "w:ins" || et === "w:moveTo";
      }
      if (isRevision(item)) {
        const t = item.getType();
        return t === "insert" || t === "moveTo";
      }
      return false;
    };

    // Quick exit: if no visible boundary in paragraph content, no gaps possible
    if (!content.some(isVisibleBoundary)) {
      return undefined;
    }

    // Build a map: for each run, find which top-level content index it belongs to.
    // Direct runs map to their own index; hyperlink child runs map to the hyperlink's index.
    const runToContentIndex = new Map<Run, number>();
    for (let ci = 0; ci < content.length; ci++) {
      const item = content[ci];
      if (isRun(item)) {
        runToContentIndex.set(item as Run, ci);
      } else if (isHyperlink(item)) {
        // Hyperlink child run — map it to the hyperlink's content index
        try {
          const hlRun = (item as Hyperlink).getRun();
          if (hlRun) runToContentIndex.set(hlRun, ci);
        } catch {
          // Ignore — hyperlink may not expose run
        }
      }
    }

    // For adjacent runs in the filtered list, check if there's a gap
    // (content indices differ by >1) with a Revision in between.
    let gapAfter: Set<number> | undefined;

    for (let i = 0; i < runs.length - 1; i++) {
      const ciA = runToContentIndex.get(runs[i]);
      const ciB = runToContentIndex.get(runs[i + 1]);
      if (ciA === undefined || ciB === undefined) continue;
      if (ciB - ciA <= 1) continue;

      // Check if any content between ciA and ciB is a visible boundary
      for (let ci = ciA + 1; ci < ciB; ci++) {
        if (isVisibleBoundary(content[ci])) {
          if (!gapAfter) gapAfter = new Set();
          gapAfter.add(i);
          break;
        }
      }
    }

    return gapAfter;
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
            (c: { type: string }) => c.type === "instructionText" || c.type === "fieldChar"
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
   * Build a set of paragraphs that belong to real TOC regions.
   *
   * Uses four-phase detection:
   * 1. ComplexField-anchored TOCs (paragraphs with TOC field instructions + subsequent TOC entries)
   * 2. Contiguous TOC-styled groups (2+ consecutive paragraphs with TOC styles)
   * 3. Field content fallback (TOC-styled paragraphs with complex field content, e.g. SDT-wrapped)
   * 4. TOCHeading adjacency (TOCHeading paragraphs adjacent to a real TOC paragraph)
   */
  private buildRealTocParagraphSet(doc: Document): Set<Paragraph> {
    const realTocParagraphs = new Set<Paragraph>();
    const bodyElements = doc.getBodyElements();

    const isTocStyle = (style: string): boolean => /^toc/i.test(style);

    // Phase 1: ComplexField-anchored TOCs
    // Walk body elements; when a paragraph contains a ComplexField with TOC instruction,
    // mark it and subsequent TOC-content paragraphs.
    for (let i = 0; i < bodyElements.length; i++) {
      const element = bodyElements[i];
      if (!(element instanceof Paragraph)) continue;

      const content = element.getContent();
      let hasTocField = false;
      for (const item of content) {
        if (item instanceof ComplexField) {
          const instruction = item.getInstruction();
          if (instruction && instruction.trim().toUpperCase().startsWith("TOC")) {
            hasTocField = true;
            break;
          }
        }
      }

      if (!hasTocField) continue;

      // Mark the TOC field paragraph itself
      realTocParagraphs.add(element);
      this.log.debug(
        `[RealTOC] Phase 1: TOC field paragraph at body index ${i}: "${element.getText().substring(0, 60)}"`
      );

      // Mark subsequent paragraphs that are part of this TOC
      for (let j = i + 1; j < bodyElements.length; j++) {
        const nextEl = bodyElements[j];
        if (!(nextEl instanceof Paragraph)) break;

        const nextStyle = nextEl.getStyle() || "";
        const nextText = nextEl.getText().trim();
        const hasField = this.hasComplexFieldContent(nextEl);

        // TOC entries have TOC styles, field content, or are empty spacer paragraphs
        if (isTocStyle(nextStyle) || hasField || nextText === "") {
          realTocParagraphs.add(nextEl);
        } else {
          break; // End of TOC region
        }
      }
    }

    // Phase 2: Contiguous TOC-styled groups
    // If 2+ consecutive body-level paragraphs have TOC styles, treat as a real manual TOC block.
    let groupStart = -1;
    const groupParagraphs: Paragraph[] = [];

    for (let i = 0; i <= bodyElements.length; i++) {
      const element = i < bodyElements.length ? bodyElements[i] : null;
      const isParagraphWithTocStyle =
        element instanceof Paragraph && isTocStyle(element.getStyle() || "");

      if (isParagraphWithTocStyle) {
        if (groupStart === -1) groupStart = i;
        groupParagraphs.push(element as Paragraph);
      } else {
        // End of group — mark if 2+ consecutive
        if (groupParagraphs.length >= 2) {
          for (const p of groupParagraphs) {
            if (!realTocParagraphs.has(p)) {
              realTocParagraphs.add(p);
              this.log.debug(
                `[RealTOC] Phase 2: Contiguous group member starting at body index ${groupStart}: "${p.getText().substring(0, 60)}"`
              );
            }
          }
        }
        groupStart = -1;
        groupParagraphs.length = 0;
      }
    }

    // Phase 3: Field content fallback
    // Catch SDT-wrapped TOC paragraphs not visible in getBodyElements()
    for (const para of doc.getAllParagraphs()) {
      const style = para.getStyle() || "";
      if (isTocStyle(style) && this.hasComplexFieldContent(para) && !realTocParagraphs.has(para)) {
        realTocParagraphs.add(para);
        this.log.debug(
          `[RealTOC] Phase 3: Field content fallback: "${para.getText().substring(0, 60)}"`
        );
      }
    }

    // Phase 4: TOCHeading adjacency
    // Include TOCHeading paragraphs that are adjacent to a real TOC paragraph
    for (let i = 0; i < bodyElements.length; i++) {
      const element = bodyElements[i];
      if (!(element instanceof Paragraph)) continue;

      const style = element.getStyle() || "";
      if (style !== "TOCHeading") continue;
      if (realTocParagraphs.has(element)) continue;

      // Check previous body element
      const prev = i > 0 ? bodyElements[i - 1] : null;
      const next = i < bodyElements.length - 1 ? bodyElements[i + 1] : null;

      const prevIsRealToc = prev instanceof Paragraph && realTocParagraphs.has(prev);
      const nextIsRealToc = next instanceof Paragraph && realTocParagraphs.has(next);

      if (prevIsRealToc || nextIsRealToc) {
        realTocParagraphs.add(element);
        this.log.debug(
          `[RealTOC] Phase 4: TOCHeading adjacent to real TOC at body index ${i}: "${element.getText().substring(0, 60)}"`
        );
      }
    }

    this.log.debug(`[RealTOC] Total real TOC paragraphs identified: ${realTocParagraphs.size}`);
    return realTocParagraphs;
  }

  /**
   * Correct paragraphs that have incorrectly applied TOC or Hyperlink paragraph styles.
   *
   * TOC styles (TOC, TOC1-TOC9, TOCHeading) on paragraphs outside real TOC regions,
   * and Hyperlink/FollowedHyperlink paragraph styles (which are character styles in
   * standard Word) are corrected to Normal or ListParagraph based on content analysis.
   */
  private correctMisappliedParagraphStyles(doc: Document): number {
    const realTocParagraphs = this.buildRealTocParagraphSet(doc);
    let correctedCount = 0;

    for (const para of doc.getAllParagraphs()) {
      const style = para.getStyle();
      if (!style) continue;

      const styleLower = style.toLowerCase();
      let isMisapplied = false;

      // Check for misapplied TOC styles (not in a real TOC region)
      if (styleLower.startsWith("toc") && !realTocParagraphs.has(para)) {
        isMisapplied = true;
      }

      // Check for Hyperlink/FollowedHyperlink paragraph styles (always misapplied — these are character styles)
      // Do NOT touch "TopHyperlink" — it's a legitimate custom paragraph style used by the processor
      if (style === "Hyperlink" || style === "FollowedHyperlink") {
        isMisapplied = true;
      }

      if (!isMisapplied) continue;

      // Determine target style based on list detection
      const listInfo = detectListType(para);
      const newStyle = listInfo.category !== "none" ? "ListParagraph" : "Normal";

      const textPreview = para.getText().substring(0, 80);
      this.log.debug(`[MisappliedStyle] Correcting "${style}" → "${newStyle}": "${textPreview}"`);

      para.setStyle(newStyle);
      correctedCount++;
    }

    return correctedCount;
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
            (c: { type: string }) => c.type === "fieldChar" || c.type === "instructionText"
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
        const style = para.getStyle() || "";
        if (style.startsWith("TOC") && style !== "TOCHeading") {
          para.setPreserved(true);
          markedCount++;
        }
      }
    }

    return markedCount;
  }

  /**
   * Remove italic formatting - Strip italics from all text runs
   */
  private async removeItalicFormatting(doc: Document): Promise<number> {
    let removedCount = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const runs = getBodyRuns(para);
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
   * Remove em/en typographic variants
   *
   * Replaces em/en dashes (U+2013, U+2014) with hyphens (U+002D)
   * and em/en spaces (U+2002, U+2003) with regular spaces in all document text runs.
   * Collapses leading spaces at paragraph start after space replacement.
   *
   * Skips TOC paragraphs and complex field content to prevent corruption.
   *
   * @param doc - Document to process
   * @returns Number of runs modified
   */
  private async removeEmEnVariants(doc: Document): Promise<number> {
    const { removeEmEnVariants } = await import("@/utils/textSanitizer");
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

      const runs = getBodyRuns(para);

      for (const run of runs) {
        const text = run.getText();
        if (!text) continue;

        const normalized = removeEmEnVariants(text);

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

        for (let ci = 0; ci < content.length; ci++) {
          const item = content[ci];
          try {
            // Case 1: Direct Hyperlink instances
            if (item instanceof Hyperlink) {
              this.applyStandardHyperlinkFormatting(item);
              standardizedCount++;
              this.log.debug(
                `Standardized direct hyperlink: "${sanitizeHyperlinkText(item.getText())}"`
              );
            }
            // Case 2: Hyperlinks inside Revision elements (w:ins tracked changes)
            else if (item instanceof Revision) {
              // Only format hyperlinks in insertion revisions — skip deletions
              if (item.getType() === "delete" || item.getType() === "moveFrom") continue;
              const revisionContent = item.getContent();
              for (let ri = 0; ri < revisionContent.length; ri++) {
                const revContent = revisionContent[ri];
                if (revContent instanceof Hyperlink) {
                  this.applyStandardHyperlinkFormatting(revContent);
                  standardizedCount++;
                  this.log.debug(
                    `Standardized hyperlink inside Revision: "${sanitizeHyperlinkText(revContent.getText())}"`
                  );
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
   * Deduplicate hyperlink content that appears in cross-paragraph chains.
   *
   * When a DOCX file uses cross-paragraph ComplexField HYPERLINK chains
   * (fldChar begin in one paragraph, fldChar end at the start of the next),
   * docxmlater's two-pass field assembly can produce duplicate hyperlink
   * content in a single paragraph:
   *
   * 1. `assembleMultiParagraphFields()` creates a Hyperlink in the target paragraph
   * 2. `assembleComplexFields()` creates a ComplexField from remaining field runs
   *
   * Result: para.getContent() → [ Hyperlink("text"), ComplexField("text") ]
   *
   * This method is type-agnostic: it extracts { anchor, text } from all
   * hyperlink-like content types (ComplexField, Hyperlink) and removes
   * adjacent duplicates sharing the same anchor AND display text.
   *
   * @param doc - The document to deduplicate
   * @returns Number of duplicate hyperlink items removed
   */
  private deduplicateComplexFieldHyperlinks(doc: Document): number {
    let removed = 0;

    for (const para of doc.getAllParagraphs()) {
      const content = para.getContent();

      // Extract { item, anchor, text } from every hyperlink-like content item
      type HyperlinkInfo = { item: ComplexField | Hyperlink; anchor: string; text: string };
      const hyperlinkItems: HyperlinkInfo[] = [];

      for (const item of content) {
        if (item instanceof ComplexField && item.isHyperlinkField()) {
          const parsed = item.getParsedHyperlink();
          hyperlinkItems.push({
            item,
            anchor: parsed?.anchor || parsed?.url || item.getInstruction().trim(),
            text: item.getResult() || "",
          });
        } else if (item instanceof Hyperlink) {
          hyperlinkItems.push({
            item,
            anchor: item.getAnchor() || item.getUrl() || "",
            text: item.getText() || "",
          });
        }
      }

      if (hyperlinkItems.length < 2) {
        // Fallback: if paragraph has raw field content but no typed items,
        // try dedup via raw run scanning
        if (hyperlinkItems.length === 0 && this.hasComplexFieldContent(para)) {
          removed += this.deduplicateRawFieldRuns(para);
        }
        continue;
      }

      this.log.debug(
        `Para has ${hyperlinkItems.length} hyperlink items: ${hyperlinkItems
          .map((h) => `${h.item.constructor.name}("${h.text}")`)
          .join(", ")}`
      );

      // Compare adjacent items — remove duplicates
      const toRemove: (ComplexField | Hyperlink)[] = [];
      for (let i = 1; i < hyperlinkItems.length; i++) {
        const prev = hyperlinkItems[i - 1];
        const curr = hyperlinkItems[i];
        if (prev.anchor === curr.anchor && prev.text === curr.text) {
          toRemove.push(curr.item);
        }
      }

      // Remove duplicates
      for (const item of toRemove) {
        para.replaceContent(item, []);
        removed++;
        const typeName = item instanceof ComplexField ? "ComplexField" : "Hyperlink";
        const displayText = item instanceof ComplexField ? item.getResult() : item.getText();
        this.log.debug(`Removed duplicate ${typeName} hyperlink: "${displayText}"`);
      }
    }

    return removed;
  }

  /**
   * Fallback dedup for paragraphs with raw field runs (PreservedElement or
   * unassembled fieldChar/instructionText runs) that were not recognized as
   * ComplexField or Hyperlink instances by the parser.
   *
   * Scans runs for HYPERLINK field sequences:
   *   fieldChar(begin) → instructionText(HYPERLINK...) → fieldChar(separate) → text → fieldChar(end)
   *
   * Adjacent groups with the same instruction and result text are duplicates;
   * the second group's runs are removed via para.replaceContent().
   */
  private deduplicateRawFieldRuns(para: Paragraph): number {
    let removed = 0;
    try {
      const runs = para.getRuns();
      if (runs.length === 0) return 0;

      // Parse run groups: each group is a HYPERLINK field sequence
      interface FieldGroup {
        runs: Run[];
        instruction: string;
        resultText: string;
      }

      const groups: FieldGroup[] = [];
      let i = 0;

      while (i < runs.length) {
        const run = runs[i];
        const runContent = run.getContent();

        // Look for fieldChar begin
        const hasBegin = runContent.some(
          (c: { type: string; value?: string }) => c.type === "fieldChar" && c.value === "begin"
        );

        if (!hasBegin) {
          i++;
          continue;
        }

        // Collect runs until fieldChar end
        const groupRuns: Run[] = [run];
        let instruction = "";
        let resultText = "";
        let foundEnd = false;
        let pastSeparate = false;

        for (let j = i + 1; j < runs.length; j++) {
          const r = runs[j];
          groupRuns.push(r);
          const rc = r.getContent();

          for (const c of rc) {
            const typedC = c as { type: string; value?: string; text?: string };
            if (typedC.type === "instructionText" && typedC.text) {
              instruction += typedC.text;
            }
            if (typedC.type === "fieldChar" && typedC.value === "separate") {
              pastSeparate = true;
            }
            if (typedC.type === "fieldChar" && typedC.value === "end") {
              foundEnd = true;
            }
            if (pastSeparate && !foundEnd && typedC.type === "text" && typedC.text) {
              resultText += typedC.text;
            }
          }

          if (foundEnd) {
            i = j + 1;
            break;
          }
        }

        if (!foundEnd) {
          i++;
          continue;
        }

        // Only track HYPERLINK field groups
        if (/^\s*HYPERLINK\b/i.test(instruction)) {
          groups.push({
            runs: groupRuns,
            instruction: instruction.trim(),
            resultText: resultText.trim(),
          });
        }
      }

      // Compare adjacent groups and remove duplicates
      for (let g = 1; g < groups.length; g++) {
        const prev = groups[g - 1];
        const curr = groups[g];
        if (prev.instruction === curr.instruction && prev.resultText === curr.resultText) {
          for (const run of curr.runs) {
            para.replaceContent(run, []);
          }
          removed++;
          this.log.debug(`Removed duplicate raw field run group: "${curr.resultText}"`);
        }
      }
    } catch (error) {
      this.log.debug(`Raw field run dedup error: ${error}`);
    }

    return removed;
  }

  /**
   * Standardize "Return to" hyperlinks (e.g. "Return to HLP", "Return to TOC").
   *
   * 1. Remove any left/first-line indentation on the containing paragraph.
   * 2. Right-align the containing paragraph.
   *
   * Handles hyperlinks in body paragraphs and table cells.
   *
   * @param doc - Document to process
   * @returns Number of hyperlinks standardized
   */
  private standardizeReturnToHyperlinks(doc: Document): number {
    let standardized = 0;

    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const content = para.getContent();
      let foundReturnTo = false;

      for (const item of content) {
        try {
          if (item instanceof Hyperlink) {
            const text = sanitizeHyperlinkText(item.getText()).trim();
            if (text.toLowerCase().startsWith("return to")) {
              foundReturnTo = true;
            }
          }
        } catch (error) {
          this.log.warn(`Failed to process Return to hyperlink: ${error}`);
        }
      }

      if (foundReturnTo) {
        // Remove indentation before right-aligning
        para.setLeftIndent(0);
        para.setFirstLineIndent(0);
        para.setAlignment("right");
        standardized++;
      }
    }

    if (standardized > 0) {
      this.log.info(
        `Standardized ${standardized} "Return to" hyperlinks (indent removed + right-aligned)`
      );
    }

    return standardized;
  }

  /**
   * Clear indentation from center-aligned paragraphs.
   *
   * Per ECMA-376 Section 17.3.1.13 (jc) and 17.3.1.12 (ind), center justification
   * renders content centered within the text extents. Non-zero left or first-line
   * indentation shifts the centering reference point, producing misaligned output.
   *
   * @param doc - Document to process
   * @returns Number of paragraphs modified
   */
  private clearCenterAlignedIndentation(doc: Document): number {
    let modified = 0;

    for (const para of doc.getAllParagraphs()) {
      if (para.getAlignment() !== "center") continue;

      const formatting = para.getFormatting();
      const leftIndent = formatting?.indentation?.left || 0;
      const firstLineIndent = formatting?.indentation?.firstLine || 0;

      if (leftIndent > 0 || firstLineIndent > 0) {
        if (leftIndent > 0) para.setLeftIndent(0);
        if (firstLineIndent > 0) para.setFirstLineIndent(0);
        modified++;
      }
    }

    return modified;
  }

  /**
   * Apply standard formatting to ALL runs inside a hyperlink.
   *
   * Standard format: Verdana 12pt, Blue (#0000FF), Underlined, no bold/italic
   * Uses hyperlink.setFormatting() which applies to every run in the hyperlink,
   * correctly handling multi-run hyperlinks (e.g., "CALL-0049 " in one run,
   * "Customer Care Internal..." in another).
   *
   * Callers disable tracking before invoking this method, so formatting
   * standardization does not generate tracked changes.
   *
   * @param hyperlink - The hyperlink to format
   */
  private applyStandardHyperlinkFormatting(hyperlink: Hyperlink): void {
    // Trim trailing whitespace from hyperlink text.
    // Whitespace inside hyperlinks gets underlined (Hyperlink style),
    // producing visual artifacts. Leading spaces are handled separately
    // by relocateHyperlinkLeadingSpace() to preserve word separation.
    const text = hyperlink.getText();
    if (text && text !== text.trimEnd()) {
      hyperlink.setText(text.trimEnd());
    }

    const textBeforeFormatting = hyperlink.getText();

    hyperlink.setFormatting({
      font: "Verdana",
      size: 12,
      color: "0000FF",
      underline: "single",
      bold: false,
      italic: false,
    });

    // Ensure the run has rStyle="Hyperlink" character style.
    // Without this, style application steps (doc.applyStyles()) can clear
    // direct formatting, causing the hyperlink to fall back to Normal
    // paragraph formatting (black text, no underline).
    hyperlink.getRun().setCharacterStyle("Hyperlink");

    // Guard: restore text if setFormatting() altered it (e.g. dropped xml:space="preserve")
    const textAfterFormatting = hyperlink.getText();
    if (textAfterFormatting !== textBeforeFormatting && textBeforeFormatting) {
      hyperlink.setText(textBeforeFormatting);
    }
  }

  /**
   * Relocate leading spaces from hyperlink text to the preceding run.
   *
   * Word documents often store the space separating normal text from hyperlink
   * text as a leading space inside the hyperlink element (e.g., hyperlink text
   * = " Google" while the preceding run = "Test Table 2"). Without relocation,
   * trimming the leading space merges the words ("Test Table 2Google").
   *
   * Moving the space to the preceding run preserves word separation without
   * the underlined-space artifact that occurs when space inherits Hyperlink style.
   *
   * @param hyperlink - The hyperlink whose leading space to relocate
   * @param content - The paragraph content array
   * @param index - The hyperlink's index within the content array
   */
  private relocateHyperlinkLeadingSpace(
    hyperlink: Hyperlink,
    content: ParagraphContent[],
    index: number
  ): void {
    const text = hyperlink.getText();
    if (!text || !text.startsWith(" ")) return;

    const prev = index > 0 ? content[index - 1] : null;

    // No preceding content → trim (paragraph-start artifact)
    if (!prev) {
      hyperlink.setText(text.trimStart());
      return;
    }

    // Preceding item is a Run → relocate space
    if (prev instanceof Run) {
      const prevText = prev.getText() || "";
      if (!prevText.endsWith(" ")) {
        prev.setText(prevText + " ");
      }
      hyperlink.setText(text.trimStart());
      return;
    }

    // For other content types (Revision, ComplexField, PreservedElement),
    // leave the leading space on the hyperlink — it's the word separator
    // and removing it would merge words.
  }

  /**
   * Late-stage pass: relocate leading spaces from hyperlinks to preceding Runs.
   *
   * Runs after ALL processing (style application, whitespace normalization,
   * cleanup, defragmentation) to ensure relocated spaces aren't lost by
   * intermediate pipeline steps.
   *
   * Leading spaces on hyperlinks render with blue underline formatting,
   * which is a visual artifact. Moving them to the preceding Run gives
   * them normal paragraph formatting while preserving word separation.
   */
  private relocateAllHyperlinkSpaces(doc: Document): number {
    let relocated = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const content = para.getContent();

      for (let ci = 0; ci < content.length; ci++) {
        const item = content[ci];

        if (item instanceof Hyperlink) {
          const before = item.getText();
          this.relocateHyperlinkLeadingSpace(item, content, ci);
          if (item.getText() !== before) relocated++;
        } else if (item instanceof Revision) {
          if (item.getType() === "delete" || item.getType() === "moveFrom") continue;
          const revisionContent = item.getContent();
          for (let ri = 0; ri < revisionContent.length; ri++) {
            const revContent = revisionContent[ri];
            if (revContent instanceof Hyperlink) {
              const before = revContent.getText();
              if (ri > 0) {
                this.relocateHyperlinkLeadingSpace(
                  revContent,
                  revisionContent as unknown as ParagraphContent[],
                  ri
                );
              } else {
                this.relocateHyperlinkLeadingSpace(revContent, content, ci);
              }
              if (revContent.getText() !== before) relocated++;
            }
          }
        }
      }
    }

    return relocated;
  }

  /**
   * Check if a paragraph content item represents a hyperlink in any form:
   * - Direct Hyperlink instance
   * - ComplexField with HYPERLINK instruction
   * - PreservedElement wrapping a w:hyperlink XML element
   */
  private isHyperlinkItem(item: ParagraphContent): boolean {
    if (item instanceof Hyperlink) return true;
    if (item instanceof ComplexField && item.isHyperlinkField()) return true;
    if (item instanceof PreservedElement && item.getElementType() === "w:hyperlink") return true;
    return false;
  }

  /**
   * Extract visible text from any hyperlink representation.
   */
  private getHyperlinkItemText(item: ParagraphContent): string {
    if (item instanceof Hyperlink) return item.getText() || "";
    if (item instanceof ComplexField) return item.getResult() || "";
    if (item instanceof PreservedElement) {
      const raw = item.getRawXml();
      const texts: string[] = [];
      const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw)) !== null) texts.push(m[1]);
      return texts.join("");
    }
    return "";
  }

  /**
   * Search backward through content for the nearest Run before the given index.
   * Skips non-Run items like RangeMarker, Bookmark wrappers, etc.
   */
  private findPrecedingRun(content: ParagraphContent[], index: number): Run | null {
    for (let i = index - 1; i >= 0; i--) {
      const item = content[i];
      if (item instanceof Run) {
        // Skip empty Runs — keep searching for one with text
        if ((item.getText() || "").length > 0) return item;
        continue;
      }
      // Stop at visible content boundaries
      if (item instanceof Hyperlink || item instanceof ComplexField || item instanceof Revision) {
        return null;
      }
      // Stop at hyperlink-type PreservedElement (visible content)
      if (item instanceof PreservedElement && item.getElementType() === "w:hyperlink") {
        return null;
      }
      // Skip non-hyperlink PreservedElements (invisible markup: bookmarks, proofing, etc.)
    }
    return null;
  }

  /**
   * Search forward through content for the nearest Run after the given index.
   * Skips non-Run items like RangeMarker, Bookmark wrappers, etc.
   */
  private findFollowingRun(content: ParagraphContent[], index: number): Run | null {
    for (let i = index + 1; i < content.length; i++) {
      const item = content[i];
      if (item instanceof Run) {
        // Skip empty Runs — keep searching for one with text
        if ((item.getText() || "").length > 0) return item;
        continue;
      }
      // Stop at visible content boundaries
      if (item instanceof Hyperlink || item instanceof ComplexField || item instanceof Revision) {
        return null;
      }
      // Stop at hyperlink-type PreservedElement (visible content)
      if (item instanceof PreservedElement && item.getElementType() === "w:hyperlink") {
        return null;
      }
      // Skip non-hyperlink PreservedElements (invisible markup: bookmarks, proofing, etc.)
    }
    return null;
  }

  /**
   * Late-stage safety net: ensure a space exists before every hyperlink.
   *
   * If the preceding Run's text doesn't end with whitespace and the
   * hyperlink text doesn't start with whitespace, appends a space to
   * the preceding Run. This catches cases where leading spaces were
   * lost during processing (style application, whitespace normalization,
   * defragmentation) rather than just relocated.
   */
  private ensureSpaceBeforeHyperlinks(doc: Document): number {
    let added = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const content = para.getContent();

      for (let ci = 0; ci < content.length; ci++) {
        const item = content[ci];

        if (this.isHyperlinkItem(item)) {
          if (this.ensureSpaceBefore(item, content, ci)) added++;
        } else if (item instanceof Revision) {
          if (item.getType() === "delete" || item.getType() === "moveFrom") continue;
          const revisionContent = item.getContent();
          for (let ri = 0; ri < revisionContent.length; ri++) {
            const revContent = revisionContent[ri];
            if (this.isHyperlinkItem(revContent)) {
              if (ri > 0) {
                if (this.ensureSpaceBefore(
                  revContent,
                  revisionContent as unknown as ParagraphContent[],
                  ri
                )) added++;
              } else {
                if (this.ensureSpaceBefore(revContent, content, ci)) added++;
              }
            }
          }
        }
      }
    }

    return added;
  }

  /**
   * Ensure a space exists between the preceding Run and this hyperlink item.
   * Searches backward past non-visible items (RangeMarker, Bookmark, etc.)
   * to find the nearest Run. Returns true if a space was added.
   */
  private ensureSpaceBefore(
    hyperlinkItem: ParagraphContent,
    content: ParagraphContent[],
    index: number
  ): boolean {
    const hyperlinkText = this.getHyperlinkItemText(hyperlinkItem);
    if (!hyperlinkText || hyperlinkText.startsWith(" ")) return false;

    if (index === 0) return false;

    const prev = this.findPrecedingRun(content, index);
    if (!prev) {
      if (isDebugEnabled(debugModes.HYPERLINKS)) {
        const prevTypes = content.slice(Math.max(0, index - 3), index)
          .map(c => c.constructor.name + (c instanceof PreservedElement ? `(${c.getElementType()})` : ""))
          .join(", ");
        this.log.debug(`No preceding Run found before hyperlink at index ${index}; preceding: [${prevTypes}]`);
      }
      return false;
    }

    const prevText = prev.getText() || "";
    if (prevText.length === 0 || prevText.endsWith(" ")) return false;

    prev.setText(prevText + " ");
    return true;
  }

  /**
   * Late-stage safety net: ensure a space exists after every hyperlink.
   *
   * If the following Run's text doesn't start with whitespace and the
   * hyperlink text doesn't end with whitespace, prepends a space to
   * the following Run. This catches cases where trailing spaces were
   * lost during processing (trimming in applyStandardHyperlinkFormatting,
   * whitespace normalization, defragmentation).
   */
  private ensureSpaceAfterHyperlinks(doc: Document): number {
    let added = 0;
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const content = para.getContent();

      for (let ci = 0; ci < content.length; ci++) {
        const item = content[ci];

        if (this.isHyperlinkItem(item)) {
          if (this.ensureSpaceAfter(item, content, ci)) added++;
        } else if (item instanceof Revision) {
          if (item.getType() === "delete" || item.getType() === "moveFrom") continue;
          const revisionContent = item.getContent();
          for (let ri = 0; ri < revisionContent.length; ri++) {
            const revContent = revisionContent[ri];
            if (this.isHyperlinkItem(revContent)) {
              if (ri < revisionContent.length - 1) {
                if (this.ensureSpaceAfter(
                  revContent,
                  revisionContent as unknown as ParagraphContent[],
                  ri
                )) added++;
              } else {
                if (this.ensureSpaceAfter(revContent, content, ci)) added++;
              }
            }
          }
        }
      }
    }

    return added;
  }

  /**
   * Ensure a space exists between this hyperlink item and the following Run.
   * Searches forward past non-visible items (RangeMarker, Bookmark, etc.)
   * to find the nearest Run. Returns true if a space was added.
   */
  private ensureSpaceAfter(
    hyperlinkItem: ParagraphContent,
    content: ParagraphContent[],
    index: number
  ): boolean {
    const hyperlinkText = this.getHyperlinkItemText(hyperlinkItem);
    if (!hyperlinkText || hyperlinkText.endsWith(" ")) return false;

    if (index >= content.length - 1) return false;

    const next = this.findFollowingRun(content, index);
    if (!next) return false;

    const nextText = next.getText() || "";
    if (nextText.length === 0 || nextText.startsWith(" ")) return false;

    // Don't add space before punctuation (e.g., period, comma after a hyperlink)
    if (/^[^a-zA-Z0-9]/.test(nextText)) return false;

    next.setText(" " + nextText);
    return true;
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
  private applyHiddenTextStyle(doc: Document, normalStyle?: SessionStyle): number {
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

      const runs = getBodyRuns(para);
      for (const run of runs) {
        const currentColor = run.getFormatting().color?.toUpperCase();

        if (currentColor === "FFFFFF") {
          // Apply HiddenText formatting directly to preserve white color
          run.setFont("Verdana");
          run.setSize(12);
          run.setColor("FFFFFF");

          hiddenTextCount++;
          paraHasHiddenText = true;

          this.log.debug(`Applied HiddenText style to run: "${run.getText().substring(0, 30)}..."`);
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
   * Bake table-style conditional bold into direct run formatting.
   *
   * Some Word table styles (e.g. GridTable4-Accent3) bold an entire row or
   * column via `firstRow` / `firstCol` conditional formatting rather than a
   * direct `<w:b/>` on each run. The preserve-bold feature only leaves DIRECT
   * run formatting untouched, and `standardizeTableBorders` later resets
   * `tblLook` (dropping the conditional) — so conditional-only bold would
   * silently disappear from the output.
   *
   * This makes that bold explicit: for every table-cell run that RENDERS bold
   * (`getEffectiveBold()`, which resolves table-style conditional formatting
   * and honours explicit `<w:b w:val="0"/>` opt-outs) but carries no direct
   * bold attribute, it writes a direct bold. Runs that are not already
   * effectively bold are left untouched — nothing is bolded that was not
   * already bold before processing.
   *
   * Runs inside hyperlinks are skipped (`getBodyRuns`): `setBold()` can drop a
   * hyperlink run's color/underline, and a conditional-bold hyperlink is a
   * rare edge case.
   *
   * MUST run before track changes is enabled (the run already renders bold,
   * so making it explicit is not a user-visible change) and before the
   * `tblLook` reset in `standardizeTableBorders`.
   *
   * @param doc - Document to process
   * @returns Number of runs given an explicit bold attribute
   */
  private bakeConditionalTableBold(doc: Document): number {
    let baked = 0;
    for (const table of doc.getTables()) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          for (const para of cell.getParagraphs()) {
            for (const run of getBodyRuns(para)) {
              // Leave runs that already carry a direct bold attribute.
              if (run.getFormatting().bold !== undefined) continue;
              if (run.getEffectiveBold() === true) {
                run.setBold(true);
                baked++;
              }
            }
          }
        }
      }
    }
    return baked;
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
    const DEFAULT_COLOR = "000000";

    this.log.debug(`Standardizing table borders: size=${options.size} (${options.size / 8}pt)`);

    for (const table of tables) {
      try {
        // Skip floating tables and tables containing nested tables
        if (tableProcessor.shouldSkipTable(table)) {
          this.log.debug("Skipping floating/nested table for border processing");
          continue;
        }

        // Skip HLP tables - they get special border treatment
        if (tableProcessor.isHLPTable(table)) {
          this.log.debug("Skipping HLP table for standard border processing");
          continue;
        }

        // Create uniform border definition
        const border = {
          style: "single" as const,
          size: options.size,
          color: DEFAULT_COLOR,
        };

        // setAllBorders applies to all 6 border types AND all cells
        table.setAllBorders(border);
        table.setTblLook("0600");

        // Remove trailing empty rows — Word Web Layout collapses empty rows
        // to near-zero height, hiding the border above them
        const rows = table.getRows();
        for (let i = rows.length - 1; i >= 1; i--) {
          const row = rows[i]!;
          const cells = row.getCells();
          const isEmpty = cells.every((cell) => {
            const paragraphs = cell.getParagraphs();
            return paragraphs.every((para) => para.getContent().length === 0);
          });
          if (!isEmpty) break;
          table.removeRow(i);
          this.log.debug(`Removed trailing empty row ${i} from table`);
        }

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
      // Use docxmlater's NumberingManager API to modify list level formatting
      // This keeps the in-memory model in sync with the save pipeline,
      // avoiding corruption from raw XML manipulation via getPart/setPart.
      const numManager = doc.getNumberingManager();
      const allAbstract = numManager.getAllAbstractNumberings();

      if (allAbstract.length === 0) {
        this.log.info("No numbering definitions found to standardize");
        return 0;
      }

      this.log.debug(`Found ${allAbstract.length} abstract numbering definitions to process`);

      for (const abstractNum of allAbstract) {
        // Skip HLP table numbering — preserve original Symbol font + sizes
        if (this._hlpAbstractNumIds.has(abstractNum.getAbstractNumId())) continue;
        // Skip row-number column numbering — intentionally bold (set by formatStepNumberColumns)
        if (this._rowNumberAbstractNumIds.has(abstractNum.getAbstractNumId())) continue;
        // Skip mixed-list definitions — their per-level format/text/font is set
        // by createMixedListNumId and must not be disturbed by post-list passes
        // (matches the protection applied in applyBulletUniformity and
        // applyNumberedUniformity).
        if (this._mixedListAbstractNumIds.has(abstractNum.getAbstractNumId())) continue;

        const levels = abstractNum.getAllLevels();

        for (const level of levels) {
          if (level.getFormat() === "bullet") {
            // Bullet levels: ensure font matches character to prevent unidentified symbols.
            // PUA characters (e.g., \uF0B7) require specific fonts (Symbol, Wingdings, etc.)
            // This is a safety net for levels that applyBulletUniformity() may have skipped
            // (HLP-shared abstractNums) or where font was lost during XML parsing.
            this.ensureBulletFontMatch(level);
            level.setBold(false);
            this.patchLevelBoldOff(level); // Explicit <w:b w:val="0"/> to prevent bold inheritance
          } else {
            // Numbered levels: full standardization to Verdana 12pt black
            level.setFont("Verdana");
            level.setFontSize(24); // 12pt = 24 half-points
            level.setColor("000000"); // Black
            level.setBold(false); // Prefixes must never be bold
            this.patchLevelBoldOff(level); // Explicit <w:b w:val="0"/> to prevent bold inheritance
          }

          standardizedCount++;
          this.log.debug(
            `Standardized list level ${level.getLevel()} in abstractNum ${abstractNum.getAbstractNumId()}: ${level.getFormat() === "bullet" ? "bold cleared" : "Verdana 12pt black"}`
          );
        }
      }

      // Also ensure HLP bullet levels have correct fonts.
      // HLP levels are skipped above to preserve their formatting, but font
      // correctness is a rendering requirement, not a formatting preference.
      for (const abstractNum of allAbstract) {
        if (!this._hlpAbstractNumIds.has(abstractNum.getAbstractNumId())) continue;
        for (const level of abstractNum.getAllLevels()) {
          if (level.getFormat() === "bullet") {
            this.ensureBulletFontMatch(level);
          }
        }
      }

      if (standardizedCount > 0) {
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
   * Monkey-patch a NumberingLevel's toXML() to inject <w:b w:val="0"/>
   * into the level's <w:rPr>. This works around a docxmlater limitation
   * where setBold(false) produces no XML output instead of the explicit
   * <w:b w:val="0"/> needed to prevent bold inheritance from context.
   */
  private patchLevelBoldOff(level: unknown): void {
    const lvl = level as { toXML: () => any };
    const origToXML = lvl.toXML.bind(lvl);
    lvl.toXML = function () {
      const xml = origToXML();
      if (xml && Array.isArray(xml.children)) {
        for (const child of xml.children) {
          if (typeof child === "object" && child.name === "w:rPr") {
            if (!Array.isArray(child.children)) child.children = [];
            // Remove existing <w:b> and <w:bCs> elements first (Word uses first match)
            child.children = child.children.filter(
              (c: any) => typeof c !== "object" || (c.name !== "w:b" && c.name !== "w:bCs")
            );
            child.children.push({ name: "w:b", attributes: { "w:val": "0" } });
            child.children.push({ name: "w:bCs", attributes: { "w:val": "0" } });
            break;
          }
        }
      }
      return xml;
    };
  }

  /**
   * Ensure a bullet level's font can render its character.
   * PUA characters require specific fonts — mismatches cause "unidentified symbol" boxes.
   */
  private ensureBulletFontMatch(level: unknown): void {
    const lvl = level as {
      getProperties: () => { text: string; font: string };
      setFont: (f: string) => void;
    };
    const props = lvl.getProperties();
    const text = props.text;
    const font = props.font;

    if (text === "\uF0B7" && font !== "Symbol") {
      this.log.debug(`Fixing bullet font: char=\\uF0B7 font="${font}" → "Symbol"`);
      lvl.setFont("Symbol");
    } else if (text === "\uF0A7" && font !== "Wingdings") {
      this.log.debug(`Fixing bullet font: char=\\uF0A7 font="${font}" → "Wingdings"`);
      lvl.setFont("Wingdings");
    } else if ((text === "o" || text === "\u006F") && font !== "Courier New") {
      this.log.debug(`Fixing bullet font: char="o" font="${font}" → "Courier New"`);
      lvl.setFont("Courier New");
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
   * Standardize bold+colon formatting universally: anywhere bold text transitions
   * to non-bold and the next character is a colon, that colon should be bolded.
   * This ensures startsWithBoldColon() detection works correctly downstream.
   *
   * Per ECMA-376 Section 17.3.2.1 (b - bold): ensures consistent bold property
   * on runs so pattern matching for spacing rules doesn't produce false negatives.
   *
   * @param doc - The document to process
   * @returns Number of colons bolded
   */
  private standardizeBoldColonFormatting(doc: Document): number {
    let fixed = 0;

    const processParas = (paragraphs: Paragraph[]) => {
      for (const para of paragraphs) {
        const content = para.getContent();
        let lastWasBold = false;

        for (const item of content) {
          if (!(item instanceof Run)) {
            lastWasBold = false;
            continue;
          }
          const text = item.getText();
          if (!text) continue;

          const formatting = item.getFormatting();
          const isBold = !!formatting.bold;

          // Check for bold-to-non-bold transition where non-bold run starts with ":"
          if (lastWasBold && !isBold && text.startsWith(":")) {
            if (text === ":") {
              // Entire run is just ":" — bold it
              item.setBold(true);
              fixed++;
            } else {
              // Run starts with ":" (e.g., ": rest of text") — split it
              const colonRun = new Run(":", { ...formatting, bold: true });
              const remainderRun = new Run(text.substring(1), formatting);
              para.replaceContent(item, [colonRun, remainderRun]);
              fixed++;
            }
            // After bolding the colon, it's now bold, so lastWasBold stays true
            lastWasBold = true;
            continue;
          }

          lastWasBold = isBold;
        }
      }
    };

    // Process body paragraphs
    const bodyParas: Paragraph[] = [];
    for (let i = 0; i < doc.getBodyElementCount(); i++) {
      const el = doc.getBodyElementAt(i);
      if (el instanceof Paragraph) bodyParas.push(el);
    }
    processParas(bodyParas);

    // Process table cell paragraphs
    for (const table of doc.getAllTables()) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          processParas(cell.getParagraphs());
        }
      }
    }

    return fixed;
  }

  // fixStepTableColumnWidth logic moved inline into the table auto-fit loop above

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
      const paraStyle = para.getStyle() || "";
      if (paraStyle.startsWith("TOC") && paraStyle !== "TOCHeading") {
        continue;
      }

      let styleToApply = null;

      // PRIORITY 1: Check paragraph's existing Word style FIRST
      // This preserves Heading 1, Heading 2, etc. styles that already exist in the document
      const currentStyle = paraStyle || para.getFormatting()?.style || "";

      if ((currentStyle === "Heading1" || currentStyle === "Heading 1") && header1Style) {
        // Preserve Heading 1 - apply user's Heading 1 formatting
        styleToApply = header1Style;
      } else if ((currentStyle === "Heading2" || currentStyle === "Heading 2") && header2Style) {
        // Preserve Heading 2 - apply user's Heading 2 formatting
        styleToApply = header2Style;
      } else if ((currentStyle === "Heading3" || currentStyle === "Heading 3") && header3Style) {
        // Preserve Heading 3 - apply user's Heading 3 formatting
        styleToApply = header3Style;
      } else if (
        (currentStyle === "ListParagraph" || currentStyle === "List Paragraph") &&
        listParagraphStyle
      ) {
        // Preserve List Paragraph - apply user's List Paragraph formatting
        styleToApply = listParagraphStyle;
      } else if (currentStyle === "Normal" && normalStyle) {
        styleToApply = normalStyle;
      } else if (!currentStyle || currentStyle === "") {
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
        // Apply paragraph formatting
        const formatting = para.getFormatting();

        // Check if paragraph has an explicit Word style (e.g., "Normal", "Heading1", "ListParagraph")
        // Paragraphs without an explicit style should have their existing formatting preserved
        const explicitStyle = para.getStyle();
        const hasNoExplicitStyle =
          !explicitStyle || explicitStyle === "undefined" || explicitStyle === "";

        // Preserve center alignment if:
        // 1. The style has preserveCenterAlignment=true AND paragraph is centered, OR
        // 2. The paragraph has no explicit style AND is already centered
        const shouldPreserveAlignment =
          (styleToApply.preserveCenterAlignment && formatting.alignment === "center") ||
          (hasNoExplicitStyle && formatting.alignment === "center");

        if (!shouldPreserveAlignment) {
          para.setAlignment(styleToApply.alignment);
        } else {
          this.log.debug(
            `[Alignment] Preserved center alignment for paragraph ` +
              `(style: ${styleToApply.id}, explicitStyle: ${explicitStyle || "none"})`
          );
        }

        // Spacing is handled by style definitions (via doc.applyStyles()) for paragraphs
        // with explicit styles. Only set direct spacing on unstyled paragraphs that can't
        // inherit from a style definition.
        if (hasNoExplicitStyle) {
          para.setSpaceBefore(pointsToTwips(styleToApply.spaceBefore));
          para.setSpaceAfter(pointsToTwips(styleToApply.spaceAfter));
          if (styleToApply.lineSpacing) {
            para.setLineSpacing(pointsToTwips(styleToApply.lineSpacing * 12));
          }
        }

        // Apply text formatting to all runs in paragraph, including those inside revisions
        // This ensures runs inside w:ins, w:moveTo, etc. also get formatting applied
        const runs = getBodyRuns(para);
        for (const run of runs) {
          // getBodyRuns() excludes runs inside real Hyperlink elements.
          // If a run here has Hyperlink characterStyle, it is a FALSE hyperlink —
          // text that inherited "Hyperlink" character style without being inside a
          // w:hyperlink element. Strip the character style so it receives proper
          // paragraph-level formatting (Normal, List Paragraph, etc.)
          if (run.isHyperlinkStyled()) {
            run.setCharacterStyle(undefined as unknown as string);
            this.log.debug(
              `[FalseHyperlink] Stripped Hyperlink character style from run ` +
                `in "${currentStyle || "unstyled"}" paragraph: "${run.getText()?.substring(0, 40) || ""}"`
            );
            // Fall through to apply proper formatting
          }

          const runFormatting = run.getFormatting();

          // For paragraphs with explicit styles, font/size/color are handled by style
          // definitions (via doc.applyStyles()). Only set direct formatting on unstyled
          // paragraphs or when preservation logic requires it.
          if (hasNoExplicitStyle) {
            // Preserve font size if run has direct size set (e.g., 18pt bold title)
            const runSize = runFormatting.size;
            if (runSize === undefined) {
              run.setSize(styleToApply.fontSize);
            }

            // Preserve font if run has direct font set
            const runFont = runFormatting.font;
            if (runFont === undefined) {
              run.setFont(styleToApply.fontFamily);
            }

            // Set color (with white/red font preservation)
            const currentColor = runFormatting.color?.toUpperCase();
            const isWhiteFont = currentColor === "FFFFFF";
            const isRedFont = currentColor === "FF0000";
            const isNormalOrListStyle =
              styleToApply.id === "normal" || styleToApply.id === "listParagraph";
            if (!isWhiteFont && !(isRedFont && preserveRedFont && isNormalOrListStyle)) {
              run.setColor(styleToApply.color.replace("#", ""));
            }
          }

          // Preserve bold based on the user's preserveBold setting for this style.
          // When preserveBold=true (default for Normal), existing bold is kept.
          // When preserveBold=false, bold is set to the style's configured value.
          // This applies consistently to Normal and undefined-style paragraphs.
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

          // For styled paragraphs, preserve white/red font (doc.applyStyles handles font/size/color)
          if (!hasNoExplicitStyle) {
            const currentColor = runFormatting.color?.toUpperCase();
            const isWhiteFont = currentColor === "FFFFFF";
            const isRedFont = currentColor === "FF0000";
            const isNormalOrListStyle =
              styleToApply.id === "normal" || styleToApply.id === "listParagraph";

            // Only override color for white/red font preservation when needed
            if (isWhiteFont) {
              // White font was potentially cleared by doc.applyStyles() — restore it
              run.setColor("FFFFFF");
            } else if (isRedFont && preserveRedFont && isNormalOrListStyle) {
              // Red font preservation — restore it
              run.setColor("FF0000");
            }
          }

          // Clear redundant direct formatting that matches the style definition.
          // This allows runs to inherit from the style, so future style changes
          // propagate automatically. Only for paragraphs with explicit styles —
          // unstyled paragraphs need direct formatting since they don't reference a style.
          if (!hasNoExplicitStyle) {
            const styleRunFormatting: Partial<RunFormatting> = {
              font: styleToApply.fontFamily,
              size: styleToApply.fontSize,
              color: styleToApply.color.replace("#", ""),
            };
            // Only include bold/italic/underline in clearing when NOT preserved
            if (!styleToApply.preserveBold) {
              styleRunFormatting.bold = styleToApply.bold;
            }
            if (!styleToApply.preserveItalic) {
              styleRunFormatting.italic = styleToApply.italic;
            }
            if (!styleToApply.preserveUnderline) {
              styleRunFormatting.underline = styleToApply.underline ? "single" : false;
            }
            run.clearMatchingFormatting(styleRunFormatting);
          }
        }

        appliedCount++;
      }
    }

    return appliedCount;
  }

  /**
   * Final pass: ensure every paragraph's spacing matches the UI-configured style.
   * Runs AFTER all processing (table uniformity, list normalization, blank lines,
   * HLP formatting, etc.) to guarantee spacing isn't overwritten by earlier steps.
   * For paragraphs with explicit styles, spacing is set in the style definition
   * (via doc.applyStyles()), so we only set direct spacing on unstyled paragraphs
   * to avoid direct formatting overriding style-based values.
   */
  private finalizeParagraphSpacing(doc: Document, styles: SessionStyle[]): number {
    const header1 = styles.find((s) => s.id === "header1");
    const header2 = styles.find((s) => s.id === "header2");
    const header3 = styles.find((s) => s.id === "header3");
    const normal = styles.find((s) => s.id === "normal");
    const listParagraph = styles.find((s) => s.id === "listParagraph");

    let count = 0;
    for (const para of doc.getAllParagraphs()) {
      // Skip TOC and complex field paragraphs
      if (this.hasComplexFieldContent(para)) continue;
      const style = para.getStyle() || "";
      if (style.startsWith("TOC") && style !== "TOCHeading") continue;

      // Determine target style config based on paragraph's Word style
      let target: SessionStyle | undefined;
      let hasExplicitStyle = true;
      if (style === "Heading1" || style === "Heading 1") target = header1;
      else if (style === "Heading2" || style === "Heading 2") target = header2;
      else if (style === "Heading3" || style === "Heading 3") target = header3;
      else if (style === "ListParagraph" || style === "List Paragraph") target = listParagraph;
      else if (style === "Normal") target = normal;
      else if (!style) {
        target = normal;
        hasExplicitStyle = false;
      }

      if (!target) continue;

      // For styled paragraphs, spacing comes from the style definition — clear any
      // direct spacing so the style value takes effect (OOXML: direct > style).
      // For unstyled paragraphs, set all spacing as direct formatting.
      if (!hasExplicitStyle) {
        para.setSpaceBefore(pointsToTwips(target.spaceBefore));
        para.setSpaceAfter(pointsToTwips(target.spaceAfter));
        if (target.lineSpacing) {
          para.setLineSpacing(pointsToTwips(target.lineSpacing * 12));
        }
      } else {
        // Clear direct spacing so the style definition takes effect.
        // Direct spacing overrides style spacing per OOXML precedence rules,
        // so any leftover direct formatting from the original document must be removed.
        para.clearSpacing();
      }
      if (target.noSpaceBetweenSame !== undefined) {
        para.setContextualSpacing(target.noSpaceBetweenSame);
      }
      count++;
    }
    return count;
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
      // Maps firstLine to hanging indent (standard for list bullets/numbers).
      // Validates that hanging does not exceed left to prevent negative bullet positions.
      if (style.indentation) {
        paragraphFormatting.indentation = {};
        if (style.indentation.left !== undefined) {
          paragraphFormatting.indentation.left = pointsToTwips(style.indentation.left * 72);
        }
        if (style.indentation.firstLine !== undefined) {
          const hangingTwips = pointsToTwips(style.indentation.firstLine * 72);
          const leftTwips = paragraphFormatting.indentation.left ?? 0;
          // Cap hanging to left — hanging > left produces negative bullet position
          paragraphFormatting.indentation.hanging = Math.min(hangingTwips, leftTwips);
        }
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

    const options = {
      ...config,
    };

    this.log.debug("Applying custom formatting with options:", options);

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Update style definitions in styles.xml
    // This ensures Word's style gallery shows the updated formatting
    // ═══════════════════════════════════════════════════════════
    this.log.debug("=== UPDATING STYLE DEFINITIONS IN STYLES.XML ===");
    const styleIdMap: Record<string, string> = {
      header1: "Heading1",
      header2: "Heading2",
      header3: "Heading3",
      normal: "Normal",
      listParagraph: "ListParagraph",
    };

    for (const sessionStyle of styles) {
      const wordStyleId = styleIdMap[sessionStyle.id];
      if (!wordStyleId) {
        this.log.debug(`Skipping unknown style ID: ${sessionStyle.id}`);
        continue;
      }

      try {
        // Determine outline level for TOC support (Heading 1 = 0, Heading 2 = 1, Heading 3 = 2)
        const outlineLevel =
          wordStyleId === "Heading1"
            ? 0
            : wordStyleId === "Heading2"
              ? 1
              : wordStyleId === "Heading3"
                ? 2
                : undefined;

        const styleObj = Style.create({
          styleId: wordStyleId,
          name: sessionStyle.name,
          type: "paragraph",
          runFormatting: {
            font: sessionStyle.fontFamily,
            size: sessionStyle.fontSize,
            bold: sessionStyle.bold,
            italic: sessionStyle.italic,
            underline: sessionStyle.underline ? "single" : false,
            color: sessionStyle.color.replace("#", ""),
          },
          paragraphFormatting: {
            alignment: sessionStyle.alignment,
            spacing: {
              before: pointsToTwips(sessionStyle.spaceBefore),
              after: pointsToTwips(sessionStyle.spaceAfter),
              line: sessionStyle.lineSpacing ? pointsToTwips(sessionStyle.lineSpacing * 12) : 240,
              lineRule: "auto",
            },
            outlineLevel, // Required for TOC functionality
          },
        });

        // ListParagraph style definition contains critical numPr (e.g. numId=33) that
        // Style.create() can't replicate. Replacing it strips numPr, breaking numbering
        // inheritance for HLP table paragraphs. Skip the style replacement — formatting
        // is still applied to individual paragraphs by applyStyles() run-level processing.
        if (wordStyleId === "ListParagraph") {
          this.log.debug(
            "Skipping addStyle for ListParagraph (preserving numPr in style definition)"
          );
          continue;
        }

        doc.addStyle(styleObj);
        this.log.info(
          `✓ Updated style definition: ${wordStyleId} (${sessionStyle.fontFamily} ${sessionStyle.fontSize}pt)`
        );
      } catch (error) {
        this.log.warn(`Failed to update style definition for ${wordStyleId}:`, error);
        // Continue with other styles
      }
    }

    // Capture red font runs before framework call.
    // The framework's applyStyles() only preserves white font (preserveWhiteFont option).
    // Red font must be captured here and restored after the framework runs.
    let redFontRuns: Set<Run> | null = null;
    if (preserveRedFont) {
      redFontRuns = new Set<Run>();
      const allParas = doc.getAllParagraphs();
      for (const para of allParas) {
        const styleId = para.getStyle();
        const isNormalOrList =
          styleId === "Normal" ||
          styleId === "ListParagraph" ||
          styleId === "List Paragraph" ||
          !styleId;
        if (isNormalOrList) {
          const runs = getBodyRuns(para);
          for (const run of runs) {
            if (run.getFormatting().color?.toUpperCase() === "FF0000") {
              redFontRuns.add(run);
            }
          }
        }
      }
      if (redFontRuns.size > 0) {
        this.log.debug(`Captured ${redFontRuns.size} red font runs for preservation`);
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
      this.log.warn("Framework method applyStyles not available, using manual fallback");
    }

    // Restore red font runs that were overwritten by framework applyStyles()
    if (redFontRuns && redFontRuns.size > 0) {
      for (const run of redFontRuns) {
        run.setColor("FF0000");
      }
      this.log.debug(`Restored ${redFontRuns.size} red font runs after framework applyStyles()`);
    }

    // ALWAYS run manual style assignment to catch unstyled paragraphs
    // The framework method may not process paragraphs without explicit styles
    // (e.g., table cell paragraphs that have no w:pStyle defined)
    this.log.debug("Running manual assignStylesToDocument() for comprehensive coverage");
    const manualCount = await this.assignStylesToDocument(doc, styles, preserveRedFont);
    this.log.debug(`Manual style assignment applied to ${manualCount} additional paragraphs`);

    // The standard style set makes Heading 3 bold (intended for real headings).
    // But Heading 3 is frequently reused as BODY text inside table cells (e.g. the
    // first column of an "If.../Then..." table). Those cells must not inherit the
    // heading's bold. Emit an explicit non-bold override on such cell runs; real,
    // non-table headings keep their bold. (Font/color are direct run properties on
    // these cells, so they are unaffected either way.)
    this.neutralizeHeadingBoldInTableCells(doc);

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
   * Remove INHERITED bold from Heading 3 paragraphs that live inside table cells.
   *
   * The standardized Heading 3 style is bold (correct for real section headings),
   * but the style is frequently reused as body text inside table cells — e.g. the
   * first column of an "If.../Then..." table — where the author did not intend
   * bold. This emits an explicit `bold=false` override on those cell runs so they
   * render non-bold, while leaving real (non-table) headings and any run that
   * carries its OWN direct bold untouched. Hyperlink-styled runs are skipped
   * because setBold() can drop their color/underline (docxmlater gotcha).
   */
  private neutralizeHeadingBoldInTableCells(doc: Document): void {
    let cleared = 0;
    for (const table of doc.getAllTables()) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          for (const para of cell.getParagraphs()) {
            if (para.getStyle() !== "Heading3") continue;
            for (const run of para.getRuns()) {
              if (run.isHyperlinkStyled()) continue;
              if (run.getFormatting().bold === true) continue; // keep intentional direct bold
              run.setBold(false);
              cleared++;
            }
          }
        }
      }
    }
    if (cleared > 0) {
      this.log.debug(`Neutralized inherited Heading 3 bold on ${cleared} table-cell run(s)`);
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

      // Add outline level for TOC support (Heading 1 = 0, Heading 2 = 1, Heading 3 = 2)
      if (docStyleId === "Heading1") {
        paragraphFormatting.outlineLevel = 0;
      } else if (docStyleId === "Heading2") {
        paragraphFormatting.outlineLevel = 1;
      } else if (docStyleId === "Heading3") {
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
          singleCell.setShading({ fill: "auto", pattern: "clear", color: "auto" });

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
              const runs = getBodyRuns(para);

              // Validate and fix paragraph formatting
              // Preserve center alignment if paragraph is already centered
              const preserveCenter = formatting.alignment === "center";
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
                const isWhiteFont = runFormatting.color?.toUpperCase() === "FFFFFF";
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
                cell.setShading({ fill: shadingColor, pattern: "clear", color: "auto" });
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

      const runs = getBodyRuns(para);
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
    settings: {
      indentationLevels: Array<{ level: number; symbolIndent: number; textIndent: number }>;
    }
  ): number {
    const config = settings.indentationLevels.find((l) => l.level === level);
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
      // Skip HLP tables - they have their own formatting in processHLPTables
      if (tableProcessor.isHLPTable(table)) continue;

      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          const paragraphs = cell.getParagraphs();

          // Calculate cell baseline: minimum left indent across ALL paragraphs.
          // In split-column rows, Word sets structural w:ind w:left on all
          // paragraphs for cell positioning. This baseline captures that so we
          // only treat indentation BEYOND it as genuine content indentation.
          let cellBaselineIndent = Infinity;
          for (const p of paragraphs) {
            const fmt = p.getFormatting();
            const left = fmt.indentation?.left || 0;
            if (left < cellBaselineIndent) cellBaselineIndent = left;
          }
          if (cellBaselineIndent === Infinity) cellBaselineIndent = 0;

          // Track list context within this cell only
          let activeContext: { numId: number; level: number; textIndentTwips: number } | null =
            null;

          for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const numbering = para.getNumbering();

            if (numbering) {
              // This IS a list item - update context
              const level = numbering.level ?? 0;
              const actualIndent = this.getListTextIndent(doc, numbering.numId, level);
              const textIndentTwips =
                actualIndent ?? Math.round(this.getTextIndentForLevel(level, settings) * 1440);
              activeContext = { numId: numbering.numId, level, textIndentTwips };
              continue; // Don't modify list items themselves
            }

            // Not a list item - check if it should inherit context
            if (!activeContext) continue;

            const formatting = para.getFormatting();
            const rawLeftIndent = formatting.indentation?.left || 0;
            // Use indent relative to cell baseline to ignore structural positioning
            const existingLeftIndent = rawLeftIndent - cellBaselineIndent;

            // Apply indentation if paragraph has indentation beyond the cell baseline (genuine content indent)
            if (existingLeftIndent > 0) {
              // Get cell width and margins to calculate safe indent
              // Default to 2880tw (2") for auto-width cells where getWidth() is undefined
              const cellWidth = cell.getWidth() ?? 2880;
              const cellMargins = cell.getMargins();
              const leftMargin = cellMargins?.left || 0;
              const rightMargin = cellMargins?.right || 0;

              // Determine target indent (add baseline so it's on top of structural positioning)
              let targetIndent = activeContext.textIndentTwips + cellBaselineIndent;

              // Respect cell boundary: cap indent based on available width
              const availableWidth = cellWidth - leftMargin - rightMargin;

              // Skip indent entirely for very narrow cells (< 2 inches)
              // Indentation in narrow cells causes text clipping
              const NARROW_CELL_THRESHOLD = 2880; // 2 inches
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

              // Always cap indent at safe maximum
              if (targetIndent > maxSafeIndent) {
                targetIndent =
                  existingLeftIndent > 0 ? Math.min(rawLeftIndent, maxSafeIndent) : maxSafeIndent;
                this.log.debug(
                  `  Capped indent to ${targetIndent} twips (cell: ${cellWidth}, margins: L${leftMargin}/R${rightMargin}, available: ${availableWidth})`
                );
              }

              para.setLeftIndent(targetIndent);
              para.setHangingIndent(0);
              para.setFirstLineIndent(0);

              this.log.debug(
                `  Table cell continuation: para ${i}, numId=${activeContext.numId}, ` +
                  `level=${activeContext.level}, indent=${targetIndent}twips ` +
                  `(was ${rawLeftIndent}, baseline=${cellBaselineIndent})`
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

    // Helper to get textIndent for any level (extrapolating if needed)
    const getTextIndentForLevel = (level: number): number => {
      const levelConfig = settings.indentationLevels.find((l) => l.level === level);
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

    // Track the active list context — set when we see a list item,
    // cleared when we see a table, heading, or other non-continuation element.
    let activeContext: { numId: number; level: number; textIndentTwips: number } | null = null;

    // Iterate ONLY body-level elements to avoid double-processing table paragraphs
    // (table cells are already handled by ListNormalizer)
    const bodyElements = doc.getBodyElements();

    for (const element of bodyElements) {
      // Tables reset context — continuation doesn't span across tables
      if (element instanceof Table) {
        activeContext = null;
        continue;
      }

      // Only process Paragraphs
      if (!(element instanceof Paragraph)) {
        activeContext = null;
        continue;
      }

      const para = element;
      const numbering = para.getNumbering();

      // A real (marked) list item updates the active context.
      if (numbering && numbering.numId !== 0) {
        const level = numbering.level ?? 0;
        const actualIndent = this.getListTextIndent(doc, numbering.numId, level);
        const textIndentTwips =
          actualIndent ?? Math.round(getTextIndentForLevel(level) * 1440);

        activeContext = { numId: numbering.numId, level, textIndentTwips };
        continue;
      }

      // Headings reset context
      const style = para.getStyle() ?? "";
      if (style.startsWith("Heading") || style.startsWith("heading")) {
        activeContext = null;
        continue;
      }

      // No active list context — nothing to continue from
      if (!activeContext) continue;

      // Blank paragraphs don't reset context but shouldn't be indented
      const text = para.getText().trim();
      if (text.length === 0) continue;

      // Realign continuation text to the active list's text column, but ONLY
      // when it is already indented — that existing indent is what marks the
      // line as belonging to the list; a flush-left line is left untouched. This
      // covers both ordinary continuation text and a list item that lost its
      // marker (numbering suppressed / numId 0, or a ListParagraph-styled line
      // with no numbering — these fall through the marked-list branch above).
      const formatting = para.getFormatting();
      const existingLeftIndent = formatting.indentation?.left || 0;
      if (existingLeftIndent === 0) continue;

      // Apply the active list context's textIndent. Do NOT update activeContext —
      // the last *marked* list item remains the alignment reference.
      para.setLeftIndent(activeContext.textIndentTwips);
      para.setHangingIndent(0);
      para.setFirstLineIndent(0);

      this.log.debug(
        `List continuation indent: level=${activeContext.level}, ` +
          `textIndent=${activeContext.textIndentTwips}twips, was ${existingLeftIndent}twips`
      );

      indentedCount++;
    }

    return indentedCount;
  }

  /**
   * Helper: Check if a numbering ID represents a bullet list (by level 0).
   *
   * IMPORTANT: this only inspects level 0. For multi-level abstracts that
   * mix categories across levels (e.g. bullets at 0/1, decimal at 2,
   * bullets at 3+), this returns the LEVEL-0 verdict which may not match
   * the paragraph's actual visual category. For per-paragraph category
   * detection use `isBulletListAtLevel(doc, numId, ilvl)`.
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
   * Helper: Check whether a paragraph at (numId, ilvl) renders as a bullet.
   * Looks up the SPECIFIC level's format rather than level 0 — necessary for
   * multi-level abstracts that have bullets at some levels and numeric format
   * at others (e.g. List.docx where numId=2 has bullets at 0/1, decimal at 2,
   * and bullets at 3+). Falls back to the level-0 verdict if the requested
   * level isn't defined.
   */
  private isBulletListAtLevel(doc: Document, numId: number, ilvl: number): boolean {
    try {
      const manager = doc.getNumberingManager();
      const instance = manager.getInstance(numId);
      if (!instance) return false;

      const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
      if (!abstractNum) return false;

      const level = abstractNum.getLevel(ilvl);
      if (level) return level.getFormat() === "bullet";

      // Fallback when the requested level isn't defined: use level 0.
      const level0 = abstractNum.getLevel(0);
      return level0?.getFormat() === "bullet";
    } catch (error) {
      this.log.warn(
        `Error checking if numId ${numId} ilvl ${ilvl} is bullet: ${error}`
      );
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
   * Get the effective visual indentation for a list item.
   * Returns paragraph-level indent if set, otherwise the numbering definition's
   * leftIndent for the item's current ilvl.
   */
  private getEffectiveListIndent(
    doc: Document,
    para: Paragraph,
    numbering: { numId: number; level: number }
  ): number {
    const formatting = para.getFormatting();
    const paraLeft = formatting.indentation?.left || 0;
    if (paraLeft > 0) return paraLeft;

    // Fall back to numbering definition indent
    const numDefIndent = this.getListTextIndent(doc, numbering.numId, numbering.level);
    return numDefIndent ?? 0;
  }

  /**
   * Normalize list levels based on visual indentation
   *
   * Some documents have bullets where all items have w:ilvl="0" (level 0) but their
   * numbering definition places them at deeper indentation (e.g., left=1080 with open circle).
   * This method detects such items and updates their w:ilvl to match the visual indentation.
   *
   * Uses effective indentation (paragraph-level or numbering definition) to determine
   * the actual visual position, then matches against textIndent thresholds.
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

    // Build textIndent-based thresholds for matching effective indentation to levels.
    // Numbering definition leftIndent represents text position (matching textIndent),
    // NOT symbol position. With symbolIndent thresholds, standard ilvl=0 (720tw) would
    // wrongly map to L1. With textIndent thresholds (L0=[0,1080)), 720 correctly maps to L0.
    const textThresholds = this.buildTextIndentThresholds(settings.indentationLevels);

    this.log.debug("=== NORMALIZING LIST LEVELS FROM INDENTATION ===");
    this.log.debug(`  Built ${textThresholds.length} text-indent thresholds:`);
    textThresholds.forEach((t) => {
      this.log.debug(`    Level ${t.level}: ${t.minTwips} - ${t.maxTwips} twips`);
    });

    // Table cell list levels are NOT processed here — ListNormalizer is the
    // authoritative source for table cell levels. It preserves original ilvl,
    // applies levelShift for orphan normalization, and creates numIds with user
    // indentation settings. Re-inferring levels here from the new numDef
    // indentation would undo ListNormalizer's correct assignments.

    // Process body-level paragraphs (outside tables)
    // Group by numId and only adjust items in groups where ALL items share the same level
    // (indicating flat ilvl values that need indentation-based inference).
    // Groups with mixed levels already have correct multi-level structure — trust them.
    const bodyParagraphs: Paragraph[] = [];
    for (const el of doc.getBodyElements()) {
      if (el instanceof Paragraph) bodyParagraphs.push(el);
    }
    const manager = doc.getNumberingManager();

    // Collect and group body list paragraphs by numId
    const bodyNumIdGroups = new Map<
      number,
      Array<{
        para: Paragraph;
        numbering: NonNullable<ReturnType<Paragraph["getNumbering"]>>;
      }>
    >();

    for (const para of bodyParagraphs) {
      const numbering = para.getNumbering();
      if (!numbering) continue;

      // Skip HLP table numbering
      try {
        const instance = manager.getInstance(numbering.numId);
        if (instance && this._hlpAbstractNumIds.has(instance.getAbstractNumId())) continue;
      } catch {
        /* proceed if check fails */
      }

      // Skip row-number column numbering
      try {
        const instance = manager.getInstance(numbering.numId);
        if (instance && this._rowNumberAbstractNumIds.has(instance.getAbstractNumId())) continue;
      } catch {
        /* proceed if check fails */
      }

      if (!bodyNumIdGroups.has(numbering.numId)) {
        bodyNumIdGroups.set(numbering.numId, []);
      }
      bodyNumIdGroups.get(numbering.numId)!.push({ para, numbering });
    }

    // Phase 1: Handle groups with internal indent variation (per-group relative)
    // Phase 2: Collect flat groups for cross-group clustering
    const flatGroups: Array<{
      numId: number;
      items: Array<{
        para: (typeof bodyParagraphs)[0];
        numbering: NonNullable<ReturnType<(typeof bodyParagraphs)[0]["getNumbering"]>>;
        effectiveIndent: number;
      }>;
      representativeIndent: number;
    }> = [];

    for (const [numId, items] of bodyNumIdGroups) {
      const uniqueLevels = new Set(items.map((i) => i.numbering.level));
      if (uniqueLevels.size > 1) {
        this.log.debug(
          `  Skipping body numId ${numId}: already has multi-level structure (levels: ${[...uniqueLevels].join(", ")})`
        );
        continue;
      }

      const itemsWithIndent = items.map((item) => ({
        ...item,
        effectiveIndent: this.getEffectiveListIndent(doc, item.para, item.numbering),
      }));

      const minIndent = Math.min(...itemsWithIndent.map((i) => i.effectiveIndent));
      const maxIndent = Math.max(...itemsWithIndent.map((i) => i.effectiveIndent));

      if (maxIndent - minIndent >= 200) {
        // Phase 1: Internal variation — per-group relative approach (360tw/level)
        for (const { para, numbering, effectiveIndent } of itemsWithIndent) {
          const relativeIndent = effectiveIndent - minIndent;
          // Clamp to the 0-8 range Word/docxmlater support — a deeply (manually)
          // indented item could otherwise compute ilvl 9+ and reference a level
          // with no <w:lvl> definition (no marker/indent). Matches the clamp in
          // list-detection.ts inferLevelFromRelativeIndentation and the rest of
          // this file's level assignments.
          const inferredLevel = Math.min(8, Math.floor(relativeIndent / 360));

          if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
            const numDefIndent = this.getListTextIndent(doc, numbering.numId, numbering.level);
            const paraLeft = para.getFormatting().indentation?.left || 0;
            const textSnippet = para.getText().substring(0, 35).replace(/\n/g, " ");
            this.log.debug(
              `  [BODY ITEM] "${textSnippet}..." ` +
                `origLevel=${numbering.level}, paraLeft=${paraLeft}tw, ` +
                `numDefIndent=${numDefIndent ?? "N/A"}tw, ` +
                `effectiveIndent=${effectiveIndent}tw, relativeIndent=${relativeIndent}tw`
            );
          }

          if (inferredLevel !== numbering.level) {
            if (isDebugEnabled(debugModes.LIST_PROCESSING)) {
              this.log.debug(
                `    -> CHANGING from level ${numbering.level} to ${inferredLevel} (relative indent)`
              );
            }
            this.log.debug(
              `  Normalizing body paragraph: effectiveIndent=${effectiveIndent}tw, ` +
                `relativeIndent=${relativeIndent}tw, ` +
                `current level=${numbering.level}, inferred level=${inferredLevel}`
            );
            para.setNumbering(numbering.numId, inferredLevel);
            normalized++;
          }
        }
      } else {
        // Phase 2: Flat group — collect for cross-group clustering
        this.log.debug(
          `  Flat group numId ${numId}: representativeIndent=${minIndent}tw (range=${maxIndent - minIndent}tw, ${items.length} items)`
        );
        flatGroups.push({ numId, items: itemsWithIndent, representativeIndent: minIndent });
      }
    }

    // Phase 2: Bullet-format clustering for flat groups
    // Group flat numIds by their abstractNum level definition's bullet format (font + text).
    // All groups sharing the same visual bullet format are assigned the same level.
    // The level is determined by mapping the minimum representative indentation of each
    // format group to the user's textIndent thresholds — this is deterministic regardless
    // of which processing options are enabled or what order groups appear in.
    const groupFormatKeys = new Map<number, string>(); // numId → format key
    const formatMinIndent = new Map<string, number>(); // format key → minimum representative indent

    for (const group of flatGroups) {
      try {
        const instance = manager.getInstance(group.numId);
        if (!instance) continue;
        const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
        if (!abstractNum) continue;
        const ilvl = group.items[0].numbering.level;
        const levelDef = abstractNum.getLevel(ilvl);
        if (!levelDef) continue;
        const props = levelDef.getProperties();
        const formatKey = `${props.font || ""}|${props.text || ""}`;
        groupFormatKeys.set(group.numId, formatKey);
        // Track the minimum representative indentation across all groups sharing this format
        const existing = formatMinIndent.get(formatKey);
        if (existing === undefined || group.representativeIndent < existing) {
          formatMinIndent.set(formatKey, group.representativeIndent);
        }
        this.log.debug(
          `  Format: numId ${group.numId} → "${formatKey}" indent=${group.representativeIndent}tw (${group.items.length} items)`
        );
      } catch {
        /* skip groups where numbering lookup fails */
      }
    }

    this.log.debug(
      `  Bullet-format clustering: ${flatGroups.length} flat groups → ${formatMinIndent.size} distinct formats`
    );

    // Map each format group to a level using textThresholds applied to its minimum indent.
    // Same visual bullet → same level (from the lowest-indented instance of that bullet).
    const formatLevelMap = new Map<string, number>(); // format key → assigned level
    for (const [formatKey, minIndent] of formatMinIndent) {
      const level = this.inferLevelFromIndentation(minIndent, textThresholds);
      formatLevelMap.set(formatKey, level);
      this.log.debug(`  Format level: "${formatKey}" minIndent=${minIndent}tw → level ${level}`);
    }

    // Apply the threshold-based level to every item in each flat group
    for (const group of flatGroups) {
      const formatKey = groupFormatKeys.get(group.numId);
      if (formatKey === undefined) continue;
      const level = formatLevelMap.get(formatKey);
      if (level === undefined) continue;
      for (const { para, numbering } of group.items) {
        if (level !== numbering.level) {
          this.log.debug(
            `  Format assign: numId=${numbering.numId}, "${formatKey}" → level ${numbering.level} → ${level}`
          );
          para.setNumbering(numbering.numId, level);
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
        i < levels.length - 1 ? Math.round(levels[i + 1].symbolIndent * 1440) : currentTwips + 720; // Default 0.5" increment for extrapolation

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
   * Build indentation thresholds using textIndent values instead of symbolIndent.
   *
   * Numbering definition leftIndent represents text position (matching textIndent),
   * not symbol position. Standard ilvl=0 has leftIndent=720tw. With symbolIndent
   * thresholds (L0=[0,720)), 720 maps to L1 — wrong. With textIndent thresholds
   * (L0=[0,1080)), 720 maps to L0 — correct.
   */
  private buildTextIndentThresholds(
    levels: Array<{ textIndent: number }>
  ): Array<{ level: number; minTwips: number; maxTwips: number }> {
    const thresholds: Array<{ level: number; minTwips: number; maxTwips: number }> = [];

    for (let i = 0; i < levels.length; i++) {
      const currentTwips = Math.round(levels[i].textIndent * 1440);
      const nextTwips =
        i < levels.length - 1 ? Math.round(levels[i + 1].textIndent * 1440) : currentTwips + 720;

      const midpointToNext = Math.round((currentTwips + nextTwips) / 2);
      const prevTwips = i > 0 ? Math.round(levels[i - 1].textIndent * 1440) : 0;
      const midpointFromPrev = i > 0 ? Math.round((prevTwips + currentTwips) / 2) : 0;

      thresholds.push({
        level: i,
        minTwips: midpointFromPrev,
        maxTwips: midpointToNext,
      });
    }

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
   * Normalize orphan Level 1+ list items in the document body.
   *
   * Body-level list items may start at ilvl=1+ with no ilvl=0 sibling
   * in the same contiguous run. This shifts all items down by the run's
   * minimum level so they start at ilvl=0.
   *
   * Uses getBodyElements() (not getParagraphs()) to exclude table cell
   * paragraphs, and groups by contiguous runs of the same numId rather
   * than globally — so sub-bullets that follow their parent at ilvl=0
   * are never incorrectly flattened.
   */
  private normalizeOrphanBodyListLevels(doc: Document): number {
    const manager = doc.getNumberingManager();

    // Use getBodyElements() to get ONLY body-level elements (not table cell paragraphs)
    const bodyElements = doc.getBodyElements();

    // Classify each body element into an OrphanLevelEvent. The orphan-shift
    // algorithm itself lives in the pure `computeOrphanBodyListShifts` helper
    // (list/orphanLevels.ts) so it is unit-testable without a Document.
    const events: OrphanLevelEvent[] = [];
    const paraByIndex: (Paragraph | null)[] = [];

    for (const element of bodyElements) {
      if (!(element instanceof Paragraph)) {
        events.push({ kind: "break" });
        paraByIndex.push(null);
        continue;
      }

      const numbering = element.getNumbering();
      if (!numbering) {
        events.push(element.getText().trim().length > 0 ? { kind: "text" } : { kind: "blank" });
        paraByIndex.push(null);
        continue;
      }

      // HLP and row-number protected items must not participate in shifting —
      // treat them as a structural boundary.
      let isProtected = false;
      try {
        const instance = manager.getInstance(numbering.numId);
        if (instance) {
          if (this._hlpAbstractNumIds.has(instance.getAbstractNumId())) isProtected = true;
          if (this._rowNumberAbstractNumIds.has(instance.getAbstractNumId())) isProtected = true;
        }
      } catch {
        /* proceed */
      }

      if (isProtected) {
        events.push({ kind: "break" });
        paraByIndex.push(null);
        continue;
      }

      events.push({ kind: "list", numId: numbering.numId, level: numbering.level });
      paraByIndex.push(element);
    }

    // Apply the computed shifts.
    let normalized = 0;
    for (const [index, newLevel] of computeOrphanBodyListShifts(events)) {
      const event = events[index];
      const para = paraByIndex[index];
      if (para && event && event.kind === "list") {
        para.setNumbering(event.numId, newLevel);
        normalized++;
      }
    }

    return normalized;
  }

  /**
   * Normalize level gaps in list item sequences.
   *
   * After other normalization steps, some sequences may have non-contiguous levels
   * (e.g., 0→1→3→4, skipping level 2). This collapses the gaps to produce
   * contiguous levels (0→1→2→3) while preserving the relative ordering.
   *
   * Processes both table cells and body paragraph sequences grouped by numId.
   *
   * @param doc - The document to process
   * @returns Number of paragraphs whose level was adjusted
   */
  private normalizeLevelGaps(doc: Document): number {
    let normalized = 0;
    const manager = doc.getNumberingManager();

    // Process table cells
    for (const table of doc.getAllTables()) {
      if (tableProcessor.isHLPTable(table)) continue;

      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          const paragraphs = cell.getParagraphs();
          const listItems: Array<{
            para: (typeof paragraphs)[0];
            numbering: NonNullable<ReturnType<(typeof paragraphs)[0]["getNumbering"]>>;
          }> = [];

          for (const para of paragraphs) {
            const numbering = para.getNumbering();
            if (!numbering) continue;

            // Skip HLP and row-number protected items
            try {
              const instance = manager.getInstance(numbering.numId);
              if (instance) {
                if (this._hlpAbstractNumIds.has(instance.getAbstractNumId())) continue;
                if (this._rowNumberAbstractNumIds.has(instance.getAbstractNumId())) continue;
              }
            } catch {
              /* proceed */
            }

            listItems.push({ para, numbering });
          }

          if (listItems.length < 2) continue;
          normalized += this.collapseLevelGapsInGroup(listItems);
        }
      }
    }

    // Process body paragraphs — partition into CONTIGUOUS runs, then collapse
    // gaps per run. Grouping by numId across the WHOLE document let two SEPARATE
    // body lists that happen to share one numId mask each other's gaps: List A
    // {0,1} + List B {0,2} pooled to {0,1,2}, which looks gap-free and left B's
    // item stranded at the skipped level 2. A run is broken by a non-paragraph
    // element, a real (non-blank) prose paragraph, a protected HLP/row-number
    // item, or a numId change. Blank paragraphs do NOT break a run — they are
    // intra-list spacing, not a list boundary.
    type BodyRunItem = {
      para: Paragraph;
      numbering: NonNullable<ReturnType<Paragraph["getNumbering"]>>;
    };
    let currentRun: BodyRunItem[] = [];
    let currentRunNumId: number | null = null;

    const flushBodyRun = () => {
      if (currentRun.length >= 2) {
        normalized += this.collapseLevelGapsInGroup(currentRun);
      }
      currentRun = [];
      currentRunNumId = null;
    };

    for (const el of doc.getBodyElements()) {
      if (!(el instanceof Paragraph)) {
        flushBodyRun();
        continue;
      }
      const numbering = el.getNumbering();
      if (!numbering) {
        // A real prose paragraph separates two lists; a blank does not.
        const text = el.getText();
        if (text && text.trim().length > 0) flushBodyRun();
        continue;
      }
      // Protected HLP / row-number items are boundaries and never collapsed.
      let isProtected = false;
      try {
        const instance = manager.getInstance(numbering.numId);
        if (instance) {
          const absId = instance.getAbstractNumId();
          isProtected =
            this._hlpAbstractNumIds.has(absId) || this._rowNumberAbstractNumIds.has(absId);
        }
      } catch {
        /* proceed as unprotected */
      }
      if (isProtected) {
        flushBodyRun();
        continue;
      }
      if (currentRunNumId !== null && numbering.numId !== currentRunNumId) {
        flushBodyRun();
      }
      currentRunNumId = numbering.numId;
      currentRun.push({ para: el, numbering });
    }
    flushBodyRun();

    return normalized;
  }

  /**
   * Collapse non-contiguous level gaps within a group of list items.
   * E.g., levels {0, 1, 3, 4} → {0, 1, 2, 3} (gap at 2 collapsed).
   * Only collapses gaps; never reorders items.
   */
  private collapseLevelGapsInGroup(
    items: Array<{
      para: {
        getNumbering(): { numId: number; level: number } | undefined;
        setNumbering(numId: number, level: number): void;
      };
      numbering: { numId: number; level: number };
    }>
  ): number {
    // Collect unique used levels sorted ascending
    const usedLevels = [...new Set(items.map((i) => i.numbering.level))].sort((a, b) => a - b);

    if (usedLevels.length < 2) return 0;

    // Check for gaps: are levels non-contiguous?
    let hasGaps = false;
    for (let i = 1; i < usedLevels.length; i++) {
      if (usedLevels[i] - usedLevels[i - 1] > 1) {
        hasGaps = true;
        break;
      }
    }

    if (!hasGaps) return 0;

    // Build mapping: original level → collapsed contiguous level
    // Start from the base level (usedLevels[0]) and assign consecutive values
    const levelMap = new Map<number, number>();
    usedLevels.forEach((level, index) => {
      levelMap.set(level, usedLevels[0] + index);
    });

    this.log.debug(
      `  Collapsing level gaps: [${usedLevels.join(", ")}] → [${usedLevels.map((_, i) => usedLevels[0] + i).join(", ")}]`
    );

    let changed = 0;
    for (const { para, numbering } of items) {
      const newLevel = levelMap.get(numbering.level);
      if (newLevel !== undefined && newLevel !== numbering.level) {
        para.setNumbering(numbering.numId, newLevel);
        changed++;
      }
    }

    return changed;
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

    // Trace indentation config values for debugging level 0 mismatch issues
    this.log.info(
      `Bullet uniformity config: ${settings.indentationLevels
        .map((l, i) => `L${i}(sym=${l.symbolIndent}", txt=${l.textIndent}")`)
        .join(", ")}`
    );

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
    this.log.debug(
      `Max bullet level in document: ${maxLevel}, creating ${totalLevelsNeeded} levels`
    );

    // Create custom levels with font specified and UI indentation
    // Extend to cover all levels needed, extrapolating indentation for unconfigured levels
    const levels: NumberingLevel[] = [];
    const lastConfig = settings.indentationLevels[settings.indentationLevels.length - 1];

    for (let index = 0; index < totalLevelsNeeded; index++) {
      const configLevel = settings.indentationLevels[index];
      // For levels deeper than the configured pattern, CYCLE the pattern rather
      // than always reusing level 0's glyph, so deep levels stay visually
      // distinguishable (matching how indentation is extrapolated below).
      const bullet = bullets[index % bullets.length] || bullets[0] || "\u2022";

      // Use configured settings if available, otherwise extrapolate from last configured level
      // Each additional level adds 0.25 inches of indentation
      const symbolIndent =
        configLevel?.symbolIndent ??
        lastConfig.symbolIndent + (index - settings.indentationLevels.length + 1) * 0.25;
      const textIndent =
        configLevel?.textIndent ??
        lastConfig.textIndent + (index - settings.indentationLevels.length + 1) * 0.25;

      this.log.debug(
        `  Level ${index}: bulletChar="${bullet}" (U+${bullet.charCodeAt(0).toString(16).toUpperCase()}), ` +
          `symbolIndent=${symbolIndent}", textIndent=${textIndent}"${configLevel ? "" : " (extrapolated)"}`
      );

      const symbolTwips = Math.round(symbolIndent * 1440);
      const baseTextTwips = Math.round(textIndent * 1440);
      // Bullet lists never get wider hanging indent — only numbered lists need it
      const textTwips = baseTextTwips;
      const hangingTwips = textTwips - symbolTwips;

      // Get font-specific character and font for this bullet type
      const mapping = getBulletMapping(bullet);

      // OOXML indentation semantics:
      // - leftIndent (w:left): where TEXT starts (in twips from left margin)
      // - hangingIndent (w:hanging): how far the BULLET/NUMBER hangs back from text position
      // So if symbolIndent=0.5" and textIndent=0.75", bullet is at 0.5" and text at 0.75"
      levels.push(
        new NumberingLevel({
          level: index,
          format: "bullet",
          text: mapping.char, // Font-specific character (e.g., · for Symbol, 'o' for Courier New)
          font: mapping.font, // Correct font for this bullet type
          leftIndent: textTwips, // Text starts at textIndent position
          hangingIndent: hangingTwips, // Bullet hangs back by (textIndent - symbolIndent)
        })
      );
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
        // Skip HLP table lists — their numbering structure must be preserved
        if (this._hlpAbstractNumIds.has(abstractNum.getAbstractNumId())) continue;
        // Skip mixed-list definitions — their per-level pattern (filled/open
        // alternation for numbered-lead, decimal/letter/roman cycle for
        // bullet-lead) must not be flattened to the user's flat bullet config.
        if (this._mixedListAbstractNumIds.has(abstractNum.getAbstractNumId())) continue;

        let isModified = false;

        // CRITICAL FIX: Update ALL 9 levels (0-8) that Word supports
        // Word documents can have bullet lists with 9 levels total
        // If we only update configured levels (e.g., 0-2), levels 3-8 keep their old symbols (like ■)
        for (let levelIndex = 0; levelIndex < 9; levelIndex++) {
          const level = abstractNum.getLevel(levelIndex);
          if (level && level.getFormat() === "bullet") {
            // Use the configured symbol for this level; for levels deeper than
            // the configured pattern, CYCLE the pattern (rather than always
            // reusing level 0's glyph) so deep levels stay distinguishable.
            const newSymbol = bullets[levelIndex % bullets.length] || bullets[0] || "\u2022";

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
              // Bullet lists never get wider hanging indent
              const textTwips = Math.round(levelConfig.textIndent * 1440);
              const hangingTwips = textTwips - symbolTwips;
              level.setLeftIndent(textTwips); // Text starts at textIndent
              level.setHangingIndent(hangingTwips); // Number hangs back by (textIndent - symbolIndent)

              this.log.info(
                `Level ${levelIndex}: config symbol=${levelConfig.symbolIndent}", text=${levelConfig.textIndent}" ` +
                  `→ left=${textTwips}tw, hanging=${hangingTwips}tw, bullet@${textTwips - hangingTwips}tw (${((textTwips - hangingTwips) / 1440).toFixed(2)}")`
              );
            }

            isModified = true;

            this.log.debug(
              `  Updated abstractNum level ${levelIndex}: ` +
                `char="${mapping.char}", font=${mapping.font}, ` +
                `textIndent=${levelConfig?.textIndent || "default"}", symbolIndent=${levelConfig?.symbolIndent || "default"}", color=#000000`
            );
          }
        }

        if (isModified) {
          // Re-register with the manager to mark as modified —
          // level setters (setLeftIndent, setHangingIndent, etc.) don't notify the NumberingManager
          manager.addAbstractNumbering(abstractNum);
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
   * Remove `w:tab val="num"` tab stops from list level definitions in numbering.xml.
   *
   * These tab stops create additional visual indentation that the code's indentation
   * calculations (which only use w:ind) don't account for. Removing them ensures
   * that only w:ind controls list indentation.
   *
   * Applies to both bullet and numbered list levels.
   * Preserves any non-"num" tab types (e.g., "left", "center") in the level definition.
   *
   * IMPORTANT: Raw XML manipulation via getPart/setPart.
   * This method operates on the raw XML string of numbering.xml rather than the
   * NumberingManager API because there is no API for tab stop removal. It MUST run
   * AFTER all NumberingManager API calls (applyBulletUniformity, applyNumberedUniformity,
   * etc.) to avoid the in-memory model overwriting these raw XML changes on save.
   * The call site enforces this ordering — see processDocument().
   */
  private async removeNumberingTabStops(doc: Document): Promise<number> {
    try {
      const numberingPart = await doc.getPart("word/numbering.xml");
      if (!numberingPart || typeof numberingPart.content !== "string") {
        this.log.debug("No numbering.xml found — skipping tab stop removal");
        return 0;
      }

      let xmlContent = numberingPart.content;
      let tabStopsRemoved = 0;

      // Find all <w:lvl> elements
      const lvlRegex = /<w:lvl w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g;
      const matches = Array.from(xmlContent.matchAll(lvlRegex));

      // Process in reverse order to avoid offset issues from string replacement
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const levelContent = match[2];
        const fullMatch = match[0];

        // Check if this level has a w:tab val="num" element
        if (!/<w:tab\s[^>]*w:val="num"/.test(levelContent)) {
          continue;
        }

        let updatedContent = levelContent;

        // Remove <w:tab w:val="num" .../> elements (self-closing)
        // Handles variations like: <w:tab w:val="num" w:pos="720"/>
        // and: <w:tab w:pos="720" w:val="num"/>
        updatedContent = updatedContent.replace(/<w:tab\s[^>]*w:val="num"[^/]*\/>\s*/g, "");
        // Also handle case where w:val="num" comes before other attributes
        updatedContent = updatedContent.replace(/<w:tab\s+w:val="num"[^/]*\/>\s*/g, "");

        // If <w:tabs> is now empty, remove the entire <w:tabs> element
        updatedContent = updatedContent.replace(/<w:tabs>\s*<\/w:tabs>/g, "");
        // Also handle self-closing empty tabs (defensive)
        updatedContent = updatedContent.replace(/<w:tabs\s*\/>/g, "");

        if (updatedContent !== levelContent) {
          const updatedLevel = fullMatch.replace(levelContent, updatedContent);
          xmlContent = xmlContent.replace(fullMatch, updatedLevel);
          tabStopsRemoved++;

          this.log.debug(`Removed w:tab val="num" from list level ${match[1]}`);
        }
      }

      if (tabStopsRemoved > 0) {
        await doc.setPart("word/numbering.xml", xmlContent);
        this.log.info(`Removed numbering tab stops from ${tabStopsRemoved} list levels`);
      }

      return tabStopsRemoved;
    } catch (error) {
      this.log.warn("Failed to remove numbering tab stops:", error);
      return 0;
    }
  }

  /**
   * Detect whether any numbered list at level 0 has 10+ items.
   * When true, the hanging indent should be widened from 0.25" to 0.30"
   * so double-digit numbers (10., 11., etc.) don't overflow the indent gap.
   */
  private detectNeedsWiderHangingIndent(doc: Document): boolean {
    const paragraphs = doc.getAllParagraphs();
    const countByNumId = new Map<number, number>();

    for (const para of paragraphs) {
      const numbering = para.getNumbering();
      if (!numbering || numbering.numId === undefined || numbering.numId === 0) continue;
      if ((numbering.level ?? 0) !== 0) continue;
      if (!this.isNumberedList(doc, numbering.numId)) continue;

      const count = (countByNumId.get(numbering.numId) ?? 0) + 1;
      countByNumId.set(numbering.numId, count);

      // Early exit: as soon as any list reaches 10, we know
      if (count >= 10) {
        this.log.debug(
          `Detected numbered list numId=${numbering.numId} with 10+ level-0 items — will widen hanging indent`
        );
        return true;
      }
    }

    return false;
  }

  /**
   * Get the extra twips to add to text indent when documents have 10+ numbered items.
   * Only applies to numbered lists — bullet lists never need wider hanging indent.
   *
   * @param doc - Document (required when numId is provided)
   * @param numId - If provided, checks whether this specific list is numbered.
   *               Bullet lists return 0 even when needsWiderHangingIndent is true.
   */
  private getExtraHangingTwips(doc?: Document, numId?: number): number {
    if (!this.needsWiderHangingIndent) return 0;
    // If numId provided, only apply to numbered lists
    if (doc && numId !== undefined) {
      if (!this.isNumberedList(doc, numId)) return 0;
    }
    return WIDE_HANGING_EXTRA_TWIPS;
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
    this.log.debug(
      `Max numbered level in document: ${maxLevel}, creating ${totalLevelsNeeded} levels`
    );

    // Create custom levels with UI indentation
    // Extend to cover all levels needed, extrapolating indentation for unconfigured levels
    const levels: NumberingLevel[] = [];
    const lastConfig = settings.indentationLevels[settings.indentationLevels.length - 1];

    for (let index = 0; index < totalLevelsNeeded; index++) {
      const configLevel = settings.indentationLevels[index];

      // Use configured settings if available, otherwise extrapolate from last configured level
      // Each additional level adds 0.25 inches of indentation
      const symbolIndent =
        configLevel?.symbolIndent ??
        lastConfig.symbolIndent + (index - settings.indentationLevels.length + 1) * 0.25;
      const textIndent =
        configLevel?.textIndent ??
        lastConfig.textIndent + (index - settings.indentationLevels.length + 1) * 0.25;
      const format = formats[index] || formats[formats.length - 1] || "decimal";

      const symbolTwips = Math.round(symbolIndent * 1440);
      const extraTwips = this.getExtraHangingTwips();
      const textTwips = Math.round(textIndent * 1440) + extraTwips;
      const hangingTwips = textTwips - symbolTwips;

      // OOXML indentation semantics:
      // - leftIndent (w:left): where TEXT starts (in twips from left margin)
      // - hangingIndent (w:hanging): how far the NUMBER hangs back from text position
      levels.push(
        new NumberingLevel({
          level: index,
          format: format,
          text: `%${index + 1}.`, // Standard template (e.g., %1., %2.)
          leftIndent: textTwips, // Text starts at textIndent position
          hangingIndent: hangingTwips, // Number hangs back by (textIndent - symbolIndent)
        })
      );
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

    // standardizeNumberedListPrefixes sets font=Verdana on EVERY level of every
    // non-bullet-lead numbered abstract. For our numbered-lead mixed abstracts,
    // that clobbers the Symbol/Courier-New font on the bullet sub-levels, so
    // U+F0B7 / U+006F render as .notdef rectangles. Re-stamp the bullet font
    // (matches docxmlater's WORD_NATIVE_BULLETS encoding) on every mixed
    // abstract immediately after the framework call.
    const restored = restampMixedListBulletFonts(doc, this._mixedListAbstractNumIds);
    if (restored > 0) {
      this.log.debug(
        `Restored Symbol/Courier-New bullet font on ${restored} mixed-list abstract(s) after standardizeNumberedListPrefixes`
      );
    }

    // H1: a PRE-EXISTING numbered-LEAD list with a bullet SUB-level (e.g. a
    // decimal level 0 with a Wingdings filled-square level 2) is NOT in
    // _mixedListAbstractNumIds, so standardizeNumberedListPrefixes clobbered its
    // bullet-level font to Verdana too, rendering the glyph as a .notdef box.
    // Repair the bullet font on every non-protected numbered-lead abstract that
    // has a bullet sub-level. Only bullet levels are touched (numbered levels
    // keep their standardized font).
    const bulletSubLevelAbstracts = new Set<number>();
    const h1Manager = doc.getNumberingManager();
    for (const abstractNum of h1Manager.getAllAbstractNumberings()) {
      const absId = abstractNum.getAbstractNumId();
      if (this._mixedListAbstractNumIds.has(absId)) continue; // already repaired above
      if (this._hlpAbstractNumIds.has(absId) || this._rowNumberAbstractNumIds.has(absId)) {
        continue;
      }
      const level0 = abstractNum.getLevel(0);
      if (!level0 || level0.getFormat() === "bullet") continue; // numbered-lead only
      for (let i = 1; i < 9; i++) {
        const lvl = abstractNum.getLevel(i);
        if (lvl && lvl.getFormat() === "bullet") {
          bulletSubLevelAbstracts.add(absId);
          break;
        }
      }
    }
    if (bulletSubLevelAbstracts.size > 0) {
      const subRestored = restampMixedListBulletFonts(doc, bulletSubLevelAbstracts);
      if (subRestored > 0) {
        this.log.debug(
          `Restored bullet font on ${subRestored} numbered-lead abstract(s) with bullet sub-levels (H1)`
        );
      }
    }

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

        // Skip row-number column lists — their formatting is already standardized
        if (this._rowNumberAbstractNumIds.has(abstractNum.getAbstractNumId())) continue;

        // Skip HLP table lists — their numbering structure must be preserved
        if (this._hlpAbstractNumIds.has(abstractNum.getAbstractNumId())) continue;

        // Skip mixed-list definitions — bullet-lead's decimal/letter/roman
        // cycle at levels 1+ must not be flattened to the user's flat
        // numbered-format config.
        if (this._mixedListAbstractNumIds.has(abstractNum.getAbstractNumId())) continue;

        // Update each level's format and indentation based on UI settings
        for (let levelIndex = 0; levelIndex < 9; levelIndex++) {
          const level = abstractNum.getLevel(levelIndex);
          if (!level || level.getFormat() === "bullet") continue;

          // Get the UI-configured settings for this level
          const configLevel = settings.indentationLevels[levelIndex];

          // A legal / hierarchical multi-level template (e.g. "%1.%2" -> 1.1,
          // "%1.%2.%3" -> 1.1.1) carries more than one "%n" placeholder.
          // Flattening it to the UI's flat single-token format ("%2.", "a.")
          // would destroy the hierarchical numbering, so leave such levels'
          // format and text template intact (indentation below is still
          // applied). (audit M7)
          const lvlText = level.getProperties().text ?? "";
          const isMultiTokenTemplate = (lvlText.match(/%\d/g) ?? []).length >= 2;

          // Apply format conversion if configured (skip multi-token legal levels)
          if (configLevel?.numberedFormat && !isMultiTokenTemplate) {
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
            const extraTwips = this.getExtraHangingTwips();
            const textTwips = Math.round(configLevel.textIndent * 1440) + extraTwips;
            const hangingTwips = textTwips - symbolTwips;
            level.setLeftIndent(textTwips); // Text starts at textIndent
            level.setHangingIndent(hangingTwips); // Number hangs back by (textIndent - symbolIndent)
            this.log.debug(
              `  Set numbered level ${levelIndex} indentation: textIndent=${textTwips}twips, hanging=${hangingTwips}twips (number at ${symbolTwips}twips)`
            );
          }
        }

        // Re-register with the manager to mark as modified —
        // level setters (setLeftIndent, setHangingIndent, etc.) don't notify the NumberingManager
        manager.addAbstractNumbering(abstractNum);
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
   * Detect and standardize typed-number row-number columns in tables.
   *
   * A typed-number column is a table column where each cell contains a single
   * paragraph with typed digit text ("1", "2", "3") without Word numbering.
   *
   * Applies full formatting:
   * - Paragraph: center-aligned, zero indent, Normal spacing
   * - Runs: Normal font/size, bold, #000000, no underline
   *
   * Empty cells (no text, no numbering) are excluded from the detection threshold.
   */
  private standardizeRowNumberColumns(
    doc: Document,
    normalStyle: {
      fontFamily: string;
      fontSize: number;
      spaceBefore: number;
      spaceAfter: number;
    }
  ): number {
    const tables = doc.getAllTables();
    let columnsFixed = 0;

    for (const table of tables) {
      if (table.isFloating()) continue;
      if (tableProcessor.isHLPTable(table)) continue;

      const rows = table.getRows();
      if (rows.length < 2) continue;

      const firstRowCells = rows[0].getCells();
      const colCount = firstRowCells.length;

      for (let col = 0; col < colCount; col++) {
        let totalCells = 0;
        let typedNumberCount = 0;
        const typedNumberParas: Paragraph[] = [];

        for (const row of rows) {
          const cells = row.getCells();
          if (col >= cells.length) continue;

          const cell = cells[col];
          const paragraphs = cell.getParagraphs();

          if (paragraphs.length === 1) {
            const para = paragraphs[0];
            const numbering = para.getNumbering();
            const text = para.getText().trim();

            // Skip completely empty cells (no text, no numbering) — these are
            // trailing empty rows that shouldn't count toward the detection threshold
            if (text === "" && !numbering) {
              continue;
            }

            totalCells++;

            // Typed number text (just digits with optional period, no numbering)
            if (!numbering && /^\d+\.?$/.test(text)) {
              typedNumberCount++;
              typedNumberParas.push(para);
            }
          } else {
            // Multi-paragraph cells still count toward total
            totalCells++;
          }
        }

        this.log.debug(
          `Typed-number detection col ${col}: typed=${typedNumberCount}, total=${totalCells}`
        );

        // Typed-number column: at least 2 matches and all (or all-but-one) cells match
        if (typedNumberCount >= 2 && typedNumberCount >= totalCells - 1) {
          for (const para of typedNumberParas) {
            para.setAlignment("center");
            para.setLeftIndent(0);
            para.setFirstLineIndent(0);
            para.setSpaceBefore(pointsToTwips(normalStyle.spaceBefore));
            para.setSpaceAfter(pointsToTwips(normalStyle.spaceAfter));

            // Format runs
            for (const run of getBodyRuns(para)) {
              run.setFont(normalStyle.fontFamily);
              run.setSize(normalStyle.fontSize);
              run.setColor("000000");
              run.setBold(true);
              run.setUnderline(false);
            }
          }

          columnsFixed++;
          this.log.debug(
            `Standardized typed-number column ${col} in table (${typedNumberCount}/${totalCells} cells)`
          );
        }
      }
    }

    return columnsFixed;
  }

  /**
   * Detect and format numbered-list "Step" columns in tables.
   *
   * A Step column is a table column where each cell contains a single
   * Word numbered list paragraph with no text content (just the list number).
   *
   * Applies full formatting:
   * - Numbering level: decimal, %1 (no period), zero indent, bold, Normal font/size, #000000
   * - Paragraph: center-aligned, zero indent, Normal spacing
   * - Runs: Normal font/size, bold, #000000, no underline
   * - Empty ListParagraph paragraphs converted to Normal (no phantom numbering)
   *
   * Populates _rowNumberAbstractNumIds to protect from downstream overrides.
   */
  private formatStepNumberColumns(
    doc: Document,
    normalStyle: {
      fontFamily: string;
      fontSize: number;
      spaceBefore: number;
      spaceAfter: number;
    }
  ): number {
    const tables = doc.getAllTables();
    let columnsFormatted = 0;
    const manager = doc.getNumberingManager();

    for (const table of tables) {
      if (table.isFloating()) continue;
      if (tableProcessor.isHLPTable(table)) continue;

      const rows = table.getRows();
      if (rows.length < 2) continue;

      const firstRowCells = rows[0].getCells();
      const colCount = firstRowCells.length;

      for (let col = 0; col < colCount; col++) {
        let matchCount = 0;
        let totalCells = 0;
        const matchingParas: Paragraph[] = [];
        const matchingNumIds = new Set<number>();

        for (const row of rows) {
          const cells = row.getCells();
          if (col >= cells.length) continue;

          const cell = cells[col];
          const paragraphs = cell.getParagraphs();

          if (paragraphs.length === 1) {
            const para = paragraphs[0];
            const numbering = para.getNumbering();
            const text = para.getText().trim();

            // Empty cell with no numbering — skip entirely
            if (text === "" && !numbering) {
              // Check if it's a ListParagraph with no explicit numbering:
              // convert to Normal to prevent style-inherited phantom numbering
              const style = para.getStyle() || "";
              if (style === "ListParagraph" || style === "List Paragraph") {
                para.setStyle("Normal");
                this.log.debug(
                  `Converted empty ListParagraph to Normal in col ${col} to prevent phantom numbering`
                );
              }
              continue;
            }

            totalCells++;

            // Word numbered list paragraph with no text content (just the list number)
            if (
              numbering &&
              numbering.numId !== undefined &&
              numbering.numId !== 0 &&
              text === ""
            ) {
              if (this.isNumberedList(doc, numbering.numId)) {
                matchCount++;
                matchingParas.push(para);
                matchingNumIds.add(numbering.numId);
              }
            }
          } else {
            totalCells++;
          }
        }

        // Detection threshold: at least 2 matches and all (or all-but-one) cells match
        if (matchCount >= 2 && matchCount >= totalCells - 1) {
          // Create ONE shared numId for all step column cells so they count sequentially (1, 2, 3...)
          // Without this, each cell has its own restarted numId and all show "1"
          // Use restartNumbering() to add startOverride=1 — this ensures the list restarts
          // at 1 even if consolidateNumbering() merges the abstractNum with another table's.
          let sharedNumId = manager.createNumberedList();
          sharedNumId = manager.restartNumbering(sharedNumId);
          const sharedInstance = manager.getInstance(sharedNumId);
          if (sharedInstance) {
            const sharedAbstractNumId = sharedInstance.getAbstractNumId();
            const sharedAbstractNum = manager.getAbstractNumbering(sharedAbstractNumId);
            if (sharedAbstractNum) {
              const existingLevel = sharedAbstractNum.getLevel(0);
              if (existingLevel) {
                sharedAbstractNum.removeLevel(0);
              }
              sharedAbstractNum.addLevel(
                NumberingLevel.create({
                  level: 0,
                  format: "decimal",
                  text: "%1",
                  alignment: "center",
                  leftIndent: 0,
                  hangingIndent: 0,
                  suffix: "nothing",
                  font: normalStyle.fontFamily,
                  fontSize: normalStyle.fontSize * 2, // half-points
                  bold: true,
                  color: "000000",
                })
              );

              // Re-register with the manager to mark as modified
              manager.addAbstractNumbering(sharedAbstractNum);

              // Track for protection against downstream overrides
              this._rowNumberAbstractNumIds.add(sharedAbstractNumId);
            }
          }

          // Format each matched paragraph and assign the SHARED numId
          for (const para of matchingParas) {
            para.setNumbering(sharedNumId, 0);
            para.setAlignment("center");
            para.setSpaceBefore(pointsToTwips(normalStyle.spaceBefore));
            para.setSpaceAfter(pointsToTwips(normalStyle.spaceAfter));
            // Set indentation
            para.setLeftIndent(0);
            para.setFirstLineIndent(0);
            para.setHangingIndent(0);

            // Format runs if any exist
            for (const run of getBodyRuns(para)) {
              run.setFont(normalStyle.fontFamily);
              run.setSize(normalStyle.fontSize);
              run.setColor("000000");
              run.setBold(true);
              run.setUnderline(false);
            }
          }

          columnsFormatted++;
          this.log.debug(
            `Formatted step-number column ${col} in table (Word numbering, ${matchCount}/${totalCells} cells)`
          );
        }
      }
    }

    return columnsFormatted;
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
      // Skip HLP tables — their content has dedicated processing
      if (tableProcessor.isHLPTable(table)) continue;

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
            for (const pattern of EXTENDED_TYPED_PREFIX_PATTERNS) {
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
                  // Strip ONLY the prefix from the leading run(s). para.setText()
                  // would overwrite the paragraph's whole content array, dropping
                  // any hyperlinks, images, or inline-formatted runs in the cell
                  // body. stripTypedPrefix edits only Run text and leaves other
                  // content intact.
                  stripTypedPrefix(para, match[0]);

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
   * Convert typed list prefixes to proper Word numbering with context awareness.
   *
   * Unlike preProcessExtendedTypedPrefixes (table cells only) and
   * doc.normalizeTableLists() (table cells only), this method processes
   * BOTH body paragraphs AND table cell paragraphs.
   *
   * Context rules:
   * - After bullet list item: typed prefix becomes bullet at (parentLevel + 1)
   * - After numbered list item: typed prefix becomes numbered at (parentLevel + 1)
   * - After heading/normal text/no context: typed prefix stays as native type at level 0
   *
   * @param doc - The document to process
   * @param settings - Optional indentation settings from Styles UI
   * @returns Number of typed prefixes converted
   */
  private convertTypedPrefixesWithContext(
    doc: Document,
    settings?: {
      indentationLevels?: Array<{
        level: number;
        symbolIndent: number;
        textIndent: number;
        bulletChar?: string;
        numberedFormat?: string;
      }>;
    }
  ): number {
    const manager = doc.getNumberingManager();
    let converted = 0;
    const MAX_GAP = 5;

    this.log.debug("=== CONVERTING TYPED PREFIXES WITH CONTEXT AWARENESS ===");

    // Helper: apply user's indentation settings to a new abstractNum
    const applyIndentation = (numId: number) => {
      if (!settings?.indentationLevels?.length) return;
      const instance = manager.getInstance(numId);
      if (!instance) return;
      const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
      if (!abstractNum) return;
      for (const levelConfig of settings.indentationLevels) {
        const level = abstractNum.getLevel(levelConfig.level);
        if (level) {
          // Only apply wider hanging indent to numbered lists, not bullets
          const isBullet = level.getFormat() === "bullet";
          const extraTwips = isBullet ? 0 : this.getExtraHangingTwips();
          const textTwips = inchesToTwips(levelConfig.textIndent) + extraTwips;
          const symbolTwips = inchesToTwips(levelConfig.symbolIndent);
          level.setLeftIndent(textTwips);
          level.setHangingIndent(textTwips - symbolTwips);
        }
      }
    };

    // Process a sequence of paragraphs (used for both body and cell scopes)
    const processSequence = (paragraphs: Paragraph[]): number => {
      // linesSinceLastListItem counts BOTH blanks and non-list text paragraphs since
      // the last list item, used to gate cross-category subordination at ≤ 2 lines.
      // Distinct from gapSinceLastList (text only, MAX_GAP=5) which gates same-category
      // continuation. Reset on every list item or heading.
      const SUBORDINATION_MAX_LINES = 2;

      // ---- PRE-PASS: detect contiguous list groups and which ones are mixed ----
      // A mixed group contains items of BOTH categories within
      // SUBORDINATION_MAX_LINES of each other. Items in a mixed group all
      // share ONE multi-level "mixed list" numId (lead at level 0, the other
      // category subordinated to level 1). This matches the cell-path behavior
      // implemented in ListNormalizer.
      type GroupRecord = {
        lead: "numbered" | "bullet";
        isMixed: boolean;
        switchLevel: number | null;
      };
      type GroupInfo = {
        groupId: number;
        lead: "numbered" | "bullet";
        isMixed: boolean;
        switchLevel: number | null;
      };
      const groupRecords: GroupRecord[] = [];
      const groupInfoByPara = new Map<Paragraph, GroupInfo>();
      // Per-group source levels per category, used to compute switchLevel —
      // the first cross-category source level not occupied by the lead category.
      // Any group with both bullet and numbered items is "mixed."
      const groupCategories = new Map<number, Set<"bullet" | "numbered">>();
      const bulletLevelsByGroup = new Map<number, Set<number>>();
      const numberedLevelsByGroup = new Map<number, Set<number>>();
      {
        let currentGroupId = -1;
        let preLinesSinceLastListItem = 0;
        for (const para of paragraphs) {
          const style = para.getStyle?.();
          if (style && /^Heading\s?\d/i.test(style)) {
            currentGroupId = -1;
            preLinesSinceLastListItem = 0;
            continue;
          }
          let category: "numbered" | "bullet" | null = null;
          let level = 0;
          const num = para.getNumbering();
          if (num && num.numId !== undefined && num.numId !== 0) {
            level = num.level ?? 0;
            // Use the paragraph's SPECIFIC level format, not the abstract's
            // level-0 format. Word docs can encode bullets + numbers into a
            // single multi-level abstract (e.g. List.docx has numId=2 with
            // bullets at 0/1, decimal at 2, bullets at 3+). Checking only
            // level 0 mis-classifies every paragraph using that abstract.
            category = this.isBulletListAtLevel(doc, num.numId, level)
              ? "bullet"
              : "numbered";
          } else {
            const text = para.getText();
            if (text && text.trim().length > 0) {
              const det = detectTypedPrefix(text);
              if (det.prefix) {
                category = det.category === "bullet" ? "bullet" : "numbered";
                // Typed prefixes default to level 0.
              }
            }
          }
          if (category) {
            if (currentGroupId === -1) {
              currentGroupId = groupRecords.length;
              groupRecords.push({
                lead: category,
                isMixed: false,
                switchLevel: null,
              });
            } else if (
              category !== groupRecords[currentGroupId]!.lead &&
              preLinesSinceLastListItem > SUBORDINATION_MAX_LINES
            ) {
              currentGroupId = groupRecords.length;
              groupRecords.push({
                lead: category,
                isMixed: false,
                switchLevel: null,
              });
            }
            let cats = groupCategories.get(currentGroupId);
            if (!cats) {
              cats = new Set();
              groupCategories.set(currentGroupId, cats);
            }
            cats.add(category);
            if (category === "numbered") {
              let lvls = numberedLevelsByGroup.get(currentGroupId);
              if (!lvls) {
                lvls = new Set();
                numberedLevelsByGroup.set(currentGroupId, lvls);
              }
              lvls.add(level);
            } else {
              let lvls = bulletLevelsByGroup.get(currentGroupId);
              if (!lvls) {
                lvls = new Set();
                bulletLevelsByGroup.set(currentGroupId, lvls);
              }
              lvls.add(level);
            }
            groupInfoByPara.set(para, {
              groupId: currentGroupId,
              lead: groupRecords[currentGroupId]!.lead,
              isMixed: false,
              switchLevel: null,
            });
            preLinesSinceLastListItem = 0;
          } else {
            preLinesSinceLastListItem++;
          }
        }
        // Finalize per-group state.
        // switchLevel = source ilvl where the dynamic pattern transitions
        // from lead-mode to cross-mode. It's the shallowest cross-category
        // source level that's not occupied by the lead category (a same-
        // level conflict bumps the switch one level deeper). Bidirectional:
        // works whether the lead is bullet or numbered.
        for (let gid = 0; gid < groupRecords.length; gid++) {
          const cats = groupCategories.get(gid) ?? new Set();
          const rec = groupRecords[gid]!;
          rec.isMixed = cats.size > 1;
          if (!rec.isMixed) {
            rec.switchLevel = null;
            continue;
          }
          const bulletLevels = bulletLevelsByGroup.get(gid) ?? new Set<number>();
          const numberedLevels = numberedLevelsByGroup.get(gid) ?? new Set<number>();
          let candidate: number;
          let leadLevels: Set<number>;
          if (rec.lead === "numbered") {
            candidate = bulletLevels.size > 0 ? Math.min(...bulletLevels) : 1;
            leadLevels = numberedLevels;
          } else {
            candidate = numberedLevels.size > 0 ? Math.min(...numberedLevels) : 1;
            leadLevels = bulletLevels;
          }
          candidate = Math.max(1, candidate);
          while (leadLevels.has(candidate) && candidate < 8) candidate++;
          rec.switchLevel = candidate;
        }
        for (const info of groupInfoByPara.values()) {
          const rec = groupRecords[info.groupId]!;
          info.isMixed = rec.isMixed;
          info.switchLevel = rec.switchLevel;
        }
      }

      // Lazy cache of mixed-list numIds, one per mixed group.
      const mixedNumIdByGroupId = new Map<number, number>();
      const getMixedNumIdForGroup = (
        groupId: number,
        lead: "numbered" | "bullet",
        switchLevel: number | null
      ): number => {
        let id = mixedNumIdByGroupId.get(groupId);
        if (id === undefined) {
          id = createMixedListNumId(
            manager,
            lead,
            switchLevel,
            settings?.indentationLevels as Parameters<typeof createMixedListNumId>[3],
            this.getExtraHangingTwips()
          );
          // Record the abstractNumId so applyBulletUniformity /
          // applyNumberedUniformity skip it. Without this guard, those passes
          // overwrite the mixed pattern's level-by-level format/text/font with
          // the user's flat UI config — turning level-1 filled bullets into
          // open circles, etc.
          const inst = manager.getInstance(id);
          if (inst) this._mixedListAbstractNumIds.add(inst.getAbstractNumId());
          mixedNumIdByGroupId.set(groupId, id);
        }
        return id;
      };

      let localConverted = 0;
      let lastListContext: { isBullet: boolean; level: number; numId: number } | null = null;
      // parentListContext tracks the original Word list item that triggers sub-item conversion.
      // Unlike lastListContext (which updates to each converted item), parentListContext stays
      // fixed so all sibling typed prefixes get the SAME level (parentLevel + 1).
      // indentTwips tracks the parent's indentation so typed prefixes can compare their own
      // indent to decide whether they're genuinely deeper or at the same level.
      let parentListContext: {
        isBullet: boolean;
        level: number;
        numId: number;
        indentTwips: number;
      } | null = null;
      let gapSinceLastList = 0;
      let linesSinceLastListItem = 0;
      // Sequence tracking: reuse numId for consecutive typed-prefix conversions at same
      // type/level/subordination state. subordination state is part of the key because
      // subordinated numIds carry overridden level formatting (filled disc for bullets,
      // decimal for numbers) that must NOT be inherited by adjacent non-subordinated items.
      let seqNumId: number | null = null;
      let seqType: "bullet" | "numbered" | null = null;
      let seqLevel: number | null = null;
      let seqWasSubordinated: boolean | null = null;
      // Level-0 numbered continuation tracker. A typed decimal marker whose value
      // sequentially follows the previous level-0 numbered list (e.g. "3." after
      // "1.", "2.") CONTINUES that list rather than restarting at 1 — even across
      // an intervening prose paragraph. Scoped strictly to level-0, decimal,
      // non-subordinated items: the visible number is a reliable signal of the
      // author's intent (a "3." means continue, a "1." means a new list). Unlike
      // seqNumId, this survives prose gaps; it is reset only on a heading or a
      // real Word list item (hard context boundaries).
      let level0NumberedNumId: number | null = null;
      let level0NumberedLastValue: number | null = null;
      // Previous converted item's marker as a letter ordinal (a=1…z=26) when it
      // was a single letter, else null. Used to disambiguate a lone Roman-glyph
      // marker (i/v/x) from a genuine letter run (…h, i, j…). Reset wherever the
      // typed sequence resets.
      let prevSingleLetterValue: number | null = null;

      for (const para of paragraphs) {
        const paraGroupInfo = groupInfoByPara.get(para);
        // 1. Already has Word numbering? Either reassign (mixed group) or just
        // update context and continue.
        const numbering = para.getNumbering();
        if (numbering && numbering.numId !== undefined && numbering.numId !== 0) {
          // Per-level format check — must match the pre-pass categorization
          // logic above so cross-cat items get routed correctly.
          const currentIsBullet = this.isBulletListAtLevel(
            doc,
            numbering.numId,
            numbering.level ?? 0
          );
          let effectiveNumId = numbering.numId;
          let effectiveLevel = numbering.level ?? 0;

          if (paraGroupInfo && paraGroupInfo.isMixed) {
            // Reassign this Word list item to the group's shared mixed numId
            // using the bidirectional switchLevel pattern:
            //   • Lead-cat items: keep source ilvl (lead-mode covers
            //     levels 0..switchLevel-1, cross-mode covers switchLevel..8
            //     and renders deeper lead items in cross format — intended).
            //   • Cross-cat items: snap to max(switchLevel, sourceIlvl) so
            //     they land at the switch slot or deeper if the source had
            //     them nested further.
            const currentCategory = currentIsBullet ? "bullet" : "numbered";
            const sourceIlvl = numbering.level ?? 0;
            const S = paraGroupInfo.switchLevel ?? 8;
            const isLead = currentCategory === paraGroupInfo.lead;
            if (isLead) {
              effectiveLevel = Math.max(0, Math.min(sourceIlvl, 8));
            } else {
              effectiveLevel = Math.max(S, Math.min(sourceIlvl, 8));
            }
            effectiveNumId = getMixedNumIdForGroup(
              paraGroupInfo.groupId,
              paraGroupInfo.lead,
              paraGroupInfo.switchLevel
            );
            para.setNumbering(effectiveNumId, effectiveLevel);
            localConverted++;
            this.log.debug(
              `  Mixed-group reassign (existing Word list): "${para.getText().substring(0, 40)}..." -> ` +
                `${paraGroupInfo.lead}-lead mixed (S=${S}), level ${effectiveLevel} (numId=${effectiveNumId})`
            );
          }

          // Update context with the (possibly reassigned) numId/level.
          const paraIndent = getParagraphIndentation(para);
          const numDefIndent =
            paraIndent > 0
              ? paraIndent
              : (this.getListTextIndent(doc, effectiveNumId, effectiveLevel) ?? 0);
          const ctx = {
            isBullet: this.isBulletList(doc, effectiveNumId),
            level: effectiveLevel,
            numId: effectiveNumId,
            indentTwips: numDefIndent,
          };
          lastListContext = ctx;
          parentListContext = ctx;
          gapSinceLastList = 0;
          linesSinceLastListItem = 0;
          seqNumId = null;
          seqType = null;
          seqLevel = null;
          seqWasSubordinated = null;
          // A real Word list breaks the typed-decimal continuation chain.
          level0NumberedNumId = null;
          level0NumberedLastValue = null;
          prevSingleLetterValue = null;
          continue;
        }

        const text = para.getText();

        // 2. Empty/blank paragraph? Counts as a "line" for subordination proximity,
        // but does NOT increment gapSinceLastList or reset same-category context.
        if (!text || text.trim().length === 0) {
          linesSinceLastListItem++;
          continue;
        }

        // 3. Heading? Reset all context.
        const style = para.getStyle?.();
        if (style && /^Heading\s?\d/i.test(style)) {
          lastListContext = null;
          parentListContext = null;
          gapSinceLastList = 0;
          linesSinceLastListItem = 0;
          seqNumId = null;
          seqType = null;
          seqLevel = null;
          seqWasSubordinated = null;
          // A heading is a hard section boundary — a new numbered list after it
          // restarts even if its first marker happens to continue the sequence.
          level0NumberedNumId = null;
          level0NumberedLastValue = null;
          prevSingleLetterValue = null;
          continue;
        }

        // 4. Check for typed prefix
        const detection = detectTypedPrefix(text);
        if (!detection.prefix) {
          // Non-list, non-blank, non-heading paragraph: increment both counters
          gapSinceLastList++;
          linesSinceLastListItem++;
          if (gapSinceLastList > MAX_GAP) {
            lastListContext = null;
            parentListContext = null;
          }
          // Reset sequence tracking for typed-prefix reuse
          seqNumId = null;
          seqType = null;
          seqLevel = null;
          seqWasSubordinated = null;
          // Prose interrupts a letter run, so a following lone i/v/x is Roman.
          prevSingleLetterValue = null;
          continue;
        }

        // 5. Determine conversion target based on context
        // Use parentListContext (the original Word list item) for level calculation,
        // NOT lastListContext which may point to a previously converted sibling.
        // This ensures all siblings in a typed-prefix group get the SAME level.
        let targetType: "bullet" | "numbered";
        let targetLevel: number;
        // True when this item was bumped to a deeper level because its category
        // differs from the group's lead. Subordinated items render with the
        // lead's visual format (filled disc for bullets, decimal for numbers)
        // instead of Word's default level-1+ format.
        let wasSubordinated = false;

        if (parentListContext) {
          // After a list item: compare typed prefix indent vs parent indent
          const typedPrefixIndent = getParagraphIndentation(para);
          const INDENT_THRESHOLD = 200; // twips
          const typedIsBullet = detection.category === "bullet";
          const categoryDiffersFromParent = typedIsBullet !== parentListContext.isBullet;
          const withinSubordinationRange = linesSinceLastListItem <= SUBORDINATION_MAX_LINES;

          if (typedPrefixIndent > parentListContext.indentTwips + INDENT_THRESHOLD) {
            // Genuinely deeper indentation → sub-item, inheriting parent category
            targetType = parentListContext.isBullet ? "bullet" : "numbered";
            targetLevel = Math.min(parentListContext.level + 1, 8);
          } else if (categoryDiffersFromParent && withinSubordinationRange) {
            // Same/less indent, different category, AND within 2 lines of the last
            // list item → minority subordination. Keep the typed prefix's own
            // category but subordinate one level deeper so a bullet interrupting
            // a numbered list renders as a sub-bullet (and vice versa).
            targetType = typedIsBullet ? "bullet" : "numbered";
            targetLevel = Math.min(parentListContext.level + 1, 8);
            wasSubordinated = true;
          } else if (categoryDiffersFromParent) {
            // Cross-category but TOO FAR from the previous list item (> 2 lines).
            // Treat as a fresh list — drop the parent context and start over at
            // level 0. The "first typed prefix becomes lead" block below will
            // promote this item to the new group's lead.
            parentListContext = null;
            targetType = typedIsBullet ? "bullet" : "numbered";
            targetLevel = 0;
          } else {
            // Same category, no extra indent. Normally the same level as the
            // parent — but if the typed FORMAT implies a deeper tier than the
            // parent (e.g. a numbered parent "1." followed by FLUSH-LEFT letter
            // sub-items "a.", "b."), use the format as the nesting signal so the
            // sub-items become a real level+1 letter list instead of flattening
            // into the parent's decimal list and losing both the tier and the
            // a/b lettering (audit M2). Mirrors the cell-path format-vs-indent
            // reconciliation in ListNormalizer.
            targetType = typedIsBullet ? "bullet" : "numbered";
            const formatLevel = detection.format ? getLevelFromFormat(detection.format) : 0;
            if (!typedIsBullet && formatLevel > parentListContext.level) {
              targetLevel = Math.min(parentListContext.level + 1, 8);
            } else {
              targetLevel = parentListContext.level;
            }
          }
        } else {
          // No context: native type at level 0
          targetType = detection.category === "bullet" ? "bullet" : "numbered";
          targetLevel = 0;
        }

        // 6. Get or create numId.
        // If this typed prefix is in a mixed group, override to the shared
        // mixed-list numId and use level 0 (lead) or level 1 (subordinated).
        // Otherwise reuse a sequence numId for consecutive same-type/level
        // typed-prefix conversions.
        // Disambiguate a lone Roman-glyph marker (i/v/x) from a genuine letter
        // run using the previous single-letter marker (see disambiguateRomanMarker).
        const detectedFormat = disambiguateRomanMarker(
          detection.format,
          detection.prefix,
          prevSingleLetterValue
        ); // 'upperLetter' | 'lowerLetter' | 'lowerRoman' | 'decimal' | ...
        // Level-0 numbered continuation (H2/H3): only a non-subordinated, level-0,
        // decimal item participates — its visible marker value decides whether
        // this continues the previous level-0 numbered list or starts a new one.
        const isLevel0Decimal =
          targetType === "numbered" &&
          targetLevel === 0 &&
          !wasSubordinated &&
          detectedFormat === "decimal";
        const markerValue = isLevel0Decimal ? parseTypedMarkerValue(detection.prefix) : null;
        let numId: number;
        if (paraGroupInfo && paraGroupInfo.isMixed) {
          numId = getMixedNumIdForGroup(
            paraGroupInfo.groupId,
            paraGroupInfo.lead,
            paraGroupInfo.switchLevel
          );
          // Bidirectional dynamic-pattern routing. Lead-cat keeps inferred
          // source level; cross-cat snaps to max(switchLevel, sourceIlvl)
          // so it lands at the switch slot (or deeper if natively nested).
          // For typed prefixes, the previously-inferred targetLevel is the
          // source-equivalent.
          const S = paraGroupInfo.switchLevel ?? 8;
          const sourceIlvl = targetLevel;
          const isLead = targetType === paraGroupInfo.lead;
          if (isLead) {
            targetLevel = Math.max(0, Math.min(sourceIlvl, 8));
          } else {
            targetLevel = Math.max(S, Math.min(sourceIlvl, 8));
          }
          // Sequence reuse doesn't apply: each item routes directly to the
          // shared mixed numId. Reset seq tracking so a non-mixed group
          // immediately after gets a fresh sequence.
          seqNumId = null;
          seqType = null;
          seqLevel = null;
          seqWasSubordinated = null;
          // Mixed-group routing breaks the typed-decimal continuation chain.
          level0NumberedNumId = null;
          level0NumberedLastValue = null;
        } else if (
          isLevel0Decimal &&
          level0NumberedNumId !== null &&
          level0NumberedLastValue !== null &&
          markerValue !== null &&
          markerValue === level0NumberedLastValue + 1
        ) {
          // CONTINUATION: the marker sequentially follows the previous level-0
          // numbered list, so reuse its numId WITHOUT restarting — even across an
          // intervening prose paragraph (where seqNumId was cleared).
          numId = level0NumberedNumId;
          level0NumberedLastValue = markerValue;
          seqNumId = numId;
          seqType = targetType;
          seqLevel = targetLevel;
          seqWasSubordinated = wasSubordinated;
        } else if (
          !isLevel0Decimal &&
          seqType === targetType &&
          seqLevel === targetLevel &&
          seqWasSubordinated === wasSubordinated &&
          seqNumId !== null
        ) {
          // Level-0 decimal items never reach here: their continue-vs-new
          // decision is governed purely by the visible marker value (the
          // continuation branch above, or a fresh list below), so two adjacent
          // "1.,2." lists don't silently merge into "1..4". Other items (bullets,
          // letter/roman sub-items) still reuse the sequence numId for
          // consecutive conversions.
          numId = seqNumId;
        } else {
          if (targetType === "bullet") {
            numId = manager.createBulletList();
            // For subordinated bullets, override the level's character to
            // Word's native filled bullet (Symbol U+F0B7) so a bullet sub-item
            // of a numbered list renders identically to a top-level bullet
            // rather than Word's default level-1 open circle.
            if (wasSubordinated) {
              try {
                const instance = manager.getInstance(numId);
                if (instance) {
                  const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
                  if (abstractNum) {
                    const level = abstractNum.getLevel(targetLevel);
                    if (level) {
                      level.setFormat("bullet");
                      level.setText(WORD_NATIVE_BULLETS.FILLED_BULLET.char);
                      level.setFont(WORD_NATIVE_BULLETS.FILLED_BULLET.font);
                    }
                  }
                }
              } catch (fmtError) {
                this.log.warn(
                  `Failed to apply subordinated bullet format to numId ${numId}: ${fmtError}`
                );
              }
            }
          } else {
            numId = manager.createNumberedList();
            // Decide the format to write at targetLevel:
            // - Subordinated → force decimal (overrides any typed format) so a
            //   numbered sub-item of a bullet list renders as "1.", "2." rather
            //   than Word's default level-1 lowerLetter.
            // - Non-subordinated with non-decimal detected format → use the
            //   detected format so "A." creates an upperLetter list, etc.
            // - Non-subordinated decimal → no override; default decimal applies.
            const shouldOverrideFormat =
              wasSubordinated || (!!detectedFormat && detectedFormat !== "decimal");
            if (shouldOverrideFormat) {
              try {
                const instance = manager.getInstance(numId);
                if (instance) {
                  const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
                  if (abstractNum) {
                    const level = abstractNum.getLevel(targetLevel);
                    if (level) {
                      if (wasSubordinated) {
                        level.setFormat("decimal");
                        level.setText(`%${targetLevel + 1}.`);
                      } else {
                        const format = this.parseNumberedFormat(
                          detectedFormat === "upperLetter"
                            ? "A"
                            : detectedFormat === "lowerLetter"
                              ? "a"
                              : detectedFormat === "lowerRoman"
                                ? "i"
                                : detectedFormat === "upperRoman"
                                  ? "I"
                                  : "1"
                        );
                        level.setFormat(format);
                        // Set text template: %1. for level 0, %2. for level 1, etc.
                        const separator = detection.prefix?.includes(")") ? ")" : ".";
                        level.setText(`%${targetLevel + 1}${separator}`);
                      }
                    }
                  }
                }
              } catch (fmtError) {
                this.log.warn(
                  `Failed to apply format ${detectedFormat} to numId ${numId}: ${fmtError}`
                );
              }
            }
          }
          applyIndentation(numId);
          // Restart numbering so converted typed-prefix lists start at 1
          // instead of continuing from a previous sequence's counter
          if (targetType === "numbered") {
            numId = manager.restartNumbering(numId);
          }
          seqNumId = numId;
          seqType = targetType;
          seqLevel = targetLevel;
          seqWasSubordinated = wasSubordinated;
          // Record this fresh level-0 numbered list so a later sequential marker
          // (e.g. "3." after a prose gap) can continue it instead of restarting.
          if (isLevel0Decimal) {
            level0NumberedNumId = numId;
            level0NumberedLastValue = markerValue ?? 1;
          }
        }

        // 7. Strip prefix and apply numbering
        stripTypedPrefix(para, detection.prefix);
        para.setNumbering(numId, targetLevel);
        localConverted++;

        this.log.debug(
          `  Context-converted: "${text.substring(0, 40)}..." -> ` +
            `${targetType} level ${targetLevel} (numId=${numId})` +
            (parentListContext
              ? ` [parent: ${parentListContext.isBullet ? "bullet" : "numbered"} level ${parentListContext.level}]`
              : " [no prior context]")
        );

        // Update lastListContext to track the converted item for downstream uses.
        // parentListContext is normally NOT updated here — siblings in a typed-prefix
        // group must reference the same original parent to get the same level.
        // EXCEPTION: when no parent existed yet (first typed prefix of a group with
        // no prior Word list), promote this item to be the group's lead so that
        // subsequent items of a different category can be subordinated against it.
        lastListContext = {
          isBullet: targetType === "bullet",
          level: targetLevel,
          numId: numId,
        };
        if (parentListContext === null) {
          parentListContext = {
            isBullet: targetType === "bullet",
            level: targetLevel,
            numId: numId,
            indentTwips: getParagraphIndentation(para),
          };
        }
        gapSinceLastList = 0;
        linesSinceLastListItem = 0;
        // Track this item's marker for the next item's Roman/letter
        // disambiguation: a single-letter marker keeps a letter run alive
        // (so a following i/v/x continues it); anything else breaks it.
        if (detectedFormat === "lowerLetter") {
          const lm = detection.prefix?.match(/^\s*([a-z])[.)]/);
          prevSingleLetterValue = lm?.[1]
            ? lm[1].charCodeAt(0) - "a".charCodeAt(0) + 1
            : null;
        } else {
          prevSingleLetterValue = null;
        }
      }

      return localConverted;
    };

    // ---- Scope 1: Body paragraphs ----
    this.log.debug("  Processing body paragraphs...");
    let bodyParagraphs: Paragraph[] = [];
    const bodyElements = doc.getBodyElements();
    for (const element of bodyElements) {
      if (element instanceof Paragraph) {
        bodyParagraphs.push(element);
      } else if (element instanceof Table) {
        // Process accumulated body paragraphs, then reset
        if (bodyParagraphs.length > 0) {
          converted += processSequence(bodyParagraphs);
          bodyParagraphs = [];
        }
        // Table breaks body-paragraph list context
        // (Table cells are processed separately in Scope 2)
      }
      // Other element types (SDT, TOC, etc.) also break the sequence
      else if (!(element instanceof Paragraph)) {
        if (bodyParagraphs.length > 0) {
          converted += processSequence(bodyParagraphs);
          bodyParagraphs = [];
        }
      }
    }
    // Process any remaining body paragraphs after the last table
    if (bodyParagraphs.length > 0) {
      converted += processSequence(bodyParagraphs);
    }

    // ---- Scope 2: Table cell paragraphs ----
    this.log.debug("  Processing table cell paragraphs...");
    for (const table of doc.getAllTables()) {
      // Skip HLP tables - their formatting is handled by processHLPTables
      if (tableProcessor.isHLPTable(table)) continue;
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          const cellParagraphs = cell.getParagraphs();
          converted += processSequence(cellParagraphs);
        }
      }
    }

    if (converted > 0) {
      this.log.info(`Context-aware typed prefix conversion: ${converted} paragraphs converted`);
    } else {
      this.log.debug("  No typed prefixes found for context-aware conversion");
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
        numberedFormat?: string;
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
      if (
        numbering &&
        numbering.numId !== undefined &&
        this.isHybridNumberedBulletList(doc, numbering.numId)
      ) {
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

      // Convert each bullet level (1-8) to the configured format from settings
      for (let levelIndex = 1; levelIndex < 9; levelIndex++) {
        const level = abstractNum.getLevel(levelIndex);
        if (level && level.getFormat() === "bullet") {
          // Use per-level format from settings, fall back to lowerLetter
          const levelConfig = settings.indentationLevels[levelIndex];
          const levelFormat = levelConfig?.numberedFormat
            ? this.parseNumberedFormat(levelConfig.numberedFormat)
            : "lowerLetter";
          level.setFormat(levelFormat);
          level.setText(`%${levelIndex + 1}.`);
          level.setFont("Verdana"); // Standard font for letters
          level.setFontSize(24); // 12pt = 24 half-points
          level.setColor("000000");

          // Apply UI-configured indentation if available
          // OOXML semantics: w:left = where TEXT starts, w:hanging = how far NUMBER hangs back
          if (levelConfig) {
            const symbolTwips = Math.round(levelConfig.symbolIndent * 1440);
            const textTwips = Math.round(levelConfig.textIndent * 1440);
            level.setLeftIndent(textTwips); // Text starts at textIndent
            level.setHangingIndent(textTwips - symbolTwips);
          }

          conversions++;
          this.log.debug(
            `  Converted level ${levelIndex} in numId ${numId}: bullet -> ${levelFormat}`
          );
        }
      }
    }

    return conversions;
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
    // Validate hex format to prevent malformed values from breaking regex interpolation
    const hexColorRegex = /^[0-9A-Fa-f]{6}$/;
    const rawHeader2 = options.tableShadingSettings?.header2Shading?.replace("#", "") || "BFBFBF";
    const rawOther = options.tableShadingSettings?.otherShading?.replace("#", "") || "DFDFDF";
    const header2Color = hexColorRegex.test(rawHeader2) ? rawHeader2 : "BFBFBF";
    const otherColor = hexColorRegex.test(rawOther) ? rawOther : "DFDFDF";

    // Get preserveBold from Normal style (table cells use Normal style formatting)
    // Use DIRECT formatting check only (not getEffectiveBold) to avoid table style inheritance issues
    const normalStyle = options.styles?.find((s: { id: string }) => s.id === "normal");
    const preserveBold = normalStyle?.preserveBold ?? true; // Default to preserve if not specified

    // Get Normal style font and alignment values for shaded cells and first row cells
    const normalFontFamily = normalStyle?.fontFamily ?? "Verdana";
    const normalFontSize = normalStyle?.fontSize ?? 12;
    const normalAlignment = normalStyle?.alignment ?? "center"; // Default center for table cells
    const preserveCenterAlignment = normalStyle?.preserveCenterAlignment ?? false;

    // Get Normal style spacing values for shaded cells and first row cells
    const normalSpaceBefore = normalStyle?.spaceBefore ?? 3; // Default 3pt
    const normalSpaceAfter = normalStyle?.spaceAfter ?? 3; // Default 3pt
    const normalLineSpacing = normalStyle?.lineSpacing ?? 1.0; // Default single spacing

    this.log.info(
      `[DEBUG] applyTableUniformity: preserveBold=${preserveBold} (normalStyle?.preserveBold=${normalStyle?.preserveBold})`
    );
    this.log.debug(
      `[DEBUG] options.styles: ${JSON.stringify(options.styles?.map((s) => ({ id: s.id, preserveBold: s.preserveBold })) || "undefined")}`
    );
    this.log.debug(
      `[DEBUG] Normal style spacing: before=${normalSpaceBefore}pt, after=${normalSpaceAfter}pt, line=${normalLineSpacing}`
    );

    // Get Heading 2 style configuration for 1x1 tables
    const heading2Style = options.styles?.find((s: { id: string }) => s.id === "header2");
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

    // Update table style definitions in styles.xml to match the user's configured shading.
    // Dynamically extracts ALL shading colors from table styles rather than using a hardcoded
    // list — any cell already shaded by a table style will get the user's configured color.
    //
    // IMPORTANT: doc.updateTableStyleShading() uses setStylesXml() which gets overwritten
    // during save by mergeStylesWithOriginal() (which starts from _originalStylesXml).
    // To persist changes, we apply replacements directly to _originalStylesXml so the
    // merge base already has the updated shading colors.
    const docAny = doc as any;
    const stylesXml: string = doc.getStylesXml();
    let styleUpdates = 0;

    if (stylesXml) {
      // Extract ALL unique shading fill colors from table-type styles
      const tableStyleShadingColors = new Set<string>();
      const tableStyleRegex = /<w:style[^>]*w:type=["']table["'][^>]*>[\s\S]*?<\/w:style>/gi;
      const fillRegex = /w:fill=["']([A-Fa-f0-9]{6})["']/g;

      // Colors to never replace (white, HLP-reserved)
      const preservedColors = new Set(["FFFFFF", "FFC000", "FFF2CC"]);

      let styleMatch;
      while ((styleMatch = tableStyleRegex.exec(stylesXml)) !== null) {
        let fillMatch;
        while ((fillMatch = fillRegex.exec(styleMatch[0])) !== null) {
          const color = fillMatch[1].toUpperCase();
          if (!preservedColors.has(color)) {
            tableStyleShadingColors.add(color);
          }
        }
        fillRegex.lastIndex = 0; // Reset for next table style
      }

      if (tableStyleShadingColors.size > 0) {
        this.log.debug(
          `Found ${tableStyleShadingColors.size} shading colors in table styles: ${[...tableStyleShadingColors].join(", ")}`
        );

        for (const oldColor of tableStyleShadingColors) {
          // Map to user's configured color — all non-white table style shading
          // becomes otherShading since header rows get direct shading anyway
          const newColor = otherColor.toUpperCase();
          if (oldColor === newColor) continue;

          styleUpdates += doc.updateTableStyleShading(oldColor, newColor);

          // Also apply to _originalStylesXml so changes survive mergeStylesWithOriginal()
          if (docAny._originalStylesXml) {
            const fillPattern = new RegExp(`(w:fill=["'])${oldColor}(["'])`, "gi");
            docAny._originalStylesXml = docAny._originalStylesXml.replace(
              fillPattern,
              `$1${newColor}$2`
            );

            // Strip theme fill attributes from <w:shd> elements that now have
            // the new fill color — Word prioritizes w:themeFill/w:themeFillShade
            // over w:fill, so leaving them causes the old theme-derived color
            // (e.g. E9E9E9) to render instead of the explicit fill (DFDFDF)
            const shdThemeRegex = new RegExp(
              `(<w:shd\\b)([^>]*w:fill=["']${newColor}["'][^>]*?)(/?>)`,
              "gi"
            );
            docAny._originalStylesXml = docAny._originalStylesXml.replace(
              shdThemeRegex,
              (_match: string, prefix: string, attrs: string, suffix: string) => {
                const cleaned = attrs
                  .replace(/\s*w:themeFill="[^"]*"/gi, "")
                  .replace(/\s*w:themeFillShade="[^"]*"/gi, "")
                  .replace(/\s*w:themeFillTint="[^"]*"/gi, "");
                return prefix + cleaned + suffix;
              }
            );
          }
        }
      }
    }

    if (styleUpdates > 0) {
      this.log.debug(`Updated ${styleUpdates} shading definitions in table styles`);
    }

    this.log.debug(`Applied table uniformity to ${result.tablesProcessed} tables`);
    this.log.debug(`Recolored ${result.cellsRecolored} cells`);

    return result;
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
   * Detect if a cell has visual shading from any source
   *
   * Checks direct cell-level shading (from w:tcPr) to determine if a cell appears shaded:
   * 1. Direct cell shading fill color (non-white, non-auto)
   * 2. Direct cell pattern shading (non-clear, non-nil patterns like pct50, solid, diagStripe)
   *
   * Does NOT check table style inheritance — that was intentionally removed to prevent
   * applySmartTableFormatting() from incorrectly formatting cells with conditional style shading.
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

    // 2. Check direct cell pattern shading (e.g., pct50, solid, diagStripe)
    // Uses docxmlater's proper API — only detects direct cell shading from w:tcPr,
    // NOT inherited table style conditionals (banded rows, firstCol, etc.)
    const pattern = formatting.shading?.pattern;
    if (pattern && pattern !== "clear" && pattern !== "nil") {
      return { hasShading: true, fill: directFill };
    }

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
    if (/^(\d+[.):]|\(\d+\)|[a-zA-Z][.):]|\([a-zA-Z]\)|[ivxIVX]+[.):])/.test(text))
      return true;
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
      const text = para.getText()?.trim() || "";

      // Method 1: Check Word list formatting via getNumbering()
      if (numbering && numbering.numId) {
        this.log.info(
          `  Para ${i}: FOUND LIST via getNumbering() numId=${numbering.numId}, text="${text.substring(0, 40)}..."`
        );
        return true;
      }

      // Method 2: Check Word list formatting via hasNumbering() (handles edge cases)
      if (typeof para.hasNumbering === "function" && para.hasNumbering()) {
        this.log.info(
          `  Para ${i}: FOUND LIST via hasNumbering(), text="${text.substring(0, 40)}..."`
        );
        return true;
      }

      // Method 3: Check for typed list prefixes (fallback)
      if (this.hasTypedListPrefix(text)) {
        this.log.info(
          `  Para ${i}: FOUND LIST via typed prefix, text="${text.substring(0, 40)}..."`
        );
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

    this.log.info(
      `[DEBUG] applySmartTableFormatting: preserveBold=${preserveBold} (normalStyle?.preserveBold=${normalStyle?.preserveBold})`
    );
    this.log.debug(
      `[DEBUG] options.styles: ${JSON.stringify(options.styles?.map((s) => ({ id: s.id, preserveBold: s.preserveBold })) || "undefined")}`
    );

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
        // Skip floating tables and tables containing nested tables
        if (tableProcessor.shouldSkipTable(table)) {
          this.log.debug(`Skipping floating/nested table in smart formatting`);
          continue;
        }

        // Skip HLP tables — handled by processHLPTables()
        if (tableProcessor.isHLPTable(table)) continue;

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
              singleCell.setShading({ fill: "auto", pattern: "clear", color: "auto" });

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
              singleCell.setShading({ fill: header2Color, pattern: "clear", color: "auto" });

              // Apply Heading 2 font/size and bold formatting
              for (const para of singleCell.getParagraphs()) {
                for (const run of getBodyRuns(para)) {
                  run.setFont(heading2FontFamily);
                  run.setSize(heading2FontSize);
                  if (!preserveBold) {
                    run.setBold(true);
                  }
                }
              }

              this.log.debug(
                `Applied Header 2 formatting (#${header2Color}, ${heading2FontFamily} ${heading2FontSize}pt) to 1x1 table`
              );
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
              const { hasShading, fill: originalColor } = this.getResolvedCellShading(
                cell,
                table,
                doc
              );

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
                cell.setShading({ fill: otherColor, pattern: "clear", color: "auto" });

                // Set all text in the header to bold (unless preserveBold is enabled)
                for (const para of cell.getParagraphs()) {
                  if (!preserveBold) {
                    for (const run of getBodyRuns(para)) {
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
                cell.setShading({ fill: otherColor, pattern: "clear", color: "auto" });

                // Set all text in shaded data cells to bold (unless preserveBold is enabled)
                for (const para of cell.getParagraphs()) {
                  if (!preserveBold) {
                    for (const run of getBodyRuns(para)) {
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
   *
   * Traverses paragraph content and modifies hyperlink-styled runs while
   * skipping runs inside w:del/w:moveFrom revisions — modifying those runs
   * corrupts the revision XML structure and causes deleted text to reappear.
   */
  private async standardizeHyperlinkColors(doc: Document): Promise<number> {
    this.log.debug("=== STANDARDIZING HYPERLINK COLORS ===");

    let updatedCount = 0;

    const setBlue = (run: Run) => {
      if (run.isHyperlinkStyled() && run.getColor() !== "0000FF") {
        run.setColor("0000FF");
        updatedCount++;
      }
    };

    for (const para of doc.getAllParagraphs()) {
      const content = para.getContent();
      for (const item of content) {
        if (item instanceof Run) {
          setBlue(item);
        } else if (item instanceof Hyperlink) {
          const run = item.getRun();
          if (run) setBlue(run);
        } else if (item instanceof Revision) {
          if (item.getType() === "delete" || item.getType() === "moveFrom") continue;
          const revContent = item.getContent();
          for (const revItem of revContent) {
            if (revItem instanceof Run) {
              setBlue(revItem);
            } else if (revItem instanceof Hyperlink) {
              const run = revItem.getRun();
              if (run) setBlue(run);
            }
          }
        }
      }
    }

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

    for (const { hyperlink, isComplexField, text: sanitizedLinkText } of hyperlinks) {
      // ComplexField hyperlinks don't have getAnchor() — skip for internal link repair
      if (isComplexField) continue;
      const anchor = (hyperlink as Hyperlink).getAnchor();
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
      const text = para.getText() || "";
      if (text) return text;

      // Fallback: extract text from runs inside revision elements (w:ins, w:del)
      // This handles paragraphs with unaccepted tracked changes where getText() returns empty
      if (para instanceof Paragraph) {
        const runs = getBodyRuns(para);
        return runs.map((r) => r.getText() || "").join("");
      }
      return "";
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
    para.setSpaceBefore(60); // 3pt = 60 twips
    para.setSpaceAfter(0); // 0pt
    para.setLineSpacing(240, "exact"); // 12pt exact

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

      // Check each content item for hyperlinks - handles 5 cases:
      // 1. Direct Hyperlink instances
      // 2. Hyperlinks inside Revision elements (w:ins, w:del)
      // 3. HYPERLINK field codes (ComplexField)
      // 4. Plain Run text (unassembled field runs or manually-formatted hyperlink text)
      // 5. PreservedElement (nested tracked changes wrapping hyperlink content)
      for (const item of content) {
        // Case 1: Direct Hyperlink instances
        if (item instanceof Hyperlink) {
          if (this.isTopOfDocumentHyperlink(item.getText())) {
            this.applyTopHyperlinkFormatting(item);
            foundTopHyperlink = true;
            this.log.debug("Applied formatting to direct Hyperlink");
          }
          // Case 1b: _top anchor hyperlink with WRONG text (e.g., "[Link]", "Link")
          // This happens when ComplexField HYPERLINK _top fields lose display text
          // during DocXMLater's save/regeneration cycle
          else if (item.getAnchor && item.getAnchor() === "_top") {
            const currentText = sanitizeHyperlinkText(item.getText()).trim();
            if (!currentText || currentText === "Link" || currentText === "[Link]") {
              this.log.info(
                `Fixing corrupted _top hyperlink text: "${currentText}" → "Top of the Document"`
              );
              item.setText("Top of the Document");
              this.applyTopHyperlinkFormatting(item);
              foundTopHyperlink = true;
            }
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
          // Fallback: check revision text for non-Hyperlink content (e.g., unassembled field runs)
          if (!foundTopHyperlink && this.isTopOfDocumentHyperlink(item.getText())) {
            foundTopHyperlink = true;
            this.log.debug("Found Top of Document text in Revision runs");
          }
        }
        // Case 3: HYPERLINK field codes (ComplexField)
        // ComplexField hyperlinks pointing to _top lose their display text during
        // DocXMLater's save/regeneration, resulting in "[Link]" or "Link" text.
        // Fix: replace the ComplexField with a proper inline hyperlink.
        else if (item instanceof ComplexField) {
          if (item.isHyperlinkField()) {
            const parsedHyperlink = item.getParsedHyperlink();
            const resultText = item.getResult() || "";

            // Check if this is a _top hyperlink (by anchor OR by text)
            const isTopByText = this.isTopOfDocumentHyperlink(resultText);
            const isTopByAnchor = parsedHyperlink?.anchor === "_top";

            if (isTopByText || isTopByAnchor) {
              // REPLACE the ComplexField with a proper inline hyperlink to prevent
              // text corruption during DocXMLater's document regeneration.
              const newHyperlink = Hyperlink.createInternal("_top", "Top of the Document", {
                font: "Verdana",
                size: 12,
                color: "0000FF",
                underline: "single",
              });
              para.replaceContent(item, [newHyperlink]);
              foundTopHyperlink = true;
              this.log.info("Replaced ComplexField _top hyperlink with inline hyperlink");
            }
          }
        }
        // Case 4: Plain Run text (unassembled complex field runs or manually-formatted text)
        // Matches the duplicate detection's Run check to ensure symmetric behavior
        else if (item instanceof Run) {
          if (this.isTopOfDocumentHyperlink(item.getText())) {
            foundTopHyperlink = true;
            this.log.debug("Found Top of Document text in plain Run");
          }
        }
        // Case 5: PreservedElement (nested tracked changes wrapping hyperlink content)
        // Raw XML from nested revisions (e.g., w:ins containing w:del) is opaque;
        // check the XML text for "Top of" to detect preserved hyperlinks
        else if (item instanceof PreservedElement) {
          const rawXml = item.getRawXml().toLowerCase();
          if (
            rawXml.includes("top of") &&
            (rawXml.includes("document") || rawXml.includes("_top"))
          ) {
            foundTopHyperlink = true;
            this.log.debug("Found Top of Document hyperlink in PreservedElement");
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
        para.setSpaceBefore(60); // 3pt = 60 twips
        para.setSpaceAfter(0); // 0pt
        para.setLineSpacing(240, "exact"); // 12pt exact

        fixedCount++;
        this.log.debug(
          "Cleared direct formatting, applied TopHyperlink style, and explicit formatting"
        );
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
    return (
      cleanText.includes("top of") &&
      (cleanText.includes("document") || cleanText === "top of the document")
    );
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
    hyperlink.setFormatting(
      {
        font: "Verdana",
        size: 12,
        color: "0000FF",
        underline: "single",
        bold: false,
        italic: false,
      },
      { replace: true }
    );

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
      this.log.debug(`Updated hyperlink anchor from "${currentAnchor || "none"}" to "_top"`);
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
      // Skip floating tables and tables containing nested tables
      if (tableProcessor.shouldSkipTable(table)) return;

      const rows = table.getRows();
      const is1x1Table = rows.length === 1 && rows[0]?.getCells().length === 1;

      // ALL 1x1 tables get a Top of Document hyperlink (these are section headers)
      if (is1x1Table) {
        tablesWithHeader2.push({ tableIndex, table, hasHeader2: true });
        return;
      }

      // For non-1x1 tables, check for Heading 2 style paragraphs
      let hasHeader2 = false;
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

    // Pre-scan: collect positions of ALL existing "Top of Document" links in the document.
    // This avoids the problem of content tables blocking the lookback scan.
    const existingTopLinkPositions = new Set<number>();
    bodyElements.forEach((element, idx) => {
      if (element instanceof Paragraph) {
        const content = element.getContent();
        const hasTopLink = content.some((item: any) => {
          if (item instanceof Hyperlink) {
            const text = sanitizeHyperlinkText(item.getText()).toLowerCase();
            if (text.includes("top of")) return true;
          }
          if (item instanceof ComplexField && item.isHyperlinkField()) {
            const text = (item.getResult() || "").toLowerCase();
            if (text.includes("top of")) return true;
          }
          if (item instanceof Run) {
            const runText = item.getText().toLowerCase();
            if (runText.includes("top of the document")) return true;
          }
          if (item instanceof PreservedElement) {
            const rawXml = item.getRawXml().toLowerCase();
            if (rawXml.includes("top of") && (rawXml.includes("document") || rawXml.includes("_top"))) return true;
          }
          if (item instanceof Revision) {
            const revText = item.getText().toLowerCase();
            if (revText.includes("top of")) return true;
          }
          return false;
        });
        if (hasTopLink) existingTopLinkPositions.add(idx);
      }
    });
    this.log.debug(`Pre-scan found ${existingTopLinkPositions.size} existing Top of Document links`);

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

        // Only skip insertion when an existing "Top of" link sits within 3 lines
        // immediately above this header table. A link used mid-section (further
        // than 3 lines above) no longer suppresses the above-table insert — that
        // case previously left header tables without a Top of Document link.
        let shouldInsert = true;

        // Find the previous header table's position — used as a hard floor so we
        // never treat a link belonging to the prior section as a duplicate.
        let prevHeaderTablePos = 0;
        if (i > 0) {
          const prevTable = tablesWithHeader2[i - 1].table;
          prevHeaderTablePos = tablePositions.get(prevTable) ?? 0;
        }

        // Check if any existing top link falls within the 3 lines above this table
        const lookbackStart = Math.max(prevHeaderTablePos + 1, tablePosition - 3);
        for (const linkPos of existingTopLinkPositions) {
          if (linkPos >= lookbackStart && linkPos < tablePosition) {
            this.log.debug(
              `Existing Top link at position ${linkPos} found within 3 lines above table (window ${lookbackStart}-${tablePosition}), skipping insert`
            );
            shouldInsert = false;
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

    // Deduplicate: keep exactly ONE TopHyperlink after the last 1x1 table
    // (for above the disclaimer). Remove any extras from fixExistingTopHyperlinks.
    if (tablesWithHeader2.length > 0) {
      const lastTable = tablesWithHeader2[tablesWithHeader2.length - 1].table;
      const freshBodyElements = doc.getBodyElements();
      let lastTableIdx = -1;
      for (let idx = freshBodyElements.length - 1; idx >= 0; idx--) {
        if (freshBodyElements[idx] === lastTable) { lastTableIdx = idx; break; }
      }
      if (lastTableIdx >= 0) {
        let foundFirst = false;
        for (let idx = lastTableIdx + 1; idx < freshBodyElements.length; idx++) {
          const el = freshBodyElements[idx];
          if (el instanceof Paragraph && el.getStyle() === "TopHyperlink") {
            if (!foundFirst) {
              foundFirst = true; // Keep the first one
            } else {
              doc.removeParagraph(el); // Remove duplicates
              this.log.debug("Removed duplicate Top link after last 1x1 table");
            }
          }
        }
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
    }>,
    author: string = "DocHub"
  ): Promise<number> {
    if (!customReplacements || customReplacements.length === 0) {
      this.log.debug("No custom replacements configured - skipping outdated title replacement");
      return 0;
    }

    let replacedCount = 0;
    const hyperlinks = await this.docXMLater.extractHyperlinks(doc);

    for (const { hyperlink, isComplexField, paragraph, text } of hyperlinks) {
      for (const rule of customReplacements) {
        // Only apply rules that target text or both
        if (rule.applyTo === "text" || rule.applyTo === "both") {
          const shouldApply = this.matchesPattern(text, rule.find, rule.matchType);

          if (shouldApply) {
            const newText = text.replace(rule.find, rule.replace);
            if (isComplexField) {
              this.setComplexFieldTextTracked(doc, hyperlink as ComplexField, newText, author);
            } else {
              this.setHyperlinkTextTracked(doc, hyperlink as Hyperlink, paragraph, newText, author);
            }
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
   * Apply the Heading 1 style to the first line of text in the document.
   *
   * Targets the first body-level paragraph containing non-whitespace text
   * (skipping leading blank paragraphs and any leading tables — note a document
   * that opens with a leading table promotes the first body paragraph after it).
   * Ensures a Heading 1 style definition exists, assigns it, and sets outline
   * level 0 so Word treats the line as a real heading. Run before style
   * application so the line then inherits the user's configured Heading 1
   * formatting, and before buildProperTOC — which rewrites the TOC field range to
   * `\o "2-N"` and is what actually excludes this Heading 1 from the TOC.
   *
   * @returns the styled heading text, or null when the body has no text line.
   */
  private applyHeading1ToFirstLine(doc: Document): string | null {
    // Ensure a Heading 1 style DEFINITION exists so the assignment is valid Word
    // XML even when custom-style application is skipped. hasStyle()/getStyle()
    // both return truthy for Word's latent built-in Heading1, so they can't tell
    // a serialized definition from a latent one — inspect the raw styles XML
    // instead. When nothing defines Heading1, add ONLY the built-in Heading1
    // definition via addStyle(). Do NOT use applyStyles({heading1:{}}) here: that
    // fans out over the whole body and re-stamps every Normal/ListParagraph run
    // WITHOUT preserve flags, permanently recoloring white (FFFFFF) fonts and
    // dropping centered alignment before the later preserving pass can protect
    // them. addStyle() only registers the definition; it touches no runs.
    const stylesXml = doc.getStylesXml();
    const heading1Defined = /w:styleId="Heading1"/.test(stylesXml);
    if (!heading1Defined) {
      try {
        doc.addStyle(Style.createHeadingStyle(1));
        this.log.debug("Materialized built-in Heading1 style definition for first-line application");
      } catch (error) {
        this.log.warn(
          `Could not ensure Heading1 style: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    for (const element of doc.getBodyElements()) {
      // Skip leading tables / non-paragraph elements.
      if (!(element instanceof Paragraph)) continue;

      // Skip leading blank paragraphs — target the first line that has text.
      const text = element.getText()?.trim() ?? "";
      if (text.length === 0) continue;

      element.setStyle("Heading1");
      element.setOutlineLevel(0);
      this.log.info(`Applied Heading 1 to first line of text: "${text.substring(0, 60)}"`);
      return text;
    }

    this.log.debug("applyHeading1ToFirstLine: no text paragraph found in document body");
    return null;
  }

  /**
   * Add or update document warning at the end of the document
   *
   * Warning format:
   * Line 1: "Not to Be Reproduced or Disclosed to Others Without Prior Written Approval" (normal weight)
   * Line 2: "ELECTRONIC DATA = OFFICIAL VERSION / PAPER COPY = INFORMATIONAL ONLY" (bold)
   *
   * Both lines: Centered, Verdana 8pt, 3pt spacing before/after
   *
   * Search is case-insensitive, but exact capitalization is preserved when creating.
   */
  private async addOrUpdateDocumentWarning(doc: Document): Promise<void> {
    // Exact capitalization as specified
    const warningLine1 =
      "Not to Be Reproduced or Disclosed to Others Without Prior Written Approval";
    const warningLine2 = "ELECTRONIC DATA = OFFICIAL VERSION / PAPER COPY = INFORMATIONAL ONLY";

    this.log.debug("Adding/updating document warning at end of document");

    // Step 1: Search ENTIRE document for existing disclaimers (case-insensitive)
    // Full document scan ensures we find disclaimers regardless of position,
    // even if they appear before "Related Documents" sections or other content
    const paragraphs = doc.getAllParagraphs();
    let existingWarningIndices: number[] = [];

    // Use precise matching for the two disclaimer lines
    const disclaimerLine1Pattern =
      "not to be reproduced or disclosed to others without prior written approval";
    const disclaimerLine2Pattern =
      "electronic data = official version / paper copy = informational only";

    // Also keep broader patterns for catching malformed/partial disclaimers
    const additionalPatterns = [
      "electronic data",
      "not to be reproduced",
      "paper copy = informational only",
      "prior written approval",
    ];

    for (let i = 0; i < paragraphs.length; i++) {
      const text = this.getParagraphText(paragraphs[i])
        .replace(/[\u00A0\u2002\u2003\u2009\u200B]/g, " ")
        .toLowerCase()
        .replace(/-/g, "/"); // Normalize dashes to slashes for matching both "-" and "/" variants

      // Check for exact disclaimer lines first
      const matchesLine1 = text.includes(disclaimerLine1Pattern);
      const matchesLine2 = text.includes(disclaimerLine2Pattern);
      // Also check broader patterns for partial matches
      const matchesAdditional = additionalPatterns.some((pattern) => text.includes(pattern));

      if (matchesLine1 || matchesLine2 || matchesAdditional) {
        existingWarningIndices.push(i);
        this.log.debug(
          `Found existing disclaimer paragraph at index ${i}: "${text.substring(0, 50)}..."`
        );
      }
    }

    this.log.debug(
      `Disclaimer detection: scanned ${paragraphs.length} paragraphs, found ${existingWarningIndices.length} match(es)`
    );

    // Step 2: Remove existing disclaimer paragraphs if found
    if (existingWarningIndices.length > 0) {
      this.log.debug(
        `Found ${existingWarningIndices.length} existing disclaimer paragraph(s) to remove`
      );
      // Remove in reverse order to maintain indices
      existingWarningIndices.sort((a, b) => b - a);
      for (const index of existingWarningIndices) {
        doc.removeParagraph(paragraphs[index]);
        this.log.debug(`Removed existing disclaimer paragraph at index ${index}`);
      }
    }

    // NOTE: Do NOT insert a "Top of Document" hyperlink here.
    // That is handled by updateTopOfDocumentHyperlinks() which runs separately
    // and has its own duplicate detection. Inserting here causes double links.

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

    // Format runs in first paragraph (use getBodyRuns to reach runs inside w:ins revision wrappers)
    const runs1 = getBodyRuns(para1);
    this.log.debug(`Warning line 1: ${runs1.length} runs to format`);
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

    // Format runs in second paragraph (bold) — use getBodyRuns for w:ins revision wrappers
    const runs2 = getBodyRuns(para2);
    this.log.debug(`Warning line 2: ${runs2.length} runs to format`);
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

    // Step 3a: Run rebuildTOCs() for its model-safe side effects ONLY — it
    // ensures the `_top` bookmark exists and unwraps stray table SDTs. Its
    // actual entry population writes to the raw zip XML, which save's
    // updateDocumentXml() then discards (it regenerates document.xml from the
    // in-memory bodyElements). We capture the result for level reporting but do
    // NOT rely on it for persistence.
    const results = doc.rebuildTOCs();
    this.log.debug(`✓ Step 3a: rebuildTOCs() returned ${results.length} TOC(s) (side effects only)`);

    // Step 3b: Populate the TOC IN THE MODEL so the entries survive save.
    // An SDT-wrapped TOC parses to a TableOfContentsElement whose toXML() emits
    // only a placeholder run — there is nowhere in that model to store entry
    // paragraphs. So we replace it with a field-based TOC built from real model
    // paragraphs (begin/instr/separate + TOC{n} hyperlink entries + end). These
    // persist through bodyElements regeneration AND keep Word's live, updatable
    // field (right-click → Update Field still works).
    const tocHeadings = collectTocHeadings(doc, excludeHeading1);
    const populateResult = populateTocInModel(doc, tocHeadings, {
      font: "Verdana",
      size: 12,
      color: "0000FF",
      underline: "single",
    });
    this.log.debug(
      `✓ Step 3b: populateTocInModel() inserted ${populateResult.entries} model entries ` +
        `at body index ${populateResult.insertIndex} (instruction: "${populateResult.instruction}")`
    );

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
    this.log.debug(
      `✓ Step 4: formatTOCStyles() formatted levels: [${formatResult.formatted.join(", ")}]`
    );

    // Step 5: Strip dotted leaders and page numbers from TOC entries.
    // rebuildTOCs() only regenerates clean hyperlink entries for SDT-wrapped
    // TOCs; a plain field-based TOC (no <w:sdt>) is left untouched, so its
    // entries keep their `<w:tab w:leader="dot"/>` stop, `<w:tab/>` run, and
    // PAGEREF page number. DocHub's intended TOC is clickable hyperlinks with
    // no page numbers, so clean every TOC{n} entry explicitly.
    const tocClean = cleanTocEntries(doc);
    this.log.debug(
      `✓ Step 5: cleanTocEntries() cleared leaders on ${tocClean.paragraphs} TOC paragraph(s), ` +
        `stripped page numbers from ${tocClean.runsCleaned} entry run(s)`
    );

    // Count + heading names come from the model-population result (the entries
    // that actually persist), not rebuildTOCs()'s discarded XML count.
    const totalCount = populateResult.entries;
    const headings = tocHeadings.map((h) => h.text);

    // Log rebuildTOCs()'s level breakdown for diagnostics only.
    for (const [instruction, counts] of results) {
      const entryCount = counts.reduce((sum, c) => sum + c, 0);
      this.log.debug(
        `rebuildTOCs scan "${instruction.substring(0, 30)}...": ${entryCount} headings`
      );
    }

    this.log.info(
      `✓ Built proper TOC with ${totalCount} model entries (field structure preserved, Update Field enabled)`
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
    // Use docxmlater's TOC API to modify the field instruction.
    // This modifies the in-memory model directly, keeping it in sync
    // with the save pipeline and avoiding corruption from direct ZIP
    // handler manipulation that gets overwritten by updateDocumentXml().
    const tocElements = doc.getTableOfContentsElements();

    if (tocElements.length === 0) {
      this.log.debug("No TOC elements found to modify");
      return;
    }

    let modified = false;

    for (const tocElement of tocElements) {
      const toc = tocElement.getTableOfContents();
      const originalInstruction = toc.getOriginalFieldInstruction();

      if (originalInstruction) {
        // Modify \o "1-N" to \o "2-N" in the preserved field instruction
        const updatedInstruction = originalInstruction
          .replace(/\\o\s*"1(-\d+)"/, '\\o "2$1"')
          .replace(/\\o\s*&quot;1(-\d+)&quot;/, "\\o &quot;2$1&quot;");

        if (updatedInstruction !== originalInstruction) {
          toc.setOriginalFieldInstruction(updatedInstruction);
          modified = true;
          this.log.debug("Modified TOC field instruction: changed 1-N to 2-N");
        }
      } else {
        // No original instruction - TOC was created programmatically.
        // The buildFieldInstruction() generates \o "1-N" from levels.
        // We need to set an explicit instruction with "2-N".
        const computedInstruction = toc.getFieldInstruction();
        const updatedInstruction = computedInstruction
          .replace(/\\o\s*"1(-\d+)"/, '\\o "2$1"')
          .replace(/\\o\s*&quot;1(-\d+)&quot;/, "\\o &quot;2$1&quot;");

        if (updatedInstruction !== computedInstruction) {
          toc.setOriginalFieldInstruction(updatedInstruction);
          modified = true;
          this.log.debug("Modified computed TOC field instruction: changed 1-N to 2-N");
        }
      }
    }

    if (modified) {
      this.log.info("Updated TOC field instruction to exclude Heading 1 (via model API)");
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
  private async manuallyPopulateTOC(
    doc: Document,
    precomputedLevels?: number[]
  ): Promise<{ count: number; headings: string[] }> {
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
      let firstHeading1Text = "";
      let firstHeading1BodyIndex = -1;
      const bodyElements = doc.getBodyElements();
      for (let i = 0; i < bodyElements.length; i++) {
        const element = bodyElements[i];
        if (element instanceof Paragraph) {
          const style = element.getStyle();
          if (style === "Heading1" || style === "Heading 1") {
            firstHeading1 = element;
            firstHeading1Text = element.getText().trim();
            firstHeading1BodyIndex = i;
            this.log.debug(
              `Protected Heading1 at index ${i}: "${firstHeading1Text.substring(0, 50)}..."`
            );
            break;
          }
        }
      }

      // FALLBACK: If no Heading 1 found, look for 18pt font paragraphs and convert ALL of them
      if (!firstHeading1) {
        this.log.debug("No Heading 1 found - searching for 18pt font paragraphs");
        const paragraphs18pt = this.find18ptParagraphs(doc);

        if (paragraphs18pt.length > 0) {
          // Apply Heading 1 style to ALL 18pt paragraphs
          for (const para of paragraphs18pt) {
            para.setStyle("Heading1");
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
          this.log.info("No Heading 1 or 18pt font found - TOC insertion will be skipped");
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
              if (instruction && instruction.trim().toUpperCase().startsWith("TOC")) {
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
            const hasHyperlink = content.some((item) => item instanceof Hyperlink);
            const text = element.getText().trim();
            const isEmpty = text === "";

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
        this.log.info(
          `Non-SDT TOC spans body elements ${nonSdtTocStartIndex} to ${nonSdtTocEndIndex}`
        );
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
          this.log.warn(
            `Adjusting non-SDT TOC removal to protect Heading1 at index ${firstHeading1BodyIndex}`
          );
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
          this.log.info(
            `Removed non-SDT TOC (${elementsToRemove} elements) starting at index ${effectiveStartIndex}`
          );
          tocRemoved = true;
        }
      }

      // No existing TOC found - insert after first Heading 1
      if (!tocRemoved) {
        if (firstHeading1BodyIndex >= 0) {
          // Insert after the first Heading 1
          insertPosition = firstHeading1BodyIndex + 1;
          this.log.info(
            `No existing TOC found - creating new TOC after first Heading 1 at position ${insertPosition}`
          );
        } else {
          // No Heading 1 found (and no 18pt font was converted) - SKIP TOC insertion
          this.log.warn("No Heading 1 or 18pt font found - skipping TOC creation");
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
      // Note: BlankLineManager runs BEFORE buildProperTOC(), so we must add the blank line here
      if (tocParagraphs.length > 0) {
        const blankPara = new Paragraph();
        doc.insertParagraphAt(insertPosition + tocParagraphs.length, blankPara);
        this.log.debug(
          `Added blank line after TOC at position ${insertPosition + tocParagraphs.length}`
        );
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
            if (style === "Heading1" || style === "Heading 1") {
              heading1Found = true;
              heading1NewIndex = i;
              break;
            }
          }
        }

        if (!heading1Found) {
          this.log.error(
            `CRITICAL: Heading1 was lost during TOC processing! Original: "${firstHeading1Text}"`
          );
          // Attempt recovery by re-inserting the Heading1 at position 0
          try {
            doc.insertParagraphAt(0, firstHeading1);
            this.log.warn(`Recovered Heading1 by re-inserting at position 0`);
          } catch (recoveryError) {
            this.log.error(
              `Failed to recover Heading1: ${recoveryError instanceof Error ? recoveryError.message : "Unknown error"}`
            );
          }
        } else if (heading1NewIndex !== 0) {
          this.log.warn(
            `Heading1 is at index ${heading1NewIndex} instead of 0 (this may be expected if document structure was modified)`
          );
        } else {
          this.log.debug(
            `Heading1 preserved at index 0: "${firstHeading1Text.substring(0, 30)}..."`
          );
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
        if (
          style &&
          (style === "Heading2" || style === "Heading 2" || style.includes("Heading2"))
        ) {
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
   * Get DocXMLater processor for advanced operations
   */
  getDocXMLaterProcessor(): DocXMLaterProcessor {
    return this.docXMLater;
  }
}

export default WordDocumentProcessor;
