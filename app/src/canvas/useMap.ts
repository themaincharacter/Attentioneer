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
  dedupeMarks,
  findOrphanMarks,
  hasMark,
  loadMarks,
  retargetMark as retargetMarkRecord,
  saveMarks,
  withMark,
  withoutMark,
  type Mark,
  type MarkTarget,
} from "../map/marks";
import {
  dedupeLinks,
  drawLink as drawLinkRecord,
  flipLink as flipLinkRecord,
  linkKey,
  loadLinks,
  removeLink as removeLinkRecord,
  saveLinks,
  type Link,
  type LinkSign,
} from "../map/links";
import {
  dedupe,
  joinWords,
  loadModel,
  saveModel,
  type PlayingSet,
} from "../map/model";
import {
  dropLinkMarks,
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
 * (open annotations on a word, a wire or a bare spot), loaded from disk, plus
 * the connect gesture (drag a word onto another, dashed preview), the in-place
 * coin of the distance word, the mark gestures and the rename/remove atomic
 * patches (ADRs 0005/0007/0009).
 *
 * Story 2's moves are the mark's single-target retargets: cast a bare lack,
 * bind/unbind by dragging its ring (`moveMark`), grow it into a named
 * question-word (`growMark`), and settle it (`withdrawMark`). Mark state lives
 * in `marksRef` as well as React state so a burst of casts/drags can never
 * read a stale list and lose the earlier write.
 *
 * Story 3's shelf adds one composed write, `reject`: settle + set aside in one
 * user move. The shelf itself is not a state — it is derived from a
 * reference's position past the workspace fold (`map/shelf.ts`), so the map
 * model only ever writes x/y and marks.
 *
 * Epic 4 story 1 adds the playing set (ADR-0013): `map/model.json` loaded with
 * the rest of the map, and one explicit write — `acceptPlayingSet` — when the
 * selector's accept is pressed. Membership is read, never validated against
 * another record; hand-edited member names that no longer exist on the map are
 * surfaced, not repaired.
 *
 * Epic 4 story 2 adds signed links (ADR-0012/0014): `map/links.jsonl` loaded
 * with the rest, and the quiet moves — draw (one line per ordered pair, a sign
 * is always an explicit pick), flip (rewrite in place at its index), remove
 * (ammo, dropping the link's marks with it) and the link's own open mark. The
 * composed joins land here too (ADR-0013 decision 4): a drawn link pulls its
 * endpoints into play, a word coined while playing joins, and in both the
 * DURABLE record is written first — the link line or the reference file — with
 * the membership write second, so a crash leaves the visible move, never a
 * member naming nothing.
 */
export interface UseMapOptions {
  /**
   * Is Level 2 the active game? The composed joins hang off it (ADR-0013):
   * coining while playing joins the word, and a drawn link pulls its endpoints
   * into play. Level 1 writes exactly what it wrote before.
   */
  playing?: boolean;
}

export function useMap(
  workspacePath: string,
  options: UseMapOptions = {},
) {
  const playing = options.playing ?? false;
  const [refs, setRefs] = useState<Reference[]>([]);
  const [distances, setDistances] = useState<Distance[]>([]);
  const [malformed, setMalformed] = useState<string[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [malformedMarks, setMalformedMarks] = useState<string[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [malformedLinks, setMalformedLinks] = useState<string[]>([]);
  const [model, setModel] = useState<PlayingSet | null>(null);
  const [malformedModel, setMalformedModel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [connect, setConnect] = useState<ConnectDraft | null>(null);
  const draftCount = useRef(0);
  const marksRef = useRef<Mark[]>([]);
  const malformedMarksRef = useRef<string[]>([]);
  const marksWriteRef = useRef<Promise<void>>(Promise.resolve());
  const linksRef = useRef<Link[]>([]);
  const malformedLinksRef = useRef<string[]>([]);
  const linksWriteRef = useRef<Promise<void>>(Promise.resolve());
  const modelRef = useRef<PlayingSet | null>(null);

  /** Re-read every map file (first load and after an atomic patch). */
  const reloadMap = useCallback(async () => {
    const [referenceList, parsedDistances, parsedMarks, parsedLinks, parsedModel] =
      await Promise.all([
        loadReferences(workspacePath),
        loadDistances(workspacePath),
        loadMarks(workspacePath),
        loadLinks(workspacePath),
        loadModel(workspacePath),
      ]);
    setRefs(referenceList);
    setDistances(parsedDistances.distances);
    setMalformed(parsedDistances.malformed);
    marksRef.current = parsedMarks.marks;
    malformedMarksRef.current = parsedMarks.malformed;
    setMarks(parsedMarks.marks);
    setMalformedMarks(parsedMarks.malformed);
    linksRef.current = parsedLinks.links;
    malformedLinksRef.current = parsedLinks.malformed;
    setLinks(parsedLinks.links);
    setMalformedLinks(parsedLinks.malformed);
    modelRef.current = parsedModel.model;
    setModel(parsedModel.model);
    setMalformedModel(parsedModel.malformed);
    setLoaded(true);
  }, [workspacePath]);

  useEffect(() => {
    if (!workspacePath) return;
    setLoaded(false);
    void reloadMap();
  }, [workspacePath, reloadMap]);

  // Keep the synchronous mirror in step when marks change from a reload (all
  // other writers below set it themselves before handing the list to React).
  useEffect(() => {
    marksRef.current = marks;
  }, [marks]);

  // The same mirror for links and for the playing set (a composed join can run
  // right after a burst of writes, so it must never read a stale record).
  useEffect(() => {
    linksRef.current = links;
  }, [links]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  /** Persist the distance file after each mutation (deduped by key). */
  const persistDistances = useCallback(
    (next: Distance[]) => {
      setDistances(next);
      void saveDistances(workspacePath, next, malformed);
    },
    [workspacePath, malformed],
  );

  /**
   * Persist the marks file after each mutation (deduped by natural key). Also
   * the synchronous mirror's write point: exactly one line per key (ADR-0009).
   * Malformed lines ride along from a ref, so an in-flight move can never write
   * a stale preserved-line list.
   */
  const persistMarks = useCallback(
    (next: readonly Mark[]) => {
      const deduped = dedupeMarks(next);
      marksRef.current = deduped;
      setMarks(deduped);
      const malformedLines = [...malformedMarksRef.current];
      // One marks writer at a time: a burst of menu casts, ring drags and grows
      // must land in order, never as a stale line reappearing under a newer one.
      marksWriteRef.current = marksWriteRef.current
        .catch(() => undefined)
        .then(() => saveMarks(workspacePath, deduped, malformedLines));
    },
    [workspacePath],
  );

  /**
   * Persist the links file after each mutation (one line per ordered pair).
   * Same in-order queue as marks: a burst of flips must land in the order the
   * person made them, never as an older sign reappearing under a newer one.
   */
  const persistLinks = useCallback(
    (next: readonly Link[]) => {
      const deduped = dedupeLinks(next);
      linksRef.current = deduped;
      setLinks(deduped);
      const malformedLines = [...malformedLinksRef.current];
      linksWriteRef.current = linksWriteRef.current
        .catch(() => undefined)
        .then(() => saveLinks(workspacePath, deduped, malformedLines));
    },
    [workspacePath],
  );

  /**
   * The composed join (ADR-0013 decision 4): pull these words into play. Runs
   * only while playing and only when a set exists — the selector is the door,
   * so a workspace with no accepted set gets no membership write. The caller
   * writes the durable thing first; this is the second write of the batch.
   */
  const joinToPlay = useCallback(
    async (slugs: readonly string[]) => {
      if (!playing) return;
      const current = modelRef.current;
      const next = joinWords(current, slugs);
      if (next === null || next === current) return;
      modelRef.current = next;
      setModel(next);
      await saveModel(workspacePath, next);
    },
    [playing, workspacePath],
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
    const linkKeys = new Set(links.map((link) => linkKey(link.from, link.to)));
    return findOrphanMarks(marks, wordSlugs, wireKeys, linkKeys);
  }, [loaded, refs, distances, links, marks]);

  /**
   * Links naming a word that is not on the map (a hand edit): preserved in the
   * file and surfaced quietly, never dropped on an unrelated write — the same
   * no-validation posture as membership (ADR-0013) and marks (ADR-0009).
   */
  const orphanLinks = useMemo(() => {
    if (!loaded) return [];
    const slugs = new Set(
      refs.map((ref) => ref.slug).filter((slug): slug is string => slug !== null),
    );
    return links.filter(
      (link) => !slugs.has(link.from) || !slugs.has(link.to),
    );
  }, [loaded, refs, links]);

  /**
   * The playing set names words that are no longer on the map (a hand edit):
   * preserved in the record and surfaced quietly, never dropped on an
   * unrelated write (ADR-0013's no-validation posture, ADR-0009's precedent).
   */
  const orphanMembers = useMemo(() => {
    if (!loaded || model === null) return [];
    const slugs = new Set(
      refs.map((ref) => ref.slug).filter((slug): slug is string => slug !== null),
    );
    return model.words.filter((slug) => !slugs.has(slug));
  }, [loaded, model, refs]);

  /**
   * Accept the selector's set: one explicit write of `map/model.json`
   * (ADR-0013). Re-running rewrites the record — no history, no confirmation;
   * a formerly unreadable file is replaced here because the person said so.
   */
  const acceptPlayingSet = useCallback(
    (slugs: readonly string[]) => {
      const next: PlayingSet = {
        words: dedupe(slugs),
        extra: model?.extra ?? {},
      };
      setModel(next);
      setMalformedModel(null);
      void saveModel(workspacePath, next);
    },
    [workspacePath, model],
  );

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

  /**
   * Persist a reference (assigning its slug on first coin) and refresh. A word
   * coined while playing joins the playing set in the same user move (ADR-0013
   * decision 4): the reference file — the durable thing — is written first, so a
   * crash leaves the visible word briefly out of play, never a member naming
   * nothing. Editing an existing word never touches membership.
   */
  const updateReference = useCallback(
    (ref: Reference) => {
      const coining = ref.slug === null;
      saveReference(workspacePath, ref).then((saved) => {
        setRefs((list) => list.map((r) => (r.id === ref.id ? saved : r)));
        if (coining && saved.slug !== null) void joinToPlay([saved.slug]);
      });
    },
    [workspacePath, joinToPlay],
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
      const current = marksRef.current;
      const next = hasMark(current, "open", target)
        ? withoutMark(current, "open", target)
        : withMark(current, { kind: "open", target, extra: {} });
      persistMarks(next);
    },
    [persistMarks],
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
      const current = marksRef.current;
      const next = hasMark(current, "open", target)
        ? withoutMark(current, "open", target)
        : withMark(current, { kind: "open", target, extra: {} });
      persistMarks(next);
    },
    [persistMarks],
  );

  /**
   * Cast or settle an open mark on a link (story 2): the wordless pair is the
   * target, so the mark survives a sign flip (the key carries no sign) and dies
   * with its link. Nothing is interpreted; the mark only says "not settled".
   */
  const toggleLinkMark = useCallback(
    (from: string, to: string) => {
      const target: MarkTarget = { type: "link", from, to };
      const current = marksRef.current;
      const next = hasMark(current, "open", target)
        ? withoutMark(current, "open", target)
        : withMark(current, { kind: "open", target, extra: {} });
      persistMarks(next);
    },
    [persistMarks],
  );

  /**
   * Draw a signed link (the Level 2 sign choice's explicit pick): one line per
   * ordered pair, the sign exactly as picked. The link's own write goes first —
   * the durable, visible thing — and the composed join follows it (ADR-0013).
   */
  const drawLink = useCallback(
    (from: string, to: string, sign: LinkSign) => {
      persistLinks(drawLinkRecord(linksRef.current, from, to, sign));
      void joinToPlay([from, to]);
    },
    [persistLinks, joinToPlay],
  );

  /** Flip a link's sign: rewritten in place at its line's index (quiet). */
  const flipLink = useCallback(
    (from: string, to: string) => {
      persistLinks(flipLinkRecord(linksRef.current, from, to));
    },
    [persistLinks],
  );

  /**
   * Remove a link (ammo, one click) and the marks targeting it — die-with-
   * target (ADR-0009's amendment). No distance is touched: the two families
   * share only the pair (ADR-0014 decision 2).
   */
  const removeLink = useCallback(
    (from: string, to: string) => {
      persistLinks(removeLinkRecord(linksRef.current, from, to));
      persistMarks(dropLinkMarks(marksRef.current, from, to));
    },
    [persistLinks, persistMarks],
  );

  /** Cast a bare open mark — the menu's lack choice; no field, no name. */
  const castMark = useCallback(
    (x: number, y: number) => {
      const target: MarkTarget = { type: "spot", x, y };
      const current = marksRef.current;
      // Re-casting the identical spot is the same line, not a second mark.
      if (hasMark(current, "open", target)) return;
      persistMarks(withMark(current, { kind: "open", target, extra: {} }));
    },
    [persistMarks],
  );

  /** Withdraw (settle) the open mark at a target: the line goes, no tombstone. */
  const withdrawMark = useCallback(
    (target: MarkTarget) => {
      const current = marksRef.current;
      if (!hasMark(current, "open", target)) return;
      persistMarks(withoutMark(current, "open", target));
    },
    [persistMarks],
  );

  /**
   * Move one open mark to a new target (bind / unbind by dragging its ring).
   * One write: the source line's address becomes the target's (ADR-0009), and
   * the target's natural key is the survivor if two addresses collide.
   */
  const moveMark = useCallback(
    (source: MarkTarget, target: MarkTarget) => {
      const next = retargetMarkRecord(marksRef.current, source, target);
      if (next === marksRef.current) return;
      persistMarks(next);
    },
    [persistMarks],
  );

  /**
   * Grow a bare lack into a named question-word (ticket 03): coin the reference
   * at the spot and retarget the spot line to an `on` line — one user move.
   *
   * Write order: the reference file first, the mark second. A crash between the
   * two leaves the coined word *and* the still-bare lack: both visible, the
   * lack still withdrawable, nothing silently lost. The reverse order would
   * leave a mark naming a reference that never reached disk — an orphan could
   * be surfaced, but the typed name would be gone (invisible loss).
   */
  const growMark = useCallback(
    (spot: { x: number; y: number }, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const source: MarkTarget = { type: "spot", x: spot.x, y: spot.y };
      if (!hasMark(marksRef.current, "open", source)) return;

      draftCount.current += 1;
      const draft: Reference = {
        id: `grow-${draftCount.current}`,
        slug: null,
        name: trimmed,
        x: spot.x,
        y: spot.y,
        body: "",
        extra: {},
      };

      void (async () => {
        const saved = await saveReference(workspacePath, draft);
        if (!saved.slug) return;
        setRefs((list) => [...list, saved]);
        const next = retargetMarkRecord(marksRef.current, source, {
          type: "word",
          slug: saved.slug,
        });
        if (next !== marksRef.current) persistMarks(next);
      })();
    },
    [workspacePath, persistMarks],
  );

  /**
   * Reject a reference: settle (withdraw its open mark) + set aside, in one
   * user move (ADR-0010). `spot` is the shelf point the canvas derived from the
   * fold; `null` means the word is already set aside, so the settle alone
   * completes the move. Nothing is stored about the rejection — the word is
   * kept, its position past the fold is the whole record.
   *
   * Write order: the reference's x/y first, the mark line second. A crash
   * between the two leaves the word on the shelf still carrying its open mark:
   * deferred, visible, one ring-click from settled. The reverse order (settle
   * first) would leave a settled word in the live map with the rejection
   * silently half-applied. Neither order can lose the word or leave a mark the
   * user cannot see.
   */
  const reject = useCallback(
    (ref: Reference, spot: { x: number; y: number } | null) => {
      const settle = () => {
        if (ref.slug !== null) withdrawMark({ type: "word", slug: ref.slug });
      };
      if (!spot) {
        settle();
        return;
      }
      saveReference(workspacePath, { ...ref, x: spot.x, y: spot.y }).then((saved) => {
        setRefs((list) => list.map((r) => (r.id === ref.id ? saved : r)));
        settle();
      });
    },
    [workspacePath, withdrawMark],
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
        marksRef.current,
        distance.from,
        distance.to,
        distance.word,
        trimmed,
        collided,
      );
      persistDistances(nextDistances);
      persistMarks(nextMarks);
    },
    [distances, persistDistances, persistMarks],
  );

  /** Remove a distance (one click, no ceremony) and the marks targeting it. */
  const removeDistance = useCallback(
    (distance: Distance) => {
      const key = distanceKey(distance.from, distance.to, distance.word);
      const nextDistances = distances.filter(
        (d) => distanceKey(d.from, d.to, d.word) !== key,
      );
      const nextMarks = dropWireMarks(
        marksRef.current,
        distance.from,
        distance.to,
        distance.word,
      );
      persistDistances(nextDistances);
      persistMarks(nextMarks);
    },
    [distances, persistDistances, persistMarks],
  );

  return {
    refs,
    distances,
    links,
    marks,
    malformed,
    malformedMarks,
    malformedLinks,
    orphanMarks,
    orphanLinks,
    model,
    malformedModel,
    orphanMembers,
    loaded,
    acceptPlayingSet,
    connect,
    coinReference,
    updateReference,
    discardReference,
    rename,
    remove,
    toggleWordMark,
    toggleWireMark,
    toggleLinkMark,
    drawLink,
    flipLink,
    removeLink,
    castMark,
    withdrawMark,
    moveMark,
    growMark,
    reject,
    beginConnect,
    moveConnect,
    dropConnect,
    coinConnect,
    cancelConnect,
    recoinDistance,
    removeDistance,
  };
}
