import { useCallback, useEffect, useRef, useState } from "react";
import { fileMeta, type FileMetaAnswer } from "../lib/fs";
import { createWriteQueue } from "../lib/writeQueue";
import {
  addGroundReference,
  loadGround,
  moveGroundReference,
  saveGround,
  type GroundReference,
} from "../map/ground";
import {
  loadReadings,
  loadReadingTexts,
  readingAbsolutePath,
  readingFor,
  refreshReading,
  resolveReadingState,
  saveReadings,
  takeReading,
  withReading,
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
 *   - LOAD: `map/ground.txt` and `map/readings.txt` are read on every
 *     workspace open (and every workspace change), each reference's reading
 *     text is read from `map/readings/<slug>.md`, and each reading's file is
 *     stat'ed ONCE (one `fileMeta` per reading, in parallel). The
 *     `states` are COMPUTED from that metadata and never written into a
 *     record (story 16.2 decision 1): a second truth would drift from the file.
 *     Nothing watches, polls or re-reads later; the `map/` folder alone is the
 *     source, and there is no index, cache or side table.
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
  | { ok: false; message: string };

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
  /** Unreadable `map/ground.txt` lines, preserved and surfaced. */
  malformedGround: readonly string[];
  /** Unreadable `map/readings.txt` lines, preserved and surfaced. */
  malformedReadings: readonly string[];
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
}

const EMPTY: Omit<GroundView, "create" | "move" | "refresh" | "repoint"> = {
  references: [],
  readings: [],
  texts: {},
  states: {},
  malformedGround: [],
  malformedReadings: [],
  loaded: false,
};

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
  const [state, setState] =
    useState<Omit<GroundView, "create" | "move" | "refresh" | "repoint">>(EMPTY);
  // Synchronous mirrors: the queued write must never read a stale list.
  const referencesRef = useRef<GroundReference[]>([]);
  const readingsRef = useRef<Reading[]>([]);
  const malformedGroundRef = useRef<string[]>([]);
  const malformedReadingsRef = useRef<string[]>([]);
  const textsRef = useRef<Record<string, string>>({});
  const statesRef = useRef<Record<string, ReadingState>>({});
  // One queue for the ground family's two files: an add's ground line must
  // land after its own readings line, never under a stale one.
  const queueRef = useRef(createWriteQueue());

  const reload = useCallback(async () => {
    if (workspacePath === "") return;
    const [ground, readings] = await Promise.all([
      loadGround(workspacePath),
      loadReadings(workspacePath),
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
    referencesRef.current = ground.references;
    readingsRef.current = readings.readings;
    malformedGroundRef.current = ground.malformed;
    malformedReadingsRef.current = readings.malformed;
    textsRef.current = texts;
    statesRef.current = states;
    setState({
      references: ground.references,
      readings: readings.readings,
      texts,
      states,
      malformedGround: ground.malformed,
      malformedReadings: readings.malformed,
      loaded: true,
    });
  }, [workspacePath]);

  useEffect(() => {
    // A different workspace starts from its own map folder, never the last
    // one's state (and the write queue belongs to the person's moves in it).
    queueRef.current = createWriteQueue();
    if (workspacePath === "") {
      referencesRef.current = [];
      readingsRef.current = [];
      malformedGroundRef.current = [];
      malformedReadingsRef.current = [];
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
          setState({
            references: addition.references,
            readings: nextReadings,
            texts,
            states,
            malformedGround: malformedGroundRef.current,
            malformedReadings: malformedReadingsRef.current,
            loaded: true,
          });
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
          setState({
            references: next,
            readings: readingsRef.current,
            texts: textsRef.current,
            states: statesRef.current,
            malformedGround: malformedGroundRef.current,
            malformedReadings: malformedReadingsRef.current,
            loaded: true,
          });
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
          setState({
            references: referencesRef.current,
            readings: nextReadings,
            texts,
            states,
            malformedGround: malformedGroundRef.current,
            malformedReadings: malformedReadingsRef.current,
            loaded: true,
          });
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
          setState({
            references: referencesRef.current,
            readings: nextReadings,
            texts,
            states,
            malformedGround: malformedGroundRef.current,
            malformedReadings: malformedReadingsRef.current,
            loaded: true,
          });
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

  return {
    references: state.references,
    readings: state.readings,
    texts: state.texts,
    states: state.states,
    malformedGround: state.malformedGround,
    malformedReadings: state.malformedReadings,
    loaded: state.loaded,
    create,
    move,
    refresh,
    repoint,
  };
}
