import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskCard } from "../src/canvas/AskCard";
import { PacketSurface } from "../src/canvas/PacketSurface";
import {
  askCardOf,
  cardAskContext,
  fetchAskBlock,
  readAskContext,
  type AskCardFacts,
  type AskContextDeps,
} from "../src/turn/context";
import {
  ASK_PACKET_BOUND,
  assembleAskCardPacket,
  assembleCardPacket,
  type AskPacketCard,
} from "../src/turn/packet";
import { ASK_THREAD_BOUND } from "../src/map/asks";
import { askTurnPacket } from "../src/turn/turn";
import {
  parseRequestLine,
  type SidecarLine,
} from "../src/turn/protocol";
import { utf8ByteLength } from "../src/lib/textBytes";
import type { Reading } from "../src/map/readings";

/**
 * Story 15.3b — THE CARD'S ASK USES THE PACKET.
 *
 * The embedded panel is gone (story 17.7); its anchored packet lives on in the
 * ask card. The ask used to send the bare hand-written question while the Ask
 * Move sent the honest packet; one entry point must not be poorer than the
 * other. These tests pin the story's hard constraints:
 *   - the same assembler, ONE anchored block: the card, never a reach, never a
 *     link (a link is wordless wiring, not context);
 *   - the frozen bytes (a golden), with no counts or sizes in the text;
 *   - the declaration's sizes are the bytes' own, and it names every block;
 *   - ONE retrieval, only of the card's own block, on one exact READ line;
 *   - the declaration and readback are ONE shared piece the Ask Move's panel
 *     and the ask card render;
 *   - a folder snapshot proves the bare packet/retrieval path writes nothing
 *     and records nothing; the ask card's own send and its ONE PRISM (17.4)
 *     are tested beside it, in ground-ask-moves.
 *
 * PROVISIONAL: the card packet's golden bytes, the shared surface's layout and
 * the follow-up's wording (the story marks them so).
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** The code without its comments: house-voice prose may name what code may not. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CARD: AskPacketCard = {
  name: "rain",
  state: "the file is gone; this is the copy kept when it was added",
  reading: "first line\nsecond line",
  note: "my note",
};

const QUESTION = "what does this card say about rain?";

/** The exact bytes of the card's packet, line by line (a golden). */
const GOLDEN = [
  "# a question about one card on an attention map",
  "",
  "## the question",
  "",
  QUESTION,
  "",
  "## rain",
  "",
  "state: the file is gone; this is the copy kept when it was added",
  "",
  "reading, first lines:",
  "first line",
  "second line",
  "",
  "note, the person's own words, first lines:",
  "my note",
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

/** A scripted transport: the n-th turn is answered with the n-th string. */
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

function cardPacket(retrievable: readonly string[] = ["rain"]) {
  return assembleCardPacket({ question: QUESTION, card: CARD, retrievable });
}

/* ------------------------------------------------------------------ *
 * THE SAME PACKET, ONE BLOCK
 * ------------------------------------------------------------------ */

describe("the card's packet is the same assembler with ONE block", () => {
  test("the assembled text is pinned, byte for byte", () => {
    expect(cardPacket().text).toBe(GOLDEN);
  });

  test("the card with a current reading says nothing about its state", () => {
    const packet = assembleCardPacket({
      question: "why",
      card: { name: "rain", state: null, reading: "the head", note: null },
      retrievable: ["rain"],
    });
    expect(packet.text).not.toContain("state:");
    expect(packet.text).toContain("## rain");
  });

  test("a card with neither preview says so in one sentence", () => {
    const packet = assembleCardPacket({
      question: "why",
      card: { name: "rain", state: "no reading taken yet", reading: null, note: null },
      retrievable: [],
    });
    expect(packet.text).toContain("no reading and no note ride with this card");
  });

  test("no reach, no link and no other block rides: the card is the only anchor", () => {
    const packet = cardPacket();
    expect(packet.declaration.blocks.map((block) => block.kind)).toEqual([
      "question",
      "card",
      "instruction",
      "bound",
    ]);
    expect(packet.blocks.filter((block) => block.kind === "reach")).toEqual([]);
    expect(packet.text).not.toContain("## path");
    expect(packet.text).not.toContain("## at ");
    expect(packet.text).not.toContain("## url ");
    expect(packet.text).not.toMatch(/\blink\b/i);
  });

  test("the card's ask uses the SAME assembler the Ask Move uses", () => {
    const code = source("turn/packet.ts");
    expect(code).toContain("export function assembleCardPacket");
    expect(code).toContain("function assemblePacket(");
    expect(code).toContain("return assemblePacket(input.question, input.card, [], input.retrievable)");
  });
});

describe("the declaration names the card's blocks and the exact sizes", () => {
  test("each block's size is its bytes; the total is the one message's", () => {
    const packet = cardPacket();
    for (const [index, line] of packet.declaration.blocks.entries()) {
      expect(line.kind).toBe(packet.blocks[index].kind);
      expect(line.size).toBe(utf8ByteLength(packet.blocks[index].text));
    }
    expect(packet.declaration.total).toBe(utf8ByteLength(packet.text));
    expect(packet.declaration.total).toBe(
      utf8ByteLength(packet.messages[0].content),
    );
  });

  test("the TEXT carries no counts, token numbers or size figures", () => {
    const packet = cardPacket();
    expect(packet.text).not.toMatch(/\bbytes?\b/i);
    expect(packet.text).not.toMatch(/\btokens?\b/i);
    expect(packet.text).not.toMatch(/\bchars?\b|\bcharacters?\b/i);
    expect(packet.text).not.toMatch(/\bKiB\b|\bkB\b/i);
    for (const block of packet.blocks) {
      if (block.kind === "instruction" || block.kind === "bound") {
        expect(block.text).not.toMatch(/[0-9]/);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * ONE RETRIEVAL, OF THE CARD'S OWN BLOCK
 * ------------------------------------------------------------------ */

describe("ONE retrieval: the card's own block, never chained", () => {
  test("a READ of the card fetches it once and sends exactly one follow-up", async () => {
    const { transport, sent } = scripted([
      "I read the preview.\nREAD: rain",
      "the final answer",
    ]);
    const names: string[] = [];
    const answer = await askTurnPacket(
      transport,
      PROVIDER,
      cardPacket(),
      async (name) => {
        names.push(name);
        return "the card in full";
      },
    );
    expect(names).toEqual(["rain"]);
    expect(sent).toHaveLength(2);
    expect(answer.read).toBe("rain");
    expect(answer.missed).toBeNull();
    expect(answer.result).toEqual({ kind: "answer", text: "the final answer" });
    expect(answer.messages).toHaveLength(2);
    expect(answer.messages[1].content).toContain("the card in full");

    const first = parseRequestLine(sent[0] as string);
    if (first === null || first.kind !== "turn") throw new Error("unreachable");
    expect(first.messages).toEqual(cardPacket().messages);
  });

  test("a READ of the instruction or the bound gets NO follow-up", async () => {
    for (const asked of ["READ: the instruction", "READ: the bound"]) {
      const { transport, sent } = scripted([asked]);
      let fetched = 0;
      const answer = await askTurnPacket(
        transport,
        PROVIDER,
        cardPacket(),
        async () => {
          fetched += 1;
          return "never used";
        },
      );
      expect(fetched).toBe(0);
      expect(sent).toHaveLength(1);
      expect(answer.read).toBeNull();
      expect(answer.missed).toBe(asked.slice("READ: ".length));
    }
  });

  test("a READ of a reach this view never carried gets NO follow-up", async () => {
    const { transport, sent } = scripted(["READ: path notes/x.md"]);
    let fetched = 0;
    const answer = await askTurnPacket(
      transport,
      PROVIDER,
      cardPacket(),
      async () => {
        fetched += 1;
        return "never used";
      },
    );
    expect(fetched).toBe(0);
    expect(sent).toHaveLength(1);
    expect(answer.read).toBeNull();
    expect(answer.missed).toBe("path notes/x.md");
    expect(answer.result).toEqual({
      kind: "answer",
      text: "READ: path notes/x.md",
    });
  });

  test("a card with no reading has no retrievable block at all", async () => {
    const packet = assembleCardPacket({
      question: QUESTION,
      card: { name: "rain", state: "no reading taken yet", reading: null, note: null },
      retrievable: [],
    });
    expect(packet.retrievable).toEqual([]);
    const { transport, sent } = scripted(["READ: rain"]);
    const answer = await askTurnPacket(
      transport,
      PROVIDER,
      packet,
      async () => "should never be fetched",
    );
    expect(sent).toHaveLength(1);
    expect(answer.read).toBeNull();
    expect(answer.missed).toBe("rain");
  });

  test("two READ lines are not one request: no follow-up, no chain", async () => {
    const { transport, sent } = scripted(["READ: rain\nREAD: the bound"]);
    const answer = await askTurnPacket(
      transport,
      PROVIDER,
      cardPacket(),
      async () => "never used",
    );
    expect(sent).toHaveLength(1);
    expect(answer.read).toBeNull();
    expect(answer.missed).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * THE SHARED DECLARATION AND READBACK
 * ------------------------------------------------------------------ */

describe("the declaration and readback are ONE shared piece", () => {
  test("both ask surfaces render the same PacketSurface; neither keeps a copy", () => {
    const ask = source("canvas/AskPanel.tsx");
    const card = source("canvas/AskCard.tsx");
    for (const panel of [ask, card]) {
      expect(panel).toContain('from "./PacketSurface"');
      expect(panel).toContain("<PacketSurface");
    }
    const surface = source("canvas/PacketSurface.tsx");
    expect(surface).toContain("packetDeclarationWords(");
    expect(surface).toContain("ASK_BYTES_OPEN");
    // The old copies are gone: the two panels cannot drift apart.
    for (const panel of [ask, card]) {
      expect(panel).not.toContain("function AskBytes");
      expect(panel).not.toContain("function AskMessage");
    }
  });

  test("the ask card's declaration and its send share the one packet", () => {
    const card = source("canvas/AskCard.tsx");
    // The card declares the packet it composes; the hook composes the SAME
    // packet at send time from the same anchor facts and thread.
    expect(card).toContain("assembleAskCardPacket(");
    expect(card).toContain("declaration={packet.declaration}");
    expect(card).toContain("messages={packet.messages}");
    expect(card).toContain("onAskTurn(ask.on, asked");
    const hook = source("canvas/useGround.ts");
    expect(hook).toContain("assembleAskCardPacket(");
    expect(hook).toContain("turn.sendPacket(");
    expect(hook).toContain("packet,");
    // No reach, no link and no record path anywhere in the card's CODE.
    const code = codeOnly(card);
    for (const forbidden of [
      "included",
      "links",
      "prism",
      "history",
      "mirror",
      "writeTextFile",
      "contacts/ask",
    ]) {
      expect({ forbidden, found: code.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
  });

  test("the ask card renders the declaration and the bytes verb before send", () => {
    const facts: AskCardFacts = {
      name: CARD.name,
      state: "missing",
      reading: null,
      readingText: CARD.reading,
      note: CARD.note,
    };
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: {
          on: "rain-question",
          name: "Rain question",
          x: 0,
          y: 0,
          anchor: "rain",
        },
        anchorName: CARD.name,
        anchor: askCardOf(facts),
        turns: [],
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onAskTurn: async () => ({ ok: true }),
      }),
    );
    const declaredAt = html.indexOf("will go:");
    const sendAt = html.indexOf("ask-card-send");
    const bytesAt = html.indexOf("the exact bytes");
    expect(declaredAt).toBeGreaterThan(-1);
    expect(bytesAt).toBeGreaterThan(declaredAt);
    expect(sendAt).toBeGreaterThan(bytesAt);
    // The declared total is the packet's own bytes, named exactly once.
    const packet = assembleAskCardPacket(
      askCardOf(facts),
      [],
      "",
      ASK_THREAD_BOUND,
    );
    expect(html).toContain(packet.declaration.total + " bytes in all");
    expect(html).toContain("the card");
    expect(html).toContain(CARD.name);
    const surfaceHtml = renderToStaticMarkup(
      createElement(PacketSurface, {
        declaration: packet.declaration,
        messages: packet.messages,
      }),
    );
    expect(surfaceHtml).toContain("will go:");
    expect(surfaceHtml).toContain("the exact bytes");
  });

  test("the card's context is the card only: no read, no reach, no link", () => {
    const facts: AskCardFacts = {
      name: "rain",
      state: "changed",
      reading: {
        on: "rain",
        form: "path",
        from: "notes/x.md",
        taken: "2026-11-17T00:00:00.000Z",
      },
      readingText: "a\nb\nc\nd\ne\nf\ng",
      note: "my note",
    };
    const context = cardAskContext(facts);
    expect(context.reaches).toEqual([]);
    expect(context.retrievable).toEqual(["rain"]);
    expect(context.sources.map((entry) => entry.name)).toEqual(["rain"]);
    // The reading crop is the card's six lines; the note's is two.
    expect(context.card.reading).toBe("a\nb\nc\nd\ne\nf…");
    expect(context.card.state).toBe(
      "the file has changed since this reading; this is the copy kept when it was added",
    );
  });

  test("the included-reaches reader keeps the card block identical", async () => {
    const facts: AskCardFacts = {
      name: "rain",
      state: null,
      reading: null,
      readingText: "the head",
      note: null,
    };
    const deps: AskContextDeps = {
      readTextHead: async () => ({
        exists: false,
        head: "",
        truncated: false,
        size: null,
        mtime: null,
        decode: "clean",
      }),
      canonicalize: async (path) => path,
      pull: async () => ({ kind: "text", text: "", truncated: false }),
      pullIo: {} as never,
    };
    const read = await readAskContext(
      { workspacePath: "/ws", card: facts, included: [] },
      deps,
    );
    expect(read.card).toEqual(cardAskContext(facts).card);
  });
});

/* ------------------------------------------------------------------ *
 * AN ASK IS NOT A MOVE: THE FOLDER SNAPSHOT
 * ------------------------------------------------------------------ */

function snapshot(
  dir: string,
  base = dir,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = full.slice(base.length + 1);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out[rel + "/"] = "";
      snapshot(full, base, out);
    } else {
      out[rel] = stats.size + ":" + readFileSync(full).toString("base64");
    }
  }
  return out;
}

const workspace = mkdtempSync(join(tmpdir(), "attentioneer-card-ask-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("a card ask writes nothing and records nothing (the folder snapshot)", () => {
  test("the whole card ask path leaves the folder byte-identical", async () => {
    mkdirSync(join(workspace, "map"), { recursive: true });
    mkdirSync(join(workspace, "notes"), { recursive: true });
    writeFileSync(join(workspace, "map", "ground.txt"), "on: rain | name: rain | x: 0 | y: 0\n");
    writeFileSync(join(workspace, "map", "prisms.jsonl"), "");
    writeFileSync(join(workspace, "map", "history.jsonl"), '{"move":"authored"}\n');
    writeFileSync(join(workspace, "map", "mirror.md"), "the mirror before\n");
    writeFileSync(join(workspace, "notes", "x.md"), "the file's first line\nthe second\n");
    const before = snapshot(workspace);

    const reading: Reading = {
      on: "rain",
      form: "path",
      from: "notes/x.md",
      taken: "2026-11-17T00:00:00.000Z",
    };
    const facts: AskCardFacts = {
      name: "rain",
      state: "current",
      reading,
      readingText: "the file's first line",
      note: "my note",
    };
    const context = cardAskContext(facts);
    const packet = assembleCardPacket({
      question: QUESTION,
      card: { ...context.card, name: "rain" },
      retrievable: context.retrievable,
    });
    expect(packet.text).toContain("the file's first line");
    expect(packet.text).toContain("my note");

    // Drive the ONE retrieval through the real context's fetch shape (an
    // injected reader here: the bridge is not available in bun). The card ask
    // path assembles, reads, and answers — and has no writer anywhere.
    const pulled = "the whole file, read once";
    const { transport, sent } = scripted(["READ: rain", "the answer"]);
    const deps: AskContextDeps = {
      readTextHead: async () => ({
        exists: true,
        head: pulled,
        truncated: false,
        size: pulled.length,
        mtime: null,
        decode: "clean",
      }),
      canonicalize: async (path) => path,
      pull: async () => ({ kind: "text", text: pulled, truncated: false }),
      pullIo: {} as never,
    };
    const fetched = await fetchAskBlock(workspace, "rain", context, deps);
    expect(fetched).toBe(pulled);
    const answer = await askTurnPacket(
      transport,
      PROVIDER,
      packet,
      async (name) => fetchAskBlock(workspace, name, context, deps),
    );
    expect(answer.read).toBe("rain");
    expect(sent).toHaveLength(2);

    expect(snapshot(workspace)).toEqual(before);
    expect(existsSync(join(workspace, "map", "prisms.jsonl"))).toBe(true);
    expect(readFileSync(join(workspace, "map", "prisms.jsonl"), "utf8")).toBe("");
  });
});
