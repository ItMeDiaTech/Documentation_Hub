import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {
  DetailedHyperlinkInfo,
  HyperlinkType,
  HyperlinkProcessingResult,
  HyperlinkFixingOptions,
} from '@/types/hyperlink';
import { Document } from '@/types/session';
import { hyperlinkService } from './HyperlinkService';

// Initialize XML parser with options
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  trimValues: true,
  processEntities: false,
  parseTagValue: false,
  preserveOrder: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text'
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  format: false,
  suppressEmptyNode: false,
  preserveOrder: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text'
});

export interface ProcessingOptions {
  // Hyperlink options
  fixContentIds?: boolean;
  updateTitles?: boolean;
  fixInternalHyperlinks?: boolean;
  updateTopHyperlinks?: boolean;
  updateTocHyperlinks?: boolean;

  // Other processing options
  removeWhitespace?: boolean;
  removeParagraphLines?: boolean;
  removeItalics?: boolean;
  assignStyles?: boolean;
  centerImages?: boolean;
  fixKeywords?: boolean;
  listIndentation?: boolean;
  bulletUniformity?: boolean;
  tableUniformity?: boolean;
}

export class DocumentProcessingService {
  private static instance: DocumentProcessingService;

  private constructor() {}

  public static getInstance(): DocumentProcessingService {
    if (!DocumentProcessingService.instance) {
      DocumentProcessingService.instance = new DocumentProcessingService();
    }
    return DocumentProcessingService.instance;
  }

  /**
   * Process a document file with the given options
   */
  public async processDocument(
    fileData: ArrayBuffer,
    fileName: string,
    options: ProcessingOptions,
    powerAutomateUrl?: string
  ): Promise<{
    processedData: ArrayBuffer;
    result: HyperlinkProcessingResult;
  }> {
    const startTime = Date.now();
    const result: HyperlinkProcessingResult = {
      success: false,
      totalHyperlinks: 0,
      processedHyperlinks: 0,
      modifiedHyperlinks: 0,
      skippedHyperlinks: 0,
      errorCount: 0,
      errorMessages: [],
      processedLinks: [],
      duration: 0,
    };

    try {
      // Load the .docx file as a zip
      const zip = await JSZip.loadAsync(fileData);

      // Extract and process hyperlinks
      const hyperlinks = await this.extractHyperlinks(zip);
      result.totalHyperlinks = hyperlinks.length;
      console.log(`Found ${hyperlinks.length} hyperlinks in document`);

      if (hyperlinks.length > 0 && (options.fixContentIds || options.updateTitles)) {
        // Process hyperlinks with API if PowerAutomate URL is configured
        if (powerAutomateUrl) {
          console.log('Processing hyperlinks with PowerAutomate API:', powerAutomateUrl);
          const apiSettings = {
            apiUrl: powerAutomateUrl,
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 1000,
          };

          // Call API with extracted hyperlinks
          console.log('Calling hyperlink service with', hyperlinks.length, 'hyperlinks');
          const apiResponse = await hyperlinkService.processHyperlinksWithApi(
            hyperlinks,
            apiSettings
          );
          console.log('API Response success:', apiResponse.success);

          if (apiResponse.success && apiResponse.body?.results) {
            // Apply fixes based on API response
            const changes = await this.applyHyperlinkFixes(
              zip,
              hyperlinks,
              apiResponse.body.results,
              options
            );

            result.processedHyperlinks = hyperlinks.length;
            result.modifiedHyperlinks = hyperlinks.filter(h =>
              h.url.includes('thesource.cvshealth.com')
            ).length;
            result.processedLinks = changes;
          } else {
            result.errorMessages.push(apiResponse.error || 'API request failed');
          }
        } else {
          result.errorMessages.push('PowerAutomate URL not configured');
        }
      }

      // Apply other processing options if needed
      if (options.removeWhitespace || options.removeParagraphLines || options.removeItalics) {
        await this.applyTextFormatting(zip, options);
      }

      // Generate the processed document
      const processedData = await zip.generateAsync({ type: 'arraybuffer' });

      result.success = true;
      result.duration = Date.now() - startTime;

      return {
        processedData,
        result,
      };
    } catch (error) {
      result.errorMessages.push(error instanceof Error ? error.message : 'Unknown error');
      result.duration = Date.now() - startTime;

      // Return original data on error
      return {
        processedData: fileData,
        result,
      };
    }
  }

  /**
   * Extract hyperlinks from document
   */
  private async extractHyperlinks(zip: JSZip): Promise<DetailedHyperlinkInfo[]> {
    const hyperlinks: DetailedHyperlinkInfo[] = [];

    // Get document.xml
    const documentXml = await this.getXmlContent(zip, 'word/document.xml');
    if (documentXml) {
      await this.extractHyperlinksFromXml(documentXml, 'document.xml', hyperlinks);
    }

    // Get relationships
    const relsXml = await this.getXmlContent(zip, 'word/_rels/document.xml.rels');
    if (relsXml) {
      await this.enrichHyperlinksWithRelationships(relsXml, hyperlinks);
    }

    // Process headers
    for (let i = 1; i <= 10; i++) {
      const headerXml = await this.getXmlContent(zip, `word/header${i}.xml`);
      if (headerXml) {
        await this.extractHyperlinksFromXml(headerXml, `header${i}.xml`, hyperlinks);

        const headerRels = await this.getXmlContent(zip, `word/_rels/header${i}.xml.rels`);
        if (headerRels) {
          await this.enrichHyperlinksWithRelationships(headerRels, hyperlinks);
        }
      }
    }

    // Process footers
    for (let i = 1; i <= 10; i++) {
      const footerXml = await this.getXmlContent(zip, `word/footer${i}.xml`);
      if (footerXml) {
        await this.extractHyperlinksFromXml(footerXml, `footer${i}.xml`, hyperlinks);

        const footerRels = await this.getXmlContent(zip, `word/_rels/footer${i}.xml.rels`);
        if (footerRels) {
          await this.enrichHyperlinksWithRelationships(footerRels, hyperlinks);
        }
      }
    }

    return hyperlinks;
  }

  /**
   * Extract hyperlinks from XML content
   */
  private async extractHyperlinksFromXml(
    xmlContent: any,
    partName: string,
    hyperlinks: DetailedHyperlinkInfo[]
  ): Promise<void> {
    // Look for hyperlink elements in the document
    const findHyperlinks = (obj: any, path: string = ''): void => {
      if (!obj) return;

      // Check if this is a hyperlink element
      if (obj['w:hyperlink']) {
        const hyperlinkElem = Array.isArray(obj['w:hyperlink'])
          ? obj['w:hyperlink']
          : [obj['w:hyperlink']];

        for (const h of hyperlinkElem) {
          if (h.$ && h.$['r:id']) {
            const relationshipId = h.$['r:id'];

            // Extract display text
            let displayText = '';
            const extractText = (elem: any): void => {
              if (elem['w:t']) {
                const texts = Array.isArray(elem['w:t']) ? elem['w:t'] : [elem['w:t']];
                for (const t of texts) {
                  if (typeof t === 'string') {
                    displayText += t;
                  } else if (t._) {
                    displayText += t._;
                  }
                }
              }
              if (elem['w:r']) {
                const runs = Array.isArray(elem['w:r']) ? elem['w:r'] : [elem['w:r']];
                for (const run of runs) {
                  extractText(run);
                }
              }
            };
            extractText(h);

            hyperlinks.push({
              id: relationshipId,
              relationshipId: relationshipId,
              element: h,
              containingPart: partName,
              url: '', // Will be filled from relationships
              displayText: displayText.trim(),
              type: 'external' as HyperlinkType,
              isInternal: false,
              isValid: true,
            });
          }
        }
      }

      // Recursively search through the object
      for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
          findHyperlinks(obj[key], `${path}/${key}`);
        }
      }
    };

    findHyperlinks(xmlContent);
  }

  /**
   * Enrich hyperlinks with URL information from relationships
   */
  private async enrichHyperlinksWithRelationships(
    relsXml: any,
    hyperlinks: DetailedHyperlinkInfo[]
  ): Promise<void> {
    if (relsXml.Relationships && relsXml.Relationships.Relationship) {
      const relationships = Array.isArray(relsXml.Relationships.Relationship)
        ? relsXml.Relationships.Relationship
        : [relsXml.Relationships.Relationship];

      for (const rel of relationships) {
        if (rel.$ && rel.$.Type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink') {
          const id = rel.$.Id;
          const target = rel.$.Target;

          // Find matching hyperlink and update URL
          const hyperlink = hyperlinks.find(h => h.relationshipId === id);
          if (hyperlink) {
            hyperlink.url = target;
            hyperlink.isInternal = !target.startsWith('http');
          }
        }
      }
    }
  }

  /**
   * Apply hyperlink fixes based on API response
   */
  private async applyHyperlinkFixes(
    zip: JSZip,
    hyperlinks: DetailedHyperlinkInfo[],
    apiResults: any[],
    options: ProcessingOptions
  ): Promise<any[]> {
    const changes: any[] = [];
    // Group hyperlinks by containing part
    const hyperlinksByPart = new Map<string, DetailedHyperlinkInfo[]>();
    for (const hyperlink of hyperlinks) {
      if (!hyperlinksByPart.has(hyperlink.containingPart)) {
        hyperlinksByPart.set(hyperlink.containingPart, []);
      }
      hyperlinksByPart.get(hyperlink.containingPart)!.push(hyperlink);
    }

    // Process each part
    for (const [partName, partHyperlinks] of hyperlinksByPart) {
      // Update relationships file
      const relsPath = partName === 'document.xml'
        ? 'word/_rels/document.xml.rels'
        : `word/_rels/${partName}.rels`;

      const relsXml = await this.getXmlContent(zip, relsPath);
      if (relsXml) {
        await this.updateRelationships(relsXml, partHyperlinks, apiResults);
        await this.setXmlContent(zip, relsPath, relsXml);
      }

      // Update display text in document
      const documentPath = partName === 'document.xml'
        ? 'word/document.xml'
        : `word/${partName}`;

      const documentXml = await this.getXmlContent(zip, documentPath);
      if (documentXml && options.updateTitles) {
        const textChanges = await this.updateDisplayText(documentXml, partHyperlinks, apiResults);
        await this.setXmlContent(zip, documentPath, documentXml);
        changes.push(...textChanges);
      }
    }

    return changes;
  }

  /**
   * Update relationship URLs based on API results
   */
  private async updateRelationships(
    relsXml: any,
    hyperlinks: DetailedHyperlinkInfo[],
    apiResults: any[]
  ): Promise<void> {
    if (!relsXml.Relationships?.Relationship) return;

    const relationships = Array.isArray(relsXml.Relationships.Relationship)
      ? relsXml.Relationships.Relationship
      : [relsXml.Relationships.Relationship];

    for (const rel of relationships) {
      if (rel.$ && rel.$.Type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink') {
        const hyperlink = hyperlinks.find(h => h.relationshipId === rel.$.Id);
        if (hyperlink) {
          // Find matching API result
          const apiResult = this.findMatchingApiResult(hyperlink.url, apiResults);
          if (apiResult && apiResult.Document_ID) {
            const oldUrl = rel.$.Target;
            const newUrl = `https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=${apiResult.Document_ID.trim()}`;
            // Update URL to the new format
            rel.$.Target = newUrl;
          }
        }
      }
    }
  }

  /**
   * Update display text based on API results
   */
  private async updateDisplayText(
    documentXml: any,
    hyperlinks: DetailedHyperlinkInfo[],
    apiResults: any[]
  ): Promise<any[]> {
    const changes: any[] = [];
    for (const hyperlink of hyperlinks) {
      const apiResult = this.findMatchingApiResult(hyperlink.url, apiResults);
      if (apiResult && hyperlink.element) {
        let newDisplayText = apiResult.Title?.trim() || hyperlink.displayText;

        // Append Content_ID if present
        if (apiResult.Content_ID) {
          const last6Digits = apiResult.Content_ID.slice(-6);
          newDisplayText = `${newDisplayText} (${last6Digits})`;
        }

        // Add status indicator
        if (apiResult.Status === 'Expired') {
          newDisplayText += ' - Expired';
        }

        // Track text change
        if (newDisplayText !== hyperlink.displayText) {
          changes.push({
            type: 'hyperlink',
            description: 'Updated hyperlink display text',
            before: hyperlink.displayText,
            after: newDisplayText
          });
        }

        // Update the text in the hyperlink element
        this.updateHyperlinkText(hyperlink.element, newDisplayText);
      } else if (!apiResult) {
        // Not found - add indicator
        const newText = `${hyperlink.displayText} - Not Found`;
        changes.push({
          type: 'hyperlink',
          description: 'Marked hyperlink as not found',
          before: hyperlink.displayText,
          after: newText
        });
        this.updateHyperlinkText(hyperlink.element, newText);
      }
    }

    return changes;
  }

  /**
   * Update text within a hyperlink element
   */
  private updateHyperlinkText(hyperlinkElem: any, newText: string): void {
    if (!hyperlinkElem) return;

    // Find and update text runs
    const updateText = (elem: any): void => {
      if (elem['w:r']) {
        const runs = Array.isArray(elem['w:r']) ? elem['w:r'] : [elem['w:r']];
        // Update first text run with new text, remove others
        let firstRun = true;
        for (const run of runs) {
          if (run['w:t']) {
            if (firstRun) {
              const texts = Array.isArray(run['w:t']) ? run['w:t'] : [run['w:t']];
              if (texts.length > 0) {
                if (typeof texts[0] === 'string') {
                  texts[0] = newText;
                } else {
                  texts[0]._ = newText;
                }
                // Remove extra text elements
                run['w:t'] = texts[0];
              }
              firstRun = false;
            } else {
              // Clear additional text runs
              delete run['w:t'];
            }
          }
        }
      }
    };

    updateText(hyperlinkElem);
  }

  /**
   * Find matching API result for a URL
   */
  private findMatchingApiResult(url: string, apiResults: any[]): any {
    // Extract IDs from URL
    const contentIdMatch = url.match(/(TSRC|CMS)-([a-zA-Z0-9]+)-(\d{6})/i);
    const docIdMatch = url.match(/docid=([a-zA-Z0-9-]+)/i);

    return apiResults.find(result => {
      const resultContentId = result.Content_ID?.trim();
      const resultDocId = result.Document_ID?.trim();

      if (contentIdMatch && resultContentId === contentIdMatch[0]) {
        return true;
      }
      if (docIdMatch && resultDocId === docIdMatch[1]) {
        return true;
      }
      return false;
    });
  }

  /**
   * Apply text formatting options
   */
  private async applyTextFormatting(
    zip: JSZip,
    options: ProcessingOptions
  ): Promise<void> {
    const documentXml = await this.getXmlContent(zip, 'word/document.xml');
    if (!documentXml) return;

    // Apply formatting options
    if (options.removeWhitespace) {
      this.removeExtraWhitespace(documentXml);
    }

    if (options.removeItalics) {
      this.removeItalics(documentXml);
    }

    await this.setXmlContent(zip, 'word/document.xml', documentXml);
  }

  /**
   * Remove extra whitespace from document
   */
  private removeExtraWhitespace(xmlContent: any): void {
    const processText = (obj: any): void => {
      if (!obj) return;

      if (obj['w:t']) {
        const texts = Array.isArray(obj['w:t']) ? obj['w:t'] : [obj['w:t']];
        for (const t of texts) {
          if (typeof t === 'string') {
            obj['w:t'] = t.replace(/\s+/g, ' ').trim();
          } else if (t._) {
            t._ = t._.replace(/\s+/g, ' ').trim();
          }
        }
      }

      for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
          processText(obj[key]);
        }
      }
    };

    processText(xmlContent);
  }

  /**
   * Remove italic formatting
   */
  private removeItalics(xmlContent: any): void {
    const removeItalic = (obj: any): void => {
      if (!obj) return;

      if (obj['w:rPr'] && obj['w:rPr']['w:i']) {
        delete obj['w:rPr']['w:i'];
      }

      for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
          removeItalic(obj[key]);
        }
      }
    };

    removeItalic(xmlContent);
  }

  /**
   * Get XML content from zip
   */
  private async getXmlContent(zip: JSZip, path: string): Promise<any> {
    const file = zip.file(path);
    if (!file) return null;

    const content = await file.async('string');
    const result = xmlParser.parse(content);

    return result;
  }

  /**
   * Set XML content in zip
   */
  private async setXmlContent(zip: JSZip, path: string, xmlContent: any): Promise<void> {
    const xmlString = xmlBuilder.build(xmlContent);
    // Add XML declaration if not present
    const xmlStringWithDeclaration = xmlString.startsWith('<?xml')
      ? xmlString
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xmlString;
    zip.file(path, xmlStringWithDeclaration);
  }
}

// Export singleton instance
export const documentProcessingService = DocumentProcessingService.getInstance();