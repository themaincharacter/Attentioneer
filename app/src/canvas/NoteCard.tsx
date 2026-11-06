import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Note } from "../lib/notes";
import { usePlane } from "./CanvasPlane";
import { noteBand } from "./zoomBands";

interface NoteCardProps {
  note: Note;
  onChange: (note: Note) => void;
}

/** Screen pixels of movement before a click becomes a drag. */
const DRAG_THRESHOLD = 3;

interface DragState {
  pointerX: number;
  pointerY: number;
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  moved: boolean;
}

/**
 * A working note on the canvas (ADR-0003): create/edit in-card, drag to
 * reposition, click to center at readable zoom, title-only below the collapse
 * band (zoomBands). Provisional scaffolding — becomes a Reference node in Epic 2.
 */
export function NoteCard({ note, onChange }: NoteCardProps) {
  const { camera, centerOn } = usePlane();
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<DragState | null>(null);

  // Unsaved drafts open in edit mode so the user coins the name first.
  const [editing, setEditing] = useState(note.slug === null);
  const [draft, setDraft] = useState({ title: note.title, body: note.body });
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // One write per edit session (Escape and blur can both try to commit).
  const pendingCommit = useRef(note.slug === null);

  useEffect(() => {
    if (!editing) return;
    // Focus the name field for a fresh note, the body when re-editing.
    (note.title ? bodyRef.current : titleRef.current)?.focus();
  }, [editing, note.title]);

  // A raw listener: d3-zoom stops mouse events at the plane, so React's
  // synthetic onMouseDown never fires. Re-registered every render on purpose
  // (the handler needs fresh camera and note values).
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    el.addEventListener("mousedown", handleMouseDown);
    return () => el.removeEventListener("mousedown", handleMouseDown);
  });

  const band = noteBand(camera.zoom);
  const x = dragPos ? dragPos.x : note.x;
  const y = dragPos ? dragPos.y : note.y;

  function commit() {
    if (!pendingCommit.current) return;
    pendingCommit.current = false;
    setEditing(false);
    if (note.slug === null || draft.title !== note.title || draft.body !== note.body) {
      onChange({ ...note, title: draft.title, body: draft.body });
    }
  }

  function center() {
    const el = cardRef.current;
    if (!el) return;
    centerOn(note.x + el.offsetWidth / 2, note.y + el.offsetHeight / 2, 1);
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation(); // the plane never pans from inside a card
    if (editing) return;

    const state: DragState = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      fromX: note.x,
      fromY: note.y,
      x: note.x,
      y: note.y,
      moved: false,
    };
    dragRef.current = state;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - state.pointerX;
      const dy = ev.clientY - state.pointerY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        state.moved = true;
      }
      if (state.moved) {
        state.x = state.fromX + dx / camera.zoom;
        state.y = state.fromY + dy / camera.zoom;
        setDragPos({ x: state.x, y: state.y });
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
      setDragPos(null);
      if (state.moved) {
        onChange({ ...note, x: state.x, y: state.y });
      } else {
        center();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    e.stopPropagation(); // a card edit is never a plane double-click
    center(); // land at readable zoom before editing
    pendingCommit.current = true;
    setDraft({ title: note.title, body: note.body });
    setEditing(true);
  }

  function handleBlur(e: ReactFocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      commit();
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      commit();
    }
  }

  return (
    <div
      ref={cardRef}
      className={`card${band === "title" && !editing ? " collapsed" : ""}${editing ? " editing" : ""}`}
      style={{ left: x, top: y }}
      onDoubleClick={handleDoubleClick}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {editing ? (
        <div className="card-edit">
          <input
            ref={titleRef}
            value={draft.title}
            placeholder="name it…"
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                bodyRef.current?.focus();
              }
            }}
          />
          <textarea
            ref={bodyRef}
            value={draft.body}
            placeholder="a line of thought…"
            rows={6}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          />
        </div>
      ) : (
        <>
          <h2 className={note.title ? "" : "title-empty"}>{note.title || "…"}</h2>
          {band === "full" && <p>{note.body}</p>}
        </>
      )}
    </div>
  );
}
