/**
 * Tests for src/utils/withTimeout.ts
 *
 * Covers the race-based withTimeout (the timer must be cleared when the
 * inner promise resolves first so no stale reject fires) and the
 * AbortController-backed withAbortableTimeout (the signal must abort
 * on timeout).
 */

import { withTimeout, withAbortableTimeout } from "../withTimeout";

describe("withTimeout (race)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves with the inner value before timeout fires", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "op")).resolves.toBe(42);
  });

  it("rejects with timeout error when inner exceeds ms", async () => {
    const never = new Promise<never>(() => {
      /* never resolves */
    });
    const result = withTimeout(never, 500, "fetch");
    // Suppress unhandled-rejection noise before we await
    result.catch(() => undefined);
    jest.advanceTimersByTime(501);
    await expect(result).rejects.toThrow("fetch timed out after 500ms");
  });

  it("does not fire a stale reject after fast resolution", async () => {
    const onReject = jest.fn();
    await withTimeout(Promise.resolve("ok"), 1000, "op").catch(onReject);
    // Advance well past the original timeout — the cleanup in .finally()
    // must have cleared the setTimeout, so nothing fires.
    jest.advanceTimersByTime(2000);
    // Flush microtasks just in case
    await Promise.resolve();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("propagates inner rejection without waiting for timeout", async () => {
    const failure = Promise.reject(new Error("inner-fail"));
    await expect(withTimeout(failure, 1000, "op")).rejects.toThrow("inner-fail");
  });
});

describe("withAbortableTimeout", () => {
  // Use real timers — AbortSignal.timeout is environment-managed.
  it("forwards signal to inner and aborts on timeout", async () => {
    let abortFired = false;
    const promise = withAbortableTimeout(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              abortFired = true;
              reject(new Error("aborted"));
            },
            { once: true }
          );
        }),
      50,
      "op"
    );
    await expect(promise).rejects.toThrow();
    expect(abortFired).toBe(true);
  });

  it("resolves with inner value when work completes before timeout", async () => {
    const result = await withAbortableTimeout(
      async () => "done",
      1000,
      "op"
    );
    expect(result).toBe("done");
  });
});
