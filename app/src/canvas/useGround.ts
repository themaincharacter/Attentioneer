import { useCallback, useEffect, useRef, useState } from "react";
import { fileMeta, removeFile, type FileMetaAnswer } from "../lib/fs";
import { createWriteQueue } from "../lib/writeQueue";
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
  READING_REFUSALS,
  loadReadings,
  loadReadingTexts,
  readingAbsolutePath,
  readingFor,
  readingTextPath,
  refreshReading,
  resolveReadingState,
  saveReadings,
  takeReading,
  withReading,
  withReadingRemoved,
  type Reading,
  type ReadingState,
} from "../map/readings";
import {
  NOTE_IO,
  loadNotes,
  removeNote,
  saveNote,
  type NoteIo,
} from "../map/notes";
import {
  mirrorWriteTask,
  renderMirror,
  type MirrorView,
} from "../map/mirror";
import { pullReading, type PulledText } from "../map/pull";

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
 *   - The whole read-modify-write runs through the app's one per-file
 *     discipline (`createWriteQueue`, ADR-0004/ADR-0018): one line at a time,
 *     never a whole-folder rewrite. THE PULL AND THE MIRROR ARE NOT IN THAT
 *     SENTENCE: a pull is a read, and the mirror is one whole-file rewrite of a
 *     derived file, not a record family's line. The queue still serializes the
 *     mirror's write, so a look never waits on a drop.
 *
 * PROVISIONAL: the state names, the form rule for new picks, the write order,
 * the sentences and the look (story 16.2's decisions, before an ADR).
 */

/** What one person move said: done, or the sentence the layer shows. */
export type GroundAddResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
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
  readings: readonly Reading[];
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
  /** The map folder's ground records have been read once. */
  loaded: boolean;
  /** Add one reference from a picked text file (the one create write). */
  create: (
    name: string,
    x: number,
    y: number,
    from: string,
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
}

/** The view without its verbs: what the load and every write render. */
type GroundLoaded = Omit<
  GroundView,
  | "create"
  | "move"
  | "refresh"
  | "repoint"
  | "remove"
  | "link"
  | "unlink"
  | "setNote"
  | "pull"
  | "dismissPull"
>;

const EMPTY: GroundLoaded = {
  references: [],
  readings: [],
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
  loaded: false,
};

/** The bridges the delete needs; the app passes lib/fs, a test a fake. */
export interface GroundRemovalIo {
  saveGround: typeof saveGround;
  saveReadings: typeof saveReadings;
  removeFile: (path: string) => Promise<void>;
}

/** The real bridges, bound once so this module stays importable in tests. */
const GROUND_REMOVAL_IO: GroundRemovalIo = {
  saveGround,
  saveReadings,
  removeFile,
};

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
  return { references: nextReferences, readings: nextReadings, refusal };
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
 * The states of every reference, from the readings and their metadata (story
 * 16.2). Pure apart from the answers it is handed: one reading per slug, its
 * metadata (or null when there is no reading), and the load's clock.
 */
function statesOf(
  references: readonly GroundReference[],
  readings: readonly Reading[],
  metas: ReadonlyMap<string, FileMetaAnswer>,
  now: number,
): Record<string, ReadingState> {
  const states: Record<string, ReadingState> = {};
  for (const reference of references) {
    states[reference.on] = resolveReadingState(
      readingFor(readings, reference.on),
      metas.get(reference.on) ?? null,
      now,
    );
  }
  return states;
}

/** Stat every reading's file once, in parallel, keyed by slug. */
async function metasOf(
  workspacePath: string,
  readings: readonly Reading[],
): Promise<Map<string, FileMetaAnswer>> {
  const metas = new Map<string, FileMetaAnswer>();
  await Promise.all(
    readings.map(async (reading) => {
      metas.set(
        reading.on,
        await fileMeta(readingAbsolutePath(workspacePath, reading)),
      );
    }),
  );
  return metas;
}

export function useGround(workspacePath: string): GroundView {
  const [state, setState] = useState<GroundLoaded>(EMPTY);
  // Synchronous mirrors: the queued write must never read a stale list.
  const referencesRef = useRef<GroundReference[]>([]);
  const readingsRef = useRef<Reading[]>([]);
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
  // One queue for the ground family's files: an add's ground line must land
  // after its own readings line, never under a stale one; the link and the
  // cascade share it so no link write can land under a stale list.
  const queueRef = useRef(createWriteQueue());

  const reload = useCallback(async () => {
    if (workspacePath === "") return;
    const [ground, readings, groundLinks] = await Promise.all([
      loadGround(workspacePath),
      loadReadings(workspacePath),
      loadGroundLinks(workspacePath),
    ]);
    const slugs = ground.references.map((reference) => reference.on);
    const [texts, metas, loadedNotes] = await Promise.all([
      loadReadingTexts(workspacePath, slugs),
      metasOf(workspacePath, readings.readings),
      // Story 16.6: ONE folder listing, then one read per card that has a
      // note. Orphans are computed from the same listing and never read.
      loadNotes(workspacePath, slugs),
    ]);
    const states = statesOf(
      ground.references,
      readings.readings,
      metas,
      Date.now(),
    );
    // Orphans are COMPUTED, never stored (story 16.5, in `snapshot`): a link
    // naming a slug the map does not carry is kept in the file and named in
    // the notices group.
    referencesRef.current = ground.references;
    readingsRef.current = readings.readings;
    malformedGroundRef.current = ground.malformed;
    malformedReadingsRef.current = readings.malformed;
    malformedLinksRef.current = groundLinks.malformed;
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
    readings: readingsRef.current,
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

  useEffect(() => {
    // A different workspace starts from its own map folder, never the last
    // one's state (and the write queue belongs to the person's moves in it).
    // Story 16.8: a pull belongs to the workspace it was taken in — never
    // carried across, and never written, so there is nothing to reload.
    pulledRef.current = {};
    mirrorNoticeRef.current = null;
    queueRef.current = createWriteQueue();
    if (workspacePath === "") {
      referencesRef.current = [];
      readingsRef.current = [];
      malformedGroundRef.current = [];
      malformedReadingsRef.current = [];
      malformedLinksRef.current = [];
      linksRef.current = [];
      textsRef.current = {};
      statesRef.current = {};
      notesRef.current = {};
      orphanNotesRef.current = [];
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
          const addition = addGroundReference(
            referencesRef.current,
            trimmed,
            x,
            y,
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
          const texts = {
            ...textsRef.current,
            [addition.reference.on]: taken.text,
          };
          textsRef.current = texts;
          // The head was just taken from the file: its metadata is current.
          const states = {
            ...statesRef.current,
            [addition.reference.on]: "current" as ReadingState,
          };
          statesRef.current = states;
          setState(snapshot());
          outcome = { ok: true };
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
          const taken = await refreshReading(workspacePath, reading);
          if (taken.kind === "refused") {
            outcome = { ok: false, message: taken.message };
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
          const texts = { ...textsRef.current, [on]: taken.text };
          textsRef.current = texts;
          const states = { ...statesRef.current, [on]: "current" as ReadingState };
          statesRef.current = states;
          setState(snapshot());
          outcome = { ok: true };
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
          // THE CASCADE (story 16.5): AFTER the reference's own removal (the
          // existing card-delete order above is untouched) and in the same
          // queued pass, every link that NAMES this slug leaves the link file —
          // in BOTH directions, so the app never manufactures an orphan.
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
          setState(snapshot());
          const refusal = removal.refusal ?? noteRefusal;
          outcome =
            refusal === null
              ? { ok: true }
              : {
                  ok: false,
                  message: refusal,
                  recordsRemoved: true,
                };
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

  return {
    references: state.references,
    readings: state.readings,
    texts: state.texts,
    states: state.states,
    pulled: state.pulled,
    notes: state.notes,
    orphanNotes: state.orphanNotes,
    links: state.links,
    orphanLinks: state.orphanLinks,
    malformedGround: state.malformedGround,
    malformedReadings: state.malformedReadings,
    malformedLinks: state.malformedLinks,
    mirrorNotice: state.mirrorNotice,
    loaded: state.loaded,
    create,
    move,
    refresh,
    repoint,
    remove,
    link,
    unlink,
    setNote,
    pull,
    dismissPull,
  };
}
