import { useEffect, useRef } from "react";
import { Throttle } from "../utils/throttle";

/**
 * Console#252: runs `onDue()` in response to a changing `trigger` value (an
 * SSE-derived cursor, e.g. `record.accepted` delivery ids), throttled to at
 * most once per `minIntervalMs` — a burst of live events collapses into one
 * refetch instead of one HTTP request per event, while the latest trigger
 * still gets a trailing fire once the window elapses (see `utils/throttle.ts`
 * for the pure, unit-tested logic this wraps).
 *
 * The FIRST render is intentionally a no-op: callers already fire their own
 * initial fetch (mount effect / on view open), so this hook only reacts to
 * SUBSEQUENT trigger changes.
 */
export function useThrottledRefresh(trigger: unknown, minIntervalMs: number, onDue: () => void): void {
  const throttleRef = useRef<Throttle | null>(null);
  if (!throttleRef.current) throttleRef.current = new Throttle(minIntervalMs);
  const timerRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);
  const onDueRef = useRef(onDue);
  onDueRef.current = onDue;

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const throttle = throttleRef.current as Throttle;
    if (throttle.shouldFireNow()) {
      onDueRef.current();
      return;
    }
    pendingRef.current = true;
    if (timerRef.current !== undefined) return; // a trailing timer is already scheduled
    const delay = throttle.msUntilReady();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      if (!pendingRef.current) return;
      pendingRef.current = false;
      throttle.markFired();
      onDueRef.current();
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    []
  );
}
