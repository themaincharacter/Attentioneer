import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PILL_MAX_COUNTER_SCALE,
  PILL_MIN_COUNTER_SCALE,
  pillCounterScale,
} from "../src/canvas/CardNamePill";
import { GroundLayer } from "../src/canvas/GroundLayer";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { renameGroundRecords } from "../src/canvas/useGround";
import {
  UNTITLED_DISPLAY,
  groundDisplayName,
  groundNameForWrite,
  GROUND_UNTITLED_NAME,
  parseGround,
  saveGround,
  withGroundRenamed,
  type GroundIo,
  type GroundReference,
} from "../src/map/ground";

/**
 * STORY 16.21 — THE NAME FLOATS ABOVE THE CARD.
 *
 * The story's check is human ("zoom out to 25%: the names are still readable
 * above their cards; drag a card by its name; double-click the name and
 * Escape/Enter do what they say; an unnamed card reads Untitled reference") and
 * needs a window. This file pins what can be pinned without one:
 *
 *   - the counter-scale is PURE and CLAMPED (scale = clamp(1/zoom, 1, 4)), so
 *     25% is the last zoom at which it grows and a deeper zoom-out shrinks the
 *     pills with the map instead of stacking them;
 *   - the pill RENDERS the name (and the quiet "no name yet" for none), while
 *     the card body renders it nowhere: the pill holds the only .ground-name;
 *   - THERE IS ONE DRAG RULE: the pill owns no pointer handling at all and the
 *     card's existing listener is the only caller of groundDrag.ts, whose
 *     threshold stays the module's own constant (never restated);
 *   - the rename is ONE write through the existing ground family writer: the
 *     name field changes, the slug / point / readings / malformed lines do not,
 *     and an empty field stores the untitled sentence so the line stays legal.
 */

const APP_DIR = new URL("..", import.meta.url).pathname;
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const PILL = source("canvas/CardNamePill.tsx");
const LAYER = source("canvas/GroundLayer.tsx");
const DRAG = source("canvas/groundDrag.ts");
const CSS = source("canvas/canvas.css");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-name-pill-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

const io: GroundIo = {
  readTextFile: async (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path, content) => {
    writeFileSync(path, content, "utf8");
  },
};

/** The rename's bridge: the real writer, handed the test's own file IO. */
const renameIo = {
  saveGround: (
    workspacePath: string,
    references: readonly GroundReference[],
    malformed: readonly string[],
  ) => saveGround(workspacePath, references, malformed, io),
};

const inertVerbs = {
  onMove: async () => ({ ok: true as const }),
  onRefresh: async () => ({ ok: true as const }),
  onRepoint: async () => ({ ok: true as const }),
  onRemove: async () => ({ ok: true as const }),
};

function reference(name: string, on = "rain-gauge"): GroundReference {
  return { on, name, x: 40, y: 80 };
}

function render(
  names: readonly GroundReference[],
  zoom = 1,
): string {
  return renderToStaticMarkup(
    createElement(GroundLayer, {
      references: names,
      readings: [],
      texts: {},
      states: Object.fromEntries(names.map((entry) => [entry.on, "unread"])),
      zoom,
      ...inertVerbs,
    }) as never,
  );
}

describe("the counter-scale is pure and clamped", () => {
  test("at 100% nothing is counter-scaled; at 25% it is exactly 4x", () => {
    expect(pillCounterScale(1)).toBe(1);
    expect(pillCounterScale(2)).toBe(PILL_MIN_COUNTER_SCALE);
    expect(pillCounterScale(4)).toBe(PILL_MIN_COUNTER_SCALE);
    expect(pillCounterScale(0.5)).toBe(2);
    expect(pillCounterScale(0.25)).toBe(PILL_MAX_COUNTER_SCALE);
    expect(PILL_MAX_COUNTER_SCALE).toBe(4);
  });

  test("the clamp stops at 4, so a deeper zoom-out shrinks the pills", () => {
    for (const zoom of [0.2, 0.1, 0.01]) {
      expect(pillCounterScale(zoom)).toBe(PILL_MAX_COUNTER_SCALE);
    }
    // Below the ceiling the pills keep FULL screen size; past it they shrink
    // with the plane (pill screen factor = zoom * scale), never grow.
    const screen = (zoom: number) => zoom * pillCounterScale(zoom);
    expect(screen(1)).toBeCloseTo(1, 6);
    expect(screen(0.25)).toBeCloseTo(1, 6);
    expect(screen(0.2)).toBeLessThan(1);
    expect(screen(0.1)).toBeLessThan(screen(0.2));
  });

  test("the result is bounded and never increases as the map zooms in", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let zoom = 0.1; zoom <= 4; zoom += 0.05) {
      const scale = pillCounterScale(zoom);
      expect(scale).toBeGreaterThanOrEqual(PILL_MIN_COUNTER_SCALE);
      expect(scale).toBeLessThanOrEqual(PILL_MAX_COUNTER_SCALE);
      expect(scale).toBeLessThanOrEqual(previous + 1e-9);
      previous = scale;
    }
  });

  test("a zoom that is not a positive number answers the ceiling, not NaN", () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pillCounterScale(zoom)).toBe(PILL_MAX_COUNTER_SCALE);
    }
    expect(PILL).toContain("Number.isFinite(zoom)");
  });

  test("the pill is told the plane's own zoom and CSS owns the transform", () => {
    // The layer passes the camera's value it already has; the pill only turns
    // it into the clamped number (it never re-derives a transform).
    expect(LAYER).toContain("zoom={zoom}");
    // STORY 25-5: the counter-scale is the PLANE's shared var, written per
    // zoom frame (the camera's frames leave React); the pill carries none.
    expect(PILL).not.toContain("--pill-scale");
    expect(CSS).toContain("transform: scale(var(--pill-scale, 1))");
    expect(CSS).toContain("transform-origin: left bottom");
  });
});

describe("the pill renders the name; the card body does not", () => {
  test("the name lives in exactly one .ground-name, inside the pill", () => {
    const html = render([reference("Rain gauge")]);
    expect(html).toContain('class="ground-pill"');
    expect(html).toContain('class="ground-name"');
    expect(html).toContain("Rain gauge");
    // Exactly one .ground-name in the whole card: the pill's.
    expect(html.split("ground-name").length - 1).toBe(1);
    // The pill sits before the type line, which is now the body's first line.
    expect(html.indexOf("ground-pill")).toBeLessThan(html.indexOf("ground-kind"));
    // The card body keeps the type line and the crop; no in-card name div.
    expect(html).toContain("a reference with no reading");
    expect(html).not.toContain('<div class="ground-name">');
  });

  test("the pill's scale follows the camera in the rendered style", () => {
    // The rule itself is pinned through pillCounterScale (above): the pill
    // renders NO scale of its own — it inherits the plane's shared var.
    expect(render([reference("Rain gauge")], 0.25)).not.toContain("--pill-scale");
    expect(render([reference("Rain gauge")], 0.25)).toContain('class="ground-name"');
  });

  test("an empty name is legal and shows the quiet line 'no name yet'", () => {
    expect(render([reference("", "no-name")])).toContain(UNTITLED_DISPLAY);
    expect(render([reference("   ", "blank")])).toContain(UNTITLED_DISPLAY);
    // The pill says the ABSENCE, never the record's untitled sentence.
    expect(render([reference("", "no-name")])).not.toContain(
      GROUND_UNTITLED_NAME,
    );
    expect(UNTITLED_DISPLAY).toBe("no name yet");
    expect(groundDisplayName("")).toBe(UNTITLED_DISPLAY);
    expect(groundDisplayName("  ")).toBe(UNTITLED_DISPLAY);
    // A record carrying the untitled sentence shows the same quiet line...
    expect(groundDisplayName(GROUND_UNTITLED_NAME)).toBe(UNTITLED_DISPLAY);
    expect(groundDisplayName("Rain gauge")).toBe("Rain gauge");
    // ...and the RECORD keeps its own sentence (a line cannot carry no name).
    expect(GROUND_UNTITLED_NAME).toBe("Untitled reference");
    expect(groundNameForWrite("")).toBe(GROUND_UNTITLED_NAME);
  });

  test("the pill is content to the plane's gate and adds no map content family", () => {
    expect(CONTENT_CLASSES).toContain("ground-pill" as never);
    expect(CONTENT_CLASSES).toContain("ground-pill-input" as never);
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("the pill never covers the controls: it is positioned above the card", () => {
    const rule = CSS.slice(CSS.indexOf(".ground-pill {"), CSS.indexOf(".ground-pill-input"));
    expect(rule).toContain("position: absolute");
    expect(rule).toContain("bottom: calc(100% + 6px)");
    // The card's verbs row is a flex child of the card; the pill is out of flow,
    // so it cannot take the verbs' space or sit on them.
    expect(LAYER).toContain("className=\"ground-actions\"");
  });
});

describe("there is ONE drag rule", () => {
  test("the pill owns no pointer handling and no drag state", () => {
    for (const forbidden of [
      'from "./groundDrag"',
      "beginGroundDrag",
      "moveGroundDrag",
      "dropGroundDrag",
      "GROUND_DRAG_THRESHOLD",
      "addEventListener",
      "onMouseDown",
      "onMouseMove",
      "onMouseUp",
      "mousemove",
      "mouseup",
    ]) {
      expect({ forbidden, present: PILL.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  test("the card's existing listener is the only drag, on the same constant", () => {
    // STORY 16.23: the one press->threshold->drop join lives in DRAG's shared
    // helper; exactly one begin and one drop exist in the tree, and the three
    // cards reach them through one call each.
    expect(DRAG.split("let drag = beginGroundDrag(").length - 1).toBe(1);
    expect(DRAG.split("const dropped = dropGroundDrag(").length - 1).toBe(1);
    // The module's own threshold is passed by DEFAULT (no restated number).
    expect(DRAG).toContain(
      "moveGroundDrag(drag, { x: ev.clientX, y: ev.clientY })",
    );
    expect(LAYER).not.toContain("GROUND_DRAG_THRESHOLD");
    expect(PILL).not.toContain("GROUND_DRAG_THRESHOLD");
    // The constant lives in exactly one place and still means screen pixels.
    expect(DRAG).toContain("export const GROUND_DRAG_THRESHOLD = 4;");
    expect(DRAG.split("GROUND_DRAG_THRESHOLD =").length - 1).toBe(1);
    // The pill is a child of the card, so a press on it reaches the card's raw
    // listener: the drag needs no second wiring.
    expect(LAYER).toContain("<CardNamePill");
    expect(DRAG).toContain('target.closest(".ground-pill") !== null');
    // A press on the name is the handle, not a door: it does not open the card.
    expect(DRAG).toContain("if (!onPill) options.onClick?.(onPill);");
  });
});

describe("the rename writes through the existing name path", () => {
  test("one line changes; slug, point and the other line stay byte-identical", async () => {
    const path = freshWorkspace();
    const references = [
      { on: "rain-gauge", name: "Rain gauge", x: 40, y: 80 },
      { on: "soil", name: "Soil probe", x: 300, y: 120 },
    ];
    await saveGround(path, references, ["on: broken | line"], io);
    const before = readFileSync(join(path, "map", "ground.txt"), "utf8");
    expect(before).toContain("on: rain-gauge | name: Rain gauge | x: 40 | y: 80");

    const result = await renameGroundRecords(
      path,
      "rain-gauge",
      "Rain gauge (garden)",
      references,
      ["on: broken | line"],
      renameIo,
    );
    expect(result.renamed).toEqual({
      on: "rain-gauge",
      name: "Rain gauge (garden)",
      x: 40,
      y: 80,
    });
    const after = readFileSync(join(path, "map", "ground.txt"), "utf8");
    const lines = after.split("\n");
    expect(lines[0]).toBe(
      "on: rain-gauge | name: Rain gauge (garden) | x: 40 | y: 80",
    );
    expect(lines[1]).toBe(
      "on: soil | name: Soil probe | x: 300 | y: 120",
    );
    // The malformed line is preserved verbatim (ADR-0009), never repaired.
    expect(lines[2]).toBe("on: broken | line");
    // A rename mints no second line and reorders nothing.
    expect(after.split("\n").filter((line) => line.includes("rain-gauge")).length).toBe(1);
  });

  test("an empty rename stores the untitled sentence, so the line stays legal", async () => {
    const path = freshWorkspace();
    const references = [reference("Rain gauge")];
    await saveGround(path, references, [], io);
    await renameGroundRecords(path, "rain-gauge", "   ", references, [], renameIo);
    const text = readFileSync(join(path, "map", "ground.txt"), "utf8");
    expect(text).toContain("name: Untitled reference");
    // The map can read its own write back: identity is still the slug.
    const parsed = parseGround(text);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.references[0]).toEqual({
      on: "rain-gauge",
      name: GROUND_UNTITLED_NAME,
      x: 40,
      y: 80,
    });
    expect(groundNameForWrite("")).toBe(GROUND_UNTITLED_NAME);
    expect(groundNameForWrite("  Rain gauge  ")).toBe("Rain gauge");
  });

  test("a rename of a card that is gone writes the file back unchanged", async () => {
    const path = freshWorkspace();
    const references = [reference("Rain gauge")];
    await saveGround(path, references, [], io);
    const before = readFileSync(join(path, "map", "ground.txt"), "utf8");
    const result = await renameGroundRecords(path, "gone", "New", references, [], renameIo);
    expect(result.renamed).toBeNull();
    expect(readFileSync(join(path, "map", "ground.txt"), "utf8")).toBe(before);
  });

  test("the layer reaches the hook's one name path, and the app wires it", () => {
    expect(source("canvas/useGround.ts")).toContain(
      "const result = await renameGroundRecords(",
    );
    expect(source("canvas/useGround.ts")).toContain(
      "rename: (on: string, name: string) => Promise<GroundAddResult>;",
    );
    expect(source("App.tsx")).toContain("onRename={ground.rename}");
    // The rename field's exits: Enter commits, Escape abandons, and the pill's
    // empty field is the record's own empty-name rule.
    expect(PILL).toContain('if (e.key === "Escape")');
    expect(PILL).toContain("abandonRename();");
    expect(PILL).toContain("e.currentTarget.blur();");
    // STORY 16.22: the write goes through the FAMILY's rule, whose default is
    // the reference card's (`REFERENCE_PILL_RULES`). An ask card passes its own,
    // which refuses a blank field.
    expect(PILL).toContain("rules.nameForWrite(draft)");
    expect(PILL).toContain("displayName: groundDisplayName");
    expect(PILL).toContain("nameForWrite: groundNameForWrite");
  });

  test("the rename keeps the reading's key: no slug is minted", () => {
    const renamed = withGroundRenamed([reference("Rain gauge")], "rain-gauge", "New name");
    expect(renamed[0].on).toBe("rain-gauge");
    expect(renamed[0].name).toBe("New name");
  });

  test("no reading file is touched by a rename", async () => {
    const path = freshWorkspace();
    writeFileSync(join(path, "map", "readings.txt"), "on: rain-gauge | from: /tmp/a.txt | state: current\n");
    const references = [reference("Rain gauge")];
    await saveGround(path, references, [], io);
    const before = readFileSync(join(path, "map", "readings.txt"), "utf8");
    await renameGroundRecords(path, "rain-gauge", "Renamed", references, [], renameIo);
    expect(readFileSync(join(path, "map", "readings.txt"), "utf8")).toBe(before);
  });
});
