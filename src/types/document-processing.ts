/**
 * Core type definitions for document processing
 * Following TypeScript 2025 best practices with strict type safety
 */

import JSZip from 'jszip';

// Template literal types for document parts
export type DocumentPart = `word/${
  | 'document.xml'
  | 'styles.xml'
  | 'numbering.xml'
  | 'settings.xml'
  | 'fontTable.xml'
  | 'header1.xml'
  | 'footer1.xml'
}`;

// Relationship types in OpenXML
export type RelationshipType =
  | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
  | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles'
  | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'
  | 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

// Document structure with readonly properties for immutability
export interface DocumentStructure {
  readonly parts: ReadonlyArray<string>;
  readonly relationships: ReadonlyArray<RelationshipInfo>;
  readonly hasStyles: boolean;
  readonly hasNumbering: boolean;
  readonly statistics: Readonly<DocumentStatistics>;
}

export interface DocumentStatistics {
  paragraphCount: number;
  tableCount: number;
  imageCount: number;
  hyperlinkCount: number;
  wordCount?: number;
  characterCount?: number;
}

export interface RelationshipInfo {
  readonly id: string;
  readonly type: RelationshipType;
  readonly target: string;
  readonly targetMode?: 'External' | 'Internal';
}

// Processing options with granular control
export interface DocumentProcessingOptions {
  createBackup?: boolean;
  validateBeforeProcessing?: boolean;
  preserveOriginalFormatting?: boolean;
  processInChunks?: boolean;
  chunkSize?: number;
  timeout?: number; // in milliseconds
  maxRetries?: number;
  retryDelay?: number; // in milliseconds
}

// Processing result with detailed feedback
export interface ProcessingResult {
  success: boolean;
  documentPath: string;
  backupPath?: string;
  startTime: Date;
  endTime: Date;
  duration: number; // in milliseconds
  statistics: ProcessingStatistics;
  errors: ProcessingError[];
  warnings: ProcessingWarning[];
}

export interface ProcessingStatistics {
  totalElements: number;
  processedElements: number;
  skippedElements: number;
  modifiedElements: number;
  hyperlinksProcessed?: number;
  stylesApplied?: number;
  replacementsMade?: number;
}

export interface ProcessingError {
  code: string;
  message: string;
  element?: string;
  location?: string;
  stack?: string;
  recoverable: boolean;
}

export interface ProcessingWarning {
  code: string;
  message: string;
  element?: string;
  location?: string;
  suggestion?: string;
}

// Document operation types
export type DocumentOperation =
  | HyperlinkOperation
  | StyleOperation
  | TextOperation
  | StructureOperation;

export interface BaseOperation {
  id: string;
  type: 'hyperlink' | 'style' | 'text' | 'structure';
  description: string;
  critical?: boolean; // If true, failure stops all processing
  priority?: number; // Higher priority operations execute first
}

export interface HyperlinkOperation extends BaseOperation {
  type: 'hyperlink';
  action: 'update' | 'validate' | 'remove' | 'append';
  targetPattern?: RegExp;
  replacement?: string;
  contentId?: string;
}

export interface StyleOperation extends BaseOperation {
  type: 'style';
  action: 'apply' | 'remove' | 'modify';
  styleName: string;
  properties?: Record<string, unknown>;
}

export interface TextOperation extends BaseOperation {
  type: 'text';
  action: 'replace' | 'remove' | 'format';
  pattern: string | RegExp;
  replacement?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface StructureOperation extends BaseOperation {
  type: 'structure';
  action: 'reorder' | 'indent' | 'align';
  target: 'lists' | 'tables' | 'paragraphs' | 'images';
  options?: Record<string, unknown>;
}

// Batch processing types
export interface BatchProcessingOptions extends DocumentProcessingOptions {
  concurrency?: number; // Number of documents to process in parallel
  continueOnError?: boolean;
  progressCallback?: (progress: BatchProgress) => void;
}

export interface BatchProgress {
  totalFiles: number;
  processedFiles: number;
  currentFile?: string;
  currentFileProgress?: number; // 0-100
  overallProgress: number; // 0-100
  errors: number;
  warnings: number;
  estimatedTimeRemaining?: number; // in milliseconds
}

export interface BatchResult {
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  results: ProcessingResult[];
  duration: number;
  errors: BatchError[];
}

export interface BatchError extends ProcessingError {
  filePath: string;
  fileIndex: number;
}

// Document metadata
export interface DocumentMetadata {
  title?: string;
  subject?: string;
  creator?: string;
  keywords?: string[];
  description?: string;
  lastModifiedBy?: string;
  revision?: string;
  created?: Date;
  modified?: Date;
  lastPrinted?: Date;
  category?: string;
  contentStatus?: string;
  language?: string;
}

// XML parsing types
export interface ParsedXML {
  root: XMLElement;
  namespaces: Record<string, string>;
  encoding?: string;
  version?: string;
}

export interface XMLElement {
  name: string;
  attributes: Record<string, string>;
  children: XMLElement[];
  text?: string;
  namespace?: string;
}

// Utility type for deep readonly
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object
    ? T[P] extends (...args: any[]) => any
      ? T[P]
      : DeepReadonly<T[P]>
    : T[P];
};

// Either pattern for error handling
export type Either<L, R> =
  | { ok: false; error: L }
  | { ok: true; value: R };

// Result type for operations that can fail
export type Result<T, E = Error> = Either<E, T>;

// Conditional type for operation results
export type OperationResult<T> = T extends { critical: true }
  ? { success: true; data: T } | { success: false; error: Error }
  : { success: boolean; data?: T; warning?: string };

// Document processing context
export interface ProcessingContext {
  document: JSZip;
  documentPath: string;
  backupPath?: string;
  operations: DocumentOperation[];
  options: DocumentProcessingOptions;
  statistics: ProcessingStatistics;
  errors: ProcessingError[];
  warnings: ProcessingWarning[];
  metadata?: DocumentMetadata;
  cache: Map<string, unknown>;
  startTime: Date;
}

// Stream processing types for large documents
export interface StreamOptions {
  chunkSize: number;
  encoding?: BufferEncoding;
  highWaterMark?: number;
}

export interface ProcessedChunk {
  index: number;
  content: string | Buffer;
  progress: number;
  bytesProcessed: number;
  totalBytes?: number;
}

// Change tracking types
export interface DocumentChange {
  id: string;
  timestamp: Date;
  type: 'addition' | 'deletion' | 'modification' | 'move';
  element: string;
  originalContent?: string;
  newContent?: string;
  originalPosition?: number;
  newPosition?: number;
  author?: string;
  description?: string;
}

export interface ChangeSet {
  documentId: string;
  documentPath: string;
  changes: DocumentChange[];
  summary: ChangeSummary;
}

export interface ChangeSummary {
  totalChanges: number;
  additions: number;
  deletions: number;
  modifications: number;
  moves: number;
  authors: string[];
  startTime: Date;
  endTime: Date;
}

// Validation types
export interface ValidationOptions {
  checkStructure?: boolean;
  checkRelationships?: boolean;
  checkStyles?: boolean;
  checkHyperlinks?: boolean;
  checkImages?: boolean;
  checkMetadata?: boolean;
  strictMode?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  suggestions: ValidationSuggestion[];
  score?: number; // 0-100 quality score
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  location?: string;
  element?: string;
  fixable: boolean;
  autoFix?: () => Promise<void>;
}

export interface ValidationSuggestion {
  type: string;
  message: string;
  impact: 'high' | 'medium' | 'low';
  implementation?: string;
}

// Export all types
export type {
  JSZip as DocumentArchive
};