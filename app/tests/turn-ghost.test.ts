import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  NOT_A_PROPOSAL_SENTENCE,
  PROPOSAL_CAP,
  PROPOSAL_FENCE,
  SECOND_PROPOSAL_SENTENCE,
  readProposal,
  isProposal,
} from "../src/turn/proposal";
import {
  SYSTEM_MESSAGE,
  askTurn,
  askTurnPacket,
  type PacketTurnAnswer,
  type TurnTransport,
} from "../src/turn/turn";
import { parseRequestLine, type SidecarLine } from "../src/turn/protocol";
import type { AskPacket } from "../src/turn/packet";
import {
  createGhostSession,
  type GhostContext,
  type GhostSession,
} from "../src/ghost/session";
import { REFUSAL_PASTE } from "../src/ghost/refusal";
import { ASSUMPTIONS_FILE, MOVES } from "../src/ghost/registry";
import {
  agentReply,
  readFiledEnvelope,
  withWorkspace,
  type Workspace,
} from "./ghost-harness";

/**
 * Epic 15 story 8 — the turn carries the ghost shape.
 *
 * An answer that proposes an edit is scanned into the EXISTING agent body and
 * handed to the EXISTING ghost intake. This file pins the three halves:
 *
 *   1. the scanner (one tagged block, strict, capped, one sentence otherwise);
 *   2. the turn reads it AFTER the answer completes and writes nothing;
 *   3. the ghost path is untouched: a valid body registers exactly one ghost,
 *      an invalid one registers none, the grammar's own sentences refuse an
 *      unregistered move / refused target / wrong game, a rejection is
 *      byte-identical, and an accept writes what a hand-pasted ghost writes.
 *
 * The ghost's seed (two words, one loop, an accepted playing set) is
 * ghost-harness.ts's; the turn is driven by a scripted transport, never a
 * process or a network, so the test is the shipped rule and nothing else.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));
function source(relative: string): string {
  return readFileSync(join(SRC, relative), "utf8");
}

/** Three backticks, spelled without escape puzzles. */
const FENCE = String.fromCharCode(96).repeat(3);

/** Every file under a folder, relative to it, with its bytes. Empty folders
 *  are not files: the inbox's own folder is the disposable part, not a record. */
function treeOf(root: string, base = root): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[full.slice(base.length + 1)] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return files;
}

const CONTEXT: GhostContext = { level: "dynamics", scenario: null };

/** A plain packet: the turn only needs messages and a retrievable set here. */
const PACKET: AskPacket = {
  blocks: [],
  text: "a packet",
  messages: [{ role: "user", content: "a packet" }],
  declaration: { blocks: [], total: 8 },
  retrievable: [],
};

const PROVIDER = { baseUrl: "http://x", model: "m", apiKey: "sk-never-logged" };

/** A scripted transport: the n-th turn answers with the n-th text. */
function scripted(answers: readonly string[]): {
  transport: TurnTransport;
  sent: string[];
} {
  const sent: string[] = [];
  const waiting = new Map<number, (line: SidecarLine) => void>();
  let index = 0;
  const transport: TurnTransport = {
    async send(line: string): Promise<void> {
      sent.push(line);
      const request = parseRequestLine(line);
      if (request === null || request.kind !== "turn") return;
      const text = answers[index] ?? "";
      index += 1;
      setTimeout(() => {
        waiting.get(request.id)?.({
          id: request.id,
          kind: "part",
          part: "text",
          text,
        });
        waiting.get(request.id)?.({ id: request.id, kind: "done" });
      }, 0);
    },
    subscribe(id, handler) {
      waiting.set(id, handler);
      return () => waiting.delete(id);
    },
  };
  return { transport, sent };
}

/** One answer as the app would receive it: prose, then one tagged block. */
function answerWith(body: unknown): string {
  return (
    "Here is one small claim about the pair.\n\n" +
    FENCE + PROPOSAL_FENCE + "\n" +
    JSON.stringify(body, null, 2) +
    "\n" + FENCE + "\n"
  );
}

/** Two tagged blocks in one answer. */
function twoBlocks(first: unknown, second: unknown): string {
  return answerWith(first) + "\n" + FENCE + PROPOSAL_FENCE + "\n" +
    JSON.stringify(second, null, 2) + "\n" + FENCE;
}

/** One vision of the turn: a packet answer, settled. */
async function turned(answer: string): Promise<PacketTurnAnswer> {
  const { transport } = scripted([answer]);
  return askTurnPacket(transport, PROVIDER, PACKET, async () => null);
}

/** Open a session over the harness workspace (the one open moment). */
async function opened(scratch: Workspace): Promise<GhostSession> {
  const session = createGhostSession({
    workspacePath: scratch.path,
    fs: scratch.fs,
  });
  await session.open();
  return session;
}

/** The body of a read that is a proposal (throws otherwise). */
function bodyOf(read: ReturnType<typeof readProposal>): string {
  if (!isProposal(read)) throw new Error("the answer carried no proposal");
  return read.body;
}

/* ------------------------------------------------------------------------- *
 * 1. THE SCANNER — pure: one tagged fence, strict, capped, one sentence.
 * ------------------------------------------------------------------------- */

describe("the scanner: one tagged block, parsed strictly", () => {
  test("a direct agent body is a proposal; its body is handed on as JSON", () => {
    const read = readProposal(answerWith(JSON.parse(agentReply())));
    expect(read.kind).toBe("proposal");
    expect(JSON.parse(bodyOf(read))).toEqual(JSON.parse(agentReply()));
    if (!isProposal(read)) throw new Error("unreachable");
    expect(read.sentence).toBeNull();
  });

  test("the story's wrapper is unwrapped: why stands in for the rationale", () => {
    const read = readProposal(
      answerWith({
        format: "attentioneer-ghost/1",
        game: "dynamics",
        proposal: {
          move: { family: "assumption", verb: "add" },
          target: { kind: "word", slug: "rain" },
          params: { text: "rain follows the soil's temperature" },
        },
        expect: {},
        why: "the pair is on the map with no claim about it",
      }),
    );
    expect(JSON.parse(bodyOf(read))).toEqual({
      move: { family: "assumption", verb: "add" },
      target: { kind: "word", slug: "rain" },
      params: { text: "rain follows the soil's temperature" },
      rationale: "the pair is on the map with no claim about it",
    });
  });

  test("no tagged block is not a proposal: the answer simply stands", () => {
    expect(readProposal("just an answer, no block").kind).toBe("none");
    // Another fence is not this fence.
    expect(
      readProposal(FENCE + "json\n" + JSON.stringify({ move: {} }) + "\n" + FENCE)
        .kind,
    ).toBe("none");
    // An unclosed tagged fence is not a block either.
    expect(readProposal(FENCE + PROPOSAL_FENCE + "\n{}").kind).toBe("none");
  });

  test("malformed, empty and non-object blocks each get the one sentence", () => {
    for (const body of ["{not json", "", "[]", "[1, 2]", '"prose"']) {
      const read = readProposal(FENCE + PROPOSAL_FENCE + "\n" + body + "\n" + FENCE);
      expect({ body, read }).toEqual({
        body,
        read: { kind: "invalid", sentence: NOT_A_PROPOSAL_SENTENCE },
      });
    }
  });

  test("a wrapper with an unknown key is not a proposal", () => {
    const read = readProposal(
      answerWith({
        format: "attentioneer-ghost/1",
        proposal: JSON.parse(agentReply()),
        surprise: true,
      }),
    );
    expect(read).toEqual({ kind: "invalid", sentence: NOT_A_PROPOSAL_SENTENCE });
  });

  test("a block over the cap is refused, not truncated", () => {
    const huge = {
      ...JSON.parse(agentReply()),
      rationale: "x".repeat(PROPOSAL_CAP + 1),
    };
    expect(readProposal(answerWith(huge))).toEqual({
      kind: "invalid",
      sentence: NOT_A_PROPOSAL_SENTENCE,
    });
  });

  test("ONE proposal per answer: the first block stands, the second is ignored", () => {
    const first = JSON.parse(agentReply());
    const second = {
      ...JSON.parse(agentReply()),
      params: { text: "the second claim" },
    };
    const read = readProposal(twoBlocks(first, second));
    expect(read.kind).toBe("proposal");
    expect(JSON.parse(bodyOf(read))).toEqual(first);
    if (!isProposal(read)) throw new Error("unreachable");
    expect(read.sentence).toBe(SECOND_PROPOSAL_SENTENCE);
  });
});

/* ------------------------------------------------------------------------- *
 * 2. THE TURN — the block is read after the answer settles, and nothing more.
 * ------------------------------------------------------------------------- */

describe("the turn reads the proposal after the answer completes", () => {
  test("a settled answer carries the parsed body; a plain one says none", async () => {
    const settled = await turned(answerWith(JSON.parse(agentReply())));
    expect(settled.result.kind).toBe("answer");
    expect(settled.proposal?.kind).toBe("proposal");

    const plain = await turned("just an answer");
    expect(plain.proposal?.kind).toBe("none");

    const bad = await turned(FENCE + PROPOSAL_FENCE + "\n{oops\n" + FENCE);
    expect(bad.proposal).toEqual({
      kind: "invalid",
      sentence: NOT_A_PROPOSAL_SENTENCE,
    });
  });

  test("the turn writes no map record and no file at all", async () => {
    await withWorkspace(async (scratch) => {
      const before = treeOf(scratch.path);
      await turned(answerWith(JSON.parse(agentReply())));
      expect(treeOf(scratch.path)).toEqual(before);
    });
  });

  test("a failed turn carries no proposal", async () => {
    const waiting = new Map<number, (line: SidecarLine) => void>();
    const transport: TurnTransport = {
      async send(line) {
        const request = parseRequestLine(line);
        if (request === null || request.kind !== "turn") return;
        setTimeout(
          () =>
            waiting.get(request.id)?.({
              id: request.id,
              kind: "error",
              message: "the provider broke",
            }),
          0,
        );
      },
      subscribe(id, handler) {
        waiting.set(id, handler);
        return () => waiting.delete(id);
      },
    };
    const result = await askTurnPacket(
      transport,
      PROVIDER,
      PACKET,
      async () => null,
    );
    expect(result.result.kind).toBe("error");
    expect(result.proposal).toEqual({ kind: "none" });
  });
});

/* ------------------------------------------------------------------------- *
 * 3. THE EXISTING GHOST PATH — register, refuse, reject, accept.
 * ------------------------------------------------------------------------- */

describe("a valid proposal is registered through the existing intake", () => {
  test("exactly one ghost appears and no record changes", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const before = treeOf(scratch.path);
      const answer = await turned(answerWith(JSON.parse(agentReply())));
      const intake = await session.intake(bodyOf(answer.proposal ?? { kind: "none" }), CONTEXT);
      expect(intake.ok).toBe(true);
      expect(session.registered()).toHaveLength(1);
      const id = session.registered()[0];
      // The one ghost is the app's envelope, filed in the inbox.
      expect(scratch.exists(".attentioneer/inbox/" + id + ".json")).toBe(true);
      expect(readFiledEnvelope(scratch, id).move).toEqual(MOVES[0].move);
      // No RECORD changed: the assumptions file is byte-identical.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        before[ASSUMPTIONS_FILE] ?? null,
      );
    });
  });

  test("rejecting the ghost leaves the workspace byte-identical", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const before = treeOf(scratch.path);
      const answer = await turned(answerWith(JSON.parse(agentReply())));
      const intake = await session.intake(bodyOf(answer.proposal ?? { kind: "none" }), CONTEXT);
      expect(intake.ok).toBe(true);
      expect(await session.reject(session.registered()[0])).toBe(true);
      // No envelope, no marker, no record: the folder is the one we began with.
      expect(treeOf(scratch.path)).toEqual(before);
    });
  });

  test("accepting writes through the EXISTING path: a hand-made ghost writes the same bytes", async () => {
    let fromTurn = "";
    let seeded = "";
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      seeded = scratch.read(ASSUMPTIONS_FILE) ?? "";
      const answer = await turned(answerWith(JSON.parse(agentReply())));
      await session.intake(bodyOf(answer.proposal ?? { kind: "none" }), CONTEXT);
      const accepted = await session.accept(session.registered()[0], CONTEXT);
      expect(accepted.outcome).toBe("applied");
      fromTurn = scratch.read(ASSUMPTIONS_FILE) ?? "";
      expect(fromTurn).not.toBe(seeded);
    });

    // The same claim, filed by a hand-pasted reply, on a fresh copy.
    await withWorkspace(async (hand) => {
      const pasted = await opened(hand);
      const intake = await pasted.intake(agentReply(), CONTEXT);
      expect(intake.ok).toBe(true);
      const outcome = await pasted.accept(pasted.registered()[0], CONTEXT);
      expect(outcome.outcome).toBe("applied");
      expect(hand.read(ASSUMPTIONS_FILE)).toBe(fromTurn);
    });
  });

  test("an invalid block is one sentence, no ghost, and no file", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const before = treeOf(scratch.path);
      const answer = await turned(FENCE + PROPOSAL_FENCE + "\n{oops\n" + FENCE);
      expect(answer.proposal).toEqual({
        kind: "invalid",
        sentence: NOT_A_PROPOSAL_SENTENCE,
      });
      expect(session.registered()).toHaveLength(0);
      expect(treeOf(scratch.path)).toEqual(before);
    });
  });

  test("two blocks: one ghost, and the second is ignored in one sentence", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const first = JSON.parse(agentReply());
      const second = {
        ...JSON.parse(agentReply()),
        params: { text: "the second claim" },
      };
      const answer = await turned(twoBlocks(first, second));
      const body = bodyOf(answer.proposal ?? { kind: "none" });
      if (!isProposal(answer.proposal ?? { kind: "none" })) {
        throw new Error("unreachable");
      }
      expect(answer.proposal.sentence).toBe(SECOND_PROPOSAL_SENTENCE);
      const intake = await session.intake(body, CONTEXT);
      expect(intake.ok).toBe(true);
      expect(session.registered()).toHaveLength(1);
      expect(scratch.read(ASSUMPTIONS_FILE)).not.toContain("the second claim");
    });
  });
});

describe("the existing sentences refuse what the registry refuses", () => {
  test("an unregistered move is refused in the grammar's words, and no ghost lands", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const read = readProposal(
        answerWith({
          ...JSON.parse(agentReply()),
          move: { family: "assumption", verb: "remove" },
        }),
      );
      const intake = await session.intake(bodyOf(read), CONTEXT);
      expect(intake.ok).toBe(false);
      expect(intake.issues.map((entry) => entry.message)).toContain(
        "assumption/remove is not a registered move",
      );
      expect(session.registered()).toHaveLength(0);
    });
  });

  test("a target kind the move refuses keeps the registry's own sentence", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const read = readProposal(
        answerWith({
          ...JSON.parse(agentReply()),
          target: { kind: "spot", x: 1, y: 2 },
        }),
      );
      const intake = await session.intake(bodyOf(read), CONTEXT);
      expect(intake.ok).toBe(false);
      expect(intake.issues[0]?.message).toBe(
        "a bare spot is not on the map, so the claim's target cannot be checked",
      );
      expect(session.registered()).toHaveLength(0);
    });
  });

  test("the wrong game keeps the grammar's own sentence", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const read = readProposal(answerWith(JSON.parse(agentReply())));
      const intake = await session.intake(bodyOf(read), {
        level: "concept",
        scenario: null,
      });
      expect(intake.ok).toBe(false);
      expect(intake.issues[0]?.message).toBe(
        "assumption/add belongs to the dynamics game; the app is at concept",
      );
      expect(session.registered()).toHaveLength(0);
    });
  });

  test("repeated refusals reach the existing refusal sentence, not a new one", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const read = readProposal(
        answerWith({
          ...JSON.parse(agentReply()),
          move: { family: "assumption", verb: "remove" },
        }),
      );
      const body = bodyOf(read);
      let last = await session.intake(body, CONTEXT);
      for (let index = 0; index < 2; index += 1) {
        last = await session.intake(body, CONTEXT);
      }
      expect(last.ok).toBe(false);
      expect(last.issues[0]?.code).toBe("stop");
      expect(last.issues[0]?.message).toBe(REFUSAL_PASTE);
      // The refusal wrote nothing, and the ghost's own text is untouched.
      expect(session.registered()).toHaveLength(0);
    });
  });
});

/* ------------------------------------------------------------------------- *
 * 4. THE WIRING — the ask surface offers the turn, and shows the sentence.
 * ------------------------------------------------------------------------- */

describe("the ghost ask surface carries the turn", () => {
  test("the app reads the block and hands it to the ONE intake", () => {
    const app = source("App.tsx");
    expect(app).toContain("readProposal(result.text)");
    expect(app).toContain("ghosts.intake(read.body, packet.freeze.hash)");
    expect(app).toContain("onSend={() => void sendGhostPacket()}");
    expect(app).toContain("turnNote={ghostTurnNote}");
  });

  test("the panel offers one send and shows the answer and the sentence", () => {
    const panel = source("canvas/GhostPanel.tsx");
    expect(panel).toContain('className="ghost-send"');
    expect(panel).toContain('className="ghost-answer"');
    expect(panel).toContain("{turnNote !== null && (");
  });

  test("the ghost panel's plain turn sends the instruction and its answer parses", async () => {
    const { transport, sent } = scripted([
      answerWith(JSON.parse(agentReply())),
    ]);
    const result = await askTurn(transport, PROVIDER, "the frozen packet");
    expect(result.kind).toBe("answer");
    const request = parseRequestLine(sent[0] ?? "");
    if (request === null || request.kind !== "turn") {
      throw new Error("no turn left");
    }
    // The model was told the one shape, and the packet was the user message.
    expect(request.messages[0]?.role).toBe("system");
    expect(request.messages[0]?.content).toContain(PROPOSAL_FENCE);
    expect(request.messages[1]).toEqual({
      role: "user",
      content: "the frozen packet",
    });
    expect(readProposal(result.kind === "answer" ? result.text : "").kind).toBe(
      "proposal",
    );
  });

  test("the turn tells the model the one reply shape, without an example block", () => {
    const turn = source("turn/turn.ts");
    expect(turn).toContain("PROPOSAL_FENCE");
    expect(turn).toContain("fenced code block whose language tag is");
    expect(turn).toContain("Write one block at most");
    // No literal example: an echoed sample would scan as a second proposal.
    expect(SYSTEM_MESSAGE).toContain(PROPOSAL_FENCE);
    expect(SYSTEM_MESSAGE).not.toContain(FENCE + PROPOSAL_FENCE);
  });
});
