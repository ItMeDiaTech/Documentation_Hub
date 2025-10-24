const { Document } = require('docxmlater');

async function diagnoseHyperlinkTextLoss() {
  console.log('Diagnosing Hyperlink Text Loss\n');
  console.log('='.repeat(70));

  // Load document
  const doc = await Document.load('Test6_BaseFile.docx', { strictParsing: false });
  const paragraphs = doc.getParagraphs();

  console.log(`\nTotal Paragraphs: ${paragraphs.length}`);
  console.log('\nParagraphs with Content Analysis:');
  console.log('-'.repeat(70));

  paragraphs.forEach((para, i) => {
    const content = para.getContent();
    const text = para.getText();
    const hasHyperlinks = content.some(item => item.constructor.name === 'Hyperlink');
    const hasText = text.trim().length > 0;

    if (hasHyperlinks || hasText) {
      console.log(`\n[${String(i).padStart(2, '0')}] Style: ${para.getStyle() || 'Normal'}`);
      console.log(`     Text: "${text.substring(0, 60)}"`);
      console.log(`     Content items: ${content.length}`);

      content.forEach((item, ci) => {
        const type = item.constructor.name;
        if (type === 'Hyperlink') {
          console.log(`       [${ci}] Hyperlink: url="${item.getUrl()}" text="${item.getText()}"`);
        } else if (type === 'Run') {
          const runText = item.getText();
          if (runText) {
            console.log(`       [${ci}] Run: "${runText.substring(0, 40)}"`);
          }
        }
      });
    }
  });

  console.log('\n' + '='.repeat(70));
  console.log('\n✅ Analysis complete');
  console.log('⚠️  Note: With strictParsing: false, about:blank is NOT a Hyperlink object');
  console.log('   But the Run/Text content should still be in the paragraph!');
}

diagnoseHyperlinkTextLoss().catch(console.error);
