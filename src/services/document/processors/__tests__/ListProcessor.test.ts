/**
 * Test Suite for ListProcessor
 *
 * Tests list bullet settings, indentation, and numbered list formatting.
 */

import { vi, describe, it, expect, beforeEach, type Mocked } from 'vitest';
import { ListProcessor, ListBulletSettings } from '../ListProcessor';
import { Document, Paragraph } from 'docxmlater';

// Mock docxmlater
vi.mock('docxmlater');

describe('ListProcessor', () => {
  let processor: ListProcessor;
  let mockDoc: Mocked<Document>;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new ListProcessor();

    mockDoc = {
      getAllParagraphs: vi.fn().mockReturnValue([]),
      getPart: vi.fn().mockResolvedValue(null),
      setPart: vi.fn().mockResolvedValue(undefined),
      getNumberingManager: vi.fn().mockReturnValue(null),
    } as unknown as Mocked<Document>;
  });

  describe('applyListIndentation', () => {
    it('should apply indentation to list items', async () => {
      const mockParagraph = createMockListParagraph(0, 1);
      mockDoc.getAllParagraphs.mockReturnValue([mockParagraph]);

      const settings: ListBulletSettings = {
        enabled: true,
        indentationLevels: [
          { level: 0, symbolIndent: 0.5, textIndent: 0.75 },
          { level: 1, symbolIndent: 1.0, textIndent: 1.25 },
        ],
        spacingBetweenItems: 6,
      };

      const result = await processor.applyListIndentation(mockDoc, settings);

      expect(result.listsUpdated).toBe(1);
      expect(mockParagraph.setLeftIndent).toHaveBeenCalled();
      expect(mockParagraph.setSpaceAfter).toHaveBeenCalledWith(120); // 6 * 20 twips
    });

    it('should skip non-list paragraphs', async () => {
      const mockParagraph = createMockNormalParagraph();
      mockDoc.getAllParagraphs.mockReturnValue([mockParagraph]);

      const settings: ListBulletSettings = {
        enabled: true,
        indentationLevels: [{ level: 0, symbolIndent: 0.5, textIndent: 0.75 }],
        spacingBetweenItems: 0,
      };

      const result = await processor.applyListIndentation(mockDoc, settings);

      expect(result.listsUpdated).toBe(0);
      expect(mockParagraph.setLeftIndent).not.toHaveBeenCalled();
    });

    it('should return zero counts when disabled', async () => {
      const settings: ListBulletSettings = {
        enabled: false,
        indentationLevels: [],
        spacingBetweenItems: 0,
      };

      const result = await processor.applyListIndentation(mockDoc, settings);

      expect(result.listsUpdated).toBe(0);
      expect(result.levelsProcessed).toBe(0);
    });

    it('should handle multiple list levels', async () => {
      const level0Para = createMockListParagraph(0, 1);
      const level1Para = createMockListParagraph(1, 1);
      const level2Para = createMockListParagraph(2, 1);

      mockDoc.getAllParagraphs.mockReturnValue([level0Para, level1Para, level2Para]);

      const settings: ListBulletSettings = {
        enabled: true,
        indentationLevels: [
          { level: 0, symbolIndent: 0.5, textIndent: 0.75 },
          { level: 1, symbolIndent: 1.0, textIndent: 1.25 },
          { level: 2, symbolIndent: 1.5, textIndent: 1.75 },
        ],
        spacingBetweenItems: 0,
      };

      const result = await processor.applyListIndentation(mockDoc, settings);

      expect(result.listsUpdated).toBe(3);
      expect(level0Para.setLeftIndent).toHaveBeenCalled();
      expect(level1Para.setLeftIndent).toHaveBeenCalled();
      expect(level2Para.setLeftIndent).toHaveBeenCalled();
    });
  });

  describe('standardizeListPrefixFormatting', () => {
    it('should standardize list prefix formatting to Verdana', async () => {
      const mockLevel = createMockNumberingLevel('Arial');
      const mockAbstractNum = {
        getLevel: vi.fn((idx: number) => (idx === 0 ? mockLevel : null)),
      };
      const mockNumberingManager = {
        getAllAbstractNumberings: vi.fn().mockReturnValue([mockAbstractNum]),
      };
      mockDoc.getNumberingManager = vi.fn().mockReturnValue(mockNumberingManager);

      const count = await processor.standardizeListPrefixFormatting(mockDoc);

      expect(count).toBe(1);
      expect(mockLevel.setFont).toHaveBeenCalledWith('Verdana');
      expect(mockLevel.setColor).toHaveBeenCalledWith('000000');
      expect(mockLevel.setFontSize).toHaveBeenCalledWith(24);
      expect(mockLevel.setBold).toHaveBeenCalledWith(false);
    });

    it('should handle missing numbering manager', async () => {
      mockDoc.getNumberingManager = vi.fn().mockReturnValue(null);

      const count = await processor.standardizeListPrefixFormatting(mockDoc);

      expect(count).toBe(0);
    });

    it('should preserve special bullet fonts', async () => {
      const mockLevel = createMockNumberingLevel('Symbol');
      const mockAbstractNum = {
        getLevel: vi.fn((idx: number) => (idx === 0 ? mockLevel : null)),
      };
      const mockNumberingManager = {
        getAllAbstractNumberings: vi.fn().mockReturnValue([mockAbstractNum]),
      };
      mockDoc.getNumberingManager = vi.fn().mockReturnValue(mockNumberingManager);

      await processor.standardizeListPrefixFormatting(mockDoc);

      // Symbol font should be preserved, not replaced with Verdana
      expect(mockLevel.setFont).toHaveBeenCalledWith('Symbol');
      expect(mockLevel.setBold).toHaveBeenCalledWith(false);
    });
  });

  describe('isBulletList', () => {
    it('should identify bullet lists', () => {
      const mockAbstractNum = {
        getLevel: vi.fn().mockReturnValue({
          getFormat: vi.fn().mockReturnValue('bullet'),
        }),
      };
      const mockInstance = {
        getAbstractNumId: vi.fn().mockReturnValue(0),
      };
      const mockNumberingManager = {
        getNumberingInstance: vi.fn().mockReturnValue(mockInstance),
        getAbstractNumbering: vi.fn().mockReturnValue(mockAbstractNum),
      };
      mockDoc.getNumberingManager = vi.fn().mockReturnValue(mockNumberingManager);

      const result = processor.isBulletList(mockDoc, 1);

      expect(result).toBe(true);
    });

    it('should return false for numbered lists', () => {
      const mockAbstractNum = {
        getLevel: vi.fn().mockReturnValue({
          getFormat: vi.fn().mockReturnValue('decimal'),
        }),
      };
      const mockInstance = {
        getAbstractNumId: vi.fn().mockReturnValue(0),
      };
      const mockNumberingManager = {
        getNumberingInstance: vi.fn().mockReturnValue(mockInstance),
        getAbstractNumbering: vi.fn().mockReturnValue(mockAbstractNum),
      };
      mockDoc.getNumberingManager = vi.fn().mockReturnValue(mockNumberingManager);

      const result = processor.isBulletList(mockDoc, 1);

      expect(result).toBe(false);
    });
  });

  describe('isNumberedList', () => {
    it('should identify decimal numbered lists', () => {
      const mockAbstractNum = {
        getLevel: vi.fn().mockReturnValue({
          getFormat: vi.fn().mockReturnValue('decimal'),
        }),
      };
      const mockInstance = {
        getAbstractNumId: vi.fn().mockReturnValue(0),
      };
      const mockNumberingManager = {
        getNumberingInstance: vi.fn().mockReturnValue(mockInstance),
        getAbstractNumbering: vi.fn().mockReturnValue(mockAbstractNum),
      };
      mockDoc.getNumberingManager = vi.fn().mockReturnValue(mockNumberingManager);

      const result = processor.isNumberedList(mockDoc, 1);

      expect(result).toBe(true);
    });

    it('should identify letter numbered lists', () => {
      const mockAbstractNum = {
        getLevel: vi.fn().mockReturnValue({
          getFormat: vi.fn().mockReturnValue('lowerLetter'),
        }),
      };
      const mockInstance = {
        getAbstractNumId: vi.fn().mockReturnValue(0),
      };
      const mockNumberingManager = {
        getNumberingInstance: vi.fn().mockReturnValue(mockInstance),
        getAbstractNumbering: vi.fn().mockReturnValue(mockAbstractNum),
      };
      mockDoc.getNumberingManager = vi.fn().mockReturnValue(mockNumberingManager);

      const result = processor.isNumberedList(mockDoc, 1);

      expect(result).toBe(true);
    });

    it('should return false for bullet lists', () => {
      const mockAbstractNum = {
        getLevel: vi.fn().mockReturnValue({
          getFormat: vi.fn().mockReturnValue('bullet'),
        }),
      };
      const mockInstance = {
        getAbstractNumId: vi.fn().mockReturnValue(0),
      };
      const mockNumberingManager = {
        getNumberingInstance: vi.fn().mockReturnValue(mockInstance),
        getAbstractNumbering: vi.fn().mockReturnValue(mockAbstractNum),
      };
      mockDoc.getNumberingManager = vi.fn().mockReturnValue(mockNumberingManager);

      const result = processor.isNumberedList(mockDoc, 1);

      expect(result).toBe(false);
    });
  });
});

// Helper functions

function createMockListParagraph(level: number, numId: number): Mocked<Paragraph> {
  return {
    getNumbering: vi.fn().mockReturnValue({ level, numId }),
    setLeftIndent: vi.fn().mockReturnThis(),
    setFirstLineIndent: vi.fn().mockReturnThis(),
    setSpaceAfter: vi.fn(),
    getText: vi.fn().mockReturnValue('List item'),
    getStyle: vi.fn().mockReturnValue('ListParagraph'),
  } as unknown as Mocked<Paragraph>;
}

function createMockNumberingLevel(font: string) {
  return {
    getProperties: vi.fn().mockReturnValue({ font }),
    getFormat: vi.fn().mockReturnValue('bullet'),
    setFont: vi.fn().mockReturnThis(),
    setColor: vi.fn().mockReturnThis(),
    setFontSize: vi.fn().mockReturnThis(),
    setBold: vi.fn().mockReturnThis(),
    setText: vi.fn().mockReturnThis(),
  };
}

function createMockNormalParagraph(): Mocked<Paragraph> {
  return {
    getNumbering: vi.fn().mockReturnValue(null),
    setLeftIndent: vi.fn().mockReturnThis(),
    setFirstLineIndent: vi.fn().mockReturnThis(),
    setSpaceAfter: vi.fn(),
    getText: vi.fn().mockReturnValue('Normal paragraph'),
    getStyle: vi.fn().mockReturnValue('Normal'),
  } as unknown as Mocked<Paragraph>;
}
