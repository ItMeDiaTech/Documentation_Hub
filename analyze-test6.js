const { Document } = require('docxmlater');

async function analyzeFile(filePath, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${label}: ${filePath}`);
  console.log('='.repeat(60));

  try {
    const doc = await Document.load(filePath);
    const paras = doc.getParagraphs();
    const tables = doc.getTables();

    console.log(`Total Paragraphs: ${paras.length}`);
    console.log(`Total Tables: ${tables.length}`);

    console.log('\nTable Details:');
    tables.forEach((table, i) => {
      const rows = table.getRows();
      console.log(`  Table ${i + 1}: ${rows.length} rows`);
    });

    console.log('\nFirst 15 Paragraphs:');
    paras.slice(0, 15).forEach((p, i) => {
      const style = p.getStyle() || 'Normal';
      const formatting = p.getFormatting();
      const text = p.getText().substring(0, 60).replace(/\n/g, ' ');
      console.log(`  [${String(i).padStart(2, '0')}] ${style.padEnd(15)} | ${text}`);
    });

    console.log('\nLast 15 Paragraphs:');
    paras.slice(-15).forEach((p, i) => {
      const idx = paras.length - 15 + i;
      const style = p.getStyle() || 'Normal';
      const text = p.getText().substring(0, 60).replace(/\n/g, ' ');
      console.log(`  [${String(idx).padStart(2, '0')}] ${style.padEnd(15)} | ${text}`);
    });

  } catch (error) {
    console.error(`Error analyzing ${filePath}:`, error.message);
  }
}

(async () => {
  await analyzeFile('Test6_BaseFile.docx', 'BASE FILE (Original)');
  await analyzeFile('Test6_Processed_Corrupted.docx', 'PROCESSED FILE (Corrupted)');
})();
