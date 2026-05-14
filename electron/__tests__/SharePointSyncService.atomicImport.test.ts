/**
 * @jest-environment node
 *
 * Regression test for SharePointSyncService atomic-import rollback.
 *
 * The contract: when DictionaryService.importEntries(..., { clearFirst: true })
 * fails (e.g. malformed row halfway through), the SQLite transaction in
 * importEntries rolls back the leading `DELETE FROM dictionary`, so the
 * caller (this service) must surface the failure rather than report success
 * with an empty dictionary.
 *
 * We test the SharePointSyncService → DictionaryService boundary by stubbing
 * the dictionary service. The transactional atomicity itself is owned by
 * better-sqlite3 inside DictionaryService.
 *
 * NOTE: This file lives in electron/__tests__/ and is currently excluded
 * by jest.config.js `roots`. Task 12 widens the roots to include it.
 */

// ─── Mocks ───────────────────────────────────────────────────────────

const mockImportEntries = jest.fn();
const mockInitialize = jest.fn().mockResolvedValue({ success: true, totalEntries: 0 });
const mockGetMetadata = jest.fn().mockReturnValue(null);
const mockSetMetadata = jest.fn();
const mockUpdateSyncStatus = jest.fn();

jest.mock("../services/DictionaryService", () => ({
  getDictionaryService: jest.fn(() => ({
    initialize: mockInitialize,
    importEntries: mockImportEntries,
    getMetadata: mockGetMetadata,
    setMetadata: mockSetMetadata,
    updateSyncStatus: mockUpdateSyncStatus,
  })),
}));

jest.mock("electron", () => ({
  app: {
    getPath: jest.fn().mockReturnValue("/tmp/test-app-data"),
  },
  BrowserWindow: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  logger: {
    namespace: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

jest.mock("@azure/msal-node", () => ({
  ConfidentialClientApplication: jest.fn().mockImplementation(() => ({
    acquireTokenByClientCredential: jest.fn().mockResolvedValue({
      accessToken: "test-token",
    }),
  })),
}));

jest.mock("xlsx", () => ({
  read: jest.fn().mockReturnValue({
    SheetNames: ["Sheet1"],
    Sheets: { Sheet1: {} },
  }),
  utils: {
    sheet_to_json: jest.fn().mockReturnValue([
      { Document_ID: "DOC-001", Title: "Sample" },
    ]),
  },
}));

import { SharePointSyncService } from "../services/SharePointSyncService";

// ─── Tests ───────────────────────────────────────────────────────────

describe("SharePointSyncService atomic-import rollback", () => {
  let service: SharePointSyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMetadata.mockReturnValue(null);
    service = new SharePointSyncService();
    service.configure({
      clientId: "test-client",
      tenantId: "test-tenant",
      siteUrl: "https://example.sharepoint.com",
      filePath: "/dict.xlsx",
    } as any);
    service.setClientSecret("test-secret");

    // Stub the private downloadFile so we don't hit Graph API in the test.
    (service as any).downloadFile = jest
      .fn()
      .mockResolvedValue(Buffer.from("fake-excel"));
  });

  it("propagates import failure with clearFirst:true so caller knows old data may be intact", async () => {
    // Simulate the DictionaryService transaction returning `success: false`
    // after a row-level failure rolled back the leading DELETE.
    mockImportEntries.mockReturnValue({
      success: false,
      imported: 0,
      error: "Malformed row at index 42",
    });

    const result = await service.sync();

    // importEntries was called with clearFirst:true — that's the contract
    // we rely on for atomicity.
    expect(mockImportEntries).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Function),
      { clearFirst: true }
    );

    // The sync surfaces the failure — does NOT silently report 0 imports
    // as success.
    expect(result.success).toBe(false);
    expect(result.entriesImported).toBe(0);
    expect(result.error).toContain("Malformed row at index 42");

    // Sync metadata was NOT updated with a new fileHash on failure
    // (would otherwise lock the dictionary into a permanently-empty state
    // because the next sync would see "hash unchanged" and skip).
    expect(mockSetMetadata).not.toHaveBeenCalledWith("fileHash", expect.anything());
  });

  it("on successful import, does pass clearFirst:true and stores the new file hash", async () => {
    mockImportEntries.mockReturnValue({
      success: true,
      imported: 1,
    });

    const result = await service.sync();

    expect(mockImportEntries).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Function),
      { clearFirst: true }
    );
    expect(result.success).toBe(true);
    expect(result.entriesImported).toBe(1);
    expect(mockSetMetadata).toHaveBeenCalledWith("fileHash", expect.any(String));
  });
});
