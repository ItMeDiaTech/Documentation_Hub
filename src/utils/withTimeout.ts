/**
 * Wraps a promise with a timeout. If the underlying promise supports
 * AbortSignal (e.g. fetch, our IPC wrapper), prefer the AbortController
 * variant below for true cancellation.
 *
 * For opaque promises, this race version is correct but does not cancel
 * the loser of the race — the original promise stays alive until it
 * naturally resolves, holding any closure references with it.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`${operation} timed out after ${ms}ms`)),
        ms
      );
    }),
  ]);
}

/**
 * AbortController-backed variant. The provided async function receives an
 * AbortSignal; it MUST forward the signal to its underlying I/O for
 * cancellation to work.
 */
export async function withAbortableTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  operation: string
): Promise<T> {
  const controller = new AbortController();
  const timer = AbortSignal.timeout(ms);
  const onTimer = () =>
    controller.abort(timer.reason ?? new Error(`${operation} timed out after ${ms}ms`));
  timer.addEventListener("abort", onTimer, { once: true });
  try {
    return await fn(controller.signal);
  } finally {
    timer.removeEventListener("abort", onTimer);
  }
}
