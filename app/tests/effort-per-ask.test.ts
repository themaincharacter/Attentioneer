import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { effortValues, projectCatalog } from "../scripts/models-dev-catalog";
import { catalogEffortOptions } from "../src/turn/providerCatalog";
import {
  ASK_CALLS_EFFORT_CURATOR,
  askCallsWords,
  type AskCallsFacts,
} from "../src/canvas/contactRules";
import { PacketSurface } from "../src/canvas/PacketSurface";
import { AskCard } from "../src/canvas/AskCard";
import {
  parseAskLine,
  serializeAskLine,
  withAskEffort,
  type AskCard as AskCardRecord,
} from "../src/map/asks";
import {
  parseRequestLine,
  type TurnMessage,
  type TurnProvider,
} from "../src/turn/protocol";
import { providerFrom, type HttpProviderRow } from "../src/turn/providers";
import { routeOf } from "../src/turn/turn";
import { openSidecar } from "./fixtures/sidecar-pipe";
import { requestLine, parseSidecarLine, type SidecarLine } from "../src/turn/protocol";

/**
 * STORY 16.29 — EFFORT, PER ASK, ONLY WHERE THE MODEL DECLARES IT.
 *
 * The user: "We need to be able to set the effort level on the llm on the ask."
 * The values are the vendored catalogue's own per-model list (models.dev's
 * `reasoning_options` of type `effort`), the choice is the CARD's and survives
 * a reopen, and it rides the turn request as `reasoning_effort` ONLY when it is
 * not "default" (which sends no field at all). A model the catalogue gives no
 * efforts gets NO selector, and the curator call never carries one.
 *
 * Every proof here is offline: the committed export is data, the sidecar is the
 * REAL process against a LOCAL stub, and the declaration is the same pure rule
 * the card draws.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

/** The vendored export as the projection reads it. */
const EXPORT = JSON.parse(
  readFileSync(join(APP, "src", "turn", "modelsDevCatalog.json"), "utf8"),
) as {
  providers: {
    id: string;
    api: string;
    models: { id: string; effort?: string[] }[];
  }[];
};

/* ------------------------------------------------------------------ *
 * 1. The catalogue carries effort, and nothing else invents one.
 * ------------------------------------------------------------------ */

describe("the catalogue's effort values, imported rather than asserted", () => {
  test("a reasoning_options effort entry becomes the model's effort list", () => {
    expect(
      effortValues([
        { type: "toggle" },
        { type: "effort", values: ["low", "high", "max"] },
      ]),
    ).toEqual(["low", "high", "max"]);
  });

  test("no entry, an empty list or another type answers NO efforts", () => {
    expect(effortValues(undefined)).toEqual([]);
    expect(effortValues([{ type: "toggle" }])).toEqual([]);
    expect(effortValues([{ type: "effort", values: [] }])).toEqual([]);
    expect(effortValues([{ type: "budget_tokens", values: ["1024"] }])).toEqual(
      [],
    );
    // A model with none writes no key at all, so "absent" is the only empty.
    const projected = projectCatalog({
      deepseek: {
        name: "DeepSeek",
        env: ["DEEPSEEK_API_KEY"],
        api: "https://catalog.example/v1",
        models: {
          a: { id: "a", name: "A", modalities: { output: ["text"] } },
          b: {
            id: "b",
            name: "B",
            modalities: { output: ["text"] },
            reasoning_options: [{ type: "effort", values: ["low", "high"] }],
          },
        },
      },
    });
    const models = projected.providers[0]!.models;
    expect("effort" in models[0]!).toBe(false);
    expect(models[1]!.effort).toEqual(["low", "high"]);
  });

  test("the committed export's values are the catalogue's, per provider", () => {
    // The projection is read from the SAME file the app ships, so this is the
    // catalogue-only rule at its source: a provider whose models declare
    // efforts offers exactly those values and nothing else.
    const deepseek = EXPORT.providers.find((p) => p.id === "deepseek");
    expect(deepseek).toBeDefined();
    const withEffort = deepseek!.models.filter(
      (model) => (model.effort ?? []).length > 0,
    );
    expect(withEffort.length).toBeGreaterThan(0);
    for (const model of withEffort) {
      expect(
        catalogEffortOptions(deepseek!.api, model.id),
      ).toEqual(model.effort!);
    }
    // A model with no effort key offers none, even though its provider lists
    // other models with efforts.
    const bare = deepseek!.models.find((model) => model.effort === undefined);
    if (bare !== undefined) {
      expect(catalogEffortOptions(deepseek!.api, bare.id)).toEqual([]);
    }
    // An endpoint or model the catalogue does not carry offers none.
    expect(catalogEffortOptions("https://example.invalid/v1", "anything")).toEqual([]);
    expect(catalogEffortOptions(deepseek!.api, "no-such-model")).toEqual([]);
  });

  test("no module hard-codes an effort level", () => {
    // The rule is structural: the only list the card can offer is the one the
    // catalogue shipped. A literal level in a runtime module would be a claim
    // about a provider we do not maintain.
    const files = [
      "canvas/AskCard.tsx",
      "canvas/GroundLayer.tsx",
      "canvas/contactRules.ts",
      "turn/providerCatalog.ts",
      "turn/protocol.ts",
      "turn/providers.ts",
      "turn/turn.ts",
    ];
    for (const file of files) {
      const text = source(file);
      expect(text).not.toContain("\"low\", \"high\"");
      expect(text).not.toContain("['low', 'high']");
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2. The record remembers the pick, and absence means default.
 * ------------------------------------------------------------------ */

describe("the choice is remembered with the card", () => {
  const ASK: AskCardRecord = { on: "rain-q", name: "Rain", x: 1, y: 2 };

  test("an effort round-trips on the card's own line", () => {
    const withEffort = withAskEffort([ASK], ASK.on, "high");
    expect(withEffort).not.toBeNull();
    const line = serializeAskLine(withEffort![0]!);
    expect(line).toContain(' | effort: "high"');
    expect(parseAskLine(line)).toEqual({ ...ASK, effort: "high" });
    // A card that never picked one writes exactly the line it always did.
    expect(serializeAskLine(ASK)).toBe("on: rain-q | name: Rain | x: 1 | y: 2");
  });

  test("choosing default REMOVES the field, because absence is the default", () => {
    const picked = withAskEffort([ASK], ASK.on, "high")!;
    const cleared = withAskEffort(picked, ASK.on, null);
    expect(cleared).not.toBeNull();
    expect("effort" in cleared![0]!).toBe(false);
    expect(serializeAskLine(cleared![0]!)).not.toContain("effort");
  });

  test("an unknown slug writes nothing, and every other field is untouched", () => {
    expect(withAskEffort([ASK], "gone", "high")).toBeNull();
    const other: AskCardRecord = {
      ...ASK,
      anchor: "rain-gauge",
      chosenFrom: "card",
      chosen: "some words",
    };
    const picked = withAskEffort([other], ASK.on, "max")!;
    expect(picked[0]!.name).toBe("Rain");
    expect(picked[0]!.anchor).toBe("rain-gauge");
    expect(picked[0]!.chosen).toBe("some words");
  });

  test("a reopen reads the same pick: serialize then parse is the record", () => {
    const picked = withAskEffort([ASK], ASK.on, "medium")![0]!;
    const reopened = parseAskLine(serializeAskLine(picked));
    expect(reopened?.effort).toBe("medium");
  });
});

/* ------------------------------------------------------------------ *
 * 3. The wire carries it only when it is not default.
 * ------------------------------------------------------------------ */

describe("the turn request carries the effort, or sends nothing", () => {
  const ROW: HttpProviderRow = {
    kind: "http",
    id: "deepseek",
    name: "DeepSeek",
    // A loopback URL: the catalogue URL lives in the data and nowhere else.
    baseUrl: "http://127.0.0.1:8080/v1",
    models: [
      { id: "deepseek-v4-flash", name: "V4 Flash", capabilities: { tools: false, vision: false } },
    ],
  };

  test("the provider object carries the pick and the strict reader keeps it", () => {
    const provider = providerFrom(ROW, ROW.models[0]!, "k", "high");
    expect(provider.reasoningEffort).toBe("high");
    const parsed = parseRequestLine(
      requestLine(1, provider, [{ role: "user", content: "hi" }]),
    );
    expect(parsed?.kind).toBe("turn");
    if (parsed === null || parsed.kind !== "turn") throw new Error("unreachable");
    expect(parsed.provider.reasoningEffort).toBe("high");
  });

  test("default (and an absent pick) adds NO field to the provider", () => {
    for (const value of [null, undefined, "", "default", "  "]) {
      expect(
        "reasoningEffort" in providerFrom(ROW, ROW.models[0]!, "k", value),
      ).toBe(false);
    }
  });

  test("the CURATOR's route never carries one: it distils, it does not reason", () => {
    // The manager route is built with three arguments on purpose; the task
    // route is the ONLY caller that passes an effort.
    const curator = routeOf(ROW, ROW.models[0]!, "k");
    expect(curator.kind).toBe("http");
    if (curator.kind !== "http") throw new Error("unreachable");
    expect(curator.provider.reasoningEffort).toBeUndefined();
    const hook = source("canvas/useGround.ts");
    expect(hook).toContain("routeOf(manager.provider, manager.model, managerKey)");
  });
});

describe("the REAL sidecar puts reasoning_effort in the request body", () => {
  const bodies: Record<string, unknown>[] = [];
  const stub = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return Response.json({
        choices: [{ message: { role: "assistant", content: "ok" } }],
      });
    },
  });
  const pipe = openSidecar();
  afterAll(async () => {
    pipe.stop();
    stub.stop(true);
  });

  async function send(provider: TurnProvider): Promise<void> {
    const line = requestLine(1, provider, [
      { role: "user", content: "hi" },
    ] as TurnMessage[]);
    await pipe.transport.send(line);
    for (;;) {
      const parsed: SidecarLine = parseSidecarLine(await pipe.lines.next());
      if (parsed.kind === "done" || parsed.kind === "error") return;
    }
  }

  test("a pick reaches the body as reasoning_effort, unchanged", async () => {
    await pipe.hello();
    bodies.length = 0;
    await send({
      baseUrl: `http://127.0.0.1:${stub.port}/v1`,
      model: "m",
      apiKey: "",
      reasoningEffort: "high",
    });
    expect(bodies[0]!.reasoning_effort).toBe("high");
  });

  test("no pick means no reasoning_effort key at all", async () => {
    bodies.length = 0;
    await send({
      baseUrl: `http://127.0.0.1:${stub.port}/v1`,
      model: "m",
      apiKey: "",
    });
    expect("reasoning_effort" in bodies[0]!).toBe(false);
    // The stub saw both requests; the field is the ONLY difference between them.
    expect(bodies[0]!.model).toBe("m");
  });
});

/* ------------------------------------------------------------------ *
 * 4. The declaration names it on the task call, never on the distil.
 * ------------------------------------------------------------------ */

describe("the declaration names the effort in the calls section", () => {
  const TASK = { row: "DeepSeek", model: "V4 Flash" };
  const MANAGER = { row: "Manager", model: "Small" };

  test("the task line says the level; the manager line says none", () => {
    const words = askCallsWords({ task: TASK, manager: MANAGER, effort: "high" });
    expect(words[0]).toContain("at high");
    expect(words[1]).not.toContain("high");
    expect(words.join(" ")).toContain("distils");
  });

  test("default says nothing about an effort", () => {
    for (const effort of [null, undefined, "default", ""]) {
      const words = askCallsWords({ task: TASK, manager: MANAGER, effort });
      expect(words.join(" ")).not.toContain("effort");
      expect(words[0]).not.toContain(" at ");
    }
  });

  test("one model doing both says the distil call sends no effort", () => {
    const words = askCallsWords({ task: TASK, manager: TASK, effort: "low" });
    expect(words).toHaveLength(1);
    expect(words[0]).toContain("at low");
    expect(words[0]).toContain(ASK_CALLS_EFFORT_CURATOR);
  });

  test("the surface draws the same words the pure rule produced", () => {
    const calls: AskCallsFacts = { task: TASK, manager: MANAGER };
    const html = renderToStaticMarkup(
      createElement(PacketSurface, {
        declaration: { blocks: [], total: 0 },
        calls,
        effort: "max",
      }),
    );
    expect(html).toContain("at max");
  });
});

/* ------------------------------------------------------------------ *
 * 5. The selector: catalogue options, or none at all.
 * ------------------------------------------------------------------ */

describe("the ask card offers a selector only where the catalogue does", () => {
  const ASK: AskCardRecord = { on: "rain-q", name: "Rain", x: 1, y: 2 };

  function render(props: Record<string, unknown>): string {
    return renderToStaticMarkup(
      createElement(AskCard, {
        ask: ASK,
        anchorName: null,
        turns: [],
        open: true,
        previewLines: 3,
        hasProvider: true,
        onOpen: () => {},
        onClose: () => {},
        ...props,
      }),
    );
  }

  test("the options ARE the catalogue's values, plus default", () => {
    const html = render({
      efforts: ["low", "high", "max"],
    });
    expect(html).toContain("ask-card-effort");
    for (const value of ["low", "high", "max", "default"]) {
      expect(html).toContain(`>${value}</option>`);
    }
  });

  test("a model with NO efforts gets no selector at all", () => {
    const html = render({ efforts: [] });
    expect(html).not.toContain("ask-card-effort");
    expect(html).not.toContain("<select");
  });

  test("a stored pick the model no longer lists reads as default, not as a send", () => {
    const html = render({ ask: { ...ASK, effort: "max" }, efforts: ["low", "high"] });
    // "max" is not offered by this model, so the selector falls back to the
    // default and no <option value="max"> is drawn: nothing invents it.
    expect(html).not.toContain('value="max"');
    expect(html).toContain(">default</option>");
  });

  test("the pick reaches the send beside the question", () => {
    const card = source("canvas/AskCard.tsx");
    // One send site, and the effort is its last argument (after the phase).
    expect(card).toContain("wireEffort);");
    expect(card).toContain("onAskTurn(ask.on, asked");
  });
});
