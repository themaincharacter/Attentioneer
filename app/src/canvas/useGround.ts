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
 *     reference pointing at a reading whose text file is gone). A refused
 *     unlink answers one sentence and repairs nothing on its own.
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
 *   - The whole read-modify-write runs through the app's one per-file
 *     discipline (`createWriteQueue`, ADR-0004/ADR-0018): one line at a time,
 *     never a whole-folder rewrite.
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
}

/** The view without its verbs: what the load and every write render. */
type GroundLoaded = Omit<
  GroundView,
  "create" | "move" | "refresh" | "repoint" | "remove" | "link" | "unlink"
>;

const EMPTY: GroundLoaded = {
  references: [],
  readings: [],
  texts: {},
  states: {},
  links: [],
  orphanLinks: [],
  malformedGround: [],
  malformedReadings: [],
  malformedLinks: [],
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
  // The ground map's wordless wiring (story 16.5): the whole truth is its one
  // file, so the sync mirror holds exactly what the load read.
  const linksRef = useRef<GroundLink[]>([]);
  const malformedLinksRef = useRef<string[]>([]);
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
    const [texts, metas] = await Promise.all([
      loadReadingTexts(
        workspacePath,
        ground.references.map((reference) => reference.on),
      ),
      metasOf(workspacePath, readings.readings),
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
    loaded: true,
  });

  useEffect(() => {
    // A different workspace starts from its own map folder, never the last
    // one's state (and the write queue belongs to the person's moves in it).
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
          setState(snapshot());
          outcome =
            removal.refusal === null
              ? { ok: true }
              : {
                  ok: false,
                  message: removal.refusal,
                  recordsRemoved: true,
                };
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
        })
        .then(() => outcome)
        .catch(() => ({
          ok: false,
          message: "cannot write the map folder.",
        }));
    },
    [workspacePath],
  );

  return {
    references: state.references,
    readings: state.readings,
    texts: state.texts,
    states: state.states,
    links: state.links,
    orphanLinks: state.orphanLinks,
    malformedGround: state.malformedGround,
    malformedReadings: state.malformedReadings,
    malformedLinks: state.malformedLinks,
    loaded: state.loaded,
    create,
    move,
    refresh,
    repoint,
    remove,
    link,
    unlink,
  };
}
