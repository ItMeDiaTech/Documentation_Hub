# GitHub Issues to Create - docXMLater Analysis

Based on the comprehensive analysis of docxmlater usage (2025-11-13), create the following GitHub issues in the repository.

**Analysis Document:** `docs/analysis/docxmlater-implementation-analysis-2025-11-13.md`

---

## Critical Priority Issues (Create First)

### Issue #1: Memory Leaks from Inconsistent dispose() Usage

**Title:** Fix inconsistent Document.dispose() usage to prevent memory leaks in batch processing

**Labels:** `bug`, `critical`, `memory-leak`, `performance`

**Description:**
Document objects from `Document.load()` and `Document.create()` are not consistently disposed in all code paths, leading to memory leaks during batch document processing operations.

**Affected Files:**
- `src/services/document/WordDocumentProcessor.ts:843-850, 794-800`
- Any method creating Document objects

**Current Pattern:**
```typescript
finally {
  if (doc) {
    try {
      doc.dispose();
    } catch (disposeError) {
      this.log.warn('Failed to dispose document:', disposeError);
    }
  }
}
```

**Issues:**
- dispose() not called if exception before doc assignment
- Early returns bypass cleanup
- Nested operations don't cleanup
- Conditional disposal inconsistent

**Recommended Pattern:**
```typescript
let doc: Document | null = null;
try {
  doc = await Document.load(filePath, { strictParsing: false });
  // ... processing ...
} finally {
  doc?.dispose();  // Always cleanup
}
```

**Tasks:**
- [ ] Audit ALL methods using Document objects
- [ ] Ensure every Document.load()/create() has matching dispose()
- [ ] Check for early returns that skip dispose()
- [ ] Add memory leak tests

**Estimated Effort:** 2-4 hours

---

### Issue #2: Hyperlink.getText() Returns XML-Corrupted Text (Upstream Bug)

**Title:** Hyperlink.getText() returns XML markup - defensive workaround needed + upstream bug report

**Labels:** `bug`, `critical`, `external-dependency`, `user-experience`

**Description:**
The `Hyperlink.getText()` method in docxmlater v1.15.0 returns text with embedded XML markup like `<w:t xml:space="preserve">`, resulting in user-visible XML tags in the application UI.

**Current Workaround:**
We've implemented defensive sanitization in `src/utils/textSanitizer.ts`:
```typescript
export function sanitizeHyperlinkText(text: string): string {
  return text
    .replace(/<w:t[^>]*>/g, '')
    .replace(/<\/w:t>/g, '')
    .replace(/xml:space="preserve"/g, '')
    .trim();
}
```

**Root Cause:**
Bug in docxmlater - `Run()` constructor auto-cleans with `cleanXmlFromText: true` by default, but `Hyperlink.getText()` doesn't apply the same cleanup.

**Tasks:**
- [ ] Create GitHub issue in docxmlater repository
- [ ] Add detection logging to sanitization function
- [ ] Create integration test to auto-detect when bug is fixed
- [ ] Document workaround with TODO for removal
- [ ] Add to dependency upgrade checklist

**Estimated Effort:** 1 hour (bug report) + ongoing monitoring

---

### Issue #3: Missing Error Handling in Batch URL Updates

**Title:** Add error handling to URL update operations to prevent document corruption

**Labels:** `bug`, `critical`, `data-integrity`, `error-handling`

**Description:**
The `applyUrlUpdates()` method lacks error handling around `setUrl()` calls, which can leave documents in an inconsistent state if some updates fail while others succeed.

**Current Code:**
```typescript
item.setUrl(newUrl);  // ⚠️ No error handling
updatedCount++;
```

**Problem:**
If `setUrl()` throws, partial updates occur with no tracking of failures.

**Recommended Solution:**
```typescript
try {
  item.setUrl(newUrl);
  updatedCount++;
} catch (error) {
  this.log.error(`Failed to update URL: ${oldUrl} -> ${newUrl}`, error);
  failedUrls.push({ oldUrl, newUrl, error });
}
```

**Tasks:**
- [ ] Implement error handling with failure tracking
- [ ] Update return type to include failed URLs
- [ ] Add tests for error scenarios
- [ ] Update callers to handle failures

**Estimated Effort:** 2-3 hours

---

## High Priority Issues (Create After Critical)

### Issue #4: Replace Manual URL Updates with Built-in doc.updateHyperlinkUrls()

**Title:** Optimize URL updates by using built-in doc.updateHyperlinkUrls() method

**Labels:** `enhancement`, `optimization`, `refactoring`, `performance`

**Description:**
The codebase manually loops through paragraphs and hyperlinks to update URLs (30+ lines), which is inefficient and misses hyperlinks in tables/headers/footers. docxmlater provides a built-in optimized method.

**Current:** 30+ lines of manual O(n*m) loop
**Better:** `doc.updateHyperlinkUrls(urlMap)` (1 line, optimized)

**Benefits:**
- 30-50% faster performance
- Handles all hyperlink locations (tables, headers, footers)
- Less code to maintain
- Library-tested functionality

**Tasks:**
- [ ] Verify API availability in v1.15.0
- [ ] Replace manual implementation
- [ ] Add tests for all hyperlink locations
- [ ] Benchmark performance improvement

**Estimated Effort:** 1-2 hours

---

### Issue #5: Replace Manual Hyperlink Extraction with Built-in doc.getHyperlinks()

**Title:** Simplify hyperlink extraction using built-in doc.getHyperlinks() method

**Labels:** `enhancement`, `optimization`, `refactoring`, `code-quality`

**Description:**
The `extractHyperlinks()` method manually loops through paragraphs (46 lines) to find hyperlinks, missing those in tables/headers/footers. docxmlater provides a built-in comprehensive method.

**Current:** 46 lines of manual extraction
**Better:** `doc.getHyperlinks()` + mapping (5 lines)

**Benefits:**
- 89% code reduction
- Comprehensive coverage (all document parts)
- Library-tested code
- Easier to maintain

**Tasks:**
- [ ] Replace manual implementation
- [ ] Add tests for tables, headers, footers
- [ ] Verify all existing tests pass

**Estimated Effort:** 30 minutes

---

## Sprint Planning

### Sprint 1 (Critical Issues)
**Focus:** Fix memory leaks and data integrity issues
**Total Effort:** 5-8 hours

1. Issue #1 - Memory leaks (2-4 hours)
2. Issue #3 - Error handling (2-3 hours)
3. Issue #2 - Report bug + monitoring (1 hour)

### Sprint 2 (High Priority)
**Focus:** Code optimization and quality improvements
**Total Effort:** 1.5-2.5 hours

4. Issue #5 - Use getHyperlinks() (30 min) ✅ Quick win
5. Issue #4 - Use updateHyperlinkUrls() (1-2 hours)

---

## Issue Creation Checklist

When creating each issue:

- [ ] Copy title and labels exactly
- [ ] Include full description with code examples
- [ ] Add estimated effort
- [ ] Reference analysis document
- [ ] Assign to appropriate milestone
- [ ] Link related issues (e.g., #3 and #4 are related)
- [ ] Add to project board if applicable

---

## Additional Context

**Full Analysis:** `docs/analysis/docxmlater-implementation-analysis-2025-11-13.md`
**Detailed Issues:** `/GH_Issues/` (gitignored, local only)
**Overall Grade:** B+ (85/100)
**Risk Level:** Medium (critical issues fixable in 1-2 sprints)

---

**Created:** 2025-11-13
