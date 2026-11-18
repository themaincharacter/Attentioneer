import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPTY_SETTINGS,
  parseProviderRow,
  providerFrom,
  readTurnSettings,
  storedTurnSettings,
  validateProviderRow,
  withProvider,
  type ProviderDraft,
} from "../src/turn/providers";
import {
  HEADER_LIMITS,
  HEADER_SENTENCES,
  SESSION_HEADER_PLACEHOLDER,
  headerMapProblem,
  headersFromText,
  headersText,
  headersForRequest,
} from "../src/turn/requestHeaders";
import {
  PROVIDER_CATALOG,
  catalogFill,
} from "../src/turn/providerCatalog";
import { askTurn } from "../src/turn/turn";
import { openSidecar, type SidecarPipe } from "./fixtures/sidecar-pipe";

/**
 * STORY 15.17 — A ROW CAN CARRY REQUEST HEADERS.
 *
 * The claim: a provider row may carry a request-header MAP as data, the
 * catalogue ships the one header its endpoint documents, and the sidecar merges
 * it AFTER the app's own headers. This file pins the four things that could go
 * wrong:
 *
 *   1. A header is DATA: bounded, validated at the write, stored and read back
 *      without inventing a field.
 *   2. The reserved names can never be overridden — refused at validation AND
 *      at the real wire, with one sentence and no value in it.
 *   3. The header reaches a local stub; a row without headers sends only the
 *      app's own generic headers.
 *   4. The lane never names the vendor: the header string exists in catalogue
 *      data, and nowhere in a module that runs or renders a turn.
 *
 * The wire half drives the REAL sidecar over its REAL stdio against a loopback
 * stub. No network, no key, no account.
 */

const APP = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const KEY = "sk-story-17-secret-key";
const PIPES: SidecarPipe[] = [];

afterAll(() => {
  for (const pipe of PIPES) pipe.stop();
  stub.stop(true);
});

/* ------------------------------------------------------------------ *
 * A loopback stub that records exactly what headers arrived.
 * ------------------------------------------------------------------ */

let requests = 0;
let lastHeaders: Record<string, string> | null = null;

const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    requests += 1;
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    lastHeaders = headers;
    await request.json();
    return Response.json({
      choices: [{ message: { role: "assistant", content: "one whole answer" } }],
    });
  },
});

const BASE_URL = `http://127.0.0.1:${stub.port}/v1`;

async function lane(): Promise<ReturnType<typeof openSidecar>> {
  const pipe = openSidecar();
  PIPES.push(pipe);
  await pipe.hello();
  return pipe;
}

function provider(headers?: Record<string, string>) {
  return {
    baseUrl: BASE_URL,
    model: "stub-model",
    apiKey: KEY,
    ...(headers === undefined ? {} : { headers }),
  };
}

/** Does this catalogue entry ship a request header? */
function hasShippedHeader(candidate: { headers?: Record<string, string> }): boolean {
  return Object.keys(candidate.headers ?? {}).length > 0;
}

/** The catalogue entry that ships a documented header, read from data. */
function shippedHeaderEntry() {
  const entry = PROVIDER_CATALOG.find((candidate) =>
    Object.keys(candidate.headers ?? {}).length > 0,
  );
  if (entry === undefined || entry.headers === undefined) {
    throw new Error("the catalogue ships no request header");
  }
  return entry;
}

/* ------------------------------------------------------------------ *
 * 1. Headers are data, and the write is the first gate.
 * ------------------------------------------------------------------ */

const draft = (headers?: Record<string, string>): ProviderDraft => ({
  name: "Stub endpoint",
  baseUrl: "https://api.example.com/v1",
  models: [{ id: "stub-model", name: "Stub", tools: false, vision: false }],
  ...(headers === undefined ? {} : { headers }),
});

describe("a header map is data a row may carry", () => {
  test("a valid map rides the row, the stored config and the wire", () => {
    const read = validateProviderRow(
      draft({ "x-note": "kept as written", "x-trace": SESSION_HEADER_PLACEHOLDER }),
    );
    expect(read.kind).toBe("row");
    if (read.kind !== "row") return;
    if (read.row.kind !== "http") throw new Error("not an endpoint row");
    expect(read.row.headers).toEqual({
      "x-note": "kept as written",
      "x-trace": SESSION_HEADER_PLACEHOLDER,
    });

    const settings = withProvider(EMPTY_SETTINGS, read.row);
    const stored = storedTurnSettings(settings);
    expect(stored.providers[0]?.headers).toEqual({
      "x-note": "kept as written",
      "x-trace": SESSION_HEADER_PLACEHOLDER,
    });
    expect(parseProviderRow(stored.providers[0])?.headers).toEqual({
      "x-note": "kept as written",
      "x-trace": SESSION_HEADER_PLACEHOLDER,
    });
    expect(readTurnSettings(stored).providers[0]?.headers).toEqual({
      "x-note": "kept as written",
      "x-trace": SESSION_HEADER_PLACEHOLDER,
    });

    const wire = providerFrom(read.row, read.row.models[0]!, KEY);
    expect(wire.headers).toEqual({
      "x-note": "kept as written",
      "x-trace": SESSION_HEADER_PLACEHOLDER,
    });
  });

  test("a row without headers stores no header field and sends none", () => {
    const read = validateProviderRow(draft());
    expect(read.kind).toBe("row");
    if (read.kind !== "row") return;
    const stored = storedTurnSettings(withProvider(EMPTY_SETTINGS, read.row));
    expect(stored.providers[0]).not.toHaveProperty("headers");
    const wire = providerFrom(read.row, read.row.models[0]!, KEY);
    expect(wire).not.toHaveProperty("headers");
  });

  test("the panel's lines read back as the same map", () => {
    const headers = { "x-one": "a: b", "x-two": SESSION_HEADER_PLACEHOLDER };
    expect(headersFromText(headersText(headers))).toEqual({
      kind: "headers",
      headers,
    });
    expect(headersFromText("x-one: value\nx-two: 2")).toEqual({
      kind: "headers",
      headers: { "x-one": "value", "x-two": "2" },
    });
  });

  test("a malformed line is refused with its own sentence", () => {
    expect(headersFromText("not a header line")).toEqual({
      kind: "refused",
      sentence: HEADER_SENTENCES.line,
    });
  });
});

/* ------------------------------------------------------------------ *
 * 2. The reserved names and the bounds, at the write.
 * ------------------------------------------------------------------ */

describe("the write refuses what the turn owns", () => {
  for (const reserved of [
    "authorization",
    "content-type",
    "host",
    "content-length",
  ]) {
    test(`a row may not name ${reserved}`, () => {
      expect(validateProviderRow(draft({ [reserved]: "value" }))).toEqual({
        kind: "refused",
        sentence: HEADER_SENTENCES.reserved,
      });
      // Case does not defeat the rule.
      const shouted = reserved.toUpperCase();
      expect(validateProviderRow(draft({ [shouted]: "value" }))).toEqual({
        kind: "refused",
        sentence: HEADER_SENTENCES.reserved,
      });
    });
  }

  test("a value with a newline is refused", () => {
    expect(validateProviderRow(draft({ "x-note": "one\ntwo" }))).toEqual({
      kind: "refused",
      sentence: HEADER_SENTENCES.newline,
    });
    expect(headerMapProblem({ "x-note": "one\r\ntwo" })).toBe(
      HEADER_SENTENCES.newline,
    );
  });

  test("names, values and the count are bounded", () => {
    expect(
      validateProviderRow(draft({ ["x-" + "a".repeat(HEADER_LIMITS.name)]: "v" })),
    ).toEqual({ kind: "refused", sentence: HEADER_SENTENCES.nameTooLong });
    expect(
      validateProviderRow(draft({ "x-note": "a".repeat(HEADER_LIMITS.value + 1) })),
    ).toEqual({ kind: "refused", sentence: HEADER_SENTENCES.valueTooLong });
    const many: Record<string, string> = {};
    for (let n = 0; n <= HEADER_LIMITS.count; n += 1) many["x-" + n] = "v";
    expect(validateProviderRow(draft(many))).toEqual({
      kind: "refused",
      sentence: HEADER_SENTENCES.tooMany,
    });
  });
});

/* ------------------------------------------------------------------ *
 * 3. The wire: reach, merge order, reserved refusal, stable session.
 * ------------------------------------------------------------------ */

describe("the sidecar merges the row's headers after its own", () => {
  test("a shipped header reaches a local stub", async () => {
    const entry = shippedHeaderEntry();
    const pipe = await lane();
    const result = await askTurn(pipe.transport, provider(entry.headers), "one", {
      timeoutMs: 5_000,
    });
    expect(result).toEqual({ kind: "answer", text: "one whole answer" });
    expect(lastHeaders).not.toBeNull();
    for (const [name, value] of Object.entries(entry.headers ?? {})) {
      expect(lastHeaders?.[name.toLowerCase()]).toBe(
        value.split(SESSION_HEADER_PLACEHOLDER).join(
          lastHeaders?.["x-session-id"] ?? "",
        ),
      );
    }
    expect(lastHeaders?.["x-session-id"]).toBeTruthy();
  });

  test("a headerless row sends only the app's own headers", async () => {
    const pipe = await lane();
    const result = await askTurn(pipe.transport, provider(), "one", {
      timeoutMs: 5_000,
    });
    expect(result.kind).toBe("answer");
    const headers = lastHeaders as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer " + KEY);
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-session-id"]).toBeTruthy();
    // No row header can appear: there was no row map at all.
    const shipped = Object.keys(shippedHeaderEntry().headers ?? {});
    for (const name of shipped) {
      expect(headers[name.toLowerCase()]).toBeUndefined();
    }
  });

  test("the same session id rides both names, stable across turns", async () => {
    const entry = shippedHeaderEntry();
    const pipe = await lane();
    expect(
      (await askTurn(pipe.transport, provider(entry.headers), "one", {
        timeoutMs: 5_000,
      })).kind,
    ).toBe("answer");
    const first = lastHeaders as Record<string, string>;
    expect(
      (await askTurn(pipe.transport, provider(entry.headers), "two", {
        timeoutMs: 5_000,
      })).kind,
    ).toBe("answer");
    const second = lastHeaders as Record<string, string>;
    expect(second["x-session-id"]).toBe(first["x-session-id"]);
    for (const name of Object.keys(entry.headers ?? {})) {
      expect(second[name.toLowerCase()]).toBe(first[name.toLowerCase()]);
      expect(second[name.toLowerCase()]).toBe(second["x-session-id"]);
    }
  });

  test("a reserved name from the wire is refused in one sentence, and nothing is sent", async () => {
    const before = requests;
    const pipe = await lane();
    const result = await askTurn(
      pipe.transport,
      provider({ Authorization: "Bearer stolen" }),
      "one",
      { timeoutMs: 5_000 },
    );
    expect(result).toEqual({
      kind: "error",
      sentence: HEADER_SENTENCES.reserved,
    });
    // THE VALUE NEVER REACHES A SENTENCE.
    if (result.kind === "error") expect(result.sentence).not.toContain("stolen");
    expect(requests).toBe(before);
  });

  test("a newline value from the wire is refused too", async () => {
    const before = requests;
    const pipe = await lane();
    const result = await askTurn(
      pipe.transport,
      provider({ "x-note": "one\ntwo" }),
      "one",
      { timeoutMs: 5_000 },
    );
    expect(result).toEqual({
      kind: "error",
      sentence: HEADER_SENTENCES.newline,
    });
    expect(requests).toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The catalogue ships the header as data; the lane names no vendor.
 * ------------------------------------------------------------------ */

describe("the catalogue is where a documented header lives", () => {
  test("the shipped entry carries its header and says why", () => {
    const entry = shippedHeaderEntry();
    expect(Object.values(entry.headers ?? {})).toEqual([
      SESSION_HEADER_PLACEHOLDER,
    ]);
    expect(entry.note).toContain("request header");
    expect(entry.note).toContain("plain text");
    // A header is the exception, not a habit: only the entries the catalogue
    // marks with one carry one.
    for (const other of PROVIDER_CATALOG) {
      expect(Object.keys(other.headers ?? {}).length).toBe(
        hasShippedHeader(other) ? 1 : 0,
      );
    }
    expect(catalogFill(entry).headers).toEqual(entry.headers ?? {});
  });

  test("the merge keeps the app's order: ours first, the row's after", () => {
    const built = headersForRequest(
      { "content-type": "application/json", authorization: "Bearer k" },
      { "x-note": SESSION_HEADER_PLACEHOLDER },
      "session-1",
    );
    expect(built).toEqual({
      kind: "headers",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer k",
        "x-note": "session-1",
      },
    });
  });

  test("the header string is in the data and in no module that runs or renders", () => {
    const token = Object.keys(shippedHeaderEntry().headers ?? {})[0];
    if (token === undefined) throw new Error("no shipped header");
    // POSITIVE CONTROL: the committed export has it.
    const data = readFileSync(join(APP, "src", "turn", "modelsDevCatalog.json"), "utf8");
    expect(data.toLowerCase()).toContain(token.toLowerCase());

    const DATA = new Set([
      join(APP, "src", "turn", "providerCatalog.ts"),
      join(APP, "src", "turn", "acpSpecs.ts"),
      join(APP, "src", "turn", "modelsDevCatalog.json"),
    ]);
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|json)$/.test(entry.name) || DATA.has(full)) continue;
        files.push(full);
      }
    };
    walk(join(APP, "src"));
    walk(join(APP, "sidecar"));
    const hits = files.filter((file) =>
      readFileSync(file, "utf8").toLowerCase().includes(token.toLowerCase()),
    );
    expect(hits).toEqual([]);
  });

  test("the panel edits header lines and says they are plain text", () => {
    const panel = readFileSync(
      join(APP, "src", "canvas", "ProvidersPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("headersFromText(headerText)");
    expect(panel).toContain("headersFromText(editHeaders)");
    expect(panel).toContain("HEADER_STORE_SENTENCE");
    expect(panel).toContain("request headers — one per line, name: value");
    expect(panel).toContain("<textarea");
  });
});
