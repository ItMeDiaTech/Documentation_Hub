# Documentation Hub - Version History

All notable changes to the Documentation Hub application are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Current App Version:** 5.1.1
**docxmlater Framework Version:** 9.5.1
**Status:** Production Ready

---

## [5.1.1] - 2026-01-24

### Fixed

- **Multi-Level Bullet List Flattening**: Fixed bug where multi-level bullet lists were being converted to single-level
  - Root cause: `normalizeListLevelsFromIndentation()` only checked paragraph indentation, missing indentation from numbering definitions
  - Now calculates effective indentation from both paragraph and abstractNum level
  - Items with visual indentation from numbering definitions are now correctly promoted to appropriate levels
  - Preserves original visual hierarchy (• for level 0, ○ for level 1)

---

## [5.1.0] - 2026-01-24

### Improved

- **Dependency Updates**:
  - docxmlater: 9.5.0 → 9.5.1

---

## [5.0.19] - 2026-01-24

### Added

- **Preserve Red Font Option**: New processing option to preserve #FF0000 red text during style application
  - Defaults to false (unchecked)
  - When enabled, red text is not changed to the style's default color

### Fixed

- **Table Shading Preservation**: Fixed #FFC000 and #FFF2CC shading being overwritten
  - Normalized color comparison (removes # prefix for accurate matching)
  - Added preservation check to data rows (was only in header rows)
  - Affects both header and data rows with orange/yellow shading

- **List Continuation Indentation**: Fixed over-indentation of continuation paragraphs
  - Added tolerance check (72 twips = 0.05") to prevent adjusting already-aligned text
  - "Note:" paragraphs now properly align with list text above

### Improved

- **Dependency Updates**:
  - docxmlater: 9.4.0 → 9.5.0

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
