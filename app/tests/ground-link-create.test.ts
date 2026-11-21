import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clientToWorld } from "../src/canvas/geometry";
import { newWireClaim, type HookedWire } from "../src/canvas/hookedWire";
import {
  resolveGroundLinkRelease,
  type GroundLinkRelease,
} from "../src/canvas/linkDrag";
import {
  addGroundLink,
  groundLinksPath,
  loadGroundLinks,
  saveGroundLinks,
  type GroundLink,
} from "../src/map/groundLinks";
import {
  appendEvent,
  historyPath,
  linkAddEvent,
  parseHistory,
} from "../src/map/history";

/**
 * STORY 20.3 — DRAG OUT OF A CONNECTOR AND CREATE WITH THE HOOKUP IN PLACE.
 *
 * The user's window pass: "should be able to drag out from the wire connector
 * and on release if it's not a card should open the create bubble and proceed
 * that way with the automatic hookup in place." A wire drag released on empty
 * paper now resolves to a CREATE REQUEST at the release point, carrying the
 * drag's source; the ground bubble opens there and whatever the person makes
 * through it gets ONE wire from that source, through the layer's existing link
 * write. A cancel writes nothing.
 *
 * This file pins the four rules underneath the human check:
 *
 *   1. THE RELEASE: empty paper is a create request at the released world
 *      point; a card is the ordered pair it always was; the source card is not
 *      a pair.
 *   2. THE WIRE: one pair per hooked bubble, written once through
 *      addGroundLink and its one history event, and a second creation from the
 *      same bubble state wires nothing.
 *   3. THE CANCEL: no card, no link, no record, no history — the map folder is
 *      byte-identical.
 *   4. THE GENERIC: any card with a handle starts it and any card the bubble
 *      makes ends it; the wiring names no family.
 *
 * OUT OF SCOPE (a later story): the shortlist's reshape, a wire that ends in a
 * bracketed unknown. This release ends in a real created card or in nothing.
 *
 * PROVISIONAL: the release shape, the claim's shape (story 20.3).
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

/** The code without its comments: the naming sweep reads BEHAVIOUR only. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** The block a named top-level const opens, up to its own closing line. */
function blockOf(text: string, marker: string, length: number): string {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`missing ${marker}`);
  return text.slice(at, at + length);
}

const LINK_DRAG = source("canvas/linkDrag.ts");
const HOOKED = source("canvas/hookedWire.ts");
const APP = source("App.tsx");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-link-create-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

/** The record's bridges, bound to node's fs so a test needs no Tauri. */
const linkIo = {
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
};

const historyIo = linkIo;

const SOURCE = "rain-gauge";

/* ------------------------------------------------------------------ *
 * 1. The release: empty paper is a place to create.
 * ------------------------------------------------------------------ */

describe("a release on empty paper asks for a card at that point", () => {
  test("the release point is the plane's own conversion, not a second one", () => {
    const rect = { left: 10, top: 20 };
    const camera = { x: 5, y: 6, zoom: 2 };
    const at = clientToWorld(110, 220, rect, camera);
    expect(at).toEqual({ x: 47.5, y: 97 });
    const release: GroundLinkRelease | null = resolveGroundLinkRelease(
      SOURCE,
      null,
      at,
    );
    expect(release).toEqual({
      kind: "create",
      from: SOURCE,
      at: { x: 47.5, y: 97 },
    });
    // A point that could not be read is no place to put a bubble: nothing.
    expect(resolveGroundLinkRelease(SOURCE, null, null)).toBeNull();
  });

  test("the drag reads the point only when no card ended the release", () => {
    // The gesture asks the layer for the conversion and hands the request on;
    // it writes nothing itself.
    expect(LINK_DRAG).toContain("deps.toWorld?.(ev.clientX, ev.clientY)");
    expect(LINK_DRAG).toContain(
      "deps.onCreateFromLink?.(release.from, release.at)",
    );
    expect(withoutComments(LINK_DRAG)).not.toMatch(
      /ground\.(link|create|createSession)\(/,
    );
    // A pair needs no place: the conversion sits behind the no-card branch.
    const onUp = blockOf(LINK_DRAG, "const onLinkUp", 1400);
    expect(onUp.indexOf("slug === null")).toBeLessThan(
      onUp.indexOf("deps.toWorld"),
    );
  });
});

/* ------------------------------------------------------------------ *
 * 2. A release on a card is the pair it always was.
 * ------------------------------------------------------------------ */

describe("a release on a card keeps today's behaviour, byte for byte", () => {
  test("the card names the pair, and the source card names nothing", () => {
    expect(resolveGroundLinkRelease("left", "right", null)).toEqual({
      kind: "link",
      from: "left",
      to: "right",
    });
    // Releasing on the card the drag began from is still a quiet no-op.
    expect(resolveGroundLinkRelease("left", "left", null)).toBeNull();
    // A card under the pointer outranks the point: a pair needs no place.
    expect(
      resolveGroundLinkRelease("left", "right", { x: 1, y: 2 }),
    ).toEqual({ kind: "link", from: "left", to: "right" });
    // A card with no slug is not a place to put a card either: nothing.
    expect(resolveGroundLinkRelease("left", null, null)).toBeNull();
  });

  test("the layer's one link writer still takes the drawn pair", () => {
    expect(LINK_DRAG).toContain("void writer(from, release.to);");
    // Esc still cancels before the release is ever resolved.
    const onUp = blockOf(LINK_DRAG, "const onLinkUp", 1400);
    expect(onUp.indexOf("if (cancelled) return;")).toBeLessThan(
      onUp.indexOf("resolveGroundLinkRelease("),
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. One hooked bubble, one wire.
 * ------------------------------------------------------------------ */

describe("the hooked bubble owes exactly one wire", () => {
  test("the first landed card takes the wire; the claim is then spent", () => {
    const claim = newWireClaim();
    expect(
      claim.take(SOURCE, { ok: true, created: "new-card" }),
    ).toEqual({ from: SOURCE, to: "new-card" });
    // A second creation from the same bubble state finds nothing to wire.
    expect(claim.take(SOURCE, { ok: true, created: "another" })).toBeNull();
  });

  test("a refusal, an unreadable card or the source itself owes nothing", () => {
    const claim = newWireClaim();
    // The bubble's own refusals write nothing, so no wire is owed.
    expect(claim.take(SOURCE, { ok: false })).toBeNull();
    // A creation that handed back no slug cannot be wired; nothing landed, so
    // the claim is not spent and the next landed card still gets its wire.
    expect(claim.take(SOURCE, { ok: true })).toBeNull();
    // A card is never wired to itself, exactly as a drawn pair refuses.
    expect(claim.take(SOURCE, { ok: true, created: SOURCE })).toBeNull();
    expect(claim.take(SOURCE, { ok: true, created: "made" })).toEqual({
      from: SOURCE,
      to: "made",
    });
    // A bubble opened by a double-click carries no hookup and owes nothing.
    expect(newWireClaim().take(null, { ok: true, created: "made" })).toBeNull();
  });

  test("the card and its one wire land through the existing write path", async () => {
    const workspace = freshWorkspace();
    const claim = newWireClaim();
    const wire: HookedWire | null = claim.take(SOURCE, {
      ok: true,
      created: "made-card",
    });
    if (wire === null) throw new Error("expected a wire");
    // The layer's own link write: one pair, one line, one history event.
    await saveGroundLinks(
      workspace,
      addGroundLink([], wire.from, wire.to),
      [],
      linkIo,
    );
    await appendEvent(
      workspace,
      linkAddEvent(7, wire.from, wire.to),
      historyIo,
    );
    const loaded = await loadGroundLinks(workspace, linkIo);
    expect(loaded.links).toEqual([{ from: SOURCE, to: "made-card" }]);
    expect(loaded.malformed).toEqual([]);
    // The wire's own line, exactly once, plus the log's baseline and nothing
    // else: no second event family, no ghost of the gesture.
    const history = parseHistory(
      readFileSync(historyPath(workspace), "utf8"),
    );
    expect(history.malformed).toEqual([]);
    expect(history.events.filter((event) => event.type === "link.add")).toEqual([
      linkAddEvent(7, SOURCE, "made-card"),
    ]);
    expect(history.events.filter((event) => event.type !== "baseline")).toEqual([
      linkAddEvent(7, SOURCE, "made-card"),
    ]);
    // The same bubble state, asked again, adds no second line.
    expect(claim.take(SOURCE, { ok: true, created: "made-card" })).toBeNull();
    expect((await loadGroundLinks(workspace, linkIo)).links).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Cancel is silent: no card, no link, no record, no history.
 * ------------------------------------------------------------------ */

describe("a bubble closed without creating writes nothing", () => {
  test("a refusal or an escape hands nothing to a writer", async () => {
    const workspace = freshWorkspace();
    const writes: { path: string; content: string }[] = [];
    const recording = {
      readTextFile: linkIo.readTextFile,
      writeTextFile: async (path: string, content: string): Promise<void> => {
        writes.push({ path, content });
      },
    };
    // The recorder is LIVE: a landed wire would have been seen. (Without this
    // control the sweep below would pass on a recorder that never ran.)
    await saveGroundLinks(
      workspace,
      addGroundLink([], SOURCE, "seen"),
      [],
      recording,
    );
    expect(writes).toHaveLength(1);
    // (The recorder wrote nothing to disk, so there is nothing to undo.)
    expect(existsSync(groundLinksPath(workspace))).toBe(false);
    writes.length = 0;
    // The bubble opened from the drag, then Escaped: no card was made, so the
    // claim owes no wire and no writer — not even the empty-file write a save
    // would make — is reached.
    const claim = newWireClaim();
    expect(
      claim.take(SOURCE, { ok: false, message: "name it first." }),
    ).toBeNull();
    // The sweep: not one byte reached a file.
    expect(writes).toEqual([]);
    expect(existsSync(groundLinksPath(workspace))).toBe(false);
    expect(existsSync(historyPath(workspace))).toBe(false);
  });

  test("the app's hooked doors write only on a landed card's wire", () => {
    // Opening the bubble is view state only.
    const open = blockOf(APP, "const openHookedCreate", 700);
    expect(withoutComments(open)).not.toMatch(/ground\.(link|create)/);
    // The wire is the layer's existing link write, and it runs only after the
    // claim answered a pair.
    const wired = blockOf(APP, "const wireHookedCreate", 900);
    expect(wired.indexOf("if (wire === null) return made;")).toBeLessThan(
      wired.indexOf("await ground.link(wire.from, wire.to);"),
    );
    // No second link vocabulary: the one existing write path, no new event.
    expect(withoutComments(wired)).not.toMatch(
      /linkAddEvent|appendEvent|saveGroundLinks|addGroundLink/,
    );
    // Closing the bubble drops the draft; nothing else clears a record.
    expect(APP).toContain(
      "const closeGroundBubble = useCallback(() => setGroundAt(null), []);",
    );
  });
});

/* ------------------------------------------------------------------ *
 * 5. Generic by construction: no family branch anywhere in the wiring.
 * ------------------------------------------------------------------ */

describe("any card starts the drag and any card the bubble makes ends it", () => {
  test("one source, three families, three single wires", async () => {
    const workspace = freshWorkspace();
    const made = ["made-ask", "made-session", "made-reference"];
    let links: readonly GroundLink[] = [];
    let at = 0;
    for (const slug of made) {
      // One bubble per creation, exactly as a release opens one.
      const wire = newWireClaim().take(SOURCE, { ok: true, created: slug });
      if (wire === null) throw new Error("expected a wire");
      links = addGroundLink(links, wire.from, wire.to);
      await appendEvent(workspace, linkAddEvent(++at, wire.from, wire.to), historyIo);
    }
    await saveGroundLinks(workspace, links, [], linkIo);
    const loaded = await loadGroundLinks(workspace, linkIo);
    // Exactly one pair per created card, all from the drag's source.
    expect(loaded.links).toEqual(
      made.map((to) => ({ from: SOURCE, to })),
    );
    const history = parseHistory(readFileSync(historyPath(workspace), "utf8"));
    expect(history.events.filter((event) => event.type === "link.add")).toHaveLength(
      made.length,
    );
  });

  test("the wiring names no family at all", () => {
    // The claim's code asks nothing about what was made…
    expect(withoutComments(HOOKED)).not.toMatch(
      /\b(ask|session|folder|page|video|reference)\b/i,
    );
    // …and the app hands EVERY bubble door through the same one wrapper. (The
    // slice ends at the next const: a byte count stopped being the wrapper once
    // story 21.13's door joined the list below it.)
    const wireFrom = APP.indexOf("const wireHookedCreate");
    const wireTo = APP.indexOf("const dismissDropNotice");
    const wired = withoutComments(APP.slice(wireFrom, wireTo));
    expect(wired).not.toMatch(
      /\b(intent|ask|session|folder|page|video|reference)\b/i,
    );
    // Each door of the bubble ends in the same wrapper: six, one shape. The
    // sixth is STORY 21.13's ask door, which lands exactly as the other five do.
    const calls = APP.match(/return wireHookedCreate\(/g) ?? [];
    expect(calls).toHaveLength(6);
    // The drag's create request carries the source card and nothing
    // family-specific; the release rule itself is one pure function. (The
    // card SELECTOR still names the three families, as it always has.)
    const resolve = blockOf(
      LINK_DRAG,
      "export function resolveGroundLinkRelease",
      700,
    );
    expect(withoutComments(resolve)).not.toMatch(
      /\b(intent|ask|session|folder|page|video|reference)\b/i,
    );
  });
});
