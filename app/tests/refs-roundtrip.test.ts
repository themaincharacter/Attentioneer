import { describe, expect, test } from "bun:test";
import { parseReference, serializeReference, type Reference } from "../src/map/refs";
import { canonicalYaml, parseYamlFields, slugName } from "../src/lib/serialize";

/**
 * Story-1 guarantee, automated: a reference's memory round-trips byte-for-byte
 * and its slug keeps unicode letters/digits (ADR-0005) instead of collapsing
 * non-Latin names to `untitled`.
 */

function reference(over: Partial<Reference> = {}): Reference {
  return {
    id: "t",
    slug: "t",
    name: "t",
    x: 0,
    y: 0,
    body: "",
    extra: {},
    ...over,
  };
}

function roundTrip(r: Reference): Reference {
  return parseReference(r.id, r.slug, serializeReference(r));
}

describe("reference round-trip is byte-for-byte", () => {
  const bodies = [
    "",
    "\n",
    "a remembered thing",
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
      expect(roundTrip(reference({ body })).body).toBe(body);
    });
  }

  test("name with quotes and backslashes", () => {
    expect(roundTrip(reference({ name: 'say "hi" \\ ok' })).name).toBe('say "hi" \\ ok');
  });

  test("float positions round-trip exactly", () => {
    const r = roundTrip(reference({ x: 250.33333333333334, y: -12.000000000000002 }));
    expect(r.x).toBe(250.33333333333334);
    expect(r.y).toBe(-12.000000000000002);
  });

  test("unknown frontmatter keys survive a rewrite", () => {
    const r = roundTrip(reference({ body: "x", extra: { status: "draft", rank: 3 } }));
    expect(r.extra).toEqual({ status: "draft", rank: 3 });
    expect(serializeReference(r)).toBe(serializeReference(roundTrip(r)));
  });

  test("serialization is canonical and stable", () => {
    const once = serializeReference(reference({ name: "b", x: 1, y: 2, body: "z" }));
    expect(serializeReference(parseReference("t", "t", once))).toBe(once);
    expect(once).toBe('---\nname: "b"\nx: 1\ny: 2\n---\nz');
  });
});

describe("tolerant read of hand-edited files", () => {
  test("BOM + CRLF file still parses, body keeps its bytes", () => {
    const text =
      '\uFEFF---\r\nname: "from notepad"\r\nx: 5\r\ny: 6\r\n---\r\nbody line one\r\nline two\r\n';
    const r = parseReference("t", "t", text);
    expect(r.name).toBe("from notepad");
    expect(r.x).toBe(5);
    expect(r.body).toBe("body line one\r\nline two\r\n");
  });

  test("file without frontmatter keeps its text as the body", () => {
    const r = parseReference("t", "t", "just prose\n");
    expect(r.name).toBe("");
    expect(r.body).toBe("just prose\n");
    expect(r.extra).toEqual({});
  });

  test("canonicalYaml sorts keys and quotes strings", () => {
    expect(canonicalYaml({ y: 2, name: "t", x: 1 })).toBe('name: "t"\nx: 1\ny: 2\n');
    expect(parseYamlFields("name: my word\nx: 5")).toEqual({ name: "my word", x: 5 });
  });
});

describe("slugs follow ADR-0005", () => {
  test("unicode letters/digits kept, case-folded, others become dashes", () => {
    expect(slugName("Garden Thoughts!")).toBe("garden-thoughts");
    expect(slugName("想法")).toBe("想法");
    expect(slugName("Grüße 2024")).toBe("grüße-2024");
    expect(slugName("ÉLAN-VITAL")).toBe("élan-vital");
    expect(slugName("   ")).toBe("untitled");
  });
});