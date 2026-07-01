import { CHANGELOG } from "@/data/changelog";
import {
  formatVersionLabel,
  getChangelogEntry,
  shouldShowWhatsNew,
} from "@/utils/whatsNew";

describe("formatVersionLabel", () => {
  it("prefixes a bare semver with 'v'", () => {
    expect(formatVersionLabel("6.1.11")).toBe("v6.1.11");
    expect(formatVersionLabel("29.2.1")).toBe("v29.2.1");
  });
});

describe("changelog data", () => {
  it("stores the last 10 releases", () => {
    expect(CHANGELOG).toHaveLength(10);
  });

  it("is ordered newest first and has no duplicate versions", () => {
    const versions = CHANGELOG.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("gives every entry a date, at least one area, and at least one highlight", () => {
    for (const entry of CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.areas.length).toBeGreaterThan(0);
      expect(entry.highlights.length).toBeGreaterThan(0);
    }
  });

  it("looks up an entry by version", () => {
    expect(getChangelogEntry("6.1.11")?.version).toBe("6.1.11");
    expect(getChangelogEntry("0.0.0")).toBeUndefined();
  });
});

describe("shouldShowWhatsNew", () => {
  const base = {
    enabled: true,
    currentVersion: "6.1.11",
    lastSeenVersion: null,
    hasEntry: true,
  };

  it("shows on a fresh install (no version seen yet)", () => {
    expect(shouldShowWhatsNew(base)).toBe(true);
  });

  it("shows after upgrading to a newer documented version", () => {
    expect(shouldShowWhatsNew({ ...base, lastSeenVersion: "6.1.10" })).toBe(true);
  });

  it("does not show again for a version already dismissed", () => {
    expect(shouldShowWhatsNew({ ...base, lastSeenVersion: "6.1.11" })).toBe(false);
  });

  it("does not show when the setting is off", () => {
    expect(shouldShowWhatsNew({ ...base, enabled: false })).toBe(false);
  });

  it("does not show when the running version is unknown", () => {
    expect(shouldShowWhatsNew({ ...base, currentVersion: null })).toBe(false);
  });

  it("does not show when the version has no changelog entry", () => {
    expect(shouldShowWhatsNew({ ...base, hasEntry: false })).toBe(false);
  });
});
