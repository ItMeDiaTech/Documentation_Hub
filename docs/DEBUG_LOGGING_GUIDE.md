# Debug Logging Guide - Document Processing Issues

## Overview

Added diagnostic logging to trace three issues:

1. Blank lines missing after 1x1 tables
2. TOC showing placeholder instead of generated entries
3. Wrong bullet symbols (squares instead of user-selected)

## What Was Added

### 1. Blank Lines After 1x1 Tables (Lines 705-730)

**Logs to Watch:**

```
=== DEBUG: BLANK LINES AFTER 1x1 TABLES CHECK ===
  preserveBlankLinesAfterHeader2Tables option: [true/false]
  removeParagraphLines option: [true/false]
```

**Key Diagnostics:**

- If `preserveBlankLinesAfterHeader2Tables: false` → Issue is in UI option propagation
- If `preserveBlankLinesAfterHeader2Tables: true` → Check the result object:
  ```
  ✓ Processed X 1x1 tables: Added Y blank lines, Marked Z existing blank lines as preserved
  ```
- If `tablesProcessed = 0` → No 1x1 tables detected (possible detection bug in docxmlater)
- If `blankLinesAdded > 0` but lines still missing → Check preserved paragraph removal

### 2. Preserved Paragraph Removal Check (Line 1698)

**Logs to Watch:**

```
⚠️ Paragraph X or Y is PRESERVED - skipping deletion
```

**Key Diagnostics:**

- If you see this log for paragraphs after 1x1 tables → Good, preservation is working
- If you DON'T see this log → Preserved flag is not being set by `ensureBlankLinesAfter1x1Tables()`
- This indicates a bug in docxmlater's markAsPreserved functionality

### 3. TOC Option Propagation (Lines 955-973)

**Logs to Watch:**

```
=== DEBUG: TOC OPTION CHECK ===
  operations object defined: [true/false]
  updateTocHyperlinks value: [true/false/undefined]
```

**Key Diagnostics:**

- If `operations object defined: false` → UI is not passing operations object
- If `updateTocHyperlinks value: false` → Option is not being set by UI checkbox
- If `updateTocHyperlinks value: true`:

  ```
  ✓ Replaced X Table of Contents element(s) with generated entries
  ```

  - If X = 0 → No TOC field exists in document
  - If X > 0 → TOC was replaced successfully, but placeholder may be from a different source

### 4. Bullet Uniformity Execution (Lines 818-848, 2830-2835)

**Logs to Watch:**

```
=== DEBUG: BULLET UNIFORMITY CHECK ===
  bulletUniformity option: [true/false]
  listBulletSettings defined: [true/false]
  Indentation levels: X
    Level 0: bulletChar="•" (or default), symbolIndent=0.25, textIndent=0.5
```

**Then during execution:**

```
=== DEBUG: BULLET UNIFORMITY EXECUTION ===
  Creating X bullet list levels
  Bullet characters: "•" (U+2022), "○" (U+25CB), etc.
  Level 0: bulletChar="•", symbolIndent=0.25", textIndent=0.5"
```

**Key Diagnostics:**

- If `bulletUniformity: false` → Option not enabled in UI
- If `listBulletSettings defined: false` → Settings not being passed from UI
- Check bullet character values:
  - Square (■) = U+25A0 or U+F0A0 (wrong)
  - Correct bullet (•) = U+2022
  - Default Symbol font bullet = U+F0B7
- If creating levels but bullets still wrong → Check if NumberingLevel is using correct font

## How to Use This Logging

### Step 1: Process a Document

1. Enable the problematic options:
   - ✓ Preserve blank lines after Header 2 tables
   - ✓ Update TOC hyperlinks
   - ✓ Bullet uniformity
2. Process a test document
3. Open the console/log viewer

### Step 2: Analyze Each Issue

#### Issue 1: Blank Lines After 1x1 Tables

**Look for this sequence:**

```
=== DEBUG: BLANK LINES AFTER 1x1 TABLES CHECK ===
  preserveBlankLinesAfterHeader2Tables option: true  ← Should be true
  removeParagraphLines option: true

=== ENSURING BLANK LINES AFTER 1x1 TABLES ===
  Calling doc.ensureBlankLinesAfter1x1Tables() with markAsPreserved=true
✓ Processed 5 1x1 tables: Added 3 blank lines, Marked 2 existing blank lines as preserved
  DEBUG: Result details - {"tablesProcessed":5,"blankLinesAdded":3,"existingLinesMarked":2}

=== REMOVING EXTRA PARAGRAPH LINES ===
  DEBUG: Before removal - total paragraphs: 150
⚠️ Paragraph 45 or 46 is PRESERVED - skipping deletion  ← Should see this for each preserved line
  DEBUG: After removal - total paragraphs: 140
Removed 10 extra paragraph lines
```

**Possible Root Causes:**

1. **Option is false** → UI not passing option correctly
2. **No tables processed** → docxmlater not detecting 1x1 tables (check table detection logic)
3. **Blank lines added but then removed** → Preserved flag not working (check preservation in paragraph removal)
4. **No "PRESERVED" warnings** → markAsPreserved not setting flag correctly

#### Issue 2: TOC Placeholder

**Look for this sequence:**

```
=== DEBUG: TOC OPTION CHECK ===
  operations object defined: true  ← Should be true
  updateTocHyperlinks value: true  ← Should be true

=== GENERATING/UPDATING TABLE OF CONTENTS ===
  Calling doc.replaceTableOfContents() on file: C:\...\document.docx
✓ Replaced 1 Table of Contents element(s) with generated entries
```

**Possible Root Causes:**

1. **Option value is false/undefined** → UI checkbox not setting operations.updateTocHyperlinks
2. **Replaced 0 elements** → No TOC field in document (need to insert TOC field in Word first)
3. **Replaced > 0 but still shows placeholder** → May be a different TOC field or cached view in Word

#### Issue 3: Wrong Bullet Symbols

**Look for this sequence:**

```
=== DEBUG: BULLET UNIFORMITY CHECK ===
  bulletUniformity option: true  ← Should be true
  listBulletSettings defined: true  ← Should be true
  Indentation levels: 3
    Level 0: bulletChar="•", symbolIndent=0.25, textIndent=0.5  ← Check character

=== APPLYING BULLET AND NUMBERED LIST UNIFORMITY ===
=== DEBUG: BULLET UNIFORMITY EXECUTION ===
  Creating 3 bullet list levels
  Bullet characters: "•" (U+2022), "○" (U+25CB), "▪" (U+25AA)  ← Check Unicode values
  Level 0: bulletChar="•", symbolIndent=0.25", textIndent=0.5"
```

**Possible Root Causes:**

1. **Square symbol (■) appearing:**
   - Check if UI is passing wrong character (U+25A0 instead of U+2022)
   - Check if font is Symbol (uses different code points)
   - Check if NumberingLevel is overriding bulletChar with default
2. **Correct character logged but wrong in document:**
   - Font issue (Calibri vs Symbol vs Verdana)
   - NumberingLevel not respecting bulletChar parameter
   - XML corruption in numbering.xml

### Step 3: Report Findings

For each issue, report:

1. What the logs showed
2. Which diagnostic condition matched
3. The suspected root cause
4. Where in the code the fix is needed

## Expected Next Steps

Based on log output, we may need to:

1. **For blank lines issue:**
   - Fix UI option passing if preserveBlankLinesAfterHeader2Tables is false
   - Debug docxmlater's ensureBlankLinesAfter1x1Tables() if no tables detected
   - Fix preserved paragraph detection in removeExtraParagraphLines()

2. **For TOC issue:**
   - Fix UI operations.updateTocHyperlinks checkbox binding
   - Verify TOC field exists in Word document
   - Check Word's field cache/update mechanism

3. **For bullet symbols:**
   - Correct bulletChar value in UI settings
   - Fix font handling in NumberingLevel creation
   - Verify XML injection in numbering.xml

## Quick Reference: Log Patterns

### ✓ Success Patterns

```
✓ Processed 5 1x1 tables: Added 3 blank lines
⚠️ Paragraph X is PRESERVED - skipping deletion
✓ Replaced 1 Table of Contents element(s)
Bullet characters: "•" (U+2022)
```

### ⚠️ Warning Patterns

```
⚠️ preserveBlankLinesAfterHeader2Tables is FALSE
⚠️ No TOC elements found in document
bulletUniformity option: false
```

### ❌ Error Patterns

```
Processed 0 1x1 tables (should have found some)
operations object defined: false (should be true)
listBulletSettings defined: false (should be true)
```
