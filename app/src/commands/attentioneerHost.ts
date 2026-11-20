import {
  createGhostSession,
  type GhostAcceptResult,
  type GhostSession,
} from "../ghost/session";
import type { GhostFs } from "../ghost/port";
import {
  addAsk,
  askRefusal,
  askTurnPath,
  loadAsks,
  sharedSlugs,
  type AskCard,
} from "../map/asks";
import { loadGround, type GroundReference } from "../map/ground";
// STORY 21.9 — THE OTHER MAPS' RECORD PARSERS. The loaders beside these parse
// functions read through lib/fs (the window's bridge); a command reads through
// the SAME injected bridge as everything else here, so the file's bytes come
// from the caller's port and the parse is the record family's own.
import { listConceptWords, type ConceptWord } from "../map/conceptWords";
import { parseDistances, distancesPath } from "../map/distances";
import { linksPath, parseLinks, type Link } from "../map/links";
import { loopsPath, parseLoops, type Loop } from "../map/loops";
import { assumptionsPath, parseAssumptions, type Assumption } from "../map/assumptions";
import { parseQuantities, quantitiesPath, type Quantity } from "../map/quantities";
import { modelPath, parseModel, type PlayingSet } from "../map/model";
import { mapDir } from "../map/records";
import {
  appendEvents,
  cardMoveEvent,
  cardRenameEvent,
  type CardRenameKind,
} from "../map/history";
import {
  PLACE_DIRECTIONS,
  placedFrom,
  type PlaceDirection,
} from "../canvas/geometry";
import { loadGroundLinks, type GroundLink } from "../map/groundLinks";
import { loadNotes, noteByteLength, NOTE_MAX_BYTES } from "../map/notes";
import { readingTextPath, previewText } from "../map/readings";
import {
  loadSessions,
  sessionTranscriptPath,
  type SessionCard,
} from "../map/sessions";
// STORY 21.11 — THE TOOL ROWS THIS BUILD SHIPS, as data. The session card may
// only be bound to a row the tool picker offers, and the picker's label is the
// row's own (`acpRowLabel`), so the acts are resolved against the same rows the
// person sees. This import adds no process, no key and no egress: acpSpecs is
// shipped data and a pure label function.
import { ACP_SPECS, acpRowLabel } from "../turn/acpSpecs";
import {
  executeScript,
  type CommandHost,
  type CommandOutcome,
  type CommandRun,
} from "./execute";
import type { CommandAct, CommandMap } from "./acts";
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
 * this module never writes a record itself. A proposal is a ghost the person
 * accepts; the accept is the app's own accept. (STORY 21.8 adds one post-accept
 * audit: a place or a name that changed its record appends THE one
 * card.move/card.rename line through the history writer the app's own drag and
 * name pill use — ADR-0038 §8's audit, never a proposal's write.)
 *
 * The move table is the command card's (groundMoves.ts), handed to the session
 * as DATA so the app's live registry stays one move. A ghost filed here accepts
 * only through the session that filed it (the inbox's in-session ids): the app
 * discards the inbox at open, so a script's ghosts never become the window's.
 *
 * STORY 21.7 — THE ASK'S QUESTION CROSSES THIS SEAM AS A DRAFT (ADR-0038's
 * 2026-11-20 amendment: "ask rain gauge what it says about the plastic" is the
 * most natural sentence this app should understand). The question rides the
 * PROPOSAL (the ghost's `draft` param, which the deriver ignores) and comes
 * back out of the accept as a VIEW HINT — {@link AskDraftHint} — for the card's
 * composer. Nothing below ever writes it: the record writer is the person's
 * send, and an unsent question is a draft. NO ACT SENDS A TURN.
 *
 * STORY 21.11 — THE SESSION CARD'S HALF (ADR-0038 Amendment 2: the card
 * proposes, the person accepts, and undo is the second net AFTER the accept).
 * Three acts answer here: a card made on a tool row this build ships (the rows
 * come from acpSpecs as DATA, the picker's own labels included), one card bound
 * to another row through the SAME writer its own rebind verb uses
 * (map/sessions.ts's bindSessionTool), and one card removed in the app's OWN
 * delete shape — the record line first, the transcript second, each its own
 * ghost. NONE OF THEM STARTS A RUN: a run is an egress and stays the person's
 * press, exactly as a send stays the ask card's.
 *
 * PROVISIONAL (ADR-0038's consequences): the act payload keys, the sentences
 * this file speaks, the draft hint's shape, the point a new session card lands
 * on, the note that an unsent question is not a record, and the session acts'
 * names and sentences.
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

/**
 * STORY 21.7 — WHAT ONE ACCEPTED ASK HANDS THE WINDOW: the card its line
 * created and the question waiting in its composer. VIEW STATE, not a record:
 * the conversation file never holds a question the person did not send, so the
 * only place a draft lives after the accept is the card's own field.
 */
export interface AskDraftHint {
  /** The ask card the accept created — the slug its own canonical line carries. */
  slug: string;
  /** The person's question, waiting unsent. */
  question: string;
}

/**
 * STORY 21.8 — WHAT ONE PLACE OR ONE NAME TOOK BACK FROM. View state beside the
 * proposal, never a record: the spot of a move and the old words of a name are
 * read at proposal time, used for the ONE audit line on the accept, and offered
 * as the inverse act's value. PROVISIONAL with the act names.
 */
type PendingAudit =
  | {
      kind: "move";
      slug: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }
  | {
      kind: "rename";
      slug: string;
      family: CardRenameKind;
      from: string;
      to: string;
    }
  | {
      /**
       * STORY 21.11 — A SESSION CARD'S REBIND. The row it ran before is what the
       * inverse act needs, and it is not derivable once the record moved: the
       * host reads it at PROPOSAL time and keeps it here. A rebind is not an
       * authored history line (the card's own rebind verb logs none), so this
       * row is used for the inverse offer only.
       */
      kind: "bind";
      slug: string;
      from: string;
      to: string;
    };

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

/**
 * STORY 21.11 — A SESSION CARD BY SLUG, THEN BY THE PERSON'S EXACT NAME, then
 * case-insensitively — the same resolution `findCard` uses, over the third
 * family. A session card is not a reference and not an ask, so this reader is
 * its own: giving it the card kind would teach every other act that a session
 * carries a reading or a conversation.
 */
function findSessionCard(view: GroundView, wanted: string): SessionCard | null {
  const exact = view.sessions.find(
    (session) => session.on === wanted || session.name === wanted,
  );
  if (exact !== undefined) return exact;
  const lower = wanted.toLowerCase();
  return (
    view.sessions.find(
      (session) =>
        session.on.toLowerCase() === lower ||
        session.name.toLowerCase() === lower,
    ) ?? null
  );
}

/**
 * STORY 21.11 — THE ROW A NAME MEANS, or null. A session card may only be bound
 * to a tool row THIS BUILD SHIPS: the row's id (what the record holds and the
 * digest names) or the picker's own label (`acpRowLabel`, what the person
 * reads) — exactly, then case-insensitively, like a card's name. A row this
 * build does not ship answers null, and the caller refuses BY NAME before any
 * ghost exists. A row a person typed in Settings is NOT one of these, which is
 * the card's own rule too: `createSession` accepts only shipped rows.
 */
function shippedToolRowOf(wanted: string): string | null {
  const exact = ACP_SPECS.find(
    (spec) => spec.id === wanted || acpRowLabel(spec) === wanted,
  );
  if (exact !== undefined) return exact.id;
  const lower = wanted.toLowerCase();
  const loose = ACP_SPECS.find(
    (spec) =>
      spec.id.toLowerCase() === lower ||
      acpRowLabel(spec).toLowerCase() === lower,
  );
  return loose === undefined ? null : loose.id;
}

/** The one sentence an unknown tool row answers (PROVISIONAL wording). */
function unknownToolRowSentence(wanted: string): string {
  const shipped = ACP_SPECS.map((spec) => '"' + spec.id + '"').join(", ");
  return `"${wanted}" is not a tool row this build ships; ${shipped} are the ones it offers.`;
}

/** The label a person reads for a row id, or the id when this build lacks it. */
function toolRowLabel(id: string): string {
  const spec = ACP_SPECS.find((candidate) => candidate.id === id);
  return spec === undefined ? id : acpRowLabel(spec);
}

/**
 * STORY 21.11 — WHERE A NEW SESSION CARD GOES, computed by the APP. The act
 * carries no coordinate at all (the move act's own rule, one story older): the
 * host puts the card BELOW the last card on the map, by the one placement offset
 * the plane already uses, and at the origin when the map holds no card.
 * PROVISIONAL: the rule, not only the offset — a later story may let the person
 * place it.
 */
function sessionPointOf(view: GroundView): { x: number; y: number } {
  const last =
    view.sessions[view.sessions.length - 1] ??
    view.asks[view.asks.length - 1] ??
    view.references[view.references.length - 1];
  if (last === undefined) return { x: 0, y: 0 };
  return placedFrom({ x: last.x, y: last.y }, "below");
}

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
  /**
   * STORY 21.7 — THE DRAFTS THIS SESSION FILED, by ghost id. A question the
   * person has not sent is not a record, so it lives HERE (in memory, beside a
   * proposal that was never a write) until the accept hands it to the card's
   * composer. Nothing reads this map but {@link askDraftsFor}.
   */
  const askDrafts = new Map<string, AskDraftHint>();
  /**
   * STORY 21.8 — WHAT A PLACE OR A NAME TOOK BACK FROM, by ghost id. A move's
   * inverse needs the point the card stood on and a name's inverse needs the
   * words it had; neither is derivable from the proposal after the record
   * changed, so the host reads them at PROPOSAL time and keeps them here beside
   * a proposal that was never a write. Nothing reads this map but the accept
   * (the ONE `card.move`/`card.rename` audit) and {@link enrichedActsOf} (the
   * previous value the undo offer carries).
   */
  const audits = new Map<string, PendingAudit>();

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

  /**
   * STORY 21.7 — AN ASK CARD, ITS WIRES, AND ITS QUESTION AS A DRAFT.
   *
   * ONE ACT, THE DOCUMENTED SET OF GHOSTS: the ask card's own line, plus ONE
   * wire ghost per context card — the SAME link ghost `propose_wire` files (one
   * link shape, not two). Every context card is re-checked against the records
   * BEFORE any ghost is filed, so a name the map does not carry refuses by name
   * and files nothing.
   *
   * THE QUESTION IS A DRAFT, NEVER A RECORD: it rides the proposal as the ask
   * move's `draft` param (the deriver ignores it, so the accepted line carries
   * no question) and is remembered here against the ghost's id. After the
   * accept, {@link askDraftsFor} hands it back as a view hint for the card's
   * composer. Nothing in this module writes a conversation line, and NO ACT
   * SENDS A TURN — sending is the person's press.
   */
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
    // The slug the accepted line will carry, minted by the map's OWN function —
    // the wire below has to name the card before it exists, and the ghost's pin
    // makes the base it was minted against the base the accept sees.
    const askSlug = addAsk(view.asks, taken, name, x, y).ask.on;
    // THE QUESTION, as the field will hold it: edges trimmed (the ghost's own
    // params rule), newlines kept because a question may be more than one line.
    const question =
      typeof payload.question === "string" ? payload.question.trim() : "";
    // THE CARDS TO WIRE IN, all resolved first: nothing partial, nothing named
    // that the map does not carry.
    const wanted = Array.isArray(payload.context) ? payload.context : [];
    const context: FoundCard[] = [];
    for (const entry of wanted) {
      const wantedName = String(entry);
      const found = findCard(view, wantedName);
      if (found === null) {
        return {
          ok: false,
          sentence: `"${wantedName}" is not a card on this map.`,
        };
      }
      if (found.slug === askSlug) {
        return { ok: false, sentence: "a card cannot wire to itself." };
      }
      if (!context.some((card) => card.slug === found.slug)) context.push(found);
    }
    const body = {
      move: { family: "ask", verb: "add" },
      target: { kind: "spot", x, y },
      params: {
        label: name,
        ...(question === "" ? {} : { draft: question }),
      },
      rationale: whyOf(
        payload,
        question === ""
          ? `an ask card named "${name}" at ${x}, ${y}`
          : `an ask card named "${name}" at ${x}, ${y}, with the question waiting unsent`,
      ),
    };
    const filed = await propose(
      body,
      (id) =>
        `proposed an ask card "${name}" at (${x}, ${y})${
          question === "" ? "" : ", with the question waiting unsent"
        }; ghost ${id}`,
    );
    if (!filed.ok || filed.id === undefined) return filed;
    if (question !== "") {
      askDrafts.set(filed.id, { slug: askSlug, question });
    }
    const waiting =
      question === ""
        ? ""
        : "; the question waits unsent in its composer";
    const wiredIn =
      context.length === 0
        ? ""
        : `; wired in: ${context.map((card) => `"${card.name}"`).join(", ")}`;
    const ids: string[] = [filed.id];
    for (const card of context) {
      const wired = await propose(
        {
          move: { family: "wire", verb: "add" },
          target: { kind: "link", from: card.slug, to: askSlug },
          params: {},
          rationale: `wiring "${card.name}" into the ask card "${name}"`,
        },
        (id) => `wired "${card.name}" into "${name}"; ghost ${id}`,
      );
      // A wire that cannot be filed leaves the ask's ghost filed (a proposal is
      // not a write); the executor still stops at this act and applies nothing.
      if (!wired.ok || wired.id === undefined) return wired;
      ids.push(wired.id);
    }
    return {
      ok: true,
      line: `${filed.line}${waiting}${wiredIn}`,
      ids,
    };
  }

  /**
   * STORY 21.8 — ONE CARD PLACED BY THE HOST, NEVER BY THE MODEL (ADR-0038's
   * 2026-11-20 amendment: "put the new card under the rain gauge" is ordinary).
   * The act names a card, optionally a card to measure from, and one of four
   * directions; the point is computed HERE by the pure geometry helper, put on
   * the ghost's params, and checked against the records exactly as a wire's pair
   * is. A direction the app does not know, a missing direction, and a card or
   * frame that is not on the map are each refused BY NAME, before any ghost.
   *
   * A PREPARED act (the app's own take-back) carries the point the card stood
   * on. It never comes from a model's reply and it never skips the app's own
   * accept: it files the same one-line rewrite ghost.
   */
  async function proposeMove(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const wanted = String(payload.card);
    const card = findCard(view, wanted);
    if (card === null) {
      return { ok: false, sentence: '"' + wanted + '" is not a card on this map.' };
    }

    let point: { x: number; y: number };
    const takenX = payload.x;
    const takenY = payload.y;
    if (typeof takenX === "number" && typeof takenY === "number") {
      // THE APP'S OWN PREVIOUS POINT (an undo). It is a number pair only the
      // app can mint; validateAct refuses the keys on a model's act.
      point = { x: Math.round(takenX), y: Math.round(takenY) };
    } else {
      const raw = payload.direction;
      if (typeof raw !== "string" || raw.trim() === "") {
        return {
          ok: false,
          sentence:
            "a move needs a direction: below, above, left and right are the ones this app knows.",
        };
      }
      const direction = raw.trim().toLowerCase();
      if (!(PLACE_DIRECTIONS as readonly string[]).includes(direction)) {
        return {
          ok: false,
          sentence:
            '"' + raw + '" is not a direction I know; below, above, left and right are the ones this app has.',
        };
      }
      // THE FRAME: the named other card's point, or the card's own point when
      // no other card is named (a nudge by exactly one card).
      let frame = { x: card.x, y: card.y };
      if (payload.other !== undefined) {
        const wantedOther = String(payload.other);
        const other = findCard(view, wantedOther);
        if (other === null) {
          return {
            ok: false,
            sentence: '"' + wantedOther + '" is not a card on this map.',
          };
        }
        if (other.slug === card.slug) {
          return {
            ok: false,
            sentence: "a card cannot be placed relative to itself.",
          };
        }
        frame = { x: other.x, y: other.y };
      }
      point = placedFrom(frame, direction as PlaceDirection);
    }

    const reference = card.kind === "reference";
    const body: Record<string, unknown> = {
      move: { family: reference ? "card" : "ask", verb: "move" },
      target: reference
        ? { kind: "card", slug: card.slug }
        : { kind: "ask", slug: card.slug },
      params: { x: point.x, y: point.y },
      rationale: whyOf(
        payload,
        'moving "' + card.name + '" to ' + point.x + ', ' + point.y,
      ),
    };
    const filed = await propose(
      body,
      (id) =>
        'proposed moving "' + card.name + '" to ' + point.x + ', ' + point.y + '; ghost ' + id,
    );
    if (filed.ok && filed.id !== undefined) {
      audits.set(filed.id, {
        kind: "move",
        slug: card.slug,
        fromX: Math.round(card.x),
        fromY: Math.round(card.y),
        toX: point.x,
        toY: point.y,
      });
    }
    return filed;
  }

  /**
   * STORY 21.8 — A NAME PROPOSED FOR THE PERSON TO ACCEPT (AGENTS.md's guardrail:
   * only the user coins a name; an agent may propose one as a ghost). Nothing
   * here renames anything: the ghost's ONE line rewrite is the person's accept,
   * and that accept is the coining. An empty name is refused BY THE ACT LAYER
   * before this adapter is reached; this method refuses a blank one again rather
   * than ever writing "Untitled" over a proposal.
   *
   * A same-name proposal files the same one-line rewrite (the record is
   * unchanged) and its accept logs nothing — the name pill's own no-op rule.
   */
  async function proposeRename(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const wanted = String(payload.card);
    const card = findCard(view, wanted);
    if (card === null) {
      return { ok: false, sentence: '"' + wanted + '" is not a card on this map.' };
    }
    const proposed = String(payload.name).trim();
    if (proposed === "") {
      // The ask family's own refusal sentence says the rule in four words; a
      // reference's blank field is its "Untitled" sentence at the write, which a
      // PROPOSAL must never fall back to — so both families refuse here.
      return {
        ok: false,
        sentence:
          card.kind === "ask"
            ? askRefusal(proposed) ?? "name it first."
            : "a name proposal needs a name; name it first.",
      };
    }
    const reference = card.kind === "reference";
    const body: Record<string, unknown> = {
      move: { family: reference ? "card" : "ask", verb: "rename" },
      target: reference
        ? { kind: "card", slug: card.slug }
        : { kind: "ask", slug: card.slug },
      // THE KEY IS "to": the ghost grammar reserves a "name" slot for the
      // person's coining, and this row is the one proposal that carries words
      // for a name. The accept is the coining; the refusal changes nothing.
      params: { to: proposed },
      rationale: whyOf(
        payload,
        'proposing the name "' + proposed + '" for "' + card.name + '"',
      ),
    };
    const filed = await propose(
      body,
      (id) =>
        'proposed the name "' +
        proposed +
        '" for "' +
        card.name +
        '"; ghost ' +
        id,
    );
    if (filed.ok && filed.id !== undefined) {
      audits.set(filed.id, {
        kind: "rename",
        slug: card.slug,
        family: reference ? "reference" : "ask",
        from: card.name,
        to: proposed,
      });
    }
    return filed;
  }

  /*
   * STORY 21.11 — THE SESSION CARD'S THREE ACTS (ADR-0038 Amendment 2: propose,
   * then undo after the accept). Each is a GHOST through the same intake as
   * everything else, and each re-checks its names against the records it just
   * loaded, so a card or a row that is not there is refused BY NAME before any
   * ghost is filed.
   *
   * NO ACT HERE STARTS A RUN. A run is an EGRESS — a task leaves the machine —
   * and it stays the person's press on the card, exactly as a send stays the ask
   * card's own. There is no task in these payloads, no call to the run lane, and
   * nothing in this module can start one.
   */

  /**
   * ONE SESSION CARD ON A TOOL ROW THIS BUILD SHIPS. The name is the person's
   * (a proposal they accept, the card's own coining rule); the row is resolved
   * against the shipped rows and refused by name otherwise; the point is the
   * app's (the act carries no coordinate). The ghost appends the one
   * `sessions.txt` line the card's own creation writes, and nothing else — a
   * card that has never run has no transcript to invent.
   */
  async function proposeSession(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const name = String(payload.name).trim();
    const wantedTool = String(payload.tool);
    const tool = shippedToolRowOf(wantedTool);
    if (tool === null) {
      return { ok: false, sentence: unknownToolRowSentence(wantedTool) };
    }
    // The three card families share ONE slug space (the map's own rule), so a
    // proposal may not coin a twin of a card that already stands. The record
    // writer re-checks with the same set; this refusal comes first and by name.
    const taken = sharedSlugs(view.references, view.asks, view.sessions);
    const base = name
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{Nd}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
    if (taken.has(base === "" ? "untitled" : base)) {
      return {
        ok: false,
        sentence: `a card named "${name}" is already on the map.`,
      };
    }
    const point = sessionPointOf(view);
    const label = toolRowLabel(tool);
    const body = {
      move: { family: "session", verb: "add" },
      target: { kind: "spot", x: point.x, y: point.y },
      params: { label: name, tool },
      rationale: whyOf(payload, `a session card named "${name}" on ${label}`),
    };
    return propose(
      body,
      (id) =>
        `proposed a session card "${name}" on ${label}; ghost ${id}`,
    );
  }

  /**
   * ONE CARD'S ROW FIELD, AND ONLY THAT. The card is found among the session
   * cards; the row is resolved against the shipped rows; the ghost rewrites the
   * one `sessions.txt` line through `bindSessionTool` — the SAME writer the
   * card's own rebind verb uses — so the transcript, the task and the result are
   * untouched by construction. A row the card already runs is refused: a
   * proposal that changes nothing is not worth a press.
   */
  async function proposeBindSession(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const wanted = String(payload.card);
    const card = findSessionCard(view, wanted);
    if (card === null) {
      return {
        ok: false,
        sentence: `"${wanted}" is not a session card on this map.`,
      };
    }
    const wantedTool = String(payload.tool);
    const tool = shippedToolRowOf(wantedTool);
    if (tool === null) {
      return { ok: false, sentence: unknownToolRowSentence(wantedTool) };
    }
    if (card.tool === tool) {
      return {
        ok: false,
        sentence: `"${card.name}" already runs on ${toolRowLabel(tool)}.`,
      };
    }
    const label = toolRowLabel(tool);
    const filed = await propose(
      {
        move: { family: "session", verb: "bind" },
        target: { kind: "session", slug: card.on },
        params: { tool },
        rationale: whyOf(
          payload,
          `binding the session card "${card.name}" to ${label}`,
        ),
      },
      (id) =>
        `proposed binding the session card "${card.name}" to ${label}; ghost ${id}`,
    );
    if (filed.ok && filed.id !== undefined) {
      // The row the card ran before, for the inverse act ("undo that" binds it
      // back) — app-minted view state, never a model's word.
      audits.set(filed.id, {
        kind: "bind",
        slug: card.on,
        from: card.tool,
        to: tool,
      });
    }
    return filed;
  }

  /**
   * ONE SESSION CARD'S REMOVAL, IN THE APP'S OWN DELETE SHAPE: the record line
   * first (the record is the truth), then the transcript file that goes with it
   * — TWO ghosts, because a ghost is one file, one change (ADR-0025 decision 3).
   * The transcript's bytes are the app's to read before its unlink, and the
   * app's Restore puts them back verbatim, so this act only proposes the
   * removals the person could have made by hand.
   *
   * A card with no transcript (never run) has no second step, and this act does
   * not invent an empty file to delete.
   */
  async function proposeRemoveSession(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const wanted = String(payload.card);
    const card = findSessionCard(view, wanted);
    if (card === null) {
      return {
        ok: false,
        sentence: `"${wanted}" is not a session card on this map.`,
      };
    }
    const transcript = await io.readTextFile(
      sessionTranscriptPath(workspacePath, card.on),
    );
    const recordLine = await propose(
      {
        move: { family: "session", verb: "remove" },
        target: { kind: "session", slug: card.on },
        params: {},
        rationale: whyOf(
          payload,
          `removing the session card "${card.name}"`,
        ),
      },
      (id) => `proposed removing the session card "${card.name}"; ghost ${id}`,
    );
    if (!recordLine.ok || recordLine.id === undefined) return recordLine;
    const ids: string[] = [recordLine.id];
    if (transcript !== null) {
      const taken = await propose(
        {
          move: { family: "session", verb: "remove-transcript" },
          target: { kind: "session", slug: card.on },
          params: {},
          rationale: whyOf(
            payload,
            `removing the transcript of the session card "${card.name}"`,
          ),
        },
        (id) => `with its transcript; ghost ${id}`,
      );
      if (!taken.ok || taken.id === undefined) return taken;
      ids.push(taken.id);
    }
    return {
      ok: true,
      line:
        `proposed removing the session card "${card.name}"` +
        (transcript === null ? "" : ", with its transcript"),
      ids,
    };
  }

  /*
   * STORY 21.6 — THE REMOVALS THROUGH THE SAME INTAKE (ADR-0038's 2026-11-20
   * amendment). Each one re-checks the digest's names against the records it
   * just loaded: a card that is not there is refused BY NAME, in one sentence,
   * BEFORE any ghost is filed. A removal files exactly one ghost and changes no
   * record; the accept is the app's own.
   *
   * THE NEVER-LIST IS UNCHANGED: nothing here reaches a key, a provider row, a
   * run or a file outside the map folder. Removal is not on that list — it is a
   * thing a person can do by hand, so the acts may propose it too.
   */

  async function proposeUnwire(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const wantedFrom = String(payload.from);
    const wantedTo = String(payload.to);
    const from = findCard(view, wantedFrom);
    const to = findCard(view, wantedTo);
    if (from === null) {
      return {
        ok: false,
        sentence: `the unwire needs both cards on the map, and "${wantedFrom}" is not one of them.`,
      };
    }
    if (to === null) {
      return {
        ok: false,
        sentence: `the unwire needs both cards on the map, and "${wantedTo}" is not one of them.`,
      };
    }
    if (from.slug === to.slug) {
      return { ok: false, sentence: "a card cannot wire to itself." };
    }
    if (
      !view.links.some(
        (link) => link.from === from.slug && link.to === to.slug,
      )
    ) {
      return {
        ok: false,
        sentence: `the map does not wire "${from.name}" to "${to.name}".`,
      };
    }
    const body = {
      move: { family: "wire", verb: "remove" },
      target: { kind: "link", from: from.slug, to: to.slug },
      params: {},
      rationale: whyOf(
        payload,
        `removing the wire from "${from.name}" to "${to.name}"`,
      ),
    };
    return propose(
      body,
      (id) =>
        `proposed removing the wire "${from.name}" -> "${to.name}"; ghost ${id}`,
    );
  }

  async function proposeRemoveNote(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const wanted = String(payload.card);
    const card = findCard(view, wanted);
    if (card === null) {
      return { ok: false, sentence: `"${wanted}" is not a card on this map.` };
    }
    if (card.kind !== "reference") {
      // A note belongs to a reference card (the note family's own rule); an ask
      // card carries a conversation instead, which this act does not touch.
      return {
        ok: false,
        sentence: `"${card.name}" is an ask card; a note belongs to a reference card.`,
      };
    }
    if (view.notes[card.slug] === undefined) {
      return {
        ok: false,
        sentence: `"${card.name}" has no note to remove.`,
      };
    }
    const body = {
      move: { family: "note", verb: "remove" },
      target: { kind: "card", slug: card.slug },
      params: {},
      rationale: whyOf(payload, `removing the note on "${card.name}"`),
    };
    return propose(
      body,
      (id) => `proposed removing the note on "${card.name}"; ghost ${id}`,
    );
  }

  async function proposeRemoveCard(
    payload: Readonly<Record<string, unknown>>,
  ): Promise<CommandOutcome> {
    const view = await loadView();
    const wanted = String(payload.card);
    const card = findCard(view, wanted);
    if (card === null) {
      return { ok: false, sentence: `"${wanted}" is not a card on this map.` };
    }
    if (card.kind === "ask") {
      // STORY 21.7 — AN ASK CARD GOES THE APP'S OWN WAY: the record line first
      // (the record is the truth), then the conversation file that goes with
      // it — the same two steps the card's own x takes, each a ghost of its own
      // because a ghost is one file, one change. The transcript's bytes are the
      // app's to read before its unlink; this act only proposes the removals the
      // app's Restore can put back, and never touches a conversation itself.
      const conversation = await io.readTextFile(
        askTurnPath(workspacePath, card.slug),
      );
      const recordLine = await propose(
        {
          move: { family: "ask", verb: "remove" },
          target: { kind: "ask", slug: card.slug },
          params: {},
          rationale: whyOf(payload, `removing the ask card "${card.name}"`),
        },
        (id) => `proposed removing the ask card "${card.name}"; ghost ${id}`,
      );
      if (!recordLine.ok || recordLine.id === undefined) return recordLine;
      const ids: string[] = [recordLine.id];
      if (conversation !== null) {
        const turns = await propose(
          {
            move: { family: "ask", verb: "remove-turns" },
            target: { kind: "ask", slug: card.slug },
            params: {},
            rationale: whyOf(
              payload,
              `removing the conversation of the ask card "${card.name}"`,
            ),
          },
          (id) => `with its conversation; ghost ${id}`,
        );
        if (!turns.ok || turns.id === undefined) return turns;
        ids.push(turns.id);
      }
      return {
        ok: true,
        line:
          `proposed removing the ask card "${card.name}"` +
          (conversation === null ? "" : ", with its conversation"),
        ids,
      };
    }
    const body = {
      move: { family: "card", verb: "remove" },
      target: { kind: "card", slug: card.slug },
      params: {},
      rationale: whyOf(payload, `removing the card "${card.name}"`),
    };
    return propose(
      body,
      (id) => `proposed removing the card "${card.name}"; ghost ${id}`,
    );
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


  /* ------------------------------------------------------------------ *
   * STORY 21.9 — THE READERS FOR THE OTHER TWO MAPS
   *
   * ADR-0038's 2026-11-20 amendment makes the command card a PRIMARY way to use
   * the app on every map, so the card has to be able to READ what stands on the
   * two maps whose acts are not designed yet. These readers are the app's half:
   * they go through the record families' OWN parsers over the SAME injected
   * bridge, and they answer NAMES and KINDS only. Nothing here writes, proposes
   * or stats a body: a word's memory and a claim's words are read out of the
   * files and then dropped at the door, because a read's line is prompt-adjacent
   * material and a body in it would be the leak the digest refuses.
   *
   * THE COMMITTED MODEL ONLY (PROVISIONAL): a running branch is a scenario
   * folder this seam does not know about, so these reads answer the map's own
   * records and never a branch's. The digest the card sends DOES follow the
   * branch (it is composed from the loaded view); these read acts are the
   * map's, and a branch's reads are a later story's business.
   * PROVISIONAL: the sentences and the twelve-name bound (readOverview's).
   * ------------------------------------------------------------------ */

  /** Names for slugs: a person reads a word, never its file name. */
  function nameMapOf(words: readonly ConceptWord[]): Record<string, string> {
    const names: Record<string, string> = {};
    for (const word of words) names[word.slug] = word.name;
    return names;
  }

  /** Every dynamics record, parsed through the caller's bridge. */
  interface DynamicsView {
    links: Link[];
    loops: Loop[];
    assumptions: Assumption[];
    quantities: Quantity[];
    model: PlayingSet | null;
    unreadable: number;
  }

  async function loadDynamicsView(): Promise<DynamicsView> {
    const recordsDir = mapDir(workspacePath);
    const [linksText, loopsText, assumptionsText, quantitiesText, modelText] =
      await Promise.all([
        io.readTextFile(linksPath(recordsDir)),
        io.readTextFile(loopsPath(workspacePath)),
        io.readTextFile(assumptionsPath(workspacePath)),
        io.readTextFile(quantitiesPath(recordsDir)),
        io.readTextFile(modelPath(recordsDir)),
      ]);
    // A missing file is an empty record set to every one of these parsers, so
    // the null the bridge answers is handed on as the empty text it means.
    const links = parseLinks(linksText ?? "");
    const loops = parseLoops(loopsText ?? "");
    const assumptions = parseAssumptions(assumptionsText ?? "");
    const quantities = parseQuantities(quantitiesText);
    const model = parseModel(modelText);
    return {
      links: links.links,
      loops: loops.loops,
      assumptions: assumptions.assumptions,
      quantities: quantities.quantities,
      model: model.model,
      unreadable:
        links.malformed.length +
        loops.malformed.length +
        assumptions.malformed.length +
        quantities.malformed.length +
        (model.malformed === null ? 0 : 1),
    };
  }

  /** A bounded, NAMES-ONLY list of the concept map's words (STORY 21.9). */
  async function readWords(): Promise<CommandOutcome> {
    const words = await listConceptWords(workspacePath, io);
    if (words.length === 0) {
      return { ok: true, line: "the concept map holds no words." };
    }
    const names = words.slice(0, 12).map((word) => `"${word.name}"`);
    const more =
      words.length > names.length
        ? ` and ${words.length - names.length} more`
        : "";
    return {
      ok: true,
      line: flat(
        `the concept map holds ${words.length} word(s): ${names.join(", ")}${more}.`,
      ),
    };
  }

  /** The concept map's shape: words and their distance wires (STORY 21.9). */
  async function readConceptOverview(): Promise<CommandOutcome> {
    const [words, text] = await Promise.all([
      listConceptWords(workspacePath, io),
      io.readTextFile(distancesPath(workspacePath)),
    ]);
    const distances = text === null ? { distances: [], malformed: [] } : parseDistances(text);
    const wordLine =
      words.length === 0 ? "no words" : `${words.length} word(s)`;
    const wireLine =
      distances.distances.length === 0
        ? "no distance wires"
        : `${distances.distances.length} distance wire(s)`;
    const unreadable =
      distances.malformed.length === 0
        ? "no unreadable lines"
        : `${distances.malformed.length} unreadable line(s)`;
    return {
      ok: true,
      line: flat(
        `the concept map holds ${wordLine} and ${wireLine}; ${unreadable}.`,
      ),
    };
  }

  /** The dynamics map's shape, by kind (STORY 21.9). */
  async function readDynamicsOverview(): Promise<CommandOutcome> {
    const [view, words] = await Promise.all([
      loadDynamicsView(),
      listConceptWords(workspacePath, io),
    ]);
    const names = nameMapOf(words);
    const play =
      view.model === null
        ? "no playing set yet"
        : `${view.model.words.length} word(s) in play` +
          (view.model.words.length === 0
            ? ""
            : ": " +
              view.model.words
                .slice(0, 12)
                .map((slug) => `"${names[slug] ?? slug}"`)
                .join(", "));
    const line = (count: number, one: string, many: string): string =>
      count === 0 ? one : `${count} ${many}`;
    const unreadable =
      view.unreadable === 0
        ? "no unreadable lines"
        : `${view.unreadable} unreadable line(s)`;
    return {
      ok: true,
      line: flat(
        `the dynamics map holds ${line(view.links.length, "no signed links", "signed link(s)")}, ${line(
          view.loops.length,
          "no named loops",
          "named loop(s)",
        )}, ${line(view.assumptions.length, "no claims", "claim(s)")} and ${line(
          view.quantities.length,
          "no quantities",
          "quantity line(s)",
        )}; ${play}; ${unreadable}.`,
      ),
    };
  }

  /**
   * STORY 21.9 — ONE MAP'S OVERVIEW, named by the act's own map field. The
   * ground map keeps the meaning it had in 21.1 (`map_overview` is that read);
   * the other two answer their own records' shape and change nothing.
   */
  async function readMap(map: CommandMap): Promise<CommandOutcome> {
    if (map === "concept") return readConceptOverview();
    if (map === "dynamics") return readDynamicsOverview();
    return readOverview();
  }

  /**
   * STORY 21.7 — WHAT THE ACCEPTED ASK GHOSTS LEFT WAITING, in accept order: a
   * card's slug and the question its composer should hold. Pure read of this
   * session's own notes; an id that carried no draft answers nothing.
   */
  function askDraftsFor(ids: readonly string[]): readonly AskDraftHint[] {
    const hints: AskDraftHint[] = [];
    for (const id of ids) {
      const hint = askDrafts.get(id);
      if (hint !== undefined) hints.push(hint);
    }
    return hints;
  }

  /**
   * STORY 21.8 — ONE AUDIT LINE PER ACCEPTED PLACE OR NAME, through the SAME
   * event constructors and the SAME append the drag and the name pill use
   * (ADR-0038 §8: every accepted ghost is audited, and a proposal is not). It
   * runs AFTER the record write the line describes, exactly as the app's own
   * queue does; a same-point move and a same-name proposal write NOTHING,
   * because the record changed nothing. The audit never fails the accept: the
   * records landed first and the log simply says it could not follow.
   */
  async function auditAccepted(id: string): Promise<void> {
    const audit = audits.get(id);
    if (audit === undefined) return;
    try {
      // STORY 21.11 — a rebind is not an authored history line (the card's own
      // rebind verb logs none), so there is nothing for the audit to append.
      if (audit.kind === "bind") return;
      if (audit.kind === "move") {
        if (audit.fromX === audit.toX && audit.fromY === audit.toY) return;
        await appendEvents(
          workspacePath,
          [cardMoveEvent(Date.now(), audit.slug, audit.toX, audit.toY)],
          { readTextFile: io.readTextFile, writeTextFile: io.writeTextFile },
        );
        return;
      }
      if (audit.from === audit.to) return;
      await appendEvents(
        workspacePath,
        [
          cardRenameEvent(
            Date.now(),
            audit.family,
            audit.slug,
            audit.from,
            audit.to,
          ),
        ],
        { readTextFile: io.readTextFile, writeTextFile: io.writeTextFile },
      );
    } catch {
      // The record write stands; the log could not follow (the app's own rule).
    }
  }

  /**
   * STORY 21.8 — THE APPLIED ACTS WITH THE VALUE EACH ONE TOOK BACK FROM. The
   * command card stores THESE acts in the exchange, so "undo that" can offer the
   * same act with the previous point or the previous name without inventing
   * either. The keys are app-minted view state: validateAct refuses them from a
   * model's payload, and no record ever carries them.
   */
  function enrichedActsOf(
    acts: readonly CommandAct[],
    actIds: readonly (readonly string[])[],
  ): readonly CommandAct[] {
    return acts.map((act, index) => {
      const ids = actIds[index] ?? [];
      if (ids.length !== 1) return act;
      const audit = audits.get(ids[0]!);
      if (audit === undefined) return act;
      if (audit.kind === "rename") {
        return {
          ...act,
          payload: { ...act.payload, previousName: audit.from },
        };
      }
      if (audit.kind === "bind") {
        // STORY 21.11 — the row the card ran, for "undo that" after a rebind.
        return {
          ...act,
          payload: { ...act.payload, previousTool: audit.from },
        };
      }
      return {
        ...act,
        payload: {
          ...act.payload,
          previousX: audit.fromX,
          previousY: audit.fromY,
        },
      };
    });
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
      const outcome = await session.accept(id, { ...CONTEXT });
      answers.push({ id, outcome });
      // STORY 21.8 — ONE audit line for a place or a name that actually changed
      // its record; a no-op accept logs nothing.
      if (outcome.outcome === "applied") await auditAccepted(id);
    }
    return answers;
  }

  const host: CommandHost & {
    askDraftsFor: typeof askDraftsFor;
    enrichedActsOf: typeof enrichedActsOf;
    accept: typeof accept;
    session: GhostSession;
  } = {
    readOverview,
    readCard,
    readWires,
    // STORY 21.9 — the two reads the other maps answer with.
    readWords,
    readMap,
    proposeCard,
    proposeWire,
    proposeNote,
    proposeAsk,
    proposeUnwire,
    proposeRemoveNote,
    proposeRemoveCard,
    proposeMove,
    proposeRename,
    // STORY 21.11 — the session card's three acts.
    proposeSession,
    proposeBindSession,
    proposeRemoveSession,
    askDraftsFor,
    enrichedActsOf,
    accept,
    session,
  };
  return host;
}

/**
 * STORY 21.3 — ONE PRESS (ADR-0038 decision 4). The command card's accept runs
 * the WHOLE script through the executor, then accepts the ghosts it filed
 * through the SAME app accept the driver's --accept exercises. There is no
 * second confirmation here and no partial application: when the executor stops
 * at an act, NO ghost is accepted, so the map holds exactly what it held before
 * (the acts' earlier ghosts stay filed in the inbox, not applied).
 *
 * THE FAILURE IS THE APP'S OWN WORDS. A host refusal comes back exactly as the
 * executor spoke it; a refused ghost comes back through acceptLine. The card
 * turns the executor's run into the named failure report, so which act failed
 * and what did not apply are both said.
 */
export type CommandApply =
  | {
      ok: true;
      run: CommandRun;
      /**
       * STORY 21.7 — THE QUESTIONS WAITING IN THE COMPOSERS OF THE ASKS THIS
       * PRESS CREATED. A draft, never a record: the window is handed it here so
       * an unsent question lands in the card's field and nowhere else.
       */
      drafts: readonly AskDraftHint[];
      /**
       * STORY 21.8 — THE ACTS AS THEY APPLIED, each carrying the previous value
       * its inverse needs (view state only). The command card keeps THESE in the
       * exchange, so "undo that" after a place or a name offers the same act with
       * the point or the words the record had — never a guess.
       */
      applied: readonly CommandAct[];
    }
  | {
      ok: false;
      phase: "execution" | "accept" | "none";
      run: CommandRun | null;
      sentence: string;
    };

/** Apply one interpreter script in ONE press: execute it, then accept its ghosts. */
export async function applyCommandScript(
  acts: readonly CommandAct[],
  host: ReturnType<typeof createAttentioneerHost>,
): Promise<CommandApply> {
  const run = await executeScript(acts, host);
  if (!run.ok) {
    return {
      ok: false,
      phase: "execution",
      run,
      sentence: run.sentence ?? "the script stopped.",
    };
  }
  const accepted = await host.accept(run.ids);
  const refused = accepted.find(
    (answer) =>
      answer.outcome.outcome !== "applied" &&
      answer.outcome.outcome !== "already-applied",
  );
  if (refused !== undefined) {
    return {
      ok: false,
      phase: "accept",
      run,
      sentence: acceptLine(refused.id, refused.outcome),
    };
  }
  return {
    ok: true,
    run,
    drafts: host.askDraftsFor(run.ids),
    applied: host.enrichedActsOf(acts, run.actIds),
  };
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
