import { useState } from "react";
import { CanvasPlane } from "./canvas/CanvasPlane";
import { NoteCard } from "./canvas/NoteCard";
import { useCamera } from "./canvas/useCamera";
import { useNotes } from "./canvas/useNotes";
import { WorkspaceGate } from "./workspace/WorkspaceGate";
import type { Workspace } from "./workspace/lifecycle";

/**
 * One workspace per window (ADR-0002): the window is either the gate or an
 * open workspace's canvas, carrying its working notes (story 3).
 */
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const { camera, intents } = useCamera();
  const { notes, createNote, updateNote } = useNotes(workspace?.path ?? "");

  if (!workspace) {
    return <WorkspaceGate onOpen={setWorkspace} />;
  }

  return (
    <CanvasPlane
      camera={camera}
      intents={intents}
      onPlaneDoubleClick={(point) => createNote(point.x, point.y)}
    >
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} onChange={updateNote} />
      ))}
    </CanvasPlane>
  );
}

export default App;
