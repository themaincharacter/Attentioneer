import { canonicalJson } from "../lib/serialize";

/**
 * The ghost envelope (Epic 10 story 1, ADR-0024) — a PATCH proposal, as JSON.
 *
 * This module owns the envelope's SHAPE and its canonical bytes — nothing else.
 * It is map-independent on purpose: the envelope is a portable JSON document,
 * never a record, and it imports no record module. The canonical byte door is
 * `lib/serialize.ts` (sorted keys, 2-space indent, trailing newline), so a hand
 * edit returns to canonical style and a round trip is exact.
 *
 * The envelope is the person/app-legible proposal, never the agent's format:
 * the agent authors a BODY (`move`, `target`, `params`, `rationale`); the app
 * mints the `id`, the base pin (`expect`), the derived `steps` and the empty
 * `proposals` sibling. The envelope is re-validated at accept, and its
 * `steps` are READ-ONLY: the deriver owns them, so a tampered list is ignored.
 *
 * The glossary's words: the FILE is a **Patch**; **Ghost** is the faint
 * rendering of a pending proposal (story 3). This module owns the file.
 *
 * The move's authored content is the ADR's triad: `move` (what), `target`
 * (of what) and `params` (with what). For v1's add-assumption the params
 * schema is one prose `text` and the target is one word or loop — the target
 * is the envelope's `target`, not a copy inside `params`, so there is exactly
 * one place a target lives (PROVISIONAL: the split is ADR-0024's).
 *
 * Provisional: the format key's value, the id prefix, the step's JSON look, and
 * `proposals` being a plain array of nothing in v1.
 */

/** The envelope's format key (PROVISIONAL). */
export const GHOST_FORMAT = "attentioneer-ghost/1";

/** The three games a ghost can be pinned to (the app's level values). */
export type GhostGame = "concept" | "dynamics" | "ground";

/** The three games, in the level control's order. */
export const GHOST_GAMES: readonly GhostGame[] = ["concept", "dynamics", "ground"];

/** A registered move: the family and the verb (expansion is registry data). */
export interface GhostMove {
  family: string;
  verb: string;
}

/**
 * What the move is about, in the ENVELOPE's own vocabulary (map-independent).
 * v1's add-assumption allows word and loop only; spot and link are known kinds
 * the move refuses (uncheckable / crossing the branch seam).
 */
export type GhostTarget =
  | { kind: "word"; slug: string }
  | { kind: "loop"; slug: string }
  | { kind: "spot"; x: number; y: number }
  | { kind: "link"; from: string; to: string };

/** The known target kinds, for shape checks. */
export const GHOST_TARGET_KINDS: readonly GhostTarget["kind"][] = [
  "word",
  "loop",
  "spot",
  "link",
];

/**
 * The base pin (ADR-0024 decision 1): what the move was proposed against.
 * `files` is one SHA-256 hex digest per file the move touches, keyed by the
 * workspace-relative path; `dir` is the records folder at the time
 * (`recordsRelDirOf`), `level` the band and `game` the move's game.
 */
export interface GhostExpect {
  /** The records folder, workspace-relative (`map` or `scenarios/<slug>`). */
  dir: string;
  /** Workspace-relative path → SHA-256 hex of the file's bytes (absent = ""). */
  files: Record<string, string>;
  /** The level/band the ghost was built in. */
  level: GhostGame;
  /** The game the MOVE belongs to (registry data, not the running band). */
  game: GhostGame;
}

/**
 * One derived step, READ-ONLY (ADR-0024 decision 1). v1 has one op: append one
 * canonical JSONL line to one file. The list is a rendering of the deriver's
 * output, never an instruction the app follows: accept re-derives it.
 */
export interface GhostStep {
  /** The one op v1 knows. */
  op: "append";
  /** The workspace-relative file the step writes. */
  file: string;
  /** The canonical JSONL line (through `serialize.ts`) the step appends. */
  line: string;
}

/**
 * A name proposal — an adjacent possible the person may coin, never authored
 * into the map by the app (ADR-0024's consequences). v1 carries NONE: the
 * sibling is present and empty, and the grammar refuses a non-empty list.
 */
export interface GhostProposal {
  /** What kind of proposal it is (v1 declares no kinds). */
  kind: string;
  /** The person-legible content. */
  text: string;
}

/**
 * The patch envelope. Every key is the app's; a hand edit changes VALUES and is
 * re-validated at accept. The agent never authors `id`, `expect`, `steps` or
 * `proposals` — the intake mints them.
 */
export interface GhostEnvelope {
  /** `attentioneer-ghost/1`. */
  format: string;
  /** The app-minted in-session id (also the inbox file's name). */
  id: string;
  /** The registered move. */
  move: GhostMove;
  /** What the move is about (v1: one word or loop). */
  target: GhostTarget;
  /** The move's authored content (v1: `{ text }`). */
  params: Record<string, unknown>;
  /** The base pin. */
  expect: GhostExpect;
  /** The proposal's prose why. */
  rationale: string;
  /** The derived, read-only step list (the deriver owns it). */
  steps: readonly GhostStep[];
  /** The read-only proposals sibling (empty in v1). */
  proposals: readonly GhostProposal[];
}

/** The envelope's own key set — a hand edit changes values, never the keys. */
export const GHOST_KEYS: readonly string[] = [
  "format",
  "id",
  "move",
  "target",
  "params",
  "expect",
  "rationale",
  "steps",
  "proposals",
];

/**
 * The agent's body keys: what a model reply may carry, and nothing else. The
 * app mints `id`, `expect`, `steps` and `proposals`; a body carrying any of
 * them is refused at intake.
 */
export const AGENT_PATCH_KEYS: readonly string[] = [
  "move",
  "target",
  "params",
  "rationale",
];

/** The id prefix the app mints (PROVISIONAL). */
export const GHOST_ID_PREFIX = "ghost-";

/**
 * The id shape the inbox can hold: letters, digits, dot, dash and underscore,
 * starting with a letter or digit — never a path (a hand-edited id cannot walk
 * out of the inbox), never empty.
 */
const GHOST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Does a string have the inbox id shape? */
export function isGhostId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && GHOST_ID.test(value);
}

/** Mint an in-session id: the prefix plus a random UUID (PROVISIONAL). */
export function mintGhostId(): string {
  return `${GHOST_ID_PREFIX}${crypto.randomUUID()}`;
}

/** The envelope's canonical bytes (through `serialize.ts`; hand-editable). */
export function serializeEnvelope(envelope: GhostEnvelope): string {
  return canonicalJson(envelope);
}

/** A name slot is a key that would let the agent coin a name — refused. */
export function isNameSlot(key: string): boolean {
  return key.trim().toLowerCase() === "name";
}

/** A plain JSON object (never an array, never null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The result of reading an envelope's bytes: the JSON object, or why not. */
export interface EnvelopeRead {
  /** The parsed object when the file is the ghost format; null otherwise. */
  value: Record<string, unknown> | null;
  /** Human problems with the file itself (JSON syntax, the format key). */
  problems: string[];
}

/**
 * Read an envelope file's bytes. Tolerant of a BOM (a hand edit), exact about
 * the format key: an object is returned only when it says
 * `format: attentioneer-ghost/1`. Everything else (keys, types, the move) is
 * the grammar's check, so this stays a byte-level read.
 */
export function readEnvelope(text: string): EnvelopeRead {
  const body = text.replace(/^\uFEFF/, "").trim();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { value: null, problems: ["the file is not JSON"] };
  }
  if (!isPlainObject(value)) {
    return { value: null, problems: ["the envelope is not a JSON object"] };
  }
  if (value.format !== GHOST_FORMAT) {
    return {
      value: null,
      problems: [`the format key is not "${GHOST_FORMAT}"`],
    };
  }
  return { value, problems: [] };
}

/** What a pasted/imported model reply yielded. */
export interface AgentOutput {
  /** The patch body (the model's JSON object), when one was found. */
  body: Record<string, unknown> | null;
  /** The prose around the body (the rationale fallback). */
  prose: string;
  /** Why no body was found. */
  problems: string[];
}

/**
 * Pull the patch body out of raw model output. The reply is untrusted text, so
 * three tries, in order: the whole reply as JSON; each fenced ```json block;
 * the first "{ … last "}" span of prose. The prose outside the block is kept as
 * the rationale fallback — the model's why, never curating anything.
 */
export function extractAgentOutput(raw: string): AgentOutput {
  const text = raw.replace(/^\uFEFF/, "");
  const trimmed = text.trim();
  const attempts: Array<{ body: string; prose: string }> = [
    { body: trimmed, prose: "" },
  ];
  const fence = /```[ \t]*(?:json)?[ \t]*\r?\n([\s\S]*?)```/g;
  for (let match = fence.exec(text); match !== null; match = fence.exec(text)) {
    attempts.push({
      body: match[1].trim(),
      prose: text.replace(match[0], " ").trim(),
    });
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const prose = `${text.slice(0, first)} ${text.slice(last + 1)}`.trim();
    attempts.push({ body: text.slice(first, last + 1), prose });
  }
  for (const attempt of attempts) {
    if (attempt.body === "") continue;
    try {
      const value: unknown = JSON.parse(attempt.body);
      if (isPlainObject(value)) {
        return { body: value, prose: attempt.prose, problems: [] };
      }
    } catch {
      // try the next shape
    }
  }
  return {
    body: null,
    prose: trimmed,
    problems: ["no patch body found: the reply carries no JSON object"],
  };
}
