import { describe, expect, test } from "bun:test";
import {
  extractAgentOutput,
  GHOST_FORMAT,
  isGhostId,
  isNameSlot,
  mintGhostId,
  readEnvelope,
  serializeEnvelope,
} from "../src/ghost/envelope";
import { validateGhost } from "../src/ghost/grammar";
import { ASSUMPTIONS_FILE } from "../src/ghost/registry";
import { createGhostSession, type GhostContext } from "../src/ghost/session";
import { readGhostSnapshot } from "../src/ghost/snapshot";
import { agentReply, readFiledEnvelope, withWorkspace } from "./ghost-harness";

/**
 * Epic 10 story 1 — the envelope: canonical round trip, re-validation at
 * accept, and the DERIVER owning the steps.
 *
 * The envelope is a portable JSON document (ADR-0024 decision 1): the app mints
 * the id, the base pin and the derived list; the agent authors only the move,
 * the target, the params and the rationale. These tests read the filed bytes
 * back and prove the same bytes re-validate — and that a hand-edited or
 * tampered envelope still goes through the ONE grammar (so a tampered step list
 * is ignored, never followed).
 */

const CONTEXT: GhostContext = { level: "dynamics", scenario: null };

function openSession(workspacePath: string, fs = undefined) {
  return createGhostSession({ workspacePath, fs });
}

describe("the envelope's canonical round trip (ADR-0024)", () => {
  test("intake files canonical JSON that reads back to the same envelope", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch.path, scratch.fs);
      const result = await session.intake(agentReply(), CONTEXT);
      expect(result.ok).toBe(true);
      if (!result.envelope) throw new Error("expected an envelope");

      const text = scratch.read(`.attentioneer/inbox/${result.envelope.id}.json`);
      expect(text).not.toBeNull();
      // Canonical through serialize.ts: trailing newline, sorted keys, 2-space.
      expect(text!.endsWith("\n")).toBe(true);
      expect(text!.startsWith("{\n  \"expect\": {\n")).toBe(true);
      const read = readEnvelope(text!);
      expect(read.problems).toEqual([]);
      const envelope = read.value as unknown as typeof result.envelope;
      expect(envelope).toEqual(result.envelope);
      expect(serializeEnvelope(envelope)).toBe(text!);
      expect(envelope.format).toBe(GHOST_FORMAT);
      expect(envelope.proposals).toEqual([]);
      expect(envelope.steps).toEqual([
        {
          op: "append",
          file: ASSUMPTIONS_FILE,
          line: "{\"on\":\"rain\",\"text\":\"rain follows the soil's temperature\"}",
        },
      ]);
      expect(Object.keys(envelope.expect.files)).toEqual([ASSUMPTIONS_FILE]);
      expect(envelope.expect.dir).toBe("map");
      expect(envelope.expect.level).toBe("dynamics");
      expect(envelope.expect.game).toBe("dynamics");
    });
  });

  test("the filed envelope re-validates against the same workspace", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch.path, scratch.fs);
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const filed = readFiledEnvelope(scratch, result.envelope.id);
      const snapshot = await readGhostSnapshot(scratch.fs, scratch.path, {
        level: "dynamics",
        scenario: null,
        files: [ASSUMPTIONS_FILE],
      });
      const validation = validateGhost(filed, snapshot);
      expect(validation.issues).toEqual([]);
      expect(validation.ok).toBe(true);
      expect(validation.applied).toBe(false);
      expect(validation.envelope).toEqual(result.envelope);
    });
  });

  test("an in-session id is minted by the app, never the model", async () => {
    const id = mintGhostId();
    expect(isGhostId(id)).toBe(true);
    expect(id.startsWith("ghost-")).toBe(true);
    expect(isGhostId("../escape")).toBe(false);
    expect(isGhostId("a/b")).toBe(false);
    expect(isGhostId("")).toBe(false);
    await withWorkspace(async (scratch) => {
      // A reply that tries to supply the app-owned keys is refused at intake.
      const raw = agentReply({ id: "ghost-from-model" });
      const session = openSession(scratch.path, scratch.fs);
      const result = await session.intake(raw, CONTEXT);
      expect(result.ok).toBe(false);
      expect(result.issues.map((entry) => entry.code)).toContain("unknown-key");
      expect(scratch.exists(".attentioneer/inbox")).toBe(false);
    });
  });
});

describe("the deriver owns the steps (a tampered list is ignored)", () => {
  test("accept re-derives: a tampered step cannot write another file", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch.path, scratch.fs);
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const id = result.envelope.id;

      const raw = JSON.parse(scratch.read(`.attentioneer/inbox/${id}.json`)!);
      raw.steps = [
        {
          op: "append",
          file: "map/loops.jsonl",
          line: '{"name":"evil","path":["rain","rain"]}',
        },
      ];
      scratch.write(`.attentioneer/inbox/${id}.json`, JSON.stringify(raw, null, 2));

      const loopsBefore = scratch.read("map/loops.jsonl");
      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("applied");
      if (accept.outcome !== "applied") return;
      // The DERIVED list, not the filed one.
      expect(accept.steps).toEqual([
        {
          op: "append",
          file: ASSUMPTIONS_FILE,
          line: "{\"on\":\"rain\",\"text\":\"rain follows the soil's temperature\"}",
        },
      ]);
      expect(scratch.read("map/loops.jsonl")).toBe(loopsBefore);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        '{"on":"soil","text":"the soil holds water"}\n' +
          '{"on":"rain","text":"rain follows the soil\'s temperature"}\n',
      );
    });
  });

  test("a hand-edited text is re-validated and then written exactly", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch.path, scratch.fs);
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const id = result.envelope.id;
      const path = `.attentioneer/inbox/${id}.json`;
      const raw = JSON.parse(scratch.read(path)!);
      raw.params.text = "the soil warms the rain";
      scratch.write(path, JSON.stringify(raw, null, 2));

      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("applied");
      if (accept.outcome !== "applied") return;
      expect(accept.envelope.params.text).toBe("the soil warms the rain");
      expect(scratch.read(ASSUMPTIONS_FILE)).toContain(
        '{"on":"rain","text":"the soil warms the rain"}\n',
      );
    });
  });

  test("a hand edit that breaks the grammar is refused, and the ghost stays", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch.path, scratch.fs);
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const id = result.envelope.id;
      const path = `.attentioneer/inbox/${id}.json`;
      const raw = JSON.parse(scratch.read(path)!);
      raw.params.text = "   ";
      scratch.write(path, JSON.stringify(raw, null, 2));

      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("refused");
      if (accept.outcome !== "refused") return;
      expect(accept.issues.map((entry) => entry.code)).toContain("params");
      expect(scratch.exists(path)).toBe(true);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        '{"on":"soil","text":"the soil holds water"}\n',
      );
    });
  });

  test("unknown envelope keys and name slots are refused at accept", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch.path, scratch.fs);
      const first = await session.intake(agentReply(), CONTEXT);
      if (!first.envelope) throw new Error("expected an envelope");
      const nameSlotId = first.envelope.id;
      const nameSlotPath = `.attentioneer/inbox/${nameSlotId}.json`;
      const withName = JSON.parse(scratch.read(nameSlotPath)!);
      withName.name = "rain";
      scratch.write(nameSlotPath, JSON.stringify(withName, null, 2));
      const named = await session.accept(nameSlotId, CONTEXT);
      expect(named.outcome).toBe("refused");
      if (named.outcome === "refused") {
        expect(named.issues.map((entry) => entry.code)).toContain("name-slot");
      }

      const second = await session.intake(agentReply(), CONTEXT);
      if (!second.envelope) throw new Error("expected an envelope");
      const unknownId = second.envelope.id;
      const unknownPath = `.attentioneer/inbox/${unknownId}.json`;
      const withExtra = JSON.parse(scratch.read(unknownPath)!);
      withExtra.extra = true;
      scratch.write(unknownPath, JSON.stringify(withExtra, null, 2));
      const unknown = await session.accept(unknownId, CONTEXT);
      expect(unknown.outcome).toBe("refused");
      if (unknown.outcome === "refused") {
        expect(unknown.issues.map((entry) => entry.code)).toContain("unknown-key");
      }
    });
  });

  test("a non-empty proposals sibling is refused: v1 carries no name proposal", async () => {
    await withWorkspace(async (scratch) => {
      const session = openSession(scratch.path, scratch.fs);
      const result = await session.intake(agentReply(), CONTEXT);
      if (!result.envelope) throw new Error("expected an envelope");
      const id = result.envelope.id;
      const path = `.attentioneer/inbox/${id}.json`;
      const raw = JSON.parse(scratch.read(path)!);
      raw.proposals = [{ kind: "name", text: "storm" }];
      scratch.write(path, JSON.stringify(raw, null, 2));
      const accept = await session.accept(id, CONTEXT);
      expect(accept.outcome).toBe("refused");
      if (accept.outcome === "refused") {
        expect(accept.issues.map((entry) => entry.code)).toContain("name-slot");
      }
    });
  });
});

describe("the intake's raw-reply reader (untrusted text, one body)", () => {
  test("the whole reply as JSON is a body", () => {
    const extracted = extractAgentOutput(agentReply());
    expect(extracted.body).not.toBeNull();
    expect(extracted.prose).toBe("");
    expect(extracted.problems).toEqual([]);
  });

  test("a fenced JSON block is found and the prose around it is kept", () => {
    const raw = [
      "Here is the patch I propose:",
      "",
      "```json",
      agentReply(),
      "```",
      "",
      "It adds no names and no records.",
    ].join("\n");
    const extracted = extractAgentOutput(raw);
    expect(extracted.body).not.toBeNull();
    expect(extracted.prose).toContain("Here is the patch I propose:");
    expect(extracted.prose).toContain("It adds no names");
  });

  test("a bare JSON object in prose is found", () => {
    const raw = `The move: ${agentReply()} — please judge it.`;
    const extracted = extractAgentOutput(raw);
    expect(extracted.body).not.toBeNull();
    expect(extracted.prose).toContain("The move:");
  });

  test("a reply with no object has no body, and says so", () => {
    const extracted = extractAgentOutput("I would add an assumption about rain.");
    expect(extracted.body).toBeNull();
    expect(extracted.problems.length).toBe(1);
    expect(extracted.problems[0]).toContain("no patch body");
  });

  test("a JSON array is not a patch body", () => {
    const extracted = extractAgentOutput("[1, 2, 3]");
    expect(extracted.body).toBeNull();
  });

  test("a name key is a name slot, wherever it would sit", () => {
    expect(isNameSlot("name")).toBe(true);
    expect(isNameSlot(" Name ")).toBe(true);
    expect(isNameSlot("slug")).toBe(false);
  });
});
