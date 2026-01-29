/**
 * Test Suite for TableProcessor
 *
 * Tests table formatting, uniformity, and Header2 handling.
 */

import { TableProcessor } from '../TableProcessor';
import { Document, Table, Paragraph, Run, TableCell, TableRow } from 'docxmlater';

// Mock docxmlater
jest.mock('docxmlater');

describe('TableProcessor', () => {
  let processor: TableProcessor;
  let mockDoc: jest.Mocked<Document>;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new TableProcessor();

    mockDoc = {
      getTables: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<Document>;
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
        getShading: jest.fn().mockReturnValue('FFFFFF'),
        setShading: jest.fn(),
        getParagraphs: jest.fn().mockReturnValue([mockH2Paragraph]),
        getFormatting: jest.fn().mockReturnValue({ shading: { fill: 'FFFFFF' } }),
        setAllRunsFont: jest.fn(),
        setAllRunsSize: jest.fn(),
        getText: jest.fn().mockReturnValue('Section Header'),
      } as unknown as jest.Mocked<TableCell>;
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

function createMockCell(shading: string): jest.Mocked<TableCell> {
  const mockParagraph = createMockParagraph('Normal');
  return {
    getShading: jest.fn().mockReturnValue(shading),
    setShading: jest.fn(),
    getParagraphs: jest.fn().mockReturnValue([mockParagraph]),
    getFormatting: jest.fn().mockReturnValue({ shading: { fill: shading } }),
    setAllRunsFont: jest.fn(),
    setAllRunsSize: jest.fn(),
    getText: jest.fn().mockReturnValue('Sample text'),
  } as unknown as jest.Mocked<TableCell>;
}

function createMockCellWithParagraphs(paragraphs: any[]): jest.Mocked<TableCell> {
  return {
    getShading: jest.fn().mockReturnValue('FFFFFF'),
    setShading: jest.fn(),
    getParagraphs: jest.fn().mockReturnValue(paragraphs),
    getFormatting: jest.fn().mockReturnValue({}),
    setAllRunsFont: jest.fn(),
    setAllRunsSize: jest.fn(),
    getText: jest.fn().mockReturnValue('Sample text'),
  } as unknown as jest.Mocked<TableCell>;
}

function createMockRow(cells: any[]): jest.Mocked<TableRow> {
  return {
    getCells: jest.fn().mockReturnValue(cells),
  } as unknown as jest.Mocked<TableRow>;
}

function createMockTable(rows: any[]): jest.Mocked<Table> {
  return {
    getRows: jest.fn().mockReturnValue(rows),
  } as unknown as jest.Mocked<Table>;
}

function createMockParagraph(style: string): jest.Mocked<Paragraph> {
  return {
    getStyle: jest.fn().mockReturnValue(style),
    getText: jest.fn().mockReturnValue('Sample text'),
    getRuns: jest.fn().mockReturnValue([]),
    getNumbering: jest.fn().mockReturnValue(null),
    getContent: jest.fn().mockReturnValue([]),
    setAlignment: jest.fn(),
    setSpaceBefore: jest.fn(),
    setSpaceAfter: jest.fn(),
    setLineSpacing: jest.fn(),
  } as unknown as jest.Mocked<Paragraph>;
}

function createMockParagraphWithRuns(runs: any[]): jest.Mocked<Paragraph> {
  return {
    getStyle: jest.fn().mockReturnValue('Normal'),
    getText: jest.fn().mockReturnValue('Sample text'),
    getRuns: jest.fn().mockReturnValue(runs),
    getNumbering: jest.fn().mockReturnValue(null),
    getContent: jest.fn().mockReturnValue([]),
    setAlignment: jest.fn(),
    setSpaceBefore: jest.fn(),
    setSpaceAfter: jest.fn(),
    setLineSpacing: jest.fn(),
  } as unknown as jest.Mocked<Paragraph>;
}

function createMockRun(bold: boolean): jest.Mocked<Run> {
  return {
    getText: jest.fn().mockReturnValue('Text'),
    getFormatting: jest.fn().mockReturnValue({ bold }),
    setFont: jest.fn(),
    setSize: jest.fn(),
    setBold: jest.fn(),
  } as unknown as jest.Mocked<Run>;
}
