# Table of Contents (TOC) Wiring Guide

## Overview

This guide explains how to enable automatic Table of Contents generation in dochub-app. The framework (`docxmlater`) has full TOC generation capability built-in, but it requires proper option wiring from the UI.

## Current Problem

Users see only placeholder text in their TOC:

- "Table of Contents" (header)
- "Right-click to update field." (placeholder)

This happens because `options.operations?.updateTocHyperlinks` is not being set by the UI, so the post-save TOC population never runs.

## How TOC Generation Works

### Framework Implementation (Already Complete)

Located in `src/services/document/WordDocumentProcessor.ts` lines 933-946:

```typescript
if (options.operations?.updateTocHyperlinks) {
  this.log.debug('=== GENERATING/UPDATING TABLE OF CONTENTS ===');

  // Use DocXMLater's replaceTableOfContents() to populate TOC entries
  const tocCount = await doc.replaceTableOfContents(filePath);

  this.log.info(`Replaced ${tocCount} Table of Contents element(s) with generated entries`);

  if (tocCount === 0) {
    this.log.warn(
      'No TOC elements found in document. To create a TOC, insert a Table of Contents field in Word first.'
    );
  }
}
```

### What It Does

1. **Scans document** for TOC fields (identified by `<w:docPartGallery w:val="Table of Contents">`)
2. **Extracts field instructions** (e.g., `\o "1-3"` for outline levels 1-3)
3. **Finds all headings** throughout the document (including tables)
4. **Generates hyperlinked entries** with correct indentation per heading level
5. **Writes entries** back into the TOC while preserving the field structure

### Technical Details

- **Runs after** `doc.save()` to avoid overwriting changes
- **Modifies** the saved file on disk directly
- **Preserves** the TOC field code so Word still recognizes it as a TOC
- **Creates** internal bookmarks (`_Toc123...`) for each heading
- **Applies** standard formatting: Verdana 12pt, blue (#0000FF), underlined

## UI Integration Options

### Option 1: Add Dedicated Checkbox (Recommended)

Add a new checkbox in the Processing Options → Operations section:

**UI Component:**

```typescript
{
  id: 'update-toc-hyperlinks',
  label: 'Generate/Update Table of Contents',
  description: 'Automatically populate TOC with hyperlinked entries from document headings',
  category: 'operations',
  type: 'checkbox',
  defaultValue: false,
}
```

**Option Mapping:**

```typescript
const processingOptions: WordProcessingOptions = {
  // ... other options
  operations: {
    // ... other operations
    updateTocHyperlinks: formData['update-toc-hyperlinks'], // Map UI checkbox to option
  },
};
```

### Option 2: Rename Existing Option

If there's already a TOC-related option with a confusing name:

**Current (unclear):**

```typescript
operations: {
  updateTocHyperlinks: true; // Unclear what this does
}
```

**Better naming:**

```typescript
operations: {
  populateToc: true,          // OR
  generateTocEntries: true,   // OR
  autoUpdateToc: true
}
```

Keep backward compatibility:

```typescript
// In WordDocumentProcessor
const shouldPopulateToc =
  options.operations?.populateToc ?? options.operations?.updateTocHyperlinks ?? false;
```

### Option 3: Separate TOC & Hyperlink Operations

If you want fine-grained control:

```typescript
operations: {
  populateToc: true,                  // Generate TOC entries
  standardizeHyperlinkColor: true,    // Separate hyperlink formatting
  standardizeHyperlinkFormatting: true, // Remove bold/italic from links
}
```

## User Workflow

### Steps to Use TOC Generation

1. **User prepares document in Word:**
   - Insert → Table of Contents
   - Choose a TOC style (e.g., Automatic Table 1)
   - Word creates the TOC field with placeholder text

2. **User enables option in dochub-app:**
   - Check "Generate/Update Table of Contents"
   - Configure other processing options as needed
   - Process the document

3. **Result:**
   - dochub-app saves the document
   - Post-save: Scans for headings and populates TOC
   - Recipient opens document and sees fully clickable TOC

### Example Document Flow

**Before Processing:**

```
Table of Contents
Right-click to update field.

[Document content with headings...]
```

**After Processing (with option enabled):**

```
Table of Contents
  Introduction ..................................... 1
  Background ...................................... 2
    Project Overview .............................. 2
    Objectives .................................... 3
  Methodology ..................................... 4
    [etc.]

[Document content with headings...]
```

## Implementation Checklist

- [ ] Add UI checkbox/control for TOC generation
- [ ] Map UI value to `options.operations.updateTocHyperlinks`
- [ ] Update user documentation/help text
- [ ] Add tooltip explaining prerequisites (TOC field must exist)
- [ ] Test with documents containing:
  - [ ] Single TOC
  - [ ] Multiple TOCs
  - [ ] No TOC (should log warning, not error)
  - [ ] Headings in tables
  - [ ] 100+ headings (performance test)

## Error Handling

### Case 1: No TOC Field in Document

**Behavior:** Logs warning, continues processing

**Log Output:**

```
WARN: No TOC elements found in document. To create a TOC, insert a Table of Contents field in Word first.
```

**User Action Required:** Insert TOC field in Word before processing

### Case 2: Invalid TOC Field Structure

**Behavior:** Framework detects and skips malformed TOC

**Log Output:**

```
WARN: Found TOC element but could not parse field instructions
```

**User Action Required:** Recreate TOC field in Word

### Case 3: No Headings in Document

**Behavior:** TOC is populated but empty (no entries)

**Result:** Only "Table of Contents" header appears

**User Action Required:** Add heading styles to document content

## Advanced Configuration

### Custom TOC Properties (Future Enhancement)

The framework supports `TOCProperties` for advanced configuration:

```typescript
interface TOCProperties {
  levels: number[]; // Which heading levels to include (default: [1,2,3])
  hyperlinked: boolean; // Use hyperlinks vs page numbers
  includePageNumbers: boolean; // Show page numbers
  rightAlignPageNumbers: boolean; // Right-align page numbers
  tabLeaderStyle: 'none' | 'dots' | 'dashes' | 'underline';
  spacingBetweenEntries: number; // Points
  hyperlinkColor: string; // Hex color
}
```

To expose this in UI:

```typescript
tableOfContentsSettings?: {
  enabled: boolean;
  includeHeadingLevels: number[]; // [1, 2, 3]
  showPageNumbers: boolean;
  rightAlignPageNumbers: boolean;
  useHyperlinks: boolean;
  tabLeaderStyle: 'none' | 'dots' | 'dashes' | 'underline';
  tocTitle: string;
  showTocTitle: boolean;
  spacingBetweenHyperlinks: number; // in points
}
```

## Testing Strategy

### Manual Testing

1. **Create test document with 20+ headings**
2. **Insert TOC field in Word**
3. **Process with option enabled**
4. **Verify:**
   - TOC contains all headings
   - Hyperlinks work (click → jump to section)
   - Formatting is consistent (Verdana 12pt blue)
   - Indentation matches heading levels

### Automated Testing

```typescript
describe('TOC Generation', () => {
  it('should populate TOC when option enabled', async () => {
    const options = {
      operations: { updateTocHyperlinks: true },
    };

    const result = await processor.processDocument('test-with-toc.docx', options);

    expect(result.success).toBe(true);
    // Verify TOC was populated (check logs or inspect document)
  });

  it('should skip TOC when option disabled', async () => {
    const options = {
      operations: { updateTocHyperlinks: false },
    };

    const result = await processor.processDocument('test-with-toc.docx', options);

    expect(result.success).toBe(true);
    // Verify TOC still shows placeholder
  });
});
```

## Troubleshooting

### Problem: TOC Still Shows Placeholder

**Check:**

1. Is `operations.updateTocHyperlinks` actually `true`?
2. Does document have TOC field? (Insert → Table of Contents in Word)
3. Check logs for "GENERATING/UPDATING TABLE OF CONTENTS"

**Debug:**

```typescript
// Add logging to verify option value
console.log('TOC option:', options.operations?.updateTocHyperlinks);
```

### Problem: TOC Missing Some Headings

**Check:**

1. Are headings using proper styles (Heading 1, Heading 2, etc.)?
2. Does TOC field instruction match heading levels? (e.g., `\o "1-3"`)
3. Are headings in tables? (Framework supports this)

**Solution:** Adjust TOC field switches in Word or heading styles

### Problem: TOC Hyperlinks Don't Work

**Check:**

1. Are bookmarks created? (Framework should create `_Toc123...` bookmarks)
2. Is document corrupted?

**Solution:** Recreate document or use docXMLater validation

## Related Documentation

- [WordDocumentProcessor.ts](../src/services/document/WordDocumentProcessor.ts) - Implementation
- [Processing Options Documentation](./PROCESSING_OPTIONS_UI_UPDATES.md) - All options
- [DocXMLater Library](../docxmlater-readme.md) - Framework capabilities

## Version History

- **v1.19.0**: TOC generation fully implemented in framework
- **Current**: Requires UI wiring to enable feature
- **Next**: Plan to add advanced TOC configuration options

---

**Need Help?** Contact the development team or file an issue in the repository.
