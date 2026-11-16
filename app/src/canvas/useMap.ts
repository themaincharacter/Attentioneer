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
  loadLoops,
  loopKey,
  nameLoop as nameLoopRecord,
  removeLoop as removeLoopRecord,
  renameLoop as renameLoopRecord,
  saveLoops,
  unusedLoopSlugs,
  type Loop,
} from "../map/loops";
import {
  dedupeVeils,
  loadVeils,
  nameVeil as nameVeilRecord,
  removeVeil as removeVeilRecord,
  renameVeil as renameVeilRecord,
  saveVeils,
  type Veil,
  type VeilBox,
} from "../map/veils";
import { veilLive } from "./veilRules";
import {
  addAssumption as addAssumptionRecord,
  findDuplicateAssumptions,
  findOrphanAssumptions,
  loadAssumptions,
  removeAssumption as removeAssumptionRecord,
  reviseAssumption as reviseAssumptionRecord,
  saveAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "../map/assumptions";
import {
  addPointer as addPointerRecord,
  convergePointerEdit,
  findDuplicatePointers,
  findOrphanPointers,
  loadPointers,
  pointerKey,
  removePointerAt,
  savePointers,
  type Pointer,
  type PointerForm,
} from "../map/pointers";
import {
  findDuplicateQuantities,
  findOrphanQuantities,
  findOutOfPlayQuantities,
  loadQuantities,
  removeQuantity as removeQuantityRecord,
  saveQuantities,
  setQuantity as setQuantityRecord,
  type Quantity,
  type QuantityTarget,
} from "../map/quantities";
import {
  dropLinkAssumptions,
  dropLinkMarks,
  dropLoopAssumptions,
  dropPointerMarksAt,
  dropWireMarks,
  fanOutLinkRemove,
  fanOutLoopRemove,
  fanOutLoopRename,
  recoinWireMarks,
  removeReference,
  renameReference,
  retargetPointerMarks,
  rewriteAssumptionLoopTargets,
} from "../map/patches";
import { recordsDirOf } from "../map/records";
import { scopedMembership, variantAcceptWords } from "../scenarios/variant";
import { authoringLive } from "./gates";
import type { Level } from "../workspace/level";

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
 *
 * Epic 4 story 3 adds named loops (ADR-0012 decision 3, ADR-0015):
 * `map/loops.jsonl` loaded with the rest, one line per coined name plus its
 * rotation-canonical closed path. Authoring, renaming and removing are quiet
 * single-line writes through the same in-order queue as marks and links. The
 * walk is NOT here: `loopRead.ts` derives it on every render, so a flip changes
 * the read in the same breath and no verdict is ever stored. Creating a loop
 * does not touch the playing set — ADR-0013 decision 4 lets a loop name a
 * non-member and surfaces that at read time.
 *
 * Epic 4 story 4 adds assumptions (ADR-0012 decision 4): `map/assumptions.jsonl`
 * loaded with the rest, one line per claim on a word, a link pair, a loop slug
 * or a bare spot. Stating one, stating a rival (the same move again), revising
 * a line in place and removing a line are ordinary quiet moves through the
 * same in-order queue. The read never dedupes hand-edited duplicates — they are
 * preserved and surfaced — and every target rename/removal follows in the same
 * atomic batch (the loop rename's resolved slug flows into `loop` targets; a
 * removed loop or link takes its claims with it, die-with-target).
 *
 * Epic 5 story 1 adds the ground game's record (ADR-0017): `map/pointers.jsonl`
 * loaded with the rest, one line per reach with its three authored forms
 * (path / at / url, always the person's pick). Adding, editing in place (its
 * marks carried to the new key in the same batch) and removing a line (its
 * marks die with it) are quiet moves through the same in-order queue. The
 * record layer never interprets a target string, never stats it and never
 * repairs it: an `at` reach is machine-local and may dangle honestly.
 *
 * Epic 7 story 1 puts the required-set rule in the WRITERS, not only in a
 * prompt (ADR-0013 decision 1): `drawLink`, `createLoop`, `addAssumption` and
 * (Epic 8 story 1) `setQuantity` ask `authoringLive` (gates.ts) before their
 * first persist, so at dynamics with no accepted set nothing authors whatever
 * armed it. Accepting a set is what arms them, and the accept writes the
 * synchronous mirror the seam reads. The words, distances and marks shared by
 * every game are never gated: they are not the dynamics game's own records.
 *
 * Epic 8 story 1 adds quantities (ADR-0020): `map/quantities.jsonl` loaded with
 * the rest — two shapes (a stock line on a word, a flow line between two
 * words), the amount optional so absent is UNKNOWN and never 0. `setQuantity`
 * is the quiet authoring write (a new line, or the one line rewritten in place
 * at its index with the convergence rule); `removeQuantity` is the quiet ×.
 * The record NEVER joins or scopes: a line naming a word outside the playing
 * set, or a word that is gone, is preserved and surfaced here, and the writer
 * never touches `map/model.json`. The amount is authored, never inferred
 * (World B): the software does not sum, derive or compare it.
 *
 * Epic 8 story 2 adds THE BRANCH (ADR-0021): the hook takes the running
 * scenario (`options.scenario`) and reads and writes the three variant-owned
 * records — the playing set, the links and the quantities — in that branch's
 * folder instead of `map/`. Everything else stays the committed model's: the
 * references, distances, marks, loops, assumptions and pointers do not move,
 * because the map IS the committed model. A variant's set is read against the
 * map's words (`ghostMembers`: an unmatched slug is a nameless ghost,
 * surfaced and never drawn) and its accept is pruned to them (ADR-0021
 * decision 4). The lifecycle fan-out is not here: the atomic batches
 * (`map/patches.ts`) reach every folder, and the quiet loop/link moves call
 * `fanOut*` from here.
 */
export interface UseMapOptions {
  /**
   * The game running right now (ADR-0018: the zoom band is the level). It is the
   * ONE level input, so nothing here can disagree with the piece the person is
   * looking at: the composed joins hang off it (ADR-0013 — coining while playing
   * joins the word, a drawn link pulls its endpoints into play), and so does the
   * authoring seam (Epic 7 story 1 — `authoringLive`: at dynamics with no
   * accepted set the three writers no-op). Level 1 writes exactly what it wrote
   * before: absent or `"concept"` keeps every guard live.
   */
  level?: Level;
  /**
   * The branch whose model VARIANT is running (ADR-0021, Epic 8 story 2), or
   * null/absent for the committed model. While a branch is active the three
   * variant-owned records — the playing set, the links and the quantities —
   * are read from and written to `scenarios/<slug>/`; the map's own records
   * (references, distances, marks, loops, assumptions, pointers and VEILS —
   * a veil is spatial and has no branch, ADR-0023) stay in `map/`, because
   * the map IS the committed model and a branch never edits it. The switch is
   * the app's (a new slug here re-reads every record).
   */
  scenario?: string | null;
}

export function useMap(
  workspacePath: string,
  options: UseMapOptions = {},
) {
  const level = options.level ?? "concept";
  const playing = level === "dynamics";
  const scenario = options.scenario ?? null;
  // Where the three variant-owned records live right now (ADR-0021): `map/`
  // for the committed model, the branch's folder while one is active.
  const recordsDir = recordsDirOf(workspacePath, scenario);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [distances, setDistances] = useState<Distance[]>([]);
  const [malformed, setMalformed] = useState<string[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [malformedMarks, setMalformedMarks] = useState<string[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [malformedLinks, setMalformedLinks] = useState<string[]>([]);
  const [model, setModel] = useState<PlayingSet | null>(null);
  const [malformedModel, setMalformedModel] = useState<string | null>(null);
  const [loops, setLoops] = useState<Loop[]>([]);
  const [malformedLoops, setMalformedLoops] = useState<string[]>([]);
  const [assumptions, setAssumptions] = useState<Assumption[]>([]);
  const [malformedAssumptions, setMalformedAssumptions] = useState<string[]>(
    [],
  );
  const [pointers, setPointers] = useState<Pointer[]>([]);
  const [malformedPointers, setMalformedPointers] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Quantity[]>([]);
  const [malformedQuantities, setMalformedQuantities] = useState<string[]>([]);
  // Veils are COMMITTED-MODEL records (ADR-0023): they live in `map/` always,
  // never in a branch's folder, so they never read `recordsDir`.
  const [veils, setVeils] = useState<Veil[]>([]);
  const [malformedVeils, setMalformedVeils] = useState<string[]>([]);
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
  const loopsRef = useRef<Loop[]>([]);
  const malformedLoopsRef = useRef<string[]>([]);
  const loopsWriteRef = useRef<Promise<void>>(Promise.resolve());
  const assumptionsRef = useRef<Assumption[]>([]);
  const malformedAssumptionsRef = useRef<string[]>([]);
  const assumptionsWriteRef = useRef<Promise<void>>(Promise.resolve());
  const pointersRef = useRef<Pointer[]>([]);
  const malformedPointersRef = useRef<string[]>([]);
  const pointersWriteRef = useRef<Promise<void>>(Promise.resolve());
  const quantitiesRef = useRef<Quantity[]>([]);
  const malformedQuantitiesRef = useRef<string[]>([]);
  const quantitiesWriteRef = useRef<Promise<void>>(Promise.resolve());
  const veilsRef = useRef<Veil[]>([]);
  const malformedVeilsRef = useRef<string[]>([]);
  const veilsWriteRef = useRef<Promise<void>>(Promise.resolve());

  /** Re-read every map file (first load and after an atomic patch). */
  const reloadMap = useCallback(async () => {
    const [
      referenceList,
      parsedDistances,
      parsedMarks,
      parsedLinks,
      parsedModel,
      parsedLoops,
      parsedAssumptions,
      parsedPointers,
      parsedQuantities,
      parsedVeils,
    ] = await Promise.all([
      loadReferences(workspacePath),
      loadDistances(workspacePath),
      loadMarks(workspacePath),
      loadLinks(recordsDir),
      loadModel(recordsDir),
      loadLoops(workspacePath),
      loadAssumptions(workspacePath),
      loadPointers(workspacePath),
      loadQuantities(recordsDir),
      loadVeils(workspacePath),
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
    loopsRef.current = parsedLoops.loops;
    malformedLoopsRef.current = parsedLoops.malformed;
    setLoops(parsedLoops.loops);
    setMalformedLoops(parsedLoops.malformed);
    assumptionsRef.current = parsedAssumptions.assumptions;
    malformedAssumptionsRef.current = parsedAssumptions.malformed;
    setAssumptions(parsedAssumptions.assumptions);
    setMalformedAssumptions(parsedAssumptions.malformed);
    pointersRef.current = parsedPointers.pointers;
    malformedPointersRef.current = parsedPointers.malformed;
    setPointers(parsedPointers.pointers);
    setMalformedPointers(parsedPointers.malformed);
    quantitiesRef.current = parsedQuantities.quantities;
    malformedQuantitiesRef.current = parsedQuantities.malformed;
    setQuantities(parsedQuantities.quantities);
    setMalformedQuantities(parsedQuantities.malformed);
    veilsRef.current = parsedVeils.veils;
    malformedVeilsRef.current = parsedVeils.malformed;
    setVeils(parsedVeils.veils);
    setMalformedVeils(parsedVeils.malformed);
    setLoaded(true);
    // The records folder is part of the dependency: a scenario switch changes
    // WHERE the three variant records are and must re-read them.
  }, [workspacePath, recordsDir]);

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

  // The loops mirror follows the same rule: a rename or remove can land right
  // after a burst of writes, so it must never read a stale record.
  useEffect(() => {
    loopsRef.current = loops;
  }, [loops]);

  // Assumptions follow the same mirror rule: a stated rival can land right
  // after a revise, so the queue must never read a stale line list.
  useEffect(() => {
    assumptionsRef.current = assumptions;
  }, [assumptions]);

  // Pointers follow the same mirror rule: an edit carrying its marks can land
  // right after an add, so the queue must never read a stale line list.
  useEffect(() => {
    pointersRef.current = pointers;
  }, [pointers]);

  // Quantities follow it too: an amount typed on a pair right after one on a
  // word must never be written from a stale line list.
  useEffect(() => {
    quantitiesRef.current = quantities;
  }, [quantities]);

  // Veils follow the same mirror rule: a coin landing right after a retire must
  // never be written from a stale line list.
  useEffect(() => {
    veilsRef.current = veils;
  }, [veils]);

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
        .then(() => saveLinks(recordsDir, deduped, malformedLines));
    },
    [recordsDir],
  );

  /**
   * Persist the loops file after each mutation (one line per coined name, the
   * path rotation-canonical). Same in-order queue: a rename followed by a remove
   * must land in the order the person made them.
   */
  const persistLoops = useCallback(
    (next: readonly Loop[]) => {
      loopsRef.current = [...next];
      setLoops([...next]);
      const malformedLines = [...malformedLoopsRef.current];
      loopsWriteRef.current = loopsWriteRef.current
        .catch(() => undefined)
        .then(() => saveLoops(workspacePath, next, malformedLines));
    },
    [workspacePath],
  );

  /**
   * Persist the veils file after each move (ADR-0023). Same in-order queue: a
   * coin landing right after a retire must land in the order the person made
   * them. Malformed lines ride along from a ref, so an in-flight write can never
   * drop a preserved line. File order is the stacking order, so it is written as
   * the list stands — no sorting.
   */
  const persistVeils = useCallback(
    (next: readonly Veil[]) => {
      const deduped = dedupeVeils(next);
      veilsRef.current = deduped;
      setVeils(deduped);
      const malformedLines = [...malformedVeilsRef.current];
      veilsWriteRef.current = veilsWriteRef.current
        .catch(() => undefined)
        .then(() => saveVeils(workspacePath, deduped, malformedLines));
    },
    [workspacePath],
  );

  /**
   * Persist the assumptions file after each quiet move. Same in-order queue: a
   * rival stated behind a revision must land in the order the person made
   * them, never as an older line reappearing under a newer one. Every line —
   * hand-duplicated keys included — is written in file order: the read rule
   * says the app never dedupes them (ADR-0012 decision 4).
   */
  const persistAssumptions = useCallback(
    (next: readonly Assumption[]) => {
      assumptionsRef.current = [...next];
      setAssumptions([...next]);
      const malformedLines = [...malformedAssumptionsRef.current];
      assumptionsWriteRef.current = assumptionsWriteRef.current
        .catch(() => undefined)
        .then(() => saveAssumptions(workspacePath, next, malformedLines));
    },
    [workspacePath],
  );

  /**
   * Persist the pointers file after each quiet move. Same in-order queue as the
   * other records: an add behind an edit must land in the order the person
   * made them. Every line — hand-duplicated keys included — is written in file
   * order: the read rule says the app never dedupes them.
   */
  const persistPointers = useCallback(
    (next: readonly Pointer[]) => {
      pointersRef.current = [...next];
      setPointers([...next]);
      const malformedLines = [...malformedPointersRef.current];
      pointersWriteRef.current = pointersWriteRef.current
        .catch(() => undefined)
        .then(() => savePointers(workspacePath, next, malformedLines));
    },
    [workspacePath],
  );

  /**
   * Persist the quantities file after each quiet move. Same in-order queue as
   * the other records: a stock amount and a flow amount must land in the order
   * the person typed them. Every line — hand-duplicated keys included — is
   * written in file order: the read rule says the app never dedupes them. The
   * amount is written exactly as authored, and an absent amount stays absent
   * (never 0).
   */
  const persistQuantities = useCallback(
    (next: readonly Quantity[]) => {
      quantitiesRef.current = [...next];
      setQuantities([...next]);
      const malformedLines = [...malformedQuantitiesRef.current];
      quantitiesWriteRef.current = quantitiesWriteRef.current
        .catch(() => undefined)
        .then(() => saveQuantities(recordsDir, next, malformedLines));
    },
    [recordsDir],
  );

  /**
   * The composed join (ADR-0013 decision 4): pull these words into play. Runs
   * only while playing and only when a set exists — the selector is the door,
   * so a workspace with no accepted set gets no membership write. The caller
   * writes the durable thing first; this is the second write of the batch.
   *
   * While a BRANCH is active the join lands in the ACTIVE set — the branch's
   * own `model.json` (ADR-0021 decision 3) — so coining a word while a variant
   * runs writes the committed reference (`updateReference`'s first write) and
   * joins the branch's set. The committed model's set is untouched, exactly as
   * the committed links and quantities are.
   */
  const joinToPlay = useCallback(
    async (slugs: readonly string[]) => {
      if (!playing) return;
      const current = modelRef.current;
      const next = joinWords(current, slugs);
      if (next === null || next === current) return;
      modelRef.current = next;
      setModel(next);
      await saveModel(recordsDir, next);
    },
    [playing, recordsDir],
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
    const pointerKeys = new Set(
      pointers.map((pointer) => pointerKey(pointer.on, pointer.form, pointer.value)),
    );
    return findOrphanMarks(
      marks,
      wordSlugs,
      wireKeys,
      linkKeys,
      pointerKeys,
    );
  }, [loaded, refs, distances, links, pointers, marks]);

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

  /** The map's word slugs: the scope every variant's membership is read against. */
  const onMapSlugs = useMemo(
    () =>
      new Set(
        refs
          .map((ref) => ref.slug)
          .filter((slug): slug is string => slug !== null),
      ),
    [refs],
  );

  /**
   * The COMMITTED playing set naming words that are no longer on the map (a
   * hand edit): preserved in the record and surfaced quietly, never dropped on
   * an unrelated write (ADR-0013's no-validation posture, ADR-0009's
   * precedent). With a BRANCH active this reading is `ghostMembers`' instead —
   * the same lines, read as a variant's nameless ghosts (ADR-0021 decision 4)
   * — so one hand edit is never surfaced twice.
   */
  const orphanMembers = useMemo(() => {
    if (!loaded || scenario !== null || model === null) return [];
    return model.words.filter((slug) => !onMapSlugs.has(slug));
  }, [loaded, scenario, model, onMapSlugs]);

  /**
   * A BRANCH's playing set naming a slug the map does not carry: a NAMELESS
   * GHOST (ADR-0021 decision 4). It is surfaced by the notices and never drawn
   * as a word — a word is a reference on the map, and this slug names none. The
   * variant's set, as the plane reads it, is its members; the ghost is the
   * drift the branch carries, kept in its own `model.json` and never repaired.
   */
  const ghostMembers = useMemo(() => {
    if (!loaded || scenario === null || model === null) return [];
    return scopedMembership(model.words, onMapSlugs).ghosts;
  }, [loaded, scenario, model, onMapSlugs]);

  /**
   * Loops naming a word that is not on the map (a hand edit or a partial
   * write): preserved in the file and surfaced quietly, never dropped on an
   * unrelated write — the no-validation posture (ADR-0012 decision 3). The
   * walk names the same gap, per path word, when it is opened.
   */
  const orphanLoops = useMemo(() => {
    if (!loaded) return [];
    const slugs = new Set(
      refs.map((ref) => ref.slug).filter((slug): slug is string => slug !== null),
    );
    return unusedLoopSlugs(loops, slugs);
  }, [loaded, loops, refs]);

  /**
   * Assumptions whose target is not on the map (hand edit, partial write): a
   * word that is gone, a link pair that is gone or a loop slug no loop carries.
   * Preserved in the file and surfaced quietly, never dropped on an unrelated
   * write — the same no-validation posture as marks and loops. A bare spot is
   * its own target, so it is never an orphan.
   */
  const orphanAssumptions = useMemo(() => {
    if (!loaded) return [];
    const wordSlugs = new Set(
      refs.map((ref) => ref.slug).filter((slug): slug is string => slug !== null),
    );
    const linkKeys = new Set(links.map((link) => linkKey(link.from, link.to)));
    const loopKeys = new Set(loops.map((loop) => loopKey(loop)));
    return findOrphanAssumptions(
      assumptions,
      wordSlugs,
      linkKeys,
      loopKeys,
    );
  }, [loaded, refs, links, loops, assumptions]);

  /**
   * Lines whose natural key a hand edit duplicated: preserved, never deduped,
   * and surfaced by the notices (ADR-0012 decision 4's read rule).
   */
  const duplicateAssumptions = useMemo(
    () => findDuplicateAssumptions(assumptions),
    [assumptions],
  );

  /**
   * Pointers whose reference is not on the map (a hand edit or a partial
   * write): preserved in the file and surfaced quietly, never dropped on an
   * unrelated write — the same no-validation posture as the other records.
   * The TARGET is never checked: a path may be absent and an `at` reach is
   * machine-local and may dangle honestly (ADR-0017's amendment).
   */
  const orphanPointers = useMemo(() => {
    if (!loaded) return [];
    const slugs = new Set(
      refs.map((ref) => ref.slug).filter((slug): slug is string => slug !== null),
    );
    return findOrphanPointers(pointers, slugs);
  }, [loaded, refs, pointers]);

  /** Hand-edited duplicate pointer keys: preserved and surfaced (read rule). */
  const duplicatePointers = useMemo(
    () => findDuplicatePointers(pointers),
    [pointers],
  );

  /**
   * Quantities naming a word that is not on the map (a hand edit or a partial
   * write): preserved in the file and surfaced quietly, never dropped on an
   * unrelated write — and NEVER a reason to rejoin the word (ADR-0020 decision
   * 3). A flow is an orphan when either end is gone.
   */
  const orphanQuantities = useMemo(() => {
    if (!loaded) return [];
    const slugs = new Set(
      refs.map((ref) => ref.slug).filter((slug): slug is string => slug !== null),
    );
    return findOrphanQuantities(quantities, slugs);
  }, [loaded, refs, quantities]);

  /**
   * Quantities on an on-map word that is OUT of the playing set: preserved and
   * surfaced, never joined and never used to scope the record (ADR-0020
   * decision 3). No accepted set means nothing is out of play (the same reading
   * `outOfPlay` uses).
   */
  const outOfPlayQuantities = useMemo(() => {
    if (!loaded) return [];
    const slugs = new Set(
      refs.map((ref) => ref.slug).filter((slug): slug is string => slug !== null),
    );
    const playing = model === null ? null : new Set(model.words);
    // A line whose word is gone is the ORPHAN read's; counting it here as well
    // would surface one hand edit twice in the notices.
    const orphans = new Set(findOrphanQuantities(quantities, slugs));
    return findOutOfPlayQuantities(quantities, playing, slugs).filter(
      (quantity) => !orphans.has(quantity),
    );
  }, [loaded, refs, model, quantities]);

  /** Hand-edited duplicate quantity keys: preserved and surfaced (read rule). */
  const duplicateQuantities = useMemo(
    () => findDuplicateQuantities(quantities),
    [quantities],
  );

  /**
   * Accept the selector's set: one explicit write of the MODEL record
   * (ADR-0013) — `map/model.json`, or the active branch's `model.json` while a
   * variant runs. Re-running rewrites the record — no history, no confirmation;
   * a formerly unreadable file is replaced here because the person said so.
   *
   * With a branch active the set is MEMBERSHIP-SCOPED (ADR-0021 decision 4): a
   * variant may join or prune EXISTING words only, so the accept's words are
   * pruned to the map's (a slug that left the map while the selector was open
   * never lands in the branch's record as a new ghost). The committed set's
   * accept keeps its own reading — the map is the person's, exactly as before.
   */
  const acceptPlayingSet = useCallback(
    (slugs: readonly string[]) => {
      const next: PlayingSet = {
        words:
          scenario === null ? dedupe(slugs) : variantAcceptWords(slugs, onMapSlugs),
        extra: model?.extra ?? {},
      };
      // The mirror first, for the same reason the joins set it: the accept is
      // what makes authoring LIVE (Epic 7 story 1), so the seam must see it
      // before the next gesture, not one render later.
      modelRef.current = next;
      setModel(next);
      setMalformedModel(null);
      void saveModel(recordsDir, next);
    },
    [recordsDir, model, onMapSlugs, scenario],
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
      // The authoring seam (Epic 7 story 1): a dead door writes nothing, even
      // when a sign choice reached it. Level 1 and ground are untouched.
      if (!authoringLive(level, modelRef.current)) return;
      persistLinks(drawLinkRecord(linksRef.current, from, to, sign));
      void joinToPlay([from, to]);
    },
    [persistLinks, joinToPlay, level],
  );

  /** Flip a link's sign: rewritten in place at its line's index (quiet). */
  const flipLink = useCallback(
    (from: string, to: string) => {
      persistLinks(flipLinkRecord(linksRef.current, from, to));
    },
    [persistLinks],
  );

  /**
   * Remove a link (ammo, one click) and the marks and assumption lines
   * targeting it — die-with-target (ADR-0009's amendment, ADR-0012 decision
   * 6). No distance is touched: the two families share only the pair
   * (ADR-0014 decision 2). A sign flip reaches none of this: neither key
   * carries a sign.
   *
   * The branches follow in the same move (Epic 8 story 2, ADR-0021 decision
   * 3): every branch folder's pins on that ordered pair die with it, so no
   * branch is left standing on a claim about a link that is gone.
   */
  const removeLink = useCallback(
    (from: string, to: string) => {
      persistLinks(removeLinkRecord(linksRef.current, from, to));
      persistMarks(dropLinkMarks(marksRef.current, from, to));
      persistAssumptions(
        dropLinkAssumptions(assumptionsRef.current, from, to),
      );
      void fanOutLinkRemove(workspacePath, from, to).catch(() => undefined);
    },
    [persistLinks, persistMarks, persistAssumptions, workspacePath],
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

  /**
   * Coin a loop: one line, the name exactly as coined (a key collision mints a
   * numeric suffix in the name, never a silent merge), the path rotated
   * canonically at its smallest slug with direction and closure kept
   * (ADR-0015 decision 5). The gate's path gesture supplies the closed slug
   * list; membership is deliberately untouched (ADR-0013 decision 4).
   */
  const createLoop = useCallback(
    (name: string, path: readonly string[]) => {
      // The same seam: a coined loop is a dynamics record, so it needs an
      // accepted set before its line can be written.
      if (!authoringLive(level, modelRef.current)) return;
      persistLoops(nameLoopRecord(loopsRef.current, name, path));
    },
    [persistLoops, level],
  );

  /**
   * Rename a loop: one in-place rewrite of its line — name, key and path bytes
   * in one atomic move, unknown keys riding along (ADR-0012 decision 3). The
   * loop's line is the durable record and is written first; the assumption
   * lines targeting its slug follow in the same user move — the RESOLVED slug
   * (a collision suffix included) flows into the targets (story 4). A quiet
   * no-op rename writes nothing more.
   */
  const renameLoop = useCallback(
    (loop: Loop, newName: string) => {
      const current = loopsRef.current;
      const oldKey = loopKey(loop);
      const next = renameLoopRecord(current, loop, newName);
      persistLoops(next);
      const index = current.findIndex(
        (candidate) => loopKey(candidate) === oldKey,
      );
      const renamed = index === -1 ? undefined : next[index];
      if (!renamed) return;
      const newKey = loopKey(renamed);
      if (newKey === oldKey) return;
      persistAssumptions(
        rewriteAssumptionLoopTargets(assumptionsRef.current, oldKey, newKey),
      );
      // Every branch's pins follow the resolved slug too (ADR-0021 decision 3):
      // a loop target is an address like a word's, and an address change is
      // never a dangle.
      void fanOutLoopRename(workspacePath, oldKey, newKey).catch(() => undefined);
    },
    [persistLoops, persistAssumptions, workspacePath],
  );

  /**
   * Remove a loop — ammo, one click, no ceremony; only its line goes, and the
   * assumption lines targeting its slug die with it (die-with-target, story 4).
   * A removal is no place to keep a claim about a loop that is gone.
   */
  const removeLoop = useCallback(
    (loop: Loop) => {
      persistLoops(removeLoopRecord(loopsRef.current, loop));
      persistAssumptions(
        dropLoopAssumptions(assumptionsRef.current, loopKey(loop)),
      );
      // Die-with-target everywhere: each branch's pins targeting the loop go
      // with it (ADR-0021 decision 3).
      void fanOutLoopRemove(workspacePath, [loopKey(loop)]).catch(
        () => undefined,
      );
    },
    [persistLoops, persistAssumptions, workspacePath],
  );

  /**
   * Coin a veil (ADR-0023, Epic 9 story 1): the captured BOX plus the person's
   * name and reason, one line appended in file order (the stacking order). The
   * name is minted with the loops rules at coin time; the reason is stored
   * exactly as it arrived. The veil lives in `map/` — never a branch folder —
   * and nothing else writes it: a word's rename or removal leaves it alone
   * (no record references a veil).
   *
   * The LEVELS 1–2 rule is enforced here too (`veilLive`): at ground a veil
   * could never show, so one is never coined — the same "the write is where the
   * rule is enforced" seam as `authoringLive`.
   */
  const createVeil = useCallback(
    (name: string, reason: string, box: VeilBox) => {
      if (!veilLive(level)) return;
      persistVeils(nameVeilRecord(veilsRef.current, name, box, reason));
    },
    [persistVeils, level],
  );

  /**
   * Rename a veil: one in-place rewrite — the name and its natural key in one
   * move, the box, the reason and unknown keys preserved (a collision mints the
   * numeric suffix, exactly as at coin). No other record follows: nothing
   * addresses a veil, so nothing can dangle. Provisional until the look-under
   * offers the rename (Epic 9 story 2).
   */
  const renameVeil = useCallback(
    (veil: Veil, newName: string) => {
      persistVeils(renameVeilRecord(veilsRef.current, veil, newName));
    },
    [persistVeils],
  );

  /**
   * Retire a veil — ammo, one click, no ceremony: its line goes and nothing
   * else (no tombstone, no dependent record, no scenario copy). The covered
   * words were never touched, so they read exactly as before.
   */
  const removeVeil = useCallback(
    (veil: Veil) => {
      persistVeils(removeVeilRecord(veilsRef.current, veil));
    },
    [persistVeils],
  );

  /**
   * State a claim about a target (story 4): one new line, appended in file
   * order. Stating a rival is the SAME move — another line on the same target
   * — and stating the identical claim again rewrites its one line in place.
   * The software never reads the text (World B); only the person states one.
   */
  const addAssumption = useCallback(
    (target: AssumptionTarget, text: string) => {
      // The same seam: a claim is a dynamics record, and a field that opened
      // under an accepted set that has since gone away still writes nothing.
      if (!authoringLive(level, modelRef.current)) return;
      persistAssumptions(
        addAssumptionRecord(assumptionsRef.current, text, target),
      );
    },
    [persistAssumptions, level],
  );

  /**
   * Revise one line's text in place (never append), with edit-convergence: if
   * the new text equals another line's on the same target, that colliding line
   * is dropped in the same quiet edit and the edited line survives with its own
   * unknown keys. The line is addressed by OBJECT identity, which the pure
   * steps preserve for untouched lines — so an edit can never act on a line a
   * converging edit shifted. A line that is no longer present is a quiet no-op.
   */
  const reviseAssumption = useCallback(
    (assumption: Assumption, text: string) => {
      const index = assumptionsRef.current.indexOf(assumption);
      if (index === -1) return;
      persistAssumptions(
        reviseAssumptionRecord(assumptionsRef.current, index, text),
      );
    },
    [persistAssumptions],
  );

  /** Remove one assumption line — ammo, one quiet ×, no tombstone. */
  const removeAssumption = useCallback(
    (assumption: Assumption) => {
      const index = assumptionsRef.current.indexOf(assumption);
      if (index === -1) return;
      persistAssumptions(removeAssumptionRecord(assumptionsRef.current, index));
    },
    [persistAssumptions],
  );

  /**
   * Author a quantity (Epic 8 story 1, ADR-0020): one line per natural key —
   * a stock line on `on`, a flow line over `from`/`to` — appended when the
   * target has none, or rewritten IN PLACE at its index with the edit-
   * convergence rule. `null` amount is the UNKNOWN state the person reached and
   * saved (the line is visible, the number is not); 0 is a stated zero and is
   * written only when typed. The required-set seam is the same as the other
   * dynamics writers: with no accepted set at dynamics nothing is authored.
   */
  const setQuantity = useCallback(
    (target: QuantityTarget, amount: number | null) => {
      if (!authoringLive(level, modelRef.current)) return;
      persistQuantities(
        setQuantityRecord(quantitiesRef.current, target, amount),
      );
    },
    [persistQuantities, level],
  );

  /** Remove one quantity line by its target — ammo, one quiet ×, no tombstone. */
  const removeQuantity = useCallback(
    (target: QuantityTarget) => {
      persistQuantities(removeQuantityRecord(quantitiesRef.current, target));
    },
    [persistQuantities],
  );

  /**
   * Add a pointer to a word (story 1): one new line in file order, the form
   * exactly as picked by the person (never sniffed from the value, World B).
   * A byte-exact re-statement keeps its one line. Nothing is interpreted, and
   * a blank target writes nothing.
   */
  const addPointer = useCallback(
    (on: string, form: PointerForm, value: string) => {
      const current = pointersRef.current;
      const next = addPointerRecord(current, on, form, value);
      // A byte-exact re-statement (or a blank target) is a quiet no-op: the
      // file is not rewritten with the bytes it already has.
      if (next.length !== current.length) persistPointers(next);
    },
    [persistPointers],
  );

  /**
   * Edit a pointer's form/value in place (the quiet revision): the line
   * changes AT ITS INDEX, with edit-convergence dropping a colliding line (the
   * edited line is the survivor and keeps its unknown keys). Addressed by
   * OBJECT identity, which the pure steps preserve for untouched lines, so the
   * wrong line can never be edited after a converging drop.
   *
   * Write order: the POINTER LINE first, its marks second (ADR-0009's
   * tightened amendment) — a mark on the reach follows the line to its new
   * key, so a crash can only surface an orphan mark, never a mark naming a
   * line the app never wrote.
   */
  const editPointer = useCallback(
    (pointer: Pointer, form: PointerForm, value: string) => {
      const current = pointersRef.current;
      const index = current.indexOf(pointer);
      if (index === -1) return;
      // A commit that changed nothing writes nothing at all.
      if (form === pointer.form && value === pointer.value) return;
      const edited: Pointer = { ...pointer, form, value };
      persistPointers(convergePointerEdit(current, index, form, value).pointers);
      const moved = retargetPointerMarks(marksRef.current, pointer, edited);
      if (moved !== marksRef.current) persistMarks(moved);
    },
    [persistPointers, persistMarks],
  );

  /**
   * Remove one pointer line — ammo, one quiet ×, no tombstone — and the marks
   * on it, in the same move (die-with-target): a mark dies with its line.
   */
  const removePointer = useCallback(
    (pointer: Pointer) => {
      const index = pointersRef.current.indexOf(pointer);
      if (index === -1) return;
      persistPointers(removePointerAt(pointersRef.current, index));
      const remaining = dropPointerMarksAt(marksRef.current, pointer);
      // A line nobody marked takes no mark write with it.
      if (remaining.length !== marksRef.current.length) persistMarks(remaining);
    },
    [persistPointers, persistMarks],
  );

  /**
   * Cast or settle an open mark on a pointer LINE: "this reach is open" has an
   * address (ADR-0009's tightened amendment). The target copies the pointer's
   * key fields, so a byte-identical hand duplicate shares the key and both
   * render marked; a replace-in-place edit carries the mark to the new key.
   */
  const togglePointerMark = useCallback(
    (pointer: Pointer) => {
      const target: MarkTarget = {
        type: "pointer",
        on: pointer.on,
        form: pointer.form,
        value: pointer.value,
      };
      const current = marksRef.current;
      const next = hasMark(current, "open", target)
        ? withoutMark(current, "open", target)
        : withMark(current, { kind: "open", target, extra: {} });
      persistMarks(next);
    },
    [persistMarks],
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
    ghostMembers,
    loops,
    malformedLoops,
    orphanLoops,
    veils,
    malformedVeils,
    assumptions,
    malformedAssumptions,
    duplicateAssumptions,
    orphanAssumptions,
    pointers,
    malformedPointers,
    duplicatePointers,
    orphanPointers,
    quantities,
    malformedQuantities,
    duplicateQuantities,
    orphanQuantities,
    outOfPlayQuantities,
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
    createLoop,
    renameLoop,
    removeLoop,
    createVeil,
    renameVeil,
    removeVeil,
    addAssumption,
    reviseAssumption,
    removeAssumption,
    setQuantity,
    removeQuantity,
    addPointer,
    editPointer,
    removePointer,
    togglePointerMark,
  };
}
