import { describe, expect, test } from "bun:test";
import { parseNote, serializeNote, slugify, type Note } from "../src/lib/notes";
import { canonicalYaml, parseYamlFields } from "../src/lib/serialize";

/**
 * The story-4 guarantee, automated: prose survives the note round-trip
 * byte-for-byte. `parseNote(serializeNote(n))` must be the identity on the
 * fields the user wrote — no trimming, no newline normalization, no key loss.
 */

function note(over: Partial<Note> = {}): Note {
  return {
    id: "t",
    slug: "t",
    title: "t",
    x: 0,
    y: 0,
    body: "",
    extra: {},
    ...over,
  };
}

function roundTrip(n: Note): Note {
  return parseNote(n.id, n.slug, serializeNote(n));
}

describe("note round-trip is byte-for-byte", () => {
  const bodies: string[] = [
    "",
    "\n",
    "plant in march",
    "line one\nline two\n\nline four\n",
    "trailing spaces   \n\ttabbed line\n",
    "---\nthis body only looks like frontmatter\n---\n",
    '"quoted" and \\backslashes\\ and `ticks`',
    "unicode — 想法 ✨ ünïcode",
    "ends without newline",
    "ends with three newlines\n\n\n",
  ];
  for (const body of bodies) {
    test(`body ${JSON.stringify(body)}`, () => {
      expect(roundTrip(note({ body })).body).toBe(body);
    });
  }

  test("title with quotes and backslashes", () => {
    expect(roundTrip(note({ title: 'say "hi" \\ ok' })).title).toBe('say "hi" \\ ok');
  });

  test("float positions round-trip exactly", () => {
    const n = roundTrip(note({ x: 250.33333333333334, y: -12.000000000000002 }));
    expect(n.x).toBe(250.33333333333334);
    expect(n.y).toBe(-12.000000000000002);
  });

  test("unknown frontmatter keys survive a rewrite", () => {
    const n = roundTrip(note({ body: "x", extra: { status: "draft", rank: 3 } }));
    expect(n.extra).toEqual({ status: "draft", rank: 3 });
    expect(serializeNote(n)).toBe(serializeNote(roundTrip(n)));
  });

  test("serialization is canonical and stable", () => {
    const once = serializeNote(note({ title: "b", x: 1, y: 2, body: "z" }));
    expect(serializeNote(parseNote("t", "t", once))).toBe(once);
    expect(once).toBe('---\ntitle: "b"\nx: 1\ny: 2\n---\nz');
  });
});

describe("tolerant read of hand-edited files", () => {
  test("BOM + CRLF file still parses, body keeps its bytes", () => {
    const text =
      '\uFEFF---\r\ntitle: "from notepad"\r\nx: 5\r\ny: 6\r\n---\r\nbody line one\r\nline two\r\n';
    const n = parseNote("t", "t", text);
    expect(n.title).toBe("from notepad");
    expect(n.x).toBe(5);
    expect(n.body).toBe("body line one\r\nline two\r\n");
  });

  test("file without frontmatter keeps its text as the body", () => {
    const n = parseNote("t", "t", "just prose\n");
    expect(n.title).toBe("");
    expect(n.body).toBe("just prose\n");
    expect(n.extra).toEqual({});
  });

  test("unquoted and malformed scalars never throw", () => {
    expect(parseYamlFields("title: my note\nx: 5")).toEqual({ title: "my note", x: 5 });
    expect(parseYamlFields('title: "a: colon"\nstatus: "dangling')).toEqual({
      title: "a: colon",
      status: '"dangling',
    });
    expect(parseYamlFields("no-colon-line\n: no-key")).toEqual({});
  });

  test("canonicalYaml sorts keys and quotes strings", () => {
    expect(canonicalYaml({ y: 2, title: "t", x: 1 })).toBe('title: "t"\nx: 1\ny: 2\n');
  });
});

describe("slugs stay file-safe", () => {
  test("slugify", () => {
    expect(slugify("Garden Thoughts!")).toBe("garden-thoughts");
    expect(slugify("   ")).toBe("untitled");
    expect(slugify("想法")).toBe("untitled");
  });
});
