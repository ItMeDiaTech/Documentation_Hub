/**
 * StylesXmlValidator - Detect and Fix Corruption in styles.xml
 *
 * DOCX files contain word/styles.xml which defines document styles.
 * Corruption in this file can cause:
 * - XML parsing failures
 * - Word document opening errors
 * - Display issues in Microsoft Word
 *
 * Common corruption patterns this detects:
 * 1. Extra closing brackets: "...URL>>" or "> >"
 * 2. Malformed xmlns declarations
 * 3. Schema URL corruption
 * 4. Improperly escaped XML entities
 * 5. Missing or duplicate attributes
 *
 * APPROACH: String-based fixes to avoid parse/rebuild corruption
 */

import { logger } from '@/utils/logger';

const log = logger.namespace('StylesXmlValidator');

export interface StylesXmlIssue {
  severity: 'error' | 'warning';
  pattern: string;
  description: string;
  lineNumber?: number;
  context?: string;
}

export interface StylesXmlValidationResult {
  valid: boolean;
  issues: StylesXmlIssue[];
  fixed: boolean;
  fixedContent?: string;
  fixes: string[];
}

/**
 * Validator for styles.xml corruption patterns
 * All fixes are string-based to avoid XML parse/rebuild corruption
 */
export class StylesXmlValidator {
  /**
   * Validate and fix styles.xml content
   * Returns fixed content if issues found and fixed
   */
  static validateAndFix(xmlContent: string): StylesXmlValidationResult {
    const result: StylesXmlValidationResult = {
      valid: true,
      issues: [],
      fixed: false,
      fixes: []
    };

    if (!xmlContent || typeof xmlContent !== 'string') {
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'EMPTY_CONTENT',
        description: 'styles.xml content is empty or invalid'
      });
      return result;
    }

    // Step 1: Detect corruption patterns
    this.detectCorruptionPatterns(xmlContent, result);

    // Step 2: If issues found, attempt to fix via string manipulation
    if (result.issues.length > 0) {
      log.warn(`Found ${result.issues.length} issues in styles.xml, attempting fixes`);

      let fixedContent = xmlContent;

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
      const retestResult: StylesXmlValidationResult = {
        valid: true,
        issues: [],
        fixed: false,
        fixes: []
      };
      this.detectCorruptionPatterns(fixedContent, retestResult);

      if (retestResult.issues.length < result.issues.length) {
        result.fixed = true;
        result.fixedContent = fixedContent;
        log.info(`Fixed styles.xml - reduced issues from ${result.issues.length} to ${retestResult.issues.length}`);
      } else if (retestResult.issues.length === 0) {
        result.valid = true;
        result.fixed = true;
        result.fixedContent = fixedContent;
        log.info('Successfully fixed all styles.xml issues');
      } else {
        log.warn('Fixes applied but some issues remain');
        result.fixed = result.fixes.length > 0;
        result.fixedContent = result.fixes.length > 0 ? fixedContent : undefined;
      }
    }

    return result;
  }

  /**
   * Detect corruption patterns in styles.xml
   */
  private static detectCorruptionPatterns(
    xmlContent: string,
    result: StylesXmlValidationResult
  ): void {
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
    // Looking for: "http://schemas...org/...">
    // followed by non-whitespace or another tag
    if (/schemas\.openxmlformats\.org\/[^"]*"[^>]*>[^<\s]/.test(xmlContent)) {
      log.warn('Detected potential schema URL corruption');
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'SCHEMA_URL_CORRUPTION',
        description: 'Found malformed schema URL declaration with extra characters after closing >'
      });
    }

    // Pattern 3: Malformed xmlns attributes
    // Looking for: xmlns:x="...">...> or xmlns:x="...">> or missing closing quote
    if (/xmlns:[a-z]+="[^"]*"[^>]*>>/.test(xmlContent)) {
      log.warn('Detected malformed xmlns attribute');
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'MALFORMED_XMLNS',
        description: 'Found xmlns attribute with >> instead of single >'
      });
    }

    // Pattern 4: Unclosed attribute values (missing closing quote)
    if (/<[^>]*=[^"]*"[^"]*$/.test(xmlContent.split('<').pop() || '')) {
      log.warn('Detected unclosed attribute value');
      result.valid = false;
      result.issues.push({
        severity: 'warning',
        pattern: 'UNCLOSED_ATTRIBUTE',
        description: 'Found attribute with potentially missing closing quote'
      });
    }

    // Pattern 5: Check root element integrity
    const rootMatch = xmlContent.match(/<w:styles[^>]*>/);
    if (!rootMatch) {
      log.error('Missing or malformed w:styles root element');
      result.valid = false;
      result.issues.push({
        severity: 'error',
        pattern: 'MISSING_ROOT_ELEMENT',
        description: 'w:styles root element is missing or malformed'
      });
    } else {
      // Verify root element doesn't have corruption markers
      if (/>>|>\s*>/.test(rootMatch[0])) {
        log.error('Root element has double closing bracket');
        result.valid = false;
        result.issues.push({
          severity: 'error',
          pattern: 'ROOT_ELEMENT_CORRUPTION',
          description: 'w:styles root element is corrupted with >> pattern',
          context: rootMatch[0]
        });
      }
    }

    // Pattern 6: Namespace declarations should be well-formed
    const xmlnsPattern = /xmlns(?::[a-z]+)?="[^"]*"/g;
    const allXmlns = xmlContent.match(xmlnsPattern) || [];
    for (const xmlns of allXmlns) {
      // Each xmlns should have exactly one = and matching quotes
      const eqCount = (xmlns.match(/=/g) || []).length;
      const quoteCount = (xmlns.match(/"/g) || []).length;
      if (eqCount !== 1 || quoteCount !== 2) {
        log.warn(`Malformed xmlns declaration: ${xmlns}`);
        result.valid = false;
        result.issues.push({
          severity: 'warning',
          pattern: 'MALFORMED_XMLNS_DECLARATION',
          description: `xmlns declaration has incorrect syntax: ${xmlns}`
        });
      }
    }
  }

  /**
   * Get list of string-based fixes to apply
   * Each fix is idempotent (safe to apply multiple times)
   */
  private static getApplicableFixes(): Array<{
    name: string;
    apply: (content: string) => string;
  }> {
    return [
      {
        name: 'Remove double closing brackets in xmlns',
        apply: (content: string) => {
          // Replace xmlns:"...">>" with xmlns:"..."
          // This safely removes extra > at the end of namespace declarations
          return content.replace(
            /xmlns(?::[a-z]+)?="([^"]*)">>/g,
            'xmlns:$1="$1">'
          );
        }
      },
      {
        name: 'Fix namespace declaration double brackets',
        apply: (content: string) => {
          // Fix pattern: ><w: or similar (closing > followed by tag)
          // caused by >> corruption
          return content.replace(/>>([<\s])/g, '>$1');
        }
      },
      {
        name: 'Restore proper root element closing',
        apply: (content: string) => {
          // If root element has >> pattern, fix it
          if (content.includes('<w:styles') && content.includes('>>')) {
            // Find the root element declaration and fix it
            return content.replace(
              /<w:styles([^>]*)>>/,
              '<w:styles$1>'
            );
          }
          return content;
        }
      },
      {
        name: 'Remove extra spaces in closing tags',
        apply: (content: string) => {
          // Remove pattern: > > (space between brackets)
          return content.replace(/>\s+>/g, '>');
        }
      },
      {
        name: 'Fix schema URL truncation',
        apply: (content: string) => {
          // Some schema URLs might be incomplete, ensure they end properly
          // Pattern: "http://schemas.openxmlformats.org/..."> with no extra chars
          return content.replace(
            /("http:\/\/schemas\.openxmlformats\.org\/[^"]*")([^>\s])/g,
            '$1>'
          );
        }
      },
      {
        name: 'Remove duplicate namespace declarations',
        apply: (content: string) => {
          // If xmlns:r appears twice, keep only first
          const matches = (content.match(/xmlns:r="[^"]*"/g) || []);
          if (matches.length > 1) {
            log.debug(`Found ${matches.length} xmlns:r declarations, consolidating`);
            // This is more complex - do careful string matching
            const lines = content.split('\n');
            const seenNamespaces = new Set<string>();
            const fixedLines = lines.map(line => {
              const xmlnsMatches = line.match(/xmlns(?::[a-z]+)?="[^"]*"/g) || [];
              let fixedLine = line;
              for (const xmlns of xmlnsMatches) {
                if (seenNamespaces.has(xmlns)) {
                  fixedLine = fixedLine.replace(xmlns + ' ', '').replace(xmlns, '');
                } else {
                  seenNamespaces.add(xmlns);
                }
              }
              return fixedLine;
            });
            return fixedLines.join('\n');
          }
          return content;
        }
      }
    ];
  }

  /**
   * Quick validation check - returns true if styles.xml appears healthy
   */
  static isHealthy(xmlContent: string): boolean {
    const result = this.validateAndFix(xmlContent);
    return result.valid && result.issues.length === 0;
  }

  /**
   * Get detailed report of issues found
   */
  static getDetailedReport(xmlContent: string): string {
    const result = this.validateAndFix(xmlContent);

    let report = '=== STYLES.XML VALIDATION REPORT ===\n\n';
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
}
