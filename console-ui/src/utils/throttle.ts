/**
 * A stateful leading+trailing throttle (console#252): coalesces a burst of
 * SSE-driven refresh triggers (e.g. several `record.accepted` events in
 * quick succession) into at most one fetch per `minIntervalMs`, while still
 * guaranteeing a trailing fire for the LATEST trigger once the window
 * elapses — a plain trailing-only debounce would let a continuous stream of
 * events push the fetch out indefinitely, which a throttle does not.
 *
 * Pure and timer-free by design: `shouldFireNow`/`msUntilReady` are plain
 * clock math (an injectable `now()` makes them trivially unit-testable —
 * see test/throttle.test.ts), and the caller (a React effect) owns the
 * actual `setTimeout` for the trailing edge — see
 * `hooks/useThrottledRefresh.ts`.
 */
export class Throttle {
  private lastFiredAt: number | null = null;

  constructor(private readonly minIntervalMs: number, private readonly now: () => number = Date.now) {}

  /**
   * Should the caller act immediately for a trigger arriving right now?
   * Records the fire time as a side effect when it returns true.
   */
  shouldFireNow(): boolean {
    const t = this.now();
    if (this.lastFiredAt === null || t - this.lastFiredAt >= this.minIntervalMs) {
      this.lastFiredAt = t;
      return true;
    }
    return false;
  }

  /** Ms remaining until the throttle window since the last fire elapses (never negative). */
  msUntilReady(): number {
    if (this.lastFiredAt === null) return 0;
    return Math.max(0, this.minIntervalMs - (this.now() - this.lastFiredAt));
  }

  /** Record a trailing fire (call once the scheduled trailing timer actually runs). */
  markFired(): void {
    this.lastFiredAt = this.now();
  }
}
