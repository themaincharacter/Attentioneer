import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  branchName,
  branchPlan,
  parseScenario,
  scenarioSlugFor,
  scenarioYml,
  SCENARIO_FORMAT,
  type BranchSource,
} from "../src/scenarios/branch";
import { parsePins } from "../src/scenarios/pins";
import { agentsMd } from "../src/lib/serialize";

/**
 * Epic 8 story 2's branch folder (ADR-0021 decision 1), automated: a scenario
 * is a named folder OUTSIDE map/ — a self-describing header plus BYTE-copies
 * of the committed model's three variant-owned records and a pin for every
 * committed assumption line.
 *
 * Two rules are pinned here and nowhere else:
 *
 *   - BYTE-FAITHFUL: a copy is the committed file's exact bytes. Malformed
 *     lines, CRLF, a missing trailing newline, odd key order — all of it is the
 *     copy, because the branch is a copy and never a canonicalization pass that
 *     could "repair" what the person hand-wrote.
 *   - ATOMIC: the header is written LAST (creation) and removed FIRST
 *     (retirement), so a folder is a scenario exactly when it is whole. The
 *     order is read from the source the app runs, as the other batches' orders
 *     are; the real writes are the human pass.
 */

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

function functionBody(text: string, name: string): string {
  const start = text.indexOf("export async function " + name);
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

function slugFor(name: string, taken: readonly string[]): string {
  return scenarioSlugFor(name, new Set(taken));
}

describe("the branch folder is self-describing", () => {
  test("the header carries the format key and the coined name", () => {
    expect(scenarioYml("Evening walk")).toBe(
      'format: "' + SCENARIO_FORMAT + '"\nname: "Evening walk"\n',
    );
  });

  test("a header without this app's format key is not a scenario", () => {
    // A hand-made or foreign folder is never adopted as a branch.
    expect(parseScenario(null)).toBeNull();
    expect(parseScenario('name: "Evening"\n')).toBeNull();
    expect(
      parseScenario('format: "something-else"\nname: "Evening"\n'),
    ).toBeNull();
    expect(parseScenario('format: "' + SCENARIO_FORMAT + '"\n')).toBeNull();
    expect(
      parseScenario('format: "' + SCENARIO_FORMAT + '"\nname: "   "\n'),
    ).toBeNull();
  });

  test("a valid header reads back the coined name and its slug", () => {
    expect(parseScenario(scenarioYml("Evening walk"))).toEqual({
      slug: "evening-walk",
      name: "Evening walk",
    });
  });

  test("a branch's slug mints against the folders that already exist", () => {
    expect(slugFor("Evening walk", [])).toBe("evening-walk");
    expect(slugFor("Evening walk", ["evening-walk"])).toBe("evening-walk-2");
    expect(
      slugFor("Evening walk", ["evening-walk", "evening-walk-2"]),
    ).toBe("evening-walk-3");
    // A non-Latin coined name keeps its identity (ADR-0005's slug rules).
    expect(slugFor("夕暮れ", [])).toBe("夕暮れ");
  });

  test("a name collision mints the name and the slug together (the loop rule)", () => {
    // The header carries the name and the folder the slug: they never drift,
    // and two branches never share a name in the chooser.
    expect(branchName("Evening walk", new Set())).toEqual({
      slug: "evening-walk",
      name: "Evening walk",
    });
    expect(branchName("Evening walk", new Set(["evening-walk"]))).toEqual({
      slug: "evening-walk-2",
      name: "Evening walk 2",
    });
    expect(
      branchName("Evening walk", new Set(["evening-walk", "evening-walk-2"])),
    ).toEqual({ slug: "evening-walk-3", name: "Evening walk 3" });
  });
});

describe("the branch is byte-faithful", () => {
  const committed: BranchSource = {
    // Unreadable (malformed) model bytes: preserved EXACTLY, never repaired.
    model: '{"words": [',
    // A hand-written links file: CRLF, odd spacing, a malformed line.
    links: '{ "to": "b", "from": "a", "sign": "+" }\r\n{oops\r\n',
    // No quantities file at all: absent stays absent (never invented empty).
    quantities: null,
    // One claim and one malformed line: one pin; the malformed bytes are not a
    // claim and have no (target, text) to pin.
    assumptions:
      '{"text":"rain feeds soil","from":"rain","to":"soil"}\n{bad\n',
  };

  const plan = branchPlan("Evening walk", committed);

  test("each copy is the committed file's exact bytes", () => {
    const byFile = new Map(
      plan.files.map((file) => [file.file, file.content] as const),
    );
    expect(byFile.get("model.json")).toBe(committed.model);
    expect(byFile.get("links.jsonl")).toBe(committed.links);
    // CRLF and the malformed line survived: no canonicalization, no repair.
    expect(byFile.get("links.jsonl")).toContain("\r\n");
    expect(byFile.get("links.jsonl")).toContain("{oops");
  });

  test("an absent committed record stays absent", () => {
    expect(plan.files.map((file) => file.file)).toEqual([
      "model.json",
      "links.jsonl",
      "assumption-pins.jsonl",
    ]);
  });

  test("every committed claim is pinned, and a pins file is an assumptions file", () => {
    const pins = plan.files.find(
      (file) => file.file === "assumption-pins.jsonl",
    );
    expect(pins).toBeDefined();
    const parsed = parsePins(pins === undefined ? null : pins.content);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.pins).toHaveLength(1);
    expect(parsed.pins[0].text).toBe("rain feeds soil");
    expect(parsed.pins[0].target).toEqual({
      type: "link",
      from: "rain",
      to: "soil",
    });
  });

  test("a branch of a model with no claims still carries the empty pins document", () => {
    const empty = branchPlan("Quiet", {
      model: '{"words": []}\n',
      links: null,
      quantities: null,
      assumptions: null,
    });
    const pins = empty.files.find(
      (file) => file.file === "assumption-pins.jsonl",
    );
    expect(pins === undefined ? null : pins.content).toBe("\n");
  });

  test("the header is the plan's commit point, not one of the copies", () => {
    expect(plan.header.file).toBe("scenario.yml");
    expect(plan.header.content).toBe(scenarioYml("Evening walk"));
    expect(plan.files.map((file) => file.file)).not.toContain("scenario.yml");
  });

  test("the copies keep the family order (the set, links, quantities, pins)", () => {
    const full = branchPlan("Evening walk", {
      model: "{}\n",
      links: "{}\n",
      quantities: "{}\n",
      assumptions: null,
    });
    expect(full.files.map((file) => file.file)).toEqual([
      "model.json",
      "links.jsonl",
      "quantities.jsonl",
      "assumption-pins.jsonl",
    ]);
  });
});

describe("the branch is atomic: the header is the presence bit", () => {
  const branchSource = source("../src/scenarios/branch.ts");

  test("creation writes every copy first and the header LAST", () => {
    const body = functionBody(branchSource, "createScenario");
    const planAt = body.indexOf("branchPlan(");
    const lastCopy = body.lastIndexOf("writeTextFile(");
    expect(planAt).toBeGreaterThan(-1);
    expect(lastCopy).toBeGreaterThan(planAt);
    expect(body.indexOf("writeMachineFile(")).toBeGreaterThan(lastCopy);
    // The copies go through the raw byte door, and the promise is documented
    // where it is made.
    expect(branchSource).toContain("NEVER");
    expect(branchSource).toContain("raw byte door");
  });

  test("retirement removes the header FIRST and the folder LAST", () => {
    const body = functionBody(branchSource, "retireScenario");
    const header = body.indexOf("removeFile(scenarioHeaderPath(");
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(body.indexOf("RECORD_FILE.model"));
    expect(body.indexOf("RECORD_FILE.model")).toBeLessThan(
      body.indexOf("removeDirAll("),
    );
  });

  test("the copies never go through the canonical writer", () => {
    const body = functionBody(branchSource, "createScenario");
    // writeMachineFile would canonicalize LF and append a trailing newline —
    // that is repair, and it is the HEADER's writer only.
    expect(body.match(/writeMachineFile\(/g)?.length).toBe(1);
  });

  test("a folder without a header is never listed or resumed", () => {
    const body = functionBody(branchSource, "listScenarios");
    expect(body).toContain("parseScenario(");
    expect(body).toContain("if (parsed)");
    expect(branchSource).toContain("a crash leftover");
  });
});

describe("the new workspace gets the branch's orientation (write-once)", () => {
  const md = agentsMd("garden");

  test("the orientation names the branch folder, the hint and the two rules", () => {
    expect(md).toContain("## A scenario is a named branch");
    expect(md).toContain("scenarios/<slug>/");
    expect(md).toContain("byte-copies");
    expect(md).toContain("assumption-pins.jsonl");
    expect(md).toContain("a branch never edits");
    expect(md).toContain("it is a resume hint the app writes when");
    expect(md).toContain("a folder without a header is never a scenario");
    expect(md).toContain("nameless ghost");
    expect(md).toContain("DANGLES when no exact (target, text) match");
    expect(md).toContain("die-with-target");
    // The hint is named in the workspace file's own bullet.
    expect(md).toContain("and the branch's");
  });

  test("the scaffold creates the branches' home", () => {
    const serializeSource = source("../src/lib/serialize.ts");
    expect(serializeSource).toContain("createDirAll(");
    expect(serializeSource).toContain("scenarios");
    // The write-once rule still governs the FILES: the scaffold offers exactly
    // the two it always did, and only a NEW workspace gets the folder.
    expect(serializeSource).toContain("scaffoldWrites");
  });
});
