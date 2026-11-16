/**
 * DEPRECATED AFFORDANCES — hidden 2026-11-16 per user review.
 *
 * The person played with the app and asked for the CONCEPT LAYER SIMPLIFIED:
 * a word coined at a point and a distance drawn between words, and nothing
 * else offered on the plane for now.
 *
 * NOTHING IS DELETED BY THIS PASS. Every component, every pure rule and every
 * piece of RECORD machinery stays exactly where it was — marks still parse and
 * serialize (`map/marks.ts`), the creation grammar still names each game's
 * kinds (`creationKinds`), the follow's targets and its anchored jump still
 * compute (`canvas/followRules.ts`), the veils still render. What changes is
 * the OFFER: each hiding point below reads one flag, keeps its markup/code
 * present, and simply does not render or hand the affordance over.
 *
 * Each hiding point carries the same comment, so the sweep can find them all:
 *   `// DEPRECATED (hidden 2026-11-16 per user review): <what and why> — delete`
 *   `// in the deprecated sweep`
 *
 * The flags are typed `boolean` (never the literal `true`) on purpose: the
 * hiding points must read them as a runtime fact, so the code paths they
 * suppress stay written and type-checked. Flipping a flag back to `false`
 * restores the affordance without touching the components.
 *
 * Provisional: the hiding (not deleting) posture is the review's own call; the
 * sweep that deletes these features is a later session's story.
 */

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the double-click creation
 * menu offered a `lack` in every game. The review asked for the ring menu to
 * offer ONLY the word option — delete in the deprecated sweep.
 */
export const LACK_CREATION_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): at dynamics the ring menu
 * grew a third kind, `assumption`. The review asked for the ring menu to offer
 * ONLY the word option — delete in the deprecated sweep.
 */
export const ASSUMPTION_CREATION_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the tentative mark's
 * user-facing affordances — the word's open ring, the wire's label ring, the
 * pointer row's ring — created and settled an open mark. The review asked for
 * the tentative feature to be hidden; the mark RECORD machinery stays (other
 * features read and write marks) — delete in the deprecated sweep.
 */
export const TENTATIVE_MARK_HIDDEN: boolean = true;

/**
 * DEPRECATED (hidden 2026-11-16 per user review): the word's follow control
 * (◎) offered the two OTHER games as a jump — the dynamics and ground "level
 * faces" the person picks on a word. The review asked for that selection to be
 * hidden, so a word shows its own name and its quiet controls and offers no
 * level faces — delete in the deprecated sweep.
 */
export const CROSS_LEVEL_FACES_HIDDEN: boolean = true;
