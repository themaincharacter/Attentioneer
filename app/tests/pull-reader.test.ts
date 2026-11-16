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
import { dirname, join } from "node:path";
import { parseAssumptions } from "../src/map/assumptions";
import { parseMarks } from "../src/map/marks";
import { parsePointers } from "../src/map/pointers";
import { parseQuantities } from "../src/map/quantities";
import { parsePins } from "../src/scenarios/pins";
import { parseVeils, type Veil } from "../src/map/veils";
import { projectVeil } from "../src/pull/projection";
import {
  DANGLING_PIN_NOTE,
  PULL_SELECTION,
  pullSiteKey,
  readPull,
  type PullReading,
  type PullSite,
} from "../src/pull/reader";

/**
 * Epic 13 story 1 — the reader, automated. The pull's read-set walk is a
 * FUNCTION of records: given a fixture workspace on disk, every read-set record
 * comes back at its own site with its own words, and the reading opens with the
 * selection SAID. The rules asserted here are the story's: the read-set walk
 * (every family), the verbatim fields (byte-equal to the record), co-presence
 * (no ordering or grouping keys, no nesting by part), the selection sentence,
 * the veil projection (no veil record, no prose), and the read-only rule at the
 * reading's own level (the bytes on disk are untouched). The source-level scans
 * live in `pull-scans.test.ts`.
 */

const NL = "\n";

/** A workspace fixture, seeded once: the app's own files, as the app writes them. */
const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-pull-"));

const FILES: Record<string, string> = {
  "map/marks.jsonl": [
    '{"from":"rain","kind":"open","to":"soil"}',
    '{"kind":"open","on":"rain"}',
    '{"kind":"open","on":"rain","path":"notes/rain.md"}',
    '{"kind":"open","x":-40,"y":12.5}',
  ]
    .map((line) => line + NL)
    .join(""),
  "map/assumptions.jsonl": [
    '{"on":"rain","text":"mulch holds the rain"}',
    '{"loop":"rain-loop","text":"the loop is reinforcing"}',
    '{"on":"rain","text":"the bed is wide"}',
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
    '{"on":"rain","text":"mulch holds the rain every day"}',
    '{"loop":"rain-loop","text":"the loop is reinforcing"}',
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

function text(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** The fixture's lines, as the file holds them. */
function fileLines(rel: string): string[] {
  return text(rel)
    .split(NL)
    .filter((line) => line !== "");
}

function reading(): PullReading {
  return readPull({
    marks: parseMarks(text("map/marks.jsonl")).marks,
    assumptions: parseAssumptions(text("map/assumptions.jsonl")).assumptions,
    quantities: parseQuantities(text("map/quantities.jsonl")).quantities,
    pointers: parsePointers(text("map/pointers.jsonl")).pointers,
    pins: parsePins(text("scenarios/spring/assumption-pins.jsonl")).pins,
    veils: parseVeils(text("map/veils.jsonl")).veils.map(projectVeil),
  });
}

function sitesOf(result: PullReading, family: string): PullSite[] {
  return result.sites.filter((site) => site.family === family);
}

function wordsOf(result: PullReading, family: string): string[] {
  return sitesOf(result, family).map((site) => (site as { words: string }).words);
}

/** The fixture's one veil record (the reader never sees this). */
function veilRecord(): Veil {
  return parseVeils(text("map/veils.jsonl")).veils[0];
}

const ORDERING_OR_GROUPING =
  /order|sort|rank|group|index|cursor|queue|score|weight|density|total|position|next|previous|part/i;

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...keysDeep(child),
  ]);
}

describe("the read-set walk: every record at its own site", () => {
  test("every family is present, and the selection opens the reading", () => {
    const result = reading();
    expect(result.said).toBe(PULL_SELECTION);
    expect(new Set(result.sites.map((site) => site.family))).toEqual(
      new Set(["mark", "assumption", "quantity", "pointer", "pin", "veil"]),
    );
    // The fixture holds the read set as the app would: nothing invented.
    expect(sitesOf(result, "mark")).toHaveLength(4);
    expect(sitesOf(result, "assumption")).toHaveLength(3);
    expect(sitesOf(result, "quantity")).toHaveLength(2);
    expect(sitesOf(result, "pointer")).toHaveLength(3);
    expect(sitesOf(result, "pin")).toHaveLength(3);
    expect(sitesOf(result, "veil")).toHaveLength(1);
  });

  test("each record stands at the anchor its own grammar names", () => {
    const result = reading();
    expect(sitesOf(result, "mark").map((site) => site.site)).toEqual([
      { type: "link", from: "rain", to: "soil" },
      { type: "word", slug: "rain" },
      { type: "pointer", on: "rain", form: "path", value: "notes/rain.md" },
      { type: "spot", x: -40, y: 12.5 },
    ]);
    expect(sitesOf(result, "assumption").map((site) => site.site)).toEqual([
      { type: "word", slug: "rain" },
      { type: "loop", slug: "rain-loop" },
      { type: "word", slug: "rain" },
    ]);
    expect(sitesOf(result, "quantity").map((site) => site.site)).toEqual([
      { type: "word", slug: "rain" },
      { type: "flow", from: "rain", to: "soil" },
    ]);
    expect(sitesOf(result, "pointer").map((site) => site.site)).toEqual([
      { type: "pointer", on: "rain", form: "path", value: "notes/rain.md" },
      { type: "pointer", on: "soil", form: "url", value: "https://example.org/soil" },
      { type: "pointer", on: "soil", form: "at", value: "/home/someone/garden.csv" },
    ]);
    expect(sitesOf(result, "pin").map((site) => site.site)).toEqual([
      { type: "word", slug: "rain" },
      { type: "word", slug: "rain" },
      { type: "loop", slug: "rain-loop" },
    ]);
    expect(sitesOf(result, "veil").map((site) => site.site)).toEqual([
      { type: "area", x: 120.5, y: -40.25, w: 300, h: 200 },
    ]);
  });

  test("the words ARE the record's line, byte for byte", () => {
    const result = reading();
    expect(new Set(wordsOf(result, "mark"))).toEqual(
      new Set(fileLines("map/marks.jsonl")),
    );
    expect(new Set(wordsOf(result, "assumption"))).toEqual(
      new Set(fileLines("map/assumptions.jsonl")),
    );
    expect(new Set(wordsOf(result, "quantity"))).toEqual(
      new Set(fileLines("map/quantities.jsonl")),
    );
    expect(new Set(wordsOf(result, "pointer"))).toEqual(
      new Set(fileLines("map/pointers.jsonl")),
    );
    expect(new Set(wordsOf(result, "pin"))).toEqual(
      new Set(fileLines("scenarios/spring/assumption-pins.jsonl")),
    );
  });

  test("the named fields ride verbatim: the wordless pair, the pointer form, a claim, a stock", () => {
    const result = reading();
    const markWords = wordsOf(result, "mark");
    // The mark on the signed link: the wordless ordered pair, no sign.
    expect(markWords).toContain('{"from":"rain","kind":"open","to":"soil"}');
    // The mark on a pointer line: the pointer's own target form.
    expect(markWords).toContain(
      '{"kind":"open","on":"rain","path":"notes/rain.md"}',
    );
    expect(wordsOf(result, "assumption")).toContain(
      '{"on":"rain","text":"mulch holds the rain"}',
    );
    expect(wordsOf(result, "quantity")).toContain('{"amount":12,"on":"rain"}');
  });

  test("an absent amount stays absent — unknown is never written as zero", () => {
    const result = reading();
    const flow = wordsOf(result, "quantity")[1];
    expect(flow).toBe('{"from":"rain","to":"soil"}');
    expect(flow).not.toContain("amount");
  });

  test("a dangling pin keeps its claim and carries the drop-rule sentence", () => {
    const result = reading();
    const pins = sitesOf(result, "pin") as Array<{
      words: string;
      note: string | null;
      site: unknown;
    }>;
    const dangling = pins.filter((pin) => pin.note !== null);
    expect(dangling).toHaveLength(1);
    expect(dangling[0].note).toBe(DANGLING_PIN_NOTE);
    // The record is shown as it stands: its words are still its words.
    expect(dangling[0].words).toBe(
      '{"on":"rain","text":"mulch holds the rain every day"}',
    );
    expect(dangling[0].site).toEqual({ type: "word", slug: "rain" });
    // The pins whose claim still stands carry no sentence.
    expect(pins.filter((pin) => pin.note === null)).toHaveLength(2);
  });
});

describe("co-presence, never arrangement", () => {
  test("the reading's shape carries no ordering or grouping keys", () => {
    const result = reading();
    expect(Object.keys(result).sort()).toEqual(["said", "sites"]);
    const record = sitesOf(result, "mark")[0];
    expect(Object.keys(record).sort()).toEqual([
      "family",
      "note",
      "site",
      "words",
    ]);
    const veil = sitesOf(result, "veil")[0];
    expect(Object.keys(veil).sort()).toEqual([
      "family",
      "location",
      "name",
      "site",
    ]);
    for (const key of keysDeep(result)) {
      expect(key).not.toMatch(ORDERING_OR_GROUPING);
    }
  });

  test("sites are not nested by part: one collection, no containers", () => {
    const result = reading();
    // The only collection is the reading's own sites list.
    expect(Array.isArray(result.sites)).toBe(true);
    for (const site of result.sites) {
      for (const value of Object.values(site)) {
        expect(Array.isArray(value)).toBe(false);
      }
    }
  });

  test("two claims on one word are two entries, never a pair", () => {
    const result = reading();
    const atRain = sitesOf(result, "assumption").filter(
      (site) => (site.site as { slug?: string }).slug === "rain",
    );
    expect(atRain).toHaveLength(2);
    const [first, second] = atRain as Array<{ words: string }>;
    expect(first.words).not.toBe(second.words);
    expect(Object.keys(first).sort()).toEqual(["family", "note", "site", "words"]);
    expect(Object.keys(second).sort()).toEqual(["family", "note", "site", "words"]);
  });

  test("a mark, a claim, a stock and a pin share one site without a wrapper", () => {
    const result = reading();
    const atRain = result.sites.filter((site) => {
      const anchor = site.site as { type?: string; slug?: string };
      return anchor.type === "word" && anchor.slug === "rain";
    });
    expect(new Set(atRain.map((site) => site.family))).toEqual(
      new Set(["mark", "assumption", "quantity", "pin"]),
    );
    // Co-presence: each entry carries only its own record.
    for (const site of atRain) {
      expect(Object.keys(site).sort()).toEqual(
        site.family === "veil"
          ? ["family", "location", "name", "site"]
          : ["family", "note", "site", "words"],
      );
    }
  });

  test("the same records make the same reading (a function, not a feed)", () => {
    expect(reading().sites).toEqual(reading().sites);
    expect(pullSiteKey(sitesOf(reading(), "mark")[0])).toBe(
      pullSiteKey(sitesOf(reading(), "mark")[0]),
    );
    expect(pullSiteKey(sitesOf(reading(), "mark")[0])).not.toBe(
      pullSiteKey(sitesOf(reading(), "mark")[1]),
    );
  });
});

describe("the selection is said", () => {
  test("the sentence is the ADR's, verbatim", () => {
    expect(PULL_SELECTION).toBe(
      "this speaks where records exist; the rest is silence, not safety.",
    );
    expect(reading().said).toBe(PULL_SELECTION);
  });

  test("the selection reports; it never directs", () => {
    expect(PULL_SELECTION).not.toMatch(
      /(^|\W)(you|should|must|ought|consider|try)(\W|$)/i,
    );
  });

  test("no records: the selection is still said — silence, not safety", () => {
    const empty = readPull({
      marks: [],
      assumptions: [],
      quantities: [],
      pointers: [],
      pins: [],
      veils: [],
    });
    expect(empty.said).toBe(PULL_SELECTION);
    expect(empty.sites).toEqual([]);
  });
});

describe("the veil projection: the fields, and nothing else", () => {
  test("the projection is the area, the name and the location — no other key", () => {
    const veil = veilRecord();
    const projected = projectVeil(veil);
    expect(Object.keys(projected).sort()).toEqual(["area", "location", "name"]);
    // The numbers are the record's, exactly as written: no rounding, no repair.
    expect(projected.area).toEqual({ x: 120.5, y: -40.25, w: 300, h: 200 });
    expect(projected.name).toBe("rain cover");
    expect(projected.location).toBe("x 120.5, y -40.25, w 300, h 200");
  });

  test("the projection drops the prose: no field, no key, no bytes", () => {
    const veil = veilRecord();
    const projected = projectVeil(veil) as unknown as Record<string, unknown>;
    expect("reason" in projected).toBe(false);
    expect(JSON.stringify(projected)).not.toContain("muddled");
    // The record HAS the prose; the projection has nowhere to put it.
    expect(Object.keys(veil)).toContain("reason");
    expect(Object.keys(projected)).not.toContain("reason");
    // A raw veil cannot be the reader's input: it has no `area` at all.
    expect("area" in veil).toBe(false);
  });

  test("the veil's site is its box, with the name and location over it", () => {
    const result = reading();
    const veil = sitesOf(result, "veil")[0];
    expect(veil).toEqual({
      family: "veil",
      site: { type: "area", x: 120.5, y: -40.25, w: 300, h: 200 },
      name: "rain cover",
      location: "x 120.5, y -40.25, w 300, h 200",
    });
    expect("words" in veil).toBe(false);
  });

  test("the reading never carries the prose", () => {
    expect(JSON.stringify(reading())).not.toContain("muddled");
  });
});

describe("the reading is read-only", () => {
  function tree(): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out[full] = readFileSync(full, "utf8");
      }
    };
    walk(ROOT);
    return out;
  }

  test("making the reading changes no file and creates none", () => {
    const before = tree();
    const result = reading();
    expect(result.sites.length).toBeGreaterThan(0);
    expect(tree()).toEqual(before);
  });

  test("the reading carries no path to anything", () => {
    const result = reading();
    expect(keysDeep(result)).not.toContain("path");
    expect(keysDeep(result)).not.toContain("file");
    expect(keysDeep(result)).not.toContain("dir");
    expect(JSON.stringify(result)).not.toContain(ROOT);
  });
});
