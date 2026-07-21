# ReignsAgent v0.1.0

This is the first public repository release of ReignsAgent: a complete local
workflow for authoring, reviewing, previewing, and shipping binary-choice card
narratives.

## Choose a download

- `reigns-agent-0.1.0.zip` — cross-platform Creator; requires Node.js 22+.
- `ReignsAgent-win32-x64-0.1.0.zip` — portable Windows 10/11 x64 Creator.
- `ReignsAgent-darwin-x64-0.1.0.zip` — portable Intel macOS Creator.
- `ReignsAgent-darwin-arm64-0.1.0.zip` — portable Apple Silicon Creator.
- `ReignsAgent-linux-x64-0.1.0.zip` — portable Linux x64 Creator.
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

See [CHANGELOG.md](CHANGELOG.md) for the capability summary and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.
