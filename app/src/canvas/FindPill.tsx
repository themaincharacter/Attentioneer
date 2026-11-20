import { useEffect, useMemo, useState } from "react";
import { centerOf, GROUND_CARD_BOX, type Point } from "./geometry";

/**
 * STORY 16.33 — FIND ON THE MAP.
 *
 * The map outgrew scrolling: the only way to reach a card used to be panning
 * until its pill came into view. This file is the small search PILL — type,
 * see which cards match, step through them, and land on one with the map
 * centred on it. It is NAVIGATION, not filtering: nothing is hidden, nothing
 * is written and the map's own order is the only order there is.
 *
 * WHAT IS SEARCHED, exactly: a card's NAME and a card's NOTE text (both are
 * local and already loaded). A reading's BODY is not searched — bodies are
 * large, cropped on the face, and searching them would make the field a
 * full-text index rather than a way to find a card. The placeholder says what
 * is searched so the field never promises more than it does.
 *
 * STEPPING IS A POSITION, NEVER A QUALITY. The line reads "3 of 12": the
 * third matching card in the map's own order, out of twelve. There is no
 * score, no ranking, no "best match" and no ordering by how well anything
 * matched — the matcher keeps the map's order and only cuts the list short
 * at a stated bound. Enter steps forward, Shift+Enter back, and both wrap, so
 * stepping through a short list cannot dead-end.
 *
 * THE PILL IS SCREEN SPACE. It is mounted OUTSIDE the plane's transformed
 * content (App renders it beside the canvas), so panning and zooming never
 * move it. It opens on its own verb or the shortcut, closes on Escape or on
 * blur, and it NEVER steals a card's typing: the shortcut declines while a
 * text field has focus, and this file opens no field except its own.
 *
 * PROVISIONAL: the shortcut, the position line's wording (the pure
 * positionLine rule), the empty sentence, the bound and the marker's look.
 * The story names the wording and the shortcut as open.
 */

/** What the field searches — the placeholder names both sources, never more. */
export const FIND_PLACEHOLDER = "search card names and notes";

/** The ONE quiet sentence a query with no matches answers. Not an error. */
export const FIND_NOTHING = "nothing matches";

/**
 * The most matches the pill steps through (PROVISIONAL): a map can hold many
 * cards, and a search should not become a second way to enumerate them. The
 * order is still the map's own — the bound only cuts the tail.
 */
export const FIND_MAX_MATCHES = 50;

/**
 * How long a landed card stays marked (PROVISIONAL, the story's "brief
 * marker"). The marker is view state and clears itself; this is the whole
 * lifetime it is given.
 */
export const FIND_MARK_MS = 1400;

/**
 * One card as the finder sees it: identity, the two searchable texts and its
 * world-space resting point. Pure data — the pill never touches a record.
 */
export interface FindableCard {
  /** Record identity (the slug the card is drawn by). */
  on: string;
  /** The person's exact name — the first thing searched. */
  name: string;
  /** The person's note, when the card has one — the second thing searched. */
  note?: string;
  /** The card's world-space top-left, the point the map draws it at. */
  x: number;
  y: number;
}

/** The one card the pill has landed on, for the map's brief marker. */
export interface FindMark {
  /** The card's slug: the marker is drawn for THIS card, never an index. */
  on: string;
  /** The card's world-space top-left, where the marker is drawn. */
  x: number;
  y: number;
}

/**
 * Which cards match "query": a case-insensitive substring of the NAME or of
 * the NOTE. PURE, so "what is searched" is a testable seam rather than the
 * field handler's only truth.
 *
 * An empty (or whitespace-only) query matches NOTHING and moves nothing: the
 * field is not a way to step through every card, and opening it must leave the
 * map alone. The result keeps the input's order — the map's own — and is cut
 * at FIND_MAX_MATCHES; it is never sorted by how well it matched, because
 * there is no such thing here.
 */
export function findMatches(
  cards: readonly FindableCard[],
  query: string,
): FindableCard[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const matches: FindableCard[] = [];
  for (const card of cards) {
    const inName = card.name.toLowerCase().includes(needle);
    const inNote =
      card.note !== undefined && card.note.toLowerCase().includes(needle);
    if (!inName && !inNote) continue;
    matches.push(card);
    if (matches.length >= FIND_MAX_MATCHES) break;
  }
  return matches;
}

/**
 * The stepping index after one step: forward (+1) or back (-1), WRAPPING at
 * both ends. PURE, so the cycle is the rule's and not the key handler's. A
 * list with nothing in it has nothing to step to, so the index stays where it
 * was — a search that matches nothing moves nothing.
 */
export function nextFindIndex(
  index: number,
  total: number,
  direction: 1 | -1,
): number {
  if (total <= 0) return 0;
  return (index + direction + total) % total;
}

/**
 * The position line: "3 of 12" — where you are in the map's own order, never
 * how good the match is. PURE. An empty result has no position to state, so
 * the line is empty (the field shows its one "nothing matches" sentence).
 */
export function positionLine(index: number, total: number): string {
  if (total <= 0) return "";
  const at = Math.min(Math.max(index, 0), total - 1) + 1;
  return at + " of " + total;
}

/**
 * WHERE A LANDING TARGETS: the CENTRE of the card's resting box, in world
 * units. PURE, and it reuses the one box the map already draws cards in
 * (geometry.ts's GROUND_CARD_BOX), so "land on this card" and the wire anchors
 * cannot disagree. The camera is then asked to PAN that point to the
 * viewport's middle: App's landing path asks the camera's existing centerOn
 * intent at the camera's CURRENT zoom — a pan, never a fit.
 */
export function findLandingPoint(card: FindableCard): Point {
  return centerOf({ x: card.x, y: card.y }, GROUND_CARD_BOX);
}

/** What App tells the pill: where it stands, and how to close or land. */
interface FindPillProps {
  /** Every card on the map, in the map's OWN order. */
  cards: readonly FindableCard[];
  /** True while the field is open (App owns the shortcut's reading). */
  open: boolean;
  /** The verb's press and the shortcut's answer, in one place. */
  onOpen: () => void;
  /** Escape, blur or the close verb. App also clears the marker here. */
  onClose: () => void;
  /** The current match — App pans the map and marks the card. */
  onLand: (card: FindableCard) => void;
}

/**
 * The pill itself. Closed it is one quiet verb ("find"); open it is a field,
 * the position line and a close verb. The field takes focus as it opens, and
 * the only ways out are Escape (which changes nothing else) and blur.
 */
export function FindPill({ cards, open, onOpen, onClose, onLand }: FindPillProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const matches = useMemo(() => findMatches(cards, query), [cards, query]);
  const current = open && matches.length > 0 ? matches[index] ?? null : null;
  // The landing is keyed on WHICH card is current, not on every render: typing
  // two letters that keep the same first match must not pan the map twice, and
  // a re-render for any other reason must not move it at all.
  const landedOn = current === null ? "" : current.on + ":" + index;

  useEffect(() => {
    if (!open || current === null) return;
    onLand(current);
    // The deps are deliberately the LANDING's identity: the current card is
    // derived from the matches, whose array identity changes with every
    // keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, landedOn]);

  // A closed pill forgets its query: opening it again starts from nothing, and
  // the map is never moved by a search the person has already left.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setIndex(0);
  }, [open]);

  // ESCAPE IS THE FIELD'S OWN WHILE IT IS OPEN. The capture listener on the
  // window runs before the cards' (their Esc lives on the document), so one
  // press closes the pill and NOTHING else: no camera call, no card close, no
  // dismissed panel. The event stops here rather than travelling on.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) {
    return (
      // The pill's own verb. One word, no count, no suggestion of what to
      // search for: pressing it opens the field, and that is all it promises.
      <button
        type="button"
        className="find-verb"
        title="find on the map (Ctrl/Cmd+F)"
        onClick={onOpen}
      >
        find
      </button>
    );
  }

  return (
    <div className="find-pill">
      <input
        className="find-field"
        type="text"
        value={query}
        autoFocus
        placeholder={FIND_PLACEHOLDER}
        aria-label={FIND_PLACEHOLDER}
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value);
          // A new query starts at the map's first match.
          setIndex(0);
        }}
        onBlur={onClose}
        onKeyDown={(e) => {
          // Escape is handled a step above, on the window's capture, so no
          // card's own Escape can run for the same press. Here: Enter only.
          if (e.key !== "Enter") return;
          if (matches.length === 0) return;
          e.preventDefault();
          e.stopPropagation();
          setIndex(nextFindIndex(index, matches.length, e.shiftKey ? -1 : 1));
        }}
      />
      <span
        className="find-position"
        aria-live="polite"
        // A press on the line must not blur the field and close the pill.
        onMouseDown={(e) => e.preventDefault()}
      >
        {matches.length === 0 && query.trim() !== ""
          ? FIND_NOTHING
          : positionLine(index, matches.length)}
      </span>
      <button
        type="button"
        className="find-close"
        aria-label="close find"
        title="close find (Esc)"
        // The press keeps the field's focus, so the close is the button's own
        // and not a blur that happens to unmount the pill first.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
