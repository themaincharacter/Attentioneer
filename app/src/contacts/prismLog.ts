import {
  canonicalizePath,
  readTextFile,
  readTextHead,
  writeTextFile,
} from "../lib/fs";
import { copyText } from "../lib/clipboard";
import { openOutward } from "../canvas/outward";
import { pointersPath } from "../map/pointers";
import { isProposal } from "../turn/turn";
import {
  type AskRole,
  loadLatestPrism,
  mintPrismId,
  prismsPath,
  rewritePrismExplanation,
  type ContactKind,
  type Prism,
  type PrismPointer,
} from "../map/prisms";
import {
  runReadContact,
  type ReadContactDeps,
  type ReadContactRequest,
  type ReadContactResult,
} from "./read";
import {
  runMakeContact,
  type MakeContactDeps,
  type MakeContactRequest,
  type MakeContactResult,
} from "./make";
import {
  runEgressContact,
  type EgressContactDeps,
  type EgressContactRequest,
  type EgressContactResult,
} from "./egress";
import {
  runRunContact,
  type RunContactDeps,
  type RunContactRequest,
} from "./run";
import type { AskPacket } from "../turn/packet";
import {
  abandonAsk,
  askCardInFlight,
  askOutcomeOf,
  intakeAskResponse,
  recordAskCardTurn,
  sendAsk,
  type AskAbandonResult,
  type AskAppSend,
  type AskAttachment,
  type AskContactDeps,
  type AskEnding,
  type AskIntakeResult,
  type AskRequest,
  type AskSendResult,
  type AskSendView,
  type InFlightAsk,
} from "./ask";

/**
 * THE APP'S WIRING FOR THE CONTACT MOVES (Epic 12 stories 2–3) — the one bridge
 * between the pure contact paths (read.ts, make.ts, egress.ts, ask.ts) and the
 * Tauri-backed fs module.
 *
 * ONE FILE, ONE QUEUE. map/prisms.jsonl is a read-modify-write file: an append
 * reads the existing bytes, adds one canonical line and writes the whole file;
 * the explanation save reads, replaces one line's explanation and writes. If
 * two of those ran at once an older file could reappear under a newer one, so
 * EVERY door shares one in-order queue (the writeQueue precedent) — the read
 * Move, the explanation save, the reopen's read, Make's append and Ask's
 * intake all append to the same log. A failed task never stalls the next: the
 * rejection reaches its caller and the queue moves on.
 *
 * THE TWO BRIDGES THE STORY-3 MOVES NEED, EACH ONE DOOR:
 *   - the RAW artifact writer is `writeTextFile` (the bridge), never the
 *     canonicalising machine door: an artifact is the person's bytes, verbatim
 *     (ADR-0029 rule 5's named exception);
 *   - the OS handoff is `openOutward` (canvas/outward.ts), the app's ONE
 *     opener call site — the plugin's IPC/JS API, never a Rust-side bypass.
 *     A rejected handoff throws, and the contact flow logs handoff-failed.
 *   - the clipboard copy is `copyText` (lib/clipboard.ts), the question's own
 *     carrier; false means nothing left.
 *
 * Make's mint reads and writes map/pointers.jsonl through this queue, so the
 * Move's own mint is in order with every other contact write. The map's OWN
 * pointer edits run through useMap's separate queue, so a mint and a map edit
 * made at the same moment could interleave and clobber one another — a NAMED
 * follow-up, in the debt's spirit (the queues are per-surface, like the
 * boundary's Rust-side guard). The window is narrow (both are one
 * read-modify-write task), the app reloads the map after a moved Make, and the
 * contact panels do NOT arm the plane's gate (the ghost panel's precedent: a
 * panel outside `.plane` leaves the canvas live).
 *
 * The contact paths themselves import no Tauri runtime: this module is the
 * only place that knows the bridges, and the flows are asserted with fakes in
 * bun (the boundary's injected-canonicalizer idiom, one layer up).
 *
 * Provisional: the module's name and the queue's lifetime (one per app run;
 * one window, one workspace at a time).
 */

/** The tail of the PRISM file's one write queue. */
let tail: Promise<unknown> = Promise.resolve();

/** Queue one read-modify-write of map/prisms.jsonl, in order. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** The bridges the read path needs, bound to one workspace. */
export function readContactDeps(workspacePath: string): ReadContactDeps {
  const path = prismsPath(workspacePath);
  return {
    canonicalize: canonicalizePath,
    readHead: readTextHead,
    readPrismsText: () => readTextFile(path),
    writePrismsText: (text) => writeTextFile(path, text),
    mintId: mintPrismId,
  };
}

/**
 * Perform ONE Look/Measure Move: the read path appends exactly one PRISM line
 * in the file's order, inside the shared queue. A table refusal is not a Move
 * (nothing is read, nothing is appended).
 */
export function runReadMove(
  request: ReadContactRequest,
): Promise<ReadContactResult> {
  return enqueue(() => runReadContact(request, readContactDeps(request.workspacePath)));
}

/**
 * Save the person's explanation on ONE completed Move, addressed by id
 * (PROVISIONAL: authored at the Move's window). The read path's changes stay
 * read-only: this rewrites only that line's explanation field and keeps every
 * other byte. False means the line is gone (or the file is) — nothing is
 * written and the window says "not saved".
 */
export function savePrismExplanation(
  workspacePath: string,
  id: string,
  explanation: string,
): Promise<boolean> {
  return enqueue(async () => {
    const path = prismsPath(workspacePath);
    const text = await readTextFile(path);
    if (text === null) return false;
    const next = rewritePrismExplanation(text, id, explanation);
    if (next === null) return false;
    await writeTextFile(path, next);
    return true;
  });
}

/**
 * The reopen affordance's read: ONE reach's latest PRISM, fresh from disk. The
 * record layer's citation scan (latestPrismIn) answers one Prism or null — the
 * app has no gallery, no counter and no cached series.
 */
export function readLatestPrism(
  workspacePath: string,
  on: string,
  pointer: PrismPointer | null,
  contact?: ContactKind,
): Promise<Prism | null> {
  // Queued behind any pending save: closing the window saves, and a reopen
  // immediately after must read the saved words, not the stale bytes.
  return enqueue(() => loadLatestPrism(workspacePath, on, pointer, contact));
}

/**
 * THE APP'S ONE OS HANDOFF DOOR (Epic 12 story 3): a url through the outward
 * window's opener bridge. It is the SAME door the window's ↗ uses — the
 * plugin's IPC/JS API with the capability's scope, never a Rust-side command
 * that would silently evade it. The contact flow has already guarded the
 * scheme; a refusal here (the plugin says no) throws, and the Move logs
 * handoff-failed — the app never claims a handoff it did not make.
 */
async function handOffUrl(url: string): Promise<void> {
  const result = await openOutward("url", url, "");
  if (!result.ok) throw new Error(result.message ?? "cannot open");
}

/** Make's bridges: the boundary, the pointers file, the raw writer, the log. */
export function makeContactDeps(workspacePath: string): MakeContactDeps {
  const prisms = prismsPath(workspacePath);
  const pointers = pointersPath(workspacePath);
  return {
    canonicalize: canonicalizePath,
    readPointersText: () => readTextFile(pointers),
    writePointersText: (text) => writeTextFile(pointers, text),
    // RAW UTF-8: the bridge itself, never the canonicalising machine door. An
    // artifact is the person's bytes, verbatim (the named exception).
    writeArtifact: (path, text) => writeTextFile(path, text),
    readPrismsText: () => readTextFile(prisms),
    writePrismsText: (text) => writeTextFile(prisms, text),
    mintId: mintPrismId,
  };
}

/**
 * Perform ONE Make Move (Epic 12 story 3): mint the artifact's pointer, write
 * the raw text, and append the ONE PRISM — all inside the shared queue, so the
 * mint and the log can never interleave with another contact write. No accept
 * gate: the person's gesture is the gate.
 */
export function runMakeMove(request: MakeContactRequest): Promise<MakeContactResult> {
  return enqueue(() =>
    runMakeContact(request, makeContactDeps(request.workspacePath)),
  );
}

/** The egress bridges: the one handoff door and the PRISM file. */
export function egressContactDeps(workspacePath: string): EgressContactDeps {
  const prisms = prismsPath(workspacePath);
  return {
    handOff: handOffUrl,
    readPrismsText: () => readTextFile(prisms),
    writePrismsText: (text) => writeTextFile(prisms, text),
    mintId: mintPrismId,
  };
}

/**
 * Perform ONE egress Move (Epic 12 story 3): hand a url to the OS and append
 * the ONE PRISM with the outcome — handed, handoff-failed or refused. The log
 * says handed, never "opened".
 */
export function runEgressMove(
  request: EgressContactRequest,
): Promise<EgressContactResult> {
  return enqueue(() =>
    runEgressContact(request, egressContactDeps(request.workspacePath)),
  );
}

/**
 * The Ask's bridges: the app-sent sender (when the app wires one), the
 * clipboard, the handoff door and the PRISM file. The sender is passed in
 * because the turn's provider, key and sidecar belong to the app, not to the
 * contact path (Epic 15 story 2).
 */
export function askContactDeps(
  workspacePath: string,
  sendApp?: (packet: AskPacket) => Promise<AskAppSend>,
): AskContactDeps {
  const prisms = prismsPath(workspacePath);
  return {
    copy: copyText,
    sendApp,
    handOff: handOffUrl,
    canonicalize: canonicalizePath,
    readPrismsText: () => readTextFile(prisms),
    writePrismsText: (text) => writeTextFile(prisms, text),
    mintId: mintPrismId,
  };
}

/**
 * SEND one Ask's question out (Epic 12 story 3; the app-sent route added by
 * Epic 15 story 2). The clipboard routes append nothing: the Move completes
 * when the response comes back (or the person ends the ask).
 *
 * THE APP-SENT ANSWER is the exception, and the queue is why it is split: the
 * turn may take a minute, so the network wait runs OUTSIDE the PRISM file's
 * queue and only the intake (wrap + ONE append) is enqueued — with the SAME
 * `intakeAskResponse` a paste uses. A stated fallback writes nothing; a failed
 * intake says its one sentence and leaves the file alone.
 *
 * THE ENDING FORMS THE RECORD (Epic 15 story 7b): a completed turn enters the
 * answered intake; a stop, a break or the turn's own budget enters the SAME
 * no-response path a paste-less close uses — one append, no size, even when
 * the panel holds words. The view streams while the turn runs, but it never
 * writes; the one record is formed here, from how the turn ended.
 */
export async function sendAskOut(
  request: AskRequest,
  sendApp?: (
    packet: AskPacket,
    onPart?: (text: string) => void,
  ) => Promise<AskAppSend>,
  view: AskSendView = {},
): Promise<AskSendResult> {
  const sent = await sendAsk(
    request,
    askContactDeps(request.workspacePath, sendApp),
    view,
  );
  if (sent.kind !== "sent") return sent;
  // A PARTIAL IS NEVER AN ANSWER: the ending, not the bytes, chooses the one
  // record. A stopped/failed/timed-out turn takes the existing no-response
  // Change (no size, no decode, no words) — exactly one append.
  if (sent.ending !== undefined && askOutcomeOf(sent.ending) === "no-response") {
    const ask = sent.ask;
    return enqueue(async () => {
      const ended = await abandonAsk(
        ask,
        askContactDeps(request.workspacePath),
      );
      if (ended.kind === "refused") return { ...sent, note: ended.reason };
      return { ...sent, prism: ended.prism };
    });
  }
  if (sent.answer === undefined) return sent;
  // A USABLE PROPOSAL IS NOT AN ASK'S RESPONSE (Epic 15 story 8): it is the
  // ghost path's, filed through the existing intake and accepted only by the
  // person. Logging it as a PRISM too would leave a record of the exchange on
  // disk, so the answer stands as the proposal and nothing is appended here.
  if (isProposal(sent.ghost)) return sent;
  const answer = sent.answer;
  return enqueue(async () => {
    const intake = await intakeAskResponse(
      sent.ask,
      answer,
      null,
      askContactDeps(request.workspacePath),
    );
    if (intake.kind === "refused") return { ...sent, note: intake.reason };
    return { ...sent, response: intake.response, prism: intake.prism };
  });
}

/**
 * ONE ASK CARD'S SENDING TURN IS ONE MOVE (Epic 17 story 4). The turn itself
 * runs OUTSIDE this queue (a provider may take its whole budget); only the
 * record write is queued, in the same order as every other contact write.
 *
 * THE ENDING FORMS THE RECORD, exactly as story 15.7b settled: a completed
 * turn is `answered` with the response's exact size and decode, and a stop, a
 * break or the turn's budget is the existing no-response, even when the card
 * still shows a partial. Since STORY 17.9 the WIRED context cards are the
 * material and their readings' natural keys are the inclusion set; the legacy
 * `anchor` field is NOT written on a new line (old lines still parse and
 * display). NOT ONE WORD of the question, the answer or the thread is written
 * here — the conversation file keeps those, and its answer line names this
 * PRISM's id.
 *
 * The caller appends this BEFORE the conversation line, because the answer
 * line carries the Move's id (PROVISIONAL ordering, the story's own note).
 */
export function appendAskCardMove(
  workspacePath: string,
  on: string,
  included: string[] | null,
  ending: AskEnding,
  answer: string | null,
  role?: AskRole,
): Promise<Prism | null> {
  return enqueue(async () => {
    // STORY 17.9 — NO ANCHOR. The Move names the ask card and the WIRED
    // context's inclusion set; the old `anchor` field is legacy and new lines
    // do not carry it (old lines still parse and display).
    // STORY 17.12 — the curator's egress names its ROLE; a task call leaves it
    // absent, so old lines and new task lines keep the same shape.
    const moved = await recordAskCardTurn(
      askCardInFlight(workspacePath, { on, included, role }),
      ending,
      answer,
      askContactDeps(workspacePath),
    );
    return moved.prism;
  });
}

/** The run flow's bridges: the log's file, read and written whole. */
export function runContactDeps(workspacePath: string): RunContactDeps {
  const prisms = prismsPath(workspacePath);
  return {
    readPrismsText: () => readTextFile(prisms),
    writePrismsText: (text) => writeTextFile(prisms, text),
    mintId: mintPrismId,
  };
}

/**
 * STORY 18.5 — ONE SESSION CARD'S RUN IS ONE MOVE. The run itself happens
 * outside this queue (the sidecar owns the child and its whole budget); only the
 * record write is enqueued, in the same order as every other contact write, and
 * the flow itself is pure (contacts/run.ts).
 *
 * STRUCTURE ONLY: the session card's slug is the Move's `on`, the contact is
 * `run`, and the ONE `run` Change names the tool ROW's id, the ending and —
 * only for a completed run — the result's exact byte size. NOT ONE WORD of the
 * run rides here. A run that never started (no row, no sidecar) is not a Move
 * and appends nothing; the caller decides that before calling here.
 */
export function appendSessionRun(
  request: RunContactRequest,
): Promise<Prism> {
  return enqueue(async () => {
    const moved = await runRunContact(request, runContactDeps(request.workspacePath));
    return moved.prism;
  });
}

/**
 * STORY 19.4 — THE CURATOR'S EGRESS ABOUT A RUN IS ONE MOVE TOO (ADR-0037
 * decision 9, one family down): the manager model's distilling call is recorded
 * through the SAME run contact flow as the run it reads, with role "curator" —
 * no new family, no new Change shape and no word of anything. The caller forms
 * the outcome and the size from the curator call the way it forms the run's,
 * and only calls here when the request actually left the machine.
 */
export function appendSessionCurator(
  request: RunContactRequest,
): Promise<Prism> {
  return enqueue(async () => {
    const moved = await runRunContact(
      { ...request, role: "curator" },
      runContactDeps(request.workspacePath),
    );
    return moved.prism;
  });
}

/**
 * INTAKE one pasted response (Epic 12 story 3): wrap the text, append the ONE
 * PRISM with the answered Change, and hand the response back as CONTENT. It is
 * queued, so its append cannot interleave with another Move's.
 */
export function intakeAsk(
  ask: InFlightAsk,
  raw: string,
  attachment: AskAttachment | null,
): Promise<AskIntakeResult> {
  return enqueue(() =>
    intakeAskResponse(ask, raw, attachment, askContactDeps(ask.workspacePath)),
  );
}

/**
 * ABANDON one open Ask: append the ONE PRISM with no-response. The person
 * ends the question; the log says nothing came back.
 */
export function closeAsk(
  ask: InFlightAsk,
): Promise<AskAbandonResult> {
  return enqueue(() => abandonAsk(ask, askContactDeps(ask.workspacePath)));
}
