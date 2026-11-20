/**
 * STORY 21.1 — THE ACT VOCABULARY, THE PORTABLE HALF (ADR-0038 §3 and §5).
 *
 * This module declares what a command can SAY: act names, the payload each
 * act takes, whether it writes, and one plain-language description. It names
 * maps and cards, never this app's records, files, components or bridge — the
 * test beside it asserts that this file and `execute.ts` import nothing app
 * specific, so the same vocabulary can be lifted into another app with a new
 * adapter (ADR-0038 §3).
 *
 * THE NEVER-LIST IS ABSENT BY CONSTRUCTION (ADR-0038 §7): there is no act for
 * renaming, keys or provider rows, starting a run, sending a turn, or anything
 * outside the map folder. A command cannot name what this table does not carry,
 * and the vocabulary is the whole of what a command may say. That is the
 * enforcement, not a prompt instruction.
 *
 * STORY 21.6 — REMOVAL IS NOT ON THE NEVER-LIST (ADR-0038's 2026-11-20
 * amendment: the command card is a primary way to use the app, and coverage
 * grows act by act). A person may take back a wire, a note or a card by hand,
 * so the acts may propose it too — as a GHOST, exactly like an add. Nothing
 * here deletes directly, and nothing here reaches outside the map folder.
 *
 * A PROPOSE ACT IS A GHOST, NEVER A WRITE (ADR-0038 §4): `writes` is false on
 * every act here, including the propose acts, because a proposal changes no
 * record. The person accepts or refuses; the adapter files the proposal in the
 * existing intake.
 *
 * STORY 21.7 — THE MOST NATURAL SENTENCE JOINS THE VOCABULARY (ADR-0038's
 * 2026-11-20 amendment: the command card is a PRIMARY way to use the app, and
 * its ambition is coverage of what a person can do). "ask rain gauge what it
 * says about the plastic" is one ask card, wired, with the person's question
 * WAITING AS A DRAFT. So `propose_ask` grows two optional keys — the question
 * and the cards to wire into it — and nothing else about the act changes: the
 * question is never a record (an unsent question is a draft, and the adapter
 * hands it to the card's composer after the accept), it files the SAME link
 * ghost `propose_wire` files, and no act sends a turn. Sending is the
 * person's press, today and until a story of its own decides otherwise.
 *
 * STORY 21.8 — THE VOCABULARY LEARNS TO PLACE AND TO NAME (ADR-0038's 2026-11-20
 * amendment: the command card is a PRIMARY way to use the app, and an agent can
 * add, wire, remove and ask — what it could not do is TIDY). "put the new card
 * under the rain gauge" and "call this one the evidence gap" are ordinary
 * sentences, so there are two more proposals:
 *
 *   - `propose_move` names a card, optionally another card, and a direction
 *     (below, above, left or right). THE MODEL NEVER SUPPLIES A COORDINATE: the
 *     host computes the point from the two cards' positions with one stated
 *     offset (canvas/geometry.ts), and the payload schema has no number at all.
 *   - `propose_rename` proposes a NAME for the person to accept. It exists
 *     BECAUSE only the person coins a name (AGENTS.md's guardrail); accepting the
 *     ghost is the coining, so the description says "propose a name for the
 *     person to accept" and never "rename". An empty name never leaves the act
 *     layer.
 *
 * Both are GHOSTS like every proposal here, and both carry their inverse
 * (rename ↔ rename with the previous name, move ↔ move with the previous
 * point); the host remembers the previous value at proposal time, so the undo
 * the card offers never invents one.
 *
 * PROVISIONAL (ADR-0038's consequences): the act names, the payload keys and
 * their types (STORY 21.7 adds the `texts` list type for the cards to wire),
 * the map value being only `"ground"`, and the script's line shape (one act
 * object per line, read by the driver beside this file).
 */

/** The maps a command may name. PROVISIONAL: only the ground map, for now. */
export type CommandMap = "ground";

/** The maps the vocabulary knows today, as data. */
export const COMMAND_MAPS: readonly CommandMap[] = ["ground"];

/** The two families: what reads the map, and what proposes to it. */
export type ActFamily = "read" | "propose";

/** One payload field the vocabulary declares. */
export interface ActField {
  /** The payload key. */
  key: string;
  /**
   * The JSON type the key carries. STORY 21.7 adds `texts`: a LIST of non-empty
   * text values, because wiring an ask names several cards and the portable
   * vocabulary must be able to say "these cards" without learning a record's
   * file names (ADR-0038 §3). PROVISIONAL with the act names.
   */
  type: "text" | "number" | "texts";
  /**
   * May the text carry newlines and surrounding whitespace? A note may (the
   * person's own words, kept verbatim); a name, a slug or a why may not, so a
   * record never gains invisible edges.
   */
  multiline?: boolean;
}

/** One act as the vocabulary declares it. */
export interface ActSpec {
  /** The act's name: the word a script and a model use. */
  name: string;
  /** read or propose. */
  family: ActFamily;
  /**
   * Whether the act changes a record. FALSE for every act in this story: a
   * read changes nothing and a proposal is a ghost the person accepts.
   */
  writes: boolean;
  /** The one plain-language sentence a model is shown. */
  description: string;
  /** The payload keys every act of this name must carry. */
  required: readonly ActField[];
  /** The payload keys it may carry, and nothing else. */
  optional: readonly ActField[];
}

/** The act table, in the order a model should read it. */
export const ACT_SPECS: readonly ActSpec[] = [
  {
    name: "map_overview",
    family: "read",
    writes: false,
    description:
      "Read a short summary of the map: its cards, its wires and the lines it could not read.",
    required: [],
    optional: [],
  },
  {
    name: "read_card",
    family: "read",
    writes: false,
    description:
      "Read one card: its name, where it sits, and the first lines of its reading and note.",
    required: [{ key: "card", type: "text" }],
    optional: [],
  },
  {
    name: "read_wires",
    family: "read",
    writes: false,
    description: "Read the list of wires between cards.",
    required: [],
    optional: [],
  },
  {
    name: "propose_card",
    family: "propose",
    writes: false,
    description:
      "Propose one card with the words it would carry, placed at a point on the map.",
    required: [
      { key: "name", type: "text" },
      { key: "x", type: "number" },
      { key: "y", type: "number" },
    ],
    optional: [{ key: "why", type: "text" }],
  },
  {
    name: "propose_wire",
    family: "propose",
    writes: false,
    description: "Propose a wire between two cards that are already on the map.",
    required: [
      { key: "from", type: "text" },
      { key: "to", type: "text" },
    ],
    optional: [{ key: "why", type: "text" }],
  },
  {
    name: "propose_note",
    family: "propose",
    writes: false,
    description:
      "Propose the person's words as one existing card's note.",
    required: [
      { key: "card", type: "text" },
      { key: "note", type: "text", multiline: true },
    ],
    optional: [{ key: "why", type: "text" }],
  },
  {
    // STORY 21.7 — AN ASK CAN CARRY ITS QUESTION AND ITS CONTEXT. The question
    // waits as a DRAFT in the card's composer (the adapter hands it there after
    // the accept); it is never written as a turn, because only a send writes a
    // conversation line and no act sends. The context cards are wired in with
    // the SAME link ghost `propose_wire` files — one link shape, not two.
    name: "propose_ask",
    family: "propose",
    writes: false,
    description:
      "Propose one ask card at a point, optionally with a question waiting unsent in its composer and context cards wired into it; nothing is sent and no question is recorded.",
    required: [
      { key: "name", type: "text" },
      { key: "x", type: "number" },
      { key: "y", type: "number" },
    ],
    optional: [
      { key: "question", type: "text", multiline: true },
      { key: "context", type: "texts" },
      { key: "why", type: "text" },
    ],
  },
  // STORY 21.6 — THE ACTS LEARN TO REMOVE (ADR-0038's 2026-11-20 amendment: the
  // command card is a PRIMARY way to use the app, and a command surface that
  // can only ADD cannot fix a mistake it just made). Each removal names exactly
  // ONE thing, files exactly ONE ghost, and changes NO record until the person
  // accepts — the app's own Restore remains the undo of the undo. The
  // never-list is unchanged: these three are removals of the person's own map
  // content, which a person may always do by hand.
  {
    name: "propose_unwire",
    family: "propose",
    writes: false,
    description:
      "Propose removing the wire between two cards that are already on the map.",
    required: [
      { key: "from", type: "text" },
      { key: "to", type: "text" },
    ],
    optional: [{ key: "why", type: "text" }],
  },
  {
    name: "propose_remove_note",
    family: "propose",
    writes: false,
    description: "Propose removing one existing card's note.",
    required: [{ key: "card", type: "text" }],
    optional: [{ key: "why", type: "text" }],
  },
  {
    name: "propose_remove_card",
    family: "propose",
    writes: false,
    description: "Propose removing one existing card from the map.",
    required: [{ key: "card", type: "text" }],
    optional: [{ key: "why", type: "text" }],
  },
  // STORY 21.8 — THE VOCABULARY LEARNS TO PLACE (ADR-0038's amendment: placing
  // is the ordinary sentence after making a card). The model names cards and a
  // direction and NOTHING ELSE: there is no coordinate in this schema, and the
  // host computes the point from the two cards' positions with one stated
  // offset. A missing or unknown direction is refused BY NAME, never guessed.
  {
    name: "propose_move",
    family: "propose",
    writes: false,
    description:
      "Propose moving one card to sit below, above, left or right of another card (or of where it already is); the app computes the point.",
    required: [{ key: "card", type: "text" }],
    optional: [
      { key: "other", type: "text" },
      { key: "direction", type: "text" },
      { key: "why", type: "text" },
    ],
  },
  // STORY 21.8 — THE VOCABULARY LEARNS TO PROPOSE A NAME (AGENTS.md's guardrail:
  // only the user coins a name; an agent may propose one as a ghost). This is a
  // PROPOSAL the person accepts, so the description says exactly that and never
  // calls it a rename; an empty name is refused at this layer, before any ghost.
  {
    name: "propose_rename",
    family: "propose",
    writes: false,
    description:
      "Propose a name for the person to accept; only the person coins a name, so this is a proposal and never an instruction.",
    required: [
      { key: "card", type: "text" },
      { key: "name", type: "text" },
    ],
    optional: [{ key: "why", type: "text" }],
  },
];

/** The act names, in table order (the vocabulary's whole set). */
export const ACT_NAMES: readonly string[] = ACT_SPECS.map((spec) => spec.name);

/** The spec a name names, or null (the registration door, and nothing else). */
export function actSpecOf(name: string): ActSpec | null {
  return ACT_SPECS.find((spec) => spec.name === name) ?? null;
}

/** One validated act, as the executor runs it. */
export interface CommandAct {
  act: string;
  map: CommandMap;
  payload: Record<string, unknown>;
  /**
   * STORY 21.8 — THE APP MINTED THIS ACT FOR AN UNDO. A move's inverse needs the
   * point the card stood on, and the model may never name a coordinate; so the
   * host remembers the previous point and the app builds the take-back act with
   * THAT point after the person's apply. Only the app can set this flag:
   * {@link validateAct} — the one door a model's reply passes — copies nothing
   * but act, map and payload, so a model-supplied "prepared" is silently
   * dropped and its coordinates are refused as undeclared keys.
   */
  prepared?: boolean;
}

/** A validation's answer: the act, or ONE sentence saying why not. */
export type ActRead =
  | { ok: true; act: CommandAct }
  | { ok: false; sentence: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiresSpace(field: ActField): boolean {
  return field.multiline !== true;
}

/**
 * Validate one act object. PURE and total: same input, same verdict. The first
 * thing out of shape answers ONE sentence — the executor then applies NOTHING
 * else, which is the ghost discipline applied to a script (ADR-0038 §5).
 */
export function validateAct(raw: unknown): ActRead {
  if (!isObject(raw)) {
    return { ok: false, sentence: "an act must be a JSON object." };
  }
  const name = raw.act;
  if (typeof name !== "string" || name === "") {
    return { ok: false, sentence: 'an act needs an "act" name.' };
  }
  const spec = actSpecOf(name);
  if (spec === null) {
    return { ok: false, sentence: `there is no act named "${name}".` };
  }
  const map = raw.map;
  if (typeof map !== "string" || map === "") {
    return {
      ok: false,
      sentence: `the act "${name}" needs a map; only "ground" is known.`,
    };
  }
  if (map !== "ground") {
    return {
      ok: false,
      sentence: `the act "${name}" names the map "${map}"; only "ground" is known.`,
    };
  }
  const payload = raw.payload;
  if (!isObject(payload)) {
    return { ok: false, sentence: `the act "${name}" needs a payload object.` };
  }

  const allowed = [...spec.required, ...spec.optional];
  for (const key of Object.keys(payload)) {
    if (!allowed.some((field) => field.key === key)) {
      return { ok: false, sentence: `the act "${name}" does not take "${key}".` };
    }
  }
  for (const field of spec.required) {
    if (!(field.key in payload)) {
      return { ok: false, sentence: `the act "${name}" needs "${field.key}".` };
    }
  }
  for (const field of allowed) {
    if (!(field.key in payload)) continue;
    const value = payload[field.key];
    if (field.type === "texts") {
      // STORY 21.7 — A LIST OF NAMES, each one non-empty and with no invisible
      // edges: an entry the app has to guess at is not a card the person named.
      if (!Array.isArray(value) || value.length === 0) {
        return {
          ok: false,
          sentence: `the act "${name}" wants a non-empty list for "${field.key}".`,
        };
      }
      for (const entry of value) {
        if (typeof entry !== "string" || entry === "") {
          return {
            ok: false,
            sentence: `the act "${name}" wants non-empty text in every "${field.key}" entry.`,
          };
        }
        if (entry !== entry.trim()) {
          return {
            ok: false,
            sentence: `the act "${name}" has surrounding whitespace on a "${field.key}" entry; a name is used exactly as given.`,
          };
        }
      }
      continue;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return {
          ok: false,
          sentence: `the act "${name}" wants a number for "${field.key}".`,
        };
      }
      continue;
    }
    if (typeof value !== "string" || value === "") {
      return {
        ok: false,
        sentence: `the act "${name}" wants non-empty text for "${field.key}".`,
      };
    }
    if (requiresSpace(field) && value !== value.trim()) {
      return {
        ok: false,
        sentence: `the act "${name}" has surrounding whitespace on "${field.key}"; a record is written exactly as given.`,
      };
    }
  }

  const clean: Record<string, unknown> = {};
  for (const field of allowed) {
    if (field.key in payload) clean[field.key] = payload[field.key];
  }
  return { ok: true, act: { act: name, map: "ground", payload: clean } };
}

/**
 * STORY 21.8 — THE APP-MINTED MOVE, validated separately. An undo of a move
 * needs the point the card stood on; the portable schema deliberately has no
 * coordinate, so the app builds this act after the apply and executeScript
 * reads it through THIS door rather than the model's. The shape is exact: one
 * card and one finite point, nothing else. A model cannot reach it (its reply is
 * read by validateAct, which drops the flag and refuses the keys).
 */
export function validateAppAct(raw: unknown): ActRead {
  if (!isObject(raw)) {
    return { ok: false, sentence: "an app-minted act must be a JSON object." };
  }
  if (raw.prepared !== true) {
    return { ok: false, sentence: "only an app-minted take-back may name a point." };
  }
  if (raw.act !== "propose_move") {
    return {
      ok: false,
      sentence: "only a move's take-back carries an app-minted point.",
    };
  }
  if (raw.map !== "ground") {
    return { ok: false, sentence: 'an app-minted move names the map "ground".' };
  }
  const payload = raw.payload;
  if (!isObject(payload)) {
    return { ok: false, sentence: "the app-minted move needs a payload object." };
  }
  for (const key of Object.keys(payload)) {
    if (key !== "card" && key !== "x" && key !== "y") {
      return {
        ok: false,
        sentence: 'the app-minted move does not take "' + key + '".',
      };
    }
  }
  const card = payload.card;
  const x = payload.x;
  const y = payload.y;
  if (typeof card !== "string" || card === "" || card.trim() !== card) {
    return { ok: false, sentence: "the app-minted move needs one card's name." };
  }
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y)
  ) {
    return { ok: false, sentence: "the app-minted move needs a finite point." };
  }
  return {
    ok: true,
    act: {
      act: "propose_move",
      map: "ground",
      payload: { card, x, y },
      prepared: true,
    },
  };
}

/**
 * STORY 21.6 — THE INVERSE PAIRING, AS DATA (ADR-0038's amendment: coverage
 * grows act by act, and "undo that" should resolve to the inverse of what the
 * last applied act did). The pairing is the vocabulary's own fact, so it lives
 * here rather than in the card: a creating act and the removing act that takes
 * it back.
 *
 * BOTH DIRECTIONS ARE NAMED, and only one of each pair is always OFFERABLE.
 * {@link inverseActOf} builds the inverse only when the applied act already
 * carries every field the inverse needs: a wire's pair is enough to unwire it
 * and to wire it again, a note's card is enough to take the note away, and a
 * card's name is enough to take the card away. A removed note's WORDS and a
 * removed card's POINT live only in the record the removal took, so those two
 * directions are the pairing's future, not a guess — the card answers them with
 * 21.5's sentence instead. PROVISIONAL: the pairing's spelling and which
 * directions can be offered from the applied act alone.
 *
 * STORY 21.8 — A PLACE AND A NAME ARE THEIR OWN INVERSES. The host enriches the
 * applied act with the value it had before (previousX/previousY for a move,
 * previousName for a name), so "undo that" after either offers the SAME act
 * with the previous value — never a guessed point or a guessed word. The
 * enrichment is app-minted view state (no record carries it) and a model's reply
 * can never contain it (validateAct copies only declared payload keys).
 */
export const INVERSE_ACT_OF: Readonly<Record<string, string>> = {
  propose_wire: "propose_unwire",
  propose_unwire: "propose_wire",
  propose_note: "propose_remove_note",
  propose_remove_note: "propose_note",
  propose_card: "propose_remove_card",
  propose_remove_card: "propose_card",
  propose_move: "propose_move",
  propose_rename: "propose_rename",
};

/** The payload an inverse act needs from the act it takes back, or null. */
function inversePayloadOf(
  inverse: string,
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  const text = (key: string): string | null => {
    const value = payload[key];
    return typeof value === "string" && value !== "" ? value : null;
  };
  if (inverse === "propose_unwire" || inverse === "propose_wire") {
    const from = text("from");
    const to = text("to");
    return from === null || to === null ? null : { from, to };
  }
  if (inverse === "propose_remove_note") {
    const card = text("card");
    return card === null ? null : { card };
  }
  if (inverse === "propose_remove_card") {
    // A card is named by its name at creation and by its slug in the digest;
    // either is a card the adapter re-checks against the records.
    const card = text("card") ?? text("name");
    return card === null ? null : { card };
  }
  if (inverse === "propose_rename") {
    // STORY 21.8 — the name the card had, which the host read at proposal time.
    // No previous name means no inverse (never an invented one).
    const card = text("card");
    const previous = text("previousName");
    return card === null || previous === null ? null : { card, name: previous };
  }
  if (inverse === "propose_move") {
    // STORY 21.8 — the point the card stood on. It is app-minted view state, so
    // it is read here only as a number pair; a model-shaped payload has neither.
    const card = text("card");
    const x = payload.previousX;
    const y = payload.previousY;
    if (card === null) return null;
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    if (typeof y !== "number" || !Number.isFinite(y)) return null;
    return { card, x, y };
  }
  // propose_note needs the words and propose_card needs the point: neither is
  // in the applied act, so neither is offered (never invented).
  return null;
}

/**
 * THE INVERSE OF ONE APPLIED ACT, as a validated act, or null when the
 * vocabulary has no pair or the applied act does not carry what the pair needs.
 * The result is validated by {@link validateAct}, so what the card offers is
 * exactly what the executor will accept.
 */
export function inverseActOf(act: CommandAct): CommandAct | null {
  const inverse = INVERSE_ACT_OF[act.act];
  if (inverse === undefined) return null;
  const payload = inversePayloadOf(inverse, act.payload);
  if (payload === null) return null;
  // STORY 21.8 — a move's take-back names the point the card stood on, which
  // the model may never name. It is validated by the app's own door, and the
  // prepared flag is the marker execute.ts reads.
  if (inverse === "propose_move") {
    const read = validateAppAct({
      act: "propose_move",
      map: act.map,
      payload,
      prepared: true,
    });
    return read.ok ? read.act : null;
  }
  const read = validateAct({ act: inverse, map: act.map, payload });
  return read.ok ? read.act : null;
}

/**
 * The script's line shape, provisional with everything else: each line is one
 * act object. The driver also accepts a whole-file JSON array (or a
 * `{ "acts": [...] }` wrapper) so a person can write either.
 */
export function actsFromScript(text: string): unknown[] | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (Array.isArray(value)) return value;
    if (isObject(value) && Array.isArray(value.acts)) return value.acts;
    if (isObject(value)) return [value];
  } catch {
    // Not one JSON document: try one act per line.
  }
  const acts: unknown[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const body = line.trim();
    if (body === "" || body.startsWith("#")) continue;
    try {
      acts.push(JSON.parse(body));
    } catch {
      return null;
    }
  }
  return acts.length > 0 ? acts : null;
}
