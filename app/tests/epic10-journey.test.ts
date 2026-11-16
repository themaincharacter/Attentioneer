import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BOX } from "../src/canvas/geometry";
import {
  findOrphanAssumptions,
  parseAssumptions,
  serializeAssumptionLine,
  serializeAssumptions,
  type Assumption,
} from "../src/map/assumptions";
import { loopSlug, parseLoops } from "../src/map/loops";
import { parseMarks, serializeMarks, type Mark } from "../src/map/marks";
import { parseModel, serializeModel } from "../src/map/model";
import {
  parseReference,
  referencesDir,
  serializeReference,
  type Reference,
} from "../src/map/refs";
import {
  nameVeil,
  parseVeils,
  serializeVeils,
  type Veil,
} from "../src/map/veils";
import { sha256Hex } from "../src/ghost/digest";
import {
  GHOST_FORMAT,
  GHOST_KEYS,
  readEnvelope,
  serializeEnvelope,
  type GhostEnvelope,
} from "../src/ghost/envelope";
import {
  INBOX_DIR,
  inboxEnvelopePath,
  inboxMarkerPath,
} from "../src/ghost/inbox";
import { ghostRows } from "../src/ghost/list";
import {
  PACKET_LIMIT,
  PACKET_POSTURE,
  packetWordOf,
  veilPlacementOf,
  type Packet,
  type PacketView,
  type PacketWord,
  type PersonRegion,
} from "../src/ghost/packet";
import { previewOf, previewPoint, stepViews } from "../src/ghost/preview";
import {
  ADD_ASSUMPTION,
  ASSUMPTIONS_FILE,
  MOVES,
  registryDescription,
  registryHash,
} from "../src/ghost/registry";
import {
  PACKET_REQUEST_KEYS,
  askForPacket,
  type AskResult,
  type PacketRequest,
} from "../src/ghost/request";
import {
  RESHAPE_FIELDS,
  reshapeFields,
  textOf,
  withReason,
  withText,
} from "../src/ghost/reshape";
import {
  createGhostSession,
  type GhostContext,
  type GhostSession,
} from "../src/ghost/session";
import {
  NO_GHOSTS,
  acceptOpened,
  beginReshapeDraft,
  commitReshape,
  intakeReply,
  openGhost,
  rejectOpened,
  type GhostState,
  type GhostVerbDeps,
} from "../src/ghost/verbs";
import { agentsMd, canonicalJson } from "../src/lib/serialize";
import {
  agentReply,
  readFiledEnvelope,
  tracedFs,
  withWorkspace,
  type Workspace,
} from "./ghost-harness";

/**
 * Epic 10's plain-language check, automated at the RECORD layer (story 4).
 *
 * The locked check (Epic 10 check and slice, its Answer) runs in the real
 * window as the queued human pass (the eighth). This file walks its RECORD
 * half through the ghost modules and the files' bytes only, in the check's
 * own order:
 *
 *   THE SETUP: a small dynamics map with an accepted set (rain and soil in
 *   play, the far storm outside it), a standing claim, a named loop, one mark
 *   and TWO REAL VEILS whose reasons must never ride a packet.
 *   (a) THE PERSON'S REGION: the person picks the words; the same request
 *   against two selections freezes two different packets. The request cannot
 *   choose the region - structurally (its key set, the assembler's separate
 *   person argument, the region rule's own source) and behaviourally (a
 *   smuggled key changes no byte).
 *   (b) THE PACKET'S HONESTY: it states its own limit; it never summarizes
 *   what it left out, never counts a remainder, carries no inbox path and
 *   never a veil's reason (presence, name and location only).
 *   (c) THE FROZEN TRIPLE: the bytes + the base pin read at the ask + the
 *   DERIVED registry hash, and one hash over the three.
 *   (d) THE INTAKE: a pasted reply wraps, validates and lands in the quiet
 *   list; a refusal files nothing at all.
 *   (e) THE GHOST CYCLE: the list is text only (absence-scanned); the preview
 *   appears only when the person opens it; reshape edits the params and a
 *   reason of the person's own, and the deriver re-shows the steps with the
 *   five fields in flight only; accept is the crash-ordered
 *   marker -> apply -> delete and writes the line EXACTLY as shown; reject
 *   leaves the map as before. Every workspace file is scanned after the
 *   accept: no reason, no packet hash, no reshape field, no certainty label.
 *   (f) THE NEGATIVE SPACE: no count, age or unread mark anywhere; the packet
 *   never reads the inbox; nothing renders while a proposal is merely held.
 *
 * THE STORY'S TWO SCANS: the retired phrases stay retired (ADR-0004's
 * JSON-Patch direction, and the scaffold's old "shown faintly" ghost line) and
 * the acceptance story's crash ordering is pinned in the source.
 *
 * THE JUDGE'S VERDICT IS NOT A TEST LEG: the two task texts, the packet hash
 * and accept/reshape-with-reason belong to the JOURNAL; this file asserts only
 * the ABSENCE of any label of how right a claim is, and the expansion
 * protocol's registry gate (one move).
 *
 * NAMED FOLLOW-UPS (recorded, not fixed here):
 *   1. The real-window human pass, the ghost UI's feel, the judge's legs and
 *      the cheap-model protocol are QUEUED (the eighth pass); this file is the
 *      record half only.
 *   2. The ghost's grammar is not wired to authoringLive: it checks the
 *      dynamics band but NOT that a playing set was accepted, while ADR-0025
 *      calls add-assumption the MOST gated move (Level 2, behind the set).
 *      Every ghost fixture since story 1 intakes without a set, so threading
 *      the set into the snapshot is a source change larger than this story;
 *      named here, never frozen as correct.
 *   3. The ask surface still leaves the person's region unwired (story 3's
 *      provisional list): the ADR's fallback applies in the window, while the
 *      region rule itself is exercised here.
 *
 * Provisional: the ghost's looks (list/preview/reshape/ask), the envelope's
 * wording, and the packet's wording/section order.
 */

const NL = "\n";
const CONTEXT: GhostContext = { level: "dynamics", scenario: null };
const REQUEST: PacketRequest = {
  move: { family: "assumption", verb: "add" },
  target: { kind: "word", slug: "rain" },
};
const CLAIM_TEXT = "rain follows the soil's temperature";
const RESHAPED_TEXT = "rain follows the soil's temperature and the slope";

const VEIL_NAME = "the wet corner";
const VEIL_REASON =
  "VEIL-REASON-SECRET: the two words move together and I cannot say how";
const FAR_VEIL_NAME = "far cover";
const FAR_VEIL_REASON = "VEIL-REASON-FAR: not now, the storm is elsewhere";
const LOOP_NAME = "the water cycle";
const LOOP_CLAIM = "the cycle turns twice a day";
const STORM_CLAIM = "OUTSIDE-CLAIM the far storm runs hard";

const RAIN_MARK: Mark = {
  kind: "open",
  target: { type: "word", slug: "rain" },
  extra: { note: "MARK-ON-RAIN" },
};
const STORM_MARK: Mark = {
  kind: "open",
  target: { type: "word", slug: "storm" },
  extra: { note: "OUTSIDE-MARK" },
};

interface Fixture {
  /** The map's records as the app loads them (PacketView). */
  view: PacketView;
  /** The assumptions file's bytes before the ghost writes anything. */
  base: string;
}

/** Stage the check's map over the ghost harness's real-filesystem workspace. */
function stage(scratch: Workspace): Fixture {
  // The seed carries rain, soil, the loop and one standing claim. Grow it by
  // a far word (outside the region), two marks and two REAL veils.
  const storm: Reference = {
    id: "storm",
    slug: "storm",
    name: "the far storm",
    x: 900,
    y: 600,
    body: "",
    extra: {},
  };
  scratch.write("map/references/storm.md", serializeReference(storm));
  scratch.write(
    "map/model.json",
    serializeModel({ words: ["rain", "soil"], extra: {} }),
  );
  scratch.write(
    "map/marks.jsonl",
    serializeMarks([RAIN_MARK, STORM_MARK]),
  );

  const seedClaim: Assumption = {
    text: "the soil holds water",
    target: { type: "word", slug: "soil" },
    extra: {},
  };
  const loopClaim: Assumption = {
    text: LOOP_CLAIM,
    target: { type: "loop", slug: loopSlug(LOOP_NAME) },
    extra: {},
  };
  const stormClaim: Assumption = {
    text: STORM_CLAIM,
    target: { type: "word", slug: "storm" },
    extra: {},
  };
  scratch.write(
    "map/assumptions.jsonl",
    serializeAssumptions([seedClaim, loopClaim, stormClaim]),
  );

  let veils: Veil[] = nameVeil(
    [],
    VEIL_NAME,
    { x: -40, y: -40, w: 200, h: 120 },
    VEIL_REASON,
  );
  veils = nameVeil(
    veils,
    FAR_VEIL_NAME,
    { x: 850, y: 550, w: 200, h: 100 },
    FAR_VEIL_REASON,
  );
  scratch.write("map/veils.jsonl", serializeVeils(veils));

  return {
    view: loadView(scratch),
    base: scratch.read(ASSUMPTIONS_FILE) ?? "",
  };
}

/** The app's own loading of the records into the packet's view (App.tsx). */
function loadView(scratch: Workspace): PacketView {
  const dir = referencesDir(scratch.path);
  const words: PacketWord[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const slug = name.slice(0, -3);
    const text = scratch.read("map/references/" + name);
    if (text === null) continue;
    const word = packetWordOf(
      parseReference(slug, slug, text),
      DEFAULT_BOX,
    );
    if (word !== null) words.push(word);
  }
  const model = parseModel(scratch.read("map/model.json")).model;
  return {
    words,
    playing: model?.words ?? [],
    marks: parseMarks(scratch.read("map/marks.jsonl") ?? "").marks,
    claims: parseAssumptions(scratch.read("map/assumptions.jsonl") ?? "")
      .assumptions,
    loops: parseLoops(scratch.read("map/loops.jsonl") ?? "").loops,
    veils: parseVeils(scratch.read("map/veils.jsonl") ?? "").veils,
  };
}

/** A test body over a fresh staged workspace (always disposed). */
async function withJourney<T>(
  body: (scratch: Workspace, fixture: Fixture) => Promise<T> | T,
): Promise<T> {
  return withWorkspace((scratch) => body(scratch, stage(scratch)));
}

/** The one ask, for this check's move and target. */
function ask(
  scratch: Workspace,
  fixture: Fixture,
  overrides: { request?: PacketRequest; person?: PersonRegion } = {},
): Promise<AskResult> {
  return askForPacket({
    workspacePath: scratch.path,
    fs: scratch.fs,
    context: CONTEXT,
    request: overrides.request ?? REQUEST,
    person: overrides.person ?? { selection: null },
    view: fixture.view,
  });
}

/** Ask and require a packet (the refusal tests assert the other branch). */
async function packetOf(
  scratch: Workspace,
  fixture: Fixture,
  selection: readonly string[] | null,
): Promise<Packet> {
  const result = await ask(scratch, fixture, { person: { selection } });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected a packet");
  return result.packet;
}

function sessionOver(scratch: Workspace, fs = scratch.fs): GhostSession {
  return createGhostSession({ workspacePath: scratch.path, fs });
}

function depsOf(session: GhostSession): GhostVerbDeps {
  return { session, context: () => CONTEXT };
}

/** File one reply and hand back the state it left (nothing opened). */
async function file(
  deps: GhostVerbDeps,
  state: GhostState,
  reply: string = agentReply({ target: { kind: "word", slug: "rain" } }),
): Promise<GhostState> {
  const report = await intakeReply(deps, state, reply);
  expect(report.result.ok).toBe(true);
  return report.state;
}

/** Every file under a folder, relative to it (the absence walks). */
function walkFiles(root: string, base = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

/** Every workspace file's bytes, keyed by its relative path. */
function snapshotFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of walkFiles(root)) {
    files[file] = readFileSync(join(root, file), "utf8");
  }
  return files;
}

/** The packet's prose with every run of whitespace collapsed (wrap-proof). */
function flat(bytes: string): string {
  return bytes.replace(/\s+/g, " ").trim();
}

/** The preview's word readings (the app's loaded words). */
function previewWords(view: PacketView) {
  return view.words.map((word) => ({
    slug: word.slug,
    pos: { x: word.x, y: word.y },
    box: word.box,
  }));
}

/** The preview's loop readings (the coined name's place is not used here). */
function previewLoops(view: PacketView) {
  return view.loops.map((loop) => ({
    slug: loopSlug(loop.name),
    nameAt: { x: 0, y: 0 },
  }));
}

/* ------------------------------------------------------------------------- *
 * The app's own source, read once: the story's claims are about the shipped
 * text as much as about the records.
 * ------------------------------------------------------------------------- */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const SOURCES = walkFiles(SRC)
  .filter(
    (path) =>
      path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".css"),
  )
  .map((path) => ({
    path: path.split(sep).join("/"),
    source: readFileSync(join(SRC, path), "utf8"),
  }));

function sourceOf(path: string): string {
  const found = SOURCES.find((entry) => entry.path === path);
  if (found === undefined) throw new Error("no source at " + path);
  return found.source;
}

const APP = sourceOf("App.tsx");

/* ========================================================================= *
 * 1. The setup: the map the check starts from.
 * ========================================================================= */

describe("the setup: the map the check starts from", () => {
  test("an accepted set, a far word, a loop, one mark and two real veils", () => {
    return withJourney((scratch, fixture) => {
      expect(fixture.view.words.map((word) => word.slug).sort()).toEqual([
        "rain",
        "soil",
        "storm",
      ]);
      expect(fixture.view.playing).toEqual(["rain", "soil"]);
      expect(fixture.view.loops.map((loop) => loopSlug(loop.name))).toEqual([
        loopSlug(LOOP_NAME),
      ]);
      expect(fixture.view.marks).toHaveLength(2);
      expect(fixture.view.claims.map((claim) => claim.text)).toEqual([
        "the soil holds water",
        LOOP_CLAIM,
        STORM_CLAIM,
      ]);
      // The two veils carry REAL reasons on disk; the packet has not run yet.
      expect(fixture.view.veils).toHaveLength(2);
      expect(scratch.read("map/veils.jsonl")).toContain(VEIL_REASON);
      expect(scratch.read("map/veils.jsonl")).toContain(FAR_VEIL_REASON);
      // The records round-trip; the inbox does not exist before an ask.
      expect(parseMarks(scratch.read("map/marks.jsonl") ?? "").malformed).toEqual(
        [],
      );
      expect(
        parseAssumptions(scratch.read(ASSUMPTIONS_FILE) ?? "").malformed,
      ).toEqual([]);
      expect(scratch.exists(".attentioneer")).toBe(false);
    });
  });
});

/* ========================================================================= *
 * 2. (a) The person's region, and the negative.
 * ========================================================================= */

describe("the person's region: the selection wins, the request cannot curate", () => {
  test("the same request against two selections freezes two different packets", async () => {
    await withJourney(async (scratch, fixture) => {
      const one = await ask(scratch, fixture, {
        person: { selection: ["rain"] },
      });
      const two = await ask(scratch, fixture, {
        person: { selection: ["rain", "soil"] },
      });
      expect(one.ok && two.ok).toBe(true);
      if (!one.ok || !two.ok) return;

      expect(one.packet.region).toEqual({
        slugs: ["rain"],
        source: "the person's selection",
      });
      expect(two.packet.region).toEqual({
        slugs: ["rain", "soil"],
        source: "the person's selection",
      });
      expect(one.packet.freeze.bytes).not.toBe(two.packet.freeze.bytes);
      expect(one.packet.freeze.hash).not.toBe(two.packet.freeze.hash);
      expect(one.packet.freeze.bytes).toContain("### a word: rain (the target)");
      expect(one.packet.freeze.bytes).not.toContain("### a word: soil");
      expect(two.packet.freeze.bytes).toContain("### a word: soil");
      // Only the region moved: the same base froze both.
      expect(one.packet.freeze.pin).toEqual(two.packet.freeze.pin);
      expect(one.packet.freeze.registry).toBe(two.packet.freeze.registry);
    });
  });

  test("the request cannot choose the region (structural and behavioural)", async () => {
    await withJourney(async (scratch, fixture) => {
      const clean = await packetOf(scratch, fixture, ["rain"]);
      const smuggled = {
        ...REQUEST,
        region: ["storm"],
        selection: ["storm"],
        words: ["storm"],
        records: ["storm"],
        view: fixture.view,
      } as unknown as PacketRequest;
      const dirty = await ask(scratch, fixture, {
        request: smuggled,
        person: { selection: ["rain"] },
      });
      expect(dirty.ok).toBe(true);
      if (!dirty.ok) return;
      expect(dirty.packet.freeze.bytes).toBe(clean.freeze.bytes);
      expect(dirty.packet.freeze.hash).toBe(clean.freeze.hash);

      // The ask's keys are exactly the move and the target.
      expect(PACKET_REQUEST_KEYS).toEqual(["move", "target"]);
      for (const key of PACKET_REQUEST_KEYS) {
        expect(key).not.toMatch(/region|words|selection|records|view/i);
      }
      // The surface hands the person's own region over SEPARATELY, and the
      // assembler's region rule reads the person, never the request.
      const requestSource = sourceOf("ghost/request.ts");
      expect(requestSource).toContain("person: options.person");
      expect(requestSource).toContain("options.person.selection");
      expect(requestSource).not.toMatch(/selection\s*:/);
      const packetSource = sourceOf("ghost/packet.ts");
      const ruleStart = packetSource.indexOf("export function regionOf(");
      const ruleEnd = packetSource.indexOf("\n}", ruleStart);
      const rule = packetSource.slice(ruleStart, ruleEnd);
      expect(rule).toContain("person.selection");
      expect(rule).not.toContain("request");
    });
  });

  test("with no selection the fallback is the named target plus the playing set", async () => {
    await withJourney(async (scratch, fixture) => {
      const fallback = await packetOf(scratch, fixture, null);
      expect(fallback.region).toEqual({
        slugs: ["rain", "soil"],
        source: "the named target and the playing set",
      });
      // A named target outside the playing set is still carried.
      const outside = await ask(scratch, fixture, {
        request: {
          move: REQUEST.move,
          target: { kind: "word", slug: "storm" },
        },
      });
      expect(outside.ok).toBe(true);
      if (!outside.ok) return;
      expect(outside.packet.region.slugs).toEqual(["rain", "soil", "storm"]);
      expect(outside.packet.freeze.bytes).toContain("### a word: the far storm");
    });
  });

  test("a target outside the chosen region is refused, never widened", async () => {
    await withJourney(async (scratch, fixture) => {
      const base = scratch.read(ASSUMPTIONS_FILE);
      const refused = await ask(scratch, fixture, {
        person: { selection: ["soil"] },
      });
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.issues.map((entry) => entry.code)).toContain("region");
      // Nothing was frozen and nothing was written.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(base);
      expect(scratch.exists(".attentioneer")).toBe(false);
    });
  });
});

/* ========================================================================= *
 * 3. (b) The packet's honesty negatives (with REAL veil reasons in play).
 * ========================================================================= */

describe("the packet's honesty: its limit, and no summary of what it left out", () => {
  test("the limit sentence rides; no remainder, no count, no inbox path", async () => {
    await withJourney(async (scratch, fixture) => {
      const packet = await packetOf(scratch, fixture, ["rain"]);
      const bytes = packet.freeze.bytes;
      expect(bytes).toContain(PACKET_LIMIT);
      expect(flat(bytes)).toContain(PACKET_POSTURE);
      // The map holds records outside the region; none rides, and nothing
      // describes them either (no summary, no remainder, no count).
      for (const marker of [
        "OUTSIDE-CLAIM",
        "OUTSIDE-MARK",
        "the far storm",
        "tide",
        FAR_VEIL_NAME,
        VEIL_REASON,
        FAR_VEIL_REASON,
        LOOP_CLAIM,
      ]) {
        expect({ marker, present: bytes.includes(marker) }).toEqual({
          marker,
          present: false,
        });
      }
      for (const phrase of [
        "and others",
        "remaining",
        "left out",
        "omitted",
        "not shown",
        "excluded",
        "the rest",
        "summary",
      ]) {
        expect({ phrase, present: bytes.toLowerCase().includes(phrase) }).toEqual({
          phrase,
          present: false,
        });
      }
      expect(bytes).not.toMatch(
        /\b\d+\s+(more|others?|records?|words?|claims?|marks?|veils?|loops?)\b/i,
      );
      expect(bytes).not.toMatch(/\.attentioneer/);
      expect(bytes.toLowerCase()).not.toContain("inbox");
    });
  });

  test("a veil rides as presence, name and location only - its reason never", async () => {
    await withJourney(async (scratch, fixture) => {
      const packet = await packetOf(scratch, fixture, ["rain"]);
      const bytes = packet.freeze.bytes;
      // The wet corner covers rain: its name and box ride.
      expect(bytes).toContain("name: " + JSON.stringify(VEIL_NAME));
      expect(bytes).toContain("location: x -40, y -40, w 200, h 120");
      // The REASON never rides; the far veil covers only the storm, which is
      // outside the region, so even its name does not.
      expect(bytes).not.toContain(VEIL_REASON);
      expect(bytes).not.toContain(FAR_VEIL_REASON);
      expect(bytes).not.toContain(FAR_VEIL_NAME);
      // The placement type has no field for a reason or for covered content.
      const placement = veilPlacementOf(fixture.view.veils[0]);
      expect(Object.keys(placement).sort()).toEqual(["location", "name"]);
      expect(JSON.stringify(placement)).not.toContain(VEIL_REASON);
    });
  });

  test("the packet never reads the inbox: an envelope there changes no byte", async () => {
    await withJourney(async (scratch, fixture) => {
      const before = await packetOf(scratch, fixture, ["rain"]);
      // Plant a filed envelope in the disposable inbox with a loud marker.
      scratch.write(
        ".attentioneer/inbox/ghost-planted.json",
        JSON.stringify({
          format: GHOST_FORMAT,
          id: "ghost-planted",
          note: "INBOX-ENVELOPE-SECRET",
        }) + NL,
      );
      const after = await packetOf(scratch, fixture, ["rain"]);
      expect(after.freeze.bytes).toBe(before.freeze.bytes);
      expect(after.freeze.hash).toBe(before.freeze.hash);
      expect(after.freeze.bytes).not.toContain("INBOX-ENVELOPE-SECRET");
      // Pure by construction: the module imports no impure ghost seam.
      const imports = sourceOf("ghost/packet.ts").match(/from\s+"[^"]+"/g) ?? [];
      expect(imports.length).toBeGreaterThan(0);
      for (const spec of imports) {
        expect(spec).not.toMatch(/inbox|session|port|apply/);
      }
      expect(sourceOf("ghost/packet.ts")).not.toMatch(/readText|writeText/);
    });
  });
});

/* ========================================================================= *
 * 4. (c) The frozen triple: bytes + the base pin + the derived registry hash.
 * ========================================================================= */

describe("the frozen triple", () => {
  test("the pin is the base read at the ask, and the registry hash is derived", async () => {
    await withJourney(async (scratch, fixture) => {
      const packet = await packetOf(scratch, fixture, ["rain"]);
      expect(packet.freeze.pin).toEqual({
        dir: "map",
        files: { [ASSUMPTIONS_FILE]: sha256Hex(fixture.base) },
        level: "dynamics",
        game: "dynamics",
      });
      // The registry version is DERIVED from the live table, never a literal.
      expect(packet.freeze.registry).toBe(registryHash());
      expect(packet.freeze.registry).toBe(
        sha256Hex(canonicalJson(registryDescription())),
      );
      expect(packet.freeze.registry).toMatch(/^[0-9a-f]{64}$/);
      // One hash covers the whole triple.
      expect(packet.freeze.hash).toBe(
        sha256Hex(
          canonicalJson({
            bytes: packet.freeze.bytes,
            pin: packet.freeze.pin,
            registry: packet.freeze.registry,
          }),
        ),
      );
      // Frozen: the freeze cannot drift after it is named.
      expect(Object.isFrozen(packet.freeze)).toBe(true);
      expect(Object.isFrozen(packet.freeze.pin)).toBe(true);
      expect(
        Object.isFrozen(packet.freeze.pin.files as unknown as object),
      ).toBe(true);
      // Two expansion runs over the same inputs are comparable.
      const again = await packetOf(scratch, fixture, ["rain"]);
      expect(again.freeze.hash).toBe(packet.freeze.hash);
    });
  });

  test("a moved base changes the pin and the hash, never the bytes", async () => {
    await withJourney(async (scratch, fixture) => {
      const before = await packetOf(scratch, fixture, ["rain"]);
      scratch.write(
        ASSUMPTIONS_FILE,
        fixture.base + '{"on":"rain","text":"a line that landed first"}' + NL,
      );
      const after = await packetOf(scratch, fixture, ["rain"]);
      expect(after.freeze.bytes).toBe(before.freeze.bytes);
      expect(after.freeze.pin).not.toEqual(before.freeze.pin);
      expect(after.freeze.hash).not.toBe(before.freeze.hash);
      expect(after.freeze.registry).toBe(before.freeze.registry);
    });
  });
});

/* ========================================================================= *
 * 5. (d) The intake: wrap, validate, land - and a refusal files nothing.
 * ========================================================================= */

describe("the intake: a reply wraps and lands; a refusal files nothing", () => {
  test("a fenced reply wraps, validates and lands with the packet's own pin", async () => {
    await withJourney(async (scratch, fixture) => {
      const packet = await packetOf(scratch, fixture, ["rain"]);
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      const body = {
        move: { family: "assumption", verb: "add" },
        target: { kind: "word", slug: "rain" },
        params: { text: CLAIM_TEXT },
      };
      const raw = [
        "The claim I propose:",
        "",
        "```json",
        JSON.stringify(body),
        "```",
        "",
        "It states a relation the map leaves open.",
      ].join(NL);

      const report = await intakeReply(deps, NO_GHOSTS, raw);
      expect(report.result.ok).toBe(true);
      expect(report.result.issues).toEqual([]);
      expect(report.state.ghosts).toHaveLength(1);
      const envelope = report.state.ghosts[0];
      expect(envelope.format).toBe(GHOST_FORMAT);
      expect(envelope.id.startsWith("ghost-")).toBe(true);
      expect(envelope.move).toEqual({ family: "assumption", verb: "add" });
      expect(envelope.target).toEqual({ kind: "word", slug: "rain" });
      expect(envelope.params).toEqual({ text: CLAIM_TEXT });
      expect(envelope.rationale).toContain("The claim I propose:");
      expect(envelope.rationale).toContain("leaves open");
      // The SAME pin function froze the packet and minted the envelope.
      expect(envelope.expect).toEqual(packet.freeze.pin);
      expect(envelope.steps).toHaveLength(1);
      expect(envelope.proposals).toEqual([]);

      // Filed canonically under the disposable inbox; the record is untouched.
      const filed = scratch.read(
        ".attentioneer/inbox/" + envelope.id + ".json",
      );
      expect(filed).toBe(serializeEnvelope(envelope));
      expect(readEnvelope(filed ?? "").value).not.toBeNull();
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(fixture.base);
      expect(envelope.steps[0].file).toBe(ASSUMPTIONS_FILE);
      expect(envelope.steps[0].op).toBe("append");
    });
  });

  test("a refusal files nothing: no inbox, no id, no row", async () => {
    await withJourney(async (scratch, fixture) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      const refusals = [
        agentReply({ expect: {} }),
        agentReply({ params: { text: "x", name: "storm" } }),
        agentReply({ target: { kind: "word", slug: "gone" } }),
        agentReply({ target: { kind: "spot", x: 1, y: 2 } }),
        "I would add a claim about rain.",
      ];
      for (const raw of refusals) {
        const report = await intakeReply(deps, NO_GHOSTS, raw);
        expect(report.result.ok).toBe(false);
        expect(report.state).toEqual(NO_GHOSTS);
        expect(report.result.issues.length).toBeGreaterThan(0);
      }
      expect(session.registered()).toEqual([]);
      expect(scratch.exists(".attentioneer")).toBe(false);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(fixture.base);
    });
  });

  test("the envelope lives in the disposable inbox, never under map/", async () => {
    await withJourney(async (scratch) => {
      const session = sessionOver(scratch);
      const report = await intakeReply(depsOf(session), NO_GHOSTS, agentReply({
        target: { kind: "word", slug: "rain" },
      }));
      expect(report.result.ok).toBe(true);
      const id = report.state.ghosts[0].id;
      expect(INBOX_DIR).toBe(".attentioneer/inbox");
      expect(inboxEnvelopePath(scratch.path, id)).toBe(
        scratch.path + "/.attentioneer/inbox/" + id + ".json",
      );
      expect(scratch.exists("map/" + id + ".json")).toBe(false);
      // A new open moment discards it: replay is refused.
      const next = sessionOver(scratch);
      expect(await next.open()).toEqual({ envelopes: 1, markers: 0 });
      const replay = await next.accept(id, CONTEXT);
      expect(replay.outcome).toBe("not-registered");
    });
  });
});

/* ========================================================================= *
 * 6. (e) The ghost cycle, in the check's order.
 * ========================================================================= */

describe("the quiet list: text only, arrival order, nothing rendered while held", () => {
  test("the rows are the summary and the why, in arrival order", async () => {
    await withJourney(async (scratch) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = NO_GHOSTS;
      state = await file(deps, state, agentReply({ rationale: "the first why" }));
      state = await file(
        deps,
        state,
        agentReply({
          rationale: "the second why",
          params: { text: "another claim" },
        }),
      );
      const rows = ghostRows(state.ghosts, (slug) => slug);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.rationale)).toEqual([
        "the first why",
        "the second why",
      ]);
      expect(rows[0].summary).toBe('add an assumption about "rain"');
      // A row is exactly the app-minted id and the two text fields.
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(["id", "rationale", "summary"]);
      }
      // Arrival order is the intake's; nothing re-orders the rows.
      expect(rows.map((row) => row.id)).toEqual(
        state.ghosts.map((ghost) => ghost.id),
      );
    });
  });

  test("the list's words carry no tally, age, unread or ordering word", () => {
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
      expect({ module, text: scan.exec(sourceOf(module))?.[0] ?? null }).toEqual({
        module,
        text: null,
      });
    }
    // And the rendered fields: no digit, no ordering word.
    const rows = ghostRows(
      [
        {
          format: GHOST_FORMAT,
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

  test("nothing is opened and nothing draws on the plane while a ghost is held", async () => {
    await withJourney(async (scratch, fixture) => {
      const state = await file(depsOf(sessionOver(scratch)), NO_GHOSTS);
      expect(state.openId).toBe(null);
      expect(previewOf(state.ghosts, state.openId)).toBe(null);
      expect(
        previewPoint(
          state.ghosts,
          state.openId,
          previewWords(fixture.view),
          previewLoops(fixture.view),
        ),
      ).toBe(null);
    });
  });
});

describe("the person's opening: the preview appears only now", () => {
  test("open: the preview and the target point exist only inside the opening", async () => {
    await withJourney(async (scratch, fixture) => {
      const session = sessionOver(scratch);
      const held = await file(depsOf(session), NO_GHOSTS);
      const id = held.ghosts[0].id;
      const words = previewWords(fixture.view);
      const loops = previewLoops(fixture.view);
      expect(previewOf(held.ghosts, held.openId)).toBe(null);
      expect(previewPoint(held.ghosts, held.openId, words, loops)).toBe(null);

      const opened = openGhost(held, id);
      expect(opened.openId).toBe(id);
      expect(previewOf(opened.ghosts, opened.openId)).toBe(opened.ghosts[0]);
      // The faint diamond would sit at the target word's centre (at 0,0).
      expect(previewPoint(opened.ghosts, opened.openId, words, loops)).toEqual({
        x: DEFAULT_BOX.w / 2,
        y: DEFAULT_BOX.h / 2,
      });
      // The derived steps are read-only text: what, where, about what, the
      // claim verbatim, and no change (nothing was reshaped yet).
      const views = stepViews(opened.ghosts[0], null, (slug) => slug);
      expect(views).toHaveLength(1);
      expect(views[0]).toEqual({
        file: ASSUMPTIONS_FILE,
        does: "append one line to",
        about: "rain",
        text: CLAIM_TEXT,
        changed: false,
      });
    });
  });
});

describe("reshape: the five fields in flight, the steps re-derived and re-shown", () => {
  test("the draft is the five fields; a reason is required before it commits", async () => {
    await withJourney(async (scratch, fixture) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      const packet = await packetOf(scratch, fixture, ["rain"]);
      let state = await file(deps, NO_GHOSTS);
      state = openGhost(state, state.ghosts[0].id);
      state = beginReshapeDraft(state, packet.freeze.hash);
      const draft = state.draft!;
      expect(Object.keys(draft).sort()).toEqual([...RESHAPE_FIELDS].sort());
      expect(Object.keys(reshapeFields(draft)).sort()).toEqual(
        [...RESHAPE_FIELDS].sort(),
      );
      expect(draft.original).toBe(state.ghosts[0]);
      expect(draft.params).toEqual({ text: CLAIM_TEXT });
      expect(draft.reason).toBe("");
      expect(draft.expect).toEqual(packet.freeze.pin);
      expect(draft.packet).toBe(packet.freeze.hash);
      expect(textOf(draft)).toBe(CLAIM_TEXT);

      // Text but no reason: the person must say why; the ghost stays as it was.
      const withoutReason: GhostState = {
        ...state,
        draft: withText(draft, RESHAPED_TEXT),
      };
      const refused = await commitReshape(deps, withoutReason);
      expect(refused.changed).toBe(false);
      expect(refused.state).toBe(withoutReason);
      expect(refused.issues.map((issue) => issue.code)).toEqual(["reshape"]);
    });
  });

  test("committing re-derives the steps and re-files the new params on the same pin", async () => {
    await withJourney(async (scratch, fixture) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      const packet = await packetOf(scratch, fixture, ["rain"]);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      const openedWith = state.ghosts[0];
      state = openGhost(state, id);
      state = beginReshapeDraft(state, packet.freeze.hash);
      state = {
        ...state,
        draft: withReason(
          withText(state.draft!, RESHAPED_TEXT),
          "the first wording was vague",
        ),
      };
      const report = await commitReshape(deps, state);
      expect(report.changed).toBe(true);
      expect(report.issues).toEqual([]);
      // The five fields are still in flight (the reason and the ask never
      // become envelope keys); the params and the pin are the envelope's.
      expect(report.state.draft!.reason).toBe("the first wording was vague");
      expect(report.state.draft!.packet).toBe(packet.freeze.hash);
      expect(report.state.draft!.expect).toEqual(packet.freeze.pin);
      expect(report.state.ghosts[0].params).toEqual({ text: RESHAPED_TEXT });
      // The steps re-derived (the deriver owns them) and read as changed.
      const views = stepViews(report.state.ghosts[0], openedWith, (slug) => slug);
      expect(views[0].changed).toBe(true);
      expect(views[0].text).toBe(RESHAPED_TEXT);
      expect(views[0].about).toBe("rain");
      // The inbox holds the new params against the SAME pin and rationale.
      const filed = readFiledEnvelope(scratch, id);
      expect(filed.params).toEqual({ text: RESHAPED_TEXT });
      expect(filed.expect).toEqual(packet.freeze.pin);
      expect(filed.rationale).toBe(openedWith.rationale);
      expect(filed.steps[0].line).toContain(RESHAPED_TEXT);
      // The reason and the packet hash never reach the file.
      const bytes = scratch.read(".attentioneer/inbox/" + id + ".json") ?? "";
      expect(bytes).not.toContain("the first wording was vague");
      expect(bytes).not.toContain(packet.freeze.hash);
      // The record itself is untouched until the accept.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(fixture.base);
    });
  });
});

describe("accept: the crash order, and the line written exactly as shown", () => {
  test("marker -> apply -> delete, and the accepted line is the shown step", async () => {
    await withJourney(async (scratch, fixture) => {
      const traced = tracedFs(scratch.fs);
      const session = sessionOver(scratch, traced.fs);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      // Reshape first, so the accepted line is the person's own wording.
      state = openGhost(state, id);
      state = beginReshapeDraft(state, null);
      state = {
        ...state,
        draft: withReason(withText(state.draft!, RESHAPED_TEXT), "a reason"),
      };
      state = (await commitReshape(deps, state)).state;
      const shown = stepViews(state.ghosts[0], null, (slug) => slug)[0];
      expect(shown.text).toBe(RESHAPED_TEXT);
      expect(shown.about).toBe("rain");
      expect(shown.file).toBe(ASSUMPTIONS_FILE);

      traced.trace.calls.length = 0;
      traced.trace.markerAtWrite.length = 0;
      const report = await acceptOpened(deps, state);
      expect(report.outcome?.outcome).toBe("applied");
      expect(report.issues).toEqual([]);
      expect(report.state.ghosts).toEqual([]);
      expect(report.state.openId).toBe(null);
      expect(report.state.draft).toBe(null);

      // The marker lands BEFORE the write and is present while it runs; the
      // delete comes after the write.
      const marker = traced.trace.calls.indexOf("marker");
      const write = traced.trace.calls.indexOf("write");
      expect(marker).toBeGreaterThan(-1);
      expect(marker).toBeLessThan(write);
      expect(traced.trace.markerAtWrite).toEqual([true]);
      expect(write).toBeLessThan(traced.trace.calls.lastIndexOf("remove"));

      // The line on disk is EXACTLY the canonical line the step showed.
      const line = serializeAssumptionLine({
        text: RESHAPED_TEXT,
        target: { type: "word", slug: "rain" },
        extra: {},
      });
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(fixture.base + line + NL);
      const accepted = parseAssumptions(scratch.read(ASSUMPTIONS_FILE) ?? "")
        .assumptions;
      expect(accepted[accepted.length - 1].text).toBe(shown.text);
      expect(accepted[accepted.length - 1].target).toEqual({
        type: "word",
        slug: "rain",
      });

      // Nothing of the proposal remains: no envelope, no marker, no row.
      expect(scratch.exists(inboxEnvelopePath(scratch.path, id))).toBe(false);
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);
    });
  });

  test("a tampered stored step list is ignored: the deriver owns the steps", async () => {
    await withJourney(async (scratch, fixture) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      const filed = readEnvelope(
        scratch.read(".attentioneer/inbox/" + id + ".json") ?? "",
      );
      if (filed.value === null) throw new Error(filed.problems.join("; "));
      scratch.write(
        ".attentioneer/inbox/" + id + ".json",
        JSON.stringify({
          ...filed.value,
          steps: [
            {
              op: "append",
              file: "map/whatever.jsonl",
              line: '{"on":"rain","text":"a tampered claim"}',
            },
          ],
        }) + NL,
      );
      state = openGhost(state, id);
      const report = await acceptOpened(deps, state);
      expect(report.outcome?.outcome).toBe("applied");
      const derived = serializeAssumptionLine({
        text: CLAIM_TEXT,
        target: { type: "word", slug: "rain" },
        extra: {},
      });
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(fixture.base + derived + NL);
      expect(scratch.exists("map/whatever.jsonl")).toBe(false);
      expect(scratch.read(ASSUMPTIONS_FILE)).not.toContain("a tampered claim");
    });
  });

  test("after accept there is NO trace: every workspace file is scanned", async () => {
    await withJourney(async (scratch) => {
      const REASON = "because the claim reads better this way 1042";
      const PACKET_HASH = "0123456789abcdef".repeat(4);
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      state = openGhost(state, id);
      state = beginReshapeDraft(state, PACKET_HASH);
      state = {
        ...state,
        draft: withReason(withText(state.draft!, "the accepted claim"), REASON),
      };
      state = (await commitReshape(deps, state)).state;
      const report = await acceptOpened(deps, state);
      expect(report.outcome?.outcome).toBe("applied");

      // Every workspace file: no reason, no packet hash, no reshape field, no
      // certainty/confidence label key anywhere.
      const labels = [
        "certainty",
        "confidence",
        "confident",
        "probability",
        "score",
        "rating",
        "verdict",
      ];
      const labelKey = new RegExp(
        '["\'](?:' + labels.join("|") + ')["\']\\s*:',
        "i",
      );
      for (const file of walkFiles(scratch.path)) {
        const bytes = readFileSync(join(scratch.path, file), "utf8");
        expect({ file, reason: bytes.includes(REASON) }).toEqual({
          file,
          reason: false,
        });
        expect({ file, packet: bytes.includes(PACKET_HASH) }).toEqual({
          file,
          packet: false,
        });
        expect({ file, label: labelKey.exec(bytes)?.[0] ?? null }).toEqual({
          file,
          label: null,
        });
        // "reason" is the VEIL record's own prose field (map/veils.jsonl): the
        // reshape's reason is a different thing, and its VALUE is gone
        // everywhere above. The other four fields have no record home at all
        // and are absent from every file; "reason" appears only in the veil's.
        for (const field of RESHAPE_FIELDS.filter((name) => name !== "reason")) {
          expect({
            file,
            field,
            present: bytes.includes('"' + field + '"'),
          }).toEqual({ file, field, present: false });
        }
        expect({
          file,
          outsideVeils:
            bytes.includes('"reason"') && file !== "map/veils.jsonl",
        }).toEqual({ file, outsideVeils: false });
      }
      // The accepted line is the claim alone: its own keys, no more.
      const lines = (scratch.read(ASSUMPTIONS_FILE) ?? "").trim().split(NL);
      const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
      expect(last).toEqual({ on: "rain", text: "the accepted claim" });
      // The three non-envelope fields were never given a home.
      for (const field of ["original", "reason", "packet"]) {
        expect(GHOST_KEYS).not.toContain(field);
      }
    });
  });

  test("quit and reopen: nothing of the ghost survives but the accepted line", async () => {
    await withJourney(async (scratch, fixture) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      state = openGhost(state, id);
      expect((await acceptOpened(deps, state)).outcome?.outcome).toBe("applied");

      // The next open moment: the inbox is empty, the id is not the app's, and
      // the record holds only the accepted line.
      const next = sessionOver(scratch);
      expect(await next.open()).toEqual({ envelopes: 0, markers: 0 });
      expect(next.registered()).toEqual([]);
      expect((await next.accept(id, CONTEXT)).outcome).toBe("not-registered");
      const line = serializeAssumptionLine({
        text: CLAIM_TEXT,
        target: { type: "word", slug: "rain" },
        extra: {},
      });
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(fixture.base + line + NL);
      expect(scratch.exists(inboxEnvelopePath(scratch.path, id))).toBe(false);
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);
    });
  });
});

describe("reject: the map is exactly as before", () => {
  test("the row and the file go; every workspace byte is unchanged", async () => {
    await withJourney(async (scratch) => {
      const before = snapshotFiles(scratch.path);
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      const id = state.ghosts[0].id;
      state = openGhost(state, id);
      const report = await rejectOpened(deps, state);
      expect(report.rejected).toBe(true);
      expect(report.state.ghosts).toEqual([]);
      expect(report.state.openId).toBe(null);
      expect(scratch.exists(inboxEnvelopePath(scratch.path, id))).toBe(false);
      expect(scratch.exists(inboxMarkerPath(scratch.path, id))).toBe(false);
      // The map is byte-for-byte what it was (the empty inbox dir is not a
      // record; the walk sees files only).
      expect(snapshotFiles(scratch.path)).toEqual(before);
    });
  });
});

/* ========================================================================= *
 * 7. (f) The negative space, and the accepted line as an ordinary claim.
 * ========================================================================= */

describe("the negative space", () => {
  test("the ghost's surfaces carry no certainty label anywhere", () => {
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
      expect({ module, label: scan.exec(sourceOf(module))?.[0] ?? null }).toEqual({
        module,
        label: null,
      });
    }
    // App's own ghost section names none of them either.
    const start = APP.indexOf("Epic 10 story 3: the ghosts");
    const end = APP.indexOf("Epic 7 story 1 makes the playing set");
    expect(start).toBeGreaterThan(-1);
    const section = APP.slice(start, end);
    expect(section).not.toMatch(scan);
    // And no source stores a label as a JSON key.
    const labelKey = new RegExp(
      '["\'](?:' + BANNED.join("|") + ')["\']\\s*:',
      "i",
    );
    for (const entry of SOURCES) {
      expect({ path: entry.path, key: labelKey.exec(entry.source)?.[0] ?? null }).toEqual({
        path: entry.path,
        key: null,
      });
    }
  });

  test("nothing renders while a proposal is merely held (the app's one reading)", () => {
    // The only plane reading the ghost flow contributes is previewPoint, and
    // the app mounts the diamond from it alone.
    expect(APP).toContain("const ghostPoint = useMemo(");
    expect(APP).toContain("previewPoint(ghosts.ghosts, ghosts.openId");
    const diamond = APP.indexOf("<GhostDiamond");
    expect(diamond).toBeGreaterThan(-1);
    expect(APP.slice(Math.max(0, diamond - 320), diamond)).toContain(
      "ghostPoint !== null",
    );
    expect(APP.split("<GhostDiamond").length).toBe(2);
    // The preview card is mounted from the opened ghost and nothing else.
    const preview = APP.indexOf("<GhostPreview");
    expect(preview).toBeGreaterThan(-1);
    expect(APP.slice(Math.max(0, preview - 320), preview)).toContain(
      "ghosts.opened !== null",
    );
    expect(APP.split("<GhostPreview").length).toBe(2);
    expect(sourceOf("ghost/useGhosts.ts")).toContain(
      "previewOf(state.ghosts, state.openId)",
    );
  });

  test("the packet's reader never touches the inbox (source-scanned)", () => {
    const packetSource = sourceOf("ghost/packet.ts");
    expect(packetSource).not.toMatch(/\.attentioneer/);
    expect(packetSource).not.toMatch(/Math\.random|Date\.now|new Date\(/);

  });

  test("the accepted line is an ordinary assumption the family's loader reads", async () => {
    await withJourney(async (scratch, fixture) => {
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      state = openGhost(state, state.ghosts[0].id);
      expect((await acceptOpened(deps, state)).outcome?.outcome).toBe("applied");
      const parsed = parseAssumptions(scratch.read(ASSUMPTIONS_FILE) ?? "");
      expect(parsed.malformed).toEqual([]);
      expect(parsed.duplicates).toEqual([]);
      const accepted = parsed.assumptions[parsed.assumptions.length - 1];
      expect(accepted.text).toBe(CLAIM_TEXT);
      expect(accepted.extra).toEqual({});
      // An ordinary claim on a word that is on the map: not an orphan.
      const orphans = findOrphanAssumptions(
        parsed.assumptions,
        new Set(["rain", "soil", "storm"]),
        new Set(),
        new Set([loopSlug(LOOP_NAME)]),
      );
      expect(orphans).toEqual([]);
      // The family's own writer round-trips the accepted bytes.
      expect(serializeAssumptions(parsed.assumptions)).toBe(
        fixture.base +
          serializeAssumptionLine(accepted) +
          NL,
      );
    });
  });
});

/* ========================================================================= *
 * 8. The source scans: the retired phrases and the crash ordering.
 * ========================================================================= */

describe("the retired phrases stay retired", () => {
  test("ADR-0004's JSON-Patch direction leaves no dead protocol in the app", () => {
    const dead = [
      /JSON[ -]?Patch/i,
      /json-patch/i,
      /unified diff/i,
      /"op"\s*:\s*"(?:add|remove|replace)"/i,
      /\bpatch path\b/i,
      /\bindex path\b/i,
    ];
    for (const entry of SOURCES) {
      for (const pattern of dead) {
        expect({ path: entry.path, pattern: String(pattern), found: pattern.test(entry.source) }).toEqual({
          path: entry.path,
          pattern: String(pattern),
          found: false,
        });
      }
    }
    // The one step op the registry derives is the append.
    expect(
      ADD_ASSUMPTION.steps({ kind: "word", slug: "rain" }, { text: "x" })[0].op,
    ).toBe("append");
    expect(sourceOf("ghost/envelope.ts")).toContain('op: "append"');
  });

  test("the scaffold's retired ghost line stays retired: a held ghost is text", () => {
    // The old promise ("shown faintly until the user accepts") is gone from the
    // generated orientation: a held ghost draws nothing; the person opens it.
    expect(sourceOf("lib/serialize.ts")).not.toContain("shown faintly");
    const agents = agentsMd("garden");
    expect(agents).toContain("Your edits arrive as ghosts");
    expect(agents).not.toContain("shown faintly");
    expect(agents).toContain("held as text");
    expect(agents).toContain("only acceptance writes");
    expect(agents).toContain("draws nothing on the map");
    // The app says the same thing structurally: the plane draws only the
    // opened ghost's diamond.
    expect(APP).toContain('{level === "dynamics" && ghostPoint !== null && (');
  });

  test("the acceptance story's crash ordering is pinned (marker -> apply -> delete)", () => {
    const sessionSource = sourceOf("ghost/session.ts");
    // The doc states the order and the in-flight-only marker.
    expect(sessionSource).toContain("(marker -> apply -> delete)");
    expect(sessionSource).toContain("the marker is created EXCLUSIVELY");
    expect(sessionSource).toContain("Applied but unmarked");
    // Inside the accept: claim, then apply, then delete.
    const start = sessionSource.indexOf("async function acceptInner(");
    const end = sessionSource.indexOf("async function reshapeInner(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const accept = sessionSource.slice(start, end);
    const lands = accept.indexOf("// The marker lands BEFORE the write.");
    expect(lands).toBeGreaterThan(-1);
    const ordered = accept.slice(lands);
    const claim = ordered.indexOf("claimInboxMarker(");
    const apply = ordered.indexOf("applyGhost(");
    const remove = ordered.indexOf("removeInboxEnvelope(");
    expect(claim).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(apply);
    expect(apply).toBeLessThan(remove);
    // The applied-but-unmarked branch deletes without writing again.
    const reconcile = accept.slice(0, lands);
    expect(reconcile).toContain("already-applied");
    expect(reconcile).toContain("removeInboxEnvelope(");
    expect(reconcile).not.toContain("applyGhost(");
    // applyGhost reads the file it is about to replace, pin-checks THOSE bytes,
    // and only then writes.
    const applySource = sourceOf("ghost/apply.ts");
    expect(applySource.indexOf("fs.readText")).toBeLessThan(
      applySource.indexOf("fs.writeText"),
    );
    expect(applySource).toContain('sha256Hex(current ?? "")');
    expect(applySource).toContain("throw new GhostPinError(");
    expect(applySource.indexOf("throw new GhostPinError(")).toBeLessThan(
      applySource.indexOf("fs.writeText"),
    );
    // The marker is an exclusive create (the wx command), never a lock.
    expect(sourceOf("ghost/inbox.ts")).toContain("createMarkerExclusive(");
  });

  test("the expansion protocol gates the registry at one move", () => {
    // One registered move until the judge's verdict is journaled (ADR-0025/26).
    expect(MOVES).toHaveLength(1);
    expect(MOVES[0].move).toEqual({ family: "assumption", verb: "add" });
    const registrySource = sourceOf("ghost/registry.ts");
    expect(registrySource).toContain("stays at one move until");
    expect(registrySource).toContain("expansion protocol");
    // The registry version is derived, not a hand-bumped literal.
    expect(registrySource).toContain("export function registryHash");
    expect(registrySource).toContain("sha256Hex(canonicalJson(registryDescription(moves)))");
  });
});

/* ========================================================================= *
 * 9. The whole check, in the check's order (the record half, end to end).
 * ========================================================================= */

describe("the whole check, in the check's order", () => {
  test("ask, freeze, intake, list, open, reshape, accept, reject, reopen", async () => {
    await withJourney(async (scratch, fixture) => {
      // (a)-(c) The person's region freezes the packet against the base.
      const packet = await packetOf(scratch, fixture, ["rain"]);
      expect(packet.freeze.bytes).toContain(PACKET_LIMIT);
      expect(packet.freeze.pin.files[ASSUMPTIONS_FILE]).toBe(
        sha256Hex(fixture.base),
      );

      // (d) The model's reply lands in the quiet list. Nothing on the map.
      const session = sessionOver(scratch);
      const deps = depsOf(session);
      let state = await file(deps, NO_GHOSTS);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(fixture.base);
      expect(ghostRows(state.ghosts, (slug) => slug)).toHaveLength(1);

      // (e) open, reshape with a reason, accept.
      const id = state.ghosts[0].id;
      state = openGhost(state, id);
      state = beginReshapeDraft(state, packet.freeze.hash);
      state = {
        ...state,
        draft: withReason(
          withText(state.draft!, RESHAPED_TEXT),
          "the first wording was vague",
        ),
      };
      state = (await commitReshape(deps, state)).state;
      expect(stepViews(state.ghosts[0], null, (slug) => slug)[0].text).toBe(
        RESHAPED_TEXT,
      );
      const accepted = await acceptOpened(deps, state);
      expect(accepted.outcome?.outcome).toBe("applied");
      const acceptedLine = serializeAssumptionLine({
        text: RESHAPED_TEXT,
        target: { type: "word", slug: "rain" },
        extra: {},
      });
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        fixture.base + acceptedLine + NL,
      );

      // A second thing: ask, intake, reject. The map stays as the first accept
      // left it, and the rejected proposal is gone.
      const secondPacket = await packetOf(scratch, fixture, ["rain"]);
      let second = await file(
        deps,
        NO_GHOSTS,
        agentReply({ params: { text: "another claim" } }),
      );
      expect(second.ghosts).toHaveLength(1);
      second = openGhost(second, second.ghosts[0].id);
      expect((await rejectOpened(deps, second)).rejected).toBe(true);
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        fixture.base + acceptedLine + NL,
      );
      // The second ask froze the MOVED base: the accepted line is the pin's
      // new digest (the packet stays a reading of the records it was handed).
      expect(secondPacket.freeze.pin.files[ASSUMPTIONS_FILE]).toBe(
        sha256Hex(scratch.read(ASSUMPTIONS_FILE) ?? ""),
      );
      expect(secondPacket.freeze.pin).not.toEqual(packet.freeze.pin);

      // Quit, reopen: only the accepted line remains; no trace of the rest.
      const next = sessionOver(scratch);
      expect(await next.open()).toEqual({ envelopes: 0, markers: 0 });
      expect(next.registered()).toEqual([]);
      for (const file of walkFiles(scratch.path)) {
        const bytes = readFileSync(join(scratch.path, file), "utf8");
        expect({ file, reason: bytes.includes("the first wording was vague") }).toEqual({
          file,
          reason: false,
        });
      }
      const finalRows = ghostRows([], (slug) => slug);
      expect(finalRows).toEqual([]);
    });
  });
});
