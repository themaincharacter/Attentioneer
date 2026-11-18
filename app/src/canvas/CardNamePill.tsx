import { useRef, useState, type CSSProperties } from "react";
import { groundDisplayName, groundNameForWrite } from "../map/ground";
import type { GroundAddResult } from "./useGround";

/**
 * STORY 16.21 — THE NAME FLOATS ABOVE THE CARD.
 *
 * Every ground card used to carry its name INSIDE it, where the card's own
 * reading cropped it and where it shrank with the map: at 25% zoom the names
 * vanished exactly when the person was trying to read the SHAPE of the map.
 * So the name moves into a PILL above the card. It is not decoration: it is
 * the card's one HANDLE (drag it and the card moves — the same drag rule the
 * card body already uses) and its one RENAME FIELD (double-click it, and the
 * old name is selected for typing). The card body keeps what it is FOR — the
 * type line, the crop — and loses only the words that now float.
 *
 * THE COUNTER-SCALE. The pill is a child of the card, so the plane's own
 * transform would shrink it with everything else. Its text is therefore
 * counter-scaled by the camera's inverse zoom, CLAMPED so the fix can never
 * cost more than it buys:
 *
 *   scale = clamp(1 / zoom, 1, 4)
 *
 * The floor of 1 means a zoomed-IN pill never shrinks below the card's own
 * scale (it is legible at 100% and larger above it). The ceiling of 4 makes
 * 25% zoom — the story's check, and `1 / 0.25 = 4` — the point where the
 * counter-scale stops: past it the pills shrink WITH the map instead of
 * growing without bound, so a deep zoom-out can never paint a wall of
 * full-size names over its own edges. PROVISIONAL: the ceiling, the pill's
 * padding, its max width and the little gap above the card.
 *
 * What this component does NOT do: it owns no drag. A press on the pill
 * bubbles to the card's existing raw mousedown listener (`GroundLayer`) and
 * rides `groundDrag.ts` exactly as a press on the body does — one rule, one
 * threshold, one write on release. This file only carries the name and the
 * rename field.
 *
 * The rename goes through the card's one name write path (`useGround`): the
 * name is the record's field, the slug stays identity, and an empty field is a
 * legal name that stores and shows "Untitled reference" (the ask card's
 * empty-name rule, one family over). Enter commits, Escape abandons, and a
 * press away commits what is typed (the note editor's idiom).
 *
 * STORY 16.22 — THE PILL BELONGS TO EVERY CARD, AND EACH KIND KEEPS ITS OWN NAME
 * RULES. Ask cards and session cards are peers of a reference on the same map,
 * so they wear the SAME pill (one counter-scale, one handle, one rename field,
 * one component): a second name surface would be a second thing to keep in
 * step. What the pill does NOT do is decide what a blank field means. Each
 * family hands in its own two rules — how a name is SHOWN and what a commit
 * STORES — because the families really do differ:
 *
 *   - a REFERENCE'S blank field stores "Untitled reference" (`map/ground.ts`);
 *   - a SESSION'S stores "Untitled session" (`map/sessions.ts`);
 *   - an ASK'S is a REFUSAL: the card keeps the name it had and nothing is
 *     written (`map/asks.ts`), because a question's name is the person's words
 *     and an invented placeholder would be a card that says nothing.
 *
 * A rule that answers `null` refuses the commit. Every rule returns the name
 * the RECORD stores, so the same-name check below compares stored against
 * stored: a commit that changes no words calls no writer (and therefore logs
 * nothing — the history's own rule for a rename is one line per real change).
 *
 * NOT YET A MOVE FOR EVERY KIND. The handle is the CARD'S drag, reached through
 * the card's own mousedown rule — this file owns no drag. A reference card has
 * that rule (`groundDrag.ts`) and an ask or a session card has NONE: their
 * records carry a point that no shipped path rewrites after creation, so
 * dragging those names moves nothing today. The pill is already the handle they
 * would use (it adds no second rule); a move path for those two families is its
 * own story, and the pill will need no change to serve it.
 */

/** The counter-scale never goes below the card's own scale (a zoomed-in pill). */
export const PILL_MIN_COUNTER_SCALE = 1;

/**
 * The counter-scale stops growing here: 25% zoom is full legibility, and below
 * it the pills shrink with the map rather than overlapping each other.
 */
export const PILL_MAX_COUNTER_SCALE = 4;

/**
 * How much the pill counter-scales for a camera zoom. PURE, so the legibility
 * rule is a testable seam and the plane's zoom is the only input (the layer
 * passes the camera's own value; nothing here re-derives a transform). A zoom
 * that is not a positive finite number answers the ceiling: with no camera
 * there is no reason to shrink the name.
 */
export function pillCounterScale(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return PILL_MAX_COUNTER_SCALE;
  return Math.min(
    PILL_MAX_COUNTER_SCALE,
    Math.max(PILL_MIN_COUNTER_SCALE, 1 / zoom),
  );
}

/**
 * STORY 16.22 — A RECORD FAMILY'S TWO NAME RULES. The pill owns the affordance;
 * the family owns the meaning of a name (which is why the ask card's blank field
 * is a refusal and a session card's is a sentence).
 */
export interface PillNameRules {
  /** What the card SHOWS for a stored name (never invents a record). */
  displayName(name: string): string;
  /** What a commit stores, or null when this family REFUSES a blank field. */
  nameForWrite(name: string): string | null;
}

interface CardNamePillProps {
  /** The record's name — the person's exact words, possibly an empty field. */
  name: string;
  /** The camera's zoom, read from the plane (never re-derived here). */
  zoom: number;
  /**
   * Write a new name through the card's one name path. Optional so a render
   * test needs no writer; the pill then floatingly shows the name but offers
   * no rename (double-click does nothing).
   */
  onRename?: (name: string) => Promise<GroundAddResult>;
  /** The card is mid-write: the field does not open (the verbs' own guard). */
  busy?: boolean;
  /**
   * THIS FAMILY'S NAME RULES. Omitted means the reference card's
   * (`ground`), which is what a reference passes by passing nothing.
   */
  rules?: PillNameRules;
  /** The rename field's label: "rename this reference" / ask card / session card. */
  renameLabel?: string;
  /**
   * WHETHER THIS CARD CAN BE MOVED BY ITS NAME (the handle's promise). True for
   * a reference card, whose press reaches the layer's one drag rule; FALSE for
   * a kind with no move path yet, so the cursor does not promise a drag the app
   * cannot perform. The pill itself still owns no drag either way.
   */
  movable?: boolean;
}

/** The reference card's rules: a blank field is a legal name, not a refusal. */
export const REFERENCE_PILL_RULES: PillNameRules = {
  displayName: groundDisplayName,
  nameForWrite: groundNameForWrite,
};

/**
 * WHAT A COMMIT WOULD WRITE, PURE: the name the record should now hold, or null
 * for NOTHING AT ALL. Two cases write nothing, and they are different facts:
 *
 *   - the family REFUSES the field (an ask card's blank name) — the card keeps
 *     the name it had;
 *   - the stored names are the same — a commit that changes no words is not an
 *     edit, so no writer runs and (because the history logs writes) no line is
 *     appended either.
 *
 * The comparison is stored-name against stored-name, so the family's own rule
 * decides what "the same name" means (a reference's "  " and its "Untitled
 * reference" are the same name; an ask card would have refused the field).
 */
export function pillRenameOutcome(
  stored: string,
  draft: string,
  rules: PillNameRules = REFERENCE_PILL_RULES,
): string | null {
  const next = rules.nameForWrite(draft);
  if (next === null) return null;
  if (next === rules.nameForWrite(stored)) return null;
  return next;
}

export function CardNamePill({
  name,
  zoom,
  onRename,
  busy = false,
  rules = REFERENCE_PILL_RULES,
  renameLabel = "rename this reference",
  movable = true,
}: CardNamePillProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  // Whether the field is still LIVE. Enter commits and then blurs, so the
  // blur handler must not commit a second time; Escape forgets the draft and
  // the same guard keeps its blur from writing anything.
  const liveRef = useRef(false);

  /** Open the field with the old name selected — the rename's whole affordance. */
  function beginRename(): void {
    if (onRename === undefined || busy) return;
    liveRef.current = true;
    setDraft(rules.displayName(name));
    setRenaming(true);
  }

  /**
   * Commit ONCE. An unchanged name writes nothing (a rename that changes no
   * words is not an edit); an empty field is legal and stores the untitled
   * sentence through the record's own rule.
   */
  async function commitRename(): Promise<void> {
    if (!liveRef.current) return;
    liveRef.current = false;
    setRenaming(false);
    if (onRename === undefined) return;
    // The family's write rule, through the pure decision: null means no write
    // at all (a REFUSAL, or a commit that changes no words).
    const next = pillRenameOutcome(name, draft, rules);
    if (next === null) return;
    await onRename(next);
  }

  /** Escape: the stored name returns and nothing is written. */
  function abandonRename(): void {
    liveRef.current = false;
    setRenaming(false);
  }

  return (
    <div
      className="ground-pill"
      style={
        {
          // The layer hands the plane's camera zoom; the pill's one job with it
          // is to stay the same size on screen. CSS owns the transform so the
          // clamp's number is the only thing this component decides.
          "--pill-scale": pillCounterScale(zoom),
          // The handle's cursor tells the truth: a card with no move path does
          // not offer a grab (see NOT YET A MOVE FOR EVERY KIND above).
          "--pill-cursor": movable ? "grab" : "default",
        } as CSSProperties
      }
      title={onRename === undefined ? undefined : "double-click to rename"}
      onDoubleClick={onRename === undefined ? undefined : beginRename}
    >
      {renaming ? (
        <input
          className="ground-pill-input"
          value={draft}
          autoFocus
          aria-label={renameLabel}
          disabled={busy}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // Escape forgets THIS field only: the card stays where it is
              // (its own Esc closes the card, and the stored name was never
              // touched, so abandoning writes nothing).
              e.preventDefault();
              e.stopPropagation();
              abandonRename();
              return;
            }
            if (e.key !== "Enter") return;
            e.preventDefault();
            // Blur is the commit: one handler runs, whatever the exit.
            e.currentTarget.blur();
          }}
        />
      ) : (
        // The name keeps the card heading's own type (canvas.css), so moving
        // it out of the card changes where it sits, never what it reads like.
        <span className="ground-name">{rules.displayName(name)}</span>
      )}
    </div>
  );
}
