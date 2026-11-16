import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  addAssumption,
  findOrphanAssumptions,
  parseAssumptions,
  serializeAssumptionLine,
  serializeAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "../src/map/assumptions";
import { parseDistances, serializeDistances, type Distance } from "../src/map/distances";
import {
  drawLink,
  linkKey,
  parseLinks,
  serializeLinks,
  type Link,
  type LinkSign,
} from "../src/map/links";
import {
  loopSlug,
  nameLoop,
  parseLoops,
  serializeLoops,
  type Loop,
} from "../src/map/loops";
import {
  findOrphanMarks,
  hasMark,
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
  joinWords,
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
  dropQuantitiesTouching,
  dropScenarioFolderTouching,
  rewriteQuantityEndpoints,
  rewriteScenarioFolderForWord,
  type ScenarioFolderBytes,
} from "../src/map/patches";
import {
  findQuantity,
  parseQuantities,
  quantityKey,
  quantityTargetOf,
  quantityWords,
  serializeQuantities,
  type Quantity,
} from "../src/map/quantities";
import {
  danglingPins,
  parsePins,
  pinsFromAssumptions,
  serializePins,
} from "../src/scenarios/pins";
import { parseReference, serializeReference, type Reference } from "../src/map/refs";
import {
  coveredWordSlugs,
  nameVeil,
  parseVeils,
  serializeVeils,
  veilKey,
  veilsPath,
  type PlacedWord,
  type Veil,
  type VeilBox,
} from "../src/map/veils";
import { DEFAULT_BOX } from "../src/canvas/geometry";
import { BAND_ZOOM, GROUND_FROM } from "../src/canvas/zoomBands";
import {
  authoringLive,
  createLevelPin,
  shouldPinLevel,
} from "../src/canvas/gates";
import { RECORD_FILE } from "../src/map/records";
import { workspaceYml } from "../src/lib/serialize";
import {
  DEFAULT_LEVEL,
  levelOfText,
  withLevel,
  type Level,
} from "../src/workspace/level";
import { createLevelHandoff } from "../src/workspace/levelHandoff";
import { createGhostSession } from "../src/ghost/session";
import { agentReply, withWorkspace, type Workspace } from "./ghost-harness";

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
 *
 * Epic 9 story 3 grows it by the veils' INDEPENDENCE (ADR-0023): a veil is a
 * spatial, named cover that no batch writes, no slug references and no branch
 * copies. A rename or a removal moves every record the batch owns and leaves
 * the veil's bytes untouched - the cover simply re-derives from where the
 * words now sit.
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
  /** The accepted set, or null when map/model.json does not exist. */
  model: PlayingSet | null;
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
  const model =
    batch.model === null
      ? null
      : rewriteMembership(batch.model, oldSlug, newName);
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
  const model =
    batch.model === null ? null : dropMembership(batch.model, slug);
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
    expect(after.model!.words).toEqual(["rain", "soil", "woodchip"]);
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
    expect(after.model!.words).toEqual(["mulch", "rain"]);
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

/* -------------------------------------------------------------------------
 * Epic 7 story 2: the authoring seam in the batch interplay.
 * ---------------------------------------------------------------------- */

describe("the authoring seam in the batch interplay (Epic 7 story 2)", () => {
  /** A lean batch: three words, no accepted set, no dynamics records yet. */
  function authoringBase(): Batch {
    return {
      refs: [
        reference("rain", "rain"),
        reference("soil", "soil"),
        reference("mulch", "mulch"),
      ],
      distances: [],
      links: [],
      marks: [],
      loops: [],
      assumptions: [],
      pointers: [],
      model: null,
    };
  }

  /** A batch whose RECORDS exist but whose set is gone (a hand edit, a lost file). */
  function withoutSet(): Batch {
    return { ...base(), model: null };
  }

  /** The selector's one write, as using the app does: the accepted set. */
  function accept(batch: Batch, words: readonly string[]): Batch {
    return {
      ...batch,
      model: {
        words: dedupe([...words]),
        extra: batch.model?.extra ?? {},
      },
    };
  }

  /** drawLink's batch: the guard, the durable line, then the composed join. */
  function drawThrough(
    batch: Batch,
    from: string,
    to: string,
    sign: LinkSign = "+",
  ): Batch {
    if (!authoringLive("dynamics", batch.model)) return batch;
    const links = drawLink(batch.links, from, to, sign);
    const model = joinWords(batch.model, [from, to]);
    return { ...batch, links, model };
  }

  /** createLoop's batch: the guard, then the loop line; membership untouched. */
  function loopThrough(
    batch: Batch,
    name: string,
    path: readonly string[],
  ): Batch {
    if (!authoringLive("dynamics", batch.model)) return batch;
    return { ...batch, loops: nameLoop(batch.loops, name, path) };
  }

  /** addAssumption's batch: the guard, then the claim line; membership untouched. */
  function claimThrough(
    batch: Batch,
    text: string,
    target: AssumptionTarget,
  ): Batch {
    if (!authoringLive("dynamics", batch.model)) return batch;
    return {
      ...batch,
      assumptions: addAssumption(batch.assumptions, text, target),
    };
  }

  /** One useCallback body: brace-matched for blocks, the line for expressions. */
  function callbackBody(source: string, name: string): string {
    const start = source.indexOf("const " + name + " = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const arrow = source.indexOf("=>", start);
    expect(arrow).toBeGreaterThan(start);
    let first = arrow + 2;
    while (first < source.length && /\s/.test(source[first])) first += 1;
    if (source[first] !== "{") {
      return source.slice(start, source.indexOf("\n", start));
    }
    let depth = 0;
    let end = first;
    for (let i = first; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    return source.slice(start, end);
  }

  test("no accepted set: the three writers no-op and every record keeps its bytes", () => {
    const before = authoringBase();
    const bytes = recordBytes(before);
    expect(authoringLive("dynamics", before.model)).toBe(false);
    const after = claimThrough(
      loopThrough(
        drawThrough(before, "rain", "soil", "+"),
        "rain loop",
        ["rain", "soil", "rain"],
      ),
      "mulch is the next question",
      { type: "word", slug: "mulch" },
    );
    // Each writer returns the same batch when the set is absent: the identity
    // is the no-op, and no record — the empty model file included — changes.
    expect(after).toBe(before);
    expect(recordBytes(after)).toEqual(bytes);
    expect(bytes["map/model.json"]).toBe("");
    expect(parseModel(bytes["map/model.json"]).model).toBeNull();
  });

  test("accept arms the writers; only a link's join moves membership", () => {
    const accepted = accept(authoringBase(), ["rain", "soil"]);
    expect(authoringLive("dynamics", accepted.model)).toBe(true);
    expect(recordBytes(accepted)["map/model.json"]).toBe(
      serializeModel(play(["rain", "soil"])),
    );

    // Both endpoints are already in play: the join has nothing to add, so the
    // link is ONE write (the same record comes back).
    const linked = drawThrough(accepted, "rain", "soil", "+");
    expect(linked.model).toBe(accepted.model);

    // A loop and a claim author too, and neither touches membership.
    const looped = loopThrough(linked, "rain loop", ["rain", "soil", "rain"]);
    expect(looped.model).toBe(accepted.model);
    const claimed = claimThrough(
      looped,
      "mulch is the next question",
      { type: "word", slug: "mulch" },
    );
    expect(claimed.model).toBe(accepted.model);

    const bytes = recordBytes(claimed);
    expect(bytes["map/links.jsonl"]).toBe(
      '{"from":"rain","sign":"+","to":"soil"}\n',
    );
    expect(bytes["map/loops.jsonl"]).toBe(
      serializeLoops([loop("rain loop", ["rain", "soil", "rain"])]),
    );
    expect(bytes["map/assumptions.jsonl"]).toBe(
      serializeAssumptions([
        claim("mulch is the next question", { type: "word", slug: "mulch" }),
      ]),
    );
    expect(bytes["map/model.json"]).toBe(
      serializeModel(play(["rain", "soil"])),
    );
    reopenRecords(claimed);

    // A link to a PRUNED word (mulch is out of play): the join is the batch's
    // second write, and it pulls the word back in — the honesty line.
    const rejoined = drawThrough(claimed, "rain", "mulch", "+");
    expect(rejoined.model!.words).toEqual(["mulch", "rain", "soil"]);
    expect(
      parseLinks(recordBytes(rejoined)["map/links.jsonl"]).links,
    ).toHaveLength(2);
    reopenRecords(rejoined);
  });

  test("a rename and a remove move membership: the batch's scoped exception", () => {
    let batch = accept(authoringBase(), ["rain", "soil"]);
    batch = drawThrough(batch, "rain", "soil", "+");
    batch = loopThrough(batch, "rain loop", ["rain", "soil", "rain"]);
    batch = claimThrough(batch, "soil feeds the loop", {
      type: "word",
      slug: "soil",
    });

    const renamed = renameThrough(batch, "soil", "earth");
    expect(renamed.model!.words).toEqual(["earth", "rain"]);
    expect(authoringLive("dynamics", renamed.model)).toBe(true);
    reopenRecords(renamed);
    expectNoDanglingSlugs(renamed);

    // The remove takes the word's records with it and drops its membership; the
    // remaining set is still a set, so authoring stays live.
    const removed = removeThrough(renamed, "earth");
    expect(removed.model!.words).toEqual(["rain"]);
    expect(authoringLive("dynamics", removed.model)).toBe(true);
    expect(removed.links).toEqual([]);
    expect(removed.loops).toEqual([]);
    expect(removed.assumptions).toEqual([]);
    reopenRecords(removed);
  });

  test("a batch with no set never invents one", () => {
    const noSet = withoutSet(); // records exist; map/model.json does not
    expect(authoringLive("dynamics", noSet.model)).toBe(false);

    // The rename still moves the word's records; the model write is skipped
    // (patches' "if (parsedModel.model)" guard), so the absence is preserved.
    const renamed = renameThrough(noSet, "mulch", "woodchip");
    expect(renamed.model).toBeNull();
    expect(recordBytes(renamed)["map/model.json"]).toBe("");

    const removed = removeThrough(noSet, "mulch");
    expect(removed.model).toBeNull();
    expect(recordBytes(removed)["map/model.json"]).toBe("");
  });

  test("the one write trigger: accept, the join, and the atomic batch", () => {
    const useMap = readFileSync(
      new URL("../src/canvas/useMap.ts", import.meta.url),
      "utf8",
    );
    const patches = readFileSync(
      new URL("../src/map/patches.ts", import.meta.url),
      "utf8",
    );
    const model = readFileSync(
      new URL("../src/map/model.ts", import.meta.url),
      "utf8",
    );
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const count = (source: string, needle: string) =>
      source.split(needle).length - 1;

    // map/model.json's writers, across the record layer: the selector's accept
    // and the composed join in useMap; the rename/remove atomic batches in
    // patches. Nothing else in the app writes the record.
    expect(count(useMap, "saveModel(")).toBe(2);
    expect(count(patches, "saveModel(")).toBe(2);
    expect(count(app, "saveModel(")).toBe(0);
    expect(count(app, "acceptPlayingSet(")).toBe(1);
    for (const name of ["joinToPlay", "acceptPlayingSet"]) {
      expect(callbackBody(useMap, name)).toContain("saveModel(");
    }
    for (const name of ["renameReference", "removeReference"]) {
      expect(functionBody(patches, name)).toContain("saveModel(");
    }
    // Both patches skip the write when no set exists: a batch never invents one.
    expect(count(patches, "if (parsedModel.model)")).toBe(2);
    // The selector's moves never reach a write; the accept is the one.
    for (const name of [
      "openSelector",
      "toggleSelectorWord",
      "selectAllSelectorWords",
      "handleLasso",
      "toggleLasso",
      "closeSelector",
    ]) {
      const body = callbackBody(app, name);
      expect(body).not.toContain("acceptPlayingSet");
      expect(body).not.toContain("saveModel");
    }
    expect(callbackBody(app, "acceptSelector")).toContain(
      "acceptPlayingSet(",
    );
    // The definition itself is the only other mention.
    expect(count(model, "export async function saveModel(")).toBe(1);
  });
});

/* -------------------------------------------------------------------------
 * Epic 8 story 5: the scenario and quantity steps in the batch interplay.
 *
 * The quantities record and the BRANCH step reach the same words in ONE batch,
 * at the family position the module doc states: quantities AFTER assumptions
 * and BEFORE pointers, and the branch fan-out AFTER membership and BEFORE the
 * old file. The real batch crosses the Tauri fs bridge, so this suite applies
 * the SAME pure steps in the SAME documented order and asserts the bytes — and
 * pins the two rules the per-record suites cannot show together:
 *
 *   - a quantity line follows its word's address and never its number (the
 *     amount and the absent amount ride along untouched);
 *   - a pin's TARGET follows a rename (so an app rename is never read as a
 *     dangle), while the pin's TEXT never does (a rename changes an address,
 *     never a claim); a removed target's lines and pins die everywhere, and a
 *     folder the step never names keeps its exact, hand-written bytes.
 * ---------------------------------------------------------------------- */

describe("the scenario and quantity steps in the batch interplay (Epic 8 story 5)", () => {
  function stock(on: string, amount: number | null = null): Quantity {
    return { type: "stock", on, amount, extra: {} };
  }

  function flow(from: string, to: string, amount: number | null = null): Quantity {
    return { type: "flow", from, to, amount, extra: {} };
  }

  /** The committed model's quantities: the epic check's corrected fixture. */
  function committedQuantities(): Quantity[] {
    return [
      stock("soil", 4),
      flow("soil", "plant", 3),
      flow("soil", "air", 3),
      flow("mulch", "soil", 2),
      flow("rain", "soil"),
    ];
  }

  /**
   * The branch's folder, made the way createScenario makes it: the committed
   * copies (byte-faithful), the pins as the committed claims stood, and the
   * what-if's one edit (mulch->soil 2 -> 0).
   */
  function branchFolder(): ScenarioFolderBytes {
    return {
      model: serializeModel(play(["air", "mulch", "plant", "rain", "soil"])),
      // No link was ever drawn: the absent record copies as absent.
      links: null,
      quantities: serializeQuantities([
        stock("soil", 4),
        flow("soil", "plant", 3),
        flow("soil", "air", 3),
        flow("mulch", "soil", 0),
        flow("rain", "soil"),
      ]),
      pins: serializePins(pinsFromAssumptions(base().assumptions)),
    };
  }

  /** A second folder that names NONE of the renamed words, in hand bytes. */
  function untouchedFolder(): ScenarioFolderBytes {
    return {
      model: '{ "words": [ "plant", "rain", "soil" ] }',
      links: '{ "from": "rain", "sign": "+", "to": "soil" }',
      quantities: '{ "amount": 7.0, "on": "plant" }',
      pins: '{ "on": "plant", "text": "kept" }',
    };
  }

  interface VariantBatch {
    batch: Batch;
    quantities: Quantity[];
    folders: Record<string, ScenarioFolderBytes>;
  }

  function variantBase(): VariantBatch {
    return {
      batch: base(),
      quantities: committedQuantities(),
      folders: {
        "evening-walk": branchFolder(),
        "morning-walk": untouchedFolder(),
      },
    };
  }

  /**
   * The rename batch, in renameReference's documented order: the committed
   * records through the batch's steps, the quantities step AFTER assumptions
   * and BEFORE pointers, and the branch fan-out AFTER membership.
   */
  function renameVariant(
    variant: VariantBatch,
    oldSlug: string,
    newSlug: string,
  ): VariantBatch {
    const renamed = renameThrough(variant.batch, oldSlug, newSlug);
    const quantities = rewriteQuantityEndpoints(
      variant.quantities,
      oldSlug,
      newSlug,
    );
    const folders: Record<string, ScenarioFolderBytes> = {};
    for (const [slug, folder] of Object.entries(variant.folders)) {
      folders[slug] = rewriteScenarioFolderForWord(folder, oldSlug, newSlug);
    }
    return { batch: renamed, quantities, folders };
  }

  /** The remove batch, in removeReference's documented order. */
  function removeVariant(variant: VariantBatch, slug: string): VariantBatch {
    const removed = removeThrough(variant.batch, slug);
    const quantities = dropQuantitiesTouching(variant.quantities, slug);
    const folders: Record<string, ScenarioFolderBytes> = {};
    for (const [name, folder] of Object.entries(variant.folders)) {
      folders[name] = dropScenarioFolderTouching(folder, slug);
    }
    return { batch: removed, quantities, folders };
  }

  function folderQuantities(folder: ScenarioFolderBytes): Quantity[] {
    return parseQuantities(folder.quantities).quantities;
  }

  function folderPins(folder: ScenarioFolderBytes) {
    return parsePins(folder.pins).pins;
  }

  test("the committed quantities follow the rename; the numbers never do", () => {
    const after = renameVariant(variantBase(), "mulch", "woodchip");
    expect(after.quantities.map((quantity) => quantityKey(quantity))).toEqual([
      quantityKey(stock("soil", 4)),
      quantityKey(flow("soil", "plant", 3)),
      quantityKey(flow("soil", "air", 3)),
      quantityKey(flow("woodchip", "soil", 2)),
      quantityKey(flow("rain", "soil")),
    ]);
    // The authored number and the ABSENT amount both ride along untouched.
    expect(
      findQuantity(after.quantities, {
        type: "flow",
        from: "woodchip",
        to: "soil",
      })?.quantity.amount,
    ).toBe(2);
    expect(
      findQuantity(after.quantities, {
        type: "flow",
        from: "rain",
        to: "soil",
      })?.quantity.amount,
    ).toBeNull();
  });

  test("the branch's whole folder follows the same step in the same pass", () => {
    const after = renameVariant(variantBase(), "mulch", "woodchip");
    const folder = after.folders["evening-walk"];
    expect(parseModel(folder.model).model?.words).toEqual([
      "air",
      "plant",
      "rain",
      "soil",
      "woodchip",
    ]);
    // Absence stays absent: the fan-out never invents a links file.
    expect(folder.links).toBeNull();
    const quantities = folderQuantities(folder);
    // The what-if's 0 is the branch's own number, and the rename keeps it.
    expect(
      findQuantity(quantities, {
        type: "flow",
        from: "woodchip",
        to: "soil",
      })?.quantity.amount,
    ).toBe(0);
    expect(
      findQuantity(quantities, {
        type: "flow",
        from: "rain",
        to: "soil",
      })?.quantity.amount,
    ).toBeNull();
    // The re-serialized folder reads back byte-for-byte.
    expect(serializePins(folderPins(folder))).toBe(folder.pins);
    expect(serializeQuantities(quantities)).toBe(folder.quantities);
  });

  test("the pins' rename rewrite: the ADDRESS follows, the CLAIM never does", () => {
    const after = renameVariant(variantBase(), "mulch", "woodchip");
    const pins = folderPins(after.folders["evening-walk"]);
    expect(pins.map((pin) => pin.target)).toEqual([
      { type: "word", slug: "woodchip" },
      { type: "link", from: "woodchip", to: "rain" },
      { type: "loop", slug: "rain-loop" },
      { type: "spot", x: 40, y: 60 },
    ]);
    // The prose keeps the old word: the software never rewrites a claim.
    expect(pins.map((pin) => pin.text)).toEqual([
      "mulch is a slow sponge",
      "this link carries the mulch",
      "the loop keeps the mulch",
      "something is missing here",
    ]);
  });

  test("the branch's pins are the committed claims, re-addressed — no dangle", () => {
    const after = renameVariant(variantBase(), "mulch", "woodchip");
    const pins = folderPins(after.folders["evening-walk"]);
    const committed = after.batch.assumptions;
    // All-or-none pinning: the branch's pins are exactly the committed claims
    // (same order, same texts) after the same rewrite.
    expect(pins).toEqual(pinsFromAssumptions(committed));
    // An app rename is an ADDRESS change, never a dangle.
    expect(danglingPins(pins, committed)).toEqual([]);
  });

  test("a folder the rename never names keeps its exact, hand-written bytes", () => {
    const before = variantBase();
    const after = renameVariant(before, "mulch", "woodchip");
    // The untouched step returns the SAME object: the applier writes nothing,
    // so no canonicalization repair reaches a branch nothing named.
    expect(after.folders["morning-walk"]).toBe(before.folders["morning-walk"]);
    const folder = after.folders["morning-walk"];
    expect(folder.model).toContain("{ ");
    expect(folder.quantities).toBe('{ "amount": 7.0, "on": "plant" }');
  });

  test("the quantities and the branch agree after the batch (the what-if aside)", () => {
    const after = renameVariant(variantBase(), "mulch", "woodchip");
    const branch = folderQuantities(after.folders["evening-walk"]);
    for (const quantity of after.quantities) {
      const target = quantityTargetOf(quantity);
      const found = findQuantity(branch, target);
      expect(found).not.toBeNull();
      const own =
        target.type === "flow" &&
        target.from === "woodchip" &&
        target.to === "soil"
          ? 0
          : quantity.amount;
      expect(found?.quantity.amount).toBe(own);
    }
  });

  test("the remove: the touching quantity lines and pins die everywhere", () => {
    const before = variantBase();
    const after = removeVariant(before, "mulch");
    // The committed quantities: the mulch->soil line goes; the rest stay in
    // file order with their numbers.
    expect(after.quantities).toEqual([
      stock("soil", 4),
      flow("soil", "plant", 3),
      flow("soil", "air", 3),
      flow("rain", "soil"),
    ]);
    const folder = after.folders["evening-walk"];
    expect(parseModel(folder.model).model?.words).not.toContain("mulch");
    expect(
      folderQuantities(folder).some((quantity) =>
        quantityWords(quantity).includes("mulch"),
      ),
    ).toBe(false);
    expect(
      folderPins(folder).some((pin) => pinTouches(pin, "mulch")),
    ).toBe(false);
    // The loop and the bare spot outlive the words around them.
    expect(folderPins(folder).map((pin) => pin.target.type)).toEqual([
      "loop",
      "spot",
    ]);
    // A folder nothing named is byte-identical (no repair, no write).
    expect(after.folders["morning-walk"]).toBe(before.folders["morning-walk"]);
  });

  test("after the remove, no structured field names the removed word", () => {
    const after = removeVariant(variantBase(), "mulch");
    const bytes: Record<string, string> = {
      ...recordBytes(after.batch),
      "map/quantities.jsonl": serializeQuantities(after.quantities),
    };
    for (const [path, text] of Object.entries(bytes)) {
      expect(path + ": " + text).not.toContain("mulch");
    }
    const folder = after.folders["evening-walk"];
    expect(folder.model).not.toContain("mulch");
    expect(folder.quantities).not.toContain("mulch");
    // A pin's TARGET names no removed word; its PROSE may still say it — the
    // software never rewrites a claim's text (the surviving loop claim says so).
    for (const pin of folderPins(folder)) {
      expect(JSON.stringify(pin.target)).not.toContain("mulch");
    }
    expect(folder.pins).toContain("the loop keeps the mulch");
  });

  test("the batch's write order: quantities before pointers, fan-out after membership", () => {
    const source = readFileSync(
      new URL("../src/map/patches.ts", import.meta.url),
      "utf8",
    );
    const rename = functionBody(source, "renameReference");
    expect(rename.indexOf("saveAssumptions(")).toBeLessThan(
      rename.indexOf("saveQuantities("),
    );
    expect(rename.indexOf("saveQuantities(")).toBeLessThan(
      rename.indexOf("savePointers("),
    );
    expect(rename.indexOf("applyScenarioStep(")).toBeGreaterThan(
      rename.indexOf("saveModel("),
    );
    expect(rename.indexOf("applyScenarioStep(")).toBeLessThan(
      rename.indexOf("removeFile(referencePath("),
    );
    expect(rename).toContain("rewriteScenarioFolderForWord(");

    const remove = functionBody(source, "removeReference");
    expect(remove.indexOf("saveAssumptions(")).toBeLessThan(
      remove.indexOf("saveQuantities("),
    );
    expect(remove.indexOf("saveQuantities(")).toBeLessThan(
      remove.indexOf("savePointers("),
    );
    expect(remove.indexOf("applyScenarioStep(")).toBeGreaterThan(
      remove.indexOf("saveModel("),
    );
    expect(remove.indexOf("applyScenarioStep(")).toBeLessThan(
      remove.indexOf("removeFile(referencePath("),
    );
    expect(remove).toContain("dropScenarioFolderTouching(");

    // Inside one folder: the set, then the links, then the quantities, then the
    // pins (the folder's family order).
    const apply = functionBody(source, "applyScenarioStep");
    let last = -1;
    for (const needle of [
      "writeChangedBytes(modelPath(dir)",
      "writeChangedBytes(linksPath(dir)",
      "writeChangedBytes(quantitiesPath(dir)",
      "writeChangedBytes(pinsPath(dir)",
    ]) {
      const at = apply.indexOf(needle);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  test("the pins' rewrite is the pins module's own pure step (no second rule)", () => {
    const source = readFileSync(
      new URL("../src/map/patches.ts", import.meta.url),
      "utf8",
    );
    const step = source.slice(
      source.indexOf("export function rewriteScenarioFolderForWord("),
      source.indexOf("\n}", source.indexOf("export function rewriteScenarioFolderForWord(")),
    );
    expect(step).toContain("rewritePinWordTargets(pins");
    expect(step).toContain("rewriteQuantityEndpoints(quantities");
    expect(step).toContain("rewriteMembership(model");
    expect(step).toContain("stepPinBytes(");
    expect(step).toContain("stepQuantityBytes(");
    // No hand-written target or amount arithmetic: the record modules own it.
    expect(step).not.toContain("pin.target =");
    expect(step).not.toContain("quantity.amount =");
  });
});

/** Does a pin name the word (its own word target, or a link endpoint)? */
function pinTouches(
  pin: { target: { type: string; slug?: string; from?: string; to?: string } },
  slug: string,
): boolean {
  if (pin.target.type === "word") return pin.target.slug === slug;
  if (pin.target.type === "link") {
    return pin.target.from === slug || pin.target.to === slug;
  }
  return false;
}

/* -------------------------------------------------------------------------
 * 12. The veils' independence in the batch interplay (Epic 9 story 3).
 * ---------------------------------------------------------------------- */

/** The base batch's words SPREAD OUT, so a rectangle can select two of them. */
function spreadBatch(): Batch {
  const batch = base();
  const xs: Record<string, number> = { mulch: 100, rain: 300, soil: 500 };
  return {
    ...batch,
    refs: batch.refs.map((ref) => ({
      ...ref,
      x: ref.slug === null ? ref.x : xs[ref.slug],
      y: 120,
    })),
  };
}

/** The veils in play: ONE named cover over the first two words' places. */
function veilsOf(): Veil[] {
  const box: VeilBox = { x: 80, y: 80, w: 300, h: 120 };
  return nameVeil([], "the wet corner", box, "not settled yet");
}

/** The batch's words as the cover's region test needs them (the default box). */
function placedWords(batch: Batch): PlacedWord[] {
  return batch.refs
    .filter((ref): ref is Reference & { slug: string } => ref.slug !== null)
    .map((ref) => ({
      slug: ref.slug,
      pos: { x: ref.x, y: ref.y },
      box: { ...DEFAULT_BOX },
    }));
}

/** The words this batch's veils cover, sorted (the render-time reading only). */
function coveredWords(batch: Batch, veils: readonly Veil[]): string[] {
  return [...coveredWordSlugs(veils, placedWords(batch))].sort();
}

/** One app callback's source, from its declaration to its closing line. */
function callbackBody(text: string, name: string): string {
  const start = text.indexOf("const " + name + " = useCallback(");
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("\n  );", start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("a rename moves every record and never touches a veil", () => {
  test("the veil's bytes are the batch's untouched side; the cover re-derives", () => {
    const before = spreadBatch();
    const veils = veilsOf();
    const veilBytes = serializeVeils(veils);
    // The veil covers mulch and rain; soil is outside the box.
    expect(coveredWords(before, veils)).toEqual(["mulch", "rain"]);

    const after = renameThrough(before, "mulch", "woodchip");

    // The batch moved its own records (the file the rename is about).
    expect(after.refs.map((ref) => ref.slug).sort()).toEqual([
      "rain",
      "soil",
      "woodchip",
    ]);
    // The veil is not one of the batch's records: no veil path in its bytes.
    expect(Object.keys(recordBytes(after))).not.toContain("map/veils.jsonl");
    // And the veil itself is byte-identical after the batch.
    expect(serializeVeils(veils)).toBe(veilBytes);
    expect(serializeVeils(parseVeils(veilBytes).veils)).toBe(veilBytes);
    // The cover follows the WORD, not its name: at the same place, the renamed
    // word is still covered - nothing in the veil named it.
    expect(coveredWords(after, veils)).toEqual(["rain", "woodchip"]);
    // The marked word's mark followed the rename (the batch's job); the veil
    // never moved it.
    expect(
      hasMark(after.marks, "open", { type: "word", slug: "woodchip" }),
    ).toBe(true);
    // A veil is addressed by its own natural key, never by a word slug.
    expect(veilKey(veils[0])).toBe("the-wet-corner");
    expect(veilKey(veils[0])).not.toContain("mulch");
  });
});

describe("a remove drops its records and leaves a veil alone", () => {
  test("the cover shrinks to the words that remain; the veil's line stands", () => {
    const before = spreadBatch();
    const veils = veilsOf();
    const veilBytes = serializeVeils(veils);
    expect(coveredWords(before, veils)).toEqual(["mulch", "rain"]);

    const after = removeThrough(before, "rain");

    // The word is gone from the records the batch owns ...
    expect(after.refs.map((ref) => ref.slug).sort()).toEqual(["mulch", "soil"]);
    expect(
      after.marks.some(
        (mark) => mark.target.type === "word" && mark.target.slug === "rain",
      ),
    ).toBe(false);
    // ... and the veil is untouched: it referenced nothing, so nothing died
    // with the word, and the cover now reads only the surviving word.
    expect(serializeVeils(veils)).toBe(veilBytes);
    expect(coveredWords(after, veils)).toEqual(["mulch"]);
    // No orphan machinery exists for a veil: it names no slug, ever.
    expect(veilBytes).not.toContain("mulch");
    expect(veilBytes).not.toContain("rain");
  });
});

describe("the veil writer is its own: no batch, no rename, no remove", () => {
  test("the atomic batches have no veil writer (source-scanned)", () => {
    const patches = readFileSync(
      new URL("../src/map/patches.ts", import.meta.url),
      "utf8",
    );
    expect(patches.toLowerCase()).not.toContain("veil");
    // The two batches that reach records with slugs in them name no veil.
    const renameBody = functionBody(patches, "renameReference");
    const removeBody = functionBody(patches, "removeReference");
    for (const body of [renameBody, removeBody]) {
      expect(body.toLowerCase()).not.toContain("veil");
      expect(body).not.toContain("saveVeils");
      expect(body).not.toContain("veilsPath");
    }
  });

  test("the app's rename and remove reload the map; they never write a veil", () => {
    const map = readFileSync(
      new URL("../src/canvas/useMap.ts", import.meta.url),
      "utf8",
    );
    for (const name of ["rename", "remove"]) {
      const body = callbackBody(map, name);
      expect({ name, veil: body.toLowerCase().includes("veil") }).toEqual({
        name,
        veil: false,
      });
      expect(body).not.toContain("persistVeils");
    }
    // The veil writer has exactly three call sites: coin, rename, retire.
    expect((map.match(/persistVeils\(/g) ?? []).length).toBe(3);
    for (const name of ["createVeil", "renameVeil", "removeVeil"]) {
      expect(callbackBody(map, name)).toContain("persistVeils(");
    }
    // A veil is a committed-model record: its path is map/, never a branch's.
    expect(veilsPath("/maps/garden")).toBe("/maps/garden/map/veils.jsonl");
    expect(Object.keys(RECORD_FILE)).not.toContain("veils");
    const records = readFileSync(
      new URL("../src/map/records.ts", import.meta.url),
      "utf8",
    );
    expect(records).toContain("map/veils.jsonl");
    expect(records).toContain("never copied into a branch");
  });
});

/* -------------------------------------------------------------------------
 * 13. The ghost's accepted claim is an ordinary assumption (Epic 10 story 4).
 *
 * The cross-record question the ghost suite cannot answer alone: once accepted,
 * is the ghost's line a claim like any other? The accept APPENDS exactly one
 * canonical line (a hand-formatted base keeps every byte), and the ordinary
 * rename/remove batch then carries it like the claims the person authored
 * directly - its target follows the word, its text is never rewritten, and a
 * removal takes it with its word.
 * ---------------------------------------------------------------------- */

describe("the ghost's accepted claim is an ordinary assumption (Epic 10 story 4)", () => {
  const GHOST_CONTEXT = { level: "dynamics" as const, scenario: null };
  const GHOST_TEXT = "rain follows the soil's temperature";

  /** File and accept one add-assumption ghost; return its appended line. */
  async function acceptGhost(scratch: Workspace): Promise<string> {
    const session = createGhostSession({
      workspacePath: scratch.path,
      fs: scratch.fs,
    });
    const filed = await session.intake(
      agentReply({
        target: { kind: "word", slug: "rain" },
        params: { text: GHOST_TEXT },
      }),
      GHOST_CONTEXT,
    );
    expect(filed.ok).toBe(true);
    if (!filed.envelope) throw new Error("expected an envelope");
    const accepted = await session.accept(filed.envelope.id, GHOST_CONTEXT);
    expect(accepted.outcome).toBe("applied");
    return filed.envelope.steps[0].line;
  }

  test("accept appends exactly one canonical line and rewrites nothing", async () => {
    await withWorkspace(async (scratch) => {
      // A HAND-FORMATTED base: the append must keep every byte.
      const base = '{ "on": "soil", "text": "the soil holds water" }\n';
      scratch.write("map/assumptions.jsonl", base);
      const line = await acceptGhost(scratch);
      const after = scratch.read("map/assumptions.jsonl") ?? "";
      expect(after).toBe(base + line + "\n");

      // The family's own reader reads it; its writer reproduces the line.
      const parsed = parseAssumptions(after);
      expect(parsed.malformed).toEqual([]);
      expect(parsed.assumptions.map((assumption) => assumption.text)).toEqual([
        "the soil holds water",
        GHOST_TEXT,
      ]);
      expect(serializeAssumptionLine(parsed.assumptions[1])).toBe(line);
      expect(serializeAssumptions(parsed.assumptions)).toBe(
        '{"on":"soil","text":"the soil holds water"}\n' + line + "\n",
      );
    });
  });

  test("a rename carries the accepted claim's target and never its text", async () => {
    await withWorkspace(async (scratch) => {
      const line = await acceptGhost(scratch);
      const accepted = parseAssumptions(
        scratch.read("map/assumptions.jsonl") ?? "",
      ).assumptions[1];
      expect(serializeAssumptionLine(accepted)).toBe(line);

      // The accepted line joins the batch document exactly like a direct
      // author's claim: the base bytes plus the one canonical line.
      const batch: Batch = {
        ...base(),
        assumptions: [...base().assumptions, accepted],
      };
      expect(serializeAssumptions(batch.assumptions)).toBe(
        serializeAssumptions(base().assumptions) + line + "\n",
      );

      const renamed = renameThrough(batch, "rain", "rainfall");
      const carried = renamed.assumptions.find(
        (assumption) => assumption.text === GHOST_TEXT,
      );
      expect(carried).toBeDefined();
      expect(carried!.target).toEqual({ type: "word", slug: "rainfall" });
      // Every claim's TEXT is byte-identical: a rename rewrites addresses only.
      expect(renamed.assumptions.map((assumption) => assumption.text)).toEqual(
        batch.assumptions.map((assumption) => assumption.text),
      );
      const bytes = recordBytes(renamed)["map/assumptions.jsonl"];
      expect(bytes).toContain(
        '{"on":"rainfall","text":"rain follows the soil\'s temperature"}',
      );
      expect(bytes).not.toContain(
        '"on":"rain","text":"rain follows the soil',
      );
      expectNoDanglingSlugs(renamed);
      reopenRecords(renamed);
    });
  });

  test("a removal takes the accepted claim with its word; the rest stays", async () => {
    await withWorkspace(async (scratch) => {
      await acceptGhost(scratch);
      const accepted = parseAssumptions(
        scratch.read("map/assumptions.jsonl") ?? "",
      ).assumptions[1];
      const batch: Batch = {
        ...base(),
        assumptions: [...base().assumptions, accepted],
      };

      const removed = removeThrough(batch, "rain");
      expect(removed.assumptions.map((assumption) => assumption.text)).toEqual([
        "mulch is a slow sponge",
        "something is missing here",
      ]);
      expect(
        removed.assumptions.some((assumption) => assumption.text === GHOST_TEXT),
      ).toBe(false);
      // The family's bytes: the removed word's claim is gone, the surviving
      // claims keep their exact canonical lines.
      const bytes = recordBytes(removed)["map/assumptions.jsonl"];
      expect(bytes).not.toContain(GHOST_TEXT);
      expect(bytes).toBe(
        '{"on":"mulch","text":"mulch is a slow sponge"}\n' +
          '{"text":"something is missing here","x":40,"y":60}\n',
      );
      expectNoDanglingSlugs(removed);
      reopenRecords(removed);
    });
  });
});
