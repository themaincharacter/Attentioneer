import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clipHead } from "../src/lib/headBounds";
import type { FileBytesAnswer, FileMetaAnswer, TextHead } from "../src/lib/fs";
import { addGroundReference, groundPath, loadGround, saveGround, serializeGround, type GroundReference } from "../src/map/ground";
import {
  loadReadingTexts, loadReadings, readingAbsolutePath, readingFor, readingStateWord,
  readingTextPath, resolveReadingState, saveReadings, takeReading,
  type Reading, type ReadingIo, type ReadingState,
} from "../src/map/readings";
import { removeGroundRecords } from "../src/canvas/useGround";
import { cardAskContext, fetchAskBlock, type AskCardFacts } from "../src/turn/context";
import { assembleCardPacket } from "../src/turn/packet";
import { askTurnPacket, type TurnTransport } from "../src/turn/turn";
import { parseRequestLine, type SidecarLine } from "../src/turn/protocol";
import { pullReading } from "../src/map/pull";

/**
 * Epic 16's Evidence at the RECORD layer: "A file placed on the ground map
 * still reads after a restart, and a cheap delegate answers from it, names the
 * reference it used, and says so when the context is gone."
 *
 * The HUMAN half (the file dialog, the card's look) is the queued real-window
 * pass. This file drives the real modules over a real temp workspace: the
 * ground and reading record families, the packet assembler, the turn machinery
 * and the pull reader. Two stand-ins, by design: the filesystem bridge
 * (node:fs behind the modules' injected IO seam) and the model (a scripted
 * transport, no network, no process). The scripted delegate sees ONLY the
 * packet's bytes, so it can name the reference only when they carried it.
 *
 * PROVISIONAL: `ground.txt`, `readings.txt`, `map/readings/<slug>.md`, the
 * head's cap and the state words.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-epic16-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const QUESTION = "what does the river gauge say?";
const NAME = "River gauge";
const SOURCE = "notes/river.md";
const SOURCE_TEXT = [
  "the river falls slowly after the rain",
  "the gauge reads two metres at dusk",
  "a second line of evidence for the delegate",
  "",
].join("\n");

/* --- the test's filesystem bridge: node:fs behind the modules' IO seams --- */

const EMPTY_HEAD: TextHead = { head: "", truncated: false, exists: false, size: null, mtime: null, decode: "clean" };

function bytesOf(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

function readTextFile(path: string): string | null {
  return bytesOf(path)?.toString("utf8") ?? null;
}

function writeTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/** The head bridge's answer, with the SAME display-side bound the app applies. */
function readTextHead(path: string, maxLines: number, maxBytes: number): TextHead {
  const bytes = bytesOf(path);
  if (bytes === null) return EMPTY_HEAD;
  const clipped = clipHead(bytes.toString("utf8"), maxLines, maxBytes);
  return {
    head: clipped.head, truncated: clipped.truncated, exists: true,
    size: bytes.length, mtime: Math.floor(statSync(path).mtimeMs), decode: "clean",
  };
}

function readFileBytes(path: string): FileBytesAnswer {
  const bytes = bytesOf(path);
  return bytes === null ? { kind: "refused", code: "cannot-reach" } : { kind: "bytes", bytes: new Uint8Array(bytes) };
}

function fileMeta(path: string): FileMetaAnswer {
  try {
    const stat = statSync(path);
    return { kind: "facts", exists: true, is_file: stat.isFile(), len: stat.isFile() ? stat.size : null, modified_ms: Math.floor(stat.mtimeMs) };
  } catch {
    return { kind: "facts", exists: false, is_file: false, len: null, modified_ms: null };
  }
}

const IO: ReadingIo = {
  readTextFile, readTextHead, writeTextFile,
  createDirAll: async (path) => { mkdirSync(path, { recursive: true }); },
  fileMeta, readFileBytes,
  pdfText: async () => { throw new Error("this journey reads no PDFs"); },
};

const GROUND_IO = { readTextFile, writeTextFile };

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

/* --- the journey's records, written the way the app writes them --- */

interface Placed {
  ws: string;
  reference: GroundReference;
  reading: Reading;
  text: string;
  /** The moment the head was taken (captured after the file was written). */
  taken: string;
}

async function place(): Promise<Placed> {
  const ws = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(ws, "map"), { recursive: true });
  writeTextFile(join(ws, SOURCE), SOURCE_TEXT);
  const addition = addGroundReference([], NAME, 120, 240);
  const taken = await takeReading(ws, addition.reference.on, join(ws, SOURCE), IO, new Date().toISOString());
  if (taken.kind !== "taken") throw new Error(taken.message);
  // The app's order: the reading's text (takeReading wrote it) and line first,
  // the ground line last.
  await saveReadings(ws, [taken.reading], [], IO);
  await saveGround(ws, addition.references, [], IO);
  return { ws, reference: addition.reference, reading: taken.reading, text: taken.text, taken: taken.reading.taken };
}

interface Reopened {
  ground: Awaited<ReturnType<typeof loadGround>>;
  readings: Awaited<ReturnType<typeof loadReadings>>;
  texts: Record<string, string>;
  reading: Reading | null;
  state: ReadingState;
  word: string | null;
}

/** Quit, then reopen from the folder alone: every record read from disk. */
async function reopen(placed: Placed): Promise<Reopened> {
  const ground = await loadGround(placed.ws, GROUND_IO);
  const readings = await loadReadings(placed.ws, IO);
  const texts = await loadReadingTexts(placed.ws, ground.references.map((reference) => reference.on), IO);
  const reading = readingFor(readings.readings, placed.reference.on);
  const state = reading === null
    ? "unread"
    : resolveReadingState(reading, await IO.fileMeta(readingAbsolutePath(placed.ws, reading)), Date.now());
  return { ground, readings, texts, reading, state, word: readingStateWord(state) };
}

/** The card facts the ground layer hands the packet (no new IO). */
function factsOf(placed: Placed, view: Reopened): AskCardFacts {
  return {
    name: placed.reference.name,
    state: view.state,
    reading: view.reading,
    readingText: view.texts[placed.reference.on] ?? null,
    note: null,
  };
}

const PROVIDER = { baseUrl: "http://x", model: "m", apiKey: "sk-never-logged" };

/** A scripted turn: the test's model, which sees only the packet's messages. */
function scripted(reply: (userTurn: string, index: number) => string) {
  const sent: string[] = [];
  const waiting = new Map<number, (line: SidecarLine) => void>();
  let index = 0;
  const transport: TurnTransport = {
    async send(line: string): Promise<void> {
      sent.push(line);
      const request = parseRequestLine(line);
      if (request === null || request.kind !== "turn") return;
      const userTurn = request.messages[request.messages.length - 1]?.content ?? "";
      const text = reply(userTurn, index);
      index += 1;
      setTimeout(() => {
        waiting.get(request.id)?.({ id: request.id, kind: "part", part: "text", text });
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

/** The one retrieval's deps: the real pull reader over the same node bridge. */
function readDeps() {
  return {
    readTextHead,
    canonicalize: async () => null,
    pull: pullReading,
    pullIo: IO,
  };
}

/* --- 1. The restart --- */

describe("a file on the ground map survives a restart", () => {
  test("the reference, its reading and its state are still there after a reopen", async () => {
    const placed = await place();
    const view = await reopen(placed);

    expect(view.ground.malformed).toEqual([]);
    expect(view.ground.references).toEqual([placed.reference]);
    expect(view.ground.references[0].name).toBe(NAME);
    expect(view.ground.references[0].on).toBe(placed.reference.on);
    expect(view.ground.references[0].x).toBe(120);
    expect(view.ground.references[0].y).toBe(240);

    // The reading line is what the app wrote, byte for byte; its text is the
    // file's opening lines as read.
    expect(view.readings.malformed).toEqual([]);
    expect(view.readings.readings).toHaveLength(1);
    expect(view.readings.readings[0].from).toBe(SOURCE);
    expect(view.readings.readings[0].form).toBe("path");
    expect(view.readings.readings[0].taken).toBe(placed.taken);
    expect(view.readings.readings[0].bytes).toBe(Buffer.byteLength(SOURCE_TEXT));
    expect(view.texts[placed.reference.on]).toBe(SOURCE_TEXT);

    // The state is COMPUTED from metadata at load, never stored: a file whose
    // size and time agree reads current and says nothing.
    expect(view.state).toBe("current");
    expect(view.word).toBeNull();

    // The folder is the whole truth: the records re-serialize to their bytes.
    expect(readFileSync(groundPath(placed.ws), "utf8")).toBe(serializeGround(view.ground.references));
    expect(readFileSync(readingTextPath(placed.ws, placed.reference.on), "utf8")).toBe(SOURCE_TEXT);
  });

  test("reopening reads only: the folder is byte-identical before and after", async () => {
    const placed = await place();
    const before = treeOf(placed.ws);
    await reopen(placed);
    expect(treeOf(placed.ws)).toEqual(before);
  });
});

/* --- 2. The delegate answers from the reading --- */

describe("a delegate answers from the card and names the reference", () => {
  test("the packet carries the reading and the answer names the reference it used", async () => {
    const placed = await place();
    const view = await reopen(placed);
    const context = cardAskContext(factsOf(placed, view));
    const packet = assembleCardPacket({ question: QUESTION, card: context.card, retrievable: context.retrievable });

    // The packet GIVES the delegate the card's heading and its opening lines.
    expect(packet.text).toContain("## " + NAME);
    expect(packet.text).toContain("the river falls slowly after the rain");
    expect(packet.retrievable).toEqual([NAME]);

    const { transport, sent } = scripted((userTurn, index) => {
      if (index === 0) {
        // The preview is not enough: ask for the one block the packet offers.
        expect(userTurn).toContain("the river falls slowly after the rain");
        return "I need the whole card.\nREAD: " + NAME;
      }
      // The follow-up carries the fuller text: answer from it, and name it.
      expect(userTurn).toContain("the gauge reads two metres at dusk");
      return "The " + NAME + " says the gauge reads two metres at dusk.";
    });

    const answered = await askTurnPacket(transport, PROVIDER, packet, async (name) =>
      fetchAskBlock(placed.ws, name, context, readDeps()),
    );

    expect(answered.read).toBe(NAME);
    expect(answered.missed).toBeNull();
    expect(sent).toHaveLength(2);
    if (answered.result.kind !== "answer") throw new Error("expected an answer");
    expect(answered.result.text).toContain(NAME);
    expect(answered.result.text).toContain("the gauge reads two metres at dusk");

    // What left was the packet, verbatim: no reach, no link, one anchored card.
    const first = parseRequestLine(sent[0] as string);
    if (first === null || first.kind !== "turn") throw new Error("no turn left");
    expect(first.messages).toEqual(packet.messages);
  });

  test("the questions and the read leave the folder byte-identical", async () => {
    const placed = await place();
    const view = await reopen(placed);
    const context = cardAskContext(factsOf(placed, view));
    const packet = assembleCardPacket({ question: QUESTION, card: context.card, retrievable: context.retrievable });
    const before = treeOf(placed.ws);

    const { transport } = scripted((_turn, index) => (index === 0 ? "READ: " + NAME : "the answer"));
    await askTurnPacket(transport, PROVIDER, packet, async (name) => fetchAskBlock(placed.ws, name, context, readDeps()));

    // The turn, the retrieval and the pull write nothing: no mirror, no
    // history, no reading re-stamp.
    expect(treeOf(placed.ws)).toEqual(before);
  });
});

/* --- 3. The context is gone: the delegate says so --- */

describe("with the reference removed the delegate says it has nothing", () => {
  test("the same question gets 'nothing to draw on' instead of an invented answer", async () => {
    const placed = await place();
    const removed = await removeGroundRecords(
      placed.ws, placed.reference.on, [placed.reference], [placed.reading], [], [],
      {
        saveGround: (workspace, references, malformed) => saveGround(workspace, references, malformed, GROUND_IO),
        saveReadings: (workspace, readings, malformed) => saveReadings(workspace, readings, malformed, IO),
        removeFile: async (path) => { rmSync(path, { force: true }); },
      },
    );
    expect(removed.refusal).toBeNull();

    const view = await reopen(placed);
    expect(view.ground.references).toEqual([]);
    expect(view.readings.readings).toEqual([]);
    expect(view.texts).toEqual({});
    expect(view.state).toBe("unread");
    expect(view.word).toBe("no reading taken yet");

    // The anchor carries nothing: the packet says so in one sentence and
    // offers no block to fetch.
    const context = cardAskContext({ name: NAME, state: "unread", reading: null, readingText: null, note: null });
    const packet = assembleCardPacket({ question: QUESTION, card: context.card, retrievable: context.retrievable });
    expect(packet.retrievable).toEqual([]);
    expect(packet.text).toContain("no reading and no note ride with this card");
    expect(packet.text).not.toContain("the river falls slowly after the rain");

    const { transport, sent } = scripted((userTurn) => {
      // The model is handed no reading: it can say nothing about the source.
      expect(userTurn).not.toContain("the gauge reads two metres at dusk");
      return "I have nothing to draw on: the map no longer carries that reference.";
    });
    const answered = await askTurnPacket(transport, PROVIDER, packet, async (name) => {
      throw new Error("nothing should be fetched, asked for " + name);
    });

    expect(sent).toHaveLength(1);
    expect(answered.read).toBeNull();
    if (answered.result.kind !== "answer") throw new Error("expected an answer");
    expect(answered.result.text).toContain("nothing to draw on");
    expect(answered.result.text).not.toContain("the gauge reads two metres");
  });
});
