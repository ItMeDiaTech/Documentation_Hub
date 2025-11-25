/**
 * Script to create Images_Test.docx with actual embedded images
 * Uses the 'docx' library which has better support for programmatic image insertion
 */

import { createCanvas } from 'canvas';
import { AlignmentType, Document, HeadingLevel, ImageRun, Paragraph, TextRun } from 'docx';
import { writeFileSync } from 'fs';
import * as path from 'path';

/**
 * Create a simple colored rectangle image as a buffer
 */
function createTestImage(width: number, height: number, color: string): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fill with solid color
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);

  // Add text showing dimensions (NO border - let WordDocumentProcessor add it)
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${width}x${height}`, width / 2, height / 2);

  return canvas.toBuffer('image/png');
}

async function createImagesTestDocument() {
  console.log('Creating Images_Test.docx with actual embedded images using docx library...');

  // Define test images with varying sizes
  const testImages = [
    { width: 100, height: 100, color: '#FF0000', label: 'Small Square (100x100)' },
    { width: 200, height: 150, color: '#00FF00', label: 'Medium Rectangle (200x150)' },
    { width: 300, height: 200, color: '#0000FF', label: 'Large Rectangle (300x200)' },
    { width: 400, height: 300, color: '#FF00FF', label: 'Extra Large (400x300)' },
    { width: 150, height: 300, color: '#FFFF00', label: 'Tall Portrait (150x300)' },
    { width: 300, height: 150, color: '#00FFFF', label: 'Wide Landscape (300x150)' },
    { width: 40, height: 40, color: '#FFA500', label: 'Very Small (40x40) - Should NOT have border' },
  ];

  const sections: any[] = [];

  // Create title
  sections.push(
    new Paragraph({
      text: 'Image Implementation Test Document',
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    })
  );

  // Create description
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'This document contains actual images of varying sizes to test the image implementation. All images should be centered and have 2pt solid black borders (for images >50x50 pixels).',
          font: 'Verdana',
          size: 24, // 12pt = 24 half-points
        }),
      ],
      spacing: { after: 240 },
    })
  );

  // Add each test image
  for (const imageSpec of testImages) {
    // Add label
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: imageSpec.label,
            font: 'Verdana',
            size: 24,
            bold: true,
          }),
        ],
        spacing: { before: 120, after: 60 },
      })
    );

    // Create image buffer
    const imageBuffer = createTestImage(imageSpec.width, imageSpec.height, imageSpec.color);

    // Add image
    sections.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: 'png',
            data: imageBuffer,
            transformation: {
              width: imageSpec.width,
              height: imageSpec.height,
            },
          }),
        ],
        alignment: AlignmentType.LEFT, // Will be centered by WordDocumentProcessor
        spacing: { after: 120 },
      })
    );

    console.log(`Added image: ${imageSpec.label}`);
  }

  // Add footer note
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'Note: Images larger than 50x50 pixels should be centered and have 2pt solid black borders when processed through WordDocumentProcessor.centerAllImages().',
          font: 'Verdana',
          size: 20,
          italics: true,
        }),
      ],
      spacing: { before: 240 },
    })
  );

  // Create document
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: sections,
      },
    ],
  });

  // Generate buffer using Packer
  const { Packer } = await import('docx');
  const buffer = await Packer.toBuffer(doc);

  // Save to file
  const outputPath = path.join(process.cwd(), 'Images_Test.docx');
  writeFileSync(outputPath, buffer);

  console.log(`✓ Successfully created: ${outputPath}`);
  console.log(`✓ Document contains ${testImages.length} actual embedded images`);

  return outputPath;
}

// Run the script
createImagesTestDocument()
  .then((filePath) => {
    console.log('\nTest document created successfully!');
    console.log(`File: ${filePath}`);
    console.log('\nThe document now contains actual colored images of varying sizes.');
    console.log('You can now test the centerAllImages() function by processing this document.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error creating test document:', error);
    process.exit(1);
  });
