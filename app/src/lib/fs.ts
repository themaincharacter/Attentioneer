import { invoke } from "@tauri-apps/api/core";

/**
 * Thin bridges to the Rust fs commands. Machine-file *content* is owned by
 * `serialize.ts`; this module only moves bytes and asks about paths.
 */

/**
 * The head read's decode status (Epic 12 story 1): the bridge now SAYS when the
 * lossy decoder replaced bytes rather than hiding it (ADR-0029 rule 5). The
 * PRISM logs this value; the peek's transient shows it to the person.
 */
export type DecodeStatus = "clean" | "with-replacement";

/**
 * The typed refusal codes a head read answers with (Epic 12 story 1,
 * ADR-0029): `not-text` (a NUL byte — binary refuses), `cannot-reach` (not a
 * regular file, or a path that does not resolve), `io` (the filesystem's own
 * error) and `escaped` (the boundary layer's refusal, in the same vocabulary —
 * the read below is unscoped; the contact layer's resolver refuses first).
 */
export type HeadRefusalCode = "not-text" | "cannot-reach" | "escaped" | "io";

/** One typed head refusal. It never carries the path (the caller cites). */
export interface HeadRefusal {
  code: HeadRefusalCode;
  /** The OS's own words when there are any; never the path. */
  detail: string | null;
}

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
  /** Whether the decoder was clean, or had to replace invalid bytes. */
  decode: DecodeStatus;
}

export async function readTextFile(path: string): Promise<string | null> {
  return await invoke<string | null>("read_text_file", { path });
}

/**
 * Read a bounded head of a regular text file (Epic 5 story 2). Read-only by
 * construction: the Rust command has no writer. A missing path comes back with
 * `exists: false`; every refusal rejects with a TYPED code the window answers
 * "cannot read" (Epic 12 story 1 replaced the free strings: a refusal is data,
 * and it never embeds the path — the caller holds the citation).
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
 * Canonicalize a path AS FAR AS IT EXISTS (Epic 12 story 1, ADR-0029): the
 * boundary layer's one realpath primitive. The Rust command follows symlinks
 * and `..`; a missing target keeps its missing tail, canonicalized from the
 * deepest existing ancestor — so a not-yet-created artifact still resolves.
 * This bridge does NOT scope: the pure resolver
 * (`contacts/boundary.ts`) compares the answer with the workspace root and
 * refuses the escape. The one-layer honesty is ADR-0029's.
 */
export async function canonicalizePath(path: string): Promise<string> {
  return await invoke<string>("canonicalize_path", { path });
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

/**
 * One path's identity facts, for the ground map's staleness reading (story
 * 16.2). METADATA only — the command stats the path and opens nothing — so the
 * map may say "has changed since this reading" and never "the text differs".
 * The field names are the bridge's (snake_case, `meta.rs`), kept as they come
 * so the one shape cannot drift from the Rust side.
 */
export interface FileMeta {
  /** The path resolves to something right now. */
  exists: boolean;
  /** It is a regular file (a folder, FIFO or dangling link is not). */
  is_file: boolean;
  /** The file's size in bytes, when it is a regular file. */
  len: number | null;
  /** Last modification, milliseconds since the Unix epoch, when known. */
  modified_ms: number | null;
}

/**
 * A metadata answer: the facts, or the bridge's refusal as a VALUE. A reading
 * that cannot be stat'ed is a state the map shows ("unreadable"), never an
 * exception the plane has to catch; this is why `fileMeta` never rejects.
 */
export type FileMetaAnswer =
  | ({ kind: "facts" } & FileMeta)
  | { kind: "refused" };

/**
 * Stat one path without reading it (story 16.2's `file_meta`). Read-only by
 * construction. A missing path comes back `exists: false` (the map says
 * "missing"); a non-regular path says `exists: true, is_file: false` (the map
 * says "unreadable"); an OS failure — permissions, a malformed path — is the
 * refusal VALUE `{ kind: "refused" }`, never a throw. The map's states are
 * computed at load from this answer and are never written into a record.
 */
export async function fileMeta(path: string): Promise<FileMetaAnswer> {
  try {
    const facts = await invoke<FileMeta>("file_meta", { path });
    return { kind: "facts", ...facts };
  } catch {
    return { kind: "refused" };
  }
}
