import { useEffect, useRef } from "react";
import type { LanguageGame } from "../map/languageGames";
import {
  GAME_REMOVE_LABEL,
  GAMES_CLOSE_LABEL,
  GAMES_EMPTY_LINE,
  GAMES_PANEL_LABEL,
  GAMES_PANEL_TITLE,
  gameInk,
} from "./languageGameRules";

/**
 * ALL LANGUAGE GAMES (PROVISIONAL, added 2026-11-16 per the lead's brief): a
 * quiet right-side panel listing every saved game — the person's comparison
 * was a layers panel in a drawing app, and this is its plainest reading. Each
 * row is the game's COLOUR SWATCH and its NAME, and nothing else.
 *
 * TWO things a row can do:
 *
 *   - PICK: the game comes FORWARD visually (the app paints its fill more
 *     opaquely than the rest) and the map CENTRES on the game's shape (the
 *     app's camera intent). The row in force is marked.
 *   - DELETE: the trash-bin icon retires the game — the family's designed
 *     exit, the veil's "retired by deletion": the line goes through the
 *     record's ordinary save path, with no confirmation dialog and no
 *     tombstone. A quiet × in the panel's head closes the panel itself.
 *
 * It is a fixed panel OUTSIDE `.plane` beside the app's other quiet surfaces,
 * so the plane's armed gate never reaches it and no press on a row can pan,
 * create or start a word gesture. Esc or its quiet × closes it; the level
 * control's door toggles it (a press AWAY does not close it: the door IS an
 * outside press, and a press-away rule would close the list and the door's own
 * click would open it again — one press, two moves). It writes nothing itself:
 * the app holds the picks and runs the deletes.
 *
 * The panel is CONCEPT-MAP content (its door lives beside the tool, concept
 * only), so the app renders it only where language games live. Nothing here
 * ranks, scores or nudges: the list is the list, in the order the games were
 * made.
 */
interface LanguageGamesPanelProps {
  /** Every saved game, in FILE ORDER (the order they were made). */
  games: readonly LanguageGame[];
  /** The game brought forward right now, or null. */
  focused: string | null;
  /** Bring a game forward and centre the map on its shape. */
  onPick: (game: LanguageGame) => void;
  /** Delete a game by its name (the designed exit). */
  onRemove: (name: string) => void;
  /** Close the panel (its × or Esc). */
  onClose: () => void;
}

export function LanguageGamesPanel({
  games,
  focused,
  onPick,
  onRemove,
  onClose,
}: LanguageGamesPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Opening moves focus into the list (the window idiom).
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Esc closes it (the window's close idiom).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="language-games-panel"
      role="dialog"
      aria-label={GAMES_PANEL_LABEL}
      tabIndex={-1}
    >
      <div className="language-games-head">
        <span className="language-games-title">{GAMES_PANEL_TITLE}</span>
        <button
          type="button"
          className="language-games-close"
          aria-label={GAMES_CLOSE_LABEL}
          title="close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {games.length === 0 ? (
        <div className="language-games-empty">{GAMES_EMPTY_LINE}</div>
      ) : (
        <ul className="language-games-list">
          {games.map((game, index) => (
            <li
              key={`language-game-${index}-${game.name}`}
              className={
                "language-game-row" +
                (focused === game.name ? " focused" : "")
              }
            >
              <button
                type="button"
                className="language-game-pick"
                aria-pressed={focused === game.name}
                title={`bring “${game.name}” forward and centre the map on it`}
                onClick={() => onPick(game)}
              >
                <span
                  className="language-game-swatch"
                  aria-hidden="true"
                  style={{ background: gameInk(game.color) }}
                />
                <span className="language-game-game-name">{game.name}</span>
              </button>
              <button
                type="button"
                className="language-game-remove"
                aria-label={GAME_REMOVE_LABEL}
                title={GAME_REMOVE_LABEL}
                onClick={() => onRemove(game.name)}
              >
                <svg
                  className="language-game-trash"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M2.8 4.2h10.4M6.4 4.2V2.9h3.2v1.3M4.3 4.2l.7 9.1h6l.7-9.1M6.7 6.6v4.4M9.3 6.6v4.4" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
