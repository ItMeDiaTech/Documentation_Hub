/**
 * @jest-environment node
 *
 * Regression test for BackupService.listBackups prefix collision.
 *
 * Backups are named `{originalName}_{timestamp}_{hash}.{ext}`. Filtering
 * by `documentName + "_"` (vs the older `documentName` startsWith check)
 * prevents "Report" backups from matching "Report_v2" backups.
 *
 * NOTE: This file lives in electron/__tests__/ and is currently excluded
 * by jest.config.js `roots`. Task 12 widens the roots to include it.
 */

import * as path from "node:path";
import * as fsPromises from "node:fs/promises";
import { BackupService } from "../services/BackupService";

jest.mock("node:fs/promises");

jest.mock("electron", () => ({
  app: {
    getPath: jest.fn().mockReturnValue("/tmp/test-app-data"),
  },
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

describe("BackupService.listBackups prefix collision", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // node:fs/promises named exports are getter-only under Node 22, so reassign
    // the property reference fails. The jest.mock auto-mock already makes mkdir
    // a jest.fn(); just configure its resolved value instead of reassigning.
    (fsPromises.mkdir as jest.Mock).mockResolvedValue(undefined);
  });

  it("does not return Report_v2 backups when listing Report backups", async () => {
    const dirContents = [
      "Report_2024-01-01T12-00-00-000Z_abc12345.docx",
      "Report_2024-01-02T12-00-00-000Z_def67890.docx",
      "Report_v2_2024-01-01T12-00-00-000Z_ghi11111.docx",
      "Report_v2_2024-01-02T12-00-00-000Z_jkl22222.docx",
    ];
    (fsPromises.readdir as jest.Mock).mockResolvedValue(dirContents);
    (fsPromises.stat as jest.Mock).mockResolvedValue({
      mtime: new Date("2024-01-01T12:00:00Z"),
      birthtime: new Date("2024-01-01T12:00:00Z"),
      size: 1234,
    });
    // getBackupMetadata reads a sibling .meta file — make those reads fail
    // gracefully so the listing falls back to filename-only data.
    (fsPromises.readFile as jest.Mock).mockRejectedValue(new Error("no meta"));

    const service = new BackupService();
    const documentPath = path.join("/docs", "Report.docx");
    const results = await service.listBackups(documentPath);

    const filenames = results.map((r) => r.filename);
    expect(filenames).toContain("Report_2024-01-01T12-00-00-000Z_abc12345.docx");
    expect(filenames).toContain("Report_2024-01-02T12-00-00-000Z_def67890.docx");
    // Critical assertion: NO Report_v2 backup leaked in.
    expect(filenames).not.toContain(
      "Report_v2_2024-01-01T12-00-00-000Z_ghi11111.docx"
    );
    expect(filenames).not.toContain(
      "Report_v2_2024-01-02T12-00-00-000Z_jkl22222.docx"
    );
    expect(filenames).toHaveLength(2);
  });

  it("does not match a Report.meta sidecar for the v2 case", async () => {
    // The .meta exclusion is independent of the underscore guard — verify
    // both filters cooperate.
    (fsPromises.readdir as jest.Mock).mockResolvedValue([
      "Report_2024-01-01T12-00-00-000Z_abc12345.docx",
      "Report_2024-01-01T12-00-00-000Z_abc12345.docx.meta",
      "Report_v2_2024-01-01T12-00-00-000Z_def67890.docx",
    ]);
    (fsPromises.stat as jest.Mock).mockResolvedValue({
      mtime: new Date(),
      birthtime: new Date(),
      size: 1234,
    });
    (fsPromises.readFile as jest.Mock).mockRejectedValue(new Error("no meta"));

    const service = new BackupService();
    const results = await service.listBackups(path.join("/docs", "Report.docx"));

    expect(results.map((r) => r.filename)).toEqual([
      "Report_2024-01-01T12-00-00-000Z_abc12345.docx",
    ]);
  });
});
