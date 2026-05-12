# Document Processing Pipeline Flowchart

## High-Level Flow

```
User Upload/Drop (.docx)
        |
        v
+-------------------+
| DocumentUploader   |  Validates file type (.docx/.doc), enforces max file limit
+-------------------+
        |  onDocumentsAdded(files)
        v
+-------------------+
| SessionContext     |  addDocuments() - adds to session, persists to IndexedDB
+-------------------+
        |
        v
+-------------------+
| useDocumentQueue   |  addManyToQueue() - queues documents for sequential processing
+-------------------+
        |  processNext() - picks next queued item
        v
+-------------------+
| SessionContext     |  processDocument(sessionId, documentId)
| (orchestrator)     |  - Loads user settings from localStorage
|                    |  - Builds processingOptions from session config
|                    |  - Captures pre-processing snapshot (IndexedDB)
+-------------------+
        |  electronAPI.processHyperlinkDocument(path, options)
        v
=== IPC BOUNDARY (Renderer -> Main Process) ===
        |
        v
+-------------------+
| electron/main.ts  |  ipcMain.handle("hyperlink:process-document")
|                    |  - Validates file path
|                    |  - Sets up timeout/cancellation
+-------------------+
        |  this.processor.processDocument(safePath, options)
        v
+-----------------------------------------------+
|     WordDocumentProcessor.processDocument()     |
|            (17 PHASES - see below)              |
+-----------------------------------------------+
        |  returns HyperlinkProcessingResult
        v
=== IPC BOUNDARY (Main -> Renderer Process) ===
        |
        v
+-------------------+
| SessionContext     |  Updates document status -> "completed" or "error"
|                    |  Stores processingResult, wordRevisions
|                    |  Saves session to IndexedDB
+-------------------+
        |
        v
+-------------------+
| UI Components      |  ProcessingResults, ChangeViewer, TrackedChangesPanel
+-------------------+
```

---

## Processing Options Flow

```
ProcessingOptions UI (checkboxes)
        |  user toggles options
        v
Session.processingOptions.enabledOperations[]
        |
        v
sessionToProcessorManager.tsx
  sessionToProcessorOptions(session)
    |-- mapEnabledOperationsToFlags()   -> boolean flags (removeItalics, smartTables, etc.)
    |-- mapSessionStylesToProcessor()   -> style definitions (Heading 2, Normal, etc.)
    |-- mapTableShadingSettings()       -> table shading config
    |-- listBulletSettings              -> indentation levels
        |
        v
WordProcessingOptions object -> passed to processor
```

---

## WordDocumentProcessor — 17 Processing Phases

```
PHASE 1: INITIALIZATION
  |-- Validate file (exists, < 50MB)
  |-- Create backup (.bak)
  |-- Load DOCX via DocXMLater (revisionHandling: "preserve")
  |-- Check compatibility mode, sanitize web settings
  |
  v
PHASE 2: PRE-TRACKING OPERATIONS (changes NOT tracked)
  |-- Capture pre-existing Word tracked changes
  |-- Capture pre-processing text snapshot
  |-- Remove em/en variants (optional)
  |-- Defragment hyperlinks (merge splits from Google Docs)
  |
  v
PHASE 3: ENABLE TRACKING
  |-- Enable Word track changes (author = user name)
  |-- Capture blank line snapshot (neighbor hashes)
  |-- Start DocHub change comparison tracking
  |-- Extract all hyperlinks via DocXMLaterProcessor
  |
  v
PHASE 4: POWERAUTOMATE API (optional)
  |-- Call API with extracted hyperlinks
  |-- Update URLs, display texts, handle "Not Found"
  |-- Cleanup orphaned content ID fragments
  |-- Batch apply URL updates via paragraph reconstruction
  |
  v
PHASE 5: CUSTOM REPLACEMENTS
  |-- Apply user-defined find/replace rules
  |
  v
PHASE 6: TEXT FORMATTING
  |-- Remove extra whitespace (tracking OFF for cosmetic)
  |-- Remove italic formatting (optional)
  |-- Standardize hyperlink formatting (Verdana 12pt blue underlined)
  |-- Collect HLP table abstractNumIds (protect from list ops)
  |-- Correct misapplied styles (TOC/Hyperlink paragraph styles)
  |-- Convert NormalWeb -> Normal
  |-- Convert Table Grid -> Normal or Heading 2
  |
  v
PHASE 7: STYLE APPLICATION
  |-- Set Heading 2 on 1x1 tables (if smartTables)
  |-- Apply custom styles via doc.applyStyles() (tracking OFF)
  |     |-- Save/restore table cell numbering (prevent corruption)
  |-- Update Hyperlink style definition (Verdana)
  |-- Re-apply hyperlink formatting (safety net)
  |-- Validate Header 2 table formatting (optional)
  |-- Standardize "Return to" hyperlinks (right-align)
  |-- Clear center-aligned indentation
  |-- Add/update document warning (optional)
  |
  v
PHASE 8: IMAGE PROCESSING
  |-- Crop embedded image borders (remove auto-borders)
  |-- Center and border images >= 96px (border width from Styles UI, default 1pt)
  |-- Optimize/compress all images
  |-- Clear headers/footers (optional)
  |
  v
PHASE 9: LIST PROCESSING (largest phase)
  |-- Detect wide hanging indent need (10+ items -> 0.30")
  |-- Pre-process extended typed prefixes (Roman numerals, etc.)
  |-- Normalize typed list prefixes in tables ("1.", "bullet" -> Word numbering)
  |-- Context-aware typed prefix conversion (body + tables)
  |-- Normalize orphan list levels (tables, then body)
  |-- Collapse level gaps (0->1->3->4 becomes 0->1->2->3)
  |-- Normalize list levels from visual indentation
  |-- Format Step number columns
  |-- Standardize row number columns
  |-- Apply list indentation uniformity (optional)
  |-- Apply bullet uniformity (optional)
  |-- Apply numbered uniformity
  |-- Convert mixed list formats (consistent per abstractNum)
  |-- Remove numbering tab stops
  |-- Remove small indents (< 0.25" from non-list)
  |-- Apply list continuation indentation
  |-- Standardize numbering colors
  |-- Standardize list prefix formatting (Verdana 12pt black)
  |-- Standardize bold colon formatting
  |-- Second whitespace pass (cleanup from list ops)
  |
  v
PHASE 10: BLANK LINE PROCESSING
  |-- Mark field paragraphs as preserved (TOC protection)
  |-- BlankLineManager rule engine (tracking OFF)
  |     |-- Removal rules
  |     |-- Addition rules
  |     |-- Indentation fixes
  |     |-- Preservation logic
  |
  v
PHASE 11: PAGE LAYOUT & TABLE FORMATTING
  |-- Set landscape orientation + margins (tracking OFF, optional)
  |-- Apply table uniformity (shading, borders, autofit, padding)
  |-- Smart table detection and formatting
  |-- Apply hidden text style (#FFFFFF runs)
  |-- Process HLP tables (FFC000 orange header, 2.25pt borders)
  |-- Step table detection
  |-- Autofit tables to window
  |-- Normalize cell widths (tcW matches tblGrid)
  |-- Step column width fix (1 inch)
  |-- Standardize table borders (optional)
  |
  v
PHASE 12: LATE-STAGE TEXT
  |-- Replace "Parent SOP:" -> "Parent Document:" (optional)
  |-- Update Top of Document hyperlinks (optional)
  |-- Replace outdated hyperlink titles (optional)
  |-- Standardize hyperlink colors (optional)
  |-- Fix internal hyperlinks (optional)
  |-- Final whitespace pass
  |
  v
PHASE 13: TABLE OF CONTENTS
  |-- Rebuild TOC with styled hyperlinks
  |
  v
PHASE 14: TRACKED CHANGES EXTRACTION
  |-- Flush pending formatting changes -> Revision objects
  |-- Extract all tracked changes (ChangelogGenerator)
  |-- Enrich with context (nearest Header 2)
  |-- Disable track changes
  |-- Auto-accept revisions (optional)
  |
  v
PHASE 15: CLEANUP & SANITIZATION
  |-- Defragment hyperlinks
  |-- Remove unused numbering
  |-- Clean orphaned relationships
  |-- Deduplicate complex field hyperlinks
  |-- Flatten field codes (Outlook copy-paste fix)
  |-- Strip orphan RSIDs
  |-- Clear direct spacing for styles
  |-- Finalize paragraph spacing
  |
  v
PHASE 16: NUMBERING & SAVE
  |-- Clean up unused numbering definitions
  |-- Consolidate duplicate abstractNums (protect HLP)
  |-- Validate numbering references
  |-- Rebuild TOCs (preserve field structure)
  |-- SAVE DOCUMENT TO DISK
  |
  v
PHASE 17: FINALIZATION
  |-- Complete change tracking comparison
  |-- Set success flag
  |-- Calculate duration
  |-- Return HyperlinkProcessingResult
```

---

## Post-Processing Results Flow

```
HyperlinkProcessingResult returned
        |
        v
SessionContext receives result via IPC
  |-- Updates document: status, processingResult, wordRevisions
  |-- Saves session to IndexedDB
        |
        v
UI Components render:
  |
  |-- ProcessingResults.tsx
  |     |-- Status header (success/error/partial)
  |     |-- Stats grid (hyperlinks processed/modified, content IDs, duration)
  |     |-- TrackedChangesDetail (visual change list)
  |     |-- Backup info notification
  |
  |-- ChangeViewer.tsx
  |     |-- Word Revisions (pre-existing, amber styling)
  |     |-- DocHub Processing Changes
  |     |-- Filters: source, category, author, search
  |     |-- Change grouping (delete+insert -> "Updated")
  |     |-- Export as Markdown
  |
  |-- ChangeItem.tsx
        |-- Source badge (Word/DocHub)
        |-- Before/after with diff highlighting
        |-- Location context (nearest heading)
        |-- Content ID display
        |-- Status badges (updated/not_found/expired)
```

---

## Key Files

| Layer | File | Role |
|---|---|---|
| Upload UI | `src/components/document/DocumentUploader.tsx` | File drop/select |
| Queue | `src/hooks/useDocumentQueue.tsx` | Sequential processing queue |
| Options UI | `src/components/sessions/ProcessingOptions.tsx` | User checkboxes |
| Options Mapping | `src/components/sessions/sessionToProcessorManager.tsx` | UI -> processor flags |
| Orchestration | `src/contexts/SessionContext.tsx` | Builds options, manages state, IPC calls |
| IPC Bridge | `electron/preload.ts` | Renderer <-> Main process |
| IPC Handler | `electron/main.ts` | Receives IPC, invokes processor |
| **Main Processor** | `src/services/document/WordDocumentProcessor.ts` | **17-phase processing pipeline** |
| DocXMLater Integration | `src/services/document/DocXMLaterProcessor.ts` | Hyperlink extraction, field processing |
| Blank Lines | `src/services/document/blanklines/BlankLineManager.ts` | Rule-based blank line engine |
| Sub-processors | `src/services/document/processors/*.ts` | Style, List, Table, Structure, Hyperlink |
| Snapshots | `src/services/document/DocumentSnapshotService.ts` | Pre/post document snapshots |
| Comparison | `src/services/document/DocumentProcessingComparison.ts` | Before/after change tracking |
| Results UI | `src/components/document/ProcessingResults.tsx` | Stats display |
| Changes UI | `src/components/sessions/ChangeViewer.tsx` | Detailed change list |

---

## Tracking State Transitions

Track changes is toggled ON/OFF strategically throughout processing:

```
OFF  -> Phase 1-2: Init, pre-tracking ops
ON   -> Phase 3: Enable tracking
OFF  -> Whitespace removal (cosmetic)
ON   -> Re-enable
OFF  -> Hyperlink formatting (cosmetic)
ON   -> Re-enable
OFF  -> Style application (cosmetic)
ON   -> Re-enable
OFF  -> Hyperlink re-formatting (cosmetic)
ON   -> Re-enable
...pattern continues for blank lines, table layout, landscape margins...
ON   -> Phase 14: Extract all changes
OFF  -> Phase 15-17: Cleanup, save, finalize
```

This ensures only meaningful content changes appear in Word's Review panel, not cosmetic formatting standardization.
