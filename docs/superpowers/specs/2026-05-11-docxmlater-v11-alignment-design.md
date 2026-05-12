# docxmlater v11 alignment — bug fixes and revision-quality improvements

**Date:** 2026-05-11
**Library upgrade:** `docxmlater` 10.4.1 → 11.0.4 (already installed)
**Status:** Design — pending review

## Goal

Capitalize on the docxmlater 10.5–11.x changes by:

1. Fixing four concrete defects in the project's current usage.
2. Adopting two narrowly-scoped new APIs (`consolidateAllRevisions`, `markParagraphMarkAsInserted`) that improve the quality of tracked-change output without restructuring the processor.

Larger refactors (streaming iterators, event system, URL-sanitization audit, run-level revisions) are deliberately out of scope and called out for future brainstorms.

## Context

`docxmlater` 11.0.4 (latest) was installed on 2026-05-11, replacing 10.4.1. The library introduced several new APIs and removed/changed a few. A targeted audit found:

- Production code already uses most of the new high-value methods (`optimizeImages`, `defragmentHyperlinks`, `clearMatchingFormatting`, `upgradeToModernFormat`, `cleanupUnusedNumbering`, `consolidateNumbering`).
- All CLAUDE.md gotchas remain accurate against v11.
- Four defects exist; two new APIs would meaningfully improve tracked-change UX without large refactors.

## Phase A — Bug fixes

### B1. Editor cell shading silently fails to persist

**File:** `src/components/editor/DocumentEditorModal.tsx:121`

**Current:**
```ts
docCell.setShading(editorCell.shading.replace("#", ""));
```

**Problem:** `TableCell.setShading()` requires `ShadingConfig` (object with `fill`, `pattern`, etc.). The implementation in `node_modules/docxmlater/dist/elements/TableCell.js` blindly stores the argument into `formatting.shading`. When the document is serialized later, the renderer reads `formatting.shading.fill` — `undefined` on a string — and emits no shading. Cell color set in the in-app editor is dropped on save.

**Fix:**
```ts
docCell.setBackgroundColor(editorCell.shading.replace("#", ""));
```

`setBackgroundColor` internally calls `setShading({ fill, pattern: "clear" })`.

**Risk:** Low. User-visible improvement: cell color edits actually persist.

### B2. Redundant post-tracking hyperlink defrag

**File:** `src/services/document/WordDocumentProcessor.ts:3714-3733`

**Current:**
```ts
const cleanup = new CleanupHelper(doc);
const cleanupReport = cleanup.run({
  defragmentHyperlinks: true,   // <-- silently no-ops here
  cleanupNumbering: false,
  cleanupRelationships: true,
});
```

The project already calls `doc.defragmentHyperlinks(...)` at line 966 **before** tracking is enabled (with the documented comment "defragmentHyperlinks() is silently skipped when track changes is active — returns 0"). By the time `CleanupHelper.run({ defragmentHyperlinks: true })` runs here, tracking is on, so the flag is dead code.

**Fix:**
```ts
const cleanupReport = cleanup.run({
  cleanupNumbering: false,
  cleanupRelationships: true,
});
```

Drop `defragmentHyperlinks` from the post-tracking pass. Update the surrounding log message to match (no `hyperlinksDefragmented` from this call any more).

**Risk:** None — removing a no-op.

### B3. HyperlinkProcessor test mock missing `getFullUrl`

**File:** `src/services/document/processors/__tests__/HyperlinkProcessor.test.ts:302-313`

`HyperlinkProcessor.applyUrlUpdates` (HyperlinkProcessor.ts:164) calls `item.getFullUrl()` to include `w:anchor` fragments in the match key. The mock factory `createMockHyperlink` does not stub it, so `oldUrl` is `undefined` and `urlMap.has(oldUrl)` is false → 0 updates instead of 1.

**Fix:** Add to the returned object:
```ts
getFullUrl: jest.fn().mockReturnValue(url),
```

(Same `url` as `getUrl`. Tests don't exercise anchor-fragment behavior; if/when they do, mock can be split.)

**Risk:** None — restores green tests.

### B4. Stale mock for removed Document API

**File:** `src/services/document/__tests__/WordDocumentProcessor.test.ts:122`

`Document.normalizeTableLists()` was removed from the public API in docxmlater v10.0.0. Production code already migrated to a local `ListNormalizer` class. The mock entry is harmless but misleading.

**Fix:** Delete the line:
```ts
normalizeTableLists: jest.fn().mockReturnValue({ tablesProcessed: 0, listsConverted: 0 }),
```

Keep the project's own `options.normalizeTableLists` flag — that is a separate concept (option name → uses local normalizer).

**Risk:** None.

## Phase B — Revision quality

> **Implementation discovery (2026-05-12):** O2 was reverted during implementation. Reading `node_modules/docxmlater/dist/core/Document.js:1186-1188` revealed that `Document.save()` **already calls** `consolidateAllRevisions()` automatically when tracking is enabled. Also, the public return type is `{ paragraphsProcessed, revisionsConsolidated }`, not `number` as the spec originally assumed. A pre-save wrapper would add an extra pass (the second auto-call in `save()` returns nothing useful afterward) purely to capture a log line — not worth it under the project's "no abstractions beyond what the task requires" rule. **Both items below are dropped.** Keeping the rationale here for future reference.

### O2. Consolidate adjacent revisions before save

**File:** `src/services/document/WordDocumentProcessor.ts`, just before `await doc.save(filePath);` at line 3912.

**Why:** The project creates many small tracked changes by the same author (e.g. one revision per URL replacement in `HyperlinkProcessor.applyUrlUpdates`, one per color/font change). In Word's review pane these appear as separate entries. `doc.consolidateAllRevisions()` (v9.5.31) merges adjacent same-author revisions into single blocks, producing a cleaner review experience.

**Add:**
```ts
// Consolidate adjacent same-author tracked revisions for a tidier review pane
if (doc.isTrackChangesEnabled()) {
  const consolidated = doc.consolidateAllRevisions();
  if (consolidated > 0) {
    this.log.info(`Consolidated ${consolidated} adjacent revision(s)`);
  }
}
```

Placed inside the existing numbering-cleanup `try/catch` block, or in its own `try/catch` immediately above the `save()` call.

**Risk:** Low. The merged revisions still have full undo/accept semantics in Word.

### O3. Mark inserted paragraph marks under tracking

**File:** `src/services/document/blanklines/helpers/blankLineInsertion.ts`

**Why:** When blank-line rules insert a new paragraph and tracking is enabled, the paragraph itself is wrapped in an insertion revision, but the **paragraph mark** of the *preceding* paragraph is not — meaning Word doesn't visually show the new paragraph break as an insertion. v10.0.4 added `markParagraphMarkAsInserted(author, date?)` for exactly this case.

**Add (sketch — exact placement depends on the helper's existing structure):**
```ts
const newPara = /* existing insertion */;
const precedingPara = /* paragraph before insertion point */;
if (doc.isTrackChangesEnabled() && precedingPara) {
  precedingPara.markParagraphMarkAsInserted(author);
}
```

`clearParagraphMarkInsertion()` is the inverse, used if a paragraph insertion is later undone.

**Risk:** Low when correctly gated behind `isTrackChangesEnabled()`. Without the gate, the marker would render with no enclosing revision, which looks like corruption in Word.

## Out of scope (future brainstorms)

- **O1. Streaming iterators.** `iterateParagraphs()`, `iterateBodyElements()`, `iterateSections()`. WordDocumentProcessor.ts is ~9k lines with many `getAllParagraphs()` materializations. Refactor would touch dozens of call sites — separate spec.
- **O4. Document event system.** `doc.on("save", ...)` etc. Useful for UI progress reporting but requires renderer-process plumbing.
- **O5. URL sanitization audit.** Compare project's `urlPatterns.ts` against docxmlater's `sanitizeHyperlinkUrl()` / `validateAndFix()`.
- **O6. Run-level property-change revisions.** `Run.getPropertyChangeRevision()` / `setPropertyChangeRevision()` for tracked formatting changes. Worth investigating once the higher-priority work lands.

Unrelated to docxmlater, but blocking CI:

- **P1.** `GlobalStatsContext.test.tsx` fails because `@testing-library/dom` is missing. Add as a dev dependency.
- **P2.** `wontprocess.test.ts` references a fixture path outside the repo. Either commit the fixture or `skip` the test.

## Architecture

No structural changes. All Phase A edits are single-line. Phase B adds two narrowly-scoped calls inside existing flows. No new modules or abstractions.

## Components touched

| Component | Change |
|-----------|--------|
| `DocumentEditorModal.tsx` | B1: method swap |
| `WordDocumentProcessor.ts` | B2: drop flag from CleanupHelper options; O2: add consolidateAllRevisions before save |
| `blankLineInsertion.ts` | O3: mark preceding paragraph's mark as inserted under tracking |
| `HyperlinkProcessor.test.ts` | B3: extend mock factory |
| `WordDocumentProcessor.test.ts` | B4: delete one mock line |

## Testing strategy

| Item | Test |
|------|------|
| B1 | Manual: edit a table cell color in the in-app editor, save, re-open, confirm color persists. Add unit test if editor has a serialization harness. |
| B2 | Existing `hyperlinkTracking.test.ts` already covers the silent-skip behavior. No new test. |
| B3 | Re-run `HyperlinkProcessor.test.ts` — the two `applyUrlUpdates` tests should pass. |
| B4 | Re-run `WordDocumentProcessor.test.ts` — should pass unchanged. |
| O2 | New unit test: create two same-author revisions on adjacent runs, run save path, assert revision count decreases. |
| O3 | New unit test: enable tracking, invoke blank-line insertion, save XML, grep output for `<w:rPr><w:ins .../></w:rPr>` inside `w:pPr` of the preceding paragraph. |

## Build sequence

1. B4 (1 line delete) — no-risk warm-up.
2. B3 (mock factory addition) — confirms HyperlinkProcessor suite green.
3. B2 (flag removal + log message tweak).
4. B1 (single-line method swap) — verify manually.
5. O2 (new save-time call + log + test).
6. O3 (new helper invocation + test).
7. Full `npm run typecheck` and `npm test`.

## Acceptance

- All three docxmlater-related test failures gone (B3 alone fixes 2; nothing else is upgrade-induced).
- TypeScript compiles cleanly (already does post-upgrade).
- Manual verification of B1 (cell shading round-trip) passes.
- New tests for O2 and O3 pass.
- No regression in the 318 currently-passing tests.
