import { describe, expect, test } from "bun:test";
import {
  addAssumption,
  findAssumptions,
  parseAssumptions,
  reviseAssumption,
  serializeAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "../src/map/assumptions";
import {
  parseDistances,
  serializeDistances,
  type Distance,
} from "../src/map/distances";
import {
  drawLink,
  flipLink,
  parseLinks,
  removeLink,
  serializeLinks,
  type Link,
} from "../src/map/links";
import { readLoop, type LoopRead } from "../src/map/loopRead";
import {
  nameLoop,
  parseLoops,
  serializeLoops,
  type Loop,
} from "../src/map/loops";
import {
  parseMarks,
  serializeMarks,
  withMark,
  withoutMark,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import {
  parseModel,
  prefilledSelection,
  serializeModel,
  withoutWord,
  type PlayingSet,
} from "../src/map/model";
import {
  dropLinkAssumptions,
  rewriteAssumptionTargets,
  rewriteEndpoints,
  rewriteLinkEndpoints,
  rewriteLoopPaths,
  rewriteMarkEndpoints,
  rewriteMembership,
} from "../src/map/patches";
import {
  parseReference,
  serializeReference,
  type Reference,
} from "../src/map/refs";
import { parseYamlFields, workspaceYml } from "../src/lib/serialize";
import {
  levelOfText,
  withLevel,
  type Level,
} from "../src/workspace/level";

/**
 * Epic 4's plain-language check, automated at the record layer (story 5).
 *
 * The human half — the feel of the selector, the sign choice, the route click,
 * the walk display, the native quit/reopen — is not asserted here. This file
 * walks the same journey through the pure modules the app uses and through the
 * files' bytes only:
 *
 *   enter the dynamics game and say what is played with (select-all, prune,
 *   accept -> model.json); draw signed links A->B "+" and B->A "-"; name a
 *   three-cycle loop; READ it and get the verdict only at completeness; mark a
 *   link's sign (partial read, gap named, no verdict); withdraw the mark (the
 *   verdict returns); flip an unmarked sign (the verdict flips); state an
 *   assumption, add a rival, revise one in place; remove a link (the missing
 *   link is named and its claims die); rename a word (every record follows
 *   byte-exactly); quit/reopen (all four records round-trip together).
 *
 * The negative space is the point: no record ever stores a verdict, and no
 * record counts anything. The reading is derived from the files every time —
 * which is exactly what "no label stored" means at the record layer.
 */

const REFS = "map/references/";

type Files = Record<string, string>;

interface MalformedLines {
  model: string | null;
  links: string[];
  loops: string[];
  assumptions: string[];
  marks: string[];
}

interface Journey {
  refs: Reference[];
  level: Level;
  model: PlayingSet | null;
  distances: Distance[];
  links: Link[];
  loops: Loop[];
  marks: Mark[];
  assumptions: Assumption[];
  /** Hand-edited bytes the app cannot read — carried verbatim, never dropped. */
  malformed: MalformedLines;
}

const word = (slug: string): MarkTarget => ({ type: "word", slug });
const linkMark = (from: string, to: string): MarkTarget => ({ type: "link", from, to });

function reference(
  name: string,
  slug: string,
  x: number,
  y: number,
  body = "",
): Reference {
  return { id: slug, slug, name, x, y, body, extra: {} };
}

function play(words: string[]): PlayingSet {
  return { words, extra: {} };
}

/** One canonical JSONL document from already-canonical lines. */
function lines(...entries: string[]): string {
  return entries.join("\n") + "\n";
}

function modelJson(words: string[]): string {
  return (
    '{\n  "words": [\n' +
    words.map((word) => '    "' + word + '"').join(",\n") +
    '\n  ]\n}\n'
  );
}

function linkLine(from: string, sign: string, to: string): string {
  return '{"from":"' + from + '","sign":"' + sign + '","to":"' + to + '"}';
}

/** Write the journey's memory to the workspace's files (the app's writes). */
function write(journey: Journey): Files {
  const files: Files = {
    "workspace.yml": withLevel(workspaceYml(), journey.level),
    "map/model.json": serializeModel(journey.model, journey.malformed.model),
    "map/links.jsonl": serializeLinks(journey.links, journey.malformed.links),
    "map/loops.jsonl": serializeLoops(journey.loops, journey.malformed.loops),
    "map/assumptions.jsonl": serializeAssumptions(
      journey.assumptions,
      journey.malformed.assumptions,
    ),
    "map/marks.jsonl": serializeMarks(journey.marks, journey.malformed.marks),
    "map/distances.jsonl": serializeDistances(journey.distances),
  };
  for (const ref of journey.refs) {
    if (ref.slug === null) throw new Error("an uncoined reference cannot be written");
    files[REFS + ref.slug + ".md"] = serializeReference(ref);
  }
  return files;
}

/**
 * Quit and reopen: read every file back and confirm the app's next write is
 * the same bytes. The epic check's "the model and its readings come back
 * exactly as left", asserted at the record level.
 */
function reopen(files: Files): Journey {
  const level = levelOfText(files["workspace.yml"]);
  // The level key is the sole source and re-writing it changes no byte.
  expect(withLevel(files["workspace.yml"], level)).toBe(files["workspace.yml"]);

  const refs: Reference[] = [];
  const paths = Object.keys(files)
    .filter((path) => path.indexOf(REFS) === 0 && path.endsWith(".md"))
    .sort();
  for (const path of paths) {
    const text = files[path];
    const slug = path.slice(REFS.length, -3);
    const parsed = parseReference(slug, slug, text);
    expect(serializeReference(parsed)).toBe(text);
    refs.push(parsed);
  }

  const modelText = files["map/model.json"];
  const parsedModel = parseModel(modelText);
  expect(serializeModel(parsedModel.model, parsedModel.malformed)).toBe(modelText);

  const parsedLinks = parseLinks(files["map/links.jsonl"]);
  expect(serializeLinks(parsedLinks.links, parsedLinks.malformed)).toBe(
    files["map/links.jsonl"],
  );
  const parsedLoops = parseLoops(files["map/loops.jsonl"]);
  expect(serializeLoops(parsedLoops.loops, parsedLoops.malformed)).toBe(
    files["map/loops.jsonl"],
  );
  const parsedAssumptions = parseAssumptions(files["map/assumptions.jsonl"]);
  expect(
    serializeAssumptions(
      parsedAssumptions.assumptions,
      parsedAssumptions.malformed,
    ),
  ).toBe(files["map/assumptions.jsonl"]);
  const parsedMarks = parseMarks(files["map/marks.jsonl"]);
  expect(serializeMarks(parsedMarks.marks, parsedMarks.malformed)).toBe(
    files["map/marks.jsonl"],
  );
  const parsedDistances = parseDistances(files["map/distances.jsonl"]);
  expect(serializeDistances(parsedDistances.distances, parsedDistances.malformed)).toBe(
    files["map/distances.jsonl"],
  );

  return {
    refs,
    level,
    model: parsedModel.model,
    distances: parsedDistances.distances,
    links: parsedLinks.links,
    loops: parsedLoops.loops,
    marks: parsedMarks.marks,
    assumptions: parsedAssumptions.assumptions,
    malformed: {
      model: parsedModel.malformed,
      links: parsedLinks.malformed,
      loops: parsedLoops.malformed,
      assumptions: parsedAssumptions.malformed,
      marks: parsedMarks.malformed,
    },
  };
}

/** Every reference slug currently on the map (what the walk reads against). */
function wordsOf(journey: Journey): Set<string> {
  const slugs = new Set<string>();
  for (const ref of journey.refs) {
    if (ref.slug !== null) slugs.add(ref.slug);
  }
  return slugs;
}

/** The walk: a read of the authored records, recomputed on every call. */
function readOf(journey: Journey, loop: Loop): LoopRead {
  return readLoop(loop, {
    links: journey.links,
    marks: journey.marks,
    model: journey.model,
    words: wordsOf(journey),
  });
}

/** No file anywhere may contain the verdict vocabulary (ADR-0015). */
function expectNoVerdictStored(files: Files): void {
  for (const path of Object.keys(files)) {
    expect(path + "\n" + files[path]).not.toMatch(/reinforc|balanc/i);
  }
}

function file(files: Files, path: string): string {
  const text = files[path];
  if (text === undefined) throw new Error("the journey must write " + path);
  return text;
}

/* -------------------------------------------------------------------------
 * The journey's stages: each is a pure step over the records, in the order the
 * epic's check makes them.
 * ---------------------------------------------------------------------- */

/** The person maps a small real subject: five coined words, nothing played yet. */
function fresh(): Journey {
  return {
    refs: [
      reference(
        "rain",
        "rain",
        220,
        180,
        "the water that arrives without being asked\n",
      ),
      reference("soil", "soil", 360, 320),
      reference("mulch", "mulch", 700, 320, "a slow sponge\n"),
      reference("sprinkler", "sprinkler", 880, 340),
      reference("hose", "hose", 1000, 360),
    ],
    level: "concept",
    model: null,
    distances: [],
    links: [],
    loops: [],
    marks: [],
    assumptions: [],
    malformed: { model: null, links: [], loops: [], assumptions: [], marks: [] },
  };
}

/** Enter the dynamics game: select-all (pre-filled), prune two, accept. */
function entered(journey: Journey): Journey {
  const available = [...wordsOf(journey)];
  const prefilled = prefilledSelection(journey.model, available);
  const accepted = ["hose", "sprinkler"].reduce(
    (playing, slug) => withoutWord(playing, slug),
    play(prefilled),
  );
  return { ...journey, level: "dynamics", model: accepted };
}

/** Draw the signed links: the pair both ways, then the cycle's other two. */
function linked(journey: Journey): Journey {
  let links: Link[] = [];
  links = drawLink(links, "rain", "soil", "+");
  links = drawLink(links, "soil", "rain", "-");
  links = drawLink(links, "soil", "mulch", "+");
  links = drawLink(links, "mulch", "rain", "+");
  // Drawing the identical link again rewrites the one line (never a second).
  links = drawLink(links, "rain", "soil", "+");
  return { ...journey, links };
}

/** Click the words in path order, close at the start, coin the name. */
function looped(journey: Journey): Journey {
  return {
    ...journey,
    loops: nameLoop(journey.loops, "rain loop", ["rain", "soil", "mulch", "rain"]),
  };
}

/** Mark one link's sign unsettled: the file keeps the sign, the read shows doubt. */
function marked(journey: Journey): Journey {
  return {
    ...journey,
    marks: withMark(journey.marks, {
      kind: "open",
      target: linkMark("mulch", "rain"),
      extra: {},
    }),
  };
}

/** Withdraw the mark: settle is deletion, and the verdict returns. */
function withdrawn(journey: Journey): Journey {
  return {
    ...journey,
    marks: withoutMark(journey.marks, "open", linkMark("mulch", "rain")),
  };
}

/** Flip an unmarked sign: revision in place, the read changes in the same breath. */
function flipped(journey: Journey): Journey {
  return { ...journey, links: flipLink(journey.links, "rain", "soil") };
}

/** State a claim about a link, add a rival beside it, and claim a word. */
function assumed(journey: Journey): Journey {
  const onLink: AssumptionTarget = { type: "link", from: "rain", to: "soil" };
  let assumptions: Assumption[] = [];
  assumptions = addAssumption(assumptions, "mulch holds the rain", onLink);
  assumptions = addAssumption(assumptions, "mulch is patchy", onLink);
  assumptions = addAssumption(assumptions, "mulch soaks slowly", {
    type: "word",
    slug: "mulch",
  });
  return { ...journey, assumptions };
}

/** Revise the first claim: the line changes at its index, nothing else moves. */
function revised(journey: Journey): Journey {
  return {
    ...journey,
    assumptions: reviseAssumption(
      journey.assumptions,
      0,
      "mulch holds the rain in place",
    ),
  };
}

/** Remove a link: the record dies and its claims die with it (die-with-target). */
function removed(journey: Journey): Journey {
  return {
    ...journey,
    links: removeLink(journey.links, "rain", "soil"),
    assumptions: dropLinkAssumptions(journey.assumptions, "rain", "soil"),
  };
}

/**
 * Rename a word through the whole batch, in the app's documented order: the
 * renamed file (prose byte-verbatim), then distances -> links -> marks -> loops
 * -> assumptions -> membership; the old file is simply no longer in the refs.
 */
function renamed(journey: Journey): Journey {
  const oldSlug = "mulch";
  const newName = "woodchip";
  return {
    ...journey,
    refs: journey.refs.map((ref) =>
      ref.slug === oldSlug
        ? { ...ref, id: newName, slug: newName, name: newName }
        : ref,
    ),
    distances: rewriteEndpoints(journey.distances, oldSlug, newName),
    links: rewriteLinkEndpoints(journey.links, oldSlug, newName),
    marks: rewriteMarkEndpoints(journey.marks, oldSlug, newName),
    loops: rewriteLoopPaths(journey.loops, oldSlug, newName),
    assumptions: rewriteAssumptionTargets(journey.assumptions, oldSlug, newName),
    model: journey.model
      ? rewriteMembership(journey.model, oldSlug, newName)
      : null,
  };
}

type Step = (journey: Journey) => Journey;

const STAGES: Array<[string, Step]> = [
  ["entered", entered],
  ["linked", linked],
  ["looped", looped],
  ["marked", marked],
  ["withdrawn", withdrawn],
  ["flipped", flipped],
  ["assumed", assumed],
  ["revised", revised],
  ["removed", removed],
  ["renamed", renamed],
];

/** The journey up to and including one stage, rebuilt from the files' rules. */
function at(stage: string): Journey {
  let journey = fresh();
  for (const [name, step] of STAGES) {
    journey = step(journey);
    if (name === stage) return journey;
  }
  throw new Error("unknown journey stage: " + stage);
}

/* -------------------------------------------------------------------------
 * The journey.
 * ---------------------------------------------------------------------- */

describe("the epic's record-level journey (Epic 4)", () => {
  test("enter the dynamics game: select-all, prune two, accept — the playing set is literal", () => {
    const started = fresh();
    const available = [...wordsOf(started)].sort();
    expect(available).toEqual(["hose", "mulch", "rain", "soil", "sprinkler"]);
    // First entry is pre-filled with every word (the door is one press).
    expect(prefilledSelection(started.model, available)).toEqual(available);

    const accepted = entered(started);
    expect(accepted.level).toBe("dynamics");
    expect(accepted.model!.words).toEqual(["mulch", "rain", "soil"]);

    const files = write(accepted);
    expect(file(files, "map/model.json")).toBe(modelJson(["mulch", "rain", "soil"]));
    // Exclusion is absence: the pruned words stay on the map, out of play.
    expect(files[REFS + "sprinkler.md"]).toBeDefined();
    expect(files[REFS + "hose.md"]).toBeDefined();
    expect(file(files, "map/model.json")).not.toContain("sprinkler");
    // The level is the workspace's one source, written canonically.
    expect(file(files, "workspace.yml")).toContain('level: "dynamics"');
    expect(levelOfText(file(files, "workspace.yml"))).toBe("dynamics");
    expect(Object.keys(parseYamlFields(file(files, "workspace.yml"))).sort()).toEqual([
      "format",
      "level",
      "shelf_x",
    ]);
  });

  test("draw signed links: A->B '+' and B->A '-' coexist as two lines", () => {
    const files = write(at("linked"));
    const text = file(files, "map/links.jsonl");
    expect(text).toBe(
      lines(
        linkLine("rain", "+", "soil"),
        linkLine("soil", "-", "rain"),
        linkLine("soil", "+", "mulch"),
        linkLine("mulch", "+", "rain"),
      ),
    );
    const parsed = parseLinks(text).links;
    expect(parsed).toHaveLength(4);
    // The ordered pair is the key: the reverse link is a different link.
    expect(parsed.filter((link) => link.from === "rain" && link.to === "soil")).toHaveLength(1);
    expect(parsed.filter((link) => link.from === "soil" && link.to === "rain")).toHaveLength(1);
    // The identical re-draw in the batch did not append a second line.
    expect(parseLinks(text).malformed).toEqual([]);
  });

  test("name the three-cycle: the path is rotation-canonical, direction kept", () => {
    const files = write(at("looped"));
    expect(file(files, "map/loops.jsonl")).toBe(
      lines('{"name":"rain loop","path":["mulch","rain","soil","mulch"]}'),
    );
    // The click order was rain, soil, mulch, rain; the stored line starts at
    // the smallest slug ('mulch') and keeps the direction (not reversed).
    const parsed = parseLoops(file(files, "map/loops.jsonl")).loops[0];
    expect(parsed.path[0]).toBe("mulch");
    expect(parsed.path[parsed.path.length - 1]).toBe("mulch");
    expect(parsed.path).toEqual(["mulch", "rain", "soil", "mulch"]);
  });

  test("read the loop: three steps, reinforcing — the verdict only when complete", () => {
    const journey = at("looped");
    const read = readOf(journey, journey.loops[0]);
    expect(read.path).toEqual(["mulch", "rain", "soil", "mulch"]);
    expect(read.steps).toEqual([
      { kind: "sign", from: "mulch", to: "rain", sign: "+" },
      { kind: "sign", from: "rain", to: "soil", sign: "+" },
      { kind: "sign", from: "soil", to: "mulch", sign: "+" },
    ]);
    expect(read.complete).toBe(true);
    expect(read.verdict).toBe("reinforcing");
    // The verdict is never written: only the links that justify it are.
    expectNoVerdictStored(write(journey));

    // One word out of play withholds the verdict, even with every sign known.
    const partial = readLoop(journey.loops[0], {
      links: journey.links,
      marks: journey.marks,
      model: play(["mulch", "rain"]),
      words: wordsOf(journey),
    });
    expect(partial.complete).toBe(false);
    expect(partial.verdict).toBeNull();
    expect(partial.wordGaps).toEqual([{ kind: "out-of-play", slug: "soil" }]);
    expect(JSON.stringify(partial)).not.toMatch(/reinforc|balanc/i);
  });

  test("mark one link's sign: the read goes partial, names the gap, withholds the verdict", () => {
    const journey = at("marked");
    const read = readOf(journey, journey.loops[0]);
    expect(read.steps[0]).toEqual({
      kind: "gap",
      from: "mulch",
      to: "rain",
      gap: { kind: "marked-link" },
    });
    expect(read.steps.slice(1)).toEqual([
      { kind: "sign", from: "rain", to: "soil", sign: "+" },
      { kind: "sign", from: "soil", to: "mulch", sign: "+" },
    ]);
    expect(read.complete).toBe(false);
    expect(read.verdict).toBeNull();
    expect(JSON.stringify(read)).not.toMatch(/reinforc|balanc/i);

    const files = write(journey);
    expect(file(files, "map/marks.jsonl")).toBe(
      lines('{"from":"mulch","kind":"open","to":"rain"}'),
    );
    // Mark precedence is a READ rule: the file still holds the stored sign.
    expect(file(files, "map/links.jsonl")).toContain('{"from":"mulch","sign":"+","to":"rain"}');
    // The marked step shows unknown, never the stored "+".
    expect(read.steps.some((step) => step.kind === "sign" && step.from === "mulch")).toBe(false);
    expectNoVerdictStored(files);
  });

  test("withdraw the mark: the stored sign comes back and the verdict returns", () => {
    const journey = at("withdrawn");
    expect(journey.marks).toEqual([]);
    const read = readOf(journey, journey.loops[0]);
    expect(read.complete).toBe(true);
    expect(read.verdict).toBe("reinforcing");
    expect(read.steps[0]).toEqual({
      kind: "sign",
      from: "mulch",
      to: "rain",
      sign: "+",
    });
    // Settle is deletion: no tombstone, no leftover line.
    expect(file(write(journey), "map/marks.jsonl")).toBe("\n");
  });

  test("flip an unmarked sign: the line changes in place and the verdict flips", () => {
    const before = at("withdrawn");
    const after = at("flipped");
    const indexBefore = before.links.findIndex(
      (link) => link.from === "rain" && link.to === "soil",
    );
    const indexAfter = after.links.findIndex(
      (link) => link.from === "rain" && link.to === "soil",
    );
    expect(indexAfter).toBe(indexBefore);
    expect(after.links[indexAfter].sign).toBe("-");
    expect(after.links).toHaveLength(before.links.length);

    expect(readOf(before, before.loops[0]).verdict).toBe("reinforcing");
    expect(readOf(after, after.loops[0]).verdict).toBe("balancing");
    // The flip rewrote the one line; nothing else in the file moved.
    const files = write(after);
    expect(file(files, "map/links.jsonl")).toBe(
      lines(
        linkLine("rain", "-", "soil"),
        linkLine("soil", "-", "rain"),
        linkLine("soil", "+", "mulch"),
        linkLine("mulch", "+", "rain"),
      ),
    );
    expectNoVerdictStored(files);
  });

  test("state an assumption, add a rival, revise one in place", () => {
    const assumedJourney = at("assumed");
    const before = write(assumedJourney);
    expect(file(before, "map/assumptions.jsonl")).toBe(
      lines(
        '{"from":"rain","text":"mulch holds the rain","to":"soil"}',
        '{"from":"rain","text":"mulch is patchy","to":"soil"}',
        '{"on":"mulch","text":"mulch soaks slowly"}',
      ),
    );

    const onLink = findAssumptions(assumedJourney.assumptions, {
      type: "link",
      from: "rain",
      to: "soil",
    });
    // The overlay's order is file order, each line with its index.
    expect(onLink.map((found) => found.index)).toEqual([0, 1]);
    expect(onLink.map((found) => found.assumption.text)).toEqual([
      "mulch holds the rain",
      "mulch is patchy",
    ]);

    const revisedJourney = at("revised");
    const after = write(revisedJourney);
    const beforeLines = file(before, "map/assumptions.jsonl").slice(0, -1).split("\n");
    const afterLines = file(after, "map/assumptions.jsonl").slice(0, -1).split("\n");
    expect(afterLines).toHaveLength(3);
    // Exactly one line changed, at the same index; the rival is untouched.
    expect(afterLines[0]).not.toBe(beforeLines[0]);
    expect(afterLines.slice(1)).toEqual(beforeLines.slice(1));
    expect(file(after, "map/assumptions.jsonl")).toBe(
      lines(
        '{"from":"rain","text":"mulch holds the rain in place","to":"soil"}',
        '{"from":"rain","text":"mulch is patchy","to":"soil"}',
        '{"on":"mulch","text":"mulch soaks slowly"}',
      ),
    );
  });

  test("remove a link: the read names the missing link (reverse hint) and its claims die", () => {
    const journey = at("removed");
    const read = readOf(journey, journey.loops[0]);
    expect(read.steps).toEqual([
      { kind: "sign", from: "mulch", to: "rain", sign: "+" },
      {
        kind: "gap",
        from: "rain",
        to: "soil",
        gap: { kind: "missing-link", reverse: true },
      },
      { kind: "sign", from: "soil", to: "mulch", sign: "+" },
    ]);
    expect(read.complete).toBe(false);
    expect(read.verdict).toBeNull();
    expect(read.wordGaps).toEqual([]);
    expect(JSON.stringify(read)).not.toMatch(/reinforc|balanc/i);

    const files = write(journey);
    expect(file(files, "map/links.jsonl")).toBe(
      lines(
        linkLine("soil", "-", "rain"),
        linkLine("soil", "+", "mulch"),
        linkLine("mulch", "+", "rain"),
      ),
    );
    // The two claims on the removed link die with it; the word's claim stays.
    expect(file(files, "map/assumptions.jsonl")).toBe(
      lines('{"on":"mulch","text":"mulch soaks slowly"}'),
    );
  });

  test("rename a word: every record follows byte-exactly (endpoints, paths, targets, membership)", () => {
    const journey = at("renamed");
    const files = write(journey);

    // Membership follows, sorted.
    expect(file(files, "map/model.json")).toBe(modelJson(["rain", "soil", "woodchip"]));
    // Endpoints follow; the sign is authored structure and never touched.
    expect(file(files, "map/links.jsonl")).toBe(
      lines(
        linkLine("soil", "-", "rain"),
        linkLine("soil", "+", "woodchip"),
        linkLine("woodchip", "+", "rain"),
      ),
    );
    // The path follows AND is rotation-canonical again ('rain' is smallest now).
    expect(file(files, "map/loops.jsonl")).toBe(
      lines('{"name":"rain loop","path":["rain","soil","woodchip","rain"]}'),
    );
    // Assumption targets follow; the claim's text is never rewritten (World B).
    expect(file(files, "map/assumptions.jsonl")).toBe(
      lines('{"on":"woodchip","text":"mulch soaks slowly"}'),
    );
    // The old reference file is gone; the renamed one keeps the prose verbatim.
    expect(files[REFS + "mulch.md"]).toBeUndefined();
    const moved = parseReference(
      "woodchip",
      "woodchip",
      file(files, REFS + "woodchip.md"),
    );
    expect(moved.name).toBe("woodchip");
    expect(moved.body).toBe("a slow sponge\n");
    expect(serializeReference(moved)).toBe(file(files, REFS + "woodchip.md"));

    // The read follows the rename: the same missing link, under the rotated path.
    const read = readOf(journey, journey.loops[0]);
    expect(read.path).toEqual(["rain", "soil", "woodchip", "rain"]);
    expect(read.steps[0]).toEqual({
      kind: "gap",
      from: "rain",
      to: "soil",
      gap: { kind: "missing-link", reverse: true },
    });
    expect(read.verdict).toBeNull();
    expectNoVerdictStored(files);
  });

  test("quit, reopen: all four records round-trip byte-exactly together", () => {
    const journey = at("renamed");
    const files = write(journey);
    const reopened = reopen(files); // every file's bytes asserted in reopen

    // The four records, together, write back the same bytes.
    const rewritten = write(reopened);
    for (const path of [
      "map/model.json",
      "map/links.jsonl",
      "map/loops.jsonl",
      "map/assumptions.jsonl",
    ]) {
      expect(file(rewritten, path)).toBe(file(files, path));
    }
    expect(rewritten).toEqual(files);
    // The level resumes, and the reading is recomputed from the bytes — never
    // read back from a stored label.
    expect(reopened.level).toBe("dynamics");
    expect(readOf(reopened, reopened.loops[0])).toEqual(
      readOf(journey, journey.loops[0]),
    );
    expect(readOf(reopened, reopened.loops[0]).verdict).toBeNull();
    // The claim's text still says "mulch" although its target is "woodchip":
    // a rename changes addresses, never prose.
    expect(file(rewritten, "map/assumptions.jsonl")).toContain("mulch soaks slowly");

    // Re-drawing the removed link completes the walk again — the reading was
    // derived all along, so the same files can heal it.
    const healed: Journey = {
      ...reopened,
      links: drawLink(reopened.links, "rain", "soil", "-"),
    };
    const healedRead = readOf(healed, healed.loops[0]);
    expect(healedRead.complete).toBe(true);
    expect(healedRead.verdict).toBe("balancing");
  });

  test("every gap kind is named once — never repaired, never guessed — and the self-link reads plainly", () => {
    const journey = at("renamed");
    const context = {
      links: journey.links,
      marks: journey.marks,
      model: journey.model,
      words: wordsOf(journey),
    };

    // (a) A dangling word: a hand-edited loop path naming a word the map lost.
    const handEdited = file(write(journey), "map/loops.jsonl")
      + '{"name":"phantom loop","path":["rain","phantom","rain"]}' + "\n";
    const parsed = parseLoops(handEdited);
    expect(parsed.malformed).toEqual([]);
    const phantom = parsed.loops.find((loop) => loop.name === "phantom loop")!;
    const dangling = readLoop(phantom, context);
    expect(dangling.wordGaps).toEqual([{ kind: "dangling", slug: "phantom" }]);
    expect(dangling.complete).toBe(false);
    expect(dangling.verdict).toBeNull();
    // The hand-edited path is surfaced, never repaired or re-ordered by the read.
    expect(dangling.path).toEqual(["rain", "phantom", "rain"]);

    // (b) An out-of-play word: on the map, not in the playing set.
    const sprinklerLoop = nameLoop(
      [],
      "sprinkler loop",
      ["sprinkler", "soil", "sprinkler"],
    )[0];
    const outOfPlay = readLoop(sprinklerLoop, {
      ...context,
      links: [
        ...journey.links,
        { from: "soil", to: "sprinkler", sign: "+", extra: {} },
        { from: "sprinkler", to: "soil", sign: "+", extra: {} },
      ],
    });
    expect(outOfPlay.complete).toBe(false);
    expect(outOfPlay.wordGaps).toEqual([{ kind: "out-of-play", slug: "sprinkler" }]);
    expect(outOfPlay.verdict).toBeNull();

    // (c) A missing link with the reverse hint (the journey's own removal).
    const removedRead = readOf(at("removed"), at("removed").loops[0]);
    expect(removedRead.steps[1]).toEqual({
      kind: "gap",
      from: "rain",
      to: "soil",
      gap: { kind: "missing-link", reverse: true },
    });

    // (d) A marked link: the sign is withheld while the mark stands.
    const markedRead = readOf(at("marked"), at("marked").loops[0]);
    expect(markedRead.steps[0]).toEqual({
      kind: "gap",
      from: "mulch",
      to: "rain",
      gap: { kind: "marked-link" },
    });

    // (e) The self-link: a legal one-step loop, no special case.
    const selfLoop = nameLoop([], "rain on itself", ["rain", "rain"])[0];
    const selfContext = {
      ...context,
      marks: [] as Mark[],
    };
    const plus = readLoop(selfLoop, {
      ...selfContext,
      links: [{ from: "rain", to: "rain", sign: "+", extra: {} }],
    });
    expect(plus.complete).toBe(true);
    expect(plus.verdict).toBe("reinforcing");
    const minus = readLoop(selfLoop, {
      ...selfContext,
      links: [{ from: "rain", to: "rain", sign: "-", extra: {} }],
    });
    expect(minus.complete).toBe(true);
    expect(minus.verdict).toBe("balancing");

    for (const read of [dangling, outOfPlay, removedRead, markedRead]) {
      expect(JSON.stringify(read)).not.toMatch(/reinforc|balanc/i);
    }
  });

  test("the negative space: no record stores a verdict and nothing counts anything", () => {
    const journey = at("renamed");
    const files = write(journey);
    const recordPaths = [
      "map/model.json",
      "map/links.jsonl",
      "map/loops.jsonl",
      "map/assumptions.jsonl",
    ];

    // No file anywhere contains the verdict vocabulary.
    expectNoVerdictStored(files);
    for (const path of recordPaths) {
      expect(file(files, path)).not.toMatch(/verdict|label|score|streak/i);
    }

    // No record carries a numeric field: every value bottoms out in strings.
    // (A bare-spot target's x/y are plane positions, the only numbers a record
    // may hold — the journey has none, and no key counts anything.)
    const COUNTER = /count|score|streak|progress|tally|total|queue|times|number|weight|strength|magnitude|rate|verdict|label|reinforc|balanc/i;
    function walk(value: unknown, key: string): void {
      if (Array.isArray(value)) {
        for (const item of value) walk(item, key);
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const child of Object.keys(value as Record<string, unknown>)) {
          expect(child).not.toMatch(COUNTER);
          walk((value as Record<string, unknown>)[child], child);
        }
        return;
      }
      expect(typeof value).toBe("string");
      expect(key).not.toMatch(COUNTER);
    }

    walk(JSON.parse(file(files, "map/model.json")), "model");
    for (const path of recordPaths.slice(1)) {
      for (const line of file(files, path).split("\n").filter(Boolean)) {
        walk(JSON.parse(line), path);
      }
    }

    // Each record keeps exactly its contract keys: a link is from/sign/to, a
    // loop is name/path, a claim is text + one target — nothing to count with.
    const model = JSON.parse(file(files, "map/model.json")) as Record<string, unknown>;
    expect(Object.keys(model)).toEqual(["words"]);
    expect(Array.isArray(model.words)).toBe(true);
    for (const line of file(files, "map/links.jsonl").split("\n").filter(Boolean)) {
      const link = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(link).sort()).toEqual(["from", "sign", "to"]);
      expect(["+", "-"]).toContain(link.sign as string);
    }
    for (const line of file(files, "map/loops.jsonl").split("\n").filter(Boolean)) {
      const loop = JSON.parse(line) as { name: string; path: string[] };
      expect(Object.keys(loop).sort()).toEqual(["name", "path"]);
      expect(loop.path[0]).toBe(loop.path[loop.path.length - 1]);
    }
    for (const line of file(files, "map/assumptions.jsonl").split("\n").filter(Boolean)) {
      const claim = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(claim)).toContain("text");
      // Exactly one target form, and no field that could hold a judgement.
      const targetKeys = Object.keys(claim).filter((key) => key !== "text");
      expect([
        ["on"],
        ["from", "to"],
        ["loop"],
        ["x", "y"],
      ]).toContainEqual(targetKeys.sort());
    }
  });
});
