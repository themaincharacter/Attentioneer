import { canonicalJson, canonicalText } from "../lib/serialize";
import {
  assumptionTargetKey,
  serializeAssumptionLine,
  type Assumption,
} from "../map/assumptions";
import { loopSlug, type Loop } from "../map/loops";
import { serializeMarkLine, type Mark } from "../map/marks";
import type { Reference } from "../map/refs";
import { veilsCoveringWord, type PlacedWord, type Veil } from "../map/veils";
import { sha256Hex } from "./digest";
import type { GhostExpect, GhostGame, GhostTarget } from "./envelope";
import {
  authorableTargetKinds,
  pinOf,
  registeredMovesOf,
  registryHash,
  type MoveDefinition,
  type ParamField,
} from "./registry";
import type { GhostSnapshot } from "./snapshot";

/**
 * THE CONTEXT PACKET (Epic 10 story 2, ADR-0026) — the small, task-specific
 * view one delegated move is asked with, assembled by the app and FROZEN.
 *
 * The packet is PURE and app-assembled: it reads the map's records (handed to
 * it by the app, verbatim) and returns bytes plus the frozen triple. It never
 * reads a file, never writes, never touches the inbox, and never sees a token
 * budget — its economy is a RECORD bound, and the packet states its own limit
 * qualitatively ("This view; the map is larger.") instead of measuring itself.
 *
 * THE REGION IS THE PERSON'S (ADR-0026 decision 1). This module cannot be
 * handed a request-chosen region by construction: assemblePacket takes the
 * NAMED TARGET and the person's own PersonRegion as SEPARATE arguments, and
 * regionOf reads nothing but the target, the person's selection and the map.
 * When the person has selected words that selection IS the region; otherwise
 * the region is the named target plus the playing set (the ADR's fallback).
 * The request never curates, so a different selection makes different bytes.
 *
 * THE HONESTY NEGATIVES (ADR-0026 decision 2, the ticket's ruling):
 *   - records, not tokens — each record rides as it stands: its own marks (the
 *     exact canonical JSONL line, unknown keys included), its own words (a
 *     coined name verbatim, an assumption's text verbatim), and the family's
 *     posture ("kept and shown, never repaired or tidied");
 *   - the region's own records and nothing else — a word, mark, claim, loop or
 *     veil outside the region never rides, so the packet never grows with the
 *     map and never summarizes what it left out (no "N more", no "and others",
 *     no remainder sentence of any kind);
 *   - no counts, no scores, no certainty label, and never a path into the
 *     app's scratch area — the inbox is not a record and never appears;
 *   - a veil rides as PRESENCE, NAME and LOCATION only: veilPlacementOf drops
 *     the reason (the type it returns has no field for it), and a veil's entry
 *     never enumerates what it covers. A covered word that rides does so as
 *     the REGION's own record (the person's choice, or the target's playing
 *     set) — never as content read out of the veil.
 *
 * THE FROZEN TRIPLE (ADR-0026 decision 3) = the packet's bytes + the base pin
 * (the envelope's expect, minted by pinOf) + the registry version as a DERIVED
 * hash (never hand-bumped). freezePacket hashes the three into one packet
 * hash, so the reshape record's "pin and packet hash" (story 3) name the exact
 * bytes, base and grammar the proposal was asked under — two expansion runs
 * are comparable.
 *
 * The behavioral boundary is the registry's own boundary string (data): what
 * the move DOES, never the validator's keys (echoing the grammar would turn a
 * cheap grammar-fail into prompt-compliance). The move's shape and the game's
 * REGISTERED moves are the registry's too (Epic 11 story 2): the operations
 * line is derived from the same table, never hand-copied here.
 *
 * Levels are untouched here: the packet is the dynamics move's view, and the
 * request surface (request.ts) refuses another band.
 *
 * Provisional: the packet's wording and section order, PacketWord.box (the
 * veil's centre rule needs a rendered box — layout, not a record field), and
 * the reading that a reference's prose memory is not carried (records, not
 * documents).
 */

/** The packet's format tag (PROVISIONAL, but part of the bytes). */
export const PACKET_FORMAT = "attentioneer-packet/1";

/** The packet's limit sentence, verbatim (ADR-0026: qualitative, never a count). */
export const PACKET_LIMIT = "This view; the map is larger.";

/** The family's posture, verbatim (records ride as they stand). */
export const PACKET_POSTURE =
  "Each record is carried as it stands — its own marks, its own words, its own unknown keys. A hand edit is kept and shown, never repaired or tidied.";

/** What each game is, for the packet's conventions section (fixed prose). */
const GAME_CONVENTIONS: Record<GhostGame, string> = {
  concept:
    "concept is the map's first game: words on a plane, distances between them and open marks — the map as it stands, with no model.",
  dynamics:
    "dynamics is the map's second game: a playing set of words, signed links, authored quantities and named loops — the model the words play in.",
  ground:
    "ground is the map's third game: each word may keep a reach outward, and a window opens onto it.",
};

/** How a params field is described in the packet (by kind, not by code). */
const PARAM_KIND_GLOSS: Record<string, string> = {
  text: "prose, carried exactly as written",
  number: "a finite number",
  enum: "one of a set of values",
};

/**
 * One params field, in the packet's words. An enum states its allowed
 * VALUES (the schema's own data, Epic 11 story 2); an unknown kind falls
 * back to the raw declaration, which is a string from the registry's data,
 * never validator vocabulary.
 */
function paramGlossOf(field: ParamField): string {
  if (field.kind === "enum") {
    const values = field.values ?? [];
    if (values.length === 0) return "one of a set of values";
    return "one of " + values.join(", ");
  }
  return PARAM_KIND_GLOSS[field.kind] ?? field.kind;
}

/**
 * One word's record as the packet reads it: the reference's own fields (its
 * slug — the word's identity — and its coined name) plus the rendered box the
 * veil's centre rule needs (layout, not a record field).
 */
export interface PacketWord {
  /** The word's file slug: its identity on the map, and the target's slug. */
  slug: string;
  /** The person's coined name, verbatim. */
  name: string;
  /** The record's own plane position (the word box's top-left). */
  x: number;
  y: number;
  /** The rendered box's size — only the veil's centre rule reads it. */
  box: { w: number; h: number };
}

/** A veil as the packet may carry it: presence, name and location — nothing else. */
export interface PacketVeilPlacement {
  /** The veil's coined name, verbatim. */
  name: string;
  /** Its box on the plane (the locator). The reason has no field here. */
  location: { x: number; y: number; w: number; h: number };
}

/**
 * The map's records, as the app already holds them — handed in verbatim so the
 * packet module stays pure and the records stay the record family's own types
 * (no packet-only re-shaping that could paraphrase them).
 */
export interface PacketView {
  /** Every reference on the map (the app's loaded words, with their boxes). */
  words: readonly PacketWord[];
  /** The accepted playing set's member slugs (the record's own list). */
  playing: readonly string[];
  /** Every mark on the map (the packet picks the region's word marks). */
  marks: readonly Mark[];
  /** Every standing assumption (the packet picks the region's claims). */
  claims: readonly Assumption[];
  /** Every named loop (the packet picks the named target's, if any). */
  loops: readonly Loop[];
  /** Every veil WHOLE — the packet drops every reason (veilPlacementOf). */
  veils: readonly Veil[];
}

/** The person's own region: their selection, or none (the ADR's fallback). */
export interface PersonRegion {
  /** The person's chosen word slugs; null when they have not chosen a region. */
  selection: readonly string[] | null;
}

/** Where the region came from — the ADR's rule, as data. */
export type RegionSource =
  | "the person's selection"
  | "the named target and the playing set";

/** The region the packet carries: word slugs, and who chose them. */
export interface RegionSelection {
  /** The word slugs the packet carries (deduped, sorted: a stable order). */
  slugs: readonly string[];
  /** The person's selection wins; otherwise the ADR's fallback. */
  source: RegionSource;
}

/** The packet's frozen triple plus its one hash. */
export interface PacketFreeze {
  /** The packet's bytes (LF, exactly one trailing newline). */
  readonly bytes: string;
  /** The base pin the request was made against (the envelope's expect). */
  readonly pin: GhostExpect;
  /** The registry version: DERIVED from the move table, never hand-bumped. */
  readonly registry: string;
  /** The freeze: one SHA-256 hex over (bytes, pin, registry). */
  readonly hash: string;
}

/** One assembled packet. */
export interface Packet {
  /** The frozen triple — the thing story 3 records and the journal names. */
  freeze: PacketFreeze;
  /** The person's region, as chosen (never the request's). */
  region: RegionSelection;
}

/** What the pure assembler is handed: no key here can choose a region. */
export interface PacketInput {
  /** The registered move (the surface resolves it through findMove). */
  entry: MoveDefinition;
  /** The target the person's request names (the only request-side input). */
  target: GhostTarget;
  /** The person's own region (their selection, or none). */
  person: PersonRegion;
  /** The map's records, verbatim. */
  view: PacketView;
  /** The base-pin snapshot, read at the ask moment. */
  snapshot: GhostSnapshot;
  /**
   * The registry table the packet reads (defaults to the live registry). The
   * operations line is the GAME'S REGISTERED moves, derived from this table
   * (Epic 11 story 2), so a second row changes the packet without a
   * rendering edit — and a test's fixture table proves the derivation
   * without registering a move.
   */
  moves?: readonly MoveDefinition[];
}

/** A word's placement for the veil's centre rule (the record's x/y + the box). */
function placedOf(word: PacketWord): PlacedWord {
  return {
    slug: word.slug,
    pos: { x: word.x, y: word.y },
    box: word.box,
  };
}

/** The word with this slug, or null (a region slug the map does not carry). */
function wordOf(view: PacketView, slug: string): PacketWord | null {
  return view.words.find((word) => word.slug === slug) ?? null;
}

/** The loop with this name-derived slug, or null. */
function loopOf(view: PacketView, slug: string): Loop | null {
  return view.loops.find((loop) => loopSlug(loop.name) === slug) ?? null;
}

/**
 * Drop everything a packet may not carry from a veil: its REASON is not read
 * at all, and what it covers is never enumerated. Presence, name and the
 * location (its box) are all that survive — structurally, this type has no
 * field for anything else.
 */
export function veilPlacementOf(veil: Veil): PacketVeilPlacement {
  return {
    name: veil.name,
    location: { x: veil.x, y: veil.y, w: veil.w, h: veil.h },
  };
}

/** A loaded reference as the packet's word record (null for an unwritten draft). */
export function packetWordOf(
  reference: Reference,
  box: { w: number; h: number },
): PacketWord | null {
  if (reference.slug === null) return null;
  return {
    slug: reference.slug,
    name: reference.name,
    x: reference.x,
    y: reference.y,
    box,
  };
}

/**
 * THE REGION RULE (ADR-0026 decision 1), pure: the person's selection wins when
 * present; otherwise the named target (a word) plus the playing set. It takes
 * the TARGET, never the request and never a region-shaped key, so a request
 * cannot choose what the person sees — authorship by selection is impossible
 * here (the negative is tested). Selection order never matters: the region is
 * deduped and sorted, and a slug the map does not carry is not a record.
 */
export function regionOf(
  target: GhostTarget,
  person: PersonRegion,
  view: PacketView,
): RegionSelection {
  const carried = new Set(view.words.map((word) => word.slug));
  if (person.selection !== null) {
    return {
      slugs: [...new Set(person.selection.filter((slug) => carried.has(slug)))].sort(),
      source: "the person's selection",
    };
  }
  const named = target.kind === "word" ? [target.slug] : [];
  const playing = view.playing.filter((slug) => carried.has(slug));
  return {
    slugs: [...new Set([...named, ...playing])].sort(),
    source: "the named target and the playing set",
  };
}

/** Wrap one paragraph to a readable width (the packet is prose for a reader). */
function wrap(text: string, width = 78): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((part) => part !== "")) {
    if (line === "") {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= width) {
      line = line + " " + word;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** One word's block: its identity, whether it is in play, its marks and claims. */
function wordBlock(
  word: PacketWord,
  view: PacketView,
  isTarget: boolean,
): string[] {
  const lines: string[] = [];
  lines.push(
    "### a word: " + word.name + (isTarget ? " (the target)" : ""),
  );
  lines.push("");
  lines.push("slug: " + word.slug);
  lines.push("name: " + JSON.stringify(word.name));
  lines.push("in play: " + (view.playing.includes(word.slug) ? "yes" : "no"));
  lines.push("");

  const marks = view.marks.filter(
    (mark) => mark.target.type === "word" && mark.target.slug === word.slug,
  );
  lines.push("marks:");
  if (marks.length === 0) {
    lines.push("none");
  } else {
    for (const mark of marks) lines.push(serializeMarkLine(mark));
  }
  lines.push("");

  const key = assumptionTargetKey({ type: "word", slug: word.slug });
  const claims = view.claims.filter(
    (claim) => assumptionTargetKey(claim.target) === key,
  );
  lines.push("claims on it:");
  if (claims.length === 0) {
    lines.push("none");
  } else {
    for (const claim of claims) lines.push(serializeAssumptionLine(claim));
  }
  lines.push("");
  return lines;
}

/** One loop's block: its name-derived slug, its coined name, its own path. */
function loopBlock(loop: Loop, view: PacketView): string[] {
  const lines: string[] = [];
  lines.push("### a loop: " + loop.name + " (the target)");
  lines.push("");
  lines.push("slug: " + loopSlug(loop.name));
  lines.push("name: " + JSON.stringify(loop.name));
  lines.push("path: " + loop.path.join(" -> "));
  lines.push("");

  const key = assumptionTargetKey({ type: "loop", slug: loopSlug(loop.name) });
  const claims = view.claims.filter(
    (claim) => assumptionTargetKey(claim.target) === key,
  );
  lines.push("claims on it:");
  if (claims.length === 0) {
    lines.push("none");
  } else {
    for (const claim of claims) lines.push(serializeAssumptionLine(claim));
  }
  lines.push("");
  return lines;
}

/** The move's authored fields, spelled by their registry schema (data). */
function authoredFields(entry: MoveDefinition): string {
  return entry.params
    .map((field) => field.key + " — " + paramGlossOf(field))
    .join("; ");
}

/**
 * Render the packet's bytes from the inputs and the chosen region. Pure: same
 * inputs = same bytes. The fixed sections are the app's; the records are the
 * map's, verbatim; the move's shape and the boundary are the registry's.
 */
function renderPacket(input: PacketInput, region: RegionSelection): string {
  const { entry, target, view } = input;
  const lines: string[] = [];

  lines.push("# Attentioneer — a context packet for one move");
  lines.push("");
  lines.push("format: " + PACKET_FORMAT);
  lines.push("");

  lines.push("## The move");
  lines.push("");
  lines.push("family: " + entry.move.family);
  lines.push("verb: " + entry.move.verb);
  lines.push("game: " + entry.game);
  lines.push("authors: " + authoredFields(entry));
  lines.push("targets: one of " + authorableTargetKinds(entry).join(", "));
  // THE GAME'S REGISTERED MOVES, derived from the registry table (Epic 11
  // story 2): the packet states the game's operations, never a hand-copied
  // list. "none" is said, not left blank (a game with no registered move is
  // a fact, not an omission).
  const operations = registeredMovesOf(entry.game, input.moves);
  lines.push(
    "registered moves in " +
      entry.game +
      ": " +
      (operations.length === 0 ? "none" : operations.join(", ")),
  );
  lines.push("");

  lines.push("## The game this move belongs to");
  lines.push("");
  for (const line of wrap(GAME_CONVENTIONS[entry.game])) lines.push(line);
  lines.push("");

  lines.push("## What this move does");
  lines.push("");
  for (const line of wrap(entry.boundary)) lines.push(line);
  lines.push("");

  lines.push("## The records");
  lines.push("");
  const targetWord = target.kind === "word" ? wordOf(view, target.slug) : null;
  const targetLoop = target.kind === "loop" ? loopOf(view, target.slug) : null;
  if (targetLoop !== null) lines.push(...loopBlock(targetLoop, view));
  if (targetWord !== null) lines.push(...wordBlock(targetWord, view, true));
  for (const slug of region.slugs) {
    if (targetWord !== null && slug === targetWord.slug) continue;
    const word = wordOf(view, slug);
    if (word === null) continue;
    lines.push(...wordBlock(word, view, false));
  }

  lines.push("## Veils over this view");
  lines.push("");
  const covering = view.veils.filter((veil) =>
    region.slugs.some((slug) => {
      const word = wordOf(view, slug);
      return (
        word !== null && veilsCoveringWord([veil], placedOf(word)).length > 0
      );
    }),
  );
  if (covering.length === 0) {
    lines.push("No veil covers a word in this view.");
  } else {
    covering.forEach((veil, index) => {
      if (index > 0) lines.push("");
      const placement = veilPlacementOf(veil);
      lines.push("name: " + JSON.stringify(placement.name));
      lines.push(
        "location: x " +
          placement.location.x +
          ", y " +
          placement.location.y +
          ", w " +
          placement.location.w +
          ", h " +
          placement.location.h,
      );
    });
  }
  lines.push("");

  lines.push("## How records are carried");
  lines.push("");
  for (const line of wrap(PACKET_POSTURE)) lines.push(line);
  lines.push("");

  lines.push("## The limit of this view");
  lines.push("");
  lines.push(PACKET_LIMIT);

  return canonicalText(lines.join("\n"));
}

/**
 * Freeze the triple: the bytes, the base pin and the derived registry hash,
 * hashed together into the packet hash. The result is deeply frozen (a frozen
 * packet is the point: the freeze must not drift after it is named).
 */
export function freezePacket(
  bytes: string,
  pin: GhostExpect,
  registry: string,
): PacketFreeze {
  const frozen: PacketFreeze = {
    bytes,
    pin,
    registry,
    hash: sha256Hex(canonicalJson({ bytes, pin, registry })),
  };
  Object.freeze(frozen.pin.files);
  Object.freeze(frozen.pin);
  return Object.freeze(frozen);
}

/**
 * ASSEMBLE THE PACKET: the person's region, the records, the move's shape, the
 * behavior, the limit — bytes and the frozen triple. Pure and total over its
 * inputs; the surface (request.ts) owns the refusals (an unregistered move, a
 * refused target kind, a dangling target, another band, a branch) before this
 * is called.
 */
export function assemblePacket(input: PacketInput): Packet {
  const region = regionOf(input.target, input.person, input.view);
  const bytes = renderPacket(input, region);
  const freeze = freezePacket(
    bytes,
    pinOf(input.snapshot, input.entry),
    registryHash(input.moves),
  );
  return { freeze, region };
}
