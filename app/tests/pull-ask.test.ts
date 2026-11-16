
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
import { parseAssumptions } from "../src/map/assumptions";
import { parseMarks } from "../src/map/marks";
import { parsePointers } from "../src/map/pointers";
import { parseQuantities } from "../src/map/quantities";
import { parseVeils } from "../src/map/veils";
import { parsePins } from "../src/scenarios/pins";
import { askPull, pullRecordSet, type PullAskSource } from "../src/pull/ask";
import {
  DANGLING_PIN_NOTE,
  PULL_SELECTION,
  pullSiteKey,
  type PullReading,
  type PullSite,
} from "../src/pull/reader";
import { LevelControl } from "../src/canvas/LevelControl";
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
import { LEVELS } from "../src/workspace/level";

/**
 * Epic 13 story 2 — THE PULL ASK SURFACE, automated.
 *
 * The door is one quiet button and the ONLY trigger; the reading is a
 * transient that shows the selection SAID and the records' own lines verbatim;
 * closing IS the dismissal and writes nothing (asserted at the filesystem
 * level); asking again returns the same record SET (story 1's "pullSiteKey",
 * never a sequence); the veil shows its name and location and never its prose;
 * and no cursor, order or count exists anywhere on the surface. The source
 * scans hold the trigger rule: the reader is imported by the pull-ask handler
 * alone, and only the press reaches it.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const APP = join(SRC, "..", "src", "App.tsx");

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

const APP_SOURCE = readFileSync(APP, "utf8");

function noop() {}

/** The panel as the app renders it, static markup and all. */
function renderPanel(reading: PullReading): string {
  return renderToStaticMarkup(
    createElement(PullPanel, { reading, onClose: noop }),
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

/** Do two readings carry exactly the same set of site identities? */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}

/* ----------------------------------------------------------------------- *
 * The fixture workspace: the app's own files, as the app writes them.
 * ----------------------------------------------------------------------- */

const NL = "\n";
const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-pull-ask-"));

const FILES: Record<string, string> = {
  "map/marks.jsonl": [
    '{"from":"rain","kind":"open","to":"soil"}',
    '{"kind":"open","on":"rain"}',
    '{"kind":"open","x":-40,"y":12.5}',
  ]
    .map((line) => line + NL)
    .join(""),
  "map/assumptions.jsonl": [
    '{"on":"rain","text":"mulch holds the rain"}',
    '{"loop":"rain-loop","text":"the loop is reinforcing"}',
  ]
    .map((line) => line + NL)
    .join(""),
  "map/quantities.jsonl": [
    '{"amount":12,"on":"rain"}',
    '{"from":"rain","to":"soil"}',
  ]
    .map((line) => line + NL)
    .join(""),
  "map/pointers.jsonl": ['{"on":"rain","path":"notes/rain.md"}']
    .map((line) => line + NL)
    .join(""),
  "scenarios/spring/assumption-pins.jsonl": [
    '{"on":"rain","text":"mulch holds the rain"}',
    '{"on":"rain","text":"mulch holds the rain every day"}',
  ]
    .map((line) => line + NL)
    .join(""),
  "map/veils.jsonl":
    '{"h":200,"name":"rain cover","reason":"the soil records are muddled","w":300,"x":120.5,"y":-40.25}' +
    NL,
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

/** The records as the app holds them, over the fixture (one branch running). */
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
    pins: order(parsePins(textOf("scenarios/spring/assumption-pins.jsonl")).pins),
  };
}

function reading(): PullReading {
  return askPull(fixtureSource());
}

/** The fixture's one veil, as the reading carries it. */
function veilSite(): PullSite {
  const found = reading().sites.find((site) => site.family === "veil");
  expect(found).toBeDefined();
  return found as PullSite;
}

/** Story 2's surface: the handler and the door + transient's modules. */
const SURFACE_FILES = [
  "pull/ask.ts",
  "canvas/pullRules.ts",
  "canvas/PullDoor.tsx",
  "canvas/PullPanel.tsx",
];

const VEIL_NAME = "rain cover";
const VEIL_LOCATION = "x 120.5, y -40.25, w 300, h 200";
const VEIL_REASON = "the soil records are muddled";

/* ----------------------------------------------------------------------- *
 * 1. The trigger rule: the door is the only way in.
 * ----------------------------------------------------------------------- */

describe("the trigger rule: the ask is the only way in (source-scanned)", () => {
  test("the reader is imported by the pull-ask handler alone", () => {
    const importers = sourceFiles().filter((file) => {
      if (file === "pull/reader.ts") return false;
      return specifiersOf(source(file)).some(
        (spec) => resolveSpecifier(file, spec) === "pull/reader",
      );
    });
    expect(importers).toEqual(["pull/ask.ts"]);
  });

  test("readPull is CALLED in the handler and nowhere else", () => {
    const callers = sourceFiles().filter(
      (file) =>
        file !== "pull/reader.ts" &&
        bodyOnly(source(file)).includes("readPull("),
    );
    expect(callers).toEqual(["pull/ask.ts"]);
    // And the reader defines it once: one walk, one door.
    const definers = sourceFiles().filter((file) =>
      source(file).includes("export function readPull("),
    );
    expect(definers).toEqual(["pull/reader.ts"]);
  });

  test("the app asks through ONE press callback, and nothing ambient", () => {
    // The handler is called in the app exactly once — inside the one press.
    expect(APP_SOURCE.match(/askPull\(/g) ?? []).toHaveLength(1);
    const start = APP_SOURCE.indexOf("const openPullAsk = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = APP_SOURCE.indexOf("veils,\n  ]);", start);
    expect(end).toBeGreaterThan(start);
    const open = APP_SOURCE.slice(start, end);
    expect(open).toContain("askPull(");
    expect(open).toContain("setPullReading(");
    // No effect, timer, listener or subscription in the ask's own body.
    for (const ambient of [
      "useEffect",
      "useLayoutEffect",
      "setInterval",
      "setTimeout",
      "addEventListener",
      "subscribe",
      "requestAnimationFrame",
    ]) {
      expect(open).not.toContain(ambient);
    }
    // No writer anywhere near it: the press reads and the surface shows.
    expect(open).not.toMatch(/writeTextFile|writeMachineFile|save[A-Z]/);
    // The callback is defined once and mounted once — the door's press.
    expect(APP_SOURCE.match(/openPullAsk/g) ?? []).toHaveLength(2);
    expect(APP_SOURCE).toContain("onAskPull={openPullAsk}");
    // The handler is CALLED in the app and nowhere else (the definition lives
    // in the handler's own module).
    const askers = sourceFiles().filter(
      (file) =>
        file !== "pull/ask.ts" && bodyOnly(source(file)).includes("askPull("),
    );
    expect(askers).toEqual(["App.tsx"]);
  });

  test("the door is one quiet button, mounted once in the level control", () => {
    const html = renderToStaticMarkup(createElement(PullDoor, { onOpen: noop }));
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain('class="pull-door"');
    expect(html).toContain(PULL_DOOR_LABEL);
    expect(html).toContain(PULL_DOOR_TITLE);
    expect(html).not.toMatch(/badge|\bdot\b|count|\bcue\b/i);
    // It lives in the level control's pill, and nowhere else.
    const doorUsers = sourceFiles().filter((file) =>
      bodyOnly(source(file)).includes("PullDoor"),
    );
    expect(doorUsers.sort()).toEqual([
      "canvas/LevelControl.tsx",
      "canvas/PullDoor.tsx",
    ]);
    const control = source("canvas/LevelControl.tsx");
    expect(control.match(/<PullDoor /g) ?? []).toHaveLength(1);
    expect(control).toContain("<PullDoor onOpen={onAskPull} />");
    // The button itself is inert: a label, a title, one press.
    const door = source("canvas/PullDoor.tsx");
    expect(door).toContain("onClick={onOpen}");
    expect(door).not.toMatch(/useEffect|setInterval|subscribe/);
  });

  test("the surface is opened from the app's one reading state", () => {
    // ONE state: the reading (or null). Nothing else about the pull is held.
    expect(APP_SOURCE).toContain(
      "const [pullReading, setPullReading] = useState<PullReading | null>(null);",
    );
    expect(APP_SOURCE).toContain("{pullReading !== null && (");
    expect(APP_SOURCE).toContain(
      "<PullPanel reading={pullReading} onClose={closePullAsk} />",
    );
  });

  test("no level is a gate on the ask: the door renders in every game", () => {
    for (const level of LEVELS) {
      const html = renderToStaticMarkup(
        createElement(LevelControl, {
          level,
          onJump: noop,
          onEditPlayingSet: noop,
          onCoinLoop: noop,
          onDrawVeil: noop,
          scenarios: [],
          activeScenario: null,
          onChooseScenario: noop,
          onBranchScenario: noop,
          onRetireScenario: noop,
          onCompare: noop,
          onAsk: noop,
          onAskPull: noop,
        }),
      );
      expect(html.match(/class="pull-door"/g) ?? []).toHaveLength(1);
      expect(html).toContain(PULL_DOOR_LABEL);
    }
    // The pull's own files never speak a level: the reading belongs to no game.
    for (const file of [
      "pull/ask.ts",
      "canvas/pullRules.ts",
      "canvas/PullDoor.tsx",
      "canvas/PullPanel.tsx",
    ]) {
      expect(bodyOnly(source(file))).not.toMatch(
        /\b(level|levels|concept|dynamics|ground)\b/i,
      );
    }
  });
});

/* ----------------------------------------------------------------------- *
 * 2. The ephemeral close: nothing is written, nothing is remembered.
 * ----------------------------------------------------------------------- */

describe("the ephemeral close: closing is the whole dismissal", () => {
  test("two asks write nothing at all (fs-level absence)", () => {
    function tree(): Record<string, string> {
      const out: Record<string, string> = {};
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else out[relative(ROOT, full)] = readFileSync(full, "utf8");
        }
      };
      walk(ROOT);
      return out;
    }
    const before = tree();
    const first = askPull(fixtureSource());
    expect(first.sites.length).toBeGreaterThan(0);
    // The close is the value going away; the second ask reads again.
    const second = askPull(fixtureSource());
    expect(second.sites.length).toBe(first.sites.length);
    const after = tree();
    // Same paths, same bytes: no file, no log, no storage, no trace.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(after).toEqual(before);
  });

  test("the pull files hold no writer, no bridge and no storage", () => {
    const WRITERS =
      /\b(writeTextFile|writeMachineFile|writeFile|writeFileSync|appendFile|appendFileSync|removeFile|renameFile|createDirAll|saveMarks|saveAssumptions|saveQuantities|savePointers|saveVeils|savePins|invoke|localStorage|sessionStorage|indexedDB|fetch)\b/;
    for (const file of [
      "pull/ask.ts",
      "canvas/pullRules.ts",
      "canvas/PullDoor.tsx",
      "canvas/PullPanel.tsx",
    ]) {
      const body = bodyOnly(source(file));
      expect(body).not.toMatch(WRITERS);
      expect(specifiersOf(source(file))).not.toContain("../lib/fs");
      expect(specifiersOf(source(file))).not.toContain("./lib/fs");
    }
  });

  test("the close is the dismissal: no dismissal state, no suppression list", () => {
    // The one close callback drops the value and does nothing else.
    const start = APP_SOURCE.indexOf("const closePullAsk = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = APP_SOURCE.indexOf("}, []);", start);
    const close = APP_SOURCE.slice(start, end + "}, []);".length);
    expect(close).toContain("setPullReading(null);");
    const rest = bodyOnly(close)
      .replace("setPullReading(null);", "")
      .replace(/\s+/g, " ")
      .trim();
    expect(rest).toBe("const closePullAsk = useCallback(() => { }, []);");
    // Nothing about the pull is remembered, suppressed or marked seen.
    expect(bodyOnly(APP_SOURCE)).not.toMatch(
      /pull\w*(dismiss|suppress|seen|muted|ignore|hidden)/i,
    );
    // Esc and the × close it; the panel keeps no state of its own.
    const panel = source("canvas/PullPanel.tsx");
    expect(panel).toContain('if (e.key !== "Escape") return;');
    expect(panel).toContain("aria-label={PULL_CLOSE_LABEL}");
    expect(panel).toContain("useRef<HTMLDivElement>(null)");
    expect(bodyOnly(panel)).not.toMatch(/useState/);
  });
});

/* ----------------------------------------------------------------------- *
 * 3. Asking again returns the same record SET, never a sequence.
 * ----------------------------------------------------------------------- */

describe("asking again: the same record set returns", () => {
  test("two asks answer the same set of identities", () => {
    const first = [...pullRecordSet(askPull(fixtureSource()))];
    const second = [...pullRecordSet(askPull(fixtureSource()))];
    expect(sameSet(first, second)).toBe(true);
  });

  test("the identity is the site's bytes — story 1's pullSiteKey", () => {
    const asked = reading();
    const set = pullRecordSet(asked);
    const keys = asked.sites.map(pullSiteKey);
    expect(sameSet([...set], keys)).toBe(true);
    // Two records at one anchor are two identities, never one: the mark and
    // the claim on "rain" both speak there.
    expect(pullSiteKey(asked.sites[0])).not.toBe(pullSiteKey(asked.sites[1]));
  });

  test("the order the records arrive in is not part of the identity", () => {
    // A set, not a walk: the same records handed in another order answer the
    // same identities. This is why a re-ask is "the same set", never "the same
    // sequence".
    const forward = [...pullRecordSet(askPull(fixtureSource()))];
    const backward = [...pullRecordSet(askPull(fixtureSource(true)))];
    expect(sameSet(forward, backward)).toBe(true);
  });

  test("no branch runs: no pins, and the rest of the read set still stands", () => {
    const committed = askPull({ ...fixtureSource(), pins: [] });
    expect(committed.sites.some((site) => site.family === "pin")).toBe(false);
    expect(committed.said).toBe(PULL_SELECTION);
    const withoutPins = (result: PullReading) =>
      result.sites
        .filter((site) => site.family !== "pin")
        .map(pullSiteKey);
    expect(
      sameSet(withoutPins(committed), withoutPins(reading())),
    ).toBe(true);
  });
});

/* ----------------------------------------------------------------------- *
 * 4. The reading, rendered: the records' own words, and nothing added.
 * ----------------------------------------------------------------------- */

describe("the reading renders the records verbatim", () => {
  test("the selection sentence is SAID at the top", () => {
    const html = renderPanel(reading());
    expect(blockText(html, "pull-said")).toBe(PULL_SELECTION);
    expect(html.indexOf("pull-said")).toBeLessThan(html.indexOf("pull-lines"));
  });

  test("every record's line is in the reading byte for byte", () => {
    const html = renderPanel(reading());
    const rendered = blockText(html, "pull-lines").split(NL);
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
    // Byte-equality, spelled out on one full line and the rule sentence.
    expect(rendered).toContain(
      '{"on":"rain","text":"mulch holds the rain every day"}',
    );
    expect(rendered).toContain(DANGLING_PIN_NOTE);
    expect(rendered).toContain(VEIL_NAME);
    expect(rendered).toContain(VEIL_LOCATION);
    // A duplicate line is shown as often as it exists (the standing pin and
    // the committed claim carry the same bytes): the reading hides nothing.
    expect(
      rendered.filter((line) => line === '{"on":"rain","text":"mulch holds the rain"}'),
    ).toHaveLength(2);
  });

  test("one block: no heading, no family label, no number, no marker", () => {
    const html = renderPanel(reading());
    // ONE block holds every site; there is no per-site element to order.
    expect(html.match(/class="pull-lines"/g) ?? []).toHaveLength(1);
    const lines = blockText(html, "pull-lines").split(NL);
    for (const line of lines) {
      expect(line).not.toMatch(/^\s*(\d+[.)]|[-*•])\s/);
    }
    const chrome = textOfMarkup(withoutBlock(html, "pull-lines"));
    // The surface's own words: the title, the close, the said sentence. No
    // count, no number, no family label.
    expect(chrome).toBe("the pull × " + PULL_SELECTION);
    for (const family of [
      "mark",
      "assumption",
      "quantity",
      "pointer",
      "pin",
      "veil",
    ]) {
      expect(chrome.toLowerCase()).not.toContain(family);
    }
  });

  test("the reading adds no sentence of its own beyond the said and the notes", () => {
    const html = renderPanel(reading());
    const all = textOfMarkup(html);
    // The two sentences the pull ever shows are the reader's own.
    expect(all).toContain(PULL_SELECTION);
    expect(all).toContain(DANGLING_PIN_NOTE);
    // It never directs and never judges.
    const prose = [
      PULL_TITLE,
      PULL_DOOR_LABEL,
      PULL_DOOR_TITLE,
      PULL_PANEL_LABEL,
      PULL_CLOSE_LABEL,
      PULL_SELECTION,
      DANGLING_PIN_NOTE,
    ].join(" ");
    expect(prose).not.toMatch(/(^|\W)(you|should|must|ought|consider|try)(\W|$)/i);
    expect(prose).not.toMatch(
      /\b(fail|wrong|differ|contradict|problem|missing)\w*/i,
    );
    // And the surface's code never speaks a verdict either.
    for (const file of SURFACE_FILES) {
      expect({ file, found: /\b(fail|wrong|differ|contradict)\w*/i.test(
        bodyOnly(source(file)),
      ) }).toEqual({ file, found: false });
    }
  });

  test("an empty map says the selection and nothing else", () => {
    const empty = askPull({
      marks: [],
      assumptions: [],
      quantities: [],
      pointers: [],
      veils: [],
      pins: [],
    });
    expect(empty.sites).toEqual([]);
    expect(pullLines(empty)).toBe("");
    const html = renderPanel(empty);
    expect(blockText(html, "pull-said")).toBe(PULL_SELECTION);
    expect(blockText(html, "pull-lines")).toBe("");
    // No empty-state sentence is invented: the selection already says it.
    expect(textOfMarkup(html)).toBe("the pull × " + PULL_SELECTION);
  });
});

/* ----------------------------------------------------------------------- *
 * 5. The veil: name and location only.
 * ----------------------------------------------------------------------- */

describe("the veil shows its name and location and never its prose", () => {
  test("a veil's lines are the projection's two fields", () => {
    expect(pullSiteLines(veilSite())).toEqual([VEIL_NAME, VEIL_LOCATION]);
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

  test("the reason never reaches the surface (structural)", () => {
    const html = renderPanel(reading());
    expect(html).not.toContain(VEIL_REASON);
    expect(html).not.toContain("muddled");
    for (const file of [
      "canvas/pullRules.ts",
      "canvas/PullPanel.tsx",
      "canvas/PullDoor.tsx",
    ]) {
      const specs = specifiersOf(source(file));
      expect(specs).not.toContain("../map/veils");
      expect(specs).not.toContain("../pull/projection");
      expect(codeOnly(source(file))).not.toMatch(/\breason\b/i);
    }
    // The veil's site the surface is handed carries no prose either.
    const veil = veilSite() as unknown as Record<string, unknown>;
    expect("reason" in veil).toBe(false);
  });
});

/* ----------------------------------------------------------------------- *
 * 6. No cursor, order, count or score anywhere on the surface.
 * ----------------------------------------------------------------------- */

describe("no cursor, order, count or score strings", () => {
  test("the surface's code holds no ordering, cursor or count vocabulary", () => {
    const FORBIDDEN =
      /\b(index|ordinal|cursor|position|order|count|total|next|previous|first|last|rank|score|streak|badge|dot|cue|glow|progress|page)\w*/i;
    for (const file of SURFACE_FILES) {
      expect({ file, found: FORBIDDEN.test(bodyOnly(source(file))) }).toEqual({
        file,
        found: false,
      });
    }
  });

  test("the surface's own words hold no number and no count", () => {
    const words = [
      PULL_TITLE,
      PULL_DOOR_LABEL,
      PULL_DOOR_TITLE,
      PULL_PANEL_LABEL,
      PULL_CLOSE_LABEL,
      PULL_SELECTION,
      DANGLING_PIN_NOTE,
    ].join(" ");
    expect(words).not.toMatch(/\d/);
    expect(words).not.toMatch(
      /\b(count|counts|total|totals|number|numbers|tally|list|lists)\b/i,
    );
  });

  test("the rendered surface holds no list semantics and no positions", () => {
    const html = renderPanel(reading());
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("<li");
    expect(html).not.toContain("posinset");
    expect(html).not.toContain("aria-setsize");
    expect(html).not.toContain("data-index");
    // One reading, one block: no per-site elements at all.
    expect(html.match(/class="pull-panel"/g) ?? []).toHaveLength(1);
    expect(html.match(/class="pull-lines"/g) ?? []).toHaveLength(1);
    expect(html.match(/class="pull-site/g) ?? []).toHaveLength(0);
  });

  test("the door's CSS is quiet and carries no urgency", () => {
    const css = source("canvas/canvas.css");
    function ruleBody(selector: string): string {
      const start = css.indexOf(selector + " {");
      expect(start).toBeGreaterThan(-1);
      const open = css.indexOf("{", start);
      const close = css.indexOf("}", open);
      return css.slice(open + 1, close);
    }
    // The selector group gains the pen's toggle (added 2026-11-16 per user
    // review): the same quiet action vocabulary, scanned by the same rule.
    const door = ruleBody(
      ".level-edit,\n.level-loop,\n.level-veil,\n.level-draw,\n.level-ask,\n.pull-door",
    );
    expect(door).toContain("color: #8d887c");
    expect(door).not.toMatch(/animation|glow|pulse|red|orange/i);
    const panel = ruleBody(".pull-panel");
    expect(panel).toContain("animation: fade-in 160ms");
    expect(panel).not.toMatch(/glow|pulse|red|orange/i);
    // The lines are selectable text in a monospace block, like the peek's head.
    const lines = ruleBody(".pull-lines");
    expect(lines).toContain("white-space: pre-wrap");
    expect(lines).toContain("user-select: text");
    expect(lines).toContain("ui-monospace");
  });
});

/* ----------------------------------------------------------------------- *
 * 7. The words never carry the contacts' Ask.
 * ----------------------------------------------------------------------- */

describe("the door is not the contacts' Ask", () => {
  test('the phrase "ask the map" appears nowhere in the source', () => {
    for (const file of sourceFiles()) {
      expect({ file, found: /ask the map/i.test(source(file)) }).toEqual({
        file,
        found: false,
      });
    }
  });

  test("the door's code name is the pull ask", () => {
    expect(source("canvas/PullDoor.tsx")).toContain("THE PULL ASK'S DOOR");
    expect(source("pull/ask.ts")).toContain("THE PULL ASK");
    expect(PULL_DOOR_LABEL).toBe("where am I thin…");
    expect(PULL_DOOR_TITLE).toBe(
      "read the records that exist — each at its own site",
    );
  });
});
