import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Veil, VeilBox } from "../map/veils";
import { usePlane } from "./CanvasPlane";

/**
 * The veil's cover sheet (Epic 9 story 1, ADR-0023). A veil is a NAMED cover:
 * the sheet is the area's fill, and the covered words are set aside by the
 * render-time region test (`coveredWordSlugs`, map/veils.ts) — never by a
 * field on any record, never by a second wash. Sheets stack in FILE ORDER
 * (later on top) because the app renders them in file order.
 *
 * The sheet OWNS its presses (it is content, gates.ts): a press on the cover
 * can never pan the plane, open the creation menu or start a word gesture. The
 * raw mousedown stop is the plane's lesson (d3-zoom stops the event at the
 * plane, so a React handler alone would still let the pan begin).
 *
 * It says nothing about itself: no name, no reason, no count — the veil never
 * surfaces on its own. Its PRESENCE is visible (the fill); the reading is the
 * look-under (Epic 9 story 2) or the ground game's switch. The quiet × retires
 * it: ammo, one click, the line deleted (no tombstone).
 *
 * Provisional: the sheet's look, its stacking and the crossing wires' treatment
 * (ADR-0023's own list).
 */
export function VeilSheet({
  veil,
  onRetire,
}: {
  veil: Veil;
  /** Retire this veil: delete its line (ammo). */
  onRetire: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // The press must not pan the plane or count as a plane press.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  return (
    <div
      ref={rootRef}
      className="veil-sheet"
      role="group"
      aria-label="a veil — this area is set aside"
      style={{
        left: veil.x,
        top: veil.y,
        width: veil.w,
        height: veil.h,
      }}
    >
      <button
        type="button"
        className="veil-retire"
        title="retire this veil"
        aria-label="retire this veil"
        onClick={(e) => {
          e.stopPropagation();
          onRetire();
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * A quiet hint line while the draw-box is armed (the path bar's idiom): what
 * the gesture is, and how it ends. Fixed in screen space, writes nothing, and
 * disappears with the arm. Provisional: the wording and the look.
 */
export function VeilBar() {
  return (
    <div className="veil-bar" role="status">
      <span className="veil-bar-title">veil</span>
      <span className="veil-bar-hint">
        drag a box on empty plane · esc cancels
      </span>
    </div>
  );
}

/**
 * The captured box, drawn in the plane while the coin field asks for its name
 * and reason: the person sees exactly what the arc caught (the box, not the
 * stroke). Content (gates.ts); it reports nothing and takes no press.
 */
export function VeilDraftBox({ box }: { box: VeilBox }) {
  return (
    <div
      className="veil-draft"
      aria-hidden="true"
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
      }}
    />
  );
}

/**
 * The veil's coin field: the name AND the reason, coined together at creation
 * (ADR-0023 decision 1 — the pre-verbal case stays the bare mark). Only the
 * person names a veil, and both must be said: Enter with either field blank
 * keeps the field open and writes nothing (the box is not lost — Esc abandons
 * it). The gesture's gate is still armed while the field asks, so a press can
 * neither pan the plane, open the creation menu nor start a word gesture. The REASON is stored exactly as typed — never trimmed, never read
 * (World B); this surface does not interpret it either.
 *
 * It sits in world space at the captured box's corner and counter-scales
 * against the camera (the window/overlay idiom), so it stays readable at every
 * zoom and never grows anything on the plane. Provisional: its placement, its
 * two single-line fields and its look (ADR-0023).
 */
export function VeilCoinField({
  box,
  onCoin,
  onCancel,
}: {
  /** The captured rectangle the veil will cover. */
  box: VeilBox;
  /** Enter with a name: write the veil with this name and reason. */
  onCoin: (name: string, reason: string) => void;
  /** Esc (or a blank name): nothing is written. */
  onCancel: () => void;
}) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const doneRef = useRef(false);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // The press must not pan the plane or count as a plane press.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  function commit() {
    if (doneRef.current) return;
    // Name AND reason are the coin: with either blank nothing is written and
    // the field stays open (Esc abandons the box instead of losing it).
    if (name.trim() === "") {
      nameRef.current?.focus();
      return;
    }
    if (reason.trim() === "") {
      reasonRef.current?.focus();
      return;
    }
    doneRef.current = true;
    onCoin(name, reason);
  }

  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  return (
    <div
      ref={rootRef}
      className="veil-coinfield"
      role="group"
      aria-label="name a veil and say why"
      style={{
        left: box.x,
        top: box.y,
        transform: `translate(0, 0) scale(${1 / camera.zoom})`,
        transformOrigin: "left top",
      }}
    >
      <input
        ref={nameRef}
        className="veil-coinfield-input"
        value={name}
        placeholder="name the veil…"
        aria-label="name the veil"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      <input
        ref={reasonRef}
        className="veil-reason-input"
        value={reason}
        placeholder="its reason…"
        aria-label="the veil's reason (prose, kept as written)"
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={handleKeyDown}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
