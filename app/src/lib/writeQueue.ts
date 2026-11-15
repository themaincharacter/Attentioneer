/**
 * An in-order write queue (ADR-0004's byte door, ADR-0018's handoff): writes a
 * person can start faster than the disk settles land in the order they made
 * them. `writeMachineFile` is plain file I/O — two read-modify-write passes
 * interleaved would let an older value reappear under a newer one, so a writer
 * that reads a file and writes it back must be queued here.
 *
 * Each task starts only after the previous one settled. A failed write does not
 * stall the queue: the next task still runs (the failure is the caller's to
 * report). Pure apart from the promises it chains — no fs, no React.
 */

/** A serial queue for write tasks. */
export interface WriteQueue {
  /** Queue one write; it runs after every write queued before it. */
  push: (task: () => Promise<void>) => Promise<void>;
  /** Resolves when every task queued so far has settled (never rejects). */
  idle: () => Promise<void>;
}

/**
 * A fresh, empty queue. One queue belongs to one file (the level handoff owns
 * the `workspace.yml` level write), so unrelated files never wait on each
 * other.
 */
export function createWriteQueue(): WriteQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    push(task) {
      const run = tail.then(task);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    idle() {
      return tail.then(() => undefined);
    },
  };
}
