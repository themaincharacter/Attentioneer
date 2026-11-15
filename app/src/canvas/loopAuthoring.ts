/**
 * Loop authoring's pure rule (Epic 4 story 3, ADR-0012/0015/0016): the gate's
 * `path` mode collects the words of a cycle IN ORDER. A click appends the word;
 * clicking the FIRST word again closes the path — so a 2-cycle is A, B, A and a
 * self-loop is A, A (click the word, click it again). Esc cancels everything and
 * nothing is written.
 *
 * The closed path is handed to `nameLoop` (`map/loops.ts`) with the coined
 * name, and that module rotates it canonically. This module is DOM-free so the
 * click rules are asserted without a window; the canvas owns the pixels.
 *
 * Provisional: the gesture's feel (the first word's closing affordance, no
 * numerals on collected words) is ADR-0003/0016's rendering seam.
 */

/** The word slugs collected so far, and whether the coin field is asking. */
export interface PathSession {
  /** `collecting` = clicks keep adding; `naming` = the path is closed. */
  kind: "collecting" | "naming";
  /** The slugs clicked so far, in order (closed only while naming). */
  path: string[];
}

/** Arm the gate: an empty path, waiting for the first word. */
export function beginPathSession(): PathSession {
  return { kind: "collecting", path: [] };
}

/** Esc (or a level switch): the session is gone and nothing was written. */
export function endPathSession(): null {
  return null;
}

/**
 * One click on a word. While collecting, a click appends the word in order;
 * clicking the path's first word closes it (a 2-cycle becomes A,B,A; a
 * self-loop becomes A,A). Once the path is closed (the coin field is asking),
 * further clicks are inert — the walk is the person's claim and the coin is the
 * next thing.
 */
export function clickPathWord(
  session: PathSession,
  slug: string,
): PathSession {
  if (session.kind !== "collecting") return session;
  const path = [...session.path, slug];
  if (session.path.length >= 1 && session.path[0] === slug) {
    return { kind: "naming", path };
  }
  return { kind: "collecting", path };
}

/** Is this session's path closed and ready to be named? */
export function pathIsClosed(session: PathSession): boolean {
  return (
    session.kind === "naming" &&
    session.path.length >= 2 &&
    session.path[0] === session.path[session.path.length - 1]
  );
}

/**
 * The coin field's Enter: the name to write, or null when it is blank (an empty
 * coin writes nothing — only the person names a loop). The record itself is
 * `nameLoop`'s; this keeps the empty-name rule pure.
 */
export function loopNameFromCoin(draft: string): string | null {
  const trimmed = draft.trim();
  return trimmed === "" ? null : trimmed;
}
