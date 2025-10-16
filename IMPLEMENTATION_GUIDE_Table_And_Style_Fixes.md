# Implementation Guide: Complete Table Uniformity & Normal Style Fix

## Overview
This guide provides detailed implementation steps to complete:
1. **Phase 2**: Table uniformity with all 10+ features
2. **Phase 3**: Fix Normal style to detect and assign heading styles first

## Phase 1: ✅ ALREADY COMPLETE
List formatting is fully implemented with bullet definitions, indentation, and numbering.

---

## Phase 2: Complete Table Uniformity (8 Missing Features)

### Current State
`WordDocumentProcessor.ts` line 3425-3526 - `processTableShading()` method currently only implements:
- ✅ Header row shading
- ✅ Alternating row colors

### What's Missing
1. Border styling
2. Cell padding
3. 1x1 table with Header 2 detection and special formatting
4. Large table conditional formatting (font, size, bold, italic, underline, alignment)
5. If...Then pattern matching
6. Top row formatting
7. Bold application to header rows
8. Alignment application

### Implementation Steps

#### Step 1: Add Helper Methods (Add after line 3560)

```typescript
/**
 * Check if cell has Header 2 style applied
 */
private cellHasHeader2Style(cellArray: any[]): boolean {
  // Look for paragraphs in the cell
  for (const item of cellArray) {
    if (item['w:p']) {
      const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];
      for (const p of paragraphs) {
        const pArray = Array.isArray(p) ? p : [p];
        for (const pItem of pArray) {
          if (pItem['w:pPr']) {
            const pPr = Array.isArray(pItem['w:pPr']) ? pItem['w:pPr'][0] : pItem['w:pPr'];
            const pPrArray = Array.isArray(pPr) ? pPr : [pPr];

            for (const prop of pPrArray) {
              if (prop['w:pStyle']) {
                const pStyle = Array.isArray(prop['w:pStyle']) ? prop['w:pStyle'][0] : prop['w:pStyle'];
                const styleVal = pStyle?.[':@']?.['@_w:val'] || pStyle?.['@_w:val'];
                if (styleVal === 'Heading2' || styleVal === 'Heading 2' || styleVal === 'Header2') {
                  return true;
                }
              }
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * Check if cell contains "If...Then" pattern
 */
private cellContainsIfThenPattern(cellArray: any[]): boolean {
  // Extract text from cell
  let cellText = '';
  for (const item of cellArray) {
    if (item['w:p']) {
      const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];
      for (const p of paragraphs) {
        const pArray = Array.isArray(p) ? p : [p];
        for (const pItem of pArray) {
          if (pItem['w:r']) {
            const runs = Array.isArray(pItem['w:r']) ? pItem['w:r'] : [pItem['w:r']];
            for (const run of runs) {
              const runArray = Array.isArray(run) ? run : [run];
              for (const rItem of runArray) {
                if (rItem['w:t']) {
                  const textItems = Array.isArray(rItem['w:t']) ? rItem['w:t'] : [rItem['w:t']];
                  for (const t of textItems) {
                    const text = typeof t === 'string' ? t : (t['#text'] || '');
                    cellText += text;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Check for "If...Then" pattern (case insensitive)
  return /if\s+.+\s+then/i.test(cellText);
}

/**
 * Apply borders to table properties
 */
private applyTableBorders(tblPrArray: any[], borderStyle: string, borderWidth: number): void {
  // Remove existing borders
  const bordersIndex = tblPrArray.findIndex((el: any) => el['w:tblBorders']);
  if (bordersIndex >= 0) {
    tblPrArray.splice(bordersIndex, 1);
  }

  // Map border style to Word values
  const borderValMap: Record<string, string> = {
    'single': 'single',
    'double': 'double',
    'dashed': 'dashed',
    'dotted': 'dotted'
  };

  const borderVal = borderValMap[borderStyle] || 'single';
  const borderSz = Math.round(borderWidth * 8); // Convert points to eighths of a point

  // Add new borders
  tblPrArray.push({
    'w:tblBorders': [{
      'w:top': [{
        ':@': {
          '@_w:val': borderVal,
          '@_w:sz': borderSz.toString(),
          '@_w:space': '0',
          '@_w:color': 'auto'
        }
      }],
      'w:left': [{
        ':@': {
          '@_w:val': borderVal,
          '@_w:sz': borderSz.toString(),
          '@_w:space': '0',
          '@_w:color': 'auto'
        }
      }],
      'w:bottom': [{
        ':@': {
          '@_w:val': borderVal,
          '@_w:sz': borderSz.toString(),
          '@_w:space': '0',
          '@_w:color': 'auto'
        }
      }],
      'w:right': [{
        ':@': {
          '@_w:val': borderVal,
          '@_w:sz': borderSz.toString(),
          '@_w:space': '0',
          '@_w:color': 'auto'
        }
      }],
      'w:insideH': [{
        ':@': {
          '@_w:val': borderVal,
          '@_w:sz': borderSz.toString(),
          '@_w:space': '0',
          '@_w:color': 'auto'
        }
      }],
      'w:insideV': [{
        ':@': {
          '@_w:val': borderVal,
          '@_w:sz': borderSz.toString(),
          '@_w:space': '0',
          '@_w:color': 'auto'
        }
      }]
    }]
  });

  console.log(`    ✓ Applied ${borderStyle} borders (${borderWidth}pt)`);
}

/**
 * Apply cell padding
 */
private applyTableCellPadding(cellArray: any[], padding: number): void {
  // Find or create w:tcPr (table cell properties)
  let tcPrItem = cellArray.find(el => el['w:tcPr']);
  if (!tcPrItem) {
    tcPrItem = { 'w:tcPr': [] };
    cellArray.unshift(tcPrItem);
  }

  const tcPr = Array.isArray(tcPrItem['w:tcPr']) ? tcPrItem['w:tcPr'] : [tcPrItem['w:tcPr']];
  const tcPrArray = Array.isArray(tcPr[0]) ? tcPr[0] : tcPr;

  // Remove existing cell margins
  const marginIndex = tcPrArray.findIndex((el: any) => el['w:tcMar']);
  if (marginIndex >= 0) {
    tcPrArray.splice(marginIndex, 1);
  }

  // Add cell margins (convert points to twips)
  const paddingTwips = Math.round(padding * 20);
  tcPrArray.push({
    'w:tcMar': [{
      'w:top': [{ ':@': { '@_w:w': paddingTwips.toString(), '@_w:type': 'dxa' } }],
      'w:left': [{ ':@': { '@_w:w': paddingTwips.toString(), '@_w:type': 'dxa' } }],
      'w:bottom': [{ ':@': { '@_w:w': paddingTwips.toString(), '@_w:type': 'dxa' } }],
      'w:right': [{ ':@': { '@_w:w': paddingTwips.toString(), '@_w:type': 'dxa' } }]
    }]
  });
}

/**
 * Apply bold to cell text
 */
private applyTableCellBold(cellArray: any[], bold: boolean): void {
  // Find all runs in cell paragraphs
  for (const item of cellArray) {
    if (item['w:p']) {
      const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];
      for (const p of paragraphs) {
        const pArray = Array.isArray(p) ? p : [p];
        for (const pItem of pArray) {
          if (pItem['w:r']) {
            const runs = Array.isArray(pItem['w:r']) ? pItem['w:r'] : [pItem['w:r']];
            for (const run of runs) {
              const runArray = Array.isArray(run) ? run : [run];
              for (const rItem of runArray) {
                // Find or create w:rPr (run properties)
                let rPrItem = rItem['w:rPr'];
                if (!rPrItem) {
                  rPrItem = [];
                  rItem['w:rPr'] = rPrItem;
                }

                const rPr = Array.isArray(rPrItem) ? rPrItem : [rPrItem];

                // Remove existing bold
                const boldIndex = rPr.findIndex((el: any) => el['w:b']);
                if (boldIndex >= 0) {
                  rPr.splice(boldIndex, 1);
                }

                // Add bold if requested
                if (bold) {
                  rPr.push({ 'w:b': [] });
                }
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Apply alignment to cell
 */
private applyTableCellAlignment(cellArray: any[], alignment: string): void {
  // Find all paragraphs in cell
  for (const item of cellArray) {
    if (item['w:p']) {
      const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];
      for (const p of paragraphs) {
        const pArray = Array.isArray(p) ? p : [p];
        for (const pItem of pArray) {
          // Find or create w:pPr (paragraph properties)
          let pPrItem = pArray.find((el: any) => el['w:pPr']);
          if (!pPrItem) {
            pPrItem = { 'w:pPr': [] };
            pArray.unshift(pPrItem);
          }

          const pPr = Array.isArray(pPrItem['w:pPr']) ? pPrItem['w:pPr'] : [pPrItem['w:pPr']];
          const pPrArray = Array.isArray(pPr[0]) ? pPr[0] : pPr;

          // Remove existing alignment
          const jcIndex = pPrArray.findIndex((el: any) => el['w:jc']);
          if (jcIndex >= 0) {
            pPrArray.splice(jcIndex, 1);
          }

          // Add alignment
          pPrArray.push({
            'w:jc': [{
              ':@': { '@_w:val': alignment }
            }]
          });
        }
      }
    }
  }
}

/**
 * Apply comprehensive cell formatting (font, size, bold, italic, underline, alignment, padding)
 */
private applyTableCellFormatting(cellArray: any[], formatting: {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  alignment?: string;
  cellPadding?: number;
}): void {
  // Apply cell-level properties
  if (formatting.cellPadding) {
    this.applyTableCellPadding(cellArray, formatting.cellPadding);
  }

  if (formatting.alignment) {
    this.applyTableCellAlignment(cellArray, formatting.alignment);
  }

  // Apply run-level formatting to all text
  for (const item of cellArray) {
    if (item['w:p']) {
      const paragraphs = Array.isArray(item['w:p']) ? item['w:p'] : [item['w:p']];
      for (const p of paragraphs) {
        const pArray = Array.isArray(p) ? p : [p];
        for (const pItem of pArray) {
          if (pItem['w:r']) {
            const runs = Array.isArray(pItem['w:r']) ? pItem['w:r'] : [pItem['w:r']];
            for (const run of runs) {
              const runArray = Array.isArray(run) ? run : [run];
              for (const rItem of runArray) {
                // Find or create w:rPr (run properties)
                let rPrItem = rItem['w:rPr'];
                if (!rPrItem) {
                  rPrItem = [];
                  rItem['w:rPr'] = rPrItem;
                }

                const rPr = Array.isArray(rPrItem) ? rPrItem : [rPrItem];

                // Apply font family
                if (formatting.fontFamily) {
                  const fontIndex = rPr.findIndex((el: any) => el['w:rFonts']);
                  if (fontIndex >= 0) {
                    rPr.splice(fontIndex, 1);
                  }
                  rPr.push({
                    'w:rFonts': [{
                      ':@': {
                        '@_w:ascii': formatting.fontFamily,
                        '@_w:hAnsi': formatting.fontFamily
                      }
                    }]
                  });
                }

                // Apply font size (convert to half-points)
                if (formatting.fontSize) {
                  const sizeIndex = rPr.findIndex((el: any) => el['w:sz']);
                  if (sizeIndex >= 0) {
                    rPr.splice(sizeIndex, 1);
                  }
                  const sizeHalfPt = (formatting.fontSize * 2).toString();
                  rPr.push({
                    'w:sz': [{
                      ':@': { '@_w:val': sizeHalfPt }
                    }]
                  });
                }

                // Apply bold
                if (formatting.bold !== undefined) {
                  const boldIndex = rPr.findIndex((el: any) => el['w:b']);
                  if (boldIndex >= 0) {
                    rPr.splice(boldIndex, 1);
                  }
                  if (formatting.bold) {
                    rPr.push({ 'w:b': [] });
                  }
                }

                // Apply italic
                if (formatting.italic !== undefined) {
                  const italicIndex = rPr.findIndex((el: any) => el['w:i']);
                  if (italicIndex >= 0) {
                    rPr.splice(italicIndex, 1);
                  }
                  if (formatting.italic) {
                    rPr.push({ 'w:i': [] });
                  }
                }

                // Apply underline
                if (formatting.underline !== undefined) {
                  const uIndex = rPr.findIndex((el: any) => el['w:u']);
                  if (uIndex >= 0) {
                    rPr.splice(uIndex, 1);
                  }
                  if (formatting.underline) {
                    rPr.push({
                      'w:u': [{
                        ':@': { '@_w:val': 'single' }
                      }]
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

#### Step 2: Replace processTableShading() Method (Lines 3425-3526)

Replace the entire method with:

```typescript
/**
 * Process table shading and uniformity
 * Applies all table formatting: borders, shading, fonts, conditional formatting
 */
private async processTableShading(
  zip: JSZip,
  settings: TableUniformitySettings
): Promise<{ modified: boolean; changes: any[]; tablesProcessed: number }> {
  if (!settings.enabled) {
    return { modified: false, changes: [], tablesProcessed: 0 };
  }

  console.log('\n=== TABLE UNIFORMITY ===');
  console.log('Table settings:', JSON.stringify(settings, null, 2));

  const changes: any[] = [];
  let modified = false;
  let tablesProcessed = 0;

  try {
    // Read document.xml
    const documentXmlFile = zip.file('word/document.xml');
    if (!documentXmlFile) {
      return { modified: false, changes: [], tablesProcessed: 0 };
    }

    const documentXmlContent = await documentXmlFile.async('string');
    const documentData = this.xmlParser.parse(documentXmlContent);

    // Process tables in document
    if (documentData && documentData.length > 1 && documentData[1]['w:document']) {
      const docElement = documentData[1]['w:document'];
      const bodyArray = Array.isArray(docElement) ? docElement : [docElement];
      const bodyItem = bodyArray.find(el => el['w:body']);

      if (bodyItem && bodyItem['w:body']) {
        const body = Array.isArray(bodyItem['w:body']) ? bodyItem['w:body'][0] : bodyItem['w:body'];
        const tables = body['w:tbl'];

        if (tables) {
          const tableArray = Array.isArray(tables) ? tables : [tables];
          console.log(`Found ${tableArray.length} tables to process`);

          for (const table of tableArray) {
            if (Array.isArray(table)) {
              tablesProcessed++;
              console.log(`  Processing table #${tablesProcessed}`);

              // Count rows and columns to determine if 1x1
              const rows = table.filter(el => el['w:tr']);
              const rowCount = rows.length;
              const colCount = rows[0] && rows[0]['w:tr'] ?
                (Array.isArray(rows[0]['w:tr'][0]) ? rows[0]['w:tr'][0] : rows[0]['w:tr'])
                  .filter((el: any) => el['w:tc']).length : 0;

              const is1x1 = rowCount === 1 && colCount === 1;
              console.log(`    Table dimensions: ${rowCount}x${colCount} ${is1x1 ? '(1x1 single cell)' : ''}`);

              // Apply table-level properties (borders)
              if (settings.borderStyle && settings.borderStyle !== 'none') {
                const tblPrItem = table.find(el => el['w:tblPr']);
                if (tblPrItem && tblPrItem['w:tblPr']) {
                  const tblPr = Array.isArray(tblPrItem['w:tblPr']) ? tblPrItem['w:tblPr'] : [tblPrItem['w:tblPr']];
                  const tblPrArray = Array.isArray(tblPr[0]) ? tblPr[0] : tblPr;
                  this.applyTableBorders(tblPrArray, settings.borderStyle, settings.borderWidth);
                  modified = true;
                }
              }

              let rowIndex = 0;
              for (const rowItem of rows) {
                if (rowItem['w:tr']) {
                  const row = Array.isArray(rowItem['w:tr']) ? rowItem['w:tr'] : [rowItem['w:tr']];
                  const rowArray = Array.isArray(row[0]) ? row[0] : row;
                  const cells = rowArray.filter((el: any) => el['w:tc']);

                  for (const cellItem of cells) {
                    if (cellItem['w:tc']) {
                      const cell = Array.isArray(cellItem['w:tc']) ? cellItem['w:tc'] : [cellItem['w:tc']];
                      const cellArray = Array.isArray(cell[0]) ? cell[0] : cell;

                      if (is1x1) {
                        // Single cell table - check for Header 2 style
                        const hasHeader2 = this.cellHasHeader2Style(cellArray);
                        if (hasHeader2) {
                          console.log('    Detected Header 2 in 1x1 table cell');
                          this.applyTableCellShading(cellArray, settings.header2In1x1CellShading);
                          this.applyTableCellAlignment(cellArray, settings.header2In1x1Alignment);
                          modified = true;
                        }
                      } else {
                        // Multi-cell table
                        const isHeaderRow = rowIndex === 0;
                        const isTopRow = rowIndex === 0 && settings.applyToTopRow;
                        const isAlternatingRow = rowIndex > 0 && settings.alternatingRowColors && rowIndex % 2 === 1;
                        const hasIfThenPattern = settings.applyToIfThenPattern && this.cellContainsIfThenPattern(cellArray);

                        // Header row shading
                        if (isHeaderRow && settings.headerRowShaded) {
                          this.applyTableCellShading(cellArray, settings.headerRowShadingColor);
                          modified = true;
                        }

                        // Header row bold
                        if (isHeaderRow && settings.headerRowBold) {
                          this.applyTableCellBold(cellArray, true);
                          modified = true;
                        }

                        // Alternating row colors
                        if (isAlternatingRow) {
                          this.applyTableCellShading(cellArray, '#F0F0F0');
                          modified = true;
                        }

                        // Large table conditional formatting
                        if (hasIfThenPattern || isTopRow) {
                          console.log(`    Applying large table formatting (${hasIfThenPattern ? 'If...Then' : 'top row'})`);
                          this.applyTableCellFormatting(cellArray, settings.largeTableSettings);
                          modified = true;
                        }

                        // Cell padding for all cells
                        if (settings.cellPadding) {
                          this.applyTableCellPadding(cellArray, settings.cellPadding);
                          modified = true;
                        }
                      }
                    }
                  }

                  rowIndex++;
                }
              }
            }
          }
        }
      }
    }

    console.log(`✓ Applied table uniformity to ${tablesProcessed} tables`);

    if (modified) {
      changes.push({
        type: 'table',
        description: `Applied table uniformity to ${tablesProcessed} tables (borders, shading, fonts, conditional formatting)`,
        count: tablesProcessed
      });

      // Save document.xml
      const documentXmlOutput = this.xmlBuilder.build(documentData);
      zip.file('word/document.xml', documentXmlOutput);
      console.log('✓ Saved document.xml with updated table formatting');
    }

    return { modified, changes, tablesProcessed };
  } catch (error: any) {
    console.error('Error processing table uniformity:', error);
    return { modified: false, changes: [], tablesProcessed: 0 };
  }
}
```

---

## Phase 3: Fix Normal Style Override Bug

### Problem
The `assignNormalStyles()` method applies Normal style to all paragraphs without a style ID. It doesn't **detect and assign** Heading1/Heading2 style IDs to heading paragraphs first, so unstyled headings get incorrectly marked as Normal.

### Solution
Add heading detection logic BEFORE applying Normal style.

### Implementation

Find `assignNormalStyles()` method (around line 2339) and add this logic at the beginning of the paragraph processing loop:

```typescript
// Inside the paragraph processing loop, BEFORE checking needsNormalStyle:

// DETECT AND ASSIGN HEADING STYLES FIRST
if (!currentStyle) {
  // Paragraph has no style - check if it should be a heading
  let detectedHeadingStyle: string | null = null;

  // Analyze run properties to detect heading characteristics
  for (const run of runs) {
    if (Array.isArray(run)) {
      const rPrItem = run.find((el: any) => el['w:rPr']);
      if (rPrItem && rPrItem['w:rPr']) {
        const rPr = Array.isArray(rPrItem['w:rPr']) ? rPrItem['w:rPr'][0] : rPrItem['w:rPr'];
        const rPrArray = Array.isArray(rPr) ? rPr : [rPr];

        // Check for font size
        const szItem = rPrArray.find((el: any) => el['w:sz']);
        if (szItem && szItem['w:sz']) {
          const sz = Array.isArray(szItem['w:sz']) ? szItem['w:sz'][0] : szItem['w:sz'];
          const sizeVal = sz?.[':@']?.['@_w:val'] || sz?.['@_w:val'];
          if (sizeVal) {
            const fontSize = parseInt(sizeVal) / 2; // Convert half-points to points

            // Check for bold
            const hasBold = rPrArray.some((el: any) => el['w:b']);

            // Heading detection rules:
            // - 18pt + bold = Heading1
            // - 14pt + bold = Heading2
            if (fontSize >= 17 && fontSize <= 20 && hasBold) {
              detectedHeadingStyle = 'Heading1';
              break;
            } else if (fontSize >= 13 && fontSize <= 15 && hasBold) {
              detectedHeadingStyle = 'Heading2';
              break;
            }
          }
        }
      }
    }
  }

  // If heading detected, assign appropriate style
  if (detectedHeadingStyle) {
    console.log(`  Detected ${detectedHeadingStyle} by formatting - assigning style ID`);

    if (!pPrItem) {
      pPrItem = { 'w:pPr': [] };
      paragraph.unshift(pPrItem);
    }

    const pPrArray = pPrItem['w:pPr'];
    if (Array.isArray(pPrArray)) {
      const pStyleElement = {
        'w:pStyle': [],
        ':@': {
          '@_w:val': detectedHeadingStyle
        }
      };

      const pStyleIdx = pPrArray.findIndex((el: any) => el['w:pStyle'] !== undefined);
      if (pStyleIdx >= 0) {
        pPrArray[pStyleIdx] = pStyleElement;
      } else {
        pPrArray.unshift(pStyleElement);
      }
    }

    // Update currentStyle so it won't get Normal applied
    currentStyle = detectedHeadingStyle;
    modified = true;
    stylesApplied++;

    changes.push({
      type: 'style',
      description: `Detected and assigned ${detectedHeadingStyle} style`,
      before: 'No style',
      after: detectedHeadingStyle
    });
  }
}

// NOW check if Normal style is needed
const isHeading = currentStyle && (currentStyle.toLowerCase().includes('heading') || currentStyle.toLowerCase().includes('header'));
const needsNormalStyle = !isHeading && (!currentStyle || currentStyle !== 'Normal');

// ... rest of existing Normal application logic
```

### Alternative: Simpler Heading Detection

If the above is too complex, use this simpler approach that just skips large/bold text:

```typescript
// Before applying Normal, check if paragraph looks like a heading
let looksLikeHeading = false;

// Check if any run has large font size or bold
for (const run of runs) {
  if (Array.isArray(run)) {
    const rPrItem = run.find((el: any) => el['w:rPr']);
    if (rPrItem && rPrItem['w:rPr']) {
      const rPr = Array.isArray(rPrItem['w:rPr']) ? rPrItem['w:rPr'][0] : rPrItem['w:rPr'];
      const rPrArray = Array.isArray(rPr) ? rPr : [rPr];

      // Check for large font (>13pt) or bold
      const szItem = rPrArray.find((el: any) => el['w:sz']);
      const hasBold = rPrArray.some((el: any) => el['w:b']);

      if (szItem && szItem['w:sz']) {
        const sz = Array.isArray(szItem['w:sz']) ? szItem['w:sz'][0] : szItem['w:sz'];
        const sizeVal = sz?.[':@']?.['@_w:val'] || sz?.['@_w:val'];
        if (sizeVal) {
          const fontSize = parseInt(sizeVal) / 2;
          if (fontSize > 13 && hasBold) {
            looksLikeHeading = true;
            break;
          }
        }
      }
    }
  }
}

// Don't apply Normal to paragraphs that look like headings
const isHeading = currentStyle && (currentStyle.toLowerCase().includes('heading') || currentStyle.toLowerCase().includes('header'));
const needsNormalStyle = !isHeading && !looksLikeHeading && (!currentStyle || currentStyle !== 'Normal');
```

---

## Testing Checklist

After implementing both phases:

### Test Document Requirements
Create a test document with:
- ✅ Bullet lists (3-5 levels)
- ✅ Numbered lists
- ✅ Tables with multiple rows (test header row shading)
- ✅ 1x1 table with Header 2 text inside
- ✅ Table with "If...Then" text in a cell
- ✅ Paragraphs with Header 1 style (18pt bold)
- ✅ Paragraphs with Header 2 style (14pt bold)
- ✅ Paragraphs with Normal style (12pt regular)
- ✅ Unstyled paragraphs with large bold text (should become Heading1/2)
- ✅ Unstyled paragraphs with normal text (should become Normal)

### Expected Console Output
```
=== LIST FORMATTING ===
Creating new bullet list definition: abstractNumId=X, numId=Y
Level 1: •, indent=0pt
Level 2: ○, indent=36pt
...
✓ Applied bullet formatting to N list items

=== TABLE UNIFORMITY ===
Found N tables to process
  Processing table #1
    Table dimensions: 5x3
    ✓ Applied single borders (1pt)
    Applying large table formatting (If...Then)
✓ Applied table uniformity to N tables

=== STYLE PROCESSING ===
Phase 2: Assigning style IDs and clearing direct formatting...
  Detected Heading1 by formatting - assigning style ID
  Detected Heading2 by formatting - assigning style ID
✓ Applied Normal to paragraphs without overriding headings
```

### Document Verification
Open the processed document and verify:
1. Bullet lists have correct characters and indentation
2. Tables have borders, shading, and proper formatting
3. 1x1 table with Header 2 has special shading/alignment
4. Cells with "If...Then" have conditional formatting applied
5. Header 1/2 paragraphs retain their styles (not overridden by Normal)
6. Normal paragraphs have Normal style applied

---

## Notes

- All XML manipulation uses the `preserveOrder: true` format from fast-xml-parser
- Cell/row/paragraph structures are always arrays in this format
- Use `':@'` for attributes (e.g., `':@': { '@_w:val': 'value' }`)
- Convert measurements: points × 20 = twips, points × 2 = half-points
- Test incrementally: implement Phase 2, test, then Phase 3, test again

---

## File Locations
- **Main file**: `src/services/document/WordDocumentProcessor.ts`
- **Helper methods**: Add after line 3560 (after `applyTableCellShading`)
- **Method to replace**: Lines 3425-3526 (`processTableShading`)
- **Method to modify**: Around line 2339 (`assignNormalStyles`)
