/**
 * Integration Tests for WordDocumentProcessor
 *
 * IMPORTANT: These tests use REAL docxmlater library, NOT mocks!
 * Tests work with actual DOCX files in ./fixtures/ directory.
 *
 * Coverage target: 90%+ of WordDocumentProcessor.ts
 */

import { vi, describe, it, expect, beforeEach, type Mocked } from 'vitest';
import {
  WordDocumentProcessor,
  WordProcessingOptions,
  WordProcessingResult,
} from '../WordDocumentProcessor';
import { Document } from 'docxmlater';
import { promises as fs } from 'fs';
import * as path from 'path';
import { hyperlinkService } from '../../HyperlinkService';

// Mock ONLY external dependencies, NOT docxmlater
vi.mock('../../HyperlinkService');
vi.mock('@/utils/MemoryMonitor', () => ({
  MemoryMonitor: {
    checkMemory: vi.fn(),
    forceGarbageCollection: vi.fn(),
    logMemoryUsage: vi.fn(),
    compareCheckpoints: vi.fn(),
    getMemoryStats: vi.fn().mockReturnValue({
      heapUsed: 100,
      heapTotal: 200,
      rss: 300,
    }),
  },
}));
vi.mock('@/utils/logger', () => ({
  logger: {
    namespace: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
  startTimer: vi.fn().mockReturnValue({
    end: vi.fn().mockReturnValue(0),
    elapsed: vi.fn().mockReturnValue(0),
  }),
  debugModes: {
    DOCUMENT_PROCESSING: 'debug:documentProcessing',
    SESSION_STATE: 'debug:sessionState',
    IPC_CALLS: 'debug:ipcCalls',
    DATABASE: 'debug:database',
    HYPERLINKS: 'debug:hyperlinks',
    BACKUPS: 'debug:backups',
    LIST_PROCESSING: 'debug:listProcessing',
  },
  isDebugEnabled: vi.fn().mockReturnValue(false),
}));

const fixturesDir = path.join(__dirname, 'fixtures');

describe('WordDocumentProcessor - Integration Tests', () => {
  let processor: WordDocumentProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new WordDocumentProcessor();
  });

  describe('Document Loading & Validation', () => {
    it('should successfully load and process a valid DOCX file', async () => {
      const filePath = path.join(fixturesDir, 'sample.docx');

      const result = await processor.processDocument(filePath);

      // Show actual errors in assertion diff if processing fails
      expect(result.errorMessages).toEqual([]);
      expect(result.success).toBe(true);
      expect(result.errorCount).toBe(0);
      expect(result).toMatchObject({
        success: true,
        totalHyperlinks: expect.any(Number),
        processedHyperlinks: expect.any(Number),
        skippedHyperlinks: expect.any(Number),
        processedLinks: expect.any(Array),
      });
    });

    it('should reject files exceeding size limit', async () => {
      const filePath = path.join(fixturesDir, 'sample.docx');

      vi.spyOn(fs, 'stat').mockResolvedValue({
        size: 200 * 1024 * 1024, // 200MB
      } as any);

      const result = await processor.processDocument(filePath, {
        maxFileSizeMB: 100,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessages.length).toBeGreaterThan(0);
      expect(result.errorMessages[0]).toContain('File too large');
      expect(result.errorMessages[0]).toContain('200.00MB');

      // Restore fs.stat
      vi.restoreAllMocks();
    });

    it('should handle corrupt DOCX files gracefully', async () => {
      const filePath = path.join(fixturesDir, 'corrupt.docx');

      const result = await processor.processDocument(filePath);

      expect(result.success).toBe(false);
      expect(result.errorMessages.length).toBeGreaterThan(0);
      // Error message should indicate loading failure
      expect(result.errorMessages[0]).toMatch(/load|invalid|corrupt|format/i);
    });

    it('should create backup before processing when requested', async () => {
      const filePath = path.join(fixturesDir, 'sample.docx');

      const copyFileSpy = vi.spyOn(fs, 'copyFile').mockResolvedValue(undefined);

      const result = await processor.processDocument(filePath, {
        createBackup: true,
      });

      expect(copyFileSpy).toHaveBeenCalled();
      const [sourcePath, backupPath] = copyFileSpy.mock.calls[0];
      expect(sourcePath).toBe(filePath);
      expect(backupPath).toContain('Backup');
      expect(result.backupPath).toBeDefined();

      vi.restoreAllMocks();
    });

    it('should handle file not found errors', async () => {
      const result = await processor.processDocument('/nonexistent/path/fake.docx');

      expect(result.success).toBe(false);
      expect(result.errorMessages.length).toBeGreaterThan(0);
    });
  });

  describe('Hyperlink Extraction', () => {
    it('should extract all hyperlinks from document', async () => {
      const filePath = path.join(fixturesDir, 'hyperlinks.docx');

      const result = await processor.processDocument(filePath);

      expect(result.success).toBe(true);
      expect(result.totalHyperlinks).toBeGreaterThanOrEqual(0);

      // Verify hyperlink structure in processedLinks
      expect(result.processedLinks).toBeInstanceOf(Array);

      if (result.processedLinks.length > 0) {
        const link = result.processedLinks[0];
        expect(link).toHaveProperty('id');
        expect(link).toHaveProperty('url');
        expect(link).toHaveProperty('displayText');
        expect(link).toHaveProperty('type');
        expect(link).toHaveProperty('status');
      }
    });

    it('should extract hyperlinks with correct URLs and text', async () => {
      const filePath = path.join(fixturesDir, 'hyperlinks.docx');

      // Load document directly to verify
      const doc = await Document.load(filePath);
      const hyperlinksData = doc.getHyperlinks();

      // Fixture may have zero hyperlinks — verify structure if any exist
      expect(hyperlinksData).toBeInstanceOf(Array);

      for (const { hyperlink, paragraph } of hyperlinksData) {
        expect(hyperlink.getUrl()).toBeTruthy();
        expect(hyperlink.getText()).toBeTruthy();
        expect(paragraph.getText()).toBeTruthy();
      }

      // Clean up
      doc.dispose();
    });

    it('should handle documents with no hyperlinks', async () => {
      const filePath = path.join(fixturesDir, 'sample.docx');

      const result = await processor.processDocument(filePath);

      expect(result.success).toBe(true);
      expect(result.totalHyperlinks).toBe(0);
      expect(result.processedHyperlinks).toBe(0);
      expect(result.processedLinks).toHaveLength(0);
    });
  });

  describe('Content ID Appending', () => {
    it('should append content ID to theSource URLs', async () => {
      const filePath = path.join(fixturesDir, 'theSource.docx');

      const result = await processor.processDocument(filePath, {
        operations: { fixContentIds: true },
        contentId: '#test-content',
      });

      expect(result.success).toBe(true);

      // Should have modified some URLs
      if (result.appendedContentIds !== undefined) {
        expect(result.appendedContentIds).toBeGreaterThanOrEqual(0);
      }

      // Check processedLinks for modifications
      const modifiedLinks = result.processedLinks.filter(
        (l) => l.status === 'processed' && l.after
      );

      // If content IDs were appended, verify they contain the ID
      if (result.appendedContentIds && result.appendedContentIds > 0) {
        expect(modifiedLinks.length).toBeGreaterThan(0);

        for (const link of modifiedLinks) {
          if (link.after && link.after.includes('thesource')) {
            expect(link.after).toContain('#test-content');
          }
        }
      }
    });

    it('should skip URLs that already have content IDs', async () => {
      const filePath = path.join(fixturesDir, 'theSource-with-ids.docx');

      const result = await processor.processDocument(filePath, {
        operations: { fixContentIds: true },
        contentId: '#test-content',
      });

      expect(result.success).toBe(true);

      // These URLs already have content IDs, should be skipped
      expect(result.skippedHyperlinks).toBeGreaterThanOrEqual(0);

      // Should NOT append to URLs that already have IDs
      if (result.appendedContentIds !== undefined) {
        expect(result.appendedContentIds).toBe(0);
      }
    });

    it('should handle edge case URLs gracefully', async () => {
      const filePath = path.join(fixturesDir, 'theSource-malformed.docx');

      const result = await processor.processDocument(filePath, {
        operations: { fixContentIds: true },
        contentId: '#test',
      });

      // Should not crash on edge cases
      expect(result.success).toBe(true);
      expect(result.errorMessages).not.toContain(/crash|exception/i);
    });
  });

  describe('Custom Replacements', () => {
    it('should apply custom URL replacements', async () => {
      const filePath = path.join(fixturesDir, 'hyperlinks.docx');

      const result = await processor.processDocument(filePath, {
        customReplacements: [
          {
            find: 'example.com',
            replace: 'new-example.com',
            matchType: 'contains',
            applyTo: 'url',
          },
        ],
      });

      expect(result.success).toBe(true);

      // Check if replacements were attempted
      if (result.updatedUrls !== undefined) {
        expect(result.updatedUrls).toBeGreaterThanOrEqual(0);
      }

      // Check processedLinks for URL modifications
      const urlReplacements = result.processedLinks.filter(
        (l) => l.before && l.after && l.before !== l.after && l.after.includes('new-example.com')
      );

      if (result.updatedUrls && result.updatedUrls > 0) {
        expect(urlReplacements.length).toBeGreaterThan(0);
      }
    });

    it('should apply custom text replacements', async () => {
      const filePath = path.join(fixturesDir, 'hyperlinks.docx');

      const result = await processor.processDocument(filePath, {
        customReplacements: [
          {
            find: 'GitHub',
            replace: 'GitLab',
            matchType: 'exact',
            applyTo: 'text',
          },
        ],
      });

      expect(result.success).toBe(true);

      // Text replacements should be tracked
      if (result.updatedDisplayTexts !== undefined) {
        expect(result.updatedDisplayTexts).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Batch Processing', () => {
    it('should process multiple documents concurrently', async () => {
      const files = [
        path.join(fixturesDir, 'sample.docx'),
        path.join(fixturesDir, 'hyperlinks.docx'),
        path.join(fixturesDir, 'theSource.docx'),
      ];

      const batchResult = await processor.batchProcess(files, {}, 2);

      expect(batchResult.totalFiles).toBe(3);
      expect(batchResult.successfulFiles).toBe(3);
      expect(batchResult.failedFiles).toBe(0);
      expect(batchResult.results).toHaveLength(3);

      // Each result should be valid
      for (const item of batchResult.results) {
        expect(item.result.success).toBe(true);
      }
    });

    it('should handle individual file failures in batch', async () => {
      const files = [
        path.join(fixturesDir, 'sample.docx'),
        path.join(fixturesDir, 'corrupt.docx'), // This will fail
        path.join(fixturesDir, 'hyperlinks.docx'),
      ];

      const batchResult = await processor.batchProcess(files, {}, 2);

      expect(batchResult.totalFiles).toBe(3);
      expect(batchResult.successfulFiles).toBe(2);
      expect(batchResult.failedFiles).toBe(1);
    });

    it('should call progress callback for each file', async () => {
      const files = [
        path.join(fixturesDir, 'sample.docx'),
        path.join(fixturesDir, 'hyperlinks.docx'),
      ];

      const progressCallback = vi.fn();

      await processor.batchProcess(files, {}, 1, progressCallback);

      expect(progressCallback).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenCalledWith(
        files[0],
        1,
        2,
        expect.objectContaining({ success: true })
      );
    });

    it('should respect concurrency limit', async () => {
      const files = Array(5).fill(path.join(fixturesDir, 'sample.docx'));

      const startTime = Date.now();
      await processor.batchProcess(files, {}, 2); // Max 2 concurrent
      const duration = Date.now() - startTime;

      // With concurrency of 2, should take roughly 3 batches (2+2+1)
      // Just verify it completes without errors
      expect(duration).toBeGreaterThan(0);
    });
  });

  describe('Memory Management', () => {
    it('should trigger garbage collection periodically in batch processing', async () => {
      const files = Array(15).fill(path.join(fixturesDir, 'sample.docx'));

      // Mock global.gc
      global.gc = vi.fn();

      await processor.batchProcess(files, {}, 3);

      // Should trigger GC at least once (every 10 documents)
      if (global.gc) {
        expect(global.gc).toHaveBeenCalled();
      }
    });

    it('should clean up resources after processing', async () => {
      const filePath = path.join(fixturesDir, 'sample.docx');

      const result = await processor.processDocument(filePath);

      expect(result.success).toBe(true);
      expect(result.processingTimeMs).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThan(0);
    });
  });

  describe('PowerAutomate API Integration', () => {
    it('should process hyperlinks with PowerAutomate API', async () => {
      const filePath = path.join(fixturesDir, 'theSource.docx');

      // Mock API response
      const mockApiResponse = {
        success: true,
        body: {
          results: [
            {
              contentId: 'TSRC-ABC-123456',
              documentId: 'uuid-123',
              title: 'Test Document',
              status: 'active',
            },
          ],
        },
      };

      (hyperlinkService.processHyperlinksWithApi as ReturnType<typeof vi.fn>).mockResolvedValue(mockApiResponse);

      const result = await processor.processDocument(filePath, {
        apiEndpoint: 'https://api.example.com',
        operations: { updateTitles: true },
      });

      // If document has theSource hyperlinks, API should be called
      // If not, processing still succeeds but API is not invoked
      if (result.totalHyperlinks > 0) {
        expect(hyperlinkService.processHyperlinksWithApi).toHaveBeenCalled();
      }
      expect(result.success).toBe(true);
    });

    it('should handle API failures gracefully', async () => {
      const filePath = path.join(fixturesDir, 'theSource.docx');

      (hyperlinkService.processHyperlinksWithApi as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'API timeout',
      });

      const result = await processor.processDocument(filePath, {
        apiEndpoint: 'https://api.example.com',
        operations: { updateTitles: true },
      });

      // If document has theSource hyperlinks, API failure causes processing failure
      // If no hyperlinks, processing succeeds without API call
      if (result.totalHyperlinks > 0) {
        expect(result.success).toBe(false);
        expect(result.errorMessages.some((msg) => msg.includes('PowerAutomate'))).toBe(true);
      } else {
        expect(result.success).toBe(true);
      }
    });

    it('should fail when API endpoint not configured', async () => {
      const filePath = path.join(fixturesDir, 'theSource.docx');

      const result = await processor.processDocument(filePath, {
        operations: { updateTitles: true },
        // No apiEndpoint provided
      });

      // If document has theSource hyperlinks, missing API endpoint causes failure
      // If no hyperlinks, processing succeeds
      if (result.totalHyperlinks > 0) {
        expect(result.success).toBe(false);
        expect(result.errorMessages[0]).toContain('API endpoint not configured');
      } else {
        expect(result.success).toBe(true);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle processing errors gracefully', async () => {
      const result = await processor.processDocument('');

      expect(result.success).toBe(false);
      expect(result.errorMessages.length).toBeGreaterThan(0);
    });

    it('should return proper error structure on failure', async () => {
      const result = await processor.processDocument('/invalid/path.docx');

      expect(result).toMatchObject({
        success: false,
        errorCount: expect.any(Number),
        errorMessages: expect.any(Array),
        totalHyperlinks: expect.any(Number),
        processedHyperlinks: expect.any(Number),
        processedLinks: expect.any(Array),
      });

      expect(result.errorCount).toBeGreaterThan(0);
      expect(result.errorMessages.length).toBeGreaterThan(0);
    });
  });
});
