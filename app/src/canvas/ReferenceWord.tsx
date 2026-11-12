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
import type { Point } from "./geometry";

interface ReferenceWordProps {
  word: Reference;
  /** Where the word sits on the plane right now (live during a drag). */
  position: Point;
  onChange: (word: Reference) => void;
  onDiscard: (word: Reference) => void;
  /** Rename this word (one atomic patch, ADR-0005). */
  onRename: (word: Reference, newName: string) => void;
  /** Remove this word (one atomic delete, ADR-0007). */
  onRemove: (word: Reference) => void;
  /** Begin a distance draw from this word (its slug + anchor point). */
  onConnectFrom: (slug: string, anchor: Point) => void;
  /** Report the live position each frame while dragging, so wires follow. */
  onDragMove: (slug: string, x: number, y: number) => void;
  /** Report the rendered box, so wires can attach to the word's edges. */
  onMeasure: (slug: string, w: number, h: number) => void;
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
 *
 * Dragging is reported upward every animation frame (`onDragMove`) so the
 * word's wires track the pointer instead of snapping on drop.
 */
export function ReferenceWord({
  word,
  position,
  onChange,
  onDiscard,
  onRename,
  onRemove,
  onConnectFrom,
  onDragMove,
  onMeasure,
  connectTarget,
  onDropConnect,
}: ReferenceWordProps) {
  const { camera, centerOn } = usePlane();
  const wordRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const memoryRef = useRef<HTMLTextAreaElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<Point | null>(null);

  const isDraft = word.slug === null;
  const [name, setName] = useState(word.name);
  const [revealing, setRevealing] = useState(false);
  const [memory, setMemory] = useState(word.body);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(word.name);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
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

  // Publish the rendered box so wires can meet the word's edges.
  useEffect(() => {
    const el = wordRef.current;
    if (!el || word.slug === null) return;
    const slug = word.slug;
    const report = () => onMeasure(slug, el.offsetWidth, el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [word.slug, onMeasure]);

  // Cancel a pending frame if the word goes away mid-drag.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const x = dragPos ? dragPos.x : position.x;
  const y = dragPos ? dragPos.y : position.y;

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

  function anchor(): Point {
    const el = wordRef.current;
    if (!el) return { x: position.x, y: position.y };
    return { x: position.x + el.offsetWidth / 2, y: position.y + el.offsetHeight / 2 };
  }

  function center() {
    const el = wordRef.current;
    if (!el) return;
    centerOn(position.x + el.offsetWidth / 2, position.y + el.offsetHeight / 2, 1);
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
      if (word.slug === null) return;
      onConnectFrom(word.slug, anchor());
      return;
    }

    const state: DragState = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      fromX: position.x,
      fromY: position.y,
      x: position.x,
      y: position.y,
      moved: false,
    };
    dragRef.current = state;

    // Coalesce to one update per frame: smoother motion and no layout thrash.
    const flush = () => {
      rafRef.current = null;
      const pending = pendingRef.current;
      if (!pending) return;
      setDragPos(pending);
      if (word.slug !== null) onDragMove(word.slug, pending.x, pending.y);
    };

    const onMove = (ev: MouseEvent) => {
      const px = ev.clientX - state.pointerX;
      const py = ev.clientY - state.pointerY;
      if (!state.moved && (Math.abs(px) > DRAG_THRESHOLD || Math.abs(py) > DRAG_THRESHOLD)) {
        state.moved = true;
        setDragging(true);
      }
      if (!state.moved) return;
      state.x = state.fromX + px / camera.zoom;
      state.y = state.fromY + py / camera.zoom;
      pendingRef.current = { x: state.x, y: state.y };
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = null;
      dragRef.current = null;
      setDragPos(null);
      setDragging(false);
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
    if (!connectTarget || word.slug === null) return;
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

  const transform = `translate3d(${x}px, ${y}px, 0)`;

  if (isDraft) {
    return (
      <div
        ref={wordRef}
        className="word editing"
        style={{ transform }}
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
      data-slug={word.slug ?? undefined}
      className={`word${revealing ? " revealing" : ""}${renaming ? " renaming" : ""}${dragging ? " dragging" : ""}${connectTarget ? " connect-target" : ""}`}
      style={{ transform }}
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