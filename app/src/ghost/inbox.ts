import { serializeEnvelope, type GhostEnvelope } from "./envelope";
import type { GhostFs } from "./port";

/**
 * `.attentioneer/inbox/` — where one ghost lives between intake and accept
 * (Epic 10 story 1, ADR-0024 decision 5).
 *
 * The inbox is DERIVED AND DISPOSABLE: its files are not records, no record
 * points at them, and losing one loses nothing the person authored (re-proposal
 * is manual). One file per ghost (`<id>.json`, canonical envelope JSON through
 * `serialize.ts`) plus an in-flight marker (`<id>.marker`, an exclusive-create
 * file the accept owns). At OPEN the whole inbox is DISCARDED — envelopes and
 * markers both — so a proposal from an earlier session is refused by replay
 * (the app-minted id is in-session only) and a marker is never resumed.
 *
 * Provisional: the folder name, the two suffixes, and `.attentioneer/` being at
 * the workspace root (ADR-0004's layout left the app's scratch area unnamed).
 */

/** The inbox folder (workspace-relative; PROVISIONAL). */
export const INBOX_DIR = ".attentioneer/inbox";

/** What the folder looks like after an open: what was discarded, by kind. */
export interface DiscardReport {
  /** Envelope files removed. */
  envelopes: number;
  /** In-flight markers removed. */
  markers: number;
}

/** The inbox folder's absolute path. */
export function inboxDir(workspacePath: string): string {
  return `${workspacePath}/${INBOX_DIR}`;
}

/** The envelope file's absolute path for one app-minted id. */
export function inboxEnvelopePath(workspacePath: string, id: string): string {
  return `${inboxDir(workspacePath)}/${id}.json`;
}

/** The in-flight marker's absolute path for one app-minted id. */
export function inboxMarkerPath(workspacePath: string, id: string): string {
  return `${inboxDir(workspacePath)}/${id}.marker`;
}

/** Is a folder entry an envelope file the app wrote? */
export function isInboxEnvelopeName(name: string): boolean {
  return name.endsWith(".json");
}

/** Is a folder entry an in-flight marker the app wrote? */
export function isInboxMarkerName(name: string): boolean {
  return name.endsWith(".marker");
}

/**
 * Discard the inbox at open: every envelope file and every marker goes. The app
 * only removes files it wrote (`*.json`/`*.marker`); anything else a person
 * put there is left alone. This is the open moment's rule, not a cleanup pass
 * mid-session.
 */
export async function discardInbox(
  workspacePath: string,
  fs: GhostFs,
): Promise<DiscardReport> {
  const dir = inboxDir(workspacePath);
  const report: DiscardReport = { envelopes: 0, markers: 0 };
  for (const name of await fs.list(dir)) {
    if (isInboxEnvelopeName(name)) {
      await fs.remove(`${dir}/${name}`);
      report.envelopes += 1;
    } else if (isInboxMarkerName(name)) {
      await fs.remove(`${dir}/${name}`);
      report.markers += 1;
    }
  }
  return report;
}

/** Write one ghost into the inbox (canonical JSON); returns its path. */
export async function writeInboxEnvelope(
  workspacePath: string,
  envelope: GhostEnvelope,
  fs: GhostFs,
): Promise<string> {
  const dir = inboxDir(workspacePath);
  await fs.createDirAll(dir);
  const path = inboxEnvelopePath(workspacePath, envelope.id);
  await fs.writeText(path, serializeEnvelope(envelope));
  return path;
}

/** One ghost's envelope bytes, or null when it is gone. */
export async function readInboxEnvelope(
  workspacePath: string,
  id: string,
  fs: GhostFs,
): Promise<string | null> {
  return await fs.readText(inboxEnvelopePath(workspacePath, id));
}

/** Remove one ghost from the inbox (accept's last step, or reject). */
export async function removeInboxEnvelope(
  workspacePath: string,
  id: string,
  fs: GhostFs,
): Promise<void> {
  await fs.remove(inboxEnvelopePath(workspacePath, id));
}

/**
 * Claim the in-flight marker EXCLUSIVELY: true when this accept created it,
 * false when one already existed (a stale marker from an earlier attempt). The
 * marker is never a lock: the accept's reconcile decides what a pre-existing
 * marker means, and a stale one is released and re-claimed.
 */
export async function claimInboxMarker(
  workspacePath: string,
  id: string,
  fs: GhostFs,
): Promise<boolean> {
  await fs.createDirAll(inboxDir(workspacePath));
  return await fs.createMarkerExclusive(inboxMarkerPath(workspacePath, id));
}

/** Release the in-flight marker (a missing marker is a quiet no-op). */
export async function releaseInboxMarker(
  workspacePath: string,
  id: string,
  fs: GhostFs,
): Promise<void> {
  await fs.remove(inboxMarkerPath(workspacePath, id));
}
