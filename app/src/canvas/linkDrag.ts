import { isGestureArmed, type GestureMode } from "./gates";
import type { Point } from "./geometry";
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
 * STORY 20.3 — A RELEASE ON EMPTY PLANE IS A PLACE TO CREATE. The user's window
 * pass: "should be able to drag out from the wire connector and on release if
 * it's not a card should open the create bubble and proceed that way with the
 * automatic hookup in place." So the drag now resolves to one of two things:
 * the ordered pair it always was (released on a card), or a CREATE REQUEST at
 * the release point, carrying the card the drag began from as the hookup. The
 * bubble that opens there does the creating, through the app's one creation
 * path, and the wire follows through the one link path; a cancel writes
 * nothing. That is generic by construction: any card with a handle can start
 * the drag, and any card the bubble can make can end it.
 *
 * OUT OF SCOPE (a later story): the shortlist's reshape — a wire that ends in
 * an UNKNOWN, a bracketed hole. This release always ends in a real created card
 * or in nothing.
 *
 * It is a raw mousedown path because d3-zoom stops the event at the plane
 * (stopImmediatePropagation): a React synthetic handler never fires there. A
 * release on the card itself or Esc cancels and writes nothing; the layer's
 * writer owns the write and its refusal.
 */
export interface GroundLinkDragDeps {
  /** The plane's armed tool; no wiring drag starts while a gesture is armed. */
  interactionMode: GestureMode;
  /** The layer's one write path; absent means the handle should not act. */
  onLink?: (from: string, to: string) => Promise<unknown> | unknown;
  /** The gesture chip's one sentence, optional outside the layer. */
  onNarrate?: (gesture: GestureNarration) => void;
  /**
   * STORY 20.3 — the plane's own pointer-to-world conversion (geometry.ts's
   * clientToWorld, handed down by the layer). Absent means a release on empty
   * paper asks for nothing: a bubble needs a place to stand.
   */
  toWorld?: (clientX: number, clientY: number) => Point | null;
  /**
   * STORY 20.3 — a release on empty plane: open the create bubble at that
   * plane point, already hooked to the card the drag began from. Nothing is
   * written here — the bubble's own create writes the card, and the wire is
   * the gesture's one result.
   */
  onCreateFromLink?: (from: string, at: Point) => void;
}

/**
 * STORY 20.3 — WHAT A RELEASED WIRE DRAG ASKED FOR. Over a card it is the
 * ordered pair a wire always was; on empty plane it is a CREATE REQUEST at the
 * release point, carrying the drag's source as the hookup.
 *
 * PROVISIONAL: the shape and its two `kind` names.
 */
export type GroundLinkRelease =
  | { kind: "link"; from: string; to: string }
  | { kind: "create"; from: string; at: Point };

/**
 * THE RELEASE RULE, pure and in one place: the slug of the card the pointer was
 * released on (null when no ground card is under it) and the release point in
 * the plane's coordinates (null when it could not be read). A card is the
 * release's meaning, exactly as it was; the source card itself is not a pair. A
 * card without a slug is not a place to put anything, so it resolves to
 * nothing rather than to a create.
 */
export function resolveGroundLinkRelease(
  from: string,
  under: string | null,
  at: Point | null,
): GroundLinkRelease | null {
  if (under !== null) {
    return under === from ? null : { kind: "link", from, to: under };
  }
  if (at === null) return null;
  return { kind: "create", from, at };
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
    // The plane point is read only when there is no card to end on: a pair
    // needs no place, and the conversion runs once, at the release.
    const at =
      slug === null ? (deps.toWorld?.(ev.clientX, ev.clientY) ?? null) : null;
    const release = resolveGroundLinkRelease(from, slug, at);
    if (release === null) return;
    if (release.kind === "link") {
      void writer(from, release.to);
      return;
    }
    deps.onCreateFromLink?.(release.from, release.at);
  };
  window.addEventListener("mouseup", onLinkUp);
  window.addEventListener("keydown", onLinkKey);
  return true;
}
