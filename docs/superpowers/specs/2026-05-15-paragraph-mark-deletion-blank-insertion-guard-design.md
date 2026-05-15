# Paragraph-Mark-Deletion Blank-Line Insertion Guard

**Status:** Approved, ready for implementation plan
**Date:** 2026-05-15
**Area:** dochub-app — `src/services/document/blanklines/`
**Adjacent prior art:** `src/services/document/helpers/paragraphMarkDeletionAlignment.ts`

## Problem

The blank-line engine inserts Normal-style blank paragraphs around large images, between body paragraphs, and in several other rule-driven positions. When the insertion lands between a paragraph whose paragraph mark is tracked-deleted (`<w:pPr><w:rPr><w:del>`) and that paragraph's natural merge target, Word's render of accepted revisions merges the leading paragraph's runs into the *inserted blank* instead of into the original merge target. The leading paragraph silently loses the formatting (bullet, indent, style) that the merge target used to provide.

### Concrete observed failure

Input: a tracked-changes document with three sibling list items at the same numbering level. The first list item ("Pending fax queues…") has its paragraph mark wrapped in `<w:del>`. The second list item contains a tracked-deleted large drawing. The third list item is plain text ("24/7 Clients:").

After `aboveAndBelowLargeImagesRule` (additionRules.ts:337) matches the image paragraph, the engine inserts a Normal-style blank above and below it. The "above" blank lands between item 1 and item 2.

When Word renders this with revisions accepted:
- Item 1's paragraph-mark deletion merges its runs into the inserted blank (Normal, no `<w:numPr>`, no `<w:pStyle>`). The bullet and indent vanish.
- Item 2's drawing is gone (tracked-deleted) but the paragraph itself survives with its `<w:numPr>` intact, rendering as a floating empty bullet between item 1 and item 3.

The bug is rule-agnostic: any addition rule that ends up calling the shared insertion helpers can produce the same artifact. The image rule is just the one that fired in the reported case.

### Why this is the same family as `stripCenterAfterDeletedParaMark`

`paragraphMarkDeletionAlignment.ts:29` already exists to repair a sibling case: when the natural merge target happens to be centered (often via table uniformity), the leading paragraph's alignment is copied onto the trailing paragraph so the merge target carries the original intent. That helper assumes the merge target is a real authored paragraph whose properties just need adjusting. It does not anticipate the merge target being a *Normal blank we ourselves inserted moments earlier* — at which point copying alignment onto a Normal blank does nothing useful, and the real damage (lost `numPr` / `pStyle`) goes unaddressed.

## Goal

Stop the blank-line engine from inserting blanks between a paragraph-mark-deleted paragraph and its merge target. The paragraph-mark deletion is a contract with the original author: "on accept, these two paragraphs merge." The engine must not silently break that contract for a visual-gap heuristic.

## Non-goals

- Carrying `numPr`/`pStyle`/`indent` across an inserted blank (Option B in brainstorming). Rejected: an inserted blank with a `numPr` renders a bare bullet in some configurations, swapping one stray-bullet artifact for another.
- Defensive repair on the docxmlater save side (Option C in brainstorming). Rejected: addresses the symptom, not the cause; other consumers don't hit this without the dochub-app insertion.
- Changing how `aboveAndBelowLargeImagesRule` decides whether an image paragraph deserves surrounding gaps. The rule's intent is fine; only the *insertion site* needs the guard.
- Changing docxmlater. The bug is entirely in dochub-app's insertion path. docxmlater already exposes `Paragraph.isParagraphMarkDeleted()` — that is all this fix needs.

## Design

### Where the guard lives

**Actual insertion landscape (verified during plan prep):** `BlankLineManager` does *not* route through `insertOrMarkBlankAfter` / `insertOrMarkBlankBefore`. Those helpers are exported API but unused by the manager. The manager calls `doc.insertBodyElementAt` and `cell.addParagraphAt` directly at six sites in `BlankLineManager.ts`:

| Site | Line | Phase | Needs guard? |
|---|---|---|---|
| `insertBodyElementAt(nextIdx, blank)` — "before next" rules | 224 | addition | yes |
| `insertBodyElementAt(i+1, blank)` — standard "after" rules | 238 | addition | yes |
| `insertBodyElementAt(originalIndex, blank)` — large-image "above" | 259 | addition | yes (this is the site that caused the reported bug) |
| `cell.addParagraphAt(ci+1, blank)` — cell-scope additions | 307 | addition | yes |
| `insertBodyElementAt(i+1, blank)` — preservation fallback (body) | 346 | preservation | **no** (see below) |
| `cell.addParagraphAt(ci+1, blank)` — preservation fallback (cell) | 410 | preservation | **no** |

The guard goes at the four *addition* sites (224, 238, 259, 307). Preservation sites (346, 410) are deliberately unguarded: preservation only reinstates blanks that were present in the original document. If the author originally placed a blank between a para-mark-deleted paragraph and a list item, the paragraph-mark deletion already targets that authored blank — preservation restoring it does not break a contract it wasn't already party to.

To avoid duplicating the same check four times, introduce two small thin-wrapper helpers in `src/services/document/blanklines/helpers/blankLineInsertion.ts`:

- `insertBlankAtBodyIfSafe(doc, index, options): "added" | "skipped"` — wraps `doc.insertBodyElementAt(index, createBlankParagraph(options))`, but first checks whether the element at `index - 1` is a paragraph-mark-deleted `Paragraph`. If yes, returns `"skipped"` without inserting. Used by sites 224 (with `index = nextIdx`), 238 (`index = i+1`), and 259 (`index = originalIndex`).
- `addBlankToCellIfSafe(cell, index, options): "added" | "skipped"` — wraps `cell.addParagraphAt(index, createBlankParagraph(options))`, checking whether `cell.getParagraphs()[index - 1]` is a paragraph-mark-deleted `Paragraph`. Used by site 307.

The existing `insertOrMarkBlankAfter` / `insertOrMarkBlankBefore` helpers (currently exported but unused by `BlankLineManager`) also get the guard, on the `"added"` branch only, so any future caller of those helpers inherits the same protection. The `"marked"` and `"skipped"` (blank-already-present) branches are untouched.

Putting the guard in these wrappers means each addition site in `BlankLineManager` changes from a direct insert to a wrapper call, plus the `i++ // Skip past inserted blank` book-keeping moves inside the `"added"` branch only. Plan tasks make the wrapper-and-site change atomic.

### Guard behavior

When the helper is about to insert (not merely *mark* an existing blank as preserved), check the element that would sit immediately *before* the new blank in the resulting sequence:

- For `insertOrMarkBlankAfter(doc, elementIndex, options)`: the preceding element is `doc.getBodyElementAt(elementIndex)`.
- For `insertOrMarkBlankBefore(doc, elementIndex, options)`: the preceding element is `doc.getBodyElementAt(elementIndex - 1)`.

If that preceding element is a `Paragraph` whose `isParagraphMarkDeleted()` is true, return `"skipped"` and do not insert. The existing return type already includes `"skipped"`, so callers that count results stay consistent.

The "mark existing blank as preserved" branch is unaffected: if a blank already exists in that position, the paragraph-mark deletion already targets that pre-existing blank, and we are not changing the structure — only annotating it. The original document author either accepted that target or is responsible for it. The guard only fires on the `"added"` branch.

### Cell-scope decision (was deferred — now resolved)

`paragraphMarkDeletionAlignment.ts` already establishes that paragraph-mark-deletion semantics apply *within a single body or cell scope* — merges do not cross body↔cell or cell↔cell boundaries.

Verified during plan prep: `applyAdditionRulesCells` (BlankLineManager.ts:275) walks each cell and inserts blanks via `cell.addParagraphAt(ci + 1, blankPara)` (line 307) when any addition rule with `scope: "both"` matches in a cell. Any addition rule with `scope: "both"` (currently: `afterListItemsRule`, `aboveAndBelowLargeImagesRule`, `aboveSmallImageTextRule`) can produce the same pattern inside a cell that a list item with a paragraph-mark deletion shares with a tracked-deleted image. The cell guard is therefore in scope for this fix, not deferred — covered by the `addBlankToCellIfSafe` wrapper described above.

### Logging

When the guard skips an insertion, log at `debug` (not `warn`) via the existing `logger.namespace("BlankLineManager")` instance: skipping is correct behavior, not a problem. The log line should include the rule id (if available — the helper currently doesn't receive it; an optional `reason: string` parameter on the helper makes this trivial, and is forward-compatible with telemetry). If threading the rule id through is intrusive, a generic "skipped insertion: paragraph-mark deletion target" line is sufficient — the rule id can be added later without behavior change.

### Test coverage

Two new tests, parallel to the existing `paragraphMarkDeletionAlignment.test.ts`:

1. **Unit test on `insertOrMarkBlankAfter` / `insertOrMarkBlankBefore`:** construct a 3-paragraph fixture in memory (item 1 with `numPr` and paragraph-mark deletion, item 2 with `numPr`, item 3 plain). Call `insertOrMarkBlankAfter(doc, 0, opts)`. Expect return value `"skipped"` and no new element inserted. Call it on a fixture *without* a paragraph-mark deletion on item 1 — expect `"added"` and a new element. This confirms the guard fires only for the intended pattern.

2. **Integration test from the actual `Error_O.docx` fixture:** load via `Document.loadFromBuffer(buf, { revisionHandling: 'preserve' })`, run the full `BlankLineManager.processBlankLines` pipeline against it, save, reload, and assert:
   - The "Pending fax queues" paragraph is *not* followed by a Normal-style blank.
   - The image paragraph is still surrounded as the rule intends *on its other side* (between image paragraph and "24/7 Clients") — the "below" blank remains because "24/7 Clients" is not paragraph-mark-deleted.
   - The "Pending fax queues" paragraph still has its `numPr` and `<w:pPr><w:rPr><w:del>` (we did not mutate it).

The integration test fixture (Error_O.docx) is already present in the docxmlater repo; copy it into dochub-app's `__tests__` fixtures directory under a clear name (e.g., `paramark-del-around-deleted-image.docx`) so the dochub-app test suite is self-contained.

### Risks and trade-offs

- **Lost visual gap above tracked-deleted images:** In "Original" view (revisions not accepted), the author sees no blank line above the image. This is acceptable: "Original" view is for reviewing edits, not for the final document. In any view that accepts the revision, the leading paragraph's content moves elsewhere anyway, so the "gap above the image" question is moot — there is no image at that position to need a gap from.
- **Other rules' intent partially overridden:** Rules like `betweenBodyParagraphsRule` will skip insertion in the para-mark-deletion case. This is the correct trade-off: respecting the author's revision contract beats applying a generic spacing heuristic.
- **Symmetric "before" case:** If an addition rule asks for a blank *before* a paragraph whose immediately preceding sibling has paragraph-mark deletion, the same guard fires on `insertOrMarkBlankBefore`. The asymmetry between "after" and "before" is just direction; the merge target is whichever paragraph sits *after* the para-mark-deleted one.

## Acceptance

The fix is complete when:
1. Both unit and integration tests pass.
2. Running the full processing pipeline on `Error_O.docx` produces output where, after revisions are accepted in Word, the two original bullet items remain bulleted at the same level with no floating empty bullet between them.
3. The existing `paragraphMarkDeletionAlignment.test.ts` suite still passes — the new guard must not interfere with that helper's behavior.
4. No regression in the existing blank-line test suite.

## Out of scope

- Refactoring the addition-rule architecture to make merge-aware insertion a first-class concept.
- Adding a docxmlater-side validator / sanitizer.
- Auditing other dochub-app document-mutation paths (style normalization, list normalization) for similar paragraph-mark-deletion hazards. If the integration test suite surfaces another instance, it gets its own spec.
