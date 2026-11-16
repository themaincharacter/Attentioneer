import type { HeadRefusal, TextHead } from "../lib/fs";
import { HEAD_MAX_BYTES, HEAD_MAX_LINES } from "../lib/headBounds";
import { pointerKey, type PointerForm } from "../map/pointers";
import {
  appendPrismLine,
  type DecodeStatus,
  type HeadBounds,
  type Prism,
  type ReadHeadChange,
  type ReadHeadOutcome,
} from "../map/prisms";
import { resolveWithin, type Canonicalize } from "./boundary";
import {
  contactAdmitsChange,
  contactAllowsTarget,
  contactTargetRuleOf,
  findContact,
} from "./table";

/**
 * THE READ PATH (Epic 12 story 2, ADR-0028 as amended; ADR-0029) — Look and
 * Measure performed as ONE contact Move each, through the boundary layer.
 *
 * A Move is ONE bounded verb made of Changes. Look and Measure are the read
 * contacts: both emit the SAME closed kind, read-head, and the verb lives on
 * the PRISM's header (contact), never in a second Change kind (ADR-0028's
 * "Measure emits read-head"). One Move means one appended PRISM.
 *
 * WHAT IS SAID, EXACTLY:
 * - The bounds asked for are logged verbatim (maxLines / maxBytes), whatever
 *   the outcome (a silent truncation is a silent transformation).
 * - The decode status the bridge declared is logged verbatim (clean /
 *   with-replacement); a refusal decoded nothing, so it logs null.
 * - A refusal is a TYPED outcome: not-text (a NUL byte — a binary refuses),
 *   escaped (the boundary layer refused a path that realpaths outside the
 *   workspace root), cannot-reach (no regular file, a dangling target, or a
 *   canonicalization that cannot answer). The bridge's io code (an OS error)
 *   is logged as cannot-reach — the read-head union is CLOSED and has no io
 *   word; the app's inability to reach the bytes is the honest sentence
 *   (PROVISIONAL mapping).
 * - A MEASURE also logs the head's DECLARED facts — the size and mtime the
 *   filesystem declared — pasted into the bounds object verbatim. Nothing is
 *   computed, counted, summed, averaged or rounded (the Real-number line).
 *
 * THE BOUNDARY: this is the ONE JS layer (ADR-0029 rule 1). A path is joined
 * to the workspace root as written and realpath'd; an escape is refused
 * BEFORE the bridge is called. An at is the authored machine-local exception
 * and is passed verbatim (it dangles honestly elsewhere); the Rust bridge
 * below is UNSCOPED by design and the named debt. A url is not a head read at
 * all: Look's egress is the open-os Change and belongs to the egress story, so
 * this read path refuses it (it never claims a read it did not make).
 *
 * PURE BY INJECTION: every bridge (canonicalize, read, read/write the PRISM
 * file, mint the id) arrives as a dep, exactly as the boundary resolver's
 * canonicalizer does. The module imports no Tauri runtime and does no direct
 * filesystem I/O, so bun asserts the whole read path — bounds, decode,
 * refusals, facts, the one append — without a window. The app's wiring lives
 * beside it in prismLog.ts.
 *
 * NO CONTENT: the head's bytes are read (bounded) only to learn the decode
 * status and the declared facts; they are never returned to the caller, never
 * stored and never written. The PRISM is structural facts only.
 *
 * Provisional: the request/result shape, the refusal wordings, the io to
 * cannot-reach mapping, and Measure's facts-in-bounds placement.
 */

/** The two read contacts (Look and Measure), in table order. */
export const READ_CONTACT_KINDS = ["look", "measure"] as const;

/** A read contact kind. */
export type ReadContactKind = (typeof READ_CONTACT_KINDS)[number];

/** The read path's bridge surface (injected; see the module doc). */
export interface ReadContactDeps {
  /** The boundary's realpath (the app passes the Rust command's bridge). */
  canonicalize: Canonicalize;
  /** One bounded head read (the app passes readTextHead). */
  readHead: (
    path: string,
    maxLines: number,
    maxBytes: number,
  ) => Promise<TextHead>;
  /** The PRISM file's existing bytes (null when it does not exist). */
  readPrismsText: () => Promise<string | null>;
  /** Write the PRISM file's exact bytes. */
  writePrismsText: (text: string) => Promise<void>;
  /** Mint the app-side PRISM id. */
  mintId: () => string;
}

/** One Look/Measure request: the anchor, the pointer line and its root. */
export interface ReadContactRequest {
  /** The anchor reference's slug (the word the Move is anchored on). */
  on: string;
  /** The read contact this Move performs. */
  contact: ReadContactKind;
  /** The pointer line's authored form. */
  form: PointerForm;
  /** The pointer line's verbatim value. */
  value: string;
  /** The workspace root a path resolves against, exactly as written. */
  workspacePath: string;
  /** The exact bounds to ask and log; the window's caps by default. */
  bounds?: HeadBounds;
}

/** What a read Move did: it moved (one PRISM appended), or it was refused. */
export type ReadContactResult =
  | {
      /** The contact table refused the Move: no Move, so no PRISM. */
      kind: "refused";
      /** The table's own sentence (never a bare refusal). */
      reason: string;
    }
  | { kind: "moved"; prism: Prism };

/** A url's Look is an egress Change (open-os), not a head read. */
export const NO_HEAD_READ =
  "a url is not a head read — the OS handoff is its own contact.";

/** A contact whose table row carries no read-head shape cannot read. */
export const NOT_A_READ_CONTACT = "this contact does not read a head.";

/** A missing target rule is a refusal, never a permission (the table's rule). */
export const REFUSED_TARGET = "this contact does not ride this reach.";

/** The exact caps to ask and log (never the caller's declared facts). */
export function readBoundsOf(bounds?: HeadBounds): HeadBounds {
  return {
    maxLines: bounds?.maxLines ?? HEAD_MAX_LINES,
    maxBytes: bounds?.maxBytes ?? HEAD_MAX_BYTES,
  };
}

/**
 * Map a typed head refusal to the CLOSED read-head outcome vocabulary. The
 * union has no io: an OS error means the app could not reach the bytes, so it
 * is logged as cannot-reach — never guessed into another word. A rejection
 * that is not a typed refusal is fail-closed the same way.
 */
export function refusalOutcome(error: unknown): ReadHeadOutcome {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as HeadRefusal).code
      : null;
  switch (code) {
    case "not-text":
      return "not-text";
    case "escaped":
      return "escaped";
    default:
      return "cannot-reach";
  }
}

/**
 * Perform ONE read Move: resolve through the boundary, read one bounded head,
 * and append exactly ONE PRISM carrying the read-head Change. The contact
 * table answers first (fail-closed): a target kind the row refuses, or a
 * contact whose row emits no read-head, is not a Move — nothing is read and
 * nothing is appended.
 */
export async function runReadContact(
  request: ReadContactRequest,
  deps: ReadContactDeps,
): Promise<ReadContactResult> {
  const row = findContact(request.contact);
  const rule = row === null ? null : contactTargetRuleOf(row, request.form);
  if (row === null || !contactAllowsTarget(row, request.form)) {
    return { kind: "refused", reason: rule?.refusal ?? REFUSED_TARGET };
  }
  if (!contactAdmitsChange(row, "read-head")) {
    return { kind: "refused", reason: NOT_A_READ_CONTACT };
  }
  if (request.form === "url") {
    return { kind: "refused", reason: NO_HEAD_READ };
  }

  const caps = readBoundsOf(request.bounds);
  const citation = pointerKey(request.on, request.form, request.value);

  // THE BOUNDARY: realpath after join, escapes refused before the read. An
  // at target never enters the resolver (the authored machine-local exception).
  let readPath: string;
  if (request.form === "path") {
    const resolved = await resolveWithin(
      request.workspacePath,
      request.value,
      deps.canonicalize,
    );
    if (resolved.outcome !== "resolved") {
      return commitRead(
        deps,
        request,
        citation,
        caps,
        resolved.outcome,
        null,
        null,
      );
    }
    readPath = resolved.path;
  } else {
    readPath = request.value;
  }

  let head: TextHead | null = null;
  let outcome: ReadHeadOutcome;
  let decode: DecodeStatus | null = null;
  try {
    head = await deps.readHead(readPath, caps.maxLines, caps.maxBytes);
    if (head.exists) {
      outcome = "read";
      decode = head.decode;
    } else {
      // A dangling target is a legitimate, said outcome.
      outcome = "cannot-reach";
    }
  } catch (error) {
    outcome = refusalOutcome(error);
  }

  // MEASURE's declared facts: pasted from the head read, never derived. A
  // refusal declared no head, so it carries no facts (the bounds stay caps).
  const facts =
    request.contact === "measure" && outcome === "read" && head !== null
      ? { size: head.size, mtime: head.mtime }
      : null;
  return commitRead(deps, request, citation, caps, outcome, decode, facts);
}

/** Build the one change, append the one PRISM, and answer the Move. */
async function commitRead(
  deps: ReadContactDeps,
  request: ReadContactRequest,
  citation: string,
  caps: HeadBounds,
  outcome: ReadHeadOutcome,
  decode: DecodeStatus | null,
  facts: { size: number | null; mtime: number | null } | null,
): Promise<ReadContactResult> {
  const bounds: HeadBounds =
    facts === null ? caps : { ...caps, size: facts.size, mtime: facts.mtime };
  const change: ReadHeadChange = {
    kind: "read-head",
    pointer: citation,
    outcome,
    bounds,
    decode,
  };
  const prism: Prism = {
    id: deps.mintId(),
    on: request.on,
    contact: request.contact,
    pointer: { form: request.form, value: request.value },
    changes: [change],
    explanation: "",
    extra: {},
  };
  const before = await deps.readPrismsText();
  await deps.writePrismsText(appendPrismLine(before, prism));
  return { kind: "moved", prism };
}
