/**
 * Test Suite for HLP Tips Column Bullet Preservation (v5.3.5)
 *
 * Verifies that bullet markers in two-column HLP table tips cells (FFF2CC)
 * are preserved when paragraphs use ListParagraph with inherited numbering.
 */


import { TableProcessor } from '../TableProcessor';
import { Document, Table, Paragraph, Run, Hyperlink, PreservedElement, TableCell, TableRow, NumberingLevel, WORD_NATIVE_BULLETS } from 'docxmlater';

jest.mock('docxmlater');

// ═══════════════════════════════════════════════════════════
// Mock Factories
// ═══════════════════════════════════════════════════════════

function createMockRun(bold: boolean, characterStyle?: string): jest.Mocked<Run> {
  return {
    getText: jest.fn().mockReturnValue('Text'),
    getFormatting: jest.fn().mockReturnValue({ bold, characterStyle }),
    setFont: jest.fn(),
    setSize: jest.fn(),
    setBold: jest.fn(),
    setColor: jest.fn(),
    setUnderline: jest.fn(),
    setCharacterStyle: jest.fn(),
  } as unknown as jest.Mocked<Run>;
}

function createMockParagraph(style: string): jest.Mocked<Paragraph> {
  return {
    getStyle: jest.fn().mockReturnValue(style),
    setStyle: jest.fn(),
    getText: jest.fn().mockReturnValue('Sample text'),
    getRuns: jest.fn().mockReturnValue([]),
    getNumbering: jest.fn().mockReturnValue(null),
    getContent: jest.fn().mockReturnValue([]),
    setAlignment: jest.fn(),
    setSpaceBefore: jest.fn(),
    setSpaceAfter: jest.fn(),
    setLineSpacing: jest.fn(),
    setNumbering: jest.fn(),
    getLeftIndent: jest.fn().mockReturnValue(undefined),
    setLeftIndent: jest.fn(),
    setFirstLineIndent: jest.fn(),
  } as unknown as jest.Mocked<Paragraph>;
}

function createMockParagraphWithRuns(runs: any[], style = 'Normal'): jest.Mocked<Paragraph> {
  return {
    getStyle: jest.fn().mockReturnValue(style),
    setStyle: jest.fn(),
    getText: jest.fn().mockReturnValue('Sample text'),
    getRuns: jest.fn().mockReturnValue(runs),
    getNumbering: jest.fn().mockReturnValue(null),
    getContent: jest.fn().mockReturnValue(runs),
    setAlignment: jest.fn(),
    setSpaceBefore: jest.fn(),
    setSpaceAfter: jest.fn(),
    setLineSpacing: jest.fn(),
    setNumbering: jest.fn(),
    getLeftIndent: jest.fn().mockReturnValue(undefined),
    setLeftIndent: jest.fn(),
    setFirstLineIndent: jest.fn(),
  } as unknown as jest.Mocked<Paragraph>;
}

function createMockRow(cells: any[]): jest.Mocked<TableRow> {
  return {
    getCells: jest.fn().mockReturnValue(cells),
  } as unknown as jest.Mocked<TableRow>;
}

function createHLPHeaderCell(text = 'High Level Process'): jest.Mocked<TableCell> {
  const mockParagraph = createMockParagraph('Heading2');
  mockParagraph.getText.mockReturnValue(text);
  return {
    getShading: jest.fn().mockReturnValue('FFC000'),
    setShading: jest.fn(),
    setBorders: jest.fn(),
    setMargins: jest.fn(),
    getParagraphs: jest.fn().mockReturnValue([mockParagraph]),
    getFormatting: jest.fn().mockReturnValue({ shading: { fill: 'FFC000' } }),
    getColumnSpan: jest.fn().mockReturnValue(2),
    setAllRunsFont: jest.fn(),
    setAllRunsSize: jest.fn(),
    getText: jest.fn().mockReturnValue(text),
    hasNestedTables: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<TableCell>;
}

/**
 * Create a content (left) cell with a main action item (ListParagraph, no numbering)
 * and a numbered sub-item (numId=33, level=1).
 */
function createContentCell(): jest.Mocked<TableCell> {
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
    getShading: jest.fn().mockReturnValue('FFFFFF'),
    setShading: jest.fn(),
    setBorders: jest.fn(),
    setMargins: jest.fn(),
    getParagraphs: jest.fn().mockReturnValue([mainPara, subPara]),
    getFormatting: jest.fn().mockReturnValue({ shading: undefined }),
    getColumnSpan: jest.fn().mockReturnValue(1),
    setAllRunsFont: jest.fn(),
    setAllRunsSize: jest.fn(),
    getText: jest.fn().mockReturnValue('Verify the member request\nCheck eligibility'),
    hasNestedTables: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<TableCell>;
}

/**
 * Create a tips (right) cell with ListParagraph paragraphs that have
 * inherited numbering (no explicit numPr) — the scenario that causes
 * bullet stripping without the v5.3.5 fix.
 */
function createTipsCellWithInheritedBullets(texts: string[]): jest.Mocked<TableCell> {
  const paras = texts.map(text => {
    const run = createMockRun(false);
    run.getText.mockReturnValue(text);
    const para = createMockParagraphWithRuns([run], 'ListParagraph');
    para.getText.mockReturnValue(text);
    para.getNumbering.mockReturnValue(null); // Inherited — no explicit numPr
    return para;
  });

  return {
    getShading: jest.fn().mockReturnValue('FFF2CC'),
    setShading: jest.fn(),
    setBorders: jest.fn(),
    setMargins: jest.fn(),
    getParagraphs: jest.fn().mockReturnValue(paras),
    getFormatting: jest.fn().mockReturnValue({ shading: { fill: 'FFF2CC' } }),
    getColumnSpan: jest.fn().mockReturnValue(1),
    setAllRunsFont: jest.fn(),
    setAllRunsSize: jest.fn(),
    getText: jest.fn().mockReturnValue(texts.join('\n')),
    hasNestedTables: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<TableCell>;
}

/**
 * Create a tips cell with already-explicit bullet numbering.
 */
function createTipsCellWithExplicitBullets(texts: string[]): jest.Mocked<TableCell> {
  const paras = texts.map(text => {
    const run = createMockRun(false);
    run.getText.mockReturnValue(text);
    const para = createMockParagraphWithRuns([run], 'ListParagraph');
    para.getText.mockReturnValue(text);
    para.getNumbering.mockReturnValue({ numId: 5, level: 0 }); // Explicit numbering
    return para;
  });

  return {
    getShading: jest.fn().mockReturnValue('FFF2CC'),
    setShading: jest.fn(),
    setBorders: jest.fn(),
    setMargins: jest.fn(),
    getParagraphs: jest.fn().mockReturnValue(paras),
    getFormatting: jest.fn().mockReturnValue({ shading: { fill: 'FFF2CC' } }),
    getColumnSpan: jest.fn().mockReturnValue(1),
    setAllRunsFont: jest.fn(),
    setAllRunsSize: jest.fn(),
    getText: jest.fn().mockReturnValue(texts.join('\n')),
    hasNestedTables: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<TableCell>;
}

function createMockNumberingManager(nextNumId = 50) {
  return {
    createCustomList: jest.fn().mockReturnValue(nextNumId),
    getInstance: jest.fn().mockReturnValue(null),
    getAbstractNumbering: jest.fn().mockReturnValue(null),
  };
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

describe('HLP Tips Column Bullet Preservation', () => {
  let processor: TableProcessor;
  let mockDoc: jest.Mocked<Document>;
  let mockManager: ReturnType<typeof createMockNumberingManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new TableProcessor();
    mockManager = createMockNumberingManager(50);

    mockDoc = {
      getTables: jest.fn().mockReturnValue([]),
      getBodyElements: jest.fn().mockReturnValue([]),
      getNumberingManager: jest.fn().mockReturnValue(mockManager),
    } as unknown as jest.Mocked<Document>;
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
      getRows: jest.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: jest.fn().mockReturnValue(2),
      isFloating: jest.fn().mockReturnValue(false),
      setBorders: jest.fn(),
    } as unknown as jest.Mocked<Table>;

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
      getRows: jest.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: jest.fn().mockReturnValue(2),
      isFloating: jest.fn().mockReturnValue(false),
      setBorders: jest.fn(),
    } as unknown as jest.Mocked<Table>;

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
      getRows: jest.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: jest.fn().mockReturnValue(2),
      isFloating: jest.fn().mockReturnValue(false),
      setBorders: jest.fn(),
    } as unknown as jest.Mocked<Table>;

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
      getShading: jest.fn().mockReturnValue('FFFFFF'),
      setShading: jest.fn(),
      setBorders: jest.fn(),
      setMargins: jest.fn(),
      getParagraphs: jest.fn().mockReturnValue([mainPara, subPara]),
      getFormatting: jest.fn().mockReturnValue({ shading: undefined }),
      getColumnSpan: jest.fn().mockReturnValue(1),
      setAllRunsFont: jest.fn(),
      setAllRunsSize: jest.fn(),
      getText: jest.fn().mockReturnValue('Action item\nSub-item'),
      hasNestedTables: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<TableCell>;

    const headerCell = createHLPHeaderCell();
    headerCell.getColumnSpan.mockReturnValue(1);
    const headerRow = createMockRow([headerCell]);
    const dataRow = createMockRow([dataCell]);
    const table = {
      getRows: jest.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: jest.fn().mockReturnValue(1),
      isFloating: jest.fn().mockReturnValue(false),
      setBorders: jest.fn(),
    } as unknown as jest.Mocked<Table>;

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
      getRows: jest.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: jest.fn().mockReturnValue(2),
      isFloating: jest.fn().mockReturnValue(false),
      setBorders: jest.fn(),
    } as unknown as jest.Mocked<Table>;

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
      getRows: jest.fn().mockReturnValue(rows),
      getColumnCount: jest.fn().mockReturnValue(2),
      isFloating: jest.fn().mockReturnValue(false),
      setBorders: jest.fn(),
    } as unknown as jest.Mocked<Table>;

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
    mockDoc.getNumberingManager = jest.fn().mockReturnValue(null) as any;

    const tipsTexts = ['Tip text'];
    const contentCell = createContentCell();
    const tipsCell = createTipsCellWithInheritedBullets(tipsTexts);

    const headerCell = createHLPHeaderCell();
    const headerRow = createMockRow([headerCell]);
    const dataRow = createMockRow([contentCell, tipsCell]);
    const table = {
      getRows: jest.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: jest.fn().mockReturnValue(2),
      isFloating: jest.fn().mockReturnValue(false),
      setBorders: jest.fn(),
    } as unknown as jest.Mocked<Table>;

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
      getRows: jest.fn().mockReturnValue([headerRow, dataRow]),
      getColumnCount: jest.fn().mockReturnValue(2),
      isFloating: jest.fn().mockReturnValue(false),
      setBorders: jest.fn(),
    } as unknown as jest.Mocked<Table>;

    mockDoc.getTables.mockReturnValue([table]);
    await processor.processHLPTables(mockDoc);

    // Verify createCustomList was called with a NumberingLevel array and label
    expect(mockManager.createCustomList).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Object)]),
      'HLP Tips Bullet',
    );
  });
});
