import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BESIDE_OFFSET_X, clientToWorld } from "../src/canvas/geometry";
import {
  DROP_CARD_SELECTOR,
  dropLandsOnCard,
  planDrop,
  runOsDrop,
  type DropWriter,
} from "../src/canvas/osDrop";
import {
  isTextField,
  pasteBelongsToField,
  pasteClientPoint,
  pasteName,
  pasteUrl,
  pasteWorldPoint,
} from "../src/canvas/linkPaste";
import {
  NOT_A_FILE_OR_LINK,
  webLinkName,
  webLinkOf,
} from "../src/canvas/webLink";

/**
 * STORY 16.34 — A LINK LANDS WHERE YOU POINT.
 *
 * The check is human (drag a link from a browser, paste a URL with the canvas
 * in front, paste inside a text field, drop a neither). This file pins the
 * rules underneath it:
 *
 *   - ONE validator: both doors read `webLink.ts`, which reads the map's own
 *     `isWebUrl`; no module re-derives a scheme test;
 *   - ONE creator: both doors call `ground.createPage` (the bubble's page
 *     card path), asserted by source and by a fake writer;
 *   - the drop's point is the pointer; the paste's point is the last place the
 *     pointer rested over the plane, or the visible centre when it never did;
 *   - the focus guard runs before the clipboard is read;
 *   - neither door makes a card on a card;
 *   - plain TEXT paste creates nothing (out of scope, said in code).
 *
 * PROVISIONAL: the paste position rule, the link card's host name and the
 * drop's broadened sentence.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

function logger(): {
  write: DropWriter;
  calls: { name: string; x: number; y: number; from: string }[];
} {
  const calls: { name: string; x: number; y: number; from: string }[] = [];
  return {
    calls,
    write: async (name, x, y, from) => {
      calls.push({ name, x, y, from });
      return { ok: true };
    },
  };
}

describe("one link validator, read by both doors", () => {
  test("http(s) only, the whole string, trimmed", () => {
    expect(webLinkOf(" https://example.com/a?q=1 ")).toBe(
      "https://example.com/a?q=1",
    );
    expect(webLinkOf("http://localhost:3000/notes")).toBe(
      "http://localhost:3000/notes",
    );
    for (const refused of [
      "",
      "   ",
      "example.com",
      "ftp://example.com",
      "javascript:alert(1)",
      "file:///tmp/notes.md",
      "see https://example.com for more",
    ]) {
      expect(webLinkOf(refused)).toBeNull();
    }
  });

  test("the card's name is the address's host", () => {
    expect(webLinkName("https://rivers.example.org/a/b")).toBe(
      "rivers.example.org",
    );
    expect(pasteName("https://example.com")).toBe("example.com");
  });

  test("webLink.ts reads the map's own isWebUrl; no second parser appears", () => {
    const link = source("canvas/webLink.ts");
    expect(link).toContain('from "../map/readings"');
    expect(link).toContain("isWebUrl(");
    expect(link).not.toContain("new URL(");
    for (const rel of ["canvas/osDrop.ts", "canvas/linkPaste.ts"]) {
      const text = source(rel);
      expect(text).toContain('from "./webLink"');
      // The scheme test lives in readings.ts, not in a door.
      expect(text).not.toContain("new URL(");
      expect(text).not.toContain('"http:"');
    }
  });
});

describe("a dropped link is a link, not a file", () => {
  test("one URL is planned at the pointer, named by its host", () => {
    const plan = planDrop(["https://example.com/a"], { x: 40, y: 90 });
    expect(plan.unknown).toBe(0);
    expect(plan.items).toEqual([
      {
        path: "https://example.com/a",
        name: "example.com",
        at: { x: 40, y: 90 },
        url: "https://example.com/a",
      },
    ]);
  });

  test("files and links cascade together in the OS's order", () => {
    const plan = planDrop(
      ["/tmp/a.md", "https://example.com", "https://elsewhere.test/x"],
      { x: 10, y: 20 },
    );
    expect(plan.items.map((item) => item.url)).toEqual([
      undefined,
      "https://example.com",
      "https://elsewhere.test/x",
    ]);
    expect(plan.items.map((item) => item.at.x)).toEqual([
      10,
      10 + BESIDE_OFFSET_X,
      10 + BESIDE_OFFSET_X * 2,
    ]);
  });

  test("a non-http address is not a link", () => {
    // Not http(s) and not a file kind: counted, refused, never planned.
    const plan = planDrop(["ftp://example.com/a.zip"], { x: 0, y: 0 });
    expect(plan.items).toEqual([]);
    expect(plan.unknown).toBe(1);
    // A bare string with no extension is a TEXT path by the file rules, never
    // a page: it is attempted as a file and its read refuses.
    const textPath = planDrop(["hello, this is not an address"], { x: 0, y: 0 });
    expect(textPath.items.map((item) => item.url)).toEqual([undefined]);
  });

  test("a URL goes to the page creator, never to the file writer", async () => {
    const files = logger();
    const pages = logger();
    const outcome = await runOsDrop(
      ["https://example.com/a"],
      { x: 7, y: 8 },
      files.write,
      pages.write,
    );
    expect(files.calls).toEqual([]);
    expect(pages.calls).toEqual([
      { name: "example.com", x: 7, y: 8, from: "https://example.com/a" },
    ]);
    expect(outcome).toEqual({ added: 1, skipped: 0, notice: null });
  });

  test("a mixed drop makes both through their own existing paths", async () => {
    const files = logger();
    const pages = logger();
    await runOsDrop(
      ["/tmp/a.md", "https://example.com"],
      { x: 0, y: 0 },
      files.write,
      pages.write,
    );
    expect(files.calls.map((call) => call.from)).toEqual(["/tmp/a.md"]);
    expect(pages.calls.map((call) => call.from)).toEqual([
      "https://example.com",
    ]);
  });

  test("a refused page keeps its own one sentence and adds nothing", async () => {
    const outcome = await runOsDrop(
      ["https://example.com"],
      { x: 0, y: 0 },
      async () => ({ ok: true }),
      async () => ({ ok: false, message: "that page could not be read." }),
    );
    expect(outcome).toEqual({
      added: 0,
      skipped: 1,
      notice: "that page could not be read.",
    });
  });

  test("a window with no page door says so instead of writing a file", async () => {
    const files = logger();
    const outcome = await runOsDrop(
      ["https://example.com"],
      { x: 0, y: 0 },
      files.write,
    );
    expect(files.calls).toEqual([]);
    expect(outcome).toEqual({
      added: 0,
      skipped: 1,
      notice: NOT_A_FILE_OR_LINK,
    });
  });
});

describe("a paste has no cursor, so it lands where you last pointed", () => {
  test("the last pointer over the plane is the point", () => {
    const rect = { left: 20, top: 40, width: 400, height: 300 };
    const camera = { x: 10, y: 30, zoom: 2 };
    const last = { x: 220, y: 140 };
    expect(pasteClientPoint(last, rect)).toEqual(last);
    expect(pasteWorldPoint(last, rect, camera)).toEqual(
      clientToWorld(220, 140, rect, camera),
    );
  });

  test("with no pointer yet, the visible centre is used", () => {
    const rect = { left: 20, top: 40, width: 400, height: 300 };
    const camera = { x: 10, y: 30, zoom: 2 };
    expect(pasteClientPoint(null, rect)).toEqual({ x: 220, y: 190 });
    expect(pasteWorldPoint(null, rect, camera)).toEqual(
      clientToWorld(220, 190, rect, camera),
    );
  });

  test("a plane that cannot be measured takes no card", () => {
    expect(
      pasteWorldPoint(
        { x: 1, y: 2 },
        { left: 0, top: 0, width: 0, height: 100 },
        { x: 0, y: 0, zoom: 1 },
      ),
    ).toBeNull();
    expect(
      pasteWorldPoint(
        { x: 1, y: 2 },
        { left: 0, top: 0, width: 100, height: 100 },
        { x: 0, y: 0, zoom: 0 },
      ),
    ).toBeNull();
  });

  test("the paste's URL is the same validator, not a looser one", () => {
    expect(pasteUrl("https://example.com")).toBe("https://example.com");
    expect(pasteUrl("not an address")).toBeNull();
    expect(pasteUrl("mailto:someone@example.com")).toBeNull();
  });
});

describe("paste is not a hijack", () => {
  test("text fields claim the paste; the canvas does not", () => {
    expect(isTextField({ tagName: "INPUT" })).toBe(true);
    expect(isTextField({ tagName: "input", type: "search" })).toBe(true);
    expect(isTextField({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextField({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
    for (const notAField of [
      null,
      { tagName: "INPUT", type: "button" },
      { tagName: "INPUT", type: "checkbox" },
      { tagName: "DIV" },
      { tagName: "BODY" },
      { tagName: "BUTTON" },
    ]) {
      expect(isTextField(notAField)).toBe(false);
    }
  });

  test("the focus rule is the level pin's own, not a second copy", () => {
    const paste = source("canvas/linkPaste.ts");
    expect(paste).toContain('from "./gates"');
    expect(paste).toContain("export { isTextField }");
    expect(paste).not.toContain("NON_TEXT_INPUTS");
  });

  test("either the target or the focused element being a field is enough", () => {
    const field = { tagName: "TEXTAREA" };
    const paper = { tagName: "DIV" };
    expect(pasteBelongsToField(field, paper)).toBe(true);
    expect(pasteBelongsToField(paper, field)).toBe(true);
    expect(pasteBelongsToField(paper, paper)).toBe(false);
  });

  test("the app asks the focus guard before it reads the clipboard", () => {
    const app = source("App.tsx");
    const guard = app.indexOf("pasteBelongsToField(target, active)");
    const read = app.indexOf('getData("text/plain")');
    expect(guard).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(guard);
    expect(app).toContain("dropBlocked(gesture, gestureMode");
  });

  test("plain text paste is out of scope and said so in code", () => {
    expect(source("canvas/linkPaste.ts")).toMatch(
      /there is no text-card[\s\S]{0,40}family yet/,
    );
    expect(source("App.tsx")).toContain("Plain text is out of scope");
  });
});

describe("one creator, one card-on-card rule, both doors", () => {
  test("the paste calls the bubble's page creator and never writes a file", () => {
    const app = source("App.tsx");
    expect(app).toMatch(
      /ground\s*\.createPage\(pasteName\(url\), origin\.x, origin\.y, url\)/,
    );
    // The drop hands the SAME creator to the pure rules.
    expect(app).toContain("ground.createPage,");
    // No second page writer, no fetch in a door: the creator is injected whole.
    for (const rel of ["canvas/osDrop.ts", "canvas/linkPaste.ts", "canvas/webLink.ts"]) {
      const text = source(rel);
      expect(text).not.toContain("writePageCard");
      expect(text).not.toContain("fetch(");
      expect(text).not.toContain("saveGround(");
    }
  });

  test("a paste onto a card creates nothing, checked before the creator", () => {
    const app = source("App.tsx");
    const rule = app.indexOf("dropLandsOnCard(document.elementFromPoint(client.x, client.y))");
    const create = app.indexOf(".createPage(pasteName(url)");
    expect(rule).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(rule);
    // 16.20's selector still names all three card families.
    expect(DROP_CARD_SELECTOR).toContain(".ground-reference");
    expect(
      dropLandsOnCard({ closest: (selector) => selector === DROP_CARD_SELECTOR ? {} : null }),
    ).toBe(true);
  });

  test("a native drop that carried nothing still says one sentence", () => {
    const app = source("App.tsx");
    expect(app).toContain("items.length === 0");
    expect(app).toContain("NOT_A_FILE_OR_LINK");
    // Never a fabricated file path or a second creator for it.
    expect(app).toMatch(/items\.length === 0[\s\S]{0,220}return;/);
  });

  test("the drop reads the same selector and asks before it makes anything", () => {
    const app = source("App.tsx");
    const rule = app.indexOf("dropLandsOnCard(document.elementFromPoint(drop.client.x, drop.client.y))");
    const create = app.indexOf("runOsDrop(");
    expect(rule).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(rule);
  });

  test("no record change: the doors import no writer and no record module", () => {
    for (const rel of ["canvas/osDrop.ts", "canvas/linkPaste.ts", "canvas/webLink.ts"]) {
      const text = source(rel);
      expect(text).not.toContain("save");
      expect(text).not.toContain("writeFile");
      expect(text).not.toContain("invoke(");
    }
  });
});
