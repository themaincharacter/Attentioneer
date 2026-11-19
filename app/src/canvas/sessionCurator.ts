import { artifactPlacement } from "./geometry";
import type { GroundReference } from "../map/ground";
import type { GroundLink } from "../map/groundLinks";
import { cardProvenanceSourceSlug, type Reading } from "../map/readings";
import {
  SESSION_RESULT_EMPTY_SENTENCE,
  SESSION_RESULT_UNFINISHED_SENTENCE,
  sessionResultName,
  sessionRunResult,
  type SessionCard,
  type SessionEntry,
} from "../map/sessions";
import type { CuratorRead } from "../turn/curator";
import { taskOfSent } from "../turn/packet";

/**
 * STORY 19.4 — THE CURATOR DISTILS A RUN'S RESULT (ADR-0037 §10's planned
 * reuse).
 *
 * A session card's copy verb ("make a card from this") is a RULE's copy and
 * stays exactly what it was: the run's words, whole, as a selection card. This
 * module is the SECOND path, the artifact: one CURATOR model call turns the
 * run's result into a card with a claim and its caveats. The curator itself is
 * REUSED AS-IS (turn/curator.ts): the same three inputs, the same caps, the same
 * parse, the same decline rule and the same sentences.
 *
 * WHAT IS NEW HERE IS THE BRIEF. An ask card's brief is the person's typed
 * question. A session card's task is EPHEMERAL — the card holds no task field,
 * so the only copy of what the run was asked is the transcript's `sent` entry.
 * {@link sessionDistilBrief} recovers it from that packet block (turn/packet.ts's
 * `taskOfSent`) and refuses the press when it cannot: a curator called with no
 * brief would distil a reply it was never told the question for.
 *
 * THE MATERIAL RULE HOLDS BY CONSTRUCTION. The brief is the task and the reply,
 * both from the transcript's own bytes; the digest is composed by
 * turn/curatorDigest.ts from records and reading LINES, never from a card's
 * text. This module never passes a wired card's text to the prompt, and it has
 * no argument that could carry one.
 *
 * FAILURE IS ASYMMETRIC AND NEVER LOSES WORK (ADR-0037 decision 8). A decline,
 * an unusable block, an over-long card or a failed call writes NO card and
 * answers ONE sentence; the transcript's entries are never touched, so the raw
 * result is exactly where it was, one press from the card's transcript.
 *
 * PURE apart from the ONE writer bridge it is handed (`writeCard`), which is
 * useGround's `writeDistilledCard` — the SAME writer an ask card's artifact
 * uses, so a session-slug artifact is an ordinary distilled card (its
 * provenance `card://<session>`, its wire back to the card) and no second
 * card form exists.
 *
 * PROVISIONAL: every sentence below, and the two refusal gates' wording.
 */

/**
 * THE ONE SENTENCE A RUN WHOSE TASK CANNOT BE RECOVERED ANSWERS (PROVISIONAL).
 * No curator call is made: an empty brief would spend a model call to distil a
 * question nobody can name. The result is untouched.
 */
export const SESSION_DISTIL_NO_TASK_SENTENCE =
  "the task this run was sent is not in its transcript, so no card was made.";

/**
 * THE FAILURE ASYMMETRY'S SENTENCE, in the run's own voice (PROVISIONAL): the
 * result stands and one sentence says why there is no card. It is also the
 * sentence when nothing could leave at all (no manager row resolved, no turn
 * port): an egress that never happened makes no Move and no card.
 */
export const SESSION_CURATOR_FAILED_SENTENCE =
  "the result stands, but no card was made: the curator did not answer.";

/**
 * WHAT A PRESS NEEDS TO HAVE (PURE): the task the run was sent, and the reply
 * that came back. Only a COMPLETED run has a result — a partial is never a
 * result (the 18.4 rule) — and only that same run's `sent` entry can brief the
 * curator. A transcript from before the task rode the packet has a completed
 * run and no task, and that refuses with its own sentence rather than guessing.
 */
export type SessionDistilBrief =
  | { kind: "ready"; task: string; reply: string }
  | { kind: "refused"; message: string };

/** The last run's `sent` packet, or null: the span between two endings. */
function lastSentText(entries: readonly SessionEntry[]): string | null {
  let lastEnd = -1;
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    if (entries[at]!.kind === "ended") {
      lastEnd = at;
      break;
    }
  }
  if (lastEnd < 0) return null;
  let start = 0;
  for (let at = lastEnd - 1; at >= 0; at -= 1) {
    if (entries[at]!.kind === "ended") {
      start = at + 1;
      break;
    }
  }
  for (let at = lastEnd - 1; at >= start; at -= 1) {
    const entry = entries[at]!;
    if (entry.kind === "sent") return entry.text;
  }
  return null;
}

/** Read the last completed run's brief from the transcript, or say why not. */
export function sessionDistilBrief(
  entries: readonly SessionEntry[],
): SessionDistilBrief {
  const result = sessionRunResult(entries);
  if (result.ending === null) {
    return { kind: "refused", message: SESSION_RESULT_EMPTY_SENTENCE };
  }
  if (result.ending !== "completed") {
    return { kind: "refused", message: SESSION_RESULT_UNFINISHED_SENTENCE };
  }
  if (result.text === "") {
    return { kind: "refused", message: SESSION_RESULT_EMPTY_SENTENCE };
  }
  const sent = lastSentText(entries);
  const task = sent === null ? null : taskOfSent(sent);
  if (task === null) {
    return { kind: "refused", message: SESSION_DISTIL_NO_TASK_SENTENCE };
  }
  return { kind: "ready", task, reply: result.text };
}

/**
 * WHAT THE WRITER PRODUCES. `written` hands back the same result
 * `writeDistilledCard` returns for an ask card — the new records, the wire and
 * the text — so the hook updates its refs one way for both card families.
 */
export type SessionCuratorWrite =
  | { kind: "written"; card: Extract<AskDistilledCard, { kind: "written" }> }
  | { kind: "none"; sentence: string };

/** The bridges this path needs: the ONE reused distiller, injected. */
export interface SessionCuratorIo {
  /**
   * useGround's `writeDistilledCard`, handed in so this module never imports
   * the hook (that would be a cycle) and so the writer stays ONE implementation
   * for both card families.
   */
  writeCard: DistilledCardWriter;
}

/** The signature of useGround's writer, by reference — never a copy. */
export type DistilledCardWriter = typeof import("./useGround").writeDistilledCard;

/** The card the artifact carries, from useGround's own result type. */
type AskDistilledCard = import("./useGround").AskDistilledCard;

/** Everything one distil press needs to write, or refuse, its card. */
export interface SessionCuratorInput {
  workspacePath: string;
  references: readonly GroundReference[];
  readings: readonly Reading[];
  links: readonly GroundLink[];
  malformedGround: readonly string[];
  malformedReadings: readonly string[];
  malformedLinks: readonly string[];
  /** The session card the artifact is made from and wired back to. */
  session: SessionCard;
  /** The record's clock value for the new reading line. */
  taken: string;
  /** The shared slug set (ground + asks + sessions) the new card mints against. */
  slugs: ReadonlySet<string>;
  /** The curator's parse, or null when its call produced no usable text. */
  read: CuratorRead | null;
  /** The ONE sentence a failed call left; read when `read` is null. */
  sentence: string | null;
  /** The two models the artifact names as its authors. */
  authors: { manager: string; task: string };
}

/**
 * WRITE THE ARTIFACT — or write nothing and answer the ONE sentence. The
 * decision is the parse's (turn/curator.ts): a card is written only for
 * `kind: "card"`; a decline keeps its own first sentence, a malformed or
 * over-long answer keeps the curator module's stated sentence, and a failed
 * call keeps the asymmetry's. In every refusal path the transcript is never
 * read past its entries and never written: the result stands.
 */
export async function writeCuratedRunCard(
  input: SessionCuratorInput,
  io: SessionCuratorIo,
): Promise<SessionCuratorWrite> {
  const read = input.read;
  if (read === null) {
    return {
      kind: "none",
      sentence: input.sentence ?? SESSION_CURATOR_FAILED_SENTENCE,
    };
  }
  if (read.kind !== "card") return { kind: "none", sentence: read.sentence };
  // THE ARTIFACT LANDS RIGHT: to the RIGHT of the session card, level with it,
  // and later cards cascade DOWN past the ones already there — the ask card's
  // placement rule, reused so "beside" means one thing on this plane. The
  // column is READ FROM THE RECORDS (every card whose provenance names this
  // session, the rule's selection copy and the curator's distilled card alike),
  // so the two verbs' cards never land on top of one another.
  const readingsBy = new Map<string, Reading>();
  for (const reading of input.readings) {
    if (!readingsBy.has(reading.on)) readingsBy.set(reading.on, reading);
  }
  const column = input.references
    .filter((reference) => {
      const reading = readingsBy.get(reference.on);
      return (
        reading !== undefined &&
        cardProvenanceSourceSlug(reading) === input.session.on
      );
    })
    .map((reference) => ({ x: reference.x, y: reference.y }));
  const at = artifactPlacement(
    { x: input.session.x, y: input.session.y },
    column,
  );
  const title = read.card.title.trim();
  const name = title === "" ? sessionResultName(input.session.name) : title;
  const written = await io.writeCard(
    input.workspacePath,
    input.references,
    input.readings,
    input.links,
    input.malformedGround,
    input.malformedReadings,
    input.malformedLinks,
    input.session.on,
    name,
    at.x,
    at.y,
    read.text,
    input.taken,
    undefined,
    { taken: input.slugs },
    input.authors,
  );
  if (written.kind === "refused") {
    return { kind: "none", sentence: written.message };
  }
  return { kind: "written", card: written };
}
