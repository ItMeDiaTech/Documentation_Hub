/**
 * Test Suite for HyperlinkProcessor
 *
 * Tests hyperlink manipulation, URL updates, and custom replacements.
 */

import { HyperlinkProcessor } from '../HyperlinkProcessor';
import { Document, Hyperlink, Paragraph, Revision } from 'docxmlater';
import { DocXMLaterProcessor } from '../../DocXMLaterProcessor';

// Mock dependencies
jest.mock('docxmlater');
jest.mock('../../DocXMLaterProcessor');

describe('HyperlinkProcessor', () => {
  let processor: HyperlinkProcessor;
  let mockDoc: jest.Mocked<Document>;
  let mockDocXMLater: jest.Mocked<DocXMLaterProcessor>;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new HyperlinkProcessor();

    // Create mock document
    mockDoc = {
      getAllParagraphs: jest.fn().mockReturnValue([]),
      isTrackChangesEnabled: jest.fn().mockReturnValue(false),
      getRevisionManager: jest.fn().mockReturnValue({
        register: jest.fn(),
      }),
      hasBookmark: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<Document>;

    // Setup DocXMLaterProcessor mock
    mockDocXMLater = new DocXMLaterProcessor() as jest.Mocked<DocXMLaterProcessor>;
    mockDocXMLater.extractHyperlinks = jest.fn().mockResolvedValue([]);
    (processor as any).docXMLater = mockDocXMLater;
  });

  describe('standardizeFormatting', () => {
    it('should standardize hyperlink formatting to Verdana 12pt blue', async () => {
      const mockHyperlink = createMockHyperlink('https://example.com', 'Test Link');
      mockDocXMLater.extractHyperlinks.mockResolvedValue([
        {
          hyperlink: mockHyperlink,
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          hyperlinkIndexInParagraph: 0,
          url: 'https://example.com',
          text: 'Test Link',
        },
      ]);

      const count = await processor.standardizeFormatting(mockDoc);

      expect(count).toBe(1);
      expect(mockHyperlink.setFormatting).toHaveBeenCalledWith({
        font: 'Verdana',
        size: 12,
        color: '0000FF',
        underline: 'single',
        bold: false,
        italic: false,
      });
    });

    it('should handle empty hyperlink list', async () => {
      mockDocXMLater.extractHyperlinks.mockResolvedValue([]);

      const count = await processor.standardizeFormatting(mockDoc);

      expect(count).toBe(0);
    });

    it('should continue processing if one hyperlink fails', async () => {
      const mockHyperlink1 = createMockHyperlink('https://example1.com', 'Link 1');
      const mockHyperlink2 = createMockHyperlink('https://example2.com', 'Link 2');

      // Make first hyperlink throw error
      mockHyperlink1.setFormatting = jest.fn().mockImplementation(() => {
        throw new Error('Format error');
      });

      mockDocXMLater.extractHyperlinks.mockResolvedValue([
        {
          hyperlink: mockHyperlink1,
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          hyperlinkIndexInParagraph: 0,
          url: 'https://example1.com',
          text: 'Link 1',
        },
        {
          hyperlink: mockHyperlink2,
          paragraph: {} as Paragraph,
          paragraphIndex: 1,
          hyperlinkIndexInParagraph: 0,
          url: 'https://example2.com',
          text: 'Link 2',
        },
      ]);

      const count = await processor.standardizeFormatting(mockDoc);

      expect(count).toBe(1); // Only second one succeeded
      expect(mockHyperlink2.setFormatting).toHaveBeenCalled();
    });
  });

  describe('applyUrlUpdates', () => {
    it('should update URLs in hyperlinks', async () => {
      const mockHyperlink = createMockHyperlink('https://old-url.com', 'Link');
      const mockParagraph = {
        getContent: jest.fn().mockReturnValue([mockHyperlink]),
      };

      mockDoc.getAllParagraphs.mockReturnValue([mockParagraph as unknown as Paragraph]);

      // Make mockHyperlink an instance of Hyperlink
      Object.setPrototypeOf(mockHyperlink, Hyperlink.prototype);

      const urlMap = new Map([['https://old-url.com', 'https://new-url.com']]);

      const result = await processor.applyUrlUpdates(mockDoc, urlMap, 'TestAuthor');

      expect(result.updated).toBe(1);
      expect(result.failed).toHaveLength(0);
      expect(mockHyperlink.setUrl).toHaveBeenCalledWith('https://new-url.com');
    });

    it('should skip identical URLs', async () => {
      const mockHyperlink = createMockHyperlink('https://same-url.com', 'Link');
      const mockParagraph = {
        getContent: jest.fn().mockReturnValue([mockHyperlink]),
      };

      mockDoc.getAllParagraphs.mockReturnValue([mockParagraph as unknown as Paragraph]);
      Object.setPrototypeOf(mockHyperlink, Hyperlink.prototype);

      const urlMap = new Map([['https://same-url.com', 'https://same-url.com']]);

      const result = await processor.applyUrlUpdates(mockDoc, urlMap);

      expect(result.updated).toBe(0);
      expect(mockHyperlink.setUrl).not.toHaveBeenCalled();
    });

    it('should return empty result for empty map', async () => {
      const result = await processor.applyUrlUpdates(mockDoc, new Map());

      expect(result.updated).toBe(0);
      expect(result.failed).toHaveLength(0);
    });

    it('should track failed updates', async () => {
      const mockHyperlink = createMockHyperlink('https://old-url.com', 'Link');
      mockHyperlink.setUrl = jest.fn().mockImplementation(() => {
        throw new Error('Update failed');
      });

      const mockParagraph = {
        getContent: jest.fn().mockReturnValue([mockHyperlink]),
      };

      mockDoc.getAllParagraphs.mockReturnValue([mockParagraph as unknown as Paragraph]);
      Object.setPrototypeOf(mockHyperlink, Hyperlink.prototype);

      const urlMap = new Map([['https://old-url.com', 'https://new-url.com']]);

      const result = await processor.applyUrlUpdates(mockDoc, urlMap);

      expect(result.updated).toBe(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].oldUrl).toBe('https://old-url.com');
    });
  });

  describe('processCustomReplacements', () => {
    it('should apply URL replacement with contains match', async () => {
      const mockHyperlink = createMockHyperlink('https://old-domain.com/path', 'Link');
      mockDocXMLater.extractHyperlinks.mockResolvedValue([
        {
          hyperlink: mockHyperlink,
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          hyperlinkIndexInParagraph: 0,
          url: 'https://old-domain.com/path',
          text: 'Link',
        },
      ]);

      const result = await processor.processCustomReplacements(mockDoc, [
        {
          find: 'old-domain',
          replace: 'new-domain',
          matchType: 'contains',
          applyTo: 'url',
        },
      ]);

      expect(result.updatedUrls).toBe(1);
      expect(mockHyperlink.setUrl).toHaveBeenCalledWith('https://new-domain.com/path');
    });

    it('should apply text replacement with exact match', async () => {
      const mockHyperlink = createMockHyperlink('https://example.com', 'Old Text');
      mockDocXMLater.extractHyperlinks.mockResolvedValue([
        {
          hyperlink: mockHyperlink,
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          hyperlinkIndexInParagraph: 0,
          url: 'https://example.com',
          text: 'Old Text',
        },
      ]);

      const result = await processor.processCustomReplacements(mockDoc, [
        {
          find: 'Old Text',
          replace: 'New Text',
          matchType: 'exact',
          applyTo: 'text',
        },
      ]);

      expect(result.updatedTexts).toBe(1);
      expect(mockHyperlink.setText).toHaveBeenCalledWith('New Text');
    });

    it('should apply replacement to both URL and text', async () => {
      const mockHyperlink = createMockHyperlink('https://old.com', 'old link');
      mockDocXMLater.extractHyperlinks.mockResolvedValue([
        {
          hyperlink: mockHyperlink,
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          hyperlinkIndexInParagraph: 0,
          url: 'https://old.com',
          text: 'old link',
        },
      ]);

      const result = await processor.processCustomReplacements(mockDoc, [
        {
          find: 'old',
          replace: 'new',
          matchType: 'contains',
          applyTo: 'both',
        },
      ]);

      expect(result.updatedUrls).toBe(1);
      expect(result.updatedTexts).toBe(1);
    });
  });

  describe('findMatchingApiResult', () => {
    it('should match by Content_ID', () => {
      const apiResultsMap = new Map([['TSRC-ABC-123456', { title: 'Found Doc' }]]);

      const result = processor.findMatchingApiResult(
        'https://thesource.cvshealth.com/doc?Content_ID=TSRC-ABC-123456',
        apiResultsMap
      );

      expect(result).toEqual({ title: 'Found Doc' });
    });

    it('should match by Document_ID (UUID)', () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      const apiResultsMap = new Map([[uuid, { title: 'UUID Doc' }]]);

      const result = processor.findMatchingApiResult(
        `https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=${uuid}`,
        apiResultsMap
      );

      expect(result).toEqual({ title: 'UUID Doc' });
    });

    it('should return null for URLs without IDs', () => {
      const apiResultsMap = new Map([['TSRC-ABC-123456', { title: 'Doc' }]]);

      const result = processor.findMatchingApiResult('https://example.com/page', apiResultsMap);

      expect(result).toBeNull();
    });

    it('should return null for empty map', () => {
      const result = processor.findMatchingApiResult(
        'https://thesource.cvshealth.com/doc?Content_ID=TSRC-ABC-123456',
        new Map()
      );

      expect(result).toBeNull();
    });
  });
});

// Helper function to create mock hyperlink
function createMockHyperlink(url: string, text: string): jest.Mocked<Hyperlink> {
  return {
    getUrl: jest.fn().mockReturnValue(url),
    getText: jest.fn().mockReturnValue(text),
    setText: jest.fn(),
    setUrl: jest.fn(),
    setFormatting: jest.fn(),
    getFormatting: jest.fn().mockReturnValue({}),
    getAnchor: jest.fn().mockReturnValue(null),
    clone: jest.fn(),
  } as unknown as jest.Mocked<Hyperlink>;
}
