# Indented Bold-Colon & Indent Normalization — Design

## Goal

Tighten blank-line handling around indented "bold + colon" paragraphs, and replace the existing two-rule indentation pass with a three-case cascading decision tree that produces deterministic, visually consistent indentation across the document.

## Background

The blank-line pipeline already understands one bold-colon shape: **non-indented** bold-colon paragraphs (e.g. `Note:`, `Warning:`) get a blank line above and a blank below (`additionRules.aboveBoldColonNoIndentRule`, `boldColonNoIndentAfterRule`), and the blank between a non-indented bold-colon and following indented or list content is removed (`removalRules.boldColonToIndentedRule`). The symmetric case — **indented** bold-colon paragraphs — currently has no special handling, so they pick up the same blank-line behavior as ordinary indented prose, which produces unwanted blank lines above them and between them and following list items.

Separately, the existing `applyIndentationRules` in `rules/indentationRules.ts:217-262` normalizes indented non-list paragraphs but with two limitations: (1) it always snaps consecutive indented non-list paragraphs to **level-0 text indent**, instead of cascading prev's indent forward; (2) it has no rule for "indented paragraph whose prev is neither a list item nor indented," so such paragraphs keep whatever stray indent they had. The user wants a single decision tree with explicit handling for that third case and cascade-friendly propagation of indent values.

Both changes live in `src/services/document/blanklines/` and are tightly related (both anchor on "indented" / "list item" / "bold-colon" concepts and run inside `BlankLineManager.processBlankLines`), so they ship together.

## Part 1 — Blank-line removal for indented bold-colon

### Shared helper

`isIndentedBoldColon(para: Paragraph): boolean` added to `src/services/document/blanklines/helpers/paragraphChecks.ts`. Returns `true` when:

- `startsWithBoldColon(para)` returns `true`, AND
- `para.getNumbering()` is truthy **or** `para.getFormatting()?.indentation?.left` is > 0.

List-item bold-colon paragraphs count as "indented" because they're visually indented by the list level. This matches the answer to the brainstorming clarifier.

### Two new removal rules

Added to `src/services/document/blanklines/rules/removalRules.ts`, exported and appended to the `removalRules` array directly after `boldColonToIndentedRule` (so they evaluate in the same neighborhood as the existing bold-colon removal).

**Rule R1 — `remove-above-indented-bold-colon`**

- `action: "remove"`, `scope: "both"`
- Matches when `ctx.currentElement` is a blank paragraph AND `ctx.nextElement` is a paragraph for which `isIndentedBoldColon` is true.
- Effect: the blank above the indented bold-colon paragraph is removed by `BlankLineManager.applyRemovalRulesBody` / `applyRemovalRulesCells`.

**Rule R2 — `remove-indented-bold-colon-to-list-item`**

- `action: "remove"`, `scope: "both"`
- Matches when `ctx.currentElement` is a blank paragraph AND `ctx.prevElement` is an indented bold-colon paragraph AND `ctx.nextElement` is a list item (`getNumbering()` truthy).
- Effect: the blank between an indented bold-colon paragraph and an immediately-following list item is removed.

### Interaction with existing rules

- `additionRules.aboveBoldColonNoIndentRule` and `boldColonNoIndentAfterRule` use the private `isBoldColonNoIndent` predicate, which by definition excludes both list items and any paragraph with positive left-indent. They will never fire for the paragraphs R1/R2 target — no conflict.
- The preservation fallback (`applyPreservationFallbackBody` / `applyPreservationFallbackCells`) already calls `findMatchingRemovalForPosition` / `findMatchingCellRemovalForPosition` against the full `removalRules` array, so blanks at R1/R2 positions are automatically suppressed from preservation.
- `consecutiveBlanksRule` runs first and collapses adjacent blanks, so R1/R2 always see at most one blank between elements — no double-blank edge cases.

## Part 2 — Indentation decision tree

### Replacement for `applyIndentationRules`

Refactor `src/services/document/blanklines/rules/indentationRules.ts` so the body-iteration and cell-iteration loops walk forward and apply a **single three-case decision tree** per indented non-list paragraph. The forward-walk lets Case B observe Case C's normalization from earlier in the same iteration.

For each non-blank, non-list paragraph `N` with `formatting.indentation.left > 0`:

| Case | Trigger | Action |
|---|---|---|
| **A** | The immediate previous element (`getBodyElementAt(i-1)` in body, `paras[ci-1]` in cell) is a non-blank Paragraph with `getNumbering()` truthy. | `N.setLeftIndent(getTextIndentForLevel(options, prev.numbering.level))`. If `getTextIndentForLevel` returns null, leave N alone. |
| **B** | The immediate previous element is a non-blank, non-list Paragraph with `formatting.indentation.left > 0`. | `N.setLeftIndent(prev.getFormatting()?.indentation?.left)`. Because we iterate forward, `prev` has already been normalized by an earlier loop pass. |
| **C** | None of the above — prev is blank, prev is non-indented, prev is a `Table`, or `N` is the first element. | `N.setLeftIndent(getLevel0TextIndent(options) ?? FALLBACK_FIRST_INDENT_TWIPS)` where `FALLBACK_FIRST_INDENT_TWIPS = inchesToTwips(0.5)`. |

Per the brainstorming clarifier, "the immediate previous element" does **not** skip blanks. A blank line above an indented paragraph counts as Case C; the paragraph snaps to level-0 (or 0.5" if no list settings are configured).

The existing helpers `findPrecedingListItem` and `findPrecedingListItemInCell` (which DID skip blanks and walk back through chains of indented prose) become unreachable and are deleted from the file.

### Preserved behavior

- `removeSmallIndents` continues to run in `WordDocumentProcessor` before the blank-line manager — paragraphs with stray indents under 0.25" are flattened to zero before the decision tree evaluates them.
- List items themselves are skipped (`if (para.getNumbering()) continue;`), same as today. The list pipeline owns list-item indent.
- Paragraphs marked `isPreserved()` (e.g. TOC field paragraphs) are unaffected — the decision tree only touches paragraphs the existing loops already iterate.
- The `options.listBulletSettings?.indentationLevels` guard at the top of `applyIndentationRules` is removed, because Case C now has a hard-coded fallback. The function always runs.

### Cell behavior

The cell loop applies the identical decision tree, using `paras[ci-1]` as the immediate previous element within the cell. Cells with nested tables are still skipped (matches the rest of the blank-line pipeline). Cross-cell context is not considered — each cell starts fresh, so the first indented paragraph in a cell is always Case C.

### Ordering inside `BlankLineManager`

`BlankLineManager.processBlankLines` order is unchanged:
1. SDT cleanup
2. Removal rules (Part 1 takes effect here)
3. Addition rules
4. Preservation fallback
5. **Indentation rules (Part 2 takes effect here)**
6. Dedup
7. Style normalization

Indentation runs **after** blank-line removal, so R1/R2's collapsed blanks don't artificially trigger Case C — the "immediate prev" for an indented bold-colon paragraph that previously had a blank above it is now the real preceding content paragraph.

## Edge cases & confirmations

- **First body element is indented** → Case C → 0.5".
- **First paragraph of a table cell is indented** → Case C → 0.5".
- **Indented paragraph after a Table** → prev is `Table`, not `Paragraph` → Case C.
- **Indented paragraph after a blank** → Case C (blanks aren't bridged).
- **Three consecutive indented non-list paragraphs after non-indented text** → first one Case C → 0.5"; second matches prev via Case B → 0.5"; third matches prev via Case B → 0.5". Whole block settles deterministically.
- **Indented paragraph after a level-2 list item** → Case A → matches level-2 text indent.
- **Bold-colon paragraph that is also indented** → covered by Part 1 (blank-line removal) and Part 2 (indent normalization) independently. No interaction.
- **List items as `N` itself** → skipped by the `if (para.getNumbering()) continue;` guard, same as today.

## Files & surface

- `src/services/document/blanklines/helpers/paragraphChecks.ts` — add `isIndentedBoldColon` (~10 lines).
- `src/services/document/blanklines/rules/removalRules.ts` — add two rules and append to the export array (~30 lines).
- `src/services/document/blanklines/rules/indentationRules.ts` — refactor `applyIndentationRules` to the three-case tree; delete `findPrecedingListItem` and `findPrecedingListItemInCell`; add `FALLBACK_FIRST_INDENT_TWIPS` constant (~60 line net change).
- `src/services/document/blanklines/__tests__/indentedBoldColonRemoval.test.ts` — new (~120 lines).
- `src/services/document/blanklines/__tests__/indentationRulesDecisionTree.test.ts` — new (~200 lines).

No new modules, no API changes outside the package.

## Test plan

### Part 1 — `indentedBoldColonRemoval.test.ts`

1. Blank above an indented bold-colon paragraph → removed by R1.
2. Blank above a list-item bold-colon paragraph → removed by R1.
3. Blank above a **non-indented** bold-colon paragraph → kept (R1 doesn't match; existing addition rule still applies).
4. Blank between indented bold-colon and a following list item → removed by R2.
5. Blank between indented bold-colon and a following non-list indented paragraph → kept (R2 requires next = list item).
6. Blank between non-indented bold-colon and list-item → existing `boldColonToIndentedRule` still removes (no regression).
7. Both R1 and R2 fire inside table cells, not only at body level.

### Part 2 — `indentationRulesDecisionTree.test.ts`

1. Case A: indented non-list paragraph after a level-0 list item → indent set to level-0 text indent.
2. Case A: indented non-list paragraph after a level-2 list item → indent set to level-2 text indent.
3. Case A: `getTextIndentForLevel` returns null for some reason → indent left unchanged.
4. Case B: indented non-list paragraph after another indented non-list paragraph → matches prev's indent.
5. Case B cascade: three consecutive indented non-list paragraphs after non-indented prose → all settle at the level-0 value via C → B → B.
6. Case C: first body element is indented → set to level-0 (or 0.5" fallback).
7. Case C: indented paragraph after a blank → set to level-0.
8. Case C: indented paragraph after a Table → set to level-0.
9. Case C fallback: no `listBulletSettings.indentationLevels` configured → set to 0.5".
10. List items as `N` are skipped (no modification).
11. Indentation rules apply identically inside table cells.
12. `removeSmallIndents` still strips sub-0.25" indents before the decision tree runs (sanity check that the upstream pipeline behaves correctly with the refactor).
