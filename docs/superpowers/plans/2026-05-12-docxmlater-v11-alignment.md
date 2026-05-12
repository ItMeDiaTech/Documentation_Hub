# docxmlater v11 alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four defects exposed by the docxmlater 10→11 upgrade and adopt `consolidateAllRevisions()` to clean up tracked-change output before save.

**Architecture:** Mechanical, single-file changes for the four bug fixes. One small new helper module (`revisionConsolidation.ts`) for the optimization, called once in the existing save sequence. No structural refactor.

**Tech Stack:** TypeScript 6, docxmlater 11.0.4, Jest 30. Spec: `docs/superpowers/specs/2026-05-11-docxmlater-v11-alignment-design.md`.

---

## Pre-flight check

Verify environment before starting any task.

- [ ] **Step 0a: Confirm docxmlater version**

Run: `npm ls docxmlater`
Expected output contains: `docxmlater@11.0.4`

- [ ] **Step 0b: Capture baseline test results**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests: 3 failed, 318 passed, 321 total` (these are the 3 failures the plan addresses or tolerates).

If you see a different baseline, stop and investigate — the plan assumes the audit's recorded state.

---

## Spec drift note (read before starting)

The spec lists six work items: **B1–B4** (bug fixes) and **O2/O3** (optimizations).

While drafting this plan, a code reading revealed that `WordDocumentProcessor.ts:2802-2803` explicitly disables tracked changes before invoking `BlankLineManager`, with the comment *"blank line operations should not appear as tracked changes"*. Tracked changes are re-enabled at line 2821 immediately after. This is an intentional design choice — blank-line management is a deterministic structural transformation, not user-visible edits.

**Decision:** O3 (`markParagraphMarkAsInserted` in `blankLineInsertion.ts`) is **dropped from this plan**. A `doc.isTrackChangesEnabled()` gate inside `BlankLineManager` would always be false at runtime, making the new code dead. Reversing the existing design is out of scope.

This plan covers **B1, B2, B3, B4, O2** only.

> **Update (during execution, 2026-05-12):** O2 was also dropped after Task 5 was implemented and reviewed. Reading `node_modules/docxmlater/dist/core/Document.js:1186-1188` showed `Document.save()` already calls `consolidateAllRevisions()` automatically when tracking is enabled, and the public return type is an object, not the number the spec assumed. A pre-save wrapper would have been redundant. Task 5 was reverted; the plan effectively shipped B1, B2, B3, B4 only.

---

## File map

| File | Action | What |
|------|--------|------|
| `src/services/document/__tests__/WordDocumentProcessor.test.ts` | Modify | B4: delete `normalizeTableLists` mock line |
| `src/services/document/processors/__tests__/HyperlinkProcessor.test.ts` | Modify | B3: add `getFullUrl` to `createMockHyperlink` |
| `src/services/document/WordDocumentProcessor.ts` | Modify | B2: drop `defragmentHyperlinks` from CleanupHelper.run + fix log; O2: call new consolidation helper before save |
| `src/components/editor/DocumentEditorModal.tsx` | Modify | B1: `setShading(string)` → `setBackgroundColor(color)` |
| `src/services/document/helpers/revisionConsolidation.ts` | Create | O2: new tiny helper module |
| `src/services/document/helpers/__tests__/revisionConsolidation.test.ts` | Create | O2: unit tests for the helper |

Total: 5 modifications, 2 new files.

---

## Task 1: B4 — Delete stale `normalizeTableLists` test mock

**Files:**
- Modify: `src/services/document/__tests__/WordDocumentProcessor.test.ts:122`

`Document.normalizeTableLists()` was removed from docxmlater's public API in v10.0.0. Production code already moved to a local `ListNormalizer`. The mock entry is dead.

- [ ] **Step 1.1: Open the file at the right line**

Inspect lines 118-130 in `src/services/document/__tests__/WordDocumentProcessor.test.ts`. Confirm line 122 is exactly:

```ts
      normalizeTableLists: jest.fn().mockReturnValue({ tablesProcessed: 0, listsConverted: 0 }),
```

- [ ] **Step 1.2: Delete the line**

Remove that one line entirely. Do not delete the comment `// Lists` immediately above — it groups subsequent mock entries.

After deletion, line 121 should be `// Lists` and the next entry should be `removeBlanksBetweenListItems: ...`.

- [ ] **Step 1.3: Run typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no output. (The test file is excluded from tsconfig, but the rest of the project must still compile.)

- [ ] **Step 1.4: Commit**

```bash
git add src/services/document/__tests__/WordDocumentProcessor.test.ts
git commit -m "test: remove dead normalizeTableLists mock (docxmlater v10 removed it)"
```

---

## Task 2: B3 — Add `getFullUrl` to the hyperlink mock factory

**Files:**
- Modify: `src/services/document/processors/__tests__/HyperlinkProcessor.test.ts:302-313`

`HyperlinkProcessor.applyUrlUpdates` at `HyperlinkProcessor.ts:164` calls `item.getFullUrl()`. The mock factory doesn't stub it, so two tests fail with `result.updated === 0`.

- [ ] **Step 2.1: Run the failing tests first**

Run: `npx jest --testPathPatterns=HyperlinkProcessor`
Expected: 2 failures —
- `applyUrlUpdates › should update URLs in hyperlinks` (expected `result.updated` to be 1, got 0)
- `applyUrlUpdates › should track failed updates` (expected `result.failed` length 1, got 0)

- [ ] **Step 2.2: Add `getFullUrl` to the mock factory**

Edit `createMockHyperlink` (currently lines 302-313) by inserting one line between `getUrl` and `getText`:

Before:
```ts
function createMockHyperlink(url: string, text: string): jest.Mocked<Hyperlink> {
  return {
    getUrl: jest.fn().mockReturnValue(url),
    getText: jest.fn().mockReturnValue(text),
    setText: jest.fn(),
    setUrl: jest.fn(),
    setFormatting: jest.fn(),
    getFormatting: jest.fn().mockReturnValue({}),
    getAnchor: jest.fn().mockReturnValue(null),
    clone: jest.fn(),
  } as unknown as jest.Mocked<Hyperlink>;
}
```

After:
```ts
function createMockHyperlink(url: string, text: string): jest.Mocked<Hyperlink> {
  return {
    getUrl: jest.fn().mockReturnValue(url),
    getFullUrl: jest.fn().mockReturnValue(url),
    getText: jest.fn().mockReturnValue(text),
    setText: jest.fn(),
    setUrl: jest.fn(),
    setFormatting: jest.fn(),
    getFormatting: jest.fn().mockReturnValue({}),
    getAnchor: jest.fn().mockReturnValue(null),
    clone: jest.fn(),
  } as unknown as jest.Mocked<Hyperlink>;
}
```

Rationale: `getFullUrl()` returns the URL including any `w:anchor` fragment. For tests that don't exercise anchors, returning the same value as `getUrl()` is correct.

- [ ] **Step 2.3: Re-run the suite, confirm green**

Run: `npx jest --testPathPatterns=HyperlinkProcessor`
Expected: `Tests: 14 passed, 14 total` (was 12 passed, 2 failed).

- [ ] **Step 2.4: Commit**

```bash
git add src/services/document/processors/__tests__/HyperlinkProcessor.test.ts
git commit -m "test: stub getFullUrl in createMockHyperlink to fix applyUrlUpdates tests"
```

---

## Task 3: B2 — Drop redundant `defragmentHyperlinks` flag from CleanupHelper

**Files:**
- Modify: `src/services/document/WordDocumentProcessor.ts:3714-3729`

Project already defrags hyperlinks pre-tracking at line 966 (with comment "silently skipped when track changes is active"). At line 3717 tracking is on, so `defragmentHyperlinks: true` in `CleanupHelper.run({...})` is guaranteed to no-op. Removing the flag and the corresponding log fragment.

- [ ] **Step 3.1: Inspect the current block**

Read `src/services/document/WordDocumentProcessor.ts:3713-3733`. The current code is:

```ts
      this.log.debug("=== DOCUMENT CLEANUP ===");
      try {
        const cleanup = new CleanupHelper(doc);
        const cleanupReport = cleanup.run({
          defragmentHyperlinks: true,
          cleanupNumbering: false,
          cleanupRelationships: true,
        });
        if (
          cleanupReport.hyperlinksDefragmented > 0 ||
          cleanupReport.numberingRemoved > 0 ||
          cleanupReport.relationshipsRemoved > 0
        ) {
          this.log.info(
            `Cleanup: ${cleanupReport.hyperlinksDefragmented} hyperlinks defragmented, ${cleanupReport.numberingRemoved} unused numbering removed, ${cleanupReport.relationshipsRemoved} orphaned relationships removed`
          );
        }
      } catch (cleanupError) {
        this.log.debug("Cleanup completed with warnings:", cleanupError);
        // Non-fatal - continue with save
      }
```

- [ ] **Step 3.2: Remove the flag and trim the log message**

Replace the block with:

```ts
      this.log.debug("=== DOCUMENT CLEANUP ===");
      try {
        const cleanup = new CleanupHelper(doc);
        // defragmentHyperlinks is not requested here — it silently no-ops once
        // track changes is enabled (see line ~966 for the pre-tracking defrag).
        const cleanupReport = cleanup.run({
          cleanupNumbering: false,
          cleanupRelationships: true,
        });
        if (cleanupReport.numberingRemoved > 0 || cleanupReport.relationshipsRemoved > 0) {
          this.log.info(
            `Cleanup: ${cleanupReport.numberingRemoved} unused numbering removed, ${cleanupReport.relationshipsRemoved} orphaned relationships removed`
          );
        }
      } catch (cleanupError) {
        this.log.debug("Cleanup completed with warnings:", cleanupError);
        // Non-fatal - continue with save
      }
```

Changes: removed `defragmentHyperlinks: true` from the options, removed `hyperlinksDefragmented` from the condition, removed the `hyperlinks defragmented` fragment and its dynamic value from the log.

- [ ] **Step 3.3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3.4: Run full test suite for regressions**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests: 1 failed, 320 passed, 321 total` — only the pre-existing `wontprocess.test.ts` fixture failure remains. (B3 was completed in Task 2.)

If a different failure appears, revert and investigate.

- [ ] **Step 3.5: Commit**

```bash
git add src/services/document/WordDocumentProcessor.ts
git commit -m "fix: drop dead defragmentHyperlinks flag from post-tracking CleanupHelper run"
```

---

## Task 4: B1 — Fix silent shading data loss in the editor

**Files:**
- Modify: `src/components/editor/DocumentEditorModal.tsx:121`

`setShading(string)` stores the string into `formatting.shading`, but the serializer reads `formatting.shading.fill` — undefined on a string — and emits no shading. Editor-set cell colors are dropped on save. `setBackgroundColor(color)` internally builds `{ fill: color, pattern: "clear" }`.

- [ ] **Step 4.1: Inspect the current call**

Read `src/components/editor/DocumentEditorModal.tsx:115-125`. Confirm line 121 is exactly:

```ts
                  docCell.setShading(editorCell.shading.replace("#", ""));
```

- [ ] **Step 4.2: Replace `setShading` with `setBackgroundColor`**

Change line 121 to:

```ts
                  docCell.setBackgroundColor(editorCell.shading.replace("#", ""));
```

- [ ] **Step 4.3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. (`setBackgroundColor(color: string)` is the canonical signature.)

- [ ] **Step 4.4: Run the test suite**

Run: `npm test 2>&1 | tail -5`
Expected: same as after Task 3 — only the `wontprocess.test.ts` fixture failure remains. No editor-modal tests exist that touch this path; the fix is verified by typecheck plus the manual smoke test below.

- [ ] **Step 4.5: Manual smoke test (defer if you don't have a dev environment)**

If a dev environment is available:

```bash
npm run electron:dev
```

1. Open the app, load any document with a table.
2. Open the in-app document editor on that document.
3. Change a table cell's shading color to something distinctive (e.g. red).
4. Save and close the editor.
5. Re-open the document and confirm the cell shading persists.

If you cannot run the dev environment, document the deferral in the commit body so QA picks it up.

- [ ] **Step 4.6: Commit**

```bash
git add src/components/editor/DocumentEditorModal.tsx
git commit -m "fix: persist editor cell shading via setBackgroundColor (setShading needs ShadingConfig object)"
```

---

## Task 5: O2 — Add revision consolidation helper

**Files:**
- Create: `src/services/document/helpers/revisionConsolidation.ts`
- Create: `src/services/document/helpers/__tests__/revisionConsolidation.test.ts`
- Modify: `src/services/document/WordDocumentProcessor.ts` (around line 3906–3912)

Before save, when tracking is enabled, call `doc.consolidateAllRevisions()` to merge adjacent same-author revisions. This produces a cleaner Word review pane. Isolate the call in a small helper so it can be unit-tested without booting the full processor.

- [ ] **Step 5.1: Write the failing test**

Create `src/services/document/helpers/__tests__/revisionConsolidation.test.ts` with:

```ts
import { consolidateAdjacentRevisions } from "../revisionConsolidation";
import type { Document } from "docxmlater";

interface MockDoc {
  isTrackChangesEnabled: jest.Mock<boolean, []>;
  consolidateAllRevisions: jest.Mock<number, []>;
}

function makeDoc(tracking: boolean, consolidatedCount = 0): MockDoc {
  return {
    isTrackChangesEnabled: jest.fn().mockReturnValue(tracking),
    consolidateAllRevisions: jest.fn().mockReturnValue(consolidatedCount),
  };
}

describe("consolidateAdjacentRevisions", () => {
  it("returns 0 and does not call consolidateAllRevisions when tracking is disabled", () => {
    const doc = makeDoc(false);
    const result = consolidateAdjacentRevisions(doc as unknown as Document);
    expect(result).toBe(0);
    expect(doc.consolidateAllRevisions).not.toHaveBeenCalled();
  });

  it("calls consolidateAllRevisions and returns its count when tracking is enabled", () => {
    const doc = makeDoc(true, 4);
    const result = consolidateAdjacentRevisions(doc as unknown as Document);
    expect(result).toBe(4);
    expect(doc.consolidateAllRevisions).toHaveBeenCalledTimes(1);
  });

  it("returns 0 when tracking is enabled but nothing was consolidated", () => {
    const doc = makeDoc(true, 0);
    const result = consolidateAdjacentRevisions(doc as unknown as Document);
    expect(result).toBe(0);
    expect(doc.consolidateAllRevisions).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `npx jest --testPathPatterns=revisionConsolidation`
Expected: FAIL with `Cannot find module '../revisionConsolidation'`.

- [ ] **Step 5.3: Implement the helper**

Create `src/services/document/helpers/revisionConsolidation.ts` with:

```ts
import type { Document } from "docxmlater";

/**
 * Merge adjacent same-author tracked revisions into single revision blocks.
 *
 * Called immediately before save. When tracking is disabled the function is
 * a no-op — many DocHub options enable tracking only for specific stages, so
 * this guard avoids spurious work and keeps the integration drop-in safe.
 *
 * @returns the number of revisions consolidated (0 if tracking is off)
 */
export function consolidateAdjacentRevisions(doc: Document): number {
  if (!doc.isTrackChangesEnabled()) return 0;
  return doc.consolidateAllRevisions();
}
```

- [ ] **Step 5.4: Run test to verify it passes**

Run: `npx jest --testPathPatterns=revisionConsolidation`
Expected: `Tests: 3 passed, 3 total`.

- [ ] **Step 5.5: Integrate into the save sequence**

Open `src/services/document/WordDocumentProcessor.ts`. Find the numbering-cleanup block ending at line 3910 (the `} catch (cleanupError) {` at line 3907 plus closing brace). Immediately **after** that closing brace and **before** `await doc.save(filePath);` at line 3912, add:

```ts
      // Consolidate adjacent same-author tracked revisions for a tidier
      // review pane. No-op when tracking is disabled.
      try {
        const consolidated = consolidateAdjacentRevisions(doc);
        if (consolidated > 0) {
          this.log.info(`Consolidated ${consolidated} adjacent revision(s) before save`);
        }
      } catch (consolidateError) {
        // Non-fatal — log and continue to save
        this.log.warn("Revision consolidation failed (non-fatal):", consolidateError);
      }

```

Then add the import. At the top of `WordDocumentProcessor.ts`, find the imports from `./helpers/...` (search for `import.*from ['"]\\.\\/helpers`). Add a new line in that import group:

```ts
import { consolidateAdjacentRevisions } from "./helpers/revisionConsolidation";
```

If no such group exists, add the import alphabetically among the other local imports near the top of the file.

- [ ] **Step 5.6: Extend the broken WordDocumentProcessor.test.ts mock so it doesn't break further**

The file at `src/services/document/__tests__/WordDocumentProcessor.test.ts` is documented in `src/services/document/CLAUDE.md` as "has a pre-existing ESM/v8 import error and won't run." Even so, future repair will need this mock entry. Add to the mock object right after line 102's `isTrackChangesEnabled` entry:

Find:
```ts
      isTrackChangesEnabled: jest.fn().mockReturnValue(false),
```

Add immediately below:
```ts
      consolidateAllRevisions: jest.fn().mockReturnValue(0),
```

This is forward-looking maintenance; it does not affect any running test today.

- [ ] **Step 5.7: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5.8: Run full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: `Tests: 1 failed, 323 passed, 324 total` — three new tests for the helper, only the pre-existing `wontprocess.test.ts` fixture failure remains.

- [ ] **Step 5.9: Commit**

```bash
git add src/services/document/helpers/revisionConsolidation.ts \
        src/services/document/helpers/__tests__/revisionConsolidation.test.ts \
        src/services/document/WordDocumentProcessor.ts \
        src/services/document/__tests__/WordDocumentProcessor.test.ts
git commit -m "feat: consolidate adjacent same-author revisions before save (docxmlater 9.5.31)"
```

---

## Task 6: Final verification

- [ ] **Step 6.1: Typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no output.

- [ ] **Step 6.2: Full test suite**

Run: `npm test 2>&1 | tail -10`
Expected:
- `Test Suites: 2 failed, 14 passed, 16 total` (only `wontprocess.test.ts` fixture missing **and** `GlobalStatsContext.test.tsx` suite failing on missing `@testing-library/dom` peer dep — both pre-existing per spec sections P1/P2, out of scope)
- `Tests: 1 failed, 323 passed, 324 total` (the `GlobalStatsContext` suite fails to load, so it contributes 0 tests to the count)

The expected delta from baseline (3 failed → 1 failed in test count):
- 2 hyperlink tests fixed (Task 2)
- 3 new revision-consolidation tests added (Task 5)
- 1 new test suite added (revisionConsolidation), so suite total is 15 → 16

- [ ] **Step 6.3: Lint**

Run: `npm run lint -- src/`
Expected: passes for the files touched (other files may have pre-existing lint warnings; do not address them).

- [ ] **Step 6.4: Confirm no spec items left undone**

Cross-reference the spec's "Acceptance" section:
- ✅ docxmlater-related test failures gone (B3 fixed both)
- ✅ TypeScript compiles cleanly
- ⏸ Manual B1 verification — only if the dev environment was available in Task 4.5; otherwise document deferral
- ✅ New tests for O2 pass
- N/A O3 dropped — see spec drift note at top of this plan
- ✅ No regression in previously-passing tests

- [ ] **Step 6.5: Final summary commit (optional)**

If any incidental changes were captured along the way (e.g. updated `package-lock.json` from `npm install`), make sure they are committed as part of the appropriate earlier task — do not create a catch-all commit at the end.

---

## Self-review checklist (run after the plan above is implemented)

This is a checklist for the executing agent (not for you, the plan author).

1. Open the spec, walk each section, confirm a task covers it. O3 is the only spec item not implemented; the deviation is documented in this plan's "Spec drift note" section.
2. Grep for `TBD`, `TODO`, `FIXME` introduced by your changes (`git diff --stat` then `git diff --unified=0` and check). None should be present.
3. Confirm `consolidateAdjacentRevisions` is spelled the same in the import, the call site, the helper module, and the test file. (The name appears in all four locations — verify they match exactly.)
4. Confirm the log message wording changes in Task 3 don't break any test that grep's the log output. Run: `grep -rn "hyperlinks defragmented" src/ --include="*.ts"` — there should be NO matches in source after Task 3.

If anything is off, fix inline and re-run `npm test`.
