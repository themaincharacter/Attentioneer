import { useCallback, useEffect, useRef, useState } from "react";
import {
  fileMeta as fsFileMeta,
  readTextFile as fsReadTextFile,
  removeFile,
  type FileMetaAnswer,
} from "../lib/fs";
import { createWriteQueue } from "../lib/writeQueue";
import {
  cardAddEvent,
  cardMoveEvent,
  cardRemovalEvents,
  cardRestoreEvent,
  historyWriteTask,
  linkAddEvent,
  linkRemoveEvent,
  noteRemoveEvent,
  noteSetEvent,
  readHistory,
  readingRefreshEvent,
  readingRepointEvent,
  readingTakeEvent,
  type HistoryEvent,
} from "../map/history";
import {
  ASK_MISSING_REFUSAL,
  ASK_SOURCE_REFUSAL,
  ASK_THREAD_BOUND,
  addAsk,
  appendExchange,
  askQuestionRefusal,
  askRefusal,
  loadAskTurns,
  loadAsks,
  saveAsks,
  sharedSlugs,
  type AskCard,
  type AskTurn,
} from "../map/asks";
import {
  addGroundReference,
  loadGround,
  moveGroundReference,
  saveGround,
  withGroundRemoved,
  type GroundReference,
} from "../map/ground";
import {
  GROUND_LINK_IO,
  addGroundLink,
  groundLinkRefusal,
  loadGroundLinks,
  orphanGroundLinks,
  saveGroundLinks,
  withoutGroundLink,
  withoutGroundLinksFor,
  type GroundLink,
  type GroundLinkIo,
} from "../map/groundLinks";
import {
  IMAGE_PULL_REFUSAL,
  IMAGE_REFRESH_REFUSAL,
  READING_REFUSALS,
  REFRESH_UNCHANGED,
  loadReadings,
  loadReadingTexts,
  cappedReadingText,
  isFileReading,
  pageReading,
  readingAbsolutePath,
  readingExtract,
  readingFileName,
  readingFor,
  readingTextPath,
  refreshReading,
  restoreReadingText,
  resolveReadingState,
  saveReadings,
  selectionReading,
  selectionRefusal,
  storeReadingText,
  storeSelectionText,
  takeReading,
  videoReading,
  withReading,
  withReadingRemoved,
  type Reading,
  type ReadingState,
} from "../map/readings";
import {
  MEDIA_IO,
  loadMedia,
  loadThumbSrcs,
  mediaFor,
  orphanMedia,
  restoreThumb,
  saveMedia,
  storeThumb,
  thumbAbsolutePath,
  thumbSrcOf,
  thumbSvg,
  withMedia,
  withoutMedia,
  type Media,
  type MediaIo,
} from "../map/media";
import {
  NOTE_IO,
  loadNotes,
  notePath,
  removeNote,
  restoreNote,
  saveNote,
  type NoteIo,
} from "../map/notes";
import {
  mirrorWriteTask,
  renderMirror,
  type MirrorView,
} from "../map/mirror";
import { pullReading, type PulledText } from "../map/pull";
import {
  createPageFetcher,
  createVideoFetcher,
  type PageFetchAnswer,
  type PageImage,
  type VideoFetchAnswer,
} from "../turn/pageFetch";
import { readSecret } from "../lib/secret";
import {
  cardAskContext,
  fetchAskBlock,
  type AskContext,
} from "../turn/context";
import {
  assembleAskCardPacket,
  type AskPacket,
  type AskPacketReadback,
} from "../turn/packet";
import { loadTurnSettings } from "../turn/provider";
import { PROVIDER_SENTENCES, resolveSelection } from "../turn/providers";
import {
  TURN_SENTENCES,
  routeOf,
  turnSentence,
  type TurnPort,
  type TurnResult,
} from "../turn/turn";

/**
 * The ground map's loaded state and its one write path (story 16.1; story 16.2
 * adds the states, the move and the two explicit re-reads).
 *
 * The app's other record families live in `canvas/useMap.ts`; ground is its
 * own map with its own family, so it loads and writes beside it instead of
 * riding the concept map's reload. `useGround` is the whole seam:
 *
 *   - LOAD: `map/ground.txt`, `map/readings.txt` and `map/ground-links.txt`
 *     are read on every workspace open (and every workspace change), each
 *     reference's reading text is read from `map/readings/<slug>.md`, and each
 *     reading's file is stat'ed ONCE (one `fileMeta` per reading, in
 *     parallel). The `states` are COMPUTED from that metadata and never
 *     written into a record (story 16.2 decision 1): a second truth would drift
 *     from the file. Nothing watches, polls or re-reads later; the `map/`
 *     folder alone is the source, and there is no index, cache or side table.
 *   - ADD (story 16.1): coin the name, take the reading, then write the text
 *     file, the readings line and the ground line, in that order. The reference
 *     is written LAST, so a crash can leave an orphan reading but never a
 *     ground reference whose file was refused.
 *   - MOVE (16.2): a drop rewrites `ground.txt` once; no reading is touched.
 *   - REFRESH / RE-POINT (16.2 decisions 4 and 5): the ONLY re-reads, both
 *     pressed by the person. Each re-takes the head under the same cap and
 *     rewrites the text file FIRST and the readings line LAST, so a crash can
 *     never leave a reference pointing at text that is not there. Refresh keeps
 *     the line's form/value (the file did not move); re-pointing takes a new
 *     pick and its location rule. A refusal keeps the old reading and shows the
 *     sentence; nothing is written.
 *   - REMOVE (16.3): the card, its reading and its kept text leave together,
 *     in the fixed order below (the reference first, so a crash cannot leave a
 *     reference pointing at a reading whose text file is gone). STORY 16.6
 *     adds the note file to that ONE pass, after the reading's text and before
 *     the links' cascade: a card's own files go together. A refused unlink
 *     answers one sentence and repairs nothing on its own.
 *   - LINK / UNLINK (16.5): the ground map's WORDLESS wiring lives in
 *     `map/ground-links.txt` and loads with the workspace beside the other two
 *     files. A draw is ONE write (the ordered pair is the identity, so drawing
 *     the same link again rewrites its one line); an unlink is one write. The
 *     direction is recorded and READ BY NOTHING (the epic's reframe: a link is
 *     not a Distance and carries no meaning). Deleting a reference also takes
 *     every link that NAMES it, in both directions, in the same queued pass
 *     after the reference's own removal (the card's existing order) — the app
 *     never manufactures an orphan of its own. Orphans and malformed lines in
 *     the link file are PRESERVED and surfaced in the ground notices group
 *     (ADR-0009), exactly like the other two files' unreadable lines.
 *   - NOTE (16.6): the person's own words live in `map/notes/<slug>.md`,
 *     ONE read per card that has a file. A note is never loaded into, or
 *     joined with, the reading: the two families share only the slug. An
 *     orphan note file (a slug with no card) is REPORTED, never adopted and
 *     never deleted; `setNote` only ever writes for a card the map still
 *     carries, and saving empty text removes the file rather than leaving an
 *     empty note.
 *   - PULL (16.8): the person's one verb asks for MORE of a card's source,
 *     under one stated budget, and the text is held HERE as view state
 *     (`pulled`), NEVER written. It re-stamps nothing: the reading line, its
 *     stored text, the note and the computed state word all stay exactly as
 *     they were — refresh remains the only re-read that re-stamps. A pull is
 *     dismissed by the person or when the card closes; a workspace change
 *     forgets every pull. No read happens on open, in a watcher or in the
 *     background: `pull` is only ever the card's press.
 *   - THE MIRROR (16.9): every write above queues ONE whole rewrite of
 *     `MAP.md` at the workspace root, through this same queue and AFTER the
 *     records that caused it — so a reader never sees a half-updated index.
 *     It is DERIVED and disposable: the records are the truth, a failed
 *     mirror never fails the move (one sentence in the ground notices group),
 *     and opening writes nothing, so deleting the file is safe — the next move
 *     brings it back byte-identically.
 *   - THE HISTORY (16.10): every AUTHORED write above also appends one line
 *     per move to `map/ground-history.jsonl`, through this same queue and
 *     AFTER the record write it describes. Looking around writes nothing: no
 *     line for opening or closing a card, expanding, pulling, hovering,
 *     focusing, panning or typing a draft — the panel and the camera are not
 *     the map. The lines carry no content: a slug, a point, a storage form, a
 *     byte count, a file's NAME where the move needs one — never a note's
 *     words and never a reading. The file is only ever ADDED TO (the earlier
 *     bytes are a prefix that never changes), and its first appearance gets
 *     one baseline line so a later replay knows where the board began. A
 *     malformed line is preserved and reported in the ground notices group; a
 *     failed append is one sentence and NEVER undoes the move.
 *   - A PAGE CARD (16.14): the person pastes a web address; the SIDECAR reads
 *     the page once and this hook writes the extracted text (readings.txt,
 *     form url, extract page), a LOCAL thumbnail (map/media/) and the media
 *     line, then the ground line last. A refused fetch writes NOTHING; the
 *     card renders offline because title, text and image are all copies.
 *   - A VIDEO CARD (16.15): the person pastes a video address; the SIDECAR
 *     reads its oEmbed look once and this hook writes the thumbnail, the media
 *     line (kind video), the reading line (form url, extract video) and the
 *     ground line last. The card says the transcript needs a model that can
 *     read video; nothing pretends the text is here.
 *   - AN IMAGE CARD (16.15) is an ordinary FILE reading (`extract: image`)
 *     with NO text at all: the picture is drawn from wherever it already is
 *     through the asset protocol, so nothing is copied and only the pointing
 *     is recorded.
 *   - REMOVING A PAGE OR VIDEO CARD (16.14b): the delete reads the card's
 *     media line and its thumbnail's bytes BEFORE any unlink, and Restore
 *     writes them back in the house order — picture, reading text, readings
 *     line, media line, note, ground line, links — so the folder comes back
 *     byte-identical. A media line whose card is gone is an ORPHAN: kept
 *     where it is, named in the ground notices group and in the mirror's
 *     unknowns, never adopted and never deleted.
 *   - A SELECTION CARD (16.12): the person selects text inside an expanded
 *     card's reading, names the new card, and `createSelection` writes the
 *     excerpt's text file, its reading line (provenance `card://<source>`) and
 *     the ground line, in that order. NO source is read or stat'ed, the source
 *     card's files are never touched, and the excerpt can never be stale.
 *   - The whole read-modify-write runs through the app's one per-file
 *     discipline (`createWriteQueue`, ADR-0004/ADR-0018): one line at a time,
 *     never a whole-folder rewrite. THE PULL, THE MIRROR AND THE HISTORY ARE
 *     NOT IN THAT SENTENCE: a pull is a read, the mirror is one whole-file
 *     rewrite of a derived file, and the history only ever adds after earlier
 *     bytes. The queue still serializes the mirror's and the history's writes,
 *     so a look never waits on a drop.
 *
 * PROVISIONAL: the state names, the form rule for new picks, the write order,
 * the sentences and the look (story 16.2's decisions, before an ADR).
 */

/** What one person move said: done, or the sentence the layer shows. */
export type GroundAddResult =
  | {
      ok: true;
      /**
       * STORY 17.3 — what an ask turn's send left, so the card can open the
       * exact bytes afterwards (the follow-up included). Absent on every move
       * that sends nothing.
       */
      readback?: AskPacketReadback;
    }
  | {
      ok: false;
      message: string;
      /** The same bytes for a turn that left and did not finish. */
      readback?: AskPacketReadback;
      /**
       * The records were removed but a later piece refused (the unlink): the
       * card is already gone, so the layer shows the sentence where it stood
       * instead of on a card that no longer exists.
       */
      recordsRemoved?: boolean;
    };

/** Everything the ground layer renders, loaded from the map folder. */
export interface GroundView {
  references: readonly GroundReference[];
  /**
   * STORY 17.1 — every ask card, in FILE ORDER. An ask card is its own record
   * family (`map/asks.txt`), beside the ground references and never a reading:
   * it has no reading text and no note, only a name, a point and an anchor.
   */
  asks: readonly AskCard[];
  /**
   * Each ask card's conversation, keyed by slug (story 17.1). The words live in
   * `map/asks/<slug>.jsonl`, one line per turn; an absent file is an empty
   * conversation, never an invented one.
   */
  askTurns: Readonly<Record<string, readonly AskTurn[]>>;
  /** Unreadable `map/asks.txt` lines, preserved and surfaced. */
  malformedAsks: readonly string[];
  readings: readonly Reading[];
  /**
   * Each media-bearing card's line (story 16.14): the page's title and its
   * LOCAL thumbnail path. Kept beside the reading, never joined with it.
   */
  media: readonly Media[];
  /**
   * Each card's thumbnail, READ from the map folder at load and turned into a
   * data URL (story 16.14). Absent means no image; the card never says so.
   */
  thumbs: Readonly<Record<string, string>>;
  /**
   * STORY 16.14b — media lines whose card is not on the map: kept exactly
   * where they are and named in the ground notices group, never adopted and
   * never deleted (the notes' rule). Computed from the load and every write,
   * never stored, so the app cannot manufacture one of its own.
   */
  orphanMedia: readonly Media[];
  /** Each reading's text, keyed by slug (a missing text is simply absent). */
  texts: Readonly<Record<string, string>>;
  /**
   * Each reference's reading STATE, computed at load (story 16.2). Never a
   * record field: `unread` means no reading line, and the other four come
   * from the file's metadata (see `resolveReadingState`).
   */
  states: Readonly<Record<string, ReadingState>>;
  /**
   * Each card's EPHEMERAL pull, keyed by slug (story 16.8): the source text
   * the person asked to see more of, under the stated budget. VIEW STATE ONLY —
   * it is never written into a reading, a note or any record, and every write
   * path below leaves it as it found it. Absent means "nothing pulled".
   */
  pulled: Readonly<Record<string, PulledText>>;
  /**
   * Each card's authored note, keyed by slug (story 16.6). A card with no note
   * is simply absent — no empty string, no placeholder.
   */
  notes: Readonly<Record<string, string>>;
  /**
   * Note files whose slug has no card (story 16.6): kept exactly where they
   * are and named in the ground notices group, never adopted, never deleted.
   */
  orphanNotes: readonly string[];
  /**
   * Every readable ground link, in FILE ORDER (story 16.5). A link is an
   * ordered pair of slugs and nothing else: no word, no meaning.
   */
  links: readonly GroundLink[];
  /**
   * Links whose endpoint is not a reference this map carries (story 16.5):
   * preserved in the file and REPORTED in the ground notices group, never
   * dropped and never repaired into a card (ADR-0009).
   */
  orphanLinks: readonly GroundLink[];
  /** Unreadable `map/ground.txt` lines, preserved and surfaced. */
  malformedGround: readonly string[];
  /** Unreadable `map/readings.txt` lines, preserved and surfaced. */
  malformedReadings: readonly string[];
  /** Unreadable `map/ground-links.txt` lines, preserved and surfaced. */
  malformedLinks: readonly string[];
  /**
   * The one sentence a failed mirror write answers (story 16.9), or null. The
   * mirror is DERIVED: its failure never fails the person's move, and the
   * sentence clears itself on the next mirror that lands.
   */
  mirrorNotice: string | null;
  /**
   * The one sentence a failed HISTORY append answers (story 16.10), or null.
   * A history failure is a notice and never a failed move: the records were
   * written first, the move stands, and the log says it could not follow. The
   * sentence clears itself on the next append that lands.
   */
  historyNotice: string | null;
  /**
   * Unreadable `map/ground-history.jsonl` lines (story 16.10), preserved
   * verbatim in the file and surfaced in the ground notices group — never
   * dropped and never repaired into an event.
   */
  malformedHistory: readonly string[];
  /**
   * STORY 16.13 — the ONE pending deletion the toast can put back, with the
   * bytes it read before unlinking. View state only; a second delete replaces
   * it (committing the first), and the toast's window or its × clears it.
   */
  restorable: RemovedCard | null;
  /**
   * STORY 16.13 — one sentence when a restore only partly came back. It rides
   * the toast in place of the Restore verb; a full restore leaves it null.
   */
  restoreNotice: string | null;
  /** The map folder's ground records have been read once. */
  loaded: boolean;
  /**
   * STORY 17.1 — MAKE AN ASK CARD beside a reference: one `map/asks.txt` line,
   * with a name the person accepted or edited and an `anchor` field naming the
   * reference it is about. The anchor is a FIELD, never a link; a blank name
   * refuses before anything is queued, and the source card's files are never
   * touched. The shared slug space (both files) mints the new slug.
   */
  createAsk: (
    sourceSlug: string,
    name: string,
    x: number,
    y: number,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 17.1 — ASK ONE QUESTION inside an ask card: the existing card-ask
   * turn path (the packet anchored on the reference, the person's question),
   * and then ONE append-only write of the exchange — the person's line always,
   * the answer line only when the turn answered. No PRISM yet (story 17.4 owns
   * it), no history line and no mirror (story 17.8), and the reference card is
   * never touched.
   */
  askTurn: (
    slug: string,
    question: string,
    onPart?: (text: string) => void,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 17.2 — STOP the running ask turn: the existing turn port's stop, so
   * the card's one stop verb is the same stop the embedded panel uses. VIEW
   * STATE only; what arrived is kept by the card, marked a partial, and the
   * record still writes the person's line and no answer line.
   */
  askStop: () => Promise<void>;
  /** Add one reference from a picked text file (the one create write). */
  create: (
    name: string,
    x: number,
    y: number,
    from: string,
  ) => Promise<GroundAddResult>;
  /**
   * Make a NEW card whose reading is exactly the selected bytes (story 16.12):
   * provenance is the source card's slug (`card://`), no file is read and
   * nothing behind it can go stale. The name is the person's — the layer
   * proposes it, and this refuses a blank one before touching a file.
   */
  createSelection: (
    sourceSlug: string,
    name: string,
    x: number,
    y: number,
    text: string,
  ) => Promise<GroundAddResult>;
  /**
   * Add one reference from a pasted web address (story 16.14): the sidecar
   * fetches it ONCE, the text becomes the reading and a local thumbnail is
   * kept. A refused fetch writes NOTHING — there is no half-formed card.
   */
  createPage: (
    name: string,
    x: number,
    y: number,
    url: string,
  ) => Promise<GroundAddResult>;
  /**
   * Add one reference from a pasted VIDEO address (story 16.15): the sidecar
   * reads its oEmbed look ONCE, the title and a LOCAL thumbnail are kept, and
   * the card says the transcript needs a model that can read video. A refused
   * read writes NOTHING — there is no half-formed card.
   */
  createVideo: (
    name: string,
    x: number,
    y: number,
    url: string,
  ) => Promise<GroundAddResult>;
  /** Move one reference to a dropped point (one line, on release). */
  move: (on: string, x: number, y: number) => Promise<GroundAddResult>;
  /** Re-read this reference's file, by the person's press only. */
  refresh: (on: string) => Promise<GroundAddResult>;
  /** Point this reference at another file and take its head (one write). */
  repoint: (on: string, from: string) => Promise<GroundAddResult>;
  /**
   * Remove one reference, its reading and its kept text (story 16.3): the
   * `ground.txt` line, the `readings.txt` line, then `map/readings/<slug>.md`,
   * in that order, and then every link that names it in both directions
   * (story 16.5). A refused unlink answers one sentence and repairs nothing.
   */
  remove: (on: string) => Promise<GroundAddResult>;
  /**
   * Draw one WORDLESS link from a card to another (story 16.5): one ordered
   * pair, one line. Drawing the identical link again rewrites that line; the
   * reverse drag is a second, separate line. A self-link refuses with one
   * sentence.
   */
  link: (from: string, to: string) => Promise<GroundAddResult>;
  /** Remove one exact ordered pair; the two cards stay. */
  unlink: (from: string, to: string) => Promise<GroundAddResult>;
  /**
   * Save one card's note (story 16.6): the text lands in
   * `map/notes/<slug>.md` VERBATIM, or the file is removed when the text is
   * empty. ONE write, through the same queue; a refused over-cap note writes
   * nothing and answers one sentence. The reading is never touched.
   */
  setNote: (on: string, text: string) => Promise<GroundAddResult>;
  /**
   * PULL one card's source (story 16.8), under the provisional budget, and
   * hold it as view state. READ-ONLY: nothing on disk changes, the state word
   * and the stored reading are untouched, and the text is forgotten when the
   * card closes or the person dismisses it. A refusal clears any older pull
   * and answers the existing sentence; the card shows it in place.
   */
  pull: (on: string) => Promise<GroundAddResult>;
  /** Forget one card's pulled text. View state only — nothing is written. */
  dismissPull: (on: string) => void;
  /**
   * STORY 16.13 — put the pending deletion back, SAME BYTES, and log the move.
   * A partial restore answers one sentence naming what came back and what did
   * not; either way the pending restore is spent (one toast, one restore).
   */
  restore: () => Promise<GroundAddResult>;
  /** Close the toast: commits the pending deletion and forgets its bytes. */
  dismissRestore: () => void;
}

/** The view without its verbs: what the load and every write render. */
type GroundLoaded = Omit<
  GroundView,
  | "createAsk"
  | "askTurn"
  | "askStop"
  | "create"
  | "createSelection"
  | "createPage"
  | "createVideo"
  | "move"
  | "refresh"
  | "repoint"
  | "remove"
  | "link"
  | "unlink"
  | "setNote"
  | "pull"
  | "dismissPull"
  | "restore"
  | "dismissRestore"
>;

const EMPTY: GroundLoaded = {
  references: [],
  asks: [],
  askTurns: {},
  malformedAsks: [],
  readings: [],
  media: [],
  orphanMedia: [],
  thumbs: {},
  texts: {},
  states: {},
  pulled: {},
  notes: {},
  orphanNotes: [],
  links: [],
  orphanLinks: [],
  malformedGround: [],
  malformedReadings: [],
  malformedLinks: [],
  mirrorNotice: null,
  historyNotice: null,
  malformedHistory: [],
  restorable: null,
  restoreNotice: null,
  loaded: false,
};

/** The bridges the delete needs; the app passes lib/fs, a test a fake. */
export interface GroundRemovalIo {
  saveGround: typeof saveGround;
  saveReadings: typeof saveReadings;
  removeFile: (path: string) => Promise<void>;
  /**
   * STORY 16.13: the delete READS the removed texts into memory BEFORE it
   * unlinks anything, so Restore can write the same bytes back. A null answer
   * (no file) is a quiet absence, never a failure.
   */
  readTextFile: (path: string) => Promise<string | null>;
}

/** The real bridges, bound once so this module stays importable in tests. */
const GROUND_REMOVAL_IO: GroundRemovalIo = {
  saveGround,
  saveReadings,
  removeFile,
  readTextFile: fsReadTextFile,
};

/** One link the cascade took, with where it sat in file order. */
export interface RemovedLink {
  link: GroundLink;
  index: number;
}

/**
 * STORY 16.13 (shortlist item 1) — WHAT A DELETE KEEPS IN MEMORY so the toast's
 * Restore can put the SAME BYTES back: the card's record and point, its reading
 * line, the reading text and the note exactly as the files held them, and every
 * link the cascade took with its file position. None of this is written
 * anywhere; it lives in the hook until the toast closes (or a second delete
 * commits it).
 */
export interface RemovedCard {
  reference: GroundReference;
  /** Where the line sat in file order, so Restore can put it back there. */
  referenceIndex: number;
  reading: Reading | null;
  readingIndex: number;
  /** The reading text file's bytes, read before the unlink; null if none. */
  readingText: string | null;
  /** The note file's bytes, read before its unlink; null if there was none. */
  note: string | null;
  /**
   * STORY 16.14b — the card's media line, read before the delete; null when it
   * had none. With `mediaIndex` and the wrapper's bytes below, Restore can put
   * the title and the picture back exactly where they were.
   */
  media: Media | null;
  /** Where the media line sat in file order, so Restore can put it back there. */
  mediaIndex: number;
  /**
   * The thumbnail wrapper's bytes, read before its unlink; null when the card
   * had no picture (a missing one stays missing — nothing is invented).
   */
  thumbSvgText: string | null;
  /** Every link naming the card, both directions, in file order. */
  links: readonly RemovedLink[];
  /** The computed reading state at delete time (view state, never a record). */
  state: ReadingState;
}

/** What a delete left behind: the two files' next lines, and its sentence. */
export interface GroundRemoval {
  references: GroundReference[];
  readings: Reading[];
  /**
   * null when every piece went. A REFUSED UNLINK answers one sentence: the
   * two lines are already gone (the order above) and the text file is left
   * exactly as it is — no partial silent repair, no second attempt.
   */
  refusal: string | null;
  /**
   * STORY 16.13: the card as it was, for Restore. null only if the reference
   * was not on the map when the delete ran (nothing was kept from it).
   */
  removed: RemovedCard | null;
}

/** The one sentence a refused unlink answers (PROVISIONAL wording). */
export const GROUND_REMOVAL_REFUSAL =
  "the reference and its reading were removed, but its text file could not be removed.";

/**
 * The delete's ONE sequence (story 16.3), pure apart from the bridges it is
 * handed:
 *
 *   1. the reference's `ground.txt` line leaves FIRST, so a crash can never
 *      leave a reference pointing at a reading whose text file is gone;
 *   2. its `readings.txt` line leaves second;
 *   3. `map/readings/<slug>.md` is unlinked last.
 *
 * Malformed lines in either file are handed back to the writers unchanged
 * (ADR-0009: preserved, never silently dropped), and other references are
 * untouched. An absent text file is not a refusal — the bridge treats a
 * missing path as a quiet no-op — while a refused unlink answers one sentence
 * and leaves everything else exactly as it now is.
 */
export async function removeGroundRecords(
  workspacePath: string,
  on: string,
  references: readonly GroundReference[],
  readings: readonly Reading[],
  malformedGround: readonly string[],
  malformedReadings: readonly string[],
  io: GroundRemovalIo = GROUND_REMOVAL_IO,
): Promise<GroundRemoval> {
  // STORY 16.13 — READ BEFORE ANY UNLINK. The bytes the files hold right now
  // (not the load's copy, which may be older) are what Restore must put back;
  // reading them here, before step 1, is the whole guarantee.
  const referenceIndex = references.findIndex((reference) => reference.on === on);
  const reference = referenceIndex >= 0 ? references[referenceIndex] : null;
  const readingIndex = readings.findIndex((reading) => reading.on === on);
  const reading = readingIndex >= 0 ? readings[readingIndex] : null;
  let readingText: string | null = null;
  let note: string | null = null;
  try {
    readingText = await io.readTextFile(readingTextPath(workspacePath, on));
  } catch {
    readingText = null;
  }
  try {
    note = await io.readTextFile(notePath(workspacePath, on));
  } catch {
    note = null;
  }
  const nextReferences = withGroundRemoved(references, on);
  await io.saveGround(workspacePath, nextReferences, malformedGround);
  const nextReadings = withReadingRemoved(readings, on);
  await io.saveReadings(workspacePath, nextReadings, malformedReadings);
  let refusal: string | null = null;
  try {
    await io.removeFile(readingTextPath(workspacePath, on));
  } catch {
    refusal = GROUND_REMOVAL_REFUSAL;
  }
  return {
    references: nextReferences,
    readings: nextReadings,
    refusal,
    removed:
      reference === null
        ? null
        : {
            reference,
            referenceIndex,
            reading,
            readingIndex: reading === null ? -1 : readingIndex,
            readingText,
            note,
            // The caller adds the links it takes, because its cascade has them.
            links: [],
            // STORY 16.14b: the media line and the picture's bytes are captured
            // by the caller BEFORE this step runs, so they are added there too.
            media: null,
            mediaIndex: -1,
            thumbSvgText: null,
            // The caller records the state it computed at load.
            state: "unread",
          },
  };
}

/**
 * THE DELETE CASCADE's one write (story 16.5): after the reference's own
 * removal, every link that NAMES it — in both directions — leaves
 * `map/ground-links.txt` in the same queued pass. PURE apart from that one
 * bridge: the caller keeps the existing card-delete order and hands the same
 * malformed lines back to the writer unchanged (ADR-0009). No orphan is ever
 * manufactured by the app itself.
 */
export async function removeGroundLinksNaming(
  workspacePath: string,
  on: string,
  links: readonly GroundLink[],
  malformedLinks: readonly string[],
  io: GroundLinkIo = GROUND_LINK_IO,
): Promise<GroundLink[]> {
  const next = withoutGroundLinksFor(links, on);
  await saveGroundLinks(workspacePath, next, malformedLinks, io);
  return next;
}

/** What the delete read from a card's media BEFORE any unlink (story 16.14b). */
export interface GroundMediaCapture {
  /** The line as the file held it; null when the card had no media line. */
  entry: Media | null;
  /** Where that line sat in file order, so Restore can put it back there. */
  index: number;
  /** The thumbnail wrapper's bytes; null when the card had no picture. */
  thumbSvgText: string | null;
}

/**
 * THE DELETE CASCADE's media READ (story 16.14b): the card's media line and the
 * thumbnail file's bytes come into memory BEFORE anything is unlinked. The
 * wrapper is TEXT, so the whole picture is one file the app can already read —
 * no new capability is asked for. A missing line or file is a quiet absence:
 * no error, no sentence, and Restore never invents what was not there.
 */
export async function captureGroundMedia(
  workspacePath: string,
  on: string,
  media: readonly Media[],
  io: MediaIo = MEDIA_IO,
): Promise<GroundMediaCapture> {
  const index = media.findIndex((entry) => entry.on === on);
  const entry = index >= 0 ? media[index] ?? null : null;
  let thumbSvgText: string | null = null;
  if (entry !== null && entry.thumb !== undefined) {
    try {
      thumbSvgText = await io.readTextFile(
        thumbAbsolutePath(workspacePath, entry.thumb),
      );
    } catch {
      thumbSvgText = null;
    }
  }
  return { entry, index, thumbSvgText };
}

/** What taking a card's media left: the next lines and its one sentence. */
export interface GroundMediaRemoval {
  media: Media[];
  /** One sentence when the picture could not be removed; null when it went. */
  refusal: string | null;
}

/** The one sentence a refused thumbnail unlink answers (PROVISIONAL wording). */
export const GROUND_MEDIA_REMOVAL_REFUSAL =
  "the card and its reading were removed, but its image could not be removed.";

/**
 * THE DELETE CASCADE's media step (story 16.14): a card's media line and its
 * local thumbnail go with the card's other files, AFTER `captureGroundMedia`
 * has read them. A missing line or file is a quiet no-op, and a refused write
 * is one sentence, never a repair. What the capture remembered is what Restore
 * writes back, verbatim (story 16.14b).
 */
export async function removeGroundMedia(
  workspacePath: string,
  on: string,
  media: readonly Media[],
  malformedMedia: readonly string[],
  io: MediaIo = MEDIA_IO,
): Promise<GroundMediaRemoval> {
  const entry = mediaFor(media, on);
  const next = withoutMedia(media, on);
  let refusal: string | null = null;
  try {
    await saveMedia(workspacePath, next, malformedMedia, io);
  } catch {
    // The card is already gone; one sentence and no repair, like the note's
    // own refused unlink. The media line may be orphaned; nothing pretends
    // otherwise.
    return { media: [...media], refusal: GROUND_MEDIA_REMOVAL_REFUSAL };
  }
  if (entry !== null && entry.thumb !== undefined) {
    try {
      await io.removeFile(thumbAbsolutePath(workspacePath, entry.thumb));
    } catch {
      refusal = GROUND_MEDIA_REMOVAL_REFUSAL;
    }
  }
  return { media: next, refusal };
}

/** The one sentence a refused note unlink answers (PROVISIONAL wording). */
export const GROUND_NOTE_REMOVAL_REFUSAL =
  "the card and its reading were removed, but its note file could not be removed.";

/**
 * THE DELETE CASCADE's note step (story 16.6): after the reference's own
 * removal (and its reading's text file), its note file leaves in the same
 * queued pass. A missing note is a quiet no-op; a refused unlink answers one
 * sentence and repairs nothing — the card is already gone, exactly like the
 * reading text's refusal. Never a second write path, never a whole-folder
 * rewrite. PURE apart from that one bridge.
 */
export async function removeGroundNote(
  workspacePath: string,
  on: string,
  io: NoteIo = NOTE_IO,
): Promise<string | null> {
  try {
    await removeNote(workspacePath, on, io);
    return null;
  } catch {
    return GROUND_NOTE_REMOVAL_REFUSAL;
  }
}

/**
 * STORY 16.13 (shortlist item 1) — THE TOAST'S WINDOW, provisional. It is the
 * stated span after which the deletion stops being restorable; there is no
 * countdown, no progress bar and no ticker, and one toast is all there is.
 */
export const RESTORE_WINDOW_MS = 10_000;

/** One pending restore can exist; a second delete COMMITS the first. */
export function pendingRestoreAfter(
  previous: RemovedCard | null,
  next: RemovedCard | null,
): RemovedCard | null {
  // The newest deletion is the only one the toast can put back. Keeping the
  // older one too would be an undo stack, which the story deliberately leaves
  // out (the shortlist's item 1 is a toast, not a history UI).
  return next ?? previous;
}

/** The bridges a restore needs; a test passes its own fakes. */
export interface GroundRestoreIo {
  saveGround: typeof saveGround;
  saveReadings: typeof saveReadings;
  saveGroundLinks: typeof saveGroundLinks;
  saveMedia: typeof saveMedia;
  restoreReadingText: typeof restoreReadingText;
  restoreNote: typeof restoreNote;
  restoreThumb: typeof restoreThumb;
}

/** The real bridges, bound once so this module stays importable in tests. */
const GROUND_RESTORE_IO: GroundRestoreIo = {
  saveGround,
  saveReadings,
  saveGroundLinks,
  saveMedia,
  restoreReadingText,
  restoreNote,
  restoreThumb,
};

/** What a restore did: the next records, what came back, what did not. */
export interface GroundRestoreResult {
  references: GroundReference[];
  readings: Reading[];
  links: GroundLink[];
  /** STORY 16.14b: the media lines after the write (the card's line is back). */
  media: Media[];
  /** True when the card's own ground line went back (the card is on the map). */
  restoredReference: boolean;
  /** The links whose lines went back (the hook logs their own moves). */
  restoredLinks: readonly GroundLink[];
  /** One sentence when a write failed; null when everything came back. */
  refusal: string | null;
  cameBack: readonly string[];
  didNot: readonly string[];
}

/** Put one item back at its old file position (clamped, never out of range). */
function insertAt<T>(items: readonly T[], index: number, item: T): T[] {
  const at = index < 0 || index > items.length ? items.length : index;
  return [...items.slice(0, at), item, ...items.slice(at)];
}

/** Join labels the way a sentence does: "a, b and c". */
function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
}

/**
 * ONE sentence for a PARTIAL restore (story 16.13): what came back and what did
 * not. PURE, so the wording is not the handler's only truth. PROVISIONAL.
 */
export function restoreSentence(
  cameBack: readonly string[],
  didNot: readonly string[],
): string | null {
  if (didNot.length === 0) return null;
  const missing = joinLabels(didNot);
  if (cameBack.length === 0) {
    return missing.charAt(0).toUpperCase() + missing.slice(1) + " did not come back.";
  }
  const back = joinLabels(cameBack);
  return (
    back.charAt(0).toUpperCase() +
    back.slice(1) +
    " came back, but " +
    missing +
    " did not."
  );
}

/**
 * STORY 16.13 — PUT THE SAME BYTES BACK. STORY 16.14b adds the picture and the
 * media line to that promise, in the house order:
 *
 *   1. the thumbnail (exactly the wrapper's bytes read before its unlink);
 *   2. the reading text (exactly the bytes read before the unlink);
 *   3. the reading line, at its old file position;
 *   4. the media line, at its old file position;
 *   5. the note (exactly the bytes read before its unlink);
 *   6. the reference line, so a crash can never leave a reference whose
 *      reading or title is not there;
 *   7. every link the cascade took, at its old file position.
 *
 * Every write is attempted even after an earlier one fails, so the one
 * sentence can name BOTH what came back and what did not. A card whose
 * thumbnail was already missing restores no picture and says nothing — nothing
 * is invented. The caller owns the queue and the in-memory views; this
 * function writes the files and reports.
 */
export async function restoreGroundCard(
  workspacePath: string,
  removed: RemovedCard,
  references: readonly GroundReference[],
  readings: readonly Reading[],
  links: readonly GroundLink[],
  media: readonly Media[],
  malformedGround: readonly string[],
  malformedReadings: readonly string[],
  malformedLinks: readonly string[],
  malformedMedia: readonly string[],
  io: GroundRestoreIo = GROUND_RESTORE_IO,
): Promise<GroundRestoreResult> {
  const slug = removed.reference.on;
  const cameBack: string[] = [];
  const didNot: string[] = [];
  let nextReferences = [...references];
  let nextReadings = [...readings];
  let nextLinks = [...links];
  let nextMedia = [...media];
  let restoredReference = false;
  const restoredLinks: GroundLink[] = [];
  const entry = removed.media;

  // 1. the picture, byte for byte (story 16.14b): the wrapper goes back at the
  //    path its line names. A thumbnail the delete could not read (already
  //    gone) is simply absent — a missing picture is not an error and Restore
  //    never invents one.
  if (
    entry !== null &&
    entry.thumb !== undefined &&
    removed.thumbSvgText !== null
  ) {
    try {
      await io.restoreThumb(workspacePath, entry.thumb, removed.thumbSvgText);
      cameBack.push("the picture");
    } catch {
      didNot.push("the picture");
    }
  }
  // 2. the reading text, byte for byte.
  if (removed.reading !== null && removed.readingText !== null) {
    try {
      await io.restoreReadingText(workspacePath, slug, removed.readingText);
      cameBack.push("the reading text");
    } catch {
      didNot.push("the reading text");
    }
  }
  // 3. the reading line, back where it sat.
  if (removed.reading !== null) {
    const without = nextReadings.filter((reading) => reading.on !== slug);
    const candidate = insertAt(without, removed.readingIndex, removed.reading);
    try {
      await io.saveReadings(workspacePath, candidate, malformedReadings);
      nextReadings = candidate;
      cameBack.push("the reading");
    } catch {
      didNot.push("the reading");
    }
  }
  // 4. the media line, back where it sat (story 16.14b): the SAME record, so
  //    the same bytes. A line the refused delete could not take is replaced,
  //    never doubled.
  if (entry !== null) {
    const without = nextMedia.filter((line) => line.on !== slug);
    const candidate = insertAt(without, removed.mediaIndex, entry);
    try {
      await io.saveMedia(workspacePath, candidate, malformedMedia);
      nextMedia = candidate;
      cameBack.push("the media line");
    } catch {
      didNot.push("the media line");
    }
  }
  // 5. the note, byte for byte.
  if (removed.note !== null) {
    try {
      await io.restoreNote(workspacePath, slug, removed.note);
      cameBack.push("the note");
    } catch {
      didNot.push("the note");
    }
  }
  // 6. the reference: the card returns once its pieces are there.
  {
    const without = nextReferences.filter((reference) => reference.on !== slug);
    const candidate = insertAt(without, removed.referenceIndex, removed.reference);
    try {
      await io.saveGround(workspacePath, candidate, malformedGround);
      nextReferences = candidate;
      restoredReference = true;
      cameBack.push("the reference");
    } catch {
      didNot.push("the reference");
    }
  }
  // 7. every link the cascade took, back where each line sat.
  if (removed.links.length > 0) {
    const candidate = [...nextLinks];
    for (const link of [...removed.links].sort((a, b) => a.index - b.index)) {
      const pair = link.link;
      const already = candidate.some(
        (existing) => existing.from === pair.from && existing.to === pair.to,
      );
      if (!already) {
        candidate.splice(Math.min(link.index, candidate.length), 0, pair);
      }
    }
    try {
      await io.saveGroundLinks(workspacePath, candidate, malformedLinks);
      nextLinks = candidate;
      restoredLinks.push(...removed.links.map((link) => link.link));
      cameBack.push("the links");
    } catch {
      didNot.push("the links");
    }
  }

  return {
    references: nextReferences,
    readings: nextReadings,
    links: nextLinks,
    media: nextMedia,
    restoredReference,
    restoredLinks,
    refusal: restoreSentence(cameBack, didNot),
    cameBack,
    didNot,
  };
}

/** The bridges a selection's creation needs; a test passes its own fakes. */
export interface SelectionIo {
  storeSelectionText: typeof storeSelectionText;
  saveReadings: typeof saveReadings;
  saveGround: typeof saveGround;
}

/** The real bridges, bound once so the hook's path is the tested one. */
const SELECTION_IO: SelectionIo = {
  storeSelectionText,
  saveReadings,
  saveGround,
};

/** What making a selection card produced: the next records and the new line. */
export interface SelectionRecords {
  references: GroundReference[];
  readings: Reading[];
  reading: Reading;
}

/**
 * STORY 16.12 — MAKE A CARD OUT OF A SELECTION, in the house order:
 *
 *   1. the excerpt's text file FIRST (`map/readings/<new-slug>.md`, verbatim);
 *   2. the readings line NEXT (so a crash leaves an orphan text, never a line
 *      whose text is absent);
 *   3. the ground line LAST — the same order every add uses, with the reading's
 *      own two pieces text-first.
 *
 * NOTHING IS READ: no head, no extractor, no stat. The bytes are the person's
 * selection exactly as taken, and the reading's provenance is the SOURCE CARD's
 * slug — never a path. The slug dedupes against the map's references like every
 * other coined name (ADR-0005 rule 4). PURE apart from the bridges it is handed.
 */
export async function writeSelectionCard(
  workspacePath: string,
  references: readonly GroundReference[],
  readings: readonly Reading[],
  malformedGround: readonly string[],
  malformedReadings: readonly string[],
  sourceSlug: string,
  name: string,
  x: number,
  y: number,
  text: string,
  taken: string,
  io: SelectionIo = SELECTION_IO,
  /** STORY 17.1: the SHARED slug set (ground + asks); default references only. */
  options: { taken?: ReadonlySet<string> } = {},
): Promise<SelectionRecords> {
  const addition = addGroundReference(
    references,
    name.trim(),
    x,
    y,
    options.taken,
  );
  const reading = selectionReading(addition.reference.on, sourceSlug, taken);
  await io.storeSelectionText(workspacePath, reading.on, text);
  const nextReadings = withReading(readings, reading);
  await io.saveReadings(workspacePath, nextReadings, malformedReadings);
  await io.saveGround(workspacePath, addition.references, malformedGround);
  return {
    references: addition.references,
    readings: nextReadings,
    reading,
  };
}

/* ------------------------------------------------------------------------- *
 * STORY 17.1 — THE ASK CARD'S RECORD: one `map/asks.txt` line, and one
 * append-only conversation write.
 *
 * The creation is the ground add's shape with the anchor in place of a reading:
 * ONE queued write of the ask line, and NOTHING else — no reading text, no
 * note, no media, no link and no touch of the reference card. The shared slug
 * space (both files) mints the slug, so a link, a mention or an anchor can
 * always resolve to exactly one card.
 *
 * The turn is the existing card-ask path's: the app sends the packet anchored
 * on the reference, and only what CAME BACK is written here. The person's line
 * is always appended; the answer line only when the turn actually answered. A
 * failed or stopped turn therefore leaves the person's line alone and hands
 * back the ONE sentence the card shows. A partial is never an answer (story
 * 17.4 owns PRISM and that rule's record).
 * ------------------------------------------------------------------------- */

/** The bridges an ask card's creation needs; a test passes its own fakes. */
export interface AskCardIo {
  saveAsks: typeof saveAsks;
}

/** The real bridges, bound once so the hook's path is the tested one. */
const ASK_CARD_IO: AskCardIo = { saveAsks };

/** What making an ask card produced: the next lines and the new card. */
export interface AskCardRecords {
  asks: AskCard[];
  ask: AskCard;
}

/**
 * STORY 17.1 — WRITE ONE ASK CARD, in the house order: the ask line only, and
 * the slug minted against BOTH slugs files (the ground references and the asks
 * already on the map). A blank name is the caller's refusal (it never reaches
 * here), and the source card is only NAMED by the anchor field — nothing about
 * it is read, rewritten or repaired. PURE apart from the bridge it is handed.
 */
export async function writeAskCard(
  workspacePath: string,
  references: readonly GroundReference[],
  asks: readonly AskCard[],
  malformedAsks: readonly string[],
  sourceSlug: string,
  name: string,
  x: number,
  y: number,
  io: AskCardIo = ASK_CARD_IO,
): Promise<AskCardRecords> {
  const addition = addAsk(
    asks,
    sharedSlugs(references, asks),
    name.trim(),
    x,
    y,
    sourceSlug,
  );
  await io.saveAsks(workspacePath, addition.asks, malformedAsks);
  return { asks: addition.asks, ask: addition.ask };
}

/** The bridges an ask turn's record write needs; a test passes its own fakes. */
export interface AskTurnIo {
  appendExchange: typeof appendExchange;
}

/** The real bridges, bound once so the hook's path is the tested one. */
const ASK_TURN_IO: AskTurnIo = { appendExchange };

/**
 * What one ask turn settled as: the answer's words, or the one sentence the
 * card shows instead. A stopped, timed-out or broken turn is a `failed` — it
 * writes no answer line, even when the person saw words stream.
 */
export type AskSendResult =
  | { kind: "answer"; text: string; readback?: AskPacketReadback }
  | { kind: "failed"; sentence: string; readback?: AskPacketReadback };

/**
 * Map one turn's result to what the ask card writes and says (PURE). The
 * readback is the SURFACE's fact (which bytes left), never a record field, so
 * it rides only when the caller has one: a turn that never left hands over
 * nothing rather than pretending bytes did.
 */
export function askSendResult(
  result: TurnResult,
  readback?: AskPacketReadback,
): AskSendResult {
  const base: AskSendResult =
    result.kind === "answer"
      ? { kind: "answer", text: result.text }
      : { kind: "failed", sentence: turnSentence(result) };
  return readback === undefined ? base : { ...base, readback };
}

/** What recording one ask turn did: the whole conversation and its sentence. */
export interface AskTurnRecords {
  /** Every turn the file now holds, in order (the new exchange appended). */
  turns: readonly AskTurn[];
  /** The one sentence when the turn did not answer; null when it did. */
  sentence: string | null;
}

/**
 * STORY 17.1 — RECORD ONE ASK TURN, APPEND-ONLY: the person's question line
 * always, the answer line only when `sent` is an answer. Nothing earlier is
 * rewritten (the file's bytes stay a prefix), the words are verbatim, and a
 * failed turn hands back the one sentence in place of an answer. The caller
 * queues this, so a conversation line can never land under a stale file.
 */
export async function recordAskTurn(
  workspacePath: string,
  slug: string,
  question: string,
  sent: AskSendResult,
  io: AskTurnIo = ASK_TURN_IO,
): Promise<AskTurnRecords> {
  const answer = sent.kind === "answer" ? sent.text : null;
  const turns = await io.appendExchange(workspacePath, slug, question, answer);
  return {
    turns,
    sentence: sent.kind === "answer" ? null : sent.sentence,
  };
}

/** The bridges a page card's creation needs; a test passes its own fakes. */
export interface PageIo {
  storeReadingText: typeof storeReadingText;
  saveReadings: typeof saveReadings;
  saveMedia: typeof saveMedia;
  storeThumb: typeof storeThumb;
  saveGround: typeof saveGround;
}

/** The real bridges, bound once so the hook's path is the tested one. */
const PAGE_IO: PageIo = {
  storeReadingText,
  saveReadings,
  saveMedia,
  storeThumb,
  saveGround,
};

/** What the sidecar read: the page's title, its text and its image (or none). */
export interface PagePayload {
  title: string;
  text: string;
  thumb: PageImage | null;
}

/** What making a page card produced: the next records and the pieces. */
export interface PageRecords {
  references: GroundReference[];
  readings: Reading[];
  media: Media[];
  reading: Reading;
  entry: Media;
  text: string;
  /** The card's image source, or null when the page had no usable image. */
  thumbSrc: string | null;
}

/** The two things a page add refuses before anything is fetched (PROVISIONAL). */
export const PAGE_NAME_REFUSAL = "name it first.";
export const PAGE_URL_REFUSAL = "paste a web page's address first.";

/**
 * The page add's ONE refusal rule, PURE: the person's word is the name, and an
 * empty address has nothing to fetch. Both run BEFORE the queue, so a refusal
 * never reaches the network or a file.
 */
export function pageRefusal(name: string, url: string): string | null {
  if (name.trim() === "") return PAGE_NAME_REFUSAL;
  if (url.trim() === "") return PAGE_URL_REFUSAL;
  return null;
}

/**
 * STORY 16.14 — CREATE A PAGE CARD, in the house order:
 *
 *   1. the extracted text FIRST (`map/readings/<new-slug>.md`, already capped);
 *   2. the readings line NEXT (`form: url`, `extract: page`, the URL verbatim);
 *   3. the thumbnail's local file (when the page had an image);
 *   4. the media line (`map/media.jsonl`) — the record naming the title and the
 *      LOCAL thumb path, never a remote URL;
 *   5. the ground line LAST, so a crash can leave orphan pieces but never a
 *      card whose reading is absent.
 *
 * NOTHING IS FETCHED HERE: the sidecar read the page first, and a refusal
 * returns before this function is called — so a failed fetch writes nothing at
 * all. The image is best-effort: a thumbnail that cannot be written is simply
 * no picture (the card says nothing about it), never a failed add.
 * PURE apart from the bridges it is handed.
 */
export async function writePageCard(
  workspacePath: string,
  references: readonly GroundReference[],
  readings: readonly Reading[],
  media: readonly Media[],
  malformedGround: readonly string[],
  malformedReadings: readonly string[],
  malformedMedia: readonly string[],
  name: string,
  x: number,
  y: number,
  url: string,
  page: PagePayload,
  taken: string,
  io: PageIo = PAGE_IO,
  /** STORY 17.1: the SHARED slug set (ground + asks); default references only. */
  options: { taken?: ReadonlySet<string> } = {},
): Promise<PageRecords> {
  const addition = addGroundReference(
    references,
    name.trim(),
    x,
    y,
    options.taken,
  );
  const reading = pageReading(addition.reference.on, url, taken);
  const text = cappedReadingText(page.text);
  await io.storeReadingText(workspacePath, reading.on, text);
  const nextReadings = withReading(readings, reading);
  await io.saveReadings(workspacePath, nextReadings, malformedReadings);

  let entry: Media = {
    on: reading.on,
    kind: "page",
    title: page.title,
    fetched: taken,
  };
  let thumbSrc: string | null = null;
  if (page.thumb !== null) {
    try {
      const thumb = await io.storeThumb(
        workspacePath,
        reading.on,
        page.thumb.mime,
        page.thumb.base64,
      );
      entry = { ...entry, thumb };
      thumbSrc = thumbSrcOf(thumbSvg(page.thumb.mime, page.thumb.base64));
    } catch {
      // No picture is not an error: the card is still made, the media line
      // simply carries no thumb, and the face draws no image line.
    }
  }
  const nextMedia = withMedia(media, entry);
  await io.saveMedia(workspacePath, nextMedia, malformedMedia);

  await io.saveGround(workspacePath, addition.references, malformedGround);
  return {
    references: addition.references,
    readings: nextReadings,
    media: nextMedia,
    reading,
    entry,
    text,
    thumbSrc,
  };
}

/** What one fetched page add settled as: the written records, or a sentence. */
export type PageCreate =
  | { kind: "written"; records: PageRecords }
  | { kind: "refused"; message: string };

/**
 * STORY 16.14 — THE ONE PAGE ADD, as a value-returning step: the refusal rule
 * runs first, a REFUSED fetch returns BEFORE any writer, and only a successful
 * read reaches `writePageCard`. So "a failed fetch writes NOTHING" is this
 * function's shape, not a caller's memory. PURE apart from the bridges.
 */
export async function createFetchedPage(
  workspacePath: string,
  references: readonly GroundReference[],
  readings: readonly Reading[],
  media: readonly Media[],
  malformedGround: readonly string[],
  malformedReadings: readonly string[],
  malformedMedia: readonly string[],
  name: string,
  x: number,
  y: number,
  url: string,
  read: PageFetchAnswer,
  taken: string,
  io: PageIo = PAGE_IO,
  options: { taken?: ReadonlySet<string> } = {},
): Promise<PageCreate> {
  const refusal = pageRefusal(name, url);
  if (refusal !== null) return { kind: "refused", message: refusal };
  if (read.kind === "refused") {
    // NOTHING is written: no text, no reading line, no media line, no ground
    // line, no thumbnail. The bubble shows the one sentence.
    return { kind: "refused", message: read.sentence };
  }
  const records = await writePageCard(
    workspacePath,
    references,
    readings,
    media,
    malformedGround,
    malformedReadings,
    malformedMedia,
    name,
    x,
    y,
    url,
    { title: read.title, text: read.text, thumb: read.thumb },
    taken,
    io,
    options,
  );
  return { kind: "written", records };
}

/* ------------------------------------------------------------------------- *
 * STORY 16.15 — A VIDEO'S CARD HAS NO READING, ONLY A LOOK.
 *
 * The sidecar reads the address once through oEmbed and answers the TITLE and
 * a thumbnail ADDRESS; the window copies the picture beside the map with the
 * SAME `thumb` wire and SVG wrapper a page's uses, then writes the media line
 * (kind `video`), the reading line (`form: url`, `extract: video`) and the
 * ground line. No transcript, no player, no remote image at render time.
 *
 * THE WRITE ORDER is the artifact's: the thumbnail file, then its media line,
 * then the reading line, then the ground line LAST — a crash can leave an
 * orphan picture but never a card whose title and picture are absent while it
 * claims they are there.
 * ------------------------------------------------------------------------- */

/** The bridges a video card's creation needs; a test passes its own fakes. */
export interface VideoIo {
  saveReadings: typeof saveReadings;
  saveMedia: typeof saveMedia;
  storeThumb: typeof storeThumb;
  saveGround: typeof saveGround;
}

/** The real bridges, bound once so the hook's path is the tested one. */
const VIDEO_IO: VideoIo = {
  saveReadings,
  saveMedia,
  storeThumb,
  saveGround,
};

/** What the sidecar read for a video: the title and its picture (or none). */
export interface VideoPayload {
  title: string;
  thumb: PageImage | null;
}

/** What making a video card produced: the next records and the pieces. */
export interface VideoRecords {
  references: GroundReference[];
  readings: Reading[];
  media: Media[];
  reading: Reading;
  entry: Media;
  /** The card's image source, or null when the video had no usable image. */
  thumbSrc: string | null;
}

/** The two things a video add refuses before anything is fetched (PROVISIONAL). */
export const VIDEO_NAME_REFUSAL = "name it first.";
export const VIDEO_URL_REFUSAL = "paste a video's address first.";

/**
 * The video add's ONE refusal rule, PURE: the person's word is the name, and
 * an empty address has nothing to ask. Both run BEFORE the queue, so a refusal
 * never reaches the network or a file.
 */
export function videoRefusal(name: string, url: string): string | null {
  if (name.trim() === "") return VIDEO_NAME_REFUSAL;
  if (url.trim() === "") return VIDEO_URL_REFUSAL;
  return null;
}

/**
 * STORY 16.15 — WRITE A VIDEO'S RECORDS, in the artifact's order (see the
 * section comment): the thumbnail file, its media line, the reading line, the
 * ground line last. PURE apart from the bridges it is handed.
 */
export async function writeVideoCard(
  workspacePath: string,
  references: readonly GroundReference[],
  readings: readonly Reading[],
  media: readonly Media[],
  malformedGround: readonly string[],
  malformedReadings: readonly string[],
  malformedMedia: readonly string[],
  name: string,
  x: number,
  y: number,
  url: string,
  video: VideoPayload,
  taken: string,
  io: VideoIo = VIDEO_IO,
  /** STORY 17.1: the SHARED slug set (ground + asks); default references only. */
  options: { taken?: ReadonlySet<string> } = {},
): Promise<VideoRecords> {
  const addition = addGroundReference(
    references,
    name.trim(),
    x,
    y,
    options.taken,
  );
  const reading = videoReading(addition.reference.on, url, taken);
  let entry: Media = {
    on: reading.on,
    kind: "video",
    title: video.title,
    fetched: taken,
  };
  let thumbSrc: string | null = null;
  if (video.thumb !== null) {
    try {
      const thumb = await io.storeThumb(
        workspacePath,
        reading.on,
        video.thumb.mime,
        video.thumb.base64,
      );
      entry = { ...entry, thumb };
      thumbSrc = thumbSrcOf(thumbSvg(video.thumb.mime, video.thumb.base64));
    } catch {
      // No picture is not an error: the card is still made and says nothing
      // about the image it does not have.
    }
  }
  const nextMedia = withMedia(media, entry);
  await io.saveMedia(workspacePath, nextMedia, malformedMedia);
  const nextReadings = withReading(readings, reading);
  await io.saveReadings(workspacePath, nextReadings, malformedReadings);
  await io.saveGround(workspacePath, addition.references, malformedGround);
  return {
    references: addition.references,
    readings: nextReadings,
    media: nextMedia,
    reading,
    entry,
    thumbSrc,
  };
}

/** What one fetched video add settled as: the written records, or a sentence. */
export type VideoCreate =
  | { kind: "written"; records: VideoRecords }
  | { kind: "refused"; message: string };

/**
 * STORY 16.15 — THE ONE VIDEO ADD, as a value-returning step: the refusal rule
 * runs first, a REFUSED read returns BEFORE any writer, and only a successful
 * look reaches `writeVideoCard`. So "a failed read writes NOTHING" is this
 * function's shape, not a caller's memory. PURE apart from the bridges.
 */
export async function createFetchedVideo(
  workspacePath: string,
  references: readonly GroundReference[],
  readings: readonly Reading[],
  media: readonly Media[],
  malformedGround: readonly string[],
  malformedReadings: readonly string[],
  malformedMedia: readonly string[],
  name: string,
  x: number,
  y: number,
  url: string,
  read: VideoFetchAnswer,
  taken: string,
  io: VideoIo = VIDEO_IO,
  options: { taken?: ReadonlySet<string> } = {},
): Promise<VideoCreate> {
  const refusal = videoRefusal(name, url);
  if (refusal !== null) return { kind: "refused", message: refusal };
  if (read.kind === "refused") {
    // NOTHING is written: no picture, no media line, no reading line, no
    // ground line. The bubble shows the one sentence.
    return { kind: "refused", message: read.sentence };
  }
  const records = await writeVideoCard(
    workspacePath,
    references,
    readings,
    media,
    malformedGround,
    malformedReadings,
    malformedMedia,
    name,
    x,
    y,
    url,
    { title: read.title, thumb: read.thumb },
    taken,
    io,
    options,
  );
  return { kind: "written", records };
}

/**
 * The states of every reference, from the readings and their metadata (story
 * 16.2). Pure apart from the answers it is handed: one reading per slug, its
 * metadata (or null when there is no reading), and the load's clock.
 */
function statesOf(
  references: readonly GroundReference[],
  readings: readonly Reading[],
  metas: ReadonlyMap<string, FileMetaAnswer>,
  now: number,
  mediaOn: ReadonlySet<string> = new Set(),
): Record<string, ReadingState> {
  const states: Record<string, ReadingState> = {};
  for (const reference of references) {
    states[reference.on] = resolveReadingState(
      readingFor(readings, reference.on),
      metas.get(reference.on) ?? null,
      now,
      // STORY 16.15: a video's artifact IS its media line (title + thumbnail);
      // without it there is nothing to show and the state says so.
      mediaOn.has(reference.on),
    );
  }
  return states;
}

/**
 * Stat every reading's file once, in parallel, keyed by slug. STORY 16.12: a
 * SELECTION has no source file, so it is not stat'ed at all and has no entry —
 * its state is `current` by construction (the short-circuit in
 * `resolveReadingState`), never a metadata answer that could go stale.
 * The stat is injectable so a test can prove the skip without a disk.
 */
export async function metasOf(
  workspacePath: string,
  readings: readonly Reading[],
  fileMeta: (path: string) => Promise<FileMetaAnswer> = fsFileMeta,
): Promise<Map<string, FileMetaAnswer>> {
  const metas = new Map<string, FileMetaAnswer>();
  await Promise.all(
    readings.map(async (reading) => {
      // No source file, no stat: a selection and a page can never be stale.
      if (!isFileReading(reading)) return;
      metas.set(
        reading.on,
        await fileMeta(readingAbsolutePath(workspacePath, reading)),
      );
    }),
  );
  return metas;
}

export function useGround(workspacePath: string, turn?: TurnPort): GroundView {
  const [state, setState] = useState<GroundLoaded>(EMPTY);
  // Synchronous mirrors: the queued write must never read a stale list.
  const referencesRef = useRef<GroundReference[]>([]);
  // STORY 17.1: the ask cards' lines and their conversations. Both are loaded
  // with the map folder and moved only by the person's own create/turn.
  const asksRef = useRef<AskCard[]>([]);
  const askTurnsRef = useRef<Record<string, readonly AskTurn[]>>({});
  const malformedAsksRef = useRef<string[]>([]);
  const readingsRef = useRef<Reading[]>([]);
  // Story 16.14: the media lines and their READ thumbnail sources. Both are
  // view mirrors of the map folder — the thumb's bytes live in map/media/.
  const mediaRef = useRef<Media[]>([]);
  const malformedMediaRef = useRef<string[]>([]);
  const thumbsRef = useRef<Record<string, string>>({});
  const malformedGroundRef = useRef<string[]>([]);
  const malformedReadingsRef = useRef<string[]>([]);
  const textsRef = useRef<Record<string, string>>({});
  const statesRef = useRef<Record<string, ReadingState>>({});
  // Story 16.6: the person's notes and the reportable orphans. Both are the
  // load's read of `map/notes/`; a note never rides the reading's refs.
  const notesRef = useRef<Record<string, string>>({});
  const orphanNotesRef = useRef<string[]>([]);
  // Story 16.8: the person's pulls. VIEW STATE beside the open card, never a
  // record and never part of a write; a workspace change forgets every pull.
  const pulledRef = useRef<Record<string, PulledText>>({});
  // The ground map's wordless wiring (story 16.5): the whole truth is its one
  // file, so the sync mirror holds exactly what the load read.
  const linksRef = useRef<GroundLink[]>([]);
  const malformedLinksRef = useRef<string[]>([]);
  // Story 16.9: the mirror's one failure sentence. A notice, not a record —
  // and it never gates the move that queued the mirror.
  const mirrorNoticeRef = useRef<string | null>(null);
  // Story 16.10: the history's one failure sentence, and the raw lines the
  // loader kept but could not read. Neither is a record: the file holds those.
  const historyNoticeRef = useRef<string | null>(null);
  const malformedHistoryRef = useRef<string[]>([]);
  // STORY 16.13: the ONE pending restore and the one sentence a partial
  // restore answers. Both are VIEW state — the removed bytes are held here, in
  // memory, and written nowhere until Restore puts them back.
  const restorableRef = useRef<RemovedCard | null>(null);
  const restoreNoticeRef = useRef<string | null>(null);
  // One queue for the ground family's files: an add's ground line must land
  // after its own readings line, never under a stale one; the link and the
  // cascade share it so no link write can land under a stale list.
  const queueRef = useRef(createWriteQueue());

  const reload = useCallback(async () => {
    if (workspacePath === "") return;
    const [ground, asks, readings, groundLinks, history, loadedMedia] =
      await Promise.all([
        loadGround(workspacePath),
        // STORY 17.1: the ask cards' lines are read with the workspace, like
        // every other record family. Their conversations are read below, one
        // per card, once — nothing watches or re-reads.
        loadAsks(workspacePath),
        loadReadings(workspacePath),
        loadGroundLinks(workspacePath),
        // Story 16.10: a READ only — opening is a look, so a missing history is
        // not created here, and its malformed lines are reported, not repaired.
        readHistory(workspacePath),
        // Story 16.14: the media lines and the thumbnails they name are read
        // ONCE, offline; there is no fetch and no watcher at open.
        loadMedia(workspacePath),
      ]);
    const slugs = ground.references.map((reference) => reference.on);
    const askSlugs = asks.asks.map((ask) => ask.on);
    const [texts, metas, loadedNotes, thumbs, loadedAskTurns] =
      await Promise.all([
        loadReadingTexts(workspacePath, slugs),
        metasOf(workspacePath, readings.readings),
        // Story 16.6: ONE folder listing, then one read per card that has a
        // note. Orphans are computed from the same listing and never read.
        loadNotes(workspacePath, slugs),
        // Story 16.14: each media line's local thumbnail, read once and turned
        // into a data URL. A missing image is absent from the map, never an
        // error; this is why reopening works with the network unplugged.
        loadThumbSrcs(workspacePath, loadedMedia.media),
        // STORY 17.1: one read per ask card's conversation. An absent file is
        // an empty conversation, never an invented one.
        loadAskTurns(workspacePath, askSlugs),
      ]);
    const states = statesOf(
      ground.references,
      readings.readings,
      metas,
      Date.now(),
      // STORY 16.15: the video card's artifact is the media line's title and
      // picture, so the load tells the state rule which slugs have one.
      new Set(loadedMedia.media.map((entry) => entry.on)),
    );
    // Orphans are COMPUTED, never stored (story 16.5, in `snapshot`): a link
    // naming a slug the map does not carry is kept in the file and named in
    // the notices group.
    referencesRef.current = ground.references;
    asksRef.current = asks.asks;
    malformedAsksRef.current = asks.malformed;
    const askTurns: Record<string, readonly AskTurn[]> = {};
    for (const slug of askSlugs) {
      askTurns[slug] = loadedAskTurns[slug]?.turns ?? [];
    }
    askTurnsRef.current = askTurns;
    readingsRef.current = readings.readings;
    mediaRef.current = loadedMedia.media;
    malformedMediaRef.current = loadedMedia.malformed;
    thumbsRef.current = thumbs;
    malformedGroundRef.current = ground.malformed;
    malformedReadingsRef.current = readings.malformed;
    malformedLinksRef.current = groundLinks.malformed;
    malformedHistoryRef.current = history.malformed;
    linksRef.current = groundLinks.links;
    textsRef.current = texts;
    statesRef.current = states;
    notesRef.current = loadedNotes.notes;
    orphanNotesRef.current = loadedNotes.orphans;
    setState(snapshot());
  }, [workspacePath]);

  /**
   * The view from the synchronous mirrors, AFTER a write has moved them: the
   * one place each callback hands React its next render, so a new field can
   * never be forgotten by one of the five write paths.
   */
  const snapshot = (): GroundLoaded => ({
    references: referencesRef.current,
    asks: asksRef.current,
    askTurns: askTurnsRef.current,
    malformedAsks: malformedAsksRef.current,
    readings: readingsRef.current,
    media: mediaRef.current,
    thumbs: thumbsRef.current,
    texts: textsRef.current,
    states: statesRef.current,
    // Story 16.8: the pulled text is a LOOK, held until it is dismissed or the
    // card closes. It rides this snapshot like the open card rides the layer:
    // view state, never a record.
    pulled: pulledRef.current,
    notes: notesRef.current,
    // ORPHAN NOTES ARE COMPUTED from the load's listing, never stored: a note
    // file the app itself never writes for a missing card (story 16.6).
    orphanNotes: orphanNotesRef.current,
    // STORY 16.14b — ORPHAN MEDIA ARE COMPUTED like the links' and the notes':
    // a media line whose card is not on the map is kept in the file, reported
    // in the notices group and the mirror's unknowns, and never adopted or
    // deleted by the app.
    orphanMedia: orphanMedia(
      mediaRef.current,
      referencesRef.current.map((reference) => reference.on),
    ),
    links: linksRef.current,
    // Recomputed on every write (story 16.5): a cascade can leave the file
    // with fewer links but never with one the app itself orphaned.
    orphanLinks: orphanGroundLinks(
      linksRef.current,
      referencesRef.current.map((reference) => reference.on),
    ),
    malformedGround: malformedGroundRef.current,
    malformedReadings: malformedReadingsRef.current,
    malformedLinks: malformedLinksRef.current,
    mirrorNotice: mirrorNoticeRef.current,
    // Story 16.10: the history's failure sentence and the kept raw lines.
    historyNotice: historyNoticeRef.current,
    malformedHistory: malformedHistoryRef.current,
    // STORY 16.13: the toast's one pending restore, held in memory until the
    // window ends, its × is pressed, or a second delete commits it.
    restorable: restorableRef.current,
    restoreNotice: restoreNoticeRef.current,
    loaded: true,
  });

  /**
   * THE MIRROR'S VIEW (story 16.9): the same computed view the layer renders,
   * narrowed to what the index speaks for. Orphans are recomputed here exactly
   * as `snapshot` recomputes them, so the mirror cannot disagree with the
   * records about what is unknown.
   */
  const mirrorView = (): MirrorView => ({
    references: referencesRef.current,
    readings: readingsRef.current,
    texts: textsRef.current,
    states: statesRef.current,
    notes: notesRef.current,
    orphanNotes: orphanNotesRef.current,
    orphanMedia: orphanMedia(
      mediaRef.current,
      referencesRef.current.map((reference) => reference.on),
    ),
    links: linksRef.current,
    orphanLinks: orphanGroundLinks(
      linksRef.current,
      referencesRef.current.map((reference) => reference.on),
    ),
    malformedGround: malformedGroundRef.current,
    malformedReadings: malformedReadingsRef.current,
    malformedLinks: malformedLinksRef.current,
  });

  /**
   * QUEUE THE MIRROR (story 16.9), after the write that caused it. It goes
   * through the ground family's own queue, so a reader never sees a half-updated
   * index and a later move's mirror can never land under an older one. It is
   * NEVER awaited by the write path: a mirror failure is one sentence in the
   * notices group, and the person's move (already written) stands.
   *
   * The render is deferred into the task, so it reads the refs at the moment
   * the queue runs — after every earlier write has moved them.
   */
  const queueMirror = (): void => {
    void queueRef.current.push(
      mirrorWriteTask(
        workspacePath,
        () => renderMirror(mirrorView()),
        (notice) => {
          if (notice === mirrorNoticeRef.current) return;
          mirrorNoticeRef.current = notice;
          setState(snapshot());
        },
      ),
    );
  };

  /**
   * QUEUE THE HISTORY (story 16.10), after the write that caused it. It goes
   * through the ground family's own queue, so a later move's line can never
   * land under an older one, and the append reads the file at the moment the
   * queue runs — after every earlier write has settled. It is NEVER awaited by
   * the write path: a history failure is one sentence in the notices group,
   * and the person's move (already written) stands.
   *
   * The events are taken inside the task so their timestamps describe the
   * moment the line lands; the closures hold only the move's own facts.
   */
  const queueHistory = (events: () => readonly HistoryEvent[]): void => {
    void queueRef.current.push(
      historyWriteTask(workspacePath, events, (notice) => {
        if (notice === historyNoticeRef.current) return;
        historyNoticeRef.current = notice;
        setState(snapshot());
      }),
    );
  };

  useEffect(() => {
    // A different workspace starts from its own map folder, never the last
    // one's state (and the write queue belongs to the person's moves in it).
    // Story 16.8: a pull belongs to the workspace it was taken in — never
    // carried across, and never written, so there is nothing to reload.
    pulledRef.current = {};
    mirrorNoticeRef.current = null;
    historyNoticeRef.current = null;
    // Story 16.13: a restore belongs to the workspace its bytes came from.
    restorableRef.current = null;
    restoreNoticeRef.current = null;
    queueRef.current = createWriteQueue();
    if (workspacePath === "") {
      referencesRef.current = [];
      asksRef.current = [];
      askTurnsRef.current = {};
      malformedAsksRef.current = [];
      readingsRef.current = [];
      mediaRef.current = [];
      malformedMediaRef.current = [];
      thumbsRef.current = {};
      malformedGroundRef.current = [];
      malformedReadingsRef.current = [];
      malformedLinksRef.current = [];
      linksRef.current = [];
      textsRef.current = {};
      statesRef.current = {};
      notesRef.current = {};
      orphanNotesRef.current = [];
      malformedHistoryRef.current = [];
      restorableRef.current = null;
      restoreNoticeRef.current = null;
      setState(EMPTY);
      return;
    }
    setState((current) => ({ ...current, loaded: false }));
    void reload();
  }, [workspacePath, reload]);

  const create = useCallback(
    (name: string, x: number, y: number, from: string): Promise<GroundAddResult> => {
      const trimmed = name.trim();
      if (trimmed === "") {
        return Promise.resolve({ ok: false, message: "name it first." });
      }
      if (from === "") {
        return Promise.resolve({ ok: false, message: "pick a file first." });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          // STORY 17.1: ONE slug space with the ask cards, so the new ground
          // slug can never twin an ask card's (a link or a mention must resolve
          // to exactly one card).
          const addition = addGroundReference(
            referencesRef.current,
            trimmed,
            x,
            y,
            sharedSlugs(referencesRef.current, asksRef.current),
          );
          const taken = await takeReading(
            workspacePath,
            addition.reference.on,
            from,
          );
          if (taken.kind === "refused") {
            outcome = { ok: false, message: taken.message };
            return;
          }
          const nextReadings = withReading(readingsRef.current, taken.reading);
          // The reading's line and text first, the ground line LAST: a crash
          // can leave an orphan reading but never a reference without one.
          await saveReadings(
            workspacePath,
            nextReadings,
            malformedReadingsRef.current,
          );
          await saveGround(
            workspacePath,
            addition.references,
            malformedGroundRef.current,
          );
          referencesRef.current = addition.references;
          readingsRef.current = nextReadings;
          // STORY 16.15: an image keeps NO text — the card draws the person's
          // own file in place — so nothing is entered for it here.
          if (readingExtract(taken.reading) !== "image") {
            textsRef.current = {
              ...textsRef.current,
              [addition.reference.on]: taken.text,
            };
          }
          // The head was just taken from the file: its metadata is current.
          const states = {
            ...statesRef.current,
            [addition.reference.on]: "current" as ReadingState,
          };
          statesRef.current = states;
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: the card appeared and its source was read — one
          // authored move, two lines, no content (the form and size only).
          queueHistory(() => {
            const at = Date.now();
            return [
              cardAddEvent(
                at,
                addition.reference.on,
                addition.reference.x,
                addition.reference.y,
              ),
              readingTakeEvent(
                at,
                addition.reference.on,
                taken.reading.form,
                taken.reading.bytes ?? null,
              ),
            ];
          });
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  /**
   * CREATE A SELECTION CARD (story 16.12): the person selected text inside an
   * expanded card's reading and confirmed a name. The bytes are written
   * VERBATIM and the reading's line records the SOURCE CARD, not a file. No
   * head is read, nothing is stat'ed, and the source card's files are never
   * touched — this only appends the new card's three pieces.
   */
  const createSelection = useCallback(
    (
      sourceSlug: string,
      name: string,
      x: number,
      y: number,
      text: string,
    ): Promise<GroundAddResult> => {
      // The two refusals the affordance also answers with, run BEFORE the
      // queue so a blank name writes nothing at all.
      const refusal = selectionRefusal(name, text);
      if (refusal !== null) {
        return Promise.resolve({ ok: false, message: refusal });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const written = await writeSelectionCard(
            workspacePath,
            referencesRef.current,
            readingsRef.current,
            malformedGroundRef.current,
            malformedReadingsRef.current,
            sourceSlug,
            name,
            x,
            y,
            text,
            new Date().toISOString(),
            undefined,
            { taken: sharedSlugs(referencesRef.current, asksRef.current) },
          );
          referencesRef.current = written.references;
          readingsRef.current = written.readings;
          textsRef.current = {
            ...textsRef.current,
            [written.reading.on]: text,
          };
          // The excerpt is the map's own copy: current, and never stat'ed.
          statesRef.current = {
            ...statesRef.current,
            [written.reading.on]: "current" as ReadingState,
          };
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: a card appeared at a point. The history carries the
          // MOVE only — the excerpt's words are never logged.
          const placed = written.references.find(
            (reference) => reference.on === written.reading.on,
          );
          queueHistory(() => [
            cardAddEvent(
              Date.now(),
              written.reading.on,
              placed?.x ?? Math.round(x),
              placed?.y ?? Math.round(y),
            ),
          ]);
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  /**
   * CREATE A PAGE CARD (story 16.14): the person pasted a web address. The
   * SIDECAR is asked once, inside this queued pass, and only a successful read
   * reaches the writers. Everything the card needs — title, text, a local
   * thumbnail — is copied beside the map, so the card renders offline and the
   * fetch is never repeated at render or reopen.
   *
   * A refused fetch answers one sentence and writes NOTHING: no reading, no
   * media line, no ground line, no thumbnail. An image that cannot be kept is
   * not a refusal — the card simply has no picture and says nothing about it.
   */
  const createPage = useCallback(
    (name: string, x: number, y: number, url: string): Promise<GroundAddResult> => {
      const refusal = pageRefusal(name, url);
      if (refusal !== null) {
        return Promise.resolve({ ok: false, message: refusal });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const read = await createPageFetcher()(url);
          const created = await createFetchedPage(
            workspacePath,
            referencesRef.current,
            readingsRef.current,
            mediaRef.current,
            malformedGroundRef.current,
            malformedReadingsRef.current,
            malformedMediaRef.current,
            name,
            x,
            y,
            url,
            read,
            new Date().toISOString(),
            undefined,
            { taken: sharedSlugs(referencesRef.current, asksRef.current) },
          );
          if (created.kind === "refused") {
            outcome = { ok: false, message: created.message };
            return;
          }
          const written = created.records;
          referencesRef.current = written.references;
          readingsRef.current = written.readings;
          mediaRef.current = written.media;
          const texts = { ...textsRef.current, [written.reading.on]: written.text };
          textsRef.current = texts;
          if (written.thumbSrc !== null) {
            thumbsRef.current = {
              ...thumbsRef.current,
              [written.reading.on]: written.thumbSrc,
            };
          }
          // A page has no path to stat: it is current once taken.
          statesRef.current = {
            ...statesRef.current,
            [written.reading.on]: "current" as ReadingState,
          };
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: the card appeared and its page was read — the form and
          // the move, never the address, the title or a word of the text.
          queueHistory(() => {
            const at = Date.now();
            return [
              cardAddEvent(
                at,
                written.reading.on,
                x,
                y,
              ),
              readingTakeEvent(at, written.reading.on, "url", null),
            ];
          });
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  /**
   * CREATE A VIDEO CARD (story 16.15): the person pasted a video address. The
   * SIDECAR reads its oEmbed look once, inside this queued pass, and only a
   * successful read reaches the writers. The title and a LOCAL thumbnail are
   * copies, so the card renders offline and the address is never asked again.
   *
   * A refused read answers one sentence and writes NOTHING: no picture, no
   * media line, no reading line, no ground line. An image that cannot be kept
   * is not a refusal — the card simply has no picture.
   */
  const createVideo = useCallback(
    (name: string, x: number, y: number, url: string): Promise<GroundAddResult> => {
      const refusal = videoRefusal(name, url);
      if (refusal !== null) {
        return Promise.resolve({ ok: false, message: refusal });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const read = await createVideoFetcher()(url);
          const created = await createFetchedVideo(
            workspacePath,
            referencesRef.current,
            readingsRef.current,
            mediaRef.current,
            malformedGroundRef.current,
            malformedReadingsRef.current,
            malformedMediaRef.current,
            name,
            x,
            y,
            url,
            read,
            new Date().toISOString(),
            undefined,
            { taken: sharedSlugs(referencesRef.current, asksRef.current) },
          );
          if (created.kind === "refused") {
            outcome = { ok: false, message: created.message };
            return;
          }
          const written = created.records;
          referencesRef.current = written.references;
          readingsRef.current = written.readings;
          mediaRef.current = written.media;
          if (written.thumbSrc !== null) {
            thumbsRef.current = {
              ...thumbsRef.current,
              [written.reading.on]: written.thumbSrc,
            };
          }
          // A video's artifact (its title and picture) was just kept: current.
          statesRef.current = {
            ...statesRef.current,
            [written.reading.on]: "current" as ReadingState,
          };
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: the card appeared and its look was read — the form and
          // the move, never the address, the title or a word of any text.
          queueHistory(() => {
            const at = Date.now();
            return [
              cardAddEvent(at, written.reading.on, x, y),
              readingTakeEvent(at, written.reading.on, "url", null),
            ];
          });
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  /**
   * SEND one ask turn's question through the EXISTING card-ask path: the same
   * provider rows, the same streaming, and the packet the card declared before
   * the press (story 17.3's assembler; the READ set stays the anchored block).
   * This is the only new send site; the provider rows and the step ceiling are
   * unchanged (story 17.4 owns the sending turn's PRISM).
   *
   * It runs OUTSIDE the write queue: a turn may take its whole budget, and a
   * card drag must never wait for a provider. Only the record write goes
   * through the queue. An unconfigured turn is one sentence and no answer.
   */
  const sendAskQuestion = useCallback(
    async (
      packet: AskPacket,
      context: AskContext,
      onPart?: (text: string) => void,
    ): Promise<AskSendResult> => {
      if (turn === undefined) {
        return { kind: "failed", sentence: TURN_SENTENCES.unreachable };
      }
      const current = await loadTurnSettings();
      const resolved = resolveSelection(current);
      if (resolved.kind !== "resolved") {
        return { kind: "failed", sentence: PROVIDER_SENTENCES.nothing };
      }
      // The key is read NOW, for this provider only, and handed straight to the
      // request line — never rendered, never kept in state.
      const apiKey =
        resolved.provider.kind === "http"
          ? await readSecret(resolved.provider.id)
          : "";
      const route = routeOf(resolved.provider, resolved.model, apiKey);
      const answered = await turn.sendPacket(
        route,
        packet,
        (blockName) =>
          workspacePath === ""
            ? Promise.resolve(null)
            : fetchAskBlock(workspacePath, blockName, context),
        onPart === undefined ? {} : { onPart },
      );
      // The bytes that left, handed back so the card's surface can open them
      // after the send exactly as the embedded panel's readback does.
      return askSendResult(answered.result, {
        messages: answered.messages,
        read: answered.read,
      });
    },
    [turn, workspacePath],
  );

  /**
   * STORY 17.1 — MAKE AN ASK CARD BESIDE A REFERENCE. One queued write of
   * `map/asks.txt`; no reading, no note, no media, no link, and NEVER a touch
   * of the reference card. The anchor is a FIELD naming the reference, and the
   * slug is minted in the shared space of both files. The conversation file
   * appears with the first turn, not here: a card that has never been asked in
   * has no conversation to invent.
   *
   * No history line and no mirror write: story 17.8 owns the asks' authored
   * moves in the log and the index.
   */
  const createAsk = useCallback(
    (
      sourceSlug: string,
      name: string,
      x: number,
      y: number,
    ): Promise<GroundAddResult> => {
      const refusal = askRefusal(name);
      if (refusal !== null) return Promise.resolve({ ok: false, message: refusal });
      if (!referencesRef.current.some((reference) => reference.on === sourceSlug)) {
        return Promise.resolve({ ok: false, message: ASK_SOURCE_REFUSAL });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const written = await writeAskCard(
            workspacePath,
            referencesRef.current,
            asksRef.current,
            malformedAsksRef.current,
            sourceSlug,
            name,
            x,
            y,
          );
          asksRef.current = written.asks;
          setState(snapshot());
          outcome = { ok: true };
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  /**
   * STORY 17.1 — ASK ONE QUESTION inside an ask card. STORY 17.3 makes the
   * question a packet: the anchored reference's blocks as before PLUS this
   * card's conversation under the stated bound (the newest WHOLE turns that fit
   * a turn count and a byte budget — map/asks.ts's lastTurns). The READ set is
   * the anchor's own block, never a turn. Then ONE append-only write records
   * the exchange: the person's line always, the answer line only when the turn
   * answered. A failed or stopped turn leaves the person's line alone and
   * answers the ONE sentence in the card — no PRISM (17.4) and no map write
   * beyond the ask card's conversation.
   */
  const askTurn = useCallback(
    (
      slug: string,
      question: string,
      onPart?: (text: string) => void,
    ): Promise<GroundAddResult> => {
      const refusal = askQuestionRefusal(question);
      if (refusal !== null) {
        return Promise.resolve({ ok: false, message: refusal });
      }
      const ask = asksRef.current.find((entry) => entry.on === slug);
      if (ask === undefined) {
        return Promise.resolve({ ok: false, message: ASK_MISSING_REFUSAL });
      }
      // The anchored card's facts as the app already holds them. A DANGLING
      // anchor is legal (story 17.6 states it): the packet rides the slug and
      // claims no reading, and nothing here repairs or refuses the record.
      const anchor =
        referencesRef.current.find((reference) => reference.on === ask.anchor) ??
        null;
      const facts = {
        name: anchor === null ? ask.anchor : anchor.name,
        state:
          anchor === null ? null : statesRef.current[anchor.on] ?? null,
        reading:
          anchor === null
            ? null
            : readingFor(readingsRef.current, anchor.on),
        readingText:
          anchor === null ? null : textsRef.current[anchor.on] ?? null,
        note: anchor === null ? null : notesRef.current[anchor.on] ?? null,
      };
      const context = cardAskContext(facts);
      // STORY 17.3 — THE PACKET CARRIES THE CARD AND THE THREAD: the anchored
      // card's blocks as before, then the conversation so far under the stated
      // bound (the newest WHOLE turns that fit a turn count and a byte budget).
      // The thread is read from the SAME record the card renders, and the READ
      // set stays the anchor's own block, so retrieval can never reach a turn.
      const packet = assembleAskCardPacket(
        context.card,
        askTurnsRef.current[slug] ?? [],
        question,
        ASK_THREAD_BOUND,
        context.retrievable,
      );
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return sendAskQuestion(packet, context, onPart)
        .then((sent) =>
          queueRef.current.push(async () => {
            const recorded = await recordAskTurn(
              workspacePath,
              slug,
              question,
              sent,
            );
            askTurnsRef.current = {
              ...askTurnsRef.current,
              [slug]: recorded.turns,
            };
            setState(snapshot());
            outcome =
              recorded.sentence === null
                ? { ok: true, readback: sent.readback }
                : {
                    ok: false,
                    message: recorded.sentence,
                    readback: sent.readback,
                  };
          }),
        )
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath, sendAskQuestion],
  );

  /**
   * STORY 17.2 — THE CARD'S STOP. The same port the embedded panel stops; the
   * AskCard marks what arrived as a partial, and the record still holds the
   * person's line alone (an answer line is only ever a finished answer).
   */
  const askStop = useCallback(async (): Promise<void> => {
    if (turn === undefined) return;
    try {
      await turn.stop();
    } catch {
      // A stop that cannot reach the provider leaves the turn to its timeout.
    }
  }, [turn]);

  /** MOVE: one ground-line write on drop; no reading is touched. */
  const move = useCallback(
    (on: string, x: number, y: number): Promise<GroundAddResult> => {
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const next = moveGroundReference(referencesRef.current, on, x, y);
          await saveGround(workspacePath, next, malformedGroundRef.current);
          referencesRef.current = next;
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: one drop, one line — the point it landed on.
          const placed = next.find((reference) => reference.on === on);
          queueHistory(() => [
            cardMoveEvent(
              Date.now(),
              on,
              placed?.x ?? Math.round(x),
              placed?.y ?? Math.round(y),
            ),
          ]);
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  /**
   * Replace one slug's reading in place (a refresh or a re-point keeps the
   * line's position in the file), or append it when the slug had none (an
   * `unread` reference adopting a file).
   */
  const writtenReading = useCallback(
    (reading: Reading): Reading[] => {
      const current = readingsRef.current;
      if (current.some((existing) => existing.on === reading.on)) {
        return current.map((existing) =>
          existing.on === reading.on ? reading : existing,
        );
      }
      return [...current, reading];
    },
    [],
  );

  /** REFRESH: re-read the same file, by the person's press only. */
  const refresh = useCallback(
    (on: string): Promise<GroundAddResult> => {
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const reading = readingFor(readingsRef.current, on);
          if (reading === null) {
            outcome = { ok: false, message: "there is no reading to refresh." };
            return;
          }
          // A page has no file behind it: its text is the map's own copy.
          if (!isFileReading(reading)) {
            outcome = {
              ok: false,
              message: "a page has no file to re-read; its text is kept here.",
            };
            return;
          }
          // STORY 16.15: an image is DRAWN from its own file, never re-read, so
          // a refresh has nothing to take — one sentence, nothing written.
          if (readingExtract(reading) === "image") {
            outcome = { ok: false, message: IMAGE_REFRESH_REFUSAL };
            return;
          }
          const taken = await refreshReading(workspacePath, reading);
          if (taken.kind === "refused") {
            // STORY 16.13 (shortlist item 11): a refused refresh says what
            // STILL STANDS — the old reading is untouched and still on screen.
            outcome = { ok: false, message: REFRESH_UNCHANGED };
            return;
          }
          const nextReadings = writtenReading(taken.reading);
          // Text first (refreshReading wrote it), the line last: a crash can
          // never leave a line pointing at text that is not there.
          await saveReadings(
            workspacePath,
            nextReadings,
            malformedReadingsRef.current,
          );
          readingsRef.current = nextReadings;
          const texts = { ...textsRef.current, [on]: taken.text };
          textsRef.current = texts;
          const states = { ...statesRef.current, [on]: "current" as ReadingState };
          statesRef.current = states;
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: a re-read of the SAME file — form and size, no text.
          queueHistory(() => [
            readingRefreshEvent(
              Date.now(),
              on,
              taken.reading.form,
              taken.reading.bytes ?? null,
            ),
          ]);
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath, writtenReading],
  );

  /**
   * RE-POINT: point this reference at another file and take its head (story
   * 16.2 decision 5). Same path as an add, minus the new reference: the text
   * and the line are replaced for that slug, text first, line last. A refused
   * pick leaves BOTH files exactly as they were and answers the sentence.
   */
  const repoint = useCallback(
    (on: string, from: string): Promise<GroundAddResult> => {
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const taken = await takeReading(workspacePath, on, from);
          if (taken.kind === "refused") {
            outcome = { ok: false, message: taken.message };
            return;
          }
          const nextReadings = writtenReading(taken.reading);
          await saveReadings(
            workspacePath,
            nextReadings,
            malformedReadingsRef.current,
          );
          readingsRef.current = nextReadings;
          // STORY 16.15: a re-point to an IMAGE keeps no text at all, so the
          // card's OLD text goes with the old reading — otherwise a reopen
          // would draw the previous file's words under the new picture.
          const turnedIntoImage = readingExtract(taken.reading) === "image";
          if (turnedIntoImage) {
            try {
              await removeFile(readingTextPath(workspacePath, on));
            } catch {
              // A text file that is already gone is the state we want.
            }
          }
          const texts = { ...textsRef.current };
          if (turnedIntoImage) delete texts[on];
          else texts[on] = taken.text;
          textsRef.current = texts;
          const states = { ...statesRef.current, [on]: "current" as ReadingState };
          statesRef.current = states;
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: the card now reads ANOTHER file. Only the new
          // target's NAME is logged — a full path is the person's machine.
          queueHistory(() => [
            readingRepointEvent(
              Date.now(),
              on,
              taken.reading.form,
              readingFileName(taken.reading.from),
            ),
          ]);
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath, writtenReading],
  );

  /**
   * REMOVE: the reference's line, its reading's line, then its text file — the
   * ONE order (story 16.3), through the same queue as every other write. A
   * refused unlink answers one sentence after the lines have gone; nothing is
   * retried or repaired here. THEN, in the same queued pass, every link that
   * names the slug leaves (story 16.5) — both directions, after the card's own
   * removal, so the app never manufactures an orphan.
   */
  const remove = useCallback(
    (on: string): Promise<GroundAddResult> => {
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          // The computed state at delete time is what the restored card shows;
          // it is view state, never a record (story 16.2's rule).
          const previousState = statesRef.current[on] ?? "unread";
          // STORY 16.14b — READ THE PICTURE BEFORE ANY UNLINK. The media line
          // and the thumbnail wrapper's bytes are what Restore must put back; a
          // card with no picture captures nothing (a missing one is not an
          // error, and nothing is invented on the way back).
          const capturedMedia = await captureGroundMedia(
            workspacePath,
            on,
            mediaRef.current,
          );
          const removal = await removeGroundRecords(
            workspacePath,
            on,
            referencesRef.current,
            readingsRef.current,
            malformedGroundRef.current,
            malformedReadingsRef.current,
          );
          referencesRef.current = removal.references;
          readingsRef.current = removal.readings;
          // STORY 16.6: the note file goes AFTER the reading's text (a card's
          // own files together) and BEFORE the links' cascade below. A refused
          // unlink is one sentence; the card is already gone, so nothing here
          // is retried or repaired.
          const noteRefusal = await removeGroundNote(workspacePath, on);
          // STORY 16.14: the card's media line and its local thumbnail go with
          // its other files — no orphan image, no stale picture if the slug is
          // coined again later.
          const mediaRemoval = await removeGroundMedia(
            workspacePath,
            on,
            mediaRef.current,
            malformedMediaRef.current,
          );
          mediaRef.current = mediaRemoval.media;
          const thumbs = { ...thumbsRef.current };
          delete thumbs[on];
          thumbsRef.current = thumbs;
          // THE CASCADE (story 16.5): AFTER the reference's own removal (the
          // existing card-delete order above is untouched) and in the same
          // queued pass, every link that NAMES this slug leaves the link file —
          // in BOTH directions, so the app never manufactures an orphan.
          // Story 16.10 remembers exactly which links this pass takes, so their
          // passing can be logged as its own lines. Story 16.13 also keeps each
          // line's FILE POSITION, so Restore can put it back where it was.
          const cascaded = linksRef.current
            .map((link, index) => ({ link, index }))
            .filter(({ link }) => link.from === on || link.to === on);
          linksRef.current = await removeGroundLinksNaming(
            workspacePath,
            on,
            linksRef.current,
            malformedLinksRef.current,
          );
          const texts = { ...textsRef.current };
          delete texts[on];
          textsRef.current = texts;
          const states = { ...statesRef.current };
          delete states[on];
          statesRef.current = states;
          const notes = { ...notesRef.current };
          delete notes[on];
          notesRef.current = notes;
          // A card that is gone cannot keep its look (story 16.8).
          const pulled = { ...pulledRef.current };
          delete pulled[on];
          pulledRef.current = pulled;
          // STORY 16.13 — THE TOAST'S ONE PENDING RESTORE. The bytes were read
          // before the unlink; the links and the computed state are added here,
          // where the cascade and the load's state live. A second delete
          // REPLACES this snapshot (committing the first, exactly one toast).
          const removedCard: RemovedCard | null =
            removal.removed === null
              ? null
              : {
                  ...removal.removed,
                  links: cascaded,
                  state: previousState,
                  media: capturedMedia.entry,
                  mediaIndex: capturedMedia.index,
                  thumbSvgText: capturedMedia.thumbSvgText,
                };
          restorableRef.current = pendingRestoreAfter(
            restorableRef.current,
            removedCard,
          );
          restoreNoticeRef.current = null;
          setState(snapshot());
          const refusal =
            removal.refusal ?? noteRefusal ?? mediaRemoval.refusal;
          outcome =
            refusal === null
              ? { ok: true }
              : {
                  ok: false,
                  message: refusal,
                  recordsRemoved: true,
                };
          // Story 16.10: the removal itself, then one line per link the
          // cascade took — links are their own records, so their passing is
          // its own move, and the count is in the lines, never in the UI.
          queueHistory(() =>
            cardRemovalEvents(
              Date.now(),
              on,
              cascaded.map((entry) => entry.link),
            ),
          );
          // The card's files (and the cascade) have moved: the mirror follows
          // in the same queue, whether or not a later unlink refused.
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  /**
   * LINK (story 16.5): DRAW one WORDLESS link from a card to another — one
   * ordered pair, ONE write. The pair is the identity, so drawing the identical
   * link again rewrites its one line (never a duplicate), while the reverse
   * drag is a second, separate line. The direction is recorded because it was
   * drawn and read by nothing (the epic's reframe: a link is not a Distance).
   * A self-link, or an endpoint the map does not carry, refuses with one
   * sentence and writes nothing.
   */
  const link = useCallback(
    (from: string, to: string): Promise<GroundAddResult> => {
      const refusal = groundLinkRefusal(
        from,
        to,
        referencesRef.current.map((reference) => reference.on),
      );
      if (refusal !== null) {
        return Promise.resolve({ ok: false, message: refusal });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const next = addGroundLink(linksRef.current, from, to);
          await saveGroundLinks(workspacePath, next, malformedLinksRef.current);
          linksRef.current = next;
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: one drawn pair, one line — the direction as drawn.
          queueHistory(() => [linkAddEvent(Date.now(), from, to)]);
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  /**
   * UNLINK (story 16.5): remove ONE exact ordered pair. The two cards stay
   * exactly as they are — the wire is the only thing that goes. The reverse
   * link, if it was drawn separately, is a different pair and stays.
   */
  const unlink = useCallback(
    (from: string, to: string): Promise<GroundAddResult> => {
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const next = withoutGroundLink(linksRef.current, from, to);
          await saveGroundLinks(workspacePath, next, malformedLinksRef.current);
          linksRef.current = next;
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: one removed pair, one line; the cards stay.
          queueHistory(() => [linkRemoveEvent(Date.now(), from, to)]);
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  /**
   * SET NOTE (story 16.6): save the person's own words for a card the map
   * still carries. ONE write through the same queue — `saveNote` writes the
   * text verbatim, or removes the file when the person emptied it. An
   * over-cap note refuses with one sentence and writes nothing. The reading's
   * files are never read or written here: the note is a separate file, and the
   * split is the story's whole point. A slug the map no longer carries refuses
   * rather than manufacturing an orphan.
   */
  const setNote = useCallback(
    (on: string, text: string): Promise<GroundAddResult> => {
      if (!referencesRef.current.some((reference) => reference.on === on)) {
        return Promise.resolve({
          ok: false,
          message: "there is no card to hold that note.",
        });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const saved = await saveNote(workspacePath, on, text);
          if (saved.kind === "refused") {
            outcome = { ok: false, message: saved.message };
            return;
          }
          const notes = { ...notesRef.current };
          if (saved.kind === "removed") delete notes[on];
          else notes[on] = saved.text;
          notesRef.current = notes;
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: the note changed — THAT it changed, never a word of
          // it. The person's text lives in map/notes/<slug>.md and stays there.
          const emptied = saved.kind === "removed";
          queueHistory(() => [
            emptied
              ? noteRemoveEvent(Date.now(), on)
              : noteSetEvent(Date.now(), on),
          ]);
          queueMirror();
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  /**
   * PULL (story 16.8): the person's one verb asks for MORE of this card's
   * source, under the stated budget, and the answer is put in view state.
   *
   * WHY IT IS NOT QUEUED AND NOT WRITTEN: a pull is a READ — the queue exists
   * to serialize writes, and the reading it re-reads is located by the line
   * the map already holds. Nothing here calls a writer, touches `readings.txt`,
   * the stored text, the note, the state word or the refresh stamp; the pulled
   * text lives in `pulledRef` until the person dismisses it or the card
   * closes. A refusal clears an older pull (so the card never shows a stale
   * look under a new refusal) and answers the reader's existing sentence.
   */
  const pull = useCallback(
    (on: string): Promise<GroundAddResult> => {
      const reading = readingFor(readingsRef.current, on);
      if (reading === null) {
        // The verb is only drawn on a reading-bearing card; this guards a
        // hand-driven call without inventing a sentence (the existing one).
        return Promise.resolve({
          ok: false,
          message: READING_REFUSALS.absent,
        });
      }
      // STORY 16.14: a page reading has no source file to pull MORE from — the
      // whole extracted text is already the kept reading.
      if (!isFileReading(reading)) {
        return Promise.resolve({
          ok: false,
          message: "a page's text is already kept here.",
        });
      }
      // STORY 16.15: an image has no text behind it to pull MORE of.
      if (readingExtract(reading) === "image") {
        return Promise.resolve({ ok: false, message: IMAGE_PULL_REFUSAL });
      }
      return pullReading(workspacePath, reading)
        .then((result): GroundAddResult => {
          if (result.kind === "refused") {
            const pulled = { ...pulledRef.current };
            delete pulled[on];
            pulledRef.current = pulled;
            setState(snapshot());
            return { ok: false, message: result.message };
          }
          const pulled = { ...pulledRef.current };
          pulled[on] = { text: result.text, truncated: result.truncated };
          pulledRef.current = pulled;
          setState(snapshot());
          return { ok: true };
        })
        .catch(
          (): GroundAddResult => ({
            ok: false,
            message: READING_REFUSALS.io,
          }),
        );
    },
    [workspacePath],
  );

  /**
   * DISMISS (story 16.8): forget one card's look. View state only — there is
   * no file behind a pull, so this deletes a key and nothing else.
   */
  const dismissPull = useCallback((on: string): void => {
    if (!(on in pulledRef.current)) return;
    const pulled = { ...pulledRef.current };
    delete pulled[on];
    pulledRef.current = pulled;
    setState(snapshot());
  }, []);

  // STORY 16.13 — THE TOAST'S WINDOW. When it ends, the deletion is committed:
  // the held bytes are dropped and nothing can put the card back. No countdown
  // is drawn; the span is stated once in the story and lived with.
  useEffect(() => {
    if (state.restorable === null) return;
    const timer = setTimeout(() => {
      restorableRef.current = null;
      setState((current) => ({ ...current, restorable: null }));
    }, RESTORE_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [state.restorable]);

  /**
   * STORY 16.13 — RESTORE. Through the same queue as every write, the held
   * bytes go back (reading text, note, reading line, links, reference last),
   * and the log records the SECOND move: `card.restore` plus one `link.add`
   * per link that came back. A partial restore answers one sentence naming what
   * came back and what did not; either way the pending restore is spent.
   */
  const restore = useCallback((): Promise<GroundAddResult> => {
    const pending = restorableRef.current;
    if (pending === null) {
      return Promise.resolve({
        ok: false,
        message: "there is nothing to restore.",
      });
    }
    const slug = pending.reference.on;
    let outcome: GroundAddResult = {
      ok: false,
      message: "nothing came back.",
    };
    return queueRef.current
      .push(async () => {
        const restored = await restoreGroundCard(
          workspacePath,
          pending,
          referencesRef.current,
          readingsRef.current,
          linksRef.current,
          mediaRef.current,
          malformedGroundRef.current,
          malformedReadingsRef.current,
          malformedLinksRef.current,
          malformedMediaRef.current,
        );
        referencesRef.current = restored.references;
        readingsRef.current = restored.readings;
        linksRef.current = restored.links;
        mediaRef.current = restored.media;
        // The in-memory views follow the writes that actually landed: a piece
        // whose file refused must not be shown as if it were back.
        if (
          pending.readingText !== null &&
          restored.cameBack.includes("the reading text")
        ) {
          textsRef.current = {
            ...textsRef.current,
            [slug]: pending.readingText,
          };
        }
        if (pending.note !== null && restored.cameBack.includes("the note")) {
          notesRef.current = { ...notesRef.current, [slug]: pending.note };
        }
        // STORY 16.14b: the card's picture returns with the file that was
        // written back. Only a picture that was there is shown again.
        if (
          pending.media !== null &&
          pending.media.thumb !== undefined &&
          pending.thumbSvgText !== null &&
          restored.cameBack.includes("the picture")
        ) {
          thumbsRef.current = {
            ...thumbsRef.current,
            [slug]: thumbSrcOf(pending.thumbSvgText),
          };
        }
        if (restored.restoredReference) {
          // The reading's state only returns with its LINE; a line that did not
          // come back leaves the card unread, never a state claiming a reading
          // that is not on disk. If the text alone failed, the state word and
          // the absence line still tell the truth about the copy.
          statesRef.current = {
            ...statesRef.current,
            [slug]:
              pending.reading !== null &&
              !restored.cameBack.includes("the reading")
                ? "unread"
                : pending.state,
          };
        }
        restorableRef.current = null;
        restoreNoticeRef.current = restored.refusal;
        setState(snapshot());
        outcome =
          restored.refusal === null
            ? { ok: true }
            : { ok: false, message: restored.refusal };
        // Story 16.10: a restore is an AUTHORED move, and a silent one would be
        // a bug. Its links are their own records, so each coming back is its
        // own line too; a restore that did not put the card back logs nothing,
        // because there is no card to name.
        if (restored.restoredReference) {
          const links = restored.restoredLinks;
          queueHistory(() => [
            cardRestoreEvent(Date.now(), slug),
            ...links.map((link) =>
              linkAddEvent(Date.now(), link.from, link.to),
            ),
          ]);
        }
        // A partial restore can still have moved the reading, the note or the
        // links; the derived index follows any piece that came back.
        if (restored.cameBack.length > 0) queueMirror();
      })
      .then(() => outcome)
      .catch(() => ({
        ok: false,
        message: "the map folder could not take the card back.",
      }));
  }, [workspacePath]);

  /** CLOSE THE TOAST: the pending deletion is committed and forgotten. */
  const dismissRestore = useCallback((): void => {
    if (restorableRef.current === null && restoreNoticeRef.current === null) {
      return;
    }
    restorableRef.current = null;
    restoreNoticeRef.current = null;
    setState((current) => ({
      ...current,
      restorable: null,
      restoreNotice: null,
    }));
  }, []);

  return {
    references: state.references,
    asks: state.asks,
    askTurns: state.askTurns,
    malformedAsks: state.malformedAsks,
    readings: state.readings,
    media: state.media,
    thumbs: state.thumbs,
    texts: state.texts,
    states: state.states,
    pulled: state.pulled,
    notes: state.notes,
    orphanNotes: state.orphanNotes,
    orphanMedia: state.orphanMedia,
    links: state.links,
    orphanLinks: state.orphanLinks,
    malformedGround: state.malformedGround,
    malformedReadings: state.malformedReadings,
    malformedLinks: state.malformedLinks,
    mirrorNotice: state.mirrorNotice,
    historyNotice: state.historyNotice,
    malformedHistory: state.malformedHistory,
    restorable: state.restorable,
    restoreNotice: state.restoreNotice,
    loaded: state.loaded,
    createAsk,
    askTurn,
    askStop,
    create,
    createSelection,
    createPage,
    createVideo,
    move,
    refresh,
    repoint,
    remove,
    link,
    unlink,
    setNote,
    pull,
    dismissPull,
    restore,
    dismissRestore,
  };
}
