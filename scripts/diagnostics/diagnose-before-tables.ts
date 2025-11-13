/**
 * Diagnostic: Check what paragraphs exist before each table
 */

import { Document, Table, Paragraph } from 'docxmlater';
import * as path from 'path';

async function diagnoseBeforeTables() {
  console.log('Diagnosing paragraphs before tables in Test_Code.docx\n');

  const inputFile = path.join(process.cwd(), 'Test_Code.docx');

  try {
    const doc = await Document.load(inputFile, { strictParsing: false });
    console.log('[OK] Document loaded\n');

    const bodyElements = doc.getBodyElements();
    console.log(`[INFO] Total body elements: ${bodyElements.length}\n`);

    // Find tables and check what comes before them
    bodyElements.forEach((element, index) => {
      if (element instanceof Table) {
        console.log(`Table at index ${index}:`);

        // Check previous element
        if (index > 0) {
          const prevElement = bodyElements[index - 1];

          if (prevElement instanceof Paragraph) {
            const text = prevElement.getText().trim();
            const content = prevElement.getContent();
            const hasHyperlink = content.some((item: any) => item.constructor.name === 'Hyperlink');

            console.log(`  Previous element is Paragraph:`);
            console.log(`    Text: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
            console.log(`    Has hyperlink: ${hasHyperlink}`);
            console.log(`    Content items: ${content.length}`);

            if (hasHyperlink) {
              content.forEach((item: any, i: number) => {
                if (item.constructor.name === 'Hyperlink') {
                  console.log(`    Hyperlink ${i}: "${item.getText()}"`);
                }
              });
            }
          } else {
            console.log(`  Previous element is ${element.constructor.name}`);
          }
        } else {
          console.log(`  First element in document (no previous paragraph)`);
        }

        console.log('');
      }
    });

  } catch (error) {
    console.error('[ERROR] Failed:', error);
    process.exit(1);
  }
}

diagnoseBeforeTables()
  .then(() => {
    console.log('[DONE]');
    process.exit(0);
  })
  .catch(error => {
    console.error('[FAILED]', error);
    process.exit(1);
  });
