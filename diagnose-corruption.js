/**
 * Document Corruption Diagnostic Tool
 * Analyzes Test_Base.docx vs Test_Corrupt.docx to identify what went wrong
 */

const { Document } = require('docxmlater');
const path = require('path');

async function analyzeDOCX(filePath) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Analyzing: ${path.basename(filePath)}`);
  console.log('='.repeat(70));

  try {
    const doc = await Document.load(filePath, { strictParsing: false });

    // Extract basic statistics
    const paragraphs = doc.getParagraphs();
    const tables = doc.getTables();
    const hyperlinks = [];
    const images = [];

    // Extract hyperlinks and images from paragraphs
    for (const para of paragraphs) {
      const content = para.getContent();
      for (const item of content) {
        if (item.constructor.name === 'Hyperlink') {
          hyperlinks.push({
            text: item.getText(),
            url: item.getUrl(),
          });
        } else if (item.constructor.name === 'Image') {
          images.push({
            width: item.getWidth?.() || 'unknown',
            height: item.getHeight?.() || 'unknown',
          });
        }
      }
    }

    // Get text content from paragraphs
    const paragraphTexts = paragraphs.map((para, index) => {
      const runs = para.getRuns();
      const text = runs.map(run => run.getText() || '').join('');
      const style = para.getStyle() || para.getFormatting().style || 'Normal';
      return {
        index,
        style,
        text: text.substring(0, 100), // First 100 chars
        length: text.length,
        runCount: runs.length,
      };
    });

    // Get table details
    const tableDetails = tables.map((table, index) => {
      const rows = table.getRows();
      return {
        index,
        rows: rows.length,
        columns: rows[0]?.getCells().length || 0,
        totalCells: rows.reduce((sum, row) => sum + row.getCells().length, 0),
      };
    });

    // Statistics
    const stats = {
      totalParagraphs: paragraphs.length,
      totalTables: tables.length,
      totalHyperlinks: hyperlinks.length,
      totalImages: images.length,
      wordCount: doc.getWordCount(),
      characterCount: doc.getCharacterCount(),
    };

    // Print results
    console.log('\n📊 DOCUMENT STATISTICS:');
    console.log(JSON.stringify(stats, null, 2));

    console.log('\n📝 PARAGRAPHS (first 10):');
    paragraphTexts.slice(0, 10).forEach(para => {
      console.log(`  [${para.index}] ${para.style}: "${para.text}" (${para.length} chars, ${para.runCount} runs)`);
    });

    console.log('\n📋 TABLES:');
    tableDetails.forEach(table => {
      console.log(`  Table ${table.index}: ${table.rows}x${table.columns} (${table.totalCells} cells)`);
    });

    console.log('\n🔗 HYPERLINKS (first 10):');
    hyperlinks.slice(0, 10).forEach((link, i) => {
      console.log(`  [${i}] "${link.text}" → ${link.url?.substring(0, 60)}`);
    });

    console.log('\n🖼️ IMAGES:');
    console.log(`  Total: ${images.length}`);

    return {
      stats,
      paragraphs: paragraphTexts,
      tables: tableDetails,
      hyperlinks,
      images,
    };

  } catch (error) {
    console.error(`\n❌ ERROR analyzing ${path.basename(filePath)}:`);
    console.error(error.message);
    console.error(error.stack);
    return null;
  }
}

async function compareDocuments(baseData, corruptData) {
  console.log(`\n${'='.repeat(70)}`);
  console.log('🔍 COMPARISON ANALYSIS');
  console.log('='.repeat(70));

  if (!baseData || !corruptData) {
    console.log('\n❌ Cannot compare - one or both documents failed to load');
    return;
  }

  // Compare statistics
  console.log('\n📊 STATISTICS COMPARISON:');
  console.log(`Paragraphs: ${baseData.stats.totalParagraphs} → ${corruptData.stats.totalParagraphs} (${corruptData.stats.totalParagraphs - baseData.stats.totalParagraphs >= 0 ? '+' : ''}${corruptData.stats.totalParagraphs - baseData.stats.totalParagraphs})`);
  console.log(`Tables: ${baseData.stats.totalTables} → ${corruptData.stats.totalTables} (${corruptData.stats.totalTables - baseData.stats.totalTables >= 0 ? '+' : ''}${corruptData.stats.totalTables - baseData.stats.totalTables})`);
  console.log(`Hyperlinks: ${baseData.stats.totalHyperlinks} → ${corruptData.stats.totalHyperlinks} (${corruptData.stats.totalHyperlinks - baseData.stats.totalHyperlinks >= 0 ? '+' : ''}${corruptData.stats.totalHyperlinks - baseData.stats.totalHyperlinks})`);
  console.log(`Images: ${baseData.stats.totalImages} → ${corruptData.stats.totalImages} (${corruptData.stats.totalImages - baseData.stats.totalImages >= 0 ? '+' : ''}${corruptData.stats.totalImages - baseData.stats.totalImages})`);
  console.log(`Word Count: ${baseData.stats.wordCount} → ${corruptData.stats.wordCount} (${corruptData.stats.wordCount - baseData.stats.wordCount >= 0 ? '+' : ''}${corruptData.stats.wordCount - baseData.stats.wordCount})`);
  console.log(`Characters: ${baseData.stats.characterCount} → ${corruptData.stats.characterCount} (${corruptData.stats.characterCount - baseData.stats.characterCount >= 0 ? '+' : ''}${corruptData.stats.characterCount - baseData.stats.characterCount})`);

  // Identify missing/changed paragraphs
  console.log('\n📝 PARAGRAPH CHANGES:');
  const maxLen = Math.max(baseData.paragraphs.length, corruptData.paragraphs.length);
  let missingCount = 0;
  let changedCount = 0;
  let emptyCount = 0;

  for (let i = 0; i < Math.min(20, maxLen); i++) {
    const base = baseData.paragraphs[i];
    const corrupt = corruptData.paragraphs[i];

    if (base && !corrupt) {
      console.log(`  ❌ [${i}] MISSING: "${base.text}"`);
      missingCount++;
    } else if (!base && corrupt) {
      console.log(`  ➕ [${i}] ADDED: "${corrupt.text}"`);
    } else if (base && corrupt) {
      if (base.text !== corrupt.text) {
        console.log(`  ⚠️  [${i}] CHANGED:`);
        console.log(`      Base:    "${base.text}"`);
        console.log(`      Corrupt: "${corrupt.text}"`);
        changedCount++;
      }
      if (corrupt.length === 0 && base.length > 0) {
        console.log(`  🗑️  [${i}] EMPTIED: Was "${base.text}"`);
        emptyCount++;
      }
    }
  }

  console.log(`\nTotal Missing: ${missingCount}, Changed: ${changedCount}, Emptied: ${emptyCount}`);

  // Check for hyperlink corruption
  console.log('\n🔗 HYPERLINK ANALYSIS:');
  const baseLinkTexts = new Set(baseData.hyperlinks.map(h => h.text));
  const corruptLinkTexts = new Set(corruptData.hyperlinks.map(h => h.text));

  const missingLinks = baseData.hyperlinks.filter(h => !corruptLinkTexts.has(h.text));
  const addedLinks = corruptData.hyperlinks.filter(h => !baseLinkTexts.has(h.text));

  console.log(`Missing Hyperlinks: ${missingLinks.length}`);
  missingLinks.slice(0, 5).forEach(link => {
    console.log(`  ❌ "${link.text}" → ${link.url?.substring(0, 60)}`);
  });

  console.log(`Added Hyperlinks: ${addedLinks.length}`);
  addedLinks.slice(0, 5).forEach(link => {
    console.log(`  ➕ "${link.text}" → ${link.url?.substring(0, 60)}`);
  });

  // Check for malformed hyperlinks
  console.log('\n⚠️  MALFORMED HYPERLINKS:');
  const malformed = corruptData.hyperlinks.filter(h => {
    const text = h.text || '';
    return text.includes('<w:') || text.includes('xml:') || text.includes('</w:');
  });

  if (malformed.length > 0) {
    console.log(`Found ${malformed.length} hyperlinks with XML corruption:`);
    malformed.slice(0, 5).forEach((link, i) => {
      console.log(`  [${i}] "${link.text.substring(0, 100)}"`);
    });
  } else {
    console.log('✓ No XML corruption detected in hyperlink text');
  }

  // Potential causes
  console.log('\n🔍 POTENTIAL CAUSES:');
  const causes = [];

  if (corruptData.stats.totalParagraphs < baseData.stats.totalParagraphs * 0.5) {
    causes.push('❌ CRITICAL: Over 50% of paragraphs lost - likely paragraph reconstruction issue');
  }
  if (emptyCount > 5) {
    causes.push('⚠️  Many paragraphs were emptied - possible run content loss during processing');
  }
  if (malformed.length > 0) {
    causes.push('❌ XML corruption in hyperlink text - getText() returning XML markup instead of text');
  }
  if (corruptData.stats.totalHyperlinks < baseData.stats.totalHyperlinks * 0.5) {
    causes.push('❌ Over 50% of hyperlinks lost - likely content reconstruction issue');
  }
  if (corruptData.stats.wordCount < baseData.stats.wordCount * 0.5) {
    causes.push('❌ CRITICAL: Over 50% of content lost - document structure severely damaged');
  }

  if (causes.length === 0) {
    causes.push('✓ No critical issues detected - corruption may be subtle');
  }

  causes.forEach(cause => console.log(`  ${cause}`));
}

async function main() {
  console.log('🔬 Document Corruption Diagnostic Tool');
  console.log('Analyzing Test_Base.docx vs Test_Corrupt.docx\n');

  const basePath = path.join(__dirname, 'Test_Base.docx');
  const corruptPath = path.join(__dirname, 'Test_Corrupt.docx');

  const baseData = await analyzeDOCX(basePath);
  const corruptData = await analyzeDOCX(corruptPath);

  await compareDocuments(baseData, corruptData);

  console.log('\n' + '='.repeat(70));
  console.log('✅ Analysis Complete');
  console.log('='.repeat(70) + '\n');
}

main().catch(error => {
  console.error('\n💥 FATAL ERROR:', error);
  process.exit(1);
});
