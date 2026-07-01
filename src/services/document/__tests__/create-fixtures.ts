/**
 * Test fixtures for WordDocumentProcessor integration tests.
 *
 * The generated `.docx` files are intentionally NOT committed (they are
 * deterministic build artifacts). Instead the integration suite calls
 * `createTestFixtures({ quiet: true })` in a `beforeAll`, so the fixtures are
 * regenerated on every run and the suite behaves identically locally and in CI.
 *
 * It can also be run as a standalone script to inspect the fixtures by hand:
 *   npx ts-node src/services/document/__tests__/create-fixtures.ts
 *
 * Creates 7 DOCX files:
 * 1. sample.docx - Simple valid document
 * 2. hyperlinks.docx - Various hyperlink types
 * 3. theSource.docx - theSource URLs without content IDs
 * 4. theSource-with-ids.docx - theSource URLs with content IDs
 * 5. theSource-malformed.docx - Malformed URLs
 * 6. ooxml-issues.docx - OOXML structure issues (if possible)
 * 7. corrupt.docx - Intentionally broken file
 */

import { Document, Hyperlink } from 'docxmlater';
import * as path from 'path';
import { promises as fs } from 'fs';

const fixturesDir = path.join(__dirname, 'fixtures');

let verbose = true;
function log(...args: unknown[]): void {
  if (verbose) console.log(...args);
}

async function createSampleDocx() {
  log('Creating sample.docx...');

  const doc = Document.create();

  doc.createParagraph('Sample Document').setStyle('Title');
  doc.createParagraph('This is a simple test document with no hyperlinks.');
  doc.createParagraph('It contains multiple paragraphs for basic testing.');
  doc.createParagraph('This document should load and process without errors.');
  doc.createParagraph('Total word count should be easily calculable.');

  const outputPath = path.join(fixturesDir, 'sample.docx');
  await doc.save(outputPath);
  log('✓ Created sample.docx');
}

async function createHyperlinksDocx() {
  log('Creating hyperlinks.docx...');

  const doc = Document.create();

  doc.createParagraph('Document with Hyperlinks').setStyle('Title');

  // External HTTP link
  const para1 = doc.createParagraph();
  para1.addText('Visit our ');
  para1.addHyperlink(Hyperlink.createExternal('http://example.com', 'Example Website'));
  para1.addText(' for more information.');

  // External HTTPS link
  const para2 = doc.createParagraph();
  para2.addText('Check out ');
  para2.addHyperlink(Hyperlink.createExternal('https://github.com', 'GitHub'));
  para2.addText(' for open source projects.');

  // Email link
  const para3 = doc.createParagraph();
  para3.addHyperlink(Hyperlink.createEmail('test@example.com', 'Contact Us'));

  // Another external link
  const para4 = doc.createParagraph();
  para4.addText('Use ');
  para4.addHyperlink(Hyperlink.createExternal('https://www.google.com/search?q=test', 'Search'));
  para4.addText(' to find more resources.');

  // Link with different display text
  const para5 = doc.createParagraph();
  para5.addText('Documentation: ');
  para5.addHyperlink(Hyperlink.createExternal('https://docs.microsoft.com', 'Click Here'));

  const outputPath = path.join(fixturesDir, 'hyperlinks.docx');
  await doc.save(outputPath);
  log('✓ Created hyperlinks.docx');
}

async function createTheSourceDocx() {
  log('Creating theSource.docx...');

  const doc = Document.create();

  doc.createParagraph('theSource URLs without Content IDs').setStyle('Title');

  // theSource URL with document ID but no content ID
  const para1 = doc.createParagraph();
  para1.addText('See ');
  para1.addHyperlink(Hyperlink.createExternal(
    'https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=abc-123-def',
    'Document ABC-123'
  ));
  para1.addText(' for details.');

  // Another theSource URL
  const para2 = doc.createParagraph();
  para2.addText('Reference: ');
  para2.addHyperlink(Hyperlink.createExternal(
    'https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=xyz-789-ghi',
    'Document XYZ-789'
  ));

  // theSource URL with Content_ID parameter (but still needs appending)
  const para3 = doc.createParagraph();
  para3.addHyperlink(Hyperlink.createExternal(
    'https://thesource.cvshealth.com/nuxeo/doc?Content_ID=TSRC-ABC-123456',
    'TSRC-ABC-123456'
  ));

  const outputPath = path.join(fixturesDir, 'theSource.docx');
  await doc.save(outputPath);
  log('✓ Created theSource.docx');
}

async function createTheSourceWithIdsDocx() {
  log('Creating theSource-with-ids.docx...');

  const doc = Document.create();

  doc.createParagraph('theSource URLs WITH Content IDs').setStyle('Title');

  // theSource URL that already has content ID
  const para1 = doc.createParagraph();
  para1.addText('See ');
  para1.addHyperlink(Hyperlink.createExternal(
    'https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=abc-123#content',
    'Document with ID'
  ));
  para1.addText(' (already has content ID).');

  // Another with content ID
  const para2 = doc.createParagraph();
  para2.addText('Reference: ');
  para2.addHyperlink(Hyperlink.createExternal(
    'https://thesource.cvshealth.com/doc?Content_ID=TSRC-XYZ-789012#content',
    'TSRC-XYZ-789012'
  ));

  const outputPath = path.join(fixturesDir, 'theSource-with-ids.docx');
  await doc.save(outputPath);
  log('✓ Created theSource-with-ids.docx');
}

async function createTheSourceMalformedDocx() {
  log('Creating theSource-malformed.docx...');

  const doc = Document.create();

  doc.createParagraph('Edge Case theSource URLs').setStyle('Title');

  // URL with missing required parameters
  const para1 = doc.createParagraph();
  para1.addHyperlink(Hyperlink.createExternal(
    'https://thesource.cvshealth.com/nuxeo/thesource/#!/view',
    'URL Missing DocID'
  ));

  // URL with URL-encoded spaces
  const para2 = doc.createParagraph();
  para2.addHyperlink(Hyperlink.createExternal(
    'https://thesource.cvshealth.com/nuxeo/doc?Content_ID=TSRC%20ABC%20123',
    'URL with Encoded Spaces'
  ));

  // URL with unusual but valid parameters
  const para3 = doc.createParagraph();
  para3.addHyperlink(Hyperlink.createExternal(
    'https://thesource.cvshealth.com/doc?Content_ID=TSRC-000-000000&extra=param',
    'URL with Extra Params'
  ));

  const outputPath = path.join(fixturesDir, 'theSource-malformed.docx');
  await doc.save(outputPath);
  log('✓ Created theSource-malformed.docx');
}

async function createOoxmlIssuesDocx() {
  log('Creating ooxml-issues.docx...');

  // This is tricky - we need to create a valid DOCX first, then manually break it
  // For now, create a valid document and note that manual corruption might be needed

  const doc = Document.create();

  doc.createParagraph('OOXML Validation Test').setStyle('Title');
  doc.createParagraph('This document may need manual modification to introduce OOXML issues.');
  doc.createParagraph('Alternatively, tests can mock validation results.');

  const outputPath = path.join(fixturesDir, 'ooxml-issues.docx');
  await doc.save(outputPath);
  log('✓ Created ooxml-issues.docx (may need manual corruption)');
}

async function createCorruptDocx() {
  log('Creating corrupt.docx...');

  // Create an intentionally corrupt file by writing invalid ZIP data
  const corruptContent = Buffer.from('This is not a valid DOCX file - just random text!');
  const outputPath = path.join(fixturesDir, 'corrupt.docx');

  await fs.writeFile(outputPath, corruptContent);
  log('✓ Created corrupt.docx (intentionally invalid)');
}

/**
 * Generate every integration-test fixture into `fixtures/`. Throws on failure
 * (callers — including the `beforeAll` in the integration suite — surface it).
 */
async function createTestFixtures(options: { quiet?: boolean } = {}): Promise<void> {
  verbose = !options.quiet;

  log('Creating test fixtures for WordDocumentProcessor tests...\n');

  // Ensure fixtures directory exists
  await fs.mkdir(fixturesDir, { recursive: true });

  await createSampleDocx();
  await createHyperlinksDocx();
  await createTheSourceDocx();
  await createTheSourceWithIdsDocx();
  await createTheSourceMalformedDocx();
  await createOoxmlIssuesDocx();
  await createCorruptDocx();

  log('\n✅ All test fixtures created successfully!');
  log(`📁 Location: ${fixturesDir}`);
}

// Run as a standalone script (`npx ts-node create-fixtures.ts`) while staying
// import-safe: importing this module (e.g. from a test) must NOT auto-generate.
if (require.main === module) {
  createTestFixtures().catch((error) => {
    console.error('\n❌ Error creating fixtures:', error);
    process.exit(1);
  });
}

export { createTestFixtures };
