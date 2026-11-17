import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { utf8ByteLength } from "../src/lib/textBytes";
import {
  ASK_PACKET_BOUND,
  askReachName,
  assembleAskPacket,
  followUpMessages,
  followUpText,
  type AskPacketInput,
} from "../src/turn/packet";
import { askTurnPacket, readNameIn } from "../src/turn/turn";
import {
  parseRequestLine,
  type SidecarLine,
} from "../src/turn/protocol";

/**
 * Story 15.3 — THE PACKET IS THE PROMPT.
 *
 * The packet is PURE assembly (no IO), so these tests pin the whole story's
 * bytes: the golden string, the declaration's sizes, the qualitative bound
 * with no counts anywhere in the text, the unincluded reach that never rides,
 * and the ONE READ follow-up (exactly one, only of a block already sent, only
 * on an exact READ line, never chained).
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

const GOLDEN_INPUT: AskPacketInput = {
  question: "what does this reach say about rain?",
  card: {
    name: "rain",
    state: "the file has changed since this reading",
    reading: "first line\nsecond line",
    note: "my note",
  },
  reaches: [
    { form: "path", value: "notes/x.md", preview: "x first line" },
    { form: "url", value: "https://example.org/chat", preview: null },
    { form: "at", value: "/home/k/p.md", preview: "p first line" },
  ],
  retrievable: [
    "rain",
    "path notes/x.md",
    "at /home/k/p.md",
    "url https://example.org/chat",
    "the bound",
  ],
};

/** The exact bytes, line by line (a golden: they must not drift). */
const GOLDEN = [
  "# a question about one card on an attention map",
  "",
  "## the question",
  "",
  "what does this reach say about rain?",
  "",
  "## rain",
  "",
  "state: the file has changed since this reading",
  "",
  "reading, first lines:",
  "first line",
  "second line",
  "",
  "note, the person's own words, first lines:",
  "my note",
  "",
  "## path notes/x.md",
  "",
  "reading, first lines:",
  "x first line",
  "",
  "## url https://example.org/chat",
  "",
  "a citation only — no preview rides with this reach.",
  "",
  "## at /home/k/p.md",
  "",
  "reading, first lines:",
  "p first line",
  "",
  "## what you may ask for",
  "",
  "This view is one view of a map that is larger than it; it is not the map. Every block above is headed by its own name, exactly as written after the two hashes.",
  "",
  "You may ask for one block in full: write, on a line of its own, exactly",
  "",
  "READ: <name>",
  "",
  "with the name written exactly as the block's heading. Ask for one block at most, and only when you need it. If what you need is not here, do not ask for it: answer from what this view gives you, and say plainly what you could not see.",
  "",
  "## the bound",
  "",
  ASK_PACKET_BOUND,
].join("\n");

/** A scripted transport: it answers the n-th turn with the n-th answer. */
function scripted(answers: readonly string[]) {
  const sent: string[] = [];
  const waiting = new Map<number, (line: SidecarLine) => void>();
  let index = 0;
  const transport = {
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
    subscribe(id: number, handler: (line: SidecarLine) => void) {
      waiting.set(id, handler);
      return () => waiting.delete(id);
    },
  };
  return { transport, sent };
}

const PROVIDER = { baseUrl: "http://x", model: "m", apiKey: "sk-never-logged" };

function oneBlock(): AskPacketInput {
  return {
    question: "what does the card say?",
    card: { name: "rain", state: null, reading: "the card's head", note: null },
    reaches: [{ form: "path", value: "notes/x.md", preview: "x head" }],
    retrievable: ["rain", "path notes/x.md"],
  };
}

describe("the packet's exact bytes (a golden)", () => {
  test("the assembled text is pinned, byte for byte", () => {
    expect(assembleAskPacket(GOLDEN_INPUT).text).toBe(GOLDEN);
  });

  test("the ONE message is the text, verbatim (one user message)", () => {
    const packet = assembleAskPacket(GOLDEN_INPUT);
    expect(packet.messages).toHaveLength(1);
    expect(packet.messages[0]).toEqual({ role: "user", content: packet.text });
  });

  test("the card with a current reading says nothing about its state", () => {
    const packet = assembleAskPacket({
      question: "why",
      card: { name: "rain", state: null, reading: null, note: null },
      reaches: [],
      retrievable: [],
    });
    expect(packet.text).not.toContain("state:");
    expect(packet.text).toContain("no reading and no note ride with this card");
  });
});

describe("the declaration names every block and its size", () => {
  test("each block's declared size is its exact bytes; the total is the message's", () => {
    const packet = assembleAskPacket(GOLDEN_INPUT);
    expect(packet.declaration.blocks).toHaveLength(packet.blocks.length);
    for (const [index, line] of packet.declaration.blocks.entries()) {
      expect(line.kind).toBe(packet.blocks[index].kind);
      expect(line.name).toBe(packet.blocks[index].name);
      expect(line.size).toBe(utf8ByteLength(packet.blocks[index].text));
    }
    expect(packet.declaration.total).toBe(utf8ByteLength(packet.text));
    expect(packet.declaration.total).toBe(
      utf8ByteLength(packet.messages[0].content),
    );
    expect(packet.declaration.blocks.map((line) => line.kind)).toEqual([
      "question",
      "card",
      "reach",
      "reach",
      "reach",
      "instruction",
      "bound",
    ]);
  });

  test("the TEXT carries no counts, token numbers or size figures", () => {
    const packet = assembleAskPacket(GOLDEN_INPUT);
    expect(packet.text).not.toMatch(/\bbytes?\b/i);
    expect(packet.text).not.toMatch(/\btokens?\b/i);
    expect(packet.text).not.toMatch(/\bchars?\b|\bcharacters?\b/i);
    expect(packet.text).not.toMatch(/\bKiB\b|\bkB\b/i);
    // The FIXED prose has no digit at all: the bound is a sentence.
    for (const block of packet.blocks) {
      if (block.kind === "instruction" || block.kind === "bound") {
        expect(block.text).not.toMatch(/[0-9]/);
      }
    }
    expect(packet.text).toContain(ASK_PACKET_BOUND);
  });
});

describe("a reach the person did not include never rides and is never named", () => {
  test("only the included reach's citation and preview are in the bytes", () => {
    const packet = assembleAskPacket({
      question: "why",
      card: { name: "rain", state: null, reading: null, note: null },
      reaches: [{ form: "path", value: "notes/in.md", preview: "in head" }],
      retrievable: [],
    });
    expect(packet.text).toContain("## path notes/in.md");
    expect(packet.text).toContain("in head");
    expect(packet.text).not.toContain("notes/out.md");
    expect(packet.text).not.toContain("out head");
    expect(packet.retrievable).toEqual([]);
  });

  test("the READ set is only blocks that rode, and never a url, an instruction or the bound", () => {
    const packet = assembleAskPacket(GOLDEN_INPUT);
    expect(packet.retrievable).toEqual([
      "rain",
      "path notes/x.md",
      "at /home/k/p.md",
    ]);
    expect(packet.retrievable).not.toContain("the instruction");
    expect(packet.retrievable).not.toContain("the bound");
    expect(packet.retrievable).not.toContain(
      askReachName("url", "https://example.org/chat"),
    );
  });
});

describe("the READ line is exact and single", () => {
  test("only a line of exactly READ: <name> counts", () => {
    expect(readNameIn("an answer\nREAD: rain")).toBe("rain");
    expect(readNameIn("READ: path notes/x.md")).toBe("path notes/x.md");
    expect(readNameIn("  READ: rain  ")).toBe("rain");
    expect(readNameIn("read: rain")).toBeNull();
    expect(readNameIn("I will READ: rain")).toBeNull();
    expect(readNameIn("READ:")).toBeNull();
    expect(readNameIn("READ:  rain")).toBeNull();
    expect(readNameIn("an answer with no request")).toBeNull();
  });

  test("two READ lines are not one request: no follow-up", () => {
    expect(readNameIn("READ: rain\nREAD: notes/x.md")).toBeNull();
  });
});

describe("ONE retrieval, only of a block already sent, never chained", () => {
  test("a READ of a sent block fetches it once and sends exactly one follow-up", async () => {
    const { transport, sent } = scripted([
      "I read the preview.\nREAD: rain",
      "the final answer",
    ]);
    const names: string[] = [];
    const answer = await askTurnPacket(
      transport,
      PROVIDER,
      assembleAskPacket(oneBlock()),
      async (name) => {
        names.push(name);
        return "the card in full";
      },
    );
    expect(names).toEqual(["rain"]);
    expect(sent).toHaveLength(2);
    expect(answer.result).toEqual({ kind: "answer", text: "the final answer" });
    expect(answer.read).toBe("rain");
    expect(answer.missed).toBeNull();
    expect(answer.messages).toHaveLength(2);

    const first = parseRequestLine(sent[0] as string);
    const second = parseRequestLine(sent[1] as string);
    if (
      first === null ||
      first.kind !== "turn" ||
      second === null ||
      second.kind !== "turn"
    ) {
      throw new Error("unreachable");
    }
    expect(first.messages).toEqual(
      assembleAskPacket(oneBlock()).messages,
    );
    expect(second.messages).toHaveLength(2);
    expect(second.messages[1].role).toBe("user");
    expect(second.messages[1].content).toContain("the card in full");
    expect(second.messages[1].content).toContain("no further read is coming");
    expect(second.messages[1].content).not.toMatch(/\bbytes?\b/i);
  });

  test("a READ of a name outside the packet gets NO follow-up", async () => {
    const { transport, sent } = scripted(["READ: some other file"]);
    let fetched = 0;
    const answer = await askTurnPacket(
      transport,
      PROVIDER,
      assembleAskPacket(oneBlock()),
      async () => {
        fetched += 1;
        return "never used";
      },
    );
    expect(fetched).toBe(0);
    expect(sent).toHaveLength(1);
    expect(answer.read).toBeNull();
    expect(answer.missed).toBe("some other file");
    expect(answer.result).toEqual({
      kind: "answer",
      text: "READ: some other file",
    });
  });

  test("a refused/missing read gets no follow-up and the first answer stands", async () => {
    const { transport, sent } = scripted(["READ: path notes/x.md"]);
    const answer = await askTurnPacket(
      transport,
      PROVIDER,
      assembleAskPacket(oneBlock()),
      async () => null,
    );
    expect(sent).toHaveLength(1);
    expect(answer.read).toBeNull();
    expect(answer.missed).toBe("path notes/x.md");
  });

  test("two READ lines, or none, get no follow-up", async () => {
    for (const first of ["no request here", "READ: rain\nREAD: path notes/x.md"]) {
      const { transport, sent } = scripted([first]);
      const answer = await askTurnPacket(
        transport,
        PROVIDER,
        assembleAskPacket(oneBlock()),
        async () => "fuller",
      );
      expect(sent).toHaveLength(1);
      expect(answer.read).toBeNull();
      expect(answer.missed).toBeNull();
    }
  });

  test("the follow-up's SECOND answer is the answer: no chained retrieval", async () => {
    const { transport, sent } = scripted([
      "READ: rain",
      "READ: path notes/x.md",
      "a third answer that never happens",
    ]);
    const answer = await askTurnPacket(
      transport,
      PROVIDER,
      assembleAskPacket(oneBlock()),
      async (name) => "fuller " + name,
    );
    expect(sent).toHaveLength(2);
    expect(answer.read).toBe("rain");
    expect(answer.result).toEqual({
      kind: "answer",
      text: "READ: path notes/x.md",
    });
    expect(answer.messages).toHaveLength(2);
  });

  test("the follow-up's bytes are built by the pure builder (no counts)", () => {
    const messages = followUpMessages(
      [{ role: "user", content: "the packet" }],
      "rain",
      "the whole card",
    );
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({
      role: "user",
      content: followUpText("rain", "the whole card"),
    });
    expect(messages[1].content).not.toMatch(/[0-9]/);
  });
});

describe("the packet module is PURE: no IO, no reader, no writer", () => {
  test("turn/packet.ts imports no fs bridge and holds no reader", () => {
    const code = source("turn/packet.ts");
    for (const forbidden of [
      "lib/fs",
      "@tauri-apps",
      "readTextHead",
      "readTextFile",
      "writeTextFile",
      "node:fs",
    ]) {
      expect({ forbidden, found: code.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
  });
});
