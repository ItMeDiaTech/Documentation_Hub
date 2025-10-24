/**
 * Detailed Table Debugging Script
 * Looking deep into cells for "If/Then" content
 */

const { Document } = require('docxmlater');

async function deepTableDebug() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DEEP TABLE DEBUG: Finding "If/Then" Table');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    const doc = await Document.load('Test_Base.docx', { strictParsing: false });

    const tables = doc.getTables();
    console.log(`Total tables found: ${tables.length}\n`);

    // Examine EVERY table in detail
    tables.forEach((table, tableIdx) => {
      console.log(`${'─'.repeat(60)}`);
      console.log(`TABLE ${tableIdx}`);
      console.log(`${'─'.repeat(60)}`);

      try {
        const rows = table.getRows ? table.getRows() : [];
        console.log(`Rows: ${rows.length}`);

        if (rows.length === 0) {
          console.log('⚠️  No rows found\n');
          return;
        }

        rows.forEach((row, rowIdx) => {
          console.log(`\n  ROW ${rowIdx}:`);

          try {
            const cells = row.getCells ? row.getCells() : [];
            console.log(`    Cells: ${cells.length}`);

            cells.forEach((cell, colIdx) => {
              console.log(`\n    CELL [${rowIdx},${colIdx}]:`);

              try {
                // Get paragraphs in cell
                const cellParas = cell.getParagraphs ? cell.getParagraphs() : [];
                console.log(`      Paragraphs in cell: ${cellParas.length}`);

                // Extract text from all paragraphs
                const cellTexts = cellParas.map((para, paraIdx) => {
                  try {
                    const runs = para.getRuns ? para.getRuns() : [];
                    const text = runs.map(r => {
                      try {
                        return r.getText ? r.getText() : '[NO_TEXT_METHOD]';
                      } catch (e) {
                        return '[RUN_ERROR]';
                      }
                    }).join('');

                    console.log(`        Para ${paraIdx}: "${text}" (${runs.length} runs)`);
                    return text;
                  } catch (e) {
                    console.log(`        Para ${paraIdx}: [EXTRACTION_ERROR: ${e.message}]`);
                    return '[PARA_ERROR]';
                  }
                });

                const fullText = cellTexts.join(' | ');
                console.log(`\n      FULL CELL TEXT: "${fullText}"`);

                // Check for If/Then in various forms
                const hasIf = fullText.toLowerCase().includes('if');
                const hasThen = fullText.toLowerCase().includes('then');
                const hasIfExact = /\bif\b/i.test(fullText);
                const hasThenExact = /\bthen\b/i.test(fullText);

                if (hasIf || hasThen || hasIfExact || hasThenExact) {
                  console.log(`      ✓✓✓ FOUND "If" or "Then" ✓✓✓`);
                  console.log(`          hasIf: ${hasIf}, hasThen: ${hasThen}`);
                  console.log(`          hasIfExact: ${hasIfExact}, hasThenExact: ${hasThenExact}`);
                }

                // Check cell content items
                try {
                  const content = cell.getContent ? cell.getContent() : [];
                  if (content.length > 0) {
                    console.log(`      Cell content items: ${content.length}`);
                    content.forEach((item, itemIdx) => {
                      console.log(`        [${itemIdx}] ${item.constructor.name}`);
                    });
                  }
                } catch (e) {
                  console.log(`      [Error getting cell content: ${e.message}]`);
                }

              } catch (cellError) {
                console.log(`      ERROR processing cell: ${cellError.message}`);
              }
            });
          } catch (rowError) {
            console.log(`    ERROR processing row: ${rowError.message}`);
          }
        });

      } catch (tableError) {
        console.log(`ERROR processing table: ${tableError.message}`);
      }

      console.log();
    });

    // Also check body elements directly
    console.log('\n' + '═'.repeat(60));
    console.log('CHECKING BODY ELEMENTS DIRECTLY');
    console.log('═'.repeat(60) + '\n');

    const bodyElements = doc.getBodyElements();
    bodyElements.forEach((element, idx) => {
      if (element.constructor.name === 'Table') {
        console.log(`[${idx}] TABLE`);

        try {
          // Try to access table properties directly
          const rows = element.getRows ? element.getRows() : [];
          console.log(`    → getRows() returned ${rows.length} rows`);

          // Try alternative access patterns
          if (element._rows) {
            console.log(`    → _rows property exists (${element._rows.length} items)`);
          }
          if (element.rows) {
            console.log(`    → rows property exists (${element.rows.length} items)`);
          }

          // Dump all cell text
          let hasIfThen = false;
          rows.forEach((row, rIdx) => {
            const cells = row.getCells ? row.getCells() : [];
            cells.forEach((cell, cIdx) => {
              const cellParas = cell.getParagraphs ? cell.getParagraphs() : [];
              const cellText = cellParas
                .map(p => {
                  const runs = p.getRuns ? p.getRuns() : [];
                  return runs.map(r => r.getText ? r.getText() : '').join('');
                })
                .join(' ');

              const trimmed = cellText.trim();
              if (trimmed) {
                console.log(`    [${rIdx},${cIdx}]: "${trimmed}"`);

                if (trimmed.toLowerCase().includes('if') || trimmed.toLowerCase().includes('then')) {
                  console.log(`        ✓✓✓ FOUND MATCHING CONTENT ✓✓✓`);
                  hasIfThen = true;
                }
              }
            });
          });

        } catch (e) {
          console.log(`    ERROR: ${e.message}`);
        }
      }
    });

    console.log('\n' + '═'.repeat(60));
    console.log('SEARCH COMPLETE');
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('FATAL ERROR:', error.message);
    console.error(error.stack);
  }
}

deepTableDebug();
