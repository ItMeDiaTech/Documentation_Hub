/**
 * Test Script: Verify document processing doesn't corrupt DOCX files
 * This script tests that hyperlink processing maintains proper OOXML structure
 */

import { documentProcessingService } from './src/services/DocumentProcessingService.js';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

// Parser configuration matching the application
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  trimValues: true,
  processEntities: false,
  parseTagValue: false,
  preserveOrder: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text'
});

/**
 * Validate hyperlink integrity in a processed document
 */
async function validateProcessedDocument(filePath) {
  console.log(`\n📄 Validating: ${path.basename(filePath)}`);

  try {
    // Load the processed document
    const fileData = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(fileData);

    // Get document.xml and relationships
    const documentXmlFile = zip.file('word/document.xml');
    const relsXmlFile = zip.file('word/_rels/document.xml.rels');

    if (!documentXmlFile || !relsXmlFile) {
      console.error('❌ Missing required XML files');
      return false;
    }

    const documentXml = xmlParser.parse(await documentXmlFile.async('string'));
    const relsXml = xmlParser.parse(await relsXmlFile.async('string'));

    // Collect all hyperlink relationship IDs from document
    const documentRIds = new Set();
    const findHyperlinkIds = (obj) => {
      if (!obj) return;

      if (obj['w:hyperlink']) {
        const hyperlinks = Array.isArray(obj['w:hyperlink'])
          ? obj['w:hyperlink']
          : [obj['w:hyperlink']];

        for (const h of hyperlinks) {
          // Check for correct attribute accessor pattern
          const rId = h['@_r:id'];
          if (rId) {
            documentRIds.add(rId);
            console.log(`  ✓ Found hyperlink with ID: ${rId}`);
          } else if (h['r:id']) {
            console.error(`  ❌ WRONG ACCESSOR: Found hyperlink using 'r:id' instead of '@_r:id'`);
            return false;
          }
        }
      }

      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          findHyperlinkIds(obj[key]);
        }
      }
    };

    findHyperlinkIds(documentXml);

    // Collect all relationship IDs from .rels file
    const relsIds = new Map();
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

            // Check for TargetMode on external URLs
            if (target?.startsWith('http') && targetMode !== 'External') {
              console.error(`  ❌ External URL missing TargetMode="External": ${id}`);
              return false;
            }

            console.log(`  ✓ Relationship ${id}: ${target} (${targetMode || 'internal'})`);
          }
        }
      }
    }

    // Check for missing relationships (will cause corruption)
    let hasErrors = false;
    for (const docId of documentRIds) {
      if (!relsIds.has(docId)) {
        console.error(`  ❌ CRITICAL: Hyperlink references ${docId} but relationship not found!`);
        hasErrors = true;
      }
    }

    // Check for orphaned relationships (warning only)
    for (const [relsId] of relsIds) {
      if (!documentRIds.has(relsId)) {
        console.warn(`  ⚠️  Warning: Relationship ${relsId} exists but is not referenced`);
      }
    }

    if (hasErrors) {
      console.error('\n❌ Document has critical errors that will cause corruption!');
      return false;
    }

    console.log('\n✅ Document structure is valid - no corruption detected');
    return true;

  } catch (error) {
    console.error(`❌ Error validating document: ${error.message}`);
    return false;
  }
}

/**
 * Test document processing
 */
async function testDocumentProcessing() {
  console.log('========================================');
  console.log('DOCX Document Processing Validation Test');
  console.log('========================================');

  const testFile = 'c:\\Users\\DiaTech\\Pictures\\DiaTech\\Programs\\DocHub\\development\\Template_UI\\Errors.docx';
  const outputFile = 'c:\\Users\\DiaTech\\Pictures\\DiaTech\\Programs\\DocHub\\development\\Template_UI\\Errors_processed.docx';

  try {
    // Check if test file exists
    await fs.access(testFile);
    console.log(`\n📁 Test file found: ${testFile}`);
  } catch {
    console.error(`\n❌ Test file not found: ${testFile}`);
    console.log('Please ensure Errors.docx exists in the project root');
    return;
  }

  console.log('\n🔄 Processing document...');

  try {
    // Process the document
    const fileData = await fs.readFile(testFile);
    const arrayBuffer = fileData.buffer.slice(
      fileData.byteOffset,
      fileData.byteOffset + fileData.byteLength
    );

    const result = await documentProcessingService.processDocument(
      arrayBuffer,
      'Errors.docx',
      {
        fixContentIds: true,
        updateTitles: true,
        fixInternalHyperlinks: true
      },
      // No PowerAutomate URL for this test
      undefined
    );

    // Save processed document
    await fs.writeFile(outputFile, Buffer.from(result.processedData));
    console.log(`\n💾 Processed document saved to: ${outputFile}`);

    // Show processing results
    console.log('\n📊 Processing Results:');
    console.log(`  - Success: ${result.result.success}`);
    console.log(`  - Total Hyperlinks: ${result.result.totalHyperlinks}`);
    console.log(`  - Processed: ${result.result.processedHyperlinks}`);
    console.log(`  - Modified: ${result.result.modifiedHyperlinks}`);
    console.log(`  - Errors: ${result.result.errorCount}`);

    if (result.result.errorMessages.length > 0) {
      console.log('\n⚠️  Error Messages:');
      result.result.errorMessages.forEach(msg => console.log(`  - ${msg}`));
    }

    // Validate the processed document
    const isValid = await validateProcessedDocument(outputFile);

    if (isValid) {
      console.log('\n🎉 SUCCESS: Document processing completed without corruption!');
      console.log(`\nYou can now open ${path.basename(outputFile)} in Microsoft Word.`);
      console.log('The document should open without any errors or warnings.');
    } else {
      console.log('\n❌ FAILURE: Document processing resulted in corruption.');
      console.log('Please review the error messages above.');
    }

  } catch (error) {
    console.error(`\n❌ Processing failed: ${error.message}`);
    console.error(error.stack);
  }
}

// Run the test
testDocumentProcessing().catch(console.error);