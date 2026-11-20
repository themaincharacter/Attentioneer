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
 * A move is constrained to ONE FILE, ONE CHANGE (ADR-0025 decision 3): one
 * file, one appended line, or one removal. That is the crash sufficiency — a
 * crash can leave one file's change landed or not landed, never a cross-file
 * fan-out half done, and the pin names which of the two happened. STORY 21.6's
 * removals keep the same shape; a card's wires are NOT part of the ghost (the
 * app's own delete path is where that cascade lives).
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
 *
 * STORY 21.6 — A NULL AFTER IS A REMOVAL. The dry run's produced bytes are
 * written as before; when a removal leaves no file (a note), the file is
 * REMOVED through the port after the same pin check. The removal is the same
 * one-file, one-change discipline as an append: the pin proves the base the
 * person accepted is still the base on disk, and only then does the file go.
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
    if (file.after === null) {
      await fs.remove(path);
      continue;
    }
    await fs.writeText(path, file.after);
  }
}
