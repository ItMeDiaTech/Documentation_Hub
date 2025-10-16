/**
 * NumberingXmlProcessor - Direct manipulation of numbering.xml
 *
 * Handles:
 * - Bullet lists (unordered)
 * - Numbered lists (ordered)
 * - Multi-level lists (up to 9 levels)
 * - Custom bullet characters
 * - Custom numbering formats (Arabic, Roman, Letters)
 * - List indentation and alignment
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {
  NumberingXml,
  AbstractNumXml,
  NumXml,
  LevelXml,
  NumberingStyle,
  ProcessorResult,
} from '../types/docx-processing';

export class NumberingXmlProcessor {
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
   * Parse numbering.xml content
   */
  parse(xmlContent: string): ProcessorResult<NumberingXml> {
    try {
      const parsed = this.parser.parse(xmlContent) as NumberingXml;
      return {
        success: true,
        data: parsed,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to parse numbering.xml: ${error.message}`,
      };
    }
  }

  /**
   * Build numbering.xml content from object
   */
  build(numberingObj: NumberingXml): ProcessorResult<string> {
    try {
      const xml = this.builder.build(numberingObj);
      return {
        success: true,
        data: xml as string,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to build numbering.xml: ${error.message}`,
      };
    }
  }

  /**
   * Create a bullet list definition
   */
  createBulletList(
    numberingXml: NumberingXml,
    abstractNumId: string,
    bulletChar: string = '●', // Default bullet: filled circle
    levels: number = 3 // Number of levels (max 9)
  ): NumberingXml {
    const abstractNum: AbstractNumXml = {
      '@_w:abstractNumId': abstractNumId,
      'w:lvl': [],
    };

    // Define bullet characters for different levels
    const bulletChars = ['●', '○', '■', '□', '▪', '▫', '•', '◦', '‣'];

    // Create levels (0-indexed)
    for (let i = 0; i < Math.min(levels, 9); i++) {
      const level: LevelXml = {
        '@_w:ilvl': i.toString(),
        'w:start': { '@_w:val': '1' },
        'w:numFmt': { '@_w:val': 'bullet' },
        'w:lvlText': { '@_w:val': bulletChars[i % bulletChars.length] },
        'w:lvlJc': { '@_w:val': 'left' },
        'w:pPr': {
          'w:ind': {
            '@_w:left': (720 * (i + 1)).toString(), // 720 twips = 0.5 inch
            '@_w:hanging': '360', // 360 twips = 0.25 inch
          },
        },
        'w:rPr': {
          'w:rFonts': {
            '@_w:ascii': 'Symbol',
            '@_w:hAnsi': 'Symbol',
            '@_w:hint': 'default',
          },
        },
      };

      abstractNum['w:lvl'].push(level);
    }

    // Add abstract numbering definition
    if (!numberingXml['w:numbering']['w:abstractNum']) {
      numberingXml['w:numbering']['w:abstractNum'] = [];
    }

    let abstractNums = numberingXml['w:numbering']['w:abstractNum'];
    if (!Array.isArray(abstractNums)) {
      abstractNums = [abstractNums];
    }

    abstractNums.push(abstractNum);
    numberingXml['w:numbering']['w:abstractNum'] = abstractNums;

    return numberingXml;
  }

  /**
   * Create a numbered list definition
   */
  createNumberedList(
    numberingXml: NumberingXml,
    abstractNumId: string,
    format: 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman' = 'decimal',
    levels: number = 3
  ): NumberingXml {
    const abstractNum: AbstractNumXml = {
      '@_w:abstractNumId': abstractNumId,
      'w:lvl': [],
    };

    // Define formats for different levels
    const formats = ['decimal', 'lowerLetter', 'lowerRoman', 'upperLetter', 'upperRoman'];
    const levelTexts = ['%1.', '%2.', '%3.', '%4.', '%5.', '%6.', '%7.', '%8.', '%9.'];

    for (let i = 0; i < Math.min(levels, 9); i++) {
      const level: LevelXml = {
        '@_w:ilvl': i.toString(),
        'w:start': { '@_w:val': '1' },
        'w:numFmt': { '@_w:val': formats[i % formats.length] },
        'w:lvlText': { '@_w:val': levelTexts[i] },
        'w:lvlJc': { '@_w:val': 'left' },
        'w:pPr': {
          'w:ind': {
            '@_w:left': (720 * (i + 1)).toString(),
            '@_w:hanging': '360',
          },
        },
      };

      abstractNum['w:lvl'].push(level);
    }

    if (!numberingXml['w:numbering']['w:abstractNum']) {
      numberingXml['w:numbering']['w:abstractNum'] = [];
    }

    let abstractNums = numberingXml['w:numbering']['w:abstractNum'];
    if (!Array.isArray(abstractNums)) {
      abstractNums = [abstractNums];
    }

    abstractNums.push(abstractNum);
    numberingXml['w:numbering']['w:abstractNum'] = abstractNums;

    return numberingXml;
  }

  /**
   * Create a numbering instance that references an abstract numbering
   */
  createNumberingInstance(
    numberingXml: NumberingXml,
    numId: string,
    abstractNumId: string
  ): NumberingXml {
    const num: NumXml = {
      '@_w:numId': numId,
      'w:abstractNumId': { '@_w:val': abstractNumId },
    };

    if (!numberingXml['w:numbering']['w:num']) {
      numberingXml['w:numbering']['w:num'] = [];
    }

    let nums = numberingXml['w:numbering']['w:num'];
    if (!Array.isArray(nums)) {
      nums = [nums];
    }

    nums.push(num);
    numberingXml['w:numbering']['w:num'] = nums;

    return numberingXml;
  }

  /**
   * Get a numbering instance by ID
   */
  getNumberingInstance(numberingXml: NumberingXml, numId: string): NumXml | null {
    const nums = numberingXml['w:numbering']['w:num'];
    if (!nums) return null;

    if (!Array.isArray(nums)) {
      return nums['@_w:numId'] === numId ? nums : null;
    }

    return nums.find(n => n['@_w:numId'] === numId) || null;
  }

  /**
   * Get an abstract numbering definition by ID
   */
  getAbstractNumbering(
    numberingXml: NumberingXml,
    abstractNumId: string
  ): AbstractNumXml | null {
    const abstractNums = numberingXml['w:numbering']['w:abstractNum'];
    if (!abstractNums) return null;

    if (!Array.isArray(abstractNums)) {
      return abstractNums['@_w:abstractNumId'] === abstractNumId ? abstractNums : null;
    }

    return abstractNums.find(a => a['@_w:abstractNumId'] === abstractNumId) || null;
  }

  /**
   * Update a specific level in an abstract numbering
   */
  updateLevel(
    numberingXml: NumberingXml,
    abstractNumId: string,
    levelIndex: number,
    properties: NumberingStyle
  ): NumberingXml {
    const abstractNum = this.getAbstractNumbering(numberingXml, abstractNumId);
    if (!abstractNum) {
      throw new Error(`Abstract numbering ${abstractNumId} not found`);
    }

    const level = abstractNum['w:lvl'][levelIndex];
    if (!level) {
      throw new Error(`Level ${levelIndex} not found in abstract numbering ${abstractNumId}`);
    }

    // Update level properties
    if (properties.format) {
      level['w:numFmt'] = { '@_w:val': properties.format };
    }

    if (properties.text !== undefined) {
      level['w:lvlText'] = { '@_w:val': properties.text };
    }

    if (properties.alignment) {
      level['w:lvlJc'] = { '@_w:val': properties.alignment };
    }

    if (properties.indentLeft !== undefined || properties.indentHanging !== undefined) {
      if (!level['w:pPr']) {
        level['w:pPr'] = {};
      }
      if (!level['w:pPr']['w:ind']) {
        level['w:pPr']['w:ind'] = {};
      }

      if (properties.indentLeft !== undefined) {
        level['w:pPr']['w:ind']['@_w:left'] = properties.indentLeft.toString();
      }
      if (properties.indentHanging !== undefined) {
        level['w:pPr']['w:ind']['@_w:hanging'] = properties.indentHanging.toString();
      }
    }

    return numberingXml;
  }

  /**
   * Remove a numbering instance
   */
  removeNumberingInstance(numberingXml: NumberingXml, numId: string): NumberingXml {
    let nums = numberingXml['w:numbering']['w:num'];
    if (!nums) return numberingXml;

    if (!Array.isArray(nums)) {
      nums = [nums];
    }

    numberingXml['w:numbering']['w:num'] = nums.filter(n => n['@_w:numId'] !== numId);
    return numberingXml;
  }

  /**
   * Remove an abstract numbering definition
   */
  removeAbstractNumbering(numberingXml: NumberingXml, abstractNumId: string): NumberingXml {
    let abstractNums = numberingXml['w:numbering']['w:abstractNum'];
    if (!abstractNums) return numberingXml;

    if (!Array.isArray(abstractNums)) {
      abstractNums = [abstractNums];
    }

    numberingXml['w:numbering']['w:abstractNum'] = abstractNums.filter(
      a => a['@_w:abstractNumId'] !== abstractNumId
    );
    return numberingXml;
  }

  /**
   * Get the next available abstract num ID
   */
  getNextAbstractNumId(numberingXml: NumberingXml): string {
    const abstractNums = numberingXml['w:numbering']['w:abstractNum'];
    if (!abstractNums) return '0';

    const ids = Array.isArray(abstractNums)
      ? abstractNums.map(a => parseInt(a['@_w:abstractNumId']))
      : [parseInt(abstractNums['@_w:abstractNumId'])];

    const maxId = Math.max(...ids, -1);
    return (maxId + 1).toString();
  }

  /**
   * Get the next available num ID
   */
  getNextNumId(numberingXml: NumberingXml): string {
    const nums = numberingXml['w:numbering']['w:num'];
    if (!nums) return '1';

    const ids = Array.isArray(nums)
      ? nums.map(n => parseInt(n['@_w:numId']))
      : [parseInt(nums['@_w:numId'])];

    const maxId = Math.max(...ids, 0);
    return (maxId + 1).toString();
  }
}

export default NumberingXmlProcessor;
