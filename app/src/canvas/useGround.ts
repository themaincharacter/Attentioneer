import { useCallback, useEffect, useRef, useState } from "react";
import { createWriteQueue } from "../lib/writeQueue";
import {
  addGroundReference,
  loadGround,
  saveGround,
  type GroundReference,
} from "../map/ground";
import {
  loadReadings,
  loadReadingTexts,
  saveReadings,
  takeReading,
  withReading,
  type Reading,
} from "../map/readings";

/**
 * The ground map's loaded state and its one write path (story 16.1).
 *
 * The app's other record families live in `canvas/useMap.ts`; ground is its
 * own map with its own family, so it loads and writes beside it instead of
 * riding the concept map's reload. `useGround` is the whole seam:
 *
 *   - LOAD: `map/ground.txt` and `map/readings.txt` are read on every
 *     workspace open (and every workspace change), and each reference's
 *     reading text is read from `map/readings/<slug>.md`. The `map/` folder
 *     alone is the source; there is no index, cache or side table.
 *   - ADD: one person move — coin the name, take the reading, then write the
 *     text file, the readings line and the ground line, in that order. The
 *     reference is written LAST, so a crash can leave an orphan reading but
 *     never a ground reference whose file was refused (no half-formed
 *     reference). The whole read-modify-write runs through the app's one
 *     per-file discipline (`createWriteQueue`, ADR-0004/ADR-0018): one line
 *     at a time, never a whole-folder rewrite.
 *   - REFUSE: an absent, binary or unreadable file returns one quiet
 *     sentence and writes nothing at all (the bubble shows it; the reference
 *     is not created).
 *
 * PROVISIONAL: the state shape, the write order and the sentences (the story's
 * record shapes and wording, before an ADR). Story 2 is where renaming,
 * moving and staleness arrive; this hook only loads, adds and reports.
 */

/** What one add said: done, or the sentence the bubble shows. */
export type GroundAddResult =
  | { ok: true }
  | { ok: false; message: string };

/** Everything the ground layer renders, loaded from the map folder. */
export interface GroundView {
  references: readonly GroundReference[];
  readings: readonly Reading[];
  /** Each reading's text, keyed by slug (a missing text is simply absent). */
  texts: Readonly<Record<string, string>>;
  /** Unreadable `map/ground.txt` lines, preserved and surfaced. */
  malformedGround: readonly string[];
  /** Unreadable `map/readings.txt` lines, preserved and surfaced. */
  malformedReadings: readonly string[];
  /** The map folder's ground records have been read once. */
  loaded: boolean;
  /** Add one reference from a picked text file (the one write). */
  create: (
    name: string,
    x: number,
    y: number,
    from: string,
  ) => Promise<GroundAddResult>;
}

const EMPTY: Omit<GroundView, "create"> = {
  references: [],
  readings: [],
  texts: {},
  malformedGround: [],
  malformedReadings: [],
  loaded: false,
};

export function useGround(workspacePath: string): GroundView {
  const [state, setState] =
    useState<Omit<GroundView, "create">>(EMPTY);
  // Synchronous mirrors: the queued write must never read a stale list.
  const referencesRef = useRef<GroundReference[]>([]);
  const readingsRef = useRef<Reading[]>([]);
  const malformedGroundRef = useRef<string[]>([]);
  const malformedReadingsRef = useRef<string[]>([]);
  const textsRef = useRef<Record<string, string>>({});
  // One queue for the ground family's two files: an add's ground line must
  // land after its own readings line, never under a stale one.
  const queueRef = useRef(createWriteQueue());

  const reload = useCallback(async () => {
    if (workspacePath === "") return;
    const [ground, readings] = await Promise.all([
      loadGround(workspacePath),
      loadReadings(workspacePath),
    ]);
    const texts = await loadReadingTexts(
      workspacePath,
      ground.references.map((reference) => reference.on),
    );
    referencesRef.current = ground.references;
    readingsRef.current = readings.readings;
    malformedGroundRef.current = ground.malformed;
    malformedReadingsRef.current = readings.malformed;
    textsRef.current = texts;
    setState({
      references: ground.references,
      readings: readings.readings,
      texts,
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
          setState({
            references: addition.references,
            readings: nextReadings,
            texts,
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

  return {
    references: state.references,
    readings: state.readings,
    texts: state.texts,
    malformedGround: state.malformedGround,
    malformedReadings: state.malformedReadings,
    loaded: state.loaded,
    create,
  };
}
