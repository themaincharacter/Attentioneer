import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  NOTICE_FAMILY_GAME,
  describeAssumptionTarget,
  describeMarkTarget,
  noticeGame,
  noticeGroups,
  noticeVisibleIn,
  walkStepNote,
  walkStepPair,
  walkWordGapText,
  type NoticeFamily,
} from "../src/canvas/notices";
import type { WalkStep } from "../src/map/loopRead";
import { LEVELS, type Level } from "../src/workspace/level";

/**
 * Epic 6 story 3's notices strip and person-facing text, automated at the pure
 * layer:
 *
 *   - the strip is BAND-SCOPED: every record family belongs to its game (marks
 *     to every game; links, the playing set, loops and assumptions to dynamics;
 *     pointers to ground), and the strip renders only the running game's group
 *     plus the shared "every game" one. It is no longer the unbanded aggregator.
 *   - the strip's group heading names its game;
 *   - NAMES, NOT SLUGS: mark/assumption descriptions and the walk's sentences
 *     resolve the record slug to the person's coined name. A genuinely gone
 *     slug falls back to itself (the record is the only name left).
 */

const FAMILIES: NoticeFamily[] = [
  "marks",
  "links",
  "model",
  "loops",
  "assumptions",
  "pointers",
];

const names = new Map([
  ["rain", "Rain"],
  ["soil", "Soil"],
  ["mulch", "Mulch"],
  ["cycle", "The Cycle"],
]);
const nameOf = (slug: string): string => names.get(slug) ?? slug;

describe("the notices strip is band-scoped", () => {
  test("each family belongs to its game (RENDER_MAP's partition)", () => {
    expect(noticeGame("marks")).toBe("all");
    expect(noticeGame("links")).toBe("dynamics");
    expect(noticeGame("model")).toBe("dynamics");
    expect(noticeGame("loops")).toBe("dynamics");
    expect(noticeGame("assumptions")).toBe("dynamics");
    expect(noticeGame("pointers")).toBe("ground");
    expect(NOTICE_FAMILY_GAME).toEqual({
      marks: "all",
      links: "dynamics",
      model: "dynamics",
      loops: "dynamics",
      assumptions: "dynamics",
      pointers: "ground",
    });
    // Every family is classified, so none can slip back into an aggregator.
    expect(Object.keys(NOTICE_FAMILY_GAME).sort()).toEqual([...FAMILIES].sort());
  });

  test("a family renders only in its game (marks in every game)", () => {
    for (const family of FAMILIES) {
      for (const level of LEVELS) {
        expect(noticeVisibleIn(family, level)).toBe(
          noticeGame(family) === "all" || noticeGame(family) === level,
        );
      }
    }
    // The dynamics records never appear at concept or ground.
    for (const family of ["links", "model", "loops", "assumptions"] as const) {
      expect(noticeVisibleIn(family, "concept")).toBe(false);
      expect(noticeVisibleIn(family, "ground")).toBe(false);
    }
    // The reach never appears at concept or dynamics.
    expect(noticeVisibleIn("pointers", "concept")).toBe(false);
    expect(noticeVisibleIn("pointers", "dynamics")).toBe(false);
    expect(noticeVisibleIn("pointers", "ground")).toBe(true);
  });

  test("concept shows the shared group only; no other game's notices", () => {
    const groups = noticeGroups("concept");
    expect(groups).toEqual([
      { game: "all", label: "every game", families: ["marks"] },
    ]);
    const families = groups.flatMap((group) => group.families);
    for (const own of ["links", "model", "loops", "assumptions", "pointers"]) {
      expect(families).not.toContain(own as NoticeFamily);
    }
  });

  test("dynamics shows the shared group plus dynamics' own, never ground's", () => {
    const groups = noticeGroups("dynamics");
    expect(groups.map((group) => group.label)).toEqual([
      "every game",
      "dynamics",
    ]);
    expect(groups[0].families).toEqual(["marks"]);
    expect(groups[1].game).toBe("dynamics");
    expect(groups[1].families).toEqual([
      "links",
      "model",
      "loops",
      "assumptions",
    ]);
    const families = groups.flatMap((group) => group.families);
    expect(families).not.toContain("pointers");
    expect(families).not.toContain("concept");
  });

  test("ground shows the shared group plus the reach, never dynamics' own", () => {
    const groups = noticeGroups("ground");
    expect(groups.map((group) => group.label)).toEqual([
      "every game",
      "ground",
    ]);
    expect(groups[1].families).toEqual(["pointers"]);
    const families = groups.flatMap((group) => group.families);
    for (const own of ["links", "model", "loops", "assumptions"]) {
      expect(families).not.toContain(own as NoticeFamily);
    }
  });

  test("a game's group is never a group of another game", () => {
    for (const level of LEVELS) {
      const groups = noticeGroups(level);
      expect(groups[0].game).toBe("all");
      const own = groups.filter((group) => group.game !== "all");
      // Concept owns no record family; the others own exactly their game.
      expect(own.map((group) => group.game)).toEqual(
        level === "concept" ? [] : [level],
      );
      for (const group of own) {
        expect(group.label).toBe(level);
      }
    }
  });
});

describe("the strip speaks NAMES, not the records' slugs", () => {
  test("a mark's target reads as the coined word", () => {
    expect(describeMarkTarget({ type: "word", slug: "rain" }, nameOf)).toBe(
      "“Rain”",
    );
    expect(
      describeMarkTarget(
        { type: "wire", from: "rain", to: "soil", word: "soaks" },
        nameOf,
      ),
    ).toBe("the wire Rain → Soil · “soaks”");
    expect(
      describeMarkTarget({ type: "link", from: "rain", to: "soil" }, nameOf),
    ).toBe("the link Rain → Soil");
    expect(
      describeMarkTarget(
        { type: "pointer", on: "rain", form: "url", value: "https://x" },
        nameOf,
      ),
    ).toBe("the reach Rain · url “https://x”");
    expect(describeMarkTarget({ type: "spot", x: 3, y: 4 }, nameOf)).toBe(
      "a bare spot",
    );
  });

  test("an assumption's target reads as the coined word or loop", () => {
    expect(
      describeAssumptionTarget({ type: "word", slug: "mulch" }, nameOf),
    ).toBe("“Mulch”");
    expect(
      describeAssumptionTarget({ type: "link", from: "rain", to: "soil" }, nameOf),
    ).toBe("the link Rain → Soil");
    expect(
      describeAssumptionTarget({ type: "loop", slug: "cycle" }, nameOf),
    ).toBe("the loop “The Cycle”");
    // The slug never leaks when the record still has a name.
    for (const text of [
      describeMarkTarget({ type: "word", slug: "rain" }, nameOf),
      describeAssumptionTarget({ type: "word", slug: "mulch" }, nameOf),
      describeAssumptionTarget({ type: "loop", slug: "cycle" }, nameOf),
    ]) {
      expect(text).not.toContain("rain");
      expect(text).not.toContain("mulch");
      expect(text).not.toContain("cycle");
    }
  });

  test("a gone slug falls back to itself (the record is the only name left)", () => {
    expect(describeMarkTarget({ type: "word", slug: "ghost" }, nameOf)).toBe(
      "“ghost”",
    );
    expect(
      describeAssumptionTarget({ type: "loop", slug: "gone-loop" }, nameOf),
    ).toBe("the loop “gone-loop”");
    expect(
      describeMarkTarget(
        { type: "link", from: "ghost", to: "rain" },
        nameOf,
      ),
    ).toBe("the link ghost → Rain");
  });
});

describe("the walk's sentences use names too (the pure read keeps slugs)", () => {
  const sign: WalkStep = { kind: "sign", from: "rain", to: "soil", sign: "+" };
  const marked: WalkStep = {
    kind: "gap",
    from: "rain",
    to: "soil",
    gap: { kind: "marked-link" },
  };
  const reverse: WalkStep = {
    kind: "gap",
    from: "rain",
    to: "soil",
    gap: { kind: "missing-link", reverse: true },
  };
  const missing: WalkStep = {
    kind: "gap",
    from: "rain",
    to: "soil",
    gap: { kind: "missing-link", reverse: false },
  };

  test("a step's pair is spoken in names", () => {
    expect(walkStepPair(sign, nameOf)).toBe("Rain → Soil");
    expect(walkStepPair(reverse, nameOf)).toBe("Rain → Soil");
  });

  test("a step's note names the gap and the reverse direction", () => {
    expect(walkStepNote(sign, nameOf)).toBeNull();
    expect(walkStepNote(marked, nameOf)).toBe("sign unsettled");
    expect(walkStepNote(missing, nameOf)).toBe("missing link");
    expect(walkStepNote(reverse, nameOf)).toBe(
      "missing link — runs the other way: Soil → Rain exists",
    );
  });

  test("a path word's gap is spoken in names", () => {
    expect(walkWordGapText({ kind: "dangling", slug: "rain" }, nameOf)).toBe(
      "word “Rain” is not on the map",
    );
    expect(walkWordGapText({ kind: "out-of-play", slug: "soil" }, nameOf)).toBe(
      "“Soil” is outside the playing set",
    );
    // A dangling word has no name on the map: its record slug is the identity.
    expect(walkWordGapText({ kind: "dangling", slug: "ghost" }, nameOf)).toBe(
      "word “ghost” is not on the map",
    );
  });
});

describe("the wiring: one strip, one name resolver", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  test("the strip renders the running game's groups and a game heading", () => {
    expect(app).toContain("noticeGroups(level)");
    expect(app).toContain("className=\"mark-notice-game\"");
    expect(app).toContain("data-game={group.game}");
    expect(app).toContain("nameOf={nameOf}");
  });

  test("the strip, the walk and the chooser all get the resolver", () => {
    expect(app).toContain("level={level}");
    expect(app).toContain("nameOf={nameOf}");
    expect(app).toContain("<LoopWalk read={walkRead} nameOf={nameOf}");
    expect(app).toContain("name={nameOf(pointerPanel.on)}");
    expect(app).toContain("name={nameOf(peekAt.on)}");
    // The old slug-fed aria labels are gone.
    expect(app).not.toContain("slug={pointerPanel.on}");
    const outward = readFileSync(
      new URL("../src/canvas/OutwardWindow.tsx", import.meta.url),
      "utf8",
    );
    expect(outward).toContain("peekLabel(name, pointer.form)");
  });

  test("the walk component no longer interpolates raw slugs", () => {
    const walk = readFileSync(
      new URL("../src/canvas/LoopWalk.tsx", import.meta.url),
      "utf8",
    );
    expect(walk).toContain("walkWordGapText(gap, nameOf)");
    expect(walk).toContain("walkStepPair(step, nameOf)");
    expect(walk).not.toContain("gap.slug} is not on the map");
  });

  test("the CSS gives a group a heading and the strip keeps its quiet family", () => {
    const css = readFileSync(
      new URL("../src/canvas/canvas.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(".mark-notice-game {");
    expect(css).toContain(".mark-notice-group {");
    expect(css).toContain(".mark-notice {");
  });
});
