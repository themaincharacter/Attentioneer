import { sha256Hex } from "./digest";
import type { GhostFs } from "./port";
import type { DryRun } from "./registry";

/**
 * `applyGhost` — THE apply (Epic 10 story 1, ADR-0024 decision 2).
 *
 * One function, one direction: it writes the dry run's produced bytes and
 * nothing else. The per-move fan-out and write ORDER live in the record layer
 * (`map/patches.ts` for the atomic record batches; v1's add-assumption is the
 * one file, once), and the bytes were SERIALIZED before they reached here — the
 * deriver built each line through `serialize.ts`, so this function never
 * stringifies a record.
 *
 * BEFORE each write it reads the file it is about to replace and checks the
 * base pin against THOSE bytes: the pin is checked against the file actually
 * written, not a snapshot a moment older. A moved base throws `GhostPinError`
 * and nothing is written — the proposal stays where it was and the person can
 * reject or re-intake.
 *
 * v1 is constrained to SINGLE-FILE APPENDS (ADR-0025 decision 3): one file,
 * one appended line. That is the crash sufficiency — a crash can leave one
 * file's append landed or not landed, never a cross-file fan-out half done, and
 * the pin/reconcile names which of the two happened.
 *
 * Provisional: the error type and the order (the run's file order).
 */
export class GhostPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhostPinError";
  }
}

/**
 * Write the dry run's files, pin-checked at the write. The caller has already
 * claimed the in-flight marker; it releases it when this returns or throws.
 */
export async function applyGhost(
  workspacePath: string,
  run: DryRun,
  fs: GhostFs,
): Promise<void> {
  for (const file of run.files) {
    const path = `${workspacePath}/${file.path}`;
    const current = await fs.readText(path);
    if (sha256Hex(current ?? "") !== sha256Hex(file.before ?? "")) {
      throw new GhostPinError(
        `${file.path} moved after the ghost's base pin; nothing was written`,
      );
    }
    await fs.writeText(path, file.after);
  }
}
