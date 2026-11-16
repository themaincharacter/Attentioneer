import { describe, expect, test } from "bun:test";
import { appendLine, ASSUMPTIONS_FILE } from "../src/ghost/registry";
import { applyGhost, GhostPinError } from "../src/ghost/apply";
import { inboxEnvelopePath, inboxMarkerPath } from "../src/ghost/inbox";
import { createGhostSession, type GhostContext } from "../src/ghost/session";
import {
  agentReply,
  readFiledEnvelope,
  tracedFs,
  withWorkspace,
  type Workspace,
} from "./ghost-harness";

/**
 * Epic 10 story 1 — the marker and the crash matrix, on a REAL filesystem.
 *
 * This is the repo's first fs-level assertion: the harness's node:fs adapter is
 * the production GhostFs interface, so the exclusive marker, the applied-but-
 * unmarked reconcile and discard-at-open all touch real bytes. The stories:
 *   - accept order is marker -> apply -> delete; the marker is empty and is on
 *     disk when the one line writes;
 *   - the marker is IN-FLIGHT only: a stale one never blocks an accept;
 *   - a crash after the write (marker still there) reconciles as applied and
 *     does not write twice;
 *   - a crash after the marker went (nothing marked) reconciles against the
 *     base pin: the appended line is stripped, the base hashes to the pin;
 *   - a base that moved is refused at the write's own pin check.
 */

const CONTEXT: GhostContext = { level: "dynamics", scenario: null };
const BASE = '{"on":"soil","text":"the soil holds water"}\n';

function openSession(scratch: Workspace, fs = scratch.fs) {
  return createGhostSession({ workspacePath: scratch.path, fs });
}

describe("the accept order (marker -> apply -> delete)", () => {
  test("the exclusive marker lands before the one line writes, and is gone after", async () => {
    await withWorkspace(async (scratch) => {
      const traced = tracedFs(scratch.fs);
      const session = openSession(scratch, traced.fs);
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const id = result.envelope.id;
      traced.trace.calls.length = 0;
      traced.trace.markerAtWrite.length = 0;
      traced.trace.markerContentAtWrite.length = 0;

      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("applied");
      if (accept.outcome !== "applied") return;
      expect(accept.steps).toHaveLength(1);
      // The order the crash rule names.
      expect(traced.trace.calls.indexOf("marker")).toBeLessThan(
        traced.trace.calls.indexOf("write"),
      );
      expect(traced.trace.calls.indexOf("write")).toBeGreaterThan(-1);
      expect(traced.trace.markerAtWrite).toEqual([true]);
      // The marker is a sentinel, never a record.
      expect(traced.trace.markerContentAtWrite).toEqual([""]);
      // One line wrote, and the ghost and its marker are gone.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        BASE + '{"on":"rain","text":"rain follows the soil\'s temperature"}\n',
      );
      expect(scratch.exists(inboxEnvelopePath(scratch.path, id))).toBe(false);
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);
    });
  });

  test("a stale marker never blocks an accept (in-flight only, never resumed)", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch);
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const id = result.envelope.id;
      // A marker from a crashed earlier attempt, with the base untouched.
      scratch.write(`.attentioneer/inbox/${id}.marker`, "");
      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("applied");
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);
      expect(scratch.read(ASSUMPTIONS_FILE)).toContain(
        '{"on":"rain","text":"rain follows the soil\'s temperature"}\n',
      );
    });
  });
});

describe("the applied-but-unmarked reconcile (the base pin, keyed on the id)", () => {
  test("the write landed but the marker went: applied, and never written twice", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch);
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const id = result.envelope.id;
      const filed = readFiledEnvelope(scratch, id);
      // Simulate the crash: the apply wrote the bytes, then the process died
      // before the marker/envelope cleanup. The marker is absent.
      const after = appendLine(BASE, filed.steps[0].line);
      scratch.write(ASSUMPTIONS_FILE, after);
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);

      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("already-applied");
      // No second write: the file is exactly the applied bytes.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(after);
      expect(scratch.exists(inboxEnvelopePath(scratch.path, id))).toBe(false);
      // And the ghost is no longer registered.
      expect((await session.accept(id, CONTEXT)).outcome).toBe("not-registered");
    });
  });

  test("the write landed and the marker did too: applied, both cleaned up", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch);
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const id = result.envelope.id;
      const filed = readFiledEnvelope(scratch, id);
      const after = appendLine(BASE, filed.steps[0].line);
      scratch.write(ASSUMPTIONS_FILE, after);
      scratch.write(`.attentioneer/inbox/${id}.marker`, "");

      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("already-applied");
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(after);
      expect(scratch.exists(inboxEnvelopePath(scratch.path, id))).toBe(false);
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);
    });
  });

  test("a moved base is refused at the write's own pin check; a restore accepts", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch);
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const id = result.envelope.id;
      // Another write landed under the ghost (a hand edit, or another accept).
      const moved = BASE + '{"on":"rain","text":"a claim that landed first"}\n';
      scratch.write(ASSUMPTIONS_FILE, moved);
      // A stale marker from an earlier attempt must not block the refusal path
      // either; the refuse releases it.
      scratch.write(`.attentioneer/inbox/${id}.marker`, "");

      const refused = await session.accept(id, CONTEXT);
      expect(refused.outcome).toBe("refused");
      if (refused.outcome === "refused") {
        expect(refused.issues.map((entry) => entry.code)).toContain("pin");
      }
      // Nothing was written, nothing was discarded; the marker is released.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(moved);
      expect(scratch.exists(inboxEnvelopePath(scratch.path, id))).toBe(true);
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);

      // Restore the base the ghost pinned: the same stale ghost now applies.
      scratch.write(ASSUMPTIONS_FILE, BASE);
      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("applied");
      expect(scratch.read(ASSUMPTIONS_FILE)).toContain(
        '{"on":"rain","text":"rain follows the soil\'s temperature"}\n',
      );
    });
  });

  test("applyGhost pins against the file it is about to replace", async () => {
    await withWorkspace(async (scratch) => {
      const run = {
        steps: [],
        files: [
          {
            path: ASSUMPTIONS_FILE,
            before: '{"on":"soil","text":"a base that is not on disk"}\n',
            after: "{}",
          },
        ],
      };
      await expect(applyGhost(scratch.path, run, scratch.fs)).rejects.toBeInstanceOf(
        GhostPinError,
      );
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(BASE);
    });
  });
});

describe("the in-order write queue (two ghosts on one file)", () => {
  test("two ghosts intaken at one base: the second is refused (its base moved)", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch);
      const first = await session.intake(agentReply(), CONTEXT);
      const second = await session.intake(
        agentReply({ params: { text: "a second claim on rain" } }),
        CONTEXT,
      );
      if (!first.envelope || !second.envelope) throw new Error("expected envelopes");

      const a = await session.accept(first.envelope.id, CONTEXT);
      expect(a.outcome).toBe("applied");
      const b = await session.accept(second.envelope.id, CONTEXT);
      expect(b.outcome).toBe("refused");
      if (b.outcome === "refused") {
        expect(b.issues.map((entry) => entry.code)).toContain("pin");
      }
      // Only the first line ever wrote.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        BASE + '{"on":"rain","text":"rain follows the soil\'s temperature"}\n',
      );
      // A rejected ghost is gone; a fresh intake sees the new base and appends.
      expect(await session.reject(second.envelope.id)).toBe(true);
      const retry = await session.intake(
        agentReply({ params: { text: "a second claim on rain" } }),
        CONTEXT,
      );
      if (!retry.envelope) throw new Error("expected an envelope");
      const c = await session.accept(retry.envelope.id, CONTEXT);
      expect(c.outcome).toBe("applied");
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        BASE +
          '{"on":"rain","text":"rain follows the soil\'s temperature"}\n' +
          '{"on":"rain","text":"a second claim on rain"}\n',
      );
    });
  });

  test("a burst of accepts lands in the order it was made", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch);
      const ids: string[] = [];
      for (const text of ["first", "second", "third"]) {
        const result = await session.intake(
          agentReply({ params: { text: `the ${text} claim` } }),
          CONTEXT,
        );
        if (!result.envelope) throw new Error("expected an envelope");
        ids.push(result.envelope.id);
      }
      // The first accepts; the others' base moved and are refused — the queue
      // never re-reads a stale base and never silently skips a pin.
      const outcomes = [];
      for (const id of ids) {
        outcomes.push((await session.accept(id, CONTEXT)).outcome);
      }
      expect(outcomes).toEqual(["applied", "refused", "refused"]);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        BASE + '{"on":"rain","text":"the first claim"}\n',
      );
    });
  });
});
