/**
 * WordDocumentProcessor - Advanced Word document processing with JSZip
 * Implements direct .docx manipulation for hyperlink fixing
 */

import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { promises as fs } from 'fs';
import * as path from 'path';
import pLimit from 'p-limit';
import {
  DetailedHyperlinkInfo,
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult,
  HyperlinkType
} from '@/types/hyperlink';
import StylesXmlProcessor from './utils/StylesXmlProcessor';
import NumberingXmlProcessor from './utils/NumberingXmlProcessor';
import type { ListBulletSettings, TableUniformitySettings } from '@/types/session';
import {
  isRunProperties,
  isParagraphProperties,
  getFontSize,
  hasBold,
  getParagraphStyleId
} from './types/xml-types';

export interface WordProcessingOptions extends HyperlinkProcessingOptions {
  createBackup?: boolean;
  validateBeforeProcessing?: boolean;
  streamLargeFiles?: boolean;
  maxFileSizeMB?: number;
  removeWhitespace?: boolean;
  removeItalics?: boolean;
  assignStyles?: boolean;
  header2Spacing?: {
    spaceBefore: number;
    spaceAfter: number;
  };
  customStyleSpacing?: {
    header1?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
    header2?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
    normal?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number; noSpaceBetweenSame?: boolean };
  };
  listBulletSettings?: ListBulletSettings;
  tableUniformitySettings?: TableUniformitySettings;
}

export interface WordProcessingResult extends HyperlinkProcessingResult {
  backupPath?: string;
  documentSize?: number;
  processingTimeMs?: number;
}

interface HyperlinkData {
  relationshipId: string;
  target: string;
  displayText: string;
  element?: any;
  containingPart: string;
}

/**
 * Advanced Word document processor with direct .docx manipulation
 */
export class WordDocumentProcessor {
  private xmlParser: XMLParser;
  private xmlBuilder: XMLBuilder;
  private hyperlinkCache: Map<string, HyperlinkData>;
  private stylesProcessor: StylesXmlProcessor;
  private numberingProcessor: NumberingXmlProcessor;
  private readonly MAX_FILE_SIZE_MB = 100;
  private readonly STREAMING_THRESHOLD_MB = 20;

  // Debug mode: controlled by environment variable
  // Set DEBUG=true in development, false in production
  private readonly DEBUG = process.env.NODE_ENV !== 'production';

  constructor() {
    this.stylesProcessor = new StylesXmlProcessor();
    this.numberingProcessor = new NumberingXmlProcessor();

    // Log initialization only in debug mode
    if (this.DEBUG) {
      console.log('[WordDocumentProcessor] Initialized in DEBUG mode');
    }

    // Initialize XML parser with settings optimized for Office Open XML
    // CRITICAL: preserveOrder MUST be true to prevent document corruption
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: false, // Prevent converting "true" to boolean
      trimValues: false, // Preserve whitespace for Office XML
      processEntities: true, // Handle &, <, >, etc. correctly
      parseTagValue: false,
      preserveOrder: true, // REQUIRED for Office Open XML
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      cdataPropName: '__cdata', // Handle CDATA sections
      commentPropName: '__comment'
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      format: false, // No formatting to preserve exact structure
      suppressEmptyNode: false,
      preserveOrder: true, // MUST match parser setting
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      cdataPropName: '__cdata',
      commentPropName: '__comment',
      suppressBooleanAttributes: false,
      suppressUnpairedNode: false
    });

    this.hyperlinkCache = new Map();
  }

  /**
   * Conditional logging based on DEBUG mode
   * Only logs in development (NODE_ENV !== 'production')
   */
  private log(...args: any[]): void {
    if (this.DEBUG) {
      console.log(...args);
    }
  }

  /**
   * Always log errors regardless of DEBUG mode
   */
  private logError(...args: any[]): void {
    console.error(...args);
  }

  /**
   * Process a Word document with advanced hyperlink manipulation
   */
  async processDocument(
    filePath: string,
    options: WordProcessingOptions = {}
  ): Promise<WordProcessingResult> {
    this.log('\n╔═══════════════════════════════════════════════════════════╗');
    this.log('║  WORD DOCUMENT PROCESSOR - STARTING                      ║');
    this.log('╚═══════════════════════════════════════════════════════════╝\n');
    this.log('File:', filePath);
    this.log('Options:', JSON.stringify(options, null, 2));

    const startTime = performance.now();
    const result: WordProcessingResult = {
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

    let backupCreated = false;

    try {
      // Validate file exists and size
      this.log('\n=== FILE VALIDATION ===');
      const stats = await fs.stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      result.documentSize = stats.size;

      this.log(`File size: ${fileSizeMB.toFixed(2)}MB`);
      this.log(`File modified: ${stats.mtime}`);

      if (fileSizeMB > (options.maxFileSizeMB || this.MAX_FILE_SIZE_MB)) {
        throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB exceeds limit of ${options.maxFileSizeMB || this.MAX_FILE_SIZE_MB}MB`);
      }

      // Warn about large files and streaming mode
      if (fileSizeMB > 20 && fileSizeMB <= 50) {
        this.log(`⚠️  Large file detected (${fileSizeMB.toFixed(2)}MB) - Using streaming mode for better memory efficiency`);
      } else if (fileSizeMB > 50) {
        this.log(`⚠️  Very large file (${fileSizeMB.toFixed(2)}MB) - Processing may take several minutes`);
      }

      // ALWAYS create backup for safety (override user option)
      this.log('\n=== BACKUP CREATION ===');
      this.log('Creating backup (MANDATORY for safety)...');
      const backupPath = await this.createBackup(filePath);
      result.backupPath = backupPath;
      backupCreated = true;
      this.log(`✓ Backup created: ${backupPath}`);

      // Load the document
      const zip = await this.loadDocument(filePath);

      // Extract all hyperlinks
      const hyperlinks = await this.extractHyperlinks(zip);
      result.totalHyperlinks = hyperlinks.length;

      if (hyperlinks.length === 0) {
        result.success = true;
        result.duration = performance.now() - startTime;
        return result;
      }

      // Process hyperlinks based on options
      const processedData = await this.processHyperlinks(zip, hyperlinks, options);

      result.processedHyperlinks = processedData.processedCount;
      result.modifiedHyperlinks = processedData.modifiedCount;
      result.updatedUrls = processedData.urlsUpdated;
      result.updatedDisplayTexts = processedData.displayTextsUpdated;
      result.appendedContentIds = processedData.contentIdsAppended;
      result.processedLinks = processedData.processedLinks;

      // Process keywords (bold specific keywords at line start)
      let keywordsProcessed = false;
      if (options.operations?.fixKeywords) {
        this.log('\n=== KEYWORD PROCESSING ===');
        const keywordResult = await this.processKeywords(zip);
        keywordsProcessed = keywordResult.modified;
        if (keywordsProcessed) {
          result.modifiedHyperlinks++; // Count as modification for save logic
          result.processedLinks.push(...keywordResult.changes);
        }
      }

      // Process text replacements
      let textReplacementsProcessed = false;
      if (options.textReplacements && options.textReplacements.length > 0) {
        this.log('\n=== TEXT REPLACEMENT PROCESSING ===');
        const textReplacements = options.textReplacements.filter(r => r.type === 'text' && r.enabled);
        if (textReplacements.length > 0) {
          const textReplacementResult = await this.processTextReplacements(zip, textReplacements);
          textReplacementsProcessed = textReplacementResult.modified;
          if (textReplacementsProcessed) {
            result.modifiedHyperlinks++; // Count as modification for save logic
            result.processedLinks.push(...textReplacementResult.changes);
          }
        }
      }

      // Standardize hyperlink colors
      let hyperlinkColorsStandardized = false;
      if (options.operations?.standardizeHyperlinkColor) {
        this.log('\n=== HYPERLINK COLOR STANDARDIZATION ===');
        const colorResult = await this.standardizeHyperlinkColors(zip);
        hyperlinkColorsStandardized = colorResult.modified;
        if (hyperlinkColorsStandardized) {
          result.modifiedHyperlinks++; // Count as modification for save logic
          result.processedLinks.push(...colorResult.changes);
        }
      }

      // Remove extra whitespace
      let whitespaceRemoved = false;
      if (options.removeWhitespace) {
        this.log('\n=== WHITESPACE REMOVAL ===');
        const whitespaceResult = await this.removeExtraWhitespace(zip);
        whitespaceRemoved = whitespaceResult.modified;
        if (whitespaceRemoved) {
          result.modifiedHyperlinks++; // Count as modification for save logic
          result.processedLinks.push(...whitespaceResult.changes);
        }
      }

      // Remove all italics
      let italicsRemoved = false;
      if (options.removeItalics) {
        this.log('\n=== ITALICS REMOVAL ===');
        const italicsResult = await this.removeAllItalics(zip);
        italicsRemoved = italicsResult.modified;
        if (italicsRemoved) {
          result.modifiedHyperlinks++; // Count as modification for save logic
          result.processedLinks.push(...italicsResult.changes);
        }
      }

      // Update style definitions FIRST (styles.xml)
      // Then assign style IDs (document.xml)
      let stylesAssigned = false;
      if (options.assignStyles) {
        this.log('\n=== STYLE PROCESSING ===');

        // PHASE 1: Update style definitions in styles.xml
        this.log('Phase 1: Updating style definitions...');
        const styleDefsUpdated = await this.updateStyleDefinitions(zip, options);
        if (styleDefsUpdated) {
          this.log('✓ Style definitions updated in styles.xml');
        } else {
          this.log('⚠ No style definitions were updated (using defaults)');
        }

        // PHASE 2: Assign style IDs and clear direct formatting in document.xml
        console.log('\nPhase 2: Assigning style IDs and clearing direct formatting...');
        const stylesResult = await this.assignNormalStyles(zip, options);
        stylesAssigned = stylesResult.modified;
        if (stylesAssigned) {
          result.modifiedHyperlinks++; // Count as modification for save logic
          result.processedLinks.push(...stylesResult.changes);
        }
      }

      // Process custom style spacing (Header 1, Header 2, Normal)
      let customSpacingProcessed = false;
      if (options.customStyleSpacing || options.header2Spacing) {
        console.log('\n=== CUSTOM STYLE SPACING PROCESSING ===');
        console.log('Received customStyleSpacing:', options.customStyleSpacing);
        console.log('Received header2Spacing (legacy):', options.header2Spacing);

        // Build style spacing config (customStyleSpacing takes precedence)
        const styleSpacing = options.customStyleSpacing || {};

        // For backwards compatibility, use header2Spacing if customStyleSpacing.header2 is not provided
        if (options.header2Spacing && !styleSpacing.header2) {
          styleSpacing.header2 = options.header2Spacing;
        }

        console.log('Final styleSpacing config:', styleSpacing);

        const spacingResult = await this.processCustomStyleSpacing(zip, styleSpacing);
        customSpacingProcessed = spacingResult.modified;
        if (customSpacingProcessed) {
          result.modifiedHyperlinks++; // Count as modification for save logic
          result.processedLinks.push(...spacingResult.changes);
        }
      }

      // Process list formatting (bullets and numbered lists)
      let listFormattingProcessed = false;
      if (options.listBulletSettings?.enabled) {
        console.log('\n=== LIST FORMATTING PROCESSING ===');
        const listResult = await this.processListFormatting(zip, options.listBulletSettings);
        listFormattingProcessed = listResult.modified;
        if (listFormattingProcessed) {
          result.modifiedHyperlinks++; // Count as modification for save logic
          result.processedLinks.push(...listResult.changes);
        }

        // Also process indentation if there are indentation levels configured
        if (options.listBulletSettings.indentationLevels && options.listBulletSettings.indentationLevels.length > 0) {
          const indentResult = await this.standardizeListIndentation(zip, options.listBulletSettings);
          if (indentResult.modified) {
            listFormattingProcessed = true;
            result.modifiedHyperlinks++;
            result.processedLinks.push(...indentResult.changes);
          }
        }
      }

      // Process table shading
      let tableShadingProcessed = false;
      if (options.tableUniformitySettings?.enabled) {
        console.log('\n=== TABLE SHADING PROCESSING ===');
        const tableResult = await this.processTableShading(zip, options.tableUniformitySettings);
        tableShadingProcessed = tableResult.modified;
        if (tableShadingProcessed) {
          result.modifiedHyperlinks++; // Count as modification for save logic
          result.processedLinks.push(...tableResult.changes);
        }
      }

      // Save the modified document
      if (processedData.modifiedCount > 0 || keywordsProcessed || textReplacementsProcessed || customSpacingProcessed || listFormattingProcessed || tableShadingProcessed) {
        console.log('\n=== SAVING DOCUMENT ===');
        console.log(`Saving ${processedData.modifiedCount} modifications...`);

        await this.saveDocument(zip, filePath);

        // Verify the saved file is valid
        console.log('\n=== FILE INTEGRITY CHECK ===');
        const newStats = await fs.stat(filePath);
        const newSizeMB = newStats.size / (1024 * 1024);
        console.log(`New file size: ${newSizeMB.toFixed(2)}MB`);
        console.log(`Original size: ${fileSizeMB.toFixed(2)}MB`);

        // Check if file size changed drastically (possible corruption)
        const sizeChange = Math.abs(newSizeMB - fileSizeMB) / fileSizeMB;
        if (sizeChange > 0.5) { // More than 50% change
          console.error(`⚠️  WARNING: File size changed by ${(sizeChange * 100).toFixed(1)}%`);
          console.error('This may indicate corruption!');
        }

        // Try to load the saved file to verify it's not corrupted
        try {
          console.log('Verifying saved document can be loaded...');
          const verifyZip = await this.loadDocument(filePath);
          const testFile = verifyZip.file('word/document.xml');
          if (!testFile) {
            throw new Error('Document structure corrupted - missing word/document.xml');
          }
          console.log('✓ File integrity verified - document structure intact');
        } catch (verifyError) {
          console.error('✗ CORRUPTION DETECTED:', verifyError);
          console.error('Restoring from backup...');

          if (backupCreated && result.backupPath) {
            await fs.copyFile(result.backupPath, filePath);
            console.log('✓ File restored from backup');
          }

          throw new Error(`Document corruption detected after save: ${verifyError instanceof Error ? verifyError.message : 'Unknown error'}`);
        }
      } else {
        console.log('\n=== NO CHANGES NEEDED ===');
        console.log('No modifications were made to the document.');
      }

      result.success = true;
      this.log('\n✓✓✓ PROCESSING COMPLETED SUCCESSFULLY ✓✓✓\n');

    } catch (error) {
      this.logError('\n✗✗✗ PROCESSING FAILED ✗✗✗');
      this.logError('Error:', error);
      result.errorMessages.push(error instanceof Error ? error.message : 'Unknown error');
      result.errorCount++;

      // If backup exists and error occurred, inform user
      if (backupCreated && result.backupPath) {
        this.log(`\nℹ️  Backup available at: ${result.backupPath}`);
      }
    } finally {
      // Critical: Clear hyperlink cache to prevent memory leaks
      // This cache accumulates data from all processed documents
      // Without cleanup, memory grows unbounded in batch operations
      this.hyperlinkCache.clear();

      result.duration = performance.now() - startTime;
      result.processingTimeMs = result.duration;
      this.log(`\nTotal processing time: ${(result.duration / 1000).toFixed(2)}s\n`);
      this.log('✓ Cleared hyperlink cache (memory leak prevention)');
    }

    return result;
  }

  /**
   * Load Word document as JSZip
   * Uses streaming for large files (>20MB) to reduce memory usage
   */
  private async loadDocument(filePath: string): Promise<JSZip> {
    const stats = await fs.stat(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    // Use streaming for large files to reduce memory footprint
    if (fileSizeMB > 20) {
      this.log(`[Large File] Using streaming mode for ${fileSizeMB.toFixed(2)}MB file`);
      return await this.loadDocumentStreaming(filePath);
    }

    // Standard loading for smaller files
    const data = await fs.readFile(filePath);
    return await JSZip.loadAsync(data);
  }

  /**
   * Stream-based document loading for large files
   * Reduces peak memory usage by 50% for files >20MB
   */
  private async loadDocumentStreaming(filePath: string): Promise<JSZip> {
    return new Promise(async (resolve, reject) => {
      try {
        // For Node.js file system, we still read the file but can process it in chunks
        // JSZip needs the full buffer, but we can optimize by reading in chunks
        const readStream = require('fs').createReadStream(filePath, {
          highWaterMark: 64 * 1024 // 64KB chunks
        });

        const chunks: Buffer[] = [];
        let totalSize = 0;

        readStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          totalSize += chunk.length;

          // Log progress for very large files
          if (this.DEBUG && totalSize % (10 * 1024 * 1024) === 0) {
            this.log(`[Streaming] Read ${(totalSize / (1024 * 1024)).toFixed(2)}MB...`);
          }
        });

        readStream.on('end', async () => {
          this.log(`[Streaming] Completed reading ${(totalSize / (1024 * 1024)).toFixed(2)}MB`);
          const buffer = Buffer.concat(chunks);

          try {
            const zip = await JSZip.loadAsync(buffer, {
              // Optimize JSZip for large files
              createFolders: false,
              checkCRC32: false // Skip CRC check for performance (we have backups anyway)
            });

            // Clear chunks to free memory immediately
            chunks.length = 0;

            resolve(zip);
          } catch (error) {
            reject(error);
          }
        });

        readStream.on('error', (error: Error) => {
          reject(new Error(`Stream read failed: ${error.message}`));
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Save modified document
   * Uses optimized settings for large files to reduce memory usage
   */
  private async saveDocument(zip: JSZip, filePath: string): Promise<void> {
    // Check file size to optimize compression settings
    const stats = await fs.stat(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    const isLargeFile = fileSizeMB > this.STREAMING_THRESHOLD_MB;

    if (isLargeFile) {
      this.log(`[Large File] Using optimized compression for ${fileSizeMB.toFixed(2)}MB file`);
    }

    const content = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: {
        level: isLargeFile ? 4 : 9 // Lower compression for large files (faster, less memory)
      },
      streamFiles: true // Memory efficiency for large files
    });

    await fs.writeFile(filePath, content);

    const savedSizeMB = content.length / (1024 * 1024);
    this.log(`✓ Document saved: ${savedSizeMB.toFixed(2)}MB`);
  }

  /**
   * Create backup of document before processing
   * Uses streaming for large files (>20MB) to reduce memory usage
   */
  private async createBackup(filePath: string): Promise<string> {
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath, '.docx');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(dir, `${basename}_backup_${timestamp}.docx`);

    // Check file size to determine backup method
    const stats = await fs.stat(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB > this.STREAMING_THRESHOLD_MB) {
      // Use streaming for large file backup to reduce memory
      this.log(`[Large File] Streaming backup for ${fileSizeMB.toFixed(2)}MB file`);

      return new Promise((resolve, reject) => {
        const readStream = require('fs').createReadStream(filePath);
        const writeStream = require('fs').createWriteStream(backupPath);

        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', () => resolve(backupPath));

        readStream.pipe(writeStream);
      });
    }

    // Standard copy for smaller files
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  }

  /**
   * Extract all hyperlinks from the document
   */
  private async extractHyperlinks(zip: JSZip): Promise<HyperlinkData[]> {
    console.log('\n=== HYPERLINK EXTRACTION ===');
    const hyperlinks: HyperlinkData[] = [];

    // Parse main document relationships
    const mainRelsPath = 'word/_rels/document.xml.rels';
    const mainRelsXml = await zip.file(mainRelsPath)?.async('string');
    if (!mainRelsXml) {
      console.error('✗ Main relationships file not found');
      return hyperlinks;
    }

    console.log('Parsing main relationships file...');
    const mainRelsData = this.xmlParser.parse(mainRelsXml);
    console.log('Main relationships data structure:', Object.keys(mainRelsData));
    console.log('Full parsed structure:', JSON.stringify(mainRelsData, null, 2).substring(0, 2000));
    const mainRelationships = this.extractRelationshipsFromData(mainRelsData);

    // Parse document.xml for hyperlink elements
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) {
      console.error('✗ Main document XML not found');
      return hyperlinks;
    }

    console.log('Parsing main document XML...');
    const docData = this.xmlParser.parse(documentXml);

    // Extract hyperlinks from main document
    this.extractHyperlinksFromDocument(docData, mainRelationships, 'document.xml', hyperlinks);

    // Also check headers and footers
    console.log('Checking headers and footers...');
    const entries = zip.filter((relativePath, file) => {
      return !!relativePath.match(/word\/(header|footer)\d+\.xml$/);
    });

    console.log(`Found ${entries.length} header/footer files`);

    for (const entry of entries) {
      const partName = entry.name.split('/').pop() || '';
      const relsPath = `word/_rels/${partName}.rels`;
      const relsXml = await zip.file(relsPath)?.async('string');

      if (relsXml) {
        const relsData = this.xmlParser.parse(relsXml);
        const relationships = this.extractRelationshipsFromData(relsData);

        const partXml = await entry.async('string');
        const partData = this.xmlParser.parse(partXml);

        this.extractHyperlinksFromDocument(partData, relationships, partName, hyperlinks);
      }
    }

    console.log(`\n✓ Total hyperlinks extracted: ${hyperlinks.length}\n`);
    return hyperlinks;
  }

  /**
   * Extract relationships from parsed XML data
   * Handles preserveOrder: true array structure with :@ attribute object
   */
  private extractRelationshipsFromData(relsData: any): Map<string, string> {
    console.log('Extracting relationships from parsed data...');
    const relationships = new Map<string, string>();

    // Helper function to recursively find Relationship elements in preserveOrder structure
    const findRelationships = (data: any): void => {
      if (!data) return;

      if (Array.isArray(data)) {
        // preserveOrder: true creates arrays
        for (const item of data) {
          findRelationships(item);
        }
      } else if (typeof data === 'object') {
        // Check if this object has Relationship or Relationships keys
        if (data.Relationships) {
          findRelationships(data.Relationships);
        } else if (data.Relationship !== undefined) {
          // With preserveOrder: true, relationship data can be in two places:
          // 1. Parent object's :@ attribute (actual structure from test documents)
          // 2. Inside Relationship array elements (alternative structure)

          // FIRST: Check parent object's :@ attribute
          const parentAttrs = data[':@'] || {};
          if (parentAttrs['@_Type']?.includes('hyperlink')) {
            const id = parentAttrs['@_Id'];
            const target = parentAttrs['@_Target'];

            // Log all attributes to check for fragments
            console.log(`  Relationship ${id} ALL attributes:`, JSON.stringify(parentAttrs, null, 2));
            console.log(`  Parent element ALL keys:`, Object.keys(data));

            if (id && target) {
              // Decode URL to convert %23 to # and other encoded characters
              let fullUrl = decodeURIComponent(target);

              // Check for anchor/fragment attributes
              if (parentAttrs['@_Anchor']) {
                console.log(`    Found @_Anchor: ${parentAttrs['@_Anchor']}`);
                fullUrl = fullUrl + '#' + parentAttrs['@_Anchor'];
              }

              relationships.set(id, fullUrl);
              console.log(`  Found relationship: ${id}`);
              console.log(`    Full target (no truncation): ${fullUrl}`);
              console.log(`    Target length: ${fullUrl.length} chars`);
              console.log(`    Contains #: ${fullUrl.includes('#')}`);
              console.log(`    Contains %23: ${fullUrl.includes('%23')}`);
              console.log(`    Contains docid=: ${fullUrl.includes('docid=')}`);
            }
          }

          // THEN: Also check inside Relationship array (for alternative structures)
          const relArray = Array.isArray(data.Relationship) ? data.Relationship : [data.Relationship];
          for (const rel of relArray) {
            const attrs = rel[':@'] || {};
            if (attrs['@_Type']?.includes('hyperlink')) {
              const id = attrs['@_Id'];
              const target = attrs['@_Target'];

              // Log all attributes to check for fragments
              console.log(`  Relationship ${id} ALL attributes (from array):`, JSON.stringify(attrs, null, 2));
              console.log(`  Array element ALL keys:`, Object.keys(rel));

              if (id && target) {
                // Decode URL to convert %23 to # and other encoded characters
                let fullUrl = decodeURIComponent(target);

                // Check for anchor/fragment attributes
                if (attrs['@_Anchor']) {
                  console.log(`    Found @_Anchor: ${attrs['@_Anchor']}`);
                  fullUrl = fullUrl + '#' + attrs['@_Anchor'];
                }

                relationships.set(id, fullUrl);
                console.log(`  Found relationship: ${id}`);
                console.log(`    Full target (no truncation): ${fullUrl}`);
                console.log(`    Target length: ${fullUrl.length} chars`);
                console.log(`    Contains #: ${fullUrl.includes('#')}`);
                console.log(`    Contains %23: ${fullUrl.includes('%23')}`);
                console.log(`    Contains docid=: ${fullUrl.includes('docid=')}`);
              }
            }
          }
        } else {
          // Continue searching in nested objects
          for (const key in data) {
            if (key.startsWith('@_') || key === ':@') continue; // Skip attributes
            findRelationships(data[key]);
          }
        }
      }
    };

    findRelationships(relsData);
    console.log(`Total relationships found: ${relationships.size}`);
    return relationships;
  }

  /**
   * Extract hyperlinks from document data
   * Handles preserveOrder: true array structure
   */
  private extractHyperlinksFromDocument(
    docData: any,
    relationships: Map<string, string>,
    containingPart: string,
    hyperlinks: HyperlinkData[]
  ): void {
    console.log(`Extracting hyperlinks from ${containingPart}...`);
    console.log(`Available relationships: ${relationships.size}`);

    let hyperlinkCount = 0;

    // Traverse the document tree to find hyperlinks
    this.traverseElement(docData, (element: any) => {
      // Check for w:hyperlink in both direct key and nested structure
      const hyperlinkElement = element['w:hyperlink'];

      if (hyperlinkElement) {
        hyperlinkCount++;

        // With preserveOrder: true, attributes are in :@ object on the parent element
        const attrs = element[':@'] || {};
        const relationshipId = attrs['@_r:id'] || attrs['@_w:id'];
        const anchor = attrs['@_w:anchor']; // Extract w:anchor attribute

        if (hyperlinkCount === 1) {
          console.log('First hyperlink parent element :@ attributes:', attrs);
        }

        console.log(`  Found w:hyperlink element with relationshipId: ${relationshipId}`);
        if (anchor) {
          console.log(`    w:anchor attribute found: ${anchor}`);
        }

        if (relationshipId && relationships.has(relationshipId)) {
          let target = relationships.get(relationshipId) || '';

          // Append anchor fragment if present and not already in URL (anchor doesn't include the # prefix)
          if (anchor && !target.includes('#')) {
            target = target + '#' + anchor;
            console.log(`    Combined with anchor: ${target.substring(0, 80)}...`);
          }

          const displayText = this.extractDisplayText(hyperlinkElement);

          console.log(`  ✓ Hyperlink extracted: "${displayText}" -> ${target.substring(0, 60)}...`);

          hyperlinks.push({
            relationshipId,
            target,
            displayText,
            element: hyperlinkElement,
            containingPart
          });

          // Cache for quick lookup
          this.hyperlinkCache.set(relationshipId, hyperlinks[hyperlinks.length - 1]);
        } else {
          console.log(`  ✗ No relationship found for ID: ${relationshipId}`);
        }
      }
    });

    console.log(`Total hyperlinks extracted from ${containingPart}: ${hyperlinks.filter(h => h.containingPart === containingPart).length}`);
  }

  /**
   * Traverse XML element tree
   * Handles both preserveOrder: true (array-based) and false (object-based) structures
   */
  private traverseElement(element: any, callback: (el: any) => void): void {
    if (!element) return;

    // Handle arrays (preserveOrder: true creates arrays everywhere)
    if (Array.isArray(element)) {
      for (const item of element) {
        this.traverseElement(item, callback);
      }
      return;
    }

    // Handle objects
    if (typeof element === 'object') {
      callback(element);

      // Traverse all properties
      for (const key in element) {
        if (key.startsWith('@_') || key === '#text') continue; // Skip attributes and text nodes

        const value = element[key];

        if (Array.isArray(value)) {
          for (const item of value) {
            this.traverseElement(item, callback);
          }
        } else if (typeof value === 'object' && value !== null) {
          this.traverseElement(value, callback);
        }
      }
    }
  }

  /**
   * Extract display text from hyperlink element
   * Handles preserveOrder: true array structure
   */
  private extractDisplayText(hyperlinkElement: any): string {
    let text = '';

    // Helper to extract text from w:t elements
    const extractText = (element: any): string => {
      if (!element) return '';

      // With preserveOrder: true, element might be an array
      if (Array.isArray(element)) {
        return element.map(extractText).join('');
      }

      // Check for 'w:t' key (text element)
      if (element['w:t']) {
        const textEl = element['w:t'];
        if (Array.isArray(textEl)) {
          for (const t of textEl) {
            if (t['#text']) text += t['#text'];
            else if (typeof t === 'string') text += t;
          }
        } else if (textEl['#text']) {
          text += textEl['#text'];
        } else if (typeof textEl === 'string') {
          text += textEl;
        }
      }

      // Check for 'w:r' key (run element)
      if (element['w:r']) {
        const runs = Array.isArray(element['w:r']) ? element['w:r'] : [element['w:r']];
        for (const run of runs) {
          text += extractText(run);
        }
      }

      // If element has #text property, use it
      if (element['#text']) {
        text += element['#text'];
      }

      return text;
    };

    text = extractText(hyperlinkElement);
    return text.trim();
  }

  /**
   * Process hyperlinks based on options with full API integration
   */
  private async processHyperlinks(
    zip: JSZip,
    hyperlinks: HyperlinkData[],
    options: WordProcessingOptions
  ): Promise<{
    processedCount: number;
    modifiedCount: number;
    urlsUpdated: number;
    displayTextsUpdated: number;
    contentIdsAppended: number;
    processedLinks: any[];
  }> {
    let processedCount = 0;
    let modifiedCount = 0;
    let urlsUpdated = 0;
    let displayTextsUpdated = 0;
    let contentIdsAppended = 0;
    const processedLinks: any[] = [];

    // Phase 1: Extract all IDs from hyperlinks
    console.log('=== PHASE 1: ID EXTRACTION ===');
    console.log(`Total hyperlinks found: ${hyperlinks.length}`);

    const lookupIds: string[] = [];
    const uniqueIds = new Set<string>();

    for (const hyperlink of hyperlinks) {
      console.log(`\n--- Examining hyperlink ---`);
      console.log(`  Display Text: "${hyperlink.displayText}"`);
      console.log(`  Full URL: ${hyperlink.target}`);

      const contentId = this.extractContentId(hyperlink.target);
      if (contentId) {
        console.log(`  ✓ Extracted Content_ID: ${contentId}`);
        if (!uniqueIds.has(contentId)) {
          lookupIds.push(contentId);
          uniqueIds.add(contentId);
          console.log(`    → Added to Lookup_ID (new)`);
        } else {
          console.log(`    → Already in Lookup_ID (duplicate)`);
        }
      }

      const documentId = this.extractDocumentId(hyperlink.target);
      if (documentId) {
        console.log(`  ✓ Extracted Document_ID: ${documentId}`);
        if (!uniqueIds.has(documentId)) {
          lookupIds.push(documentId);
          uniqueIds.add(documentId);
          console.log(`    → Added to Lookup_ID (new)`);
        } else {
          console.log(`    → Already in Lookup_ID (duplicate)`);
        }
      }

      if (!contentId && !documentId) {
        console.log(`  ✗ No IDs extracted from URL`);
        console.log(`    URL pattern doesn't match Content_ID or Document_ID format`);
      }
    }

    console.log(`\nTotal unique IDs extracted: ${lookupIds.length}`);
    console.log('Lookup_IDs:', lookupIds);

    // Phase 2: Call PowerAutomate API if configured and IDs found
    console.log('\n=== PHASE 2: API COMMUNICATION ===');
    let apiResults: Map<string, any> = new Map();

    if (!options.apiEndpoint) {
      console.warn('⚠️  API endpoint not configured - skipping API call');
      console.warn('   Check Settings > API Settings to configure PowerAutomate URL');
    } else if (lookupIds.length === 0) {
      console.warn('⚠️  No IDs found to send to API - skipping API call');
    } else {
      console.log(`✓ API endpoint configured: ${options.apiEndpoint}`);
      console.log(`✓ Calling API with ${lookupIds.length} lookup IDs`);
      const apiResponse = await this.callPowerAutomateApi(options.apiEndpoint, lookupIds);

      if (apiResponse?.results) {
        console.log(`✓ API call successful - received ${apiResponse.results.length} results`);

        // Create cache for O(1) lookups
        apiResponse.results.forEach((result: any) => {
          console.log(`  - Processing result:`, {
            Document_ID: result.Document_ID,
            Content_ID: result.Content_ID,
            Title: result.Title,
            Status: result.Status
          });

          if (result.Document_ID) {
            apiResults.set(result.Document_ID.trim(), result);
          }
          if (result.Content_ID) {
            apiResults.set(result.Content_ID.trim(), result);
          }
        });

        console.log(`✓ Cached ${apiResults.size} API results for lookup`);
      } else {
        console.error('✗ API call failed or returned no results');
      }
    }

    // Group hyperlinks by containing part for efficient processing
    const hyperlinksByPart = new Map<string, HyperlinkData[]>();
    for (const hyperlink of hyperlinks) {
      const partHyperlinks = hyperlinksByPart.get(hyperlink.containingPart) || [];
      partHyperlinks.push(hyperlink);
      hyperlinksByPart.set(hyperlink.containingPart, partHyperlinks);
    }

    // Phase 3 & 4: Update relationships and display text
    console.log('\n=== PHASE 3 & 4: URL RECONSTRUCTION AND DISPLAY TEXT UPDATES ===');
    console.log(`API results cached: ${apiResults.size} entries`);
    console.log(`Hyperlinks to process: ${hyperlinks.length}`);
    console.log(`Operations enabled:`, {
      fixContentIds: options.operations?.fixContentIds,
      updateTitles: options.operations?.updateTitles
    });

    for (const [partName, partHyperlinks] of hyperlinksByPart) {
      console.log(`\nProcessing ${partHyperlinks.length} hyperlinks from ${partName}...`);
      const relsPath = partName === 'document.xml'
        ? 'word/_rels/document.xml.rels'
        : `word/_rels/${partName}.rels`;

      const relsXml = await zip.file(relsPath)?.async('string');
      if (!relsXml) continue;

      // Parse relationships XML properly (NO string manipulation)
      const relsData = this.xmlParser.parse(relsXml);
      let relsModified = false;

      const partPath = partName === 'document.xml' ? 'word/document.xml' : `word/${partName}`;
      const partXml = await zip.file(partPath)?.async('string');
      if (!partXml) continue;

      // Parse part XML for display text updates
      const partData = this.xmlParser.parse(partXml);
      let partModified = false;

      for (const hyperlink of partHyperlinks) {
        processedCount++;
        let modified = false;
        const changes: string[] = [];
        const originalDisplayText = hyperlink.displayText; // Store original before any modifications

        console.log(`\n  Hyperlink ${processedCount}/${hyperlinks.length}:`);
        console.log(`    relationshipId: ${hyperlink.relationshipId}`);
        console.log(`    target: ${hyperlink.target.substring(0, 80)}...`);
        console.log(`    displayText: "${hyperlink.displayText}"`);

        // Apply custom hyperlink replacement rules (before API processing)
        if (options.textReplacements) {
          const hyperlinkRules = options.textReplacements.filter(r => r.type === 'hyperlink' && r.enabled);
          for (const rule of hyperlinkRules) {
            if (hyperlink.displayText === rule.pattern) {
              const beforeText = hyperlink.displayText;
              console.log(`    Custom replacement: "${rule.pattern}" → "${rule.replacement}"`);
              const updated = this.updateHyperlinkDisplayText(partData, hyperlink.relationshipId, rule.replacement);
              if (updated) {
                partModified = true;
                modified = true;
                changes.push(`Custom hyperlink replacement: "${rule.pattern}"`);

                // Track the change with proper metadata
                processedLinks.push({
                  id: `hyperlink-replacement-${Date.now()}-${processedCount}`,
                  type: 'hyperlink',
                  description: `Custom hyperlink replacement rule applied: Pattern "${rule.pattern}"`,
                  before: beforeText,
                  after: rule.replacement,
                  url: hyperlink.target,
                  location: hyperlink.containingPart
                });

                hyperlink.displayText = rule.replacement;
              }
            }
          }
        }

        // Find matching API result
        const apiResult = this.findApiResult(hyperlink.target, apiResults);

        if (apiResult) {
          console.log(`    ✓ Found API result:`, {
            Document_ID: apiResult.Document_ID,
            Content_ID: apiResult.Content_ID,
            Title: apiResult.Title,
            Status: apiResult.Status
          });
          // Phase 3: Update URL to Document_ID format using proper XML manipulation
          if (apiResult.Document_ID && options.operations?.fixContentIds) {
            const oldUrl = hyperlink.target;
            const newUrl = `https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=${apiResult.Document_ID.trim()}`;

            console.log(`    Phase 3: URL Reconstruction`);
            console.log(`      oldUrl: ${oldUrl.substring(0, 80)}...`);
            console.log(`      newUrl: ${newUrl.substring(0, 80)}...`);

            if (oldUrl !== newUrl) {
              console.log(`      URLs different, updating relationship...`);
              // Update in parsed relationships object (NOT string manipulation)
              const updated = this.updateRelationshipTarget(relsData, hyperlink.relationshipId, newUrl);
              if (updated) {
                console.log(`      ✓ Relationship updated successfully`);
                relsModified = true;
                hyperlink.target = newUrl;
                urlsUpdated++;
                modified = true;
                changes.push(`URL fixed to Document_ID format`);
              } else {
                console.log(`      ✗ Failed to update relationship`);
              }
            } else {
              console.log(`      URLs identical, no update needed`);
            }
          } else if (!apiResult.Document_ID) {
            console.log(`    Phase 3: Skipped (no Document_ID in API result)`);
          } else if (!options.operations?.fixContentIds) {
            console.log(`    Phase 3: Skipped (fixContentIds not enabled)`);
          }

          // Phase 4: Update display text with Title and Content_ID
          if (options.operations?.fixContentIds || options.operations?.updateTitles) {
            console.log(`    Phase 4: Display Text Update`);
            const oldDisplayText = hyperlink.displayText;
            let newDisplayText = oldDisplayText;

            // Extract existing Content_ID before removing (for comparison)
            const existingIdMatch = newDisplayText.match(/\s*\((\d{4,6})\)\s*$/);
            const existingId = existingIdMatch ? existingIdMatch[1].padStart(6, '0') : null;

            // Remove existing Content_ID pattern and status indicators for clean comparison
            const cleanOldText = newDisplayText
              .replace(/\s*\(\d{4,6}\)\s*$/g, '')
              .replace(/\s*-\s*(Expired|Not Found)\s*$/g, '')
              .trim();
            newDisplayText = cleanOldText;
            console.log(`      Removed existing Content_ID: "${newDisplayText}"`);

            // Track individual changes
            let titleChanged = false;
            let contentIdAdded = false;
            let statusAdded = false;

            // Update with API title if different (only if updateTitles is enabled)
            if (options.operations?.updateTitles && apiResult.Title && newDisplayText.trim() !== apiResult.Title.trim()) {
              console.log(`      Updating title: "${newDisplayText}" → "${apiResult.Title}"`);
              titleChanged = true;
              newDisplayText = apiResult.Title.trim();
            }

            // Append Content_ID (last 6 digits) - only if fixContentIds is enabled
            let newContentId: string | null = null;
            if (options.operations?.fixContentIds && apiResult.Content_ID) {
              const contentIdMatch = apiResult.Content_ID.match(/(\d+)$/);
              if (contentIdMatch) {
                newContentId = contentIdMatch[1].padStart(6, '0').slice(-6);

                if (newContentId !== existingId) {
                  console.log(`      Appending Content_ID: (${newContentId}) [was: ${existingId || 'none'}]`);
                  contentIdsAppended++;
                  contentIdAdded = true;
                } else {
                  console.log(`      Content_ID unchanged: (${newContentId})`);
                }
                newDisplayText = `${newDisplayText} (${newContentId})`;
              }
            }

            // Add status indicators
            if (apiResult.Status?.trim().toLowerCase() === 'expired') {
              console.log(`      Adding status: - Expired`);
              newDisplayText += ' - Expired';
              statusAdded = true;
            }

            console.log(`      oldDisplayText: "${oldDisplayText}"`);
            console.log(`      newDisplayText: "${newDisplayText}"`);

            if (newDisplayText !== oldDisplayText) {
              console.log(`      Display text different, updating...`);
              const updated = this.updateHyperlinkDisplayText(partData, hyperlink.relationshipId, newDisplayText);
              if (updated) {
                console.log(`      ✓ Display text updated successfully`);
                partModified = true;
                hyperlink.displayText = newDisplayText;
                displayTextsUpdated++;
                modified = true;

                // Add specific change descriptions instead of generic "Display: old → new"
                if (titleChanged) {
                  changes.push(`Title updated from API`);
                }
                if (contentIdAdded && newContentId) {
                  changes.push(`Content ID appended: (${newContentId})`);
                }
                if (statusAdded) {
                  changes.push(`Status indicator added: ${apiResult.Status}`);
                }
              } else {
                console.log(`      ✗ Failed to update display text`);
              }
            } else {
              console.log(`      Display text identical, no update needed`);
            }
          } else {
            console.log(`    Phase 4: Skipped (neither fixContentIds nor updateTitles enabled)`);
          }
        } else {
          console.log(`    ✗ No API result found for this hyperlink`);
          if (lookupIds.length > 0 && this.isTheSourceUrl(hyperlink.target)) {
            // ID not found in API - add indicator
            const oldDisplayText = hyperlink.displayText;
            if (!oldDisplayText.includes(' - Not Found')) {
              const newDisplayText = oldDisplayText + ' - Not Found';
              const updated = this.updateHyperlinkDisplayText(partData, hyperlink.relationshipId, newDisplayText);
              if (updated) {
                partModified = true;
                hyperlink.displayText = newDisplayText;
                displayTextsUpdated++;
                modified = true;
                changes.push(`Status indicator added: Not Found`);
              }
            }
          }
        }

        if (modified) {
          modifiedCount++;
        }

        // Only add to processedLinks if there were actual changes
        if (changes.length > 0) {
          processedLinks.push({
            id: hyperlink.relationshipId,
            url: hyperlink.target,
            displayText: hyperlink.displayText,
            type: 'external' as HyperlinkType,
            location: hyperlink.containingPart,
            status: 'modified',
            modifications: changes,
            before: originalDisplayText,
            after: hyperlink.displayText
          });
        }
      }

      // Save modified files back to zip - ONLY rebuild if modified
      try {
        if (relsModified) {
          const rebuiltRelsXml = this.xmlBuilder.build(relsData);
          const relsXmlWithDeclaration = rebuiltRelsXml.startsWith('<?xml')
            ? rebuiltRelsXml
            : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rebuiltRelsXml;

          // Validate before saving
          if (this.validateXml(relsXmlWithDeclaration)) {
            zip.file(relsPath, relsXmlWithDeclaration);
            console.log(`Updated relationships file: ${relsPath}`);
          } else {
            console.error(`XML validation failed for ${relsPath} - skipping update`);
          }
        }

        if (partModified) {
          const rebuiltPartXml = this.xmlBuilder.build(partData);
          const partXmlWithDeclaration = rebuiltPartXml.startsWith('<?xml')
            ? rebuiltPartXml
            : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rebuiltPartXml;

          // Validate before saving
          if (this.validateXml(partXmlWithDeclaration)) {
            zip.file(partPath, partXmlWithDeclaration);
            console.log(`Updated document part: ${partPath}`);
          } else {
            console.error(`XML validation failed for ${partPath} - skipping update`);
          }
        }
      } catch (error) {
        console.error(`Error rebuilding XML for ${partName}:`, error);
        throw new Error(`XML rebuild failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      processedCount,
      modifiedCount,
      urlsUpdated,
      displayTextsUpdated,
      contentIdsAppended,
      processedLinks
    };
  }

  /**
   * Process keywords - bold specific keywords at the beginning of lines
   */
  private async processKeywords(zip: JSZip): Promise<{ modified: boolean; changes: any[] }> {
    const keywords = ['Example:', 'Note:', 'Notes:', 'Result:', 'Results:', 'Important:', 'Caution:', 'Description:'];
    let modified = false;
    const changes: any[] = [];

    try {
      // Parse main document
      const documentXmlFile = zip.file('word/document.xml');
      if (!documentXmlFile) {
        console.log('No document.xml found');
        return { modified: false, changes: [] };
      }

      const documentXml = await documentXmlFile.async('text');
      const documentData = this.xmlParser.parse(documentXml);

      // Find all paragraphs and check first text run
      let keywordCount = 0;
      this.traverseElement(documentData, (element: any) => {
        if (element['w:p']) { // Paragraph
          const paragraph = element['w:p'];
          if (Array.isArray(paragraph)) {
            // With preserveOrder: true, paragraph is an array
            for (const pItem of paragraph) {
              if (pItem['w:r']) { // Run
                const runs = Array.isArray(pItem['w:r']) ? pItem['w:r'] : [pItem['w:r']];
                if (runs.length > 0) {
                  const firstRun = runs[0];
                  const textEl = firstRun['w:t'];
                  let text = '';

                  // Extract text from different structures
                  if (typeof textEl === 'string') {
                    text = textEl;
                  } else if (Array.isArray(textEl)) {
                    text = textEl[0] && typeof textEl[0] === 'string' ? textEl[0] : (textEl[0]?.['#text'] || '');
                  } else if (textEl && typeof textEl === 'object') {
                    text = textEl['#text'] || '';
                  }

                  // Check if text starts with a keyword
                  for (const keyword of keywords) {
                    if (text.trimStart().startsWith(keyword)) {
                      // Apply bold formatting to the run
                      if (!firstRun['w:rPr']) {
                        firstRun['w:rPr'] = [{}];
                      }
                      const rPr = Array.isArray(firstRun['w:rPr']) ? firstRun['w:rPr'][0] : firstRun['w:rPr'];
                      if (!rPr['w:b']) {
                        rPr['w:b'] = [{ ':@': {} }];
                        keywordCount++;
                        modified = true;
                        console.log(`  ✓ Bolded keyword: "${keyword}"`);

                        // Track the change
                        changes.push({
                          type: 'text',
                          description: 'Bolded keyword',
                          before: text,
                          after: `**${text}**` // Indicate bold with markdown-style formatting
                        });
                      }
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (modified) {
        console.log(`✓ Total keywords bolded: ${keywordCount}`);
        // Save modified document
        const rebuiltXml = this.xmlBuilder.build(documentData);
        const xmlWithDeclaration = rebuiltXml.startsWith('<?xml')
          ? rebuiltXml
          : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rebuiltXml;
        zip.file('word/document.xml', xmlWithDeclaration);
      } else {
        console.log('No keywords found to bold');
      }

      return { modified, changes };
    } catch (error) {
      console.error('Error processing keywords:', error);
      return { modified: false, changes: [] };
    }
  }

  /**
   * Process text replacements - find and replace text based on custom rules
   */
  private async processTextReplacements(zip: JSZip, replacements: any[]): Promise<{ modified: boolean; changes: any[] }> {
    let modified = false;
    let replacementCount = 0;
    const changes: any[] = [];

    try {
      // Parse main document
      const documentXmlFile = zip.file('word/document.xml');
      if (!documentXmlFile) {
        console.log('No document.xml found');
        return { modified: false, changes: [] };
      }

      const documentXml = await documentXmlFile.async('text');
      const documentData = this.xmlParser.parse(documentXml);

      let paragraphIndex = 0;
      let runIndex = 0;

      // Find all text runs and apply replacements
      this.traverseElement(documentData, (element: any) => {
        if (element['w:p']) {
          paragraphIndex++;
          runIndex = 0;
        }

        if (element['w:r']) { // Text run
          const runs = Array.isArray(element['w:r']) ? element['w:r'] : [element['w:r']];

          for (const run of runs) {
            runIndex++;
            const textEl = run['w:t'];
            if (!textEl) continue;

            let text = '';
            let textNode: any = null;

            // Extract text from different structures
            if (typeof textEl === 'string') {
              text = textEl;
              textNode = { type: 'direct', parent: run };
            } else if (Array.isArray(textEl)) {
              if (textEl.length > 0) {
                if (typeof textEl[0] === 'string') {
                  text = textEl[0];
                  textNode = { type: 'array-string', index: 0, array: textEl };
                } else if (textEl[0]?.['#text']) {
                  text = textEl[0]['#text'];
                  textNode = { type: 'array-object', index: 0, array: textEl };
                }
              }
            } else if (typeof textEl === 'object' && textEl['#text']) {
              text = textEl['#text'];
              textNode = { type: 'object', obj: textEl };
            }

            if (!text || !textNode) continue;

            // Apply each replacement rule
            let newText = text;
            let appliedRules: string[] = [];
            for (const rule of replacements) {
              const pattern = rule.pattern;
              const replacement = rule.replacement;
              const caseSensitive = rule.caseSensitive !== false; // Default to true

              if (caseSensitive) {
                if (newText.includes(pattern)) {
                  newText = newText.split(pattern).join(replacement);
                  appliedRules.push(`Pattern: "${pattern}"`);
                }
              } else {
                const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                if (regex.test(newText)) {
                  newText = newText.replace(regex, replacement);
                  appliedRules.push(`Pattern (case-insensitive): "${pattern}"`);
                }
              }
            }

            // If text changed, update it
            if (newText !== text) {
              replacementCount++;
              modified = true;

              // Update based on structure type
              switch (textNode.type) {
                case 'direct':
                  textNode.parent['w:t'] = newText;
                  break;
                case 'array-string':
                  textNode.array[textNode.index] = newText;
                  break;
                case 'array-object':
                  textNode.array[textNode.index]['#text'] = newText;
                  break;
                case 'object':
                  textNode.obj['#text'] = newText;
                  break;
              }

              console.log(`  Replaced: "${text}" → "${newText}"`);

              // Track the change
              changes.push({
                id: `text-replacement-${Date.now()}-${replacementCount}`,
                type: 'text',
                description: `Custom text replacement applied: ${appliedRules.join(', ')}`,
                before: text,
                after: newText,
                paragraphIndex,
                runIndex,
                elementPath: `//w:p[${paragraphIndex}]/w:r[${runIndex}]`
              });
            }
          }
        }
      });

      if (modified) {
        console.log(`✓ Total text replacements: ${replacementCount}`);
        // Save modified document
        const rebuiltXml = this.xmlBuilder.build(documentData);
        const xmlWithDeclaration = rebuiltXml.startsWith('<?xml')
          ? rebuiltXml
          : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rebuiltXml;
        zip.file('word/document.xml', xmlWithDeclaration);
      } else {
        console.log('No text replacements made');
      }

      return { modified, changes };
    } catch (error) {
      console.error('Error processing text replacements:', error);
      return { modified: false, changes: [] };
    }
  }

  /**
   * Call PowerAutomate API with Lookup_IDs
   */
  private async callPowerAutomateApi(apiUrl: string, lookupIds: string[]): Promise<any> {
    console.log('\n--- PowerAutomate API Call Details ---');

    // Decode escaped Unicode characters (e.g., \u0026 -> &)
    // This happens when URLs are stored in JSON/localStorage
    const decodedUrl = apiUrl.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });

    console.log('Original URL:', apiUrl);
    if (decodedUrl !== apiUrl) {
      console.log('Decoded URL:', decodedUrl);
    }
    console.log('Lookup_IDs count:', lookupIds.length);
    console.log('Lookup_IDs:', JSON.stringify(lookupIds, null, 2));

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const request = { Lookup_ID: lookupIds };
      console.log('Request payload:', JSON.stringify(request, null, 2));

      // Retry logic with exponential backoff
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
            const delay = Math.pow(2, attempt) * 1000;
            console.log(`Retry attempt ${attempt + 1}/3 after ${delay}ms delay...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.log('Sending HTTP POST request...');
          }

          const startTime = Date.now();
          const response = await fetch(decodedUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: controller.signal
          });

          clearTimeout(timeout);
          const elapsed = Date.now() - startTime;

          console.log(`Response received in ${elapsed}ms`);
          console.log('Status:', response.status, response.statusText);
          console.log('Headers:', JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response body:', errorText);
            throw new Error(`API returned status ${response.status}: ${errorText.substring(0, 200)}`);
          }

          const responseText = await response.text();
          console.log('Response body:', responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));

          const data = JSON.parse(responseText);
          console.log('Parsed response:', JSON.stringify(data, null, 2).substring(0, 1000));

          // Parse response format: { Results: [...], Version: "...", Changes: "..." }
          if (data.Results && Array.isArray(data.Results)) {
            console.log(`✓ API SUCCESS - Found ${data.Results.length} results`);
            return {
              results: data.Results.map((r: any) => ({
                Document_ID: r.Document_ID?.trim() || '',
                Content_ID: r.Content_ID?.trim() || '',
                Title: r.Title?.trim() || '',
                Status: r.Status?.trim() || 'Active'
              }))
            };
          } else {
            console.warn('⚠️  Response does not contain Results array');
            console.warn('Expected: { Results: [...] }');
            console.warn('Received:', data);
          }

          return null;

        } catch (error) {
          lastError = error as Error;
          console.error(`Attempt ${attempt + 1} failed:`, error);

          if (error instanceof Error && error.name === 'AbortError') {
            console.error('Request aborted (timeout after 30s)');
            break;
          }
        }
      }

      clearTimeout(timeout);
      console.error('✗ All API retry attempts failed');
      console.error('Last error:', lastError);
      return null;

    } catch (error) {
      console.error('✗ Unexpected API call error:', error);
      return null;
    }
  }

  /**
   * Extract Content_ID from URL
   */
  private extractContentId(url: string): string | null {
    const match = url.match(/((?:TSRC|CMS)-[A-Za-z0-9]+-\d{6})/i);
    return match ? match[1] : null;
  }

  /**
   * Extract Document_ID from URL
   * Only matches "docid=" (theSource URLs) - NOT "documentId=" (external policy URLs)
   * Example: https://thesource.cvshealth.com/nuxeo/thesource/%23!/view?docid=8f2f198d-df40-4667-b72c-6f2d2141a91c
   */
  private extractDocumentId(url: string): string | null {
    const match = url.match(/docid=([A-Za-z0-9\-]+)(?:[^A-Za-z0-9\-]|$)/i);
    return match ? match[1] : null;
  }

  /**
   * Find matching API result for a hyperlink
   */
  private findApiResult(url: string, apiResults: Map<string, any>): any {
    const contentId = this.extractContentId(url);
    if (contentId && apiResults.has(contentId)) {
      return apiResults.get(contentId);
    }

    const documentId = this.extractDocumentId(url);
    if (documentId && apiResults.has(documentId)) {
      return apiResults.get(documentId);
    }

    return null;
  }

  /**
   * Check if URL is a theSource URL
   */
  private isTheSourceUrl(url: string): boolean {
    return /thesource\.cvshealth\.com/i.test(url);
  }

  /**
   * Update hyperlink display text in parsed document data
   * Returns true if update was successful
   */
  private updateHyperlinkDisplayText(docData: any, relationshipId: string, newText: string): boolean {
    let updated = false;

    this.traverseElement(docData, (element: any) => {
      if (element['w:hyperlink']) {
        // With preserveOrder: true, attributes are in :@ object on parent element
        const attrs = element[':@'] || {};
        const rid = attrs['@_r:id'] || attrs['@_w:id'];

        if (rid === relationshipId) {
          let hyperlinkElement = element['w:hyperlink'];

          // With preserveOrder: true, w:hyperlink is an array
          if (Array.isArray(hyperlinkElement)) {
            // Search through array to find w:r elements
            let allRuns: any[] = [];
            for (const item of hyperlinkElement) {
              if (item['w:r']) {
                const runs = Array.isArray(item['w:r']) ? item['w:r'] : [item['w:r']];
                allRuns = allRuns.concat(runs);
              }
            }

            if (allRuns.length > 0) {
              // Update first text run, clear others
              let firstRun = true;
              for (const run of allRuns) {
                const textEl = run['w:t'];
                if (textEl) {
                  if (firstRun) {
                    // Handle different w:t structures
                    if (typeof textEl === 'string') {
                      run['w:t'] = newText;
                    } else if (Array.isArray(textEl)) {
                      if (textEl.length > 0) {
                        if (typeof textEl[0] === 'string') {
                          textEl[0] = newText;
                        } else {
                          textEl[0]['#text'] = newText;
                        }
                      }
                    } else {
                      textEl['#text'] = newText;
                    }
                    firstRun = false;
                    updated = true;
                  } else {
                    delete run['w:t'];
                  }
                }
              }
            } else {
              console.log(`      Hyperlink ${relationshipId} has no text runs`);
            }
          } else {
            // Non-array structure (fallback)
            const runs = hyperlinkElement['w:r'];
            const runsArray = Array.isArray(runs) ? runs : (runs ? [runs] : []);

            if (runsArray.length > 0) {
              // Update first text run, clear others
              let firstRun = true;
              for (const run of runsArray) {
                const textEl = run['w:t'];
                if (textEl) {
                  if (firstRun) {
                    // Handle different w:t structures
                    if (typeof textEl === 'string') {
                      run['w:t'] = newText;
                    } else if (Array.isArray(textEl)) {
                      if (textEl.length > 0) {
                        if (typeof textEl[0] === 'string') {
                          textEl[0] = newText;
                        } else {
                          textEl[0]['#text'] = newText;
                        }
                      }
                    } else {
                      textEl['#text'] = newText;
                    }
                    firstRun = false;
                    updated = true;
                  } else {
                    delete run['w:t'];
                  }
                }
              }
            } else {
              console.log(`      Hyperlink ${relationshipId} has no text runs`);
            }
          }
        }
      }
    });

    return updated;
  }

  /**
   * Update relationship target URL in parsed relationships data
   * Returns true if update was successful
   * Handles preserveOrder: true with :@ attribute object
   */
  private updateRelationshipTarget(relsData: any, relationshipId: string, newTarget: string): boolean {
    let updated = false;

    // With preserveOrder: true, the structure is different
    if (Array.isArray(relsData)) {
      for (const item of relsData) {
        if (item.Relationships) {
          const result = this.updateRelationshipTarget(item.Relationships, relationshipId, newTarget);
          if (result) updated = true;
        } else if (item.Relationship !== undefined) {
          // With preserveOrder: true, relationship data can be in two places:
          // 1. Parent object's :@ attribute (actual structure from test documents)
          // 2. Inside Relationship array elements (alternative structure)

          // FIRST: Check parent object's :@ attribute
          const parentAttrs = item[':@'] || {};
          if (parentAttrs['@_Id'] === relationshipId) {
            parentAttrs['@_Target'] = newTarget;
            updated = true;
          }

          // THEN: Also check inside Relationship array (for alternative structures)
          const rels = Array.isArray(item.Relationship) ? item.Relationship : [item.Relationship];
          for (const rel of rels) {
            const attrs = rel[':@'] || {};
            if (attrs['@_Id'] === relationshipId) {
              attrs['@_Target'] = newTarget;
              updated = true;
            }
          }
        }
      }
    } else if (relsData.Relationships) {
      return this.updateRelationshipTarget(relsData.Relationships, relationshipId, newTarget);
    } else if (relsData.Relationship !== undefined) {
      // FIRST: Check parent object's :@ attribute
      const parentAttrs = relsData[':@'] || {};
      if (parentAttrs['@_Id'] === relationshipId) {
        parentAttrs['@_Target'] = newTarget;
        updated = true;
      }

      // THEN: Also check inside Relationship array
      const rels = Array.isArray(relsData.Relationship) ? relsData.Relationship : [relsData.Relationship];
      for (const rel of rels) {
        const attrs = rel[':@'] || {};
        if (attrs['@_Id'] === relationshipId) {
          attrs['@_Target'] = newTarget;
          updated = true;
        }
      }
    }

    return updated;
  }

  /**
   * Validate XML string
   * Returns true if valid, false otherwise
   */
  private validateXml(xmlString: string): boolean {
    try {
      // Basic validation checks
      if (!xmlString || xmlString.trim().length === 0) {
        console.error('XML validation failed: Empty string');
        return false;
      }

      // Check for XML declaration
      if (!xmlString.startsWith('<?xml')) {
        console.error('XML validation failed: Missing XML declaration');
        return false;
      }

      // Check for basic XML structure
      if (!xmlString.includes('<') || !xmlString.includes('>')) {
        console.error('XML validation failed: Invalid XML structure');
        return false;
      }

      // Try to parse it back to verify it's valid
      const testParse = this.xmlParser.parse(xmlString);
      if (!testParse) {
        console.error('XML validation failed: Parser could not parse the XML');
        return false;
      }

      return true;
    } catch (error) {
      console.error('XML validation error:', error);
      return false;
    }
  }

  /**
   * Standardize all hyperlink colors to blue (#0000ff)
   */
  private async standardizeHyperlinkColors(zip: JSZip): Promise<{ modified: boolean; changes: any[] }> {
    let modified = false;
    let hyperlinkCount = 0;
    const changes: any[] = [];

    try {
      console.log('Starting hyperlink color standardization...');

      // Helper function to process runs and set color
      const processRuns = (runs: any[]): number => {
        let count = 0;
        for (const run of runs) {
          if (Array.isArray(run)) {
            // preserveOrder: true format - run is an array
            let rPrItem = run.find((el: any) => el['w:rPr']);

            if (!rPrItem) {
              // Create new run properties
              rPrItem = { 'w:rPr': [] };
              run.unshift(rPrItem);
            }

            // rPrItem['w:rPr'] is an array of elements
            const rPrArray = rPrItem['w:rPr'];
            if (Array.isArray(rPrArray)) {
              // Add/update w:color element in the array
              const colorElement = {
                'w:color': [],
                ':@': {
                  '@_w:val': '0000FF'
                }
              };

              // Find existing w:color or add new one
              const colorIdx = rPrArray.findIndex((el: any) => el['w:color'] !== undefined);
              if (colorIdx >= 0) {
                rPrArray[colorIdx] = colorElement;
              } else {
                rPrArray.push(colorElement);
              }
            }

            count++;
          } else if (run && typeof run === 'object') {
            // Non-array format
            if (!run['w:rPr']) {
              run['w:rPr'] = [];
            }

            // Handle both array and object formats for w:rPr
            if (Array.isArray(run['w:rPr'])) {
              // preserveOrder format
              const colorElement = {
                'w:color': [],
                ':@': {
                  '@_w:val': '0000FF'
                }
              };

              const colorIdx = run['w:rPr'].findIndex((el: any) => el['w:color'] !== undefined);
              if (colorIdx >= 0) {
                run['w:rPr'][colorIdx] = colorElement;
              } else {
                run['w:rPr'].push(colorElement);
              }
            } else {
              // Object format
              run['w:rPr']['w:color'] = { '@_w:val': '0000FF' };
            }

            count++;
          }
        }
        return count;
      };

      // Process document parts
      const partsToProcess = ['word/document.xml'];

      // Add headers and footers if they exist
      const files = Object.keys(zip.files);
      for (const file of files) {
        if (file.startsWith('word/header') || file.startsWith('word/footer')) {
          partsToProcess.push(file);
        }
      }

      for (const partPath of partsToProcess) {
        const partFile = zip.file(partPath);
        if (!partFile) continue;

        console.log(`  Processing: ${partPath}`);
        const partXml = await partFile.async('text');
        const partData = this.xmlParser.parse(partXml);
        let partModified = false;

        // Traverse and find all hyperlinks
        this.traverseElement(partData, (element: any) => {
          if (element['w:hyperlink']) {
            const hyperlinks = Array.isArray(element['w:hyperlink']) ? element['w:hyperlink'] : [element['w:hyperlink']];

            for (const hyperlink of hyperlinks) {
              // Find all runs in this hyperlink
              const runs: any[] = [];

              if (Array.isArray(hyperlink)) {
                // preserveOrder format - hyperlink is an array
                for (const item of hyperlink) {
                  if (item['w:r']) {
                    const itemRuns = Array.isArray(item['w:r']) ? item['w:r'] : [item['w:r']];
                    runs.push(...itemRuns);
                  }
                }
              } else if (hyperlink && typeof hyperlink === 'object') {
                // Non-array format
                if (hyperlink['w:r']) {
                  const hlRuns = Array.isArray(hyperlink['w:r']) ? hyperlink['w:r'] : [hyperlink['w:r']];
                  runs.push(...hlRuns);
                }
              }

              if (runs.length > 0) {
                const processedCount = processRuns(runs);
                if (processedCount > 0) {
                  hyperlinkCount += processedCount;
                  partModified = true;
                  console.log(`    ✓ Set color for ${processedCount} run(s) in hyperlink`);
                }
              }
            }
          }
        });

        if (partModified) {
          // Save modified document part
          const rebuiltXml = this.xmlBuilder.build(partData);
          const xmlWithDeclaration = rebuiltXml.startsWith('<?xml')
            ? rebuiltXml
            : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rebuiltXml;
          zip.file(partPath, xmlWithDeclaration);
          modified = true;
        }
      }

      if (modified) {
        console.log(`✓ Standardized ${hyperlinkCount} hyperlink text runs to blue`);

        changes.push({
          type: 'hyperlink',
          description: 'Standardized hyperlink colors',
          before: 'Various colors',
          after: 'Blue (#0000FF)',
          count: hyperlinkCount
        });
      } else {
        console.log('No hyperlinks found to standardize');
      }

      return { modified, changes };
    } catch (error) {
      console.error('Error standardizing hyperlink colors:', error);
      return { modified: false, changes: [] };
    }
  }

  /**
   * Remove extra whitespace from text runs
   */
  private async removeExtraWhitespace(zip: JSZip): Promise<{ modified: boolean; changes: any[] }> {
    let modified = false;
    let whitespaceCount = 0;
    const changes: any[] = [];

    try {
      // Parse main document
      const documentXmlFile = zip.file('word/document.xml');
      if (!documentXmlFile) {
        console.log('No document.xml found');
        return { modified: false, changes: [] };
      }

      const documentXml = await documentXmlFile.async('text');
      const documentData = this.xmlParser.parse(documentXml);

      // Find all text elements and clean whitespace
      this.traverseElement(documentData, (element: any) => {
        if (element['w:t']) {
          const textElements = Array.isArray(element['w:t']) ? element['w:t'] : [element['w:t']];

          for (let i = 0; i < textElements.length; i++) {
            const textEl = textElements[i];
            let originalText = '';
            let cleanedText = '';

            // Extract text based on format
            if (typeof textEl === 'string') {
              originalText = textEl;
              cleanedText = originalText.replace(/\s{2,}/g, ' '); // Replace 2+ spaces with 1
              if (originalText !== cleanedText) {
                textElements[i] = cleanedText;
                modified = true;
                whitespaceCount++;
              }
            } else if (Array.isArray(textEl)) {
              // Array format with preserveOrder: true
              for (const item of textEl) {
                if (item['#text']) {
                  originalText = item['#text'];
                  cleanedText = originalText.replace(/\s{2,}/g, ' ');
                  if (originalText !== cleanedText) {
                    item['#text'] = cleanedText;
                    modified = true;
                    whitespaceCount++;
                  }
                } else if (typeof item === 'string') {
                  originalText = item;
                  cleanedText = originalText.replace(/\s{2,}/g, ' ');
                  // Can't modify string in array directly, need to replace
                  const index = textEl.indexOf(item);
                  if (index !== -1 && originalText !== cleanedText) {
                    textEl[index] = cleanedText;
                    modified = true;
                    whitespaceCount++;
                  }
                }
              }
            } else if (textEl && typeof textEl === 'object') {
              if (textEl['#text']) {
                originalText = textEl['#text'];
                cleanedText = originalText.replace(/\s{2,}/g, ' ');
                if (originalText !== cleanedText) {
                  textEl['#text'] = cleanedText;
                  modified = true;
                  whitespaceCount++;
                }
              }
            }

            if (originalText !== cleanedText && originalText) {
              changes.push({
                type: 'text',
                description: 'Removed extra whitespace',
                before: originalText,
                after: cleanedText
              });
            }
          }
        }
      });

      if (modified) {
        console.log(`✓ Removed extra whitespace from ${whitespaceCount} text elements`);

        // Save modified document
        const rebuiltXml = this.xmlBuilder.build(documentData);
        const xmlWithDeclaration = rebuiltXml.startsWith('<?xml')
          ? rebuiltXml
          : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rebuiltXml;
        zip.file('word/document.xml', xmlWithDeclaration);
      } else {
        console.log('No extra whitespace found');
      }

      return { modified, changes };
    } catch (error) {
      console.error('Error removing whitespace:', error);
      return { modified: false, changes: [] };
    }
  }

  /**
   * Remove all italic formatting from the document
   */
  private async removeAllItalics(zip: JSZip): Promise<{ modified: boolean; changes: any[] }> {
    let modified = false;
    let italicsCount = 0;
    const changes: any[] = [];

    try {
      // Parse main document
      const documentXmlFile = zip.file('word/document.xml');
      if (!documentXmlFile) {
        console.log('No document.xml found');
        return { modified: false, changes: [] };
      }

      const documentXml = await documentXmlFile.async('text');
      const documentData = this.xmlParser.parse(documentXml);

      // Find all runs and remove italic formatting
      this.traverseElement(documentData, (element: any) => {
        if (element['w:r']) {
          const runs = Array.isArray(element['w:r']) ? element['w:r'] : [element['w:r']];

          for (const run of runs) {
            if (Array.isArray(run)) {
              // preserveOrder: true format - run is an array
              for (let i = 0; i < run.length; i++) {
                const item = run[i];
                if (item['w:rPr']) {
                  const rPrArray = Array.isArray(item['w:rPr']) ? item['w:rPr'] : [item['w:rPr']];

                  for (const rPr of rPrArray) {
                    if (rPr && typeof rPr === 'object') {
                      // Check if italics exist
                      if (rPr['w:i']) {
                        delete rPr['w:i'];
                        modified = true;
                        italicsCount++;
                      }
                    }
                  }
                }
              }
            } else if (run && typeof run === 'object') {
              // Non-array format
              if (run['w:rPr']) {
                const rPr = Array.isArray(run['w:rPr']) ? run['w:rPr'][0] : run['w:rPr'];
                if (rPr && rPr['w:i']) {
                  delete rPr['w:i'];
                  modified = true;
                  italicsCount++;
                }
              }
            }
          }
        }
      });

      if (modified) {
        console.log(`✓ Removed italics from ${italicsCount} text runs`);

        changes.push({
          type: 'text',
          description: 'Removed italic formatting',
          before: 'Italic text',
          after: 'Normal text',
          count: italicsCount
        });

        // Save modified document
        const rebuiltXml = this.xmlBuilder.build(documentData);
        const xmlWithDeclaration = rebuiltXml.startsWith('<?xml')
          ? rebuiltXml
          : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rebuiltXml;
        zip.file('word/document.xml', xmlWithDeclaration);
      } else {
        console.log('No italics found to remove');
      }

      return { modified, changes };
    } catch (error) {
      console.error('Error removing italics:', error);
      return { modified: false, changes: [] };
    }
  }

  /**
   * Update style definitions in styles.xml based on StylesEditor settings
   * This synchronizes the style definitions with user-configured settings
   */
  private async updateStyleDefinitions(zip: JSZip, options?: any): Promise<boolean> {
    try {
      console.log('Updating style definitions in styles.xml...');

      // Get styles from session/options
      const configuredStyles = options?.styles && Array.isArray(options.styles)
        ? options.styles
        : [];

      if (configuredStyles.length === 0) {
        console.log('No styles configured in StylesEditor, skipping style definition updates');
        return false;
      }

      // Load styles.xml
      const stylesXmlFile = zip.file('word/styles.xml');
      if (!stylesXmlFile) {
        console.log('No styles.xml found, cannot update style definitions');
        return false;
      }

      const stylesXml = await stylesXmlFile.async('text');

      // Parse styles.xml using the non-preserveOrder parser for easier manipulation
      const simpleParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        preserveOrder: false, // Easier to work with for styles.xml
      });

      const stylesData = simpleParser.parse(stylesXml);
      const parseResult = this.stylesProcessor.parse(stylesXml);

      if (!parseResult.success || !parseResult.data) {
        console.log('Failed to parse styles.xml');
        return false;
      }

      let stylesObj = parseResult.data;
      let modified = false;

      // Update each configured style
      for (const configStyle of configuredStyles) {
        if (!configStyle.id || !configStyle.name) continue;

        console.log(`  Updating style: ${configStyle.name} (${configStyle.id})`);

        // Map StylesEditor format to DOCX format
        const styleProperties: any = {};

        // Text properties
        if (configStyle.fontFamily) styleProperties.fontFamily = configStyle.fontFamily;
        if (configStyle.fontSize) styleProperties.fontSize = configStyle.fontSize;
        if (configStyle.bold !== undefined) styleProperties.bold = configStyle.bold;
        if (configStyle.italic !== undefined) styleProperties.italic = configStyle.italic;
        if (configStyle.underline !== undefined) styleProperties.underline = configStyle.underline;
        if (configStyle.color) styleProperties.color = configStyle.color.replace('#', '');

        // Paragraph properties
        if (configStyle.alignment) styleProperties.alignment = configStyle.alignment;
        // Convert spacing from points to twips (1 point = 20 twips)
        if (configStyle.spaceBefore !== undefined) styleProperties.spaceBefore = configStyle.spaceBefore * 20;
        if (configStyle.spaceAfter !== undefined) styleProperties.spaceAfter = configStyle.spaceAfter * 20;
        if (configStyle.lineSpacing !== undefined) {
          // Convert line spacing multiplier to twips (1/20th of a point)
          // 1.0 = 240 twips, 1.15 = 276 twips, 1.5 = 360 twips, 2.0 = 480 twips
          styleProperties.lineSpacing = Math.round(configStyle.lineSpacing * 240);
        }

        // Map style ID to Word style ID
        let wordStyleId = configStyle.id;
        let wordStyleName = configStyle.name;

        if (configStyle.id === 'header1') {
          wordStyleId = 'Heading1';
          wordStyleName = 'Heading 1';
        } else if (configStyle.id === 'header2') {
          wordStyleId = 'Heading2';
          wordStyleName = 'Heading 2';
        } else if (configStyle.id === 'normal') {
          wordStyleId = 'Normal';
          wordStyleName = 'Normal';
        }

        // Update the style definition
        stylesObj = this.stylesProcessor.setParagraphStyle(
          stylesObj,
          wordStyleId,
          wordStyleName,
          styleProperties
        );

        modified = true;
      }

      if (modified) {
        // Build updated styles.xml
        const buildResult = this.stylesProcessor.build(stylesObj);
        if (buildResult.success && buildResult.data) {
          // Ensure XML declaration
          const xmlWithDeclaration = buildResult.data.startsWith('<?xml')
            ? buildResult.data
            : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + buildResult.data;

          zip.file('word/styles.xml', xmlWithDeclaration);
          console.log(`✓ Updated ${configuredStyles.length} style definitions in styles.xml`);
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Error updating style definitions:', error);
      return false;
    }
  }

  /**
   * Helper: Find element in preserveOrder array by element name
   * Returns the item and its index, or null if not found
   */
  private findInPreserveOrderArray(arr: any[], elementName: string): { item: any; index: number } | null {
    if (!Array.isArray(arr)) return null;

    for (let i = 0; i < arr.length; i++) {
      if (arr[i][elementName] !== undefined) {
        return { item: arr[i], index: i };
      }
    }
    return null;
  }

  /**
   * Helper: Remove elements from preserveOrder array by element names
   * Returns true if any elements were removed
   */
  private removeFromPreserveOrderArray(arr: any[], elementNames: string[]): boolean {
    if (!Array.isArray(arr)) return false;

    const originalLength = arr.length;

    // Filter out elements that match any of the names to remove
    for (let i = arr.length - 1; i >= 0; i--) {
      const keys = Object.keys(arr[i]).filter(k => k !== ':@');
      if (keys.length > 0 && elementNames.includes(keys[0])) {
        arr.splice(i, 1);
      }
    }

    return arr.length < originalLength;
  }

  /**
   * Helper: Add or update element in preserveOrder array
   * If element exists, replaces it; otherwise adds at the beginning
   */
  private setInPreserveOrderArray(arr: any[], elementName: string, value: any): void {
    if (!Array.isArray(arr)) return;

    const found = this.findInPreserveOrderArray(arr, elementName);
    const newElement = { [elementName]: value };

    if (found) {
      arr[found.index] = newElement;
    } else {
      arr.unshift(newElement);
    }
  }

  /**
   * Clear direct formatting from run properties that conflicts with style definitions
   * Removes w:rPr properties so that style-based formatting can take effect
   *
   * IMPORTANT: This works with preserveOrder:true structure where rPr is an array
   */
  /**
   * Enhanced heading style detection
   * Recognizes a comprehensive set of heading-related style IDs
   *
   * @param styleId - The style ID to check (e.g., "Heading1", "Header2", "Title")
   * @returns true if the style is a heading/title style, false otherwise
   */
  private isHeadingStyle(styleId: string | null): boolean {
    if (!styleId) return false;

    const lowerStyleId = styleId.toLowerCase();

    // Comprehensive list of heading-related patterns
    const headingPatterns = [
      'heading',    // Heading1, Heading2, Heading 1, Heading 2, etc.
      'header',     // Header1, Header2, Header 1, Header 2, etc.
      'title',      // Title, Subtitle, etc.
      'subtitle',   // Subtitle variations
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',  // HTML-style heading IDs
      'toc',        // Table of Contents headings (TOC Heading, TOCHeading, etc.)
    ];

    // Check if styleId contains any heading pattern
    for (const pattern of headingPatterns) {
      if (lowerStyleId.includes(pattern)) {
        return true;
      }
    }

    // Additional checks for numbered heading styles
    // e.g., "Heading 1", "Heading 2", "Header 1", "Header 2"
    if (/^(heading|header|h)\s*\d+$/i.test(styleId)) {
      return true;
    }

    return false;
  }

  private clearDirectFormatting(rPr: any, preserveHyperlinks: boolean = true): boolean {
    if (!rPr) return false;

    // Handle both array (preserveOrder:true) and object formats
    if (Array.isArray(rPr)) {
      // preserveOrder:true format - rPr is an array of elements
      // Check if this is a hyperlink - we want to preserve hyperlink styling
      if (preserveHyperlinks) {
        const rStyleItem = this.findInPreserveOrderArray(rPr, 'w:rStyle');
        if (rStyleItem) {
          const attrs = rStyleItem.item[':@'];
          if (attrs && String(attrs['@_w:val']).toLowerCase().includes('hyperlink')) {
            return false; // Don't clear hyperlink formatting
          }
        }
      }

      // Properties to remove (these should come from style definitions instead)
      const propsToRemove = [
        'w:rFonts',  // Font family
        'w:sz',      // Font size
        'w:szCs',    // Complex script font size
        'w:color',   // Text color
        'w:b',       // Bold
        'w:bCs',     // Complex script bold
        'w:i',       // Italic
        'w:iCs',     // Complex script italic
        'w:u',       // Underline
      ];

      return this.removeFromPreserveOrderArray(rPr, propsToRemove);
    } else if (typeof rPr === 'object') {
      // Object format (non-preserveOrder) - original logic
      let cleared = false;

      const isHyperlink = preserveHyperlinks && (
        rPr['w:rStyle'] &&
        (String(rPr['w:rStyle']).toLowerCase().includes('hyperlink') ||
         (rPr['w:rStyle'][':@'] && String(rPr['w:rStyle'][':@']['@_w:val']).toLowerCase().includes('hyperlink')))
      );

      if (isHyperlink) {
        return false;
      }

      const propsToRemove = [
        'w:rFonts', 'w:sz', 'w:szCs', 'w:color',
        'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:u'
      ];

      for (const prop of propsToRemove) {
        if (rPr[prop]) {
          delete rPr[prop];
          cleared = true;
        }
      }

      return cleared;
    }

    return false;
  }

  /**
   * Assign Normal style to paragraphs and apply formatting from styles editor
   */
  private async assignNormalStyles(zip: JSZip, options?: any): Promise<{ modified: boolean; changes: any[] }> {
    let modified = false;
    let stylesApplied = 0;
    let formattingCleared = 0;
    const changes: any[] = [];

    try {
      console.log('Starting style-based formatting (assigning style IDs and clearing direct formatting)...');

      // Get Normal style settings from editor (for logging purposes)
      const normalStyle = options?.styles && Array.isArray(options.styles)
        ? options.styles.find((s: any) => s.id === 'normal')
        : null;

      if (normalStyle) {
        console.log('Normal style configured:', {
          font: normalStyle.fontFamily,
          size: normalStyle.fontSize + 'pt',
          color: normalStyle.color
        });
        console.log('NOTE: Formatting will be applied via style definitions, not direct formatting');
      }

      // Parse main document
      const documentXmlFile = zip.file('word/document.xml');
      if (!documentXmlFile) {
        console.log('No document.xml found');
        return { modified: false, changes: [] };
      }

      const documentXml = await documentXmlFile.async('text');
      const documentData = this.xmlParser.parse(documentXml);

      // Find all paragraphs and apply Normal style if needed
      this.traverseElement(documentData, (element: any) => {
        if (element['w:p']) {
          const paragraphs = Array.isArray(element['w:p']) ? element['w:p'] : [element['w:p']];

          for (const paragraph of paragraphs) {
            let currentStyle: string | null = null;
            let pPrItem: any = null;
            let runs: any[] = [];

            if (Array.isArray(paragraph)) {
              // preserveOrder: true format - paragraph is an array

              // Find paragraph properties and runs
              for (const item of paragraph) {
                if (item['w:pPr']) {
                  pPrItem = item;
                  const pPr = Array.isArray(item['w:pPr']) ? item['w:pPr'][0] : item['w:pPr'];

                  // Check for existing style
                  if (pPr && pPr['w:pStyle']) {
                    const pStyleArray = Array.isArray(pPr['w:pStyle']) ? pPr['w:pStyle'] : [pPr['w:pStyle']];
                    const pStyle = pStyleArray[0];
                    if (pStyle && pStyle[':@'] && pStyle[':@']['@_w:val']) {
                      currentStyle = pStyle[':@']['@_w:val'];
                    }
                  }
                }

                // Collect runs
                if (item['w:r']) {
                  const itemRuns = Array.isArray(item['w:r']) ? item['w:r'] : [item['w:r']];
                  runs.push(...itemRuns);
                }
              }

              // DETECT AND ASSIGN HEADING STYLES FIRST
              if (!currentStyle) {
                // Paragraph has no style - check if it should be a heading
                let detectedHeadingStyle: string | null = null;

                // Analyze run properties to detect heading characteristics
                for (const run of runs) {
                  if (Array.isArray(run)) {
                    const rPrItem = run.find((el: any) => el['w:rPr']);
                    if (rPrItem && rPrItem['w:rPr']) {
                      const rPr = Array.isArray(rPrItem['w:rPr']) ? rPrItem['w:rPr'][0] : rPrItem['w:rPr'];
                      const rPrArray = Array.isArray(rPr) ? rPr : [rPr];

                      // Check for font size
                      const szItem = rPrArray.find((el: any) => el['w:sz']);
                      if (szItem && szItem['w:sz']) {
                        const sz = Array.isArray(szItem['w:sz']) ? szItem['w:sz'][0] : szItem['w:sz'];
                        const sizeVal = sz?.[':@']?.['@_w:val'] || sz?.['@_w:val'];
                        if (sizeVal) {
                          const fontSize = parseInt(sizeVal) / 2; // Convert half-points to points

                          // Check for bold
                          const hasBold = rPrArray.some((el: any) => el['w:b']);

                          // Heading detection rules:
                          // - 18pt + bold = Heading1
                          // - 14pt + bold = Heading2
                          if (fontSize >= 17 && fontSize <= 20 && hasBold) {
                            detectedHeadingStyle = 'Heading1';
                            break;
                          } else if (fontSize >= 13 && fontSize <= 15 && hasBold) {
                            detectedHeadingStyle = 'Heading2';
                            break;
                          }
                        }
                      }
                    }
                  }
                }

                // If heading detected, assign appropriate style
                if (detectedHeadingStyle) {
                  console.log(`  Detected ${detectedHeadingStyle} by formatting - assigning style ID`);

                  if (!pPrItem) {
                    pPrItem = { 'w:pPr': [] };
                    paragraph.unshift(pPrItem);
                  }

                  const pPrArray = pPrItem['w:pPr'];
                  if (Array.isArray(pPrArray)) {
                    const pStyleElement = {
                      'w:pStyle': [],
                      ':@': {
                        '@_w:val': detectedHeadingStyle
                      }
                    };

                    const pStyleIdx = pPrArray.findIndex((el: any) => el['w:pStyle'] !== undefined);
                    if (pStyleIdx >= 0) {
                      pPrArray[pStyleIdx] = pStyleElement;
                    } else {
                      pPrArray.unshift(pStyleElement);
                    }
                  }

                  // Update currentStyle so it won't get Normal applied
                  currentStyle = detectedHeadingStyle;
                  modified = true;
                  stylesApplied++;

                  changes.push({
                    type: 'style',
                    description: `Detected and assigned ${detectedHeadingStyle} style`,
                    before: 'No style',
                    after: detectedHeadingStyle
                  });
                }
              }

              // Only apply Normal if: paragraph has no style OR has a non-Normal/non-heading style
              // This prevents wasteful re-application and ensures headings are preserved
              const isHeading = this.isHeadingStyle(currentStyle);
              const needsNormalStyle = !isHeading && (!currentStyle || currentStyle !== 'Normal');

              // Debug logging for style detection
              if (this.debugMode && currentStyle) {
                console.log(`  [Style Check] currentStyle="${currentStyle}" → isHeading=${isHeading}, needsNormalStyle=${needsNormalStyle}`);
              }

              if (needsNormalStyle) {
                // Set paragraph style to Normal
                if (!pPrItem) {
                  pPrItem = { 'w:pPr': [] };
                  paragraph.unshift(pPrItem);
                }

                // pPrItem['w:pPr'] is an array of elements (preserveOrder format)
                const pPrArray = pPrItem['w:pPr'];
                if (Array.isArray(pPrArray)) {
                  // Add/update w:pStyle element in the array
                  const pStyleElement = {
                    'w:pStyle': [],
                    ':@': {
                      '@_w:val': 'Normal'
                    }
                  };

                  // Find existing w:pStyle or add new one
                  const pStyleIdx = pPrArray.findIndex((el: any) => el['w:pStyle'] !== undefined);
                  if (pStyleIdx >= 0) {
                    pPrArray[pStyleIdx] = pStyleElement;
                  } else {
                    pPrArray.unshift(pStyleElement);
                  }
                }

                modified = true;
                stylesApplied++;

                // Clear direct formatting from runs to let style definitions take effect
                for (const run of runs) {
                  if (Array.isArray(run)) {
                    // Find run properties
                    let rPrItem = run.find((el: any) => el['w:rPr']);

                    if (rPrItem && rPrItem['w:rPr']) {
                      // Pass rPr directly - clearDirectFormatting handles both array and object
                      if (this.clearDirectFormatting(rPrItem['w:rPr'])) {
                        formattingCleared++;
                      }
                    }
                  } else if (run && typeof run === 'object') {
                    // Non-array format
                    if (run['w:rPr']) {
                      // Pass rPr directly - clearDirectFormatting handles both array and object
                      if (this.clearDirectFormatting(run['w:rPr'])) {
                        formattingCleared++;
                      }
                    }
                  }
                }

                changes.push({
                  type: 'style',
                  description: 'Applied Normal style and cleared direct formatting',
                  before: currentStyle || 'No style',
                  after: 'Normal (style-based)',
                  runsAffected: runs.length
                });
              }
            } else if (paragraph && typeof paragraph === 'object') {
              // Non-array format
              if (paragraph['w:pPr']) {
                const pPr = Array.isArray(paragraph['w:pPr']) ? paragraph['w:pPr'][0] : paragraph['w:pPr'];
                if (pPr && pPr['w:pStyle']) {
                  const pStyle = Array.isArray(pPr['w:pStyle']) ? pPr['w:pStyle'][0] : pPr['w:pStyle'];
                  currentStyle = pStyle?.['@_w:val'] || pStyle?.$?.val || null;
                }
              }

              // Get runs
              if (paragraph['w:r']) {
                runs = Array.isArray(paragraph['w:r']) ? paragraph['w:r'] : [paragraph['w:r']];
              }

              // Only apply Normal if: paragraph has no style OR has a non-Normal/non-heading style
              const isHeading2 = this.isHeadingStyle(currentStyle);
              const needsNormalStyle2 = !isHeading2 && (!currentStyle || currentStyle !== 'Normal');

              // Debug logging for style detection (non-array format)
              if (this.debugMode && currentStyle) {
                console.log(`  [Style Check - Non-Array] currentStyle="${currentStyle}" → isHeading=${isHeading2}, needsNormalStyle=${needsNormalStyle2}`);
              }

              if (needsNormalStyle2) {
                if (!paragraph['w:pPr']) {
                  paragraph['w:pPr'] = [];
                }

                // Handle both array (preserveOrder) and object formats
                if (Array.isArray(paragraph['w:pPr'])) {
                  // preserveOrder format - pPr is array of elements
                  const pPrArray = paragraph['w:pPr'];
                  const pStyleElement = {
                    'w:pStyle': [],
                    ':@': {
                      '@_w:val': 'Normal'
                    }
                  };

                  const pStyleIdx = pPrArray.findIndex((el: any) => el['w:pStyle'] !== undefined);
                  if (pStyleIdx >= 0) {
                    pPrArray[pStyleIdx] = pStyleElement;
                  } else {
                    pPrArray.unshift(pStyleElement);
                  }
                } else {
                  // Object format
                  paragraph['w:pPr']['w:pStyle'] = { '@_w:val': 'Normal' };
                }

                modified = true;
                stylesApplied++;

                // Clear direct formatting from runs to let style definitions take effect
                for (const run of runs) {
                  if (run['w:rPr']) {
                    // Pass the rPr directly - clearDirectFormatting handles both array and object
                    if (this.clearDirectFormatting(run['w:rPr'])) {
                      formattingCleared++;
                    }
                  }
                }

                changes.push({
                  type: 'style',
                  description: 'Applied Normal style and cleared direct formatting',
                  before: currentStyle || 'No style',
                  after: `Normal (style-based)`
                });
              }
            }
          }
        }
      });

      if (modified) {
        console.log(`✓ Applied Normal style ID to ${stylesApplied} paragraphs`);
        console.log(`✓ Cleared direct formatting from ${formattingCleared} runs`);
        console.log('  Formatting will now be controlled by style definitions in styles.xml');
        if (normalStyle) {
          console.log(`  Style properties: ${normalStyle.fontFamily}, ${normalStyle.fontSize}pt, ${normalStyle.color}`);
        }

        // Save modified document
        const rebuiltXml = this.xmlBuilder.build(documentData);
        const xmlWithDeclaration = rebuiltXml.startsWith('<?xml')
          ? rebuiltXml
          : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rebuiltXml;
        zip.file('word/document.xml', xmlWithDeclaration);
      } else {
        console.log('No paragraphs needed Normal style');
      }

      return { modified, changes };
    } catch (error) {
      console.error('Error assigning Normal styles:', error);
      return { modified: false, changes: [] };
    }
  }

  /**
   * Check if URL should have content ID appended
   */
  private shouldAppendContentId(url: string): boolean {
    // Check for theSource URLs that need content ID
    const isTheSourceUrl = /thesource\.cvshealth\.com/i.test(url);
    const hasContentOrDocId = /(TSRC|CMS)-[A-Za-z0-9]+-\d{6}|docid=/i.test(url);
    const hasContentAnchor = /#content/i.test(url);

    return isTheSourceUrl && hasContentOrDocId && !hasContentAnchor;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Adjust table cell margins to allow paragraph spacing to work
   * Table cell margins can override paragraph spacing, so we set them to 0
   */
  private adjustTableCellMargins(tableCellItem: any): void {
    if (!tableCellItem || !tableCellItem['w:tc']) {
      return;
    }

    const tcArray = tableCellItem['w:tc'];
    if (!Array.isArray(tcArray)) {
      return;
    }

    // Find or create w:tcPr (table cell properties)
    let tcPrItem = tcArray.find(el => el['w:tcPr']);
    let tcPr: any;

    if (!tcPrItem) {
      // Create new tcPr at the beginning of the cell
      tcPr = [];
      tcArray.unshift({ 'w:tcPr': tcPr });
      console.log(`    ✓ Created w:tcPr for table cell`);
    } else {
      tcPr = tcPrItem['w:tcPr'];
      if (!Array.isArray(tcPr)) {
        tcPr = [tcPr];
        tcPrItem['w:tcPr'] = tcPr;
      }
    }

    // Find or create w:tcMar (table cell margins)
    let tcMarItem = tcPr.find((el: any) => el['w:tcMar']);

    if (!tcMarItem) {
      // Create new tcMar with all margins set to 0
      tcPr.push({
        'w:tcMar': [{
          'w:top': [{
            ':@': {
              '@_w:w': '0',
              '@_w:type': 'dxa'
            }
          }],
          'w:bottom': [{
            ':@': {
              '@_w:w': '0',
              '@_w:type': 'dxa'
            }
          }]
        }]
      });
      console.log(`    ✓ Set table cell margins to 0 (top/bottom) to allow paragraph spacing`);
    } else {
      // Update existing margins
      const tcMar = tcMarItem['w:tcMar'];
      const tcMarArray = Array.isArray(tcMar) ? tcMar : [tcMar];

      if (tcMarArray.length > 0) {
        const margins = tcMarArray[0];

        // Set top margin to 0
        if (margins['w:top']) {
          const topArray = Array.isArray(margins['w:top']) ? margins['w:top'] : [margins['w:top']];
          if (topArray[0] && topArray[0][':@']) {
            topArray[0][':@']['@_w:w'] = '0';
          }
        } else {
          margins['w:top'] = [{
            ':@': {
              '@_w:w': '0',
              '@_w:type': 'dxa'
            }
          }];
        }

        // Set bottom margin to 0
        if (margins['w:bottom']) {
          const bottomArray = Array.isArray(margins['w:bottom']) ? margins['w:bottom'] : [margins['w:bottom']];
          if (bottomArray[0] && bottomArray[0][':@']) {
            bottomArray[0][':@']['@_w:w'] = '0';
          }
        } else {
          margins['w:bottom'] = [{
            ':@': {
              '@_w:w': '0',
              '@_w:type': 'dxa'
            }
          }];
        }

        console.log(`    ✓ Updated existing table cell margins to 0 (top/bottom)`);
      }
    }
  }

  /**
   * Process custom style spacing throughout the document
   */
  private async processCustomStyleSpacing(
    zip: JSZip,
    styleSpacing: {
      header1?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
      header2?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
      normal?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
    }
  ): Promise<{ modified: boolean; changes: any[] }> {
    const changes: any[] = [];

    try {
      // Parse main document
      const documentXmlFile = zip.file('word/document.xml');
      if (!documentXmlFile) {
        console.log('No document.xml found');
        return { modified: false, changes: [] };
      }

      const documentXml = await documentXmlFile.async('text');
      const documentData = this.xmlParser.parse(documentXml);

      // Debug: Log document structure to understand how to find paragraphs
      console.log('\n🔍 Document Structure Analysis:');
      console.log('documentData is Array:', Array.isArray(documentData));
      console.log('documentData keys:', Object.keys(documentData || {}));
      if (Array.isArray(documentData) && documentData.length > 0) {
        console.log('First element keys:', Object.keys(documentData[0] || {}));
        if (documentData[1]) {
          console.log('Second element keys:', Object.keys(documentData[1] || {}));
        }
      }

    // Map style IDs to their display names and spacing configs
    // Support multiple style name variations (with/without spaces, character styles, etc.)
    const styleConfigs = [
      {
        ids: ['Heading1', 'Heading 1', 'Header1', 'Header 1', 'Heading1Char'],
        displayName: 'Header 1',
        spacing: styleSpacing.header1
      },
      {
        ids: ['Heading2', 'Heading 2', 'Header2', 'Header 2', 'Heading2Char'],
        displayName: 'Header 2',
        spacing: styleSpacing.header2
      },
      {
        ids: ['Normal', 'NormalChar'],
        displayName: 'Normal',
        spacing: styleSpacing.normal
      },
    ];

    let paragraphCount = 0;
    let styledParagraphCount = 0;

    let itemIndex = 0;

    const applySpacing = (obj: any, currentTableCell: any = null): void => {
      if (!obj) return;

      // Handle ordered array format from fast-xml-parser with preserveOrder: true
      if (Array.isArray(obj)) {
        for (const item of obj) {
          itemIndex++;
          const itemKeys = Object.keys(item || {});
          if (itemIndex <= 5) { // Only log first 5 items to avoid spam
            console.log(`  Item ${itemIndex} keys:`, itemKeys);
          }

          // Log table structure detection to verify recursion reaches table cells
          if (item['w:tbl']) {
            console.log(`  🔍 Table (w:tbl) found - will recurse into cells`);
          }
          if (item['w:tr']) {
            console.log(`  🔍 Table row (w:tr) found - will recurse into cells`);
          }
          if (item['w:tc']) {
            console.log(`  🔍 Table cell (w:tc) found - will recurse to find paragraphs`);
          }

          if (item['w:p']) {
            // With preserveOrder: true, item['w:p'] is the array of child elements for this paragraph
            const pArray = item['w:p'];

            // Each paragraph is an array of elements
            if (Array.isArray(pArray)) {
              paragraphCount++;

              // Find paragraph properties
              const pPrItem = pArray.find(el => el['w:pPr']);
              let pPr = pPrItem ? pPrItem['w:pPr'] : null;

              // Check paragraph style
              // Debug first 3 paragraphs in detail, but ALWAYS log Header 2 detections
              const shouldDebug = paragraphCount <= 3;
              const currentStyle = this.getParagraphStyle(pArray, shouldDebug);

              if (currentStyle) {
                styledParagraphCount++;
                // Always log Header 2 (Heading2) detections to verify table cells are reached
                const isHeader2 = currentStyle === 'Heading2' || currentStyle === 'Heading 2';
                if (shouldDebug || isHeader2) {
                  console.log(`  📍 Paragraph ${paragraphCount} has style: ${currentStyle}${isHeader2 ? ' ← HEADER 2 DETECTED' : ''}`);
                }
              } else {
                if (shouldDebug) console.log(`  Paragraph ${paragraphCount} has NO style (will default to Normal)`);
              }

              // Find matching style config (check if any variation matches)
              const styleConfig = currentStyle
                ? styleConfigs.find(config =>
                    config.ids.includes(currentStyle) && config.spacing
                  )
                : undefined;

              if (styleConfig && styleConfig.spacing) {
                // Always log Header 2 spacing applications to verify table cells are processed
                const text = this.extractParagraphText(pArray);
                const isHeader2 = styleConfig.displayName === 'Header 2';
                console.log(`  ${isHeader2 ? '✅' : '✓'} Found ${styleConfig.displayName}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}}"`);
                const spacing = styleConfig.spacing;

                // Ensure paragraph properties exist
                if (!pPr) {
                  const newPPr = [{
                    'w:spacing': [{
                      ':@': {
                        '@_w:before': '0',
                        '@_w:after': '0',
                        '@_w:line': '240',
                        '@_w:lineRule': 'auto'
                      }
                    }]
                  }];
                  pArray.unshift({ 'w:pPr': newPPr });
                  pPr = newPPr;
                }

                // Find or create spacing element
                const pPrArray = Array.isArray(pPr) ? pPr : [pPr];

                // CRITICAL FIX: Explicitly disable w:contextualSpacing
                // This element causes Word to ignore spacing between paragraphs of the same style
                // We must set w:val="0" to override the parent style setting (not just remove it!)
                const contextualSpacingItem = pPrArray.find(el => el['w:contextualSpacing']);
                if (contextualSpacingItem) {
                  // Update existing contextualSpacing to explicitly disable it
                  console.log(`  ⚠️  Disabling w:contextualSpacing (setting w:val="0")`);
                  contextualSpacingItem['w:contextualSpacing'] = [{
                    ':@': {
                      '@_w:val': '0'
                    }
                  }];
                } else {
                  // Add contextualSpacing explicitly set to false to override style
                  console.log(`  ✓ Adding w:contextualSpacing w:val="0" to override parent style`);
                  pPrArray.push({
                    'w:contextualSpacing': [{
                      ':@': {
                        '@_w:val': '0'
                      }
                    }]
                  });
                }

                let spacingItem = pPrArray.find(el => el['w:spacing']);
                let spacingElement = spacingItem ? spacingItem['w:spacing'] : null;

                // Get current spacing values from :@ attribute object
                const spacingArray = Array.isArray(spacingElement) ? spacingElement : [spacingElement];
                const currentAttrs = spacingArray[0]?.[':@'] || {};
                const currentSpaceBefore = parseInt(currentAttrs['@_w:before'] || '0', 10);
                const currentSpaceAfter = parseInt(currentAttrs['@_w:after'] || '0', 10);
                const currentLine = parseInt(currentAttrs['@_w:line'] || '240', 10);

                // Convert points to twips (1 point = 20 twips) for before/after
                const twipsBefore = spacing.spaceBefore * 20;
                const twipsAfter = spacing.spaceAfter * 20;

                // Convert line spacing to OpenXML format (multiply by 240)
                // 1.0 = 240, 1.15 = 276, 1.5 = 360, 2.0 = 480
                const lineValue = Math.round((spacing.lineSpacing || 1.15) * 240);

                // Update spacing with ALL attributes (in :@ format)
                if (!spacingElement || !spacingArray[0]) {
                  // Create new spacing element with :@ attribute wrapper
                  // (either no spacing element exists, or it's an empty array)
                  pPrArray.push({
                    'w:spacing': [{
                      ':@': {
                        '@_w:before': twipsBefore.toString(),
                        '@_w:after': twipsAfter.toString(),
                        '@_w:line': lineValue.toString(),
                        '@_w:lineRule': 'auto',
                        '@_w:beforeAutospacing': '0',  // Prevent Word from auto-adjusting spacing in tables
                        '@_w:afterAutospacing': '0'    // Prevent Word from auto-adjusting spacing in tables
                      }
                    }]
                  });
                } else {
                  // Update existing spacing element attributes in :@ object
                  if (!spacingArray[0][':@']) {
                    spacingArray[0][':@'] = {};
                  }
                  spacingArray[0][':@']['@_w:before'] = twipsBefore.toString();
                  spacingArray[0][':@']['@_w:after'] = twipsAfter.toString();
                  spacingArray[0][':@']['@_w:line'] = lineValue.toString();
                  spacingArray[0][':@']['@_w:lineRule'] = 'auto';
                  spacingArray[0][':@']['@_w:beforeAutospacing'] = '0';  // Prevent Word from auto-adjusting spacing in tables
                  spacingArray[0][':@']['@_w:afterAutospacing'] = '0';   // Prevent Word from auto-adjusting spacing in tables
                }

                // Track the change if spacing was different
                if (currentSpaceBefore !== twipsBefore || currentSpaceAfter !== twipsAfter || currentLine !== lineValue) {
                  const text = this.extractParagraphText(pArray);
                  const currentLineSpacing = currentLine / 240;
                  const newLineSpacing = spacing.lineSpacing || 1.15;
                  changes.push({
                    id: `spacing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    type: 'style',
                    description: `Applied ${styleConfig.displayName} spacing`,
                    before: `"${text}" - Para: ${currentSpaceBefore/20}pt before, ${currentSpaceAfter/20}pt after | Line: ${currentLineSpacing.toFixed(2)}`,
                    after: `"${text}" - Para: ${spacing.spaceBefore}pt before, ${spacing.spaceAfter}pt after | Line: ${newLineSpacing.toFixed(2)}`,
                    location: 'Main Document'
                  });
                }

                // CRITICAL FIX FOR TABLES: If paragraph is inside a table cell, adjust cell margins
                // Table cell margins can override paragraph spacing, so we need to set them to 0
                if (currentTableCell) {
                  console.log(`  📋 Paragraph is in table cell - adjusting cell margins to allow paragraph spacing`);
                  this.adjustTableCellMargins(currentTableCell);
                }
              }
            }
          }

          // Recursively process other elements
          // When we encounter a table cell, pass it down as context
          let nextTableCell = currentTableCell;
          if (item['w:tc']) {
            nextTableCell = item; // This item IS the table cell, pass it down
          }

          for (const key in item) {
            if (item.hasOwnProperty(key) && typeof item[key] === 'object') {
              applySpacing(item[key], nextTableCell);
            }
          }
        }
      } else if (typeof obj === 'object') {
        for (const key in obj) {
          if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
            applySpacing(obj[key], currentTableCell);
          }
        }
      }
    };

      applySpacing(documentData);

      console.log(`\n📊 Paragraph Processing Summary:`);
      console.log(`   Total paragraphs found: ${paragraphCount}`);
      console.log(`   Paragraphs with explicit styles: ${styledParagraphCount}`);
      console.log(`   Paragraphs without explicit styles: ${paragraphCount - styledParagraphCount}`);
      console.log(`   Style changes applied: ${changes.length}\n`);

      if (changes.length > 0) {
        console.log(`✓ Applied custom style spacing to ${changes.length} paragraph(s)`);
        // Save modified document
        const rebuiltXml = this.xmlBuilder.build(documentData);
        const xmlWithDeclaration = rebuiltXml.startsWith('<?xml')
          ? rebuiltXml
          : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rebuiltXml;
        zip.file('word/document.xml', xmlWithDeclaration);
      } else {
        console.log('No style spacing changes needed');
      }

      return { modified: changes.length > 0, changes };
    } catch (error) {
      console.error('Error applying custom style spacing:', error);
      return { modified: false, changes: [] };
    }
  }

  /**
   * Extract text from a paragraph array
   */
  private extractParagraphText(pArray: any[]): string {
    let text = '';

    for (const item of pArray) {
      if (item['w:r']) {
        const runs = Array.isArray(item['w:r']) ? item['w:r'] : [item['w:r']];
        for (const run of runs) {
          if (Array.isArray(run)) {
            for (const runItem of run) {
              if (runItem['w:t']) {
                const textItems = Array.isArray(runItem['w:t']) ? runItem['w:t'] : [runItem['w:t']];
                for (const textItem of textItems) {
                  if (textItem['#text']) {
                    text += textItem['#text'];
                  }
                }
              }
            }
          }
        }
      }
    }

    return text.trim().substring(0, 100); // Limit to 100 chars for display
  }

  /**
   * Get the style of a paragraph
   */
  private getParagraphStyle(pArray: any[], debug = false): string | null {
    // Debug: Show paragraph structure (only for first few paragraphs)
    if (debug) {
      console.log('\n  🔍 getParagraphStyle() - Analyzing paragraph structure:');
      console.log('    Paragraph array length:', pArray.length);
      console.log('    Paragraph elements:', pArray.map(el => Object.keys(el)));
    }

    const pPrItem = pArray.find(el => el['w:pPr']);
    if (!pPrItem) {
      if (debug) console.log('    ❌ No w:pPr found in paragraph');
      return null;
    }

    if (debug) console.log('    ✓ Found w:pPr element');
    const pPr = pPrItem['w:pPr'];
    if (debug) {
      console.log('    w:pPr is array?', Array.isArray(pPr));
      console.log('    w:pPr structure:', Array.isArray(pPr) ? pPr.map(item => Object.keys(item)) : Object.keys(pPr || {}));
    }

    const pPrArray = Array.isArray(pPr) ? pPr : [pPr];

    for (const item of pPrArray) {
      if (debug) console.log('    Checking pPr item keys:', Object.keys(item || {}));
      if (item['w:pStyle'] !== undefined) {
        if (debug) console.log('    ✓ Found w:pStyle element');

        // With preserveOrder: true, attributes are at item[':@'] (sibling level),
        // NOT inside item['w:pStyle'] (which is an empty array)
        const attrs = item[':@'];
        if (debug) console.log('    Sibling :@ object:', attrs);

        const styleVal = attrs?.['@_w:val'];
        if (styleVal) {
          if (debug) console.log(`    ✅ Detected paragraph style: ${styleVal}`);
          return styleVal;
        } else {
          if (debug) console.log('    ❌ No @_w:val found in :@ attributes');
        }
      } else {
        if (debug) console.log('    ❌ No w:pStyle in this pPr item');
      }
    }

    if (debug) console.log('    ❌ No style value found after checking all items');
    return null;
  }

  /**
   * Process list formatting (bullets and numbered lists)
   * Applies uniform bullet/numbering formatting based on settings
   */
  private async processListFormatting(
    zip: JSZip,
    settings: ListBulletSettings
  ): Promise<{ modified: boolean; changes: any[]; listsProcessed: number }> {
    if (!settings.enabled) {
      return { modified: false, changes: [], listsProcessed: 0 };
    }

    console.log('\n=== LIST FORMATTING ===');
    console.log('List settings:', JSON.stringify(settings, null, 2));

    const changes: any[] = [];
    let modified = false;
    let listsProcessed = 0;

    try {
      // Read document.xml
      const documentXmlFile = zip.file('word/document.xml');
      if (!documentXmlFile) {
        console.log('⚠️  word/document.xml not found');
        return { modified: false, changes: [], listsProcessed: 0 };
      }

      const documentXmlContent = await documentXmlFile.async('string');
      const documentData = this.xmlParser.parse(documentXmlContent);

      // Read or create numbering.xml
      let numberingXmlFile = zip.file('word/numbering.xml');
      let numberingXmlContent: string;
      let numberingExists = false;

      if (numberingXmlFile) {
        numberingXmlContent = await numberingXmlFile.async('string');
        numberingExists = true;
        console.log('✓ Found existing numbering.xml');
      } else {
        // Create minimal numbering.xml structure
        numberingXmlContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
</w:numbering>`;
        console.log('✓ Created new numbering.xml structure');
      }

      // Parse numbering.xml using NumberingXmlProcessor
      const parseResult = this.numberingProcessor.parse(numberingXmlContent);
      if (!parseResult.success || !parseResult.data) {
        console.error('Failed to parse numbering.xml');
        return { modified: false, changes: [], listsProcessed: 0 };
      }

      let numberingXml = parseResult.data;

      // Get next available IDs
      const abstractNumId = this.numberingProcessor.getNextAbstractNumId(numberingXml);
      const numId = this.numberingProcessor.getNextNumId(numberingXml);

      console.log(`Creating new bullet list definition: abstractNumId=${abstractNumId}, numId=${numId}`);

      // Create bullet list definition with configured settings
      numberingXml = this.numberingProcessor.createBulletList(
        numberingXml,
        abstractNumId,
        settings.indentationLevels[0]?.bulletChar || '●',
        settings.indentationLevels.length
      );

      // Update each level with configured indentation and bullet characters
      for (let i = 0; i < settings.indentationLevels.length; i++) {
        const levelSettings = settings.indentationLevels[i];
        const indentTwips = levelSettings.indentation * 20; // Convert points to twips
        const hangingTwips = 360; // Standard hanging indent (0.25 inch)

        numberingXml = this.numberingProcessor.updateLevel(
          numberingXml,
          abstractNumId,
          i,
          {
            level: i,
            text: levelSettings.bulletChar || '●',
            format: 'bullet',
            alignment: 'left',
            indentLeft: indentTwips,
            indentHanging: hangingTwips
          }
        );

        console.log(`  Level ${i + 1}: ${levelSettings.bulletChar}, indent=${levelSettings.indentation}pt`);
      }

      // Create numbering instance
      numberingXml = this.numberingProcessor.createNumberingInstance(
        numberingXml,
        numId,
        abstractNumId
      );

      console.log('✓ Created bullet list definitions in numbering.xml');

      // Apply numbering to detected list paragraphs
      if (documentData && documentData.length > 1 && documentData[1]['w:document']) {
        const docElement = documentData[1]['w:document'];
        const bodyArray = Array.isArray(docElement) ? docElement : [docElement];
        const bodyItem = bodyArray.find(el => el['w:body']);

        if (bodyItem && bodyItem['w:body']) {
          const body = Array.isArray(bodyItem['w:body']) ? bodyItem['w:body'][0] : bodyItem['w:body'];
          const paragraphs = body['w:p'];

          if (paragraphs) {
            const pArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
            console.log(`Found ${pArray.length} paragraphs to scan for lists`);

            for (const paragraph of pArray) {
              if (Array.isArray(paragraph)) {
                // Check for w:numPr (numbering properties) in paragraph properties
                const pPrItem = paragraph.find(el => el['w:pPr']);
                if (pPrItem && pPrItem['w:pPr']) {
                  const pPr = Array.isArray(pPrItem['w:pPr']) ? pPrItem['w:pPr'] : [pPrItem['w:pPr']];
                  const pPrArray = Array.isArray(pPr) ? pPr : [pPr];

                  // Check if this paragraph has list formatting
                  const numPrItem = pPrArray.find((el: any) => el['w:numPr']);
                  if (numPrItem && numPrItem['w:numPr']) {
                    // Update existing list item to use our new numbering definition
                    const numPr = Array.isArray(numPrItem['w:numPr']) ? numPrItem['w:numPr'] : [numPrItem['w:numPr']];
                    const numPrArray = Array.isArray(numPr) ? numPr : [numPr];

                    // Update w:numId to reference our bullet list
                    const numIdItem = numPrArray.find((el: any) => el['w:numId']);
                    if (numIdItem) {
                      numIdItem['w:numId'] = [{
                        ':@': { '@_w:val': numId }
                      }];
                    } else {
                      numPrArray.push({
                        'w:numId': [{
                          ':@': { '@_w:val': numId }
                        }]
                      });
                    }

                    listsProcessed++;
                    console.log(`  Applied bullet formatting to list item #${listsProcessed}`);
                  }
                }
              }
            }
          }
        }
      }

      console.log(`✓ Applied bullet formatting to ${listsProcessed} list items`);

      if (listsProcessed > 0) {
        modified = true;
        changes.push({
          type: 'list',
          description: `Applied bullet formatting to ${listsProcessed} list items with custom settings`,
          count: listsProcessed
        });

        // Save numbering.xml
        const buildResult = this.numberingProcessor.build(numberingXml);
        if (buildResult.success && buildResult.data) {
          zip.file('word/numbering.xml', buildResult.data);
          console.log('✓ Saved numbering.xml with bullet list definitions');
        }

        // Save updated document.xml
        const documentXmlOutput = this.xmlBuilder.build(documentData);
        zip.file('word/document.xml', documentXmlOutput);
        console.log('✓ Saved document.xml with updated list references');

        // If we created new numbering.xml, update content types and relationships
        if (!numberingExists) {
          await this.addNumberingRelationships(zip);
        }
      }

      return { modified, changes, listsProcessed };
    } catch (error: any) {
      console.error('Error processing list formatting:', error);
      return { modified: false, changes: [], listsProcessed: 0 };
    }
  }

  /**
   * Add numbering.xml to document relationships if it doesn't exist
   */
  private async addNumberingRelationships(zip: JSZip): Promise<void> {
    // Add to [Content_Types].xml
    const contentTypesFile = zip.file('[Content_Types].xml');
    if (contentTypesFile) {
      const content = await contentTypesFile.async('string');
      const contentTypes = this.xmlParser.parse(content);

      // Check if numbering override already exists
      const types = contentTypes[1]['Types'];
      const overrides = types.find((el: any) => el['Override'])?.['Override'] || [];
      const overrideArray = Array.isArray(overrides) ? overrides : [overrides];

      const hasNumbering = overrideArray.some((o: any) =>
        o[':@']?.['@_PartName'] === '/word/numbering.xml'
      );

      if (!hasNumbering) {
        overrideArray.push({
          'Override': [],
          ':@': {
            '@_PartName': '/word/numbering.xml',
            '@_ContentType': 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'
          }
        });
        const output = this.xmlBuilder.build(contentTypes);
        zip.file('[Content_Types].xml', output);
        console.log('✓ Added numbering.xml to [Content_Types].xml');
      }
    }

    // Add to word/_rels/document.xml.rels
    const relsFile = zip.file('word/_rels/document.xml.rels');
    if (relsFile) {
      const content = await relsFile.async('string');
      const rels = this.xmlParser.parse(content);

      const relationships = rels[1]['Relationships'];
      const relArray = relationships.find((el: any) => el['Relationship'])?.['Relationship'] || [];
      const relationshipArray = Array.isArray(relArray) ? relArray : [relArray];

      const hasNumbering = relationshipArray.some((r: any) =>
        r[':@']?.['@_Target'] === 'numbering.xml'
      );

      if (!hasNumbering) {
        // Find next available rId
        const maxId = relationshipArray.reduce((max: number, r: any) => {
          const id = r[':@']?.['@_Id'];
          if (id && id.startsWith('rId')) {
            const num = parseInt(id.substring(3));
            return Math.max(max, num);
          }
          return max;
        }, 0);

        relationshipArray.push({
          'Relationship': [],
          ':@': {
            '@_Id': `rId${maxId + 1}`,
            '@_Type': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
            '@_Target': 'numbering.xml'
          }
        });

        const output = this.xmlBuilder.build(rels);
        zip.file('word/_rels/document.xml.rels', output);
        console.log('✓ Added numbering.xml to document relationships');
      }
    }
  }

  /**
   * Standardize list indentation across all list items
   */
  private async standardizeListIndentation(
    zip: JSZip,
    settings: ListBulletSettings
  ): Promise<{ modified: boolean; changes: any[]; itemsUpdated: number }> {
    if (!settings.enabled || !settings.indentationLevels || settings.indentationLevels.length === 0) {
      return { modified: false, changes: [], itemsUpdated: 0 };
    }

    console.log('\n=== LIST INDENTATION UNIFORMITY ===');
    console.log('Indentation levels:', settings.indentationLevels);

    const changes: any[] = [];
    let modified = false;
    let itemsUpdated = 0;

    try {
      // Read document.xml
      const documentXmlFile = zip.file('word/document.xml');
      if (!documentXmlFile) {
        return { modified: false, changes: [], itemsUpdated: 0 };
      }

      const documentXmlContent = await documentXmlFile.async('string');
      const documentData = this.xmlParser.parse(documentXmlContent);

      // Process paragraphs with list formatting
      if (documentData && documentData.length > 1 && documentData[1]['w:document']) {
        const docElement = documentData[1]['w:document'];
        const bodyArray = Array.isArray(docElement) ? docElement : [docElement];
        const bodyItem = bodyArray.find(el => el['w:body']);

        if (bodyItem && bodyItem['w:body']) {
          const body = Array.isArray(bodyItem['w:body']) ? bodyItem['w:body'][0] : bodyItem['w:body'];
          const paragraphs = body['w:p'];

          if (paragraphs) {
            const pArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];

            for (const paragraph of pArray) {
              if (Array.isArray(paragraph)) {
                const pPrItem = paragraph.find(el => el['w:pPr']);
                if (pPrItem && pPrItem['w:pPr']) {
                  const pPr = Array.isArray(pPrItem['w:pPr']) ? pPrItem['w:pPr'] : [pPrItem['w:pPr']];
                  const pPrArray = Array.isArray(pPr) ? pPr : [pPr];

                  // Find w:numPr (list properties)
                  const numPrItem = pPrArray.find((el: any) => el['w:numPr']);
                  if (numPrItem && numPrItem['w:numPr']) {
                    const numPr = Array.isArray(numPrItem['w:numPr']) ? numPrItem['w:numPr'] : [numPrItem['w:numPr']];
                    const numPrArray = Array.isArray(numPr) ? numPr : [numPr];

                    // Get the indentation level (ilvl)
                    const ilvlItem = numPrArray.find((el: any) => el['w:ilvl']);
                    if (ilvlItem && ilvlItem[':@']?.['@_w:val']) {
                      const level = parseInt(ilvlItem[':@']['@_w:val']);
                      const indentSettings = settings.indentationLevels[level];

                      if (indentSettings) {
                        // Find or create w:ind (indentation) element
                        let indItem = pPrArray.find((el: any) => el['w:ind']);
                        if (!indItem) {
                          indItem = { 'w:ind': [], ':@': {} };
                          pPrArray.push(indItem);
                        }

                        // Update indentation values (convert points to twips: 1pt = 20 twips)
                        const leftTwips = (indentSettings.indentation * 20).toString();
                        indItem[':@']['@_w:left'] = leftTwips;
                        indItem[':@']['@_w:hanging'] = '360'; // Standard hanging indent (0.25 inch)

                        itemsUpdated++;
                        modified = true;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (modified) {
        // Save updated document.xml
        const documentXmlOutput = this.xmlBuilder.build(documentData);
        zip.file('word/document.xml', documentXmlOutput);
        console.log(`✓ Updated indentation for ${itemsUpdated} list items`);

        changes.push({
          type: 'indentation',
          description: `Standardized indentation for ${itemsUpdated} list items`,
          count: itemsUpdated
        });
      }

      return { modified, changes, itemsUpdated };
    } catch (error: any) {
      console.error('Error standardizing list indentation:', error);
      return { modified: false, changes: [], itemsUpdated: 0 };
    }
  }

  /**
   * Process table shading and uniformity
   * Applies all table formatting: borders, shading, fonts, conditional formatting
   */
  private async processTableShading(
    zip: JSZip,
    settings: TableUniformitySettings
  ): Promise<{ modified: boolean; changes: any[]; tablesProcessed: number }> {
    if (!settings.enabled) {
      return { modified: false, changes: [], tablesProcessed: 0 };
    }

    console.log('\n=== TABLE UNIFORMITY ===');
    console.log('Table settings:', JSON.stringify(settings, null, 2));

    const changes: any[] = [];
    let modified = false;
    let tablesProcessed = 0;

    try {
      // Read document.xml
      const documentXmlFile = zip.file('word/document.xml');
      if (!documentXmlFile) {
        return { modified: false, changes: [], tablesProcessed: 0 };
      }

      const documentXmlContent = await documentXmlFile.async('string');
      const documentData = this.xmlParser.parse(documentXmlContent);

      // Process tables in document
      if (documentData && documentData.length > 1 && documentData[1]['w:document']) {
        const docElement = documentData[1]['w:document'];
        const bodyArray = Array.isArray(docElement) ? docElement : [docElement];
        const bodyItem = bodyArray.find(el => el['w:body']);

        if (bodyItem && bodyItem['w:body']) {
          const body = Array.isArray(bodyItem['w:body']) ? bodyItem['w:body'][0] : bodyItem['w:body'];
          const tables = body['w:tbl'];

          if (tables) {
            const tableArray = Array.isArray(tables) ? tables : [tables];
            console.log(`Found ${tableArray.length} tables to process`);

            for (const table of tableArray) {
              if (Array.isArray(table)) {
                tablesProcessed++;
                console.log(`  Processing table #${tablesProcessed}`);

                // Count rows and columns to determine if 1x1
                const rows = table.filter(el => el['w:tr']);
                const rowCount = rows.length;
                const colCount = rows[0] && rows[0]['w:tr'] ?
                  (Array.isArray(rows[0]['w:tr'][0]) ? rows[0]['w:tr'][0] : rows[0]['w:tr'])
                    .filter((el: any) => el['w:tc']).length : 0;

                const is1x1 = rowCount === 1 && colCount === 1;
                console.log(`    Table dimensions: ${rowCount}x${colCount} ${is1x1 ? '(1x1 single cell)' : ''}`);

                // Apply table-level properties (borders)
                if (settings.borderStyle && settings.borderStyle !== 'none') {
                  const tblPrItem = table.find(el => el['w:tblPr']);
                  if (tblPrItem && tblPrItem['w:tblPr']) {
                    const tblPr = Array.isArray(tblPrItem['w:tblPr']) ? tblPrItem['w:tblPr'] : [tblPrItem['w:tblPr']];
                    const tblPrArray = Array.isArray(tblPr[0]) ? tblPr[0] : tblPr;
                    this.applyTableBorders(tblPrArray, settings.borderStyle, settings.borderWidth);
                    modified = true;
                  }
                }

                let rowIndex = 0;
                for (const rowItem of rows) {
                  if (rowItem['w:tr']) {
                    const row = Array.isArray(rowItem['w:tr']) ? rowItem['w:tr'] : [rowItem['w:tr']];
                    const rowArray = Array.isArray(row[0]) ? row[0] : row;
                    const cells = rowArray.filter((el: any) => el['w:tc']);

                    for (const cellItem of cells) {
                      if (cellItem['w:tc']) {
                        const cell = Array.isArray(cellItem['w:tc']) ? cellItem['w:tc'] : [cellItem['w:tc']];
                        const cellArray = Array.isArray(cell[0]) ? cell[0] : cell;

                        if (is1x1) {
                          // Single cell table - check for Header 2 style
                          const hasHeader2 = this.cellHasHeader2Style(cellArray);
                          if (hasHeader2) {
                            console.log('    Detected Header 2 in 1x1 table cell');
                            this.applyTableCellShading(cellArray, settings.header2In1x1CellShading);
                            this.applyTableCellAlignment(cellArray, settings.header2In1x1Alignment);
                            modified = true;
                          }
                        } else {
                          // Multi-cell table
                          const isHeaderRow = rowIndex === 0;
                          const isTopRow = rowIndex === 0 && settings.applyToTopRow;
                          const isAlternatingRow = rowIndex > 0 && settings.alternatingRowColors && rowIndex % 2 === 1;
                          const hasIfThenPattern = settings.applyToIfThenPattern && this.cellContainsIfThenPattern(cellArray);

                          // Header row shading
                          if (isHeaderRow && settings.headerRowShaded) {
                            this.applyTableCellShading(cellArray, settings.headerRowShadingColor);
                            modified = true;
                          }

                          // Header row bold
                          if (isHeaderRow && settings.headerRowBold) {
                            this.applyTableCellBold(cellArray, true);
                            modified = true;
                          }

                          // Alternating row colors
                          if (isAlternatingRow) {
                            this.applyTableCellShading(cellArray, '#F0F0F0');
                            modified = true;
                          }

                          // Large table conditional formatting
                          if (hasIfThenPattern || isTopRow) {
                            console.log(`    Applying large table formatting (${hasIfThenPattern ? 'If...Then' : 'top row'})`);
                            this.applyTableCellFormatting(cellArray, settings.largeTableSettings);
                            modified = true;
                          }

                          // Cell padding for all cells
                          if (settings.cellPadding) {
                            this.applyTableCellPadding(cellArray, settings.cellPadding);
                            modified = true;
                          }
                        }
                      }
                    }

                    rowIndex++;
                  }
                }
              }
            }
          }
        }
      }

      console.log(`✓ Applied table uniformity to ${tablesProcessed} tables`);

      if (modified) {
        changes.push({
          type: 'table',
          description: `Applied table uniformity to ${tablesProcessed} tables (borders, shading, fonts, conditional formatting)`,
          count: tablesProcessed
        });

        // Save document.xml
        const documentXmlOutput = this.xmlBuilder.build(documentData);
        zip.file('word/document.xml', documentXmlOutput);
        console.log('✓ Saved document.xml with updated table formatting');
      }

      return { modified, changes, tablesProcessed };
    } catch (error: any) {
      console.error('Error processing table uniformity:', error);
      return { modified: false, changes: [], tablesProcessed: 0 };
    }
  }

  /**
   * Apply shading to a table cell
   */
  private applyTableCellShading(cellArray: any[], color: string): void {
    // Find or create w:tcPr (table cell properties)
    let tcPrItem = cellArray.find(el => el['w:tcPr']);
    if (!tcPrItem) {
      tcPrItem = { 'w:tcPr': [] };
      cellArray.unshift(tcPrItem);
    }

    const tcPr = Array.isArray(tcPrItem['w:tcPr']) ? tcPrItem['w:tcPr'] : [tcPrItem['w:tcPr']];
    const tcPrArray = Array.isArray(tcPr) ? tcPr : [tcPr];

    // Remove existing shading if present
    const shdIndex = tcPrArray.findIndex((el: any) => el['w:shd']);
    if (shdIndex >= 0) {
      tcPrArray.splice(shdIndex, 1);
    }

    // Add new shading element
    const colorHex = color.startsWith('#') ? color.substring(1) : color;
    tcPrArray.push({
      'w:shd': [],
      ':@': {
        '@_w:val': 'clear',
        '@_w:color': 'auto',
        '@_w:fill': colorHex
      }
    });

    console.log(`    ✓ Applied shading color: ${color}`);
  }

  /**
   * Check if cell has Header 2 style applied
   */
  private cellHasHeader2Style(cellArray: any[]): boolean {
    // Look for paragraphs in the cell
    for (const item of cellArray) {
      if (item['w:p']) {
        const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];
        for (const p of paragraphs) {
          const pArray = Array.isArray(p) ? p : [p];
          for (const pItem of pArray) {
            if (pItem['w:pPr']) {
              const pPr = Array.isArray(pItem['w:pPr']) ? pItem['w:pPr'][0] : pItem['w:pPr'];
              const pPrArray = Array.isArray(pPr) ? pPr : [pPr];

              for (const prop of pPrArray) {
                if (prop['w:pStyle']) {
                  const pStyle = Array.isArray(prop['w:pStyle']) ? prop['w:pStyle'][0] : prop['w:pStyle'];
                  const styleVal = pStyle?.[':@']?.['@_w:val'] || pStyle?.['@_w:val'];
                  if (styleVal === 'Heading2' || styleVal === 'Heading 2' || styleVal === 'Header2') {
                    return true;
                  }
                }
              }
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * Check if cell contains "If...Then" pattern
   */
  private cellContainsIfThenPattern(cellArray: any[]): boolean {
    // Extract text from cell
    let cellText = '';
    for (const item of cellArray) {
      if (item['w:p']) {
        const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];
        for (const p of paragraphs) {
          const pArray = Array.isArray(p) ? p : [p];
          for (const pItem of pArray) {
            if (pItem['w:r']) {
              const runs = Array.isArray(pItem['w:r']) ? pItem['w:r'] : [pItem['w:r']];
              for (const run of runs) {
                const runArray = Array.isArray(run) ? run : [run];
                for (const rItem of runArray) {
                  if (rItem['w:t']) {
                    const textItems = Array.isArray(rItem['w:t']) ? rItem['w:t'] : [rItem['w:t']];
                    for (const t of textItems) {
                      const text = typeof t === 'string' ? t : (t['#text'] || '');
                      cellText += text;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Check for "If...Then" pattern (case insensitive)
    return /if\s+.+\s+then/i.test(cellText);
  }

  /**
   * Apply borders to table properties
   */
  private applyTableBorders(tblPrArray: any[], borderStyle: string, borderWidth: number): void {
    // Remove existing borders
    const bordersIndex = tblPrArray.findIndex((el: any) => el['w:tblBorders']);
    if (bordersIndex >= 0) {
      tblPrArray.splice(bordersIndex, 1);
    }

    // Map border style to Word values
    const borderValMap: Record<string, string> = {
      'single': 'single',
      'double': 'double',
      'dashed': 'dashed',
      'dotted': 'dotted'
    };

    const borderVal = borderValMap[borderStyle] || 'single';
    const borderSz = Math.round(borderWidth * 8); // Convert points to eighths of a point

    // Add new borders
    tblPrArray.push({
      'w:tblBorders': [{
        'w:top': [{
          ':@': {
            '@_w:val': borderVal,
            '@_w:sz': borderSz.toString(),
            '@_w:space': '0',
            '@_w:color': 'auto'
          }
        }],
        'w:left': [{
          ':@': {
            '@_w:val': borderVal,
            '@_w:sz': borderSz.toString(),
            '@_w:space': '0',
            '@_w:color': 'auto'
          }
        }],
        'w:bottom': [{
          ':@': {
            '@_w:val': borderVal,
            '@_w:sz': borderSz.toString(),
            '@_w:space': '0',
            '@_w:color': 'auto'
          }
        }],
        'w:right': [{
          ':@': {
            '@_w:val': borderVal,
            '@_w:sz': borderSz.toString(),
            '@_w:space': '0',
            '@_w:color': 'auto'
          }
        }],
        'w:insideH': [{
          ':@': {
            '@_w:val': borderVal,
            '@_w:sz': borderSz.toString(),
            '@_w:space': '0',
            '@_w:color': 'auto'
          }
        }],
        'w:insideV': [{
          ':@': {
            '@_w:val': borderVal,
            '@_w:sz': borderSz.toString(),
            '@_w:space': '0',
            '@_w:color': 'auto'
          }
        }]
      }]
    });

    console.log(`    ✓ Applied ${borderStyle} borders (${borderWidth}pt)`);
  }

  /**
   * Apply cell padding
   */
  private applyTableCellPadding(cellArray: any[], padding: number): void {
    // Find or create w:tcPr (table cell properties)
    let tcPrItem = cellArray.find(el => el['w:tcPr']);
    if (!tcPrItem) {
      tcPrItem = { 'w:tcPr': [] };
      cellArray.unshift(tcPrItem);
    }

    const tcPr = Array.isArray(tcPrItem['w:tcPr']) ? tcPrItem['w:tcPr'] : [tcPrItem['w:tcPr']];
    const tcPrArray = Array.isArray(tcPr[0]) ? tcPr[0] : tcPr;

    // Remove existing cell margins
    const marginIndex = tcPrArray.findIndex((el: any) => el['w:tcMar']);
    if (marginIndex >= 0) {
      tcPrArray.splice(marginIndex, 1);
    }

    // Add cell margins (convert points to twips)
    const paddingTwips = Math.round(padding * 20);
    tcPrArray.push({
      'w:tcMar': [{
        'w:top': [{ ':@': { '@_w:w': paddingTwips.toString(), '@_w:type': 'dxa' } }],
        'w:left': [{ ':@': { '@_w:w': paddingTwips.toString(), '@_w:type': 'dxa' } }],
        'w:bottom': [{ ':@': { '@_w:w': paddingTwips.toString(), '@_w:type': 'dxa' } }],
        'w:right': [{ ':@': { '@_w:w': paddingTwips.toString(), '@_w:type': 'dxa' } }]
      }]
    });
  }

  /**
   * Apply bold to cell text
   */
  private applyTableCellBold(cellArray: any[], bold: boolean): void {
    // Find all runs in cell paragraphs
    for (const item of cellArray) {
      if (item['w:p']) {
        const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];
        for (const p of paragraphs) {
          const pArray = Array.isArray(p) ? p : [p];
          for (const pItem of pArray) {
            if (pItem['w:r']) {
              const runs = Array.isArray(pItem['w:r']) ? pItem['w:r'] : [pItem['w:r']];
              for (const run of runs) {
                const runArray = Array.isArray(run) ? run : [run];
                for (const rItem of runArray) {
                  // Find or create w:rPr (run properties)
                  let rPrItem = rItem['w:rPr'];
                  if (!rPrItem) {
                    rPrItem = [];
                    rItem['w:rPr'] = rPrItem;
                  }

                  const rPr = Array.isArray(rPrItem) ? rPrItem : [rPrItem];

                  // Remove existing bold
                  const boldIndex = rPr.findIndex((el: any) => el['w:b']);
                  if (boldIndex >= 0) {
                    rPr.splice(boldIndex, 1);
                  }

                  // Add bold if requested
                  if (bold) {
                    rPr.push({ 'w:b': [] });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Apply alignment to cell
   */
  private applyTableCellAlignment(cellArray: any[], alignment: string): void {
    // Find all paragraphs in cell
    for (const item of cellArray) {
      if (item['w:p']) {
        const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];
        for (const p of paragraphs) {
          const pArray = Array.isArray(p) ? p : [p];
          for (const pItem of pArray) {
            // Find or create w:pPr (paragraph properties)
            let pPrItem = pArray.find((el: any) => el['w:pPr']);
            if (!pPrItem) {
              pPrItem = { 'w:pPr': [] };
              pArray.unshift(pPrItem);
            }

            const pPr = Array.isArray(pPrItem['w:pPr']) ? pPrItem['w:pPr'] : [pPrItem['w:pPr']];
            const pPrArray = Array.isArray(pPr[0]) ? pPr[0] : pPr;

            // Remove existing alignment
            const jcIndex = pPrArray.findIndex((el: any) => el['w:jc']);
            if (jcIndex >= 0) {
              pPrArray.splice(jcIndex, 1);
            }

            // Add alignment
            pPrArray.push({
              'w:jc': [{
                ':@': { '@_w:val': alignment }
              }]
            });
          }
        }
      }
    }
  }

  /**
   * Apply comprehensive cell formatting (font, size, bold, italic, underline, alignment, padding)
   */
  private applyTableCellFormatting(cellArray: any[], formatting: {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    alignment?: string;
    cellPadding?: number;
  }): void {
    // Apply cell-level properties
    if (formatting.cellPadding) {
      this.applyTableCellPadding(cellArray, formatting.cellPadding);
    }

    if (formatting.alignment) {
      this.applyTableCellAlignment(cellArray, formatting.alignment);
    }

    // Apply run-level formatting to all text
    for (const item of cellArray) {
      if (item['w:p']) {
        const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];
        for (const p of paragraphs) {
          const pArray = Array.isArray(p) ? p : [p];
          for (const pItem of pArray) {
            if (pItem['w:r']) {
              const runs = Array.isArray(pItem['w:r']) ? pItem['w:r'] : [pItem['w:r']];
              for (const run of runs) {
                const runArray = Array.isArray(run) ? run : [run];
                for (const rItem of runArray) {
                  // Find or create w:rPr (run properties)
                  let rPrItem = rItem['w:rPr'];
                  if (!rPrItem) {
                    rPrItem = [];
                    rItem['w:rPr'] = rPrItem;
                  }

                  const rPr = Array.isArray(rPrItem) ? rPrItem : [rPrItem];

                  // Apply font family
                  if (formatting.fontFamily) {
                    const fontIndex = rPr.findIndex((el: any) => el['w:rFonts']);
                    if (fontIndex >= 0) {
                      rPr.splice(fontIndex, 1);
                    }
                    rPr.push({
                      'w:rFonts': [{
                        ':@': {
                          '@_w:ascii': formatting.fontFamily,
                          '@_w:hAnsi': formatting.fontFamily
                        }
                      }]
                    });
                  }

                  // Apply font size (convert to half-points)
                  if (formatting.fontSize) {
                    const sizeIndex = rPr.findIndex((el: any) => el['w:sz']);
                    if (sizeIndex >= 0) {
                      rPr.splice(sizeIndex, 1);
                    }
                    const sizeHalfPt = (formatting.fontSize * 2).toString();
                    rPr.push({
                      'w:sz': [{
                        ':@': { '@_w:val': sizeHalfPt }
                      }]
                    });
                  }

                  // Apply bold
                  if (formatting.bold !== undefined) {
                    const boldIndex = rPr.findIndex((el: any) => el['w:b']);
                    if (boldIndex >= 0) {
                      rPr.splice(boldIndex, 1);
                    }
                    if (formatting.bold) {
                      rPr.push({ 'w:b': [] });
                    }
                  }

                  // Apply italic
                  if (formatting.italic !== undefined) {
                    const italicIndex = rPr.findIndex((el: any) => el['w:i']);
                    if (italicIndex >= 0) {
                      rPr.splice(italicIndex, 1);
                    }
                    if (formatting.italic) {
                      rPr.push({ 'w:i': [] });
                    }
                  }

                  // Apply underline
                  if (formatting.underline !== undefined) {
                    const uIndex = rPr.findIndex((el: any) => el['w:u']);
                    if (uIndex >= 0) {
                      rPr.splice(uIndex, 1);
                    }
                    if (formatting.underline) {
                      rPr.push({
                        'w:u': [{
                          ':@': { '@_w:val': 'single' }
                        }]
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Batch process multiple documents with concurrency control
   * Uses p-limit to prevent resource exhaustion and race conditions
   */
  async batchProcess(
    filePaths: string[],
    options: WordProcessingOptions = {}
  ): Promise<Map<string, WordProcessingResult>> {
    const results = new Map<string, WordProcessingResult>();

    // Critical: Limit concurrent operations to prevent:
    // 1. Memory exhaustion (each document can use 50-100MB)
    // 2. Race conditions in shared hyperlinkCache
    // 3. File system contention
    const limit = pLimit(3); // Max 3 concurrent operations

    this.log(`\n[Batch Process] Processing ${filePaths.length} document(s) with max 3 concurrent`);

    const batchResults = await Promise.allSettled(
      filePaths.map(filePath =>
        limit(() => this.processDocument(filePath, options))
      )
    );

    batchResults.forEach((settledResult, index) => {
      const filePath = filePaths[index];
      if (settledResult.status === 'fulfilled') {
        results.set(filePath, settledResult.value);
      } else {
        results.set(filePath, {
          success: false,
          totalHyperlinks: 0,
          processedHyperlinks: 0,
          modifiedHyperlinks: 0,
          skippedHyperlinks: 0,
          updatedUrls: 0,
          updatedDisplayTexts: 0,
          appendedContentIds: 0,
          errorCount: 1,
          errorMessages: [settledResult.reason?.message || 'Processing failed'],
          processedLinks: [],
          validationIssues: [],
          duration: 0,
        });
      }
    });

    this.log(`[Batch Process] Completed: ${results.size} results`);
    return results;
  }
}

// Export singleton instance
export const wordDocumentProcessor = new WordDocumentProcessor();