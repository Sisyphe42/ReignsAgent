# Error Log

## [ERR-20260710-001] electron-workspace-runtime-dependency

**Logged**: 2026-07-10T00:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
The installed Electron app could not resolve a dependency hoisted outside its workspace package.

### Error
```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'electron-squirrel-startup' imported from app.asar/src/main.mjs
```

### Context
- The desktop app is an npm workspace under `apps/desktop-electron`.
- Development-mode Electron smoke tests used the repository-level `node_modules` and passed.
- The installed Squirrel app had no matching module inside `app.asar`.

### Suggested Fix
Keep the desktop main process dependency-free where practical and run smoke tests against the packaged executable after Forge makes the native artifacts.

### Metadata
- Reproducible: yes
- Related Files: apps/desktop-electron/src/main.mjs, .github/workflows/desktop.yml

### Resolution
- **Resolved**: 2026-07-10T22:15:00+08:00
- **Notes**: Removed the hoisted runtime dependency, unpacked the utility entry/runtime, used a physical working directory, and added packaged-executable smoke coverage.

---

## [ERR-20260713-001] playwright-status-selector

**Logged**: 2026-07-13T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Hosted CORS smoke selectors must account for shared status classes and React form-node replacement during persisted setting updates.

### Resolution
Assert the endpoint-specific success modifier class and dispatch the three controlled input events in one browser task so React batches the update before replacing form nodes.

### Metadata
- Pattern-Key: hosted.playwright.stable-selectors
- Recurrence-Count: 3

---

## [ERR-20260710-005] powershell-command-path-passing

**Logged**: 2026-07-10T23:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
PowerShell treated paths appended after `-Command` as expression text instead of positional script arguments.

### Error
```text
Unexpected token '<portable package path>' in expression or statement.
```

### Context
- The portable archive script passed source and target paths after the `-Command` expression.
- Paths were not made available through `$args` as expected.

### Suggested Fix
Pass filesystem paths through child-process environment variables when invoking PowerShell expressions from Node.

### Metadata
- Reproducible: yes
- Related Files: scripts/build-portable-desktop.mjs

### Resolution
- **Resolved**: 2026-07-10T23:20:00+08:00
- **Notes**: ZIP source and target paths now use dedicated environment variables, avoiding quoting and whitespace ambiguity.

---

## [ERR-20260710-004] forge-zip-node25-incompatibility

**Logged**: 2026-07-10T23:15:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
Electron Forge's ZIP maker failed on Node 25 because its latest `cross-zip` dependency uses a removed recursive `fs.rmdir` option.

### Error
```text
TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.recursive' is no longer supported. Received true
```

### Context
- The repository supports Node 20 and newer.
- `cross-zip` 4.0.1 is the latest published version and still uses the removed API.
- Electron packaging completed; only archive creation failed.

### Suggested Fix
Keep Forge responsible for the native Electron package and create portable archives with a repository-owned cross-platform script using native ZIP facilities.

### Metadata
- Reproducible: yes
- Related Files: scripts/build-portable-desktop.mjs, package.json, .github/workflows/desktop.yml

### Resolution
- **Resolved**: 2026-07-10T23:15:00+08:00
- **Notes**: Removed all Forge makers and added a Node 20-25 compatible portable ZIP assembly step.

---

## [ERR-20260710-003] brand-log-contract-drift

**Logged**: 2026-07-10T23:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
A product-name cleanup changed a server startup log but missed an integration test that parsed a shorter legacy substring.

### Error
```text
Timed out waiting for release server output. Received: ReignsAgent: http://127.0.0.1:<port>/workbench
```

### Context
- The server was healthy and listening.
- The initial repository search targeted the full old product name and did not match the test's shorter `Creator:` regular expression.

### Suggested Fix
When changing user-visible log names, search both the complete old name and distinctive substrings consumed by tests or scripts.

### Metadata
- Reproducible: yes
- Related Files: apps/creator-server/src/server.mjs, test/integration/release-build.test.js

### Resolution
- **Resolved**: 2026-07-10T23:00:00+08:00
- **Notes**: Updated the release integration test to parse the canonical `ReignsAgent:` startup line.

---

## [ERR-20260710-002] local-node-modules-incomplete

**Logged**: 2026-07-10T00:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
Forge make could not run from the active workspace because a transitive file was missing from the existing root `node_modules`.

### Error
```text
Cannot find module node_modules/@electron/get/node_modules/fs-extra/lib/index.js
```

### Context
- The failure occurred before Electron packaging started.
- Long-running local development processes may be holding the root dependency tree.
- Source and desktop tests that do not traverse this dependency still pass.

### Suggested Fix
Validate packaging from a clean temporary workspace with `npm ci`; avoid deleting or rewriting a dependency tree used by active processes.

### Metadata
- Reproducible: yes
- Related Files: package-lock.json
- Recurrence-Count: 2
- Last-Seen: 2026-07-11

### Resolution
- **Resolved**: 2026-07-10T22:15:00+08:00
- **Notes**: Completed clean-room packaging previously. On recurrence, a lockfile-driven `npm ci` restored the incomplete nested package and allowed Forge to reach native packaging.

---

## [ERR-20260711-001] electron-zip-download-tls

**Logged**: 2026-07-11T13:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
Electron Forge packaging was interrupted while downloading the Electron ZIP by a transient TLS disconnect.

### Error
```text
Client network socket disconnected before secure TLS connection was established
```

### Context
- Source, integration, release, and Electron utility-process tests were already green.
- The required Electron 43.1.0 Windows x64 ZIP already existed in Electron's content-addressed local cache.

### Suggested Fix
Use the repository-supported `ELECTRON_ZIP_DIR` override when a verified matching ZIP is cached; otherwise retry the external download without changing product code.

### Metadata
- Reproducible: no
- Related Files: apps/desktop-electron/forge.config.mjs, README.md

### Resolution
- **Resolved**: 2026-07-11T13:07:00+08:00
- **Notes**: Reused the cached Electron 43.1.0 ZIP, then completed portable packaging, double-launch persistence smoke, and artifact verification.

---

## [ERR-20260711-001] package-manifest-patch

**Logged**: 2026-07-11T16:39:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
A structural patch left package.json with a trailing comma and missing closing brace.

### Resolution
Validated the manifest with JSON.parse before regenerating the lockfile.

---

## [ERR-20260711-002] playwright-local-install

**Logged**: 2026-07-11T16:42:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
A lockfile-only install did not place the newly added Playwright test dependency in node_modules.

### Resolution
Installed workspace dependencies before running the Hosted Chromium smoke.

---
