/**
 * A CLOCK A TEST CAN MOVE (story 21.0).
 *
 * A run's budget, its cancel grace and every elapsed reading come from one
 * injected clock. Production passes the platform's clock; a test passes this
 * one, so a deadline passes at a stated instant instead of a real one and no
 * ending depends on how fast the machine is. Nothing here fires on its own:
 * only `advance` moves time, and it fires the timers that are then due.
 */

/** The `AcpRunClock` shape a run takes, plus the hand that moves it. */
export interface ManualClock {
  clock: {
    now(): number;
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  /** Move the clock forward and fire every timer now due, in arming order. */
  advance(ms: number): void;
  /** How many timers are still armed (a test can prove one was cleared). */
  armed(): number;
}

export function manualClock(start = 1_000_000): ManualClock {
  let now = start;
  let next = 1;
  const timers = new Map<number, { at: number; fire: () => void }>();
  return {
    clock: {
      now: () => now,
      setTimeout(callback, ms) {
        const handle = next;
        next += 1;
        timers.set(handle, { at: now + ms, fire: callback });
        return handle;
      },
      clearTimeout(handle) {
        timers.delete(handle as number);
      },
    },
    advance(ms) {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(handle);
        timer.fire();
      }
    },
    armed: () => timers.size,
  };
}
