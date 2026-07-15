# Technical Design

## Architecture

- Add a native Win32 C++ WebView2 player host under `apps/player-windows`. It statically links the WebView2 loader and reads a versioned payload overlay from its own executable.
- Add a host-neutral Node release packer under `packages/interface` or a focused package module. It assembles the existing deployable player files, validates normalized relative paths, creates a deterministic payload, appends it to a staged native host, hashes the final artifact, and atomically writes it.
- Creator Server owns local release APIs and coordinates the active editor, workspace paths, release packer, and release records. Browser Creator retains its current ZIP assembler.
- Workspace owns project-scoped release record persistence and safe resolution below `Builds`; UI never constructs filesystem paths.

## Payload Contract

- Footer: fixed magic, payload schema version, manifest byte length, payload byte length, and SHA-256 of the payload region.
- Manifest: UTF-8 JSON containing build/project identity and an ordered file table of normalized slash-separated relative paths, offsets, lengths, and per-file SHA-256.
- Files: auto-start `player.html`, stitched `player-runtime.js`, `<build-id>.game.json`, default logo, and referenced local assets.
- Reject absolute paths, empty/dot segments, backslashes, `..`, duplicates, oversized length arithmetic, invalid UTF-8 manifest data, and hash mismatches.

## Native Runtime

- Extract validated files to a build-specific temporary directory and map them to a fixed HTTPS virtual host for module and asset loading.
- Store WebView2 user data at `%LOCALAPPDATA%/ReignsAgentPlayer/<project-id>/WebView2`; best-effort remove extracted static files after exit and stale temp files on startup.
- Deny navigation outside the virtual origin, new windows, permission requests, downloads, and devtools. A smoke flag validates payload and WebView2 initialization, reports title/card count, and exits.
- Check Evergreen WebView2 availability before window creation and show a message with the Microsoft download URL if absent.

## Release Persistence And APIs

- Artifacts: `Builds/<project-id>/<slug>-<version>-<build-id>.exe`.
- Records: project-local `builds/<release-id>.json`, written only after artifact rename succeeds. Listing tolerates malformed individual records by surfacing a workspace error rather than returning untrusted paths.
- `GET /api/releases`, `POST /api/releases/windows-x64`, `GET /api/releases/:id/artifact`, and `DELETE /api/releases/:id` always scope to the active project.
- Download responses use attachment disposition and stream the stored artifact. Delete validates both record identity and artifact containment; it removes the record and artifact without touching other releases.

## Compatibility And Distribution

- Old build endpoints remain unchanged. New runtime entries are staged into local Node ZIP and Windows Electron builds through the shared runtime allowlist.
- Native host compilation is a Windows-only build step. Unsupported/missing-host servers report release capability unavailable; Hosted keeps browser ZIP export.
- Generated EXEs are unsigned. Any future signing must happen after payload injection.
