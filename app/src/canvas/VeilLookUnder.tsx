import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { veilKey, type Veil } from "../map/veils";
import { usePlane } from "./CanvasPlane";
import {
  counterScale,
  lookUnderAnchor,
  lookUnderLabel,
} from "./veilRules";

interface VeilLookUnderProps {
  /** The veil whose cover is lifted, as the record stands right now. */
  veil: Veil;
  /**
   * Rename this veil in place (PROVISIONAL, the loops' idiom): one line
   * rewritten, the box and the reason untouched. The record module owns the
   * mint; this card only asks for the new name.
   */
  onRename?: (name: string) => void;
  /** Esc, the card's ×, a press away, or a level switch. */
  onClose: () => void;
}

/**
 * The look-under (Epic 9 story 2, ADR-0023 decision 3): a READ-ONLY transient
 * that shows the opened veil's coined NAME and its prose REASON while the
 * cover's words read normally underneath.
 *
 * It is opened by the person — a quiet press on the sheet — and never on its
 * own: nothing here surfaces the veil unasked. It is not an editor: the covered
 * words cannot be edited through it (the veil is RETIRED to work there, and the
 * lift's CSS takes no press), and the reason is the person's prose shown
 * verbatim (World B) — never trimmed, parsed, searched or re-stated. The one
 * act besides the read and the close is the PROVISIONAL rename of the VEIL's
 * name (double-click, the loops' idiom); the box and the reason stay exactly as
 * they were.
 *
 * The close idioms are the window's (never its card look): Esc, the quiet ×, a
 * press away, or a level switch. Opening moves focus into the card; a dismissal
 * returns it to the veil's sheet, a switch to the level control. The card is
 * world-anchored at the veil's right edge and COUNTER-SCALED against the camera
 * (the window idiom), so it stays readable at every band. A press inside is
 * content — the raw mousedown stop keeps the plane from panning under it — and
 * a press on the opened veil's own area is not "away": the sheet and its lifted
 * words are the subject of the reading, not a dismissal.
 *
 * Provisional: the card's look, its anchor and the rename field (ADR-0023's
 * own list; the story marks the transient's look and the counter-scale values).
 */
export function VeilLookUnder({ veil, onRename, onClose }: VeilLookUnderProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(veil.name);
  const doneRef = useRef(false);

  // Opening moves focus into the card (the window's rule).
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Esc closes the look-under. While the rename field is open its own Esc
  // cancels the rename (and stops the event), so the card survives: the loops'
  // idiom, not a double close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Click-away in the capture phase (d3-zoom stops the press at the plane, so a
  // bubble-phase listener would never hear it). A press inside the card is not
  // away, and neither is a press on the OPENED veil's own sheet: that area is
  // what is being read. A press on ANOTHER veil's sheet is away (and that
  // sheet's own press opens its look-under in the same breath).
  useEffect(() => {
    const sheetSelector = '[data-veil="' + veilKey(veil) + '"]';
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      const target = e.target;
      if (root && target instanceof Node && root.contains(target)) return;
      if (target instanceof Element && target.closest(sheetSelector)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [veil, onClose]);

  // A press inside the card is content, never a plane pan or a plane press
  // (the window's and the coin field's raw listener).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  // The rename field takes focus and its text is selected (the loops' idiom).
  useEffect(() => {
    if (!renaming) return;
    setDraft(veil.name);
    doneRef.current = false;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [renaming, veil.name]);

  function beginRename() {
    if (!onRename) return;
    setRenaming(true);
  }

  function commitRename() {
    if (doneRef.current) return;
    doneRef.current = true;
    setRenaming(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== veil.name) onRename?.(trimmed);
  }

  function cancelRename() {
    if (doneRef.current) return;
    doneRef.current = true;
    setRenaming(false);
  }

  function handleRenameKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      // Cancel the rename and keep the reading open: stop the card's own Esc.
      e.preventDefault();
      e.stopPropagation();
      cancelRename();
    }
  }

  const anchor = lookUnderAnchor(veil);

  return (
    <div
      ref={rootRef}
      className="veil-lookunder"
      role="group"
      tabIndex={-1}
      aria-label={lookUnderLabel(veil.name)}
      style={{
        left: anchor.x,
        top: anchor.y,
        transform: "translate(0, -50%) scale(" + counterScale(camera.zoom) + ")",
        transformOrigin: "left center",
      }}
    >
      {renaming ? (
        <input
          ref={nameRef}
          className="veil-lookunder-rename"
          value={draft}
          placeholder="name the veil…"
          aria-label="rename the veil"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleRenameKey}
          onBlur={commitRename}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <button
          type="button"
          className="veil-lookunder-name"
          title="double-click to rename the veil"
          onDoubleClick={(e) => {
            e.stopPropagation();
            beginRename();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            beginRename();
          }}
        >
          {veil.name}
        </button>
      )}
      <div className="veil-lookunder-reason">{veil.reason}</div>
      <button
        type="button"
        className="veil-lookunder-close"
        aria-label="close the look-under"
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
