import { useEffect, useRef, useState, type CSSProperties } from "react";
import { previewOverflows, previewText } from "../map/readings";
import {
  SESSION_BOUNDARY_LABELS,
  SESSION_BOUNDARY_UNDECLARED_SENTENCE,
  SESSION_EMPTY_SENTENCE,
  SESSION_MISSING_TOOL_SENTENCE,
  SESSION_RUNNING_SENTENCE,
  sessionBindingLine,
  sessionDisplayName,
  sessionEntryLine,
  sessionKindLine,
  sessionNameForWrite,
  sessionNewestEntry,
  type SessionCard as SessionCardRecord,
  type SessionEntry,
} from "../map/sessions";
import { CardNamePill, type PillNameRules } from "./CardNamePill";
import type { GroundAddResult } from "./useGround";
import { isGestureArmed, type GestureMode } from "./gates";
import { startGroundLinkDrag } from "./linkDrag";
import { attachGroundCardDrag } from "./groundDrag";
import {
  frameGroundCard,
  settleGroundCard,
  type GroundDragChannel,
} from "./groundDragRef";
import type { Point } from "./geometry";
import { GESTURE_IDLE, type GestureNarration } from "./gestureWord";
import {
  allowOnceOption,
  refuseOption,
  type AcpPermissionAsk,
} from "../turn/acpEntries";
import { acpScopeDeclaration } from "../turn/acpSpecs";

/**
 * STORY 16.22 — THE SESSION CARD'S RULES FOR THE SHARED NAME PILL. A session
 * line cannot carry an empty name, so a blank field stores the untitled
 * sentence ("Untitled session", the reference card's rule one family over) —
 * NOT the ask card's refusal. The pill decides nothing about names; each
 * family's own rules do, and these are this family's.
 */
const SESSION_PILL_RULES: PillNameRules = {
  displayName: sessionDisplayName,
  nameForWrite: sessionNameForWrite,
};

/**
 * THE SESSION CARD (Epic 18 story 3).
 *
 * It renders from the SAME grammar as a reference card and an ask card — name,
 * what this is, the crop — so the ground map stays one surface. The name is the
 * person's, the second line says "a run of <the tool row>", and the body is the
 * run's TRANSCRIPT: one progress entry per line, in ARRIVAL order, newest at
 * the bottom. THE TRANSCRIPT IS THE RECORD, NOT THIS COMPONENT: the entries
 * arrive as a prop, read at load from `map/sessions/<slug>.jsonl`.
 *
 * TWO FACES. Small: the newest entry's crop (or the ending, when the last run
 * ended — the ending IS an entry). Expanded: the whole transcript in order, the
 * DECLARATION for the next run (18.2's one sentence, which names a provider row
 * and never a key), the tool picker when the card's row is gone, and the run
 * and stop verbs.
 *
 * ENTRIES RENDER BY KIND: words as words, a tool call as its name plus the
 * status the server reported, a permission as what was asked plus the reply,
 * and the run's own beats (started, session) and ending as one quiet line each.
 * NEVER a percentage, never a step count, never a spinner: while a run is live
 * the card says so in one sentence and offers its stop; the moment the run
 * settles that sentence and that verb are gone, because they are read from the
 * live-run list and not from a timer of ours.
 *
 * ONE RUN PER CARD. The card's run verb is disabled while the list says this
 * card is running, and stop is the run's own cancel (18.2) — what arrived stays
 * and the ending says what happened. A PARTIAL NEVER COUNTS AS A RESULT: the
 * ending line is the only claim the card makes about how the run went, and it
 * says "stopped", "failed" or "timed-out" instead of dressing a partial up.
 *
 * A CARD WHOSE ROW IS GONE says so in one sentence and offers the rows this
 * build ships again (one field's change, written by the layer). A card whose
 * row is there declares the next run before it starts — the key sentence
 * included, with no key in it: the ROW is named, never the value.
 *
 * STORY 18.5 MAKES IT REMOVABLE: the expanded card offers remove, the same
 * immediate delete + Restore toast every other card uses. A live run is never
 * cut by it — the verb waits until the transcript has stopped being written.
 *
 * STORY 16.22 — THE NAME FLOATS ABOVE THIS CARD TOO, in the SHARED pill (one
 * component, one counter-scale, one rename field) the reference and ask cards
 * already wear: a session card is a peer on the same map, and its name was
 * cropped by its own transcript. The card's OWN name rules ride into the pill
 * (`SESSION_PILL_RULES`): a blank field stores "Untitled session" — this
 * family has no refusal for one, unlike an ask card. The rename reaches the
 * hook's one session-name path, which writes the record and ONE `card.rename`
 * history line (never a word of the transcript).
 *
 * ESC CLOSES THE CARD'S FACE (collapses), never the map. The wheel never zooms
 * the plane: the scrollbox stops the event where it starts.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the card's size, the crop, the
 * scrollbox's slack, the sentence placements and the picker's look.
 */

/** How close to the bottom still counts as "at the bottom" (px, PROVISIONAL). */
export const SESSION_SCROLL_SLACK = 24;

/** Whether a scrollbox is close enough to its bottom to keep following (PURE). */
export function sessionAtBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= SESSION_SCROLL_SLACK;
}

/**
 * ONE ENTRY, drawn by its kind. The words are VERBATIM; the card only decides
 * how they sit. A `crop` is the small face's stated count (the expanded face
 * omits it), and it only ever cuts TEXT — a tool's name or an ending is one
 * line already and is never cut.
 */
export function SessionEntryLine({
  entry,
  crop,
}: {
  entry: SessionEntry;
  crop?: number;
}) {
  if (entry.kind === "text") {
    const text = crop === undefined ? entry.text : previewText(entry.text, crop);
    return (
      <div className="session-entry text">
        <span className="session-entry-text">{text}</span>
      </div>
    );
  }
  if (entry.kind === "tool") {
    return (
      <div className="session-entry tool">
        <span className="session-entry-name">{entry.name}</span>
        {entry.status.trim() !== "" && (
          <span className="session-entry-status">{entry.status}</span>
        )}
      </div>
    );
  }
  if (entry.kind === "permission") {
    return (
      <div className="session-entry permission">
        <span className="session-entry-name">{entry.name}</span>
        <span className="session-entry-status">{entry.reply}</span>
      </div>
    );
  }
  // started, session and ended are one quiet line each; the ending is the only
  // thing the card ever claims about how the run went.
  return (
    <div
      className={
        "session-entry quiet " +
        entry.kind +
        (entry.kind === "ended" ? " ending-" + entry.ending : "")
      }
    >
      {sessionEntryLine(entry)}
    </div>
  );
}

/**
 * WHAT THE SERVER IS ASKING, in one line (PURE, PROVISIONAL): the tool call's
 * own title and kind, never the request's raw params. A call with no title
 * still says a permission is being asked, so the card is never blank.
 */
export function permissionAskLine(toolCall: unknown): string {
  const call =
    typeof toolCall === "object" && toolCall !== null && !Array.isArray(toolCall)
      ? (toolCall as Record<string, unknown>)
      : {};
  const title =
    typeof call.title === "string" && call.title.trim() !== ""
      ? call.title.trim()
      : "a tool call";
  const kind =
    typeof call.kind === "string" && call.kind.trim() !== ""
      ? call.kind.trim()
      : "";
  return kind === "" ? title : title + " (" + kind + ")";
}

/**
 * One tool row a picker may offer: its id and the LABEL the person reads. The
 * label is the layer's, built from the row (story 18.6 adds "(unverified)"), so
 * this card never learns a product's name or judges one.
 */
export interface SessionToolChoice {
  id: string;
  name: string;
}

/**
 * STORY 19.2 — one PROJECT CARD a binding picker may offer: its slug and the
 * card's NAME. No folder path here: a binding names a card, and the reading is
 * resolved by the layer when the run starts.
 */
export interface SessionProjectChoice {
  id: string;
  name: string;
}

export function SessionCard({
  session,
  toolName,
  declaration,
  tools = [],
  entries,
  running,
  zoom = 1,
  open,
  previewLines,
  onOpen,
  onClose,
  onRun,
  onStop,
  onChooseTool,
  projectName = null,
  projectFolder = null,
  projects = [],
  onChooseProject,
  onChooseBoundary,
  permission = null,
  onAllowOnce,
  onRefuse,
  onMakeResult,
  onRemove,
  onRename,
  onMove,
  onLink,
  interactionMode = "idle",
  onNarrate,
  drag,
}: {
  session: SessionCardRecord;
  /** The bound row's display name, or null when this build does not ship it. */
  toolName: string | null;
  /**
   * The declaration for the NEXT run (18.2's sentence computed from the row:
   * which key it will receive, by provider row, or that it receives none), or
   * null when there is no row to declare.
   */
  declaration: string | null;
  /** The rows a picker may offer (the build's shipped rows). */
  tools?: readonly SessionToolChoice[];
  /** The transcript, in file order (append-only: file order is arrival order). */
  entries: readonly SessionEntry[];
  /** View state: this card has a LIVE run right now. */
  running: boolean;
  /**
   * STORY 16.22 — the camera's own zoom, handed straight to the name pill (its
   * counter-scale is the card's legibility rule at any zoom). Optional: a
   * render test that only cares about the transcript is at 100%.
   */
  zoom?: number;
  /**
   * STORY 16.25 — the map's ONE in-flight drag, shared with the wires. A card
   * publishes its live point here while the hand is down instead of writing
   * React state, so only the wires that touch it follow. Optional so a render
   * test needs no channel; the card then moves its own element alone.
   */
  drag?: GroundDragChannel;
  open: boolean;
  /** How many lines the small face crops at (the stated preference). */
  previewLines: number;
  onOpen: () => void;
  onClose: () => void;
  /** Start the run (the layer's writer). Optional in a render test. */
  onRun?: () => Promise<GroundAddResult>;
  /** Stop the live run (the run's own cancel). */
  onStop?: () => Promise<void>;
  /** Bind the card to another row (one field's change). */
  onChooseTool?: (tool: string) => Promise<GroundAddResult>;
  /**
   * STORY 19.2 — THE BOUND PROJECT CARD, by NAME only. The face never wears the
   * folder path; the declaration says it once, when a boundary is declared.
   */
  projectName?: string | null;
  /** The bound reading's folder, when it really is one (the declaration's path). */
  projectFolder?: string | null;
  /** The project cards a binding picker may offer (names only). */
  projects?: readonly SessionProjectChoice[];
  /** Bind this card to a project card, or unbind it with null (one field). */
  onChooseProject?: (project: string | null) => Promise<GroundAddResult>;
  /** Declare, or withdraw with null, what a run may do in that folder. */
  onChooseBoundary?: (
    boundary: "read" | "write" | null,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 18.4 — THE SERVER'S PENDING ASK, as view state. While this is here
   * the run is WAITING; the card offers allow-once and refuse and nothing else.
   */
  permission?: AcpPermissionAsk | null;
  /** The person's two verbs. Allow-once is offered only when it exists. */
  onAllowOnce?: () => void;
  onRefuse?: () => void;
  /** Make the last completed run's text into a card (a copy, never a link). */
  onMakeResult?: () => Promise<GroundAddResult>;
  /**
   * STORY 16.22 — RENAME this card: the shared name pill IS the rename field.
   * The name is the person's and the slug is identity (the transcript's file
   * name and a wire's endpoint), so a rename moves neither. Optional so a
   * render test needs no writer.
   */
  onRename?: (name: string) => Promise<GroundAddResult>;
  /**
   * STORY 18.5 — remove this card, immediately and reversibly (the one toast).
   * A run in flight refuses: the transcript is still being written.
   */
  onRemove?: () => Promise<GroundAddResult>;
  /**
   * STORY 16.23 — MOVE this card to its dropped point: ONE record line's
   * `x|y`, through the hook's one write queue. The drag is the SHARED rule in
   * groundDrag.ts (one threshold, one write on release); this prop only carries
   * the drop to the writer. Optional so a render test needs no write path.
   */
  onMove?: (x: number, y: number) => Promise<GroundAddResult>;
  /**
   * STORY 17.9 — WIRE this session card to another card (the source side): a
   * session card's completed run is context for an ask card, so it needs the
   * same small edge handle the other cards have.
   */
  onLink?: (from: string, to: string) => Promise<GroundAddResult>;
  /** The gesture gate, so a wiring drag never starts under an armed tool. */
  interactionMode?: GestureMode;
  /** The one sentence a wiring drag speaks; absent in a render test. */
  onNarrate?: (gesture: GestureNarration) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // STORY 16.23 — THE CARD IS MOVABLE BY THE SAME ONE RULE as a reference.
  // STORY 16.25 — and like the reference card, the live frame is NOT React
  // state: the element carries the hand (`frameGroundCard`) and the point goes
  // to the wires through the shared channel. These two refs are the release's:
  // where the hand let go, and the whole-unit point the record will hold.
  const liveRef = useRef<Point | null>(null);
  const droppedRef = useRef<Point | null>(null);
  // Whether the body still follows the newest entry; a person scrolling up
  // turns it off until they reach the bottom again.
  const pinnedRef = useRef(true);

  // ESC CLOSES THE CARD'S FACE — never the map. Capture phase, so the key is
  // consumed before the plane's handlers see it. A picker that is open is
  // forgotten first (one press, one thing).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // STORY 16.22 — THE NAME'S FIELD IS THE PILL'S, NOT THE CARD'S. Escape
      // while renaming forgets the draft (the pill's own handler) and must not
      // ALSO collapse the card. One press, one thing.
      if ((e.target as HTMLElement | null)?.closest?.(".ground-pill")) return;
      e.preventDefault();
      e.stopPropagation();
      if (picked !== null) {
        setPicked(null);
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose, picked]);

  // The card's wheel never zooms the plane.
  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    function onWheel(e: WheelEvent) {
      e.stopPropagation();
    }
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // STORY 17.9 — THE WIRING HANDLE, the reference card's raw-listener idiom
  // (d3-zoom stops mousedown at the plane). A release on any ground card draws
  // the one ordered pair; the layer owns the write and its refusal.
  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    function handleMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      if (!(e.target as HTMLElement).closest(".ground-link-handle")) return;
      e.stopPropagation();
      startGroundLinkDrag(e, session.on, {
        interactionMode,
        onLink,
        onNarrate,
      });
    }
    el.addEventListener("mousedown", handleMouseDown);
    return () => el.removeEventListener("mousedown", handleMouseDown);
  }, [session.on, interactionMode, onLink, onNarrate]);

  /**
   * STORY 16.25 — PUT THE FRAME BACK ON THE RECORD'S OWN POINT and let the
   * wires go: for a drop that rounded onto the card's own point, a refused
   * write, or the write whose point has arrived. The map may never show a
   * position the file does not hold.
   */
  function settleFrame(): void {
    liveRef.current = null;
    droppedRef.current = null;
    settleGroundCard(cardRef.current, { x: session.x, y: session.y });
    drag?.publish(null);
  }

  // STORY 16.23 — THE SESSION CARD MOVES BY THE SAME ONE RULE. The press
  // reaches the shared wiring (groundDrag.ts), so the threshold, the live
  // frame and the one write on release are the reference card's — there is no
  // second drag here. The name pill is a child of this card, so a press on it
  // lands in the same listener: the pill is the handle, and a press that never
  // moves on it opens nothing. STORY 16.25 — the frame is the element's and
  // the shared channel's, so a move renders nothing; the drop is ONE write.
  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    return attachGroundCardDrag(el, {
      at: () => ({ x: session.x, y: session.y }),
      zoom: () => zoom,
      onPreview: (at) => {
        // Null is the release's own news; the release below decides what stays.
        if (at === null) return;
        liveRef.current = at;
        frameGroundCard(el, at);
        drag?.publish({ slug: session.on, x: at.x, y: at.y });
      },
      onMoved: () =>
        onNarrate?.({
          kind: "moving",
          name: sessionDisplayName(session.name),
        }),
      onDrop: (point) => {
        if (onMove === undefined) {
          settleFrame();
          return;
        }
        void onMove(point.x, point.y).then((result) => {
          // A refused write is one sentence on the card, never a point that
          // quietly snaps back for no stated reason — and the card goes back
          // to the point the record still holds.
          if (!result.ok) {
            settleFrame();
            setProblem(result.message);
          }
        });
      },
      onRelease: (moved) => {
        onNarrate?.(GESTURE_IDLE);
        if (!moved) return;
        const at = liveRef.current;
        if (at === null) return;
        // The record keeps whole units, so the frame commits to the point the
        // line will hold: the card and its wires land where they stay.
        const landed = { x: Math.round(at.x), y: Math.round(at.y) };
        if (landed.x === session.x && landed.y === session.y) {
          // A no-op drop writes nothing, so nothing else would release this.
          settleFrame();
          return;
        }
        droppedRef.current = landed;
        drag?.publish({ slug: session.on, x: landed.x, y: landed.y });
      },
      isArmed: () => isGestureArmed(interactionMode),
      // The card's verbs, fields and the link handle are already the helper's
      // own exclusions; a session card has no selection surface to protect.
      onClick: (onPill) => {
        // A press on the name pill is the handle and opens nothing; a press
        // that never moved on the body is the card's door.
        if (onPill) return;
        onOpen();
      },
    });
  }, [session.on, session.x, session.y, zoom, onMove, onOpen, onNarrate, interactionMode, drag]);

  /**
   * THE FRAME IS RELEASED WHEN THE RECORD CATCHES UP: the new point arrives as
   * a prop only after the queued write landed, so the card and its wires stay
   * on the dropped point instead of snapping back through the old one.
   */
  useEffect(() => {
    const dropped = droppedRef.current;
    if (dropped === null) return;
    if (session.x !== dropped.x || session.y !== dropped.y) return;
    settleFrame();
  }, [session.x, session.y]);

  // Opening starts AT THE NEWEST ENTRY again.
  useEffect(() => {
    if (open) pinnedRef.current = true;
  }, [open]);

  // AUTO-SCROLL TO THE NEWEST ENTRY unless the person scrolled up.
  useEffect(() => {
    if (!open) return;
    const el = bodyRef.current;
    if (el === null || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [open, entries.length]);

  function trackScroll(): void {
    const el = bodyRef.current;
    if (el === null) return;
    pinnedRef.current = sessionAtBottom(
      el.scrollTop,
      el.clientHeight,
      el.scrollHeight,
    );
  }

  async function startRun(): Promise<void> {
    if (busy || running || onRun === undefined) return;
    setBusy(true);
    setProblem(null);
    // The run's own promise settles when the run does; awaiting it only holds
    // THIS handler, never the card. The entries arrive through the prop.
    const result = await onRun();
    setBusy(false);
    // The ENDING is the transcript's line; only a record that could not keep
    // up answers a sentence here.
    if (!result.ok) setProblem(result.message);
  }

  async function stopRun(): Promise<void> {
    if (onStop === undefined) return;
    setProblem(null);
    try {
      await onStop();
    } catch {
      // The run's own line settles it; a stop that cannot reach the server
      // leaves the run to its budget.
    }
  }

  /**
   * STORY 18.5 — the card's remove, beside close: immediate, reversible through
   * the one toast. A refused unlink has already taken the card, so its one
   * sentence is the layer's, not this card's.
   */
  async function removeCard(): Promise<void> {
    if (busy || running || onRemove === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onRemove();
    if (!result.ok && result.recordsRemoved !== true) {
      setBusy(false);
      setProblem(result.message);
    }
  }

  async function makeResult(): Promise<void> {
    if (busy || onMakeResult === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onMakeResult();
    setBusy(false);
    // A run with no text (or one that did not finish) writes NOTHING and says
    // one sentence; a made card leaves this card at once.
    if (!result.ok) setProblem(result.message);
  }

  /**
   * STORY 19.2 — THE BINDING'S ONE WRITE. The value "" is the picker's "no
   * project" / "undeclared" and becomes null, which REMOVES the field: an
   * unbound card and an undeclared one keep exactly the bytes (and the run)
   * they had before this story.
   */
  async function usePickedProject(value: string): Promise<void> {
    if (busy || onChooseProject === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onChooseProject(value === "" ? null : value);
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  }

  async function usePickedBoundary(value: string): Promise<void> {
    if (busy || onChooseBoundary === undefined) return;
    setBusy(true);
    setProblem(null);
    const boundary =
      value === "read" || value === "write" ? (value as "read" | "write") : null;
    const result = await onChooseBoundary(boundary);
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  }

  async function usePickedTool(): Promise<void> {
    if (picked === null || onChooseTool === undefined || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await onChooseTool(picked);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setPicked(null);
  }

  // STORY 19.2 — the declaration of the bound run, when the person has both
  // bound a folder card and declared a boundary. The folder's FULL PATH is said
  // here and only here: the blast radius is said aloud before the run starts.
  const scopeDeclaration =
    projectFolder !== null && session.boundary !== undefined
      ? acpScopeDeclaration(projectFolder, session.boundary)
      : null;

  const newest = sessionNewestEntry(entries);
  const smallFolded =
    !open &&
    newest !== null &&
    newest.kind === "text" &&
    previewOverflows(newest.text, previewLines);

  return (
    <div
      ref={cardRef}
      className={`session-card${open ? " expanded" : ""}`}
      style={
        {
          // STORY 16.25: the RECORD's point is what React renders; the hand's
          // own frame is written on the element, so a drag re-renders nothing.
          left: session.x,
          top: session.y,
          "--preview-lines": previewLines,
        } as CSSProperties
      }
      data-slug={session.on}
    >
      {/* STORY 16.22 — THE NAME FLOATS ABOVE THE SESSION CARD, in the SAME pill
          the reference and ask cards wear: one component, one counter-scale,
          one rename field, and this family's OWN name rules (a blank field
          stores "Untitled session"). The name left the body because the body's
          transcript cropped it and the plane's scale shrank it away. */}
      <CardNamePill
        name={session.name}
        zoom={zoom}
        busy={busy}
        rules={SESSION_PILL_RULES}
        renameLabel="rename this session card"
        onRename={
          onRename === undefined
            ? undefined
            : async (name: string) => {
                const result = await onRename(name);
                if (!result.ok) setProblem(result.message);
                return result;
              }
        }
      />
      <div className="session-card-kind">{sessionKindLine(toolName)}</div>
      {/* STORY 19.2 — THE BINDING, QUIETLY: the bound project card's NAME and
          never its folder path. What the run may do there is declared in the
          expanded face, where the person can see and change it. */}
      {projectName !== null && (
        <div className="session-card-bound">{sessionBindingLine(projectName)}</div>
      )}
      {/* STORY 17.9 — a session card can be wired into an ask card; its last
          completed run is what it lends. */}
      {onLink !== undefined && (
        <button
          type="button"
          className="ground-link-handle"
          title="wire this card to another"
          aria-label="wire this card to another"
        />
      )}
      <div className="session-card-body" ref={bodyRef} onScroll={trackScroll}>
        {open ? (
          entries.length === 0 ? (
            <div className="session-card-empty">{SESSION_EMPTY_SENTENCE}</div>
          ) : (
            <div
              className="session-card-transcript"
              aria-live={running ? "polite" : undefined}
            >
              {entries.map((entry, index) => (
                <SessionEntryLine key={index} entry={entry} />
              ))}
            </div>
          )
        ) : newest === null ? (
          <div className="session-card-empty">{SESSION_EMPTY_SENTENCE}</div>
        ) : (
          <div className="session-card-transcript">
            <SessionEntryLine entry={newest} crop={previewLines} />
          </div>
        )}
        {smallFolded && (
          <div className="ground-fold">
            <div className="ground-fade" aria-hidden="true" />
            <button
              type="button"
              className="ground-more"
              title="open the card"
              onClick={onOpen}
            >
              more
            </button>
          </div>
        )}
      </div>
      {problem !== null && (
        <div className="session-card-problem" role="status">
          {problem}
        </div>
      )}
      {open && (
        <div className="session-card-run">
          {/* A CARD WHOSE ROW IS GONE says so and offers the rows this build
              ships again. One field's change, and the card is usable again. */}
          {toolName === null && (
            <div className="session-card-missing" role="status">
              <div className="session-card-missing-sentence">
                {SESSION_MISSING_TOOL_SENTENCE}
              </div>
              {tools.length > 0 && onChooseTool !== undefined && (
                <div className="session-card-picker">
                  <select
                    className="session-card-pick"
                    aria-label="run this card with"
                    value={picked ?? tools[0]!.id}
                    disabled={busy || running}
                    onChange={(e) => setPicked(e.target.value)}
                  >
                    {tools.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="session-card-bind"
                    disabled={busy || running}
                    onClick={() => void usePickedTool()}
                  >
                    use this tool
                  </button>
                </div>
              )}
            </div>
          )}
          {/* STORY 18.4 — THE PENDING PERMISSION, and the person's TWO verbs.
              The server's options are NEVER presented as choices: only
              allow-once and refuse exist here, so an "always" offer on the wire
              cannot become a press. When no allow-once option was offered, the
              allow verb is disabled and the card says why — it never falls back
              to an always option. */}
          {permission !== null && (
            <div className="session-permission" role="status">
              <div className="session-permission-ask">
                the run is asking: {permissionAskLine(permission.toolCall)}
              </div>
              {allowOnceOption(permission.options) === null && (
                <div className="session-permission-note">
                  the server offered no allow-once option, so only refuse is
                  available.
                </div>
              )}
              <div className="session-permission-actions">
                <button
                  type="button"
                  className="session-permission-allow"
                  disabled={
                    onAllowOnce === undefined ||
                    allowOnceOption(permission.options) === null
                  }
                  onClick={onAllowOnce}
                >
                  allow once
                </button>
                <button
                  type="button"
                  className="session-permission-refuse"
                  disabled={
                    onRefuse === undefined ||
                    refuseOption(permission.options) === null
                  }
                  onClick={onRefuse}
                >
                  refuse
                </button>
              </div>
            </div>
          )}
          {/* STORY 19.2 — THE BINDING AND THE BOUNDARY. A project is a card, so
              the picker offers NAMES only; the boundary is the person's
              declaration, and its absence is the safe default: every ask
              reaches them and the run starts in a fresh folder. Both are ONE
              record field each, written the moment they are chosen. */}
          {(onChooseProject !== undefined || onChooseBoundary !== undefined) && (
            <div className="session-card-binding-choice">
              {onChooseProject !== undefined && (
                <select
                  className="session-card-pick"
                  aria-label="run this card in a project"
                  value={session.project ?? ""}
                  disabled={busy || running}
                  onChange={(e) => void usePickedProject(e.target.value)}
                >
                  <option value="">no project</option>
                  {projects.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name}
                    </option>
                  ))}
                </select>
              )}
              {onChooseBoundary !== undefined && (
                <select
                  className="session-card-pick"
                  aria-label="what this run may do there"
                  value={session.boundary ?? ""}
                  disabled={busy || running || session.project === undefined}
                  onChange={(e) => void usePickedBoundary(e.target.value)}
                >
                  <option value="">{SESSION_BOUNDARY_LABELS.undeclared}</option>
                  <option value="read">{SESSION_BOUNDARY_LABELS.read}</option>
                  <option value="write">{SESSION_BOUNDARY_LABELS.write}</option>
                </select>
              )}
              {session.boundary === undefined && (
                <div className="session-card-bound-hint">
                  {SESSION_BOUNDARY_UNDECLARED_SENTENCE}
                </div>
              )}
            </div>
          )}
          {/* THE DECLARATION FOR THE NEXT RUN: 18.2's one sentence, computed
              from the row alone. It names a provider ROW, never a key. */}
          {declaration !== null && (
            <div className="session-card-declaration">{declaration}</div>
          )}
          {/* STORY 19.2 — THE BOUND RUN'S BLAST RADIUS, in one sentence: the
              folder's full path and what the person said the run may do there.
              Shown only when both are true, so an unbound or undeclared card
              says exactly what it always did. */}
          {scopeDeclaration !== null && (
            <div className="session-card-declaration session-card-scope">
              {scopeDeclaration}
            </div>
          )}
          <div className="session-card-actions">
            {running ? (
              <>
                {/* The one sentence, and the one verb. No spinner: this line is
                    read from the live-run list, so it cannot outlive the run. */}
                <span className="session-running">{SESSION_RUNNING_SENTENCE}</span>
                <button
                  type="button"
                  className="session-card-stop"
                  disabled={onStop === undefined}
                  onClick={() => void stopRun()}
                >
                  stop
                </button>
              </>
            ) : (
              <button
                type="button"
                className="session-card-run-verb"
                disabled={busy || toolName === null || onRun === undefined}
                onClick={() => void startRun()}
              >
                run
              </button>
            )}
            {/* STORY 18.4 — A FINISHED RUN'S RESULT BECOMES A COPY. Offered
                once a run has ended; a run with no text refuses with the ONE
                sentence in the problem line and writes nothing. */}
            {entries.some((entry) => entry.kind === "ended") && (
              <button
                type="button"
                className="session-card-make"
                disabled={busy || onMakeResult === undefined}
                onClick={() => void makeResult()}
              >
                make a card from this
              </button>
            )}
            {/* STORY 18.5 — the card's remove, beside close: immediate,
                reversible through the one toast. A live run is never cut by a
                delete — the verb waits. */}
            {onRemove !== undefined && (
              <button
                type="button"
                className="session-card-remove"
                disabled={busy || running}
                onClick={() => void removeCard()}
              >
                remove
              </button>
            )}
            <button type="button" className="session-card-close" onClick={onClose}>
              close
            </button>
          </div>
        </div>
      )}
      {!open && (
        <div className="session-card-footer">
          <button type="button" className="session-card-open" onClick={onOpen}>
            open
          </button>
        </div>
      )}
    </div>
  );
}
