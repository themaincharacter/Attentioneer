# The asset protocol's grant (story 16.15)

An image reference is NEVER copied into the workspace: the card renders the file
from where the person keeps it, through Tauri's asset protocol. Two facts make
that possible, and both live in `tauri.conf.json` (JSON carries no comments, so
the reasoning lives here, beside it, and in a comment at `src/canvas/imageSource.ts`):

```json
"assetProtocol": { "enable": true, "scope": { "allow": ["**", "/**"], "deny": [], "requireLiteralLeadingDot": false } }
```

- **`enable`** turns the protocol on. No new Rust command is written: the grant
  is configuration, not a capability, so the app's command surface does not grow.
- **`allow: ["**", "/**"]`** is deliberately the whole machine the app can read.
  A person picks an image with the OS dialog, and a pick can land anywhere — a
  home folder, a mounted drive, a temp file. A narrower list would silently draw
  a broken image for a file the person was just allowed to point at, which is
  exactly the dishonesty this story refuses. The price is stated rather than
  hidden: the webview may address any file this process can read. If that trade
  ever needs narrowing, the record's `from` values are the list of places the
  person actually pointed at.
- **`deny: []`** keeps the grant in one list; a deny entry would be a second
  truth about the same scope.
- **`requireLiteralLeadingDot: false`** lets a pick inside a dotted folder
  (e.g. `~/.local/share/pictures`) still render. The protocol serves read-only
  bytes; nothing here writes, copies or resolves a symlink for the person.

The image's bytes never enter the map folder. The video's thumbnail DOES — it is
copied beside the map as the same local SVG wrapper a page's thumbnail uses,
because a remote image at render time would put the network inside the map's
rendering (see `src/map/media.ts`).
