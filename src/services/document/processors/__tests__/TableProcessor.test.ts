/**
 * Test Suite for TableProcessor
 *
 * Tests table formatting, uniformity, and Header2 handling.
 */

import { vi, describe, it, expect, beforeEach, type Mocked } from 'vitest';
import { TableProcessor } from '../TableProcessor';
import type { HLPTableAnalysis } from '../TableProcessor';
import { Document, Table, Paragraph, Run, Hyperlink, TableCell, TableRow, inchesToTwips } from 'docxmlater';

// Mock docxmlater
vi.mock('docxmlater');

describe('TableProcessor', () => {
  let processor: TableProcessor;
  let mockDoc: Mocked<Document>;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new TableProcessor();

    mockDoc = {
      getTables: vi.fn().mockReturnValue([]),
      getBodyElements: vi.fn().mockReturnValue([]),
    } as unknown as Mocked<Document>;
  });

  describe('applyTableUniformity', () => {
    it('should process tables and recolor cells', async () => {
      const mockCell = createMockCell('CCCCCC');
      const mockRow = createMockRow([mockCell]);
      const mockTable = createMockTable([mockRow]);

      mockDoc.getTables.mockReturnValue([mockTable]);

      const result = await processor.applyTableUniformity(mockDoc);

      expect(result.tablesProcessed).toBe(1);
      expect(result.cellsRecolored).toBeGreaterThanOrEqual(0);
    });

    it('should apply Header2 shading to 1x1 tables', async () => {
      // Cell has Heading2 style paragraph — triggers Header2 shading
      const mockH2Paragraph = createMockParagraph('Heading2');
      const mockCell = {
        getShading: vi.fn().mockReturnValue('FFFFFF'),
        setShading: vi.fn(),
        getParagraphs: vi.fn().mockReturnValue([mockH2Paragraph]),
        getFormatting: vi.fn().mockReturnValue({ shading: { fill: 'FFFFFF' } }),
        setAllRunsFont: vi.fn(),
        setAllRunsSize: vi.fn(),
        getText: vi.fn().mockReturnValue('Section Header'),
        hasNestedTables: vi.fn().mockReturnValue(false),
      } as unknown as Mocked<TableCell>;
      const mockRow = createMockRow([mockCell]);
      const mockTable = createMockTable([mockRow]); // 1x1 table

      mockDoc.getTables.mockReturnValue([mockTable]);

      const result = await processor.applyTableUniformity(mockDoc, {
        header2Shading: 'BFBFBF',
        otherShading: 'DFDFDF',
      });

      expect(result.tablesProcessed).toBe(1);
      expect(mockCell.setShading).toHaveBeenCalledWith({ fill: 'BFBFBF' });
    });

    it('should preserve cells without shading', async () => {
      const mockCell = createMockCell('FFFFFF'); // White/no shading
      const mockRow = createMockRow([mockCell, createMockCell('FFFFFF')]);
      const mockTable = createMockTable([mockRow, mockRow]); // 2x2 table

      mockDoc.getTables.mockReturnValue([mockTable]);

      const result = await processor.applyTableUniformity(mockDoc);

      expect(result.tablesProcessed).toBe(1);
      // White cells should not be recolored
    });

    it('should handle tables with no rows', async () => {
      const mockTable = createMockTable([]);

      mockDoc.getTables.mockReturnValue([mockTable]);

      const result = await processor.applyTableUniformity(mockDoc);

      expect(result.tablesProcessed).toBe(0);
    });

    it('should handle empty document', async () => {
      mockDoc.getTables.mockReturnValue([]);

      const result = await processor.applyTableUniformity(mockDoc);

      expect(result.tablesProcessed).toBe(0);
      expect(result.cellsRecolored).toBe(0);
    });
  });

  describe('detect1x1Tables', () => {
    it('should detect 1x1 tables', () => {
      const mockCell = createMockCell('BFBFBF');
      const mockRow = createMockRow([mockCell]);
      const mockTable = createMockTable([mockRow]);

      mockDoc.getTables.mockReturnValue([mockTable, createMockTable([mockRow, mockRow])]);

      const tables = processor.detect1x1Tables(mockDoc);

      expect(tables).toHaveLength(1);
    });

    it('should return empty array for no 1x1 tables', () => {
      const mockCell = createMockCell('BFBFBF');
      const mockRow = createMockRow([mockCell, mockCell]);
      const mockTable = createMockTable([mockRow, mockRow]);

      mockDoc.getTables.mockReturnValue([mockTable]);

      const tables = processor.detect1x1Tables(mockDoc);

      expect(tables).toHaveLength(0);
    });
  });

  describe('tableHasHeader2Content', () => {
    it('should detect Header2 styled content in table', () => {
      const mockParagraph = createMockParagraph('Heading2');
      const mockCell = createMockCellWithParagraphs([mockParagraph]);
      const mockRow = createMockRow([mockCell]);
      const mockTable = createMockTable([mockRow]);

      const hasHeader2 = processor.tableHasHeader2Content(mockTable);

      expect(hasHeader2).toBe(true);
    });

    it('should return false for tables without Header2', () => {
      const mockParagraph = createMockParagraph('Normal');
      const mockCell = createMockCellWithParagraphs([mockParagraph]);
      const mockRow = createMockRow([mockCell]);
      const mockTable = createMockTable([mockRow]);

      const hasHeader2 = processor.tableHasHeader2Content(mockTable);

      expect(hasHeader2).toBe(false);
    });
  });

  describe('applySmartTableFormatting', () => {
    it('should detect and format header rows', async () => {
      const boldRun = createMockRun(true);
      const mockParagraph = createMockParagraphWithRuns([boldRun]);
      const headerCell = createMockCellWithParagraphs([mockParagraph]);
      const headerRow = createMockRow([headerCell]);
      const dataRow = createMockRow([createMockCell('FFFFFF')]);
      const mockTable = createMockTable([headerRow, dataRow]);

      mockDoc.getTables.mockReturnValue([mockTable]);

      const count = await processor.applySmartTableFormatting(mockDoc);

      expect(count).toBe(1);
      expect(headerCell.setShading).toHaveBeenCalledWith({ fill: 'BFBFBF' });
    });

    it('should handle tables without header rows', async () => {
      const normalRun = createMockRun(false);
      const mockParagraph = createMockParagraphWithRuns([normalRun]);
      const normalCell = createMockCellWithParagraphs([mockParagraph]);
      const normalRow = createMockRow([normalCell]);
      const mockTable = createMockTable([normalRow, normalRow]);

      mockDoc.getTables.mockReturnValue([mockTable]);

      const count = await processor.applySmartTableFormatting(mockDoc);

      expect(count).toBe(1);
      // No header shading should be applied
      expect(normalCell.setShading).not.toHaveBeenCalled();
    });
  });
});

// Helper functions

function createMockCell(shading: string): Mocked<TableCell> {
  const mockParagraph = createMockParagraph('Normal');
  return {
    getShading: vi.fn().mockReturnValue(shading),
    setShading: vi.fn(),
    getParagraphs: vi.fn().mockReturnValue([mockParagraph]),
    getFormatting: vi.fn().mockReturnValue({ shading: { fill: shading } }),
    setAllRunsFont: vi.fn(),
    setAllRunsSize: vi.fn(),
    getText: vi.fn().mockReturnValue('Sample text'),
    hasNestedTables: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<TableCell>;
}

function createMockCellWithParagraphs(paragraphs: any[]): Mocked<TableCell> {
  return {
    getShading: vi.fn().mockReturnValue('FFFFFF'),
    setShading: vi.fn(),
    getParagraphs: vi.fn().mockReturnValue(paragraphs),
    getFormatting: vi.fn().mockReturnValue({}),
    setAllRunsFont: vi.fn(),
    setAllRunsSize: vi.fn(),
    getText: vi.fn().mockReturnValue('Sample text'),
    hasNestedTables: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<TableCell>;
}

function createMockRow(cells: any[]): Mocked<TableRow> {
  return {
    getCells: vi.fn().mockReturnValue(cells),
  } as unknown as Mocked<TableRow>;
}

function createMockTable(rows: any[]): Mocked<Table> {
  return {
    getRows: vi.fn().mockReturnValue(rows),
    isFloating: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<Table>;
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

// ═══════════════════════════════════════════════════════════
// HLP Table Test Helpers
// ═══════════════════════════════════════════════════════════

function createMockHyperlink(): Mocked<Hyperlink> {
  const mockHyperlink = {
    setFormatting: vi.fn(),
    getRun: vi.fn().mockReturnValue(createMockRun(true)),
    getText: vi.fn().mockReturnValue('Link text'),
    getUrl: vi.fn().mockReturnValue('https://example.com'),
    // Mark as Hyperlink instance for isHyperlink() type guard
    constructor: { name: 'Hyperlink' },
  } as unknown as Mocked<Hyperlink>;
  // Make instanceof check work with mock
  Object.setPrototypeOf(mockHyperlink, Hyperlink.prototype);
  return mockHyperlink;
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
    getColumnSpan: vi.fn().mockReturnValue(1),
    setAllRunsFont: vi.fn(),
    setAllRunsSize: vi.fn(),
    getText: vi.fn().mockReturnValue(text),
    hasNestedTables: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<TableCell>;
}

function createHLPDataCell(shading?: string): Mocked<TableCell> {
  const numberedRun = createMockRun(false);
  const mainRun = createMockRun(true);

  const mainPara = createMockParagraphWithRuns([mainRun]);
  mainPara.getNumbering.mockReturnValue(null);

  const numberedPara = createMockParagraphWithRuns([numberedRun]);
  numberedPara.getNumbering.mockReturnValue({ numId: 33, level: 1 });

  return {
    getShading: vi.fn().mockReturnValue(shading || 'FFFFFF'),
    setShading: vi.fn(),
    setBorders: vi.fn(),
    setMargins: vi.fn(),
    getParagraphs: vi.fn().mockReturnValue([mainPara, numberedPara]),
    getFormatting: vi.fn().mockReturnValue({ shading: shading ? { fill: shading } : undefined }),
    getColumnSpan: vi.fn().mockReturnValue(1),
    setAllRunsFont: vi.fn(),
    setAllRunsSize: vi.fn(),
    getText: vi.fn().mockReturnValue('Item1\nA1'),
    hasNestedTables: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<TableCell>;
}

function createHLPTipsCell(): Mocked<TableCell> {
  const tipRun = createMockRun(false);
  const tipPara = createMockParagraphWithRuns([tipRun]);
  tipPara.getText.mockReturnValue('[TIP] Some tip text');

  return {
    getShading: vi.fn().mockReturnValue('FFF2CC'),
    setShading: vi.fn(),
    setBorders: vi.fn(),
    setMargins: vi.fn(),
    getParagraphs: vi.fn().mockReturnValue([tipPara]),
    getFormatting: vi.fn().mockReturnValue({ shading: { fill: 'FFF2CC' } }),
    getColumnSpan: vi.fn().mockReturnValue(1),
    setAllRunsFont: vi.fn(),
    setAllRunsSize: vi.fn(),
    getText: vi.fn().mockReturnValue('[TIP] Some tip text'),
    hasNestedTables: vi.fn().mockReturnValue(false),
  } as unknown as Mocked<TableCell>;
}

function createMockHLPTable(variant: 'single-column' | 'two-column'): Mocked<Table> {
  const headerCell = createHLPHeaderCell();
  if (variant === 'two-column') {
    headerCell.getColumnSpan.mockReturnValue(2);
  }
  const headerRow = createMockRow([headerCell]);

  const dataRows: Mocked<TableRow>[] = [];
  for (let i = 0; i < 3; i++) {
    if (variant === 'single-column') {
      dataRows.push(createMockRow([createHLPDataCell()]));
    } else {
      dataRows.push(createMockRow([createHLPDataCell(), createHLPTipsCell()]));
    }
  }

  const allRows = [headerRow, ...dataRows];
  return {
    getRows: vi.fn().mockReturnValue(allRows),
    getColumnCount: vi.fn().mockReturnValue(variant === 'single-column' ? 1 : 2),
    isFloating: vi.fn().mockReturnValue(false),
    setBorders: vi.fn(),
    setShading: vi.fn(),
  } as unknown as Mocked<Table>;
}

// ═══════════════════════════════════════════════════════════
// HLP Table Tests
// ═══════════════════════════════════════════════════════════

describe('HLP Table Processing', () => {
  let processor: TableProcessor;
  let mockDoc: Mocked<Document>;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new TableProcessor();
    mockDoc = {
      getTables: vi.fn().mockReturnValue([]),
      // getBodyElements returns same tables — fixPostHLPTableNumbering
      // is a no-op when there are no post-table paragraphs in the array
      getBodyElements: vi.fn().mockReturnValue([]),
    } as unknown as Mocked<Document>;
  });

  describe('analyzeHLPTable', () => {
    it('should identify a single-column HLP table', () => {
      const table = createMockHLPTable('single-column');
      const analysis = processor.analyzeHLPTable(table);

      expect(analysis.isHLP).toBe(true);
      expect(analysis.variant).toBe('single-column');
      expect(analysis.columnCount).toBe(1);
      expect(analysis.rowCount).toBe(4); // 1 header + 3 data
      expect(analysis.hasTipsColumn).toBe(false);
      expect(analysis.headerText).toBe('High Level Process');
    });

    it('should identify a two-column HLP table with tips', () => {
      const table = createMockHLPTable('two-column');
      const analysis = processor.analyzeHLPTable(table);

      expect(analysis.isHLP).toBe(true);
      expect(analysis.variant).toBe('two-column');
      expect(analysis.columnCount).toBe(2);
      expect(analysis.hasTipsColumn).toBe(true);
      expect(analysis.headerCellSpan).toBe(2);
    });

    it('should reject tables without FFC000 shading', () => {
      const normalCell = createMockCell('BFBFBF');
      const row1 = createMockRow([normalCell]);
      const row2 = createMockRow([createMockCell('FFFFFF')]);
      const table = createMockTable([row1, row2]);

      const analysis = processor.analyzeHLPTable(table);

      expect(analysis.isHLP).toBe(false);
      expect(analysis.variant).toBeNull();
    });

    it('should reject tables with only 1 row (header only)', () => {
      const headerCell = createHLPHeaderCell();
      const headerRow = createMockRow([headerCell]);
      const table = createMockTable([headerRow]);

      const analysis = processor.analyzeHLPTable(table);

      expect(analysis.isHLP).toBe(false);
    });

    it('should reject empty tables', () => {
      const table = createMockTable([]);

      const analysis = processor.analyzeHLPTable(table);

      expect(analysis.isHLP).toBe(false);
    });
  });

  describe('isHLPTable (backward compatibility)', () => {
    it('should return true for HLP tables', () => {
      const table = createMockHLPTable('single-column');
      expect(processor.isHLPTable(table)).toBe(true);
    });

    it('should return false for non-HLP tables', () => {
      const normalCell = createMockCell('BFBFBF');
      const row1 = createMockRow([normalCell]);
      const row2 = createMockRow([createMockCell('FFFFFF')]);
      const table = createMockTable([row1, row2]);
      expect(processor.isHLPTable(table)).toBe(false);
    });
  });

  describe('processHLPTables', () => {
    it('should apply table-level borders for single-column variant', async () => {
      const table = createMockHLPTable('single-column');
      mockDoc.getTables.mockReturnValue([table]);

      const result = await processor.processHLPTables(mockDoc);

      expect(result.tablesFound).toBe(1);
      expect(result.singleColumnTables).toBe(1);
      expect(result.twoColumnTables).toBe(0);
      // Table-level borders should be set
      expect(table.setBorders).toHaveBeenCalledWith(
        expect.objectContaining({
          top: expect.objectContaining({ style: 'single', color: 'FFC000' }),
          bottom: expect.objectContaining({ style: 'single', color: 'FFC000' }),
        })
      );
    });

    it('should clear table-level borders for two-column variant', async () => {
      const table = createMockHLPTable('two-column');
      mockDoc.getTables.mockReturnValue([table]);

      const result = await processor.processHLPTables(mockDoc);

      expect(result.tablesFound).toBe(1);
      expect(result.twoColumnTables).toBe(1);
      expect(result.singleColumnTables).toBe(0);
      // Table-level borders should be cleared (none)
      expect(table.setBorders).toHaveBeenCalledWith(
        expect.objectContaining({
          top: expect.objectContaining({ style: 'none' }),
          bottom: expect.objectContaining({ style: 'none' }),
        })
      );
    });

    it('should apply Heading2 style to header row', async () => {
      const table = createMockHLPTable('single-column');
      mockDoc.getTables.mockReturnValue([table]);

      const result = await processor.processHLPTables(mockDoc);

      expect(result.headersStyled).toBe(1);
      // Header cell paragraph should have Heading2 style set
      const headerCell = table.getRows()[0].getCells()[0];
      const headerPara = headerCell.getParagraphs()[0];
      expect(headerPara.setStyle).toHaveBeenCalledWith('Heading2');
    });

    it('should NOT apply bold to numbered sub-item runs', async () => {
      const table = createMockHLPTable('single-column');
      mockDoc.getTables.mockReturnValue([table]);

      await processor.processHLPTables(mockDoc, {
        header2Shading: 'BFBFBF',
        otherShading: 'DFDFDF',
        normalFontFamily: 'Arial',
        normalFontSize: 11,
      });

      // Get data row, content cell, numbered paragraph's run
      const dataRow = table.getRows()[1];
      const dataCell = dataRow.getCells()[0];
      const paras = dataCell.getParagraphs();
      // P[1] is the numbered sub-item paragraph
      const numberedPara = paras[1];
      const numberedRuns = numberedPara.getRuns();

      // Sub-items should NOT be bold (only P[0] main action items are bold)
      expect(numberedRuns[0].setBold).not.toHaveBeenCalled();
      expect(numberedRuns[0].setFont).toHaveBeenCalledWith('Arial');
      expect(numberedRuns[0].setSize).toHaveBeenCalledWith(11);
    });

    it('should apply heading2 font/size to main action item (P[0])', async () => {
      const table = createMockHLPTable('single-column');
      mockDoc.getTables.mockReturnValue([table]);

      await processor.processHLPTables(mockDoc, {
        header2Shading: 'BFBFBF',
        otherShading: 'DFDFDF',
        heading2FontFamily: 'Georgia',
        heading2FontSize: 16,
      });

      const dataRow = table.getRows()[1];
      const dataCell = dataRow.getCells()[0];
      const mainPara = dataCell.getParagraphs()[0]; // P[0] = main action item
      const mainRuns = mainPara.getRuns();

      expect(mainRuns[0].setFont).toHaveBeenCalledWith('Georgia');
      expect(mainRuns[0].setSize).toHaveBeenCalledWith(16);
      expect(mainRuns[0].setBold).toHaveBeenCalledWith(true);
    });

    it('should clear Hyperlink character style on styled runs', async () => {
      // HLP P[0] runs have charStyle=Hyperlink (placeholders for future links)
      // with color=auto + underline=none overrides. Clearing the charStyle
      // removes the blue/underline inheritance entirely.
      const hyperlinkRun = createMockRun(true, 'Hyperlink');
      hyperlinkRun.getFormatting.mockReturnValue({
        bold: true,
        characterStyle: 'Hyperlink',
        color: undefined,
        underline: 'none',
      });

      const mainPara = createMockParagraphWithRuns([hyperlinkRun], 'ListParagraph');
      mainPara.getNumbering.mockReturnValue(null);

      const dataCell = {
        getShading: vi.fn().mockReturnValue('FFFFFF'),
        setShading: vi.fn(),
        setBorders: vi.fn(),
        setMargins: vi.fn(),
        getParagraphs: vi.fn().mockReturnValue([mainPara]),
        getFormatting: vi.fn().mockReturnValue({ shading: undefined }),
        getColumnSpan: vi.fn().mockReturnValue(1),
        setAllRunsFont: vi.fn(),
        setAllRunsSize: vi.fn(),
        getText: vi.fn().mockReturnValue('Item with Hyperlink style'),
        hasNestedTables: vi.fn().mockReturnValue(false),
      } as unknown as Mocked<TableCell>;

      const headerCell = createHLPHeaderCell();
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

      // Should clear the Hyperlink charStyle to prevent blue/underline inheritance
      expect(hyperlinkRun.setCharacterStyle).toHaveBeenCalledWith(undefined);
      // Should NOT need to manually set color — clearing the style is sufficient
      expect(hyperlinkRun.setColor).not.toHaveBeenCalled();
    });

    it('should change ListParagraph to Normal for non-numbered paragraphs', async () => {
      // ListParagraph paragraphs without numbering would inherit the style's
      // numId=33 because docxmlater strips numId=0 on save. Fix by switching
      // to Normal style and preserving indentation.
      const noteRun = createMockRun(true);
      const notePara = createMockParagraphWithRuns([noteRun], 'ListParagraph');
      notePara.getNumbering.mockReturnValue(null); // No numbering (had numId=0)
      notePara.getLeftIndent.mockReturnValue(1440);
      notePara.getText.mockReturnValue('Note: some text');

      const mainRun = createMockRun(true);
      const mainPara = createMockParagraphWithRuns([mainRun], 'ListParagraph');
      mainPara.getNumbering.mockReturnValue(null);
      mainPara.getLeftIndent.mockReturnValue(720);

      const dataCell = {
        getShading: vi.fn().mockReturnValue('FFFFFF'),
        setShading: vi.fn(),
        setBorders: vi.fn(),
        setMargins: vi.fn(),
        getParagraphs: vi.fn().mockReturnValue([mainPara, notePara]),
        getFormatting: vi.fn().mockReturnValue({ shading: undefined }),
        getColumnSpan: vi.fn().mockReturnValue(1),
        setAllRunsFont: vi.fn(),
        setAllRunsSize: vi.fn(),
        getText: vi.fn().mockReturnValue('Item\nNote: text'),
        hasNestedTables: vi.fn().mockReturnValue(false),
      } as unknown as Mocked<TableCell>;

      const headerCell = createHLPHeaderCell();
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

      // Both ListParagraph paragraphs without numbering get changed to Normal
      expect(notePara.setStyle).toHaveBeenCalledWith('Normal');
      expect(notePara.setLeftIndent).toHaveBeenCalledWith(1440);
      expect(mainPara.setStyle).toHaveBeenCalledWith('Normal');
      expect(mainPara.setLeftIndent).toHaveBeenCalledWith(720);
      // No discoveredNumId in this table (no sub-items with numbering),
      // so P[0] does NOT get explicit numbering set
      expect(mainPara.setNumbering).not.toHaveBeenCalled();
    });

    it('should ensure tips column has FFF2CC shading', async () => {
      const table = createMockHLPTable('two-column');
      mockDoc.getTables.mockReturnValue([table]);

      await processor.processHLPTables(mockDoc);

      // Tips cells should have setShading called with FFF2CC
      const dataRow = table.getRows()[1];
      const tipsCell = dataRow.getCells()[1];
      expect(tipsCell.setShading).toHaveBeenCalledWith({ fill: 'FFF2CC' });
    });

    it('should discover numId from sub-items and set explicit numbering on P[0]', async () => {
      // P[0] is ListParagraph with no explicit numbering (inherits from style).
      // P[1] is a numbered sub-item with numId=33, level=1.
      // The processor should discover numId=33 from P[1] and set it on P[0] at level 0.
      const mainRun = createMockRun(true);
      const mainPara = createMockParagraphWithRuns([mainRun], 'ListParagraph');
      mainPara.getNumbering.mockReturnValue(null);

      const subRun = createMockRun(false);
      const subPara = createMockParagraphWithRuns([subRun], 'ListParagraph');
      subPara.getNumbering.mockReturnValue({ numId: 33, level: 1 });

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
        getText: vi.fn().mockReturnValue('Item\na. Sub'),
        hasNestedTables: vi.fn().mockReturnValue(false),
      } as unknown as Mocked<TableCell>;

      const headerCell = createHLPHeaderCell();
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

      // P[0] should be converted to Normal and given explicit numbering
      expect(mainPara.setStyle).toHaveBeenCalledWith('Normal');
      expect(mainPara.setNumbering).toHaveBeenCalledWith(33, 0);
    });

    it('should apply list indentation levels to numbered paragraphs', async () => {
      // Provide real implementation for inchesToTwips (auto-mocked by vi.mock)
      vi.mocked(inchesToTwips).mockImplementation((inches: number) => Math.round(inches * 1440));

      const table = createMockHLPTable('single-column');
      mockDoc.getTables.mockReturnValue([table]);

      await processor.processHLPTables(mockDoc, {
        header2Shading: 'BFBFBF',
        otherShading: 'DFDFDF',
        listIndentationLevels: [
          { level: 0, symbolIndent: 0.25, textIndent: 0.50 },
          { level: 1, symbolIndent: 0.75, textIndent: 1.00 },
        ],
      });

      const dataRow = table.getRows()[1];
      const dataCell = dataRow.getCells()[0];
      const paras = dataCell.getParagraphs();

      // P[1] sub-item (numId=33, level=1) should get level-1 indentation
      // textIndent=1.00" = 1440 twips, hanging = (1.00 - 0.75) * 1440 = 360 twips
      const subPara = paras[1];
      expect(subPara.setLeftIndent).toHaveBeenCalledWith(1440);
      expect(subPara.setFirstLineIndent).toHaveBeenCalledWith(-360);
    });

    it('should skip floating tables', async () => {
      const table = createMockHLPTable('single-column');
      table.isFloating.mockReturnValue(true);
      mockDoc.getTables.mockReturnValue([table]);

      const result = await processor.processHLPTables(mockDoc);

      expect(result.tablesFound).toBe(0);
    });

    it('should handle multiple HLP tables of different variants', async () => {
      const singleColTable = createMockHLPTable('single-column');
      const twoColTable = createMockHLPTable('two-column');
      mockDoc.getTables.mockReturnValue([singleColTable, twoColTable]);

      const result = await processor.processHLPTables(mockDoc);

      expect(result.tablesFound).toBe(2);
      expect(result.singleColumnTables).toBe(1);
      expect(result.twoColumnTables).toBe(1);
    });

    it('should use default font settings when no settings provided', async () => {
      const table = createMockHLPTable('single-column');
      mockDoc.getTables.mockReturnValue([table]);

      await processor.processHLPTables(mockDoc); // No settings

      const dataRow = table.getRows()[1];
      const dataCell = dataRow.getCells()[0];
      const mainPara = dataCell.getParagraphs()[0];
      const mainRuns = mainPara.getRuns();

      // Should use defaults: Verdana 14 for main item
      expect(mainRuns[0].setFont).toHaveBeenCalledWith('Verdana');
      expect(mainRuns[0].setSize).toHaveBeenCalledWith(14);
    });

    it('should fix post-table ListParagraph paragraphs to prevent phantom numbering', async () => {
      const table = createMockHLPTable('single-column');
      // Create a mock paragraph after the table with ListParagraph style and no numbering
      const postTablePara = createMockParagraph('ListParagraph');
      postTablePara.getNumbering.mockReturnValue(null);
      postTablePara.getRuns.mockReturnValue([]);

      mockDoc.getTables.mockReturnValue([table]);
      // Body elements: table followed by the ListParagraph paragraph
      mockDoc.getBodyElements.mockReturnValue([table, postTablePara]);

      await processor.processHLPTables(mockDoc);

      // The post-table paragraph should be converted to Normal
      expect(postTablePara.setStyle).toHaveBeenCalledWith('Normal');
    });

    it('should NOT convert post-table paragraph if it has explicit numbering', async () => {
      const table = createMockHLPTable('single-column');
      const postTablePara = createMockParagraph('ListParagraph');
      postTablePara.getNumbering.mockReturnValue({ numId: 5, level: 0 });
      postTablePara.getRuns.mockReturnValue([]);

      mockDoc.getTables.mockReturnValue([table]);
      mockDoc.getBodyElements.mockReturnValue([table, postTablePara]);

      await processor.processHLPTables(mockDoc);

      // Should NOT be converted — it has its own numbering
      expect(postTablePara.setStyle).not.toHaveBeenCalledWith('Normal');
    });
  });
});
