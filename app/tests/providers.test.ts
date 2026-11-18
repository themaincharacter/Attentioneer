import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_PROVIDERS,
  EMPTY_SETTINGS,
  PROVIDER_SENTENCES,
  baseUrlProblem,
  builtinsUnderPerson,
  capabilitiesMeet,
  formatProviderRef,
  modelsForMove,
  parseProviderRef,
  readTurnSettings,
  providerFrom,
  providerSlug,
  resolveProvider,
  resolveSelection,
  storedTurnSettings,
  uniqueProviderId,
  validateProviderRow,
  withProvider,
  withSelection,
  withoutProvider,
  type ModelRow,
  type ProviderRow,
  type TurnSettings,
} from "../src/turn/providers";
import { requestLine, parseRequestLine } from "../src/turn/protocol";
import { localBaseUrl } from "../src/turn/local";
import { SECRET_SENTENCES, secretStatusWords } from "../src/lib/secret";

/**
 * Story 15.4 — provider rows, capability-carrying models, and where the key
 * lives.
 *
 * These tests pin what can be pinned without a keychain or a model:
 *   - a row is usable only when it has an id, a name, an http(s) base URL and
 *     at least one model — refused at the WRITE, never stored broken;
 *   - ids are derived from the name and deduped, so two rows never share a key;
 *   - built-in rows are laid UNDER the person's edits (none ship today);
 *   - a turn carries providerId:modelId, and a selection naming nothing says
 *     nothing is configured;
 *   - the capability filter offers only models that can do the move;
 *   - removing a row deletes its key and clears the selection;
 *   - the sidecar's wire is still exactly {baseUrl, model, apiKey} and the app
 *     config never carries a key (a byte search of the stored shape).
 *
 * The key STORE itself is Rust's (src-tauri/src/secrets.rs): the fallback
 * round-trip, the owner-only permissions and the three status answers are
 * tested there, on a temp dir, with the keychain injected.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

function row(): ProviderRow {
  return {
    id: "local-llama",
    name: "Local llama",
    baseUrl: "http://127.0.0.1:8080/v1",
    models: [
      { id: "qwen", name: "Qwen", capabilities: { tools: false, vision: false } },
      {
        id: "qwen-vl",
        name: "Qwen VL",
        capabilities: { tools: true, vision: true, contextWindow: 32000 },
      },
    ],
  };
}

function chosen(): TurnSettings {
  return withSelection(withProvider(EMPTY_SETTINGS, row()), "local-llama", "qwen");
}

/* ------------------------------------------------------------------ *
 * Rows: refused at the write, ids derived and deduped.
 * ------------------------------------------------------------------ */

describe("a row the app cannot act on is refused at the write", () => {
  const draft = {
    name: "Local llama",
    baseUrl: "http://127.0.0.1:8080/v1",
    models: [{ id: "qwen", name: "Qwen" }],
  };

  test("a name, a base URL and at least one model are required", () => {
    expect(validateProviderRow({ ...draft, name: "  " })).toEqual({
      kind: "refused",
      sentence: PROVIDER_SENTENCES.noName,
    });
    expect(validateProviderRow({ ...draft, baseUrl: "" })).toEqual({
      kind: "refused",
      sentence: PROVIDER_SENTENCES.noBaseUrl,
    });
    expect(validateProviderRow({ ...draft, models: [] })).toEqual({
      kind: "refused",
      sentence: PROVIDER_SENTENCES.noModels,
    });
  });

  test("a base URL that is not http(s) is refused (it cannot be fetched)", () => {
    for (const baseUrl of ["file:///etc/passwd", "ftp://host/v1", "not a url"]) {
      expect(validateProviderRow({ ...draft, baseUrl })).toEqual({
        kind: "refused",
        sentence: PROVIDER_SENTENCES.badBaseUrl,
      });
    }
    expect(validateProviderRow({ ...draft, baseUrl: "https://api.example.com/v1" }).kind).toBe(
      "row",
    );
  });

  test("plain http is only for this machine; every other host needs https", () => {
    // Loopback in its three spellings, each with a port and a path.
    for (const baseUrl of [
      "http://127.0.0.1:8080/v1",
      "http://localhost:11434/v1",
      "http://[::1]:8080/v1",
      "http://127.0.0.1",
    ]) {
      expect({ baseUrl, kind: validateProviderRow({ ...draft, baseUrl }).kind }).toEqual({
        baseUrl,
        kind: "row",
      });
    }
    // A remote host must be https, whatever the port or path.
    for (const baseUrl of [
      "http://api.example.com/v1",
      "http://192.168.1.9:8080/v1",
      "http://localhost.evil.test/v1",
    ]) {
      expect(validateProviderRow({ ...draft, baseUrl })).toEqual({
        kind: "refused",
        sentence: PROVIDER_SENTENCES.insecureBaseUrl,
      });
    }
    // The sentence names the rule: remote needs https, plain http is local only.
    expect(PROVIDER_SENTENCES.insecureBaseUrl).toContain("remote provider needs https");
    expect(PROVIDER_SENTENCES.insecureBaseUrl).toContain(
      "plain http is only for a model on this machine",
    );
  });

  test("the local tier's own loopback URL passes the rule", () => {
    expect(baseUrlProblem(localBaseUrl(8080))).toBeNull();
    expect(baseUrlProblem("http://127.0.0.1:8080/v1")).toBeNull();
    expect(baseUrlProblem("https://api.example.com/v1")).toBeNull();
    expect(baseUrlProblem("http://api.example.com/v1")).toBe(
      PROVIDER_SENTENCES.insecureBaseUrl,
    );
  });

  test("a model needs an id and a name, and two models cannot share an id", () => {
    expect(
      validateProviderRow({ ...draft, models: [{ id: "  ", name: "Qwen" }] }),
    ).toEqual({ kind: "refused", sentence: PROVIDER_SENTENCES.modelNoId });
    expect(
      validateProviderRow({ ...draft, models: [{ id: "qwen", name: "" }] }),
    ).toEqual({ kind: "refused", sentence: PROVIDER_SENTENCES.modelNoName });
    expect(
      validateProviderRow({
        ...draft,
        models: [
          { id: "qwen", name: "Qwen" },
          { id: "qwen", name: "Another Qwen" },
        ],
      }),
    ).toEqual({ kind: "refused", sentence: PROVIDER_SENTENCES.duplicateModel });
  });

  test("an id is derived from the name and made unique among the rows", () => {
    const built = validateProviderRow({ ...draft, name: "Local llama" });
    if (built.kind !== "row") throw new Error("unreachable");
    expect(built.row.id).toBe("local-llama");
    expect(providerSlug("  Local   LLAMA! ")).toBe("local-llama");
    expect(uniqueProviderId("Local llama", ["local-llama"])).toBe(
      "local-llama-2",
    );
    expect(
      uniqueProviderId("Local llama", ["local-llama", "local-llama-2"]),
    ).toBe("local-llama-3");
    // A name with no letters or digits cannot make a stable id.
    expect(
      validateProviderRow({ ...draft, name: "!!!" }),
    ).toEqual({ kind: "refused", sentence: PROVIDER_SENTENCES.noId });
  });

  test("an edited row cannot shadow another row's id", () => {
    const edited = validateProviderRow({ ...draft, id: "taken" }, ["taken"]);
    expect(edited).toEqual({
      kind: "refused",
      sentence: PROVIDER_SENTENCES.duplicateId,
    });
    const own = validateProviderRow({ ...draft, id: "mine" }, []);
    expect(own.kind).toBe("row");
  });

  test("capabilities are stored as claimed, and a missing flag is false", () => {
    const built = validateProviderRow({
      ...draft,
      models: [
        { id: "plain", name: "Plain" },
        { id: "tooled", name: "Tooled", tools: true, vision: true, contextWindow: 8000 },
      ],
    });
    if (built.kind !== "row") throw new Error("unreachable");
    expect(built.row.models[0].capabilities).toEqual({
      tools: false,
      vision: false,
    });
    expect(built.row.models[1].capabilities).toEqual({
      tools: true,
      vision: true,
      contextWindow: 8000,
    });
  });
});

/* ------------------------------------------------------------------ *
 * Reading the config: tolerant, and never a broken row.
 * ------------------------------------------------------------------ */

describe("reading the turn settings", () => {
  test("a malformed or older turn object reads as nothing, never an exception", () => {
    expect(readTurnSettings(undefined)).toEqual(EMPTY_SETTINGS);
    expect(readTurnSettings("nope")).toEqual(EMPTY_SETTINGS);
    // Story 1's old shape (baseUrl + model, no rows) is not guessed into a row.
    expect(readTurnSettings({ baseUrl: "http://x", model: "m" })).toEqual(
      EMPTY_SETTINGS,
    );
  });

  test("a broken row is dropped rather than guessed at", () => {
    const read = readTurnSettings({
      providerId: "local-llama",
      modelId: "qwen",
      providers: [
        { id: "no-name", baseUrl: "http://x", models: [] },
        { id: "no-url", name: "No URL", models: [] },
        row(),
      ],
    });
    expect(read.providers.map((provider) => provider.id)).toEqual([
      "local-llama",
    ]);
    expect(read.providerId).toBe("local-llama");
  });

  test("a duplicate id keeps the first row; a duplicate model keeps the first", () => {
    const read = readTurnSettings({
      providers: [
        row(),
        { ...row(), name: "A shadow" },
        {
          id: "other",
          name: "Other",
          baseUrl: "http://x",
          models: [
            { id: "m", name: "First", capabilities: { tools: false, vision: false } },
            { id: "m", name: "Shadow", capabilities: { tools: true, vision: false } },
          ],
        },
      ],
    });
    expect(read.providers.map((provider) => provider.name)).toEqual([
      "Local llama",
      "Other",
    ]);
    expect(read.providers[1].models.map((model) => model.name)).toEqual([
      "First",
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * The one string a turn carries.
 * ------------------------------------------------------------------ */

describe("providerId:modelId is the only provider fact a turn carries", () => {
  test("the string formats, splits on the FIRST colon, and refuses empties", () => {
    expect(formatProviderRef("local-llama", "qwen")).toBe("local-llama:qwen");
    expect(formatProviderRef("", "qwen")).toBe("");
    expect(formatProviderRef("local", "")).toBe("");
    expect(parseProviderRef("local-llama:qwen")).toEqual({
      providerId: "local-llama",
      modelId: "qwen",
    });
    // A model id branded with a colon still resolves: only the first colon
    // separates the provider from the model.
    expect(parseProviderRef("local:vendor:qwen")).toEqual({
      providerId: "local",
      modelId: "vendor:qwen",
    });
    expect(parseProviderRef("nocolon")).toBeNull();
    expect(parseProviderRef(":qwen")).toBeNull();
    expect(parseProviderRef("local:")).toBeNull();
  });

  test("the selection resolves to a row and its model, or says nothing is configured", () => {
    const resolved = resolveSelection(chosen());
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") throw new Error("unreachable");
    expect(resolved.provider.id).toBe("local-llama");
    expect(resolved.model.id).toBe("qwen");

    for (const settings of [
      EMPTY_SETTINGS,
      withProvider(EMPTY_SETTINGS, row()),
      withSelection(withProvider(EMPTY_SETTINGS, row()), "local-llama", "gone"),
      withSelection(EMPTY_SETTINGS, "local-llama", "qwen"),
    ]) {
      expect(resolveSelection(settings)).toEqual({
        kind: "refused",
        sentence: PROVIDER_SENTENCES.nothing,
      });
    }
    // The sentence says, in words, that nothing is configured.
    expect(PROVIDER_SENTENCES.nothing).toContain("nothing is configured");
  });
});

/* ------------------------------------------------------------------ *
 * Capabilities: the picker offers what can do the move.
 * ------------------------------------------------------------------ */

describe("the capability filter", () => {
  test("an ask needs no capability, so every model qualifies", () => {
    expect(modelsForMove(row(), {}).map((model) => model.id)).toEqual([
      "qwen",
      "qwen-vl",
    ]);
  });

  test("a move that needs tools or vision gets only models claiming it", () => {
    expect(modelsForMove(row(), { tools: true }).map((model) => model.id)).toEqual(
      ["qwen-vl"],
    );
    expect(modelsForMove(row(), { vision: true }).map((model) => model.id)).toEqual(
      ["qwen-vl"],
    );
    // Both required at once: still the one row that claims both.
    expect(
      modelsForMove(row(), { tools: true, vision: true }).map((model) => model.id),
    ).toEqual(["qwen-vl"]);
  });

  test("an absent capability is FALSE, never a hopeful default", () => {
    const plain: ModelRow = {
      id: "plain",
      name: "Plain",
      capabilities: { tools: false, vision: false },
    };
    expect(capabilitiesMeet(plain.capabilities, {})).toBe(true);
    expect(capabilitiesMeet(plain.capabilities, { vision: true })).toBe(false);
    expect(capabilitiesMeet(plain.capabilities, { tools: true })).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Defaults under the person's edits.
 * ------------------------------------------------------------------ */

describe("built-in rows are laid UNDER the person's edits", () => {
  const builtin: ProviderRow = {
    id: "shipped",
    name: "Shipped",
    baseUrl: "https://shipped.example/v1",
    models: [{ id: "small", name: "Small", capabilities: { tools: false, vision: false } }],
  };

  test("no built-in row ships today, and the merge is a no-op without one", () => {
    expect(BUILTIN_PROVIDERS).toEqual([]);
    expect(builtinsUnderPerson(chosen(), BUILTIN_PROVIDERS)).toEqual(chosen());
  });

  test("a new built-in is appended; an edited one is never clobbered", () => {
    const person = withProvider(chosen(), {
      ...row(),
      id: "shipped",
      name: "My name for it",
      baseUrl: "http://my-proxy/v1",
    });
    const laid = builtinsUnderPerson(person, [builtin]);
    const shipped = laid.providers.filter((provider) => provider.id === "shipped");
    expect(shipped).toHaveLength(1);
    expect(shipped[0].name).toBe("My name for it");
    expect(shipped[0].baseUrl).toBe("http://my-proxy/v1");
    // And a built-in the person does not have appears, once.
    const fresh = builtinsUnderPerson(EMPTY_SETTINGS, [builtin]);
    expect(fresh.providers.map((provider) => provider.id)).toEqual(["shipped"]);
  });
});

/* ------------------------------------------------------------------ *
 * Removing a row: the row goes, its key goes, the selection clears.
 * ------------------------------------------------------------------ */

describe("removing a provider", () => {
  test("drops the row and clears a selection that named it", () => {
    const next = withoutProvider(chosen(), "local-llama");
    expect(next.providers).toEqual([]);
    expect(next.providerId).toBe("");
    expect(next.modelId).toBe("");
    expect(resolveSelection(next).kind).toBe("refused");
  });

  test("keeps an unrelated selection", () => {
    const two = withProvider(chosen(), {
      ...row(),
      id: "other",
      name: "Other",
    });
    const next = withoutProvider(two, "other");
    expect(next.providerId).toBe("local-llama");
    expect(next.modelId).toBe("qwen");
  });

  test("the panel deletes the key BEFORE it saves the row's removal", () => {
    // The bridge is Tauri's; the ORDER is the rule worth pinning: a key must
    // not outlive the row, and a refused deletion must leave the row standing.
    const code = codeOf(source("canvas/ProvidersPanel.tsx"));
    const remove = code.slice(code.indexOf("async function removeProvider"));
    const forget = remove.indexOf("forgetSecret(");
    const save = remove.indexOf("withoutProvider(");
    expect(forget).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(forget);
    expect(remove).toContain("refused");
    // Deleting the key is the SAME path the store exposes: secret_delete.
    expect(codeOf(source("lib/secret.ts"))).toContain("secret_delete");
  });
});

/* ------------------------------------------------------------------ *
 * The wire and the config.
 * ------------------------------------------------------------------ */

describe("the sidecar's wire is unchanged and the config holds no key", () => {
  test("the provider built from a row is exactly baseUrl, model and key", () => {
    const provider = providerFrom(row(), row().models[0], "sk-never-written");
    expect(Object.keys(provider).sort()).toEqual([
      "apiKey",
      "baseUrl",
      "model",
    ]);
    expect(provider).toEqual({
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "qwen",
      apiKey: "sk-never-written",
    });
    // And the request line the sidecar reads carries that same object.
    const line = requestLine(1, provider, [{ role: "user", content: "hi" }]);
    const parsed = parseRequestLine(line);
    expect(parsed?.kind).toBe("turn");
    if (parsed === null || parsed.kind !== "turn") throw new Error("unreachable");
    expect(Object.keys(parsed.provider).sort()).toEqual([
      "apiKey",
      "baseUrl",
      "model",
    ]);
  });

  test("the stored settings carry rows and a selection, and a stray key cannot ride", () => {
    // A row from a careless caller, carrying a key-shaped extra field: the
    // stored shape is built field by field, so the byte search must not find it.
    const rogue = {
      ...row(),
      apiKey: "sk-rogue-never-on-disk",
      models: [
        {
          ...row().models[0],
          apiKey: "sk-model-rogue",
        },
      ],
    } as unknown as ProviderRow;
    const stored = storedTurnSettings(withProvider(chosen(), rogue));
    const bytes = JSON.stringify(stored);
    expect(bytes).not.toContain("sk-rogue");
    expect(bytes).not.toContain("sk-model-rogue");
    expect(bytes).not.toContain("apiKey");
    expect(bytes).not.toContain("secret");
    // The shape is the spec's: providerId, modelId, providers (id, name,
    // baseUrl, models (id, name, capabilities)).
    expect(Object.keys(stored).sort()).toEqual([
      "managerModelId",
      "managerProviderId",
      "modelId",
      "providerId",
      "providers",
    ]);
    const first = stored.providers[0];
    expect(Object.keys(first).sort()).toEqual([
      "baseUrl",
      "id",
      "models",
      "name",
    ]);
    expect(Object.keys(first.models[0]).sort()).toEqual([
      "capabilities",
      "id",
      "name",
    ]);
  });

  test("no config or settings writer even names a key", () => {
    // The only door to a secret is the key bridge; the config's writers must
    // not know the concept. (Comments are stripped: this is about code paths.)
    // providers.ts DOES name apiKey once: providerFrom builds the wire's
    // three fields. What it never does is read or write a store.
    for (const path of ["lib/appConfig.ts", "turn/provider.ts"]) {
      const code = codeOf(source(path));
      expect({ path, key: /apiKey|secret_|readSecret|setSecret|forgetSecret/.test(code) }).toEqual({
        path,
        key: false,
      });
    }
    expect(codeOf(source("turn/providers.ts"))).not.toMatch(
      /readSecret|setSecret|forgetSecret|secret_/,
    );
  });

  test("the UI never displays a key: no password field, only its existence", () => {
    // STORY 17.7: the embedded panel is gone. The ask card has no key field and
    // no key-store sentence; it sends through the hook, which reads the secret
    // at send time. Providers/Settings is the only key surface now.
    const card = codeOf(source("canvas/AskCard.tsx"));
    expect(card).not.toContain("password");
    expect(card).not.toContain("readSecret");
    const providers = codeOf(source("canvas/ProvidersPanel.tsx"));
    // The providers panel's key entry IS a password input, deliberately: what
    // it never does is FILL it from the store.
    expect(providers).toMatch(/type="password"/);
    expect(source("canvas/ProvidersPanel.tsx")).toContain("secretStatusWords");
    expect(source("canvas/AskPanel.tsx")).toContain("keyStore");
  });

  test("the status sentence names the store, always", () => {
    expect(secretStatusWords("keychain")).toBe(SECRET_SENTENCES.keychain);
    expect(secretStatusWords("fallback-file")).toBe(SECRET_SENTENCES.fallback);
    expect(secretStatusWords("unavailable")).toBe(SECRET_SENTENCES.unavailable);
    expect(SECRET_SENTENCES.fallback).toContain("not the OS keychain");
    // The egress reads the row at send time and never a stored key.
    const egress = codeOf(source("turn/egress.ts"));
    expect(egress).toContain("resolveSelection");
    // The key arrives through the injected bridge, at send time: the egress
    // itself has no key store and no stored key.
    expect(egress).toContain("deps.apiKey(");
    expect(egress).not.toMatch(/readSecret|setSecret|secret_get|secret_set/);
  });
});
