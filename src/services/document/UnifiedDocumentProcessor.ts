/**
 * UnifiedDocumentProcessor - Comprehensive DOCX processing API
 *
 * This processor extends the existing DocumentProcessor with advanced
 * formatting capabilities by integrating:
 * - DocumentReader (@omer-go/docx-parser-converter-ts) for parsing
 * - TemplateModifier (docxml) for template-based modifications
 * - DirectXmlProcessor (jszip + fast-xml-parser) for XML manipulation
 * - Existing DocumentProcessor for hyperlink operations
 *
 * Use this as the main entry point for all DOCX operations.
 */

import { DocumentProcessor } from './DocumentProcessor';
import DocumentReader from './processors/DocumentReader';
import TemplateModifier from './processors/TemplateModifier';
import DirectXmlProcessor from './processors/DirectXmlProcessor';
import StylesXmlProcessor from './utils/StylesXmlProcessor';
import NumberingXmlProcessor from './utils/NumberingXmlProcessor';
import FontTableProcessor from './utils/FontTableProcessor';
import { DocXMLaterProcessor } from './DocXMLaterProcessor'; // NEW: Working processor!
import {
  DocumentOperation as NewDocumentOperation,
  DocumentReadOptions,
  DocumentReadResult,
  DocumentModifyResult,
  TemplateData,
  ProcessorResult,
  TextStyle,
  ParagraphStyle,
  NumberingStyle,
  StyleApplication,
  StyleApplicationResult,
  DefineAndApplyStyleOptions,
} from './types/docx-processing';
import type {
  DocumentProcessingOptions,
  ProcessingResult,
  DocumentOperation,
} from '@/types/document-processing';

/**
 * Unified processor that combines all DOCX processing capabilities
 */
export class UnifiedDocumentProcessor {
  // Original processor for hyperlink operations
  private hyperlinkProcessor: DocumentProcessor;

  // NEW: Working DocXMLater processor for styles, tables, indentation, shading
  private docXMLater: DocXMLaterProcessor;

  // Old processors (broken - kept for backward compatibility but not recommended)
  private reader: DocumentReader;
  private templateModifier: TemplateModifier;
  private xmlProcessor: DirectXmlProcessor;
  private stylesProcessor: StylesXmlProcessor;
  private numberingProcessor: NumberingXmlProcessor;
  private fontProcessor: FontTableProcessor;

  constructor() {
    this.hyperlinkProcessor = new DocumentProcessor();
    this.docXMLater = new DocXMLaterProcessor(); // NEW: Working processor!

    // Old broken processors (kept for backward compatibility)
    this.reader = new DocumentReader();
    this.templateModifier = new TemplateModifier();
    this.xmlProcessor = new DirectXmlProcessor();
    this.stylesProcessor = new StylesXmlProcessor();
    this.numberingProcessor = new NumberingXmlProcessor();
    this.fontProcessor = new FontTableProcessor();
  }

  // ========== Existing Hyperlink Operations ==========

  /**
   * Process document with hyperlink operations (existing functionality)
   */
  async processDocument(
    documentPath: string,
    operations: DocumentOperation[],
    options: DocumentProcessingOptions = {}
  ): Promise<ProcessingResult> {
    return await this.hyperlinkProcessor.processDocument(documentPath, operations, options);
  }

  /**
   * Batch process multiple documents (existing functionality)
   */
  async processBatch(
    documentPaths: string[],
    operations: DocumentOperation[],
    options: DocumentProcessingOptions = {},
    concurrency: number = 4
  ): Promise<ProcessingResult[]> {
    return await this.hyperlinkProcessor.processBatch(documentPaths, operations, options, concurrency);
  }

  // ========== New Reading/Parsing Operations ==========

  /**
   * Read and parse a DOCX file with format preservation
   */
  async readDocument(
    source: Buffer | string,
    options: DocumentReadOptions = {}
  ): Promise<DocumentReadResult> {
    if (Buffer.isBuffer(source)) {
      return await this.reader.readFromBuffer(source, options);
    } else {
      return await this.reader.readFromFile(source, options);
    }
  }

  /**
   * Convert DOCX to HTML with WYSIWYG format preservation
   */
  async toHtml(buffer: Buffer): Promise<ProcessorResult<string>> {
    return await this.reader.convertToHtml(buffer);
  }

  /**
   * Convert DOCX to plain text with indentation
   */
  async toText(buffer: Buffer, withIndent: boolean = true): Promise<ProcessorResult<string>> {
    return await this.reader.convertToText(buffer, { indent: withIndent });
  }

  /**
   * Extract document metadata (styles, numbering, fonts)
   */
  async extractMetadata(buffer: Buffer): Promise<ProcessorResult<any>> {
    return await this.reader.extractMetadata(buffer);
  }

  // ========== Style Operations ==========

  /**
   * Modify styles in a DOCX document
   */
  async modifyStyles(
    buffer: Buffer,
    styleModifications: {
      action: 'add' | 'update' | 'remove';
      styleId: string;
      styleName?: string;
      properties?: TextStyle & ParagraphStyle;
    }[]
  ): Promise<DocumentModifyResult> {
    return await this.xmlProcessor.modifyStyles(buffer, (stylesXml) => {
      let modified = stylesXml;

      for (const mod of styleModifications) {
        switch (mod.action) {
          case 'add':
          case 'update':
            if (mod.styleName && mod.properties) {
              modified = this.stylesProcessor.setParagraphStyle(
                modified,
                mod.styleId,
                mod.styleName,
                mod.properties
              );
            }
            break;

          case 'remove':
            modified = this.stylesProcessor.removeStyle(modified, mod.styleId);
            break;
        }
      }

      return modified;
    });
  }

  /**
   * Apply a paragraph style to the entire document
   */
  async setDefaultParagraphStyle(
    buffer: Buffer,
    properties: TextStyle & ParagraphStyle
  ): Promise<DocumentModifyResult> {
    return await this.xmlProcessor.modifyStyles(buffer, (stylesXml) => {
      return this.stylesProcessor.setDefaultParagraphStyle(stylesXml, properties);
    });
  }

  // ========== Style Application Operations ==========

  /**
   * Apply a style to all paragraphs in the document
   */
  async applyStyleToAll(
    buffer: Buffer,
    styleId: string
  ): Promise<DocumentModifyResult & { results?: StyleApplicationResult[] }> {
    return await this.xmlProcessor.applyStylesToDocument(buffer, [
      {
        target: 'all',
        styleId,
      },
    ]);
  }

  /**
   * Apply a style to paragraphs containing specific text
   */
  async applyStyleByContent(
    buffer: Buffer,
    styleId: string,
    textPattern: string | RegExp
  ): Promise<DocumentModifyResult & { results?: StyleApplicationResult[] }> {
    return await this.xmlProcessor.applyStylesToDocument(buffer, [
      {
        target: 'pattern',
        styleId,
        pattern: textPattern,
      },
    ]);
  }

  /**
   * Apply a style to specific paragraph indices (0-based)
   */
  async applyStyleByIndices(
    buffer: Buffer,
    styleId: string,
    indices: number[]
  ): Promise<DocumentModifyResult & { results?: StyleApplicationResult[] }> {
    return await this.xmlProcessor.applyStylesToDocument(buffer, [
      {
        target: 'indices',
        styleId,
        indices,
      },
    ]);
  }

  /**
   * Apply multiple styles at once
   */
  async applyStyles(
    buffer: Buffer,
    applications: StyleApplication[]
  ): Promise<DocumentModifyResult & { results?: StyleApplicationResult[] }> {
    return await this.xmlProcessor.applyStylesToDocument(buffer, applications);
  }

  /**
   * Complete workflow: Define a style in styles.xml and apply it to paragraphs
   */
  async defineAndApplyStyle(
    buffer: Buffer,
    options: DefineAndApplyStyleOptions
  ): Promise<DocumentModifyResult & { results?: StyleApplicationResult[] }> {
    // Step 1: Define the style in styles.xml
    const styleResult = await this.modifyStyles(buffer, [
      {
        action: 'add',
        styleId: options.styleId,
        styleName: options.styleName,
        properties: options.properties,
      },
    ]);

    if (!styleResult.success || !styleResult.data) {
      return styleResult as DocumentModifyResult & { results?: StyleApplicationResult[] };
    }

    // Step 2: Apply the style to paragraphs
    const applyResult = await this.xmlProcessor.applyStylesToDocument(
      styleResult.data,
      [options.application]
    );

    return applyResult;
  }

  // ========== Bullet & Numbering Operations ==========

  /**
   * Create a new bullet list definition
   */
  async createBulletList(
    buffer: Buffer,
    options: {
      bulletChar?: string;
      levels?: number;
    } = {}
  ): Promise<DocumentModifyResult & { abstractNumId?: string; numId?: string }> {
    let abstractNumId: string | undefined;
    let numId: string | undefined;

    const result = await this.xmlProcessor.modifyNumbering(buffer, (numberingXml) => {
      // Get next available IDs
      abstractNumId = this.numberingProcessor.getNextAbstractNumId(numberingXml);
      numId = this.numberingProcessor.getNextNumId(numberingXml);

      // Create bullet list
      let modified = this.numberingProcessor.createBulletList(
        numberingXml,
        abstractNumId,
        options.bulletChar,
        options.levels
      );

      // Create numbering instance
      modified = this.numberingProcessor.createNumberingInstance(
        modified,
        numId,
        abstractNumId
      );

      return modified;
    });

    return { ...result, abstractNumId, numId };
  }

  /**
   * Create a new numbered list definition
   */
  async createNumberedList(
    buffer: Buffer,
    options: {
      format?: 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';
      levels?: number;
    } = {}
  ): Promise<DocumentModifyResult & { abstractNumId?: string; numId?: string }> {
    let abstractNumId: string | undefined;
    let numId: string | undefined;

    const result = await this.xmlProcessor.modifyNumbering(buffer, (numberingXml) => {
      abstractNumId = this.numberingProcessor.getNextAbstractNumId(numberingXml);
      numId = this.numberingProcessor.getNextNumId(numberingXml);

      let modified = this.numberingProcessor.createNumberedList(
        numberingXml,
        abstractNumId,
        options.format,
        options.levels
      );

      modified = this.numberingProcessor.createNumberingInstance(
        modified,
        numId,
        abstractNumId
      );

      return modified;
    });

    return { ...result, abstractNumId, numId };
  }

  /**
   * Update a specific level in a list
   */
  async updateListLevel(
    buffer: Buffer,
    abstractNumId: string,
    level: number,
    properties: NumberingStyle
  ): Promise<DocumentModifyResult> {
    return await this.xmlProcessor.modifyNumbering(buffer, (numberingXml) => {
      return this.numberingProcessor.updateLevel(numberingXml, abstractNumId, level, properties);
    });
  }

  // ========== Font Operations ==========

  /**
   * Add or update a font definition
   */
  async addFont(
    buffer: Buffer,
    fontName: string,
    definition: {
      charset?: string;
      family?: string;
      pitch?: string;
    }
  ): Promise<DocumentModifyResult> {
    return await this.xmlProcessor.modifyFonts(buffer, (fontTableXml) => {
      return this.fontProcessor.setFont(fontTableXml, fontName, { name: fontName, ...definition });
    });
  }

  /**
   * Add common web fonts to the document
   */
  async addWebFonts(buffer: Buffer): Promise<DocumentModifyResult> {
    return await this.xmlProcessor.modifyFonts(buffer, (fontTableXml) => {
      return this.fontProcessor.addWebFonts(fontTableXml);
    });
  }

  /**
   * Change font throughout the document
   */
  async changeFontFamily(
    buffer: Buffer,
    oldFont: string,
    newFont: string
  ): Promise<DocumentModifyResult> {
    return await this.xmlProcessor.modifyDocxComplete(buffer, {
      fonts: (fontTableXml) => {
        // Add new font if not exists
        if (!this.fontProcessor.fontExists(fontTableXml, newFont)) {
          this.fontProcessor.setFont(fontTableXml, newFont, {
            name: newFont,
            family: 'swiss',
            charset: '00',
          });
        }
        return fontTableXml;
      },
      styles: (stylesXml) => {
        // Update styles using old font to use new font
        const styles = this.stylesProcessor.getStylesByType(stylesXml, 'paragraph');
        styles.forEach(style => {
          if (style['w:rPr']?.['w:rFonts']?.['@_w:ascii'] === oldFont) {
            style['w:rPr']['w:rFonts']['@_w:ascii'] = newFont;
            style['w:rPr']['w:rFonts']['@_w:hAnsi'] = newFont;
          }
        });
        return stylesXml;
      },
    });
  }

  // ========== Template Operations ==========

  /**
   * Modify a template with data
   */
  async processTemplate(
    templateBuffer: Buffer,
    data: TemplateData
  ): Promise<DocumentModifyResult> {
    return await this.templateModifier.modifyTemplate(templateBuffer, data);
  }

  /**
   * Replace placeholders in a template
   */
  async replacePlaceholders(
    templateBuffer: Buffer,
    placeholders: Record<string, string>
  ): Promise<DocumentModifyResult> {
    return await this.templateModifier.replacePlaceholders(templateBuffer, placeholders);
  }

  // ========== Advanced Operations ==========

  /**
   * Comprehensive modification - combine multiple operations
   */
  async modifyComplete(
    buffer: Buffer,
    modifications: {
      styles?: (stylesXml: any) => any;
      numbering?: (numberingXml: any) => any;
      fonts?: (fontTableXml: any) => any;
      document?: (documentXml: any) => any;
    }
  ): Promise<DocumentModifyResult> {
    return await this.xmlProcessor.modifyDocxComplete(buffer, modifications);
  }

  // ========== NEW WORKING METHODS (Using DocXMLater) ==========
  // These methods actually work for styles, tables, indentation, and shading!

  /**
   * NEW: Create a document with working styles
   * REPLACES: modifyStyles() which is broken
   */
  async createDocumentWithWorkingStyle(
    styleId: string,
    styleName: string,
    properties: TextStyle & ParagraphStyle,
    content?: Array<{ text: string; useStyle: boolean }>
  ): Promise<DocumentModifyResult> {
    const docResult = await this.docXMLater.createDocumentWithStyle(styleId, styleName, properties);

    if (!docResult.success || !docResult.data) {
      return {
        success: false,
        error: docResult.error,
      };
    }

    const doc = docResult.data;

    // Add content if provided
    if (content) {
      for (const item of content) {
        const para = await this.docXMLater.createParagraph(doc, item.text);
        if (para.success && para.data && item.useStyle) {
          para.data.setStyle(styleId);
        }
      }
    }

    return await this.docXMLater.toBuffer(doc);
  }

  /**
   * NEW: Create a table with working borders and shading
   * REPLACES: Broken table operations
   */
  async createDocumentWithWorkingTable(
    rows: number,
    columns: number,
    options?: {
      borders?: boolean;
      borderColor?: string;
      borderSize?: number;
      headerShading?: string;
      cellData?: string[][];
    }
  ): Promise<DocumentModifyResult> {
    const doc = this.docXMLater.createNewDocument();

    const tableResult = await this.docXMLater.createTable(doc, rows, columns, {
      borders: options?.borders,
      borderColor: options?.borderColor,
      borderSize: options?.borderSize,
      headerShading: options?.headerShading,
    });

    if (!tableResult.success || !tableResult.data) {
      return {
        success: false,
        error: tableResult.error,
      };
    }

    const table = tableResult.data;

    // Populate cells with data if provided
    if (options?.cellData) {
      for (let row = 0; row < Math.min(rows, options.cellData.length); row++) {
        const rowData = options.cellData[row];
        for (let col = 0; col < Math.min(columns, rowData.length); col++) {
          const cell = table.getCell(row, col);
          if (cell) {
            await this.docXMLater.addCellContent(cell, rowData[col]);
          }
        }
      }
    }

    return await this.docXMLater.toBuffer(doc);
  }

  /**
   * NEW: Create paragraphs with working indentation
   * REPLACES: Broken indentation operations
   */
  async createDocumentWithWorkingIndentation(
    paragraphs: Array<{
      text: string;
      indentLeft?: number; // in twips
      indentRight?: number;
      indentFirstLine?: number;
      alignment?: 'left' | 'center' | 'right' | 'justify';
    }>
  ): Promise<DocumentModifyResult> {
    const doc = this.docXMLater.createNewDocument();

    for (const paraData of paragraphs) {
      const result = await this.docXMLater.createParagraph(doc, paraData.text, {
        indentLeft: paraData.indentLeft,
        indentRight: paraData.indentRight,
        indentFirstLine: paraData.indentFirstLine,
        alignment: paraData.alignment,
      });

      if (!result.success) {
        return {
          success: false,
          error: `Failed to create paragraph: ${result.error}`,
        };
      }
    }

    return await this.docXMLater.toBuffer(doc);
  }

  /**
   * NEW: Modify an existing document (loads, modifies, saves)
   * This is the MAIN method to use for working document modifications
   */
  async modifyDocumentWithDocXMLater(
    filePath: string,
    modifications: (doc: any) => Promise<void> | void
  ): Promise<DocumentModifyResult> {
    return await this.docXMLater.modifyDocument(filePath, modifications);
  }

  /**
   * NEW: Modify a document from buffer (loads, modifies, returns buffer)
   * This is the MAIN method for buffer-based modifications
   */
  async modifyDocumentBufferWithDocXMLater(
    buffer: Buffer,
    modifications: (doc: any) => Promise<void> | void
  ): Promise<DocumentModifyResult> {
    return await this.docXMLater.modifyDocumentBuffer(buffer, modifications);
  }

  /**
   * NEW: Helper to convert inches to twips for indentation
   */
  inchesToTwips(inches: number): number {
    return this.docXMLater.inchesToTwips(inches);
  }

  /**
   * NEW: Helper to convert points to twips for spacing
   */
  pointsToTwips(points: number): number {
    return this.docXMLater.pointsToTwips(points);
  }
}

export default UnifiedDocumentProcessor;
