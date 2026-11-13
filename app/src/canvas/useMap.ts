import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadReferences, saveReference, type Reference } from "../map/refs";
import {
  coinDistance,
  distanceKey,
  loadDistances,
  recoinDistanceLine,
  saveDistances,
  type Distance,
} from "../map/distances";
import {
  findOrphanMarks,
  hasMark,
  loadMarks,
  saveMarks,
  withMark,
  withoutMark,
  type Mark,
  type MarkTarget,
} from "../map/marks";
import {
  dropWireMarks,
  recoinWireMarks,
  removeReference,
  renameReference,
} from "../map/patches";

/** A distance draw in flight: origin slug + the pointer's live world position. */
export interface ConnectDraft {
  from: string;
  /** The destination slug, set once dropped onto a target word. */
  to?: string;
  x: number;
  y: number;
}

/**
 * One workspace's map: references (bare words), distances (wires) and marks
 * (open annotations on either), loaded from disk, plus the connect gesture
 * (drag a word onto another, dashed preview), the in-place coin of the
 * distance word, the mark/settle toggle, and the rename/remove atomic patches
 * (ADRs 0005/0007/0009).
 */
export function useMap(workspacePath: string) {
  const [refs, setRefs] = useState<Reference[]>([]);
  const [distances, setDistances] = useState<Distance[]>([]);
  const [malformed, setMalformed] = useState<string[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [malformedMarks, setMalformedMarks] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [connect, setConnect] = useState<ConnectDraft | null>(null);
  const draftCount = useRef(0);

  /** Re-read every map file (first load and after an atomic patch). */
  const reloadMap = useCallback(async () => {
    const [referenceList, parsedDistances, parsedMarks] = await Promise.all([
      loadReferences(workspacePath),
      loadDistances(workspacePath),
      loadMarks(workspacePath),
    ]);
    setRefs(referenceList);
    setDistances(parsedDistances.distances);
    setMalformed(parsedDistances.malformed);
    setMarks(parsedMarks.marks);
    setMalformedMarks(parsedMarks.malformed);
    setLoaded(true);
  }, [workspacePath]);

  useEffect(() => {
    if (!workspacePath) return;
    setLoaded(false);
    void reloadMap();
  }, [workspacePath, reloadMap]);

  /** Persist the distance file after each mutation (deduped by key). */
  const persistDistances = useCallback(
    (next: Distance[]) => {
      setDistances(next);
      void saveDistances(workspacePath, next, malformed);
    },
    [workspacePath, malformed],
  );

  /** Persist the marks file after each mutation (deduped by natural key). */
  const persistMarks = useCallback(
    (next: Mark[]) => {
      setMarks(next);
      void saveMarks(workspacePath, next, malformedMarks);
    },
    [workspacePath, malformedMarks],
  );

  /**
   * Marks whose target is not on the map (hand edit, partial write): preserved
   * in the file and surfaced quietly by the app (ADR-0009). A bare spot has no
   * target citizen, so it is never an orphan.
   */
  const orphanMarks = useMemo(() => {
    if (!loaded) return [];
    const wordSlugs = new Set(
      refs.map((ref) => ref.slug).filter((slug): slug is string => slug !== null),
    );
    const wireKeys = new Set(
      distances.map((d) => distanceKey(d.from, d.to, d.word)),
    );
    return findOrphanMarks(marks, wordSlugs, wireKeys);
  }, [loaded, refs, distances, marks]);

  /** Open a blank word to coin at a plane point. */
  const coinReference = useCallback((x: number, y: number) => {
    draftCount.current += 1;
    const ref: Reference = {
      id: `draft-${draftCount.current}`,
      slug: null,
      name: "",
      x,
      y,
      body: "",
      extra: {},
    };
    setRefs((list) => [...list, ref]);
  }, []);

  /** Persist a reference (assigning its slug on first coin) and refresh. */
  const updateReference = useCallback(
    (ref: Reference) => {
      saveReference(workspacePath, ref).then((saved) => {
        setRefs((list) => list.map((r) => (r.id === ref.id ? saved : r)));
      });
    },
    [workspacePath],
  );

  /** Drop an uncoined draft — Escape on the coin field. */
  const discardReference = useCallback((ref: Reference) => {
    setRefs((list) => list.filter((r) => r.id !== ref.id));
  }, []);

  /** Rename a reference: one atomic patch (ADR-0005, marks follow). */
  const rename = useCallback(
    (ref: Reference, newName: string) => {
      renameReference(workspacePath, ref, newName).then(() => reloadMap());
    },
    [workspacePath, reloadMap],
  );

  /** Remove a reference: one atomic delete (ADR-0007, marks go with it). */
  const remove = useCallback(
    (ref: Reference) => {
      removeReference(workspacePath, ref).then(() => reloadMap());
    },
    [workspacePath, reloadMap],
  );

  /** Cast or settle an open mark on a word (story 1's provisional affordance). */
  const toggleWordMark = useCallback(
    (slug: string) => {
      const target: MarkTarget = { type: "word", slug };
      const next = hasMark(marks, "open", target)
        ? withoutMark(marks, "open", target)
        : withMark(marks, { kind: "open", target, extra: {} });
      persistMarks(next);
    },
    [marks, persistMarks],
  );

  /** Cast or settle an open mark on a wire (story 1's provisional affordance). */
  const toggleWireMark = useCallback(
    (distance: Distance) => {
      const target: MarkTarget = {
        type: "wire",
        from: distance.from,
        to: distance.to,
        word: distance.word,
      };
      const next = hasMark(marks, "open", target)
        ? withoutMark(marks, "open", target)
        : withMark(marks, { kind: "open", target, extra: {} });
      persistMarks(next);
    },
    [marks, persistMarks],
  );

  /** Begin a distance draw from `fromSlug` at a world point. */
  const beginConnect = useCallback((fromSlug: string, x: number, y: number) => {
    setConnect({ from: fromSlug, x, y });
  }, []);

  /** Track the pointer during a draw (preview line's live end). */
  const moveConnect = useCallback((x: number, y: number) => {
    setConnect((c) => (c ? { ...c, x, y } : c));
  }, []);

  /** Drop onto `toSlug` (fixes the pair; the coin field appears at the midpoint). */
  const dropConnect = useCallback((toSlug: string) => {
    setConnect((c) => (c ? { ...c, to: toSlug } : c));
  }, []);

  /**
   * Coin the in-flight distance word (Enter) — writes the (from,to,word) line.
   * Only the identical key is rewritten; a second distance on the same pair is
   * a sibling and survives (ADR-0006).
   */
  const coinConnect = useCallback(
    (word: string) => {
      if (!connect || !connect.to) return;
      const trimmed = word.trim();
      if (!trimmed) return;
      const next = coinDistance(distances, connect.from, connect.to, trimmed);
      setConnect(null);
      if (next !== distances) persistDistances(next);
    },
    [connect, distances, persistDistances],
  );

  /** Abandon a draw or an empty coin field (Escape) — nothing written. */
  const cancelConnect = useCallback(() => setConnect(null), []);

  /**
   * Re-coin an existing distance: a new word is a new key (ADR-0006). When the
   * new key already exists, the re-coined line wins and the colliding sibling
   * dies; its mark is dropped in the same patch (the pinned survivor).
   */
  const recoinDistance = useCallback(
    (distance: Distance, word: string) => {
      const trimmed = word.trim();
      if (!trimmed || trimmed === distance.word) return;
      const { distances: nextDistances, collided } = recoinDistanceLine(
        distances,
        distance,
        trimmed,
      );
      const nextMarks = recoinWireMarks(
        marks,
        distance.from,
        distance.to,
        distance.word,
        trimmed,
        collided,
      );
      persistDistances(nextDistances);
      persistMarks(nextMarks);
    },
    [distances, marks, persistDistances, persistMarks],
  );

  /** Remove a distance (one click, no ceremony) and the marks targeting it. */
  const removeDistance = useCallback(
    (distance: Distance) => {
      const key = distanceKey(distance.from, distance.to, distance.word);
      const nextDistances = distances.filter(
        (d) => distanceKey(d.from, d.to, d.word) !== key,
      );
      const nextMarks = dropWireMarks(marks, distance.from, distance.to, distance.word);
      persistDistances(nextDistances);
      persistMarks(nextMarks);
    },
    [distances, marks, persistDistances, persistMarks],
  );

  return {
    refs,
    distances,
    marks,
    malformed,
    malformedMarks,
    orphanMarks,
    connect,
    coinReference,
    updateReference,
    discardReference,
    rename,
    remove,
    toggleWordMark,
    toggleWireMark,
    beginConnect,
    moveConnect,
    dropConnect,
    coinConnect,
    cancelConnect,
    recoinDistance,
    removeDistance,
  };
}
