/**
 * StylesXmlProcessor - Direct manipulation of styles.xml
 *
 * Handles:
 * - Paragraph styles
 * - Character (run) styles
 * - Table styles
 * - Numbering styles (linked to numbering.xml)
 * - Default styles
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {
  StylesXml,
  StyleXml,
  TextStyle,
  ParagraphStyle,
  ProcessorResult,
} from '../types/docx-processing';

export class StylesXmlProcessor {
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
   * Parse styles.xml content
   */
  parse(xmlContent: string): ProcessorResult<StylesXml> {
    try {
      const parsed = this.parser.parse(xmlContent) as StylesXml;
      return {
        success: true,
        data: parsed,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to parse styles.xml: ${error.message}`,
      };
    }
  }

  /**
   * Build styles.xml content from object
   */
  build(stylesObj: StylesXml): ProcessorResult<string> {
    try {
      const xml = this.builder.build(stylesObj);
      return {
        success: true,
        data: xml as string,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to build styles.xml: ${error.message}`,
      };
    }
  }

  /**
   * Get a specific style by ID
   */
  getStyle(stylesXml: StylesXml, styleId: string): StyleXml | null {
    const styles = stylesXml['w:styles']['w:style'];
    if (!Array.isArray(styles)) {
      return styles['@_w:styleId'] === styleId ? styles : null;
    }
    return styles.find(s => s['@_w:styleId'] === styleId) || null;
  }

  /**
   * Add or update a paragraph style
   */
  setParagraphStyle(
    stylesXml: StylesXml,
    styleId: string,
    styleName: string,
    properties: ParagraphStyle & TextStyle
  ): StylesXml {
    const styleDefinition: StyleXml = {
      '@_w:type': 'paragraph',
      '@_w:styleId': styleId,
      'w:name': { '@_w:val': styleName },
      'w:pPr': this.buildParagraphProperties(properties),
      'w:rPr': this.buildRunProperties(properties),
    };

    // Get existing styles
    let styles = stylesXml['w:styles']['w:style'];
    if (!Array.isArray(styles)) {
      styles = [styles];
    }

    // Find and replace or add new
    const existingIndex = styles.findIndex(s => s['@_w:styleId'] === styleId);
    if (existingIndex >= 0) {
      styles[existingIndex] = styleDefinition;
    } else {
      styles.push(styleDefinition);
    }

    stylesXml['w:styles']['w:style'] = styles;
    return stylesXml;
  }

  /**
   * Add or update a character style
   */
  setCharacterStyle(
    stylesXml: StylesXml,
    styleId: string,
    styleName: string,
    properties: TextStyle
  ): StylesXml {
    const styleDefinition: StyleXml = {
      '@_w:type': 'character',
      '@_w:styleId': styleId,
      'w:name': { '@_w:val': styleName },
      'w:rPr': this.buildRunProperties(properties),
    };

    let styles = stylesXml['w:styles']['w:style'];
    if (!Array.isArray(styles)) {
      styles = [styles];
    }

    const existingIndex = styles.findIndex(s => s['@_w:styleId'] === styleId);
    if (existingIndex >= 0) {
      styles[existingIndex] = styleDefinition;
    } else {
      styles.push(styleDefinition);
    }

    stylesXml['w:styles']['w:style'] = styles;
    return stylesXml;
  }

  /**
   * Remove a style by ID
   */
  removeStyle(stylesXml: StylesXml, styleId: string): StylesXml {
    let styles = stylesXml['w:styles']['w:style'];
    if (!Array.isArray(styles)) {
      styles = [styles];
    }

    stylesXml['w:styles']['w:style'] = styles.filter(
      s => s['@_w:styleId'] !== styleId
    );
    return stylesXml;
  }

  /**
   * Get all styles of a specific type
   */
  getStylesByType(
    stylesXml: StylesXml,
    type: 'paragraph' | 'character' | 'table'
  ): StyleXml[] {
    let styles = stylesXml['w:styles']['w:style'];
    if (!Array.isArray(styles)) {
      styles = [styles];
    }

    return styles.filter(s => s['@_w:type'] === type);
  }

  /**
   * Update default paragraph style
   */
  setDefaultParagraphStyle(
    stylesXml: StylesXml,
    properties: ParagraphStyle & TextStyle
  ): StylesXml {
    if (!stylesXml['w:styles']['w:docDefaults']) {
      stylesXml['w:styles']['w:docDefaults'] = {};
    }

    const docDefaults = stylesXml['w:styles']['w:docDefaults'];
    if (!docDefaults['w:pPrDefault']) {
      docDefaults['w:pPrDefault'] = {};
    }

    docDefaults['w:pPrDefault']['w:pPr'] = this.buildParagraphProperties(properties);
    docDefaults['w:rPrDefault'] = {
      'w:rPr': this.buildRunProperties(properties),
    };

    return stylesXml;
  }

  /**
   * Build paragraph properties XML object
   */
  private buildParagraphProperties(props: ParagraphStyle): any {
    const pPr: any = {};

    if (props.alignment) {
      pPr['w:jc'] = { '@_w:val': props.alignment };
    }

    if (props.indentLeft !== undefined || props.indentRight !== undefined || props.indentFirstLine !== undefined) {
      pPr['w:ind'] = {};
      if (props.indentLeft !== undefined) {
        pPr['w:ind']['@_w:left'] = props.indentLeft.toString();
      }
      if (props.indentRight !== undefined) {
        pPr['w:ind']['@_w:right'] = props.indentRight.toString();
      }
      if (props.indentFirstLine !== undefined) {
        pPr['w:ind']['@_w:firstLine'] = props.indentFirstLine.toString();
      }
    }

    if (props.spaceBefore !== undefined || props.spaceAfter !== undefined) {
      pPr['w:spacing'] = {};
      if (props.spaceBefore !== undefined) {
        pPr['w:spacing']['@_w:before'] = props.spaceBefore.toString();
      }
      if (props.spaceAfter !== undefined) {
        pPr['w:spacing']['@_w:after'] = props.spaceAfter.toString();
      }
      if (props.lineSpacing !== undefined) {
        pPr['w:spacing']['@_w:line'] = props.lineSpacing.toString();
      }
    }

    if (props.keepNext) {
      pPr['w:keepNext'] = {};
    }

    if (props.keepLines) {
      pPr['w:keepLines'] = {};
    }

    return Object.keys(pPr).length > 0 ? pPr : undefined;
  }

  /**
   * Build run (character) properties XML object
   */
  private buildRunProperties(props: TextStyle): any {
    const rPr: any = {};

    if (props.fontFamily) {
      rPr['w:rFonts'] = {
        '@_w:ascii': props.fontFamily,
        '@_w:hAnsi': props.fontFamily,
        '@_w:cs': props.fontFamily,
      };
    }

    if (props.fontSize) {
      // Font size in Word is in half-points
      const halfPoints = props.fontSize * 2;
      rPr['w:sz'] = { '@_w:val': halfPoints.toString() };
      rPr['w:szCs'] = { '@_w:val': halfPoints.toString() };
    }

    if (props.bold) {
      rPr['w:b'] = {};
      rPr['w:bCs'] = {};
    }

    if (props.italic) {
      rPr['w:i'] = {};
      rPr['w:iCs'] = {};
    }

    if (props.underline) {
      rPr['w:u'] = { '@_w:val': 'single' };
    }

    if (props.color) {
      rPr['w:color'] = { '@_w:val': props.color.replace('#', '') };
    }

    if (props.highlight) {
      rPr['w:highlight'] = { '@_w:val': props.highlight };
    }

    return Object.keys(rPr).length > 0 ? rPr : undefined;
  }
}

export default StylesXmlProcessor;
