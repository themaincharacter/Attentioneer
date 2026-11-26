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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaneContext } from "../src/canvas/CanvasPlane";
import { GroundBubble } from "../src/canvas/GroundBubble";
import { newWireClaim } from "../src/canvas/hookedWire";
import { writeAskCard } from "../src/canvas/useGround";
import {
  ASK_UNTITLED_NAME,
  askNameForCreate,
  askRefusal,
  askTurnPath,
  askTurnsDir,
  asksPath,
  saveAsks,
  type AskIo,
} from "../src/map/asks";
import {
  addGroundLink,
  groundLinksPath,
  loadGroundLinks,
  saveGroundLinks,
} from "../src/map/groundLinks";
import { renderedMapContent } from "../src/canvas/mapContentRules";

/**
 * STORY 21.13 — THE CREATION BUBBLE CAN MAKE AN ASK CARD.
 *
 * The person's finding: "can't seem to instantiate an ask card like the others
 * when I drag off from wire node into an empty part of the map." 20.3 opens the
 * ground creation bubble on a released wire, but its intent row had no ask.
 *
 * The human check is a window pass (drag from a card's handle onto empty paper,
 * choose "an ask", name it, press add: the card appears EMPTY with the wire
 * already drawn; then double-click empty paper, choose ask with no drag: no
 * wire; cancel writes nothing). This file pins the rules underneath it:
 *
 *   1. THE DOOR: "an ask" is in the intent row (first), and only when the app
 *      handed the bubble its ask creator.
 *   2. THE CREATE: the form calls the app's ONE ask creator exactly once, with
 *      the creation rule's name (trimmed, or the ask's "Untitled ask" sentinel
 *      for a blank field — the person, 2026-11-25: a name is optional); the
 *      app supplies the point, and the bubble invents no wording of its own.
 *   3. THE EMPTY CARD: the ask's existing creation road writes ONE record line —
 *      no question, no turn, and no conversation file.
 *   4. THE HOOKUP: a bubble opened by 20.3's wire release owes one wire and
 *      writes it through the existing link path; a double-clicked bubble owes
 *      none and its map folder holds no links file.
 *   5. THE CANCEL: closing the bubble writes nothing at all.
 *
 * PROVISIONAL: the label's position in the row and the ask intent's shape.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const BUBBLE = source("canvas/GroundBubble.tsx");
const APP = source("App.tsx");
const HOOK = source("canvas/useGround.ts");

/** The slice from one marker to the next (source facts, not behaviour). */
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect({ start, found: from }).not.toEqual({ start, found: -1 });
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to === -1 ? text.length : to);
}

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-bubble-ask-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

/** Every file under `map/`, path -> bytes: an empty object is "wrote nothing". */
function folderBytes(workspace: string): Record<string, string> {
  const root = join(workspace, "map");
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(root, full)] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return out;
}

const askIo: AskIo = {
  readTextFile: async (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  },
  createDirAll: async (path) => {
    mkdirSync(path, { recursive: true });
  },
};

const linkIo = {
  readTextFile: askIo.readTextFile,
  writeTextFile: askIo.writeTextFile,
};

const CAMERA = { x: 0, y: 0, zoom: 1 };

/** Render the bubble exactly as the app mounts it, with the ask door handed in. */
function renderBubble(
  props: Partial<Parameters<typeof GroundBubble>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(
      PlaneContext.Provider,
      { value: { camera: CAMERA, centerOn: () => {} } },
      createElement(GroundBubble, {
        x: 10,
        y: 20,
        onAdd: async () => ({ ok: true }),
        onAddFolder: async () => ({ ok: true }),
        onAddPage: async () => ({ ok: true }),
        onAddVideo: async () => ({ ok: true }),
        onAddSession: async () => ({ ok: true }),
        onAddAsk: async () => ({ ok: true }),
        onClose: () => {},
        ...props,
      }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * 1. The door is in the intent row.
 * ------------------------------------------------------------------ */

describe("the intent row gains an ask door", () => {
  test("the menu starts with two options and a session is never one", () => {
    // STORY 25-19 (the person's redesign): the menu is TWO STEPS — an ask or
    // a reference — and a reference opens its own second row. A session is
    // not in this menu at all (it is the wire's alone).
    const html = renderBubble({ initialIntent: "ask" });
    expect(html).toContain(">an ask</button>");
    expect(html).toContain(">a reference</button>");
    expect(html).not.toContain(">a session</button>");
    const ask = html.indexOf(">an ask</button>");
    const reference = html.indexOf(">a reference</button>");
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(reference);
    // The chosen door is the active one, and the title says what is being made.
    expect(html).toContain("ground-bubble-intent active");
    expect(html).toContain(">ask</div>");
    expect(html).toContain('aria-label="name the ask card"');
    // An ask has no second source: no file row, no picker, no address field.
    expect(html).not.toContain("ground-bubble-url");
    expect(html).not.toContain("choose a file");
    expect(html).not.toContain("choose a folder");
  });

  test("a reference opens the second row: project, web link, file", () => {
    const html = renderBubble({ initialIntent: "file" });
    // The second row is the reference's own kinds, in the person's words.
    const project = html.indexOf(">a project</button>");
    const web = html.indexOf(">a web link</button>");
    const file = html.indexOf(">a file</button>");
    expect(project).toBeGreaterThan(-1);
    expect(project).toBeLessThan(web);
    expect(web).toBeLessThan(file);
    // The web link is ONE option (page and video consolidated).
    expect(html).not.toContain(">a page</button>");
    expect(html).not.toContain(">a video</button>");
  });

  test("a door the app did not hand the bubble is not offered", () => {
    const html = renderBubble({ onAddAsk: undefined });
    expect(html).not.toContain(">an ask</button>");
    expect(BUBBLE).toContain('option.kind === "ask"');
    expect(BUBBLE).toContain("onAddAsk !== undefined");
  });

  test("the source names the intent and the words, in the spec's order", () => {
    const type = between(BUBBLE, "export type GroundIntent =", "/**");
    expect(type).toContain('"ask"');
    // The two-step rows: the kind row, then the reference's own kinds.
    const kinds = between(BUBBLE, "const KINDS", "];");
    expect(kinds.indexOf('{ kind: "ask", label: "an ask" }')).toBeGreaterThan(-1);
    expect(kinds.indexOf('kind: "ask"')).toBeLessThan(kinds.indexOf('kind: "reference"'));
    const row = between(BUBBLE, "const REFERENCE_KINDS", "];");
    expect(row.indexOf('intent: "folder", label: "a project"')).toBeGreaterThan(-1);
    expect(row.indexOf('intent: "folder"')).toBeLessThan(row.indexOf('intent: "page"'));
    expect(row.indexOf('intent: "page", label: "a web link"')).toBeGreaterThan(-1);
    expect(renderedMapContent("ground")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 2. One press, one call, the person's name at the point.
 * ------------------------------------------------------------------ */

describe("choosing the door calls the ask creator once, with name and point", () => {
  test("the form makes exactly one ask call, with the creation rule's name", () => {
    // ONE call site in the form, and no second road that could double-create.
    const calls = BUBBLE.match(/onAddAsk\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const commit = between(BUBBLE, "async function commitAsk", "async function chooseFile");
    // The name is trimmed and named AT THE COMMIT: a blank field becomes the
    // ask's own sentinel (the person, 2026-11-25: a name is optional).
    expect(commit).toContain("const result = await onAddAsk(askNameForCreate(name));");
    expect(askNameForCreate("  The gauge question  ")).toBe("The gauge question");
    expect(askNameForCreate("")).toBe(ASK_UNTITLED_NAME);
    // A double press or a busy bubble creates nothing a second time.
    expect(commit).toContain("if (doneRef.current || busy || onAddAsk === undefined) return;");
    expect(commit.indexOf("doneRef.current || busy")).toBeLessThan(
      commit.indexOf("onAddAsk(askNameForCreate(name))"),
    );
    // The add verb and Enter both route an ask to that one commit; a file is
    // never picked for an ask and an address is never read for one.
    const add = between(BUBBLE, 'className="ground-bubble-add"', "</button>");
    expect(add).toContain('if (intent === "ask")');
    expect(add).toContain("void commitAsk();");
    const enter = between(BUBBLE, 'if (e.key !== "Enter") return;', "disabled={busy}");
    expect(enter.indexOf('if (intent === "ask") void commitAsk();')).toBeLessThan(
      enter.indexOf('else if (intent === "session") void commitSession();'),
    );
  });

  test("the app supplies the point and the one wrapper every door uses", () => {
    const wrapper = between(APP, "const addGroundAsk = useCallback", "* PROVISIONAL — the ground bubble's FOLDER door");
    // Exactly one creation call, with the person's name and the bubble's point.
    expect((wrapper.match(/ground\.createEmptyAsk\(/g) ?? [])).toHaveLength(1);
    expect(wrapper).toContain("ground.createEmptyAsk(name, groundAt.x, groundAt.y)");
    expect(wrapper).toContain("return wireHookedCreate(");
    // No point of its own: a bubble that closed has nothing to write.
    expect(wrapper).toContain('return { ok: false, message: "nothing was written." };');
    // ONE call site in the whole app: no second creation road grew.
    expect((APP.match(/ground\.createEmptyAsk\(/g) ?? [])).toHaveLength(1);
    // The bubble is handed it, and the menu's ask door opens THAT form — the
    // same road a reference door takes, so the name is asked first.
    expect(APP).toContain("onAddAsk={addGroundAsk}");
    expect(APP).toContain('onPress: () => chooseGroundDoor("ask")');
    expect(APP).not.toContain("chooseGroundAsk");
  });

  test("a blank name is named at the commit; the bubble invents no wording", () => {
    const commit = between(BUBBLE, "async function commitAsk", "async function chooseFile");
    // The bubble has no refusal of its own any more: the ONE naming rule runs
    // before the writer, and the writer is reached with the sentinel.
    expect(commit).not.toContain("name it first.");
    expect(commit).toContain("onAddAsk(askNameForCreate(name))");
    // The sentinel's words live in the record family, never in the bubble;
    // the record's name refusal is retired (a blank name is legal now).
    expect(commit).not.toContain("Untitled ask");
    expect(askNameForCreate("")).toBe(ASK_UNTITLED_NAME);
    expect(ASK_UNTITLED_NAME).toBe("Untitled ask");
    expect(askRefusal("   ")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 3. The card is EMPTY: one record line, no conversation file.
 * ------------------------------------------------------------------ */

describe("the created ask card is empty", () => {
  test("one line, no question, no turn, no conversation file", async () => {
    const workspace = freshWorkspace();
    const written = await writeAskCard(
      workspace,
      [],
      [],
      [],
      "  The gauge question  ",
      120,
      240,
      { saveAsks: (path, asks, malformed) => saveAsks(path, asks, malformed, askIo) },
    );
    // The record is the point and the person's trimmed name, and nothing else.
    expect(written.ask).toEqual({
      on: "the-gauge-question",
      name: "The gauge question",
      x: 120,
      y: 240,
    });
    expect(written.ask.anchor).toBeUndefined();
    // ONE record file, one line.
    const bytes = folderBytes(workspace);
    expect(Object.keys(bytes)).toEqual(["asks.txt"]);
    expect(readFileSync(asksPath(workspace), "utf8")).toBe(
      "on: the-gauge-question | name: The gauge question | x: 120 | y: 240\n",
    );
    // AN UNASKED QUESTION IS NOT A RECORD: no conversation folder, no file.
    expect(existsSync(askTurnsDir(workspace))).toBe(false);
    expect(existsSync(askTurnPath(workspace, written.ask.on))).toBe(false);
    // And the creation road never reaches the turn writer.
    const writer = between(HOOK, "export async function writeAskCard", "export async function writeSelectionAsk");
    expect(writer).not.toContain("appendExchange");
    expect(writer).not.toContain("appendTurn");
    expect(writer).not.toContain("askTurnPath");
  });
});

/* ------------------------------------------------------------------ *
 * 4. The hookup: owed by a wire release, never by a double-click.
 * ------------------------------------------------------------------ */

describe("the hookup rides the one link path, and only from a wire release", () => {
  const SOURCE = "rain-gauge";

  test("a hooked bubble writes the card AND its one wire", async () => {
    const workspace = freshWorkspace();
    const written = await writeAskCard(
      workspace,
      [],
      [],
      [],
      "Wired question",
      5,
      6,
      { saveAsks: (path, asks, malformed) => saveAsks(path, asks, malformed, askIo) },
    );
    // The one claim a released wire leaves on the bubble.
    const wire = newWireClaim().take(SOURCE, { ok: true, created: written.ask.on });
    expect(wire).toEqual({ from: SOURCE, to: written.ask.on });
    if (wire === null) throw new Error("expected a wire");
    await saveGroundLinks(
      workspace,
      addGroundLink([], wire.from, wire.to),
      [],
      linkIo,
    );
    expect((await loadGroundLinks(workspace, linkIo)).links).toEqual([
      { from: SOURCE, to: written.ask.on },
    ]);
    // The card's own file is the ask line; the wire has its own one.
    expect(existsSync(asksPath(workspace))).toBe(true);
    expect(existsSync(groundLinksPath(workspace))).toBe(true);
    expect(existsSync(askTurnPath(workspace, written.ask.on))).toBe(false);
    // The claim is spent: a second creation from the same bubble wires nothing.
    expect(newWireClaim().take(SOURCE, { ok: true, created: "x" })).not.toBeNull();
    expect(
      newWireClaim().take(null, { ok: true, created: written.ask.on }),
    ).toBeNull();
  });

  test("a double-clicked bubble owes nothing, and no links file exists", async () => {
    const workspace = freshWorkspace();
    const written = await writeAskCard(
      workspace,
      [],
      [],
      [],
      "Unwired question",
      7,
      8,
      { saveAsks: (path, asks, malformed) => saveAsks(path, asks, malformed, askIo) },
    );
    // A double-click's point carries no hookup, so the claim answers nothing.
    const claim = newWireClaim();
    expect(claim.take(null, { ok: true, created: written.ask.on })).toBeNull();
    expect(existsSync(groundLinksPath(workspace))).toBe(false);
    expect((await loadGroundLinks(workspace, linkIo)).links).toEqual([]);
    expect(readFileSync(asksPath(workspace), "utf8")).toContain("Unwired question");
  });

  test("every bubble door, the ask included, ends in the app's one wrapper", () => {
    // The six creation doors all hand their result to the same wrapper; no
    // family is named there, so the ask cannot grow a second link path.
    expect((APP.match(/return wireHookedCreate\(/g) ?? [])).toHaveLength(6);
    const wired = between(APP, "const wireHookedCreate", "const dismissDropNotice");
    expect(wired).toContain("await ground.link(wire.from, wire.to);");
    expect(wired).not.toMatch(/addGroundLink|saveGroundLinks|linkAddEvent/);
    // The hookup only exists because 20.3's release put it on the point.
    const open = between(APP, "const openHookedCreate", "const wireHookedCreate");
    expect(open).toContain("setGroundAt({ x: at.x, y: at.y, hookup: from });");
    // A double-click door opens the bubble with a bare point.
    const door = between(APP, "const chooseGroundDoor = useCallback", "const addGroundAt");
    expect(door).toContain("setGroundAt(spot);");
    expect(door).not.toContain("hookup");
  });

  test("a refused or closed bubble writes neither card nor link", () => {
    const workspace = freshWorkspace();
    // Closing the bubble is view state only: the source has no writer in it.
    const close = between(BUBBLE, "function close()", "async function commit(");
    expect(close).toContain("onClose();");
    expect(close).not.toContain("onAddAsk");
    expect(close).not.toContain("onAdd(");
    // And nothing reached the folder: no card, no wire, no conversation.
    expect(folderBytes(workspace)).toEqual({});
    expect(existsSync(asksPath(workspace))).toBe(false);
    expect(existsSync(groundLinksPath(workspace))).toBe(false);
    expect(existsSync(askTurnsDir(workspace))).toBe(false);
  });
});
