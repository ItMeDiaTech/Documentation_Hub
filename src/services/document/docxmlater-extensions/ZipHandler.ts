/**
 * ZipHandler - DocXMLater Extension for ZIP Operations
 *
 * Replaces JSZip with DocXMLater-based document package handling.
 * This module provides access to document parts and ZIP operations
 * using DocXMLater's internal capabilities.
 *
 * REQUIREMENTS FOR DOCXMLATER FRAMEWORK:
 * - Need: Access to internal ZIP structure
 * - Need: Ability to add/remove document parts
 * - Need: Direct buffer/stream operations
 */

import { Document } from 'docxmlater';
import { logger } from '@/utils/logger';

const log = logger.namespace('DocXMLaterZipHandler');

export interface DocumentPart {
  name: string;
  content: string | Buffer;
  contentType?: string;
  compression?: boolean;
}

/**
 * DocXMLater-based ZIP/Package Handler
 * Provides document package operations without JSZip dependency
 */
export class DocXMLaterZipHandler {
  private doc: Document;

  constructor(document: Document) {
    this.doc = document;
  }

  /**
   * Load a document from buffer
   *
   * REQUIRED: DocXMLater already has Document.loadFromBuffer()
   */
  static async loadFromBuffer(buffer: Buffer): Promise<Document> {
    try {
      const doc = await Document.loadFromBuffer(buffer);
      return doc;
    } catch (error: any) {
      log.error('Failed to load document from buffer:', error.message);
      throw error;
    }
  }

  /**
   * Load a document from file path
   *
   * REQUIRED: DocXMLater already has Document.load()
   */
  static async loadFromFile(filePath: string): Promise<Document> {
    try {
      const doc = await Document.load(filePath);
      return doc;
    } catch (error: any) {
      log.error('Failed to load document from file:', error.message);
      throw error;
    }
  }

  /**
   * Save document to buffer
   *
   * REQUIRED: DocXMLater already has doc.toBuffer()
   */
  async toBuffer(): Promise<Buffer> {
    try {
      const buffer = await this.doc.toBuffer();
      return buffer;
    } catch (error: any) {
      log.error('Failed to convert document to buffer:', error.message);
      throw error;
    }
  }

  /**
   * Get a specific document part
   *
   * REQUIRED: DocXMLater needs to expose this capability
   * Proposed API: doc.getPart(partName)
   */
  async getPart(partName: string): Promise<DocumentPart | null> {
    try {
      // PROPOSED DOCXMLATER API:
      // const part = await this.doc.getPart(partName);
      // return {
      //   name: partName,
      //   content: part.content,
      //   contentType: part.contentType
      // };

      log.warn(`getPart not yet implemented in DocXMLater for: ${partName}`);

      // Temporary workaround using internal access
      // @ts-ignore - accessing internal temporarily
      const internalZip = this.doc._zip || this.doc.zip;
      if (internalZip) {
        const file = internalZip.file(partName);
        if (file) {
          const content = await file.async('string');
          return {
            name: partName,
            content: content
          };
        }
      }

      return null;
    } catch (error: any) {
      log.error(`Failed to get part ${partName}:`, error.message);
      return null;
    }
  }

  /**
   * Set/update a document part
   *
   * REQUIRED: DocXMLater needs to expose this capability
   * Proposed API: doc.setPart(partName, content)
   */
  async setPart(partName: string, content: string | Buffer): Promise<boolean> {
    try {
      // PROPOSED DOCXMLATER API:
      // await this.doc.setPart(partName, content);
      // return true;

      log.warn(`setPart not yet implemented in DocXMLater for: ${partName}`);

      // Temporary workaround
      // @ts-ignore - accessing internal temporarily
      const internalZip = this.doc._zip || this.doc.zip;
      if (internalZip) {
        internalZip.file(partName, content);
        return true;
      }

      return false;
    } catch (error: any) {
      log.error(`Failed to set part ${partName}:`, error.message);
      return false;
    }
  }

  /**
   * Remove a document part
   *
   * REQUIRED: DocXMLater needs this capability
   */
  async removePart(partName: string): Promise<boolean> {
    try {
      // PROPOSED DOCXMLATER API:
      // await this.doc.removePart(partName);
      // return true;

      log.warn(`removePart not yet implemented in DocXMLater for: ${partName}`);

      // Temporary workaround
      // @ts-ignore - accessing internal temporarily
      const internalZip = this.doc._zip || this.doc.zip;
      if (internalZip) {
        internalZip.remove(partName);
        return true;
      }

      return false;
    } catch (error: any) {
      log.error(`Failed to remove part ${partName}:`, error.message);
      return false;
    }
  }

  /**
   * List all parts in the document
   *
   * REQUIRED: DocXMLater should provide this
   */
  async listParts(): Promise<string[]> {
    try {
      // PROPOSED DOCXMLATER API:
      // return await this.doc.listParts();

      // Temporary workaround
      // @ts-ignore - accessing internal temporarily
      const internalZip = this.doc._zip || this.doc.zip;
      if (internalZip && internalZip.files) {
        return Object.keys(internalZip.files);
      }

      return [];
    } catch (error: any) {
      log.error('Failed to list parts:', error.message);
      return [];
    }
  }

  /**
   * Check if a part exists
   */
  async partExists(partName: string): Promise<boolean> {
    try {
      // PROPOSED DOCXMLATER API:
      // return await this.doc.partExists(partName);

      // Temporary workaround
      // @ts-ignore - accessing internal temporarily
      const internalZip = this.doc._zip || this.doc.zip;
      if (internalZip) {
        return internalZip.file(partName) !== null;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get content types from [Content_Types].xml
   *
   * REQUIRED: DocXMLater should provide access to content types
   */
  async getContentTypes(): Promise<Map<string, string>> {
    const contentTypes = new Map<string, string>();

    try {
      const contentTypesXml = await this.getPart('[Content_Types].xml');
      if (!contentTypesXml) {
        return contentTypes;
      }

      // Parse content types XML
      // This is a simplified version - DocXMLater should provide proper parsing
      const xmlContent = contentTypesXml.content.toString();

      // Extract Override elements
      const overrideMatches = xmlContent.matchAll(/<Override\s+PartName="([^"]+)"\s+ContentType="([^"]+)"/g);
      for (const match of overrideMatches) {
        contentTypes.set(match[1], match[2]);
      }

      // Extract Default elements
      const defaultMatches = xmlContent.matchAll(/<Default\s+Extension="([^"]+)"\s+ContentType="([^"]+)"/g);
      for (const match of defaultMatches) {
        contentTypes.set(`.${match[1]}`, match[2]);
      }

      return contentTypes;
    } catch (error: any) {
      log.error('Failed to get content types:', error.message);
      return contentTypes;
    }
  }

  /**
   * Add a new content type
   *
   * REQUIRED: DocXMLater should handle content type registration
   */
  async addContentType(partName: string, contentType: string): Promise<boolean> {
    try {
      // PROPOSED DOCXMLATER API:
      // await this.doc.addContentType(partName, contentType);
      // return true;

      log.warn('addContentType not yet implemented in DocXMLater');

      // For now, we need to manually update [Content_Types].xml
      const contentTypesXml = await this.getPart('[Content_Types].xml');
      if (!contentTypesXml) {
        return false;
      }

      let xmlContent = contentTypesXml.content.toString();

      // Check if override already exists
      if (!xmlContent.includes(`PartName="${partName}"`)) {
        // Add new Override element before closing tag
        const override = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
        xmlContent = xmlContent.replace('</Types>', `${override}</Types>`);

        await this.setPart('[Content_Types].xml', xmlContent);
      }

      return true;
    } catch (error: any) {
      log.error('Failed to add content type:', error.message);
      return false;
    }
  }

  /**
   * Copy document parts from one location to another
   */
  async copyPart(sourcePath: string, targetPath: string): Promise<boolean> {
    try {
      const sourcePart = await this.getPart(sourcePath);
      if (!sourcePart) {
        return false;
      }

      return await this.setPart(targetPath, sourcePart.content);
    } catch (error: any) {
      log.error(`Failed to copy part from ${sourcePath} to ${targetPath}:`, error.message);
      return false;
    }
  }

  /**
   * Get all relationships for the document
   *
   * REQUIRED: DocXMLater should provide relationship access
   */
  async getAllRelationships(): Promise<Map<string, any[]>> {
    const relationships = new Map<string, any[]>();

    try {
      const parts = await this.listParts();
      const relsParts = parts.filter(p => p.includes('/_rels/') && p.endsWith('.rels'));

      for (const relsPart of relsParts) {
        const relsContent = await this.getPart(relsPart);
        if (relsContent) {
          // Parse relationships (simplified - needs proper XML parsing)
          const xmlContent = relsContent.content.toString();
          const rels: any[] = [];

          // Extract Relationship elements
          const relMatches = xmlContent.matchAll(/<Relationship\s+([^>]+)>/g);
          for (const match of relMatches) {
            const attrs = match[1];
            const rel: any = {};

            // Extract attributes
            const idMatch = attrs.match(/Id="([^"]+)"/);
            const typeMatch = attrs.match(/Type="([^"]+)"/);
            const targetMatch = attrs.match(/Target="([^"]+)"/);
            const targetModeMatch = attrs.match(/TargetMode="([^"]+)"/);

            if (idMatch) rel.Id = idMatch[1];
            if (typeMatch) rel.Type = typeMatch[1];
            if (targetMatch) rel.Target = targetMatch[1];
            if (targetModeMatch) rel.TargetMode = targetModeMatch[1];

            rels.push(rel);
          }

          relationships.set(relsPart, rels);
        }
      }

      return relationships;
    } catch (error: any) {
      log.error('Failed to get all relationships:', error.message);
      return relationships;
    }
  }
}

/**
 * Utility functions for document package operations
 */
export class ZipUtils {
  /**
   * Create an empty document structure
   *
   * REQUIRED: DocXMLater should provide Document.createEmpty()
   */
  static createEmptyDocument(): Document {
    // PROPOSED DOCXMLATER API:
    // return Document.createEmpty();

    // For now, use existing create method
    return Document.create();
  }

  /**
   * Validate document package structure
   */
  static async validatePackageStructure(handler: DocXMLaterZipHandler): Promise<{
    valid: boolean;
    missingParts: string[];
    issues: string[];
  }> {
    const requiredParts = [
      '[Content_Types].xml',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      '_rels/.rels'
    ];

    const missingParts: string[] = [];
    const issues: string[] = [];

    for (const part of requiredParts) {
      const exists = await handler.partExists(part);
      if (!exists) {
        missingParts.push(part);
        issues.push(`Missing required part: ${part}`);
      }
    }

    // Check for main document relationship
    const mainRels = await handler.getPart('_rels/.rels');
    if (mainRels) {
      const content = mainRels.content.toString();
      if (!content.includes('officeDocument')) {
        issues.push('Missing main document relationship in _rels/.rels');
      }
    }

    return {
      valid: missingParts.length === 0 && issues.length === 0,
      missingParts,
      issues
    };
  }

  /**
   * Get document statistics
   */
  static async getDocumentStats(handler: DocXMLaterZipHandler): Promise<{
    totalParts: number;
    xmlParts: number;
    relsParts: number;
    mediaParts: number;
    themeParts: number;
  }> {
    const parts = await handler.listParts();

    return {
      totalParts: parts.length,
      xmlParts: parts.filter(p => p.endsWith('.xml')).length,
      relsParts: parts.filter(p => p.endsWith('.rels')).length,
      mediaParts: parts.filter(p => p.includes('/media/')).length,
      themeParts: parts.filter(p => p.includes('/theme/')).length
    };
  }
}

/**
 * DOCXMLATER FRAMEWORK REQUIREMENTS SUMMARY:
 *
 * The DocXMLater framework needs these ZIP/package capabilities:
 *
 * 1. document.getPart(partName: string): Promise<DocumentPart>
 *    - Get any part from the document package
 *
 * 2. document.setPart(partName: string, content: string | Buffer): Promise<void>
 *    - Set/update any part in the document package
 *
 * 3. document.removePart(partName: string): Promise<void>
 *    - Remove a part from the document package
 *
 * 4. document.listParts(): Promise<string[]>
 *    - List all parts in the package
 *
 * 5. document.partExists(partName: string): Promise<boolean>
 *    - Check if a part exists
 *
 * 6. document.getContentTypes(): Promise<Map<string, string>>
 *    - Get all content type definitions
 *
 * 7. document.addContentType(partName: string, type: string): Promise<void>
 *    - Register a new content type
 *
 * 8. Document.createEmpty(): Document
 *    - Create an empty document structure
 *
 * These additions would completely eliminate the need for JSZip.
 */

export default DocXMLaterZipHandler;