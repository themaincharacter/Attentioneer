import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../src/lib/serialize";
import {
  serializeAssumptionLine,
  type Assumption,
} from "../src/map/assumptions";
import type { Loop } from "../src/map/loops";
import { serializeMarkLine, type Mark } from "../src/map/marks";
import type { Veil } from "../src/map/veils";
import { sha256Hex } from "../src/ghost/digest";
import { GHOST_KEYS } from "../src/ghost/envelope";
import { GHOST_ISSUE_CODES } from "../src/ghost/issues";
import {
  assemblePacket,
  PACKET_LIMIT,
  PACKET_POSTURE,
  regionOf,
  veilPlacementOf,
  type PacketInput,
  type PacketView,
  type PacketWord,
  type PersonRegion,
} from "../src/ghost/packet";
import {
  ADD_ASSUMPTION,
  ASSUMPTIONS_FILE,
  authorableTargetKinds,
  authoredParamKeys,
  MOVES,
  registryDescription,
  registryHash,
  targetRuleOf,
} from "../src/ghost/registry";
import {
  askForPacket,
  PACKET_REQUEST_KEYS,
  type PacketRequest,
} from "../src/ghost/request";
import type { GhostSnapshot } from "../src/ghost/snapshot";
import { withWorkspace } from "./ghost-harness";

/**
 * Epic 10 story 2 — the first move's target rules and THE CONTEXT PACKET.
 *
 * The packet is pure: these tests build the map view by hand, so the honesty
 * negatives (no summary, no count, no inbox path, no veil reason), the region
 * rule (the person's selection wins; the request cannot curate) and the frozen
 * triple (bytes + pin + the DERIVED registry hash) are asserted on real bytes.
 * The quiet request surface is exercised over the ghost harness's real
 * filesystem, so the pin is read from the file the proposal would be built
 * against.
 */

const BASE = '{"on":"soil","text":"the soil holds water"}\n';

const RAIN: PacketWord = { slug: "rain", name: "rain", x: 0, y: 0, box: { w: 80, h: 30 } };
const SOIL: PacketWord = { slug: "soil", name: "soil", x: 120, y: 0, box: { w: 80, h: 30 } };
const STORM: PacketWord = { slug: "storm", name: "storm", x: 240, y: 0, box: { w: 80, h: 30 } };
const TIDE: PacketWord = {
  slug: "tide",
  name: "the far tide",
  x: 900,
  y: 600,
  box: { w: 80, h: 30 },
};

const RAIN_MARK: Mark = { kind: "open", target: { type: "word", slug: "rain" }, extra: {} };
const TIDE_MARK: Mark = {
  kind: "open",
  target: { type: "word", slug: "tide" },
  extra: { note: "OUTSIDE-MARK" },
};

const RAIN_CLAIM: Assumption = {
  text: "rain pools where the soil is thin",
  target: { type: "word", slug: "rain" },
  extra: {},
};
const TIDE_CLAIM: Assumption = {
  text: "OUTSIDE-CLAIM the far tide runs hard",
  target: { type: "word", slug: "tide" },
  extra: {},
};
const LOOP: Loop = { name: "the water cycle", path: ["rain", "soil", "rain"], extra: {} };
const LOOP_CLAIM: Assumption = {
  text: "the cycle turns twice a day",
  target: { type: "loop", slug: "the-water-cycle" },
  extra: {},
};

const STORM_VEIL: Veil = {
  name: "storm cover",
  x: 200,
  y: -20,
  w: 120,
  h: 80,
  reason: "VEIL-REASON-SECRET",
  extra: {},
};
const FAR_VEIL: Veil = {
  name: "far cover",
  x: 850,
  y: 550,
  w: 200,
  h: 100,
  reason: "VEIL-REASON-FAR",
  extra: {},
};

function view(overrides: Partial<PacketView> = {}): PacketView {
  return {
    words: [RAIN, SOIL, STORM, TIDE],
    playing: ["rain", "soil"],
    marks: [RAIN_MARK, TIDE_MARK],
    claims: [RAIN_CLAIM, TIDE_CLAIM, LOOP_CLAIM],
    loops: [LOOP],
    veils: [STORM_VEIL, FAR_VEIL],
    ...overrides,
  };
}

function snapshot(overrides: Partial<GhostSnapshot> = {}): GhostSnapshot {
  return {
    level: "dynamics",
    scenario: null,
    dir: "map",
    playing: ["rain", "soil"],
    words: new Set(["rain", "soil", "storm", "tide"]),
    loops: new Set(["the-water-cycle"]),
    files: { [ASSUMPTIONS_FILE]: BASE },
    ...overrides,
  };
}

function input(overrides: Partial<PacketInput> = {}): PacketInput {
  return {
    entry: ADD_ASSUMPTION,
    target: { kind: "word", slug: "rain" },
    person: { selection: null },
    view: view(),
    snapshot: snapshot(),
    ...overrides,
  };
}

/** The packet's prose with every run of whitespace collapsed (a wrap-proof read). */
function flat(bytes: string): string {
  return bytes.replace(/\s+/g, " ").trim();
}

/** The record headings the packet carries (one per record, nothing else). */
function headings(bytes: string): string[] {
  return bytes.match(/^### .*$/gm) ?? [];
}

describe("the registry: the move's target rules", () => {
  test("one target, one prose field, and word/loop only", () => {
    expect(ADD_ASSUMPTION.targetCount).toBe(1);
    expect(authoredParamKeys(ADD_ASSUMPTION)).toEqual(["text"]);
    expect(authorableTargetKinds(ADD_ASSUMPTION)).toEqual(["word", "loop"]);
    for (const entry of MOVES) expect(entry.targetCount).toBe(1);
  });

  test("a spot is refused as uncheckable and a link as crossing the branch seam", () => {
    const spot = targetRuleOf(ADD_ASSUMPTION, "spot");
    expect(spot).not.toBeNull();
    expect(spot!.allowed).toBe(false);
    expect(spot!.refusal).toContain("spot");
    expect(spot!.refusal).toContain("checked");

    const link = targetRuleOf(ADD_ASSUMPTION, "link");
    expect(link).not.toBeNull();
    expect(link!.allowed).toBe(false);
    expect(link!.refusal).toContain("branch seam");

    // A kind the record grammar does not know is not a rule at all.
    expect(targetRuleOf(ADD_ASSUMPTION, "word")).not.toBeNull();
    expect(targetRuleOf(ADD_ASSUMPTION, "word")!.allowed).toBe(true);
  });
});

describe("the region: the person's selection wins", () => {
  test("a selection IS the region — the fallback never widens it", () => {
    const region = regionOf(
      { kind: "word", slug: "rain" },
      { selection: ["storm", "rain"] },
      view(),
    );
    expect(region.source).toBe("the person's selection");
    expect(region.slugs).toEqual(["rain", "storm"]);
    const packet = assemblePacket(
      input({ person: { selection: ["storm", "rain"] } }),
    );
    expect(packet.region).toEqual(region);
    // soil is in the playing set and tide is on the map: neither is selected.
    expect(packet.freeze.bytes).toContain("### a word: storm");
    expect(packet.freeze.bytes).not.toContain("### a word: soil");
    expect(packet.freeze.bytes).not.toContain("### a word: the far tide");
  });

  test("with no selection the region is the named target plus the playing set", () => {
    const region = regionOf(
      { kind: "word", slug: "rain" },
      { selection: null },
      view(),
    );
    expect(region.source).toBe("the named target and the playing set");
    expect(region.slugs).toEqual(["rain", "soil"]);

    // A named target outside the playing set is still carried.
    const outside = regionOf(
      { kind: "word", slug: "storm" },
      { selection: null },
      view(),
    );
    expect(outside.slugs).toEqual(["rain", "soil", "storm"]);
  });

  test("a loop target's fallback is the playing set, and the loop rides", () => {
    const packet = assemblePacket(
      input({ target: { kind: "loop", slug: "the-water-cycle" } }),
    );
    expect(packet.region.slugs).toEqual(["rain", "soil"]);
    expect(packet.freeze.bytes).toContain("### a loop: the water cycle (the target)");
  });

  test("the request cannot choose the region (a smuggled key is ignored)", () => {
    const smuggled = {
      selection: null,
      region: ["storm"],
      words: ["storm"],
      records: ["storm"],
    } as unknown as PersonRegion;
    expect(regionOf({ kind: "word", slug: "rain" }, smuggled, view())).toEqual(
      regionOf({ kind: "word", slug: "rain" }, { selection: null }, view()),
    );
    // The ask's own keys say it too: a request has no region-shaped key.
    expect(PACKET_REQUEST_KEYS).toEqual(["move", "target"]);
    for (const key of PACKET_REQUEST_KEYS) {
      expect(key).not.toMatch(/region|words|selection|records|view/);
    }
    // And a smuggled region on the packet input changes nothing.
    const clean = assemblePacket(input());
    const dirty = assemblePacket(
      input({ person: { selection: null }, ...({ region: ["storm"] } as object) }),
    );
    expect(dirty.freeze.hash).toBe(clean.freeze.hash);
  });

  test("the negative: the same request against another selection", () => {
    const first = assemblePacket(input({ person: { selection: ["rain"] } }));
    const second = assemblePacket(
      input({ person: { selection: ["rain", "soil"] } }),
    );
    expect(first.freeze.bytes).not.toBe(second.freeze.bytes);
    expect(first.freeze.hash).not.toBe(second.freeze.hash);
    expect(first.freeze.bytes).toContain("### a word: rain");
    expect(first.freeze.bytes).not.toContain("### a word: soil");
    expect(second.freeze.bytes).toContain("### a word: soil");
    // The base is the same, so only the region moved.
    expect(first.freeze.pin).toEqual(second.freeze.pin);
  });

  test("a selected slug the map does not carry is not a record", () => {
    const region = regionOf(
      { kind: "word", slug: "rain" },
      { selection: ["rain", "gone", "storm"] },
      view(),
    );
    expect(region.slugs).toEqual(["rain", "storm"]);
    expect(region.source).toBe("the person's selection");
  });

  test("the region is stable: order and duplicates do not change the bytes", () => {
    const ordered = assemblePacket(
      input({ person: { selection: ["rain", "storm"] } }),
    );
    const shuffled = assemblePacket(
      input({ person: { selection: ["storm", "rain", "rain"] } }),
    );
    expect(shuffled.freeze.bytes).toBe(ordered.freeze.bytes);
    expect(shuffled.region.slugs).toEqual(["rain", "storm"]);
  });
});

describe("the packet: records, not tokens", () => {
  test("each record rides verbatim: its slug, its coined name, its mark line, its claim line", () => {
    const packet = assemblePacket(input({ person: { selection: ["rain"] } }));
    const bytes = packet.freeze.bytes;
    expect(bytes).toContain("### a word: rain (the target)");
    expect(bytes).toContain("slug: rain");
    expect(bytes).toContain('name: "rain"');
    expect(bytes).toContain("in play: yes");
    expect(bytes).toContain(serializeMarkLine(RAIN_MARK));
    expect(bytes).toContain(serializeAssumptionLine(RAIN_CLAIM));
    expect(bytes).toContain("claims on it:");
  });

  test("a record with no marks and no claims says so, and keeps its in-play reading", () => {
    const packet = assemblePacket(
      input({
        target: { kind: "word", slug: "storm" },
        person: { selection: ["storm"] },
      }),
    );
    const bytes = packet.freeze.bytes;
    expect(bytes).toContain("### a word: storm (the target)");
    expect(bytes).toContain("in play: no");
    expect(bytes).toContain("marks:\nnone");
    expect(bytes).toContain("claims on it:\nnone");
  });

  test("a loop target carries its own path and its own claims", () => {
    const packet = assemblePacket(
      input({ target: { kind: "loop", slug: "the-water-cycle" } }),
    );
    const bytes = packet.freeze.bytes;
    expect(bytes).toContain("### a loop: the water cycle (the target)");
    expect(bytes).toContain("slug: the-water-cycle");
    expect(bytes).toContain('name: "the water cycle"');
    expect(bytes).toContain("path: rain -> soil -> rain");
    expect(bytes).toContain(serializeAssumptionLine(LOOP_CLAIM));
  });

  test("the packet states its own limit and the family's posture", () => {
    const packet = assemblePacket(input());
    expect(packet.freeze.bytes).toContain(PACKET_LIMIT);
    expect(flat(packet.freeze.bytes)).toContain(PACKET_POSTURE);
    expect(flat(packet.freeze.bytes)).toContain("This view; the map is larger.");
    // The move section is the registry's shape and params schema (data).
    expect(packet.freeze.bytes).toContain("family: assumption");
    expect(packet.freeze.bytes).toContain("verb: add");
    expect(packet.freeze.bytes).toContain("game: dynamics");
    expect(packet.freeze.bytes).toContain("authors: text");
    expect(packet.freeze.bytes).toContain("targets: one of word, loop");
  });

  test("no summary of what the packet left out, no count, no inbox path", () => {
    const packet = assemblePacket(
      input({ person: { selection: ["rain"] } }),
    );
    const bytes = packet.freeze.bytes;
    // The map holds records outside the region; none of them rides, and
    // nothing describes them either (no summary, no remainder, no count).
    for (const marker of [
      "OUTSIDE-CLAIM",
      "OUTSIDE-MARK",
      "the far tide",
      "tide",
      "far cover",
      "VEIL-REASON-SECRET",
      "VEIL-REASON-FAR",
    ]) {
      expect(bytes).not.toContain(marker);
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
      expect(bytes.toLowerCase()).not.toContain(phrase);
    }
    expect(bytes).not.toMatch(/\b\d+\s+(more|others?|records?|words?|claims?|marks?|veils?|loops?)\b/i);
    expect(bytes).not.toMatch(/\.attentioneer/);
    expect(bytes.toLowerCase()).not.toContain("inbox");
  });

  test("the record bound: the packet carries the region's records and nothing else", () => {
    const region = regionOf({ kind: "word", slug: "rain" }, { selection: null }, view());
    const packet = assemblePacket(input());
    expect(packet.region).toEqual(region);
    expect(headings(packet.freeze.bytes)).toHaveLength(region.slugs.length);

    // A map that grows outside the region leaves the packet byte-identical: the
    // bound is the region's RECORDS, never the map's size or a token budget.
    const extraWords: PacketWord[] = [];
    const extraMarks: Mark[] = [];
    const extraClaims: Assumption[] = [];
    for (let n = 0; n < 40; n += 1) {
      const slug = "far-" + n;
      extraWords.push({
        slug,
        name: "FAR-WORD-" + n,
        x: 5000 + n * 10,
        y: 5000,
        box: { w: 80, h: 30 },
      });
      extraMarks.push({
        kind: "open",
        target: { type: "word", slug },
        extra: { note: "OUTSIDE-MARK-" + n },
      });
      extraClaims.push({
        text: "OUTSIDE-CLAIM-" + n,
        target: { type: "word", slug },
        extra: {},
      });
    }
    const grown = view({
      words: [...view().words, ...extraWords],
      marks: [...view().marks, ...extraMarks],
      claims: [...view().claims, ...extraClaims],
      loops: [
        ...view().loops,
        { name: "the far loop", path: ["far-0", "far-1", "far-0"], extra: {} },
      ],
      veils: [
        ...view().veils,
        {
          name: "far field",
          x: 4000,
          y: 4000,
          w: 4000,
          h: 4000,
          reason: "VEIL-REASON-FIELD",
          extra: {},
        },
      ],
    });
    const big = assemblePacket(input({ view: grown }));
    expect(big.freeze.bytes).toBe(packet.freeze.bytes);
    expect(headings(big.freeze.bytes)).toHaveLength(region.slugs.length);
    expect(big.freeze.bytes).not.toContain("FAR-WORD-0");
    expect(big.freeze.bytes).not.toContain("VEIL-REASON-FIELD");
  });
});

describe("a veil rides as presence, name and location only", () => {
  test("the reason never rides, and the placement has no field for it", () => {
    const packet = assemblePacket(input({ person: { selection: ["storm"] } }));
    const bytes = packet.freeze.bytes;
    expect(bytes).toContain('name: "storm cover"');
    expect(bytes).toContain("location: x 200, y -20, w 120, h 80");
    expect(bytes).not.toContain("VEIL-REASON-SECRET");
    // The far veil covers a word outside the region: it does not ride.
    expect(bytes).not.toContain("far cover");
    expect(bytes).not.toContain("VEIL-REASON-FAR");

    const placement = veilPlacementOf(STORM_VEIL);
    expect(Object.keys(placement).sort()).toEqual(["location", "name"]);
    expect(Object.keys(placement.location).sort()).toEqual(["h", "w", "x", "y"]);
    expect(JSON.stringify(placement)).not.toContain("VEIL-REASON-SECRET");
  });

  test("a veil entry never enumerates what it covers", () => {
    const packet = assemblePacket(input({ person: { selection: ["storm"] } }));
    const bytes = packet.freeze.bytes;
    const start = bytes.indexOf("## Veils over this view");
    const end = bytes.indexOf("## How records are carried");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = bytes.slice(start, end);
    expect(section).toContain('name: "storm cover"');
    // The entry is presence, name and location: no record headings, no slug
    // lines, no word list — the covered word rides as the region's own record.
    expect(section).not.toContain("### ");
    expect(section).not.toContain("slug: ");
    expect(section).not.toContain("rain");
    expect(section).not.toContain("tide");
    expect(section).not.toContain("word");
  });

  test("no veil over the region says so, without describing what is covered", () => {
    const packet = assemblePacket(input({ person: { selection: ["rain"] } }));
    expect(packet.freeze.bytes).toContain("No veil covers a word in this view.");
    expect(packet.freeze.bytes).not.toContain("storm cover");
  });
});

describe("the frozen triple: bytes + pin + the derived registry hash", () => {
  test("the pin is the envelope's expect, read off the base bytes", () => {
    const packet = assemblePacket(input());
    expect(packet.freeze.pin).toEqual({
      dir: "map",
      files: { [ASSUMPTIONS_FILE]: sha256Hex(BASE) },
      level: "dynamics",
      game: "dynamics",
    });
  });

  test("the registry version is DERIVED from the table, never hand-bumped", () => {
    const packet = assemblePacket(input());
    expect(packet.freeze.registry).toBe(registryHash());
    expect(registryHash()).toBe(sha256Hex(canonicalJson(registryDescription())));
    // A second row, or an edited boundary, is a different registry.
    const second = { ...ADD_ASSUMPTION, move: { family: "loop", verb: "add" } };
    expect(registryHash([...MOVES, second])).not.toBe(registryHash());
    expect(
      registryHash([{ ...ADD_ASSUMPTION, boundary: "a different boundary" }]),
    ).not.toBe(registryHash());
    // The hash is a function of the live table, not a literal anywhere.
    expect(packet.freeze.registry).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the packet hash covers the whole triple", () => {
    const packet = assemblePacket(input());
    expect(packet.freeze.hash).toBe(
      sha256Hex(
        canonicalJson({
          bytes: packet.freeze.bytes,
          pin: packet.freeze.pin,
          registry: packet.freeze.registry,
        }),
      ),
    );
    expect(packet.freeze.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the bytes are canonical, and the freeze is frozen", () => {
    const packet = assemblePacket(input());
    const bytes = packet.freeze.bytes;
    expect(bytes.endsWith("\n")).toBe(true);
    expect(bytes.endsWith("\n\n")).toBe(false);
    expect(bytes).not.toContain("\r");
    expect(Object.isFrozen(packet.freeze)).toBe(true);
    expect(Object.isFrozen(packet.freeze.pin)).toBe(true);
    expect(Object.isFrozen(packet.freeze.pin.files)).toBe(true);
    expect(() => {
      (packet.freeze as unknown as { hash: string }).hash = "tampered";
    }).toThrow();
    expect(() => {
      (packet.freeze.pin.files as unknown as Record<string, string>)[
        ASSUMPTIONS_FILE
      ] = "tampered";
    }).toThrow();
  });

  test("two expansion runs are comparable: same inputs, same triple", () => {
    const first = assemblePacket(input());
    const second = assemblePacket(input());
    expect(first.freeze.bytes).toBe(second.freeze.bytes);
    expect(first.freeze.pin).toEqual(second.freeze.pin);
    expect(first.freeze.registry).toBe(second.freeze.registry);
    expect(first.freeze.hash).toBe(second.freeze.hash);
  });

  test("another base pin changes the freeze, and the bytes stay put", () => {
    const movedBase = BASE + '{"on":"rain","text":"a newer claim"}\n';
    const before = assemblePacket(input());
    const after = assemblePacket(
      input({ snapshot: snapshot({ files: { [ASSUMPTIONS_FILE]: movedBase } }) }),
    );
    expect(after.freeze.bytes).toBe(before.freeze.bytes);
    expect(after.freeze.pin).not.toEqual(before.freeze.pin);
    expect(after.freeze.hash).not.toBe(before.freeze.hash);
  });
});

describe("the behavioral boundary: what the move does, never the validator's keys", () => {
  test("the boundary carries no issue code and no envelope key", () => {
    const boundary = ADD_ASSUMPTION.boundary;
    expect(boundary).toContain("Add one claim");
    for (const code of GHOST_ISSUE_CODES) {
      expect(boundary).not.toMatch(new RegExp("\\b" + code + "\\b"));
    }
    for (const key of GHOST_KEYS) {
      expect(boundary).not.toMatch(new RegExp("\\b" + key + "\\b"));
    }
  });

  test("the packet's boundary is the registry's own data", () => {
    const clean = assemblePacket(input());
    expect(flat(clean.freeze.bytes)).toContain(ADD_ASSUMPTION.boundary);
    const changed = assemblePacket(
      input({
        entry: {
          ...ADD_ASSUMPTION,
          boundary: "Add one small thing. Nothing else changes.",
        },
      }),
    );
    expect(changed.freeze.bytes).toContain("Add one small thing.");
    expect(changed.freeze.bytes).not.toContain("a name is the person's to coin");
  });
});

describe("the quiet request: the person asks through one surface", () => {
  const CONTEXT = { level: "dynamics" as const, scenario: null };

  function request(overrides: Partial<PacketRequest> = {}): PacketRequest {
    return {
      move: { family: "assumption", verb: "add" },
      target: { kind: "word", slug: "rain" },
      ...overrides,
    };
  }

  test("an ask freezes a packet against the real base and writes nothing", async () => {
    await withWorkspace(async (scratch) => {
      const base = scratch.read(ASSUMPTIONS_FILE);
      const result = await askForPacket({
        workspacePath: scratch.path,
        fs: scratch.fs,
        context: CONTEXT,
        request: request(),
        person: { selection: ["rain", "soil"] },
        view: view(),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.packet.freeze.pin.files[ASSUMPTIONS_FILE]).toBe(
        sha256Hex(base ?? ""),
      );
      expect(result.packet.region.source).toBe("the person's selection");
      // Nothing was written: no record, no scratch area, no marker.
      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(base);
      expect(scratch.exists(".attentioneer")).toBe(false);
    });
  });

  test("the same request against another selection freezes another packet", async () => {
    await withWorkspace(async (scratch) => {
      const options = {
        workspacePath: scratch.path,
        fs: scratch.fs,
        context: CONTEXT,
        request: request(),
        view: view(),
      };
      const one = await askForPacket({ ...options, person: { selection: ["rain"] } });
      const two = await askForPacket({
        ...options,
        person: { selection: ["rain", "soil"] },
      });
      expect(one.ok && two.ok).toBe(true);
      if (!one.ok || !two.ok) return;
      expect(one.packet.freeze.bytes).not.toBe(two.packet.freeze.bytes);
      expect(one.packet.freeze.hash).not.toBe(two.packet.freeze.hash);
      expect(one.packet.freeze.pin).toEqual(two.packet.freeze.pin);
    });
  });

  test("a smuggled request key changes nothing (the request cannot curate)", async () => {
    await withWorkspace(async (scratch) => {
      const options = {
        workspacePath: scratch.path,
        fs: scratch.fs,
        context: CONTEXT,
        person: { selection: ["rain"] },
        view: view(),
      };
      const clean = await askForPacket({ ...options, request: request() });
      const dirty = await askForPacket({
        ...options,
        request: {
          ...request(),
          region: ["tide"],
          selection: ["tide"],
          words: ["tide"],
        } as unknown as PacketRequest,
      });
      expect(clean.ok && dirty.ok).toBe(true);
      if (!clean.ok || !dirty.ok) return;
      expect(dirty.packet.freeze.bytes).toBe(clean.packet.freeze.bytes);
      expect(dirty.packet.freeze.hash).toBe(clean.packet.freeze.hash);
    });
  });

  test("the refusals happen before anything is frozen", async () => {
    await withWorkspace(async (scratch) => {
      const options = {
        workspacePath: scratch.path,
        fs: scratch.fs,
        context: CONTEXT,
        person: { selection: null },
        view: view(),
      };
      const unregistered = await askForPacket({
        ...options,
        request: request({ move: { family: "assumption", verb: "delete" } }),
      });
      expect(unregistered.ok).toBe(false);
      if (!unregistered.ok) {
        expect(unregistered.issues.map((entry) => entry.code)).toContain(
          "unregistered-move",
        );
      }

      const spot = await askForPacket({
        ...options,
        request: request({ target: { kind: "spot", x: 1, y: 2 } }),
      });
      expect(spot.ok).toBe(false);
      if (!spot.ok) {
        expect(spot.issues.map((entry) => entry.code)).toContain("refused-target");
        expect(spot.issues[0].message).toContain("spot");
      }

      const link = await askForPacket({
        ...options,
        request: request({ target: { kind: "link", from: "rain", to: "soil" } }),
      });
      expect(link.ok).toBe(false);
      if (!link.ok) {
        expect(link.issues[0].message).toContain("branch seam");
      }

      const wrongGame = await askForPacket({
        ...options,
        context: { level: "concept", scenario: null },
        request: request(),
      });
      expect(wrongGame.ok).toBe(false);
      if (!wrongGame.ok) {
        expect(wrongGame.issues.map((entry) => entry.code)).toContain("game");
      }

      const branch = await askForPacket({
        ...options,
        context: { level: "dynamics", scenario: "storm" },
        request: request(),
      });
      expect(branch.ok).toBe(false);
      if (!branch.ok) {
        expect(branch.issues.map((entry) => entry.code)).toContain("branch");
      }

      const dangling = await askForPacket({
        ...options,
        request: request({ target: { kind: "word", slug: "gone" } }),
      });
      expect(dangling.ok).toBe(false);
      if (!dangling.ok) {
        expect(dangling.issues.map((entry) => entry.code)).toContain(
          "dangling-target",
        );
      }

      // The move is about one of the person's words: a region that does not
      // carry the target is refused, never widened for them.
      const outsideRegion = await askForPacket({
        ...options,
        person: { selection: ["soil"] },
        request: request({ target: { kind: "word", slug: "rain" } }),
      });
      expect(outsideRegion.ok).toBe(false);
      if (!outsideRegion.ok) {
        expect(outsideRegion.issues.map((entry) => entry.code)).toContain(
          "region",
        );
      }
      const backToFallback = await askForPacket({
        ...options,
        person: { selection: null },
        request: request({ target: { kind: "word", slug: "rain" } }),
      });
      expect(backToFallback.ok).toBe(true);

      expect(scratch.read(ASSUMPTIONS_FILE)).toBe(
        '{"on":"soil","text":"the soil holds water"}\n',
      );
      expect(scratch.exists(".attentioneer")).toBe(false);
    });
  });
});

describe("the source: the packet's negatives are structural", () => {
  const packetSource = readFileSync(
    join(import.meta.dir, "../src/ghost/packet.ts"),
    "utf8",
  );
  const requestSource = readFileSync(
    join(import.meta.dir, "../src/ghost/request.ts"),
    "utf8",
  );

  test("the packet module imports no inbox, session, port or apply module", () => {
    const imports = packetSource.match(/from\s+"[^"]+"/g) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec).not.toMatch(/inbox|session|port|apply/);
    }
  });

  test("the packet module is deterministic (no clock, no randomness)", () => {
    expect(packetSource).not.toMatch(/Math\.random|Date\.now|new Date\(/);
  });

  test("the request surface never writes", () => {
    expect(requestSource).not.toMatch(/writeText|createMarkerExclusive|writeInbox/);
  });
});
