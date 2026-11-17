import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LevelControl } from "../src/canvas/LevelControl";
import { PullDoor } from "../src/canvas/PullDoor";
import { ScenarioChooser } from "../src/canvas/ScenarioChooser";
import {
  ASK_DOOR_HIDDEN,
  COIN_LOOP_DOOR_HIDDEN,
  COMPARE_DOOR_HIDDEN,
  EDIT_SET_DOOR_HIDDEN,
  PULL_DOOR_HIDDEN,
  SCENARIO_CHOOSER_HIDDEN,
  VEIL_DOOR_HIDDEN,
  offered,
} from "../src/canvas/deprecations";
import { LEVELS } from "../src/workspace/level";

/**
 * The TOP MENU cleanup (hidden 2026-11-16 per user review), automated.
 *
 * The person played with the app and read the level control — the quiet row at
 * the top of the window — as CLUTTER: everything in it except the three game
 * jumpers and the map's `draw` toggle. The house rule is HIDE + DEPRECATE, not
 * delete (app/src/canvas/deprecations.ts): each door keeps its markup, its prop
 * and its handler, reads one flag, and simply is not offered. So this file
 * pins, for the whole row:
 *
 *   - the seven flags are on and each door is not offered in ANY game;
 *   - the survivors — the three jumpers and the pen — are offered in EVERY game,
 *     exactly as before;
 *   - every hiding point is written, gated by its flag's negation, and carries
 *     the review's comment (so the deprecated sweep can find them);
 *   - flipping a flag back restores its door (the representative surface: the
 *     pull ask) with no component edit;
 *   - nothing behind the doors was deleted: the hidden components still render;
 *   - the negative space: no count, score, streak, heat or progress vocabulary
 *     reached the row's rendered chrome.
 *
 * The STRANDING cost of hiding the scenario chooser (the only way back to the
 * committed model from a branch) is a report item, not a test: it is recorded
 * in deprecations.ts beside SCENARIO_CHOOSER_HIDDEN.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

const CONTROL = source("canvas/LevelControl.tsx");
const APP_SOURCE = source("App.tsx");
const noop = () => {};
const DEPRECATION = "DEPRECATED (hidden 2026-11-16 per user review)";

/** The control's whole prop set, with branches present (so "compare…" could
 *  have been offered at dynamics if it were still live). */
function render(level: (typeof LEVELS)[number]) {
  return renderToStaticMarkup(
    createElement(LevelControl, {
      level,
      onJump: noop,
      onEditPlayingSet: noop,
      onCoinLoop: noop,
      onDrawVeil: noop,
      onDraw: noop,
      drawArmed: false,
      scenarios: [{ slug: "evening", name: "evening" }],
      activeScenario: "evening",
      onChooseScenario: noop,
      onBranchScenario: noop,
      onRetireScenario: noop,
      onCompare: noop,
      onAsk: noop,
      onAskPull: noop,
    }),
  );
}

/** What a hidden door would have rendered (class or label), per door. */
const HIDDEN_MARKS: ReadonlyArray<[string, string, boolean]> = [
  ["the pull ask's door", 'class="pull-door"', PULL_DOOR_HIDDEN],
  ["the veil's door", 'class="level-veil"', VEIL_DOOR_HIDDEN],
  ["edit the playing set", 'class="level-edit"', EDIT_SET_DOOR_HIDDEN],
  ["coin a loop", 'class="level-loop"', COIN_LOOP_DOOR_HIDDEN],
  ["the scenario chooser", 'class="scenario-chooser"', SCENARIO_CHOOSER_HIDDEN],
  ["compare…", 'class="level-compare"', COMPARE_DOOR_HIDDEN],
];

describe("the review's clutter: six doors hidden, the ghost ask restored", () => {
  test("the six top-menu flags are on; the ask door is offered again", () => {
    expect(PULL_DOOR_HIDDEN).toBe(true);
    expect(VEIL_DOOR_HIDDEN).toBe(true);
    expect(EDIT_SET_DOOR_HIDDEN).toBe(true);
    expect(COIN_LOOP_DOOR_HIDDEN).toBe(true);
    expect(SCENARIO_CHOOSER_HIDDEN).toBe(true);
    expect(COMPARE_DOOR_HIDDEN).toBe(true);
    // The ghost's ask is the one deliberate exception (Epic 15 story 8): the
    // turn carries the packet now, so the door is the by-hand check.
    expect(ASK_DOOR_HIDDEN).toBe(false);
    expect(offered(ASK_DOOR_HIDDEN)).toBe(true);
    // Read the way the control reads them: hidden now, offered on a flip-back.
    for (const [, , flag] of HIDDEN_MARKS) {
      expect(offered(flag)).toBe(false);
      expect(offered(false)).toBe(true);
    }
  });

  test("no door is offered in any game, even with branches on disk", () => {
    for (const level of LEVELS) {
      const html = render(level);
      for (const [name, mark] of HIDDEN_MARKS) {
        expect({ level, name, offered: html.includes(mark) }).toEqual({
          level,
          name,
          offered: false,
        });
      }
      // The ghost's ask is the one offered exception, at dynamics only.
      expect({ level, offered: html.includes('class="level-ask"') }).toEqual({
        level,
        offered: level === "dynamics",
      });
      // The titles and labels would be text in the chrome, so they are gone too.
      for (const label of [
        "edit the playing set",
        "coin a loop",
        "compare…",
        "veil",
        "where am I thin…",
      ]) {
        expect({ level, label, offered: html.includes(">" + label + "<") }).toEqual({
          level,
          label,
          offered: false,
        });
      }
    }
  });

  test("the three jumpers, the pen and settings survive in every game", () => {
    for (const level of LEVELS) {
      const html = render(level);
      // The tab switching: the three games, the current one pressed.
      for (const game of LEVELS) {
        expect({ level, game, offered: html.includes(">" + game + "</button>") }).toEqual({
          level,
          game,
          offered: true,
        });
      }
      expect(html.match(/aria-pressed="true"/g) ?? []).toHaveLength(1);
      expect(html).toContain("data-level=\"" + level + "\"");
      // The pen: one toggle, level-uniform, with its pressed state.
      expect(html.match(/class="level-draw"/g) ?? []).toHaveLength(1);
      expect(html).toContain('aria-pressed="false"');
      // The group is still the control's whole chrome, plus the selection
      // tool's two CONCEPT-ONLY doors (PROVISIONAL, added 2026-11-16 per the
      // lead's brief: `select` beside the pen and the `language games` list's
      // door). They are offered at concept only — a language game is the
      // concept map's content — so the dynamics and ground rows are unchanged.
      // Story 15.10 adds one level-uniform verb: settings.
      expect(html.match(/<button/g) ?? []).toHaveLength(
        LEVELS.length + 1 + 1 + (level === "concept" ? 2 : 0) +
          (level === "dynamics" ? 1 : 0),
      );
    }
  });

  test("every hiding point is written, gated by its flag, and carries the comment", () => {
    // The gates: each door's markup sits behind its own flag's negation.
    for (const gate of [
      "{offered(PULL_DOOR_HIDDEN) && <PullDoor onOpen={onAskPull} />}",
      "{offered(VEIL_DOOR_HIDDEN) && (",
      "{offered(EDIT_SET_DOOR_HIDDEN) && (",
      "{offered(COIN_LOOP_DOOR_HIDDEN) && (",
      "{offered(ASK_DOOR_HIDDEN) && (",
      "{offered(SCENARIO_CHOOSER_HIDDEN) && (",
      "scenarios.length > 0 && offered(COMPARE_DOOR_HIDDEN)",
    ]) {
      expect({ gate, written: CONTROL.includes(gate) }).toEqual({
        gate,
        written: true,
      });
    }
    // The markup and the props are all still here (the components' own tests
    // pin what they do); this is the control's promise that they stay written.
    for (const written of [
      "<PullDoor onOpen={onAskPull} />",
      "<ScenarioChooser",
      "onClick={onEditPlayingSet}",
      "onClick={onCoinLoop}",
      "onClick={onDrawVeil}",
      "onClick={onAsk}",
      "onClick={onCompare}",
    ]) {
      expect({ written, found: CONTROL.includes(written) }).toEqual({
        written,
        found: true,
      });
    }
    // The sweep's marker, once per hiding point (seven doors).
    const marked = CONTROL.split(DEPRECATION).length - 1;
    expect(marked).toBeGreaterThanOrEqual(HIDDEN_MARKS.length);
    expect(CONTROL).toContain("delete in the deprecated sweep");
  });

  test("flipping a flag back restores its door (the pull ask, representative)", () => {
    // The gate is the flag alone: the seam the JSX calls turns the door on when
    // the flag is false, so no component edit is needed to restore it …
    expect(offered(PULL_DOOR_HIDDEN)).toBe(false);
    expect(offered(false)).toBe(true);
    expect(CONTROL).toContain(
      "{offered(PULL_DOOR_HIDDEN) && <PullDoor onOpen={onAskPull} />}",
    );
    // … and the handler is still threaded from the app, so the restored door
    // works: the app's own ask path, unchanged.
    expect(APP_SOURCE).toContain("onAskPull={openPullAsk}");
    // The door itself still renders its one quiet button.
    const door = renderToStaticMarkup(createElement(PullDoor, { onOpen: noop }));
    expect(door.match(/<button/g) ?? []).toHaveLength(1);
    expect(door).toContain('class="pull-door"');
  });

  test("the machinery behind the doors is still alive (nothing was deleted)", () => {
    // The hidden surfaces still render when something hands them the data: the
    // chooser lists "the map" and the branch it is given.
    const chooser = renderToStaticMarkup(
      createElement(ScenarioChooser, {
        scenarios: [{ slug: "evening", name: "evening" }],
        active: "evening",
        onChoose: noop,
        onBranch: noop,
        onRetire: noop,
      }),
    );
    expect(chooser).toContain('class="scenario-chooser"');
    expect(chooser).toContain("the map");
    expect(chooser).toContain("evening");
    // The app's records and callbacks behind every hidden door are untouched:
    // the arms, the selector, the path, the ask, the branch switch, the read.
    for (const kept of [
      "const beginVeil = useCallback(",
      "const beginLoop = useCallback(",
      "const openSelector = useCallback(",
      "const openGhostPanel = useCallback(",
      "const openComparison = useCallback(",
      "const chooseScenario = useCallback(",
      "const openPullAsk = useCallback(",
    ]) {
      expect({ kept, found: APP_SOURCE.includes(kept) }).toEqual({
        kept,
        found: true,
      });
    }
  });

  test("the negative space: no count, score, streak, heat or progress in the chrome", () => {
    const FORBIDDEN =
      /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|queue|backlog|total|points)\b/i;
    for (const level of LEVELS) {
      const html = render(level);
      // The rendered chrome only: class names and attributes included, so a
      // lurking badge would be caught wherever it tried to live.
      expect({ level, found: html.match(FORBIDDEN)?.[0] ?? null }).toEqual({
        level,
        found: null,
      });
    }
    // And nothing in the doors' own wording announces or ranks.
    expect(CONTROL).not.toMatch(/streak|\bscore\b|\bheat\b|\bprogress\b/i);
  });
});
