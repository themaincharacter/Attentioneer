import { describe, expect, test } from "bun:test";
import {
  addPointer,
  convergePointerEdit,
  findDuplicatePointers,
  findOrphanPointers,
  findPointers,
  isPointerForm,
  parsePointerLine,
  parsePointers,
  pointerKey,
  pointerKeyOf,
  pointersPath,
  removePointerAt,
  serializePointerLine,
  serializePointers,
  type Pointer,
  type PointerForm,
} from "../src/map/pointers";

/**
 * Story-1 guarantee, automated: `map/pointers.jsonl` round-trips canonically
 * with the THREE AUTHORED forms (ADR-0017, amended), keeps unknown keys,
 * preserves malformed and unknown-form lines verbatim, tolerates missing and
 * empty files, and holds the natural-key rules — several pointers per
 * reference, the byte-exact re-statement, replace-in-place at the line's
 * index, edit-convergence, and an `at` reach that dangles honestly without
 * ever being repaired.
 */

const path = (on: string, value: string, extra = {}): Pointer => ({
  on,
  form: "path",
  value,
  extra,
});

function ptr(on: string, form: PointerForm, value: string): Pointer {
  return { on, form, value, extra: {} };
}

describe("the pointer line, one canonical form per authored form", () => {
  test("path, at and url serialize as one compact sorted line", () => {
    expect(serializePointerLine(path("rain", "notes/x.md"))).toBe(
      '{"on":"rain","path":"notes/x.md"}',
    );
    expect(serializePointerLine(ptr("rain", "at", "/home/k/notes/x.md"))).toBe(
      '{"at":"/home/k/notes/x.md","on":"rain"}',
    );
    expect(
      serializePointerLine(ptr("rain", "url", "https://example.org/a?b=c")),
    ).toBe('{"on":"rain","url":"https://example.org/a?b=c"}');
  });

  test("all three forms round-trip byte-for-byte", () => {
    const pointers = [
      path("rain", "notes/my x.md"),
      ptr("rain", "at", "/home/kickapookid/projects/x.md"),
      ptr("rain", "url", "mailto:someone@example.org"),
    ];
    for (const original of pointers) {
      const line = serializePointerLine(original);
      const parsed = parsePointerLine(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.on).toBe(original.on);
      expect(parsed!.form).toBe(original.form);
      expect(parsed!.value).toBe(original.value);
      expect(serializePointerLine(parsed!)).toBe(line);
    }
  });

  test("the FORM is the authored key, never sniffed from the value", () => {
    // A path that looks absolute stays a workspace-relative path.
    const absoluteLookingPath = parsePointerLine(
      '{"on":"rain","path":"/etc/hosts"}',
    )!;
    expect(absoluteLookingPath.form).toBe("path");
    // An at value that looks relative stays machine-local.
    const relativeLookingAt = parsePointerLine(
      '{"at":"notes/x.md","on":"rain"}',
    )!;
    expect(relativeLookingAt.form).toBe("at");
    // A url needs no scheme; any string is stored verbatim.
    expect(parsePointerLine('{"on":"rain","url":"x"}')!.value).toBe("x");
    expect(isPointerForm("path")).toBe(true);
    expect(isPointerForm("at")).toBe(true);
    expect(isPointerForm("url")).toBe(true);
    expect(isPointerForm("ftp")).toBe(false);
    expect(isPointerForm("")).toBe(false);
  });

  test("unknown keys on a known pointer survive a rewrite", () => {
    const original = path("rain", "notes/x.md", { note: "why", rank: 3 });
    const line = serializePointerLine(original);
    const parsed = parsePointerLine(line)!;
    expect(parsed.extra).toEqual({ note: "why", rank: 3 });
    expect(serializePointerLine(parsed)).toBe(line);
  });

  test("the same value under two forms is two different lines", () => {
    const asPath = path("rain", "/etc/hosts");
    const asAt = ptr("rain", "at", "/etc/hosts");
    expect(pointerKeyOf(asPath)).not.toBe(pointerKeyOf(asAt));
    expect(pointerKey("rain", "path", "x")).not.toBe(pointerKey("rain", "at", "x"));
    expect(pointerKey("rain", "url", "x")).not.toBe(pointerKey("sea", "url", "x"));
  });
});

describe("tolerant read of the pointers file", () => {
  test("missing or empty file means no pointers", () => {
    expect(parsePointers("")).toEqual({
      pointers: [],
      malformed: [],
      duplicates: [],
    });
    expect(parsePointers("\n\n")).toEqual({
      pointers: [],
      malformed: [],
      duplicates: [],
    });
    expect(pointersPath("/w")).toBe("/w/map/pointers.jsonl");
    expect(serializePointers([])).toBe("\n");
  });

  test("CRLF and a BOM are tolerated", () => {
    const parsed = parsePointers(
      '\uFEFF{"on":"a","path":"x"}\r\n{"at":"/y","on":"a"}\r\n',
    );
    expect(parsed.malformed).toEqual([]);
    expect(parsed.pointers.map((pointer) => pointer.form)).toEqual([
      "path",
      "at",
    ]);
  });

  test("malformed and unknown-form lines surface, never guessed or dropped", () => {
    const text = [
      "{bad json}",
      "[1,2]",
      '"a string"',
      '{"on":"a"}',
      '{"path":"x"}',
      '{"on":"","path":"x"}',
      '{"on":"a","path":""}',
      '{"on":"a","path":2}',
      '{"on":"a","path":"x","url":"y"}',
      // An unknown form key is preserved and surfaced, never repaired into one
      // of the three forms (the vocabulary is provisional, ADR-0017 rule 2).
      '{"ftp":"x","on":"a"}',
      '{"on":"a","path":"notes/good.md"}',
    ].join("\n");
    const parsed = parsePointers(text);
    expect(parsed.pointers).toHaveLength(1);
    expect(parsed.pointers[0].form).toBe("path");
    expect(parsed.malformed).toHaveLength(10);
    expect(parsed.malformed[0]).toBe("{bad json}");
  });

  test("malformed lines are re-emitted verbatim through a save", () => {
    const parsed = parsePointers(
      '{"bad line\n{"on":"a","path":"x"}\n{another bad',
    );
    expect(parsed.pointers).toHaveLength(1);
    const bytes = serializePointers(parsed.pointers, parsed.malformed);
    expect(bytes).toBe('{"on":"a","path":"x"}\n{"bad line\n{another bad\n');
  });
});

describe("the natural key names one pointer", () => {
  test("several pointers per reference, in file order", () => {
    let list: Pointer[] = [];
    list = addPointer(list, "rain", "path", "notes/a.md");
    list = addPointer(list, "rain", "url", "https://example.org");
    list = addPointer(list, "rain", "at", "/home/k/x.md");
    expect(list).toHaveLength(3);
    expect(list.map((pointer) => pointer.form)).toEqual(["path", "url", "at"]);
    expect(serializePointers(list)).toBe(
      [
        '{"on":"rain","path":"notes/a.md"}',
        '{"on":"rain","url":"https://example.org"}',
        '{"at":"/home/k/x.md","on":"rain"}',
        "",
      ].join("\n"),
    );
    expect(findPointers(list, "rain").map((found) => found.index)).toEqual([
      0, 1, 2,
    ]);
  });

  test("a byte-exact re-statement rewrites its one line, never a second", () => {
    const once = addPointer([], "rain", "path", "notes/a.md");
    const twice = addPointer(once, "rain", "path", "notes/a.md");
    expect(twice).toHaveLength(1);
    expect(serializePointers(twice)).toBe(serializePointers(once));
  });

  test("a blank target or a blank owner writes nothing", () => {
    expect(addPointer([], "rain", "path", "")).toEqual([]);
    expect(addPointer([], "rain", "path", "   ")).toEqual([]);
    expect(addPointer([], "", "path", "x")).toEqual([]);
    // The value is stored verbatim: spaces inside it are the person's.
    const list = addPointer([], "rain", "path", "notes/my file.md");
    expect(list[0].value).toBe("notes/my file.md");
  });

  test("an edit replaces the line IN PLACE at its index", () => {
    const list = [
      path("rain", "notes/a.md", { rank: 1 }),
      path("rain", "notes/b.md"),
      path("sea", "notes/c.md"),
    ];
    const edited = convergePointerEdit(list, 0, "at", "/home/k/a.md");
    expect(edited.dropped).toEqual([]);
    expect(edited.pointers).toHaveLength(3);
    expect(edited.pointers[0].form).toBe("at");
    expect(edited.pointers[0].value).toBe("/home/k/a.md");
    // The edited line keeps its unknown keys; the others are untouched.
    expect(edited.pointers[0].extra).toEqual({ rank: 1 });
    expect(edited.pointers[1]).toBe(list[1]);
    expect(edited.pointers[2]).toBe(list[2]);
  });

  test("edit-convergence drops the colliding line; the edited one survives", () => {
    const list = [
      path("rain", "notes/a.md", { rank: 1 }),
      ptr("sea", "url", "x"),
      path("rain", "notes/b.md", { rank: 2 }),
    ];
    const edited = convergePointerEdit(list, 0, "path", "notes/b.md");
    expect(edited.dropped).toEqual([list[2]]);
    expect(edited.pointers).toHaveLength(2);
    expect(edited.pointers[0]).toEqual(path("rain", "notes/b.md", { rank: 1 }));
    expect(edited.pointers[1]).toBe(list[1]);
    expect(serializePointers(edited.pointers)).toBe(
      '{"on":"rain","path":"notes/b.md","rank":1}\n{"on":"sea","url":"x"}\n',
    );
  });

  test("an unknown index or a blank value is a quiet no-op", () => {
    const list = [path("rain", "notes/a.md")];
    expect(convergePointerEdit(list, 9, "at", "/x").pointers).toEqual(list);
    expect(convergePointerEdit(list, -1, "at", "/x").pointers).toEqual(list);
    expect(convergePointerEdit(list, 0, "at", "  ").pointers).toEqual(list);
    expect(convergePointerEdit(list, 0, "at", "  ").dropped).toEqual([]);
  });

  test("removing a line by index leaves its siblings' bytes untouched", () => {
    const list = [
      path("rain", "a"),
      path("rain", "b", { rank: 7 }),
      path("sea", "c"),
    ];
    const next = removePointerAt(list, 1);
    expect(next.map((pointer) => pointer.value)).toEqual(["a", "c"]);
    expect(serializePointers(next)).toBe(
      '{"on":"rain","path":"a"}\n{"on":"sea","path":"c"}\n',
    );
  });
});

describe("hand-duplicated keys are preserved and surfaced", () => {
  test("the read keeps both lines; the duplicate is named", () => {
    const line = serializePointerLine(path("rain", "notes/a.md"));
    const parsed = parsePointers(line + "\n" + line + "\n");
    expect(parsed.pointers).toHaveLength(2);
    expect(parsed.duplicates).toHaveLength(1);
    expect(findDuplicatePointers(parsed.pointers)).toHaveLength(1);
    // A write never silently collapses a hand edit (the read rule).
    expect(serializePointers(parsed.pointers)).toBe(line + "\n" + line + "\n");
  });
});

describe("an at reach dangles honestly", () => {
  const dangling = ptr("rain", "at", "/nonexistent/machine/only.md");

  test("the read and the write preserve it byte-for-byte", () => {
    const bytes = serializePointers([dangling]);
    expect(parsePointers(bytes).pointers[0]).toEqual(dangling);
    expect(serializePointers(parsePointers(bytes).pointers)).toBe(bytes);
  });

  test("an unrelated write leaves it exactly as it was", () => {
    const before = serializePointers([dangling]);
    const after = addPointer([dangling], "rain", "url", "https://example.org");
    expect(serializePointers(after)).toBe(
      before + '{"on":"rain","url":"https://example.org"}\n',
    );
  });

  test("the owner is checked; the TARGET is never stat'd or repaired", () => {
    // The target may not exist on this machine and still not be an orphan.
    expect(
      findOrphanPointers([dangling], new Set(["rain"])),
    ).toEqual([]);
    expect(findOrphanPointers([dangling], new Set(["sea"]))).toEqual([
      dangling,
    ]);
  });
});
