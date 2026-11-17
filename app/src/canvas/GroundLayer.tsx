import type { GroundReference } from "../map/ground";
import { readingFileName, type Reading } from "../map/readings";

/**
 * The ground map's own layer (story 16.1).
 *
 * The separate-maps rule (ADR-0032, `canvas/mapContentRules.ts`) keeps every
 * CONCEPT-map family off this map; this layer is the ground map's counterpart,
 * a sibling of the words and wires rather than a reuse of them. It draws one
 * ground reference per record: the person's coined name, the pointed-at file's
 * opening lines beneath it in a quiet body size, and the file's NAME (never
 * the full path) as the quiet handle. Nothing counts, sums or nudges; nothing
 * is inferred — every string here is either the person's words or bytes read
 * from the file they picked.
 *
 * It offers no action: story 1 draws ground references and nothing else (drag
 * and rename are story 2). Its classes are on the gate's content list, so a
 * double-click that lands on a reference is CONTENT and never opens another
 * creation bubble over the existing record.
 *
 * PROVISIONAL: the look — the name/body/handle sizes and the wrapping — is
 * ADR-0003's rendering seam, and the reading's cap/staleness wording arrives
 * with story 2.
 */
interface GroundLayerProps {
  /** Every readable ground reference, in FILE ORDER. */
  references: readonly GroundReference[];
  /** The reading lines, keyed by slug (the handle's source). */
  readings: readonly Reading[];
  /** The reading texts, keyed by slug (a missing text is absent). */
  texts: Readonly<Record<string, string>>;
}

export function GroundLayer({
  references,
  readings,
  texts,
}: GroundLayerProps) {
  const readingsBySlug = new Map(readings.map((reading) => [reading.on, reading]));
  return (
    <div className="ground-layer">
      {references.map((reference) => {
        const reading = readingsBySlug.get(reference.on) ?? null;
        const text = texts[reference.on];
        return (
          <div
            key={reference.on}
            className="ground-reference"
            style={{ left: reference.x, top: reference.y }}
            data-slug={reference.on}
          >
            <div className="ground-name">{reference.name}</div>
            {text !== undefined && text !== "" && (
              <div className="ground-reading">{text}</div>
            )}
            {reading !== null && (
              <div className="ground-handle">
                {readingFileName(reading.from)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
