/**
 * Debug Script: Analyze how DocXMLater handles tables and paragraphs
 * Specifically looking for the "If/Then" table issue
 */

const { Document } = require('docxmlater');

async function debugTableStructure() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DEBUG: Table Structure Analysis');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    const doc = await Document.load('Test_Base.docx', { strictParsing: false });

    console.log('📊 DOCUMENT BODY STRUCTURE');
    console.log('─'.repeat(60));

    // Get body elements (includes paragraphs AND tables)
    const bodyElements = doc.getBodyElements();
    console.log(`Total body elements: ${bodyElements.length}\n`);

    // Log each element
    bodyElements.forEach((element, index) => {
      const type = element.constructor.name;
      console.log(`[${index}] Type: ${type}`);

      if (type === 'Paragraph') {
        const text = element.getRuns ?
          element.getRuns().map(r => r.getText() || '').join('') :
          '[No runs]';
        const numbering = element.getNumbering ? element.getNumbering() : null;
        const content = element.getContent ? element.getContent() : [];

        console.log(`    Text: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
        console.log(`    Runs: ${element.getRuns ? element.getRuns().length : 0}`);
        console.log(`    Numbering: ${numbering ? 'Yes (list item)' : 'No'}`);
        console.log(`    Content items: ${content.length}`);

        // Check for hyperlinks in content
        const hyperlinks = content.filter(item => item.constructor.name === 'Hyperlink');
        if (hyperlinks.length > 0) {
          console.log(`    ⚠️  Contains ${hyperlinks.length} hyperlink(s)`);
        }

      } else if (type === 'Table') {
        const rows = element.getRows ? element.getRows() : [];
        const cols = rows.length > 0 ? rows[0].getCells().length : 0;

        console.log(`    Size: ${rows.length} rows × ${cols} cols`);
        console.log(`    ✓ TABLE DETECTED`);

        // Show cell contents
        if (rows.length > 0) {
          console.log(`    Cell contents:`);
          rows.forEach((row, rowIdx) => {
            const cells = row.getCells();
            cells.forEach((cell, colIdx) => {
              const cellParas = cell.getParagraphs ? cell.getParagraphs() : [];
              const cellText = cellParas
                .map(p => {
                  const runs = p.getRuns ? p.getRuns() : [];
                  return runs.map(r => r.getText() || '').join('');
                })
                .join(' ');

              console.log(`      [${rowIdx},${colIdx}]: "${cellText}"`);
            });
          });
        }
      } else {
        console.log(`    Other element type`);
      }

      console.log();
    });

    // Now check getParagraphs() specifically
    console.log('\n📋 BODY-LEVEL PARAGRAPHS ONLY (via getParagraphs())');
    console.log('─'.repeat(60));

    const paragraphs = doc.getParagraphs();
    console.log(`Total paragraphs: ${paragraphs.length}\n`);

    paragraphs.forEach((para, index) => {
      const text = para.getRuns ?
        para.getRuns().map(r => r.getText() || '').join('') :
        '[No runs]';

      console.log(`[${index}] "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    });

    // Check for table elements
    console.log('\n🔍 TABLES VIA getTables()');
    console.log('─'.repeat(60));

    const tables = doc.getTables();
    console.log(`Total tables: ${tables.length}\n`);

    tables.forEach((table, tableIdx) => {
      const rows = table.getRows ? table.getRows() : [];
      console.log(`Table ${tableIdx}: ${rows.length} rows`);

      rows.forEach((row, rowIdx) => {
        const cells = row.getCells();
        console.log(`  Row ${rowIdx}: ${cells.length} cells`);

        cells.forEach((cell, colIdx) => {
          const cellParas = cell.getParagraphs ? cell.getParagraphs() : [];
          const cellText = cellParas
            .map(p => {
              const runs = p.getRuns ? p.getRuns() : [];
              return runs.map(r => r.getText() || '').join('');
            })
            .join(' ');

          console.log(`    [${colIdx}]: "${cellText}"`);
        });
      });
      console.log();
    });

    // Critical question: Is the "If/Then" table in cells or body paragraphs?
    console.log('\n🎯 LOOKING FOR "If" AND "Then" CELLS');
    console.log('─'.repeat(60));

    let foundIfThen = false;

    // Check tables
    tables.forEach((table, tableIdx) => {
      const rows = table.getRows ? table.getRows() : [];
      rows.forEach((row, rowIdx) => {
        const cells = row.getCells();
        cells.forEach((cell, colIdx) => {
          const cellParas = cell.getParagraphs ? cell.getParagraphs() : [];
          const cellText = cellParas
            .map(p => {
              const runs = p.getRuns ? p.getRuns() : [];
              return runs.map(r => r.getText() || '').join('');
            })
            .join(' ')
            .trim();

          if (cellText.toLowerCase().includes('if') || cellText.toLowerCase().includes('then')) {
            console.log(`✓ FOUND in Table ${tableIdx}, Row ${rowIdx}, Col ${colIdx}: "${cellText}"`);
            foundIfThen = true;
          }
        });
      });
    });

    // Check body paragraphs
    paragraphs.forEach((para, idx) => {
      const text = para.getRuns ?
        para.getRuns().map(r => r.getText() || '').join('') :
        '';

      if (text.toLowerCase().includes('if') || text.toLowerCase().includes('then')) {
        console.log(`✓ FOUND in Body Paragraph ${idx}: "${text}"`);
        foundIfThen = true;
      }
    });

    if (!foundIfThen) {
      console.log('⚠️  "If" or "Then" cells NOT found in document');
    }

    console.log('\n' + '═'.repeat(60));
    console.log('CRITICAL INSIGHT:');
    console.log('═'.repeat(60));
    console.log(`
If the "If/Then" table is being deleted, the cause is likely:

1. ❌ The table cells are NOT in getParagraphs() list
   → Deleting body-level paragraphs should NOT affect table content

2. ⚠️  There's an empty paragraph ADJACENT to the table
   → If both are empty, this paragraph gets deleted
   → But this shouldn't delete the table itself

3. ⚠️  The table might be wrapped in a paragraph
   → removeParagraph() might affect table containment
   → Need to check if table is inside a paragraph

RECOMMENDATION:
→ Check which body element index contains the table
→ Check if paragraphs before/after the table are empty
→ These empty paragraphs might be getting deleted
→ The table itself should be safe
    `);

  } catch (error) {
    console.error('ERROR:', error.message);
    console.error(error.stack);
  }
}

debugTableStructure();
