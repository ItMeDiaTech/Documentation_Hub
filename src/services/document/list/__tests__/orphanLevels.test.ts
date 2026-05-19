import { computeOrphanBodyListShifts, type OrphanLevelEvent } from "../orphanLevels";

/** Shorthand event constructors for readable test fixtures. */
const list = (numId: number, level: number): OrphanLevelEvent => ({ kind: "list", numId, level });
const text: OrphanLevelEvent = { kind: "text" };
const blank: OrphanLevelEvent = { kind: "blank" };
const brk: OrphanLevelEvent = { kind: "break" };

describe("computeOrphanBodyListShifts", () => {
  it("returns no shifts for an empty sequence", () => {
    expect(computeOrphanBodyListShifts([]).size).toBe(0);
  });

  it("does not shift a list already starting at level 0", () => {
    const shifts = computeOrphanBodyListShifts([list(1, 0), list(1, 0), list(1, 1)]);
    expect(shifts.size).toBe(0);
  });

  it("shifts a genuine orphan list down to level 0", () => {
    // numId 1 only ever appears at levels 1 and 2 — no level-0 sibling.
    const shifts = computeOrphanBodyListShifts([list(1, 1), list(1, 2)]);
    expect(shifts.get(0)).toBe(0);
    expect(shifts.get(1)).toBe(1);
  });

  it("does NOT flatten a sub-item separated from its level-0 siblings by a text paragraph", () => {
    // The reported bug: "If the MDO..." sub-bullet after a "Note:" line.
    // numId 9 has a level-0 item, so its level-1 item is a real sub-item.
    const shifts = computeOrphanBodyListShifts([
      list(9, 0), // The criteria require responses...
      list(9, 0), // It can be determined...
      text, //       Note: ...
      list(9, 1), // If the MDO does not answer...   <-- must stay at level 1
    ]);
    expect(shifts.size).toBe(0);
  });

  it("shifts every run of a genuine orphan list equally across an interrupting gap", () => {
    // numId 4 is an orphan (min level 1), split by a text paragraph.
    const shifts = computeOrphanBodyListShifts([
      list(4, 1),
      list(4, 2),
      text,
      list(4, 3),
    ]);
    // All shift by the numId's body-wide minimum (1), not each run's local min.
    expect(shifts.get(0)).toBe(0);
    expect(shifts.get(1)).toBe(1);
    expect(shifts.get(3)).toBe(2);
  });

  it("leaves a cross-numId sub-list nested under a shallower preceding list", () => {
    // list M at level 0, then a different numId N at level 1 — intentional nesting.
    const shifts = computeOrphanBodyListShifts([list(10, 0), list(20, 1)]);
    expect(shifts.size).toBe(0);
  });

  it("tolerates a single blank line between a parent list and a nested sub-list", () => {
    // One blank does not clear the cross-numId nesting context.
    const shifts = computeOrphanBodyListShifts([list(10, 0), blank, list(20, 1)]);
    expect(shifts.size).toBe(0);
  });

  it("treats a sub-list after two or more blank lines as an orphan", () => {
    // 2+ blanks clear the nesting context — numId 20 has no level-0 item.
    const shifts = computeOrphanBodyListShifts([list(10, 0), blank, blank, list(20, 1)]);
    expect(shifts.get(3)).toBe(0);
  });

  it("treats a structural break as a hard boundary but still shifts a same-numId orphan", () => {
    const shifts = computeOrphanBodyListShifts([list(5, 1), brk, list(5, 2)]);
    // numId 5 body-wide min is 1 → both runs shift by 1.
    expect(shifts.get(0)).toBe(0);
    expect(shifts.get(2)).toBe(1);
  });

  it("does not flatten a numId reused at a deep level elsewhere (same numId = same list)", () => {
    // numId 7 has a level-0 item, so a later level-3 item of numId 7 is kept.
    // Documents the deliberate trade-off: numId identity wins over proximity.
    const shifts = computeOrphanBodyListShifts([list(7, 0), text, list(7, 3)]);
    expect(shifts.size).toBe(0);
  });

  it("ignores break/text/blank events when keying result indices", () => {
    // Result is keyed by absolute input index, not list-only index.
    const shifts = computeOrphanBodyListShifts([text, list(1, 1), brk, list(1, 2)]);
    expect(shifts.get(1)).toBe(0);
    expect(shifts.get(3)).toBe(1);
    expect(shifts.has(0)).toBe(false);
  });
});
