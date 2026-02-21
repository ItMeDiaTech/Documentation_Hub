/**
 * Test Suite for StructureProcessor
 *
 * Tests blank paragraph removal, structure operations, and document warnings.
 */

import type { Mocked } from 'jest-mock';
import { StructureProcessor } from '../StructureProcessor';
import { Document, Paragraph, Run, Hyperlink, Image } from 'docxmlater';

// Mock docxmlater
jest.mock('docxmlater');

// Setup Paragraph.create to return a usable mock paragraph
function createMockWarningParagraph(): any {
  return {
    setAlignment: jest.fn(),
    setSpaceBefore: jest.fn(),
    setSpaceAfter: jest.fn(),
    getRuns: jest.fn().mockReturnValue([{
      setItalic: jest.fn(),
      setFont: jest.fn(),
      setSize: jest.fn(),
    }]),
  };
}

describe('StructureProcessor', () => {
  let processor: StructureProcessor;
  let mockDoc: Mocked<Document>;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new StructureProcessor();

    // Setup Paragraph.create static method to return mock paragraphs
    (Paragraph.create as ReturnType<typeof jest.fn>) = jest.fn().mockImplementation(() => createMockWarningParagraph());

    mockDoc = {
      getAllParagraphs: jest.fn().mockReturnValue([]),
      removeAllHeadersFooters: jest.fn().mockReturnValue(0),
      addParagraph: jest.fn().mockReturnThis(),
    } as unknown as Mocked<Document>;

  });

  describe('removeItalicFormatting', () => {
    it('should remove italic from formatted runs', async () => {
      const mockRun = createMockFormattedRun(false, true); // not bold, italic
      const mockParagraph = createMockParagraphWithRuns([mockRun]);
      mockDoc.getAllParagraphs.mockReturnValue([mockParagraph]);

      const count = await processor.removeItalicFormatting(mockDoc);

      expect(count).toBe(1);
      expect(mockRun.setItalic).toHaveBeenCalledWith(false);
    });

    it('should skip non-italic runs', async () => {
      const mockRun = createMockFormattedRun(true, false); // bold, not italic
      const mockParagraph = createMockParagraphWithRuns([mockRun]);
      mockDoc.getAllParagraphs.mockReturnValue([mockParagraph]);

      const count = await processor.removeItalicFormatting(mockDoc);

      expect(count).toBe(0);
      expect(mockRun.setItalic).not.toHaveBeenCalled();
    });
  });

  describe('removeHeadersFooters', () => {
    it('should remove all headers and footers', async () => {
      mockDoc.removeAllHeadersFooters.mockReturnValue(3);

      const count = await processor.removeHeadersFooters(mockDoc);

      expect(count).toBe(3);
      expect(mockDoc.removeAllHeadersFooters).toHaveBeenCalled();
    });

    it('should handle documents without headers/footers', async () => {
      mockDoc.removeAllHeadersFooters.mockReturnValue(0);

      const count = await processor.removeHeadersFooters(mockDoc);

      expect(count).toBe(0);
    });
  });

  describe('addDocumentWarning', () => {
    it('should add warning paragraphs to document', async () => {
      mockDoc.getAllParagraphs.mockReturnValue([
        createMockTextParagraph('Some content'),
      ]);

      const result = await processor.addDocumentWarning(mockDoc);

      expect(result).toBe(true);
      expect(mockDoc.addParagraph).toHaveBeenCalled();
    });

    it('should not add duplicate warning', async () => {
      mockDoc.getAllParagraphs.mockReturnValue([
        createMockTextParagraph('Some content'),
        createMockTextParagraph('This is electronic data and is not to be reproduced'),
      ]);

      const result = await processor.addDocumentWarning(mockDoc);

      expect(result).toBe(false);
      expect(mockDoc.addParagraph).not.toHaveBeenCalled();
    });
  });

  describe('isParagraphTrulyEmpty', () => {
    it('should identify empty paragraphs', () => {
      const mockParagraph = {
        getNumbering: jest.fn().mockReturnValue(null),
        getContent: jest.fn().mockReturnValue([]),
      } as unknown as Paragraph;

      const isEmpty = processor.isParagraphTrulyEmpty(mockParagraph);

      expect(isEmpty).toBe(true);
    });

    it('should not mark list items as empty', () => {
      const mockParagraph = {
        getNumbering: jest.fn().mockReturnValue({ level: 0 }),
        getContent: jest.fn().mockReturnValue([]),
      } as unknown as Paragraph;

      const isEmpty = processor.isParagraphTrulyEmpty(mockParagraph);

      expect(isEmpty).toBe(false);
    });

    it('should not mark paragraphs with hyperlinks as empty', () => {
      const mockHyperlink = Object.create(Hyperlink.prototype);
      const mockParagraph = {
        getNumbering: jest.fn().mockReturnValue(null),
        getContent: jest.fn().mockReturnValue([mockHyperlink]),
      } as unknown as Paragraph;

      const isEmpty = processor.isParagraphTrulyEmpty(mockParagraph);

      expect(isEmpty).toBe(false);
    });

    it('should not mark paragraphs with images as empty', () => {
      const mockImage = Object.create(Image.prototype);
      const mockParagraph = {
        getNumbering: jest.fn().mockReturnValue(null),
        getContent: jest.fn().mockReturnValue([mockImage]),
      } as unknown as Paragraph;

      const isEmpty = processor.isParagraphTrulyEmpty(mockParagraph);

      expect(isEmpty).toBe(false);
    });

    it('should identify paragraphs with only empty runs as empty', () => {
      const mockRun = { getText: jest.fn().mockReturnValue('   ') };
      Object.setPrototypeOf(mockRun, Run.prototype);

      const mockParagraph = {
        getNumbering: jest.fn().mockReturnValue(null),
        getContent: jest.fn().mockReturnValue([mockRun]),
      } as unknown as Paragraph;

      const isEmpty = processor.isParagraphTrulyEmpty(mockParagraph);

      expect(isEmpty).toBe(true);
    });
  });

  describe('findNearestHeader2', () => {
    it('should find nearest Header2 above paragraph', () => {
      const header2Para = createMockStyledParagraph('Heading2', 'Section Title');
      const normalPara = createMockStyledParagraph('Normal', 'Content');
      mockDoc.getAllParagraphs.mockReturnValue([header2Para, normalPara, normalPara]);

      const title = processor.findNearestHeader2(mockDoc, 2);

      expect(title).toBe('Section Title');
    });

    it('should return null when no Header2 found', () => {
      const normalPara = createMockStyledParagraph('Normal', 'Content');
      mockDoc.getAllParagraphs.mockReturnValue([normalPara, normalPara]);

      const title = processor.findNearestHeader2(mockDoc, 1);

      expect(title).toBeNull();
    });

    it('should handle Heading 2 variant style name', () => {
      const header2Para = createMockStyledParagraph('Heading 2', 'Section');
      const normalPara = createMockStyledParagraph('Normal', 'Content');
      mockDoc.getAllParagraphs.mockReturnValue([header2Para, normalPara]);

      const title = processor.findNearestHeader2(mockDoc, 1);

      expect(title).toBe('Section');
    });
  });
});

// Helper functions

function createMockRun(text: string): Mocked<Run> {
  return {
    getText: jest.fn().mockReturnValue(text),
    setText: jest.fn(),
    getFormatting: jest.fn().mockReturnValue({}),
    setItalic: jest.fn(),
  } as unknown as Mocked<Run>;
}

function createMockFormattedRun(bold: boolean, italic: boolean): Mocked<Run> {
  return {
    getText: jest.fn().mockReturnValue('Text'),
    setText: jest.fn(),
    getFormatting: jest.fn().mockReturnValue({ bold, italic }),
    setItalic: jest.fn(),
  } as unknown as Mocked<Run>;
}

function createMockParagraphWithRuns(runs: any[]): Mocked<Paragraph> {
  return {
    getRuns: jest.fn().mockReturnValue(runs),
    getNumbering: jest.fn().mockReturnValue(null),
    getContent: jest.fn().mockReturnValue(runs),
    getText: jest.fn().mockReturnValue(''),
    getStyle: jest.fn().mockReturnValue('Normal'),
  } as unknown as Mocked<Paragraph>;
}

function createMockTextParagraph(text: string): Mocked<Paragraph> {
  return {
    getRuns: jest.fn().mockReturnValue([]),
    getNumbering: jest.fn().mockReturnValue(null),
    getContent: jest.fn().mockReturnValue([]),
    getText: jest.fn().mockReturnValue(text),
    getStyle: jest.fn().mockReturnValue('Normal'),
  } as unknown as Mocked<Paragraph>;
}

function createMockStyledParagraph(style: string, text: string): Mocked<Paragraph> {
  return {
    getRuns: jest.fn().mockReturnValue([]),
    getNumbering: jest.fn().mockReturnValue(null),
    getContent: jest.fn().mockReturnValue([]),
    getText: jest.fn().mockReturnValue(text),
    getStyle: jest.fn().mockReturnValue(style),
  } as unknown as Mocked<Paragraph>;
}
