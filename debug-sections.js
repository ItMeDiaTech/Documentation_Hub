/**
 * Check all document sections for tables
 * Headers, footers, text boxes, etc.
 */

const { Document } = require('docxmlater');

async function checkAllSections() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('COMPREHENSIVE TABLE SEARCH: All Sections');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    const doc = await Document.load('Test_Base.docx', { strictParsing: false });

    // Check main body
    console.log('📄 MAIN DOCUMENT BODY:');
    console.log('─'.repeat(60));
    const tables = doc.getTables();
    console.log(`Tables via getTables(): ${tables.length}`);
    tables.forEach((t, i) => {
      const rows = t.getRows ? t.getRows() : [];
      console.log(`  [${i}] ${rows.length} rows`);
    });

    // Check body elements
    console.log('\n📋 BODY ELEMENTS:');
    console.log('─'.repeat(60));
    const bodyElements = doc.getBodyElements ? doc.getBodyElements() : [];
    console.log(`Total body elements: ${bodyElements.length}`);
    let tableCount = 0;
    bodyElements.forEach((el, i) => {
      if (el.constructor.name === 'Table') {
        console.log(`  [${i}] TABLE`);
        tableCount++;
      }
    });
    console.log(`Total tables in body elements: ${tableCount}`);

    // Check sections
    console.log('\n📑 SECTIONS:');
    console.log('─'.repeat(60));
    const sections = doc.getSections ? doc.getSections() : [];
    console.log(`Sections: ${sections.length}`);
    sections.forEach((section, i) => {
      console.log(`  Section ${i}:`);
      if (section.getChildren) {
        const children = section.getChildren();
        console.log(`    Children: ${children.length}`);
      }
    });

    // Check headers
    console.log('\n📌 HEADERS:');
    console.log('─'.repeat(60));
    try {
      const headers = doc.getDefaultHeader ? doc.getDefaultHeader() : null;
      if (headers) {
        console.log(`Default header exists`);
        if (headers.getElements) {
          const headerElements = headers.getElements();
          console.log(`  Elements: ${headerElements.length}`);
          headerElements.forEach((el, i) => {
            console.log(`    [${i}] ${el.constructor.name}`);
          });
        }
      } else {
        console.log(`No default header`);
      }
    } catch (e) {
      console.log(`Error checking headers: ${e.message}`);
    }

    // Check footers
    console.log('\n📌 FOOTERS:');
    console.log('─'.repeat(60));
    try {
      const footers = doc.getDefaultFooter ? doc.getDefaultFooter() : null;
      if (footers) {
        console.log(`Default footer exists`);
        if (footers.getElements) {
          const footerElements = footers.getElements();
          console.log(`  Elements: ${footerElements.length}`);
          footerElements.forEach((el, i) => {
            console.log(`    [${i}] ${el.constructor.name}`);
          });
        }
      } else {
        console.log(`No default footer`);
      }
    } catch (e) {
      console.log(`Error checking footers: ${e.message}`);
    }

    // Check document properties
    console.log('\n📖 DOCUMENT PROPERTIES:');
    console.log('─'.repeat(60));
    try {
      console.log(`Document methods available:`);
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(doc));
      const tableMethods = methods.filter(m => m.toLowerCase().includes('table'));
      console.log(`  Table-related methods: ${tableMethods.join(', ')}`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }

    // Last resort: Search all paragraphs for "If" and "Then"
    console.log('\n🔍 PARAGRAPH SEARCH FOR "If" AND "Then":');
    console.log('─'.repeat(60));
    const paragraphs = doc.getParagraphs();
    let found = false;
    paragraphs.forEach((para, i) => {
      try {
        const runs = para.getRuns ? para.getRuns() : [];
        const text = runs.map(r => r.getText ? r.getText() : '').join('');
        if (text.toLowerCase().includes('if') || text.toLowerCase().includes('then')) {
          console.log(`[Para ${i}] "${text}"`);
          found = true;
        }
      } catch (e) {
        // ignore
      }
    });

    if (!found) {
      console.log('⚠️  "If" or "Then" NOT found in any paragraph');
    }

    // Check if document might have embedded objects
    console.log('\n📦 DOCUMENT INTERNALS:');
    console.log('─'.repeat(60));
    console.log(`Document constructor: ${doc.constructor.name}`);
    console.log(`Document keys: ${Object.keys(doc).slice(0, 10).join(', ')}...`);

  } catch (error) {
    console.error('ERROR:', error.message);
  }
}

checkAllSections();
