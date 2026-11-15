import { describe, expect, test } from "bun:test";
import {
  dedupeMarks,
  findOrphanMarks,
  hasMark,
  markKey,
  markTargetKey,
  parseMarkLine,
  parseMarks,
  serializeMarkLine,
  serializeMarks,
  withMark,
  withoutMark,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import { distanceKey } from "../src/map/distances";
import { linkKey } from "../src/map/links";
import { pointerKey } from "../src/map/pointers";
import {
  dropPointerMarksAt,
  dropPointerMarksTouching,
  rewritePointerMarkOwners,
  retargetPointerMarks,
} from "../src/map/patches";
import {
  isPointerMarked,
  markedPointerKeys,
  pointerMarkKey,
} from "../src/canvas/pointerRules";

/**
 * Story-1 guarantee, automated: the mark grammar gains the POINTER-KEY target
 * (ADR-0009's tightened second amendment) — `{"kind":"open","on":...,"path":
 * ...}` (or `at`/`url`) — distinct from the word, wire, link and spot forms.
 * Byte-identical hand duplicates share the key and both render marked; a
 * replace-in-place pointer edit carries its marks to the new key in the same
 * batch; the mark dies with its line.
 */

const word = (slug: string): MarkTarget => ({ type: "word", slug });
const pointer = (
  on: string,
  form: "path" | "at" | "url",
  value: string,
): MarkTarget => ({ type: "pointer", on, form, value });
const open = (target: MarkTarget, extra: Record<string, unknown> = {}): Mark => ({
  kind: "open",
  target,
  extra,
});

function pointerRecord(on: string, form: "path" | "at" | "url", value: string) {
  return { on, form, value, extra: {} };
}

describe("the pointer-key mark line, canonical per form", () => {
  test("path, at and url serialize as one compact sorted line", () => {
    expect(serializeMarkLine(open(pointer("rain", "path", "notes/x.md")))).toBe(
      '{"kind":"open","on":"rain","path":"notes/x.md"}',
    );
    expect(
      serializeMarkLine(open(pointer("rain", "at", "/home/k/x.md"))),
    ).toBe('{"at":"/home/k/x.md","kind":"open","on":"rain"}');
    expect(
      serializeMarkLine(open(pointer("rain", "url", "https://example.org"))),
    ).toBe('{"kind":"open","on":"rain","url":"https://example.org"}');
  });

  test("every form round-trips byte-for-byte with its unknown keys", () => {
    const marks = [
      open(pointer("rain", "path", "notes/x.md"), { note: "why" }),
      open(pointer("rain", "at", "/home/k/x.md"), { rank: 2 }),
      open(pointer("rain", "url", "https://example.org")),
    ];
    for (const mark of marks) {
      const line = serializeMarkLine(mark);
      const parsed = parseMarkLine(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.target).toEqual(mark.target);
      expect(parsed!.extra).toEqual(mark.extra);
      expect(serializeMarkLine(parsed!)).toBe(line);
    }
  });

  test("the pointer-key form is distinct from the word, wire, link and spot", () => {
    const keys = new Set([
      markTargetKey(word("rain")),
      markTargetKey(pointer("rain", "path", "notes/x.md")),
      markTargetKey({
        type: "wire",
        from: "rain",
        to: "soil",
        word: "soaks",
      }),
      markTargetKey({ type: "link", from: "rain", to: "soil" }),
      markTargetKey({ type: "spot", x: 1, y: 2 }),
    ]);
    expect(keys.size).toBe(5);
    // The same value under a different form is a different line's mark.
    expect(markTargetKey(pointer("rain", "path", "x"))).not.toBe(
      markTargetKey(pointer("rain", "at", "x")),
    );
    // The pointer key carries the pointer record's own natural key.
    expect(markTargetKey(pointer("rain", "path", "x"))).toBe(
      "pointer\u0000" + pointerKey("rain", "path", "x"),
    );
    // A word mark and a pointer mark on the same word never collide.
    expect(hasMark([open(pointer("rain", "path", "x"))], "open", word("rain"))).toBe(
      false,
    );
    expect(
      hasMark([open(pointer("rain", "path", "x"))], "open", pointer("rain", "path", "x")),
    ).toBe(true);
  });

  test("a mixed or half-stated pointer line is malformed, never guessed", () => {
    for (const line of [
      '{"kind":"open","on":"rain","path":"x","url":"y"}',
      '{"kind":"open","on":"rain","path":"x","at":"y"}',
      '{"kind":"open","on":"rain","path":2}',
      '{"kind":"open","on":"rain","path":""}',
      '{"kind":"open","on":"rain","path":"x","from":"a","to":"b"}',
      '{"kind":"open","on":"rain","path":"x","x":1,"y":2}',
    ]) {
      expect(parseMarkLine(line)).toBeNull();
    }
  });
});

describe("byte-identical hand duplicates share the key and both render marked", () => {
  test("both lines parse, both key the same, the cue is presence not a count", () => {
    const line = serializeMarkLine(open(pointer("rain", "url", "https://x")));
    const parsed = parseMarks(line + "\n" + line + "\n");
    expect(parsed.malformed).toEqual([]);
    expect(parsed.marks).toHaveLength(2);
    expect(markKey(parsed.marks[0])).toBe(markKey(parsed.marks[1]));
    // The canvas turns the marks into a key set: one key, so every row on
    // that reach reads marked (both duplicates render the same cue).
    const marked = markedPointerKeys(parsed.marks);
    expect(marked.size).toBe(1);
    const record = pointerRecord("rain", "url", "https://x");
    expect(isPointerMarked(record, marked)).toBe(true);
    expect(marked.has(pointerMarkKey(record))).toBe(true);
    // A write still collapses the duplicate to one line (one line per key).
    expect(serializeMarks(parsed.marks)).toBe(line + "\n");
    expect(dedupeMarks(parsed.marks)).toHaveLength(1);
    // Withdrawing settles the one key, duplicates and all.
    expect(withoutMark(parsed.marks, "open", pointer("rain", "url", "https://x"))).toEqual(
      [],
    );
  });
});

describe("a replace-in-place edit carries the mark to the new key", () => {
  test("an in-place value edit moves the mark and leaves the record intact", () => {
    const before = pointerRecord("rain", "path", "notes/a.md");
    const after = pointerRecord("rain", "path", "notes/b.md");
    const marks = [open(pointer("rain", "path", "notes/a.md"), { rank: 3 })];
    const next = retargetPointerMarks(marks, before, after);
    expect(next).toHaveLength(1);
    expect(next[0].target).toEqual(pointer("rain", "path", "notes/b.md"));
    // The mark's own unknown keys follow the record, never dropped.
    expect(next[0].extra).toEqual({ rank: 3 });
    expect(serializeMarks(next)).toBe(
      '{"kind":"open","on":"rain","path":"notes/b.md","rank":3}\n',
    );
    // The old address no longer carries the mark.
    expect(hasMark(next, "open", pointer("rain", "path", "notes/a.md"))).toBe(false);
  });

  test("a form edit follows the form byte-exactly", () => {
    const before = pointerRecord("rain", "url", "https://x");
    const after = pointerRecord("rain", "at", "/home/k/x");
    const next = retargetPointerMarks([open(pointer("rain", "url", "https://x"))], before, after);
    expect(next.map((mark) => mark.target)).toEqual([pointer("rain", "at", "/home/k/x")]);
    expect(serializeMarks(next)).toBe(
      '{"at":"/home/k/x","kind":"open","on":"rain"}\n',
    );
  });

  test("the app's move is the survivor when the new key already carried one", () => {
    const before = pointerRecord("rain", "path", "notes/a.md");
    const after = pointerRecord("rain", "path", "notes/b.md");
    const marks = [
      open(pointer("rain", "path", "notes/a.md"), { who: "edited" }),
      open(pointer("rain", "path", "notes/b.md"), { who: "collided" }),
    ];
    const next = retargetPointerMarks(marks, before, after);
    expect(next).toHaveLength(1);
    expect(next[0].extra).toEqual({ who: "edited" });
  });

  test("a markless edit is a no-op returning the same list", () => {
    const before = pointerRecord("rain", "path", "notes/a.md");
    const after = pointerRecord("rain", "path", "notes/b.md");
    const marks = [open(pointer("rain", "path", "notes/b.md"))];
    expect(retargetPointerMarks(marks, before, after)).toEqual(marks);
  });

  test("edit-convergence: the dropped line's mark lands on the same key", () => {
    // B is dropped by the edit, and B's mark names the key the edited line now
    // holds — so the reach stays marked, one line, the edited line's record.
    const marks = [
      open(pointer("rain", "path", "notes/b.md")),
      open(pointer("rain", "path", "notes/a.md"), { who: "edited" }),
    ];
    const before = pointerRecord("rain", "path", "notes/a.md");
    const after = pointerRecord("rain", "path", "notes/b.md");
    const next = retargetPointerMarks(marks, before, after);
    expect(next).toHaveLength(1);
    expect(next[0].target).toEqual(pointer("rain", "path", "notes/b.md"));
    expect(next[0].extra).toEqual({ who: "edited" });
  });
});

describe("a mark dies with its pointer line", () => {
  const one = pointerRecord("rain", "path", "notes/a.md");
  const two = pointerRecord("rain", "url", "https://x");
  const marks = [
    open(pointer("rain", "path", "notes/a.md")),
    open(pointer("rain", "url", "https://x")),
    open(word("rain")),
  ];

  test("removing one line drops only that line's mark", () => {
    const next = dropPointerMarksAt(marks, one);
    expect(next.map((mark) => mark.target)).toEqual([
      pointer("rain", "url", "https://x"),
      word("rain"),
    ]);
    expect(dropPointerMarksAt(marks, two)).toHaveLength(2);
  });

  test("removing the owner drops every pointer mark on it, word marks stay", () => {
    const next = dropPointerMarksTouching(marks, "rain");
    expect(next.map((mark) => mark.target)).toEqual([word("rain")]);
    expect(dropPointerMarksTouching(marks, "sea")).toEqual(marks);
  });

  test("a rename rewrites the mark's owner copy", () => {
    const next = rewritePointerMarkOwners(marks, "rain", "storm");
    // The collision rule emits untouched marks first, rewritten ones last (the
    // app's move is the survivor); a word mark is the word batch's, not ours.
    expect(next.map((mark) => mark.target)).toEqual([
      word("rain"),
      pointer("storm", "path", "notes/a.md"),
      pointer("storm", "url", "https://x"),
    ]);
    expect(next.map((mark) => mark.target.type)).toContain("pointer");
  });

  test("a pointer mark whose line is gone is an orphan, surfaced not repaired", () => {
    const onLine = open(pointer("rain", "path", "notes/a.md"));
    const gone = open(pointer("rain", "path", "notes/gone.md"));
    const keys = new Set([pointerKey("rain", "path", "notes/a.md")]);
    expect(
      findOrphanMarks(
        [onLine, gone],
        new Set(["rain"]),
        new Set([distanceKey("a", "b", "c")]),
        new Set([linkKey("a", "b")]),
        keys,
      ),
    ).toEqual([gone]);
  });

  test("a hand-duplicated pointer mark key is preserved at read, collapsed on write", () => {
    const line = serializeMarkLine(open(pointer("rain", "path", "notes/a.md")));
    const parsed = parseMarks(line + "\n" + line);
    expect(parsed.marks).toHaveLength(2);
    expect(serializeMarks(parsed.marks)).toBe(line + "\n");
    // A cast on the key rewrites the one line (last write wins).
    const recast = withMark(parsed.marks, open(pointer("rain", "path", "notes/a.md"), { n: 1 }));
    expect(recast).toHaveLength(1);
    expect(recast[0].extra).toEqual({ n: 1 });
  });
});
