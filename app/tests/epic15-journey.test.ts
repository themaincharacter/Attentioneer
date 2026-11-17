import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clipHead } from "../src/lib/headBounds";
import { utf8ByteLength } from "../src/lib/textBytes";
import { addGroundReference, loadGround, saveGround, type GroundReference } from "../src/map/ground";
import { loadReadingTexts, loadReadings, readingAbsolutePath, readingFor, resolveReadingState, saveReadings, takeReading, type Reading, type ReadingIo } from "../src/map/readings";
import { loadNote, saveNote, type NoteIo } from "../src/map/notes";
import { addPointer, parsePointers, pointersPath, pointerKey, serializePointers, type Pointer } from "../src/map/pointers";
import { parseReference, serializeReference } from "../src/map/refs";
import { mintPrismId, parsePrisms, prismsPath, type Prism } from "../src/map/prisms";
import { abandonAsk, intakeAskResponse, sendAsk, type AskAppSend, type AskContactDeps, type AskPreviews, type AskRequest } from "../src/contacts/ask";
import { readAskContext, type AskCardFacts, type AskContextDeps } from "../src/turn/context";
import { assembleAskPacket, type AskPacket } from "../src/turn/packet";
import { askTurnPacket, type TurnTransport } from "../src/turn/turn";
import { parseRequestLine, type SidecarLine } from "../src/turn/protocol";
import { PROPOSAL_FENCE, isProposal } from "../src/turn/proposal";
import { pullReading } from "../src/map/pull";
import { createGhostSession } from "../src/ghost/session";
import { acceptOpened, intakeReply, NO_GHOSTS, openGhost, rejectOpened, type GhostVerbDeps } from "../src/ghost/verbs";
import { ASSUMPTIONS_FILE } from "../src/ghost/registry";
import { agentReply, withWorkspace } from "./ghost-harness";

/**
 * Epic 15's Evidence at the RECORD layer: "The person asks one question on a
 * reference, reads the answer beside the map, and can say exactly what left
 * and what came back. A cheap model produces one usable response. The app
 * opens and works when the model never answers."
 *
 * The HUMAN half (the panel beside the map) is the queued real-window pass.
 * This file drives the real modules over a real temp workspace; the stand-ins
 * are the filesystem bridge (node:fs behind the injected IO seams) and the
 * model (a scripted transport — no network, no sidecar process). PROVISIONAL:
 * the packet's wording, the "READ:" retrieval and the PRISM fields.
 */
const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-epic15-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const QUESTION = "how does the river-gauge SEASONS-QUESTION-TOKEN read at dusk?";
const ANSWER = "the gauge reads two metres at dusk. SEASONS-ANSWER-TOKEN";
const CARD_NAME = "River gauge";
const CARD_SLUG = "river-gauge";
const REACH = "notes/seasons.md";
const REACH_TEXT = "the seasons turn as the river falls\nwinter holds the water low\n";
const SOURCE_TEXT = "the river falls slowly after the rain\n";
const NOTE = "my own words, not the file's\n";
const PROVIDER = { baseUrl: "http://x", model: "m", apiKey: "sk-never-logged" };

/* --- the test's filesystem bridge: node:fs behind the modules' IO seams --- */

function readTextFile(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}
function writeTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
function readTextHead(path: string, maxLines: number, maxBytes: number) {
  let bytes: Buffer;
  try { bytes = readFileSync(path); } catch {
    return { head: "", truncated: false, exists: false, size: null, mtime: null, decode: "clean" as const };
  }
  const clipped = clipHead(bytes.toString("utf8"), maxLines, maxBytes);
  return {
    head: clipped.head, truncated: clipped.truncated, exists: true,
    size: bytes.length, mtime: Math.floor(statSync(path).mtimeMs), decode: "clean" as const,
  };
}
function readFileBytes(path: string) {
  try { return { kind: "bytes" as const, bytes: new Uint8Array(readFileSync(path)) }; }
  catch { return { kind: "refused" as const, code: "cannot-reach" as const }; }
}
function fileMeta(path: string) {
  try {
    const stat = statSync(path);
    return {
      kind: "facts" as const, exists: true, is_file: stat.isFile(),
      len: stat.isFile() ? stat.size : null, modified_ms: Math.floor(stat.mtimeMs),
    };
  } catch {
    return { kind: "facts" as const, exists: false, is_file: false, len: null, modified_ms: null };
  }
}
const IO: ReadingIo = {
  readTextFile, readTextHead, writeTextFile,
  createDirAll: async (path) => { mkdirSync(path, { recursive: true }); },
  fileMeta, readFileBytes,
  pdfText: async () => { throw new Error("this journey reads no PDFs"); },
};

const NOTE_IO: NoteIo = {
  readTextFile, writeTextFile,
  createDirAll: async (path) => { mkdirSync(path, { recursive: true }); },
  listDir: async (path) => { try { return readdirSync(path); } catch { return []; } },
  removeFile: async (path) => { rmSync(path, { force: true }); },
};

/** The boundary's canonicalizer: the realpath, or null where it cannot answer. */
async function canonicalize(path: string): Promise<string | null> {
  try { return realpathSync(path); } catch { return null; }
}
const CONTEXT_DEPS: AskContextDeps = { readTextHead, canonicalize, pull: pullReading, pullIo: IO };

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

/* --- the one workspace: a real card, a real reading, a note and a reach --- */

interface Arranged {
  ws: string;
  reference: GroundReference;
  reading: Reading;
  pointers: Pointer[];
}
async function arrange(): Promise<Arranged> {
  const ws = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(ws, "map/references"), { recursive: true });
  writeTextFile(join(ws, "notes/river.md"), SOURCE_TEXT);
  writeTextFile(join(ws, REACH), REACH_TEXT);
  // The same Reference on the concept map holds the authored reach; the ground
  // card is the anchor (ADR-0032: a reference may live on either map).
  writeTextFile(join(ws, "map/references", CARD_SLUG + ".md"), serializeReference(parseReference(CARD_SLUG, CARD_SLUG, "")));
  writeTextFile(pointersPath(ws), serializePointers(addPointer([], CARD_SLUG, "path", REACH)));

  const addition = addGroundReference([], CARD_NAME, 120, 240);
  const taken = await takeReading(ws, addition.reference.on, join(ws, "notes/river.md"), IO, new Date().toISOString());
  if (taken.kind !== "taken") throw new Error(taken.message);
  await saveReadings(ws, [taken.reading], [], IO);
  await saveGround(ws, addition.references, [], { readTextFile, writeTextFile });
  await saveNote(ws, addition.reference.on, NOTE, NOTE_IO);

  return {
    ws, reference: addition.reference, reading: taken.reading,
    pointers: parsePointers(readTextFile(pointersPath(ws)) ?? "").pointers,
  };
}

/** The card's facts, loaded from the folder alone (the app's ground load). */
async function cardFacts(arranged: Arranged): Promise<AskCardFacts> {
  const ground = await loadGround(arranged.ws, { readTextFile, writeTextFile });
  const readings = await loadReadings(arranged.ws, IO);
  const texts = await loadReadingTexts(arranged.ws, ground.references.map((reference) => reference.on), IO);
  const reading = readingFor(readings.readings, arranged.reference.on);
  const state = reading === null
    ? "unread"
    : resolveReadingState(reading, await IO.fileMeta(readingAbsolutePath(arranged.ws, reading)), Date.now());
  return {
    name: arranged.reference.name, state, reading,
    readingText: texts[arranged.reference.on] ?? null,
    note: await loadNote(arranged.ws, arranged.reference.on, NOTE_IO),
  };
}

/** The PRISM file's bridges, over the real temp workspace. */
function prismDeps(ws: string, sendApp?: (packet: AskPacket) => Promise<AskAppSend>): AskContactDeps {
  return {
    copy: async () => true, sendApp, handOff: async () => {}, canonicalize, mintId: mintPrismId,
    readPrismsText: async () => readTextFile(prismsPath(ws)),
    writePrismsText: async (text) => writeTextFile(prismsPath(ws), text),
  };
}

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

/** The turn the app's sender runs: the real packet turn over the script. */
async function turned(transport: TurnTransport, packet: AskPacket): Promise<AskAppSend> {
  const answer = await askTurnPacket(transport, PROVIDER, packet, async () => null);
  if (answer.result.kind !== "answer") return { kind: "failed", sentence: answer.result.sentence };
  return {
    kind: "answered", text: answer.result.text, messages: answer.messages,
    read: answer.read, missed: answer.missed, ghost: answer.proposal,
  };
}
function request(arranged: Arranged, transport: "app" | "copy", previews?: AskPreviews): AskRequest {
  const included = arranged.pointers.map((pointer) => ({ form: pointer.form, value: pointer.value }));
  return { on: CARD_SLUG, contact: "ask", pointer: arranged.pointers[0], included, question: QUESTION, transport, workspacePath: arranged.ws, previews };
}
function onePrism(text: string | null): Prism {
  expect(text).not.toBeNull();
  const parsed = parsePrisms(text as string);
  expect(parsed.malformed).toEqual([]);
  expect(parsed.prisms).toHaveLength(1);
  return parsed.prisms[0];
}

describe("the person can say exactly what will leave", () => {
  test("the declaration names every block and its size, and those are the bytes that leave", async () => {
    const arranged = await arrange();
    const included = arranged.pointers.map((pointer) => ({ form: pointer.form, value: pointer.value }));
    const context = await readAskContext({ workspacePath: arranged.ws, card: await cardFacts(arranged), included }, CONTEXT_DEPS);
    const packet = assembleAskPacket({
      question: QUESTION, card: context.card, reaches: context.reaches, retrievable: context.retrievable,
    });

    // BEFORE the send: the blocks, their own byte sizes, and the one total.
    expect(packet.declaration.blocks.map((line) => line.kind)).toEqual(["question", "card", "reach", "instruction", "bound"]);
    expect(packet.declaration.blocks.map((line) => line.name)).toEqual(["the question", CARD_NAME, "path " + REACH, "the instruction", "the bound"]);
    for (const [index, line] of packet.declaration.blocks.entries()) {
      expect(line.size).toBe(utf8ByteLength(packet.blocks[index].text));
    }
    // Byte equality, not "contains": the total IS the one message's bytes.
    expect(packet.messages).toHaveLength(1);
    expect(packet.declaration.total).toBe(utf8ByteLength(packet.text));
    expect(packet.declaration.total).toBe(utf8ByteLength(packet.messages[0].content));

    // What the packet gives the model: the card, its reading, the note, the
    // reach's citation and its bounded preview.
    for (const piece of ["## " + CARD_NAME, "my own words, not the file's", "## path " + REACH, "the seasons turn as the river falls"]) {
      expect(packet.text).toContain(piece);
    }

    const { transport, sent } = scripted(() => ANSWER);
    const sentResult = await sendAsk(
      request(arranged, "app", { card: context.card, reaches: context.reaches, retrievable: context.retrievable }),
      prismDeps(arranged.ws, async (handed) => turned(transport, handed)),
    );
    if (sentResult.kind !== "sent") throw new Error("the question did not leave");

    // The bytes that left are the declared bytes, exactly.
    expect(sentResult.ask.packet).toBe(packet.text);
    expect(sentResult.sentMessages).toEqual(packet.messages);
    const wire = parseRequestLine(sent[0] as string);
    if (wire === null || wire.kind !== "turn") throw new Error("no turn left");
    expect(wire.messages).toEqual(packet.messages);
    expect(wire.messages[0].content).toBe(packet.text);
  });
});

describe("the one PRISM records what left and what came back", () => {
  test("it names the inclusion set and the answer's size, and none of the words", async () => {
    const arranged = await arrange();
    const included = arranged.pointers.map((pointer) => ({ form: pointer.form, value: pointer.value }));
    const context = await readAskContext({ workspacePath: arranged.ws, card: await cardFacts(arranged), included }, CONTEXT_DEPS);
    const { transport } = scripted(() => ANSWER);
    const deps = prismDeps(arranged.ws, async (packet) => turned(transport, packet));
    const sentResult = await sendAsk(
      request(arranged, "app", { card: context.card, reaches: context.reaches, retrievable: context.retrievable }),
      deps,
    );
    if (sentResult.kind !== "sent") throw new Error("the question did not leave");
    // The send itself wrote nothing: the answer is content handed back.
    expect(readTextFile(prismsPath(arranged.ws))).toBeNull();

    const intake = await intakeAskResponse(sentResult.ask, sentResult.answer as string, null, deps);
    if (intake.kind !== "moved") throw new Error("no PRISM landed");
    expect(intake.response).toEqual({ text: ANSWER, size: utf8ByteLength(ANSWER), decode: "clean" });

    const raw = readTextFile(prismsPath(arranged.ws)) as string;
    const prism = onePrism(raw);
    expect(prism.on).toBe(CARD_SLUG);
    expect(prism.contact).toBe("ask");
    expect(prism.pointer).toEqual({ form: "path", value: REACH });
    expect(prism.changes).toHaveLength(1);
    const change = prism.changes[0];
    if (change.kind !== "ask") throw new Error("the change is not an ask");
    expect(change.outcome).toBe("answered");
    expect(change.included).toEqual([pointerKey(CARD_SLUG, "path", REACH)]);
    expect(change.responseSize).toBe(utf8ByteLength(ANSWER));
    expect(change.decode).toBe("clean");

    // The person's words and the model's words appear NOWHERE in the record.
    for (const word of [QUESTION, ANSWER, "SEASONS-QUESTION-TOKEN", "SEASONS-ANSWER-TOKEN", "my own words", "the seasons turn"]) {
      expect({ word, found: raw.includes(word) }).toEqual({ word, found: false });
    }
    // And the record is one line, never a word of content.
    expect(raw.trimEnd().split("\n")).toHaveLength(1);
  });
});

describe("the app works when the model never answers", () => {
  test("a failed transport yields one sentence, writes nothing, and one record when the person ends it", async () => {
    const arranged = await arrange();
    const before = treeOf(arranged.ws);
    const context = await readAskContext({ workspacePath: arranged.ws, card: await cardFacts(arranged), included: [] }, CONTEXT_DEPS);
    // The model's turn fails: the provider's own sentence, as the sidecar words it.
    const waitingError = new Map<number, (line: SidecarLine) => void>();
    const failing: TurnTransport = {
      async send(line) {
        const request = parseRequestLine(line);
        if (request === null || request.kind !== "turn") return;
        setTimeout(() => waitingError.get(request.id)?.({ id: request.id, kind: "error", message: "the provider never answered" }), 0);
      },
      subscribe(id, handler) {
        waitingError.set(id, handler);
        return () => waitingError.delete(id);
      },
    };

    const deps = prismDeps(arranged.ws, async (packet) => turned(failing, packet));
    const sentResult = await sendAsk(
      request(arranged, "app", { card: context.card, reaches: context.reaches, retrievable: context.retrievable }),
      deps,
    );
    if (sentResult.kind !== "sent") throw new Error("the question should be held in flight");
    expect(sentResult.answer).toBeUndefined();
    expect(sentResult.note).toBe("the provider never answered");
    expect(sentResult.note).not.toContain("\n");

    // No record: the question in flight is not a Move, and the map is untouched.
    expect(readTextFile(prismsPath(arranged.ws))).toBeNull();
    expect(treeOf(arranged.ws)).toEqual(before);

    // The person ends the ask: exactly ONE record, saying nothing came back.
    const closed = await abandonAsk(sentResult.ask, deps);
    if (closed.kind !== "moved") throw new Error("no PRISM landed");
    const wrote = treeOf(arranged.ws);
    expect(Object.keys(wrote).filter((path) => !(path in before))).toEqual(["map/prisms.jsonl"]);
    for (const path of Object.keys(before)) expect(wrote[path]).toBe(before[path]);

    const prism = onePrism(readTextFile(prismsPath(arranged.ws)));
    const change = prism.changes[0];
    if (change.kind !== "ask") throw new Error("the change is not an ask");
    expect(change.outcome).toBe("no-response");
    expect({ size: change.responseSize, decode: change.decode }).toEqual({ size: null, decode: null });
    // One record, not two: the failed send appended none of its own.
    expect(parsePrisms(readTextFile(prismsPath(arranged.ws)) as string).prisms).toHaveLength(1);
  });
});

const GHOST_CONTEXT = { level: "dynamics", scenario: null } as const;

describe("a proposal-shaped answer registers a ghost, not a record", () => {
  test("nothing is written until the person accepts, and a rejection is byte-identical", async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const replyText = "one small claim about the pair.\n\n" +
      fence + PROPOSAL_FENCE + "\n" + agentReply() + "\n" + fence + "\n";
    const { transport } = scripted(() => replyText);
    const packet: AskPacket = {
      blocks: [], text: "a packet",
      messages: [{ role: "user", content: "a packet" }],
      declaration: { blocks: [], total: 8 }, retrievable: [],
    };
    const answer = await askTurnPacket(transport, PROVIDER, packet, async () => null);
    if (!isProposal(answer.proposal)) throw new Error("the answer carried no proposal");
    const body = answer.proposal.body;

    await withWorkspace(async (scratch) => {
      const session = createGhostSession({ workspacePath: scratch.path, fs: scratch.fs });
      await session.open();
      const deps: GhostVerbDeps = { session, context: () => GHOST_CONTEXT };
      const before = treeOf(scratch.path);

      const report = await intakeReply(deps, NO_GHOSTS, body);
      expect(report.result.ok).toBe(true);
      expect(report.state.ghosts).toHaveLength(1);
      // The proposal is HELD, not applied: every map record is byte-identical.
      const held = treeOf(scratch.path);
      for (const path of Object.keys(before).filter((entry) => entry.startsWith("map/"))) {
        expect({ path, bytes: held[path] }).toEqual({ path, bytes: before[path] });
      }
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(before[ASSUMPTIONS_FILE] ?? null);
      // Reject through the existing verbs: the folder returns to where it began.
      const opened = openGhost(report.state, report.state.ghosts[0].id);
      const rejected = await rejectOpened(deps, opened);
      expect(rejected.rejected).toBe(true);
      expect(treeOf(scratch.path)).toEqual(before);
    });

    // Accept is the unchanged ghost apply: the map now carries the claim.
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({ workspacePath: scratch.path, fs: scratch.fs });
      await session.open();
      const deps: GhostVerbDeps = { session, context: () => GHOST_CONTEXT };
      const seeded = scratch.read(ASSUMPTIONS_FILE);
      const report = await intakeReply(deps, NO_GHOSTS, body);
      const opened = openGhost(report.state, report.state.ghosts[0].id);
      const accepted = await acceptOpened(deps, opened);
      expect(accepted.outcome?.outcome).toBe("applied");
      expect(scratch.read(ASSUMPTIONS_FILE)).not.toBe(seeded);
    });
  });
});
