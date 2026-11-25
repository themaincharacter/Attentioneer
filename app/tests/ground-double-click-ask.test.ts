import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaneMenu } from "../src/canvas/PlaneMenu";
import { PlaneContext } from "../src/canvas/CanvasPlane";
import {
  ASK_PEER_LINE,
  ASK_EMPTY_SENTENCE,
  AskCard,
  askDanglingLine,
  askKindLine,
} from "../src/canvas/AskCard";
import {
  ASK_NAME_SHORT,
  ASK_UNTITLED_NAME,
  addAsk,
  askNameFromQuestion,
  forkAsk,
  parseAskLine,
  renameAsk,
  serializeAskLine,
  sharedSlugs,
  type AskCard as AskCardRecord,
  type AskTurn,
} from "../src/map/asks";
import { UNTITLED_DISPLAY } from "../src/map/ground";
import { addGroundLink } from "../src/map/groundLinks";
import { renderedMapContent } from "../src/canvas/mapContentRules";

/**
 * STORY 17.10 — double-click opens the bubble, and an ask is a peer card.
 *
 * The user's correction: "Regarding how the card gets placed I was thinking we
 * copy the double click bubble menu we have in the concept map. in this case a
 * double click opens a bubble menu and you can select reference or ask."
 *
 * The human check cannot run here (no DOM harness, no window). This file pins
 * the PURE seam and the SOURCE FACTS a human will see at the window:
 *
 *   - the ground double-click opens THE CONCEPT MAP'S bubble component
 *     (canvas/PlaneMenu.tsx), at the pointer, with ask first, the reference
 *     doors next and session last;
 *   - an ask card is created EMPTY (no anchor, nothing from the press but the
 *     point), says "a question", names itself from its first question's short
 *     form and can be renamed;
 *   - the reply renders in THAT card, above the composer;
 *   - `ask about this` = an empty ask card + a WIRE from the source (17.9's
 *     mechanism), never an anchor;
 *   - the ADDENDUM: the re-anchor verb and its chooser are GONE, the anchor is
 *     display-only legacy, and no shipped path writes a new one.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const APP = source("App.tsx");
const MENU = source("canvas/PlaneMenu.tsx");
const HOOK = source("canvas/useGround.ts");
const ASKS = source("map/asks.ts");
const CARD = source("canvas/AskCard.tsx");
const LAYER = source("canvas/GroundLayer.tsx");
const BUBBLE = source("canvas/GroundBubble.tsx");

/** A slice from one marker to the next (source facts, not behaviour). */
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect({ start, found: from }).not.toEqual({ start, found: -1 });
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to === -1 ? text.length : to);
}

const CAMERA = { x: 0, y: 0, zoom: 1 };
function renderMenu(props: Parameters<typeof PlaneMenu>[0]): string {
  return renderToStaticMarkup(
    createElement(
      PlaneContext.Provider,
      { value: { camera: CAMERA, centerOn: () => {} } },
      createElement(PlaneMenu, props),
    ),
  );
}

describe("the ground double-click reuses the concept map's bubble", () => {
  test("the app opens PlaneMenu at the ground point, with the ground's doors", () => {
    // ONE bubble component: the ground map hands the concept map's component a
    // door list; there is no second bubble in the app.
    const handler = between(
      APP,
      "const handlePlaneDoubleClick = useCallback",
      "const closePlaneMenu = useCallback",
    );
    expect(handler).toContain("setGroundMenuAt(point)");
    expect(handler).toContain('level === "ground"');
    // The ground branch no longer opens the reference form directly: the
    // bubble comes first, and a door opens the form.
    expect(handler).not.toContain("setGroundAt(point)");
    // The door list, in the spec's order.
    const ask = APP.indexOf('id: "ask"');
    const file = APP.indexOf('id: "file"');
    const page = APP.indexOf('id: "page"');
    const video = APP.indexOf('id: "video"');
    const session = APP.indexOf('id: "session"');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(file);
    expect(file).toBeLessThan(page);
    expect(page).toBeLessThan(video);
    expect(video).toBeLessThan(session);
    // ask hangs ABOVE the dot (the concept menu's primary seat), the rest below.
    expect(APP.slice(ask - 80, ask + 120)).toContain('seat: "above"');
    // The bubble is the concept map's own render site, gated by level.
    expect(APP).toContain("level === \"ground\" && groundMenuAt !== null && (");
    // A reference door opens the existing form, already on that intent.
    expect(APP).toContain("initialIntent={groundIntent}");
    expect(BUBBLE).toContain("useState<GroundIntent>(initialIntent)");
  });

  test("the same component paints doors in order around the anchor dot", () => {
    const html = renderMenu({
      x: 40,
      y: 60,
      doors: [
        { id: "ask", label: "ask", title: "ask a question here", seat: "above", onPress: () => {} },
        { id: "file", label: "a file", title: "add a reference from a file", onPress: () => {} },
        { id: "page", label: "a page", title: "add a reference from a web page", onPress: () => {} },
        { id: "video", label: "a video", title: "add a reference from a video", onPress: () => {} },
        { id: "session", label: "a session", title: "start a session card here", onPress: () => {} },
      ],
      onClose: () => {},
    });
    expect(html).toContain('aria-label="make at this point"');
    const ask = html.indexOf("plane-menu-door-ask");
    const dot = html.indexOf("plane-menu-dot");
    const file = html.indexOf("plane-menu-door-file");
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(dot);
    expect(dot).toBeLessThan(file);
    expect(html).toContain(">a page</button>");
    expect(html).toContain(">a video</button>");
    expect(html).toContain(">a session</button>");
    // No concept vocabulary is painted beside a door list.
    expect(html).not.toContain("coin a word here");
    expect(html).not.toContain("draw here");
  });

  test("the concept menu is byte-identically itself when no doors are given", () => {
    expect(MENU).toContain("doors === undefined");
    const html = renderMenu({
      x: 1,
      y: 2,
      kinds: ["word"],
      onWord: () => {},
      onDraw: () => {},
      onClose: () => {},
    });
    expect(html).toContain('aria-label="create at this point"');
    expect(html).toContain("coin a word here");
    expect(html).toContain("draw here");
    expect(html).not.toContain("plane-menu-door");
  });

  test("the bubble keeps the press discipline that lets it sit over the plane", () => {
    // Reused, not re-invented: one raw listener stops the pan, one capture
    // listener owns the away-press, Esc dismisses, the camera is undone.
    expect(MENU).toContain('el.addEventListener("mousedown", stop)');
    expect(MENU).toContain('document.addEventListener("mousedown", onDown, true)');
    expect(MENU).toContain('if (e.key !== "Escape") return;');
    expect(MENU).toContain("menuTransform(cluster.lift, camera.zoom)");
    // And the gate still refuses creation while a gesture is armed.
    expect(source("canvas/CanvasPlane.tsx")).toContain(
      "if (!shouldCreate(gestureMode)) return;",
    );
  });
});

describe("an ask card is created empty and names itself", () => {
  test("creation takes nothing from the press but the point", () => {
    const made = addAsk([], sharedSlugs([], []), ASK_UNTITLED_NAME, 100, 200);
    expect(made.ask).toEqual({
      on: "untitled-ask",
      name: "Untitled ask",
      x: 100,
      y: 200,
    });
    expect(made.ask.anchor).toBeUndefined();
    expect(made.ask.anchorName).toBeUndefined();
    // The record's line has no anchor tail, and it round-trips.
    const line = serializeAskLine(made.ask);
    expect(line).toBe("on: untitled-ask | name: Untitled ask | x: 100 | y: 200");
    expect(line).not.toContain("anchor");
    expect(parseAskLine(line)).toEqual(made.ask);
  });

  test("no shipped creation path writes the anchor field", () => {
    // The addendum's assertion, read off the record module: the constructors
    // cannot put an anchor on a card. The anchor survives only as PARSED,
    // display-only legacy on an old line (serializeAskLine preserves it).
    const add = between(ASKS, "export function addAsk(", "export function forkAsk(");
    expect(add).not.toContain(".anchor");
    expect(add).not.toContain("anchor:");
    const fork = between(ASKS, "export function forkAsk(", "/**\n * RENAME one ask card");
    expect(fork).not.toContain(".anchor");
    expect(fork).not.toContain("anchor:");
    // And the one creation road in the hook writes no anchor either.
    const writer = between(HOOK, "const writeEmptyAsk = useCallback", "const createAsk = useCallback");
    expect(writer).not.toContain(".anchor");
    expect(writer).not.toContain("anchor:");
    const rename = between(HOOK, "const renameAskTo = useCallback", "/**\n   * STORY 17.8 — REMOVE one ask card");
    expect(rename).not.toContain(".anchor");
    expect(rename).not.toContain("anchor:");
  });

  test("the first question's one-line short form is the name until renamed", () => {
    expect(ASK_UNTITLED_NAME).toBe("Untitled ask");
    expect(askNameFromQuestion("  why is the gauge\n\nwet?  ")).toBe(
      "why is the gauge",
    );
    expect(askNameFromQuestion("   ")).toBe("");
    expect(askNameFromQuestion("a".repeat(ASK_NAME_SHORT + 10))).toBe(
      "a".repeat(ASK_NAME_SHORT) + "…",
    );
    // The hook renames ONLY the sentinel, before the send, and the person's
    // rename always wins.
    const turn = between(HOOK, "const askTurn = useCallback", "const askStop = useCallback");
    expect(turn).toContain("ask.name === ASK_UNTITLED_NAME");
    expect(turn).toContain("askNameFromQuestion(question)");
    expect(turn.indexOf("askNameFromQuestion(question)")).toBeLessThan(
      turn.indexOf("sendAskQuestion("),
    );
    // The title pill is the rename field (the card owns no file write).
    expect(CARD).toContain("onRename?: (name: string)");
    // STORY 16.22: the card wears the SHARED name pill (one component, one
    // rename field) instead of its own in-card field.
    expect(CARD).toContain("<CardNamePill");
    expect(CARD).toContain("ASK_PILL_RULES");
    expect(LAYER).toContain("onRenameAsk");
    // A rename keeps identity: the slug (wire target, conversation file).
    const renamed = renameAsk([madeCard()], "untitled-ask", "The gauge question");
    expect(renamed![0]!.on).toBe("untitled-ask");
    expect(renamed![0]!.name).toBe("The gauge question");
  });

  test("a fork is a peer too: it carries turns, not an anchor", () => {
    const legacy: AskCardRecord = {
      on: "old",
      name: "Old",
      x: 0,
      y: 0,
      anchor: "rain-gauge",
      anchorName: "Rain gauge",
    };
    const forked = forkAsk([legacy], sharedSlugs([], [legacy]), legacy, 1, "Branch", 10, 20);
    expect(forked.ask).toEqual({
      on: "branch",
      name: "Branch",
      x: 10,
      y: 20,
      from: "old",
      carry: 1,
    });
  });
});

describe("ask about this equals an empty ask card plus a wire", () => {
  test("the one write creates the card and then wires the source into it", () => {
    const writer = between(HOOK, "const writeEmptyAsk = useCallback", "const createAsk = useCallback");
    expect(writer).toContain("await writeAskCard(");
    expect(writer).toContain("addGroundLink(");
    expect(writer).toContain("await saveGroundLinks(");
    expect(writer.indexOf("await writeAskCard(")).toBeLessThan(
      writer.indexOf("addGroundLink("),
    );
    // The history names structure only: the add, then the ordered pair.
    expect(writer).toContain("askAddEvent(at, written.ask.on)");
    expect(writer).toContain("linkAddEvent(at, wired, written.ask.on)");
    // Two roads, ONE writer: the reference verb and the bubble's ask door.
    expect(HOOK).toContain("const createAsk = useCallback(");
    expect(HOOK).toContain("writeEmptyAsk(sourceSlug, name, x, y)");
    expect(HOOK).toContain("const createEmptyAsk = useCallback(");
    expect(HOOK).toContain("writeEmptyAsk(null, name, x, y)");
    expect(APP).toContain("ground.createEmptyAsk");
  });

  test("the pair is the existing link record, source -> the new peer", () => {
    const made = addAsk([], sharedSlugs([], []), ASK_UNTITLED_NAME, 1, 2);
    const links = addGroundLink([], "rain-gauge", made.ask.on);
    expect(links).toEqual([{ from: "rain-gauge", to: "untitled-ask" }]);
  });
});

describe("the reply renders in the card, above the composer", () => {
  const turns: AskTurn[] = [
    { role: "person", text: "which harbor keeps the lantern lit", t: "t" },
    { role: "answer", text: "the northern pier", t: "t" },
  ];

  test("the answer is the card's own thread, above the question field", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: madeCard(),
        anchorName: null,
        turns,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onAskTurn: async () => ({ ok: true }),
      }),
    );
    expect(html).toContain("the northern pier");
    expect(html).toContain("ask-card-question");
    // SAME card: the reply's text precedes the composer in the card's markup.
    expect(html.indexOf("the northern pier")).toBeLessThan(
      html.indexOf("ask-card-question"),
    );
    // No second surface, no document noun.
    expect(html).not.toContain("document");
    expect(html).toContain("ask-card");
  });

  test("an empty peer says what it is and offers its composer", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: madeCard(),
        anchorName: null,
        turns: [],
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onAskTurn: async () => ({ ok: true }),
      }),
    );
    // The pill shows the quiet absence for a record carrying the sentinel
    // (the person, 2026-11-25): "no name yet", never the sentinel sentence.
    // STORY 25-1: the absence also wears the draft voice's hook class.
    expect(html).toContain(
      'class="ground-name ground-name-absent">' + UNTITLED_DISPLAY + "</span>",
    );
    expect(html).not.toContain("Untitled ask");
    expect(html).toContain(ASK_PEER_LINE);
    // The OPEN face is the composer with an empty thread; the closed face is
    // the one that says "no question asked yet".
    expect(html).toContain("ask-card-question");
    const small = renderToStaticMarkup(
      createElement(AskCard, {
        ask: madeCard(),
        anchorName: null,
        turns: [],
        open: false,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(small).toContain(ASK_EMPTY_SENTENCE);
    // A peer card is not a dangling one: no gone sentence, no about-line.
    expect(html).not.toContain(askDanglingLine(null));
    expect(html).not.toContain(askKindLine(null));
  });
});

describe("the addendum: the re-anchor verb is gone, the anchor is display-only", () => {
  test("the card offers no re-anchor verb and no chooser", () => {
    // The PROSE may name what was removed; the SHIPPED UI may not.
    expect(CARD).not.toContain("ask-card-reanchor");
    expect(CARD).not.toContain("anchorChoices");
    expect(CARD).not.toContain("onReanchor");
    expect(CARD).not.toContain("startReanchor");
    expect(CARD).not.toContain("makeReanchor");
    expect(CARD).not.toContain("reanchorTo");
  });

  test("the hook and the record module have no re-anchor writer", () => {
    expect(HOOK).not.toContain("const reanchor");
    expect(HOOK).not.toContain("reanchorAsk(");
    expect(HOOK).not.toContain("reanchorRefusal");
    expect(HOOK).not.toContain("askReanchorEvent(");
    expect(ASKS).not.toContain("export function reanchor");
    expect(ASKS).not.toContain("reanchorAsk");
  });

  test("the 17.6 dangling sentence is still there for an old record", () => {
    const legacy: AskCardRecord = {
      on: "old",
      name: "Old question",
      x: 0,
      y: 0,
      anchor: "rain-gauge",
      anchorName: "Rain gauge",
    };
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: legacy,
        anchorName: null,
        turns: [],
        open: false,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain(askDanglingLine("Rain gauge"));
    expect(html).toContain("this was about Rain gauge; that card is gone");
  });

  test("the ground map still renders no concept content", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});

/** The card every render test starts from: empty, peer, no anchor. */
function madeCard(): AskCardRecord {
  return { on: "untitled-ask", name: "Untitled ask", x: 0, y: 0 };
}
