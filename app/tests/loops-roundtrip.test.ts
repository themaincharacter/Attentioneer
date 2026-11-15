import { describe, expect, test } from "bun:test";
import {
  canonicalPath,
  dedupeLoops,
  findLoop,
  isClosedPath,
  loopKey,
  loopKeys,
  loopSlug,
  nameLoop,
  parseLoopLine,
  parseLoops,
  removeLoop,
  renameLoop,
  serializeLoopLine,
  serializeLoops,
  uniqueLoopName,
  unusedLoopSlugs,
  type Loop,
} from "../src/map/loops";

/**
 * Story-3 guarantee, automated: `map/loops.jsonl` round-trips canonically —
 * one line per coined loop, its closed slug cycle ROTATION-CANONICALIZED (the
 * smallest slug first, direction preserved, closure kept). A reversed cycle is
 * a different line; an unclosed hand edit is never repaired; unknown keys and
 * malformed lines are preserved; a missing file means no loops.
 */

const NL = "\n";

function loop(
  name: string,
  path: string[],
  extra: Record<string, unknown> = {},
): Loop {
  return { name, path, extra };
}

describe("the path's canonical rotation", () => {
  test("the smallest slug comes first, direction and closure kept", () => {
    // The tick's example: authored soil -> plant -> rain stores plant first.
    expect(canonicalPath(["soil", "plant", "rain", "soil"])).toEqual([
      "plant",
      "rain",
      "soil",
      "plant",
    ]);
    expect(canonicalPath(["b", "c", "a", "b"])).toEqual(["a", "b", "c", "a"]);
  });

  test("a reversed cycle is a different canonical line", () => {
    const forward = canonicalPath(["soil", "plant", "rain", "soil"]);
    const reverse = canonicalPath(["soil", "rain", "plant", "soil"]);
    expect(reverse).toEqual(["plant", "soil", "rain", "plant"]);
    expect(reverse).not.toEqual(forward);
    // Neither is the other rotated: direction is content.
    expect(forward[1]).toBe("rain");
    expect(reverse[1]).toBe("soil");
  });

  test("closure is kept and the first slug is repeated at the end", () => {
    const canonical = canonicalPath(["c", "a", "b", "c"]);
    expect(canonical[0]).toBe("a");
    expect(canonical[canonical.length - 1]).toBe("a");
    expect(isClosedPath(canonical)).toBe(true);
  });

  test("a self-loop stays a self-loop", () => {
    expect(canonicalPath(["a", "a"])).toEqual(["a", "a"]);
    expect(canonicalPath(["a"])).toEqual(["a"]);
    expect(canonicalPath([])).toEqual([]);
  });

  test("it is idempotent: canonicalizing twice changes nothing", () => {
    for (const path of [
      ["soil", "plant", "rain", "soil"],
      ["a", "b", "a", "c", "a"],
      ["z", "a", "m", "z"],
      ["a", "a"],
    ]) {
      const once = canonicalPath(path);
      expect(canonicalPath(once)).toEqual(once);
    }
  });

  test("a repeated smallest slug resolves deterministically (smallest rotation)", () => {
    // 'a' occurs twice in the body; the lexicographically smallest rotation wins.
    expect(canonicalPath(["a", "b", "a", "c", "a"])).toEqual([
      "a",
      "b",
      "a",
      "c",
      "a",
    ]);
    expect(canonicalPath(["a", "c", "a", "b", "a"])).toEqual([
      "a",
      "b",
      "a",
      "c",
      "a",
    ]);
  });

  test("an unclosed path is never repaired or rotated (rotation would change its walks)", () => {
    expect(canonicalPath(["c", "a", "b"])).toEqual(["c", "a", "b"]);
    expect(serializeLoopLine(loop("half", ["c", "a", "b"]))).toBe(
      '{"name":"half","path":["c","a","b"]}',
    );
  });

  test("the smallest slug is first in the written line", () => {
    const line = serializeLoopLine(loop("rain loop", ["soil", "plant", "rain", "soil"]));
    expect(line).toBe(
      '{"name":"rain loop","path":["plant","rain","soil","plant"]}',
    );
  });
});

describe("the loop line's canonical bytes", () => {
  test("compact, sorted keys, name then path", () => {
    expect(serializeLoopLine(loop("rain loop", ["a", "b", "a"]))).toBe(
      '{"name":"rain loop","path":["a","b","a"]}',
    );
  });

  test("a loop's line is its name and path only — no verdict is ever stored", () => {
    const loops = nameLoop([], "rain loop", ["a", "b", "a"]);
    const bytes = serializeLoops(loops);
    expect(bytes).not.toContain("reinforcing");
    expect(bytes).not.toContain("balancing");
    expect(JSON.parse(bytes.trim())).toEqual({
      name: "rain loop",
      path: ["a", "b", "a"],
    });
  });

  test("the first write is one canonical line with a trailing newline", () => {
    expect(serializeLoops([loop("rain loop", ["a", "b", "a"])])).toBe(
      '{"name":"rain loop","path":["a","b","a"]}' + NL,
    );
    // Re-reading and re-writing the file is byte-stable.
    const once = serializeLoops([loop("rain loop", ["plant", "rain", "soil", "plant"])]);
    expect(serializeLoops(parseLoops(once).loops)).toBe(once);
  });

  test("unknown keys survive a rewrite, sorting alongside the record's", () => {
    const parsed = parseLoopLine(
      serializeLoopLine(loop("rain loop", ["a", "b", "a"], { note: "why", rank: 2 })),
    )!;
    expect(parsed.extra).toEqual({ note: "why", rank: 2 });
    expect(serializeLoopLine(parsed)).toBe(
      '{"name":"rain loop","note":"why","path":["a","b","a"],"rank":2}',
    );
  });

  test("unicode names round-trip byte-for-byte", () => {
    const l = loop("想法 — a loop", ["a", "b", "a"]);
    expect(serializeLoopLine(parseLoopLine(serializeLoopLine(l))!)).toBe(
      serializeLoopLine(l),
    );
  });

  test("an empty loops document is the canonical empty JSONL (one newline)", () => {
    expect(serializeLoops([])).toBe(NL);
    expect(parseLoops(serializeLoops([])).loops).toEqual([]);
  });
});

describe("tolerant read of the loops file", () => {
  test("blank lines, CRLF, a BOM and terminating newlines are tolerated", () => {
    const parsed = parseLoops(
      '\uFEFF{"name":"rain loop","path":["a","b","a"]}\r\n\r\n',
    );
    expect(parsed.malformed).toEqual([]);
    expect(parsed.loops).toEqual([loop("rain loop", ["a", "b", "a"])]);
  });

  test("a missing file is no loops (the loader's null maps to this parse)", () => {
    expect(parseLoops("")).toEqual({ loops: [], malformed: [] });
    expect(parseLoops(NL)).toEqual({ loops: [], malformed: [] });
  });

  test("malformed and out-of-shape lines surface verbatim, never dropped", () => {
    const text = [
      "{bad json}",
      "[1,2,3]",
      '{"path":["a","b","a"]}', // no name
      '{"name":"","path":["a","b","a"]}', // an empty coin is not a loop
      '{"name":"x"}', // no path
      '{"name":"x","path":"a"}', // path is not an array
      '{"name":"x","path":["a",1,"a"]}', // a slug must be a string
      '{"name":"x","path":["a","","a"]}', // nor empty
      '{"name":"rain loop","path":["a","b","a"]}',
    ].join(NL);
    const parsed = parseLoops(text);
    expect(parsed.loops).toEqual([loop("rain loop", ["a", "b", "a"])]);
    expect(parsed.malformed).toHaveLength(8);
    expect(parsed.malformed[0]).toBe("{bad json}");
    // Malformed lines are re-emitted byte-identically, after the known lines.
    const written = serializeLoops(parsed.loops, parsed.malformed);
    expect(written).toContain("{bad json}" + NL);
    expect(written).toContain('{"name":"x","path":"a"}' + NL);
  });

  test("an unclosed and an empty path are records, not malformed (the read names them)", () => {
    const parsed = parseLoops(
      [
        '{"name":"open","path":["a","b","c"]}',
        '{"name":"empty","path":[]}',
      ].join(NL),
    );
    expect(parsed.malformed).toEqual([]);
    expect(parsed.loops[0].path).toEqual(["a", "b", "c"]);
    expect(parsed.loops[1].path).toEqual([]);
  });

  test("a hand-edited known line comes back canonical", () => {
    const parsed = parseLoops('{ "path": ["c","a","b","c"], "name": "rain loop" }');
    expect(parsed.malformed).toEqual([]);
    expect(serializeLoops(parsed.loops)).toBe(
      '{"name":"rain loop","path":["a","b","c","a"]}' + NL,
    );
  });
});

describe("the natural key is the name-derived slug", () => {
  test("slugName rules apply and loops are their own namespace", () => {
    expect(loopSlug("Rain Loop!")).toBe("rain-loop");
    expect(loopKey(loop("rain loop", ["a", "b", "a"]))).toBe("rain-loop");
    // A slug reads as the same key (find-a-loop by either form).
    expect(loopSlug("rain-loop")).toBe("rain-loop");
  });

  test("a duplicate coin mints the numeric suffix in the name, never a hidden field", () => {
    expect(uniqueLoopName("rain loop", new Set())).toBe("rain loop");
    expect(uniqueLoopName("rain loop", new Set(["rain-loop"]))).toBe("rain loop 2");
    expect(uniqueLoopName("rain loop", new Set(["rain-loop", "rain-loop-2"]))).toBe(
      "rain loop 3",
    );
    // The suffixed name still slugifies to the suffixed slug.
    expect(loopSlug("rain loop 2")).toBe("rain-loop-2");
  });

  test("hand-duplicated keys collapse to one line, last write wins", () => {
    const text = serializeLoops([
      loop("rain loop", ["a", "b", "a"], { rank: 1 }),
      loop("rain loop", ["a", "c", "a"], { rank: 2 }),
    ]);
    expect(text.split(NL).filter(Boolean)).toHaveLength(1);
    const parsed = parseLoops(text);
    expect(parsed.loops).toHaveLength(1);
    expect(parsed.loops[0].path).toEqual(["a", "c", "a"]);
    expect(parsed.loops[0].extra).toEqual({ rank: 2 });
  });

  test("findLoop matches a name or its slug", () => {
    const loops = [loop("rain loop", ["a", "b", "a"])];
    expect(findLoop(loops, "rain loop")).not.toBeNull();
    expect(findLoop(loops, "rain-loop")).not.toBeNull();
    expect(findLoop(loops, "other")).toBeNull();
    expect([...loopKeys(loops)]).toEqual(["rain-loop"]);
    expect(dedupeLoops(loops)).toHaveLength(1);
  });
});

describe("naming a loop", () => {
  test("appends one line with a canonical path", () => {
    const loops = nameLoop([], "rain loop", ["soil", "plant", "rain", "soil"]);
    expect(loops).toEqual([
      { name: "rain loop", path: ["plant", "rain", "soil", "plant"], extra: {} },
    ]);
  });

  test("an empty or whitespace coin writes nothing", () => {
    expect(nameLoop([], "   ", ["a", "b", "a"])).toEqual([]);
    expect(nameLoop([], "", ["a", "b", "a"])).toEqual([]);
  });

  test("a colliding coin is suffixed so both lines keep distinct keys", () => {
    const first = nameLoop([], "rain loop", ["a", "b", "a"]);
    const both = nameLoop(first, "rain loop", ["b", "c", "b"]);
    expect(both).toHaveLength(2);
    expect(both[1].name).toBe("rain loop 2");
    expect(loopKey(both[1])).toBe("rain-loop-2");
    // The original coin is untouched.
    expect(both[0].name).toBe("rain loop");
  });

  test("the self-loop and 2-cycle a path gesture produces are legal records", () => {
    const selfLoop = nameLoop([], "self", ["a", "a"]);
    expect(selfLoop[0].path).toEqual(["a", "a"]);
    const twoCycle = nameLoop(selfLoop, "two", ["a", "b", "a"]);
    expect(twoCycle[1].path).toEqual(["a", "b", "a"]);
  });
});

describe("renaming a loop rewrites its one line in place", () => {
  test("name and key change; path bytes and unknown keys stay, at the same index", () => {
    const loops = [
      loop("rain loop", ["plant", "rain", "plant"], { rank: 1 }),
      loop("soil loop", ["a", "b", "a"]),
    ];
    const next = renameLoop(loops, loops[0], "weather loop");
    expect(next[0]).toEqual(
      loop("weather loop", ["plant", "rain", "plant"], { rank: 1 }),
    );
    expect(next[1]).toBe(loops[1]);
    expect(serializeLoops(next).split(NL)[0]).toBe(
      '{"name":"weather loop","path":["plant","rain","plant"],"rank":1}',
    );
  });

  test("a colliding rename mints the suffix and never merges lines", () => {
    const loops = [
      loop("rain loop", ["a", "b", "a"]),
      loop("soil loop", ["a", "c", "a"]),
    ];
    const next = renameLoop(loops, loops[1], "rain loop");
    expect(next).toHaveLength(2);
    expect(next[1].name).toBe("rain loop 2");
    expect(loopKey(next[0])).toBe("rain-loop");
    expect(loopKey(next[1])).toBe("rain-loop-2");
  });

  test("an empty name, the same name or an unknown loop is a quiet no-op", () => {
    const loops = [loop("rain loop", ["a", "b", "a"])];
    expect(renameLoop(loops, loops[0], "  ")).toEqual(loops);
    expect(renameLoop(loops, loops[0], "rain loop")).toEqual(loops);
    expect(renameLoop(loops, loop("ghost", ["a", "b", "a"]), "new")).toEqual(loops);
  });

  test("a case-only rename keeps the key and one line", () => {
    const loops = [loop("Rain Loop", ["a", "b", "a"])];
    const next = renameLoop(loops, loops[0], "RAIN LOOP");
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("RAIN LOOP");
    expect(loopKey(next[0])).toBe("rain-loop");
  });
});

describe("removing a loop is ammo", () => {
  test("only that line goes (by loop or by slug)", () => {
    const loops = [
      loop("rain loop", ["a", "b", "a"]),
      loop("soil loop", ["a", "c", "a"]),
    ];
    expect(removeLoop(loops, loops[0])).toEqual([loops[1]]);
    expect(removeLoop(loops, "soil loop")).toEqual([loops[0]]);
    expect(removeLoop(loops, "rain-loop")).toEqual([loops[1]]);
    expect(removeLoop(loops, "nope")).toEqual(loops);
  });
});

describe("loops naming a missing word surface (no validation, no repair)", () => {
  test("the unknown slugs are collected, deduped, in no particular order promise", () => {
    const loops = [
      loop("one", ["a", "gone", "a"]),
      loop("two", ["a", "b", "gone", "a"]),
      loop("three", ["a", "b", "a"]),
    ];
    expect(unusedLoopSlugs(loops, new Set(["a", "b"]))).toEqual(["gone"]);
    expect(unusedLoopSlugs(loops, new Set(["a", "b", "gone"]))).toEqual([]);
  });

  test("an orphan path survives an unrelated rewrite byte-for-byte", () => {
    const orphan = serializeLoopLine(loop("one", ["a", "gone", "a"]));
    const parsed = parseLoops(orphan);
    expect(serializeLoops(parsed.loops)).toBe(orphan + NL);
  });
});
