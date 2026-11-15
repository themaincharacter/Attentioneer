import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Assumption, FoundAssumption } from "../map/assumptions";
import { usePlane } from "./CanvasPlane";
import type { Point } from "./geometry";

interface AssumptionOverlayProps {
  /** World point the quiet card hangs off (never inside the word's box). */
  anchor: Point;
  /** Every claim on this target, in FILE ORDER, with each line's file index. */
  lines: readonly FoundAssumption[];
  /** A short, quiet name for the target the overlay speaks about (aria only). */
  targetLabel: string;
  /** State another claim on the same target (a rival is just another line). */
  onAdd: (text: string) => void;
  /** Revise one line's text in place (edit-convergence is the module's rule). */
  onRevise: (assumption: Assumption, text: string) => void;
  /** Remove one line — ammo, one quiet × per line. */
  onRemove: (assumption: Assumption) => void;
  /** Esc or a press outside: nothing more is written. */
  onClose: () => void;
}

/**
 * The assumptions' quiet overlay (ADR-0012 decision 4, ADR-0016): the claims
 * on one target, in FILE ORDER, each revisable in place, each with its own
 * quiet ×; the bottom field states another claim on the same target (a rival
 * is just the next line, never a second glyph or a panel). Enter commits and
 * keeps the field ready; Esc, a press outside or leaving the field dismisses
 * the card and nothing more is written.
 *
 * THE BLUR RULE (Epic 6 story 3, the residual story 2's pin left): a visible
 * draft must not outlive its pin — if the add field loses focus (a Tab away, a
 * click elsewhere), the draft is discarded and the card closes, exactly as Esc
 * does. Enter is the only commit. A hop to a control INSIDE the card is not
 * leaving: the claim you clicked is still yours to edit. (The SignChoice
 * precedent: Esc/blur discards, Enter commits.)
 *
 * It is an OVERLAY: absolutely positioned in world space and counter-scaled
 * against the camera, so it stays readable at every zoom and never grows the
 * target's box — and so never shifts a wire's anchors. It is content
 * (gates.ts), so no press on it can pan the plane, create anything or start a
 * word gesture; the raw mousedown listener keeps d3-zoom from seeing the press
 * at all (the PlaneMenu lesson). Editing is held by the assumption OBJECT, not
 * its index, so a converging edit elsewhere can never make a press act on the
 * wrong line.
 *
 * Provisional: the card's size, layout and anchoring (ADR-0003's seam).
 */
export function AssumptionOverlay({
  anchor,
  lines,
  targetLabel,
  onAdd,
  onRevise,
  onRemove,
  onClose,
}: AssumptionOverlayProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const editDone = useRef(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Assumption | null>(null);
  const [editDraft, setEditDraft] = useState("");

  useEffect(() => {
    addRef.current?.focus();
  }, []);

  useEffect(() => {
    if (editing === null) return;
    editDone.current = false;
    editRef.current?.focus();
    editRef.current?.select();
  }, [editing]);

  // A converging edit can drop the very line another press had selected; the
  // stale selection would otherwise leave an invisible edit open. Reset it
  // whenever the edited line is no longer among the claims on this target.
  useEffect(() => {
    if (editing === null) return;
    if (lines.some((found) => found.assumption === editing)) return;
    setEditing(null);
  }, [lines, editing]);

  // Click-away in the capture phase (d3-zoom stops the press at the plane, so a
  // bubble-phase listener would never hear it). A press inside is not away.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  // Esc closes the quiet card. The field/edit handlers below stop the event so
  // Esc inside a field cancels that field without also closing the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The press must not pan the plane or count as a plane press (see
  // PlaneMenu.tsx: the child's raw listener is attached before d3's).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  function commitNew() {
    const claim = draft.trim();
    if (!claim) return;
    onAdd(claim);
    setDraft("");
    addRef.current?.focus();
  }

  /**
   * The add field's blur (story 3): leave the field and the draft goes with it
   * — nothing visible outlives the pin. Enter never reaches here (commitNew
   * re-focuses the same field), and a hop to another control inside the card
   * is not leaving, so editing a claim does not discard the new line.
   */
  function handleAddBlur(e: ReactFocusEvent<HTMLInputElement>) {
    const root = rootRef.current;
    if (
      root &&
      e.relatedTarget instanceof Node &&
      root.contains(e.relatedTarget)
    ) {
      return;
    }
    setDraft("");
    onClose();
  }

  function beginEdit(found: FoundAssumption) {
    setEditing(found.assumption);
    setEditDraft(found.assumption.text);
  }

  function commitEdit() {
    if (editDone.current) return;
    editDone.current = true;
    const claim = editDraft.trim();
    const target = editing;
    setEditing(null);
    if (target !== null && claim) onRevise(target, claim);
  }

  function cancelEdit() {
    if (editDone.current) return;
    editDone.current = true;
    setEditing(null);
  }

  function handleEditKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    }
  }

  return (
    <div
      ref={rootRef}
      className="assumption-overlay"
      style={{
        left: anchor.x,
        top: anchor.y,
        transform: `translate(0, -50%) scale(${1 / camera.zoom})`,
        transformOrigin: "left center",
      }}
      role="group"
      aria-label={`assumptions on ${targetLabel}`}
    >
      {lines.map((found) => (
        <div
          className="assumption-line"
          key={`${found.index}\u0000${found.assumption.text}`}
        >
          {editing === found.assumption ? (
            <input
              ref={editRef}
              className="assumption-input"
              value={editDraft}
              aria-label="revise this assumption"
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={handleEditKeyDown}
              onBlur={commitEdit}
            />
          ) : (
            <button
              type="button"
              className="assumption-text"
              title="revise this assumption"
              onClick={(e) => {
                e.stopPropagation();
                beginEdit(found);
              }}
            >
              {found.assumption.text}
            </button>
          )}
          <button
            type="button"
            className="assumption-remove"
            aria-label="remove this assumption"
            title="remove"
            onClick={(e) => {
              e.stopPropagation();
              if (editing === found.assumption) cancelEdit();
              onRemove(found.assumption);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <div className="assumption-line new">
        <input
          ref={addRef}
          className="assumption-input"
          value={draft}
          placeholder="state an assumption…"
          aria-label="state an assumption"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleAddBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitNew();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft("");
              onClose();
            }
          }}
        />
      </div>
      <button
        type="button"
        className="assumption-close"
        aria-label="close the assumptions"
        title="close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
    </div>
  );
}
