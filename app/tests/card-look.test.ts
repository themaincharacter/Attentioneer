import { describe, expect, test } from "bun:test";
import {
  isLookTint,
  keptLooks,
  looksBySlug,
  LOOK_FRAMES,
  parseLookLine,
  parseLooks,
  serializeLookLine,
  type CardLook,
} from "../src/map/looks";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CardLookPicker } from "../src/canvas/CardLookPicker";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("the card's own look (story 25-17)", () => {
  test("a line parses exactly or not at all (never guessed)", () => {
    expect(parseLookLine('{"on":"rain-gauge","frame":"bevel","tint":"#b8933f"}')).toEqual({
      on: "rain-gauge",
      frame: "bevel",
      tint: "#b8933f",
    });
    // A default look carries no fields at all.
    expect(parseLookLine('{"on":"rain-gauge"}')).toEqual({ on: "rain-gauge" });
    // Anything out of shape is null — a wrong frame, a wrong colour, no slug.
    expect(parseLookLine('{"on":"a","frame":"loud"}')).toBeNull();
    expect(parseLookLine('{"on":"a","tint":"red"}')).toBeNull();
    expect(parseLookLine('{"frame":"bevel"}')).toBeNull();
    expect(parseLookLine("not json")).toBeNull();
  });

  test("the frames are the sheet's own, and a tint is a hex colour", () => {
    expect([...LOOK_FRAMES]).toEqual(["default", "plain", "bevel", "dashed", "muted"]);
    expect(isLookTint("#b8933f")).toBe(true);
    expect(isLookTint("#B8933F")).toBe(true);
    expect(isLookTint("#fff")).toBe(false);
    expect(isLookTint("gold")).toBe(false);
    expect(isLookTint(7)).toBe(false);
  });

  test("what is written is the bounded line, and the last line per slug wins", () => {
    const look: CardLook = { on: "a", frame: "muted", tint: "#4a6a94" };
    expect(serializeLookLine(look)).toBe('{"on":"a","frame":"muted","tint":"#4a6a94"}');
    // A default look writes the slug alone (the default is no statement).
    expect(serializeLookLine({ on: "a", frame: "default" })).toBe('{"on":"a"}');
    expect(serializeLookLine({ on: "a", tint: "" })).toBe('{"on":"a"}');
    const parsed = parseLooks(
      '{"on":"a","frame":"bevel"}\n{"on":"b"}\n{"on":"a","frame":"muted"}\n',
    );
    expect(parsed.malformed).toEqual([]);
    expect(looksBySlug(parsed.looks).a?.frame).toBe("muted");
    // The KEEP keeps the last line per slug and every orphan where it is.
    expect(keptLooks(parsed.looks).map((one) => one.on)).toEqual(["b", "a"]);
  });

  test("the gear's picker offers the frames, the swatches and free choice", () => {
    const html = renderToStaticMarkup(
      createElement(CardLookPicker, {
        look: { on: "a", frame: "bevel", tint: "#b8933f" },
        onSet: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain('class="look-picker"');
    // Every frame is its own choice and the chosen one is marked.
    for (const frame of ["default", "plain", "bevel", "dashed", "muted"]) {
      expect(html).toContain(">" + frame + "</button>");
    }
    expect(html).toContain('class="look-choice look-choice-on"');
    // The tints, the free picker, and the one way out.
    expect(html).toContain('class="look-free"');
    expect(html).toContain(">done</button>");
  });

  test("the card wears the person's frame and tint (story 25-17)", () => {
    const LAYER = readFileSync(
      join(import.meta.dir, "../src/canvas/GroundLayer.tsx"),
      "utf8",
    );
    // The worn frame overrides the state's edge; the tint rides the root
    // inline so no frame class can outrank it.
    expect(LAYER).toContain("const worn = look?.frame ?? \"default\"");
    expect(LAYER).toContain("frame-${worn}");
    expect(LAYER).toContain("borderColor: look?.tint");
    // The gear key and its picker.
    expect(LAYER).toContain('className="ground-gear"');
    expect(LAYER).toContain("<CardLookPicker");
  });

  test("every family wears its own look (story 25-18)", () => {
    // The ask and session gears ride the same seam as the reference's: the
    // worn frame overrides the state's edge, the tint rides the root inline.
    for (const name of ["GroundLayer.tsx", "AskCard.tsx", "SessionCard.tsx"]) {
      const src = readFileSync(
        join(import.meta.dir, "../src/canvas/" + name),
        "utf8",
      );
      expect(src).toContain('className="ground-gear"');
      expect(src).toContain("<CardLookPicker");
      expect(src).toContain('const worn = look?.frame ?? "default"');
      expect(src).toContain("borderColor: look?.tint");
      // A card with NO stored look still opens the picker (the bug the person
      // found: the panel used to require a look to exist before it showed).
      expect(src).toContain("look={look ?? {");
      expect(src).not.toContain("lookOpen && look !== undefined");
    }
  });

  test("a malformed line is kept as itself, never guessed", () => {
    const parsed = parseLooks('{"on":"a"}\nthis is not a line\n');
    expect(parsed.looks).toEqual([{ on: "a" }]);
    expect(parsed.malformed).toEqual(["this is not a line"]);
  });
});
