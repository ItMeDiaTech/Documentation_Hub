# Remove cross-type list conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop forcing bullets→numbered or numbered→bullets to make lists "uniform". Delete dead/vestigial code, refactor `ListNormalizer` so each Word-list item keeps its own category (with a correctly-typed numId).

**Architecture:** Mostly deletions (two orphan methods + one no-op method + their call site + a UI string). One substantive refactor in `ListNormalizer.ts`: remove sub-item-detection block, collapse the four `isWordList` action branches into one category-preserving branch, and split `getNumId` (currently majority-driven) into category-explicit `getNumberedNumId` / `getBulletNumId` helpers.

**Tech Stack:** TypeScript 6, Jest 30. Spec: `docs/superpowers/specs/2026-05-12-remove-cross-type-list-conversion-design.md`.

---

## Plan-time discovery (read before starting)

The spec called out one risk: the existing "preserve category" branch (`ListNormalizer.ts:805-818`) handles category preservation. While drafting this plan I discovered a deeper subtlety:

```ts
// ListNormalizer.ts ~ line 593-596 — getNumId helper
let numId =
  majorityCategory === "numbered"
    ? numberingManager.createNumberedList()
    : numberingManager.createBulletList();
```

`getNumId(level)` returns a **majority-category** numId, not a numbered one. The "preserve" branch at 805-818 uses `getNumId` for numbered items — but if the cell's majority is bullet, `getNumId` returns a BULLET list, silently converting the numbered item to bullet. The cross-type conversion would just move from the action-loop branches into `getNumId`'s internals.

**Solution:** Split `getNumId` into category-explicit `getNumberedNumId` (always creates numbered) and keep the existing `getBulletNumId` (already always creates bullet). The surviving `isWordList` action branch then routes by the item's own `detection.category`, never by majority.

The spec's acceptance criteria still hold; this is an implementation detail the plan must address. No spec update needed — the spec said "consolidate to a single 'preserve category, set consistent numId' branch", and this is what correct execution of that requires.

---

## File map

| File | Action | What |
|------|--------|------|
| `src/services/document/WordDocumentProcessor.ts` | Modify | Delete `convertMixedListFormats` (~9760-9858), `getFormatFallbackString` (~9743-9758), `convertNestedNumbersToBulletsInTableCells` (~9962+), `convertNestedNumbersToBulletsInBody` (~10077+), the call site (~2642-2651), and `mixedConverted` from the totals (~2665). Sweep comments. |
| `src/services/document/list/ListNormalizer.ts` | Modify | Delete sub-item detection (lines 417-528), level-shift recalc (529-575), typed-prefix sub-item branch (725-730), cross-type action branches (756-804). Consolidate to single `isWordList` branch. Rename `getNumId` → `getNumberedNumId` and make it always-numbered. Drop unused `needsConversion` and `parentIndexByIndex`. |
| `src/components/sessions/ProcessingOptions.tsx` | Modify | Drop "and fixes mixed lists" from line 55. |
| `src/services/document/list/__tests__/ListNormalizer.mixed-lists.test.ts` | Create | New test file with three behavioural tests pinning category-preservation. |

Total: 3 modifications, 1 new test file. No new production files.

---

## Pre-flight check

- [ ] **Step 0a: Capture baseline test state**

Run: `npm test 2>&1 | tail -5`
Expected: a small number of pre-existing failures (the docxmlater session left these intact: `wontprocess.test.ts` fixture missing, `GlobalStatsContext.test.tsx` peer-dep). Note the exact passing/failing counts so the delta after each task is observable.

- [ ] **Step 0b: Confirm clean head**

Run: `git log --oneline -1`
Expected: `9cbd59e docs: spec for removing cross-type list conversion (mixed bullet+numbered now allowed)`

---

## Task 1: Delete orphan dead code (`convertNestedNumbersToBullets*`)

Zero behavior change — these methods are defined but never called.

**Files:**
- Modify: `src/services/document/WordDocumentProcessor.ts`

- [ ] **Step 1.1: Verify no callers exist**

Run (PowerShell):
```
findstr /S /N /C:"this.convertNestedNumbersToBullets" src\
```
Or use Grep tool with pattern `this\.convertNestedNumbersToBullets`.
Expected: no matches.

If a match appears, STOP — the assumption is wrong. Investigate before deleting.

- [ ] **Step 1.2: Read both methods to determine exact boundaries**

Read `src/services/document/WordDocumentProcessor.ts` in the region around the two methods. The method `convertNestedNumbersToBulletsInTableCells` starts near line 9962 (the JSDoc starts a few lines before). `convertNestedNumbersToBulletsInBody` starts around line 10077.

For each method:
- Find its preceding JSDoc `/**` opening.
- Find the closing `}` that terminates the method body.
- Delete from JSDoc opening through closing brace **inclusive**, plus the trailing blank line.

- [ ] **Step 1.3: Delete `convertNestedNumbersToBulletsInTableCells`**

Use the Edit tool. The block begins with the JSDoc `/**` containing the comment line `* Convert nested numbered items to bullets in table cells where majority is bullets` and ends at the closing `}` of `convertNestedNumbersToBulletsInTableCells`. Delete the entire block, including the preceding JSDoc and the trailing blank line.

- [ ] **Step 1.4: Delete `convertNestedNumbersToBulletsInBody`**

Same procedure: the block begins with the JSDoc containing `* Convert nested numbered items to bullets in body lists where majority is bullets` and ends at its closing `}`.

- [ ] **Step 1.5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 1.6: Tests still at baseline**

Run: `npm test 2>&1 | tail -3`
Expected: identical to baseline from step 0a.

- [ ] **Step 1.7: Commit**

```bash
git add src/services/document/WordDocumentProcessor.ts
GIT_AUTHOR_NAME="Austin Jordan" GIT_AUTHOR_EMAIL="austingjordan@gmail.com" GIT_COMMITTER_NAME="Austin Jordan" GIT_COMMITTER_EMAIL="austingjordan@gmail.com" git commit -m "chore: remove orphan convertNestedNumbersToBullets methods (zero callers)"
```

(Identity is set per-commit via env vars rather than `git config` per the project's environment rules.)

---

## Task 2: Delete `convertMixedListFormats` (already no-op) + call site

The body of `convertMixedListFormats` already says `// DO NOT convert levels`. The function increments a counter that stays 0 and returns it. Removing the function plus its call site is a documented no-op.

**Files:**
- Modify: `src/services/document/WordDocumentProcessor.ts`

- [ ] **Step 2.1: Find the call site precisely**

Use Grep with pattern `convertMixedListFormats` against `src/services/document/WordDocumentProcessor.ts`. Expect ~5 hits clustered around lines 2645-2657 (the call site, debug log markers, totals) and lines 9743-9858 (the method + helper).

- [ ] **Step 2.2: Read the call-site block**

Read approximately lines 2640-2675. You should see:

```ts
        // Convert mixed list formats to maintain consistency within each abstractNum
        // This ensures all levels within a list use the same format type (all bullets or all numbered)
        // based on what level 0 uses (the dominant format)
        this.debugCaptureListState(doc, "BEFORE convertMixedListFormats");
        this.log.debug("=== CONVERTING MIXED LIST FORMATS ===");
        const mixedConverted = await this.convertMixedListFormats(doc, options.listBulletSettings);
        if (mixedConverted > 0) {
          this.log.info(`Converted ${mixedConverted} mixed list levels to uniform format`);
        }
        this.debugCaptureListState(doc, "AFTER convertMixedListFormats");
```

and later:

```ts
        // ORDERING: Must run AFTER all NumberingManager API calls (applyBulletUniformity,
        // applyNumberedUniformity, convertMixedListFormats) because it uses raw XML
```

and later still:

```ts
        const totalListsFixed = bulletsStandardized + numbersStandardized + mixedConverted;
```

- [ ] **Step 2.3: Remove the call-site block**

Use Edit. Delete the 10 lines shown in step 2.2 (the comment header through the `debugCaptureListState(doc, "AFTER convertMixedListFormats")` call). Keep a single blank line between the surrounding blocks.

- [ ] **Step 2.4: Fix the ORDERING comment**

Use Edit. Replace:

```ts
        // ORDERING: Must run AFTER all NumberingManager API calls (applyBulletUniformity,
        // applyNumberedUniformity, convertMixedListFormats) because it uses raw XML
```

with:

```ts
        // ORDERING: Must run AFTER all NumberingManager API calls (applyBulletUniformity,
        // applyNumberedUniformity) because it uses raw XML
```

- [ ] **Step 2.5: Fix the totals expression**

Use Edit. Change:

```ts
        const totalListsFixed = bulletsStandardized + numbersStandardized + mixedConverted;
```

to:

```ts
        const totalListsFixed = bulletsStandardized + numbersStandardized;
```

- [ ] **Step 2.6: Delete `convertMixedListFormats` method**

Locate the JSDoc starting `* Convert mixed list formats to maintain consistency within each abstractNum definition` (~line 9725). The block runs from the JSDoc through the closing `}` of `convertMixedListFormats`. Delete the whole block plus its trailing blank line.

- [ ] **Step 2.7: Delete `getFormatFallbackString` helper**

`getFormatFallbackString` exists only to support the now-deleted `convertMixedListFormats`. Locate its JSDoc (`* Get appropriate format fallback string based on format family`, ~line 9743) through its closing `}`. Delete the whole block.

Verify nothing else uses it. Run Grep with pattern `getFormatFallbackString` against `src/`. Expected: zero matches after deletion.

- [ ] **Step 2.8: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 2.9: Tests at baseline**

Run: `npm test 2>&1 | tail -3`
Expected: same as baseline. No new failures.

- [ ] **Step 2.10: Commit**

```bash
git add src/services/document/WordDocumentProcessor.ts
GIT_AUTHOR_NAME="Austin Jordan" GIT_AUTHOR_EMAIL="austingjordan@gmail.com" GIT_COMMITTER_NAME="Austin Jordan" GIT_COMMITTER_EMAIL="austingjordan@gmail.com" git commit -m "chore: remove vestigial convertMixedListFormats (already a no-op since v5.8.0)"
```

---

## Task 3: Update UI label

**Files:**
- Modify: `src/components/sessions/ProcessingOptions.tsx`

- [ ] **Step 3.1: Read the surrounding object**

Read `src/components/sessions/ProcessingOptions.tsx` around line 55. You should see:

```ts
  "normalize-table-lists":
    "Converts typed list prefixes (1., A., •) to proper Word formatting and fixes mixed lists",
```

- [ ] **Step 3.2: Update the string**

Use Edit. Replace exactly:

```ts
  "normalize-table-lists":
    "Converts typed list prefixes (1., A., •) to proper Word formatting and fixes mixed lists",
```

with:

```ts
  "normalize-table-lists":
    "Converts typed list prefixes (1., A., •) to proper Word formatting",
```

- [ ] **Step 3.3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3.4: Commit**

```bash
git add src/components/sessions/ProcessingOptions.tsx
GIT_AUTHOR_NAME="Austin Jordan" GIT_AUTHOR_EMAIL="austingjordan@gmail.com" GIT_COMMITTER_NAME="Austin Jordan" GIT_COMMITTER_EMAIL="austingjordan@gmail.com" git commit -m "docs(ui): drop 'fixes mixed lists' from normalize-table-lists description"
```

---

## Task 4: Add failing tests for category preservation (TDD red)

Before touching `ListNormalizer.ts`, lock the desired behavior into tests.

**Files:**
- Create: `src/services/document/list/__tests__/ListNormalizer.mixed-lists.test.ts`

- [ ] **Step 4.1: Check existing ListNormalizer test layout**

Run Grep with pattern `ListNormalizer` across `src/services/document/list/`. Expect to find the production file but no existing `__tests__` directory at that path. The new tests will create the directory.

- [ ] **Step 4.2: Read the public API of ListNormalizer**

Read `src/services/document/list/ListNormalizer.ts` lines 1-80 to see the exported class/function signatures. The tests must use the public surface only.

Key public surface to confirm during reading: `ListNormalizer` class (or normalizer entry function), `normalizeAllTables(...)` or similar method that takes tables + options and returns a report. Read the constructor and the primary entry method to know how to instantiate.

- [ ] **Step 4.3: Write the failing test file**

Create `src/services/document/list/__tests__/ListNormalizer.mixed-lists.test.ts`:

```ts
/**
 * Mixed-list preservation tests for ListNormalizer.
 *
 * After spec 2026-05-12-remove-cross-type-list-conversion, the normalizer
 * must NOT convert bullet items to numbered (or vice versa) to enforce a
 * "uniform" cell. Each Word-list item keeps its own category.
 */

import { Document, Paragraph } from "docxmlater";
import { ListNormalizer } from "../ListNormalizer";

// NOTE: These tests instantiate real docxmlater objects rather than mocks
// because the normalizer reads detection state (numbering, indentation)
// from the live model. Mocking would require duplicating that detection
// surface and would test the wrong thing.

function makeBulletParagraph(doc: Document, text: string, numId: number, level = 0): Paragraph {
  const para = Paragraph.create();
  para.addText(text);
  para.setNumbering(numId, level);
  return para;
}

function makeNumberedParagraph(doc: Document, text: string, numId: number, level = 0): Paragraph {
  const para = Paragraph.create();
  para.addText(text);
  para.setNumbering(numId, level);
  return para;
}

describe("ListNormalizer mixed-list preservation", () => {
  it("preserves bullet→numbered→bullet pattern in a table cell (bullet-majority)", async () => {
    const doc = await Document.create();
    const mgr = doc.getNumberingManager();
    const bulletNumId = mgr.createBulletList();
    const numberedNumId = mgr.createNumberedList();

    const paras = [
      makeBulletParagraph(doc, "First bullet", bulletNumId),
      makeNumberedParagraph(doc, "Middle numbered", numberedNumId),
      makeBulletParagraph(doc, "Last bullet", bulletNumId),
    ];
    const table = doc.addTable({ rows: 1, columns: 1 });
    const cell = table.getRows()[0]!.getCells()[0]!;
    cell.setParagraphs(paras);

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    // Read back each paragraph's resolved category by looking up the numId
    // in the numbering manager. We assert bullet status survives, not that
    // the specific numId is unchanged (numIds may be replaced with user-
    // settings-aware variants by the surviving "preserve" branch).
    const out = cell.getParagraphs();
    const isBullet = (numId: number | undefined): boolean => {
      if (numId === undefined) return false;
      const inst = mgr.getInstance(numId);
      if (!inst) return false;
      const abs = mgr.getAbstractNumbering(inst.getAbstractNumId());
      const lvl0 = abs?.getLevel(0);
      return lvl0?.getFormat() === "bullet";
    };

    expect(isBullet(out[0]!.getNumbering()?.numId)).toBe(true);
    expect(isBullet(out[1]!.getNumbering()?.numId)).toBe(false);
    expect(isBullet(out[2]!.getNumbering()?.numId)).toBe(true);
  });

  it("preserves numbered→bullet→numbered pattern in a table cell (numbered-majority)", async () => {
    const doc = await Document.create();
    const mgr = doc.getNumberingManager();
    const bulletNumId = mgr.createBulletList();
    const numberedNumId = mgr.createNumberedList();

    const paras = [
      makeNumberedParagraph(doc, "First numbered", numberedNumId),
      makeBulletParagraph(doc, "Middle bullet", bulletNumId),
      makeNumberedParagraph(doc, "Last numbered", numberedNumId),
    ];
    const table = doc.addTable({ rows: 1, columns: 1 });
    const cell = table.getRows()[0]!.getCells()[0]!;
    cell.setParagraphs(paras);

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const out = cell.getParagraphs();
    const isBullet = (numId: number | undefined): boolean => {
      if (numId === undefined) return false;
      const inst = mgr.getInstance(numId);
      if (!inst) return false;
      const abs = mgr.getAbstractNumbering(inst.getAbstractNumId());
      return abs?.getLevel(0)?.getFormat() === "bullet";
    };

    expect(isBullet(out[0]!.getNumbering()?.numId)).toBe(false);
    expect(isBullet(out[1]!.getNumbering()?.numId)).toBe(true);
    expect(isBullet(out[2]!.getNumbering()?.numId)).toBe(false);
  });

  it("still converts typed prefixes ('1.', '•') to proper Word numbering (regression guard)", async () => {
    const doc = await Document.create();
    const mgr = doc.getNumberingManager();

    const p1 = Paragraph.create();
    p1.addText("1. First item");
    const p2 = Paragraph.create();
    p2.addText("2. Second item");

    const table = doc.addTable({ rows: 1, columns: 1 });
    const cell = table.getRows()[0]!.getCells()[0]!;
    cell.setParagraphs([p1, p2]);

    const normalizer = new ListNormalizer(mgr);
    const report = normalizer.normalizeAllTables([table], { indentationLevels: [] });

    expect(report.normalized).toBeGreaterThanOrEqual(2);
    const out = cell.getParagraphs();
    expect(out[0]!.getNumbering()?.numId).toBeDefined();
    expect(out[1]!.getNumbering()?.numId).toBeDefined();
    // Typed "1." should become a numbered Word list (format !== "bullet").
    const num1 = out[0]!.getNumbering()!.numId!;
    const inst1 = mgr.getInstance(num1)!;
    const abs1 = mgr.getAbstractNumbering(inst1.getAbstractNumId())!;
    expect(abs1.getLevel(0)?.getFormat()).not.toBe("bullet");
  });
});
```

> **Note on test API surface:** the helpers `Paragraph.create()`, `doc.addTable(...)`, `cell.setParagraphs(...)`, `Paragraph.addText(...)`, `numberingManager.createBulletList()`, and `createNumberedList()` are all docxmlater 11.0.4 public APIs (verified in `node_modules/docxmlater/dist/`). If the **exact** method names differ on first run (e.g. `addTable` is actually `createTable`), use the TypeScript error from `npm run typecheck` or the test failure stack to identify the correct name; the structure of the test stays the same. Do NOT switch to mocked Document objects — these tests are intended to exercise the real model.

- [ ] **Step 4.4: Run the new tests and confirm they fail**

Run: `npx jest --testPathPatterns="ListNormalizer.mixed-lists"`
Expected: failures from one of three causes —
1. Compile errors if a docxmlater API name was guessed wrong (see step 4.3 note).
2. Assertion failures showing that the bullet item became numbered (or vice versa) — this is the cross-type conversion the refactor will eliminate.
3. `report.normalized` is 0 if `ListNormalizer` requires an entry method different from `normalizeAllTables`.

Resolve any compile errors first. The remaining expected failure mode is the assertions in the first two tests (mixed-list category-preservation). The third test (typed-prefix regression guard) may already pass.

If compile resolution requires changes to the test code beyond renaming API methods, STOP and report — the test plan made wrong assumptions.

- [ ] **Step 4.5: Do NOT commit yet — tests should fail until Task 5 makes them pass**

The test file will be committed alongside the implementation refactor in Task 5's commit, so the failing-then-passing TDD record lives in one commit.

---

## Task 5: Refactor `ListNormalizer.ts` — drop cross-type conversion, split numId helpers

**Files:**
- Modify: `src/services/document/list/ListNormalizer.ts`

This is the substantive change. Multiple sub-edits; perform them in order so intermediate states still typecheck.

- [ ] **Step 5.1: Open and read the relevant regions**

Read the file from line 280 to line 830. You're going to touch:
- `getNumId` helper (~582-623)
- Sub-item detection (~417-528)
- Level-shift recalc using `allSubItemIndices` (~529-575)
- The `needsConversion` declaration (~687)
- Typed-prefix sub-item branch (~725-730)
- Cross-type action branches (~756-804)
- "Preserve category" branch (~805-818) — this becomes the surviving branch

- [ ] **Step 5.2: Rename `getNumId` → `getNumberedNumId` and make it always-numbered**

Use Edit. Locate the helper that currently looks like:

```ts
  // Helper to get/create numId for a level (uses majority category)
  const getNumId = (level: number): number => {
    if (level < lastProcessedLevel) {
      for (const existingLevel of numIdByLevel.keys()) {
        if (existingLevel > level) {
          numIdByLevel.delete(existingLevel);
        }
      }
    }
    lastProcessedLevel = level;

    if (!numIdByLevel.has(level)) {
      let numId =
        majorityCategory === "numbered"
          ? numberingManager.createNumberedList()
          : numberingManager.createBulletList();

      // Apply user's indentation settings if provided
      if (options?.indentationLevels?.length) {
        const instance = numberingManager.getInstance(numId);
        if (instance) {
          const abstractNum = numberingManager.getAbstractNumbering(instance.getAbstractNumId());
          if (abstractNum) {
            applyIndentationSettings(
              abstractNum,
              options.indentationLevels,
              majorityCategory !== "numbered",
              options.extraHangingIndentTwips ?? 0
            );
          }
        }
      }

      // Restart numbering so converted lists start at 1 instead of continuing
      // from a previous cell's sequence
      if (majorityCategory === "numbered") {
        numId = numberingManager.restartNumbering(numId);
      }

      numIdByLevel.set(level, numId);
    }
    return numIdByLevel.get(level)!;
  };
```

Replace it with:

```ts
  // Helper to get/create a NUMBERED numId for a level.
  // Always creates a numbered list — never bullet. The category-explicit
  // companion is getBulletNumId below. Item category is decided by the
  // caller (typed-prefix detection or detection.category), never by majority.
  const getNumberedNumId = (level: number): number => {
    if (level < lastProcessedLevel) {
      for (const existingLevel of numIdByLevel.keys()) {
        if (existingLevel > level) {
          numIdByLevel.delete(existingLevel);
        }
      }
    }
    lastProcessedLevel = level;

    if (!numIdByLevel.has(level)) {
      let numId = numberingManager.createNumberedList();

      // Apply user's indentation settings if provided
      if (options?.indentationLevels?.length) {
        const instance = numberingManager.getInstance(numId);
        if (instance) {
          const abstractNum = numberingManager.getAbstractNumbering(instance.getAbstractNumId());
          if (abstractNum) {
            applyIndentationSettings(
              abstractNum,
              options.indentationLevels,
              false, // isBullet=false — this is a numbered list
              options.extraHangingIndentTwips ?? 0
            );
          }
        }
      }

      // Restart numbering so converted lists start at 1 instead of continuing
      // from a previous cell's sequence
      numId = numberingManager.restartNumbering(numId);

      numIdByLevel.set(level, numId);
    }
    return numIdByLevel.get(level)!;
  };
```

- [ ] **Step 5.3: Delete sub-item detection block (lines ~417-528)**

Use Edit to remove the entire region beginning at the comment line `// === Context-aware sub-item detection ===` and ending at the matching `// === End sub-item detection ===`. Keep one blank line where the block used to be.

Specifically the start anchor is:

```ts
  // === Context-aware sub-item detection ===
  // Track which items should be treated as sub-items and their parent indices
  const bulletAsSubItemIndices = new Set<number>();
  const numberedAsSubItemIndices = new Set<number>();
  const parentIndexByIndex = new Map<number, number>();
```

and the end anchor is:

```ts
  }
  // === End sub-item detection ===
```

Delete the whole region (including both anchor comments).

- [ ] **Step 5.4: Delete level-shift recalculation that used sub-item indices**

Use Edit to remove the entire region starting with the comment:

```ts
  // Recalculate level shifts excluding detected sub-items.
```

through the closing `}` of the `if (allSubItemIndices.size > 0) { ... }` block (the second of the two `if (recalcGroupStart !== -1) { ... }` closings).

Concretely, the region begins at line ~531 with `// Recalculate level shifts ...` and ends with the `}` matching `if (allSubItemIndices.size > 0) {` at line ~575.

- [ ] **Step 5.5: Delete the typed-prefix sub-item branch in target-level calculation**

The `targetLevel` calculation around lines 695-733 contains a branch:

```ts
      } else if (bulletAsSubItemIndices.has(index) || numberedAsSubItemIndices.has(index)) {
        // Sub-item: use parent's NORMALIZED level + 1
        const parentIndex = parentIndexByIndex.get(index);
        const parentNormalizedLevel =
          parentIndex !== undefined ? getNormalizedLevel(parentIndex) : 0;
        targetLevel = parentNormalizedLevel + 1;
      } else {
```

Use Edit to remove the entire `} else if ...` block (5 lines) so the preceding `} else if (hasTypedPrefix && ...)` flows directly into `} else {`:

Before:
```ts
        } else {
          targetLevel = indentBasedLevel;
        }
      } else if (bulletAsSubItemIndices.has(index) || numberedAsSubItemIndices.has(index)) {
        // Sub-item: use parent's NORMALIZED level + 1
        const parentIndex = parentIndexByIndex.get(index);
        const parentNormalizedLevel =
          parentIndex !== undefined ? getNormalizedLevel(parentIndex) : 0;
        targetLevel = parentNormalizedLevel + 1;
      } else {
        targetLevel = Math.max(0, detection.inferredLevel - levelShift);
      }
```

After:
```ts
        } else {
          targetLevel = indentBasedLevel;
        }
      } else {
        targetLevel = Math.max(0, detection.inferredLevel - levelShift);
      }
```

- [ ] **Step 5.6: Delete the unused `getNormalizedLevel` helper**

After step 5.5 the helper has no callers. Find it (~lines 423-438):

```ts
  // Helper to calculate normalized level for an item (used for parent level lookup)
  const getNormalizedLevel = (itemIndex: number): number => {
    const item = analysis.paragraphs[itemIndex]!;
    const detection = item.detection;
    const hasTypedPrefix = !!detection.typedPrefix;
    const levelShift = levelShiftByIndex.get(itemIndex) ?? 0;

    if (hasTypedPrefix) {
      const relativeIndent = detection.indentationTwips - baselineIndent;
      const rawLevel = inferLevelFromRelativeIndentation(relativeIndent);
      // Apply levelShift consistently for typed prefixes too
      return Math.max(0, rawLevel - levelShift);
    } else {
      return Math.max(0, detection.inferredLevel - levelShift);
    }
  };
```

Delete the whole block.

> Note: this helper may already be inside the region deleted by step 5.3 — if so, it's already gone. Verify with `grep -n "getNormalizedLevel" src/services/document/list/ListNormalizer.ts` after the deletion. Expected: zero matches.

- [ ] **Step 5.7: Delete the four cross-type action branches and consolidate**

The action loop (~lines 736-819) contains:

```ts
      if (hasTypedPrefix && detection.typedPrefix) {
        // Typed prefix: strip prefix and apply new formatting
        stripTypedPrefix(para, detection.typedPrefix);

        // Check if we need a fresh numId for this typed prefix.
        // New numId when: previous at this level was a Word list item (null)
        // or a different typed format (e.g., decimal → lowerLetter).
        const lastFormat = lastTypedFormatByLevel.get(targetLevel);
        if (lastFormat === null || (lastFormat !== undefined && lastFormat !== detection.format)) {
          numIdByLevel.delete(targetLevel);
        }
        lastTypedFormatByLevel.set(targetLevel, detection.format ?? "unknown");

        para.setNumbering(getNumId(targetLevel), targetLevel);
        report.normalized++;
        report.details.push({ ... reason: `Typed prefix → level ${targetLevel}` });
      } else if (isWordList && bulletAsSubItemIndices.has(index)) {
        ... // Sandwiched bullet → numbered sub-item
      } else if (isWordList && numberedAsSubItemIndices.has(index)) {
        ... // Numbered → bullet sub-item
      } else if (
        isWordList &&
        detection.category === "bullet" &&
        majorityCategory === "numbered" &&
        !bulletAsSubItemIndices.has(index)
      ) {
        ... // Trailing bullet preserved
      } else if (isWordList && needsConversion) {
        ... // Regular category conversion
      } else if (isWordList) {
        // Preserve category but ensure consistent numId with user settings
        lastTypedFormatByLevel.set(targetLevel, null);
        if (detection.category === "bullet") {
          para.setNumbering(getBulletNumId(targetLevel), targetLevel);
        } else {
          para.setNumbering(getNumId(targetLevel), targetLevel);
        }
        report.normalized++;
        report.details.push({ ... reason: `Updated numId for consistent numbering at level ${targetLevel}` });
      }
```

Use Edit to replace the whole sequence with:

```ts
      if (hasTypedPrefix && detection.typedPrefix) {
        // Typed prefix: strip prefix and apply new formatting
        stripTypedPrefix(para, detection.typedPrefix);

        // Check if we need a fresh numId for this typed prefix.
        // New numId when: previous at this level was a Word list item (null)
        // or a different typed format (e.g., decimal → lowerLetter).
        const lastFormat = lastTypedFormatByLevel.get(targetLevel);
        if (lastFormat === null || (lastFormat !== undefined && lastFormat !== detection.format)) {
          numIdByLevel.delete(targetLevel);
        }
        lastTypedFormatByLevel.set(targetLevel, detection.format ?? "unknown");

        // Route typed prefix to bullet or numbered numId based on its detected category.
        // Bullets/dashes/arrows → bullet list; decimal/letter/roman → numbered list.
        const isBulletTypedPrefix =
          detection.category === "bullet" ||
          detection.format === "bullet" ||
          detection.format === "dash" ||
          detection.format === "arrow";
        const numId = isBulletTypedPrefix
          ? getBulletNumId(targetLevel)
          : getNumberedNumId(targetLevel);
        para.setNumbering(numId, targetLevel);
        report.normalized++;
        report.details.push({
          originalText: text.substring(0, 50),
          action: "normalized",
          reason: `Typed prefix → level ${targetLevel}`,
        });
      } else if (isWordList) {
        // Preserve the item's existing category. Cross-type conversion to a
        // "majority" is no longer performed — mixed bullet+numbered lists
        // within a single cell are allowed.
        lastTypedFormatByLevel.set(targetLevel, null);
        const numId =
          detection.category === "bullet"
            ? getBulletNumId(targetLevel)
            : getNumberedNumId(targetLevel);
        para.setNumbering(numId, targetLevel);
        report.normalized++;
        report.details.push({
          originalText: text.substring(0, 50),
          action: "normalized",
          reason: `Preserved ${detection.category} category at level ${targetLevel}`,
        });
      }
```

Key differences vs. the existing code:
- Removed three intermediate branches (sandwiched, numbered-as-bullet-sub-item, trailing bullet).
- Removed the "Regular category conversion" branch.
- Typed-prefix branch now routes by detected category (was previously always `getNumId` = majority).
- Surviving `isWordList` branch routes by the item's own `detection.category` via the two category-explicit helpers.

- [ ] **Step 5.8: Delete the now-unused `needsConversion` declaration**

After step 5.7 `needsConversion` is no longer referenced. Locate (~line 687):

```ts
      // Check if this item needs conversion (different category than majority)
      const needsConversion = detection.category !== majorityCategory;
```

Delete those two lines.

- [ ] **Step 5.9: Audit `majorityCategory` usage**

Run Grep on the file: `majorityCategory`. Expected remaining matches:
- Line ~157, 170 (analysis function — keep)
- Line ~280 (assignment from analysis result — keep)
- Line ~285 (report's `appliedCategory` field — keep but the meaning is now "the majority category in the input"; the surviving "preserve" branch ignores it for routing)

There should be **no remaining matches** at lines that were in the old 444-528, 594-616, 779, 791-804 ranges. If any remain, they're vestigial — delete them or report `NEEDS_CONTEXT` if the deletion isn't clearly safe.

- [ ] **Step 5.10: Run the new tests**

Run: `npx jest --testPathPatterns="ListNormalizer.mixed-lists"`
Expected: all 3 tests pass.

If a test still fails:
- For the first two (preservation tests): inspect what category the items ended up at and which branch they went through. Likely cause is a missed reference to `getNumId` or a leftover branch.
- For the third (typed-prefix regression): the typed-prefix branch may be routing incorrectly. Re-check step 5.7.

- [ ] **Step 5.11: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5.12: Full test suite**

Run: `npm test 2>&1 | tail -10`
Expected:
- All previously-passing tests still pass.
- 3 new tests added (the mixed-list preservation suite).
- Any pre-existing tests that asserted cross-type conversion may fail. For each such failure: read the assertion, decide if the expectation was encoding the *old* "force uniform" behavior. If yes, update the assertion to expect category preservation. If the test was checking something else and a real regression has been introduced, STOP and investigate.

> **Caution on assertion updates:** only update assertions that explicitly encoded "item should have been converted to majority". Do not update assertions that fail for an indirect reason — those may indicate a real regression in level-shift behavior.

- [ ] **Step 5.13: Commit (the test file + the refactor land together)**

```bash
git add src/services/document/list/ListNormalizer.ts \
        src/services/document/list/__tests__/ListNormalizer.mixed-lists.test.ts
GIT_AUTHOR_NAME="Austin Jordan" GIT_AUTHOR_EMAIL="austingjordan@gmail.com" GIT_COMMITTER_NAME="Austin Jordan" GIT_COMMITTER_EMAIL="austingjordan@gmail.com" git commit -m "refactor(list): preserve each item's category; drop cross-type uniformity logic"
```

If you also updated any pre-existing tests in step 5.12, stage and commit those in the same commit (they encode the same intent).

---

## Task 6: Final verification

- [ ] **Step 6.1: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6.2: Full test suite**

Run: `npm test 2>&1 | tail -10`
Expected:
- All previously-passing tests pass.
- 3 new tests pass (`ListNormalizer.mixed-lists.test.ts`).
- Failing pre-existing tests are limited to the documented baseline (`wontprocess.test.ts` fixture, `GlobalStatsContext.test.tsx` peer dep).

- [ ] **Step 6.3: Manual smoke (deferred unless dev environment available)**

If a dev environment is available, run `npm run electron:dev`, open a document containing intentional mixed lists (e.g. a bullet at L0 with a numbered sub-item at L1, or a list that alternates bullet/numbered at L0). Process it. Open the output in Word. Confirm:
- Bullets stay bullets.
- Numbered items stay numbered.
- No items were silently switched to the majority's category.

If a dev environment is not available, document the deferral in the final commit body so QA picks it up. **Do not** mark Task 6 complete with a manual deferral as the only verification.

- [ ] **Step 6.4: Confirm spec acceptance**

Cross-reference the spec's "Acceptance" section:

- ✅ `convertMixedListFormats`, `convertNestedNumbersToBullets*`, `getFormatFallbackString` no longer exist. Verify with Grep on each name — expected zero matches.
- ✅ `ListNormalizer.ts` no longer contains `bulletAsSubItemIndices` or `numberedAsSubItemIndices`. Verify with Grep — expected zero matches.
- ✅ `normalize-table-lists` UI description matches new behavior. Spot-check the file.
- ✅ New mixed-list-preservation tests pass.
- ⏸ Manual smoke — only if a dev env was used in 6.3.

If any acceptance item is unsatisfied, return to the relevant task before declaring done.

---

## Self-review checklist (for the executing agent)

Run after the plan above is complete.

1. **Spec coverage:** Walk the spec section by section:
   - "Code to remove" §1-5 → Tasks 1, 2, 3, 5
   - "Code to preserve" → verify by Grep (`applyBulletUniformity`, `applyNumberedUniformity`, `preProcessExtendedTypedPrefixes`, `convertTypedPrefixesWithContext` still present)
   - "Testing strategy" → Task 4 + 5.12
2. **Placeholder scan:** `grep -nE "TBD|TODO|FIXME" $(git diff HEAD~6 --name-only)` after all commits. Zero matches in files this plan touched.
3. **Name consistency:** Verify `getNumberedNumId` is spelled the same in (a) its definition, (b) the typed-prefix branch call, (c) the surviving `isWordList` branch call. (Three locations after refactor.)
4. **Behavior verification:** Spot-check that the typed-prefix tests in `ListNormalizer.mixed-lists.test.ts` pass — i.e. typed "1." still becomes a numbered Word list. This is the regression guard for the spec's "structural typed-prefix conversion is not in scope".
5. **No stale comments:** Grep the codebase for references to `convertMixedListFormats`, `convertNestedNumbersToBullets`, and `getFormatFallbackString`. Zero matches in source.

If any check fails, fix inline and re-run `npm test` plus `npm run typecheck`.
