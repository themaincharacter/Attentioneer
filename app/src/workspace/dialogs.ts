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
 * The ground map's file picker (story 16.1; story 16.4 adds the second kind):
 * one LOCAL file for a reference's reading — a text file, or a PDF read on
 * device (ADR-0035). It is the same OS dialog as the folder picker, with the
 * file choice left to the person; the read's own refusal (`not-text`,
 * `too-large`, `cannot-reach`, "that PDF has no text to read.") decides later
 * whether the pick was readable — the dialog is never a validator.
 *
 * Still NO FILTERS: a filter would be a guess about what a readable file is
 * called, and a PDF named `.PDF` or a text file with no suffix would silently
 * vanish from the dialog. The pick's NAME decides which extractor runs
 * (`extractKindFor`), and the bridge says honestly what happened.
 */
export async function pickReadingFile(title: string): Promise<string | null> {
  const selected = await open({ directory: false, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}
