import { Document } from 'docxmlater';
import * as fs from 'fs';
import * as path from 'path';

async function diagnoseImages() {
  console.log('Diagnosing image detection in Images_Test.docx...\n');

  const filePath = path.join(process.cwd(), 'Images_Test.docx');

  if (!fs.existsSync(filePath)) {
    console.error('Error: Images_Test.docx not found');
    return;
  }

  try {
    // Load document
    const doc = await Document.load(filePath, { strictParsing: false });

    // Get all paragraphs
    const paragraphs = doc.getAllParagraphs();
    console.log(`Total paragraphs: ${paragraphs.length}\n`);

    let imageCount = 0;
    let drawingCount = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const content = para.getContent();

      for (const item of content) {
        const typeName = item.constructor.name;

        if (typeName === 'Image') {
          imageCount++;
          console.log(`✓ Paragraph ${i}: Found Image object`);
        } else if (typeName.includes('Drawing') || typeName.includes('Inline')) {
          drawingCount++;
          console.log(`⚠ Paragraph ${i}: Found ${typeName} (not Image)`);
        }
      }
    }

    console.log(`\n=== Results ===`);
    console.log(`Image objects found: ${imageCount}`);
    console.log(`Drawing/Inline objects found: ${drawingCount}`);

    if (imageCount === 0 && drawingCount > 0) {
      console.log(`\n⚠️  Problem: Images are stored as Drawing/Inline objects, not Image objects`);
      console.log(`   The centerAllImages() method only checks for 'instanceof Image'`);
      console.log(`   This is why it reports '0 images' processed.`);
    }

    doc.dispose();

  } catch (error) {
    console.error('Error:', error);
  }
}

diagnoseImages().catch(console.error);
