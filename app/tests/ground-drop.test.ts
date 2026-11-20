import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOT_A_FILE_OR_LINK } from "../src/canvas/webLink";
import {
  BESIDE_OFFSET_X,
  clientToWorld,
} from "../src/canvas/geometry";
import {
  DROP_CARD_SELECTOR,
  dropBlocked,
  dropCardName,
  dropLandsOnCard,
  dropSentence,
  dropWorldPoint,
  planDrop,
  runOsDrop,
  type DropWriter,
} from "../src/canvas/osDrop";
import { GESTURE_IDLE } from "../src/canvas/gestureWord";
import {
  takeReading,
  type ReadingIo,
} from "../src/map/readings";

/**
 * STORY 16.20 — DROP A FILE WHERE YOU ARE POINTING.
 *
 * The story's check is human (drag files onto a real window). This file pins
 * the rules underneath it:
 *
 *   - the point is the plane's OWN pointer→world conversion — the SAME helper
 *     the double-click uses, asserted by source, not by a copied formula;
 *   - several files cascade on x by the existing beside-the-card offset, in the
 *     OS's order;
 *   - the SAME intent rules decide a file (text / PDF / image), and an unknown
 *     type is refused before anything is read;
 *   - a mixed drop creates what it can and answers ONE collapsed sentence;
 *   - a drop during a card drag or a wire drag is ignored, and a drop onto a
 *     card creates nothing;
 *   - a failed conversion and a failed read write nothing.
 *
 * PROVISIONAL (the story's seams): the naming rule, the sentences and where
 * the window's listener lives.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-drop-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** A writer that records what the drop asked it to create. */
function logger(): {
  create: DropWriter;
  calls: { name: string; x: number; y: number; from: string }[];
} {
  const calls: { name: string; x: number; y: number; from: string }[] = [];
  return {
    calls,
    create: async (name, x, y, from) => {
      calls.push({ name, x, y, from });
      return { ok: true };
    },
  };
}

describe("the pointer is the plane's own conversion", () => {
  test("clientToWorld is the arithmetic the camera defines", () => {
    expect(
      clientToWorld(220, 140, { left: 20, top: 40 }, { x: 10, y: 30, zoom: 2 }),
    ).toEqual({ x: 95, y: 35 });
  });

  test("CanvasPlane delegates its double-click point to the one helper", () => {
    const plane = source("canvas/CanvasPlane.tsx");
    expect(plane).toContain('import { clientToWorld, type Point } from "./geometry"');
    expect(plane).toMatch(/pointFromClient[\s\S]{0,400}return clientToWorld\(/);
    // The plane's own drafts (lasso, pen, selection) ask the same helper.
    expect(plane).not.toContain("/ cam.zoom");
  });

  test("the drop uses that helper and never re-derives the transform", () => {
    const drop = source("canvas/osDrop.ts");
    expect(drop).toContain("clientToWorld(");
    // The formula lives in exactly one place: geometry.ts.
    expect(drop).not.toContain("/ camera.zoom");
    expect(drop).not.toContain("- rect.left");
  });

  test("the app hears the OS drop in ONE place and hands it to the pure rules", () => {
    const app = source("App.tsx");
    expect(app).toContain('from "./canvas/osDropWindow"');
    expect(app).toContain("listenOsDrop(");
    expect(app).toContain("runOsDrop(");
    expect(app).toContain("[...drop.paths, ...drop.links]");
    // 16.34: a LINK goes to the page card's EXISTING creator.
    expect(app).toContain("ground.createPage,");
    expect(app).toMatch(/\[.+\.drop\.paths, \.\.\.drop\.links\][\s\S]{0,800}ground\.createPage,/);
    // No new writer: the drop names the SAME creation path the bubble uses.
    expect(app).not.toContain("addGroundReference(");
  });
});

describe("what a drop plans", () => {
  test("one file lands on the pointer", () => {
    const plan = planDrop(["/tmp/garden notes.md"], { x: 100, y: 50 });
    expect(plan.unknown).toBe(0);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toEqual({
      path: "/tmp/garden notes.md",
      name: "garden notes",
      at: { x: 100, y: 50 },
    });
  });

  test("three files cascade on x in the OS's order", () => {
    const plan = planDrop(["/tmp/a.md", "/tmp/b.txt", "/tmp/c.pdf"], {
      x: 100,
      y: 50,
    });
    expect(plan.items.map((item) => item.name)).toEqual(["a", "b", "c"]);
    expect(plan.items.map((item) => item.at)).toEqual([
      { x: 100, y: 50 },
      { x: 100 + BESIDE_OFFSET_X, y: 50 },
      { x: 100 + BESIDE_OFFSET_X * 2, y: 50 },
    ]);
  });

  test("an unknown type is refused before a byte is read", () => {
    const plan = planDrop(["/tmp/archive.zip"], { x: 0, y: 0 });
    expect(plan.items).toEqual([]);
    expect(plan.unknown).toBe(1);
  });

  test("an image and a PDF keep their kinds (the same intent rules)", () => {
    const plan = planDrop(["/tmp/photo.png", "/tmp/paper.PDF"], { x: 0, y: 0 });
    expect(plan.items.map((item) => item.path)).toEqual([
      "/tmp/photo.png",
      "/tmp/paper.PDF",
    ]);
    expect(plan.unknown).toBe(0);
  });

  test("the card's name is the file's stem, and a hidden name keeps its dot", () => {
    expect(dropCardName("/tmp/garden notes.md")).toBe("garden notes");
    expect(dropCardName("C:\\notes\\garden.pdf")).toBe("garden");
    expect(dropCardName("/tmp/.gitignore")).toBe(".gitignore");
    expect(dropCardName("/tmp/no-extension")).toBe("no-extension");
  });
});

describe("a drop creates through the existing path, or says one sentence", () => {
  test("a single drop makes one card at the converted point", async () => {
    const { create, calls } = logger();
    const outcome = await runOsDrop(["/tmp/garden notes.md"], { x: 95, y: 35 }, create);
    expect(calls).toEqual([
      { name: "garden notes", x: 95, y: 35, from: "/tmp/garden notes.md" },
    ]);
    expect(outcome).toEqual({ added: 1, skipped: 0, notice: null });
  });

  test("three files make three cards, cascading", async () => {
    const { create, calls } = logger();
    const outcome = await runOsDrop(
      ["/tmp/a.md", "/tmp/b.txt", "/tmp/c.pdf"],
      { x: 10, y: 20 },
      create,
    );
    expect(calls.map((call) => call.x)).toEqual([
      10,
      10 + BESIDE_OFFSET_X,
      10 + BESIDE_OFFSET_X * 2,
    ]);
    expect(outcome).toEqual({ added: 3, skipped: 0, notice: null });
  });

  test("an unsupported type makes nothing and says so once", async () => {
    const { create, calls } = logger();
    const outcome = await runOsDrop(["/tmp/archive.zip"], { x: 0, y: 0 }, create);
    expect(calls).toEqual([]);
    expect(outcome).toEqual({
      added: 0,
      skipped: 1,
      notice: NOT_A_FILE_OR_LINK,
    });
  });

  test("a folder's failed read makes nothing and keeps its own sentence", async () => {
    // A folder has no extension, so the text read is attempted — and refuses
    // before any record is written (the creation path's own order).
    const refused: DropWriter = async () => ({
      ok: false,
      message: "cannot reach that file.",
    });
    const outcome = await runOsDrop(["/tmp/some-folder"], { x: 0, y: 0 }, refused);
    expect(outcome).toEqual({
      added: 0,
      skipped: 1,
      notice: "cannot reach that file.",
    });
  });

  test("a mixed drop creates the good ones and collapses ONE sentence", async () => {
    const calls: string[] = [];
    const create: DropWriter = async (name, _x, _y, from) => {
      calls.push(from);
      if (from.endsWith(".pdf")) {
        return { ok: false, message: "that PDF has no text to read." };
      }
      return { ok: true };
    };
    const outcome = await runOsDrop(
      ["/tmp/good.md", "/tmp/scan.pdf", "/tmp/archive.zip"],
      { x: 0, y: 0 },
      create,
    );
    expect(calls).toEqual(["/tmp/good.md", "/tmp/scan.pdf"]);
    expect(outcome.added).toBe(1);
    expect(outcome.skipped).toBe(2);
    expect(outcome.notice).toBe("added 1 reference; skipped 2 items.");
  });

  test("several refusals with nothing added collapse into one count", () => {
    expect(dropSentence(0, 2, null)).toBe(
      "nothing was added: 2 items could not be added.",
    );
    expect(dropSentence(0, 1, "that PDF has no text to read.")).toBe(
      "that PDF has no text to read.",
    );
  });

  test("a failed read reaches no writer and leaves no reading", async () => {
    const workspace = mkdtempSync(join(ROOT, "workspace-"));
    mkdirSync(join(workspace, "map"), { recursive: true });
    const writes: string[] = [];
    const io: ReadingIo = {
      readTextFile: async () => null,
      // The bridge says the path is not a regular file — a folder's answer.
      readTextHead: async () => {
        throw { code: "cannot-reach", detail: null };
      },
      writeTextFile: async (path) => {
        writes.push(path);
      },
      createDirAll: async () => {},
      fileMeta: async () => ({ kind: "refused" }),
      readFileBytes: async () => ({ kind: "refused", code: "io" }),
      pdfText: async () => null,
    };
    const taken = await takeReading(workspace, "folder", "/tmp/some-folder", io);
    expect(taken.kind).toBe("refused");
    expect(writes).toEqual([]);
    expect(existsSync(join(workspace, "map", "readings", "folder.md"))).toBe(false);
  });
});

describe("the drop never interrupts a gesture", () => {
  test("a card drag and a wire drag both refuse the drop", () => {
    expect(dropBlocked({ kind: "moving", name: "garden" }, false)).toBe(true);
    expect(dropBlocked({ kind: "wiring" }, false)).toBe(true);
  });

  test("an armed tool refuses it; idle paper accepts it", () => {
    expect(dropBlocked(GESTURE_IDLE, true)).toBe(true);
    expect(dropBlocked(GESTURE_IDLE, false)).toBe(false);
  });

  test("a drop onto any of the three card kinds creates nothing", () => {
    expect(dropLandsOnCard(null)).toBe(false);
    const card = { closest: (selector: string) => (selector === DROP_CARD_SELECTOR ? {} : null) };
    expect(dropLandsOnCard(card)).toBe(true);
    const plane = { closest: () => null };
    expect(dropLandsOnCard(plane)).toBe(false);
  });

  test("a conversion that cannot answer writes nothing", () => {
    const client = { x: 10, y: 20 };
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(
      dropWorldPoint(client, { left: 0, top: 0, width: 0, height: 100 }, camera),
    ).toBeNull();
    expect(
      dropWorldPoint(client, { left: 0, top: 0, width: 100, height: 100 }, {
        ...camera,
        zoom: 0,
      }),
    ).toBeNull();
    expect(
      dropWorldPoint(
        client,
        { left: 0, top: 0, width: 100, height: 100 },
        { ...camera, x: Number.NaN },
      ),
    ).toBeNull();
    expect(
      dropWorldPoint(
        client,
        { left: 0, top: 0, width: 100, height: 100 },
        camera,
      ),
    ).toEqual({ x: 10, y: 20 });
  });
});
