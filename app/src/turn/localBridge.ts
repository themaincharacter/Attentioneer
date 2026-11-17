import { invoke } from "@tauri-apps/api/core";
import { errorSentence } from "./turn";
import type { LocalLaunch, LocalStatus } from "./local";

/**
 * THE WINDOW'S SIDE OF THE LOCAL RUNTIME (Epic 15 story 6).
 *
 * The RULES are pure (local.ts): which placeholders an argv may carry, how a
 * launch's values go into separate entries, what the panel's sentence says.
 * The PROCESS is Rust's (src-tauri/src/local_runtime.rs): choose a loopback
 * port, mint one key for this launch, spawn without a shell, wait for
 * readiness, kill when idle. This file is the narrow seam between them, and it
 * is deliberately dumb — it hands Rust an argv and returns the launch, or one
 * sentence. No key is ever logged or stored here: it arrives in the launch's
 * status for the turn's one request line and goes nowhere else.
 *
 * WHY THE ARGV IS BUILT ABOVE THIS LINE: the placeholders stay in the row's
 * argv; Rust substitutes the port, key and model there, ENTRY BY ENTRY. The
 * window neither concatenates a command line nor sees the substitution.
 *
 * PROVISIONAL: the command names and their camelCase arguments.
 */

/** Start (or reuse) the child behind one row. The idle timer is touched. */
export async function startLocal(
  tag: string,
  command: string,
  args: readonly string[],
  model: string,
  readyPattern: string | undefined,
  idleMinutes: number,
): Promise<LocalLaunch> {
  try {
    const status = await invoke<LocalStatus>("local_start", {
      tag,
      command,
      args: [...args],
      model,
      readyPattern: readyPattern ?? null,
      idleMinutes,
    });
    return { kind: "running", status };
  } catch (error) {
    return { kind: "refused", sentence: errorSentence(String(error)) };
  }
}

/** The child's state WITHOUT starting anything; null when none runs. */
export async function localStatus(): Promise<LocalStatus | null> {
  try {
    return await invoke<LocalStatus | null>("local_status");
  } catch {
    return null;
  }
}

/** Stop the child now (the panel's stop; the idle rule uses the same kill). */
export async function stopLocal(): Promise<void> {
  try {
    await invoke("local_stop");
  } catch {
    // A stop that cannot reach the host leaves the idle rule to it.
  }
}
