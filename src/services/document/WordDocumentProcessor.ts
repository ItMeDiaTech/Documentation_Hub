/**
 * WordDocumentProcessor - Advanced Word document processing with JSZip
 * Implements direct .docx manipulation for hyperlink fixing
 */

import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  DetailedHyperlinkInfo,
  HyperlinkProcessingOptions,
  HyperlinkProcessingResult,
  HyperlinkType
} from '@/types/hyperlink';

export interface WordProcessingOptions extends HyperlinkProcessingOptions {
  createBackup?: boolean;
  validateBeforeProcessing?: boolean;
  streamLargeFiles?: boolean;
  maxFileSizeMB?: number;
  header2Spacing?: {
    spaceBefore: number;
    spaceAfter: number;
  };
  customStyleSpacing?: {
    header1?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
    header2?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
    normal?: { spaceBefore: number; spaceAfter: number; lineSpacing?: number };
  };
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
  private readonly MAX_FILE_SIZE_MB = 100;

  constructor() {
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
   * Process a Word document with advanced hyperlink manipulation
   */
  async processDocument(
    filePath: string,
    options: WordProcessingOptions = {}
  ): Promise<WordProcessingResult> {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  WORD DOCUMENT PROCESSOR - STARTING                      ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    console.log('File:', filePath);
    console.log('Options:', JSON.stringify(options, null, 2));

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
      console.log('\n=== FILE VALIDATION ===');
      const stats = await fs.stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      result.documentSize = stats.size;

      console.log(`File size: ${fileSizeMB.toFixed(2)}MB`);
      console.log(`File modified: ${stats.mtime}`);

      if (fileSizeMB > (options.maxFileSizeMB || this.MAX_FILE_SIZE_MB)) {
        throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB exceeds limit of ${options.maxFileSizeMB || this.MAX_FILE_SIZE_MB}MB`);
      }

      // ALWAYS create backup for safety (override user option)
      console.log('\n=== BACKUP CREATION ===');
      console.log('Creating backup (MANDATORY for safety)...');
      const backupPath = await this.createBackup(filePath);
      result.backupPath = backupPath;
      backupCreated = true;
      console.log(`✓ Backup created: ${backupPath}`);

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
        console.log('\n=== KEYWORD PROCESSING ===');
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
        console.log('\n=== TEXT REPLACEMENT PROCESSING ===');
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

      // Process custom style spacing (Header 1, Header 2, Normal)
      let customSpacingProcessed = false;
      if (options.customStyleSpacing || options.header2Spacing) {
        console.log('\n=== CUSTOM STYLE SPACING PROCESSING ===');

        // Build style spacing config (customStyleSpacing takes precedence)
        const styleSpacing = options.customStyleSpacing || {};

        // For backwards compatibility, use header2Spacing if customStyleSpacing.header2 is not provided
        if (options.header2Spacing && !styleSpacing.header2) {
          styleSpacing.header2 = options.header2Spacing;
        }

        const spacingResult = await this.processCustomStyleSpacing(zip, styleSpacing);
        customSpacingProcessed = spacingResult.modified;
        if (customSpacingProcessed) {
          result.modifiedHyperlinks++; // Count as modification for save logic
          result.processedLinks.push(...spacingResult.changes);
        }
      }

      // Save the modified document
      if (processedData.modifiedCount > 0 || keywordsProcessed || textReplacementsProcessed || customSpacingProcessed) {
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
      console.log('\n✓✓✓ PROCESSING COMPLETED SUCCESSFULLY ✓✓✓\n');

    } catch (error) {
      console.error('\n✗✗✗ PROCESSING FAILED ✗✗✗');
      console.error('Error:', error);
      result.errorMessages.push(error instanceof Error ? error.message : 'Unknown error');
      result.errorCount++;

      // If backup exists and error occurred, inform user
      if (backupCreated && result.backupPath) {
        console.log(`\nℹ️  Backup available at: ${result.backupPath}`);
      }
    } finally {
      result.duration = performance.now() - startTime;
      result.processingTimeMs = result.duration;
      console.log(`\nTotal processing time: ${(result.duration / 1000).toFixed(2)}s\n`);
    }

    return result;
  }

  /**
   * Load Word document as JSZip
   */
  private async loadDocument(filePath: string): Promise<JSZip> {
    const data = await fs.readFile(filePath);
    return await JSZip.loadAsync(data);
  }

  /**
   * Save modified document
   */
  private async saveDocument(zip: JSZip, filePath: string): Promise<void> {
    const content = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      streamFiles: true // Memory efficiency for large files
    });

    await fs.writeFile(filePath, content);
  }

  /**
   * Create backup of document
   */
  private async createBackup(filePath: string): Promise<string> {
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath, '.docx');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(dir, `${basename}_backup_${timestamp}.docx`);

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

    // Map style IDs to their display names and spacing configs
    const styleConfigs = [
      { id: 'Heading1', displayName: 'Header 1', spacing: styleSpacing.header1 },
      { id: 'Header1', displayName: 'Header 1', spacing: styleSpacing.header1 },
      { id: 'Heading2', displayName: 'Header 2', spacing: styleSpacing.header2 },
      { id: 'Header2', displayName: 'Header 2', spacing: styleSpacing.header2 },
      { id: 'Normal', displayName: 'Normal', spacing: styleSpacing.normal },
    ];

    const applySpacing = (obj: any): void => {
      if (!obj) return;

      // Handle ordered array format from fast-xml-parser with preserveOrder: true
      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (item['w:p']) {
            const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];

            for (const pArray of paragraphs) {
              // Each paragraph is an array of elements
              if (Array.isArray(pArray)) {
                // Find paragraph properties
                const pPrItem = pArray.find(el => el['w:pPr']);
                let pPr = pPrItem ? pPrItem['w:pPr'] : null;

                // Check paragraph style
                const currentStyle = this.getParagraphStyle(pArray);

                // Find matching style config
                const styleConfig = styleConfigs.find(config =>
                  config.id === currentStyle && config.spacing
                );

                if (styleConfig && styleConfig.spacing) {
                  // Debug logging to track which paragraphs we're processing
                  const text = this.extractParagraphText(pArray);
                  console.log(`  Found ${styleConfig.displayName}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}}"`);
                  const spacing = styleConfig.spacing;

                  // Ensure paragraph properties exist
                  if (!pPr) {
                    const newPPr = [{ 'w:spacing': [{ '@_w:before': '0', '@_w:after': '0', '@_w:line': '240', '@_w:lineRule': 'auto' }] }];
                    pArray.unshift({ 'w:pPr': newPPr });
                    pPr = newPPr;
                  }

                  // Find or create spacing element
                  const pPrArray = Array.isArray(pPr) ? pPr : [pPr];

                  // CRITICAL FIX: Remove w:contextualSpacing element if present
                  // This element causes Word to ignore spacing between paragraphs of the same style
                  const contextualSpacingIndex = pPrArray.findIndex(el => el['w:contextualSpacing'] !== undefined);
                  if (contextualSpacingIndex !== -1) {
                    console.log(`  ⚠️  Removing w:contextualSpacing element (prevents spacing from working)`);
                    pPrArray.splice(contextualSpacingIndex, 1);
                  }

                  let spacingItem = pPrArray.find(el => el['w:spacing']);
                  let spacingElement = spacingItem ? spacingItem['w:spacing'] : null;

                  // Get current spacing values
                  const spacingArray = Array.isArray(spacingElement) ? spacingElement : [spacingElement];
                  const currentSpaceBefore = parseInt(spacingArray[0]?.['@_w:before'] || '0', 10);
                  const currentSpaceAfter = parseInt(spacingArray[0]?.['@_w:after'] || '0', 10);
                  const currentLine = parseInt(spacingArray[0]?.['@_w:line'] || '240', 10);

                  // Convert points to twips (1 point = 20 twips) for before/after
                  const twipsBefore = spacing.spaceBefore * 20;
                  const twipsAfter = spacing.spaceAfter * 20;

                  // Convert line spacing to OpenXML format (multiply by 240)
                  // 1.0 = 240, 1.15 = 276, 1.5 = 360, 2.0 = 480
                  const lineValue = Math.round((spacing.lineSpacing || 1.15) * 240);

                  // Update spacing with ALL attributes
                  if (!spacingElement) {
                    pPrArray.push({
                      'w:spacing': [{
                        '@_w:before': twipsBefore.toString(),
                        '@_w:after': twipsAfter.toString(),
                        '@_w:line': lineValue.toString(),
                        '@_w:lineRule': 'auto'
                      }]
                    });
                  } else {
                    spacingArray[0]['@_w:before'] = twipsBefore.toString();
                    spacingArray[0]['@_w:after'] = twipsAfter.toString();
                    spacingArray[0]['@_w:line'] = lineValue.toString();
                    spacingArray[0]['@_w:lineRule'] = 'auto';
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
                }
              }
            }
          }

          // Recursively process other elements
          for (const key in item) {
            if (item.hasOwnProperty(key) && typeof item[key] === 'object') {
              applySpacing(item[key]);
            }
          }
        }
      } else if (typeof obj === 'object') {
        for (const key in obj) {
          if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
            applySpacing(obj[key]);
          }
        }
      }
    };

      applySpacing(documentData);

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
  private getParagraphStyle(pArray: any[]): string | null {
    const pPrItem = pArray.find(el => el['w:pPr']);
    if (!pPrItem) return null;

    const pPr = pPrItem['w:pPr'];
    const pPrArray = Array.isArray(pPr) ? pPr : [pPr];

    for (const item of pPrArray) {
      if (item['w:pStyle']) {
        const styleItems = Array.isArray(item['w:pStyle']) ? item['w:pStyle'] : [item['w:pStyle']];
        for (const styleItem of styleItems) {
          if (styleItem['@_w:val']) {
            return styleItem['@_w:val'];
          }
        }
      }
    }

    return null;
  }

  /**
   * Batch process multiple documents
   */
  async batchProcess(
    filePaths: string[],
    options: WordProcessingOptions = {}
  ): Promise<Map<string, WordProcessingResult>> {
    const results = new Map<string, WordProcessingResult>();
    const BATCH_SIZE = 3; // Process 3 files concurrently

    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(filePath => this.processDocument(filePath, options))
      );

      batchResults.forEach((settledResult, index) => {
        const filePath = batch[index];
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
    }

    return results;
  }
}

// Export singleton instance
export const wordDocumentProcessor = new WordDocumentProcessor();