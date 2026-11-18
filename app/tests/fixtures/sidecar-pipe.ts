import { join } from "node:path";
import { parseSidecarLine, type SidecarLine } from "../../src/turn/protocol";
import type { TurnTransport } from "../../src/turn/turn";

/**
 * THE REAL SIDECAR, FOR A TEST (Epic 18 story 3b).
 *
 * Story 18.3 proved the session card's run under Bun and then could not run it
 * in the shipped window; 18.3b moved the lane into `app/sidecar/main.ts`. A
 * test that imported the lane's module would prove the lane, not the wire — so
 * this harness drives the ACTUAL sidecar process over its ACTUAL stdio pipe,
 * exactly as `tests/turn-first.test.ts` does for a turn. Everything a run test
 * needs is here: a transport that writes request lines and fans answers out by
 * id, a line reader with a bounded wait, and the child's stderr.
 */

export const APP_DIR = join(import.meta.dir, "..", "..");
export const SIDECAR_MAIN = join(APP_DIR, "sidecar", "main.ts");
export const BUN = process.execPath;
export const FAKE_SERVER = join(import.meta.dir, "acp-fake-server.ts");

/** Buffered lines from one child's stdout, with a bounded wait. */
export class SidecarLines {
  private buffer = "";
  private ready: string[] = [];
  private waiting: (() => void)[] = [];
  private closed = false;
  private handlers: ((line: string) => void)[] = [];
  private closeHandlers: (() => void)[] = [];

  constructor(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    void (async () => {
      for await (const chunk of stream) {
        this.buffer += decoder.decode(chunk, { stream: true });
        let newline = this.buffer.indexOf("\n");
        while (newline >= 0) {
          const line = this.buffer.slice(0, newline);
          this.buffer = this.buffer.slice(newline + 1);
          this.ready.push(line);
          for (const handler of this.handlers) handler(line);
          this.waiting.shift()?.();
          newline = this.buffer.indexOf("\n");
        }
      }
      this.closed = true;
      while (this.waiting.length > 0) this.waiting.shift()?.();
      // STORY 18.3c — THE PIPE'S CLOSE, as a real reader sees it: the child's
      // stdout ended, so no further line can arrive. A handler that asked
      // after the fact is still told (that is the race a dying sidecar often
      // loses).
      const told = this.closeHandlers;
      this.closeHandlers = [];
      for (const handler of told) handler();
    })();
  }

  /** Every line as it arrives (the transport's subscription). */
  onLine(handler: (line: string) => void): void {
    this.handlers.push(handler);
  }

  /** Hear the stream end (once), exactly as the window's transport does. */
  onClose(handler: () => void): () => void {
    if (this.closed) {
      handler();
      return () => {};
    }
    this.closeHandlers.push(handler);
    return () => {
      this.closeHandlers = this.closeHandlers.filter((entry) => entry !== handler);
    };
  }

  /** The next line, or a failure when the budget runs out. */
  async next(budgetMs = 5_000): Promise<string> {
    const deadline = Date.now() + budgetMs;
    while (this.ready.length === 0) {
      if (this.closed) throw new Error("the sidecar closed before answering");
      if (Date.now() >= deadline) {
        throw new Error("timed out waiting for a sidecar line");
      }
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
        setTimeout(resolve, 10);
      });
    }
    return this.ready.shift() as string;
  }
}

/** One open sidecar: its child, its lines, a transport, and its stderr. */
export interface SidecarPipe {
  child: ReturnType<typeof Bun.spawn>;
  lines: SidecarLines;
  transport: TurnTransport;
  /** Everything it has said on stderr so far (a leak probe). */
  stderr(): string;
  /** Wait for the hello line, so a request cannot race the start. */
  hello(): Promise<SidecarLine>;
  /** Kill the sidecar process itself. */
  stop(): void;
}

/** The real pipe as a `TurnTransport`: write a line, dispatch lines by id. */
export function transportOf(child: ReturnType<typeof Bun.spawn>, lines: SidecarLines): TurnTransport {
  const waiting = new Map<number, (line: SidecarLine) => void>();
  lines.onLine((raw) => {
    const line = parseSidecarLine(raw);
    if (line === null || line.kind === "hello") return;
    waiting.get(line.id)?.(line);
  });
  return {
    async send(line) {
      child.stdin.write(line + "\n");
      await child.stdin.flush();
    },
    subscribe(id, handler) {
      waiting.set(id, handler);
      return () => {
        if (waiting.get(id) === handler) waiting.delete(id);
      };
    },
    // 18.3c: the real pipe's close, so a test can kill the sidecar mid-run and
    // watch the window's seam settle on the death rather than on the budget.
    onClosed(handler) {
      return lines.onClose(handler);
    },
  };
}

/** Spawn the actual sidecar and hand back everything a test drives it with. */
export function openSidecar(
  options: { env?: Record<string, string | undefined>; cwd?: string } = {},
): SidecarPipe {
  const child = Bun.spawn([BUN, SIDECAR_MAIN], {
    cwd: options.cwd ?? APP_DIR,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...options.env },
  });
  const lines = new SidecarLines(child.stdout as ReadableStream<Uint8Array>);
  let said = "";
  void (async () => {
    for await (const chunk of child.stderr as ReadableStream<Uint8Array>) {
      said += new TextDecoder().decode(chunk);
    }
  })();
  const transport = transportOf(child, lines);
  return {
    child,
    lines,
    transport,
    stderr: () => said,
    hello: async () => {
      const line = parseSidecarLine(await lines.next());
      if (line === null) throw new Error("the sidecar's first line was not a line");
      return line;
    },
    stop: () => {
      child.kill();
    },
  };
}
