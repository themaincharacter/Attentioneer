import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { creationKinds } from "../src/canvas/gates";
import { sha256Hex } from "../src/ghost/digest";
import { serializeEnvelope } from "../src/ghost/envelope";
import { validateGhost } from "../src/ghost/grammar";
import {
  assemblePacket,
  GAME_CONVENTIONS,
  PACKET_LIMIT,
  type Packet,
  type PacketCard,
  type PacketInput,
  type PacketView,
  type PacketWord,
} from "../src/ghost/packet";
import {
  ADD_ASSUMPTION,
  ASSUMPTIONS_FILE,
  findMove,
  gameMovesOf,
  MOVES,
  type MoveDefinition,
} from "../src/ghost/registry";
import {
  askForPacket,
  PACKET_REQUEST_KEYS,
  type AskResult,
  type PacketRequest,
} from "../src/ghost/request";
import { createGhostSession } from "../src/ghost/session";
import { readGhostSnapshot, type GhostSnapshot } from "../src/ghost/snapshot";
import {
  CARD_KEYS,
  parseCardLine,
  parseCards,
  serializeCards,
  type Card,
} from "../src/map/cards";
import {
  coinDistance,
  distanceKey,
  parseDistanceLine,
  parseDistances,
  recoinDistanceLine,
  serializeDistances,
  serializeDistanceLine,
  type Distance,
} from "../src/map/distances";
import {
  drawLink,
  flipLink,
  linkKey,
  parseLinkLine,
  parseLinks,
  serializeLinks,
  type Link,
  type LinkSign,
} from "../src/map/links";
import {
  agentReply,
  readFiledEnvelope,
  withWorkspace,
  type Workspace,
} from "./ghost-harness";

/**
 * Epic 11's plain-language check, automated at the RECORD layer (story 4).
 *
 * The locked check (Epic 11 check and slice, its Answer) has three homes, kept
 * apart on purpose:
 *   - THIS FILE walks the RECORD half: the two-context word, the crossings, the
 *     card trial, the hash binding, the negative space and the anti-pattern
 *     absence;
 *   - the SAY-IT legs and the CARD VERDICT live in the JOURNAL (the task text,
 *     both packet hashes, both proposals, the judgment). They are deliberately
 *     NOT asserted here: say-it has no metric by design, and a test cannot judge
 *     whether a card changed a proposal;
 *   - the REAL-WINDOW human pass stays queued (Epic 10's shape).
 *
 * The check's own words: "Take a word that lives in two contexts: at concept it
 * carries TWO distance words on one pair to a partner; at dynamics it carries a
 * signed link on that same pair whose sign the distance words quietly disagree
 * with. ... DO the crossings: flip the sign - both distance words survive
 * exactly; re-coin a distance - the sign survives. Write a game card ... and
 * include it for one ask ... Edit the card validly and ask again: the packet
 * hash changes, the envelope carries it as provenance, and the previous ghost
 * still accepts (nothing refuses - a MALFORMED card refuses at validation,
 * honestly). ... test what is testable: the grammar never reads a card. No
 * silent authorship anywhere."
 *
 * The fixture is the project's own: rain and soil (the committed journeys'
 * words), the coined distance words "waters" (Epic 6's real line) and "soaks"
 * (Epic 4's own "mulch soaks slowly") on ONE pair - the corrected plural
 * instance - and the signed link the committed fixture already carries. The
 * disagreement between the words and the sign is the PERSON'S reading (say-it);
 * these bytes carry both readings and no agreement field, and no code here
 * interprets either.
 *
 * ADR-0019 is the floor, ADR-0027 the card, ADR-0025 the grammar; the map's
 * Answer is the binding.
 */

/* ========================================================================= *
 * The app's own source, read once: the epic's claims are about the shipped
 * text as much as about the records.
 * ========================================================================= */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");
const NL = "\n";

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

/** Every file under a folder, relative to it. */
function walkFiles(root: string, base = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

/** Every app source file (ts/tsx/css), with its app-relative slash path. */
const SOURCES = walkFiles(SRC)
  .filter(
    (path) =>
      path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".css"),
  )
  .map((path) => ({
    path: path.split(sep).join("/"),
    source: readFileSync(join(SRC, path), "utf8"),
  }));

function sourceOf(path: string): string {
  const found = SOURCES.find((entry) => entry.path === path);
  if (found === undefined) throw new Error("no source at " + path);
  return found.source;
}

/**
 * The source with its comments removed: the scans are about what the code
 * DOES, never about the words a doc uses to forbid it ("never merged" is not a
 * merge). The byte door's own comments may name the anti-patterns; the code
 * may not run them.
 */
function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/* ========================================================================= *
 * The record shorthands and the fixture.
 * ========================================================================= */

const WORD = "rain";
const PARTNER = "soil";
/** Two coined distance words on ONE pair (the corrected plural instance). */
const WORD_ONE = "waters";
const WORD_TWO = "soaks";
/** The one sign the pair carries; its disagreement with the words is the person's. */
const REAL_SIGN: LinkSign = "+";

const CARDS_REL = "map/cards.jsonl";
const BASE = '{"on":"soil","text":"the soil holds water"}\n';
const CONTEXT = { level: "dynamics" as const, scenario: null };

/** The word's box on the packet's plane. */
const BOX = { w: 80, h: 30 };

const RAIN: PacketWord = { slug: WORD, name: WORD, x: 0, y: 0, box: BOX };
const SOIL: PacketWord = { slug: PARTNER, name: PARTNER, x: 120, y: 0, box: BOX };

const CARD_CONVENTIONS =
  "a playing set first, then the signed links, the authored quantities and the named loops";
const CARD_EXAMPLE = "an example line that must never ride";

function request(): PacketRequest {
  return {
    move: { family: "assumption", verb: "add" },
    target: { kind: "word", slug: WORD },
  };
}

function view(): PacketView {
  return {
    words: [RAIN, SOIL],
    playing: [WORD, PARTNER],
    marks: [],
    claims: [],
    loops: [],
    veils: [],
  };
}

function snapshot(): GhostSnapshot {
  return {
    level: "dynamics",
    scenario: null,
    dir: "map",
    playing: [WORD, PARTNER],
    words: new Set([WORD, PARTNER]),
    loops: new Set<string>(),
    files: { [ASSUMPTIONS_FILE]: BASE },
  };
}

/**
 * THE TWO-CONTEXT WORD, as bytes: one pair, TWO distance words (concept's
 * reading) and ONE signed link (dynamics' reading). The pair spine is shared;
 * neither record holds the other's field, and nothing between them is derived.
 */
function twoContext(): { distances: Distance[]; links: Link[] } {
  let distances = coinDistance([], WORD, PARTNER, WORD_ONE);
  distances = coinDistance(distances, WORD, PARTNER, WORD_TWO);
  return { distances, links: drawLink([], WORD, PARTNER, REAL_SIGN) };
}

function card(conventions = CARD_CONVENTIONS, extra: Record<string, unknown> = {}): Card {
  return {
    game: "dynamics",
    conventions,
    examples: [CARD_EXAMPLE],
    extra,
  };
}

/** The card as the packet may carry it: game + authored conventions only. */
function packetCard(entry: Card): PacketCard {
  return { game: entry.game, conventions: entry.conventions };
}

function writeCardFile(scratch: Workspace, conventions = CARD_CONVENTIONS): void {
  scratch.write(CARDS_REL, serializeCards([card(conventions)]));
}

function cardsFromFile(scratch: Workspace): readonly Card[] {
  return parseCards(scratch.read(CARDS_REL) ?? "").cards;
}

/** The packet's prose with every run of whitespace collapsed (wrap-proof). */
function flat(bytes: string): string {
  return bytes.replace(/\s+/g, " ").trim();
}

/** The packet's conventions section, from its heading to the next one. */
function gameSection(bytes: string): string {
  const start = bytes.indexOf("## The game this move belongs to");
  const end = bytes.indexOf("## What this move does");
  if (start === -1 || end <= start) throw new Error("the packet has no game section");
  return bytes.slice(start, end);
}

/** Every file under the workspace's map folder, keyed by its slash path. */
function mapBytes(scratch: Workspace): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of walkFiles(join(scratch.path, "map"))) {
    out["map/" + path.split(sep).join("/")] = readFileSync(
      join(scratch.path, "map", path),
      "utf8",
    );
  }
  return out;
}

/** The pure packet over the fixture (the assembler's own input). */
function plainPacket(overrides: Partial<PacketInput> = {}): Packet {
  return assemblePacket({
    entry: ADD_ASSUMPTION,
    target: { kind: "word", slug: WORD },
    person: { selection: null },
    view: view(),
    snapshot: snapshot(),
    ...overrides,
  });
}

interface AskOverrides {
  includeCard?: boolean;
  cards?: readonly PacketCard[];
  creationKinds?: readonly string[];
  request?: PacketRequest;
}

/** One ask over the harness's real workspace. */
async function askOn(scratch: Workspace, overrides: AskOverrides = {}): Promise<AskResult> {
  return askForPacket({
    workspacePath: scratch.path,
    fs: scratch.fs,
    context: CONTEXT,
    request: overrides.request ?? request(),
    person: { selection: null },
    view: view(),
    includeCard: overrides.includeCard ?? false,
    cards: overrides.cards,
    creationKinds: overrides.creationKinds,
  });
}

/**
 * Every callable (a declaration, a method or an arrow) whose parameter list
 * names BOTH record types. Type names appear in annotations only, so this
 * cannot fire on an ordinary call site.
 */
function functionsTakingBoth(text: string): string[] {
  const names: string[] = [];
  const declaration = /([A-Za-z0-9_$]+)\s*\(([^()]*)\)/g;
  let match = declaration.exec(text);
  while (match !== null) {
    const params = match[2];
    if (/\bDistance\b/.test(params) && /\bLink\b/.test(params)) {
      names.push(match[1]);
    }
    match = declaration.exec(text);
  }
  return names;
}

/* ========================================================================= *
 * 1. The two-context word: ONE pair, TWO distance words, ONE sign.
 * ========================================================================= */

describe("the two-context word: two distance words and one sign on one pair", () => {
  test("at concept the pair carries TWO distance words; at dynamics it carries ONE signed link", () => {
    const { distances, links } = twoContext();
    const onPair = distances.filter(
      (distance) => distance.from === WORD && distance.to === PARTNER,
    );
    // The plural instance: TWO coined distance words on ONE pair.
    expect(onPair.map((distance) => distance.word)).toEqual([WORD_ONE, WORD_TWO]);
    expect(new Set(onPair.map((distance) => distance.word)).size).toBe(2);
    // And ONE signed link on that same pair.
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ from: WORD, to: PARTNER, sign: REAL_SIGN, extra: {} });
    // The pair spine is shared: the link's key and the distances' keys name the
    // same endpoints without being the same record.
    expect(linkKey(links[0].from, links[0].to)).toBe(
      linkKey(onPair[0].from, onPair[0].to),
    );
    expect(distanceKey(onPair[0].from, onPair[0].to, onPair[0].word)).not.toBe(
      distanceKey(onPair[1].from, onPair[1].to, onPair[1].word),
    );
  });

  test("the plural instance: N readings against 1 sign, and no aggregation between them", () => {
    const { distances, links } = twoContext();
    const distanceBytes = serializeDistances(distances);
    const linkBytes = serializeLinks(links);

    // Two distance lines, one link line: nothing collapsed either family.
    expect(parseDistances(distanceBytes).distances).toHaveLength(2);
    expect(parseLinks(linkBytes).links).toHaveLength(1);

    // The families' vocabularies stay disjoint: a distance carries the word and
    // no sign; a link carries the sign and no word.
    expect(distanceBytes).not.toContain('"sign"');
    expect(linkBytes).not.toContain('"word"');
    expect(Object.keys(parseDistanceLine(distanceBytes.split(NL)[0])!).sort()).toEqual([
      "extra",
      "from",
      "to",
      "word",
    ]);
    expect(Object.keys(parseLinkLine(linkBytes.split(NL)[0])!).sort()).toEqual([
      "extra",
      "from",
      "sign",
      "to",
    ]);

    // No field anywhere holds an agreement, a merged meaning or a derived
    // verdict: the distance record's key is (from, to, word); the link's is
    // (from, to). Two readings, one structure, nothing between them.
    expect(Object.keys(parseDistances(distanceBytes).distances[0]).sort()).toEqual([
      "extra",
      "from",
      "to",
      "word",
    ]);
    expect(Object.keys(parseLinks(linkBytes).links[0]).sort()).toEqual([
      "extra",
      "from",
      "sign",
      "to",
    ]);
  });

  test("quit and reopen: both faces read exactly as left (byte-exact round trip)", () => {
    const { distances, links } = twoContext();
    const distanceBytes = serializeDistances(distances);
    const linkBytes = serializeLinks(links);

    const reopenedDistances = parseDistances(distanceBytes);
    const reopenedLinks = parseLinks(linkBytes);
    expect(reopenedDistances.malformed).toEqual([]);
    expect(reopenedLinks.malformed).toEqual([]);
    expect(reopenedDistances.distances).toEqual(distances);
    expect(reopenedLinks.links).toEqual(links);
    // The next write is byte-identical: a reopen repairs nothing.
    expect(serializeDistances(reopenedDistances.distances)).toBe(distanceBytes);
    expect(serializeLinks(reopenedLinks.links)).toBe(linkBytes);
  });
});

/* ========================================================================= *
 * 2. The crossings: flip the sign / re-coin a distance, disjointly, in place.
 * ========================================================================= */

describe("the crossings are disjoint in-place rewrites", () => {
  test("flip the sign: both distance words survive byte-exactly", () => {
    const { distances, links } = twoContext();
    const distanceBytes = serializeDistances(distances);
    const flipped = flipLink(links, WORD, PARTNER);

    expect(serializeLinks(flipped)).toBe(
      '{"from":"rain","sign":"-","to":"soil"}' + NL,
    );
    // The whole distance file is untouched, byte for byte.
    expect(serializeDistances(distances)).toBe(distanceBytes);
    expect(parseDistances(distanceBytes).distances.map((distance) => distance.word)).toEqual([
      WORD_ONE,
      WORD_TWO,
    ]);
    // The sign is revision, not a new record: one line, in place, no trace of
    // the distance words having been read.
    expect(flipped).toHaveLength(1);
    expect(flipped[0].extra).toEqual({});
    expect(serializeLinks(flipped)).not.toContain(WORD_ONE);
    expect(serializeLinks(flipped)).not.toContain(WORD_TWO);
  });

  test("re-coin a distance: the sign survives exactly", () => {
    const { distances, links } = twoContext();
    const linkBytes = serializeLinks(links);
    const recoined = recoinDistanceLine(distances, distances[1], "drinks");

    expect(recoined.collided).toBe(false);
    expect(recoined.distances.map((distance) => distance.word)).toEqual([
      WORD_ONE,
      "drinks",
    ]);
    // The untouched sibling's line is byte-identical; the pair keeps two words.
    expect(serializeDistanceLine(recoined.distances[0])).toBe(
      serializeDistanceLine(distances[0]),
    );
    // The links file never moves: the sign is not re-derived from the new word.
    expect(serializeLinks(links)).toBe(linkBytes);
    expect(serializeLinks(links)).toContain('"sign":"+"');
    expect(linkBytes).not.toContain("drinks");
  });

  test("the two rewrites are disjoint and in place: no line count moves, and flip twice returns the bytes", () => {
    const { distances, links } = twoContext();
    const distanceBytes = serializeDistances(distances);
    const linkBytes = serializeLinks(links);

    // Flip: one link line before and after; the distance file unchanged.
    const flipped = flipLink(links, WORD, PARTNER);
    expect(serializeLinks(flipped).split(NL).filter(Boolean)).toHaveLength(1);
    expect(serializeDistances(distances)).toBe(distanceBytes);
    // Flipping twice is the original bytes (revision, not history).
    expect(serializeLinks(flipLink(flipped, WORD, PARTNER))).toBe(linkBytes);

    // Re-coin: two distance lines before and after; the link unchanged.
    const recoined = recoinDistanceLine(distances, distances[0], "pools");
    expect(serializeDistances(recoined.distances).split(NL).filter(Boolean)).toHaveLength(2);
    expect(serializeLinks(links)).toBe(linkBytes);
    // Re-coin is in place: the sibling keeps its own line and position, the
    // re-coined line is the pinned survivor (the pair still carries two words).
    expect(recoined.distances.map((distance) => distance.word)).toEqual([
      WORD_TWO,
      "pools",
    ]);
    expect(serializeDistanceLine(recoined.distances[0])).toBe(
      serializeDistanceLine(distances[1]),
    );
    expect(recoined.distances[1].extra).toEqual(distances[0].extra);
  });
});

/* ========================================================================= *
 * 3. The card trial: the derived moves line, key-set validation, the person's
 *    inclusion.
 * ========================================================================= */

describe("the card trial: derived moves, key-set validation, the person's inclusion", () => {
  test("the moves line is DERIVED from the game's two sources through one helper", () => {
    expect(gameMovesOf("dynamics", MOVES, creationKinds("dynamics"))).toEqual([
      "assumption/add",
      "word",
      "lack",
      "assumption",
    ]);
    // One implementation, in the ghost/registry side; the record module derives
    // no moves of its own.
    const definitions = SOURCES.filter((entry) => entry.source.includes("function gameMovesOf"));
    expect(definitions.map((entry) => entry.path)).toEqual(["ghost/registry.ts"]);
    expect(sourceOf("map/cards.ts")).not.toMatch(/gameMovesOf\s*\(/);
    // A hand-authored moves key is an unknown, never a second truth: the card's
    // looked-for keys have no moves slot at all.
    const hand =
      '{"conventions":"x","examples":["y"],"game":"dynamics","moves":["a coined name"]}';
    const parsed = parseCardLine(hand);
    expect(parsed).not.toBeNull();
    expect(parsed?.extra.moves).toEqual(["a coined name"]);
    expect(CARD_KEYS as readonly string[]).not.toContain("moves");
    expect(gameMovesOf(parsed!.game, MOVES, creationKinds(parsed!.game))).not.toContain(
      "a coined name",
    );
  });

  test("the card's key set has no name slot: a name-shaped key is refused at the field level", () => {
    const named = JSON.stringify({
      game: "dynamics",
      conventions: "a note",
      examples: ["a placeholder word"],
      name: "storm",
    });
    expect(parseCardLine(named)).toBeNull();
    const parsed = parseCards(named + NL);
    expect(parsed.cards).toEqual([]);
    expect(parsed.malformed).toEqual([named]);
    // The family posture: the refused line is preserved verbatim, never dropped.
    expect(serializeCards(parsed.cards, parsed.malformed)).toBe(named + NL);
    // Structurally there is nowhere for a name to live.
    expect([...CARD_KEYS]).toEqual(["game", "conventions", "examples"]);
    expect(CARD_KEYS as readonly string[]).not.toContain("name");
    expect(Object.keys(card()).sort()).toEqual(["conventions", "examples", "extra", "game"]);
    // The belt-and-braces field refusal (the structural check is the test).
    expect(parseCardLine(named.replace('"name"', '" Name "'))).toBeNull();
  });

  test("the inclusion is OFF by default: the default conventions stand byte-identically", () => {
    const without = plainPacket();
    const carryingButOff = plainPacket({ cards: [packetCard(card())] });
    expect(carryingButOff.freeze.bytes).toBe(without.freeze.bytes);
    expect(carryingButOff.freeze.hash).toBe(without.freeze.hash);
    expect(flat(without.freeze.bytes)).toContain(flat(GAME_CONVENTIONS.dynamics));
    expect(without.freeze.bytes).not.toContain("card: ");
    // No card read is required to ask the default packet: the assembler needs no
    // card data when the person has not included one.
    expect(without.freeze.bytes).toContain(PACKET_LIMIT);
  });

  test("when ON the card replaces the default section and nothing else in the packet moves", () => {
    const plain = plainPacket();
    const on = plainPacket({
      includeCard: true,
      cards: [packetCard(card())],
      creationKinds: creationKinds("dynamics"),
    });

    const text = flat(on.freeze.bytes);
    expect(text).toContain(
      "card: dynamics — assumption/add, word, lack, assumption; " + CARD_CONVENTIONS,
    );
    // The default prose is GONE (replaced, not appended beside).
    expect(text).not.toContain(flat(GAME_CONVENTIONS.dynamics));
    expect(on.freeze.bytes).not.toBe(plain.freeze.bytes);
    expect(on.freeze.hash).not.toBe(plain.freeze.hash);
    // The REPLACEMENT is section-local: swapping the game section back yields the
    // plain packet's exact bytes, so the boundary, the records and the limit
    // sentence did not move.
    const replaced =
      on.freeze.bytes.slice(0, on.freeze.bytes.indexOf(gameSection(on.freeze.bytes))) +
      gameSection(plain.freeze.bytes) +
      on.freeze.bytes.slice(
        on.freeze.bytes.indexOf(gameSection(on.freeze.bytes)) +
          gameSection(on.freeze.bytes).length,
      );
    expect(replaced).toBe(plain.freeze.bytes);
    expect(on.freeze.bytes).toContain(PACKET_LIMIT);
  });

  test("the packet derives the card's moves from the table it is handed: a fixture row proves both sources, unregistered", () => {
    const fixtureRow: MoveDefinition = {
      ...ADD_ASSUMPTION,
      move: { family: "quantity", verb: "add" },
    };
    const fixturePacket = plainPacket({
      includeCard: true,
      cards: [packetCard(card())],
      moves: [ADD_ASSUMPTION, fixtureRow],
      creationKinds: ["word", "mark"],
    });
    expect(flat(fixturePacket.freeze.bytes)).toContain(
      "card: dynamics — assumption/add, quantity/add, word, mark; " + CARD_CONVENTIONS,
    );
    // The fixture row changes the packet without being REGISTERED: the live
    // table is still one move and the door still refuses it.
    expect(MOVES).toHaveLength(1);
    expect(findMove({ family: "quantity", verb: "add" })).toBeNull();
    // Both sources are data: the registry rows and the ring's kinds.
    expect(gameMovesOf("dynamics", [ADD_ASSUMPTION, fixtureRow], ["word", "mark"])).toEqual([
      "assumption/add",
      "quantity/add",
      "word",
      "mark",
    ]);
  });

  test("the request cannot smuggle the inclusion (its keys are exactly move/target)", () => {
    return withWorkspace(async (scratch) => {
      writeCardFile(scratch);
      expect(PACKET_REQUEST_KEYS).toEqual(["move", "target"]);
      for (const key of PACKET_REQUEST_KEYS) {
        expect(key).not.toMatch(/card|include|convention/);
      }
      const clean = await askOn(scratch, {
        includeCard: false,
        cards: cardsFromFile(scratch).map(packetCard),
        creationKinds: creationKinds("dynamics"),
      });
      const dirty = await askOn(scratch, {
        includeCard: false,
        cards: cardsFromFile(scratch).map(packetCard),
        creationKinds: creationKinds("dynamics"),
        request: {
          ...request(),
          includeCard: true,
          cards: [packetCard(card())],
          conventions: "a request's note",
        } as unknown as PacketRequest,
      });
      if (!clean.ok) throw new Error("expected a clean packet");
      if (!dirty.ok) throw new Error("expected a dirty packet");
      expect(dirty.packet.freeze.bytes).toBe(clean.packet.freeze.bytes);
      expect(dirty.packet.freeze.hash).toBe(clean.packet.freeze.hash);
      expect(dirty.packet.freeze.bytes).not.toContain("a request's note");
      expect(dirty.packet.freeze.bytes).not.toContain("card: ");
    });
  });

  test("a MALFORMED card refuses at card validation, honestly (and never rides)", () => {
    const malformed = '{"game":"dynamics","conventions":"","examples":["x"]}';
    const parsed = parseCards(malformed + NL);
    expect(parsed.cards).toEqual([]);
    expect(parsed.malformed).toEqual([malformed]);
    // The family posture: preserved verbatim on the way out, never dropped.
    expect(serializeCards(parsed.cards, parsed.malformed)).toBe(malformed + NL);
    // With no readable card the include flag leaves the default standing: the
    // card's own validation refused the LINE, and the ghost machinery refused
    // nothing (a card is not the grammar's).
    const packet = plainPacket({
      includeCard: true,
      cards: parsed.cards.map(packetCard),
      creationKinds: creationKinds("dynamics"),
    });
    expect(flat(packet.freeze.bytes)).toContain(flat(GAME_CONVENTIONS.dynamics));
    expect(packet.freeze.bytes).not.toContain("card: ");
  });
});

/* ========================================================================= *
 * 4. The packet-hash binding: provenance in the envelope, never enforcement.
 * ========================================================================= */

describe("the packet-hash binding: provenance, never enforcement", () => {
  test("ask, freeze, intake: the hash rides the envelope and the card stays out of the pin", () => {
    return withWorkspace(async (scratch) => {
      writeCardFile(scratch);
      const before = await askOn(scratch, {
        includeCard: true,
        cards: cardsFromFile(scratch).map(packetCard),
        creationKinds: creationKinds("dynamics"),
      });
      if (!before.ok) throw new Error("expected a packet");
      // The pin is read at the ask moment from the move's own file.
      expect(before.packet.freeze.pin.files[ASSUMPTIONS_FILE]).toBe(sha256Hex(BASE));
      expect(Object.keys(before.packet.freeze.pin.files)).toEqual([ASSUMPTIONS_FILE]);

      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
        mintId: () => "ghost-epic11-provenance",
      });
      await session.open();
      const intake = await session.intake(agentReply(), CONTEXT, before.packet.freeze.hash);
      if (!intake.envelope) throw new Error("expected an envelope");
      const filed = readFiledEnvelope(scratch, intake.envelope.id);
      expect(filed.packetHash).toBe(before.packet.freeze.hash);
      expect(filed.expect).toEqual(before.packet.freeze.pin);
      // The provenance is visible in the bytes; the card's content is not.
      expect(serializeEnvelope(filed)).toContain(before.packet.freeze.hash);
      expect(serializeEnvelope(filed)).not.toContain(CARD_CONVENTIONS);
      expect(serializeEnvelope(filed)).not.toContain(CARD_EXAMPLE);
    });
  });

  test("a valid card edit + a new ask = a new hash; the previous ghost still accepts", () => {
    return withWorkspace(async (scratch) => {
      writeCardFile(scratch);
      const first = await askOn(scratch, {
        includeCard: true,
        cards: cardsFromFile(scratch).map(packetCard),
        creationKinds: creationKinds("dynamics"),
      });
      if (!first.ok) throw new Error("expected a first packet");
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
        mintId: () => "ghost-epic11-edit",
      });
      await session.open();
      const intake = await session.intake(agentReply(), CONTEXT, first.packet.freeze.hash);
      if (!intake.envelope) throw new Error("expected an envelope");
      const id = intake.envelope.id;

      // The person edits the card VALIDLY and asks again.
      writeCardFile(scratch, "an edited dynamics note");
      const second = await askOn(scratch, {
        includeCard: true,
        cards: cardsFromFile(scratch).map(packetCard),
        creationKinds: creationKinds("dynamics"),
      });
      if (!second.ok) throw new Error("expected a second packet");
      expect(second.packet.freeze.bytes).not.toBe(first.packet.freeze.bytes);
      expect(second.packet.freeze.hash).not.toBe(first.packet.freeze.hash);
      expect(flat(second.packet.freeze.bytes)).toContain("an edited dynamics note");
      // The pin did not move with the card (the card is not a record the move
      // touches), and the first filed hash is still exactly the first packet's.
      expect(second.packet.freeze.pin).toEqual(first.packet.freeze.pin);
      const stillFiled = readFiledEnvelope(scratch, id);
      expect(stillFiled.packetHash).toBe(first.packet.freeze.hash);
      // The grammar still accepts the OLD envelope against the same records: a
      // card edit refuses nothing.
      const now = await readGhostSnapshot(scratch.fs, scratch.path, {
        level: "dynamics",
        scenario: null,
        files: [ASSUMPTIONS_FILE],
      });
      expect(validateGhost(stillFiled, now).ok).toBe(true);

      const beforeAccept = mapBytes(scratch);
      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("applied");
      if (accept.outcome !== "applied") return;
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        BASE + accept.steps[0].line + NL,
      );
      // The accept wrote the claim and NOTHING else: the card file is the
      // person's, untouched by the accept (no silent authorship).
      const afterAccept = mapBytes(scratch);
      const changed = Object.keys(afterAccept).filter(
        (path) => afterAccept[path] !== beforeAccept[path],
      );
      expect(changed).toEqual([ASSUMPTIONS_FILE]);
      expect(afterAccept[CARDS_REL]).toBe(beforeAccept[CARDS_REL]);
    });
  });

  test("a tampered hash refuses nothing (the grammar never reads the value)", () => {
    return withWorkspace(async (scratch) => {
      writeCardFile(scratch);
      const asked = await askOn(scratch, {
        includeCard: true,
        cards: cardsFromFile(scratch).map(packetCard),
        creationKinds: creationKinds("dynamics"),
      });
      if (!asked.ok) throw new Error("expected a packet");
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
        mintId: () => "ghost-epic11-tampered",
      });
      await session.open();
      const intake = await session.intake(agentReply(), CONTEXT, asked.packet.freeze.hash);
      if (!intake.envelope) throw new Error("expected an envelope");
      const id = intake.envelope.id;
      const path = ".attentioneer/inbox/" + id + ".json";
      const raw = JSON.parse(scratch.read(path) ?? "{}");
      // A hand edit replaces the provenance with a number: the key is allowed,
      // the value is never inspected.
      raw.packetHash = 12345;
      scratch.write(path, JSON.stringify(raw, null, 2));

      const filed = readFiledEnvelope(scratch, id);
      expect(filed.packetHash as unknown).toBe(12345);
      const now = await readGhostSnapshot(scratch.fs, scratch.path, {
        level: "dynamics",
        scenario: null,
        files: [ASSUMPTIONS_FILE],
      });
      expect(validateGhost(filed, now).ok).toBe(true);
      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("applied");
    });
  });

  test("the grammar never reads a card (source-scanned over the ghost layer)", () => {
    const grammar = codeOf(sourceOf("ghost/grammar.ts"));
    for (const dead of [
      "map/cards",
      "parseCards",
      "cardOf",
      "CARD_KEYS",
      "gameMovesOf",
      "cards.jsonl",
    ]) {
      expect({ dead, found: grammar.includes(dead) }).toEqual({ dead, found: false });
    }
    // No ghost module imports the card record: the card arrives as plain data.
    for (const entry of SOURCES) {
      if (!entry.path.startsWith("ghost/")) continue;
      expect({ path: entry.path, imports: /from\s+["'][^"']*map\/cards/.test(entry.source) }).toEqual({
        path: entry.path,
        imports: false,
      });
    }
    // The packet derives the moves from data, not from the record module (its
    // doc names the path; its code never imports or reads it).
    expect(codeOf(sourceOf("ghost/packet.ts"))).not.toContain("map/cards");
    expect(codeOf(sourceOf("ghost/packet.ts"))).toContain("gameMovesOf");
  });
});

/* ========================================================================= *
 * 5. The negative space: content, never a pin, a record or a verdict.
 * ========================================================================= */

describe("the negative space: no pin, no record, no silent authorship", () => {
  test("the card never enters the base pin", () => {
    const without = plainPacket();
    const withCard = plainPacket({
      includeCard: true,
      cards: [packetCard(card())],
      creationKinds: creationKinds("dynamics"),
    });
    expect(withCard.freeze.pin).toEqual(without.freeze.pin);
    expect(Object.keys(withCard.freeze.pin.files)).toEqual([ASSUMPTIONS_FILE]);
    expect(JSON.stringify(withCard.freeze.pin)).not.toContain(CARD_CONVENTIONS);
    expect(JSON.stringify(withCard.freeze.pin)).not.toContain(CARD_EXAMPLE);
  });

  test("examples never ride the packet, the envelope or the records", () => {
    const on = plainPacket({
      includeCard: true,
      cards: [packetCard(card())],
      creationKinds: creationKinds("dynamics"),
    });
    expect(flat(on.freeze.bytes)).toContain(CARD_CONVENTIONS);
    expect(on.freeze.bytes).not.toContain(CARD_EXAMPLE);
    // The packet's card shape carries the two visible halves only: examples are
    // person-facing, and the type has no field for them.
    expect(Object.keys(packetCard(card())).sort()).toEqual(["conventions", "game"]);
    // The card line's moves half is derived from the game's sources, never a
    // hand-copied list: the live derivation matches what the packet shows.
    expect(flat(on.freeze.bytes)).toContain(
      gameMovesOf("dynamics", MOVES, creationKinds("dynamics")).join(", "),
    );
  });

  test("no app path authors a card: the record's writer has no caller (hand-authored)", () => {
    const writers = SOURCES.filter(
      (entry) => entry.path !== "map/cards.ts" && /\bsaveCards\s*\(/.test(entry.source),
    );
    expect(writers.map((entry) => entry.path)).toEqual([]);
    // The app reads cards only when the person includes one, through its own
    // provider, and the ghost layer never touches the file.
    expect(sourceOf("App.tsx")).toContain("loadCards");
    expect(sourceOf("ghost/useRequest.ts")).toContain("includeCard &&");
    // No ghost module reads or writes the card record: the card arrives as
    // plain data, and nothing in the ghost layer could author one.
    for (const entry of SOURCES) {
      if (!entry.path.startsWith("ghost/")) continue;
      const code = codeOf(entry.source);
      expect({
        path: entry.path,
        record: /saveCards|loadCards|parseCards|map\/cards/.test(code),
      }).toEqual({ path: entry.path, record: false });
    }
  });
});

/* ========================================================================= *
 * 6. The anti-pattern absence: the contradiction machinery is not in the app.
 * ========================================================================= */

describe("the anti-pattern absence: no merge, average, reconcile, warn, compare, unify, translate, update-the-other, agreement-ordering or interpolating display", () => {
  const PAIR_MODULES = [
    "map/distances.ts",
    "map/links.ts",
    "canvas/DistanceWire.tsx",
    "canvas/LinkWire.tsx",
    "canvas/SignChoice.tsx",
    "canvas/signChoiceRules.ts",
    "canvas/zoomBands.ts",
  ];

  /**
   * ADR-0033's ontology artifact must SAY that it is not merged — the sentence
   * is part of the artifact's fixed honesty block (research note §5.4), the
   * refusal of the machinery this scan forbids. It is one template string in a
   * renderer and nothing else, so the scan subtracts exactly that sentence and
   * stays strict about every other use of the word.
   */
  const ARTIFACT_REFUSAL =
    /Not merged: a word shared with another game keeps its own sense there; contradictions are kept, not resolved./g;

  test("the machinery's unambiguous names have no code path anywhere in the app", () => {
    const dead = ["merge", "average", "warn", "unify", "agreement", "interpolat"];
    for (const entry of SOURCES) {
      const code = codeOf(entry.source).replace(ARTIFACT_REFUSAL, " ");
      for (const word of dead) {
        expect({ path: entry.path, word, found: new RegExp("\\b" + word, "i").test(code) }).toEqual({
          path: entry.path,
          word,
          found: false,
        });
      }
    }
  });

  test("reconcile names only the ghost's crash recovery, never a pair's two readings", () => {
    const offenders = SOURCES.filter(
      (entry) => /\breconcil/i.test(codeOf(entry.source)) && !entry.path.startsWith("ghost/"),
    );
    expect(offenders.map((entry) => entry.path)).toEqual([]);
  });

  test("compare belongs to the branch comparison, never to a distance word against a sign", () => {
    // The pair's own modules never compare (the pair test above lists them).
    for (const path of PAIR_MODULES) {
      expect({ path, found: /\bcompare/i.test(codeOf(sourceOf(path))) }).toEqual({
        path,
        found: false,
      });
    }
    // The branch comparison reads the model's readings (set, links, quantities,
    // claims); it has no distance face, so it cannot compare a coined distance
    // word with a sign.
    for (const path of ["scenarios/compare.ts", "scenarios/compareRead.ts"]) {
      expect({ path, distance: /\bDistance\b/.test(codeOf(sourceOf(path))) }).toEqual({
        path,
        distance: false,
      });
    }
    expect(sourceOf("scenarios/compare.ts")).not.toContain("map/distances");
  });

  test("translate appears only as a CSS transform, never as rendering one record in the other's words", () => {
    const hits = SOURCES.flatMap((entry) =>
      codeOf(entry.source)
        .split(NL)
        .filter((line) => /\btranslate/i.test(line))
        .map((line) => ({ path: entry.path, line: line.trim() })),
    );
    expect(hits.length).toBeGreaterThan(0);
    // Every occurrence is a CSS transform value or d3's zoom transform, never a
    // function that renders one record in the other's vocabulary.
    const transform = /transform\s*[:=]|zoomIdentity\.translate|\btranslate(3d|X|Y)?\s*\(/;
    for (const hit of hits) {
      expect({ ...hit, isTransform: transform.test(hit.line) }).toEqual({
        ...hit,
        isTransform: true,
      });
    }
  });

  test("the pair's own modules carry none of the machinery's names", () => {
    const dead = [
      "merge",
      "average",
      "reconcile",
      "warn",
      "compare",
      "unify",
      "agreement",
      "interpolat",
      "update",
    ];
    for (const path of PAIR_MODULES) {
      const code = codeOf(sourceOf(path));
      for (const word of dead) {
        expect({ path, word, found: new RegExp("\\b" + word, "i").test(code) }).toEqual({
          path,
          word,
          found: false,
        });
      }
    }
  });

  test("the distance and link records never carry the other's field, and no function takes both", () => {
    const distances = codeOf(sourceOf("map/distances.ts"));
    const links = codeOf(sourceOf("map/links.ts"));
    expect(distances).not.toMatch(/\bsign\b/i);
    expect(links).not.toMatch(/\bword\b/i);
    expect(links).not.toMatch(/\bdistance\b/i);
    expect(distances).not.toMatch(/["'][^"']*links["']/);
    expect(links).not.toMatch(/["'][^"']*distances["']/);
    // No function derives anything from a Distance and a Link together: there
    // is no place a merge/average/compare helper could live.
    const offenders: string[] = [];
    for (const entry of SOURCES) {
      if (!entry.path.endsWith(".ts") && !entry.path.endsWith(".tsx")) continue;
      for (const name of functionsTakingBoth(codeOf(entry.source))) {
        offenders.push(entry.path + "#" + name);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("nothing reads a sign and a distance word in one breath (no agreement ordering)", () => {
    const offenders = SOURCES.filter((entry) =>
      /\.sign\b[^\n]{0,120}\.word\b|\.word\b[^\n]{0,120}\.sign\b/.test(codeOf(entry.source)),
    );
    expect(offenders.map((entry) => entry.path)).toEqual([]);
    // And the record modules' own exports are typed apart: flipping returns
    // links, re-coining returns distances.
    expect(sourceOf("map/links.ts")).toContain("export function flipLink(");
    expect(sourceOf("map/links.ts")).not.toContain("Distance");
    expect(sourceOf("map/distances.ts")).not.toContain("Link");
  });

  test("the pair's rendering never interpolates one record into the other", () => {
    const distanceWire = codeOf(sourceOf("canvas/DistanceWire.tsx"));
    const linkWire = codeOf(sourceOf("canvas/LinkWire.tsx"));
    const signChoice = codeOf(sourceOf("canvas/SignChoice.tsx"));
    expect(distanceWire).not.toMatch(/\bsign\b/i);
    expect(linkWire).not.toMatch(/\bword\b/i);
    expect(linkWire).not.toMatch(/\bdistance\b/i);
    expect(signChoice).not.toMatch(/\bword\b/i);
    expect(signChoice).not.toMatch(/\bdistance\b/i);
    // The sign's meaning is never rendered beside the distance word: the
    // distance label is the coined word alone, and the sign sits at the link's
    // head. The agent's pair view stays the named debt: the packet carries no
    // distance and no link at all.
    const packet = codeOf(sourceOf("ghost/packet.ts"));
    expect(packet).not.toMatch(/\bDistance\b/);
    expect(packet).not.toMatch(/\bLink\b/);
    expect(packet).not.toMatch(/from\s+["'][^"']*map\/(distances|links)/);
  });
});

/* ========================================================================= *
 * 7. The retired phrases stay retired.
 * ========================================================================= */

describe("the retired phrases stay retired", () => {
  const RETIRED = [
    /compact definition/i,
    /output schema/i,
    /a card is a definition/i,
    /the moves line is authored/i,
    /moves line authored/i,
    /authored moves/i,
    /the card's bytes join the base pin/i,
    /the card joins the base pin/i,
    /the card enforces/i,
    /the grammar reads (a|the) card/i,
    /notices strip names them/i,
    /tentative at dynamics/i,
    /settled at concept/i,
    /both on screen/i,
    /merged definition/i,
    /single definition/i,
  ];

  test("the card is no longer a definition, an output schema or an authored moves line", () => {
    for (const entry of SOURCES) {
      for (const pattern of RETIRED) {
        expect({ path: entry.path, pattern: String(pattern), found: pattern.test(entry.source) }).toEqual({
          path: entry.path,
          pattern: String(pattern),
          found: false,
        });
      }
    }
    // The amendments are the shipped wording: derived moves, no definition.
    expect(sourceOf("map/cards.ts")).toContain("never a definition of it");
    expect(sourceOf("map/cards.ts")).toContain("The MOVES line is DERIVED");
    expect(sourceOf("map/cards.ts")).not.toContain("output schema");
  });

  test("the card stays out of the pin and never enforces (the amendments stand in the app's words)", () => {
    expect(sourceOf("ghost/packet.ts")).toContain("The card never enforces");
    expect(sourceOf("ghost/packet.ts")).toContain("not a pin");
    expect(sourceOf("ghost/envelope.ts")).toContain("PROVENANCE, never enforcement");
    expect(sourceOf("ghost/envelope.ts")).toContain("card stays OUT of the");
    // The cards file is named in the record module only: no batch, no branch,
    // no scaffold promises a card writer.
    expect(sourceOf("map/cards.ts")).toContain("map/cards.jsonl");
    expect(sourceOf("map/patches.ts")).not.toMatch(/saveCards|cardsPath|serializeCards/);
  });

  test("the contradiction instance's retired example and the card notice overclaim stay retired", () => {
    expect(sourceOf("map/cards.ts")).not.toContain("notices strip names them");
    // No card is a notice family: the malformed-card limit is the story's named
    // follow-up, not a shipped claim.
    expect(sourceOf("canvas/notices.ts")).not.toContain("cards.jsonl");
    // The card's read surfaces malformed lines in its own returned list (the
    // family posture); that is the honest, shipped surfacing.
    const parsed = parseCards(
      '{"game":"dynamics","conventions":"x","examples":["y"]}' + NL + "not json" + NL,
    );
    expect(parsed.malformed).toEqual(["not json"]);
  });
});

/* ========================================================================= *
 * 8. The whole check, in the check's order (the record half, end to end).
 * ========================================================================= */

describe("the whole check, in the check's order", () => {
  test("two contexts, the crossings, the card trial, the hash binding, the old ghost's accept, reopen", () => {
    return withWorkspace(async (scratch) => {
      // (a) The two-context word: one pair, two distance words, one sign.
      const { distances, links } = twoContext();
      scratch.write("map/distances.jsonl", serializeDistances(distances));
      scratch.write("map/links.jsonl", serializeLinks(links));
      const distanceBytes = serializeDistances(distances);
      const linkBytes = serializeLinks(links);

      // (b) DO the crossings; each leaves the other file's bytes exactly.
      const flipped = flipLink(links, WORD, PARTNER);
      scratch.write("map/links.jsonl", serializeLinks(flipped));
      expect(scratch.read("map/distances.jsonl")).toBe(distanceBytes);
      const recoined = recoinDistanceLine(distances, distances[1], "drinks");
      scratch.write("map/distances.jsonl", serializeDistances(recoined.distances));
      expect(scratch.read("map/links.jsonl")).toContain('"sign":"-"');
      expect(scratch.read("map/links.jsonl")).not.toContain("drinks");

      // (c) Write the card and include it for ONE ask; the moves line derives.
      writeCardFile(scratch);
      const asked = await askOn(scratch, {
        includeCard: true,
        cards: cardsFromFile(scratch).map(packetCard),
        creationKinds: creationKinds("dynamics"),
      });
      if (!asked.ok) throw new Error("expected a packet");
      expect(flat(asked.packet.freeze.bytes)).toContain(
        "card: dynamics — assumption/add, word, lack, assumption; " + CARD_CONVENTIONS,
      );

      // (d) Intake carries the frozen hash as provenance.
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
        mintId: () => "ghost-epic11-whole",
      });
      await session.open();
      const intake = await session.intake(agentReply(), CONTEXT, asked.packet.freeze.hash);
      if (!intake.envelope) throw new Error("expected an envelope");
      expect(readFiledEnvelope(scratch, intake.envelope.id).packetHash).toBe(
        asked.packet.freeze.hash,
      );

      // (e) Edit the card validly and ask again: a new hash, the same pin.
      writeCardFile(scratch, "an edited dynamics note");
      const again = await askOn(scratch, {
        includeCard: true,
        cards: cardsFromFile(scratch).map(packetCard),
        creationKinds: creationKinds("dynamics"),
      });
      if (!again.ok) throw new Error("expected a second packet");
      expect(again.packet.freeze.hash).not.toBe(asked.packet.freeze.hash);
      expect(again.packet.freeze.pin).toEqual(asked.packet.freeze.pin);

      // (f) The PREVIOUS ghost still accepts; nothing refuses.
      const beforeAccept = mapBytes(scratch);
      const accept = await session.accept(intake.envelope.id, CONTEXT);
      expect(accept.outcome).toBe("applied");
      if (accept.outcome !== "applied") return;
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(BASE + accept.steps[0].line + NL);
      const afterAccept = mapBytes(scratch);
      expect(
        Object.keys(afterAccept).filter((path) => afterAccept[path] !== beforeAccept[path]),
      ).toEqual([ASSUMPTIONS_FILE]);
      expect(afterAccept[CARDS_REL]).toBe(beforeAccept[CARDS_REL]);

      // (g) Quit, reopen: every record as left; the crossings stuck.
      const reopenedDistances = parseDistances(scratch.read("map/distances.jsonl") ?? "");
      const reopenedLinks = parseLinks(scratch.read("map/links.jsonl") ?? "");
      expect(reopenedDistances.malformed).toEqual([]);
      expect(reopenedLinks.malformed).toEqual([]);
      expect(reopenedDistances.distances.map((distance) => distance.word)).toEqual([
        WORD_ONE,
        "drinks",
      ]);
      expect(reopenedLinks.links.map((link) => link.sign)).toEqual(["-"]);
      expect(serializeDistances(reopenedDistances.distances)).toBe(
        scratch.read("map/distances.jsonl"),
      );
      expect(serializeLinks(reopenedLinks.links)).toBe(scratch.read("map/links.jsonl"));
      expect(parseCards(scratch.read(CARDS_REL) ?? "").cards).toHaveLength(1);
      // The card's content became no record, and the ask left no inbox file
      // behind: the accept deleted it.
      expect(scratch.read(ASSUMPTIONS_FILE)).not.toContain(CARD_CONVENTIONS);
      const next = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
        mintId: () => "ghost-epic11-whole-2",
      });
      expect(await next.open()).toEqual({ envelopes: 0, markers: 0 });
      expect(next.registered()).toEqual([]);
    });
  });
});
