/**
 * Find Header 2 paragraphs and nearby tables
 * The If/Then table is between 3rd and 4th Header 2
 */

const { Document } = require('docxmlater');

async function findHeadersAndTables() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('FINDING: Header 2 Paragraphs & Tables');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    const doc = await Document.load('Test_Base.docx', { strictParsing: false });

    // Get body elements to see overall structure
    const bodyElements = doc.getBodyElements();
    const paragraphs = doc.getParagraphs();

    console.log(`Total body elements: ${bodyElements.length}`);
    console.log(`Total paragraphs: ${paragraphs.length}\n`);

    // Find Header 2 paragraphs
    console.log('📌 FINDING HEADER 2 PARAGRAPHS:');
    console.log('─'.repeat(60));

    let header2Count = 0;
    const header2Positions = [];

    paragraphs.forEach((para, paraIdx) => {
      try {
        const style = para.getStyle ? para.getStyle() : null;
        const formatting = para.getFormatting ? para.getFormatting() : {};

        if (style === 'Heading2' || style === 'Heading 2' ||
            formatting.style === 'Heading2' || formatting.style === 'Heading 2' ||
            style?.includes('Heading2') || style?.includes('Heading 2')) {
          header2Count++;

          const runs = para.getRuns ? para.getRuns() : [];
          const text = runs.map(r => r.getText ? r.getText() : '').join('');

          console.log(`\nHeader 2 #${header2Count}:`);
          console.log(`  Para index: ${paraIdx}`);
          console.log(`  Style: ${style}`);
          console.log(`  Text: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

          header2Positions.push(paraIdx);
        }
      } catch (e) {
        // ignore
      }
    });

    console.log(`\nTotal Header 2 paragraphs found: ${header2Count}`);

    if (header2Count >= 4) {
      console.log(`\n⚠️  LOOKING FOR TABLE BETWEEN Header 2 #3 AND #4:`);
      console.log('─'.repeat(60));

      const pos3 = header2Positions[2];  // 3rd Header 2 (index 2)
      const pos4 = header2Positions[3];  // 4th Header 2 (index 3)

      console.log(`Header 2 #3 at paragraph index: ${pos3}`);
      console.log(`Header 2 #4 at paragraph index: ${pos4}`);
      console.log(`Paragraphs between them: ${pos4 - pos3 - 1}\n`);

      // Now map paragraphs to body elements to find tables
      console.log('📋 BODY ELEMENTS BETWEEN THESE HEADERS:');
      console.log('─'.repeat(60));

      let paraCounter = 0;
      for (let bodyIdx = 0; bodyIdx < bodyElements.length; bodyIdx++) {
        const element = bodyElements[bodyIdx];

        if (element.constructor.name === 'Paragraph') {
          if (paraCounter >= pos3 && paraCounter <= pos4) {
            const para = paragraphs[paraCounter];
            const runs = para.getRuns ? para.getRuns() : [];
            const text = runs.map(r => r.getText ? r.getText() : '').join('');

            console.log(`[Body ${bodyIdx}] Para ${paraCounter}: "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`);
          }
          paraCounter++;
        } else if (element.constructor.name === 'Table') {
          if (paraCounter >= pos3 && paraCounter <= pos4) {
            console.log(`[Body ${bodyIdx}] *** TABLE FOUND! ***`);

            // Analyze this table in detail
            try {
              const rows = element.getRows ? element.getRows() : [];
              const firstRow = rows[0];
              if (firstRow) {
                const cells = firstRow.getCells ? firstRow.getCells() : [];
                console.log(`    Rows: ${rows.length}, Columns: ${cells.length}`);

                // Try to extract cell content
                rows.forEach((row, rIdx) => {
                  const rowCells = row.getCells ? row.getCells() : [];
                  console.log(`    Row ${rIdx}:`);

                  rowCells.forEach((cell, cIdx) => {
                    try {
                      const cellParas = cell.getParagraphs ? cell.getParagraphs() : [];
                      let cellText = '';

                      cellParas.forEach((cellPara, paraIdx) => {
                        try {
                          const runs = cellPara.getRuns ? cellPara.getRuns() : [];
                          const text = runs
                            .map(r => {
                              try {
                                const t = r.getText ? r.getText() : '';
                                return t;
                              } catch (e) {
                                return '[RUN_ERROR]';
                              }
                            })
                            .join('');
                          cellText += text;
                        } catch (e) {
                          cellText += '[PARA_ERROR]';
                        }
                      });

                      console.log(`      [${cIdx}]: "${cellText.substring(0, 50)}${cellText.length > 50 ? '...' : ''}"`);

                      // Check for If/Then
                      if (cellText.toLowerCase().includes('if') || cellText.toLowerCase().includes('then')) {
                        console.log(`          ✓✓✓ FOUND "If" OR "Then" HERE ✓✓✓`);
                      }
                    } catch (e) {
                      console.log(`      [${cIdx}]: [CELL_ERROR: ${e.message}]`);
                    }
                  });
                });
              }
            } catch (e) {
              console.log(`    ERROR analyzing table: ${e.message}`);
            }
          }
        }
      }
    } else {
      console.log(`⚠️  Only found ${header2Count} Header 2 paragraphs, need 4 to find the table between #3 and #4`);
    }

    // Alternative: check all tables for multi-cell structure
    console.log('\n' + '═'.repeat(60));
    console.log('ALL TABLES - DETAILED STRUCTURE:');
    console.log('═'.repeat(60) + '\n');

    const tables = doc.getTables();
    tables.forEach((table, tableIdx) => {
      try {
        const rows = table.getRows ? table.getRows() : [];
        console.log(`Table ${tableIdx}: ${rows.length} rows`);

        rows.forEach((row, rIdx) => {
          const cells = row.getCells ? row.getCells() : [];
          console.log(`  Row ${rIdx}: ${cells.length} cells`);

          cells.forEach((cell, cIdx) => {
            const cellParas = cell.getParagraphs ? cell.getParagraphs() : [];
            let cellText = '';

            cellParas.forEach(para => {
              try {
                const runs = para.getRuns ? para.getRuns() : [];
                cellText += runs.map(r => r.getText ? r.getText() : '').join('');
              } catch (e) {
                // ignore
              }
            });

            const truncated = cellText.substring(0, 50) + (cellText.length > 50 ? '...' : '');
            console.log(`    [${cIdx}]: "${truncated}"`);
          });
        });
        console.log();
      } catch (e) {
        console.log(`  ERROR: ${e.message}`);
      }
    });

  } catch (error) {
    console.error('FATAL ERROR:', error.message);
    console.error(error.stack);
  }
}

findHeadersAndTables();
