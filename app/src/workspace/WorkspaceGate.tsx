import { useEffect, useState } from "react";
import { pickFolder } from "./dialogs";
import { createWorkspace, openWorkspace, workspaceName } from "./lifecycle";
import { loadRecents } from "./recents";
import type { Workspace } from "./lifecycle";
import "./gate.css";

interface WorkspaceGateProps {
  onOpen: (workspace: Workspace) => void;
}

/**
 * The quiet gate: create or open a workspace folder, or pick a recent one.
 * Shown whenever the window has no open workspace (one per window, ADR-0002).
 */
export function WorkspaceGate({ onOpen }: WorkspaceGateProps) {
  const [recents, setRecents] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadRecents().then(setRecents);
  }, []);

  async function handleCreate() {
    const path = await pickFolder("Choose the new workspace's folder");
    if (!path) return;
    onOpen(await createWorkspace(path));
  }

  async function handleOpen() {
    const path = await pickFolder("Open a workspace folder");
    if (!path) return;
    const workspace = await openWorkspace(path);
    if (!workspace) {
      setMessage("That folder is not an Attentioneer workspace.");
      return;
    }
    onOpen(workspace);
  }

  async function handleRecent(path: string) {
    const workspace = await openWorkspace(path);
    if (!workspace) {
      setMessage("That folder is not an Attentioneer workspace (it may have moved).");
      return;
    }
    onOpen(workspace);
  }

  return (
    <div className="gate">
      <div className="gate-panel">
        <h1>Attentioneer</h1>
        <div className="gate-actions">
          <button type="button" onClick={handleCreate}>
            Create workspace…
          </button>
          <button type="button" onClick={handleOpen}>
            Open workspace…
          </button>
        </div>
        {message && <p className="gate-message">{message}</p>}
        {recents.length > 0 && (
          <div className="gate-recents">
            <div className="gate-recents-label">Recent</div>
            {recents.map((path) => (
              <button
                key={path}
                type="button"
                className="gate-recent"
                onClick={() => handleRecent(path)}
              >
                <span className="gate-recent-name">{workspaceName(path)}</span>
                <span className="gate-recent-path">{path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
