import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  parsePointers,
  serializePointers,
  type Pointer,
  type PointerForm,
} from "../src/map/pointers";
import {
  dedupeMarks,
  markTargetKey,
  parseMarks,
  serializeMarks,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import {
  dropMarksTouching,
  dropPointerMarksAt,
  dropPointerMarksTouching,
  dropPointersTouching,
  retargetPointerMarks,
  rewriteMarkEndpoints,
  rewritePointerMarkOwners,
  rewritePointerOwners,
} from "../src/map/patches";

/**
 * Story-1 batch guarantees, automated (ADR-0017, ADR-0009's tightened second
 * amendment): a rename carries the pointers' `on` and the pointer-key marks'
 * owner copy in one batch; a remove drops the lines and their marks
 * (die-with-target); and the write order puts the POINTERS step before the
 * pointer-marks step so a crash can never leave an app-authored dangling mark.
 *
 * The order is read from the source the app runs (the cross-record suite's
 * precedent): the atomic batch crosses the Tauri fs bridge, so this suite
 * applies the SAME pure steps in the SAME documented order and asserts the
 * resulting bytes.
 */

const openPointer = (on: string, form: PointerForm, value: string): MarkTarget => ({
  type: "pointer",
  on,
  form,
  value,
});

function pointer(
  on: string,
  form: PointerForm,
  value: string,
  extra: Record<string, unknown> = {},
): Pointer {
  return { on, form, value, extra };
}

function open(target: MarkTarget, extra: Record<string, unknown> = {}): Mark {
  return { kind: "open", target, extra };
}

/** The source text of one exported function in a module file. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf("export async function " + name);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("the pointer steps of a rename", () => {
  test("on follows the word; the target strings stay byte-verbatim", () => {
    const pointers = [
      pointer("rain", "path", "notes/x.md", { rank: 1 }),
      pointer("rain", "at", "/home/k/x.md"),
      pointer("soil", "url", "https://example.org"),
    ];
    const next = rewritePointerOwners(pointers, "rain", "storm");
    expect(next.map((line) => line.on)).toEqual(["storm", "storm", "soil"]);
    // Only `on` changed: the values, forms and unknown keys are the person's.
    expect(next[0].value).toBe("notes/x.md");
    expect(next[0].form).toBe("path");
    expect(next[0].extra).toEqual({ rank: 1 });
    expect(next[1].value).toBe("/home/k/x.md");
    expect(next[2]).toBe(pointers[2]);
  });

  test("the app's rewrite beats a hand-edited duplicate on the new owner", () => {
    const pointers = [
      pointer("storm", "path", "notes/x.md", { who: "hand" }),
      pointer("rain", "path", "notes/x.md", { who: "app" }),
    ];
    const next = rewritePointerOwners(pointers, "rain", "storm");
    expect(next).toHaveLength(1);
    expect(next[0].on).toBe("storm");
    expect(next[0].extra).toEqual({ who: "app" });
  });

  test("untouched duplicate keys elsewhere are never collapsed", () => {
    const dup = pointer("soil", "url", "https://x");
    const pointers = [dup, dup, pointer("rain", "path", "a")];
    const next = rewritePointerOwners(pointers, "rain", "storm");
    expect(next.filter((line) => line.on === "soil")).toHaveLength(2);
  });

  test("renaming to the same slug is a quiet copy", () => {
    const pointers = [pointer("rain", "path", "a")];
    const next = rewritePointerOwners(pointers, "rain", "rain");
    expect(next).toEqual(pointers);
    expect(next).not.toBe(pointers);
  });

  test("malformed lines ride along byte-identically", () => {
    const parsed = parsePointers(
      '{"on":"rain","path":"notes/x.md"}\n{not a pointer',
    );
    const next = rewritePointerOwners(parsed.pointers, "rain", "storm");
    expect(serializePointers(next, parsed.malformed)).toBe(
      '{"on":"storm","path":"notes/x.md"}\n{not a pointer\n',
    );
  });
});

describe("the pointer steps of a remove", () => {
  test("the word's lines go; every other line keeps its bytes", () => {
    const pointers = [
      pointer("rain", "path", "notes/x.md", { rank: 1 }),
      pointer("soil", "url", "https://example.org"),
      pointer("rain", "at", "/home/k/x.md"),
    ];
    const next = dropPointersTouching(pointers, "rain");
    expect(next).toEqual([pointers[1]]);
    expect(serializePointers(next)).toBe(
      '{"on":"soil","url":"https://example.org"}\n',
    );
  });

  test("the marks on those lines die, after their lines", () => {
    const marks = [
      open(openPointer("rain", "path", "notes/x.md")),
      open(openPointer("soil", "url", "https://example.org")),
      open({ type: "word", slug: "rain" }),
    ];
    // The word-mark step leaves pointer marks to the pointer-marks step.
    const afterWordStep = dropMarksTouching(marks, "rain");
    expect(afterWordStep).toHaveLength(2);
    const afterPointerStep = dropPointerMarksTouching(afterWordStep, "rain");
    expect(afterPointerStep.map((mark) => mark.target)).toEqual([
      openPointer("soil", "url", "https://example.org"),
    ]);
    expect(dropPointerMarksTouching(afterWordStep, "sea")).toEqual(
      afterWordStep,
    );
  });
});

describe("a rename/remove across pointers, their marks and the malformed", () => {
  interface Batch {
    pointers: Pointer[];
    marks: Mark[];
    malformed: string[];
  }

  function base(): Batch {
    return {
      pointers: [
        pointer("rain", "path", "notes/x.md", { rank: 1 }),
        pointer("rain", "at", "/home/k/x.md"),
        pointer("soil", "url", "https://example.org"),
      ],
      marks: [
        open(openPointer("rain", "path", "notes/x.md"), { rank: 3 }),
        open(openPointer("rain", "at", "/home/k/x.md")),
        open(openPointer("soil", "url", "https://example.org")),
        open({ type: "word", slug: "rain" }),
      ],
      malformed: ["{bad pointer line"],
    };
  }

  /** The rename batch in the module's documented order (pointer steps only). */
  function renameThrough(batch: Batch, oldSlug: string, newSlug: string): Batch {
    const marksAfterWordStep = rewriteMarkEndpoints(batch.marks, oldSlug, newSlug);
    const pointers = rewritePointerOwners(batch.pointers, oldSlug, newSlug);
    const marks = rewritePointerMarkOwners(marksAfterWordStep, oldSlug, newSlug);
    return { pointers, marks, malformed: batch.malformed };
  }

  function removeThrough(batch: Batch, slug: string): Batch {
    const marksAfterWordStep = dropMarksTouching(batch.marks, slug);
    const pointers = dropPointersTouching(batch.pointers, slug);
    const marks = dropPointerMarksTouching(marksAfterWordStep, slug);
    return { pointers, marks, malformed: batch.malformed };
  }

  test("rename: the reach follows, the marks' key copies follow, bytes read back", () => {
    const after = renameThrough(base(), "rain", "storm");
    const bytes = {
      "map/pointers.jsonl": serializePointers(after.pointers, after.malformed),
      "map/marks.jsonl": serializeMarks(after.marks),
    };
    expect(bytes["map/pointers.jsonl"]).toBe(
      [
        '{"on":"storm","path":"notes/x.md","rank":1}',
        '{"at":"/home/k/x.md","on":"storm"}',
        '{"on":"soil","url":"https://example.org"}',
        '{bad pointer line',
        "",
      ].join("\n"),
    );
    // The collision rule emits untouched marks first, the app's rewritten ones
    // last: the soil reach and the word mark keep their bytes and their order,
    // and the two pointer marks follow under their new owner.
    expect(bytes["map/marks.jsonl"]).toBe(
      [
        '{"kind":"open","on":"soil","url":"https://example.org"}',
        '{"kind":"open","on":"storm"}',
        '{"kind":"open","on":"storm","path":"notes/x.md","rank":3}',
        '{"at":"/home/k/x.md","kind":"open","on":"storm"}',
        "",
      ].join("\n"),
    );
    // Nothing dangles: every pointer mark names a line that exists.
    const pointerKeys = new Set(
      after.pointers.map((line) => markTargetKey(openPointer(line.on, line.form, line.value))),
    );
    for (const mark of after.marks) {
      if (mark.target.type !== "pointer") continue;
      expect(pointerKeys.has(markTargetKey(mark.target))).toBe(true);
    }
    // Read back byte-for-byte.
    expect(
      serializePointers(
        parsePointers(bytes["map/pointers.jsonl"]).pointers,
        parsePointers(bytes["map/pointers.jsonl"]).malformed,
      ),
    ).toBe(bytes["map/pointers.jsonl"]);
    expect(serializeMarks(parseMarks(bytes["map/marks.jsonl"]).marks)).toBe(
      bytes["map/marks.jsonl"],
    );
  });

  test("remove: the lines and their marks go; the survivors keep their bytes", () => {
    const after = removeThrough(base(), "rain");
    const pointers = serializePointers(after.pointers, after.malformed);
    expect(pointers).toBe(
      '{"on":"soil","url":"https://example.org"}\n{bad pointer line\n',
    );
    expect(serializeMarks(after.marks)).toBe(
      '{"kind":"open","on":"soil","url":"https://example.org"}\n',
    );
    // No mark names the removed word's reach any more.
    expect(serializeMarks(after.marks)).not.toContain("notes/x.md");
    expect(serializeMarks(after.marks)).not.toContain("/home/k/x.md");
    expect(dedupeMarks(after.marks)).toEqual(after.marks);
  });

  test("an edit carries its mark in the same batch (pointer line first)", () => {
    const before = pointer("rain", "path", "notes/x.md");
    const after = pointer("rain", "path", "notes/y.md");
    const marks = [open(openPointer("rain", "path", "notes/x.md"), { rank: 3 })];
    const moved = retargetPointerMarks(marks, before, after);
    // The pointer line is the durable thing; the mark write follows it. Both
    // end on the same key, so the reach reads marked at its new address.
    expect(serializePointers([after])).toBe(
      '{"on":"rain","path":"notes/y.md"}\n',
    );
    expect(serializeMarks(moved)).toBe(
      '{"kind":"open","on":"rain","path":"notes/y.md","rank":3}\n',
    );
    // A no-op drop (the same line re-stated) needs no mark write at all.
    expect(dropPointerMarksAt(marks, before)).toEqual([]);
  });
});

describe("the batch's write order puts pointers before their marks", () => {
  const source = readFileSync(
    new URL("../src/map/patches.ts", import.meta.url),
    "utf8",
  );

  test("the module doc states the grown order and its crash rule", () => {
    expect(source).toMatch(/references -> distances -> links -> marks ->/);
    expect(source).toMatch(
      /loops -> assumptions -> pointers -> pointer-marks -> membership -> the old file/,
    );
    expect(source).toContain("written BEFORE their marks");
    expect(source).toContain("dangling mark");
  });

  test("rename writes the pointer lines, then the pointer-key marks, then the set", () => {
    const body = functionBody(source, "renameReference");
    const firstMarks = body.indexOf("saveMarks(");
    const pointersAt = body.indexOf("savePointers(");
    const secondMarks = body.indexOf("saveMarks(", firstMarks + 1);
    expect(firstMarks).toBeGreaterThan(-1);
    expect(pointersAt).toBeGreaterThan(body.indexOf("saveAssumptions("));
    expect(pointersAt).toBeGreaterThan(-1);
    expect(secondMarks).toBeGreaterThan(pointersAt);
    expect(body.indexOf("saveModel(")).toBeGreaterThan(secondMarks);
    expect(body.indexOf("removeFile(referencePath")).toBeGreaterThan(
      body.indexOf("saveModel("),
    );
    // The pointer step sits after the assumptions and before the membership.
    expect(body.indexOf("rewritePointerOwners(")).toBeGreaterThan(
      body.indexOf("saveAssumptions("),
    );
    expect(body.indexOf("rewritePointerMarkOwners(")).toBeGreaterThan(
      body.indexOf("savePointers("),
    );
  });

  test("remove drops the pointer lines, then their marks, then the membership", () => {
    const body = functionBody(source, "removeReference");
    const firstMarks = body.indexOf("saveMarks(");
    const pointersAt = body.indexOf("savePointers(");
    const secondMarks = body.indexOf("saveMarks(", firstMarks + 1);
    expect(firstMarks).toBeGreaterThan(-1);
    expect(pointersAt).toBeGreaterThan(body.indexOf("saveAssumptions("));
    expect(secondMarks).toBeGreaterThan(pointersAt);
    expect(body.indexOf("saveModel(")).toBeGreaterThan(secondMarks);
    expect(body.indexOf("removeFile(referencePath")).toBeGreaterThan(
      body.indexOf("saveModel("),
    );
    expect(body.indexOf("dropPointersTouching(")).toBeGreaterThan(
      body.indexOf("savePointers(") - 1,
    );
    expect(body.indexOf("dropPointerMarksTouching(")).toBeGreaterThan(
      body.indexOf("savePointers("),
    );
  });
});
