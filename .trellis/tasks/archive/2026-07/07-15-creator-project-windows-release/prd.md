# Creator Project Windows Release

## Goal

Allow a local Creator user to turn the active project into a directly runnable Windows x64 single-file player executable while preserving project-scoped release history.

## Background

Hosted Creator already exports a deployable player ZIP, while local Creator currently exports only a `.game.json`. The workspace already reserves top-level `Builds` output and project-local `builds` directories. The player release must remain isolated from Creator, Reviewer, Pipeline, AI configuration, credentials, and Electron APIs.

## Requirements

- Local Windows Node Creator and Electron Creator can build a `windows-x64` single-file EXE for the active project; Hosted continues to export the Web player ZIP.
- The EXE automatically loads the embedded game and contains only player HTML/runtime, Core, the build manifest, default player branding, and referenced local assets.
- The player host depends only on the Evergreen WebView2 Runtime and shows an actionable error when it is missing; it must not install software.
- Project title and `metadata.version` determine executable metadata and a sanitized file name; v1 uses the default player icon.
- Player validation errors block release. A missing Review result is informative only.
- Successful artifacts are written below the portable top-level `Builds/<project-id>` root independently of process CWD.
- Each successful release records release id, project id, build id, title, version, target, timestamp, artifact path, byte size, and SHA-256. Failed builds leave no record.
- Creator lists, downloads, and explicitly deletes release history for the active project. Deleting a project does not implicitly delete published artifacts.
- Existing `/api/build/prepare`, `/api/build/export`, content schemas, and build schemas remain compatible.
- Creator Electron distributions remain ZIP-only; generated player releases may be single-file EXEs.

## Acceptance Criteria

- [x] A valid active project produces a Windows x64 EXE named from project title, version, and build id.
- [x] The EXE validates its embedded payload and auto-starts the player without a Load Build control.
- [x] Missing/corrupt payloads and missing WebView2 fail safely with user-facing errors.
- [x] Release history survives Creator restart and is isolated by active project.
- [x] Artifact download and confirmed deletion work without path traversal or cross-project access.
- [x] Hosted Creator still downloads its existing player ZIP and exposes no local EXE API behavior.
- [x] Node ZIP and Electron stage the Windows player host only for supported Windows builds.
- [x] Cross-platform JS tests pass under `npm run verify`; Windows CI builds and smoke-tests the real native host and generated EXE.
- [x] README, ROADMAP, frontend workspace spec, and durable desktop/release boundaries describe the new behavior.

## Out of Scope

- macOS/Linux player executables, installers, signing, auto-update, stores, publishing, project-specific icons, automatic WebView2 installation, and a new save-game system.
