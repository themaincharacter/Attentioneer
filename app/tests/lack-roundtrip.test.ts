import { describe, expect, test } from "bun:test";
import {
  parseMarks,
  retargetMark,
  serializeMarks,
  withMark,
  withoutMark,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import { rewriteMarkEndpoints } from "../src/map/patches";
import {
  parseReference,
  serializeReference,
  type Reference,
} from "../src/map/refs";

/**
 * Story-2 record guarantee, automated: the felt lack's whole life — cast a
 * bare spot, name it (grow), bind it to a word, rename that word, drag it off
 * to a bare spot again, and withdraw it — writes exactly one canonical line at
 * every step, and the file reopens byte-for-byte (ADR-0009; the story check's
 * "quit/reopen — every mark line exact", minus the human gestures).
 */

const spot = (x: number, y: number): MarkTarget => ({ type: "spot", x, y });
const word = (slug: string): MarkTarget => ({ type: "word", slug });

/** Serialize, reparse, and confirm the bytes are canonical and stable. */
function reopen(marks: readonly Mark[]): { text: string; marks: Mark[] } {
  const text = serializeMarks(marks);
  const parsed = parseMarks(text);
  expect(parsed.malformed).toEqual([]);
  expect(serializeMarks(parsed.marks)).toBe(text);
  return { text, marks: parsed.marks };
}

function coin(name: string, slug: string, x: number, y: number): Reference {
  return { id: slug, slug, name, x, y, body: "", extra: {} };
}

describe("the felt lack's record, step by step", () => {
  test("cast: one bare spot line, exactly", () => {
    const cast = withMark([], { kind: "open", target: spot(210, 205), extra: {} });
    const { text, marks } = reopen(cast);
    expect(text).toBe('{"kind":"open","x":210,"y":205}\n');
    expect(marks).toHaveLength(1);
    expect(marks[0].target).toEqual(spot(210, 205));
  });

  test("grow: the word is coined at the spot and the spot line becomes an on line", () => {
    const cast = [withMark([], { kind: "open", target: spot(210, 205), extra: {} })[0]];
    const question = coin("why does rain reach soil?", "why-does-rain-reach-soil", 210, 205);

    // The grown reference's file round-trips byte-for-byte (ADR-0005).
    const file = serializeReference(question);
    const reopenedRef = parseReference(question.id, question.slug, file);
    expect(serializeReference(reopenedRef)).toBe(file);
    expect(reopenedRef.name).toBe(question.name);
    expect(reopenedRef.x).toBe(210);
    expect(reopenedRef.y).toBe(205);

    // The mark's address moves onto the coined slug — one line, one write.
    const next = retargetMark(cast, spot(210, 205), word("why-does-rain-reach-soil"));
    const { text, marks } = reopen(next);
    expect(text).toBe('{"kind":"open","on":"why-does-rain-reach-soil"}\n');
    expect(marks).toHaveLength(1);
  });

  test("bind: dragging the ring onto a word keeps exactly one line", () => {
    const grows = retargetMark(
      [withMark([], { kind: "open", target: spot(210, 205), extra: {} })[0]],
      spot(210, 205),
      word("why"),
    );
    const bound = retargetMark(grows, word("why"), word("rain"));
    const { text, marks } = reopen(bound);
    expect(text).toBe('{"kind":"open","on":"rain"}\n');
    expect(marks).toHaveLength(1);
  });

  test("rename: the bound mark follows the word's new slug", () => {
    const bound = retargetMark(
      [withMark([], { kind: "open", target: spot(1, 2), extra: {} })[0]],
      spot(1, 2),
      word("rain"),
    );
    const renamed = rewriteMarkEndpoints(bound, "rain", "earth");
    const { text, marks } = reopen(renamed);
    expect(text).toBe('{"kind":"open","on":"earth"}\n');
    expect(marks[0].target).toEqual(word("earth"));
  });

  test("unbind: dragging the ring off leaves one bare spot at the drop point", () => {
    const bound = [withMark([], { kind: "open", target: word("rain"), extra: {} })[0]];
    const bare = retargetMark(bound, word("rain"), spot(480.25, 120));
    const { text, marks } = reopen(bare);
    expect(text).toBe('{"kind":"open","x":480.25,"y":120}\n');
    expect(marks[0].target).toEqual(spot(480.25, 120));
  });

  test("withdraw: the line goes, and the empty file reopens as no marks", () => {
    const bare = [withMark([], { kind: "open", target: spot(1, 2), extra: {} })[0]];
    const settled = withoutMark(bare, "open", spot(1, 2));
    const parsed = parseMarks(serializeMarks(settled));
    expect(parsed.marks).toEqual([]);
    expect(parsed.malformed).toEqual([]);
  });
});
