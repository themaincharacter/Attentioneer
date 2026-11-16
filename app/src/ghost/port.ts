import {
  createDirAll,
  createMarkerExclusive,
  listDir,
  readTextFile,
  removeFile,
  writeTextFile,
} from "../lib/fs";

/**
 * The ghost's fs PORT (Epic 10 story 1) — the ONE impure seam the envelope, the
 * inbox and the accept cross.
 *
 * Production passes `tauriGhostFs`, the thin Tauri bridge. The tests pass a
 * real-filesystem adapter (node's fs) over a temporary workspace, so the
 * marker/crash matrix is a genuine fs-level assertion rather than a stub: the
 * exclusive marker, the applied-but-unmarked reconcile and discard-at-open all
 * touch real bytes. Nothing above this port does I/O; the grammar stays pure.
 *
 * Provisional: the port's method set (it is exactly what the ghost needs today)
 * and the marker command's name (`create_marker_exclusive`).
 */
export interface GhostFs {
  /** A text file's bytes, or null when it is absent. */
  readText(path: string): Promise<string | null>;
  /** Write a text file (the app's canonical bytes are the caller's). */
  writeText(path: string, content: string): Promise<void>;
  /** Remove a file; a missing path is a quiet no-op. */
  remove(path: string): Promise<void>;
  /** A folder's entry names; a missing folder is []. */
  list(path: string): Promise<string[]>;
  /** Create a folder and its parents; an existing folder is a no-op. */
  createDirAll(path: string): Promise<void>;
  /**
   * Create a marker file EXCLUSIVELY: true when this call created it, false
   * when the path already existed (the app's `wx`/O_EXCL marker).
   */
  createMarkerExclusive(path: string): Promise<boolean>;
}

/** The production port: the Tauri fs bridge, unchanged. */
export const tauriGhostFs: GhostFs = {
  readText: (path) => readTextFile(path),
  writeText: (path, content) => writeTextFile(path, content),
  remove: (path) => removeFile(path),
  list: (path) => listDir(path),
  createDirAll: (path) => createDirAll(path),
  createMarkerExclusive: (path) => createMarkerExclusive(path),
};
