/**
 * Direct test for DocXMLaterProcessor (no Electron dependencies)
 * Tests styles, tables, indentation, and shading
 *
 * Run with: npx tsx test-docxmlater-direct.ts
 */

import { DocXMLaterProcessor } from './src/services/document/DocXMLaterProcessor';
import { Document } from 'docxmlater';
import { promises as fs } from 'fs';
import * as path from 'path';

async function main() {
  console.log('🧪 Testing DocXMLater Direct Integration...\n');

  const processor = new DocXMLaterProcessor();
  const outputDir = path.join(__dirname, 'test-output');

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // TEST 1: Styles
  console.log('📝 Test 1: Creating document with custom style...');
  try {
    const docResult = await processor.createDocumentWithStyle(
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
      }
    );

    if (docResult.success && docResult.data) {
      const doc = docResult.data;

      // Add paragraphs
      await processor.createParagraph(doc, 'This is a Custom Heading', {
        alignment: 'center',
      });

      doc.getParagraphs()[0].setStyle('CustomHeading');

      await processor.createParagraph(doc, 'This is normal text');

      // Save
      const buffer = await processor.toBuffer(doc);
      if (buffer.success && buffer.data) {
        await fs.writeFile(path.join(outputDir, 'test-styles.docx'), buffer.data);
        console.log('✅ Styles test PASSED - File: test-output/test-styles.docx\n');
      }
    } else {
      console.log(`❌ Styles test FAILED: ${docResult.error}\n`);
    }
  } catch (error: any) {
    console.log(`❌ Styles test ERROR: ${error.message}\n`);
  }

  // TEST 2: Tables with Borders and Shading
  console.log('📊 Test 2: Creating document with table (borders + shading)...');
  try {
    const doc = processor.createNewDocument();

    const tableResult = await processor.createTable(doc, 3, 3, {
      borders: true,
      borderColor: '000000',
      borderSize: 8,
      headerShading: 'D3D3D3', // Light gray
    });

    if (tableResult.success && tableResult.data) {
      const table = tableResult.data;

      // Populate cells
      const cellData = [
        ['Header 1', 'Header 2', 'Header 3'],
        ['Row 1, Col 1', 'Row 1, Col 2', 'Row 1, Col 3'],
        ['Row 2, Col 1', 'Row 2, Col 2', 'Row 2, Col 3'],
      ];

      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const cell = table.getCell(row, col);
          if (cell) {
            await processor.addCellContent(cell, cellData[row][col], {
              bold: row === 0, // Bold headers
            });
          }
        }
      }

      // Save
      const buffer = await processor.toBuffer(doc);
      if (buffer.success && buffer.data) {
        await fs.writeFile(path.join(outputDir, 'test-table.docx'), buffer.data);
        console.log('✅ Table test PASSED - File: test-output/test-table.docx\n');
      }
    } else {
      console.log(`❌ Table test FAILED: ${tableResult.error}\n`);
    }
  } catch (error: any) {
    console.log(`❌ Table test ERROR: ${error.message}\n`);
  }

  // TEST 3: Indentation
  console.log('📐 Test 3: Creating document with indentation...');
  try {
    const doc = processor.createNewDocument();

    const paragraphs = [
      {
        text: 'No indentation',
        indentLeft: 0,
      },
      {
        text: 'Left indent 0.5 inches',
        indentLeft: processor.inchesToTwips(0.5),
      },
      {
        text: 'Left indent 1 inch',
        indentLeft: processor.inchesToTwips(1),
      },
      {
        text: 'Left and right indent 0.5 inches',
        indentLeft: processor.inchesToTwips(0.5),
        indentRight: processor.inchesToTwips(0.5),
      },
      {
        text: 'First line indent 0.5 inches',
        indentFirstLine: processor.inchesToTwips(0.5),
      },
    ];

    for (const paraData of paragraphs) {
      await processor.createParagraph(doc, paraData.text, paraData);
    }

    // Save
    const buffer = await processor.toBuffer(doc);
    if (buffer.success && buffer.data) {
      await fs.writeFile(path.join(outputDir, 'test-indentation.docx'), buffer.data);
      console.log('✅ Indentation test PASSED - File: test-output/test-indentation.docx\n');
    }
  } catch (error: any) {
    console.log(`❌ Indentation test ERROR: ${error.message}\n`);
  }

  // TEST 4: Combined - Styles + Table + Indentation in one document
  console.log('🎨 Test 4: Creating complex document with all features...');
  try {
    // Create document with style
    const docResult = await processor.createDocumentWithStyle(
      'Heading1',
      'My Heading 1',
      {
        fontFamily: 'Calibri',
        fontSize: 18,
        bold: true,
        color: '#1F4E78',
        spaceBefore: processor.pointsToTwips(12),
        spaceAfter: processor.pointsToTwips(6),
      }
    );

    if (docResult.success && docResult.data) {
      const doc = docResult.data;

      // Add title
      const title = await processor.createParagraph(doc, 'Document Processing Test Report', {
        alignment: 'center',
        spaceBefore: processor.pointsToTwips(24),
        spaceAfter: processor.pointsToTwips(12),
      });
      if (title.success && title.data) {
        title.data.setStyle('Heading1');
      }

      // Add subtitle
      await processor.createParagraph(doc, 'Testing DocXMLater Integration', {
        alignment: 'center',
        spaceAfter: processor.pointsToTwips(18),
      });

      // Add paragraph with indentation
      await processor.createParagraph(
        doc,
        'This document demonstrates that styles, tables, indentation, and shading all work correctly with the new DocXMLater integration.',
        {
          indentLeft: processor.inchesToTwips(0.5),
          indentRight: processor.inchesToTwips(0.5),
          alignment: 'justify',
          spaceAfter: processor.pointsToTwips(12),
        }
      );

      // Add table
      const tableResult = await processor.createTable(doc, 4, 3, {
        borders: true,
        borderColor: '000000',
        borderSize: 6,
        headerShading: '4472C4', // Blue
      });

      if (tableResult.success && tableResult.data) {
        const table = tableResult.data;

        // Populate table
        const data = [
          ['Feature', 'Status', 'Notes'],
          ['Styles', '✓ Working', 'Custom styles apply correctly'],
          ['Tables', '✓ Working', 'Borders and shading work'],
          ['Indentation', '✓ Working', 'All indent types supported'],
        ];

        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < 3; col++) {
            const cell = table.getCell(row, col);
            if (cell) {
              await processor.addCellContent(cell, data[row][col], {
                bold: row === 0,
                color: row === 0 ? 'FFFFFF' : undefined, // White text for headers
              });
            }
          }
        }
      }

      // Save
      const buffer = await processor.toBuffer(doc);
      if (buffer.success && buffer.data) {
        await fs.writeFile(path.join(outputDir, 'test-combined.docx'), buffer.data);
        console.log('✅ Combined test PASSED - File: test-output/test-combined.docx\n');
      }
    }
  } catch (error: any) {
    console.log(`❌ Combined test ERROR: ${error.message}\n`);
  }

  console.log('🎉 All tests completed!');
  console.log('📁 Check the test-output/ directory for generated DOCX files.');
  console.log('\n💡 Open the files in Microsoft Word to verify:');
  console.log('   - Styles are applied correctly');
  console.log('   - Tables have borders and header shading');
  console.log('   - Indentation works as expected');
}

main().catch(console.error);
