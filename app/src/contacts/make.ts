import { utf8ByteLength } from "../lib/textBytes";
import {
  addPointer,
  parsePointers,
  pointerKey,
  serializePointers,
  type PointerForm,
} from "../map/pointers";
import {
  appendPrismLine,
  type MintPointerChange,
  type Prism,
  type WriteTextChange,
} from "../map/prisms";
import { resolveWithin, type Canonicalize } from "./boundary";
import {
  contactAdmitsChange,
  contactAllowsTarget,
  contactTargetRuleOf,
  findContact,
} from "./table";

/**
 * THE WRITE PATH (Epic 12 story 3, ADR-0028 as amended; ADR-0029) — Make
 * performed as ONE contact Move: the artifact gets a pointer record and its
 * text is written, in one Move, with one appended PRISM.
 *
 * THE MOVE IS TWO CHANGES, IN THIS ORDER:
 *   1. `mint-pointer` — the artifact needs a REACH, and a verbatim path is
 *      never written into the map, so the Move mints the pointer: one line in
 *      `map/pointers.jsonl`, canonical, keyed on + form + value. The person
 *      NAMES the artifact (the authored `path` value); the mint's `target` in
 *      the log IS that pointer's natural key — the same citation the PRISM's
 *      header carries.
 *   2. `write-text` — the authored text goes to that reach's file through the
 *      RAW writer (`write_text_file`), VERBATIM: no trimming, no normalization,
 *      no added newline, no canonicalization. This is the named exception to
 *      the machine door (ADR-0029 rule 5): the map's own records serialize
 *      canonically, an artifact is the person's bytes. The Change logs the
 *      text's own byte size (a declared fact) and whether the write landed.
 *
 * THE PARTIAL LOG IS THE TRUTH. The record that matters can fail after the
 * first Change landed, so the PRISM is appended LAST, after both attempts, and
 * it says exactly what happened:
 *   - a write failure logs BOTH Changes — minted, then failed (the pointer line
 *     exists and the artifact does not: a minted-but-unwritten pointer dangles,
 *     and the log says so rather than hiding the half-move);
 *   - a mint failure logs the mint-pointer Change alone, failed, and does NOT
 *     write the artifact: a file with no reach is not this Move, and claiming a
 *     write that was never attempted would be the lie the log exists to
 *     prevent.
 * A boundary refusal (the named path realpaths outside the workspace root) is
 * NOT a Move: nothing is minted, nothing is written, nothing is appended — the
 * person fixes the name.
 *
 * NO ACCEPT GATE — BY DESIGN. The PERSON is the acceptor of their own contact
 * write (ADR-0028 decision 1: a contact is a person-initiated Move). There is
 * no proposal, no pending state, no approval step between the gesture and the
 * record; this flow appends the PRISM in the same call. An AGENT'S Make is a
 * GHOST — the ghost registry's channel, a map-edit proposal carrying a write —
 * never a contact Move: this module imports no ghost machinery and never reads
 * the ghost registry. The person's act is the gate.
 *
 * PURE BY INJECTION, exactly like the read path: the canonicalizer, the
 * pointers file, the artifact writer, the PRISM file and the id minter all
 * arrive as deps. The module imports no Tauri runtime and does no filesystem
 * I/O, so bun asserts the whole Move — the mint, the raw bytes, the partial on
 * failure, the one append — without a window.
 *
 * Provisional: the artifact is a `path` only (the table's rule); the mint's
 * idempotence on an already-written reach (a byte-exact re-statement writes
 * nothing and still logs "minted", since the reach exists); the refusal
 * sentences; the write's size as the authored text's UTF-8 bytes.
 */

/** The minted artifact's form (the table allows only a workspace `path`). */
export const MAKE_FORM = "path" as const;

/** The table's refusal is the sentence the surface shows. */
export const REFUSED_TARGET = "this contact does not ride this reach.";

/** A contact whose table row does not mint + write cannot make. */
export const NOT_A_MAKE_CONTACT = "this contact does not mint and write.";

/** The minted path realpaths outside the workspace root: no Move is made. */
export const REFUSED_REACH =
  "cannot reach — the artifact must be written inside the workspace.";

/** A blank name is not an artifact: nothing is minted, written or appended. */
export const REFUSED_NAME = "name the artifact first";

/** The Make path's bridge surface (injected; see the module doc). */
export interface MakeContactDeps {
  /** The boundary's realpath (the app passes the Rust command's bridge). */
  canonicalize: Canonicalize;
  /** The pointers file's existing bytes (null when it does not exist). */
  readPointersText: () => Promise<string | null>;
  /** Write the pointers file's exact bytes (the canonical record door). */
  writePointersText: (text: string) => Promise<void>;
  /** Write the artifact's RAW bytes (the app passes writeTextFile). */
  writeArtifact: (path: string, text: string) => Promise<void>;
  /** The PRISM file's existing bytes (null when it does not exist). */
  readPrismsText: () => Promise<string | null>;
  /** Write the PRISM file's exact bytes. */
  writePrismsText: (text: string) => Promise<void>;
  /** Mint the app-side PRISM id. */
  mintId: () => string;
}

/** One Make request: the anchor, the named artifact and the authored text. */
export interface MakeContactRequest {
  /** The anchor reference's slug (the word the Move is anchored on). */
  on: string;
  /** The authored form of the artifact's reach (the table allows `path`). */
  form: PointerForm;
  /** The artifact's workspace-relative path, VERBATIM as the person wrote it. */
  value: string;
  /** The text to write, VERBATIM (raw UTF-8; never canonicalized). */
  text: string;
  /** The workspace root a path resolves against, exactly as written. */
  workspacePath: string;
}

/** What a Make Move did: it moved (one PRISM appended), or it was refused. */
export type MakeContactResult =
  | {
      /** The contact table refused the Move: no mint, no write, no PRISM. */
      kind: "refused";
      /** The table's own sentence (never a bare refusal). */
      reason: string;
    }
  | { kind: "moved"; prism: Prism };

/**
 * Perform ONE Make Move: mint the artifact's pointer, write the raw text, then
 * append exactly ONE PRISM carrying both Changes (or the mint's failure).
 * The contact table answers first (fail-closed): a form the row refuses, or a
 * contact whose row emits no mint/write, is not this Move.
 */
export async function runMakeContact(
  request: MakeContactRequest,
  deps: MakeContactDeps,
): Promise<MakeContactResult> {
  const row = findContact("make");
  const rule = row === null ? null : contactTargetRuleOf(row, request.form);
  if (row === null || !contactAllowsTarget(row, request.form)) {
    return { kind: "refused", reason: rule?.refusal ?? REFUSED_TARGET };
  }
  if (
    !contactAdmitsChange(row, "mint-pointer") ||
    !contactAdmitsChange(row, "write-text")
  ) {
    return { kind: "refused", reason: NOT_A_MAKE_CONTACT };
  }
  // The table allows only the workspace `path`; the shape is checked here too
  // so a future row cannot quietly widen it into a write with no reach.
  if (request.form !== MAKE_FORM) {
    return { kind: "refused", reason: REFUSED_TARGET };
  }
  // A blank name is not an artifact (fail-closed: the pointer record would
  // refuse it anyway, and a write to the workspace root is not this Move).
  if (request.value.trim() === "") {
    return { kind: "refused", reason: REFUSED_NAME };
  }

  // THE BOUNDARY: realpath after join, an escape refused BEFORE anything is
  // minted or written (the one JS layer, ADR-0029 rule 1).
  const resolved = await resolveWithin(
    request.workspacePath,
    request.value,
    deps.canonicalize,
  );
  if (resolved.outcome !== "resolved") {
    return { kind: "refused", reason: REFUSED_REACH };
  }

  const citation = pointerKey(request.on, MAKE_FORM, request.value);
  const head: Omit<Prism, "id" | "changes"> = {
    on: request.on,
    contact: "make",
    pointer: { form: MAKE_FORM, value: request.value },
    explanation: "",
    extra: {},
  };

  // 1. MINT — the map's canonical pointer record. A byte-exact re-statement of
  // an existing reach writes nothing (one line per natural key); the reach
  // exists either way, so the Change says minted.
  const mintChange: MintPointerChange = {
    kind: "mint-pointer",
    target: citation,
    outcome: "minted",
  };
  try {
    const before = await deps.readPointersText();
    const parsed = parsePointers(before ?? "");
    const next = addPointer(parsed.pointers, request.on, MAKE_FORM, request.value);
    if (next.length !== parsed.pointers.length) {
      await deps.writePointersText(serializePointers(next, parsed.malformed));
    }
  } catch {
    // The mint failed: no pointer line, so the artifact is NOT written (a file
    // with no reach is not this Move). The log says the half-move that was
    // actually attempted, and nothing more.
    return commitMake(deps, {
      ...head,
      changes: [{ ...mintChange, outcome: "failed" }],
    });
  }

  // 2. WRITE — RAW text through the raw writer. A failure is SAID, and the
  // minted Change stays in the log: the pointer dangles and the log is honest.
  const size = utf8ByteLength(request.text);
  let writeChange: WriteTextChange = {
    kind: "write-text",
    pointer: citation,
    outcome: "written",
    size,
  };
  try {
    await deps.writeArtifact(resolved.path, request.text);
  } catch {
    writeChange = { ...writeChange, outcome: "failed" };
  }

  return commitMake(deps, { ...head, changes: [mintChange, writeChange] });
}

/** Mint the id, append the ONE line, and answer the Move. */
async function commitMake(
  deps: MakeContactDeps,
  prism: Omit<Prism, "id">,
): Promise<MakeContactResult> {
  const mapped: Prism = { id: deps.mintId(), ...prism };
  const before = await deps.readPrismsText();
  await deps.writePrismsText(appendPrismLine(before, mapped));
  return { kind: "moved", prism: mapped };
}
