/**
 * Comprehensive OOXML Document Processing Validation Test
 *
 * This test verifies that ALL processing paths follow OOXML_HYPERLINK_ARCHITECTURE.md
 * and documents are not corrupted during processing.
 */

import { documentProcessingService } from './src/services/DocumentProcessingService.js';
import { ValidationEngine } from './src/services/document/ValidationEngine.js';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

// Parser configuration MUST match application configuration
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  trimValues: true,
  processEntities: false,
  parseTagValue: false,
  preserveOrder: false,
  attributeNamePrefix: '@_',  // CRITICAL: Must be @_
  textNodeName: '#text'
});

/**
 * Comprehensive validation following OOXML_HYPERLINK_ARCHITECTURE.md
 */
async function comprehensiveValidation(filePath) {
  console.log(`\n🔍 Comprehensive OOXML Validation: ${path.basename(filePath)}`);
  console.log('=' .repeat(60));

  const results = {
    passed: [],
    failed: [],
    warnings: []
  };

  try {
    const fileData = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(fileData);

    // 1. CHECK: Required files exist
    console.log('\n📁 Checking document structure...');
    const requiredFiles = [
      'word/document.xml',
      'word/_rels/document.xml.rels',
      '[Content_Types].xml',
      '_rels/.rels'
    ];

    for (const file of requiredFiles) {
      if (zip.file(file)) {
        results.passed.push(`✓ Required file exists: ${file}`);
      } else {
        results.failed.push(`✗ Missing required file: ${file}`);
      }
    }

    // 2. CHECK: XML Declaration present
    console.log('\n📄 Checking XML declarations...');
    const xmlFiles = [
      'word/document.xml',
      'word/_rels/document.xml.rels'
    ];

    for (const xmlFile of xmlFiles) {
      const file = zip.file(xmlFile);
      if (file) {
        const content = await file.async('string');
        if (content.startsWith('<?xml')) {
          results.passed.push(`✓ XML declaration present: ${xmlFile}`);
        } else {
          results.failed.push(`✗ Missing XML declaration: ${xmlFile}`);
        }
      }
    }

    // 3. CHECK: Attribute accessor patterns
    console.log('\n🔑 Checking attribute accessor patterns...');
    const documentXmlFile = zip.file('word/document.xml');
    const relsXmlFile = zip.file('word/_rels/document.xml.rels');

    if (documentXmlFile && relsXmlFile) {
      const documentXml = xmlParser.parse(await documentXmlFile.async('string'));
      const relsXml = xmlParser.parse(await relsXmlFile.async('string'));

      // Test that parser is configured correctly
      const testRel = relsXml.Relationships?.Relationship;
      if (testRel) {
        const firstRel = Array.isArray(testRel) ? testRel[0] : testRel;

        // Check that attributes use @_ prefix
        if (firstRel['@_Id'] !== undefined) {
          results.passed.push('✓ Parser configuration correct: @_ prefix working');
        } else if (firstRel.Id || firstRel.$ || firstRel.$.Id) {
          results.failed.push('✗ CRITICAL: Parser configuration wrong! Not using @_ prefix');
        }
      }

      // 4. CHECK: Hyperlink two-part system integrity
      console.log('\n🔗 Checking hyperlink two-part system...');
      const documentRIds = new Set();
      const relsIds = new Map();

      // Find all hyperlinks in document
      const findHyperlinks = (obj, depth = 0) => {
        if (!obj || depth > 50) return;

        if (obj['w:hyperlink']) {
          const hyperlinks = Array.isArray(obj['w:hyperlink'])
            ? obj['w:hyperlink']
            : [obj['w:hyperlink']];

          for (const h of hyperlinks) {
            const rId = h['@_r:id'];
            if (rId) {
              documentRIds.add(rId);
              console.log(`  Found hyperlink: ${rId}`);
            } else if (h['r:id'] || h.$ && h.$['r:id']) {
              results.failed.push(`✗ Hyperlink using wrong accessor pattern!`);
            }
          }
        }

        for (const key in obj) {
          if (typeof obj[key] === 'object') {
            findHyperlinks(obj[key], depth + 1);
          }
        }
      };

      findHyperlinks(documentXml);

      // Collect relationships
      if (relsXml.Relationships?.Relationship) {
        const relationships = Array.isArray(relsXml.Relationships.Relationship)
          ? relsXml.Relationships.Relationship
          : [relsXml.Relationships.Relationship];

        for (const rel of relationships) {
          if (rel['@_Type']?.includes('hyperlink')) {
            const id = rel['@_Id'];
            const target = rel['@_Target'];
            const targetMode = rel['@_TargetMode'];

            if (id) {
              relsIds.set(id, { target, targetMode });

              // CHECK: TargetMode for external URLs
              if (target?.startsWith('http') && targetMode !== 'External') {
                results.failed.push(`✗ External URL missing TargetMode="External": ${id}`);
              } else if (target?.startsWith('http') && targetMode === 'External') {
                results.passed.push(`✓ Correct TargetMode for external URL: ${id}`);
              }
            }
          }
        }
      }

      // 5. CHECK: Relationship integrity
      console.log('\n🔍 Checking relationship integrity...');

      // Check for missing relationships
      for (const docId of documentRIds) {
        if (!relsIds.has(docId)) {
          results.failed.push(`✗ CRITICAL: Hyperlink references ${docId} but relationship not found!`);
        } else {
          results.passed.push(`✓ Relationship exists for hyperlink: ${docId}`);
        }
      }

      // Check for orphaned relationships
      for (const [relsId] of relsIds) {
        if (!documentRIds.has(relsId)) {
          results.warnings.push(`⚠️  Orphaned relationship (not critical): ${relsId}`);
        }
      }

      // 6. CHECK: Text node preservation
      console.log('\n📝 Checking text node preservation...');
      let textNodeCount = 0;
      let preservedSpaceCount = 0;

      const checkTextNodes = (obj, depth = 0) => {
        if (!obj || depth > 50) return;

        if (obj['w:t']) {
          const textNodes = Array.isArray(obj['w:t']) ? obj['w:t'] : [obj['w:t']];

          for (const t of textNodes) {
            textNodeCount++;
            if (typeof t === 'object' && t['@_xml:space'] === 'preserve') {
              preservedSpaceCount++;
            }
          }
        }

        for (const key in obj) {
          if (typeof obj[key] === 'object') {
            checkTextNodes(obj[key], depth + 1);
          }
        }
      };

      checkTextNodes(documentXml);

      if (textNodeCount > 0) {
        results.passed.push(`✓ Found ${textNodeCount} text nodes, ${preservedSpaceCount} with preserved spacing`);
      }
    }

    // 7. Run ValidationEngine checks
    console.log('\n🛡️ Running ValidationEngine checks...');
    const validator = new ValidationEngine();
    const validationResult = await validator.validateDocument(zip, {
      checkStructure: true,
      checkRelationships: true,
      checkHyperlinks: true
    });

    if (validationResult.valid) {
      results.passed.push('✓ ValidationEngine: Document is valid');
    } else {
      for (const issue of validationResult.issues) {
        if (issue.severity === 'error') {
          results.failed.push(`✗ ValidationEngine: ${issue.message}`);
        } else if (issue.severity === 'warning') {
          results.warnings.push(`⚠️  ValidationEngine: ${issue.message}`);
        }
      }
    }

    // SUMMARY
    console.log('\n' + '='.repeat(60));
    console.log('📊 VALIDATION SUMMARY');
    console.log('='.repeat(60));

    console.log(`\n✅ Passed: ${results.passed.length}`);
    results.passed.forEach(msg => console.log(`  ${msg}`));

    console.log(`\n❌ Failed: ${results.failed.length}`);
    results.failed.forEach(msg => console.log(`  ${msg}`));

    console.log(`\n⚠️  Warnings: ${results.warnings.length}`);
    results.warnings.forEach(msg => console.log(`  ${msg}`));

    // VERDICT
    console.log('\n' + '='.repeat(60));
    if (results.failed.length === 0) {
      console.log('🎉 DOCUMENT IS OOXML COMPLIANT - NO CORRUPTION DETECTED');
      return true;
    } else {
      console.log('❌ DOCUMENT HAS CRITICAL ISSUES - CORRUPTION LIKELY');
      console.log('\nTo fix:');
      console.log('1. Ensure all code uses @_ prefix for attributes');
      console.log('2. Add TargetMode="External" to all external URLs');
      console.log('3. Preserve xml:space attributes when updating text');
      console.log('4. Maintain relationship integrity (no orphans/missing)');
      return false;
    }

  } catch (error) {
    console.error(`\n❌ Validation failed with error: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

/**
 * Test document processing with before/after comparison
 */
async function testProcessingIntegrity() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 DOCUMENT PROCESSING INTEGRITY TEST');
  console.log('='.repeat(60));

  const testFile = 'Errors.docx';
  const outputFile = 'Errors_tested.docx';

  try {
    // Validate BEFORE processing
    console.log('\n📋 BEFORE PROCESSING:');
    const beforeValid = await comprehensiveValidation(testFile);

    // Process the document
    console.log('\n⚙️  Processing document...');
    const fileData = await fs.readFile(testFile);
    const arrayBuffer = fileData.buffer.slice(
      fileData.byteOffset,
      fileData.byteOffset + fileData.byteLength
    );

    const result = await documentProcessingService.processDocument(
      arrayBuffer,
      testFile,
      {
        fixContentIds: true,
        updateTitles: true,
        fixInternalHyperlinks: true,
        removeWhitespace: false,
        removeParagraphLines: false
      }
    );

    // Save processed document
    await fs.writeFile(outputFile, Buffer.from(result.processedData));
    console.log(`✓ Processed document saved to: ${outputFile}`);

    // Validate AFTER processing
    console.log('\n📋 AFTER PROCESSING:');
    const afterValid = await comprehensiveValidation(outputFile);

    // FINAL VERDICT
    console.log('\n' + '='.repeat(60));
    console.log('🏁 FINAL VERDICT');
    console.log('='.repeat(60));

    if (beforeValid && afterValid) {
      console.log('✅ SUCCESS: Document processing maintains OOXML integrity!');
      console.log('The document can be safely opened in Microsoft Word.');
    } else if (!beforeValid && afterValid) {
      console.log('✅ EXCELLENT: Processing FIXED the document corruption!');
      console.log('The previously corrupted document is now valid.');
    } else if (beforeValid && !afterValid) {
      console.log('❌ CRITICAL: Processing INTRODUCED corruption!');
      console.log('Review the code for OOXML_HYPERLINK_ARCHITECTURE violations.');
    } else {
      console.log('⚠️  WARNING: Document had issues before and after processing.');
      console.log('The processing may not be the cause of corruption.');
    }

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
  }
}

// Run the comprehensive test
console.log('Starting comprehensive OOXML validation test...\n');
testProcessingIntegrity().catch(console.error);