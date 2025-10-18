/**
 * XmlParser - DocXMLater Extension for XML Operations
 *
 * Replaces fast-xml-parser with DocXMLater-based XML handling.
 * This module provides XML parsing and building capabilities using
 * DocXMLater's internal APIs instead of third-party libraries.
 *
 * REQUIREMENTS FOR DOCXMLATER FRAMEWORK:
 * - Need: getRawXml(partName: string) method to get XML string from document part
 * - Need: setRawXml(partName: string, xml: string) method to update XML in document
 * - Need: getRelationships(partName: string) to access .rels files
 */

import { Document, XMLParser, XMLBuilder } from 'docxmlater';
import { logger } from '@/utils/logger';

const log = logger.namespace('DocXMLaterXmlParser');

export interface XmlParseResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * DocXMLater-based XML Parser
 * Provides XML operations without external dependencies
 */
export class DocXMLaterXmlParser {
  private doc: Document;

  constructor(document: Document) {
    this.doc = document;
  }

  /**
   * Parse XML string into JavaScript object
   * Uses DocXMLater's native parseToObject() method for Office Open XML parsing
   *
   * @param xmlString - XML string to parse
   * @returns Parse result with success status and parsed data
   */
  parseXmlString(xmlString: string): XmlParseResult {
    try {
      // Use DocXMLater's native XML parser (framework now provides this)
      // This handles OOXML namespaces, attributes (@_ prefix), and text nodes (#text)
      const data = XMLParser.parseToObject(xmlString, {
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        ignoreNamespace: false,  // Keep w:p, w:r prefixes
        parseAttributeValue: true,  // Convert "123" → 123
        trimValues: true,
      });

      return {
        success: true,
        data
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to parse XML:', errorMessage);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Build XML string from JavaScript object
   *
   * NOTE: DocXMLater's XMLBuilder currently uses imperative element() methods.
   * For declarative object-to-XML conversion, this would require the framework
   * to add XMLBuilder.objectToXml() method (reverse of parseToObject).
   *
   * Current workaround: Use XMLBuilder's imperative API for XML generation.
   *
   * @param obj - JavaScript object to convert to XML
   * @returns XML string
   */
  buildXmlString(obj: any): string {
    // Placeholder - framework doesn't yet have objectToXml()
    // For now, return a basic XML structure
    log.warn('buildXmlString called - framework needs XMLBuilder.objectToXml() implementation');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<!-- Object to XML conversion not yet implemented in framework -->';
  }

  /**
   * Get raw XML content from a document part
   * Uses DocXMLater's native getPart() API
   */
  async getRawXmlFromPart(partName: string): Promise<string | null> {
    try {
      // Use DocXMLater's public API instead of private _zip access
      const part = await this.doc.getPart(partName);

      if (!part?.content) {
        return null;
      }

      // DocumentPart.content can be string or Buffer
      return typeof part.content === 'string'
        ? part.content
        : part.content.toString('utf-8');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error(`Failed to get raw XML from ${partName}:`, errorMessage);
      return null;
    }
  }

  /**
   * Set raw XML content in a document part
   * Uses DocXMLater's native setPart() API
   */
  async setRawXmlInPart(partName: string, xmlString: string): Promise<boolean> {
    try {
      // Use DocXMLater's public API instead of private _zip access
      await this.doc.setPart(partName, xmlString);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error(`Failed to set raw XML in ${partName}:`, errorMessage);
      return false;
    }
  }

  /**
   * Get relationships for a document part
   * Uses DocXMLater's native getAllRelationships() API with fallback
   */
  async getRelationships(partName: string = 'word/document.xml'): Promise<any[]> {
    try {
      // Try DocXMLater's native API first
      try {
        const allRels = await this.doc.getAllRelationships();

        // Construct relationship file path
        const dir = partName.substring(0, partName.lastIndexOf('/'));
        const filename = partName.substring(partName.lastIndexOf('/') + 1);
        const relsKey = `${dir}/_rels/${filename}.rels`;

        // Return relationships for this specific part
        const rels = allRels.get(relsKey);
        if (rels && rels.length > 0) {
          return rels;
        }
      } catch {
        // Fall through to manual parsing
        log.debug('Native getAllRelationships failed, using fallback');
      }

      // Fallback: Manual parsing (in case native API doesn't have this part)
      const dir = partName.substring(0, partName.lastIndexOf('/'));
      const filename = partName.substring(partName.lastIndexOf('/') + 1);
      const relsPath = `${dir}/_rels/${filename}.rels`;

      const relsXml = await this.getRawXmlFromPart(relsPath);
      if (!relsXml) {
        return [];
      }

      // Parse relationships
      const relsObj = this.parseXmlString(relsXml);
      if (relsObj.success && relsObj.data?.Relationships?.Relationship) {
        const relationships = Array.isArray(relsObj.data.Relationships.Relationship)
          ? relsObj.data.Relationships.Relationship
          : [relsObj.data.Relationships.Relationship];
        return relationships;
      }

      return [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to get relationships:', errorMessage);
      return [];
    }
  }


  /**
   * Check if a document part exists
   * Uses DocXMLater's native partExists() API
   */
  async partExists(partName: string): Promise<boolean> {
    try {
      return await this.doc.partExists(partName);
    } catch {
      return false;
    }
  }

  /**
   * List all parts in the document
   * Uses DocXMLater's native listParts() API
   */
  async listParts(): Promise<string[]> {
    try {
      return await this.doc.listParts();
    } catch {
      return [];
    }
  }
}

/**
 * Singleton helper for XML operations
 * Can be used without a document instance for general XML parsing
 */
export class XmlHelper {
  /**
   * Extract text content from XML string without parsing
   * Useful for quick text extraction without full parsing overhead
   */
  static extractTextFromXml(xml: string): string {
    // Remove XML tags and extract text content
    return xml
      .replace(/<[^>]+>/g, ' ')  // Remove all XML tags
      .replace(/\s+/g, ' ')       // Normalize whitespace
      .trim();
  }

  /**
   * Check if XML contains specific element
   */
  static containsElement(xml: string, elementName: string): boolean {
    const pattern = new RegExp(`<${elementName}[\\s>]`, 'i');
    return pattern.test(xml);
  }

  /**
   * Extract attribute value from XML element
   */
  static getAttributeValue(xml: string, elementName: string, attributeName: string): string | null {
    const elementPattern = new RegExp(`<${elementName}([^>]*)>`, 'i');
    const elementMatch = xml.match(elementPattern);

    if (elementMatch && elementMatch[1]) {
      const attrPattern = new RegExp(`${attributeName}="([^"]*)"`, 'i');
      const attrMatch = elementMatch[1].match(attrPattern);
      return attrMatch ? attrMatch[1] : null;
    }

    return null;
  }

  /**
   * Ensure XML declaration is present
   */
  static ensureXmlDeclaration(xml: string): string {
    if (!xml.startsWith('<?xml')) {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
    }
    return xml;
  }

  /**
   * Validate basic XML structure
   */
  static isValidXml(xml: string): boolean {
    try {
      // Basic validation - check for balanced tags
      const openTags = (xml.match(/<\w+[^>]*>/g) || []).length;
      const closeTags = (xml.match(/<\/\w+>/g) || []).length;
      const selfClosing = (xml.match(/\/>/g) || []).length;

      // Very basic check - not comprehensive
      return openTags > 0 && (closeTags + selfClosing) > 0;
    } catch {
      return false;
    }
  }
}

/**
 * DOCXMLATER FRAMEWORK INTEGRATION STATUS:
 *
 * ✅ IMPLEMENTED IN FRAMEWORK:
 * 1. document.getPart(partName) → Get document part (XML or binary)
 * 2. document.setPart(partName, content) → Update document part
 * 3. document.listParts() → List all parts in ZIP
 * 4. document.partExists(partName) → Check part existence
 * 5. XMLParser.parseToObject(xml, options) → Parse XML to JS object
 * 6. document.getAllRelationships() → Get all .rels files
 *
 * ⏳ PENDING IN FRAMEWORK:
 * 1. XMLBuilder.objectToXml(obj, options) → Convert JS object to XML string
 *    Current: Framework uses imperative element() API for building
 *    Needed: Declarative object serialization (reverse of parseToObject)
 *
 * This extension now uses 100% native DocXMLater APIs where available.
 */

export default DocXMLaterXmlParser;