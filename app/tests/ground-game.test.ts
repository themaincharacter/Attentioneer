import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseYamlFields, workspaceYml } from "../src/lib/serialize";
import {
  creationKinds,
  offeredCreationKinds,
  type CreationKind,
} from "../src/canvas/gates";
import {
  DEFAULT_LEVEL,
  LEVEL_KEY,
  LEVELS,
  levelOf,
  levelOfText,
  RENDER_MAP,
  withLevel,
  type Level,
} from "../src/workspace/level";

/**
 * The ground game, automated (ADR-0016's amendment; Epic 5 story 1):
 * `workspace.yml`'s `level` gains the third value `ground` (absent or garbage
 * is still concept — tolerant read, documented and tested), the level control
 * names all three games, the render map keeps the honest partition (words,
 * distances, marks and the shelf in EVERY game; each game only ADDS its own
 * records), and the creation kinds are per game: word/lack at concept and
 * ground, plus assumption at dynamics.
 *
 * The look and the feel of the third name are the human check.
 */

describe("levelOf reads ground tolerantly; garbage stays concept", () => {
  test("ground is read quoted, unquoted, cased and padded", () => {
    expect(levelOf({ level: "ground" })).toBe("ground");
    expect(levelOf({ level: " Ground " })).toBe("ground");
    expect(levelOf({ level: "GROUND" })).toBe("ground");
    expect(levelOfText('level: "ground"\n')).toBe("ground");
    expect(levelOfText("level: ground\n")).toBe("ground");
    expect(levelOfText('level: "GROUND"\n')).toBe("ground");
  });

  test("absent, empty, numeric and unknown values are concept", () => {
    expect(levelOf({})).toBe("concept");
    expect(levelOf({ level: "" })).toBe("concept");
    expect(levelOf({ level: "   " })).toBe("concept");
    expect(levelOf({ level: 3 as unknown as string })).toBe("concept");
    for (const value of [
      "grounds",
      "grounding",
      "the ground",
      "stock-flow",
      "Dynamicss",
      "1",
    ]) {
      expect(levelOf({ level: value })).toBe("concept");
    }
    // The scaffold has no level key at all; opening it is concept.
    expect(levelOf(parseYamlFields(workspaceYml()))).toBe("concept");
    expect(levelOfText(null)).toBe("concept");
  });

  test("the three values round-trip through the canonical write", () => {
    for (const level of LEVELS) {
      const written = withLevel(workspaceYml(), level);
      expect(written).toContain('level: "' + level + '"');
      expect(levelOf(parseYamlFields(written))).toBe(level);
      expect(levelOfText(written)).toBe(level);
      // The fold and the format key are untouched, LF and one trailing newline.
      expect(written).toContain("format: attentioneer-workspace/1");
      expect(written.includes("\r")).toBe(false);
      expect(written.endsWith("\n")).toBe(true);
    }
  });

  test("a level line is rewritten in place for ground too", () => {
    const once = withLevel(workspaceYml(), "ground");
    expect(withLevel(once, "ground")).toBe(once);
    const back = withLevel(once, "dynamics");
    expect(back).toContain('level: "dynamics"');
    expect(back).not.toContain('level: "ground"');
    expect(withLevel('level: "concept"\nformat: "x"\n', "ground")).toBe(
      'level: "ground"\nformat: "x"\n',
    );
    expect(withLevel("", "ground")).toBe('level: "ground"\n');
  });
});

describe("the level control names three games (one source)", () => {
  test("LEVELS is the glossary's three words, in the control's order", () => {
    expect(LEVELS).toEqual(["concept", "dynamics", "ground"]);
    expect(DEFAULT_LEVEL).toBe("concept");
    expect(LEVEL_KEY).toBe("level");
    const levels: readonly Level[] = LEVELS;
    expect(new Set(levels).size).toBe(3);
  });

  test("the control loops over LEVELS, so a fourth game cannot be forgotten", () => {
    const source = readFileSync(
      new URL("../src/canvas/LevelControl.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("LEVELS.map(");
    // Its dynamics-only add-ons stay scoped to dynamics.
    expect(source).toContain('level === "dynamics"');
    for (const level of LEVELS) {
      expect(source).toContain(level + ": ");
    }
  });
});

describe("the render map keeps the honest partition", () => {
  test("every game renders words, distances, marks and the shelf", () => {
    expect(RENDER_MAP.all).toEqual(["words", "distances", "marks", "shelf"]);
    for (const game of ["concept", "dynamics", "ground"] as const) {
      const rendered =
        game === "concept"
          ? [...RENDER_MAP.all]
          : [...RENDER_MAP.all, ...RENDER_MAP[game]];
      for (const record of RENDER_MAP.all) {
        expect(rendered).toContain(record);
      }
    }
  });

  test("each game only ADDS its own records", () => {
    expect(RENDER_MAP.dynamics).toEqual([
      "links",
      "loops",
      "assumptions",
      "model",
    ]);
    expect(RENDER_MAP.ground).toEqual(["pointers"]);
    // Ground adds the reach and nothing from dynamics.
    for (const record of RENDER_MAP.dynamics) {
      expect(RENDER_MAP.ground).not.toContain(record);
    }
    // Dynamics adds no reach.
    expect(RENDER_MAP.dynamics).not.toContain("pointers");
    // The added records never duplicate the common ones.
    for (const own of [...RENDER_MAP.dynamics, ...RENDER_MAP.ground]) {
      expect(RENDER_MAP.all).not.toContain(own);
    }
  });
});

describe("creation kinds are per game (an ADD, never a take-away)", () => {
  test("concept and ground offer exactly word and lack", () => {
    for (const level of ["concept", "ground"] as const) {
      expect(creationKinds(level)).toEqual(["word", "lack"]);
      expect(creationKinds(level)).not.toContain("assumption");
      expect(creationKinds(level)).toHaveLength(2);
    }
  });

  // DEPRECATED (hidden 2026-11-16 per user review): the RING MENU offers only
  // the word option now. The grammar above is the record machinery's (the
  // ghost packet's card, the empty-space records' own tests) and stays; the
  // OFFER is what the person sees, and it is the word alone in every game.
  test("the ring menu offers only the word (hidden 2026-11-16)", () => {
    for (const level of LEVELS) {
      expect(offeredCreationKinds(level)).toEqual(["word"]);
      expect(offeredCreationKinds(level)).not.toContain("lack");
      expect(offeredCreationKinds(level)).not.toContain("assumption");
      // The machinery's full list is untouched, so a sweep can restore it.
      expect(creationKinds(level).length).toBeGreaterThanOrEqual(2);
    }
  });

  test("dynamics keeps its third kind; ground does not grow it", () => {
    const dynamics = creationKinds("dynamics");
    expect(dynamics).toEqual(["word", "lack", "assumption"]);
    expect(dynamics.slice(0, 2)).toEqual(creationKinds("ground"));
    const kinds: readonly CreationKind[] = dynamics;
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
