import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  formatAmount,
  parseAmountInput,
  type Quantity,
} from "../map/quantities";
import { usePlane } from "./CanvasPlane";
import type { Point } from "./geometry";

interface QuantityOverlayProps {
  /** World point the quiet card hangs off (never inside the target's box). */
  anchor: Point;
  /** A short, quiet name for what the card speaks about (aria only). */
  targetLabel: string;
  /** The line already on this target, or null when there is none. */
  line: Quantity | null;
  /** Commit the typed amount (null = the visible unknown the person saved). */
  onCommit: (amount: number | null) => void;
  /** Remove the line — ammo, one quiet × (only offered when a line exists). */
  onRemove: () => void;
  /** Esc, a press outside or leaving the field: nothing more is written. */
  onClose: () => void;
}

/**
 * The quantity's quiet amount card (ADR-0020, Epic 8 story 1): ONE field, the
 * amount exactly as the person types it. Enter commits — a number is the stated
 * amount, a BLANK field commits the line with NO amount (the visible unknown
 * that is reachable by deliberately leaving it out; the card never writes 0 in
 * its place). Esc, a press outside or leaving the field discards the draft and
 * writes nothing.
 *
 * A negative or unreadable entry is REFUSED, never clamped: the card keeps its
 * field open, marks it quietly and writes nothing, because clamping to 0 would
 * silently author a number the person did not state (World B).
 *
 * The card is an OVERLAY like the assumption overlay: absolutely positioned in
 * world space and counter-scaled against the camera, so it stays readable at
 * every zoom and never grows the target's box. It is content (gates.ts); the
 * raw mousedown listener keeps d3-zoom from seeing the press at all.
 *
 * Provisional: the card's size, layout and anchoring (ADR-0003's seam); the
 * amount's display formatting is map/quantities.ts's provisional rule.
 */
export function QuantityOverlay({
  anchor,
  targetLabel,
  line,
  onCommit,
  onRemove,
  onClose,
}: QuantityOverlayProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const [draft, setDraft] = useState(
    line !== null && line.amount !== null ? formatAmount(line.amount) : "",
  );
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Click-away in the capture phase (d3-zoom stops the press at the plane, so a
  // bubble-phase listener would never hear it). A press inside is not away.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      if (doneRef.current) return;
      doneRef.current = true;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  // Esc closes the card and discards the draft; nothing is written.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (doneRef.current) return;
      doneRef.current = true;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The press must not pan the plane or count as a plane press (the PlaneMenu
  // lesson: this raw listener is attached before d3's).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  /**
   * Enter: a blank field is the unknown line (no amount, never 0); a valid
   * number is the stated amount; anything else is refused and the field stays
   * open. A commit that states the same amount as the line writes nothing.
   */
  function commit() {
    if (doneRef.current) return;
    const parsed = parseAmountInput(draft);
    if (!parsed.ok) {
      setRefused(true);
      inputRef.current?.focus();
      return;
    }
    doneRef.current = true;
    if (line !== null && line.amount === parsed.amount) {
      onClose();
      return;
    }
    onCommit(parsed.amount);
  }

  /**
   * Leaving the field discards the draft and closes the card (Esc's reading,
   * the assumption-overlay precedent). A hop to a control INSIDE the card is
   * not leaving it, so the × stays pressable.
   */
  function handleBlur(e: ReactFocusEvent<HTMLInputElement>) {
    const root = rootRef.current;
    if (
      root &&
      e.relatedTarget instanceof Node &&
      root.contains(e.relatedTarget)
    ) {
      return;
    }
    if (doneRef.current) return;
    doneRef.current = true;
    onClose();
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (doneRef.current) return;
      doneRef.current = true;
      onClose();
    }
  }

  return (
    <div
      ref={rootRef}
      className={`quantity-overlay${refused ? " refused" : ""}`}
      style={{
        left: anchor.x,
        top: anchor.y,
        transform: `translate(0, -50%) scale(${1 / camera.zoom})`,
        transformOrigin: "left center",
      }}
      role="group"
      aria-label={`quantity on ${targetLabel}`}
    >
      <div className="quantity-line">
        <span className="quantity-target" aria-hidden="true">
          amount
        </span>
        <input
          ref={inputRef}
          className="quantity-input"
          value={draft}
          placeholder="leave empty for unknown"
          aria-label={`amount on ${targetLabel} — leave empty for unknown`}
          onChange={(e) => {
            setDraft(e.target.value);
            setRefused(false);
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      </div>
      {line !== null && (
        <div className="quantity-state">
          {line.amount === null ? (
            <span className="quantity-unknown">unknown</span>
          ) : (
            <span className="quantity-amount">{formatAmount(line.amount)}</span>
          )}
          <button
            type="button"
            className="quantity-remove"
            aria-label="remove this quantity"
            title="remove"
            onClick={(e) => {
              e.stopPropagation();
              if (doneRef.current) return;
              doneRef.current = true;
              onRemove();
            }}
          >
            ×
          </button>
        </div>
      )}
      <button
        type="button"
        className="quantity-close"
        aria-label="close the amount"
        title="close"
        onClick={(e) => {
          e.stopPropagation();
          if (doneRef.current) return;
          doneRef.current = true;
          onClose();
        }}
      >
        ×
      </button>
    </div>
  );
}
