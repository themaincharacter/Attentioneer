/**
 * STORY 24-15 — WHICH CARDS ARE WORKING, without renders.
 *
 * The person's ruling (2026-11-25): a loading signal is "an important signal"
 * the app may be FLASHY about — the one place motion may run while the state
 * lasts (ADR-0043's clarification). The signal crosses the map: a working card
 * glows, and the wires feeding it carry current. So the state has to reach the
 * wires, and — exactly like the drag's live point (groundDragRef) — it must
 * not cost a render per change. The cards PUBLISH, the wires SUBSCRIBE; one
 * channel per mounted map, absent in a render test.
 */
export interface WorkingChannel {
  /** Is this card working right now? */
  is(slug: string): boolean;
  /** A card's work started (true) or ended (false). */
  set(slug: string, on: boolean): void;
  /** Hear every change; the answer removes this listener. */
  subscribe(listener: () => void): () => void;
}

export function createWorkingChannel(): WorkingChannel {
  const live = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    is(slug) {
      return live.has(slug);
    },
    set(slug, on) {
      const was = live.has(slug);
      if (on === was) return;
      if (on) live.add(slug);
      else live.delete(slug);
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
