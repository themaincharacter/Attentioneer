import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIGEST_MAX_BYTES,
  DIGEST_MAX_CARDS,
  DIGEST_OMITTED_SENTENCE,
  mapDigest,
  type MapDigestInput,
} from "../src/turn/curatorDigest";
import {
  CURATOR_CAP_CLAIM_CHARS,
  CURATOR_CAP_CLAIM_SENTENCES,
  CURATOR_CAP_FIELD_CHARS,
  CURATOR_CAP_FIELD_ITEMS,
  CURATOR_CAP_TITLE_CHARS,
  CURATOR_FENCE,
  CURATOR_OVERLONG_SENTENCE,
  buildCuratorMessages,
  cardOverLength,
  curatorPrompt,
  readCuratorAnswer,
  type CuratorCard,
} from "../src/turn/curator";
import { askTurnCardNote } from "../src/canvas/useGround";

/**
 * STORY 17.14 — the curator compresses, and knows the map.
 *
 * The human's check is two questions on the same reference with a verbose
 * model: each card is short, neither restates the question or the reply, and a
 * trivial answer is declined in one sentence with no card. This file pins the
 * rules underneath:
 *
 *   - the map digest rides the prompt, names the map's cards, and carries NO
 *     reading body (the builder has no text input, and the hook hands it none);
 *   - the digest is bounded by a card count and a byte cap, drops WHOLE entries
 *     and says so in one qualitative sentence;
 *   - each per-field cap is ENFORCED by the parser: over it is malformed, one
 *     sentence, no card;
 *   - a short card still parses, and the decline stays legal.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

const QUESTION = "When does the tide turn, and will the gate hold?";
const REPLY =
  "The tide turns around six. The harbor master says the gate may not open then, so six might not apply on a spring tide.";

/** A reading body that must never reach the prompt. */
const READING_BODY = "SENTINEL-READING-BODY: high water at 05:52, low at 12:08";
const NOTE_BODY = "SENTINEL-NOTE-BODY: ask the harbor master about the gate";

function reference(on: string, name: string) {
  return { on, name, x: 0, y: 0 };
}

function reading(
  on: string,
  from: string,
  extra: { form?: "path" | "url" | "distilled"; extract?: "text" | "page" | "image" | "video" | "pdf" } = {},
) {
  return {
    on,
    form: extra.form ?? ("path" as const),
    from,
    taken: "2026-11-18T12:00:00.000Z",
    ...(extra.extract === undefined ? {} : { extract: extra.extract }),
  };
}

function fixtures(over: Partial<MapDigestInput> = {}): MapDigestInput {
  return {
    anchorSlug: "tide-question",
    anchorKind: "ask",
    wired: ["tide-table", "harbor-notice"],
    references: [
      reference("tide-table", "tide table"),
      reference("harbor-notice", "harbor notice"),
      reference("moon-card", "moon card"),
      // The artifact card that the distilled reading below points back to.
      reference("earlier-artifact", "earlier artifact"),
    ],
    asks: [
      { on: "tide-question", name: "Tide question", x: 0, y: 0 },
      { on: "gate-question", name: "Gate question", x: 0, y: 0 },
    ],
    askTurns: {
      "gate-question": [
        { role: "person", text: "does the gate hold at six", t: "t" },
        { role: "answer", text: "SENTINEL-ANSWER-BODY: the gate holds", t: "t" },
      ],
    },
    sessions: [{ on: "run-card", name: "Run card", x: 0, y: 0, tool: "dsh" }],
    readings: [
      reading("tide-table", "/workspace/map/sources/tide.md"),
      reading("harbor-notice", "https://harbor.example/notice", { form: "url", extract: "page" }),
      reading("moon-card", "/workspace/map/sources/moon.png", { extract: "image" }),
      // THE ARTIFACT already made from this ask: its provenance is this card.
      reading("earlier-artifact", "card://tide-question", { form: "distilled" }),
    ],
    ...over,
  };
}

describe("the map digest rides the prompt and carries no reading body", () => {
  test("the prompt carries the digest, the reply and the question", () => {
    const digest = mapDigest(fixtures());
    const prompt = curatorPrompt({ question: QUESTION, reply: REPLY, digest });
    expect(prompt).toContain("## the map digest");
    expect(prompt).toContain(QUESTION);
    expect(prompt).toContain(REPLY);
    expect(prompt).toContain(digest);
    // The cards are NAMED, with a kind and a one-line about — from the record's
    // own line, never from a reading's text.
    expect(digest).toContain('"tide table" — reference — a file, tide.md');
    expect(digest).toContain('"harbor notice" — reference — a page at harbor.example');
    expect(digest).toContain('"moon card" — reference — an image, moon.png');
    expect(digest).toContain('"Tide question" — ask — the ask being distilled now');
    expect(digest).toContain('"Run card" — session — a run with dsh');
    // The relations are said: what is wired in, and what was already made.
    expect(digest).toContain("(wired into this ask)");
    expect(digest).toContain("(made from this ask)");
    // And the negative is not vacuous: the bodies exist in the fixture's world
    // but cannot ride, because no argument carries a text or a note at all.
    expect(digest).not.toContain(READING_BODY);
    expect(digest).not.toContain(NOTE_BODY);
    expect(digest).not.toContain("SENTINEL-ANSWER-BODY");
    expect(prompt).not.toContain(READING_BODY);
    expect(prompt).not.toContain("SENTINEL-ANSWER-BODY");
  });

  test("the builder and its call site have no reading-text input to leak", () => {
    const builder = source("turn/curatorDigest.ts");
    // No text map, no note, no reading body: the only reading-shaped input is
    // the READING LINE (form + from), which is what the one line is built from.
    expect(builder).not.toContain("texts");
    expect(builder).not.toContain("notes");
    expect(builder).not.toContain("readingText");
    // The hook's composition passes records and reading LINES, never the loaded
    // texts or notes maps that sit right beside them.
    const hook = source("canvas/useGround.ts");
    const at = hook.indexOf("mapDigest({");
    expect(at).toBeGreaterThan(-1);
    const call = hook.slice(at, hook.indexOf("})", at) + 2);
    expect(call).not.toContain("textsRef");
    expect(call).not.toContain("notesRef");
    expect(call).not.toContain("readingText");
    expect(source("turn/curator.ts")).not.toContain("readingText");
  });

  test("the prompt states the brevity limits and the decline stance", () => {
    const prompt = curatorPrompt({ question: QUESTION, reply: REPLY, digest: mapDigest(fixtures()) });
    expect(prompt).toContain("at most two sentences");
    expect(prompt).toContain("at most three short items");
    expect(prompt).toContain("Do NOT restate the question");
    expect(prompt).toContain("Do NOT open with a preamble");
    expect(prompt).toContain("Do NOT end with a hedge");
    // The amendment's stance, in the prompt: returned is not the same as worth
    // keeping, and without a language game the digest is the only guide.
    expect(prompt).toContain("A returned answer is not automatically worth keeping");
    expect(prompt).toContain("there is no language game here yet, so the digest below is the only guide");
    expect(prompt).toContain("DECLINE IS THE DEFAULT");
    expect(prompt).toContain("ONE sentence saying why");
  });

  test("the digest is bounded and says so when it omits, whole entries only", () => {
    const many = Array.from({ length: DIGEST_MAX_CARDS + 12 }, (_, index) =>
      reference("card-" + index, "card number " + index),
    );
    const digest = mapDigest(
      fixtures({ references: many, readings: [], wired: [], asks: [], sessions: [] }),
    );
    const lines = digest.split("\n");
    expect(lines.length).toBeLessThanOrEqual(DIGEST_MAX_CARDS + 1);
    expect(lines[lines.length - 1]).toBe(DIGEST_OMITTED_SENTENCE);
    for (const line of lines.slice(0, -1)) {
      expect(line.startsWith("- ")).toBe(true);
      expect(line).toContain(" — reference — ");
    }
  });

  test("the byte cap cuts whole entries and never clips a name", () => {
    const long = "z".repeat(DIGEST_MAX_BYTES);
    const digest = mapDigest(
      fixtures({
        references: [reference("first", "the first card"), reference("huge", long)],
        readings: [],
        wired: [],
        asks: [],
        sessions: [],
      }),
    );
    const lines = digest.split("\n");
    expect(lines[0]).toContain('"the first card"');
    expect(lines[lines.length - 1]).toBe(DIGEST_OMITTED_SENTENCE);
    // No fragment of the oversized name rode: whole entries only.
    expect(digest).not.toContain("zzzz");
  });
});

const CARD: CuratorCard = {
  title: "The tide turns at six",
  claim: "The tide turns around six, and the gate may stay shut.",
  restsOn: "the harbor master's account in the reply.",
  doesNotCover: "the second gate, and spring tides in general.",
  uncertainty: "the reply says the gate may not open on a spring tide.",
};

function cardBlock(card: Partial<CuratorCard> = {}): string {
  const merged = { ...CARD, ...card };
  const body = {
    title: merged.title,
    claim: merged.claim,
    "rests on": merged.restsOn,
    "does not cover": merged.doesNotCover,
    uncertainty: merged.uncertainty,
  };
  return "here is the card.\n\n```" + CURATOR_FENCE + "\n" + JSON.stringify(body, null, 2) + "\n```\n";
}

describe("a long card is a bug: the per-field caps are enforced", () => {
  const over: Array<[string, Partial<CuratorCard>]> = [
    ["title", { title: "z".repeat(CURATOR_CAP_TITLE_CHARS + 1) }],
    ["a two-line title", { title: "the tide\nturns at six" }],
    [
      "claim sentences",
      { claim: "One. Two. Three. " + "x".repeat(0) },
    ],
    ["claim chars", { claim: "a".repeat(CURATOR_CAP_CLAIM_CHARS + 1) }],
    ["rests on items", { restsOn: "a; b; c; d" }],
    ["rests on chars", { restsOn: "a".repeat(CURATOR_CAP_FIELD_CHARS + 1) }],
    ["does not cover items", { doesNotCover: "a\nb\nc\nd" }],
    ["uncertainty items", { uncertainty: "one; two; three; four" }],
  ];

  for (const [label, patch] of over) {
    test("an over-long " + label + " is malformed, with one sentence and no card", () => {
      const card = { ...CARD, ...patch };
      expect(cardOverLength(card)).toBe(true);
      const read = readCuratorAnswer(cardBlock(patch), REPLY);
      expect(read.kind).toBe("invalid");
      if (read.kind === "invalid") {
        expect(read.sentence).toBe(CURATOR_OVERLONG_SENTENCE);
      }
      expect(CURATOR_OVERLONG_SENTENCE).toContain("length");
      expect(CURATOR_OVERLONG_SENTENCE).toContain("no card was made");
    });
  }

  test("a short card inside every cap still parses", () => {
    expect(cardOverLength(CARD)).toBe(false);
    expect(CURATOR_CAP_CLAIM_SENTENCES).toBe(2);
    expect(CURATOR_CAP_FIELD_ITEMS).toBe(3);
    const read = readCuratorAnswer(cardBlock(), REPLY);
    expect(read.kind).toBe("card");
  });
});

describe("decline is the default and makes no card", () => {
  test("a one-sentence decline is legal, and the reply keeps its sentence", () => {
    const sentence = "nothing here the map can use: it repeats the question and adds no claim.";
    const read = readCuratorAnswer(sentence, REPLY);
    expect(read.kind).toBe("declined");
    if (read.kind !== "declined") return;
    expect(read.sentence).toBe(sentence);
    // No card: the ask card's one line says the decline, and the reply stands.
    const note = askTurnCardNote({
      result: { kind: "answer", text: REPLY },
      ending: "answered",
      left: true,
      reached: null,
      missed: null,
      curator: {
        left: true,
        ending: "answered",
        manager: "manager-small",
        task: "task-big",
        raw: sentence,
        read,
        sentence: null,
      },
    });
    expect(note).toBe(sentence);
    // The hook's writer is gated on the curator having made a card.
    const hook = source("canvas/useGround.ts");
    expect(hook).toContain("if (noCard === null)");
    expect(hook.indexOf("if (noCard === null)")).toBeLessThan(
      hook.indexOf("await writeDistilledCard("),
    );
  });
});

describe("the digest is prompt material only", () => {
  test("the hook composes it at the call and records nothing", () => {
    const hook = source("canvas/useGround.ts");
    expect(hook).toContain("buildCuratorMessages({ question, reply, digest })");
    expect(hook).toContain("mapDigest({");
    // No writer, no queue, no state: the digest's only use is the prompt.
    const at = hook.indexOf("mapDigest({");
    const call = hook.slice(at, hook.indexOf("})", at) + 2);
    expect(call).not.toContain("save");
    expect(call).not.toContain("queue");
    expect(hook).not.toContain("digestRef");
    expect(hook).not.toContain("state.digest");
  });
});
