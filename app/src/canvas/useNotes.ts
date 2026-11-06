import { useCallback, useEffect, useRef, useState } from "react";
import { loadNotes, saveNote, type Note } from "../lib/notes";

/**
 * One workspace's working notes: load from disk, create drafts at a plane
 * point, persist on commit.
 */
export function useNotes(workspacePath: string) {
  const [notes, setNotes] = useState<Note[]>([]);
  const draftCount = useRef(0);

  useEffect(() => {
    if (!workspacePath) return;
    loadNotes(workspacePath).then(setNotes);
  }, [workspacePath]);

  /** Add an unsaved note at a plane point; it opens in edit mode. */
  const createNote = useCallback((x: number, y: number) => {
    draftCount.current += 1;
    const note: Note = {
      id: `draft-${draftCount.current}`,
      slug: null,
      title: "",
      x,
      y,
      body: "",
      extra: {},
    };
    setNotes((list) => [...list, note]);
  }, []);

  /** Persist a note (assigning its slug on first save) and refresh the list. */
  const updateNote = useCallback(
    (note: Note) => {
      saveNote(workspacePath, note).then((saved) => {
        setNotes((list) => list.map((n) => (n.id === note.id ? saved : n)));
      });
    },
    [workspacePath],
  );

  return { notes, createNote, updateNote };
}
