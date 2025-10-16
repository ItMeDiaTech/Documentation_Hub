/**
 * FontTableProcessor - Direct manipulation of fontTable.xml
 *
 * Handles:
 * - Font definitions
 * - Font families
 * - Character sets
 * - Font substitution rules
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { FontDefinition, ProcessorResult } from '../types/docx-processing';

interface FontTableXml {
  'w:fonts': {
    'w:font': FontXml[];
  };
}

interface FontXml {
  '@_w:name': string;
  'w:charset'?: { '@_w:val': string };
  'w:family'?: { '@_w:val': string };
  'w:pitch'?: { '@_w:val': string };
  'w:sig'?: any; // Font signature
  'w:panose1'?: { '@_w:val': string };
}

export class FontTableProcessor {
  private parser: XMLParser;
  private builder: XMLBuilder;

  constructor() {
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
   * Parse fontTable.xml content
   */
  parse(xmlContent: string): ProcessorResult<FontTableXml> {
    try {
      const parsed = this.parser.parse(xmlContent) as FontTableXml;
      return {
        success: true,
        data: parsed,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to parse fontTable.xml: ${error.message}`,
      };
    }
  }

  /**
   * Build fontTable.xml content from object
   */
  build(fontTableObj: FontTableXml): ProcessorResult<string> {
    try {
      const xml = this.builder.build(fontTableObj);
      return {
        success: true,
        data: xml as string,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to build fontTable.xml: ${error.message}`,
      };
    }
  }

  /**
   * Get a font by name
   */
  getFont(fontTableXml: FontTableXml, fontName: string): FontXml | null {
    const fonts = fontTableXml['w:fonts']['w:font'];
    if (!Array.isArray(fonts)) {
      return fonts['@_w:name'] === fontName ? fonts : null;
    }

    return fonts.find(f => f['@_w:name'] === fontName) || null;
  }

  /**
   * Add or update a font definition
   */
  setFont(
    fontTableXml: FontTableXml,
    fontName: string,
    definition: FontDefinition
  ): FontTableXml {
    const fontDef: FontXml = {
      '@_w:name': fontName,
    };

    if (definition.charset) {
      fontDef['w:charset'] = { '@_w:val': definition.charset };
    }

    if (definition.family) {
      fontDef['w:family'] = { '@_w:val': definition.family };
    }

    if (definition.pitch) {
      fontDef['w:pitch'] = { '@_w:val': definition.pitch };
    }

    let fonts = fontTableXml['w:fonts']['w:font'];
    if (!Array.isArray(fonts)) {
      fonts = [fonts];
    }

    const existingIndex = fonts.findIndex(f => f['@_w:name'] === fontName);
    if (existingIndex >= 0) {
      fonts[existingIndex] = fontDef;
    } else {
      fonts.push(fontDef);
    }

    fontTableXml['w:fonts']['w:font'] = fonts;
    return fontTableXml;
  }

  /**
   * Remove a font definition
   */
  removeFont(fontTableXml: FontTableXml, fontName: string): FontTableXml {
    let fonts = fontTableXml['w:fonts']['w:font'];
    if (!Array.isArray(fonts)) {
      fonts = [fonts];
    }

    fontTableXml['w:fonts']['w:font'] = fonts.filter(f => f['@_w:name'] !== fontName);
    return fontTableXml;
  }

  /**
   * Get all font names
   */
  getAllFontNames(fontTableXml: FontTableXml): string[] {
    const fonts = fontTableXml['w:fonts']['w:font'];
    if (!Array.isArray(fonts)) {
      return [fonts['@_w:name']];
    }

    return fonts.map(f => f['@_w:name']);
  }

  /**
   * Check if a font exists
   */
  fontExists(fontTableXml: FontTableXml, fontName: string): boolean {
    return this.getFont(fontTableXml, fontName) !== null;
  }

  /**
   * Add common web fonts
   */
  addWebFonts(fontTableXml: FontTableXml): FontTableXml {
    const webFonts: FontDefinition[] = [
      { name: 'Arial', family: 'swiss', charset: '00' },
      { name: 'Times New Roman', family: 'roman', charset: '00' },
      { name: 'Calibri', family: 'swiss', charset: '00' },
      { name: 'Cambria', family: 'roman', charset: '00' },
      { name: 'Georgia', family: 'roman', charset: '00' },
      { name: 'Verdana', family: 'swiss', charset: '00' },
      { name: 'Courier New', family: 'modern', charset: '00' },
    ];

    webFonts.forEach(font => {
      if (!this.fontExists(fontTableXml, font.name)) {
        this.setFont(fontTableXml, font.name, font);
      }
    });

    return fontTableXml;
  }
}

export default FontTableProcessor;
