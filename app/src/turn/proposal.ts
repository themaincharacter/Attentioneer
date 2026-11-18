import { utf8ByteLength } from "../lib/textBytes";
import { GHOST_FORMAT, GHOST_GAMES, isPlainObject } from "../ghost/envelope";

/**
 * THE TURN'S PROPOSAL BLOCK (Epic 15 story 8) — the one fenced block an answer
 * may carry when it wants to propose an edit to the map.
 *
 * This module is a SCANNER, not a second grammar. It finds at most one tagged
 * fence, parses it strictly, and hands the body on as plain JSON; the ghost's
 * existing intake (envelope.ts, grammar.ts, registry.ts) still decides whether
 * the proposal is a ghost at all. That is why nothing here knows the registry,
 * the move schema, the target kinds or the games: a body that fails those
 * checks comes back from the intake in the grammar's own words, and a body
 * that is not JSON at all is the ONE sentence below.
 *
 * The block carries the AGENT'S BODY — the same four keys a pasted reply has
 * carried since Epic 10 (`move`, `target`, `params`, `rationale`) — because the
 * ghost path's one door is the intake, and a second shape on the wire would be
 * a second ghost format. For tolerance, the story's illustrative wrapper
 * (`format`/`game`/`proposal`/`expect`/`why`) is unwrapped to the proposal
 * body: `why` stands in for the rationale, and the app still mints the id, the
 * pin and the steps exactly as it does for a hand-pasted reply.
 *
 * ONE PROPOSAL PER TURN: the first block is the proposal; a second tagged block
 * is ignored with one sentence (the step budget's sibling — a limit said in
 * words, never a counter). A block over the stated cap, a block that is not
 * JSON, a block that is not an object, or a wrapper with a key this build does
 * not know is NOT a proposal: one sentence, no ghost, and the answer stands as
 * text.
 *
 * PURE: no fs, no React, no clock and no randomness. The scanner is tested with
 * malformed, oversized and multiple blocks; the turn and the surfaces only call
 * it after an answer settles.
 *
 * PROVISIONAL: the fence's language tag, the cap, the two sentences and the
 * wrapper tolerance. Identity, the envelope and every refusal sentence stay the
 * ghost machinery's.
 */

/** The fence's language tag (PROVISIONAL). */
export const PROPOSAL_FENCE = "attentioneer-ghost";

/**
 * The largest block a turn will read, in UTF-8 bytes (PROVISIONAL; 16 KiB is
 * far more than one small claim and small enough that a runaway answer cannot
 * become a hidden second map).
 */
export const PROPOSAL_CAP = 16 * 1024;

/** The one sentence a block gets when it is not a proposal this app can use. */
export const NOT_A_PROPOSAL_SENTENCE =
  "that block was not a proposal the app can use, so the answer stands as text.";

/** The one sentence a second tagged block gets (it is ignored). */
export const SECOND_PROPOSAL_SENTENCE =
  "only one proposal per answer can be used, so the second block was ignored.";

/** The wrapper's keys, exactly (the story's illustrative shape; PROVISIONAL). */
export const PROPOSAL_WRAPPER_KEYS: readonly string[] = [
  "format",
  "game",
  "proposal",
  "expect",
  "why",
];

/** What scanning an answer found. */
export type ProposalRead =
  /** The answer carried no tagged block: it stands as text, nothing to say. */
  | { kind: "none" }
  /**
   * One usable body. `body` is JSON for the ghost intake; `sentence` is the
   * one-line note to show beside it (only when a second block was ignored).
   */
  | { kind: "proposal"; body: string; sentence: string | null }
  /** A tagged block that is not a proposal: one sentence, no ghost. */
  | { kind: "invalid"; sentence: string };

/** The answers a scanner can make when nothing is wrong. */
const NONE: ProposalRead = { kind: "none" };

/** One fenced block as the answer wrote it (its body lines, joined). */
export interface FencedBlock {
  tag: string;
  body: string;
}

/**
 * Every closed fenced block in the answer, in order. A fence opens with a line
 * that is exactly three backticks plus an optional language tag; it closes with
 * a line that is exactly three backticks. An unclosed fence is not a block.
 * This is deliberately stricter than the paste path's permissive `json` scan:
 * a proposal must say which fence it is.
 *
 * STORY 17.12 uses the SAME scanner for the curator's card block: one discipline
 * for every fenced block a model is asked to write, so a malformed block is
 * refused the same way wherever it appears.
 */
export function fencedBlocksOf(answer: string): FencedBlock[] {
  const lines = answer.split(/\r?\n/);
  const blocks: FencedBlock[] = [];
  let at = 0;
  while (at < lines.length) {
    const open = /^[ \t]*```[ \t]*([^\s`]*)[ \t]*$/.exec(lines[at]);
    if (open === null) {
      at += 1;
      continue;
    }
    const start = at + 1;
    let end = start;
    while (end < lines.length && !/^[ \t]*```[ \t]*$/.test(lines[end])) {
      end += 1;
    }
    if (end >= lines.length) break; // unclosed: nothing was written
    blocks.push({ tag: open[1], body: lines.slice(start, end).join("\n") });
    at = end + 1;
  }
  return blocks;
}

/** The proposal body from a parsed object, or the reason it is not one. */
function bodyOf(
  value: Record<string, unknown>,
): { ok: true; body: Record<string, unknown> } | { ok: false } {
  // The wrapper (the story's illustrative shape): unwrap it, keep the why as
  // the rationale's fallback, and refuse a key this build does not know.
  if ("proposal" in value || "format" in value || "why" in value) {
    for (const key of Object.keys(value)) {
      if (!PROPOSAL_WRAPPER_KEYS.includes(key)) return { ok: false };
    }
    if (value.format !== undefined && value.format !== GHOST_FORMAT) {
      return { ok: false };
    }
    if (
      value.game !== undefined &&
      (typeof value.game !== "string" ||
        !(GHOST_GAMES as readonly string[]).includes(value.game))
    ) {
      return { ok: false };
    }
    if (!isPlainObject(value.proposal)) return { ok: false };
    const why = value.why;
    if (why !== undefined && typeof why !== "string") return { ok: false };
    const body = { ...value.proposal };
    if (body.rationale === undefined && typeof why === "string" && why !== "") {
      body.rationale = why;
    }
    return { ok: true, body };
  }
  return { ok: true, body: value };
}

/**
 * Read one answer's proposal block. The body is handed over as JSON text for
 * the ghost intake; everything else (the move, the target, the game, the pin)
 * is the existing machinery's check, never this scanner's.
 */
export function readProposal(answer: string): ProposalRead {
  const tagged = fencedBlocksOf(answer).filter(
    (block) => block.tag === PROPOSAL_FENCE,
  );
  if (tagged.length === 0) return NONE;

  const body = tagged[0].body.trim();
  if (body === "" || utf8ByteLength(body) > PROPOSAL_CAP) {
    return { kind: "invalid", sentence: NOT_A_PROPOSAL_SENTENCE };
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { kind: "invalid", sentence: NOT_A_PROPOSAL_SENTENCE };
  }
  if (!isPlainObject(value)) {
    return { kind: "invalid", sentence: NOT_A_PROPOSAL_SENTENCE };
  }
  const read = bodyOf(value);
  if (!read.ok) {
    return { kind: "invalid", sentence: NOT_A_PROPOSAL_SENTENCE };
  }
  return {
    kind: "proposal",
    body: JSON.stringify(read.body),
    sentence: tagged.length > 1 ? SECOND_PROPOSAL_SENTENCE : null,
  };
}

/**
 * Is this read a usable body? A predicate, so the contact flows can ask the
 * question without spelling the kind (a contact write must never grow a gate
 * word — the source scans hold that line).
 */
export function isProposal(
  read: ProposalRead | undefined,
): read is { kind: "proposal"; body: string; sentence: string | null } {
  return read !== undefined && read.kind === "proposal";
}
