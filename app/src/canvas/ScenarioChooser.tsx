import { useEffect, useRef, useState } from "react";
import type { Scenario } from "../scenarios/branch";

interface ScenarioChooserProps {
  /**
   * The branch folders the workspace holds, in listing order: the chooser's
   * list. A branch that is not on disk is not offered (a crash leftover, a
   * folder without a header, is not a scenario).
   */
  scenarios: readonly Scenario[];
  /** The branch running now (null = the committed model). */
  active: string | null;
  /** Switch to a branch, or to the committed model (null). */
  onChoose: (slug: string | null) => void;
  /** Coin a branch's name and branch the committed model under it. */
  onBranch: (name: string) => void;
  /** Retire (delete) a branch's folder. */
  onRetire: (slug: string) => void;
}

/**
 * The scenario chooser (ADR-0021, Epic 8 story 2): the quiet list of the
 * branches this workspace holds, plus the committed model and the one action
 * that makes a branch.
 *
 * It lives in the level control's dynamics section — the game a variant
 * belongs to — and, like the control's other actions, OUTSIDE `.plane`, so the
 * plane's armed gate never reaches it and no plane gesture can start here. A
 * switch runs the app's full switch path (`App.tsx`): every transient closes,
 * the walk closes, the armed gestures cancel and the level pin is released,
 * then the resume hint is written through the workspace's one queue.
 *
 * QUIET, BY THE HOUSE RULES. The list is names, not counts or badges; the
 * committed model is named "the map" and comes first; the active one is
 * pressed. "branch…" opens ONE name field — only the person coins a name
 * (guardrail) — and Enter branches, Esc cancels, a blank name cancels. The ×
 * beside a branch RETIRES it: a scenario IS its folder, so retiring is
 * deleting, and there is no confirmation, no archive and no history
 * (ADR-0021 decisions 1 and 6 — ammo, no ceremony).
 *
 * Branching always copies the COMMITTED model (`map/`), never the variant
 * that happens to be running: a scenario is a model variant, not a second
 * model (ADR-0021 decision 6 — that door is Epic 11's). The new branch then
 * becomes the running one, which is the move the person just made.
 *
 * Provisional (ADR-0003/0021): the wording ("the map", "branch…", "retire"),
 * the order, the × and this control being the chooser's home.
 */
export function ScenarioChooser({
  scenarios,
  active,
  onChoose,
  onBranch,
  onRetire,
}: ScenarioChooserProps) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  function closeField() {
    setNaming(false);
    setDraft("");
  }

  function commit() {
    const trimmed = draft.trim();
    closeField();
    if (trimmed) onBranch(trimmed);
  }

  return (
    <div
      className="scenario-chooser"
      role="group"
      aria-label={`branches — now: ${active === null ? "the map" : active}`}
      data-active={active ?? ""}
    >
      <button
        type="button"
        className={"scenario-name" + (active === null ? " active" : "")}
        aria-pressed={active === null}
        title="the committed model — the map itself"
        onClick={() => onChoose(null)}
      >
        the map
      </button>
      {scenarios.map((scenario) => (
        <span className="scenario-entry" key={scenario.slug}>
          <button
            type="button"
            className={
              "scenario-name" + (active === scenario.slug ? " active" : "")
            }
            aria-pressed={active === scenario.slug}
            title={`branch: ${scenario.name}`}
            onClick={() => onChoose(scenario.slug)}
          >
            {scenario.name}
          </button>
          <button
            type="button"
            className="scenario-retire"
            title={`retire this branch (delete scenarios/${scenario.slug})`}
            aria-label={`retire ${scenario.name}`}
            onClick={() => onRetire(scenario.slug)}
          >
            ×
          </button>
        </span>
      ))}
      {naming ? (
        <input
          ref={inputRef}
          className="scenario-name-input"
          value={draft}
          placeholder="name the branch…"
          aria-label="name the branch"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              closeField();
            }
          }}
          onBlur={closeField}
        />
      ) : (
        <button
          type="button"
          className="scenario-branch"
          title="branch the model — copy it under a name"
          onClick={() => setNaming(true)}
        >
          branch…
        </button>
      )}
    </div>
  );
}
