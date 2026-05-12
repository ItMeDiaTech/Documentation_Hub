# Remove cross-type list conversion

**Date:** 2026-05-12
**Status:** Design — pending review

## Goal

Mixed bullet + numbered lists are now an allowed output. Stop converting list items from one type to another to force "uniformity". Delete the code paths that exist solely to do that conversion, including the chunks that are already dead or no-op.

## Scope clarification

The instruction is narrow: stop **cross-type conversion**. Three adjacent things stay:

1. **Within-type character/indent standardization** (`applyBulletUniformity`, `applyNumberedUniformity`) — these only operate within their own category. They make all bullets use the configured Symbol and indent, and all numbered items use the configured format and indent. They never convert across categories.
2. **Typed-prefix → Word-list structural conversion** (literal "1." text becoming a real `<w:numPr>` numbered list). Structural, not cross-type.
3. **HLP table semantics** in `TableProcessor.ts`. HLP step content has its own numbering rules independent of general list policy.

## Code to remove

### 1. `WordDocumentProcessor.ts` — `convertMixedListFormats` and call site

Lines ~9760-9858 define `convertMixedListFormats`. Reading its body shows it is **already a no-op** (since v5.8.0):

```ts
// DO NOT convert levels — preserve the original mixed format structure.
// The old behavior destroyed intentional hierarchies …
```

It still gets called at line ~2647 inside the `options.bulletUniformity && options.listBulletSettings` block, still logs "BEFORE / AFTER convertMixedListFormats" debug markers, and `mixedConverted` is folded into the `totalListsFixed` counter at line ~2665 (always 0).

Remove:
- The entire `convertMixedListFormats` method.
- The `getFormatFallbackString` helper (lines ~9743-9758) — it exists only for the now-deleted method.
- The call site (lines ~2642-2651).
- `mixedConverted` from the totals computation at line ~2665.

### 2. `WordDocumentProcessor.ts` — `convertNestedNumbersToBullets*` orphans

`convertNestedNumbersToBulletsInTableCells` (~9962) and `convertNestedNumbersToBulletsInBody` (~10077) are defined but have **zero callers** (verified via `grep "this\.convertNestedNumbersToBullets"` and equivalents). Pure dead code.

Remove both methods entirely.

### 3. `list/ListNormalizer.ts` — sub-item detection and cross-type conversion

Lines 419-528 build `bulletAsSubItemIndices` and `numberedAsSubItemIndices` to drive the cross-type conversion that follows. With cross-type conversion removed, these sets have no consumer.

Lines 536-538 (and the level-shift recalculation that follows) use those sets to avoid shifting sub-items in level inference. With sub-item detection gone, the original `levelShiftByIndex` map computed at line ~415 stands as the final shift map.

Lines 756-790 contain three conversion branches:
- "Sandwiched bullet following numbered → numbered sub-item"
- "Numbered following bullet → bullet sub-item"
- "Trailing bullet in numbered-majority cell - preserve as bullet" (this branch *does* preserve but reassigns numId, which is technically still cross-type-aware logic — see below)

Lines 791-804 are the "regular category conversion" branch: when `needsConversion` is true, force the item to the majority category (`if majorityCategory === "bullet"` → `getBulletNumId`; else → `getNumId`). This is the canonical offender.

Lines 805-818 are the "preserve category but ensure consistent numId with user settings" branch — this is the path we want to keep for *all* `isWordList` items.

Refactor:
- Delete the `bulletAsSubItemIndices` / `numberedAsSubItemIndices` blocks at 419-528.
- Delete the level-shift recalculation at 536-onward that depends on `allSubItemIndices`. Keep the original `levelShiftByIndex` map as the final shift.
- In the action loop, collapse the four `isWordList`-keyed branches (lines 756-818) into a single "preserve category, set consistent numId" branch.

### 4. `components/sessions/ProcessingOptions.tsx` — UI string

Line 55:

```ts
"normalize-table-lists":
    "Converts typed list prefixes (1., A., •) to proper Word formatting and fixes mixed lists",
```

Change to:

```ts
"normalize-table-lists":
    "Converts typed list prefixes (1., A., •) to proper Word formatting",
```

### 5. Comment sweep

Files referencing the old "uniform mixed list" rule should have their comments trimmed where they describe removed behavior:

- `WordDocumentProcessor.ts` ~2625-2680 — "Convert mixed list formats to maintain consistency …" header comment.
- `WordDocumentProcessor.ts:2656` — "Must run AFTER all NumberingManager API calls (applyBulletUniformity, applyNumberedUniformity, convertMixedListFormats)" — drop the `convertMixedListFormats` reference.
- `WordDocumentProcessor.ts:7781` — "These lists need nested numbers converted to bullets" — outdated; remove if the surrounding code is being removed in step 2.
- Any `_rowNumberAbstractNumIds` / `_hlpAbstractNumIds` comments that reference protection from `convertMixedListFormats` specifically.

CLAUDE.md notes (`src/services/document/CLAUDE.md`, `.claude/rules/docxmlater.md`): the rule "_rowNumberAbstractNumIds Set protects row-number numbering from applyNumberedUniformity() override" still applies — `applyNumberedUniformity` stays. The rule about HLP being skipped in list processing still applies. No CLAUDE.md edits needed in this change.

## Code to preserve

| File / area | Why |
|-------------|-----|
| `WordDocumentProcessor.ts` `applyBulletUniformity` (~8449), `applyNumberedUniformity` (~8803) | Within-type standardization only. |
| `options.bulletUniformity` flag + UI option `bullet-uniformity` | The user-facing label "Makes bullet styles consistent throughout" remains accurate. Renaming the flag is YAGNI. |
| `TableProcessor.ts:1861, 2343` HLP-specific bullet→numbered | HLP step semantics are a separate domain. |
| `preProcessExtendedTypedPrefixes`, `convertTypedPrefixesWithContext` | Structural typed-prefix conversion. |
| `ListNormalizer` typed-prefix paths outside the removed regions | Still needed. |

## Risk surface

1. **`isWordList && needsConversion` branch is the canonical offender** — but the else-branch at 805-818 already handles "preserve category, set consistent numId". After deletion the unified branch must include this path, otherwise Word lists pass through unchanged from a numId-consistency perspective (which would regress the user-settings flow).

2. **Level-shift correctness** — When sub-item detection drove a separate recalculated `levelShiftByIndex`, it was preventing parent items from being shifted to level 0 when sub-items were at lower ilvl. After removal, `levelShiftByIndex` reverts to the first computation at line ~415, which is based on *all* paragraphs' min ilvl. Verify against ListNormalizer's existing test fixtures that this doesn't introduce shift regressions for non-cross-type-mixed cases. If it does, the shift logic needs a focused look — but **don't preemptively rewrite it**; let the tests drive.

3. **`_rowNumberAbstractNumIds` and `_hlpAbstractNumIds` Sets** are populated and used elsewhere (HLP detection, row-number column standardization). Unaffected by this change.

4. **Vestigial `mixedConverted` removal cascades** — its removal from the totals counter changes `totalListsFixed` semantics very slightly. Net effect: zero, because `mixedConverted` was always 0.

## Architecture

No structural changes. Deletions and one branch consolidation in `ListNormalizer`. No new files, no new abstractions.

## Components touched

| Component | Change |
|-----------|--------|
| `src/services/document/WordDocumentProcessor.ts` | Delete `convertMixedListFormats`, `getFormatFallbackString`, `convertNestedNumbersToBulletsInTableCells`, `convertNestedNumbersToBulletsInBody`, and call site for `convertMixedListFormats`. Trim totals computation and surrounding comments. |
| `src/services/document/list/ListNormalizer.ts` | Delete sub-item detection (419-528), level-shift recalculation (536-onward depending on `allSubItemIndices`), and the three cross-type conversion branches in the action loop (756-804). Consolidate to a single "preserve category, set consistent numId" branch. |
| `src/components/sessions/ProcessingOptions.tsx` | Drop "and fixes mixed lists" from the `normalize-table-lists` description. |

## Testing strategy

Existing tests probably encode the old behavior in places. Approach:

1. Run `npm test` baseline. Capture failures attributable to this change.
2. For any failing assertion that asserted "bullet item became numbered" or "numbered item became bullet" inside a mixed list: update the assertion to expect category preservation.
3. **New tests** (added to `ListNormalizer.test.ts` if it exists, otherwise a new test file `src/services/document/list/__tests__/ListNormalizer.mixed-lists.test.ts`):
   - **Mixed body list:** 3 paragraphs — bullet, numbered, bullet — each marked as already a Word list with consistent numIds; assert categories survive normalization unchanged.
   - **Mixed table cell:** same shape inside a table cell; same assertion.
   - **Typed-prefix path still works:** "1." text → numbered Word list (smoke that we didn't break the structural conversion).
4. **Manual smoke:** open a real document with intentional mixed lists (bullets with numbered sub-items, or a list that alternates), process it, open the output in Word, confirm structure preserved.

## Build sequence (preview)

The implementation plan will sequence:

1. Delete `convertNestedNumbersToBullets*` orphans (pure dead code; verifies no callers exist).
2. Delete `convertMixedListFormats` + `getFormatFallbackString` + call site (was already a no-op).
3. Refactor `ListNormalizer.ts` — sub-item detection out, branches collapsed. Add the new mixed-list preservation tests first (TDD).
4. Update the UI string.
5. Sweep stale comments.
6. Full typecheck + test suite + manual smoke.

## Acceptance

- `convertMixedListFormats`, `convertNestedNumbersToBullets*`, and `getFormatFallbackString` no longer exist in the codebase.
- `ListNormalizer.ts` no longer contains `bulletAsSubItemIndices` or `numberedAsSubItemIndices`.
- The `normalize-table-lists` UI description matches the new behavior.
- New mixed-list-preservation tests pass.
- No regressions in the existing list-processing tests (after updating any assertions that previously expected cross-type conversion).
- Typecheck clean.
- Manual smoke confirms mixed lists survive a round-trip unchanged.

## Out of scope

- Renaming the `bulletUniformity` option to `listCharacterStandardization` or similar (YAGNI; the current label is fine).
- Changing HLP table list handling.
- Refactoring `applyBulletUniformity` / `applyNumberedUniformity`.
- Touching `preProcessExtendedTypedPrefixes` or `convertTypedPrefixesWithContext`.
- Touching CLAUDE.md or `.claude/rules/docxmlater.md` — the documented rules remain accurate.
