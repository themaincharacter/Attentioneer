import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentedHeaderOfferLine } from "../src/canvas/ProvidersPanel";
import {
  HEADER_OFFER_SENTENCES,
  documentedHeaderOffer,
  normalizedEndpoint,
  withDocumentedHeaders,
  type DocumentedHeaderOffer,
} from "../src/turn/providerHeaderOffer";
import {
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
} from "../src/turn/providerCatalog";
import {
  validateProviderRow,
  type HttpProviderRow,
} from "../src/turn/providers";
import {
  RESERVED_REQUEST_HEADERS,
  SESSION_HEADER_PLACEHOLDER,
} from "../src/turn/requestHeaders";

/**
 * STORY 23.4 — A ROW THAT IS MISSING ITS DOCUMENTED HEADER IS TOLD, AND MAY
 * TAKE IT IN ONE PRESS.
 *
 * The claim: a row whose endpoint the catalogue lists, but which does not carry
 * the header that entry documents, is noticed in the provider list and offered
 * the name in one quiet line. Nothing is written until the press, the sentence
 * never carries a value, a name the row already has is never offered again, a
 * conflicting value is said and left alone, a reserved name is never offered,
 * and the press goes through the existing endpoint editor path.
 *
 * The tests read the catalogue as data: no test names a vendor, and the header
 * name under test comes out of the entry the app ships.
 */

const APP = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

function httpRow(
  baseUrl: string,
  headers?: Record<string, string>,
): HttpProviderRow {
  const row: HttpProviderRow = {
    kind: "http",
    id: "a-row",
    name: "A row",
    baseUrl,
    models: [
      {
        id: "a-model",
        name: "A model",
        capabilities: { tools: false, vision: false },
      },
    ],
  };
  if (headers !== undefined) row.headers = headers;
  return row;
}

/** The catalogue's own documented entry: the data every test starts from. */
function documentedEntry(): ProviderCatalogEntry {
  const entry = PROVIDER_CATALOG.find(
    (candidate) =>
      candidate.headers !== undefined &&
      Object.keys(candidate.headers).length > 0,
  );
  if (entry === undefined) throw new Error("the catalogue documents no header");
  return entry;
}

function documentedNames(entry: ProviderCatalogEntry): string[] {
  return Object.keys(entry.headers ?? {});
}

function renderLine(offer: DocumentedHeaderOffer): string {
  return renderToStaticMarkup(
    createElement(DocumentedHeaderOfferLine, { offer, onTake: () => {} }),
  );
}

describe("the detector brings the catalogue's documented header by URL", () => {
  test("a matching row missing the header is offered exactly that name", () => {
    const entry = documentedEntry();
    const names = documentedNames(entry);
    const offer = documentedHeaderOffer(httpRow(entry.baseUrl));
    expect(offer).not.toBeNull();
    expect(offer?.entryId).toBe(entry.id);
    expect(offer?.add).toEqual(names);
    expect(offer?.conflicts).toEqual([]);

    const html = renderLine(offer as DocumentedHeaderOffer);
    for (const name of names) expect(html).toContain(name);
    expect(html).toContain(HEADER_OFFER_SENTENCES.add);
    // THE LINE NAMES THE HEADER, NEVER ITS VALUE.
    for (const name of names) {
      expect(html).not.toContain(entry.headers?.[name] ?? "");
    }
  });

  test("the URL match is normalised, not typed exactly", () => {
    const entry = documentedEntry();
    const variants = [
      entry.baseUrl.replace(/\/+$/, "") + "/",
      entry.baseUrl.replace("https://", "HTTPS://"),
      "  " + entry.baseUrl + "  ",
    ];
    expect(normalizedEndpoint(variants[0])).toBe(
      normalizedEndpoint(entry.baseUrl),
    );
    for (const variant of variants) {
      expect(documentedHeaderOffer(httpRow(variant))).not.toBeNull();
    }
  });

  test("a row carrying the header in any case is not offered it again", () => {
    const entry = documentedEntry();
    for (const name of documentedNames(entry)) {
      const row = httpRow(entry.baseUrl, {
        [name.toUpperCase()]: entry.headers?.[name] ?? "",
      });
      expect(documentedHeaderOffer(row)).toBeNull();
    }
  });

  test("a conflicting value is said, never changed and never offered", () => {
    const entry = documentedEntry();
    const names = documentedNames(entry);
    const headers: Record<string, string> = {};
    for (const name of names) headers[name.toLowerCase()] = "the person's own value";
    const row = httpRow(entry.baseUrl, headers);
    const offer = documentedHeaderOffer(row);
    expect(offer).not.toBeNull();
    expect(offer?.add).toEqual([]);
    expect(offer?.conflicts).toEqual(names);

    const html = renderLine(offer as DocumentedHeaderOffer);
    for (const name of names) expect(html).toContain(name);
    expect(html).toContain("left as it is");
    expect(html).not.toContain(HEADER_OFFER_SENTENCES.add);

    // A press for the conflicting names would clobber nothing: the row keeps
    // exactly the value it already had.
    const after = withDocumentedHeaders(row, names);
    expect(after.headers).toEqual(headers);
  });

  test("a URL no entry lists offers nothing at all", () => {
    const entry = documentedEntry();
    expect(documentedHeaderOffer(httpRow("https://example.test/v1"))).toBeNull();
    expect(
      documentedHeaderOffer(httpRow(entry.baseUrl + "/a-different-path")),
    ).toBeNull();
    expect(documentedHeaderOffer(httpRow("not a url"))).toBeNull();
  });

  test("reserved names are never offered, even from catalogue data", () => {
    const entry = documentedEntry();
    for (const reserved of RESERVED_REQUEST_HEADERS) {
      const baseUrl = "https://reserved.example/v1";
      const catalog: ProviderCatalogEntry[] = [
        {
          ...entry,
          baseUrl,
          headers: { [reserved]: SESSION_HEADER_PLACEHOLDER },
        },
      ];
      expect(documentedHeaderOffer(httpRow(baseUrl), catalog)).toBeNull();
      expect(withDocumentedHeaders(httpRow(baseUrl), [reserved], catalog).headers)
        .toBeUndefined();
    }
  });

  test("a reserved name beside a real one is dropped, the real one stays", () => {
    const entry = documentedEntry();
    const name = documentedNames(entry)[0];
    const baseUrl = "https://reserved.example/v1";
    const catalog: ProviderCatalogEntry[] = [
      {
        ...entry,
        baseUrl,
        headers: {
          [RESERVED_REQUEST_HEADERS[0]]: SESSION_HEADER_PLACEHOLDER,
          [name]: SESSION_HEADER_PLACEHOLDER,
        },
      },
    ];
    const offer = documentedHeaderOffer(httpRow(baseUrl), catalog);
    expect(offer?.add).toEqual([name]);
    expect(offer?.add).not.toContain(RESERVED_REQUEST_HEADERS[0]);
  });
});

describe("the press takes the header through the existing editor path", () => {
  test("the row is written with the catalogue's value and the line disappears", () => {
    const entry = documentedEntry();
    const row = httpRow(entry.baseUrl);
    const offer = documentedHeaderOffer(row);
    expect(offer).not.toBeNull();

    const next = withDocumentedHeaders(row, offer?.add ?? []);
    const read = validateProviderRow({
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      headers: next.headers,
      models: row.models.map((model) => ({
        id: model.id,
        name: model.name,
        tools: model.capabilities.tools,
        vision: model.capabilities.vision,
      })),
    });
    expect(read.kind).toBe("row");
    if (read.kind !== "row" || read.row.kind !== "http") {
      throw new Error("the row did not validate");
    }
    expect(read.row.headers).toEqual(entry.headers);
    // The line is gone because the row now carries every documented name.
    expect(documentedHeaderOffer(read.row)).toBeNull();
  });

  test("the panel wires the line to the same save path the editor uses", () => {
    const code = codeOf(source("canvas/ProvidersPanel.tsx"));
    expect(code).toContain("documentedHeaderOffer(row)");
    expect(code).toContain("DocumentedHeaderOfferForRow");
    const take = code.slice(
      code.indexOf("async function takeDocumentedHeader"),
      code.indexOf("async function addModel"),
    );
    expect(take).toContain("withDocumentedHeaders(row, [name])");
    // ONE WRITE PATH: the press reuses the endpoint editor's save, not a
    // second writer, and it writes nothing on its own.
    expect(take).toContain("await saveHttpRow(");
    expect(take).not.toContain("saveTurnSettings");
    expect(take).not.toContain("saveAppConfig");
  });
});
