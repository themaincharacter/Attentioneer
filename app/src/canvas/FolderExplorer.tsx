import {
  explorerPathLine,
  explorerRows,
  rowAction,
  type ExplorerView,
} from "./explorerRules";

/**
 * STORY 20.2 (PROVISIONAL) — THE EXPLORER'S FACE: a quiet block on an
 * EXPANDED project card, above the kept reading, showing one level of the
 * folder as rows.
 *
 * It is the FACE only — it reads nothing, writes nothing and holds nothing:
 * the card owns the view state (the level the person walked to) and hands it
 * here, and the two callbacks are the card's own gestures. Keeping the face
 * apart is what lets a render test pin what the block shows without a bridge,
 * a DOM or a handler.
 *
 * The rows say only what the folder says: names, folders marked with the
 * trailing slash the kept listing uses. The one quiet line above them is the
 * path from the project root. Nothing here counts, sizes, orders by date or
 * offers a second verb; the sentence at the bottom appears only when a level
 * could not be read (or a file could not be opened), and it stands in place.
 */
export function FolderExplorerFace({
  folder,
  view,
  busy,
  onEnter,
  onAscend,
  onOpenFile,
}: {
  /** The project folder the card points at (its absolute path). */
  folder: string;
  /** Where the person is, what that level said, and its one sentence. */
  view: ExplorerView;
  /** A read is in flight: the rows wait rather than fire twice. */
  busy: boolean;
  /** One click on a folder row: read that level and go down. */
  onEnter: (name: string) => void;
  /** One click on the way up: read the level above. */
  onAscend: () => void;
  /** Double click on a file row: hand it to the OS's default handler. */
  onOpenFile: (name: string) => void;
}) {
  const rows = explorerRows(view.entries, view.segments.length > 0);
  return (
    <div className="ground-explorer">
      <div className="ground-explorer-path">
        {explorerPathLine(folder, view.segments)}
      </div>
      <div className="ground-explorer-rows">
        {rows.map((row) => {
          const action = rowAction(row);
          // A descent is ONE click, so the SECOND click of a double click is
          // ignored (the browser says which it is): a person tapping twice on
          // a folder walks in once instead of two levels down. A press from
          // the keyboard reports detail 0 and still walks in. Files have no
          // click at all — they wait for the double click.
          const onPress =
            action === "ascend"
              ? (event: { detail: number }) => {
                  if (event.detail < 2) onAscend();
                }
              : action === "descend"
                ? (event: { detail: number }) => {
                    if (event.detail < 2) onEnter(row.name as string);
                  }
                : undefined;
          return (
            <button
              key={row.kind + ":" + row.label}
              type="button"
              className={
                row.isDir
                  ? "ground-explorer-row ground-explorer-dir"
                  : "ground-explorer-row"
              }
              disabled={busy}
              onClick={onPress}
              onDoubleClick={
                action === "open"
                  ? () => onOpenFile(row.name as string)
                  : undefined
              }
            >
              {row.label}
            </button>
          );
        })}
      </div>
      {view.problem !== null && (
        <div className="ground-explorer-problem">{view.problem}</div>
      )}
    </div>
  );
}
