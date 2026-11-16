import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { GhostEnvelope } from "../src/ghost/envelope";
import type { GhostFs } from "../src/ghost/port";
import { readEnvelope } from "../src/ghost/envelope";

/**
 * The ghost tests' REAL-FILESYSTEM harness (Epic 10 story 1).
 *
 * No test in this repo had ever asserted against bytes it wrote: the fs bridge
 * is Tauri's, and the tests' only `node:fs` use was reading source files. The
 * ghost's marker/crash matrix cannot be honest without a filesystem, so this
 * harness supplies a node:fs adapter for the ghost's PORT over a temp
 * workspace. The production port is still the Tauri bridge; the harness is the
 * same interface, so the tested code is the shipped code.
 *
 * The seed is a tiny committed map: two words (rain, soil), one named loop and
 * one standing assumption — enough for a word target, a loop target and a base
 * file with bytes.
 */
export interface Workspace {
  /** The temp workspace root. */
  path: string;
  /** The real-fs port the session is built with. */
  fs: GhostFs;
  /** A workspace file's bytes, relative to the root (null when absent). */
  read(relative: string): string | null;
  /** Write a workspace file, relative to the root (parents created). */
  write(relative: string, content: string): void;
  /** A workspace file's absolute path. */
  file(relative: string): string;
  /** Does the workspace file exist? */
  exists(relative: string): boolean;
  /** Delete the workspace (always safe to call twice). */
  dispose(): void;
}

/** A node:fs-backed GhostFs, the production port's interface exactly. */
export function nodeGhostFs(): GhostFs {
  return {
    async readText(path) {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async writeText(path, content) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    },
    async remove(path) {
      rmSync(path, { force: true });
    },
    async list(path) {
      try {
        return readdirSync(path).sort();
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
    },
    async createDirAll(path) {
      mkdirSync(path, { recursive: true });
    },
    async createMarkerExclusive(path) {
      mkdirSync(dirname(path), { recursive: true });
      try {
        const fd = openSync(path, "wx");
        closeSync(fd);
        return true;
      } catch (error) {
        if (isExists(error)) return false;
        throw error;
      }
    },
  };
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function isExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "EEXIST"
  );
}

/** The seed: two words, one loop, one standing claim (canonical JSONL). */
function seed(path: string): void {
  mkdirSync(join(path, "map/references"), { recursive: true });
  writeFileSync(
    join(path, "map/references/rain.md"),
    '---\nname: "rain"\nx: 0\ny: 0\n---\n',
    "utf8",
  );
  writeFileSync(
    join(path, "map/references/soil.md"),
    '---\nname: "soil"\nx: 120\ny: 0\n---\n',
    "utf8",
  );
  writeFileSync(
    join(path, "map/loops.jsonl"),
    '{"name":"the water cycle","path":["rain","soil","rain"]}\n',
    "utf8",
  );
  writeFileSync(
    join(path, "map/assumptions.jsonl"),
    '{"on":"soil","text":"the soil holds water"}\n',
    "utf8",
  );
}

/** A fresh temp workspace with the seed (the caller disposes it). */
export function workspace(): Workspace {
  const path = mkdtempSync(join(tmpdir(), "attentioneer-ghost-"));
  seed(path);
  return {
    path,
    fs: nodeGhostFs(),
    read(relative) {
      const file = join(path, relative);
      try {
        return readFileSync(file, "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    write(relative, content) {
      const file = join(path, relative);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, "utf8");
    },
    file(relative) {
      return join(path, relative);
    },
    exists(relative) {
      return existsSync(isAbsolute(relative) ? relative : join(path, relative));
    },
    dispose() {
      rmSync(path, { recursive: true, force: true });
    },
  };
}

/** Run a test body over a fresh workspace, disposing it whatever happens. */
export async function withWorkspace<T>(
  body: (workspace: Workspace) => Promise<T> | T,
): Promise<T> {
  const scratch = workspace();
  try {
    return await body(scratch);
  } finally {
    scratch.dispose();
  }
}

/** A model reply carrying a valid v1 patch body (overridable field by field). */
export function agentReply(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    move: { family: "assumption", verb: "add" },
    target: { kind: "word", slug: "rain" },
    params: { text: "rain follows the soil's temperature" },
    rationale: "the pair is on the map with no claim about it",
    ...overrides,
  });
}

/** Read one inbox envelope back as the app's envelope type. */
export function readFiledEnvelope(
  scratch: Workspace,
  id: string,
): GhostEnvelope {
  const text = scratch.read(`.attentioneer/inbox/${id}.json`);
  if (text === null) throw new Error(`no filed envelope for ${id}`);
  const read = readEnvelope(text);
  if (read.value === null) throw new Error(read.problems.join("; "));
  return read.value as unknown as GhostEnvelope;
}

/** A recording fs wrapper: what the accept did, in order, and when. */
export interface FsTrace {
  /** The calls the ghost made, in order ("marker" / "write" / "remove"). */
  calls: string[];
  /** Was the marker on disk when each write started? */
  markerAtWrite: boolean[];
  /** The marker's bytes at each write (empty: a sentinel, not a record). */
  markerContentAtWrite: string[];
}

export function tracedFs(base: GhostFs): { fs: GhostFs; trace: FsTrace } {
  const trace: FsTrace = { calls: [], markerAtWrite: [], markerContentAtWrite: [] };
  let lastMarker: string | null = null;
  return {
    trace,
    fs: {
      readText: (path) => base.readText(path),
      async writeText(path, content) {
        trace.calls.push("write");
        const marker =
          lastMarker !== null && existsSync(lastMarker) ? lastMarker : null;
        trace.markerAtWrite.push(marker !== null);
        trace.markerContentAtWrite.push(
          marker === null ? "" : readFileSync(marker, "utf8"),
        );
        await base.writeText(path, content);
      },
      async remove(path) {
        trace.calls.push("remove");
        await base.remove(path);
      },
      list: (path) => base.list(path),
      createDirAll: (path) => base.createDirAll(path),
      async createMarkerExclusive(path) {
        trace.calls.push("marker");
        lastMarker = path;
        return await base.createMarkerExclusive(path);
      },
    },
  };
}
