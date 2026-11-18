# ReignsAgent v0.1.1

A patch release: a second bundled sample (Fog Harbor) and fixes for player
copy, settlement labels, and card-art recovery in the Creator.

## What's new

- **Fog Harbor (雾港) sample deck** — 20 Chinese-language cards with original
  SVG art, four authored gauges, and story groups. Pick it from the Project
  menu next to Open Court.
- **Project-aware player opening** — the `/play` preview no longer greets
  every deck with court copy; it shows the active project's description or
  title, with a neutral fallback.
- **Readable settlements** — end-of-run summaries now use authored gauge
  labels (e.g. 商会 / 渔民 / 灯油 / 议会) instead of raw `gauge1`–`gauge4`
  keys, in both the shared player and deployable standalone players, and the
  standalone player's closing text is localized.
- **Card art that survives restarts** — artwork in the Content panel now
  recovers after a Creator Server restart, undo/restore, project switches, or
  transient load failures, and the Hosted offline cache no longer stores
  failed responses.

## Choose a download

- `reigns-agent-0.1.1.zip` — cross-platform Creator; requires Node.js 22+.
- `ReignsAgent-win32-x64-0.1.1.zip` — portable Windows 10/11 x64 Creator.
- `ReignsAgent-darwin-x64-0.1.1.zip` — portable Intel macOS Creator.
- `ReignsAgent-darwin-arm64-0.1.1.zip` — portable Apple Silicon Creator.
- `ReignsAgent-linux-x64-0.1.1.zip` — portable Linux x64 Creator.
- `SHA256SUMS.txt` — SHA-256 integrity values for all five tested ZIPs.

Extract one Creator archive before starting it. Electron archives need no
system Node.js installation. The Node archive starts with `node start.mjs`.

## Important limitations

The desktop archives are portable, unsigned ZIPs rather than installers.
SmartScreen or Gatekeeper may display a warning. Code signing, notarization,
automatic updates, and store distribution are not included in this release.

Windows Project EXEs generated from local Creator are also unsigned and require
an installed Microsoft Edge WebView2 Evergreen Runtime. ReignsAgent does not
bundle or automatically install WebView2.

See [CHANGELOG.md](CHANGELOG.md) for the full change list and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Full Changelog

https://github.com/Sisyphe42/ReignsAgent/compare/v0.1.0...v0.1.1
