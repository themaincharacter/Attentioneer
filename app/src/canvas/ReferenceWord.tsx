import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Reference } from "../map/refs";
import { AssumptionDiamond } from "./AssumptionDiamond";
import { usePlane } from "./CanvasPlane";
import {
  CROSS_LEVEL_FACES_HIDDEN,
  SHELF_HIDDEN,
  TENTATIVE_MARK_HIDDEN,
} from "./deprecations";
import { QuantityGlyph } from "./QuantityGlyph";
import {
  isGestureArmed,
  shouldStartWordPress,
  type GestureMode,
} from "./gates";
import type { Point } from "./geometry";
import { followTargets, screenPointOf } from "./followRules";
import { reachHandleModifiers } from "./presenceRules";
import { stepAmountText, stepDeltaText } from "./stepNotes";
import type { Level } from "../workspace/level";

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
  /** True while this word carries an open mark (ADR-0009). */
  marked: boolean;
  /** True while this word sits past the shelf's fold — set aside (ADR-0010). */
  shelved: boolean;
  /**
   * True while this word is outside the playing set in dynamics mode (story 1,
   * ADR-0013): dimmed but fully live, and unchanged in concept mode.
   */
  outOfSet?: boolean;
  /**
   * True while a VEIL covers this word (Epic 9 story 1, ADR-0023): the word's
   * CENTRE is inside a veil's box, so the cover sets it aside. This is a
   * position reading, never a record one — no field changes, and the class it
   * wears carries visibility only, so the word's own quiet (pale and dashed
   * when marked, the out-of-set wash) stays exactly what it is. Covered is not
   * settled: retire the veil and the word reads as before.
   */
  covered?: boolean;
  /**
   * True while this word is READ under an opened veil (Epic 9 story 2): its
   * cover is LIFTED for the look-under, so the word reads normally — exactly
   * as it stands (a marked word is still pale, italic and dashed; its
   * out-of-set wash is still the ONE wash). The `covered` prop is unchanged:
   * the lift is a transient's reading, never a record or a settled state. The lifted
   * word also takes no press (the lift's CSS: visibility in, pointer-events
   * out), because covered content is edited by RETIRING the veil to work there.
   */
  lifted?: boolean;
  /** How a gesture is armed right now — the interaction-mode gate (ADR-0016). */
  interactionMode?: GestureMode;
  /**
   * Reject this word: withdraw its open mark and set it aside in one composed
   * move (ADR-0010). Offered only while the word carries an open mark and is
   * not mid-edit, so ordinary coining and dragging are not burdened.
   */
  onReject: () => void;
  /** Cast or settle this word's open mark (story 1's provisional affordance). */
  onToggleMark: () => void;
  /**
   * Start a bind drag from this word's open ring (story 2; raw mousedown,
   * because d3-zoom stops React's synthetic mouse events).
   */
  onMarkRingDrag?: (slug: string, e: MouseEvent) => void;
  /**
   * True at Level 2: the assumption diamond sits in the word's hover row,
   * beside the memory dot (story 4). Level 1 renders no diamond at all, so its
   * markup is exactly what it was.
   */
  showAssumptions?: boolean;
  /** True when this word carries at least one assumption (the diamond reads). */
  hasAssumptions?: boolean;
  /** Open this word's quiet assumption overlay, anchored beside the row. */
  onOpenAssumptions?: (anchor: Point) => void;
  /**
   * The word's STOCK quantity, as one quiet view (Epic 8 story 1, ADR-0020):
   * present at Level 2 only, and null elsewhere so Level 1's markup is exactly
   * what it was. It is a same-band dynamics family (like the diamond), not a
   * cross-band cue; the glyph reads presence only — `has` says a line exists,
   * never what its amount is — and `onOpen` opens the amount card at App level
   * so the word's box (and every wire's anchor) never moves.
   */
  quantity?: { has: boolean; onOpen: (anchor: Point) => void };
  /**
   * The word's RUN read (Epic 8 story 3, ADR-0022): its running amount after
   * the last crank and what that crank moved for it (the signed net delta;
   * null = nothing moved). Level 2 only and only while a run exists, so
   * Level 1's markup is exactly what it was. It hangs BELOW the word as an
   * absolutely positioned line (the follow menu's placement idiom), so the
   * word's box never grows and every wire's anchor holds.
   */
  run?: { amount: number | null; delta: number | null };
  /**
   * True at ground: the word carries ONE quiet reach handle in a fixed slot
   * (Epic 5 story 1). It is always in the row — so the word's box never grows
   * and no wire anchor moves — and CSS reveals it on hover, keyboard focus and
   * while it is focused. Concept and dynamics render no handle at all.
   */
  showReach?: boolean;
  /** True while ANY of this word's pointer lines carries an open mark. */
  reachMarked?: boolean;
  /** Open this word's quiet pointer chooser, anchored beside the row. */
  onOpenPointers?: (anchor: Point) => void;
  /**
   * True when this word carries at least one authored pointer line (ground).
   * The reach handle renders SOLID then and FAINT-but-addable otherwise — the
   * diamond's `has-assumptions` precedent, within the band only (ADR-0019).
   */
  hasPointers?: boolean;
  /** The game running now — the follow control offers the two OTHER games. */
  game?: Level;
  /**
   * Jump to another game's band keeping THIS word under the eye: the shared
   * jump intent, anchored at the word's own screen position (story 3).
   */
  onFollow?: (next: Level, screen: Point) => void;
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
 * removes it, a connect handle starts a distance draw, and the hollow ring
 * casts or settles an open mark (ADR-0009; story 1's provisional affordance) —
 * dragging that ring binds the mark elsewhere (story 2). A marked word also
 * offers a quiet reject arrow (story 3): one move settles it and sets it
 * aside (ADR-0010). A set-aside word wears `.shelved` (quieter, not disabled):
 * the position past the fold is the whole record. At Level 2 the row also
 * carries the hollow assumption diamond (story 4), whose overlay is rendered
 * at App level so the word's box never grows and wires never move; Level 1
 * renders no diamond at all. At ground (Epic 5 story 1) the row instead carries
 * the one quiet reach handle — a fixed slot revealed on hover or keyboard
 * focus, with a small ring cue when any of the word's pointer lines is marked;
 * its quiet pointer chooser is likewise rendered at App level. Story 3 makes
 * the reach handle's presence read: SOLID when the word carries pointers,
 * FAINT-but-addable when not (the diamond's precedent) — in ground only.
 *
 * Epic 8 story 1 adds the quiet quantity glyph to the Level 2 row: the word's
 * STOCK amount (a line with no amount is the visible unknown) opens its card at
 * App level, so the word's box and every wire's anchor hold. Level 1 renders no
 * glyph at all.
 *
 * Story 3 also lands the cross-band move (ADR-0019): EVERY word carries the
 * follow control, in every game — one quiet glyph that opens a tiny menu of the
 * two other games and jumps the band with this word as the camera's anchor, so
 * the word stays under the eye. It is neutral by construction: its render reads
 * the running game and no face at all.
 *
 * Dragging is reported upward every animation frame (`onDragMove`) so the
 * word's wires track the pointer instead of snapping on drop.
 *
 * DEPRECATED (hidden 2026-11-16 per user review): two of this row's
 * affordances are hidden, not deleted. The open ring (the tentative mark's
 * toggle) and the follow control (the dynamics/ground level faces) keep their
 * markup, refs, handlers and CSS and are simply not rendered — each hiding
 * point below carries the review's comment. The assumption diamond, the
 * quantity glyph, the reach handle, the memory dot, the connect handle, the
 * remove × and the marked word's reject arrow are untouched. Delete the hidden
 * affordances in the deprecated sweep.
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
  marked,
  shelved,
  outOfSet = false,
  covered = false,
  lifted = false,
  interactionMode = "idle",
  onReject,
  onToggleMark,
  onMarkRingDrag,
  showAssumptions = false,
  hasAssumptions = false,
  onOpenAssumptions,
  quantity,
  run,
  showReach = false,
  reachMarked = false,
  onOpenPointers,
  hasPointers = false,
  game = "concept",
  onFollow,
}: ReferenceWordProps) {
  const { camera, centerOn } = usePlane();
  const wordRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const memoryRef = useRef<HTMLTextAreaElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const followRef = useRef<HTMLDivElement>(null);
  const followToggleRef = useRef<HTMLButtonElement>(null);
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
  // The follow control's tiny menu (the two other games), story 3.
  const [followOpen, setFollowOpen] = useState(false);
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

  // Opening the follow menu lands on its first game: the quiet list is the
  // control's own door, so Tab-then-Enter reaches a jump in one move.
  useEffect(() => {
    if (!followOpen) return;
    followRef.current
      ?.querySelector<HTMLButtonElement>(".word-follow-game")
      ?.focus();
  }, [followOpen]);

  // A gesture arming takes the pointer (ADR-0016): the quiet follow menu goes
  // with it, exactly as every other transient closes on the switch path.
  useEffect(() => {
    if (isGestureArmed(interactionMode)) setFollowOpen(false);
  }, [interactionMode]);

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
    // No explicit zoom: the plane lands at the current band's landing zoom, so
    // centering never flips the game (ADR-0018 decision 4). The old hard-coded
    // `1` sat in the dynamics band from every concept zoom.
    const at = anchor();
    centerOn(at.x, at.y);
  }

  /**
   * The follow control's own press (story 3, ADR-0019): ONE quiet control on
   * every coined word, in every game, offering the two OTHER games. It reads
   * no face — a word carrying pointers, assumptions or a loop must look and
   * behave exactly like a bare one, because a face is follow-reachable once
   * the word is found and NEVER announced across bands.
   */
  function toggleFollow() {
    if (isGestureArmed(interactionMode)) return;
    setFollowOpen((open) => !open);
  }

  /**
   * The anchored jump: the word's centre is what the eye is on, so the jump
   * keeps it there — the shared `setZoomBand(level, sx, sy)` intent with the
   * word's own screen point as the anchor (ADR-0018 decision 4, ADR-0019).
   */
  function followTo(next: Level) {
    setFollowOpen(false);
    const el = wordRef.current;
    const world = {
      x: x + (el?.offsetWidth ?? 0) / 2,
      y: y + (el?.offsetHeight ?? 0) / 2,
    };
    onFollow?.(next, screenPointOf(world, camera));
  }

  function handleFollowKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape" || !followOpen) return;
    e.preventDefault();
    e.stopPropagation();
    setFollowOpen(false);
    // The menu's focused game is gone; put focus back on the control.
    followToggleRef.current?.focus();
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
    // While a gesture is armed every word press behavior stands still — drag,
    // click-to-center, the ring, the connect handle (ADR-0016's gate).
    if (isGestureArmed(interactionMode)) return;

    const target = e.target as HTMLElement;
    // The mark ring toggles on click and drags to bind (story 2); it must not
    // start a word drag or a centering. Only a ring that already carries the
    // mark can be dragged — an unmarked hover ring just casts on click.
    if (target.closest(".word-mark")) {
      if (marked && word.slug !== null) onMarkRingDrag?.(word.slug, e);
      return;
    }

    // The connect handle starts a distance draw.
    if (target.closest(".connect-handle")) {
      if (word.slug === null) return;
      onConnectFrom(word.slug, anchor());
      return;
    }

    // The gate's early-return list: the memory dot, the remove ×, the reject
    // arrow and the selector's elements own their own presses; none of them
    // ever starts a word drag or a centering (gates.ts).
    if (!shouldStartWordPress(interactionMode, target.classList)) return;

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
    // Renaming suspends while a gesture is armed (ADR-0016's gate).
    if (isGestureArmed(interactionMode)) return;
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
    if (followOpen) setFollowOpen(false);
    if (isDraft) {
      coin();
    } else if (revealing) {
      commitMemory();
    } else if (renaming) {
      commitRename();
    }
  }

  const transform = `translate3d(${x}px, ${y}px, 0)`;
  // The run read's two pieces (Epic 8 story 3): the amount's spelling and the
  // last crank's signed delta (null when this crank moved nothing here).
  const runAmount = run ? stepAmountText(run.amount) : null;
  const runDelta = run ? stepDeltaText(run.delta) : null;

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
      className={`word${marked ? " open" : ""}${shelved ? " shelved" : ""}${outOfSet ? " out-of-set" : ""}${covered ? " veil-covered" : ""}${lifted ? " veil-lifted" : ""}${revealing ? " revealing" : ""}${renaming ? " renaming" : ""}${dragging ? " dragging" : ""}${connectTarget ? " connect-target" : ""}${followOpen ? " follow-open" : ""}`}
      style={{ transform }}
      onBlur={handleBlur}
      onMouseUp={handleDropMouseUp}
    >
      <div className="word-row">
        {/* DEPRECATED (hidden 2026-11-16 per user review): the word's open
            ring was the tentative mark's toggle (cast it, settle it). The
            review asked for the tentative feature to be hidden, so the ring is
            not rendered — the mark record, the faded look and every reader
            of `map/marks.jsonl` stay; the `word-reject` arrow (below) stays
            too, so a mark that already exists can still be settled — delete in
            the deprecated sweep. */}
        {!TENTATIVE_MARK_HIDDEN && !renaming && (
          <button
            type="button"
            className={`word-mark${marked ? " open" : ""}`}
            aria-label={marked ? "settle (withdraw the open mark)" : "mark tentative"}
            title={marked ? "settle" : "mark tentative"}
            onClick={onToggleMark}
          />
        )}
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
        {/* Story 4's presence at Level 2: the hollow diamond beside the memory
            dot, in the same hover row. It opens the quiet overlay to the
            word's right; the overlay is rendered at App level, so the word's
            box (and every wire's anchor) never moves. */}
        {showAssumptions && onOpenAssumptions && !renaming && (
          <AssumptionDiamond
            has={hasAssumptions}
            onPress={() => {
              const el = wordRef.current;
              onOpenAssumptions({
                x: x + (el?.offsetWidth ?? 0) + 10,
                y: y + (el?.offsetHeight ?? 0) / 2,
              });
            }}
          />
        )}
        {/* Epic 8 story 1's quantity presence (ADR-0020): the one quiet glyph
            for this word's STOCK line, beside the assumption diamond in the
            same hover row. It opens the amount card at App level, so the word's
            box (and every wire's anchor) never moves; the card's field commits
            on Enter and discards on Esc. Level 2 only — a quantity is the
            dynamics game's own record. Provisional: the glyph and the slot. */}
        {quantity && !renaming && (
          <QuantityGlyph
            has={quantity.has}
            onPress={() => {
              const el = wordRef.current;
              quantity.onOpen({
                x: x + (el?.offsetWidth ?? 0) + 10,
                y: y + (el?.offsetHeight ?? 0) / 2 + 16,
              });
            }}
          />
        )}
        {/* Story 1 of Epic 5's reach (ground only): ONE quiet handle in a
            fixed slot. It is always in the row, so the word's box never grows
            and no wire anchor moves; hover, keyboard focus and being focused
            reveal it. Story 3 gives it the in-band presence read: SOLID when
            the word carries pointers, FAINT-but-addable when not (the diamond's
            `has-assumptions` precedent) — and only ever at ground, because a
            face is never announced across bands (ADR-0019). The small ring cue
            says one of this word's pointer lines is marked — a presence, never
            a count. It opens the quiet chooser at App level, so the chooser can
            never grow the word either. */}
        {showReach && onOpenPointers && !renaming && (
          <button
            type="button"
            className={"reach-handle" + reachHandleModifiers(hasPointers, reachMarked)}
            aria-label={
              reachMarked
                ? "reach — pointers on this word (one is marked)"
                : "reach — pointers on this word"
            }
            title="reach"
            onClick={(e) => {
              e.stopPropagation();
              const el = wordRef.current;
              onOpenPointers({
                x: x + (el?.offsetWidth ?? 0) + 10,
                y: y + (el?.offsetHeight ?? 0) / 2,
              });
            }}
          >
            ↗
          </button>
        )}
        {/* Story 3's follow (ADR-0019 decision 2): the cross-band vocabulary
            is MOVEMENT. ONE quiet control on every coined word, in every game,
            offering the two OTHER games; each jumps the band keeping this word
            under the eye (the shared jump intent, anchored at the word's own
            screen point). It is NEUTRAL by construction: it reads the running
            game and nothing else, so a word with pointers, assumptions or a
            loop looks exactly like a bare one — a face is follow-reachable
            once the word is found, never announced. The tiny menu is rendered
            inside the row, absolutely positioned, so it never grows the word's
            box (every wire's anchor holds). Provisional: the glyph, the menu
            and the two-other-games offer (ADR-0003's seam). */}
        {/* DEPRECATED (hidden 2026-11-16 per user review): the follow control
            offered the two OTHER games (the dynamics and ground level faces) as
            a jump from this word. The review asked for the level selection on a
            word to be hidden, so the control and its menu are not rendered —
            `followTargets`, the anchored jump and the level handoff all stay
            written and tested — delete in the deprecated sweep. */}
        {!CROSS_LEVEL_FACES_HIDDEN && (
        <div
          ref={followRef}
          className="word-follow"
          onKeyDown={handleFollowKeyDown}
        >
          <button
            ref={followToggleRef}
            type="button"
            className="word-follow-toggle"
            aria-label="follow this word across the games"
            title="follow — jump the band, keeping this word under the eye"
            aria-expanded={followOpen}
            onClick={(e) => {
              e.stopPropagation();
              toggleFollow();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            ◎
          </button>
          {followOpen && (
            <div
              className="word-follow-menu"
              role="group"
              aria-label="jump, keeping this word under the eye"
            >
              {followTargets(game).map((target) => (
                <button
                  key={target}
                  type="button"
                  className="word-follow-game"
                  onClick={(e) => {
                    e.stopPropagation();
                    followTo(target);
                  }}
                >
                  {target}
                </button>
              ))}
            </div>
          )}
        </div>
        )}
        <button
          type="button"
          className="connect-handle"
          aria-label="draw a distance"
          title="drag to another word"
        />
        {/* DEPRECATED (hidden 2026-11-16 per user review): the reject control
            (the quiet → that settled a word's open mark and set the word aside)
            belongs to the SHELF, which the review removed. The button, its
            handler and the composed settle + set-aside write (useMap's `reject`)
            all stay written; flipping `SHELF_HIDDEN` back offers it again — delete
            in the deprecated sweep. */}
        {!SHELF_HIDDEN && marked && !renaming && !revealing && (
          <button
            type="button"
            className="word-reject"
            aria-label="reject — settle and set aside"
            title="reject — settle and set aside"
            onClick={onReject}
          >
            →
          </button>
        )}
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
      {/* Epic 8 story 3's run read (ADR-0022): this stock's running amount
          after the last crank, and what that crank moved for it. It hangs
          below the word (absolutely positioned, the follow menu's idiom), so
          the word's box never grows and every wire's anchor holds; it is
          per-word BY CONSTRUCTION — there is no panel that could collect the
          words into a column or a total. Level 2 only: the app passes it only
          in the dynamics band. Provisional: the line's look and sign. */}
      {run && runAmount !== null && (
        <span
          className="word-run"
          aria-label={`${word.name} — ${runAmount} after the last crank${
            runDelta ? `, ${runDelta}` : ""
          }`}
        >
          <span className="word-run-amount">{runAmount}</span>
          {runDelta && <span className="word-run-delta">{runDelta}</span>}
        </span>
      )}
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