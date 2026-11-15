import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  resolveActiveScenario,
  saveWorkspaceScenario,
  scenarioOf,
  scenarioOfText,
  withScenario,
} from "../src/scenarios/active";
import {
  createScenarioHandoff,
  type ScenarioCause,
  type ScenarioHandoffDeps,
} from "../src/scenarios/handoff";
import { createWriteQueue } from "../src/lib/writeQueue";

/**
 * Epic 8 story 2's active hint (ADR-0021 decision 5), automated: the running
 * branch is a RESUME HINT in workspace.yml — `scenario` — and its ABSENCE
 * means the committed model. The pattern is the level key's (ADR-0018):
 *
 *   - the switch writes it, through the workspace's ONE in-order queue (the
 *     same queue the level handoff uses, because both write this one file);
 *   - RESTORE NEVER WRITES: opening reads the hint, and a hand-edited one is
 *     honored and rewritten only on the first deliberate switch;
 *   - a hint naming no folder on disk resolves to the committed model, quietly.
 *
 * The app's wiring is read from the source it runs: the one write call site,
 * the one queue, and the switch path's own steps (close the transients, cancel
 * the gestures, close the walk, release the level pin).
 */

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

function callbackBody(text: string, name: string): string {
  const start = text.indexOf("const " + name + " = useCallback(");
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("\n  );", start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("workspace.yml's scenario key is the resume hint", () => {
  const before = [
    "# a hand-kept comment",
    'format: "attentioneer-workspace/1"',
    'level: "dynamics"',
    "shelf_x: 1280",
    "note: keep me",
    "",
  ].join("\n");

  test("setting the hint touches only its line and keeps every other byte", () => {
    const after = withScenario(before, "evening-walk");
    expect(after).toBe(
      [
        "# a hand-kept comment",
        'format: "attentioneer-workspace/1"',
        'level: "dynamics"',
        "shelf_x: 1280",
        "note: keep me",
        'scenario: "evening-walk"',
        "",
      ].join("\n"),
    );
    // Nothing else moved: the comment, the level and the fold survive.
    expect(after).toContain("# a hand-kept comment");
    expect(after).toContain('level: "dynamics"');
    expect(after).toContain("shelf_x: 1280");
  });

  test("the key is rewritten in place when it exists", () => {
    const withKey = withScenario(before, "evening-walk");
    const switched = withScenario(withKey, "another-one");
    expect(switched).toContain('scenario: "another-one"');
    expect(switched).not.toContain("evening-walk");
  });

  test("a hand-duplicated key collapses to one line", () => {
    const doubled = before + 'scenario: "first"\nscenario: "second"\n';
    const once = withScenario(doubled, "third");
    expect(once.match(/scenario: /g)?.length).toBe(1);
    expect(once).toContain('scenario: "third"');
  });

  test("the committed model is the ABSENCE of the key", () => {
    const withKey = withScenario(before, "evening-walk");
    // Switching back removes the line and everything else is byte-exact.
    expect(withScenario(withKey, null)).toBe(before);
    // ...even a hand-duplicated pair goes.
    expect(withScenario(withKey + 'scenario: "x"\n', null)).toBe(before);
  });

  test("CRLF and a BOM are tolerated; the write is canonical", () => {
    const messy = "\uFEFF" + before.replace(/\n/g, "\r\n");
    const after = withScenario(messy, "evening-walk");
    expect(after).not.toContain("\r");
    expect(after.endsWith("\n")).toBe(true);
    expect(after.endsWith("\n\n")).toBe(false);
  });

  test("the read is tolerant: absent, empty, garbage and numbers are the map", () => {
    expect(scenarioOf({})).toBeNull();
    expect(scenarioOf({ scenario: "" })).toBeNull();
    expect(scenarioOf({ scenario: "   " })).toBeNull();
    expect(scenarioOf({ scenario: 7 })).toBeNull();
    expect(scenarioOfText(null)).toBeNull();
    expect(scenarioOfText('scenario: "evening-walk"\n')).toBe("evening-walk");
    expect(scenarioOfText("scenario: evening-walk\n")).toBe("evening-walk");
    expect(scenarioOfText("level: dynamics\n")).toBeNull();
  });

  test("a hint resolves only against a folder that exists", () => {
    expect(resolveActiveScenario(null, ["evening-walk"])).toBeNull();
    expect(resolveActiveScenario("evening-walk", ["evening-walk"])).toBe(
      "evening-walk",
    );
    // A deleted branch (or a hand edit) opens the committed model, quietly.
    expect(resolveActiveScenario("gone", ["evening-walk"])).toBeNull();
    expect(resolveActiveScenario("gone", [])).toBeNull();
  });

  test("the write is a read-modify-write through the one file", () => {
    const activeSource = source("../src/scenarios/active.ts");
    const body = activeSource.slice(
      activeSource.indexOf("export async function saveWorkspaceScenario"),
    );
    expect(body).toContain("readTextFile(path)");
    expect(body).toContain("withScenario(base, scenario)");
    expect(body).toContain("writeMachineFile(path,");
    // The scaffold stands in only when the file reads empty, so the format key
    // is never dropped.
    expect(body).toContain("workspaceYml()");
  });
});

describe("the switch: one queued write, and restore never writes", () => {
  function fake(initial: string | null = null) {
    const switched: Array<{ branch: string | null; cause: ScenarioCause }> = [];
    const saved: Array<string | null> = [];
    const deps: ScenarioHandoffDeps = {
      onSwitch: (branch, cause) => switched.push({ branch, cause }),
      save: async (branch) => {
        saved.push(branch);
      },
    };
    const handoff = createScenarioHandoff(initial, deps);
    return { handoff, switched, saved };
  }

  test("a deliberate pick switches, then writes the hint", async () => {
    const f = fake();
    f.handoff.choose("evening-walk");
    expect(f.switched).toEqual([
      { branch: "evening-walk", cause: "choose" },
    ]);
    expect(f.handoff.active()).toBe("evening-walk");
    await f.handoff.idle();
    expect(f.saved).toEqual(["evening-walk"]);
  });

  test("switching back to the committed model writes the absence", async () => {
    const f = fake("evening-walk");
    f.handoff.choose(null);
    expect(f.switched).toEqual([{ branch: null, cause: "choose" }]);
    await f.handoff.idle();
    expect(f.saved).toEqual([null]);
  });

  test("picking the branch already running is a quiet no-op", async () => {
    const f = fake("evening-walk");
    f.handoff.choose("evening-walk");
    await f.handoff.idle();
    expect(f.switched).toEqual([]);
    expect(f.saved).toEqual([]);
  });

  test("restore sets the branch and writes NOTHING", async () => {
    const f = fake();
    f.handoff.restore("evening-walk");
    expect(f.switched).toEqual([
      { branch: "evening-walk", cause: "restore" },
    ]);
    expect(f.handoff.active()).toBe("evening-walk");
    await f.handoff.idle();
    expect(f.saved).toEqual([]);
  });

  test("retiring the RUNNING branch switches to the map first", async () => {
    const f = fake("evening-walk");
    f.handoff.retire("evening-walk");
    expect(f.switched).toEqual([{ branch: null, cause: "retire" }]);
    await f.handoff.idle();
    // The hint stops naming the folder BEFORE the app deletes it.
    expect(f.saved).toEqual([null]);
  });

  test("retiring ANOTHER branch changes nothing here", async () => {
    const f = fake("evening-walk");
    f.handoff.retire("someone-elses");
    expect(f.switched).toEqual([]);
    await f.handoff.idle();
    expect(f.saved).toEqual([]);
    expect(f.handoff.active()).toBe("evening-walk");
  });

  test("two quick switches land in order (one queue, one file)", async () => {
    const order: Array<string | null> = [];
    const queue = createWriteQueue();
    const handoff = createScenarioHandoff(
      null,
      {
        onSwitch: () => undefined,
        save: async (branch) => {
          // A slow first read-modify-write must not let the second overtake it.
          if (branch === "first") {
            await new Promise<void>((resolve) => setTimeout(resolve, 15));
          }
          order.push(branch);
        },
      },
      queue,
    );
    handoff.choose("first");
    handoff.choose("second");
    await handoff.idle();
    expect(order).toEqual(["first", "second"]);
  });

  test("the handoff owns no second queue: it takes the workspace's", () => {
    const handoffSource = source("../src/scenarios/handoff.ts");
    expect(handoffSource).toContain("queue: WriteQueue = createWriteQueue()");
    expect(handoffSource).toContain("RESTORE NEVER WRITES");
    expect(handoffSource).toContain("The queue is the LEVEL handoff's when the app shares");
  });
});

describe("the app's one branch switch path", () => {
  const appSource = source("../src/App.tsx");

  test("ONE write call site, and the queue workspace.yml is shared", () => {
    expect(appSource.match(/saveWorkspaceScenario\(/g)?.length).toBe(1);
    // workspace.yml has ONE queue in the app: created once, handed to both
    // handoffs (the level's and the branch's).
    expect(appSource.match(/createWriteQueue\(\)/g)?.length).toBe(1);
    expect(appSource).toContain("createLevelHandoff(");
    expect(appSource).toContain("createScenarioHandoff(");
    expect(appSource).toContain("workspaceQueue,");
    expect(appSource).toContain("workspaceQueueRef.current");
  });

  test("the switch runs the full path and honors the level pin", () => {
    const body = callbackBody(appSource, "switchScenario");
    expect(body).toContain("setScenario(next);");
    // A restore runs no switch path and writes nothing.
    expect(body).toContain('if (cause === "restore") return;');
    expect(body).toContain("cancelPendingGestures();");
    expect(body).toContain("setWalkSlug(null);");
    // The pin: closing the transients may remove a focused field without a
    // focusout, so the held level crossing is applied in the same move.
    expect(body).toContain("releasePin();");
  });

  test("open-restore reads the hint and resolves it against the folders", () => {
    expect(appSource).toContain("workspace.resumeScenario");
    expect(appSource).toContain("resolveActiveScenario(");
    expect(appSource).toContain("scenarioHandoff.restore(");
    expect(appSource).toContain("listScenarios(workspace.path)");
    // The restore never reaches the save: that is the deps' job, and it is
    // wired to the handoff's ONE write trigger.
    expect(appSource).toContain("saveWorkspaceScenario(workspace.path, next)");
  });

  test("the chooser's moves are the handoff's, and a branch is coined by the person", () => {
    expect(callbackBody(appSource, "chooseScenario")).toContain(
      "scenarioHandoff.choose(slug)",
    );
    const branch = callbackBody(appSource, "branchModel");
    // The branch module copies the COMMITTED model itself (ADR-0021 decision 6).
    expect(branch).toContain("createScenario(workspace.path, name)");
    // The new branch becomes the running one: the move the person just made.
    expect(branch).toContain("scenarioHandoff.choose(created.slug)");
  });

  test("retirement deletes the folder after the hint has stopped naming it", () => {
    const body = callbackBody(appSource, "retireBranch");
    expect(body).toContain("scenarioHandoff.retire(slug)");
    expect(body.indexOf("await scenarioHandoff.idle();")).toBeGreaterThan(-1);
    expect(body.indexOf("retireScenario(workspace.path, slug)")).toBeGreaterThan(
      body.indexOf("await scenarioHandoff.idle();"),
    );
  });

  test("lifecycle reads the hint on open and never writes it", () => {
    const lifecycleSource = source("../src/workspace/lifecycle.ts");
    expect(lifecycleSource).toContain("resumeScenario");
    expect(lifecycleSource).toContain("scenarioOf(fields)");
    expect(lifecycleSource).not.toContain("saveWorkspaceScenario");
  });
});
