/**
 * Hyperlink-specific type definitions
 * Implements the two-part OpenXML hyperlink reference system
 */

import type { XMLElement } from './document-processing';

// Hyperlink types
export type HyperlinkType = 'external' | 'internal' | 'bookmark' | 'email' | 'file';

// Hyperlink data structure
export interface HyperlinkData {
  id: string;
  relationshipId: string;
  type: HyperlinkType;
  target: string;
  displayText: string;
  tooltip?: string;
  created: Date;
  modified?: Date;
  isValid?: boolean;
  validationMessage?: string;
}

// Detailed hyperlink information for processing
export interface DetailedHyperlinkInfo {
  id: string;
  relationshipId: string;
  element: XMLElement;
  containingPart: string; // e.g., 'document.xml', 'header1.xml'
  url: string;
  displayText: string;
  tooltip?: string;
  type: HyperlinkType;
  isInternal: boolean;
  isValid: boolean;
  validationMessage?: string;
  context?: string; // Surrounding text for context
  paragraphIndex?: number;
  characterPosition?: number;
}

// Patterns for identifying special URLs
export interface URLPattern {
  name: string;
  pattern: RegExp;
  description: string;
  action?: 'append' | 'replace' | 'validate';
}

// Pre-defined patterns for theSource URLs
export const URL_PATTERNS: Readonly<{
  CONTENT_ID: URLPattern;
  DOCUMENT_ID: URLPattern;
  THE_SOURCE: URLPattern;
}> = {
  CONTENT_ID: {
    name: 'ContentId',
    pattern: /(TSRC|CMS)-([a-zA-Z0-9]+)-(\d{6})/i,
    description: 'Matches theSource Content IDs',
    action: 'append',
  },
  DOCUMENT_ID: {
    name: 'DocumentId',
    pattern: /docid=([a-zA-Z0-9-]+)(?:[^a-zA-Z0-9-]|$)/i,
    description: 'Matches theSource Document IDs',
    action: 'append',
  },
  THE_SOURCE: {
    name: 'TheSource',
    pattern: /thesource\.cvshealth\.com/i,
    description: 'Matches theSource domain URLs',
    action: 'validate',
  },
};

// Hyperlink processing options
export interface HyperlinkProcessingOptions {
  processExternalLinks?: boolean;
  processInternalLinks?: boolean;
  validateUrls?: boolean;
  updateDisplayText?: boolean;
  appendContentId?: boolean;
  contentIdToAppend?: string;
  removeOrphanedRelationships?: boolean;
  consolidateDuplicates?: boolean;
  preserveTooltips?: boolean;
  urlPattern?: string | RegExp;
  displayTextPattern?: string | RegExp;
  trackChanges?: boolean;  // Enable DocHub change tracking for Document Changes UI
  apiEndpoint?: string;
  operations?: {
    fixContentIds?: boolean;
    updateTitles?: boolean;
    replaceOutdatedTitles?: boolean; // Standalone title replacement (fallback when API unavailable)
    fixInternalHyperlinks?: boolean;
    updateTopHyperlinks?: boolean;
    /**
     * Populate/refresh the Table of Contents after save using docxmlater's
     * replaceTableOfContents() helper. When true, the TOC field code is
     * preserved but the entries themselves (hyperlinks) are generated so
     * recipients do not need to "Right-click to update field".
     */
    updateTocHyperlinks?: boolean;
    /**
     * Force remove Heading 1 from Table of Contents entries.
     * When true (default), excludes Heading 1 (document title) from TOC.
     * This ensures the document title doesn't appear as a TOC entry.
     */
    forceRemoveHeading1FromTOC?: boolean;
    /**
     * Alias for updateTocHyperlinks for clearer intent in higher-level
     * processing options (e.g., dochub-app). Either flag being true
     * should trigger TOC population logic.
     */
    populateToc?: boolean;
    standardizeHyperlinkColor?: boolean;
    validateHeader2Tables?: boolean; // NEW in 1.6.0: Validate Header 2 table formatting
    validateDocumentStyles?: boolean; // NEW in 1.6.0: Validate all document styles using applyStylesFromObjects()
    processHyperlinks?: boolean; // Enable hyperlink defragmentation using docxmlater v1.15.0+
  };
  textReplacements?: any[];
  styles?: any;
  header2Spacing?: {
    spaceBefore: number;
    spaceAfter: number;
  };
  customStyleSpacing?: {
    header1?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
    header2?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
    normal?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
  };
  // Snapshot capture for document comparison
  captureSnapshot?: boolean;
  sessionId?: string;
  documentId?: string;
}

// Hyperlink fixing options (advanced)
export interface HyperlinkFixingOptions extends HyperlinkProcessingOptions {
  createBackup?: boolean;
  updateTitles?: boolean;
  powerAutomateUrl?: string;
  apiTimeout?: number;
  retryOnFailure?: boolean;
  maxRetries?: number;
  customPatterns?: URLPattern[];
}

// Hyperlink modification result
export interface HyperlinkModificationResult {
  hyperlinkId: string;
  relationshipId: string;
  originalUrl: string;
  newUrl?: string;
  originalDisplayText: string;
  newDisplayText?: string;
  modificationType: 'url' | 'text' | 'both' | 'removed';
  success: boolean;
  error?: string;
}

// Hyperlink processing result
export interface HyperlinkProcessingResult {
  success: boolean;
  totalHyperlinks: number;
  processedHyperlinks: number;
  modifiedHyperlinks: number;
  skippedHyperlinks: number;
  updatedUrls?: number;
  updatedDisplayTexts?: number;
  appendedContentIds?: number;
  mergedHyperlinks?: number; // Count of defragmented hyperlinks (docxmlater v1.15.0+)
  errorCount: number;
  errorMessages: string[];
  processedLinks: HyperlinkSummary[];
  validationIssues?: HyperlinkValidationIssue[];
  backupPath?: string;
  duration?: number; // in milliseconds
}

// Hyperlink fixing result (advanced)
export interface HyperlinkFixingResult extends HyperlinkProcessingResult {
  updatedUrls: number;
  updatedDisplayTexts: number;
  appendedContentIds: number;
  validationIssues: HyperlinkValidationIssue[];
  apiResponses?: HyperlinkApiResponse[];
}

// Hyperlink summary for reporting
export interface HyperlinkSummary {
  id: string;
  url: string;
  displayText: string;
  type: HyperlinkType;
  location: string; // e.g., 'Main Document', 'Header', 'Footer'
  status: 'processed' | 'skipped' | 'error';
  modifications?: string[];
  before?: string;
  after?: string;
}

// Hyperlink validation
export interface HyperlinkValidationIssue {
  hyperlinkId: string;
  url: string;
  issueType: 'invalid_url' | 'broken_link' | 'missing_relationship' | 'duplicate' | 'orphaned';
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
  autoFixable: boolean;
}

// Hyperlink change tracking
export interface HyperlinkChange {
  hyperlinkId: string;
  relationshipId: string;
  timestamp: Date;
  changeType: HyperlinkChangeType;
  originalUrl?: string;
  newUrl?: string;
  originalDisplayText?: string;
  newDisplayText?: string;
  author?: string;
  reason?: string;
}

export enum HyperlinkChangeType {
  URL_UPDATED = 'url_updated',
  TEXT_UPDATED = 'text_updated',
  BOTH_UPDATED = 'both_updated',
  ADDED = 'added',
  REMOVED = 'removed',
  CONTENT_ID_APPENDED = 'content_id_appended',
}

// Hyperlink API integration
export interface HyperlinkApiSettings {
  apiUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  userAgent?: string;
}

export interface HyperlinkApiRequest {
  urls: string[];
  requestType?: 'validate' | 'update' | 'fetch_metadata';
  options?: Record<string, unknown>;
}

export interface HyperlinkApiResponse {
  success: boolean;
  timestamp: Date;
  body?: {
    results: HyperlinkApiResult[];
    errors?: string[];
  };
  error?: string;
  statusCode?: number;
}

export interface HyperlinkApiResult {
  url: string;
  documentId: string;
  contentId: string;
  title?: string;
  status: 'active' | 'deprecated' | 'expired' | 'moved' | 'not_found';
  suggestedUrl?: string;
  metadata?: Record<string, unknown>;
}

// Hyperlink replacement rules
export interface HyperlinkReplacementRule {
  id: string;
  enabled: boolean;
  pattern: string | RegExp;
  replacement: string;
  scope: 'url' | 'text' | 'both';
  caseSensitive?: boolean;
  wholeWord?: boolean;
  description?: string;
}

// Batch hyperlink operations
export interface HyperlinkBatchOperation {
  documentPath: string;
  operations: HyperlinkOperation[];
  options?: HyperlinkProcessingOptions;
}

export interface HyperlinkOperation {
  type: 'update' | 'validate' | 'remove' | 'append_content_id';
  target?: string | RegExp;
  value?: string;
  options?: Record<string, unknown>;
}

// Hyperlink search and replace
export interface HyperlinkSearchCriteria {
  urlPattern?: string | RegExp;
  displayTextPattern?: string | RegExp;
  type?: HyperlinkType;
  location?: 'document' | 'header' | 'footer' | 'all';
  isValid?: boolean;
  hasContentId?: boolean;
}

export interface HyperlinkReplaceOptions {
  searchCriteria: HyperlinkSearchCriteria;
  newUrl?: string;
  newDisplayText?: string;
  preserveOriginal?: boolean;
  createBackup?: boolean;
}

// Hyperlink statistics
export interface HyperlinkStatistics {
  total: number;
  byType: Record<HyperlinkType, number>;
  byLocation: {
    document: number;
    headers: number;
    footers: number;
  };
  valid: number;
  invalid: number;
  withContentId: number;
  withoutContentId: number;
  duplicates: number;
  orphaned: number;
}

// Batch processing types from Feature implementation
export interface BatchProcessingOptions extends HyperlinkProcessingOptions {
  maxConcurrency?: number;
  continueOnError?: boolean;
  progressCallback?: (progress: BatchProgress) => void;
  abortSignal?: AbortSignal;
}

export interface BatchProgress {
  completed: number;
  total: number;
  percentage: number;
  currentFile?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface BatchProcessingResult {
  results: Map<string, HyperlinkProcessingResult>;
  summary: {
    totalFiles: number;
    successfulFiles: number;
    failedFiles: number;
    totalHyperlinksProcessed: number;
    totalHyperlinksModified: number;
    processingTimeMs: number;
    errors: Array<{ file: string; error: string }>;
  };
}

export interface FileProcessingStatus {
  filePath: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: HyperlinkProcessingResult;
  error?: string;
  startTime?: number;
  endTime?: number;
}

// PowerAutomate specific types from Feature implementation
export interface PowerAutomateRequest {
  Lookup_ID: string[];
}

export interface PowerAutomateResponse {
  StatusCode: string;
  Headers: {
    'Content-Type': string;
  };
  Body: {
    Results: Array<{
      Document_ID: string;
      Content_ID: string;
      Title: string;
      Status: string;
    }>;
    Version?: string;
    Changes?: string;
  };
}

// IPC channel types for Electron integration
export interface IpcChannels {
  'hyperlink:process-document': {
    request: {
      filePath: string;
      options: HyperlinkProcessingOptions;
    };
    response: HyperlinkProcessingResult;
  };
  'hyperlink:batch-process': {
    request: {
      filePaths: string[];
      options: BatchProcessingOptions;
    };
    response: BatchProcessingResult;
  };
  'hyperlink:validate-api': {
    request: {
      apiUrl: string;
    };
    response: {
      isValid: boolean;
      message: string;
      responseTime?: number;
    };
  };
  'hyperlink:cancel-operation': {
    request: {
      operationId: string;
    };
    response: {
      success: boolean;
      message?: string;
    };
  };
  'hyperlink:get-progress': {
    request: {
      operationId: string;
    };
    response: BatchProgress;
  };
}

// Hyperlink export/import
export interface HyperlinkExport {
  version: string;
  exportDate: Date;
  documentPath: string;
  hyperlinks: ExportedHyperlink[];
  statistics: HyperlinkStatistics;
}

export interface ExportedHyperlink {
  id: string;
  url: string;
  displayText: string;
  type: HyperlinkType;
  location: string;
  context?: string;
  metadata?: Record<string, unknown>;
}

// Utility function type signatures
export interface HyperlinkUtilities {
  isValidUrl(url: string): boolean;
  extractDomain(url: string): string | null;
  normalizeUrl(url: string): string;
  isTheSourceUrl(url: string): boolean;
  needsContentId(url: string): boolean;
  extractContentId(url: string): string | null;
  extractDocumentId(url: string): string | null;
  buildTheSourceUrl(documentId: string, contentId?: string): string;
  compareUrls(url1: string, url2: string): boolean;
  generateRelationshipId(): string;
}
