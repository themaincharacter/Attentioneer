import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serializeAssumptionLine } from "../src/map/assumptions";
import { sha256Hex } from "../src/ghost/digest";
import { GHOST_FORMAT, type GhostExpect } from "../src/ghost/envelope";
import { validateGhost, type GhostValidation } from "../src/ghost/grammar";
import {
  ADD_ASSUMPTION,
  ASSUMPTIONS_FILE,
  findMove,
  GAME_POLICY,
  gamePolicyOf,
  MOVES,
  PARAM_KINDS,
  pinOf,
  registeredMovesOf,
  registryHash,
  type MoveDefinition,
} from "../src/ghost/registry";
import {
  assemblePacket,
  type PacketInput,
  type PacketView,
  type PacketWord,
} from "../src/ghost/packet";
import type { GhostSnapshot } from "../src/ghost/snapshot";

/**
 * Epic 11 story 2 — THE PER-GAME GRAMMAR.
 *
 * Four narrow seams, proven without widening the registry:
 *
 *   1. GAME_POLICY: game rules are POLICY DATA (registry.ts) the checklist
 *      reads. The dynamics game's requirement (an accepted playing set) lives
 *      in the table; the grammar has no game-name branch left, and a game
 *      whose row says nothing authors with no set.
 *   2. Params kinds are FAIL-CLOSED: text, number and enum are validated; an
 *      unknown kind REFUSES instead of passing the value through unvalidated
 *      (the cheap-model default), and an enum's allowed values are data.
 *   3. targetCount is GRAMMAR-READ: a row declaring another arity refuses,
 *      because the envelope carries exactly one target.
 *   4. The two-row fixture: findMove/validateGhost take the TABLE as a
 *      parameter, so a second row (a hypothetical quantity/add) walks the same
 *      checklist while MOVES stays at ONE move (ADR-0025 decision 5: expansion
 *      is blocked on the expansion protocol's verdict, which is not journaled).
 *   5. The pinOf.game tidy: the pin's level is the binding (snapshot.level);
 *      its game is documentation, named in the registry's own docs.
 *   6. The packet's operations line lists the game's REGISTERED moves, derived
 *      from the same table.
 *
 * Nothing here journals a verdict, registers a move, or lets a card reach the
 * grammar: these tests prove the seams stay deterministic, data-driven and
 * fail-closed.
 */

const TEXT = "rain follows the soil's temperature";
const BEFORE = '{"on":"soil","text":"the soil holds water"}\n';
const LINE = serializeAssumptionLine({
  text: TEXT,
  target: { type: "word", slug: "rain" },
  extra: {},
});

function snapshot(overrides: Partial<GhostSnapshot> = {}): GhostSnapshot {
  return {
    level: "dynamics",
    scenario: null,
    dir: "map",
    playing: ["rain", "soil"],
    words: new Set(["rain", "soil"]),
    loops: new Set(["the-water-cycle"]),
    files: { [ASSUMPTIONS_FILE]: BEFORE },
    ...overrides,
  };
}

function pin(overrides: Partial<GhostExpect> = {}): GhostExpect {
  return {
    dir: "map",
    files: { [ASSUMPTIONS_FILE]: sha256Hex(BEFORE) },
    level: "dynamics",
    game: "dynamics",
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: GHOST_FORMAT,
    id: "ghost-fixture-1",
    move: { family: "assumption", verb: "add" },
    target: { kind: "word", slug: "rain" },
    params: { text: TEXT },
    expect: pin(),
    rationale: "the pair is on the map with no claim about it",
    steps: [],
    proposals: [],
    ...overrides,
  };
}

function codes(validation: GhostValidation): string[] {
  return validation.issues.map((entry) => entry.code);
}

/** A source file's bytes, read by its path under app/src. */
function source(relative: string): string {
  return readFileSync(join(import.meta.dir, "..", "src", relative), "utf8");
}

/**
 * THE TWO-ROW FIXTURE (Epic 11 story 2): a hypothetical "quantity/add" that is
 * NEVER added to MOVES. It borrows add-assumption's derivers on purpose — this
 * fixture proves the CHECKLIST'S data-driven path (a table parameter, a second
 * row through the same door), not a second move's semantics; a real second
 * move's derivers are its own and arrive only after the protocol's verdict.
 */
const QUANTITY_ADD: MoveDefinition = {
  ...ADD_ASSUMPTION,
  move: { family: "quantity", verb: "add" },
  boundary:
    "Add one quantity beside one word. Nothing else changes: no word, mark, distance, loop, veil or existing claim is rewritten, renamed or removed.",
};

const FIXTURE: readonly MoveDefinition[] = [...MOVES, QUANTITY_ADD];

/** A fixture row whose params schema carries all three known kinds. */
const KINDS_ROW: MoveDefinition = {
  ...ADD_ASSUMPTION,
  params: [
    { key: "text", kind: "text" },
    { key: "size", kind: "number" },
    { key: "unit", kind: "enum", values: ["metres", "feet"] },
  ],
};

const WORD: PacketWord = {
  slug: "rain",
  name: "rain",
  x: 0,
  y: 0,
  box: { w: 80, h: 30 },
};

function view(): PacketView {
  return {
    words: [WORD],
    playing: ["rain"],
    marks: [],
    claims: [],
    loops: [],
    veils: [],
  };
}

function input(overrides: Partial<PacketInput> = {}): PacketInput {
  return {
    entry: ADD_ASSUMPTION,
    target: { kind: "word", slug: "rain" },
    person: { selection: null },
    view: view(),
    snapshot: snapshot(),
    ...overrides,
  };
}

/** The packet's prose with every run of whitespace collapsed (a wrap-proof read). */
function flat(bytes: string): string {
  return bytes.replace(/\s+/g, " ").trim();
}

describe("the per-game policy: game rules are DATA, not branches", () => {
  test("the table names which games require an accepted playing set", () => {
    expect(GAME_POLICY.dynamics.requiresPlayingSet).toBe(true);
    expect(GAME_POLICY.concept.requiresPlayingSet ?? false).toBe(false);
    expect(GAME_POLICY.ground.requiresPlayingSet ?? false).toBe(false);
    expect(Object.keys(GAME_POLICY).sort()).toEqual([
      "concept",
      "dynamics",
      "ground",
    ]);
  });

  test("a dynamics ghost with no set refuses through the policy row", () => {
    const validation = validateGhost(envelope(), snapshot({ playing: null }));
    expect(validation.ok).toBe(false);
    expect(codes(validation)).toContain("no-playing-set");
    expect(validation.issues[0].message).toContain("no playing set is accepted");
    // Nothing was derived, normalized or written.
    expect(validation.envelope).toBeNull();
    expect(validation.run).toBeNull();
  });

  test("an accepted set is the door, and an EMPTY accepted set is still a set", () => {
    expect(
      validateGhost(envelope(), snapshot({ playing: ["rain", "soil"] })).ok,
    ).toBe(true);
    expect(validateGhost(envelope(), snapshot({ playing: [] })).ok).toBe(true);
  });

  test("other games are unaffected: a concept row authors with no set", () => {
    const conceptRow: MoveDefinition = { ...ADD_ASSUMPTION, game: "concept" };
    const validation = validateGhost(
      envelope({ expect: pin({ level: "concept", game: "concept" }) }),
      snapshot({ level: "concept", playing: null }),
      [conceptRow],
    );
    expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  test("a ground row is the same: its policy carries no set requirement", () => {
    const groundRow: MoveDefinition = { ...ADD_ASSUMPTION, game: "ground" };
    const validation = validateGhost(
      envelope({ expect: pin({ level: "ground", game: "ground" }) }),
      snapshot({ level: "ground", playing: null }),
      [groundRow],
    );
    expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  test("the set gate is the POLICY's, not the game's name (source)", () => {
    const grammar = source("ghost/grammar.ts");
    expect(grammar).toContain("gamePolicyOf(entry.game)");
    expect(grammar).toContain("requiresPlayingSet === true");
    expect(grammar).toContain("snapshot.playing === null");
    // The old branch is gone: the checklist names no game.
    expect(grammar).not.toContain('"dynamics"');
    expect(grammar).not.toContain('"concept"');
    expect(grammar).not.toContain('"ground"');
  });

  test("the policy reader is fail-closed: no row, unknown field, bad type, not a row", () => {
    const ok = gamePolicyOf("dynamics");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.policy.requiresPlayingSet).toBe(true);

    const missing = gamePolicyOf("concept", {
      dynamics: { requiresPlayingSet: true },
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.issues.map((entry) => entry.code)).toEqual(["policy"]);
      expect(missing.issues[0].message).toContain("no authoring policy");
    }

    const unknownField = gamePolicyOf("ground", {
      ground: { allowsAnything: true },
    });
    expect(unknownField.ok).toBe(false);
    if (!unknownField.ok) {
      expect(unknownField.issues[0].message).toContain("allowsAnything");
    }

    const badType = gamePolicyOf("ground", {
      ground: { requiresPlayingSet: "yes" },
    });
    expect(badType.ok).toBe(false);

    const notRow = gamePolicyOf("ground", { ground: true });
    expect(notRow.ok).toBe(false);
  });
});

describe("the params schema: kinds are validated, fail-CLOSED", () => {
  function refusedParams(
    params: Record<string, unknown>,
    row: MoveDefinition = KINDS_ROW,
  ): GhostValidation {
    const validation = validateGhost(envelope({ params }), snapshot(), [row]);
    expect(validation.ok).toBe(false);
    expect(codes(validation)).toContain("params");
    expect(validation.envelope).toBeNull();
    return validation;
  }

  test("the shipped text kind still works exactly as before", () => {
    const validation = validateGhost(envelope(), snapshot());
    expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(ADD_ASSUMPTION.params).toEqual([{ key: "text", kind: "text" }]);
    expect(PARAM_KINDS).toEqual(["text", "number", "enum"]);
  });

  test("number: a finite number passes; a string, Infinity, NaN or no value refuses", () => {
    expect(
      validateGhost(
        envelope({ params: { text: TEXT, size: 3, unit: "metres" } }),
        snapshot(),
        [KINDS_ROW],
      ).ok,
    ).toBe(true);
    for (const size of ["3", Number.POSITIVE_INFINITY, Number.NaN, null]) {
      refusedParams({ text: TEXT, size, unit: "metres" });
    }
    refusedParams({ text: TEXT, unit: "metres" });
  });

  test("enum: the allowed values are DATA, and anything else refuses", () => {
    expect(
      validateGhost(
        envelope({ params: { text: TEXT, size: 3, unit: "feet" } }),
        snapshot(),
        [KINDS_ROW],
      ).ok,
    ).toBe(true);
    for (const unit of ["cubits", 3, "", null]) {
      refusedParams({ text: TEXT, size: 3, unit });
    }
    refusedParams({ text: TEXT, size: 3 });
  });

  test("an enum's declaration without usable values refuses (fail-closed)", () => {
    const noValues: MoveDefinition = {
      ...ADD_ASSUMPTION,
      params: [
        { key: "text", kind: "text" },
        { key: "unit", kind: "enum" },
      ],
    };
    const validation = refusedParams({ text: TEXT, unit: "metres" }, noValues);
    expect(validation.issues[0].message).toContain("no allowed values");

    const badValues: MoveDefinition = {
      ...ADD_ASSUMPTION,
      params: [
        { key: "text", kind: "text" },
        {
          key: "unit",
          kind: "enum",
          values: ["metres", 3] as unknown as string[],
        },
      ],
    };
    refusedParams({ text: TEXT, unit: "metres" }, badValues);
  });

  test("an UNKNOWN kind refuses rather than passing the value unvalidated", () => {
    const unknown: MoveDefinition = {
      ...ADD_ASSUMPTION,
      params: [
        { key: "text", kind: "text" },
        { key: "intensity", kind: "intensity" },
      ],
    };
    const validation = refusedParams({ text: TEXT, intensity: 5 }, unknown);
    expect(validation.issues[0].code).toBe("params");
    expect(validation.issues[0].message).toContain("intensity");
    expect(validation.issues[0].message).toContain("does not know");
    // A missing value does not make an unknown declaration safe.
    refusedParams({ text: TEXT }, unknown);
  });
});

describe("targetCount is grammar-READ, not merely declared", () => {
  test("the shipped table declares one target and the grammar reads it", () => {
    expect(ADD_ASSUMPTION.targetCount).toBe(1);
    for (const entry of MOVES) expect(entry.targetCount).toBe(1);
    expect(validateGhost(envelope(), snapshot()).ok).toBe(true);
  });

  test("a row declaring another arity refuses (one target of many is unchecked)", () => {
    const two = validateGhost(envelope(), snapshot(), [
      { ...ADD_ASSUMPTION, targetCount: 2 },
    ]);
    expect(two.ok).toBe(false);
    expect(codes(two)).toContain("target-shape");
    expect(two.issues[0].message).toContain("declares 2 targets");

    const zero = validateGhost(envelope(), snapshot(), [
      { ...ADD_ASSUMPTION, targetCount: 0 },
    ]);
    expect(zero.ok).toBe(false);
    expect(codes(zero)).toContain("target-shape");
  });

  test("a malformed count refuses too (fail-closed)", () => {
    const stringy = validateGhost(envelope(), snapshot(), [
      { ...ADD_ASSUMPTION, targetCount: "1" as unknown as number },
    ]);
    expect(stringy.ok).toBe(false);
    expect(codes(stringy)).toContain("target-shape");
  });
});

describe("the two-row fixture: the expansion path, without registering", () => {
  test("the registry stays ONE move (expansion is blocked on the verdict)", () => {
    expect(MOVES).toHaveLength(1);
    expect(MOVES[0]).toBe(ADD_ASSUMPTION);
    expect(findMove({ family: "quantity", verb: "add" })).toBeNull();
    expect(registryHash(FIXTURE)).not.toBe(registryHash());
  });

  test("the second row validates through the same checklist when passed as data", () => {
    const candidate = envelope({ move: { family: "quantity", verb: "add" } });
    expect(findMove(candidate.move, FIXTURE)).toBe(QUANTITY_ADD);

    const validation = validateGhost(candidate, snapshot(), FIXTURE);
    expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(validation.envelope).not.toBeNull();
    expect(validation.envelope!.move).toEqual({ family: "quantity", verb: "add" });
    // The same deriver path, the same append rule, the same one file.
    expect(validation.envelope!.steps).toEqual([
      { op: "append", file: ASSUMPTIONS_FILE, line: LINE },
    ]);

    // The very same candidate against the live table is unregistered.
    const live = validateGhost(candidate, snapshot());
    expect(live.ok).toBe(false);
    expect(codes(live)).toContain("unregistered-move");

    // Validating the fixture registered nothing.
    expect(MOVES).toHaveLength(1);
    expect(findMove({ family: "quantity", verb: "add" })).toBeNull();
  });

  test("the fixture row walks the SAME rules: a refused target still refuses", () => {
    const validation = validateGhost(
      envelope({
        move: { family: "quantity", verb: "add" },
        target: { kind: "spot", x: 1, y: 2 },
      }),
      snapshot(),
      FIXTURE,
    );
    expect(validation.ok).toBe(false);
    expect(codes(validation)).toContain("refused-target");
  });
});

describe("pinOf.game: the level binds, the game documents", () => {
  test("pinOf mints the move's game and the running band separately", () => {
    const pinned = pinOf(snapshot(), ADD_ASSUMPTION, { kind: "word", slug: "rain" });
    expect(pinned.level).toBe("dynamics");
    expect(pinned.game).toBe("dynamics");

    // The running band moves; the documented game does not (it is the move's).
    const moved = pinOf(snapshot({ level: "ground", playing: null }), ADD_ASSUMPTION, { kind: "word", slug: "rain" });
    expect(moved.level).toBe("ground");
    expect(moved.game).toBe("dynamics");
  });

  test("the grammar's environment binding is snapshot.level, not the pin's game", () => {
    const grammar = source("ghost/grammar.ts");
    expect(grammar).toContain("snapshot.level !== entry.game");
    // The pin's game is never compared with the running app (it is the move's
    // game, documentation); its self-consistency with the move is a shape check.
    expect(grammar).not.toContain("expect.expect.game");
    expect(grammar).not.toContain("snapshot.game");
  });

  test("the registry's docs name the tidy: the level binds, the game documents", () => {
    const registry = source("ghost/registry.ts");
    expect(registry).toContain("THE LEVEL IS THE BINDING");
    expect(registry).toContain("DOCUMENTATION");
    expect(registry).toContain("snapshot");
  });

  test("the game pin still has to NAME the move's game (a shape check)", () => {
    const validation = validateGhost(
      envelope({ expect: pin({ game: "concept" }) }),
      snapshot(),
    );
    expect(validation.ok).toBe(false);
    expect(codes(validation)).toContain("game");
  });

  test("the running band is what refuses another game's ghost", () => {
    const concept = validateGhost(envelope(), snapshot({ level: "concept" }));
    expect(concept.ok).toBe(false);
    expect(codes(concept)).toContain("game");
  });
});

describe("the packet's operations line: the game's REGISTERED moves, derived", () => {
  test("the live table's one move is listed, derived from the table", () => {
    const bytes = assemblePacket(input()).freeze.bytes;
    expect(registeredMovesOf("dynamics")).toEqual(["assumption/add"]);
    expect(registeredMovesOf("concept")).toEqual([]);
    expect(registeredMovesOf("ground")).toEqual([]);
    expect(bytes).toContain(
      "registered moves in dynamics: " + registeredMovesOf("dynamics").join(", "),
    );
  });

  test("a second row in the table is listed without a rendering edit", () => {
    const packet = assemblePacket(input({ moves: FIXTURE }));
    expect(packet.freeze.bytes).toContain(
      "registered moves in dynamics: assumption/add, quantity/add",
    );
    // The freeze's registry is the table the packet actually read.
    expect(packet.freeze.registry).toBe(registryHash(FIXTURE));
  });

  test("a game with no registered move says none (a fact, not an omission)", () => {
    const conceptRow: MoveDefinition = { ...ADD_ASSUMPTION, game: "concept" };
    // The live table registers only the dynamics move, so the concept game
    // has none to list (the row is not a registered move).
    const packet = assemblePacket(
      input({
        entry: conceptRow,
        moves: MOVES,
        snapshot: snapshot({ level: "concept" }),
      }),
    );
    expect(registeredMovesOf("concept", MOVES)).toEqual([]);
    expect(packet.freeze.bytes).toContain("registered moves in concept: none");
  });

  test("the packet names no move of its own: the line derives from the registry", () => {
    const packetSource = source("ghost/packet.ts");
    expect(packetSource).toContain("registeredMovesOf");
    expect(packetSource).not.toContain("assumption/add");
    expect(packetSource).not.toContain("quantity/add");
  });

  test("an enum field states its allowed values in the authors line (schema data)", () => {
    const packet = assemblePacket(input({ entry: KINDS_ROW, moves: [KINDS_ROW] }));
    expect(flat(packet.freeze.bytes)).toContain(
      "authors: text — prose, carried exactly as written; size — a finite number; unit — one of metres, feet",
    );
  });
});

describe("the negatives: the grammar stays a deterministic checklist", () => {
  test("the grammar never reads a card (story 1's seam holds)", () => {
    const grammar = source("ghost/grammar.ts");
    expect(grammar).not.toContain("map/cards");
    expect(grammar).not.toContain("parseCards");
    expect(grammar).not.toContain("gameMovesOf");
    expect(grammar).not.toContain("cards.jsonl");
  });

  test("the grammar derives nothing from a clock, a random source or a call", () => {
    const grammar = source("ghost/grammar.ts");
    expect(grammar).not.toMatch(/Math\.random|Date\.now|new Date\(/);
    expect(grammar).not.toMatch(/async\s+function/);
    expect(grammar).not.toMatch(/fetch\(|invoke\(|generateText/);
  });

  test("the policy table and the kinds are PROVISIONAL data, not literals in the grammar", () => {
    const registry = source("ghost/registry.ts");
    expect(registry).toContain("PROVISIONAL");
    // The known kinds are one list, in the schema's home.
    expect(registry).toContain("PARAM_KINDS");
    expect(PARAM_KINDS).toHaveLength(3);
  });
});
