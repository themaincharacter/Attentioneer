import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { restoreSentence } from "../src/canvas/useGround";
import {
  appendEvents,
  appendedHistory,
  historyPath,
  parseHistoryEvent,
  serializeHistoryEvent,
  sessionAddEvent,
  sessionRemoveEvent,
  sessionRestoreEvent,
  sessionResultEvent,
  sessionRunEvent,
  type HistoryEvent,
} from "../src/map/history";
import {
  loadSessionTranscriptsWithOrphans,
  parseSessionTranscript,
  removeSessionRecords,
  restoreSessionCard,
  restoreSessionTranscript,
  runOutcomeOf,
  saveSessions,
  serializeSessionLine,
  serializeSessionTranscript,
  sessionLastEnding,
  sessionResultSize,
  sessionTranscriptPath,
  sessionsPath,
  type SessionCard,
  type SessionEntry,
  type SessionIo,
  type SessionRemovalIo,
  type SessionRestoreIo,
} from "../src/map/sessions";
import {
  MIRROR_FILE,
  MIRROR_SESSION_TOOL_UNKNOWN,
  mirrorPath,
  mirrorSessionLine,
  renderMirror,
  writeMirror,
  type MirrorView,
} from "../src/map/mirror";
import {
  parsePrisms,
  RUN_OUTCOMES,
  serializePrismLine,
  type RunOutcome,
} from "../src/map/prisms";
import { runRunContact, type RunContactDeps } from "../src/contacts/run";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { SessionCard as SessionCardView } from "../src/canvas/SessionCard";
import { SESSION_RESTORE_SENTENCE } from "../src/canvas/GroundToast";

/**
 * STORY 18.5 — the map remembers runs.
 *
 * The story's check is human ("run a session twice, then open MAP.md: the card
 * is named with its tool and its last ending, and nothing from either run's text
 * appears; open the log: two run lines, each with its ending, and not one word of
 * the transcript; delete the card: the toast offers Restore, restore returns the
 * card and its transcript byte-identically"). This file pins the rules
 * underneath:
 *
 *   - ONE mapping forms the PRISM's run outcome and the history's ending, so the
 *     two records can never disagree;
 *   - the PRISM's `run` Change is three structural facts and no words, no argv,
 *     no directory and no counts of entries;
 *   - MAP.md's sessions section: name, tool row, last ending — nothing else;
 *   - the five structural history events;
 *   - removal captures the line and the transcript's BYTES before unlinking,
 *     and Restore writes the SAME BYTES (a whole-folder comparison);
 *   - a transcript whose card is gone is an ORPHAN: kept, named, never adopted;
 *   - the no-words search over MAP.md, the history AND the PRISMs, over every
 *     >=3-char token of the run's streamed text, with a positive control that
 *     the transcript still holds every word.
 *
 * PROVISIONAL (the story's own note): RunChange's fields, the sessions section's
 * format, the five event names and the ending wording.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const HOOK = source("canvas/useGround.ts");
const APP = source("App.tsx");
const LAYER = source("canvas/GroundLayer.tsx");
const CARD_VIEW = source("canvas/SessionCard.tsx");
const TOAST = source("canvas/GroundToast.tsx");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-session-memory-"));
afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const fsIo = {
  readTextFile: async (path: string): Promise<string | null> => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path: string, content: string): Promise<void> => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
  createDirAll: async (path: string): Promise<void> => {
    mkdirSync(path, { recursive: true });
  },
};

const sessionIo: SessionIo = {
  ...fsIo,
  listDir: async (path: string): Promise<string[]> => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
};

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map", "sessions"), { recursive: true });
  return path;
}

const RUN_CARD: SessionCard = {
  on: "gauge-run",
  name: "Gauge run",
  x: 10,
  y: 10,
  tool: "acp-probe",
};
const NEVER_RUN: SessionCard = {
  on: "bow-run",
  name: "Bow run",
  x: 20,
  y: 20,
  tool: "acp-gone",
};
const TOOL_NAME = "the probe";

/** The run's speech: two text chunks, exactly as the card's transcript holds. */
const RUN_TEXT = "quasar lantern meadow pixel zephyr orchard";
const RUN: SessionEntry[] = [
  { kind: "started", t: "2026-11-18T12:00:00.000Z" },
  { kind: "session", id: "session-1" },
  { kind: "text", text: "quasar lantern meadow " },
  { kind: "text", text: "pixel zephyr orchard" },
  { kind: "ended", ending: "completed", t: "2026-11-18T12:00:02.000Z" },
];

/** Every >=3-character token of the run's streamed text (the hard constraint). */
function runTokens(): string[] {
  const tokens = new Set<string>();
  for (const entry of RUN) {
    if (entry.kind !== "text") continue;
    for (const token of entry.text.split(/\s+/)) {
      if (token.length >= 3) tokens.add(token);
    }
  }
  return [...tokens];
}

/** A deterministic view: no references, the session cards and their endings. */
function viewOf(
  sessions: readonly SessionCard[],
  entries: Readonly<Record<string, readonly SessionEntry[]>> = {},
  over: Partial<MirrorView> = {},
): MirrorView {
  const toolNames: Record<string, string | null> = {};
  for (const session of sessions) {
    toolNames[session.on] = session.tool === "acp-probe" ? TOOL_NAME : null;
  }
  const endings: Record<string, ReturnType<typeof sessionLastEnding>> = {};
  for (const session of sessions) {
    endings[session.on] = sessionLastEnding(entries[session.on] ?? []);
  }
  return {
    references: [],
    readings: [],
    texts: {},
    states: {},
    notes: {},
    orphanNotes: [],
    orphanMedia: [],
    links: [],
    orphanLinks: [],
    malformedGround: [],
    malformedReadings: [],
    malformedLinks: [],
    asks: [],
    malformedAsks: [],
    orphanAskTurns: [],
    sessions,
    sessionToolNames: toolNames,
    sessionEndings: endings,
    orphanSessionTranscripts: [],
    ...over,
  };
}

/* ========================================================================= *
 * 1. One mapping, two records that never disagree.
 * ========================================================================= */

const ENDINGS: { ending: "completed" | "stopped" | "failed" | "timed-out"; outcome: RunOutcome }[] = [
  { ending: "completed", outcome: "answered" },
  { ending: "stopped", outcome: "no-response" },
  { ending: "failed", outcome: "no-response" },
  { ending: "timed-out", outcome: "no-response" },
];

describe("the run's ending is ONE fact, said twice", () => {
  test("only a completed run answered; every other ending is no-response", () => {
    expect([...RUN_OUTCOMES]).toEqual(["answered", "no-response"]);
    for (const { ending, outcome } of ENDINGS) {
      expect(runOutcomeOf(ending)).toBe(outcome);
      // The history's line uses the same mapping, so the two records agree.
      const event = sessionRunEvent(1, "gauge-run", runOutcomeOf(ending));
      if (event.type !== "session.run") throw new Error("not a session.run");
      expect(event.ending).toBe(outcome);
    }
  });

  for (const { ending, outcome } of ENDINGS) {
    test("a " + ending + " run logs " + outcome + ", exactly as its PRISM says", async () => {
      // A real PRISM through the run contact flow, against an in-memory log.
      let text: string | null = null;
      let minted = 0;
      const deps: RunContactDeps = {
        readPrismsText: async () => text,
        writePrismsText: async (next) => {
          text = next;
        },
        mintId: () => "prism-" + (minted += 1),
      };
      const entries: SessionEntry[] =
        ending === "completed"
          ? RUN
          : [
              { kind: "started", t: "t" },
              { kind: "text", text: "a partial" },
              { kind: "ended", ending, t: "t" },
            ];
      const resultSize = sessionResultSize(entries);
      const moved = await runRunContact(
        {
          workspacePath: "/w",
          on: "gauge-run",
          tool: "acp-probe",
          outcome: runOutcomeOf(ending),
          resultSize,
        },
        deps,
      );
      const parsed = parsePrisms(text ?? "");
      expect(parsed.prisms.length).toBe(1);
      const change = parsed.prisms[0]!.changes[0]!;
      if (change.kind !== "run") throw new Error("not a run change");
      expect(change.outcome).toBe(outcome);
      expect(change.tool).toBe("acp-probe");
      expect(change.resultSize).toBe(ending === "completed" ? resultSize : null);
      expect(parsed.prisms[0]!.contact).toBe("run");
      expect(parsed.prisms[0]!.pointer).toBeNull();
      expect(moved.prism.changes).toEqual([change]);
      // The Change's key set is the whole shape: three facts, no content slot.
      expect(Object.keys(JSON.parse(serializePrismLine(parsed.prisms[0]!)).changes[0]).sort()).toEqual([
        "kind",
        "outcome",
        "resultSize",
        "tool",
      ]);
    });
  }

  test("the result size is the completed result's bytes, never a count", () => {
    expect(sessionResultSize(RUN)).toBe(RUN_TEXT.length);
    expect(sessionResultSize([{ kind: "ended", ending: "stopped", t: "t" }])).toBeNull();
    // A completed run that said nothing is size zero, said exactly.
    expect(
      sessionResultSize([{ kind: "ended", ending: "completed", t: "t" }]),
    ).toBe(0);
  });
});

/* ========================================================================= *
 * 2. MAP.md's sessions section.
 * ========================================================================= */

describe("MAP.md's sessions section: the name, the tool and the ending", () => {
  test("one line per card: the name, what it runs, the last ending", () => {
    const text = renderMirror(viewOf([RUN_CARD, NEVER_RUN], { "gauge-run": RUN }));
    expect(text).toContain("## Sessions");
    expect(text).toContain("Gauge run — runs " + TOOL_NAME + "; last run: completed");
    // A card that never ran has no ending to claim.
    expect(text).toContain("Bow run — runs " + MIRROR_SESSION_TOOL_UNKNOWN);
    expect(text).not.toContain("Bow run — runs a tool that is not here; last run");
    // No words, no path, no command, no count.
    for (const token of runTokens()) {
      expect({ token, found: text.includes(token) }).toEqual({ token, found: false });
    }
    expect(text).not.toContain("acp-probe");
    expect(text).not.toContain("sessions/");
  });

  test("the record's own order is the section's order", () => {
    const forward = renderMirror(viewOf([RUN_CARD, NEVER_RUN]));
    const backward = renderMirror(viewOf([NEVER_RUN, RUN_CARD]));
    expect(forward.indexOf("Gauge run —")).toBeLessThan(forward.indexOf("Bow run —"));
    expect(backward.indexOf("Bow run —")).toBeLessThan(backward.indexOf("Gauge run —"));
  });

  test("sections keep their fixed order: references, asks, sessions, links, unknowns", () => {
    const text = renderMirror(viewOf([RUN_CARD]));
    expect(text.indexOf("## References")).toBeLessThan(text.indexOf("## Asks"));
    expect(text.indexOf("## Asks")).toBeLessThan(text.indexOf("## Sessions"));
    expect(text.indexOf("## Sessions")).toBeLessThan(text.indexOf("## Links"));
    expect(text.indexOf("## Links")).toBeLessThan(text.indexOf("## What is unknown"));
  });

  test("an empty sessions section says none yet, with no count", () => {
    const text = renderMirror(viewOf([]));
    const section = text.slice(text.indexOf("## Sessions"), text.indexOf("## Links"));
    expect(section).toContain("none yet.");
    expect(section).not.toMatch(/\b\d+\b/);
  });

  test("the line builder is pure and every ending has its word", () => {
    for (const { ending } of ENDINGS) {
      expect(mirrorSessionLine(RUN_CARD, TOOL_NAME, ending)).toBe(
        "Gauge run — runs " + TOOL_NAME + "; last run: " + ending,
      );
    }
    expect(mirrorSessionLine(RUN_CARD, null, null)).toBe(
      "Gauge run — runs " + MIRROR_SESSION_TOOL_UNKNOWN,
    );
  });

  test("an orphan transcript is an unknown in the mirror, never a card", () => {
    const text = renderMirror(
      viewOf([RUN_CARD], {}, { orphanSessionTranscripts: ["ghost-run"] }),
    );
    expect(text).toContain(
      "a transcript with no session card, kept in map/sessions/ghost-run.jsonl",
    );
    expect(text).not.toContain("### ghost-run");
  });
});

/* ========================================================================= *
 * 3. The five history events.
 * ========================================================================= */

describe("the history's five session events: structural, closed, append-only", () => {
  const events: HistoryEvent[] = [
    sessionAddEvent(1, "gauge-run"),
    sessionRunEvent(2, "gauge-run", "answered"),
    sessionResultEvent(3, "gauge-run-result", "gauge-run"),
    sessionRemoveEvent(4, "gauge-run"),
    sessionRestoreEvent(5, "gauge-run"),
  ];

  test("every event round-trips through one canonical line", () => {
    for (const event of events) {
      expect(parseHistoryEvent(serializeHistoryEvent(event))).toEqual(event);
    }
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "session.add",
      "session.run",
      "session.result",
      "session.remove",
      "session.restore",
    ]);
  });

  test("a run ending outside the PRISM's two words is preserved, not guessed", () => {
    const event = sessionRunEvent(1, "gauge-run", "answered");
    const bad = serializeHistoryEvent(event).replace('"answered"', '"completed"');
    expect(parseHistoryEvent(bad)).toBeNull();
  });

  test("the payloads hold no slot for a word, a path or a count", () => {
    const allowed: Record<string, string[]> = {
      "session.add": ["v", "t", "type", "slug"],
      "session.remove": ["v", "t", "type", "slug"],
      "session.restore": ["v", "t", "type", "slug"],
      "session.run": ["v", "t", "type", "slug", "ending"],
      "session.result": ["v", "t", "type", "slug", "from"],
    };
    for (const event of events) {
      const line = serializeHistoryEvent(event);
      const keys = Object.keys(JSON.parse(line)).sort();
      expect(keys).toEqual(allowed[(event as { type: string }).type]!.slice().sort());
      for (const key of keys) {
        expect(["text", "prompt", "command", "argv", "path", "dir", "entries"]).not.toContain(key);
      }
    }
  });

  test("the append is after the earlier bytes, never a rewrite", () => {
    const before = serializeHistoryEvent(sessionAddEvent(1, "gauge-run")) + "\n";
    const append = appendedHistory(before, [
      sessionRunEvent(2, "gauge-run", "no-response"),
      sessionRemoveEvent(3, "gauge-run"),
    ]);
    expect(append.text.startsWith(before)).toBe(true);
    const lines = append.text.trimEnd().split("\n");
    expect(JSON.parse(lines[lines.length - 2]).type).toBe("session.run");
    expect(JSON.parse(lines[lines.length - 1]).type).toBe("session.remove");
    // A hand line already in the file is a prefix, never touched.
    const hand = before + "{hand edit\n";
    const next = appendedHistory(hand, [sessionRestoreEvent(4, "gauge-run")]);
    expect(next.text.startsWith(hand)).toBe(true);
  });
});

/* ========================================================================= *
 * 4. Removal and Restore: capture first, same bytes back.
 * ========================================================================= */

function sessionsIoFs(
  workspace: string,
  sessions: readonly SessionCard[],
  malformed: readonly string[],
): Promise<void> {
  return saveSessions(workspace, sessions, malformed, sessionIo);
}

const removalIo: SessionRemovalIo = {
  saveSessions: sessionsIoFs,
  readTextFile: fsIo.readTextFile,
  removeFile: async (path) => {
    unlinkSync(path);
  },
};
const restoreIo: SessionRestoreIo = {
  saveSessions: sessionsIoFs,
  restoreTranscript: (workspace, slug, text) =>
    restoreSessionTranscript(workspace, slug, text, sessionIo),
};

function folderState(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(dir: string, prefix: string): void {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = prefix === "" ? name : prefix + "/" + name;
      if (statSync(path).isDirectory()) walk(path, rel);
      else out[rel] = readFileSync(path, "utf8");
    }
  }
  walk(root, "");
  return out;
}

describe("a session card is removable, with the same reversible promise", () => {
  test("the delete reads the line and the transcript BEFORE the unlink", async () => {
    const workspace = freshWorkspace();
    writeFileSync(
      sessionsPath(workspace),
      [RUN_CARD, NEVER_RUN].map(serializeSessionLine).join("\n") + "\n",
      "utf8",
    );
    writeFileSync(sessionTranscriptPath(workspace, RUN_CARD.on), serializeSessionTranscript(RUN), "utf8");
    const result = await removeSessionRecords(
      workspace,
      RUN_CARD.on,
      [RUN_CARD, NEVER_RUN],
      [],
      removalIo,
    );
    expect(result.refusal).toBeNull();
    expect(result.removed).not.toBeNull();
    expect(result.removed!.session).toEqual(RUN_CARD);
    expect(result.removed!.transcript).toBe(serializeSessionTranscript(RUN));
    expect(existsSync(sessionTranscriptPath(workspace, RUN_CARD.on))).toBe(false);
    expect(readFileSync(sessionsPath(workspace), "utf8")).toBe(
      serializeSessionLine(NEVER_RUN) + "\n",
    );
  });

  test("Restore writes the SAME BYTES: the whole folder compares identical", async () => {
    const workspace = freshWorkspace();
    writeFileSync(
      sessionsPath(workspace),
      [RUN_CARD, NEVER_RUN].map(serializeSessionLine).join("\n") + "\n",
      "utf8",
    );
    // A hand-edited, malformed transcript line proves the writer never
    // re-serializes what it did not author.
    writeFileSync(
      sessionTranscriptPath(workspace, RUN_CARD.on),
      serializeSessionTranscript(RUN) + "{a hand line\n",
      "utf8",
    );
    const before = folderState(workspace);
    const removal = await removeSessionRecords(
      workspace,
      RUN_CARD.on,
      [RUN_CARD, NEVER_RUN],
      [],
      removalIo,
    );
    expect(folderState(workspace)).not.toEqual(before);
    const restored = await restoreSessionCard(
      workspace,
      removal.removed!,
      removal.sessions,
      [],
      restoreSentence,
      restoreIo,
    );
    expect(restored.refusal).toBeNull();
    expect(restored.restoredSession).toBe(true);
    expect(restored.cameBack).toEqual(["the transcript", "the session card"]);
    // THE WHOLE FOLDER, byte for byte — the restored line sits where it sat.
    expect(folderState(workspace)).toEqual(before);
  });

  test("a card with no transcript restores none and invents nothing", async () => {
    const workspace = freshWorkspace();
    writeFileSync(sessionsPath(workspace), serializeSessionLine(RUN_CARD) + "\n", "utf8");
    const removal = await removeSessionRecords(workspace, RUN_CARD.on, [RUN_CARD], [], removalIo);
    expect(removal.removed!.transcript).toBeNull();
    const restored = await restoreSessionCard(
      workspace,
      removal.removed!,
      removal.sessions,
      [],
      restoreSentence,
      restoreIo,
    );
    expect(restored.cameBack).toEqual(["the session card"]);
    expect(existsSync(sessionTranscriptPath(workspace, RUN_CARD.on))).toBe(false);
  });

  test("the toast says which card went, and ONE toast holds all three kinds", () => {
    expect(SESSION_RESTORE_SENTENCE).toBe("this session card was removed");
    expect(APP).toContain("ground.restorableSession");
    expect(APP).toContain("SESSION_RESTORE_SENTENCE");
    // One pending of any kind: a session delete clears the other snapshots.
    const removeSessionBlock = HOOK.slice(
      HOOK.indexOf("const removeSession = useCallback"),
      HOOK.indexOf("const createSession = useCallback"),
    );
    expect(removeSessionBlock).toContain("restorableRef.current = null");
    expect(removeSessionBlock).toContain("restorableAskRef.current = null");
    const removeAskBlock = HOOK.slice(
      HOOK.indexOf("const removeAsk = useCallback"),
      HOOK.indexOf("const askTurn = useCallback"),
    );
    expect(removeAskBlock).toContain("restorableSessionRef.current = null");
  });

  test("the verbs are wired: the card, the layer, the app", () => {
    expect(CARD_VIEW).toContain("onRemove");
    expect(CARD_VIEW).toContain("session-card-remove");
    expect(LAYER).toContain("onRemoveSession");
    expect(LAYER).toContain("onRemoveSession(session.on)");
    expect(APP).toContain("onRemoveSession={ground.removeSession}");
    expect(TOAST).toContain("SESSION_RESTORE_SENTENCE");
  });

  test("a session card renders its remove verb", () => {
    const html = renderToStaticMarkup(
      createElement(SessionCardView, {
        session: RUN_CARD,
        toolName: TOOL_NAME,
        declaration: null,
        entries: [],
        running: false,
        open: true,
        previewLines: 4,
        onOpen: () => {},
        onClose: () => {},
        onRemove: async () => ({ ok: true }),
      }),
    );
    expect(html).toContain("session-card-remove");
    expect(html).toContain("remove");
  });
});

/* ========================================================================= *
 * 5. A transcript whose card is gone is an ORPHAN.
 * ========================================================================= */

describe("an orphan transcript is reported, never adopted and never deleted", () => {
  test("the load names it and leaves the bytes exactly where they are", async () => {
    const workspace = freshWorkspace();
    writeFileSync(sessionsPath(workspace), serializeSessionLine(RUN_CARD) + "\n", "utf8");
    writeFileSync(sessionTranscriptPath(workspace, RUN_CARD.on), serializeSessionTranscript(RUN), "utf8");
    const ghost = sessionTranscriptPath(workspace, "ghost-run");
    const ghostText = serializeSessionTranscript(RUN) + "{hand\n";
    writeFileSync(ghost, ghostText, "utf8");

    const loaded = await loadSessionTranscriptsWithOrphans(
      workspace,
      [RUN_CARD.on],
      sessionIo,
    );
    expect(loaded.orphans).toEqual(["ghost-run"]);
    expect(loaded.transcripts[RUN_CARD.on]!.entries.length).toBe(RUN.length);
    // Never deleted, never rewritten, never read into a card.
    expect(readFileSync(ghost, "utf8")).toBe(ghostText);
    // And it is SAID in the map's two memories.
    const text = renderMirror(
      viewOf([RUN_CARD], { "gauge-run": RUN }, { orphanSessionTranscripts: loaded.orphans }),
    );
    expect(text).toContain(
      "a transcript with no session card, kept in map/sessions/ghost-run.jsonl",
    );
    expect(APP).toContain("orphanSessionTranscripts");
    expect(APP).toContain("a transcript for “{slug}” has no session card");
  });

  test("the load's own parse keeps a hand-edited line as a malformed entry", () => {
    const parsed = parseSessionTranscript(serializeSessionTranscript(RUN) + "{hand\n");
    expect(parsed.entries.length).toBe(RUN.length);
    expect(parsed.malformed).toEqual(["{hand"]);
  });
});

/* ========================================================================= *
 * 6. The no-words search, over all three record files, every token.
 * ========================================================================= */

describe("no run text in any record file", () => {
  test("every >=3-char token is absent from MAP.md, the history and the PRISMs", async () => {
    const workspace = freshWorkspace();
    writeFileSync(sessionsPath(workspace), serializeSessionLine(RUN_CARD) + "\n", "utf8");
    writeFileSync(sessionTranscriptPath(workspace, RUN_CARD.on), serializeSessionTranscript(RUN), "utf8");

    // MAP.md, the real writer.
    const transcript = parseSessionTranscript(
      readFileSync(sessionTranscriptPath(workspace, RUN_CARD.on), "utf8"),
    );
    const view = viewOf([RUN_CARD], { "gauge-run": transcript.entries });
    await writeMirror(workspace, renderMirror(view), fsIo);

    // The history, the real append-only writer: the session's five moves.
    const events = [
      sessionAddEvent(1, RUN_CARD.on),
      sessionRunEvent(2, RUN_CARD.on, "answered"),
      sessionRunEvent(3, RUN_CARD.on, "answered"),
      sessionResultEvent(4, "gauge-run-result", RUN_CARD.on),
      sessionRemoveEvent(5, RUN_CARD.on),
      sessionRestoreEvent(6, RUN_CARD.on),
    ];
    await appendEvents(workspace, events, fsIo);

    // The PRISM, the real run flow.
    let log: string | null = null;
    let minted = 0;
    await runRunContact(
      {
        workspacePath: workspace,
        on: RUN_CARD.on,
        tool: RUN_CARD.tool,
        outcome: runOutcomeOf("completed"),
        resultSize: sessionResultSize(transcript.entries),
      },
      {
        readPrismsText: async () => log,
        writePrismsText: async (next) => {
          log = next;
        },
        mintId: () => "prism-" + (minted += 1),
      },
    );
    await fsIo.writeTextFile(
      join(workspace, "map", "prisms.jsonl"),
      log ?? "",
    );

    const mapText = readFileSync(mirrorPath(workspace), "utf8");
    const logText = readFileSync(historyPath(workspace), "utf8");
    const prismText = readFileSync(join(workspace, "map", "prisms.jsonl"), "utf8");
    const tokens = runTokens();
    expect(tokens.length).toBeGreaterThanOrEqual(6);
    for (const token of tokens) {
      expect({ token, inMap: mapText.includes(token) }).toEqual({ token, inMap: false });
      expect({ token, inLog: logText.includes(token) }).toEqual({ token, inLog: false });
      expect({ token, inPrism: prismText.includes(token) }).toEqual({ token, inPrism: false });
    }
    // THE POSITIVE CONTROLS: the search passes because the files are structural,
    // not because they are empty.
    expect(mapText).toContain(
      "Gauge run — runs " + TOOL_NAME + "; last run: completed",
    );
    expect(logText).toContain('"type":"session.run"');
    expect(logText).toContain('"ending":"answered"');
    expect(prismText).toContain('"kind":"run"');
    expect(prismText).toContain('"tool":"acp-probe"');
    // And the transcript still holds EVERY word, verbatim.
    const saved = readFileSync(
      sessionTranscriptPath(workspace, RUN_CARD.on),
      "utf8",
    );
    for (const token of tokens) expect(saved).toContain(token);
    // The streamed chunks are contiguous: joined in arrival order, the
    // transcript holds the whole text, byte for byte.
    expect(
      parseSessionTranscript(saved).entries.filter((entry) => entry.kind === "text").map((entry) => (entry as { text: string }).text).join(""),
    ).toBe(RUN_TEXT);
    // No map content is rendered off this (unchanged).
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("the mirror's view never carries a transcript at all", () => {
    const view = viewOf([RUN_CARD], { "gauge-run": RUN });
    expect(Object.keys(view).sort()).not.toContain("sessionEntries");
    expect(renderMirror(view)).not.toContain("quasar");
  });

  test("the record files are named in the story's own words", () => {
    expect(MIRROR_FILE).toBe("MAP.md");
    expect(sessionsPath("/w")).toBe("/w/map/sessions.txt");
    expect(sessionTranscriptPath("/w", "x")).toBe("/w/map/sessions/x.jsonl");
  });
});
