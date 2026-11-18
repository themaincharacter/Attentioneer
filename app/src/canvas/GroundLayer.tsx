import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  loadConceptWord,
  listConceptWords,
  type ConceptWord,
} from "../map/conceptWords";
import type { GroundReference } from "../map/ground";
import { NOTE_PREVIEW_LINES } from "../map/notes";
import {
  PULL_BUDGET_BYTES,
  pullTruncationLine,
  type PulledText,
} from "../map/pull";
import {
  isFileReading,
  pageHost,
  proposeSelectionName,
  previewOverflows,
  previewText,
  READING_PREVIEW_LINES,
  readingAbsolutePath,
  readingExtract,
  readingFileName,
  readingNeedsLine,
  readingStateWord,
  selectionRefusal,
  selectionSourceSlug,
  type Reading,
  type ReadingState,
} from "../map/readings";
import type { Media } from "../map/media";
import { assetSrc } from "./imageSource";
import { pickReadingFile } from "../workspace/dialogs";
import {
  beginGroundDrag,
  dropGroundDrag,
  moveGroundDrag,
  type GroundDragState,
} from "./groundDrag";
import { isGestureArmed, type GestureMode } from "./gates";
import { GESTURE_IDLE, type GestureNarration } from "./gestureWord";
import type { Point } from "./geometry";
import { AskSidecarPanel } from "./AskSidecarPanel";
import { GroundConceptPanel, GroundNote } from "./GroundNote";
import {
  applyMention,
  MentionPicker,
  mentionChoices,
  mentionTrigger,
  nextActive,
  pickerCommand,
  type MentionChoice,
} from "./MentionPicker";
import type { GroundAddResult } from "./useGround";
import type { TurnPort } from "../turn/turn";

/**
 * The ground map's own layer (story 16.1; story 16.2 made the row live; story
 * 16.3 makes it a CARD).
 *
 * The separate-maps rule (ADR-0032, `canvas/mapContentRules.ts`) keeps every
 * CONCEPT-map family off this map; this layer is the ground map's counterpart,
 * a sibling of the words and wires rather than a reuse of them. It draws one
 * ground reference per record, and the person's verdict on stories 1-2 was
 * that the row "dumped the whole text into the map": so every reference is
 * now a CARD.
 *
 * THE CARD (story 16.3), copied in SHAPE from Slashspace's node cards (a
 * quiet surface, a title, a muted cropped body, a meta footer — fixed, never
 * stretching with its content; PROVISIONAL: the dimensions and the six-line
 * crop are ADR-0003's rendering seam, not a design system):
 *   - SMALL (the default): the person's name (17px), the stored reading's
 *     first `READING_PREVIEW_LINES` lines cut by the PURE `previewText`
 *     helper (one trailing ellipsis), and a footer with the file's NAME and,
 *     when it is not `current`, the computed state word.
 *   - EXPANDED: the same card, larger and fixed, whose body SCROLLS the
 *     STORED reading. It never re-reads anything: no bridge call, no fetch,
 *     no new I/O — the text is the `texts` prop the load already read, and a
 *     refused/absent reading simply has nothing to scroll. Wheel presses are
 *     stopped on the body so the plane's zoom cannot steal the scroll.
 *   - OPEN/CLOSED is VIEW state, never a record: reopening the workspace shows
 *     every card small, and no write path here touches a file.
 *   - A press on a card opens it; a press away (or Esc) closes it. The drag
 *     still owns a press that moves (story 16.2), so a drag never opens.
 *
 * STORY 16.2's three quiet things stay exactly as they were: the STATE WORD,
 * the DRAG (one `x | y` write on release through the app's queue), and the two
 * person-pressed re-reads (refresh, point at another file).
 *
 * STORY 16.3's DELETE was a two-step inline confirm; STORY 16.13 REMOVES it
 * (shortlist item 1): `remove` deletes at once and the app's toast is the only
 * guard, with Restore writing the same bytes back. The layer still hands the
 * one write path (`useGround.remove`) — the card never touches a file. When a
 * refused unlink answers its one sentence the card is already gone, so the
 * sentence is shown where it stood.
 *
 * STORY 16.13 also gives every card a THREE-LINE GRAMMAR (shortlist item 3):
 * the name, one quiet line saying what this is, then the reading — or, when
 * there is no stored text, the refusal/state sentence in the reading's place.
 * STORY 16.14 adds an IMAGE line above the reading (name → what this is →
 * image → reading): only the LOCAL copy the map holds, so it renders offline
 * with no request; a page says its copied TITLE as "what this is" and its
 * HOST in the footer, never the full address.
 * A selection's verbs are not silently absent: one quiet line says why there
 * is nothing to refresh or point at (shortlist item 2).
 *
 * STORY 16.15 gives the card two more reference kinds and NO new reading: an
 * IMAGE is drawn from the person's own file through the asset protocol (never
 * copied) with the line "this needs a model that can read images."; a VIDEO
 * shows the copied title and thumbnail with "the transcript needs a model that
 * can read video." Neither pretends to have a reading, and neither is an error:
 * a missing image file says so plainly and claims no kept copy.
 *
 * STORY 16.5 adds ONE small affordance and no meaning: a quiet link handle on
 * the card's edge, hover-revealed like the verbs. A drag from it onto another
 * card wires the two WORDLESSLY (the wire itself is `GroundWires`); the card's
 * body keeps the 4px press-to-open vs drag-to-move rule untouched, and the
 * handle is handled before that rule because it is a button that starts its
 * own gesture. There is no label, no count and no nudge here either.
 *
 * STORY 16.6 gives the card a NOTE — the person's own words, in a file BESIDE
 * the reading and never mixed into it. The small face shows a crop of the note
 * (the first `NOTE_PREVIEW_LINES` lines, cut by the same PURE `previewText`
 * helper) above the reading crop; the expanded face shows the whole note above
 * the whole reading. An edit verb on the expanded card turns the note into a
 * textarea IN PLACE: Enter inserts a newline, the done verb or a press away
 * saves, and Esc abandons the edit and restores the stored note. The layer
 * still holds no bridge and does no I/O: saving is the `onSetNote` prop
 * (`useGround.setNote`), and an abandoned edit writes nothing at all.
 * PROVISIONAL: the crop, the edit's verbs and the note's face (the story's
 * record shape is provisional too).
 *
 * STORY 16.7 adds MENTIONS to that note and NOTHING ELSE. Typing `@` at a word
 * boundary in the editor opens the picker (`MentionPicker`): ground cards first,
 * then concept words, marked as concepts. Inserting one writes the PLAIN-TEXT
 * form `[@Label](card://slug)` / `[@Label](word://slug)` into the draft, and the
 * note's existing save path is the only thing that ever writes — a mention is
 * text, never a record. Drawn on the card they are quiet chips
 * (`GroundNote`): a card chip opens that card, a word chip opens a small
 * read-only panel with the concept's name and memory, and a chip whose target
 * is gone is muted, says "missing" and does nothing — never removed, never
 * reported as malformed.
 *
 * STORY 16.8 adds the PULL's one verb and its one block, and nothing else.
 * On the EXPANDED card, "read more" asks `useGround.pull` for more of the
 * card's source under the stated budget; what comes back is drawn BELOW the
 * stored reading as a continuation (same type, one hairline — not a second
 * card), with the one truncation line when the budget bit and a "dismiss" that
 * forgets it. The pulled text is VIEW STATE and nothing here re-reads on open,
 * watches or polls: the button is the only call site, and the layer holds no
 * bridge. Closing the card (or opening another) dismisses the pull through the
 * pure `pullToDismiss` rule, so reopening the workspace can never restore it.
 * PROVISIONAL: the verb's placement, the block's typography and the dismissal.
 *
 * THE ONE CROSS-MAP READ (amended ADR-0032) is this layer's, confined to
 * `map/conceptWords.ts`: the concept map's word index is read ONCE per ground
 * map open (read-only, no writer imported) so a word chip can be drawn dangling
 * honestly and the picker can offer the vocabulary. Nothing is copied into the
 * ground map and nothing is merged into a note. PROVISIONAL: the eager index
 * read (a later story may scope it), and the open-card view state below.
 *
 * STORY 17 (shortlist items 7-9) — THE TYPE SYSTEM's one visible consequence:
 * the small card's CROP IS A STATED PREFERENCE. `previewLines` and `noteLines`
 * arrive as props (lib/readingPreference.ts owns their bounds, Settings states
 * them), so the pure `previewText` helper reads the same number the CSS clamp
 * does and a changed threshold re-crops every card without a reload. The cut is
 * drawn with a soft fade and ONE small verb, "more", which opens the card —
 * never a hard edge and never a number. A card whose text fits its threshold
 * draws no cut at all; the fade is the fold's sign, not decoration.
 *
 * Nothing counts, sums, scores or nudges; every string here is either the
 * person's words or a fact the map already holds.
 */

/**
 * STORY 16.13 (shortlist item 1) — the card's delete is IMMEDIATE. The two-step
 * confirm is gone; the toast's Restore is the only guard, and a second delete
 * commits the first. Kept as a constant (not a function) so nothing can quietly
 * reintroduce a confirming press.
 */
export const DELETE_IS_IMMEDIATE = true;

/**
 * Which card's pull leaves view when the open card changes (story 16.8).
 * PURE, so "closing the card clears the pulled text" is not the effect's only
 * truth: the same slug staying open keeps its look (a re-render must not
 * discard it), while closing or opening another card dismisses the old one.
 */
export function pullToDismiss(
  previous: string | null,
  next: string | null,
): string | null {
  return previous !== null && previous !== next ? previous : null;
}

/**
 * STORY 16.12 — WHERE THE NEW CARD GOES: beside its source, at the same scale,
 * offset by a little more than a card's own width so the two never overlap.
 * PURE, so the placement is not the confirm handler's only truth.
 */
export const SELECTION_OFFSET_X = 320;

export function selectionPlacement(x: number, y: number): Point {
  return { x: x + SELECTION_OFFSET_X, y };
}

/** The one quiet line for a source the map no longer carries (PROVISIONAL). */
export const SELECTION_MISSING_SOURCE = "from a card that is gone";

/**
 * The footer's attribution (story 16.12): a FILE reading shows its file's NAME
 * (never a path, the existing rule); a SELECTION shows its SOURCE CARD's name,
 * and a source the map no longer carries is said quietly rather than repaired.
 * PURE, so the rule is not the JSX's alone.
 */
export function readingProvenance(
  reading: Reading,
  cardNames: ReadonlyMap<string, string>,
): string {
  // STORY 16.14: a page's footer shows its HOST only. The full URL stays in
  // the record; the map's plane is not a list of links.
  if (reading.form === "url") return pageHost(reading.from);
  const source = selectionSourceSlug(reading);
  if (source === null) return readingFileName(reading.from);
  const name = cardNames.get(source);
  return name === undefined ? SELECTION_MISSING_SOURCE : "from " + name;
}

/**
 * STORY 16.13 (shortlist items 3 and 10) — WHAT THIS IS, the card's second line.
 * A file reading is the copy kept from that file; a selection is a copy of
 * text taken from another card (the source named when the map still has it);
 * a reference with no reading says exactly that. PURE, so the sentence is not
 * the JSX's only truth. PROVISIONAL wording.
 */
export function readingKind(
  reading: Reading | null,
  cardNames: ReadonlyMap<string, string>,
  pageTitle: string | null = null,
): string {
  if (reading === null) return "a reference with no reading";
  // STORY 16.15: an IMAGE never says "the reading kept from" — there is no
  // reading, only the person's own file, drawn where it is.
  if (readingExtract(reading) === "image") {
    return "the image from " + readingFileName(reading.from);
  }
  // STORY 16.14: a page says WHAT IT IS with its own copied title; a page whose
  // media line is missing (or carries no title) still names its host. STORY
  // 16.15 reuses that for a video — the title is the media line's.
  if (reading.form === "url") {
    if (pageTitle !== null && pageTitle.trim() !== "") return pageTitle;
    const noun = readingExtract(reading) === "video" ? "video" : "page";
    return "the " + noun + " kept from " + pageHost(reading.from);
  }
  const source = selectionSourceSlug(reading);
  if (source !== null) {
    const name = cardNames.get(source);
    return name === undefined
      ? "a copy of text selected from a card that is gone"
      : "a copy of text selected from " + name;
  }
  return "the reading kept from " + readingFileName(reading.from);
}

/**
 * STORY 16.13 (shortlist item 3) — the THIRD line when the reading text is not
 * here: a refused or absent reading still renders as a card, and this sentence
 * says what happened instead of leaving a broken box. It never claims a kept
 * copy that is not on disk. PURE. PROVISIONAL wording.
 */
export function readingAbsenceLine(
  state: ReadingState,
  reading: Reading | null = null,
): string {
  // STORY 16.15: an image is never copied, so its absence must not claim a
  // "copy kept" — there is nothing but the file the card draws. A video's
  // artifact is its media line, and its absence is the look that never came.
  const image = reading !== null && readingExtract(reading) === "image";
  const video = reading !== null && readingExtract(reading) === "video";
  switch (state) {
    case "missing":
      if (image) return "the image's file is not there, and no copy was kept.";
      return "the file is gone, and no copy was kept.";
    case "unreadable":
      if (image) return "the image cannot be read, and no copy was kept.";
      return "the file cannot be read, and no copy was kept.";
    case "unread":
      if (video) return "no title or thumbnail was kept for this video.";
      return "no reading was taken yet.";
    case "changed":
      return "the file has changed, and no copy was kept.";
    case "current":
      return "the reading text is not here.";
  }
}

/**
 * STORY 16.13 (shortlist item 3) — a ground map with no references says so in
 * ONE muted sentence: no verb, no illustration, no call to action. The sentence
 * replaces the plane's ordinary hint, so the empty map offers nothing to do.
 * PROVISIONAL wording.
 */
export const GROUND_EMPTY_SENTENCE = "nothing on this map yet";

/** The empty map's one quiet line (mounted in screen space by App). */
export function GroundEmpty() {
  return (
    <div className="ground-empty" role="status">
      {GROUND_EMPTY_SENTENCE}
    </div>
  );
}

interface GroundLayerProps {
  /** Every readable ground reference, in FILE ORDER. */
  references: readonly GroundReference[];
  /** The reading lines, keyed by slug (the handle's source). */
  readings: readonly Reading[];
  /**
   * Each media-bearing card's line (story 16.14). Optional so a render test
   * needs no page; the app always passes `useGround.media`.
   */
  media?: readonly Media[];
  /**
   * Each card's thumbnail source, read offline into a data URL (story 16.14).
   * Absent means no image line.
   */
  thumbs?: Readonly<Record<string, string>>;
  /** The reading texts, keyed by slug (a missing text is absent). */
  texts: Readonly<Record<string, string>>;
  /** The person's notes, keyed by slug (a card with no note is absent). */
  notes?: Readonly<Record<string, string>>;
  /**
   * Each card's EPHEMERAL pull (story 16.8), keyed by slug. A look, not a
   * record: it is dismissed when the card closes. Optional so a render test
   * needs no hook; the app always passes `useGround.pulled`.
   */
  pulled?: Readonly<Record<string, PulledText>>;
  /** Each reference's computed reading state (never a record field). */
  states: Readonly<Record<string, ReadingState>>;
  /** Move one reference to its dropped point (one line, on release). */
  onMove: (on: string, x: number, y: number) => Promise<GroundAddResult>;
  /** Re-read this reference's file (the person's press only). */
  onRefresh: (on: string) => Promise<GroundAddResult>;
  /** Point this reference at another file (a new pick, one write). */
  onRepoint: (on: string, from: string) => Promise<GroundAddResult>;
  /** Remove this reference, its reading and its kept text (story 16.3). */
  onRemove: (on: string) => Promise<GroundAddResult>;
  /**
   * Make a new card out of a selection inside this card's expanded reading
   * (story 16.12): the exact bytes, the source's slug as provenance, and a
   * name the person confirmed. Optional so a render test needs no write path.
   */
  onCreateSelection?: (
    sourceSlug: string,
    name: string,
    x: number,
    y: number,
    text: string,
  ) => Promise<GroundAddResult>;
  /**
   * Save this card's note (story 16.6). Optional so a render test needs no
   * write path; the app always passes `useGround.setNote`.
   */
  onSetNote?: (on: string, text: string) => Promise<GroundAddResult>;
  /**
   * Pull more of this card's source under the stated budget (story 16.8):
   * READ-ONLY. The text goes to the hook's view state; nothing is written and
   * nothing is re-stamped. Optional so a render test needs no hook.
   */
  onPull?: (on: string) => Promise<GroundAddResult>;
  /** Forget one card's pulled text (view state only — nothing is written). */
  onDismissPull?: (on: string) => void;
  /**
   * Draw one WORDLESS link from this card to another (story 16.5): released on
   * a card's body, it is one ordered pair and one write. Optional so a render
   * test needs no plane; the app always passes the real write path.
   */
  onLink?: (from: string, to: string) => Promise<GroundAddResult>;
  /**
   * THE ASK (Epic 15 story 1): the app's turn port, handed to the expanded
   * card's `ask…` verb. Optional so a render test needs no sidecar; the app
   * passes the real one. The turn is NOT a move — nothing on this map is
   * written by asking, and the panel keeps its own view state.
   */
  onAsk?: TurnPort;
  /**
   * Open Settings on its Providers section (story 15.10). The card's ask keeps
   * only a selector and this shortcut — the rows are edited in Settings, never
   * inline. Optional so a render test needs no app chrome.
   */
  onConfigure?: () => void;
  /**
   * Bumped by the app when Settings changed the rows, so the open card's ask
   * re-reads its selector (a row added or removed is never stale on screen).
   */
  providersRev?: number;
  /**
   * The workspace root, for the ONE cross-map read (story 16.7): the concept
   * map's word index, read-only, so a word mention can be drawn live or
   * dangling and the picker can offer the vocabulary. Optional so a render
   * test needs no workspace; the app always passes the real root.
   */
  workspacePath?: string;
  /**
   * STORY 16.16 (shortlist item 4) — tell the app what the hand is doing, so
   * the cursor chip can say it (a moving card by its own name, a link drag).
   * VIEW STATE only: the layer reports the gesture, it never writes anything
   * for it, and the chip is mounted in screen space by App.
   */
  onNarrate?: (gesture: GestureNarration) => void;
  /** How a gesture is armed right now — a drag stands still while armed. */
  interactionMode?: GestureMode;
  /**
   * STORY 17 (shortlist item 7-9) — HOW MANY LINES THE SMALL FACE SHOWS. The
   * person's stated threshold from Settings (lib/readingPreference.ts bounds
   * it); the crop and the CSS clamp both read it. Optional so a render test
   * needs no config, in which case the module's own default stands.
   */
  previewLines?: number;
  /** STORY 17: the note's own stated count (the same preference, its own key). */
  noteLines?: number;
  /**
   * The camera's zoom, for the drag's screen→world conversion. Optional so a
   * render test needs no plane; the app always passes the real camera.
   */
  zoom?: number;
}

export function GroundLayer({
  references,
  readings,
  media = [],
  thumbs = {},
  texts,
  notes = {},
  pulled = {},
  states,
  onMove,
  onRefresh,
  onRepoint,
  onRemove,
  onCreateSelection,
  onSetNote,
  onPull,
  onDismissPull,
  onLink,
  onAsk,
  onConfigure,
  providersRev = 0,
  workspacePath = "",
  onNarrate,
  interactionMode = "idle",
  previewLines = READING_PREVIEW_LINES,
  noteLines = NOTE_PREVIEW_LINES,
  zoom = 1,
}: GroundLayerProps) {
  // onConfigure and providersRev are the GroundLayer's own props; the cards
  // below receive them so an open card ask can open Settings and reload.
  const readingsBySlug = new Map(readings.map((reading) => [reading.on, reading]));
  const mediaBySlug = new Map(media.map((entry) => [entry.on, entry]));
  // STORY 16.7 — WHICH card is expanded is the LAYER's view state, not each
  // card's: a card mention must be able to open ANOTHER card. It is still view
  // state only (a reopened workspace shows every card small) and no write
  // path here touches a file.
  const [openOn, setOpenOn] = useState<string | null>(null);
  // The concept map's word index, read once per workspace through the ONE
  // cross-map helper. `null` means "not read yet" — never "empty" — so a word
  // mention is not called dangling on ignorance.
  const [concepts, setConcepts] = useState<readonly ConceptWord[] | null>(null);

  useEffect(() => {
    setConcepts(null);
    if (workspacePath === "") return;
    let alive = true;
    listConceptWords(workspacePath)
      .then((words) => {
        if (alive) setConcepts(words);
      })
      .catch(() => {
        // An unreadable concept map is honest ignorance: the picker shows what
        // exists (the cards) and no word chip is called dangling.
        if (alive) setConcepts(null);
      });
    return () => {
      alive = false;
    };
  }, [workspacePath]);

  useEffect(() => {
    // A card that went away (its delete, a reload) cannot stay open.
    if (openOn !== null && !references.some((reference) => reference.on === openOn)) {
      setOpenOn(null);
    }
  }, [references, openOn]);

  // STORY 16.8 — CLOSING THE CARD FORGETS THE LOOK. A pull is view state, so
  // there is nothing to delete on disk; the pure rule names the card whose
  // look leaves when the open card changes, and the hook drops that key. The
  // ref is the PREVIOUS open card (this effect runs after each change).
  const openRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = openRef.current;
    openRef.current = openOn;
    const stale = pullToDismiss(previous, openOn);
    if (stale !== null) onDismissPull?.(stale);
  }, [openOn, onDismissPull]);

  // A refused unlink's one sentence: the card is gone with its records, so the
  // sentence is shown where it stood (view state, cleared by a press or a
  // reload — it is never written anywhere).
  const [refusal, setRefusal] = useState<{
    x: number;
    y: number;
    message: string;
  } | null>(null);

  async function remove(reference: GroundReference): Promise<GroundAddResult> {
    const result = await onRemove(reference.on);
    if (!result.ok && result.recordsRemoved === true) {
      // The card left with its records: show the unlink's one sentence where
      // it stood. A refusal that kept the card shows on the card itself.
      setRefusal({ x: reference.x, y: reference.y, message: result.message });
    } else {
      setRefusal(null);
    }
    return result;
  }

  // The names a mention may draw and a picker may offer: the map's own cards,
  // already loaded (the card mention is the one expected to be used most).
  const cardNames = new Map(
    references.map((reference) => [reference.on, reference.name] as const),
  );
  const wordSlugs =
    concepts === null ? null : new Set(concepts.map((word) => word.slug));
  // The ONE read a word chip does: the concept's name and memory, or null when
  // the target is gone (the chip then dangles instead of opening anything).
  const readWord = (slug: string): Promise<ConceptWord | null> =>
    workspacePath === "" ? Promise.resolve(null) : loadConceptWord(workspacePath, slug);

  return (
    <div className="ground-layer">
      {references.map((reference) => (
        <GroundCard
          key={reference.on}
          reference={reference}
          reading={readingsBySlug.get(reference.on) ?? null}
          media={mediaBySlug.get(reference.on) ?? null}
          thumbSrc={thumbs[reference.on]}
          text={texts[reference.on]}
          note={notes[reference.on]}
          pulled={pulled[reference.on]}
          state={states[reference.on] ?? (readingsBySlug.has(reference.on) ? "current" : "unread")}
          open={openOn === reference.on}
          onOpen={() => setOpenOn(reference.on)}
          onOpenCard={(slug) => setOpenOn(slug)}
          onClose={() => setOpenOn(null)}
          cardNames={cardNames}
          wordSlugs={wordSlugs}
          concepts={concepts}
          readWord={readWord}
          interactionMode={interactionMode}
          zoom={zoom}
          onMove={onMove}
          onRefresh={onRefresh}
          onRepoint={onRepoint}
          onRemove={remove}
          onCreateSelection={onCreateSelection}
          onSetNote={onSetNote}
          onPull={onPull}
          onDismissPull={onDismissPull}
          onLink={onLink}
          onAsk={onAsk}
          onConfigure={onConfigure}
          providersRev={providersRev}
          workspacePath={workspacePath}
          onNarrate={onNarrate}
          previewLines={previewLines}
          noteLines={noteLines}
        />
      ))}
      {refusal !== null && (
        <div
          className="ground-problem ground-removal-problem"
          style={{ left: refusal.x, top: refusal.y }}
          role="status"
          onClick={() => setRefusal(null)}
        >
          {refusal.message}
        </div>
      )}
    </div>
  );
}

/**
 * THE PULLED BLOCK (story 16.8): what the person asked to see more of, drawn
 * as a CONTINUATION of the stored reading rather than a second card — same
 * type and ink, one quiet hairline, no surface of its own. The truncation line
 * is the only place the budget's number is spoken, and only when it bit; the
 * dismiss verb forgets the look (view state — there is no file behind it).
 *
 * Its own component so a render test can pin the words without opening a
 * card. PROVISIONAL: the block's look and the dismiss verb's placement.
 */
export function GroundPulled({
  pulled,
  onDismiss,
  budget = PULL_BUDGET_BYTES,
}: {
  pulled: PulledText;
  onDismiss?: () => void;
  budget?: number;
}) {
  return (
    <div className="ground-pulled">
      <div className="ground-pulled-text">{pulled.text}</div>
      {pulled.truncated && (
        <div className="ground-pulled-note" role="status">
          {pullTruncationLine(budget)}
        </div>
      )}
      <button
        type="button"
        className="ground-pulled-dismiss"
        onClick={onDismiss}
      >
        dismiss
      </button>
    </div>
  );
}

/**
 * ONE reference's card. It owns its press handling because a drag is per-card
 * state; the layer only hands it records and the person's verbs.
 */
function GroundCard({
  reference,
  reading,
  media,
  thumbSrc,
  text,
  note,
  pulled,
  state,
  open,
  onOpen,
  onOpenCard,
  onClose,
  cardNames,
  wordSlugs,
  concepts,
  readWord,
  interactionMode,
  zoom,
  onMove,
  onRefresh,
  onRepoint,
  onRemove,
  onCreateSelection,
  onSetNote,
  onPull,
  onDismissPull,
  onLink,
  onAsk,
  onConfigure,
  providersRev,
  workspacePath,
  onNarrate,
  previewLines,
  noteLines,
}: {
  reference: GroundReference;
  reading: Reading | null;
  /** This card's media line (story 16.14), or null when it has none. */
  media: Media | null;
  /** The page's local image as a data URL, or undefined (no image line). */
  thumbSrc: string | undefined;
  text: string | undefined;
  note: string | undefined;
  /** This card's ephemeral pull, when the person asked for more (16.8). */
  pulled: PulledText | undefined;
  state: ReadingState;
  /** Is this card expanded? (The LAYER's view state — a chip can open a card.) */
  open: boolean;
  onOpen: () => void;
  /** Open ANOTHER card by slug (a mention's click: navigation, view state). */
  onOpenCard: (slug: string) => void;
  onClose: () => void;
  /** Every ground card's name, for a chip's label fallback and the picker. */
  cardNames: ReadonlyMap<string, string>;
  /** Every concept word's slug, or null when the concept map was not read. */
  wordSlugs: ReadonlySet<string> | null;
  /** The concept index the picker offers (null: not read). */
  concepts: readonly ConceptWord[] | null;
  /** The ONE cross-map read: a word mention's name and memory, or null. */
  readWord: (slug: string) => Promise<ConceptWord | null>;
  interactionMode: GestureMode;
  zoom: number;
  onMove: GroundLayerProps["onMove"];
  onRefresh: GroundLayerProps["onRefresh"];
  onRepoint: GroundLayerProps["onRepoint"];
  onRemove: (reference: GroundReference) => Promise<GroundAddResult>;
  /** Story 16.12: make a new card out of this card's selected reading bytes. */
  onCreateSelection?: (
    sourceSlug: string,
    name: string,
    x: number,
    y: number,
    text: string,
  ) => Promise<GroundAddResult>;
  onSetNote?: (on: string, text: string) => Promise<GroundAddResult>;
  onPull?: (on: string) => Promise<GroundAddResult>;
  onDismissPull?: (on: string) => void;
  onLink?: (from: string, to: string) => Promise<GroundAddResult>;
  /** The app's turn port for the expanded card's `ask…` verb (story 15.1). */
  onAsk?: TurnPort;
  /** Open Settings on Providers (story 15.10): the ask's only configure door. */
  onConfigure?: () => void;
  /** Bumped when Settings changed the rows (the ask re-reads its selector). */
  providersRev?: number;
  /** The workspace root, for the card ask's ONE follow-up read (story 3b). */
  workspacePath?: string;
  /** STORY 16.16: the app's one narration sink (the cursor chip's state). */
  onNarrate?: (gesture: GestureNarration) => void;
  /** STORY 17: the stated fold threshold, already bounded (preview + note). */
  previewLines: number;
  noteLines: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // STORY 16.12: the expanded card's READING is the selection surface.
  const readingRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<GroundDragState | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // STORY 16.7 — the picker and the concept panel are VIEW state too. The
  // picker holds the trigger's range so an insertion replaces exactly the typed
  // `@query`; the panel holds the word the person just opened.
  const [picker, setPicker] = useState<{
    start: number;
    caret: number;
    query: string;
    active: number;
  } | null>(null);
  const [panel, setPanel] = useState<{ name: string; memory: string } | null>(
    null,
  );
  // Words the concept map no longer has: pressing a stale chip makes it dangle
  // locally (view state, never a record), exactly like a chip whose target was
  // gone before the workspace opened.
  const [gone, setGone] = useState<readonly string[]>([]);
  // STORY 15.1 — the ask panel is VIEW state too: opening it writes nothing,
  // closing it forgets the answer, and the turn itself never touches the map.
  // It exists only on the OPEN card.
  const [asking, setAsking] = useState(false);
  // STORY 16.12 — THE SELECTION is view state of the OPEN card: the exact text
  // the person selected in its reading, and the PROPOSED name once they press
  // `ask about this`. Nothing is created until they confirm; a collapse, a
  // close or a cancel forgets both.
  const [selected, setSelected] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ text: string; name: string } | null>(
    null,
  );
  // STORY 16.6 — the note's edit is VIEW state, like open/closed: nothing is
  // written until a save, and Esc leaves the stored note exactly as it was.
  // The refs mirror the draft so the press-away and Esc listeners (registered
  // once per open) read the CURRENT draft, not the one from their render.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const editingRef = useRef(false);
  const draftRef = useRef("");
  const storedNoteRef = useRef(note ?? "");
  // The stored note is the prop the load handed in; keep the comparison fresh
  // so "done" with an unchanged draft writes nothing at all.
  storedNoteRef.current = note ?? "";

  // STORY 16.7 — a CLOSED card shows no picker and no concept panel: both are
  // view state of the open face, and every close path (a press away, Esc, a
  // chip opening another card) goes through the layer's one `open` prop.
  useEffect(() => {
    if (open) return;
    setPicker(null);
    setPanel(null);
    setAsking(false);
    // Story 16.12: a closed card cannot offer a selection it no longer shows.
    setSelected(null);
    setNaming(null);
  }, [open]);

  // STORY 16.12 — THE SELECTION WATCHER. While the card is open, the DOM's
  // selection is read whenever it changes; the affordance exists only when the
  // selection is INSIDE this card's reading (a selection on the small card, in
  // the note or on the plane is not one) and it goes away the moment the
  // selection collapses. The text is taken EXACTLY as the selection reports it
  // — no trim, no re-wrap — because those bytes become the new card's reading.
  useEffect(() => {
    if (!open) return;
    function syncSelection() {
      const selection = window.getSelection();
      const reading = readingRef.current;
      if (reading === null || selection === null || selection.isCollapsed) {
        setSelected(null);
        return;
      }
      if (selection.rangeCount === 0) {
        setSelected(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (
        !reading.contains(range.startContainer) ||
        !reading.contains(range.endContainer)
      ) {
        setSelected(null);
        return;
      }
      const text = selection.toString();
      setSelected(text === "" ? null : text);
    }
    document.addEventListener("selectionchange", syncSelection);
    return () => document.removeEventListener("selectionchange", syncSelection);
  }, [open]);

  // Raw listener: d3-zoom stops mousedown at the plane (stopImmediatePropagation),
  // so React's synthetic onMouseDown never fires under it. This raw listener is
  // registered before d3 attaches and stops the press here, so a card press can
  // never pan the plane, count as empty paper or start another gesture.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    function handleMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      e.stopPropagation();

      // STORY 16.5 — THE LINK HANDLE: a NEW small affordance on the card's
      // edge, never a new meaning for the card's own press. A drag from it
      // wires this card to whichever card it is released on; a release on
      // empty paper, on this card itself, or Esc cancels and writes nothing.
      // It must be handled BEFORE the generic button check below, because it
      // is a button whose press starts a gesture of its own.
      if ((e.target as HTMLElement).closest(".ground-link-handle")) {
        if (isGestureArmed(interactionMode) || onLink === undefined) return;
        e.preventDefault();
        // STORY 16.16 (shortlist item 4): the wiring drag is a gesture with a
        // sentence of its own, and the chip says it until the release. The
        // report is view state — the wire itself is still one write, below.
        onNarrate?.({ kind: "wiring" });
        let cancelled = false;
        const finish = () => {
          window.removeEventListener("mouseup", onLinkUp);
          window.removeEventListener("keydown", onLinkKey);
          onNarrate?.(GESTURE_IDLE);
        };
        const onLinkKey = (ev: KeyboardEvent) => {
          if (ev.key !== "Escape") return;
          cancelled = true;
          finish();
        };
        const onLinkUp = (ev: MouseEvent) => {
          finish();
          if (cancelled) return;
          // Element-under-pointer, never nearest-card math: the drag names the
          // card it was actually released on (the ring-bind idiom, ADR-0016).
          const under = document.elementFromPoint(ev.clientX, ev.clientY);
          const card =
            under instanceof Element
              ? under.closest(".ground-reference")
              : null;
          const slug = card === null ? null : card.getAttribute("data-slug");
          if (slug === null || slug === reference.on) return;
          void onLink(reference.on, slug);
        };
        window.addEventListener("mouseup", onLinkUp);
        window.addEventListener("keydown", onLinkKey);
        return;
      }

      // The affordances are ordinary buttons: their own click handlers own the
      // press, and a press on one is never the start of a card drag. The note's
      // textarea is the same kind of surface: a press in it edits text, never
      // starts a drag (story 16.6).
      if ((e.target as HTMLElement).closest("button")) return;
      if ((e.target as HTMLElement).closest("textarea, input")) return;
      // STORY 16.12: the EXPANDED card's reading is a SELECTION surface. A
      // press there begins text selection, never a card drag — the small card
      // stays a crop (there is nothing to select on it).
      if (open && (e.target as HTMLElement).closest(".ground-reading")) return;
      // Story 15.1: the ask panel is a surface, not the card's body — a press
      // on its labels, its head or its answer must not start a card drag.
      if ((e.target as HTMLElement).closest(".ground-ask-panel")) return;
      // While a gesture is armed every plane press stands still — the card's
      // drag included (ADR-0016's gate).
      if (isGestureArmed(interactionMode)) return;

      let drag = beginGroundDrag(
        { x: reference.x, y: reference.y },
        { x: e.clientX, y: e.clientY },
        zoom,
      );
      dragRef.current = drag;

      const onMouseMove = (ev: MouseEvent) => {
        const wasMoving = drag.moved;
        drag = moveGroundDrag(drag, { x: ev.clientX, y: ev.clientY });
        dragRef.current = drag;
        // STORY 16.16 (shortlist item 4): the chip speaks ONCE, when the press
        // crosses the drag threshold — the card is being moved, by its name.
        // Reported on the crossing, not on every frame: the sentence does not
        // change and the app is not asked to re-render for it.
        if (drag.moved && !wasMoving) {
          onNarrate?.({ kind: "moving", name: reference.name });
        }
        if (drag.moved) setDragPos(drag.at);
      };
      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        const dropped = dropGroundDrag(drag);
        dragRef.current = null;
        // The gesture is over, moved or not: the chip clears with the release.
        onNarrate?.(GESTURE_IDLE);
        setDragPos(null);
        // ONE write, on release: the drag's path is never a record.
        const point = dropped[0];
        if (point) {
          void onMove(reference.on, point.x, point.y);
          return;
        }
        // A press that never moved OPENS the card: the expanded face shows
        // the stored reading. A drag never opens (the drop above returns
        // first). STORY 16.13: there is no delete ask left to back out of.
        onOpen();
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    el.addEventListener("mousedown", handleMouseDown);
    return () => el.removeEventListener("mousedown", handleMouseDown);
  });

  // Click away / Esc closes. Capture so a plane press that d3 handles still
  // counts as a press away. The concept panel keeps the listener live on the
  // SMALL card too (story 16.7), where it is a view that a press away closes.
  useEffect(() => {
    if (!open && panel === null) return;
    function onPressAway(e: MouseEvent) {
      const el = cardRef.current;
      if (el !== null && e.target instanceof Node && el.contains(e.target)) return;
      // Story 16.6: a press away is the note editor's SAVE (the story's rule —
      // click away or the done verb saves). Fire-and-forget: the write goes
      // through the app's queue, and a refusal shows its one sentence on the
      // card. An abandoned edit (Esc) never reaches here.
      if (editingRef.current) void saveNoteDraft();
      // Story 16.7: the picker and the concept panel are view state of an open
      // card, so a press away closes them with it. Nothing is written by that.
      // Story 15.1: the ask panel is the same kind of view — closing the card
      // forgets the answer, and no turn is left behind (its stop is the panel's
      // timeout; nothing here writes).
      setPicker(null);
      setPanel(null);
      setAsking(false);
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Esc abandons the edit FIRST: it restores the stored note and leaves the
      // card open, so the person can keep looking at what was there.
      if (editingRef.current) {
        cancelNoteEdit();
        return;
      }
      // Story 16.7: Esc closes the read-only concept panel FIRST, so the card
      // (and the reading under it) stays where the person was looking.
      if (panel !== null) {
        setPanel(null);
        return;
      }
      // Story 15.1: Esc closes the ASK panel first, leaving the card (and its
      // reading) where the person was looking.
      if (asking) {
        setAsking(false);
        return;
      }
      onClose();
    }
    document.addEventListener("mousedown", onPressAway, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPressAway, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, panel, asking]);

  // The expanded body scrolls the STORED reading; the plane's wheel zoom must
  // not steal the scroll. Passive: this only stops the plane, never the page.
  useEffect(() => {
    const el = bodyRef.current;
    if (el === null || !open) return;
    function onWheel(e: WheelEvent) {
      e.stopPropagation();
    }
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  const word = readingStateWord(state, reading);
  const x = dragPos ? dragPos.x : reference.x;
  const y = dragPos ? dragPos.y : reference.y;
  const shownText = text === undefined || text === "" ? null : text;
  // Story 16.6: the note is the person's own text, never joined with the
  // reading. The small face crops it with the SAME pure helper; the expanded
  // face shows every line the file holds.
  const shownNote = note === undefined || note === "" ? null : note;
  // STORY 17 (shortlist items 7–9): the small face is cropped at the person's
  // STATED threshold, and the fold's fade + "more" are drawn only when
  // something is actually folded away. The expanded face is the stored text
  // itself, untouched. Neither path reads anything.
  const bodyText =
    shownText === null
      ? null
      : open
        ? shownText
        : previewText(shownText, previewLines);
  // A note and a reading fold independently (each has its own stated count),
  // and either one puts the card's ONE verb on the face.
  const noteFolded =
    shownNote !== null && !open && previewOverflows(shownNote, noteLines);
  const readingFolded =
    shownText !== null && !open && previewOverflows(shownText, previewLines);
  const folded = noteFolded || readingFolded;
  // STORY 16.14: the page's title is its "what this is" line; the image is the
  // card's own line above the reading (no image, no line). Both are copies
  // read from the map folder — nothing here fetches, on open or ever.
  const pageTitle = media !== null ? media.title : null;
  // STORY 16.15: an IMAGE is drawn from the person's own file through the asset
  // protocol — never a copy, never a remote URL. It is only drawn while the
  // file is reachable: a gone file leaves the absence line, not a broken box.
  const imageReading = reading !== null && readingExtract(reading) === "image";
  const imageGone = state === "missing" || state === "unreadable";
  const imageSrc =
    imageReading && reading !== null && !imageGone
      ? assetSrc(readingAbsolutePath(workspacePath ?? "", reading))
      : null;
  // The "needs a model that can read …" line (image: sight, video: the
  // transcript). It stands in the reading's slot and is never an error.
  const needsLine = readingNeedsLine(reading);
  const showNeeds =
    needsLine !== null && (imageReading ? !imageGone : state !== "unread");
  // STORY 16.13: when the body carries the absence line, the footer does not
  // repeat a state word that would claim a kept copy which is not on disk.
  const showStateWord = word !== null && bodyText !== null;
  // Story 16.12: a selection has no source file, so the FILE verbs (refresh,
  // re-point, read more) have nothing to act on; its bytes are already here.
  const fileReading = reading !== null && isFileReading(reading);
  // The footer's one attribution: a file's NAME, or a selection's SOURCE NAME.
  const provenance =
    reading === null ? null : readingProvenance(reading, cardNames);

  async function run(action: () => Promise<GroundAddResult>) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  }

  /** Enter the note editor in place, seeded with the stored note (or empty). */
  function beginNoteEdit() {
    if (onSetNote === undefined || busy) return;
    draftRef.current = storedNoteRef.current;
    setDraft(draftRef.current);
    editingRef.current = true;
    setEditing(true);
    setProblem(null);
  }

  /** ESC ABANDONS: the stored note is untouched, and no file is written. */
  function cancelNoteEdit() {
    editingRef.current = false;
    setEditing(false);
    setPicker(null);
    setDraft("");
  }

  /**
   * SAVE the draft (the done verb or a press away). An unchanged draft writes
   * nothing. A refusal wrote nothing either, so the draft is put back in the
   * editor with the one sentence — never silently discarded.
   */
  async function saveNoteDraft() {
    if (!editingRef.current || onSetNote === undefined) return;
    const text = draftRef.current;
    editingRef.current = false;
    setEditing(false);
    setPicker(null);
    if (text === storedNoteRef.current || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await onSetNote(reference.on, text);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      draftRef.current = text;
      setDraft(text);
      editingRef.current = true;
      setEditing(true);
    }
  }

  // STORY 16.12 — THE SELECTION'S THREE MOVES. `ask about this` only PROPOSES
  // a name (the selection's first few words, whitespace collapsed for the name
  // alone); the confirm is the one write, and a blank name is refused with one
  // sentence before anything is queued. Cancel forgets the proposal; the text
  // file and the new card appear only after the person's own confirm.
  function askAboutSelection() {
    if (selected === null || selected === "") return;
    setNaming({ text: selected, name: proposeSelectionName(selected) });
    setProblem(null);
  }

  function cancelSelection() {
    setNaming(null);
  }

  async function makeSelection() {
    if (naming === null || onCreateSelection === undefined || busy) return;
    const refusal = selectionRefusal(naming.name, naming.text);
    if (refusal !== null) {
      setProblem(refusal);
      return;
    }
    const at = selectionPlacement(reference.x, reference.y);
    setBusy(true);
    setProblem(null);
    const result = await onCreateSelection(
      reference.on,
      naming.name.trim(),
      at.x,
      at.y,
      naming.text,
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setNaming(null);
    setSelected(null);
  }

  // STORY 16.7 — the picker's list and the mention's insert. Nothing here
  // writes: an insertion is a draft edit, and the note's existing save path
  // (done, a press away) is the only thing that ever lands on disk.
  const cardsForPicker = Array.from(cardNames, ([slug, name]) => ({ slug, name }));
  const choicesFor = (query: string): MentionChoice[] =>
    mentionChoices(cardsForPicker, concepts ?? [], query, reference.on);
  const choices = picker === null ? [] : choicesFor(picker.query);

  /** Did the draft change open, narrow or close the mention list? */
  function noteChanged(value: string, caret: number) {
    const trigger = mentionTrigger(value, caret);
    if (trigger === null) {
      if (picker !== null) setPicker(null);
      return;
    }
    setPicker({
      start: trigger.start,
      caret,
      query: trigger.query,
      active: 0,
    });
  }

  /** Insert the chosen mention in place of the typed `@query` (a draft edit). */
  function insertChoice(choice: MentionChoice) {
    if (picker === null) return;
    const field = editorRef.current;
    const text = field?.value ?? draftRef.current;
    const applied = applyMention(text, picker.start, picker.caret, choice);
    draftRef.current = applied.text;
    setDraft(applied.text);
    setPicker(null);
    // Put the caret back after the inserted mention once React has rendered the
    // new value. A draft edit — the note is still unwritten until it is saved.
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (el === null) return;
      el.focus();
      el.setSelectionRange(applied.caret, applied.caret);
    });
  }

  /**
   * A word chip's ONE read-only look at the concept map (`map/conceptWords.ts`).
   * A null answer means the concept's reference is gone: the chip dangles, and
   * nothing is reported as an error (the person's text stays as written).
   */
  async function openWord(slug: string) {
    const word = await readWord(slug);
    if (word === null) {
      setGone((current) =>
        current.includes(slug) ? current : [...current, slug],
      );
      return;
    }
    setPanel({ name: word.name, memory: word.memory });
  }

  async function repoint() {
    if (busy) return;
    const picked = await pickReadingFile("point at a file");
    if (picked === null) return;
    await run(() => onRepoint(reference.on, picked));
  }

  /**
   * STORY 16.13 (shortlist item 1): delete is IMMEDIATE. One press removes; the
   * toast's Restore is the only guard, so there is no confirming step to wait
   * for. A refusal that kept the card shows on the card; the refused-unlink
   * sentence is the layer's, because the card is gone with its records.
   */
  async function removeCard() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await onRemove(reference);
    if (!result.ok && result.recordsRemoved !== true) {
      setBusy(false);
      setProblem(result.message);
    }
  }

  return (
    <div
      ref={cardRef}
      className={`ground-reference${dragPos ? " dragging" : ""}${
        open ? " expanded" : ""
      }`}
      style={
        {
          left: x,
          top: y,
          // STORY 17: the SAME stated counts the crop uses drive the DOM's
          // clamp and the note's crop height — canvas.css reads these two
          // variables, so a changed threshold re-crops without a reload.
          "--preview-lines": previewLines,
          "--note-lines": noteLines,
        } as CSSProperties
      }
      data-slug={reference.on}
    >
      {/* STORY 16.5 — the one new affordance: a small quiet handle on the
          card's edge. Drag it onto another card and the two are WIRED, with no
          word and no meaning (hover-revealed like the card's verbs). The card's
          BODY keeps its press-to-open and drag-to-move exactly as before. */}
      <button
        type="button"
        className="ground-link-handle"
        aria-label="link to another card"
        title="drag to link"
      />
      <div className="ground-name">{reference.name}</div>
      {/* STORY 16.13 (shortlist items 3 and 10): the card's second line says
          WHAT THIS IS — the copy kept from a file, a copy of text selected from
          another card, or a reference with no reading. Never a broken box. */}
      <div className="ground-kind">
        {readingKind(reading, cardNames, pageTitle)}
      </div>
      <div className="ground-body" ref={bodyRef}>
        {/* STORY 16.14: the page's image line — above the note and the reading,
            and only when a local copy exists. It renders from the map folder,
            so it still shows with the machine offline. */}
        {thumbSrc !== undefined && (
          <img className="ground-thumb" src={thumbSrc} alt="" />
        )}
        {/* STORY 16.15: the person's image, rendered in place from its own file
            through the asset protocol. Nothing is copied into the workspace and
            no request leaves the machine: offline, it is the same bytes. */}
        {imageSrc !== null && (
          <img className="ground-image" src={imageSrc} alt="" />
        )}
        {/* STORY 16.6: the note sits ABOVE the reading, in the person's own
            voice. Small: a two-line crop cut by `previewText`. Expanded: the
            whole note. Editing: a textarea in its place, Enter a newline. */}
        {editing ? (
          <textarea
            ref={editorRef}
            className="ground-note-editor"
            value={draft}
            autoFocus
            onChange={(e) => {
              draftRef.current = e.target.value;
              setDraft(e.target.value);
              noteChanged(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length,
              );
            }}
            onKeyDown={(e) => {
              // STORY 16.7 — the picker owns the keys while it is open. Esc
              // closes the LIST only (never the edit); Enter/Tab insert; the
              // arrows walk. Any other key is typing, which filters the list.
              if (picker !== null) {
                const command = pickerCommand(e.key);
                if (command === "close") {
                  // Esc closes the LIST only: it must not also reach the
                  // window's Esc (which abandons the note edit).
                  e.preventDefault();
                  e.stopPropagation();
                  setPicker(null);
                  return;
                }
                if (command === "prev" || command === "next") {
                  e.preventDefault();
                  const list = choicesFor(picker.query);
                  setPicker((current) =>
                    current === null
                      ? null
                      : {
                          ...current,
                          active: nextActive(command, current.active, list.length),
                        },
                  );
                  return;
                }
                if (command === "insert") {
                  e.preventDefault();
                  const list = choicesFor(picker.query);
                  const choice = list[picker.active] ?? list[0];
                  if (choice === undefined) setPicker(null);
                  else insertChoice(choice);
                  return;
                }
              }
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              cancelNoteEdit();
            }}
          />
        ) : shownNote !== null ? (
          // STORY 16.7: the note's face with its mention chips. The small card
          // crops it (chips kept whole); the expanded face shows every line.
          <GroundNote
            text={shownNote}
            maxLines={open ? null : noteLines}
            cardNames={cardNames}
            wordSlugs={wordSlugs}
            goneWords={gone}
            onOpenCard={(slug) => {
              // Moving to another card closes any concept the note was showing:
              // the panel belongs to the card it was opened on.
              setPanel(null);
              onOpenCard(slug);
            }}
            onOpenWord={(slug) => void openWord(slug)}
          />
        ) : null}
        {bodyText !== null ? (
          // Story 16.12: on the EXPANDED card this is the selection surface;
          // the ref is what tells a selection inside the reading from one
          // anywhere else on the map.
          <div className="ground-reading" ref={readingRef}>
            {bodyText}
          </div>
        ) : showNeeds && needsLine !== null ? (
          // STORY 16.15: an image or a video has no reading and never pretends
          // to. Its slot says, in one quiet line, what the reading needs.
          <div className="ground-reading ground-needs">{needsLine}</div>
        ) : (
          // STORY 16.13 (shortlist item 3): the reading's slot still says what
          // happened. A refused or absent reading leaves a card with its name,
          // its kind and this one quiet line — never an empty box.
          <div className="ground-reading ground-refusal">
            {readingAbsenceLine(state, reading)}
          </div>
        )}
        {/* STORY 17 (shortlist items 7–9) — THE FOLD. A small card whose note or
            reading holds more than the person's stated lines ends in a SOFT
            FADE and ONE small verb: "more" opens the card, exactly like a press
            on the body, and it is never a number and never a count. A card that
            fits its threshold draws neither, because there is nothing to fold.
            The button's press is caught by the card's raw mousedown handler
            (any button returns early), so this verb never starts a drag. */}
        {folded && (
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
        {/* STORY 16.8 — the PULL, below the stored reading as a CONTINUATION
            (same type, one hairline): what the person is looking at now,
            never a second card and never a record. It is only ever drawn on
            the OPEN card; closing the card drops it from view state. */}
        {open && pulled !== undefined && (
          <GroundPulled
            pulled={pulled}
            onDismiss={() => onDismissPull?.(reference.on)}
          />
        )}
      </div>
      <div className="ground-footer">
        {provenance !== null && (
          <div
            className={
              reading !== null && reading.form === "selection"
                ? "ground-handle ground-from"
                : "ground-handle"
            }
          >
            {provenance}
          </div>
        )}
        {showStateWord && (
          <div className={`ground-state ${state}`}>{word}</div>
        )}
      </div>
      {problem !== null && (
        <div className="ground-problem" role="status">
          {problem}
        </div>
      )}
      {/* STORY 16.12 — THE NAME, before anything is written. The field is
          PRE-FILLED with the proposed name and is the person's to edit; the
          confirm writes the excerpt verbatim, and a blank name refuses with
          the same one sentence the bubble uses. Esc or cancel forgets it. */}
      {naming !== null && (
        <div
          className="ground-selection"
          role="group"
          aria-label="name the new card"
        >
          <input
            className="ground-selection-name"
            value={naming.name}
            autoFocus
            aria-label="name the new card"
            disabled={busy}
            onChange={(e) => {
              setNaming({ text: naming.text, name: e.target.value });
              if (problem !== null) setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") {
                if (e.key !== "Escape") return;
                // Esc cancels THIS field only (the card stays open).
                e.preventDefault();
                e.stopPropagation();
                cancelSelection();
                return;
              }
              e.preventDefault();
              void makeSelection();
            }}
          />
          <div className="ground-selection-actions">
            <button
              type="button"
              className="ground-selection-make"
              disabled={busy}
              onClick={() => void makeSelection()}
            >
              make the card
            </button>
            <button
              type="button"
              className="ground-selection-cancel"
              disabled={busy}
              onClick={cancelSelection}
            >
              cancel
            </button>
          </div>
        </div>
      )}
      <div className="ground-actions">
          {/* STORY 16.12 — the ONE selection affordance: it exists while a
              selection sits inside the expanded reading and vanishes when it
              collapses. It only PROPOSES the name field (onMouseDown keeps the
              selection alive by not taking focus); nothing is written by it. */}
          {open && onCreateSelection !== undefined && selected !== null && naming === null && (
            <button
              type="button"
              className="ground-select-ask"
              disabled={busy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={askAboutSelection}
            >
              ask about this
            </button>
          )}
          {/* STORY 16.6: the note's edit verb lives on the EXPANDED card. The
              done verb only exists while editing; Esc and a press away are the
              other exits (Esc abandons, a press away saves). */}
          {open && onSetNote !== undefined && (
            editing ? (
              <button
                type="button"
                className="ground-note-done"
                disabled={busy}
                onClick={() => void saveNoteDraft()}
              >
                done
              </button>
            ) : (
              <button
                type="button"
                className="ground-note-edit"
                disabled={busy}
                onClick={beginNoteEdit}
              >
                {shownNote === null ? "add a note…" : "edit the note…"}
              </button>
            )
          )}
          {/* STORY 15.1 — the ask verb, on the EXPANDED card only: the app's
              first turn of its own. The anchored card's NAME is shown by the
              panel; nothing else from the map is sent (story 3 adds the
              packet). A turn is not a move: no record, no history, no mirror. */}
          {open && onAsk !== undefined && (
            <button
              type="button"
              className="ground-ask-open"
              disabled={busy}
              onClick={() => setAsking(true)}
            >
              ask…
            </button>
          )}
          {/* STORY 16.8 — the ONE pull verb, on the EXPANDED card only. It is
              the button's press and nothing else: no read on open, no watcher,
              no background read. It reprocesses an existing pull harmlessly
              (the text is replaced in view state) and never writes. Story
              16.12: a selection has no source to read more of, so no verb. */}
          {open &&
            reading !== null &&
            isFileReading(reading) &&
            readingExtract(reading) !== "image" &&
            onPull !== undefined && (
            <button
              type="button"
              className="ground-read-more"
              disabled={busy}
              onClick={() => void run(() => onPull(reference.on))}
            >
              read more
            </button>
          )}
          {/* Story 16.12: a selection has no file to re-read or re-point, so
              neither verb is drawn for it — its bytes are the map's own. STORY
              16.13 (shortlist item 2): the missing verbs are not silent; one
              quiet line here says why there is nothing behind them. */}
          {fileReading && readingExtract(reading as Reading) !== "image" && (
            <button
              type="button"
              className="ground-refresh"
              disabled={busy}
              onClick={() => void run(() => onRefresh(reference.on))}
            >
              refresh
            </button>
          )}
          {reading === null || fileReading ? (
            <button
              type="button"
              className="ground-repoint"
              disabled={busy}
              onClick={() => void repoint()}
            >
              {reading === null ? "point at a file…" : "point at another file…"}
            </button>
          ) : null}
          {reading !== null && reading.form === "selection" && (
            <div className="ground-quiet">
              this is a copy; there is no file to refresh or point at.
            </div>
          )}
          {/* STORY 16.15: an image is drawn from its own file, so it has no
              reading to refresh — said quietly rather than left silent. */}
          {reading !== null && readingExtract(reading) === "image" && (
            <div className="ground-quiet">
              this is drawn from its own file; there is nothing to refresh.
            </div>
          )}
          <button
            type="button"
            className="ground-remove"
            disabled={busy}
            onClick={() => void removeCard()}
          >
            remove
          </button>
        </div>

      {/* STORY 16.7 — the `@` list, while the editor asks. It opens below the
          CARD (so the note's own crop and scroll never clip it), takes no focus
          of its own, and closes on Esc, on a pick, or when the trigger goes.
          PROVISIONAL: the placement and the row look (ADR-0003's seam). */}
      {open && picker !== null && (
        <MentionPicker
          choices={choices}
          active={picker.active}
          onPick={insertChoice}
        />
      )}
      {/* STORY 16.7 — the concept's read-only panel. A VIEW: name and a cropped
          memory, nothing written and nothing merged into the note. Esc, the
          close verb or a press away closes it. */}
      {panel !== null && (
        <GroundConceptPanel
          name={panel.name}
          memory={panel.memory}
          onClose={() => setPanel(null)}
        />
      )}
      {/* STORY 15.1 / 3b — the card's ask panel, beside the card it is
          anchored on. It shows the card's name, and its turn carries the SAME
          packet the Ask Move carries, anchored on ONE block: this card. The
          card's LINKS never ride — a link is wordless wiring, not context.
          View state only: closing it leaves the card exactly as it was, and a
          card ask writes no record (it is not a Move). */}
      {open && asking && onAsk !== undefined && (
        <AskSidecarPanel
          card={{
            name: reference.name,
            state,
            reading,
            readingText: text ?? null,
            note: note ?? null,
          }}
          workspacePath={workspacePath ?? ""}
          turn={onAsk}
          onConfigure={onConfigure}
          providersRev={providersRev}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  );
}
