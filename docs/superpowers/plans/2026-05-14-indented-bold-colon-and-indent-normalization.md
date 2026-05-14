# Indented Bold-Colon & Indent Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two blank-line removal rules and one indent-normalization decision tree to the blank-line pipeline, so that indented bold-colon paragraphs lose unwanted blank-lines above/below and every indented non-list paragraph snaps to a deterministic indent value.

**Architecture:** Two surgical changes in `src/services/document/blanklines/`. Part 1 adds a shared `isIndentedBoldColon` helper and two removal rules registered in the existing `removalRules` array. Part 2 refactors `applyIndentationRules` from a two-rule pass into a three-case decision tree that walks forward through paragraphs (so prev's already-normalized indent cascades into Case B). Both parts run inside `BlankLineManager.processBlankLines` in the existing slot order.

**Tech Stack:** TypeScript, DocXMLater, Jest (`ts-jest`, `testEnvironment: "jsdom"` by default — fine here since these tests don't touch zip/Buffer).

**Spec:** `docs/superpowers/specs/2026-05-14-indented-bold-colon-and-indent-normalization-design.md`

**Hard rules (apply to every commit):**
- No AI attribution in code or commit messages. No `Co-Authored-By` trailers.
- Every commit uses inline git identity override:
  `git -c user.name="Austin Jordan" -c user.email="austingjordan@gmail.com" commit -m "..."`
- Never run `git config`.
- Run `npx tsc --noEmit` after each task; never commit if it errors.

---

## File Map

- **Modify:** `src/services/document/blanklines/helpers/paragraphChecks.ts` — add `isIndentedBoldColon`.
- **Modify:** `src/services/document/blanklines/rules/removalRules.ts` — add two rules, append to `removalRules` array.
- **Modify:** `src/services/document/blanklines/rules/indentationRules.ts` — refactor `applyIndentationRules`; delete `findPrecedingListItem` and `findPrecedingListItemInCell`; add `FALLBACK_FIRST_INDENT_TWIPS` constant.
- **Modify:** `src/services/document/blanklines/__tests__/paragraphChecks.test.ts` — extend MockParagraph with `getNumbering` and `getFormatting`, add `isIndentedBoldColon` tests.
- **Create:** `src/services/document/blanklines/__tests__/indentedBoldColonRemoval.test.ts` — Part 1 rule tests.
- **Create:** `src/services/document/blanklines/__tests__/indentationRulesDecisionTree.test.ts` — Part 2 decision tree tests.

---

## Task 1: Add `isIndentedBoldColon` helper (Part 1)

**Files:**
- Modify: `src/services/document/blanklines/helpers/paragraphChecks.ts:112-132` (insert after `startsWithBoldColon`)
- Modify: `src/services/document/blanklines/__tests__/paragraphChecks.test.ts` (extend MockParagraph + add tests)

- [ ] **Step 1: Extend MockParagraph in `paragraphChecks.test.ts` to support numbering and formatting**

In `paragraphChecks.test.ts`, replace the MockParagraph class (around line 68-115) with the extended version below (keeps every existing method; adds `numbering` and `formatting` options + `getNumbering` and `getFormatting`). The new fields default to `null` / `{}` so existing tests are unaffected.

```typescript
class MockParagraph {
  private content: any[];
  private style: string;
  private alignment: string;
  private bookmarksStart: any[];
  private bookmarksEnd: any[];
  private numbering: any;
  private formatting: any;

  constructor(
    opts: {
      content?: any[];
      style?: string;
      alignment?: string;
      bookmarksStart?: any[];
      bookmarksEnd?: any[];
      numbering?: any;
      formatting?: any;
    } = {}
  ) {
    this.content = opts.content ?? [];
    this.style = opts.style ?? "";
    this.alignment = opts.alignment ?? "left";
    this.bookmarksStart = opts.bookmarksStart ?? [];
    this.bookmarksEnd = opts.bookmarksEnd ?? [];
    this.numbering = opts.numbering ?? null;
    this.formatting = opts.formatting ?? {};
  }

  getContent() {
    return this.content;
  }
  getText() {
    return this.content
      .filter((c: any) => c.getText)
      .map((c: any) => c.getText())
      .join("");
  }
  getStyle() {
    return this.style;
  }
  getAlignment() {
    return this.alignment;
  }
  getBookmarksStart() {
    return this.bookmarksStart;
  }
  getBookmarksEnd() {
    return this.bookmarksEnd;
  }
  getRuns() {
    return this.content.filter((c: any) => c instanceof MockRun && !(c instanceof MockImageRun));
  }
  getNumbering() {
    return this.numbering;
  }
  getFormatting() {
    return this.formatting;
  }
}
```

- [ ] **Step 2: Write a failing test for `isIndentedBoldColon`**

Add this test block to `paragraphChecks.test.ts` (after the existing `startsWithBoldColon` describe block). Also add `isIndentedBoldColon` to the import at the top of the file.

```typescript
describe("isIndentedBoldColon", () => {
  it("returns true when bold-colon AND has positive left indent", () => {
    const para = new Paragraph({
      content: [new Run("Note:", { bold: true })],
      formatting: { indentation: { left: 720 } },
    });
    expect(isIndentedBoldColon(para)).toBe(true);
  });

  it("returns true when bold-colon AND is a list item (numbering set)", () => {
    const para = new Paragraph({
      content: [new Run("Note:", { bold: true })],
      numbering: { numId: 5, level: 0 },
    });
    expect(isIndentedBoldColon(para)).toBe(true);
  });

  it("returns false when bold-colon but no indent and not a list item", () => {
    const para = new Paragraph({
      content: [new Run("Note:", { bold: true })],
      formatting: { indentation: { left: 0 } },
    });
    expect(isIndentedBoldColon(para)).toBe(false);
  });

  it("returns false when indented but not bold-colon (no colon)", () => {
    const para = new Paragraph({
      content: [new Run("Note", { bold: true })],
      formatting: { indentation: { left: 720 } },
    });
    expect(isIndentedBoldColon(para)).toBe(false);
  });

  it("returns false when indented but first run is not bold", () => {
    const para = new Paragraph({
      content: [new Run("Note:", { bold: false })],
      formatting: { indentation: { left: 720 } },
    });
    expect(isIndentedBoldColon(para)).toBe(false);
  });

  it("returns false for a blank paragraph (no content)", () => {
    const para = new Paragraph({ content: [], formatting: { indentation: { left: 720 } } });
    expect(isIndentedBoldColon(para)).toBe(false);
  });
});
```

And update the existing top-of-file import line in `paragraphChecks.test.ts`:

```typescript
import {
  isParagraphBlank,
  startsWithBoldColon,
  isCenteredBoldText,
  isTextOnlyParagraph,
  isTocParagraph,
  isIndentedBoldColon,
} from "../helpers/paragraphChecks";
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest src/services/document/blanklines/__tests__/paragraphChecks.test.ts -t "isIndentedBoldColon"`
Expected: FAIL with `isIndentedBoldColon is not a function` or `Cannot find name 'isIndentedBoldColon'`.

- [ ] **Step 4: Implement `isIndentedBoldColon` in `paragraphChecks.ts`**

Insert this function in `src/services/document/blanklines/helpers/paragraphChecks.ts` immediately after `startsWithBoldColon` (line ~132). The function reuses `startsWithBoldColon` and is intentionally aligned with the inverse `isBoldColonNoIndent` predicate in `additionRules.ts`: both use direct `formatting.indentation.left` rather than `getEffectiveLeftIndent`, so style-inherited indents are NOT considered. This mirrors existing behavior and is the same convention used by every other bold-colon rule in this package.

```typescript
/**
 * Checks if a paragraph is a bold-colon paragraph AND is indented.
 * "Indented" means it is a list item (has w:numId) OR has positive left indent.
 * Symmetric with isBoldColonNoIndent in rules/additionRules.ts.
 */
export function isIndentedBoldColon(para: Paragraph): boolean {
  if (!startsWithBoldColon(para)) return false;
  const numbering = para.getNumbering();
  if (numbering && numbering.numId !== undefined && numbering.numId !== 0) return true;
  const leftIndent = para.getFormatting()?.indentation?.left;
  if (leftIndent && leftIndent > 0) return true;
  return false;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/services/document/blanklines/__tests__/paragraphChecks.test.ts -t "isIndentedBoldColon"`
Expected: PASS, 6 new tests green. Also run the full `paragraphChecks.test.ts` to confirm no regression: `npx jest src/services/document/blanklines/__tests__/paragraphChecks.test.ts`. Expected: all tests pass (existing + new).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit, no errors.

- [ ] **Step 7: Commit**

```bash
git -c user.name="Austin Jordan" -c user.email="austingjordan@gmail.com" \
  add src/services/document/blanklines/helpers/paragraphChecks.ts \
      src/services/document/blanklines/__tests__/paragraphChecks.test.ts && \
git -c user.name="Austin Jordan" -c user.email="austingjordan@gmail.com" \
  commit -m "feat(blanklines): add isIndentedBoldColon paragraph check"
```

---

## Task 2: Add two removal rules for indented bold-colon (Part 1)

**Files:**
- Modify: `src/services/document/blanklines/rules/removalRules.ts` (add two rules + register in array)
- Create: `src/services/document/blanklines/__tests__/indentedBoldColonRemoval.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/services/document/blanklines/__tests__/indentedBoldColonRemoval.test.ts` with the seven cases from the spec:

```typescript
/**
 * Tests for removal rules R1/R2:
 *   - remove-above-indented-bold-colon
 *   - remove-indented-bold-colon-to-list-item
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */
import {
  aboveIndentedBoldColonRule,
  indentedBoldColonToListItemRule,
} from "../rules/removalRules";

jest.mock("docxmlater", () => {
  class MockRun {
    constructor(
      private text: string = "",
      private formatting: any = {},
      private _content: any[] = []
    ) {}
    getText() {
      return this.text;
    }
    getFormatting() {
      return this.formatting;
    }
    getContent() {
      return this._content;
    }
  }
  class MockImageRun extends MockRun {
    getImageElement() {
      return {};
    }
  }
  class MockHyperlink {
    getText() {
      return "";
    }
  }
  class MockShape {}
  class MockTextBox {}
  class MockField {}
  class MockRevision {
    getText() {
      return "";
    }
    getContent() {
      return [];
    }
  }
  class MockParagraph {
    constructor(
      private opts: {
        content?: any[];
        style?: string;
        alignment?: string;
        numbering?: any;
        formatting?: any;
      } = {}
    ) {}
    getContent() {
      return this.opts.content ?? [];
    }
    getText() {
      return (this.opts.content ?? [])
        .filter((c: any) => c.getText)
        .map((c: any) => c.getText())
        .join("");
    }
    getStyle() {
      return this.opts.style ?? "";
    }
    getAlignment() {
      return this.opts.alignment ?? "left";
    }
    getNumbering() {
      return this.opts.numbering ?? null;
    }
    getFormatting() {
      return this.opts.formatting ?? {};
    }
    getBookmarksStart() {
      return [];
    }
    getBookmarksEnd() {
      return [];
    }
    getRuns() {
      return (this.opts.content ?? []).filter(
        (c: any) => c instanceof MockRun && !(c instanceof MockImageRun)
      );
    }
  }
  class MockTable {}
  function isRun(x: any) {
    return x instanceof MockRun && !(x instanceof MockImageRun);
  }
  return {
    Paragraph: MockParagraph,
    Run: MockRun,
    ImageRun: MockImageRun,
    Hyperlink: MockHyperlink,
    Shape: MockShape,
    TextBox: MockTextBox,
    Field: MockField,
    Revision: MockRevision,
    Table: MockTable,
    isRun,
  };
});

import { Paragraph, Run, Table } from "docxmlater";

const blank = () => new Paragraph({ content: [] });
const indentedBoldColon = (text = "Note:") =>
  new Paragraph({
    content: [new Run(text, { bold: true })],
    formatting: { indentation: { left: 720 } },
  });
const listItemBoldColon = () =>
  new Paragraph({
    content: [new Run("Note:", { bold: true })],
    numbering: { numId: 5, level: 0 },
  });
const nonIndentedBoldColon = () =>
  new Paragraph({
    content: [new Run("Note:", { bold: true })],
    formatting: { indentation: { left: 0 } },
  });
const listItem = () =>
  new Paragraph({
    content: [new Run("List body")],
    numbering: { numId: 5, level: 0 },
  });
const indentedProse = () =>
  new Paragraph({
    content: [new Run("Plain indented body")],
    formatting: { indentation: { left: 720 } },
  });

function ctxBody(prev: any, current: any, next: any) {
  return {
    doc: {} as any,
    currentIndex: 1,
    currentElement: current,
    prevElement: prev,
    nextElement: next,
    scope: "body" as const,
  };
}

function ctxCell(prev: any, current: any, next: any, paras: any[]) {
  return {
    doc: {} as any,
    currentIndex: 1,
    currentElement: current,
    prevElement: prev,
    nextElement: next,
    scope: "cell" as const,
    cell: {} as any,
    cellParagraphs: paras,
    cellParaIndex: 1,
    parentTable: {} as any,
  };
}

describe("aboveIndentedBoldColonRule (R1)", () => {
  it("removes a blank above an indented bold-colon paragraph (body)", () => {
    const prev = new Paragraph({ content: [new Run("Some prose")] });
    const ctx = ctxBody(prev, blank(), indentedBoldColon());
    expect(aboveIndentedBoldColonRule.matches(ctx)).toBe(true);
  });

  it("removes a blank above a list-item bold-colon paragraph", () => {
    const prev = new Paragraph({ content: [new Run("Intro text")] });
    const ctx = ctxBody(prev, blank(), listItemBoldColon());
    expect(aboveIndentedBoldColonRule.matches(ctx)).toBe(true);
  });

  it("does NOT match when next is a non-indented bold-colon paragraph", () => {
    const prev = new Paragraph({ content: [new Run("Intro text")] });
    const ctx = ctxBody(prev, blank(), nonIndentedBoldColon());
    expect(aboveIndentedBoldColonRule.matches(ctx)).toBe(false);
  });

  it("does NOT match when current is not blank", () => {
    const prev = new Paragraph({ content: [new Run("Intro text")] });
    const ctx = ctxBody(prev, new Paragraph({ content: [new Run("Not blank")] }), indentedBoldColon());
    expect(aboveIndentedBoldColonRule.matches(ctx)).toBe(false);
  });

  it("fires inside table cells", () => {
    const prev = new Paragraph({ content: [new Run("Cell intro")] });
    const cur = blank();
    const next = indentedBoldColon();
    const paras = [prev, cur, next];
    expect(aboveIndentedBoldColonRule.matches(ctxCell(prev, cur, next, paras))).toBe(true);
  });
});

describe("indentedBoldColonToListItemRule (R2)", () => {
  it("removes blank between indented bold-colon and a following list item", () => {
    const ctx = ctxBody(indentedBoldColon(), blank(), listItem());
    expect(indentedBoldColonToListItemRule.matches(ctx)).toBe(true);
  });

  it("does NOT match when prev is indented but not bold-colon", () => {
    const ctx = ctxBody(indentedProse(), blank(), listItem());
    expect(indentedBoldColonToListItemRule.matches(ctx)).toBe(false);
  });

  it("does NOT match when next is non-list indented prose", () => {
    const ctx = ctxBody(indentedBoldColon(), blank(), indentedProse());
    expect(indentedBoldColonToListItemRule.matches(ctx)).toBe(false);
  });

  it("does NOT match when prev is non-indented bold-colon (existing rule handles that)", () => {
    const ctx = ctxBody(nonIndentedBoldColon(), blank(), listItem());
    expect(indentedBoldColonToListItemRule.matches(ctx)).toBe(false);
  });

  it("fires inside table cells", () => {
    const prev = indentedBoldColon();
    const cur = blank();
    const next = listItem();
    const paras = [prev, cur, next];
    expect(indentedBoldColonToListItemRule.matches(ctxCell(prev, cur, next, paras))).toBe(true);
  });
});

describe("rule registration", () => {
  it("both rules are present in the removalRules export array", async () => {
    const { removalRules } = await import("../rules/removalRules");
    const ids = removalRules.map((r) => r.id);
    expect(ids).toContain("remove-above-indented-bold-colon");
    expect(ids).toContain("remove-indented-bold-colon-to-list-item");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/services/document/blanklines/__tests__/indentedBoldColonRemoval.test.ts`
Expected: FAIL — `Cannot find name 'aboveIndentedBoldColonRule'` / `Cannot find name 'indentedBoldColonToListItemRule'`.

- [ ] **Step 3: Implement R1 and R2 in `removalRules.ts`**

Add the helper import and two new rules to `src/services/document/blanklines/rules/removalRules.ts`. Append both rules to the `removalRules` array directly after `boldColonToIndentedRule`.

Update the existing import block (line 10-14):

```typescript
import {
  isParagraphBlank,
  getEffectiveLeftIndent,
  hasNavigationHyperlink,
  isIndentedBoldColon,
} from "../helpers/paragraphChecks";
```

Insert these two rules immediately after `boldColonToIndentedRule` (after line 226):

```typescript
/**
 * Remove blank line ABOVE an indented bold-colon paragraph.
 *
 * Mirror of additionRules.aboveBoldColonNoIndentRule, which targets the
 * NON-indented case. Indented bold-colon paragraphs (list items or paragraphs
 * with positive left-indent) should sit tight against the line above them.
 */
export const aboveIndentedBoldColonRule: BlankLineRule = {
  id: "remove-above-indented-bold-colon",
  action: "remove",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;
    if (!(ctx.nextElement instanceof Paragraph)) return false;
    return isIndentedBoldColon(ctx.nextElement);
  },
};

/**
 * Remove blank line BETWEEN an indented bold-colon paragraph and a
 * directly-following list item.
 */
export const indentedBoldColonToListItemRule: BlankLineRule = {
  id: "remove-indented-bold-colon-to-list-item",
  action: "remove",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;
    if (!(ctx.prevElement instanceof Paragraph)) return false;
    if (!isIndentedBoldColon(ctx.prevElement)) return false;
    if (!(ctx.nextElement instanceof Paragraph)) return false;
    return !!ctx.nextElement.getNumbering();
  },
};
```

Append both rules to the `removalRules` array at the bottom of the file. Replace the existing array (lines 375-388) with:

```typescript
export const removalRules: BlankLineRule[] = [
  consecutiveBlanksRule,
  aboveHeading1Rule,
  firstLineOfMultiRowCellRule,
  aboveLargeTableRule,
  betweenListItemsRule,
  listItemToIndentedContentRule,
  beforeFirstListItemRule,
  boldColonToIndentedRule,
  aboveIndentedBoldColonRule,
  indentedBoldColonToListItemRule,
  afterTopOfDocHyperlinkRule,
  lastLineInCellRule,
  largeImageLastInCellRule,
  centeredTextToImageRule,
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/services/document/blanklines/__tests__/indentedBoldColonRemoval.test.ts`
Expected: PASS, 11 tests green.

Run the broader blank-line test suite to verify no regression: `npx jest src/services/document/blanklines/`
Expected: all tests pass.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git -c user.name="Austin Jordan" -c user.email="austingjordan@gmail.com" \
  add src/services/document/blanklines/rules/removalRules.ts \
      src/services/document/blanklines/__tests__/indentedBoldColonRemoval.test.ts && \
git -c user.name="Austin Jordan" -c user.email="austingjordan@gmail.com" \
  commit -m "feat(blanklines): remove unwanted blanks around indented bold-colon paragraphs"
```

---

## Task 3: Refactor `applyIndentationRules` to three-case decision tree (Part 2)

**Files:**
- Modify: `src/services/document/blanklines/rules/indentationRules.ts` — replace the body and cell loops in `applyIndentationRules`; delete `findPrecedingListItem` and `findPrecedingListItemInCell`; add `FALLBACK_FIRST_INDENT_TWIPS`.
- Create: `src/services/document/blanklines/__tests__/indentationRulesDecisionTree.test.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/services/document/blanklines/__tests__/indentationRulesDecisionTree.test.ts` with the cases from the spec. The test uses a thin in-memory Document/Paragraph/Table mock that supports the methods `applyIndentationRules` calls (`getBodyElementCount`, `getBodyElementAt`, `getAllTables`, `Table.getRows`, `Row.getCells`, `Cell.getParagraphs`, plus per-paragraph getters / `setLeftIndent`).

```typescript
/**
 * Tests for the three-case indentation decision tree in
 * src/services/document/blanklines/rules/indentationRules.ts.
 *
 * Each test constructs a fake body or a single-cell table, runs
 * applyIndentationRules, and asserts the resulting leftIndent values.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */

jest.mock("docxmlater", () => {
  class MockParagraph {
    private numbering: any;
    private indentLeft: number;
    private text: string;
    constructor(opts: { numbering?: any; indentLeft?: number; text?: string } = {}) {
      this.numbering = opts.numbering ?? null;
      this.indentLeft = opts.indentLeft ?? 0;
      this.text = opts.text ?? "";
    }
    getNumbering() {
      return this.numbering;
    }
    getFormatting() {
      return { indentation: { left: this.indentLeft } };
    }
    getText() {
      return this.text;
    }
    setLeftIndent(v: number) {
      this.indentLeft = v;
      return this;
    }
    // isParagraphBlank reads getContent; we model blank-ness via text === "".
    getContent() {
      return this.text ? [{ getText: () => this.text }] : [];
    }
    getStyle() {
      return "";
    }
    getAlignment() {
      return "left";
    }
    getBookmarksStart() {
      return [];
    }
    getBookmarksEnd() {
      return [];
    }
    getRuns() {
      return [];
    }
  }
  class MockTable {
    constructor(private rows: any[] = []) {}
    getRows() {
      return this.rows;
    }
  }
  return {
    Paragraph: MockParagraph,
    Table: MockTable,
    TableCell: class {},
    Run: class {},
    Hyperlink: class {},
    ImageRun: class {},
    Shape: class {},
    TextBox: class {},
    Field: class {},
    Revision: class {},
  };
});

// detectTypedPrefix is only used by isListElement / removeSmallIndents,
// neither of which the decision-tree tests exercise.
jest.mock("@/services/document/list", () => ({
  detectTypedPrefix: () => ({ prefix: null }),
}));

import { Paragraph, Table } from "docxmlater";
import { applyIndentationRules } from "../rules/indentationRules";

function makeDoc(bodyEls: any[], tables: any[] = []) {
  return {
    getBodyElementCount: () => bodyEls.length,
    getBodyElementAt: (i: number) => bodyEls[i],
    getAllTables: () => tables,
  } as any;
}

function makeCell(paras: any[]) {
  return { getParagraphs: () => paras };
}

const TWIPS_PER_INCH = 1440;

const listSettings = {
  listBulletSettings: {
    indentationLevels: [
      { level: 0, textIndent: 0.5 },
      { level: 1, textIndent: 0.75 },
      { level: 2, textIndent: 1.0 },
    ],
  },
};

describe("applyIndentationRules — Case A (prev is list item)", () => {
  it("snaps indented paragraph after level-0 list item to level-0 text indent", () => {
    const listPara = new Paragraph({ numbering: { numId: 5, level: 0 }, text: "Item one" });
    const indented = new Paragraph({ indentLeft: 9999, text: "Continuation" });
    const doc = makeDoc([listPara, indented]);
    applyIndentationRules(doc, listSettings as any);
    expect(indented.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });

  it("snaps indented paragraph after level-2 list item to level-2 text indent", () => {
    const listPara = new Paragraph({ numbering: { numId: 5, level: 2 }, text: "L2" });
    const indented = new Paragraph({ indentLeft: 9999, text: "Continuation" });
    const doc = makeDoc([listPara, indented]);
    applyIndentationRules(doc, listSettings as any);
    expect(indented.getFormatting().indentation.left).toBe(Math.round(1.0 * TWIPS_PER_INCH));
  });

  it("falls through to Case C when listBulletSettings are not configured", () => {
    const listPara = new Paragraph({ numbering: { numId: 5, level: 0 }, text: "Item" });
    const indented = new Paragraph({ indentLeft: 9999, text: "Continuation" });
    const doc = makeDoc([listPara, indented]);
    applyIndentationRules(doc, {} as any);
    // getTextIndentForLevel returns null → falls through to Case C → 0.5" fallback.
    expect(indented.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });
});

describe("applyIndentationRules — Case B (prev is indented non-list)", () => {
  it("matches prev's left indent (cascade)", () => {
    const first = new Paragraph({ indentLeft: 9999, text: "First" });
    const second = new Paragraph({ indentLeft: 1234, text: "Second" });
    const doc = makeDoc([new Paragraph({ text: "Non-indented intro" }), first, second]);
    applyIndentationRules(doc, listSettings as any);
    // First was Case C → 0.5"; Second matches first via Case B.
    const level0 = Math.round(0.5 * TWIPS_PER_INCH);
    expect(first.getFormatting().indentation.left).toBe(level0);
    expect(second.getFormatting().indentation.left).toBe(level0);
  });

  it("cascades three consecutive indented non-list paragraphs to the same value", () => {
    const a = new Paragraph({ indentLeft: 1111, text: "A" });
    const b = new Paragraph({ indentLeft: 2222, text: "B" });
    const c = new Paragraph({ indentLeft: 3333, text: "C" });
    const doc = makeDoc([new Paragraph({ text: "intro" }), a, b, c]);
    applyIndentationRules(doc, listSettings as any);
    const level0 = Math.round(0.5 * TWIPS_PER_INCH);
    expect(a.getFormatting().indentation.left).toBe(level0);
    expect(b.getFormatting().indentation.left).toBe(level0);
    expect(c.getFormatting().indentation.left).toBe(level0);
  });
});

describe("applyIndentationRules — Case C (no list, no indented prev)", () => {
  it("snaps a lone indented paragraph (first body element) to level-0", () => {
    const lone = new Paragraph({ indentLeft: 9999, text: "Lone" });
    const doc = makeDoc([lone]);
    applyIndentationRules(doc, listSettings as any);
    expect(lone.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });

  it("snaps indented paragraph after a blank to level-0 (blanks do not bridge)", () => {
    const blank = new Paragraph({ text: "" }); // blank
    const indented = new Paragraph({ indentLeft: 9999, text: "Body" });
    const doc = makeDoc([new Paragraph({ text: "intro" }), blank, indented]);
    applyIndentationRules(doc, listSettings as any);
    expect(indented.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });

  it("snaps indented paragraph after a Table to level-0", () => {
    const tbl = new Table([]);
    const indented = new Paragraph({ indentLeft: 9999, text: "After table" });
    const doc = makeDoc([tbl, indented], [tbl]);
    applyIndentationRules(doc, listSettings as any);
    expect(indented.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });

  it("falls back to hard-coded 0.5\" when no listBulletSettings provided", () => {
    const lone = new Paragraph({ indentLeft: 9999, text: "Lone" });
    const doc = makeDoc([lone]);
    applyIndentationRules(doc, {} as any);
    expect(lone.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });
});

describe("applyIndentationRules — skip list items themselves", () => {
  it("does not modify list-item paragraphs", () => {
    const listPara = new Paragraph({
      numbering: { numId: 5, level: 0 },
      indentLeft: 5000,
      text: "Item",
    });
    const doc = makeDoc([listPara]);
    applyIndentationRules(doc, listSettings as any);
    expect(listPara.getFormatting().indentation.left).toBe(5000);
  });
});

describe("applyIndentationRules — cells", () => {
  it("applies the decision tree inside a table cell", () => {
    const intro = new Paragraph({ text: "Cell intro" });
    const indented = new Paragraph({ indentLeft: 9999, text: "Indented inside cell" });
    const cell = makeCell([intro, indented]);
    const table = new Table([{ getCells: () => [cell] }]);
    const doc = makeDoc([table], [table]);
    applyIndentationRules(doc, listSettings as any);
    expect(indented.getFormatting().indentation.left).toBe(Math.round(0.5 * TWIPS_PER_INCH));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/services/document/blanklines/__tests__/indentationRulesDecisionTree.test.ts`
Expected: FAIL — at minimum the Case-C tests fail because the existing implementation returns 0 (early-return) when `listBulletSettings` is missing, and the cascade Case-B test fails because the existing code maps prev-indented → level-0 directly (no propagation from prev's normalized value).

- [ ] **Step 3: Replace `applyIndentationRules` with the three-case decision tree**

Open `src/services/document/blanklines/rules/indentationRules.ts`. Make these edits:

**Edit A** — add the fallback constant near the existing `SMALL_INDENT_THRESHOLD_TWIPS` (around line 22-23):

```typescript
/** Fallback indent for Case C when no level-0 textIndent is configured (0.5"). */
const FALLBACK_FIRST_INDENT_TWIPS = Math.round(0.5 * TWIPS_PER_INCH);
```

**Edit B** — delete `findPrecedingListItem` (lines 123-147) and `findPrecedingListItemInCell` (lines 149-171). They are no longer used.

**Edit C** — replace the entire `applyIndentationRules` function (lines 217-312) with this decision-tree implementation:

```typescript
/**
 * Apply the indentation decision tree to every non-list, non-blank
 * indented paragraph in the document body and inside each table cell.
 *
 * For each such paragraph N (indent > 0):
 *   Case A: immediate prev is a list item              → match list level's text indent
 *   Case B: immediate prev is indented non-list        → match prev's left indent
 *   Case C: otherwise (blank, non-indented, Table, …)  → snap to level-0 text indent
 *                                                        (fallback 0.5" if not configured)
 *
 * Forward iteration ensures Case B observes Case C's normalization
 * from earlier iterations — three consecutive indented paragraphs all
 * settle on the same value via C → B → B.
 */
export function applyIndentationRules(doc: Document, options: BlankLineProcessingOptions): number {
  let fixed = 0;

  const level0 = getLevel0TextIndent(options) ?? FALLBACK_FIRST_INDENT_TWIPS;

  // Body
  for (let i = 0; i < doc.getBodyElementCount(); i++) {
    const element = doc.getBodyElementAt(i);
    if (!(element instanceof Paragraph)) continue;
    if (isParagraphBlank(element)) continue;
    if (element.getNumbering()) continue;

    const indent = element.getFormatting()?.indentation?.left;
    if (!indent || indent <= 0) continue;

    const prev = i > 0 ? doc.getBodyElementAt(i - 1) : undefined;

    let target: number | null = null;

    if (prev instanceof Paragraph && !isParagraphBlank(prev)) {
      const prevNumbering = prev.getNumbering();
      if (prevNumbering) {
        // Case A
        const levelTarget = getTextIndentForLevel(options, prevNumbering.level ?? 0);
        if (levelTarget !== null) target = levelTarget;
      } else {
        const prevIndent = prev.getFormatting()?.indentation?.left;
        if (prevIndent && prevIndent > 0) {
          // Case B
          target = prevIndent;
        }
      }
    }

    if (target === null) {
      // Case C
      target = level0;
    }

    if (target !== indent) {
      element.setLeftIndent(target);
      fixed++;
    }
  }

  // Cells
  for (const table of doc.getAllTables()) {
    for (const row of table.getRows()) {
      for (const cell of row.getCells()) {
        const paras = cell.getParagraphs();
        for (let ci = 0; ci < paras.length; ci++) {
          const para = paras[ci];
          if (!para) continue;
          if (isParagraphBlank(para)) continue;
          if (para.getNumbering()) continue;

          const indent = para.getFormatting()?.indentation?.left;
          if (!indent || indent <= 0) continue;

          const prev = ci > 0 ? paras[ci - 1] : undefined;

          let target: number | null = null;

          if (prev && !isParagraphBlank(prev)) {
            const prevNumbering = prev.getNumbering();
            if (prevNumbering) {
              const levelTarget = getTextIndentForLevel(options, prevNumbering.level ?? 0);
              if (levelTarget !== null) target = levelTarget;
            } else {
              const prevIndent = prev.getFormatting()?.indentation?.left;
              if (prevIndent && prevIndent > 0) {
                target = prevIndent;
              }
            }
          }

          if (target === null) {
            target = level0;
          }

          if (target !== indent) {
            para.setLeftIndent(target);
            fixed++;
          }
        }
      }
    }
  }

  if (fixed > 0) {
    log.info(`Fixed indentation on ${fixed} paragraphs`);
  }

  return fixed;
}
```

Note: `getTextIndentForLevel` and `getLevel0TextIndent` (lines 176-205 in the existing file) stay unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/services/document/blanklines/__tests__/indentationRulesDecisionTree.test.ts`
Expected: PASS — all 10+ tests green.

Run the broader suite for regressions: `npx jest src/services/document/blanklines/`
Expected: every test in the package passes.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git -c user.name="Austin Jordan" -c user.email="austingjordan@gmail.com" \
  add src/services/document/blanklines/rules/indentationRules.ts \
      src/services/document/blanklines/__tests__/indentationRulesDecisionTree.test.ts && \
git -c user.name="Austin Jordan" -c user.email="austingjordan@gmail.com" \
  commit -m "refactor(blanklines): three-case decision tree for indent normalization"
```

---

## Final verification

After all three tasks land:

- [ ] **Run the full Jest suite**

Run: `npx jest`
Expected: no new failures introduced by these commits. Pre-existing quarantined / skipped tests remain in their prior state.

- [ ] **Typecheck**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Review the diff**

Run: `git log --oneline -3` and `git diff HEAD~3 -- src/services/document/blanklines/`. Expected: three commits, surface matches the file map at the top of this plan.

Done.
