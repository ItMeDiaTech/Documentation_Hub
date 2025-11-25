import * as fs from 'fs';
import * as path from 'path';
import { WordDocumentProcessor } from '../src/services/document/WordDocumentProcessor.ts';

async function processImagesTest() {
  console.log('Processing Images_Test.docx...');

  const inputPath = path.join(process.cwd(), 'Images_Test.docx');
  const outputPath = path.join(process.cwd(), 'Images_Test_Processed.docx');

  // Check if input file exists
  if (!fs.existsSync(inputPath)) {
    console.error('Error: Images_Test.docx not found in root directory');
    console.error('Please ensure the file exists before running this script');
    return;
  }

  try {
    // Create processor instance
    const processor = new WordDocumentProcessor();

    // Process the document with centerImages option enabled
    console.log('Applying centerAllImages() to process images...');
    await processor.processDocument(inputPath, {
      centerImages: true,
    });

    // The processed document is saved to inputPath
    // Copy it to the output path
    fs.copyFileSync(inputPath, outputPath);

    console.log('\n✓ Successfully processed document!');
    console.log(`\nInput:  Images_Test.docx`);
    console.log(`Output: Images_Test_Processed.docx`);
    console.log('\nExpected results in processed document:');
    console.log('- Images >50x50 pixels: CENTERED with 2pt solid black border');
    console.log('- Images ≤50x50 pixels (40x40): NOT modified (no border, not centered)');
    console.log('\nOpen Images_Test_Processed.docx to verify the results.');

  } catch (error) {
    console.error('Error processing document:', error);
    throw error;
  }
}

// Run the script
processImagesTest().catch(console.error);
