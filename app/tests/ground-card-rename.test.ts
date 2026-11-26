import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CardNamePill,
  REFERENCE_PILL_RULES,
  pillCounterScale,
  pillRenameOutcome,
} from "../src/canvas/CardNamePill";
import { GroundLayer } from "../src/canvas/GroundLayer";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  ASK_UNTITLED_NAME,
  askDisplayName,
  askNameForCreate,
  askNameForWrite,
  parseAsks,
  renameAsk,
  saveAsks,
  serializeAskLine,
  type AskCard as AskCardRecord,
} from "../src/map/asks";
import {
  SESSION_UNTITLED_NAME,
  parseSessions,
  renameSession,
  saveSessions,
  serializeSessionLine,
  sessionDisplayName,
  sessionNameForWrite,
  type SessionCard as SessionCardRecord,
} from "../src/map/sessions";
import {
  GROUND_UNTITLED_NAME,
  UNTITLED_DISPLAY,
  groundDisplayName,
  groundNameForWrite,
  type GroundReference,
} from "../src/map/ground";
import {
  CARD_RENAME_KINDS,
  appendEvent,
  appendEvents,
  cardRenameEvent,
  historyPath,
  isCardRenameKind,
  parseHistory,
  parseHistoryEvent,
  readHistory,
  serializeHistoryEvent,
} from "../src/map/history";
import { renderMirror, type MirrorView } from "../src/map/mirror";
import type { MirrorView as _View } from "../src/map/mirror";

/**
 * STORY 16.22 — EVERY CARD HAS A NAME, AND EVERY RENAME IS REMEMBERED.
 *
 * The story's check is human ("zoom to 25%: all three kinds show their names;
 * double-click a session card's name and change it: the record changes, MAP.md
 * follows on the next rewrite, and the log gains one line; renaming twice logs
 * twice and never rewrites an earlier line") and needs a window. This file pins
 * what can be pinned without one:
 *
 *   - all THREE kinds wear the SAME pill (one component, one counter-scale),
 *     and each kind keeps its OWN write rules: a reference's blank field
 *     stores "Untitled reference", a session's stores "Untitled session", and
 *     an ask's blank RENAME is a REFUSAL that writes nothing at all (its
 *     creation takes the "Untitled ask" sentinel). The pill SHOWS one quiet
 *     line — "no name yet" — for a blank name or a family's untitled sentence;
 *   - a committed rename emits exactly ONE `card.rename` line naming the
 *     family, the slug and BOTH names — never content — and a same-name commit
 *     or an abandoned rename emits none;
 *   - two renames are two lines in order, and the log stays append-only;
 *   - MAP.md shows the new name on the next rewrite, all three sections;
 *   - the drag rule stays the layer's one call site, and the ground map still
 *     renders no map content family.
 */

const APP_DIR = new URL("..", import.meta.url).pathname;
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const PILL = source("canvas/CardNamePill.tsx");
const LAYER = source("canvas/GroundLayer.tsx");
const ASK_CARD = source("canvas/AskCard.tsx");
const SESSION_CARD = source("canvas/SessionCard.tsx");
const DRAG = source("canvas/groundDrag.ts");
const HOOK = source("canvas/useGround.ts");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-card-rename-"));

describe("three kinds, one pill, each family's own rules", () => {
  test("the reference, the ask and the session card all wear the pill", () => {
    // ONE component (one counter-scale, one handle, one rename field) is
    // rendered by all three cards: there is no second name surface to keep in
    // step, and none of them draws a `ground-pill` of its own.
    expect(LAYER).toContain("<CardNamePill");
    expect(ASK_CARD).toContain("<CardNamePill");
    expect(SESSION_CARD).toContain("<CardNamePill");
    for (const card of [ASK_CARD, SESSION_CARD]) {
      expect(card).not.toContain('className="ground-pill"');
      expect(card).not.toContain('className="ground-name"');
      expect(card).not.toContain("pillCounterScale");
    }
    // The pill exports exactly one component, so a fork would show up here.
    expect(PILL.split("export function CardNamePill").length - 1).toBe(1);
  });

  test("the layer hands every card the plane's own zoom", () => {
    // The counter-scale is the pill's, fed the camera's value each card already
    // has; no card re-derives a transform.
    const at = LAYER.indexOf("<AskCard");
    expect(at).toBeGreaterThan(-1);
    const ask = LAYER.slice(at, at + 2400);
    expect(ask).toContain("zoom={zoom}");
    const session = LAYER.slice(
      LAYER.indexOf("<SessionCardView"),
      LAYER.indexOf("<SessionCardView") + 2400,
    );
    expect(session).toContain("zoom={zoom}");
    expect(pillCounterScale(0.25)).toBe(4);
  });

  test("the write rules are three different rules; the showing is one quiet line", () => {
    // REFERENCE: a blank field is a legal name and stores the sentence.
    expect(groundNameForWrite("  ")).toBe(GROUND_UNTITLED_NAME);
    expect(GROUND_UNTITLED_NAME).toBe("Untitled reference");
    // SESSION: the same shape, its own words (new in this story).
    expect(sessionNameForWrite("   ")).toBe(SESSION_UNTITLED_NAME);
    expect(SESSION_UNTITLED_NAME).toBe("Untitled session");
    // ASK: a blank RENAME is still a REFUSAL — no placeholder is invented
    // there — while a blank CREATION takes the family's own sentinel (the
    // person, 2026-11-25: a name is optional at creation).
    expect(askNameForWrite("")).toBeNull();
    expect(askNameForWrite("   ")).toBeNull();
    expect(askNameForWrite("  Why wet?  ")).toBe("Why wet?");
    expect(askNameForCreate("")).toBe(ASK_UNTITLED_NAME);
    expect(ASK_UNTITLED_NAME).toBe("Untitled ask");
    // The SHOWING is one quiet line for every family: a blank name and a
    // record carrying its family's untitled sentence alike. The RECORD keeps
    // its own sentences; only the pill says the absence.
    expect(UNTITLED_DISPLAY).toBe("no name yet");
    expect(groundDisplayName("")).toBe(UNTITLED_DISPLAY);
    expect(groundDisplayName(GROUND_UNTITLED_NAME)).toBe(UNTITLED_DISPLAY);
    expect(sessionDisplayName("")).toBe(UNTITLED_DISPLAY);
    expect(sessionDisplayName(SESSION_UNTITLED_NAME)).toBe(UNTITLED_DISPLAY);
    expect(askDisplayName("")).toBe(UNTITLED_DISPLAY);
    expect(askDisplayName(ASK_UNTITLED_NAME)).toBe(UNTITLED_DISPLAY);
    // Real names show as the person wrote them.
    expect(groundDisplayName("Rain gauge")).toBe("Rain gauge");
    expect(sessionDisplayName("Gauge run")).toBe("Gauge run");
    expect(askDisplayName("Why wet?")).toBe("Why wet?");
  });

  test("the shipped kinds pass their own rules into the shared pill", () => {
    expect(PILL).toContain("REFERENCE_PILL_RULES");
    expect(ASK_CARD).toContain("rules={ASK_PILL_RULES}");
    expect(ASK_CARD).toContain("nameForWrite: askNameForWrite");
    expect(SESSION_CARD).toContain("rules={SESSION_PILL_RULES}");
    expect(SESSION_CARD).toContain("nameForWrite: sessionNameForWrite");
    // The reference card passes nothing and gets the reference rules by default.
    expect(LAYER).toContain("name={reference.name}");
    expect(REFERENCE_PILL_RULES.nameForWrite("")).toBe(GROUND_UNTITLED_NAME);
  });

  test("the pill renders all three kinds, with the quiet line where a name is blank", () => {
    const html = render(
      [
        { on: "rain-gauge", name: "Rain gauge", x: 0, y: 0 },
        { on: "blank-ref", name: "   ", x: 300, y: 0 },
      ],
      [
        { on: "why-wet", name: "Why wet?", x: 600, y: 0 },
        { on: "asks-name", name: "Untitled ask", x: 900, y: 0 },
      ],
      [
        { on: "run-1", name: "Gauge run", x: 1200, y: 0, tool: "not-a-row" },
        { on: "run-blank", name: "  ", x: 1500, y: 0, tool: "not-a-row" },
      ],
      0.25,
    );
    // One pill per card, all counter-scaled by the SAME camera reading.
    expect(html.split('class="ground-pill"').length - 1).toBe(6);
    // STORY 25-5: no pill carries its own scale — the plane's shared var is
    // the one rule (the six pills themselves are counted above).
    expect(html).not.toContain("--pill-scale");
    // Every kind's name is up there in its own pill: the record's words, or
    // the one quiet line for a blank name and a family's untitled sentence.
    const pillName = (slug: string): string => {
      const card = html.slice(html.indexOf(`data-slug="${slug}"`));
      // STORY 25-1: the absent name wears the draft voice's class too, so the
      // name starts at the first ground-name class and its closing bracket.
      const start = card.indexOf('class="ground-name');
      const open = card.indexOf(">", start) + 1;
      return card.slice(open, card.indexOf("</span>", open));
    };
    expect(pillName("rain-gauge")).toBe("Rain gauge");
    expect(pillName("blank-ref")).toBe(UNTITLED_DISPLAY);
    expect(pillName("why-wet")).toBe("Why wet?");
    expect(pillName("asks-name")).toBe(UNTITLED_DISPLAY);
    expect(pillName("run-1")).toBe("Gauge run");
    expect(pillName("run-blank")).toBe(UNTITLED_DISPLAY);
    // STORY 25-1: an absent name also wears the draft voice's hook class.
    expect(html.split('ground-name ground-name-absent').length - 1).toBe(3);
    // ...and no card renders its name inside its body any more.
    expect(html).not.toContain("ask-card-name");
    expect(html).not.toContain("session-card-name");
  });

  test("a press on a name is the name's, not the door's, on every card", () => {
    // The reference card's rule, one family over: the pill carries the rename
    // field, so a press there must not also open the card.
    for (const card of [ASK_CARD, SESSION_CARD]) {
      // STORY 16.23: the shared helper reads the pill and answers "the handle,
      // not the door"; each card's click callback then returns before opening.
      expect(card).toContain("attachGroundCardDrag");
      expect(card).toContain("if (onPill) return;");
      expect(card).toContain("return;");
    }
    expect(LAYER).toContain("if (!onPill) onOpen();");
    // Escape in the field belongs to the pill: it forgets the draft and never
    // collapses the card as well (one press, one thing).
    expect(ASK_CARD).toContain('?.closest?.(".ground-pill")');
    expect(SESSION_CARD).toContain('?.closest?.(".ground-pill")');
  });
});

describe("a committed rename is a logged authored move", () => {
  test("the event names the family, the slug and BOTH names, and nothing else", () => {
    const event = cardRenameEvent(
      1_700_000_000_000,
      "session",
      "run-1",
      "Gauge run",
      "Gauge run (evening)",
    );
    const line = serializeHistoryEvent(event);
    expect(parseHistoryEvent(line)).toEqual(event);
    // The canonical line is sorted JSONL; the payload's whole key set is the
    // move's structural facts. There is no key for a word of content, so no
    // note, reading, question or transcript word can reach this line.
    const payload = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "from",
      "kind",
      "slug",
      "t",
      "to",
      "type",
      "v",
    ]);
    expect(payload).toEqual({
      v: 1,
      t: 1_700_000_000_000,
      type: "card.rename",
      kind: "session",
      slug: "run-1",
      from: "Gauge run",
      to: "Gauge run (evening)",
    });
    // Three families share the one ground map, so the kind is a closed pair.
    expect([...CARD_RENAME_KINDS]).toEqual(["reference", "ask", "session"]);
    expect(isCardRenameKind("ask")).toBe(true);
    expect(isCardRenameKind("word")).toBe(false);
  });

  test("a line out of shape is preserved, never guessed into a rename", () => {
    expect(
      parseHistoryEvent(
        JSON.stringify({ v: 1, t: 1, type: "card.rename", slug: "a", from: "x" }),
      ),
    ).toBeNull();
    expect(
      parseHistoryEvent(
        JSON.stringify({
          v: 1,
          t: 1,
          type: "card.rename",
          kind: "word",
          slug: "a",
          from: "x",
          to: "y",
        }),
      ),
    ).toBeNull();
    expect(
      parseHistoryEvent(
        JSON.stringify({
          v: 1,
          t: 1,
          type: "card.rename",
          kind: "reference",
          slug: "a",
          from: "",
          to: "y",
        }),
      ),
    ).toBeNull();
  });

  test("two renames are two lines IN ORDER, and the log stays append-only", async () => {
    const workspace = mkdtempSync(join(ROOT, "history-"));
    mkdirSync(join(workspace, "map"), { recursive: true });
    const io = {
      readTextFile: async (path: string) => {
        try {
          return readFileSync(path, "utf8");
        } catch {
          return null;
        }
      },
      writeTextFile: async (path: string, content: string) => {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(path, content, "utf8");
      },
    };
    await appendEvent(
      workspace,
      cardRenameEvent(1000, "ask", "why-wet", "Why wet?", "Why is it wet?"),
      io,
    );
    const first = readFileSync(historyPath(workspace), "utf8");
    await appendEvent(
      workspace,
      cardRenameEvent(2000, "ask", "why-wet", "Why is it wet?", "The wet one"),
      io,
    );
    const second = readFileSync(historyPath(workspace), "utf8");
    // The earlier bytes are a PREFIX: no line is rewritten, reordered or lost.
    expect(second.startsWith(first)).toBe(true);
    expect(second.length).toBeGreaterThan(first.length);
    const renames = parseHistory(second).events.filter(
      (event) => event.type === "card.rename",
    );
    expect(renames).toEqual([
      cardRenameEvent(1000, "ask", "why-wet", "Why wet?", "Why is it wet?"),
      cardRenameEvent(2000, "ask", "why-wet", "Why is it wet?", "The wet one"),
    ]);
    // The baseline goes in first, once, because a replay needs its start.
    expect(parseHistory(second).events[0]?.type).toBe("baseline");
    expect(parseHistory(second).malformed).toEqual([]);
    // Both renames of the same card are there: the second never displaced the
    // first.
    expect(second.split("card.rename").length - 1).toBe(2);
    expect(await readHistory(workspace, io).then((read) => read.events.length)).toBe(3);
  });

  test("a same-name commit writes nothing at all", () => {
    // PURE, the pill's one decision: no writer runs, so the hook logs nothing.
    expect(pillRenameOutcome("Rain gauge", "Rain gauge")).toBeNull();
    expect(pillRenameOutcome("Rain gauge", "  Rain gauge  ")).toBeNull();
    expect(pillRenameOutcome("Rain gauge", "Rain gauge (garden)")).toBe(
      "Rain gauge (garden)",
    );
    // A blank field is the REFERENCE's sentence, and only a blank-vs-blank
    // pair is "the same name".
    expect(pillRenameOutcome("Rain gauge", "")).toBe(GROUND_UNTITLED_NAME);
    expect(pillRenameOutcome(GROUND_UNTITLED_NAME, "   ")).toBeNull();
    // A session card's blank field is its own sentence.
    expect(
      pillRenameOutcome("Gauge run", "", {
        displayName: sessionDisplayName,
        nameForWrite: sessionNameForWrite,
      }),
    ).toBe(SESSION_UNTITLED_NAME);
    // An ask card's blank field is a REFUSAL: no write, so no line.
    expect(
      pillRenameOutcome("Why wet?", "   ", {
        displayName: askDisplayName,
        nameForWrite: askNameForWrite,
      }),
    ).toBeNull();
  });

  test("an abandoned rename writes nothing and logs nothing", () => {
    // Escape forgets the draft and closes the field; the writer is reached from
    // the commit path alone, and only AFTER the pure decision says a write is
    // due. So there is no path from an abandoned field to a record or a line.
    expect(PILL).toContain("function abandonRename(): void {");
    expect(PILL).toContain("abandonRename();");
    // The writer is called from exactly ONE place in the component, after the
    // pure decision; nothing else in this file can reach it.
    expect(PILL.split("await onRename(").length - 1).toBe(1);
    expect(PILL).toContain("if (!liveRef.current) return;");
    expect(PILL).toContain("pillRenameOutcome(name, draft, rules)");
    // The history line is written by the hook, never by the card.
    expect(PILL).not.toContain("cardRenameEvent");
    expect(ASK_CARD).not.toContain("cardRenameEvent");
    expect(SESSION_CARD).not.toContain("cardRenameEvent");
  });

  test("each family has ONE rename path, and it logs after its record write", () => {
    const paths: Array<[string, string, string]> = [
      ["rename", "reference", "await renameGroundRecords("],
      ["renameAskTo", "ask", "await saveAsks("],
      ["renameSessionTo", "session", "await saveSessions("],
    ];
    for (const [verb, kind, write] of paths) {
      const start = HOOK.indexOf("const " + verb + " = useCallback");
      expect(start).toBeGreaterThan(-1);
      const next = HOOK.indexOf("\n  const ", start + 1);
      const body = HOOK.slice(start, next === -1 ? HOOK.length : next);
      // ONE line per commit, formed with this family's own kind...
      expect(body).toContain('cardRenameEvent(Date.now(), "' + kind + '"');
      expect(body.split("cardRenameEvent(").length - 1).toBe(1);
      // ...only when the name really changed (a same-name commit logs nothing)...
      expect(body).toContain("was.name !== now");
      // ...and AFTER the record write, before the mirror (the record is truth).
      expect(body).toContain(write);
      expect(body.indexOf(write)).toBeLessThan(body.indexOf("cardRenameEvent("));
      expect(body.indexOf("cardRenameEvent(")).toBeLessThan(
        body.indexOf("queueMirror();"),
      );
    }
  });

  test("a rename writes the record, and the log names both names", async () => {
    const workspace = mkdtempSync(join(ROOT, "records-"));
    mkdirSync(join(workspace, "map"), { recursive: true });
    const io = {
      readTextFile: async (path: string) => {
        try {
          return readFileSync(path, "utf8");
        } catch {
          return null;
        }
      },
      writeTextFile: async (path: string, content: string) => {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(path, content, "utf8");
      },
    };
    // AN ASK: the line changes, the slug (wire target, conversation file) does
    // not, and the log names both names.
    const asks = [
      { on: "why-wet", name: "Why wet?", x: 0, y: 0 },
      { on: "soil", name: "Soil", x: 200, y: 0 },
    ] satisfies AskCardRecord[];
    const askNext = renameAsk(asks, "why-wet", "Why is it wet?");
    expect(askNext).not.toBeNull();
    await saveAsks(workspace, askNext!, [], io);
    const askText = readFileSync(join(workspace, "map", "asks.txt"), "utf8");
    expect(askText.split("\n")[0]).toBe(serializeAskLine(askNext![0]!));
    expect(parseAsks(askText).asks.map((ask) => ask.on)).toEqual(["why-wet", "soil"]);

    // A SESSION: the same one-line change, its transcript untouched.
    const sessions = [
      { on: "run-1", name: "Gauge run", x: 0, y: 0, tool: "dsh" },
      { on: "run-2", name: "Soil run", x: 200, y: 0, tool: "dsh" },
    ] satisfies SessionCardRecord[];
    const sessionNext = renameSession(sessions, "run-1", "Gauge run (evening)");
    expect(sessionNext).not.toBeNull();
    await saveSessions(workspace, sessionNext!, [], io);
    const sessionText = readFileSync(join(workspace, "map", "sessions.txt"), "utf8");
    expect(sessionText.split("\n")[0]).toBe(serializeSessionLine(sessionNext![0]!));
    expect(parseSessions(sessionText).sessions.map((card) => card.name)).toEqual([
      "Gauge run (evening)",
      "Soil run",
    ]);

    // The lines carry both names, from one event each.
    await appendEvents(
      workspace,
      [
        cardRenameEvent(1000, "ask", "why-wet", "Why wet?", "Why is it wet?"),
        cardRenameEvent(
          1001,
          "session",
          "run-1",
          "Gauge run",
          "Gauge run (evening)",
        ),
      ],
      io,
    );
    const log = readFileSync(historyPath(workspace), "utf8");
    expect(log).toContain('"from":"Why wet?","kind":"ask"');
    expect(log).toContain('"to":"Why is it wet?"');
    expect(log).toContain('"from":"Gauge run","kind":"session"');
    expect(log).toContain('"to":"Gauge run (evening)"');
    // An unknown slug renames nothing (never an appended card).
    expect(renameAsk(asks, "not-here", "x")).toBeNull();
    expect(renameSession(sessions, "not-here", "x")).toBeNull();
  });

  test("the rename line never carries a word of what the card holds", async () => {
    // A session card's transcript holds the run's words; a rename line names
    // the card and nothing else. The transcript is not even read by the path.
    const transcriptWords = "the gauge reading came back wet at dawn";
    const line = serializeHistoryEvent(
      cardRenameEvent(1, "session", "run-1", "Gauge run", "evening run"),
    );
    expect(line).not.toContain(transcriptWords);
    expect(line).not.toContain("gauge reading");
    const renameBody = HOOK.slice(
      HOOK.indexOf("const renameSessionTo = useCallback"),
      HOOK.indexOf("const forkAskAt = useCallback"),
    );
    // No transcript read, no words, no size: the rename reads only the record.
    expect(renameBody).not.toContain("loadSessionTranscript");
    expect(renameBody).not.toContain("appendSessionEntries");
    expect(renameBody).not.toContain("sessionTranscriptPath");
    expect(renameBody).not.toContain("entries");
  });
});

describe("MAP.md follows a rename on the next rewrite", () => {
  function view(
    references: GroundReference[],
    asks: AskCardRecord[],
    sessions: SessionCardRecord[],
  ): MirrorView {
    return {
      references,
      readings: [],
      texts: {},
      states: Object.fromEntries(
        references.map((reference) => [reference.on, "unread" as const]),
      ),
      notes: {},
      orphanNotes: [],
      orphanMedia: [],
      links: [],
      orphanLinks: [],
      malformedGround: [],
      malformedReadings: [],
      malformedLinks: [],
      asks,
      malformedAsks: [],
      orphanAskTurns: [],
      sessions,
      sessionToolNames: { "run-1": "a tool row" },
      sessionEndings: { "run-1": null },
      orphanSessionTranscripts: [],
    };
  }

  test("the new name is printed and the old one is gone, in all three sections", () => {
    const before = view(
      [{ on: "rain-gauge", name: "Rain gauge", x: 0, y: 0 }],
      [{ on: "why-wet", name: "Why wet?", x: 0, y: 0 }],
      [{ on: "run-1", name: "Gauge run", x: 0, y: 0, tool: "dsh" }],
    );
    const after = view(
      [{ on: "rain-gauge", name: "Rain gauge (garden)", x: 0, y: 0 }],
      [{ on: "why-wet", name: "Why is it wet?", x: 0, y: 0 }],
      [{ on: "run-1", name: "Gauge run (evening)", x: 0, y: 0, tool: "dsh" }],
    );
    const beforeText = renderMirror(before);
    const afterText = renderMirror(after);
    for (const [was, now] of [
      ["Rain gauge", "Rain gauge (garden)"],
      ["Why wet?", "Why is it wet?"],
      ["Gauge run", "Gauge run (evening)"],
    ] as const) {
      expect(beforeText).toContain(was);
      expect(afterText).toContain(now);
    }
    // The rename REPLACED the line: the old names are not printed beside the
    // new ones (a rename moves one line, it does not append a second card).
    expect(afterText).not.toContain("### Rain gauge\n");
    expect(afterText).not.toContain("### Why wet?\n");
    expect(afterText).not.toContain("### Gauge run\n");
    // The mirror is a pure render of the records: same view, same bytes.
    expect(renderMirror(after)).toBe(afterText);
  });

  test("a session card's own untitled sentence is what MAP.md prints", () => {
    // The record stores the sentence (a blank name would make the line
    // unreadable), so the mirror never has to invent one.
    const renamed = renameSession(
      [{ on: "run-1", name: "Gauge run", x: 0, y: 0, tool: "dsh" }],
      "run-1",
      "   ",
    )!;
    const text = renderMirror(
      view([], [], renamed),
    );
    expect(text).toContain(SESSION_UNTITLED_NAME);
    expect(parseSessions(serializeSessionLine(renamed[0]!)).sessions[0]?.name).toBe(
      SESSION_UNTITLED_NAME,
    );
  });
});

describe("the story's boundaries", () => {
  test("the ground map still renders no map content family", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("one drag rule stays the shared helper's, and the pill owns no pointer handling", () => {
    // STORY 16.23: the raw press/threshold/drop join lives in ONE function
    // (groundDrag.ts's attachGroundCardDrag), and each of the three cards calls
    // it exactly once. No card re-implements the rule.
    expect(DRAG.split("let drag = beginGroundDrag(").length - 1).toBe(1);
    expect(DRAG.split("const dropped = dropGroundDrag(").length - 1).toBe(1);
    expect(LAYER.split("attachGroundCardDrag(").length - 1).toBe(1);
    expect(ASK_CARD.split("attachGroundCardDrag(").length - 1).toBe(1);
    expect(SESSION_CARD.split("attachGroundCardDrag(").length - 1).toBe(1);
    for (const card of [ASK_CARD, SESSION_CARD, LAYER]) {
      for (const forbidden of [
        "beginGroundDrag",
        "moveGroundDrag",
        "dropGroundDrag",
        "GROUND_DRAG_THRESHOLD",
      ]) {
        expect({ forbidden, present: card.includes(forbidden) }).toEqual({
          forbidden,
          present: false,
        });
      }
    }
    for (const forbidden of [
      "beginGroundDrag",
      "moveGroundDrag",
      "dropGroundDrag",
      "addEventListener",
      "onMouseDown",
    ]) {
      expect({ forbidden, present: PILL.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  test("the handle promises a drag only where a drag exists", () => {
    // STORY 16.23: every shipped kind moves, so every pill offers the grab. The
    // prop is still honoured for a future kind with no move path; no card sets
    // it false today.
    expect(PILL).toContain('"--pill-cursor": movable ? "grab" : "default"');
    expect(source("canvas/canvas.css")).toContain("cursor: var(--pill-cursor, grab)");
    expect(ASK_CARD).not.toContain("movable={false}");
    expect(SESSION_CARD).not.toContain("movable={false}");
    // The reference card passes nothing, so the default (true) holds its grab.
    const at = LAYER.indexOf("<CardNamePill");
    const block = LAYER.slice(at, at + 900);
    expect(block).not.toContain("movable={false}");
  });

  test("no new record family and no new event family", () => {
    // The rename is ONE event on the EXISTING log, not a record of its own.
    const events = HOOK.match(/cardRenameEvent\(/g) ?? [];
    expect(events.length).toBe(3);
    expect(source("map/history.ts")).toContain('readonly type: "card.rename"');
    // The card's rename never mints a slug: identity is still the slug.
    expect(PILL).not.toContain("nextSlug");
    expect(ASK_CARD).not.toContain("nextSlug");
    expect(SESSION_CARD).not.toContain("nextSlug");
  });
});

/** Render the layer with all three kinds present. */
function render(
  references: readonly GroundReference[],
  asks: readonly AskCardRecord[],
  sessions: readonly SessionCardRecord[],
  zoom = 1,
): string {
  const inert = {
    onMove: async () => ({ ok: true as const }),
    onRefresh: async () => ({ ok: true as const }),
    onRepoint: async () => ({ ok: true as const }),
    onRemove: async () => ({ ok: true as const }),
  };
  return renderToStaticMarkup(
    createElement(GroundLayer, {
      references,
      readings: [],
      texts: {},
      states: Object.fromEntries(references.map((r) => [r.on, "unread"])),
      asks,
      askTurns: {},
      sessions,
      sessionEntries: {},
      sessionRunning: [],
      zoom,
      ...inert,
    }) as never,
  );
}
