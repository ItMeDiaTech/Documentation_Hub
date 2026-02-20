/**
 * Test Suite for HLP Tips Column Bullet Preservation (v5.3.5)
 *
 * Verifies that bullet markers in two-column HLP table tips cells (FFF2CC)
 * are preserved when paragraphs use ListParagraph with inherited numbering.
 */

import { vi, describe, it, expect, beforeEach, type Mocked } from 'vitest';
import { TableProcessor } from '../TableProcessor';
import { Document, Table, Paragraph, Run, Hyperlink, PreservedElement, TableCell, TableRow, NumberingLevel, WORD_NATIVE_BULLETS } from 'docxmlater';

vi.mock('docxmlater');

// ═══════════════════════════════════════════════════════════
// Mock Factories
// ═══════════════════════════════════════════════════════════

function createMockRun(bold: boolean, characterStyle?: string): Mocked<Run> {
  return {
    getText: vi.fn().mockReturnValue('Text'),
    getFormatting: vi.fn().mockReturnValue({ bold, characterStyle }),
    setFont: vi.fn(),
    setSize: vi.fn(),
    setBold: vi.fn(),
    setColor: vi.fn(),
    setUnderline: vi.fn(),
    setCharacterStyle: vi.fn(),
  } as unknown as Mocked<Run>;
}

function createMockParagraph(style: string): Mocked<Paragraph> {
  return {
    getStyle: vi.fn().mockReturnValue(style),
    setStyle: vi.fn(),
    getText: vi.fn().mockReturnValue('Sample text'),
    getRuns: vi.fn().mockReturnValue([]),
    getNumbering: vi.fn().mockReturnValue(null),
    getContent: vi.fn().mockReturnValue([]),
    setAlignment: vi.fn(),
    setSpaceBefore: vi.fn(),
    setSpaceAfter: vi.fn(),
    setLineSpacing: vi.fn(),
    setNumbering: vi.fn(),
    getLeftIndent: vi.fn().mockReturnValue(undefined),
    setLeftIndent: vi.fn(),
    setFirstLineIndent: vi.fn(),
  } as unknown as Mocked<Paragraph>;
}

function createMockParagraphWithRuns(runs: any[], style = 'Normal'): Mocked<Paragraph> {
  return {
    getStyle: vi.fn().mockReturnValue(style),
    setStyle: vi.fn(),
    getText: vi.fn().mockReturnValue('Sample text'),
    getRuns: vi.fn().mockReturnValue(runs),
    getNumbering: vi.fn().mockReturnValue(null),
    getContent: vi.fn().mockReturnValue(runs),
    setAlignment: vi.fn(),
    setSpaceBefore: vi.fn(),
    setSpaceAfter: vi.fn(),
    setLineSpacing: vi.fn(),
    setNumbering: vi.fn(),
    getLeftIndent: vi.fn().mockReturnValue(undefined),
    setLeftIndent: vi.fn(),
    setFirstLineIndent: vi.fn(),
  } as unknown as Mocked<Paragraph>;
}

function createMockRow(cells: any[]): Mocked<TableRow> {
  return {
    getCells: vi.fn().mockReturnValue(cells),
  } as unknown as Mocked<TableRow>;
}

function createHLPHeaderCell(text = 'High Level Process'): Mocked<TableCell> {
  const mockParagraph = createMockParagraph('Heading2');
  mockParagraph.getText.mockReturnValue(text);
  return {
    getShading: vi.fn().mockReturnValue('FFC000'),
    setShading: vi.fn(),
    setBorders: vi.fn(),
    setMargins: vi.fn(),
    getParagraphs: vi.fn().mockReturnValue([mockParagraph]),
    getFormatting: vi.fn().mockReturnValue({ shading: { fill: 'FFC000' } }),
    getColumnSpan: vi.fn().mockReturnValue(2),
    setAllRunsFont: vi.fn(),
    setAllRunsSize: vi.fn(),
    getText: vi.fn().mockReturnValue(text),
    hasNestedTables: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<TableCell>;
}

/**
 * Create a content (left) cell with a main action item (ListParagraph, no numbering)
 * and a numbered sub-item (numId=33, level=1).
 */
function createContentCell(): Mocked<TableCell> {
  const mainRun = createMockRun(true);
  const mainPara = createMockParagraphWithRuns([mainRun], 'ListParagraph');
  mainPara.getText.mockReturnValue('Verify the member request');
  let mainNumbering: { numId: number; level: number } | null = null;
  mainPara.getNumbering.mockImplementation(() => mainNumbering);
  mainPara.setNumbering.mockImplementation((numId: number, level: number) => {
    mainNumbering = { numId, level };
  });

  const subRun = createMockRun(false);
  const subPara = createMockParagraphWithRuns([subRun], 'ListParagraph');
  subPara.getNumbering.mockReturnValue({ numId: 33, level: 1 });
  subPara.getText.mockReturnValue('Check eligibility');

  return {
    getShading: vi.fn().mockReturnValue('FFFFFF'),
    setShading: vi.fn(),
    setBorders: vi.fn(),
    setMargins: vi.fn(),
    getParagraphs: vi.fn().mockReturnValue([mainPara, subPara]),
    getFormatting: vi.fn().mockReturnValue({ shading: undefined }),
    getColumnSpan: vi.fn().mockReturnValue(1),
    setAllRunsFont: vi.fn(),
    setAllRunsSize: vi.fn(),
    getText: vi.fn().mockReturnValue('Verify the member request\nCheck eligibility'),
    hasNestedTables: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<TableCell>;
}

/**
 * Create a tips (right) cell with ListParagraph paragraphs that have
 * inherited numbering (no explicit numPr) — the scenario that causes
 * bullet stripping without the v5.3.5 fix.
 */
function createTipsCellWithInheritedBullets(texts: string[]): Mocked<TableCell> {
  const paras = texts.map(text => {
    const run = createMockRun(false);
    run.getText.mockReturnValue(text);
    const para = createMockParagraphWithRuns([run], 'ListParagraph');
    para.getText.mockReturnValue(text);
    para.getNumbering.mockReturnValue(null); // Inherited — no explicit numPr
    return para;
  });

  return {
    getShading: vi.fn().mockReturnValue('FFF2CC'),
    setShading: vi.fn(),
    setBorders: vi.fn(),
    setMargins: vi.fn(),
    getParagraphs: vi.fn().mockReturnValue(paras),
    getFormatting: vi.fn().mockReturnValue({ shading: { fill: 'FFF2CC' } }),
    getColumnSpan: vi.fn().mockReturnValue(1),
    setAllRunsFont: vi.fn(),
    setAllRunsSize: vi.fn(),
    getText: vi.fn().mockReturnValue(texts.join('\n')),
    hasNestedTables: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<TableCell>;
}

/**
 * Create a tips cell with already-explicit bullet numbering.
 */
function createTipsCellWithExplicitBullets(texts: string[]): Mocked<TableCell> {
  const paras = texts.map(text => {
    const run = createMockRun(false);
    run.getText.mockReturnValue(text);
    const para = createMockParagraphWithRuns([run], 'ListParagraph');
    para.getText.mockReturnValue(text);
    para.getNumbering.mockReturnValue({ numId: 5, level: 0 }); // Explicit numbering
    return para;
  });

  return {
    getShading: vi.fn().mockReturnValue('FFF2CC'),
    setShading: vi.fn(),
    setBorders: vi.fn(),
    setMargins: vi.fn(),
    getParagraphs: vi.fn().mockReturnValue(paras),
    getFormatting: vi.fn().mockReturnValue({ shading: { fill: 'FFF2CC' } }),
    getColumnSpan: vi.fn().mockReturnValue(1),
    setAllRunsFont: vi.fn(),
    setAllRunsSize: vi.fn(),
    getText: vi.fn().mockReturnValue(texts.join('\n')),
    hasNestedTables: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<TableCell>;
}

function createMockNumberingManager(nextNumId = 50) {
  return {
    createCustomList: vi.fn().mockReturnValue(nextNumId),
    getInstance: vi.fn().mockReturnValue(null),
    getAbstractNumbering: vi.fn().mockReturnValue(null),
  };
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

describe('HLP Tips Column Bullet Preservation', () => {
  let processor: TableProcessor;
  let mockDoc: Mocked<Document>;
  let mockManager: ReturnType<typeof createMockNumberingManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new TableProcessor();
    mockManager = createMockNumberingManager(50);

    mockDoc = {
      getTables: vi.fn().mockReturnValue([]),
      getBodyElements: vi.fn().mockReturnValue([]),
      getNumberingManager: vi.fn().mockReturnValue(mockManager),
    } as unknown as Mocked<Document>;
  });

  it('should assign bullet numbering to tips cell ListParagraph paragraphs with inherited numbering', async () => {
    const tipsTexts = [
      'Ask the member why an additional supply is required',
      'Verify the date of the last order',
    ];
    const contentCell = createContentCell();
    const tipsCell = createTipsCellWithInheritedBullets(tipsTexts);

    const headerCell = createHLPHeaderCell();
    const headerRow = createMockRow([headerCell]);
    const dataRow = createMockRow([contentCell, tipsCell]);
    const table = {
      getRows: vi.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: vi.fn().mockReturnValue(2),
      isFloating: vi.fn().mockReturnValue(false),
      setBorders: vi.fn(),
    } as unknown as Mocked<Table>;

    mockDoc.getTables.mockReturnValue([table]);
    await processor.processHLPTables(mockDoc);

    // createCustomList should have been called for the tips bullet list
    expect(mockManager.createCustomList).toHaveBeenCalled();

    // Each tips paragraph with text should get the tips bullet numId
    const tipsParas = tipsCell.getParagraphs();
    for (const tipPara of tipsParas) {
      expect(tipPara.setStyle).toHaveBeenCalledWith('Normal');
      expect(tipPara.setNumbering).toHaveBeenCalledWith(50, 0);
    }
  });

  it('should NOT assign tips bullet numId to empty tips paragraphs', async () => {
    const tipsTexts = [
      'Ask the member why an additional supply is required',
      '',  // Empty paragraph — should not get numbering
    ];
    const contentCell = createContentCell();
    const tipsCell = createTipsCellWithInheritedBullets(tipsTexts);

    const headerCell = createHLPHeaderCell();
    const headerRow = createMockRow([headerCell]);
    const dataRow = createMockRow([contentCell, tipsCell]);
    const table = {
      getRows: vi.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: vi.fn().mockReturnValue(2),
      isFloating: vi.fn().mockReturnValue(false),
      setBorders: vi.fn(),
    } as unknown as Mocked<Table>;

    mockDoc.getTables.mockReturnValue([table]);
    await processor.processHLPTables(mockDoc);

    const tipsParas = tipsCell.getParagraphs();
    // First paragraph (has text) should get numbering
    expect(tipsParas[0].setNumbering).toHaveBeenCalledWith(50, 0);
    // Second paragraph (empty) should NOT get numbering
    expect(tipsParas[1].setNumbering).not.toHaveBeenCalled();
  });

  it('should NOT assign tips bullet numId to content column paragraphs', async () => {
    const tipsTexts = ['Tip text here'];
    const contentCell = createContentCell();
    const tipsCell = createTipsCellWithInheritedBullets(tipsTexts);

    const headerCell = createHLPHeaderCell();
    const headerRow = createMockRow([headerCell]);
    const dataRow = createMockRow([contentCell, tipsCell]);
    const table = {
      getRows: vi.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: vi.fn().mockReturnValue(2),
      isFloating: vi.fn().mockReturnValue(false),
      setBorders: vi.fn(),
    } as unknown as Mocked<Table>;

    mockDoc.getTables.mockReturnValue([table]);
    await processor.processHLPTables(mockDoc);

    // Content cell main para (ListParagraph, no numbering) should get
    // discoveredNumId=33 (from sub-item), NOT tipsBulletNumId=50
    const contentParas = contentCell.getParagraphs();
    const mainPara = contentParas[0];
    expect(mainPara.setNumbering).toHaveBeenCalledWith(33, 0);
  });

  it('should NOT create tips bullet list for single-column HLP tables', async () => {
    const mainRun = createMockRun(true);
    const mainPara = createMockParagraphWithRuns([mainRun], 'ListParagraph');
    mainPara.getText.mockReturnValue('Action item');
    mainPara.getNumbering.mockReturnValue(null);

    const subRun = createMockRun(false);
    const subPara = createMockParagraphWithRuns([subRun], 'ListParagraph');
    subPara.getNumbering.mockReturnValue({ numId: 33, level: 1 });
    subPara.getText.mockReturnValue('Sub-item');

    const dataCell = {
      getShading: vi.fn().mockReturnValue('FFFFFF'),
      setShading: vi.fn(),
      setBorders: vi.fn(),
      setMargins: vi.fn(),
      getParagraphs: vi.fn().mockReturnValue([mainPara, subPara]),
      getFormatting: vi.fn().mockReturnValue({ shading: undefined }),
      getColumnSpan: vi.fn().mockReturnValue(1),
      setAllRunsFont: vi.fn(),
      setAllRunsSize: vi.fn(),
      getText: vi.fn().mockReturnValue('Action item\nSub-item'),
      hasNestedTables: vi.fn().mockReturnValue(false),
    } as unknown as Mocked<TableCell>;

    const headerCell = createHLPHeaderCell();
    headerCell.getColumnSpan.mockReturnValue(1);
    const headerRow = createMockRow([headerCell]);
    const dataRow = createMockRow([dataCell]);
    const table = {
      getRows: vi.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: vi.fn().mockReturnValue(1),
      isFloating: vi.fn().mockReturnValue(false),
      setBorders: vi.fn(),
    } as unknown as Mocked<Table>;

    mockDoc.getTables.mockReturnValue([table]);
    await processor.processHLPTables(mockDoc);

    // createCustomList should NOT be called for tips bullets in single-column tables.
    // It may still be called for fallback or bullet conversion, but not with "HLP Tips Bullet" label.
    const tipsBulletCalls = mockManager.createCustomList.mock.calls.filter(
      (call: any[]) => call[1] === 'HLP Tips Bullet'
    );
    expect(tipsBulletCalls).toHaveLength(0);
  });

  it('should NOT reassign numbering to tips paragraphs that already have explicit numbering', async () => {
    const tipsTexts = ['Tip with explicit bullets'];
    const contentCell = createContentCell();
    const tipsCell = createTipsCellWithExplicitBullets(tipsTexts);

    const headerCell = createHLPHeaderCell();
    const headerRow = createMockRow([headerCell]);
    const dataRow = createMockRow([contentCell, tipsCell]);
    const table = {
      getRows: vi.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: vi.fn().mockReturnValue(2),
      isFloating: vi.fn().mockReturnValue(false),
      setBorders: vi.fn(),
    } as unknown as Mocked<Table>;

    mockDoc.getTables.mockReturnValue([table]);
    await processor.processHLPTables(mockDoc);

    // Paragraph already has explicit numbering (numId=5), so the
    // ListParagraph→Normal fixup block is NOT entered — style stays,
    // and setNumbering should NOT be called with tips bullet numId
    const tipsParas = tipsCell.getParagraphs();
    expect(tipsParas[0].setStyle).not.toHaveBeenCalledWith('Normal');
    expect(tipsParas[0].setNumbering).not.toHaveBeenCalledWith(50, 0);
  });

  it('should handle multiple data rows with tips bullets', async () => {
    const headerCell = createHLPHeaderCell();
    const headerRow = createMockRow([headerCell]);

    const rows = [headerRow];
    for (let i = 0; i < 3; i++) {
      const contentCell = createContentCell();
      const tipsCell = createTipsCellWithInheritedBullets([
        `Tip row ${i + 1} item A`,
        `Tip row ${i + 1} item B`,
      ]);
      rows.push(createMockRow([contentCell, tipsCell]));
    }

    const table = {
      getRows: vi.fn().mockReturnValue(rows),
      getColumnCount: vi.fn().mockReturnValue(2),
      isFloating: vi.fn().mockReturnValue(false),
      setBorders: vi.fn(),
    } as unknown as Mocked<Table>;

    mockDoc.getTables.mockReturnValue([table]);
    await processor.processHLPTables(mockDoc);

    // All 3 rows × 2 tips paragraphs = 6 tips paragraphs should get numbering
    for (let ri = 1; ri <= 3; ri++) {
      const dataRow = rows[ri];
      const tipsCell = dataRow.getCells()[1];
      const tipsParas = tipsCell.getParagraphs();
      for (const tipPara of tipsParas) {
        expect(tipPara.setNumbering).toHaveBeenCalledWith(50, 0);
      }
    }
  });

  it('should gracefully handle null numbering manager', async () => {
    mockDoc.getNumberingManager = vi.fn().mockReturnValue(null) as any;

    const tipsTexts = ['Tip text'];
    const contentCell = createContentCell();
    const tipsCell = createTipsCellWithInheritedBullets(tipsTexts);

    const headerCell = createHLPHeaderCell();
    const headerRow = createMockRow([headerCell]);
    const dataRow = createMockRow([contentCell, tipsCell]);
    const table = {
      getRows: vi.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: vi.fn().mockReturnValue(2),
      isFloating: vi.fn().mockReturnValue(false),
      setBorders: vi.fn(),
    } as unknown as Mocked<Table>;

    mockDoc.getTables.mockReturnValue([table]);

    // Should not throw — tipsBulletNumId will be 0, so tips paragraphs
    // get style changed to Normal but no numbering assigned
    await expect(processor.processHLPTables(mockDoc)).resolves.not.toThrow();

    const tipsParas = tipsCell.getParagraphs();
    expect(tipsParas[0].setStyle).toHaveBeenCalledWith('Normal');
    expect(tipsParas[0].setNumbering).not.toHaveBeenCalled();
  });

  it('should call createCustomList with bullet format and Symbol font', async () => {
    const tipsTexts = ['Bullet item'];
    const contentCell = createContentCell();
    const tipsCell = createTipsCellWithInheritedBullets(tipsTexts);

    const headerCell = createHLPHeaderCell();
    const headerRow = createMockRow([headerCell]);
    const dataRow = createMockRow([contentCell, tipsCell]);
    const table = {
      getRows: vi.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: vi.fn().mockReturnValue(2),
      isFloating: vi.fn().mockReturnValue(false),
      setBorders: vi.fn(),
    } as unknown as Mocked<Table>;

    mockDoc.getTables.mockReturnValue([table]);
    await processor.processHLPTables(mockDoc);

    // Verify createCustomList was called with a NumberingLevel array and label
    expect(mockManager.createCustomList).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Object)]),
      'HLP Tips Bullet',
    );
  });
});
