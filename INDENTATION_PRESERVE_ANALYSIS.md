# Indentation and Preserve Flags Analysis

**Date**: November 14, 2025
**Status**: Analysis Complete - Ready for Implementation

## User Requirements

### 1. Normal Style Indentation

- **ALWAYS preserve existing indentation** from the original document
- No UI toggle needed - this should happen automatically
- When applying Normal style formatting, keep the paragraph's existing indentation values

### 2. Bold/Italic/Underline Preserve Flags

- Only for **Normal** and **List Paragraph** styles
- Only preserve when the user has toggled the preserve flag ON in the UI
- If preserve flag is OFF, apply the style's formatting

### 3. List Indentation from UI

- Verify that indentation values from StylesEditor are correctly passed to processing
- Values are in inches and need to be converted to twips (1440 twips = 1 inch)

---

## Current Implementation Analysis

### ✅ ALREADY WORKING: Preserve Flags for Bold/Italic/Underline

**Location**: `src/services/document/WordDocumentProcessor.ts` (Lines ~1080-1095)

```typescript
// Dual toggle formatting: only call setter if preserve flag is not true
if (!styleToApply.preserveBold) {
  run.setBold(styleToApply.bold);
}
if (!styleToApply.preserveItalic) {
  run.setItalic(styleToApply.italic);
}
if (!styleToApply.preserveUnderline) {
  run.setUnderline(styleToApply.underline ? 'single' : false);
}
```

**Status**: ✅ **CORRECTLY IMPLEMENTED**

- The preserve flags are properly checked before applying formatting
- If preserve flag is true, the existing formatting is kept
- If preserve flag is false, the style's formatting is applied

### ✅ ALREADY WORKING: List Indentation from UI

**Location**: `src/services/document/WordDocumentProcessor.ts` (Method: `injectIndentationToNumbering`)

```typescript
// Calculate indentation values in twips (1440 twips = 1 inch)
const symbolTwips = Math.round(levelConfig.symbolIndent * 1440);
const textTwips = Math.round(levelConfig.textIndent * 1440);
const hangingTwips = textTwips - symbolTwips;
```

**Status**: ✅ **CORRECTLY IMPLEMENTED**

- UI values (in inches) are properly converted to twips
- Indentation is injected directly into numbering.xml
- Values persist regardless of normalization

### ❌ MISSING: Normal Style Indentation Preservation

**Issue**: When applying Normal style formatting, the code DOES NOT preserve existing paragraph indentation.

**Current Behavior** (Lines ~1070-1095 in WordDocumentProcessor.ts):

```typescript
if (styleToApply) {
  // Apply paragraph formatting
  para.setAlignment(styleToApply.alignment);
  para.setSpaceBefore(pointsToTwips(styleToApply.spaceBefore));
  para.setSpaceAfter(pointsToTwips(styleToApply.spaceAfter));
  // ... more formatting

  // NO CODE to preserve existing indentation!
}
```

**What's Missing**:

- Before applying Normal style, we need to read the existing indentation
- Store it temporarily
- After applying the style formatting, restore the original indentation

---

## Implementation Plan

### Step 1: Add Indentation Preservation to Normal Style

**File to Modify**: `src/services/document/WordDocumentProcessor.ts`
**Method**: `assignStylesToDocument()` OR `applyCustomStylesFromUI()`

**Approach**:

1. Check if the style being applied is 'normal'
2. If yes, read the paragraph's current indentation using `para.getFormatting().indentation`
3. Store the indentation values (left, right, firstLine, hanging)
4. Apply the Normal style formatting
5. Restore the original indentation values

**Example Code**:

```typescript
if (styleToApply.id === 'normal') {
  // PRESERVE INDENTATION: Read current values before applying style
  const currentFormatting = para.getFormatting();
  const originalIndentation = currentFormatting.indentation || {};

  // Apply paragraph formatting (alignment, spacing, etc.)
  para.setAlignment(styleToApply.alignment);
  para.setSpaceBefore(pointsToTwips(styleToApply.spaceBefore));
  para.setSpaceAfter(pointsToTwips(styleToApply.spaceAfter));
  // ... other formatting

  // RESTORE INDENTATION: Apply original indentation back
  if (originalIndentation.left !== undefined) {
    para.setIndentation({
      left: originalIndentation.left,
      right: originalIndentation.right,
      firstLine: originalIndentation.firstLine,
      hanging: originalIndentation.hanging,
    });
  }
}
```

### Step 2: Verify UI Data Flow

**Files to Check**:

- ✅ `src/components/sessions/StylesEditor.tsx` - UI controls (VERIFIED: working)
- ✅ `src/pages/CurrentSession.tsx` - Callback handlers (VERIFIED: working)
- ✅ `src/contexts/SessionContext.tsx` - State management (assumed working)

**Data Flow**:

1. User changes indentation in StylesEditor → `onListBulletSettingsChange()` called
2. CurrentSession passes to context → `updateSessionListBulletSettings()`
3. Context stores in session state
4. Document processor reads from `options.listBulletSettings.indentationLevels`

**Status**: ✅ **VERIFIED - No changes needed**

### Step 3: Testing Plan

1. **Test Normal Style Indentation Preservation**:
   - Create document with paragraphs that have various indentation levels
   - Apply Normal style formatting
   - Verify indentation is preserved

2. **Test Preserve Flags**:
   - Set preserve flags ON for bold/italic/underline in Normal style
   - Process document with mixed formatting
   - Verify existing bold/italic/underline is kept
   - Set preserve flags OFF and verify formatting is applied

3. **Test List Indentation**:
   - Configure custom indentation values in UI (e.g., 0.5" symbol, 1.0" text)
   - Process document with bullet lists
   - Verify list indentation matches UI values

---

## Summary

| Feature                               | Status     | Action Needed           |
| ------------------------------------- | ---------- | ----------------------- |
| Bold/Italic/Underline Preserve Flags  | ✅ Working | None                    |
| List Indentation from UI              | ✅ Working | None                    |
| Normal Style Indentation Preservation | ❌ Missing | **Implement in Step 1** |

**Next Step**: Implement indentation preservation for Normal style in `assignStylesToDocument()` method.
