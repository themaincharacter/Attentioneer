import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  coveredWordSlugs,
  dedupeVeils,
  findVeil,
  nameVeil,
  parseVeilLine,
  parseVeils,
  removeVeil,
  renameVeil,
  serializeVeilLine,
  serializeVeils,
  topVeilOf,
  uniqueVeilName,
  veilBox,
  veilCoversPoint,
  veilKey,
  veilKeys,
  veilSlug,
  veilsCoveringWord,
  veilsPath,
  type Veil,
  type VeilBox,
} from "../src/map/veils";
import { NOTICE_FAMILY_GAME, noticeVisibleIn } from "../src/canvas/notices";

/**
 * Epic 9 story 1's veil record, automated (ADR-0023): `map/veils.jsonl` — one
 * canonical line per veil, the name-derived slug with the LOOPS rules verbatim
 * (collision suffixes at coin AND rename; a separate namespace), the captured
 * BOX (x/y/w/h, never the stroke), and the reason as prose kept verbatim
 * (World B). The family posture holds: unknown keys preserved, malformed lines
 * preserved AND surfaced, CRLF/BOM tolerated, a missing file means no veils.
 * Retire is a delete (no tombstone), and no map batch ever touches a veil —
 * because nothing references one.
 */

const NL = "\n";

function veil(
  name: string,
  box: VeilBox = { x: 10, y: 20, w: 120, h: 40 },
  reason = "not yet",
  extra: Record<string, unknown> = {},
): Veil {
  return { name, ...box, reason, extra };
}

const box: VeilBox = { x: 10, y: 20, w: 120, h: 40 };

describe("the veil line's canonical bytes", () => {
  test("compact, sorted keys, the box and the reason as a JSON string", () => {
    expect(serializeVeilLine(veil("rain veil"))).toBe(
      '{"h":40,"name":"rain veil","reason":"not yet","w":120,"x":10,"y":20}',
    );
  });

  test("a document is one line per veil, in FILE ORDER, trailing newline", () => {
    const text = serializeVeils([veil("first"), veil("second", box, "later")]);
    expect(text).toBe(
      '{"h":40,"name":"first","reason":"not yet","w":120,"x":10,"y":20}' +
        NL +
        '{"h":40,"name":"second","reason":"later","w":120,"x":10,"y":20}' +
        NL,
    );
    // File order IS the stacking order, so it is never sorted.
    expect(text.split(NL)[0]).toContain('"first"');
  });

  test("an empty document is the canonical empty JSONL (one newline)", () => {
    expect(serializeVeils([])).toBe(NL);
  });

  test("a line round-trips through parse and serialize byte-exactly", () => {
    const line = serializeVeilLine(veil("rain veil")).trim();
    const parsed = parseVeilLine(line);
    expect(parsed).not.toBeNull();
    expect(serializeVeilLine(parsed as Veil)).toBe(line);
  });

  test("the file path is map/veils.jsonl under the workspace", () => {
    expect(veilsPath("/maps/garden")).toBe("/maps/garden/map/veils.jsonl");
  });
});

describe("the natural key is the name's slug, with the loops rules verbatim", () => {
  test("the slug folds case and turns every non-letter into a dash", () => {
    expect(veilSlug("Rain Veil!")).toBe("rain-veil");
    expect(veilSlug("  a  veil  ")).toBe("a-veil");
    expect(veilSlug("not yet")).toBe("not-yet");
    // Non-Latin names survive: the rules are slugName's, not an ASCII list.
    expect(veilSlug("雨 Veil")).toBe("雨-veil");
    expect(veilSlug("")).toBe("untitled");
  });

  test("the key is the name's slug; two lines with one slug share a key", () => {
    expect(veilKey(veil("Rain Veil"))).toBe("rain-veil");
    expect(veilKeys([veil("Rain Veil"), veil("soil")])).toEqual(
      new Set(["rain-veil", "soil"]),
    );
    expect(findVeil([veil("Rain Veil")], "rain-veil")?.name).toBe("Rain Veil");
    expect(findVeil([veil("Rain Veil")], "Rain Veil")?.name).toBe("Rain Veil");
    expect(findVeil([veil("Rain Veil")], "soil")).toBeNull();
  });

  test("a collision mints the numeric suffix IN THE NAME at coin time", () => {
    expect(uniqueVeilName("rain", new Set())).toBe("rain");
    expect(uniqueVeilName("rain", new Set(["rain"]))).toBe("rain 2");
    expect(uniqueVeilName("rain", new Set(["rain", "rain-2"]))).toBe("rain 3");
    // The suffix is the slug's own (nextSlug), so a numbered coin nests
    // honestly instead of silently sharing a key.
    expect(uniqueVeilName("rain 2", new Set(["rain", "rain-2"]))).toBe(
      "rain 2 2",
    );
  });

  test("coining appends one line and keeps the file order", () => {
    let veils: Veil[] = [];
    veils = nameVeil(veils, "rain", box, "because");
    veils = nameVeil(veils, "soil", { x: 0, y: 0, w: 5, h: 5 }, "why");
    veils = nameVeil(veils, "rain", box, "again");
    expect(veils.map((v) => v.name)).toEqual(["rain", "soil", "rain 2"]);
    expect(veils[1].reason).toBe("why");
  });

  test("name AND reason are coined together: either blank writes nothing", () => {
    // The pre-verbal case stays the bare mark (ADR-0023 decision 1).
    expect(nameVeil([], "", box, "why")).toEqual([]);
    expect(nameVeil([], "   ", box, "why")).toEqual([]);
    expect(nameVeil([], "rain", box, "")).toEqual([]);
    expect(nameVeil([], "rain", box, "   ")).toEqual([]);
    expect(nameVeil([veil("rain")], "  ", box, "why").length).toBe(1);
    expect(nameVeil([veil("rain")], "soil", box, " ").length).toBe(1);
  });

  test("the name is trimmed; the reason is stored exactly as it arrived", () => {
    const veils = nameVeil([], "  rain  ", box, "  a reason  ");
    expect(veils[0].name).toBe("rain");
    // World B: no trim, no normalization — the prose is the person's.
    expect(veils[0].reason).toBe("  a reason  ");
  });

  test("veils are a separate namespace: a word's or a loop's slug never blocks one", () => {
    // The caller supplies what is taken, and the writer supplies VEIL keys only.
    expect(uniqueVeilName("rain", new Set(["rain-loop"]))).toBe("rain");
    const source = readFileSync(
      new URL("../src/map/veils.ts", import.meta.url),
      "utf8",
    );
    // No import from another record family: a veil's key can never consult a
    // word's, a loop's or a mark's identity.
    expect(source).not.toContain("../map/refs");
    expect(source).not.toContain("../map/loops");
    expect(source).not.toContain("../map/marks");
    expect(source).not.toContain("../map/model");
    expect(source).not.toContain("./refs");
    expect(source).not.toContain("./loops");
  });
});

describe("renaming a veil: in place, with the same collision rule", () => {
  test("the name and its key change in one in-place rewrite", () => {
    const veils = [veil("rain"), veil("soil", box, "kept")];
    const next = renameVeil(veils, veils[1], "mulch");
    expect(next.map((v) => v.name)).toEqual(["rain", "mulch"]);
    // The box, the reason and unknown keys are the record's own: preserved.
    expect(next[1]).toEqual({ ...veil("mulch", box, "kept") });
    expect(veils[1].name).toBe("soil");
  });

  test("a taken key mints the suffix at RENAME too", () => {
    const veils = [veil("rain"), veil("soil")];
    const next = renameVeil(veils, veils[1], "Rain");
    expect(next[1].name).toBe("Rain 2");
    expect(next[0].name).toBe("rain");
    expect(veilKey(next[1])).toBe("rain-2");
  });

  test("an empty name, the same name or an unknown veil is a quiet no-op", () => {
    const veils = [veil("rain")];
    expect(renameVeil(veils, veils[0], "")).toEqual(veils);
    expect(renameVeil(veils, veils[0], "  ")).toEqual(veils);
    expect(renameVeil(veils, veils[0], "rain")).toEqual(veils);
    expect(renameVeil(veils, veil("ghost"), "soil")).toEqual(veils);
  });

  test("a rename never touches another line's bytes", () => {
    const veils = [veil("rain", box, "r"), veil("soil", box, "s")];
    const text = serializeVeils(veils);
    const next = renameVeil(veils, veils[0], "storm");
    const after = serializeVeils(next).split(NL);
    // The renamed line moved in place (index 0); the OTHER line is untouched.
    expect(after[1]).toBe(text.split(NL)[1]);
    expect(after[0]).toContain('"name":"storm"');
  });

  test("unknown keys ride the rename (and the coin has none)", () => {
    const veils = [veil("rain", box, "r", { note: "hand-added" })];
    const next = renameVeil(veils, veils[0], "storm");
    expect(next[0].extra).toEqual({ note: "hand-added" });
    expect(serializeVeilLine(next[0])).toContain('"note":"hand-added"');
  });
});

describe("the reason is prose: stored verbatim, never interpreted", () => {
  test("quotes, backslashes, newlines and leading spaces survive byte-exactly", () => {
    const reasons = [
      'he said "no" — and meant it',
      'back\\slash and "escaped" quotes',
      "line one\nline two",
      "  leading and trailing  ",
      "雨 — まだ",
      '{"looks":"like json"}',
    ];
    for (const reason of reasons) {
      const line = serializeVeilLine(veil("rain", box, reason));
      const parsed = parseVeilLine(line);
      expect(parsed).not.toBeNull();
      expect(parsed?.reason).toBe(reason);
      expect(serializeVeilLine(parsed as Veil)).toBe(line);
    }
  });

  test("the reason is a string field, never a nested key source", () => {
    const obj = JSON.parse(serializeVeilLine(veil("rain", box, '{"name":"evil"}')));
    expect(typeof obj.reason).toBe("string");
    expect(obj.reason).toBe('{"name":"evil"}');
    expect(obj.name).toBe("rain");
  });
});

describe("the family posture: unknown keys, malformed lines, CRLF/BOM", () => {
  test("unknown keys on a known veil survive a rewrite", () => {
    const line = '{"name":"rain","x":0,"y":0,"w":10,"h":10,"reason":"r","why":7}';
    const parsed = parseVeilLine(line);
    expect(parsed?.extra).toEqual({ why: 7 });
    const rewritten = serializeVeilLine(parsed as Veil);
    expect(rewritten).toContain('"why":7');
    expect(parseVeilLine(rewritten)?.extra).toEqual({ why: 7 });
  });

  test("out-of-shape lines are malformed: kept AND surfaced, never guessed at", () => {
    const good = serializeVeilLine(veil("good")).trim();
    const bad = [
      "not json at all",
      '["an","array"]',
      '{"x":0,"y":0,"w":10,"h":10,"reason":"no name"}',
      '{"name":"","x":0,"y":0,"w":10,"h":10,"reason":"blank name"}',
      '{"name":"no reason","x":0,"y":0,"w":10,"h":10}',
      '{"name":"bad reason","x":0,"y":0,"w":10,"h":10,"reason":7}',
      '{"name":"blank reason","x":0,"y":0,"w":10,"h":10,"reason":""}',
      '{"name":"spaces","x":0,"y":0,"w":10,"h":10,"reason":"   "}',
      '{"name":"no box","y":0,"w":10,"h":10,"reason":"r"}',
      '{"name":"bad box","x":"10","y":0,"w":10,"h":10,"reason":"r"}',
      '{"name":"infinite","x":1e999,"y":0,"w":10,"h":10,"reason":"r"}',
    ];
    const parsed = parseVeils([good, ...bad, good].join(NL));
    expect(parsed.veils).toHaveLength(2);
    expect(parsed.veils.map((v) => v.name)).toEqual(["good", "good"]);
    expect(parsed.malformed).toEqual(bad);
    // Preserved verbatim through the writer: the app never drops a byte it
    // could not read.
    const rewritten = serializeVeils(parsed.veils, parsed.malformed);
    for (const line of bad) expect(rewritten).toContain(line);
  });

  test("the malformed lines are SURFACED (the notices family), not invisible", () => {
    // The record layer hands them out; the strip's table must own the family.
    expect(NOTICE_FAMILY_GAME.veils).toBe("all");
    for (const level of ["concept", "dynamics", "ground"] as const) {
      expect(noticeVisibleIn("veils", level)).toBe(true);
    }
    const app = readFileSync(
      new URL("../src/App.tsx", import.meta.url),
      "utf8",
    );
    expect(app).toContain("malformedVeils");
    expect(app).toContain("unreadable line in map/veils.jsonl");
  });

  test("a BOM and CRLF from a hand edit are tolerated", () => {
    const a = serializeVeilLine(veil("rain")).trim();
    const b = serializeVeilLine(veil("soil")).trim();
    const parsed = parseVeils("\uFEFF" + a + "\r\n" + b + "\r\n");
    expect(parsed.malformed).toEqual([]);
    expect(parsed.veils.map((v) => v.name)).toEqual(["rain", "soil"]);
  });

  test("terminating and blank lines are ignored; an empty file means none", () => {
    expect(parseVeils("")).toEqual({ veils: [], malformed: [] });
    expect(parseVeils(NL + NL)).toEqual({ veils: [], malformed: [] });
    expect(parseVeils("\r\n")).toEqual({ veils: [], malformed: [] });
    // A MISSING file is a missing read, never an error: loadVeils answers none.
    const source = readFileSync(
      new URL("../src/map/veils.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "text === null ? { veils: [], malformed: [] } : parseVeils(text)",
    );
  });

  test("hand duplicates share a key: dedupe keeps the LAST write, order kept", () => {
    const first = veil("rain", box, "first");
    const second = veil("rain", { x: 1, y: 2, w: 3, h: 4 }, "second");
    const deduped = dedupeVeils([first, second]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].reason).toBe("second");
    // The written file is one line per key, the survivor's.
    const text = serializeVeils([first, second]);
    expect(text.trim().split(NL)).toHaveLength(1);
    expect(text).toContain('"reason":"second"');
  });
});

describe("retire is a delete: the line goes and nothing else", () => {
  test("only that line disappears; no tombstone is written", () => {
    const veils = [veil("rain"), veil("soil"), veil("mulch")];
    const next = removeVeil(veils, veils[1]);
    expect(next.map((v) => v.name)).toEqual(["rain", "mulch"]);
    expect(serializeVeils(next)).not.toContain("soil");
    expect(serializeVeils(next).trim().split(NL)).toHaveLength(2);
    // Removing a name that is not there is a quiet no-op.
    expect(removeVeil(veils, "ghost")).toEqual(veils);
    expect(removeVeil(next, "soil")).toEqual(next);
  });

  test("a veil is addressed by its name or its slug", () => {
    const veils = [veil("Rain Veil")];
    expect(removeVeil(veils, "rain-veil")).toHaveLength(0);
    expect(removeVeil(veils, veil("rain veil"))).toHaveLength(0);
  });

  test("retire leaves every other line byte-identical", () => {
    const a = serializeVeilLine(veil("rain"));
    const b = serializeVeilLine(veil("soil"));
    const c = serializeVeilLine(veil("mulch"));
    const veils = [veil("rain"), veil("soil"), veil("mulch")];
    expect(serializeVeils(removeVeil(veils, veils[1]))).toBe(
      [a, c].join(NL) + NL,
    );
    expect(b).not.toBe("");
  });
});

describe("the veil is a committed-model record that the batches never touch", () => {
  const source = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8");

  test("NO map record carries a veil field (covered is a render-time reading)", () => {
    for (const file of [
      "refs",
      "distances",
      "marks",
      "links",
      "loops",
      "assumptions",
      "pointers",
      "quantities",
      "model",
      "shelf",
    ]) {
      expect(source(`../src/map/${file}.ts`)).not.toContain("veil");
    }
  });

  test("the atomic batches have no veil writer at all (nothing references one)", () => {
    const patches = source("../src/map/patches.ts");
    expect(patches.toLowerCase()).not.toContain("veil");
    // A word's rename and removal are the two batches that could reach a
    // record with slugs in it; neither has a veil to rewrite or drop because
    // no veil line names a word.
    const rename = patches.slice(
      patches.indexOf("export async function renameReference"),
      patches.indexOf("export async function removeReference"),
    );
    const remove = patches.slice(
      patches.indexOf("export async function removeReference"),
    );
    expect(rename.toLowerCase()).not.toContain("veil");
    expect(remove.toLowerCase()).not.toContain("veil");
  });

  test("the records seam keeps veils in map/: they are never a branch's", () => {
    const records = source("../src/map/records.ts");
    expect(records).toContain("map/veils.jsonl");
    expect(records).toContain("never copied into a branch");
    // The three VARIANT files a branch carries never grow a veil entry.
    expect(records).not.toContain('veils: "veils.jsonl"');
    // veils.ts never reads the branch arithmetic.
    const veils = source("../src/map/veils.ts");
    expect(veils).not.toContain("recordsDirOf");
    expect(veils).not.toContain("scenariosDir");
    expect(veils).not.toContain("scenarioDir(");
  });

  test("the box is the captured rectangle, not a stroke", () => {
    const veils = nameVeil([], "rain", { x: 5, y: 6, w: 70, h: 30 }, "r");
    expect(veilBox(veils[0])).toEqual({ x: 5, y: 6, w: 70, h: 30 });
    // Numbers only: no path, no points, no stroke width on the record.
    const parsed = parseVeilLine(serializeVeilLine(veils[0]));
    expect(parsed).not.toBeNull();
    const value = parsed as Veil;
    expect(typeof value.x).toBe("number");
    expect(typeof value.y).toBe("number");
    expect(typeof value.w).toBe("number");
    expect(typeof value.h).toBe("number");
    expect(value.extra).toEqual({});
  });

  test("a degenerate box is preserved and covers nothing (never repaired)", () => {
    const zero = veil("zero", { x: 0, y: 0, w: 0, h: 10 }, "r");
    expect(veilCoversPoint(zero, { x: 0, y: 5 })).toBe(false);
    const negative = veil("negative", { x: 10, y: 10, w: -5, h: -5 }, "r");
    expect(veilCoversPoint(negative, { x: 9, y: 9 })).toBe(false);
    // The line still round-trips as given.
    expect(parseVeilLine(serializeVeilLine(negative))).toEqual(negative);
  });

  test("the region test family helpers read only the veil and the word's box", () => {
    const words = [
      { slug: "rain", pos: { x: 10, y: 20 }, box: { w: 20, h: 20 } },
      { slug: "soil", pos: { x: 500, y: 500 }, box: { w: 20, h: 20 } },
    ];
    const veils = [veil("cover", { x: 0, y: 0, w: 100, h: 100 }, "r")];
    expect([...coveredWordSlugs(veils, words)]).toEqual(["rain"]);
    expect(topVeilOf(veils, words[0])?.name).toBe("cover");
    expect(veilsCoveringWord(veils, words[1])).toEqual([]);
    expect(topVeilOf(veils, words[1])).toBeNull();
  });
});
