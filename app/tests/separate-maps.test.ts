import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAP_CONTENT_FAMILIES,
  planeHint,
  renderedMapContent,
  showsMapContent,
  wordCreationOffered,
} from "../src/canvas/mapContentRules";
import {
  MAP_CONTENT_OTHER_GAMES_HIDDEN,
  STEP_CRANK_HIDDEN,
  WORD_CREATION_OFF_CONCEPT_HIDDEN,
  offered,
} from "../src/canvas/deprecations";
import {
  creationKinds,
  offeredCreationKinds,
  type CreationKind,
} from "../src/canvas/gates";
import {
  MENU_BUBBLE_H,
  MENU_DOT,
  MENU_GAP,
  dotOffset,
  menuCluster,
} from "../src/canvas/planeMenuRules";
import { noticeGroups, noticeVisibleIn } from "../src/canvas/notices";
import { LEVELS, RENDER_MAP } from "../src/workspace/level";

/**
 * The SEPARATE-MAPS review (hidden 2026-11-16 per user review), automated.
 *
 * The person played with all three games and gave a verdict: the maps will NOT
 * be the same maps. The dynamics map will grow modeling surfaces and the ground
 * map file references LATER; for now the concept map's content stops being
 * copied over and the dynamics/ground maps are BLANK PAPER. The house rule is
 * HIDE + DEPRECATE, not delete: every record, component, panel and handler stays
 * written, each hiding point reads ONE rule (canvas/mapContentRules.ts), and
 * flipping the flag restores the content with no component edit.
 *
 * This file pins:
 *
 *   - the three flags are on, and the rules read them as runtime facts;
 *   - the ONE central rule's shape: content at concept only, NOTHING off it,
 *     and the flip-back restores the whole class;
 *   - the blank-map invariant: the dynamics and ground renders carry no map
 *     content, while the quiet chrome and the pen's ink keep rendering;
 *   - every render path in the app asks the rule (no drift, no second table);
 *   - the double-click bubble offers DRAW ONLY at dynamics/ground and word +
 *     draw at concept, with the creation grammar kept for the record machinery;
 *   - the interactions die with their surfaces: no playing-set prompt, no crank,
 *     and every panel is written but unreachable;
 *   - the honesty surfaces are NOT gated (the notices strip keeps its own rule,
 *     and the reported tension is that it can name hidden content);
 *   - the negative space: no count, score, streak, heat or progress vocabulary
 *     in any new string.
 *
 * Converted tests elsewhere carry the same review's one-line comment; nothing
 * in this review deleted a feature, so the deprecated sweep is a later story.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const APP = source("App.tsx");
const PLANE = source("canvas/CanvasPlane.tsx");
const MENU = source("canvas/PlaneMenu.tsx");
const CONTROL = source("canvas/LevelControl.tsx");
const RULES = source("canvas/mapContentRules.ts");
const DEPRECATION = "DEPRECATED (hidden 2026-11-16 per user review";

/* ----------------------------------------------------------------------- *
 * 1. The flags (on, and read as runtime facts).
 * ----------------------------------------------------------------------- */

describe("the separate-maps flags (hidden, never deleted)", () => {
  test("the three flags are on", () => {
    expect(MAP_CONTENT_OTHER_GAMES_HIDDEN).toBe(true);
    expect(WORD_CREATION_OFF_CONCEPT_HIDDEN).toBe(true);
    expect(STEP_CRANK_HIDDEN).toBe(true);
    // Read the way the hiding points read them: hidden now, offered on a
    // flip-back (the sweep later deletes, it never flips silently).
    for (const flag of [
      MAP_CONTENT_OTHER_GAMES_HIDDEN,
      WORD_CREATION_OFF_CONCEPT_HIDDEN,
      STEP_CRANK_HIDDEN,
    ]) {
      expect(offered(flag)).toBe(false);
      expect(offered(false)).toBe(true);
    }
  });

  test("the rules read the flags as DEFAULTS, never inline the literal", () => {
    // A runtime fact: the flag is the parameter's default, so a flip-back is a
    // flag edit and not a component edit.
    expect(RULES).toContain(
      "hidden: boolean = MAP_CONTENT_OTHER_GAMES_HIDDEN",
    );
    expect(RULES).toContain(
      "hidden: boolean = WORD_CREATION_OFF_CONCEPT_HIDDEN",
    );
    // The hiding points carry the review's marker (the sweep finds them).
    expect(APP).toContain(DEPRECATION);
    expect(APP).toContain("delete in the deprecated sweep");
    expect(APP.split(DEPRECATION).length - 1).toBeGreaterThanOrEqual(12);
    expect(CONTROL).toContain(DEPRECATION);
    expect(RULES).toContain("MAP_CONTENT_OTHER_GAMES_HIDDEN");
  });
});

/* ----------------------------------------------------------------------- *
 * 2. The one central rule: its shape and the blank-map invariant.
 * ----------------------------------------------------------------------- */

describe("the one central rule: map content renders at concept only", () => {
  test("the rule reads concept-only, and nothing at dynamics or ground", () => {
    expect(showsMapContent("concept")).toBe(true);
    expect(showsMapContent("dynamics")).toBe(false);
    expect(showsMapContent("ground")).toBe(false);
    // The blank-map invariant, over the WHOLE class at once: off concept the
    // render carries no map content, not a remembered subset of it.
    expect(renderedMapContent("concept")).toEqual(MAP_CONTENT_FAMILIES);
    for (const level of ["dynamics", "ground"] as const) {
      expect(renderedMapContent(level)).toEqual([]);
    }
  });

  test("the content class names every family the copy-over consisted of", () => {
    expect([...MAP_CONTENT_FAMILIES]).toEqual([
      "words",
      "distances",
      "marks",
      "shelf",
      "veils",
      "links",
      "loops",
      "assumptions",
      "quantities",
      "pointers",
      "model",
      "scenarios",
      "ghosts",
    ]);
    // The pen's ink is deliberately NOT a family (it keeps rendering).
    expect([...MAP_CONTENT_FAMILIES]).not.toContain("sketches" as never);
    // Every family the render map once named is covered by the class, so the
    // blank map cannot strand a record the old partition knew.
    for (const family of [
      ...RENDER_MAP.all,
      ...RENDER_MAP.dynamics,
      ...RENDER_MAP.ground,
    ]) {
      expect([...MAP_CONTENT_FAMILIES]).toContain(family as never);
    }
  });

  test("the flip-back restores the whole class with no component edit", () => {
    // Passing hidden = false is exactly what setting the flag to false does: the
    // rule then renders the content in EVERY game again (the pre-review app).
    for (const level of LEVELS) {
      expect(showsMapContent(level, false)).toBe(true);
      expect(renderedMapContent(level, false)).toEqual(MAP_CONTENT_FAMILIES);
    }
    // The concept column never moved: with the flag ON it is already all.
    expect(renderedMapContent("concept", true)).toEqual(MAP_CONTENT_FAMILIES);
  });
});

/* ----------------------------------------------------------------------- *
 * 3. The render paths read the rule (one reading, no drift).
 * ----------------------------------------------------------------------- */

describe("the render paths ask the ONE rule", () => {
  test("the app takes ONE reading and gates every content render with it", () => {
    expect(APP).toContain("const mapContent = showsMapContent(level);");
    for (const gate of [
      // The shelf's fold and margin.
      "{mapContent && <ShelfFold shelfX={shelfX} extent={fold} />}",
      // The dynamics loops' routes.
      "{mapContent && loopRoutes.map(",
      // The bare lacks.
      "{mapContent && openSpots.map(",
      // The bare-spot assumption diamonds (band rule kept, content rule added).
      "mapContent &&\n          spotAssumptionTargets.map(",

      // The words. CONVERTED (hidden 2026-11-16 per user review — the shelf):
      // the list is `shownRefs`, every word but the ones set aside, which the
      // removed shelf no longer shows (canvas/shelfRules.ts's `setAsideShown`);
      // the words themselves are still the concept map's content, gated here.
      "{mapContent && shownRefs.map((word) => (",
      // The veils' sheets (the 1-2 rule kept, content rule added).
      "mapContent &&\n              veils.map((veil) => (",
      // The distance wires.
      "{mapContent && distances.map((d) => {",
      // The signed link wires (the band rule kept, content rule added).
      "mapContent &&\n          linkWiresVisible(level) &&",
    ]) {
      expect({ gate, written: APP.includes(gate) }).toEqual({
        gate,
        written: true,
      });
    }
    // The veils' LEVEL rule is still the outer reading (the flip-back keeps it).
    expect(APP).toContain("{veilLive(level) && (");
    expect(APP.indexOf("<VeilSheet")).toBeGreaterThan(
      APP.indexOf("{veilLive(level) && ("),
    );
  });

  test("the quiet chrome and the pen's ink are NOT gated", () => {
    // The ink keeps rendering in every game (PROVISIONAL: per-map ink is the
    // later "context" work), and the pen's strip lives outside the plane.
    expect(APP).toContain("<SketchLayer strokes={sketches} />");
    expect(APP).not.toContain("mapContent && <SketchLayer");
    expect(APP).toContain("{drawArmed && (");
    expect(PLANE).toContain('className="zoom-chip"');
    // The plane's chrome is untouched: pan, zoom and the grid still render.
    // STORY 25-7: the grid rides the camera transform (inside plane-inner),
    // so it renders AND tracks the camera with nothing repainting per frame.
    expect(PLANE).toContain('className="plane-grid"');
    expect(PLANE).toContain("onZoomSettle");
  });

  // CONVERTED (hidden 2026-11-16 per user review — the shelf): the hint used to
  // keep its "drag past the fold to set aside" clause at concept, because a shelf
  // was real there. The shelf is hidden on EVERY map now, so the clause is gone
  // everywhere and the old sentence is the flip-back (second argument false,
  // exactly what setting SHELF_HIDDEN to false does).
  test("the plane hint is the same rule's sentence (no fold clause anywhere)", () => {
    // Concept: the creation clause names the word; the fold clause is gone.
    expect(planeHint("concept")).toBe(
      "drag to pan · scroll to zoom · double-click: word",
    );
    // The old sentence is written and restored by the flip-back.
    expect(planeHint("concept", false)).toBe(
      "drag to pan · scroll to zoom · double-click: word · drag past the fold to set aside",
    );
    // Off concept: the map is blank paper, so the pen words the creation clause.
    expect(planeHint("dynamics")).toBe(
      "drag to pan · scroll to zoom · double-click: draw",
    );
    // No level names the shelf while it is hidden.
    for (const level of ["concept", "dynamics", "ground"] as const) {
      expect(planeHint(level)).not.toContain("fold");
      expect(planeHint(level)).not.toContain("set aside");
      expect(planeHint(level)).not.toContain("shelf");
    }
    // ONE rule words it: the app passes it and the plane renders it verbatim.
    // STORY 16.13 (shortlist item 3) adds the ONE exception: an empty ground
    // map says one muted sentence and nothing else, so its ordinary hint
    // (which offers a verb) is suppressed while there is nothing on it.
    expect(APP).toContain("planeHint(level)");
    expect(APP).toContain('level === "ground" && ground.loaded && ground.references.length === 0');
    expect(PLANE).toContain('<div className="plane-hint">{hint}</div>');
  });

  test("no second content table sneaks in: the rule module is the only one", () => {
    // The app does not re-derive levels for content (that would be drift).
    expect(APP).not.toContain('level === "concept" ? ');
    // The rule module imports only the level type and the flags.
    expect(RULES).not.toContain('from "../map/');
    expect(RULES).not.toContain('from "./gates');
    // The map tabs' hover titles: CONVERTED (hidden 2026-11-16 per user review —
    // separate mini-apps, ADR-0032). They used to say "jump to … the middle band";
    // with the zoom no longer picking the map there is no band to jump to, only a
    // MAP to switch to (PROVISIONAL wording).
    expect(CONTROL).toContain('dynamics: "switch maps — the dynamics map"');
    // The TITLES themselves no longer claim the old content (the DEPRECATED note
    // above them still quotes the old wording on purpose).
    expect(CONTROL.slice(CONTROL.indexOf("const LEVEL_TITLES"))).not.toContain(
      "the same map, with outward pointers",
    );
  });
});

/* ----------------------------------------------------------------------- *
 * 4. The double-click bubble: draw only off concept, word + draw at concept.
 * ----------------------------------------------------------------------- */

describe("the bubble at dynamics and ground offers DRAW alone", () => {
  test("the offer narrows by level; the grammar keeps its shape", () => {
    // Concept: unchanged — the word is still offered (draw is an ACTION).
    expect(offeredCreationKinds("concept")).toEqual(["word"]);
    // Dynamics/ground: the word is concept-map content, so the bubble's only
    // creation choice is gone (the pen's draw remains an action, never a kind).
    for (const level of ["dynamics", "ground"] as const) {
      expect(offeredCreationKinds(level)).toEqual([]);
      expect(offeredCreationKinds(level)).not.toContain("draw" as CreationKind);
    }
    // The record machinery's grammar is untouched (the ghost's card derivation
    // and the empty-space records still read it).
    expect(creationKinds("concept")).toEqual(["word", "lack"]);
    expect(creationKinds("dynamics")).toEqual(["word", "lack", "assumption"]);
    expect(creationKinds("ground")).toEqual(["word", "lack"]);
  });

  test("the word bubble is written but gated; the draw bubble renders for the concept menu", () => {
    // STORY 17.10: the concept vocabulary is gated behind "no door list"; the
    // ground map hands the same component its own doors instead.
    expect(MENU).toContain('{doors === undefined && kinds.includes("word") && (');
    expect(MENU).toContain('aria-label="coin a word here"');
    expect(MENU).toContain("onClick={() => onWord?.()}");
    expect(MENU).toContain('className="plane-menu-option plane-menu-draw"');
    expect(MENU).toContain('aria-label="draw here"');
    expect(MENU).toContain("onClick={onDraw}");
    expect(MENU).toContain("{doors === undefined && onDraw !== undefined && (");
    // The cluster's geometry reads the OFFER (not a hardcoded word above).
    expect(MENU).toContain('word: kinds.includes("word"),');
    // The first PAINTED choice takes focus, so the draw-only cluster is usable.
    expect(MENU).toContain("(wordRef.current ?? drawRef.current)?.focus();");
  });

  test("the draw-only cluster's anchor invariant still holds", () => {
    const cluster = menuCluster({
      word: false,
      lack: false,
      assumption: false,
      draw: true,
    });
    expect(cluster).toEqual({ above: 0, below: 1, total: 1, lift: -19.5 });
    // The dot's centre versus the cluster's whole height, computed independently.
    const height = cluster.total * (MENU_BUBBLE_H + MENU_GAP) + MENU_DOT;
    const dotCentre = cluster.above * (MENU_BUBBLE_H + MENU_GAP) + MENU_DOT / 2;
    expect(dotCentre - height / 2).toBe(cluster.lift);
    expect(dotOffset(0, 1)).toBe(cluster.lift);
    // The concept cluster is unchanged (word above, draw below, lift 0).
    expect(
      menuCluster({ word: true, lack: false, assumption: false, draw: true }),
    ).toEqual({ above: 1, below: 1, total: 2, lift: 0 });
  });
});

/* ----------------------------------------------------------------------- *
 * 5. Interactions die with their surfaces (machinery stays written).
 * ----------------------------------------------------------------------- */

describe("no interaction survives the blank maps", () => {
  test("the playing set is never asked for on a blank map", () => {
    // The deliberate-entry prompt (the jump path) and the open-restore prompt
    // both ask the content rule first; the pure prompt rule stays written.
    expect(APP).toContain("showsMapContent(next) &&");
    expect(APP).toContain("if (!showsMapContent(workspace.resumeLevel)) return;");
    expect(APP).toContain("shouldPromptForSet(cause, next, model !== null)");
    expect(APP).toContain(
      'shouldPromptForSet("restore", workspace.resumeLevel, model !== null)',
    );
  });

  test("the step crank is not offered on the blank dynamics map", () => {
    expect(APP).toContain(
      'level === "dynamics" && offered(STEP_CRANK_HIDDEN) && (',
    );
    expect(APP).toContain("<StepCrank");
    expect(APP).toContain("notes={step.run?.notes ?? []}");
  });

  test("every panel and every door handler is still written", () => {
    // The panels anchored to hidden content keep their markup (unreachable
    // because their triggers are hidden, never deleted).
    for (const panel of [
      "<AssumptionOverlay",
      "<QuantityOverlay",
      "<PointerChooser",
      "<OutwardWindow",
      "<PrismWindow",
      "<MakePanel",
      "<AskPanel",
      "<GhostList",
      "<GhostPreview",
      "<GhostPanel",
      "<ComparePanel",
      "<PullPanel",
      "<LoopWalk",
      "<VeilLookUnder",
      "<PlaneMenu",
    ]) {
      expect({ panel, written: APP.includes(panel) }).toEqual({
        panel,
        written: true,
      });
    }
    // And the handlers/arms behind them are untouched.
    for (const kept of [
      "const chooseWord = useCallback(",
      "const chooseLack = useCallback(",
      "const chooseAssumption = useCallback(",
      "const beginLoop = useCallback(",
      "const beginVeil = useCallback(",
      "const openSelector = useCallback(",
      "const openGhostPanel = useCallback(",
      "const openComparison = useCallback(",
      "const openPullAsk = useCallback(",
      "const openAssumptions = useCallback(",
      "const openQuantity = useCallback(",
      "const openPointers = useCallback(",
      "const openPeek = useCallback(",
      "const reopenPrism = useCallback(",
      "const openMake = useCallback(",
    ]) {
      expect({ kept, written: APP.includes(kept) }).toEqual({
        kept,
        written: true,
      });
    }
  });

  test("the lasso and the veil's box cannot arm from a blank map", () => {
    // The lasso lives INSIDE the playing-set selector — unreachable now (its
    // door is hidden and the prompt is guarded) — and the plane only takes the
    // arm while that selector is open.
    expect(APP).toContain("lassoArmed={selectorOpen && lassoArmed}");
    // The veil's box arms from the level control's hidden door, and the veil's
    // own level rule is still the first reading over it.
    expect(APP).toContain("if (!veilLive(level)) return;");
    // While any arm is on, the plane's creation/pan/word-press gates stand.
    expect(PLANE).toContain("if (!shouldCreate(gestureMode)) return;");
    expect(PLANE).toContain("isGestureArmed(modeRef.current)");
  });

  test("the bubble is the only creation path, and it cannot make a word off concept", () => {
    // Creation is the double-click only (unchanged); the word choice is the one
    // that needs content, and the offer rule above removes it off concept.
    expect(PLANE).toContain("if (!shouldCreate(gestureMode)) return;");
    expect(wordCreationOffered("concept")).toBe(true);
    for (const level of ["dynamics", "ground"] as const) {
      expect(wordCreationOffered(level)).toBe(false);
    }
    // The flag with the literal flipped is the pre-review behavior.
    for (const level of LEVELS) {
      expect(wordCreationOffered(level, false)).toBe(true);
    }
  });
});

/* ----------------------------------------------------------------------- *
 * 6. The honesty surfaces are NOT gated (and the tension is named).
 * ----------------------------------------------------------------------- */

describe("the honesty surfaces keep their guarantees", () => {
  test("the notices strip is outside the content rule and names its records", () => {
    // ADR-0009: a record line that cannot be read or placed is surfaced, always.
    // Deliberately NOT gated by the map-content rule — the reported tension is
    // that a notice can name a record whose content this game hides.
    expect(APP).not.toContain("mapContent && <MarkNotices");
    expect(APP).toContain("<MarkNotices");
    expect(APP).toContain("malformed={malformedMarks}");
    expect(APP).toContain("orphans={orphanMarks}");
    expect(APP).toContain("malformedSketches={malformedSketches}");
    // The strip's own band rule is intact: marks' notices still ride the
    // shared group, and dynamics' own records still answer at dynamics.
    expect(noticeVisibleIn("marks", "dynamics")).toBe(true);
    expect(noticeVisibleIn("marks", "ground")).toBe(true);
    expect(noticeVisibleIn("pointers", "dynamics")).toBe(false);
    expect(noticeGroups("dynamics")[0].families).toContain("marks");
  });
});

/* ----------------------------------------------------------------------- *
 * 7. The negative space: the new words announce and rank nothing.
 * ----------------------------------------------------------------------- */

describe("the negative space: no counters, scores or nudges", () => {
  const FORBIDDEN =
    /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|queue|backlog|total|points)\b/i;

  test("the hint's and the titles' words say nothing and count nothing", () => {
    const seen = [
      ...LEVELS.map((level) => planeHint(level)),
      "switch maps — the concept map",
      "switch maps — the dynamics map",
      "switch maps — the ground map",
      "word",
      "draw",
    ];
    for (const text of seen) {
      expect({ text, found: text.match(FORBIDDEN)?.[0] ?? null }).toEqual({
        text,
        found: null,
      });
    }
  });

  test("the rule module's own prose and strings stay quiet", () => {
    const code = RULES
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(FORBIDDEN);
    // No percentage, fraction or "of 3" phrasing in the hint either.
    expect(planeHint("dynamics")).not.toMatch(/\d/);
  });
});
