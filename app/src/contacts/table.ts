import { isContactKind, type ChangeKind, type ContactKind } from "../map/prisms";
import { POINTER_FORMS, type PointerForm } from "../map/pointers";

/**
 * THE CONTACT TABLE (Epic 12 story 1, ADR-0028 decision 1) — one row per
 * world-contact verb, BESIDE the ghost registry and deliberately apart from it.
 *
 * The two vocabularies are different: a ghost row is a MAP-EDIT verb (the
 * agent's channel, gated, admitted to the registry only through the expansion
 * protocol), while a contact row is a WORLD-CONTACT verb the PERSON initiates.
 * Keeping them in separate tables is what keeps them from mixing: the ghost
 * registry's expansion gate stays scoped to map-edit verbs, and the card's
 * moves line derives from ghost rows only, so contacts are never advertised to
 * agents in v1. The ghost registry is NOT imported or amended here; the card
 * layer is source-scanned to prove it never reads this table (a source-scan
 * test holds that seam).
 *
 * THE ACTOR IS DATA, not a rendering of the app's intent. Every row says
 * `actor: "person"` in its own bytes; nothing derives an actor from a
 * registry lookup or from the row's position. A future agent-proposed contact
 * would be a GHOST carrying a Make (ADR-0028's consequences), never a new
 * actor value here.
 *
 * A ROW: `{contact, actor, targets, changes}`.
 *   - `targets` — every target kind the contact knows (the three authored
 *     pointer forms plus `none`), each allowed or REFUSED with the person's
 *     reason. Fail-closed by shape: a refused kind carries a sentence; an
 *     allowed one carries none. The table is DATA the contact layer asks, so a
 *     second rule is a second row field, not a branch inside a flow.
 *   - `changes` — the Change shapes (the closed union's kinds) the contact may
 *     emit, as data. A Move's log is checked against its contact's list.
 *
 * The four shapes (ADR-0028 decision 3):
 *   - look    — a head read on `path`/`at`, or the OS handed a `url`
 *               (open-os). The bound is SAID; a dangling target is honest.
 *   - make    — one artifact INSIDE the workspace (`path` form): the Move
 *               mints the artifact's pointer and writes raw UTF-8 text.
 *   - measure — the head's declared facts only (no computed number, no URL).
 *   - ask     — one question out; may ride a pointer or none. The inclusion set
 *               is logged, never bytes.
 *
 * Provisional: the module's location (`contacts/` rather than inside `ghost/`),
 * the row's field names, the refusal sentences' wording, and the target-kind
 * vocabulary (`path`/`at`/`url`/`none`).
 */

/** The one actor a contact has in v1: the person. */
export const CONTACT_ACTOR = "person" as const;

/** The target kinds a contact row rules on (the pointer forms plus none). */
export type ContactTargetKind = PointerForm | "none";

/** Every target kind, in table order. */
export const CONTACT_TARGET_KINDS: readonly ContactTargetKind[] = [
  ...POINTER_FORMS,
  "none",
];

/** One target kind's rule: allowed, or refused with the person's reason. */
export interface ContactTargetRule {
  /** The target kind this rule is about. */
  kind: ContactTargetKind;
  /** May the contact act on this target kind? */
  allowed: boolean;
  /** Why it is refused — present exactly when `allowed` is false. */
  refusal?: string;
}

/** One contact row (the table is data the contact layer reads). */
export interface ContactDefinition {
  /** The world-contact verb. */
  contact: ContactKind;
  /** Who initiates it — the person, always (v1). */
  actor: typeof CONTACT_ACTOR;
  /** Every target kind the contact knows, allowed or refused. */
  targets: readonly ContactTargetRule[];
  /** The Change kinds the contact may emit, in the Move's order. */
  changes: readonly ChangeKind[];
}

/** The table, in the four contacts' order. */
export const CONTACTS: readonly ContactDefinition[] = [
  {
    contact: "look",
    actor: CONTACT_ACTOR,
    targets: [
      { kind: "path", allowed: true },
      { kind: "at", allowed: true },
      { kind: "url", allowed: true },
      {
        kind: "none",
        allowed: false,
        refusal: "Look needs a reach to read or hand off.",
      },
    ],
    changes: ["read-head", "open-os"],
  },
  {
    contact: "make",
    actor: CONTACT_ACTOR,
    targets: [
      { kind: "path", allowed: true },
      {
        kind: "at",
        allowed: false,
        refusal: "Make writes its artifact inside the workspace.",
      },
      {
        kind: "url",
        allowed: false,
        refusal: "an artifact is a file, not a URL.",
      },
      {
        kind: "none",
        allowed: false,
        refusal: "Make mints the artifact's pointer, so it needs a form.",
      },
    ],
    changes: ["mint-pointer", "write-text"],
  },
  {
    contact: "measure",
    actor: CONTACT_ACTOR,
    targets: [
      { kind: "path", allowed: true },
      { kind: "at", allowed: true },
      {
        kind: "url",
        allowed: false,
        refusal: "a URL declares no local facts to measure.",
      },
      {
        kind: "none",
        allowed: false,
        refusal: "Measure reads a reach's declared facts.",
      },
    ],
    changes: ["read-head"],
  },
  {
    contact: "ask",
    actor: CONTACT_ACTOR,
    targets: [
      { kind: "path", allowed: true },
      { kind: "at", allowed: true },
      { kind: "url", allowed: true },
      { kind: "none", allowed: true },
    ],
    changes: ["ask"],
  },
];

/** The row for one contact, or null (a value the table does not carry). */
export function findContact(value: unknown): ContactDefinition | null {
  if (!isContactKind(value)) return null;
  return CONTACTS.find((entry) => entry.contact === value) ?? null;
}

/** The row's rule for one target kind, or null (the table is fail-closed). */
export function contactTargetRuleOf(
  entry: ContactDefinition,
  kind: ContactTargetKind,
): ContactTargetRule | null {
  return entry.targets.find((rule) => rule.kind === kind) ?? null;
}

/** May this contact act on this target kind? A missing rule is a refusal. */
export function contactAllowsTarget(
  entry: ContactDefinition,
  kind: ContactTargetKind,
): boolean {
  return contactTargetRuleOf(entry, kind)?.allowed === true;
}

/**
 * Does this contact's table row admit a Change kind? The closed union's kinds
 * are the vocabulary; a kind the row does not list is not this contact's.
 */
export function contactAdmitsChange(
  entry: ContactDefinition,
  kind: ChangeKind,
): boolean {
  return entry.changes.includes(kind);
}
