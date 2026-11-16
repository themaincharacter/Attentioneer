/**
 * The ghost's issue vocabulary (Epic 10 story 1, ADR-0024/0025).
 *
 * Every refusal the grammar, the intake and the accept can produce is one of
 * these codes plus a human sentence. Codes are the app's, sentences are the
 * person's: the app never renders a code, and no code is a score, a count or a
 * certainty label. Pure data — this module imports nothing.
 */

/** What a refusal is about. */
export type GhostIssueCode =
  /** The file is not the ghost format (or is not JSON at all). */
  | "format"
  /** A key, a type or the envelope's own shape is wrong. */
  | "shape"
  /** A key the envelope does not keep (hand edits change values, not keys). */
  | "unknown-key"
  /** A slot that would let the agent coin a name — refused everywhere. */
  | "name-slot"
  /** The move is not in the registry (only registered ids accept). */
  | "unregistered-move"
  /** The target's kind is not one the record grammar has. */
  | "target-shape"
  /** A known target kind the move refuses in v1 (a spot, a link). */
  | "refused-target"
  /** The move's authored content (text) is wrong. */
  | "params"
  /** The prose rationale is missing or empty. */
  | "rationale"
  /** The base pin's own shape is wrong. */
  | "expect-shape"
  /** The game the ghost was built in is not the game running. */
  | "game"
  /** The level (the band) moved since the ghost was built. */
  | "level"
  /** A branch is active: ghosts are refused (the base pin fails). */
  | "branch"
  /** The target the claim is about is not on the map. */
  | "dangling-target"
  /** The dry run would not only append (rewrite, drop, or a duplicate claim). */
  | "append-only"
  /** v1 moves write one file, and the pin names exactly that file. */
  | "single-file"
  /** The base pin does not match the file the move would write. */
  | "pin"
  /** The ghost's id is not one shape the inbox can hold. */
  | "id"
  /** The pasted reply carries no patch body, or not one the app can read. */
  | "intake"
  /** The app could not write/claim its marker (an fs failure, not a refusal). */
  | "write";

/** One refusal: a code the app switches on and a sentence it can show. */
export interface GhostIssue {
  code: GhostIssueCode;
  message: string;
}

/** A refusal, spelled once. */
export function issue(code: GhostIssueCode, message: string): GhostIssue {
  return { code, message };
}

/** Every issue's sentence, for a caller that has no better rendering yet. */
export function describeIssues(issues: readonly GhostIssue[]): string {
  return issues.map((entry) => entry.message).join("; ");
}
