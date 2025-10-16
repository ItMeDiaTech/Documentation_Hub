/**
 * DocumentProcessor - Main document processing engine
 * Implements async/await patterns with robust error handling
 */

import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type {
  DocumentProcessingOptions,
  ProcessingResult,
  ProcessingContext,
  DocumentOperation,
  ProcessingError,
  ProcessingWarning,
  ProcessingStatistics,
  DocumentStructure,
  RelationshipInfo
} from '@/types/document-processing';
import type {
  TrackedOperation,
  OperationStatus,
  OperationResult
} from '@/types/operations';
import { BackupService } from './BackupService';
import { ValidationEngine } from './ValidationEngine';
import { HyperlinkManager } from './HyperlinkManager';
import StylesXmlProcessor from './utils/StylesXmlProcessor';
import DocumentXmlProcessor from './utils/DocumentXmlProcessor';

/**
 * Main document processor class
 * Orchestrates all document processing operations
 */
export class DocumentProcessor {
  private backupService: BackupService;
  private validationEngine: ValidationEngine;
  private hyperlinkManager: HyperlinkManager;
  private stylesProcessor: StylesXmlProcessor;
  private documentProcessor: DocumentXmlProcessor;
  private processingContext?: ProcessingContext;
  private xmlParser: XMLParser;
  private xmlBuilder: XMLBuilder;

  constructor() {
    this.backupService = new BackupService();
    this.validationEngine = new ValidationEngine();
    this.hyperlinkManager = new HyperlinkManager();
    this.stylesProcessor = new StylesXmlProcessor();
    this.documentProcessor = new DocumentXmlProcessor();

    // Initialize XML parser and builder
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: true,
      trimValues: true,
      processEntities: false,
      parseTagValue: false,
      preserveOrder: false
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      format: false,
      suppressEmptyNode: false,
      preserveOrder: false
    });
  }

  /**
   * Process a document with the specified operations
   */
  async processDocument(
    documentPath: string,
    operations: DocumentOperation[],
    options: DocumentProcessingOptions = {}
  ): Promise<ProcessingResult> {
    const startTime = new Date();
    const errors: ProcessingError[] = [];
    const warnings: ProcessingWarning[] = [];
    let backupPath: string | undefined;

    try {
      // Create backup if requested
      if (options.createBackup) {
        backupPath = await this.backupService.createBackup(documentPath);
      }

      // Load document
      const documentBuffer = await this.loadDocument(documentPath);
      const zip = await JSZip.loadAsync(documentBuffer);

      // Initialize processing context
      this.processingContext = {
        document: zip,
        documentPath,
        backupPath,
        operations,
        options,
        statistics: this.initializeStatistics(),
        errors,
        warnings,
        cache: new Map(),
        startTime
      };

      // Validate document if requested
      if (options.validateBeforeProcessing) {
        const validationResult = await this.validationEngine.validateDocument(
          zip,
          { checkStructure: true, checkRelationships: true }
        );

        if (!validationResult.valid) {
          throw new Error(`Document validation failed: ${validationResult.issues[0]?.message}`);
        }
      }

      // Analyze document structure
      const structure = await this.analyzeStructure(zip);
      this.processingContext.statistics.totalElements = structure.statistics.paragraphCount +
        structure.statistics.tableCount +
        structure.statistics.hyperlinkCount;

      // Sort operations by priority
      const sortedOperations = this.sortOperationsByPriority(operations);

      // Execute operations
      for (const operation of sortedOperations) {
        try {
          await this.executeOperation(operation, zip);
          this.processingContext.statistics.processedElements++;
        } catch (error) {
          if (operation.critical) {
            throw error;
          } else {
            errors.push({
              code: 'OPERATION_FAILED',
              message: `Operation ${operation.id} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              element: operation.description,
              recoverable: true
            });
            this.processingContext.statistics.skippedElements++;
          }
        }
      }

      // Save modified document
      const modifiedBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });

      await this.saveDocument(documentPath, modifiedBuffer);

      // Return success result
      const endTime = new Date();
      return {
        success: true,
        documentPath,
        backupPath,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        statistics: this.processingContext.statistics,
        errors,
        warnings
      };

    } catch (error) {
      // Handle errors with rollback if necessary
      if (backupPath && options.createBackup) {
        try {
          await this.backupService.restoreBackup(backupPath, documentPath);
        } catch (rollbackError) {
          errors.push({
            code: 'ROLLBACK_FAILED',
            message: 'Failed to restore backup after error',
            recoverable: false
          });
        }
      }

      const endTime = new Date();
      return {
        success: false,
        documentPath,
        backupPath,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
        statistics: this.processingContext?.statistics || this.initializeStatistics(),
        errors: [...errors, {
          code: 'PROCESSING_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          recoverable: false
        }],
        warnings
      };
    }
  }

  /**
   * Execute a single operation
   */
  private async executeOperation(
    operation: DocumentOperation,
    zip: JSZip
  ): Promise<void> {
    switch (operation.type) {
      case 'hyperlink':
        await this.executeHyperlinkOperation(operation, zip);
        break;
      case 'style':
        await this.executeStyleOperation(operation, zip);
        break;
      case 'text':
        await this.executeTextOperation(operation, zip);
        break;
      case 'structure':
        await this.executeStructureOperation(operation, zip);
        break;
      default:
        throw new Error(`Unknown operation type: ${(operation as any).type}`);
    }
  }

  /**
   * Execute hyperlink-specific operations
   */
  private async executeHyperlinkOperation(
    operation: DocumentOperation & { type: 'hyperlink' },
    zip: JSZip
  ): Promise<void> {
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) {
      throw new Error('Document XML not found');
    }

    const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
    if (!relsXml) {
      throw new Error('Relationships file not found');
    }

    // Parse XML files
    const documentParsed = this.xmlParser.parse(documentXml);
    const relsParsed = this.xmlParser.parse(relsXml);

    // Execute hyperlink operation based on action
    switch (operation.action) {
      case 'append':
        if (operation.contentId) {
          const count = await this.hyperlinkManager.appendContentIds(
            documentParsed,
            relsParsed,
            operation.contentId,
            operation.targetPattern
          );
          if (this.processingContext) {
            this.processingContext.statistics.modifiedElements += count;
          }
        }
        break;

      case 'update':
        if (operation.targetPattern && operation.replacement) {
          const count = await this.hyperlinkManager.updateHyperlinks(
            documentParsed,
            relsParsed,
            operation.targetPattern,
            operation.replacement
          );
          if (this.processingContext) {
            this.processingContext.statistics.modifiedElements += count;
          }
        }
        break;

      case 'validate':
        const issues = await this.hyperlinkManager.validateHyperlinks(
          documentParsed,
          relsParsed
        );
        issues.forEach(issue => {
          this.processingContext?.warnings.push({
            code: 'HYPERLINK_VALIDATION',
            message: issue.message,
            element: issue.hyperlinkId,
            suggestion: issue.suggestion
          });
        });
        break;

      case 'remove':
        if (operation.targetPattern) {
          const count = await this.hyperlinkManager.removeHyperlinks(
            documentParsed,
            relsParsed,
            operation.targetPattern
          );
          if (this.processingContext) {
            this.processingContext.statistics.modifiedElements += count;
          }
        }
        break;
    }

    // Save modified XML back to ZIP
    const updatedDocumentXml = this.xmlBuilder.build(documentParsed);
    const updatedRelsXml = this.xmlBuilder.build(relsParsed);

    zip.file('word/document.xml', updatedDocumentXml);
    zip.file('word/_rels/document.xml.rels', updatedRelsXml);
  }

  /**
   * Execute style operations
   */
  private async executeStyleOperation(
    operation: DocumentOperation & { type: 'style' },
    zip: JSZip
  ): Promise<void> {
    // Get styles.xml
    const stylesXml = await zip.file('word/styles.xml')?.async('string');
    if (!stylesXml) {
      this.processingContext?.warnings.push({
        code: 'NO_STYLES',
        message: 'No styles.xml file found in document',
      });
      return;
    }

    // Get document.xml
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) {
      throw new Error('Document XML not found');
    }

    // Parse styles.xml
    const stylesParseResult = this.stylesProcessor.parse(stylesXml);
    if (!stylesParseResult.success || !stylesParseResult.data) {
      throw new Error(`Failed to parse styles.xml: ${stylesParseResult.error}`);
    }

    // Parse document.xml
    const documentParseResult = this.documentProcessor.parse(documentXml);
    if (!documentParseResult.success || !documentParseResult.data) {
      throw new Error(`Failed to parse document.xml: ${documentParseResult.error}`);
    }

    let modifiedStyles = stylesParseResult.data;
    let modifiedDocument = documentParseResult.data;
    let stylesChanged = false;
    let documentChanged = false;

    // Execute style operation based on action
    switch (operation.action) {
      case 'apply':
        // Apply style to paragraphs
        const applyResult = this.documentProcessor.applyStyleToAll(
          modifiedDocument,
          operation.styleName
        );
        documentChanged = applyResult.modified > 0;

        if (this.processingContext) {
          this.processingContext.statistics.stylesApplied += applyResult.modified;
        }
        break;

      case 'modify':
        // Modify style definition
        if (operation.properties) {
          modifiedStyles = this.stylesProcessor.setParagraphStyle(
            modifiedStyles,
            operation.styleName,
            operation.styleName,
            operation.properties as any
          );
          stylesChanged = true;
        }
        break;

      case 'remove':
        // Remove style from paragraphs
        const removeResult = this.documentProcessor.clearAllStyles(modifiedDocument);
        documentChanged = removeResult.modified > 0;
        break;
    }

    // Save modified styles.xml if changed
    if (stylesChanged) {
      const stylesBuildResult = this.stylesProcessor.build(modifiedStyles);
      if (!stylesBuildResult.success || !stylesBuildResult.data) {
        throw new Error(`Failed to build styles.xml: ${stylesBuildResult.error}`);
      }
      zip.file('word/styles.xml', stylesBuildResult.data);
    }

    // Save modified document.xml if changed
    if (documentChanged) {
      const documentBuildResult = this.documentProcessor.build(modifiedDocument);
      if (!documentBuildResult.success || !documentBuildResult.data) {
        throw new Error(`Failed to build document.xml: ${documentBuildResult.error}`);
      }
      zip.file('word/document.xml', documentBuildResult.data);
    }
  }

  /**
   * Execute text operations
   */
  private async executeTextOperation(
    operation: DocumentOperation & { type: 'text' },
    zip: JSZip
  ): Promise<void> {
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) {
      throw new Error('Document XML not found');
    }

    let modifiedXml = documentXml;

    switch (operation.action) {
      case 'replace':
        if (operation.replacement !== undefined) {
          const pattern = operation.pattern instanceof RegExp
            ? operation.pattern
            : new RegExp(operation.pattern, operation.caseSensitive ? 'g' : 'gi');

          const originalLength = modifiedXml.length;
          modifiedXml = modifiedXml.replace(pattern, operation.replacement);

          if (modifiedXml.length !== originalLength && this.processingContext) {
            this.processingContext.statistics.modifiedElements++;
          }
        }
        break;

      case 'remove':
        const removePattern = operation.pattern instanceof RegExp
          ? operation.pattern
          : new RegExp(operation.pattern, operation.caseSensitive ? 'g' : 'gi');

        modifiedXml = modifiedXml.replace(removePattern, '');
        break;

      case 'format':
        // Format operation would require more complex XML manipulation
        break;
    }

    zip.file('word/document.xml', modifiedXml);
  }

  /**
   * Execute structure operations
   */
  private async executeStructureOperation(
    operation: DocumentOperation & { type: 'structure' },
    zip: JSZip
  ): Promise<void> {
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) {
      throw new Error('Document XML not found');
    }

    const documentParsed = this.xmlParser.parse(documentXml);

    // Apply structure operations based on target
    switch (operation.target) {
      case 'lists':
        // Handle list operations
        break;
      case 'tables':
        // Handle table operations
        break;
      case 'paragraphs':
        // Handle paragraph operations
        break;
      case 'images':
        // Handle image operations
        break;
    }

    const updatedDocumentXml = this.xmlBuilder.build(documentParsed);
    zip.file('word/document.xml', updatedDocumentXml);
  }

  /**
   * Analyze document structure
   */
  private async analyzeStructure(zip: JSZip): Promise<DocumentStructure> {
    const parts = Object.keys(zip.files);
    const relationships: RelationshipInfo[] = [];

    // Check for various document parts
    const hasStyles = zip.file('word/styles.xml') !== null;
    const hasNumbering = zip.file('word/numbering.xml') !== null;

    // Count elements
    const documentXml = await zip.file('word/document.xml')?.async('string');
    let statistics = {
      paragraphCount: 0,
      tableCount: 0,
      imageCount: 0,
      hyperlinkCount: 0
    };

    if (documentXml) {
      statistics = {
        paragraphCount: (documentXml.match(/<w:p[\s>]/g) || []).length,
        tableCount: (documentXml.match(/<w:tbl[\s>]/g) || []).length,
        imageCount: (documentXml.match(/<w:drawing[\s>]/g) || []).length,
        hyperlinkCount: (documentXml.match(/<w:hyperlink[\s>]/g) || []).length
      };
    }

    return {
      parts,
      relationships,
      hasStyles,
      hasNumbering,
      statistics
    };
  }

  /**
   * Sort operations by priority
   */
  private sortOperationsByPriority(operations: DocumentOperation[]): DocumentOperation[] {
    return [...operations].sort((a, b) => {
      const priorityA = a.priority ?? 999;
      const priorityB = b.priority ?? 999;
      return priorityA - priorityB;
    });
  }

  /**
   * Initialize statistics object
   */
  private initializeStatistics(): ProcessingStatistics {
    return {
      totalElements: 0,
      processedElements: 0,
      skippedElements: 0,
      modifiedElements: 0,
      hyperlinksProcessed: 0,
      stylesApplied: 0,
      replacementsMade: 0
    };
  }

  /**
   * Load document from file system
   */
  private async loadDocument(path: string): Promise<Buffer> {
    // In Electron, we'll use fs.promises
    const fs = window.require('fs').promises;
    return await fs.readFile(path);
  }

  /**
   * Save document to file system
   */
  private async saveDocument(path: string, buffer: Buffer): Promise<void> {
    const fs = window.require('fs').promises;
    await fs.writeFile(path, buffer);
  }

  /**
   * Process multiple documents in batch
   */
  async processBatch(
    documentPaths: string[],
    operations: DocumentOperation[],
    options: DocumentProcessingOptions = {},
    concurrency: number = 4
  ): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = [];
    const chunks = this.chunkArray(documentPaths, concurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(path => this.processDocument(path, operations, options))
      );
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Utility to chunk array for batch processing
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}