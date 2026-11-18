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
 * string, and the command must be absolute so a PATH lookup cannot swap the
 * server for something else.
 *
 * THE SHIPPED ROW IS UNVERIFIED, LIKE THE CLI ROWS. Its argv is what the spike
 * observed (`--profile acp` is required; a bare `dsh` is not an ACP server),
 * its command is the absolute shim the spike reached, and it has NO env entry —
 * so a real run refuses honestly at the first prompt until the person adds one.
 *
 * PROVISIONAL: the field names, the env entry shape, the default budget and
 * every sentence in ACP_SENTENCES.
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
  /** The server executable: an ABSOLUTE path, never a shell string. */
  command: string;
  /** The argv that makes the command an ACP server, one entry each. */
  args: string[];
  /** Where the session runs: always a fresh session directory for now. */
  cwdPolicy: "session";
  /** The optional, explicit key grants. Empty means the child gets no key. */
  env: AcpEnvEntry[];
  /** How long one run may live, in minutes. */
  timeoutMinutes: number;
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

  return {
    kind: "row",
    row: {
      kind: "acp",
      id,
      name,
      command,
      args,
      cwdPolicy: ACP_CWD_POLICY,
      env,
      timeoutMinutes: Math.floor(stated),
      notes: (draft.notes ?? "").trim(),
    },
  };
}

/**
 * The shipped list. Data, and the only place an ACP product is named at all.
 * PROVISIONAL and UNVERIFIED: the command is this machine's observed absolute
 * shim (the spike's `dsh --profile acp`), the argv is the required pair, and
 * the row deliberately grants NO key — the spike's first break was credentials,
 * so this row fails honestly instead of pretending it can run.
 */
export const ACP_SPECS: readonly AcpSpec[] = [
  {
    kind: "acp",
    id: "dsh-acp",
    name: "DeepSeek Harness (ACP)",
    command:
      "C:\\Users\\thema\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd",
    args: ["--profile", "acp"],
    cwdPolicy: ACP_CWD_POLICY,
    env: [],
    timeoutMinutes: DEFAULT_ACP_TIMEOUT_MINUTES,
    notes:
      "UNVERIFIED — the spike (18.1) reached this absolute dsh.cmd with --profile acp and created a session; no env entry is declared, so a prompt is refused for a missing DEEPSEEK_API_KEY until you add one for your provider row. Edit the command for another install.",
  },
];

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
