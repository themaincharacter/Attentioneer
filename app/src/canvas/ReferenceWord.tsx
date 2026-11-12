import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Reference } from "../map/refs";
import { usePlane } from "./CanvasPlane";

interface ReferenceWordProps {
  word: Reference;
  onChange: (word: Reference) => void;
  onDiscard: (word: Reference) => void;
  /** Rename this word (one atomic patch, ADR-0005). */
  onRename: (word: Reference, newName: string) => void;
  /** Remove this word (one atomic delete, ADR-0007). */
  onRemove: (word: Reference) => void;
  /** Begin a distance draw from this word (its slug + anchor point). */
  onConnectFrom: (slug: string, anchor: { x: number; y: number }) => void;
  /** True while a draw is in flight and this word is a live drop target. */
  connectTarget: boolean;
  /** Complete a draw onto this word (its slug). */
  onDropConnect: (toSlug: string) => void;
}

/** Screen pixels of movement before a mousedown becomes a drag. */
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
 * A reference rendered as its bare coined word (ADR-0007): drag to place,
 * click to center at readable zoom, the optional memory tucked behind a dot.
 * An uncoined draft (slug null) is the in-place coin field — Enter coins it,
 * Escape dismisses it. Double-clicking the name renames it (story 3), a ×
 * removes it, and a connect handle starts a distance draw.
 */
export function ReferenceWord({
  word,
  onChange,
  onDiscard,
  onRename,
  onRemove,
  onConnectFrom,
  connectTarget,
  onDropConnect,
}: ReferenceWordProps) {
  const { camera, centerOn } = usePlane();
  const wordRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const memoryRef = useRef<HTMLTextAreaElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const isDraft = word.slug === null;
  const [name, setName] = useState(word.name);
  const [revealing, setRevealing] = useState(false);
  const [memory, setMemory] = useState(word.body);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(word.name);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const coinDone = useRef(false);
  const memoryDone = useRef(false);
  const renameDone = useRef(false);

  useEffect(() => {
    if (isDraft) nameRef.current?.focus();
  }, [isDraft]);

  useEffect(() => {
    if (revealing) memoryRef.current?.focus();
  }, [revealing]);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const x = dragPos ? dragPos.x : word.x;
  const y = dragPos ? dragPos.y : word.y;

  function coin() {
    if (coinDone.current) return;
    coinDone.current = true;
    const trimmed = name.trim();
    if (trimmed) {
      onChange({ ...word, name: trimmed });
    } else {
      onDiscard(word);
    }
  }

  function dismiss() {
    if (coinDone.current) return;
    coinDone.current = true;
    onDiscard(word);
  }

  function openMemory() {
    setMemory(word.body);
    memoryDone.current = false;
    setRevealing(true);
  }

  function commitMemory() {
    if (memoryDone.current) return;
    memoryDone.current = true;
    if (memory !== word.body) {
      onChange({ ...word, body: memory });
    }
    setRevealing(false);
  }

  function toggleReveal() {
    if (revealing) {
      commitMemory();
    } else {
      openMemory();
    }
  }

  function beginRename() {
    setRenameValue(word.name);
    renameDone.current = false;
    setRenaming(true);
  }

  function commitRename() {
    if (renameDone.current) return;
    renameDone.current = true;
    setRenaming(false);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== word.name) {
      onRename(word, trimmed);
    }
  }

  function cancelRename() {
    if (renameDone.current) return;
    renameDone.current = true;
    setRenaming(false);
  }

  function anchor() {
    const el = wordRef.current;
    if (!el) return { x: word.x, y: word.y };
    return { x: word.x + el.offsetWidth / 2, y: word.y + el.offsetHeight / 2 };
  }

  function center() {
    const el = wordRef.current;
    if (!el) return;
    centerOn(word.x + el.offsetWidth / 2, word.y + el.offsetHeight / 2, 1);
  }

  // Raw listener: d3-zoom stops mousedown at the plane (stopImmediatePropagation),
  // so React's synthetic onMouseDown never fires. This raw listener, registered
  // before d3 attaches, handles both the word drag and the connect handle.
  useEffect(() => {
    const el = wordRef.current;
    if (!el) return;
    el.addEventListener("mousedown", handleMouseDown);
    return () => el.removeEventListener("mousedown", handleMouseDown);
  });

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation(); // never let the plane pan from inside a word
    if (isDraft || revealing || renaming) return;

    const target = e.target as HTMLElement;
    if (target.closest(".memory-dot")) return;
    if (target.closest(".word-remove")) return;

    // The connect handle starts a distance draw.
    if (target.closest(".connect-handle")) {
      if (!word.slug) return;
      const a = anchor();
      onConnectFrom(word.slug, a);
      return;
    }

    const state: DragState = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      fromX: word.x,
      fromY: word.y,
      x: word.x,
      y: word.y,
      moved: false,
    };
    dragRef.current = state;

    const onMove = (ev: MouseEvent) => {
      const px = ev.clientX - state.pointerX;
      const py = ev.clientY - state.pointerY;
      if (Math.abs(px) > DRAG_THRESHOLD || Math.abs(py) > DRAG_THRESHOLD) {
        state.moved = true;
      }
      if (state.moved) {
        state.x = state.fromX + px / camera.zoom;
        state.y = state.fromY + py / camera.zoom;
        setDragPos({ x: state.x, y: state.y });
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
      setDragPos(null);
      if (state.moved) {
        onChange({ ...word, x: state.x, y: state.y });
      } else {
        center();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onNameDoubleClick(e: ReactMouseEvent<HTMLSpanElement>) {
    e.stopPropagation();
    beginRename();
  }

  function handleDropMouseUp(e: ReactMouseEvent<HTMLDivElement>) {
    if (!connectTarget || !word.slug) return;
    e.stopPropagation();
    onDropConnect(word.slug);
  }

  function handleNameKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      coin();
    } else if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    }
  }

  function handleRenameKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  }

  function handleMemoryKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      commitMemory();
    }
  }

  function handleBlur(e: ReactFocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (isDraft) {
      coin();
    } else if (revealing) {
      commitMemory();
    } else if (renaming) {
      commitRename();
    }
  }

  if (isDraft) {
    return (
      <div
        ref={wordRef}
        className="word editing"
        style={{ left: x, top: y }}
        onBlur={handleBlur}
      >
        <input
          ref={nameRef}
          className="word-coin"
          value={name}
          placeholder="name it…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleNameKeyDown}
        />
      </div>
    );
  }

  return (
    <div
      ref={wordRef}
      className={`word${revealing ? " revealing" : ""}${renaming ? " renaming" : ""}${connectTarget ? " connect-target" : ""}`}
      style={{ left: x, top: y }}
      onBlur={handleBlur}
      onMouseUp={handleDropMouseUp}
    >
      <div className="word-row">
        {renaming ? (
          <input
            ref={renameRef}
            className="word-rename"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
          />
        ) : (
          <span className="word-name" onDoubleClick={onNameDoubleClick}>
            {word.name}
          </span>
        )}
        <button
          type="button"
          className={`memory-dot${word.body ? " has-memory" : ""}`}
          aria-label={word.body ? "memory" : "add memory"}
          onClick={toggleReveal}
        />
        <button
          type="button"
          className="connect-handle"
          aria-label="draw a distance"
          title="drag to another word"
        />
        <button
          type="button"
          className="word-remove"
          aria-label="remove word"
          title="remove (no undo)"
          onClick={() => onRemove(word)}
        >
          ×
        </button>
      </div>
      {revealing && (
        <div className="memory">
          <textarea
            ref={memoryRef}
            value={memory}
            placeholder="memory…"
            onChange={(e) => setMemory(e.target.value)}
            onKeyDown={handleMemoryKeyDown}
          />
        </div>
      )}
    </div>
  );
}