import { describe, expect, test } from "bun:test";
import type { Quantity } from "../src/map/quantities";
import { stepRun, type StepModel, type StepRun } from "../src/map/step";

/**
 * The step's GATE MATRIX, enumerated (ADR-0022, Epic 8 story 3). Each ignored
 * piece is SKIPPED AND SAID, and unknown never becomes 0: a flow with no
 * amount, a stock with no amount (its outflows gated), two lines on one pair,
 * out-of-play pieces, and a self-flow that moves nothing. The matrix is
 * exercised over the ACTIVE model's quantities in FILE ORDER — the same order
 * the model's record carries.
 *
 * The other half of the story is the step's semantics: ONE simultaneous step
 * from the opening amounts (no receipt-before-send), file-order clamping that
 * is loud and step-scoped, the outside named where a stock line is absent, and
 * the notes' file order.
 */

function stock(on: string, amount: number | null = null): Quantity {
  return { type: "stock", on, amount, extra: {} };
}

function flow(from: string, to: string, amount: number | null = null): Quantity {
  return { type: "flow", from, to, amount, extra: {} };
}

function run(quantities: Quantity[], words: string[] | null): StepRun {
  const model: StepModel = { words, quantities, links: [] };
  return stepRun(model, null);
}

function kinds(result: StepRun): string[] {
  return result.notes.map((note) => note.kind);
}

describe("an unknown flow amount is skipped and said", () => {
  test("the flow with no amount does not move and the note names it", () => {
    const result = run([stock("soil", 4), stock("plant", 0), flow("soil", "plant")], [
      "soil",
      "plant",
    ]);
    expect(result.notes).toEqual([
      { kind: "unknown-flow", from: "soil", to: "plant" },
    ]);
    expect(result.amounts.get("soil")).toBe(4);
    expect(result.amounts.get("plant")).toBe(0);
    expect(result.lastDelta.size).toBe(0);
  });

  test("the unknown flow is said on EVERY crank, not once", () => {
    const model: StepModel = {
      words: ["soil", "plant"],
      quantities: [stock("soil", 4), stock("plant", 0), flow("soil", "plant")],
      links: [],
    };
    const first = stepRun(model, null);
    const second = stepRun(model, first);
    expect(kinds(second)).toEqual(["unknown-flow"]);
    // The step did not invent a transfer between the two cranks.
    expect(second.amounts.get("soil")).toBe(4);
  });
});

describe("a stock with no amount gates its outflows, said", () => {
  test("the outflow does not move and the note names stock and flow", () => {
    const result = run(
      [stock("soil"), stock("plant", 0), flow("soil", "plant", 3)],
      ["soil", "plant"],
    );
    expect(result.notes).toEqual([
      { kind: "unknown-stock-outflow", on: "soil", to: "plant" },
    ]);
    // Unknown stays UNKNOWN: never 0, and no transfer was invented.
    expect(result.amounts.get("soil")).toBeNull();
    expect(result.amounts.get("plant")).toBe(0);
    expect(result.lastDelta.size).toBe(0);
  });

  test("every outflow of the unknown stock is gated and said, in file order", () => {
    const result = run(
      [
        stock("soil"),
        stock("air", 0),
        stock("plant", 0),
        flow("soil", "air", 2),
        flow("soil", "plant", 3),
      ],
      ["soil", "air", "plant"],
    );
    expect(result.notes).toEqual([
      { kind: "unknown-stock-outflow", on: "soil", to: "air" },
      { kind: "unknown-stock-outflow", on: "soil", to: "plant" },
    ]);
    expect(result.lastDelta.size).toBe(0);
  });

  test("an arrival into an unknown stock is said and the amount stays unknown", () => {
    const result = run(
      [stock("plant", 3), stock("soil"), flow("plant", "soil", 2)],
      ["plant", "soil"],
    );
    expect(result.notes).toEqual([
      { kind: "unknown-arrival", on: "soil", amount: 2 },
    ]);
    expect(result.amounts.get("plant")).toBe(1);
    expect(result.amounts.get("soil")).toBeNull();
    expect(result.lastDelta.get("plant")).toBe(-2);
  });
});

describe("duplicate lines are content, never a guess", () => {
  test("two flow lines on one pair gate that flow", () => {
    const result = run(
      [
        stock("soil", 4),
        stock("plant", 0),
        flow("soil", "plant", 3),
        flow("soil", "plant", 2),
      ],
      ["soil", "plant"],
    );
    // ONE note for the pair, however many lines carry it: no double move.
    expect(result.notes).toEqual([
      { kind: "duplicate-flow", from: "soil", to: "plant" },
    ]);
    expect(result.amounts.get("soil")).toBe(4);
    expect(result.amounts.get("plant")).toBe(0);
    expect(result.lastDelta.size).toBe(0);
  });

  test("two stock lines gate the stock's outflows and are never guessed", () => {
    const result = run(
      [
        stock("soil", 4),
        stock("soil", 5),
        stock("plant", 0),
        flow("soil", "plant", 3),
      ],
      ["soil", "plant"],
    );
    expect(result.notes).toEqual([{ kind: "duplicate-stock", on: "soil" }]);
    expect(result.amounts.get("soil")).toBeNull();
    expect(result.amounts.get("plant")).toBe(0);
    expect(result.lastDelta.size).toBe(0);
  });

  test("a duplicated flow is gated even when one line's amount is unknown", () => {
    const result = run(
      [
        stock("soil", 4),
        stock("plant", 0),
        flow("soil", "plant"),
        flow("soil", "plant", 2),
      ],
      ["soil", "plant"],
    );
    expect(kinds(result)).toEqual(["duplicate-flow"]);
    expect(result.lastDelta.size).toBe(0);
  });
});

describe("out-of-play pieces are skipped and said", () => {
  test("a stock and every flow touching a word outside the set", () => {
    const result = run(
      [
        stock("soil", 4),
        stock("rain", 2),
        flow("rain", "plant", 3),
        flow("soil", "rain", 1),
        stock("plant", 0),
      ],
      ["soil", "plant"],
    );
    expect(result.notes).toEqual([
      { kind: "out-of-play-stock", on: "rain" },
      { kind: "out-of-play-flow", from: "rain", to: "plant" },
      { kind: "out-of-play-flow", from: "soil", to: "rain" },
    ]);
    // The out-of-play stock has no running amount at all: it is not a piece.
    expect(result.amounts.has("rain")).toBe(false);
    expect(result.amounts.get("soil")).toBe(4);
    expect(result.lastDelta.size).toBe(0);
  });

  test("an accepted EMPTY set puts everything out of play (not the no-set reading)", () => {
    const result = run([stock("soil", 4)], []);
    expect(result.notes).toEqual([{ kind: "out-of-play-stock", on: "soil" }]);
    expect(result.amounts.size).toBe(0);
  });

  test("NO accepted set moves nothing and says so, once", () => {
    const result = run(
      [stock("soil", 4), stock("plant", 0), flow("soil", "plant", 3)],
      null,
    );
    expect(result.notes).toEqual([{ kind: "no-set" }]);
    expect(result.amounts.size).toBe(0);
    expect(result.lastDelta.size).toBe(0);
  });
});

describe("a self-flow moves nothing and is said", () => {
  test("the pair's line is named and the stock is untouched", () => {
    const result = run([stock("soil", 4), flow("soil", "soil", 3)], ["soil"]);
    expect(result.notes).toEqual([{ kind: "self-flow", on: "soil" }]);
    expect(result.amounts.get("soil")).toBe(4);
    expect(result.lastDelta.size).toBe(0);
  });
});

describe("one simultaneous step, file order serves, the clamp is loud", () => {
  test("outflows are served in FILE ORDER and the note names stock/flow/shortfall", () => {
    const result = run(
      [
        stock("soil", 4),
        stock("plant", 0),
        stock("air", 0),
        flow("soil", "plant", 3),
        flow("soil", "air", 3),
      ],
      ["soil", "plant", "air"],
    );
    // soil→plant (first) takes 3; soil→air asks 3 and is served only 1.
    expect(result.notes).toEqual([
      {
        kind: "clamp",
        on: "soil",
        from: "soil",
        to: "air",
        gave: 1,
        asked: 3,
      },
    ]);
    expect(result.amounts.get("soil")).toBe(0);
    expect(result.amounts.get("plant")).toBe(3);
    expect(result.amounts.get("air")).toBe(1);
    expect(result.lastDelta.get("soil")).toBe(-4);
    expect(result.lastDelta.get("plant")).toBe(3);
    expect(result.lastDelta.get("air")).toBe(1);
  });

  test("reversing the lines reverses who is short (file order is the tiebreak)", () => {
    const result = run(
      [
        stock("soil", 4),
        stock("plant", 0),
        stock("air", 0),
        flow("soil", "air", 3),
        flow("soil", "plant", 3),
      ],
      ["soil", "plant", "air"],
    );
    expect(result.notes).toEqual([
      {
        kind: "clamp",
        on: "soil",
        from: "soil",
        to: "plant",
        gave: 1,
        asked: 3,
      },
    ]);
    expect(result.amounts.get("air")).toBe(3);
    expect(result.amounts.get("plant")).toBe(1);
  });

  test("the notes are in FILE ORDER", () => {
    const result = run(
      [
        stock("soil", 2),
        stock("air", 0),
        stock("plant", 0),
        flow("soil", "air", 3),
        flow("soil", "plant", 3),
      ],
      ["soil", "air", "plant"],
    );
    expect(
      result.notes.map((note) => (note.kind === "clamp" ? note.to : note.kind)),
    ).toEqual(["air", "plant"]);
  });

  test("NO receipt-before-send: an inflow never funds an outflow in the same step", () => {
    const result = run(
      [
        stock("soil", 5),
        stock("plant", 0),
        flow("soil", "plant", 5),
        flow("plant", "soil", 5),
      ],
      ["soil", "plant"],
    );
    // plant receives 5 this step but sends from its OPENING 0: the clamp is
    // loud, and plant ends at 5 rather than passing the receipt on.
    expect(result.notes).toEqual([
      {
        kind: "clamp",
        on: "plant",
        from: "plant",
        to: "soil",
        gave: 0,
        asked: 5,
      },
    ]);
    expect(result.amounts.get("plant")).toBe(5);
    // soil spent its opening 5 and the receipt it made was 0 (plant sent from
    // its opening): the net is -5, and plant kept the 5 it received.
    expect(result.amounts.get("soil")).toBe(0);
    expect(result.lastDelta.get("soil")).toBe(-5);
    expect(result.lastDelta.get("plant")).toBe(5);
  });

  test("the clamp note is STEP-SCOPED: the next crank states its own", () => {
    const model: StepModel = {
      words: ["soil", "plant", "air"],
      quantities: [
        stock("soil", 4),
        stock("plant", 0),
        stock("air", 0),
        flow("soil", "plant", 3),
        flow("soil", "air", 3),
      ],
      links: [],
    };
    const first = stepRun(model, null);
    expect(first.notes).toEqual([
      { kind: "clamp", on: "soil", from: "soil", to: "air", gave: 1, asked: 3 },
    ]);
    // soil is empty now: the second crank's own notes say so, and the first
    // crank's note is gone (each crank states its own).
    const second = stepRun(model, first);
    expect(second.notes).toEqual([
      { kind: "clamp", on: "soil", from: "soil", to: "plant", gave: 0, asked: 3 },
      { kind: "clamp", on: "soil", from: "soil", to: "air", gave: 0, asked: 3 },
    ]);
    expect(second.amounts.get("soil")).toBe(0);
  });

  test("a stock that recovers can serve again on the next crank", () => {
    const model: StepModel = {
      words: ["soil", "plant", "rain"],
      quantities: [
        stock("soil", 4),
        stock("plant", 0),
        flow("soil", "plant", 3),
        flow("rain", "soil", 4),
      ],
      links: [],
    };
    const first = stepRun(model, null);
    // soil: 4 - 3 + 4 = 5, plant 3.
    expect(first.amounts.get("soil")).toBe(5);
    expect(first.lastDelta.get("soil")).toBe(1);
    expect(first.lastDelta.get("plant")).toBe(3);
    expect(first.notes.map((note) => note.kind)).toEqual(["outside-source"]);
  });
});

describe("flows never test the loop read (the layers do not cross-validate)", () => {
  test("a flow over a pair with no link still moves its full amount", () => {
    const model: StepModel = {
      words: ["soil", "plant"],
      quantities: [stock("soil", 4), stock("plant", 0), flow("soil", "plant", 3)],
      links: [],
    };
    const result = stepRun(model, null);
    expect(result.amounts.get("plant")).toBe(3);
    expect(result.notes).toEqual([]);
  });

  test("a sign flip changes no amount: the step never reads a sign", () => {
    const quantities = [
      stock("soil", 4),
      stock("plant", 0),
      flow("soil", "plant", 3),
    ];
    const plus = stepRun(
      {
        words: ["soil", "plant"],
        quantities,
        links: [{ from: "soil", to: "plant", sign: "+", extra: {} }],
      },
      null,
    );
    const minus = stepRun(
      {
        words: ["soil", "plant"],
        quantities,
        links: [{ from: "soil", to: "plant", sign: "-", extra: {} }],
      },
      null,
    );
    expect(minus.amounts.get("plant")).toBe(plus.amounts.get("plant"));
    expect(minus.notes).toEqual(plus.notes);
  });
});

describe("the outside is named", () => {
  test("a source with no stock line draws from the world, unbounded", () => {
    const result = run(
      [stock("soil", 0), flow("rain", "soil", 5)],
      ["rain", "soil"],
    );
    expect(result.notes).toEqual([
      { kind: "outside-source", from: "rain", to: "soil", amount: 5 },
    ]);
    expect(result.amounts.get("soil")).toBe(5);
    expect(result.lastDelta.get("soil")).toBe(5);
  });

  test("a target with no stock line drains to the world, unbounded", () => {
    const result = run(
      [stock("soil", 4), flow("soil", "air", 2)],
      ["soil", "air"],
    );
    expect(result.notes).toEqual([
      { kind: "outside-sink", from: "soil", to: "air", amount: 2 },
    ]);
    expect(result.amounts.get("soil")).toBe(2);
    expect(result.lastDelta.get("soil")).toBe(-2);
  });

  test("the world is never clamped: two outflows from it both give in full", () => {
    const result = run(
      [stock("soil", 0), stock("air", 0), flow("rain", "soil", 5), flow("rain", "air", 5)],
      ["rain", "soil", "air"],
    );
    expect(result.notes.map((note) => note.kind)).toEqual([
      "outside-source",
      "outside-source",
    ]);
    expect(result.amounts.get("soil")).toBe(5);
    expect(result.amounts.get("air")).toBe(5);
  });

  test("the world to the world moves nothing observable and is said", () => {
    const result = run([flow("rain", "air", 5)], ["rain", "air"]);
    expect(result.notes).toEqual([
      { kind: "world-to-world", from: "rain", to: "air", amount: 5 },
    ]);
    expect(result.amounts.size).toBe(0);
    expect(result.lastDelta.size).toBe(0);
  });
});
