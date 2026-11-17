/**
 * THE LOCAL RUNTIMES THE APP SHIPS AS DATA (Epic 15 story 6; PROVISIONAL).
 *
 * WHY A SPEC AND NOT A BRANCH: a local runtime is a fact about a command —
 * where its model goes, which port and key it takes, how it says it is ready,
 * and how long it may sit idle. The app never asks "is this llama.cpp?", so a
 * runtime the app has never heard of is a row a person types, and a runtime
 * that ships is an entry in THIS list. Adding one is editing data.
 *
 * WHY THE ARGV IS THE DOCUMENTED llama-server SHAPE: the preset is the one
 * command a person is likely to have if they run a model at home. It is the
 * only place the product is named at all; nothing branches on it. The flags
 * are the documented ones and the notes say what was not verified.
 *
 * WHAT A ROW SENDS: the placeholders below each stand in ONE argv entry, and
 * the host substitutes them there (never into a shell string). The port and
 * key are the app's: it chooses the port, mints the key per launch, and hands
 * both to the child's argv.
 */

/** The placeholder for the loopback port the app chose. */
export const LOCAL_PORT_PLACEHOLDER = "{port}";

/** The placeholder for the key the app minted for this launch. */
export const LOCAL_KEY_PLACEHOLDER = "{key}";

/** The placeholder for the model path the row names. */
export const LOCAL_MODEL_PLACEHOLDER = "{model}";

/** The idle window a local row gets when it states none (PROVISIONAL). */
export const DEFAULT_LOCAL_IDLE_MINUTES = 10;

/** How one local runtime is started. All argv arrays. */
export interface LocalSpec {
  /** Stable id; a row derived from this spec shares it. */
  id: string;
  /** The display name the panel shows. */
  name: string;
  /** The binary: a bare name on PATH or a path as typed. */
  command: string;
  /** The argv, with {port}, {key} and {model} each in ONE entry. */
  args: string[];
  /** The OPTIONAL line that means the server is ready. */
  readyPattern?: string;
  /** Minutes with no turn before the child is killed. */
  idleMinutes: number;
  /** What this entry claims, and how sure it is. */
  notes: string;
}

/**
 * The shipped list. Data, and the only place llama.cpp is written down.
 * PROVISIONAL: the flags are the documented ones; the readiness line and the
 * key flag are the least certain parts, which is exactly why the row's
 * readyPattern can be edited and the port is probed too.
 */
export const LOCAL_SPECS: readonly LocalSpec[] = [
  {
    id: "llama-local",
    name: "llama.cpp (llama-server)",
    command: "llama-server",
    args: [
      "-m",
      LOCAL_MODEL_PLACEHOLDER,
      "--host",
      "127.0.0.1",
      "--port",
      LOCAL_PORT_PLACEHOLDER,
      "--api-key",
      LOCAL_KEY_PLACEHOLDER,
      "--ctx-size",
      "32768",
      "-ngl",
      "999",
    ],
    readyPattern: "server is listening",
    idleMinutes: DEFAULT_LOCAL_IDLE_MINUTES,
    notes:
      "the documented llama-server flags; the readiness line is what the server prints after it binds, and the row may change it",
  },
];

/** One shipped local spec by id, or null (the panel offers only what ships). */
export function shippedLocalSpec(id: string): LocalSpec | null {
  return LOCAL_SPECS.find((spec) => spec.id === id) ?? null;
}
