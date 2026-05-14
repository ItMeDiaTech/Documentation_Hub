/**
 * Tests for src/services/document/helpers/paragraphRuns.ts
 *
 * Covers what the helper ACTUALLY does (per Task 7):
 *   - Filters runs inside w:del / w:moveFrom revisions out of para.getRuns().
 *   - Recovers hyperlink-child runs nested inside those revisions by walking
 *     Revision.getContent() one level deep (Revision.getRuns() filters those
 *     out via isRunContent).
 *   - Insert / moveTo revisions are preserved.
 *   - getBodyRuns also excludes hyperlink-child runs that live directly under
 *     the paragraph.
 *
 * NOTE: DocXMLater's Hyperlink exposes getRun() (singular) — not getContent()
 * or getRuns(). The helper relies on that. Tests must too.
 *
 * MOCK STRATEGY: We partially mock docxmlater so isHyperlink/isRevision —
 * which are real `instanceof` checks against the library's Hyperlink and
 * Revision classes — remain callable but use a marker-symbol fallback to
 * recognize our plain-object fixtures.
 */

const HYPERLINK_MARKER = Symbol.for("__test_hyperlink__");
const REVISION_MARKER = Symbol.for("__test_revision__");

jest.mock("docxmlater", () => {
  return {
    __esModule: true,
    isHyperlink: (x: any) => !!x && x[HYPERLINK_MARKER] === true,
    isRevision: (x: any) => !!x && x[REVISION_MARKER] === true,
    // Real classes are unused by the helper — provide empty stand-ins so
    // the import resolves and any incidental `instanceof` checks return
    // false (which is fine — our type guards are the ones above).
    Hyperlink: class {},
    Revision: class {},
    Run: class {},
    Paragraph: class {},
  };
});

import type { Run, Paragraph, Hyperlink, Revision } from "docxmlater";
import { getBodyRuns, getVisibleRuns } from "../paragraphRuns";

// ─── Fixtures ────────────────────────────────────────────────────────

function makeRun(label = "run"): Run {
  return { _label: label } as unknown as Run;
}

function makeHyperlink(child: Run): Hyperlink {
  const hl: any = {
    [HYPERLINK_MARKER]: true,
    getRun: jest.fn().mockReturnValue(child),
  };
  return hl as Hyperlink;
}

function makeRevision(
  type: "delete" | "moveFrom" | "insert" | "moveTo",
  runs: Run[],
  content?: any[]
): Revision {
  const rev: any = {
    [REVISION_MARKER]: true,
    getType: jest.fn().mockReturnValue(type),
    getRuns: jest.fn().mockReturnValue(runs),
    // Default: Revision content mirrors runs (no nested hyperlinks)
    getContent: jest.fn().mockReturnValue(content ?? runs),
  };
  return rev as Revision;
}

function makeParagraph(opts: { content: any[]; runs: Run[] }): Paragraph {
  return {
    getContent: jest.fn().mockReturnValue(opts.content),
    getRuns: jest.fn().mockReturnValue(opts.runs),
  } as unknown as Paragraph;
}

// ─── getVisibleRuns ──────────────────────────────────────────────────

describe("getVisibleRuns", () => {
  it("fast-path: no revisions → returns para.getRuns() unchanged", () => {
    const r1 = makeRun("a");
    const r2 = makeRun("b");
    const para = makeParagraph({ content: [r1, r2], runs: [r1, r2] });

    expect(getVisibleRuns(para)).toEqual([r1, r2]);
  });

  it("filters runs inside a delete revision", () => {
    const kept = makeRun("kept");
    const deletedRun = makeRun("deleted");
    const delRevision = makeRevision("delete", [deletedRun]);
    const para = makeParagraph({
      content: [kept, delRevision],
      runs: [kept, deletedRun],
    });

    expect(getVisibleRuns(para)).toEqual([kept]);
  });

  it("filters runs inside a moveFrom revision", () => {
    const kept = makeRun("kept");
    const moved = makeRun("moved");
    const mfRevision = makeRevision("moveFrom", [moved]);
    const para = makeParagraph({
      content: [kept, mfRevision],
      runs: [kept, moved],
    });

    expect(getVisibleRuns(para)).toEqual([kept]);
  });

  it("preserves runs inside an insert revision", () => {
    const kept = makeRun("kept");
    const inserted = makeRun("inserted");
    const insRevision = makeRevision("insert", [inserted]);
    const para = makeParagraph({
      content: [kept, insRevision],
      runs: [kept, inserted],
    });

    // Insert revisions are NOT filtered — Revision.getRuns() never reached.
    expect(getVisibleRuns(para)).toEqual([kept, inserted]);
  });

  it("preserves runs inside a moveTo revision", () => {
    const kept = makeRun("kept");
    const movedTo = makeRun("movedTo");
    const mtRevision = makeRevision("moveTo", [movedTo]);
    const para = makeParagraph({
      content: [kept, mtRevision],
      runs: [kept, movedTo],
    });

    expect(getVisibleRuns(para)).toEqual([kept, movedTo]);
  });

  it("recovers hyperlink-child run from deleted revision (one-level walk)", () => {
    // Revision.getRuns() excludes hyperlink runs (isRunContent filter),
    // so the helper must walk Revision.getContent() to pick up the
    // Hyperlink's getRun() child.
    const kept = makeRun("kept");
    const hyperlinkChild = makeRun("hyperlinkChild");
    const hyperlink = makeHyperlink(hyperlinkChild);
    // Revision.getRuns() yields nothing — the run is reachable only via
    // the nested Hyperlink content.
    const delRevision = makeRevision("delete", [], [hyperlink]);

    const para = makeParagraph({
      content: [kept, delRevision],
      // para.getRuns() includes the hyperlink child (its full flat list)
      runs: [kept, hyperlinkChild],
    });

    expect(getVisibleRuns(para)).toEqual([kept]);
  });

  it("handles multiple delete revisions with mixed direct + hyperlink runs", () => {
    const kept = makeRun("kept");
    const deletedDirect = makeRun("deletedDirect");
    const deletedHyperlinkChild = makeRun("deletedHyperlinkChild");
    const deletedHyperlink = makeHyperlink(deletedHyperlinkChild);
    const delRevision = makeRevision(
      "delete",
      [deletedDirect],
      [deletedDirect, deletedHyperlink]
    );

    const para = makeParagraph({
      content: [kept, delRevision],
      runs: [kept, deletedDirect, deletedHyperlinkChild],
    });

    expect(getVisibleRuns(para)).toEqual([kept]);
  });
});

// ─── getBodyRuns ──────────────────────────────────────────────────────

describe("getBodyRuns", () => {
  it("returns visible runs untouched when no hyperlink children at top level", () => {
    const r1 = makeRun("a");
    const r2 = makeRun("b");
    const para = makeParagraph({ content: [r1, r2], runs: [r1, r2] });

    expect(getBodyRuns(para)).toEqual([r1, r2]);
  });

  it("excludes top-level hyperlink-child runs", () => {
    const direct = makeRun("direct");
    const hyperlinkChild = makeRun("hyperlinkChild");
    const hyperlink = makeHyperlink(hyperlinkChild);
    const para = makeParagraph({
      content: [direct, hyperlink],
      // para.getRuns() in real docxmlater returns hyperlink children too
      runs: [direct, hyperlinkChild],
    });

    expect(getBodyRuns(para)).toEqual([direct]);
  });

  it("excludes both deleted-revision runs and hyperlink children", () => {
    const direct = makeRun("direct");
    const hyperlinkChild = makeRun("hyperlinkChild");
    const hyperlink = makeHyperlink(hyperlinkChild);
    const deletedRun = makeRun("deleted");
    const delRevision = makeRevision("delete", [deletedRun]);
    const para = makeParagraph({
      content: [direct, hyperlink, delRevision],
      runs: [direct, hyperlinkChild, deletedRun],
    });

    expect(getBodyRuns(para)).toEqual([direct]);
  });

  it("returns empty array when paragraph contains only a hyperlink", () => {
    const hyperlinkChild = makeRun("hyperlinkChild");
    const hyperlink = makeHyperlink(hyperlinkChild);
    const para = makeParagraph({
      content: [hyperlink],
      runs: [hyperlinkChild],
    });

    expect(getBodyRuns(para)).toEqual([]);
  });
});
