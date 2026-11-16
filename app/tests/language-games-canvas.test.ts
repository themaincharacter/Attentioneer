import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LevelControl } from "../src/canvas/LevelControl";
import { LanguageGameBar } from "../src/canvas/LanguageGameBar";
import { LanguageGameFill } from "../src/canvas/LanguageGameFill";
import { LanguageGamesPanel } from "../src/canvas/LanguageGamesPanel";
import {
  CONTENT_CLASSES,
  CONTENT_SELECTOR,
  WORD_CONTROL_CLASSES,
} from "../src/canvas/gates";
import {
  GAME_CANCEL_LABEL,
  GAME_NAME_LABEL,
  GAME_NAME_PLACEHOLDER,
  GAME_POPUP_TITLE,
  GAME_PROBLEM_TEXT,
  GAME_REMOVE_LABEL,
  GAME_SUBMIT_LABEL,
  GAMES_CLOSE_LABEL,
  GAMES_EMPTY_LINE,
  GAMES_PANEL_LABEL,
  GAMES_PANEL_TITLE,
  GAME_FILL_OPACITY,
  GAME_FOCUS_OPACITY,
  SELECT_BAR_HINT,
  SELECT_BAR_LABEL,
  SHAPE_MODE_LABELS,
} from "../src/canvas/languageGameRules";
import { LEVELS } from "../src/workspace/level";

/**
 * THE SELECTION TOOL at the UI seam, automated (PROVISIONAL, added 2026-11-16
 * per the lead's brief).
 *
 * The pure rules live in tests/language-game-rules.test.ts and the record in
 * tests/language-games-record.test.ts. This file pins the WIRING, the repo's
 * source-scan idiom:
 *
 *   - the tool and the list's door are on the CONCEPT map only (the level
 *     control's rendered chrome, and the app's gates);
 *   - the plane's `select` arm owns the pointer through its own capture
 *     surface, and the popup keeps the gate mode armed while it asks;
 *   - CANCEL writes nothing (the draft is state, not a record) and SUBMIT
 *     writes exactly one line through the map's one writer;
 *   - the list's pick centres the map and brings the game forward; its
 *     trash-bin deletes by name;
 *   - the fills stack above the paper and below the words and the ink;
 *   - the negative space: no count, score, streak, heat or progress vocabulary
 *     in any new person-facing string.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const APP = source("App.tsx");
const CONTROL = source("canvas/LevelControl.tsx");
const PLANE = source("canvas/CanvasPlane.tsx");
const USE_MAP = source("canvas/useMap.ts");
const BAR = source("canvas/LanguageGameBar.tsx");
const POPUP = source("canvas/LanguageGamePopup.tsx");
const PANEL = source("canvas/LanguageGamesPanel.tsx");
const RULES = source("canvas/languageGameRules.ts");
const CSS = source("canvas/canvas.css");

const noop = () => {};

/** The control's whole prop set, so the two new doors can be offered. */
function control(level: (typeof LEVELS)[number], over: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(LevelControl, {
      level,
      onJump: noop,
      onEditPlayingSet: noop,
      onCoinLoop: noop,
      onDrawVeil: noop,
      onDraw: noop,
      drawArmed: false,
      onSelect: noop,
      selectArmed: false,
      onOpenGames: noop,
      gamesOpen: false,
      scenarios: [],
      activeScenario: null,
      onChooseScenario: noop,
      onBranchScenario: noop,
      onRetireScenario: noop,
      onCompare: noop,
      onAsk: noop,
      onAskPull: noop,
      ...over,
    }),
  );
}

/** A CSS rule's body, by its exact selector text (the epic13 idiom). */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(selector + " {");
  expect(start).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

/* ----------------------------------------------------------------------- *
 * 1. The tool's doors: concept only, beside the pen.
 * ----------------------------------------------------------------------- */

describe("the concept map's level control grows two quiet doors", () => {
  test("the rendered chrome offers select and language games at CONCEPT only", () => {
    const concept = control("concept");
    expect(concept).toContain('class="level-select"');
    expect(concept).toContain(">select</button>");
    expect(concept).toContain('class="level-games"');
    expect(concept).toContain(">language games</button>");
    for (const level of ["dynamics", "ground"] as const) {
      const html = control(level);
      expect({ level, select: html.includes("level-select") }).toEqual({
        level,
        select: false,
      });
      expect({ level, list: html.includes("level-games") }).toEqual({
        level,
        list: false,
      });
      expect({ level, word: html.includes(">select</button>") }).toEqual({
        level,
        word: false,
      });
    }
  });

  test("the doors sit beside the pen and behind the separate-maps rule", () => {
    // The tool is placed beside `draw`, as asked; the list's door follows it.
    const draw = CONTROL.indexOf('className={"level-draw"');
    const select = CONTROL.indexOf('className={"level-select"');
    const games = CONTROL.indexOf('className={"level-games"');
    expect(draw).toBeGreaterThan(-1);
    expect(select).toBeGreaterThan(draw);
    expect(games).toBeGreaterThan(select);
    // The level gate is the ONE separate-maps reading.
    expect(CONTROL).toContain("{showsMapContent(level) && (");
    expect(CONTROL).toContain("onClick={onSelect}");
    expect(CONTROL).toContain("onClick={onOpenGames}");
  });

  test("the app threads the tool's state and the list's state into the control", () => {
    expect(APP).toContain("onSelect={toggleSelect}");
    expect(APP).toContain("selectArmed={selectArmed}");
    expect(APP).toContain("onOpenGames={toggleGames}");
    expect(APP).toContain("gamesOpen={gamesOpen}");
  });
});

/* ----------------------------------------------------------------------- *
 * 2. The arm: the plane's capture surface, and the popup's armed pause.
 * ----------------------------------------------------------------------- */

describe("the plane's select arm owns the pointer", () => {
  test("the capture surface exists only while armed, and reports the shape", () => {
    expect(PLANE).toContain("{selectArmed && (");
    expect(PLANE).toContain('className="select-surface"');
    expect(PLANE).toContain("ref={selectSurfaceRef}");
    // The samples are screen-space; the geometry is world-space.
    expect(PLANE).toContain("SELECT_STEP_PX");
    expect(PLANE).toContain("shapeFromDrag(mode, start, end, path)");
    expect(PLANE).toContain("onSelectShapeRef.current?.(shape)");
    // An arm that ended mid-drag writes nothing.
    expect(PLANE).toContain("if (!selectArmedRef.current) return;");
    // The in-flight shape previews in world space (what the release hands over).
    expect(PLANE).toContain("{selectDraft && (");
    expect(PLANE).toContain("<LanguageGameFill");
    expect(PLANE).toContain("draft");
    // The plane promises a crosshair, never a grab, while the tool is armed.
    expect(PLANE).toContain('selectArmed ? " select-armed" : ""');
    expect(CSS).toContain(".plane.select-armed");
  });

  test("the app passes the arm, the shape mode and the completion", () => {
    expect(APP).toContain("selectArmed={selectArmed && gameDraft === null}");
    expect(APP).toContain("selectShape={selectShape}");
    expect(APP).toContain("onSelectShape={captureLanguageGame}");
    // The gate mode stands while the tool is armed OR the popup is asking.
    expect(APP).toContain("selectArmed || gameDraft !== null");
    expect(APP).toContain('? "select"');
    // The strip is the tool's quiet control, and the mode it offers.
    expect(APP).toContain(
      "<LanguageGameBar shape={selectShape} onShape={chooseGameShape} />",
    );
    expect(APP).toContain("{selectArmed && (");
    // Esc ends the tool, but the card owns its own escape (cancel, stay armed).
    expect(APP).toContain("if (gameDraft !== null) return;");
  });

  test("the strip offers the three shapes, the default pressed", () => {
    const html = renderToStaticMarkup(
      createElement(LanguageGameBar, {
        shape: "freeform" as const,
        onShape: noop,
      }),
    );
    expect(html).toContain('class="language-game-bar"');
    expect(html).toContain(">freeform</button>");
    expect(html).toContain(">circle</button>");
    expect(html).toContain(">rectangle</button>");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(">select</span>");
    expect(html.match(/<button/g) ?? []).toHaveLength(3);
    expect(SHAPE_MODE_LABELS.rect).toBe("rectangle");
  });
});

/* ----------------------------------------------------------------------- *
 * 3. Cancel writes nothing; submit writes exactly one line.
 * ----------------------------------------------------------------------- */

describe("the draft is state until the one write", () => {
  test("cancel drops the draft and touches nothing else", () => {
    const start = APP.indexOf("const cancelLanguageGame = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = APP.indexOf("}, []);", start);
    const body = APP.slice(start, end);
    expect(body).toContain("setGameDraft(null);");
    for (const forbidden of [
      "createLanguageGame",
      "addLanguageGame",
      "persistLanguageGames",
      "saveLanguageGames",
      "removeLanguageGame",
    ]) {
      expect({ forbidden, found: body.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
    // The popup's cancel is the same one callback; it looks nothing up.
    expect(POPUP).toContain("onCancel();");
    expect(POPUP).not.toContain("createLanguageGame");
  });

  test("a completed selection is a draft: membership + an injected pastel, no write", () => {
    const start = APP.indexOf("const captureLanguageGame = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = APP.indexOf("\n  const ", start);
    expect(end).toBeGreaterThan(start);
    const body = APP.slice(start, end);
    expect(body).toContain("gameMembership(shape, selectorWords, distances)");
    expect(body).toContain("pickPastel(Math.random)");
    expect(body).toContain("hasWords: members.words.length > 0");
    expect(body).toContain("setGameDraft({");
    expect(body).not.toContain("createLanguageGame");
  });

  test("submit asks the rules, then writes ONE line through the one writer", () => {
    const start = APP.indexOf("const submitLanguageGame = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = APP.indexOf("\n  const ", start);
    expect(end).toBeGreaterThan(start);
    const body = APP.slice(start, end);
    const ask = body.indexOf("submitProblem(");
    const guard = body.indexOf("if (problem !== null) return;");
    const write = body.indexOf(
      "createLanguageGame(name.trim(), draft.color, draft.shape);",
    );
    const clear = body.indexOf("setGameDraft(null);");
    expect(ask).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(ask);
    expect(write).toBeGreaterThan(guard);
    expect(clear).toBeGreaterThan(write);
    // Exactly one write call in the body.
    expect(body.match(/createLanguageGame\(/g) ?? []).toHaveLength(1);
    // The record's own append is one line, and the duplicate guard refuses.
    expect(USE_MAP).toContain("addLanguageGame(languageGamesRef.current, {");
    expect(USE_MAP).toContain("if (next === null) return;");
    expect(USE_MAP).toContain("persistLanguageGames(next);");
  });

  test("the popup's own commit only calls back when the rules are met", () => {
    const start = POPUP.indexOf("function commit()");
    expect(start).toBeGreaterThan(-1);
    const end = POPUP.indexOf("function cancel()", start);
    const body = POPUP.slice(start, end);
    expect(body).toContain("submitProblem(name, existingNames, hasWords)");
    expect(body).toContain("if (next !== null) {");
    expect(body).toContain("onSubmit(name.trim());");
    // No write of its own: the card holds a name, never a record.
    expect(POPUP).not.toContain("saveLanguageGames");
    expect(POPUP).not.toContain("createLanguageGame");
  });

  test("the map's writer persists one canonical document, malformed lines riding", () => {
    expect(USE_MAP).toContain("saveLanguageGames(workspacePath, next, malformedLines)");
    expect(USE_MAP).toContain("loadLanguageGames(workspacePath),");
    expect(USE_MAP).toContain("malformedLanguageGames,");
  });
});

/* ----------------------------------------------------------------------- *
 * 4. The modal: pick (bring forward + centre), delete, close.
 * ----------------------------------------------------------------------- */

describe("ALL LANGUAGE GAMES: the list's three paths", () => {
  test("the panel lists every game as a swatch, a name and a trash bin", () => {
    const html = renderToStaticMarkup(
      createElement(LanguageGamesPanel, {
        games: [
          {
            name: "rain",
            color: "#cfe0d6",
            shape: { kind: "rect", x: 0, y: 0, w: 10, h: 10 },
            extra: {},
          },
          {
            name: "soil",
            color: "not-a-colour",
            shape: { kind: "rect", x: 0, y: 0, w: 10, h: 10 },
            extra: {},
          },
        ],
        focused: "rain",
        onPick: noop,
        onRemove: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain(">all language games<");
    expect(html).toContain(">rain<");
    expect(html).toContain(">soil<");
    // The swatch is the game's ink; an unpaintable hand edit falls back.
    expect(html).toContain("background:#cfe0d6");
    expect(html).toContain("background:#dce4d7");
    // The row in force is marked, and each row carries the quiet trash bin.
    expect(html).toContain("focused");
    expect(html.match(/language-game-remove/g) ?? []).toHaveLength(2);
    expect(html.match(/language-game-trash/g) ?? []).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
  });

  test("an empty list says so plainly (no number, no nudge)", () => {
    const html = renderToStaticMarkup(
      createElement(LanguageGamesPanel, {
        games: [],
        focused: null,
        onPick: noop,
        onRemove: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain(GAMES_EMPTY_LINE);
    expect(html).not.toContain("language-game-row");
  });

  test("picking brings the game forward and centres the map on its shape", () => {
    const start = APP.indexOf("const pickLanguageGame = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = APP.indexOf("\n  const ", start);
    expect(end).toBeGreaterThan(start);
    const body = APP.slice(start, end);
    expect(body).toContain("setFocusedGame(game.name);");
    expect(body).toContain("shapeCenter(game.shape)");
    expect(body).toContain('document.querySelector<HTMLDivElement>(".plane")');
    expect(body).toContain("intents.centerOn(");
    // The zoom is kept: a list pick is ordinary navigation.
    expect(body).toContain("camera.zoom");
    // The render reads the focus: the brought-forward fill is more opaque.
    expect(APP).toContain("focusedGame === game.name");
    expect(APP).toContain("? GAME_FOCUS_OPACITY");
    expect(APP).toContain(": GAME_FILL_OPACITY");
    expect(GAME_FOCUS_OPACITY).toBeGreaterThan(GAME_FILL_OPACITY);
  });

  test("the trash bin deletes by name, with no confirmation", () => {
    const start = APP.indexOf("const deleteLanguageGame = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = APP.indexOf("\n  const ", start);
    expect(end).toBeGreaterThan(start);
    const body = APP.slice(start, end);
    expect(body).toContain("removeLanguageGame(name);");
    expect(body).toContain("setFocusedGame((current) => (current === name ? null : current));");
    // The panel's row is the door: it hands the NAME to the app's delete.
    expect(PANEL).toContain("onClick={() => onRemove(game.name)}");
    expect(PANEL).toContain("aria-label={GAME_REMOVE_LABEL}");
    expect(PANEL).toContain('className="language-game-remove"');
    // No confirmation dialog anywhere in the feature.
    for (const file of [APP, PANEL, POPUP, RULES]) {
      expect(file).not.toContain("confirm(");
    }
  });

  test("the door opens and closes; a map switch closes the list", () => {
    const start = APP.indexOf("const toggleGames = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = APP.indexOf("  );", start);
    const body = APP.slice(start, end);
    expect(body.indexOf("cancelPendingGestures();")).toBeGreaterThan(-1);
    expect(body.indexOf("setGamesOpen(true);")).toBeGreaterThan(
      body.indexOf("cancelPendingGestures();"),
    );
    // The one switch path closes the list with every other transient.
    const cancel = APP.slice(
      APP.indexOf("const cancelPendingGestures = useCallback("),
    );
    expect(cancel.slice(0, 2200)).toContain("setGamesOpen(false);");
    // The panel is rendered on the concept map only.
    expect(APP).toContain("{gamesOpen && languageGamesLive(level) && (");
    expect(APP).toContain("<LanguageGamesPanel");
    expect(APP).toContain("onPick={pickLanguageGame}");
    expect(APP).toContain("onRemove={deleteLanguageGame}");
    expect(APP).toContain("onClose={closeGames}");
  });
});

/* ----------------------------------------------------------------------- *
 * 5. Rendering: world space, above paper, below words and ink.
 * ----------------------------------------------------------------------- */

describe("the fills are paper, under the map's names", () => {
  test("the layer is world space, takes no press, and sits at z-index 1", () => {
    const body = ruleBody(".language-game-fill");
    expect(body).toContain("position: absolute");
    expect(body).toContain("z-index: 1");
    expect(body).toContain("pointer-events: none");
    // The words (2) and the pen's ink (2) are above it; the paper is below.
    expect(ruleBody(".word")).toContain("z-index: 2");
    expect(ruleBody(".sketch-layer")).toContain("z-index: 2");
  });

  test("all three shapes render, and the draft wears a dashed edge", () => {
    const shapes = [
      { kind: "rect" as const, x: 1, y: 2, w: 3, h: 4 },
      {
        kind: "polygon" as const,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 2 },
          { x: 3, y: 0 },
        ],
      },
      { kind: "circle" as const, cx: 5, cy: 6, r: 7 },
    ];
    const html = shapes
      .map((shape) =>
        renderToStaticMarkup(
          createElement(LanguageGameFill, {
            shape,
            ink: "#cfe0d6",
            opacity: GAME_FILL_OPACITY,
          }),
        ),
      )
      .join("");
    expect(html).toContain("<rect");
    expect(html).toContain("<polygon");
    expect(html).toContain("<circle");
    expect(html).toContain('fill="#cfe0d6"');
    expect(html).toContain('fill-opacity="0.3"');
    expect(html).toContain('aria-hidden="true"');
    const draft = renderToStaticMarkup(
      createElement(LanguageGameFill, {
        shape: shapes[0],
        ink: "#cfe0d6",
        opacity: GAME_FILL_OPACITY,
        draft: true,
      }),
    );
    expect(draft).toContain("language-game-draft");
    expect(draft).toContain("stroke-dasharray");
  });

  test("the app paints every game and the draft behind the words", () => {
    expect(APP).toContain("languageGamesLive(level) &&");
    expect(APP).toContain("languageGames.map((game, index) => (");
    expect(APP).toContain("ink={gameInk(game.color)}");
    expect(APP).toContain("opacity={GAME_DRAFT_OPACITY}");
    // The draft fill renders before the words in the plane's own order.
    const draft = APP.indexOf("opacity={GAME_DRAFT_OPACITY}");
    const words = APP.indexOf("{mapContent && shownRefs.map((word) => (");
    expect(draft).toBeGreaterThan(-1);
    expect(words).toBeGreaterThan(-1);
    // Overlapping games are allowed: every game renders, no exclusivity test.
    expect(APP).not.toContain("games.filter((game) => !overlap");
  });
});

/* ----------------------------------------------------------------------- *
 * 6. The gate lists, and the notices.
 * ----------------------------------------------------------------------- */

describe("the popup and the fills are content; the malformed lines are surfaced", () => {
  test("every in-plane class joins both gate lists", () => {
    for (const name of [
      "language-game-fill",
      "language-game-draft",
      "language-game-popup",
      "language-game-name",
      "language-game-problem",
      "language-game-submit",
      "language-game-cancel",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
      expect(CONTENT_SELECTOR).toContain("." + name);
    }
  });

  test("the popup is inside the plane and says its one title", () => {
    expect(APP).toContain("<LanguageGamePopup");
    expect(APP).toContain("anchor={shapeAnchor(gameDraft.shape)}");
    expect(APP).toContain(
      "existingNames={languageGames.map((game) => game.name)}",
    );
    expect(APP).toContain("hasWords={gameDraft.hasWords}");
    expect(APP).toContain("onSubmit={submitLanguageGame}");
    expect(APP).toContain("onCancel={cancelLanguageGame}");
    expect(POPUP).toContain("GAME_POPUP_TITLE");
    expect(GAME_POPUP_TITLE).toBe("language game");
    expect(POPUP).toContain("counterScale(camera.zoom)");
  });

  test("unreadable lines reach the notices strip", () => {
    expect(APP).toContain("malformedGames={malformedLanguageGames}");
    expect(APP).toContain("unreadable line in map/language-games.jsonl");
  });
});

/* ----------------------------------------------------------------------- *
 * 7. The negative space.
 * ----------------------------------------------------------------------- */

describe("the new words announce and rank nothing", () => {
  const FORBIDDEN =
    /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|queue|backlog|total|points)\b/i;

  test("every person-facing string is quiet", () => {
    const seen = [
      GAME_POPUP_TITLE,
      GAMES_PANEL_TITLE,
      GAMES_PANEL_LABEL,
      GAMES_EMPTY_LINE,
      GAME_NAME_PLACEHOLDER,
      GAME_NAME_LABEL,
      GAME_SUBMIT_LABEL,
      GAME_CANCEL_LABEL,
      GAME_REMOVE_LABEL,
      GAMES_CLOSE_LABEL,
      SELECT_BAR_LABEL,
      SELECT_BAR_HINT,
      ...Object.values(SHAPE_MODE_LABELS),
      ...Object.values(GAME_PROBLEM_TEXT),
    ];
    expect(seen.length).toBeGreaterThan(10);
    for (const text of seen) {
      expect({ text, found: text.match(FORBIDDEN)?.[0] ?? null }).toEqual({
        text,
        found: null,
      });
    }
  });

  test("the new components' static attributes are quiet too", () => {
    for (const file of [BAR, POPUP, PANEL]) {
      const attributes = [
        ...file.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g),
      ].map((match) => match[1]);
      for (const text of attributes) {
        expect({ text, found: text.match(FORBIDDEN)?.[0] ?? null }).toEqual({
          text,
          found: null,
        });
      }
      // The class names are structural, never a claim: no badge/dot/counter
      // class exists to mount.
      expect(file).not.toMatch(
        /className="[^"]*(badge|counter|cue|streak|heat|progress)/i,
      );
    }
  });

  test("the strip's hint says what the gesture does and nothing more", () => {
    expect(SELECT_BAR_HINT).toContain("drag a shape");
    expect(SELECT_BAR_HINT).toContain("esc");
    expect(SELECT_BAR_HINT).not.toMatch(/\d/);
  });
});
