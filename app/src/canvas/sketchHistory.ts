import type { Sketch } from "../map/sketches";
import type { ErasedStroke } from "./sketchRules";

/**
 * The drawing's UNDO MEMORY (PROVISIONAL, added 2026-11-16 per user review):
 * a small in-memory stack of this session's changes, so UNDO takes back the
 * LAST change — a drawn stroke, exactly as before, or ONE erase gesture (every
 * stroke that gesture took, restored at its ORIGINAL file positions).
 *
 * Nothing here is persisted and nothing is rendered: the stack lives for the
 * session, carries no UI, no counter and no redo, and goes away with the window
 * (it is never a record — the RECORD stays `map/sketches.ts`, and a change is
 * an ordinary rewrite through `saveSketches`). Opening a workspace (or a level
 * switch) starts with an empty stack, and undo then falls back to the family's
 * undo-by-position rule: the last stroke's line goes.
 *
 * The positions are the drawing's OWN indices: a stroke has no natural key
 * (map/sketches.ts), so a file position is the only address it has. A gesture's
 * take is recorded against the drawing it was taken from, and the stack is
 * LIFO, so restoring in ascending position order puts every stroke back exactly
 * where it stood.
 *
 * PROVISIONAL: one gesture = one action, restore-at-original-position, no redo,
 * no history surface, and clear (the quiet ×, "no undo") drops the stack.
 */
export type SketchAction =
  | { readonly kind: "draw"; readonly at: number }
  | { readonly kind: "erase"; readonly removed: readonly ErasedStroke[] };

/** Remember a stroke just appended: it holds the drawing's last position. */
export function recordDraw(
  actions: readonly SketchAction[],
  at: number,
): SketchAction[] {
  return [...actions, { kind: "draw", at }];
}

/**
 * Remember one erase gesture's take. A gesture that took nothing is not a
 * change: the caller never asks (nothing was written), and an empty take is
 * dropped here too rather than becoming a do-nothing undo.
 */
export function recordErase(
  actions: readonly SketchAction[],
  removed: readonly ErasedStroke[],
): SketchAction[] {
  if (removed.length === 0) return [...actions];
  return [...actions, { kind: "erase", removed: [...removed] }];
}

/** What one undo produced: the drawing to write, and the stack left. */
export interface UndoStep {
  actions: SketchAction[];
  sketches: Sketch[];
}

/**
 * Take back the last remembered change, or null when the session remembers
 * none — the caller then falls back to `undoLastSketch` (the drawing's own
 * order rule), which is what a workspace just opened deserves.
 */
export function undoStep(
  actions: readonly SketchAction[],
  sketches: readonly Sketch[],
): UndoStep | null {
  if (actions.length === 0) return null;
  const action = actions[actions.length - 1];
  const rest = actions.slice(0, -1);
  if (action.kind === "erase") {
    return { actions: rest, sketches: restore(sketches, action.removed) };
  }
  // The drawn stroke is still where the pen put it. If the drawing has moved
  // on without it (a hand edit, a reload), the last line's rule stands — the
  // action is never trusted past the drawing's own length.
  const at = action.at;
  if (at < 0 || at >= sketches.length) {
    return { actions: rest, sketches: sketches.slice(0, -1) };
  }
  return {
    actions: rest,
    sketches: [...sketches.slice(0, at), ...sketches.slice(at + 1)],
  };
}

/** Put a gesture's strokes back at the positions they held, in file order. */
function restore(
  sketches: readonly Sketch[],
  removed: readonly ErasedStroke[],
): Sketch[] {
  const next = [...sketches];
  const ascending = [...removed].sort((a, b) => a.at - b.at);
  for (const take of ascending) {
    const at = Math.max(0, Math.min(take.at, next.length));
    next.splice(at, 0, take.stroke);
  }
  return next;
}
