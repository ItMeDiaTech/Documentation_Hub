/**
 * Pure orphan-level computation for body-level list sequences.
 *
 * Extracted from WordDocumentProcessor.normalizeOrphanBodyListLevels so the
 * algorithm can be unit-tested without constructing a Document. The caller
 * classifies each body element into an OrphanLevelEvent; this module decides
 * which list items are orphans (start at ilvl >= 1 with no ilvl=0 sibling)
 * and what level they should shift to.
 */

/**
 * One body-level element, classified for orphan-level analysis.
 * - `list`  — a list paragraph (its numId + ilvl)
 * - `text`  — a non-list paragraph containing visible text
 * - `blank` — an empty / whitespace-only paragraph
 * - `break` — a structural boundary: a non-paragraph element, or a list
 *             paragraph that is protected (HLP / row-number) and must not
 *             participate in shifting
 */
export type OrphanLevelEvent =
  | { kind: "list"; numId: number; level: number }
  | { kind: "text" }
  | { kind: "blank" }
  | { kind: "break" };

/**
 * Compute orphan-level shifts for a body-level element sequence.
 *
 * Returns a Map from the input index of a `list` event to its new ilvl,
 * containing only entries whose level actually changes. Pure — no mutation.
 *
 * Rules (mirror of the original in-place implementation):
 * - List paragraphs are grouped into contiguous runs of the same numId.
 * - A run is shifted only when it is a genuine orphan: its numId has NO
 *   ilvl=0 item anywhere in the body (`globalMin > 0`). A numId with a
 *   level-0 item elsewhere keeps its deeper items as intentional sub-items.
 * - A run is also left alone when the immediately preceding list item is
 *   shallower than the run's minimum — a cross-numId sub-list nested under
 *   the previous list.
 * - The shift amount is the numId's body-wide minimum, so every run of the
 *   same orphan list shifts equally.
 */
export function computeOrphanBodyListShifts(
  events: readonly OrphanLevelEvent[]
): Map<number, number> {
  const result = new Map<number, number>();

  // First pass: minimum level per numId across all list events.
  const globalMinByNumId = new Map<number, number>();
  for (const ev of events) {
    if (ev.kind !== "list") continue;
    const prev = globalMinByNumId.get(ev.numId);
    globalMinByNumId.set(ev.numId, prev === undefined ? ev.level : Math.min(prev, ev.level));
  }

  type RunItem = { index: number; numId: number; level: number };
  let currentRun: RunItem[] = [];
  let currentNumId: number | null = null;
  // Level of the last list item before the current run — used to detect
  // intentional nesting across numId boundaries.
  let previousListLevel: number | null = null;
  let blankGapCount = 0;

  const flushRun = () => {
    if (currentRun.length === 0) return;

    let minLevel = Infinity;
    for (const item of currentRun) {
      minLevel = Math.min(minLevel, item.level);
    }

    if (minLevel > 0 && minLevel !== Infinity) {
      const runNumId = currentRun[0]!.numId;
      const listGlobalMin = globalMinByNumId.get(runNumId) ?? minLevel;
      const isOrphanList = listGlobalMin > 0;
      const intentionalNesting = previousListLevel !== null && previousListLevel < minLevel;

      if (isOrphanList && !intentionalNesting) {
        for (const item of currentRun) {
          const newLevel = item.level - listGlobalMin;
          if (newLevel !== item.level) {
            result.set(item.index, newLevel);
          }
        }
      }
    }

    previousListLevel = currentRun[currentRun.length - 1]!.level;
    blankGapCount = 0;
    currentRun = [];
    currentNumId = null;
  };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;

    if (ev.kind === "break" || ev.kind === "text") {
      flushRun();
      previousListLevel = null;
      blankGapCount = 0;
      continue;
    }

    if (ev.kind === "blank") {
      flushRun();
      blankGapCount++;
      // A single blank line between list runs is tolerated; two or more
      // signal a real separation and clear the cross-numId nesting context.
      if (blankGapCount > 1) previousListLevel = null;
      continue;
    }

    // ev.kind === "list"
    if (ev.numId !== currentNumId) {
      flushRun();
      currentNumId = ev.numId;
    }
    currentRun.push({ index: i, numId: ev.numId, level: ev.level });
  }

  flushRun();
  return result;
}
