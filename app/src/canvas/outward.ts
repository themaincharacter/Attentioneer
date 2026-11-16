import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { PointerForm } from "../map/pointers";
import {
  CANNOT_OPEN,
  CANNOT_REVEAL,
  resolveTarget,
  schemeNotice,
} from "./outwardRules";

/**
 * The outward actions (Epic 5 story 2): the app hands a target to the OS. This
 * is the ONLY place that calls the opener plugin, and it goes through the
 * plugin's IPC/JS API — NEVER through a Rust-side command. (Epic 12 story 3's
 * contact egress reuses this door: open-os hands a url off through
 * `openOutward`, so the capability's scope stays the ONE authority and no
 * second call site can ever bypass it.) The plugin's own
 * docs are explicit that its Rust methods do no scope check; only the IPC
 * wrappers build the Scope, so a Rust-side `open_path` would silently evade
 * the capability. Convention, not boundary: the scope lives in
 * `app/src-tauri/capabilities/default.json`.
 *
 * Every failure is honest and quiet. This box has no xdg-open, so opening a
 * path can fail where a promise of a launch would lie; the window says
 * "cannot open". An unsupported URL scheme is refused BEFORE the call (the
 * plugin would reject it with a raw "forbidden url"), and says "cannot open
 * this scheme". Nothing is logged, thrown, retried or dressed up.
 */

/** What an outward action did: launched, or the one sentence the window shows. */
export interface OutwardResult {
  ok: boolean;
  message: string | null;
}

/**
 * Open one authored pointer outward: a url through `openUrl` (scheme-guarded
 * first), a file path through `openPath` (the scoped capability decides; an
 * out-of-scope path is refused by the IPC authority and reads "cannot open").
 */
export async function openOutward(
  form: PointerForm,
  value: string,
  workspacePath: string,
): Promise<OutwardResult> {
  const target = resolveTarget(form, value, workspacePath);
  if (target.kind === "url") {
    const refused = schemeNotice(target.url);
    if (refused !== null) return { ok: false, message: refused };
    return attempt(() => openUrl(target.url), CANNOT_OPEN);
  }
  return attempt(() => openPath(target.path), CANNOT_OPEN);
}

/**
 * Reveal a file in the system file manager with the item selected — the
 * unreadable window's only outward move. A url has nothing on disk to reveal.
 */
export async function revealOutward(
  form: PointerForm,
  value: string,
  workspacePath: string,
): Promise<OutwardResult> {
  const target = resolveTarget(form, value, workspacePath);
  if (target.kind !== "file") return { ok: false, message: CANNOT_REVEAL };
  return attempt(() => revealItemInDir(target.path), CANNOT_REVEAL);
}

/** Run one outward call, turning any rejection into its quiet sentence. */
async function attempt(
  run: () => Promise<void>,
  failure: string,
): Promise<OutwardResult> {
  try {
    await run();
    return { ok: true, message: null };
  } catch {
    return { ok: false, message: failure };
  }
}
