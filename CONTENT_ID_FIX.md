# Content ID Fix - Remove #content URL Appending

**Date**: November 14, 2025
**Status**: ✅ COMPLETED
**Issue**: #content was being incorrectly appended to theSource hyperlink URLs

---

## Problem

The "theSource Content IDs" processing option was calling `processContentIdAppending()` which added `#content` to the end of theSource hyperlink URLs, breaking them.

**User Clarification**: "#content should NEVER be added to anything"

**Correct Behavior**: Content IDs (like TSRC-ABC-123456) should only be used in the hyperlink DISPLAY TEXT, not appended to URLs.

---

## Solution

### 1. Disabled URL #content Appending

**File**: `src/services/document/WordDocumentProcessor.ts`
**Lines**: ~568-575

**Changed**:

```typescript
// BEFORE
if (options.operations?.fixContentIds || options.appendContentId) {
  this.log.debug('=== APPENDING CONTENT IDS ===');
  const modifiedCount = await this.processContentIdAppending(hyperlinks, options, result);
  result.appendedContentIds = modifiedCount;
  this.log.info(`Appended content IDs to ${modifiedCount} hyperlinks`);
}

// AFTER
// DISABLED: Content ID appending (#content should NEVER be added)
// The "theSource Content IDs" option now only extracts/validates IDs, does not append #content
// if (options.operations?.fixContentIds || options.appendContentId) {
//   this.log.debug('=== APPENDING CONTENT IDS ===');
//   const modifiedCount = await this.processContentIdAppending(hyperlinks, options, result);
//   result.appendedContentIds = modifiedCount;
//   this.log.info(`Appended content IDs to ${modifiedCount} hyperlinks`);
// }
```

### 2. Removed appendContentId from CurrentSession

**File**: `src/pages/CurrentSession.tsx`
**Lines**: ~392

**Changed**:

```typescript
// BEFORE
updateSessionOptions(session.id, {
  appendContentId: enabledOperations.includes('fix-content-ids'),
  contentIdToAppend: '#content',
  validateUrls: true,
  createBackup: true,
  // ...
});

// AFTER
updateSessionOptions(session.id, {
  validateUrls: true,
  createBackup: true,
  // ... (removed appendContentId and contentIdToAppend)
});
```

### 3. Made Properties Optional in Type

**File**: `src/types/session.ts`
**Lines**: ~58-65

**Changed**:

```typescript
processingOptions?: {
  appendContentId?: boolean; // DEPRECATED: #content should never be appended
  contentIdToAppend?: string; // DEPRECATED: #content should never be appended
  validateUrls: boolean;
  // ...
}
```

---

## What Still Works

### Content ID Display Text ✅

The PowerAutomate API integration still correctly updates hyperlink display text with Content IDs:

**File**: `src/services/document/WordDocumentProcessor.ts`
**Lines**: ~487-495

```typescript
// Append Content_ID (last 6 digits) if present
if (apiResult.contentId) {
  const last6 = apiResult.contentId.slice(-6);
  newText = `${newText} (${last6})`;
}
```

**Example**:

- Content_ID from API: "TSRC-ABC-123456"
- Original hyperlink text: "Document Title"
- Updated hyperlink text: "Document Title (123456)" ✅

### URL Reconstruction ✅

The API integration still correctly reconstructs theSource URLs using Document_ID:

```typescript
if (apiResult.documentId && options.operations?.fixContentIds) {
  const newUrl = `https://thesource.cvshealth.com/nuxeo/thesource/#!/view?docid=${apiResult.documentId.trim()}`;
  // Note: No #content appended! ✅
}
```

---

## What Changed

| Feature           | Before (WRONG)                           | After (CORRECT)                                   |
| ----------------- | ---------------------------------------- | ------------------------------------------------- |
| URL Format        | `https://...?docid=abc123#content` ❌    | `https://...?docid=abc123` ✅                     |
| Display Text      | "Document Title"                         | "Document Title (123456)" ✅                      |
| Processing Option | "theSource Content IDs" appends #content | "theSource Content IDs" updates display text only |

---

## Testing

To verify the fix:

1. Enable "theSource Content IDs" processing option
2. Process a document with theSource hyperlinks
3. Open the processed document
4. Click on a hyperlink
5. **Verify**: URL does NOT end with #content
6. **Verify**: Display text shows Content ID last 6 digits (if available from API)

---

## Files Modified

1. `src/services/document/WordDocumentProcessor.ts` - Disabled processContentIdAppending call
2. `src/pages/CurrentSession.tsx` - Removed appendContentId from session options
3. `src/types/session.ts` - Made appendContentId/contentIdToAppend optional (deprecated)

---

## Note

The `processContentIdAppending()` method still exists in the code but is never called. It can be removed in a future cleanup, but leaving it commented out for now in case there's any legacy dependency.
