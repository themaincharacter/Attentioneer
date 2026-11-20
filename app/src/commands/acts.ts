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
 * deleting, renaming, keys or provider rows, starting a run, sending a turn, or
 * anything outside the map folder. A command cannot name what this table does
 * not carry, and the vocabulary is the whole of what a command may say. That
 * is the enforcement, not a prompt instruction.
 *
 * A PROPOSE ACT IS A GHOST, NEVER A WRITE (ADR-0038 §4): `writes` is false on
 * every act here, including the propose acts, because a proposal changes no
 * record. The person accepts or refuses; the adapter files the proposal in the
 * existing intake.
 *
 * PROVISIONAL (ADR-0038's consequences): the act names, the payload keys and
 * their types, the map value being only `"ground"`, and the script's line
 * shape (one act object per line, read by the driver beside this file).
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
  /** The JSON type the key carries. */
  type: "text" | "number";
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
    name: "propose_ask",
    family: "propose",
    writes: false,
    description:
      "Propose one ask card at a point; nothing is sent and no question is recorded.",
    required: [
      { key: "name", type: "text" },
      { key: "x", type: "number" },
      { key: "y", type: "number" },
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
