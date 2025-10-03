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
    // Initialize XML parser with optimized settings
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: true,
      trimValues: true,
      processEntities: false,
      parseTagValue: false,
      preserveOrder: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text'
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      format: false,
      suppressEmptyNode: false,
      preserveOrder: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text'
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

    try {
      // Validate file exists and size
      const stats = await fs.stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      result.documentSize = stats.size;

      if (fileSizeMB > (options.maxFileSizeMB || this.MAX_FILE_SIZE_MB)) {
        throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB exceeds limit`);
      }

      // Create backup if requested
      if (options.createBackup) {
        const backupPath = await this.createBackup(filePath);
        result.backupPath = backupPath;
      }

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
        await this.saveDocument(zip, filePath);
      }

      result.success = true;
    } catch (error) {
      result.errorMessages.push(error instanceof Error ? error.message : 'Unknown error');
      result.errorCount++;
    } finally {
      result.duration = performance.now() - startTime;
      result.processingTimeMs = result.duration;
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
    const lookupIds: string[] = [];
    const uniqueIds = new Set<string>();

    for (const hyperlink of hyperlinks) {
      const contentId = this.extractContentId(hyperlink.target);
      if (contentId && !uniqueIds.has(contentId)) {
        lookupIds.push(contentId);
        uniqueIds.add(contentId);
      }

      const documentId = this.extractDocumentId(hyperlink.target);
      if (documentId && !uniqueIds.has(documentId)) {
        lookupIds.push(documentId);
        uniqueIds.add(documentId);
      }
    }

    // Phase 2: Call PowerAutomate API if configured and IDs found
    let apiResults: Map<string, any> = new Map();
    if (options.apiEndpoint && lookupIds.length > 0) {
      console.log(`Calling API with ${lookupIds.length} lookup IDs:`, lookupIds);
      const apiResponse = await this.callPowerAutomateApi(options.apiEndpoint, lookupIds);

      if (apiResponse?.results) {
        // Create cache for O(1) lookups
        apiResponse.results.forEach((result: any) => {
          if (result.Document_ID) {
            apiResults.set(result.Document_ID.trim(), result);
          }
          if (result.Content_ID) {
            apiResults.set(result.Content_ID.trim(), result);
          }
        });
        console.log(`API returned ${apiResponse.results.length} results`);
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

      let modifiedRelsXml = relsXml;
      const partPath = partName === 'document.xml' ? 'word/document.xml' : `word/${partName}`;
      const partXml = await zip.file(partPath)?.async('string');
      if (!partXml) continue;

      // Parse part XML for display text updates
      const partData = this.xmlParser.parse(partXml);

      for (const hyperlink of partHyperlinks) {
        processedCount++;
        let modified = false;
        const changes: string[] = [];

        // Find matching API result
        const apiResult = this.findApiResult(hyperlink.target, apiResults);

        if (apiResult) {
          // Phase 3: Update URL to Document_ID format
          if (apiResult.Document_ID && options.operations?.fixContentIds) {
            const oldUrl = hyperlink.target;
            const newUrl = `https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=${apiResult.Document_ID.trim()}`;

            if (oldUrl !== newUrl) {
              // Update in relationships file
              modifiedRelsXml = modifiedRelsXml.replace(
                new RegExp(`(<Relationship[^>]*Id="${hyperlink.relationshipId}"[^>]*Target=")${this.escapeRegExp(oldUrl)}(")`,'g'),
                `$1${newUrl}$2`
              );

              hyperlink.target = newUrl;
              urlsUpdated++;
              modified = true;
              changes.push(`URL: ${oldUrl} → ${newUrl}`);
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
              this.updateHyperlinkDisplayText(partData, hyperlink.relationshipId, newDisplayText);
              hyperlink.displayText = newDisplayText;
              displayTextsUpdated++;
              modified = true;
              changes.push(`Display: ${oldDisplayText} → ${newDisplayText}`);
            }
          }
        } else if (lookupIds.length > 0 && this.isTheSourceUrl(hyperlink.target)) {
          // ID not found in API - add indicator
          const oldDisplayText = hyperlink.displayText;
          if (!oldDisplayText.includes(' - Not Found')) {
            const newDisplayText = oldDisplayText + ' - Not Found';
            this.updateHyperlinkDisplayText(partData, hyperlink.relationshipId, newDisplayText);
            hyperlink.displayText = newDisplayText;
            displayTextsUpdated++;
            modified = true;
            changes.push(`Display: ${oldDisplayText} → ${newDisplayText}`);
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

      // Save modified files back to zip
      if (modifiedCount > 0) {
        zip.file(relsPath, modifiedRelsXml);
        // Rebuild part XML
        const rebuiltPartXml = this.xmlBuilder.build(partData);
        const partXmlWithDeclaration = rebuiltPartXml.startsWith('<?xml')
          ? rebuiltPartXml
          : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rebuiltPartXml;
        zip.file(partPath, partXmlWithDeclaration);
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
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const request = { Lookup_ID: lookupIds };

      // Retry logic with exponential backoff
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          }

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
          }

          const data = await response.json();

          // Parse response format: { StatusCode, Body: { Results: [...] } }
          if (data.Body?.Results) {
            return {
              results: data.Body.Results.map((r: any) => ({
                Document_ID: r.Document_ID?.trim() || '',
                Content_ID: r.Content_ID?.trim() || '',
                Title: r.Title?.trim() || '',
                Status: r.Status?.trim() || 'Active'
              }))
            };
          }

          return null;

        } catch (error) {
          lastError = error as Error;
          if (error instanceof Error && error.name === 'AbortError') {
            break;
          }
        }
      }

      clearTimeout(timeout);
      console.error('API call failed:', lastError);
      return null;

    } catch (error) {
      console.error('API call error:', error);
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
   */
  private updateHyperlinkDisplayText(docData: any, relationshipId: string, newText: string): void {
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
              } else {
                delete run['w:t'];
              }
            }
          }
        }
      }
    });
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