# Documentation Hub - Version History

All notable changes to the Documentation Hub application are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Current App Version:** 5.2.7
**docxmlater Framework Version:** 9.5.14
**Status:** Production Ready

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
