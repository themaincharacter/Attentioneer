/**
 * STORY 25-2 (ADR-0046) — a MOUNT for the paged text, standing in for a
 * browser. A static render cannot show the cue: the page count comes from ONE
 * measurement (the hidden copy's height over the flow's page box), and the
 * cue exists only when that division says more than one page. This harness
 * speaks the renderer's own seam — React's hook dispatcher and ref attachment
 * — and measures in LINES (a DOM measures pixels; the ratio is the same): one
 * page is `linesPerPage` content lines, the hidden measure is the whole
 * text's line total. What the component does with those two numbers (the
 * division, the gate, the flip) stays the component's own business.
 */
import * as React from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PagedText } from "../src/reading/PagedText";

type RefCell = { current: unknown };
type AnyProps = Record<string, unknown>;
type AnyElement = ReactElement<AnyProps>;

/** The text a body carries, counted the way the flow breaks it: by lines. */
function textLines(node: ReactNode): number {
  const leaves: string[] = [];
  const walk = (child: ReactNode): void => {
    if (child === null || child === undefined || typeof child === "boolean")
      return;
    if (typeof child === "string" || typeof child === "number") {
      leaves.push(String(child));
      return;
    }
    if (Array.isArray(child)) {
      for (const one of child) walk(one);
      return;
    }
    const element = child as unknown as AnyElement;
    if (element.props !== undefined) walk(element.props.children as ReactNode);
  };
  walk(node);
  return leaves.join("").split("\n").length;
}

function eachElement(
  node: ReactNode,
  visit: (element: AnyElement) => void,
): void {
  if (Array.isArray(node)) {
    for (const one of node) eachElement(one, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const element = node as unknown as AnyElement;
  if (element.props === undefined) return;
  visit(element);
  eachElement(element.props.children as ReactNode, visit);
}

type EffectSlot = {
  fn: () => void | (() => void);
  deps: unknown[] | undefined;
  lastDeps: unknown[] | undefined;
  ran: boolean;
  cleanup: (() => void) | undefined;
};

export type PagedMount = {
  /** The mounted tree's markup, refreshed after every flip. */
  html: string;
  /** The cue button's own markup past one page; null when the content fits. */
  cue: string | null;
  /** Press the cue: advance one page (wrapping around), view state only. */
  flip(): void;
};

export function mountPagedText(
  children: ReactNode,
  linesPerPage: number,
): PagedMount {
  const onePage = linesPerPage;
  const wholeText = textLines(children);
  const internals = (
    React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
        H: unknown;
      };
    }
  ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const outer = internals.H;

  const cells: unknown[] = [];
  const effects = new Map<number, EffectSlot>();
  let hook = 0;
  let stateChanged = false;

  const dispatcher = {
    useRef(init: unknown) {
      const at = hook++;
      if (cells[at] === undefined) cells[at] = { current: init };
      return cells[at];
    },
    useState(init: unknown) {
      const at = hook++;
      if (cells[at] === undefined) {
        cells[at] =
          typeof init === "function" ? (init as () => unknown)() : init;
      }
      const set = (next: unknown) => {
        const value =
          typeof next === "function"
            ? (next as (was: unknown) => unknown)(cells[at])
            : next;
        if (value !== cells[at]) {
          cells[at] = value;
          stateChanged = true;
        }
      };
      return [cells[at], set];
    },
    useEffect(fn: () => void | (() => void), deps?: unknown[]) {
      const at = hook++;
      const slot = effects.get(at) ?? {
        fn,
        deps,
        lastDeps: undefined,
        ran: false,
        cleanup: undefined,
      };
      slot.fn = fn;
      slot.deps = deps;
      effects.set(at, slot);
    },
  };

  function due(slot: EffectSlot): boolean {
    if (!slot.ran) return true;
    const now = slot.deps;
    const before = slot.lastDeps;
    if (now === undefined || before === undefined) return true;
    return (
      now.length !== before.length ||
      now.some((value, at) => !Object.is(value, before[at]))
    );
  }

  /** Refs land on measured stand-ins the way a renderer attaches them. */
  function attach(tree: AnyElement): void {
    eachElement(tree, (element) => {
      const ref = element.props.ref as RefCell | null | undefined;
      if (ref === null || ref === undefined) return;
      const name = String(element.props.className ?? "");
      if (name === "paged-flow") ref.current = { clientHeight: onePage };
      else if (name === "paged-measure")
        ref.current = { scrollHeight: wholeText };
    });
  }

  let settled: AnyElement | null = null;

  function render(): AnyElement {
    hook = 0;
    internals.H = dispatcher;
    try {
      return PagedText({ children, linesPerPage }) as unknown as AnyElement;
    } finally {
      internals.H = outer;
    }
  }

  function settle(): void {
    for (let pass = 0; pass < 10; pass += 1) {
      stateChanged = false;
      const tree = render();
      attach(tree);
      let ranEffect = false;
      for (const slot of effects.values()) {
        if (!due(slot)) continue;
        slot.ran = true;
        slot.lastDeps = slot.deps;
        if (slot.cleanup !== undefined) {
          slot.cleanup();
          slot.cleanup = undefined;
        }
        const cleanup = slot.fn();
        slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
        ranEffect = true;
      }
      if (!stateChanged && !ranEffect) {
        settled = tree;
        return;
      }
    }
    throw new Error("the paged text never settled");
  }

  function cueButton(tree: AnyElement): AnyElement | null {
    let found: AnyElement | null = null;
    eachElement(tree, (element) => {
      const tokens = String(element.props.className ?? "").split(/\s+/);
      if (tokens.includes("paged-cue")) found = element;
    });
    return found;
  }

  function refresh(): void {
    if (settled === null) throw new Error("the paged text is not mounted");
    mount.html = renderToStaticMarkup(settled);
    const button = cueButton(settled);
    mount.cue = button === null ? null : renderToStaticMarkup(button);
  }

  const mount: PagedMount = {
    html: "",
    cue: null,
    flip() {
      if (settled === null) throw new Error("the paged text is not mounted");
      const button = cueButton(settled);
      if (button === null) throw new Error("no cue to press");
      (button.props.onClick as () => void)();
      settle();
      refresh();
    },
  };

  settle();
  refresh();
  return mount;
}
