import {
  appendPrismLine,
  type Prism,
  type RunOutcome,
} from "../map/prisms";

/**
 * THE RUN CONTACT (Epic 18 story 5, PROVISIONAL) — one session card's run as ONE
 * Move in the log.
 *
 * WHY THIS IS A CONTACT FLOW. A run is the largest egress the app makes: it
 * hands a directory, a prompt and possibly a key to an external program, and
 * ADR-0029's rule is that an egress is recorded structurally. It gets the same
 * shape the other four contacts get — a pure flow, its bridges injected, the
 * ONE PRISM appended through the record module's append door — so no panel or
 * transient can mint a Move of its own.
 *
 * STRUCTURE ONLY. The Change is the `run` kind: the tool ROW's id, the ending
 * and the result's exact byte size (null when the run did not complete). There
 * is no key here for the run's words, its prompt, the command, the directory,
 * an argv or a count of entries, because the Change has no slot for one — the
 * transcript at `map/sessions/<slug>.jsonl` keeps the words, and this line
 * keeps the shape. `on` is the SESSION CARD's slug (the Move is made in the
 * card), exactly as an ask card's turn names its card.
 *
 * The caller forms `outcome` and `resultSize` from the run's own ending
 * (`runOutcomeOf` / `sessionResultSize` in map/sessions.ts), so the history's
 * `session.run` line and this Change can never disagree about the same run.
 */

/** The bridges the run's Move needs; the app passes lib/fs, a test a fake. */
export interface RunContactDeps {
  readPrismsText: () => Promise<string | null>;
  writePrismsText: (text: string) => Promise<void>;
  /** The app-minted Move id (the record module's minter). */
  mintId: () => string;
}

/** One run Move's request: the card, the row, the ending and the size. */
export interface RunContactRequest {
  workspacePath: string;
  /** The SESSION CARD's slug — the Move is made in this card. */
  on: string;
  /** The tool ROW's id — never the command, never a path. */
  tool: string;
  outcome: RunOutcome;
  /** The result's byte size when the run completed, else null. */
  resultSize: number | null;
}

/** What the Move produced: its one PRISM. */
export interface RunContactResult {
  prism: Prism;
}

/**
 * Perform ONE run Move: read the log's bytes, append ONE canonical line and
 * write it back. Nothing earlier is parsed or rewritten (the append-only
 * posture), and no word of the run is anywhere in hand. PURE apart from the
 * bridges it is handed.
 */
export async function runRunContact(
  request: RunContactRequest,
  deps: RunContactDeps,
): Promise<RunContactResult> {
  const before = await deps.readPrismsText();
  const prism: Prism = {
    id: deps.mintId(),
    on: request.on,
    contact: "run",
    pointer: null,
    changes: [
      {
        kind: "run",
        tool: request.tool,
        outcome: request.outcome,
        resultSize: request.resultSize,
      },
    ],
    explanation: "",
    extra: {},
  };
  await deps.writePrismsText(appendPrismLine(before, prism));
  return { prism };
}
