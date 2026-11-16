import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { creationKinds } from "../src/canvas/gates";
import { GhostPanel } from "../src/canvas/GhostPanel";
import {
  AGENT_PATCH_KEYS,
  GHOST_KEYS,
  serializeEnvelope,
  type GhostEnvelope,
} from "../src/ghost/envelope";
import { validateGhost } from "../src/ghost/grammar";
import {
  assemblePacket,
  GAME_CONVENTIONS,
  PACKET_LIMIT,
  type PacketCard,
  type PacketInput,
  type PacketView,
  type PacketWord,
} from "../src/ghost/packet";
import {
  ADD_ASSUMPTION,
  ASSUMPTIONS_FILE,
  MOVES,
} from "../src/ghost/registry";
import {
  askForPacket,
  PACKET_REQUEST_KEYS,
  type PacketRequest,
} from "../src/ghost/request";
import { createGhostSession } from "../src/ghost/session";
import { readGhostSnapshot } from "../src/ghost/snapshot";
import { cardOf, parseCards, serializeCards } from "../src/map/cards";
import { agentReply, readFiledEnvelope, withWorkspace } from "./ghost-harness";

/**
 * Epic 11 story 3 — THE CARD IN THE PACKET.
 *
 * Three things, kept apart:
 *   - the packet's conventions section: a card REPLACES the default prose when
 *     the person includes it (the moves half stays DERIVED; examples never
 *     ride), and the default stands otherwise;
 *   - the INCLUSION CHOICE: person state, like the region — OFF by default, and
 *     the request cannot smuggle it (its keys are exactly move/target);
 *   - the PACKET-HASH PROVENANCE: the frozen packet's hash rides the envelope
 *     at intake. An edit to the card between ask and accept changes the NEXT
 *     packet's hash and refuses nothing — the grammar never reads the hash,
 *     and the card stays out of the base pin (ADR-0027 §5 as amended).
 *
 * The card is not a definition and never enforces: the scoped negative proves
 * a MALFORMED card is refused at card validation (honestly surfaced, never
 * riding), and a source scan holds the grammar's graph clear of the record.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

const BASE = '{"on":"soil","text":"the soil holds water"}\n';

const RAIN: PacketWord = {
  slug: "rain",
  name: "rain",
  x: 0,
  y: 0,
  box: { w: 80, h: 30 },
};
const SOIL: PacketWord = {
  slug: "soil",
  name: "soil",
  x: 120,
  y: 0,
  box: { w: 80, h: 30 },
};

const CONVENTIONS =
  "a playing set first, then the signed links, the authored quantities and the named loops";

const CARD: PacketCard = { game: "dynamics", conventions: CONVENTIONS };

const KINDS = creationKinds("dynamics");

function view(): PacketView {
  return {
    words: [RAIN, SOIL],
    playing: ["rain", "soil"],
    marks: [],
    claims: [],
    loops: [],
    veils: [],
  };
}

function snapshot(overrides: Partial<Parameters<typeof assemblePacket>[0]["snapshot"]> = {}) {
  return {
    level: "dynamics" as const,
    scenario: null,
    dir: "map",
    playing: ["rain", "soil"],
    words: new Set(["rain", "soil"]),
    loops: new Set<string>(),
    files: { [ASSUMPTIONS_FILE]: BASE },
    ...overrides,
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

const CONTEXT = { level: "dynamics" as const, scenario: null };

function request(overrides: Partial<PacketRequest> = {}): PacketRequest {
  return {
    move: { family: "assumption", verb: "add" },
    target: { kind: "word", slug: "rain" },
    ...overrides,
  };
}

/** The card's own canonical line (the record's shape, as the file holds it). */
function cardLine(conventions = CONVENTIONS): string {
  return JSON.stringify({
    game: "dynamics",
    conventions,
    examples: ["a placeholder word -> another placeholder word"],
  });
}

function cardFile(conventions = CONVENTIONS) {
  return parseCards(cardLine(conventions) + "\n").cards;
}

/** One ask over the harness's real workspace. */
async function askOn(
  scratch: { path: string; fs: Parameters<typeof askForPacket>[0]["fs"] },
  overrides: Partial<Parameters<typeof askForPacket>[0]> = {},
) {
  return askForPacket({
    workspacePath: scratch.path,
    fs: scratch.fs,
    context: CONTEXT,
    request: request(),
    person: { selection: null },
    view: view(),
    ...overrides,
  });
}

describe("the replacement rule: the card replaces the default conventions", () => {
  test("with no card the default prose stands, exactly as before cards", () => {
    const packet = assemblePacket(input());
    expect(flat(packet.freeze.bytes)).toContain(flat(GAME_CONVENTIONS.dynamics));
    expect(packet.freeze.bytes).not.toContain("card: ");
  });

  test("an included card REPLACES the default with one narrow line", () => {
    const plain = assemblePacket(input());
    const packet = assemblePacket(
      input({ includeCard: true, cards: [CARD], creationKinds: KINDS }),
    );
    const text = flat(packet.freeze.bytes);
    expect(text).toContain(
      "card: dynamics — assumption/add, word, lack, assumption; " + CONVENTIONS,
    );
    // The default prose is GONE (the card replaced it), and only the card's
    // game section changed.
    expect(text).not.toContain(flat(GAME_CONVENTIONS.dynamics));
    expect(packet.freeze.bytes).not.toBe(plain.freeze.bytes);
    expect(packet.freeze.hash).not.toBe(plain.freeze.hash);
    // The rest of the packet is untouched: the move's boundary, the limit, the
    // records (records, not tokens).
    expect(text).toContain(flat(ADD_ASSUMPTION.boundary));
    expect(packet.freeze.bytes).toContain(PACKET_LIMIT);
    expect(packet.freeze.bytes).toContain("### a word: rain (the target)");
  });

  test("the card's moves half is DERIVED, never the card's authored bytes", () => {
    const hand = {
      game: "dynamics",
      conventions: CONVENTIONS,
      moves: ["a coined name"],
      examples: ["PLACEHOLDER-EXAMPLE-NEVER-RIDES"],
    } as unknown as PacketCard;
    const packet = assemblePacket(
      input({ includeCard: true, cards: [hand], creationKinds: KINDS }),
    );
    const text = flat(packet.freeze.bytes);
    expect(text).toContain("assumption/add, word, lack, assumption");
    expect(text).not.toContain("a coined name");
    // The examples are person-facing only (ADR-0027 decision 3).
    expect(text).not.toContain("PLACEHOLDER-EXAMPLE-NEVER-RIDES");
    // A fixture registry row moves the card's derivation: the line is read from
    // the table, not from a copy beside the conventions.
    const second = {
      ...ADD_ASSUMPTION,
      move: { family: "loop", verb: "add" },
    };
    const grown = assemblePacket(
      input({
        includeCard: true,
        cards: [CARD],
        creationKinds: KINDS,
        moves: [...MOVES, second],
      }),
    );
    expect(flat(grown.freeze.bytes)).toContain(
      "card: dynamics — assumption/add, loop/add, word, lack, assumption; ",
    );
  });

  test("the default stands when the choice is off, the card absent, or another game's", () => {
    const plain = input();
    // The card DATA alone is not the choice: OFF by default.
    expect(
      assemblePacket(input({ cards: [CARD], creationKinds: KINDS })).freeze.bytes,
    ).toBe(assemblePacket(plain).freeze.bytes);
    expect(
      assemblePacket(
        input({ includeCard: false, cards: [CARD], creationKinds: KINDS }),
      ).freeze.bytes,
    ).toBe(assemblePacket(plain).freeze.bytes);
    // INCLUDED but no card written: deleting the line returns the default.
    expect(
      assemblePacket(input({ includeCard: true, creationKinds: KINDS })).freeze
        .bytes,
    ).toBe(assemblePacket(plain).freeze.bytes);
    // INCLUDED but a card for ANOTHER game: this move's game keeps the default.
    expect(
      assemblePacket(
        input({
          includeCard: true,
          cards: [{ game: "concept", conventions: "concept's note" }],
          creationKinds: KINDS,
        }),
      ).freeze.bytes,
    ).toBe(assemblePacket(plain).freeze.bytes);
  });

  test("a card edit moves the packet's hash but never the base pin", () => {
    const one = assemblePacket(
      input({ includeCard: true, cards: cardFile(), creationKinds: KINDS }),
    );
    const two = assemblePacket(
      input({
        includeCard: true,
        cards: cardFile("the edited note"),
        creationKinds: KINDS,
      }),
    );
    expect(one.freeze.bytes).not.toBe(two.freeze.bytes);
    expect(one.freeze.hash).not.toBe(two.freeze.hash);
    expect(one.freeze.pin).toEqual(two.freeze.pin);
    // The card's bytes are not in the pin: the base pin names the move's file.
    expect(Object.keys(one.freeze.pin.files)).toEqual([ASSUMPTIONS_FILE]);
    expect(JSON.stringify(one.freeze.pin)).not.toContain(CONVENTIONS);
  });
});

describe("the inclusion choice is the person's (the request cannot smuggle it)", () => {
  test("the request's keys are exactly move/target: no card-shaped key exists", () => {
    expect(PACKET_REQUEST_KEYS).toEqual(["move", "target"]);
    for (const key of PACKET_REQUEST_KEYS) {
      expect(key).not.toMatch(/card|include|conventions/);
    }
  });

  test("a smuggled request key changes nothing (the request cannot curate)", async () => {
    await withWorkspace(async (scratch) => {
      const options = {
        context: CONTEXT,
        person: { selection: null as readonly string[] | null },
        view: view(),
      };
      const clean = await askOn(scratch, {
        ...options,
        includeCard: false,
        cards: cardFile(),
        creationKinds: KINDS,
      });
      const dirty = await askOn(scratch, {
        ...options,
        includeCard: false,
        cards: cardFile(),
        creationKinds: KINDS,
        request: {
          ...request(),
          includeCard: true,
          cards: [CARD],
          conventions: "a request's note",
        } as unknown as PacketRequest,
      });
      expect(clean.ok && dirty.ok).toBe(true);
      if (!clean.ok || !dirty.ok) return;
      expect(dirty.packet.freeze.bytes).toBe(clean.packet.freeze.bytes);
      expect(dirty.packet.freeze.hash).toBe(clean.packet.freeze.hash);
      // The smuggled request's "note" never rode.
      expect(dirty.packet.freeze.bytes).not.toContain("a request's note");
    });
  });

  test("the same request with the choice on asks for another packet", async () => {
    await withWorkspace(async (scratch) => {
      const off = await askOn(scratch, {
        includeCard: false,
        cards: cardFile(),
        creationKinds: KINDS,
      });
      const on = await askOn(scratch, {
        includeCard: true,
        cards: cardFile(),
        creationKinds: KINDS,
      });
      expect(off.ok && on.ok).toBe(true);
      if (!off.ok || !on.ok) return;
      expect(on.packet.freeze.bytes).not.toBe(off.packet.freeze.bytes);
      expect(on.packet.freeze.hash).not.toBe(off.packet.freeze.hash);
      expect(on.packet.freeze.pin).toEqual(off.packet.freeze.pin);
      expect(flat(on.packet.freeze.bytes)).toContain(
        "card: dynamics — " + "assumption/add, word, lack, assumption; " + CONVENTIONS,
      );
      expect(flat(off.packet.freeze.bytes)).not.toContain("card: ");
    });
  });

  test("the ask surface carries the choice, OFF by default", () => {
    const props = {
      targets: [],
      packet: null,
      askIssues: [],
      intakeIssues: [],
      onAsk: () => {},
      onPropose: () => {},
      onClose: () => {},
    };
    const off = renderToStaticMarkup(
      createElement(GhostPanel, {
        ...props,
        includeCard: false,
        onIncludeCard: () => {},
      }),
    );
    const text = off
      .replace(/<[^>]*>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");
    expect(text).toContain("include this game's card");
    expect(off).toContain('type="checkbox"');
    expect(off).not.toContain("checked");
    const on = renderToStaticMarkup(
      createElement(GhostPanel, {
        ...props,
        includeCard: true,
        onIncludeCard: () => {},
      }),
    );
    expect(on).toContain("checked");
    // App hands the hook's own person state to the panel, and the card data at
    // ask time (a hand edit is seen by the next ask).
    expect(source("src/App.tsx")).toContain(
      "includeCard={ghostRequest.includeCard}",
    );
    expect(source("src/App.tsx")).toContain("cards: readCards,");
  });
});

describe("the packet-hash binding: provenance in the envelope, never enforcement", () => {
  const CONTEXT = { level: "dynamics" as const, scenario: null };

  test("intake records the frozen packet's hash; the card stays out of the pin", async () => {
    await withWorkspace(async (scratch) => {
      const asked = await askOn(scratch, {
        includeCard: true,
        cards: cardFile(),
        creationKinds: KINDS,
      });
      expect(asked.ok).toBe(true);
      if (!asked.ok) return;
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
        mintId: () => "ghost-card-1",
      });
      await session.open();
      const intake = await session.intake(
        agentReply(),
        CONTEXT,
        asked.packet.freeze.hash,
      );
      expect(intake.ok).toBe(true);
      if (!intake.envelope) throw new Error("expected an envelope");
      const filed = readFiledEnvelope(scratch, intake.envelope.id);
      expect(filed.packetHash).toBe(asked.packet.freeze.hash);
      expect(intake.envelope.packetHash).toBe(asked.packet.freeze.hash);
      // The provenance rides the bytes visibly (the filed envelope names it).
      const text = scratch.read(".attentioneer/inbox/" + intake.envelope.id + ".json");
      expect(text).toContain(asked.packet.freeze.hash);
      expect(text).toBe(serializeEnvelope(filed));
      // The card is NOT in the base pin: provenance, not enforcement.
      expect(Object.keys(filed.expect.files)).toEqual([ASSUMPTIONS_FILE]);
      expect(JSON.stringify(filed)).not.toContain(CONVENTIONS);
      expect(serializeEnvelope(filed)).not.toContain("card:");
    });
  });

  test("no ask, no hash: the key is absent and the ghost accepts", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
        mintId: () => "ghost-no-ask",
      });
      await session.open();
      const intake = await session.intake(agentReply(), CONTEXT);
      if (!intake.envelope) throw new Error("expected an envelope");
      const filed = readFiledEnvelope(scratch, intake.envelope.id);
      expect(Object.keys(filed)).not.toContain("packetHash");
      expect(filed.packetHash).toBeUndefined();
      const accept = await session.accept(intake.envelope.id, CONTEXT);
      expect(accept.outcome).toBe("applied");
    });
  });

  test("the agent may not author the provenance (unknown key at intake)", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
        mintId: () => "ghost-agent-hash",
      });
      await session.open();
      const intake = await session.intake(
        agentReply({ packetHash: "the model's own claim" }),
        CONTEXT,
        "0123456789abcdef0123456789abcdef",
      );
      expect(intake.ok).toBe(false);
      expect(intake.issues.map((entry) => entry.code)).toContain("unknown-key");
      expect(scratch.exists(".attentioneer/inbox")).toBe(false);
    });
  });

  test("edit the card, ask again: a new hash, and the PREVIOUS ghost still accepts", async () => {
    await withWorkspace(async (scratch) => {
      const first = await askOn(scratch, {
        includeCard: true,
        cards: cardFile(),
        creationKinds: KINDS,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
        mintId: () => "ghost-before-edit",
      });
      await session.open();
      const intake = await session.intake(
        agentReply(),
        CONTEXT,
        first.packet.freeze.hash,
      );
      if (!intake.envelope) throw new Error("expected an envelope");

      // The person edits the card and asks again: the packet (and its hash)
      // moves with the content.
      const edited = await askOn(scratch, {
        includeCard: true,
        cards: cardFile("an edited note"),
        creationKinds: KINDS,
      });
      expect(edited.ok).toBe(true);
      if (!edited.ok) return;
      expect(edited.packet.freeze.hash).not.toBe(first.packet.freeze.hash);
      expect(flat(edited.packet.freeze.bytes)).toContain("an edited note");

      // The previous ghost still accepts: the frozen hash is provenance, never
      // a refusal (the grammar never reads it; the card is not in the pin).
      const accept = await session.accept(intake.envelope.id, CONTEXT);
      expect(accept.outcome).toBe("applied");
      if (accept.outcome !== "applied") return;
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        BASE + '{"on":"rain","text":"rain follows the soil\'s temperature"}\n',
      );
      // Nothing of the card became a record.
      expect(scratch.read(ASSUMPTIONS_FILE)).not.toContain(CONVENTIONS);
    });
  });

  test("a tampered hash value refuses nothing (the grammar never reads it)", async () => {
    await withWorkspace(async (scratch) => {
      const asked = await askOn(scratch, {
        includeCard: true,
        cards: cardFile(),
        creationKinds: KINDS,
      });
      if (!asked.ok) throw new Error("expected a packet");
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
        mintId: () => "ghost-tampered-hash",
      });
      await session.open();
      const intake = await session.intake(
        agentReply(),
        CONTEXT,
        asked.packet.freeze.hash,
      );
      if (!intake.envelope) throw new Error("expected an envelope");
      const id = intake.envelope.id;
      const path = ".attentioneer/inbox/" + id + ".json";
      const raw = JSON.parse(scratch.read(path)!);
      raw.packetHash = 12345;
      scratch.write(path, JSON.stringify(raw, null, 2));

      // The accept's grammar allows the KEY and never inspects the value.
      const filed = readFiledEnvelope(scratch, id);
      const snap = await readGhostSnapshot(scratch.fs, scratch.path, {
        level: "dynamics",
        scenario: null,
        files: [ASSUMPTIONS_FILE],
      });
      expect(validateGhost(filed, snap).ok).toBe(true);
      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("applied");
    });
  });

  test("the grammar and the pin never mention the hash (source scan)", () => {
    for (const module of [
      "ghost/grammar.ts",
      "ghost/registry.ts",
      "ghost/snapshot.ts",
      "ghost/apply.ts",
    ]) {
      expect({ module, reads: source("src/" + module).includes("packetHash") }).toEqual({
        module,
        reads: false,
      });
    }
    // The envelope declares the key; the session attaches it after the grammar.
    expect(source("src/ghost/envelope.ts")).toContain("packetHash");
    expect(source("src/ghost/session.ts")).toContain("withPacketHash(");
    // The key set allows it; the agent's body does not.
    expect(GHOST_KEYS).toContain("packetHash");
    expect(AGENT_PATCH_KEYS).not.toContain("packetHash");
  });
});

describe("the scoped negative: a malformed card refuses at card validation", () => {
  test("a malformed card line is refused honestly (surfaced, never a card)", () => {
    const malformed = '{"game":"dynamics","conventions":"","examples":["x"]}';
    const parsed = parseCards(
      cardLine() + "\n" + malformed + "\n",
    );
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.malformed).toEqual([malformed]);
    expect(cardOf(parsed.cards, "dynamics")).not.toBeNull();
    expect(cardOf(parsed.cards, "concept")).toBeNull();
    // Preserved verbatim on the way out (the family posture): refusing the
    // line never drops it.
    expect(serializeCards(parsed.cards, parsed.malformed)).toContain(malformed);
  });

  test("a malformed card never rides the packet: the default stands", () => {
    const malformed =
      '{"game":"dynamics","conventions":"","examples":["x"],"name":"a coined name"}';
    const parsed = parseCards(malformed + "\n");
    expect(parsed.cards).toEqual([]);
    expect(parsed.malformed).toEqual([malformed]);
    const packet = assemblePacket(
      input({
        includeCard: true,
        cards: parsed.cards,
        creationKinds: KINDS,
      }),
    );
    const text = flat(packet.freeze.bytes);
    // The default stands; the malformed line's invented name and empty
    // conventions never ride, and the packet did not refuse (a card is not the
    // grammar's).
    expect(text).toContain(flat(GAME_CONVENTIONS.dynamics));
    expect(text).not.toContain("card: ");
    expect(text).not.toContain("a coined name");
  });

  test("a card naming a word is refused at the FIELD level (no name slot)", () => {
    const named = JSON.stringify({
      game: "dynamics",
      conventions: "a note",
      examples: ["x"],
      name: "storm",
    });
    const parsed = parseCards(named + "\n");
    expect(parsed.cards).toEqual([]);
    expect(parsed.malformed).toEqual([named]);
    // The card record's own validation refuses it; nothing in the ghost layer
    // reads the card, so no packet can be built from it.
    expect(source("src/ghost/packet.ts")).not.toMatch(
      /from\s+["'][^"']*map\/cards/,
    );
    expect(source("src/ghost/grammar.ts")).not.toMatch(/map\/cards|parseCards|cardOf/);
  });
});
