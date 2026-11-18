import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  loadConceptWord,
  listConceptWords,
  type ConceptWord,
} from "../map/conceptWords";
import type { GroundReference } from "../map/ground";
import {
  askRefusal,
  proposeAskName,
  selectionWords,
  type AskCard as AskCardRecord,
  type AskTurn,
} from "../map/asks";
import { NOTE_PREVIEW_LINES } from "../map/notes";
import {
  PULL_BUDGET_BYTES,
  pullTruncationLine,
  type PulledText,
} from "../map/pull";
import {
  isFileReading,
  pageHost,
  previewOverflows,
  previewText,
  READING_PREVIEW_LINES,
  readingAbsolutePath,
  readingExtract,
  readingFileName,
  readingNeedsLine,
  readingStateWord,
  cardProvenanceSourceSlug,
  distilledAuthors,
  distilledSourceSlug,
  selectionSourceSlug,
  type Reading,
  type ReadingState,
} from "../map/readings";
import type { Media } from "../map/media";
import { askCardOf } from "../turn/context";
import type { AskCallsFacts } from "./contactRules";
import { assetSrc } from "./imageSource";
import { pickReadingFile } from "../workspace/dialogs";
import {
  beginGroundDrag,
  dropGroundDrag,
  moveGroundDrag,
  type GroundDragState,
} from "./groundDrag";
import { isGestureArmed, type GestureMode } from "./gates";
import { startGroundLinkDrag } from "./linkDrag";
import type { GroundLink } from "../map/groundLinks";
import { GESTURE_IDLE, type GestureNarration } from "./gestureWord";
import { besidePlacement, type Point } from "./geometry";
import { AskCard } from "./AskCard";
import { CardNamePill } from "./CardNamePill";
import { SelectionAsk, clearTextSelection } from "./SelectionAsk";
import { SessionCard as SessionCardView } from "./SessionCard";
import {
  type SessionCard as SessionCardRecord,
  type SessionEntry,
} from "../map/sessions";
import { ACP_SPECS, acpDeclaration, acpRowLabel } from "../turn/acpSpecs";
import { PROVIDER_SENTENCES } from "../turn/providers";
import type {
  AcpPermissionAsk,
  AcpPermissionChoice,
} from "../turn/acpEntries";
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
import {
  askAnchorOf,
  askContextFactsOf,
  askThreadOf,
  type GroundAddResult,
} from "./useGround";

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
 * THE CARD (story 16.3) is a NODE CARD: a quiet surface, a title, a muted
 * cropped body, a meta footer — fixed, never stretching with its content
 * (PROVISIONAL: the dimensions and the six-line crop are ADR-0003's rendering
 * seam, not a design system):
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
 * one write path (`useGround.remove`) — the card never touches a file. STORY
 * 17.8 gives an ASK card the same verb through the same one toast
 * (`useGround.removeAsk`), so every card on the ground map goes the same way. When a
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
 * STORY 18 REMOVES 16.12's SELECTION→CARD VERB, NOT ITS FORM. Selecting text in
 * the expanded reading used to offer `ask about this` and make a new ground
 * card. The user corrected the intent — what they meant was a selection
 * highlight opening a floating ASK widget (a later story) — so the verb, its
 * watcher, its proposed name and its confirm are gone. A card whose record says
 * `form: selection` stays legal and keeps every line it had: the provenance
 * footer, "a copy of text selected from <card>", links, asks, the pull and
 * remove/restore. THE FORM IS NOT THE FEATURE; the form parses forever.
 *
 * STORY 16.19 GIVES 16.12'S FORM ITS REAL AFFORDANCE. The user corrected the
 * intent twice: dragging over words in a card's reading should open a small
 * question widget at the selection, and asking in it should make a LINKED CARD,
 * not a copy of the selected text (16.12's copy card was deleted in 16.18).
 * So the expanded reading is a SELECTION surface whose mouse-up reports the
 * words and their plane point to the layer; the layer mounts ONE widget there
 * (SelectionAsk: a question field, an ask verb, a dismiss); and asking creates
 * an EMPTY peer ask card beside the source, WIRED to it, holding the chosen
 * words as one more context kind. The source card is never written — the words
 * are CONTEXT, not content — Esc, the card's close and asking all take the
 * widget and its highlight away, and an empty selection opens nothing. No
 * second model call happens anywhere in that path: the card's own send asks.
 *
 * STORY 16.21 TAKES THE NAME OUT OF THE CARD AND PUTS IT ABOVE IT. The card
 * body's first line is the TYPE LINE (16.13), never the name: the name is a
 * PILL above the card (`CardNamePill`), counter-scaled against the plane's
 * zoom with a stated clamp so it stays legible at 25% and stops growing before
 * a deep zoom-out turns a row of cards into a wall of names. The pill is also
 * the card's one HANDLE — its press reaches the same raw mousedown listener
 * below, so the drag rule (`groundDrag.ts`), its threshold and its single
 * write on release are unchanged and there is no second drag to keep in step —
 * and its one RENAME FIELD: double-click, the old name is selected, Enter
 * writes through the hook's one name path, Escape abandons, and an empty field
 * stores and reads "Untitled reference". It sits above the card, so it can
 * never cover the card's own verbs, and it is inside the content the plane's
 * gate already knows, so it can never be read as empty paper.
 *
 * STORY 16.22 — THE PILL IS EVERY CARD'S, NOT THE REFERENCE'S. Ask cards and
 * session cards are peers on this map (17.10, 18.3), so they wear the SAME
 * `CardNamePill` — the same counter-scale, the same handle, the same
 * double-click rename — and each family hands it its OWN name rules, because
 * the families really do differ (a reference's blank field stores "Untitled
 * reference", a session's stores "Untitled session", an ask's is a REFUSAL).
 * The layer's part is small: it passes the camera's zoom to every card and the
 * hook's one session-name write path to the session cards. A committed rename
 * becomes ONE `card.rename` line in the history, carrying the family, the slug
 * and both names — the layer writes none of it. The drag rule is still the
 * layer's ONE raw listener on the reference card: the pill is a child of the
 * card it names, so the press reaches that rule wherever a card can move.
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
 * STORY 17.1 — WHERE THE ASK CARD GOES: beside its source, at the same scale,
 * offset by a little more than a card's own width so the two never overlap.
 * PURE, so the placement is not the confirm handler's only truth. STORY 18:
 * this was story 16.12's selection-card offset; the selection verb is gone and
 * the ask card keeps the same beside-the-source placement. PROVISIONAL: the
 * side and the offset (the story's spec leaves the placement open).
 */
export function askPlacement(x: number, y: number): Point {
  return besidePlacement(x, y);
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
  const source = cardProvenanceSourceSlug(reading);
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
  // STORY 17.11 — A DISTILLED CARD SAYS WHAT MADE IT. A RULE card says a rule,
  // never a model; STORY 17.12's CURATOR card says exactly the two models
  // (ADR-0037 decision 4): the manager that distilled, and the task whose
  // reply it read. The form is one; the AUTHOR is the reading's own optional
  // provenance, so a rule card can never drift into a claim it cannot support.
  const distilled = distilledSourceSlug(reading);
  if (distilled !== null) {
    const authors = distilledAuthors(reading);
    if (authors !== null) {
      return (
        "distilled by " +
        authors.manager +
        " from " +
        authors.task +
        "'s reply"
      );
    }
    const name = cardNames.get(distilled);
    return name === undefined
      ? "a rule's copy of a card that is gone"
      : "a rule's copy of " + name;
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
  /**
   * STORY 17.1 — every ask card, in FILE ORDER, and each card's conversation.
   * Both are read at load (`useGround`), never here: the layer holds records
   * and hands the person's verbs, and no press in it writes anything.
   */
  asks?: readonly AskCardRecord[];
  askTurns?: Readonly<Record<string, readonly AskTurn[]>>;
  /**
   * Make an ask card beside this reference (one record line, never a change to
   * the reference card). Optional so a render test needs no write path.
   */
  onCreateAsk?: (
    sourceSlug: string,
    name: string,
    x: number,
    y: number,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 16.19 — THE ASK A SELECTION MAKES: the widget at the words the person
   * chose hands its question here; the hook makes the empty peer ask card beside
   * the source, wires it, and carries the chosen words as one more context kind.
   * Optional so a render test needs no write path.
   */
  onAskFromSelection?: (
    sourceSlug: string,
    words: string,
    question: string,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 17.5 — fork an ask card at a turn (one record line; the parent's
   * conversation is read, never copied). Optional so a render test needs no
   * write path.
   */
  onForkAsk?: (
    parentSlug: string,
    carry: number,
    name: string,
    x: number,
    y: number,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 17.10 — RENAME one ask card (the title pill is the rename field).
   * The slug is identity; the name is the person's.
   */
  onRenameAsk?: (slug: string, name: string) => Promise<GroundAddResult>;
  /**
   * STORY 17.10 — OPEN the ask card that was just made (the bubble's ASK door
   * creates it elsewhere; the layer owns which face is open). The token is a
   * fresh object per creation, so closing the card does not reopen it on an
   * unrelated render.
   */
  revealAsk?: { slug: string } | null;
  /**
   * STORY 17.8 — remove one ask card: the immediate delete (16.13's rule) with
   * the toast's Restore as its guard. The layer holds the bytes; this prop only
   * forwards the person's press.
   */
  onRemoveAsk?: (on: string) => Promise<GroundAddResult>;
  /** Ask one question inside an ask card (the existing card-ask turn path). */
  onAskTurn?: (
    slug: string,
    question: string,
    onPart?: (text: string) => void,
  ) => Promise<GroundAddResult>;
  /** Stop the running ask turn (the existing turn port's stop — story 17.2). */
  onStopAskTurn?: () => Promise<void>;
  /**
   * STORY 18.3 — every SESSION card, in FILE ORDER, each card's transcript and
   * the cards with a LIVE run. All three are read at load and moved only by the
   * person's own verbs (`useGround`); the layer holds records and forwards
   * presses, and no press in it writes anything itself.
   */
  sessions?: readonly SessionCardRecord[];
  sessionEntries?: Readonly<Record<string, readonly SessionEntry[]>>;
  sessionRunning?: readonly string[];
  /**
   * STORY 18.5 — remove one session card: the immediate delete with the toast's
   * Restore as its guard (the same one toast every other card uses).
   */
  onRemoveSession?: (slug: string) => Promise<GroundAddResult>;
  /**
   * STORY 16.22 — RENAME one session card (the name pill is the rename field,
   * the same one every card wears). The name is the person's; the slug is
   * identity and the transcript is untouched.
   */
  onRenameSession?: (slug: string, name: string) => Promise<GroundAddResult>;
  /** Start one session card's run (the 18.2 lifecycle, transcript included). */
  onRunSession?: (slug: string) => Promise<GroundAddResult>;
  /** Stop one session card's live run (the run's own cancel). */
  onStopSession?: (slug: string) => Promise<void>;
  /** Bind a card whose row is gone to another shipped row (one field). */
  onChooseSessionTool?: (
    slug: string,
    tool: string,
  ) => Promise<GroundAddResult>;
  /** STORY 18.4 — each card's PENDING permission ask, as view state. */
  sessionPermission?: Readonly<Record<string, AcpPermissionAsk>>;
  /** Answer the pending ask with the person's one verb. */
  onAnswerSessionPermission?: (
    slug: string,
    choice: AcpPermissionChoice,
  ) => Promise<void>;
  /** Make the last completed run's text into a copy card. */
  onMakeSessionResult?: (slug: string) => Promise<GroundAddResult>;
  /**
   * STORY 17.7b — WHETHER THE ONE SETTINGS SELECTION RESOLVES. The ask card
   * says "nothing configured" BEFORE the send and offers only the settings
   * verb; the selector itself stays in Settings (story 17.7 retired it here).
   * `null` is not yet known, so nothing is claimed.
   */
  hasProvider?: boolean | null;
  /**
   * STORY 17.13 — THE TWO CALLS an ask card's send will make, read from the
   * same Settings selection that hasProvider comes from. The card's declaration
   * names them before the send; null means the config has not answered.
   */
  calls?: AskCallsFacts | null;
  /** Open Settings on Providers — the pre-send state's ONE verb. */
  onOpenSettings?: () => void;
  /** Move one reference to its dropped point (one line, on release). */
  onMove: (on: string, x: number, y: number) => Promise<GroundAddResult>;
  /**
   * STORY 16.21 — RENAME one reference from its name pill. The existing name
   * write path (`useGround`): the name is the record's field and the slug is
   * identity, so a rename never moves a wire, a reading or an ask's anchor.
   * Optional so a render test needs no writer.
   */
  onRename?: (on: string, name: string) => Promise<GroundAddResult>;
  /** Re-read this reference's file (the person's press only). */
  onRefresh: (on: string) => Promise<GroundAddResult>;
  /** Point this reference at another file (a new pick, one write). */
  onRepoint: (on: string, from: string) => Promise<GroundAddResult>;
  /** Remove this reference, its reading and its kept text (story 16.3). */
  onRemove: (on: string) => Promise<GroundAddResult>;
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
   * STORY 17.9 — every readable ground link, in FILE ORDER. An ask card's
   * context is the links whose TARGET is that card; the records arrive loaded,
   * and nothing here writes or repairs a wire.
   */
  links?: readonly GroundLink[];
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
  asks = [],
  askTurns = {},
  sessions = [],
  sessionEntries = {},
  sessionRunning = [],
  sessionPermission = {},
  onCreateAsk,
  onAskFromSelection,
  onForkAsk,
  onRenameAsk,
  revealAsk,
  onRemoveAsk,
  onAskTurn,
  onStopAskTurn,
  onRunSession,
  onStopSession,
  onChooseSessionTool,
  onAnswerSessionPermission,
  onMakeSessionResult,
  onRemoveSession,
  onRenameSession,
  hasProvider,
  calls = null,
  onOpenSettings,
  onMove,
  onRename,
  onRefresh,
  onRepoint,
  onRemove,
  onSetNote,
  onPull,
  onDismissPull,
  onLink,
  links = [],
  workspacePath = "",
  onNarrate,
  interactionMode = "idle",
  previewLines = READING_PREVIEW_LINES,
  noteLines = NOTE_PREVIEW_LINES,
  zoom = 1,
}: GroundLayerProps) {
  const readingsBySlug = new Map(readings.map((reading) => [reading.on, reading]));
  const mediaBySlug = new Map(media.map((entry) => [entry.on, entry]));
  // STORY 16.7 — WHICH card is expanded is the LAYER's view state, not each
  // card's: a card mention must be able to open ANOTHER card. It is still view
  // state only (a reopened workspace shows every card small) and no write
  // path here touches a file.
  const [openOn, setOpenOn] = useState<string | null>(null);
  // STORY 17.1 — the OPEN ASK CARD is the layer's view state too, on its own
  // slug: opening one closes the other face, so the map never has two editors
  // asking for the eye at once. Nothing here is a record.
  const [openAskOn, setOpenAskOn] = useState<string | null>(null);
  // STORY 18.3 — the OPEN SESSION CARD, the same rule: one face at a time, so
  // the map never has two editors asking for the eye at once. View state only.
  const [openSessionOn, setOpenSessionOn] = useState<string | null>(null);
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

  useEffect(() => {
    // STORY 17.1: the same rule for an ask card — a card a hand edit removed
    // cannot stay open, and nothing is repaired on its way out.
    if (openAskOn !== null && !asks.some((ask) => ask.on === openAskOn)) {
      setOpenAskOn(null);
    }
  }, [asks, openAskOn]);

  // The token already honoured, so a later render can never reopen a card the
  // person closed (a rename or a turn re-renders but changes no token).
  const revealedAskRef = useRef<{ slug: string } | null>(null);
  useEffect(() => {
    // STORY 17.10 — OPEN THE ASK CARD THE PERSON JUST ASKED FOR. The bubble's
    // ASK door makes the card outside this layer, so the layer is handed its
    // slug; opening it puts the composer in front of the person, which is the
    // next thing the empty card needs. The effect also watches the ask list so
    // a token that arrives before the record can retry once it lands — the ref
    // makes that retry happen at most once.
    if (revealAsk === null || revealAsk === undefined) return;
    if (revealedAskRef.current === revealAsk) return;
    if (!asks.some((ask) => ask.on === revealAsk.slug)) return;
    revealedAskRef.current = revealAsk;
    setOpenOn(null);
    setOpenSessionOn(null);
    setOpenAskOn(revealAsk.slug);
  }, [revealAsk, asks]);

  useEffect(() => {
    // STORY 18.3: the same rule for a session card — a card a hand edit removed
    // cannot stay open, and nothing is repaired on its way out.
    if (
      openSessionOn !== null &&
      !sessions.some((session) => session.on === openSessionOn)
    ) {
      setOpenSessionOn(null);
    }
  }, [sessions, openSessionOn]);



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
  /**
   * STORY 18.4 — WHERE A COPY'S PROVENANCE FINDS A NAME. A selection card made
   * from a SESSION card names its source, and a session card is not a mention
   * target (it holds a run, not a reading). So the provenance lookup sees one
   * map and the mention picker keeps the references-only one: adding session
   * names to the picker would offer a card the note's click cannot open.
   */
  const sourceNames = new Map<string, string>([
    ...cardNames,
    ...sessions.map((session) => [session.on, session.name] as const),
    // STORY 17.11 — a distilled card names the ASK CARD it was copied from, so
    // that source must resolve here too (it is provenance only; this map never
    // feeds the mention picker, which stays references-only).
    ...asks.map((ask) => [ask.on, ask.name] as const),
  ]);
  /**
   * STORY 18.3 — THE ROWS THIS BUILD SHIPS, as the session card's picker offers
   * them. A tool row is DATA (`turn/acpSpecs.ts`): a second tool is an entry
   * there, never code here, and the picker only ever offers what ships.
   */
  const sessionTools = ACP_SPECS.map((spec) => ({
    id: spec.id,
    // The label says which rows are unverified; it comes from the row, so a
    // third tool marks itself and this file never learns a product's name.
    name: acpRowLabel(spec),
  }));
  /**
   * STORY 17.3 — the card's block facts, as the packet reads them. Built from
   * ALREADY-LOADED state through the same pure crop the send uses
   * (turn/context.ts's askCardOf), so the declaration the card shows and the
   * bytes the turn sends are composed from one description. STORY 17.9 makes
   * the wires the input; the legacy anchor field is display only.
   */
  /**
   * STORY 17.9 — WHAT IS WIRED INTO THIS ASK CARD, resolved once per render
   * from the loaded map: the reference/ask/session cards whose link targets
   * this card, each as the block the packet sends, and whether a wire dangles.
   * The anchor FIELD is not read here; it is legacy display only.
   */
  const askContextOf = (ask: AskCardRecord) => {
    const resolved = askContextFactsOf({
      ask: ask.on,
      links,
      references,
      asks,
      askTurns,
      sessions,
      sessionEntries,
      readings,
      texts,
      notes,
      states,
    });
    return {
      cards: resolved.facts.map(askCardOf),
      dangling: resolved.dangling.length > 0,
    };
  };
  /* ----------------------------------------------------------------------- *
   * STORY 16.19 — SELECTING WORDS ASKS A QUESTION.
   *
   * The user's correction, twice: dragging over a sentence in a card's reading
   * should open a question widget at the selection, and asking in it should make
   * a LINKED CARD — not a copy of the selected text (16.12's copy card was
   * deleted in 16.18). This layer owns the widget's VIEW STATE and nothing else:
   * the selection is captured by the card (its reading element), the words are
   * handed straight to the hook's one write path, and the only record that
   * appears is the ask card the widget's question makes.
   *
   * THREE DISMISSALS, all of them clearing the browser's highlight: Esc, the
   * card closing (the effect below), and asking. The widget is never mounted for
   * an empty selection: `selectionWords` is the one collapse/refusal rule and a
   * null answer means nothing opens. No second model call and no read happens
   * anywhere in this block.
   * ----------------------------------------------------------------------- */
  const [selectionAsk, setSelectionAsk] = useState<{
    source: string;
    words: string;
    x: number;
    y: number;
  } | null>(null);
  // STORY 16.19 — THE QUESTION THE WIDGET ASKED, waiting for its new card. The
  // token is a fresh number per ask, so the card's one-shot send can never
  // replay, and the layer forgets the seed the moment the card takes it.
  const [askSeed, setAskSeed] = useState<{
    slug: string;
    question: string;
    token: number;
  } | null>(null);
  const askSeedToken = useRef(0);

  /** Dismiss the widget AND its highlight: no selection is left behind. */
  function dismissSelection(): void {
    setSelectionAsk(null);
    clearTextSelection();
  }

  /** The card captured a selection: mount the widget at it (never for none). */
  function choseWords(source: string, raw: string, x: number, y: number): void {
    const words = selectionWords(raw);
    if (words === null) {
      dismissSelection();
      return;
    }
    setSelectionAsk({ source, words, x, y });
  }

  /**
   * ASK: the hook writes the empty peer ask card + its wire + the chosen words,
   * then this layer OPENS that card and hands it the question, which the card's
   * own send path asks (so the answer streams where every answer streams). A
   * refusal is the widget's to show; nothing is opened and nothing is written.
   */
  async function askSelection(question: string): Promise<GroundAddResult> {
    if (selectionAsk === null || onAskFromSelection === undefined) {
      return { ok: false, message: "nothing was written." };
    }
    // THE ORDINARY PATH'S PRE-SEND RULE (17.7b), before anything is written: an
    // unconfigured provider gets the SAME one sentence the ask card shows, the
    // widget stays open with the question still in it, and no card is made that
    // could not ask.
    if (hasProvider === false) {
      return { ok: false, message: PROVIDER_SENTENCES.nothing };
    }
    const result = await onAskFromSelection(
      selectionAsk.source,
      selectionAsk.words,
      question,
    );
    if (result.ok && result.created !== undefined) {
      askSeedToken.current += 1;
      setAskSeed({
        slug: result.created,
        question,
        token: askSeedToken.current,
      });
      setOpenOn(null);
      setOpenSessionOn(null);
      setOpenAskOn(result.created);
    }
    return result;
  }

  // A CARD CLOSE TAKES THE WIDGET WITH IT (the story's rule), and so does a
  // source the map no longer carries. The rule is read from the SAME open state
  // the cards honour, so no close path can miss it.
  useEffect(() => {
    if (selectionAsk === null) return;
    const carried = references.some(
      (reference) => reference.on === selectionAsk.source,
    );
    if (carried && openOn === selectionAsk.source) return;
    setSelectionAsk(null);
    clearTextSelection();
  }, [openOn, references, selectionAsk]);

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
          // STORY 17.1: one face at a time — opening a reference closes the
          // ask card's editor, and opening an ask closes the reference's.
          onOpen={() => {
            setOpenAskOn(null);
            setOpenSessionOn(null);
            setOpenOn(reference.on);
          }}
          onOpenCard={(slug) => {
            setOpenAskOn(null);
            setOpenSessionOn(null);
            setOpenOn(slug);
          }}
          onClose={() => setOpenOn(null)}
          cardNames={cardNames}
          sourceNames={sourceNames}
          wordSlugs={wordSlugs}
          concepts={concepts}
          readWord={readWord}
          interactionMode={interactionMode}
          zoom={zoom}
          onMove={onMove}
          onRename={onRename}
          onRefresh={onRefresh}
          onRepoint={onRepoint}
          onRemove={remove}
          onCreateAsk={onCreateAsk}
          onSelectWords={choseWords}
          onAskMade={(slug) => {
            setOpenOn(null);
            setOpenSessionOn(null);
            setOpenAskOn(slug);
          }}
          onSetNote={onSetNote}
          onPull={onPull}
          onDismissPull={onDismissPull}
          onLink={onLink}
          workspacePath={workspacePath}
          onNarrate={onNarrate}
          previewLines={previewLines}
          noteLines={noteLines}
        />
      ))}
      {/* STORY 17.1 — THE ASK CARDS, beside the reference cards on the same
          plane: their own record family, their own conversations, and the same
          grammar (name → what this is → the crop). Story 17.2 owns the thread's
          face, 17.5 the fork, and 17.6 the dangling ANCHOR's one quiet line (a
          fork's missing parent is a different, stated hole). STORY 17.10
          retires the re-anchor verb: the anchor is display-only legacy now, and
          these cards are peers made by the bubble's ASK door or wired to their
          sources.
          THE MIRROR DOES NOT KNOW ASK CARDS YET (map/mirror.ts renders ground
          references and their readings only): the ask cards draw here, and
          MAP.md's asks section is the mirror's own render of the same record
          (story 17.8). */}
      {asks.map((ask) => {
        // STORY 17.5 — THE COMPOSED THREAD: a fork reads its carried prefix
        // from the parent's record HERE, on every render, and appends its own
        // turns; a missing parent is a stated hole with the fork's own turns
        // still readable. Nothing is copied and nothing is repaired.
        const thread = askThreadOf(ask, asks, askTurns);
        // STORY 17.6 — THE ANCHOR, RESOLVED ONCE: the live name while the map
        // carries it, or "gone" with the name the record remembers. STORY 17.10
        // adds the empty case: a card with NO anchor is not dangling — it is a
        // peer ask, and its second line says "a question". Nothing here looks
        // for a replacement, rewrites the anchor or merges asks.
        const anchorView = askAnchorOf(ask, references);
        // STORY 17.9 — THE WIRES ARE THE CONTEXT: what is connected INTO this
        // card supplies its packet, never the legacy anchor field.
        const contextView = askContextOf(ask);
        return (
          <AskCard
            key={ask.on}
            ask={ask}
            anchorName={anchorView.name}
            context={contextView.cards}
            contextMissing={contextView.dangling}
            turns={thread.turns}
            carried={thread.carried.length}
            forkMissing={thread.missing}
            zoom={zoom}
            open={openAskOn === ask.on}
            previewLines={previewLines}
            onOpen={() => {
              setOpenOn(null);
              setOpenSessionOn(null);
              setOpenAskOn(ask.on);
            }}
            onClose={() => setOpenAskOn(null)}
            onAskTurn={onAskTurn}
            onStopTurn={onStopAskTurn}
            hasProvider={hasProvider}
            calls={calls}
            onOpenSettings={onOpenSettings}
            autoAsk={
              askSeed !== null && askSeed.slug === ask.on
                ? { question: askSeed.question, token: askSeed.token }
                : undefined
            }
            onAutoAsked={() => setAskSeed(null)}
            onForkTurn={
              onForkAsk === undefined
                ? undefined
                : async (carry, name) => {
                    const at = askPlacement(ask.x, ask.y);
                    const result = await onForkAsk(
                      ask.on,
                      carry,
                      name,
                      at.x,
                      at.y,
                    );
                    // A fork OPENS its new card: the person is looking at the
                    // branch they just made, not at the parent's face.
                    if (result.ok && result.created !== undefined) {
                      setOpenOn(null);
                      setOpenAskOn(result.created);
                    }
                    return result;
                  }
            }
            onRename={
              onRenameAsk === undefined
                ? undefined
                : (name) => onRenameAsk(ask.on, name)
            }
            onRemove={
              onRemoveAsk === undefined
                ? undefined
                : () => onRemoveAsk(ask.on)
            }
            onLink={onLink}
            interactionMode={interactionMode}
            onNarrate={onNarrate}
          />
        );
      })}
      {/* STORY 18.3 — THE SESSION CARDS, beside the references and the ask
          cards on the same plane: a third record family with the same grammar
          (name → what this is → the crop). A card names ONE tool row and holds
          that row's run; its transcript is the record, read at load and
          appended as the run reports, never drawn from memory of a press. */}
      {sessions.map((session) => {
        // The row is resolved HERE, from the rows this build ships: a record
        // that names a row this build no longer has is a stated hole, never a
        // repaired record (the card offers the choice again).
        const row =
          ACP_SPECS.find((spec) => spec.id === session.tool) ?? null;
        return (
          <SessionCardView
            key={session.on}
            session={session}
            toolName={row === null ? null : row.name}
            // 18.2's declaration for the NEXT run: which key it will receive,
            // by provider ROW, or that it receives none. No key, ever.
            declaration={row === null ? null : acpDeclaration(row)}
            tools={sessionTools}
            entries={sessionEntries[session.on] ?? []}
            running={sessionRunning.includes(session.on)}
            zoom={zoom}
            open={openSessionOn === session.on}
            previewLines={previewLines}
            onOpen={() => {
              setOpenOn(null);
              setOpenAskOn(null);
              setOpenSessionOn(session.on);
            }}
            onClose={() => setOpenSessionOn(null)}
            onRun={
              onRunSession === undefined
                ? undefined
                : () => onRunSession(session.on)
            }
            onStop={
              onStopSession === undefined
                ? undefined
                : () => onStopSession(session.on)
            }
            onChooseTool={
              onChooseSessionTool === undefined
                ? undefined
                : (tool) => onChooseSessionTool(session.on, tool)
            }
            // STORY 18.4 — the pending ask and its two verbs. The layer holds
            // no permission state: the hook does, and this only forwards.
            permission={sessionPermission[session.on] ?? null}
            onAllowOnce={
              onAnswerSessionPermission === undefined
                ? undefined
                : () => void onAnswerSessionPermission(session.on, "allow-once")
            }
            onRefuse={
              onAnswerSessionPermission === undefined
                ? undefined
                : () => void onAnswerSessionPermission(session.on, "refuse")
            }
            onMakeResult={
              onMakeSessionResult === undefined
                ? undefined
                : () => onMakeSessionResult(session.on)
            }
            onRemove={
              onRemoveSession === undefined
                ? undefined
                : () => onRemoveSession(session.on)
            }
            // STORY 16.22 — the shared name pill's rename, through the hook's
            // one session-name write path.
            onRename={
              onRenameSession === undefined
                ? undefined
                : (name) => onRenameSession(session.on, name)
            }
            onLink={onLink}
            interactionMode={interactionMode}
            onNarrate={onNarrate}
          />
        );
      })}
      {/* STORY 16.19 — THE SELECTION'S QUESTION WIDGET, at the words it was
          opened from. One field, one ask verb, one dismiss; it is mounted only
          while a selection exists, so an empty one can never open it. */}
      {selectionAsk !== null && (
        <SelectionAsk
          x={selectionAsk.x}
          y={selectionAsk.y}
          zoom={zoom}
          words={selectionAsk.words}
          onAskQuestion={askSelection}
          onDismiss={dismissSelection}
        />
      )}
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
  onRename,
  onRefresh,
  onRepoint,
  onRemove,
  onCreateAsk,
  onSelectWords,
  onAskMade,
  onSetNote,
  onPull,
  onDismissPull,
  onLink,
  workspacePath,
  onNarrate,
  previewLines,
  noteLines,
  sourceNames,
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
  /**
   * STORY 18.4 — every card a copy may name, references AND session cards, for
   * the reading's provenance only. The mention picker stays references-only.
   */
  sourceNames: ReadonlyMap<string, string>;
  /** Every concept word's slug, or null when the concept map was not read. */
  wordSlugs: ReadonlySet<string> | null;
  /** The concept index the picker offers (null: not read). */
  concepts: readonly ConceptWord[] | null;
  /** The ONE cross-map read: a word mention's name and memory, or null. */
  readWord: (slug: string) => Promise<ConceptWord | null>;
  interactionMode: GestureMode;
  zoom: number;
  onMove: GroundLayerProps["onMove"];
  /** STORY 16.21: the name pill's one writer (absent in a render test). */
  onRename?: GroundLayerProps["onRename"];
  onRefresh: GroundLayerProps["onRefresh"];
  onRepoint: GroundLayerProps["onRepoint"];
  onRemove: (reference: GroundReference) => Promise<GroundAddResult>;
  /** STORY 17.1: make an ask card beside this reference (one record line). */
  onCreateAsk?: (
    sourceSlug: string,
    name: string,
    x: number,
    y: number,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 16.19 — THE READING'S SELECTION, on mouse-up: the raw words and the
   * plane point they end at. The card only REPORTS it (the layer owns the
   * widget); it writes nothing and reads nothing, and a collapsed or
   * outside-the-reading selection is never reported.
   */
  onSelectWords?: (source: string, raw: string, x: number, y: number) => void;
  /**
   * STORY 17.10 — the card it just made, so the LAYER (which owns which face is
   * open) can open it. A reference card does not hold the open-ask state.
   */
  onAskMade?: (slug: string) => void;
  onSetNote?: (on: string, text: string) => Promise<GroundAddResult>;
  onPull?: (on: string) => Promise<GroundAddResult>;
  onDismissPull?: (on: string) => void;
  onLink?: (from: string, to: string) => Promise<GroundAddResult>;
  /**
   * The workspace root, for the ONE cross-map read (story 16.7) and the
   * image's own file (story 16.15). The ask card reads its own source through
   * the hook, never through this prop.
   */
  workspacePath?: string;
  /** STORY 16.16: the app's one narration sink (the cursor chip's state). */
  onNarrate?: (gesture: GestureNarration) => void;
  /** STORY 17: the stated fold threshold, already bounded (preview + note). */
  previewLines: number;
  noteLines: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // STORY 16.19 — the reading itself: the ONLY surface selection is taken from
  // (a card's small face is a crop, so there is nothing to select there).
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
  // STORY 17.1 — THE ASK CARD'S proposed name, before anything is written.
  // (Story 16.12's selection name field lived here; story 18 removed that verb
  // and its field, so the ask card is the card this face names.)
  const [askNaming, setAskNaming] = useState<{ name: string } | null>(null);
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
    // STORY 17.1: a closed card forgets the ask's proposed name too; nothing
    // was written by proposing one.
    setAskNaming(null);
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
        // STORY 17.9: the drag lives in ONE helper now (linkDrag.ts), so an ask
        // card and a session card offer the same gesture and their release can
        // land on any ground card. Story 16.16's sentence still rides it.
        if (startGroundLinkDrag(e, reference.on, {
          interactionMode,
          onLink,
          onNarrate,
        })) {
          return;
        }
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
      // While a gesture is armed every plane press stands still — the card's
      // drag included (ADR-0016's gate).
      if (isGestureArmed(interactionMode)) return;

      // STORY 16.21 — was this press on the name PILL? The pill is the card's
      // HANDLE, not its door: a press there that never moves opens nothing (a
      // double-click on it opens the rename field). The drag itself is the very
      // same rule below — the pill is a child of this card, so its press lands
      // here like a press on the body, with the same threshold and the same one
      // write on release. There is no second drag to keep in step.
      const onPill = (e.target as HTMLElement).closest(".ground-pill") !== null;

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
        // STORY 16.21: a press on the NAME is the handle, so it opens nothing —
        // the double-click on the pill opens the rename field instead.
        if (!onPill) onOpen();
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    el.addEventListener("mousedown", handleMouseDown);
    return () => el.removeEventListener("mousedown", handleMouseDown);
  });

  /* STORY 16.19 — CATCH THE SELECTION ON MOUSE-UP, and never an empty one.
   *
   * The reading's own press already begins TEXT SELECTION, not a card drag (the
   * raw mousedown handler above returns early for .ground-reading), so this
   * listener only reads what the browser selected: the words must be inside THIS
   * reading (the range's common ancestor), the collapse must leave something, and
   * then the selection's lower-left corner is converted to a PLANE point so the
   * widget follows the map at any zoom. The card writes nothing here: the layer
   * owns the widget, and the words are CONTEXT for a question, never content.
   *
   * PROVISIONAL: the point (the range's lower-left, converted through the card's
   * own rect and the camera's zoom) and the widget hanging under it.
   */
  useEffect(() => {
    if (!open || onSelectWords === undefined) return;
    const report = onSelectWords;
    function onMouseUp() {
      const el = readingRef.current;
      const selection = window.getSelection();
      if (el === null || selection === null) return;
      if (selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;
      const raw = selection.toString();
      if (selectionWords(raw) === null) return;
      const cardRect = cardRef.current?.getBoundingClientRect() ?? null;
      const at = range.getBoundingClientRect();
      const point =
        cardRect === null || zoom === 0
          ? { x: reference.x, y: reference.y }
          : {
              x: reference.x + (at.left - cardRect.left) / zoom,
              y: reference.y + (at.bottom - cardRect.top) / zoom,
            };
      report(reference.on, raw, point.x, point.y);
    }
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [open, onSelectWords, reference.on, reference.x, reference.y, zoom]);

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
      setPicker(null);
      setPanel(null);
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
      onClose();
    }
    document.addEventListener("mousedown", onPressAway, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPressAway, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, panel]);

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
    reading === null ? null : readingProvenance(reading, sourceNames);

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

  // STORY 18 — 16.12's selection→card verb is gone: there is no
  // `askAboutSelection`, no proposed selection name and no confirm, because the
  // person's correction was that selecting text in a reading should open the
  // ASK widget (a later story), not mint a ground card. The reading's bytes are
  // still shown and a stored selection card still renders; only the making went.

  // STORY 17.1 — THE ASK CARD'S TWO MOVES. `ask about this` only PROPOSES a
  // name (the SOURCE card's name plus "question", the card-beside-its-source
  // idiom); the confirm is the ONE write — an EMPTY ask card plus a wire from
  // this reference (STORY 17.10), and a blank name is refused with the same one
  // sentence before anything is queued. Cancel forgets the proposal; the
  // reference card itself is never touched by either.
  function askAboutCard() {
    if (onCreateAsk === undefined || busy) return;
    setAskNaming({ name: proposeAskName(reference.name) });
    setProblem(null);
  }

  function cancelAsk() {
    setAskNaming(null);
  }

  async function makeAsk() {
    if (askNaming === null || onCreateAsk === undefined || busy) return;
    const refusal = askRefusal(askNaming.name);
    if (refusal !== null) {
      setProblem(refusal);
      return;
    }
    const at = askPlacement(reference.x, reference.y);
    setBusy(true);
    setProblem(null);
    const result = await onCreateAsk(
      reference.on,
      askNaming.name.trim(),
      at.x,
      at.y,
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setAskNaming(null);
    // STORY 17.10 — the new ask card OPENS (the layer owns that state): the
    // person pressed the verb to ask in it, and its composer is next.
    if (result.created !== undefined) onAskMade?.(result.created);
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
      {/* STORY 16.21 — THE NAME FLOATS ABOVE THE CARD. It left the body because
          the body's own reading cropped it and the plane's scale shrank it: the
          pill counter-scales (clamped) so the name is legible at 25% zoom, it is
          the card's drag HANDLE (a press on it rides the card's one raw mousedown
          listener, below — no second drag) and a double-click renames it through
          the one name write path. The body below starts at the TYPE LINE. */}
      <CardNamePill
        name={reference.name}
        zoom={zoom}
        busy={busy}
        onRename={
          onRename === undefined
            ? undefined
            : async (name: string) => {
                const result = await onRename(reference.on, name);
                // A refused write is one sentence on the card, never a name
                // that quietly snaps back for no stated reason.
                if (!result.ok) setProblem(result.message);
                return result;
              }
        }
      />
      {/* STORY 16.13 (shortlist items 3 and 10): the card's second line says
          WHAT THIS IS — the copy kept from a file, a copy of text selected from
          another card, or a reference with no reading. Never a broken box. */}
      <div className="ground-kind">
        {readingKind(reading, sourceNames, pageTitle)}
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
          // STORY 18: the reading is just the stored bytes. It was 16.12's
          // selection surface; the person's correction removed that verb, and
          // the reading itself keeps rendering unchanged. STORY 16.19: this
          // is the SELECTION surface the question widget is opened from — the
          // ref is read on mouse-up and nothing about the element changed.
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
      {/* STORY 17.1 — THE ASK CARD'S NAME, before anything is written. The
          field is PRE-FILLED with the proposed name and is the person's to
          edit; the confirm writes the ask's one line, and a blank name refuses
          with the same one sentence the bubble uses. Esc or cancel forgets it. */}
      {askNaming !== null && (
        <div
          className="ground-selection ground-ask-naming"
          role="group"
          aria-label="name the ask card"
        >
          <input
            className="ground-selection-name"
            value={askNaming.name}
            autoFocus
            aria-label="name the ask card"
            disabled={busy}
            onChange={(e) => {
              setAskNaming({ name: e.target.value });
              if (problem !== null) setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") {
                if (e.key !== "Escape") return;
                // Esc cancels THIS field only (the card stays open).
                e.preventDefault();
                e.stopPropagation();
                cancelAsk();
                return;
              }
              e.preventDefault();
              void makeAsk();
            }}
          />
          <div className="ground-selection-actions">
            <button
              type="button"
              className="ground-selection-make"
              disabled={busy}
              onClick={() => void makeAsk()}
            >
              make the card
            </button>
            <button
              type="button"
              className="ground-selection-cancel"
              disabled={busy}
              onClick={cancelAsk}
            >
              cancel
            </button>
          </div>
        </div>
      )}
      <div className="ground-actions">
          {/* STORY 17.1 — THE ASK VERB: a card about this reference. It only
              PROPOSES a name (the person edits or accepts it); the confirm is
              the one write, and the reference card itself is never touched.
              Story 17.7 retired the embedded panel: this is the ground map's
              ONLY ask-shaped verb. */}
          {open && onCreateAsk !== undefined && askNaming === null && (
            <button
              type="button"
              className="ground-ask-card"
              disabled={busy}
              onClick={askAboutCard}
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
          {/* STORY 17.11 — the same quiet line, saying the copy's maker: a
              RULE made this card, so there is no file behind it to re-read. */}
          {reading !== null && distilledSourceSlug(reading) !== null && (
            <div className="ground-quiet">
              {distilledAuthors(reading) === null
                ? "a rule's copy; there is no file to refresh or point at."
                : "distilled by " +
                  distilledAuthors(reading)!.manager +
                  " from " +
                  distilledAuthors(reading)!.task +
                  "'s reply; there is no file to refresh or point at."}
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
      {/* STORY 17.7 — THE EMBEDDED PANEL IS GONE. The expanded card's one
          ask-shaped verb is `ask about this` above: it makes an ask card beside
          this one, and THAT card owns the turn, the declaration, the readback
          and the stop. There is no second way to ask on the ground map. */}
    </div>
  );
}
