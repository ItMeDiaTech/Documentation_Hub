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
import { MemoryMonitor } from '@/utils/MemoryMonitor';
import { logger } from '@/utils/logger';

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

  // Style settings
  header2Spacing?: {
    spaceBefore: number;
    spaceAfter: number;
  };
  customStyles?: any; // Session styles from StylesEditor
  tableUniformitySettings?: any; // Table uniformity settings from StylesEditor
}

/**
 * Utility: Convert hex color from #RRGGBB to RRGGBB for OpenXML
 */
function stripHashFromColor(color: string): string {
  return color.startsWith('#') ? color.substring(1) : color;
}

/**
 * Utility: Convert font size from points to half-points for OpenXML
 */
function pointsToHalfPoints(points: number): number {
  return points * 2;
}

/**
 * Utility: Convert points to twips for OpenXML spacing
 */
function pointsToTwips(points: number): number {
  return points * 20;
}

export class DocumentProcessingService {
  private static instance: DocumentProcessingService;
  private log = logger.namespace('DocumentProcessor');

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
    // Memory checkpoint: Process start
    MemoryMonitor.logMemoryUsage('ProcessingService Start', `Processing: ${fileName}`);

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

      // Memory checkpoint: After ZIP load
      MemoryMonitor.logMemoryUsage('After ZIP Load', `${fileName} loaded into memory`);

      // Extract and process hyperlinks
      const hyperlinks = await this.extractHyperlinks(zip);
      result.totalHyperlinks = hyperlinks.length;
      this.log.info(`Found ${hyperlinks.length} hyperlinks in document`);

      // Memory checkpoint: After hyperlink extraction
      MemoryMonitor.logMemoryUsage('After Hyperlink Extraction', `${hyperlinks.length} hyperlinks extracted`);

      if (hyperlinks.length > 0 && (options.fixContentIds || options.updateTitles)) {
        // Process hyperlinks with API if PowerAutomate URL is configured
        if (powerAutomateUrl) {
          this.log.debug('Processing hyperlinks with PowerAutomate API:', powerAutomateUrl);
          const apiSettings = {
            apiUrl: powerAutomateUrl,
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 1000,
          };

          // Call API with extracted hyperlinks
          this.log.debug('Calling hyperlink service with', hyperlinks.length, 'hyperlinks');
          const apiResponse = await hyperlinkService.processHyperlinksWithApi(
            hyperlinks,
            apiSettings
          );
          this.log.info('API Response success:', apiResponse.success);

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

            // Memory checkpoint: After XML processing
            MemoryMonitor.logMemoryUsage('After XML Processing', 'Hyperlink fixes applied');
          } else {
            result.errorMessages.push(apiResponse.error || 'API request failed');
          }
        } else {
          result.errorMessages.push('PowerAutomate URL not configured');
        }
      }

      // Apply other processing options if needed
      if (options.removeWhitespace || options.removeParagraphLines || options.removeItalics) {
        const formattingChanges = await this.applyTextFormatting(zip, options);
        result.processedLinks.push(...formattingChanges);
      }

      // Memory checkpoint: Before document generation
      MemoryMonitor.logMemoryUsage('Before Document Generation', 'Ready to generate processed document');

      // Generate the processed document
      const processedData = await zip.generateAsync({ type: 'arraybuffer' });

      // Memory checkpoint: After document generation
      MemoryMonitor.logMemoryUsage('After Document Generation', 'Document generation complete');
      MemoryMonitor.compareCheckpoints('ProcessingService Start', 'After Document Generation');

      result.success = true;
      result.duration = Date.now() - startTime;

      return {
        processedData,
        result,
      };
    } catch (error) {
      // Memory checkpoint: On error
      MemoryMonitor.logMemoryUsage('ProcessingService Error', `Error: ${error instanceof Error ? error.message : 'Unknown'}`);
      MemoryMonitor.compareCheckpoints('ProcessingService Start', 'ProcessingService Error');

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
  ): Promise<any[]> {
    const documentXml = await this.getXmlContent(zip, 'word/document.xml');
    if (!documentXml) return [];

    const changes: any[] = [];

    // Apply formatting options
    if (options.removeWhitespace) {
      const whitespaceChanges = this.removeExtraWhitespace(documentXml);
      changes.push(...whitespaceChanges);
    }

    if (options.removeParagraphLines) {
      const paragraphChanges = this.removeExtraParagraphs(documentXml);
      changes.push(...paragraphChanges);
    }

    if (options.removeItalics) {
      this.removeItalics(documentXml);
    }

    if (options.assignStyles) {
      const styleChanges = this.assignStyles(documentXml);
      changes.push(...styleChanges);
    }

    // Apply custom style properties from session styles
    if (options.customStyles) {
      const customStyleChanges = this.applyCustomStyleProperties(documentXml, options.customStyles);
      changes.push(...customStyleChanges);
    }

    if (options.header2Spacing) {
      const spacingChanges = this.applyHeader2Spacing(documentXml, options.header2Spacing);
      changes.push(...spacingChanges);
    }

    // Apply table uniformity settings
    if (options.tableUniformitySettings) {
      const tableChanges = this.applyTableUniformity(documentXml, options.tableUniformitySettings);
      changes.push(...tableChanges);
    }

    await this.setXmlContent(zip, 'word/document.xml', documentXml);

    return changes;
  }

  /**
   * Apply spacing to Header 2 paragraphs
   */
  private applyHeader2Spacing(xmlContent: any, spacing: { spaceBefore: number; spaceAfter: number }): any[] {
    const changes: any[] = [];

    const applySpacing = (obj: any): void => {
      if (!obj) return;

      if (obj['w:p']) {
        const paragraphs = Array.isArray(obj['w:p']) ? obj['w:p'] : [obj['w:p']];

        for (const p of paragraphs) {
          // Check if this is a Header 2 paragraph
          const currentStyle = this.getCurrentParagraphStyle(p);

          if (currentStyle === 'Heading2' || currentStyle === 'Header2') {
            // Ensure paragraph properties exist
            if (!p['w:pPr']) {
              p['w:pPr'] = {};
            }

            const pPr = Array.isArray(p['w:pPr']) ? p['w:pPr'][0] : p['w:pPr'];

            // Get current spacing
            const currentSpaceBefore = pPr['w:spacing']?.['@_w:before'] || 0;
            const currentSpaceAfter = pPr['w:spacing']?.['@_w:after'] || 0;

            // Apply new spacing
            if (!pPr['w:spacing']) {
              pPr['w:spacing'] = {};
            }

            const twipsBefore = spacing.spaceBefore * 20; // Convert points to twips
            const twipsAfter = spacing.spaceAfter * 20;

            pPr['w:spacing']['@_w:before'] = twipsBefore.toString();
            pPr['w:spacing']['@_w:after'] = twipsAfter.toString();

            // Track the change if spacing was different
            if (currentSpaceBefore !== twipsBefore || currentSpaceAfter !== twipsAfter) {
              const text = this.extractParagraphText(p);
              changes.push({
                type: 'style',
                description: 'Applied Header 2 spacing',
                before: `"${text}" - Spacing: ${currentSpaceBefore/20}pt before, ${currentSpaceAfter/20}pt after`,
                after: `"${text}" - Spacing: ${spacing.spaceBefore}pt before, ${spacing.spaceAfter}pt after`
              });
            }
          }
        }
      }

      // Recursively process children
      for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
          applySpacing(obj[key]);
        }
      }
    };

    applySpacing(xmlContent);
    return changes;
  }

  /**
   * Assign styles to paragraphs based on content patterns
   */
  private assignStyles(xmlContent: any): any[] {
    const changes: any[] = [];

    const assignStyleToParagraph = (obj: any): void => {
      if (!obj) return;

      if (obj['w:p']) {
        const paragraphs = Array.isArray(obj['w:p']) ? obj['w:p'] : [obj['w:p']];

        for (const p of paragraphs) {
          // Extract paragraph text
          const text = this.extractParagraphText(p);
          if (!text) continue;

          // Determine style based on patterns
          let styleToApply: string | null = null;

          // Check for heading patterns
          if (text.length < 100) { // Headings are typically short
            // Header 1 patterns: ALL CAPS, numbered sections like "1. ", "2. "
            if (text === text.toUpperCase() && text.length > 3) {
              styleToApply = 'Heading1';
            }
            // Header 2 patterns: Title Case at start of line, or numbered subsections
            else if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*:?\s*$/.test(text) || /^\d+\.\d+/.test(text)) {
              styleToApply = 'Heading2';
            }
          }

          if (styleToApply) {
            // Get current style
            const currentStyle = this.getCurrentParagraphStyle(p);

            if (currentStyle !== styleToApply) {
              // Apply the new style
              this.applyStyleToParagraph(p, styleToApply);

              changes.push({
                type: 'style',
                description: `Applied ${styleToApply} style`,
                before: currentStyle ? `Style: ${currentStyle}` : 'No style',
                after: `Style: ${styleToApply}`
              });
            }
          }
        }
      }

      // Recursively process children
      for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
          assignStyleToParagraph(obj[key]);
        }
      }
    };

    assignStyleToParagraph(xmlContent);
    return changes;
  }

  /**
   * Get current style of a paragraph
   */
  private getCurrentParagraphStyle(pElem: any): string | null {
    if (!pElem) return null;

    // Check for pStyle in paragraph properties
    if (pElem['w:pPr']) {
      const pPr = Array.isArray(pElem['w:pPr']) ? pElem['w:pPr'][0] : pElem['w:pPr'];
      if (pPr && pPr['w:pStyle']) {
        const pStyle = Array.isArray(pPr['w:pStyle']) ? pPr['w:pStyle'][0] : pPr['w:pStyle'];
        if (pStyle) {
          return pStyle['@_w:val'] || pStyle.$ || null;
        }
      }
    }

    return null;
  }

  /**
   * Apply a style to a paragraph
   */
  private applyStyleToParagraph(pElem: any, styleName: string): void {
    if (!pElem) return;

    // Ensure paragraph properties exist
    if (!pElem['w:pPr']) {
      pElem['w:pPr'] = {};
    }

    const pPr = Array.isArray(pElem['w:pPr']) ? pElem['w:pPr'][0] : pElem['w:pPr'];

    // Set the style
    pPr['w:pStyle'] = {
      '@_w:val': styleName
    };
  }

  /**
   * Apply custom style properties from session styles to paragraphs
   * Applies font, size, color, spacing, alignment, bold, italic, underline
   */
  private applyCustomStyleProperties(xmlContent: any, customStyles: any): any[] {
    const changes: any[] = [];
    if (!customStyles) return changes;

    const applyPropertiesToParagraph = (obj: any): void => {
      if (!obj) return;

      if (obj['w:p']) {
        const paragraphs = Array.isArray(obj['w:p']) ? obj['w:p'] : [obj['w:p']];

        for (const p of paragraphs) {
          const currentStyle = this.getCurrentParagraphStyle(p);
          let styleToApply: any = null;

          // Match paragraph to style definition
          if (currentStyle === 'Heading1' || currentStyle === 'Header1') {
            styleToApply = customStyles.header1 || customStyles.find((s: any) => s.id === 'header1');
          } else if (currentStyle === 'Heading2' || currentStyle === 'Header2') {
            styleToApply = customStyles.header2 || customStyles.find((s: any) => s.id === 'header2');
          } else {
            styleToApply = customStyles.normal || customStyles.find((s: any) => s.id === 'normal');
          }

          if (styleToApply) {
            // Ensure paragraph properties exist
            if (!p['w:pPr']) {
              p['w:pPr'] = {};
            }
            const pPr = Array.isArray(p['w:pPr']) ? p['w:pPr'][0] : p['w:pPr'];

            // Apply alignment
            if (styleToApply.alignment) {
              pPr['w:jc'] = { '@_w:val': styleToApply.alignment };
            }

            // Apply spacing (before/after)
            if (styleToApply.spaceBefore !== undefined || styleToApply.spaceAfter !== undefined) {
              if (!pPr['w:spacing']) {
                pPr['w:spacing'] = {};
              }
              if (styleToApply.spaceBefore !== undefined) {
                pPr['w:spacing']['@_w:before'] = pointsToTwips(styleToApply.spaceBefore).toString();
              }
              if (styleToApply.spaceAfter !== undefined) {
                pPr['w:spacing']['@_w:after'] = pointsToTwips(styleToApply.spaceAfter).toString();
              }
            }

            // Apply run properties to paragraph (affects all text)
            if (!pPr['w:rPr']) {
              pPr['w:rPr'] = {};
            }

            // Apply font family
            if (styleToApply.fontFamily) {
              pPr['w:rPr']['w:rFonts'] = {
                '@_w:ascii': styleToApply.fontFamily,
                '@_w:hAnsi': styleToApply.fontFamily,
                '@_w:cs': styleToApply.fontFamily
              };
            }

            // Apply font size (convert points to half-points)
            if (styleToApply.fontSize) {
              const halfPoints = pointsToHalfPoints(styleToApply.fontSize).toString();
              pPr['w:rPr']['w:sz'] = { '@_w:val': halfPoints };
              pPr['w:rPr']['w:szCs'] = { '@_w:val': halfPoints };
            }

            // Apply bold
            if (styleToApply.bold) {
              pPr['w:rPr']['w:b'] = { '@_w:val': '1' };
            }

            // Apply italic
            if (styleToApply.italic) {
              pPr['w:rPr']['w:i'] = { '@_w:val': '1' };
            }

            // Apply underline
            if (styleToApply.underline) {
              pPr['w:rPr']['w:u'] = { '@_w:val': 'single' };
            }

            // Apply color (strip # prefix)
            if (styleToApply.color) {
              pPr['w:rPr']['w:color'] = { '@_w:val': stripHashFromColor(styleToApply.color) };
            }

            // Also apply to all text runs within the paragraph
            if (p['w:r']) {
              const runs = Array.isArray(p['w:r']) ? p['w:r'] : [p['w:r']];
              for (const run of runs) {
                if (!run['w:rPr']) {
                  run['w:rPr'] = {};
                }

                // Apply same properties to each run
                if (styleToApply.fontFamily) {
                  run['w:rPr']['w:rFonts'] = {
                    '@_w:ascii': styleToApply.fontFamily,
                    '@_w:hAnsi': styleToApply.fontFamily,
                    '@_w:cs': styleToApply.fontFamily
                  };
                }
                if (styleToApply.fontSize) {
                  const halfPoints = pointsToHalfPoints(styleToApply.fontSize).toString();
                  run['w:rPr']['w:sz'] = { '@_w:val': halfPoints };
                  run['w:rPr']['w:szCs'] = { '@_w:val': halfPoints };
                }
                if (styleToApply.bold) {
                  run['w:rPr']['w:b'] = { '@_w:val': '1' };
                }
                if (styleToApply.italic) {
                  run['w:rPr']['w:i'] = { '@_w:val': '1' };
                }
                if (styleToApply.underline) {
                  run['w:rPr']['w:u'] = { '@_w:val': 'single' };
                }
                if (styleToApply.color) {
                  run['w:rPr']['w:color'] = { '@_w:val': stripHashFromColor(styleToApply.color) };
                }
              }
            }

            // Track the change
            const text = this.extractParagraphText(p);
            changes.push({
              type: 'style',
              description: `Applied custom ${styleToApply.name || styleToApply.id} formatting`,
              before: `"${text}" - Default formatting`,
              after: `"${text}" - ${styleToApply.fontFamily} ${styleToApply.fontSize}pt ${styleToApply.bold ? 'Bold' : ''} ${styleToApply.color}`
            });
          }
        }
      }

      // Recursively process children
      for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
          applyPropertiesToParagraph(obj[key]);
        }
      }
    };

    applyPropertiesToParagraph(xmlContent);
    return changes;
  }

  /**
   * Remove extra whitespace from document
   */
  private removeExtraWhitespace(xmlContent: any): any[] {
    const changes: any[] = [];

    const processText = (obj: any): void => {
      if (!obj) return;

      if (obj['w:t']) {
        const texts = Array.isArray(obj['w:t']) ? obj['w:t'] : [obj['w:t']];
        for (const t of texts) {
          let original = '';
          let cleaned = '';

          if (typeof t === 'string') {
            original = t;
            cleaned = t.replace(/\s+/g, ' ').trim();
            if (original !== cleaned) {
              changes.push({
                type: 'text',
                description: 'Removed extra whitespace',
                before: original,
                after: cleaned
              });
              obj['w:t'] = cleaned;
            }
          } else if (t._) {
            original = t._;
            cleaned = t._.replace(/\s+/g, ' ').trim();
            if (original !== cleaned) {
              changes.push({
                type: 'text',
                description: 'Removed extra whitespace',
                before: original,
                after: cleaned
              });
              t._ = cleaned;
            }
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
    return changes;
  }

  /**
   * Remove extra paragraphs (empty paragraph elements)
   */
  private removeExtraParagraphs(xmlContent: any): any[] {
    const changes: any[] = [];
    const paragraphsToRemove: any[] = [];

    // Helper to check if paragraph is empty
    const isParagraphEmpty = (pElem: any): boolean => {
      if (!pElem) return true;

      // Check if paragraph has text content
      const hasText = (obj: any): boolean => {
        if (!obj) return false;

        if (obj['w:t']) {
          const texts = Array.isArray(obj['w:t']) ? obj['w:t'] : [obj['w:t']];
          for (const t of texts) {
            const text = typeof t === 'string' ? t : (t._ || t['#text'] || '');
            if (text.trim().length > 0) return true;
          }
        }

        for (const key in obj) {
          if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
            if (hasText(obj[key])) return true;
          }
        }

        return false;
      };

      return !hasText(pElem);
    };

    // Helper to extract text from surrounding paragraphs for context
    const extractContext = (paragraphs: any[], currentIndex: number): { before: string[]; after: string[] } => {
      const before: string[] = [];
      const after: string[] = [];

      // Get 2 lines before
      for (let i = Math.max(0, currentIndex - 2); i < currentIndex; i++) {
        const text = this.extractParagraphText(paragraphs[i]);
        if (text) before.push(text);
      }

      // Get 2 lines after
      for (let i = currentIndex + 1; i < Math.min(paragraphs.length, currentIndex + 3); i++) {
        const text = this.extractParagraphText(paragraphs[i]);
        if (text) after.push(text);
      }

      return { before, after };
    };

    // Find all paragraphs in the document body
    const findAndRemoveEmptyParagraphs = (obj: any, path: string = ''): void => {
      if (!obj) return;

      // Check for w:body which contains paragraphs
      if (obj['w:body']) {
        const body = obj['w:body'];
        const paragraphs: any[] = [];

        // Collect all paragraphs
        const collectParagraphs = (node: any): void => {
          if (Array.isArray(node)) {
            node.forEach(item => collectParagraphs(item));
          } else if (node && typeof node === 'object') {
            if (node['w:p']) {
              const pArray = Array.isArray(node['w:p']) ? node['w:p'] : [node['w:p']];
              paragraphs.push(...pArray);
            }
            Object.keys(node).forEach(key => {
              if (key !== 'w:p') collectParagraphs(node[key]);
            });
          }
        };

        collectParagraphs(body);

        // Find empty paragraphs with context
        paragraphs.forEach((p, index) => {
          if (isParagraphEmpty(p)) {
            const context = extractContext(paragraphs, index);
            paragraphsToRemove.push(p);

            changes.push({
              type: 'deletion',
              description: 'Removed empty paragraph',
              before: context.before.length > 0 ? context.before.join('\n') + '\n[Empty Line]\n' + context.after.join('\n') : '[Empty Line]',
              after: context.before.length > 0 ? context.before.join('\n') + '\n' + context.after.join('\n') : ''
            });
          }
        });

        // Remove empty paragraphs
        const removeFromBody = (node: any): any => {
          if (Array.isArray(node)) {
            return node.map(item => removeFromBody(item)).filter(item => item !== null);
          } else if (node && typeof node === 'object') {
            if (node['w:p']) {
              const pArray = Array.isArray(node['w:p']) ? node['w:p'] : [node['w:p']];
              const filtered = pArray.filter((p: any) => !paragraphsToRemove.includes(p));
              if (filtered.length === 0) {
                delete node['w:p'];
              } else {
                node['w:p'] = Array.isArray(node['w:p']) ? filtered : filtered[0];
              }
            }

            Object.keys(node).forEach(key => {
              if (key !== 'w:p') {
                node[key] = removeFromBody(node[key]);
              }
            });
          }
          return node;
        };

        removeFromBody(body);
      }

      // Continue traversing
      for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object' && key !== 'w:body') {
          findAndRemoveEmptyParagraphs(obj[key], `${path}/${key}`);
        }
      }
    };

    findAndRemoveEmptyParagraphs(xmlContent);
    return changes;
  }

  /**
   * Extract text content from a paragraph element
   */
  private extractParagraphText(pElem: any): string {
    if (!pElem) return '';

    let text = '';

    const extractText = (obj: any): void => {
      if (!obj) return;

      if (obj['w:t']) {
        const texts = Array.isArray(obj['w:t']) ? obj['w:t'] : [obj['w:t']];
        for (const t of texts) {
          text += typeof t === 'string' ? t : (t._ || t['#text'] || '');
        }
      }

      for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
          extractText(obj[key]);
        }
      }
    };

    extractText(pElem);
    return text.trim();
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
   * Apply table uniformity settings including header row shading
   */
  private applyTableUniformity(xmlContent: any, tableSettings: any): any[] {
    const changes: any[] = [];
    if (!tableSettings) return changes;

    const applyToTables = (obj: any): void => {
      if (!obj) return;

      // Look for table elements (w:tbl)
      if (obj['w:tbl']) {
        const tables = Array.isArray(obj['w:tbl']) ? obj['w:tbl'] : [obj['w:tbl']];

        for (const table of tables) {
          // Find table rows (w:tr)
          if (table['w:tr']) {
            const rows = Array.isArray(table['w:tr']) ? table['w:tr'] : [table['w:tr']];

            if (rows.length > 0 && tableSettings.headerRowShaded) {
              const headerRow = rows[0]; // First row is typically the header
              const shadingColor = tableSettings.headerRowShadingColor || '#D3D3D3';

              // Apply shading to all cells in header row
              if (headerRow['w:tc']) {
                const cells = Array.isArray(headerRow['w:tc']) ? headerRow['w:tc'] : [headerRow['w:tc']];

                for (const cell of cells) {
                  // Ensure cell properties exist
                  if (!cell['w:tcPr']) {
                    cell['w:tcPr'] = {};
                  }
                  const tcPr = Array.isArray(cell['w:tcPr']) ? cell['w:tcPr'][0] : cell['w:tcPr'];

                  // Apply shading with color (strip # prefix)
                  tcPr['w:shd'] = {
                    '@_w:val': 'clear',
                    '@_w:color': 'auto',
                    '@_w:fill': stripHashFromColor(shadingColor)
                  };

                  // Apply bold if specified
                  if (tableSettings.headerRowBold) {
                    // Apply bold to all text runs in the cell
                    if (cell['w:p']) {
                      const paragraphs = Array.isArray(cell['w:p']) ? cell['w:p'] : [cell['w:p']];
                      for (const p of paragraphs) {
                        if (p['w:r']) {
                          const runs = Array.isArray(p['w:r']) ? p['w:r'] : [p['w:r']];
                          for (const run of runs) {
                            if (!run['w:rPr']) {
                              run['w:rPr'] = {};
                            }
                            run['w:rPr']['w:b'] = { '@_w:val': '1' };
                          }
                        }
                      }
                    }
                  }
                }

                changes.push({
                  type: 'table',
                  description: 'Applied table header row formatting',
                  before: 'No shading',
                  after: `Shaded with ${shadingColor}${tableSettings.headerRowBold ? ', bold text' : ''}`
                });
              }
            }
          }
        }
      }

      // Recursively process children
      for (const key in obj) {
        if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
          applyToTables(obj[key]);
        }
      }
    };

    applyToTables(xmlContent);
    return changes;
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