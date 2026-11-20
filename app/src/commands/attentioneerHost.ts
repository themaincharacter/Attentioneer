import {
  createGhostSession,
  type GhostAcceptResult,
  type GhostSession,
} from "../ghost/session";
import type { GhostFs } from "../ghost/port";
import { loadAsks, sharedSlugs, type AskCard } from "../map/asks";
import { loadGround, type GroundReference } from "../map/ground";
import { loadGroundLinks, type GroundLink } from "../map/groundLinks";
import { loadNotes, noteByteLength, NOTE_MAX_BYTES } from "../map/notes";
import { readingTextPath, previewText } from "../map/readings";
import { loadSessions, type SessionCard } from "../map/sessions";
import type { CommandHost, CommandOutcome } from "./execute";
import {
  GROUND_MOVES,
  NOTE_CARD_REFUSAL,
  NOTE_LENGTH_REFUSAL,
} from "./groundMoves";

/**
 * STORY 21.1 — THIS APP'S HALF OF THE SEAM (ADR-0038 §3, §4, §6).
 *
 * Reads go through the SAME record loaders the loaded view uses (the ground
 * files, their notes, the ask cards' lines); proposals go through the EXISTING
 * ghost intake — `createGhostSession`'s text door, its grammar, its inbox and
 * its accept. There is NO second write path here and no direct record write:
 * this module never calls a record writer. A proposal is a ghost the person
 * accepts; the accept is the app's own accept.
 *
 * The move table is the command card's (groundMoves.ts), handed to the session
 * as DATA so the app's live registry stays one move. A ghost filed here accepts
 * only through the session that filed it (the inbox's in-session ids): the app
 * discards the inbox at open, so a script's ghosts never become the window's.
 *
 * PROVISIONAL (ADR-0038's consequences): the act payload keys, the sentences
 * this file speaks, and the note that an unsent question is not a record.
 */

/** The bridges the host needs: the map's loaders' reads and the ghost port. */
export interface CommandIo {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  createDirAll(path: string): Promise<void>;
  createMarkerExclusive(path: string): Promise<boolean>;
}

/**
 * The ghost's port over the same bridge. The ghost layer and the record
 * loaders grew their own method names; this is the one translation, so a
 * driver's node:fs adapter is the ONLY bridge a headless run needs.
 */
function ghostFsOf(io: CommandIo): GhostFs {
  return {
    readText: (path) => io.readTextFile(path),
    writeText: (path, content) => io.writeTextFile(path, content),
    remove: (path) => io.removeFile(path),
    list: (path) => io.listDir(path),
    createDirAll: (path) => io.createDirAll(path),
    createMarkerExclusive: (path) => io.createMarkerExclusive(path),
  };
}

/** Construction: the workspace, the running game, and the bridges. */
export interface CommandHostOptions {
  /** The workspace root (absolute). */
  workspacePath: string;
  /** The fs bridge; the driver passes node's fs, the app would pass Tauri's. */
  io: CommandIo;
}

/** What the loaded view carries, read fresh for each act. */
interface GroundView {
  references: GroundReference[];
  links: GroundLink[];
  asks: AskCard[];
  sessions: SessionCard[];
  notes: Record<string, string>;
  unreadable: number;
}

/** The ground map's context (the only map this vocabulary names, for now). */
const CONTEXT = { level: "ground", scenario: null } as const;

/** Collapse a crop to one line: the driver prints one line per act. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A card's kind as the reading speaks it: reference or ask. */
type FoundCard =
  | { kind: "reference"; slug: string; name: string; x: number; y: number }
  | { kind: "ask"; slug: string; name: string; x: number; y: number };

/** Find a card by slug, then by the person's exact name, then case-insensitively. */
function findCard(view: GroundView, wanted: string): FoundCard | null {
  const cards: FoundCard[] = [
    ...view.references.map((reference) => ({
      kind: "reference" as const,
      slug: reference.on,
      name: reference.name,
      x: reference.x,
      y: reference.y,
    })),
    ...view.asks.map((ask) => ({
      kind: "ask" as const,
      slug: ask.on,
      name: ask.name,
      x: ask.x,
      y: ask.y,
    })),
  ];
  const exact = cards.find(
    (card) => card.slug === wanted || card.name === wanted,
  );
  if (exact !== undefined) return exact;
  const lower = wanted.toLowerCase();
  return (
    cards.find(
      (card) =>
        card.slug.toLowerCase() === lower || card.name.toLowerCase() === lower,
    ) ?? null
  );
}

/**
 * The app's adapter. Every read loads the records it needs at that moment; a
 * proposal builds the ghost body the vocabulary names and hands it to the
 * intake. The session opens lazily, so a read-only script never touches the
 * inbox (an opened workspace discards it; a read never does).
 */
export function createAttentioneerHost(options: CommandHostOptions) {
  const { workspacePath, io } = options;
  const session: GhostSession = createGhostSession({
    workspacePath,
    fs: ghostFsOf(io),
    moves: GROUND_MOVES,
    // The flow only scopes the refusal's sentence; a script is the paste-like
    // flow (no assistant is present), which is the session's own default.
    flow: "paste",
  });
  let opened = false;

  /** The app's open moment, once: the inbox is discarded before any proposal. */
  async function ensureOpen(): Promise<void> {
    if (opened) return;
    opened = true;
    try {
      await session.open();
    } catch {
      // The inbox could not be cleaned. Nothing becomes acceptable by
      // accident: only ids this session mints accept, exactly as in the app.
    }
  }

  async function loadView(): Promise<GroundView> {
    const [ground, links, asks, sessions] = await Promise.all([
      loadGround(workspacePath, io),
      loadGroundLinks(workspacePath, io),
      loadAsks(workspacePath, io),
      loadSessions(workspacePath, io),
    ]);
    const notes = await loadNotes(
      workspacePath,
      ground.references.map((reference) => reference.on),
      io,
    );
    return {
      references: ground.references,
      links: links.links,
      asks: asks.asks,
      sessions: sessions.sessions,
      notes: notes.notes,
      unreadable:
        ground.malformed.length +
        links.malformed.length +
        asks.malformed.length +
        sessions.malformed.length,
    };
  }

  /** One card's reading crop, read from the stored text file (nothing else). */
  async function readingCrop(slug: string): Promise<string | null> {
    const text = await io.readTextFile(readingTextPath(workspacePath, slug));
    if (text === null || text.trim() === "") return null;
    return flat(previewText(text, 6));
  }

  /** File one ghost body through the EXISTING intake and answer what it filed. */
  async function propose(
    body: Record<string, unknown>,
    describe: (id: string) => string,
  ): Promise<CommandOutcome> {
    await ensureOpen();
    const result = await session.intake(JSON.stringify(body), { ...CONTEXT });
    if (!result.ok || result.envelope === null) {
      const first = result.issues[0];
      return {
        ok: false,
        sentence: first === undefined ? "the intake refused that proposal." : flat(first.message),
      };
    }
    return {
      ok: true,
      line: describe(result.envelope.id),
      id: result.envelope.id,
    };
  }

  /** The rationale a ghost body carries: the script's why, or a plain one. */
  function whyOf(payload: Readonly<Record<string, unknown>>, fallback: string): string {
    const why = payload.why;
    return typeof why === "string" && why.trim() !== "" ? why : fallback;
  }

  async function proposeCard(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const name = String(payload.name);
    const x = Number(payload.x);
    const y = Number(payload.y);
    const body = {
      move: { family: "card", verb: "add" },
      target: { kind: "spot", x, y },
      params: { label: name },
      rationale: whyOf(payload, `a card named "${name}" at ${x}, ${y}`),
    };
    return propose(body, (id) => `proposed a card "${name}" at (${x}, ${y}); ghost ${id}`);
  }

  async function proposeWire(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const from = findCard(view, String(payload.from));
    const to = findCard(view, String(payload.to));
    if (from === null) {
      return {
        ok: false,
        sentence: `the wire needs both cards on the map, and "${String(payload.from)}" is not one of them.`,
      };
    }
    if (to === null) {
      return {
        ok: false,
        sentence: `the wire needs both cards on the map, and "${String(payload.to)}" is not one of them.`,
      };
    }
    if (from.slug === to.slug) {
      return { ok: false, sentence: "a card cannot link to itself." };
    }
    if (
      view.links.some(
        (link) => link.from === from.slug && link.to === to.slug,
      )
    ) {
      return { ok: false, sentence: "the map already wires those two cards." };
    }
    const body = {
      move: { family: "wire", verb: "add" },
      target: { kind: "link", from: from.slug, to: to.slug },
      params: {},
      rationale: whyOf(
        payload,
        `a wire from "${from.name}" to "${to.name}"`,
      ),
    };
    return propose(body, (id) => `proposed a wire "${from.name}" -> "${to.name}"; ghost ${id}`);
  }

  async function proposeNote(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const card = findCard(view, String(payload.card));
    const text = String(payload.note).trim();
    if (card === null || card.kind !== "reference") {
      return { ok: false, sentence: NOTE_CARD_REFUSAL };
    }
    if (noteByteLength(text) > NOTE_MAX_BYTES) {
      return { ok: false, sentence: NOTE_LENGTH_REFUSAL };
    }
    const body = {
      move: { family: "note", verb: "add" },
      target: { kind: "card", slug: card.slug },
      params: { text },
      rationale: whyOf(payload, `a note on "${card.name}"`),
    };
    return propose(body, (id) => `proposed a note on "${card.name}"; ghost ${id}`);
  }

  async function proposeAsk(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const name = String(payload.name);
    const x = Number(payload.x);
    const y = Number(payload.y);
    // The three card families share ONE slug space (the map's own rule): a
    // proposal may not coin a twin of a card that already stands.
    const taken = sharedSlugs(view.references, view.asks, view.sessions);
    const slug = name
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{Nd}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
    if (taken.has(slug === "" ? "untitled" : slug)) {
      return {
        ok: false,
        sentence: `a card named "${name}" is already on the map.`,
      };
    }
    const body = {
      move: { family: "ask", verb: "add" },
      target: { kind: "spot", x, y },
      params: { label: name },
      rationale: whyOf(payload, `an ask card named "${name}" at ${x}, ${y}`),
    };
    return propose(body, (id) => `proposed an ask card "${name}" at (${x}, ${y}); ghost ${id}`);
  }

  async function readOverview(): Promise<CommandOutcome> {
    const view = await loadView();
    const names = view.references.slice(0, 12).map((card) => `"${card.name}"`);
    const more = view.references.length > names.length ? ` and ${view.references.length - names.length} more` : "";
    const cards =
      view.references.length === 0
        ? "no cards"
        : `${view.references.length} card(s): ${names.join(", ")}${more}`;
    const asks =
      view.asks.length === 0 ? "no ask cards" : `${view.asks.length} ask card(s)`;
    const wires =
      view.links.length === 0 ? "no wires" : `${view.links.length} wire(s)`;
    const unreadable =
      view.unreadable === 0
        ? "no unreadable lines"
        : `${view.unreadable} unreadable line(s)`;
    return {
      ok: true,
      line: flat(`the ground map holds ${cards}, ${asks} and ${wires}; ${unreadable}.`),
    };
  }

  async function readCard(card: string): Promise<CommandOutcome> {
    const view = await loadView();
    const found = findCard(view, card);
    if (found === null) {
      return {
        ok: false,
        sentence: `"${card}" is not a card on this map.`,
      };
    }
    if (found.kind === "ask") {
      const wires = view.links.filter(
        (link) => link.from === found.slug || link.to === found.slug,
      ).length;
      return {
        ok: true,
        line: flat(
          `ask card "${found.name}" at (${found.x}, ${found.y}); ${wires} wire(s); its question is not a record until the person sends it.`,
        ),
      };
    }
    const reading = await readingCrop(found.slug);
    const note = view.notes[found.slug];
    const wires = view.links.filter(
      (link) => link.from === found.slug || link.to === found.slug,
    ).length;
    const parts = [`card "${found.name}" at (${found.x}, ${found.y})`];
    parts.push(reading === null ? "no reading" : `reading: ${reading}`);
    parts.push(note === undefined ? "no note" : `note: ${flat(previewText(note, 4))}`);
    parts.push(`${wires} wire(s)`);
    return { ok: true, line: flat(`${parts.join("; ")}.`) };
  }

  async function readWires(): Promise<CommandOutcome> {
    const view = await loadView();
    if (view.links.length === 0) {
      return { ok: true, line: "there are no wires." };
    }
    const nameOf = (slug: string): string => {
      const reference = view.references.find((card) => card.on === slug);
      if (reference !== undefined) return reference.name;
      const ask = view.asks.find((card) => card.on === slug);
      return ask === undefined ? slug : ask.name;
    };
    const shown = view.links
      .slice(0, 24)
      .map((link) => `"${nameOf(link.from)}" -> "${nameOf(link.to)}"`);
    const more =
      view.links.length > shown.length
        ? ` and ${view.links.length - shown.length} more`
        : "";
    return { ok: true, line: flat(`${shown.join(", ")}${more}.`) };
  }

  /**
   * Accept the ghosts this host filed, through the app's OWN accept (marker,
   * pin, apply, delete). Used by the driver's `--accept` to exercise the
   * normal path; the app's window uses the same session method.
   */
  async function accept(
    ids: readonly string[],
  ): Promise<readonly { id: string; outcome: GhostAcceptResult }[]> {
    const answers: { id: string; outcome: GhostAcceptResult }[] = [];
    for (const id of ids) {
      answers.push({ id, outcome: await session.accept(id, { ...CONTEXT }) });
    }
    return answers;
  }

  const host: CommandHost & {
    accept: typeof accept;
    session: GhostSession;
  } = {
    readOverview,
    readCard,
    readWires,
    proposeCard,
    proposeWire,
    proposeNote,
    proposeAsk,
    accept,
    session,
  };
  return host;
}

/** The one sentence an accepted ghost reports (the driver prints it). */
export function acceptLine(id: string, outcome: GhostAcceptResult): string {
  if (outcome.outcome === "applied") {
    return `accepted ${id}: ${outcome.steps.length} line(s) written.`;
  }
  if (outcome.outcome === "already-applied") {
    return `accepted ${id}: the record already held the proposal.`;
  }
  if (outcome.outcome === "refused") {
    const first = outcome.issues[0];
    return `refused ${id}: ${first === undefined ? "the app refused it." : first.message}`;
  }
  return `refused ${id}: the app no longer holds that proposal.`;
}
