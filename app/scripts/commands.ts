import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { actsFromScript } from "../src/commands/acts";
import {
  acceptLine,
  createAttentioneerHost,
  type CommandIo,
} from "../src/commands/attentioneerHost";
import { executeScript } from "../src/commands/execute";

/**
 * STORY 21.1 — THE HEADLESS DRIVER (ADR-0038 §6).
 *
 * `bun run commands --workspace <temp> --script <file> [--accept]` runs a
 * script of acts against a workspace with NO UI and NO model call, prints one
 * line per act and a summary, and — with `--accept` — accepts the ghosts it
 * filed through the app's own accept. The same executor a future chat will
 * drive runs here; that is the point of the story.
 *
 * A PROPOSAL IS NOT A WRITE: without `--accept` the map's records are
 * byte-identical when the script ends. The ghosts live in
 * `.attentioneer/inbox/` (the inbox's own folder, derived and disposable), and
 * an accepted one writes exactly the records the app's own path would.
 *
 * NOT A DEV COMMAND FILE (ADR-0038 §6's other mechanism): this driver is a
 * command-line program, not a file the app watches, and the app never loads
 * it. Running it needs the workspace path a person typed.
 *
 * Provisional: the flags, the script's line shape (a JSON list, a
 * `{ "acts": [...] }` wrapper or one act per line), and the summary's words.
 */

/** The node:fs bridge, implementing the same port the app's Tauri bridge does. */
export function nodeCommandIo(): CommandIo {
  const missing = (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT";

  return {
    async readTextFile(path) {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async writeTextFile(path, content) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    },
    async removeFile(path) {
      rmSync(path, { force: true });
    },
    async listDir(path) {
      try {
        return readdirSync(path).sort();
      } catch (error) {
        if (missing(error)) return [];
        throw error;
      }
    },
    async createDirAll(path) {
      mkdirSync(path, { recursive: true });
    },
    async createMarkerExclusive(path) {
      mkdirSync(dirname(path), { recursive: true });
      try {
        const fd = openSync(path, "wx");
        closeSync(fd);
        return true;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "EEXIST"
        ) {
          return false;
        }
        throw error;
      }
    },
  };
}

/** What one run printed. */
export interface CommandCliResult {
  /** The process exit code the driver would use (0 green, 1 refused). */
  code: number;
  /** Everything printed, in order. */
  lines: readonly string[];
}

/** The usage sentence a missing flag answers. */
export const USAGE =
  "usage: bun run commands --workspace <folder> --script <file> [--accept]";

/** Read one flag's value from an argv list, or null. */
function flagValue(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  const value = argv[at + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

/**
 * Run the driver and RETURN what it printed (no process exit here), so a test
 * drives the same command the person runs.
 */
export async function runCommands(
  argv: readonly string[],
  io: CommandIo = nodeCommandIo(),
): Promise<CommandCliResult> {
  const lines: string[] = [];
  const workspace = flagValue(argv, "--workspace");
  const scriptPath = flagValue(argv, "--script");
  if (workspace === null || scriptPath === null) {
    return { code: 1, lines: [USAGE] };
  }
  let text: string;
  try {
    text = readFileSync(scriptPath, "utf8");
  } catch {
    return { code: 1, lines: [`the script "${scriptPath}" could not be read.`] };
  }
  const acts = actsFromScript(text);
  if (acts === null) {
    return { code: 1, lines: ["the script is not a list of acts."] };
  }

  const host = createAttentioneerHost({ workspacePath: workspace, io });
  const run = await executeScript(acts, host);
  for (const line of run.lines) lines.push(line);
  if (!run.ok) {
    lines.push(run.sentence ?? "the script was refused.");
    lines.push(
      `summary: stopped at act ${run.applied + 1}; nothing after it was applied.`,
    );
    return { code: 1, lines };
  }

  const wanted = argv.includes("--accept");
  if (!wanted) {
    lines.push(
      `summary: ${run.applied} act(s) ran; ${run.ids.length} ghost(s) held; the records are unchanged until an accept.`,
    );
    return { code: 0, lines };
  }

  const answers = await host.accept(run.ids);
  let accepted = 0;
  for (const answer of answers) {
    lines.push(acceptLine(answer.id, answer.outcome));
    if (
      answer.outcome.outcome === "applied" ||
      answer.outcome.outcome === "already-applied"
    ) {
      accepted += 1;
    }
  }
  const code = accepted === run.ids.length ? 0 : 1;
  lines.push(
    `summary: ${run.applied} act(s) ran; ${accepted} of ${run.ids.length} ghost(s) accepted.`,
  );
  return { code, lines };
}

/** The CLI entry: print and exit. */
if (import.meta.main) {
  const result = await runCommands(process.argv.slice(2));
  for (const line of result.lines) console.log(line);
  process.exit(result.code);
}
