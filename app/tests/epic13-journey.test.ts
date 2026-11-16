import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAssumptions, serializeAssumptions } from "../src/map/assumptions";
import { parseMarks, serializeMarks } from "../src/map/marks";
import { parsePointers, serializePointers } from "../src/map/pointers";
import { parseQuantities, serializeQuantities } from "../src/map/quantities";
import { parseVeils, serializeVeils, type Veil } from "../src/map/veils";
import { parsePins, serializePins } from "../src/scenarios/pins";
import { askPull, pullRecordSet, type PullAskSource } from "../src/pull/ask";
import { projectVeil } from "../src/pull/projection";
import {
  DANGLING_PIN_NOTE,
  PULL_SELECTION,
  pullSiteKey,
  type PullReading,
  type PullRecordSite,
  type PullSite,
  type PullVeilSite,
} from "../src/pull/reader";
import { PullDoor } from "../src/canvas/PullDoor";
import { PullPanel } from "../src/canvas/PullPanel";
import {
  PULL_CLOSE_LABEL,
  PULL_DOOR_LABEL,
  PULL_DOOR_TITLE,
  PULL_PANEL_LABEL,
  PULL_TITLE,
  pullLines,
  pullSiteLines,
} from "../src/canvas/pullRules";

/**
 * Epic 13 story 3 — THE EPIC CHECK, automated at the RECORD layer.
 *
 * The locked check (Epic 13 check and slice, its Answer) has three homes, kept
 * apart on purpose:
 *   - THIS FILE walks the PORT-ASSERTED half, in the check's own order: the
 *     door is the only trigger; the reading opens with its selection SAID; every
 *     read-set record shows at its OWN site, verbatim (marks — the wordless
 *     pair; assumptions — the text at its target; quantities — the line at its
 *     anchor; pointers incl. dangling pins; veils — name and location only; the
 *     scenario pins); the veil projection is structural (the reader holds no
 *     veil record; no reason field anywhere in the reading, asserted on the
 *     JSON); the failed-prediction constituents stand at their own sites as
 *     co-presence, never arranged; closing writes NOTHING (fs-level: the fixture
 *     tree byte-identical after ask / close / ask again); asking again returns
 *     the same record SET, never a sequence; and the negative space (no count,
 *     no order, no cursor, no score, no badge, no cue; the chrome is the said
 *     sentence and the close; an empty map invents nothing). The named scans
 *     hold: the reader's importer is exactly the pull-ask handler; no
 *     mount/render/effect/timer path; no badge/dot/count/cue strings; no
 *     fail/wrong/differ/contradict strings; the contacts' Ask phrase absent from
 *     src. The retired phrases stay retired.
 *   - The HUMAN-ONLY legs stay QUEUED and are deliberately NOT asserted: the
 *     say-it ("these two say different things" — the person's act aloud), the
 *     close FEEL (the whiteboard's dismissal in the real window) and the door's
 *     discoverability. A test cannot run a human's glance or judgment; the
 *     record half above it is what can be pinned.
 *   - The journey's live words live in the JOURNAL (story 3's build entry): the
 *     say-it is the person's, and no metric answers it.
 *
 * The check's own words: "Open the pull ask (the door's own quiet button — the
 * ONLY trigger): 'where am I thin?' The reading opens with its selection SAID:
 * 'this speaks where records exist; the rest is silence, not safety.' Every
 * read-set record shows at its OWN site, verbatim ... the reader's projection
 * exposes those fields and nothing else (its reason is not merely hidden — it is
 * outside the reader's reach). The wording reports; it never directs. ... Say it
 * aloud yourself: 'these two say different things' — that sentence is yours; the
 * map never says it (and never says failed, wrong, differ or contradict). Close
 * the reading: the pull wrote NOTHING at all (no file, no log, no storage —
 * port-leg assertable). Ask again: the same record SET returns (set identity —
 * not a sequence). No count, no order, no cursor, no score, no badge, no cue
 * anywhere that a pull is waiting."
 *
 * The fixture is the project's own rain / mulch / soil world on a REAL temp
 * workspace: every read-set family (with a dangling pin and a standing pin), a
 * veil carrying its prose reason, and one word ("plant") on the map with no
 * records at all — the reading must stay silent about it.
 *
 * Provisional (the reading's edge, named honestly): the transient's chrome
 * carries its own name ("the pull") beside the close; take the name and the
 * close away and the chrome is EXACTLY the selection sentence — nothing else is
 * composed. And a pair's SIGN is not a read-set record (links are not in
 * ADR-0030 decision 5's set): the constituents the pull reads are the claim's
 * text and the pair's own wordless mark, and the person reads the sign on the
 * plane — that reading is theirs, never the module's.
 */

const NL = "\n";
const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** The source without its comment blocks and line comments. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The code without its import statements (import paths are not data). */
function bodyOnly(text: string): string {
  return codeOnly(text).replace(/import[\s\S]*?from\s+"[^"]+";/g, "");
}

/** Every .ts/.tsx file under src/, as posix paths relative to src/. */
function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(relative(SRC, full).split("\\").join("/"));
    }
  }
  return out;
}

/** Every module specifier a source file imports from. */
function specifiersOf(text: string): string[] {
  return [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
}

/** The src-relative path a file's relative import resolves to, or null. */
function resolveSpecifier(file: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  return relative(SRC, resolve(SRC, dirname(file), spec))
    .split("\\")
    .join("/");
}

/** Files whose import specifiers resolve to the target (excluding itself). */
function importersOf(target: string): string[] {
  return sourceFiles().filter((file) => {
    if (file === target + ".ts" || file === target + ".tsx") return false;
    return specifiersOf(source(file)).some(
      (spec) => resolveSpecifier(file, spec) === target,
    );
  });
}

/* ========================================================================= *
 * The fixture workspace: the app's own files, as the app writes them.
 * ========================================================================= */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-epic13-"));

const FILES: Record<string, string> = {
  "map/marks.jsonl": [
    '{"kind":"open","on":"rain"}',
    '{"from":"rain","kind":"open","to":"soil"}',
    '{"kind":"open","on":"rain","path":"notes/rain.md"}',
    '{"kind":"open","x":-40,"y":12.5}',
  ]
    .map((line) => line + NL)
    .join(""),
  "map/assumptions.jsonl": [
    '{"on":"rain","text":"mulch holds the rain"}',
    '{"on":"rain","text":"the bed is wide"}',
    '{"on":"mulch","text":"the mulch keeps the rain"}',
    '{"from":"rain","text":"the pair carries water","to":"soil"}',
    '{"loop":"rain-loop","text":"the loop is reinforcing"}',
    '{"text":"something is missing here","x":40,"y":60}',
  ]
    .map((line) => line + NL)
    .join(""),
  "map/quantities.jsonl": [
    '{"amount":12,"on":"rain"}',
    '{"from":"rain","to":"soil"}',
  ]
    .map((line) => line + NL)
    .join(""),
  "map/pointers.jsonl": [
    '{"on":"rain","path":"notes/rain.md"}',
    '{"on":"soil","url":"https://example.org/soil"}',
    '{"at":"/home/someone/garden.csv","on":"soil"}',
  ]
    .map((line) => line + NL)
    .join(""),
  "scenarios/spring/assumption-pins.jsonl": [
    '{"on":"rain","text":"mulch holds the rain"}',
    '{"on":"mulch","text":"the mulch keeps the rain"}',
    '{"from":"rain","text":"the pair carries water","to":"soil"}',
    '{"on":"rain","text":"mulch holds the rain every day"}',
  ]
    .map((line) => line + NL)
    .join(""),
  "map/veils.jsonl":
    '{"h":200,"name":"rain cover","reason":"the soil records are muddled","w":300,"x":120.5,"y":-40.25}' +
    NL,
  // A word on the map with NO records at all. The reading must not invent a site
  // for it: parts nobody marked read as SILENCE, never as settled.
  "map/references/plant.md":
    '---\nname: "plant"\nx: 220\ny: 120\n---\nthe bed is wide\n',
};

for (const [rel, text] of Object.entries(FILES)) {
  const path = join(ROOT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function textOf(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** The fixture's lines, as the files hold them. */
function fileLines(rel: string): string[] {
  return textOf(rel)
    .split(NL)
    .filter((line) => line !== "");
}

/** The records as the app holds them, over the fixture (a branch running). */
function fixtureSource(reverse = false): PullAskSource {
  const order = <T,>(items: readonly T[]): readonly T[] =>
    reverse ? [...items].reverse() : items;
  return {
    marks: order(parseMarks(textOf("map/marks.jsonl")).marks),
    assumptions: order(
      parseAssumptions(textOf("map/assumptions.jsonl")).assumptions,
    ),
    quantities: order(
      parseQuantities(textOf("map/quantities.jsonl")).quantities,
    ),
    pointers: order(parsePointers(textOf("map/pointers.jsonl")).pointers),
    veils: order(parseVeils(textOf("map/veils.jsonl")).veils),
    pins: order(
      parsePins(textOf("scenarios/spring/assumption-pins.jsonl")).pins,
    ),
  };
}

function reading(reverse = false): PullReading {
  return askPull(fixtureSource(reverse));
}

function sitesOf(result: PullReading, family: string): PullSite[] {
  return result.sites.filter((site) => site.family === family);
}

function recordSites(result: PullReading, family: string): PullRecordSite[] {
  return sitesOf(result, family) as PullRecordSite[];
}

function wordsOf(result: PullReading, family: string): string[] {
  return recordSites(result, family).map((site) => site.words);
}

/** The fixture's one veil record (the reader never sees this). */
function veilRecord(): Veil {
  return parseVeils(textOf("map/veils.jsonl")).veils[0];
}

const VEIL_NAME = "rain cover";
const VEIL_REASON = "the soil records are muddled";
const VEIL_LOCATION = "x 120.5, y -40.25, w 300, h 200";

/** The pull's three modules (the record layer: nothing here renders). */
const PULL_FILES = ["pull/reader.ts", "pull/projection.ts", "pull/ask.ts"];

/** The surface's files (the door, the transient, its words). */
const SURFACE_FILES = [
  "canvas/PullDoor.tsx",
  "canvas/PullPanel.tsx",
  "canvas/pullRules.ts",
];

function noop() {}

/* ========================================================================= *
 * Render helpers: the reading's chrome and its one block, read exactly.
 * ========================================================================= */

function renderPanel(result: PullReading): string {
  return renderToStaticMarkup(
    createElement(PullPanel, { reading: result, onClose: noop }),
  );
}

/** Decode the five entities ReactDOM escapes in text. */
function decodeText(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** One text block's exact contents (whitespace preserved, entities decoded). */
function blockText(html: string, className: string): string {
  const marker = '<div class="' + className + '">';
  const start = html.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const from = start + marker.length;
  const to = html.indexOf("</div>", from);
  expect(to).toBeGreaterThanOrEqual(from);
  return decodeText(html.slice(from, to));
}

/** The markup with one text block cut out (its chrome, so to speak). */
function withoutBlock(html: string, className: string): string {
  const marker = '<div class="' + className + '">';
  const start = html.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const to = html.indexOf("</div>", start);
  return html.slice(0, start) + html.slice(to + "</div>".length);
}

/** The markup's TEXT, tags dropped and runs of whitespace collapsed. */
function textOfMarkup(html: string): string {
  return decodeText(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Every key at any depth of a JSON-shaped value. */
function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...keysDeep(child),
  ]);
}

/** Do two readings carry exactly the same SET of site identities? */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}

/** Every file under the fixture root, as posix paths, with its exact bytes. */
function tree(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        out[relative(ROOT, full).split("\\").join("/")] = readFileSync(
          full,
          "utf8",
        );
      }
    }
  };
  walk(ROOT);
  return out;
}

/* ========================================================================= *
 * (a) The door is the only trigger; the reading opens with its selection SAID.
 * ========================================================================= */

describe("(a) the door is the ONLY trigger, and the reading opens with its selection SAID", () => {
  test("the door is one quiet button with a still label — pressing it is the ask", () => {
    const html = renderToStaticMarkup(createElement(PullDoor, { onOpen: noop }));
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain('class="pull-door"');
    expect(html).toContain(PULL_DOOR_LABEL);
    expect(html).toContain(PULL_DOOR_TITLE);
    // The person's question, never a number, never a cue.
    expect(PULL_DOOR_LABEL).toBe("where am I thin…");
    expect(html).not.toMatch(/badge|\bdot\b|count|\bcue\b|score|streak|glow/i);
    // The button is inert: a label, a title, one press.
    const door = source("canvas/PullDoor.tsx");
    expect(door).toContain("onClick={onOpen}");
    expect(bodyOnly(door)).not.toMatch(
      /useEffect|useState|setInterval|setTimeout|addEventListener|subscribe/,
    );
  });

  test("the reader's importer allowlist is exactly the pull-ask handler", () => {
    expect(importersOf("pull/reader")).toEqual(["pull/ask.ts"]);
    expect(importersOf("pull/projection").sort()).toEqual([
      "pull/ask.ts",
      "pull/reader.ts",
    ]);
    // The ONE handler is the reader's only caller, and it is called from the
    // app's one press callback and nowhere else.
    const callers = sourceFiles().filter(
      (file) =>
        file !== "pull/reader.ts" && bodyOnly(source(file)).includes("readPull("),
    );
    expect(callers).toEqual(["pull/ask.ts"]);
    const app = source("App.tsx");
    expect(app.match(/askPull\(/g) ?? []).toHaveLength(1);
    const start = app.indexOf("const openPullAsk = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = app.indexOf("veils,\n  ]);", start);
    expect(end).toBeGreaterThan(start);
    const open = app.slice(start, end);
    expect(open).toContain("askPull(");
    expect(open).toContain("setPullReading(");
    for (const ambient of [
      "useEffect",
      "useLayoutEffect",
      "setInterval",
      "setTimeout",
      "addEventListener",
      "subscribe",
      "requestAnimationFrame",
    ]) {
      expect({ ambient, found: open.includes(ambient) }).toEqual({
        ambient,
        found: false,
      });
    }
  });

  test("the reading opens with the selection SAID, in the reader's own words", () => {
    expect(PULL_SELECTION).toBe(
      "this speaks where records exist; the rest is silence, not safety.",
    );
    expect(reading().said).toBe(PULL_SELECTION);
    const html = renderPanel(reading());
    expect(blockText(html, "pull-said")).toBe(PULL_SELECTION);
    // SAID first: the selection precedes the sites, always.
    expect(html.indexOf("pull-said")).toBeLessThan(html.indexOf("pull-lines"));
  });
});

/* ========================================================================= *
 * (b) The walk: every family at its OWN site, with its own words.
 * ========================================================================= */

describe("(b) every read-set record shows at its OWN site, verbatim", () => {
  test("the fixture is the app's own bytes (canonical round-trip, no malformed line)", () => {
    const marks = textOf("map/marks.jsonl");
    const parsedMarks = parseMarks(marks);
    expect(parsedMarks.malformed).toEqual([]);
    expect(serializeMarks(parsedMarks.marks)).toBe(marks);

    const assumptions = textOf("map/assumptions.jsonl");
    const parsedAssumptions = parseAssumptions(assumptions);
    expect(parsedAssumptions.malformed).toEqual([]);
    expect(parsedAssumptions.duplicates).toEqual([]);
    expect(serializeAssumptions(parsedAssumptions.assumptions)).toBe(assumptions);

    const quantities = textOf("map/quantities.jsonl");
    const parsedQuantities = parseQuantities(quantities);
    expect(parsedQuantities.malformed).toEqual([]);
    expect(serializeQuantities(parsedQuantities.quantities)).toBe(quantities);

    const pointers = textOf("map/pointers.jsonl");
    const parsedPointers = parsePointers(pointers);
    expect(parsedPointers.malformed).toEqual([]);
    expect(serializePointers(parsedPointers.pointers)).toBe(pointers);

    const pins = textOf("scenarios/spring/assumption-pins.jsonl");
    const parsedPins = parsePins(pins);
    expect(parsedPins.malformed).toEqual([]);
    expect(serializePins(parsedPins.pins)).toBe(pins);

    const veils = textOf("map/veils.jsonl");
    const parsedVeils = parseVeils(veils);
    expect(parsedVeils.malformed).toEqual([]);
    expect(serializeVeils(parsedVeils.veils)).toBe(veils);
  });

  test("every family is walked, and no family is invented", () => {
    const result = reading();
    expect(new Set(result.sites.map((site) => site.family))).toEqual(
      new Set(["mark", "assumption", "quantity", "pointer", "pin", "veil"]),
    );
    expect(sitesOf(result, "mark")).toHaveLength(4);
    expect(sitesOf(result, "assumption")).toHaveLength(6);
    expect(sitesOf(result, "quantity")).toHaveLength(2);
    expect(sitesOf(result, "pointer")).toHaveLength(3);
    expect(sitesOf(result, "pin")).toHaveLength(4);
    expect(sitesOf(result, "veil")).toHaveLength(1);
    // One site per record line, no more: 4+6+2+3+4+1.
    expect(result.sites).toHaveLength(20);
    // "plant" is on the map with no records: silence, never an invented site.
    expect(JSON.stringify(result)).not.toContain("plant");
    expect(
      result.sites.some(
        (site) =>
          (site.site as { slug?: string }).slug === "plant" ||
          (site.site as { from?: string }).from === "plant",
      ),
    ).toBe(false);
  });

  test("each family's words ARE its file's lines, byte for byte", () => {
    const result = reading();
    // The walk visits each family in the file's own order, and every line is
    // handed through as its record's canonical bytes: same lines, same order.
    expect(wordsOf(result, "mark")).toEqual(fileLines("map/marks.jsonl"));
    expect(wordsOf(result, "assumption")).toEqual(
      fileLines("map/assumptions.jsonl"),
    );
    expect(wordsOf(result, "quantity")).toEqual(
      fileLines("map/quantities.jsonl"),
    );
    expect(wordsOf(result, "pointer")).toEqual(
      fileLines("map/pointers.jsonl"),
    );
    expect(wordsOf(result, "pin")).toEqual(
      fileLines("scenarios/spring/assumption-pins.jsonl"),
    );
    // Byte-equality on the named lines, spelled out (the check's fields).
    expect(wordsOf(result, "mark")).toContain(
      '{"from":"rain","kind":"open","to":"soil"}',
    );
    expect(wordsOf(result, "assumption")).toContain(
      '{"on":"rain","text":"mulch holds the rain"}',
    );
    expect(wordsOf(result, "quantity")).toContain(
      '{"amount":12,"on":"rain"}',
    );
    expect(wordsOf(result, "pointer")).toContain(
      '{"at":"/home/someone/garden.csv","on":"soil"}',
    );
    expect(wordsOf(result, "pin")).toContain(
      '{"on":"rain","text":"mulch holds the rain"}',
    );
  });

  test("marks: the wordless pair, the word, the pointer line and the spot", () => {
    const marks = recordSites(reading(), "mark");
    expect(marks.map((site) => site.site)).toEqual([
      { type: "word", slug: "rain" },
      { type: "link", from: "rain", to: "soil" },
      { type: "pointer", on: "rain", form: "path", value: "notes/rain.md" },
      { type: "spot", x: -40, y: 12.5 },
    ]);
    // The mark on the signed link: the WORDLESS pair, no sign and no wire word.
    const pair = marks[1];
    expect(pair.words).toBe('{"from":"rain","kind":"open","to":"soil"}');
    const fields = JSON.parse(pair.words) as Record<string, unknown>;
    expect(fields).toEqual({ from: "rain", kind: "open", to: "soil" });
    expect("word" in fields).toBe(false);
    expect("sign" in fields).toBe(false);
    // Every other mark's note is null: the walk adds no sentence of its own.
    for (const site of marks) expect(site.note).toBeNull();
  });

  test("assumptions: the text rides at its own target (word, pair, loop, spot)", () => {
    const claims = recordSites(reading(), "assumption");
    expect(claims.map((site) => site.site)).toEqual([
      { type: "word", slug: "rain" },
      { type: "word", slug: "rain" },
      { type: "word", slug: "mulch" },
      { type: "link", from: "rain", to: "soil" },
      { type: "loop", slug: "rain-loop" },
      { type: "spot", x: 40, y: 60 },
    ]);
    expect(claims.map((site) => site.words)).toContain(
      '{"on":"mulch","text":"the mulch keeps the rain"}',
    );
    expect(claims.map((site) => site.words)).toContain(
      '{"from":"rain","text":"the pair carries water","to":"soil"}',
    );
    expect(claims.map((site) => site.words)).toContain(
      '{"loop":"rain-loop","text":"the loop is reinforcing"}',
    );
    expect(claims.map((site) => site.words)).toContain(
      '{"text":"something is missing here","x":40,"y":60}',
    );
    // TWO claims at one word are TWO entries, not a pair or a merge.
    const atRain = claims.filter(
      (site) => (site.site as { slug?: string }).slug === "rain",
    );
    expect(atRain).toHaveLength(2);
    expect(atRain.map((site) => site.words)).toEqual([
      '{"on":"rain","text":"mulch holds the rain"}',
      '{"on":"rain","text":"the bed is wide"}',
    ]);
    // The claim is at the word; the text is the claim's.
    for (const site of claims) {
      if (site.site.type === "word" && site.site.slug === "mulch") {
        expect(site.words).toContain("the mulch keeps the rain");
      }
    }
  });

  test("quantities: the line at its anchor — an absent amount stays absent", () => {
    const quantities = recordSites(reading(), "quantity");
    expect(quantities.map((site) => site.site)).toEqual([
      { type: "word", slug: "rain" },
      { type: "flow", from: "rain", to: "soil" },
    ]);
    expect(quantities[0].words).toBe('{"amount":12,"on":"rain"}');
    expect(quantities[1].words).toBe('{"from":"rain","to":"soil"}');
    // Unknown is never written as zero: the absent amount leaves no field.
    expect(quantities[1].words).not.toContain("amount");
    for (const site of quantities) expect(site.note).toBeNull();
  });

  test("pointers: the authored form and value — the pull reads no world", () => {
    const pointers = recordSites(reading(), "pointer");
    expect(pointers.map((site) => site.site)).toEqual([
      { type: "pointer", on: "rain", form: "path", value: "notes/rain.md" },
      {
        type: "pointer",
        on: "soil",
        form: "url",
        value: "https://example.org/soil",
      },
      {
        type: "pointer",
        on: "soil",
        form: "at",
        value: "/home/someone/garden.csv",
      },
    ]);
    expect(pointers[2].words).toBe(
      '{"at":"/home/someone/garden.csv","on":"soil"}',
    );
    // No target is checked and no rule sentence is minted: whether the path
    // resolves is the world's business (the contacts' job, not the pull's).
    for (const site of pointers) expect(site.note).toBeNull();
  });

  test("the dangling pin keeps its claim and carries the drop-rule sentence at its spot", () => {
    const pins = recordSites(reading(), "pin");
    const dangling = pins.filter((pin) => pin.note !== null);
    expect(dangling).toHaveLength(1);
    expect(dangling[0].note).toBe(DANGLING_PIN_NOTE);
    expect(dangling[0].words).toBe(
      '{"on":"rain","text":"mulch holds the rain every day"}',
    );
    expect(dangling[0].site).toEqual({ type: "word", slug: "rain" });
    // The claim is shown as it stands: no cause named, nothing repaired.
    expect(dangling[0].words).toContain("every day");
    // The pins whose claim still stands carry no sentence.
    const standing = pins.filter((pin) => pin.note === null);
    expect(standing).toHaveLength(3);
    expect(standing.map((pin) => pin.words)).toEqual([
      '{"on":"rain","text":"mulch holds the rain"}',
      '{"on":"mulch","text":"the mulch keeps the rain"}',
      '{"from":"rain","text":"the pair carries water","to":"soil"}',
    ]);
  });

  test("the scenario pins stand at their own anchors, with their own words", () => {
    const pins = recordSites(reading(), "pin");
    expect(pins.map((pin) => pin.site)).toEqual([
      { type: "word", slug: "rain" },
      { type: "word", slug: "mulch" },
      { type: "link", from: "rain", to: "soil" },
      { type: "word", slug: "rain" },
    ]);
    // A pin is the record it is (a claim line), never a summary of the branch.
    for (const pin of pins) {
      expect(Object.keys(pin).sort()).toEqual([
        "family",
        "note",
        "site",
        "words",
      ]);
    }
  });

  test("the veil shows its NAME and LOCATION over its box — and nothing else", () => {
    const veils = sitesOf(reading(), "veil") as PullVeilSite[];
    expect(veils).toHaveLength(1);
    expect(veils[0]).toEqual({
      family: "veil",
      site: { type: "area", x: 120.5, y: -40.25, w: 300, h: 200 },
      name: VEIL_NAME,
      location: VEIL_LOCATION,
    });
    expect(Object.keys(veils[0]).sort()).toEqual([
      "family",
      "location",
      "name",
      "site",
    ]);
    expect("words" in veils[0]).toBe(false);
    expect(pullSiteLines(veils[0])).toEqual([VEIL_NAME, VEIL_LOCATION]);
    // A projection with no location string shows the name alone.
    expect(
      pullSiteLines({
        family: "veil",
        site: { type: "area", x: 1, y: 2, w: 3, h: 4 },
        name: "a cover",
        location: null,
      }),
    ).toEqual(["a cover"]);
  });

  test("the reading renders every site's line, verbatim, in ONE block", () => {
    const result = reading();
    const rendered = blockText(renderPanel(result), "pull-lines").split(NL);
    const expected = [
      ...fileLines("map/marks.jsonl"),
      ...fileLines("map/assumptions.jsonl"),
      ...fileLines("map/quantities.jsonl"),
      ...fileLines("map/pointers.jsonl"),
      ...fileLines("scenarios/spring/assumption-pins.jsonl"),
      DANGLING_PIN_NOTE,
      VEIL_NAME,
      VEIL_LOCATION,
    ];
    expect(sameSet(rendered, expected)).toBe(true);
    expect(rendered).toHaveLength(expected.length);
    // A duplicate line is shown as often as it exists (the standing pin and the
    // committed claim carry the same bytes): the reading hides nothing.
    expect(
      rendered.filter(
        (line) => line === '{"on":"rain","text":"mulch holds the rain"}',
      ),
    ).toHaveLength(2);
  });
});

/* ========================================================================= *
 * (c) The veil projection is structural: no veil record, no reason anywhere.
 * ========================================================================= */

describe("(c) the veil projection: the reader's types hold no veil record", () => {
  test("the reader never imports the veil record, and its shape is the projection's", () => {
    const reader = source("pull/reader.ts");
    expect(specifiersOf(reader)).not.toContain("../map/veils");
    // The prose's word and the record's type are not in the reader AT ALL.
    expect(reader).not.toMatch(/\breason\b/i);
    expect(reader).not.toMatch(/\bVeil\b/);
    expect(reader).toContain("readonly VeilProjection[]");
    // The projection has three fields, and the record cannot satisfy the
    // reader's shape (it has no area: a raw veil is not the reader's input).
    const projected = projectVeil(veilRecord());
    expect(Object.keys(projected).sort()).toEqual(["area", "location", "name"]);
    expect("reason" in projected).toBe(false);
    expect("area" in veilRecord()).toBe(false);
    // The projection never reads the cover: the cover rule is not imported.
    for (const file of PULL_FILES) {
      expect(source(file)).not.toMatch(
        /coveredWordSlugs|veilsCoveringWord|topVeilOf|veilCoversPoint|centreOfWord/,
      );
    }
  });

  test("no reason field anywhere in the reading — asserted on the JSON", () => {
    const result = reading();
    const json = JSON.stringify(result);
    expect(json).not.toContain("reason");
    expect(json).not.toContain("muddled");
    expect(json).not.toContain(VEIL_REASON);
    for (const key of keysDeep(result)) {
      expect({ key, prose: /reason|prose|covered/i.test(key) }).toEqual({
        key,
        prose: false,
      });
    }
    // The record HAS the prose; the reading has nowhere to put it.
    expect(Object.keys(veilRecord())).toContain("reason");
    expect(veilRecord().reason).toBe(VEIL_REASON);
    // The only veil text the reading carries is the person's name and the
    // projection's location string.
    expect(json).toContain(VEIL_NAME);
    expect(json).toContain(VEIL_LOCATION);
  });
});

/* ========================================================================= *
 * (d) The failed prediction's constituents: co-presence, never arrangement.
 * ========================================================================= */

describe("(d) the constituents stand at their own sites, never arranged", () => {
  test("a claim's text and the pair's own mark are two entries at ONE pair", () => {
    const result = reading();
    const atPair = result.sites.filter(
      (site) =>
        site.site.type === "link" &&
        site.site.from === "rain" &&
        site.site.to === "soil",
    );
    // The claim, the pair's own mark and the branch's pin all stand there,
    // each in its own entry: three records at one site, never a wrapper.
    expect(new Set(atPair.map((site) => site.family))).toEqual(
      new Set(["assumption", "mark", "pin"]),
    );
    const claim = atPair.find(
      (site) => site.family === "assumption",
    ) as PullRecordSite;
    const pairMark = atPair.find(
      (site) => site.family === "mark",
    ) as PullRecordSite;
    // Each carries only its own bytes as provenance.
    expect(claim.words).toBe(
      '{"from":"rain","text":"the pair carries water","to":"soil"}',
    );
    expect(pairMark.words).toBe('{"from":"rain","kind":"open","to":"soil"}');
    for (const site of atPair) {
      expect(Object.keys(site).sort()).toEqual([
        "family",
        "note",
        "site",
        "words",
      ]);
    }
    // No wrapper, list, pairing or title appears anywhere around them: the
    // adjacency is the person's reading, not the module's arrangement.
    expect(new Set(result.sites.map((site) => site.family)).size).toBe(6);
    for (const site of result.sites) {
      for (const value of Object.values(site)) {
        expect(Array.isArray(value)).toBe(false);
      }
    }
  });

  test("the map never says what the person must say: failed, wrong, differ, contradict", () => {
    const result = reading();
    // The reader composes no sentence about the pair (source, not comments).
    for (const file of PULL_FILES) {
      expect({
        file,
        verdict: /\b(fail|wrong|differ|contradict)\w*/i.test(
          bodyOnly(source(file)),
        ),
      }).toEqual({ file, verdict: false });
    }
    // The pull's own words (never a record's) hold no verdict either.
    const ownWords = [
      PULL_DOOR_LABEL,
      PULL_DOOR_TITLE,
      PULL_TITLE,
      PULL_PANEL_LABEL,
      PULL_CLOSE_LABEL,
      PULL_SELECTION,
      DANGLING_PIN_NOTE,
    ].join(" ");
    expect(ownWords).not.toMatch(/\b(fail|wrong|differ|contradict)\w*/i);
    // And the reading's lines are the records' own bytes: the tool added
    // nothing that could say it. (Our fixture's words hold no verdict.)
    const all = pullLines(result);
    expect(all).not.toMatch(/\b(fail|wrong|differ|contradict)\w*/i);
    expect(all).not.toMatch(/\b(these|those|both|two)\b/i);
  });
});

/* ========================================================================= *
 * (e) The wording reports; it never directs.
 * ========================================================================= */

describe("(e) the wording reports; it never directs", () => {
  test("no sentence the pull says directs the person", () => {
    const prose = [
      PULL_DOOR_LABEL,
      PULL_DOOR_TITLE,
      PULL_TITLE,
      PULL_PANEL_LABEL,
      PULL_CLOSE_LABEL,
      PULL_SELECTION,
      DANGLING_PIN_NOTE,
    ].join(" ");
    expect(prose).not.toMatch(
      /(^|\W)(you|your|should|must|ought|consider|try|need to)(\W|$)/i,
    );
    // The selection reports the rule of the reading: silence, not safety.
    expect(PULL_SELECTION).toContain("silence, not safety");
    // The dangling pin's sentence states the drop rule; it names no cause.
    expect(DANGLING_PIN_NOTE).toContain("kept and shown as it stands");
    expect(DANGLING_PIN_NOTE).not.toMatch(/\b(why|because|cause)\b/i);
  });
});

/* ========================================================================= *
 * (f) Close: the pull wrote NOTHING at all (fs-level).
 * ========================================================================= */

describe("(f) closing is the dismissal, and the pull writes NOTHING", () => {
  test("ask, close, ask again: the fixture tree is byte-identical", () => {
    const before = tree();
    expect(Object.keys(before).sort()).toEqual([
      "map/assumptions.jsonl",
      "map/marks.jsonl",
      "map/pointers.jsonl",
      "map/quantities.jsonl",
      "map/references/plant.md",
      "map/veils.jsonl",
      "scenarios/spring/assumption-pins.jsonl",
    ]);
    const first = reading();
    expect(first.sites).toHaveLength(20);
    // The close is the value going away. Nothing is suppressed, remembered or
    // written: the second ask reads the records again.
    const second = reading();
    expect(second.sites).toHaveLength(first.sites.length);
    const after = tree();
    // Same paths, same bytes: no file, no log, no storage, no trace.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(after).toEqual(before);
  });

  test("no writer, no bridge and no storage is within the pull's reach", () => {
    const WRITERS =
      /\b(writeTextFile|writeMachineFile|writeFile|writeFileSync|appendFile|appendFileSync|removeFile|renameFile|createDirAll|saveMarks|saveAssumptions|saveQuantities|savePointers|saveVeils|savePins|invoke|localStorage|sessionStorage|indexedDB|fetch)\b/;
    for (const file of [...PULL_FILES, ...SURFACE_FILES]) {
      const body = bodyOnly(source(file));
      expect({ file, writer: WRITERS.test(body) }).toEqual({
        file,
        writer: false,
      });
      const fsImport = specifiersOf(source(file)).some((spec) =>
        spec.endsWith("/lib/fs"),
      );
      expect({ file, fs: fsImport }).toEqual({ file, fs: false });
    }
    // The reader takes records, not paths: the reading carries no address.
    const result = reading();
    expect(JSON.stringify(result)).not.toContain(ROOT);
    expect(keysDeep(result)).not.toContain("path");
    // The app's ONE close callback drops the value and does nothing else.
    const app = source("App.tsx");
    const start = app.indexOf("const closePullAsk = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = app.indexOf("}, []);", start);
    const close = bodyOnly(app.slice(start, end + "}, []);".length));
    const rest = close
      .replace("setPullReading(null);", "")
      .replace(/\s+/g, " ")
      .trim();
    expect(rest).toBe("const closePullAsk = useCallback(() => { }, []);");
  });
});

/* ========================================================================= *
 * (g) Ask again: the same record SET returns — never a sequence.
 * ========================================================================= */

describe("(g) asking again returns the same record SET, never a sequence", () => {
  test("two asks answer the same set of identities", () => {
    const first = [...pullRecordSet(reading())];
    const second = [...pullRecordSet(reading())];
    expect(sameSet(first, second)).toBe(true);
    expect(new Set(first).size).toBe(new Set(second).size);
    expect(first).toHaveLength(20);
  });

  test("the input order is not part of the identity (a set, not a sequence)", () => {
    const forward = reading(false);
    const backward = reading(true);
    expect(
      sameSet([...pullRecordSet(forward)], [...pullRecordSet(backward)]),
    ).toBe(true);
    // The walk follows the records; it is never sorted, so the ARRAYS differ.
    // That is why a re-ask is "the same set", never "the same sequence".
    expect(forward.sites.map(pullSiteKey)).not.toEqual(
      backward.sites.map(pullSiteKey),
    );
  });

  test("never a sequence: no cursor, no ordinal, no position in the reading", () => {
    const result = reading();
    // The reading's shape is the selection and the sites — nothing else.
    expect(Object.keys(result).sort()).toEqual(["said", "sites"]);
    for (const site of result.sites) {
      expect(Object.keys(site).sort()).toEqual(
        site.family === "veil"
          ? ["family", "location", "name", "site"]
          : ["family", "note", "site", "words"],
      );
    }
    // Set identity is a Set (story 1's pullSiteKey), and the keys are unique.
    const set = pullRecordSet(result);
    expect(set instanceof Set).toBe(true);
    expect(set.size).toBe(result.sites.length);
    // The identities are the sites' own bytes, not a position.
    expect(new Set(result.sites.map(pullSiteKey))).toEqual(set);
    // The handler exports the ask and the set; nothing takes a position.
    const ask = source("pull/ask.ts");
    expect(ask).toContain("export function askPull(");
    expect(ask).toContain("export function pullRecordSet(");
    expect(bodyOnly(ask)).not.toMatch(/cursor|ordinal|position|offset|index/i);
  });

  test("no branch runs: no pins, and the rest of the read set still stands", () => {
    const committed = askPull({ ...fixtureSource(), pins: [] });
    expect(committed.sites.some((site) => site.family === "pin")).toBe(false);
    expect(committed.said).toBe(PULL_SELECTION);
    const withoutPins = (result: PullReading) =>
      result.sites.filter((site) => site.family !== "pin").map(pullSiteKey);
    expect(sameSet(withoutPins(committed), withoutPins(reading()))).toBe(true);
  });
});

/* ========================================================================= *
 * (h) The negative space: no count, order, cursor, score, badge or cue.
 * ========================================================================= */

describe("(h) the negative space: nothing announces a pull is waiting", () => {
  const FORBIDDEN =
    /\b(index|ordinal|cursor|position|order|count|total|next|previous|first|last|rank|score|streak|badge|dot|cue|glow|progress|tally|meter|nudge|remind)\w*/i;

  test("the pull's code holds no ordering, cursor, count or score vocabulary", () => {
    for (const file of [...PULL_FILES, ...SURFACE_FILES]) {
      expect({ file, found: FORBIDDEN.test(bodyOnly(source(file))) }).toEqual({
        file,
        found: false,
      });
    }
    // The reading's own keys hold no ordering or grouping key either.
    for (const key of keysDeep(reading())) {
      expect({
        key,
        ordered: /order|sort|rank|group|index|cursor|score/i.test(key),
      }).toEqual({ key, ordered: false });
    }
  });

  test("the chrome is exactly the said sentence and the close", () => {
    const html = renderPanel(reading());
    const chrome = textOfMarkup(withoutBlock(html, "pull-lines"));
    // The surface's whole chrome: the reading's name, the close, the said.
    expect(chrome).toBe(PULL_TITLE + " × " + PULL_SELECTION);
    // Take away the name and the close glyph: the selection and NOTHING else.
    const rest = chrome
      .replace(PULL_TITLE, "")
      .replace("×", "")
      .replace(/\s+/g, " ")
      .trim();
    expect(rest).toBe(PULL_SELECTION);
    expect(chrome.match(/\d/g) ?? []).toHaveLength(0);
    // One panel, one block: no per-site element to order or number.
    expect(html.match(/class="pull-panel"/g) ?? []).toHaveLength(1);
    expect(html.match(/class="pull-lines"/g) ?? []).toHaveLength(1);
    expect(html.match(/class="pull-site/g) ?? []).toHaveLength(0);
  });

  test("the rendered surface holds no list semantics and no positions", () => {
    const html = renderPanel(reading());
    for (const forbidden of [
      "<ol",
      "<ul",
      "<li",
      "posinset",
      "aria-setsize",
      "data-index",
      'role="list"',
    ]) {
      expect({ forbidden, found: html.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
    const lines = blockText(html, "pull-lines").split(NL);
    for (const line of lines) {
      expect(line).not.toMatch(/^\s*(\d+[.)]|[-*•])\s/);
    }
  });

  test("an empty map invents nothing: the selection, and no empty-state sentence", () => {
    const empty = askPull({
      marks: [],
      assumptions: [],
      quantities: [],
      pointers: [],
      veils: [],
      pins: [],
    });
    expect(empty.said).toBe(PULL_SELECTION);
    expect(empty.sites).toEqual([]);
    expect(pullLines(empty)).toBe("");
    expect(pullRecordSet(empty).size).toBe(0);
    const html = renderPanel(empty);
    expect(blockText(html, "pull-said")).toBe(PULL_SELECTION);
    expect(blockText(html, "pull-lines")).toBe("");
    expect(textOfMarkup(html)).toBe(PULL_TITLE + " × " + PULL_SELECTION);
  });

  test("the door's CSS is quiet and the reading's block is plain selectable text", () => {
    const css = source("canvas/canvas.css");
    function ruleBody(selector: string): string {
      const start = css.indexOf(selector + " {");
      expect(start).toBeGreaterThan(-1);
      const open = css.indexOf("{", start);
      const close = css.indexOf("}", open);
      return css.slice(open + 1, close);
    }
    const door = ruleBody(
      ".level-edit,\n.level-loop,\n.level-veil,\n.level-ask,\n.pull-door",
    );
    expect(door).not.toMatch(/animation|glow|pulse|red|orange/i);
    const lines = ruleBody(".pull-lines");
    expect(lines).toContain("white-space: pre-wrap");
    expect(lines).toContain("user-select: text");
    // No badge, dot, count or cue class exists to mount.
    for (const forbidden of [
      ".pull-badge",
      ".pull-dot",
      ".pull-count",
      ".pull-cue",
    ]) {
      expect({ forbidden, found: css.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
  });
});

/* ========================================================================= *
 * (i) The named scans: the ambient path, the announcing strings, the verdict.
 * ========================================================================= */

describe("(i) the named scans: no ambient path and no announcing or verdict strings", () => {
  test("the reader is imported only by the pull-ask handler (no mount/render path)", () => {
    expect(importersOf("pull/reader")).toEqual(["pull/ask.ts"]);
    // The pull's three modules are plain .ts: no component here to mount.
    expect(readdirSync(join(SRC, "pull")).sort()).toEqual([
      "ask.ts",
      "projection.ts",
      "reader.ts",
    ]);
    const RENDER_TOKENS =
      /\b(useEffect|useLayoutEffect|useState|useMemo|useCallback|useRef|setInterval|setTimeout|addEventListener|subscribe|requestAnimationFrame|MutationObserver|ResizeObserver|createRoot|render|mount|componentWill|componentDid|onClick|dispatchEvent)\b/;
    const AMBIENT =
      /\b(window|document|globalThis|localStorage|sessionStorage|indexedDB|navigator|clipboard|fetch|CustomEvent|EventTarget|Date|Timer)\b/;
    for (const file of PULL_FILES) {
      const body = bodyOnly(source(file));
      expect({ file, renders: RENDER_TOKENS.test(body) }).toEqual({
        file,
        renders: false,
      });
      expect({ file, ambient: AMBIENT.test(body) }).toEqual({
        file,
        ambient: false,
      });
      expect({
        file,
        react: /from "react"|\.tsx"/.test(source(file)),
      }).toEqual({ file, react: false });
    }
  });

  test("no badge, dot, count or cue strings — nothing announces a pull", () => {
    const ANNOUNCE = /\b(badge|dot|count|cue)\w*/i;
    for (const file of [...PULL_FILES, ...SURFACE_FILES]) {
      expect({ file, found: ANNOUNCE.test(bodyOnly(source(file))) }).toEqual({
        file,
        found: false,
      });
    }
    // Nor on the door or the rendered surface.
    const door = renderToStaticMarkup(
      createElement(PullDoor, { onOpen: noop }),
    );
    expect(door).not.toMatch(ANNOUNCE);
    expect(renderPanel(reading())).not.toMatch(ANNOUNCE);
  });

  test("no fail, wrong, differ or contradict strings — the tool names no verdict", () => {
    const VERDICT = /\b(fail|wrong|differ|contradict)\w*/i;
    for (const file of [...PULL_FILES, ...SURFACE_FILES]) {
      expect({ file, found: VERDICT.test(bodyOnly(source(file))) }).toEqual({
        file,
        found: false,
      });
    }
  });

  test("the contacts' Ask phrase is absent from src — the pull's door owns its own", () => {
    for (const file of sourceFiles()) {
      expect({ file, found: /ask the map/i.test(source(file)) }).toEqual({
        file,
        found: false,
      });
    }
    // The pull's code name is "the pull ask" (the door's own quiet question).
    expect(source("canvas/PullDoor.tsx")).toContain("THE PULL ASK'S DOOR");
    expect(source("pull/ask.ts")).toContain("THE PULL ASK");
    expect(PULL_DOOR_LABEL).toBe("where am I thin…");
  });
});

/* ========================================================================= *
 * (j) The retired phrases stay retired.
 * ========================================================================= */

describe("(j) the retired phrases stay retired", () => {
  test("the contacts' Ask owns the phrase and the pull never borrows it", () => {
    for (const file of sourceFiles()) {
      expect({ file, found: /ask the map/i.test(source(file)) }).toEqual({
        file,
        found: false,
      });
    }
    expect(PULL_DOOR_LABEL.toLowerCase()).not.toContain("ask");
    expect(PULL_DOOR_TITLE.toLowerCase()).not.toContain("ask the map");
  });

  test("the verdict words are retired everywhere the pull speaks", () => {
    const VERDICT = /\b(fail|wrong|differ|contradict)\w*/i;
    const ownWords = [
      PULL_DOOR_LABEL,
      PULL_DOOR_TITLE,
      PULL_TITLE,
      PULL_PANEL_LABEL,
      PULL_CLOSE_LABEL,
      PULL_SELECTION,
      DANGLING_PIN_NOTE,
      pullLines(reading()),
    ].join(" ");
    expect(ownWords).not.toMatch(VERDICT);
    // The drop-rule sentence is a RULE (kept and shown as it stands), never a
    // verdict about failure or disagreement.
    expect(DANGLING_PIN_NOTE).not.toMatch(VERDICT);
  });

  test("the anti-pattern's words are retired from the pull: no score, no tally, no thinness", () => {
    const ANTI_PATTERN =
      /\b(score|streak|tally|thinness|leverage|density|meter|nudge|glow|remind)\w*/i;
    for (const file of [...PULL_FILES, ...SURFACE_FILES]) {
      expect({ file, found: ANTI_PATTERN.test(bodyOnly(source(file))) }).toEqual({
        file,
        found: false,
      });
    }
    // "Thinness" is the person's felt lack, never a metric the tool names:
    // the word does not enter the source at all (the door asks the question).
    for (const file of sourceFiles()) {
      expect({ file, found: /\bthinness\b/i.test(source(file)) }).toEqual({
        file,
        found: false,
      });
    }
  });
});

/* ========================================================================= *
 * The whole check, in the check's order — the port-asserted half.
 * ========================================================================= */

describe("the whole check, in the check's order (the port-asserted half)", () => {
  test("open the door; read; close; ask again — and nothing else happens", () => {
    // 1. The door's own quiet button — the ONLY trigger. Its label is the
    //    person's question, and there is no badge, dot, count or cue beside it.
    const door = renderToStaticMarkup(
      createElement(PullDoor, { onOpen: noop }),
    );
    expect(door.match(/<button/g) ?? []).toHaveLength(1);
    expect(door).toContain("where am I thin…");
    expect(door).not.toMatch(/badge|\bdot\b|count|\bcue\b/i);

    // 2. The ask: the records the app holds go in, one reading comes back.
    const before = tree();
    const first = askPull(fixtureSource());
    expect(first.said).toBe(
      "this speaks where records exist; the rest is silence, not safety.",
    );
    expect(first.sites).toHaveLength(20);

    // 3. Every read-set record at its OWN site, with its own words.
    expect(recordSites(first, "quantity")[0].words).toBe(
      '{"amount":12,"on":"rain"}',
    );
    expect(
      wordsOf(first, "mark").filter(
        (words) => words === '{"from":"rain","kind":"open","to":"soil"}',
      ),
    ).toHaveLength(1);
    const dangling = recordSites(first, "pin").filter(
      (pin) => pin.note === DANGLING_PIN_NOTE,
    );
    expect(dangling).toHaveLength(1);
    expect(dangling[0].site).toEqual({ type: "word", slug: "rain" });

    // 4. The veil: the name and the location over its box; no reason anywhere.
    const veil = sitesOf(first, "veil")[0] as PullVeilSite;
    expect(veil.name).toBe(VEIL_NAME);
    expect(veil.location).toBe(VEIL_LOCATION);
    expect(veil.site).toEqual({
      type: "area",
      x: 120.5,
      y: -40.25,
      w: 300,
      h: 200,
    });
    expect(JSON.stringify(first)).not.toContain("muddled");
    expect(keysDeep(first)).not.toContain("reason");

    // 5. The failed prediction's constituents stand at their own sites: an
    //    assumption's text and the pair's own mark, co-present, never arranged.
    const atPair = first.sites.filter(
      (site) =>
        site.site.type === "link" &&
        site.site.from === "rain" &&
        site.site.to === "soil",
    );
    expect(atPair).toHaveLength(3);
    expect(new Set(atPair.map((site) => site.family))).toEqual(
      new Set(["assumption", "mark", "pin"]),
    );

    // 6. The surface shows the said sentence and the records' own lines; the
    //    chrome is the said sentence and the close, and nothing is counted.
    const html = renderPanel(first);
    expect(blockText(html, "pull-said")).toBe(first.said);
    const chrome = textOfMarkup(withoutBlock(html, "pull-lines"));
    expect(chrome).toBe(PULL_TITLE + " × " + first.said);

    // 7. Close: nothing was written. The pull has no writer, no path and no
    //    storage; the fixture tree is byte-identical.
    const closed = first;
    expect(closed.sites).toHaveLength(20);
    expect(tree()).toEqual(before);

    // 8. Ask again: the same record SET returns (set identity — not a
    //    sequence), and the same words are read again.
    const second = askPull(fixtureSource());
    expect(
      sameSet([...pullRecordSet(first)], [...pullRecordSet(second)]),
    ).toBe(true);
    expect(second.said).toBe(first.said);
    expect(tree()).toEqual(before);

    // 9. No count, no order, no cursor, no score, no badge, no cue anywhere.
    const json = JSON.stringify(second);
    expect(json).not.toMatch(
      /\b(count|counts|total|totals|order|ordinal|cursor|position|score|streak|badge|cue)\b/i,
    );
    expect(chrome.match(/\d/g) ?? []).toHaveLength(0);
  });
});
