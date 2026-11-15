import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  addAssumption,
  findOrphanAssumptions,
  parseAssumptions,
  serializeAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "../src/map/assumptions";
import { parseDistances, serializeDistances, type Distance } from "../src/map/distances";
import {
  linkKey,
  parseLinks,
  serializeLinks,
  type Link,
  type LinkSign,
} from "../src/map/links";
import {
  loopSlug,
  parseLoops,
  serializeLoops,
  type Loop,
} from "../src/map/loops";
import {
  findOrphanMarks,
  parseMarks,
  serializeMarks,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import {
  findDuplicatePointers,
  findOrphanPointers,
  parsePointers,
  pointerKey,
  serializePointers,
  type Pointer,
} from "../src/map/pointers";
import {
  dedupe,
  parseModel,
  serializeModel,
  type PlayingSet,
} from "../src/map/model";
import {
  dropAssumptionsTouching,
  dropLinkAssumptions,
  dropLoopAssumptions,
  dropMarksTouching,
  dropMembership,
  dropPointerMarksTouching,
  dropPointersTouching,
  dropTouching,
  dropTouchingLinks,
  rewriteAssumptionTargets,
  rewriteEndpoints,
  rewriteLinkEndpoints,
  rewriteLoopPaths,
  rewriteMarkEndpoints,
  rewriteMembership,
  rewritePointerMarkOwners,
  rewritePointerOwners,
} from "../src/map/patches";
import { parseReference, serializeReference, type Reference } from "../src/map/refs";
import { BAND_ZOOM, GROUND_FROM } from "../src/canvas/zoomBands";
import { createLevelPin, shouldPinLevel } from "../src/canvas/gates";
import { workspaceYml } from "../src/lib/serialize";
import {
  DEFAULT_LEVEL,
  levelOfText,
  withLevel,
  type Level,
} from "../src/workspace/level";
import { createLevelHandoff } from "../src/workspace/levelHandoff";

/**
 * Story-5 cross-record hardening: the four records (model, links, loops,
 * assumptions) interact in ONE atomic batch, and this suite pins that interaction
 * where the per-record suites cannot — a rename/remove that moves all four at
 * once, the batch's write order and its crash-order comments, and malformed /
 * orphan / duplicate lines surfaced across the records together (ADR-0012
 * decision 6, ADR-0013 decision 5).
 *
 * `renameReference`/`removeReference` cross the Tauri fs bridge, so this suite
 * applies the SAME pure steps in the SAME documented order and then asserts the
 * records' bytes. The order itself is read from the source the app runs; no fs
 * stub is invented (the real batch is the human pass).
 */

const SLUGS = ["mulch", "rain", "soil"];

function play(words: string[]): PlayingSet {
  return { words, extra: {} };
}

function link(from: string, to: string, sign: LinkSign): Link {
  return { from, to, sign, extra: {} };
}

function loop(name: string, path: string[]): Loop {
  return { name, path, extra: {} };
}

function claim(text: string, target: AssumptionTarget): Assumption {
  return { text, target, extra: {} };
}

function open(target: MarkTarget): Mark {
  return { kind: "open", target, extra: {} };
}

function reference(name: string, slug: string, body = ""): Reference {
  return { id: slug, slug, name, x: 100, y: 120, body, extra: {} };
}

/** Every record plus the map they are about — one batch's whole input. */
interface Batch {
  refs: Reference[];
  distances: Distance[];
  links: Link[];
  marks: Mark[];
  loops: Loop[];
  assumptions: Assumption[];
  pointers: Pointer[];
  model: PlayingSet;
}

function base(): Batch {
  return {
    refs: [reference("rain", "rain"), reference("soil", "soil"), reference("mulch", "mulch", "a slow sponge\n")],
    distances: [
      { from: "mulch", to: "rain", word: "feeds", extra: {} },
      { from: "rain", to: "soil", word: "waters", extra: {} },
    ],
    links: [
      link("rain", "soil", "+"),
      link("soil", "rain", "-"),
      link("soil", "mulch", "+"),
      link("mulch", "rain", "+"),
    ],
    marks: [
      open({ type: "word", slug: "mulch" }),
      open({ type: "link", from: "soil", to: "mulch" }),
      open({ type: "wire", from: "mulch", to: "rain", word: "feeds" }),
      open({ type: "pointer", on: "mulch", form: "path", value: "notes/mulch.md" }),
      open({ type: "pointer", on: "rain", form: "at", value: "/home/k/rain.md" }),
      open({ type: "pointer", on: "soil", form: "url", value: "https://example.org/soil" }),
      open({ type: "spot", x: 40, y: 60 }),
    ],
    pointers: [
      { on: "mulch", form: "path", value: "notes/mulch.md", extra: { rank: 1 } },
      { on: "rain", form: "at", value: "/home/k/rain.md", extra: {} },
      { on: "soil", form: "url", value: "https://example.org/soil", extra: {} },
    ],
    loops: [loop("rain loop", ["rain", "soil", "mulch", "rain"])],
    assumptions: [
      claim("mulch is a slow sponge", { type: "word", slug: "mulch" }),
      claim("this link carries the mulch", { type: "link", from: "mulch", to: "rain" }),
      claim("the loop keeps the mulch", { type: "loop", slug: "rain-loop" }),
      claim("something is missing here", { type: "spot", x: 40, y: 60 }),
    ],
    model: play([...SLUGS]),
  };
}

/** The record bytes a batch writes (references are files of their own). */
function recordBytes(batch: Batch): Record<string, string> {
  return {
    "map/model.json": serializeModel(batch.model),
    "map/links.jsonl": serializeLinks(batch.links),
    "map/loops.jsonl": serializeLoops(batch.loops),
    "map/assumptions.jsonl": serializeAssumptions(batch.assumptions),
    "map/marks.jsonl": serializeMarks(batch.marks),
    "map/distances.jsonl": serializeDistances(batch.distances),
    "map/pointers.jsonl": serializePointers(batch.pointers),
  };
}

/** Read every record back and assert the next write is byte-identical. */
function reopenRecords(batch: Batch): void {
  const bytes = recordBytes(batch);
  expect(serializeModel(parseModel(bytes["map/model.json"]).model)).toBe(
    bytes["map/model.json"],
  );
  expect(serializeLinks(parseLinks(bytes["map/links.jsonl"]).links)).toBe(
    bytes["map/links.jsonl"],
  );
  expect(serializeLoops(parseLoops(bytes["map/loops.jsonl"]).loops)).toBe(
    bytes["map/loops.jsonl"],
  );
  expect(serializeAssumptions(parseAssumptions(bytes["map/assumptions.jsonl"]).assumptions)).toBe(
    bytes["map/assumptions.jsonl"],
  );
  expect(serializeMarks(parseMarks(bytes["map/marks.jsonl"]).marks)).toBe(
    bytes["map/marks.jsonl"],
  );
  const parsedDistances = parseDistances(bytes["map/distances.jsonl"]);
  expect(
    serializeDistances(parsedDistances.distances, parsedDistances.malformed),
  ).toBe(bytes["map/distances.jsonl"]);
  const parsedPointers = parsePointers(bytes["map/pointers.jsonl"]);
  expect(
    serializePointers(parsedPointers.pointers, parsedPointers.malformed),
  ).toBe(bytes["map/pointers.jsonl"]);
}

/** Every slug a record names in a STRUCTURED field (never a claim's text). */
function referencedSlugs(batch: Batch): Set<string> {
  const slugs = new Set<string>();
  for (const ref of batch.refs) if (ref.slug) slugs.add(ref.slug);
  for (const d of batch.distances) {
    slugs.add(d.from);
    slugs.add(d.to);
  }
  for (const l of batch.links) {
    slugs.add(l.from);
    slugs.add(l.to);
  }
  for (const l of batch.loops) for (const slug of l.path) slugs.add(slug);
  for (const m of batch.marks) {
    if (m.target.type === "word") slugs.add(m.target.slug);
    if (m.target.type === "wire") {
      slugs.add(m.target.from);
      slugs.add(m.target.to);
    }
    if (m.target.type === "link") {
      slugs.add(m.target.from);
      slugs.add(m.target.to);
    }
    if (m.target.type === "pointer") slugs.add(m.target.on);
  }
  for (const p of batch.pointers) slugs.add(p.on);
  for (const a of batch.assumptions) {
    if (a.target.type === "word") slugs.add(a.target.slug);
    if (a.target.type === "link") {
      slugs.add(a.target.from);
      slugs.add(a.target.to);
    }
  }
  return slugs;
}

/** The batch's structured fields name only words that are on the map. */
function expectNoDanglingSlugs(batch: Batch): void {
  const onMap = new Set(batch.refs.map((ref) => ref.slug).filter((slug): slug is string => slug !== null));
  for (const slug of referencedSlugs(batch)) {
    expect(onMap.has(slug)).toBe(true);
  }
}

/**
 * The rename batch, in `renameReference`'s documented write order: the renamed
 * reference file first (the durable thing), then distances -> links -> marks ->
 * loops -> assumptions -> pointers -> pointer-marks -> membership, then the old
 * file goes. The pointer LINES are written before their marks (Epic 5 story 1):
 * a crash must never leave an app-authored dangling mark.
 */
function renameThrough(batch: Batch, oldSlug: string, newName: string): Batch {
  // 1. the renamed file (prose byte-verbatim), old file dropped last.
  const refs = batch.refs.map((ref) =>
    ref.slug === oldSlug
      ? { ...ref, id: newName, slug: newName, name: newName }
      : ref,
  );
  // 2. distances -> 2a links -> 2b marks -> 2c loops -> 2d assumptions -> 2e set.
  const distances = rewriteEndpoints(batch.distances, oldSlug, newName);
  const links = rewriteLinkEndpoints(batch.links, oldSlug, newName);
  const marks = rewriteMarkEndpoints(batch.marks, oldSlug, newName);
  const loops = rewriteLoopPaths(batch.loops, oldSlug, newName);
  const assumptions = rewriteAssumptionTargets(batch.assumptions, oldSlug, newName);
  // 2e -> 2e2: the pointer lines first, their marks after (the crash rule).
  const pointers = rewritePointerOwners(batch.pointers, oldSlug, newName);
  const pointerMarks = rewritePointerMarkOwners(marks, oldSlug, newName);
  const model = rewriteMembership(batch.model, oldSlug, newName);
  return {
    refs,
    distances,
    links,
    marks: pointerMarks,
    loops,
    assumptions,
    pointers,
    model,
  };
}

/**
 * The remove batch, in `removeReference`'s documented write order: distances ->
 * links -> marks -> loops (remembering the loop slugs that went) -> assumptions
 * (word, its links, and those loops) -> pointers -> pointer-marks -> membership
 * -> the file goes.
 */
function removeThrough(batch: Batch, slug: string): Batch {
  const deadLoopSlugs = batch.loops
    .filter((l) => l.path.includes(slug))
    .map((l) => loopSlug(l.name));
  const distances = dropTouching(batch.distances, slug);
  const links = dropTouchingLinks(batch.links, slug);
  const marks = dropMarksTouching(batch.marks, slug);
  const loops = batch.loops.filter((l) => !l.path.includes(slug));
  const assumptions = dropLoopAssumptions(
    dropAssumptionsTouching(batch.assumptions, slug),
    deadLoopSlugs,
  );
  // 1b3 -> 1b4: the pointer lines go before their marks (the batch's order).
  const pointers = dropPointersTouching(batch.pointers, slug);
  const pointerMarks = dropPointerMarksTouching(marks, slug);
  const model = dropMembership(batch.model, slug);
  const refs = batch.refs.filter((ref) => ref.slug !== slug);
  return {
    refs,
    distances,
    links,
    marks: pointerMarks,
    loops,
    assumptions,
    pointers,
    model,
  };
}

/** The source text of one exported function in a module file. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("a rename moves all four records in one batch", () => {
  test("endpoints, paths, targets and membership all follow; text never does", () => {
    const before = base();
    const after = renameThrough(before, "mulch", "woodchip");

    // The reference file is the durable thing: renamed, prose byte-verbatim.
    expect(after.refs.map((ref) => ref.slug).sort()).toEqual([
      "rain",
      "soil",
      "woodchip",
    ]);
    expect(after.refs.find((ref) => ref.slug === "woodchip")!.body).toBe(
      "a slow sponge\n",
    );
    expect(serializeReference(after.refs[2])).toBe(
      serializeReference({ ...reference("woodchip", "woodchip", "a slow sponge\n") }),
    );

    // Distances, links, marks: every structured endpoint follows.
    expect(after.distances).toEqual([
      { from: "woodchip", to: "rain", word: "feeds", extra: {} },
      { from: "rain", to: "soil", word: "waters", extra: {} },
    ]);
    expect(after.links.map((l) => `${l.from}>${l.to}${l.sign}`).sort()).toEqual([
      "rain>soil+",
      "soil>rain-",
      "soil>woodchip+",
      "woodchip>rain+",
    ]);
    // The marks step emits untouched marks first and the app's rewritten ones
    // last; the pointer-marks step then emits the pointer marks last, in the
    // same batch and AFTER their lines.
    expect(after.marks).toEqual([
      open({ type: "pointer", on: "rain", form: "at", value: "/home/k/rain.md" }),
      open({ type: "pointer", on: "soil", form: "url", value: "https://example.org/soil" }),
      open({ type: "spot", x: 40, y: 60 }),
      open({ type: "word", slug: "woodchip" }),
      open({ type: "link", from: "soil", to: "woodchip" }),
      open({ type: "wire", from: "woodchip", to: "rain", word: "feeds" }),
      open({ type: "pointer", on: "woodchip", form: "path", value: "notes/mulch.md" }),
    ]);
    // The pointer lines follow their word; their target strings are verbatim
    // prose and are never rewritten (notes/mulch.md stays notes/mulch.md).
    expect(after.pointers).toEqual([
      { on: "woodchip", form: "path", value: "notes/mulch.md", extra: { rank: 1 } },
      { on: "rain", form: "at", value: "/home/k/rain.md", extra: {} },
      { on: "soil", form: "url", value: "https://example.org/soil", extra: {} },
    ]);
    // The ORDER guarantee at the record level: no pointer mark dangles — each
    // names a pointer line that exists in the same batch's output.
    const pointerKeys = new Set(
      after.pointers.map((p) => pointerKey(p.on, p.form, p.value)),
    );
    for (const mark of after.marks) {
      if (mark.target.type !== "pointer") continue;
      expect(
        pointerKeys.has(pointerKey(mark.target.on, mark.target.form, mark.target.value)),
      ).toBe(true);
    }

    // The loop path follows AND is rotation-canonical again ('rain' is now the
    // smallest slug, so the line rotates).
    expect(after.loops[0].path).toEqual(["rain", "soil", "woodchip", "rain"]);

    // Assumption targets follow; every claim's TEXT stays byte-identical,
    // even where it names the old word (the software never rewrites prose).
    expect(after.assumptions.map((a) => a.target)).toEqual([
      { type: "word", slug: "woodchip" },
      { type: "link", from: "woodchip", to: "rain" },
      { type: "loop", slug: "rain-loop" },
      { type: "spot", x: 40, y: 60 },
    ]);
    expect(after.assumptions.map((a) => a.text)).toEqual(before.assumptions.map((a) => a.text));
    expect(after.assumptions[0].text).toBe("mulch is a slow sponge");
    expect(after.assumptions[1].text).toBe("this link carries the mulch");

    // Membership follows and stays sorted.
    expect(after.model.words).toEqual(["rain", "soil", "woodchip"]);
    // Nothing dangles, and the rewrite reads back byte-for-byte.
    expectNoDanglingSlugs(after);
    reopenRecords(after);
  });

  test("the canonical bytes of every record after the batch", () => {
    const after = renameThrough(base(), "mulch", "woodchip");
    const bytes = recordBytes(after);

    expect(bytes["map/model.json"]).toBe(
      ['{', '  "words": [', '    "rain",', '    "soil",', '    "woodchip"', "  ]", "}", ""].join("\n"),
    );
    expect(bytes["map/loops.jsonl"]).toBe(
      '{"name":"rain loop","path":["rain","soil","woodchip","rain"]}' + "\n",
    );
    expect(bytes["map/assumptions.jsonl"]).toBe(
      [
        '{"on":"woodchip","text":"mulch is a slow sponge"}',
        '{"from":"woodchip","text":"this link carries the mulch","to":"rain"}',
        '{"loop":"rain-loop","text":"the loop keeps the mulch"}',
        '{"text":"something is missing here","x":40,"y":60}',
        "",
      ].join("\n"),
    );
    // The link lines are order-stable and sign-preserving.
    expect(bytes["map/links.jsonl"].trim().split("\n").sort()).toEqual(
      [
        '{"from":"rain","sign":"+","to":"soil"}',
        '{"from":"soil","sign":"-","to":"rain"}',
        '{"from":"soil","sign":"+","to":"woodchip"}',
        '{"from":"woodchip","sign":"+","to":"rain"}',
      ].sort(),
    );
    // The pointer lines: `on` follows the word, the target strings do not.
    expect(bytes["map/pointers.jsonl"]).toBe(
      [
        '{"on":"woodchip","path":"notes/mulch.md","rank":1}',
        '{"at":"/home/k/rain.md","on":"rain"}',
        '{"on":"soil","url":"https://example.org/soil"}',
        "",
      ].join("\n"),
    );
    // The mark lines: the pointer marks come after their pointer lines.
    expect(bytes["map/marks.jsonl"]).toBe(
      [
        '{"at":"/home/k/rain.md","kind":"open","on":"rain"}',
        '{"kind":"open","on":"soil","url":"https://example.org/soil"}',
        '{"kind":"open","x":40,"y":60}',
        '{"kind":"open","on":"woodchip"}',
        '{"from":"soil","kind":"open","to":"woodchip"}',
        '{"from":"woodchip","kind":"open","to":"rain","word":"feeds"}',
        '{"kind":"open","on":"woodchip","path":"notes/mulch.md"}',
        "",
      ].join("\n"),
    );
    // No structured field still names the old slug; only claim text may.
    const structured = [
      bytes["map/model.json"],
      bytes["map/links.jsonl"],
      bytes["map/loops.jsonl"],
    ].join("\n");
    expect(structured).not.toContain("mulch");
    const assumptionFields = parseAssumptions(bytes["map/assumptions.jsonl"])
      .assumptions.map((a) => JSON.stringify(a.target))
      .join("\n");
    expect(assumptionFields).not.toContain("mulch");
    // Pointer OWNERS and mark ADDRESSES follow the rename. A pointer's target
    // value is never interpreted, so notes/mulch.md legitimately still says
    // 'mulch' inside the woodchip line's prose-like value.
    const pointerOwners = parsePointers(bytes["map/pointers.jsonl"])
      .pointers.map((p) => p.on)
      .join("\n");
    expect(pointerOwners).not.toContain("mulch");
    expect(pointerOwners).toContain("woodchip");
    const markAddresses = parseMarks(bytes["map/marks.jsonl"])
      .marks.map((m) => {
        if (m.target.type === "pointer") return m.target.on;
        if (m.target.type === "word") return m.target.slug;
        if (m.target.type === "wire") return m.target.from + "|" + m.target.to;
        if (m.target.type === "link") return m.target.from + "|" + m.target.to;
        return "spot";
      })
      .join("\n");
    expect(markAddresses).not.toContain("mulch");
  });
});

describe("a remove moves all four records in one batch", () => {
  function withMoreLoops(): Batch {
    const batch = base();
    return {
      ...batch,
      // A second loop that never names 'soil' — it must survive untouched.
      loops: [
        ...batch.loops.map((l) => l),
        loop("mulch loop", ["mulch", "mulch"]),
      ],
      assumptions: [
        ...batch.assumptions,
        claim("soil is thin here", { type: "word", slug: "soil" }),
        claim("rain still falls", { type: "word", slug: "rain" }),
        claim("the mulch loop turns", { type: "loop", slug: "mulch-loop" }),
        claim("the link above is doubtful", { type: "link", from: "rain", to: "soil" }),
      ],
    };
  }

  test("the word, its links, its loop and their claims all die; the rest stays", () => {
    const before = withMoreLoops();
    const after = removeThrough(before, "soil");

    expect(after.refs.map((ref) => ref.slug).sort()).toEqual(["mulch", "rain"]);
    // Only the distance through the removed word goes; the other stays.
    expect(after.distances).toEqual([
      { from: "mulch", to: "rain", word: "feeds", extra: {} },
    ]);
    expect(after.links.map((l) => `${l.from}>${l.to}`).sort()).toEqual([
      "mulch>rain",
    ]);
    // The loop whose path named the word dies with it (die-with-target).
    expect(after.loops.map((l) => l.name)).toEqual(["mulch loop"]);
    // Its claims die: the word's, its link's and the dead loop's. The bare
    // spot, the unrelated word claim and the surviving loop's claim stay.
    expect(after.assumptions.map((a) => a.text)).toEqual([
      "mulch is a slow sponge",
      "this link carries the mulch",
      "something is missing here",
      "rain still falls",
      "the mulch loop turns",
    ]);
    // The removed word's pointer line and its pointer mark die (die-with-
    // target); every other reach and mark keeps its bytes.
    expect(after.pointers).toEqual([
      { on: "mulch", form: "path", value: "notes/mulch.md", extra: { rank: 1 } },
      { on: "rain", form: "at", value: "/home/k/rain.md", extra: {} },
    ]);
    expect(after.marks).toEqual([
      open({ type: "word", slug: "mulch" }),
      open({ type: "wire", from: "mulch", to: "rain", word: "feeds" }),
      open({ type: "pointer", on: "mulch", form: "path", value: "notes/mulch.md" }),
      open({ type: "pointer", on: "rain", form: "at", value: "/home/k/rain.md" }),
      open({ type: "spot", x: 40, y: 60 }),
    ]);
    // No pointer mark names a line the batch removed.
    const pointerKeys = new Set(
      after.pointers.map((p) => pointerKey(p.on, p.form, p.value)),
    );
    for (const mark of after.marks) {
      if (mark.target.type !== "pointer") continue;
      expect(
        pointerKeys.has(pointerKey(mark.target.on, mark.target.form, mark.target.value)),
      ).toBe(true);
    }
    expect(after.model.words).toEqual(["mulch", "rain"]);
    expectNoDanglingSlugs(after);
    reopenRecords(after);
  });

  test("no record names the removed word anywhere after the batch", () => {
    const after = removeThrough(withMoreLoops(), "soil");
    const bytes = recordBytes(after);
    for (const [file, text] of Object.entries(bytes)) {
      expect(`${file}: ${text}`).not.toContain("soil");
    }
    // The surviving loop's line is byte-identical to its input line.
    expect(bytes["map/loops.jsonl"]).toBe(
      '{"name":"mulch loop","path":["mulch","mulch"]}' + "\n",
    );
    // The surviving reaches are the other words' lines, byte-stable, and no
    // mark names the removed word's pointer line.
    expect(bytes["map/pointers.jsonl"]).toBe(
      [
        '{"on":"mulch","path":"notes/mulch.md","rank":1}',
        '{"at":"/home/k/rain.md","on":"rain"}',
        "",
      ].join("\n"),
    );
    expect(bytes["map/marks.jsonl"]).not.toContain("soil");
  });
});

describe("the batch's write order and crash-order comments", () => {
  const source = readFileSync(
    new URL("../src/map/patches.ts", import.meta.url),
    "utf8",
  );

  test("the module doc states the order and the crash rule", () => {
    expect(source).toContain("Write order (the crash rule)");
    expect(source).toMatch(/references -> distances -> links -> marks ->/);
    // Epic 5 story 1 grows the pointer -> pointer-marks steps between the
    // assumptions and the membership: the reach lines are written BEFORE their
    // marks (ADR-0009's tightened second amendment).
    expect(source).toMatch(
      /loops -> assumptions -> pointers -> pointer-marks -> membership -> the old file/,
    );
    expect(source).toContain("the durable thing is written first");
    expect(source).toContain("written BEFORE their marks");
    expect(source).toContain("dangling mark");
  });

  test("rename writes the file first, then each record, then drops the old file", () => {
    const body = functionBody(source, "renameReference");
    const order = [
      "writeTextFile(referencePath",
      "saveDistances(",
      "saveLinks(",
      "saveMarks(",
      "saveLoops(",
      "saveAssumptions(",
      "savePointers(",
      "saveMarks(",
      "saveModel(",
      "removeFile(referencePath",
    ];
    let last = -1;
    for (const [i, needle] of order.entries()) {
      // saveMarks appears twice: the word/link marks step and the
      // pointer-marks step, with the pointer lines between them.
      const index = body.indexOf(needle, i === 0 ? 0 : last + 1);
      expect(index).toBeGreaterThan(last);
      last = index;
    }
    // The pointer marks step consumes the pointer lines written just before.
    expect(body.indexOf("rewritePointerMarkOwners(")).toBeGreaterThan(
      body.indexOf("savePointers("),
    );
    // The crash comments ride along (they are why the order is what it is).
    expect(body.toLowerCase()).toContain("crash");
  });

  test("remove writes every record before deleting the file (no dangling line)", () => {
    const body = functionBody(source, "removeReference");
    const order = [
      "saveDistances(",
      "saveLinks(",
      "saveMarks(",
      "saveLoops(",
      "saveAssumptions(",
      "savePointers(",
      "saveMarks(",
      "saveModel(",
      "removeFile(referencePath",
    ];
    let last = -1;
    for (const [i, needle] of order.entries()) {
      const index = body.indexOf(needle, i === 0 ? 0 : last + 1);
      expect(index).toBeGreaterThan(last);
      last = index;
    }
    // The pointer lines are dropped before their marks (the batch's order).
    expect(body.indexOf("dropPointerMarksTouching(")).toBeGreaterThan(
      body.indexOf("savePointers("),
    );
    expect(body.toLowerCase()).toContain("crash");
  });
});

describe("malformed, orphan and duplicate lines surface across records", () => {
  test("every record tolerates and preserves its own malformed bytes", () => {
    const modelText = '{"words": [';
    const model = parseModel(modelText);
    expect(model.model).toBeNull();
    expect(model.malformed).toBe(modelText);
    expect(serializeModel(model.model, model.malformed)).toBe(modelText);

    const linksText = '{"from":"rain","sign":"+","to":"soil"}\n{oops\n';
    const links = parseLinks(linksText);
    expect(links.links).toHaveLength(1);
    expect(links.malformed).toEqual(["{oops"]);
    expect(serializeLinks(links.links, links.malformed)).toBe(linksText);

    const loopsText =
      '{"name":"rain loop","path":["rain","soil","rain"]}\n{not a loop\n';
    const loops = parseLoops(loopsText);
    expect(loops.loops).toHaveLength(1);
    expect(loops.malformed).toEqual(["{not a loop"]);
    expect(serializeLoops(loops.loops, loops.malformed)).toBe(loopsText);

    const assumptionsText =
      '{"on":"rain","text":"rain is heavy"}\n{not a claim\n';
    const assumptions = parseAssumptions(assumptionsText);
    expect(assumptions.assumptions).toHaveLength(1);
    expect(assumptions.malformed).toEqual(["{not a claim"]);
    expect(serializeAssumptions(assumptions.assumptions, assumptions.malformed)).toBe(
      assumptionsText,
    );

    const pointersText =
      '{"on":"rain","path":"notes/x.md"}\n{not a pointer\n';
    const pointers = parsePointers(pointersText);
    expect(pointers.pointers).toHaveLength(1);
    expect(pointers.malformed).toEqual(["{not a pointer"]);
    expect(serializePointers(pointers.pointers, pointers.malformed)).toBe(
      pointersText,
    );

    // A pointer-key mark rides the marks file with every other form.
    const marksText =
      '{"kind":"open","on":"rain","path":"notes/x.md"}\n{not a mark\n';
    const parsedMarks = parseMarks(marksText);
    expect(parsedMarks.marks).toHaveLength(1);
    expect(parsedMarks.marks[0].target.type).toBe("pointer");
    expect(parsedMarks.malformed).toEqual(["{not a mark"]);
    expect(serializeMarks(parsedMarks.marks, parsedMarks.malformed)).toBe(
      marksText,
    );
  });

  test("orphans are surfaced per record and nothing is silently repaired", () => {
    const onMap = new Set(["rain", "soil"]);
    const links = [link("rain", "soil", "+")];
    const distances: Distance[] = [{ from: "rain", to: "soil", word: "feeds", extra: {} }];
    const model = play(["rain"]);

    // A mark on a link, a wire, a word and a pointer line that are all gone.
    const marks: Mark[] = [
      open({ type: "link", from: "soil", to: "rain" }),
      open({ type: "wire", from: "rain", to: "soil", word: "gone" }),
      open({ type: "word", slug: "phantom" }),
      open({ type: "word", slug: "rain" }),
      open({ type: "pointer", on: "rain", form: "path", value: "notes/x.md" }),
      open({ type: "pointer", on: "rain", form: "path", value: "notes/gone.md" }),
    ];
    const pointerKeys = new Set([pointerKey("rain", "path", "notes/x.md")]);
    expect(
      findOrphanMarks(
        marks,
        onMap,
        new Set(distances.map((d) => `${d.from}\u0000${d.to}\u0000${d.word}`)),
        new Set(links.map((l) => linkKey(l.from, l.to))),
        pointerKeys,
      ).map((mark) => mark.target.type),
    ).toEqual(["link", "wire", "word", "pointer"]);

    // A pointer whose owner is gone is surfaced; its TARGET is never checked,
    // so an at reach that does not exist on this machine is not an orphan.
    const pointers: Pointer[] = [
      { on: "rain", form: "path", value: "notes/x.md", extra: {} },
      { on: "phantom", form: "at", value: "/nonexistent/x", extra: {} },
    ];
    expect(findOrphanPointers(pointers, onMap).map((p) => p.on)).toEqual([
      "phantom",
    ]);

    // A loop path naming a slug the map does not have stays verbatim.
    const loops = [loop("rain loop", ["rain", "phantom", "rain"])];
    const loopText = serializeLoops(loops);
    expect(loopText).toContain("phantom");
    // Rotation-canonical on the way out: 'phantom' is the smallest slug.
    expect(parseLoops(loopText).loops[0].path).toEqual(["phantom", "rain", "phantom"]);

    // Assumptions on a gone word, a gone link and a gone loop are surfaced;
    // the bare spot is its own target and never an orphan.
    const claims = [
      claim("gone word", { type: "word", slug: "phantom" }),
      claim("gone link", { type: "link", from: "soil", to: "rain" }),
      claim("gone loop", { type: "loop", slug: "phantom-loop" }),
      claim("bare spot", { type: "spot", x: 1, y: 2 }),
      claim("out of play but on the map", { type: "word", slug: "soil" }),
    ];
    expect(
      findOrphanAssumptions(
        claims,
        onMap,
        new Set(links.map((l) => linkKey(l.from, l.to))),
        new Set(loops.map((l) => loopSlug(l.name))),
      ).map((a) => a.text),
    ).toEqual(["gone word", "gone link", "gone loop"]);

    // A loop's dangling path is content, not garbage: the record survives a
    // rewrite byte-for-byte, and the same words stay out of the model.
    expect(serializeLoops(parseLoops(loopText).loops)).toBe(loopText);
    expect(model.words).toEqual(["rain"]);
  });

  test("duplicates: links/loops collapse on write, assumptions preserve and surface", () => {
    // A hand-duplicated link collapses to its last line (one per ordered pair).
    const linkDup =
      '{"from":"rain","sign":"+","to":"soil"}\n{"from":"rain","sign":"-","to":"soil"}\n';
    const parsedLinks = parseLinks(linkDup);
    expect(parsedLinks.links).toHaveLength(2);
    expect(serializeLinks(parsedLinks.links)).toBe(
      '{"from":"rain","sign":"-","to":"soil"}' + "\n",
    );

    // A hand-duplicated loop name collapses the same way (last write wins).
    const loopDup =
      '{"name":"rain loop","path":["rain","soil","rain"]}\n{"name":"rain loop","path":["rain","mulch","rain"]}\n';
    // (Each path is rotation-canonical on the way out: the last line wins.)
    expect(serializeLoops(parseLoops(loopDup).loops)).toBe(
      '{"name":"rain loop","path":["mulch","rain","mulch"]}' + "\n",
    );

    // Pointers are the other preserving family: a hand-duplicated key stays
    // two lines and is surfaced; a write never collapses it.
    const pointerLine = '{"on":"rain","path":"notes/x.md"}';
    const parsedPointers = parsePointers(pointerLine + "\n" + pointerLine + "\n");
    expect(parsedPointers.pointers).toHaveLength(2);
    expect(parsedPointers.duplicates).toHaveLength(1);
    expect(findDuplicatePointers(parsedPointers.pointers)).toHaveLength(1);
    expect(serializePointers(parsedPointers.pointers)).toBe(
      pointerLine + "\n" + pointerLine + "\n",
    );

    // A pointer-key mark is like every other mark: the read keeps a hand
    // duplicate, the write collapses to one line (last write wins).
    const pointerMark = '{"kind":"open","on":"rain","path":"notes/x.md"}';
    const parsedPointerMarks = parseMarks(
      pointerMark + "\n" + pointerMark + "\n",
    );
    expect(parsedPointerMarks.marks).toHaveLength(2);
    expect(serializeMarks(parsedPointerMarks.marks)).toBe(pointerMark + "\n");

    // Assumptions are the exception: a hand-duplicated key is PRESERVED and
    // surfaced (a hand edit is content), and the write never collapses it.
    const claimDup =
      '{"on":"rain","text":"rain is heavy"}\n{"on":"rain","text":"rain is heavy"}\n';
    const parsedClaims = parseAssumptions(claimDup);
    expect(parsedClaims.assumptions).toHaveLength(2);
    expect(parsedClaims.duplicates.map((a) => a.text)).toEqual(["rain is heavy"]);
    expect(serializeAssumptions(parsedClaims.assumptions)).toBe(claimDup);

    // The app's own add on that key rewrites the FIRST line in place, so a
    // later write holds multiplicity (no silent collapse).
    const added = addAssumption(parsedClaims.assumptions, "rain is heavy", {
      type: "word",
      slug: "rain",
    });
    expect(added).toHaveLength(2);
    expect(serializeAssumptions(added)).toBe(claimDup);
  });

  test("a missing file means empty; the first write is canonical bytes", () => {
    expect(parseModel(null).model).toBeNull();
    expect(parseLinks("").links).toEqual([]);
    expect(parseLoops("").loops).toEqual([]);
    expect(parseAssumptions("").assumptions).toEqual([]);
    expect(parseMarks("").marks).toEqual([]);
    expect(parsePointers("").pointers).toEqual([]);

    // The canonical empty JSONL is one newline; the model's absence writes
    // nothing (an explicit accept is the only thing that writes a set).
    expect(serializeLinks([])).toBe("\n");
    expect(serializeLoops([])).toBe("\n");
    expect(serializeAssumptions([])).toBe("\n");
    expect(serializeMarks([])).toBe("\n");
    expect(serializePointers([])).toBe("\n");
    expect(serializeModel(null)).toBe("");
  });

  test("the model preserves unknown keys across the rename and the remove", () => {
    const model: PlayingSet = { words: ["mulch", "rain"], extra: { note: "hand" } };
    const renamed = rewriteMembership(model, "rain", "storm");
    expect(renamed.extra).toEqual({ note: "hand" });
    expect(renamed.words).toEqual(["mulch", "storm"]);
    const removed = dropMembership(renamed, "mulch");
    expect(removed.extra).toEqual({ note: "hand" });
    expect(removed.words).toEqual(["storm"]);
    // The set is still deduped and sorted after both steps.
    expect(dedupe(renamed.words)).toEqual(renamed.words);
  });

  test("a reference's own bytes survive the batch untouched (prose is never rewritten)", () => {
    const body = "line one\nline two with tabs\t and trailing spaces   \n";
    const ref = reference("mulch", "mulch", body);
    const text = serializeReference(ref);
    const parsed = parseReference("mulch", "mulch", text);
    expect(parsed.body).toBe(body);
    expect(serializeReference(parsed)).toBe(text);
    // The rename changes name/slug only; a re-serialization keeps the body.
    const renamed = { ...parsed, id: "woodchip", slug: "woodchip", name: "woodchip" };
    expect(parseReference("woodchip", "woodchip", serializeReference(renamed)).body).toBe(body);
  });
});

/* -------------------------------------------------------------------------
 * Epic 6 story 4: the level key and the strict handoff, over the same records.
 *
 * The level is NOT a record (ADR-0018): the band is the game at runtime and
 * workspace.yml's level line is the resume hint. This suite pins the interplay
 * the per-record suites cannot: ONE write trigger (a settled crossing and a
 * deliberate jump; an open-restore never), the writes QUEUED so a slow first
 * read-modify-write holds the second's read, a hand-edited key honored on open
 * and rewritten canonically on the first crossing (every other byte kept), and
 * a pinned crossing holding the key with the camera. Through it all the seven
 * records' bytes never move: a crossing is the level file's business alone.
 * ---------------------------------------------------------------------- */

describe("the level key and the handoff interplay (Epic 6, ADR-0018)", () => {
  const WS = "/home/maps/garden";
  const YML = WS + "/workspace.yml";

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** The level line's value, or null when the key is absent. */
  function keyOf(text: string): Level | null {
    return /^\s*level\s*:/m.test(text) ? levelOfText(text) : null;
  }

  /** A workspace on disk: the level file plus real map records to watch. */
  interface Disk {
    files: Map<string, string>;
    saved: Level[];
    reads: Array<Level | null>;
    gate: Promise<void>;
    open: () => void;
  }

  function disk(level?: Level): Disk {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    return {
      files: new Map<string, string>([
        [
          YML,
          level === undefined ? workspaceYml() : withLevel(workspaceYml(), level),
        ],
        ...Object.entries(recordBytes(base())),
      ]),
      saved: [],
      reads: [],
      gate,
      open,
    };
  }

  /**
   * The handoff wired to the disk, with saveWorkspaceLevel's own body: read the
   * file NOW, rewrite its level line, write it back. The first write can be
   * slowed to prove the queue (not luck) keeps read-modify-writes in order.
   */
  function handoffOn(d: Disk, slowFirst = false) {
    let first = true;
    return createLevelHandoff(DEFAULT_LEVEL, {
      onSwitch: () => undefined,
      moveCamera: () => undefined,
      save: async (level) => {
        const text = d.files.get(YML)!;
        d.reads.push(keyOf(text));
        if (slowFirst && first) {
          first = false;
          await d.gate;
        }
        d.files.set(YML, withLevel(text, level));
        d.saved.push(level);
      },
    });
  }

  test("one trigger: a settled crossing and a deliberate jump write; a restore never", async () => {
    const d = disk();
    const handoff = handoffOn(d);
    expect(handoff.level()).toBe(DEFAULT_LEVEL);

    handoff.jump("ground");
    await handoff.idle();
    expect(d.saved).toEqual(["ground"]);
    expect(d.files.get(YML)).toBe(withLevel(workspaceYml(), "ground"));

    handoff.settle(BAND_ZOOM.concept);
    await handoff.idle();
    expect(d.saved).toEqual(["ground", "concept"]);
    expect(d.files.get(YML)).toBe(withLevel(workspaceYml(), "concept"));

    // Open-restore moves the camera into its band and writes NOTHING.
    const before = d.files.get(YML)!;
    handoff.restore("concept");
    await handoff.idle();
    expect(d.saved).toEqual(["ground", "concept"]);
    expect(d.files.get(YML)).toBe(before);
    // Every comment, the format key and the fold stay exactly as shipped.
    expect(before).toBe(withLevel(workspaceYml(), "concept"));
    expect(before.startsWith(workspaceYml())).toBe(true);
  });

  test("queued: a slow first crossing holds the second's read (no lost update)", async () => {
    const d = disk();
    const handoff = handoffOn(d, true);
    handoff.jump("ground");
    handoff.settle(BAND_ZOOM.concept);
    await sleep(0); // the first save starts and stalls on the gate
    expect(d.saved).toEqual([]);
    expect(d.reads).toEqual([null]);

    d.open();
    await handoff.idle();
    // The second read happened AFTER the first write: the queue serialized the
    // two read-modify-writes, so no stale base can reappear.
    expect(d.reads).toEqual([null, "ground"]);
    expect(d.saved).toEqual(["ground", "concept"]);
    expect(d.files.get(YML)).toBe(withLevel(workspaceYml(), "concept"));
  });

  test("a hand-edited key is honored on open and rewritten on the first crossing", async () => {
    const handEdited = [
      "# a hand-edited workspace.yml",
      'format: "attentioneer-workspace/1"',
      "shelf_x: 1200",
      'where: "garden"',
      'level: "ground"',
      "",
    ].join("\n");
    const d = disk();
    d.files.set(YML, handEdited);
    const handoff = handoffOn(d);

    // Opening: the key sets the camera into its band, writes nothing.
    handoff.restore(levelOfText(handEdited));
    await handoff.idle();
    expect(d.saved).toEqual([]);
    expect(d.files.get(YML)).toBe(handEdited);
    expect(handoff.level()).toBe("ground");

    // The first settled crossing rewrites the line canonically; the comment,
    // the format key, the fold and the unknown key keep their bytes.
    handoff.settle(BAND_ZOOM.concept);
    await handoff.idle();
    expect(d.saved).toEqual(["concept"]);
    const after = d.files.get(YML)!;
    expect(after).toBe(withLevel(handEdited, "concept"));
    expect(after).toContain("# a hand-edited workspace.yml");
    expect(after).toContain('where: "garden"');
    expect(after).toContain('level: "concept"');
    expect(after.split("\n").length).toBe(handEdited.split("\n").length);
  });

  test("the pin holds the key with the camera: a held crossing writes nothing, the release writes once", async () => {
    const d = disk();
    const handoff = handoffOn(d);
    const pin = createLevelPin();
    const settleThroughPin = (zoom: number, pinned: boolean): void => {
      const next = pin.settle(zoom, pinned);
      if (next !== null) handoff.settle(next);
    };

    // An armed gesture and a focused field both hold the crossing.
    settleThroughPin(GROUND_FROM + 0.1, shouldPinLevel("selector", "none"));
    settleThroughPin(GROUND_FROM + 0.2, shouldPinLevel("idle", "text"));
    await handoff.idle();
    expect(pin.held()).toBe(true);
    expect(d.saved).toEqual([]);
    expect(d.files.get(YML)).toBe(workspaceYml());
    expect(handoff.level()).toBe(DEFAULT_LEVEL);

    // The pin lifts: the band re-derives from the zoom the camera ended on,
    // and the ONE trigger writes exactly once.
    handoff.settle(pin.release(GROUND_FROM + 0.2));
    await handoff.idle();
    expect(d.saved).toEqual(["ground"]);
    expect(d.files.get(YML)).toBe(withLevel(workspaceYml(), "ground"));
  });

  test("a crossing leaves all seven records byte-exact (the level is not a record)", async () => {
    const bytes = recordBytes(base());
    const d = disk();
    const handoff = handoffOn(d);
    handoff.jump("ground");
    handoff.settle(BAND_ZOOM.concept);
    await handoff.idle();

    for (const [path, text] of Object.entries(bytes)) {
      expect(d.files.get(path)).toBe(text);
    }
    expect(d.files.get(YML)).toBe(withLevel(workspaceYml(), "concept"));
    // The trigger's read is the level file only: no record enters the queue.
    expect(d.reads).toEqual([null, "ground"]);
  });

  test("the handoff owns the one queue and the one save call; a restore never reaches it", () => {
    const source = readFileSync(
      new URL("../src/workspace/levelHandoff.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("createWriteQueue()");
    expect(source).toContain("queue.push(");
    expect(source.match(/deps\.save\(/g)?.length).toBe(1);
    // The restore implementation moves the camera and nothing else.
    const restoreStart = source.lastIndexOf("restore(next) {");
    expect(restoreStart).toBeGreaterThan(-1);
    const restore = source.slice(
      restoreStart,
      source.indexOf("idle: () => queue.idle()", restoreStart),
    );
    expect(restore).toContain("deps.moveCamera(next)");
    expect(restore).not.toContain("write(");
    expect(restore).not.toContain("deps.save");
  });
});
