/**
 * OOXMLValidator - DocXMLater Version
 *
 * Post-Processing OOXML Validation and Repair using DocXMLater
 * This replaces the JSZip/fast-xml-parser version with pure DocXMLater
 *
 * Uses string-based validation and fixes to avoid parse/rebuild corruption
 */

import { Document } from 'docxmlater';
import { logger } from '@/utils/logger';
import { DocXMLaterStylesValidator } from './docxmlater-extensions/StylesValidator';
import { DocXMLaterXmlParser, XmlHelper } from './docxmlater-extensions/XmlParser';
import { DocXMLaterZipHandler, ZipUtils } from './docxmlater-extensions/ZipHandler';

const log = logger.namespace('OOXMLValidator-DocXMLater');

interface ValidationIssue {
  severity: 'error' | 'warning';
  type: string;
  message: string;
  element?: string;
}

export interface OOXMLValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  fixes: string[];
  correctedDocument?: Document;
  correctedBuffer?: Buffer;
}

/**
 * OOXMLValidator using DocXMLater
 * Validates and repairs OOXML documents without external XML dependencies
 */
export class DocXMLaterOOXMLValidator {
  /**
   * Validate and fix a DOCX document
   * Uses DocXMLater for all operations - no JSZip or fast-xml-parser
   */
  async validateAndFixDocument(doc: Document): Promise<OOXMLValidationResult> {
    log.debug('Starting OOXML validation with DocXMLater (string-based, no parse/rebuild)');

    const result: OOXMLValidationResult = {
      valid: true,
      issues: [],
      fixes: [],
      correctedDocument: doc
    };

    try {
      // Initialize DocXMLater extensions
      const xmlParser = new DocXMLaterXmlParser(doc);
      const zipHandler = new DocXMLaterZipHandler(doc);
      const stylesValidator = new DocXMLaterStylesValidator(doc);

      // Get raw XML content from document parts
      const documentXmlStr = await xmlParser.getRawXmlFromPart('word/document.xml');
      const relsXmlStr = await xmlParser.getRawXmlFromPart('word/_rels/document.xml.rels');

      if (!documentXmlStr || !relsXmlStr) {
        result.valid = false;
        result.issues.push({
          severity: 'error',
          type: 'MISSING_FILES',
          message: 'Missing document.xml or document.xml.rels'
        });
        return result;
      }

      // Validate hyperlink integrity
      await this.validateHyperlinkIntegrity(xmlParser, documentXmlStr, relsXmlStr, result);

      // Validate XML structure
      this.validateXmlStructure(documentXmlStr, relsXmlStr, result);

      // Validate styles.xml
      const stylesResult = await stylesValidator.validateAndFix();
      if (!stylesResult.valid) {
        result.valid = false;
        for (const issue of stylesResult.issues) {
          result.issues.push({
            severity: issue.severity,
            type: 'STYLES_XML_CORRUPTION',
            message: `${issue.pattern}: ${issue.description}`,
            element: issue.pattern
          });
        }
      }
      if (stylesResult.fixes.length > 0) {
        result.fixes.push(...stylesResult.fixes.map(f => `[styles.xml] ${f}`));
      }

      // Apply fixes if issues found
      if (result.issues.length > 0) {
        log.warn(`Found ${result.issues.length} OOXML issues, attempting fixes`);

        // Apply string-based fixes
        const fixes = this.fixCriticalIssuesViaStringManipulation(
          documentXmlStr,
          relsXmlStr
        );
        result.fixes.push(...fixes.changes);

        if (fixes.changes.length > 0) {
          log.info(`Applied ${fixes.changes.length} fixes via string manipulation`);

          // Update document parts with fixed content
          await xmlParser.setRawXmlInPart('word/document.xml', fixes.documentXml);
          await xmlParser.setRawXmlInPart('word/_rels/document.xml.rels', fixes.relsXml);

          log.info('Updated document with string-based fixes');
        }
      }

      // Validate package structure
      const packageValidation = await ZipUtils.validatePackageStructure(zipHandler);
      if (!packageValidation.valid) {
        result.valid = false;
        for (const issue of packageValidation.issues) {
          result.issues.push({
            severity: 'error',
            type: 'PACKAGE_STRUCTURE',
            message: issue
          });
        }
      }

      // Generate corrected buffer if needed
      if (result.fixes.length > 0) {
        result.correctedBuffer = await doc.toBuffer();
      }

      return {
        ...result,
        valid: result.issues.filter(i => i.severity === 'error').length === 0
      };

    } catch (error: any) {
      log.error('OOXML validation failed:', error.message);
      result.valid = false;
      result.issues.push({
        severity: 'error',
        type: 'VALIDATION_ERROR',
        message: `Validation error: ${error.message}`
      });
      return result;
    }
  }

  /**
   * Validate and fix a buffer (loads document first)
   */
  async validateAndFixBuffer(buffer: Buffer): Promise<OOXMLValidationResult> {
    try {
      // Load document from buffer using DocXMLater
      const doc = await Document.loadFromBuffer(buffer);
      return await this.validateAndFixDocument(doc);
    } catch (error: any) {
      log.error('Failed to load document from buffer:', error.message);
      return {
        valid: false,
        issues: [{
          severity: 'error',
          type: 'LOAD_ERROR',
          message: `Failed to load document: ${error.message}`
        }],
        fixes: []
      };
    }
  }

  /**
   * Validate hyperlink two-part relationship system
   * Uses DocXMLater's XML parsing capabilities
   */
  private async validateHyperlinkIntegrity(
    xmlParser: DocXMLaterXmlParser,
    documentXmlStr: string,
    relsXmlStr: string,
    result: OOXMLValidationResult
  ): Promise<void> {
    log.debug('Validating hyperlink integrity');

    // Extract hyperlink IDs from document.xml
    const documentHyperlinkIds = new Set<string>();
    const hyperlinkMatches = documentXmlStr.matchAll(/<w:hyperlink\s+r:id="([^"]+)"/g);
    for (const match of hyperlinkMatches) {
      documentHyperlinkIds.add(match[1]);
    }

    // Extract relationships from .rels file
    const relsIds = new Set<string>();
    const externalUrlsWithoutTargetMode: string[] = [];

    // Parse relationships
    const relMatches = relsXmlStr.matchAll(
      /<Relationship\s+Id="([^"]+)"\s+Type="([^"]+)"\s+Target="([^"]+)"(?:\s+TargetMode="([^"]+)")?/g
    );

    for (const match of relMatches) {
      const [, id, type, target, targetMode] = match;

      if (type?.includes('hyperlink')) {
        relsIds.add(id);

        // Check for missing TargetMode on external URLs
        if (target?.startsWith('http') && targetMode !== 'External') {
          externalUrlsWithoutTargetMode.push(`${id}: ${target}`);
        }
      }
    }

    // Check for missing relationships
    for (const docId of documentHyperlinkIds) {
      if (!relsIds.has(docId)) {
        result.valid = false;
        result.issues.push({
          severity: 'error',
          type: 'MISSING_RELATIONSHIP',
          message: `Hyperlink references ${docId} but relationship not found`,
          element: docId
        });
      }
    }

    // Check for orphaned relationships
    for (const relsId of relsIds) {
      if (!documentHyperlinkIds.has(relsId)) {
        result.issues.push({
          severity: 'warning',
          type: 'ORPHANED_RELATIONSHIP',
          message: `Relationship ${relsId} exists but is not referenced`,
          element: relsId
        });
      }
    }

    // Check for external URLs without TargetMode
    for (const url of externalUrlsWithoutTargetMode) {
      result.valid = false;
      result.issues.push({
        severity: 'error',
        type: 'MISSING_TARGET_MODE',
        message: `External URL missing TargetMode="External": ${url}`,
        element: url
      });
    }
  }

  /**
   * Validate XML structure and formatting
   */
  private validateXmlStructure(
    documentXmlStr: string,
    relsXmlStr: string,
    result: OOXMLValidationResult
  ): void {
    log.debug('Validating XML structure');

    // Check for XML declarations
    if (!documentXmlStr.startsWith('<?xml')) {
      result.issues.push({
        severity: 'warning',
        type: 'MISSING_XML_DECLARATION',
        message: 'document.xml missing XML declaration'
      });
    }

    if (!relsXmlStr.startsWith('<?xml')) {
      result.issues.push({
        severity: 'warning',
        type: 'MISSING_XML_DECLARATION',
        message: 'document.xml.rels missing XML declaration'
      });
    }

    // Check for valid UTF-8 encoding
    if (documentXmlStr.includes('encoding="ASCII"') || documentXmlStr.includes("encoding='ASCII'")) {
      result.valid = false;
      result.issues.push({
        severity: 'error',
        type: 'INVALID_ENCODING',
        message: 'document.xml has invalid ASCII encoding - Word requires UTF-8'
      });
    }

    if (relsXmlStr.includes('encoding="ASCII"') || relsXmlStr.includes("encoding='ASCII'")) {
      result.valid = false;
      result.issues.push({
        severity: 'error',
        type: 'INVALID_ENCODING',
        message: 'document.xml.rels has invalid ASCII encoding - Word requires UTF-8'
      });
    }
  }

  /**
   * Fix critical OOXML issues using STRING-BASED MANIPULATION
   * This avoids parse/rebuild corruption by working directly with XML strings
   */
  private fixCriticalIssuesViaStringManipulation(
    documentXmlStr: string,
    relsXmlStr: string
  ): { documentXml: string; relsXml: string; changes: string[] } {
    const changes: string[] = [];
    let modifiedRelsXml = relsXmlStr;
    let modifiedDocumentXml = documentXmlStr;

    // Fix 1: Ensure UTF-8 encoding
    if (modifiedDocumentXml.includes('encoding="ASCII"')) {
      modifiedDocumentXml = modifiedDocumentXml.replace(/encoding="ASCII"/gi, 'encoding="UTF-8"');
      changes.push('Fixed document.xml encoding from ASCII to UTF-8');
    }

    if (modifiedRelsXml.includes('encoding="ASCII"')) {
      modifiedRelsXml = modifiedRelsXml.replace(/encoding="ASCII"/gi, 'encoding="UTF-8"');
      changes.push('Fixed relationships encoding from ASCII to UTF-8');
    }

    // Fix 2: Add TargetMode="External" to external URLs in relationships
    modifiedRelsXml = modifiedRelsXml.replace(
      /(<Relationship[^>]*Target="https?:\/\/[^"]*")([^>]*TargetMode[^>]*)?\s*\/>/g,
      (match, beforeAttrs, targetMode) => {
        if (!targetMode) {
          changes.push('Added TargetMode="External" to hyperlink relationship');
          return `${beforeAttrs} TargetMode="External" />`;
        }
        return match;
      }
    );

    // Fix 3: Remove orphaned hyperlinks with empty display text
    const beforeLength = modifiedDocumentXml.length;
    modifiedDocumentXml = modifiedDocumentXml.replace(
      /<w:hyperlink[^>]*>\s*<w:r>\s*<w:t[^>]*>\s*<\/w:t>\s*<\/w:r>\s*<\/w:hyperlink>/g,
      ''
    );
    if (modifiedDocumentXml.length < beforeLength) {
      changes.push('Removed orphaned hyperlinks with empty display text');
    }

    // Fix 4: Ensure XML declarations
    modifiedDocumentXml = XmlHelper.ensureXmlDeclaration(modifiedDocumentXml);
    modifiedRelsXml = XmlHelper.ensureXmlDeclaration(modifiedRelsXml);

    // Fix 5: Ensure xml:space="preserve" on text nodes
    modifiedDocumentXml = modifiedDocumentXml.replace(
      /<w:t>([^<]+)<\/w:t>/g,
      '<w:t xml:space="preserve">$1</w:t>'
    );

    // Fix 6: Remove double closing brackets if any
    if (modifiedDocumentXml.includes('>>')) {
      modifiedDocumentXml = modifiedDocumentXml.replace(/>>/g, '>');
      changes.push('Fixed double closing brackets in document.xml');
    }

    if (modifiedRelsXml.includes('>>')) {
      modifiedRelsXml = modifiedRelsXml.replace(/>>/g, '>');
      changes.push('Fixed double closing brackets in relationships');
    }

    return {
      documentXml: modifiedDocumentXml,
      relsXml: modifiedRelsXml,
      changes
    };
  }

  /**
   * Generate validation report
   */
  static generateReport(result: OOXMLValidationResult): string {
    let report = '=== OOXML VALIDATION REPORT (DocXMLater) ===\n\n';
    report += `Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}\n`;
    report += `Total Issues: ${result.issues.length}\n`;
    report += `Fixes Applied: ${result.fixes.length}\n\n`;

    if (result.issues.length > 0) {
      report += 'ISSUES FOUND:\n';
      const errors = result.issues.filter(i => i.severity === 'error');
      const warnings = result.issues.filter(i => i.severity === 'warning');

      if (errors.length > 0) {
        report += '\n  ERRORS:\n';
        errors.forEach((issue, idx) => {
          report += `    ${idx + 1}. [${issue.type}] ${issue.message}\n`;
          if (issue.element) {
            report += `       Element: ${issue.element}\n`;
          }
        });
      }

      if (warnings.length > 0) {
        report += '\n  WARNINGS:\n';
        warnings.forEach((issue, idx) => {
          report += `    ${idx + 1}. [${issue.type}] ${issue.message}\n`;
        });
      }
    }

    if (result.fixes.length > 0) {
      report += '\nFIXES APPLIED:\n';
      result.fixes.forEach((fix, idx) => {
        report += `  ${idx + 1}. ${fix}\n`;
      });
    }

    return report;
  }
}

/**
 * Create singleton instance for convenience
 */
export const docXMLaterOOXMLValidator = new DocXMLaterOOXMLValidator();

/**
 * MIGRATION NOTES:
 *
 * This replaces the original OOXMLValidator.ts by:
 * 1. Using DocXMLater Document instead of JSZip
 * 2. Using DocXMLater extensions instead of fast-xml-parser
 * 3. Maintaining string-based validation to avoid corruption
 * 4. Working directly with Document objects instead of buffers
 *
 * To complete the migration:
 * 1. Replace imports in WordDocumentProcessor.ts
 * 2. Remove the old OOXMLValidator.ts
 * 3. Update any other files that reference the old validator
 */

export default DocXMLaterOOXMLValidator;