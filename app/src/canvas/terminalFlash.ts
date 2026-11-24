/**
 * STORY 24-3 (ADR-0043) — THE ONE-SHOT. A terminal (a wire's clamp or a card's
 * link handle) flashes ONCE when a connection lands and then settles: no
 * repeat, no glow, nothing ambient. Under `prefers-reduced-motion` there is no
 * flash at all — removed, not shortened (the stylesheet carries the same rule
 * for anything that wears the class without going through here).
 */
export function flashTerminal(element: Element | null): void {
  if (element === null) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.classList.remove("terminal-flash");
  // A forced reflow lets the class re-add restart the animation on one frame.
  void (element as HTMLElement).offsetWidth;
  element.classList.add("terminal-flash");
  element.addEventListener(
    "animationend",
    () => element.classList.remove("terminal-flash"),
    { once: true },
  );
}

/** How long to wait for a landed wire to be drawn before giving up (frames,
    PROVISIONAL — a stated bound, never an open watch). */
const WIRE_WATCH_FRAMES = 120;

/**
 * WHEN A LANDED WIRE APPEARS, its two clamps and the two terminals it joins
 * flash once. The write is asynchronous, so the flash waits for the wire's own
 * elements to exist — up to the stated bound — and gives up silently when no
 * wire was drawn: a refused write connects nothing, so nothing flashes.
 */
export function flashLandedWireWhenDrawn(from: string, to: string): void {
  let frames = 0;
  const look = () => {
    const wire = document.querySelector(
      '.ground-wire[data-from="' +
        CSS.escape(from) +
        '"][data-to="' +
        CSS.escape(to) +
        '"]',
    );
    if (wire === null) {
      if (frames < WIRE_WATCH_FRAMES) {
        frames += 1;
        requestAnimationFrame(look);
      }
      return;
    }
    for (const clamp of wire.querySelectorAll(".ground-wire-clamp")) {
      flashTerminal(clamp);
    }
    for (const slug of [from, to]) {
      const handle = document.querySelector(
        '.ground-reference[data-slug="' +
          CSS.escape(slug) +
          '"] .ground-link-handle, .ask-card[data-slug="' +
          CSS.escape(slug) +
          '"] .ground-link-handle, .session-card[data-slug="' +
          CSS.escape(slug) +
          '"] .ground-link-handle',
      );
      flashTerminal(handle);
    }
  };
  requestAnimationFrame(look);
}
