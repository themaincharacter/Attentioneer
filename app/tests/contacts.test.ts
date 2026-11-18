import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTACTS,
  CONTACT_ACTOR,
  CONTACT_TARGET_KINDS,
  contactAdmitsChange,
  contactAllowsTarget,
  contactTargetRuleOf,
  findContact,
  type ContactDefinition,
} from "../src/contacts/table";
import { CHANGE_KINDS, type ChangeKind } from "../src/map/prisms";

/**
 * Epic 12 story 1 — the contact table (ADR-0028 decision 1), automated.
 *
 * The table sits BESIDE the ghost registry: world-contact verbs are the
 * person's, map-edit verbs are the agent's channel, and the two vocabularies
 * never mix. The ghost registry is untouched (still one map-edit move), the
 * actor is DATA, every refusal carries its reason, and the card layer never
 * reads this table — the source scan holds that seam.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

/** Every .ts/.tsx file under src/, recursively. */
function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function row(contact: string): ContactDefinition {
  const found = findContact(contact);
  expect(found).not.toBeNull();
  return found as ContactDefinition;
}

describe("the five contacts, one row each", () => {
  test("the table carries look, make, measure, ask and run in order", () => {
    expect(CONTACTS.map((entry) => entry.contact)).toEqual([
      "look",
      "make",
      "measure",
      "ask",
      "run",
    ]);
    expect(findContact("look")).not.toBeNull();
    expect(findContact("peek")).toBeNull();
    expect(findContact("")).toBeNull();
    expect(findContact(null)).toBeNull();
  });

  test("every row's actor is DATA: the person, carried by the row itself", () => {
    expect(CONTACT_ACTOR).toBe("person");
    for (const entry of CONTACTS) {
      expect(entry.actor).toBe("person");
      expect(Object.keys(entry)).toContain("actor");
    }
    // The table's source carries the actor per row; nothing derives it from a
    // registry lookup or from the row's position.
    const table = source("src/contacts/table.ts");
    expect(table.match(/actor: CONTACT_ACTOR/g)?.length).toBe(CONTACTS.length);
    expect(table).not.toContain("ghost/registry");
    expect(table).not.toContain("MOVES");
  });
});

describe("target rules are data, fail-closed", () => {
  test("every row rules on every target kind, allowed or refused", () => {
    for (const entry of CONTACTS) {
      expect(entry.targets.map((rule) => rule.kind)).toEqual([
        ...CONTACT_TARGET_KINDS,
      ]);
      for (const rule of entry.targets) {
        if (rule.allowed) {
          expect(rule.refusal).toBeUndefined();
        } else {
          expect(typeof rule.refusal).toBe("string");
          expect((rule.refusal as string).length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("look reads a path or at; a url is handed to the OS; none refuses", () => {
    const look = row("look");
    expect(contactAllowsTarget(look, "path")).toBe(true);
    expect(contactAllowsTarget(look, "at")).toBe(true);
    expect(contactAllowsTarget(look, "url")).toBe(true);
    expect(contactAllowsTarget(look, "none")).toBe(false);
  });

  test("make writes its artifact inside the workspace; at/url/none refuse", () => {
    const make = row("make");
    expect(contactAllowsTarget(make, "path")).toBe(true);
    expect(contactAllowsTarget(make, "at")).toBe(false);
    expect(contactAllowsTarget(make, "url")).toBe(false);
    expect(contactAllowsTarget(make, "none")).toBe(false);
    expect(contactTargetRuleOf(make, "at")?.refusal).toContain("inside");
  });

  test("measure reads declared facts; a url and none refuse", () => {
    const measure = row("measure");
    expect(contactAllowsTarget(measure, "path")).toBe(true);
    expect(contactAllowsTarget(measure, "at")).toBe(true);
    expect(contactAllowsTarget(measure, "url")).toBe(false);
    expect(contactAllowsTarget(measure, "none")).toBe(false);
  });

  test("ask may ride any reach, or none at all", () => {
    const ask = row("ask");
    for (const kind of CONTACT_TARGET_KINDS) {
      expect(contactAllowsTarget(ask, kind)).toBe(true);
    }
  });

  test("a run rides no pointer: its folder is the material", () => {
    // STORY 18.5: a session card's run hands a folder to a tool, so it names no
    // reach — none is its only allowed target, and the other three refuse.
    const run = row("run");
    expect(contactAllowsTarget(run, "none")).toBe(true);
    expect(contactAllowsTarget(run, "path")).toBe(false);
    expect(contactAllowsTarget(run, "at")).toBe(false);
    expect(contactAllowsTarget(run, "url")).toBe(false);
  });

  test("a missing rule is a refusal, never a permission", () => {
    const look = row("look");
    const stripped: ContactDefinition = { ...look, targets: [] };
    expect(contactTargetRuleOf(stripped, "path")).toBeNull();
    expect(contactAllowsTarget(stripped, "path")).toBe(false);
  });
});

describe("Change shapes are data from the closed union", () => {
  const expected: Record<string, ChangeKind[]> = {
    look: ["read-head", "open-os"],
    make: ["mint-pointer", "write-text"],
    measure: ["read-head"],
    ask: ["ask"],
    // STORY 18.5: a run's one Change, and nothing outside the closed union.
    run: ["run"],
  };

  test("each contact declares its own shapes, all from the closed union", () => {
    for (const entry of CONTACTS) {
      expect(entry.changes).toEqual(expected[entry.contact]);
      for (const kind of entry.changes) {
        expect([...CHANGE_KINDS]).toContain(kind);
      }
    }
  });

  test("a shape the row does not list is not this contact's", () => {
    const look = row("look");
    expect(contactAdmitsChange(look, "read-head")).toBe(true);
    expect(contactAdmitsChange(look, "open-os")).toBe(true);
    expect(contactAdmitsChange(look, "write-text")).toBe(false);
    expect(contactAdmitsChange(row("measure"), "open-os")).toBe(false);
    expect(contactAdmitsChange(row("ask"), "read-head")).toBe(false);
  });
});

describe("the two vocabularies never mix (the table is beside the ghost registry)", () => {
  test("the ghost registry is untouched: it knows no contact", () => {
    const registry = source("src/ghost/registry.ts");
    expect(registry).not.toContain("contacts");
    expect(registry).not.toContain("ContactKind");
    expect(registry).not.toContain("prisms");
    // Still exactly one MAP-EDIT move (ADR-0025's expansion gate stays scoped).
    expect(registry).toContain(
      "export const MOVES: readonly MoveDefinition[] = [ADD_ASSUMPTION];",
    );
  });

  test("the contact table imports neither the ghost registry nor the canvas", () => {
    const table = source("src/contacts/table.ts");
    // The doc points at the ghost registry (the words are the seam); the CODE
    // imports neither it nor the canvas.
    expect(table).not.toMatch(/from\s+["']\.\.\/ghost\//);
    expect(table).not.toMatch(/from\s+["']\.\.\/canvas\//);
    expect(table).not.toContain("ghost/registry");
    expect(table).not.toContain("MOVES");
  });

  test("the CARD layer never reads the contact table (source-scanned)", () => {
    // The card is the person's game note; its moves line derives from ghost
    // rows only, so contacts are never advertised to agents in v1. The card
    // record and every module that reads a card are scanned; so is the ghost
    // layer (the packet must not grow a contact vocabulary).
    const cardReaders = [
      "src/map/cards.ts",
      "src/ghost/registry.ts",
      "src/ghost/packet.ts",
      "src/ghost/useRequest.ts",
      "src/App.tsx",
    ];
    for (const file of cardReaders) {
      const text = source(file);
      expect(text).not.toContain("contacts/table");
      expect(text).not.toContain("ContactDefinition");
      expect(text).not.toContain("CONTACTS");
    }
    // No file under the ghost layer imports the table at all.
    for (const file of sourceFiles(join(SRC, "ghost"))) {
      expect(readFileSync(file, "utf8")).not.toMatch(/contacts\/table/);
    }
  });

  test("the card's moves derivation has no contact source", () => {
    const cards = source("src/map/cards.ts");
    expect(cards).not.toContain("contact");
    const registry = source("src/ghost/registry.ts");
    // gameMovesOf takes registry rows + the ring's creation kinds, as data.
    expect(registry).toContain("creationKindsData: readonly string[]");
    expect(registry).not.toContain("contacts");
  });
});
