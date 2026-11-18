/**
 * THE ACP SPIKE (Epic 18 story 1) — drive one REAL ACP server, print exactly
 * what happened, and touch nothing else.
 *
 * What it does, in order: initialize; session/new in a SESSION DIRECTORY
 * (a temp directory unless --cwd says otherwise); one trivial read-only
 * prompt, with every permission request DECLINED by default and its shape
 * printed; a second prompt that is CANCELLED after its first update; a clean
 * close. Then it compares the session directory before and after and says
 * whether anything changed.
 *
 * Safety, stated as code:
 *   - The session directory may not be this repository or anything inside it;
 *     the script refuses before spawning.
 *   - A permission request is declined unless --allow is given, and --allow
 *     only ever selects an allow_once option for a READ-shaped tool call
 *     (read, search, fetch, grep, list, find). Everything else is refused. The
 *     note records which path was taken.
 *   - The child is killed on success, on failure, on the overall timeout and
 *     on SIGINT/SIGTERM. Nothing is installed, no key is read, no map file is
 *     opened.
 *   - Auth is a FINDING, not a puzzle: if the server advertises auth methods or
 *     a prompt fails for auth, the script says so and stops.
 *
 * The transport under test is app/src/turn/acp.ts; the fake-server proofs are
 * app/tests/acp-transport.test.ts. This file writes stdout only.
 *
 * Run it from the app package, e.g.
 *   bun run spike:acp -- --command "C:\path\to\dsh.cmd"
 * or with an explicit temp directory:
 *   bun run spike:acp -- --command dsh --cwd /tmp/acp-spike
 */

import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AcpFailure,
  startAcp,
  type AcpInitializeResult,
  type AcpPromptResult,
  type AcpServerRequest,
  type AcpTransport,
  type AcpFraming,
  type AcpTransportConfig,
} from "../src/turn/acp.ts";

interface Args {
  command: string;
  commandArgs: string[];
  cwd: string | null;
  timeoutMs: number;
  framing: AcpFraming;
  allow: boolean;
}

const HELP = [
  "spike:acp — one real ACP run, nothing written.",
  "",
  "  --command <path>     the server to spawn (default: dsh)",
  "  --arg <value>        one argument for the server; repeatable",
  "  --cwd <dir>          the session directory (default: a fresh temp dir)",
  "  --timeout <seconds>  overall budget (default: 120)",
  "  --framing <kind>     ndjson (default) or content-length",
  "  --allow              allow_once for READ-shaped tool calls only",
  "  --help               this text",
].join("\n");

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    command: "dsh",
    commandArgs: [],
    cwd: null,
    timeoutMs: 120_000,
    framing: "ndjson",
    allow: false,
  };
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    const value = (): string => {
      const next = argv[at + 1];
      if (next === undefined) throw new AcpFailure("the flag " + flag + " needs a value");
      at += 1;
      return next;
    };
    if (flag === "--help" || flag === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (flag === "--command") {
      args.command = value();
    } else if (flag === "--arg") {
      args.commandArgs.push(value());
    } else if (flag === "--cwd") {
      args.cwd = value();
    } else if (flag === "--timeout") {
      const seconds = Number(value());
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new AcpFailure("the timeout must be a positive number of seconds");
      }
      args.timeoutMs = Math.round(seconds * 1_000);
    } else if (flag === "--framing") {
      const framing = value();
      if (framing !== "ndjson" && framing !== "content-length") {
        throw new AcpFailure("the framing must be ndjson or content-length");
      }
      args.framing = framing;
    } else if (flag === "--allow") {
      args.allow = true;
    } else {
      throw new AcpFailure("unknown flag: " + flag);
    }
  }
  return args;
}

/** The repository root, from this file's place in it. */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");

function isInside(candidate: string, parent: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function snapshot(dir: string): Map<string, number> {
  const files = new Map<string, number>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.set(relative(dir, path), statSync(path).size);
    }
  };
  walk(dir);
  return files;
}

function describeChanges(before: Map<string, number>, after: Map<string, number>): string {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [path, size] of after) {
    if (!before.has(path)) added.push(path);
    else if (before.get(path) !== size) changed.push(path);
  }
  for (const path of before.keys()) if (!after.has(path)) removed.push(path);
  if (added.length + removed.length + changed.length === 0) {
    return "the session directory is unchanged";
  }
  return [
    added.length > 0 ? "added: " + added.join(", ") : null,
    removed.length > 0 ? "removed: " + removed.join(", ") : null,
    changed.length > 0 ? "changed: " + changed.join(", ") : null,
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
}

const READ_KINDS = new Set(["read", "search", "fetch", "grep", "list", "read_file", "find"]);

interface PermissionRecord {
  turn: number;
  raw: string;
  toolCall: unknown;
  options: unknown;
  reply: string;
  reason: string;
}

function optionFor(params: unknown, allow: boolean): { optionId: string | null; reason: string } {
  const value = (params ?? {}) as {
    toolCall?: { kind?: unknown; title?: unknown };
    options?: { optionId?: unknown; kind?: unknown }[];
  };
  const options = Array.isArray(value.options) ? value.options : [];
  const kind = typeof value.toolCall?.kind === "string" ? value.toolCall.kind : "";
  if (allow && !READ_KINDS.has(kind)) {
    return { optionId: null, reason: "allowed flag is read-only and this tool call is not a read" };
  }
  const wanted = allow ? "allow_once" : "reject_once";
  const exact = options.find((option) => option.kind === wanted && typeof option.optionId === "string");
  if (exact !== undefined) return { optionId: exact.optionId as string, reason: "the " + wanted + " option" };
  const fallback = options.find(
    (option) =>
      typeof option.optionId === "string" &&
      typeof option.kind === "string" &&
      option.kind.startsWith(allow ? "allow" : "reject"),
  );
  if (fallback !== undefined) {
    return { optionId: fallback.optionId as string, reason: "the first " + (allow ? "allow" : "reject") + " option" };
  }
  return { optionId: null, reason: "no matching option; answered cancelled" };
}

function summarizeUpdate(params: unknown): { kind: string; text: string } {
  const update = (params as { update?: Record<string, unknown> } | undefined)?.update;
  if (update === undefined) return { kind: "unknown", text: "" };
  const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "unknown";
  const content = update.content as { type?: unknown; text?: unknown } | undefined;
  if (typeof content?.text === "string") return { kind, text: content.text };
  const toolCall = update.toolCallId ?? update.title ?? update.status;
  return { kind, text: typeof toolCall === "string" ? toolCall : "" };
}

async function run(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const created = args.cwd === null;
  const cwd = created ? mkdtempSync(join(tmpdir(), "attentioneer-acp-spike-")) : resolve(args.cwd);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new AcpFailure("the session directory does not exist");
  }
  if (isInside(cwd, REPO_ROOT)) {
    throw new AcpFailure("the session directory is inside this repository; the spike runs in a temp directory");
  }

  const before = snapshot(cwd);
  console.log("spike:acp — one real ACP run");
  console.log("command: " + args.command + (args.commandArgs.length > 0 ? " " + args.commandArgs.join(" ") : ""));
  console.log("session directory: " + cwd + (created ? " (created)" : ""));
  console.log("framing: " + args.framing + " · overall budget: " + Math.round(args.timeoutMs / 1_000) + "s");
  console.log("permissions: " + (args.allow ? "ALLOW read-shaped calls only" : "DECLINE everything"));
  console.log("");

  const permissionRecords: PermissionRecord[] = [];
  const permissionByTurn: PermissionRecord[] = [];
  let permissionSeq = 0;
  let turn = 0;
  let firstUpdateRaw: string | null = null;
  let handshakeRawIn: string | null = null;
  let handshakeRawOut: string | null = null;
  let sessionRawIn: string | null = null;
  let sessionRawOut: string | null = null;
  let promptRawIn: string | null = null;
  let promptRawOut: string | null = null;
  let updates = 0;
  let secondPromptCancelSent = false;
  let secondPromptSeenUpdate = false;
  let authBlock: string | null = null;

  let transport: AcpTransport | null = null;
  let shuttingDown = false;
  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await transport?.close();
    process.exit(code);
  };

  process.on("SIGINT", () => void shutdown(130));
  process.on("SIGTERM", () => void shutdown(143));
  process.on("exit", () => {
    // The kill itself is synchronous inside close(); this is the last resort.
    void transport?.close();
  });

  const overall = setTimeout(() => {
    console.log("");
    console.log("TIMEOUT: the spike ran out of its " + Math.round(args.timeoutMs / 1_000) + "s budget");
    void shutdown(124);
  }, args.timeoutMs);

  try {
    const config: AcpTransportConfig = {
      command: args.command,
      args: args.commandArgs,
      cwd,
      framing: args.framing,
      requestTimeoutMs: Math.min(30_000, args.timeoutMs),
      onWire: (direction, payload) => {
        if (direction === "out") {
          if (handshakeRawOut === null && payload.includes('"initialize"')) handshakeRawOut = payload;
          if (sessionRawOut === null && payload.includes('"session/new"')) sessionRawOut = payload;
          if (promptRawOut === null && payload.includes('"session/prompt"')) promptRawOut = payload;
        } else {
          if (handshakeRawIn === null && payload.includes('"protocolVersion"')) handshakeRawIn = payload;
          if (sessionRawIn === null && payload.includes('"sessionId"')) sessionRawIn = payload;
          if (promptRawIn === null && payload.includes('"error"')) promptRawIn = payload;
          if (firstUpdateRaw === null && payload.includes('"session/update"')) firstUpdateRaw = payload;
        }
      },
      onNotification: (notification) => {
        const summary = summarizeUpdate(notification.params);
        updates += 1;
        console.log(
          "  update " + String(updates).padStart(2, " ") + " [" + summary.kind + "] " +
            (summary.text === "" ? "" : JSON.stringify(summary.text)),
        );
        if (turn === 2 && !secondPromptCancelSent) {
          secondPromptSeenUpdate = true;
          secondPromptCancelSent = true;
          console.log("  -> cancelling the second prompt after its first update");
          transport?.cancel(sessionId);
        }
      },
      onRequest: (request: AcpServerRequest) => {
        const raw = JSON.stringify({ jsonrpc: "2.0", id: request.id, method: request.method, params: request.params });
        const choice = optionFor(request.params, args.allow);
        permissionSeq += 1;
        const record: PermissionRecord = {
          turn,
          raw,
          toolCall: (request.params as { toolCall?: unknown } | undefined)?.toolCall,
          options: (request.params as { options?: unknown } | undefined)?.options,
          reply: choice.optionId === null ? "cancelled" : choice.optionId,
          reason: choice.reason,
        };
        permissionRecords.push(record);
        if (turn === 1) permissionByTurn.push(record);
        console.log("");
        console.log("PERMISSION " + permissionSeq + " (turn " + turn + "): " + raw);
        console.log("  -> reply: " + record.reply + " (" + record.reason + ")");
        void transport?.respondToPermission(request.id, choice.optionId).catch((error: unknown) => {
          console.log("  -> reply failed: " + String(error));
        });
      },
      onProblem: (sentence) => {
        console.log("PROBLEM: " + sentence);
      },
      onStderr: (line) => {
        const trimmed = line.length > 400 ? line.slice(0, 400) + "..." : line;
        console.log("  server stderr: " + trimmed);
      },
      onExit: (code) => {
        console.log("server exited with code " + code);
      },
    };

    const started = startAcp(config);
    if (started.kind === "refused") {
      console.log("REFUSED: " + started.sentence);
      return 1;
    }
    transport = started.transport;

    console.log("--- handshake ---");
    let initialized: AcpInitializeResult;
    try {
      initialized = await transport.initialize("attentioneer-spike", "0.0.1");
    } catch (error) {
      if (error instanceof AcpFailure) {
        console.log("the handshake failed: " + error.sentence);
        authBlock = /auth|login|sign in|credential/i.test(error.sentence) ? error.sentence : null;
        return 1;
      }
      throw error;
    }
    console.log("protocolVersion: " + initialized.protocolVersion);
    console.log("agentInfo: " + JSON.stringify(initialized.agentInfo ?? null));
    console.log("agentCapabilities: " + JSON.stringify(initialized.agentCapabilities ?? null));
    console.log(
      "authMethods: " + JSON.stringify(initialized.authMethods ?? []) +
        ((initialized.authMethods ?? []).length === 0 ? " (no auth required)" : " (AUTH ADVERTISED)"),
    );

    if (initialized.protocolVersion !== 1) {
      console.log("the server answered protocol " + initialized.protocolVersion + ", not 1; stopping");
      return 1;
    }

    console.log("");
    console.log("--- session ---");
    const session = await transport.newSession(cwd);
    const sessionId = session.sessionId;
    console.log("sessionId: " + sessionId);
    console.log("configOptions: " + JSON.stringify(session.configOptions ?? null));

    console.log("");
    console.log("--- raw handshake ---");
    console.log("out: " + (handshakeRawOut ?? "(not captured)"));
    console.log("in:  " + (handshakeRawIn ?? "(not captured)"));
    console.log("session/new out: " + (sessionRawOut ?? "(not captured)"));
    console.log("session/new in:  " + (sessionRawIn ?? "(not captured)"));

    console.log("");
    console.log("--- prompt 1 (read-only) ---");
    turn = 1;
    let first: AcpPromptResult | null = null;
    let secondResult: AcpPromptResult | null = null;
    let failed = false;
    try {
      first = await transport.prompt(sessionId, "Reply with exactly one short sentence: the word ACP.");
    } catch (error) {
      if (error instanceof AcpFailure) {
        console.log("prompt 1 failed: " + error.sentence);
        authBlock = /auth|login|sign in|credential|api key/i.test(error.sentence) ? error.sentence : null;
        failed = true;
      } else {
        throw error;
      }
    }
    if (first !== null) {
      console.log("stopReason: " + first.stopReason);

      console.log("");
      console.log("--- prompt 2 (cancelled) ---");
      turn = 2;
      const second = transport.prompt(sessionId, "Count slowly from 1 to 20, one number per line.");
      const cancelFallback = setTimeout(() => {
        if (!secondPromptCancelSent) {
          secondPromptCancelSent = true;
          console.log("  -> no update arrived; cancelling after 10s");
          transport?.cancel(sessionId);
        }
      }, 10_000);
      try {
        secondResult = await second;
      } catch (error) {
        if (error instanceof AcpFailure) {
          console.log("prompt 2 failed: " + error.sentence);
          failed = true;
        } else {
          throw error;
        }
      } finally {
        clearTimeout(cancelFallback);
      }
      if (secondResult !== null) {
        console.log("stopReason: " + secondResult.stopReason);
        if (secondResult.stopReason !== "cancelled") {
          console.log("NOTE: the second prompt settled as " + secondResult.stopReason + " before or despite the cancel");
        }
      }
    }

    console.log("");
    console.log("--- raw JSON ---");
    console.log("handshake out: " + (handshakeRawOut ?? "(not captured)"));
    console.log("handshake in:  " + (handshakeRawIn ?? "(not captured)"));
    console.log("session/new out: " + (sessionRawOut ?? "(not captured)"));
    console.log("session/new in:  " + (sessionRawIn ?? "(not captured)"));
    console.log("prompt out:    " + (promptRawOut ?? "(not captured)"));
    console.log("prompt in:     " + (promptRawIn ?? "(not captured)"));
    console.log("first update:  " + (firstUpdateRaw ?? "(not captured)"));

    console.log("");
    console.log("--- permissions ---");
    if (permissionRecords.length === 0) {
      console.log("no permission request was made");
    } else {
      for (const record of permissionRecords) {
        console.log(
          "turn " + record.turn + ": asked " + JSON.stringify(record.toolCall) +
            " options " + JSON.stringify(record.options) + " -> " + record.reply,
        );
      }
    }

    console.log("");
    console.log("--- close ---");
    await transport.close();
    transport = null;
    clearTimeout(overall);

    const after = snapshot(cwd);
    console.log(describeChanges(before, after));

    console.log("");
    console.log("VERDICT (observed, not assumed):");
    console.log("  protocol version accepted: " + initialized.protocolVersion);
    console.log("  streaming updates seen: " + updates);
    console.log("  permission requests: " + permissionRecords.length + " (" + permissionByTurn.length + " in prompt 1)");
    console.log("  permission replies: " + permissionRecords.map((record) => record.reply).join(", "));
    console.log("  prompt 1 stopReason: " + (first?.stopReason ?? "(no answer)"));
    console.log("  prompt 2 stopReason: " + (secondResult?.stopReason ?? "(no answer)"));
    console.log("  second prompt saw an update before cancel: " + (secondPromptSeenUpdate ? "yes" : "no"));
    if (authBlock !== null) console.log("  AUTH BLOCKED THE PROMPT: " + authBlock);
    if (authBlock !== null) return 2;
    return failed ? 1 : 0;
  } catch (error) {
    if (error instanceof AcpFailure) {
      console.log("FAILED: " + error.sentence);
      return 1;
    }
    console.log("FAILED: " + (error instanceof Error ? error.message : String(error)));
    return 1;
  } finally {
    clearTimeout(overall);
    await transport?.close();
  }
}

try {
  process.exit(await run());
} catch (error) {
  // A refusal is one sentence, never a stack trace (house rule).
  if (error instanceof AcpFailure) {
    console.log("FAILED: " + error.sentence);
    process.exit(1);
  }
  throw error;
}
