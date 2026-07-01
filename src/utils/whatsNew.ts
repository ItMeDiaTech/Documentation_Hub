import { CHANGELOG, type ChangelogEntry } from "@/data/changelog";

/**
 * localStorage key holding the app version for which the user last saw (and
 * dismissed) the "What's New" popup. When the running version differs from
 * this, the popup is shown once, then this is set to the running version.
 */
export const WHATS_NEW_STORAGE_KEY = "whatsNewLastSeenVersion";

/** Render a bare semver as the app displays it, e.g. "6.1.11" -> "v6.1.11". */
export function formatVersionLabel(version: string): string {
  return `v${version}`;
}

/** The changelog entry for a specific version, if one exists. */
export function getChangelogEntry(version: string): ChangelogEntry | undefined {
  return CHANGELOG.find((entry) => entry.version === version);
}

export interface ShouldShowWhatsNewArgs {
  /** The "Show What's New after updating" user setting. */
  enabled: boolean;
  /** The version currently running (from the app), or null if unknown. */
  currentVersion: string | null | undefined;
  /** The version the popup was last dismissed for, or null on a fresh install. */
  lastSeenVersion: string | null | undefined;
  /** Whether the changelog has an entry describing the current version. */
  hasEntry: boolean;
}

/**
 * Decide whether to show the "What's New" popup on launch.
 *
 * Shows only when the feature is enabled, the running version is known and
 * documented in the changelog, and it differs from the version last dismissed.
 * A fresh install has no stored version, so any documented version shows once;
 * every later launch on the same version is suppressed once dismissed.
 */
export function shouldShowWhatsNew({
  enabled,
  currentVersion,
  lastSeenVersion,
  hasEntry,
}: ShouldShowWhatsNewArgs): boolean {
  if (!enabled) return false;
  if (!currentVersion) return false;
  if (!hasEntry) return false;
  return currentVersion !== lastSeenVersion;
}
