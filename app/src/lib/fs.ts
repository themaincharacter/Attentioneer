import { invoke } from "@tauri-apps/api/core";

/**
 * Thin bridges to the Rust fs commands. Machine-file *content* is owned by
 * `serialize.ts`; this module only moves bytes and asks about paths.
 */

/** One bounded glimpse from `read_text_head` (Epic 5 story 2). */
export interface TextHead {
  /** The readable prefix: bounded by lines AND bytes, cut on a char boundary. */
  head: string;
  /** The file says more than the bounds returned. */
  truncated: boolean;
  /** A regular file was there to read. */
  exists: boolean;
  /** The whole file's size in bytes, when it exists. */
  size: number | null;
  /** Last modification, milliseconds since the Unix epoch, when known. */
  mtime: number | null;
}

export async function readTextFile(path: string): Promise<string | null> {
  return await invoke<string | null>("read_text_file", { path });
}

/**
 * Read a bounded head of a regular text file (Epic 5 story 2). Read-only by
 * construction: the Rust command has no writer. A missing path comes back with
 * `exists: false`; every refusal (directory, FIFO, special, binary) rejects
 * with a clean message the window answers "cannot read".
 */
export async function readTextHead(
  path: string,
  maxLines: number,
  maxBytes: number,
): Promise<TextHead> {
  return await invoke<TextHead>("read_text_head", {
    path,
    maxLines,
    maxBytes,
  });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke("write_text_file", { path, content });
}

export async function createDirAll(path: string): Promise<void> {
  await invoke("create_dir_all", { path });
}

export async function pathExists(path: string): Promise<boolean> {
  return await invoke<boolean>("path_exists", { path });
}

export async function listDir(path: string): Promise<string[]> {
  return await invoke<string[]>("list_dir", { path });
}

export async function renameFile(from: string, to: string): Promise<void> {
  await invoke("rename_file", { from, to });
}

export async function removeFile(path: string): Promise<void> {
  await invoke("remove_file", { path });
}

/**
 * Remove a folder and everything in it (Epic 8 story 2's retire verb: a
 * scenario IS its folder, so deleting the folder is the whole of retirement).
 * A missing path is a quiet no-op. Only the scenario batch calls it, and only
 * ever on `scenarios/<slug>/`.
 */
export async function removeDirAll(path: string): Promise<void> {
  await invoke("remove_dir_all", { path });
}

/**
 * Create a marker file EXCLUSIVELY (Epic 10 story 1, ADR-0025 decision 2): the
 * Rust command opens with `create_new` — the `wx`/O_EXCL open — so the answer
 * is one atomic "did this call create it?". True means the caller owns the
 * marker now; false means a marker was already there (a stale in-flight marker
 * the ghost accept releases before re-claiming). The file is empty by
 * construction: a sentinel, never a record.
 */
export async function createMarkerExclusive(path: string): Promise<boolean> {
  return await invoke<boolean>("create_marker_exclusive", { path });
}
