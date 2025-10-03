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

      // Save the modified document
      if (processedData.modifiedCount > 0) {
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
    const hyperlinks: HyperlinkData[] = [];

    // Parse main document relationships
    const mainRelsPath = 'word/_rels/document.xml.rels';
    const mainRelsXml = await zip.file(mainRelsPath)?.async('string');
    if (!mainRelsXml) return hyperlinks;

    const mainRelsData = this.xmlParser.parse(mainRelsXml);
    const mainRelationships = this.extractRelationshipsFromData(mainRelsData);

    // Parse document.xml for hyperlink elements
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) return hyperlinks;

    const docData = this.xmlParser.parse(documentXml);

    // Extract hyperlinks from main document
    this.extractHyperlinksFromDocument(docData, mainRelationships, 'document.xml', hyperlinks);

    // Also check headers and footers
    const entries = zip.filter((relativePath, file) => {
      return !!relativePath.match(/word\/(header|footer)\d+\.xml$/);
    });

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

    return hyperlinks;
  }

  /**
   * Extract relationships from parsed XML data
   */
  private extractRelationshipsFromData(relsData: any): Map<string, string> {
    const relationships = new Map<string, string>();
    const rels = relsData?.Relationships?.Relationship || [];
    const relsArray = Array.isArray(rels) ? rels : [rels];

    for (const rel of relsArray) {
      if (rel['@_Type']?.includes('hyperlink')) {
        relationships.set(rel['@_Id'], rel['@_Target']);
      }
    }

    return relationships;
  }

  /**
   * Extract hyperlinks from document data
   */
  private extractHyperlinksFromDocument(
    docData: any,
    relationships: Map<string, string>,
    containingPart: string,
    hyperlinks: HyperlinkData[]
  ): void {
    // Traverse the document tree to find hyperlinks
    this.traverseElement(docData, (element: any) => {
      if (element['w:hyperlink']) {
        const hyperlinkElement = element['w:hyperlink'];
        const relationshipId = hyperlinkElement['@_r:id'];

        if (relationshipId && relationships.has(relationshipId)) {
          const target = relationships.get(relationshipId) || '';
          const displayText = this.extractDisplayText(hyperlinkElement);

          hyperlinks.push({
            relationshipId,
            target,
            displayText,
            element: hyperlinkElement,
            containingPart
          });

          // Cache for quick lookup
          this.hyperlinkCache.set(relationshipId, hyperlinks[hyperlinks.length - 1]);
        }
      }
    });
  }

  /**
   * Traverse XML element tree
   */
  private traverseElement(element: any, callback: (el: any) => void): void {
    if (!element || typeof element !== 'object') return;

    callback(element);

    for (const key in element) {
      if (key.startsWith('@_')) continue; // Skip attributes

      if (Array.isArray(element[key])) {
        for (const item of element[key]) {
          this.traverseElement(item, callback);
        }
      } else if (typeof element[key] === 'object') {
        this.traverseElement(element[key], callback);
      }
    }
  }

  /**
   * Extract display text from hyperlink element
   */
  private extractDisplayText(hyperlinkElement: any): string {
    let text = '';

    // Navigate to w:r/w:t elements
    const runs = hyperlinkElement['w:r'];
    const runsArray = Array.isArray(runs) ? runs : (runs ? [runs] : []);

    for (const run of runsArray) {
      const textElement = run['w:t'];
      if (textElement) {
        if (typeof textElement === 'string') {
          text += textElement;
        } else if (textElement['#text']) {
          text += textElement['#text'];
        }
      }
    }

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
      console.log(`Examining hyperlink: ${hyperlink.target.substring(0, 100)}...`);

      const contentId = this.extractContentId(hyperlink.target);
      if (contentId) {
        console.log(`  - Found Content_ID: ${contentId}`);
        if (!uniqueIds.has(contentId)) {
          lookupIds.push(contentId);
          uniqueIds.add(contentId);
        }
      }

      const documentId = this.extractDocumentId(hyperlink.target);
      if (documentId) {
        console.log(`  - Found Document_ID: ${documentId}`);
        if (!uniqueIds.has(documentId)) {
          lookupIds.push(documentId);
          uniqueIds.add(documentId);
        }
      }

      if (!contentId && !documentId) {
        console.log(`  - No IDs found in this hyperlink`);
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
    for (const [partName, partHyperlinks] of hyperlinksByPart) {
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

        // Find matching API result
        const apiResult = this.findApiResult(hyperlink.target, apiResults);

        if (apiResult) {
          // Phase 3: Update URL to Document_ID format using proper XML manipulation
          if (apiResult.Document_ID && options.operations?.fixContentIds) {
            const oldUrl = hyperlink.target;
            const newUrl = `https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=${apiResult.Document_ID.trim()}`;

            if (oldUrl !== newUrl) {
              // Update in parsed relationships object (NOT string manipulation)
              const updated = this.updateRelationshipTarget(relsData, hyperlink.relationshipId, newUrl);
              if (updated) {
                relsModified = true;
                hyperlink.target = newUrl;
                urlsUpdated++;
                modified = true;
                changes.push(`URL: ${oldUrl} → ${newUrl}`);
              }
            }
          }

          // Phase 4: Update display text with Title and Content_ID
          if (options.operations?.updateTitles) {
            const oldDisplayText = hyperlink.displayText;
            let newDisplayText = oldDisplayText;

            // Remove existing Content_ID pattern (4-6 digits in parentheses)
            newDisplayText = newDisplayText.replace(/\s*\(\d{4,6}\)\s*$/g, '');

            // Update with API title if different
            if (apiResult.Title && newDisplayText.trim() !== apiResult.Title.trim()) {
              newDisplayText = apiResult.Title.trim();
            }

            // Append Content_ID (last 6 digits)
            if (apiResult.Content_ID) {
              const contentIdMatch = apiResult.Content_ID.match(/(\d+)$/);
              if (contentIdMatch) {
                const digits = contentIdMatch[1].padStart(6, '0').slice(-6);
                newDisplayText = `${newDisplayText} (${digits})`;
              }
            }

            // Add status indicators
            if (apiResult.Status?.trim().toLowerCase() === 'expired') {
              newDisplayText += ' - Expired';
            }

            if (newDisplayText !== oldDisplayText) {
              const updated = this.updateHyperlinkDisplayText(partData, hyperlink.relationshipId, newDisplayText);
              if (updated) {
                partModified = true;
                hyperlink.displayText = newDisplayText;
                displayTextsUpdated++;
                modified = true;
                changes.push(`Display: ${oldDisplayText} → ${newDisplayText}`);
              }
            }
          }
        } else if (lookupIds.length > 0 && this.isTheSourceUrl(hyperlink.target)) {
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
              changes.push(`Display: ${oldDisplayText} → ${newDisplayText}`);
            }
          }
        }

        if (modified) {
          modifiedCount++;
        }

        processedLinks.push({
          id: hyperlink.relationshipId,
          url: hyperlink.target,
          displayText: hyperlink.displayText,
          type: 'external' as HyperlinkType,
          location: hyperlink.containingPart,
          status: modified ? 'modified' : 'unchanged',
          modifications: changes,
          before: processedCount > 0 ? partHyperlinks[processedCount - 1]?.displayText : '',
          after: hyperlink.displayText
        });
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
   * Call PowerAutomate API with Lookup_IDs
   */
  private async callPowerAutomateApi(apiUrl: string, lookupIds: string[]): Promise<any> {
    console.log('\n--- PowerAutomate API Call Details ---');
    console.log('URL:', apiUrl);
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
          const response = await fetch(apiUrl, {
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

          // Parse response format: { StatusCode, Body: { Results: [...] } }
          if (data.Body?.Results) {
            console.log(`✓ API SUCCESS - Found ${data.Body.Results.length} results`);
            return {
              results: data.Body.Results.map((r: any) => ({
                Document_ID: r.Document_ID?.trim() || '',
                Content_ID: r.Content_ID?.trim() || '',
                Title: r.Title?.trim() || '',
                Status: r.Status?.trim() || 'Active'
              }))
            };
          } else {
            console.warn('⚠️  Response does not contain Body.Results structure');
            console.warn('Expected: { Body: { Results: [...] } }');
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
    const match = url.match(/([TC][SM][RS]C?-[A-Za-z0-9]+-\d{6})/i);
    return match ? match[1] : null;
  }

  /**
   * Extract Document_ID from URL
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
      if (element['w:hyperlink'] && element['w:hyperlink']['@_r:id'] === relationshipId) {
        const hyperlinkElement = element['w:hyperlink'];
        const runs = hyperlinkElement['w:r'];
        const runsArray = Array.isArray(runs) ? runs : (runs ? [runs] : []);

        if (runsArray.length > 0) {
          // Update first text run, clear others
          let firstRun = true;
          for (const run of runsArray) {
            if (run['w:t']) {
              if (firstRun) {
                if (typeof run['w:t'] === 'string') {
                  run['w:t'] = newText;
                } else {
                  run['w:t']['#text'] = newText;
                }
                firstRun = false;
                updated = true;
              } else {
                delete run['w:t'];
              }
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
   */
  private updateRelationshipTarget(relsData: any, relationshipId: string, newTarget: string): boolean {
    let updated = false;

    // With preserveOrder: true, the structure is different
    if (Array.isArray(relsData)) {
      for (const item of relsData) {
        if (item.Relationships) {
          const result = this.updateRelationshipTarget(item.Relationships, relationshipId, newTarget);
          if (result) updated = true;
        } else if (item.Relationship) {
          const rels = Array.isArray(item.Relationship) ? item.Relationship : [item.Relationship];
          for (const rel of rels) {
            if (rel['@_Id'] === relationshipId) {
              rel['@_Target'] = newTarget;
              updated = true;
            }
          }
        }
      }
    } else if (relsData.Relationships) {
      return this.updateRelationshipTarget(relsData.Relationships, relationshipId, newTarget);
    } else if (relsData.Relationship) {
      const rels = Array.isArray(relsData.Relationship) ? relsData.Relationship : [relsData.Relationship];
      for (const rel of rels) {
        if (rel['@_Id'] === relationshipId) {
          rel['@_Target'] = newTarget;
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