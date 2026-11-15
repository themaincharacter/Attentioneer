import { describe, expect, test } from "bun:test";
import {
  addAssumption,
  parseAssumptions,
  serializeAssumptionLine,
  type Assumption,
  type AssumptionTarget,
} from "../src/map/assumptions";
import {
  committedAssumptionKeys,
  danglingPins,
  dropPinLinkTargets,
  dropPinLoopTargets,
  dropPinWordTargets,
  parsePins,
  pinDangles,
  pinIsOnLink,
  pinTargetsLoop,
  pinTouchesWord,
  pinsFromAssumptions,
  pinsPath,
  rewritePinLoopTargets,
  rewritePinWordTargets,
  serializePins,
} from "../src/scenarios/pins";

/**
 * Epic 8 story 2's pins (ADR-0021 decision 2), automated: branching a model
 * pins EVERY committed assumption line, and a pin DANGLES when no exact
 * (target, text) match is left in the committed file.
 *
 * The predicate is pure and lives on this side of the app; the PRESENTATION of
 * a dangle is story 4's, so nothing here renders. The three ways a pin loses
 * its ground are pinned as three tests:
 *
 *   - the claim's text was edited;
 *   - the claim was removed;
 *   - the claim's target died in a hand edit.
 *
 * The fourth way a pin could lose its address — the app's own rename/remove —
 * is NOT a dangle: the batch rewrites the target, or drops the pin.
 */

function claim(text: string, target: AssumptionTarget): Assumption {
  return { text, target, extra: {} };
}

function onWord(text: string, slug: string): Assumption {
  return claim(text, { type: "word", slug });
}

function onLink(text: string, from: string, to: string): Assumption {
  return claim(text, { type: "link", from, to });
}

function onLoop(text: string, slug: string): Assumption {
  return claim(text, { type: "loop", slug });
}

function onSpot(text: string, x: number, y: number): Assumption {
  return claim(text, { type: "spot", x, y });
}

describe("a branch pins every committed claim, all-or-none", () => {
  const text = [
    '{"on":"soil","text":"rain feeds it"}',
    '{"from":"rain","to":"soil","text":"the pair holds"}',
    '{"loop":"weather","text":"it repeats"}',
    '{"text":"the spot is quiet","x":4,"y":-2}',
    // A hand-duplicated key: the file keeps both lines, so the branch pins both.
    '{"on":"soil","text":"rain feeds it"}',
    // An unknown key rides along.
    '{"extra":1,"on":"soil","text":"a rival claim"}',
  ].join("\n");

  test("every line is pinned, in file order, multiplicity and extras included", () => {
    const parsed = parseAssumptions(text);
    const pins = pinsFromAssumptions(parsed.assumptions);
    expect(pins).toHaveLength(6);
    expect(pins[0]).toEqual(onWord("rain feeds it", "soil"));
    expect(pins[1]).toEqual(onLink("the pair holds", "rain", "soil"));
    expect(pins[2]).toEqual(onLoop("it repeats", "weather"));
    expect(pins[3]).toEqual(onSpot("the spot is quiet", 4, -2));
    // The duplicate is a second pin, not a deduplicated digest.
    expect(pins[4]).toEqual(onWord("rain feeds it", "soil"));
    // The unknown key is the pin's too.
    expect(parsed.assumptions[5].extra).toEqual({ extra: 1 });
    expect(pins[5].extra).toEqual({ extra: 1 });
    expect(pins[5].target).toEqual({ type: "word", slug: "soil" });
  });

  test("a pins file round-trips as canonical JSONL, malformed lines verbatim", () => {
    const lines = serializePins(
      [onWord("rain feeds it", "soil"), onLink("the pair holds", "a", "b")],
      ["{broken"],
    );
    expect(lines).toBe(
      [
        '{"on":"soil","text":"rain feeds it"}',
        '{"from":"a","text":"the pair holds","to":"b"}',
        "{broken",
        "",
      ].join("\n"),
    );
    const reparsed = parsePins(lines);
    expect(reparsed.pins).toHaveLength(2);
    expect(reparsed.malformed).toEqual(["{broken"]);
  });

  test("the pins live in the branch's own folder, not map/", () => {
    expect(pinsPath("/w/scenarios/evening")).toBe(
      "/w/scenarios/evening/assumption-pins.jsonl",
    );
  });
});

describe("THE dangle predicate: no exact (target, text) match", () => {
  const committed = [
    onWord("rain feeds it", "soil"),
    onLink("the pair holds", "rain", "soil"),
    onLoop("it repeats", "weather"),
    onSpot("the spot is quiet", 4, -2),
  ];
  const pins = pinsFromAssumptions(committed);
  const keys = committedAssumptionKeys(committed);

  test("a pin standing on an untouched claim does not dangle", () => {
    expect(danglingPins(pins, committed)).toEqual([]);
    expect(pinDangles(pins[0], keys)).toBe(false);
    // File order and repetition are not part of the address.
    expect(danglingPins([pins[2], pins[0]], committed)).toEqual([]);
    expect(pinDangles(pins[3], keys)).toBe(false);
  });

  test("EDIT: the claim's text changed under the pin — it dangles", () => {
    const edited = [onWord("rain really feeds it", "soil"), ...committed.slice(1)];
    expect(danglingPins([pins[0]], edited)).toEqual([pins[0]]);
  });

  test("the text must match EXACTLY (no trim, no case folding)", () => {
    expect(
      danglingPins([onWord("rain feeds it ", "soil")], committed),
    ).toHaveLength(1);
    expect(
      danglingPins([onWord("Rain feeds it", "soil")], committed),
    ).toHaveLength(1);
    // ...and an unknown key is not part of the address: a hand edit that only
    // adds a key does not dangle the pin.
    const withExtra: Assumption = { ...committed[0], extra: { extra: 9 } };
    expect(danglingPins([pins[0]], [withExtra])).toEqual([]);
  });

  test("REMOVAL: the claim is gone — the pin dangles", () => {
    const removed = committed.filter((assumption) => assumption !== committed[0]);
    expect(danglingPins([pins[0]], removed)).toEqual([pins[0]]);
    // A vanished spot line dangles its pin like any other removal (a spot is
    // its own target, not an orphan).
    expect(danglingPins([pins[3]], [])).toEqual([pins[3]]);
  });

  test("TARGET DEATH: the claim moved to another word — the pin dangles", () => {
    const moved = [onWord("rain feeds it", "mulch"), ...committed.slice(1)];
    expect(danglingPins(pins, moved)).toEqual([pins[0]]);
    // A loop target renamed by a hand edit on the FILE (not the app's batch).
    const loopRenamed = [onLoop("it repeats", "climate"), ...committed.slice(0, 2)];
    expect(danglingPins([pins[2]], loopRenamed)).toEqual([pins[2]]);
  });

  test("one missing ground dangles one pin, never the others", () => {
    const partial = [committed[0], committed[3]];
    expect(danglingPins(pins, partial)).toEqual([pins[1], pins[2]]);
  });
});

describe("the app's own moves never dangle a pin (they rewrite or drop it)", () => {
  const pins = [
    onWord("rain feeds it", "soil"),
    onLink("the pair holds", "rain", "soil"),
    onLink("the reverse runs", "soil", "rain"),
    onLoop("it repeats", "weather"),
    onSpot("the spot is quiet", 4, -2),
  ];

  test("a RENAME rewrites the pin's target, never its text", () => {
    const renamed = rewritePinWordTargets(pins, "soil", "mulch");
    expect(renamed).toEqual([
      onWord("rain feeds it", "mulch"),
      onLink("the pair holds", "rain", "mulch"),
      onLink("the reverse runs", "mulch", "rain"),
      onLoop("it repeats", "weather"),
      onSpot("the spot is quiet", 4, -2),
    ]);
    // The address changed; the claim did not.
    expect(renamed.map((pin) => pin.text)).toEqual(pins.map((pin) => pin.text));
  });

  test("a rename that lands on an existing pin keeps the app's line last", () => {
    // A hand-edited pin already sits on the new key: the app's rewrite is the
    // survivor (the committed file's collision rule).
    const before = [
      onWord("rain feeds it", "mulch"),
      onWord("rain feeds it", "soil"),
    ];
    const after = rewritePinWordTargets(before, "soil", "mulch");
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(onWord("rain feeds it", "mulch"));
  });

  test("renaming to the same slug, or with nothing touching, is a quiet copy", () => {
    expect(rewritePinWordTargets(pins, "soil", "soil")).toEqual(pins);
    expect(rewritePinWordTargets(pins, "nothing", "elsewhere")).toEqual(pins);
  });

  test("a LOOP rename rewrites the loop target, and only it", () => {
    expect(rewritePinLoopTargets(pins, "weather", "climate")).toEqual([
      pins[0],
      pins[1],
      pins[2],
      onLoop("it repeats", "climate"),
      pins[4],
    ]);
    expect(rewritePinLoopTargets(pins, "weather", "weather")).toEqual(pins);
  });

  test("a REMOVE drops the touching pins — die-with-target everywhere", () => {
    // The word's own pins and the pins on its links.
    expect(dropPinWordTargets(pins, "soil")).toEqual([
      onLoop("it repeats", "weather"),
      onSpot("the spot is quiet", 4, -2),
    ]);
    // The ordered pair only — the reverse pair's pin stays.
    expect(dropPinLinkTargets(pins, "rain", "soil")).toEqual([
      pins[0],
      pins[2],
      pins[3],
      pins[4],
    ]);
    // One loop or a batch.
    expect(dropPinLoopTargets(pins, "weather")).toEqual([
      pins[0],
      pins[1],
      pins[2],
      pins[4],
    ]);
    expect(dropPinLoopTargets(pins, ["weather", "nothing"])).toEqual([
      pins[0],
      pins[1],
      pins[2],
      pins[4],
    ]);
    expect(dropPinLoopTargets(pins, [])).toEqual(pins);
  });

  test("the touching predicates the folder steps read", () => {
    expect(pinTouchesWord(pins[0], "soil")).toBe(true);
    expect(pinTouchesWord(pins[1], "soil")).toBe(true);
    expect(pinTouchesWord(pins[3], "weather")).toBe(false);
    expect(pinIsOnLink(pins[1], "rain", "soil")).toBe(true);
    expect(pinIsOnLink(pins[2], "rain", "soil")).toBe(false);
    expect(pinTargetsLoop(pins[3], "weather")).toBe(true);
    expect(pinTargetsLoop(pins[0], "weather")).toBe(false);
  });

  test("a stated rival dangles no pin; the batch's rename keeps them green", () => {
    // Stating a claim about an existing target (a rival) dangles no pin.
    let committed = [onWord("rain feeds it", "soil")];
    const pinned = pinsFromAssumptions(committed);
    committed = addAssumption(committed, "a rival", { type: "word", slug: "soil" });
    expect(danglingPins(pinned, committed)).toEqual([]);
    // ...and after the app's rename, every folder's rewritten pin stands on the
    // committed file's rewritten target: the batch never manufactures a dangle.
    const renamedCommitted = committed.map((assumption) =>
      assumption.target.type === "word" && assumption.target.slug === "soil"
        ? { ...assumption, target: { type: "word" as const, slug: "mulch" } }
        : assumption,
    );
    const renamedPins = rewritePinWordTargets(pinned, "soil", "mulch");
    expect(danglingPins(renamedPins, renamedCommitted)).toEqual([]);
  });
});

describe("the pin's canonical line", () => {
  test("a pins line is the assumptions grammar, canonically spelled", () => {
    expect(serializeAssumptionLine(onWord("rain feeds it", "soil"))).toBe(
      '{"on":"soil","text":"rain feeds it"}',
    );
    expect(serializePins([])).toBe("\n");
    expect(parsePins(null)).toEqual({ pins: [], malformed: [] });
  });
});
