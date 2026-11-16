import { schemeAllowed } from "../lib/openerSchemes";
import { pointerKey, type PointerForm } from "../map/pointers";
import {
  appendPrismLine,
  type ContactKind,
  type OpenOsChange,
  type OpenOsOutcome,
  type Prism,
} from "../map/prisms";
import {
  contactAdmitsChange,
  contactAllowsTarget,
  contactTargetRuleOf,
  findContact,
} from "./table";

/**
 * THE EGRESS PATH (Epic 12 story 3, ADR-0028 as amended; ADR-0029) — the OS
 * HANDOFF as ONE contact Move: a reach LEAVES the app, and the PRISM says
 * exactly that much.
 *
 * THE WORD IS THE POINT. The app does not know what the OS did with the
 * address; it only knows that it handed it over. So the closed outcome
 * vocabulary is handed / handoff-failed / refused, and the log NEVER says
 * "opened" — a claim the app cannot make. The three outcomes:
 *   - `handed`         — the opener plugin accepted the call (the handoff).
 *   - `handoff-failed` — the call rejected (no xdg-open on this box, no
 *                        handler, the OS said no).
 *   - `refused`        — the app refused to hand it over at all: the url's
 *                        scheme is outside the capability's four surfaces, so
 *                        the Move is attempted and the app declines. This is
 *                        still a Move — the person pressed the gesture and the
 *                        log is the truth — so exactly one PRISM is appended.
 *
 * A TABLE REFUSAL IS NOT A MOVE: a contact whose row does not emit open-os,
 * or a form the row refuses, reads its own sentence and appends nothing.
 *
 * WHAT MAY GO OUT (PROVISIONAL DECISION): a `url` ONLY. The ADR's Look shape
 * names the url handoff as the egress, and a local file's outward open is the
 * window's own action (Epic 5 story 2, no record) — a different, older door.
 * Keeping open-os url-only means the contact layer never has to join a
 * workspace path for an egress, and the app never turns a local open into a
 * PRISM it did not promise. A `path`/`at` reach therefore refuses here as
 * "not a Move" — the window's ↗ is its door — and an unsupported SCHEME is the
 * one logged refusal below.
 *
 * THE BOUNDARY: nothing here reads the world, so the boundary layer is not in
 * this flow. The url is passed VERBATIM (World B); the scheme guard is the
 * capability's own admitted surfaces, read from the lib (one vocabulary with
 * the outward window).
 *
 * PURE BY INJECTION: the handoff call, the PRISM file and the id minter arrive
 * as deps — the app wires the plugin through one function (never a Rust-side
 * bypass: the plugin's Rust methods skip the capability scope). Bun asserts
 * every outcome without a window and without an OS opener.
 *
 * Provisional: the url-only rule, the refusal sentence, and the placement of
 * the whole thing in `contacts/egress.ts`.
 */

/** A contact whose table row does not hand off cannot egress. */
export const NOT_AN_EGRESS_CONTACT = "this contact does not hand off.";

/** The table's own refusal, when a form is outside the row. */
export const REFUSED_TARGET = "this contact does not ride this reach.";

/** The egress is a url's Move; a local file's open is the window's own. */
export const EGRESS_IS_URL_ONLY =
  "the OS handoff is a url's egress — a local file opens in its own window.";

/** The handoff bridge surface (injected; see the module doc). */
export interface EgressContactDeps {
  /** Hand one url to the OS (the app passes the opener plugin's openUrl). */
  handOff: (url: string) => Promise<void>;
  /** The PRISM file's existing bytes (null when it does not exist). */
  readPrismsText: () => Promise<string | null>;
  /** Write the PRISM file's exact bytes. */
  writePrismsText: (text: string) => Promise<void>;
  /** Mint the app-side PRISM id. */
  mintId: () => string;
}

/** One egress request: the anchor, the contact, and the reach that leaves. */
export interface EgressContactRequest {
  /** The anchor reference's slug (the word the Move is anchored on). */
  on: string;
  /** The contact performing the egress (its table row must emit open-os). */
  contact: ContactKind;
  /** The reach's authored form. */
  form: PointerForm;
  /** The reach's verbatim value (a url, for this Move). */
  value: string;
  /**
   * The workspace root whose `map/prisms.jsonl` records the Move. The flow
   * itself resolves nothing — an egress leaves the machine, it does not reach
   * into it — so the boundary layer is deliberately absent here.
   */
  workspacePath: string;
}

/** What an egress Move did: it moved (one PRISM appended), or was refused. */
export type EgressContactResult =
  | { kind: "refused"; reason: string }
  | { kind: "moved"; prism: Prism };

/**
 * Perform ONE egress Move: answer the table, guard the scheme, attempt the
 * handoff, and append exactly ONE PRISM with the outcome the app can honestly
 * claim. The log's pointer is the reach's natural key.
 */
export async function runEgressContact(
  request: EgressContactRequest,
  deps: EgressContactDeps,
): Promise<EgressContactResult> {
  const row = findContact(request.contact);
  const rule = row === null ? null : contactTargetRuleOf(row, request.form);
  if (row === null || !contactAllowsTarget(row, request.form)) {
    return { kind: "refused", reason: rule?.refusal ?? REFUSED_TARGET };
  }
  if (!contactAdmitsChange(row, "open-os")) {
    return { kind: "refused", reason: NOT_AN_EGRESS_CONTACT };
  }
  // The url-only rule (PROVISIONAL): a local reach is the window's open.
  if (request.form !== "url") {
    return { kind: "refused", reason: EGRESS_IS_URL_ONLY };
  }

  const citation = pointerKey(request.on, "url", request.value);
  let outcome: OpenOsOutcome;
  if (!schemeAllowed(request.value)) {
    // The capability would refuse the call; the app refuses first and says so.
    outcome = "refused";
  } else {
    try {
      await deps.handOff(request.value);
      outcome = "handed";
    } catch {
      outcome = "handoff-failed";
    }
  }

  const change: OpenOsChange = {
    kind: "open-os",
    pointer: citation,
    outcome,
  };
  const prism: Prism = {
    id: deps.mintId(),
    on: request.on,
    contact: request.contact,
    pointer: { form: "url", value: request.value },
    changes: [change],
    explanation: "",
    extra: {},
  };
  const before = await deps.readPrismsText();
  await deps.writePrismsText(appendPrismLine(before, prism));
  return { kind: "moved", prism };
}
