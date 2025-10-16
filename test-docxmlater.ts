/**
 * Test script for DocXMLater integration
 * Tests styles, tables, indentation, and shading
 *
 * Run with: npx ts-node test-docxmlater.ts
 */

import { UnifiedDocumentProcessor } from './src/services/document/UnifiedDocumentProcessor';
import { promises as fs } from 'fs';
import * as path from 'path';

async function main() {
  console.log('🧪 Testing DocXMLater Integration...\n');

  const processor = new UnifiedDocumentProcessor();
  const outputDir = path.join(__dirname, 'test-output');

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // TEST 1: Styles
  console.log('📝 Test 1: Creating document with custom style...');
  try {
    const result = await processor.createDocumentWithWorkingStyle(
      'CustomHeading',
      'Custom Heading Style',
      {
        fontFamily: 'Arial',
        fontSize: 16,
        bold: true,
        color: '#2E74B5',
        alignment: 'center',
        spaceBefore: processor.pointsToTwips(12),
        spaceAfter: processor.pointsToTwips(6),
      },
      [
        { text: 'This is a Custom Heading', useStyle: true },
        { text: 'This is normal text', useStyle: false },
      ]
    );

    if (result.success && result.data) {
      await fs.writeFile(path.join(outputDir, 'test-styles.docx'), result.data);
      console.log('✅ Styles test PASSED - File: test-output/test-styles.docx\n');
    } else {
      console.log(`❌ Styles test FAILED: ${result.error}\n`);
    }
  } catch (error: any) {
    console.log(`❌ Styles test ERROR: ${error.message}\n`);
  }

  // TEST 2: Tables with Borders and Shading
  console.log('📊 Test 2: Creating document with table (borders + shading)...');
  try {
    const result = await processor.createDocumentWithWorkingTable(
      3,
      3,
      {
        borders: true,
        borderColor: '000000',
        borderSize: 8,
        headerShading: 'D3D3D3', // Light gray
        cellData: [
          ['Header 1', 'Header 2', 'Header 3'],
          ['Row 1, Col 1', 'Row 1, Col 2', 'Row 1, Col 3'],
          ['Row 2, Col 1', 'Row 2, Col 2', 'Row 2, Col 3'],
        ],
      }
    );

    if (result.success && result.data) {
      await fs.writeFile(path.join(outputDir, 'test-table.docx'), result.data);
      console.log('✅ Table test PASSED - File: test-output/test-table.docx\n');
    } else {
      console.log(`❌ Table test FAILED: ${result.error}\n`);
    }
  } catch (error: any) {
    console.log(`❌ Table test ERROR: ${error.message}\n`);
  }

  // TEST 3: Indentation
  console.log('📐 Test 3: Creating document with indentation...');
  try {
    const result = await processor.createDocumentWithWorkingIndentation([
      {
        text: 'No indentation',
        alignment: 'left',
      },
      {
        text: 'Left indent 0.5 inches',
        indentLeft: processor.inchesToTwips(0.5),
        alignment: 'left',
      },
      {
        text: 'Left indent 1 inch',
        indentLeft: processor.inchesToTwips(1),
        alignment: 'left',
      },
      {
        text: 'Left indent 0.5", Right indent 0.5"',
        indentLeft: processor.inchesToTwips(0.5),
        indentRight: processor.inchesToTwips(0.5),
        alignment: 'justify',
      },
      {
        text: 'First line indent 0.5 inches',
        indentFirstLine: processor.inchesToTwips(0.5),
        alignment: 'left',
      },
    ]);

    if (result.success && result.data) {
      await fs.writeFile(path.join(outputDir, 'test-indentation.docx'), result.data);
      console.log('✅ Indentation test PASSED - File: test-output/test-indentation.docx\n');
    } else {
      console.log(`❌ Indentation test FAILED: ${result.error}\n`);
    }
  } catch (error: any) {
    console.log(`❌ Indentation test ERROR: ${error.message}\n`);
  }

  console.log('🎉 All tests completed!');
  console.log('📁 Check the test-output/ directory for generated DOCX files.');
}

main().catch(console.error);
