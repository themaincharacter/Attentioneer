import { open } from "@tauri-apps/plugin-dialog";

/**
 * Native folder picker (ADR-0002: the workspace folder is chosen via the OS
 * dialog — the dialog's own tools create folders).
 */
export async function pickFolder(title: string): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}
