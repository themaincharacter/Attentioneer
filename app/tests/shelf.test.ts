import { describe, expect, test } from "bun:test";
import { DEFAULT_BOX } from "../src/canvas/geometry";
import { agentsMd, parseYamlFields, workspaceYml } from "../src/lib/serialize";
import { parseReference, serializeReference, type Reference } from "../src/map/refs";
import { serializeMarks, withoutMark, type Mark } from "../src/map/marks";
import {
  DEFAULT_SHELF_X,
  SHELF_MARGIN,
  isShelved,
  rejectSpot,
  shelfXOf,
  wordCentreX,
} from "../src/map/shelf";

/**
 * Story-3 guarantee, automated: the shelf is a place, not a state (ADR-0010).
 * The fold is a workspace-level `shelf_x` read tolerantly (older workspaces
 * default cleanly) and tested against a word's centre; rejecting writes only
 * the reference's position and keeps the mark-derived deferred/rejected split;
 * a set-aside word's file carries no shelf field. What remains a human check:
 * the feel of the drag across the fold and the quiet pair of styles.
 */

const fold = DEFAULT_SHELF_X;

function yml(text: string): number {
  return shelfXOf(parseYamlFields(text));
}

function reference(over: Partial<Reference> = {}): Reference {
  return {
    id: "water",
    slug: "water",
    name: "water",
    x: 300,
    y: 240,
    body: "",
    extra: {},
    ...over,
  };
}

describe("the fold is a workspace-level convention, read tolerantly", () => {
  test("the scaffold writes shelf_x and it reads back as the default", () => {
    const fields = parseYamlFields(workspaceYml());
    expect(fields.shelf_x).toBe(DEFAULT_SHELF_X);
    expect(shelfXOf(fields)).toBe(DEFAULT_SHELF_X);
  });

  test("the scaffold's comments are not fields", () => {
    // A colon inside a YAML comment would parse as a phantom key; keep the
    // scaffold's comments colon-free so the file has exactly two fields.
    expect(Object.keys(parseYamlFields(workspaceYml())).sort()).toEqual([
      "format",
      "shelf_x",
    ]);
  });

  test("a workspace from before the shelf opens with the default", () => {
    const older =
      '# Attentioneer workspace — the format key below marks the on-disk schema.\n' +
      'format: "attentioneer-workspace/1"\n';
    expect(yml(older)).toBe(DEFAULT_SHELF_X);
  });

  test("an explicit number is the fold", () => {
    expect(yml("format: \"x\"\nshelf_x: 900\n")).toBe(900);
    expect(yml("shelf_x: 0\n")).toBe(0);
    expect(yml("shelf_x: -40.5\n")).toBe(-40.5);
  });

  test("a quoted number, a hand edit with CRLF, and stray spaces all read", () => {
    expect(yml('shelf_x: "1200"\n')).toBe(1200);
    expect(yml('# my map\r\nformat: "x"\r\nshelf_x:   640  \r\n')).toBe(640);
  });

  test("missing, empty, or unreadable values fall back quietly", () => {
    expect(yml("format: \"x\"\n")).toBe(DEFAULT_SHELF_X);
    expect(yml("shelf_x:\n")).toBe(DEFAULT_SHELF_X);
    expect(yml('shelf_x: ""\n')).toBe(DEFAULT_SHELF_X);
    expect(yml("shelf_x: wide\n")).toBe(DEFAULT_SHELF_X);
    expect(yml("shelf_x: NaN\n")).toBe(DEFAULT_SHELF_X);
    expect(yml('shelf_x: "1200px"\n')).toBe(DEFAULT_SHELF_X);
    expect(shelfXOf({})).toBe(DEFAULT_SHELF_X);
  });

  test("the scaffold tells a delegate the same convention", () => {
    const md = agentsMd("garden");
    expect(md).toContain("shelf_x");
    expect(md).toContain("word's centre");
    expect(md).toContain("set-aside");
    expect(md).toContain("deferred");
    expect(md).toContain("rejected");
    expect(md).toContain(String(DEFAULT_SHELF_X));
  });
});

describe("the fold tests the word's centre, not its left edge", () => {
  test("the centre at the fold counts as set aside; a hair short does not", () => {
    expect(wordCentreX(fold - 48, 96)).toBe(fold);
    expect(isShelved(fold - 48, 96, fold)).toBe(true);
    expect(isShelved(fold - 48.1, 96, fold)).toBe(false);
  });

  test("x at or past the fold is always set aside, whatever the width", () => {
    for (const width of [0, 1, 96, 400]) {
      expect(isShelved(fold, width, fold)).toBe(true);
      expect(isShelved(fold + 1, width, fold)).toBe(true);
    }
  });

  test("a word well left of the fold is live", () => {
    expect(isShelved(400, DEFAULT_BOX.w, fold)).toBe(false);
    expect(isShelved(fold - DEFAULT_BOX.w, DEFAULT_BOX.w, fold)).toBe(false);
  });

  test("the default fold leaves the whole default window live", () => {
    // The default window is 1200 px wide at 100% zoom. A word coined at its
    // right edge (x = 1200) must not land on the shelf by accident: the
    // default fold sits a word's width beyond the window.
    expect(isShelved(1200, DEFAULT_BOX.w, fold)).toBe(false);
    expect(fold).toBeGreaterThan(1200);
  });

  test("a hand-edited x at the fold is set aside on read", () => {
    const handEdited = reference({ x: fold });
    expect(isShelved(handEdited.x, DEFAULT_BOX.w, fold)).toBe(true);
  });
});

describe("reject is settle + set aside in one move", () => {
  test("a live word lands in the column past the fold, at its own height", () => {
    const spot = rejectSpot({ x: 300, y: 240, width: 96 }, fold);
    expect(spot).toEqual({ x: fold + SHELF_MARGIN, y: 240 });
    expect(spot).not.toBeNull();
    expect(isShelved(spot!.x, 96, fold)).toBe(true);
  });

  test("the rejected spot is on the shelf for any rendered width", () => {
    const spot = rejectSpot({ x: 300, y: 240, width: 96 }, fold)!;
    for (const width of [0, 1, 96, 400]) {
      expect(isShelved(spot.x, width, fold)).toBe(true);
    }
  });

  test("an already set-aside word keeps its place — only the settle is left", () => {
    expect(rejectSpot({ x: fold + SHELF_MARGIN, y: 240, width: 96 }, fold)).toBeNull();
    // Its left edge looks live, but its centre is past the fold.
    expect(rejectSpot({ x: fold - 20, y: 240, width: 96 }, fold)).toBeNull();
  });
});

describe("deferred vs rejected is derived from the mark, never stored", () => {
  test("the two differ only by the mark line; both stay set aside", () => {
    const water: Mark = {
      kind: "open",
      target: { type: "word", slug: "water" },
      extra: {},
    };
    const spot = rejectSpot({ x: 300, y: 240, width: 96 }, fold)!;
    expect(serializeMarks([water])).toBe('{"kind":"open","on":"water"}\n');
    expect(serializeMarks(withoutMark([water], "open", water.target))).toBe("\n");
    expect(isShelved(spot.x, DEFAULT_BOX.w, fold)).toBe(true);
    // Nothing on disk says "rejected": the shelf is the place, and the
    // word's file is an ordinary reference (ADR-0010).
  });
});

describe("set-aside changes only the reference's position", () => {
  test("the file gains no shelf field; only the x line differs", () => {
    const live = reference({ body: "a remembered thing\n" });
    const spot = rejectSpot({ x: live.x, y: live.y, width: 96 }, fold)!;
    const before = serializeReference(live).split("\n");
    const after = serializeReference({ ...live, x: spot.x }).split("\n");

    const changed = before
      .map((line, index) => (line === after[index] ? null : index))
      .filter((index): index is number => index !== null);
    expect(changed).toHaveLength(1);
    expect(after[changed[0]]).toBe(`x: ${spot.x}`);
    expect(after.join("\n")).not.toContain("shelf");
  });

  test("round-trip: position, name and memory survive; no extra keys appear", () => {
    const spot = rejectSpot({ x: 300, y: 240, width: 96 }, fold)!;
    const shelved = parseReference(
      "water",
      "water",
      serializeReference({ ...reference({ body: "why water?\n" }), x: spot.x }),
    );
    expect(shelved.x).toBe(fold + SHELF_MARGIN);
    expect(shelved.y).toBe(240);
    expect(shelved.name).toBe("water");
    expect(shelved.body).toBe("why water?\n");
    expect(shelved.extra).toEqual({});
    expect(isShelved(shelved.x, DEFAULT_BOX.w, fold)).toBe(true);
  });

  test("revisit is the same write in reverse: the word goes live again", () => {
    const live = reference();
    const spot = rejectSpot({ x: live.x, y: live.y, width: 96 }, fold)!;
    expect(isShelved(spot.x, DEFAULT_BOX.w, fold)).toBe(true);
    expect(isShelved(live.x, DEFAULT_BOX.w, fold)).toBe(false);
    // Nothing was stored about having been rejected, so a plain move back is
    // the whole revisit (ADR-0010: no promote step, no remembered home).
    const revisited = parseReference("water", "water", serializeReference({ ...live, x: 300 }));
    expect(isShelved(revisited.x, DEFAULT_BOX.w, fold)).toBe(false);
  });
});
