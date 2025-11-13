/**
 * Diagnostic Script: Check Paragraph Styles in Test_Code.docx
 *
 * This script will show all paragraph styles in the document
 * to help diagnose why Header 2 detection isn't working
 */

import { Document } from 'docxmlater';
import * as path from 'path';

async function diagnoseStyles() {
  console.log('='.repeat(60));
  console.log('DIAGNOSTIC: Paragraph Styles in Test_Code.docx');
  console.log('='.repeat(60) + '\n');

  const inputFile = path.join(process.cwd(), 'Test_Code.docx');

  try {
    console.log('[LOADING] Document...');
    const doc = await Document.load(inputFile, { strictParsing: false });
    console.log('[OK] Document loaded\n');

    const paragraphs = doc.getParagraphs();
    console.log(`[INFO] Total paragraphs: ${paragraphs.length}\n`);

    console.log('Paragraph Styles Found:');
    console.log('-'.repeat(60));

    const styleCounts = new Map<string, number>();
    const styleExamples = new Map<string, string>();

    paragraphs.forEach((para, index) => {
      const style = para.getStyle() || para.getFormatting().style || '(none)';
      const text = para.getText().trim().substring(0, 50);

      // Count styles
      styleCounts.set(style, (styleCounts.get(style) || 0) + 1);

      // Save first example of each style
      if (!styleExamples.has(style) && text) {
        styleExamples.set(style, text);
      }
    });

    // Display results sorted by count
    const sortedStyles = Array.from(styleCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    sortedStyles.forEach(([style, count]) => {
      const example = styleExamples.get(style);
      console.log(`\n[${count} paragraphs] Style: "${style}"`);
      if (example) {
        console.log(`  Example text: "${example}"`);
      }
    });

    // Check specifically for Header 2 variations
    console.log('\n' + '='.repeat(60));
    console.log('HEADER 2 DETECTION CHECK:');
    console.log('='.repeat(60));

    const header2Variations = [
      'Heading2',
      'Heading 2',
      'Header2',
      'Header 2',
      'heading2',
      'heading 2'
    ];

    let foundHeader2 = false;
    header2Variations.forEach(variation => {
      const count = styleCounts.get(variation) || 0;
      if (count > 0) {
        console.log(`[FOUND] "${variation}": ${count} paragraphs`);
        foundHeader2 = true;
      }
    });

    // Check for styles containing "heading2" or "2"
    console.log('\nStyles containing "2" or "heading":');
    sortedStyles.forEach(([style, count]) => {
      const lowerStyle = style.toLowerCase();
      if (lowerStyle.includes('2') || lowerStyle.includes('heading')) {
        console.log(`  - "${style}": ${count} paragraphs`);
      }
    });

    if (!foundHeader2) {
      console.log('\n[WARNING] No exact Header 2 style variations found!');
      console.log('The Header 2 paragraphs might be using a different style name.');
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

diagnoseStyles()
  .then(() => {
    console.log('[OK] Diagnostic completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[FAILED] Diagnostic failed:', error);
    process.exit(1);
  });
