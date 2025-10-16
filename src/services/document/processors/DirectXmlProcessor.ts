/**
 * DirectXmlProcessor - Complete DOCX manipulation using direct XML processing
 *
 * This processor provides the most powerful and flexible DOCX manipulation by:
 * - Direct access to all DOCX XML files
 * - Fine-grained control over formatting
 * - Ability to modify any aspect of the document
 * - Uses existing jszip and fast-xml-parser dependencies
 */

import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import StylesXmlProcessor from '../utils/StylesXmlProcessor';
import NumberingXmlProcessor from '../utils/NumberingXmlProcessor';
import FontTableProcessor from '../utils/FontTableProcessor';
import {
  DocumentModifyResult,
  ProcessorResult,
  DocxProcessingError,
  ErrorCode,
} from '../types/docx-processing';

export class DirectXmlProcessor {
  private stylesProcessor: StylesXmlProcessor;
  private numberingProcessor: NumberingXmlProcessor;
  private fontProcessor: FontTableProcessor;
  private parser: XMLParser;
  private builder: XMLBuilder;

  constructor() {
    this.stylesProcessor = new StylesXmlProcessor();
    this.numberingProcessor = new NumberingXmlProcessor();
    this.fontProcessor = new FontTableProcessor();

    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      preserveOrder: false,
    });

    this.builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      suppressEmptyNode: true,
    });
  }

  /**
   * Load a DOCX file and extract all XML parts
   */
  async loadDocx(buffer: Buffer): Promise<ProcessorResult<JSZip>> {
    try {
      const zip = await JSZip.loadAsync(buffer);
      return {
        success: true,
        data: zip,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to load DOCX: ${error.message}`,
      };
    }
  }

  /**
   * Get an XML file from the DOCX archive
   */
  async getXmlFile(
    zip: JSZip,
    path: string
  ): Promise<ProcessorResult<string>> {
    try {
      const file = zip.file(path);
      if (!file) {
        return {
          success: false,
          error: `File not found: ${path}`,
        };
      }

      const content = await file.async('string');
      return {
        success: true,
        data: content,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to read ${path}: ${error.message}`,
      };
    }
  }

  /**
   * Update an XML file in the DOCX archive
   */
  async setXmlFile(
    zip: JSZip,
    path: string,
    xmlContent: string
  ): Promise<ProcessorResult<JSZip>> {
    try {
      zip.file(path, xmlContent);
      return {
        success: true,
        data: zip,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to update ${path}: ${error.message}`,
      };
    }
  }

  /**
   * Save the modified DOCX to a buffer
   */
  async saveDocx(zip: JSZip): Promise<ProcessorResult<Buffer>> {
    try {
      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });

      return {
        success: true,
        data: buffer,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to save DOCX: ${error.message}`,
      };
    }
  }

  /**
   * Modify styles in a DOCX document
   */
  async modifyStyles(
    buffer: Buffer,
    styleModifier: (stylesXml: any) => any
  ): Promise<DocumentModifyResult> {
    try {
      // Load DOCX
      const loadResult = await this.loadDocx(buffer);
      if (!loadResult.success || !loadResult.data) {
        return {
          success: false,
          error: loadResult.error,
        };
      }
      const zip = loadResult.data;

      // Get styles.xml
      const stylesResult = await this.getXmlFile(zip, 'word/styles.xml');
      if (!stylesResult.success || !stylesResult.data) {
        return {
          success: false,
          error: stylesResult.error,
        };
      }

      // Parse styles
      const parseResult = this.stylesProcessor.parse(stylesResult.data);
      if (!parseResult.success || !parseResult.data) {
        return {
          success: false,
          error: parseResult.error,
        };
      }

      // Apply modifications
      const modifiedStyles = styleModifier(parseResult.data);

      // Build XML
      const buildResult = this.stylesProcessor.build(modifiedStyles);
      if (!buildResult.success || !buildResult.data) {
        return {
          success: false,
          error: buildResult.error,
        };
      }

      // Update in archive
      await this.setXmlFile(zip, 'word/styles.xml', buildResult.data);

      // Save DOCX
      return await this.saveDocx(zip);
    } catch (error: any) {
      return {
        success: false,
        error: `Style modification failed: ${error.message}`,
      };
    }
  }

  /**
   * Modify numbering (bullets/lists) in a DOCX document
   */
  async modifyNumbering(
    buffer: Buffer,
    numberingModifier: (numberingXml: any) => any
  ): Promise<DocumentModifyResult> {
    try {
      const loadResult = await this.loadDocx(buffer);
      if (!loadResult.success || !loadResult.data) {
        return {
          success: false,
          error: loadResult.error,
        };
      }
      const zip = loadResult.data;

      // Get numbering.xml (may not exist)
      const numberingResult = await this.getXmlFile(zip, 'word/numbering.xml');
      let numberingXml: any;

      if (numberingResult.success && numberingResult.data) {
        const parseResult = this.numberingProcessor.parse(numberingResult.data);
        if (!parseResult.success || !parseResult.data) {
          return {
            success: false,
            error: parseResult.error,
          };
        }
        numberingXml = parseResult.data;
      } else {
        // Create new numbering.xml if it doesn't exist
        numberingXml = {
          'w:numbering': {
            'w:abstractNum': [],
            'w:num': [],
          },
        };
      }

      // Apply modifications
      const modifiedNumbering = numberingModifier(numberingXml);

      // Build XML
      const buildResult = this.numberingProcessor.build(modifiedNumbering);
      if (!buildResult.success || !buildResult.data) {
        return {
          success: false,
          error: buildResult.error,
        };
      }

      // Update in archive
      await this.setXmlFile(zip, 'word/numbering.xml', buildResult.data);

      // Save DOCX
      return await this.saveDocx(zip);
    } catch (error: any) {
      return {
        success: false,
        error: `Numbering modification failed: ${error.message}`,
      };
    }
  }

  /**
   * Modify fonts in a DOCX document
   */
  async modifyFonts(
    buffer: Buffer,
    fontModifier: (fontTableXml: any) => any
  ): Promise<DocumentModifyResult> {
    try {
      const loadResult = await this.loadDocx(buffer);
      if (!loadResult.success || !loadResult.data) {
        return {
          success: false,
          error: loadResult.error,
        };
      }
      const zip = loadResult.data;

      // Get fontTable.xml
      const fontTableResult = await this.getXmlFile(zip, 'word/fontTable.xml');
      if (!fontTableResult.success || !fontTableResult.data) {
        return {
          success: false,
          error: fontTableResult.error,
        };
      }

      // Parse fonts
      const parseResult = this.fontProcessor.parse(fontTableResult.data);
      if (!parseResult.success || !parseResult.data) {
        return {
          success: false,
          error: parseResult.error,
        };
      }

      // Apply modifications
      const modifiedFonts = fontModifier(parseResult.data);

      // Build XML
      const buildResult = this.fontProcessor.build(modifiedFonts);
      if (!buildResult.success || !buildResult.data) {
        return {
          success: false,
          error: buildResult.error,
        };
      }

      // Update in archive
      await this.setXmlFile(zip, 'word/fontTable.xml', buildResult.data);

      // Save DOCX
      return await this.saveDocx(zip);
    } catch (error: any) {
      return {
        success: false,
        error: `Font modification failed: ${error.message}`,
      };
    }
  }

  /**
   * Modify document content directly
   */
  async modifyDocument(
    buffer: Buffer,
    documentModifier: (documentXml: any) => any
  ): Promise<DocumentModifyResult> {
    try {
      const loadResult = await this.loadDocx(buffer);
      if (!loadResult.success || !loadResult.data) {
        return {
          success: false,
          error: loadResult.error,
        };
      }
      const zip = loadResult.data;

      // Get document.xml
      const documentResult = await this.getXmlFile(zip, 'word/document.xml');
      if (!documentResult.success || !documentResult.data) {
        return {
          success: false,
          error: documentResult.error,
        };
      }

      // Parse document
      const documentXml = this.parser.parse(documentResult.data);

      // Apply modifications
      const modifiedDocument = documentModifier(documentXml);

      // Build XML
      const xml = this.builder.build(modifiedDocument);

      // Update in archive
      await this.setXmlFile(zip, 'word/document.xml', xml as string);

      // Save DOCX
      return await this.saveDocx(zip);
    } catch (error: any) {
      return {
        success: false,
        error: `Document modification failed: ${error.message}`,
      };
    }
  }

  /**
   * Comprehensive modification - modify multiple aspects at once
   */
  async modifyDocxComplete(
    buffer: Buffer,
    modifications: {
      styles?: (stylesXml: any) => any;
      numbering?: (numberingXml: any) => any;
      fonts?: (fontTableXml: any) => any;
      document?: (documentXml: any) => any;
    }
  ): Promise<DocumentModifyResult> {
    try {
      const loadResult = await this.loadDocx(buffer);
      if (!loadResult.success || !loadResult.data) {
        return {
          success: false,
          error: loadResult.error,
        };
      }
      let zip = loadResult.data;

      // Apply each modification
      // Note: Each helper now returns a Buffer, so we need to reload the zip for subsequent modifications
      let currentBuffer: Buffer | undefined;

      if (modifications.styles) {
        const result = await this.applyStylesModification(zip, modifications.styles);
        if (!result.success || !result.data) return result;
        currentBuffer = result.data;
        // Reload zip for next modification
        const reloadResult = await this.loadDocx(currentBuffer);
        if (!reloadResult.success || !reloadResult.data) return reloadResult as DocumentModifyResult;
        zip = reloadResult.data;
      }

      if (modifications.numbering) {
        const result = await this.applyNumberingModification(zip, modifications.numbering);
        if (!result.success || !result.data) return result;
        currentBuffer = result.data;
        // Reload zip for next modification
        const reloadResult = await this.loadDocx(currentBuffer);
        if (!reloadResult.success || !reloadResult.data) return reloadResult as DocumentModifyResult;
        zip = reloadResult.data;
      }

      if (modifications.fonts) {
        const result = await this.applyFontsModification(zip, modifications.fonts);
        if (!result.success || !result.data) return result;
        currentBuffer = result.data;
        // Reload zip for next modification
        const reloadResult = await this.loadDocx(currentBuffer);
        if (!reloadResult.success || !reloadResult.data) return reloadResult as DocumentModifyResult;
        zip = reloadResult.data;
      }

      if (modifications.document) {
        const result = await this.applyDocumentModification(zip, modifications.document);
        if (!result.success || !result.data) return result;
        currentBuffer = result.data;
      }

      // If no modifications were applied, save the original zip
      if (!currentBuffer) {
        return await this.saveDocx(zip);
      }

      // Return the final buffer
      return {
        success: true,
        data: currentBuffer,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Complete modification failed: ${error.message}`,
      };
    }
  }

  // Private helper methods

  private async applyStylesModification(
    zip: JSZip,
    modifier: (stylesXml: any) => any
  ): Promise<DocumentModifyResult> {
    const stylesResult = await this.getXmlFile(zip, 'word/styles.xml');
    if (!stylesResult.success || !stylesResult.data) {
      return {
        success: false,
        error: stylesResult.error,
      };
    }

    const parseResult = this.stylesProcessor.parse(stylesResult.data);
    if (!parseResult.success || !parseResult.data) {
      return {
        success: false,
        error: parseResult.error,
      };
    }

    const modified = modifier(parseResult.data);
    const buildResult = this.stylesProcessor.build(modified);
    if (!buildResult.success || !buildResult.data) {
      return {
        success: false,
        error: buildResult.error,
      };
    }

    const setResult = await this.setXmlFile(zip, 'word/styles.xml', buildResult.data);
    if (!setResult.success) {
      return {
        success: false,
        error: setResult.error,
      };
    }

    // Convert JSZip to Buffer
    return await this.saveDocx(setResult.data!);
  }

  private async applyNumberingModification(
    zip: JSZip,
    modifier: (numberingXml: any) => any
  ): Promise<DocumentModifyResult> {
    const numberingResult = await this.getXmlFile(zip, 'word/numbering.xml');
    let numberingXml: any;

    if (numberingResult.success && numberingResult.data) {
      const parseResult = this.numberingProcessor.parse(numberingResult.data);
      if (!parseResult.success || !parseResult.data) {
        return {
          success: false,
          error: parseResult.error,
        };
      }
      numberingXml = parseResult.data;
    } else {
      numberingXml = { 'w:numbering': { 'w:abstractNum': [], 'w:num': [] } };
    }

    const modified = modifier(numberingXml);
    const buildResult = this.numberingProcessor.build(modified);
    if (!buildResult.success || !buildResult.data) {
      return {
        success: false,
        error: buildResult.error,
      };
    }

    const setResult = await this.setXmlFile(zip, 'word/numbering.xml', buildResult.data);
    if (!setResult.success) {
      return {
        success: false,
        error: setResult.error,
      };
    }

    // Convert JSZip to Buffer
    return await this.saveDocx(setResult.data!);
  }

  private async applyFontsModification(
    zip: JSZip,
    modifier: (fontTableXml: any) => any
  ): Promise<DocumentModifyResult> {
    const fontResult = await this.getXmlFile(zip, 'word/fontTable.xml');
    if (!fontResult.success || !fontResult.data) {
      return {
        success: false,
        error: fontResult.error,
      };
    }

    const parseResult = this.fontProcessor.parse(fontResult.data);
    if (!parseResult.success || !parseResult.data) {
      return {
        success: false,
        error: parseResult.error,
      };
    }

    const modified = modifier(parseResult.data);
    const buildResult = this.fontProcessor.build(modified);
    if (!buildResult.success || !buildResult.data) {
      return {
        success: false,
        error: buildResult.error,
      };
    }

    const setResult = await this.setXmlFile(zip, 'word/fontTable.xml', buildResult.data);
    if (!setResult.success) {
      return {
        success: false,
        error: setResult.error,
      };
    }

    // Convert JSZip to Buffer
    return await this.saveDocx(setResult.data!);
  }

  private async applyDocumentModification(
    zip: JSZip,
    modifier: (documentXml: any) => any
  ): Promise<DocumentModifyResult> {
    const documentResult = await this.getXmlFile(zip, 'word/document.xml');
    if (!documentResult.success || !documentResult.data) {
      return {
        success: false,
        error: documentResult.error,
      };
    }

    const documentXml = this.parser.parse(documentResult.data);
    const modified = modifier(documentXml);
    const xml = this.builder.build(modified);

    const setResult = await this.setXmlFile(zip, 'word/document.xml', xml as string);
    if (!setResult.success) {
      return {
        success: false,
        error: setResult.error,
      };
    }

    // Convert JSZip to Buffer
    return await this.saveDocx(setResult.data!);
  }
}

export default DirectXmlProcessor;
