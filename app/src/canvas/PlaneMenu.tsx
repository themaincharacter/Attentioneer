import { useEffect, useRef } from "react";
import { usePlane } from "./CanvasPlane";
import type { CreationKind } from "./gates";

interface PlaneMenuProps {
  /** Plane point the menu is anchored to; its center dot sits exactly there. */
  x: number;
  y: number;
  /**
   * The kinds to OFFER (ADR-0011, ADR-0016): word and lack at Level 1; Level 2
   * grows the third, `assumption`, at a bare spot.
   *
   * DEPRECATED (hidden 2026-11-16 per user review): the offer is now
   * `["word"]` (gates.ts's `offeredCreationKinds`), so this default names
   * only the word and BOTH other choices below stay written but unrendered —
   * delete the hidden choices in the deprecated sweep.
   */
  kinds?: readonly CreationKind[];
  /** Coin a word at the point — the in-place coin field takes over. */
  onWord: () => void;
  /** Cast a bare open mark (a lack) at the point — the quiet ring. */
  onLack: () => void;
  /** State an assumption about the bare spot — the quiet text field opens. */
  onAssumption?: () => void;
  /** Dismiss without creating anything (Esc or a press outside the ring). */
  onClose: () => void;
}

/**
 * The double-click creation menu (Epic 3 feedback): a small floating bubble
 * cluster at the plane point with two quiet choices — coin a word, or cast a
 * bare lack. Story 2's single-click cast is gone; creation begins only here,
 * so a stray click can no longer leave a mark behind. Level 2 grows a third
 * quiet choice below them — state an assumption about this bare spot
 * (ADR-0011's open decision, ADR-0016) — and Level 1 renders exactly as before.
 *
 * DEPRECATED (hidden 2026-11-16 per user review): the person played with the
 * app and asked for the concept layer simplified — double-clicking a spot
 * offers ONLY the word option. The `lack` bubble and the Level 2
 * `assumption` bubble keep their code, their handlers and their CSS, and are
 * simply not offered (gates.ts's `offeredCreationKinds`); the menu now paints
 * the one word bubble on the anchor dot. Delete the hidden choices in the
 * deprecated sweep.
 *
 * The cluster is two frosted warm-white bubbles hanging off an inked anchor
 * dot (word above, lack below, each on a hairline stem), so it reads as a
 * small menu floating over the paper plane rather than a slab on it. The dot
 * marks the exact anchor. It lives inside `.plane-inner`, so it follows the
 * map the way the coin fields do and renders above words and wires; it
 * counter-scales against the camera so a choice stays readable at every zoom.
 * Esc or a press anywhere outside dismisses it; both choices are real buttons,
 * reachable by Tab and activated by Enter or Space. The raw mousedown listener
 * keeps the press from reaching d3-zoom (no pan) and the plane's press counter
 * (the d3-zoom discipline in ringDrag.ts). The opening pop and hover lift are
 * look-only; reduced motion collapses them.
 */
export function PlaneMenu({
  x,
  y,
  // DEPRECATED (hidden 2026-11-16 per user review): the default offer was
  // Level 1's pair (word and lack); the review hides the lack, so the default
  // names the word alone — delete in the deprecated sweep.
  kinds = ["word"],
  onWord,
  onLack,
  onAssumption,
  onClose,
}: PlaneMenuProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLButtonElement>(null);

  // Focus the first choice on open: keyboard users can act immediately. The
  // focus ring is drawn only for keyboard focus (:focus-visible).
  useEffect(() => {
    wordRef.current?.focus();
  }, []);

  // Click-away in the capture phase: d3-zoom stops propagation on the plane's
  // mousedown, so a bubble-phase document listener would never hear a plane
  // press. A press inside the cluster is not an away-press.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  // Esc dismisses; nothing is written.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Raw listener: the press must not pan the plane or count as a plane press.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  // DEPRECATED (hidden 2026-11-16 per user review): with the lack (and the
  // assumption) hidden, the cluster is ONE bubble above the dot, so the dot is
  // no longer the cluster's centre. The whole cluster lifts by the bubble's
  // half-height plus the gap, keeping the DOT on the exact plane point. The
  // arithmetic is provisional (a 30px bubble and a 9px gap, halved); delete
  // with the hidden choices in the deprecated sweep.
  const singleChoiceLift = kinds.length <= 1 ? 19.5 : 0;

  return (
    <div
      ref={rootRef}
      className={`plane-menu${kinds.length <= 1 ? " plane-menu-single" : ""}`}
      style={{
        left: x,
        top: y,
        // The plane-inner is scaled by the camera; undo that so the bubble
        // cluster stays readable screen-size while its anchor dot stays on the
        // plane point (the dot is the root's centre, so scaling about that
        // centre keeps it there).
        transform: `translate(-50%, -50%) translateY(${-singleChoiceLift}px) scale(${1 / camera.zoom})`,
      }}
      role="group"
      aria-label="create at this point"
    >
      <button
        ref={wordRef}
        type="button"
        className="plane-menu-option"
        aria-label="coin a word here"
        title="coin a word here"
        onClick={onWord}
      >
        word
      </button>
      <span className="plane-menu-dot" aria-hidden="true" />
      {/* DEPRECATED (hidden 2026-11-16 per user review): the ring menu's
          `lack` choice opened the bare open mark at the point. The review asked
          for the menu to offer ONLY the word option, so the choice is not
          rendered; its code, the bare ring's cast and `map/marks.jsonl` all
          stay — delete in the deprecated sweep. */}
      {kinds.includes("lack") && (
        <button
          type="button"
          className="plane-menu-option"
          aria-label="cast a lack here"
          title="cast a lack here"
          onClick={onLack}
        >
          lack
        </button>
      )}
      {/* Level 2's third kind (ADR-0011's open decision, ADR-0016): state an
          assumption about this bare spot. Rendered only when the level offers
          it, so Level 1's menu is exactly the word/lack pair it always was.
          DEPRECATED (hidden 2026-11-16 per user review): the dynamics game's
          third kind is no longer offered — the menu shows only the word
          option; the record and its overlay stay — delete in the deprecated
          sweep. */}
      {kinds.includes("assumption") && onAssumption && (
        <button
          type="button"
          className="plane-menu-option plane-menu-third"
          aria-label="state an assumption about this spot"
          title="state an assumption about this spot"
          onClick={onAssumption}
        >
          assumption
        </button>
      )}
    </div>
  );
}
