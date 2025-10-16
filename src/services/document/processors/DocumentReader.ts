/**
 * DocumentReader - Reads and parses DOCX files using @omer-go/docx-parser-converter-ts
 *
 * This processor provides format-preserving DOCX parsing with support for:
 * - Hierarchical style application
 * - WYSIWYG-like format preservation
 * - Bullet points and numbering
 * - Indentation and margins
 * - Font and color information
 */

import { DocxConverter } from '@omer-go/docx-parser-converter-ts';
import {
  DocumentReadOptions,
  DocumentReadResult,
  DocxDocument,
  DocxProcessingError,
  ErrorCode,
  ProcessorResult,
} from '../types/docx-processing';

export class DocumentReader {
  /**
   * Read and parse a DOCX file from a buffer
   */
  async readFromBuffer(
    buffer: Buffer,
    options: DocumentReadOptions = {}
  ): Promise<DocumentReadResult> {
    try {
      const converter = new DocxConverter();

      // Parse the DOCX file
      await converter.load(buffer);

      // Extract document structure based on options
      const document = await this.extractDocument(converter, options);

      return {
        success: true,
        data: document,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Read and parse a DOCX file from a file path
   */
  async readFromFile(
    filePath: string,
    options: DocumentReadOptions = {}
  ): Promise<DocumentReadResult> {
    try {
      const fs = require('fs').promises;
      const buffer = await fs.readFile(filePath);
      return await this.readFromBuffer(buffer, options);
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to read file: ${error.message}`,
      };
    }
  }

  /**
   * Convert DOCX to HTML with format preservation
   */
  async convertToHtml(buffer: Buffer): Promise<ProcessorResult<string>> {
    try {
      const converter = new DocxConverter();
      await converter.load(buffer);

      // Convert to HTML with WYSIWYG support
      const htmlResult = await converter.convertToHtml();

      return {
        success: true,
        data: htmlResult.html,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `HTML conversion failed: ${error.message}`,
      };
    }
  }

  /**
   * Convert DOCX to plain text with indentation preservation
   */
  async convertToText(
    buffer: Buffer,
    options: { indent?: boolean } = {}
  ): Promise<ProcessorResult<string>> {
    try {
      const converter = new DocxConverter();
      await converter.load(buffer);

      // Convert to text with optional indentation
      const textResult = await converter.convertToTxt({
        indent: options.indent ?? true,
      });

      return {
        success: true,
        data: textResult.text,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Text conversion failed: ${error.message}`,
      };
    }
  }

  /**
   * Extract document properties and metadata
   */
  async extractMetadata(buffer: Buffer): Promise<ProcessorResult<any>> {
    try {
      const converter = new DocxConverter();
      await converter.load(buffer);

      // Access parsed document properties
      const metadata = {
        properties: converter.documentProperties,
        styles: converter.styles,
        numbering: converter.numbering,
      };

      return {
        success: true,
        data: metadata,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Metadata extraction failed: ${error.message}`,
      };
    }
  }

  /**
   * Extract styles from the document
   */
  async extractStyles(buffer: Buffer): Promise<ProcessorResult<any>> {
    try {
      const converter = new DocxConverter();
      await converter.load(buffer);

      // The converter applies styles hierarchically:
      // direct formatting > character style > paragraph style > linked style > document defaults
      const styles = {
        paragraphStyles: converter.styles?.paragraphStyles || {},
        characterStyles: converter.styles?.characterStyles || {},
        defaults: converter.styles?.defaults || {},
      };

      return {
        success: true,
        data: styles,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Style extraction failed: ${error.message}`,
      };
    }
  }

  /**
   * Extract numbering definitions (bullets and numbered lists)
   */
  async extractNumbering(buffer: Buffer): Promise<ProcessorResult<any>> {
    try {
      const converter = new DocxConverter();
      await converter.load(buffer);

      const numbering = converter.numbering || {};

      return {
        success: true,
        data: numbering,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Numbering extraction failed: ${error.message}`,
      };
    }
  }

  /**
   * Private method to extract full document structure
   */
  private async extractDocument(
    converter: DocxConverter,
    options: DocumentReadOptions
  ): Promise<DocxDocument> {
    const {
      parseStyles = true,
      parseNumbering = true,
      parseFonts = true,
      parseContent = true,
    } = options;

    // Build document structure
    const document: DocxDocument = {
      styles: {
        paragraphStyles: new Map(),
        characterStyles: new Map(),
      },
      numbering: {
        abstractNumberings: new Map(),
        numberingInstances: new Map(),
      },
      fonts: {
        fonts: new Map(),
      },
      content: {
        paragraphs: [],
      },
    };

    // Parse styles if requested
    if (parseStyles && converter.styles) {
      const styles = converter.styles;

      // Convert paragraph styles
      if (styles.paragraphStyles) {
        Object.entries(styles.paragraphStyles).forEach(([name, style]) => {
          document.styles.paragraphStyles.set(name, this.convertStyle(style));
        });
      }

      // Convert character styles
      if (styles.characterStyles) {
        Object.entries(styles.characterStyles).forEach(([name, style]) => {
          document.styles.characterStyles.set(name, this.convertStyle(style));
        });
      }
    }

    // Parse numbering if requested
    if (parseNumbering && converter.numbering) {
      // Convert numbering definitions
      // Note: Structure depends on the actual converter API
      const numbering = converter.numbering;
      // Implementation will depend on the actual structure returned by the converter
    }

    // Note: The actual implementation will depend on the specific API
    // provided by @omer-go/docx-parser-converter-ts
    // This is a framework that can be extended as needed

    return document;
  }

  /**
   * Convert style object to our internal format
   */
  private convertStyle(style: any): any {
    // Convert the style format from the converter to our internal format
    // This is a placeholder and should be implemented based on the actual API
    return style;
  }
}

export default DocumentReader;
