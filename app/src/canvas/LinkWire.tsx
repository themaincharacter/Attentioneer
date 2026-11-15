import { useEffect, useRef } from "react";
import type { Link } from "../map/links";
import { AssumptionDiamond } from "./AssumptionDiamond";
import { LINK_HEAD_BACK, pointToward, type Point } from "./geometry";
import { useRingMouseDown } from "./ringDrag";

interface LinkWireProps {
  link: Link;
  /** World point on the origin word's edge, already on the pair's canonical side. */
  fromPoint: Point;
  /** World point on the target word's edge, on the same side. */
  toPoint: Point;
  /** True while this link carries an open mark (ADR-0009/0010). */
  marked: boolean;
  /** True when either endpoint is set aside past the shelf's fold (ADR-0010). */
  shelved?: boolean;
  /** Clicking the sign glyph flips it (a double-click counts once). */
  onFlip: () => void;
  /** The × at the head removes the link — ammo, one click (ADR-0012). */
  onRemove: () => void;
  /** Cast or settle this link's open mark. */
  onToggleMark: () => void;
  /**
   * Start a bind drag from this link's open ring (raw mousedown, because
   * d3-zoom stops React's synthetic mouse events — see ringDrag.ts).
   */
  onMarkRingDrag?: (e: MouseEvent) => void;
  /** True when this link's pair carries at least one assumption (story 4). */
  hasAssumptions?: boolean;
  /** Open the link's quiet assumption overlay, anchored beside the head. */
  onOpenAssumptions?: (anchor: Point) => void;
}

/**
 * A signed link renders at Level 2 as its OWN directed wire (ADR-0014's one
 * pair-spine, ADR-0016's canvas): a line offset onto its direction's side of
 * the canonical unordered chord (geometry.ts), a direction cue — the small
 * chevron — at the target edge, and the head cluster just inside it.
 *
 * The head cluster is the link's whole language:
 * - the sign glyph (+ or -) sits at the TARGET head; pressing it flips the
 *   sign in place (a double-click counts once — planePress.ts);
 * - while the link carries an open mark the head shows the UNKNOWN SIGN SLOT
 *   instead: the mark says the sign is unsettled, so no stored sign is drawn
 *   beside the ring (mark precedence to pixels);
 * - the ring casts or settles the mark and drags to bind it elsewhere;
 * - story 4's hollow diamond opens the pair's quiet assumption overlay, and
 *   lives on this directed wire's head, so the pair's direction is simply the
 *   element under the pointer;
 * - the × appears on hover and removes the link (ammo, no confirmation).
 *
 * Level 1 renders none of this: a link is Level 2 content and the level decides
 * (ADR-0016), so concept mode reads exactly as it did before this story.
 *
 * Provisional: the wire offset, the chevron, the head placement and the ring's
 * look (ADR-0003's rendering seam).
 */
export function LinkWire({
  link,
  fromPoint,
  toPoint,
  marked,
  shelved = false,
  onFlip,
  onRemove,
  onToggleMark,
  onMarkRingDrag,
  hasAssumptions = false,
  onOpenAssumptions,
}: LinkWireProps) {
  const headRef = useRef<HTMLDivElement>(null);

  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const head = pointToward(toPoint, fromPoint, LINK_HEAD_BACK);

  // Presses on the head are the head's: never the plane's pan or the plane's
  // press counter. (React's synthetic events never run under d3-zoom.)
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  const handleRingDown = (e: MouseEvent) => {
    e.stopPropagation();
    onMarkRingDrag?.(e);
  };
  const ringRef = useRingMouseDown<HTMLButtonElement>(handleRingDown, marked);

  return (
    <div
      className={`link${marked ? " open" : ""}${shelved ? " shelved" : ""}`}
      data-from={link.from}
      data-to={link.to}
    >
      <div
        className="link-line"
        style={{
          transform: `translate3d(${fromPoint.x}px, ${fromPoint.y}px, 0) rotate(${angle}deg) scaleX(${length})`,
        }}
      />
      {/* A wider invisible band, hit-testable only while a ring is in flight
          (the plane's .ring-picking class): the element-under-pointer pick. */}
      <div
        className="link-hit"
        style={{
          transform: `translate3d(${fromPoint.x}px, ${fromPoint.y}px, 0) rotate(${angle}deg) scaleX(${length})`,
        }}
      />
      <div
        className="link-arrow"
        style={{
          left: toPoint.x,
          top: toPoint.y,
          transform: `translate(-50%, -50%) rotate(${angle + 45}deg)`,
        }}
        aria-hidden="true"
      />
      <div
        ref={headRef}
        className="link-head"
        style={{ left: head.x, top: head.y }}
      >
        <button
          ref={ringRef}
          type="button"
          className={`link-mark${marked ? " open" : ""}`}
          aria-label={marked ? "settle (withdraw the open mark)" : "mark the link's sign unsettled"}
          title={marked ? "settle" : "mark the sign unsettled"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMark();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        />
        {marked ? (
          <span
            className="link-unknown"
            aria-label="sign unsettled"
            title="sign unsettled"
          >
            ?
          </span>
        ) : (
          <button
            type="button"
            className="link-sign"
            aria-label={`flip the sign (now ${link.sign === "+" ? "same direction" : "opposite"})`}
            title="flip the sign"
            onClick={(e) => {
              e.stopPropagation();
              onFlip();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {link.sign}
          </button>
        )}
        {/* Story 4's presence: the hollow diamond in the head cluster opens
            the pair's quiet overlay; the overlay is rendered at App level, so
            the head — and the wire it anchors — never moves. */}
        {onOpenAssumptions && (
          <AssumptionDiamond
            has={hasAssumptions}
            onPress={() =>
              // To the right of the whole head cluster, so the diamond stays
              // reachable while the overlay is open (press it again for a
              // rival) and the card never covers the link's own controls.
              onOpenAssumptions({
                x: head.x + (headRef.current?.offsetWidth ?? 0) / 2 + 12,
                y: head.y,
              })
            }
          />
        )}
        <button
          type="button"
          className="link-remove"
          aria-label="remove link"
          title="remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
