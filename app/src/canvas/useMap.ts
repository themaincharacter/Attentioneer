import { useCallback, useEffect, useRef, useState } from "react";
import { loadReferences, saveReference, type Reference } from "../map/refs";
import {
  distanceKey,
  loadDistances,
  saveDistances,
  type Distance,
} from "../map/distances";
import { removeReference, renameReference } from "../map/patches";

/** A distance draw in flight: origin slug + the pointer's live world position. */
export interface ConnectDraft {
  from: string;
  /** The destination slug, set once dropped onto a target word. */
  to?: string;
  x: number;
  y: number;
}

/**
 * One workspace's map: references (bare words) and distances (wires), loaded
 * from disk, plus the connect gesture (drag a word onto another, dashed
 * preview), the in-place coin of the distance word, and the rename/remove
 * atomic patches (ADRs 0005/0007).
 */
export function useMap(workspacePath: string) {
  const [refs, setRefs] = useState<Reference[]>([]);
  const [distances, setDistances] = useState<Distance[]>([]);
  const [malformed, setMalformed] = useState<string[]>([]);
  const [connect, setConnect] = useState<ConnectDraft | null>(null);
  const draftCount = useRef(0);

  useEffect(() => {
    if (!workspacePath) return;
    loadReferences(workspacePath).then(setRefs);
  }, [workspacePath]);

  useEffect(() => {
    if (!workspacePath) return;
    loadDistances(workspacePath).then((parsed) => {
      setDistances(parsed.distances);
      setMalformed(parsed.malformed);
    });
  }, [workspacePath]);

  /** Persist the distance file after each mutation (deduped by key). */
  const persistDistances = useCallback(
    (next: Distance[]) => {
      saveDistances(workspacePath, next, malformed).then(() => setDistances(next));
    },
    [workspacePath, malformed],
  );

  /** Re-read both files after an atomic patch (rename/remove). */
  const reloadMap = useCallback(() => {
    loadReferences(workspacePath).then(setRefs);
    loadDistances(workspacePath).then((parsed) => {
      setDistances(parsed.distances);
      setMalformed(parsed.malformed);
    });
  }, [workspacePath]);

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

  /** Rename a reference: one atomic patch (ADR-0005). */
  const rename = useCallback(
    (ref: Reference, newName: string) => {
      renameReference(workspacePath, ref, newName).then(reloadMap);
    },
    [workspacePath, reloadMap],
  );

  /** Remove a reference: one atomic delete (ADR-0007). */
  const remove = useCallback(
    (ref: Reference) => {
      removeReference(workspacePath, ref).then(reloadMap);
    },
    [workspacePath, reloadMap],
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

  /** Coin the in-flight distance word (Enter) — writes the (from,to,word) line. */
  const coinConnect = useCallback(
    (word: string) => {
      setConnect((c) => {
        if (!c || !c.to) return c;
        const from = c.from;
        const to = c.to;
        const trimmed = word.trim();
        if (!trimmed) return c;
        setDistances((prev) => {
          const next = prev.filter((d) => d.from !== from || d.to !== to);
          next.push({ from, to, word: trimmed, extra: {} });
          persistDistances(next);
          return next;
        });
        return null;
      });
    },
    [persistDistances],
  );

  /** Abandon a draw or an empty coin field (Escape) — nothing written. */
  const cancelConnect = useCallback(() => setConnect(null), []);

  /** Re-coin an existing distance: a new word is a new key (ADR-0006). */
  const recoinDistance = useCallback(
    (distance: Distance, word: string) => {
      const k = distanceKey(distance.from, distance.to, distance.word);
      setDistances((prev) => {
        const next = prev.filter((d) => distanceKey(d.from, d.to, d.word) !== k);
        next.push({ from: distance.from, to: distance.to, word, extra: distance.extra });
        persistDistances(next);
        return next;
      });
    },
    [persistDistances],
  );

  /** Remove a distance (one click, no ceremony). */
  const removeDistance = useCallback(
    (distance: Distance) => {
      const k = distanceKey(distance.from, distance.to, distance.word);
      setDistances((prev) => {
        const next = prev.filter((d) => distanceKey(d.from, d.to, d.word) !== k);
        persistDistances(next);
        return next;
      });
    },
    [persistDistances],
  );

  return {
    refs,
    distances,
    connect,
    coinReference,
    updateReference,
    discardReference,
    rename,
    remove,
    beginConnect,
    moveConnect,
    dropConnect,
    coinConnect,
    cancelConnect,
    recoinDistance,
    removeDistance,
  };
}