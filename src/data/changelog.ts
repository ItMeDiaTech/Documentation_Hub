/**
 * User-facing changelog shown in the "What's New" popup after an update.
 *
 * Audience: everyday users, not developers. Keep every line short, plain, and
 * about what the change means for their documents — no code, file names, or
 * framework/API references. `areas` are the document-related things a release
 * touched (rendered as chips); `highlights` are 1–4 concise sentences.
 *
 * Newest release first. Keep to the last 10 releases. When cutting a new
 * release, add its entry at the top and drop the oldest.
 */
export interface ChangelogEntry {
  /** Bare semver, e.g. "6.1.11". Displayed with a leading "v" by the UI. */
  version: string;
  /** Release date, ISO `YYYY-MM-DD`. */
  date: string;
  /** Document-related areas this release affected (shown as chips). */
  areas: string[];
  /** Plain-language, concise summary lines. */
  highlights: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "6.1.12",
    date: "2026-07-01",
    areas: ["Backups"],
    highlights: [
      "Document backups now reliably save to a “DocHub_Backups” folder in your Downloads folder.",
      "If that folder can’t be created, the backup is saved next to the document being processed instead, so you always get a backup.",
    ],
  },
  {
    version: "6.1.11",
    date: "2026-07-01",
    areas: ["Blank line spacing", "Fonts and headings", "Tables", "Images", "Tracked changes"],
    highlights: [
      "Small images used as inline callouts now stay tucked against the list item they belong to instead of drifting away with an extra blank line.",
      "Text that follows a Heading 3 is no longer accidentally bolded when it sits inside a table.",
      "Removed stray blank lines that could appear around images marked as deleted in tracked changes.",
    ],
  },
  {
    version: "6.1.10",
    date: "2026-07-01",
    areas: ["Hyperlinks", "Lists and numbering", "Backups", "Stability"],
    highlights: [
      "Numbered lists keep counting correctly across continued sections, and tiered and legal-style numbering follow the right pattern.",
      "The “content IDs added” figure on the hyperlink summary now reflects the real number instead of always showing zero.",
      "Backups, cancelling a run partway through, and saving the changes report are more reliable, and error details are easier to read when something goes wrong.",
    ],
  },
  {
    version: "6.1.9",
    date: "2026-06-30",
    areas: ["Stability"],
    highlights: [
      "A behind-the-scenes reliability release. Nothing changes in how you work with your documents.",
    ],
  },
  {
    version: "6.1.7",
    date: "2026-06-04",
    areas: ["Updates"],
    highlights: [
      "A maintenance release that confirms the automatic-update fix from 6.1.6 works end to end. No changes to document processing.",
    ],
  },
  {
    version: "6.1.6",
    date: "2026-06-04",
    areas: ["Updates"],
    highlights: [
      "Automatic updates now install reliably: the new version is launched the same way as double-clicking the installer, which some managed work computers previously blocked.",
      "Old, already-downloaded installers are cleared out on startup to save space.",
    ],
  },
  {
    version: "6.1.5",
    date: "2026-06-04",
    areas: ["Updates"],
    highlights: [
      "A maintenance release to verify the automatic-update fix from 6.1.4. No changes to document processing.",
    ],
  },
  {
    version: "6.1.4",
    date: "2026-06-04",
    areas: ["Updates", "Images", "Backups", "Lists and numbering"],
    highlights: [
      "Fixed automatic updates so the new version installs correctly instead of silently failing.",
      "Centered images no longer shift to the left after a document is processed.",
      "Document backups are now saved to your Downloads folder, in a “DocHub_Backups” folder, so they’re easy to find.",
      "Second-level bullets now use a small filled square by default for a cleaner look (applies to new sessions).",
    ],
  },
  {
    version: "6.1.3",
    date: "2026-05-30",
    areas: ["Hyperlinks", "Images", "Borders", "Blank line spacing"],
    highlights: [
      "Images inside tracked insertions now get the same border as every other image.",
      "Section-navigation links (such as “Financial” or “Other”) are no longer lost when a document is opened and saved.",
      "A vertical list of links stays together without an extra blank line between each one.",
      "The single space in front of a link is kept, so words no longer run together.",
    ],
  },
  {
    version: "6.1.2",
    date: "2026-05-29",
    areas: ["Hyperlinks", "Table of contents", "Lists and numbering", "Sessions"],
    highlights: [
      "Table-of-contents entries are kept intact when a document is saved.",
      "Numbered lists more closely mirror the original document’s numbering.",
      "Your latest saved profile is used when looking up hyperlinks.",
      "Adding documents to a session scrolls back to the top and shows the total count.",
    ],
  },
];
