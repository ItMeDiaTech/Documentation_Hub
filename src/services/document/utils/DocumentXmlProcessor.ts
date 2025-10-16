/**
 * DocumentXmlProcessor - Manipulates document.xml for style application
 *
 * Handles:
 * - Applying paragraph styles to content
 * - Traversing and modifying paragraph elements
 * - Ensuring proper paragraph properties structure
 * - Pattern-based style application
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {
  DocumentXml,
  ParagraphXml,
  ProcessorResult,
} from '../types/docx-processing';

export class DocumentXmlProcessor {
  private parser: XMLParser;
  private builder: XMLBuilder;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      preserveOrder: false,
      parseTagValue: false,
      trimValues: false,
    });

    this.builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      suppressEmptyNode: true,
      preserveOrder: false,
    });
  }

  /**
   * Parse document.xml content
   */
  parse(xmlContent: string): ProcessorResult<DocumentXml> {
    try {
      const parsed = this.parser.parse(xmlContent) as DocumentXml;
      return {
        success: true,
        data: parsed,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to parse document.xml: ${error.message}`,
      };
    }
  }

  /**
   * Build document.xml content from object
   */
  build(documentXml: DocumentXml): ProcessorResult<string> {
    try {
      const xml = this.builder.build(documentXml);
      return {
        success: true,
        data: xml as string,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to build document.xml: ${error.message}`,
      };
    }
  }

  /**
   * Get all paragraphs from the document
   */
  getParagraphs(documentXml: DocumentXml): ParagraphXml[] {
    try {
      const body = documentXml['w:document']?.['w:body'];
      if (!body) return [];

      const paragraphs: ParagraphXml[] = [];

      // Iterate through all children of body to find paragraphs
      Object.keys(body).forEach(key => {
        if (key === 'w:p') {
          const pElements = body[key];
          if (Array.isArray(pElements)) {
            paragraphs.push(...pElements);
          } else {
            paragraphs.push(pElements);
          }
        }
      });

      return paragraphs;
    } catch (error) {
      return [];
    }
  }

  /**
   * Ensure paragraph has properties element
   */
  private ensureParagraphProperties(paragraph: ParagraphXml): void {
    if (!paragraph['w:pPr']) {
      paragraph['w:pPr'] = {};
    }
  }

  /**
   * Apply a style to a specific paragraph
   */
  applyStyleToParagraph(
    paragraph: ParagraphXml,
    styleId: string
  ): void {
    this.ensureParagraphProperties(paragraph);

    // Set the paragraph style (non-null assertion since we just ensured it exists)
    paragraph['w:pPr']!['w:pStyle'] = {
      '@_w:val': styleId,
    };
  }

  /**
   * Clear paragraph style
   */
  clearParagraphStyle(paragraph: ParagraphXml): void {
    if (paragraph['w:pPr']?.['w:pStyle']) {
      delete paragraph['w:pPr']['w:pStyle'];
    }
  }

  /**
   * Apply a style to all paragraphs in the document
   */
  applyStyleToAll(
    documentXml: DocumentXml,
    styleId: string
  ): { modified: number; total: number } {
    const paragraphs = this.getParagraphs(documentXml);
    let modified = 0;

    paragraphs.forEach(paragraph => {
      this.applyStyleToParagraph(paragraph, styleId);
      modified++;
    });

    return { modified, total: paragraphs.length };
  }

  /**
   * Apply a style to specific paragraph indices (0-based)
   */
  applyStyleToIndices(
    documentXml: DocumentXml,
    styleId: string,
    indices: number[]
  ): { modified: number; total: number; skipped: number } {
    const paragraphs = this.getParagraphs(documentXml);
    let modified = 0;
    let skipped = 0;

    indices.forEach(index => {
      if (index >= 0 && index < paragraphs.length) {
        this.applyStyleToParagraph(paragraphs[index], styleId);
        modified++;
      } else {
        skipped++;
      }
    });

    return { modified, total: paragraphs.length, skipped };
  }

  /**
   * Get text content from a paragraph (for pattern matching)
   */
  private getParagraphText(paragraph: ParagraphXml): string {
    try {
      const texts: string[] = [];

      // Get text from runs
      const runs = paragraph['w:r'];
      if (runs) {
        const runArray = Array.isArray(runs) ? runs : [runs];
        runArray.forEach((run: any) => {
          const text = run['w:t'];
          if (text) {
            if (typeof text === 'string') {
              texts.push(text);
            } else if (text['#text']) {
              texts.push(text['#text']);
            }
          }
        });
      }

      // Also check hyperlinks
      const hyperlinks = paragraph['w:hyperlink'];
      if (hyperlinks) {
        const hlArray = Array.isArray(hyperlinks) ? hyperlinks : [hyperlinks];
        hlArray.forEach((hl: any) => {
          const runs = hl['w:r'];
          if (runs) {
            const runArray = Array.isArray(runs) ? runs : [runs];
            runArray.forEach((run: any) => {
              const text = run['w:t'];
              if (text) {
                if (typeof text === 'string') {
                  texts.push(text);
                } else if (text['#text']) {
                  texts.push(text['#text']);
                }
              }
            });
          }
        });
      }

      return texts.join('');
    } catch (error) {
      return '';
    }
  }

  /**
   * Apply a style to paragraphs matching a text pattern
   */
  applyStyleByPattern(
    documentXml: DocumentXml,
    styleId: string,
    pattern: string | RegExp
  ): { modified: number; total: number; skipped: number } {
    const paragraphs = this.getParagraphs(documentXml);
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    let modified = 0;
    let skipped = 0;

    paragraphs.forEach(paragraph => {
      const text = this.getParagraphText(paragraph);
      if (regex.test(text)) {
        this.applyStyleToParagraph(paragraph, styleId);
        modified++;
      } else {
        skipped++;
      }
    });

    return { modified, total: paragraphs.length, skipped };
  }

  /**
   * Remove styles from all paragraphs
   */
  clearAllStyles(documentXml: DocumentXml): { modified: number; total: number } {
    const paragraphs = this.getParagraphs(documentXml);
    let modified = 0;

    paragraphs.forEach(paragraph => {
      if (paragraph['w:pPr']?.['w:pStyle']) {
        this.clearParagraphStyle(paragraph);
        modified++;
      }
    });

    return { modified, total: paragraphs.length };
  }

  /**
   * Get current style applied to a paragraph (if any)
   */
  getParagraphStyle(paragraph: ParagraphXml): string | null {
    return paragraph['w:pPr']?.['w:pStyle']?.['@_w:val'] || null;
  }

  /**
   * Get statistics about styles in the document
   */
  getStyleStatistics(documentXml: DocumentXml): {
    totalParagraphs: number;
    styledParagraphs: number;
    unstyledParagraphs: number;
    styleUsage: Record<string, number>;
  } {
    const paragraphs = this.getParagraphs(documentXml);
    const styleUsage: Record<string, number> = {};
    let styledCount = 0;

    paragraphs.forEach(paragraph => {
      const style = this.getParagraphStyle(paragraph);
      if (style) {
        styledCount++;
        styleUsage[style] = (styleUsage[style] || 0) + 1;
      }
    });

    return {
      totalParagraphs: paragraphs.length,
      styledParagraphs: styledCount,
      unstyledParagraphs: paragraphs.length - styledCount,
      styleUsage,
    };
  }
}

export default DocumentXmlProcessor;
