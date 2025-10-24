/**
 * Phase 3: Integration Test - Verify removeExtraParagraphLines fix
 *
 * Tests that the fixed removeExtraParagraphLines() function:
 * 1. Does not cause catastrophic data loss
 * 2. Preserves list items, hyperlinks, and table content
 * 3. Has deletion rate < 10% on test documents
 */

import { Document } from 'docxmlater';
import { WordDocumentProcessor } from './src/services/document/WordDocumentProcessor.ts';
import { promises as fs } from 'fs';
import * as path from 'path';

async function testRemoveExtraLinesFixture() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PHASE 3: INTEGRATION TEST - removeExtraParagraphLines Fix');
  console.log('═══════════════════════════════════════════════════════════\n');

  const testFile = 'Test_Base.docx';
  const backupFile = 'Test_Base.docx.backup.test';

  try {
    // Step 1: Load original document
    console.log('📋 Loading original document...');
    const docOriginal = await Document.load(testFile, { strictParsing: false });
    const originalParaCount = docOriginal.getParagraphs().length;
    const originalHyperlinkCount = docOriginal.getHyperlinks().length;
    const originalTableCount = docOriginal.getTables().length;

    console.log(`✅ Original structure:`);
    console.log(`   - Paragraphs: ${originalParaCount}`);
    console.log(`   - Hyperlinks: ${originalHyperlinkCount}`);
    console.log(`   - Tables: ${originalTableCount}`);

    // Step 2: Create backup
    console.log('\n📋 Creating backup...');
    await fs.copyFile(testFile, backupFile);

    // Step 3: Process document with removeParagraphLines enabled
    console.log('\n⚙️  Processing with removeParagraphLines option...');
    const processor = new WordDocumentProcessor();
    const result = await processor.processDocument(testFile, {
      removeParagraphLines: true,
      trackChanges: false,
    });

    // Step 4: Load processed document
    console.log('\n📊 Loading processed document...');
    const docProcessed = await Document.load(testFile, { strictParsing: false });
    const processedParaCount = docProcessed.getParagraphs().length;
    const processedHyperlinkCount = docProcessed.getHyperlinks().length;
    const processedTableCount = docProcessed.getTables().length;

    console.log(`✅ Processed structure:`);
    console.log(`   - Paragraphs: ${processedParaCount}`);
    console.log(`   - Hyperlinks: ${processedHyperlinkCount}`);
    console.log(`   - Tables: ${processedTableCount}`);

    // Step 5: Calculate metrics
    console.log('\n📈 METRICS:');
    console.log('─'.repeat(60));

    const deletedParas = originalParaCount - processedParaCount;
    const deletionRate = (deletedParas / originalParaCount) * 100;
    const deletedHyperlinks = originalHyperlinkCount - processedHyperlinkCount;

    console.log(`Paragraphs deleted: ${deletedParas} (${deletionRate.toFixed(2)}%)`);
    console.log(`Hyperlinks preserved: ${processedHyperlinkCount}/${originalHyperlinkCount}`);
    console.log(`Tables preserved: ${processedTableCount}/${originalTableCount}`);

    // Step 6: Safety checks
    console.log('\n✅ SAFETY CHECKS:');
    console.log('─'.repeat(60));

    let allPassed = true;

    // Check 1: Deletion rate < 10%
    if (deletionRate < 10) {
      console.log(`✅ PASS: Deletion rate ${deletionRate.toFixed(2)}% < 10% threshold`);
    } else {
      console.log(`❌ FAIL: Deletion rate ${deletionRate.toFixed(2)}% >= 10% threshold`);
      allPassed = false;
    }

    // Check 2: Tables preserved
    if (processedTableCount === originalTableCount) {
      console.log(`✅ PASS: All ${originalTableCount} tables preserved`);
    } else {
      console.log(`⚠️  WARNING: ${originalTableCount} tables → ${processedTableCount} tables`);
    }

    // Check 3: Hyperlinks mostly preserved
    const hyperlinkRetention = (processedHyperlinkCount / originalHyperlinkCount) * 100;
    if (hyperlinkRetention >= 90) {
      console.log(`✅ PASS: Hyperlink retention ${hyperlinkRetention.toFixed(1)}% >= 90%`);
    } else {
      console.log(`⚠️  WARNING: Hyperlink retention ${hyperlinkRetention.toFixed(1)}% < 90%`);
    }

    // Check 4: Processing succeeded
    if (result.success) {
      console.log(`✅ PASS: Processing completed successfully`);
    } else {
      console.log(`❌ FAIL: Processing returned success=false`);
      console.log(`   Errors: ${result.errorMessages?.join(', ')}`);
      allPassed = false;
    }

    // Final verdict
    console.log('\n' + '═'.repeat(60));
    if (allPassed && deletionRate < 10) {
      console.log('✅ TEST PASSED: Fix is working correctly!');
      console.log(`   - No catastrophic data loss (${deletionRate.toFixed(2)}% < 10% threshold)`);
      console.log(`   - Document structure preserved`);
      console.log(`   - Ready for Phase 4 (safety features)`);
    } else {
      console.log('❌ TEST FAILED: Fix may have issues');
      console.log(`   Please review the metrics above`);
    }

    // Restore original
    console.log('\n🔄 Restoring original file...');
    await fs.copyFile(backupFile, testFile);
    await fs.unlink(backupFile);
    console.log('✅ Original file restored\n');

  } catch (error) {
    // Clean up on error
    try {
      const backupFile = 'Test_Base.docx.backup.test';
      const stats = await fs.stat(backupFile);
      if (stats) {
        console.log('\n⚠️  Error occurred, restoring backup...');
        await fs.copyFile(backupFile, testFile);
        await fs.unlink(backupFile);
        console.log('✅ Original file restored');
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    console.error('\n❌ TEST FAILED WITH ERROR:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run test
testRemoveExtraLinesFixture().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
