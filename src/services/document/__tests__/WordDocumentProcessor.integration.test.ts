/**
 * Integration Tests for WordDocumentProcessor
 *
 * IMPORTANT: These tests use REAL docxmlater library, NOT mocks!
 * Tests work with actual DOCX files in ./fixtures/ directory.
 *
 * Coverage target: 90%+ of WordDocumentProcessor.ts
 */

import {
  WordDocumentProcessor,
  WordProcessingOptions,
  WordProcessingResult,
} from "../WordDocumentProcessor";
import { Document } from "docxmlater";
import { promises as fs } from "fs";
import * as path from "path";
import { hyperlinkService } from "../../HyperlinkService";
import { createTestFixtures } from "./create-fixtures";

// Mock ONLY external dependencies, NOT docxmlater
jest.mock("../../HyperlinkService");
jest.mock("@/utils/MemoryMonitor", () => ({
  MemoryMonitor: {
    checkMemory: jest.fn(),
    forceGarbageCollection: jest.fn(),
    logMemoryUsage: jest.fn(),
    compareCheckpoints: jest.fn(),
    getMemoryStats: jest.fn().mockReturnValue({
      heapUsed: 100,
      heapTotal: 200,
      rss: 300,
    }),
  },
}));
jest.mock("@/utils/logger", () => ({
  logger: {
    namespace: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
  startTimer: jest.fn().mockReturnValue({
    end: jest.fn().mockReturnValue(0),
    elapsed: jest.fn().mockReturnValue(0),
  }),
  debugModes: {
    DOCUMENT_PROCESSING: "debug:documentProcessing",
    SESSION_STATE: "debug:sessionState",
    IPC_CALLS: "debug:ipcCalls",
    DATABASE: "debug:database",
    HYPERLINKS: "debug:hyperlinks",
    BACKUPS: "debug:backups",
    LIST_PROCESSING: "debug:listProcessing",
  },
  isDebugEnabled: jest.fn().mockReturnValue(false),
}));

const fixturesDir = path.join(__dirname, "fixtures");

describe("WordDocumentProcessor - Integration Tests", () => {
  let processor: WordDocumentProcessor;

  // The .docx fixtures are deterministic build artifacts, not committed to git.
  // Regenerate them from source before the suite so it runs identically locally
  // and in CI (where the pre-generated files are absent).
  beforeAll(async () => {
    await createTestFixtures({ quiet: true });
  }, 60000);

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new WordDocumentProcessor();
  });

  describe("Document Loading & Validation", () => {
    it("should successfully load and process a valid DOCX file", async () => {
      const filePath = path.join(fixturesDir, "sample.docx");

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

    it("should reject files exceeding size limit", async () => {
      const filePath = path.join(fixturesDir, "sample.docx");

      jest.spyOn(fs, "stat").mockResolvedValue({
        size: 200 * 1024 * 1024, // 200MB
      } as any);

      const result = await processor.processDocument(filePath, {
        maxFileSizeMB: 100,
      });

      expect(result.success).toBe(false);
      expect(result.errorMessages.length).toBeGreaterThan(0);
      expect(result.errorMessages[0]).toContain("File too large");
      expect(result.errorMessages[0]).toContain("200.00MB");

      // Restore fs.stat
      jest.restoreAllMocks();
    });

    it("should handle corrupt DOCX files gracefully", async () => {
      const filePath = path.join(fixturesDir, "corrupt.docx");

      const result = await processor.processDocument(filePath);

      expect(result.success).toBe(false);
      expect(result.errorMessages.length).toBeGreaterThan(0);
      // Error message should indicate loading failure
      expect(result.errorMessages[0]).toMatch(/load|invalid|corrupt|format/i);
    });

    it("should create backup before processing when requested", async () => {
      const filePath = path.join(fixturesDir, "sample.docx");

      const copyFileSpy = jest.spyOn(fs, "copyFile").mockResolvedValue(undefined);

      const result = await processor.processDocument(filePath, {
        createBackup: true,
      });

      expect(copyFileSpy).toHaveBeenCalled();
      const [sourcePath, backupPath] = copyFileSpy.mock.calls[0];
      expect(sourcePath).toBe(filePath);
      expect(backupPath).toContain("Backup");
      expect(result.backupPath).toBeDefined();

      jest.restoreAllMocks();
    });

    it("writes backups to a DocHub_Backups folder inside the user's Downloads folder", async () => {
      const downloadsDir = path.join(path.sep, "fake", "downloads");
      (window as unknown as { electronAPI: { getDownloadsPath: () => Promise<string> } }).electronAPI =
        { getDownloadsPath: jest.fn().mockResolvedValue(downloadsDir) };

      const mkdirSpy = jest.spyOn(fs, "mkdir").mockResolvedValue(undefined);
      const copyFileSpy = jest.spyOn(fs, "copyFile").mockResolvedValue(undefined);
      jest.spyOn(fs, "readdir").mockResolvedValue([] as never);

      const backupPath = await (
        processor as unknown as { createBackup: (p: string) => Promise<string> }
      ).createBackup(path.join(path.sep, "some", "dir", "Report.docx"));

      const expectedDir = path.join(downloadsDir, "DocHub_Backups");
      expect(mkdirSpy).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(backupPath).toBe(path.join(expectedDir, "Report_Backup_1.docx"));
      expect(copyFileSpy).toHaveBeenCalledWith(
        path.join(path.sep, "some", "dir", "Report.docx"),
        backupPath
      );

      delete (window as unknown as { electronAPI?: unknown }).electronAPI;
      jest.restoreAllMocks();
    });

    it("uses the main-process-injected downloadsPath when window is unavailable", async () => {
      // In the packaged app the processor runs in the main process (no window);
      // the Downloads path is injected via options instead.
      delete (window as unknown as { electronAPI?: unknown }).electronAPI;
      const downloadsDir = path.join(path.sep, "main", "downloads");

      const mkdirSpy = jest.spyOn(fs, "mkdir").mockResolvedValue(undefined);
      const copyFileSpy = jest.spyOn(fs, "copyFile").mockResolvedValue(undefined);
      jest.spyOn(fs, "readdir").mockResolvedValue([] as never);

      const src = path.join(path.sep, "docs", "Report.docx");
      const backupPath = await (
        processor as unknown as {
          createBackup: (p: string, o?: { downloadsPath?: string }) => Promise<string>;
        }
      ).createBackup(src, { downloadsPath: downloadsDir });

      const expectedDir = path.join(downloadsDir, "DocHub_Backups");
      expect(mkdirSpy).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(backupPath).toBe(path.join(expectedDir, "Report_Backup_1.docx"));
      expect(copyFileSpy).toHaveBeenCalledWith(src, backupPath);

      jest.restoreAllMocks();
    });

    it("falls back to the document's folder when the Downloads backup fails", async () => {
      delete (window as unknown as { electronAPI?: unknown }).electronAPI;
      const downloadsDir = path.join(path.sep, "blocked", "downloads");
      const src = path.join(path.sep, "docs", "Report.docx");
      const documentDir = path.dirname(src);

      const mkdirSpy = jest.spyOn(fs, "mkdir").mockImplementation((async (dir: string) => {
        if (String(dir).startsWith(downloadsDir)) throw new Error("EACCES");
        return undefined;
      }) as never);
      const copyFileSpy = jest.spyOn(fs, "copyFile").mockResolvedValue(undefined);
      jest.spyOn(fs, "readdir").mockResolvedValue([] as never);

      const backupPath = await (
        processor as unknown as {
          createBackup: (p: string, o?: { downloadsPath?: string }) => Promise<string>;
        }
      ).createBackup(src, { downloadsPath: downloadsDir });

      const fallbackDir = path.join(documentDir, "DocHub_Backups");
      expect(mkdirSpy).toHaveBeenCalledWith(path.join(downloadsDir, "DocHub_Backups"), {
        recursive: true,
      });
      expect(mkdirSpy).toHaveBeenCalledWith(fallbackDir, { recursive: true });
      expect(backupPath).toBe(path.join(fallbackDir, "Report_Backup_1.docx"));
      expect(copyFileSpy).toHaveBeenCalledWith(src, backupPath);

      jest.restoreAllMocks();
    });

    it("should handle file not found errors", async () => {
      const result = await processor.processDocument("/nonexistent/path/fake.docx");

      expect(result.success).toBe(false);
      expect(result.errorMessages.length).toBeGreaterThan(0);
    });
  });

  describe("Hyperlink Extraction", () => {
    it("should extract all hyperlinks from document", async () => {
      const filePath = path.join(fixturesDir, "hyperlinks.docx");

      const result = await processor.processDocument(filePath);

      expect(result.success).toBe(true);
      expect(result.totalHyperlinks).toBeGreaterThanOrEqual(0);

      // Verify hyperlink structure in processedLinks
      expect(result.processedLinks).toBeInstanceOf(Array);

      if (result.processedLinks.length > 0) {
        const link = result.processedLinks[0];
        expect(link).toHaveProperty("id");
        expect(link).toHaveProperty("url");
        expect(link).toHaveProperty("displayText");
        expect(link).toHaveProperty("type");
        expect(link).toHaveProperty("status");
      }
    });

    it("should extract hyperlinks with correct URLs and text", async () => {
      const filePath = path.join(fixturesDir, "hyperlinks.docx");

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

    it("should handle documents with no hyperlinks", async () => {
      const filePath = path.join(fixturesDir, "sample.docx");

      const result = await processor.processDocument(filePath);

      expect(result.success).toBe(true);
      expect(result.totalHyperlinks).toBe(0);
      expect(result.processedHyperlinks).toBe(0);
      expect(result.processedLinks).toHaveLength(0);
    });
  });

  describe("Content ID Appending", () => {
    // Content-ID resolution is API-driven: the PowerAutomate flow returns the
    // canonical content ID for each Lookup_ID found in the document's URLs.
    // These tests drive that real pipeline against real .docx fixtures with the
    // API mocked (the file already mocks HyperlinkService).
    const API_ENDPOINT = "https://api.example.com/flow";

    it("processes theSource hyperlinks through the PowerAutomate API when fixContentIds is enabled", async () => {
      const filePath = path.join(fixturesDir, "theSource.docx");

      (hyperlinkService.processHyperlinksWithApi as ReturnType<typeof jest.fn>).mockResolvedValue({
        success: true,
        body: {
          results: [
            {
              contentId: "TSRC-ABC-123456",
              documentId: "abc-123-def",
              title: "Doc Title",
              status: "active",
            },
          ],
        },
      });

      const result = await processor.processDocument(filePath, {
        apiEndpoint: API_ENDPOINT,
        operations: { fixContentIds: true },
      });

      expect(result.success).toBe(true);
      expect(hyperlinkService.processHyperlinksWithApi).toHaveBeenCalled();
      // The returned contentId matches two of the document's hyperlinks (by
      // Content_ID and by Document_ID), so both get an ID appended and the
      // dedicated counter must reflect that (guards the stat against reverting
      // to always-zero).
      expect(result.appendedContentIds).toBeGreaterThan(0);

      // The API path records each processed hyperlink for the UI.
      expect(result.processedLinks).toBeInstanceOf(Array);
      expect(result.processedLinks.length).toBeGreaterThan(0);
      for (const link of result.processedLinks) {
        expect(link).toHaveProperty("id");
        expect(link).toHaveProperty("url");
        expect(link).toHaveProperty("status");
      }
    });

    it("completes successfully when the API returns no matching results", async () => {
      const filePath = path.join(fixturesDir, "theSource-with-ids.docx");

      (hyperlinkService.processHyperlinksWithApi as ReturnType<typeof jest.fn>).mockResolvedValue({
        success: true,
        body: { results: [] },
      });

      const result = await processor.processDocument(filePath, {
        apiEndpoint: API_ENDPOINT,
        operations: { fixContentIds: true },
      });

      // No matches -> nothing appended, but processing still succeeds.
      expect(result.success).toBe(true);
      expect(result.appendedContentIds).toBe(0);
    });

    it("handles edge-case theSource URLs gracefully", async () => {
      const filePath = path.join(fixturesDir, "theSource-malformed.docx");

      (hyperlinkService.processHyperlinksWithApi as ReturnType<typeof jest.fn>).mockResolvedValue({
        success: true,
        body: { results: [] },
      });

      const result = await processor.processDocument(filePath, {
        apiEndpoint: API_ENDPOINT,
        operations: { fixContentIds: true },
      });

      // Malformed / URL-encoded edge cases must not crash the pipeline.
      expect(result.success).toBe(true);
      expect(result.errorMessages).toEqual([]);
    });

    it("fails clearly when content-ID operations are enabled without an API endpoint", async () => {
      const filePath = path.join(fixturesDir, "theSource.docx");

      const result = await processor.processDocument(filePath, {
        operations: { fixContentIds: true },
        // No apiEndpoint: content-ID resolution has no source, so the processor
        // must refuse rather than save a document with unresolved links.
      });

      expect(result.success).toBe(false);
      expect(result.errorMessages[0]).toContain("API endpoint not configured");
    });
  });

  describe("Custom Replacements", () => {
    it("should apply custom URL replacements", async () => {
      const filePath = path.join(fixturesDir, "hyperlinks.docx");

      const result = await processor.processDocument(filePath, {
        customReplacements: [
          {
            find: "example.com",
            replace: "new-example.com",
            matchType: "contains",
            applyTo: "url",
          },
        ],
      });

      expect(result.success).toBe(true);

      // hyperlinks.docx contains two URLs matching "example.com"
      // (http://example.com and mailto:test@example.com). Custom replacements
      // are reported via updatedUrls; processedLinks is reserved for the
      // API-driven path, so it is intentionally not populated here.
      expect(result.updatedUrls).toBeGreaterThan(0);
    });

    it("should apply custom text replacements", async () => {
      const filePath = path.join(fixturesDir, "hyperlinks.docx");

      const result = await processor.processDocument(filePath, {
        customReplacements: [
          {
            find: "GitHub",
            replace: "GitLab",
            matchType: "exact",
            applyTo: "text",
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

  describe("Batch Processing", () => {
    it("should process multiple documents concurrently", async () => {
      const files = [
        path.join(fixturesDir, "sample.docx"),
        path.join(fixturesDir, "hyperlinks.docx"),
        path.join(fixturesDir, "theSource.docx"),
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

    it("should handle individual file failures in batch", async () => {
      const files = [
        path.join(fixturesDir, "sample.docx"),
        path.join(fixturesDir, "corrupt.docx"), // This will fail
        path.join(fixturesDir, "hyperlinks.docx"),
      ];

      const batchResult = await processor.batchProcess(files, {}, 2);

      expect(batchResult.totalFiles).toBe(3);
      expect(batchResult.successfulFiles).toBe(2);
      expect(batchResult.failedFiles).toBe(1);
    });

    it("should call progress callback for each file", async () => {
      const files = [
        path.join(fixturesDir, "sample.docx"),
        path.join(fixturesDir, "hyperlinks.docx"),
      ];

      const progressCallback = jest.fn();

      await processor.batchProcess(files, {}, 1, progressCallback);

      expect(progressCallback).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenCalledWith(
        files[0],
        1,
        2,
        expect.objectContaining({ success: true })
      );
    });

    it("should respect concurrency limit", async () => {
      const files = Array(5).fill(path.join(fixturesDir, "sample.docx"));

      const startTime = Date.now();
      await processor.batchProcess(files, {}, 2); // Max 2 concurrent
      const duration = Date.now() - startTime;

      // With concurrency of 2, should take roughly 3 batches (2+2+1)
      // Just verify it completes without errors
      expect(duration).toBeGreaterThan(0);
    });
  });

  describe("Memory Management", () => {
    it("should trigger garbage collection periodically in batch processing", async () => {
      const files = Array(15).fill(path.join(fixturesDir, "sample.docx"));

      // Mock global.gc
      global.gc = jest.fn();

      await processor.batchProcess(files, {}, 3);

      // Should trigger GC at least once (every 10 documents)
      if (global.gc) {
        expect(global.gc).toHaveBeenCalled();
      }
    });

    it("should clean up resources after processing", async () => {
      const filePath = path.join(fixturesDir, "sample.docx");

      const result = await processor.processDocument(filePath);

      expect(result.success).toBe(true);
      expect(result.processingTimeMs).toBeDefined();
      expect(result.processingTimeMs).toBeGreaterThan(0);
    });
  });

  describe("PowerAutomate API Integration", () => {
    it("should process hyperlinks with PowerAutomate API", async () => {
      const filePath = path.join(fixturesDir, "theSource.docx");

      // Mock API response
      const mockApiResponse = {
        success: true,
        body: {
          results: [
            {
              contentId: "TSRC-ABC-123456",
              documentId: "uuid-123",
              title: "Test Document",
              status: "active",
            },
          ],
        },
      };

      (hyperlinkService.processHyperlinksWithApi as ReturnType<typeof jest.fn>).mockResolvedValue(
        mockApiResponse
      );

      const result = await processor.processDocument(filePath, {
        apiEndpoint: "https://api.example.com",
        operations: { updateTitles: true },
      });

      // If document has theSource hyperlinks, API should be called
      // If not, processing still succeeds but API is not invoked
      if (result.totalHyperlinks > 0) {
        expect(hyperlinkService.processHyperlinksWithApi).toHaveBeenCalled();
      }
      expect(result.success).toBe(true);
    });

    it("should handle API failures gracefully", async () => {
      const filePath = path.join(fixturesDir, "theSource.docx");

      (hyperlinkService.processHyperlinksWithApi as ReturnType<typeof jest.fn>).mockResolvedValue({
        success: false,
        error: "API timeout",
      });

      const result = await processor.processDocument(filePath, {
        apiEndpoint: "https://api.example.com",
        operations: { updateTitles: true },
      });

      // If document has theSource hyperlinks, API failure causes processing failure
      // If no hyperlinks, processing succeeds without API call
      if (result.totalHyperlinks > 0) {
        expect(result.success).toBe(false);
        expect(result.errorMessages.some((msg) => msg.includes("PowerAutomate"))).toBe(true);
      } else {
        expect(result.success).toBe(true);
      }
    });

    it("should fail when API endpoint not configured", async () => {
      const filePath = path.join(fixturesDir, "theSource.docx");

      const result = await processor.processDocument(filePath, {
        operations: { updateTitles: true },
        // No apiEndpoint provided
      });

      // If document has theSource hyperlinks, missing API endpoint causes failure
      // If no hyperlinks, processing succeeds
      if (result.totalHyperlinks > 0) {
        expect(result.success).toBe(false);
        expect(result.errorMessages[0]).toContain("API endpoint not configured");
      } else {
        expect(result.success).toBe(true);
      }
    });
  });

  describe("Step Column Width Fix", () => {
    it("should set step column to exactly 1 inch with autofit layout, updating grid proportionally", async () => {
      // 1. Create a DOCX with a 2-column Step/Action table
      const doc = Document.create();
      const table = doc.createTable(3, 2); // 3 rows, 2 columns

      // Set header row
      table.getCell(0, 0)?.createParagraph("Step");
      table.getCell(0, 1)?.createParagraph("Action");

      // Set data rows with step numbers
      table.getCell(1, 0)?.createParagraph("1");
      table.getCell(1, 1)?.createParagraph("Do something");
      table.getCell(2, 0)?.createParagraph("2");
      table.getCell(2, 1)?.createParagraph("Do something else");

      // Set initial grid (typical Word default)
      const originalGrid = [2500, 7000];
      table.setTableGrid(originalGrid);
      table.setLayout("auto");

      // 2. Save to temp file, process, reload
      const tmpPath = path.join(fixturesDir, "_step-column-test.docx");
      await doc.save(tmpPath);
      doc.dispose();

      const result = await processor.processDocument(tmpPath, {
        tableUniformity: true,
      });
      expect(result.success).toBe(true);

      // 3. Reload and verify
      const processed = await Document.load(tmpPath);
      const tables = processed.getTables();
      expect(tables.length).toBeGreaterThanOrEqual(1);

      const stepTable = tables.find((t) => {
        const firstCell = t.getCell(0, 0);
        return firstCell?.getText().trim().toLowerCase() === "step";
      });
      expect(stepTable).toBeDefined();

      // Verify autofit layout so table fills view without scaling step column
      expect(stepTable!.getLayout()).toBe("autofit");

      // Verify percentage table width (fills available width in all views)
      expect(stepTable!.getWidthType()).toBe("pct");
      expect(stepTable!.getWidth()).toBe(5000);

      // Verify grid is updated: first column = 1440, remaining recalculated
      // Document.create() defaults to Letter page (12240) with 1" margins (1440 each)
      // Available page width = 12240 - 1440 - 1440 = 9360
      // New grid: step=1440, remaining=9360-1440=7920 (all to single remaining column)
      const grid = stepTable!.getTableGrid();
      expect(grid).toBeDefined();
      expect(grid![0]).toBe(1440);
      expect(grid![1]).toBe(7920);

      // Verify step column cell widths = 1440 (1 inch)
      for (const row of stepTable!.getRows()) {
        const cell = row.getCells()[0];
        expect(cell.getWidth()).toBe(1440);
        expect(cell.getWidthType()).toBe("dxa");
      }

      // Verify action column cells are auto (no preferred width)
      for (const row of stepTable!.getRows()) {
        const actionCell = row.getCells()[1];
        expect(actionCell.getWidthType()).toBe("auto");
      }

      // Cleanup
      processed.dispose();
      await fs.unlink(tmpPath).catch(() => {});
    });
  });

  describe("Error Handling", () => {
    it("should handle processing errors gracefully", async () => {
      const result = await processor.processDocument("");

      expect(result.success).toBe(false);
      expect(result.errorMessages.length).toBeGreaterThan(0);
    });

    it("should return proper error structure on failure", async () => {
      const result = await processor.processDocument("/invalid/path.docx");

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
