import { useEffect, useRef } from "react";
import { usePlane } from "./CanvasPlane";
import type { CreationKind } from "./gates";
import { columnCluster, menuCluster, menuTransform } from "./planeMenuRules";

/**
 * STORY 17.10 — ONE DOOR of a bubble menu in the concept map's OWN bubble.
 *
 * The user's correction: "a double click opens a bubble menu and you can select
 * reference or ask." The ground map does not invent a second bubble for that —
 * it hands this component its doors and reuses the same anchor dot, the same
 * stems, the same inverse-camera placement, the same Esc/away-press discipline
 * and the same raw-mousedown guard (see the component's header). A door is an
 * ACTION: the press runs its handler and the menu dismisses; no record is
 * created by being offered.
 */
export interface PlaneDoor {
  /** Stable id, for the class and the key. */
  id: string;
  /** The one quiet word the person presses. */
  label: string;
  /** The sentence the hover (and a screen reader) reads. */
  title: string;
  /**
   * Where the door hangs. The first door may sit ABOVE the dot (the concept
   * menu's word does), all others below it in list order; the geometry keeps
   * the dot exactly on the plane point either way.
   */
  seat?: "above" | "below";
  /** Run the action and dismiss the bubble. */
  onPress: () => void;
}

interface PlaneMenuProps {
  /** Plane point the menu is anchored to; its center dot sits exactly there. */
  x: number;
  y: number;
  /**
   * The kinds to OFFER (ADR-0011, ADR-0016): word and lack at Level 1; Level 2
   * grows the third, `assumption`, at a bare spot.
   *
   * DEPRECATED (hidden 2026-11-16 per user review): the offer is now
   * `["word"]` at concept and EMPTY at dynamics and ground (the separate-maps
   * rule, mapContentRules.ts), so this default names only the word and both
   * other creation choices below stay written but unrendered — delete the
   * hidden choices in the deprecated sweep.
   */
  kinds?: readonly CreationKind[];
  /**
   * STORY 17.10 — THE GROUND MAP'S DOORS. When given, this bubble paints THESE
   * instead of the concept vocabulary: the same component, the same placement,
   * a different list of actions. Absent means the concept menu exactly as it
   * was (word above, the pen below, the deprecated seats if flipped back).
   */
  doors?: readonly PlaneDoor[];
  /** Coin a word at the point — the in-place coin field takes over. */
  onWord?: () => void;
  /** Cast a bare open mark (a lack) at the point — the quiet ring. */
  onLack?: () => void;
  /** State an assumption about the bare spot — the quiet text field opens. */
  onAssumption?: () => void;
  /**
   * ARM THE MAP'S PEN from the bubble (PROVISIONAL, added 2026-11-16 per user
   * review): the review asked for a DRAW choice here, so the map's drawing tool
   * is reachable where a person already is — the point they double-clicked.
   *
   * It is an ACTION, never a creation kind: no `CreationKind` grows (the
   * creation grammar and the ghost's card derivation that reads it keep their
   * shape). The app hands this to its own handler, which runs the one
   * cancel-pending path, selects the strip's PEN explicitly (the eraser stays
   * one press away once armed) and arms the gate's `draw` mode — the same pen
   * the level control's toggle arms. The press dismisses the cluster.
   */
  onDraw?: () => void;
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
 * app and asked for the concept layer simplified — double-clicking a spot no
 * longer offers the bare lack. The `lack` bubble and the Level 2 `assumption`
 * bubble keep their code, their handlers and their CSS, and are simply not
 * offered (gates.ts's `offeredCreationKinds`). Delete the hidden choices in the
 * deprecated sweep.
 *
 * THE PEN JOINS (PROVISIONAL, added 2026-11-16 per user review): the same review
 * asked for a DRAW choice here — the map's drawing tool, where the person
 * already is. `draw` is the second quiet bubble below the anchor dot, in the
 * slot the hidden lack bubble used to hold, and it is an ACTION: the press runs
 * the app's one cancel-pending path, selects the strip's PEN explicitly and arms
 * the gate's `draw` mode (exactly the level control's toggle), then the cluster
 * dismisses. It is NOT a creation kind — the creation grammar keeps its shape —
 * so nothing here creates a record by being offered. Once armed, a double-click
 * can open no bubble at all (gates.ts's `shouldCreate` is false in `draw`, and
 * the pen's capture surface owns the pointer), so the menu cannot re-open under
 * the pen and nothing can double-arm it.
 *
 * THE SEPARATE-MAPS REVISION (DEPRECATED, hidden 2026-11-16 per user review):
 * the word is CONCEPT-MAP CONTENT, so at dynamics and ground the cluster paints
 * the anchor dot and the pen's draw bubble ALONE (gates.ts's
 * `offeredCreationKinds` reads mapContentRules.ts). Coining a word on a map
 * that cannot render it would be a lie; drawing is level-uniform (PROVISIONAL:
 * per-map ink is the later "context" work). The word's button stays written
 * behind `kinds.includes("word")` and the pure cluster geometry already handles
 * every membership, so a flip-back needs no component edit — delete the gated
 * word bubble in the deprecated sweep.
 *
 * The cluster is two frosted warm-white bubbles hanging off an inked anchor dot
 * (the word above, the pen's draw below, each on a hairline stem), so it reads
 * as a small menu floating over the paper plane rather than a slab on it. The
 * dot marks the exact anchor: the column is SYMMETRIC about it, so the lift is
 * zero, and the lift rides inside the inverse-camera scale (planeMenuRules.ts)
 * so the dot stays on the plane point at every zoom. It lives inside
 * `.plane-inner`, so it follows the map the way the coin fields do and renders
 * above words and wires; it counter-scales against the camera so a choice stays
 * readable at every zoom. Esc or a press anywhere outside dismisses it; every
 * choice is a real button, reachable by Tab and activated by Enter or Space.
 * The raw mousedown listener keeps the press from reaching d3-zoom (no pan) and
 * the plane's press counter (the d3-zoom discipline in ringDrag.ts). The opening
 * pop and hover lift are look-only; reduced motion collapses them.
 */
export function PlaneMenu({
  x,
  y,
  // DEPRECATED (hidden 2026-11-16 per user review): the default offer was
  // Level 1's pair (word and lack); the review hides the lack, so the default
  // names the word alone — delete in the deprecated sweep.
  kinds = ["word"],
  doors,
  onWord,
  onLack,
  onAssumption,
  onDraw,
  onClose,
}: PlaneMenuProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLButtonElement>(null);
  const drawRef = useRef<HTMLButtonElement>(null);
  const firstDoorRef = useRef<HTMLButtonElement>(null);

  // Focus the first choice on open: keyboard users can act immediately. The
  // focus ring is drawn only for keyboard focus (:focus-visible).
  //
  // DEPRECATED (hidden 2026-11-16 per user review — separate maps): the word
  // bubble is concept-map content and is not offered at dynamics or ground, so
  // the FIRST PAINTED choice takes focus there — the pen's draw bubble. The
  // fallback keeps the cluster usable wherever the offer narrows to.
  //
  // STORY 17.10: a DOOR list focuses its own first door (the ground map's
  // `ask`), because the concept vocabulary is not painted.
  useEffect(() => {
    if (doors !== undefined) {
      firstDoorRef.current?.focus();
      return;
    }
    (wordRef.current ?? drawRef.current)?.focus();
    // Mount only: this bubble is dismissed by any press, so it never needs to
    // re-grab focus after the person moves through its doors.
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

  // THE CLUSTER AS IT IS PAINTED (planeMenuRules.ts): the lift is the DOT's
  // offset from the cluster's centre, computed from the choices actually
  // offered — the word above, the pen's draw below, plus the DEPRECATED lack
  // and assumption bubbles if their flags are ever flipped back. The word +
  // draw cluster is SYMMETRIC about the dot, so its lift is zero; the
  // single-word cluster this menu painted after the first review needed half a
  // bubble plus the gap, and the same rule still returns that for it.
  // DEPRECATED (hidden 2026-11-16 per user review — separate maps): the word
  // bubble is concept-map content, so the cluster's top seat is read from the
  // OFFER (the word at concept; nothing above the dot at dynamics and ground,
  // where the pen's draw bubble is the only choice). The pure geometry is
  // unchanged — it already computes the lift for any membership.
  // STORY 17.10 — THE DOORS USE THE SAME GEOMETRY. A door list is a column
  // like any other: the above-seated doors, the dot, the below-seated ones, and
  // the dot's lift computed by planeMenuRules.ts so it stays on the plane point.
  const doorList = doors ?? [];
  const doorsAbove = doorList.filter((door) => door.seat === "above");
  const doorsBelow = doorList.filter((door) => door.seat !== "above");
  const cluster =
    doors === undefined
      ? menuCluster({
          word: kinds.includes("word"),
          lack: kinds.includes("lack"),
          assumption: kinds.includes("assumption") && onAssumption !== undefined,
          draw: true,
        })
      : columnCluster(doorsAbove.length, doorsBelow.length);

  /** One door: the concept bubble's own button, with the door's words. */
  const paintDoor = (door: PlaneDoor) => (
    <button
      key={door.id}
      ref={door === doorList[0] ? firstDoorRef : undefined}
      type="button"
      className={"plane-menu-option plane-menu-door plane-menu-door-" + door.id}
      aria-label={door.title}
      title={door.title}
      onClick={door.onPress}
    >
      {door.label}
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={`plane-menu${cluster.total <= 1 ? " plane-menu-single" : ""}`}
      style={{
        left: x,
        top: y,
        // The plane-inner is scaled by the camera; undo that so the bubble
        // cluster stays readable screen-size, and then lift the cluster by the
        // DOT's offset from its centre — inside the inverse scale, so the lift
        // is a screen length and the dot lands on the plane point at every
        // zoom (planeMenuRules.ts).
        transform: menuTransform(cluster.lift, camera.zoom),
      }}
      role="group"
      aria-label={doors === undefined ? "create at this point" : "make at this point"}
    >
      {/* STORY 17.10 — THE GROUND MAP'S DOORS, painted by the concept map's
          own bubble: ask first (the new thing), then the reference doors, then
          session. The door list is the caller's; this component only places
          them around the same anchor dot. */}
      {doors !== undefined && doorsAbove.map(paintDoor)}
      {/* DEPRECATED (hidden 2026-11-16 per user review — separate maps): the
          word bubble is CONCEPT-MAP CONTENT, so it is offered at concept only
          (gates.ts's `offeredCreationKinds` reads mapContentRules.ts's
          `wordCreationOffered`). At dynamics and ground the cluster is the
          anchor dot with the pen's draw bubble below it. The markup, the
          handler and the slot stay written — delete in the deprecated sweep. */}
      {doors === undefined && kinds.includes("word") && (
        <button
          ref={wordRef}
          type="button"
          className="plane-menu-option"
          aria-label="coin a word here"
          title="coin a word here"
          onClick={() => onWord?.()}
        >
          word
        </button>
      )}
      <span className="plane-menu-dot" aria-hidden="true" />
      {doors !== undefined && doorsBelow.map(paintDoor)}
      {/* THE PEN (PROVISIONAL, added 2026-11-16 per user review): the review
          asked for a DRAW choice on this menu, so the map's drawing tool is
          offered where the person already is. It holds the slot the hidden lack
          bubble used to fill — directly below the anchor dot — so the cluster
          stays SYMMETRIC about the dot (word above, draw below; the lift is
          zero) and the dot keeps its exact seat on the plane point. It is an
          ACTION, not a creation kind: pressing it arms the pen (the level
          control's own path) and the cluster dismisses, with the strip's eraser
          one press away once armed. Provisional: the wording ("draw here") and
          this being the second bubble. */}
      {doors === undefined && onDraw !== undefined && (
        <button
          ref={drawRef}
          type="button"
          className="plane-menu-option plane-menu-draw"
          aria-label="draw here"
          title="draw here — arm the pen and drag a stroke"
          onClick={onDraw}
        >
          draw
        </button>
      )}
      {/* DEPRECATED (hidden 2026-11-16 per user review): the ring menu's
          `lack` choice opened the bare open mark at the point. The first review
          asked for the menu to stop offering it (the second review added only
          the pen's draw bubble), so the choice is not rendered; its code, the
          bare ring's cast and `map/marks.jsonl` all stay — delete in the
          deprecated sweep. */}
      {doors === undefined && kinds.includes("lack") && onLack !== undefined && (
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
          it, so the grammar's extra kind still has its slot.
          DEPRECATED (hidden 2026-11-16 per user review): the dynamics game's
          third kind is no longer offered — the cluster paints the word and the
          pen; the record and its overlay stay — delete in the deprecated
          sweep. */}
      {doors === undefined && kinds.includes("assumption") && onAssumption && (
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
