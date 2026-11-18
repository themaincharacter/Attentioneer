import { useCallback, useEffect, useRef, useState } from "react";
import {
  fileMeta as fsFileMeta,
  readTextFile as fsReadTextFile,
  removeFile,
  type FileMetaAnswer,
} from "../lib/fs";
import { createWriteQueue } from "../lib/writeQueue";
import {
  askAddEvent,
  askForkEvent,
  askRemoveEvent,
  askRestoreEvent,
  askTurnEvent,
  cardAddEvent,
  cardRenameEvent,
  sessionAddEvent,
  sessionRemoveEvent,
  sessionRestoreEvent,
  sessionResultEvent,
  sessionRunEvent,
  cardMoveEvent,
  cardRemovalEvents,
  moveChangedThePoint,
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
  type AskTurnEnding,
  type HistoryEvent,
} from "../map/history";
import {
  ASK_MISSING_REFUSAL,
  ASK_SOURCE_REFUSAL,
  ASK_THREAD_BOUND,
  ASK_UNTITLED_NAME,
  CHOSEN_WORDS_REFUSAL,
  addAsk,
  chosenWordsName,
  selectionWords,
  selectionWordsRefusal,
  appendExchange,
  askNameFromQuestion,
  askQuestionRefusal,
  askRefusal,
  askTurnPath,
  forkAsk,
  forkThread,
  insertAskAt,
  loadAskConversations,
  loadAsks,
  loadTurns,
  renameAsk,
  restoreConversation,
  saveAsks,
  sharedSlugs,
  withAskMoved,
  withoutAsk,
  type AskCard,
  type AskForkThread,
  type AskTurn,
} from "../map/asks";
import {
  SESSION_BUSY_SENTENCE,
  SESSION_MISSING_REFUSAL,
  SESSION_NO_TOOL_REFUSAL,
  SESSION_TRANSCRIPT_REFUSAL,
  addSession,
  appendSessionEntries,
  bindSessionTool as bindSessionToolRecord,
  loadSessionTranscript,
  loadSessionTranscriptsWithOrphans,
  loadSessions,
  removeSessionRecords,
  renameSession,
  restoreSessionCard,
  runOutcomeOf,
  saveSessions,
  SESSION_RESULT_EMPTY_SENTENCE,
  SESSION_RESULT_UNFINISHED_SENTENCE,
  sessionLastEnding,
  sessionNameForWrite,
  sessionRefusal,
  sessionResultName,
  sessionResultSize,
  sessionRunResult,
  withSessionMoved,
  type RemovedSession,
  type SessionCard,
  type SessionEntry,
  type SessionIo,
  type SessionPermissionReply,
} from "../map/sessions";
import {
  addGroundReference,
  loadGround,
  moveGroundReference,
  saveGround,
  withGroundRemoved,
  withGroundRenamed,
  type GroundReference,
} from "../map/ground";
// STORY 18.3b — THE RUN LANE LEFT THE WINDOW. This file used to import the
// run's own module here, which is what made pressing RUN impossible in the
// shipped app: that module needs node:fs and a spawner, and a WebView has
// neither. The run happens in the sidecar now; the window asks through this
// small seam (`turn/acpSession.ts`) and reads the run's vocabulary from the
// window-safe `turn/acpEntries.ts`, never from the run's module.
import { startSessionRun, type SessionRunHandle } from "../turn/acpSession";
import type {
  AcpEnding,
  AcpPermissionAsk,
  AcpPermissionChoice,
  AcpProgressEntry,
} from "../turn/acpEntries";
import { artifactPlacement, besidePlacement, type Point } from "./geometry";
import type { SidecarStart } from "../turn/sidecar";
import { shippedAcpSpec, type AcpSpec } from "../turn/acpSpecs";
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
  isFileReading,
  pageReading,
  readingAbsolutePath,
  readingExtract,
  readingFileName,
  readingFor,
  readingTextPath,
  distilledReading,
  distilledSourceSlug,
  refreshReading,
  restoreReadingText,
  resolveReadingState,
  saveReadings,
  selectionReading,
  storeDistilledText,
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
  createPageTextFetcher,
  createVideoFetcher,
  type PageFetchAnswer,
  type PageImage,
  type VideoFetchAnswer,
} from "../turn/pageFetch";
import { readSecret } from "../lib/secret";
import { isPointerForm, pointerKey } from "../map/pointers";
import type { Prism } from "../map/prisms";
import { appendAskCardMove, appendSessionRun } from "../contacts/prismLog";
import { askOutcomeOf, type AskEnding } from "../contacts/ask";
import { readAskPages } from "../turn/pageAsk";
import {
  askCardsContext,
  fetchAskBlock,
  type AskCardFacts,
  type AskContext,
} from "../turn/context";
import {
  ASK_CONTEXT_BOUND,
  assembleAskCardPacket,
  selectAskContextCards,
  type AskPacket,
  type AskPacketCard,
  type AskPacketReadback,
} from "../turn/packet";
import { loadTurnSettings } from "../turn/provider";
import { askSteps } from "../turn/steps";
import {
  PROVIDER_SENTENCES,
  resolveManager,
  resolveSelection,
} from "../turn/providers";
import {
  buildCuratorMessages,
  readCuratorAnswer,
  type CuratorRead,
} from "../turn/curator";
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
 *   - THE ASKS' TWO MEMORIES (17.8): every ask move above also appends its
 *     structural line to the history — `ask.add`, `ask.fork` (STORY 17.10
 *     retires `ask.reanchor`: the verb is gone; old lines still parse),
 *     `ask.remove`, `ask.restore`, and one `ask.turn` per SENDING turn whose
 *     ending is the PRISM's own outcome (same fact, two records that never
 *     disagree; the PRISM first, then the words, then the line) — and the
 *     mirror's asks section says each card's name, what it is about and its
 *     parent, never a word, a count or a preview. Removing an ask card is the
 *     same immediate-delete + Restore promise as every other card: the record
 *     line and the conversation's BYTES are read before the unlink and written
 *     back verbatim, and a conversation whose card is gone is an ORPHAN named
 *     in the notices group and the mirror, never adopted and never deleted.
 *   - THE SESSIONS' TWO MEMORIES (18.5): every session move above also appends
 *     its structural line — `session.add`, `session.remove`,
 *     `session.restore`, one `session.run` per settled run (its ending is the
 *     PRISM's own outcome through ONE mapping) and `session.result` when a
 *     completed run's text became a card — and the mirror's sessions section
 *     says each card's name, its tool row and its last ending, never a word, a
 *     path, a command or a count. Each settled run appends ONE PRISM with the
 *     tool ROW's id, the ending and the result's exact size. Removing a session
 *     card is the same immediate-delete + Restore promise every other card
 *     makes: the record line and the transcript's BYTES are read before the
 *     unlink and written back verbatim, and a transcript whose card is gone is
 *     an ORPHAN named in the notices group and the mirror, never adopted and
 *     never deleted.
 *   - A SELECTION CARD (16.12's FORM, still legal): a card whose reading is a
 *     copy of text from another card — no source file, provenance
 *     `card://<source>`, current by construction, never stat'ed. STORY 18
 *     REMOVED THE VERB THAT MADE ONE FROM A CONCEPT-MAP SELECTION (the user
 *     corrected the intent: that selection should open the ASK widget, a later
 *     story). The form stays parsed and rendered, because existing cards and
 *     story 18.4's run-result card are selections too; the result card is the
 *     creator, through `writeSelectionCard`.
 *   - A DISTILLED CARD (STORY 17.11, ADR-0037's first artifact): the sibling
 *     form one `card://` step over. A COMPLETED ask turn's reply is COPIED
 *     verbatim into a card of its own by a RULE — no model, no distillation —
 *     and the new card is wired back to the ask card that produced it. The ask
 *     card keeps the reply; this card is the artifact, and its line says a
 *     rule made it until 17.12's curator takes over.
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
      /**
       * STORY 17.7b — WHAT THE TURN HIT, handed to the card beside the words:
       * the step ceiling's sentence (or null) and a READ the view did not carry
       * (or null). View facts, never record fields: a reload forgets them.
       */
      reached?: string | null;
      missed?: string | null;
      /**
       * STORY 17.5 — the slug of the card a FORK just made, so the layer can
       * open it (a fork opens its new card). Absent on every other move.
       */
      created?: string;
      /**
       * STORY 17.11 — the one line an ask card shows when a turn completed
       * with no text, or did not complete at all: no card was made. VIEW
       * state, never a record field.
       */
      noCard?: string;
    }
  | {
      ok: false;
      message: string;
      /** STORY 17.11: the turn did not complete, so no card was made. */
      noCard?: string;
      /** The same bytes for a turn that left and did not finish. */
      readback?: AskPacketReadback;
      /**
       * STORY 17.7b — WHAT THE TURN HIT, handed to the card beside the words:
       * the step ceiling's sentence (or null) and a READ the view did not carry
       * (or null). These are the TURN's facts, never the record's — a reload
       * forgets them and the conversation file still holds only words.
       */
      reached?: string | null;
      missed?: string | null;
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
  /**
   * STORY 17.8 — conversation files whose ask card is gone: kept in
   * `map/asks/`, named in the ground notices group and in the mirror's
   * unknowns, never adopted and never deleted (the notes' rule, one family
   * over). Computed from the load's listing and every write that can make one.
   */
  orphanAskTurns: readonly string[];
  /**
   * STORY 18.3 — every SESSION card, in FILE ORDER: the ground map's third
   * record family (`map/sessions.txt`), beside the references and the ask
   * cards. A session card names ONE tool row and holds that row's run; it has
   * no reading, no note, no anchor and no conversation of its own.
   */
  sessions: readonly SessionCard[];
  /**
   * Each session card's TRANSCRIPT, keyed by slug — `map/sessions/<slug>.jsonl`,
   * one progress entry per line in ARRIVAL order (append-only). An absent file
   * is no entries (a card made but never run), never an invented one.
   */
  sessionEntries: Readonly<Record<string, readonly SessionEntry[]>>;
  /** Unreadable `map/sessions.txt` lines, preserved and surfaced. */
  malformedSessions: readonly string[];
  /**
   * STORY 18.5 — transcript files whose session card is gone: kept in
   * `map/sessions/`, named in the ground notices group and in the mirror's
   * unknowns, never adopted and never deleted (the notes' and the ask
   * conversations' rule, one family over). Computed from the load's listing and
   * every write that can make one.
   */
  orphanSessionTranscripts: readonly string[];
  /**
   * STORY 18.3 — the session cards with a LIVE run right now. VIEW STATE, never
   * a record: the handle lives in the hook and the slug leaves this list when
   * the run settles, so the card's stop verb (and its one running sentence) can
   * never outlive the run.
   */
  sessionRunning: readonly string[];
  /**
   * STORY 18.4 — each session card's PENDING permission ask, keyed by slug.
   * VIEW STATE, never a record: it is filled by the `run-permission` line as
   * it arrives and dropped the moment it is answered (or the run settles). The
   * card shows what the tool wants and its two verbs from here; nothing in the
   * map folder holds a pending request.
   */
  sessionPermission: Readonly<Record<string, AcpPermissionAsk>>;
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
   * STORY 17.8 — the ONE pending ask-card deletion the toast can put back,
   * with the record line's position and the conversation's exact bytes read
   * before the unlink. ONE toast for both kinds: a second delete of EITHER
   * kind commits the first.
   */
  restorableAsk: RemovedAsk | null;
  /**
   * STORY 18.5 — the ONE pending session-card deletion the toast can put back,
   * with the record line's position and the transcript's exact bytes read
   * before the unlink. ONE toast for all three kinds: a delete of any kind
   * commits the earlier one.
   */
  restorableSession: RemovedSession | null;
  /**
   * STORY 16.13 — one sentence when a restore only partly came back. It rides
   * the toast in place of the Restore verb; a full restore leaves it null.
   */
  restoreNotice: string | null;
  /** The map folder's ground records have been read once. */
  loaded: boolean;
  /**
   * STORY 17.1 — MAKE AN ASK CARD beside a reference. STORY 17.10 rewrites what
   * that means, per the user's correction: the card is created EMPTY (no
   * anchor, nothing from the press but the point) and the SOURCE IS WIRED INTO
   * IT (17.9's mechanism). So `ask about this` and the bubble's ASK door reach
   * the same result by two roads. One queued step writes the ask line and the
   * wire; a blank name refuses before anything is queued and the source card's
   * files are never touched. The shared slug space mints the new slug.
   */
  createAsk: (
    sourceSlug: string,
    name: string,
    x: number,
    y: number,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 17.10 — MAKE AN EMPTY ASK CARD at the point the person double-clicked
   * (the bubble's ASK door): no source, no wire, no anchor — nothing from the
   * press but the point. The card names itself from its first question's short
   * form and the person can rename it.
   */
  createEmptyAsk: (
    name: string,
    x: number,
    y: number,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 16.19 — THE ASK A SELECTION MAKES: an empty peer ask card beside the
   * source, wired to it, with the chosen words carried on its line as one more
   * context kind. The user corrected the intent (16.12's copied card was deleted
   * in 16.18): the selection is CONTEXT, so the source card is never written and
   * the words are never a card. `created` is the new slug, for the layer to open
   * and hand the question to.
   */
  askFromSelection: (
    sourceSlug: string,
    words: string,
    question: string,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 17.10 — RENAME one ask card: the name changes, the slug (identity,
   * wire target, conversation file) does not. The anchor is legacy display and
   * is never written here.
   */
  renameAskTo: (slug: string, name: string) => Promise<GroundAddResult>;
  /**
   * STORY 17.1 — ASK ONE QUESTION inside an ask card: the existing card-ask
   * turn path (the packet anchored on the reference, the person's question),
   * and then ONE append-only write of the exchange — the person's line always,
   * the answer line only when the turn answered. Stories 17.4 and 17.8 add the
   * records beside it: ONE PRISM for the sending turn, then the words, then the
   * history's `ask.turn` line with the PRISM's own ending. The reference card
   * is never touched, and a turn adds nothing to MAP.md.
   */
  askTurn: (
    slug: string,
    question: string,
    onPart?: (text: string) => void,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 17.2 — STOP the running ask turn: the existing turn port's stop, so
   * the card's one stop verb is the same stop the Ask Move uses. VIEW
   * STATE only; what arrived is kept by the card, marked a partial, and the
   * record still writes the person's line and no answer line.
   */
  askStop: () => Promise<void>;
  /**
   * STORY 17.5 — FORK one ask card at a turn: ONE `map/asks.txt` line with
   * `from`/`carry` naming the branch point. The parent's conversation file is
   * READ (never written, never copied); a parent that is not on the map refuses
   * with one sentence and writes nothing. The new slug rides back on the result
   * so the layer can open it. STORY 17.10: no anchor is inherited — a fork is a
   * peer card, and its context arrives by wire.
   */
  forkAskAt: (
    parentSlug: string,
    carry: number,
    name: string,
    x: number,
    y: number,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 16.22 — RENAME one session card: the name changes, the slug (the
   * transcript's file name and a wire's endpoint) does not, and the transcript
   * is never touched. A blank field stores "Untitled session", and one
   * `card.rename` history line names both names.
   */
  renameSessionTo: (slug: string, name: string) => Promise<GroundAddResult>;
  /**
   * STORY 16.23 — MOVE one ask card to its dropped point: ONE queued write of
   * `map/asks.txt`, one line's `x|y`, through the SAME queue the reference
   * cards' drop uses. The name, the anchor, a fork's fields and the chosen words
   * are untouched, and the conversation is never read. A card that is gone
   * writes NOTHING. STORY 16.24 — the drop appends the SAME `card.move` a
   * reference's drop has appended since 16.10, after the record write, and a
   * drop that rounds back onto the card's own point appends none. No mirror
   * rewrite: MAP.md never printed a point.
   */
  moveAsk: (slug: string, x: number, y: number) => Promise<GroundAddResult>;
  /**
   * STORY 16.23 — MOVE one session card to its dropped point: the same one
   * queued write of `map/sessions.txt`, one line's `x|y`. The name, the tool
   * row and the transcript are untouched, and a card that is gone writes
   * nothing. STORY 16.24 — the move logs the shared `card.move` exactly as the
   * ask and reference paths do, and a no-op drop logs none. No mirror rewrite:
   * a transcript's name is not its point.
   */
  moveSession: (slug: string, x: number, y: number) => Promise<GroundAddResult>;
  /**
   * STORY 17.8 — REMOVE one ask card, immediately and reversibly: the record
   * line and the conversation's BYTES are read first, the `asks.txt` line is
   * written without it, and the conversation file is unlinked. The toast's
   * Restore writes the same bytes back (folder comparison). A refused unlink
   * answers one sentence after the line has gone, and the orphan conversation
   * is SAID, never adopted and never deleted.
   */
  removeAsk: (slug: string) => Promise<GroundAddResult>;
  /**
   * STORY 18.5 — REMOVE one session card, immediately and reversibly: the
   * record line and the transcript's BYTES are read first, the `sessions.txt`
   * line is written without it, and the transcript file is unlinked. The
   * toast's Restore writes the same bytes back (folder comparison). A refused
   * unlink answers one sentence after the line has gone, and the orphan
   * transcript is SAID, never adopted and never deleted.
   */
  removeSession: (slug: string) => Promise<GroundAddResult>;
  /**
   * STORY 18.3 — MAKE A SESSION CARD at a point: ONE `map/sessions.txt` line
   * binding a name, a point and ONE tool row (by id — never a key, never a
   * command). No reading, no note, no media and no transcript: a card that has
   * never run has nothing to say yet. A blank name or a row this build does not
   * ship refuses with one sentence before anything is queued.
   */
  createSession: (
    name: string,
    tool: string,
    x: number,
    y: number,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 18.3 — BIND one session card to another tool row: ONE field's change
   * (the record's `tool`), so a card whose row is gone can run again. A card
   * already running refuses, and a row this build does not ship is not bound.
   */
  bindSessionTool: (slug: string, tool: string) => Promise<GroundAddResult>;
  /**
   * STORY 18.3 — RUN one session card: the row's 18.2 lifecycle, with every
   * progress entry appended to the transcript as it arrives. ONE RUN PER CARD:
   * a second press answers one sentence. A card whose row is gone answers one
   * sentence and starts nothing (the card offers the choice again).
   */
  runSession: (slug: string) => Promise<GroundAddResult>;
  /**
   * STORY 18.3 — STOP the live run: the run's own cancel (session/cancel, then
   * the child), so what arrived stays and the ending is the run's own. A press
   * with nothing running does nothing at all.
   */
  stopSession: (slug: string) => Promise<void>;
  /**
   * STORY 18.4 — ANSWER the pending permission ask with the person's ONE verb.
   * `allow-once` can only become the protocol's allow_once option; there is no
   * always path here or on the wire. The sidecar answers the server; this only
   * forwards the press.
   */
  answerSessionPermission: (
    slug: string,
    choice: AcpPermissionChoice,
  ) => Promise<void>;
  /**
   * STORY 18.4 — MAKE A CARD OUT OF THE LAST COMPLETED RUN'S TEXT: a COPY, in
   * the existing selection form (`from: card://<session-slug>`), placed beside
   * the session card. No text means one sentence and nothing written.
   */
  makeCardFromRun: (slug: string) => Promise<GroundAddResult>;
  /** Add one reference from a picked text file (the one create write). */
  create: (
    name: string,
    x: number,
    y: number,
    from: string,
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
  /**
   * STORY 16.21 — RENAME one reference from its name pill: the name changes on
   * one `ground.txt` line and the slug (identity: the reading's key, a link's
   * endpoint, an ask's anchor) does not move. An empty field is a legal name
   * and stores "Untitled reference".
   */
  rename: (on: string, name: string) => Promise<GroundAddResult>;
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
  | "forkAskAt"
  | "createEmptyAsk"
  | "askFromSelection"
  | "renameAskTo"
  | "renameSessionTo"
  | "moveAsk"
  | "moveSession"
  | "removeAsk"
  | "removeSession"
  | "createSession"
  | "bindSessionTool"
  | "runSession"
  | "stopSession"
  | "answerSessionPermission"
  | "makeCardFromRun"
  | "create"
  | "createPage"
  | "createVideo"
  | "move"
  | "rename"
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
  orphanAskTurns: [],
  sessions: [],
  sessionEntries: {},
  malformedSessions: [],
  orphanSessionTranscripts: [],
  sessionRunning: [],
  sessionPermission: {},
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
  restorableAsk: null,
  restorableSession: null,
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

/** The bridge a rename needs: the ground family's one writer. */
export interface GroundRenameIo {
  saveGround: typeof saveGround;
}

/** The real bridge, bound once so this module stays importable in tests. */
const GROUND_RENAME_IO: GroundRenameIo = { saveGround };

/** What one rename wrote: the new list and the line it changed (null if gone). */
export interface GroundRename {
  references: GroundReference[];
  renamed: GroundReference | null;
}

/**
 * STORY 16.21 — THE RENAME'S ONE WRITE. The name pill doubles as the card's
 * rename field, and this is the single path that field reaches: the SAME
 * `map/ground.txt` read-modify-write the move and the delete use, through the
 * same write queue, on ONE line. The slug, the point, the reading, the note and
 * every link stay exactly as they were (identity is the slug, not the name), so
 * a rename can never orphan anything. Malformed lines ride back untouched
 * (ADR-0009). An empty field is stored as the untitled sentence by the record's
 * own rule. PURE apart from the bridge it is handed, so a test asserts the
 * bytes without the hook.
 */
export async function renameGroundRecords(
  workspacePath: string,
  on: string,
  name: string,
  references: readonly GroundReference[],
  malformedGround: readonly string[],
  io: GroundRenameIo = GROUND_RENAME_IO,
): Promise<GroundRename> {
  const next = withGroundRenamed(references, on, name);
  await io.saveGround(workspacePath, next, malformedGround);
  return {
    references: next,
    renamed: next.find((reference) => reference.on === on) ?? null,
  };
}

/**
 * STORY 16.23 — A MOVE'S ONE WRITE, one family at a time. The drag's drop
 * reaches the same per-file read-modify-write every other move uses, through
 * the same write queue, and rewrites exactly ONE line: the dragged card's
 * `x|y`. It is the ask card's version of `renameGroundRecords` above (and the
 * session card's is its twin below), so the two new movers can never drift
 * apart from the reference's shape.
 *
 * A card that is GONE answers `moved: null` and the bridge is NEVER CALLED:
 * a drag that ended after its card left writes nothing, not the file back
 * unchanged. Malformed lines ride back untouched (ADR-0009).
 *
 * NO LOG LINE HERE and no mirror rewrite: this is one record's write, not
 * the log's. STORY 16.24 — the hook's move verb queues the shared `card.move`
 * after this returns, and MAP.md never printed a point, so there is nothing
 * derived to bring up to date.
 */
export interface GroundAskMoveIo {
  saveAsks: typeof saveAsks;
}

/** The real bridge, bound once so this module stays importable in tests. */
const GROUND_ASK_MOVE_IO: GroundAskMoveIo = { saveAsks };

/** What one ask move wrote: the new list and the moved card (null if gone). */
export interface GroundAskMove {
  asks: AskCard[];
  moved: AskCard | null;
}

export async function moveAskRecords(
  workspacePath: string,
  slug: string,
  x: number,
  y: number,
  asks: readonly AskCard[],
  malformedAsks: readonly string[],
  io: GroundAskMoveIo = GROUND_ASK_MOVE_IO,
): Promise<GroundAskMove> {
  const next = withAskMoved(asks, slug, x, y);
  // A card that is gone is not a write: the file is not touched at all.
  if (next === null) return { asks: [...asks], moved: null };
  await io.saveAsks(workspacePath, next, malformedAsks);
  return {
    asks: next,
    moved: next.find((ask) => ask.on === slug) ?? null,
  };
}

/** The session card's twin: the same one-line write, its own family's file. */
export interface GroundSessionMoveIo {
  saveSessions: typeof saveSessions;
}

/** The real bridge, bound once so this module stays importable in tests. */
const GROUND_SESSION_MOVE_IO: GroundSessionMoveIo = { saveSessions };

/** What one session move wrote: the new list and the moved card (null if gone). */
export interface GroundSessionMove {
  sessions: SessionCard[];
  moved: SessionCard | null;
}

export async function moveSessionRecords(
  workspacePath: string,
  slug: string,
  x: number,
  y: number,
  sessions: readonly SessionCard[],
  malformedSessions: readonly string[],
  io: GroundSessionMoveIo = GROUND_SESSION_MOVE_IO,
): Promise<GroundSessionMove> {
  const next = withSessionMoved(sessions, slug, x, y);
  // The transcript is not read, not written and not re-laid: a point is not a
  // run, and a card that is gone writes nothing at all.
  if (next === null) return { sessions: [...sessions], moved: null };
  await io.saveSessions(workspacePath, next, malformedSessions);
  return {
    sessions: next,
    moved: next.find((session) => session.on === slug) ?? null,
  };
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

/**
 * One pending restore can exist; a second delete COMMITS the first. Generic
 * because the toast now holds TWO kinds of deletion (a reference card and, from
 * story 17.8, an ask card) and exactly one of them at a time.
 */
export function pendingRestoreAfter<T>(
  previous: T | null,
  next: T | null,
): T | null {
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

/* ------------------------------------------------------------------------- *
 * STORY 17.8 — REMOVING AN ASK CARD, and putting it back.
 *
 * The same promise every other card makes (story 16.13): the delete is
 * IMMEDIATE, and the toast's Restore writes the SAME BYTES back. What a delete
 * keeps in memory is the record line (as the card, with its file position) and
 * the CONVERSATION'S BYTES, read BEFORE any write or unlink — so a restore is
 * a byte-identical folder, never a re-serialization of what was said.
 *
 * NOT ONE WORD LEAVES the card's files here: the bytes are read into memory and
 * written back verbatim; nothing is parsed, trimmed, previewed or logged. The
 * history line beside the move names the slug only.
 * ------------------------------------------------------------------------- */

/** What an ask-card delete keeps in memory, so Restore can put it back. */
export interface RemovedAsk {
  ask: AskCard;
  /** Where the line sat in `asks.txt`'s file order. */
  askIndex: number;
  /**
   * The conversation file's bytes, read before its unlink; null when the card
   * had no conversation (a card made but never asked in — a quiet absence, not
   * an invented empty file).
   */
  conversation: string | null;
}

/** The bridges an ask-card delete needs; a test passes its own fakes. */
export interface AskRemovalIo {
  saveAsks: typeof saveAsks;
  readTextFile: (path: string) => Promise<string | null>;
  removeFile: (path: string) => Promise<void>;
}

const ASK_REMOVAL_IO: AskRemovalIo = {
  saveAsks,
  readTextFile: fsReadTextFile,
  removeFile,
};

/** What deleting one ask card left: the next lines, the held bytes, a sentence. */
export interface AskRemoval {
  asks: AskCard[];
  /** The card and its conversation as they were; null if it was not on the map. */
  removed: RemovedAsk | null;
  /**
   * One sentence when the conversation file could not be unlinked; null when
   * it went. The line is already gone either way — one sentence, never a
   * repair, and the leftover file is an ORPHAN the notices group names.
   */
  refusal: string | null;
}

/** The one sentence a refused conversation unlink answers (PROVISIONAL). */
export const ASK_CONVERSATION_REMOVAL_REFUSAL =
  "the ask card was removed, but its conversation file could not be removed.";

/**
 * THE ASK DELETE'S ONE SEQUENCE, pure apart from the bridges:
 *
 *   1. READ the conversation's bytes and the line's position (before anything);
 *   2. write `asks.txt` without the card — the record is the truth;
 *   3. unlink the conversation file; a refusal answers one sentence and leaves
 *      the file exactly where it is (an orphan, reported, never deleted twice).
 */
export async function removeAskRecords(
  workspacePath: string,
  slug: string,
  asks: readonly AskCard[],
  malformedAsks: readonly string[],
  io: AskRemovalIo = ASK_REMOVAL_IO,
): Promise<AskRemoval> {
  const askIndex = asks.findIndex((ask) => ask.on === slug);
  const ask = askIndex >= 0 ? asks[askIndex] ?? null : null;
  let conversation: string | null = null;
  try {
    conversation = await io.readTextFile(askTurnPath(workspacePath, slug));
  } catch {
    conversation = null;
  }
  const next = withoutAsk(asks, slug);
  await io.saveAsks(workspacePath, next, malformedAsks);
  let refusal: string | null = null;
  try {
    await io.removeFile(askTurnPath(workspacePath, slug));
  } catch {
    refusal = ASK_CONVERSATION_REMOVAL_REFUSAL;
  }
  return {
    asks: next,
    removed:
      ask === null
        ? null
        : { ask, askIndex, conversation },
    refusal,
  };
}

/** The bridges an ask-card restore needs; a test passes its own fakes. */
export interface AskRestoreIo {
  saveAsks: typeof saveAsks;
  restoreConversation: typeof restoreConversation;
}

const ASK_RESTORE_IO: AskRestoreIo = {
  saveAsks,
  restoreConversation,
};

/** What putting an ask card back did: the next lines, what came back and what did not. */
export interface AskRestoreResult {
  asks: AskCard[];
  /** True when the card's own `asks.txt` line went back. */
  restoredAsk: boolean;
  cameBack: readonly string[];
  didNot: readonly string[];
  /** One sentence when a write failed; null when everything came back. */
  refusal: string | null;
}

/**
 * STORY 17.8 — PUT AN ASK CARD BACK, SAME BYTES, in the house order:
 *
 *   1. the conversation file (exactly the bytes read before its unlink);
 *   2. the `asks.txt` line, at its old file position — last, so a crash can
 *      never leave a card whose conversation is missing.
 *
 * Every write is attempted even after an earlier one fails, so the one sentence
 * can name BOTH what came back and what did not. A card with no conversation
 * restores none and invents nothing.
 */
export async function restoreAskCard(
  workspacePath: string,
  removed: RemovedAsk,
  asks: readonly AskCard[],
  malformedAsks: readonly string[],
  io: AskRestoreIo = ASK_RESTORE_IO,
): Promise<AskRestoreResult> {
  const cameBack: string[] = [];
  const didNot: string[] = [];
  let nextAsks = [...asks];

  // 1. the conversation, byte for byte.
  if (removed.conversation !== null) {
    try {
      await io.restoreConversation(
        workspacePath,
        removed.ask.on,
        removed.conversation,
      );
      cameBack.push("the conversation");
    } catch {
      didNot.push("the conversation");
    }
  }
  // 2. the record line, back where it sat.
  const candidate = insertAskAt(nextAsks, removed.askIndex, removed.ask);
  let restoredAsk = false;
  try {
    await io.saveAsks(workspacePath, candidate, malformedAsks);
    nextAsks = candidate;
    restoredAsk = true;
    cameBack.push("the ask card");
  } catch {
    didNot.push("the ask card");
  }

  return {
    asks: nextAsks,
    restoredAsk,
    cameBack,
    didNot,
    refusal: restoreSentence(cameBack, didNot),
  };
}

/**
 * STORY 17.8 — THE TURN'S HISTORY LINE, from the SAME fact the PRISM records.
 * A sending turn's ending becomes the PRISM's round trip (let the turn send),
 * the card's sentence (what happened) and this log line, all through ONE
 * mapping; `askTurn`'s ending is therefore the PRISM's outcome by
 * construction. A turn that never left the app appended no PRISM and gets no
 * line here — null, never a line that disagrees.
 */
export function askTurnHistoryEvent(
  t: number,
  slug: string,
  ending: AskEnding,
  prism: Prism | null,
): HistoryEvent | null {
  if (prism === null) return null;
  const outcome: AskTurnEnding = askOutcomeOf(ending);
  return askTurnEvent(t, slug, outcome);
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
 * MAKE A CARD OUT OF A SELECTION, in the house order. STORY 16.12 wrote this
 * for the selection→card verb; STORY 18 removes that verb (the user corrected
 * the intent) but KEEPS the writer, because the reading form stays legal and
 * story 18.4's run-result card is one. What is written is:
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
 * STORY 17.11 — A COMPLETED ASK TURN'S REPLY BECOMES A CARD (ADR-0037's
 * first artifact, the rule-based one).
 *
 * 17.12 PUTS THE CURATOR IN THIS SEAT (ADR-0037 decision 4). The same writer
 * makes the artifact the same way — text, readings line, ground line, wire —
 * but its text is now the distilled card the manager model wrote from the
 * task model's reply. 17.11's rule copy remains the writer's no-authors path,
 * so a card a rule made still says a rule made it and no wording had to be
 * thrown away when the second model arrived.
 *
 * ONE CARD PER COMPLETED TURN, never per send: a stopped, failed, timed-out or
 * empty turn writes NOTHING and the ask card says so in one line. A rerun is a
 * completed turn like any other, so it makes another card; the existing
 * remove/restore path makes an unwanted one one press away.
 *
 * THE REPLY IS NEVER MOVED OR MODIFIED. The ask card keeps it; this card is a
 * COPY whose reading text is the reply's exact bytes.
 * ------------------------------------------------------------------------- */

/** The one line an ask card gets when no card was made (PROVISIONAL wording). */
export const ASK_NO_CARD_SENTENCE = "no card was made";

/**
 * STORY 17.12 — HOW A MODEL IS NAMED IN PROVENANCE: the name its settings row
 * shows (the person's own label), falling back to the id when it has none. A
 * pipe would split the reading line's tail, so it is replaced with a slash —
 * the record stays parsable and the person still reads the row they chose.
 */
export function modelAuthorName(name: string, id: string): string {
  const shown = name.trim() === "" ? id.trim() : name.trim();
  return shown.split("|").join("/");
}

/**
 * STORY 17.12 — THE FAILURE ASYMMETRY (ADR-0037 decision 8): the task answered
 * and the curator did not, so the REPLY STANDS and one sentence says the card
 * was not made. It is never written as an error on the answer: the answer is
 * still the answer.
 */
export const ASK_CURATOR_FAILED_SENTENCE =
  "the reply stands, but no card was made: the curator did not answer.";

/** The one line a completed reply gets when its card could not be written. */
export const ASK_CARD_WRITE_REFUSAL =
  "the reply came back, but its card could not be written.";

/**
 * WOULD THIS TURN MAKE A CARD? PURE, so the rule is not the hook's only truth:
 * only a turn that ANSWERED and carried text makes one. Everything else — a
 * stop, a break, the budget, an empty reply — makes NO card and answers the
 * one line. ADR-0037 decision 8: the reply still stands in the ask card.
 */
export function askTurnCardNote(sent: AskTurnSend): string | null {
  if (sent.ending !== "answered") return ASK_NO_CARD_SENTENCE;
  if (sent.result.kind !== "answer") return ASK_NO_CARD_SENTENCE;
  if (sent.result.text === "") return ASK_NO_CARD_SENTENCE;
  // STORY 17.12 — THE CURATOR OWNS THE CARD NOW. A caller that predates it (a
  // pure test, an old surface) still falls back to 17.11's rule copy by
  // returning null with no curator facts. Otherwise the parse decides: a card
  // makes one, a DECLINE is legal and says its sentence, a malformed block or
  // a failed call says one sentence and makes none (ADR-0037 decisions 7-8).
  const curator = sent.curator;
  if (curator === undefined) return null;
  if (curator.read === null) {
    return curator.sentence ?? ASK_CURATOR_FAILED_SENTENCE;
  }
  if (curator.read.kind === "card") return null;
  return curator.read.sentence;
}

/** The bridges a distilled card needs; a test passes its own fakes. */
export interface DistilledIo extends SelectionIo {
  storeDistilledText: typeof storeDistilledText;
  saveGroundLinks: typeof saveGroundLinks;
}

/** The real bridges, bound once so the hook's path is the tested one. */
const DISTILLED_IO: DistilledIo = {
  ...SELECTION_IO,
  storeDistilledText,
  saveGroundLinks,
};

/** What copying a reply into a card produced, or why it wrote nothing. */
export type AskDistilledCard =
  | {
      kind: "written";
      records: SelectionRecords;
      /** The new card's own ground line (its slug, name and point). */
      reference: GroundReference;
      /** Every link the file now holds, the new wire included. */
      links: GroundLink[];
      /** The reply bytes, exactly as stored. */
      text: string;
    }
  | { kind: "refused"; message: string };

/**
 * STORY 17.15 — THE ARTIFACTS ALREADY MADE FROM ONE CARD, as the points the
 * next one cascades past. A distilled reading names its source; those cards are
 * the column. PURE, so the placement rule reads the same records the map draws
 * and nothing has to remember where the last artifact went.
 */
export function artifactsMadeFrom(
  sourceSlug: string,
  references: readonly GroundReference[],
  readings: readonly Reading[],
): Point[] {
  const made = new Set(
    readings
      .filter((reading) => distilledSourceSlug(reading) === sourceSlug)
      .map((reading) => reading.on),
  );
  return references
    .filter((reference) => made.has(reference.on))
    .map((reference) => ({ x: reference.x, y: reference.y }));
}

/**
 * WRITE ONE DISTILLED CARD, in the house order:
 *
 *   1. the reply's text file FIRST (`map/readings/<new-slug>.md`, VERBATIM);
 *   2. the readings line NEXT (`form: distilled | from: card://<ask-slug>`);
 *   3. the ground line LAST;
 *   4. the WIRE after the card exists, ask card → new card, so the map shows
 *      where the artifact came from and a wire can never name a card that is
 *      not there.
 *
 * Nothing is stat'ed, capped or normalized: the bytes are handed in whole by
 * the caller (the curator's distilled text, or 17.11's verbatim reply copy).
 * The caller has already decided this turn completed; an empty text still
 * refuses here so no caller can invent a blank
 * card. PURE apart from the bridges it is handed. ADR-0037: the artifact's
 * shape is one; its author is the optional pair on the reading.
 */
export async function writeDistilledCard(
  workspacePath: string,
  references: readonly GroundReference[],
  readings: readonly Reading[],
  links: readonly GroundLink[],
  malformedGround: readonly string[],
  malformedReadings: readonly string[],
  malformedLinks: readonly string[],
  askSlug: string,
  name: string,
  x: number,
  y: number,
  text: string,
  taken: string,
  io: DistilledIo = DISTILLED_IO,
  /** The shared slug set (ground + asks + sessions), as every new card mints. */
  options: { taken?: ReadonlySet<string> } = {},
  /**
   * STORY 17.12 — THE TWO MODELS when a CURATOR made this card: the manager
   * that distilled and the task whose reply it read. Absent is 17.11's rule
   * copy, unchanged, so the same writer serves both and neither wording can
   * drift into a claim it cannot support (ADR-0037 decision 4).
   */
  authors?: { manager: string; task: string },
): Promise<AskDistilledCard> {
  if (text === "") return { kind: "refused", message: ASK_NO_CARD_SENTENCE };
  const addition = addGroundReference(references, name.trim(), x, y, options.taken);
  const reading = distilledReading(
    addition.reference.on,
    askSlug,
    taken,
    authors,
  );
  await io.storeDistilledText(workspacePath, reading.on, text);
  const nextReadings = withReading(readings, reading);
  await io.saveReadings(workspacePath, nextReadings, malformedReadings);
  await io.saveGround(workspacePath, addition.references, malformedGround);
  const nextLinks = addGroundLink(links, askSlug, reading.on);
  await io.saveGroundLinks(workspacePath, nextLinks, malformedLinks);
  return {
    kind: "written",
    records: {
      references: addition.references,
      readings: nextReadings,
      reading,
    },
    reference: addition.reference,
    links: nextLinks,
    text,
  };
}

/* ------------------------------------------------------------------------- *
 * STORY 18.4 — A FINISHED RUN'S RESULT BECOMES A CARD.
 *
 * THE RESULT IS A COPY, NOT A LINK. What is written is exactly the run's text
 * entries, in order, joined (see `sessionRunResult`: the empty string, because
 * the transcript's chunks are verbatim and contiguous). It lands in the
 * EXISTING selection form — `form: selection`, `from: card://<session-slug>`,
 * the text as the reading — so links, mentions, asks, the pull and the mirror
 * treat it as any other card. Nothing behind it is read, stat'ed or re-taken:
 * editing the session card or its transcript later cannot change the copy.
 *
 * NO TEXT ⇒ ONE SENTENCE AND NOTHING WRITTEN. A last run that did not complete
 * has no result at all, even when a partial arrived: a partial is never a
 * result. Only a completed run's words can become a card.
 * ------------------------------------------------------------------------- */

/** What making the result card produced, or why it wrote nothing. */
export type RunResultCard =
  | { kind: "written"; records: SelectionRecords; text: string }
  | { kind: "refused"; message: string };

/**
 * WRITE THE RESULT CARD, in the selection form's house order: the excerpt's
 * text FIRST, its reading line NEXT, the ground line LAST — the same three
 * writes every selection card makes, because this IS one. PURE apart from the
 * bridges it is handed; the caller has already loaded the transcript.
 */
export async function writeResultCard(
  workspacePath: string,
  references: readonly GroundReference[],
  readings: readonly Reading[],
  malformedGround: readonly string[],
  malformedReadings: readonly string[],
  session: SessionCard,
  entries: readonly SessionEntry[],
  taken: string,
  io: SelectionIo = SELECTION_IO,
  options: { taken?: ReadonlySet<string> } = {},
): Promise<RunResultCard> {
  const result = sessionRunResult(entries);
  if (result.ending === null) {
    return { kind: "refused", message: SESSION_RESULT_EMPTY_SENTENCE };
  }
  if (result.ending !== "completed") {
    return { kind: "refused", message: SESSION_RESULT_UNFINISHED_SENTENCE };
  }
  if (result.text === "") {
    return { kind: "refused", message: SESSION_RESULT_EMPTY_SENTENCE };
  }
  const at = besidePlacement(session.x, session.y);
  const records = await writeSelectionCard(
    workspacePath,
    references,
    readings,
    malformedGround,
    malformedReadings,
    session.on,
    sessionResultName(session.name),
    at.x,
    at.y,
    result.text,
    taken,
    io,
    options,
  );
  return { kind: "written", records, text: result.text };
}

/* ------------------------------------------------------------------------- *
 * STORY 17.1 — THE ASK CARD'S RECORD: one `map/asks.txt` line, and one
 * append-only conversation write.
 *
 * The creation is the ground add's shape with NOTHING in place of a reading:
 * STORY 17.10 makes an ask a PEER card, born EMPTY (no anchor, no theme,
 * nothing from the press but the point), so ONE queued step writes the ask line
 * and — for the reference verb — the wire from the source (17.9's mechanism).
 * No reading text, no note, no media and no touch of the reference card. The
 * shared slug space (all three files) mints the slug, so a link, a mention or a
 * legacy anchor can always resolve to exactly one card.
 *
 * The turn is the existing card-ask path's: the app sends the packet built from
 * the cards WIRED INTO this one (17.9), and only what CAME BACK is written
 * here. The person's line is always appended; the answer line only when the
 * turn actually answered. A
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
 * the slug minted against ALL THREE slugs families (the ground references, the
 * asks already on the map, the session cards). A blank name is the caller's
 * refusal (it never reaches here).
 *
 * STORY 17.10 — THE CARD IS BORN EMPTY. The user's correction: the double-click
 * bubble's ASK door makes a PEER card, so creation takes nothing from the click
 * but the point — no anchor, no theme, no source read, no reference touched.
 * The reference verb buys the SAME result by creating this card and then WIRING
 * its source into it (17.9's mechanism, one queue step later). PURE apart from
 * the bridge it is handed.
 */
export async function writeAskCard(
  workspacePath: string,
  references: readonly GroundReference[],
  asks: readonly AskCard[],
  malformedAsks: readonly string[],
  name: string,
  x: number,
  y: number,
  io: AskCardIo = ASK_CARD_IO,
  /**
   * STORY 18.3: the THIRD family in the shared slug space. Optional and last so
   * an older caller (and an older test) keeps the two-family reading; the hook
   * always passes all three.
   */
  sessions: readonly SessionCard[] = [],
): Promise<AskCardRecords> {
  const addition = addAsk(
    asks,
    sharedSlugs(references, asks, sessions),
    name.trim(),
    x,
    y,
  );
  await io.saveAsks(workspacePath, addition.asks, malformedAsks);
  return { asks: addition.asks, ask: addition.ask };
}

/**
 * STORY 16.19 — THE BRIDGES AN ASK MADE FROM A SELECTION WRITES THROUGH. Two
 * records, in the SAME order every ask creation uses: the ask line first, the
 * wire second (so the wire can never point at a card that is not there).
 */
export interface SelectionAskIo {
  saveAsks: typeof saveAsks;
  saveGroundLinks: typeof saveGroundLinks;
}

/** The real bridges, bound once so the hook's path is the tested one. */
const SELECTION_ASK_IO: SelectionAskIo = { saveAsks, saveGroundLinks };

/** What making an ask from a selection produced: the lines and the new card. */
export interface SelectionAskRecords {
  asks: AskCard[];
  ask: AskCard;
  links: GroundLink[];
}

/**
 * STORY 16.19 — MAKE THE ASK CARD A SELECTION ASKS FOR. The user's correction:
 * selecting text in a reading opens a question widget, and what it makes is an
 * ASK CARD — the one record family an ask always is — never a copy of the
 * source's text (16.12's copied card was deleted in 16.18).
 *
 * The card is BORN EMPTY in 17.10's shape: no anchor, nothing from the press but
 * its point (the caller's beside-the-source placement), the "Untitled ask"
 * sentinel that the first question's short form replaces. TWO records are
 * written, in the house order:
 *
 *   1. the ask line, carrying the chosen words and their source slug (the one
 *      context kind a wire alone cannot say);
 *   2. the wire FROM the source card INTO the new card — 17.9's mechanism, so
 *      the card's context is the source's own reading as well.
 *
 * The SOURCE CARD IS NEVER WRITTEN: this function reads no field of it, writes
 * no record it names and touches no reading, note or media. And nothing is read
 * from disk here — the words are the person's selection, already collapsed by
 * `selectionWords`, and they are stored verbatim apart from that collapse.
 *
 * A source the map does not carry answers null (the caller's one sentence); a
 * selection with no words never reaches here (the refusal runs first, PURE).
 * PURE apart from the bridges it is handed.
 */
export async function writeSelectionAsk(
  workspacePath: string,
  references: readonly GroundReference[],
  asks: readonly AskCard[],
  malformedAsks: readonly string[],
  links: readonly GroundLink[],
  malformedLinks: readonly string[],
  sourceSlug: string,
  words: string,
  name: string,
  x: number,
  y: number,
  /** STORY 18.3's third family, so a selection ask cannot twin a session. */
  sessions: readonly SessionCard[] = [],
  io: SelectionAskIo = SELECTION_ASK_IO,
): Promise<SelectionAskRecords | null> {
  if (!references.some((reference) => reference.on === sourceSlug)) return null;
  const collapsed = selectionWords(words);
  if (collapsed === null) return null;
  // The slug is minted against ALL THREE families, exactly as every ask card is.
  const addition = addAsk(
    asks,
    sharedSlugs(references, asks, sessions),
    name.trim(),
    x,
    y,
    { from: sourceSlug, words: collapsed },
  );
  await io.saveAsks(workspacePath, addition.asks, malformedAsks);
  const nextLinks = addGroundLink(links, sourceSlug, addition.ask.on);
  await io.saveGroundLinks(workspacePath, nextLinks, malformedLinks);
  return { asks: addition.asks, ask: addition.ask, links: nextLinks };
}

/** The bridges an ask turn's record write needs; a test passes its own fakes. */
export interface AskTurnIo {
  appendExchange: typeof appendExchange;
}

/**
 * STORY 17.5 — WRITE ONE FORK, in the house order: the ask line only, with the
 * parent's anchor inherited and the branch point recorded as `from`/`carry`.
 * The parent's conversation is never read here, never copied and never touched;
 * a parent the map does not carry answers `null` (the caller's one sentence,
 * written nowhere). PURE apart from the bridge it is handed.
 */
export async function writeForkAsk(
  workspacePath: string,
  references: readonly GroundReference[],
  asks: readonly AskCard[],
  malformedAsks: readonly string[],
  parentSlug: string,
  carry: number,
  name: string,
  x: number,
  y: number,
  io: AskCardIo = ASK_CARD_IO,
  /** STORY 18.3: the third family, as in `writeAskCard`. */
  sessions: readonly SessionCard[] = [],
): Promise<AskCardRecords | null> {
  const parent = asks.find((ask) => ask.on === parentSlug);
  if (parent === undefined) return null;
  // STORY 17.10: the fork is a peer card — no anchor is inherited or written
  // (the parent's own legacy anchor stays on the parent's line, display only).
  const addition = forkAsk(
    asks,
    sharedSlugs(references, asks, sessions),
    parent,
    carry,
    name.trim(),
    x,
    y,
  );
  await io.saveAsks(workspacePath, addition.asks, malformedAsks);
  return { asks: addition.asks, ask: addition.ask };
}

/**
 * STORY 17.5 — WHAT ONE ASK CARD READS, PURE: a fork's carried prefix read
 * from the PARENT'S OWN conversation, then the card's own turns. The parent is
 * looked up in the asks file, and a missing parent hands `null` to the fork
 * view so the card can state the hole without repairing it. The parent's
 * carried prefix is NOT resolved: one level, as map/asks.ts states.
 */
export function askThreadOf(
  ask: AskCard,
  asks: readonly AskCard[],
  askTurns: Readonly<Record<string, readonly AskTurn[]>>,
): AskForkThread {
  const parentTurns =
    ask.from === undefined
      ? null
      : asks.some((entry) => entry.on === ask.from)
        ? (askTurns[ask.from] ?? [])
        : null;
  return forkThread(ask, askTurns[ask.on] ?? [], parentTurns);
}

/**
 * STORY 17.6 — WHAT AN ASK CARD'S ANCHOR RESOLVES TO, PURE: the reference's
 * name while the map carries it, or "gone" with the name the record REMEMBERS.
 * The view never looks for a replacement card, never rewrites the anchor and
 * never merges asks: a gone anchor is a fact to state, not a hole to fill. A
 * card recorded before the name was remembered has `remembered: null` and the
 * card falls back to its generic line — nothing is invented.
 */
export interface AskAnchorView {
  /** The reference's live name, or null when the anchor is not on the map. */
  name: string | null;
  /** True exactly when the anchor does not resolve (the card says so). */
  gone: boolean;
  /** The name the record kept from when the anchor was last bound, or null. */
  remembered: string | null;
}

export function askAnchorOf(
  ask: AskCard,
  references: readonly GroundReference[],
): AskAnchorView {
  // STORY 17.10 — A CARD WITH NO ANCHOR IS NOT DANGLING. New asks are born
  // empty; an absent field means "never bound", so the card says what it is
  // ("a question") instead of accusing a card that never existed. The legacy
  // field, when present, still resolves or is stated as gone (17.6's rule).
  if (ask.anchor === undefined) {
    return { name: null, gone: false, remembered: null };
  }
  const reference =
    references.find((entry) => entry.on === ask.anchor) ?? null;
  return {
    name: reference === null ? null : reference.name,
    gone: reference === null,
    remembered: ask.anchorName ?? null,
  };
}

/**
 * THE CONTEXT'S WIRES (Epic 17 story 9, PURE): the cards whose link TARGETS
 * this ask card, in file order, deduped. The user's correction is the whole
 * rule: a card's context is what is wired INTO it, not a field on its record.
 * A wire whose source card is gone is DANGLING — reported here so the card can
 * SAY it, never repaired by inventing a card or deleting the line.
 */
export interface AskContextWires {
  /** Source slugs that resolve to a card, in wire-file order. */
  sources: string[];
  /** Source slugs whose card the map does not carry. */
  dangling: string[];
}

export function askContextSources(
  ask: string,
  links: readonly GroundLink[],
  known: Iterable<string>,
): AskContextWires {
  const knownSet = new Set(known);
  const sources: string[] = [];
  const dangling: string[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (link.to !== ask) continue;
    if (seen.has(link.from)) continue;
    seen.add(link.from);
    if (knownSet.has(link.from)) sources.push(link.from);
    else dangling.push(link.from);
  }
  return { sources, dangling };
}

/**
 * WHAT A WIRED ASK OR SESSION CARD SAYS when it has no finished words to lend
 * (story 17.9, PROVISIONAL wording). A wire is still a wire: the card rides,
 * and its block says this one line rather than pretending it contributed
 * nothing. A completed run that left no words says the last one.
 */
export const ASK_CONTEXT_NO_ANSWER =
  "no answer has finished in this card yet, so nothing rides with it.";
export const ASK_CONTEXT_NO_RUN =
  "no run has finished in this card yet, so nothing rides with it.";
export const ASK_CONTEXT_RUN_UNFINISHED =
  "the last run in this card did not finish, so nothing rides with it.";
export const ASK_CONTEXT_RUN_EMPTY =
  "the last run in this card finished without words, so nothing rides with it.";

/** What the resolver is handed: the loaded map, never a reader. */
export interface AskContextFactsInput {
  ask: string;
  links: readonly GroundLink[];
  references: readonly GroundReference[];
  asks: readonly AskCard[];
  askTurns: Readonly<Record<string, readonly AskTurn[]>>;
  sessions?: readonly SessionCard[];
  sessionEntries?: Readonly<Record<string, readonly SessionEntry[]>>;
  readings: readonly Reading[];
  texts: Readonly<Record<string, string>>;
  notes: Readonly<Record<string, string>>;
  states: Readonly<Record<string, ReadingState>>;
}

/** The wired cards' facts and the wires that dangle. */
export interface AskContextFacts {
  facts: AskCardFacts[];
  dangling: string[];
}

/**
 * RESOLVE an ask card's context from the WIRES (Epic 17 story 9, PURE). Every
 * link whose target is this ask card contributes what its source card HAS:
 *
 *   - a REFERENCE card: name, state, reading crop and note crop (the existing
 *     card-ask renderer);
 *   - an ASK card: its most recent COMPLETED answer, whole, read from the
 *     composed thread at this moment (never copied into a record);
 *   - a SESSION card: its most recent COMPLETED run's text, whole entries;
 *   - a card with none of those: the same block plus its one quiet line.
 *
 * STORY 16.19 — AND, BEFORE THEM ALL, THE WORDS THE PERSON CHOSE: an ask made
 * from a selection carries the selected words and their source slug on its own
 * line, and they ride as one block under the same 17.9 bound (whole, because the
 * record stores them on one line). The user's correction made the selection
 * CONTEXT, so it is a source kind here and never a reading or a card.
 *
 * A wire whose source is gone is DANGLING and is returned, not repaired.
 */
export function askContextFactsOf(
  input: AskContextFactsInput,
): AskContextFacts {
  const sessions = input.sessions ?? [];
  const sessionEntries = input.sessionEntries ?? {};
  const known = [
    ...input.references.map((reference) => reference.on),
    ...input.asks.map((ask) => ask.on),
    ...sessions.map((session) => session.on),
  ];
  const wired = askContextSources(input.ask, input.links, known);
  const facts: AskCardFacts[] = [];
  // STORY 16.19 — THE CHOSEN WORDS ARE ONE MORE SOURCE KIND, and they ride
  // FIRST: the question this card was made from was asked about exactly these
  // words. They are not a card, so they carry no slug (the PRISM's inclusion set
  // never names them), no reading (one line, whole) and no note. The block's name
  // reads where the source card's name is NOW; a source the map no longer
  // carries is said in that name, never repaired (17.6's rule, one kind over).
  const chooser = input.asks.find((entry) => entry.on === input.ask);
  if (chooser !== undefined && chooser.chosen !== undefined) {
    const from = chooser.chosenFrom ?? null;
    const sourceName =
      from === null
        ? null
        : (input.references.find((reference) => reference.on === from)?.name ??
          input.asks.find((entry) => entry.on === from)?.name ??
          sessions.find((entry) => entry.on === from)?.name ??
          null);
    facts.push({
      name: chosenWordsName(sourceName),
      state: null,
      reading: null,
      readingText: null,
      note: null,
      chosen: chooser.chosen,
    });
  }
  for (const source of wired.sources) {
    const reference = input.references.find((entry) => entry.on === source);
    if (reference !== undefined) {
      facts.push({
        on: reference.on,
        name: reference.name,
        state: input.states[reference.on] ?? null,
        reading: readingFor(input.readings, reference.on),
        readingText: input.texts[reference.on] ?? null,
        note: input.notes[reference.on] ?? null,
      });
      continue;
    }
    const ask = input.asks.find((entry) => entry.on === source);
    if (ask !== undefined) {
      const thread = askThreadOf(ask, input.asks, input.askTurns).turns;
      let answer: string | undefined;
      for (let index = thread.length - 1; index >= 0; index -= 1) {
        const turn = thread[index]!;
        if (turn.role === "answer") {
          answer = turn.text;
          break;
        }
      }
      facts.push({
        on: ask.on,
        name: ask.name,
        state: null,
        reading: null,
        readingText: null,
        note: null,
        ...(answer === undefined
          ? { empty: ASK_CONTEXT_NO_ANSWER }
          : { answer }),
      });
      continue;
    }
    const session = sessions.find((entry) => entry.on === source);
    if (session === undefined) {
      // The known set and this loop are built from the same records; a miss
      // here would be a programming error, and the wire stays said as dangling
      // rather than silently dropped.
      wired.dangling.push(source);
      continue;
    }
    const result = sessionRunResult(sessionEntries[session.on] ?? []);
    const fields: {
      result?: string;
      empty?: string;
    } = {};
    if (result.ending === "completed") {
      if (result.text === "") fields.empty = ASK_CONTEXT_RUN_EMPTY;
      else fields.result = result.text;
    } else if (result.ending === null) {
      fields.empty = ASK_CONTEXT_NO_RUN;
    } else {
      fields.empty = ASK_CONTEXT_RUN_UNFINISHED;
    }
    facts.push({
      on: session.on,
      name: session.name,
      state: null,
      reading: null,
      readingText: null,
      note: null,
      ...fields,
    });
  }
  return { facts, dangling: wired.dangling };
}

/**
 * THE CONTEXT'S NATURAL KEYS (Epic 17 story 9, PURE): the inclusion set a
 * sending turn logs — each INCLUDED card's reading named by the pointer key of
 * its form and value (on + form + value, the map's own citation vocabulary).
 *
 * NULL MEANS NOTHING POINTER-IDENTIFIED RODE: a card with no reading has no
 * pointer to name, and a session or ask card lends words, not a reading. A card
 * dropped by the context bound never reaches this function: the packet's own
 * selection is what is passed here, so the record names only what rode.
 */
export function askContextInclusion(
  cards: readonly AskPacketCard[],
  readings: readonly Reading[],
): string[] | null {
  const keys: string[] = [];
  for (const card of cards) {
    if (card.on === undefined) continue;
    const reading = readingFor(readings, card.on);
    if (reading === null) continue;
    if (!isPointerForm(reading.form)) continue;
    keys.push(pointerKey(card.on, reading.form, reading.from));
  }
  return keys.length === 0 ? null : keys;
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

/**
 * HOW THE TURN ENDED, mapped from the transport's own result (Epic 15 story
 * 7b's vocabulary): a completed turn ANSWERED; a cancel the person pressed is
 * STOPPED; the turn's own budget is TIMED-OUT; anything else broke. The
 * record's outcome is formed from THIS, never from what arrived — a partial is
 * a view, and the card says it was stopped or that it broke.
 */
export function askEndingOf(result: TurnResult): AskEnding {
  switch (result.kind) {
    case "answer":
      return "answered";
    case "cancelled":
      return "stopped";
    case "timeout":
      return "timed-out";
    case "error":
      return "failed";
  }
}

/**
 * STORY 17.12 — THE CURATOR'S SECOND EGRESS, as the ask turn hands it on. The
 * reply is already safe in `result`; this value is the OTHER call's facts:
 * whether it left (a PRISM when it did), how it ended, the two model NAMES (the
 * card's author line), the raw reply (the Move's size, never shown) and the
 * parse. A null `read` is the call itself failing; the reply still stands
 * (ADR-0037 decision 8).
 */
export interface AskCuratorSend {
  /** Whether the curator request left the app: a Move exists when it did. */
  left: boolean;
  /** How the curator call ended (the second PRISM's outcome). */
  ending: AskEnding;
  /** The MANAGER model's name as its row shows it: the card's author. */
  manager: string;
  /** The TASK model's name: whose reply was distilled. */
  task: string;
  /** The curator's raw answer, for the Move's size, or null when none came. */
  raw: string | null;
  /** The parsed answer, or null when the call produced no usable text. */
  read: CuratorRead | null;
  /** The ONE sentence when `read` is null (the call failed or timed out). */
  sentence: string | null;
}

/**
 * What one ask-card turn's SEND produced: what the card and the conversation
 * read, HOW IT ENDED, and whether the question actually left. `left` is false
 * only when the turn never ran (no turn port, no configured provider): nothing
 * left the machine, so nothing is recorded — a draft and a missing provider
 * alike write no PRISM (story 17.4's rule 6).
 */
export interface AskTurnSend {
  result: AskSendResult;
  ending: AskEnding;
  left: boolean;
  /**
   * STORY 17.7b — WHAT THE TURN HIT, passed straight through to the card: the
   * step ceiling's sentence (or null) and a READ the view did not carry (or
   * null). Nothing here enters the record; the card is their only reader.
   */
  reached: string | null;
  missed: string | null;
  /**
   * STORY 17.12 — the second egress's facts, when the ask asked the manager to
   * distil the reply. Absent on a turn that did not answer (nothing to distil)
   * and on callers that predate the curator, whose completed turn still falls
   * back to 17.11's rule copy.
   */
  curator?: AskCuratorSend;
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
  move: string | null = null,
): Promise<AskTurnRecords> {
  const answer = sent.kind === "answer" ? sent.text : null;
  const turns = await io.appendExchange(
    workspacePath,
    slug,
    question,
    answer,
    undefined,
    undefined,
    move,
  );
  return {
    turns,
    sentence: sent.kind === "answer" ? null : sent.sentence,
  };
}

/** The two bridges one sent turn's record needs; a test passes its own fakes. */
export interface AskTurnWriteIo {
  appendExchange: typeof appendExchange;
  /** The Ask machinery's ONE PRISM append (contacts/prismLog.ts's queue). */
  appendMove: typeof appendAskCardMove;
}

/** The real bridges, bound once so the hook's path is the tested one. */
const ASK_TURN_WRITE_IO: AskTurnWriteIo = {
  appendExchange,
  appendMove: appendAskCardMove,
};

/** What writing one sent turn's record did: the Move, the words and the sentence. */
export interface AskTurnWrite {
  /** The ONE PRISM the sending turn made; null when the turn never left. */
  prism: Prism | null;
  /**
   * STORY 17.12 — THE SECOND PRISM (ADR-0037 decision 9): the curator's own
   * egress, written when its request actually left. Null when no curator ran
   * or the request never left.
   */
  curatorPrism: Prism | null;
  /** Every turn the file now holds, in order. */
  turns: readonly AskTurn[];
  /** The one sentence when the turn did not answer; null when it did. */
  sentence: string | null;
}

/**
 * STORY 17.4 — WRITE ONE SENDING TURN'S RECORD, in the house order: the MOVE
 * first (exactly one PRISM, through the Ask machinery), then the words (the
 * person's line always, the answer line only when the turn answered, carrying
 * the Move's id). The Move lands first because the answer line's `move` field
 * needs it — PROVISIONAL ordering, the story's own note. A turn that never
 * left the machine makes NO Move (nothing is appended to the log); the
 * person's line is still the conversation's, because they did ask.
 *
 * The record's facts never include a word: the PRISM holds the card, the
 * anchor, the inclusion set, the ending and the response's size and decode;
 * the conversation holds what was said. PURE apart from the bridges it is
 * handed, so a test calls the same order the hook runs.
 */
export async function writeAskTurn(
  workspacePath: string,
  slug: string,
  included: string[] | null,
  question: string,
  sent: AskTurnSend,
  io: AskTurnWriteIo = ASK_TURN_WRITE_IO,
): Promise<AskTurnWrite> {
  // STORY 17.9 — NO ANCHOR ON A NEW TURN. The Move's `included` set is the
  // wired context's natural keys; the legacy `anchor` field is never written
  // by this path again (old lines still parse and display it).
  const prism = sent.left
    ? await io.appendMove(
        workspacePath,
        slug,
        included,
        sent.ending,
        sent.result.kind === "answer" ? sent.result.text : null,
      )
    : null;
  const recorded = await recordAskTurn(
    workspacePath,
    slug,
    question,
    sent.result,
    io,
    prism === null ? null : prism.id,
  );
  // STORY 17.12 — THE CURATOR IS ITS OWN MOVE (ADR-0037 decision 9). It left
  // the machine, so it is recorded even when it declined or failed: an egress
  // that is not written down is the invisible spend the decision forbids. It
  // carries NO inclusion set (no material rode) and the ROLE says which of the
  // two egresses this line is; the task line above stays role-absent, like
  // every line written before this story.
  let curatorPrism: Prism | null = null;
  const curator = sent.curator;
  if (curator !== undefined && curator.left) {
    curatorPrism = await io.appendMove(
      workspacePath,
      slug,
      null,
      curator.ending,
      curator.raw,
      "curator",
    );
  }
  return {
    prism,
    curatorPrism,
    turns: recorded.turns,
    sentence: recorded.sentence,
  };
}

/* ------------------------------------------------------------------------- *
 * STORY 18.3 — THE SESSION CARD: one record line, one append-only transcript,
 * and ONE RUN through 18.2's lifecycle.
 *
 * The record is `map/sessions.txt` + `map/sessions/<slug>.jsonl` (map/
 * sessions.ts). This section is the SEAM between that record and 18.2's run:
 *
 *   - CREATE: one queued write of the `sessions.txt` line, with the slug
 *     minted in the SHARED space (ground + asks + sessions). No reading, no
 *     note, no media, no link, no mirror and no history (18.5 owns the mirror
 *     and the log) — the record is the whole move.
 *   - RUN: the row is resolved from the rows this build ships, and the run is
 *     asked of the SIDECAR (18.3b: 18.2's lifecycle lives in the process that
 *     can spawn, because the window cannot). EVERY progress entry the lane
 *     streams back is written to the transcript as it arrives, in arrival
 *     order, WHOLE LINES ONLY. The transcript is never buffered until the end
 *     and never rewritten: a crash loses the last entry, never an earlier one.
 *   - STOP: the run's own cancel — the 18.2 rule, unchanged: the child is
 *     killed on every exit path, and the ending is written by the run itself.
 *   - ENDING: only "completed" is a result. Stopped keeps what arrived and says
 *     so; failed carries the run's ONE sentence; timed-out says its budget ran
 *     out. No percentage, no step count and no spinner that outlives the run.
 *   - NO KEY: a tool row grants one only through an explicit `env` entry, and
 *     the key is read from the store HERE, at run time, and sent in the run
 *     request's payload — the same road a turn's key takes. It never enters a
 *     record, a transcript line or a sentence. The card's declaration
 *     (`acpDeclaration`, 18.2, now in `acpSpecs` where the window can read it)
 *     names the ROW, never the value.
 *
 * ONE RUN PER CARD AT A TIME. The live handles are held here (view state, never
 * a record): a second press answers ONE sentence, and the handle is dropped
 * when the run settles, so no spinner can outlive its run.
 *
 * PROVISIONAL: the prompt below, the permission policy (refuse — 18.4 owns
 * "who decides"), and the mapping from a run report to a transcript kind.
 * ------------------------------------------------------------------------- */

/**
 * THE ONE PROMPT a card's run sends (PROVISIONAL). 18.3's card has no prompt
 * field: the run is the row, the session directory and this small read-only
 * ask, and handing MAP CONTEXT over is 18.4's work. It asks for words and
 * changes nothing, so the shipped row's failure is about the key and not about
 * what it was asked to do.
 */
export const SESSION_PROMPT =
  "list the files in this directory and say in one sentence what this folder is for. change nothing.";

/**
 * STORY 18.5 — the one sentence a run's PRISM that could not be written answers.
 * The run itself is already recorded in its transcript, so this is a notice about
 * the LOG, never a claim that the run failed.
 */
export const SESSION_MOVE_REFUSAL =
  "the run is in its transcript, but its move could not be written.";

/** One object, or no (a wire payload is never trusted to have a shape). */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The first non-empty string of the candidates, or the fallback. */
function firstText(candidates: readonly string[], fallback: string): string {
  for (const candidate of candidates) {
    if (candidate.trim() !== "") return candidate;
  }
  return fallback;
}

/** One line naming a permission's subject, never its params. */
function permissionName(toolCall: unknown): string {
  const call = asRecord(toolCall);
  return firstText(
    [typeof call.title === "string" ? call.title : ""],
    "a permission",
  );
}

/**
 * HOW THE RUN'S REPLY READS IN THE RECORD (PURE): the option the caller picked
 * is looked up in what the server offered, so the transcript says what actually
 * crossed the wire — allowed, refused, or cancelled when no option was picked.
 */
function permissionReplyOf(entry: {
  reply: { outcome: string; optionId?: string };
  options: readonly { optionId: string; kind: string }[];
}): SessionPermissionReply {
  // STORY 18.4: a request that waited past the budget is recorded as exactly
  // that, never as a refusal the person did not make.
  if (entry.reply.outcome === "unanswered") return "unanswered";
  if (entry.reply.outcome !== "selected") return "cancelled";
  const optionId = entry.reply.optionId ?? "";
  const option = entry.options.find((candidate) => candidate.optionId === optionId);
  if (option === undefined) return "cancelled";
  // ONLY the protocol's allow_once kind can become an allow in the record. An
  // `allow_always` option is never sent (the lane cannot choose it); if a
  // record somehow carried one, it is not an answer this app can state as an
  // allow, so it is treated like a cancelled outcome — never as "allowed".
  if (option.kind === "allow_once") return "allowed-once";
  if (option.kind.startsWith("reject")) return "refused";
  return "cancelled";
}

/**
 * ONE RUN REPORT AS ONE TRANSCRIPT ENTRY (PURE), or `null` when the report is
 * not one of the six kinds the card can state. A thought, a plan and a transport
 * diagnostic are not dressed as the agent's words: the ending carries the run's
 * one sentence, and the transcript holds what the person watched.
 *
 * The timestamp is handed in, so a test can pin it and the record carries the
 * writer's clock rather than this function's.
 */
export function sessionEntryOf(
  entry: AcpProgressEntry,
  t: string,
): SessionEntry | null {
  switch (entry.kind) {
    case "started":
      // The declaration (which names a provider row, never a key) is the
      // CARD's, computed from the row; the record keeps only that it began.
      return { kind: "started", t };
    case "session":
      return { kind: "session", id: entry.sessionId };
    case "update": {
      if (entry.updateKind === "agent_message_chunk") {
        return entry.text === ""
          ? null
          : { kind: "text", text: entry.text };
      }
      if (
        entry.updateKind === "tool_call" ||
        entry.updateKind === "tool_call_update"
      ) {
        const update = asRecord(entry.update);
        return {
          kind: "tool",
          name: firstText(
            [
              typeof update.title === "string" ? update.title : "",
              typeof update.name === "string" ? update.name : "",
              typeof update.toolName === "string" ? update.toolName : "",
            ],
            "a tool call",
          ),
          status: typeof update.status === "string" ? update.status : "",
        };
      }
      // A thought or a plan is progress the card does not pretend to read.
      return null;
    }
    case "permission":
      return {
        kind: "permission",
        name: permissionName(entry.toolCall),
        reply: permissionReplyOf(entry),
      };
    case "problem":
      // A transport diagnostic is not one of the six kinds; a run that cannot
      // go on ends, and the ending's one sentence is what the card states.
      return null;
    case "ended": {
      const ended: SessionEntry = { kind: "ended", ending: entry.ending, t };
      if (entry.sentence !== null) ended.sentence = entry.sentence;
      return ended;
    }
  }
}

/** What a run wrote and how it ended, once the sidecar stated the ending. */
export interface SessionRunDone {
  /** The ending the run itself stated; only "completed" is a result. */
  ending: AcpEnding;
  /** One quiet sentence for failed and timed-out runs; null otherwise. */
  sentence: string | null;
  /** Every transcript entry this run wrote, in order (the ending is last). */
  entries: readonly SessionEntry[];
  /** One sentence when the transcript could not be written; null when it could. */
  notice: string | null;
}

/** A live run: the seam's handle (for the stop) and its one settle promise. */
export interface SessionRunStart {
  handle: SessionRunHandle;
  done: Promise<SessionRunDone>;
}

/** What a run needs from the app, all injectable for a test. */
export interface SessionRunOptions {
  /** The key for ONE provider row, read at request time and never logged. */
  readKey?: (providerId: string) => Promise<string>;
  /** The sidecar pipe a test drives; the app's own by default. */
  transport?: import("../turn/turn").TurnTransport;
  /** Make sure the child is up; the app's `startSidecar` by default. */
  start?: () => Promise<SidecarStart>;
  /** The writer's clock, so a test can pin the record's timestamps. */
  now?: () => string;
  /** Each entry as it is written, for the view that watches the run. */
  onEntry?: (entry: SessionEntry) => void;
  /**
   * STORY 18.4 — the server's permission ask as it arrives. The card holds it
   * as view state and answers through the run's handle; an ask nobody answers
   * ends as the run's own timeout.
   */
  onPermission?: (ask: AcpPermissionAsk) => void;
  /** The transcript bridges (a test's fake, or the map's own files). */
  transcriptIo?: SessionIo;
}

/**
 * START ONE RUN and write its transcript AS IT ARRIVES. STORY 18.3b MOVED THE
 * RUN ITSELF to the Bun sidecar (`turn/acpSession.ts` asks, `sidecar/runs.ts`
 * spawns); this function is the card's half: it maps each streamed progress
 * entry to a whole transcript entry (`sessionEntryOf`) and appends it through
 * ONE serialized chain, so file order is arrival order even when two entries
 * land in the same tick.
 *
 * THE ENDING IS THE RUN'S OWN. The sidecar states it (`run-end`); the `ended`
 * line is appended here, exactly once, before `done` settles — so a caller that
 * awaits `done` always has the ending on disk. A partial is never a result
 * (18.2's rule survives the move untouched). This function owns no process and
 * no timer: the lane owns both, and kills the child on every exit path.
 */
export function beginSessionRun(
  workspacePath: string,
  row: AcpSpec,
  slug: string,
  options: SessionRunOptions = {},
): SessionRunStart {
  const now = options.now ?? (() => new Date().toISOString());
  const written: SessionEntry[] = [];
  let chain: Promise<void> = Promise.resolve();
  let notice: string | null = null;

  const record = (line: SessionEntry | null): void => {
    if (line === null) return;
    written.push(line);
    // ONE append at a time: the previous write must settle before the next
    // line is added, so two entries can never land out of order or interleave.
    chain = chain
      .then(async () => {
        await appendSessionEntries(
          workspacePath,
          slug,
          [line],
          options.transcriptIo,
        );
      })
      .catch(() => {
        notice = SESSION_TRANSCRIPT_REFUSAL;
      });
    options.onEntry?.(line);
  };

  const handle = startSessionRun(row, SESSION_PROMPT, {
    // The key is read HERE, from the rows the tool declares, and handed to the
    // sidecar inside the request's payload — never an argv, never state.
    ...(options.readKey === undefined
      ? {}
      : { readKey: options.readKey }),
    ...(options.transport === undefined
      ? {}
      : { transport: options.transport }),
    ...(options.start === undefined ? {} : { start: options.start }),
    onEntry: (entry: AcpProgressEntry) => record(sessionEntryOf(entry, now())),
    ...(options.onPermission === undefined
      ? {}
      : { onPermission: options.onPermission }),
  });

  const done: Promise<SessionRunDone> = handle.ended.then(
    async ({ ending, sentence }) => {
      // THE ENDING, once: whole, append-only, and the run's own words when it
      // has one. A failed start (no key, no sidecar) reaches exactly here too,
      // so the card can state it after a reopen.
      const ended: SessionEntry = { kind: "ended", ending, t: now() };
      if (sentence !== null) ended.sentence = sentence;
      record(ended);
      // The last append must land before the caller reads.
      await chain;
      return { ending, sentence, entries: [...written], notice };
    },
  );

  return { handle, done };
}

/** The bridges a session card's creation needs; a test passes its own fakes. */
export interface SessionCardIo {
  saveSessions: typeof saveSessions;
}

/** The real bridges, bound once so the hook's path is the tested one. */
const SESSION_CARD_IO: SessionCardIo = { saveSessions };

/** What making a session card produced: the next lines and the new card. */
export interface SessionCardRecords {
  sessions: SessionCard[];
  session: SessionCard;
}

/**
 * STORY 18.3 — WRITE ONE SESSION CARD, in the house order: the `sessions.txt`
 * line only, with the slug minted against ALL THREE families' slugs (the run
 * of the story's slug-space proof). The tool row is NAMED by id — never a key,
 * never a command — and nothing else is written: a card that has never run has
 * no transcript to invent. PURE apart from the bridge it is handed.
 */
export async function writeSessionCard(
  workspacePath: string,
  references: readonly GroundReference[],
  asks: readonly AskCard[],
  sessions: readonly SessionCard[],
  malformedSessions: readonly string[],
  name: string,
  tool: string,
  x: number,
  y: number,
  io: SessionCardIo = SESSION_CARD_IO,
): Promise<SessionCardRecords> {
  const addition = addSession(
    sessions,
    sharedSlugs(references, asks, sessions),
    name.trim(),
    x,
    y,
    tool,
  );
  await io.saveSessions(workspacePath, addition.sessions, malformedSessions);
  return { sessions: addition.sessions, session: addition.session };
}

/** The bridges a re-bind needs; a test passes its own fakes. */
export interface SessionBindIo {
  saveSessions: typeof saveSessions;
}

const SESSION_BIND_IO: SessionBindIo = { saveSessions };

/**
 * BIND one session card to another row: ONE field's change, ONE write. A slug
 * the file does not carry answers `null` (the caller's one sentence) and never
 * appends a card; the transcript and the point are untouched.
 */
export async function bindSessionCard(
  workspacePath: string,
  sessions: readonly SessionCard[],
  malformedSessions: readonly string[],
  slug: string,
  tool: string,
  io: SessionBindIo = SESSION_BIND_IO,
): Promise<SessionCard[] | null> {
  const next = bindSessionToolRecord(sessions, slug, tool);
  if (next === null) return null;
  await io.saveSessions(workspacePath, next, malformedSessions);
  return next;
}

/** The bridges a page card's creation needs; a test passes its own fakes. */
export interface PageIo {
  saveReadings: typeof saveReadings;
  saveMedia: typeof saveMedia;
  storeThumb: typeof storeThumb;
  saveGround: typeof saveGround;
}

/** The real bridges, bound once so the hook's path is the tested one. */
const PAGE_IO: PageIo = {
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
 * STORY 16.14 — CREATE A PAGE CARD; STORY 16.26 TAKES THE TEXT OUT OF IT.
 *
 * The user's ruling ("it tries to do some weird text parsing … just need a
 * simple page thumbnail or something in the card; the llm can open the page
 * and crawl it") makes the card a THUMBNAIL, not a transcript. So a NEW page
 * card keeps:
 *
 *   1. the readings line (`form: url`, `extract: page`, the URL verbatim);
 *   2. the thumbnail's local file (when the page had an image);
 *   3. the media line (`map/media.jsonl`) — the title and the LOCAL thumb path,
 *      never a remote URL;
 *   4. the ground line LAST, so a crash can leave orphan pieces but never a
 *      card whose record is absent.
 *
 * NO TEXT IS WRITTEN. The fetched words were only ever what a reducer scraped
 * from the page's chrome; the page itself is read again by the sidecar when it
 * is asked (16.26), under 16.14's guards, and the read rides the packet. An
 * EXISTING card keeps the text it already has: this function only ever makes a
 * new card, so nothing on disk is rewritten or deleted.
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
  // STORY 16.26 — NO TEXT IS KEPT. `page.text` was read by the sidecar only to
  // prove the page answers at all (an empty extraction is still a refusal);
  // the card's face is its thumbnail and host, and the words come fresh at ask
  // time. The empty string is this card's honest "no stored reading", exactly
  // what a reopen finds.
  const text = "";
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
  // STORY 17.8: conversations whose ask card is gone. The load's one folder
  // listing computes them; a refused unlink adds the one it could not take.
  const orphanAskTurnsRef = useRef<string[]>([]);
  // STORY 18.5: transcripts whose session card is gone. The load's one folder
  // listing computes them; a refused unlink adds the one it could not take.
  const orphanSessionTranscriptsRef = useRef<string[]>([]);
  // STORY 18.3: the session cards, their transcripts and the runs that are
  // LIVE right now. The first three are the map folder's records; the handles
  // and the running list are VIEW STATE — a run belongs to the card it started
  // from and is dropped the moment it settles.
  const sessionsRef = useRef<SessionCard[]>([]);
  const sessionEntriesRef = useRef<Record<string, readonly SessionEntry[]>>({});
  const malformedSessionsRef = useRef<string[]>([]);
  /**
   * STORY 17.9 — every slug a WIRE may name: the three card families on the
   * ground map. A wire into an ask card may come from a reference, an ask or a
   * session, and an orphan is measured against all three.
   */
  const knownCardSlugs = (): string[] => [
    ...referencesRef.current.map((reference) => reference.on),
    ...asksRef.current.map((ask) => ask.on),
    ...sessionsRef.current.map((session) => session.on),
  ];
  const sessionRunningRef = useRef<string[]>([]);
  const sessionRunsRef = useRef<Record<string, SessionRunHandle>>({});
  // STORY 18.4: a pending permission ask per card. VIEW STATE — the run WAITS
  // in the sidecar; this map is only what the card draws and answers.
  const sessionPermissionRef = useRef<Record<string, AcpPermissionAsk>>({});
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
  // STORY 17.8: the ask card's own pending restore. ONE toast holds exactly one
  // of the two kinds; a delete of either clears the other.
  const restorableAskRef = useRef<RemovedAsk | null>(null);
  // STORY 18.5: the session card's own pending restore, in the same ONE toast.
  const restorableSessionRef = useRef<RemovedSession | null>(null);
  const restoreNoticeRef = useRef<string | null>(null);
  // One queue for the ground family's files: an add's ground line must land
  // after its own readings line, never under a stale one; the link and the
  // cascade share it so no link write can land under a stale list.
  const queueRef = useRef(createWriteQueue());

  const reload = useCallback(async () => {
    if (workspacePath === "") return;
    const [
      ground,
      asks,
      loadedSessions,
      readings,
      groundLinks,
      history,
      loadedMedia,
    ] = await Promise.all([
        loadGround(workspacePath),
        // STORY 17.1: the ask cards' lines are read with the workspace, like
        // every other record family. Their conversations are read below, one
        // per card, once — nothing watches or re-reads.
        loadAsks(workspacePath),
        // STORY 18.3: the session cards' lines read here too; their transcripts
        // are read below, one per card, once. Opening writes nothing.
        loadSessions(workspacePath),
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
    // STORY 18.3: the session cards' transcripts, one read per card below.
    const sessionSlugs = loadedSessions.sessions.map((session) => session.on);
    const [texts, metas, loadedNotes, thumbs, loadedAskTurns, loadedSessionEntries] =
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
        // an empty conversation, never an invented one. STORY 17.8 adds the
        // folder's ONE listing, which also names an ORPHAN conversation.
        loadAskConversations(workspacePath, askSlugs),
        // STORY 18.3: one read per session card's transcript, in arrival
        // order. An absent file is no entries — a card made but never run.
        // STORY 18.5 adds the folder's ONE listing, which also names an ORPHAN
        // transcript (a run file whose card is gone).
        loadSessionTranscriptsWithOrphans(workspacePath, sessionSlugs),
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
      askTurns[slug] = loadedAskTurns.turns[slug]?.turns ?? [];
    }
    askTurnsRef.current = askTurns;
    // STORY 17.8: a conversation with no ask card is kept and SAID, never
    // adopted into a card and never deleted.
    orphanAskTurnsRef.current = loadedAskTurns.orphans;
    // STORY 18.3: the session cards and their transcripts follow the same rule
    // as the ask cards' — the map folder alone is the truth, read once, and an
    // absent transcript is no entries rather than an invented one.
    sessionsRef.current = loadedSessions.sessions;
    malformedSessionsRef.current = loadedSessions.malformed;
    const sessionEntries: Record<string, readonly SessionEntry[]> = {};
    for (const slug of sessionSlugs) {
      sessionEntries[slug] =
        loadedSessionEntries.transcripts[slug]?.entries ?? [];
    }
    sessionEntriesRef.current = sessionEntries;
    // STORY 18.5: a transcript with no session card is kept and SAID, never
    // adopted into a card and never deleted.
    orphanSessionTranscriptsRef.current = loadedSessionEntries.orphans;
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
    // STORY 17.8: computed from the load's listing and every write that can
    // make one, never stored as a record.
    orphanAskTurns: orphanAskTurnsRef.current,
    // STORY 18.3: the session cards, their transcripts and the live runs. The
    // last is VIEW STATE: a slug leaves the list when its run settles.
    sessions: sessionsRef.current,
    sessionEntries: sessionEntriesRef.current,
    malformedSessions: malformedSessionsRef.current,
    // STORY 18.5: computed from the load's listing and every write that can
    // make one, never stored as a record.
    orphanSessionTranscripts: orphanSessionTranscriptsRef.current,
    sessionRunning: sessionRunningRef.current,
    sessionPermission: sessionPermissionRef.current,
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
    // with fewer links but never with one the app itself orphaned. STORY 17.9:
    // a wire may now name an ASK or SESSION card too (anything a wire touches
    // is context), so either end may be any card family's slug.
    orphanLinks: orphanGroundLinks(linksRef.current, knownCardSlugs()),
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
    restorableAsk: restorableAskRef.current,
    restorableSession: restorableSessionRef.current,
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
    // STORY 17.8: the ask cards' names, anchors and parents — the mirror never
    // reads a conversation, so not one word of one can reach MAP.md.
    asks: asksRef.current,
    malformedAsks: malformedAsksRef.current,
    orphanAskTurns: orphanAskTurnsRef.current,
    // STORY 18.5: the session cards' names, tool names and last endings — never
    // their transcripts, so not one word of a run can reach MAP.md.
    sessions: sessionsRef.current,
    sessionToolNames: Object.fromEntries(
      sessionsRef.current.map((session) => [
        session.on,
        shippedAcpSpec(session.tool)?.name ?? null,
      ]),
    ),
    sessionEndings: Object.fromEntries(
      sessionsRef.current.map((session) => [
        session.on,
        sessionLastEnding(sessionEntriesRef.current[session.on] ?? []),
      ]),
    ),
    orphanSessionTranscripts: orphanSessionTranscriptsRef.current,
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
    orphanLinks: orphanGroundLinks(linksRef.current, knownCardSlugs()),
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
    // STORY 18.3: a run belongs to the card it started from, and that card
    // belongs to the workspace it was made in. Leaving the workspace CANCELS
    // every live run (the run's own cancel — session/cancel, then the child, so
    // no orphan process is left behind); the new workspace starts with none.
    for (const handle of Object.values(sessionRunsRef.current)) {
      try {
        handle.cancel();
      } catch {
        // A run already settled has nothing to cancel.
      }
    }
    sessionRunsRef.current = {};
    sessionRunningRef.current = [];
    sessionPermissionRef.current = {};
    // Story 16.13: a restore belongs to the workspace its bytes came from
    // (story 17.8's ask-card restore rides the same one).
    restorableRef.current = null;
    restorableAskRef.current = null;
    restorableSessionRef.current = null;
    restoreNoticeRef.current = null;
    queueRef.current = createWriteQueue();
    if (workspacePath === "") {
      referencesRef.current = [];
      asksRef.current = [];
      askTurnsRef.current = {};
      malformedAsksRef.current = [];
      orphanAskTurnsRef.current = [];
      orphanSessionTranscriptsRef.current = [];
      sessionsRef.current = [];
      sessionEntriesRef.current = {};
      malformedSessionsRef.current = [];
      sessionRunningRef.current = [];
      sessionRunsRef.current = {};
      sessionPermissionRef.current = {};
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
      restorableAskRef.current = null;
      restorableSessionRef.current = null;
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
            // STORY 18.3 — ALL THREE FAMILIES: the third is the session cards,
            // so a new reference can never twin one of them either.
            sharedSlugs(referencesRef.current, asksRef.current, sessionsRef.current),
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

  // STORY 18 — 16.12's `createSelection` is gone with its verb: selecting text
  // in a reading no longer mints a ground card (the user corrected the intent;
  // that gesture belongs to the selection→ASK widget, a later story). The
  // WRITER below still exists, because a stored selection card is legal: the
  // run-result card (18.4) is one, and so are every card made before this story.

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
            // STORY 18.3 — ALL THREE FAMILIES now: ground, asks and sessions.
            { taken: sharedSlugs(referencesRef.current, asksRef.current, sessionsRef.current) },
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
            // STORY 18.3 — ALL THREE FAMILIES now: ground, asks and sessions.
            { taken: sharedSlugs(referencesRef.current, asksRef.current, sessionsRef.current) },
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
   * unchanged.
   *
   * STORY 17.4: it reports HOW THE TURN ENDED alongside the words, and whether
   * the question actually LEFT. The two pre-flight refusals (no turn port, no
   * configured provider) never leave the machine, so they are `left: false`
   * and the caller records nothing; once the packet is handed to the turn, the
   * ending — not the bytes — forms the ONE PRISM.
   *
   * It runs OUTSIDE the write queue: a turn may take its whole budget, and a
   * card drag must never wait for a provider. Only the record write goes
   * through the queue. An unconfigured turn is one sentence and no answer.
   */
  const sendAskQuestion = useCallback(
    async (
      packet: AskPacket,
      context: AskContext,
      question: string,
      onPart?: (text: string) => void,
    ): Promise<AskTurnSend> => {
      if (turn === undefined) {
        return {
          result: { kind: "failed", sentence: TURN_SENTENCES.unreachable },
          ending: "failed",
          left: false,
          reached: null,
          missed: null,
        };
      }
      const current = await loadTurnSettings();
      const resolved = resolveSelection(current);
      if (resolved.kind !== "resolved") {
        return {
          result: { kind: "failed", sentence: PROVIDER_SENTENCES.nothing },
          ending: "failed",
          left: false,
          reached: null,
          missed: null,
        };
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
      // after the send exactly as the Ask Move's readback does. The
      // ENDING rides beside them (story 7b): a cancel is a stop, a timeout is
      // the budget, a break is a failure — none of them is an answer.
      const sent: AskTurnSend = {
        result: askSendResult(answered.result, {
          messages: answered.messages,
          read: answered.read,
          // STORY 16.26 — the declaration of the packet that left, so a page's
          // block can be sized beside its own bytes: the block exists only
          // once the sidecar answered, so this is where its size is true.
          declaration: packet.declaration,
        }),
        ending: askEndingOf(answered.result),
        left: true,
        // STORY 17.7b: the ceiling and the missed READ ride beside the words,
        // to the card and nowhere else.
        reached: answered.reached,
        missed: answered.missed,
      };
      // STORY 17.12 — THE SECOND CALL (ADR-0037 decisions 4, 6 and 9). Only a
      // completed answer can be distilled; the reply is the task's exact bytes
      // and is never edited here. The manager row is resolved AFTER the task
      // answered, so a manager misconfiguration cannot cost the person an
      // answer: the reply stands and one sentence says no card was made.
      if (
        sent.ending !== "answered" ||
        sent.result.kind !== "answer" ||
        sent.result.text === ""
      ) {
        return sent;
      }
      const reply = sent.result.text;
      // THE WHOLE ASK'S CEILING counts BOTH calls: the task's exchanges plus
      // the curator's one. The curator's exchange is spent here only when the
      // declared ceiling still allows it; the task's own loop spent only its
      // own share, never this one.
      const wholeBudget = askSteps(route, packet.retrievable.length > 0, true);
      if (wholeBudget.steps < 2) return sent;
      const manager = resolveManager(current);
      if (manager.kind !== "resolved") {
        // STORY 17.13 — NO MANAGER, THE RULE (17.11's path). The declaration
        // told the person the card would be made by a rule instead of a second
        // call, so this is the branch that keeps that sentence true: no
        // curator facts ride back, and the completed reply becomes a card the
        // way 17.11 wrote one (a rule's copy, provenance included). It is not
        // a curator failure — no second call was made at all — so it is not
        // the failure asymmetry's sentence either.
        return sent;
      }
      let managerKey = "";
      try {
        managerKey =
          manager.provider.kind === "http"
            ? await readSecret(manager.provider.id)
            : "";
      } catch {
        return {
          ...sent,
          curator: {
            left: false,
            ending: "failed",
            manager: modelAuthorName(manager.model.name, manager.model.id),
            task: modelAuthorName(resolved.model.name, resolved.model.id),
            raw: null,
            read: null,
            sentence: ASK_CURATOR_FAILED_SENTENCE,
          },
        };
      }
      const managerRoute = routeOf(manager.provider, manager.model, managerKey);
      // THE PACKET IS PURE AND CARRIES NO MATERIAL (turn/curator.ts): only the
      // question, the reply and the schema. The same turn port and the same
      // request line — nothing new crosses the wire.
      const messages = buildCuratorMessages({ question, reply });
      let curated: TurnResult;
      try {
        curated = await turn.sendMessages(managerRoute, messages);
      } catch {
        curated = { kind: "error", sentence: ASK_CURATOR_FAILED_SENTENCE };
      }
      if (curated.kind !== "answer" || curated.text === "") {
        return {
          ...sent,
          curator: {
            left: true,
            ending: askEndingOf(curated),
            manager: modelAuthorName(manager.model.name, manager.model.id),
            task: modelAuthorName(resolved.model.name, resolved.model.id),
            raw: curated.kind === "answer" ? curated.text : null,
            read: null,
            sentence: ASK_CURATOR_FAILED_SENTENCE,
          },
        };
      }
      return {
        ...sent,
        curator: {
          left: true,
          ending: "answered",
          manager: modelAuthorName(manager.model.name, manager.model.id),
          task: modelAuthorName(resolved.model.name, resolved.model.id),
          raw: curated.text,
          read: readCuratorAnswer(curated.text, reply),
          sentence: null,
        },
      };
    },
    [turn, workspacePath],
  );

  /**
   * STORY 17.10 — THE ONE EMPTY-ASK WRITE, shared by BOTH roads to an ask card:
   * the ground bubble's ASK door (no source) and a reference card's verb (a
   * source). The user's correction is the shape: an ask is a PEER card, born
   * EMPTY — no anchor, no theme, nothing from the press but the point. The
   * conversation file appears with the first turn, not here: a card that has
   * never been asked in has no conversation to invent.
   *
   * `ask about this` now means exactly what the double-click's ask means PLUS
   * one thing: the reference is WIRED INTO the new card (17.9's mechanism — the
   * wire is the context; no anchor is written). Both records land in ONE queued
   * step, the ask line first and the wire second, so the wire can never point
   * at a card that is not there. STORY 17.8 adds the authored lines to the log
   * (`ask.add`, then `link.add`) and the new line to MAP.md.
   */
  const writeEmptyAsk = useCallback(
    (
      sourceSlug: string | null,
      name: string,
      x: number,
      y: number,
    ): Promise<GroundAddResult> => {
      const refusal = askRefusal(name);
      if (refusal !== null) return Promise.resolve({ ok: false, message: refusal });
      if (
        sourceSlug !== null &&
        !referencesRef.current.some((reference) => reference.on === sourceSlug)
      ) {
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
            name,
            x,
            y,
            undefined,
            // STORY 18.3 — the third family: a new ask can never twin a card.
            sessionsRef.current,
          );
          asksRef.current = written.asks;
          let wired: string | null = null;
          if (sourceSlug !== null) {
            const nextLinks = addGroundLink(
              linksRef.current,
              sourceSlug,
              written.ask.on,
            );
            await saveGroundLinks(
              workspacePath,
              nextLinks,
              malformedLinksRef.current,
            );
            linksRef.current = nextLinks;
            wired = sourceSlug;
          }
          setState(snapshot());
          // The new slug rides back so the layer can OPEN the card the person
          // just asked for — the composer is the next thing they need.
          outcome = { ok: true, created: written.ask.on };
          // STORY 17.8/17.10: the authored lines join the log — the slug, the
          // wire's ordered pair (structure only, no words) — and MAP.md follows.
          queueHistory(() => {
            const at = Date.now();
            const events = [askAddEvent(at, written.ask.on)];
            if (wired !== null) {
              events.push(linkAddEvent(at, wired, written.ask.on));
            }
            return events;
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

  /** STORY 17.1/17.10 — `ask about this`: an empty ask card PLUS the wire. */
  const createAsk = useCallback(
    (
      sourceSlug: string,
      name: string,
      x: number,
      y: number,
    ): Promise<GroundAddResult> => writeEmptyAsk(sourceSlug, name, x, y),
    [writeEmptyAsk],
  );

  /** STORY 17.10 — the bubble's ASK door: the point and nothing else. */
  const createEmptyAsk = useCallback(
    (name: string, x: number, y: number): Promise<GroundAddResult> =>
      writeEmptyAsk(null, name, x, y),
    [writeEmptyAsk],
  );

  /**
   * STORY 16.19 — THE SELECTION'S ASK: an EMPTY peer ask card beside the source,
   * wired to it, its line carrying the chosen words and their source. The user's
   * correction is the shape: the selection is CONTEXT, so nothing is copied and
   * the source card's record, reading and note are never written.
   *
   * THE REFUSALS RUN BEFORE THE QUEUE, PURE: no words answers one sentence (the
   * widget never exists for an empty selection, and this is the rule behind
   * that), no question answers the ask's existing sentence, and a source this
   * map does not carry answers the ask's existing one. Nothing is written by a
   * refusal.
   *
   * The new card's NAME is the 17.10 sentinel: the FIRST QUESTION names it (the
   * card's own send path does that), so the person never has to name a card
   * before asking in it. The slug rides back so the layer can open the card and
   * hand it the question.
   *
   * PROVISIONAL: the beside-the-source placement (17.1's offset, reused), the
   * "Untitled ask" sentinel and the chosen-words record fields.
   */
  const askFromSelection = useCallback(
    (
      sourceSlug: string,
      words: string,
      question: string,
    ): Promise<GroundAddResult> => {
      if (selectionWordsRefusal(words) !== null) {
        return Promise.resolve({
          ok: false,
          message: CHOSEN_WORDS_REFUSAL,
        });
      }
      const asked = askQuestionRefusal(question);
      if (asked !== null) {
        return Promise.resolve({ ok: false, message: asked });
      }
      const source = referencesRef.current.find(
        (reference) => reference.on === sourceSlug,
      );
      if (source === undefined) {
        return Promise.resolve({ ok: false, message: ASK_SOURCE_REFUSAL });
      }
      const at = besidePlacement(source.x, source.y);
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const written = await writeSelectionAsk(
            workspacePath,
            referencesRef.current,
            asksRef.current,
            malformedAsksRef.current,
            linksRef.current,
            malformedLinksRef.current,
            sourceSlug,
            words,
            ASK_UNTITLED_NAME,
            at.x,
            at.y,
            sessionsRef.current,
          );
          if (written === null) {
            outcome = { ok: false, message: ASK_SOURCE_REFUSAL };
            return;
          }
          asksRef.current = written.asks;
          linksRef.current = written.links;
          setState(snapshot());
          outcome = { ok: true, created: written.ask.on };
          // The authored lines the bubble's ask door also writes: the card's
          // appearance, then the wire's ordered pair (structure only, no words).
          queueHistory(() => {
            const at2 = Date.now();
            return [
              askAddEvent(at2, written.ask.on),
              linkAddEvent(at2, sourceSlug, written.ask.on),
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
   * STORY 17.10 — RENAME one ask card. One queued write of `map/asks.txt`;
   * the name is the person's and the SLUG is identity (wire target and
   * conversation file), so nothing else moves. A blank name refuses before the
   * queue, an unknown slug answers the one sentence. The anchor is legacy
   * display and this path cannot write one.
   */
  const renameAskTo = useCallback(
    (slug: string, name: string): Promise<GroundAddResult> => {
      const refusal = askRefusal(name);
      if (refusal !== null) return Promise.resolve({ ok: false, message: refusal });
      if (!asksRef.current.some((ask) => ask.on === slug)) {
        return Promise.resolve({ ok: false, message: ASK_MISSING_REFUSAL });
      }
      const now = name.trim();
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          // STORY 16.22 — the name the line HAD, read in the queue so two
          // renames in a row each name the right 'from'.
          const was = asksRef.current.find((ask) => ask.on === slug);
          const next = renameAsk(asksRef.current, slug, name.trim());
          if (next === null) {
            outcome = { ok: false, message: ASK_MISSING_REFUSAL };
            return;
          }
          await saveAsks(workspacePath, next, malformedAsksRef.current);
          asksRef.current = next;
          setState(snapshot());
          outcome = { ok: true };
          // STORY 16.22 — A COMMITTED RENAME IS AN AUTHORED MOVE: ONE line
          // naming the family, the slug and BOTH names — never a word of the
          // card's conversation. A same-name commit is not an edit, so it logs
          // nothing (and nothing was changed in the record either).
          if (was !== undefined && was.name !== now) {
            const from = was.name;
            queueHistory(() => [
              cardRenameEvent(Date.now(), "ask", slug, from, now),
            ]);
          }
          // A rename changes the NAME, so the derived mirror follows it.
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
   * STORY 16.22 — RENAME one session card. One queued write of
   * `map/sessions.txt`; the name is the person's and the SLUG is identity (the
   * transcript's file name and a wire's endpoint), so nothing else moves and the
   * transcript is never read or written. A blank field stores the family's
   * untitled sentence — this family has no refusal for one, unlike the ask
   * card — and an unknown slug answers the one sentence. A committed rename
   * writes ONE `card.rename` history line carrying both names, never content;
   * a same-name commit writes no line.
   */
  const renameSessionTo = useCallback(
    (slug: string, name: string): Promise<GroundAddResult> => {
      if (!sessionsRef.current.some((session) => session.on === slug)) {
        return Promise.resolve({ ok: false, message: SESSION_MISSING_REFUSAL });
      }
      // The name the record will hold, by the family's OWN rule (a blank field
      // becomes the untitled sentence here, and never a refusal).
      const now = sessionNameForWrite(name);
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          // STORY 16.22 — the name the line HAD, read in the queue so two
          // renames in a row each name the right 'from'.
          const was = sessionsRef.current.find((session) => session.on === slug);
          const next = renameSession(sessionsRef.current, slug, name);
          if (next === null) {
            outcome = { ok: false, message: SESSION_MISSING_REFUSAL };
            return;
          }
          await saveSessions(workspacePath, next, malformedSessionsRef.current);
          sessionsRef.current = next;
          setState(snapshot());
          outcome = { ok: true };
          // STORY 16.22 — ONE line per real rename, structure only: the family,
          // the slug and both names. The transcript is not read, not sized and
          // not quoted here.
          if (was !== undefined && was.name !== now) {
            const from = was.name;
            queueHistory(() => [
              cardRenameEvent(Date.now(), "session", slug, from, now),
            ]);
          }
          // The session's name is what MAP.md prints, so the mirror follows.
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
   * STORY 16.23 — MOVE one ask card: the card's ONE line gains its dropped
   * point and nothing else changes. The write is the reference path's shape
   * through the SAME queue — one read-modify-write, the record file only — so
   * the movers can never drift.
   *
   * STORY 16.24 — A MOVE IS A MOVE. A reference's drop has appended
   * `card.move` since 16.10, and this path appends the SAME event, after the
   * record write and through the same queue: the shared slug space makes one
   * slug and one point name exactly one card, so no `kind` is needed. A drop
   * that rounds back onto the card's own point appends nothing. (16.23's spec
   * said moves were not logged and this story's comments repeated it; that was
   * wrong — the log covered the reference family alone — so the log is
   * corrected here, not the claim preserved.)
   *
   * There is no mirror rewrite: MAP.md never printed a point, so nothing
   * derived moved.
   */
  const moveAsk = useCallback(
    (slug: string, x: number, y: number): Promise<GroundAddResult> => {
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          // The point the record held before this drop, read in the queue.
          const was = asksRef.current.find((ask) => ask.on === slug);
          const result = await moveAskRecords(
            workspacePath,
            slug,
            x,
            y,
            asksRef.current,
            malformedAsksRef.current,
          );
          // The card left before the drop landed: nothing is written, and no
          // sentence is invented for a card that is no longer there.
          const moved = result.moved;
          if (moved === null) {
            outcome = { ok: false, message: ASK_MISSING_REFUSAL };
            return;
          }
          asksRef.current = result.asks;
          setState(snapshot());
          outcome = { ok: true };
          // STORY 16.24 — the SAME line the reference path writes, after the
          // record's own write; a drop on the card's own point is no move.
          if (moveChangedThePoint(was, moved)) {
            queueHistory(() => [
              cardMoveEvent(Date.now(), slug, moved.x, moved.y),
            ]);
          }
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
   * STORY 16.23 — MOVE one session card: the same one-line write and the same
   * one queue, and no mirror rewrite. The transcript is never read: a point is
   * not a run. STORY 16.24 — the drop logs the shared `card.move` after the
   * record write, exactly as the reference and ask paths do; a drop that lands
   * on the card's own point logs none.
   */
  const moveSession = useCallback(
    (slug: string, x: number, y: number): Promise<GroundAddResult> => {
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          // The point the record held before this drop, read in the queue.
          const was = sessionsRef.current.find(
            (session) => session.on === slug,
          );
          const result = await moveSessionRecords(
            workspacePath,
            slug,
            x,
            y,
            sessionsRef.current,
            malformedSessionsRef.current,
          );
          const moved = result.moved;
          if (moved === null) {
            outcome = { ok: false, message: SESSION_MISSING_REFUSAL };
            return;
          }
          sessionsRef.current = result.sessions;
          setState(snapshot());
          outcome = { ok: true };
          // STORY 16.24 — one shared line, after the record's own write; a
          // no-op drop says nothing.
          if (moveChangedThePoint(was, moved)) {
            queueHistory(() => [
              cardMoveEvent(Date.now(), slug, moved.x, moved.y),
            ]);
          }
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
   * STORY 17.5 — FORK an ask card at a turn. ONE queued write of
   * `map/asks.txt`: the new line inherits the parent's anchor and records
   * `from`/`carry`, the slug is minted in the shared ground space, and the new
   * card is placed beside its parent by the caller's point. The parent's
   * conversation file is not written, not copied and not re-stamped; the fork
   * reads the prefix from it later. A blank name or a parent this file does not
   * carry refuses with one sentence before anything is queued.
   */
  const forkAskAt = useCallback(
    (
      parentSlug: string,
      carry: number,
      name: string,
      x: number,
      y: number,
    ): Promise<GroundAddResult> => {
      const refusal = askRefusal(name);
      if (refusal !== null) return Promise.resolve({ ok: false, message: refusal });
      if (!asksRef.current.some((ask) => ask.on === parentSlug)) {
        return Promise.resolve({ ok: false, message: ASK_MISSING_REFUSAL });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const written = await writeForkAsk(
            workspacePath,
            referencesRef.current,
            asksRef.current,
            malformedAsksRef.current,
            parentSlug,
            carry,
            name,
            x,
            y,
            undefined,
            // STORY 18.3 — the third family: a fork can never twin a card.
            sessionsRef.current,
          );
          if (written === null) {
            outcome = { ok: false, message: ASK_MISSING_REFUSAL };
            return;
          }
          asksRef.current = written.asks;
          setState(snapshot());
          outcome = { ok: true, created: written.ask.on };
          // STORY 17.8: one line names the branch (the new card, its parent and
          // the carried turn count — structure, never the parent's words), and
          // MAP.md gains the fork's line with its parent.
          queueHistory(() => [
            askForkEvent(
              Date.now(),
              written.ask.on,
              parentSlug,
              written.ask.carry ?? 0,
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

  // STORY 17.10 (the addendum) — THE RE-ANCHOR VERB IS GONE. A verb that no
  // longer changes what a turn sends is worse than no verb. The anchor field
  // stays DISPLAY-ONLY legacy on old records (17.6's dangling sentence still
  // reads); no path in this file writes one, and the reference verb's road is
  // the wire above, not a field.

  /**
   * STORY 17.8 — REMOVE one ask card, immediately and reversibly. The same
   * promise the reference cards make: the record line and the conversation's
   * BYTES are read BEFORE anything is written or unlinked, the line leaves
   * first (the record is the truth), then the conversation file goes. The
   * toast's Restore writes both back verbatim.
   *
   * A conversation file that could not be unlinked answers ONE sentence after
   * the line is already gone and becomes an ORPHAN the notices group names —
   * kept where it is, never adopted, never deleted a second time.
   */
  const removeAsk = useCallback(
    (slug: string): Promise<GroundAddResult> => {
      if (!asksRef.current.some((ask) => ask.on === slug)) {
        return Promise.resolve({ ok: false, message: ASK_MISSING_REFUSAL });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const removal = await removeAskRecords(
            workspacePath,
            slug,
            asksRef.current,
            malformedAsksRef.current,
          );
          // Belt and braces: the list checked before the queue is the list the
          // task runs against; if it moved, nothing was kept and nothing is
          // logged (a delete of a card that is already gone is not a move).
          if (removal.removed === null) {
            outcome = { ok: false, message: ASK_MISSING_REFUSAL };
            return;
          }
          asksRef.current = removal.asks;
          const turns = { ...askTurnsRef.current };
          delete turns[slug];
          askTurnsRef.current = turns;
          // A conversation the unlink could not take is an ORPHAN now: said in
          // the notices group and in the mirror's unknowns, and never deleted.
          if (removal.refusal !== null) {
            orphanAskTurnsRef.current = [
              ...new Set([...orphanAskTurnsRef.current, slug]),
            ].sort();
          }
          // ONE TOAST: the ask card's deletion replaces any pending reference
          // restore (a second delete commits the first).
          restorableRef.current = null;
          // STORY 18.5: ONE toast — an ask delete commits any pending session
          // restore too.
          restorableSessionRef.current = null;
          restorableAskRef.current = pendingRestoreAfter(
            restorableAskRef.current,
            removal.removed,
          );
          restoreNoticeRef.current = null;
          setState(snapshot());
          outcome =
            removal.refusal === null
              ? { ok: true }
              : {
                  ok: false,
                  message: removal.refusal,
                  recordsRemoved: true,
                };
          // STORY 17.8: the removal is an authored move — the slug only.
          queueHistory(() => [askRemoveEvent(Date.now(), slug)]);
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
   * STORY 18.5 — REMOVE one session card, immediately and reversibly. The same
   * promise the other two kinds make: the record line and the transcript's
   * BYTES are read BEFORE anything is written or unlinked, the line leaves
   * first (the record is the truth), then the transcript file goes. The toast's
   * Restore writes both back verbatim.
   *
   * ONE RUN AT A TIME still holds: a live run is still writing its transcript,
   * so a card with a run in flight refuses with the existing busy sentence and
   * nothing is removed. A transcript that could not be unlinked answers ONE
   * sentence after the line is already gone and becomes an ORPHAN the notices
   * group names — kept where it is, never adopted, never deleted a second time.
   */
  const removeSession = useCallback(
    (slug: string): Promise<GroundAddResult> => {
      if (!sessionsRef.current.some((session) => session.on === slug)) {
        return Promise.resolve({ ok: false, message: SESSION_MISSING_REFUSAL });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          if (sessionRunsRef.current[slug] !== undefined) {
            outcome = { ok: false, message: SESSION_BUSY_SENTENCE };
            return;
          }
          const removal = await removeSessionRecords(
            workspacePath,
            slug,
            sessionsRef.current,
            malformedSessionsRef.current,
          );
          // Belt and braces: the list checked before the queue is the list the
          // task runs against; if it moved, nothing was kept and nothing is
          // logged (a delete of a card that is already gone is not a move).
          if (removal.removed === null) {
            outcome = { ok: false, message: SESSION_MISSING_REFUSAL };
            return;
          }
          sessionsRef.current = removal.sessions;
          const entries = { ...sessionEntriesRef.current };
          delete entries[slug];
          sessionEntriesRef.current = entries;
          // A transcript the unlink could not take is an ORPHAN now: said in
          // the notices group and in the mirror's unknowns, never deleted.
          if (removal.refusal !== null) {
            orphanSessionTranscriptsRef.current = [
              ...new Set([...orphanSessionTranscriptsRef.current, slug]),
            ].sort();
          }
          // ONE TOAST: a session delete replaces any pending other restore.
          restorableRef.current = null;
          restorableAskRef.current = null;
          restorableSessionRef.current = pendingRestoreAfter(
            restorableSessionRef.current,
            removal.removed,
          );
          restoreNoticeRef.current = null;
          setState(snapshot());
          outcome =
            removal.refusal === null
              ? { ok: true }
              : {
                  ok: false,
                  message: removal.refusal,
                  recordsRemoved: true,
                };
          // STORY 18.5: the removal is an authored move — the slug only.
          queueHistory(() => [sessionRemoveEvent(Date.now(), slug)]);
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
   * STORY 18.3 — MAKE A SESSION CARD. One queued write of `map/sessions.txt`;
   * no reading, no note, no media, no link and NO transcript (a card that has
   * never run has nothing to say). The tool row is NAMED by id, and a row this
   * build does not ship cannot be bound: the bubble offers only shipped rows,
   * and a card that could never run is not made. The slug is minted in the
   * SHARED space — ground, asks and sessions — so a third family can never coil
   * a twin.
   *
   * STORY 18.5 gives the creation its two memories: one `session.add` line
   * (the slug only) and MAP.md's sessions section, queued after the record like
   * every other authored move.
   */
  const createSession = useCallback(
    (
      name: string,
      tool: string,
      x: number,
      y: number,
    ): Promise<GroundAddResult> => {
      const refusal = sessionRefusal(name);
      if (refusal !== null) return Promise.resolve({ ok: false, message: refusal });
      if (shippedAcpSpec(tool) === null) {
        return Promise.resolve({ ok: false, message: SESSION_NO_TOOL_REFUSAL });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const written = await writeSessionCard(
            workspacePath,
            referencesRef.current,
            asksRef.current,
            sessionsRef.current,
            malformedSessionsRef.current,
            name,
            tool,
            x,
            y,
          );
          sessionsRef.current = written.sessions;
          sessionEntriesRef.current = {
            ...sessionEntriesRef.current,
            [written.session.on]: [],
          };
          setState(snapshot());
          outcome = { ok: true };
          // STORY 18.5: a card appeared — one structural line, and MAP.md's
          // sessions section gains its line in the same queue.
          queueHistory(() => [
            sessionAddEvent(Date.now(), written.session.on),
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
   * STORY 18.3 — BIND a card whose tool row is gone to another row: ONE field's
   * change, ONE queued write, and the transcript and the point are untouched.
   * A card that is running refuses (the run must not change under it), and a
   * row this build does not ship is not bound.
   */
  const bindSessionTool = useCallback(
    (slug: string, tool: string): Promise<GroundAddResult> => {
      if (!sessionsRef.current.some((session) => session.on === slug)) {
        return Promise.resolve({ ok: false, message: SESSION_MISSING_REFUSAL });
      }
      if (sessionRunsRef.current[slug] !== undefined) {
        return Promise.resolve({ ok: false, message: SESSION_BUSY_SENTENCE });
      }
      if (shippedAcpSpec(tool) === null) {
        return Promise.resolve({ ok: false, message: SESSION_NO_TOOL_REFUSAL });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const next = await bindSessionCard(
            workspacePath,
            sessionsRef.current,
            malformedSessionsRef.current,
            slug,
            tool,
          );
          if (next === null) {
            outcome = { ok: false, message: SESSION_MISSING_REFUSAL };
            return;
          }
          sessionsRef.current = next;
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
   * STORY 18.3 — RUN one session card. The row's 18.2 lifecycle starts here,
   * and EVERY progress entry is appended to the transcript the moment it
   * arrives (whole lines, in arrival order), so the card watches the run from
   * the file it is writing.
   *
   * ONE RUN PER CARD AT A TIME: the live handles are view state, and a second
   * press answers one sentence rather than starting a second child. The slug
   * leaves the running list the instant the run settles — a stopped or failed
   * run can never leave its stop verb (or a spinner) standing.
   *
   * The result says only whether the RECORD could keep up: the ENDING is the
   * transcript's own `ended` line, which the card reads back from the file, so
   * the view and a reopen show the same bytes.
   */
  const runSession = useCallback(
    (slug: string): Promise<GroundAddResult> => {
      const session = sessionsRef.current.find((entry) => entry.on === slug);
      if (session === undefined) {
        return Promise.resolve({ ok: false, message: SESSION_MISSING_REFUSAL });
      }
      if (sessionRunsRef.current[slug] !== undefined) {
        return Promise.resolve({ ok: false, message: SESSION_BUSY_SENTENCE });
      }
      const row = shippedAcpSpec(session.tool);
      if (row === null) {
        return Promise.resolve({ ok: false, message: SESSION_NO_TOOL_REFUSAL });
      }
      const started = beginSessionRun(workspacePath, row, slug, {
        // The view follows each entry as the run reports it. The file is the
        // record; this is the same arrival order, one render behind the write.
        onEntry: (entry) => {
          const current = sessionEntriesRef.current[slug] ?? [];
          sessionEntriesRef.current = {
            ...sessionEntriesRef.current,
            [slug]: [...current, entry],
          };
          setState(snapshot());
        },
        // STORY 18.4 — THE PERSON'S SURFACE. The ask is held as view state so
        // the card can say what the tool wants and offer allow-once/refuse; the
        // run itself is WAITING in the sidecar until this card answers.
        onPermission: (ask) => {
          sessionPermissionRef.current = {
            ...sessionPermissionRef.current,
            [slug]: ask,
          };
          setState(snapshot());
        },
      });
      sessionRunsRef.current = {
        ...sessionRunsRef.current,
        [slug]: started.handle,
      };
      sessionRunningRef.current = [...sessionRunningRef.current, slug];
      setState(snapshot());
      return started.done
        .then(async (done): Promise<GroundAddResult> => {
          const runs = { ...sessionRunsRef.current };
          delete runs[slug];
          sessionRunsRef.current = runs;
          sessionRunningRef.current = sessionRunningRef.current.filter(
            (running) => running !== slug,
          );
          // A settled run has no pending ask: the card's two verbs go with the
          // run that offered them, whether it was answered or timed out.
          const permissions = { ...sessionPermissionRef.current };
          delete permissions[slug];
          sessionPermissionRef.current = permissions;
          // Read the transcript BACK from the file: the card then shows the
          // same bytes a reopen would, never a second in-memory truth.
          const transcript = await loadSessionTranscript(workspacePath, slug);
          sessionEntriesRef.current = {
            ...sessionEntriesRef.current,
            [slug]: transcript.entries,
          };
          setState(snapshot());
          // STORY 18.5 — THE RUN'S ONE MOVE, after it settles. ONE PRISM is
          // appended through the contact log's own queue, with the tool ROW's
          // id, the ending and the result's size — and NOT ONE WORD of what the
          // run said. The ending comes from the ONE mapping the history's
          // `session.run` line uses, so the two records never disagree.
          const ending = runOutcomeOf(done.ending);
          let moveRefusal: string | null = null;
          try {
            await appendSessionRun({
              workspacePath,
              on: slug,
              tool: session.tool,
              outcome: ending,
              resultSize: sessionResultSize(done.entries),
            });
          } catch {
            moveRefusal = SESSION_MOVE_REFUSAL;
          }
          // The run moved the card's last ending, so the log and the mirror
          // follow: one line for the run, and MAP.md's line says how it ended.
          queueHistory(() => [sessionRunEvent(Date.now(), slug, ending)]);
          queueMirror();
          if (done.notice !== null) {
            return { ok: false, message: done.notice };
          }
          return moveRefusal === null
            ? { ok: true }
            : { ok: false, message: moveRefusal };
        })
        .catch(() => ({
          ok: false,
          message: SESSION_TRANSCRIPT_REFUSAL,
        }));
    },
    [workspacePath],
  );

  /**
   * STORY 18.3 — STOP the live run. The run's OWN cancel (18.2): session/cancel
   * first, a short grace, then the child — killed on that path like every other.
   * What arrived stays, and the ending the run writes says it was stopped. A
   * press with nothing running writes nothing at all.
   */
  const stopSession = useCallback(async (slug: string): Promise<void> => {
    const handle = sessionRunsRef.current[slug];
    if (handle === undefined) return;
    handle.cancel();
  }, []);

  /**
   * STORY 18.4 — THE PERSON'S ANSWER. One press, one verb, one line up. The
   * pending block clears at once so a second press cannot answer the same ask
   * twice; a reply that cannot leave leaves the run to its budget, which is the
   * honest ending. No default allow exists here: with nothing pending the press
   * does nothing.
   */
  const answerSessionPermission = useCallback(
    async (slug: string, choice: AcpPermissionChoice): Promise<void> => {
      const ask = sessionPermissionRef.current[slug];
      const handle = sessionRunsRef.current[slug];
      if (ask === undefined || handle === undefined) return;
      const permissions = { ...sessionPermissionRef.current };
      delete permissions[slug];
      sessionPermissionRef.current = permissions;
      setState(snapshot());
      handle.answerPermission(ask.id, choice);
    },
    [],
  );

  /**
   * STORY 18.4 — MAKE A CARD OUT OF THE LAST COMPLETED RUN'S TEXT. It goes
   * through the same queue as every write, and it writes the selection form's
   * three pieces (text, reading line, ground line) in the house order. A run
   * with no text, or a last run that did not complete, answers one sentence and
   * writes NOTHING — an empty card is never invented.
   */
  const makeCardFromRun = useCallback(
    (slug: string): Promise<GroundAddResult> => {
      const session = sessionsRef.current.find((entry) => entry.on === slug);
      if (session === undefined) {
        return Promise.resolve({ ok: false, message: SESSION_MISSING_REFUSAL });
      }
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          const written = await writeResultCard(
            workspacePath,
            referencesRef.current,
            readingsRef.current,
            malformedGroundRef.current,
            malformedReadingsRef.current,
            session,
            sessionEntriesRef.current[slug] ?? [],
            new Date().toISOString(),
            undefined,
            // STORY 18.3 — ALL THREE FAMILIES: the copy's slug joins the same
            // shared space every new card mints against.
            {
              taken: sharedSlugs(
                referencesRef.current,
                asksRef.current,
                sessionsRef.current,
              ),
            },
          );
          if (written.kind === "refused") {
            outcome = { ok: false, message: written.message };
            return;
          }
          const { records, text } = written;
          referencesRef.current = records.references;
          readingsRef.current = records.readings;
          textsRef.current = {
            ...textsRef.current,
            [records.reading.on]: text,
          };
          statesRef.current = {
            ...statesRef.current,
            [records.reading.on]: "current" as ReadingState,
          };
          setState(snapshot());
          outcome = { ok: true };
          // The copy is an ordinary card: its appearance is an authored move,
          // and the derived index follows like any other add.
          const placed = records.references.find(
            (reference) => reference.on === records.reading.on,
          );
          // STORY 18.5: the copy's appearance, then the join — session.result
          // names the card that was made and the session it came from.
          queueHistory(() => {
            const at = Date.now();
            return [
              cardAddEvent(
                at,
                records.reading.on,
                placed?.x ?? Math.round(session.x),
                placed?.y ?? Math.round(session.y),
              ),
              sessionResultEvent(at, records.reading.on, slug),
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
   * STORY 17.1 — ASK ONE QUESTION inside an ask card. STORY 17.3 makes the
   * question a packet; STORY 17.9 corrects whose facts ride in it: the cards
   * WIRED INTO this one, never the legacy anchor field, PLUS this card's
   * conversation under the stated bound (the newest WHOLE turns that fit a turn
   * count and a byte budget — map/asks.ts's lastTurns). The READ set names the
   * INCLUDED wired cards, never a turn. Then ONE append-only write records
   * the exchange: the person's line always, the answer line only when the turn
   * answered. A failed or stopped turn leaves the person's line alone and
   * answers the ONE sentence in the card.
   *
   * STORY 17.4 — EVERY SENDING TURN IS A MOVE: when the packet actually left,
   * ONE PRISM is appended through the Ask machinery (contacts/prismLog.ts's
   * queue, the Ask's own commit), naming the card the Move is made in, the
   * anchor's slug, the inclusion set, the ending and — only when one came back
   * — the response's exact size and decode. NOT ONE WORD rides in it. The
   * PRISM lands BEFORE the conversation so the answer line can name its id
   * (PROVISIONAL ordering, the story's own note); a turn that never left (no
   * provider) appends nothing, and neither does a draft.
   *
   * STORY 17.11 — A COMPLETED TURN LEAVES AN ARTIFACT: after the words are
   * recorded, one reference card is made beside this one, its reading the
   * reply's exact bytes (`form: distilled`, ADR-0037's first shape), wired
   * back to this ask card. Only a turn that ANSWERED with text makes one; a
   * stop, break, budget or empty reply writes no card and hands the card one
   * quiet line. 17.12: the curator WRITES the card (the distilled text, the
   * two model names), and the ORDER stays 17.11's (text, readings line, ground
   * line, wire).
   */
  const askTurn = useCallback(
    async (
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
      // STORY 17.10 — AN EMPTY CARD NAMES ITSELF FROM ITS FIRST QUESTION. The
      // user's correction made the card a peer, created wordless; the first
      // thing it is asked is the most honest name it can propose, so the
      // "Untitled ask" sentinel becomes the question's one-line short form. A
      // name the person already changed is never overwritten. The rename is
      // queued now, ahead of the turn's own record write, so a reopen reads the
      // name even if the turn is stopped; a failed rename changes no words.
      if (ask.name === ASK_UNTITLED_NAME) {
        const short = askNameFromQuestion(question);
        if (short !== "") {
          void queueRef.current
            .push(async () => {
              const next = renameAsk(asksRef.current, slug, short);
              if (next === null) return;
              await saveAsks(workspacePath, next, malformedAsksRef.current);
              asksRef.current = next;
              setState(snapshot());
              // The mirror follows a name.
              queueMirror();
            })
            .catch(() => {
              // A name is not an answer: a failed rename writes nothing and
              // leaves the card "Untitled ask".
            });
        }
      }
      // THE CONTEXT IS THE WIRES (story 17.9, the user's correction): every
      // card wired INTO this ask card contributes what it has. The record's
      // `anchor` field is legacy and IS NOT READ HERE; a card with no wires
      // still sends, with nothing in its context.
      const contextFacts = askContextFactsOf({
        ask: slug,
        links: linksRef.current,
        references: referencesRef.current,
        asks: asksRef.current,
        askTurns: askTurnsRef.current,
        sessions: sessionsRef.current,
        sessionEntries: sessionEntriesRef.current,
        readings: readingsRef.current,
        texts: textsRef.current,
        notes: notesRef.current,
        states: statesRef.current,
      });
      const wired = askCardsContext(contextFacts.facts);
      const context = wired.context;
      // STORY 17.3 — THE PACKET CARRIES THE CARDS AND THE THREAD: the wired
      // cards' blocks under the context bound, then the conversation so far
      // under its own bound (the newest WHOLE turns that fit). The thread is
      // read from the SAME record the card renders. The READ set is the
      // INCLUDED cards' names, so retrieval can name a wired card and never a
      // turn or an unwired card.
      //
      // STORY 17.5 — A FORK SENDS ITS WHOLE COMPOSED THREAD: the carried prefix
      // (read from the parent's file HERE, at send time, never copied) then the
      // fork's own turns. The thread bound is applied to that composed thread
      // by `assembleAskCardPacket`, so it can never bite twice or per part, and
      // a missing parent simply composes the fork's own turns — the card still
      // sends.
      // STORY 16.26 — THE PAGES ARE OPENED NOW, ONCE EACH, AND THEIR READS
      // RIDE. A page card keeps no transcript (the user's ruling: a thumbnail
      // in the card, the page opened when it is asked), so this is the ONLY
      // moment a page is read: after the press, before the packet is composed,
      // for the wired cards that are pages and no others. A failed read is one
      // sentence in its block and the ask still sends. Nothing here runs at
      // render, and a context with no page never starts the sidecar for one.
      //
      // ONLY THE CARDS THE BOUND KEEPS ARE OPENED: a page whose block will not
      // ride is a read the model never sees, so the selection happens FIRST and
      // the pages are read for exactly the prefix that is about to leave.
      const kept = selectAskContextCards(wired.cards, ASK_CONTEXT_BOUND).cards;
      const opened = await readAskPages(kept, createPageTextFetcher());
      const contextCards = [...opened, ...wired.cards.slice(opened.length)];
      const packet = assembleAskCardPacket(
        contextCards,
        askThreadOf(ask, asksRef.current, askTurnsRef.current).turns,
        question,
        ASK_THREAD_BOUND,
        context.retrievable,
      );
      // THE INCLUDED CARDS' NATURAL KEYS (story 17.9): only the cards the
      // packet's own bound kept contribute a reading's pointer key. The PRISM
      // no longer names an anchor at all.
      const inclusion = askContextInclusion(
        selectAskContextCards(wired.cards, ASK_CONTEXT_BOUND).cards,
        readingsRef.current,
      );
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      try {
        const sent = await sendAskQuestion(packet, context, question, onPart);
        await queueRef.current.push(async () => {
          // ONE PRISM PER SENDING TURN (story 17.4), then the words: the
          // Move lands first because the answer line names its id. A turn
          // that never left the machine — no provider, no port — is not a
          // Move and records nothing.
          const recorded = await writeAskTurn(
            workspacePath,
            slug,
            inclusion,
            question,
            sent,
          );
          askTurnsRef.current = {
            ...askTurnsRef.current,
            [slug]: recorded.turns,
          };
          // STORY 17.11 — THE ARTIFACT, and only for a COMPLETED turn
          // (ADR-0037's first story: the node and the wire before the
          // curator). The rule asks ONE question — did this turn answer with
          // text? — and otherwise writes nothing but the one line. The
          // reply's bytes are the answer line's, copied, never moved. Placed
          // beside the ask card it came from and wired back to it, in the
          // house order (text, readings line, ground line, then the wire).
          const noCard = askTurnCardNote(sent);
          // STORY 17.12 — WHEN THE CURATOR MADE A CARD, ITS FIELDS ARE THE
          // CARD: the title names the node, the distilled text is the
          // reading, and the two model ids are the provenance. A turn whose
          // caller predates the curator still writes 17.11's rule copy, so
          // the writer has exactly one call site for both.
          const curated =
            sent.curator?.read?.kind === "card" ? sent.curator.read : null;
          const curatedAuthors =
            curated === null || sent.curator === undefined
              ? undefined
              : { manager: sent.curator.manager, task: sent.curator.task };
          let cardRefusal: string | null = null;
          // STORY 17.15 — the card this turn makes, so the layer can take the
          // eye to it (the ask card stops being the one that is open).
          let made: string | undefined;
          if (noCard === null) {
            const askNow =
              asksRef.current.find((entry) => entry.on === slug) ?? ask;
            const cardName =
              curated?.card.title ||
              askNameFromQuestion(question) ||
              askNow.name;
            // STORY 17.15 — THE ARTIFACT LANDS RIGHT: to the RIGHT of the ask
            // card, level with it, and every later artifact from the same card
            // cascades DOWN past the ones already there. The source's RESTING
            // box is the measure (the same box the wire anchors to), never the
            // expanded face it wears while the person is typing.
            const at = artifactPlacement(
              { x: askNow.x, y: askNow.y },
              artifactsMadeFrom(
                slug,
                referencesRef.current,
                readingsRef.current,
              ),
            );
            const written = await writeDistilledCard(
              workspacePath,
              referencesRef.current,
              readingsRef.current,
              linksRef.current,
              malformedGroundRef.current,
              malformedReadingsRef.current,
              malformedLinksRef.current,
              slug,
              cardName,
              at.x,
              at.y,
              curated?.text ??
                (sent.result.kind === "answer" ? sent.result.text : ""),
              new Date().toISOString(),
              undefined,
              {
                taken: sharedSlugs(
                  referencesRef.current,
                  asksRef.current,
                  sessionsRef.current,
                ),
              },
              curatedAuthors,
            );
            if (written.kind === "refused") {
              cardRefusal = written.message;
            } else {
              referencesRef.current = written.records.references;
              readingsRef.current = written.records.readings;
              linksRef.current = written.links;
              textsRef.current = {
                ...textsRef.current,
                [written.records.reading.on]: written.text,
              };
              statesRef.current = {
                ...statesRef.current,
                [written.records.reading.on]: "current" as ReadingState,
              };
              // The copy is an ordinary card: its appearance is an authored
              // move, so the derived index follows like any other add. The
              // wire itself is structure, not a history event.
              made = written.records.reading.on;
              const madeOn = written.records.reading.on;
              queueHistory(() => [
                cardAddEvent(
                  Date.now(),
                  madeOn,
                  written.reference.x,
                  written.reference.y,
                ),
              ]);
              queueMirror();
            }
          }
          // STORY 17.8 — THE TURN'S LINE, in the stated order: the PRISM and
          // the conversation line are already written by `writeAskTurn` (the
          // Move first, so the answer line can name its id), and the history
          // line follows them in this same queue. Its ending is the PRISM's
          // own outcome through ONE mapping (askTurnHistoryEvent), so the two
          // records can never disagree; a turn that never left the app made
          // no Move and gets no line. The mirror is queued only when a card
          // was made above (a turn alone adds nothing MAP.md describes).
          queueHistory(() => {
            const event = askTurnHistoryEvent(
              Date.now(),
              slug,
              sent.ending,
              recorded.prism,
            );
            return event === null ? [] : [event];
          });
          setState(snapshot());
          // STORY 17.7b: the turn's hit facts ride out with the words, on
          // either ending — the card says what happened beside the turn.
          const noCardLine = noCard === null ? {} : { noCard };
          outcome =
            cardRefusal !== null
              ? {
                  ok: false,
                  message: cardRefusal,
                  readback: sent.result.readback,
                  reached: sent.reached,
                  missed: sent.missed,
                  ...noCardLine,
                }
              : recorded.sentence === null
                ? {
                    ok: true,
                    readback: sent.result.readback,
                    reached: sent.reached,
                    missed: sent.missed,
                    // STORY 17.15: the layer opens the artifact this turn made.
                    ...(made === undefined ? {} : { created: made }),
                    ...noCardLine,
                  }
                : {
                    ok: false,
                    message: recorded.sentence,
                    readback: sent.result.readback,
                    reached: sent.reached,
                    missed: sent.missed,
                    ...noCardLine,
                  };
        });
      } catch {
        return { ok: false, message: "cannot write the map folder." };
      }
      return outcome;
    },
    [workspacePath, sendAskQuestion],
  );

  /**
   * STORY 17.2 — THE CARD'S STOP. The same port the Ask Move's panel stops; the
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

  /**
   * MOVE: one ground-line write on drop; no reading is touched. STORY 16.24 —
   * one `card.move`, the same line the ask and session paths now write, and a
   * drop that lands on the card's own point writes none (the shared rule).
   */
  const move = useCallback(
    (on: string, x: number, y: number): Promise<GroundAddResult> => {
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          // The point the record held before this drop, read in the queue.
          const was = referencesRef.current.find(
            (reference) => reference.on === on,
          );
          const next = moveGroundReference(referencesRef.current, on, x, y);
          await saveGround(workspacePath, next, malformedGroundRef.current);
          referencesRef.current = next;
          setState(snapshot());
          outcome = { ok: true };
          // Story 16.10: one drop, one line — the point it landed on. Story
          // 16.24: all three families write it, and a no-op drop writes none.
          const placed = next.find((reference) => reference.on === on);
          if (moveChangedThePoint(was, placed)) {
            queueHistory(() => [
              cardMoveEvent(
                Date.now(),
                on,
                placed?.x ?? Math.round(x),
                placed?.y ?? Math.round(y),
              ),
            ]);
          }
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
   * STORY 16.21 — RENAME, from the card's name pill. One line through the same
   * write queue the move uses; the slug, point, reading, note and links are
   * untouched. The mirror is re-rendered because it shows names, and NOTHING is
   * logged: the history's vocabulary has no rename event yet (PROVISIONAL — a
   * later story may coin one; until then a rename is not a silent record
   * change, it is one record's name field).
   */
  const rename = useCallback(
    (on: string, name: string): Promise<GroundAddResult> => {
      let outcome: GroundAddResult = {
        ok: false,
        message: "nothing was written.",
      };
      return queueRef.current
        .push(async () => {
          // STORY 16.22 — the name the line HAD, read HERE, in the queue: after
          // every earlier write has landed, so two renames in a row name the
          // right 'from'. The history carries both names; a same-name commit
          // logs nothing.
          const was = referencesRef.current.find(
            (reference) => reference.on === on,
          );
          const result = await renameGroundRecords(
            workspacePath,
            on,
            name,
            referencesRef.current,
            malformedGroundRef.current,
          );
          referencesRef.current = result.references;
          setState(snapshot());
          if (result.renamed === null) {
            outcome = { ok: false, message: "that card is not on this map." };
            return;
          }
          outcome = { ok: true };
          // STORY 16.22 — A COMMITTED RENAME IS ONE HISTORY LINE: the family,
          // the slug and BOTH names, never the card's content. A same-name
          // commit changes no words and writes no line.
          const now = result.renamed.name;
          if (was !== undefined && result.renamed !== null && was.name !== now) {
            const from = was.name;
            queueHistory(() => [
              cardRenameEvent(Date.now(), "reference", on, from, now),
            ]);
          }
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
          // in BOTH directions. Story 16.10 remembers exactly which links this
          // pass takes, so their passing can be logged as its own lines; story
          // 16.13 keeps each line's FILE POSITION for Restore.
          //
          // STORY 17.9 — EXCEPT THE CONTEXT WIRES: a wire from this card INTO
          // an ask card is that ask card's context, and the user's correction
          // says a deleted context card is SAID, not repaired. So that one
          // wire STAYS, dangling; the ask card says a card wired into it is
          // gone, and restoring this card makes the same wire resolve again.
          const askSlugs = new Set(asksRef.current.map((ask) => ask.on));
          const keepable = (link: GroundLink): boolean =>
            link.from === on && link.to !== on && askSlugs.has(link.to);
          const cascaded = linksRef.current
            .map((link, index) => ({ link, index }))
            .filter(({ link }) => (link.from === on || link.to === on) && !keepable(link));
          const nextLinks = linksRef.current.filter(
            (link) =>
              (!(link.from === on || link.to === on) || keepable(link)),
          );
          await saveGroundLinks(workspacePath, nextLinks, malformedLinksRef.current);
          linksRef.current = nextLinks;
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
          // STORY 17.8: ONE toast — a reference delete commits any pending ask
          // card restore, exactly as it commits an earlier reference's. STORY
          // 18.5 adds the session card's snapshot to the same one toast.
          restorableAskRef.current = null;
          restorableSessionRef.current = null;
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
      // STORY 17.9: a wire may end on any ground card, because anything a wire
      // touches is context for an ask card. The draw's existing guard is reused
      // with the three families' slugs, so a self-link still refuses.
      const refusal = groundLinkRefusal(from, to, knownCardSlugs());
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
    // STORY 17.8: the ONE window covers whichever deletion the toast holds — a
    // reference card's, an ask card's or (18.5) a session card's. All three are
    // committed together so a kind-switch can never leave a stale snapshot
    // behind.
    if (
      state.restorable === null &&
      state.restorableAsk === null &&
      state.restorableSession === null
    ) {
      return;
    }
    const timer = setTimeout(() => {
      restorableRef.current = null;
      restorableAskRef.current = null;
      restorableSessionRef.current = null;
      setState((current) => ({
        ...current,
        restorable: null,
        restorableAsk: null,
        restorableSession: null,
      }));
    }, RESTORE_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [state.restorable, state.restorableAsk, state.restorableSession]);

  /**
   * STORY 16.13 — RESTORE. Through the same queue as every write, the held
   * bytes go back (reading text, note, reading line, links, reference last),
   * and the log records the SECOND move: `card.restore` plus one `link.add`
   * per link that came back. A partial restore answers one sentence naming what
   * came back and what did not; either way the pending restore is spent.
   */
  const restore = useCallback((): Promise<GroundAddResult> => {
    // STORY 17.8 — THE ASK CARD'S OWN RESTORE, first because the one toast
    // holds one deletion: its conversation's bytes go back first, then its line,
    // and the one history line says the card came back. Sharing the sentence,
    // the window and the queue with the reference card's restore is the whole
    // point of one toast.
    // STORY 18.5 — THE SESSION CARD'S OWN RESTORE, through the same one toast:
    // the transcript's bytes go back first (verbatim), then its line, and the
    // one history line says the card came back. A transcript that came back
    // without its line is an ORPHAN — kept, said, never adopted.
    const pendingSession = restorableSessionRef.current;
    if (pendingSession !== null) {
      const sessionSlug = pendingSession.session.on;
      let sessionOutcome: GroundAddResult = {
        ok: false,
        message: "nothing came back.",
      };
      return queueRef.current
        .push(async () => {
          const restored = await restoreSessionCard(
            workspacePath,
            pendingSession,
            sessionsRef.current,
            malformedSessionsRef.current,
            restoreSentence,
          );
          sessionsRef.current = restored.sessions;
          if (restored.restoredSession) {
            // The card is back: its transcript is whatever the file holds now
            // (the bytes that just went back, or none).
            const transcript = await loadSessionTranscript(
              workspacePath,
              sessionSlug,
            );
            sessionEntriesRef.current = {
              ...sessionEntriesRef.current,
              [sessionSlug]: transcript.entries,
            };
            orphanSessionTranscriptsRef.current =
              orphanSessionTranscriptsRef.current.filter(
                (orphan) => orphan !== sessionSlug,
              );
          } else if (restored.cameBack.includes("the transcript")) {
            // The bytes came back but the line did not: the transcript has no
            // card, so it is an ORPHAN — kept, said, never adopted.
            orphanSessionTranscriptsRef.current = [
              ...new Set([...orphanSessionTranscriptsRef.current, sessionSlug]),
            ].sort();
          }
          restorableSessionRef.current = null;
          restoreNoticeRef.current = restored.refusal;
          setState(snapshot());
          sessionOutcome =
            restored.refusal === null
              ? { ok: true }
              : { ok: false, message: restored.refusal };
          // A restore is an AUTHORED move (story 16.13's rule, two families over).
          if (restored.restoredSession) {
            queueHistory(() => [
              sessionRestoreEvent(Date.now(), sessionSlug),
            ]);
          }
          if (restored.cameBack.length > 0) queueMirror();
        })
        .then(() => sessionOutcome)
        .catch(() => ({
          ok: false,
          message: "the map folder could not take the session card back.",
        }));
    }
    const pendingAsk = restorableAskRef.current;
    if (pendingAsk !== null) {
      const askSlug = pendingAsk.ask.on;
      let askOutcome: GroundAddResult = {
        ok: false,
        message: "nothing came back.",
      };
      return queueRef.current
        .push(async () => {
          const restored = await restoreAskCard(
            workspacePath,
            pendingAsk,
            asksRef.current,
            malformedAsksRef.current,
          );
          asksRef.current = restored.asks;
          if (restored.restoredAsk) {
            // The card is back: its conversation is whatever the file holds
            // now (the bytes that just went back, or none).
            const turns = await loadTurns(workspacePath, askSlug);
            askTurnsRef.current = {
              ...askTurnsRef.current,
              [askSlug]: turns.turns,
            };
            orphanAskTurnsRef.current = orphanAskTurnsRef.current.filter(
              (orphan) => orphan !== askSlug,
            );
          } else if (restored.cameBack.includes("the conversation")) {
            // The bytes came back but the line did not: the conversation has no
            // card, so it is an ORPHAN — kept, said, never adopted.
            orphanAskTurnsRef.current = [
              ...new Set([...orphanAskTurnsRef.current, askSlug]),
            ].sort();
          }
          restorableAskRef.current = null;
          restoreNoticeRef.current = restored.refusal;
          setState(snapshot());
          askOutcome =
            restored.refusal === null
              ? { ok: true }
              : { ok: false, message: restored.refusal };
          // A restore is an AUTHORED move (story 16.13's rule, one family over).
          if (restored.restoredAsk) {
            queueHistory(() => [askRestoreEvent(Date.now(), askSlug)]);
          }
          if (restored.cameBack.length > 0) queueMirror();
        })
        .then(() => askOutcome)
        .catch(() => ({
          ok: false,
          message: "the map folder could not take the ask card back.",
        }));
    }
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
    if (
      restorableRef.current === null &&
      restorableAskRef.current === null &&
      restorableSessionRef.current === null &&
      restoreNoticeRef.current === null
    ) {
      return;
    }
    restorableRef.current = null;
    restorableAskRef.current = null;
    restorableSessionRef.current = null;
    restoreNoticeRef.current = null;
    setState((current) => ({
      ...current,
      restorable: null,
      restorableAsk: null,
      restorableSession: null,
      restoreNotice: null,
    }));
  }, []);

  return {
    references: state.references,
    asks: state.asks,
    askTurns: state.askTurns,
    malformedAsks: state.malformedAsks,
    orphanAskTurns: state.orphanAskTurns,
    sessions: state.sessions,
    sessionEntries: state.sessionEntries,
    malformedSessions: state.malformedSessions,
    orphanSessionTranscripts: state.orphanSessionTranscripts,
    sessionRunning: state.sessionRunning,
    sessionPermission: state.sessionPermission,
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
    restorableAsk: state.restorableAsk,
    restorableSession: state.restorableSession,
    restoreNotice: state.restoreNotice,
    loaded: state.loaded,
    createAsk,
    createEmptyAsk,
    askFromSelection,
    renameAskTo,
    renameSessionTo,
    moveAsk,
    moveSession,
    askTurn,
    askStop,
    forkAskAt,
    removeAsk,
    removeSession,
    createSession,
    bindSessionTool,
    runSession,
    stopSession,
    answerSessionPermission,
    makeCardFromRun,
    create,
    createPage,
    createVideo,
    move,
    rename,
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
