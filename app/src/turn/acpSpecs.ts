/**
 * THE ACP TOOL ROWS THE APP SHIPS (Epic 18 story 2; the row shape is PROVISIONAL).
 *
 * WHY A ROW: an ACP tool is a fact about a program — where it is, the argv that
 * makes it an ACP server, where a session may run, and — only when the person
 * says so — which provider row's key it may receive. The app never asks "is
 * this DeepSeek Harness?"; a tool the app has never heard of is a row a person
 * types, and a tool that ships is an entry in THIS list. Adding one is editing
 * data.
 *
 * WHAT A ROW CANNOT CARRY: a key. There is no field for one, and an env entry
 * names a provider row instead of holding a value. The spike (18.1) found the
 * first break is credentials: `session/prompt` was refused with `-32603`
 * because the spawned `dsh` had no DEEPSEEK_API_KEY, and `authMethods: []`
 * means ACP itself carries no auth. So the ONE way a key reaches a child is an
 * explicit entry here, read from the store in memory at run time; everything
 * else is inherited PATH and HOME and nothing more.
 *
 * ARGV ONLY. `args` is an argv array; nothing here is ever joined into a shell
 * string.
 *
 * WHERE A COMMAND COMES FROM: a row a PERSON types must be absolute, so PATH
 * cannot choose a different program. A row this build SHIPS may name a bare
 * command when the tool is one a person installs themselves — the run lane
 * looks it up on PATH and refuses, in one sentence naming it, before any
 * spawn. Neither kind is ever run through a shell.
 *
 * THE SHIPPED ROWS ARE UNVERIFIED, LIKE THE CLI ROWS. The first row's argv is
 * what the spike observed (`--profile acp` is required; a bare `dsh` is not an
 * ACP server), and it has NO env entry — so a real run refuses honestly at the
 * first prompt until the person adds one. The second row is a documented entry
 * point nobody here has run (story 18.6), and says so.
 *
 * STORY 21.1 — A ROW MAY SAY IT CONTINUES SESSIONS (PROVISIONAL). The optional
 * `resume: "protocol"` is a fact about the SERVER's advertised capability, and
 * absent means the row cannot continue one: every run makes a fresh session
 * exactly as before. Nothing branches on a product's name; the shipped first
 * row carries the mark because the spike's server advertised session/resume and
 * answered it live, and the second row does not.
 *
 * PROVISIONAL: the field names, the env entry shape, the `verified` mark, the
 * default budget, the label suffix, the continuation mark and every sentence in
 * ACP_SENTENCES.
 */

import { uniqueProviderId, type Refusal, type RowRead } from "./providers";

/** The only directory policy there is: a fresh session directory per run. */
export const ACP_CWD_POLICY = "session" as const;

/** The budget a row gets when it states none (PROVISIONAL). */
export const DEFAULT_ACP_TIMEOUT_MINUTES = 10;

/**
 * One environment variable a run may receive: the NAME in the child, and the
 * provider ROW whose stored key fills it. The key itself is never here — it is
 * read at run time, held in memory for the spawn, and never logged.
 */
export interface AcpEnvEntry {
  /** The variable name the child sees, e.g. DEEPSEEK_API_KEY. */
  name: string;
  /** The provider row id whose stored key becomes the value. */
  key: string;
}

/** How one ACP tool is started and bounded. All argv arrays. */
export interface AcpSpec {
  /** This row's kind, so a settings list can tell it from the CLI/local tiers. */
  kind: "acp";
  /** Stable id; derived from the name when the row was made and deduped. */
  id: string;
  /** The display name the panel shows. */
  name: string;
  /**
   * Whether a live install confirmed this row (PROVISIONAL, story 18.6). A
   * false row is still offerable — it is DATA — but the pickers mark it, and
   * its notes say what was not run. Nothing branches on a product's name.
   */
  verified: boolean;
  /**
   * The server executable: an ABSOLUTE path for a row a person typed; a bare
   * name for a shipped row whose tool the person installs (the lane resolves
   * it on PATH and refuses before spawning when it is not there).
   */
  command: string;
  /** The argv that makes the command an ACP server, one entry each. */
  args: string[];
  /** Where the session runs: always a fresh session directory for now. */
  cwdPolicy: "session";
  /** The optional, explicit key grants. Empty means the child gets no key. */
  env: AcpEnvEntry[];
  /** How long one run may live, in minutes. */
  timeoutMinutes: number;
  /**
   * STORY 21.1 — WHETHER THIS ROW CONTINUES SESSIONS OVER THE PROTOCOL
   * (PROVISIONAL). Absent means "cannot continue a session": every run of the
   * row makes a fresh one, exactly as before. The only value today is
   * `"protocol"`, and it is a fact about the SERVER (the capability it
   * advertises in `initialize`), never about a product's name: a row is data,
   * and the card branches on this field alone.
   */
  resume?: "protocol";
  /** What this row claims, and how sure it is. */
  notes: string;
}

/** One ACP row being added or edited, as the form holds it (not yet a row). */
export interface AcpSpecDraft {
  /** Absent while adding: the id is derived from the name and deduped. */
  id?: string;
  name: string;
  command: string;
  args: readonly string[];
  /** Only "session" is understood today; anything else is refused. */
  cwdPolicy?: string;
  env?: readonly AcpEnvEntry[];
  timeoutMinutes?: number;
  /**
   * STORY 21.1 — the row's continuation capability as the form holds it
   * (PROVISIONAL). Absent is valid and means the row cannot continue a
   * session; anything but `"protocol"` is refused.
   */
  resume?: string;
  notes?: string;
}

/** The sentences the panel shows for a row it cannot store (PROVISIONAL). */
export const ACP_SENTENCES = {
  noName: "an ACP row needs a name",
  noId: "an ACP row needs a name with a letter or a digit in it",
  noCommand: "an ACP row needs the absolute path of the server to run",
  relativeCommand:
    "an ACP row's command must be an absolute path, so PATH cannot choose a different program",
  badCwdPolicy:
    "an ACP row runs in a fresh session directory; there is no other directory policy yet",
  envName:
    "an environment entry needs a name a process can carry, such as DEEPSEEK_API_KEY",
  envKey:
    "an environment entry must name the provider row whose key it may receive",
  duplicateName: "two environment entries fill the same variable",
  timeout: "an ACP row's budget must be at least one minute",
  duplicateId: "an ACP row with that id already exists",
  /**
   * STORY 21.1 — the row's continuation capability has ONE recognised value
   * (PROVISIONAL). An absent field is valid and means the row cannot continue
   * a session; anything else is refused rather than stored as a hope.
   */
  resume: "an ACP row either continues a session over the protocol or it does not; the only value is protocol",
} as const;

/** The sentence for an env entry naming a provider row that is not there. */
export function acpUnknownProviderSentence(providerId: string): string {
  return (
    "the environment entry names " +
    providerId +
    ", which is not one of your provider rows — a key can only come from a row"
  );
}

/**
 * Is this an absolute path? Deliberately a pure string check (this module also
 * compiles in the window): "/x", "C:\\x" and "\\\\server\\share" are absolute;
 * "dsh" is not, and it is refused for that reason.
 */
export function isAbsoluteCommand(command: string): boolean {
  const text = command.trim();
  if (text === "") return false;
  if (text.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(text)) return true;
  return text.startsWith("\\\\");
}

/** The name a process may carry: a shell-style identifier, nothing exotic. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function refused(sentence: string): Refusal {
  return { kind: "refused", sentence };
}

/**
 * Turn an ACP draft into a row, or refuse with the one sentence the form
 * shows. WHAT IS REQUIRED: a name (for the id), an absolute command, a
 * directory policy this app can honour, and — for every env entry — a variable
 * name plus the id of a provider row that exists NOW. A key grant to a row
 * that is gone would either fail at spawn or, worse, silently hand the child
 * nothing; it is refused at the write instead.
 *
 * PROVISIONAL: whether an absolute command should be checked by existence too
 * (it cannot be, in this pure module) and whether more than one env entry
 * should be allowed (it is allowed; each is still explicit).
 */
export function validateAcpSpec(
  draft: AcpSpecDraft,
  taken: readonly string[] = [],
  providerIds: readonly string[] = [],
): RowRead<AcpSpec> {
  const name = draft.name.trim();
  if (name === "") return refused(ACP_SENTENCES.noName);

  const id =
    draft.id === undefined || draft.id.trim() === ""
      ? uniqueProviderId(name, taken)
      : draft.id.trim();
  if (id === "") return refused(ACP_SENTENCES.noId);
  if (draft.id !== undefined && taken.includes(id)) {
    return refused(ACP_SENTENCES.duplicateId);
  }

  const command = draft.command.trim();
  if (command === "") return refused(ACP_SENTENCES.noCommand);
  if (!isAbsoluteCommand(command)) {
    return refused(ACP_SENTENCES.relativeCommand);
  }

  const args = draft.args
    .map((arg) => arg.trim())
    .filter((arg) => arg !== "");

  const cwdPolicy = draft.cwdPolicy ?? ACP_CWD_POLICY;
  if (cwdPolicy !== ACP_CWD_POLICY) {
    return refused(ACP_SENTENCES.badCwdPolicy);
  }

  const env: AcpEnvEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of draft.env ?? []) {
    const entryName = textOf(candidate.name).trim();
    const key = textOf(candidate.key).trim();
    if (!ENV_NAME.test(entryName)) return refused(ACP_SENTENCES.envName);
    if (key === "") return refused(ACP_SENTENCES.envKey);
    if (!providerIds.includes(key)) {
      return refused(acpUnknownProviderSentence(key));
    }
    if (seen.has(entryName)) return refused(ACP_SENTENCES.duplicateName);
    seen.add(entryName);
    env.push({ name: entryName, key });
  }

  const stated = draft.timeoutMinutes ?? DEFAULT_ACP_TIMEOUT_MINUTES;
  if (!Number.isFinite(stated) || stated < 1) {
    return refused(ACP_SENTENCES.timeout);
  }

  // STORY 21.1 — THE CONTINUATION CAPABILITY IS OPTIONAL AND NARROW
  // (PROVISIONAL). Absent is valid and means the row cannot continue a session;
  // the one understood value is the protocol capability. Nothing else is
  // stored as if it were a yes.
  let resume: "protocol" | undefined;
  if (draft.resume !== undefined) {
    if (draft.resume !== "protocol") return refused(ACP_SENTENCES.resume);
    resume = "protocol";
  }

  return {
    kind: "row",
    row: {
      kind: "acp",
      id,
      name,
      // A typed row cannot claim a verification this file did not see.
      verified: false,
      command,
      args,
      cwdPolicy: ACP_CWD_POLICY,
      env,
      timeoutMinutes: Math.floor(stated),
      ...(resume === undefined ? {} : { resume }),
      notes: (draft.notes ?? "").trim(),
    },
  };
}

/**
 * The shipped list. Data, and the only place an ACP product is named at all.
 * PROVISIONAL and UNVERIFIED, both rows: the first is this machine's observed
 * absolute shim (the spike's `dsh --profile acp`); the second is a documented
 * entry point nobody here ran. Each argv is the pair its tool documents, and
 * neither row declares an env entry — the spike's first break was credentials,
 * so a run fails honestly instead of pretending it can run.
 *
 * STORY 18.6 — A SECOND TOOL IS THIS ENTRY. The lane, the card, the picker and
 * the records take a row by its id and its argv; not one of them knows a
 * product. The label marks what is unverified; the run lane refuses a missing
 * command before it spawns anything.
 */
export const ACP_SPECS: readonly AcpSpec[] = [
  {
    kind: "acp",
    id: "dsh-acp",
    name: "DeepSeek Harness (ACP)",
    verified: false,
    command:
      "C:\\Users\\thema\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd",
    args: ["--profile", "acp"],
    cwdPolicy: ACP_CWD_POLICY,
    env: [],
    timeoutMinutes: DEFAULT_ACP_TIMEOUT_MINUTES,
    // STORY 21.1 — the server advertises session/resume and answered it live
    // (spike, 2026-11-19), so this row can continue a session.
    resume: "protocol",
    notes:
      "UNVERIFIED — the spike (18.1) reached this absolute dsh.cmd with --profile acp and created a session; no env entry is declared, so a prompt is refused for a missing DEEPSEEK_API_KEY until you add one for your provider row. The server also advertises session/resume and answered it live (spike, 2026-11-19), so a card using this row can continue its last session. Edit the command for another install.",
  },
  {
    kind: "acp",
    id: "opencode-acp",
    name: "OpenCode (ACP)",
    verified: false,
    // A bare command on purpose: OpenCode is installed by the person, and the
    // run lane resolves it on PATH (or refuses, naming it, before any spawn).
    command: "opencode",
    args: ["acp"],
    cwdPolicy: ACP_CWD_POLICY,
    env: [],
    timeoutMinutes: DEFAULT_ACP_TIMEOUT_MINUTES,
    notes:
      "UNVERIFIED — 'opencode acp' is OpenCode's documented ACP entry point (research, 2026-11-17), but nothing here has run it. Its sign-in is out of band ('opencode auth login') and cannot be brokered: no env entry is declared, so this app never holds its credentials. Its sandbox defaults, permission habits and whether it can resume a session are the tool's own and unknown here; one fresh session directory is the only workspace it is given.",
  },
];

/**
 * THE PICKER'S LABEL (story 18.6, PURE, PROVISIONAL): the row's name, and the
 * one word that says it was not confirmed on a live install. The mark comes
 * from the DATA, never from recognising a product — a third row is a third
 * entry, and it marks itself.
 */
export function acpRowLabel(spec: AcpSpec): string {
  return spec.verified ? spec.name : spec.name + " (unverified)";
}

/* ------------------------------------------------------------------ *
 * STORY 22.1 — WHAT THIS ROW KNOWS ABOUT THIS MACHINE (PROVISIONAL).
 *
 * The shipped rows are data and stay immutable; whether a row has been TESTED
 * HERE is a per-machine fact that the config file keeps (turn/acpRowStore.ts
 * lays it over the shipped rows by id). This module holds the pure half: the
 * two facts, the three states they make, and the one sentence each state says.
 *
 * THE HOUSE VOICE: lowercase, present tense, and it says what is ABSENT as
 * well as what is NOT CLAIMED. "it answered" is the only success claim there
 * is — a test shows that one tiny task came back with words, never that the
 * row "works", and the word "verified" appears in no sentence at all.
 *
 * WHY IT LIVES HERE AND NOT IN THE CARD: the sentence is computed from DATA
 * (the row and the stored facts), never from a product's name, and the card
 * must be able to say it without importing anything that runs a process.
 * ------------------------------------------------------------------ */

/** How much of the test's answer the row keeps (PROVISIONAL, characters). */
export const ACP_SEEN_LINE_MAX = 80;

/**
 * WHAT A PASSING TEST SAW, as the row keeps it: the ISO date of the press and
 * the FIRST LINE of what came back, clipped. It is a record, not a transcript:
 * the row never keeps the whole answer, and nothing from a run enters the map.
 */
export interface AcpRowSeen {
  /** The ISO date (YYYY-MM-DD) the test was run. */
  date: string;
  /** The first line of the answer, clipped; never the whole answer. */
  line: string;
}

/**
 * THE FIRST LINE, CLIPPED (PURE). The row keeps one short line of what the
 * test answered: everything before the first line break, trimmed, cut at
 * `max` characters with an ellipsis when it is longer. An answer with no
 * words answers the empty string, which is not a result.
 */
export function acpSeenLine(text: string, max: number = ACP_SEEN_LINE_MAX): string {
  const first = text.split(/\r?\n/)[0] ?? "";
  const trimmed = first.trim();
  const room = Math.max(1, Math.floor(max));
  if (trimmed.length <= room) return trimmed;
  return trimmed.slice(0, Math.max(1, room - 1)).trimEnd() + "…";
}

/**
 * ONE ROW'S STATE ON THIS MACHINE. "missing" is the command not being there at
 * all; "untested" is the honest default (the shipped rows are unverified);
 * "tested" is only ever reached from a fact the person's own press recorded.
 */
export type AcpRowStatus =
  | { kind: "missing" }
  | { kind: "untested" }
  | { kind: "tested"; seen: AcpRowSeen };

/**
 * THE THREE STATES, from the facts alone (PURE). `found` is whether the row's
 * command was seen on this machine; `verified` and `seen` are the stored
 * fact. A fact claiming a test with nothing seen is NOT a test: the state says
 * untested rather than dress an empty answer up as a result.
 */
export function acpRowStatus(
  found: boolean,
  verified: boolean,
  seen: AcpRowSeen | null,
): AcpRowStatus {
  if (!found) return { kind: "missing" };
  if (verified && seen !== null && acpSeenLine(seen.line) !== "") {
    return { kind: "tested", seen };
  }
  return { kind: "untested" };
}

/**
 * THE ONE SENTENCE A ROW'S STATE SAYS (PURE, PROVISIONAL wording). One sentence,
 * in the house voice: the command's absence, the honest never-tested line, or
 * the date and the words that came back. It never says "verified" and never
 * says "working" — a test proves an answer arrived once, not that the row is
 * good.
 */
export function acpStatusSentence(status: AcpRowStatus): string {
  if (status.kind === "missing") {
    return "this tool is not on this machine.";
  }
  if (status.kind === "untested") {
    return "this row has never been tested here.";
  }
  return (
    "tested here on " +
    status.seen.date +
    "; it answered: “" +
    acpSeenLine(status.seen.line) +
    "”"
  );
}

/**
 * THE ENV RULE MADE AUDIBLE (18.2, moved here by 18.3b): one sentence naming
 * which provider rows' keys a run will receive — never a value. It is computed
 * from the ROW alone, so no key read can appear in it, and it lives in this
 * window-safe module because the CARD says it while the SIDECAR does the spawn.
 */
export function acpDeclaration(spec: AcpSpec): string {
  return acpResolvedDeclaration(spec.env.map((entry) => entry.key));
}

/**
 * The same sentence, built from variable NAMES: what the sidecar says when the
 * grant arrived as a resolved map on the wire (18.3b) and there is no row on
 * that side to name. Names only, never values.
 */
export function acpResolvedDeclaration(names: readonly string[]): string {
  if (names.length === 0) {
    return "this run will receive no key: no environment entry names a provider row";
  }
  if (names.length === 1) {
    return "this run will receive the key named " + names[0];
  }
  const last = names[names.length - 1];
  return (
    "this run will receive the keys named " +
    names.slice(0, -1).join(", ") +
    " and " +
    last
  );
}

/**
 * STORY 19.2 — THE SCOPE DECLARATION (PURE, PROVISIONAL): ONE sentence, in the
 * house voice, said BEFORE a bound run starts. It names the folder's FULL PATH
 * — the blast radius is said aloud, so the mirror's name-only rule does not
 * apply here — and the boundary the person declared.
 *
 * The two words are the record's own: "write" is "may change files there" and
 * "read" is "only reads". Nothing else is claimed: no promise about what the
 * tool does inside the boundary, and no claim about anything outside it.
 */
export function acpScopeDeclaration(
  folder: string,
  boundary: "read" | "write",
): string {
  if (boundary === "read") {
    return "this run works in " + folder + " and only reads";
  }
  return "this run works in " + folder + " and may change files there";
}

/**
 * The sentence for a declared key that is not in the store (18.2). The WINDOW
 * says it (it is the side that reads the key store); the sidecar only ever
 * receives values, so it never has to say this.
 */
export function acpMissingKeySentence(providerId: string): string {
  return (
    "the key named " +
    providerId +
    " is not kept, so the run was not started"
  );
}

/** One shipped ACP spec by id, or null (the panel offers only what ships). */
export function shippedAcpSpec(id: string): AcpSpec | null {
  return ACP_SPECS.find((spec) => spec.id === id) ?? null;
}
