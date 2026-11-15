import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BAND_ZOOM, DYNAMICS_FROM, GROUND_FROM } from "../src/canvas/zoomBands";
import { createWriteQueue } from "../src/lib/writeQueue";
import { DEFAULT_LEVEL, type Level } from "../src/workspace/level";
import {
  createLevelHandoff,
  type HandoffCause,
  type LevelHandoffDeps,
} from "../src/workspace/levelHandoff";

/**
 * The strict handoff (ADR-0018 decision 2), automated: the zoom BAND is the
 * game and the `level` key is the resume hint. ONE write trigger serves exactly
 * two causes — a settled zoom crossing (d3's `end`) and a deliberate jump — and
 * it goes through the workspace's in-order write queue, so two quick crossings
 * can never interleave their read-modify-writes. Open-restore moves the camera
 * and writes NOTHING, so a hand-edited key is honored on open and rewritten
 * only on the first settled crossing.
 *
 * The physical wiring is asserted at the source seam the app runs: d3's `end`
 * reports the settled zoom, centering defaults to the band's landing zoom, and
 * a word's click passes no hard-coded 100%. The window's feel is the human
 * check.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A handoff with recording dependencies — no DOM, no fs. */
function fake(
  initial: Level = DEFAULT_LEVEL,
  hooks: { save?: (level: Level) => Promise<void> } = {},
) {
  const switched: Array<{ level: Level; cause: HandoffCause }> = [];
  const moved: Level[] = [];
  const saved: Level[] = [];
  const deps: LevelHandoffDeps = {
    onSwitch: (level, cause) => switched.push({ level, cause }),
    moveCamera: (level) => moved.push(level),
    save: async (level) => {
      saved.push(level);
      if (hooks.save) await hooks.save(level);
    },
  };
  const handoff = createLevelHandoff(initial, deps);
  return { handoff, switched, moved, saved };
}

describe("a settled zoom crossing writes the key", () => {
  test("the wheel crossing concept -> dynamics switches and writes", async () => {
    const f = fake("concept");
    f.handoff.settle(DYNAMICS_FROM + 0.01);
    expect(f.switched).toEqual([{ level: "dynamics", cause: "settle" }]);
    // A settle never moves the camera: the person's gesture left it where it is.
    expect(f.moved).toEqual([]);
    expect(f.handoff.level()).toBe("dynamics");
    await f.handoff.idle();
    expect(f.saved).toEqual(["dynamics"]);
  });

  test("crossing to ground writes ground", async () => {
    const f = fake("concept");
    f.handoff.settle(GROUND_FROM + 0.2);
    expect(f.switched).toEqual([{ level: "ground", cause: "settle" }]);
    await f.handoff.idle();
    expect(f.saved).toEqual(["ground"]);
  });

  test("a settle that stays in the band writes nothing", async () => {
    const f = fake("concept");
    f.handoff.settle(BAND_ZOOM.concept);
    f.handoff.settle(0.3);
    await f.handoff.idle();
    expect(f.switched).toEqual([]);
    expect(f.saved).toEqual([]);
    expect(f.handoff.level()).toBe("concept");
  });

  test("panning (a settle with the same zoom) writes nothing", async () => {
    const f = fake("dynamics");
    f.handoff.settle(BAND_ZOOM.dynamics);
    await f.handoff.idle();
    expect(f.saved).toEqual([]);
  });
});

describe("a deliberate jump moves the camera and writes the key", () => {
  test("the jumper lands in the band and writes it", async () => {
    const f = fake("concept");
    f.handoff.jump("ground");
    expect(f.moved).toEqual(["ground"]);
    expect(f.switched).toEqual([{ level: "ground", cause: "jump" }]);
    expect(f.handoff.level()).toBe("ground");
    await f.handoff.idle();
    expect(f.saved).toEqual(["ground"]);
  });

  test("jumping to the running game only moves the camera (no write)", async () => {
    const f = fake("concept");
    f.handoff.jump("concept");
    expect(f.moved).toEqual(["concept"]);
    expect(f.switched).toEqual([]);
    await f.handoff.idle();
    expect(f.saved).toEqual([]);
  });
});

describe("open-restore NEVER writes", () => {
  test("the key sets the camera into its band and writes nothing", async () => {
    const f = fake(DEFAULT_LEVEL);
    f.handoff.restore("ground");
    expect(f.moved).toEqual(["ground"]);
    expect(f.switched).toEqual([{ level: "ground", cause: "restore" }]);
    expect(f.handoff.level()).toBe("ground");
    await f.handoff.idle();
    expect(f.saved).toEqual([]);
  });

  test("restoring the game already running still sets the band, still writes nothing", async () => {
    const f = fake(DEFAULT_LEVEL);
    f.handoff.restore("concept");
    expect(f.moved).toEqual(["concept"]);
    expect(f.switched).toEqual([]);
    await f.handoff.idle();
    expect(f.saved).toEqual([]);
  });

  test("a hand-edited key is honored on open and rewritten only on the first crossing", async () => {
    // The file says ground (hand-edited): open honors it and writes nothing.
    const f = fake(DEFAULT_LEVEL);
    f.handoff.restore("ground");
    await f.handoff.idle();
    expect(f.saved).toEqual([]);
    expect(f.handoff.level()).toBe("ground");

    // A settle inside ground agrees with the key: still nothing written.
    f.handoff.settle(BAND_ZOOM.ground);
    await f.handoff.idle();
    expect(f.saved).toEqual([]);

    // The first settled crossing writes the band it crossed into.
    f.handoff.settle(BAND_ZOOM.concept);
    await f.handoff.idle();
    expect(f.saved).toEqual(["concept"]);
  });
});

describe("the writes are queued in order (one trigger, no read-modify-write race)", () => {
  test("a slow write holds the next one; the file ends on the latest game", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    let first = true;
    const f = fake("concept", {
      save: async () => {
        if (!first) return;
        first = false;
        await gate;
      },
    });

    f.handoff.jump("ground");
    f.handoff.settle(BAND_ZOOM.concept); // a second crossing, back to concept
    await Promise.resolve(); // let the first task start
    expect(f.saved).toEqual(["ground"]); // the second is still waiting

    release();
    await f.handoff.idle();
    expect(f.saved).toEqual(["ground", "concept"]);
  });

  test("a failed write never stalls the next crossing", async () => {
    const f = fake("concept", {
      save: async (level) => {
        if (level === "dynamics") throw new Error("disk");
      },
    });
    f.handoff.jump("dynamics");
    f.handoff.jump("ground");
    await f.handoff.idle();
    expect(f.saved).toEqual(["dynamics", "ground"]);
    expect(f.handoff.level()).toBe("ground");
  });
});

describe("the write queue itself", () => {
  test("tasks run one at a time, in the order queued", async () => {
    const queue = createWriteQueue();
    const order: number[] = [];
    const task = (n: number, ms: number) => async () => {
      await sleep(ms);
      order.push(n);
    };
    const first = queue.push(task(1, 12));
    const second = queue.push(task(2, 1));
    const third = queue.push(task(3, 0));
    await Promise.all([first, second, third]);
    expect(order).toEqual([1, 2, 3]);
    await queue.idle();
  });

  test("a rejected task rejects its own promise but the queue moves on", async () => {
    const queue = createWriteQueue();
    const done: string[] = [];
    const failed = queue.push(async () => {
      throw new Error("disk");
    });
    const after = queue.push(async () => {
      done.push("after");
    });
    await expect(failed).rejects.toThrow("disk");
    await after;
    await queue.idle(); // idle never rejects
    expect(done).toEqual(["after"]);
  });
});

describe("the physical wiring", () => {
  const source = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8");

  test("d3's end reports the settled zoom to the app", () => {
    const planeSource = source("../src/canvas/CanvasPlane.tsx");
    expect(planeSource).toContain('.on("end.');
    expect(planeSource).toContain("onZoomSettleRef.current?.(event.transform.k)");
    expect(planeSource).toContain("onZoomSettle?: (zoom: number) => void");
  });

  test("centering defaults to the current band's landing zoom", () => {
    const planeSource = source("../src/canvas/CanvasPlane.tsx");
    expect(planeSource).toContain("centeringZoom(camera.zoom)");
  });

  test("a word's click-to-center passes no hard-coded 100%", () => {
    const wordSource = source("../src/canvas/ReferenceWord.tsx");
    expect(wordSource).toContain("centerOn(at.x, at.y)");
    expect(wordSource).not.toContain("centerOn(position.x + el.offsetWidth / 2");
    expect(wordSource).not.toContain("}, 1)");
  });

  test("the camera has the band intent the jumper and the restore share", () => {
    const cameraSource = source("../src/canvas/useCamera.ts");
    expect(cameraSource).toContain("setZoomBand");
    expect(cameraSource).toContain("DEFAULT_CAMERA_ZOOM");
    expect(cameraSource).not.toContain("zoom: 1 }");
  });

  test("the level control jumps instead of switching directly", () => {
    const controlSource = source("../src/canvas/LevelControl.tsx");
    expect(controlSource).toContain("onJump(game)");
    expect(controlSource).toContain("aria-pressed={level === game}");
    expect(controlSource).toContain('role="group"');
    // A control never writes: the handoff's queued trigger does.
    expect(controlSource).not.toContain("saveWorkspaceLevel");
  });
});
