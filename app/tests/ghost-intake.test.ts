import { describe, expect, test } from "bun:test";
import {
  inboxDir,
  inboxEnvelopePath,
  inboxMarkerPath,
} from "../src/ghost/inbox";
import { ASSUMPTIONS_FILE } from "../src/ghost/registry";
import { createGhostSession, type GhostContext } from "../src/ghost/session";
import { agentReply, withWorkspace } from "./ghost-harness";

/**
 * Epic 10 story 1 — the intake and the inbox.
 *
 * Paste/import raw model output -> wrap (the app mints the id and the base pin)
 * -> validate (the one grammar) -> `.attentioneer/inbox/`. The inbox is
 * derived and disposable: one file per ghost, DISCARDED at open (replay
 * refused), and only ids this session minted accept. The check is the story's
 * "paste a model reply at intake — it wraps and lands in the inbox".
 */

const CONTEXT: GhostContext = { level: "dynamics", scenario: null };

describe("intake: wrap, validate, land", () => {
  test("a pasted model reply wraps and lands in the inbox", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const result = await session.intake(agentReply(), CONTEXT);
      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
      if (!result.envelope || !result.path) throw new Error("expected a filed ghost");
      expect(result.path).toBe(inboxEnvelopePath(scratch.path, result.envelope.id));
      expect(scratch.exists(result.path)).toBe(true);
      expect(session.registered()).toEqual([result.envelope.id]);
      // The app minted the pin; the model authored no part of it.
      expect(result.envelope.expect.files[ASSUMPTIONS_FILE]).toHaveLength(64);
      expect(result.envelope.expect.level).toBe("dynamics");
      expect(result.envelope.expect.game).toBe("dynamics");
      expect(result.envelope.steps).toHaveLength(1);
      // Nothing was applied: intake never writes a record (acceptance is the
      // only apply).
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        '{"on":"soil","text":"the soil holds water"}\n',
      );
    });
  });

  test("the wrap trims the prose's edges, so the envelope says what writes", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const result = await session.intake(
        agentReply({ params: { text: "  rain follows the soil  " } }),
        CONTEXT,
      );
      expect(result.ok).toBe(true);
      if (!result.envelope) throw new Error("expected an envelope");
      expect(result.envelope.params.text).toBe("rain follows the soil");
      const accept = await session.accept(result.envelope.id, CONTEXT);
      expect(accept.outcome).toBe("applied");
      expect(scratch.read(ASSUMPTIONS_FILE)).toContain(
        '{"on":"rain","text":"rain follows the soil"}\n',
      );
    });
  });

  test("a fenced reply's prose becomes the rationale when the body has none", async () => {
    await withWorkspace(async (scratch) => {
      const body = {
        move: { family: "assumption", verb: "add" },
        target: { kind: "word", slug: "rain" },
        params: { text: "rain and soil move together" },
      };
      const raw = [
        "The claim I propose:",
        "",
        "```json",
        JSON.stringify(body),
        "```",
        "",
        "It states a relation the map leaves open.",
      ].join("\n");
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const result = await session.intake(raw, CONTEXT);
      expect(result.ok).toBe(true);
      if (!result.envelope) throw new Error("expected an envelope");
      expect(result.envelope.rationale).toContain("The claim I propose:");
      expect(result.envelope.rationale).toContain("leaves open");
    });
  });

  test("a reply with no patch body lands nothing", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const result = await session.intake("I would add a claim about rain.", CONTEXT);
      expect(result.ok).toBe(false);
      expect(result.issues.map((entry) => entry.code)).toContain("intake");
      expect(scratch.exists(inboxDir(scratch.path))).toBe(false);
    });
  });

  test("agent-side keys are refused: unknown keys and name slots", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const extra = await session.intake(agentReply({ expect: {} }), CONTEXT);
      expect(extra.ok).toBe(false);
      expect(extra.issues.map((entry) => entry.code)).toContain("unknown-key");

      const named = await session.intake(agentReply({ params: { text: "x", name: "storm" } }), CONTEXT);
      expect(named.ok).toBe(false);
      expect(named.issues.map((entry) => entry.code)).toContain("name-slot");

      const moved = await session.intake(agentReply({ move: { family: "assumption", verb: "add", name: "coin" } }), CONTEXT);
      expect(moved.ok).toBe(false);
      expect(moved.issues.map((entry) => entry.code)).toContain("name-slot");
      expect(scratch.exists(inboxDir(scratch.path))).toBe(false);
    });
  });

  test("the intake only files a ghost the grammar accepts", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      // A dangling target: refused, nothing lands.
      const dangling = await session.intake(
        agentReply({ target: { kind: "word", slug: "gone" } }),
        CONTEXT,
      );
      expect(dangling.ok).toBe(false);
      expect(dangling.issues.map((entry) => entry.code)).toContain("dangling-target");

      // A spot target: refused in v1.
      const spot = await session.intake(
        agentReply({ target: { kind: "spot", x: 1, y: 2 } }),
        CONTEXT,
      );
      expect(spot.ok).toBe(false);
      expect(spot.issues.map((entry) => entry.code)).toContain("refused-target");

      // A claim that already stands: append-only refuses it.
      const standing = await session.intake(
        agentReply({
          target: { kind: "word", slug: "soil" },
          params: { text: "the soil holds water" },
        }),
        CONTEXT,
      );
      expect(standing.ok).toBe(false);
      expect(standing.issues.map((entry) => entry.code)).toContain("append-only");

      expect(scratch.exists(inboxDir(scratch.path))).toBe(false);
    });
  });

  test("the intake opens at Level 2 only, and refuses a branch", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      for (const level of ["concept", "ground"] as const) {
        const result = await session.intake(agentReply(), { level, scenario: null });
        expect(result.ok).toBe(false);
        expect(result.issues.map((entry) => entry.code)).toContain("game");
      }
      const branch = await session.intake(agentReply(), {
        level: "dynamics",
        scenario: "storm",
      });
      expect(branch.ok).toBe(false);
      expect(branch.issues.map((entry) => entry.code)).toContain("branch");
      expect(scratch.exists(inboxDir(scratch.path))).toBe(false);
    });
  });
});

describe("the inbox: disposable, in-session ids only", () => {
  test("open discards every envelope and marker (replay refused)", async () => {
    await withWorkspace(async (scratch) => {
      const oldEnvelope = inboxEnvelopePath(scratch.path, "ghost-old");
      const oldMarker = inboxMarkerPath(scratch.path, "ghost-old");
      scratch.write(".attentioneer/inbox/ghost-old.json", "{}");
      scratch.write(".attentioneer/inbox/ghost-old.marker", "");
      scratch.write(".attentioneer/inbox/keep.txt", "a person's file");
      expect(scratch.exists(oldEnvelope)).toBe(true);
      expect(scratch.exists(oldMarker)).toBe(true);

      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const report = await session.open();
      expect(report).toEqual({ envelopes: 1, markers: 1 });
      expect(scratch.exists(oldEnvelope)).toBe(false);
      expect(scratch.exists(oldMarker)).toBe(false);
      // Only the app's own files are discarded.
      expect(scratch.read(".attentioneer/inbox/keep.txt")).toBe("a person's file");
      expect(session.registered()).toEqual([]);

      // The old id is not the app's any more: replay is refused.
      const replay = await session.accept("ghost-old", CONTEXT);
      expect(replay.outcome).toBe("not-registered");
    });
  });

  test("only a registered id accepts: a hand-filed envelope is not known", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const text = scratch.read(`.attentioneer/inbox/${result.envelope.id}.json`)!;
      // Copy the filed bytes under another id (a hand edit / replay attempt).
      scratch.write(".attentioneer/inbox/ghost-other.json", text);
      const accept = await session.accept("ghost-other", CONTEXT);
      expect(accept.outcome).toBe("not-registered");
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        '{"on":"soil","text":"the soil holds water"}\n',
      );
    });
  });

  test("a discarded envelope is missing on accept, and reject deletes quietly", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const first = await session.intake(agentReply(), CONTEXT);
      if (!first.envelope) throw new Error("expected an envelope");
      // The envelope vanished from the disposable inbox: not an apply, a miss.
      scratch.fs.remove(inboxEnvelopePath(scratch.path, first.envelope.id));
      const missing = await session.accept(first.envelope.id, CONTEXT);
      expect(missing.outcome).toBe("missing");

      const second = await session.intake(
        agentReply({ target: { kind: "word", slug: "rain" }, params: { text: "a second claim" } }),
        CONTEXT,
      );
      if (!second.envelope) throw new Error("expected an envelope");
      expect(scratch.exists(inboxEnvelopePath(scratch.path, second.envelope.id))).toBe(true);
      expect(await session.reject(second.envelope.id)).toBe(true);
      expect(scratch.exists(inboxEnvelopePath(scratch.path, second.envelope.id))).toBe(false);
      expect(await session.reject(second.envelope.id)).toBe(false);
      const gone = await session.accept(second.envelope.id, CONTEXT);
      expect(gone.outcome).toBe("not-registered");
    });
  });

  test("the accept re-checks the level and the branch context", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const wrongLevel = await session.accept(result.envelope.id, {
        level: "concept",
        scenario: null,
      });
      expect(wrongLevel.outcome).toBe("refused");
      if (wrongLevel.outcome === "refused") {
        expect(wrongLevel.issues.map((entry) => entry.code)).toContain("level");
      }
      const branch = await session.accept(result.envelope.id, {
        level: "dynamics",
        scenario: "storm",
      });
      expect(branch.outcome).toBe("refused");
      if (branch.outcome === "refused") {
        expect(branch.issues.map((entry) => entry.code)).toContain("branch");
      }
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        '{"on":"soil","text":"the soil holds water"}\n',
      );
    });
  });
});
