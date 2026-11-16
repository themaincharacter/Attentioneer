import {
  canonicalizePath,
  readTextFile,
  readTextHead,
  writeTextFile,
} from "../lib/fs";
import {
  loadLatestPrism,
  mintPrismId,
  prismsPath,
  rewritePrismExplanation,
  type ContactKind,
  type Prism,
  type PrismPointer,
} from "../map/prisms";
import {
  runReadContact,
  type ReadContactDeps,
  type ReadContactRequest,
  type ReadContactResult,
} from "./read";

/**
 * THE APP'S WIRING FOR THE READ CONTACTS (Epic 12 story 2) — the one bridge
 * between the pure read path (read.ts) and the Tauri-backed fs module.
 *
 * ONE FILE, ONE QUEUE. map/prisms.jsonl is a read-modify-write file: an append
 * reads the existing bytes, adds one canonical line and writes the whole file;
 * the explanation save reads, replaces one line's explanation and writes. If
 * two of those ran at once an older file could reappear under a newer one, so
 * BOTH doors share one in-order queue (the writeQueue precedent). A failed task
 * never stalls the next: the rejection reaches its caller and the queue moves
 * on.
 *
 * The read path itself imports no Tauri runtime: this module is the only place
 * that knows the bridges, and the flow is asserted with fakes in bun (the
 * boundary's injected-canonicalizer idiom, one layer up).
 *
 * Provisional: the module's name and the queue's lifetime (one per app run;
 * one window, one workspace at a time).
 */

/** The tail of the PRISM file's one write queue. */
let tail: Promise<unknown> = Promise.resolve();

/** Queue one read-modify-write of map/prisms.jsonl, in order. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** The bridges the read path needs, bound to one workspace. */
export function readContactDeps(workspacePath: string): ReadContactDeps {
  const path = prismsPath(workspacePath);
  return {
    canonicalize: canonicalizePath,
    readHead: readTextHead,
    readPrismsText: () => readTextFile(path),
    writePrismsText: (text) => writeTextFile(path, text),
    mintId: mintPrismId,
  };
}

/**
 * Perform ONE Look/Measure Move: the read path appends exactly one PRISM line
 * in the file's order, inside the shared queue. A table refusal is not a Move
 * (nothing is read, nothing is appended).
 */
export function runReadMove(
  request: ReadContactRequest,
): Promise<ReadContactResult> {
  return enqueue(() => runReadContact(request, readContactDeps(request.workspacePath)));
}

/**
 * Save the person's explanation on ONE completed Move, addressed by id
 * (PROVISIONAL: authored at the Move's window). The read path's changes stay
 * read-only: this rewrites only that line's explanation field and keeps every
 * other byte. False means the line is gone (or the file is) — nothing is
 * written and the window says "not saved".
 */
export function savePrismExplanation(
  workspacePath: string,
  id: string,
  explanation: string,
): Promise<boolean> {
  return enqueue(async () => {
    const path = prismsPath(workspacePath);
    const text = await readTextFile(path);
    if (text === null) return false;
    const next = rewritePrismExplanation(text, id, explanation);
    if (next === null) return false;
    await writeTextFile(path, next);
    return true;
  });
}

/**
 * The reopen affordance's read: ONE reach's latest PRISM, fresh from disk. The
 * record layer's citation scan (latestPrismIn) answers one Prism or null — the
 * app has no gallery, no counter and no cached series.
 */
export function readLatestPrism(
  workspacePath: string,
  on: string,
  pointer: PrismPointer | null,
  contact?: ContactKind,
): Promise<Prism | null> {
  // Queued behind any pending save: closing the window saves, and a reopen
  // immediately after must read the saved words, not the stale bytes.
  return enqueue(() => loadLatestPrism(workspacePath, on, pointer, contact));
}
