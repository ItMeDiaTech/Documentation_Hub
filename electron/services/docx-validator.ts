/**
 * DOCX Validator - Diagnostic Tool
 *
 * Command-line utility to validate and report on DOCX file corruption.
 * Can be run standalone to diagnose issues before processing.
 *
 * Usage:
 *   node docx-validator.ts <path-to-file.docx>
 */

import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { StylesXmlValidator } from '../../src/services/document/StylesXmlValidator';

interface DocxValidationReport {
  file: string;
  size: number;
  valid: boolean;
  timestamp: string;
  issues: {
    documentXml?: string;
    relsXml?: string;
    stylesXml?: {
      valid: boolean;
      issues: number;
      fixes: string[];
      details: string;
    };
  };
  summary: string;
}

export async function validateDocx(filePath: string): Promise<DocxValidationReport> {
  const report: DocxValidationReport = {
    file: filePath,
    size: 0,
    valid: true,
    timestamp: new Date().toISOString(),
    issues: {},
    summary: ''
  };

  try {
    // Check file exists
    if (!fs.existsSync(filePath)) {
      report.valid = false;
      report.summary = `File not found: ${filePath}`;
      return report;
    }

    // Get file size
    const stats = fs.statSync(filePath);
    report.size = stats.size;

    // Load DOCX as ZIP
    const buffer = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buffer);

    // Validate document.xml
    const documentXmlFile = zip.file('word/document.xml');
    if (!documentXmlFile) {
      report.valid = false;
      report.issues.documentXml = 'Missing document.xml';
    } else {
      try {
        const content = await documentXmlFile.async('string');
        if (!content.trim()) {
          report.valid = false;
          report.issues.documentXml = 'document.xml is empty';
        } else if (!content.startsWith('<?xml')) {
          report.issues.documentXml = 'Missing XML declaration';
        }
      } catch (error: any) {
        report.valid = false;
        report.issues.documentXml = `Cannot read document.xml: ${error.message}`;
      }
    }

    // Validate document.xml.rels
    const relsXmlFile = zip.file('word/_rels/document.xml.rels');
    if (!relsXmlFile) {
      report.valid = false;
      report.issues.relsXml = 'Missing document.xml.rels';
    } else {
      try {
        const content = await relsXmlFile.async('string');
        if (!content.trim()) {
          report.valid = false;
          report.issues.relsXml = 'document.xml.rels is empty';
        }
      } catch (error: any) {
        report.valid = false;
        report.issues.relsXml = `Cannot read document.xml.rels: ${error.message}`;
      }
    }

    // Validate styles.xml (if present)
    const stylesXmlFile = zip.file('word/styles.xml');
    if (stylesXmlFile) {
      try {
        const stylesContent = await stylesXmlFile.async('string');
        const validationResult = StylesXmlValidator.validateAndFix(stylesContent);

        report.issues.stylesXml = {
          valid: validationResult.valid,
          issues: validationResult.issues.length,
          fixes: validationResult.fixes,
          details: StylesXmlValidator.getDetailedReport(stylesContent)
        };

        if (!validationResult.valid) {
          report.valid = false;
        }
      } catch (error: any) {
        report.valid = false;
        report.issues.stylesXml = {
          valid: false,
          issues: 1,
          fixes: [],
          details: `Cannot validate styles.xml: ${error.message}`
        };
      }
    }

    // Generate summary
    const issues = Object.values(report.issues).filter(v => v !== undefined);
    report.summary = report.valid
      ? `✅ VALID - ${issues.length} optional issues found`
      : `❌ INVALID - ${issues.length} critical issues found`;

    return report;

  } catch (error: any) {
    report.valid = false;
    report.summary = `Error validating DOCX: ${error.message}`;
    return report;
  }
}

/**
 * Format validation report for console output
 */
export function formatReport(report: DocxValidationReport): string {
  let output = '\n╔════════════════════════════════════════════════════════════════╗\n';
  output += '║            DOCX VALIDATION REPORT                              ║\n';
  output += '╚════════════════════════════════════════════════════════════════╝\n\n';

  output += `📄 File: ${report.file}\n`;
  output += `📊 Size: ${(report.size / 1024).toFixed(2)} KB\n`;
  output += `⏰ Timestamp: ${report.timestamp}\n`;
  output += `📋 Status: ${report.valid ? '✅ VALID' : '❌ INVALID'}\n\n`;

  if (report.issues.documentXml) {
    output += `⚠️  document.xml: ${report.issues.documentXml}\n`;
  }
  if (report.issues.relsXml) {
    output += `⚠️  document.xml.rels: ${report.issues.relsXml}\n`;
  }

  if (report.issues.stylesXml) {
    const stylesIssue = report.issues.stylesXml;
    if (stylesIssue.valid === false) {
      output += `⚠️  styles.xml: Found ${stylesIssue.issues} issue(s)\n`;
      if (stylesIssue.fixes && stylesIssue.fixes.length > 0) {
        output += `    Possible fixes: ${stylesIssue.fixes.join(', ')}\n`;
      }
      output += '\n' + stylesIssue.details;
    }
  }

  output += `\n${report.summary}\n`;

  return output;
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node docx-validator.ts <path-to-file.docx>');
    console.log('\nExample:');
    console.log('  node docx-validator.ts Err.docx');
    console.log('  node docx-validator.ts /path/to/document.docx');
    process.exit(1);
  }

  const filePath = args[0];
  console.log(`🔍 Validating: ${filePath}\n`);

  const report = await validateDocx(filePath);
  const formatted = formatReport(report);
  console.log(formatted);

  process.exit(report.valid ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default { validateDocx, formatReport };
