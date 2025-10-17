/**
 * ValidationEngine - Document validation and integrity checking
 * Validates document structure, relationships, and content
 */

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type {
  ValidationResult,
  ValidationIssue,
  ValidationSuggestion,
  ValidationOptions
} from '@/types/document-processing';

/**
 * Engine for validating Word documents
 */
export class ValidationEngine {
  private requiredParts = [
    'word/document.xml',
    'word/_rels/document.xml.rels',
    '[Content_Types].xml',
    '_rels/.rels'
  ];

  private optionalParts = [
    'word/styles.xml',
    'word/numbering.xml',
    'word/settings.xml',
    'word/fontTable.xml',
    'word/webSettings.xml',
    'word/theme/theme1.xml'
  ];

  private xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: true,
      trimValues: true,
      processEntities: false,
      parseTagValue: false,
      preserveOrder: false
    });
  }

  /**
   * Validate document structure and content
   */
  async validateDocument(
    zip: JSZip,
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const suggestions: ValidationSuggestion[] = [];
    let score = 100;

    // Check document structure
    if (options.checkStructure !== false) {
      const structureIssues = await this.validateStructure(zip);
      issues.push(...structureIssues);
      score -= structureIssues.filter(i => i.severity === 'error').length * 10;
      score -= structureIssues.filter(i => i.severity === 'warning').length * 5;
    }

    // Check relationships
    if (options.checkRelationships) {
      const relationshipIssues = await this.validateRelationships(zip);
      issues.push(...relationshipIssues);
      score -= relationshipIssues.filter(i => i.severity === 'error').length * 8;
    }

    // Check styles
    if (options.checkStyles) {
      const styleIssues = await this.validateStyles(zip);
      issues.push(...styleIssues);
      suggestions.push(...this.generateStyleSuggestions(styleIssues));
    }

    // Check hyperlinks
    if (options.checkHyperlinks) {
      const hyperlinkIssues = await this.validateHyperlinks(zip);
      issues.push(...hyperlinkIssues);
      score -= hyperlinkIssues.filter(i => i.severity === 'error').length * 5;
    }

    // Check images
    if (options.checkImages) {
      const imageIssues = await this.validateImages(zip);
      issues.push(...imageIssues);
    }

    // Check metadata
    if (options.checkMetadata) {
      const metadataIssues = await this.validateMetadata(zip);
      issues.push(...metadataIssues);
      suggestions.push(...this.generateMetadataSuggestions(metadataIssues));
    }

    // Apply strict mode additional checks
    if (options.strictMode) {
      const strictIssues = await this.performStrictValidation(zip);
      issues.push(...strictIssues);
    }

    // Ensure score doesn't go below 0
    score = Math.max(0, score);

    return {
      valid: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      suggestions,
      score
    };
  }

  /**
   * Validate document structure
   */
  private async validateStructure(zip: JSZip): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Check for required parts
    for (const part of this.requiredParts) {
      if (!zip.file(part)) {
        issues.push({
          severity: 'error',
          code: 'MISSING_REQUIRED_PART',
          message: `Required document part missing: ${part}`,
          location: part,
          fixable: false
        });
      }
    }

    // Check document.xml structure
    const documentFile = zip.file('word/document.xml');
    if (documentFile) {
      try {
        const content = await documentFile.async('string');
        const parsed = this.xmlParser.parse(content);

        // Check for document body
        if (!parsed['w:document']?.['w:body']) {
          issues.push({
            severity: 'error',
            code: 'INVALID_DOCUMENT_STRUCTURE',
            message: 'Document body is missing',
            location: 'word/document.xml',
            fixable: false
          });
        }

        // Check for at least one paragraph
        const body = parsed['w:document']?.['w:body'];
        if (body && !body['w:p']) {
          issues.push({
            severity: 'warning',
            code: 'EMPTY_DOCUMENT',
            message: 'Document contains no paragraphs',
            location: 'word/document.xml',
            fixable: true,
            autoFix: async () => {
              // Add empty paragraph
            }
          });
        }
      } catch (error) {
        issues.push({
          severity: 'error',
          code: 'MALFORMED_XML',
          message: `Document XML is malformed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          location: 'word/document.xml',
          fixable: false
        });
      }
    }

    // Check content types
    const contentTypesFile = zip.file('[Content_Types].xml');
    if (contentTypesFile) {
      try {
        const content = await contentTypesFile.async('string');
        this.xmlParser.parse(content);
      } catch {
        issues.push({
          severity: 'error',
          code: 'INVALID_CONTENT_TYPES',
          message: 'Content types file is invalid',
          location: '[Content_Types].xml',
          fixable: false
        });
      }
    }

    return issues;
  }

  /**
   * Validate relationships
   */
  private async validateRelationships(zip: JSZip): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    const relsFile = zip.file('word/_rels/document.xml.rels');
    if (!relsFile) {
      return issues;
    }

    try {
      const content = await relsFile.async('string');
      const parsed = this.xmlParser.parse(content);

      const relationships = parsed.Relationships?.Relationship;
      if (!relationships) {
        return issues;
      }

      const rels = Array.isArray(relationships) ? relationships : [relationships];
      const usedIds = new Set<string>();

      for (const rel of rels) {
        // CRITICAL: Use @_ prefix for attributes per OOXML_HYPERLINK_ARCHITECTURE.md
        const relId = rel['@_Id'];
        const relType = rel['@_Type'];
        const relTarget = rel['@_Target'];
        const relTargetMode = rel['@_TargetMode'];

        // Check for duplicate IDs
        if (usedIds.has(relId)) {
          issues.push({
            severity: 'error',
            code: 'DUPLICATE_RELATIONSHIP_ID',
            message: `Duplicate relationship ID: ${relId}`,
            element: relId,
            fixable: true,
            autoFix: async () => {
              // Generate new unique ID
            }
          });
        }
        usedIds.add(relId);

        // Validate relationship targets
        if (relType?.includes('hyperlink') && relTargetMode === 'External') {
          // External hyperlinks should have valid URLs
          if (!this.isValidUrl(relTarget)) {
            issues.push({
              severity: 'warning',
              code: 'INVALID_HYPERLINK_URL',
              message: `Invalid hyperlink URL: ${relTarget}`,
              element: relId,
              fixable: false
            });
          }
        } else if (relTargetMode !== 'External') {
          // Internal targets should exist
          const targetPath = `word/${relTarget}`;
          if (!zip.file(targetPath) && !relType?.includes('hyperlink')) {
            issues.push({
              severity: 'error',
              code: 'MISSING_RELATIONSHIP_TARGET',
              message: `Relationship target not found: ${relTarget}`,
              element: relId,
              location: targetPath,
              fixable: false
            });
          }
        }
      }

      // Check for orphaned relationships
      const documentFile = zip.file('word/document.xml');
      if (documentFile) {
        const docContent = await documentFile.async('string');
        for (const id of usedIds) {
          if (!docContent.includes(`r:id="${id}"`)) {
            issues.push({
              severity: 'warning',
              code: 'ORPHANED_RELATIONSHIP',
              message: `Orphaned relationship: ${id}`,
              element: id,
              fixable: true,
              autoFix: async () => {
                // Remove orphaned relationship
              }
            });
          }
        }
      }
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'INVALID_RELATIONSHIPS',
        message: `Relationships file is invalid: ${error instanceof Error ? error.message : 'Unknown error'}`,
        location: 'word/_rels/document.xml.rels',
        fixable: false
      });
    }

    return issues;
  }

  /**
   * Validate styles
   */
  private async validateStyles(zip: JSZip): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    const stylesFile = zip.file('word/styles.xml');
    if (!stylesFile) {
      issues.push({
        severity: 'info',
        code: 'NO_STYLES',
        message: 'Document has no custom styles',
        location: 'word/styles.xml',
        fixable: true,
        autoFix: async () => {
          // Create default styles.xml
        }
      });
      return issues;
    }

    try {
      const content = await stylesFile.async('string');
      const parsed = this.xmlParser.parse(content);

      // Check for required default styles
      const requiredStyles = ['Normal', 'Heading1', 'Heading2'];
      const styles = parsed['w:styles']?.['w:style'];

      if (styles) {
        const styleArray = Array.isArray(styles) ? styles : [styles];
        const styleIds = new Set(styleArray.map((s: any) => s.$?.['w:styleId']));

        for (const required of requiredStyles) {
          if (!styleIds.has(required)) {
            issues.push({
              severity: 'warning',
              code: 'MISSING_STYLE',
              message: `Required style missing: ${required}`,
              element: required,
              location: 'word/styles.xml',
              fixable: true,
              autoFix: async () => {
                // Add missing style
              }
            });
          }
        }
      }
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'INVALID_STYLES',
        message: `Styles file is invalid: ${error instanceof Error ? error.message : 'Unknown error'}`,
        location: 'word/styles.xml',
        fixable: false
      });
    }

    return issues;
  }

  /**
   * Validate hyperlinks
   */
  private async validateHyperlinks(zip: JSZip): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    const documentFile = zip.file('word/document.xml');
    const relsFile = zip.file('word/_rels/document.xml.rels');

    if (!documentFile || !relsFile) {
      return issues;
    }

    try {
      const docContent = await documentFile.async('string');
      const relsContent = await relsFile.async('string');

      // Find all hyperlink references in document
      const hyperlinkMatches = docContent.match(/r:id="(rId\d+)"/g) || [];
      const hyperlinkIds = new Set(
        hyperlinkMatches.map(match => match.match(/rId\d+/)?.[0]).filter(Boolean)
      );

      // Parse relationships
      const relsParsed = this.xmlParser.parse(relsContent);

      const relationships = relsParsed.Relationships?.Relationship;
      if (!relationships) {
        return issues;
      }

      const rels = Array.isArray(relationships) ? relationships : [relationships];
      // CRITICAL: Use @_ prefix for attributes per OOXML_HYPERLINK_ARCHITECTURE.md
      const hyperlinkRels = rels.filter((r: any) => r['@_Type']?.includes('hyperlink'));

      // Check for missing hyperlink relationships
      for (const id of hyperlinkIds) {
        const found = hyperlinkRels.find((r: any) => r['@_Id'] === id);
        if (!found) {
          issues.push({
            severity: 'error',
            code: 'MISSING_HYPERLINK_REL',
            message: `Missing hyperlink relationship: ${id}`,
            element: id,
            fixable: false
          });
        }
      }

      // Validate hyperlink URLs
      for (const rel of hyperlinkRels) {
        const relTarget = rel['@_Target'];
        const relId = rel['@_Id'];
        const relTargetMode = rel['@_TargetMode'];

        if (!this.isValidUrl(relTarget)) {
          issues.push({
            severity: 'warning',
            code: 'INVALID_URL',
            message: `Invalid URL format: ${relTarget}`,
            element: relId,
            fixable: false
          });
        }

        // Check for missing TargetMode on external URLs
        if (relTarget?.startsWith('http') && relTargetMode !== 'External') {
          issues.push({
            severity: 'error',
            code: 'MISSING_TARGET_MODE',
            message: `External URL missing TargetMode="External": ${relId}`,
            element: relId,
            fixable: true
          });
        }
      }
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'HYPERLINK_VALIDATION_ERROR',
        message: `Failed to validate hyperlinks: ${error instanceof Error ? error.message : 'Unknown error'}`,
        fixable: false
      });
    }

    return issues;
  }

  /**
   * Validate images
   */
  private async validateImages(zip: JSZip): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Check media folder
    const mediaFiles = Object.keys(zip.files).filter(
      name => name.startsWith('word/media/')
    );

    for (const mediaFile of mediaFiles) {
      const file = zip.file(mediaFile);
      if (file) {
        try {
          const data = await file.async('uint8array');

          // Check file size
          if (data.length > 10 * 1024 * 1024) { // 10MB
            issues.push({
              severity: 'warning',
              code: 'LARGE_IMAGE',
              message: `Large image file: ${mediaFile} (${Math.round(data.length / 1024 / 1024)}MB)`,
              location: mediaFile,
              fixable: false
            });
          }

          // Check image format
          if (!this.isValidImageFormat(data)) {
            issues.push({
              severity: 'warning',
              code: 'UNSUPPORTED_IMAGE_FORMAT',
              message: `Unsupported image format: ${mediaFile}`,
              location: mediaFile,
              fixable: false
            });
          }
        } catch {
          issues.push({
            severity: 'error',
            code: 'CORRUPT_IMAGE',
            message: `Corrupt image file: ${mediaFile}`,
            location: mediaFile,
            fixable: false
          });
        }
      }
    }

    return issues;
  }

  /**
   * Validate metadata
   */
  private async validateMetadata(zip: JSZip): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    const coreFile = zip.file('docProps/core.xml');
    if (!coreFile) {
      issues.push({
        severity: 'info',
        code: 'NO_METADATA',
        message: 'Document has no metadata',
        location: 'docProps/core.xml',
        fixable: true,
        autoFix: async () => {
          // Create default metadata
        }
      });
      return issues;
    }

    try {
      const content = await coreFile.async('string');
      const parsed = this.xmlParser.parse(content);

      // Check for recommended metadata fields
      const metadata = parsed['cp:coreProperties'];
      if (metadata) {
        const recommendedFields = ['dc:title', 'dc:creator', 'dc:description'];

        for (const field of recommendedFields) {
          if (!metadata[field]) {
            issues.push({
              severity: 'info',
              code: 'MISSING_METADATA_FIELD',
              message: `Recommended metadata field missing: ${field}`,
              element: field,
              location: 'docProps/core.xml',
              fixable: true
            });
          }
        }
      }
    } catch {
      issues.push({
        severity: 'warning',
        code: 'INVALID_METADATA',
        message: 'Document metadata is invalid',
        location: 'docProps/core.xml',
        fixable: false
      });
    }

    return issues;
  }

  /**
   * Perform strict validation
   */
  private async performStrictValidation(zip: JSZip): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Check for optional but recommended parts
    for (const part of this.optionalParts) {
      if (!zip.file(part)) {
        issues.push({
          severity: 'info',
          code: 'MISSING_OPTIONAL_PART',
          message: `Optional part missing: ${part}`,
          location: part,
          fixable: true
        });
      }
    }

    // Check for consistent formatting
    const documentFile = zip.file('word/document.xml');
    if (documentFile) {
      const content = await documentFile.async('string');

      // Check for mixed line endings
      if (content.includes('\r\n') && content.includes('\n')) {
        issues.push({
          severity: 'warning',
          code: 'MIXED_LINE_ENDINGS',
          message: 'Document has mixed line endings',
          fixable: true,
          autoFix: async () => {
            // Normalize line endings
          }
        });
      }
    }

    return issues;
  }

  /**
   * Generate style suggestions
   */
  private generateStyleSuggestions(issues: ValidationIssue[]): ValidationSuggestion[] {
    const suggestions: ValidationSuggestion[] = [];

    if (issues.some(i => i.code === 'MISSING_STYLE')) {
      suggestions.push({
        type: 'styles',
        message: 'Consider adding standard heading styles for better document structure',
        impact: 'medium',
        implementation: 'Use the Styles Editor to define consistent heading styles'
      });
    }

    return suggestions;
  }

  /**
   * Generate metadata suggestions
   */
  private generateMetadataSuggestions(issues: ValidationIssue[]): ValidationSuggestion[] {
    const suggestions: ValidationSuggestion[] = [];

    if (issues.some(i => i.code === 'MISSING_METADATA_FIELD')) {
      suggestions.push({
        type: 'metadata',
        message: 'Add document metadata for better searchability and organization',
        impact: 'low',
        implementation: 'Add title, author, and description metadata'
      });
    }

    return suggestions;
  }

  /**
   * Check if URL is valid
   */
  private isValidUrl(url: string): boolean {
    if (!url) return false;

    // Allow internal links
    if (url.startsWith('#')) return true;

    // Check common protocols
    const validProtocols = ['http://', 'https://', 'mailto:', 'file://'];
    if (!validProtocols.some(p => url.startsWith(p))) {
      return false;
    }

    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if image format is valid
   */
  private isValidImageFormat(data: Uint8Array): boolean {
    // Check for common image signatures
    const signatures = {
      jpeg: [0xFF, 0xD8, 0xFF],
      png: [0x89, 0x50, 0x4E, 0x47],
      gif: [0x47, 0x49, 0x46],
      bmp: [0x42, 0x4D]
    };

    for (const [, signature] of Object.entries(signatures)) {
      if (signature.every((byte, index) => data[index] === byte)) {
        return true;
      }
    }

    return false;
  }
}