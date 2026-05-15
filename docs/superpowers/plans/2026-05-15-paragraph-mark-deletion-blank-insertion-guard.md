# Paragraph-Mark-Deletion Blank-Line Insertion Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `BlankLineManager` from inserting Normal-style blank paragraphs into the merge slot of a tracked paragraph-mark deletion, which silently strips the bullet/style from the deleted paragraph's runs when Word renders accepted revisions.

**Architecture:** Two thin wrappers in `src/services/document/blanklines/helpers/blankLineInsertion.ts` (`insertBlankAtBodyIfSafe`, `addBlankToCellIfSafe`) front the four addition-rule insertion sites in `BlankLineManager`. Each wrapper checks the immediately preceding element; if it's a `Paragraph.isParagraphMarkDeleted()`, the wrapper returns `"skipped"` without inserting. The existing `insertOrMarkBlankAfter`/`Before` helpers also gain the guard on their `"added"` branch for forward-compat. Preservation-fallback insertions (lines 346, 410) are intentionally left unguarded — they reinstate blanks the author originally authored, where any paragraph-mark deletion already targets the authored blank.

**Tech Stack:** TypeScript, jest + ts-jest (jsdom test env), `docxmlater` 11.0.6 (real load for integration test; mocked classes for unit tests, following the `paragraphMarkDeletionAlignment.test.ts` precedent).

**Spec:** `docs/superpowers/specs/2026-05-15-paragraph-mark-deletion-blank-insertion-guard-design.md`

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `src/services/document/blanklines/helpers/blankLineInsertion.ts` | Modify | Add `insertBlankAtBodyIfSafe`, `addBlankToCellIfSafe`. Add para-mark-deletion guard to existing `insertOrMarkBlankAfter` / `insertOrMarkBlankBefore` on the "added" branch. |
| `src/services/document/blanklines/index.ts` | Modify | Re-export the two new wrappers. |
| `src/services/document/blanklines/BlankLineManager.ts` | Modify | Route the four addition-rule insertion sites (lines 224, 238, 259, 307) through the new wrappers and gate the `i++` / `ci++` book-keeping on the `"added"` return. Preservation sites (lines 346, 410) untouched. |
| `src/services/document/blanklines/__tests__/blankLineInsertion.test.ts` | Create | Unit tests for the new wrappers and the updated existing helpers, mocking `docxmlater` per the project's established test pattern. |
| `src/services/document/__tests__/fixtures/paramark-del-around-deleted-image.docx` | Create (copy) | Copy `C:/Users/DiaTech/Projects/DocHub/development/docxmlater/Error_O.docx` into the dochub-app fixtures tree under a descriptive name. |
| `src/services/document/blanklines/__tests__/paragraphMarkDeletionInsertionGuard.integration.test.ts` | Create | Integration test: load fixture via real `Document.loadFromBuffer`, run `BlankLineManager.processBlankLines`, assert no blank lands between the para-mark-deleted bullet and the next bulleted paragraph; assert the "below" blank still gets added on the other side of the image paragraph. |

No new dependencies. No changes outside `src/services/document/blanklines/` and the fixtures tree.

---

## Task 1: Add the para-mark-deletion guard predicate and body wrapper

**Files:**
- Modify: `src/services/document/blanklines/helpers/blankLineInsertion.ts`

- [ ] **Step 1: Write the failing unit test for `insertBlankAtBodyIfSafe`**

Create the test file `src/services/document/blanklines/__tests__/blankLineInsertion.test.ts`:

```typescript
/**
 * Unit tests for src/services/document/blanklines/helpers/blankLineInsertion.ts.
 *
 * Covers the para-mark-deletion guard on the body and cell insertion wrappers,
 * plus the same guard added to the existing insertOrMark* helpers.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */

jest.mock("docxmlater", () => {
  class MockParagraph {
    private markDeleted: boolean;
    private text: string;
    private preserved = false;
    private style: string | undefined;
    public _tag: string;
    constructor(opts: { text?: string; markDeleted?: boolean; tag?: string } = {}) {
      this.text = opts.text ?? "";
      this.markDeleted = !!opts.markDeleted;
      this._tag = opts.tag ?? "p";
    }
    static create() {
      return new MockParagraph();
    }
    getText() {
      return this.text;
    }
    isParagraphMarkDeleted() {
      return this.markDeleted;
    }
    isPreserved() {
      return this.preserved;
    }
    setPreserved(v: boolean) {
      this.preserved = v;
      return this;
    }
    setStyle(v: string) {
      this.style = v;
      return this;
    }
    setSpaceBefore(_v: number) {
      return this;
    }
    setSpaceAfter(_v: number) {
      return this;
    }
    setLineSpacing(_v: number) {
      return this;
    }
  }
  return {
    Paragraph: MockParagraph,
    Document: class {},
  };
});

import { Paragraph } from "docxmlater";
import {
  insertBlankAtBodyIfSafe,
  addBlankToCellIfSafe,
  insertOrMarkBlankAfter,
  insertOrMarkBlankBefore,
} from "../helpers/blankLineInsertion";
import type { BlankLineOptions } from "../types";

const opts: BlankLineOptions = {
  spacingAfter: 120,
  style: "Normal",
  markAsPreserved: true,
};

function makeDoc(body: any[]) {
  return {
    _body: body,
    getBodyElementAt(i: number) {
      return this._body[i];
    },
    getBodyElementCount() {
      return this._body.length;
    },
    insertBodyElementAt(i: number, el: any) {
      this._body.splice(i, 0, el);
    },
  } as any;
}

function makeCell(paras: any[]) {
  return {
    _paras: paras,
    getParagraphs() {
      return this._paras;
    },
    addParagraphAt(i: number, el: any) {
      this._paras.splice(i, 0, el);
    },
  } as any;
}

describe("insertBlankAtBodyIfSafe", () => {
  it("inserts a blank when the preceding element has no paragraph-mark deletion", () => {
    const a = new (Paragraph as any)({ text: "first", tag: "a" });
    const b = new (Paragraph as any)({ text: "second", tag: "b" });
    const doc = makeDoc([a, b]);

    const result = insertBlankAtBodyIfSafe(doc, 1, opts);
    expect(result).toBe("added");
    expect(doc._body.length).toBe(3);
    expect(doc._body[0]).toBe(a);
    expect(doc._body[2]).toBe(b);
  });

  it('returns "skipped" and does not insert when the preceding paragraph is paragraph-mark-deleted', () => {
    const a = new (Paragraph as any)({ text: "first", markDeleted: true, tag: "a" });
    const b = new (Paragraph as any)({ text: "second", tag: "b" });
    const doc = makeDoc([a, b]);

    const result = insertBlankAtBodyIfSafe(doc, 1, opts);
    expect(result).toBe("skipped");
    expect(doc._body.length).toBe(2);
    expect(doc._body[0]).toBe(a);
    expect(doc._body[1]).toBe(b);
  });

  it("inserts at index 0 when there is no preceding element", () => {
    const a = new (Paragraph as any)({ text: "first" });
    const doc = makeDoc([a]);

    const result = insertBlankAtBodyIfSafe(doc, 0, opts);
    expect(result).toBe("added");
    expect(doc._body.length).toBe(2);
    expect(doc._body[1]).toBe(a);
  });
});

describe("addBlankToCellIfSafe", () => {
  it("inserts a blank when the preceding paragraph has no paragraph-mark deletion", () => {
    const a = new (Paragraph as any)({ text: "first" });
    const b = new (Paragraph as any)({ text: "second" });
    const cell = makeCell([a, b]);

    const result = addBlankToCellIfSafe(cell, 1, opts);
    expect(result).toBe("added");
    expect(cell._paras.length).toBe(3);
  });

  it('returns "skipped" when the preceding paragraph in the cell is paragraph-mark-deleted', () => {
    const a = new (Paragraph as any)({ text: "first", markDeleted: true });
    const b = new (Paragraph as any)({ text: "second" });
    const cell = makeCell([a, b]);

    const result = addBlankToCellIfSafe(cell, 1, opts);
    expect(result).toBe("skipped");
    expect(cell._paras.length).toBe(2);
  });
});

describe("insertOrMarkBlankAfter — guard on the added branch", () => {
  it('returns "skipped" when the preceding paragraph is paragraph-mark-deleted and no existing blank is present', () => {
    const a = new (Paragraph as any)({ text: "first", markDeleted: true });
    const b = new (Paragraph as any)({ text: "second" });
    const doc = makeDoc([a, b]);

    // Insertion target would be index 1 (after element 0).
    const result = insertOrMarkBlankAfter(doc, 0, opts);
    expect(result).toBe("skipped");
    expect(doc._body.length).toBe(2);
  });

  it('still returns "marked" for an existing blank even if the preceding paragraph is mark-deleted (guard only fires on the added branch)', () => {
    const a = new (Paragraph as any)({ text: "first", markDeleted: true });
    const existingBlank = new (Paragraph as any)({ text: "" });
    const doc = makeDoc([a, existingBlank]);

    const result = insertOrMarkBlankAfter(doc, 0, opts);
    expect(result).toBe("marked");
    expect(doc._body.length).toBe(2);
    expect((existingBlank as any).isPreserved()).toBe(true);
  });
});

describe("insertOrMarkBlankBefore — guard on the added branch", () => {
  it('returns "skipped" when the element immediately before the insertion point is paragraph-mark-deleted', () => {
    // Inserting before element at index 2 means the new blank lands at index 2,
    // immediately after the element at index 1.
    const a = new (Paragraph as any)({ text: "head" });
    const b = new (Paragraph as any)({ text: "deleted-mark", markDeleted: true });
    const c = new (Paragraph as any)({ text: "target" });
    const doc = makeDoc([a, b, c]);

    const result = insertOrMarkBlankBefore(doc, 2, opts);
    expect(result).toBe("skipped");
    expect(doc._body.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/document/blanklines/__tests__/blankLineInsertion.test.ts`
Expected: FAIL — `insertBlankAtBodyIfSafe is not a function` / `addBlankToCellIfSafe is not a function` (imports unresolved).

- [ ] **Step 3: Implement the body wrapper and the guard on the existing `insertOrMarkBlankAfter`**

Open `src/services/document/blanklines/helpers/blankLineInsertion.ts` and apply the following changes.

Add a small predicate near the top of the file (after the imports), and add the body wrapper and the cell wrapper after the existing helpers. The complete new state of the file is:

```typescript
/**
 * Shared utilities for creating and inserting blank paragraphs.
 * Encapsulates the repeated insert-or-mark pattern used across all phases.
 */

import { Document, Paragraph } from "docxmlater";
import type { BlankLineOptions } from "../types";
import { isParagraphBlank } from "./paragraphChecks";

/**
 * Returns true if the element at the given body index is a Paragraph whose
 * paragraph mark is tracked-deleted. Inserting a new paragraph immediately
 * after such an element would land in the merge slot of the deletion and
 * silently strip the deleted paragraph's bullet/style/indent when Word renders
 * accepted revisions. Callers use this to skip the insertion.
 *
 * Index out of range returns false (no preceding element → nothing to merge into).
 */
function isParagraphMarkDeletedAtBody(doc: Document, index: number): boolean {
  if (index < 0 || index >= doc.getBodyElementCount()) return false;
  const el = doc.getBodyElementAt(index);
  return el instanceof Paragraph && el.isParagraphMarkDeleted();
}

/**
 * Cell-scope counterpart of isParagraphMarkDeletedAtBody.
 */
function isParagraphMarkDeletedAtCell(
  paras: ReadonlyArray<unknown>,
  index: number
): boolean {
  if (index < 0 || index >= paras.length) return false;
  const el = paras[index];
  return el instanceof Paragraph && el.isParagraphMarkDeleted();
}

/**
 * Creates a blank paragraph with the specified options.
 */
export function createBlankParagraph(options: BlankLineOptions): Paragraph {
  const blankPara = Paragraph.create();
  blankPara.setStyle(options.style);
  if (options.spacingBefore !== undefined) {
    blankPara.setSpaceBefore(options.spacingBefore);
  }
  blankPara.setSpaceAfter(options.spacingAfter);
  if (options.lineSpacing !== undefined) {
    blankPara.setLineSpacing(options.lineSpacing);
  }
  if (options.markAsPreserved) {
    blankPara.setPreserved(true);
  }
  return blankPara;
}

/**
 * Inserts a blank paragraph at the given body index, unless the element
 * immediately preceding the insertion point has a tracked paragraph-mark
 * deletion (in which case the new blank would steal the merge slot).
 *
 * @returns 'added' if inserted, 'skipped' if guarded against.
 */
export function insertBlankAtBodyIfSafe(
  doc: Document,
  index: number,
  options: BlankLineOptions
): "added" | "skipped" {
  if (isParagraphMarkDeletedAtBody(doc, index - 1)) {
    return "skipped";
  }
  doc.insertBodyElementAt(index, createBlankParagraph(options));
  return "added";
}

/**
 * Inserts a blank paragraph into a cell at the given index, unless the
 * paragraph immediately preceding the insertion point has a tracked
 * paragraph-mark deletion. Callers pass the cell's current paragraph list
 * (via `cell.getParagraphs()`) so the guard does not have to re-fetch.
 *
 * @returns 'added' if inserted, 'skipped' if guarded against.
 */
export function addBlankToCellIfSafe(
  cell: { addParagraphAt(i: number, p: Paragraph): unknown; getParagraphs(): ReadonlyArray<unknown> },
  index: number,
  options: BlankLineOptions
): "added" | "skipped" {
  if (isParagraphMarkDeletedAtCell(cell.getParagraphs(), index - 1)) {
    return "skipped";
  }
  cell.addParagraphAt(index, createBlankParagraph(options));
  return "added";
}

/**
 * Inserts a blank paragraph after the element at the given index,
 * or marks the existing blank if one is already there.
 *
 * @returns 'added' if a new blank was inserted, 'marked' if existing was marked,
 * 'skipped' if no action taken (existing blank not eligible to mark, or
 * inserting would land in the merge slot of a tracked paragraph-mark deletion).
 */
export function insertOrMarkBlankAfter(
  doc: Document,
  elementIndex: number,
  options: BlankLineOptions
): "added" | "marked" | "skipped" {
  const nextElement = doc.getBodyElementAt(elementIndex + 1);

  if (nextElement instanceof Paragraph && isParagraphBlank(nextElement)) {
    // Mark existing blank as preserved
    nextElement.setStyle(options.style);
    if (options.markAsPreserved && !nextElement.isPreserved()) {
      nextElement.setPreserved(true);
      return "marked";
    }
    return "skipped";
  }
  // Guard on the added branch: do not insert into a paragraph-mark deletion's merge slot.
  if (isParagraphMarkDeletedAtBody(doc, elementIndex)) {
    return "skipped";
  }
  const blankPara = createBlankParagraph(options);
  doc.insertBodyElementAt(elementIndex + 1, blankPara);
  return "added";
}

/**
 * Inserts a blank paragraph before the element at the given index,
 * or marks the existing blank if one is already there.
 *
 * @returns 'added' if a new blank was inserted, 'marked' if existing was marked,
 * 'skipped' if no action taken (existing blank not eligible to mark, no room
 * before index 0, or inserting would land in the merge slot of a tracked
 * paragraph-mark deletion).
 */
export function insertOrMarkBlankBefore(
  doc: Document,
  elementIndex: number,
  options: BlankLineOptions
): "added" | "marked" | "skipped" {
  if (elementIndex <= 0) return "skipped";

  const prevElement = doc.getBodyElementAt(elementIndex - 1);

  if (prevElement instanceof Paragraph && isParagraphBlank(prevElement)) {
    // Mark existing blank as preserved
    prevElement.setStyle(options.style);
    if (options.markAsPreserved && !prevElement.isPreserved()) {
      prevElement.setPreserved(true);
      return "marked";
    }
    return "skipped";
  }
  // Guard on the added branch: do not insert into a paragraph-mark deletion's merge slot.
  if (isParagraphMarkDeletedAtBody(doc, elementIndex - 1)) {
    return "skipped";
  }
  const blankPara = createBlankParagraph(options);
  doc.insertBodyElementAt(elementIndex, blankPara);
  return "added";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/document/blanklines/__tests__/blankLineInsertion.test.ts`
Expected: PASS — all wrapper and guard tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/document/blanklines/helpers/blankLineInsertion.ts \
        src/services/document/blanklines/__tests__/blankLineInsertion.test.ts
git commit -m "Add paragraph-mark-deletion guard to blank-line insertion helpers"
```

---

## Task 2: Re-export the new wrappers from the blanklines barrel

**Files:**
- Modify: `src/services/document/blanklines/index.ts`

- [ ] **Step 1: Read the existing barrel and locate the helpers re-export**

Read `src/services/document/blanklines/index.ts`. Confirm it already re-exports `createBlankParagraph`, `insertOrMarkBlankAfter`, `insertOrMarkBlankBefore` from `./helpers/blankLineInsertion`.

- [ ] **Step 2: Add the two new wrappers to that re-export list**

Locate the existing re-export block (the one referencing `createBlankParagraph`, `insertOrMarkBlankAfter`, `insertOrMarkBlankBefore`) and extend it. Example — the resulting block should look like:

```typescript
export {
  createBlankParagraph,
  insertOrMarkBlankAfter,
  insertOrMarkBlankBefore,
  insertBlankAtBodyIfSafe,
  addBlankToCellIfSafe,
} from "./helpers/blankLineInsertion";
```

If the file uses a different export style (e.g., a `export *` form), preserve that style; only ensure the two new names are reachable via the barrel.

- [ ] **Step 3: Run typecheck to confirm the new exports resolve**

Run: `npx tsc --noEmit`
Expected: no new errors. (Existing unrelated errors, if any, must remain unchanged — note them, do not fix in this task.)

- [ ] **Step 4: Commit**

```bash
git add src/services/document/blanklines/index.ts
git commit -m "Re-export insertBlankAtBodyIfSafe and addBlankToCellIfSafe from blanklines barrel"
```

---

## Task 3: Route BlankLineManager's four addition-rule insertion sites through the guarded wrappers

**Files:**
- Modify: `src/services/document/blanklines/BlankLineManager.ts:223-307`

The four sites in `applyAdditionRulesBody` (lines 224, 238, 259) and `applyAdditionRulesCells` (line 307) currently do `const blank = createBlankParagraph(opts); doc.insertBodyElementAt(idx, blank); added++; i++;` inline. We swap each for the corresponding guarded wrapper and only bump the counter / index when the wrapper returned `"added"`.

- [ ] **Step 1: Write a failing test that asserts the manager honors the guard on the large-image "above" site**

Append the following test cases to `src/services/document/blanklines/__tests__/blankLineInsertion.test.ts`. (Adding them here, not in a new file, because they verify the same guard contract — keeping all unit-level tests for this fix together.)

The tests build a minimal manager-equivalent fixture and verify that calling `insertBlankAtBodyIfSafe` from the manager's call sites would skip when expected. Since the manager will be refactored in Step 3 to call these helpers, the integration is exercised end-to-end by Task 5's integration test. The unit tests below are purely defensive — they pin the contract at the helper boundary.

```typescript
describe("insertBlankAtBodyIfSafe — sequence of insertions across a list", () => {
  it('returns "skipped" for the slot after a paragraph-mark-deleted list item, then "added" for a later safe slot', () => {
    const item1 = new (Paragraph as any)({ text: "item 1", markDeleted: true, tag: "i1" });
    const item2 = new (Paragraph as any)({ text: "item 2", tag: "i2" });
    const item3 = new (Paragraph as any)({ text: "item 3", tag: "i3" });
    const doc = makeDoc([item1, item2, item3]);

    // Site analogous to BlankLineManager.ts:259 — inserting a blank ABOVE item2.
    // Insertion index = position of item2 = 1. Preceding element is item1 (mark-deleted).
    expect(insertBlankAtBodyIfSafe(doc, 1, opts)).toBe("skipped");
    expect(doc._body.length).toBe(3);

    // Site analogous to BlankLineManager.ts:238 — inserting a blank AFTER item2.
    // Insertion index = position of item2 + 1 = 2. Preceding element is item2 (not mark-deleted).
    expect(insertBlankAtBodyIfSafe(doc, 2, opts)).toBe("added");
    expect(doc._body.length).toBe(4);
    expect(doc._body[3]).toBe(item3);
  });
});
```

- [ ] **Step 2: Run the new test to verify it passes against the helper already implemented in Task 1**

Run: `npx jest src/services/document/blanklines/__tests__/blankLineInsertion.test.ts -t "sequence of insertions across a list"`
Expected: PASS. (The helper from Task 1 already implements this; the test pins the multi-call contract for clarity.)

- [ ] **Step 3: Refactor BlankLineManager addition sites — body, "before next" branch (line 223–225)**

Open `src/services/document/blanklines/BlankLineManager.ts`. At the top, replace the existing import:

```typescript
import { createBlankParagraph } from "./helpers/blankLineInsertion";
```

with:

```typescript
import {
  createBlankParagraph,
  insertBlankAtBodyIfSafe,
  addBlankToCellIfSafe,
} from "./helpers/blankLineInsertion";
```

Find this block in `applyAdditionRulesBody` (~lines 217–227):

```typescript
        if (isBefore) {
          // Current element IS the required blank — don't insert a duplicate
          if (element instanceof Paragraph && isParagraphBlank(element)) {
            continue;
          }
          // These rules want a blank BEFORE the next element
          // Check if a blank already exists between current and next
          const nextIdx = i + 1;
          if (nextIdx < doc.getBodyElementCount()) {
            const nextEl = doc.getBodyElementAt(nextIdx);
            if (nextEl instanceof Paragraph && isParagraphBlank(nextEl)) {
              continue; // Already a blank
            }
            const blankPara = createBlankParagraph(blankOpts);
            doc.insertBodyElementAt(nextIdx, blankPara);
            added++;
            i++; // Skip past inserted blank
          }
        } else {
```

Replace the `if (nextIdx < ...)` body so the actual insertion goes through the guarded wrapper, gating the side-effects on the `"added"` return:

```typescript
        if (isBefore) {
          // Current element IS the required blank — don't insert a duplicate
          if (element instanceof Paragraph && isParagraphBlank(element)) {
            continue;
          }
          // These rules want a blank BEFORE the next element
          // Check if a blank already exists between current and next
          const nextIdx = i + 1;
          if (nextIdx < doc.getBodyElementCount()) {
            const nextEl = doc.getBodyElementAt(nextIdx);
            if (nextEl instanceof Paragraph && isParagraphBlank(nextEl)) {
              continue; // Already a blank
            }
            const outcome = insertBlankAtBodyIfSafe(doc, nextIdx, blankOpts);
            if (outcome === "added") {
              added++;
              i++; // Skip past inserted blank
            } else {
              log.debug(
                `Skipped "before-next" insertion at body index ${nextIdx}: ` +
                  `preceding paragraph has a tracked paragraph-mark deletion ` +
                  `(rule: ${matchedRule.id})`
              );
            }
          }
        } else {
```

- [ ] **Step 4: Refactor the body "standard after" branch (line 237–240)**

Immediately below the block edited in Step 3, find:

```typescript
        } else {
          // Standard "after" rules - ensure blank after current element
          const nextIdx = i + 1;
          if (nextIdx < doc.getBodyElementCount()) {
            const nextEl = doc.getBodyElementAt(nextIdx);
            if (nextEl instanceof Paragraph && isParagraphBlank(nextEl)) {
              continue; // Already a blank
            }
          }
          const blankPara = createBlankParagraph(blankOpts);
          doc.insertBodyElementAt(i + 1, blankPara);
          added++;
          i++; // Skip past inserted blank
        }
```

Replace with:

```typescript
        } else {
          // Standard "after" rules - ensure blank after current element
          const nextIdx = i + 1;
          if (nextIdx < doc.getBodyElementCount()) {
            const nextEl = doc.getBodyElementAt(nextIdx);
            if (nextEl instanceof Paragraph && isParagraphBlank(nextEl)) {
              continue; // Already a blank
            }
          }
          const outcome = insertBlankAtBodyIfSafe(doc, i + 1, blankOpts);
          if (outcome === "added") {
            added++;
            i++; // Skip past inserted blank
          } else {
            log.debug(
              `Skipped "after-current" insertion at body index ${i + 1}: ` +
                `preceding paragraph has a tracked paragraph-mark deletion ` +
                `(rule: ${matchedRule.id})`
            );
          }
        }
```

- [ ] **Step 5: Refactor the large-image "above" branch (line 257–262)**

Locate the special-case block at the end of `applyAdditionRulesBody`:

```typescript
      // Special: large images need blank ABOVE as well
      if (element instanceof Paragraph && !isParagraphBlank(element)) {
        const imageRun = getImageRunFromParagraph(element);
        if (imageRun) {
          const image = imageRun.getImageElement();
          if (!isImageSmall(image) && originalIndex > 0) {
            const prevEl = doc.getBodyElementAt(originalIndex - 1);
            if (!(prevEl instanceof Paragraph && isParagraphBlank(prevEl))) {
              // Don't add blank above image if previous is centered text
              const isCenteredText =
                prevEl instanceof Paragraph &&
                prevEl.getAlignment() === "center" &&
                !!prevEl.getText()?.trim();
              if (!isCenteredText) {
                const blankPara = createBlankParagraph(blankOpts);
                doc.insertBodyElementAt(originalIndex, blankPara);
                added++;
                i++; // Skip past inserted blank
              }
            }
          }
        }
      }
```

Replace the `if (!isCenteredText) { ... }` inner block so the insertion routes through the guarded wrapper:

```typescript
              if (!isCenteredText) {
                const outcome = insertBlankAtBodyIfSafe(doc, originalIndex, blankOpts);
                if (outcome === "added") {
                  added++;
                  i++; // Skip past inserted blank
                } else {
                  log.debug(
                    `Skipped large-image "above" insertion at body index ${originalIndex}: ` +
                      `preceding paragraph has a tracked paragraph-mark deletion`
                  );
                }
              }
```

This is the specific site that produced the user-reported bug.

- [ ] **Step 6: Refactor the cell addition site (line 306–309)**

In `applyAdditionRulesCells`, locate:

```typescript
              const blankPara = createBlankParagraph(blankOpts);
              cell.addParagraphAt(ci + 1, blankPara);
              added++;
              ci++; // Skip past inserted blank
              paras = cell.getParagraphs();
```

Replace with:

```typescript
              const outcome = addBlankToCellIfSafe(cell, ci + 1, blankOpts);
              if (outcome === "added") {
                added++;
                ci++; // Skip past inserted blank
                paras = cell.getParagraphs();
              } else {
                log.debug(
                  `Skipped cell-scope insertion at cell index ${ci + 1}: ` +
                    `preceding paragraph has a tracked paragraph-mark deletion ` +
                    `(rule: ${matchedRule.id})`
                );
              }
```

- [ ] **Step 7: Confirm the preservation sites at lines 346 and 410 are NOT modified**

Open `BlankLineManager.ts` and verify that `applyPreservationFallbackBody` (around line 346) and `applyPreservationFallbackCells` (around line 410) still call `createBlankParagraph` + `doc.insertBodyElementAt` / `cell.addParagraphAt` directly. These are intentional — preservation reinstates blanks the author originally authored, where any paragraph-mark deletion already targets the authored blank.

- [ ] **Step 8: Run the unit tests to confirm the helpers still pass**

Run: `npx jest src/services/document/blanklines/__tests__/blankLineInsertion.test.ts`
Expected: PASS — all tests from Task 1 + the sequence test from Step 1 of this task.

- [ ] **Step 9: Run the full blanklines test suite to catch regressions**

Run: `npx jest src/services/document/blanklines/`
Expected: PASS. The refactor preserves outward behavior on documents without paragraph-mark deletions, so existing tests must remain green. If a test fails, read the failure — if it's because the test fixture has a paragraph-mark deletion and an insertion that we are now correctly skipping, update the test's expected count. Do not silence failures; investigate each.

- [ ] **Step 10: Commit**

```bash
git add src/services/document/blanklines/BlankLineManager.ts \
        src/services/document/blanklines/__tests__/blankLineInsertion.test.ts
git commit -m "Route BlankLineManager addition sites through guarded insertion helpers"
```

---

## Task 4: Stage the integration fixture

**Files:**
- Create: `src/services/document/__tests__/fixtures/paramark-del-around-deleted-image.docx`

The fixture is `Error_O.docx` from the docxmlater repo, copied into dochub-app under a self-describing name so the test suite has no cross-repo dependency.

- [ ] **Step 1: Copy the fixture**

Run:

```bash
cp "C:/Users/DiaTech/Projects/DocHub/development/docxmlater/Error_O.docx" \
   "src/services/document/__tests__/fixtures/paramark-del-around-deleted-image.docx"
```

- [ ] **Step 2: Verify the fixture is present and roughly the expected size (~290 KB based on the docxmlater copy)**

Run:

```bash
ls -la "src/services/document/__tests__/fixtures/paramark-del-around-deleted-image.docx"
```

Expected: file exists, size ≈ 290 KB. If the file is much smaller, the copy failed.

- [ ] **Step 3: Commit**

```bash
git add "src/services/document/__tests__/fixtures/paramark-del-around-deleted-image.docx"
git commit -m "Add fixture for paragraph-mark-deletion-around-deleted-image bug"
```

---

## Task 5: Integration test — full pipeline on the real fixture

**Files:**
- Create: `src/services/document/blanklines/__tests__/paragraphMarkDeletionInsertionGuard.integration.test.ts`

This test loads the fixture with real `docxmlater`, runs the actual `BlankLineManager.processBlankLines` against it, and asserts the bug is fixed: no Normal blank lands between the para-mark-deleted bullet and the tracked-deleted image paragraph, and the "below" insertion still happens between the image paragraph and the next bullet (where no paragraph-mark deletion is in play).

- [ ] **Step 1: Write the failing integration test**

Create `src/services/document/blanklines/__tests__/paragraphMarkDeletionInsertionGuard.integration.test.ts`:

```typescript
/**
 * Integration test for the paragraph-mark-deletion blank-line insertion guard.
 *
 * Loads paramark-del-around-deleted-image.docx, which has three bullet items
 * at the same numbering level:
 *   1. "Pending fax queues are located..." — paragraph mark is tracked-deleted.
 *   2. A bulleted paragraph containing a tracked-deleted large drawing.
 *   3. "24/7 Clients:" — plain bulleted item, no paragraph-mark deletion.
 *
 * After processing, the guard must have stopped the "above" blank from
 * landing between item 1 and item 2 (which would corrupt the merge target
 * for item 1's paragraph-mark deletion). The "below" blank between item 2
 * and item 3 is unaffected and may still be inserted.
 */
/* globals describe, it, expect */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Document, Paragraph } from "docxmlater";
import { BlankLineManager } from "../BlankLineManager";
import { captureBlankLineSnapshot } from "../helpers/blankLineSnapshot";

const FIXTURE = resolve(
  __dirname,
  "..",
  "..",
  "__tests__",
  "fixtures",
  "paramark-del-around-deleted-image.docx"
);

function findBodyIndex(doc: Document, predicate: (p: Paragraph) => boolean): number {
  const count = doc.getBodyElementCount();
  for (let i = 0; i < count; i++) {
    const el = doc.getBodyElementAt(i);
    if (el instanceof Paragraph && predicate(el)) return i;
  }
  return -1;
}

describe("paragraph-mark-deletion guard — integration", () => {
  it("does not insert a blank between a paragraph-mark-deleted bullet and a bulleted tracked-deleted-image paragraph", async () => {
    const buf = readFileSync(FIXTURE);
    const doc = await Document.loadFromBuffer(buf, { revisionHandling: "preserve" });

    // Sanity: the fixture has the para-mark-deletion pattern we expect.
    const item1Idx = findBodyIndex(doc, (p) =>
      p.getText().includes("Pending fax queues are located")
    );
    expect(item1Idx).toBeGreaterThan(-1);
    const item1 = doc.getBodyElementAt(item1Idx);
    expect(item1).toBeInstanceOf(Paragraph);
    expect((item1 as Paragraph).isParagraphMarkDeleted()).toBe(true);
    expect((item1 as Paragraph).getNumbering()).not.toBeNull();

    // Run the real pipeline.
    const snapshot = captureBlankLineSnapshot(doc);
    const manager = new BlankLineManager();
    manager.processBlankLines(doc, snapshot, {});

    // The post-processing element immediately after item 1 must still be the
    // bulleted (tracked-deleted-image) paragraph, NOT a Normal blank.
    const newItem1Idx = findBodyIndex(doc, (p) =>
      p.getText().includes("Pending fax queues are located")
    );
    expect(newItem1Idx).toBeGreaterThan(-1);
    const successor = doc.getBodyElementAt(newItem1Idx + 1);
    expect(successor).toBeInstanceOf(Paragraph);
    const successorPara = successor as Paragraph;
    // The successor must still be a list item (has a numId), proving no
    // Normal blank was inserted between them.
    expect(successorPara.getNumbering()).not.toBeNull();
    // It must NOT have text content other than what was there originally
    // (the original successor was the image paragraph — empty text, but bulleted).
    // We assert the *24/7 Clients* item is two body indices further along,
    // confirming the image paragraph remains in place between them.
    const cliIdx = findBodyIndex(doc, (p) => p.getText().includes("24/7 Clients"));
    expect(cliIdx).toBeGreaterThan(newItem1Idx);

    doc.dispose();
  });

  it("preserves the leading paragraph's paragraph-mark deletion and numbering", async () => {
    const buf = readFileSync(FIXTURE);
    const doc = await Document.loadFromBuffer(buf, { revisionHandling: "preserve" });

    const snapshot = captureBlankLineSnapshot(doc);
    new BlankLineManager().processBlankLines(doc, snapshot, {});

    const idx = findBodyIndex(doc, (p) =>
      p.getText().includes("Pending fax queues are located")
    );
    const item1 = doc.getBodyElementAt(idx) as Paragraph;
    expect(item1.isParagraphMarkDeleted()).toBe(true);
    expect(item1.getNumbering()).not.toBeNull();

    doc.dispose();
  });
});
```

- [ ] **Step 2: Sanity-check imports (no action required if these match)**

Verified during plan prep:
- The snapshot factory is exported as `captureBlankLineSnapshot` from `src/services/document/blanklines/helpers/blankLineSnapshot.ts` (line 145). The test's import matches.
- `BlankLineProcessingOptions` (ruleTypes.ts:59) has all-optional fields; `processBlankLines(doc, snapshot, {})` is a valid call shape.

No edits needed in this step — proceed to Step 3 if the imports compile.

- [ ] **Step 3: Run the integration test to verify it passes**

Run: `npx jest src/services/document/blanklines/__tests__/paragraphMarkDeletionInsertionGuard.integration.test.ts`
Expected: PASS.

If it fails because the fixture's immediate successor turns out to be something other than the image paragraph (e.g., the manager removed the image paragraph entirely), inspect what is actually at `newItem1Idx + 1` and adjust the assertions to match observed-and-correct behavior — but do not weaken the core invariant ("no Normal blank lands between item 1 and its merge target"). If a regression makes that core invariant impossible to assert against the real fixture, stop and report.

- [ ] **Step 4: Confirm the existing alignment helper test still passes**

Run: `npx jest src/services/document/helpers/__tests__/paragraphMarkDeletionAlignment.test.ts`
Expected: PASS — the new guard must not interfere with `stripCenterAfterDeletedParaMark`.

- [ ] **Step 5: Run the full test suite for one final regression check**

Run: `npm test`
Expected: PASS overall, or at minimum: no new failures relative to the baseline before this branch. If pre-existing failures exist, capture which ones to confirm they are pre-existing.

- [ ] **Step 6: Commit**

```bash
git add src/services/document/blanklines/__tests__/paragraphMarkDeletionInsertionGuard.integration.test.ts
git commit -m "Integration test for paragraph-mark-deletion blank-line guard"
```

---

## Self-review (do this after writing each task, before marking complete)

1. Did this task's code refer to a function, type, or method not defined in this task or a prior task? If yes, fix.
2. Does this task's commit message describe the *change*, not the *task number*? If not, fix.
3. Are the assertions in this task's test phrased so the failure message points to *which behavior* is wrong, not just "expected X got Y"? If they're opaque, add a comment above the `expect` line.

## Acceptance review (do this after Task 5)

Map each spec acceptance bullet to a passing test or assertion:

1. **"Both unit and integration tests pass"** — Task 1 tests, Task 3 sequence test, Task 5 integration test all green.
2. **"Running the full processing pipeline on Error_O.docx produces output where, after revisions are accepted in Word, the two original bullet items remain bulleted at the same level with no floating empty bullet between them."** — Task 5's `"does not insert a blank between..."` test asserts this structurally on the in-memory document. A manual visual verification in Word is *not* required by this plan, but is welcome as a smoke check by the reviewer if they have Word available.
3. **"The existing `paragraphMarkDeletionAlignment.test.ts` suite still passes — the new guard must not interfere with that helper's behavior."** — Task 5 Step 4 runs it explicitly.
4. **"No regression in the existing blank-line test suite."** — Task 3 Step 9 runs `npx jest src/services/document/blanklines/`; Task 5 Step 5 runs the full suite.
