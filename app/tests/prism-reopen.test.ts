import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  latestPrismIn,
  parsePrisms,
  rewritePrismExplanation,
  serializePrismLine,
  serializePrisms,
  type Prism,
  type PrismPointer,
  type ReadHeadChange,
} from "../src/map/prisms";
import { pointerKey } from "../src/map/pointers";

/**
 * Epic 12 story 2 — the reopen affordance and the explanation save, automated.
 *
 * RECORD != VISIBLE (ADR-0029 rule 6): the log is append-only, so one reach's
 * LATEST PRISM is the last readable line that cites it — one Prism or null,
 * never a list. The window's explanation is the person's own words on their own
 * Move: saved by an ID-addressed rewrite that changes only that line's
 * explanation field and keeps every other byte, order and multiplicity. And
 * the App's wiring is scanned: a completed Move appends one PRISM and opens
 * the window; the log button reads the record on demand (no gallery).
 */

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP_ROOT, "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

const POINTER: PrismPointer = { form: "path", value: "notes/x.md" };

function readHead(pointer: PrismPointer): ReadHeadChange {
  return {
    kind: "read-head",
    pointer: pointerKey("rain", pointer.form, pointer.value),
    outcome: "read",
    bounds: { maxLines: 20, maxBytes: 1600 },
    decode: "clean",
  };
}

function prismOf(
  id: string,
  contact: "look" | "measure",
  pointer: PrismPointer = POINTER,
  over: Partial<Prism> = {},
): Prism {
  return {
    id,
    on: "rain",
    contact,
    pointer,
    changes: [readHead(pointer)],
    explanation: "",
    extra: {},
    ...over,
  };
}

const LOOK = prismOf("prism-1", "look");
const MEASURE = prismOf("prism-2", "measure");
const TWO = serializePrisms([LOOK, MEASURE]);

describe("the reopen rule: this reach's LATEST PRISM, one or null", () => {
  test("the last matching line in FILE order is the latest Move", () => {
    const latest = latestPrismIn(TWO, "rain", POINTER);
    expect(latest).not.toBeNull();
    expect(latest?.id).toBe("prism-2");
    expect(latest?.contact).toBe("measure");
  });

  test("a contact narrows the citation when one is named", () => {
    expect(latestPrismIn(TWO, "rain", POINTER, "look")?.id).toBe("prism-1");
    expect(latestPrismIn(TWO, "rain", POINTER, "measure")?.id).toBe("prism-2");
    expect(latestPrismIn(TWO, "rain", POINTER, "ask")).toBeNull();
  });

  test("another anchor, form or value is a different reach", () => {
    expect(latestPrismIn(TWO, "sea", POINTER)).toBeNull();
    expect(
      latestPrismIn(TWO, "rain", { form: "at", value: "notes/x.md" }),
    ).toBeNull();
    expect(
      latestPrismIn(TWO, "rain", { form: "path", value: "notes/y.md" }),
    ).toBeNull();
    // A pointer-less Ask is keyed by none, not by this pointer.
    expect(latestPrismIn(TWO, "rain", null)).toBeNull();
  });

  test("a malformed line never hides a readable one", () => {
    const text = [serializePrismLine(LOOK), "{not json}", serializePrismLine(MEASURE), ""].join("\n");
    expect(latestPrismIn(text, "rain", POINTER)?.id).toBe("prism-2");
  });

  test("no lines (or only malformed ones) is null, never a list", () => {
    expect(latestPrismIn("", "rain", POINTER)).toBeNull();
    expect(latestPrismIn("{bad}\n", "rain", POINTER)).toBeNull();
    // The API's shape is ONE Prism or null.
    const latest = latestPrismIn(TWO, "rain", POINTER);
    expect(Array.isArray(latest)).toBe(false);
  });

  test("the record module exposes no listing or counting accessor", () => {
    const prisms = source("map/prisms.ts");
    expect(prisms).toContain("export function latestPrismIn(");
    expect(prisms).toContain("export async function loadLatestPrism(");
    for (const name of [
      "listPrisms",
      "countPrisms",
      "allPrisms",
      "prismsBy",
      "prismSummary",
    ]) {
      expect(prisms).not.toContain(name);
    }
    // latestPrismIn answers one, by citation, and says so in its signature.
    const start = prisms.indexOf("export function latestPrismIn(");
    const signature = prisms.slice(start, prisms.indexOf(") {", start));
    expect(signature).toContain("): Prism | null");
  });
});

describe("the explanation save: one ID-addressed line, every other byte kept", () => {
  const handLine = '{"hand":"line"}';

  test("only the addressed line's explanation changes; order, bytes and unknowns hold", () => {
    const text = [
      serializePrismLine(LOOK),
      serializePrismLine(MEASURE),
      handLine,
      "",
    ].join("\n");
    const prose = "I looked because the plan said so.";
    const next = rewritePrismExplanation(text, "prism-1", prose);
    expect(next).not.toBeNull();
    const lines = (next as string).split("\n");
    expect(lines).toHaveLength(4);
    // Line 2 and the malformed hand line are byte-for-byte untouched.
    expect(lines[1]).toBe(serializePrismLine(MEASURE));
    expect(lines[2]).toBe(handLine);
    // The addressed line kept everything but its explanation field.
    const parsed = parsePrisms(next as string);
    expect(parsed.malformed).toEqual([handLine]);
    expect(parsed.prisms).toHaveLength(2);
    expect(parsed.prisms[0].id).toBe("prism-1");
    expect(parsed.prisms[0].on).toBe(LOOK.on);
    expect(parsed.prisms[0].contact).toBe(LOOK.contact);
    expect(parsed.prisms[0].pointer).toEqual(LOOK.pointer);
    expect(parsed.prisms[0].changes).toEqual(LOOK.changes);
    expect(parsed.prisms[0].explanation).toBe(prose);
    // Never an append and never a merge.
    expect(lines.filter((line) => line !== "").length).toBe(3);
  });

  test("the person's prose is stored VERBATIM (never trimmed or interpreted)", () => {
    const prose = "  first line\n\tsecond line — with a dash  ";
    const next = rewritePrismExplanation(TWO, "prism-2", prose) as string;
    expect(parsePrisms(next).prisms[1].explanation).toBe(prose);
  });

  test("an unknown id is not saved: the text comes back null (nothing written)", () => {
    expect(rewritePrismExplanation(TWO, "prism-nope", "why")).toBeNull();
    expect(rewritePrismExplanation("", "prism-1", "why")).toBeNull();
  });

  test("an unchanged explanation is no rewrite at all (the bytes come back)", () => {
    // A hand-formatted line whose explanation is already the requested one is
    // returned exactly, never re-canonicalized.
    const hand = serializePrismLine(LOOK).replace('{"changes"', '{ "changes"');
    expect(rewritePrismExplanation(hand, "prism-1", "")).toBe(hand);
    expect(rewritePrismExplanation(TWO, "prism-1", "")).toBe(TWO);
  });

  test("a CRLF line keeps its own terminator", () => {
    const crlf = serializePrisms([LOOK]).replace(/\n/g, "\r\n");
    const next = rewritePrismExplanation(crlf, "prism-1", "why") as string;
    expect(next.replace(/\r\n/g, "")).not.toContain("\n");
    expect(parsePrisms(next).prisms[0].explanation).toBe("why");
  });

  test("unknown keys on the edited line survive the save", () => {
    const withExtra = prismOf("prism-1", "look", POINTER, {
      extra: { note: "why", rank: 3 },
    });
    const next = rewritePrismExplanation(
      serializePrisms([withExtra]),
      "prism-1",
      "mine",
    ) as string;
    const parsed = parsePrisms(next).prisms[0];
    expect(parsed.extra).toEqual({ note: "why", rank: 3 });
    expect(parsed.explanation).toBe("mine");
  });

  test("the save never appends a line and never changes multiplicity", () => {
    const before = parsePrisms(TWO);
    const next = rewritePrismExplanation(TWO, "prism-1", "one") as string;
    const after = parsePrisms(next);
    expect(after.prisms).toHaveLength(before.prisms.length);
    expect(after.prisms.map((prism) => prism.id)).toEqual(
      before.prisms.map((prism) => prism.id),
    );
    expect(after.malformed).toEqual(before.malformed);
  });
});

describe("the App's wiring: the window at completion, the log on demand", () => {
  const app = source("App.tsx");
  const chooser = source("canvas/PointerChooser.tsx");

  test("a completed read Move opens the ONE Move's window", () => {
    expect(app).toContain("await runReadMove({");
    expect(app).toContain("<PrismWindow");
    expect(app).toContain("prismAt");
    // The handler names the contact (the PRISM header's verb) and the anchor.
    expect(app).toContain('readFromPointer("look", pointer)');
    expect(app).toContain('readFromPointer("measure", pointer)');
    // Exactly one Move call in the app: the peek's transient path has none.
    expect(app.match(/runReadMove\(/g)?.length).toBe(1);
  });

  test("the log button reads the reach's latest PRISM, not a gallery", () => {
    expect(app).toContain("readLatestPrism(");
    expect(app).toContain("reopenPrism");
    expect(chooser).toContain("onLog(pointer)");
    // The whole series is never loaded into the app: no list state, no parse.
    expect(app).not.toContain("loadPrisms(");
    expect(app).not.toContain("parsePrisms(");
    expect(app).not.toMatch(/useState<Prism\[\]>/);
    expect(app).not.toContain("setPrisms");
  });

  test("the window holds ONE Move: prismAt is a single Prism or null", () => {
    expect(app).toContain("const [prismAt, setPrismAt] = useState<{");
    expect(app).toContain("prism: Prism | null;");
    expect(app).not.toContain("prismAt: Prism[]");
    // Ground only: the pointer's reach is the ground game's (ADR-0019), so
    // Level 1 and Level 2 render no PRISM window (and no chooser).
    expect(app).toContain('{level === "ground" && prismAt && (');
  });

  test("the chooser carries look, measure and the log; a url gets no head read", () => {
    expect(chooser).toContain('className="pointer-contact pointer-look"');
    expect(chooser).toContain('className="pointer-contact pointer-measure"');
    expect(chooser).toContain('className="pointer-contact pointer-log"');
    expect(chooser).toContain("onLook(pointer)");
    expect(chooser).toContain("onMeasure(pointer)");
    // The head-read buttons live inside the url guard; the log stays for every
    // reach (a url can carry a PRISM later, from the egress story).
    const guardAt = chooser.indexOf('pointer.form !== "url"');
    const logAt = chooser.indexOf("pointer-log");
    expect(guardAt).toBeGreaterThan(-1);
    expect(logAt).toBeGreaterThan(guardAt);
    const guarded = chooser.slice(guardAt, logAt);
    expect(guarded).toContain("pointer-look");
    expect(guarded).toContain("pointer-measure");
    expect(guarded).not.toContain("pointer-log");
  });

  test("the explanation save is the window's only write, and it is id-addressed", () => {
    expect(app).toContain("savePrismExplanation(workspace.path, id, explanation)");
    expect(app).toContain("onSaveExplanation");
    // The window itself never imports a writer: it calls the callback.
    const windowSource = source("canvas/PrismWindow.tsx");
    expect(windowSource).not.toContain("appendPrismLine");
    expect(windowSource).not.toContain("mintPrismId");
    expect(windowSource).not.toContain("rewritePrismExplanation");
  });

  test("a level switch closes the PRISM window with every other transient", () => {
    expect(app).toContain("closePrismQuietly()");
    const cancel = app.slice(
      app.indexOf("const cancelPendingGestures"),
      app.indexOf("const openGhostPreview"),
    );
    expect(cancel).toContain("closePrismQuietly()");
    // Rename/removal closes the window on its moving word.
    expect(app).toContain("closePrismFor(candidate.slug)");
  });
});
