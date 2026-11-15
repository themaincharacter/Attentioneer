import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { FoundPointer, Pointer, PointerForm } from "../map/pointers";
import {
  chooserLabel,
  isPointerMarked,
  pointerDraft,
  pointerFormTitle,
  pointerValuePlaceholder,
  POINTER_PICKS,
} from "./pointerRules";
import { usePlane } from "./CanvasPlane";
import type { Point } from "./geometry";

interface PointerChooserProps {
  /** World point the quiet card hangs off (never inside the word's box). */
  anchor: Point;
  /** Every pointer line on this word, in FILE ORDER, with its file index. */
  rows: readonly FoundPointer[];
  /** The word's coined NAME (aria; the slug stays in the records — story 3). */
  name: string;
  /** The open marks' pointer target keys (the per-row ring reads this). */
  markedKeys: ReadonlySet<string>;
  /** Write the add entry's authored form + value. */
  onAdd: (form: PointerForm, value: string) => void;
  /** Replace one line in place (edit-convergence is the module's rule). */
  onEdit: (pointer: Pointer, form: PointerForm, value: string) => void;
  /** Remove one line — ammo, one quiet × per row. */
  onRemove: (pointer: Pointer) => void;
  /** Cast or settle one line's open mark (the ring toggle). */
  onToggleMark: (pointer: Pointer) => void;
  /** Open this line's window (one at a time; story 2's outward look). */
  onOpen: (pointer: Pointer) => void;
  /** Esc, a press outside, or the card's own ×: nothing more is written. */
  onClose: () => void;
}

/**
 * The ground game's quiet chooser (ADR-0017, Epic 5 story 1): a word's reaches
 * OUTSIDE the map, in FILE ORDER, one row per authored pointer line. A row
 * shows its form and its value verbatim, and carries its quiet controls — a
 * ring (cast/settle the open mark on this reach), an edit (reopen the value
 * field; the line is replaced in place, never delete+recast), an open ↗ (story
 * 2: the pointer's window — a read-only glimpse of the open moment) and a
 * remove × (ammo). The open action goes through the app's IPC/JS opener, never
 * a webview link and never a Rust-side bypass.
 *
 * Under the rows sits the "add a pointer" entry. Its FORM PICK STARTS
 * UNPICKED — no pick, no write (World B: the person picks the form, the app
 * never sniffs it from the value) — and the value field appears only after a
 * pick. Enter commits; Enter with nothing chosen, or Esc, discards.
 *
 * It is an OVERLAY: absolutely positioned in world space and counter-scaled
 * against the camera, so it stays readable at every zoom and never grows the
 * word's box (so no wire anchor moves). It joins the gate's content lists, and
 * opening it arms the `pointer` mode: word presses, pan and creation suspend
 * while it is the only live surface. Its raw mousedown listener keeps d3-zoom
 * from seeing a press (the PlaneMenu lesson). Editing is held by the pointer
 * OBJECT, not its index, so a converging edit elsewhere can never make a press
 * act on the wrong line.
 *
 * Provisional: the card's size, layout, anchoring and wording (ADR-0003's
 * seam); the glyphs (the reach handle's ring cue, the form picks).
 */
export function PointerChooser({
  anchor,
  rows,
  name,
  markedKeys,
  onAdd,
  onEdit,
  onRemove,
  onToggleMark,
  onOpen,
  onClose,
}: PointerChooserProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const editDone = useRef(false);
  const [pick, setPick] = useState<PointerForm | null>(null);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<Pointer | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // Opening lands on the add entry's first form pick: the chooser's own door,
  // never a preselected form (nothing is chosen until the person presses one).
  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>(".pointer-pick")?.focus();
  }, []);

  useEffect(() => {
    if (pick === null) return;
    addInputRef.current?.focus();
  }, [pick]);

  useEffect(() => {
    if (editing === null) return;
    editDone.current = false;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editing]);

  // A remove can drop the very line an open edit had selected; the stale edit
  // would otherwise stay invisible. Reset whenever the edited line is gone.
  useEffect(() => {
    if (editing === null) return;
    if (rows.some((found) => found.pointer === editing)) return;
    setEditing(null);
  }, [rows, editing]);

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

  // Esc closes the quiet card. The field handlers below stop the event so Esc
  // inside a field cancels that field without also closing the card.
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

  /** Discard the pending add: nothing was chosen, nothing is written. */
  function resetAdd() {
    setPick(null);
    setValue("");
  }

  function commitAdd() {
    const draft = pointerDraft(pick, value);
    resetAdd();
    if (draft === null) {
      // No pick (or a blank value): Enter discards, nothing is written, and the
      // add entry stays open for the next try.
      rootRef.current?.querySelector<HTMLButtonElement>(".pointer-pick")?.focus();
      return;
    }
    onAdd(draft.form, draft.value);
    // The field goes with the pick; keep the quiet flow on the entry's door.
    rootRef.current?.querySelector<HTMLButtonElement>(".pointer-pick")?.focus();
  }

  function beginEdit(pointer: Pointer) {
    setEditing(pointer);
    setEditDraft(pointer.value);
  }

  function commitEdit() {
    if (editDone.current) return;
    editDone.current = true;
    const next = editDraft;
    const target = editing;
    setEditing(null);
    if (target !== null && next !== "" && next.trim() !== "") {
      onEdit(target, target.form, next);
    }
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

  function handleAddKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    // A form pick button owns its own Enter (its click picks the form).
    if (e.target instanceof Element && e.target.closest("button")) return;
    e.preventDefault();
    // Nothing chosen: Enter discards the pending add; the card stays open.
    resetAdd();
  }

  return (
    <div
      ref={rootRef}
      className="pointer-chooser"
      style={{
        left: anchor.x,
        top: anchor.y,
        transform: "translate(0, -50%) scale(" + 1 / camera.zoom + ")",
        transformOrigin: "left center",
      }}
      role="group"
      aria-label={chooserLabel(name)}
    >
      {rows.map((found) => {
        const pointer = found.pointer;
        const marked = isPointerMarked(pointer, markedKeys);
        return (
          <div
            className="pointer-row"
            // The FILE index keeps two byte-identical hand duplicates distinct
            // rows (they share the key but are two lines).
            key={found.index + "\u0000" + pointer.form + "\u0000" + pointer.value}
          >
            <span className="pointer-form" title={pointerFormTitle(pointer.form)}>
              {pointer.form}
            </span>
            {editing === pointer ? (
              <input
                ref={editInputRef}
                className="pointer-input"
                value={editDraft}
                aria-label="edit this pointer"
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onBlur={commitEdit}
              />
            ) : (
              <button
                type="button"
                className="pointer-value"
                title="edit this pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  beginEdit(pointer);
                }}
              >
                {pointer.value}
              </button>
            )}
            <button
              type="button"
              className="pointer-open"
              aria-label="open this pointer"
              title="open"
              onClick={(e) => {
                e.stopPropagation();
                if (editing === pointer) cancelEdit();
                onOpen(pointer);
              }}
            >
              ↗
            </button>
            <button
              type="button"
              className={"pointer-ring" + (marked ? " open" : "")}
              aria-label={marked ? "settle this reach" : "mark this reach tentative"}
              aria-pressed={marked}
              title={marked ? "settle" : "mark tentative"}
              onClick={(e) => {
                e.stopPropagation();
                if (editing === pointer) cancelEdit();
                onToggleMark(pointer);
              }}
            />
            <button
              type="button"
              className="pointer-remove"
              aria-label="remove this pointer"
              title="remove"
              onClick={(e) => {
                e.stopPropagation();
                if (editing === pointer) cancelEdit();
                onRemove(pointer);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <div
        className="pointer-add"
        role="group"
        aria-label="add a pointer"
        tabIndex={0}
        onKeyDown={handleAddKeyDown}
      >
        <span className="pointer-add-hint">add a pointer</span>
        <div className="pointer-picks">
          {POINTER_PICKS.map((form) => (
            <button
              key={form}
              type="button"
              className={"pointer-pick" + (pick === form ? " picked" : "")}
              aria-pressed={pick === form}
              title={pointerFormTitle(form)}
              onClick={(e) => {
                e.stopPropagation();
                setPick(form);
              }}
            >
              {form}
            </button>
          ))}
        </div>
        {pick !== null && (
          <input
            ref={addInputRef}
            className="pointer-add-input"
            value={value}
            placeholder={pointerValuePlaceholder(pick)}
            aria-label={"a " + pick + " target"}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitAdd();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                resetAdd();
              }
            }}
          />
        )}
      </div>
      <button
        type="button"
        className="pointer-close"
        aria-label="close the pointers"
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
