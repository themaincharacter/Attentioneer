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
 * THE PACKET-HASH PROVENANCE (Epic 11 story 3, ADR-0027 §5 as amended): when
 * the person asked a packet before the reply, the app also mints
 * `packetHash` — the frozen packet's hash — onto the envelope. It is
 * PROVENANCE, never enforcement: nothing reads it (not the grammar, not the
 * accept, not the base pin), so editing a game card, asking again and filing
 * another reply never refuses the previous ghost. The card stays OUT of the
 * base pin, exactly as the ADR's amendment says: the hash makes the ask
 * visible, it does not hold the proposal to it.
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
 * Provisional: the format key's value, the id prefix, the step's JSON look,
 * `proposals` being a plain array of nothing in v1, and the `packetHash`
 * key's spelling and its optionality (provenance; absent when no ask).
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
  | { kind: "link"; from: string; to: string }
  /**
   * STORY 21.1 — ONE CARD BY ITS SLUG. The command card's acts name the map's
   * cards the way a person does; a proposal that is ABOUT an existing card
   * (a note) therefore needs a target that is a card, never a "word". The
   * envelope already spoke word/loop/spot/link; this is the fifth kind, added
   * because the portable vocabulary must be able to say "this card" without
   * learning a map's record file names (ADR-0038 §3). PROVISIONAL with the
   * act names.
   */
  | { kind: "card"; slug: string }
  /**
   * STORY 21.7 — ONE ASK CARD BY ITS SLUG. An ask card is its own family, not a
   * ground reference: it has a conversation instead of a reading and a note, so
   * "the card this move is about" cannot be the card kind without teaching the
   * grammar that an ask is a reference. The sixth kind is the smallest honest
   * addition — the removal of an ask names that ask and nothing else.
   * PROVISIONAL with the act names.
   */
  | { kind: "ask"; slug: string };

/** The known target kinds, for shape checks. */
export const GHOST_TARGET_KINDS: readonly GhostTarget["kind"][] = [
  "word",
  "loop",
  "spot",
  "link",
  "card",
  "ask",
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
 * One derived step, READ-ONLY (ADR-0024 decision 1). A step APPENDS one
 * canonical line or REMOVES one thing; the list is a rendering of the deriver's
 * output, never an instruction the app follows: accept re-derives it.
 *
 * STORY 21.6 — A GHOST CAN REMOVE (ADR-0038's 2026-11-20 amendment: a primary
 * surface with only adds cannot fix a mistake it just made). The op is the
 * smallest generic addition the intake needed: an append of one line, or a
 * removal of one line from a file (or of the file itself, when no line is
 * named). The step still says WHAT changes, never a cascade: the move's deriver
 * names exactly one thing, and the closure proves the bytes are the base minus
 * that one thing. PROVISIONAL with the act names — the op's spelling and the
 * optional `line` are the first shape.
 */
export type GhostStep = GhostAppendStep | GhostRemoveStep;

/** Append one canonical line to one file (the v1 op, unchanged). */
export interface GhostAppendStep {
  /** The one append op. */
  op: "append";
  /** The workspace-relative file the step writes. */
  file: string;
  /** The canonical line (through `serialize.ts`) the step appends. */
  line: string;
}

/** Remove one line from one file, or the file itself when no line is named. */
export interface GhostRemoveStep {
  /** The removal op. */
  op: "remove";
  /** The workspace-relative file the step touches. */
  file: string;
  /**
   * The EXACT line to drop, as the base file holds it (the deriver reads the
   * base bytes and names the line, CR included when the file is CRLF). Absent
   * means the file itself goes: a note is one file, so removing it removes no
   * line from anyone else's record.
   */
  line?: string;
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
  /**
   * The frozen packet's hash this reply answers, when the person asked one
   * first (PROVENANCE ONLY, Epic 11 story 3). App-minted at intake, never
   * authored, and never read: the grammar, the accept and the base pin all
   * ignore it, so a card edit between ask and accept refuses nothing.
   * Absent when the paste answered no ask.
   */
  packetHash?: string;
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

/**
 * The envelope's own key set — a hand edit changes values, never the keys.
 * `packetHash` is app-minted provenance (Epic 11 story 3) and is allowed
 * here, but it is never read: the key set's door is about KEYS, and no value
 * under this one can refuse a ghost.
 */
export const GHOST_KEYS: readonly string[] = [
  "format",
  "id",
  "packetHash",
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

/**
 * Attach the packet-hash provenance to a validated envelope (Epic 11 story 3).
 * The session calls this AFTER the grammar has spoken, so the grammar never
 * sees the key at intake; a reshape re-files the same proposal under the ask
 * it already answered. PROVENANCE ONLY: a missing or non-string hash attaches
 * nothing, and nothing ever reads the value.
 */
export function withPacketHash(
  envelope: GhostEnvelope,
  hash: unknown,
): GhostEnvelope {
  if (typeof hash !== "string" || hash === "") return envelope;
  return { ...envelope, packetHash: hash };
}

/** A name slot is a key that would let the agent coin a name — refused. */
export function isNameSlot(key: string): boolean {
  return key.trim().toLowerCase() === "name";
}

/** A plain JSON object (never an array, never null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A target's SHAPE, read defensively from an untrusted value (STORY 21.1): the
 * kind and its payload, never the move's rules and never its key set. The
 * grammar still owns "may this move carry it"; this reader exists because a
 * move's FILE LIST can depend on the target (a note's file is named by the
 * card it is about), so the session and the request must know the target
 * before the grammar has spoken. Null for anything out of shape, which a move
 * with a target-dependent file list reads as "no files" — fail-closed.
 */
export function targetFromValue(value: unknown): GhostTarget | null {
  if (!isPlainObject(value)) return null;
  if (value.kind === "card" || value.kind === "ask") {
    const slug = value.slug;
    return typeof slug === "string" && slug !== ""
      ? { kind: value.kind, slug }
      : null;
  }
  if (value.kind === "word" || value.kind === "loop") {
    const slug = value.slug;
    return typeof slug === "string" && slug !== ""
      ? { kind: value.kind, slug }
      : null;
  }
  if (value.kind === "spot") {
    const x = value.x;
    const y = value.y;
    return typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y)
      ? { kind: "spot", x, y }
      : null;
  }
  if (value.kind === "link") {
    const from = value.from;
    const to = value.to;
    return typeof from === "string" &&
      from !== "" &&
      typeof to === "string" &&
      to !== ""
      ? { kind: "link", from, to }
      : null;
  }
  return null;
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
