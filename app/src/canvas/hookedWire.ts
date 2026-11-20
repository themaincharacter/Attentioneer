/**
 * STORY 20.3 — THE WIRE A HOOKED CREATION OWES.
 *
 * A wire drag released on empty plane opens the ground map's create bubble at
 * that point, hooked to the card the drag began from. Whatever the person makes
 * through the bubble — a file reference, a project card, a page, a video, a
 * session card — gets ONE wire from that source, written through the layer's
 * existing link path (`useGround.link`: addGroundLink, its one history line,
 * its mirror), so a hooked wire cannot drift from a drawn one.
 *
 * This module decides ONLY which pair that is. It answers once: a claim is
 * spent by the first creation that lands, so a second press from the same
 * bubble cannot wire twice. A refusal, a cancel (which never reaches here) and
 * a creation that made nothing owe neither a card nor a wire.
 *
 * GENERIC BY CONSTRUCTION: no family is named here and none is asked. The card
 * that starts the drag is any card with a handle; the card that ends it is
 * whatever the bubble's own door made.
 *
 * PROVISIONAL: the shape, the once-only claim and the pair's direction (the
 * drag's source is `from`, as a drawn wire's is).
 */

/** The ordered pair the layer's one link write will take. */
export interface HookedWire {
  from: string;
  to: string;
}

/** What one creation handed back: whether it landed, and the card it made. */
export interface MadeCard {
  ok: boolean;
  created?: string;
}

/** One bubble's one wire. */
export interface WireClaim {
  /**
   * The wire this creation owes, or null when it owes none (a refusal, or a
   * creation that handed back no slug). A wired card SPENDS the claim: the
   * bubble's first landed card is its one result.
   */
  take(hookup: string | null, made: MadeCard): HookedWire | null;
}

/** A fresh claim: one wire, for one opened bubble. */
export function newWireClaim(): WireClaim {
  let spent = false;
  return {
    take(hookup, made) {
      if (spent || hookup === null || !made.ok) return null;
      const to = made.created;
      // A creation that handed back no slug cannot be wired; the claim stays
      // unspent, because nothing landed on the paper to wire.
      if (to === undefined || to === "") return null;
      // A card is never wired to itself, exactly as the drawn pair refuses.
      if (to === hookup) return null;
      spent = true;
      return { from: hookup, to };
    },
  };
}
