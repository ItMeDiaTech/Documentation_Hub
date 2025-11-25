/**
 * Script to create Images_Test.docx documenting image implementation
 * Note: Programmatic image insertion via docxmlater API requires further investigation
 */

import { Document, Paragraph, Run } from 'docxmlater';
import * as path from 'path';

async function createImagesTestDocument() {
  console.log('Creating Images_Test.docx documenting image implementation...');

  // Create new document
  const doc = new Document();

  // Add title
  const title = Paragraph.create();
  const titleRun = new Run('Image Implementation Test Document');
  titleRun.setFont('Verdana');
  titleRun.setSize(16);
  titleRun.setBold(true);
  title.addRun(titleRun);
  title.setAlignment('center');
  title.setSpaceAfter(240); // 12pt
  doc.addParagraph(title);

  // Add description
  const desc = Paragraph.create();
  const descRun = new Run(
    'This document describes the image processing implementation in WordDocumentProcessor. The centerAllImages() method processes existing images in documents.'
  );
  descRun.setFont('Verdana');
  descRun.setSize(12);
  desc.addRun(descRun);
  desc.setSpaceAfter(240); // 12pt
  doc.addParagraph(desc);

  // Add implementation details section
  const implTitle = Paragraph.create();
  const implTitleRun = new Run('Image Processing Implementation');
  implTitleRun.setFont('Verdana');
  implTitleRun.setSize(14);
  implTitleRun.setBold(true);
  implTitle.addRun(implTitleRun);
  implTitle.setSpaceBefore(240); // 12pt
  implTitle.setSpaceAfter(120); // 6pt
  doc.addParagraph(implTitle);

  // Image test specifications
  const imageSpecs = [
    {
      label: 'Small Square (100x100 pixels)',
      description: 'Red background - Should be centered and bordered',
    },
    {
      label: 'Medium Rectangle (200x150 pixels)',
      description: 'Green background - Should be centered and bordered',
    },
    {
      label: 'Large Rectangle (300x200 pixels)',
      description: 'Blue background - Should be centered and bordered',
    },
    {
      label: 'Extra Large (400x300 pixels)',
      description: 'Magenta background - Should be centered and bordered',
    },
    {
      label: 'Tall Portrait (150x300 pixels)',
      description: 'Yellow background - Should be centered and bordered',
    },
    {
      label: 'Wide Landscape (300x150 pixels)',
      description: 'Cyan background - Should be centered and bordered',
    },
    {
      label: 'Very Small (40x40 pixels)',
      description: 'Orange background - Should NOT have border (below 50x50 threshold)',
    },
  ];

  // Add test specifications
  for (const spec of imageSpecs) {
    const specPara = Paragraph.create();
    const specRun = new Run(`• ${spec.label}: ${spec.description}`);
    specRun.setFont('Verdana');
    specRun.setSize(11);
    specPara.addRun(specRun);
    specPara.setSpaceAfter(60); // 3pt
    doc.addParagraph(specPara);
    console.log(`Added specification: ${spec.label}`);
  }

  // Add technical details
  const techTitle = Paragraph.create();
  const techTitleRun = new Run('Technical Implementation Details');
  techTitleRun.setFont('Verdana');
  techTitleRun.setSize(14);
  techTitleRun.setBold(true);
  techTitle.addRun(techTitleRun);
  techTitle.setSpaceBefore(240); // 12pt
  techTitle.setSpaceAfter(120); // 6pt
  doc.addParagraph(techTitle);

  const details = [
    'The centerAllImages() function processes images larger than 50x50 pixels',
    'Images are centered using para.setAlignment("center")',
    'Borders are applied using XML manipulation (2pt solid black)',
    'Small images (≤50x50) are skipped to avoid formatting icons/logos',
    'Border format: <a:ln w="25400"> with solid black fill (#000000)',
    'Minimum size threshold: 476250 EMUs (50 pixels)',
    'Border width: 25400 EMUs (2pt)',
    'Processing checks: instanceof Image, getWidth(), getHeight()',
  ];

  for (const detail of details) {
    const detailPara = Paragraph.create();
    const detailRun = new Run(`• ${detail}`);
    detailRun.setFont('Verdana');
    detailRun.setSize(11);
    detailPara.addRun(detailRun);
    detailPara.setSpaceAfter(60); // 3pt
    doc.addParagraph(detailPara);
  }

  // Add testing instructions
  const testTitle = Paragraph.create();
  const testTitleRun = new Run('Testing Instructions');
  testTitleRun.setFont('Verdana');
  testTitleRun.setSize(14);
  testTitleRun.setBold(true);
  testTitle.addRun(testTitleRun);
  testTitle.setSpaceBefore(240); // 12pt
  testTitle.setSpaceAfter(120); // 6pt
  doc.addParagraph(testTitle);

  const instructions = [
    'To test image processing, insert images manually into a Word document',
    'Use the image sizes specified above for comprehensive testing',
    'Process the document through WordDocumentProcessor with centerImages: true',
    'Verify that images >50x50 are centered and have 2pt solid black borders',
    'Verify that images ≤50x50 remain unchanged',
    'Check that image quality and dimensions are preserved',
  ];

  for (const instruction of instructions) {
    const instrPara = Paragraph.create();
    const instrRun = new Run(`${instructions.indexOf(instruction) + 1}. ${instruction}`);
    instrRun.setFont('Verdana');
    instrRun.setSize(11);
    instrPara.addRun(instrRun);
    instrPara.setSpaceAfter(60); // 3pt
    doc.addParagraph(instrPara);
  }

  // Add footer note
  const footer = Paragraph.create();
  const footerRun = new Run(
    'Note: Programmatic image insertion via docxmlater API requires further investigation as the Image class constructor is private. For testing, manually insert images into a Word document and process with centerImages option enabled.'
  );
  footerRun.setFont('Verdana');
  footerRun.setSize(10);
  footerRun.setItalic(true);
  footer.addRun(footerRun);
  footer.setSpaceBefore(240); // 12pt
  doc.addParagraph(footer);

  // Save document to root directory with timestamp to avoid conflicts
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const outputPath = path.join(process.cwd(), `Images_Test_${timestamp}.docx`);
  await doc.save(outputPath);

  console.log(`✓ Successfully created: ${outputPath}`);
  console.log(`✓ Document contains image implementation documentation and test specifications`);

  return outputPath;
}

// Run the script
createImagesTestDocument()
  .then((filePath) => {
    console.log('\nTest document created successfully!');
    console.log(`File: ${filePath}`);
    console.log('\nTo test image processing:');
    console.log('1. Open the document and manually insert test images');
    console.log('2. Process through WordDocumentProcessor with centerImages: true');
    console.log('3. Verify centering and 2pt black borders are applied');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error creating test document:', error);
    process.exit(1);
  });
