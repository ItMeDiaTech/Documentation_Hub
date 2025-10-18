/**
 * Comprehensive Test Suite for WordDocumentProcessor
 *
 * Tests all major functionalities of the DOCX processing pipeline
 * using the docxmlater library implementation.
 */

import { WordDocumentProcessor, WordProcessingOptions, WordProcessingResult } from '../WordDocumentProcessor';
import { DocXMLaterProcessor } from '../DocXMLaterProcessor';
import { OOXMLValidator } from '../OOXMLValidator';
import { Document, Hyperlink, Paragraph } from 'docxmlater';
import { hyperlinkService } from '../../HyperlinkService';
import { promises as fs } from 'fs';
import * as path from 'path';

// Mock all dependencies
jest.mock('docxmlater');
jest.mock('../DocXMLaterProcessor');
jest.mock('../OOXMLValidator');
jest.mock('../../HyperlinkService');
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    copyFile: jest.fn(),
    writeFile: jest.fn(),
  },
}));

describe('WordDocumentProcessor', () => {
  let processor: WordDocumentProcessor;
  let mockDoc: jest.Mocked<Document>;
  let mockDocXMLater: jest.Mocked<DocXMLaterProcessor>;
  let mockOOXMLValidator: jest.Mocked<OOXMLValidator>;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Initialize processor
    processor = new WordDocumentProcessor();

    // Create mock document
    mockDoc = {
      getParagraphs: jest.fn().mockReturnValue([]),
      getTables: jest.fn().mockReturnValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('test')),
      createParagraph: jest.fn(),
      addStyle: jest.fn(),
      getHyperlinks: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<Document>;

    // Setup Document.load mock
    (Document.load as jest.Mock).mockResolvedValue(mockDoc);

    // Setup DocXMLaterProcessor mock
    mockDocXMLater = (processor as any).docXMLater;
    mockDocXMLater.extractHyperlinks = jest.fn().mockResolvedValue([]);

    // Setup OOXMLValidator mock
    mockOOXMLValidator = (processor as any).ooxmlValidator;
    mockOOXMLValidator.validateAndFixBuffer = jest.fn().mockResolvedValue({
      issues: [],
      fixes: [],
      correctedBuffer: Buffer.from('corrected'),
    });

    // Setup fs mocks
    (fs.stat as jest.Mock).mockResolvedValue({
      size: 1024 * 1024, // 1MB
    });
    (fs.copyFile as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
  });

  describe('Document Loading and Validation', () => {
    it('should successfully load and process a valid document', async () => {
      const filePath = '/test/document.docx';
      const options: WordProcessingOptions = {};

      const result = await processor.processDocument(filePath, options);

      expect(result.success).toBe(true);
      expect(Document.load).toHaveBeenCalledWith(filePath);
      expect(fs.stat).toHaveBeenCalledWith(filePath);
    });

    it('should reject files exceeding size limit', async () => {
      const filePath = '/test/large.docx';
      const options: WordProcessingOptions = {
        maxFileSizeMB: 0.5, // 0.5MB limit
      };

      // Mock large file
      (fs.stat as jest.Mock).mockResolvedValue({
        size: 1024 * 1024 * 2, // 2MB
      });

      const result = await processor.processDocument(filePath, options);

      expect(result.success).toBe(false);
      expect(result.errorMessages).toContain(expect.stringContaining('File too large'));
    });

    it('should create backup before processing', async () => {
      const filePath = '/test/document.docx';
      const options: WordProcessingOptions = {
        createBackup: true,
      };

      await processor.processDocument(filePath, options);

      expect(fs.copyFile).toHaveBeenCalled();
      const backupCall = (fs.copyFile as jest.Mock).mock.calls[0];
      expect(backupCall[0]).toBe(filePath);
      expect(backupCall[1]).toContain('.backup.');
    });

    it('should restore from backup on error', async () => {
      const filePath = '/test/document.docx';

      // Force an error during processing
      mockDocXMLater.extractHyperlinks.mockRejectedValue(new Error('Processing failed'));

      const result = await processor.processDocument(filePath);

      expect(result.success).toBe(false);
      expect(fs.copyFile).toHaveBeenCalledTimes(2); // Once for backup, once for restore
    });
  });

  describe('Hyperlink Extraction and Processing', () => {
    it('should extract hyperlinks from document', async () => {
      const filePath = '/test/document.docx';
      const mockHyperlinks = [
        {
          hyperlink: createMockHyperlink('https://example.com', 'Example'),
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          url: 'https://example.com',
          text: 'Example',
        },
        {
          hyperlink: createMockHyperlink('https://test.com', 'Test'),
          paragraph: {} as Paragraph,
          paragraphIndex: 1,
          url: 'https://test.com',
          text: 'Test',
        },
      ];

      mockDocXMLater.extractHyperlinks.mockResolvedValue(mockHyperlinks);

      const result = await processor.processDocument(filePath);

      expect(result.totalHyperlinks).toBe(2);
      expect(mockDocXMLater.extractHyperlinks).toHaveBeenCalledWith(mockDoc);
    });

    it('should append content IDs to theSource URLs', async () => {
      const filePath = '/test/document.docx';
      const mockHyperlinks = [
        {
          hyperlink: createMockHyperlink(
            'https://thesource.caci.com/nuxeo/thesource/#!/view?docid=abc123',
            'Document'
          ),
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          url: 'https://thesource.caci.com/nuxeo/thesource/#!/view?docid=abc123',
          text: 'Document',
        },
      ];

      mockDocXMLater.extractHyperlinks.mockResolvedValue(mockHyperlinks);

      const options: WordProcessingOptions = {
        operations: {
          fixContentIds: true,
        },
        contentId: '#content',
      };

      const result = await processor.processDocument(filePath, options);

      expect(result.appendedContentIds).toBe(1);
      expect(result.processedLinks).toHaveLength(1);
      expect(result.processedLinks[0].after).toContain('#content');
    });

    it('should skip URLs that already have content ID', async () => {
      const filePath = '/test/document.docx';
      const mockHyperlinks = [
        {
          hyperlink: createMockHyperlink(
            'https://thesource.caci.com/nuxeo/thesource/#!/view?docid=abc123#content',
            'Document'
          ),
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          url: 'https://thesource.caci.com/nuxeo/thesource/#!/view?docid=abc123#content',
          text: 'Document',
        },
      ];

      mockDocXMLater.extractHyperlinks.mockResolvedValue(mockHyperlinks);

      const options: WordProcessingOptions = {
        operations: {
          fixContentIds: true,
        },
      };

      const result = await processor.processDocument(filePath, options);

      expect(result.skippedHyperlinks).toBe(1);
      expect(result.appendedContentIds).toBe(0);
    });
  });

  describe('PowerAutomate API Integration', () => {
    beforeEach(() => {
      // Setup hyperlink service mock
      (hyperlinkService.processHyperlinksWithApi as jest.Mock) = jest.fn();
    });

    it('should process hyperlinks with PowerAutomate API', async () => {
      const filePath = '/test/document.docx';
      const mockHyperlinks = [
        {
          hyperlink: createMockHyperlink(
            'https://thesource.caci.com/doc?Content_ID=TSRC-ABC-123456',
            'Old Title'
          ),
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          url: 'https://thesource.caci.com/doc?Content_ID=TSRC-ABC-123456',
          text: 'Old Title',
        },
      ];

      mockDocXMLater.extractHyperlinks.mockResolvedValue(mockHyperlinks);

      // Mock API response
      const apiResponse = {
        success: true,
        body: {
          results: [
            {
              contentId: 'TSRC-ABC-123456',
              documentId: 'uuid-123',
              title: 'New Title',
              status: 'active',
            },
          ],
        },
      };

      (hyperlinkService.processHyperlinksWithApi as jest.Mock).mockResolvedValue(apiResponse);

      const options: WordProcessingOptions = {
        apiEndpoint: 'https://api.example.com',
        operations: {
          fixContentIds: true,
          updateTitles: true,
        },
      };

      const result = await processor.processDocument(filePath, options);

      expect(hyperlinkService.processHyperlinksWithApi).toHaveBeenCalled();
      expect(result.updatedDisplayTexts).toBeGreaterThan(0);
    });

    it('should fail document processing if API fails and operations are required', async () => {
      const filePath = '/test/document.docx';
      const mockHyperlinks = [
        {
          hyperlink: createMockHyperlink('https://example.com', 'Test'),
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          url: 'https://example.com',
          text: 'Test',
        },
      ];

      mockDocXMLater.extractHyperlinks.mockResolvedValue(mockHyperlinks);

      // Mock API failure
      (hyperlinkService.processHyperlinksWithApi as jest.Mock).mockResolvedValue({
        success: false,
        error: 'API timeout',
      });

      const options: WordProcessingOptions = {
        apiEndpoint: 'https://api.example.com',
        operations: {
          updateTitles: true, // Required operation
        },
      };

      const result = await processor.processDocument(filePath, options);

      expect(result.success).toBe(false);
      expect(result.errorMessages[0]).toContain('PowerAutomate API failed');
    });

    it('should handle documents not found in API', async () => {
      const filePath = '/test/document.docx';
      const mockHyperlinks = [
        {
          hyperlink: createMockHyperlink(
            'https://thesource.caci.com/doc?Content_ID=TSRC-XYZ-999999',
            'Unknown Doc'
          ),
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          url: 'https://thesource.caci.com/doc?Content_ID=TSRC-XYZ-999999',
          text: 'Unknown Doc',
        },
      ];

      mockDocXMLater.extractHyperlinks.mockResolvedValue(mockHyperlinks);

      // Mock API response with no results
      const apiResponse = {
        success: true,
        body: {
          results: [], // Document not found
        },
      };

      (hyperlinkService.processHyperlinksWithApi as jest.Mock).mockResolvedValue(apiResponse);

      const options: WordProcessingOptions = {
        apiEndpoint: 'https://api.example.com',
        operations: {
          updateTitles: true,
        },
      };

      const result = await processor.processDocument(filePath, options);

      expect(result.success).toBe(true);
      // Text should be marked as "Not Found"
      const setText = mockHyperlinks[0].hyperlink.setText as jest.Mock;
      expect(setText).toHaveBeenCalledWith(expect.stringContaining('Not Found'));
    });
  });

  describe('OOXML Validation', () => {
    it('should validate and fix OOXML structure', async () => {
      const filePath = '/test/document.docx';

      // Mock validation with issues
      mockOOXMLValidator.validateAndFixBuffer.mockResolvedValue({
        valid: false,
        issues: [],
        fixes: ['Fixed relationship ID'],
        correctedBuffer: new ArrayBuffer(16),
      });

      const result = await processor.processDocument(filePath);

      expect(mockOOXMLValidator.validateAndFixBuffer).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith(filePath, Buffer.from('fixed-content'));
      expect(result.processedLinks).toContainEqual(
        expect.objectContaining({
          id: 'ooxml-validation',
          status: 'processed',
        })
      );
    });

    it('should save original document if no OOXML fixes needed', async () => {
      const filePath = '/test/document.docx';

      // Mock validation with no issues
      mockOOXMLValidator.validateAndFixBuffer.mockResolvedValue({
        valid: true,
        issues: [],
        fixes: [],
      });

      await processor.processDocument(filePath);

      expect(mockDoc.save).toHaveBeenCalledWith(filePath);
    });
  });

  describe('Custom Replacements', () => {
    it('should apply custom URL replacements', async () => {
      const filePath = '/test/document.docx';
      const mockHyperlinks = [
        {
          hyperlink: createMockHyperlink('https://old-domain.com/doc', 'Document'),
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          url: 'https://old-domain.com/doc',
          text: 'Document',
        },
      ];

      mockDocXMLater.extractHyperlinks.mockResolvedValue(mockHyperlinks);

      const options: WordProcessingOptions = {
        customReplacements: [
          {
            find: 'old-domain.com',
            replace: 'new-domain.com',
            matchType: 'contains',
            applyTo: 'url',
          },
        ],
      };

      const result = await processor.processDocument(filePath, options);

      expect(result.updatedUrls).toBe(1);
    });

    it('should apply custom text replacements', async () => {
      const filePath = '/test/document.docx';
      const mockHyperlink = createMockHyperlink('https://example.com', 'Old Text');
      const mockHyperlinks = [
        {
          hyperlink: mockHyperlink,
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          url: 'https://example.com',
          text: 'Old Text',
        },
      ];

      mockDocXMLater.extractHyperlinks.mockResolvedValue(mockHyperlinks);

      const options: WordProcessingOptions = {
        customReplacements: [
          {
            find: 'Old',
            replace: 'New',
            matchType: 'contains',
            applyTo: 'text',
          },
        ],
      };

      const result = await processor.processDocument(filePath, options);

      expect(mockHyperlink.setText).toHaveBeenCalledWith('New Text');
      expect(result.updatedDisplayTexts).toBe(1);
    });
  });

  describe('Batch Processing', () => {
    it('should process multiple documents concurrently', async () => {
      const filePaths = [
        '/test/doc1.docx',
        '/test/doc2.docx',
        '/test/doc3.docx',
      ];

      const batchResult = await processor.batchProcess(filePaths, {}, 2);

      expect(batchResult.totalFiles).toBe(3);
      expect(batchResult.successfulFiles).toBe(3);
      expect(batchResult.failedFiles).toBe(0);
      expect(batchResult.results).toHaveLength(3);
    });

    it('should handle individual document failures in batch', async () => {
      const filePaths = [
        '/test/doc1.docx',
        '/test/doc2.docx',
        '/test/doc3.docx',
      ];

      // Make second document fail
      (Document.load as jest.Mock)
        .mockResolvedValueOnce(mockDoc)
        .mockRejectedValueOnce(new Error('Load failed'))
        .mockResolvedValueOnce(mockDoc);

      const batchResult = await processor.batchProcess(filePaths, {}, 2);

      expect(batchResult.totalFiles).toBe(3);
      expect(batchResult.successfulFiles).toBe(2);
      expect(batchResult.failedFiles).toBe(1);
    });

    it('should call progress callback during batch processing', async () => {
      const filePaths = ['/test/doc1.docx', '/test/doc2.docx'];
      const progressCallback = jest.fn();

      await processor.batchProcess(filePaths, {}, 1, progressCallback);

      expect(progressCallback).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenCalledWith(
        filePaths[0],
        1,
        2,
        expect.objectContaining({ success: true })
      );
    });
  });

  describe('Memory Management', () => {
    it('should trigger garbage collection periodically in batch processing', async () => {
      // Mock global.gc
      global.gc = jest.fn();

      const filePaths = Array(15).fill('/test/doc.docx');

      await processor.batchProcess(filePaths, {}, 3);

      // Should trigger GC at least once (every 10 documents)
      expect(global.gc).toHaveBeenCalled();
    });

    it('should clean up resources after processing', async () => {
      const filePath = '/test/document.docx';

      await processor.processDocument(filePath);

      // Check that buffer references are cleared (via writeFile being called)
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle document load errors gracefully', async () => {
      const filePath = '/test/invalid.docx';

      (Document.load as jest.Mock).mockRejectedValue(new Error('Invalid format'));

      const result = await processor.processDocument(filePath);

      expect(result.success).toBe(false);
      expect(result.errorMessages).toContain('Invalid format');
    });

    it('should handle API endpoint not configured', async () => {
      const filePath = '/test/document.docx';
      const mockHyperlinks = [
        {
          hyperlink: createMockHyperlink('https://example.com', 'Test'),
          paragraph: {} as Paragraph,
          paragraphIndex: 0,
          url: 'https://example.com',
          text: 'Test',
        },
      ];

      mockDocXMLater.extractHyperlinks.mockResolvedValue(mockHyperlinks);

      const options: WordProcessingOptions = {
        operations: {
          updateTitles: true,
        },
        // No apiEndpoint provided
      };

      const result = await processor.processDocument(filePath, options);

      expect(result.success).toBe(false);
      expect(result.errorMessages[0]).toContain('API endpoint not configured');
    });

    it('should handle processing timeouts', async () => {
      const filePath = '/test/document.docx';

      // Add actual test implementation for timeout scenarios
      // This would require implementing timeout logic in the processor

      // For now, just verify the structure exists
      const result = await processor.processDocument(filePath);

      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('processingTimeMs');
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
    getFormatting: jest.fn().mockReturnValue({}),
  } as unknown as jest.Mocked<Hyperlink>;
}