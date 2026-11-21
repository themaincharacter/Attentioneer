# Attentioneer — the app

A Tauri 2 + React 19 desktop app for building attention to complex systems: a person-authored map of references
and distances, with cheap LLMs as bounded delegates. Three maps (concept / dynamics / ground) live in one window.

The rules this code obeys are in [`../AGENTS.md`](../AGENTS.md); where the project stands, in
`../progress.md`. The map's records (plain text files under a workspace's `map/`) are the version of truth.

## Prerequisites

- **Bun** — runs the tests, the dev server and the turn sidecar: <https://bun.sh>
- **Rust** (stable) + `cargo` — the Tauri host: <https://rustup.rs>
- **Tauri's system dependencies** for your OS — on Linux:
  `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
- **Bun on `PATH`** (or set `REA_TURN_BUN` to its full path): the app launches the sidecar with it.

## The commands you will actually use

```bash
bun install                 # once

bun run tauri dev           # THE app: the real window, sidecar, secrets, file dialogs
bun run dev                 # Vite only on :1420 — UI in a browser, no Tauri features

bun test                    # all unit tests (fast; ~200 files)
bun test tests/ground-find.test.ts     # one file
bun run build               # typecheck (tsc) + production bundle; fails on a type error

cd src-tauri && cargo test  # the Rust side
bun run tauri build         # a packaged app
```

`bun run dev` is a preview: it is fine for layout and canvas work, but anything that talks to the host (keys, file
dialogs, the sidecar, the asset protocol) needs `bun run tauri dev`.

## The occasional commands

```bash
bun run catalog:refresh     # refetch the model catalogue (models.dev export). THE ONLY NETWORK COMMAND.
                            # writes turn/modelsDevCatalog.json; never fetched at runtime.

bun run spike:acp           # the ACP handshake against a local agent tool, printed line by line

bun run commands --workspace /path/to/ws --script acts.json          # drive the app's acts headlessly
bun run commands --workspace /path/to/ws --script acts.json --accept # the same, then accept the ghosts
```

`acts.json` uses the vocabulary in `src/commands/acts.ts` — a JSON array, a `{ "acts": [...] }` wrapper, a
single act object, or one act per line (`#` starts a comment). A minimal script:

```json
[
  { "act": "propose_wire", "map": "ground", "payload": { "from": "rain gauge", "to": "soil" } },
  { "act": "propose_note", "map": "ground", "payload": { "card": "rain gauge", "note": "it is the gauge" } }
]
```

Proposing writes nothing to the map: the records stay byte-identical until `--accept`. This is the same code path
the command card in the app uses.

## Driving a running dev build

Set a file path and, in a **development build only**, the app polls it for act scripts and appends what happened:

```bash
ATTENTIONEER_DEV_COMMANDS=/tmp/attentioneer-commands.json bun run tauri dev
# write an act script to /tmp/attentioneer-commands.json -> results appear in /tmp/attentioneer-commands.json.results
```

It does not exist in a release build (a test asserts the chunk is never emitted). It drives acts, not pixels.

## Where things live

| Path | What |
|---|---|
| `src/map/` | the records: ground, readings, asks, sessions, media, prisms, mirror, history |
| `src/canvas/` | the three maps, the cards, the gestures, the command card |
| `src/turn/` | prompts, the packet, the curator, providers, ACP |
| `src/commands/` | the act vocabulary, its executor and the app adapter |
| `src/ghost/` | proposals: parse, dry-run, apply, pins |
| `sidecar/` | the Bun process that is the only one allowed to talk to a network |
| `src-tauri/` | the host: windows, secrets, the sidecar's lifecycle, the file reader |
| `scripts/` | the catalogue refresh, the act driver, the ACP spike |

## Testing notes

- Tests describe behaviour, never another product's design.
- A red suite is a stopped clock: fix a flake by making it deterministic (an injected clock, an event instead of a
  poll) — **never** by retrying, sleeping longer or relaxing the assertion.
- The human checks a person runs in the window live in `../notes/verification-checklist.md`.