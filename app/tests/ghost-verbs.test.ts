import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loopSlug } from "../src/map/loops";
import { ASSUMPTIONS_FILE } from "../src/ghost/registry";
import { inboxEnvelopePath, inboxMarkerPath } from "../src/ghost/inbox";
import { GHOST_KEYS, readEnvelope, type GhostEnvelope } from "../src/ghost/envelope";
import { createGhostSession, type GhostContext } from "../src/ghost/session";
import {
  appendGhost,
  dropGhost,
  ghostRows,
  replaceGhost,
  withOpen,
} from "../src/ghost/list";
import {
  ghostTargetPoint,
  previewOf,
  previewPoint,
  stepViews,
} from "../src/ghost/preview";
import {
  RESHAPE_FIELDS,
  beginReshape,
  reshapeCandidate,
  reshapeFields,
  reshapeRefusal,
  textOf,
  withReason,
  withText,
} from "../src/ghost/reshape";
import {
  NO_GHOSTS,
  acceptOpened,
  beginReshapeDraft,
  closeGhost,
  commitReshape,
  intakeReply,
  openGhost,
  rejectOpened,
  type GhostState,
  type GhostVerbDeps,
} from "../src/ghost/verbs";
import {
  agentReply,
  readFiledEnvelope,
  tracedFs,
  withWorkspace,
  type Workspace,
} from "./ghost-harness";

/**
 * Epic 10 story 3 — the verbs, on a REAL filesystem (the story 1 harness).
 *
 * The list is text and arrival order; the preview exists only inside the
 * person's opening; reshape edits the params and a reason and the deriver
 * re-derives the steps, with the five fields in flight only; accept is the only
 * apply (the session's order and its crash story, driven through the verbs);
 * reject deletes. The absence scans (the list's words, the accepted line, the
 * story's sources) hold the negative space.
 */

const CONTEXT: GhostContext = { level: "dynamics", scenario: null };
const BASE = '{"on":"soil","text":"the soil holds water"}\n';
const CLAIM = { on: "rain", text: "rain follows the soil's temperature" };

function sessionOver(scratch: Workspace, fs = scratch.fs) {
  return createGhostSession({ workspacePath: scratch.path, fs });
}

function depsOf(session: ReturnType<typeof sessionOver>): GhostVerbDeps {
  return { session, context: () => CONTEXT };
}

function stateOf(
  ghosts: readonly GhostEnvelope[],
  openId: string | null = null,
): GhostState {
  return { ghosts, openId, draft: null };
}

/** File one reply and hand back the state it left (no opening). */
async function file(
  deps: GhostVerbDeps,
  state: GhostState,
  reply: string = agentReply(),
): Promise<GhostState> {
  const report = await intakeReply(deps, state, reply);
  return report.state;
}

/** The source of one module (the source scans read the shipped text). */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
function source(relative: string): string {
  return readFileSync(join(SRC, relative), "utf8");
}

/** Every file under a folder, relative to it (the post-accept absence walk). */
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

describe("the quiet list: text, arrival order, nothing else", () => {
  test("rows read the move and the why, in arrival order", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = NO_GHOSTS;
      state = await file(deps, state, agentReply({ rationale: "the first why" }));
      state = await file(
        deps,
        state,
        agentReply({ rationale: "the second why", params: { text: "another claim" } }),
      );
      const rows = ghostRows(state.ghosts, (slug) => slug);
      expect(rows.length).toBe(2);
      expect(rows[0].summary).toBe('add an assumption about "rain"');
      expect(rows[0].rationale).toBe("the first why");
      expect(rows[1].rationale).toBe("the second why");
      // Arrival order is the intake's: nothing re-orders the rows.
      expect(rows.map((row) => row.id)).toEqual(
        state.ghosts.map((ghost) => ghost.id),
      );
    });
  });

  test("names, not slugs: a loop's row reads the coined name", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const slug = loopSlug("the water cycle");
      const state = await file(
        depsOf(session),
        NO_GHOSTS,
        agentReply({ target: { kind: "loop", slug } }),
      );
      const rows = ghostRows(state.ghosts, (value) =>
        value === slug ? "the water cycle" : value,
      );
      expect(rows[0].summary).toBe('add an assumption about "the water cycle"');
    });
  });

  test("a reshape keeps the row's place (arrival order is not re-sorted)", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = NO_GHOSTS;
      state = await file(deps, state, agentReply({ rationale: "first" }));
      state = await file(
        deps,
        state,
        agentReply({ rationale: "second", target: { kind: "word", slug: "soil" } }),
      );
      state = await file(
        deps,
        state,
        agentReply({ rationale: "third", params: { text: "a third claim" } }),
      );
      const middle = state.ghosts[1].id;
      state = { ...state, openId: middle };
      state = beginReshapeDraft(state, null);
      state = { ...state, draft: withText(withReason(state.draft!, "why not"), "revised claim") };
      const report = await commitReshape(deps, state);
      expect(report.changed).toBe(true);
      expect(report.state.ghosts.map((ghost) => ghost.id)).toEqual(
        state.ghosts.map((ghost) => ghost.id),
      );
      expect(ghostRows(report.state.ghosts, (slug) => slug).map((row) => row.rationale)).toEqual([
        "first",
        "second",
        "third",
      ]);
    });
  });

  test("the list's words carry no tally, no date, no seen-mark, no ordering word", () => {
    // The absence scan over the module and the component that render the rows.
    const BANNED = [
      "count",
      "unread",
      "age",
      "queue",
      "next",
      "badge",
      "backlog",
      "feed",
      "tray",
      "newest",
      "oldest",
      "top",
      "pending",
      "sort",
    ];
    const scan = new RegExp("\\b(?:" + BANNED.join("|") + ")\\w*", "i");
    for (const module of ["ghost/list.ts", "canvas/GhostList.tsx"]) {
      expect({ module, text: scan.exec(source(module))?.[0] ?? null }).toEqual({
        module,
        text: null,
      });
    }
    // And the rendered rows themselves: no digits, no ordering words.
    const rows = ghostRows(
      [
        {
          format: "attentioneer-ghost/1",
          id: "ghost-1",
          move: { family: "assumption", verb: "add" },
          target: { kind: "word", slug: "rain" },
          params: { text: "a claim" },
          expect: { dir: "map", files: {}, level: "dynamics", game: "dynamics" },
          rationale: "the why",
          steps: [],
          proposals: [],
        },
      ],
      (slug) => slug,
    );
    const text = rows.map((row) => row.summary + " " + row.rationale).join(" ");
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(scan);
  });
});

describe("the one-open rule (app state)", () => {
  const A = { id: "a" } as GhostEnvelope;
  const B = { id: "b" } as GhostEnvelope;

  test("at most one ghost is opened: opening a second opens it", () => {
    expect(withOpen(null, "a")).toBe("a");
    expect(withOpen("a", "b")).toBe("b");
    expect(withOpen("a", null)).toBe(null);
    // The same opening twice is the same opening, not a toggle.
    expect(withOpen("a", "a")).toBe("a");

    const two = stateOf([A, B]);
    const openA = openGhost(two, "a");
    expect(openA.openId).toBe("a");
    const openB = openGhost(openA, "b");
    expect(openB.openId).toBe("b");
    expect(closeGhost(openB).openId).toBe(null);
  });

  test("a different opening drops the reshape in flight; the same one keeps it", () => {
    const two = stateOf([A, B], "a");
    const withDraft = beginReshapeDraft(two, "hash");
    expect(withDraft.draft).not.toBe(null);
    expect(openGhost(withDraft, "a").draft).toEqual(withDraft.draft);
    expect(openGhost(withDraft, "b").draft).toBe(null);
    expect(closeGhost(withDraft).draft).toBe(null);
  });

  test("only the opened ghost exists for the preview", () => {
    const ghosts = [{ id: "a" }, { id: "b" }] as GhostEnvelope[];
    expect(previewOf(ghosts, null)).toBe(null);
    expect(previewOf(ghosts, "a")).toBe(ghosts[0]);
    expect(previewOf(ghosts, "gone")).toBe(null);
  });
});

describe("the preview shows only what the person opened", () => {
  const words = [
    { slug: "rain", pos: { x: 0, y: 0 }, box: { w: 96, h: 28 } },
    { slug: "soil", pos: { x: 120, y: 40 }, box: { w: 96, h: 28 } },
  ];
  const loops = [{ slug: "the-water-cycle", nameAt: { x: 200, y: 200 } }];

  test("nothing on the plane while a ghost is merely held", () => {
    const ghosts = [{ id: "a", target: { kind: "word", slug: "rain" } }] as GhostEnvelope[];
    // Held: the point is null, so the app mounts no diamond.
    expect(previewPoint(ghosts, null, words, loops)).toBe(null);
    // Opened: the diamond has the target's centre (the box's middle).
    expect(previewPoint(ghosts, "a", words, loops)).toEqual({ x: 48, y: 14 });
  });

  test("a loop's target reads at its coined name; a gone target has no place", () => {
    expect(ghostTargetPoint({ kind: "loop", slug: "the-water-cycle" }, words, loops)).toEqual({
      x: 200,
      y: 200,
    });
    expect(ghostTargetPoint({ kind: "word", slug: "gone" }, words, loops)).toBe(null);
    const ghosts = [{ id: "a", target: { kind: "word", slug: "gone" } }] as GhostEnvelope[];
    expect(previewPoint(ghosts, "a", words, loops)).toBe(null);
    // A kind v1 refuses has no place either (it is never filed, but the reading
    // stays total).
    expect(ghostTargetPoint({ kind: "spot", x: 1, y: 2 }, words, loops)).toBe(null);
  });

  test("the derived steps are readable, read-only text", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const state = await file(depsOf(session), NO_GHOSTS);
      const envelope = state.ghosts[0];
      const views = stepViews(envelope, null, (slug) => "the " + slug);
      expect(views).toHaveLength(1);
      expect(views[0].does).toBe("append one line to");
      expect(views[0].file).toBe(ASSUMPTIONS_FILE);
      expect(views[0].about).toBe("the rain");
      expect(views[0].text).toBe(CLAIM.text);
      expect(views[0].changed).toBe(false);
    });
  });
});

describe("reshape: the five fields, in flight only", () => {
  test("the draft is exactly the five fields", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const state = await file(depsOf(session), NO_GHOSTS);
      const opened = state.ghosts[0];
      const draft = beginReshape(opened, "packet-hash");
      expect(Object.keys(draft).sort()).toEqual([...RESHAPE_FIELDS].sort());
      expect(Object.keys(reshapeFields(draft)).sort()).toEqual(
        [...RESHAPE_FIELDS].sort(),
      );
      expect(draft.original).toBe(opened);
      expect(draft.params).toEqual(opened.params);
      expect(draft.reason).toBe("");
      expect(draft.expect).toEqual(opened.expect);
      expect(draft.packet).toBe("packet-hash");
      expect(textOf(draft)).toBe(CLAIM.text);
    });
  });

  test("the edits are copies; the candidate never carries a stored step", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const state = await file(depsOf(session), NO_GHOSTS);
      const draft = beginReshape(state.ghosts[0], null);
      const edited = withReason(withText(draft, "a new claim"), "a reason");
      expect(textOf(draft)).toBe(CLAIM.text);
      expect(draft.reason).toBe("");
      expect(textOf(edited)).toBe("a new claim");
      expect(edited.reason).toBe("a reason");
      const candidate = reshapeCandidate(edited);
      expect(candidate.params).toEqual({ text: "a new claim" });
      expect(candidate.steps).toEqual([]);
      expect(candidate.proposals).toEqual([]);
      expect(candidate.rationale).toBe(state.ghosts[0].rationale);
    });
  });

  test("a claim needs text and a reason before the reshape commits", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const state = await file(depsOf(session), NO_GHOSTS);
      const draft = beginReshape(state.ghosts[0], null);
      // No text: the claim cannot stand.
      expect(reshapeRefusal(withReason(withText(draft, "  "), "why"))?.code).toBe(
        "params",
      );
      // Text but no reason: the person must say why they are changing it.
      expect(reshapeRefusal(withReason(draft, ""))?.code).toBe("reshape");
      expect(reshapeRefusal(withReason(withText(draft, "text"), "why"))).toBe(null);
      // The verbs refuse before the session is asked, and leave the ghost alone.
      const report = await commitReshape(depsOf(session), {
        ...stateOf(state.ghosts, state.ghosts[0].id),
        draft,
      });
      expect(report.issues.map((entry) => entry.code)).toEqual(["reshape"]);
      expect(report.changed).toBe(false);
      expect(report.state.ghosts).toEqual(state.ghosts);
    });
  });

  test("committing re-validates, re-derives and re-files the new claim", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      const before = readFiledEnvelope(scratch, id);
      state = openGhost(state, id);
      state = beginReshapeDraft(state, "packet-hash");
      state = {
        ...state,
        draft: withText(withReason(state.draft!, "a reason"), "a reshaped claim"),
      };
      const report = await commitReshape(deps, state);
      expect(report.changed).toBe(true);
      // The five fields are still in flight: the reason, the pin, the ask.
      expect(report.state.draft).not.toBe(null);
      expect(report.state.draft!.reason).toBe("a reason");
      expect(report.state.draft!.packet).toBe("packet-hash");
      expect(report.state.draft!.expect).toEqual(before.expect);
      expect(textOf(report.state.draft!)).toBe("a reshaped claim");
      // The steps re-derived (the deriver owns them) and read as changed.
      const views = stepViews(report.state.ghosts[0], before, (slug) => slug);
      expect(views[0].changed).toBe(true);
      expect(views[0].text).toBe("a reshaped claim");
      // The inbox holds the new params against the SAME pin; nothing else moved.
      const filed = readFiledEnvelope(scratch, id);
      expect(filed.params).toEqual({ text: "a reshaped claim" });
      expect(filed.expect).toEqual(before.expect);
      expect(filed.rationale).toBe(before.rationale);
      expect(filed.steps[0].line).toContain("a reshaped claim");
      // The reason and the packet hash never reach the file (in flight only).
      const bytes = scratch.read(`.attentioneer/inbox/${id}.json`) ?? "";
      expect(bytes).not.toContain("a reason");
      expect(bytes).not.toContain("packet-hash");
      // The record itself is untouched until the accept.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(BASE);
    });
  });

  test("a reshape that would duplicate a standing claim is refused with words", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      // One claim on rain first, so a second proposal on the same word could
      // only append by rewriting that line — which v1 refuses.
      let state = await file(deps, NO_GHOSTS);
      state = openGhost(state, state.ghosts[0].id);
      state = (await acceptOpened(deps, state)).state;
      // A second proposal on the same word, reshaped onto the standing claim.
      state = await file(deps, NO_GHOSTS, agentReply({ params: { text: "another rain claim" } }));
      const id = state.ghosts[0].id;
      state = openGhost(state, id);
      state = beginReshapeDraft(state, null);
      state = {
        ...state,
        draft: withText(withReason(state.draft!, "why"), CLAIM.text),
      };
      const report = await commitReshape(deps, state);
      expect(report.changed).toBe(false);
      expect(report.issues.length).toBeGreaterThan(0);
      // The session's own vocabulary: a code the app switches on, never shown.
      expect(report.issues.map((entry) => entry.code)).toContain("append-only");
      expect(report.issues[0].message.length).toBeGreaterThan(0);
      // The proposal and the record are exactly as they were.
      expect(report.state.ghosts).toEqual(state.ghosts);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        BASE + '{"on":"rain","text":"rain follows the soil\'s temperature"}\n',
      );
    });
  });
});

describe("accept is the only apply (the crash matrix through the verbs)", () => {
  test("accept applies in the session's order and leaves only the accepted line", async () => {
    await withWorkspace(async (scratch) => {
      const traced = tracedFs(scratch.fs);
      const session = sessionOver(scratch, traced.fs);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      state = openGhost(state, id);
      traced.trace.calls.length = 0;
      traced.trace.markerAtWrite.length = 0;
      const report = await acceptOpened(deps, state);
      expect(report.outcome?.outcome).toBe("applied");
      expect(report.state.ghosts).toEqual([]);
      expect(report.state.openId).toBe(null);
      expect(report.issues).toEqual([]);
      // The marker owned the write and is gone after; the proposal is deleted.
      expect(traced.trace.calls.indexOf("marker")).toBeLessThan(
        traced.trace.calls.indexOf("write"),
      );
      expect(traced.trace.markerAtWrite).toEqual([true]);
      expect(scratch.exists(inboxEnvelopePath(scratch.path, id))).toBe(false);
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);
      // Nothing but the accepted line remains of the ghost.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        BASE + '{"on":"rain","text":"rain follows the soil\'s temperature"}\n',
      );
    });
  });

  test("a stale marker never blocks the accept", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      scratch.write(`.attentioneer/inbox/${id}.marker`, "");
      state = openGhost(state, id);
      const report = await acceptOpened(deps, state);
      expect(report.outcome?.outcome).toBe("applied");
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);
      expect(scratch.read(ASSUMPTIONS_FILE)).toContain(CLAIM.text);
    });
  });

  test("applied but unmarked reconciles against the pin, and never writes twice", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      const filed = readFiledEnvelope(scratch, id);
      // The write landed, then the process died before the marker and cleanup.
      const after = BASE + filed.steps[0].line + "\n";
      scratch.write(ASSUMPTIONS_FILE, after);
      state = openGhost(state, id);
      const report = await acceptOpened(deps, state);
      expect(report.outcome?.outcome).toBe("already-applied");
      expect(report.state.ghosts).toEqual([]);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(after);
      expect(scratch.exists(inboxEnvelopePath(scratch.path, id))).toBe(false);
    });
  });

  test("a moved base refuses; the ghost stays open for the person", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      const moved = BASE + '{"on":"rain","text":"a claim that landed first"}\n';
      scratch.write(ASSUMPTIONS_FILE, moved);
      state = openGhost(state, id);
      const report = await acceptOpened(deps, state);
      expect(report.outcome?.outcome).toBe("refused");
      expect(report.issues.map((entry) => entry.code)).toContain("pin");
      // The row and the opening stay; nothing was written; no marker is left.
      expect(report.state.ghosts).toEqual(state.ghosts);
      expect(report.state.openId).toBe(id);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(moved);
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);

      // Restoring the base lets the same ghost apply.
      scratch.write(ASSUMPTIONS_FILE, BASE);
      const again = await acceptOpened(deps, report.state);
      expect(again.outcome?.outcome).toBe("applied");
    });
  });

  test("a tampered stored step list is ignored: the deriver owns the steps", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      // Hand-edit the filed envelope's step list to something else entirely.
      const read = readEnvelope(scratch.read(`.attentioneer/inbox/${id}.json`) ?? "");
      const tampered = {
        ...read.value,
        steps: [
          { op: "append", file: "map/whatever.jsonl", line: '{"on":"rain","text":"a tampered claim"}' },
        ],
      };
      scratch.write(`.attentioneer/inbox/${id}.json`, JSON.stringify(tampered) + "\n");
      state = openGhost(state, id);
      const report = await acceptOpened(deps, state);
      expect(report.outcome?.outcome).toBe("applied");
      // The derived claim landed; the tampered line and file did not.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        BASE + '{"on":"rain","text":"rain follows the soil\'s temperature"}\n',
      );
      expect(scratch.exists("map/whatever.jsonl")).toBe(false);
      expect(scratch.read(ASSUMPTIONS_FILE)).not.toContain("a tampered claim");
    });
  });

  test("accept twice: the app's second act is a no-op, the session's id is gone", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      state = openGhost(state, id);
      const first = await acceptOpened(deps, state);
      expect(first.outcome?.outcome).toBe("applied");
      const second = await acceptOpened(deps, first.state);
      expect(second.outcome).toBe(null);
      expect(second.state).toEqual(first.state);
      // The session never applies twice.
      expect((await session.accept(id, CONTEXT)).outcome).toBe("not-registered");
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        BASE + '{"on":"rain","text":"rain follows the soil\'s temperature"}\n',
      );
    });
  });

  test("another game refuses the accept and leaves the ghost held", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      state = openGhost(state, id);
      const elsewhere: GhostVerbDeps = {
        session,
        context: () => ({ level: "concept", scenario: null }),
      };
      const report = await acceptOpened(elsewhere, state);
      expect(report.outcome?.outcome).toBe("refused");
      expect(report.issues.length).toBeGreaterThan(0);
      expect(report.state.ghosts).toEqual(state.ghosts);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(BASE);
    });
  });

  test("a proposal the session does not hold is dropped, not applied", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      const held = await file(deps, NO_GHOSTS);
      // A fresh session over the same workspace: the id is not its own.
      const other = sessionOver(scratch);
      await other.open();
      const report = await acceptOpened(
        { session: other, context: () => CONTEXT },
        { ...held, openId: held.ghosts[0].id },
      );
      expect(report.outcome?.outcome).toBe("not-registered");
      expect(report.state.ghosts).toEqual([]);
      expect(report.issues.length).toBe(1);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(BASE);
    });
  });
});

describe("reject deletes the proposal and writes nothing", () => {
  test("reject drops the row and the file; the record is untouched", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      scratch.write(`.attentioneer/inbox/${id}.marker`, "");
      state = openGhost(state, id);
      const report = await rejectOpened(deps, state);
      expect(report.rejected).toBe(true);
      expect(report.state.ghosts).toEqual([]);
      expect(report.state.openId).toBe(null);
      expect(scratch.exists(inboxEnvelopePath(scratch.path, id))).toBe(false);
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(BASE);
    });
  });
});

describe("post-accept absence: nothing of the reshape survives", () => {
  test("no file in the workspace carries the reason, the ask or a reshape field", async () => {
    await withWorkspace(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      state = openGhost(state, id);
      state = beginReshapeDraft(state, "0123456789abcdef0123456789abcdef");
      state = {
        ...state,
        draft: withText(withReason(state.draft!, "because the claim reads better this way"), "the reshaped claim"),
      };
      state = (await commitReshape(deps, state)).state;
      expect(state.draft?.reason).toBe("because the claim reads better this way");
      const report = await acceptOpened(deps, state);
      expect(report.outcome?.outcome).toBe("applied");

      const files = walk(scratch.path);
      for (const file of files) {
        const bytes = readFileSync(join(scratch.path, file), "utf8");
        expect({ file, reason: bytes.includes("because the claim reads better this way") }).toEqual({
          file,
          reason: false,
        });
        expect({ file, packet: bytes.includes("0123456789abcdef0123456789abcdef") }).toEqual({
          file,
          packet: false,
        });
        for (const field of RESHAPE_FIELDS) {
          expect({ file, field, present: bytes.includes('"' + field + '"') }).toEqual({
            file,
            field,
            present: false,
          });
        }
      }
      // The accepted line is the claim alone: the record's own keys, no more.
      const line = (scratch.read(ASSUMPTIONS_FILE) ?? "").trim().split("\n").pop() ?? "";
      expect(JSON.parse(line)).toEqual({ on: "rain", text: "the reshaped claim" });
      // The three fields the envelope has no place for never become keys
      // (params and expect are the envelope's own; the draft borrows them).
      for (const field of ["original", "reason", "packet"]) {
        expect(GHOST_KEYS).not.toContain(field);
      }
    });
  });

  test("the story's sources carry no label of how right a claim is", () => {
    const BANNED = [
      "certain",
      "certainty",
      "confidence",
      "confident",
      "probably",
      "likely",
      "sure",
      "probability",
      "score",
      "rating",
      "verdict",
    ];
    const scan = new RegExp("\\b(?:" + BANNED.join("|") + ")", "i");
    const modules = [
      "ghost/list.ts",
      "ghost/preview.ts",
      "ghost/reshape.ts",
      "ghost/verbs.ts",
      "ghost/useGhosts.ts",
      "canvas/GhostList.tsx",
      "canvas/GhostDiamond.tsx",
      "canvas/GhostPreview.tsx",
      "canvas/GhostPanel.tsx",
    ];
    for (const module of modules) {
      expect({ module, label: scan.exec(source(module))?.[0] ?? null }).toEqual({
        module,
        label: null,
      });
    }
    // And App's own ghost section: the wiring mentions none of them either.
    const app = source("App.tsx");
    const start = app.indexOf("Epic 10 story 3: the ghosts");
    const end = app.indexOf("Epic 7 story 1 makes the playing set");
    expect(start).toBeGreaterThan(-1);
    const section = app.slice(start, end);
    expect(section).not.toMatch(scan);
  });
});
