/**
 * StylesValidator - DocXMLater Extension for Style Validation
 *
 * Ports the StylesXmlValidator logic to use DocXMLater APIs.
 * This module provides styles.xml corruption detection and repair
 * using DocXMLater's style management capabilities.
 *
 * REQUIREMENTS FOR DOCXMLATER FRAMEWORK:
 * - Need: Access to raw styles.xml content
 * - Need: Ability to validate style definitions
 * - Need: String-based XML manipulation without parsing
 */

import { Document, Style, StylesManager } from 'docxmlater';
import { logger } from '@/utils/logger';
import { DocXMLaterXmlParser, XmlHelper } from './XmlParser';
import { DocXMLaterZipHandler } from './ZipHandler';

const log = logger.namespace('DocXMLaterStylesValidator');

export interface StyleValidationIssue {
  severity: 'error' | 'warning';
  pattern: string;
  description: string;
  lineNumber?: number;
  context?: string;
}

export interface StyleValidationResult {
  valid: boolean;
  issues: StyleValidationIssue[];
  fixed: boolean;
  fixedContent?: string;
  fixes: string[];
}

/**
 * DocXMLater-based Styles Validator
 * Detects and fixes corruption in styles.xml using DocXMLater
 */
export class DocXMLaterStylesValidator {
  private doc: Document;
  private xmlParser: DocXMLaterXmlParser;
  private zipHandler: DocXMLaterZipHandler;

  constructor(document: Document) {
    this.doc = document;
    this.xmlParser = new DocXMLaterXmlParser(document);
    this.zipHandler = new DocXMLaterZipHandler(document);
  }

  /**
   * Validate and fix styles.xml content
   * Uses string-based validation to avoid parse/rebuild corruption
   */
  async validateAndFix(): Promise<StyleValidationResult> {
    const result: StyleValidationResult = {
      valid: true,
      issues: [],
      fixed: false,
      fixes: []
    };

    try {
      // Get raw styles.xml content
      const stylesXml = await this.xmlParser.getRawXmlFromPart('word/styles.xml');

      if (!stylesXml) {
        log.debug('No styles.xml found (optional file)');
        return result;
      }

      // Step 1: Detect corruption patterns
      this.detectCorruptionPatterns(stylesXml, result);

      // Step 2: If issues found, attempt to fix via string manipulation
      if (result.issues.length > 0) {
        log.warn(`Found ${result.issues.length} issues in styles.xml`);

        let fixedContent = stylesXml;

        // Apply all available fixes
        for (const fix of this.getApplicableFixes()) {
          const before = fixedContent;
          fixedContent = fix.apply(fixedContent);

          if (before !== fixedContent) {
            result.fixes.push(fix.name);
            log.info(`Applied fix: ${fix.name}`);
          }
        }

        // Validate again after fixes
        const retestResult: StyleValidationResult = {
          valid: true,
          issues: [],
          fixed: false,
          fixes: []
        };
        this.detectCorruptionPatterns(fixedContent, retestResult);

        if (retestResult.issues.length < result.issues.length) {
          result.fixed = true;
          result.fixedContent = fixedContent;

          // Apply the fixed content back to the document
          await this.xmlParser.setRawXmlInPart('word/styles.xml', fixedContent);

          log.info(`Fixed styles.xml - reduced issues from ${result.issues.length} to ${retestResult.issues.length}`);
        } else if (retestResult.issues.length === 0) {
          result.valid = true;
          result.fixed = true;
          result.fixedContent = fixedContent;

          // Apply the fixed content
          await this.xmlParser.setRawXmlInPart('word/styles.xml', fixedContent);

          log.info('Successfully fixed all styles.xml issues');
        }
      }

      // Step 3: Validate using DocXMLater's style management
      await this.validateStyleDefinitions(result);

    } catch (error: any) {
      log.error('Failed to validate styles:', error.message);
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'VALIDATION_ERROR',
        description: `Failed to validate styles: ${error.message}`
      });
    }

    return result;
  }

  /**
   * Detect corruption patterns in styles.xml
   * Uses string-based detection to avoid parsing issues
   */
  private detectCorruptionPatterns(xmlContent: string, result: StyleValidationResult): void {
    // Pattern 1: Double closing brackets (>> or > >)
    if (/>>|>\s*>/.test(xmlContent)) {
      log.warn('Detected double closing brackets');
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'DOUBLE_CLOSING_BRACKETS',
        description: 'Found >> or > > indicating malformed XML structure'
      });
    }

    // Pattern 2: Schema URLs with corruption markers
    if (/schemas\.openxmlformats\.org\/[^"]*"[^>]*>[^<\s]/.test(xmlContent)) {
      log.warn('Detected potential schema URL corruption');
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'SCHEMA_URL_CORRUPTION',
        description: 'Found malformed schema URL declaration'
      });
    }

    // Pattern 3: Malformed xmlns attributes
    if (/xmlns:[a-z]+="[^"]*"[^>]*>>/.test(xmlContent)) {
      log.warn('Detected malformed xmlns attribute');
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'MALFORMED_XMLNS',
        description: 'Found xmlns attribute with >> instead of single >'
      });
    }

    // Pattern 4: Check root element integrity
    const rootMatch = xmlContent.match(/<w:styles[^>]*>/);
    if (!rootMatch) {
      log.error('Missing or malformed w:styles root element');
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'MISSING_ROOT_ELEMENT',
        description: 'w:styles root element is missing or malformed'
      });
    } else if (/>>|>\s*>/.test(rootMatch[0])) {
      log.error('Root element has double closing bracket');
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'ROOT_ELEMENT_CORRUPTION',
        description: 'w:styles root element is corrupted with >> pattern',
        context: rootMatch[0]
      });
    }

    // Pattern 5: Missing XML declaration
    if (!xmlContent.startsWith('<?xml')) {
      result.issues.push({
        severity: 'warning',
        pattern: 'MISSING_XML_DECLARATION',
        description: 'styles.xml missing XML declaration'
      });
    }

    // Pattern 6: Invalid UTF-8 encoding declaration
    if (xmlContent.includes('encoding="ASCII"') || xmlContent.includes("encoding='ASCII'")) {
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'INVALID_ENCODING',
        description: 'Invalid ASCII encoding - Word requires UTF-8'
      });
    }
  }

  /**
   * Get list of string-based fixes to apply
   * Each fix is idempotent (safe to apply multiple times)
   */
  private getApplicableFixes(): Array<{ name: string; apply: (content: string) => string }> {
    return [
      {
        name: 'Fix XML encoding to UTF-8',
        apply: (content: string) => {
          // Replace ASCII with UTF-8 in XML declaration
          return content
            .replace(/encoding="ASCII"/gi, 'encoding="UTF-8"')
            .replace(/encoding='ASCII'/gi, 'encoding="UTF-8"');
        }
      },
      {
        name: 'Remove double closing brackets',
        apply: (content: string) => {
          // Replace >> with > globally
          return content.replace(/>>/g, '>');
        }
      },
      {
        name: 'Fix namespace declaration double brackets',
        apply: (content: string) => {
          // Fix pattern: xmlns:x="...">>" → xmlns:x="...">"
          return content.replace(/xmlns(?::[a-z]+)?="([^"]*)">>/g, 'xmlns:$1="$1">');
        }
      },
      {
        name: 'Remove extra spaces in closing tags',
        apply: (content: string) => {
          // Remove pattern: > > → >
          return content.replace(/>\s+>/g, '>');
        }
      },
      {
        name: 'Ensure XML declaration',
        apply: (content: string) => {
          return XmlHelper.ensureXmlDeclaration(content);
        }
      },
      {
        name: 'Fix truncated schema URLs',
        apply: (content: string) => {
          // Fix incomplete schema URLs
          return content.replace(
            /("http:\/\/schemas\.openxmlformats\.org\/[^"]*")([^>\s])/g,
            '$1>'
          );
        }
      }
    ];
  }

  /**
   * Validate style definitions using DocXMLater's API
   *
   * REQUIRED: DocXMLater should expose style validation
   */
  private async validateStyleDefinitions(result: StyleValidationResult): Promise<void> {
    try {
      // PROPOSED DOCXMLATER API:
      // const styles = this.doc.getStyles();
      // for (const style of styles) {
      //   if (!style.isValid()) {
      //     result.issues.push({
      //       severity: 'warning',
      //       pattern: 'INVALID_STYLE',
      //       description: `Invalid style: ${style.getId()}`
      //     });
      //   }
      // }

      // For now, use basic validation
      // NOTE: DocXMLater doesn't yet expose getStyles() - this is a placeholder
      const styles: any[] = [];

      if (styles.length === 0) {
        log.debug('No styles found via DocXMLater API');
      } else {
        log.debug(`Found ${styles.length} styles via DocXMLater API`);

        // Validate each style
        for (const style of styles) {
          // Basic validation - check for required properties
          // DocXMLater should provide proper validation
          if (typeof style === 'object' && style) {
            // Check for style ID
            const styleId = (style as any).styleId || (style as any).id;
            if (!styleId) {
              result.issues.push({
                severity: 'warning',
                pattern: 'MISSING_STYLE_ID',
                description: 'Style definition missing ID'
              });
            }
          }
        }
      }
    } catch (error: any) {
      log.warn('Could not validate styles through DocXMLater API:', error.message);
    }
  }

  /**
   * Get a detailed report of validation results
   */
  static getDetailedReport(result: StyleValidationResult): string {
    let report = '=== STYLES VALIDATION REPORT (DocXMLater) ===\n\n';
    report += `Overall Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}\n`;
    report += `Issues Found: ${result.issues.length}\n`;
    report += `Fixes Applied: ${result.fixes.length}\n\n`;

    if (result.issues.length > 0) {
      report += 'ISSUES:\n';
      result.issues.forEach((issue, idx) => {
        report += `  ${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.pattern}\n`;
        report += `     Description: ${issue.description}\n`;
        if (issue.context) {
          report += `     Context: ${issue.context.substring(0, 100)}...\n`;
        }
      });
    }

    if (result.fixes.length > 0) {
      report += '\nFIXES APPLIED:\n';
      result.fixes.forEach((fix, idx) => {
        report += `  ${idx + 1}. ${fix}\n`;
      });
    }

    return report;
  }

  /**
   * Quick validation check
   */
  async isHealthy(): Promise<boolean> {
    const result = await this.validateAndFix();
    return result.valid && result.issues.length === 0;
  }

  /**
   * Create a new style using DocXMLater
   *
   * This demonstrates using DocXMLater's native style creation
   */
  async createStyle(
    styleId: string,
    name: string,
    basedOn: string = 'Normal',
    properties: any = {}
  ): Promise<boolean> {
    try {
      const style = Style.create({
        styleId,
        name,
        type: 'paragraph',
        basedOn,
        runFormatting: properties.runFormatting || {},
        paragraphFormatting: properties.paragraphFormatting || {}
      });

      this.doc.addStyle(style);
      return true;
    } catch (error: any) {
      log.error('Failed to create style:', error.message);
      return false;
    }
  }

  /**
   * Remove corrupt styles
   *
   * REQUIRED: DocXMLater needs removeStyle() method
   */
  async removeCorruptStyles(): Promise<number> {
    let removedCount = 0;

    try {
      // PROPOSED DOCXMLATER API:
      // const styles = this.doc.getStyles();
      // for (const style of styles) {
      //   if (this.isCorrupt(style)) {
      //     this.doc.removeStyle(style.getId());
      //     removedCount++;
      //   }
      // }

      log.warn('removeStyle not yet implemented in DocXMLater');
      return removedCount;
    } catch (error: any) {
      log.error('Failed to remove corrupt styles:', error.message);
      return removedCount;
    }
  }
}

/**
 * DOCXMLATER FRAMEWORK REQUIREMENTS SUMMARY:
 *
 * For complete styles validation, DocXMLater needs:
 *
 * 1. document.getStyles(): Style[]
 *    - Get all style definitions
 *
 * 2. style.isValid(): boolean
 *    - Validate individual style definition
 *
 * 3. document.removeStyle(styleId: string): void
 *    - Remove a style definition
 *
 * 4. document.updateStyle(styleId: string, properties: any): void
 *    - Update an existing style
 *
 * 5. document.getStylesXml(): string
 *    - Get raw styles.xml content
 *
 * 6. document.setStylesXml(xml: string): void
 *    - Set raw styles.xml content
 *
 * 7. StylesManager.validate(xml: string): ValidationResult
 *    - Validate styles XML structure
 *
 * These additions would provide complete style validation capabilities.
 */

export default DocXMLaterStylesValidator;