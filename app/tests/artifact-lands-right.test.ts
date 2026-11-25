import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_GAP_X,
  ARTIFACT_GAP_Y,
  GROUND_CARD_BOX,
  artifactPlacement,
} from "../src/canvas/geometry";
import { wireGeometry } from "../src/canvas/GroundWires";
import { readingKind, readingProvenance } from "../src/canvas/GroundLayer";
import { artifactsMadeFrom } from "../src/canvas/useGround";
import { distilledReading, type Reading } from "../src/map/readings";

/**
 * STORY 17.15 — THE ARTIFACT LANDS RIGHT, AND SAYS ONE THING.
 *
 * The story's check is human (ask a question and watch the window), so this
 * file pins the seams underneath it:
 *
 *   - PLACEMENT: to the RIGHT of the ask card, level with it, measured against
 *     the card's resting box (the same box the wire anchors to); several from
 *     one card cascade DOWN and never overlap;
 *   - THE WIRE: the existing link record (ask → new card) drawn by the existing
 *     renderer, whose ends land on the source's right edge and the card's left
 *     edge;
 *   - FOCUS: the layer opens the new card, closes the ask card and moves the
 *     keyboard with it;
 *   - ONE PROVENANCE LINE in the footer, never the header duplicate, and no
 *     "no file" sentence on a distilled card;
 *   - a RULE card's own single line survives.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const TAKEN = "2026-11-18T00:00:00.000Z";
const SOURCE = { x: 100, y: 60 };

function overlap(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return (
    a.x < b.x + GROUND_CARD_BOX.w &&
    b.x < a.x + GROUND_CARD_BOX.w &&
    a.y < b.y + GROUND_CARD_BOX.h &&
    b.y < a.y + GROUND_CARD_BOX.h
  );
}

describe("the artifact lands to the RIGHT and LEVEL", () => {
  test("one artifact sits right of the source, centred on it", () => {
    const at = artifactPlacement(SOURCE);
    expect(at.x).toBe(SOURCE.x + GROUND_CARD_BOX.w + ARTIFACT_GAP_X);
    // Level means the two resting boxes share a centre line.
    expect(at.y + GROUND_CARD_BOX.h / 2).toBe(
      SOURCE.y + GROUND_CARD_BOX.h / 2,
    );
    // And the two never overlap.
    expect(overlap(at, SOURCE)).toBe(false);
  });

  test("several from one card cascade DOWN and never overlap", () => {
    const first = artifactPlacement(SOURCE, []);
    const second = artifactPlacement(SOURCE, [first]);
    const third = artifactPlacement(SOURCE, [first, second]);
    expect(second.y).toBe(first.y + GROUND_CARD_BOX.h + ARTIFACT_GAP_Y);
    expect(third.y).toBe(second.y + GROUND_CARD_BOX.h + ARTIFACT_GAP_Y);
    expect(second.x).toBe(first.x);
    expect(overlap(first, second)).toBe(false);
    expect(overlap(second, third)).toBe(false);
    expect(overlap(first, third)).toBe(false);
  });

  test("the source's EXISTING artifacts are found from the records", () => {
    const asks: { x: number; y: number }[] = [{ x: 10, y: 20 }];
    const readings: Reading[] = [
      distilledReading("copy-a", "the-ask", TAKEN),
      distilledReading("copy-b", "another-ask", TAKEN),
    ];
    const references = [
      { on: "copy-a", name: "A", x: 9, y: 8 },
      { on: "copy-b", name: "B", x: 77, y: 88 },
    ];
    expect(artifactsMadeFrom("the-ask", references, readings)).toEqual([
      { x: 9, y: 8 },
    ]);
    expect(artifactsMadeFrom("no-such-ask", references, readings)).toEqual([]);
    expect(asks).toHaveLength(1);
  });
});

describe("the wire runs from the source's RIGHT edge into the card's LEFT edge", () => {
  function ends(forY = SOURCE.y) {
    const at = artifactPlacement({ x: SOURCE.x, y: forY });
    return {
      at,
      wire: wireGeometry(
        { on: "the-ask", x: SOURCE.x, y: forY },
        { on: "the-artifact", x: at.x, y: at.y },
      ),
    };
  }

  test("level cards: the source's right edge and the artifact's left edge", () => {
    const { at, wire } = ends();
    expect(wire).not.toBeNull();
    const centreY = SOURCE.y + GROUND_CARD_BOX.h / 2;
    expect(wire!.from).toEqual({ x: SOURCE.x + GROUND_CARD_BOX.w, y: centreY });
    expect(wire!.to).toEqual({ x: at.x, y: centreY });
  });

  test("INLINE with the wire's own card box (one geometry, no second offset)", () => {
    const geometry = source("canvas/geometry.ts");
    const wires = source("canvas/GroundWires.tsx");
    // The wire reads the box placement uses; it does not own a second copy.
    expect(wires).toContain("GROUND_CARD_W = GROUND_CARD_BOX.w");
    expect(wires).toContain("GROUND_CARD_H = GROUND_CARD_BOX.h");
    expect(geometry).toContain("export const GROUND_CARD_BOX");
  });

  test("the creation writes the EXISTING link record after the card exists", () => {
    const hook = source("canvas/useGround.ts");
    const writer = hook.slice(
      hook.indexOf("export async function writeDistilledCard"),
      hook.indexOf("STORY 18.4 — A FINISHED RUN'S RESULT"),
    );
    const wireAt = writer.indexOf("addGroundLink(links, askSlug, reading.on)");
    expect(wireAt).toBeGreaterThan(0);
    expect(writer.indexOf("await io.saveGround(")).toBeLessThan(wireAt);
    // No second edge renderer is invented: the one wire component still draws
    // every link with the one geometry.
    expect(source("canvas/GroundWires.tsx")).toContain("const geometry = wireGeometry(from, to);");
  });
});

describe("the artifact lands without taking the stage", () => {
  test("the layer stops stealing focus: the chat stays open and the hand keeps its place", () => {
    const layer = source("canvas/GroundLayer.tsx");
    const wrapper = layer.slice(
      layer.indexOf(
        "STORY 24-6 (ADR-0043) — THE ARTIFACT LANDS WITHOUT TAKING THE",
      ),
      layer.indexOf("onStopTurn={onStopAskTurn}"),
    );
    // THE PERSON'S RULING (the redesign brief, 2026-11-24): an artifact "must
    // land beside its source, level, wired in, and must NOT steal focus".
    // STORY 17.15's "takes the eye" behaviour is deliberately retired — this
    // test used to pin it, and now pins its absence.
    expect(wrapper).not.toContain("setOpenOn(result.created)");
    expect(wrapper).not.toContain("setOpenAskOn(null)");
    expect(wrapper).not.toContain(".focus()");
    // The turn still runs through the one path, unchanged.
    expect(wrapper).toContain("onAskTurn={onAskTurn}");
    expect(layer).toContain("tabIndex={-1}");
  });

  test("the hook reports the card it made, on the successful outcome only", () => {
    const hook = source("canvas/useGround.ts");
    expect(hook).toContain("let made: string | undefined;");
    expect(hook).toContain("...(made === undefined ? {} : { created: made })");
  });

  test("the creation places by the shared rule, not a copied offset", () => {
    const hook = source("canvas/useGround.ts");
    expect(hook).toContain("const at = artifactPlacement(");
    expect(hook).toContain("{ x: askNow.x, y: askNow.y },");
    expect(hook).toContain("artifactsMadeFrom(");
  });
});

describe("ONE provenance line, in the footer", () => {
  const names = new Map([["tide-question", "Tide question"]]);

  test("a curated card names manager, task and source once", () => {
    const reading = distilledReading("tide-card", "tide-question", TAKEN, {
      manager: "manager-small",
      task: "task-big",
    });
    expect(readingProvenance(reading, names)).toBe(
      "distilled by manager-small from task-big's reply · from Tide question",
    );
    // The header line is gone, so the face cannot say it twice.
    expect(readingKind(reading, names)).toBeNull();
  });

  test("a rule card keeps its own single line", () => {
    const reading = distilledReading("tide-card", "tide-question", TAKEN);
    expect(readingProvenance(reading, names)).toBe(
      "a rule's copy of Tide question",
    );
    expect(readingKind(reading, names)).toBeNull();
  });

  test("a source the map no longer carries is said, not repaired", () => {
    const reading = distilledReading("tide-card", "gone", TAKEN, {
      manager: "manager-small",
      task: "task-big",
    });
    expect(readingProvenance(reading, names)).toBe(
      "distilled by manager-small from task-big's reply · from a card that is gone",
    );
  });

  test("the footer renders it once and the distilled card says nothing about files", () => {
    const layer = source("canvas/GroundLayer.tsx");
    // The header row is conditional on the kind line; a distilled card's is null.
    expect(layer).toContain("{kindLine !== null && (");
    expect(layer).toContain("const kindLine = readingKind(reading, sourceNames, pageTitle);");
    // The stray sentence (17.11's) is gone from the distilled verbs row.
    expect(layer).not.toContain("a rule's copy; there is no file");
    expect(layer).not.toContain("reply; there is no file to refresh");
    // The selection card's own quiet line remains, because that card has no file.
    expect(layer).toContain(
      "this is a copy; there is no file to refresh or point at.",
    );
    // ONE footer row carries the provenance; the header cannot repeat it.
    expect(layer.match(/readingProvenance\(reading, sourceNames\)/g)).toHaveLength(1);
  });
});
