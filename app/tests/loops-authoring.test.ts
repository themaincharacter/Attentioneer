import { describe, expect, test } from "bun:test";
import {
  beginPathSession,
  clickPathWord,
  endPathSession,
  loopNameFromCoin,
  pathIsClosed,
  type PathSession,
} from "../src/canvas/loopAuthoring";
import { nameLoop, serializeLoops } from "../src/map/loops";

/**
 * Story-3 authoring rules, pure and DOM-free (ADR-0016 decision 4): while the
 * `path` gate is armed a click collects a word IN ORDER, and clicking the first
 * word again closes the cycle — a 2-cycle is A, B, A; a self-loop is A, A.
 * Esc cancels everything and nothing is written; the coin field's blank name
 * writes nothing either. The closed path reaches `nameLoop` in click order.
 */

/** Click a list of words from a fresh session, returning the session. */
function click(words: string[], start: PathSession = beginPathSession()): PathSession {
  return words.reduce((session, slug) => clickPathWord(session, slug), start);
}

describe("collecting a path", () => {
  test("a fresh session collects nothing and is still collecting", () => {
    const session = beginPathSession();
    expect(session.kind).toBe("collecting");
    expect(session.path).toEqual([]);
  });

  test("clicks keep their order, word for word", () => {
    const session = click(["soil", "plant", "rain"]);
    expect(session.kind).toBe("collecting");
    expect(session.path).toEqual(["soil", "plant", "rain"]);
  });

  test("every click produces a new session (the old one is untouched)", () => {
    const first = beginPathSession();
    const second = clickPathWord(first, "a");
    expect(first.path).toEqual([]);
    expect(second.path).toEqual(["a"]);
    expect(second).not.toBe(first);
  });
});

describe("closing the cycle", () => {
  test("clicking the first word again closes a 2-cycle: A, B, A", () => {
    const session = click(["a", "b", "a"]);
    expect(session.kind).toBe("naming");
    expect(session.path).toEqual(["a", "b", "a"]);
    expect(pathIsClosed(session)).toBe(true);
  });

  test("a self-loop is one word, clicked twice: A, A", () => {
    const session = click(["a", "a"]);
    expect(session.kind).toBe("naming");
    expect(session.path).toEqual(["a", "a"]);
    expect(pathIsClosed(session)).toBe(true);
  });

  test("a 3-cycle closes at its start in click order", () => {
    const session = click(["c", "a", "b", "c"]);
    expect(session.path).toEqual(["c", "a", "b", "c"]);
    expect(pathIsClosed(session)).toBe(true);
  });

  test("a click after the path closed is inert (the coin field is asking)", () => {
    const closed = click(["a", "b", "a"]);
    const after = clickPathWord(closed, "c");
    expect(after).toBe(closed);
  });

  test("closing is only on the FIRST word: re-clicking a later word appends", () => {
    const session = click(["a", "b", "b"]);
    expect(session.kind).toBe("collecting");
    expect(session.path).toEqual(["a", "b", "b"]);
  });
});

describe("cancelling writes nothing", () => {
  test("Esc ends the session entirely and the path is gone", () => {
    const session = click(["a", "b"]);
    expect(session.path.length).toBeGreaterThan(0);
    expect(endPathSession()).toBeNull();
  });

  test("a collecting session is not a record (pathIsClosed refuses it)", () => {
    expect(pathIsClosed(click(["a", "b"]))).toBe(false);
    expect(pathIsClosed(beginPathSession())).toBe(false);
  });

  test("a blank coin writes nothing (only the person names a loop)", () => {
    expect(loopNameFromCoin("")).toBeNull();
    expect(loopNameFromCoin("   ")).toBeNull();
    expect(loopNameFromCoin("  rain loop  ")).toBe("rain loop");
  });
});

describe("a closed session becomes one canonical record", () => {
  test("the record keeps the click order (then rotates canonically on write)", () => {
    const session = click(["soil", "plant", "rain", "soil"]);
    expect(session.path).toEqual(["soil", "plant", "rain", "soil"]);
    const loops = nameLoop([], loopNameFromCoin("rain loop")!, session.path);
    expect(loops[0].name).toBe("rain loop");
    expect(loops[0].path).toEqual(["plant", "rain", "soil", "plant"]);
    expect(serializeLoops(loops)).toBe(
      '{"name":"rain loop","path":["plant","rain","soil","plant"]}' + "\n",
    );
  });

  test("a self-loop session writes its closed two-slug path", () => {
    const session = click(["a", "a"]);
    const loops = nameLoop([], "self", session.path);
    expect(loops[0].path).toEqual(["a", "a"]);
  });
});
