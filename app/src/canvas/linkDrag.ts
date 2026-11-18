import { isGestureArmed, type GestureMode } from "./gates";
import { GESTURE_IDLE, type GestureNarration } from "./gestureWord";

/**
 * STORY 17.9 — THE WIRING DRAG, in one place, for every ground card.
 *
 * Story 16.5 put the link handle only on reference cards: a wire's endpoints
 * were references and nothing else. The user's correction makes ANYTHING a wire
 * touches context for an ask card, so an ask card and a session card must be
 * able to be a wire's source too. The drag's rule itself is unchanged — press
 * the small edge handle, release on the card under the pointer, one ordered
 * pair — so this module is the ONE copy of it and the three card components
 * only hand it their slug.
 *
 * It is a raw mousedown path because d3-zoom stops the event at the plane
 * (stopImmediatePropagation): a React synthetic handler never fires there. A
 * release on empty paper, on the card itself, or Esc cancels and writes
 * nothing; the layer's writer owns the write and its refusal.
 */
export interface GroundLinkDragDeps {
  /** The plane's armed tool; no wiring drag starts while a gesture is armed. */
  interactionMode: GestureMode;
  /** The layer's one write path; absent means the handle should not act. */
  onLink?: (from: string, to: string) => Promise<unknown> | unknown;
  /** The gesture chip's one sentence, optional outside the layer. */
  onNarrate?: (gesture: GestureNarration) => void;
}

/**
 * START the drag from a card's handle. Returns false when no drag began (an
 * armed tool or no writer), so the caller can fall through to its own press
 * rules.
 */
export function startGroundLinkDrag(
  event: MouseEvent,
  from: string,
  deps: GroundLinkDragDeps,
): boolean {
  const writer = deps.onLink;
  if (isGestureArmed(deps.interactionMode) || writer === undefined) {
    return false;
  }
  event.preventDefault();
  deps.onNarrate?.({ kind: "wiring" });
  let cancelled = false;
  const finish = () => {
    window.removeEventListener("mouseup", onLinkUp);
    window.removeEventListener("keydown", onLinkKey);
    deps.onNarrate?.(GESTURE_IDLE);
  };
  const onLinkKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    cancelled = true;
    finish();
  };
  const onLinkUp = (ev: MouseEvent) => {
    finish();
    if (cancelled) return;
    // Element-under-pointer, never nearest-card math: the drag names the card
    // it was actually released on (the ring-bind idiom, ADR-0016).
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const card =
      under instanceof Element
        ? under.closest(".ground-reference, .ask-card, .session-card")
        : null;
    const slug = card === null ? null : card.getAttribute("data-slug");
    if (slug === null || slug === from) return;
    void writer(from, slug);
  };
  window.addEventListener("mouseup", onLinkUp);
  window.addEventListener("keydown", onLinkKey);
  return true;
}
