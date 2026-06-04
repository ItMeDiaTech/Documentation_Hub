# Documentation Hub - Version History

All notable changes to the Documentation Hub application are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Current App Version:** 6.1.7
**docxmlater Framework Version:** ^11.0.10
**Status:** Production Ready

---

## [6.1.7] - 2026-06-04

### Changed

- Maintenance release to validate the 6.1.6 auto-update fix end-to-end (6.1.6 → 6.1.7). No functional code changes.

## [6.1.6] - 2026-06-04

### Fixed

- **Auto-update now launches the installer reliably.** The downloaded MSI is launched through the OS shell (the same as double-clicking it) instead of via a detached `cmd.exe`, which could be blocked by policy or killed on exit on locked-down/managed machines (the 6.1.4 failure). The MSI's own finish action relaunches the app; DocHub closes once the installer is running so Windows Installer can replace the locked files.

### Changed

- On startup, stale downloaded installers (current or older versions) are removed from the updater cache to keep it tidy.

## [6.1.5] - 2026-06-04

### Changed

- Maintenance release to validate the 6.1.4 auto-update fix end-to-end (6.1.4 → 6.1.5). No functional code changes.

## [6.1.4] - 2026-06-04

### Fixed

- **Auto-update now installs the MSI correctly.** electron-updater 6.x ships no MSI updater; its default NSIS handler ran the downloaded MSI as a PE executable, which silently failed (the source of the "MSI error 2753" symptom). `CustomUpdater.quitAndInstall()` now installs the downloaded MSI the only way an MSI installs — `msiexec /i "<installer>" /passive /norestart` in a detached process — then relaunches the app itself. `autoInstallOnAppQuit` is disabled so electron-updater's install-on-quit path no longer collides with our `msiexec` call.
- **Centered images no longer render left-aligned after processing.** When an image's paragraph carried a tracked paragraph-mark deletion, the blank-line normalizer's preservation fallback could insert a left-aligned blank into that paragraph's render-time merge slot; Word then merged the image into the blank and rendered it left. The preservation fallback now honors the deleted-mark merge-slot guard already used by every other blank-line insertion path (`BlankLineManager`).

### Changed

- **Document backups now go to your Downloads folder.** `createBackup()` writes the `DocHub_Backups` folder under the user's Downloads directory (resolved via `app.getPath("downloads")`), falling back to the document's own directory when Downloads can't be resolved (tests / browser-only mode). The Settings backup description was updated to match.
- **List level 2 now defaults to a closed square (■) bullet** (was a closed bullet), in both the Styles UI and the backend session defaults. Applies to new sessions; existing sessions keep their saved bullet settings.

## [6.1.3] - 2026-05-30

### Fixed

- **Image borders now apply to images inside tracked insertions.** Images within tracked changes (`w:ins`) previously kept no border after processing; they are now bordered like the rest (docxmlater 11.0.10).
- **Linked navigation entries are no longer dropped on processing.** Consecutive section links (e.g. "Financial" / "Other") were emptied when a document was loaded and saved, due to a complex-field hyperlink round-trip bug in the framework. Fixed in docxmlater 11.0.10.
- **No blank line is inserted between consecutive hyperlink-only lines.** `betweenBodyParagraphsRule` now keeps a vertical list of standalone links (a section navigation menu) tight, instead of separating each entry with a blank line. Added `isHyperlinkOnlyParagraph` guard in `helpers/paragraphChecks.ts`.
- **The space before a hyperlink is preserved.** `WordDocumentProcessor.detectContentGaps()` now treats a hyperlink or tracked-insertion (`w:ins`) boundary as a content gap, so the whitespace normalizer no longer removes the single space in front of a hyperlink (including hyperlinks inside tracked changes — e.g. "the Senior Team" no longer became "theSenior Team").

### Changed

- docxmlater dependency upgraded to `^11.0.10` (was `^11.0.7`). Includes the table-corruption-on-accept fix (11.0.8), tracked-insertion image border/size fix (11.0.9), and the chained complex-field hyperlink round-trip fix (11.0.10).

## [5.12.2] - 2026-05-14

### Added

- **Style Defaults**: Normal paragraph spacing now defaults to 6pt before/after; Heading 2 defaults to 9pt before/after (was inherited)
- **paragraphRuns Helper**: New `helpers/paragraphRuns.ts` consolidates `getBodyRuns` and `getVisibleRuns` revision-safe iterators — single replacement for three duplicated paragraph-walk implementations across WordDocumentProcessor, StyleProcessor, and ListProcessor
- **applyRunFmtPreservingHyperlink Helper**: New `helpers/applyRunFormattingPreservingHyperlink.ts` replaces the 5x-duplicated table-cell formatting block in TableProcessor; preserves hyperlink color/underline when re-applying font/size
- **withTimeout / withAbortableTimeout**: Extracted from inline session-helper code; `withAbortableTimeout` exposes an `AbortSignal` so consumers can cancel underlying work on timeout
- **Min Column-Width Pass**: New table phase enforces minimum per-column widths by redistributing surplus into deficit columns; merged into the existing cell-width normalization pass
- **Lazy-Loaded WordDocumentProcessor**: Main process now `await import()`s the processor on first IPC call instead of statically importing on boot — measurable cold-start improvement
- **ESLint Main-Process Boundary Rule**: Forbids static imports of `WordDocumentProcessor` from `electron/main.ts` to prevent regression of the lazy-load
- **Test Infrastructure**:
  - Jest `roots` widened to include `electron/` and `scripts/` (electron IPC + main-process tests were silently excluded before)
  - Per-file coverage thresholds (70% for `src/services/**`, 60% for `electron/services/**`)
  - Husky pre-commit hook running typecheck
  - GitHub Actions `validate-tag` job blocks tag pushes where `package.json` version ≠ git tag
  - `electron/__tests__/version-consistency.test.ts` asserts semver-shaped version
  - `scripts/validate-msi-config.js` pins MSI `upgradeCode` to canonical GUID
  - `scripts/release.sh` extracted from cross-shell `package.json` script — `set -euo pipefail` with existence checks
  - `.nvmrc` pins Node 22 to match CI
  - `docs/operations/code-signing.md` documents the deferred signing path
- **Coverage**: New unit tests for `paragraphRuns`, `withTimeout`, `applyRunFmtPreservingHyperlink`, plus SessionContext render-count and tri-state update regressions

### Changed

- **Stats Label**: "Time Saved from Hyperlinks" renamed to "Hyperlink Time Saved" for consistency with sibling labels
- **IPC Channel Rename**: `process-document` → `document:get-stats` (the former name was misleading; this handler only computes statistics, no processing)
- **SessionContext State Updates**: Spread order fix, document dedup in `addDocuments`, awaited IndexedDB delete with surfaced errors
- **TypeScript Config**: `moduleResolution: "node10"`, dropped `ignoreDeprecations` and unused `baseUrl`
- **Dropped Unused Deps**: `all`, `docx`, `mammoth`, `react-router` (we use `react-router-dom`)

### Fixed

- **Electron Hardening**: `sandbox: true`, strict CSP, async `fs.stat` instead of sync, `node:` prefix on all builtin imports
- **Italic via Hyperlink-Preserving Helper**: TableProcessor italic application now routed through `applyRunFmtPreservingHyperlink` (previously bypassed the helper, could drop hyperlink color)
- **Roman-Numeral Detection**: Bounded list-prefix Roman parsing to avoid matching very long mixed-character runs
- **Session Stats**: Fallback for undefined `stats.timeSaved`; deduped minutes calc

---

## [5.10.0] - 2026-04-15

### Refactored

- **List Category Preservation**: Each list item now preserves its own category (bullet/numbered); cross-type uniformity logic removed since mixing is now allowed
- **Vestigial Removals**: `convertMixedListFormats` (no-op since v5.8.0) and orphan `convertNestedNumbersToBullets` methods deleted

### Fixed

- **Editor Cell Shading**: Now persisted via `setBackgroundColor` (the `setShading` API requires a `ShadingConfig` object, not a hex string)
- **CleanupHelper**: Dropped dead `defragmentHyperlinks` flag from post-tracking run

---

## [5.9.0] - 2026-03-20

### Added

- **docxmlater v11 Alignment**: Upgraded to docxmlater ^11.0.4 and aligned internal APIs

### Fixed

- **Image Crop**: Border-detection tightened to fix false positives
- **Top of Document Hyperlinks**: Updated handler
- **Step Numbering**: Order fixes
- **Blank Line Rules**: Refinements
- **Bullet Indent**: Edge-case fixes
- **Build**: `manualChunks` function format corrected; `react-is` added as explicit dep

---

## [5.8.0] - 2026-02-24

### Fixed

- **Hyperlink Duplication in Cross-Paragraph Chains**: Rewrote `deduplicateComplexFieldHyperlinks()` to be type-agnostic — now detects Hyperlink + ComplexField mixed-type duplicates (not just ComplexField pairs), with raw field run fallback for unrecognized content types
- **Hyperlink Defragmentation + Tracked Changes**: Moved `defragmentHyperlinks()` before tracking is enabled since the library silently skips it when tracking is active
- **Trailing Punctuation in Hyperlinks**: Hyperlinks ending with `.` or `,` now extract trailing punctuation outside the hyperlink as normal text
- **Duplicate Blank Line Insertion**: Blank line rules now check if the element at the insertion position is already blank before inserting
- **Disclaimer Deduplication**: `aboveWarningRule` no longer inserts blank between consecutive disclaimer lines
- **Blank Line Snapshot Indexing**: Fixed off-by-one in `wasOriginallyBlankAtBody()` and `wasOriginallyBlankInCell()` — element following an inserted blank is at the current index, not index+1
- **Table Cell Numbering Corruption**: Save/restore mechanism preserves numId/level in table cells before `applyStyles()` since the framework can corrupt numbering via style defaults
- **List Level Shift Sub-Item Exclusion**: Fixed level shift recalculation to exclude detected sub-items, preventing parent bullets from being blocked at higher levels
- **Restart Numbering Per Cell**: Table cells with Word lists now restart numbering to prevent cross-cell continuation (e.g., "5." when it should be "1.")
- **Space-Only Run Merging**: Pre-pass merges space-only runs into adjacent text runs to prevent framework defragmentation from dropping them
- **NBSP Whitespace Handling**: NBSP (U+00A0) now treated like regular space for collapsing and cross-run double-space detection
- **Cross-Run Gap Awareness**: Whitespace normalization skips collapsing across invisible content gaps (Revision-wrapped hyperlinks)
- **Paragraph Blank Detection**: Removed bookmark checks from `isParagraphBlank()` — bookmarks are invisible metadata and should not affect blank status
- **Bold Colon False Positives**: `startsWithBoldColon()` now skips ImageRun items when finding the first text run
- **Hyperlink Formatting Safety Net**: Re-applies hyperlink formatting (Verdana 12pt, blue, underline) after `applyStyles()` since the framework can clear direct formatting
- **Image Baked-In Border Detection**: New `hasAllSideBakedBorder()` check prevents redundant Word borders on images that already have dark pixel borders on all 4 edges

### Added

- **Content ID Reference Appending**: New operation path appends Content IDs (last 6 digits) to hyperlinks when API returns contentId but "Update Titles" is disabled
- **Small Image + Text Blank Rule**: New `aboveSmallImageTextRule` ensures spacing above callout/notice paragraphs containing small images with text
- **VML Image Run Support**: Whitespace normalization now detects VML drawing runs (legacy inline images) and inserts space after them
- **Em/En Variant NBSP Normalization**: `removeEmEnVariants()` now includes NBSP (U+00A0) alongside em/en dash and space variants
- **Hyperlink Defragmentation Tracking**: Defragmentation results logged to `result.mergedHyperlinks` and tracked in change history
- **Tracking Disabled for Cosmetic Operations**: Hyperlink formatting standardization and document warning insertion temporarily disable tracking to prevent cosmetic tracked changes

### Improved

- **Test Infrastructure**: Migrated all test suites from Vitest to Jest (`vi.mock` → `jest.mock`, `Mocked<T>` → `jest.Mocked<T>`)
- **Nested Table Detection**: Replaced `tableHasNestedContent()` with direct `cell.hasNestedTables()` throughout BlankLineManager
- **Image Border Cropping**: Dynamic scan depth based on image size replaces hardcoded `MAX_SCAN_DEPTH = 25px`; white-gap-only patterns now accepted
- **Typed Prefix Level Inference**: Indentation-based nesting now only applies to bullet/dash/arrow formats; decimal/letter/roman formats skip indentation inference
- **Dependency Updates**:
  - docxmlater: 10.1.4 → 10.1.7

---

## [5.5.3] - 2026-02-20

### Added

- **HLP Table Detection & Protection**: High Level Process tables identified by dual-gate check (FFC000 shading + "High Level Process" header text); completely skipped in table uniformity, bullet/numbered uniformity, and list normalization; numbering preserved via pre-processing snapshot and restored afterward
- **Image Border Cropping**: Detects and removes dark border + white gap from screen captures using canvas pixel analysis; confidence-based edge detection (65% consensus) prevents false crops; replaces image data in-place
- **Image Compression**: Always-on optimization pass compresses embedded images via canvas
- **Correct Misapplied Styles Option**: New processing option to fix paragraphs incorrectly styled as TOC or Hyperlink (converts to Normal/ListParagraph)
- **Email Client Fallback**: Phase 1 tries Outlook COM automation; Phase 2 falls back to mailto: + Explorer folder reveal when Outlook is unavailable
- **Per-Monitor DPI Awareness**: Upgraded to Per-Monitor DPI Aware V2 (Windows 10 1703+); dynamically detects monitor DPI via Win32 API and scales window sizing
- **Return-to Hyperlinks Standardization**: Removes indentation and right-aligns "Return to" hyperlinks after style processing
- **WebSettings Sanitization**: Removes bloated `w:divs` from web paste operations that cause Word to freeze during layout

### Fixed

- **NormalWeb/TableGrid Style Normalization**: Converts NormalWeb → Normal and TableGrid → Normal/Heading2 early in pipeline before style application
- **HLP Header Formatting**: Explicit run formatting applied to HLP table header rows ensures correct appearance regardless of Heading2 style definition
- **Cell Shading False Positives**: Table uniformity now only checks direct cell shading, ignoring table style inheritance patterns (pct12 banded rows, etc.)
- **HLP Tips Column Detection**: Skips single-cell rows and multi-column-spanning cells to avoid false tips column matches
- **Canvas Module Missing in MSI**: Moved canvas from devDependencies to dependencies; added to asarUnpack for native binary access
- **Style Application Tracked Changes**: Disabled track changes during style application to avoid cluttering change history with redundant direct formatting removals

### Improved

- **Blank Line Options**: Now respects user-configured Normal style spacing (spaceAfter, spaceBefore, lineSpacing, fontSize, fontFamily)
- **Whitespace Normalization**: Extracted to dedicated helper module with special handling for small inline images
- **List Prefix Standardization**: Moved to after all list processing to catch ALL abstractNum definitions including those created by ListNormalizer
- **Numbered List Defaults**: Level 3 format changed from '1)' to 'A.'; Level 4 from 'a)' to 'I.' for more professional hierarchy
- **Normal Style Indentation**: Removed style-level indentation to prevent conflicts with numbering.xml level indentation
- **Dependency Updates**:
  - docxmlater: 9.5.34 → 10.0.2

---

## [5.2.39] - 2026-01-29

### Fixed

- **List Blank Lines in Table Cells**: `ensureBlankLinesAfterListsInScope` was inserting blank paragraphs into the document body instead of the table cell; now uses `cell.addParagraphAt()` for table-cell scopes
- **Heading Detection False Positives**: Removed `detectHeadingLevel()` for unstyled paragraphs — it produced false positives for table cell paragraphs with `outlineLevel` set without being actual headings
- **Processing Options Backfill**: Updated default-enabled option IDs to match renamed options (e.g., `apply-doc-styles` → `validate-document-styles`, `standardize-cell-borders` → `standardize-table-borders`)

### Added

- **Word Compatibility Mode Detection**: Documents created in Word 2003/2007/2010 compatibility mode are now detected and rejected with a user-friendly conversion guide (purple badge, step-by-step instructions, retry button)
- **NormalWeb Style Handling**: `NormalWeb` style is now treated identically to Normal — paragraphs with this style receive Normal formatting and are reassigned to Normal
- **Color Utility Functions**: Added `adjustLightness`, `parseHex`, `toHex` helpers in `colorConvert.ts`
- **Landscape Margins Option**: `set-landscape-margins` added to default-enabled processing options
- **Blank Lines After List Sequences**: New `ensureBlankLinesAfterLists` pass adds structural blank lines after list items that are followed by non-list content (table-cell and body scopes)

### Improved

- **Analytics Page**: Sticky header section for better scroll experience
- **List Indentation Defaults**: Updated to 0.5" base with 0.5" increments per level (was 0.25" base)
- **Theme & Styling**: Theme context and global CSS refinements
- **Dependency Updates**:
  - docxmlater: 9.5.33 → 9.5.34

---

## [5.2.35] - 2026-01-28

### Improved

- **Documentation Cleanup**: Updated version references and removed development artifacts
- **Dependency Updates**:
  - docxmlater: 9.5.31 → 9.5.33

---

## [5.2.32] - 2026-01-28

### Improved

- **Dependency Updates**:
  - docxmlater: 9.5.30 → 9.5.31

---

## [5.2.16] - 2026-01-26

### Improved

- **Table Shading Logic**: Enhanced shading rules for better document handling
  - 1x1 tables containing large images (≥100x100 pixels) no longer receive shading
  - Cells with #FFC000 (orange) shading color are now preserved in ALL table cells, not just header rows
  - Light yellow (#FFF2CC) shading also preserved in data rows

- **Dependency Updates**:
  - docxmlater: 9.5.14 → 9.5.19

---

## [5.2.7] - 2026-01-26

### Improved

- **Normalize Dashes to Hyphens**: Now also replaces em-dashes (—) in addition to en-dashes (–)
  - Both U+2013 (en-dash) and U+2014 (em-dash) are converted to standard hyphens

- **Preserve Red Font Option**: Extended to also apply to List Paragraph style
  - Previously only applied to Normal style paragraphs
  - Now preserves #FF0000 red font in bulleted/numbered lists as well

---

## [5.2.6] - 2026-01-26

### Added

- **Preserve Red Font Option**: New processing option to preserve exact #FF0000 red font color
  - Located in Processing Options tab → Text Formatting Fixes group
  - Only applies to Normal style paragraphs (Headers not affected)
  - Default: disabled

- **Power Automate Timeout Retry**: Enhanced error handling for API timeouts
  - Displays "Power Automate Timeout" status instead of generic "Error"
  - Shows Retry button (similar to file locked errors)
  - Orange badge in error details dialog with helpful tip

### Fixed

- **List Continuation Indentation**: Multiple consecutive indented paragraphs after a list item now all receive the same indentation
  - Previously only the first indented paragraph was processed
  - Now checks if previous paragraph is indented text and matches that indent

### Improved

- **Dependency Updates**:
  - docxmlater: 9.5.13 → 9.5.14

---

## [5.2.5] - 2026-01-26

### Improved

- **Dependency Updates**:
  - docxmlater: 9.5.9 → 9.5.13

---

## [5.2.4] - 2026-01-25

### Improved

- **Dependency Updates**:
  - docxmlater: 9.5.7 → 9.5.9

---

## [5.2.3] - 2026-01-25

### Improved

- **Dependency Updates**:
  - docxmlater: 9.5.6 → 9.5.7

---

## [5.2.2] - 2026-01-25

### Changed

- Version bump for release

---

## [5.2.0] - 2026-01-25

### Reverted

- **Rolled back to v5.0.18 codebase**: Reverted all changes from v5.0.19 through v5.1.11
  - v5.0.19 - v5.1.11: Various changes that introduced regressions
  - Returning to stable v5.0.18 baseline for maximum reliability

### Improved

- **Dependency Updates**:
  - docxmlater: 9.4.0 → 9.5.6

---

## [5.0.18] - 2026-01-24

### Improved

- **Dependency Updates**:
  - docxmlater: 9.3.1 → 9.4.0

---

## [3.3.0] - 2025-11-17

### Added

- **Complete Bullet Property Control**: Implemented Example 4's complete property setting pattern
  - All 5 bullet formatting properties explicitly set (setText, setFont, setFontSize, setBold, setColor)
  - Full control over bullet formatting without framework defaults
  - Enhanced Unicode bullet rendering with proper Calibri font handling

### Changed

- **Upgraded docxmlater**: Major framework update from v2.5.0 to v3.0.0
  - Enhanced list formatting capabilities
  - Improved document processing performance
  - Updated API compatibility
- **Refactored WordDocumentProcessor**: Code optimization with net -11 lines
  - Cleaner bullet uniformity implementation
  - Eliminated redundant framework method calls
  - Better property setting pattern

### Improved

- **Dependency Updates**:
  - electron: 39.1.2 → 39.2.1
  - electron-builder: 26.1.0 → 26.2.0
  - @types/react: 19.2.4 → 19.2.5
  - electron-updater: 6.7.0 → 6.7.1
  - react-router-dom: 7.9.5 → 7.9.6

### Fixed

- **Unicode Bullet Rendering**: Proper Calibri font ensures U+2022 renders as bullet (not square)
- **Framework Conflicts**: Eliminated property override issues through explicit setting

### Documentation

- **List Implementation Guide**: Comprehensive documentation in List_Implementation.md
  - Example 4 pattern implementation details
  - Complete property setting rationale
  - Framework method usage guidelines

---

## [3.2.0] - 2025-11-16

### Fixed

- **1x1 Table Blank Line Preservation**: Fixed issue where blank lines after 1x1 tables were not reliably preserved
  - Root cause: `markAsPreserved` flag was conditional on `removeParagraphLines` setting
  - Now always marks blank lines as preserved when `preserveBlankLinesAfterHeader2Tables` is enabled
  - Prevents downstream cleanup operations from removing intentional spacing
  - Location: `WordDocumentProcessor.ts` lines 705-724

### Changed

- **Blank Line Preservation Logic**: Simplified preservation behavior for better user experience
  - Previous: Blank lines only preserved when BOTH `preserveBlankLinesAfterHeader2Tables=true` AND `removeParagraphLines=true`
  - Current: Blank lines ALWAYS preserved when `preserveBlankLinesAfterHeader2Tables=true` (regardless of other settings)
  - Rationale: User intent when enabling "preserve blank lines" is to ALWAYS preserve them

### Documentation

- **TOC Wiring Guide**: Added comprehensive documentation for Table of Contents feature integration
  - Created `docs/TOC_WIRING_GUIDE.md` with UI integration instructions
  - Explains existing TOC generation capability in framework (`doc.replaceTableOfContents()`)
  - Provides 3 UI integration options with example code
  - Includes troubleshooting guide and testing strategy

---

## [3.1.0] - 2025-11-14

### Added

- **Hyperlink Change Tracking**: Enhanced tracked changes display for hyperlinks
  - Added Content ID display in tracked changes UI
  - Added hyperlink status indicators (updated, not_found, expired)
  - Improved hyperlink change descriptions

### Fixed

- **Hyperlink Fragmentation from Google Docs**: Fixed issue where hyperlinks would duplicate
  - Uses framework's `defragmentHyperlinks()` API
  - Properly merges fragmented hyperlinks with same URL
  - Handles formatting reset for corrupted fonts

### Changed

- **TrackedChangesPanel**: Enhanced UI with Before/After comparison view
  - Added inline changes view with Word-like formatting
  - Added list view with categorized changes
  - Added side-by-side diff comparison using document snapshots

---

## [3.0.0] - 2025-11-12

### Added

- **Tracked Changes Feature**: Complete integration with docxmlater's revision tracking
  - Extract and display Word tracked changes (original document revisions)
  - Track DocHub processing changes (hyperlinks, styles, formatting)
  - Unified change viewer with filtering by source and category
  - Export changes as markdown

### Changed

- **Document Processing**: Major refactor of WordDocumentProcessor
  - Integrated ChangelogGenerator for extracting tracked changes
  - Added revision handling modes (accept_all, preserve, preserve_and_wrap)
  - Auto-accept revisions for clean document output while preserving change history

### Added

- **Document Snapshots**: Pre-processing snapshots for comparison
  - IndexedDB storage via DocumentSnapshotService
  - Before/After comparison in TrackedChangesPanel
  - 7-day retention with 100MB storage limit

---

## Earlier Versions

See git history for changes prior to v3.0.0.

---

## docxmlater Framework Reference

Documentation Hub uses the [docxmlater](https://www.npmjs.com/package/docxmlater) framework for Word document processing.

The framework provides:

- Document loading and saving
- Paragraph and run manipulation
- Hyperlink processing
- List and numbering support
- Table operations
- Revision tracking and changelog generation

For framework-specific API changes, refer to the docxmlater package documentation.
