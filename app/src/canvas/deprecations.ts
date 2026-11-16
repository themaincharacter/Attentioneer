/**
 * DEPRECATED AFFORDANCES — hidden 2026-11-16 per user review.
 *
 * The person played with the app and asked for the CONCEPT LAYER SIMPLIFIED:
 * a word coined at a point and a distance drawn between words, and nothing
 * else offered on the plane for now.
 *
 * NOTHING IS DELETED BY THIS PASS. Every component, every pure rule and every
 * piece of RECORD machinery stays exactly where it was — marks still parse and
 * serialize (`map/marks.ts`), the creation grammar still names each game's
 * kinds (`creationKinds`), the follow's targets and its anchored jump still
 * compute (`canvas/followRules.ts`), the veils still render. What changes is
 * the OFFER: each hiding point below reads one flag, keeps its markup/code
 * present, and simply does not render or hand the affordance over.
 *
 * Each hiding point carries the same comment, so the sweep can find them all:
 *   `// DEPRECATED (hidden 2026-11-16 per user review): <what and why> — delete`
 *   `// in the deprecated sweep`
 *
 * The flags are typed `boolean` (never the literal `true`) on purpose: the
 * hiding points must read them as a runtime fact, so the code paths they
 * suppress stay written and type-checked. Flipping a flag back to `false`
 * restores the affordance without touching the components.
 *
 * Provisional: the hiding (not deleting) posture is the review's own call; the
 * sweep that deletes these features is a later session's story.
 *
 * A SECOND review the same day cleared the TOP MENU (the level control) and
 * asked for a draw choice on the creation menu. Its flags live in their own
 * section further down, with the same discipline and the same sweep.
 */

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the double-click creation
 * menu offered a `lack` in every game. The review asked for the ring menu to
 * offer ONLY the word option — delete in the deprecated sweep.
 */
export const LACK_CREATION_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): at dynamics the ring menu
 * grew a third kind, `assumption`. The review asked for the ring menu to offer
 * ONLY the word option — delete in the deprecated sweep.
 */
export const ASSUMPTION_CREATION_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the tentative mark's
 * user-facing affordances — the word's open ring, the wire's label ring, the
 * pointer row's ring — created and settled an open mark. The review asked for
 * the tentative feature to be hidden; the mark RECORD machinery stays (other
 * features read and write marks) — delete in the deprecated sweep.
 */
export const TENTATIVE_MARK_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the word's follow control
 * (◎) offered the two OTHER games as a jump — the dynamics and ground "level
 * faces" the person picks on a word. The review asked for that selection to be
 * hidden, so a word shows its own name and its quiet controls and offers no
 * level faces — delete in the deprecated sweep.
 */
export const CROSS_LEVEL_FACES_HIDDEN: boolean = true;

/* ------------------------------------------------------------------------- *
 * The SECOND review (2026-11-16): the top menu, and the pen on the bubble menu.
 *
 * The person played with the app again and read the level control — the quiet
 * row at the top of the window — as CLUTTER: everything in it except the three
 * game jumpers and the map's `draw` toggle. Same discipline as the pass above,
 * same sweep: each door below keeps its markup, its props and its handler, and
 * the control simply stops offering it. The dynamics block becomes empty after
 * the hides; that is the review's call, not an accident, and the three jumpers
 * and the pen survive in EVERY game exactly as they were.
 *
 * The review also asked for a DRAW choice on the double-click creation menu.
 * That one is NOT a hiding flag: the bubble is an ACTION (arm the same pen the
 * control's toggle arms), never a creation kind, so gates.ts's
 * `CreationKind`/`creationKinds`/`offeredCreationKinds` keep their shape and the
 * ghost's card grammar keeps reading them. Nothing is deprecated by it.
 *
 * Provisional: which doors survive (the three game jumpers and the pen) is the
 * review's call, exactly as the first pass's posture was; the sweep that
 * deletes these doors is a later session's story.
 * ------------------------------------------------------------------------- */

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the level control carried THE
 * PULL ASK's door — the quiet "where am I thin…" button, and the pull's ONLY
 * trigger. The review read the row as clutter and asked for the drawing tool
 * and the game tabs alone, so the control stops offering the door; the door's
 * component, the pull's reading and its panel all stay (the read is a record
 * read, nothing else fires it) — delete in the deprecated sweep.
 */
export const PULL_DOOR_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the level control offered
 * `veil` at Levels 1–2 — the arm of the veil's draw box. The review asked for
 * the row's clutter to go; the box's arm, its coin field and the veils the
 * record holds all stay (the level rule lives in veilRules.ts) — delete in the
 * deprecated sweep.
 */
export const VEIL_DOOR_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the level control's dynamics
 * section offered "edit the playing set" — the selector's door (ADR-0013). The
 * review asked for the row's clutter to go, so the control stops offering it;
 * the selector, its strip and every write it feeds stay (a deliberate jump into
 * dynamics still asks for a missing set through the app's own prompt) — delete
 * in the deprecated sweep.
 */
export const EDIT_SET_DOOR_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the dynamics section offered
 * "coin a loop" — the path gesture's door (Epic 4 story 3). The review asked
 * for the row's clutter to go; the path session, the loop records and the walk
 * all stay — delete in the deprecated sweep.
 */
export const COIN_LOOP_DOOR_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the dynamics section offered
 * "ask…" — the ghost's ask surface (Epic 10 story 3). The review asked for the
 * row's clutter to go; the ask panel, the packets and the held proposals all
 * stay — delete in the deprecated sweep.
 */
export const ASK_DOOR_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the dynamics section hosted
 * the SCENARIO CHOOSER (ADR-0021) — the branch list, "the map", and the one
 * action that makes (or retires) a branch. The review asked for the row's
 * clutter to go, so the control stops offering the chooser; the chooser, the
 * branch records and the app's full switch path all stay. THE NAMED COST: the
 * chooser is the only way back to the committed model from a branch, so a
 * workspace whose active scenario is set stays in that branch — delete in the
 * deprecated sweep.
 */
export const SCENARIO_CHOOSER_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the dynamics section offered
 * "compare…" — the frozen two-value reading of a branch against the committed
 * model (ADR-0021 §7 amended), offered only once a branch exists. The review
 * asked for the row's clutter to go; the comparison panel, its bridges and its
 * refusal rules all stay — delete in the deprecated sweep.
 */
export const COMPARE_DOOR_HIDDEN: boolean = true;

/**
 * Is a hidden affordance OFFERED right now? The level control's hiding points
 * read their flag through this one word (`offered(PULL_DOOR_HIDDEN)`), so the
 * flip-back rule is executable: a flag set to `false` offers the affordance
 * again without a component edit. The pass above reads `!FLAG` directly; this
 * is that same rule, named once for the row the second review cleared.
 */
export function offered(hidden: boolean): boolean {
  return !hidden;
}

/* ------------------------------------------------------------------------- *
 * The THIRD review (2026-11-16): SEPARATE MAPS — the concept map's content
 * stops rendering at dynamics and ground.
 *
 * The person's verdict, after playing with all three games: the maps will NOT
 * be THE SAME MAP. The dynamics map will grow its own modeling features later
 * and the ground map its own file references — but not in this session. For
 * now the dynamics and ground maps are BLANK PAPER: the concept map's record
 * content stops being copied into them, and only quiet chrome remains (paper,
 * pan, zoom, the zoom chip, the three level tabs and the pen's strip).
 *
 * Same discipline as the passes above, same sweep: nothing is deleted. Every
 * component, every read, every record and every panel stays written and
 * type-checked; each hiding point reads a flag through the ONE rule in
 * `canvas/mapContentRules.ts`, so flipping the flag back restores the content
 * without a component edit.
 *
 * The pen's ink is NOT hidden by this pass (PROVISIONAL): the draw tool is the
 * one level-uniform tool the previous review kept, and per-map ink arrives
 * with the later "context" work. See mapContentRules.ts.
 * ------------------------------------------------------------------------- */

/**
 * DEPRECATED (hidden 2026-11-16 per user review — separate maps): the same
 * map's content — words, distance wires, marks, the shelf, veils, link wires,
 * loop routes, assumption diamonds, quantity glyphs, the reach/pointer
 * handles and every branch/scenario-derived reading — rendered in EVERY game
 * because the three games were bands of one map. The review decided the maps
 * will not be the same maps; until dynamics and ground grow their own content
 * (a later story), they render NO map content at all. ONE flag covers the
 * whole content class; `canvas/mapContentRules.ts` is its one reading and
 * every hiding point in the app asks that rule — delete this seam and the
 * copy-over in the deprecated sweep (the maps' own content is a LATER story,
 * not a revival of this flag).
 */
export const MAP_CONTENT_OTHER_GAMES_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review — separate maps): the
 * double-click creation bubble offered `word` in every game. A word is
 * concept-map content, so coining one on a map that cannot render it would be
 * a lie. The review's rule: the bubble at dynamics and ground offers only
 * `draw`. The creation grammar (`creationKinds`) and the ghost's card
 * derivation keep their exact shape; only the OFFER narrows — delete this
 * seam in the deprecated sweep (the word returns only if the other maps grow
 * concepts of their own).
 */
export const WORD_CREATION_OFF_CONCEPT_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review — separate maps): the step
 * crank stood at dynamics as a panel outside the plane. A cranked step reads
 * the playing set's quantities on the map, and the dynamics map is blank paper
 * for now, so there is nothing for the crank to read. Its component, its hook
 * (`useStepRun`), its notes and its model all stay written — delete this
 * hiding point (not the machinery) in the deprecated sweep, when the dynamics
 * map grows its own modeling surfaces.
 */
export const STEP_CRANK_HIDDEN: boolean = true;


/* ------------------------------------------------------------------------- *
 * The FOURTH review (2026-11-16): REMOVE THE SHELF, and REMOVE MAP-CHANGING BY
 * ZOOM — one story, two retirements, both HIDE + DEPRECATE.
 *
 * The person's verdict, in two parts:
 *
 *   1. THE SHELF GOES. The fold at the plane's edge — the place a word dragged
 *      past it was "set aside" — is not wanted. Same discipline as every pass
 *      above: nothing is deleted. `map/shelf.ts` keeps the fold's record
 *      (`shelf_x` still parses, still defaults, `isShelved` and `rejectSpot`
 *      still compute, the extents still measure), and `canvas/shelfRules.ts` is
 *      the ONE reading of "is the shelf shown right now". While the flag stands
 *      the fold and its margin do not render, the word's reject control (settle
 *      + set aside) is not offered, the drag-past-the-fold gesture sets nothing
 *      aside, and the plane's hint loses its fold clause.
 *      A WORD ALREADY SET ASIDE keeps its record exactly as it is and is NOT
 *      SHOWN anywhere (see `setAsideShown`); flipping the flag back puts it back
 *      on the shelf it never left, with no write.
 *
 *   2. THE ZOOM NO LONGER CHANGES THE MAP. The three maps are SEPARATE
 *      mini-apps now (ADR-0032): the level tabs are the ONLY way to switch maps
 *      (besides the workspace's own open-restore), and the wheel only zooms
 *      within the map you are on. The band machinery stays written and
 *      type-checked — `levelFromZoom`, the band constants, the level handoff's
 *      settle, the camera's band intent and the level pin — but nothing calls
 *      the wheel's path any more: `workspace/level.ts`'s derivation and
 *      `canvas/zoomBands.ts`'s boundaries are inert data, and each map keeps its
 *      OWN camera so a tab switch restores that map exactly like a little app.
 *
 * Same sweep comment on every hiding point:
 *   `// DEPRECATED (hidden 2026-11-16 per user review): <what and why> — delete`
 *   `// in the deprecated sweep`
 *
 * Provisional: both retirements are the review's call, the shapes of the
 * remaining controls (the tabs' wording, the zoom clamp, the per-map cameras)
 * are named PROVISIONAL at their sites, and the sweep that deletes the shelf and
 * the band switch is a later session's story.
 * ------------------------------------------------------------------------- */

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the SHELF (ADR-0010) — the
 * fold and its shaded margin at the plane's edge, the word's reject control
 * (the quiet → that settled a word and set it aside), the drag-past-the-fold
 * gesture (a word whose centre crossed the fold read as set aside) and the
 * plane hint's "drag past the fold to set aside" clause.
 *
 * The review asked for the shelf to go. Nothing is deleted: `map/shelf.ts` keeps
 * the fold's record (`shelf_x` parses and defaults exactly as before,
 * `isShelved`/`rejectSpot`/`foldExtent`/`foldCaptionTops` all still compute),
 * `ShelfFold` keeps its whole markup, and the reject write in `useMap` is
 * untouched. `canvas/shelfRules.ts` is the ONE reading of the flag for the
 * render; flipping this flag back to `false` restores the fold, the gesture, the
 * reject control and the hint clause with no component edit.
 *
 * The RECORDS stay, the PLACE does not: a word already set aside in an existing
 * workspace keeps its file byte-exactly and is simply not shown while the flag
 * stands (it lives on a shelf that is not there). `setAsideShown` is the reading
 * a render asks before drawing a word.
 *
 * NAMED COST: while the shelf is hidden a word cannot be carried past the fold
 * (`heldLeftOfTheFold` stops the drop at the old fold line) — otherwise a
 * dropped word would land in the hidden set and vanish, which would be a data
 * trap. The invisible edge is PROVISIONAL and is a report item for the review.
 */
export const SHELF_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): ZOOM AS THE MAP SWITCH
 * (ADR-0018 decision 1, superseded by ADR-0032). The wheel used to DERIVE the
 * map from the settled zoom (`levelFromZoom`, a settled crossing rewrote
 * `workspace.yml`'s `level` key through the level handoff), the level pin held
 * a crossing while a gesture was armed or a field had focus, the camera's band
 * intents kept every move inside the running band, and a click-to-center landed
 * on the band's landing zoom.
 *
 * The review's verdict: the maps are SEPARATE mini-apps — the TABS switch them
 * and nothing else, and the wheel only zooms within the map you are on. Every
 * piece above stays written and type-checked (the derivation, the band
 * constants, `LevelHandoff.settle`, `useCamera`'s band intent, the level pin and
 * the focus reading) and simply stops driving the switch; each map keeps its OWN
 * camera so a tab switch restores that map like a little app. Flipping this flag
 * back to `false` restores the zoom-band behavior with no component edit.
 *
 * The `level` key STAYS as the resume hint — it remembers the last map you were
 * on, and opening a workspace restores that map.
 */
export const ZOOM_SWITCHES_MAP_HIDDEN: boolean = true;
