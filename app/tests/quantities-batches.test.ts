import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  dropQuantitiesTouching,
  rewriteQuantityEndpoints,
} from "../src/map/patches";
import {
  quantityKey,
  serializeQuantities,
  type Quantity,
} from "../src/map/quantities";

/**
 * Story-1's batch guarantee, automated (ADR-0020 decision 3): a reference
 * rename rewrites a stock line's `on` and a flow line's `from`/`to`, and a
 * reference remove drops every line touching the word (die-with-target). The
 * AMOUNT and the unknown keys are never rewritten — a rename changes the
 * address, never the number — and a collision on the new key resolves to the
 * app's rewritten line (the assumptions rule), so the batch never leaves a
 * duplicate behind.
 *
 * The two steps sit at the FAMILY POSITION, which this suite reads from the
 * source the app runs: after assumptions, before pointers (the documented
 * write order grew before the pointers' step). Nothing here joins or scopes.
 */

function stock(
  on: string,
  amount: number | null = null,
  extra: Record<string, unknown> = {},
): Quantity {
  return { type: "stock", on, amount, extra };
}

function flow(
  from: string,
  to: string,
  amount: number | null = null,
  extra: Record<string, unknown> = {},
): Quantity {
  return { type: "flow", from, to, amount, extra };
}

const patchesSource = readFileSync(
  new URL("../src/map/patches.ts", import.meta.url),
  "utf8",
);

/** The source text of one exported async function in the module. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("a rename rewrites on/from/to and never the amount", () => {
  test("a stock line's on follows the word; amount and extras ride along", () => {
    const records = [
      stock("old", 12, { note: "why" }),
      stock("other", 3),
      flow("a", "b", 1),
    ];
    const out = rewriteQuantityEndpoints(records, "old", "new");
    expect(out).toEqual([
      stock("new", 12, { note: "why" }),
      records[1],
      records[2],
    ]);
    // Untouched lines are the same records (not copies).
    expect(out[1]).toBe(records[1]);
    expect(serializeQuantities(out)).toContain('{"amount":12,"note":"why","on":"new"}');
  });

  test("a flow line's from and to follow, in place and order-stable", () => {
    const records = [
      flow("old", "b", 2, { rank: 1 }),
      flow("c", "old", 3),
      flow("old", "old", 0),
    ];
    expect(rewriteQuantityEndpoints(records, "old", "new")).toEqual([
      flow("new", "b", 2, { rank: 1 }),
      flow("c", "new", 3),
      flow("new", "new", 0),
    ]);
  });

  test("a stock on the old slug is not confused with a word spelled in a flow", () => {
    const records = [flow("a", "b", 4)];
    expect(rewriteQuantityEndpoints(records, "a", "z")).toEqual([
      flow("z", "b", 4),
    ]);
    expect(rewriteQuantityEndpoints(records, "b", "z")).toEqual([
      flow("a", "z", 4),
    ]);
  });

  test("an unchanged slug is a quiet no-op", () => {
    const records = [stock("a", 1), flow("a", "b", 2)];
    const out = rewriteQuantityEndpoints(records, "a", "a");
    expect(out).toEqual(records);
    expect(out).not.toBe(records);
  });

  test("an untouched orphan on the new key loses to the app's rewritten line", () => {
    const orphan = stock("new", 99, { from: "orphan" });
    const renamed = stock("old", 5, { from: "app" });
    const out = rewriteQuantityEndpoints([orphan, renamed], "old", "new");
    expect(out).toEqual([stock("new", 5, { from: "app" })]);
    expect(out[0].extra).toEqual({ from: "app" });
  });

  test("two rewritten lines landing on one key resolve to the later one", () => {
    const first = stock("old", 1, { rank: "first" });
    const later = stock("old", 2, { rank: "later" });
    const out = rewriteQuantityEndpoints([first, later], "old", "new");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(stock("new", 2, { rank: "later" }));
  });

  test("no line touches the old slug afterwards", () => {
    const out = rewriteQuantityEndpoints(
      [stock("old", 1), flow("old", "b", 2), flow("c", "old", 3)],
      "old",
      "new",
    );
    for (const quantity of out) {
      const words =
        quantity.type === "stock" ? [quantity.on] : [quantity.from, quantity.to];
      expect(words).not.toContain("old");
      expect(quantityKey(quantity)).not.toContain("old");
    }
  });
});

describe("a remove drops touching lines (die-with-target)", () => {
  test("the stock line on the word and every flow ending at it go", () => {
    const records = [
      stock("old", 1),
      flow("old", "b", 2),
      flow("c", "old", 3),
      flow("c", "d", 4),
      stock("sea", 5),
    ];
    expect(dropQuantitiesTouching(records, "old")).toEqual([
      flow("c", "d", 4),
      stock("sea", 5),
    ]);
  });

  test("a line that never names the word is untouched, bytes and all", () => {
    const kept = [stock("a", 1, { note: "n" }), flow("a", "b")];
    const out = dropQuantitiesTouching(kept, "z");
    expect(out).toEqual(kept);
    expect(out[0]).toBe(kept[0]);
    // A self-flow dies with its one word.
    expect(dropQuantitiesTouching([flow("z", "z", 1)], "z")).toEqual([]);
  });
});

describe("the batch step sits at the family position", () => {
  test("the module doc states the grown order after assumptions, before pointers", () => {
    expect(patchesSource).toMatch(
      /assumptions -> quantities -> pointers -> pointer-marks/,
    );
    // The pre-story order is kept where it is described as history.
    expect(patchesSource).toContain(
      "loops -> assumptions -> pointers -> pointer-marks -> membership -> the old file",
    );
  });

  test("rename writes assumptions, then quantities, then pointers", () => {
    const body = functionBody(patchesSource, "renameReference");
    const assumptions = body.indexOf("saveAssumptions(");
    const quantities = body.indexOf("saveQuantities(");
    const pointers = body.indexOf("savePointers(");
    expect(assumptions).toBeGreaterThan(-1);
    expect(quantities).toBeGreaterThan(assumptions);
    expect(pointers).toBeGreaterThan(quantities);
    // The step consumes the rewrite at the family position, and the old file
    // still falls last.
    expect(body.indexOf("rewriteQuantityEndpoints(")).toBeGreaterThan(
      assumptions,
    );
    expect(body.indexOf("rewriteQuantityEndpoints(")).toBeLessThan(pointers);
    expect(body.lastIndexOf("removeFile(referencePath")).toBeGreaterThan(
      quantities,
    );
    expect(body.toLowerCase()).toContain("crash");
  });

  test("remove drops quantities after assumptions and before pointers", () => {
    const body = functionBody(patchesSource, "removeReference");
    const assumptions = body.indexOf("saveAssumptions(");
    const quantities = body.indexOf("saveQuantities(");
    const pointers = body.indexOf("savePointers(");
    expect(assumptions).toBeGreaterThan(-1);
    expect(quantities).toBeGreaterThan(assumptions);
    expect(pointers).toBeGreaterThan(quantities);
    expect(body.indexOf("dropQuantitiesTouching(")).toBeGreaterThan(
      assumptions,
    );
    expect(body.indexOf("dropQuantitiesTouching(")).toBeLessThan(pointers);
    expect(body.lastIndexOf("removeFile(referencePath")).toBeGreaterThan(
      quantities,
    );
    expect(body.toLowerCase()).toContain("crash");
  });

  test("the batch never writes a quantity through another module", () => {
    // Only the quantities module owns its bytes; the patch batch goes through
    // saveQuantities and never hand-strings the file in a batch body.
    expect(patchesSource).toContain('from "./quantities"');
    for (const name of ["renameReference", "removeReference"]) {
      expect(functionBody(patchesSource, name)).not.toContain(
        "quantities.jsonl",
      );
    }
  });
});
