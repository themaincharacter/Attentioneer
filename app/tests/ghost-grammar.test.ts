import { describe, expect, test } from "bun:test";
import { serializeAssumptionLine } from "../src/map/assumptions";
import { sha256Hex } from "../src/ghost/digest";
import { GHOST_FORMAT, type GhostTarget } from "../src/ghost/envelope";
import { validateGhost, type GhostValidation } from "../src/ghost/grammar";
import {
  ADD_ASSUMPTION,
  appendLine,
  ASSUMPTIONS_FILE,
  findMove,
  MOVES,
  moveKeyOf,
} from "../src/ghost/registry";
import type { GhostSnapshot } from "../src/ghost/snapshot";

/**
 * Epic 10 story 1 — the registry and the grammar, pure.
 *
 * The grammar is a registry-checked checklist with DRY-RUN CLOSURE (ADR-0025
 * decision 1): shape/keys, the registered move, the params schema, the base
 * pin, append-only and single-file, and closure by applying the derived steps
 * to an in-memory snapshot. These tests build the snapshot by hand, so they
 * prove the rules without a filesystem; the fs-level half is the crash matrix.
 *
 * It cannot check meaning, same-thing-ness, prose quality or "small" — those
 * are the person's judgment, and no test here pretends otherwise.
 */

const TEXT = "rain follows the soil's temperature";
const CLAIM: GhostTarget = { kind: "word", slug: "rain" };
const LOOP_SLUG = "the-water-cycle";
const BEFORE = '{"on":"soil","text":"the soil holds water"}\n';
const LINE = serializeAssumptionLine({ text: TEXT, target: { type: "word", slug: "rain" }, extra: {} });

function snapshot(overrides: Partial<GhostSnapshot> = {}): GhostSnapshot {
  return {
    level: "dynamics",
    scenario: null,
    dir: "map",
    playing: ["rain", "soil"],
    words: new Set(["rain", "soil"]),
    loops: new Set([LOOP_SLUG]),
    files: { [ASSUMPTIONS_FILE]: BEFORE },
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: GHOST_FORMAT,
    id: "ghost-test-1",
    move: { family: "assumption", verb: "add" },
    target: { kind: "word", slug: "rain" },
    params: { text: TEXT },
    expect: {
      dir: "map",
      files: { [ASSUMPTIONS_FILE]: sha256Hex(BEFORE) },
      level: "dynamics",
      game: "dynamics",
    },
    rationale: "the pair is on the map with no claim about it",
    steps: [],
    proposals: [],
    ...overrides,
  };
}

function codes(validation: GhostValidation): string[] {
  return validation.issues.map((entry) => entry.code);
}

function expectRefused(
  candidate: Record<string, unknown>,
  snap: GhostSnapshot,
  code: string,
): GhostValidation {
  const validation = validateGhost(candidate, snap);
  expect(validation.ok).toBe(false);
  expect(codes(validation)).toContain(code);
  return validation;
}

describe("the registry: one move, expansion is data", () => {
  test("the table carries exactly assumption/add and its params/target schema", () => {
    expect(MOVES).toHaveLength(1);
    expect(MOVES[0]).toBe(ADD_ASSUMPTION);
    expect(ADD_ASSUMPTION.move).toEqual({ family: "assumption", verb: "add" });
    expect(moveKeyOf(ADD_ASSUMPTION.move)).toBe("assumption\u0000add");
    expect(ADD_ASSUMPTION.game).toBe("dynamics");
    expect(ADD_ASSUMPTION.files).toEqual([ASSUMPTIONS_FILE]);
    expect(ADD_ASSUMPTION.params).toEqual([{ key: "text", kind: "text" }]);
    // The params schema is the prose; the target rides the envelope's target.
    const allowed = ADD_ASSUMPTION.targets.filter((rule) => rule.allowed);
    expect(allowed.map((rule) => rule.kind)).toEqual(["word", "loop"]);
    const refused = ADD_ASSUMPTION.targets.filter((rule) => !rule.allowed);
    expect(refused.map((rule) => rule.kind)).toEqual(["spot", "link"]);
    for (const rule of refused) {
      expect(rule.refusal).toBeTruthy();
    }
  });

  test("findMove is the registration door (an unregistered verb is not a move)", () => {
    expect(findMove({ family: "assumption", verb: "add" })).toBe(ADD_ASSUMPTION);
    expect(findMove({ family: "assumption", verb: "delete" })).toBeNull();
    expect(findMove({ family: "loop", verb: "add" })).toBeNull();
    expect(findMove(null)).toBeNull();
    expect(findMove("assumption/add")).toBeNull();
  });
});

describe("the grammar: shape, keys and the agent's language", () => {
  test("a valid ghost validates, derives its one step, and is not applied", () => {
    const validation = validateGhost(envelope(), snapshot());
    expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(validation.applied).toBe(false);
    expect(validation.envelope).not.toBeNull();
    expect(validation.envelope!.steps).toEqual([
      { op: "append", file: ASSUMPTIONS_FILE, line: LINE },
    ]);
    expect(validation.envelope!.proposals).toEqual([]);
    // The dry run applies the step to the snapshot's bytes.
    expect(validation.run!.files).toEqual([
      {
        path: ASSUMPTIONS_FILE,
        before: BEFORE,
        after: appendLine(BEFORE, LINE),
      },
    ]);
    expect(validation.run!.files[0].after).toBe(BEFORE + LINE + "\n");
  });

  test("an unregistered move is refused before anything else", () => {
    expectRefused(
      envelope({ move: { family: "assumption", verb: "delete" } }),
      snapshot(),
      "unregistered-move",
    );
  });

  test("a move is a family and a verb, and no name slot", () => {
    expectRefused(
      envelope({ move: { family: "assumption", verb: "add", name: "coin" } }),
      snapshot(),
      "name-slot",
    );
    expectRefused(
      envelope({ move: { family: "assumption", verb: "add", why: "..." } }),
      snapshot(),
      "unknown-key",
    );
  });

  test("params is exactly the registered schema, and no name slot", () => {
    expectRefused(
      envelope({ params: { text: TEXT, name: "rain" } }),
      snapshot(),
      "name-slot",
    );
    expectRefused(
      envelope({ params: { text: TEXT, extra: 1 } }),
      snapshot(),
      "unknown-key",
    );
    expectRefused(envelope({ params: { text: 5 } }), snapshot(), "params");
    expectRefused(envelope({ params: {} }), snapshot(), "params");
    expectRefused(
      envelope({ params: { text: "  padded  " } }),
      snapshot(),
      "params",
    );
    expectRefused(envelope({ params: { text: "   " } }), snapshot(), "params");
  });

  test("the target's payload keys are exact", () => {
    expectRefused(
      envelope({ target: { kind: "word", slug: "rain", on: "rain" } }),
      snapshot(),
      "unknown-key",
    );
  });

  test("the rationale is prose, and it must be there", () => {
    expectRefused(envelope({ rationale: "" }), snapshot(), "rationale");
    expectRefused(envelope({ rationale: "   " }), snapshot(), "rationale");
    const missing = envelope();
    delete missing.rationale;
    expectRefused(missing, snapshot(), "rationale");
  });

  test("the envelope's own keys are exact (hand edits change values, not keys)", () => {
    expectRefused(envelope({ name: "rain" }), snapshot(), "name-slot");
    expectRefused(envelope({ extra: true }), snapshot(), "unknown-key");
    expectRefused(envelope({ format: "attentioneer-ghost/2" }), snapshot(), "format");
    expectRefused(envelope({ id: "../escape" }), snapshot(), "id");
    expectRefused(envelope({ steps: "not a list" }), snapshot(), "shape");
    expectRefused(
      envelope({ proposals: [{ kind: "name", text: "storm" }] }),
      snapshot(),
      "name-slot",
    );
  });

  test("an agent body carrying an app-owned key is refused at intake", async () => {
    const { agentBodyIssues } = await import("../src/ghost/grammar");
    const body = {
      move: { family: "assumption", verb: "add" },
      target: { kind: "word", slug: "rain" },
      params: { text: TEXT },
      rationale: "...",
      expect: {},
    };
    const issues = agentBodyIssues(body);
    expect(issues.map((entry) => entry.code)).toContain("unknown-key");
    expect(agentBodyIssues({ ...body, name: "rain" }).map((e) => e.code)).toContain(
      "name-slot",
    );
  });
});

describe("the grammar: targets (word/loop only in v1)", () => {
  test("a dangling word target fails", () => {
    expectRefused(
      envelope({ target: { kind: "word", slug: "gone" } }),
      snapshot(),
      "dangling-target",
    );
  });

  test("a dangling loop target fails; a standing loop is accepted", () => {
    expectRefused(
      envelope({ target: { kind: "loop", slug: "the-gone-loop" } }),
      snapshot(),
      "dangling-target",
    );
    const validation = validateGhost(
      envelope({ target: { kind: "loop", slug: LOOP_SLUG } }),
      snapshot(),
    );
    expect(validation.ok).toBe(true);
    expect(validation.envelope!.target).toEqual({ kind: "loop", slug: LOOP_SLUG });
  });

  test("spot targets are refused (uncheckable), link targets too (branch seam)", () => {
    const spot = expectRefused(
      envelope({ target: { kind: "spot", x: 1, y: 2 } }),
      snapshot(),
      "refused-target",
    );
    expect(spot.issues[0].message).toContain("bare spot");
    const link = expectRefused(
      envelope({ target: { kind: "link", from: "rain", to: "soil" } }),
      snapshot(),
      "refused-target",
    );
    expect(link.issues[0].message).toContain("branch seam");
  });

  test("an unknown target kind is a shape error, not a refusal", () => {
    expectRefused(
      envelope({ target: { kind: "veil", name: "storm" } }),
      snapshot(),
      "target-shape",
    );
  });
});

describe("the grammar: the base pin (game, level, branch, bytes)", () => {
  test("the ghost's game must be the game running", () => {
    const concept = snapshot({ level: "concept" });
    const validation = validateGhost(envelope(), concept);
    expect(validation.ok).toBe(false);
    expect(codes(validation)).toContain("game");
  });

  test("the level pin is the band the ghost was built at", () => {
    expectRefused(
      envelope({
        expect: {
          dir: "map",
          files: { [ASSUMPTIONS_FILE]: sha256Hex(BEFORE) },
          level: "concept",
          game: "dynamics",
        },
      }),
      snapshot(),
      "level",
    );
  });

  test("a branch is refused (its folder is not the map)", () => {
    const branch = snapshot({ scenario: "storm", dir: "scenarios/storm" });
    const validation = validateGhost(
      envelope({
        expect: {
          dir: "scenarios/storm",
          files: { [ASSUMPTIONS_FILE]: sha256Hex(BEFORE) },
          level: "dynamics",
          game: "dynamics",
        },
      }),
      branch,
    );
    expect(validation.ok).toBe(false);
    expect(codes(validation)).toContain("branch");
  });

  test("a moved records folder fails the pin", () => {
    expectRefused(
      envelope(),
      snapshot({ dir: "scenarios/storm" }),
      "pin",
    );
  });

  test("the pin against the file actually on disk: a moved base is refused", () => {
    const moved = snapshot({
      files: {
        [ASSUMPTIONS_FILE]: '{"on":"rain","text":"a different standing claim"}\n',
      },
    });
    expectRefused(envelope(), moved, "pin");
  });

  test("the pin's own shape is checked", () => {
    expectRefused(
      envelope({
        expect: {
          dir: "map",
          files: { [ASSUMPTIONS_FILE]: "not a digest" },
          level: "dynamics",
          game: "dynamics",
        },
      }),
      snapshot(),
      "expect-shape",
    );
    expectRefused(
      envelope({
        expect: { dir: "map", files: {}, level: "dynamics", game: "dynamics" },
      }),
      snapshot(),
      "pin",
    );
  });
});

describe("the grammar: the set gate (ADR-0025 decision 3)", () => {
  test("a dynamics move is refused when no playing set is accepted", () => {
    const validation = expectRefused(
      envelope(),
      snapshot({ playing: null }),
      "no-playing-set",
    );
    // The refusal is the app's data vocabulary plus one human sentence; nothing
    // was derived, normalized or written.
    expect(validation.envelope).toBeNull();
    expect(validation.run).toBeNull();
    expect(validation.issues).toHaveLength(1);
    expect(validation.issues[0].message).toContain("no playing set is accepted");
  });

  test("an accepted set is the door, and an EMPTY accepted set is still a set", () => {
    expect(validateGhost(envelope(), snapshot({ playing: ["rain", "soil"] })).ok).toBe(
      true,
    );
    // The selector's own rule: absence is no set; an empty set is accepted.
    expect(validateGhost(envelope(), snapshot({ playing: [] })).ok).toBe(true);
  });

  test("the set gate is not the band's gate: the game pin still speaks first", () => {
    // A concept-level app with no set reports the game, not the set: the set
    // requirement belongs to the dynamics game the move lives in.
    const concept = snapshot({ level: "concept", playing: null });
    const validation = validateGhost(envelope(), concept);
    expect(validation.issues.map((entry) => entry.code)).toContain("game");
  });
});

describe("the grammar: append-only closure by dry application", () => {
  test("a claim that already stands is refused, even if the steps look right", () => {
    // The stored list claims a clean append; the DRY RUN says the family's
    // addAssumption would rewrite the standing line in place. Closure wins.
    const base = BEFORE + LINE + "\n";
    const validation = expectRefused(
      envelope({
        expect: {
          dir: "map",
          files: { [ASSUMPTIONS_FILE]: sha256Hex(base) },
          level: "dynamics",
          game: "dynamics",
        },
        steps: [{ op: "append", file: ASSUMPTIONS_FILE, line: LINE }],
      }),
      snapshot({ files: { [ASSUMPTIONS_FILE]: base } }),
      "append-only",
    );
    expect(validation.issues[0].message).toContain("already stands");
  });

  test("the derived list alone proves nothing: closure parses the result back", () => {
    // A malformed base line is kept; the dry run adds exactly one claim.
    const malformed = 'a hand-edited line that is not JSON\n';
    const base = malformed;
    const validation = validateGhost(
      envelope({
        expect: {
          dir: "map",
          files: { [ASSUMPTIONS_FILE]: sha256Hex(base) },
          level: "dynamics",
          game: "dynamics",
        },
      }),
      snapshot({ files: { [ASSUMPTIONS_FILE]: base } }),
    );
    expect(validation.ok).toBe(true);
    expect(validation.run!.files[0].after).toBe(base + LINE + "\n");
  });

  test("a hand-formatted base keeps every byte: only the canonical line is appended", () => {
    const base = '{"text":"the soil holds water","on":"soil"}'; // no trailing newline
    const validation = validateGhost(
      envelope({
        expect: {
          dir: "map",
          files: { [ASSUMPTIONS_FILE]: sha256Hex(base) },
          level: "dynamics",
          game: "dynamics",
        },
      }),
      snapshot({ files: { [ASSUMPTIONS_FILE]: base } }),
    );
    expect(validation.ok).toBe(true);
    expect(validation.run!.files[0].after).toBe(base + "\n" + LINE + "\n");
  });
});

describe("the grammar: single-file appends (v1's crash sufficiency)", () => {
  test("the pin may not name a second file", () => {
    expectRefused(
      envelope({
        expect: {
          dir: "map",
          files: {
            [ASSUMPTIONS_FILE]: sha256Hex(BEFORE),
            "map/loops.jsonl": sha256Hex('{"name":"the water cycle","path":["rain","soil","rain"]}\n'),
          },
          level: "dynamics",
          game: "dynamics",
        },
      }),
      snapshot(),
      "single-file",
    );
  });

  test("the pin may not name a file the move never writes", () => {
    const validation = expectRefused(
      envelope({
        expect: {
          dir: "map",
          files: { "map/loops.jsonl": sha256Hex("") },
          level: "dynamics",
          game: "dynamics",
        },
      }),
      snapshot(),
      "single-file",
    );
    expect(validation.issues[0].message).toContain("map/loops.jsonl");
  });
});

describe("the grammar: the applied-but-unmarked reconcile", () => {
  test("the file already holding the derived line is APPLIED, not written again", () => {
    const after = BEFORE + LINE + "\n";
    const validation = validateGhost(
      envelope({
        expect: {
          dir: "map",
          files: { [ASSUMPTIONS_FILE]: sha256Hex(BEFORE) },
          level: "dynamics",
          game: "dynamics",
        },
        steps: [{ op: "append", file: ASSUMPTIONS_FILE, line: "tampered" }],
      }),
      snapshot({ files: { [ASSUMPTIONS_FILE]: after } }),
    );
    expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(validation.applied).toBe(true);
    // The derived list, never the stored one, and the file is the pinned base
    // plus the line.
    expect(validation.envelope!.steps[0].line).toBe(LINE);
  });

  test("a base without a trailing newline reconciles across the inserted separator", () => {
    const base = '{"on":"soil","text":"the soil holds water"}';
    const after = appendLine(base, LINE);
    const validation = validateGhost(
      envelope({
        expect: {
          dir: "map",
          files: { [ASSUMPTIONS_FILE]: sha256Hex(base) },
          level: "dynamics",
          game: "dynamics",
        },
      }),
      snapshot({ files: { [ASSUMPTIONS_FILE]: after } }),
    );
    expect(validation.ok).toBe(true);
    expect(validation.applied).toBe(true);
  });

  test("a file that merely looks different is neither pending nor applied", () => {
    const afterDifferent = BEFORE + serializeAssumptionLine({
      text: "another claim entirely",
      target: { type: "word", slug: "rain" },
      extra: {},
    }) + "\n";
    const validation = validateGhost(
      envelope(),
      snapshot({ files: { [ASSUMPTIONS_FILE]: afterDifferent } }),
    );
    expect(validation.ok).toBe(false);
    expect(codes(validation)).toContain("pin");
  });
});
