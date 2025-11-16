/**
 * Diagnostic Script: Check Table Content in Test_Code.docx
 *
 * Check if Header 2 paragraphs are inside tables
 */

import { Document } from 'docxmlater';
import * as path from 'path';

async function diagnoseTables() {
  console.log('='.repeat(60));
  console.log('DIAGNOSTIC: Table Content in Test_Code.docx');
  console.log('='.repeat(60) + '\n');

  const inputFile = path.join(process.cwd(), 'Test_Code.docx');

  try {
    console.log('[LOADING] Document...');
    const doc = await Document.load(inputFile, { strictParsing: false });
    console.log('[OK] Document loaded\n');

    const tables = doc.getTables();
    console.log(`[INFO] Total tables: ${tables.length}\n`);

    if (tables.length === 0) {
      console.log('[WARNING] No tables found in document!');
      console.log('Header 2 paragraphs might be in the main document body.\n');
      return;
    }

    tables.forEach((table, tableIndex) => {
      console.log(`\nTable ${tableIndex + 1}:`);
      console.log('-'.repeat(60));

      const rowCount = table.getRows().length;
      console.log(`  Rows: ${rowCount}`);

      table.getRows().forEach((row, rowIndex) => {
        const cells = row.getCells();
        console.log(`  Row ${rowIndex + 1}: ${cells.length} cells`);

        cells.forEach((cell, cellIndex) => {
          const paragraphs = cell.getParagraphs();

          paragraphs.forEach((para, paraIndex) => {
            const style = para.getStyle() || para.getFormatting().style || '(none)';
            const text = para.getText().trim();

            // Only log if it has a style or meaningful text
            if (style !== '(none)' || text.length > 0) {
              console.log(`    Cell ${cellIndex + 1}, Para ${paraIndex + 1}:`);
              console.log(`      Style: "${style}"`);
              if (text) {
                console.log(`      Text: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
              }

              // Highlight Header 2 specifically
              if (style && (style === 'Heading2' || style === 'Heading 2' || style.includes('Heading2'))) {
                console.log(`      >>> FOUND HEADER 2! <<<`);
              }
            }
          });
        });
      });
    });

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY:');
    console.log('='.repeat(60));

    let totalHeader2 = 0;
    tables.forEach((table) => {
      table.getRows().forEach((row) => {
        row.getCells().forEach((cell) => {
          cell.getParagraphs().forEach((para) => {
            const style = para.getStyle() || para.getFormatting().style;
            if (style && (style === 'Heading2' || style === 'Heading 2' || style.includes('Heading2'))) {
              totalHeader2++;
            }
          });
        });
      });
    });

    console.log(`\nTotal Header 2 paragraphs in tables: ${totalHeader2}`);

    if (totalHeader2 === 0) {
      console.log('[WARNING] No Header 2 paragraphs found in tables!');
      console.log('Check if:');
      console.log('  1. The Header 2 text is using direct formatting instead of styles');
      console.log('  2. The style name is different (not "Heading2")');
      console.log('  3. The Header 2s are in the main document body, not tables');
    }

    console.log('\n' + '='.repeat(60));
    console.log('DIAGNOSTIC COMPLETE');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('[ERROR] Failed to diagnose document:');
    if (error instanceof Error) {
      console.error(`  ${error.message}`);
      console.error(`\n${error.stack}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

diagnoseTables()
  .then(() => {
    console.log('[OK] Diagnostic completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[FAILED] Diagnostic failed:', error);
    process.exit(1);
  });
