import { useEffect, useState } from "react";
import {
  findAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "../map/assumptions";
import { formatAmount, parseAmountInput, type QuantityTarget } from "../map/quantities";
import type { Scenario } from "../scenarios/branch";
import type { BridgeActions } from "../scenarios/bridge";
import type {
  CompareRefusal,
  CompareRow,
  CompareValue,
  Comparison,
} from "../scenarios/compare";
import {
  compareValueText,
  comparisonRefusalText,
  dangleText,
  DANGLE_CLEARING,
  provenanceSentence,
  STANDING_DRIFT,
  unpinnedClaimText,
} from "./compareNotes";
import type { NameOf } from "./notices";

interface ComparePanelProps {
  /** The branches this workspace holds — the explicit pick's list. */
  branches: readonly Scenario[];
  /** The branch picked this session (null = not picked yet). Never the hint. */
  picked: string | null;
  /** The frozen reading of the picked branch (null until a read lands). */
  comparison: Comparison | null;
  /** The frame's refusal, if the pick was not a legal frame. */
  refusal: CompareRefusal | null;
  /**
   * The committed claims, LIVE: the dangle's revise is the ordinary in-place
   * edit of `map/assumptions.jsonl`, so the field always edits the line that
   * stands now, not a frozen copy of it.
   */
  assumptions: readonly Assumption[];
  /** The person's name for a slug (names-not-slugs, the notices rule). */
  nameOf: NameOf;
  /** The bridge: every door is ONE ordinary deliberate edit, never an apply. */
  bridge: BridgeActions;
  /** Read one branch (an explicit pick of this session). */
  onPick: (slug: string) => void;
  /** Read the picked branch again (a reading — it resets nothing). */
  onReRead: () => void;
  /** Close the panel. */
  onClose: () => void;
}

/**
 * The comparison (Epic 8 story 4): a quiet, FROZEN, two-value reading of one
 * branch against the committed model.
 *
 * The panel holds no reading of its own: it renders the value the app froze
 * when the branch was picked, and pressing "re-read" asks for another one.
 * That is why the surface never flickers while a record changes underneath —
 * a live recompute would be the diff the ruling forbids, and it would also
 * hide the evidence a re-read is for. Between reads nothing moves; a read
 * writes nothing and resets nothing.
 *
 * Each row is ONE provenance sentence ("branch (authored): … / committed
 * (now): …") — never two columns, never a delta, never the word that would
 * classify the pair. Beside the sentence stands the bridge: the family's
 * ordinary deliberate edits — an amount field that authors or replaces a
 * line, a quiet × that removes one, a sign flipped in place, a word joined or
 * pruned, and (on a dangling premise) the claim's own in-place revise. There is
 * NO "apply the branch" door anywhere: a branch's values are what the row
 * SHOWS, never what a button copies.
 *
 * The branch's premises are said ONCE, under the rows: each dangling pin in
 * the present tense ("the committed model no longer says …"), and once, what
 * clears one (branching again — delete and branch). The dangle is not a row: a
 * premise is a claim about the branch, not a value of a piece.
 *
 * Esc and the × close it. Nothing here is written; every quiet write belongs to
 * a door the person pressed.
 *
 * Provisional (ADR-0003): the layout, the labels and the door wording.
 */
export function ComparePanel({
  branches,
  picked,
  comparison,
  refusal,
  assumptions,
  nameOf,
  bridge,
  onPick,
  onReRead,
  onClose,
}: ComparePanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickedName =
    picked === null
      ? null
      : (branches.find((scenario) => scenario.slug === picked)?.name ?? picked);

  return (
    <div className="compare" role="group" aria-label="the comparison">
      <div className="compare-head">
        <span className="compare-title">compare</span>
        {pickedName !== null && (
          <span className="compare-frame">“{pickedName}” with the map</span>
        )}
        <button
          type="button"
          className="compare-close"
          aria-label="close the comparison"
          title="close"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {refusal !== null && (
        <div className="compare-refusal">{comparisonRefusalText(refusal)}</div>
      )}

      <div className="compare-picker" role="group" aria-label="the branch to read">
        {branches.length === 0 ? (
          <span className="compare-quiet">
            no branches yet — branch the model in the chooser
          </span>
        ) : (
          branches.map((scenario) => (
            <button
              key={scenario.slug}
              type="button"
              className={
                "compare-pick" + (picked === scenario.slug ? " active" : "")
              }
              aria-pressed={picked === scenario.slug}
              title="read this branch against the committed model"
              onClick={() => onPick(scenario.slug)}
            >
              {scenario.name}
            </button>
          ))
        )}
      </div>

      {picked !== null && comparison !== null && (
        <>
          <div className="compare-drift">{STANDING_DRIFT}</div>
          <div className="compare-rows">
            {comparison.rows.map((row) => (
              <RowLine key={row.key} row={row} nameOf={nameOf} bridge={bridge} />
            ))}
          </div>
          {(comparison.dangles.length > 0 || comparison.unpinned.length > 0) && (
            <Dangles
              dangles={comparison.dangles}
              unpinned={comparison.unpinned}
              assumptions={assumptions}
              nameOf={nameOf}
              bridge={bridge}
            />
          )}
          <div className="compare-foot">
            <button
              type="button"
              className="compare-reread"
              title="read it again — a reading; nothing is written"
              onClick={onReRead}
            >
              re-read
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** One row: the provenance sentence, then the bridge's ordinary edits. */
function RowLine({
  row,
  nameOf,
  bridge,
}: {
  row: CompareRow;
  nameOf: NameOf;
  bridge: BridgeActions;
}) {
  return (
    <div className="compare-row">
      <span className="compare-row-text">{provenanceSentence(row, nameOf)}</span>
      <span className="compare-row-doors">
        <Doors row={row} bridge={bridge} />
      </span>
    </div>
  );
}

/**
 * The bridge's doors for one row — the ordinary deliberate edits, one press
 * each. Every door writes the COMMITTED model; none of them copies the
 * branch's value across.
 */
function Doors({ row, bridge }: { row: CompareRow; bridge: BridgeActions }) {
  const piece = row.piece;
  switch (piece.space) {
    case "set":
      return row.committed === null ? (
        <button
          type="button"
          className="compare-door"
          title="join it to the committed playing set"
          onClick={() => bridge.joinWord(piece.word)}
        >
          join
        </button>
      ) : (
        <button
          type="button"
          className="compare-door"
          title="take it out of the committed playing set"
          onClick={() => bridge.pruneWord(piece.word)}
        >
          prune
        </button>
      );
    case "links":
      return row.committed === null ? (
        <>
          <button
            type="button"
            className="compare-door"
            title="draw it in the committed model with a + sign"
            onClick={() => bridge.drawLink(piece.from, piece.to, "+")}
          >
            draw +
          </button>
          <button
            type="button"
            className="compare-door"
            title="draw it in the committed model with a − sign"
            onClick={() => bridge.drawLink(piece.from, piece.to, "-")}
          >
            draw −
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="compare-door"
            title="flip the committed line's sign in place"
            onClick={() => bridge.flipLink(piece.from, piece.to)}
          >
            flip
          </button>
          <button
            type="button"
            className="compare-door"
            aria-label="remove this link line from the committed model"
            title="remove the committed line"
            onClick={() => bridge.removeLink(piece.from, piece.to)}
          >
            ×
          </button>
        </>
      );
    case "quantities":
      return (
        <AmountDoor
          key={compareValueText(row.committed)}
          target={piece.target}
          line={row.committed}
          bridge={bridge}
        />
      );
  }
}

/**
 * A quantity line's door: the amount field (blank = the unknown) and the ×.
 * The field is prefilled with the committed amount, so a revise starts from
 * what stands now; Enter or "set" writes it, one deliberate edit.
 */
function AmountDoor({
  target,
  line,
  bridge,
}: {
  target: QuantityTarget;
  line: CompareValue | null;
  bridge: BridgeActions;
}) {
  const committed = line !== null && line.kind === "amount" ? line.amount : null;
  const [draft, setDraft] = useState(
    committed === null ? "" : formatAmount(committed),
  );

  function commit() {
    const parsed = parseAmountInput(draft);
    if (parsed.ok) bridge.setAmount(target, parsed.amount);
  }

  return (
    <span className="compare-amount">
      <input
        className="compare-amount-input"
        value={draft}
        placeholder="unknown"
        aria-label="this line's amount in the committed model"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          commit();
        }}
      />
      <button
        type="button"
        className="compare-door"
        title="author this line's amount in the committed model"
        onClick={commit}
      >
        set
      </button>
      {line !== null && (
        <button
          type="button"
          className="compare-door"
          aria-label="remove this line from the committed model"
          title="remove the committed line"
          onClick={() => bridge.removeLine(target)}
        >
          ×
        </button>
      )}
    </span>
  );
}

/**
 * The branch's premises, said once: every dangling pin in the present tense,
 * then the one sentence that says what clears a dangle. Shown here and never
 * per row.
 */
function Dangles({
  dangles,
  unpinned,
  assumptions,
  nameOf,
  bridge,
}: {
  dangles: readonly Assumption[];
  unpinned: readonly Assumption[];
  assumptions: readonly Assumption[];
  nameOf: NameOf;
  bridge: BridgeActions;
}) {
  return (
    <div className="compare-dangles">
      <div className="compare-dangle-head">the branch's premises</div>
      {dangles.map((pin, index) => (
        <div className="compare-dangle" key={`${index}\u0000${pin.text}`}>
          <div className="compare-dangle-text">{dangleText(pin, nameOf)}</div>
          <ClaimDoors
            target={pin.target}
            assumptions={assumptions}
            bridge={bridge}
          />
        </div>
      ))}
      {/* The committed-only claims: a claim the branch's pins do not cover
          gets its seat here, once — never a row. */}
      {unpinned.map((claim, index) => (
        <div
          className="compare-unpinned"
          key={`unpinned-${index}\u0000${claim.text}`}
        >
          {unpinnedClaimText(claim, nameOf)}
        </div>
      ))}
      {dangles.length > 0 && (
        <div className="compare-dangle-clearing">{DANGLE_CLEARING}</div>
      )}
    </div>
  );
}

/**
 * The committed claim(s) on a dangling pin's target — each with its in-place
 * revise, or one empty field to state a claim when none stands. The ordinary
 * assumption edit, reached from the comparison.
 */
function ClaimDoors({
  target,
  assumptions,
  bridge,
}: {
  target: AssumptionTarget;
  assumptions: readonly Assumption[];
  bridge: BridgeActions;
}) {
  const found = findAssumptions(assumptions, target);
  if (found.length === 0) {
    return (
      <ClaimDoor
        key={`${target.type}\u0000state`}
        target={target}
        assumption={null}
        text=""
        bridge={bridge}
      />
    );
  }
  return (
    <>
      {found.map((entry) => (
        <ClaimDoor
          key={`${entry.index}\u0000${entry.assumption.text}`}
          target={target}
          assumption={entry.assumption}
          text={entry.assumption.text}
          bridge={bridge}
        />
      ))}
    </>
  );
}

/** One committed claim as an in-place field: revise it, or state it. */
function ClaimDoor({
  target,
  assumption,
  text,
  bridge,
}: {
  target: AssumptionTarget;
  /** The committed claim line to revise, or null to state a new one. */
  assumption: Assumption | null;
  text: string;
  bridge: BridgeActions;
}) {
  const [draft, setDraft] = useState(text);

  function commit() {
    const claim = draft.trim();
    if (claim === "") return;
    if (assumption === null) bridge.stateClaim(target, claim);
    else bridge.reviseClaim(assumption, claim);
  }

  return (
    <span className="compare-claim">
      <input
        className="compare-claim-input"
        value={draft}
        placeholder="state a claim…"
        aria-label="this premise's claim in the committed model"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          commit();
        }}
      />
      <button
        type="button"
        className="compare-door"
        title={
          assumption === null
            ? "state this claim in the committed model"
            : "revise this claim in place in the committed model"
        }
        onClick={commit}
      >
        {assumption === null ? "state" : "revise"}
      </button>
    </span>
  );
}
