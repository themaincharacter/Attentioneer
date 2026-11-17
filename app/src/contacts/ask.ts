import { schemeAllowed } from "../lib/openerSchemes";
import { utf8ByteLength } from "../lib/textBytes";
import { pointerKey, type PointerForm } from "../map/pointers";
import {
  appendPrismLine,
  type AskChange,
  type DecodeStatus,
  type Prism,
} from "../map/prisms";
import {
  assembleAskPacket,
  type AskPacket,
  type AskPacketCard,
  type AskPacketReach,
} from "../turn/packet";
import type { TurnMessage } from "../turn/protocol";
import type { ProposalRead } from "../turn/turn";
import { resolveWithin, type Canonicalize } from "./boundary";
import {
  contactAdmitsChange,
  contactAllowsTarget,
  contactTargetRuleOf,
  findContact,
} from "./table";

/**
 * THE ASK PATH (Epic 12 story 3, ADR-0028 as amended; ADR-0029) — one question
 * out, one response back, and the keep kept separate.
 *
 * THE MOVE, IN THREE MOMENTS:
 *   1. SEND (egress) — the person's authored question leaves by the APP
 *      (through the sidecar turn, Epic 15 story 2) or, when no provider is
 *      configured, by COPY (the clipboard) or by OS HANDOFF.
 *      THE APP-SENT ROUTE NOW CARRIES THE PACKET (Epic 15 story 3, ADR-0029's
 *      amendment): the anchored card's name, state and bounded previews, the
 *      included reaches' citations and their bounded previews, a fixed
 *      instruction offering ONE named retrieval, and the bound said in words.
 *      The previews were read by the app BEFORE this call (turn/context.ts) and
 *      arrive as plain data, so this module still does no IO: it only hands the
 *      pure assembler (turn/packet.ts) what it was given. THE CLIPBOARD ROUTE
 *      IS UNCHANGED and still carries the question plus CITATIONS only — rule 3
 *      was never about privacy being weaker, it was about the app not composing
 *      from content it had not been given, and the clipboard still gets exactly
 *      the person's prose and the pointers' natural citations.
 *      The declaration of what will go (every block and its size, then the
 *      total) is shown by the panel BEFORE the person's press, derived from the
 *      SAME bytes the send carries. Nothing is appended by a question that
 *      never leaves: a question in flight is not a Move. An app-sent answer,
 *      when it comes back, is handed to the app's wiring, which runs the SAME
 *      intake below in the PRISM file's queue (one wrap, one PRISM).
 *   2. INTAKE — the response comes back by PASTE (the ghost intake's sibling):
 *      the app WRAPS the pasted text, declares its exact byte size and its
 *      decode status AT INTAKE (ADR-0029 rule 5: a lossy text is said, never
 *      hidden), and appends the ONE PRISM. The `ask` Change logs the pointer
 *      the Move rode (or null), the OUTCOME (answered), the INCLUSION SET (the
 *      natural keys of the reaches that rode, or null for none) and the
 *      response's size + decode — never a byte of the question or the
 *      response. The response itself is CONTENT: held by the caller, ephemeral.
 *   3. OR NOTHING CAME BACK — the person ends the Ask, and the same one PRISM
 *      is appended with no-response and null response facts (never a zero that
 *      would look like content).
 *
 * THE KEEP IS NOT HERE, BY CONSTRUCTION. Keeping what came back is the
 * existing FINDING move — the person writes the response into a reference's
 * memory (an ordinary map edit) or coins a word for it. It is a SEPARATE ACT
 * and it NEVER extends the PRISM: this module exports no keep function, holds
 * no state, and never writes a reference; the record was closed at intake.
 * (The record module's only edit, `rewritePrismExplanation`, touches the
 * person's explanation alone — never the Changes.)
 *
 * THE INCLUSION SET IS STRUCTURE, NOT CONTENT. It is logged as the pointers'
 * natural keys (on + form + value, the map's own citation vocabulary) and
 * never as sizes, bytes, digests or summaries of what the reaches hold. A
 * pointer's key inherits the pointer's own sensitivity — that is the design
 * (ADR-0028's natural-key amendment), not a leak.
 *
 * THE BOUNDARY: an attached file that rides the RESPONSE is a filesystem
 * reach, so the workspace-boundary rule applies at intake — a `path` is
 * joined to the workspace root and realpath'd; an escape refuses the intake
 * (nothing is logged; the person fixes the name). An `at` is the authored
 * machine-local exception (verbatim — it may dangle honestly) and a `url` is
 * not a file at all. The attachment is content-adjacent and NEVER logged: its
 * value is held with the response, ephemeral.
 *
 * PURE BY INJECTION, like the read and write paths: the clipboard, the OS
 * handoff, the canonicalizer, the PRISM file, the id minter and the clock of
 * the Move all arrive as deps. This module imports no Tauri runtime, holds no
 * session state and writes no file directly, so bun asserts the packet, the
 * inclusion keys, the size + decode, the boundary refusal and the one append
 * without a window, a clipboard or an OS opener.
 *
 * Provisional: the packet's wording and shape; the three transports and the
 * declaration's wording (Epic 15 story 2); the
 * decode-from-text rule (the pasted text is the only evidence the app has — a
 * U+FFFD in it is the honest sign something upstream replaced bytes); the
 * attachment field (a UI nicety, not a record field); the response being held
 * in the panel/window rather than in a module's memory.
 */

/**
 * How the question leaves the app, in the panel's order: the app itself (the
 * provider's turn), then the two visible fallbacks — the clipboard and the OS
 * handoff of the reach's url. The app-sent route is the default; the clipboard
 * is shown when no provider is configured (or the sidecar cannot start), never
 * silently (Epic 15 story 2).
 */
export const ASK_TRANSPORTS = ["app", "copy", "handoff"] as const;

/** A transport: the app's turn, the clipboard, or the OS handoff of a url. */
export type AskTransport = (typeof ASK_TRANSPORTS)[number];

/** One reach, as the person cites it (the pointer's authored form + value). */
export interface AskPointer {
  form: PointerForm;
  value: string;
}

/** One attached file the response brought (content-adjacent; never logged). */
export interface AskAttachment {
  form: PointerForm;
  value: string;
}

/**
 * THE DECLARATION (Epic 15 story 2): what the packet will carry, said BEFORE
 * anything leaves — the question's exact byte size, each included citation
 * with its own size, and the packet's total. It is derived from the SAME bytes
 * the send carries (`declareAsk` calls `askPacket`), so the line cannot drift
 * from the packet; it is a reading of structure, never a read of a target.
 * PROVISIONAL: the line's wording lives in the panel's rules.
 */
export interface AskDeclarationCitation {
  form: PointerForm;
  value: string;
  /** The citation line's exact UTF-8 byte size. */
  size: number;
}

export interface AskDeclaration {
  /** The person's question's exact byte size. */
  questionSize: number;
  /** The included citations, in the person's order (never their content). */
  citations: AskDeclarationCitation[];
  /** The whole packet's exact byte size (the bytes the transport carries). */
  packetSize: number;
}

/**
 * Declare one packet: the question's size, each included citation's size and
 * the packet's total. The packet is built by `askPacket` here, so this line is
 * the transport's own bytes — no second composition can disagree with it.
 */
export function declareAsk(
  question: string,
  included: readonly AskPointer[],
): AskDeclaration {
  return {
    questionSize: utf8ByteLength(question),
    citations: included.map((pointer) => ({
      form: pointer.form,
      value: pointer.value,
      size: utf8ByteLength("- " + pointer.form + " " + pointer.value),
    })),
    packetSize: utf8ByteLength(askPacket(question, included)),
  };
}

/** The table's refusal is the sentence the surface shows. */
export const REFUSED_TARGET = "this contact does not ride this reach.";

/** A contact whose table row does not ask cannot ask. */
export const NOT_AN_ASK_CONTACT = "this contact does not ask.";

/** An empty question is not a question: nothing leaves, nothing is appended. */
export const NO_QUESTION = "ask needs a question.";

/** The clipboard copy failed: the question never left, so it is not a Move. */
export const COPY_FAILED = "the question could not be copied, so nothing left.";

/**
 * The app-sent route is not wired (no provider bridge). This is the STATED
 * fallback, never a silent one: nothing left, so nothing is logged, and the
 * panel offers the clipboard.
 */
export const NO_APP_ROUTE =
  "no provider is configured, so the question goes by clipboard — use copy below.";

/** A handoff needs a url to hand off. */
export const HANDOFF_NEEDS_URL =
  "an OS handoff needs a url reach — copy is the other way out.";

/** The handoff's scheme is outside the capability's surfaces. */
export const HANDOFF_NEEDS_SCHEME =
  "the system opener cannot take this scheme.";

/** The question left by copy but the OS would not take the page (said, not logged). */
export const HANDOFF_FAILED_NOTE =
  "the OS did not take the page; the question is on the clipboard.";

/** An empty paste is not a response; nothing is logged and the ask stays open. */
export const EMPTY_RESPONSE = "nothing was pasted.";

/** The attached file realpaths outside the workspace root: the intake refuses. */
export const ATTACHMENT_REFUSED =
  "cannot reach — an attached file must be inside the workspace.";

/** The response's decode status, derived from the text the app holds (PROVISIONAL). */
export function askDecode(text: string): DecodeStatus {
  return text.includes("\uFFFD") ? "with-replacement" : "clean";
}

/**
 * WRAP the pasted text at intake: the text VERBATIM, its exact UTF-8 byte size
 * and its decode status. The app never edits, trims or normalizes a response —
 * the wrap is the declaration, not a transformation.
 */
export interface AskResponse {
  /** The pasted text, verbatim (content; held by the caller, ephemeral). */
  text: string;
  /** The text's exact byte size (a declared fact). */
  size: number;
  /** What the app can say about the bytes: clean, or with replacement. */
  decode: DecodeStatus;
}

export function wrapAskResponse(raw: string): AskResponse {
  return {
    text: raw,
    size: utf8ByteLength(raw),
    decode: askDecode(raw),
  };
}

/** The inclusion set's natural keys: deduped, in the person's order; null none. */
export function inclusionKeys(
  on: string,
  included: readonly AskPointer[],
): string[] | null {
  if (included.length === 0) return null;
  const keys: string[] = [];
  for (const pointer of included) {
    const key = pointerKey(on, pointer.form, pointer.value);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys.length === 0 ? null : keys;
}

/**
 * THE PACKET: the question VERBATIM, then the included reaches as citations
 * (form + value) — never their content (the app does not read them). With no
 * inclusion the packet is the question alone. Provisional wording.
 */
export function askPacket(
  question: string,
  included: readonly AskPointer[],
): string {
  if (included.length === 0) return question;
  const lines = included.map(
    (pointer) => "- " + pointer.form + " " + pointer.value,
  );
  return question + "\n\nincluded:\n" + lines.join("\n");
}

/**
 * What the app-sent route reports: one answer, the stated fallback (nothing
 * left) or one failed-turn sentence. The sender is injected so this flow never
 * imports Tauri, a sidecar or a provider row — the app wires the turn,
 * `turn/egress.ts` owns it, and bun asserts the route with a script.
 */
export type AskAppSend =
  | {
      kind: "answered";
      text: string;
      /** Every message that left, verbatim — the readback's own bytes. */
      messages: readonly TurnMessage[];
      /** The block the one follow-up fetched, or null. */
      read: string | null;
      /** A name the model asked for that the packet did not carry, or null. */
      missed: string | null;
      /** The proposal block the answer carried, read after it completed. */
      ghost?: ProposalRead;
    }
  | { kind: "unavailable"; sentence: string }
  | {
      kind: "failed";
      sentence: string;
      /** The messages that left before the failure (the readback's bytes). */
      messages?: readonly TurnMessage[];
    };

/** The Ask's bridge surface (injected; see the module doc). */
export interface AskContactDeps {
  /** Copy the packet to the clipboard; false when the copy failed. */
  copy: (text: string) => Promise<boolean>;
  /**
   * Send the assembled packet by the app's own turn (Epic 15 story 2/3). It
   * receives the PACKET, not a string: the turn needs its messages and the
   * names a single READ may retrieve, and the readback needs the same bytes.
   * Absent means the app-sent route is not wired: the send falls back, stated.
   */
  sendApp?: (packet: AskPacket) => Promise<AskAppSend>;
  /** Hand one url to the OS (the app passes the opener plugin's openUrl). */
  handOff: (url: string) => Promise<void>;
  /** The boundary's realpath (the app passes the Rust command's bridge). */
  canonicalize: Canonicalize;
  /** The PRISM file's existing bytes (null when it does not exist). */
  readPrismsText: () => Promise<string | null>;
  /** Write the PRISM file's exact bytes. */
  writePrismsText: (text: string) => Promise<void>;
  /** Mint the app-side PRISM id. */
  mintId: () => string;
}

/**
 * THE PREVIEWS the app read before an app-sent request (Epic 15 story 3): the
 * anchored card's block facts, each INCLUDED reach's bounded preview, and the
 * block names one follow-up may fetch. Plain data, read by turn/context.ts
 * outside this module — the contact path stays IO-free. Absent means the app
 * has no previews for this request: the packet then carries the card's slug and
 * the citations alone, and offers no retrieval (the clipboard route never
 * uses any of this).
 */
export interface AskPreviews {
  card: AskPacketCard;
  reaches: readonly AskPacketReach[];
  retrievable: readonly string[];
}

/** One Ask request: the anchor, what rides, the prose and the transport. */
export interface AskRequest {
  /** The anchor reference's slug (the word the Move is anchored on). */
  on: string;
  /** The contact (the table's ask row). */
  contact: "ask";
  /** The reach the question rides, or null for none. */
  pointer: AskPointer | null;
  /** The reaches whose reaches ride in the question (keys only are logged). */
  included: readonly AskPointer[];
  /** The person's authored question, VERBATIM. */
  question: string;
  /** How the question leaves the app. */
  transport: AskTransport;
  /** The workspace root an attached path resolves against. */
  workspacePath: string;
  /** The bounded previews for the app-sent packet, when the app read them. */
  previews?: AskPreviews;
}

/** What the app holds while the question is out: the Move is in flight. */
export interface InFlightAsk {
  /** The anchor reference's slug. */
  on: string;
  /** The workspace root the intake's attachment rule resolves against. */
  workspacePath: string;
  /** The reach the question rides, or null for none. */
  pointer: AskPointer | null;
  /** The inclusion set's natural keys, or null for none. */
  included: string[] | null;
  /** The person's authored question, verbatim (ephemeral). */
  question: string;
  /** The packet that left, verbatim (ephemeral; what the transport carried). */
  packet: string;
  /** How it left. */
  transport: AskTransport;
}

/** What sending did: the question is out, or it never left (no Move). */
export type AskSendResult =
  | { kind: "refused"; reason: string }
  | {
      /**
       * The stated fallback: nothing left, so nothing is logged. The panel says
       * the reason in one sentence and offers the clipboard path (Epic 15
       * story 2 — a fallback is not an Ask failure).
       */
      kind: "fallback";
      reason: string;
    }
  | {
      kind: "sent";
      ask: InFlightAsk;
      /** A quiet sentence for a transport that half-worked (else null). */
      note: string | null;
      /**
       * The app-sent answer — CONTENT, handed back to the app's wiring. It is
       * NOT logged here: the queued intake (`contacts/prismLog.ts`) wraps it
       * and appends the ONE PRISM with the same function a paste uses, so the
       * network wait never holds the PRISM file's write queue.
       */
      answer?: string;
      /** The wrap + PRISM the app's queued intake produced (with `answer`). */
      response?: AskResponse;
      prism?: Prism;
      /**
       * Every message the app sent, verbatim (the readback). Absent on the
       * clipboard routes, where the packet string is what the person copied.
       */
      sentMessages?: readonly TurnMessage[];
      /** The block the one follow-up fetched, or null (app route only). */
      read?: string | null;
      /** A name the model asked for that the packet did not carry, or null. */
      missed?: string | null;
      /**
       * The proposal block the answer carried (Epic 15 story 8), read after the
       * turn completed. A usable proposal is the ghost path's, not a PRISM's:
       * the app hands its body to the existing ghost intake and logs nothing.
       */
      ghost?: ProposalRead;
    };

/**
 * SEND one question out. The table answers first (fail-closed); the question
 * must have prose; a handoff needs a url inside the opener's surfaces.
 *
 * THE APP-SENT ROUTE (Epic 15 story 2): the packet goes to the injected sender
 * — ONE user message, the SAME bytes the clipboard would carry. Nothing is
 * written here: an answer is CONTENT handed back, and the app's queued intake
 * wraps it with the same function a paste uses. The network wait never holds
 * the PRISM file's write queue.
 *   - no provider (or no sidecar): the stated fallback, nothing logged;
 *   - a failed turn: the question is held in flight with one sentence, nothing
 *     logged here — the person pastes, or ends it, and exactly one PRISM lands.
 *
 * THE CLIPBOARD ROUTES: copy is the packet's carrier in both — a url handoff
 * carries no question on its own, so the packet is copied first and the url is
 * handed off after it. A failed copy means the question never left: not a Move.
 * A failed handoff leaves the question on the clipboard: the Move is live, and
 * the note says the OS would not take the page.
 */
export async function sendAsk(
  request: AskRequest,
  deps: AskContactDeps,
): Promise<AskSendResult> {
  const row = findContact(request.contact);
  if (row === null) return { kind: "refused", reason: NOT_AN_ASK_CONTACT };
  if (!contactAdmitsChange(row, "ask")) {
    return { kind: "refused", reason: NOT_AN_ASK_CONTACT };
  }
  if (request.pointer !== null) {
    const rule = contactTargetRuleOf(row, request.pointer.form);
    if (!contactAllowsTarget(row, request.pointer.form)) {
      return { kind: "refused", reason: rule?.refusal ?? REFUSED_TARGET };
    }
  }
  for (const pointer of request.included) {
    const rule = contactTargetRuleOf(row, pointer.form);
    if (!contactAllowsTarget(row, pointer.form)) {
      return { kind: "refused", reason: rule?.refusal ?? REFUSED_TARGET };
    }
  }
  if (request.question.trim() === "") {
    return { kind: "refused", reason: NO_QUESTION };
  }
  if (request.transport === "handoff") {
    if (request.pointer === null || request.pointer.form !== "url") {
      return { kind: "refused", reason: HANDOFF_NEEDS_URL };
    }
    if (!schemeAllowed(request.pointer.value)) {
      return { kind: "refused", reason: HANDOFF_NEEDS_SCHEME };
    }
  }

  // THE APP-SENT ROUTE composes through the new packet (story 3): the app
  // handed over the bounded previews it read, and this is the pure assembly of
  // them — no reader runs here. The CLIPBOARD ROUTES keep their own packet
  // (the question plus citations), unchanged.
  if (request.transport === "app") {
    const packet = assembleAskPacket(packetInputOf(request));
    const send = deps.sendApp;
    if (send === undefined) return { kind: "fallback", reason: NO_APP_ROUTE };
    let turned: AskAppSend;
    try {
      turned = await send(packet);
    } catch {
      return { kind: "fallback", reason: NO_APP_ROUTE };
    }
    if (turned.kind === "unavailable") {
      return { kind: "fallback", reason: turned.sentence };
    }
    const ask = inFlight(request, packet.text, "app");
    if (turned.kind === "failed") {
      // It may have left and produced no answer: one sentence, no record yet.
      // The panel keeps the question in flight so a paste can still log ONE.
      return {
        kind: "sent",
        ask,
        note: turned.sentence,
        sentMessages: turned.messages ?? packet.messages,
      };
    }
    // An answer is CONTENT handed back; the app's queued intake is the one
    // step that wraps it and appends the PRISM, so this route never writes.
    return {
      kind: "sent",
      ask,
      note: null,
      answer: turned.text,
      sentMessages: turned.messages,
      read: turned.read,
      missed: turned.missed,
      ghost: turned.ghost,
    };
  }

  const packet = askPacket(request.question, request.included);

  const copied = await deps.copy(packet);
  if (!copied) return { kind: "refused", reason: COPY_FAILED };

  let note: string | null = null;
  if (request.transport === "handoff" && request.pointer !== null) {
    try {
      await deps.handOff(request.pointer.value);
    } catch {
      note = HANDOFF_FAILED_NOTE;
    }
  }
  return {
    kind: "sent",
    ask: inFlight(request, packet, request.transport),
    note,
  };
}

/**
 * The app-sent packet's pure input. With previews (the panel's normal case) the
 * card's coined name, its state and the crops ride; without them — a caller
 * that read nothing — the card is named by its slug, the reaches ride as
 * citations only and no retrieval is offered. Nothing here reads.
 */
function packetInputOf(request: AskRequest): {
  question: string;
  card: AskPacketCard;
  reaches: readonly AskPacketReach[];
  retrievable: readonly string[];
} {
  const previews = request.previews;
  if (previews === undefined) {
    return {
      question: request.question,
      card: { name: request.on, state: null, reading: null, note: null },
      reaches: request.included.map((pointer) => ({
        form: pointer.form,
        value: pointer.value,
        preview: null,
      })),
      retrievable: [],
    };
  }
  return {
    question: request.question,
    card: previews.card,
    reaches: previews.reaches,
    retrievable: previews.retrievable,
  };
}

/** The in-flight Ask for one sent packet (the Move's ephemeral half). */
function inFlight(
  request: AskRequest,
  packet: string,
  transport: AskTransport,
): InFlightAsk {
  return {
    on: request.on,
    workspacePath: request.workspacePath,
    pointer: request.pointer,
    included: inclusionKeys(request.on, request.included),
    question: request.question,
    packet,
    transport,
  };
}

/** What intake/abandon did: the ONE PRISM appended, or a refusal (no Move). */
export type AskIntakeResult =
  | { kind: "refused"; reason: string }
  | {
      kind: "moved";
      prism: Prism;
      /** The wrapped response — CONTENT, held by the caller (ephemeral). */
      response: AskResponse;
      /** The attached file the response brought, when one did (never logged). */
      attachment: AskAttachment | null;
    };

export type AskAbandonResult =
  | { kind: "refused"; reason: string }
  | { kind: "moved"; prism: Prism };

/** The one Change an Ask logs, built from the in-flight question. */
function askChange(ask: InFlightAsk): AskChange {
  return {
    kind: "ask",
    pointer:
      ask.pointer === null
        ? null
        : pointerKey(ask.on, ask.pointer.form, ask.pointer.value),
    outcome: "no-response",
    included: ask.included,
    responseSize: null,
    decode: null,
  };
}

/** The one PRISM append (a Move's whole record). */
async function commitAsk(
  ask: InFlightAsk,
  change: AskChange,
  deps: AskContactDeps,
): Promise<Prism> {
  const prism: Prism = {
    id: deps.mintId(),
    on: ask.on,
    contact: "ask",
    pointer: ask.pointer,
    changes: [change],
    explanation: "",
    extra: {},
  };
  const before = await deps.readPrismsText();
  await deps.writePrismsText(appendPrismLine(before, prism));
  return prism;
}

/**
 * INTAKE one pasted response: check the attached file through the boundary
 * layer, WRAP the text (size + decode at intake), append the ONE PRISM with
 * the answered `ask` Change, and hand the response back as CONTENT for the
 * caller to hold. The response never enters the log, and this module never
 * writes it anywhere.
 */
export async function intakeAskResponse(
  ask: InFlightAsk,
  raw: string,
  attachment: AskAttachment | null,
  deps: AskContactDeps,
): Promise<AskIntakeResult> {
  if (raw === "") return { kind: "refused", reason: EMPTY_RESPONSE };

  if (attachment !== null && attachment.form === "path") {
    const resolved = await resolveWithin(
      ask.workspacePath,
      attachment.value,
      deps.canonicalize,
    );
    if (resolved.outcome !== "resolved") {
      return { kind: "refused", reason: ATTACHMENT_REFUSED };
    }
  }

  const response = wrapAskResponse(raw);
  const change: AskChange = {
    ...askChange(ask),
    outcome: "answered",
    responseSize: response.size,
    decode: response.decode,
  };
  const prism = await commitAsk(ask, change, deps);
  return { kind: "moved", prism, response, attachment };
}

/**
 * ABANDON one open Ask: nothing came back, and the person ends it. The SAME
 * one PRISM is appended with no-response and no response facts — the honest
 * close of a question that left. (Closing the app instead appends nothing: an
 * unfinished Move has no record.)
 */
export async function abandonAsk(
  ask: InFlightAsk,
  deps: AskContactDeps,
): Promise<AskAbandonResult> {
  const prism = await commitAsk(ask, askChange(ask), deps);
  return { kind: "moved", prism };
}
