# Desktop persistence and CI

## Goal

Make the portable desktop and local Creator retain application configuration and multiple projects in a clear beside-the-app workspace, while restoring reliable non-duplicated CI for PR #21.

## Requirements

- Store application config in `ReignsAgentData/config.toml` and projects below `ReignsAgentData/projects/<uuid>/`.
- Keep `content.json` metadata title canonical; project manifests contain identity and lifecycle metadata only.
- Persist project UI state separately in `workspace.toml`.
- Store the AI API key as plaintext config, mask it in UI/API reads, and exclude it from logs, project/player exports, and runtime artifacts.
- Support create/list/open/rename/delete projects and durable editor mutations through the shared Creator Server.
- Clone the immutable bundled sample into an ordinary project.
- Use the same disk contract in Electron, the Node ZIP, and local Web; preserve existing editor and request-level credential compatibility.
- Raise the supported Node baseline to 22.
- Fix Ubuntu Electron smoke testing and remove duplicate branch-push/PR workflow runs.
- Keep the browser-hosted OPFS Creator out of this implementation; its v1 AI boundary is direct CORS endpoints only.

## Acceptance Criteria

- [x] Config, theme, AI endpoint metadata/key, active project, title, content, and workspace state survive server and desktop restarts.
- [x] Multiple projects remain isolated and can be created from blank/sample, opened, renamed, and deleted.
- [x] Concurrent in-process mutations are serialized and use atomic file replacement.
- [x] API key is never returned in clear API responses or included in project/player/release output.
- [x] Electron and Node ZIP use beside-the-app `ReignsAgentData`; development uses an ignored data directory.
- [x] Existing Creator API clients and request-level credentials remain compatible.
- [x] PR CI runs once, tests Node 22/24, and Electron smoke passes on Ubuntu with a testing-only sandbox override.
- [x] Native desktop workflows emit only correctly named portable ZIP artifacts and run packaged persistence smoke tests.
- [x] README, ROADMAP, AGENTS map, and Node requirements describe the resulting behavior.

## Out of Scope

- Cloud sync, accounts, database storage, cross-process locking, automatic migration of old random-origin localStorage, installers, public AI relay, and browser OPFS implementation.
