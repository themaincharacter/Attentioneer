import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { scopedMembership, variantAcceptWords } from "../src/scenarios/variant";

/**
 * Epic 8 story 2's membership-scoped sets (ADR-0021 decision 4), automated: a
 * variant may join or prune EXISTING words only, and a slug the map does not
 * carry is a NAMELESS GHOST — surfaced quietly, never drawn as a word.
 *
 * The two halves are tested where they live: the pure scoping here, and the
 * wiring the app runs — the hook's reading, the accept's prune, the coining
 * that joins the ACTIVE set (ADR-0021 decision 3) and the chooser's quiet
 * surface — by reading the source.
 */

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const MAP = new Set(["rain", "soil"]);

describe("a variant's set is scoped to the map's words", () => {
  test("members are the words the map carries; ghosts are the rest", () => {
    expect(scopedMembership(["soil", "rain"], MAP)).toEqual({
      members: ["rain", "soil"],
      ghosts: [],
    });
    expect(scopedMembership(["rain", "ghost", "soil", "phantom"], MAP)).toEqual({
      members: ["rain", "soil"],
      ghosts: ["ghost", "phantom"],
    });
  });

  test("both sides are sorted and unique (the canonical member order)", () => {
    expect(scopedMembership(["soil", "rain", "soil"], MAP)).toEqual({
      members: ["rain", "soil"],
      ghosts: [],
    });
    expect(scopedMembership(["ghost", "ghost"], MAP)).toEqual({
      members: [],
      ghosts: ["ghost"],
    });
  });

  test("an empty set, or no map at all, is empty on both sides", () => {
    expect(scopedMembership([], MAP)).toEqual({ members: [], ghosts: [] });
    expect(scopedMembership(["rain"], new Set())).toEqual({
      members: [],
      ghosts: ["rain"],
    });
  });

  test("a variant's accept joins or prunes EXISTING words only", () => {
    // A stale slug that left the map while the selector was open is pruned
    // rather than written back as a new ghost.
    expect(variantAcceptWords(["rain", "gone"], MAP)).toEqual(["rain"]);
    // A prune is the same reading: the words the person kept, scoped.
    expect(variantAcceptWords(["soil"], MAP)).toEqual(["soil"]);
    expect(variantAcceptWords(["ghost"], MAP)).toEqual([]);
  });
});

describe("ghosts are surfaced and never drawn as words", () => {
  const appSource = source("../src/App.tsx");
  const useMapSource = source("../src/canvas/useMap.ts");
  const wordSource = source("../src/canvas/ReferenceWord.tsx");

  test("the hook reads a branch's set against the map and exposes the ghosts", () => {
    expect(useMapSource).toContain("scopedMembership(model.words, onMapSlugs)");
    expect(useMapSource).toContain("ghostMembers,");
    // The COMMITTED reading stays its own: with a branch active, one hand edit
    // is never surfaced twice.
    expect(useMapSource).toContain(
      "if (!loaded || scenario !== null || model === null) return [];",
    );
  });

  test("the notices name the ghost and where it is kept", () => {
    expect(appSource).toContain("ghostMembers={ghostMembers}");
    expect(appSource).toContain("ghostMembers.map(");
    expect(appSource).toContain("nameless ghost");
    expect(appSource).toContain("no such word on the map");
  });

  test("a ghost has no word to draw: the plane draws references, not slugs", () => {
    // A ghost is a slug in a branch's model.json and nothing else; the word
    // component never learns about it and the canvas renders references.
    expect(wordSource).not.toContain("ghost");
    expect(appSource).not.toContain("ghostWord");
    expect(appSource).not.toContain("<ReferenceWord ghost");
  });
});

describe("coining while a branch runs joins the ACTIVE set", () => {
  const useMapSource = source("../src/canvas/useMap.ts");

  function callbackBody(text: string, name: string): string {
    const start = text.indexOf("const " + name + " = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = text.indexOf("\n  );", start);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
  }

  test("the join writes the branch's model.json, not the committed one", () => {
    const body = callbackBody(useMapSource, "joinToPlay");
    expect(body).toContain("saveModel(recordsDir, next)");
  });

  test("the reference file is still the durable FIRST write of a coin", () => {
    const body = callbackBody(useMapSource, "updateReference");
    expect(body).toContain("saveReference(workspacePath, ref)");
    expect(body.indexOf("saveReference(")).toBeLessThan(body.indexOf("joinToPlay("));
    // Only a COIN joins; editing an existing word never touches membership.
    expect(body).toContain("coining && saved.slug !== null");
  });

  test("the accept prunes a variant's set to the map", () => {
    const body = callbackBody(useMapSource, "acceptPlayingSet");
    expect(body).toContain("variantAcceptWords(slugs, onMapSlugs)");
    expect(body).toContain("scenario === null ? dedupe(slugs)");
    expect(body).toContain("saveModel(recordsDir, next)");
  });

  test("the three variant-owned records read and write the records folder", () => {
    const reload = callbackBody(useMapSource, "reloadMap");
    expect(reload).toContain("loadLinks(recordsDir)");
    expect(reload).toContain("loadModel(recordsDir)");
    expect(reload).toContain("loadQuantities(recordsDir)");
    expect(callbackBody(useMapSource, "persistLinks")).toContain("(recordsDir");
    expect(callbackBody(useMapSource, "persistQuantities")).toContain(
      "(recordsDir",
    );
    // The map's own records keep reading the workspace (the map IS the
    // committed model).
    expect(reload).toContain("loadReferences(workspacePath)");
    expect(reload).toContain("loadAssumptions(workspacePath)");
  });
});

describe("the chooser is quiet and only the person names a branch", () => {
  const chooserSource = source("../src/canvas/ScenarioChooser.tsx");
  const controlSource = source("../src/canvas/LevelControl.tsx");
  const appSource = source("../src/App.tsx");

  test("the list is names: the map first, the branches, the one branch action", () => {
    expect(chooserSource).toContain("the map");
    expect(chooserSource).toContain("branch…");
    expect(chooserSource).toContain("scenarios.map((scenario)");
    expect(chooserSource).toContain("onChoose(scenario.slug)");
    expect(chooserSource).toContain("aria-pressed={active === scenario.slug}");
    // A name field is the only place a name arises; Enter branches, Esc cancels.
    expect(chooserSource).toContain("placeholder=\"name the branch…\"");
    expect(chooserSource).toContain('e.key === "Enter"');
    expect(chooserSource).toContain('e.key === "Escape"');
    expect(chooserSource).toContain("if (trimmed) onBranch(trimmed);");
  });

  test("retiring is the quiet × — one click, no ceremony, no history", () => {
    expect(chooserSource).toContain("scenario-retire");
    expect(chooserSource).toContain("onRetire(scenario.slug)");
    expect(chooserSource).toContain("retire this branch");
    // No confirmation, no count, no score, no history.
    expect(chooserSource).not.toContain("confirm(");
    expect(chooserSource).not.toContain("alert(");
    expect(chooserSource).not.toContain("streak");
    expect(chooserSource).not.toContain("score");
  });

  test("it lives in the level control's dynamics action, outside the plane", () => {
    expect(controlSource).toContain("<ScenarioChooser");
    expect(controlSource).toContain("level === \"dynamics\" && (");
    expect(appSource).toContain("onChooseScenario={chooseScenario}");
    expect(appSource).toContain("onBranchScenario={branchModel}");
    expect(appSource).toContain("onRetireScenario={retireBranch}");
    expect(appSource).toContain("activeScenario={scenario}");
    // The control (and so the chooser) is outside .plane: the plane's armed
    // gate cannot reach it, and no press here can start a plane gesture.
    expect(appSource.indexOf("</CanvasPlane>")).toBeLessThan(
      appSource.indexOf("<LevelControl"),
    );
  });

  test("the chooser never writes: the switch is the handoff's", () => {
    expect(chooserSource).not.toContain("saveWorkspaceScenario");
    expect(chooserSource).not.toContain("writeMachineFile");
    expect(chooserSource).not.toContain("createScenario(");
  });
});
