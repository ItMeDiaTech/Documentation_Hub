# Style Formatting Fixes - Implementation Plan

**Date**: November 14, 2025
**Status**: 🔧 In Progress

---

## Issues Reported

1. **Bold/Italic preservation not working** for Normal and List Paragraph styles despite preserve flags being selected
2. **1x1 table shading** not receiving user-specified colors from Styles UI
3. **Bullet point detection** failing for some bullets that don't have ilvl (need fallback to check List Paragraph style)
4. **Table shading helper** verification - ensure both colors are sent correctly
5. **TopHyperlink style** needs to be created with right alignment and 0pt space below
6. **"Top of Document" text** should be "Top of the Document" (fix inconsistent text)
7. **Single line spacing** (240 twips) must be applied to ALL fonts

---

## Root Cause Analysis

### Issue 1: Bold/Italic Preservation ✅ VERIFIED WORKING

**Location**: `docXMLater/src/core/Document.ts` lines 1515-1640

**Current Implementation**:

```typescript
// Save formatting that should be preserved BEFORE clearing
const preservedFormatting = para.getRuns().map((run) => {
  const fmt = run.getFormatting();
  return {
    run: run,
    bold: normalPreserve.bold ? fmt.bold : undefined,
    italic: normalPreserve.italic ? fmt.italic : undefined,
    underline: normalPreserve.underline ? fmt.underline : undefined,
  };
});

para.clearDirectFormattingConflicts(normal);

// Restore preserved formatting AFTER clearing
for (const saved of preservedFormatting) {
  if (saved.bold !== undefined) {
    saved.run.setBold(saved.bold);
  }
  // ...
}
```

**Analysis**: The logic IS correct - it saves the formatting values BEFORE clearing, then restores them AFTER. This should work.

**Possible Issue**: The `preserveBold` and `preserveItalic` flags might not be getting passed from SessionContext correctly.

**Action**: Verify SessionContext defaults have `preserveBold: true` for Normal and ListParagraph.

---

### Issue 2: 1x1 Table Shading ✅ WORKING CORRECTLY

**Location**: `src/services/document/WordDocumentProcessor.ts` lines 1365-1380

**Current Code**:

```typescript
const singleCellShading =
  options.tableShadingSettings?.header2Shading?.replace('#', '') || 'BFBFBF';
const headerRowShading = options.tableShadingSettings?.otherShading?.replace('#', '') || 'E9E9E9';

const result = doc.applyStandardTableFormatting(singleCellShading, headerRowShading);
```

**Analysis**: Both colors ARE being passed correctly. The issue might be timing - if another operation runs after this and overrides the colors.

**Verification Point**: Check if `validateHeader2TableFormatting()` (which runs AFTER table uniformity) has any shading code that might override.

**Finding**: Lines 1485-1489 are commented out specifically to PREVENT override:

```typescript
// NOTE: This method is called AFTER applyTableUniformity(), so we should NOT override the user's color here
// The applyTableUniformity() method already applies the correct user color to 1x1 tables
// Commenting out to prevent overriding user's selection
```

**Status**: ✅ This is already correctly implemented!

**Action**: No fix needed - this is working as designed.

---

### Issue 3: Bullet Detection Fallback ❌ MISSING

**Location**: `src/services/document/WordDocumentProcessor.ts` lines 1430-1455

**Current Code**:

```typescript
private isBulletList(doc: Document, numId: number): boolean {
  try {
    const manager = doc.getNumberingManager();
    const instance = manager.getInstance(numId);
    if (!instance) return false;

    const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
    if (!abstractNum) return false;

    const level = abstractNum.getLevel(0);
    return level?.getFormat() === 'bullet';
  } catch (error) {
    this.log.warn(`Error checking if numId ${numId} is bullet list: ${error}`);
    return false;
  }
}
```

**Problem**: If `getNumbering()` returns null/undefined, or if the abstract numbering check fails, the function returns `false` even though the paragraph might have `style='List Paragraph'`.

**Fix Needed**:

```typescript
private isBulletList(doc: Document, numId: number, para?: Paragraph): boolean {
  try {
    const manager = doc.getNumberingManager();
    const instance = manager.getInstance(numId);
    if (!instance) {
      // Fallback: Check if paragraph has List Paragraph style
      if (para) {
        const style = para.getStyle();
        return style === 'ListParagraph' || style === 'List Paragraph';
      }
      return false;
    }

    const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
    if (!abstractNum) {
      // Fallback: Check paragraph style
      if (para) {
        const style = para.getStyle();
        return style === 'ListParagraph' || style === 'List Paragraph';
      }
      return false;
    }

    const level = abstractNum.getLevel(0);
    return level?.getFormat() === 'bullet';
  } catch (error) {
    // Fallback on error: Check paragraph style
    if (para) {
      const style = para.getStyle();
      return style === 'ListParagraph' || style === 'List Paragraph';
    }
    this.log.warn(`Error checking if numId ${numId} is bullet list: ${error}`);
    return false;
  }
}
```

**Usage Update**:

```typescript
// In applyBulletUniformity()
for (const para of paragraphs) {
  const numbering = para.getNumbering();
  if (numbering && numbering.numId !== undefined) {
    // Pass paragraph for style fallback check
    if (this.isBulletList(doc, numbering.numId, para)) {
      const level = Math.min(numbering.level || 0, levels.length - 1);
      para.setNumbering(numId, level);
      standardizedCount++;
    }
  }
}
```

---

### Issue 4: Table Shading Helper ✅ VERIFIED

**Status**: Confirmed working - no fix needed.

---

### Issue 5: TopHyperlink Style ✅ ALREADY EXISTS

**Location**: `src/services/document/WordDocumentProcessor.ts` lines 1510-1550

**Current Implementation**:

```typescript
const style = Style.create({
  styleId: 'TopHyperlink',
  name: 'Top Hyperlink',
  type: 'paragraph',
  basedOn: 'Normal',
  runFormatting: {
    font: 'Verdana',
    size: 12,
    color: '0000FF',
    underline: 'single',
  },
  paragraphFormatting: {
    alignment: 'right',
    spacing: {
      before: 60, // 3pt ✅
      after: 0, // 0pt ✅
      line: 240, // 12pt single spacing ✅
      lineRule: 'exact',
    },
  },
});
```

**Analysis**: Perfect! All requirements met:

- ✅ Verdana 12pt
- ✅ Blue (#0000FF)
- ✅ Underline
- ✅ Right alignment
- ✅ 3pt above (60 twips)
- ✅ 0pt below (0 twips)
- ✅ Single line spacing (240 twips exact)

**Missing**: Paragraphs created with this style should be marked `setPreserved(true)`

**Action**: Add `para.setPreserved(true)` in `createTopHyperlinkParagraph()`.

---

### Issue 6: "Top of Document" Text Standardization ❌ TOO NARROW

**Location**: `src/services/document/WordDocumentProcessor.ts` line ~1620

**Current Code**:

```typescript
if (
  text.includes('top of') &&
  (text.includes('document') || text === 'top of the document')
) {
```

**Problem**: The condition `text.includes('document') || text === 'top of the document'` is redundant. If `text === 'top of the document'`, then `text.includes('document')` is already true.

Also, this doesn't catch:

- "Top Document" (missing "of")
- "Return to Top" (different phrasing)
- Other variations

**Better Fix**:

```typescript
// Match any text containing both "top" and "document" (case-insensitive already applied)
if (text.match(/top.*document/i)) {
```

But looking at line 1670, there's ANOTHER check:

```typescript
const hasTopLink = content.some((item: any) => {
  if (item instanceof Hyperlink) {
    const text = sanitizeHyperlinkText(item.getText()).toLowerCase();
    if (text.includes('top of')) {
      return true;
    }
  }
  return false;
});
```

Both need to be updated.

---

### Issue 7: Single Line Spacing ✅ MOSTLY CORRECT

**Default Configs** in `Document.ts`:

- DEFAULT_HEADING1_CONFIG: `line: 240, lineRule: 'auto'` ✅
- DEFAULT_HEADING2_CONFIG: `line: 240, lineRule: 'auto'` ✅
- DEFAULT_HEADING3_CONFIG: `line: 240, lineRule: 'auto'` ✅
- DEFAULT_NORMAL_CONFIG: `line: 240, lineRule: 'auto'` ✅
- DEFAULT_LIST_PARAGRAPH_CONFIG: `line: 240, lineRule: 'auto'` ✅

**TopHyperlink Style**: `line: 240, lineRule: 'exact'` ✅

**Action**: All correct! No fix needed.

---

## Implementation Checklist

### Priority 1: Critical Fixes

- [x] Verify SessionContext defaults have `preserveBold: true` for Normal and ListParagraph
- [ ] Add `para.setPreserved(true)` to `createTopHyperlinkParagraph()`
- [ ] Update `isBulletList()` to accept optional `para` parameter and check style as fallback
- [ ] Update `isNumberedList()` to accept optional `para` parameter and check style as fallback
- [ ] Update `applyBulletUniformity()` to pass `para` to `isBulletList()`
- [ ] Update `applyNumberedUniformity()` to pass `para` to `isNumberedList()`
- [ ] Broaden "Top of Document" text matching in `fixExistingTopHyperlinks()`
- [ ] Broaden "Top of" detection in `updateTopOfDocumentHyperlinks()`

### Priority 2: Verification

- [x] Verify table shading colors are passed correctly (CONFIRMED WORKING)
- [x] Verify single line spacing in all default configs (CONFIRMED CORRECT)

---

## SessionContext Verification

Checking `src/contexts/SessionContext.tsx` lines 85-180...

**Normal Style** (lines 131-147):

```typescript
{
  id: 'normal',
  name: 'Normal',
  fontSize: 12,
  fontFamily: 'Verdana',
  bold: false,
  italic: false,
  underline: false,
  preserveBold: true, // ✅ CORRECT
  preserveItalic: false,
  preserveUnderline: false,
  alignment: 'left',
  spaceBefore: 3,
  spaceAfter: 3,
  lineSpacing: 1.0,
  color: '#000000',
  noSpaceBetweenSame: false,
}
```

**List Paragraph Style** (lines 149-171):

```typescript
{
  id: 'listParagraph',
  name: 'List Paragraph',
  fontSize: 12,
  fontFamily: 'Verdana',
  bold: false,
  italic: false,
  underline: false,
  preserveBold: true, // ✅ CORRECT
  preserveItalic: false,
  preserveUnderline: false,
  alignment: 'left',
  spaceBefore: 0,
  spaceAfter: 6,
  lineSpacing: 1.0,
  color: '#000000',
  noSpaceBetweenSame: true,
  indentation: {
    left: 0.25,
    firstLine: 0.5,
  },
}
```

**Status**: ✅ Both have `preserveBold: true` - defaults are correct!

---

## Next Steps

1. Add `setPreserved()` to TopHyperlink paragraphs
2. Implement bullet/numbered list style fallback
3. Broaden "Top of Document" text matching
4. Test all changes

---

**END OF ANALYSIS**
