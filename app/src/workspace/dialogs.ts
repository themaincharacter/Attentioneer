import { open } from "@tauri-apps/plugin-dialog";

/**
 * Native folder picker (ADR-0002: the workspace folder is chosen via the OS
 * dialog — the dialog's own tools create folders).
 */
export async function pickFolder(title: string): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

/**
 * The ground map's file picker (story 16.1): one LOCAL text file for a
 * reference's reading. It is the same OS dialog as the folder picker, with the
 * file choice left to the person and the read's own refusal (`not-text`,
 * `cannot-reach`) deciding later whether the pick was readable — the dialog
 * is never a validator. No filters: a filter would be a guess about which
 * files are text, and the bridge already says so honestly.
 */
export async function pickTextFile(title: string): Promise<string | null> {
  const selected = await open({ directory: false, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}
